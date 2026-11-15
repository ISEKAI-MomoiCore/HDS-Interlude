/** OneBot history transport and payload normalization live on the platform side.
 * The service delegates here; narrative modules remain platform-neutral. */
import { h } from 'koishi'
import { endpointAccountKey, channelContextMetadata } from '../endpoints'
import { isOneBotPlatform, isBotOnlineStatus, isEnabledAccount, normalizeAccountId, normalizeGroupId,
  groupIdStorageVariants, onebotTargetId, withTransportTimeout, extractSessionAudioSources, extractSessionImageSources } from '../session-platform'
import { mentionsBot } from '../chat-artifacts'
import { groupCollectionDropReason, resolveGroupDimensions } from '../group-dimensions'
import { toDate } from '../narrative-normalizers'
import { captureStoryTask } from '../task-lifecycle'

type Row = Record<string, any>
function responseData(response: any) {
  if (response?.retcode != null && Number(response.retcode) !== 0) throw new Error(`OneBot retcode=${response.retcode}`)
  if (response?.status && response.status !== 'ok') throw new Error(`OneBot status=${response.status}`)
  return response?.data ?? response
}

/** A Bot owns an account, never a guild. Prefer registered group addressing,
 * then the story's role account; ambiguous accounts remain explicit diagnostics. */
function selectBot(svc: any, story: Row, groupId: string, metadata: Row = {}) {
  const rows: Row[] = svc.endpointRows ?? []
  const groups = rows.filter(r => r.ownerKind === 'group' && isOneBotPlatform(r.platform)
    && normalizeGroupId(r.groupId || r.channelId || r.ownerId) === groupId)
  const roles = rows.filter(r => r.ownerKind === 'story-role' && r.ownerId === story.id && isOneBotPlatform(r.platform))
  const roleKeys = new Set(roles.filter(r => r.enabled).map(r => endpointAccountKey(r.platform, r.selfId)))
  const eligibleGroups = groups.filter(r => r.enabled && (!roles.length || roleKeys.has(endpointAccountKey(r.platform, r.selfId))))
  const hintedId = metadata.channel?.endpointId
  const hintedSelf = normalizeAccountId(metadata.selfId)
  let endpoint = hintedId ? eligibleGroups.find(r => r.id === hintedId) : undefined
  if (!endpoint && hintedSelf) endpoint = eligibleGroups.find(r => normalizeAccountId(r.selfId) === hintedSelf)
  if (!endpoint && !hintedId && !hintedSelf) endpoint = eligibleGroups.length === 1 ? eligibleGroups[0]
    : eligibleGroups.find(r => normalizeAccountId(r.selfId) === normalizeAccountId(story.selfId))
  if (groups.length && !endpoint) return { reason: 'group-endpoint-disabled-or-ambiguous' }
  const selfId = normalizeAccountId(endpoint?.selfId || hintedSelf || (roleKeys.size === 1 ? roles.find(r => r.enabled)?.selfId : story.selfId))
  if (roles.length && !roleKeys.has(endpointAccountKey('onebot', selfId))) return { reason: 'story-role-account-disabled-or-ambiguous' }
  if (!isEnabledAccount(svc.config.onebot.botAccounts, selfId)) return { reason: 'account-not-allowed' }
  const bots = (svc.ctx.bots ?? []).filter((bot: any) => isOneBotPlatform(bot.platform)
    && normalizeAccountId(bot.selfId) === selfId && isBotOnlineStatus(bot.status))
  const bot = bots.find((b: any) => b.platform === (endpoint?.platform || story.platform))
    ?? (bots.length === 1 ? bots[0] : undefined)
  if (!bot) return { reason: 'bot-offline-missing-or-ambiguous' }
  if (typeof bot.internal?._request !== 'function') return { reason: 'group-history-unavailable' }
  return { bot, endpoint }
}

