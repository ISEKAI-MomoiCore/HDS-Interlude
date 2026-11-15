/** 群能力与动作执行：能力投影（群/私聊可用动作）、群反应执行、贴纸与
 * 原生表情发送（含桌面桥动作代理与结果语义——ambiguous 只记 pending）。
 * 表情语义映射在 qq-face.ts，意愿校准纯函数在 chat-artifacts。
 *
 * P8-S4 自 service.ts 迁出（2026-10-29），行为不变；函数接收宿主（service
 * 或测试假宿主）为第一参数，service 保留同名薄委托。 */
import { h, type Session } from 'koishi'
import { captureStoryTask } from './task-lifecycle'
import type { ChatActionCapabilities, LocalMediaDraft, NarrativeDecision, StickerAsset, StickerCatalogEntry } from './types'
import { normalizeGroupId, groupIdStorageVariants, isOneBotPlatform, onebotTargetId, withTransportTimeout } from './session-platform'
import { calibratedNativeFaceWillingness, normalizeAllowedNativeFaces, normalizeAllowedReactions, normalizeExpressionThreshold, QQ_NATIVE_FACE_IDS, QQ_REACTION_IDS, stickerDeliveryUrl, stickerFileUrl } from './chat-artifacts'
import { clip } from './narrative-normalizers'
import { Time } from 'koishi'
import { relative, resolve, sep } from 'node:path'
import type { ScriptDeliveryReference } from './script/delivery-ledger'
import type { InterludeStory, GroupMessageContext, NativeFaceSemantic } from './types'
import type { ExecutableMessageReaction } from './service'

/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function groupCooldownActive(svc: any, storyId: string, groupId: string, cooldownSeconds: number) {
    if (cooldownSeconds <= 0) return false
    const rows = await svc.dbGet('interlude_script_entry', { storyId,
      kind: { $in: ['character-group-message', 'character-platform-action'] },
      'metadata.groupId': { $in: groupIdStorageVariants(groupId) },
    }, { limit: 1, sort: { occurredAt: 'desc' } })
    const latest = rows.find((entry: any) => ['character-group-message', 'character-platform-action'].includes(entry.kind)
      && normalizeGroupId(String(entry.metadata?.groupId ?? '')) === normalizeGroupId(groupId))
    return !!latest && Date.now() - latest.occurredAt.getTime() < cooldownSeconds * Time.second
  }


/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function groupChatCapabilities(svc: any, session: Session | undefined, messages: GroupMessageContext[]): ChatActionCapabilities | undefined {
    const config = svc.config.chatActions
    if (!config?.enabled || !session || !isOneBotPlatform(session.platform) || !config.platforms?.includes('qq')) return undefined
    if (!messages.some(message => !!message.messageRef && !!message.messageId)) return undefined
    const internal = (session as any).bot?.internal
    const quoteReply = config.quoteReply === true
    const reactions = config.messageReactions === true && typeof internal?.setMsgEmojiLike === 'function'
      ? normalizeAllowedReactions(config.allowedReactions)
      : []
    const nativeFaces = config.nativeFaces === true ? normalizeAllowedNativeFaces(config.allowedNativeFaces) : []
    if (!quoteReply && !reactions.length && !nativeFaces.length) return undefined
    return { platform: 'qq', quoteReply, reactions, nativeFaces, expressionThreshold: normalizeExpressionThreshold(config.expressionThreshold) }
  }


/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function privateChatCapabilities(svc: any, session: Session | undefined): ChatActionCapabilities | undefined {
    const config = svc.config.chatActions
    if (!config?.enabled || !session || !isOneBotPlatform(session.platform) || !config.platforms?.includes('qq')) return undefined
    const nativeFaces = config.nativeFaces === true ? normalizeAllowedNativeFaces(config.allowedNativeFaces) : []
    if (!nativeFaces.length) return undefined
    return { platform: 'qq', quoteReply: false, reactions: [], nativeFaces, expressionThreshold: normalizeExpressionThreshold(config.expressionThreshold) }
  }


