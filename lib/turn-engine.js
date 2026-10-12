export function shouldSupersedeRequest(inFlightRequestId, firstMessageCommittedRequestId, obsoleteRequestIds) {
    return inFlightRequestId != null
        && inFlightRequestId !== firstMessageCommittedRequestId
        && !obsoleteRequestIds.has(inFlightRequestId);
}
export function createTurnEngine(deps) {
    const turns = new Map();
    const narrating = new Set();
    function bufferUserNarrative(story, participant, session, now, supersededIntents, content, imageSources, audioSources, quote, flushTrigger, endpointId) {
        const key = participant.id;
        const existing = turns.get(key);
        const turn = existing ?? {
            storyId: story.id, participantId: participant.id, messages: [], nextRevision: 0,
            obsoleteRequestIds: new Set(), discardedRequestIds: new Set(), sources: [],
        };
        if (shouldSupersedeRequest(turn.inFlightRequestId, turn.firstMessageCommittedRequestId, turn.obsoleteRequestIds)) {
            turn.obsoleteRequestIds.add(turn.inFlightRequestId);
            deps.reportOperation('standard', 'info', story, 'user-message', '新消息到达且首条回复尚未提交，放弃旧请求 参与者=%s 请求=%d', participant.id, turn.inFlightRequestId);
        }
        turn.messages.push({ content, occurredAt: now, supersededIntents, imageSources, audioSources,
            ...(endpointId ? { endpointId } : {}), ...(quote !== undefined && quote !== null ? { quote } : {}) });
        turn.latestSession = session;
        if (turn.timer)
            turn.timer();
        const revision = ++turn.nextRevision;
        const delay = Math.max(0, deps.userMessageDebounceSeconds) * 1000;
        turn.timer = deps.setTimeout(() => flushTrigger(key, revision), delay);
        turns.set(key, turn);
        deps.reportOperation('diagnostic', 'debug', story, 'user-message', '短时消息合并 参与者=%s 待处理=%d 等待=%dms', participant.id, turn.messages.length, delay);
    }
    function signalIncomingInterruption(story, participant) {
        const turn = turns.get(participant.id);
        if (!turn || !shouldSupersedeRequest(turn.inFlightRequestId, turn.firstMessageCommittedRequestId, turn.obsoleteRequestIds))
            return;
        turn.obsoleteRequestIds.add(turn.inFlightRequestId);
        deps.reportOperation('standard', 'info', story, 'user-message', '新消息到达且首条回复尚未提交，放弃旧请求 参与者=%s 请求=%d', participant.id, turn.inFlightRequestId);
    }
    function hasPendingNarrative(storyId, hasPendingGroupTurn) {
        if (narrating.has(storyId))
            return true;
        for (const turn of turns.values()) {
            if (turn.storyId === storyId && (turn.messages.length || turn.timer || turn.inFlightRequestId))
                return true;
        }
        return hasPendingGroupTurn(storyId);
    }
    function beginFlush(key, revision, retryDelay) {
        const turn = turns.get(key);
        if (!turn || turn.nextRevision !== revision)
            return null;
        if (narrating.has(turn.storyId)) {
            turn.timer = deps.setTimeout(() => retryDelay(key, revision), 250);
            return null;
        }
        narrating.add(turn.storyId);
        turn.timer = undefined;
        turn.activeSources = turn.sources;
        turn.sources = [];
        return turn;
    }
    function endFlush(key, requestId) {
        const turn = turns.get(key);
        if (!turn)
            return;
        if (turn.inFlightRequestId === requestId) {
            turn.inFlightRequestId = undefined;
            turn.firstMessageCommittedRequestId = undefined;
            // These fields describe only the request that just ended. Clear them
            // before a pending replacement batch or an automatic continuation can
            // reuse the same turn owner.
            turn.activeSources = undefined;
            turn.activeBatchEndpointIds = undefined;
            turn.activeBatchMessageCount = undefined;
            narrating.delete(turn.storyId);
        }
        turn.obsoleteRequestIds.delete(requestId);
        turn.discardedRequestIds?.delete(requestId);
        if (!turn.messages.length && !turn.timer && !turn.inFlightRequestId)
            turns.delete(key);
        // 回合结束时仍有未处理消息(暂停期被取消的定时器/obsolete 拦截放回的批次/
        // in-flight 期间到达的新消息)却无人持有定时器 → 孤儿:有消息无定时器,要等
        // 下一条用户消息才被救活,期间还阻塞后台推进。此处补一个定时器闭环:
        // 运行态直接触发 flush;暂停态触发会被 flush 入口的 paused 检查拦下,
        // 消息保留在 turn 里,由 resume 的 rescheduleTimers 接管。
        else if (turn.messages.length && !turn.timer && !turn.inFlightRequestId) {
            const revision = ++turn.nextRevision;
            turn.timer = deps.setTimeout(() => deps.scheduleTurnFlush(key, revision), Math.max(0, deps.userMessageDebounceSeconds) * 1000);
        }
    }
    function rescheduleTimers(flushTrigger) {
        for (const [key, turn] of turns) {
            if (!turn.timer && !turn.inFlightRequestId && turn.messages.length) {
                const revision = ++turn.nextRevision;
                turn.timer = deps.setTimeout(() => flushTrigger(key, revision), 0);
            }
        }
    }
    function invalidateNarratives(storyId, invalidateGroups) {
        for (const [key, turn] of turns) {
            if (storyId && turn.storyId !== storyId)
                continue;
            if (turn.timer)
                turn.timer();
            if (turn.inFlightRequestId != null) {
                // Keep an in-flight owner in the map until endFlush() runs. Deleting it
                // here would strand narrating.has(storyId)=true forever because the
                // completion callback would no longer have a turn through which to
                // release the story claim. Clear only buffered work; a later message
                // may reuse this owner while the obsolete request is winding down.
                turn.obsoleteRequestIds.add(turn.inFlightRequestId);
                (turn.discardedRequestIds ??= new Set()).add(turn.inFlightRequestId);
                turn.messages.length = 0;
                turn.timer = undefined;
            }
            else {
                turns.delete(key);
            }
        }
        invalidateGroups?.(storyId);
    }
    function recordSource(key, endpointId, receivedSeq) {
        const turn = turns.get(key);
        if (!turn)
            return;
        if (turn.sources.some(source => source.endpointId === endpointId))
            return;
        turn.sources.push({ endpointId, receivedSeq });
        turn.sources.sort((left, right) => left.receivedSeq - right.receivedSeq);
    }
    return {
        turns, narrating,
        bufferUserNarrative, signalIncomingInterruption, hasPendingNarrative,
        beginFlush, endFlush, rescheduleTimers, invalidateNarratives, recordSource,
        isNarrating: (storyId) => narrating.has(storyId),
        getTurn: (key) => turns.get(key),
        pendingTurnCount: () => turns.size,
    };
}
