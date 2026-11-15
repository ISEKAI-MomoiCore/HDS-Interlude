/**
 * 对话密度自适应的原始剧本条目预算（auto 模式，方案 A）。
 *
 * 密度信号：每故事的入站消息时间戳（私聊+群聊都计入同一故事轨迹），
 * 按 5/15/30 分钟三个窗口计数，映射四档：
 *   burst（极高）/ high / normal / low；advance 相位固定用推进档。
 * 档位条目数可按 私聊/群聊 分别配置（mode 可 inherit 跟随顶层一致）。
 *
 * 方案 A 语义：auto 模式下生效条目数是**硬上限**——时间窗并入的条目
 * 同样受它约束（fixed 模式维持现状"条目数 ∪ 时间窗"语义不变）。
 * normal 档始终等于锚点 contextEntryLimit（用户调锚点即调日常档）。
 */

export type ContextEntryScope = 'private' | 'group'
export type ContextEntryMode = 'fixed' | 'auto'
export type ScopeMode = 'inherit' | ContextEntryMode
export type DensityTier = 'burst' | 'high' | 'normal' | 'low'

export interface ContextEntryTiers {
  /** 极高密度（连发轰炸）：默认 12。 */
  burst: number
  /** 高密度：默认 15。normal 档恒等于锚点 contextEntryLimit，不在此配置。 */
  high: number
  /** 低密度（安静了一阵）：默认 22。 */
  low: number
  /** 自动推进相位固定档：默认 25。 */
  advance: number
}

export interface ScopeContextEntryConfig {
  mode: ScopeMode
  tiers: ContextEntryTiers
}

export interface ContextEntryAutoConfig {
  /** 顶层一致模式；scope 未覆写时两聊天类型共用。 */
  mode: ContextEntryMode
  private: ScopeContextEntryConfig
  group: ScopeContextEntryConfig
}

export const DEFAULT_CONTEXT_ENTRY_TIERS: ContextEntryTiers = { burst: 12, high: 15, low: 22, advance: 25 }

export const DEFAULT_CONTEXT_ENTRY_AUTO: ContextEntryAutoConfig = {
  mode: 'fixed',
  private: { mode: 'inherit', tiers: { ...DEFAULT_CONTEXT_ENTRY_TIERS } },
  group: { mode: 'inherit', tiers: { ...DEFAULT_CONTEXT_ENTRY_TIERS } },
}

const clampEntries = (value: number) => Math.max(4, Math.min(Math.floor(value) || 18, 200))

export function resolveContextEntryTiers(value: unknown): ContextEntryTiers {
  const raw = (value ?? {}) as Partial<ContextEntryTiers>
  return {
    burst: clampEntries(Number(raw.burst) || DEFAULT_CONTEXT_ENTRY_TIERS.burst),
    high: clampEntries(Number(raw.high) || DEFAULT_CONTEXT_ENTRY_TIERS.high),
    low: clampEntries(Number(raw.low) || DEFAULT_CONTEXT_ENTRY_TIERS.low),
    advance: clampEntries(Number(raw.advance) || DEFAULT_CONTEXT_ENTRY_TIERS.advance),
  }
}

export function resolveContextEntryAutoConfig(value: unknown): ContextEntryAutoConfig {
  const raw = (value ?? {}) as { mode?: unknown; private?: unknown; group?: unknown }
  const scope = (input: unknown): ScopeContextEntryConfig => {
    const scopeRaw = (input ?? {}) as { mode?: unknown; tiers?: unknown }
    const mode: ScopeMode = scopeRaw.mode === 'fixed' || scopeRaw.mode === 'auto' || scopeRaw.mode === 'inherit'
      ? scopeRaw.mode
      : 'inherit'
    return { mode, tiers: resolveContextEntryTiers(scopeRaw.tiers) }
  }
  return {
    mode: raw.mode === 'auto' ? 'auto' : 'fixed',
    private: scope(raw.private),
    group: scope(raw.group),
  }
}

// ── 密度轨迹：入站消息时间戳（轻量内存，重载归零即可接受——30 分钟窗口
// 的计数丢失只会让首轮回落 normal 档，无正确性风险）。 ────────────────────

export class ConversationDensityTracker {
  private readonly arrivals = new Map<string, number[]>()
  private static readonly WINDOW_MS = 30 * 60_000

  record(storyId: string, at: number): void {
    const list = this.arrivals.get(storyId) ?? []
    list.push(at)
    const cutoff = at - ConversationDensityTracker.WINDOW_MS
    while (list.length && list[0] < cutoff) list.shift()
    this.arrivals.set(storyId, list)
  }

  counts(storyId: string, now: number): { count5: number, count15: number, count30: number } {
    const list = (this.arrivals.get(storyId) ?? []).filter(at => at > now - ConversationDensityTracker.WINDOW_MS)
    return {
      count5: list.filter(at => at > now - 5 * 60_000).length,
      count15: list.filter(at => at > now - 15 * 60_000).length,
      count30: list.length,
    }
  }
}

/** 四档判定（阈值常量与档位条目一样是可调设计参数；初值按日常聊天节奏标定）。 */
export function densityTier(counts: { count5: number, count15: number, count30: number }): DensityTier {
  if (counts.count5 >= 4) return 'burst'
  if (counts.count5 >= 2 || counts.count15 >= 4) return 'high'
  if (counts.count30 === 0) return 'low'
  return 'normal'
}

/** scope 生效模式：scope 覆写优先，inherit 跟随顶层。 */
export function effectiveScopeMode(config: ContextEntryAutoConfig, scope: ContextEntryScope): ContextEntryMode {
  const scopeConfig = scope === 'group' ? config.group : config.private
  return scopeConfig.mode === 'inherit' ? config.mode : scopeConfig.mode
}

/**
 * 生效条目预算。fixed 模式返回锚点原值（调用方维持现状并集语义）；
 * auto 模式返回档位条目数（advance 相位固定用推进档，其余按密度档），
 * 调用方以返回值作为硬上限（方案 A）。
 */
export function effectiveContextEntryLimit(input: {
  config: ContextEntryAutoConfig
  scope: ContextEntryScope
  anchor: number
  phase: string
  tier: DensityTier
}): number {
  const mode = effectiveScopeMode(input.config, input.scope)
  if (mode === 'fixed') return clampEntries(input.anchor)
  const tiers = (input.scope === 'group' ? input.config.group : input.config.private).tiers
  if (input.phase === 'advance') return clampEntries(tiers.advance)
  if (input.tier === 'burst') return clampEntries(tiers.burst)
  if (input.tier === 'high') return clampEntries(tiers.high)
  if (input.tier === 'low') return clampEntries(tiers.low)
  return clampEntries(input.anchor)
}
