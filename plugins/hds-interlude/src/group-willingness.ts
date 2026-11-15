/**
 * A deliberately small, model-free willingness layer for group chat. It is
 * inspired by the local score / decay / probability pattern used by YesImBot
 * v3, but remains scoped to one HDSI group and never affects private turns,
 * Agency Window, Alter, prompts, or durable story state.
 */
import { LIFE_RHYTHM_STALE_MS } from './story-state'
export interface GroupWillingnessConfig {
  enabled: boolean
  maxScore: number
  threshold: number
  probabilityAmplifier: number
  decayHalfLifeSeconds: number
  replyCost: number
  baseGain: number
  quoteGain: number
  keywordGain: number
  keywords: string[]
}

export interface GroupWillingnessState {
  score: number
  updatedAt: number
  /** 回复后跳过计数：下一次触发前需要观察的消息条数（抖动产生）。 */
  skipCount?: number
}

export type GroupWillingnessReason = 'disabled' | 'forced-mention' | 'below-threshold' | 'probability-roll' | 'asleep' | 'skip-jitter'

export interface GroupWillingnessDecision {
  state: GroupWillingnessState
  shouldCall: boolean
  probability: number
  reason: GroupWillingnessReason
}

export const DEFAULT_GROUP_WILLINGNESS: GroupWillingnessConfig = {
  enabled: false,
  maxScore: 1,
  threshold: 0.24,
  probabilityAmplifier: 1.3,
  decayHalfLifeSeconds: 180,
  replyCost: 0.55,
  baseGain: 0.12,
  quoteGain: 0.12,
  keywordGain: 0.18,
  keywords: [],
}

export function resolveGroupWillingness(config?: Partial<GroupWillingnessConfig>): GroupWillingnessConfig {
  return {
    ...DEFAULT_GROUP_WILLINGNESS,
    ...config,
    keywords: (config?.keywords ?? DEFAULT_GROUP_WILLINGNESS.keywords).map(item => String(item).trim()).filter(Boolean).slice(0, 30),
  }
}

export function evaluateGroupWillingness(
  previous: GroupWillingnessState | undefined,
  configInput: Partial<GroupWillingnessConfig> | undefined,
  input: { now: number; messageCount: number; content: string; quotedBot: boolean; mentionedBot: boolean; sessionActive?: boolean; attentionBusy?: boolean; random?: number; skipJitter?: boolean },
): GroupWillingnessDecision {
  const config = resolveGroupWillingness(configInput)
  const state = decay(previous, config, input.now)
  if (!config.enabled) return { state, shouldCall: true, probability: 1, reason: 'disabled' }

  // 回复后跳过抖动：skipCount > 0 时观察消息但不参与评分。@ 直通（不清零
  // 跳过计数，下一次仍需消耗剩余条数——否则一次 @ 就重置整个抖动周期）。
  // §3.2 微调一：引用她的消息同样放行——回复她的话不是"又一条消息"，是
  // 接她的话（会话内响应 92% vs 冷启动 72%，CHI06）；计数不清零，同 @。
  // I-1 会话迟滞：她近期（确认送达的群消息在窗口内）参与对话时，抖动
  // 让位于会话延续——skipCount 视为已观察完毕但不消耗（退出会话态后恢复）。
  // §7.6.3 兼容选项：skipJitter=false 关闭整条观察路径（不进入不递减）。
  if ((state.skipCount ?? 0) > 0 && input.skipJitter !== false && !input.mentionedBot && !input.quotedBot && !input.sessionActive) {
    state.skipCount = Math.max(0, (state.skipCount ?? 0) - input.messageCount)
    return { state: { ...state, updatedAt: input.now }, shouldCall: false, probability: 0, reason: 'skip-jitter' }
  }

  const keywordHit = config.keywords.some(keyword => input.content.includes(keyword))
  const rawGain = config.baseGain * Math.max(1, Math.min(3, input.messageCount))
    + (input.quotedBot ? config.quoteGain : 0)
    + (keywordHit ? config.keywordGain : 0)
  const marginal = 1 - Math.min(1, state.score / config.maxScore) ** 2
  state.score = clamp(state.score + rawGain * Math.max(0, marginal), 0, config.maxScore)

  if (input.mentionedBot) return { state, shouldCall: true, probability: 1, reason: 'forced-mention' }
  // I-3 共享注意力：私聊活跃（她在跟人认真说话）时收紧群门槛——可解释的分档
  // （阈值 × 1.5），不做硬拒（@ 与引用照常走各自通道；只读消费既有信号）。
  const effectiveThreshold = input.attentionBusy ? config.threshold * 1.5 : config.threshold
  if (state.score <= effectiveThreshold) return { state, shouldCall: false, probability: 0, reason: 'below-threshold' }
  const probability = clamp((state.score - effectiveThreshold) * config.probabilityAmplifier, 0, 1)
  return {
    state,
    shouldCall: (input.random ?? Math.random()) < probability,
    probability,
    reason: 'probability-roll',
  }
}

