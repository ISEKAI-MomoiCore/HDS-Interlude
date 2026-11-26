/** 入站门控管线：私聊与群聊两条入口——门序（canHandle → findStory/autoCreate）、
 * 内容提取与投影、桥接重放去重（内存键 + 队列内二次查库双防线）、密度计数
 * （在去重之后，重放不双计）、mention-only 证据路径（未提及图片落库不入队）、
 * 端点入站解析（队列外）与状态刷新、节奏同步提升、打断标记置位（兜底清理
 * 在 finally）、串行块内落库、入队缓冲（经宿主委托）。群消息的自动推进暂停
 * 不在此执行——移至 flushGroupTurnUnlocked 门通过后（density-decay 死锁修复）。
 *
 * 平台假设（QQ/OneBot 特有，多通道适配的分歧点——完整清单见
 * docs/PLATFORM_ASSUMPTIONS_INBOUND.md）：去重键含 platform:selfId:messageId(+channelId)、
 * 群号归一化（group:/guild: 前缀）、mention 判定、OneBot 平台族判定、
 * 合并转发读取、SILK 语音假设。
 *
 * P8-S5 自 service.ts 迁出（2026-10-29）。红线：serial 块内容
 * 逐字搬运（锁相位不变）；seenIncomingMessages/inboundSeq/interruptedTypingParticipants/
 * contextDensity 容器留守 service 经宿主引用读写；缓冲冲刷（bufferGroupMessage/
 * flushGroupTurn/bufferUserNarrative）留守叙事核心，入口经宿主委托入队。 */
import type { Session } from 'koishi'
import { sessionGroupId, normalizeGroupId, isOneBotPlatform, normalizeAccountId, maskQqIds, extractSessionImageSources, extractSessionAudioSources } from './session-platform'
import { describeGroupAttachments } from './session-platform'
import { quotesBot } from './narrative-normalizers'
import { mentionsBot, describeQuotedMessage, formatGroupSpeaker, groupMessageRef, targetableMessageId } from './chat-artifacts'
import { mergeForwardContent } from './session-platform'
import { toDate } from './narrative-normalizers'
import { extractSessionVoiceCount } from './session-platform'
import { normalizeGroupDisplayName } from './chat-artifacts'
import type { InterludeStory } from './types'
import { Time } from 'koishi'
import { extractSessionFileFacts } from './session-platform'
import { groupImageRefsForStorage } from './session-platform'
import { resolveGroupDimensions, groupCollectionDropReason } from './group-dimensions'
import type { InterludeParticipant, NarrativeIntent } from './types'

