/** Scheduling metadata only: never a contact decision or a memory source. */
export interface UrgeConfig {
  enabled?: boolean
  frequency?: 'low' | 'medium' | 'high' | 'custom'
  proactiveWillingnessThreshold?: number
  advanced?: {
    hotMin?: number; hotMax?: number; idleMin?: number; idleMax?: number
    burstMin?: number; burstMax?: number; slowMin?: number; slowMax?: number
    halfLifeMinutes?: number; burstThreshold?: number; jitter?: number; extremeChance?: number
    burstTtlMinutes?: number; burstBudget?: number; burstContactMinMinutes?: number
    /** 密度=1 时的推进加速倍率（默认 1.4；与节奏倍率相乘）。 */
    activeMultiplier?: number
    /** 无节奏数据时的 restWindows 兜底倍率（默认 0.6；乘法，不再替换间隔）。 */
    restMultiplier?: number
  }
}
export interface UrgeState {
  version: 1
  mode?: string
  buckets: number[]
  value?: number
  pace?: 'normal' | 'slow'
  suggested?: number
  sourceEntryId?: number
  armed?: { participantId: string; entryId: number; at: number }
  burst?: { participantId: string; started: number; used: number }
  /** Once spent, only a real incoming event opens a new contact episode. */
  spent?: boolean
  reason?: string
  /** 主叙事轻量节奏覆盖(五档;commitUrge 从模型 urge 交接提取)。 */
  rhythmAttention?: string
}
const minute = 60_000
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const finite = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback
export function resolveUrgeConfig(raw?: UrgeConfig) {
  const c = record(raw), a = record(c.advanced)
  const frequency = ['low', 'medium', 'high', 'custom'].includes(String(c.frequency)) ? String(c.frequency) : 'medium'
  const defaults = frequency === 'low' ? [20, 30, 60, 90, 5, 10, 120, 180] : frequency === 'high' ? [6, 12, 20, 35, 2, 5, 90, 120] : [10, 20, 35, 55, 3, 7, 110, 130]
  const range = (name: string, i: number) => {
    const lo = finite(a[name + 'Min'], defaults[i], 1, 1440)
    return [lo, Math.max(lo, finite(a[name + 'Max'], defaults[i + 1], 1, 1440))] as const
  }
  return {
    enabled: c.enabled === true, frequency,
    willingness: finite(c.proactiveWillingnessThreshold, .4, 0, 1),
    hot: range('hot', 0), idle: range('idle', 2), burst: range('burst', 4), slow: range('slow', 6),
    halfLife: finite(a.halfLifeMinutes, 90, 5, 240), threshold: finite(a.burstThreshold, .75, 0, 1),
    jitter: finite(a.jitter, .15, 0, 1), extremeChance: finite(a.extremeChance, .03, 0, 1),
    ttl: finite(a.burstTtlMinutes, 35, 5, 120), budget: Math.floor(finite(a.burstBudget, 3, 0, 10)),
    contactMin: finite(a.burstContactMinMinutes, 5, 1, 60),
    activeMultiplier: finite(a.activeMultiplier, 1.4, 1.0, 3.0),
    restMultiplier: finite(a.restMultiplier, 0.6, 0.05, 1.0),
  }
}
export type ResolvedUrgeConfig = ReturnType<typeof resolveUrgeConfig>
export function normalizeUrgeState(raw: unknown, now: number): UrgeState {
  const r = record(raw)
  if (r.version !== 1) return { version: 1, buckets: [] }
  const a = record(r.armed), b = record(r.burst)
  const timestamp = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= now
  return {
    version: 1, mode: typeof r.mode === 'string' ? r.mode : undefined,
    buckets: Array.isArray(r.buckets) ? [...new Set(r.buckets.filter((v): v is number => timestamp(v) && now - v < 240 * minute))].sort((a, b) => a - b).slice(-120) : [],
    value: typeof r.value === 'number' ? finite(r.value, 0, 0, 1) : undefined,
    pace: r.pace === 'slow' ? 'slow' : 'normal', suggested: typeof r.suggested === 'number' ? finite(r.suggested, 120, 1, 1440) : undefined,
    sourceEntryId: typeof r.sourceEntryId === 'number' ? r.sourceEntryId : undefined,
    spent: r.spent === true, reason: typeof r.reason === 'string' ? r.reason.slice(0, 160) : undefined,
    rhythmAttention: typeof r.rhythmAttention === 'string' && ATTENTION_MULTIPLIERS[r.rhythmAttention] !== undefined ? r.rhythmAttention : undefined,
    armed: typeof a.participantId === 'string' && typeof a.entryId === 'number' && timestamp(a.at) && now - Number(a.at) < 10 * minute
      ? { participantId: a.participantId, entryId: a.entryId, at: Number(a.at) } : undefined,
    burst: typeof b.participantId === 'string' && timestamp(b.started)
      ? { participantId: b.participantId, started: Number(b.started), used: Math.floor(finite(b.used, 0, 0, 10)) } : undefined,
  }
}
export function urgeUserEvent(state: UrgeState, now: number): UrgeState {
  // Two-minute buckets merge typing fragments; only real incoming events call this.
  const bucket = Math.floor(now / (2 * minute)) * 2 * minute
  return { ...state, buckets: [...new Set([...state.buckets, bucket])].slice(-120), pace: 'normal', suggested: undefined, armed: undefined, burst: undefined, spent: false }
}
export function urgeDensity(state: UrgeState, now: number, c: ResolvedUrgeConfig) {
  const last = state.buckets.at(-1)
  if (last === undefined) return 0
  const recent = state.buckets.filter(t => t >= last - 15 * minute).length
  return Math.min(1, recent / 6) * Math.pow(.5, Math.max(0, now - last) / (c.halfLife * minute))
}
export function commitUrge(state: UrgeState, raw: unknown, script: string, entryId: number, target: string | undefined, now: number, c: ResolvedUrgeConfig, random = Math.random): UrgeState {
  const r = record(raw)
  const quote = typeof r.basisQuote === 'string' ? r.basisQuote.trim() : ''
  // A missing/invalid handoff cannot perpetuate an old slow phase or burst.
  if (!quote || !script.includes(quote) || typeof r.value !== 'number' || !Number.isFinite(r.value)) return { ...state, pace: 'normal', suggested: undefined, armed: undefined, burst: undefined }
  const value = random() < c.extremeChance ? random() : finite(r.value + (random() * 2 - 1) * c.jitter, 0, 0, 1)
  const pace = r.pace === 'slow' ? 'slow' : 'normal'
  const high = value >= c.threshold && pace !== 'slow'
  const rhythmAttention = typeof r.rhythmAttention === 'string' && ATTENTION_MULTIPLIERS[r.rhythmAttention] !== undefined
    ? r.rhythmAttention : undefined
  return { ...state, value, pace, sourceEntryId: entryId,
    ...(rhythmAttention ? { rhythmAttention } : {}),
    suggested: typeof r.suggestedDelayMinutes === 'number' ? finite(r.suggestedDelayMinutes, 120, 1, 1440) : undefined,
    burst: high ? state.burst : undefined,
    armed: high && target && !state.spent && !state.burst && c.budget > 0 ? { participantId: target, entryId, at: now } : undefined,
  }
}
export function acknowledgeUrge(state: UrgeState, participantId: string, entryId: number, now: number): UrgeState {
  if (!state.armed || state.armed.participantId !== participantId || state.armed.entryId !== entryId || state.spent) return state
  return { ...state, armed: undefined, spent: true, burst: { participantId, started: now, used: 0 } }
}
export function urgeBurstActive(state: UrgeState, now: number, c: ResolvedUrgeConfig, participantId?: string) {
  return !!state.burst && (!participantId || participantId === state.burst.participantId)
    && now - state.burst.started < c.ttl * minute && state.burst.used <= c.budget && state.pace !== 'slow'
}
/** 五档生活节奏 → 推进密度倍率。与 activeMultiplier 相乘决定最终间隔。 */
export const ATTENTION_MULTIPLIERS: Record<string, number> = {
  'phone-focused': 1.4,
  'available': 1.0,
  'occupied': 0.7,
  'resting': 0.5,
  'asleep': 0.15,
}

