/** 平台身份与会话素材：story/participant/群号归一化、OneBot 平台判定、
 * 会话图片/语音/文件提取、超时与 MIME 探测、端点参与者匹配（模块级单例）。
 * P1 自 service.ts 尾部迁出（2026-10-29），行为不变。 */
import { h, Session, Universal } from 'koishi'
import type { InterludeService } from './service'
import { endpointAccountKey, EndpointRow } from './endpoints'
import { InterludeParticipant } from './types'
import type { OneBotAccountRule } from './service'
import { normalizeAccountId, normalizeGroupId } from './platform/identity'

import { normalizeQQNativeFaceSegments } from './qq-face'

export function mergeForwardContent(existing: string, forward: string) {
  const base = String(existing ?? '')
    .replace(/<forward\b[^>]*\/?>(?:<\/forward>)?/gi, '')
    .replace(/\[CQ:forward,[^\]]*\]/gi, '')
    .trim()
  return base ? `${base}\n${forward}` : forward
}


export function storyIdForCharacter(platform: string, selfId: string) { return `character:${platform}:${selfId}` }


export function legacyStoryIdFor(platform: string, selfId: string, userId: string) { return `${platform}:${selfId}:${userId}` }


export function participantIdFor(platform: string, selfId: string, userId: string) { return `${platform}:${selfId}:${userId}` }


export function participantIdForStory(storyId: string, platform: string, selfId: string, userId: string) {
  return `${participantIdFor(platform, selfId, userId)}:${storyId}`.slice(0, 255)
}

/**
 * M2 §1.2：端点集合匹配——参与者名下任一启用 user 端点行命中即该参与者；
 * 注册表未命中时回落旧字段比对（单平台等价）。
 */

/**
 * M2 §1.2：端点集合匹配——参与者名下任一启用 user 端点行命中即该参与者；
 * 注册表未命中时回落旧字段比对（单平台等价）。
 */
export function sameParticipantEndpoint(participant: InterludeParticipant, session: Session) {
  const legacy = () => {
    const onebotPair = isOneBotPlatform(participant.platform) && isOneBotPlatform(session.platform)
    return (participant.platform === session.platform || onebotPair)
      && normalizeAccountId(participant.selfId) === normalizeAccountId(session.selfId)
      && normalizeAccountId(participant.userId) === normalizeAccountId(session.userId)
  }
  const service = activeServiceForEndpoints as any
  if (!service?.endpointRegistryReady) return legacy()
  const rows = (service.endpointRows as EndpointRow[]).filter(row =>
    row.ownerKind === 'participant-user' && row.ownerId === participant.id && row.enabled)
  if (!rows.length) return legacy()
  const sessionAccountKey = endpointAccountKey(session.platform, String(session.selfId ?? ''))
  const sessionUserId = normalizeAccountId(session.userId)
  return rows.some(row => row.accountKey === sessionAccountKey
    && normalizeAccountId(row.userId ?? '') === sessionUserId)
}

/** sameParticipantEndpoint 需要读注册表——由构造器绑定当前 service 实例。 */

/** sameParticipantEndpoint 需要读注册表——由构造器绑定当前 service 实例。 */
let activeServiceForEndpoints: InterludeService | null = null

export function bindActiveServiceForEndpoints(service: InterludeService | null) {
  activeServiceForEndpoints = service
}


export function isOneBotPlatform(platform: string | undefined) {
  const value = String(platform ?? '').toLowerCase()
  return value === 'onebot'
    || value.startsWith('onebot:')
    || value === 'napcat'
    || value.startsWith('napcat:')
    || value === 'qq:onebot'
    || value.startsWith('qq:onebot:')
}

/**
 * Resolve the adapter-facing channel id for a private delivery.
 *
 * OneBot's `sendMessage()` treats a bare numeric id as a group channel. The
 * incoming session already carries the correct private route, but delayed or
 * split deliveries often have no live session and therefore reach this helper.
 * Keep explicitly typed private ids intact and make the OneBot family use the
 * unambiguous `private:<userId>` form.
 */

