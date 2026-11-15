/**
 * A deliberately small, model-free willingness layer for group chat. It is
 * inspired by the local score / decay / probability pattern used by YesImBot
 * v3, but remains scoped to one HDSI group and never affects private turns,
 * Agency Window, Alter, prompts, or durable story state.
 */
import { LIFE_RHYTHM_STALE_MS } from './story-state';
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
    sessionActive?: boolean;
    attentionBusy?: boolean;
    random?: number;
    skipJitter?: boolean;
}): GroupWillingnessDecision;
export declare function consumeGroupWillingness(previous: GroupWillingnessState | undefined, configInput: Partial<GroupWillingnessConfig> | undefined, now: number): GroupWillingnessState;
export type WillingnessTier = 'quiet' | 'reserved' | 'normal' | 'active' | 'eager';
export type WillingnessPreset = 'off' | WillingnessTier | 'auto' | 'custom';
/** auto 档的三桶（档位配置键，沿用旧三态命名）。 */
export type WillingnessBucket = 'busy' | 'asleep' | 'idle';
/** 7.1.4 统一事实源：五档生活节奏 → 三桶映射（与压缩器旧派生同映射）。
 * phone-focused/available/resting 都按 idle 桶处理。 */
export declare function rhythmTierBucket(attention: string): WillingnessBucket | undefined;
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
/** 睡眠态安全余量：概率乘数（对节奏过期/误判的兜底）。 */
export declare const ASLEEP_PROBABILITY_MULTIPLIER = 0.2;
/** 7.1.4：生活节奏时效口径统一为 lifeRhythm 的 2 小时（旧 lifeStatus 的
 * 6 小时窗口随字段并入废止——显式语义迁移，见 CHANGELOG）。节奏超过该
 * 时长未刷新时，auto 档按 idle 桶回退。 */
export { LIFE_RHYTHM_STALE_MS };
export declare function resolveAutoWillingness(value: unknown): AutoWillingnessConfig;
export interface WillingnessGateDiagnosis {
    preset: WillingnessPreset;
    tier?: WillingnessTier;
    /** auto 档有效生活状态桶（五档节奏经 rhythmTierBucket 映射）；回退时为 idle，不写回剧本状态。 */
    bucket?: WillingnessBucket;
    /** 节奏存在但已过期或无效。 */
    stale?: boolean;
    fallback?: 'missing' | 'invalid' | 'stale';
    asleep: boolean;
}
/** 热身 B（收敛 §7.1.5）：规则解析入口的一次性迁移——旧数值门已启用而档位
 * 未设置或为 off 时，显式归一为 custom。此后 off 稳定表达关闭；分享码、预设
 * 导入与旧配置重载经 groupRule() 读取时走同一入口。幂等。 */
export declare function normalizeWillingnessPreset<T extends {
    willingnessPreset?: string;
    willingness?: {
        enabled?: boolean;
    };
}>(rule: T): T;
/** F7：一次性配置迁移（加载时执行并持久化）——历史 off+enabled 规则显式
 * 归一为 custom，并写入 willingnessPresetMigrated 标志。标志落库后
 * groupRule() 不再运行时归一：用户此后显式选择的 off 稳定表达关闭。
 * 返回 undefined 表示已迁移过（跳过）；否则返回下一份 onebot 节
 * （groupChats 已归一 + 标志置 true）。 */
export declare function migrateWillingnessPresetsConfig(onebot: {
    groupChats?: unknown[];
    willingnessPresetMigrated?: boolean;
} | undefined): {
    changed: boolean;
    next: {
        groupChats: unknown[];
        willingnessPresetMigrated: true;
    };
} | undefined;
/** Both successful calls and skipped turns use the same fallback explanation. */
export declare function formatWillingnessGateDiagnosis(diagnosis: WillingnessGateDiagnosis): string;
export interface WillingnessGateDecision extends GroupWillingnessDecision {
    diagnosis: WillingnessGateDiagnosis;
}
/** 档位统一评估门：按 preset 解析参数后走核心打分。auto 档按五档生活节奏
 * （唯一事实源）经三桶映射切换档位（桶各可配档位）；asleep 桶概率 ×0.2 且
 * @ 不再直通（她在睡觉，主模型会写她没看手机）。节奏缺失、无效或超过
 * 2 小时未刷新时按 idle 桶档位回退（7.1.4：与 Urge 共用时效口径）。 */
export declare function evaluateWillingnessGate(previous: GroupWillingnessState | undefined, preset: unknown, autoInput: unknown, lifeRhythm: {
    attention: unknown;
    assessedAt: string;
} | undefined, legacyInput: Partial<GroupWillingnessConfig> | undefined, input: {
    now: number;
    messageCount: number;
    content: string;
    quotedBot: boolean;
    mentionedBot: boolean;
    sessionActive?: boolean;
    attentionBusy?: boolean;
    random?: number;
    skipJitter?: boolean;
}): WillingnessGateDecision;
/** 她在群内成功发言后的意愿扣减，与评估门使用同一档位解析（replyCost 对齐）。 */
export declare function consumeWillingnessGate(previous: GroupWillingnessState | undefined, preset: unknown, autoInput: unknown, lifeRhythm: {
    attention: unknown;
    assessedAt: string;
} | undefined, legacyInput: Partial<GroupWillingnessConfig> | undefined, now: number, rhythmAttention?: string, random?: () => number, skipJitter?: boolean): GroupWillingnessState;