export interface UrgeRhythmInput {
  attention?: string
  /** 节奏已过期(stale)或缺失时为 true → 走 restMultiplier 兜底。 */
  stale?: boolean
}

export function planUrge(state: UrgeState, now: number, c: ResolvedUrgeConfig, restMinutes = 0, unavailable = false, random = Math.random, rhythm?: UrgeRhythmInput) {
  const sample = (range: readonly number[]) => range[0] + random() * (range[1] - range[0])
  let next = { ...state }
  let minutes: number, reason: string
  if (state.pace === 'slow') {
    const suggested = state.suggested === undefined ? sample(c.slow) : Math.max(c.slow[0], Math.min(c.slow[1], state.suggested * (.9 + random() * .2)))
    minutes = suggested; reason = 'script-slow'
    next = { ...next, burst: undefined, armed: undefined }
  } else if (!unavailable && urgeBurstActive(state, now, c) && state.burst!.used < c.budget) {
    minutes = sample(c.burst) * Math.pow(2, state.burst!.used)
    minutes = Math.min(minutes, Math.max(1, (state.burst!.started + c.ttl * minute - now) / minute))
    reason = 'confirmed-contact-burst'
    next.burst = { ...state.burst!, used: state.burst!.used + 1 }
  } else {
    // 乘法模型：基础间隔 / (密度因子 × 节奏因子)。密度高+盯手机=最密推进，
    // 沉默+睡眠=最稀。hot 区间保留为 burst 专用下限参考，正常通道不再截断。
    const base = sample(c.idle)
    const density = urgeDensity(state, now, c)
    const densityFactor = 1 + density * (c.activeMultiplier - 1)
    let rhythmFactor: number
    if (rhythm?.attention && !rhythm.stale && ATTENTION_MULTIPLIERS[rhythm.attention] !== undefined) {
      rhythmFactor = ATTENTION_MULTIPLIERS[rhythm.attention]
      reason = `rhythm:${rhythm.attention}`
    } else {
      rhythmFactor = restMinutes > 0 ? c.restMultiplier : 1.0
      reason = restMinutes > 0 ? 'rest-window-fallback' : 'conversation-density-decay'
    }
    if (unavailable) rhythmFactor *= 0.5
    minutes = Math.max(1, base / (densityFactor * rhythmFactor))
    next.burst = undefined
    if (unavailable) next.armed = undefined
  }
  next.reason = reason
  return { state: next, nextAdvanceAt: new Date(now + minutes * minute).toISOString(), minutes, reason }
}
export function urgeInstruction(enabled: boolean, phase: string) {
  return enabled && ['advance', 'conversation-follow-up', 'intent-due'].includes(phase)
    ? '\nAfter writing the full script and its actions, optionally return urge:{value:0..1, pace:"normal"|"slow", suggestedDelayMinutes:number, rhythmAttention:"phone-focused|available|occupied|resting|asleep", basisQuote:"exact sentence from this script"}. Reflect the protagonist\'s present impulse and natural next opportunity to continue life; slow suits sleep or sustained focus. rhythmAttention is her current life rhythm judged from the script you just wrote (phone-focused = actively using her phone, occupied = busy with a task, resting = lying down or low-energy, asleep = sleeping). This is only a scheduling handoff, not speech, a future event, or a second contact decision. Continue using the existing authored actions and proactiveContact for any contact.' : ''
}
