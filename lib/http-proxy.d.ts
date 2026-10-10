/** Keep a provider's proxy alive until the streaming body has been consumed. */
export declare function withProviderStream<T>(proxyAgent: string | undefined, task: (request: typeof fetch) => Promise<T>): Promise<T>;
/** HTTP(S) 代理请求与 fetch 失败诊断。
 *
 * Koishi 4.18 的 cordis http 层（3.18.x）不支持 proxyAgent、也不读系统代理——
 * 需要本地代理才能访问的服务商（如 Google Gemini）此前只能整实例挂系统级
 * 代理。本模块提供 provider 级代理：undici fetch + ProxyAgent。
 * 另：undici 的 fetch 级失败只报 "fetch <url> failed"，真实原因（DNS/超时/
 * 证书）埋在 cause 链里——describeFetchFailure 把它拼进错误消息，远程排障
 * 不必再猜。 */
export declare function postJsonViaProxy(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number, proxyAgent: string): Promise<unknown>;
/** 展开 error.cause 链（undici 惯例：fetch failed ← TypeError ← ENOTFOUND 等）。
 * 迭代次数硬上限——cause 环（自引用/互引用）时 includes 去重会让 length
 * 永不增长，无界 while 会同步挂死事件循环。 */
export declare function describeFetchFailure(error: unknown): string;
/** Describe both transport failures and Koishi HTTP errors without losing the
 * response status/body. Koishi's HTTP layer throws an Error whose response is
 * still attached, so `error.message` alone turns a useful 400 into just
 * "Bad Request". Keep the body bounded because gateways sometimes echo large
 * validation payloads (or request fragments). */
export declare function describeHttpError(error: unknown): string;