export function consumeGroupWillingness(
  previous: GroupWillingnessState | undefined,
  configInput: Partial<GroupWillingnessConfig> | undefined,
  now: number,
): GroupWillingnessState {
  const config = resolveGroupWillingness(configInput)
  const state = decay(previous, config, now)
  return { score: Math.max(0, state.score - config.replyCost), updatedAt: now }
}

function decay(previous: GroupWillingnessState | undefined, config: GroupWillingnessConfig, now: number): GroupWillingnessState {
  const score = previous?.score ?? 0
  const elapsedSeconds = Math.max(0, now - (previous?.updatedAt ?? now)) / 1_000
  const factor = 0.5 ** (elapsedSeconds / Math.max(1, config.decayHalfLifeSeconds))
  // skipCount 由消息条数递减,不随时间衰减——长时间沉默后仍需观察到足够
  // 条数才重新触发(防止"回复后隔一天,第一条消息就立即又回"的节律断裂)。
  return { score: score * factor < 0.001 ? 0 : score * factor, updatedAt: now, ...(previous?.skipCount ? { skipCount: previous.skipCount } : {}) }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

// ── 档位化（preset）：数值参数收进预设表，Console 只选档位 ──────────────────

export type WillingnessTier = 'quiet' | 'reserved' | 'normal' | 'active' | 'eager'
export type WillingnessPreset = 'off' | WillingnessTier | 'auto' | 'custom'

/** auto 档的三桶（档位配置键，沿用旧三态命名）。 */
export type WillingnessBucket = 'busy' | 'asleep' | 'idle'

/** 7.1.4 统一事实源：五档生活节奏 → 三桶映射（与压缩器旧派生同映射）。
 * phone-focused/available/resting 都按 idle 桶处理。 */
export function rhythmTierBucket(attention: string): WillingnessBucket | undefined {
  if (attention === 'occupied') return 'busy'
  if (attention === 'asleep') return 'asleep'
  if (attention === 'phone-focused' || attention === 'available' || attention === 'resting') return 'idle'
  return undefined
}

/** 档位参数表。基线：normal 约每 4~5 条普通群消息触发一次模型调用
 * （单条批次连续到达、随机数公平时的期望值；密集批次会更快）。 */
export const WILLINGNESS_TIERS: Record<WillingnessTier, GroupWillingnessConfig> = {
  quiet: { enabled: true, maxScore: 2, threshold: 0.80, probabilityAmplifier: 1.1, decayHalfLifeSeconds: 150, replyCost: 0.85, baseGain: 0.12, quoteGain: 0.08, keywordGain: 0.12, keywords: [] },
  reserved: { enabled: true, maxScore: 2, threshold: 0.75, probabilityAmplifier: 1.25, decayHalfLifeSeconds: 200, replyCost: 0.85, baseGain: 0.17, quoteGain: 0.12, keywordGain: 0.16, keywords: [] },
  normal: { enabled: true, maxScore: 2, threshold: 0.62, probabilityAmplifier: 1.4, decayHalfLifeSeconds: 240, replyCost: 0.80, baseGain: 0.25, quoteGain: 0.15, keywordGain: 0.20, keywords: [] },
  active: { enabled: true, maxScore: 2, threshold: 0.30, probabilityAmplifier: 1.6, decayHalfLifeSeconds: 300, replyCost: 0.60, baseGain: 0.34, quoteGain: 0.20, keywordGain: 0.25, keywords: [] },
  eager: { enabled: true, maxScore: 2, threshold: 0.10, probabilityAmplifier: 1.8, decayHalfLifeSeconds: 360, replyCost: 0.50, baseGain: 0.45, quoteGain: 0.28, keywordGain: 0.30, keywords: [] },
}

export interface AutoWillingnessConfig {
  busy: WillingnessTier
  idle: WillingnessTier
  asleep: WillingnessTier
}

export const DEFAULT_AUTO_WILLINGNESS: AutoWillingnessConfig = { busy: 'quiet', idle: 'active', asleep: 'quiet' }

/** 回复后跳过条数的抖动幅度（按档位）：[min, max] 条消息内随机。
 * 效果：eager 不再每条必回（最高跳 3 条→第 4 条才可能再回），
 * normal 从固定 2-3 条变为 1-7 条，quiet 从 3-4 条变为 2-10 条。
 * 节奏调制：phone-focused 减少跳过（她在盯手机,回复更勤），
 * resting/asleep 增加跳过（低能量时更少介入）。 */
export const WILLINGNESS_JITTER: Record<WillingnessTier, readonly [number, number]> = {
  quiet: [1, 9],
  reserved: [1, 7],
  normal: [0, 6],
  active: [0, 4],
  eager: [0, 3],
}

/** 五档节奏 → 跳过条数修正（叠加在档位抖动上）。 */
export const RHYTHM_SKIP_MODIFIER: Record<string, number> = {
  'phone-focused': -1,
  'available': 0,
  'occupied': 1,
  'resting': 2,
  'asleep': 3,
}

/** 睡眠态安全余量：概率乘数（对节奏过期/误判的兜底）。 */
export const ASLEEP_PROBABILITY_MULTIPLIER = 0.2

/** 7.1.4：生活节奏时效口径统一为 lifeRhythm 的 2 小时（旧 lifeStatus 的
 * 6 小时窗口随字段并入废止——显式语义迁移，见 CHANGELOG）。节奏超过该
 * 时长未刷新时，auto 档按 idle 桶回退。 */
export { LIFE_RHYTHM_STALE_MS }

function normalizeTier(value: unknown): WillingnessTier | undefined {
  return value === 'quiet' || value === 'reserved' || value === 'normal' || value === 'active' || value === 'eager' ? value : undefined
}

export function resolveAutoWillingness(value: unknown): AutoWillingnessConfig {
  const record = !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    busy: normalizeTier(record.busy) ?? DEFAULT_AUTO_WILLINGNESS.busy,
    idle: normalizeTier(record.idle) ?? DEFAULT_AUTO_WILLINGNESS.idle,
    asleep: normalizeTier(record.asleep) ?? DEFAULT_AUTO_WILLINGNESS.asleep,
  }
}

