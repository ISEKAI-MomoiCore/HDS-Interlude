/**
 * M4 bridge: compile beta10's proven fields into a positive continuation
 * scaffold. Each prepared value is moved into one semantic group and is never
 * recomputed or duplicated in the model-facing payload.
 */
export function compileNarrativeContext(payload, frame, _burst) {
    return {
        storyIdentity: {
            setting: payload.setting,
        },
        relevantEstablishedEpisodes: compactObject({
            recentScript: payload.recentScript,
            sceneContext: payload.sceneContext,
            continuitySnapshot: payload.continuitySnapshot,
            continuitySnapshotAgeMinutes: payload.continuitySnapshotAgeMinutes,
            durableFacts: payload.durableFacts,
            memories: payload.memories,
            overlayEvolution: payload.overlayEvolution,
            // M4.1: a recall hit points back to the original script neighbourhood.
            // The model-facing name makes clear that this is prose evidence, not a
            // second abstract memory summary.
            recalledScript: payload.recalledHistory,
            webContext: payload.webContext,
            recentExchange: payload.recentExchange,
        }),
        currentSceneEvidence: projectSceneEvidence(frame, new Set((payload.recentScript ?? []).map((entry) => entry.id).filter(Number.isSafeInteger))),
        ongoingThreads: compactObject({
            state: payload.state,
            currentParticipant: payload.currentParticipant,
            participants: payload.participants,
            availableGroupTargets: payload.availableGroupTargets,
            availableOutgoingEndpoints: payload.availableOutgoingEndpoints,
            activeConsequences: payload.activeConsequences,
            followUpCommitments: payload.followUpCommitments,
            contactThreads: payload.contactThreads,
            workingDetails: payload.workingDetails,
            interruptedOutgoingDrafts: payload.interruptedOutgoingDrafts,
            supersededDelayedReplies: payload.supersededDelayedReplies,
            automaticDeliverySummaries: payload.automaticDeliverySummaries,
            deliveryReality: payload.deliveryReality,
            developmentTendencies: payload.developmentTendencies,
        }),
        availableNearFuture: compactObject({
            timelinePlan: payload.timelinePlan,
            timelineCarry: payload.timelineCarry,
            schedulePreplan: payload.schedulePreplan,
            dueIntents: payload.dueIntents,
            upcomingPlans: payload.upcomingPlans,
        }),
        incomingEvent: compactObject({
            event: payload.currentEvent,
            groupContext: payload.groupContext,
            chatCapabilities: payload.chatCapabilities,
            stickerCatalog: payload.stickerCatalog,
            // M4 §十：确定性通道标注——命中五规则时注入 channelContext + 简短标记
            channelContext: projectChannelContext(payload),
        }),
        authoringWindow: compactObject({
            phase: payload.phase,
            interval: payload.interval,
            continuation: payload.continuation,
            liveTimeBoundary: payload.liveTimeBoundary,
            refreshContinuity: payload.refreshContinuity,
            outputRecovery: payload.outputRecovery,
            emotionalOffset: payload.emotionalOffset,
            agencyWindow: payload.agencyWindow,
        }),
    };
}
export function compiledContextConflicts(payload, compiled) {
    const pairs = [
        [payload.setting, compiled.storyIdentity.setting, 'setting'],
        [payload.state, compiled.ongoingThreads.state, 'state'],
        [payload.recentScript, compiled.relevantEstablishedEpisodes.recentScript, 'recentScript'],
        [payload.currentEvent, compiled.incomingEvent.event, 'currentEvent'],
        [payload.interval, compiled.authoringWindow.interval, 'interval'],
        [payload.timelinePlan, compiled.availableNearFuture.timelinePlan, 'timelinePlan'],
    ];
    return pairs.filter(([legacy, next]) => legacy !== next).map(([, , label]) => `${label} was recomputed`);
}
/** Scene state is a small sourced navigation aid. DialogueBurst is host-owned
 * commit identity and prose-shaped fields are deliberately not serialised. */