/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function executeGroupReactions(svc: any, 
    story: InterludeStory,
    session: Session,
    groupId: string,
    reactions: ExecutableMessageReaction[],
    referenceFor?: (reaction: ExecutableMessageReaction) => ScriptDeliveryReference | undefined,
  ) {
    const task = captureStoryTask(svc, story.id)
    if (!task.taskCurrent()) return 0
    const internal = (session as any).bot?.internal
    let completed = 0
    for (const reaction of reactions.slice(0, 1)) {
      const reference = referenceFor?.(reaction)
      let platformDelivered = false
      try {
        const emojiId = QQ_REACTION_IDS[reaction.reaction]
        if (typeof internal?.setMsgEmojiLike !== 'function') {
          if (reference && task.contentCurrent()) await svc.recordPlatformDeliveryOutcome(story.id, reference, 'cancelled', 'reaction-api-unavailable')
          continue
        }
        await withTransportTimeout(internal.setMsgEmojiLike(reaction.messageId, emojiId, true), 'msg-emoji-like', 10_000)
        platformDelivered = true
        const completedAt = new Date()
        await svc.serial(story.id, async () => {
          if (!task.contentCurrent()) return
          await svc.appendEntry(story.id, {
            kind: 'character-platform-action', actor: 'character',
            content: `主角给群消息 ${reaction.messageRef} 添加了 ${reaction.reaction} 表情回应。`,
            occurredAt: completedAt.toISOString(),
            metadata: {
              platform: 'qq', action: 'message-reaction', groupId, messageRef: reaction.messageRef, reaction: reaction.reaction,
              ...(reference ? { ...reference, deliverySegmentIndex: reference.segmentIndex } : {}),
            },
          }, completedAt)
          if (reference && task.contentCurrent()) await svc.updateScriptDeliveryOutcome(story.id, reference, 'delivered', completedAt)
        })
        completed += 1
        svc.reportOperation('standard', 'info', story, 'user-message', '聊天动作完成 类型=消息表情 群=%s 目标=%s 表情=%s', groupId, reaction.messageRef, reaction.reaction)
      } catch (error) {
        if (reference && task.contentCurrent()) await svc.recordPlatformDeliveryOutcome(
          story.id, reference, platformDelivered ? 'delivered' : 'failed', platformDelivered ? undefined : clip(String(error), 500),
        )
        if (platformDelivered) {
          completed += 1
          svc.report('warn', story, 'user-message', '聊天动作已完成但结果记录不完整 类型=消息表情 群=%s 目标=%s 错误=%s', groupId, reaction.messageRef, error)
        } else {
          svc.report('warn', story, 'user-message', '聊天动作失败 类型=消息表情 群=%s 目标=%s 错误=%s', groupId, reaction.messageRef, error)
        }
      }
    }
    return completed
  }


/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function resolveSticker(svc: any, draft: LocalMediaDraft | undefined, catalog: StickerCatalogEntry[]) {
    if (!draft || typeof draft.assetId !== 'string' || typeof draft.willingness !== 'number' || !catalog.some(item => item.assetId === draft.assetId)) return undefined
    if (normalizeExpressionThreshold(draft.willingness) < svc.expressionThreshold) return undefined
    return svc.stickerById.get(draft.assetId)
  }


/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function resolveNativeFace(svc: any, decision: NarrativeDecision, capabilities: ChatActionCapabilities | undefined) {
    const allowed = new Set(capabilities?.nativeFaces ?? [])
    if (!allowed.size) return undefined
    const draft = decision.nativeFace
    const replyContent = decision.groupReply?.content ?? decision.interaction?.reply?.content ?? ''
    if (draft && allowed.has(draft.semantic) && calibratedNativeFaceWillingness(draft.semantic, draft.willingness, replyContent) >= (capabilities?.expressionThreshold ?? svc.expressionThreshold)) {
      return draft.semantic
    }
    // Legacy bracket labels are parsed out of visible text by the compatibility
    // layer, but have no declared willingness and therefore never bypass the
    // expression threshold.
    return undefined
  }