export interface WillingnessGateDiagnosis {
  preset: WillingnessPreset
  tier?: WillingnessTier
  /** auto 档有效生活状态桶（五档节奏经 rhythmTierBucket 映射）；回退时为 idle，不写回剧本状态。 */
  bucket?: WillingnessBucket
  /** 节奏存在但已过期或无效。 */
  stale?: boolean
  fallback?: 'missing' | 'invalid' | 'stale'
  asleep: boolean
}

interface ResolvedWillingnessLayers {
  preset: WillingnessPreset
  /** off/custom 用旧数值参数；tier 用档位表（keywords 恒取旧配置——内容维度与档位正交）。 */
  config: Partial<GroupWillingnessConfig>
  diagnosis: WillingnessGateDiagnosis
}

/** 热身 B（收敛 §7.1.5）：规则解析入口的一次性迁移——旧数值门已启用而档位
 * 未设置或为 off 时，显式归一为 custom。此后 off 稳定表达关闭；分享码、预设
 * 导入与旧配置重载经 groupRule() 读取时走同一入口。幂等。 */
export function normalizeWillingnessPreset<T extends { willingnessPreset?: string, willingness?: { enabled?: boolean } }>(rule: T): T {
  if (rule.willingness?.enabled === true && (!rule.willingnessPreset || rule.willingnessPreset === 'off' || rule.willingnessPreset === '')) {
    return { ...rule, willingnessPreset: 'custom' }
  }
  return rule
}

