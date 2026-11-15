/** 聊天工件归一化：QQ 表情/贴纸/引用消息/用户报时/时间线计划/群聊动作。
 * P1 自 service.ts 尾部迁出（2026-10-29），行为不变。 */
import { Session } from 'koishi'
import { NarrativeDecision, GroupContext, ScriptEntry, ChatActionCapabilities, ChatReactionName, NativeFaceSemantic, QuotedMessageContext, TimelinePlan, UserReportedTime } from './types'
import { readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extname, resolve } from 'node:path'

import { calendarDayKey, localClockMinutes } from './time'
import { normalizeQQNativeFaceSegments } from './qq-face'
import { normalizeAccountId } from './session-platform'
import { isRecord, clip, chineseClockNumber } from './narrative-normalizers'
import type { ExecutableGroupChatActions } from './service'

const CHAT_REACTION_NAMES: ChatReactionName[] = ['like', 'smile', 'laugh', 'heart', 'surprised', 'sad', 'angry']


export const QQ_REACTION_IDS: Record<ChatReactionName, string> = {
  like: '76', smile: '14', laugh: '182', heart: '66', surprised: '0', sad: '5', angry: '106',
}


const NATIVE_FACE_SEMANTICS: NativeFaceSemantic[] = ['smile', 'laugh', 'sweat', 'awkward', 'heart', 'surprised', 'sad', 'angry']

export const QQ_NATIVE_FACE_IDS: Record<NativeFaceSemantic, string> = {
  smile: '14', laugh: '182', sweat: '27', awkward: '111', heart: '66', surprised: '0', sad: '5', angry: '106',
}


export function normalizeAllowedNativeFaces(value: unknown): NativeFaceSemantic[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is NativeFaceSemantic => NATIVE_FACE_SEMANTICS.includes(item as NativeFaceSemantic)))).slice(0, NATIVE_FACE_SEMANTICS.length)
}


export function normalizeExpressionThreshold(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.7
}

/**
 * A model's willingness is an intent estimate, not a transport permission.
 * Native faces need a visible-text counterpart so a model cannot turn every
 * routine reply into a face merely by returning willingness=1. The 0.90 cap
 * deliberately makes thresholds above 0.90 an effective near-disable mode.
 */

/**
 * A model's willingness is an intent estimate, not a transport permission.
 * Native faces need a visible-text counterpart so a model cannot turn every
 * routine reply into a face merely by returning willingness=1. The 0.90 cap
 * deliberately makes thresholds above 0.90 an effective near-disable mode.
 */
export function calibratedNativeFaceWillingness(semantic: NativeFaceSemantic, willingness: unknown, replyContent: unknown) {
  const text = String(replyContent ?? '').replace(/<sep\/>/g, ' ').trim()
  if (!text) return 0
  const patterns: Record<NativeFaceSemantic, RegExp> = {
    smile: /(?:微笑|开心|高兴|谢谢|好耶|好呀|可以|行吧|嘿|哈哈)/i,
    laugh: /(?:哈{2,}|笑死|好笑|乐|绷不住|蚌埠|草|救命)/i,
    sweat: /(?:流汗|尴尬|无语|服了|麻了|救命|离谱|完了|累|忙|不知道怎么说)/i,
    awkward: /(?:尴尬|那个|呃|emm|……|\.{3,}|我真的|怎么说呢)/i,
    heart: /(?:喜欢|爱你|抱抱|可爱|谢谢|好耶|开心|高兴)/i,
    surprised: /(?:不会吧|真的假的|居然|什么|怎么会|\?{1,}|？{1,}|!{1,}|！{1,})/i,
    sad: /(?:难过|哭|委屈|可怜|遗憾|心疼|唉)/i,
    angry: /(?:生气|气死|烦|闭嘴|别[再乱闹说]|离谱|过分|你.*(?:啊|吧|？|!|！))/i,
  }
  const semanticMatch = patterns[semantic].test(text)
  const evidence = semanticMatch ? 0.9 : 0.2
  return Math.min(0.9, normalizeExpressionThreshold(willingness) * (0.25 + evidence * 0.75))
}


export function targetableMessageId(value: unknown) {
  const id = String(value ?? '').trim()
  return /^-?\d+$/.test(id) && id !== '0' ? id : undefined
}


