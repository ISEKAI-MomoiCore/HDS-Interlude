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
    score: number;
    /** 最近已计入的批次键（防同批双计；定长截断）。 */
    batchKeys: string[];
    updatedAt: number;
}
export interface SalienceConfig {
    /** 半衰期（分钟）。 */
    halfLifeMinutes: number;
    /** 每群显著度上限。 */
    cap: number;
    /** 触发瞥视的阈值。 */
    triggerThreshold: number;
    /** 瞥视最早提前至（毫秒，未来下界）。 */
    glanceMinDelayMs: number;
    /** 瞥视最大延迟（分数=0 时）。 */
    glanceMaxDelayMs: number;
    /** 每群保留的批次键上限。 */
    maxBatchKeys: number;
}
export declare const DEFAULT_SALIENCE_CONFIG: SalienceConfig;
export declare function decayScore(score: number, updatedAt: number, now: number, config: SalienceConfig): number;
/** 门拦截批次 → 累积显著度（回合关联批次加权；批键去重；上限封顶）。 */
export declare function recordBlockedBatch(previous: Record<string, GroupSalienceState> | undefined, groupId: string, input: {
    turnRelated: boolean;
    batchKey?: string;
    now: number;
}, config?: SalienceConfig): Record<string, GroupSalienceState>;
/** 瞥视延迟：分数越高越早（cap 时到达未来下界）。 */
export declare function salienceGlanceDelayMs(score: number, config?: SalienceConfig): number;
/** 推进成功后的覆盖消费：内容覆盖完全消费（移除），概况覆盖部分消费（×0.5）。 */
export declare function consumeSalience(previous: Record<string, GroupSalienceState> | undefined, presented: Array<{
    groupId: string;
    contentCovered: boolean;
}>, now: number, config?: SalienceConfig): Record<string, GroupSalienceState>;
/** 全故事当前最高（已衰减）显著度——用于瞥视判定。 */
export declare function maxSalienceScore(previous: Record<string, GroupSalienceState> | undefined, now: number, config?: SalienceConfig): number;
