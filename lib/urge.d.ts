/** Scheduling metadata only: never a contact decision or a memory source.
 * P3.2（设计 §9）：Urge 收敛为生活推进调度——联系专用状态（value 意愿值、
 * armed/burst/spent、contactMin、意愿抖动与 extremeChance）退役；保留对话
 * 密度桶、五档生活节奏倍率、slow/normal、建议间隔、基础退避与休息窗口
 * 兜底。旧持久化字段在加载归一时被清理（一次性迁移语义）。 */
export interface UrgeConfig {
    enabled?: boolean;
    frequency?: 'low' | 'medium' | 'high' | 'custom';
    advanced?: {
        idleMin?: number;
        idleMax?: number;
        slowMin?: number;
        slowMax?: number;
        halfLifeMinutes?: number;
        /** 密度=1 时的推进加速倍率（默认 1.4；与节奏倍率相乘）。 */
        activeMultiplier?: number;
        /** 无节奏数据时的 restWindows 兜底倍率（默认 0.6；乘法，不再替换间隔）。 */
        restMultiplier?: number;
    };
}
export interface UrgeState {
    version: 1;
    mode?: string;
    buckets: number[];
    pace?: 'normal' | 'slow';
    suggested?: number;
    sourceEntryId?: number;
    reason?: string;
    /** 主叙事轻量节奏覆盖(五档;commitUrge 从模型 urge 交接提取)。 */
    rhythmAttention?: string;
}
export declare function resolveUrgeConfig(raw?: UrgeConfig): {
    enabled: boolean;
    frequency: string;
    idle: readonly [number, number];
    slow: readonly [number, number];
    halfLife: number;
    activeMultiplier: number;
    restMultiplier: number;
};
export type ResolvedUrgeConfig = ReturnType<typeof resolveUrgeConfig>;
export declare function normalizeUrgeState(raw: unknown, now: number): UrgeState;
export declare function urgeUserEvent(state: UrgeState, now: number): UrgeState;
export declare function urgeDensity(state: UrgeState, now: number, c: ResolvedUrgeConfig): number;
export declare function commitUrge(state: UrgeState, raw: unknown, script: string, entryId: number, _target: string | undefined, _now: number, _c: ResolvedUrgeConfig): UrgeState;
/** 五档生活节奏 → 推进密度倍率。与 activeMultiplier 相乘决定最终间隔。 */
export declare const ATTENTION_MULTIPLIERS: Record<string, number>;
export interface UrgeRhythmInput {
    attention?: string;
    /** 节奏已过期(stale)或缺失时为 true → 走 restMultiplier 兜底。 */
    stale?: boolean;
}
export declare function planUrge(state: UrgeState, now: number, c: ResolvedUrgeConfig, restMinutes?: number, unavailable?: boolean, random?: () => number, rhythm?: UrgeRhythmInput): {
    state: {
        version: 1;
        mode?: string;
        buckets: number[];
        pace?: "normal" | "slow";
        suggested?: number;
        sourceEntryId?: number;
        reason?: string;
        /** 主叙事轻量节奏覆盖(五档;commitUrge 从模型 urge 交接提取)。 */
        rhythmAttention?: string;
    };
    nextAdvanceAt: string;
    minutes: number;
    reason: string;
};
export declare function urgeInstruction(enabled: boolean, phase: string): "\nAfter writing the full script and its actions, optionally return urge:{pace:\"normal\"|\"slow\", suggestedDelayMinutes:number, rhythmAttention:\"phone-focused|available|occupied|resting|asleep\", basisQuote:\"exact sentence from this script\"}. Reflect the protagonist's natural next opportunity to continue life; slow suits sleep or sustained focus. rhythmAttention is her current life rhythm judged from the script you just wrote (phone-focused = actively using her phone, occupied = busy with a task, resting = lying down or low-energy, asleep = sleeping). This is only a scheduling handoff, not speech, a future event, or a contact decision — outbound contact belongs to the CONTACT ACTIONS contract." | "";