export function groupMessageRef(entryId: number) {
  return `msg-${Math.max(0, Math.floor(entryId))}`
}


export async function listStickerFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 3) return
    let entries: Awaited<ReturnType<typeof readdir>>
    try { entries = await readdir(directory, { withFileTypes: true }) as any } catch { return }
    for (const entry of entries as any[]) {
      const full = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(full, depth + 1)
      else if (entry.isFile() && /\.(?:png|jpe?g|webp|gif)$/i.test(entry.name)) files.push(full)
    }
  }
  await visit(root, 0)
  return files.sort()
}


export function stickerMime(filePath: string) {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return 'image/png'
}

/** The old punctuation-only id could collide (for example two filenames that
 * both normalize to bq--6-). Keep a readable path prefix, then append a
 * content hash fragment so every row is globally unique and stable for an
 * unchanged file. */

/** The old punctuation-only id could collide (for example two filenames that
 * both normalize to bq--6-). Keep a readable path prefix, then append a
 * content hash fragment so every row is globally unique and stable for an
 * unchanged file. */
export function stableStickerAssetId(filePath: string, hash: string) {
  const stem = String(filePath ?? '')
    .replace(/\\/g, '/')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
    .slice(0, 220) || 'sticker'
  // 后缀 = 路径+内容的联合哈希。仅用内容哈希时，中文路径被折叠成 '-' 后
  // stem 常退化为 'sticker'——两个分组存同一张图即同 assetId，扫描每轮在
  // UNIQUE 约束上崩掉（用户日志 8 连复现）。联合哈希让路径差异必然分叉。
  const suffix = createHash('sha1').update(`${filePath}\n${hash}`).digest('hex').slice(0, 16)
  return `${stem}-${suffix}`.slice(0, 255)
}

/** 表情包投递 URL：Koishi HTTP 路由 + assetId（OneBot 实现回源下载） */

/** 表情包投递 URL：Koishi HTTP 路由 + assetId（OneBot 实现回源下载） */
export function stickerDeliveryUrl(base: string, assetId: string) {
  const root = String(base || '').trim().replace(/\/$/, '')
  return `${root || 'http://127.0.0.1:5140'}/hds-interlude/sticker/${encodeURIComponent(assetId)}`
}

/** 表情包本地文件 URI：file:/// + 正斜杠绝对路径（Linux 与 Windows 盘符
 * 两种形态都产出三斜杠标准形；SnowLuma/NapCat 的图片段按 file:// 与
 * 含分隔符的本地路径解析，见 SnowLuma element-codecs 的 file 优先规则）。 */

/** 表情包本地文件 URI：file:/// + 正斜杠绝对路径（Linux 与 Windows 盘符
 * 两种形态都产出三斜杠标准形；SnowLuma/NapCat 的图片段按 file:// 与
 * 含分隔符的本地路径解析，见 SnowLuma element-codecs 的 file 优先规则）。 */
export function stickerFileUrl(absolutePath: string) {
  const normalized = String(absolutePath ?? '').replace(/[\\]/g, '/').replace(/^\/+/, '')
  return `file:///${normalized}`
}

/** Extract only explicit clock statements from a live user message. This is a
 * small factual aid, not an attempt to infer every temporal expression. */

/** Extract only explicit clock statements from a live user message. This is a
 * small factual aid, not an attempt to infer every temporal expression. */