/**
 * Resolve the adapter-facing channel id for a private delivery.
 *
 * OneBot's `sendMessage()` treats a bare numeric id as a group channel. The
 * incoming session already carries the correct private route, but delayed or
 * split deliveries often have no live session and therefore reach this helper.
 * Keep explicitly typed private ids intact and make the OneBot family use the
 * unambiguous `private:<userId>` form.
 */
export function privateDeliveryChannelId(platform: string, userId: string | undefined, channelId: string | undefined) {
  const existing = String(channelId ?? '').trim()
  if (/^(?:private|user):/i.test(existing)) return existing

  const id = String(userId ?? '').trim()
  if (isOneBotPlatform(platform)) return id ? `private:${id}` : existing

  // A private delivery must never retain a group route accidentally. Native
  // adapters may use a different address scheme, so preserve their existing
  // non-group route and fall back to the user id only when necessary.
  if (/^(?:group|guild):/i.test(existing)) return id || existing
  return existing || id
}

/** OneBot 目标 ID 类型规则——纯数字串转 number（QQ 的 user_id/group_id
 * 规范类型），其余（wxid_xxx / @chatroom 等字符串 ID）原样传 string。此前
 * Number() 一刀切会把非数字 ID 变成 NaN 直发上游。 */

/** OneBot 目标 ID 类型规则——纯数字串转 number（QQ 的 user_id/group_id
 * 规范类型），其余（wxid_xxx / @chatroom 等字符串 ID）原样传 string。此前
 * Number() 一刀切会把非数字 ID 变成 NaN 直发上游。 */
export function onebotTargetId(channelId: string): string | number {
  const raw = String(channelId).replace(/^(?:private:|group:)/, '')
  return /^\d+$/.test(raw) ? Number(raw) : raw
}

/** 日志 QQ 号脱敏——5-12 位数字段保留尾 4 位（够关联排查），其余打码。
 * 只用于 summary 级（verbosity 关不掉）的入站消息行；standard/diagnostic 级
 * 的完整 ID 已有 verbosity 门控，保持原样。 */

/** 日志 QQ 号脱敏——5-12 位数字段保留尾 4 位（够关联排查），其余打码。
 * 只用于 summary 级（verbosity 关不掉）的入站消息行；standard/diagnostic 级
 * 的完整 ID 已有 verbosity 门控，保持原样。 */
export function maskQqIds(value: unknown): string {
  return String(value ?? '').replace(/\d{5,12}/g, digits => '•'.repeat(Math.max(1, digits.length - 4)) + digits.slice(-4))
}


