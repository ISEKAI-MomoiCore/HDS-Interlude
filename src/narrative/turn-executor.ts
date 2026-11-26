import { captureStoryTask } from '../task-lifecycle'
import { liveNarrativeIntents, consumedLiveIntentIds } from '../script/intent-lifecycle'
import { findPrivateOutgoingMessageEvent } from '../script/commit-builder'
import { messageEventReference } from '../script/contract'
import { platformActionReference } from '../script/delivery-ledger'
import { formatBufferedUserMessages, narrativeCursor } from '../narrative-normalizers'
import { isContextDisposedError } from '../narrator'
import type { IndexedQuotedMessageContext, NarrativeAudio, NarrativeInteraction, NarrativeIntent, OutgoingMessageDraft, ScriptEntry } from '../types'
import type { BufferedUserMessage } from '../turn-engine'
import type { ScriptCommitDraft } from '../script/contract'

/** D3a（解耦设计 §6）：私聊回合叙事编排——自 service.ts 迁出（行为不变，
 * D0 顺序特征测试为证）。service.flushBufferedNarrative 保留同名薄委托。
 * 平台交互全部经 PlatformAdapter 端口（svc.platformPort）；本文件不直接
 * 出现平台函数名。 */
export async function executePrivateNarrativeTurn(svc: any, key: string, revision: number) {
    if (svc.databaseResetting) return
    if (svc.desktopRuntimePhase === 'paused') {
      // 已触发的定时器句柄若不清掉,resume 的 rescheduleTimers 会因 turn.timer
      // 非空而跳过补排,遗留消息重新孤儿化
      const pausedTurn = svc.turnEngine.getTurn(key)
      if (pausedTurn) pausedTurn.timer = undefined
      return
    }
    // One shared story has one narrator at a time. If another relationship is
    // currently waiting on the provider, keep this batch intact and retry
    // shortly instead of taking an inconsistent cursor snapshot.
    const turn = svc.turnEngine.beginFlush(key, revision, (retryKey: string, retryRevision: number): void => void svc.flushBufferedNarrative(retryKey, retryRevision))
    if (!turn) return
    const requestId = revision
    turn.inFlightRequestId = requestId
    const batch: BufferedUserMessage[] = turn.messages.splice(0)
    // issue #5（死锁加固）：try 原先从快照阶段才开始——splice 与 try 之间的
    // 任何异常（日志/簿记）会让 endFlush 永不执行，turn 永久 in-flight 且批次
    // 已被消费：后续消息持续入队但永不进入模型调度，直到重启。try 提前到
    // splice 之后，finally 的 endFlush 覆盖全程；空批次早退交由 finally 收尾。
    try {
    // issue #5：此处原先传 { id } as InterludeStory 假桩给 reportOperation——
    // writeReport 读 setting.character.name 即抛 TypeError。改为 standalone：
    // 该日志本就是回合级诊断，不需要 story 上下文。
    svc.reportStandalone('debug', '写请求开始 故事=%s 参与者=%s 请求=%d 批次=%d', turn.storyId, turn.participantId, requestId, batch.length)
    // Keep the endpoint set for this exact debounce batch separate from the
    // broader turn source snapshot.  M4's batch-multi-endpoint annotation
    // must only fire when messages in this request came from multiple
    // endpoints; a turn may otherwise accumulate historical sources.
    turn.activeBatchEndpointIds = [...new Set(batch
      .map((message: any) => message.endpointId)
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0))]
    turn.activeBatchMessageCount = batch.length
    if (!batch.length) return
      // Snapshot only the lightweight decision inputs under the story lock.
      // The network request stays outside it, so a new user message can be
      // recorded immediately and invalidate this request when appropriate.
      const snapshot = await svc.serial(turn.storyId, async () => {
        const story = await svc.getStory(turn.storyId)
        const participant = await svc.getParticipant(turn.participantId)
        if (!participant || participant.status !== 'active' || story.status !== 'active') return undefined
        const now = new Date()
        const due = liveNarrativeIntents(await svc.dueIntents(story.id, now))
          .filter((intent: any) => !intent.participantId || intent.participantId === participant.id)
        return { story, participant, from: narrativeCursor(story, now), now, due }
      })
      if (!snapshot) {
        // 批次已被 splice 消费，早退同样要排重试（入站消息已先落库）。
        // 参与者已暂停时不排——重试会由到期路径消化成暂停期的一次投递；
        // 恢复后由用户新消息自然驱动。
        const participantNow = await svc.getParticipant(turn.participantId).catch((): undefined => undefined)
        if (participantNow?.status === 'active') {
          await svc.scheduleNarrativeRetry(turn.storyId, turn.participantId, new Date()).catch((): undefined => undefined)
        } else {
          svc.reportStandalone('info', '参与者已暂停或不存在，跳过为其排叙事重试 参与者=%s', turn.participantId)
        }
        return
      }

      const userMessage = formatBufferedUserMessages(batch)
      // P3' Jev 门控：被动推进先查后写（TRUE 才考据；FALSE/不可用直通）。
      await svc.jevGatePassiveResearch(snapshot.story, userMessage, snapshot.now)
      const turnQueryEmbedding = userMessage?.trim() && svc.semanticTurnEmbeddingEnabled()
        ? await svc.embedText(userMessage.trim().slice(0, svc.config.model.embedding?.maxInputCharacters ?? 4_000))
        : undefined
      const quotedMessages: IndexedQuotedMessageContext[] = batch.flatMap((message: any, index: number) => message.quote
        ? [{ ...message.quote, messageIndex: index + 1 }]
        : [])
      // D2：平台素材与能力经 PlatformAdapter 端口（适配器按句柄解析会话）。
      const stickerCatalog = await svc.platformPort?.stickerCatalog(turn.latestHandle, turnQueryEmbedding) ?? []
      const chatCapabilities = svc.platformPort?.privateCapabilities(turn.latestHandle)
      const imageSources = Array.from(new Set(batch.flatMap((message: any) => message.imageSources))).slice(0, 3)
      const loadedImages = await svc.platformPort?.loadImages(snapshot.story, imageSources, turn.latestHandle) ?? []
      const visionMode = svc.config.model.vision?.mode ?? 'native'
      const visualObservations = visionMode === 'sidecar'
        ? await svc.describeCurrentImages(snapshot.story, loadedImages, userMessage)
        : undefined
      const images = visionMode === 'native' ? loadedImages : []
      // Voice records ride the native-audio channel: SnowLuma transcodes each
      // record server-side and the main model receives it as input_audio.
      const audioSources = Array.from(new Set(batch.flatMap((message: any) => message.audioSources)))
      const audio = await svc.platformPort?.loadAudio(snapshot.story, audioSources, turn.latestHandle) ?? []
      // If another message arrived while an image was being downloaded, put
      // this batch back and let the newer revision compose one combined event.
      if (turn.nextRevision !== revision) {
        turn.messages.unshift(...batch)
        return
      }
      const superseded = batch.flatMap((message, index) => message.supersededIntents.map((intent: NarrativeIntent) => {
        const interruption = intent.payload?.privateBubbleInterruption
        return interruption && typeof interruption === 'object'
          ? { ...intent, payload: { privateBubbleInterruption: { ...interruption, triggerMessageIndex: index + 1 } } }
          : intent
      }))
      const timedPrivateReply = svc.usesPrivateBubbleDelay?.('user-message', snapshot.participant) === true
      const early = {
        delivered: false,
        interaction: undefined as NarrativeInteraction | undefined,
        deliveryEntry: undefined as ScriptEntry | undefined,
      }
      // 首条打字下限的基准：叙事请求发起时刻（模型耗时从此时起算）。
      const requestStartedAt = new Date()
      const narrative = await svc.tryDecide(
        snapshot.story, snapshot.participant, 'user-message', snapshot.from, snapshot.now, userMessage, snapshot.due, superseded, undefined, images, audio, chatCapabilities, quotedMessages, stickerCatalog, turnQueryEmbedding, visualObservations,
        timedPrivateReply ? undefined : async (reply: any) => {
          if (early.delivered) return false
          const deliveryEntry = await svc.platformPort?.deliverEarlyReply(snapshot.story, snapshot.participant, turn.latestHandle, turn, requestId, reply, requestStartedAt)
          if (deliveryEntry) {
            early.delivered = true
            early.interaction = reply.interaction
            early.deliveryEntry = deliveryEntry
          }
          return !!deliveryEntry
        },
      )
      const { succeeded, effectiveNow, immediateObservations } = narrative
      const decision = early.delivered && early.interaction
        ? { ...narrative.decision, interaction: early.interaction }
        : narrative.decision
      const sticker = svc.resolveSticker(decision.localMedia, stickerCatalog)
      const nativeFace = sticker ? undefined : svc.resolveNativeFace(decision, chatCapabilities)

      const result = await svc.serial(turn.storyId, async () => {
        if (svc.databaseResetting) return {
          obsolete: true, requeue: false, messages: [] as OutgoingMessageDraft[],
          commit: undefined as ScriptCommitDraft | undefined, scriptEntry: undefined as ScriptEntry | undefined,
        }
        // 暂停期间到达的模型结果同样作废:批次放回,恢复后重排处理——否则暂停
        // 语义被穿透(照常提交剧本、推进游标并向外发消息)。放回后的定时器
        // 由 endFlush 的遗留消息补排保证,暂停态触发会被入口 paused 检查拦下。
        if (svc.desktopRuntimePhase === 'paused') return {
          obsolete: true, requeue: true, messages: [] as OutgoingMessageDraft[],
          commit: undefined as ScriptCommitDraft | undefined, scriptEntry: undefined as ScriptEntry | undefined,
        }
        if (turn.obsoleteRequestIds.has(requestId)) return {
          // User interruptions keep the batch for the next combined turn;
          // administrative invalidation marks the request as discarded so a
          // purge/reset can never resurrect the old input after it completes.
          obsolete: true, requeue: !turn.discardedRequestIds?.has(requestId), messages: [] as OutgoingMessageDraft[],
          commit: undefined as ScriptCommitDraft | undefined, scriptEntry: undefined as ScriptEntry | undefined,
        }
        const current = await svc.getStory(turn.storyId)
        const currentParticipant = await svc.getParticipant(turn.participantId)
        if (!currentParticipant || currentParticipant.status !== 'active' || current.status !== 'active') {
          return {
            obsolete: true, requeue: false, messages: [] as OutgoingMessageDraft[],
            commit: undefined as ScriptCommitDraft | undefined, scriptEntry: undefined as ScriptEntry | undefined,
          }
        }
        const now = new Date()
        // Persist a successful/failed immediate observation only after this
        // request has survived debounce invalidation. This keeps an obsolete
        // result from contaminating the next combined user turn.
        await svc.persistImmediateObservations(current, currentParticipant.id, immediateObservations, 'user-message')
        if (early.delivered && !succeeded) {
          await svc.appendEntry(current.id, {
            kind: 'stream-finalization-failed', actor: 'system',
            content: '主角首条消息已经提前投递，但流式叙事未能完成；本轮不会自动重发可见回复。',
            occurredAt: now.toISOString(), metadata: { requestId },
          }, now, currentParticipant.id)
          await svc.scheduleStreamScriptRecovery(current.id, currentParticipant.id, now)
          svc.reportOperation('standard', 'warn', current, 'user-message', '流式叙事在首条回复后未完成，已保留投递且停止自动重试 参与者=%s 请求=%d', currentParticipant.id, requestId)
          return {
            obsolete: false, requeue: false, messages: [] as OutgoingMessageDraft[],
            commit: undefined as ScriptCommitDraft | undefined, scriptEntry: undefined as ScriptEntry | undefined,
          }
        }
        const commitsFirstReply = succeeded
          && decision.interaction?.reply?.mode === 'immediate'
          && typeof decision.interaction.reply.content === 'string'
          && !!decision.interaction.reply.content.trim()
        const persisted = await svc.persistDecision(current, currentParticipant, {
          ...decision,
          localMedia: sticker ? decision.localMedia : undefined,
          nativeFace: nativeFace ? decision.nativeFace : undefined,
        }, snapshot.from, effectiveNow, true, 'user-message', [], early.delivered, undefined, timedPrivateReply ? {
          startedAt: requestStartedAt,
          handle: turn.latestHandle,
          sourceEndpointId: batch.at(-1)?.endpointId,
          onCommitted: () => { turn.firstMessageCommittedRequestId = requestId },
        } : undefined)
        // committed 标志在持久化成功后才置位——提前置位会让
        // catch 守卫（!== requestId）误判“已提交”，模型成功但落库抛错的回合
        // 既无投递也无重试。
        if (commitsFirstReply) turn.firstMessageCommittedRequestId = requestId
        if (early.deliveryEntry && persisted.commit && decision.interaction?.reply.content) {
          const event = findPrivateOutgoingMessageEvent(
            persisted.commit,
            currentParticipant.id,
            'immediate',
            decision.interaction.reply.content,
            svc.config.runtime.messageSeparator,
          )
          const scriptEvent = event ? messageEventReference(event, 0, persisted.scriptEntry?.id) : undefined
          if (scriptEvent) {
            await svc.dbSet('interlude_script_entry', { id: early.deliveryEntry.id }, {
              metadata: { ...early.deliveryEntry.metadata, ...scriptEvent, earlyStreamingDelivery: true },
            })
            await svc.updateScriptDeliveryOutcome(current.id, scriptEvent, 'delivered', now)
          }
        }
        if (succeeded) {
          await svc.dbSet('interlude_story', { id: current.id }, { cursorAt: effectiveNow, updatedAt: now })
          // 用户回合已成功：取消此前失败遗留的同参与者 pending 重试——用户在
          // 沉默期重发是常态，旧 retry 到期会再跑完整回合并重复投递一条回复。
          await svc.cancelPendingNarrativeRetries(current, currentParticipant.id, now)
          const consumedDueIds = consumedLiveIntentIds(snapshot.due)
          if (consumedDueIds.length) await svc.dbSet('interlude_intent', { id: { $in: consumedDueIds } }, { status: 'completed', updatedAt: now })
        } else {
          await svc.scheduleNarrativeRetry(current.id, currentParticipant.id, now)
        }
        if (succeeded) await svc.scheduleConversationFollowUpsAfterTurn(current.id, effectiveNow, decision.interaction, currentParticipant.id)
        svc.reportOperation('diagnostic', 'debug', current, 'user-message', '写作回合统计 参与者=%s 合并消息=%d 输出通过=%s 待交投递管线的消息=%d', currentParticipant.id, batch.length, succeeded, persisted.messages.length)
        return { obsolete: false, requeue: false, messages: persisted.messages, commit: persisted.commit, scriptEntry: persisted.scriptEntry }
      })

      if (result.obsolete) {
        if (result.requeue) turn.messages.unshift(...batch)
        svc.reportOperation('standard', 'info', snapshot.story, 'user-message', '已丢弃过期主模型结果 参与者=%s 请求=%d 回队消息=%d', snapshot.participant.id, requestId, batch.length)
        return
      }
      svc.reportOperation('diagnostic', 'debug', snapshot.story, 'user-message', '模型结果通过闸门 参与者=%s 请求=%d 批次=%d', snapshot.participant.id, requestId, batch.length)
      if (svc.canHandleParticipant(snapshot.participant)) {
        const delivered = await svc.platformPort?.deliverOutgoing(snapshot.story, result.messages, snapshot.participant, turn.latestHandle, undefined, true, requestStartedAt) ?? []
        // P2 Fix: 主动联系按实际投递结果计数——成功/失败在平台确认后。
        if (svc.pendingProactiveCount > 0) {
          const sent = delivered.length > 0
          for (let i = 0; i < svc.pendingProactiveCount; i++) {
            svc.health?.recordProactive(snapshot.story.id, sent)
          }
          svc.pendingProactiveCount = 0
        }
        if (sticker) {
          await svc.platformPort?.sendSticker(
            snapshot.story,
            turn.latestHandle,
            snapshot.participant.channelId,
            sticker,
            undefined,
            platformActionReference(result.commit, result.scriptEntry?.id, 'local-media', sticker.assetId),
          )
        }
        if (nativeFace) {
          await svc.platformPort?.sendNativeFace(
            snapshot.story,
            turn.latestHandle,
            snapshot.participant.channelId,
            nativeFace,
            undefined,
            platformActionReference(result.commit, result.scriptEntry?.id, 'native-face', nativeFace),
          )
        }
      }
      svc.scheduleCompaction(turn.storyId)
    } catch (error) {
      if (isContextDisposedError(error) || svc.disposed) {
        svc.reportStandalone('debug', '插件重载中，合并写作任务放弃 参与者=%s', turn.participantId)
      } else {
        svc.reportStandalone('warn', '合并写作任务失败：参与者=%s 错误=%s', turn.participantId, error)
        // 持久化抛错不再静默吞批——未 committed 的回合从已落库入站条目排一次重试。
        if (turn.firstMessageCommittedRequestId !== requestId) {
          await svc.scheduleNarrativeRetry(turn.storyId, turn.participantId, new Date()).catch((): undefined => undefined)
        }
      }
    } finally {
      svc.turnEngine.endFlush(key, requestId)
      // 审计 F3：回合结束（引擎已删除空回合）后回收无引用会话（D2 起经
      // 适配器）。可选调用保护无原型的字面量测试宿主（fix#10/issue#5 形态）。
      svc.platformPort?.pruneSessions(32)
    }
  }

