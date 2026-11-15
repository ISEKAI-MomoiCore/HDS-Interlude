/**
 * II-1 交往节奏印象（设计 v2.4 §4 II-1，仅私聊）：把双方经历过的交往
 * 节奏概括为一句轻量事实，如"最近她主动开启话题的 4 次里，对方多在稍后
 * 接上（中位约 12 分钟）"。
 *
 * 采样口径（论文透镜的本地化，统计摘要与主观关系印象分开维护——本模块
 * 只产出系统侧统计摘要；她如何看待这段节奏由剧本写出）：
 * - 开场 = 她已确认送达的私聊消息（character-message 行仅在投递成功后
 *   落库，存在即已送达），且此前双方安静 ≥ 30 分钟（多气泡间隔远小于
 *   阈值，天然只计首条）；
 * - 承接 = 开场后对方的首条私聊消息（同 participantId 查询即归属确认）；
 *   开场与承接之间夹着她自己的又一次开场（安静 ≥ 阈值的追问）时归属含混，
 *   不计入中位数、单独计数；连发气泡属同一开场单元，不影响归属；
 * - 24 小时内无回应的近期待定开场单独记录（识别仅统计已回应样本的选择
 *   偏差）；更久未回应的开场视为已定格的过往，不再催动；
 * - 响应样本 ≥ 3 才产出印象，中位数三档描述，不足时保留空缺不注入。
 *
 * 常量起步硬编码（对齐 I-1~I-4 惯例），回放验证后再调。
 */
/** 开场识别的双边安静阈值（毫秒）。 */
export declare const RHYTHM_QUIET_THRESHOLD_MS: number;
/** 采样查询窗口（每位参与者最近条目数，service 侧查询 limit）。 */
export declare const RHYTHM_SAMPLE_WINDOW = 120;
/** 产出印象所需的最小已承接样本量。 */
export declare const RHYTHM_MIN_SAMPLES = 3;
/** 待定开场的观察视界（毫秒）：更久未回应的开场不再计入待定。 */
export declare const RHYTHM_PENDING_HORIZON_MS: number;
export interface RhythmSampleEntry {
    kind: 'user-message' | 'character-message';
    occurredAt: Date;
}
export interface RhythmSampleResult {
    /** 已承接开场的响应延迟（毫秒，升序）。 */
    respondedLatenciesMs: number[];
    /** 归属含混（开场与承接之间夹着她自己的消息）的样本数。 */
    ambiguous: number;
    /** 近期（视界内）发起后尚未等到回应的开场数。 */
    pending: number;
    /** 窗口内识别到的开场总数。 */
    openings: number;
}
/**
 * 从窗口内私聊条目采样交往节奏。条目顺序任意（内部按时间升序归一）；
 * 窗口最旧一条的"此前安静"不可知，保守不计为开场。
 */
export declare function sampleInteractionRhythm(entries: RhythmSampleEntry[], now: Date, options?: {
    quietThresholdMs?: number;
    pendingHorizonMs?: number;
}): RhythmSampleResult;
/** 中位时长的人读格式（II-4 状态命令与印象渲染共用）。 */
export declare function formatMedianDuration(ms: number): string;
/**
 * 渲染一句节奏印象。样本不足（< 3）或无开场时返回 undefined——证据不足
 * 保留空缺，不用模糊措辞冒充经验。
 */
export declare function renderInteractionRhythm(result: RhythmSampleResult, options?: {
    minSamples?: number;
}): string | undefined;