function projectSceneEvidence(frame, recentEntryIds) {
    if (!frame)
        return {};
    const outsideSourceEntryIds = frame.sourceEntryIds.filter(id => !recentEntryIds.has(id));
    return compactObject({
        sceneId: frame.sceneId,
        place: sourced(frame, 'place', recentEntryIds),
        presentPeople: sourced(frame, 'presentPeople', recentEntryIds),
        ongoingActivity: sourced(frame, 'ongoingActivity', recentEntryIds),
        attention: sourced(frame, 'attention', recentEntryIds),
        deviceAccess: sourced(frame, 'deviceAccess', recentEntryIds),
        privacy: sourced(frame, 'privacy', recentEntryIds),
        openLoops: sourced(frame, 'openMotions', recentEntryIds),
        sourceEntryIds: outsideSourceEntryIds.length ? outsideSourceEntryIds : undefined,
    });
}
function sourced(frame, field, recentEntryIds) {
    const value = frame[field];
    const sourceEntryIds = frame.sources[field];
    const populated = Array.isArray(value) ? value.length > 0 : typeof value === 'string' && !!value.trim();
    return populated && sourceEntryIds?.length && sourceEntryIds.some(id => !recentEntryIds.has(id))
        ? { value, sourceEntryIds }
        : undefined;
}
function compactObject(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
export function projectChannelContext(payload) {
    const rules = [];
    const sources = [];
    // 从 payload 中提取通道信息（service 侧在构建 NarrativeRequest 时注入）
    const turnSources = payload._channelTurnSources;
    const lastEntryChannel = payload._channelLastEntryChannel;
    const currentChannel = payload._channelCurrentChannel;
    const replyEndpoint = payload._channelReplyEndpoint;
    const participant = payload.currentParticipant;
    // 来源端点集是标注的证据，即使只命中规则 3/4/5 也应保留。
    // 过滤无效值并按接收序号稳定排序，避免模型看到 NaN/空端点。
    if (Array.isArray(turnSources)) {
        const seen = new Set();
        for (const source of turnSources) {
            const endpointId = String(source?.endpointId ?? '').trim();
            if (!endpointId || seen.has(endpointId))
                continue;
            const receivedSeq = Number(source?.receivedSeq);
            sources.push({
                endpointId,
                channelKind: source?.channelKind === 'wechat' ? 'wechat' : 'qq',
                receivedSeq: Number.isSafeInteger(receivedSeq) && receivedSeq >= 0 ? receivedSeq : 0,
            });
            seen.add(endpointId);
        }
        sources.sort((left, right) => left.receivedSeq - right.receivedSeq || left.endpointId.localeCompare(right.endpointId));
        if (sources.length > 1)
            rules.push('multi-endpoint-turn');
    }
    // 规则 2：同批消息多端点（currentEvent 含 multiEndpoint 标记）
    if (payload.currentEvent?.multiEndpoint === true || payload._channelBatchMultiEndpoint === true)
        rules.push('batch-multi-endpoint');
    // 规则 3：私聊↔群聊切换
    if (lastEntryChannel?.conversationKind && currentChannel?.conversationKind
        && lastEntryChannel.conversationKind !== currentChannel.conversationKind) {
        rules.push('conversation-kind-switch');
    }
    // 规则 4：同一参与者不同端点连续出现
    if (lastEntryChannel?.endpointId && currentChannel?.endpointId
        && lastEntryChannel.endpointId !== currentChannel.endpointId
        && participant?.id) {
        rules.push('participant-endpoint-switch');
    }
    // 规则 5：回复目标 ≠ 来源端点
    if (replyEndpoint?.endpointId && currentChannel?.endpointId
        && replyEndpoint.endpointId !== currentChannel.endpointId) {
        rules.push('reply-target-differs');
    }
    if (!rules.length)
        return undefined;
    // 构建简短标记
    const kind = currentChannel?.channelKind === 'wechat' ? '微信' : 'QQ';
    const conv = currentChannel?.conversationKind === 'group' ? '群' : '私';
    const tag = `[${kind}·${conv}]`;
    return { tag, rules, sources };
}
