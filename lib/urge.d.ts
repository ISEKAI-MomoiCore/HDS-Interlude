/** Scheduling metadata only: never a contact decision or a memory source. */
export interface UrgeConfig {
    enabled?: boolean;
    frequency?: 'low' | 'medium' | 'high' | 'custom';
    proactiveWillingnessThreshold?: number;
    advanced?: {
        hotMin?: number;
        hotMax?: number;
        idleMin?: number;
        idleMax?: number;
        burstMin?: number;
        burstMax?: number;
        slowMin?: number;
        slowMax?: number;
        halfLifeMinutes?: number;
        burstThreshold?: number;
        jitter?: number;
        extremeChance?: number;
        burstTtlMinutes?: number;
        burstBudget?: number;
        burstContactMinMinutes?: number;
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
    value?: number;
    pace?: 'normal' | 'slow';
    suggested?: number;
    sourceEntryId?: number;
    armed?: {
        participantId: string;
        entryId: number;
        at: number;
    };
    burst?: {
        participantId: string;
        started: number;
        used: number;
    };
    /** Once spent, only a real incoming event opens a new contact episode. */
    spent?: boolean;
    reason?: string;
    /** 主叙事轻量节奏覆盖(五档;commitUrge 从模型 urge 交接提取)。 */
    rhythmAttention?: string;
}
export declare function resolveUrgeConfig(raw?: UrgeConfig): {
    enabled: boolean;
    frequency: string;
    willingness: number;
    hot: readonly [number, number];
    idle: readonly [number, number];
    burst: readonly [number, number];
    slow: readonly [number, number];
    halfLife: number;
    threshold: number;
    jitter: number;
    extremeChance: number;
    ttl: number;
    budget: number;
    contactMin: number;
    activeMultiplier: number;
    restMultiplier: number;
};
export type ResolvedUrgeConfig = ReturnType<typeof resolveUrgeConfig>;
export declare function normalizeUrgeState(raw: unknown, now: number): UrgeState;
export declare function urgeUserEvent(state: UrgeState, now: number): UrgeState;
export declare function urgeDensity(state: UrgeState, now: number, c: ResolvedUrgeConfig): number;
export declare function commitUrge(state: UrgeState, raw: unknown, script: string, entryId: number, target: string | undefined, now: number, c: ResolvedUrgeConfig, random?: () => number): UrgeState;
export declare function acknowledgeUrge(state: UrgeState, participantId: string, entryId: number, now: number): UrgeState;
export declare function urgeBurstActive(state: UrgeState, now: number, c: ResolvedUrgeConfig, participantId?: string): boolean;
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
        value?: number;
        pace?: "normal" | "slow";
        suggested?: number;
        sourceEntryId?: number;
        armed?: {
            participantId: string;
            entryId: number;
            at: number;
        };
        burst?: {
            participantId: string;
            started: number;
            used: number;
        };
        /** Once spent, only a real incoming event opens a new contact episode. */
        spent?: boolean;
        reason?: string;
        /** 主叙事轻量节奏覆盖(五档;commitUrge 从模型 urge 交接提取)。 */
        rhythmAttention?: string;
    };
    nextAdvanceAt: string;
    minutes: number;
    reason: string;
};
export declare function urgeInstruction(enabled: boolean, phase: string): "" | "\nAfter writing the full script and its actions, optionally return urge:{value:0..1, pace:\"normal\"|\"slow\", suggestedDelayMinutes:number, rhythmAttention:\"phone-focused|available|occupied|resting|asleep\", basisQuote:\"exact sentence from this script\"}. Reflect the protagonist's present impulse and natural next opportunity to continue life; slow suits sleep or sustained focus. rhythmAttention is her current life rhythm judged from the script you just wrote (phone-focused = actively using her phone, occupied = busy with a task, resting = lying down or low-energy, asleep = sleeping). This is only a scheduling handoff, not speech, a future event, or a second contact decision. Continue using the existing authored actions and proactiveContact for any contact.";
