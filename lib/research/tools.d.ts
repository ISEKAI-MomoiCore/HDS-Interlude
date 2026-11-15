/**
 * 考据工具注册表（P2）：检索/抓取后端注册进一个 Cordis 服务，编排循环
 * （runner）只面向注册表编程——P3 的 MCP search 适配器或 puppeteer 抓取
 * 回退可直接 register，不改循环。内置后端在构造时注册；带查询级 TTL
 * 缓存（同查询 30 分钟内零网络调用）。
 */
import { Context, Service } from 'koishi';
import { SearchBackendOptions, SearchHit, PageText, ResearchHttpClient } from './search';
import { ResearchConfig } from './desk';
/** 可插拔检索后端的最小接口。id 与 Console 的 searchBackend 取值对应。 */
export interface ResearchSearchBackend {
    id: 'tavily' | 'bocha' | 'searxng' | 'duckduckgo-html' | string;
    search(http: ResearchHttpClient, options: SearchBackendOptions, query: string, forceFresh?: boolean): Promise<SearchHit[]>;
}
/** 可插拔抓取器：按注册顺序尝试，首个返回非空文本者胜；全空则该来源不可读。 */
export interface ResearchFetchTool {
    id: string;
    fetch(http: ResearchHttpClient, url: string, maxCharacters: number): Promise<PageText | undefined>;
}
declare module 'koishi' {
    interface Context {
        researchTools: ResearchToolRegistry;
    }
}
/** 查询级结果缓存：查询词哈希 → 命中列表 + 过期时刻；容量上限内淘汰最旧。 */
export declare class SearchCache {
    private readonly capacity;
    private readonly ttlMs;
    private readonly entries;
    readonly counters: {
        hits: number;
        misses: number;
        evictions: number;
    };
    constructor(capacity?: number, ttlMs?: number);
    private key;
    get(query: string, now: number): SearchHit[] | undefined;
    set(query: string, hits: SearchHit[], now: number): void;
    get size(): number;
}
export declare class ResearchToolRegistry extends Service {
    private readonly searchBackends;
    private readonly fetchTools;
    readonly searchCache: SearchCache;
    static readonly inject: readonly string[];
    constructor(ctx: Context);
    /** 注册/替换一个检索后端；同 id 后注册者胜（MCP 适配器可整替 duckduckgo-html）。 */
    registerSearch(backend: ResearchSearchBackend): this;
    /** 注册抓取器；顺序敏感——后注册者插队到最前（专用回退优先于内置 http）。 */
    registerFetch(tool: ResearchFetchTool): this;
    /** 检索入口：配置解析后端 → 注册表查找 → 缺失回退 DDG；查询级 TTL 缓存。
     * forceFresh（审计修复 #3）：证据不足的二轮检索绕过缓存读（仍回写缓存），
     * 否则同词二轮只会拿到与一轮完全相同的结果，追加机制空转。 */
    search(config: ResearchConfig, http: ResearchHttpClient, query: string, now?: number, forceFresh?: boolean): Promise<SearchHit[]>;
    /** 抓取入口：按注册顺序尝试，首个成功者胜。 */
    fetch(http: ResearchHttpClient, url: string, maxCharacters?: number): Promise<PageText | undefined>;
    get registeredSearchIds(): string[];
    get registeredFetchIds(): string[];
}
