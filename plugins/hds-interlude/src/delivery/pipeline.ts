import { persistedDesktopProcessingContext } from '../processing-context'
/** 投递管线：出站消息编排、传输执行（session→桌面桥→bot 三级路由）、
 * 分段打字节奏、投递回执与账本回写、失败/撤回记账、自动投递摘要。
 *
 * P2 自 service.ts 投递区迁出（2026-10-29），行为不变。函数接收宿主（service
 * 实例或测试假宿主）为第一参数——与 runStorySerialized 同一形态；service.ts
 * 保留同名薄委托，既有调用点与全部测试零改动。锁相位纪律随代码原样保留：
 * 传输在故事串行队列之外，回执/账本回写经 runStorySerialized 在队列内。
 * 账本边界（ARCHITECTURE.md“投递与调度边界”）：账本是跨重启唯一真相；
 * 终态不可逆；transportTimeout/ambiguous 记 pending 不判失败；pending 补偿
 * 只重放传输不重跑模型。 */
import { h, Session, Time } from 'koishi'
import { captureStoryTask } from '../task-lifecycle'
import { runStorySerialized, clip, toDate, isRecord, mergeDeliverySummary, normalizeFollowUpResolutions, normalizeFollowUpCommitment, splitVisibleReplyBubbles, isLiteralQuoteOnly, literalQuoteText } from '../narrative-normalizers'
import { normalizeGroupId, isOneBotPlatform, privateDeliveryChannelId, withTransportTimeout } from '../session-platform'
import { updateScriptDeliveryActions, type ScriptDeliveryAction, type ScriptDeliveryReference, type ScriptDeliverySegmentStatus } from '../script/delivery-ledger'
import { deliveryEntryMetadata, scriptEventPayload, restoreMessageEvent } from '../delivery'
import { targetableMessageId } from '../chat-artifacts'
import { freshEndpointState, stateAfterConnection } from '../endpoints'
import { decodeStoryState, encodeStoryState } from '../story-state'
import type { AutomaticDeliverySummary, InterludeParticipant, InterludeStory, NarrativeIntent, OutgoingMessageDraft, ScriptEntry } from '../types'
import type { EndpointRow } from '../endpoints'

export interface GroupDeliveryResult {
  deliveredSegments: string[]
  complete: boolean
  segmentOutcomes: Array<{ index: number; content: string; status: 'delivered' | 'failed' | 'cancelled'; reason?: string }>
}