/** F7：一次性配置迁移（加载时执行并持久化）——历史 off+enabled 规则显式
 * 归一为 custom，并写入 willingnessPresetMigrated 标志。标志落库后
 * groupRule() 不再运行时归一：用户此后显式选择的 off 稳定表达关闭。
 * 返回 undefined 表示已迁移过（跳过）；否则返回下一份 onebot 节
 * （groupChats 已归一 + 标志置 true）。 */
export function migrateWillingnessPresetsConfig(onebot: { groupChats?: unknown[], willingnessPresetMigrated?: boolean } | undefined): { changed: boolean, next: { groupChats: unknown[], willingnessPresetMigrated: true } } | undefined {
  if (onebot?.willingnessPresetMigrated === true) return undefined
  const rules = Array.isArray(onebot?.groupChats) ? onebot!.groupChats! : []
  const migrated = rules.map(rule => normalizeWillingnessPreset(rule as never))
  const changed = migrated.some((rule, index) => rule !== rules[index])
  return { changed, next: { groupChats: migrated, willingnessPresetMigrated: true } }
}

function resolveWillingnessLayers(
  preset: unknown,
  autoInput: unknown,
  lifeRhythm: { attention: unknown, assessedAt: string } | undefined,
  now: number,
  legacyInput: Partial<GroupWillingnessConfig> | undefined,
): ResolvedWillingnessLayers {
  const rawPreset = typeof preset === 'string' ? preset : ''
  // 热身 B：隐式兼容分支已删——旧 enabled+off 组合由 normalizeWillingnessPreset
  // 在规则解析入口（groupRule）归一为 custom；此处 off 稳定表达关闭。
  const resolved = rawPreset === 'quiet' || rawPreset === 'reserved' || rawPreset === 'normal' || rawPreset === 'active' || rawPreset === 'eager' || rawPreset === 'auto' || rawPreset === 'custom'
    ? rawPreset
    : 'off' as const
  const diagnosis: WillingnessGateDiagnosis = { preset: resolved, asleep: false }
  if (resolved === 'off' || resolved === 'custom') {
    return { preset: resolved, config: resolved === 'off' ? { ...legacyInput, enabled: false } : legacyInput ?? {}, diagnosis }
  }
  let tier: WillingnessTier
  if (resolved === 'auto') {
    // 7.1.4：数据源是五档生活节奏（唯一事实源），经三桶映射选档位；
    // 时效口径与 Urge 共用 2 小时（旧 6 小时窗口已废止）。
    const bucket = lifeRhythm ? rhythmTierBucket(String(lifeRhythm.attention)) : undefined
    const assessedAt = lifeRhythm ? Date.parse(lifeRhythm.assessedAt) : Number.NaN
    if (!bucket || !Number.isFinite(assessedAt) || now - assessedAt > LIFE_RHYTHM_STALE_MS) {
      tier = resolveAutoWillingness(autoInput).idle
      diagnosis.bucket = 'idle'
      diagnosis.fallback = !lifeRhythm ? 'missing' : !bucket || !Number.isFinite(assessedAt) ? 'invalid' : 'stale'
      if (lifeRhythm) diagnosis.stale = true
    } else {
      tier = resolveAutoWillingness(autoInput)[bucket]
      diagnosis.bucket = bucket
      diagnosis.asleep = bucket === 'asleep'
    }
  } else {
    tier = resolved
  }
  diagnosis.tier = tier
  return { preset: resolved, config: { ...WILLINGNESS_TIERS[tier], keywords: legacyInput?.keywords ?? [] }, diagnosis }
}