import { evaluateWillingnessGate, consumeWillingnessGate, formatWillingnessGateDiagnosis } from '../group-willingness'
import { resolveGroupDimensions } from '../group-dimensions'
import { normalizeGroupVisibleReply } from '../narrative-normalizers'
import { decodeStoryState } from '../story-state'
import { normalizeGroupChatActions } from '../chat-artifacts'
import { findGroupScriptEvent } from '../script/commit-builder'
import type { GroupDeliveryResult } from '../delivery/pipeline'
import type { ExecutableGroupChatActions } from '../service'
import { matchAttentionWords } from './attention-words'
import type { GroupContext, InterludeStory } from '../types'

/** D3b（解耦设计 §6）：群聊回合叙事编排——自 service.ts 迁出（行为不变）。
 * service.flushGroupTurnUnlocked 保留同名薄委托。群平台调用的端口化
 * （群能力/历史图片/群发/群反应）按设计归 D4；本文件现阶段经宿主调用。 */
export async function executeGroupNarrativeTurn(svc: any, key: string, turn: any) {
    const task = captureStoryTask(svc, turn.storyId)
    if (!task.taskCurrent()) return
    // D4：群回合句柄化——平台交互经端口按句柄解析会话。
    // 复审 R4：批次开始时冻结快照——模型在途期间同一群的新批次会更新
    // turn.latestHandle（为下一批服务），当前批次的全部行动（能力/素材/
    // 群发/反应/贴纸/表情）必须使用本批次开始时的账号，防止发送账号漂移。
    const activeHandle = turn.latestHandle
    const channelId = turn.channelId
    turn.timer = undefined
    // Unlike private turns, a group batch stays deliverable after its model
    // request has started. New group messages form the next batch so a busy
    // conversation cannot permanently starve the protagonist of a reply.
    turn.debounceStartedAt = undefined
    const batch = turn.messages.splice(0)
    turn.activeBatchEndpointIds = [...new Set(batch
      .map((message: any) => message.endpointId)
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0))]
    const hasAudio = batch.some((message: any) => message.audioSources?.length)
    const audioTriggers = hasAudio && turn.rule.audioAlwaysTriggers !== false
    const mentionedBot = turn.mentionedBot
    const quotedBot = turn.quotedBot
    turn.mentionedBot = false
    turn.quotedBot = false
    if (!batch.length) {
      svc.bufferedGroupTurns.delete(key)
      return
    }
    let story: InterludeStory
    try {
      story = await svc.getStory(turn.storyId)
    } catch (error) {
      svc.reportStandalone('warn', '群聊回合读取剧本失败，已放弃本批消息 故事=%s 错误=%s', turn.storyId, error)
      if (svc.bufferedGroupTurns.get(key) === turn && !turn.messages.length && !turn.timer) svc.bufferedGroupTurns.delete(key)
      return
    }
    if (story.status !== 'active') {
      if (svc.bufferedGroupTurns.get(key) === turn && !turn.messages.length && !turn.timer) svc.bufferedGroupTurns.delete(key)
      return
    }
    // I-7 观察性命中：批次内容与生效关注词的匹配——仅记录，不接门控。
    try {
      const attentionWords = svc.attentionWordState?.(story)
      if (attentionWords?.effective?.length) {
        const batchContent = batch.map((message: any) => message.content).join('\n')
        svc.recordAttentionHits?.(story.id, turn.groupId, matchAttentionWords(attentionWords, batchContent))
      }
    } catch { /* 尽力而为 */ }
    // F4：显著度记录资格——后台参与 off 的群不累积（其水位与背景永不消费，
    // 积累只会误触发全局瞥视）。维度解析上提供两处记录点与放行日志共用。
    const ruleDimensions = resolveGroupDimensions(turn.rule)
    const salienceEligible = ruleDimensions.backgroundParticipation !== 'off'
    // I-1 会话迟滞 + F5 接线：会话态与私聊忙碌（I-3）并行只读查询；会话态
    // 为 true 时写入 I-4 防抖缓存（在门分支之前——被拦批次同样刷新；仅写
    // true，查询失败默认 false 不毒化缓存）。
    const [sessionActive, attentionBusy] = await Promise.all([
      (svc.groupSessionActive ? svc.groupSessionActive(story.id, turn.groupId) : Promise.resolve(false)).catch((): boolean => false),
      (svc.privateAttentionBusy ? svc.privateAttentionBusy(story.id) : Promise.resolve(false)).catch((): boolean => false),
    ])
    if (sessionActive) svc.noteGroupSessionActive?.(story.id, turn.groupId, true)
    const willingness = evaluateWillingnessGate(svc.groupWillingness.get(key), turn.rule.willingnessPreset, turn.rule.willingnessAuto, decodeStoryState(story.state).lifeRhythm, turn.rule.willingness, {
      now: Date.now(), messageCount: batch.length, content: batch.map((message: any) => message.content).join('\n'),
      mentionedBot, quotedBot, sessionActive, attentionBusy, skipJitter: turn.rule.skipJitter !== false,
    })
    svc.groupWillingness.set(key, willingness.state)
    const tierLabel = formatWillingnessGateDiagnosis(willingness.diagnosis)
    if (!audioTriggers && !willingness.shouldCall) {
      svc.reportOperation('diagnostic', 'debug', story, 'user-message',
        '群聊意愿未触发模型调用 群=%s 分数=%s 概率=%s 原因=%s 档位=%s 跳过=%d', turn.groupId,
        willingness.state.score.toFixed(3), willingness.probability.toFixed(3), willingness.reason, tierLabel,
        willingness.state.skipCount ?? 0)
      // I-2：被门暂缓的批次累积待叙事显著度（回合关联加权），并尝试提前
      // 下一次瞥视（advance）。fire-and-forget，不阻塞 flush 返回。
      if (salienceEligible) {
        svc.recordNarrativeSalience?.(story.id, turn.groupId, { turnRelated: mentionedBot || quotedBot, batchKey: batch.map((message: any) => message.messageId ?? message.occurredAt?.toISOString?.() ?? '').join('|') })
        void Promise.resolve(svc.maybeScheduleSalienceGlance?.(story.id)).catch((): void => undefined)
      }
      if (svc.bufferedGroupTurns.get(key) === turn && !turn.messages.length && !turn.timer) svc.bufferedGroupTurns.delete(key)
      return
    }
    // §3.2 v2.4 修正：回合关联批次（@ 她 / 引用她的消息）同时豁免冷却——
    // 否则放行只越过跳过检查，60 秒冷却仍会拦掉被放行的批次（冷尾悬问的
    // 另一半来源）。冷却是群触发回合的准入检查，不是全局发送限流器。
    const turnRelated = mentionedBot || quotedBot
    if (!audioTriggers && !turnRelated && await svc.groupCooldownActive(story.id, turn.groupId, turn.rule.cooldownSeconds)) {
      svc.reportOperation('diagnostic', 'debug', story, 'user-message', '群聊仍在冷却期，跳过群发言 群=%s', turn.groupId)
      // I-2：冷却拦截同样累积（非关联批次，基础权重）。
      if (salienceEligible) {
        svc.recordNarrativeSalience?.(story.id, turn.groupId, { turnRelated: false, batchKey: batch.map((message: any) => message.messageId ?? message.occurredAt?.toISOString?.() ?? '').join('|') })
        void Promise.resolve(svc.maybeScheduleSalienceGlance?.(story.id)).catch((): void => undefined)
      }
      if (svc.bufferedGroupTurns.get(key) === turn && !turn.messages.length && !turn.timer) svc.bufferedGroupTurns.delete(key)
      return
    }
    // I-6b：放行日志带上解析后三维（采集/触发/后台参与），观测窗可直接读。
    svc.reportOperation('standard', 'info', story, 'user-message', '群聊消息准备进入主叙事 群=%s 模式=%s 维度=%s/%s/%s 意愿=%s 档位=%s', turn.groupId, turn.rule.responseMode,
      ruleDimensions.collectionScope, ruleDimensions.immediateTrigger, ruleDimensions.backgroundParticipation,
      willingness.state.score.toFixed(3), tierLabel)
    // 只有真正进入主叙事的群批次才暂停/重排自动推进（density-decay 死锁修复）：
    // 意愿门或冷却拦截的批次直接返回，nextAdvanceAt 保持原计划，生活按既定
    // 节奏继续。暂停是回合期间的兜底伞——防止 sweep 在模型调用进行中插入
    // 一次自动推进；回合持久化后的 scheduleConversationFollowUpsAfterTurn
    // 会写入真正的下次计划。仍走故事串行锁，保持与旧接收路径同级的原子性。
    try {
      await svc.serial(story.id, () => svc.pauseAutomaticAdvanceAfterUserMessage(story.id, new Date()))
    } catch (error) {
      svc.report('warn', story, 'user-message', '群回合开始前暂停自动推进失败（回合继续）：%s', error)
    }
    try {
      const snapshot = await svc.serial(story.id, async () => {
        const current = await svc.getStory(story.id)
        const groupSnapshot = await svc.groupMessages(current.id, turn.groupId, turn.rule.contextLimit)
        const now = new Date()
        return { story: current, from: narrativeCursor(current, now), now, ...groupSnapshot }
      })
      const groupContext: GroupContext = {
        groupId: turn.groupId, channelId: channelId, label: turn.rule.label,
        purpose: turn.rule.purpose, characterRole: turn.rule.characterRole,
        messages: snapshot.messages,
      }
      const chatCapabilities = svc.platformPort?.groupCapabilities(activeHandle, groupContext.messages)
      const userMessage = batch.map((message: any, index: number) => `[群聊连续消息 ${index + 1}｜${message.speaker}]\n${message.content}`).join('\n\n')
      // I-4 事实性时间线索：给模型的裁决喂更好的证据（"群里安静 3 小时后有人
      // 说话"/"她 10 分钟前发过言"）——事实来自已确认记录，注意力判断归模型。
      const timeCues = await (svc.groupFactualTimeCues ? svc.groupFactualTimeCues(story.id, turn.groupId, snapshot.now, batch) : Promise.resolve(''))
      const annotatedUserMessage = timeCues ? `${timeCues}\n${userMessage}` : userMessage
      const turnQueryEmbedding = svc.semanticTurnEmbeddingEnabled()
        ? await svc.embedText(userMessage.slice(0, svc.config.model.embedding?.maxInputCharacters ?? 4_000))
        : undefined
      const stickerCatalog = await svc.platformPort?.stickerCatalog(activeHandle, turnQueryEmbedding) ?? []
      const currentImageSources = Array.from(new Set(batch.flatMap((message: any) => message.imageSources ?? []))).slice(0, 3)
      const imageSession = batch.find((message: any) => message.imageSession)?.imageSession
      const imageHandle = imageSession ? svc.platformPort?.adoptSession(imageSession) : activeHandle
      const currentImages = await svc.platformPort?.loadImages(snapshot.story, currentImageSources, imageHandle) ?? []
      // 复审 R1：历史图片经端口——宿主函数第四参是 Session，句柄直传会让
      // onebot-file 历史图片回源拿不到 bot（复现模型收到 0 张）。
      const historicalGroupImages = await svc.platformPort?.historicalImages(
        snapshot.story,
        snapshot.imageRefs,
        turn.rule.historicalImageLimit ?? 3,
        imageHandle,
        currentImageSources,
      ) ?? []
      const audio: NarrativeAudio[] = []
      const audioBatchMaxCount = Math.max(1, svc.audioConfig.maxPerMessage * 4)
      const audioBatchMaxBytes = Math.max(1, svc.audioConfig.maxFileSizeMB * 1_000_000 * 4)
      let audioBatchBytes = 0
      for (const message of batch) {
        if (!message.audioSources?.length) continue
        const remaining = audioBatchMaxCount - audio.length
        if (remaining <= 0 || audioBatchBytes >= audioBatchMaxBytes) {
          svc.reportOperation('diagnostic', 'warn', snapshot.story, 'user-message', '群音频批次达到资源上限，剩余音频延后处理 附件上限=%d 字节上限=%d', audioBatchMaxCount, audioBatchMaxBytes)
          continue
        }
        const audioHandle = message.audioSession ? svc.platformPort?.adoptSession(message.audioSession) : undefined
        const loaded = await svc.platformPort?.loadAudio(snapshot.story, message.audioSources, audioHandle, remaining) ?? []
        for (const item of loaded) {
          if (audioBatchBytes + item.base64.length > audioBatchMaxBytes) {
            svc.reportOperation('diagnostic', 'warn', snapshot.story, 'user-message', '群音频批次达到字节上限，剩余音频跳过当前回合 字节上限=%d', audioBatchMaxBytes)
            break
          }
          audio.push({ ...item, id: `group-audio-${audio.length + 1} (${message.speaker})` })
          audioBatchBytes += item.base64.length
        }
      }
      if (hasAudio) svc.reportOperation('standard', audio.length ? 'info' : 'warn', story, 'user-message',
        audioTriggers ? '群音频直接触发主叙事（跳过意愿/冷却），已载入音频=%s；实际发言由剧本决定%s' : '群音频随本轮进入主叙事（本群已关闭语音必定触发），已载入音频=%s%s',
        audio.length,
        audio.length ? '' : '；音频未载入，请检查原生音频开关、格式、大小或读取日志')
      const visionMode = svc.config?.model?.vision?.mode ?? 'native'
       const images = visionMode === 'native' ? currentImages : []
       const historicalImages = visionMode === 'native' ? historicalGroupImages : []
       // P3' Jev 门控（群聊被动推进）：先查后写。
       await svc.jevGatePassiveResearch(snapshot.story, userMessage, snapshot.now)
       const { decision, succeeded } = await svc.tryDecide(snapshot.story, null, 'user-message', snapshot.from, snapshot.now, annotatedUserMessage, [], [], groupContext, images, audio, chatCapabilities, [], stickerCatalog, turnQueryEmbedding, undefined, undefined, historicalImages)
      const chatActions = normalizeGroupChatActions(decision, chatCapabilities, groupContext)
      const sticker = svc.resolveSticker(decision.localMedia, stickerCatalog)
      const nativeFace = sticker ? undefined : svc.resolveNativeFace(decision, chatCapabilities)
      // F3 修正：本回合冻结输入的最大条目 id——批次 messageRef(msg-{entryId})
      // 优先；批次无 messageId 时回退群上下文的 messageRef（同一批消息必然
      // 出现在 groupContext 的最近条目里，其 ref 由落库 id 构造）。
      const messageRefMaxId = (message: any) => {
        const ref = String(message?.messageRef ?? '')
        const id = ref.startsWith('msg-') ? Number(ref.slice(4)) : Number.NaN
        return Number.isSafeInteger(id) ? id : 0
      }
      const frozenMaxEntryId = Math.max(0, ...batch.map(messageRefMaxId), ...(groupContext.messages ?? []).map(messageRefMaxId))
      const result = await svc.serial(story.id, async () => {
        // paused 同样作废:暂停期间到达的群模型结果不再提交/对外发消息(群内容
        // 已在 receiveGroup 落库,不 requeue 也不会丢;空 turn 由 finally 清理)
        if (!task.taskCurrent() || svc.bufferedGroupTurns.get(key) !== turn || !succeeded) return {
          content: '', messages: [] as OutgoingMessageDraft[],
          chatActions: { reactions: [] } as ExecutableGroupChatActions,
          commit: undefined as ScriptCommitDraft | undefined,
          scriptEntry: undefined as ScriptEntry | undefined,
        }
        const current = await svc.getStory(story.id)
        const persisted = await svc.persistDecision(current, null, {
          ...decision,
          messageReactions: chatActions.reactions.map(({ messageRef, reaction }) => ({ messageRef, reaction })),
          localMedia: sticker ? decision.localMedia : undefined,
          nativeFace: nativeFace ? decision.nativeFace : undefined,
        }, snapshot.from, snapshot.now, false, 'user-message')
        const content = normalizeGroupVisibleReply(decision.groupReply, decision.interaction, svc.config.runtime.maxMessageCharacters, svc.config.runtime.messageSeparator, svc.config.runtime.splitReplyMessages !== false)
        await svc.dbSet('interlude_story', { id: current.id }, { cursorAt: snapshot.now, updatedAt: new Date() })
        if (succeeded) await svc.scheduleConversationFollowUpsAfterTurn(current.id, snapshot.now, decision.interaction)
        return { content, messages: persisted.messages, chatActions, sticker, nativeFace, commit: persisted.commit, scriptEntry: persisted.scriptEntry }
      })
      // F3 修正：显著度消费与水位推进移到持久化成功之后（result.scriptEntry
      // 非空 = 批次确实进入剧本；守卫早退/暂停/失效时两者皆 undefined，不再
      // 把未提交的回合记成已处理）。I-2：群触发回合成功 = 批次作为当前事件
      // 进入叙事 → 该群显著度完全消费；水位只推进到冻结输入上界（§7.3 通道
      // 共享覆盖结果）。
      if (result.scriptEntry && task.contentCurrent()) {
        svc.consumeNarrativeSalienceForGroup?.(story.id, turn.groupId)
        void Promise.resolve(svc.advanceGroupBackgroundWatermarkForTurn?.(story.id, turn.groupId, snapshot.now, frozenMaxEntryId)).catch((): void => undefined)
      }
      const platformEntryId = result.scriptEntry?.id
      const completedReactions = task.taskCurrent() && result.chatActions.reactions.length && activeHandle
        ? await svc.platformPort?.executeGroupReactions(
          snapshot.story,
          activeHandle,
          turn.groupId,
          result.chatActions.reactions,
          (reaction: any) => platformActionReference(result.commit, platformEntryId, 'message-reaction', `${reaction.messageRef}:${reaction.reaction}`),
        )
        : 0
      const groupDelivery: GroupDeliveryResult = task.taskCurrent() && result.content
        ? await svc.platformPort?.sendGroupMessage(snapshot.story, channelId, result.content, result.chatActions.replyTo?.messageId, activeHandle, () => !task.taskCurrent())
        : { deliveredSegments: [], complete: false, segmentOutcomes: [] }
      if (groupDelivery.segmentOutcomes.length || groupDelivery.deliveredSegments.length) {
        await svc.serial(story.id, async () => {
          if (!task.contentCurrent()) return
          const current = await svc.getStory(story.id)
          if (!task.contentCurrent()) return
          const now = new Date()
          const groupEvent = result.commit ? findGroupScriptEvent(result.commit) : undefined
          const scriptEvent = groupEvent ? messageEventReference(groupEvent, 0, result.scriptEntry?.id) : undefined
          if (scriptEvent) {
            for (const outcome of groupDelivery.segmentOutcomes) {
              if (!task.contentCurrent()) return
              const status = outcome.status === 'failed'
                && (outcome.reason === 'delivery-generation-obsolete' || outcome.reason?.startsWith('transport-timeout'))
                ? 'pending' : outcome.status
              await svc.updateScriptDeliveryOutcome(current.id, { ...scriptEvent, segmentIndex: outcome.index }, status, now, outcome.reason)
            }
          }
          if (task.contentCurrent() && groupDelivery.deliveredSegments.length) {
            await svc.appendEntry(current.id, {
              kind: 'character-group-message', actor: 'character', content: groupDelivery.deliveredSegments.join('<sep/>'),
              occurredAt: now.toISOString(),
              metadata: {
                groupId: turn.groupId, channelId: channelId,
                ...(scriptEvent ?? {}),
                deliverySegmentIndexes: groupDelivery.segmentOutcomes.filter(item => item.status === 'delivered').map(item => item.index),
                ...(groupDelivery.complete ? {} : { partialDelivery: true, deliveredSegments: groupDelivery.deliveredSegments.length }),
                ...(result.chatActions.replyTo ? { replyTo: result.chatActions.replyTo.messageRef } : {}),
              },
            }, now)
          }
        })
      }
      const stickerDelivered = task.taskCurrent() && result.sticker && activeHandle
        ? await svc.platformPort?.sendSticker(
          snapshot.story,
          activeHandle,
          channelId,
          result.sticker,
          turn.groupId,
          platformActionReference(result.commit, platformEntryId, 'local-media', result.sticker.assetId),
        )
        : false
      const nativeFaceDelivered = task.taskCurrent() && result.nativeFace && activeHandle
        ? await svc.platformPort?.sendNativeFace(
          snapshot.story,
          activeHandle,
          channelId,
          result.nativeFace,
          turn.groupId,
          platformActionReference(result.commit, platformEntryId, 'native-face', result.nativeFace),
        )
        : false
      if (task.contentCurrent() && (groupDelivery.deliveredSegments.length || completedReactions || stickerDelivered || nativeFaceDelivered)) {
        const rhythm = decodeStoryState(story.state).lifeRhythm
        const now = Date.now()
        svc.groupWillingness.set(key, consumeWillingnessGate(svc.groupWillingness.get(key), turn.rule.willingnessPreset, turn.rule.willingnessAuto, rhythm, turn.rule.willingness, now, rhythm?.attention, Math.random, turn.rule.skipJitter !== false))
      }
      // Other conversations use the same delivery ledger as private turns.
      if (task.taskCurrent() && result.messages.length) await svc.platformPort?.deliverOutgoing(snapshot.story, result.messages)
      if (task.taskCurrent()) svc.scheduleCompaction(story.id)
    } catch (error) {
      if (isContextDisposedError(error) || svc.disposed) {
        svc.reportOperation('diagnostic', 'debug', story, 'user-message', '插件重载中，本轮群聊叙事放弃 群=%s', turn.groupId)
        return
      }
      svc.report('error', story, 'user-message', '群聊主叙事失败，保持静默 群=%s 错误=%s', turn.groupId, error)
    }
  }
