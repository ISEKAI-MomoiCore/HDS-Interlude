/**
 * I-6a 群消息背景通道（设计 v2.4 §2 I-6 / §5 步骤 2）：advance 相位的有界群视图。
 *
 * 职责边界（公理）：本模块只做**装配**——把已入库的群消息整理为"系统侧消息概况
 * + 最新 K 条原文"的背景材料；人物是否看见、是否在意，由剧本写出（§1.2 三层事实）。
 *
 * 覆盖语义（v2.3 双标记的最小实现）：
 * - 概况呈现 = 活动层事实（条数/时间跨度/摘录）；
 * - 原文呈现 = 内容层覆盖 → 推进该群水位（成功提交后生效）；
 * - 概况不清空全部：未获原文呈现的批次保留内容级催动资格（I-2 接入时消费）。
 *
 * 预算：每群 K（默认 8）+ 全局合计（默认 16）——多群按最新条目新近度排序分配；
 * 生活条目不参与本预算（独立选取，通道只增不改）。
 */
import type { ScriptEntry } from '../types';
export interface GroupBackgroundEntryView {
    id: number;
    speaker: string;
    content: string;
    occurredAt: string;
}
export interface GroupBackgroundSection {
    groupId: string;
    label: string;
    /** 系统侧消息概况——事实层；"她瞥见未读"由剧本写出。 */
    summary: string;
    /** 最新 K 条原文（具体内容覆盖）。 */
    entries: GroupBackgroundEntryView[];
    /** 概况是否为截断计数（查询上限截到的诚实标注）。 */
    truncated?: boolean;
}
/** 成功提交后应推进的水位（每群 = 已呈现原文的最大条目 id）。
 * F2 修正：watermark 只代表"推进位置"（旧积压按概况级过期，不重复呈现）；
 * contentComplete 才代表内容完备——该群全部未覆盖条目都获得原文呈现时为
 * true，被 K/字符预算截断为 false。显著度消费据此区分完全消费与概况 ×0.5。 */
export interface GroupBackgroundCoverage {
    watermarks: Record<string, number>;
    contentComplete: Record<string, boolean>;
}
export interface GroupBackgroundBudget {
    perGroupLimit: number;
    globalLimit: number;
    excerptCount: number;
    /** F6：每条原文的字符上限（超限截断并标注）。 */
    perEntryCharacters: number;
    /** F6：全部背景原文的字符合计上限。 */
    globalCharacters: number;
}
export declare const DEFAULT_GROUP_BACKGROUND_BUDGET: GroupBackgroundBudget;
export interface AssembleGroupBackgroundParams {
    /** 每群：groupId / 显示标签 / 未覆盖条目（新→旧排序）。 */
    sections: Array<{
        groupId: string;
        label: string;
        entries: ScriptEntry[];
    }>;
    /** 概况是否因查询上限截断（各群独立标注）。 */
    truncatedGroups?: Set<string>;
    budget?: Partial<GroupBackgroundBudget>;
    /** 概况时间跨度用的故事时区（缺省回退 UTC——审计修正前的一致行为）。 */
    timezone?: string;
}
/** 纯装配：输入按群排序好的未覆盖条目（新→旧），输出背景节与覆盖水位。 */
export declare function assembleGroupBackground(params: AssembleGroupBackgroundParams): {
    sections: GroupBackgroundSection[];
    coverage: GroupBackgroundCoverage;
};
/** 从故事状态读取群背景水位（ extensions.groupBackground.watermarks ）。 */
export declare function readGroupBackgroundWatermarks(state: {
    extensions?: Record<string, unknown>;
} | undefined): Record<string, number>;
/** 合并水位（成功提交后调用；只前进不后退）。 */
export declare function mergeGroupBackgroundWatermarks(previous: Record<string, number>, coverage: GroupBackgroundCoverage): Record<string, number>;