/** P8-S5 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function receiveGroup(svc: any, session: Session, receivedAt?: Date) {
    if (!receivedAt) receivedAt = toDate((session as any).timestamp) ?? new Date()
    if (svc.databaseResetting || !svc.canHandleGroupSession(session)) return false
    const groupId = sessionGroupId(session)
    const rule = svc.groupRule(groupId)
    if (!rule) return false
    const mentionedBot = mentionsBot(session)
    const quotedBot = quotesBot(session)
    const audioSources = extractSessionAudioSources(session)
    let imageSources = extractSessionImageSources(session)
    // I-6b 采集范围（维度 1，先于故事查找）：off 不采集；directed 仅定向消息
    // （@、引用她的消息、语音、图片、合并转发——转发内嵌的媒体在外壳层
    // 不可见，转发节点本身即定向模态）继续走落库为证据；background 全采集。
    // 旧 responseMode 在此派生。
    const dimensions = resolveGroupDimensions(rule)
    // Issue #18：采集门丢弃此前完全静默——部署者无法区分"消息没到 Koishi"与
    // "到了但被门丢弃"（上游桥载荷缺 at 段时尤其难排查）。diagnostic 级记录
    // 判定依据与脱敏预览（maskQqIds 遮数字但保留 at 元素结构，足以分辨
    // "at 缺失"与"at 存在但 id 不符"）。审计修正：走 reportStandaloneOperation
    // （经 verbosity 门控，与其它诊断行一致），群号同样脱敏。
    const dropAtCollectionGate = (reason: string): false => {
      const logging = svc.config.logging
      const preview = logging?.logMessageContent ? maskQqIds(String(session.content ?? '')).slice(0, Math.min(60, logging.previewLength ?? 60)) : undefined
      svc.reportStandaloneOperation?.('diagnostic', 'debug', '群消息被采集门丢弃（先于故事查找，不落库） 群=%s 原因=%s @机器人=%s 引用=%s 音频=%d 图片=%d'
        + (preview === undefined ? '' : ' 预览=%s'),
        maskQqIds(groupId), reason, mentionedBot, quotedBot, audioSources.length, imageSources.length, ...(preview === undefined ? [] : [preview]))
      return false
    }
    const hasForwardNode = /<forward[\s>]/i.test(String(session.content ?? ''))
    const collectionDrop = groupCollectionDropReason(rule, {
      mentionedBot, quotedBot, audioCount: audioSources.length, imageCount: imageSources.length, hasForwardNode,
    })
    if (collectionDrop) return dropAtCollectionGate(collectionDrop)
    let story = await svc.findStory(session)
    if (!story && svc.config.runtime.autoCreate) story = await svc.createStory(session, undefined, receivedAt)
    if (!story || story.status !== 'active') return false
    const now = receivedAt
    const senderId = normalizeAccountId(session.userId)
    const senderName = await svc.groupSenderName(groupId, senderId, session)
    const quote = describeQuotedMessage(session, story.setting.character.name)
    const forward = await svc.readForward(session)
    const messageContent = forward ? mergeForwardContent(describeGroupAttachments(session.content), forward.content) : describeGroupAttachments(session.content)
    // 合并转发内的图片并入本轮视觉输入与群聊历史引用
    if (forward?.imageRefs?.length) imageSources = Array.from(new Set([...imageSources, ...forward.imageRefs]))
    // 表情包采集（锁外旁路）：不参与叙事判定，mention-only 群同样可采集。
    void svc.tryHarvestStickers(session, 'group', imageSources, rule)
    // 桥接幂等（群聊侧，与私聊 receive 对齐）：桌面超时-重放会把同一群消息
    // 再投递一次；平台+频道+messageId 命中即直接确认，不重复落库与入队。
    const groupDedupeKey = `${session.platform}:${session.selfId ?? story.selfId}:${session.channelId}:${session.messageId}`
    if (session.messageId && svc.seenIncomingMessages.has(groupDedupeKey)) {
      svc.reportOperation('diagnostic', 'debug', story, 'user-message', '桥接重放去重命中（群聊），跳过重复消息 键=%s', groupDedupeKey)
      return true
    }
    // 密度计数在去重之后：桌面超时-重放的同一条群消息不得双计（审计细节①）。
    svc.contextDensity.record(story.id, receivedAt!.getTime())

    // M1a 端点层：群消息同样先在队列外解析（群端点），命中才标注与刷状态。
    const groupSource = { platform: session.platform, selfId: String(session.selfId ?? story.selfId), groupId: String(groupId), channelId: String(session.channelId ?? '') }
    const groupChannelMeta = await svc.channelMetadataFor(groupSource, { groupId: groupSource.groupId, channelId: groupSource.channelId })
    await svc.touchEndpointStateInbound(groupSource)
    const accepted = await svc.serial(story.id, async () => {
      if (session.messageId && (svc.seenIncomingMessages.has(groupDedupeKey)
        || (await svc.dbGet('interlude_script_entry', { storyId: story.id, kind: 'group-message',
          'metadata.groupId': groupId, 'metadata.messageId': session.messageId,
          $or: [{ 'metadata.selfId': String(session.selfId ?? story.selfId) }, { 'metadata.selfId': { $exists: false } }] }, { limit: 1 })).length)) return undefined
      const current = await svc.getStory(story!.id)
      const entry = await svc.appendEntry(current.id, {
        kind: 'group-message', actor: 'user', content: messageContent,
        occurredAt: now.toISOString(),
        metadata: {
          groupId, senderId, senderName, channelId: session.channelId, messageId: session.messageId, selfId: String(session.selfId ?? story.selfId),
          ...(groupChannelMeta ? { channel: groupChannelMeta } : {}),
          ...(quote ? { quote } : {}),
          ...(imageSources.length ? {
            imageCount: imageSources.length,
            groupImageRefs: groupImageRefsForStorage(imageSources),
          } : {}),
        },
      }, now)
      // 自动推进暂停不在接收路径执行（density-decay 死锁修复）：mention-only
      // 未 @ 的证据消息与意愿门稍后跳过的批次都不会有模型回合接管，若在此
      // 重置 nextAdvanceAt，活跃群的每条消息都会把推进推回未来，永不触发。
      // 暂停改由 flushGroupTurnUnlocked 在两道门通过、真正进入主叙事时执行。
      return entry
    })
    if (!accepted) return true
    if (session.messageId) svc.rememberIncomingMessage(groupDedupeKey)
    // An unmentioned image is evidence-only when the immediate trigger keeps
    // mention-only semantics. It has now been written to the script, but must
    // not itself consume willingness, cooldown, or a main-model call. Voice
    // follows the same evidence-only path unless the group keeps
    // audioAlwaysTriggers on (default), in which case it stays queued and
    // bypasses the gates downstream.
    const audioAlwaysTriggers = rule.audioAlwaysTriggers !== false
    // I-6b 即时触发（维度 2）：mention 档下非 @ 且非（音频×必定触发）的已采集
    // 消息（图片/引用/背景采集的普通文本）仅作证据，不入队不耗门；
    // willingness 档全部入队，交 flush 层意愿门与冷却。
    if (dimensions.immediateTrigger === 'mention' && !mentionedBot && !(audioSources.length && audioAlwaysTriggers)) return true
    const messageId = targetableMessageId(session.messageId)
    svc.bufferGroupMessage(story, rule, session, {
      senderId, senderName, speaker: formatGroupSpeaker(senderName, senderId),
      ...(messageId ? { messageId, messageRef: groupMessageRef(accepted.id) } : {}),
        ...(quote ? { quote } : {}),
        content: messageContent, occurredAt: now, direction: 'user',
      }, mentionedBot, quotedBot, audioSources, imageSources, groupChannelMeta?.endpointId)
    svc.reportOperation('summary', 'info', story, 'user-message', '收到群聊消息 群=%s 发送者=%s', maskQqIds(groupId), maskQqIds(senderId))
    return true
  }


/** P8-S5 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function receive(svc: any, session: Session, receivedAt?: Date) {
    // 双时钟修复：优先平台消息时间（秒级），缺失时用本机接收时间——此前
    // Koishi 原生路径恒用 Date.now()，与桌面路径（平台 frame.time）混排序。
    if (!receivedAt) receivedAt = toDate((session as any).timestamp) ?? new Date()
    if (svc.databaseResetting) return false
    // Check before find/create so an unauthorized QQ can neither trigger the
    // model nor create a persistent story by merely sending a private message.
    if (!svc.canHandleSession(session)) return false
    let story = await svc.findStory(session)
    if (!story && svc.config.runtime.autoCreate) story = await svc.createStory(session, undefined, receivedAt)
    if (!story || story.status !== 'active') {
      svc.reportStandaloneOperation('diagnostic', 'debug', '私聊未处理：故事不存在或已暂停 平台=%s 机器人ID=%s 用户ID=%s', session.platform, session.selfId, session.userId)
      return false
    }
    let participant = await svc.findParticipant(session, story)
    if (participant) {
      // A whitelist row can be edited after this QQ first joined the shared
      // story. Refresh the current branch before composing its model context.
      // ensureParticipant performs no write when nothing actually changed.
      participant = await svc.ensureParticipant(story, session, receivedAt, participant)
    } else if (svc.config.runtime.autoCreate || svc.sharedStoryConfig.autoEnrollParticipants) {
      participant = await svc.ensureParticipant(story, session)
    }
    if (!participant || participant.status !== 'active') {
      svc.reportOperation('diagnostic', 'debug', story, 'user-message', '私聊未处理：参与者不存在或已暂停 用户ID=%s', session.userId)
      return false
    }
    if (!session.content?.trim() && !extractSessionVoiceCount(session)) return false
    // 桥接幂等：同一条消息（平台+messageId）近期已处理过则直接确认，不再入队
    // 叙事——这是桌面超时-重放双写双回的插件侧防线。
    const dedupeKey = `${session.platform}:${session.selfId ?? story.selfId}:${session.userId}:${session.messageId}`
    if (session.messageId && svc.seenIncomingMessages.has(dedupeKey)) {
      svc.reportOperation('diagnostic', 'debug', story, 'user-message', '桥接重放去重命中，跳过重复消息 键=%s', dedupeKey)
      return true
    }
    svc.contextDensity.record(story.id, receivedAt!.getTime())
    const observed = svc.describeVisionEvent(session)
    if (!observed.content.trim() && !observed.sources.length && !extractSessionVoiceCount(session) && !extractSessionFileFacts(session).length) return false
    // 表情包采集（锁外旁路）：私聊开关开启时即时暂存对方发送的表情图片。
    void svc.tryHarvestStickers(session, 'private', observed.sources)

    // Mark the relationship synchronously before waiting for the story queue.
    // This lets an arriving message invalidate a model request that is about
    // to persist, and lets a due split segment stop before transport begins.
    svc.signalIncomingInterruption(story, participant)
    const forward = await svc.readForward(session)
    const userInput = svc.describeUserEvent(story, session, forward)
    // M1a 端点层（解析在故事队列外）：注册表命中才标注通道上下文/刷新端点状态，
    // 未迁移或陌生账号不产生任何变化——单平台行为与现状一致。
    const inboundSource = { platform: session.platform, selfId: String(session.selfId ?? story.selfId), userId: String(session.userId ?? participant.userId ?? '') }
    const channelMeta = await svc.channelMetadataFor(inboundSource, { userId: inboundSource.userId })
    await svc.touchEndpointStateInbound(inboundSource)
    // M2 §1.3：来源必须在回合创建后写入。此前这里先 recordSource、后
    // bufferUserNarrative，TurnEngine 找不到尚未创建的 turn，首条消息的
    // source 会静默丢失，导致首轮通道标注和后续路由上下文为空。
    const inboundResolution = await svc.resolveInboundEndpointFor(inboundSource)
    const inboundEndpointId = inboundResolution?.userEndpoint?.id ?? inboundResolution?.roleEndpoint?.id ?? 'unknown'
    svc.inboundSeq += 1
    const inboundReceivedSeq = svc.inboundSeq
    svc.reportOperation('summary', 'info', story, 'user-message', '收到参与者私聊消息 参与者=%s', maskQqIds(participant.id))
    if (svc.config.logging?.logMessageContent) {
      svc.reportOperation('diagnostic', 'info', story, 'user-message', '用户消息内容：%s', userInput.content.slice(0, svc.config.logging.previewLength))
    }

    let accepted: { story: InterludeStory; participant: InterludeParticipant; now: Date; superseded: NarrativeIntent[] } | 'duplicate' | undefined
    try {
      accepted = await svc.serial(story.id, async () => {
      if (session.messageId && (svc.seenIncomingMessages.has(dedupeKey)
        || (await svc.dbGet('interlude_script_entry', { storyId: story.id, participantId: participant!.id, kind: 'user-message',
          'metadata.platform': session.platform, 'metadata.messageId': session.messageId,
          $or: [{ 'metadata.selfId': String(session.selfId ?? story.selfId) }, { 'metadata.selfId': { $exists: false } }] }, { limit: 1 })).length)) {
        // 早退路径也必须清打断标志——cancelPendingOutgoingMessages 不执行时,
        // 标志泄漏会让该参与者的分段/延迟消息永久 pending 且阻塞全局意图
        svc.interruptedTypingParticipants.delete(participant!.id)
        return 'duplicate' as const
      }
      const current = await svc.getStory(story.id)
      const currentParticipant = await svc.getParticipant(participant!.id)
      if (!currentParticipant || currentParticipant.status !== 'active') {
        svc.interruptedTypingParticipants.delete(participant!.id)
        return undefined
      }
      const now = receivedAt
      const incomingParticipant = await svc.recordIncomingMessage(currentParticipant, now)
      const superseded = await svc.cancelPendingOutgoingMessages(
        current.id,
        incomingParticipant.id,
        now,
        svc.config.runtime.cancelDelayedRepliesOnUserMessage,
      )
      await svc.appendEntry(current.id, {
        kind: 'user-message', actor: 'user', content: userInput.content,
        occurredAt: now.toISOString(), metadata: {
          platform: session.platform, messageId: session.messageId, selfId: String(session.selfId ?? story.selfId), personId: incomingParticipant.personId,
          ...(channelMeta ? { channel: channelMeta } : {}),
          ...(userInput.sources.length ? { imageCount: userInput.sources.length } : {}),
          ...(userInput.audioSources.length ? { audioCount: userInput.audioSources.length } : {}),
          ...(userInput.quote ? { quote: userInput.quote } : {}),
        },
      }, now, incomingParticipant.id)
      // Messages are persisted at arrival. The model request itself is
      // debounced below, so a burst can become one coherent writing turn.
      try {
        await svc.pauseAutomaticAdvanceAfterUserMessage(current.id, now)
      } catch (error) {
        svc.report('warn', current, 'user-message', '消息已落库，自动推进暂停更新失败：%s', error)
      }
      return { story: current, participant: incomingParticipant, now, superseded }
    })
    } finally {
      // 串行块抛异常时兜底清打断标志——cancel 不执行,标志泄漏会永久阻塞分段/意图
      svc.interruptedTypingParticipants.delete(participant!.id)
    }
    if (accepted === 'duplicate') return true
    if (!accepted) return false
    if (session.messageId) svc.rememberIncomingMessage(dedupeKey)
    svc.bufferUserNarrative(accepted.story, accepted.participant, session, accepted.now, accepted.superseded, userInput.content, userInput.sources, userInput.audioSources, userInput.quote, inboundEndpointId)
    svc.turnEngine.recordSource(accepted.participant.id, inboundEndpointId, inboundReceivedSeq)
    if (userInput.sources.length) {
      svc.reportOperation('standard', 'info', accepted.story, 'user-message', '当前事件包含图片附件 数量=%d 原生识图=%s', userInput.sources.length, svc.config.model.vision?.enabled ? '开启' : '关闭')
    }
    if (userInput.audioSources.length) {
      svc.reportOperation('standard', 'info', accepted.story, 'user-message', '当前事件包含语音附件 数量=%d 原生音频=%s', userInput.audioSources.length, svc.audioConfig.enabled ? '开启' : '关闭')
    }
    svc.reportOperation('standard', 'info', accepted.story, 'user-message', '用户回合已入队 参与者=%s 旧计划打断记录=%d', accepted.participant.id, accepted.superseded.length)
    return true
  }


/** P8-S5 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function groupSenderName(svc: any, groupId: string, userId: string, session: Session) {
    const account = svc.userAccountRule(userId)
    const author = (session as any).author as { nick?: unknown, name?: unknown, username?: unknown } | undefined
    const observed = normalizeGroupDisplayName(account?.label, author?.nick, session.username, author?.name, author?.username)
    if (observed) return observed

    const key = `${normalizeGroupId(groupId)}:${userId}`
    const cached = svc.groupMemberNameCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.name
    const pending = svc.groupMemberNameLookups.get(key) ?? svc.lookupGroupMemberName(key, groupId, userId, session.selfId)
    svc.groupMemberNameLookups.set(key, pending)
    try { return await pending || userId }
    finally { svc.groupMemberNameLookups.delete(key) }
  }


/** P8-S5 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function lookupGroupMemberName(svc: any, cacheKey: string, groupId: string, userId: string, selfId: string) {
    const bot = svc.ctx.bots.find((item: any) => String(item.selfId) === String(selfId)
      && (item.platform === 'onebot' || isOneBotPlatform(item.platform))) as any
    if (typeof bot?.getGuildMember !== 'function') return ''
    try {
      const member = await bot.getGuildMember(normalizeGroupId(groupId), userId)
      const name = normalizeGroupDisplayName(member?.nick, member?.name, member?.user?.name)
      if (!name) return ''
      svc.groupMemberNameCache.set(cacheKey, { name, expiresAt: Date.now() + 12 * Time.hour })
      return name
    } catch {
      return ''
    }
  }

