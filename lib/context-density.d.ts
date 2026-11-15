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
export type ContextEntryScope = 'private' | 'group';
export type ContextEntryMode = 'fixed' | 'auto';
export type ScopeMode = 'inherit' | ContextEntryMode;
export type DensityTier = 'burst' | 'high' | 'normal' | 'low';
export interface ContextEntryTiers {
    /** 极高密度（连发轰炸）：默认 12。 */
    burst: number;
    /** 高密度：默认 15。normal 档恒等于锚点 contextEntryLimit，不在此配置。 */
    high: number;
    /** 低密度（安静了一阵）：默认 22。 */
    low: number;
    /** 自动推进相位固定档：默认 25。 */
    advance: number;
}
export interface ScopeContextEntryConfig {
    mode: ScopeMode;
    tiers: ContextEntryTiers;
}
export interface ContextEntryAutoConfig {
    /** 顶层一致模式；scope 未覆写时两聊天类型共用。 */
    mode: ContextEntryMode;
    private: ScopeContextEntryConfig;
    group: ScopeContextEntryConfig;
}
export declare const DEFAULT_CONTEXT_ENTRY_TIERS: ContextEntryTiers;
export declare const DEFAULT_CONTEXT_ENTRY_AUTO: ContextEntryAutoConfig;
export declare function resolveContextEntryTiers(value: unknown): ContextEntryTiers;
export declare function resolveContextEntryAutoConfig(value: unknown): ContextEntryAutoConfig;
export declare class ConversationDensityTracker {
    private readonly arrivals;
    private static readonly WINDOW_MS;
    record(storyId: string, at: number): void;
    counts(storyId: string, now: number): {
        count5: number;
        count15: number;
        count30: number;
    };
}
/** 四档判定（阈值常量与档位条目一样是可调设计参数；初值按日常聊天节奏标定）。 */
export declare function densityTier(counts: {
    count5: number;
    count15: number;
    count30: number;
}): DensityTier;
/** scope 生效模式：scope 覆写优先，inherit 跟随顶层。 */
export declare function effectiveScopeMode(config: ContextEntryAutoConfig, scope: ContextEntryScope): ContextEntryMode;
/**
 * 生效条目预算。fixed 模式返回锚点原值（调用方维持现状并集语义）；
 * auto 模式返回档位条目数（advance 相位固定用推进档，其余按密度档），
 * 调用方以返回值作为硬上限（方案 A）。
 */
export declare function effectiveContextEntryLimit(input: {
    config: ContextEntryAutoConfig;
    scope: ContextEntryScope;
    anchor: number;
    phase: string;
    tier: DensityTier;
}): number;
