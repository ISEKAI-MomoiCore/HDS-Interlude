/**
 * Jev 客户端（P3'）：TypeSafe AI 的 System One 决策模型。
 * 不生成文本，只回答结构化判断；本模块只用 Noul（是非）题型——
 * 返回 0-1 概率（概率即置信度，Noul 无独立 confidence 字段）。
 * 任何失败（网络/超时/解析）返回 undefined → 门控按 FALSE 直通（fail-open），
 * 考据永不阻塞对话。端点：POST {baseUrl}/v1/systemone，Bearer 认证。
 */
import type { ResearchHttpClient } from './search';
export interface JevConfig {
    enabled: boolean;
    apiKey: string;
    baseUrl: string;
    /** 版本钉死（官方建议不用 jev-latest）。 */
    model: string;
    /** Noul 概率阈值：≥ 阈值视为 TRUE。 */
    noulThreshold: number;
    timeoutMs: number;
}
export declare const DEFAULT_JEV_CONFIG: JevConfig;
export declare function resolveJevConfig(value: unknown): JevConfig;
/**
 * 一次 Noul 是非判断。questionId 由调用方命名（响应按 id 回填）；
 * state 为判断依据的结构化上下文（对象/字符串/数组皆可）。
 * 返回 0-1 概率；不可用/失败/形状不符 → undefined。
 */
export declare function jevNoul(http: ResearchHttpClient, config: JevConfig, questionId: string, instructions: string, state: unknown): Promise<number | undefined>;
/** 门控决策：概率存在且 ≥ 阈值才 TRUE；undefined/低置信一律 FALSE（直通）。 */
export declare function jevGateDecision(config: Pick<JevConfig, 'noulThreshold'>, noul: number | undefined): boolean;
/** 门控问题（P3' 固定措辞）：主角回应是否依赖可核验的具体现实细节。 */
export declare const JEV_NOUL_LOOKUP_INSTRUCTIONS = "Based on the incoming chat message, the recent story tail and the already-verified facts, does the protagonist\u2019s response in this turn plausibly hinge on specific verifiable real-world details \u2014 an explicit lookup or web-search action by her, or concrete facts such as a named venue, the runtime of a named work, a commute between two named places, or opening hours of a specific place? Broad common knowledge, weather moods, generic places and anything reasonably improvisable do NOT count. Answer the probability that a real-world lookup is genuinely needed before writing her response.";