export function extractSessionImageSources(session: Session) {
  const raw = String(session.content ?? '')
  const sources: string[] = []
  const add = (value: unknown, kind: 'url' | 'file' | 'adapter-url' = 'url') => {
    const source = String(value ?? '').trim()
    if (!source || sources.includes(source)) return
    if (source.length > 8 * 1024 * 1024) return
    if (/^https?:\/\//i.test(source)) sources.push(kind === 'adapter-url' ? `onebot-url:${source}` : source)
    else if (/^data:image\//i.test(source)) sources.push(source)
    else if (kind === 'file') sources.push(`onebot-file:${source}`)
  }
  const visit = (element: any) => {
    if (!element) return
    const type = String(element.type ?? '').toLowerCase()
    if (type === 'img' || type === 'image') {
      const src = element.attrs?.src ?? element.attrs?.url ?? element.data?.src ?? element.data?.url
      if (src) add(src)
      else add(element.attrs?.file ?? element.data?.file, 'file')
    }
    for (const child of element.children ?? []) visit(child)
  }
  // Session.elements is adapter-owned and can be reused or enriched by other
  // middleware. Parse this message's raw content only, otherwise an old image
  // element may be accidentally attached to a later text-only turn.
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  if (!sources.length) {
    const pattern = /<(?:img|image)\b[^>]*(?:src|url)=["']([^"']+)["'][^>]*>/gi
    for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) add(match[1])
  }
  // OneBot/NapCat may leave a CQ image segment in the raw message instead of
  // converting it to an HTML image element. Prefer its CDN URL; if only the
  // file token is present, keep that token so the current bot can call
  // get_image(file) without trusting arbitrary user URLs.
  const cqPattern = /\[CQ:image,([^\]]+)\]/gi
  for (let match = cqPattern.exec(raw); match; match = cqPattern.exec(raw)) {
    const fields: Record<string, string> = {}
    for (const part of match[1].split(',')) {
      const index = part.indexOf('=')
      if (index > 0) fields[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim()
    }
    add(fields.url || fields.cache_url, 'adapter-url')
    if (!fields.url && !fields.cache_url) add(fields.file, 'file')
  }
  return sources
}

/** Persist only bounded, reloadable image references for group history. Native
 * data URIs are intentionally excluded: durable script metadata must never carry
 * binary image payloads or turn-sized base64 strings. */

/** Persist only bounded, reloadable image references for group history. Native
 * data URIs are intentionally excluded: durable script metadata must never carry
 * binary image payloads or turn-sized base64 strings. */
export function groupImageRefsForStorage(sources: string[]) {
  return sources
    .map((source, ordinal) => {
      const value = String(source ?? '').trim()
      if (!value || /^data:image\//i.test(value) || value.length > 8 * 1024 * 1024) return undefined
      const sourceType = value.startsWith('onebot-file:') ? 'file' as const : 'url' as const
      const normalizedSource = sourceType === 'file' ? value.slice('onebot-file:'.length) : value
      if (!normalizedSource) return undefined
      return { source: value, ordinal, sourceType }
    })
    .filter((item): item is { source: string, ordinal: number, sourceType: 'url' | 'file' } => !!item)
}

/** Detect record/audio segments from both Koishi elements and raw OneBot CQ
 * fallback without retaining the binary voice payload. */

/** Detect record/audio segments from both Koishi elements and raw OneBot CQ
 * fallback without retaining the binary voice payload. */
export function extractSessionVoiceCount(session: Pick<Session, 'content'>) {
  const raw = String(session.content ?? '')
  let count = 0
  const visit = (element: any) => {
    if (!element) return
    const type = String(element.type ?? '').toLowerCase()
    if (type === 'audio' || type === 'record') count++
    for (const child of element.children ?? []) visit(child)
  }
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  if (count) return count
  return (raw.match(/\[CQ:record,[^\]]*\]/gi) ?? []).length
}

/** Extract fetchable voice/audio tokens for the native-audio channel.
 * Unlike images, records prefer the OneBot file token: raw record URLs serve
 * SILK, which only SnowLuma's server-side transcode (get_record out_format)
 * can turn into a model-readable audio payload. */

/** Extract fetchable voice/audio tokens for the native-audio channel.
 * Unlike images, records prefer the OneBot file token: raw record URLs serve
 * SILK, which only SnowLuma's server-side transcode (get_record out_format)
 * can turn into a model-readable audio payload. */
export function extractSessionAudioSources(session: Session) {
  const raw = String(session.content ?? '')
  const sources: string[] = []
  const add = (value: unknown, kind: 'url' | 'file' = 'file') => {
    const source = String(value ?? '').trim()
    if (!source || sources.includes(source) || source.length > 512) return
    if (/^data:audio\//i.test(source)) { sources.push(source); return }
    // http(s) record URLs serve raw SILK and cannot be transcoded without the
    // OneBot file token, so they stay out of the native-audio channel.
    if (/^https?:\/\//i.test(source)) return
    if (kind === 'file') sources.push(`onebot-file:${source}`)
  }
  const visit = (element: any) => {
    if (!element) return
    const type = String(element.type ?? '').toLowerCase()
    if (type === 'audio' || type === 'record') {
      const attrs = { ...(element.attrs ?? {}), ...(element.data ?? {}) }
      add(attrs.file ?? attrs.url ?? attrs.src, attrs.file ? 'file' : 'url')
    }
    for (const child of element.children ?? []) visit(child)
  }
  // Parse this message's raw content only; Session.elements is adapter-owned
  // and can be reused by other middleware across turns.
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  if (!sources.length) {
    const pattern = /<(?:audio|record)\b[^>]*(?:file|src|url)=["']([^"']+)["'][^>]*>/gi
    for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) add(match[1])
  }
  // OneBot may leave a CQ record segment with only a file token (typical
  // NapCat/SnowLuma private voice) or an extra url field we cannot transcode.
  const cqPattern = /\[CQ:record,([^\]]+)\]/gi
  for (let match = cqPattern.exec(raw); match; match = cqPattern.exec(raw)) {
    const fields: Record<string, string> = {}
    for (const part of match[1].split(',')) {
      const index = part.indexOf('=')
      if (index > 0) fields[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim()
    }
    add(fields.file, 'file')
  }
  // QQ 音频文件走 <file> 元素（CDN 直链 + 文件名扩展），原始字节可直接
  // 作为 input_audio；与语音的 SILK 转码路径不同，标记 file-url 前缀。
  for (const fact of extractSessionFileFacts(session)) {
    if (!fact.audio || !/^https?:\/\//i.test(fact.url)) continue
    const encoded = `file-url:${fact.url}#${encodeURIComponent(fact.name || '')}:${fact.size}`
    if (!sources.includes(encoded)) sources.push(encoded)
  }
  return sources
}


export interface SessionFileFact { name: string, url: string, size: number, audio: boolean }


const AUDIO_FILE_EXTENSIONS = /\.(mp3|wav|ogg|m4a|flac|amr|aac|wma)$/i

/** Inbound `<file>` elements carry the QQ CDN URL, display name and size.
 * They are attachment facts: the raw markup must never reach the model as
 * text, and audio-named files feed the native-audio channel. */

/** Inbound `<file>` elements carry the QQ CDN URL, display name and size.
 * They are attachment facts: the raw markup must never reach the model as
 * text, and audio-named files feed the native-audio channel. */
export function extractSessionFileFacts(session: Session): SessionFileFact[] {
  const raw = String(session.content ?? '')
  const facts: SessionFileFact[] = []
  const push = (url: string, name: string, size: number) => {
    if ((!url && !name) || facts.length >= 3) return
    if (facts.some(item => item.url === url && item.name === name)) return
    facts.push({ name: name.slice(0, 200), url: url.slice(0, 1_000), size, audio: AUDIO_FILE_EXTENSIONS.test(name) })
  }
  const visit = (element: any) => {
    if (!element) return
    if (String(element.type ?? '').toLowerCase() === 'file') {
      const attrs = { ...(element.attrs ?? {}), ...(element.data ?? {}) }
      push(String(attrs.src ?? attrs.url ?? '').trim(), String(attrs.name ?? attrs.file ?? attrs.title ?? '').trim(), Number(attrs.size ?? attrs['file-size'] ?? 0) || 0)
    }
    for (const child of element.children ?? []) visit(child)
  }
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  if (!facts.length) {
    const pattern = /<file\b([^>]*)\/?>/gi
    for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
      const attrs = match[1]
      const pick = (key: string) => new RegExp(`${key}=["']([^"']*)["']`, 'i').exec(attrs)?.[1]?.trim() ?? ''
      push(pick('src') || pick('url'), pick('name') || pick('file') || pick('title'), Number(pick('size') || pick('file-size')) || 0)
    }
  }
  return facts
}

/** 群聊入站没有原生附件通道：把 <img>/<file>/<record> 等元素标记转成事实
 * 占位（保留"发过什么"的信息），URL 污水不进群上下文，也不再被模型复述。 */

/** 群聊入站没有原生附件通道：把 <img>/<file>/<record> 等元素标记转成事实
 * 占位（保留"发过什么"的信息），URL 污水不进群上下文，也不再被模型复述。 */
export function describeGroupAttachments(content: unknown) {
  return normalizeQQNativeFaceSegments(String(content ?? ''))
    .replace(/<(?:record|audio)\b[^>]*\/?>/gi, '[语音]')
    .replace(/<(?:img|image)\b[^>]*\/?>/gi, '[图片]')
    .replace(/<video\b[^>]*\/?>/gi, '[视频]')
    .replace(/<file\b[^>]*\/?>/gi, (match) => {
      const name = /(?:name|file|title)=["']([^"']+)["']/i.exec(match)?.[1]
      return name ? `[文件：${name}]` : '[文件]'
    })
    .replace(/<\/(?:file|img|image|audio|record|video)>/gi, '')
    .replace(/\[CQ:image,[^\]]*\]/gi, '[图片]')
    .replace(/\[CQ:record,[^\]]*\]/gi, '[语音]')
    .replace(/\[CQ:video,[^\]]*\]/gi, '[视频]')
    .replace(/\[CQ:file,([^\]]*)\]/gi, (_match, attrs: string) => {
      const name = /(?:name|file)=([^,\]]+)/i.exec(attrs)?.[1]
      return name ? `[文件：${name}]` : '[文件]'
    })
}

