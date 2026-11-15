/**
 * 考据 HTTP 出口（审计修复 #5）：检索/抓取/Jev 的统一代理通道。
 * cordis http 不读系统代理（http-proxy.ts 存在的原因），国内直连 DDG/
 * Tavily/typesafe.ai 大概率不通——考据此前全部裸连。此处提供：
 * - proxyAgentResolved(config, provider)：解析优先级 research.proxyAgent
 *   > 考据 provider 的 proxyAgent > 空串（直连）；
 * - proxiedGet/proxiedPost：有代理走 undici fetch + ProxyAgent（GET 返回
 *   文本，POST 发 JSON），无代理透传注入的 http 客户端——接口与
 *   ResearchHttpClient 一致，runner/tools 无需感知。
 */
import { withProviderStream } from '../http-proxy'
import type { ResearchHttpClient } from './search'
import type { ProviderConfig } from '../narrator'

/** 代理解析：research 显式配置 > 考据连接继承 > 直连。 */
export function proxyAgentResolved(researchProxyAgent: string | undefined, provider: ProviderConfig | undefined): string {
  return researchProxyAgent?.trim() || provider?.proxyAgent?.trim() || ''
}

export function proxiedGet(http: ResearchHttpClient, proxyAgent: string, url: string, options: Record<string, unknown> = {}): Promise<unknown> {
  if (!proxyAgent) return http.get(url, options)
  const headers = { ...(options.headers as Record<string, string> | undefined) } as Record<string, string>
  const query = options.params as Record<string, string> | undefined
  const target = query ? `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams(query).toString()}` : url
  return withProviderStream(proxyAgent, async request =>
    (await request(target, { headers, signal: AbortSignal.timeout(Number(options.timeout) || 12_000) })).text())
}

export function proxiedPost(http: ResearchHttpClient, proxyAgent: string, url: string, body: unknown, options: Record<string, unknown> = {}): Promise<unknown> {
  if (!proxyAgent) return http.post(url, body, options)
  const headers = { ...((options.headers ?? {}) as Record<string, string>) }
  if (!headers['content-type']) headers['content-type'] = 'application/json'
  return withProviderStream(proxyAgent, async request =>
    (await request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(options.timeout) || 12_000),
    })).json())
}

/** 包装成 ResearchHttpClient：调用方无感知的代理适配层。 */
export function researchHttpWithProxy(http: ResearchHttpClient, proxyAgent: string): ResearchHttpClient {
  if (!proxyAgent) return http
  return {
    get: (url, options) => proxiedGet(http, proxyAgent, url, options),
    post: (url, body, options) => proxiedPost(http, proxyAgent, url, body, options),
  }
}
