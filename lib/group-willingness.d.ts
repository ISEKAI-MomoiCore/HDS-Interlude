/**
 * A deliberately small, model-free willingness layer for group chat. It is
 * inspired by the local score / decay / probability pattern used by YesImBot
 * v3, but remains scoped to one HDSI group and never affects private turns,
 * Agency Window, Alter, prompts, or durable story state.
 */
export interface GroupWillingnessConfig {
    enabled: boolean;
    maxScore: number;
    threshold: number;
    probabilityAmplifier: number;
    decayHalfLifeSeconds: number;
    replyCost: number;
    baseGain: number;
    quoteGain: number;
    keywordGain: number;
    keywords: string[];
}
export interface GroupWillingnessState {
    score: number;
    updatedAt: number;
    /** 回复后跳过计数：下一次触发前需要观察的消息条数（抖动产生）。 */
    skipCount?: number;
}
export type GroupWillingnessReason = 'disabled' | 'forced-mention' | 'below-threshold' | 'probability-roll' | 'asleep' | 'skip-jitter';
export interface GroupWillingnessDecision {
    state: GroupWillingnessState;
    shouldCall: boolean;
    probability: number;
    reason: GroupWillingnessReason;
}
export declare const DEFAULT_GROUP_WILLINGNESS: GroupWillingnessConfig;
export declare function resolveGroupWillingness(config?: Partial<GroupWillingnessConfig>): GroupWillingnessConfig;
export declare function evaluateGroupWillingness(previous: GroupWillingnessState | undefined, configInput: Partial<GroupWillingnessConfig> | undefined, input: {
    now: number;
    messageCount: number;
    content: string;
    quotedBot: boolean;
    mentionedBot: boolean;
    random?: number;
}): GroupWillingnessDecision;
export declare function consumeGroupWillingness(previous: GroupWillingnessState | undefined, configInput: Partial<GroupWillingnessConfig> | undefined, now: number): GroupWillingnessState;
export type WillingnessTier = 'quiet' | 'reserved' | 'normal' | 'active' | 'eager';
export type WillingnessPreset = 'off' | WillingnessTier | 'auto' | 'custom';
export type LifeStatusValue = 'busy' | 'asleep' | 'idle';
/** 档位参数表。基线：normal 约每 4~5 条普通群消息触发一次模型调用
 * （单条批次连续到达、随机数公平时的期望值；密集批次会更快）。 */
export declare const WILLINGNESS_TIERS: Record<WillingnessTier, GroupWillingnessConfig>;
export interface AutoWillingnessConfig {
    busy: WillingnessTier;
    idle: WillingnessTier;
    asleep: WillingnessTier;
}
export declare const DEFAULT_AUTO_WILLINGNESS: AutoWillingnessConfig;
/** 回复后跳过条数的抖动幅度（按档位）：[min, max] 条消息内随机。
 * 效果：eager 不再每条必回（最高跳 3 条→第 4 条才可能再回），
 * normal 从固定 2-3 条变为 1-7 条，quiet 从 3-4 条变为 2-10 条。
 * 节奏调制：phone-focused 减少跳过（她在盯手机,回复更勤），
 * resting/asleep 增加跳过（低能量时更少介入）。 */
export declare const WILLINGNESS_JITTER: Record<WillingnessTier, readonly [number, number]>;
/** 五档节奏 → 跳过条数修正（叠加在档位抖动上）。 */
export declare const RHYTHM_SKIP_MODIFIER: Record<string, number>;
/** 睡眠态安全余量：概率乘数（对压缩器状态过期/误判的兜底）。 */
export declare const ASLEEP_PROBABILITY_MULTIPLIER = 0.2;
/** lifeStatus 超过该时长未刷新时，auto 档按 idle 映射回退。 */
export declare const LIFE_STATUS_STALE_MS: number;
export declare function normalizeLifeStatusDraft(value: unknown): LifeStatusValue | undefined;
export declare function resolveAutoWillingness(value: unknown): AutoWillingnessConfig;
export interface WillingnessGateDiagnosis {
    preset: WillingnessPreset;
    tier?: WillingnessTier;
    /** auto 档有效生活状态；回退时为 idle，不写回剧本状态。 */
    lifeStatus?: LifeStatusValue;
    /** lifeStatus 存在但已过期或无效。 */
    stale?: boolean;
    fallback?: 'missing' | 'invalid' | 'stale';
    asleep: boolean;
}
/** Both successful calls and skipped turns use the same fallback explanation. */
export declare function formatWillingnessGateDiagnosis(diagnosis: WillingnessGateDiagnosis): string;
export interface WillingnessGateDecision extends GroupWillingnessDecision {
    diagnosis: WillingnessGateDiagnosis;
}
/** 档位统一评估门：按 preset 解析参数后走核心打分。auto 档按压缩器写入的
 * lifeStatus 切换档位（三态各可配档位）；asleep 态概率 ×0.2 且 @ 不再直通
 * （她在睡觉，主模型会写她没看手机）。旧配置兼容：preset 为 off 但旧数值门
 * enabled=true 时按 custom 处理，存量行为不变。 */
export declare function evaluateWillingnessGate(previous: GroupWillingnessState | undefined, preset: unknown, autoInput: unknown, lifeStatus: {
    status: unknown;
    updatedAt: string;
} | undefined, legacyInput: Partial<GroupWillingnessConfig> | undefined, input: {
    now: number;
    messageCount: number;
    content: string;
    quotedBot: boolean;
    mentionedBot: boolean;
    random?: number;
}): WillingnessGateDecision;
/** 她在群内成功发言后的意愿扣减，与评估门使用同一档位解析（replyCost 对齐）。 */
export declare function consumeWillingnessGate(previous: GroupWillingnessState | undefined, preset: unknown, autoInput: unknown, lifeStatus: {
    status: unknown;
    updatedAt: string;
} | undefined, legacyInput: Partial<GroupWillingnessConfig> | undefined, now: number, rhythmAttention?: string, random?: () => number): GroupWillingnessState;