function cqDecode(value: string) {
  return value.replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&#44;/g, ',').replace(/&amp;/g, '&')
}
function segments(message: Row): Row[] {
  if (Array.isArray(message.message)) return message.message
  const raw = String(message.message ?? message.raw_message ?? '')
  const result: Row[] = []
  let at = 0
  for (const match of raw.matchAll(/\[CQ:([a-z_]+)(?:,([^\]]*))?\]/gi)) {
    if (match.index! > at) result.push({ type: 'text', data: { text: cqDecode(raw.slice(at, match.index)) } })
    const data: Row = {}
    for (const field of (match[2] ?? '').split(',')) {
      const eq = field.indexOf('=')
      if (eq > 0) data[field.slice(0, eq)] = cqDecode(field.slice(eq + 1))
    }
    result.push({ type: match[1].toLowerCase(), data }); at = match.index! + match[0].length
  }
  if (at < raw.length) result.push({ type: 'text', data: { text: cqDecode(raw.slice(at)) } })
  return result
}
function describe(message: Row, selfId: string) {
  const parts = segments(message)
  const content = parts.map(part => {
    const data = part.data ?? {}
    if (part.type === 'text') return h.text(String(data.text ?? '')).toString()
    if (part.type === 'at') return h('at', { id: data.qq }).toString()
    if (part.type === 'image') return h('img', { src: data.url, file: data.file }).toString()
    if (part.type === 'record') return h('audio', { file: data.file, src: data.url }).toString()
    if (part.type === 'forward') return h('forward', { id: data.id }).toString()
    return ''
  }).join('')
  const session: any = { content, selfId }
  return { message, replyId: String(parts.find(p => p.type === 'reply')?.data?.id ?? ''),
    text: parts.filter(p => p.type === 'text').map(p => String(p.data?.text ?? '')).join('').trim().slice(0, 60),
    evidence: { mentionedBot: mentionsBot(session), quotedBot: false,
      audioCount: extractSessionAudioSources(session).length, imageCount: extractSessionImageSources(session).length,
      hasForwardNode: /<forward[\s>]/i.test(content) } }
}

