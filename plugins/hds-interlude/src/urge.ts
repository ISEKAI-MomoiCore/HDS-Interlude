/** Scheduling metadata only: never a contact decision or a memory source.
 * P3.2（设计 §9）：Urge 收敛为生活推进调度——联系专用状态（value 意愿值、
 * armed/burst/spent、contactMin、意愿抖动与 extremeChance）退役；保留对话
 * 密度桶、五档生活节奏倍率、slow/normal、建议间隔、基础退避与休息窗口
 * 兜底。旧持久化字段在加载归一时被清理（一次性迁移语义）。 */
export interface UrgeConfig {
  enabled?: boolean
  frequency?: 'low' | 'medium' | 'high' | 'custom'
  advanced?: {
    idleMin?: number; idleMax?: number
    slowMin?: number; slowMax?: number
    halfLifeMinutes?: number
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
  pace?: 'normal' | 'slow'
  suggested?: number
  sourceEntryId?: number
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
    idle: range('idle', 2), slow: range('slow', 6),
    halfLife: finite(a.halfLifeMinutes, 90, 5, 240),
    activeMultiplier: finite(a.activeMultiplier, 1.4, 1.0, 3.0),
    restMultiplier: finite(a.restMultiplier, 0.6, 0.05, 1.0),
  }
}
export type ResolvedUrgeConfig = ReturnType<typeof resolveUrgeConfig>
export function normalizeUrgeState(raw: unknown, now: number): UrgeState {
  const r = record(raw)
  if (r.version !== 1) return { version: 1, buckets: [] }
  const timestamp = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= now
  return {
    version: 1, mode: typeof r.mode === 'string' ? r.mode : undefined,
    buckets: Array.isArray(r.buckets) ? [...new Set(r.buckets.filter((v): v is number => timestamp(v) && now - v < 240 * minute))].sort((a, b) => a - b).slice(-120) : [],
    pace: r.pace === 'slow' ? 'slow' : 'normal', suggested: typeof r.suggested === 'number' ? finite(r.suggested, 120, 1, 1440) : undefined,
    sourceEntryId: typeof r.sourceEntryId === 'number' ? r.sourceEntryId : undefined,
    reason: typeof r.reason === 'string' ? r.reason.slice(0, 160) : undefined,
    rhythmAttention: typeof r.rhythmAttention === 'string' && ATTENTION_MULTIPLIERS[r.rhythmAttention] !== undefined ? r.rhythmAttention : undefined,
  }
}
export function urgeUserEvent(state: UrgeState, now: number): UrgeState {
  // Two-minute buckets merge typing fragments; only real incoming events call this.
  const bucket = Math.floor(now / (2 * minute)) * 2 * minute
  return { ...state, buckets: [...new Set([...state.buckets, bucket])].slice(-120), pace: 'normal', suggested: undefined }
}
export function urgeDensity(state: UrgeState, now: number, c: ResolvedUrgeConfig) {
  const last = state.buckets.at(-1)
  if (last === undefined) return 0
  const recent = state.buckets.filter(t => t >= last - 15 * minute).length
  return Math.min(1, recent / 6) * Math.pow(.5, Math.max(0, now - last) / (c.halfLife * minute))
}
export function commitUrge(state: UrgeState, raw: unknown, script: string, entryId: number, _target: string | undefined, _now: number, _c: ResolvedUrgeConfig): UrgeState {
  void _target; void _c; void _now
  const r = record(raw)
  const quote = typeof r.basisQuote === 'string' ? r.basisQuote.trim() : ''
  // A missing/invalid handoff cannot perpetuate an old slow phase.
  if (!quote || !script.includes(quote)) return { ...state, pace: 'normal', suggested: undefined }
  const pace = r.pace === 'slow' ? 'slow' : 'normal'
  const rhythmAttention = typeof r.rhythmAttention === 'string' && ATTENTION_MULTIPLIERS[r.rhythmAttention] !== undefined
    ? r.rhythmAttention : undefined
  return { ...state, sourceEntryId: entryId,
    ...(rhythmAttention ? { rhythmAttention } : {}),
    pace, suggested: typeof r.suggestedDelayMinutes === 'number' ? finite(r.suggestedDelayMinutes, 120, 1, 1440) : undefined }
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
  const next = { ...state }
  let minutes: number, reason: string
  if (state.pace === 'slow') {
    const suggested = state.suggested === undefined ? sample(c.slow) : Math.max(c.slow[0], Math.min(c.slow[1], state.suggested * (.9 + random() * .2)))
    minutes = suggested; reason = 'script-slow'
  } else {
    // 乘法模型：基础间隔 / (密度因子 × 节奏因子)。密度高+盯手机=最密推进，
    // 沉默+睡眠=最稀。确定性到期承诺优先于调度抖动（§9）。
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
  }
  next.reason = reason
  return { state: next, nextAdvanceAt: new Date(now + minutes * minute).toISOString(), minutes, reason }
}
export function urgeInstruction(enabled: boolean, phase: string) {
  return enabled && ['advance', 'conversation-follow-up', 'intent-due'].includes(phase)
    ? '\nAfter writing the full script and its actions, optionally return urge:{pace:"normal"|"slow", suggestedDelayMinutes:number, rhythmAttention:"phone-focused|available|occupied|resting|asleep", basisQuote:"exact sentence from this script"}. Reflect the protagonist\'s natural next opportunity to continue life; slow suits sleep or sustained focus. rhythmAttention is her current life rhythm judged from the script you just wrote (phone-focused = actively using her phone, occupied = busy with a task, resting = lying down or low-energy, asleep = sleeping). This is only a scheduling handoff, not speech, a future event, or a contact decision — outbound contact belongs to the CONTACT ACTIONS contract.' : ''
}