/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function sendSticker(svc: any, 
    story: InterludeStory,
    session: Session,
    channelId: string,
    asset: StickerAsset,
    groupId?: string,
    reference?: ScriptDeliveryReference,
  ) {
    const task = captureStoryTask(svc, story.id)
    if (!task.taskCurrent()) return false
    const root = resolve(svc.ctx.baseDir, svc.stickerConfig.directory)
    const file = resolve(root, asset.filePath)
    const relativePath = relative(root, file)
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.includes(':')) {
      if (reference && task.contentCurrent()) await svc.recordPlatformDeliveryOutcome(story.id, reference, 'cancelled', 'invalid-sticker-path')
      return false
    }
    let platformDelivered = false
    try {
      if (svc.desktopOnebotActionHandler) {
        // W3（C2-2）桌面模式：经宿主动作代理 send_msg，贴纸以宿主本地文件路径
        // 作 CQ 码（worker 与宿主同机），auto_escape=false 让 CQ 码被解析。
        // 绕开 HTTP 回源的 port:0 问题；独立部署仍走 HTTP 回源。
        const kind = groupId ? 'send_group_msg' : 'send_private_msg'
        const targetId = onebotTargetId(channelId)
        const outcome = await svc.desktopOnebotActionHandler({
          accountKey: 'onebot:' + String(session.selfId ?? ''),
          action: kind,
          params: {
            ...(groupId ? { group_id: targetId } : { user_id: targetId }),
            message: `[CQ:image,file=file:///${file.replace(/\\/g, '/')}]`,
            auto_escape: false,
          },
        })
        // 审计 P1-3：ambiguous（超时/断连，可能已达服务端）必须上抛标记——
        // 否则记确定失败，与 Qzone 路径的 ambiguous 语义不一致。
        if (!outcome.ok) {
          if (outcome.ambiguous === true) throw Object.assign(new Error(outcome.error || `宿主动作代理结果未知：${outcome.errorCode ?? 'unknown'}`), { ambiguous: true })
          throw new Error(outcome.error || `宿主动作代理失败：${outcome.errorCode ?? 'unknown'}`)
        }
      } else {
        // 独立 Koishi：优先经自身 HTTP 服务回源投递（file:/// 指向 Koishi 侧
        // 文件系统，OneBot 实现分容器/分进程部署时读不到——retcode 1200/100
        // 实测）；HTTP URL 由 OneBot 实现主动下载，跨容器/跨机通吃。但宿主
        // 没加载 server 时路由不存在（issue #1：retcode 1200 根因），auto 模式
        // 退回 file:// 本地路径——同容器/同主机的 OneBot 实现
        // （SnowLuma/NapCat 宿主模式）按本地文件读取，不依赖 HTTP。
        svc.registerStickerRoute()
        const serverAvailable = svc.stickerRouteRegistered
        const mode = svc.stickerConfig.deliveryMode ?? 'auto'
        if (mode === 'file' || (mode === 'auto' && !serverAvailable)) {
          const file = resolve(svc.ctx.baseDir, svc.stickerConfig.directory, asset.filePath)
          const fileSrc = stickerFileUrl(file)
          svc.reportOperation('diagnostic', 'debug', story, 'user-message', '表情包经本地文件投递（HTTP 路由不可用） 素材=%s 路径=%s', asset.assetId, fileSrc)
          await withTransportTimeout(session.bot.sendMessage(channelId, h('img', { src: fileSrc })), 'sticker-file-send')
        } else {
          const src = stickerDeliveryUrl(svc.stickerDeliveryBase(), asset.assetId)
          await withTransportTimeout(session.bot.sendMessage(channelId, h('img', { src })), 'sticker-url-send')
        }
      }
      platformDelivered = true
      const now = new Date()
      await svc.serial(story.id, async () => {
        if (!task.contentCurrent()) return
        await svc.appendEntry(story.id, {
          kind: 'character-platform-action', actor: 'character',
          content: `主角发送了本地表情包：${asset.description}`,
          occurredAt: now.toISOString(),
          metadata: {
            platform: session.platform, action: 'local-sticker', assetId: asset.assetId, group: asset.group, animated: asset.animated,
            ...(groupId ? { groupId } : {}),
            ...(reference ? { ...reference, deliverySegmentIndex: reference.segmentIndex } : {}),
          },
        }, now)
        if (reference && task.contentCurrent()) await svc.updateScriptDeliveryOutcome(story.id, reference, 'delivered', now)
      })
      svc.reportOperation('standard', 'info', story, 'user-message', '聊天动作完成 类型=本地表情包 素材=%s', asset.assetId)
      return true
    } catch (error) {
      // 审计 P1-3：ambiguous → 账本记 pending（不自动重发，避免重复贴纸），
      // 确定失败 → failed（原行为）。
      const ambiguous = (error as { ambiguous?: boolean })?.ambiguous === true && !platformDelivered
      if (reference && task.contentCurrent()) await svc.recordPlatformDeliveryOutcome(
        story.id, reference, platformDelivered ? 'delivered' : ambiguous ? 'pending' : 'failed',
        platformDelivered ? undefined : (ambiguous ? 'ambiguous: ' : '') + clip(String(error), 500),
      )
      if (platformDelivered) {
        svc.report('warn', story, 'user-message', '聊天动作已完成但结果记录不完整 类型=本地表情包 素材=%s 错误=%s', asset.assetId, error)
        return true
      }
      if (ambiguous) {
        svc.report('warn', story, 'user-message', '聊天动作结果未知（可能已发送，不自动重试） 类型=本地表情包 素材=%s 错误=%s', asset.assetId, error)
        return false
      }
      svc.report('warn', story, 'user-message', '聊天动作失败 类型=本地表情包 素材=%s 错误=%s', asset.assetId, error)
      return false
    }
  }