export function extractUserReportedTimes(content: string, now: Date, timezone: string): UserReportedTime[] {
  const text = String(content ?? '')
  const currentMinutes = localClockMinutes(now, timezone)
  const date = calendarDayKey(now, timezone)
  const facts: UserReportedTime[] = []
  const seen = new Set<string>()
  const add = (hour: number, minute: number, statement: string) => {
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return
    const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    const relation: UserReportedTime['relation'] = hour * 60 + minute < currentMinutes ? 'past'
      : hour * 60 + minute > currentMinutes ? 'future' : 'current'
    const key = `${clock}:${statement}`
    if (seen.has(key)) return
    seen.add(key)
    facts.push({ localTime: `${date} ${clock}`, relation, statement: clip(statement, 240).trim() })
  }
  for (const match of text.matchAll(/(?:今天|今晚|下午|晚上|早上|上午)?\s*(\d{1,2})\s*(?:[:：.]|点)\s*(\d{2}|半)?/g)) {
    let hour = Number(match[1])
    const minute = match[2] === '半' ? 30 : match[2] ? Number(match[2]) : 0
    const prefix = match[0]
    if ((prefix.includes('下午') || prefix.includes('晚上')) && hour < 12) hour += 12
    else if (!/(?:早上|上午|下午|晚上|中午)/.test(prefix) && hour > 0 && hour < 12) {
      // Bare “6.30” is ambiguous. Prefer the 12-hour interpretation nearest
      // to the current story clock, so an evening report normally means 18:30
      // rather than an implausibly distant 06:30.
      const morning = hour * 60 + minute
      const evening = (hour + 12) * 60 + minute
      if (Math.abs(evening - currentMinutes) < Math.abs(morning - currentMinutes)) hour += 12
    }
    add(hour, minute, text.slice(Math.max(0, match.index! - 48), Math.min(text.length, match.index! + match[0].length + 96)))
  }
  // 时段词（中午/下午/晚上等）作为该时段代表性的钟点锚点，供守卫与 prompt
  // 理解“中午一起吃饭”这类不含数字的时间约定。
  for (const match of text.matchAll(/(早上|上午|中午|下午|傍晚|晚上)/g)) {
    const hour = ({ 早上: 8, 上午: 9, 中午: 12, 下午: 15, 傍晚: 18, 晚上: 20 } as Record<string, number>)[match[1]]
    add(hour, 0, text.slice(Math.max(0, match.index! - 48), Math.min(text.length, match.index! + match[0].length + 96)))
  }
    // 中文数字钟点（“八点”“八点半”“九点一刻”）：口语消息最常用的写法，此前
  // 只有守卫的正则认识它们，prompt 侧的 userReportedTimes 反而漏掉。
  for (const match of text.matchAll(/([零一二三四五六七八九十两]+)点(?:(?:零|([一二三四五六七八九十两]+))分?|(半))?/g)) {
    const hour = chineseClockNumber(match[1])
    const minute = match[3] === '半' ? 30 : match[2] ? chineseClockNumber(match[2]) : 0
    if (hour == null || minute == null) continue
    add(hour, minute, text.slice(Math.max(0, match.index! - 48), Math.min(text.length, match.index! + match[0].length + 96)))
  }
  return facts.slice(0, 4)
}


export function describeQuotedMessage(session: Session, characterName = '主角'): QuotedMessageContext | undefined {
  const quote = session.quote as any
  if (!quote) return undefined
  const content = normalizeQuotedMessageContent(quote.content)
  if (!content) return undefined
  const senderId = String(quote.user?.id ?? '').trim()
  const isCharacter = !!senderId && senderId === String(session.selfId ?? '')
  const senderName = isCharacter
    ? String(characterName || '主角').trim() || '主角'
    : normalizeGroupDisplayName(quote.member?.nick, quote.member?.name, quote.user?.nick, quote.user?.name, senderId) || '未知发送者'
  const speaker = isCharacter
    ? `主角「${senderName}」`
    : senderId
      ? `消息发送者「${senderName}」（ID：${senderId}）`
      : `消息发送者「${senderName}」`
  return { senderId, senderName, speaker, content }
}


export function normalizeQuotedMessageContent(value: unknown) {
  const raw = normalizeQQNativeFaceSegments(value)
  const content = raw
    .replace(/<(?:img|image)\b[^>]*\/?>(?:<\/(?:img|image)>)?/gi, '[图片]')
    .replace(/<(?:audio|record)\b[^>]*\/?>(?:<\/(?:audio|record)>)?/gi, '[语音]')
    .replace(/<video\b[^>]*\/?>(?:<\/video>)?/gi, '[视频]')
    .replace(/<(?:face|mface)\b[^>]*\/?>(?:<\/(?:face|mface)>)?/gi, '[表情]')
    .replace(/<at\b[^>]*(?:name|id)=["']?([^\s"'>]+)[^>]*\/?>(?:<\/at>)?/gi, '[@$1]')
    .replace(/\[CQ:image,[^\]]*\]/gi, '[图片]')
    .replace(/\[CQ:record,[^\]]*\]/gi, '[语音]')
    .replace(/\[CQ:video,[^\]]*\]/gi, '[视频]')
    .replace(/\[CQ:face,[^\]]*\]/gi, '[表情]')
    .replace(/<[^>]+>/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return clip(content, 1_500)
}