/** Limit transport waits. Timeout only marks the outcome unknown; callers own
 * ledger transitions, reconciliation, and any decision to schedule retries. */
export function withTransportTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 30_000): Promise<T> {
  return withTimeout(promise, timeoutMs).catch(error => {
    const isTimeout = (error as { timeout?: boolean })?.timeout === true
      || String(error?.message || error).includes('timeout after')
    if (isTimeout) {
      const wrapped = new Error(`transport-timeout:${label} (结果未知)`) as Error & { transportTimeout?: boolean }
      wrapped.transportTimeout = true
      throw wrapped
    }
    throw error
  })
}


export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}


export function guessImageMime(bytes: Buffer, hinted?: unknown) {
  const hint = String(hinted ?? '').toLowerCase()
  if (hint.startsWith('image/')) return hint
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a')) return 'image/gif'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return ''
}

/** Audio files arrive as original bytes (unlike SILK voice records). Accept
 * only formats the OpenAI-compatible input_audio channel documents. */

/** Audio files arrive as original bytes (unlike SILK voice records). Accept
 * only formats the OpenAI-compatible input_audio channel documents. */
export function guessAudioFormat(bytes: Buffer, hintedName?: string) {
  const hinted = /\.(mp3|wav|ogg|m4a|flac|amr)\b/i.exec(String(hintedName ?? ''))?.[1]?.toLowerCase()
  if (hinted) return hinted
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav'
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg'
  if (bytes.length >= 8 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') return 'm4a'
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'fLaC') return 'flac'
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '#!AMR') return 'amr'
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3'
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3'
  return ''
}


