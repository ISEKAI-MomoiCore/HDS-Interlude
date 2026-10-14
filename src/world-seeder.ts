/**
 * 世界事件播种器（World Event Seeder）：后台低频生成与主角有关的外部事件，
 * 模型给定发生时间，宿主到点以 world-event 剧本条目注入（[世界事件] 前缀）。
 * 设计文档：docs/WORLD_EVENT_SEEDER_DESIGN.md。
 *
 * 事实权威、反应自由：事件是既成现实；她如何感知与应对是主作者的领地。
 * 注册参与者严格拉黑（他们背后是真实的人）；只允许线下通道与 NPC。
 */
import type { Context } from 'koishi'
import { OpenAICompatibleNarrator, type ModelConfig, type ProviderConfig, type TokenUsageRecord } from './narrator'

export type SeedImportance = 'low' | 'medium' | 'high'

/** 模型输出经解析与校验后的候选事件（尚未入库）。 */
export interface WorldSeedEventDraft {
  summary: string
  importance: SeedImportance
  occursAt: Date
  expiresAt?: Date
  subjects: string[]
  rationale: string
}

export interface WorldSeederRuntime {
  enabled: boolean
  provider?: ProviderConfig
  cadenceMinutes: number
  maxPending: number
  dailyCap: number
  maxHorizonHours: number
  temperature: number
  maxTokens: number
  timeout: number
}

export const DEFAULT_WORLD_SEEDER_RUNTIME: WorldSeederRuntime = {
  enabled: false, cadenceMinutes: 30, maxPending: 6, dailyCap: 8,
  maxHorizonHours: 72, temperature: 0.9, maxTokens: 1_000, timeout: 60_000,
}

/** 提供商不再单独配置：模型中心的连接行勾选“用于世界播种”（useForWorldSeeding）
 * 即为选择；服务侧解析出该连接后传入。未勾选（provider 为空）即视为关闭。 */
export function resolveWorldSeederRuntime(value: unknown, provider?: ProviderConfig): WorldSeederRuntime {
  const record = !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const assigned = provider && provider.enabled !== false && provider.model?.trim() ? provider : undefined
  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
  }
  return {
    ...DEFAULT_WORLD_SEEDER_RUNTIME,
    enabled: record.enabled === true && !!assigned,
    provider: assigned,
    cadenceMinutes: clamp(record.cadenceMinutes, 5, 1_440, DEFAULT_WORLD_SEEDER_RUNTIME.cadenceMinutes),
    maxPending: clamp(record.maxPending, 1, 20, DEFAULT_WORLD_SEEDER_RUNTIME.maxPending),
    dailyCap: clamp(record.dailyCap, 1, 20, DEFAULT_WORLD_SEEDER_RUNTIME.dailyCap),
    maxHorizonHours: clamp(record.maxHorizonHours, 1, 336, DEFAULT_WORLD_SEEDER_RUNTIME.maxHorizonHours),
    temperature: Math.max(0, Math.min(2, Number(record.temperature) || DEFAULT_WORLD_SEEDER_RUNTIME.temperature)),
    maxTokens: clamp(record.maxTokens, 256, 8_192, DEFAULT_WORLD_SEEDER_RUNTIME.maxTokens),
    timeout: clamp(record.timeout, 5_000, 300_000, DEFAULT_WORLD_SEEDER_RUNTIME.timeout),
  }
}

// ── 提示词 ──────────────────────────────────────────────────────────────────

/**
 * 世界切面（domain rotation）：切面是任意居住世界都成立的通用方面（非现代地球专属题材），
 * 具体面貌由各剧本自己的 worldSetting 决定。复读的架构根源不是缺闸门，而是"每轮提问完全相同
 * + 生活摘录被自己上一轮的产出锚定"。切面让每轮 sweep 面向世界的一个不同局部
 * 提问——生成侧的多样性来自提问本身，不来自下游过滤。切面按 (storyId, 时间槽)
 * 确定性轮换，无新增持久状态。
 */
export interface WorldSeedDomain { key: string; label: string; brief: string }