export function normalizeQuotedMessageContext(value: unknown): QuotedMessageContext | undefined {
  if (!isRecord(value)) return undefined
  const content = normalizeQuotedMessageContent(value.content)
  if (!content) return undefined
  const senderId = clip(String(value.senderId ?? ''), 127)
  const senderName = clip(String(value.senderName ?? ''), 255) || '未知发送者'
  const speaker = clip(String(value.speaker ?? ''), 500) || (senderId ? `消息发送者「${senderName}」（ID：${senderId}）` : `消息发送者「${senderName}」`)
  return { senderId, senderName, speaker, content }
}


export function normalizeAllowedReactions(value: unknown): ChatReactionName[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is ChatReactionName => CHAT_REACTION_NAMES.includes(item as ChatReactionName)))).slice(0, CHAT_REACTION_NAMES.length)
}

/** Lenient kind mapping: models frequently answer with near-miss labels
 * ("scene", "event", Chinese labels); coerce the obvious ones instead of
 * discarding the whole beat. Unknown kinds fall back to "activity". */

/** Lenient kind mapping: models frequently answer with near-miss labels
 * ("scene", "event", Chinese labels); coerce the obvious ones instead of
 * discarding the whole beat. Unknown kinds fall back to "activity". */
const TIMELINE_KIND_ALIASES: Record<string, TimelinePlan['beats'][number]['kind']> = {
  activity: 'activity', action: 'activity', event: 'activity', scene: 'activity', behavior: 'activity',
  thought: 'thought', think: 'thought', feeling: 'thought', mood: 'thought', inner: 'thought',
  state: 'state', status: 'state', condition: 'state',
  活动: 'activity', 行动: 'activity', 事件: 'activity', 场景: 'activity',
  想法: 'thought', 心情: 'thought', 思绪: 'thought',
  状态: 'state',
}


function coerceTimelineKind(value: unknown): TimelinePlan['beats'][number]['kind'] | '' {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().toLowerCase()
  return TIMELINE_KIND_ALIASES[normalized] ?? 'activity'
}


function coerceTimelinePosition(value: unknown): number {
  // Accept numeric strings ("0.5") and percentage strings ("50%") before
  // falling back to NaN so one sloppy field doesn't discard the whole beat.
  if (typeof value === 'number') return Math.max(0, Math.min(1, value))
  if (typeof value === 'string') {
    const text = value.trim().replace(/%$/, '')
    const parsed = Number(text)
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed <= 1 ? parsed : parsed / 100))
  }
  return Number.NaN
}

/** Parse only the narrow event ledger shape. Unknown model fields and empty
 * plans are discarded before they can become a source of world state. */

/** Parse only the narrow event ledger shape. Unknown model fields and empty
 * plans are discarded before they can become a source of world state. */
export function normalizeTimelinePlan(value: unknown): TimelinePlan | undefined {
  if (!isRecord(value) || !Array.isArray(value.beats)) return undefined
  const beats = value.beats
    .filter(isRecord)
    .map(item => ({
      at: coerceTimelinePosition(item.at),
      kind: coerceTimelineKind(item.kind),
      summary: typeof item.summary === 'string' ? clip(item.summary, 240).trim() : '',
    }))
    .filter((item): item is TimelinePlan['beats'][number] => Number.isFinite(item.at) && !!item.kind && !!item.summary)
    .sort((left, right) => left.at - right.at)
    .slice(0, 4)
  if (!beats.length) return undefined
  const carry = Array.isArray(value.carry)
    ? value.carry.filter(item => typeof item === 'string').map(item => clip(item, 180).trim()).filter(Boolean).slice(0, 4)
    : []
  return { beats, ...(carry.length ? { carry } : {}) }
}

/** Human-readable diff of why a model plan was rejected, for the warn log. */