export async function offlineGroupCatchup(svc: any) {
  if (svc.desktopBridgeActive || svc.databaseResetting || svc.disposed || svc.desktopRuntimePhase === 'paused' || !svc.config.onebot?.enabled) return
  const rules = (svc.config.onebot.groupChats ?? []).filter((rule: Row) => rule.enabled !== false && resolveGroupDimensions(rule).collectionScope !== 'off')
  if (!rules.length) return
  await svc.ensureEndpointRegistry()
  for (const rule of rules) {
    const groupId = normalizeGroupId(rule.groupId)
    if (!groupId) continue
    try {
      const story = await svc.getCanonicalStory()
      if (!story || !svc.canHandleStory(story) || story.status !== 'active') continue
      const task = captureStoryTask(svc, story.id)
      if (!task.taskCurrent()) continue
      // 历史元数据同时存在裸数字与前缀形态，水位查询必须与其余群查询一致，
      // 否则遗留形态的群会命中过旧水位或被静默跳过。
      const query = { storyId: story.id, kind: 'group-message', 'metadata.groupId': { $in: groupIdStorageVariants(groupId) } }
      const options = { limit: 1, sort: { occurredAt: 'desc' } }
      const entries = await svc.dbGet('interlude_script_entry', query, options)
      if (!task.taskCurrent()) continue
      const watermark = toDate(entries[0]?.occurredAt)
      if (!watermark) continue
      const selected = selectBot(svc, story, groupId, entries[0]?.metadata)
      if (!selected.bot) {
        svc.reportStandaloneOperation('diagnostic', 'warn', '群消息离线补拉跳过 群=%s 原因=%s', groupId, selected.reason)
        continue
      }
      const { bot, endpoint } = selected
      const selfId = normalizeAccountId(bot.selfId)
      const request = async (action: string, data: Row, timeoutMs = 30_000) => responseData(await withTransportTimeout(bot.internal._request(action, data), 'group-history-fetch', timeoutMs))
      const response = await request('get_group_msg_history', { group_id: onebotTargetId(groupId), count: 50 })
      if (!task.taskCurrent()) continue
      const messages: Row[] = Array.isArray(response?.messages) ? response.messages.slice(-50) : []
      const inGroup = (msg: Row) => msg.group_id == null || normalizeGroupId(String(msg.group_id)) === groupId
      const byId = new Map(messages.filter(inGroup).map(msg => [String(msg.message_id ?? ''), msg]))
      const candidates = messages.filter(msg => inGroup(msg) && Number.isFinite(msg.time) && msg.time > 0
        && msg.time * 1000 > watermark.getTime() && normalizeAccountId(msg.sender?.user_id ?? msg.user_id) !== selfId)
        .sort((a, b) => a.time - b.time).map(msg => describe(msg, selfId))
      const unresolved = new Map<string, typeof candidates>()
      for (const item of candidates) {
        if (!item.replyId || !groupCollectionDropReason(rule, item.evidence)) continue
        const quoted = byId.get(item.replyId)
        if (quoted) item.evidence.quotedBot = inGroup(quoted) && normalizeAccountId(quoted.sender?.user_id ?? quoted.user_id) === selfId
        else {
          const sameReply = unresolved.get(item.replyId) ?? []
          sameReply.push(item); unresolved.set(item.replyId, sameReply)
        }
      }
      // At most 50 unique references from this page, four requests in flight,
      // outside the story serial queue. Repeated reply IDs share one lookup.
      const replyIds = [...unresolved.keys()]
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(4, replyIds.length) }, async () => {
        while (cursor < replyIds.length && task.taskCurrent()) {
          const id = replyIds[cursor++]
          try {
            const quoted = await request('get_msg', { message_id: onebotTargetId(id) }, 5_000)
            if (!task.taskCurrent()) return
            const own = !!quoted && inGroup(quoted) && normalizeAccountId(quoted.sender?.user_id ?? quoted.user_id) === selfId
            for (const item of unresolved.get(id)!) item.evidence.quotedBot = own
          } catch {
            svc.reportStandaloneOperation('diagnostic', 'debug', '群消息离线引用归属未确认 群=%s 引用=%s', groupId, id)
          }
        }
      }))
      if (!task.taskCurrent() || !candidates.length) continue
      await svc.serial(story.id, async () => {
        if (!task.taskCurrent()) return
        const current = await svc.getCanonicalStory()
        const currentRule = svc.config.onebot?.groupChats?.find((r: Row) => r.enabled !== false && normalizeGroupId(r.groupId) === groupId)
        if (!task.taskCurrent() || !svc.config.onebot?.enabled || current?.id !== story.id || current.status !== 'active'
          || !svc.canHandleStory(current) || !currentRule) return
        const fresh = await svc.dbGet('interlude_script_entry', query, options)
        if (!task.taskCurrent()) return
        const currentBot = selectBot(svc, current, groupId, fresh[0]?.metadata)
        if (currentBot.bot !== bot || currentBot.endpoint?.id !== endpoint?.id) return
        const latestWatermark = toDate(fresh[0]?.occurredAt) ?? watermark
        const missed = candidates.filter(item => item.message.time * 1000 > latestWatermark.getTime()
          && !groupCollectionDropReason(currentRule, item.evidence))
        if (!missed.length) return
        const latest = new Date(missed[missed.length - 1].message.time * 1000)
        const earliest = new Date(missed[0].message.time * 1000)
        const excerpts = missed.slice(0, 5).map(item => `${String(item.message.sender?.card || item.message.sender?.nickname || item.message.sender?.user_id || '未知')}：${item.text || '[非文本]'}`)
        await svc.appendEntry(story.id, { kind: 'group-message', actor: 'user',
          content: `[群聊离线摘要] 插件离线期间 ${groupId} 群有 ${missed.length} 条新消息（${earliest.toISOString()} ~ ${latest.toISOString()}）。摘要：${excerpts.join('；')}。完整记录可通过聊天记录查询获取。`,
          occurredAt: latest.toISOString(), metadata: { groupId, selfId, offlineCatchup: true, messageCount: missed.length,
            ...(endpoint ? { channel: channelContextMetadata(endpoint as any, { groupId, channelId: `group:${groupId}` }) } : {}) },
        }, latest)
        svc.reportStandaloneOperation('standard', 'info', '群消息离线补拉完成 群=%s 补入=%d条 水位=%s', groupId, missed.length, latestWatermark.toISOString())
      })
    } catch (error) {
      svc.reportStandaloneOperation('diagnostic', 'warn', '群消息离线补拉失败 群=%s 错误=%s', groupId, error)
    }
  }
}