export const WORLD_SEED_DOMAINS: WorldSeedDomain[] = [
  { key: 'nature', label: '天象与环境', brief: '这个世界自己的自然节律：季节、天气、光照、声音与气味、环境的变化' },
  { key: 'dwelling', label: '居所与近邻', brief: '她居住的地方与身边的空间：住处内外、近邻的动静、共用场所的状态变化' },
  { key: 'livelihood', label: '生计与日常事务', brief: '她谋生、求学或营生方式带来的外部事务：安排与期限、场所状态、来自机构或雇主的告示' },
  { key: 'close-people', label: '亲近之人', brief: '线下世界里与她有来往的人：家人、长辈、师长、旧识的近况或线下来讯' },
  { key: 'paths', label: '途中与陌生人', brief: '她在外会遇到的：路人与人流、道路或交通、公共场合里偶发的善意或摩擦' },
  { key: 'chance', label: '小意外与际遇', brief: '丢失与拾得、临时的小机会、小麻烦、身体的小状况' },
]

/** 实况天气接管时的 nature 替身:天气/温度/天空状态由宿主通道供给,播种器
 * 只保留季节、光照、声音气味等非天气环境质感。不进 WORLD_SEED_DOMAINS——
 * 轮换周期必须保持六切面,替身只在 weatherHandledByHost 时替换呈现。 */
export const NATURE_DOMAIN_NO_WEATHER: WorldSeedDomain = { key: 'nature-no-weather', label: '天象与环境', brief: '这个世界自己的自然节律：季节、光照的变化、声音与气味、环境的变化(天气与天空状态除外)' }

/** 同一 (storyId, cadence 时间槽) 内切面稳定；跨槽前进一格——相邻两轮必然不同切面。 */
export function seedDomainForRun(storyId: string, slotStart: Date, cadenceMinutes: number): WorldSeedDomain {
  const hash = [...storyId].reduce((acc, ch) => (Math.imul(acc, 31) + ch.charCodeAt(0)) >>> 0, 7)
  const slot = Math.floor(slotStart.getTime() / (Math.max(5, cadenceMinutes) * 60_000))
  return WORLD_SEED_DOMAINS[(hash + slot) % WORLD_SEED_DOMAINS.length]
}


export function worldSeederSystemPrompt(domain?: WorldSeedDomain, weatherHandledByHost = false) {
  // 实况天气接管时 nature 切面换替身,并在规则区追加硬排除(见下)。
  const slice = weatherHandledByHost && domain?.key === 'nature' ? NATURE_DOMAIN_NO_WEATHER : domain
  return [
    'You are the world seeder for HDS Interlude. Your job is to keep the protagonist’s offline world alive with small external events that feel connected to her life.',
    'You will receive: current local time and season, the story’s world setting, current scene and arc summaries, a bounded excerpt of her recent established life, her in-flight working details, her relationship network listed as BLOCKED NAMES, and recently seeded events to avoid repeating.',
    'Rules:',
    '- External facts only: things that happen TO her world — environment, neighborhood, offline social world, NPCs she knows, minor mishaps, small opportunities. Never her own decisions, feelings or actions.',
    '- Offline channels only: phone calls, in-person encounters, notices, deliveries, weather, public events. Never any chat message, platform notification or online conversation content.',
    '- NEVER generate events about BLOCKED NAMES or the user. Family, classmates, shopkeepers and strangers who exist only in her offline life are fine.',
    '- CONNECT TO HER LIFE: use her supporting cast (NPCs named in worldSetting.supportingCast), her location, and her working details as anchors. Events involving named NPCs she knows or places she frequents are far more valuable than generic ambient noise.',
    '- Fit the environment: season, weather, the canon setting’s texture (city or village, era, neighborhood), and her daily circumstances.',
    '- Fit her established life: events must be plausible next to the recent script, her working details and the current arc; never contradict what has already happened.',
    ...(domain ? [`- THIS RUN'S SLICE OF THE WORLD: ${slice.label} — ${slice.brief}. A slice is an aspect of the world, not a genre: render it through this world's own places, people and vocabulary — the supplied worldSetting is authoritative, and you must never import real-world institutions into a world that does not have them. Originate this run's event from this slice only; other slices belong to other runs. If nothing genuine fits the slice right now, return an empty array.`] : []),
    '- Place events at concrete future times within the allowed horizon, expressed in the story timezone. Ordinary gaps in her day are the best slots.',
    '- Variety: avoid repeating the same NPC + same object + same time-of-day pattern across events. If a similar scenario was already seeded, shift to a different NPC, a different place, or a different time entirely.',
    '- Importance: low = texture she may barely notice; medium = a small practical change; high = relationship-relevant or disruptive. Prefer medium for events involving named NPCs; reserve high for genuinely disruptive moments.',
    ...(weatherHandledByHost ? ['- Real-time weather, temperature and sky conditions arrive via a separate host-injected channel. NEVER originate weather changes: no rain, snow, temperature shifts, wind warnings or sky descriptions in your events.'] : []),
    'Real life is mostly uneventful, but a good world still stirs sometimes. Most runs should produce 0-2 events; when the world has something to say, say it.',
    'Output one JSON object only: {"events":[{"summary":"one concrete Chinese sentence stating what happened","importance":"low|medium|high","occursAt":"ISO-8601 with offset","expiresAt":"optional ISO-8601","subjects":["names of offline people involved, empty when none"],"rationale":"short reason this fits now"}]}',
  ].join('\n')
}