/** Human-readable diff of why a model plan was rejected, for the warn log. */
export function describeTimelinePlanRejection(value: unknown): string {
  if (!isRecord(value)) return '返回不是 JSON 对象'
  if (!Array.isArray(value.beats)) return '缺少 beats 数组'
  if (!value.beats.length) return 'beats 为空数组（模型未产出任何节点）'
  const details = value.beats.filter(isRecord).map(item => {
    const problems: string[] = []
    const at = coerceTimelinePosition(item.at)
    if (!Number.isFinite(at)) problems.push(`at=${JSON.stringify(item.at)} 无法解析`)
    if (!coerceTimelineKind(item.kind)) problems.push(`kind=${JSON.stringify(item.kind)} 非法`)
    if (typeof item.summary !== 'string' || !item.summary.trim()) problems.push('summary 为空')
    return problems.join('，') || '通过'
  })
  return `节点校验详情：${details.join('；')}`
}

/** Automatic script prose is a rendering, not the next turn's temporal source.
 * A compact host ledger retains the real sequence without letting a previous
 * paragraph be copied into a new time window. */

/** Automatic script prose is a rendering, not the next turn's temporal source.
 * A compact host ledger retains the real sequence without letting a previous
 * paragraph be copied into a new time window. */
export function timelineEntryPromptProjection(entry: ScriptEntry): ScriptEntry {
  if (entry.metadata?.narrativeAuthority === 'original-v2') return entry
  if (entry.kind !== 'script') return entry
  const plan = normalizeTimelinePlan(entry.metadata?.timelinePlan)
  if (!plan) return entry
  const beats = plan.beats.map(beat => `${Math.round(beat.at * 100)}% ${beat.kind}: ${beat.summary}`).join(' | ')
  const carry = plan.carry?.length ? ` Carry: ${plan.carry.join(' | ')}` : ''
  return { ...entry, content: `[Host timeline ledger for this completed automatic window: ${beats}.${carry}]` }
}


export function normalizeGroupChatActions(
  decision: NarrativeDecision,
  capabilities: ChatActionCapabilities | undefined,
  context: GroupContext,
): ExecutableGroupChatActions {
  if (!capabilities) return { reactions: [] }
  const targets = new Map(context.messages
    .filter(message => !!message.messageRef && !!message.messageId)
    .map(message => [message.messageRef!, message.messageId!]))

  const rawReplyTo = decision.groupReply?.mode === 'immediate'
    ? decision.groupReply.replyTo
    : decision.interaction?.reply?.mode === 'immediate'
      ? decision.interaction.reply.replyTo
      : undefined
  const replyMessageId = capabilities.quoteReply && typeof rawReplyTo === 'string' ? targets.get(rawReplyTo) : undefined
  const replyTo = replyMessageId ? { messageRef: rawReplyTo!, messageId: replyMessageId } : undefined

  const allowed = new Set(capabilities.reactions)
  const reactions = Array.isArray(decision.messageReactions)
    ? decision.messageReactions
      .filter(item => isRecord(item) && typeof item.messageRef === 'string' && typeof item.reaction === 'string')
      .map(item => ({
        messageRef: String(item.messageRef),
        reaction: String(item.reaction) as ChatReactionName,
        messageId: targets.get(String(item.messageRef)) ?? '',
      }))
      .filter(item => !!item.messageId && allowed.has(item.reaction))
      .slice(0, 1)
    : []
  return { ...(replyTo ? { replyTo } : {}), reactions }
}


export function formatGroupSpeaker(senderName: string, senderId: string) {
  const id = String(senderId || 'unknown').trim() || 'unknown'
  const name = String(senderName || '').replace(/[\r\n]/g, ' ').trim() || id
  return name === id ? `群成员（QQ：${id}）` : `群成员「${name}」（QQ：${id}）`
}


export function normalizeGroupDisplayName(...candidates: unknown[]) {
  for (const candidate of candidates) {
    const name = String(candidate ?? '').replace(/[\r\n]/g, ' ').trim()
    if (name) return name.slice(0, 80)
  }
  return ''
}


export function mentionsBot(session: Session) {
  const selfId = normalizeAccountId(session.selfId)
  const content = String(session.content || '')
  if (!selfId) return false
  return content.includes(selfId) || new RegExp(`<at[^>]+id=["']?${selfId}["']?`, 'i').test(content)
}