/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function sendCrossGroupMessage(svc: any,
    story: InterludeStory,
    message: OutgoingMessageDraft,
    session?: Session,
    failureStatus: 'failed' | 'pending' = 'failed',
    shouldCancel: () => boolean = () => false,
  ) {
    const generation = svc.deliveryGeneration(story.id)
    const groupId = normalizeGroupId(message.participantId.slice('group:'.length))
    const allowed = svc.config.onebot?.groupChats?.some((group: any) => group.enabled !== false && normalizeGroupId(group.groupId) === groupId)
    const segments: string[] = svc.splitOutgoingMessage(message.content)
    const baseIndex = message.scriptEvent?.bubbleIndex ?? 0
    const settled = new Map<number, GroupDeliveryResult['segmentOutcomes'][number]['status']>()
    const drafts = segments.map((content, index) => ({ ...message, content,
      ...(message.scriptEvent ? { scriptEvent: { ...message.scriptEvent, bubbleIndex: baseIndex + index } } : {}) }))
    if (message.scriptEvent?.scriptEntryId) {
      const source = (await svc.dbGet('interlude_script_entry', { storyId: story.id, id: message.scriptEvent.scriptEntryId }))[0] as ScriptEntry | undefined
      if (!source || source.storyId !== story.id) return { deliveredSegments: [], complete: false,
        segmentOutcomes: segments.map((content, index) => ({ index, content, status: 'cancelled' as const, reason: 'delivery-source-unavailable' })) }
      const action = (source?.metadata?.deliveryActions as ScriptDeliveryAction[] | undefined)?.find(item => item.commitId === message.scriptEvent!.commitId && item.eventId === message.scriptEvent!.eventId)
      for (const [index, draft] of drafts.entries()) {
        const key = svc.deliveryExecutionKey(story.id, draft, true)!
        if (svc.acceptedDeliveries.has(key) || await svc.successfulDeliveryEntry(story.id, draft)) settled.set(index, 'delivered')
        else {
          const status = action?.segments.find(item => item.index === baseIndex + index)?.status
          if (status === 'delivered' || status === 'cancelled' || status === 'failed') settled.set(index, status)
        }
      }
    }
    const allSettled = settled.size === segments.length
    const outcome: GroupDeliveryResult = allSettled
      ? { deliveredSegments: segments.filter((_, index) => settled.get(index) === 'delivered'),
        complete: [...settled.values()].every(status => status === 'delivered'),
        segmentOutcomes: segments.map((content, index) => ({ index, content, status: settled.get(index)! })) }
      : allowed ? await svc.sendGroupMessage(story, groupId, message.content, undefined, session, message.endpointId, {
        traceId: message.traceId, processingId: message.processingId,
      }, { shouldCancel, settled, onDelivered: (index: number) => {
        const key = svc.deliveryExecutionKey(story.id, drafts[index], true)
        if (key && !svc.databaseResetting && svc.deliveryGeneration(story.id) === generation) svc.acceptedDeliveries.set(key, drafts[index])
      } })
      : { deliveredSegments: [], complete: false, segmentOutcomes: segments.map((content, index) => ({ index, content, status: settled.get(index) ?? 'failed', reason: 'group-not-allowed' })) }
    if (svc.databaseResetting || svc.deliveryGeneration(story.id) !== generation) return outcome
    const now = new Date()
    await runStorySerialized(svc, story.id, async () => {
      if (svc.databaseResetting || svc.deliveryGeneration(story.id) !== generation) return
      const unrecorded = [] as GroupDeliveryResult['segmentOutcomes']
      for (const segment of outcome.segmentOutcomes) {
        if (segment.status === 'delivered' && !await svc.successfulDeliveryEntry(story.id, drafts[segment.index])) unrecorded.push(segment)
      }
      if (svc.databaseResetting || svc.deliveryGeneration(story.id) !== generation) return
      // A durable success receipt precedes ledger reconciliation. A later
      // ledger failure cannot turn an accepted bubble back into transport work.
      if (unrecorded.length) {
        if (!message.scriptEvent) {
          // 无账本旁路（issue #3）：cross-action 未经 commit 事件直接投递——
          // 可追溯到 normalizeDecision 的 group-echo 闸漏网或恢复路径残留。
          svc.reportOperation('diagnostic', 'warn', story, 'intent-due', '跨群投递缺少账本引用(不可追溯) 群=%s 分段=%d', groupId, unrecorded.length)
        }
        await svc.appendEntry(story.id, {
        kind: 'character-group-message', actor: 'character', content: unrecorded.map(segment => segment.content).join('<sep/>'), occurredAt: now.toISOString(),
        metadata: { groupId, channelId: groupId, ...(message.scriptEvent ?? {}),
          deliverySegmentIndexes: unrecorded.map(segment => baseIndex + segment.index), partialDelivery: !outcome.complete },
      }, now)
      }
      if (message.scriptEvent) {
        for (const segment of outcome.segmentOutcomes) {
          // transport-timeout: 前缀=结果未知 → 账本记 unknown 待核实（自动恢复
          // 不重发，迟到回执可升级）；generation 失效与显式 pending 保持 pending。
          const ledgerStatus = segment.status === 'failed'
            ? (segment.reason?.startsWith('transport-timeout') ?? false) ? 'unknown'
              : (failureStatus === 'pending' || segment.reason === 'delivery-generation-obsolete') ? 'pending' : segment.status
            : segment.status
          await svc.updateScriptDeliveryOutcome(story.id, { ...message.scriptEvent, segmentIndex: baseIndex + segment.index }, ledgerStatus, now, segment.reason)
          const draft = drafts[segment.index]
          const key = svc.deliveryExecutionKey(story.id, draft, true)!
          if (segment.status === 'delivered' && (await svc.deliveryLedgerConfirmed(story.id, draft) || await svc.successfulDeliveryEntry(story.id, draft))) svc.acceptedDeliveries.delete(key)
        }
      }
    })
    if (!outcome.complete) svc.report('warn', story, 'intent-due', '跨群消息投递未完成 群频道=%s', groupId)
    return outcome
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function deliveryExecutionKey(svc: any, storyId: string, message: OutgoingMessageDraft, segment = false) {
    void svc // 形态统一：全部投递函数以宿主为第一参数
    const ref = message.scriptEvent
    if (!ref?.scriptEntryId) return undefined
    return JSON.stringify([storyId, ref.scriptEntryId, ref.commitId, ref.eventId, ...(segment ? [ref.bubbleIndex ?? 0] : [])])
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function successfulDeliveryEntry(svc: any, storyId: string, message: OutgoingMessageDraft) {
    const ref = message.scriptEvent
    if (!ref?.scriptEntryId) return undefined
    const entries = await svc.dbGet('interlude_script_entry', {
      storyId, kind: { $in: ['character-message', 'character-group-message'] },
      'metadata.scriptEntryId': ref.scriptEntryId, 'metadata.commitId': ref.commitId, 'metadata.eventId': ref.eventId,
    }) as ScriptEntry[]
    return entries.find(entry => entry.kind === 'character-group-message'
      ? Array.isArray(entry.metadata?.deliverySegmentIndexes) && entry.metadata.deliverySegmentIndexes.includes(ref.bubbleIndex ?? 0)
      : (entry.metadata?.bubbleIndex ?? 0) === (ref.bubbleIndex ?? 0))
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function deliverOutgoingMessages(svc: any, 
    story: InterludeStory, messages: OutgoingMessageDraft[], current?: InterludeParticipant,
    session?: Session, shouldCancel?: (target: InterludeParticipant) => boolean, recordFailures = true,
    requestStartedAt?: Date, failureStatus: 'failed' | 'pending' = 'failed', splitSegment = false, confirmedEntries?: ScriptEntry[],
  ) {
    const delivered: OutgoingMessageDraft[] = []
    const generation = svc.taskGeneration(story.id)
    const receiptGeneration = svc.deliveryGeneration(story.id)
    for (const message of messages) {
      if (!svc.taskGenerationCurrent(story.id, generation)) break
      const key = svc.deliveryExecutionKey(story.id, message)
      if (key && svc.deliveryExecutors.has(key)) continue
      if (key) svc.deliveryExecutors.add(key)
      try {
        if (message.participantId.startsWith('group:')) {
          const outcome = await svc.sendCrossGroupMessage(story, message, session, failureStatus, () => !svc.taskGenerationCurrent(story.id, generation))
          if (outcome.complete) delivered.push(message)
          continue
        }
        const ref = message.scriptEvent
        const receiptKey = svc.deliveryExecutionKey(story.id, message, true)
        const accepted = receiptKey && svc.acceptedDeliveries.get(receiptKey)
        const receipt = ref?.scriptEntryId ? await svc.successfulDeliveryEntry(story.id, message) : undefined
        if (receipt) {
          const confirmed = await svc.confirmOutgoingDeliveries(story, [message], splitSegment)
          confirmedEntries?.push(...confirmed)
          if (receiptKey) svc.acceptedDeliveries.delete(receiptKey)
          delivered.push(message)
          continue
        }
        if (ref?.scriptEntryId && !accepted) {
          const entry = (await svc.dbGet('interlude_script_entry', { id: ref.scriptEntryId }))[0] as ScriptEntry | undefined
          const action = (entry?.metadata?.deliveryActions as ScriptDeliveryAction[] | undefined)?.find((item: ScriptDeliveryAction) => item.commitId === ref.commitId && item.eventId === ref.eventId)
          const segment = action?.segments?.find((item: { index: number }) => item.index === (ref.bubbleIndex ?? 0))
          if (!entry || entry.storyId !== story.id || segment && segment.status !== 'pending') {
            if (segment?.status === 'delivered') delivered.push(message)
            continue
          }
        }
        if (!svc.taskGenerationCurrent(story.id, generation)) break
        // A confirmation exception must not turn platform success into an
        // ordinary transport failure or trigger another platform request.
        const sent = accepted ? [accepted] : await svc.sendOutgoingMessages(story, [message], current, session,
          (target: InterludeParticipant) => !svc.taskGenerationCurrent(story.id, generation) || !!shouldCancel?.(target), recordFailures, requestStartedAt, failureStatus)
        for (const item of sent) {
          if (svc.databaseResetting || svc.deliveryGeneration(story.id) !== receiptGeneration) break
          if (receiptKey) svc.acceptedDeliveries.set(receiptKey, item)
          const confirmed = await svc.confirmOutgoingDeliveries(story, [item], splitSegment)
          confirmedEntries?.push(...confirmed)
          delivered.push(item)
          if (receiptKey && (!item.scriptEvent || await svc.deliveryLedgerConfirmed(story.id, item) || await svc.successfulDeliveryEntry(story.id, item))) svc.acceptedDeliveries.delete(receiptKey)
        }
      } finally { if (key) svc.deliveryExecutors.delete(key) }
    }
    return delivered
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function deliveryLedgerConfirmed(svc: any, storyId: string, message: OutgoingMessageDraft) {
    const ref = message.scriptEvent!
    const entry = (await svc.dbGet('interlude_script_entry', { storyId, id: ref.scriptEntryId }))[0] as ScriptEntry | undefined
    const action = (entry?.metadata?.deliveryActions as ScriptDeliveryAction[] | undefined)?.find((item: ScriptDeliveryAction) => item.commitId === ref.commitId && item.eventId === ref.eventId)
    return action?.segments?.find((item: { index: number }) => item.index === (ref.bubbleIndex ?? 0))?.status === 'delivered'
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function sendOutgoingMessages(svc: any, 
    story: InterludeStory,
    messages: OutgoingMessageDraft[],
    current?: InterludeParticipant,
    session?: Session,
    shouldCancel?: (target: InterludeParticipant) => boolean,
    recordFailures = true,
    requestStartedAt?: Date,
    failureStatus: 'failed' | 'pending' = 'failed',
  ) {
    const delivered: OutgoingMessageDraft[] = []
    if (!messages.length) return delivered
    const ids = Array.from(new Set(messages.map(message => message.participantId).filter(id => !!id && !id.startsWith('group:'))))
    const byId = new Map<string, InterludeParticipant>()
    if (current && ids.includes(current.id)) byId.set(current.id, current)
    const missingIds = ids.filter(id => !byId.has(id))
    const participants = await Promise.all(missingIds.map(id => svc.getParticipant(id)))
    for (const participant of participants) if (participant) byId.set(participant.id, participant)
    // Do not silently fall back to an arbitrary transport when the endpoint
    // registry cannot be reconciled. Health gates only make sense after the
    // persisted registry and snapshots are available.
    try {
      await svc.ensureEndpointRegistry()
    } catch (error) {
      svc.reportStandalone('warn', '出站端点注册表不可用，已阻止本批消息投递 错误=%s', error)
      if (recordFailures) {
        for (const message of messages) {
          await svc.recordOutgoingDeliveryFailure(story, message.participantId, message, 'endpoint-registry-unavailable', failureStatus)
        }
      }
      return delivered
    }
    let typingFloorApplied = false
    for (const message of messages) {
      if (message.participantId.startsWith('group:')) {
        // A group target must never enter private participant lookup or use
        // session.send() from the private turn that authored this action.
        try { await svc.sendCrossGroupMessage(story, message, session, failureStatus) }
        catch (error) { svc.report('warn', story, 'intent-due', '跨群投递或回执记录失败（不自动重发）目标=%s 错误=%s', message.participantId, error) }
        continue
      }
      const target = byId.get(message.participantId)
      if (!target) {
        svc.report('warn', story, 'intent-due', '无法投递消息：参与者不存在 %s', message.participantId)
        if (recordFailures) await svc.recordOutgoingDeliveryFailure(story, message.participantId, message, 'participant-not-found', failureStatus)
        continue
      }
      if (!svc.canHandleParticipant(target)) {
        svc.report('warn', story, 'intent-due', '消息被当前账号白名单拦截 参与者=%s', target.id)
        if (recordFailures) await svc.recordOutgoingDeliveryFailure(story, target.id, message, 'participant-not-allowed', failureStatus)
        continue
      }
      // 首条发言的打字时间下限：模型返回快于按字数估算的打字时长时补足等待，
      // 返回慢于该时长则不等待。仅对当前对话参与者的首条生效，一次调用至多一次。
      if (requestStartedAt && current && message.participantId === current.id && !typingFloorApplied) {
        typingFloorApplied = true
        const hold = svc.firstMessageTypingHoldMs(message.content, requestStartedAt)
        if (hold > 0) {
          svc.reportOperation('diagnostic', 'debug', story, 'user-message', '首条消息按打字时间补足等待 参与者=%s 等待=%dms', target.id, hold)
          await new Promise<void>(resolve => { svc.ctx.setTimeout(() => resolve(), hold) })
        }
      }
      if (shouldCancel?.(target)) {
        svc.reportOperation('standard', 'info', story, 'user-message', '新消息打断主角输入，停止发送后续分段 参与者=%s', target.id)
        continue
      }
      let attemptedAddress: { platform: string, selfId: string } | undefined
      try {
        svc.reportOperation('standard', 'info', story, 'intent-due', '消息投递开始 参与者=%s', target.id)
        const legacyAddress = svc.endpointAddressSync({ platform: target.platform, selfId: target.selfId }, { kind: 'participant-user', id: target.id })
        // Keep the distinction between a caller-selected route and the legacy
        // default route.  The latter is still allowed to reuse the live
        // incoming Session; assigning its resolved endpointId below must not
        // accidentally turn an ordinary reply into a background delivery.
        const explicitEndpointId = typeof message.endpointId === 'string' && message.endpointId.trim()
          ? message.endpointId.trim() : undefined
        const selectedEndpointId = explicitEndpointId ?? legacyAddress.endpointId
        const endpointCandidate = selectedEndpointId
          ? svc.endpointRows.find((row: any) => row.id === selectedEndpointId
            && row.ownerKind === 'participant-user' && row.ownerId === target.id)
          : undefined
        const sessionMatchesCandidate = !endpointCandidate || (
          String(session?.selfId ?? '') === String(endpointCandidate.selfId)
          && (session?.platform === endpointCandidate.platform || isOneBotPlatform(String(session?.platform ?? '')) && isOneBotPlatform(endpointCandidate.platform))
        )
        // A live incoming Session is a current connection observation. Record
        // it before the gate, otherwise the first immediate reply can be
        // rejected as offline before the connector emits a lifecycle event.
        if (session && current?.id === target.id && endpointCandidate && sessionMatchesCandidate) {
          const previous = svc.endpointStates.get(endpointCandidate.id) ?? freshEndpointState(endpointCandidate.id)
          if (!previous.connection.online) svc.setEndpointState(endpointCandidate.id, stateAfterConnection(previous, true))
        }
        // 用户触发的回复豁免出站失败冷却：冷却的本意是防止风控端点被后台
        // 重试高频轰炸；直接回复刚收到的消息不属于该场景，一次网络抖动不
        // 该让该参与者最长 5 分钟已读不回。失败仍会延长冷却，自愈不变。
        const ignoreCooldown = message.userInitiated === true
        const resolved = svc.endpointForDelivery(selectedEndpointId, { kind: 'participant-user', id: target.id }, Date.now(), { ignoreCooldown })
        if (resolved.reason) {
          svc.report('warn', story, 'intent-due', '消息被端点门控阻止 参与者=%s 端点=%s 原因=%s', target.id, selectedEndpointId, resolved.reason)
          if (recordFailures) await svc.recordOutgoingDeliveryFailure(story, target.id, message, resolved.reason, failureStatus)
          continue
        }
        const endpoint = resolved.row
        const address = endpoint ? { platform: endpoint.platform, selfId: endpoint.selfId } : legacyAddress
        attemptedAddress = address
        if (endpoint && !explicitEndpointId) {
          message.endpointId = endpoint.id
          if (message.scriptEvent && !message.scriptEvent.endpointId) {
            message.scriptEvent = { ...message.scriptEvent, endpointId: endpoint.id }
          }
        }
        const sessionMatchesEndpoint = !endpoint || (
          String(session?.selfId ?? '') === String(endpoint.selfId)
          && (session?.platform === endpoint.platform || isOneBotPlatform(String(session?.platform ?? '')) && isOneBotPlatform(endpoint.platform))
        )
        const gateReason = endpoint ? svc.endpointGateReason(endpoint.id, Date.now(), { ignoreCooldown }) : undefined
        if (gateReason) {
          svc.report('warn', story, 'intent-due', '消息被端点状态门控阻止 参与者=%s 端点=%s 原因=%s', target.id, endpoint.id, gateReason)
          if (recordFailures) await svc.recordOutgoingDeliveryFailure(story, target.id, message, gateReason, failureStatus)
          continue
        }
        // User-triggered replies are not proactive contact.  Background,
        // delayed, and Agency messages must also pass the channel-specific
        // initiation gate when that transport exposes one (for example a
        // WeChat context token).  QQ/OneBot endpoints have no optional
        // initiate state and therefore retain the legacy behavior.
        const initiateReason = message.userInitiated === true || !endpoint
          ? undefined
          : svc.endpointInitiateGateReason(endpoint.id)
        if (initiateReason) {
          svc.report('warn', story, 'intent-due', '消息被主动联系端点门控阻止 参与者=%s 端点=%s 原因=%s', target.id, endpoint?.id, initiateReason)
          if (recordFailures) await svc.recordOutgoingDeliveryFailure(story, target.id, message, initiateReason, failureStatus)
          continue
        }
        const literalQuoteMessageId = await svc.resolveLiteralQuoteMessageId(story.id, target.id, message.content)
        const literalQuoteOnly = isLiteralQuoteOnly(message.content)
        if (literalQuoteOnly && !literalQuoteMessageId) {
          svc.report('warn', story, 'intent-due', '已阻止无法映射的伪引用文本 参与者=%s', target.id)
          if (recordFailures) await svc.recordOutgoingDeliveryFailure(story, target.id, message, 'literal-quote-target-not-found', failureStatus)
          continue
        }
        if (literalQuoteMessageId) message.quoteMessageId = literalQuoteMessageId
        const outgoingContent = literalQuoteMessageId
          ? [h('quote', { id: literalQuoteMessageId }), '\u200b']
          : message.content
        if (svc.config.logging?.logMessageContent) {
          svc.report('info', story, 'intent-due', '主角消息内容：%s', message.content.slice(0, svc.config.logging.previewLength))
        }
        if (!explicitEndpointId && session && current?.id === target.id && sessionMatchesEndpoint) {
          const receipt = await withTransportTimeout(session.send(outgoingContent), 'private-session-send')
          if (Array.isArray(receipt) && !receipt.length) throw new Error('Private transport returned no message receipt.')
          // 即时会话投递成功同样刷新端点状态（与 bot/desktop 路径一致）。
          svc.noteEndpointOutbound({ kind: 'participant-user', id: target.id }, true, 'session-delivered', address)
          delivered.push(message)
          continue
        }
        // A private endpoint's user id is not necessarily a Koishi channel id.
        // In particular, OneBot interprets a bare numeric channel as a group
        // target, so delayed/split messages could be routed to send_group_msg
        // even though the first live-session reply was sent privately.
        const privateChannelId = privateDeliveryChannelId(
          address.platform,
          endpoint?.userId || target.userId,
          endpoint?.channelId || target.channelId,
        )
        if (svc.desktopDeliveryHandler) {
          // typ-0 worker：没有 adapter bot，后台投递统一走宿主渠道。结果语义与
          // bot.sendMessage 一致——成功 resolve 进 delivered 由账本确认，失败
          // reject 进 catch 由 recordOutgoingDeliveryFailure 记录。
          if (!message.scriptEvent) {
            // 幂等键缺失 = 宿主无法跨 deliveryId 去重（迟到回执 + 30s 重试场景
            // 可能重复投递）。成因链在 commit-builder/delivery 层全部静默，
            // 这里必须留痕供排障。
            svc.reportOperation('diagnostic', 'debug', story, 'intent-due', '后台投递缺少 scriptEvent，幂等键缺失 参与者=%s', target.id)
          }
          const outcome = await svc.desktopDeliveryHandler({
            participantId: target.id, selfId: address.selfId, platform: address.platform,
            channelId: privateChannelId, kind: 'private', content: message.content,
            ...(message.traceId ? { traceId: message.traceId } : {}),
            ...(message.processingId ? { processingId: message.processingId } : {}),
            ...(message.quoteMessageId ? { quoteMessageId: message.quoteMessageId } : {}),
            ...(selectedEndpointId ? { endpointId: selectedEndpointId } : {}),
            ...(message.scriptEvent ? { intentKey: `${message.scriptEvent.eventId}:${message.scriptEvent.bubbleIndex}` } : {}),
          })
          if (outcome.ok) {
            // 桌面宿主投递成功同样刷新端点 deliverable 状态。
            svc.noteEndpointOutbound({ kind: 'participant-user', id: target.id }, true, 'desktop-delivered', address)
            delivered.push(message)
          }
          else if (outcome.transportTimeout) {
            // 宿主 echo 超时/桥断开 = 结果未知：与 withTransportTimeout 同族，
            // 账本记 pending 交补偿收尾（重复投递由 intentKey 幂等去重挡住）。
            throw Object.assign(new Error(outcome.error || 'typ-0 宿主投递结果未知。'), { transportTimeout: true })
          }
          else throw new Error(outcome.error || 'typ-0 宿主投递失败。')
          continue
        }
        // The endpoint selected above is a hard route.  Once a caller/model has
        // selected an endpoint, a missing bot or transport error must never
        // fall back to another account and create a misleading delivery.
        const bot = endpoint
          ? svc.ctx.bots.find((item: any) => String(item.selfId) === String(endpoint.selfId)
            && (item.platform === endpoint.platform || isOneBotPlatform(item.platform) && isOneBotPlatform(endpoint.platform)))
          : svc.findBotForParticipant(target)
        if (!bot) {
          svc.report('warn', story, 'intent-due', '没有可用机器人账号投递消息 参与者=%s', target.id)
          if (recordFailures) await svc.recordOutgoingDeliveryFailure(story, target.id, message, 'bot-not-found', failureStatus)
          continue
        }
        const receipt = await withTransportTimeout(bot.sendMessage(privateChannelId, outgoingContent), 'private-bot-send')
        if (Array.isArray(receipt) && !receipt.length) throw new Error('Private transport returned no message receipt.')
        svc.noteEndpointOutbound({ kind: 'participant-user', id: target.id }, true, endpoint ? 'endpoint-explicit' : 'private-delivered', address)
        delivered.push(message)
      } catch (error) {
        // Keep the address selected for this attempt.  Re-resolving here can
        // pick a different sibling endpoint after a failure and poison its
        // cooldown/diagnostics in a multi-account story.
        const address = attemptedAddress ?? svc.endpointAddressSync({ platform: target.platform, selfId: target.selfId }, { kind: 'participant-user', id: target.id })
        const unknownOutcome = (error as { transportTimeout?: boolean })?.transportTimeout === true
        if (unknownOutcome) {
          // 传输超时=结果未知：底层请求仍在飞,迟到回执由 deliveryExecutionKey
          // 幂等去重。账本记 unknown(设计 §7.3):调用可能已到达平台,自动恢复
          // 不重发,保留待核实;迟到成功回执可将其升级为 delivered。
          svc.noteEndpointOutbound({ kind: 'participant-user', id: target.id }, false, String(error), address)
          svc.report('warn', story, 'intent-due', '消息投递超时（结果未知，账本记待核实） 参与者=%s 错误=%s', target.id, error)
          if (recordFailures) await svc.recordOutgoingDeliveryFailure(story, target.id, message, String(error), 'unknown')
        } else {
          svc.noteEndpointOutbound({ kind: 'participant-user', id: target.id }, false, String(error), address)
          svc.report('error', story, 'intent-due', '消息投递失败 参与者=%s 错误=%s', target.id, error)
          if (recordFailures) await svc.recordOutgoingDeliveryFailure(story, target.id, message, `transport-failed: ${String(error)}`, failureStatus)
        }
      }
    }
    return delivered
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function confirmOutgoingDeliveries(svc: any, story: InterludeStory, delivered: OutgoingMessageDraft[], splitSegment = false) {
    const generation = svc.deliveryGeneration(story.id)
    const confirmed: ScriptEntry[] = []
    for (const message of delivered) {
      const entry = await runStorySerialized(svc, story.id, async () => {
        if (svc.databaseResetting || svc.deliveryGeneration(story.id) !== generation) return undefined
        const participant = await svc.getParticipant(message.participantId)
        if (!participant) return undefined
        const now = new Date()
        const content = message.quoteMessageId ? '[主角引用了此前的一条消息]' : message.content
        const existing = message.scriptEvent?.scriptEntryId ? await svc.successfulDeliveryEntry(story.id, message) : undefined
        if (svc.databaseResetting || svc.deliveryGeneration(story.id) !== generation) return undefined
        const persistedEntry = existing ?? await svc.appendEntry(story.id, {
          kind: 'character-message', actor: 'character', content,
          occurredAt: now.toISOString(),
          metadata: deliveryEntryMetadata(message, message.quoteMessageId
            ? { quoteMessageId: message.quoteMessageId, quoteTransport: true }
            : splitSegment ? { splitSegment: true } : {}),
        }, now, participant.id)
        if (message.scriptEvent) await svc.updateScriptDeliveryOutcome(story.id, message.scriptEvent, 'delivered', now)
        if (!existing) await svc.recordCharacterMessage(participant, now)
        if (!existing && message.automaticDelivery) await svc.recordAutomaticDelivery(story.id, participant.id, message.automaticDelivery, now)
        const splitIntents = message.laterSegments?.length && message.scriptEvent
          ? await svc.dbGet('interlude_intent', { storyId: story.id, participantId: participant.id, type: 'split-message' }) as NarrativeIntent[] : []
        let delay = 0
        for (const [index, segment] of (message.laterSegments ?? []).entries()) {
          delay += svc.typingDelayMilliseconds(segment)
          const sendAt = new Date(now.getTime() + delay)
          if (splitIntents.some(intent => {
            const ref = restoreMessageEvent(intent.payload, segment)
            return ref && ref.scriptEntryId === message.scriptEvent?.scriptEntryId && ref.commitId === message.scriptEvent?.commitId
              && ref.eventId === message.scriptEvent?.eventId && ref.bubbleIndex === index + 1
          })) continue
          await svc.appendIntent(story.id, {
            type: 'split-message', summary: 'The character is still typing the next message segment.',
            notBefore: sendAt.toISOString(),
            payload: {
              content: segment, visibleMessage: true, userInitiated: message.userInitiated === true,
              ...scriptEventPayload(message, index + 1),
              ...(message.automaticDelivery ? { automaticDelivery: message.automaticDelivery } : {}),
            },
          }, now, participant.id)
          svc.scheduleDueIntentWake(story.id, sendAt)
        }
        return persistedEntry
      })
      if (entry) confirmed.push(entry)
    }
    return confirmed
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function recordOutgoingDeliveryFailure(svc: any, 
    story: InterludeStory,
    participantId: string,
    message: OutgoingMessageDraft,
    reason: string,
    status: 'failed' | 'pending' | 'unknown' = 'failed',
  ) {
    await runStorySerialized(svc, story.id, async () => {
      const now = new Date()
      if (message.scriptEvent) await svc.updateScriptDeliveryOutcome(story.id, message.scriptEvent, status, now, clip(reason, 500))
      // A recovery attempt must not turn a transient endpoint outage into a
      // terminal failure or add a second fictional transcript entry. The
      // durable ledger stays pending/unknown and the process-local backoff
      // decides when the next compensation pass retries it. unknown additionally
      // retains any proactive quota occupancy until verified (设计 §7.4).
      if (status === 'pending' || status === 'unknown') return
      await svc.appendEntry(story.id, {
        kind: 'outgoing-delivery-failed', actor: 'system',
        content: `未投递的主角消息（仍未发送，不能视为用户已收到）：${clip(message.content, svc.config.runtime.maxMessageCharacters)}`,
        occurredAt: now.toISOString(),
        metadata: {
          status: 'failed', participantId, reason: clip(reason, 500),
          ...(message.scriptEvent ?? {}),
          ...(message.automaticDelivery ? { automaticDelivery: message.automaticDelivery } : {}),
        },
      }, now, participantId)
    })
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function updateScriptDeliveryOutcome(svc: any, 
    storyId: string,
    reference: Pick<ScriptDeliveryReference, 'commitId' | 'eventId'> & {
      scriptEntryId?: number
      segmentIndex?: number
      bubbleIndex?: number
    },
    status: ScriptDeliverySegmentStatus,
    at: Date,
    reason?: string,
  ) {
    if (!Number.isSafeInteger(reference.scriptEntryId)) return
    try {
      const entry = (await svc.dbGet('interlude_script_entry', { id: reference.scriptEntryId }))[0] as ScriptEntry | undefined
      if (!entry || entry.storyId !== storyId || entry.metadata?.commitId !== reference.commitId) return
      const normalized: ScriptDeliveryReference = {
        commitId: reference.commitId,
        eventId: reference.eventId,
        scriptEntryId: reference.scriptEntryId!,
        segmentIndex: reference.segmentIndex ?? reference.bubbleIndex ?? 0,
      }
      const actions = updateScriptDeliveryActions(entry.metadata?.deliveryActions, normalized, status, at, reason)
      const metadata: Record<string, any> = { ...entry.metadata, ...(actions ? { deliveryActions: actions } : {}) }
      if (actions) {
        await svc.dbSet('interlude_script_entry', { id: entry.id }, { metadata })
        const action = actions.find(item => isRecord(item) && item.commitId === normalized.commitId && item.eventId === normalized.eventId)
        const segment = action?.segments.find(item => item.index === normalized.segmentIndex)
        if (segment && typeof svc.reportCommunicationEvent === 'function') {
          try {
            svc.reportCommunicationEvent('standard', segment.status === 'unknown' || segment.status === 'failed' ? 'warn' : 'info',
              { id: storyId }, 'intent-due', '投递结果更新 状态=%s 原因=%s', {
                type: 'delivery-result', storyId, commitId: normalized.commitId, eventId: normalized.eventId,
                segmentIndex: normalized.segmentIndex, targetId: action?.participantId, endpointId: action?.endpointId,
                ...persistedDesktopProcessingContext(metadata), domain: 'transport',
                reasonCode: segment.reason || `delivery-${segment.status}`, status: segment.status,
              }, segment.status, segment.reason || 'platform-result')
          } catch { /* A log failure preserves both the ledger and follow-up settlement. */ }
        }
      }
      const delivered = Array.isArray(metadata.deliveryActions)
        ? metadata.deliveryActions.find(action => isRecord(action) && action.commitId === reference.commitId && action.eventId === reference.eventId && action.status === 'delivered') : undefined
      const events = Array.isArray(metadata.scriptEvents) ? metadata.scriptEvents : []
      const event = events.find(item => isRecord(item) && item.commitId === reference.commitId && item.eventId === reference.eventId && item.kind === 'outgoing-message')
      if (delivered && event?.participantId && metadata.followUpResolutionEventId !== event.eventId) {
        const resolutions = normalizeFollowUpResolutions(event.metadata?.followUpResolutions)
        const commitment = normalizeFollowUpCommitment(event.metadata?.followUpCommitment, toDate(entry.occurredAt) ?? at)
        if (resolutions.length || commitment) {
          await svc.applyFollowUpResolutions(storyId, event.participantId, resolutions,
            { seen: false, reply: { mode: 'immediate', content: event.content } }, at, event.eventId)
          if (commitment) await svc.appendFollowUpCommitment(await svc.getStory(storyId), event.participantId, commitment, entry.id, at, event.eventId)
          await svc.dbSet('interlude_script_entry', { id: entry.id }, {
            metadata: { ...metadata, followUpResolutionEventId: event.eventId },
          })
        }
      }
    } catch (error) {
      // M6.1 is observational: a failed ledger write must not prevent the
      // caller from scheduling remaining bubbles or executing platform actions.
      svc.reportStandalone('warn', '投递账本记录失败 故事=%s 事件=%s；保留平台结果并继续原投递链 错误=%s', storyId, reference.eventId, error)
    }
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function recordPlatformDeliveryOutcome(svc: any, 
    storyId: string,
    reference: ScriptDeliveryReference,
    // 审计 P1-3：放宽允许 'pending'——桌面动作代理 ambiguous（结果未知）时使用。
    // 平台动作（local-media/native-face）不在补偿回放的 kind 过滤内，记 pending
    // 不会触发自动重发，账本如实反映"可能已发送"而非谎报 failed。
    status: ScriptDeliverySegmentStatus,
    reason?: string,
  ) {
    const task = captureStoryTask(svc, storyId)
    try {
      await svc.serial(storyId, async () => {
        if (task.contentCurrent()) await svc.updateScriptDeliveryOutcome(storyId, reference, status, new Date(), reason)
      })
    } catch (error) {
      svc.reportStandalone('warn', '平台行动结果记录失败 故事=%s 事件=%s segment=%d 错误=%s', storyId, reference.eventId, reference.segmentIndex, error)
    }
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function resolveLiteralQuoteMessageId(svc: any, storyId: string, participantId: string, content: string) {
    const quoted = literalQuoteText(content)
    if (!quoted) return undefined
    const entries = await svc.dbGet('interlude_script_entry', { storyId, participantId }, {
      limit: 120, sort: { occurredAt: 'desc' },
    }) as ScriptEntry[]
    const matched = entries.find(entry => entry.content.trim() === quoted && targetableMessageId(entry.metadata?.messageId))
    return matched ? targetableMessageId(matched.metadata?.messageId) : undefined
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function recordAutomaticDelivery(svc: any, 
    storyId: string,
    participantId: string,
    delivery: NonNullable<OutgoingMessageDraft['automaticDelivery']>,
    now: Date,
  ) {
    try {
      // urge 状态写与摘要合并都是对 story.state 的读-改-写,必须与 receive/advance
      // 的串行回合互斥——旧快照覆盖会打乱 nextAdvanceAt 或回退摘要列表。serial 外
      // 的调用点(分段投递/投递确认)整段入队;serial 内的调用点(advanceUnlocked)
      // 直接执行——serial 不可重入,再排队会死锁。P3.2：联系确认(acknowledgeUrge)
      // 随 burst 退役，送达不再改变调度状态。
      const run = async () => {
        if (delivery.sourceEntryId) {
          const entry = (await svc.dbGet('interlude_script_entry', { storyId, id: delivery.sourceEntryId }))[0] as ScriptEntry | undefined
          const actions = entry?.metadata?.deliveryActions
          if (Array.isArray(actions)) {
            const speech = actions.filter(action => isRecord(action) && action.participantId === participantId && action.eventKind === 'outgoing-message')
            if (speech.length && speech.some(action => action.status !== 'delivered')) return
          }
        }
        const story = await svc.getStory(storyId)
        const state = decodeStoryState(story.state)
        const summary = clip(delivery.summary, 240).trim()
        if (!summary) return
        const prior = state.automaticDeliverySummaries ?? []
        const same = prior.find(item => item.participantId === participantId && item.sourceEntryId === delivery.sourceEntryId)
        const next: AutomaticDeliverySummary = {
          participantId, summary: same ? mergeDeliverySummary(same.summary, summary) : summary,
          ...(delivery.sourceEntryId ? { sourceEntryId: delivery.sourceEntryId } : {}),
          deliveredAt: now.toISOString(),
        }
        const retained = prior.filter(item => item !== same)
        retained.push(next)
        await svc.dbSet('interlude_story', { id: story.id }, {
          state: encodeStoryState({ ...state, automaticDeliverySummaries: retained.slice(-6) }), updatedAt: now,
        })
      }
      if (svc.inSerial(storyId)) await run()
      else await svc.serial(storyId, run)
    } catch (error) {
      // A summary is a projection, never a prerequisite for remaining bubbles.
      svc.reportStandalone('warn', '自动通信摘要记录失败，保留原文与投递主链 错误=%s', error)
    }
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function splitOutgoingMessage(svc: any, content: string) {
    return splitVisibleReplyBubbles(content, {
      separator: svc.config.runtime.messageSeparator?.trim() || '<sep/>',
      splitEnabled: svc.config.runtime.splitReplyMessages !== false,
      newlineAsSeparator: svc.config.runtime.convertNewlineToSeparator === true,
    })
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function typingDelayMilliseconds(svc: any, nextSegment: string) {
    const baseSeconds = Math.max(0, svc.config.runtime.typingBaseDelaySeconds ?? 1)
    const charactersPerSecond = Math.max(1, svc.config.runtime.typingCharactersPerSecond ?? 8)
    const maximumSeconds = Math.max(baseSeconds, svc.config.runtime.typingMaxDelaySeconds ?? 12)
    const nominal = Math.min(maximumSeconds, baseSeconds + Math.ceil(nextSegment.length / charactersPerSecond))
    const jitter = Math.max(0, Math.min(0.5, Number(svc.config.runtime.typingJitterRatio ?? 0.3) || 0))
    const factor = jitter ? 1 + (Math.random() * 2 - 1) * jitter : 1
    return Math.max(250, Math.min(maximumSeconds * Time.second, Math.round(nominal * factor * Time.second)))
  }


/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function firstMessageTypingHoldMs(svc: any, content: string, requestStartedAt: Date) {
    const floor = svc.typingDelayMilliseconds(content)
    const elapsed = Math.max(0, Date.now() - requestStartedAt.getTime())
    return Math.max(0, floor - elapsed)
  }


/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function sendGroupMessage(svc: any, story: InterludeStory, channelId: string, content: string, replyToMessageId?: string, session?: Session, endpointId?: string, correlation?: Pick<OutgoingMessageDraft, 'traceId' | 'processingId'>, control?: { shouldCancel: () => boolean; settled: Map<number, GroupDeliveryResult['segmentOutcomes'][number]['status']>; onDelivered: (index: number, content: string) => void }) {
    const task = captureStoryTask(svc, story.id)
    const targetGroupId = normalizeGroupId(channelId)
    // Keep the adapter-facing channel spelling (for example `group:100`)
    // while using the normalized id only for endpoint/config matching.
    const transportGroupId = String(channelId ?? '')
    const segments = svc.splitOutgoingMessage(content)
    const failed = (reason: string) => ({
      deliveredSegments: [] as string[], complete: false,
      segmentOutcomes: segments.map((segment: string, index: number) => ({ index, content: segment, status: 'failed' as const, reason })),
    })
    try {
      await svc.ensureEndpointRegistry()
    } catch (error) {
      svc.report('warn', story, 'user-message', '群消息端点注册表不可用 群频道=%s 错误=%s', targetGroupId, error)
      return failed('endpoint-registry-unavailable')
    }
    const endpointRows: EndpointRow[] = Array.isArray(svc.endpointRows) ? svc.endpointRows : []
    let fallbackAddress: { platform: string, selfId: string, endpointId?: string } | undefined
    let selectedEndpoint: EndpointRow | undefined
    let endpointOwner: { kind: 'story-role' | 'group', id: string } = { kind: 'story-role', id: story.id }
    let bot: any
    const sessionGroupId = normalizeGroupId(String((session as any)?.guildId ?? session?.channelId ?? ''))
    const sessionBot = (!sessionGroupId || sessionGroupId === targetGroupId) && session?.bot && typeof (session.bot as any).sendMessage === 'function'
      ? session.bot
      : undefined
    const sessionMatchesEndpoint = (endpoint: EndpointRow | undefined) => !!endpoint && !!sessionBot
      && String(session?.selfId ?? '') === String(endpoint.selfId)
      && (session?.platform === endpoint.platform || isOneBotPlatform(String(session?.platform ?? '')) && isOneBotPlatform(endpoint.platform))
    const observeSessionEndpoint = (endpoint: EndpointRow | undefined) => {
      if (!endpoint || !session || !sessionMatchesEndpoint(endpoint)) return
      const previous = svc.endpointStates.get(endpoint.id) ?? freshEndpointState(endpoint.id)
      if (!previous.connection.online) svc.setEndpointState(endpoint.id, stateAfterConnection(previous, true))
    }
    if (endpointId) {
      // Explicit group routing may only select this story's role endpoint or
      // the registered endpoint belonging to the requested group.
      const endpoint = endpointRows.find(row => row.id === endpointId && (
        row.ownerKind === 'story-role' && row.ownerId === story.id
        || row.ownerKind === 'group' && normalizeGroupId(row.groupId ?? row.ownerId) === targetGroupId
      ))
      if (!endpoint) {
        svc.report('warn', story, 'user-message', '群消息指定端点无效或不属于目标群 端点=%s 群频道=%s', endpointId, targetGroupId)
        return failed('endpoint-not-found')
      }
      // The incoming group Session is a current connection observation. Apply
      // it before the delivery gate so the first immediate reply is not
      // rejected as offline merely because lifecycle events arrived later.
      observeSessionEndpoint(endpoint)
      const gated = svc.endpointForDelivery(endpoint.id, endpoint.ownerKind === 'group'
        ? { kind: 'group', id: endpoint.ownerId }
        : { kind: 'story-role', id: story.id })
      if (gated.reason || !gated.row) return failed(gated.reason ?? 'endpoint-not-deliverable')
      selectedEndpoint = gated.row
      endpointOwner = selectedEndpoint.ownerKind === 'group'
        ? { kind: 'group', id: selectedEndpoint.ownerId }
        : { kind: 'story-role', id: story.id }
      fallbackAddress = { platform: gated.row.platform, selfId: gated.row.selfId, endpointId: gated.row.id }
      bot = svc.ctx.bots.find((item: any) => String(item.selfId) === String(endpoint.selfId)
        && (item.platform === endpoint.platform || isOneBotPlatform(item.platform) && isOneBotPlatform(endpoint.platform)))
    } else {
      // A private session that authored a cross-group action is not a valid
      // group transport session. Use it only when its channel is this group.
      // Older adapters do not expose guildId/channelId on the synthetic
      // session passed to this helper. Preserve their live-session routing;
      // when a channel is known, only reuse it for the same target group.
      fallbackAddress = svc.endpointAddressSync({ platform: story.platform, selfId: story.selfId }, { kind: 'story-role', id: story.id })
      if (fallbackAddress.endpointId) {
        const candidate = endpointRows.find(row => row.id === fallbackAddress!.endpointId)
        observeSessionEndpoint(candidate)
        const gated = svc.endpointForDelivery(fallbackAddress.endpointId, { kind: 'story-role', id: story.id })
        if (gated.reason || !gated.row) return failed(gated.reason ?? 'endpoint-not-deliverable')
        selectedEndpoint = gated.row
      }
      const sessionMatches = !selectedEndpoint || sessionMatchesEndpoint(selectedEndpoint)
      bot = sessionBot && sessionMatches ? sessionBot : svc.ctx.bots.find((item: any) => String(item.selfId) === String(fallbackAddress!.selfId)
        && (item.platform === fallbackAddress!.platform || isOneBotPlatform(item.platform) && isOneBotPlatform(fallbackAddress!.platform)))
    }
    if (!bot && !svc.desktopDeliveryHandler) {
      svc.report('warn', story, 'user-message', '没有可用机器人账号投递群消息 群频道=%s 故事平台=%s 故事账号=%s', targetGroupId, story.platform, story.selfId)
      return failed('bot-not-found')
    }
    let allDelivered = true
    const deliveredSegments: string[] = []
    const segmentOutcomes: GroupDeliveryResult['segmentOutcomes'] = []
    for (const [index, segment] of segments.entries()) {
      const settled = control?.settled.get(index)
      if (settled) {
        segmentOutcomes.push({ index, content: segment, status: settled })
        if (settled === 'delivered') deliveredSegments.push(segment)
        else allDelivered = false
        continue
      }
      if (!task.taskCurrent() || control?.shouldCancel()) {
        allDelivered = false
        segmentOutcomes.push({ index, content: segment, status: 'failed', reason: 'delivery-generation-obsolete' })
        continue
      }
      const outgoing = index === 0 && replyToMessageId
        ? [h('quote', { id: replyToMessageId }), segment]
        : segment
      try {
        const address = selectedEndpoint
          ? { platform: selectedEndpoint.platform, selfId: selectedEndpoint.selfId }
          : { platform: fallbackAddress!.platform, selfId: fallbackAddress!.selfId }
        if (svc.desktopDeliveryHandler) {
          const outcome = await svc.desktopDeliveryHandler({
            participantId: `group:${targetGroupId}`,
            selfId: address.selfId,
            platform: address.platform,
            channelId: transportGroupId,
            kind: 'group',
            content: segment,
            ...(correlation?.traceId ? { traceId: correlation.traceId } : {}),
            ...(correlation?.processingId ? { processingId: correlation.processingId } : {}),
            ...(index === 0 && replyToMessageId ? { quoteMessageId: replyToMessageId } : {}),
            ...(selectedEndpoint?.id ? { endpointId: selectedEndpoint.id } : {}),
          })
          if (!outcome.ok) {
            // 审计 P1-2：transportTimeout 标记必须随异常上抛——否则 catch 按
            // 确定失败记 segment，账本写 failed 而非 pending（消息可能已发出）。
            if (outcome.transportTimeout === true) throw Object.assign(new Error(outcome.error || 'typ-0 群消息投递结果未知。'), { transportTimeout: true })
            throw new Error(outcome.error || 'typ-0 群消息投递失败。')
          }
        } else {
          const receipt = await withTransportTimeout(bot.sendMessage(transportGroupId, outgoing), 'group-send')
          if (Array.isArray(receipt) && !receipt.length) throw new Error('Group transport returned no message receipt.')
        }
        if (task.contentCurrent()) control?.onDelivered(index, segment)
        // 状态按实际投递的 bot 归因——实时群会话优先时归因到 session.bot，
        // 否则归因到解析出的兜底账号（多角色下不再错刷 fallback）。
        const actualBot = (bot as unknown as { platform?: string, selfId?: string } | undefined)
        if (task.contentCurrent()) svc.noteEndpointOutbound(endpointOwner, true, 'group-delivered', { platform: String(actualBot?.platform ?? address.platform), selfId: String(actualBot?.selfId ?? address.selfId) })
        deliveredSegments.push(segment)
        segmentOutcomes.push({ index, content: segment, status: 'delivered' })
      }
      catch (error) {
        allDelivered = false
        // 审计 P1-2：结果未知（echo 超时/桥关闭）→ reason 加 transport-timeout:
        // 前缀，账本映射据此记 pending 交补偿（与私聊路径同语义）；确定失败原样。
        const unknownOutcome = (error as { transportTimeout?: boolean })?.transportTimeout === true
        segmentOutcomes.push({ index, content: segment, status: 'failed', reason: (unknownOutcome ? 'transport-timeout:' : '') + clip(String(error), 500) })
        const address = selectedEndpoint
          ? { platform: selectedEndpoint.platform, selfId: selectedEndpoint.selfId }
          : { platform: fallbackAddress!.platform, selfId: fallbackAddress!.selfId }
        if (task.contentCurrent()) svc.noteEndpointOutbound(endpointOwner, false, String(error), address)
        if (unknownOutcome) svc.report('warn', story, 'user-message', '群消息投递超时（结果未知，等待补偿确认） 群频道=%s 错误=%s', targetGroupId, error)
        else svc.report('error', story, 'user-message', '群消息投递失败 群频道=%s 错误=%s', targetGroupId, error)
      }
    }
    return { deliveredSegments, complete: allDelivered, segmentOutcomes }
  }

