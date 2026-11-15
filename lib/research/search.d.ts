/**
 * 考据 Agent 检索栈：API 优先（设计 v2）。搜索走可配置后端
 * （Tavily/博查/SearXNG，DuckDuckGo HTML 为零配置回退），页面访问用
 * 纯 HTTP 拉取 + HTML→文本（undici/cordis http，无浏览器依赖）。
 * puppeteer 仅作为 JS 重页面的可选回退，由宿主决定，不在本模块内。
 */
export interface SearchHit {
    title: string;
    url: string;
    snippet: string;
}
/** 结构化 HTTP 客户端（cordis ctx.http 的最小形态，便于测试注入）。 */
export interface ResearchHttpClient {
    get(url: string, options?: Record<string, unknown>): Promise<unknown>;
    post(url: string, body: unknown, options?: Record<string, unknown>): Promise<unknown>;
}
export interface SearchBackendOptions {
    backend: 'tavily' | 'bocha' | 'searxng' | 'duckduckgo-html';
    apiKey: string;
    searxngBaseUrl: string;
    timeoutMs?: number;
}
/** 单查询检索；后端失败返回空数组（考据失败永不阻塞叙事）。 */
export declare function webSearch(http: ResearchHttpClient, options: SearchBackendOptions, query: string): Promise<SearchHit[]>;
/** DDG 轻量结果页解析：result__a 链接 + result__snippet 摘要；
 * 兼容 //duckduckgo.com/l/?uddg= 跳转包装。无 DOM 依赖（正则），零配置回退专用。 */
export declare function parseDuckDuckGoHtml(html: string): SearchHit[];
export interface PageText {
    title: string;
    text: string;
    url: string;
}
/** 拉取公开页面并抽取正文文本（标题 + 去标签正文，字符预算截断）。
 * 仅 http(s)；失败/超时/非文本返回 undefined——来源不可读就跳过。 */
export declare function fetchPageText(http: ResearchHttpClient, url: string, maxCharacters?: number, timeoutMs?: number): Promise<PageText | undefined>;
/** 粗粒度正文抽取：去 script/style/nav 头部等噪音块后取文本。
 * 考据事实（片长/时长/路线）多在正文表格与段落，宁可粗一点也不引 DOM 依赖。 */
export declare function extractReadableText(html: string): string;
/** 程序化预排序：标题与主题词的重叠度 + 简单域名信任加分。
 * 零 LLM 成本地把 top-k 送进蒸馏。 */
export declare function rankHits(hits: SearchHit[], topic: string, limit?: number): SearchHit[];