export function isAnimatedImageMime(mime: string) {
  return mime === 'image/gif' || mime === 'image/webp' || mime === 'image/apng'
}


export function sessionGroupId(session: Session) {
  const raw = String((session as any).guildId || session.channelId || '')
  return normalizeGroupId(raw)
}

/** Historical group metadata used both prefixed IDs and numeric QQ IDs. */

/** Historical group metadata used both prefixed IDs and numeric QQ IDs. */
export function groupIdStorageVariants(value: string): Array<string | number> {
  const id = normalizeGroupId(value)
  const numeric = Number(id)
  return [...new Set<string | number>([value, id, `group:${id}`, `guild:${id}`,
    ...(id && Number.isFinite(numeric) ? [numeric] : [])])]
}


export { normalizeGroupId, normalizeAccountId } from './platform/identity'

/** Treat OneBot transport aliases as one administrator-facing platform family. */
export function samePlatformFamily(left: string | undefined, right: string | undefined) {
  if (isOneBotPlatform(left) && isOneBotPlatform(right)) return true
  return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase()
}

/** Normalize transport-qualified QQ ids such as private:123 or onebot:123. */

/** Normalize transport-qualified QQ ids such as private:123 or onebot:123. */


/** 剧本历史注入预算（纯函数，可单测）。
 * M4.1 曾在此处叠加 Math.max(35, …) 硬地板保护连续性——副作用是 Console 里
 * 调小 contextEntryLimit 完全失效，小模型无法收缩上下文。现在尊重用户设置：
 * 条数默认 35（schema 默认），需要更小历史的部署（小模型）可显式调小，
 * 并配合把 contextTimeWindowMinutes 调小或设 0（时间窗会把近窗口内的全部
 * 条目并入，即使超过条数）。 */


