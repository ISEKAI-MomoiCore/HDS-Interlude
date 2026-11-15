/**
 * QQ 空间（说说）通道层 — SnowLuma OneBot 扩展动作（qzone 系列）的封装与治理。
 *
 * 边界：本模块只做通道——动作调用、限流门（风控保护）、能力探测与防御性
 * 归一化。"何时发/发什么/对哪条好友动态反应"的决策属于叙事层（service）。
 * 纯策略函数模式（与 group-willingness.ts 同构）：状态由调用方持有（审计表
 * interlude_qzone_post），本模块无副作用、可独立测试。
 */

export type QzoneActionKind = 'post' | 'comment' | 'like'

/** interlude_qzone_post 审计行（入库与限流门共用）。 */
export interface QzonePostRecord {
  id?: number
  storyId: string
  /** 动作类型：post=发说说 comment=评论 like=点赞；feed-seen=动态已入账（只读标记，不计入限流）。 */
  kind: QzoneActionKind | 'feed-seen'
  /** 目标说说 tid（post 为新发帖返回值；comment/like 为目标帖）。 */
  tid: string
  /** 目标说说归属 QQ 号（省略/空=机器人自己空间）。 */
  targetUin?: string
  content?: string
  /** 发帖查看权限（1 所有人/4 好友/16 部分好友/64 仅自己/128 排除名单）。 */
  ugcRight?: number
  /** 执行账号的角色端点（多 QQ 端点下限流/审计/归因隔离的键）。 */
  endpointId?: string
  /** 上次观测到的评论数（被评论感知基线；undefined=尚未建立基线）。 */
  commentNum?: number
  status: 'pending' | 'confirmed' | 'failed' | 'unknown'
  error?: string
  createdAt: Date
  postedAt?: Date
}

/**
 * 限流门的端点过滤：只计本端点的动作行；无 endpointId 的历史行（回填前）
 * 保守计入所有端点的配额——风控安全优先于配额精确。
 */
export function qzoneRecordsForEndpoint(records: ReadonlyArray<QzonePostRecord>, endpointId?: string): QzonePostRecord[] {
  if (!endpointId) return [...records]
  return records.filter(record => !record.endpointId || record.endpointId === endpointId)
}

export interface QzoneConfig {
  enabled: boolean
  /** 每日发帖上限（SnowLuma 明示高频会被 Qzone 风控，默认保守）。 */
  dailyPostCap: number
  /** 每日评论上限。 */
  dailyCommentCap: number
  /** 每日点赞上限。 */
  dailyLikeCap: number
  /** 任意两次空间动作之间的最小间隔（分钟），跨 kind 共享。 */
  minIntervalMinutes: number
  /** 好友动态轮询只消费该时间窗内的新鲜内容（分钟）。 */
  feedWindowMinutes: number
}

export const DEFAULT_QZONE_CONFIG: QzoneConfig = {
  enabled: false,
  dailyPostCap: 3,
  dailyCommentCap: 6,
  dailyLikeCap: 12,
  minIntervalMinutes: 90,
  feedWindowMinutes: 120,
}

const CONFIG_BOUNDS: Record<keyof Omit<QzoneConfig, 'enabled'>, [number, number]> = {
  dailyPostCap: [0, 20],
  dailyCommentCap: [0, 60],
  dailyLikeCap: [0, 120],
  minIntervalMinutes: [10, 1440],
  feedWindowMinutes: [15, 720],
}

export function resolveQzoneConfig(config?: Partial<QzoneConfig>): QzoneConfig {
  const resolved = { ...DEFAULT_QZONE_CONFIG }
  for (const key of Object.keys(CONFIG_BOUNDS) as Array<keyof typeof CONFIG_BOUNDS>) {
    const raw = Number((config as Record<string, unknown> | undefined)?.[key])
    if (Number.isFinite(raw)) {
      const [min, max] = CONFIG_BOUNDS[key]
      resolved[key] = Math.min(max, Math.max(min, Math.floor(raw))) as never
    }
  }
  resolved.enabled = (config?.enabled ?? DEFAULT_QZONE_CONFIG.enabled) === true
  return resolved
}

export type QzoneGateReason = 'ok' | 'disabled' | 'daily-cap' | 'min-interval'