// ── 解析与校验闸（纯函数，可测） ────────────────────────────────────────────

export interface SeedValidationInput {
  now: Date
  timezone: string
  maxHorizonHours: number
  blockedNames: string[]
  recentSummaries: string[]
  /** 已排期/已注入事件的 subjects 列表——用于 NPC/道具级去重(bigram 抓不到换皮) */
  recentSubjects?: string[][]
  /** 已排期/已注入事件的 occursAt——时间窗重叠也判重复 */
  recentOccursAt?: Date[]
  /** 实况天气接管时为 true:天气类事件一律弃(宁可错杀——与播种器哲学一致)。 */
  weatherGuard?: boolean
}

/** 天气特征词(含口语变体);仅当 weatherGuard 开启时用于拦截。 */
const WEATHER_PATTERN = /天气|下雨|阵雨|雷阵雨|暴雨|大雪|下雪|雨夹雪|冰雹|打雷|闪电|晴朗|转晴|多云|阴天|大雾|浓雾|台风|寒潮|高温预警|降温|升温|气温|温度骤|大风|刮风|出太阳|太阳出来了/

function bigrams(text: string): Set<string> {
  const normalized = text.replace(/[\p{P}\p{S}\s]+/gu, '')
  const grams = new Set<string>()
  for (let i = 0; i < normalized.length - 1; i += 1) grams.add(normalized.slice(i, i + 2))
  return grams
}

export function summaryJaccard(left: string, right: string): number {
  const a = bigrams(left), b = bigrams(right)
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared += 1
  return shared / (a.size + b.size - shared)
}

function localHourIn(date: Date, timezone: string): number {
  try {
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(date))
    return Number.isFinite(hour) ? hour : date.getUTCHours()
  } catch {
    return date.getUTCHours()
  }
}

export type SeedRejection = 'invalid-shape' | 'empty-summary' | 'invalid-importance' | 'invalid-time' | 'blocked-name' | 'night-high' | 'duplicate' | 'weather-guard'

/** 单事件校验闸；宁可错杀：任何一项不过即弃，不重试。 */
export function validateSeedEvent(draft: WorldSeedEventDraft, input: SeedValidationInput): SeedRejection | undefined {
  if (!draft.summary.trim() || draft.summary.length > 200) return 'empty-summary'
  if (draft.importance !== 'low' && draft.importance !== 'medium' && draft.importance !== 'high') return 'invalid-importance'
  const time = draft.occursAt.getTime()
  if (!Number.isFinite(time) || time <= input.now.getTime() || time > input.now.getTime() + input.maxHorizonHours * 3_600_000) return 'invalid-time'
  for (const name of input.blockedNames) {
    const trimmed = name.trim()
    if (trimmed.length >= 2 && (draft.summary.includes(trimmed) || draft.subjects.some(subject => subject.includes(trimmed) || trimmed.includes(subject.trim())))) return 'blocked-name'
  }
  if (draft.importance === 'high') {
    const hour = localHourIn(draft.occursAt, input.timezone)
    if (hour >= 0 && hour < 6) return 'night-high'
  }
  // ── 多维度去重 ──
  // ① 字符 bigram(措辞级相似)
  for (const recent of input.recentSummaries) {
    if (summaryJaccard(draft.summary, recent) > 0.6) return 'duplicate'
  }
  // ② subjects 重叠:同一 NPC/道具重复出现在不同措辞的事件里(bigram ≈ 0.2 抓不到)
  const recentSubjects = input.recentSubjects ?? []
  for (const subjects of recentSubjects) {
    const overlap = draft.subjects.filter(s => subjects.some(r => s === r || (s.length >= 2 && r.includes(s)) || (r.length >= 2 && s.includes(r))))
    if (overlap.length >= 1) {
      // subjects 重叠且时间窗接近(24h) → 换皮改写
      return 'duplicate'
    }
  }
  // ③ 摘要文本包含已排期事件的 subjects(NPC 名直接出现在新事件里)
  for (const subjects of recentSubjects) {
    for (const subject of subjects) {
      if (subject.length >= 2 && draft.summary.includes(subject)) return 'duplicate'
    }
  }
  // ④ 时间窗 + 关键词交集:两条事件 occursAt 差 < 6h 且共享 ≥2 个关键词 → 同一场景换皮
  const recentOccurs = input.recentOccursAt ?? []
  const inputSummaries = input.recentSummaries
  for (let i = 0; i < inputSummaries.length && i < recentOccurs.length; i++) {
    if (Math.abs(draft.occursAt.getTime() - recentOccurs[i].getTime()) < 6 * 3_600_000) {
      const shared = keywordOverlap(draft.summary, inputSummaries[i])
      if (shared >= 2) return 'duplicate'
    }
  }
  // ⑤ 天气守卫:实况天气接管时天气类事件与宿主通道冲突,一律弃(宁可错杀)。
  if (input.weatherGuard === true && WEATHER_PATTERN.test(draft.summary)) return 'weather-guard'
  return undefined
}