/** Koishi/Satori uses numeric Universal.Status values; keep legacy string adapters compatible. */
export function isBotOnlineStatus(status: unknown): boolean {
  return status === Universal.Status.ONLINE
    || status === 1
    || status === 'online'
    || status === 'active'
    || status === 'connected'
}

/* ── D4：管理命令账号门（自 narrative-normalizers 迁入，行为不变）────
 * 这是账号白名单策略（QQ/OneBot 假设），属平台层而非叙事侧。 */
export interface ManageSessionDenial {
  /** onebot = 互动白名单拒绝；managers = managerAccounts 不匹配。两层配置不同，指引不同。 */
  layer: 'onebot' | 'managers'
  /** 供命令回复、doctor 与日志共用的完整原因（含可操作指引）。 */
  detail: string
}

/** 管理权限判定的纯函数核心（可单测）。返回 undefined = 允许。
 * 此前两层失败共用一句"需要 HDSI 管理员权限"，用户给了管理员仍被拒时
 * 排障方向完全被带偏；实际原因必须在消息与默认日志里直接可读。 */
export function manageSessionDenialReason(input: {
  platform?: string
  selfId?: string
  userId?: string
  onebot?: { enabled?: boolean, ignoreSelfMessages?: boolean, botAccounts?: OneBotAccountRule[], userAccounts?: OneBotAccountRule[] }
  managers?: string[]
}): ManageSessionDenial | undefined {
  if (isOneBotPlatform(input.platform)) {
    const config = input.onebot
    if (config?.enabled) {
      const selfId = normalizeAccountId(input.selfId)
      const userId = normalizeAccountId(input.userId)
      if (config.ignoreSelfMessages && selfId && selfId === userId) {
        return { layer: 'onebot', detail: '自消息被 onebot.ignoreSelfMessages 过滤，不计为管理操作。' }
      }
      if (!isEnabledAccount(config.botAccounts, selfId)) {
        return { layer: 'onebot', detail: `机器人账号 ${selfId || '(空)'} 不在 onebot.botAccounts 白名单（或未启用）——请在 Console 的“NapCat / OneBot QQ 账号控制”中添加并启用。` }
      }
      if (!isEnabledAccount(config.userAccounts, userId)) {
        return { layer: 'onebot', detail: `用户账号 ${userId || '(空)'} 不在 onebot.userAccounts 白名单（该开关启用后空白名单即全部拒绝）——请在 Console 的“NapCat / OneBot QQ 账号控制”中添加并启用。` }
      }
    }
  }
  const managers = (input.managers ?? []).map(value => String(value ?? '').trim()).filter(Boolean)
  if (managers.length && !managers.some(value => normalizeAccountId(value) === normalizeAccountId(input.userId))) {
    const platformNote = isOneBotPlatform(input.platform)
      ? ''
      : '（注意：当前来自非 OneBot 环境，账号不是 QQ 号——请用 QQ 私聊执行管理命令，或把该环境账号加入列表）'
    return {
      layer: 'managers',
      detail: `当前账号 ${normalizeAccountId(input.userId) || '(空)'} 不在 sharedStory.managerAccounts（现有：${managers.join('、')}）中${platformNote}；留空该列表即允许所有已授权账号。`,
    }
  }
  return undefined
}

export function isEnabledAccount(accounts: OneBotAccountRule[] | undefined, qq: string) {
  const normalized = normalizeAccountId(qq)
  if (!normalized) return false
  return (accounts ?? []).some(account => account.enabled !== false && normalizeAccountId(account.qq) === normalized)
}