export interface QzoneGateDecision {
  allowed: boolean
  reason: QzoneGateReason
  /** 今日该 kind 已成功动作数（含 pending，防在途并发超限）。 */
  usedToday: number
  cap: number
}

function localDayKey(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value)
  const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const ACTION_KINDS = new Set<QzoneActionKind>(['post', 'comment', 'like'])

/**
 * 空间动作限流门。records 传近期审计行（建议 48h 窗口）；只有真正的动作
 * （post/comment/like）参与计数与间隔——feed-seen 是只读感知标记，不得挤占
 * 动作配额。同一本地日内按 kind 计数（failed 不计；pending/unknown 计入，
 * 在途与结果不明的都按已发生保守对待），且任意两动作间隔不小于
 * minIntervalMinutes。
 */
export function evaluateQzoneGate(records: ReadonlyArray<QzonePostRecord>, config: QzoneConfig, input: { kind: QzoneActionKind, now?: Date }): QzoneGateDecision {
  if (!config.enabled) return { allowed: false, reason: 'disabled', usedToday: 0, cap: 0 }
  const now = input.now ?? new Date()
  const today = localDayKey(now)
  const cap = input.kind === 'post' ? config.dailyPostCap : input.kind === 'comment' ? config.dailyCommentCap : config.dailyLikeCap
  let usedToday = 0
  let lastActionAt: number | undefined
  for (const record of records) {
    if (!ACTION_KINDS.has(record.kind as QzoneActionKind)) continue
    const at = record.createdAt instanceof Date ? record.createdAt.getTime() : Number.NaN
    if (!Number.isFinite(at)) continue
    if (record.status !== 'failed' && localDayKey(at) === today && record.kind === input.kind) usedToday += 1
    if (record.status !== 'failed' && (lastActionAt === undefined || at > lastActionAt)) lastActionAt = at
  }
  if (usedToday >= cap) return { allowed: false, reason: 'daily-cap', usedToday, cap }
  if (lastActionAt !== undefined && now.getTime() - lastActionAt < config.minIntervalMinutes * 60_000) {
    return { allowed: false, reason: 'min-interval', usedToday, cap }
  }
  return { allowed: true, reason: 'ok', usedToday, cap }
}

// ── SnowLuma 动作防御性归一化 ────────────────────────────────────────────────

export interface QzoneMsgEntry {
  tid: string
  content: string
  time: Date
  commentNum: number
  isPrivate: boolean
  images: string[]
}

/** get_qzone_msg_list 条目归一化：坏行丢弃（undefined），字段强转。 */
export function normalizeQzoneMsgEntry(raw: unknown): QzoneMsgEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const tid = String(row.tid ?? '').trim()
  if (!tid) return undefined
  const time = new Date(Number(row.time ?? 0) * 1000)
  return {
    tid,
    content: String(row.content ?? ''),
    time: Number.isFinite(time.getTime()) ? time : new Date(0),
    commentNum: Number(row.comment_num ?? 0) || 0,
    isPrivate: row.is_private === true,
    images: Array.isArray(row.images) ? row.images.map(image => String(image)).filter(Boolean).slice(0, 9) : [],
  }
}

export interface QzoneFeedEntry {
  uin: string
  nickname: string
  time: Date
  appid: number
  /** Qzone 定位句柄；like/comment 是否接受 feeds.key 当 tid 是阶段 0 POC 决定性验证项。 */
  key: string
}

/** get_qzone_feeds 条目归一化（appid 311=说说；正文 html 阶段 1 不解析）。 */
export function normalizeQzoneFeedEntry(raw: unknown, now = new Date()): QzoneFeedEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const key = String(row.key ?? '').trim()
  const uin = String(row.uin ?? '').trim()
  if (!key || !uin) return undefined
  const time = new Date(Number(row.time ?? 0) * 1000)
  return {
    uin,
    nickname: String(row.nickname ?? ''),
    time: Number.isFinite(time.getTime()) ? time : now,
    appid: Number(row.appid ?? 0) || 0,
    key,
  }
}

/** 好友动态新鲜度过滤：只保留时间窗内的条目（feeds 深翻页不可靠，只吃首页）。 */
export interface QzoneReactionDelta {
  tid: string
  contentExcerpt: string
  previous: number
  current: number
}