/** 两条中文摘要共享的实义词(≥2 字)数量——Jaccard 对换皮失效,但"辣椒+抽油烟机"这类核心词会保留 */
function keywordOverlap(left: string, right: string): number {
  const extract = (text: string) => new Set(
    text.replace(/[\p{P}\p{S}\s]+/gu, '').match(/[一-龥]{2,4}/g) ?? []
  )
  const a = extract(left), b = extract(right)
  let shared = 0
  for (const word of a) if (b.has(word)) shared++
  return shared
}

/** 防御解析模型输出：字段裁剪、时间解析、subjects/rationale 归一；坏项丢弃。 */
export function parseWorldSeedEvents(value: unknown, limit = 2): WorldSeedEventDraft[] {
  const record = !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const rawEvents = Array.isArray(record.events) ? record.events : []
  const drafts: WorldSeedEventDraft[] = []
  for (const raw of rawEvents.slice(0, limit)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    const summary = typeof item.summary === 'string' ? item.summary.trim().slice(0, 200) : ''
    const importance = item.importance
    if (!summary || (importance !== 'low' && importance !== 'medium' && importance !== 'high')) continue
    const occursAt = new Date(String(item.occursAt ?? ''))
    if (Number.isNaN(occursAt.getTime())) continue
    const expiresRaw = typeof item.expiresAt === 'string' ? new Date(item.expiresAt) : undefined
    const expiresAt = expiresRaw && !Number.isNaN(expiresRaw.getTime()) && expiresRaw > occursAt ? expiresRaw : undefined
    const subjects = Array.isArray(item.subjects)
      ? item.subjects.filter((s): s is string => typeof s === 'string').map(s => s.trim().slice(0, 40)).filter(Boolean).slice(0, 4)
      : []
    drafts.push({
      summary, importance, occursAt, subjects,
      rationale: typeof item.rationale === 'string' ? item.rationale.trim().slice(0, 200) : '',
      ...(expiresAt ? { expiresAt } : {}),
    })
  }
  return drafts
}

// ── 模型客户端：独立配置块复用主提供商请求链 ────────────────────────────────

export interface WorldSeeder {
  available: boolean
  generate(userPayload: string, opts?: { weatherHandledByHost?: boolean }): Promise<unknown>
}

export function createWorldSeeder(
  ctx: Context,
  modelConfig: ModelConfig,
  runtime: WorldSeederRuntime,
  onUsage?: (record: TokenUsageRecord) => void,
): WorldSeeder {
  const provider = runtime.provider
  if (!runtime.enabled || !provider?.model?.trim()) return { available: false, generate: async () => { throw new Error('世界播种器未配置模型。') } }
  const client = new OpenAICompatibleNarrator(ctx, modelConfig, true, onUsage)
  return {
    available: true,
    generate: (userPayload, opts) => client.customSideTask<unknown>(
      provider, '世界播种', runtime.timeout, runtime.temperature, runtime.maxTokens,
      worldSeederSystemPrompt(undefined, opts?.weatherHandledByHost === true), userPayload,
    ),
  }
}
