import { JevConfig } from './jev';
export type ResearchSearchBackend = 'auto' | 'tavily' | 'bocha' | 'searxng' | 'duckduckgo-html';
export interface ResearchConfig {
    enabled: boolean;
    searchBackend: ResearchSearchBackend;
    searchApiKey: string;
    searxngBaseUrl: string;
    /** 审计修复 #5：考据网络出口代理；空 = 回退考据连接的 proxyAgent。 */
    proxyAgent: string;
    /** 审计修复 #6：json-object 发 API JSON mode；不兼容网关用 prompt-only。 */
    responseFormat: 'json-object' | 'prompt-only';
    maxRounds: number;
    taskTokenBudget: number;
    deskCapacity: number;
    stableFactTtlHours: number;
    volatileFactTtlHours: number;
    prefetchEnabled: boolean;
    /** P3'：Jev 门控（被动推进叙事前的是非判断）。 */
    jev: JevConfig;
}
export declare const DEFAULT_RESEARCH_CONFIG: ResearchConfig;
export declare function resolveResearchConfig(value: unknown): ResearchConfig;
/** 实际生效的搜索后端：显式选择 > 按 Key 推断 > DDG 零配置回退。 */
export declare function effectiveSearchBackend(config: ResearchConfig): Exclude<ResearchSearchBackend, 'auto'>;
export interface DeskEntry {
    /** 查询键哈希：同主题复用未过期条目时零调用。 */
    id: string;
    text: string;
    sourceUrl: string;
    confidence: number;
    /** ★硬约束（舞台物理） / 软材料（自由取用）。 */
    hard: boolean;
    ttlUntil: number;
    capturedAt: number;
    originIntentId?: number;
}
export interface DeskSnapshotItem {
    text: string;
    source: string;
    confidence: number;
    hard: boolean;
}
/** 资料案头：每故事一份内存工作台（重载清空——长期价值走压缩器晋升，
 * 不在案头持久化）。过期静默撤下；容量满淘汰最旧。 */
export declare class ResearchDesk {
    private readonly capacity;
    private readonly entries;
    readonly counters: {
        offered: number;
        reused: number;
        evicted: number;
    };
    constructor(capacity?: number);
    /** 未过期的同主题条目直接复用（零调用路径）。多事实子键共享主题前缀。 */
    reusable(topic: string, now: number): DeskEntry | undefined;
    /** 写入/刷新一条。审计修复 #2：键 = 主题前缀 + 事实内容哈希——同主题多条
     * 事实共存互不覆盖，同内容重写幂等刷新。 */
    offer(topic: string, entry: Omit<DeskEntry, 'id' | 'capturedAt'>, now: number): DeskEntry;
    markReused(): void;
    /** 过滤过期并清理；空案头返回 undefined（不注入上下文段）。 */
    snapshot(now: number, capacity?: number): DeskSnapshotItem[] | undefined;
    get size(): number;
}
export declare function deskKey(topic: string): string;
export declare function normalizeTopic(topic: string): string;
/** 程序化防线：命中参与者身份词的查询词直接丢弃（模型侧防线在改写合约里）。 */
export declare function sanitizeQueries(queries: string[], forbiddenTerms: string[]): string[];
export declare const RESEARCH_REWRITE_SYSTEM: string;
export declare const RESEARCH_DISTILL_SYSTEM: string;
export interface DistilledFact {
    text: string;
    sourceUrl: string;
    confidence: number;
    hard: boolean;
    volatile: boolean;
}
export interface Distillation {
    facts: DistilledFact[];
    insufficient: boolean;
    reason: string;
}
/** 宽容解析：提取首个 JSON 对象；字段级校验，坏条目丢弃而非整体失败。 */
export declare function parseDistillation(text: string): Distillation | undefined;
export declare function parseRewrite(text: string): string[] | undefined;