/** 被评论感知（纯函数）：她的说说评论数增量比对。
 * - 首次观测只立基线不报增量——刚发布的帖子自带几条评论是常态，不是新事件；
 * - 增量 > 0 才产出感知；计数回落（删评）静默下修基线，杜绝幽灵增量；
 * - 帖子不在当前拉取列表（超出深度）时基线保持不动；
 * - 赞数上游（SnowLuma mapMsgList/ RawEmotion）尚未暴露字段，此处只算评论；
 *   上游补 like_num 后在 QzoneMsgEntry 加字段并入本函数即可。
 * 感知零动作配额；产出的条目由下一次推进（自动或对话）自然携带，绝不触发推进。 */
export function qzoneReactionDeltas(posts: ReadonlyArray<QzonePostRecord>, entries: ReadonlyArray<QzoneMsgEntry>): { deltas: QzoneReactionDelta[], baselines: Array<{ tid: string, commentNum: number }> } {
  const byTid = new Map(entries.map(entry => [entry.tid, entry]))
  const deltas: QzoneReactionDelta[] = []
  const baselines: Array<{ tid: string, commentNum: number }> = []
  for (const post of posts) {
    const tid = String(post.tid ?? '').trim()
    const entry = byTid.get(tid)
    if (!tid || !entry) continue
    baselines.push({ tid, commentNum: entry.commentNum })
    if (post.commentNum === undefined || post.commentNum === null) continue
    const previous = Number(post.commentNum)
    if (entry.commentNum > previous) deltas.push({ tid, contentExcerpt: entry.content, previous, current: entry.commentNum })
  }
  return { deltas, baselines }
}

export function freshQzoneFeeds(feeds: ReadonlyArray<QzoneFeedEntry>, config: QzoneConfig, now = new Date()): QzoneFeedEntry[] {
  const minTime = now.getTime() - config.feedWindowMinutes * 60_000
  return feeds.filter(feed => feed.time.getTime() >= minTime)
}

// ── 动作调用 ────────────────────────────────────────────────────────────────

/** OneBot 动作调用接口（service 侧用 bot.internal._request 接线）。 */
export type QzoneActionCaller = (action: string, params?: Record<string, unknown>) => Promise<unknown>

export class QzoneActionError extends Error {
  constructor(message: string, readonly action: string, readonly retcode?: number, /** true=请求可能已到达服务端（传输异常/超时），结果未知，禁止自动重试。 */ readonly ambiguous = false) {
    super(message)
    this.name = 'QzoneActionError'
  }
}

function isOkFrame(frame: unknown) {
  if (!frame || typeof frame !== 'object') return false
  const row = frame as Record<string, unknown>
  return row.status === 'ok' || row.retcode === 0
}

/**
 * 调用 SnowLuma qzone 动作并校验回执；失败抛 QzoneActionError（retcode 保留
 * 供风控分类：12xxx 段为 Qzone 风控，service 侧据此熔断当日）。
 */
export async function callQzoneAction<T = unknown>(call: QzoneActionCaller, action: string, params?: Record<string, unknown>): Promise<T> {
  let frame: unknown
  try { frame = await call(action, params ?? {}) }
  catch (error) {
    // 传输层异常（超时/断连）时请求可能已被服务端执行——标记为结果未知。
    throw new QzoneActionError(`${action} 调用异常（结果未知，请勿自动重试）：${error instanceof Error ? error.message : String(error)}`, action, undefined, true)
  }
  if (!isOkFrame(frame)) {
    const row = (frame ?? {}) as Record<string, unknown>
    const retcode = Number(row.retcode)
    throw new QzoneActionError(`${action} 失败：${String(row.status ?? row.retcode ?? 'unknown')} ${String(row.message ?? row.msg ?? row.wording ?? '')}`.trim(), action, Number.isFinite(retcode) ? retcode : undefined)
  }
  return ((frame as Record<string, unknown>).data ?? {}) as T
}

/** 能力探测：只读 get_qzone_msg_list 是否可用（SnowLuma 未连接/未登录 → false）。 */
export async function probeQzoneAvailable(call: QzoneActionCaller): Promise<boolean> {
  try {
    await callQzoneAction(call, 'get_qzone_msg_list', { num: 1 })
    return true
  } catch { return false }
}