/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function sendNativeFace(svc: any, 
    story: InterludeStory,
    session: Session,
    channelId: string,
    semantic: NativeFaceSemantic,
    groupId?: string,
    reference?: ScriptDeliveryReference,
  ) {
    const task = captureStoryTask(svc, story.id)
    if (!task.taskCurrent()) return false
    let platformDelivered = false
    try {
      // OneBot 11 规范 face.id 是 int32；字符串 id 会被严格校验的实现直接
      // 拒绝（"is not a valid segment"）。宽容实现两者都收，统一发数字。
      const faceId = Number(QQ_NATIVE_FACE_IDS[semantic])
      if (svc.desktopOnebotActionHandler) {
        // 桌面合成 session 没有 bot 属性，此前直接 session.bot.sendMessage
        // 必然 TypeError 后被外层 catch 吞掉。改走宿主动作代理（与贴纸同型）。
        const targetId = onebotTargetId(channelId)
        const outcome = await svc.desktopOnebotActionHandler({
          accountKey: 'onebot:' + String(session.selfId ?? ''),
          action: groupId ? 'send_group_msg' : 'send_private_msg',
          params: {
            ...(groupId ? { group_id: targetId } : { user_id: targetId }),
            message: `[CQ:face,id=${faceId}]`,
            auto_escape: false,
          },
        })
        // 审计 P1-3：ambiguous 上抛标记（与贴纸/Qzone 路径同语义）。
        if (!outcome.ok) {
          if (outcome.ambiguous === true) throw Object.assign(new Error(outcome.error || `宿主动作代理结果未知：${outcome.errorCode ?? 'unknown'}`), { ambiguous: true })
          throw new Error(outcome.error || `宿主动作代理失败：${outcome.errorCode ?? 'unknown'}`)
        }
      } else {
        await withTransportTimeout(session.bot.sendMessage(channelId, h('face', { id: faceId })), 'native-face-send')
      }
      platformDelivered = true
      const now = new Date()
      await svc.serial(story.id, async () => {
        if (!task.contentCurrent()) return
        await svc.appendEntry(story.id, {
          kind: 'character-platform-action', actor: 'character', content: `主角发送了 ${semantic} 原生表情。`,
          occurredAt: now.toISOString(), metadata: {
            platform: session.platform, action: 'native-face', semantic, ...(groupId ? { groupId } : {}),
            ...(reference ? { ...reference, deliverySegmentIndex: reference.segmentIndex } : {}),
          },
        }, now)
        if (reference && task.contentCurrent()) await svc.updateScriptDeliveryOutcome(story.id, reference, 'delivered', now)
      })
      svc.reportOperation('standard', 'info', story, 'user-message', '聊天动作完成 类型=原生表情 语义=%s', semantic)
      return true
    } catch (error) {
      // 审计 P1-3：ambiguous → pending（不自动重发）；确定失败 → failed。
      const ambiguous = (error as { ambiguous?: boolean })?.ambiguous === true && !platformDelivered
      if (reference && task.contentCurrent()) await svc.recordPlatformDeliveryOutcome(
        story.id, reference, platformDelivered ? 'delivered' : ambiguous ? 'pending' : 'failed',
        platformDelivered ? undefined : (ambiguous ? 'ambiguous: ' : '') + clip(String(error), 500),
      )
      if (platformDelivered) {
        svc.report('warn', story, 'user-message', '聊天动作已完成但结果记录不完整 类型=原生表情 语义=%s 错误=%s', semantic, error)
        return true
      }
      if (ambiguous) {
        svc.report('warn', story, 'user-message', '聊天动作结果未知（可能已发送，不自动重试） 类型=原生表情 语义=%s 错误=%s', semantic, error)
        return false
      }
      svc.report('warn', story, 'user-message', '聊天动作失败 类型=原生表情 语义=%s 错误=%s', semantic, error)
      return false
    }
  }