/** Both successful calls and skipped turns use the same fallback explanation. */
export function formatWillingnessGateDiagnosis(diagnosis: WillingnessGateDiagnosis): string {
  if (diagnosis.preset !== 'auto') return diagnosis.tier ?? diagnosis.preset
  const fallback = diagnosis.fallback === 'missing' ? '无状态→'
    : diagnosis.fallback === 'invalid' ? '无效→'
      : diagnosis.fallback === 'stale' ? '过期→' : ''
  return `auto(${fallback}${diagnosis.bucket ?? 'idle'}→${diagnosis.tier}${diagnosis.asleep ? '×0.2' : ''})`
}

export interface WillingnessGateDecision extends GroupWillingnessDecision {
  diagnosis: WillingnessGateDiagnosis
}

/** 档位统一评估门：按 preset 解析参数后走核心打分。auto 档按五档生活节奏
 * （唯一事实源）经三桶映射切换档位（桶各可配档位）；asleep 桶概率 ×0.2 且
 * @ 不再直通（她在睡觉，主模型会写她没看手机）。节奏缺失、无效或超过
 * 2 小时未刷新时按 idle 桶档位回退（7.1.4：与 Urge 共用时效口径）。 */
export function evaluateWillingnessGate(
  previous: GroupWillingnessState | undefined,
  preset: unknown,
  autoInput: unknown,
  lifeRhythm: { attention: unknown, assessedAt: string } | undefined,
  legacyInput: Partial<GroupWillingnessConfig> | undefined,
  input: { now: number, messageCount: number, content: string, quotedBot: boolean, mentionedBot: boolean, sessionActive?: boolean, attentionBusy?: boolean, random?: number, skipJitter?: boolean },
): WillingnessGateDecision {
  const layers = resolveWillingnessLayers(preset, autoInput, lifeRhythm, input.now, legacyInput)
  if (layers.diagnosis.asleep) {
    // 概率乘数独立于档位：先取未乘的概率（random=1 阻断核心掷骰），再手动掷。
    const base = evaluateGroupWillingness(previous, layers.config, { ...input, mentionedBot: false, random: 1 })
    const probability = clamp(base.probability * ASLEEP_PROBABILITY_MULTIPLIER, 0, 1)
    const shouldCall = (input.random ?? Math.random()) < probability
    return { state: base.state, shouldCall, probability, reason: shouldCall ? 'probability-roll' : 'asleep', diagnosis: layers.diagnosis }
  }
  const decision = evaluateGroupWillingness(previous, layers.config, input)
  return { ...decision, diagnosis: layers.diagnosis }
}

/** 她在群内成功发言后的意愿扣减，与评估门使用同一档位解析（replyCost 对齐）。 */
export function consumeWillingnessGate(
  previous: GroupWillingnessState | undefined,
  preset: unknown,
  autoInput: unknown,
  lifeRhythm: { attention: unknown, assessedAt: string } | undefined,
  legacyInput: Partial<GroupWillingnessConfig> | undefined,
  now: number,
  rhythmAttention?: string,
  random: () => number = Math.random,
  skipJitter = true,
): GroupWillingnessState {
  const layers = resolveWillingnessLayers(preset, autoInput, lifeRhythm, now, legacyInput)
  const consumed = consumeGroupWillingness(previous, layers.config, now)
  // 回复成功→掷下一次触发前的跳过条数（档位抖动 + 节奏调制）。
  // §7.6.3 兼容选项：skipJitter=false 时不掷（既有 skipCount 归零，观察路径整体停用）。
  const tier = layers.diagnosis.tier as WillingnessTier | undefined
  const [jitterMin, jitterMax] = tier && WILLINGNESS_JITTER[tier] ? WILLINGNESS_JITTER[tier] : [0, 3] as const
  const rhythmMod = rhythmAttention && RHYTHM_SKIP_MODIFIER[rhythmAttention] !== undefined ? RHYTHM_SKIP_MODIFIER[rhythmAttention] : 0
  const raw = jitterMin + Math.floor(random() * (jitterMax - jitterMin + 1)) + rhythmMod
  return { ...consumed, skipCount: skipJitter === false ? 0 : Math.max(0, raw) }
}