// ── 叙事决策侧：意图解析与好友动态过滤（纯函数，service 执行侧调用） ─────────

/** appid=311 是说说；6600 是广告位、5000 是官方号、202 等为杂项，全部排除。 */
export const QZONE_FEED_APPID_TALK = 311

/** 审计与剧本条目用的可见性中文标签。 */
export function qzoneVisibilityLabel(ugcRight: number) {
  return ugcRight === 1 ? '所有人可见'
    : ugcRight === 4 ? '好友可见'
    : ugcRight === 16 ? '部分好友可见'
    : ugcRight === 64 ? '仅自己可见'
    : ugcRight === 128 ? '部分好友不可见'
    : '好友可见'
}

export interface QzoneActionRequest {
  action: QzoneActionKind
  content?: string
  tid?: string
  targetUin?: string
  /** 展示名（仅用于账本条目文本，如“评论了 XX 的说说”）。 */
  targetName?: string
  ugcRight?: number
}

const QZONE_UGC_RIGHT_VALUES = new Set([1, 4, 16, 64, 128])

const TID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/

/**
 * 意图 payload → 受限动作请求。非法（类型错/该有的字段缺/超长/tid 字符集
 * 异常）返回 null，执行侧记失败并完成意图——坏 payload 永远不该挡住账本排水。
 */
export function qzoneIntentFromPayload(payload: unknown): QzoneActionRequest | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const action = String(row.action ?? '')
  if (action !== 'post' && action !== 'comment' && action !== 'like') return null
  const content = typeof row.content === 'string' ? row.content.trim() : ''
  const tid = typeof row.tid === 'string' ? row.tid.trim() : ''
  const targetUin = typeof row.targetUin === 'string' && /^\d{4,12}$/.test(row.targetUin.trim()) ? row.targetUin.trim() : ''
  const targetName = typeof row.targetName === 'string' ? row.targetName.trim().slice(0, 40) : ''
  const rawRight = Number(row.ugcRight)
  const ugcRight = QZONE_UGC_RIGHT_VALUES.has(rawRight) ? rawRight : undefined
  if (action === 'post') {
    if (!content || content.length > 2_000) return null
    return { action, content, targetUin: targetUin || undefined, targetName: targetName || undefined, ugcRight: ugcRight ?? 4 }
  }
  // 评论/点赞的目标 tid 只收窄字符集；来源绑定（必须来自已入账动态）由执行侧校验。
  if (!TID_PATTERN.test(tid)) return null
  if (action === 'comment') {
    if (!content || content.length > 500) return null
    return { action, content, tid, targetUin: targetUin || undefined, targetName: targetName || undefined }
  }
  return { action, tid, targetUin: targetUin || undefined, targetName: targetName || undefined }
}

/**
 * 好友动态候选：说说类（appid 311）、有效 uin、时间窗内、未在 seen 集合里。
 * 每轮最多保留 2 条——感知是低频背景行为，不让一次轮询刷屏剧本。
 */
export function qzoneFeedCandidates(feeds: ReadonlyArray<QzoneFeedEntry>, seenKeys: ReadonlySet<string>, config: QzoneConfig, now = new Date()): QzoneFeedEntry[] {
  const minTime = now.getTime() - config.feedWindowMinutes * 60_000
  const candidates: QzoneFeedEntry[] = []
  for (const feed of feeds) {
    if (candidates.length >= 2) break
    if (feed.appid !== QZONE_FEED_APPID_TALK) continue
    if (!feed.uin || feed.uin === '0') continue
    if (seenKeys.has(feed.key)) continue
    if (feed.time.getTime() < minTime) continue
    candidates.push(feed)
  }
  return candidates
}

/**
 * 用好友自己的说说列表对齐 feed 正文：只认 tid 精确命中——连发多条时按时间
 * 近似配对会错配正文，宁可只记元数据（空串），错的内容比没有内容更糟。
 */
export function matchQzoneFeedContent(entries: ReadonlyArray<QzoneMsgEntry>, feed: QzoneFeedEntry): string {
  return entries.find(entry => entry.tid === feed.key)?.content ?? ''
}
