/**
 * A deliberately small, model-free willingness layer for group chat. It is
 * inspired by the local score / decay / probability pattern used by YesImBot
 * v3, but remains scoped to one HDSI group and never affects private turns,
 * Agency Window, Alter, prompts, or durable story state.
 */
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
  input: { now: number; messageCount: number; content: string; quotedBot: boolean; mentionedBot: boolean; random?: number },
): GroupWillingnessDecision {
  const config = resolveGroupWillingness(configInput)
  const state = decay(previous, config, input.now)
  if (!config.enabled) return { state, shouldCall: true, probability: 1, reason: 'disabled' }

  // 回复后跳过抖动：skipCount > 0 时观察消息但不参与评分。@ 直通（不清零
  // 跳过计数，下一次仍需消耗剩余条数——否则一次 @ 就重置整个抖动周期）。
  if ((state.skipCount ?? 0) > 0) {
    if (!input.mentionedBot) {
      state.skipCount = Math.max(0, (state.skipCount ?? 0) - input.messageCount)
      return { state: { ...state, updatedAt: input.now }, shouldCall: false, probability: 0, reason: 'skip-jitter' }
    }
  }

  const keywordHit = config.keywords.some(keyword => input.content.includes(keyword))
  const rawGain = config.baseGain * Math.max(1, Math.min(3, input.messageCount))
    + (input.quotedBot ? config.quoteGain : 0)
    + (keywordHit ? config.keywordGain : 0)
  const marginal = 1 - Math.min(1, state.score / config.maxScore) ** 2
  state.score = clamp(state.score + rawGain * Math.max(0, marginal), 0, config.maxScore)

  if (input.mentionedBot) return { state, shouldCall: true, probability: 1, reason: 'forced-mention' }
  if (state.score <= config.threshold) return { state, shouldCall: false, probability: 0, reason: 'below-threshold' }
  const probability = clamp((state.score - config.threshold) * config.probabilityAmplifier, 0, 1)
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
export type LifeStatusValue = 'busy' | 'asleep' | 'idle'

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

/** 睡眠态安全余量：概率乘数（对压缩器状态过期/误判的兜底）。 */
export const ASLEEP_PROBABILITY_MULTIPLIER = 0.2

/** lifeStatus 超过该时长未刷新时，auto 档按 idle 映射回退。 */
export const LIFE_STATUS_STALE_MS = 6 * 60 * 60 * 1_000

export function normalizeLifeStatusDraft(value: unknown): LifeStatusValue | undefined {
  return value === 'busy' || value === 'asleep' || value === 'idle' ? value : undefined
}

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
  /** auto 档有效生活状态；回退时为 idle，不写回剧本状态。 */
  lifeStatus?: LifeStatusValue
  /** lifeStatus 存在但已过期或无效。 */
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

function resolveWillingnessLayers(
  preset: unknown,
  autoInput: unknown,
  lifeStatus: { status: unknown, updatedAt: string } | undefined,
  now: number,
  legacyInput: Partial<GroupWillingnessConfig> | undefined,
): ResolvedWillingnessLayers {
  const rawPreset = typeof preset === 'string' ? preset : ''
  const legacyEnabled = legacyInput?.enabled === true
  // 兼容：未设置档位（或显式 off）但旧数值门已启用 → 按存量数值继续（custom）。
  const resolved = legacyEnabled && (rawPreset === '' || rawPreset === 'off')
    ? 'custom' as const
    : rawPreset === 'quiet' || rawPreset === 'reserved' || rawPreset === 'normal' || rawPreset === 'active' || rawPreset === 'eager' || rawPreset === 'auto' || rawPreset === 'custom'
      ? rawPreset
      : 'off' as const
  const diagnosis: WillingnessGateDiagnosis = { preset: resolved, asleep: false }
  if (resolved === 'off' || resolved === 'custom') {
    return { preset: resolved, config: resolved === 'off' ? { ...legacyInput, enabled: false } : legacyInput ?? {}, diagnosis }
  }
  let tier: WillingnessTier
  if (resolved === 'auto') {
    const status = lifeStatus ? normalizeLifeStatusDraft(lifeStatus.status) : undefined
    const updatedAt = lifeStatus ? Date.parse(lifeStatus.updatedAt) : Number.NaN
    if (!status || !Number.isFinite(updatedAt) || now - updatedAt > LIFE_STATUS_STALE_MS) {
      tier = resolveAutoWillingness(autoInput).idle
      diagnosis.lifeStatus = 'idle'
      diagnosis.fallback = !lifeStatus ? 'missing' : !status || !Number.isFinite(updatedAt) ? 'invalid' : 'stale'
      if (lifeStatus) diagnosis.stale = true
    } else {
      tier = resolveAutoWillingness(autoInput)[status]
      diagnosis.lifeStatus = status
      diagnosis.asleep = status === 'asleep'
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
  return `auto(${fallback}${diagnosis.lifeStatus ?? 'idle'}→${diagnosis.tier}${diagnosis.asleep ? '×0.2' : ''})`
}

export interface WillingnessGateDecision extends GroupWillingnessDecision {
  diagnosis: WillingnessGateDiagnosis
}

/** 档位统一评估门：按 preset 解析参数后走核心打分。auto 档按压缩器写入的
 * lifeStatus 切换档位（三态各可配档位）；asleep 态概率 ×0.2 且 @ 不再直通
 * （她在睡觉，主模型会写她没看手机）。旧配置兼容：preset 为 off 但旧数值门
 * enabled=true 时按 custom 处理，存量行为不变。 */
export function evaluateWillingnessGate(
  previous: GroupWillingnessState | undefined,
  preset: unknown,
  autoInput: unknown,
  lifeStatus: { status: unknown, updatedAt: string } | undefined,
  legacyInput: Partial<GroupWillingnessConfig> | undefined,
  input: { now: number, messageCount: number, content: string, quotedBot: boolean, mentionedBot: boolean, random?: number },
): WillingnessGateDecision {
  const layers = resolveWillingnessLayers(preset, autoInput, lifeStatus, input.now, legacyInput)
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
  lifeStatus: { status: unknown, updatedAt: string } | undefined,
  legacyInput: Partial<GroupWillingnessConfig> | undefined,
  now: number,
  rhythmAttention?: string,
  random: () => number = Math.random,
): GroupWillingnessState {
  const layers = resolveWillingnessLayers(preset, autoInput, lifeStatus, now, legacyInput)
  const consumed = consumeGroupWillingness(previous, layers.config, now)
  // 回复成功→掷下一次触发前的跳过条数（档位抖动 + 节奏调制）
  const tier = layers.diagnosis.tier as WillingnessTier | undefined
  const [jitterMin, jitterMax] = tier && WILLINGNESS_JITTER[tier] ? WILLINGNESS_JITTER[tier] : [0, 3] as const
  const rhythmMod = rhythmAttention && RHYTHM_SKIP_MODIFIER[rhythmAttention] !== undefined ? RHYTHM_SKIP_MODIFIER[rhythmAttention] : 0
  const raw = jitterMin + Math.floor(random() * (jitterMax - jitterMin + 1)) + rhythmMod
  return { ...consumed, skipCount: Math.max(0, raw) }
}
