/**
 * I-2 待叙事显著度（设计 v2.4 §2 I-2 / §5 步骤 4）：被即时门控暂缓的群批次
 * 累积轻量、可衰减的调度显著度，让下一次 advance（她拿起手机的时机）提前。
 *
 * 公理边界：显著度只调度"何时让生活流动一段"（复用既有 advance 入口与
 * nextAdvanceAt）；批次对她意味着什么、她是否回应，由剧本写出。
 *
 * 覆盖消费（v2.3 双标记的最小实现）：
 * - 内容覆盖（背景原文已呈现 / 群触发回合把批次作为当前事件）→ 完全消费；
 * - 概况覆盖（仅徽章摘要呈现）→ 部分消费（×0.5）；
 * - 未覆盖批次保留资格（衰减自然退场，不永久催动）。
 *
 * 调度安全（对齐 §7.6 正确性基础与 F2 教训）：只提前不推后、未来下界、
 * 幂等（仅当早于现有 nextAdvanceAt 才写）、批键去重防同批双计。
 */
export interface GroupSalienceState {
  score: number
  /** 最近已计入的批次键（防同批双计；定长截断）。 */
  batchKeys: string[]
  updatedAt: number
}

export interface SalienceConfig {
  /** 半衰期（分钟）。 */
  halfLifeMinutes: number
  /** 每群显著度上限。 */
  cap: number
  /** 触发瞥视的阈值。 */
  triggerThreshold: number
  /** 瞥视最早提前至（毫秒，未来下界）。 */
  glanceMinDelayMs: number
  /** 瞥视最大延迟（分数=0 时）。 */
  glanceMaxDelayMs: number
  /** 每群保留的批次键上限。 */
  maxBatchKeys: number
}

export const DEFAULT_SALIENCE_CONFIG: SalienceConfig = {
  halfLifeMinutes: 30,
  cap: 6,
  triggerThreshold: 1.5,
  glanceMinDelayMs: 90_000,
  glanceMaxDelayMs: 6 * 60_000,
  maxBatchKeys: 24,
}

export function decayScore(score: number, updatedAt: number, now: number, config: SalienceConfig): number {
  const elapsed = Math.max(0, now - updatedAt)
  const factor = 0.5 ** (elapsed / (Math.max(1, config.halfLifeMinutes) * 60_000))
  const decayed = score * factor
  return decayed < 0.05 ? 0 : decayed
}

function decayGroup(state: GroupSalienceState | undefined, now: number, config: SalienceConfig): GroupSalienceState | undefined {
  if (!state) return undefined
  const score = decayScore(state.score, state.updatedAt, now, config)
  return score <= 0 ? undefined : { ...state, score, updatedAt: now }
}

/** 门拦截批次 → 累积显著度（回合关联批次加权；批键去重；上限封顶）。 */
export function recordBlockedBatch(
  previous: Record<string, GroupSalienceState> | undefined,
  groupId: string,
  input: { turnRelated: boolean, batchKey?: string, now: number },
  config: SalienceConfig = DEFAULT_SALIENCE_CONFIG,
): Record<string, GroupSalienceState> {
  const states: Record<string, GroupSalienceState> = {}
  for (const [group, state] of Object.entries(previous ?? {})) {
    const decayed = decayGroup(state, input.now, config)
    if (decayed) states[group] = decayed
  }
  const current = states[groupId]
  const batchKey = input.batchKey?.slice(0, 200) || ''
  // 同批双计防护：批键已计入则不重复累积。
  if (batchKey && current?.batchKeys.includes(batchKey)) {
    return states
  }
  const base = decayGroup(current, input.now, config)
  const contribution = input.turnRelated ? 2 : 1
  states[groupId] = {
    score: Math.min(config.cap, (base?.score ?? 0) + contribution),
    batchKeys: [...(base?.batchKeys ?? []), ...(batchKey ? [batchKey] : [])].slice(-config.maxBatchKeys),
    updatedAt: input.now,
  }
  return states
}

/** 瞥视延迟：分数越高越早（cap 时到达未来下界）。 */
export function salienceGlanceDelayMs(score: number, config: SalienceConfig = DEFAULT_SALIENCE_CONFIG): number {
  const clamped = Math.max(0, Math.min(config.cap, score))
  const ratio = 1 - clamped / config.cap
  return Math.round(config.glanceMinDelayMs + (config.glanceMaxDelayMs - config.glanceMinDelayMs) * ratio)
}

/** 推进成功后的覆盖消费：内容覆盖完全消费（移除），概况覆盖部分消费（×0.5）。 */
export function consumeSalience(
  previous: Record<string, GroupSalienceState> | undefined,
  presented: Array<{ groupId: string, contentCovered: boolean }>,
  now: number,
  config: SalienceConfig = DEFAULT_SALIENCE_CONFIG,
): Record<string, GroupSalienceState> {
  const states: Record<string, GroupSalienceState> = {}
  for (const [group, state] of Object.entries(previous ?? {})) {
    const decayed = decayGroup(state, now, config)
    if (decayed) states[group] = decayed
  }
  for (const item of presented) {
    const current = states[item.groupId]
    if (!current) continue
    if (item.contentCovered) {
      delete states[item.groupId]
    } else {
      const halved = current.score * 0.5
      if (halved < 0.05) delete states[item.groupId]
      else states[item.groupId] = { ...current, score: halved, updatedAt: now }
    }
  }
  return states
}

/** 全故事当前最高（已衰减）显著度——用于瞥视判定。 */
export function maxSalienceScore(previous: Record<string, GroupSalienceState> | undefined, now: number, config: SalienceConfig = DEFAULT_SALIENCE_CONFIG): number {
  let max = 0
  for (const state of Object.values(previous ?? {})) {
    max = Math.max(max, decayScore(state.score, state.updatedAt, now, config))
  }
  return max
}
