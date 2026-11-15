/** Keep a provider's proxy alive until the streaming body has been consumed. */
export async function withProviderStream<T>(proxyAgent: string | undefined, task: (request: typeof fetch) => Promise<T>): Promise<T> {
  if (!proxyAgent) return task(fetch)
  let undici: typeof import('undici')
  try { undici = require('undici') } catch {
    throw new Error('proxyAgent 已配置但未安装 undici——请在 Koishi 工作区执行 corepack yarn add undici 后重启。')
  }
  const agent = new undici.ProxyAgent(proxyAgent)
  try {
    return await task(((url: any, init: any) => undici.fetch(url, { ...init, dispatcher: agent })) as typeof fetch)
  } finally { await agent.close().catch(() => undefined) }
}

/** HTTP(S) 代理请求与 fetch 失败诊断。
 *
 * Koishi 4.18 的 cordis http 层（3.18.x）不支持 proxyAgent、也不读系统代理——
 * 需要本地代理才能访问的服务商（如 Google Gemini）此前只能整实例挂系统级
 * 代理。本模块提供 provider 级代理：undici fetch + ProxyAgent。
 * 另：undici 的 fetch 级失败只报 "fetch <url> failed"，真实原因（DNS/超时/
 * 证书）埋在 cause 链里——describeFetchFailure 把它拼进错误消息，远程排障
 * 不必再猜。 */

export async function postJsonViaProxy(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  proxyAgent: string,
): Promise<unknown> {
  let undici: typeof import('undici')
  try {
    undici = require('undici')
  } catch {
    throw new Error('已配置 proxyAgent 但运行环境缺少 undici 依赖——请在 Koishi 实例目录安装 undici（Node 20.18+ 装 v7，旧版装 v6）后重试。')
  }
  const agent = new undici.ProxyAgent(proxyAgent)
  try {
    const response = await undici.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
      dispatcher: agent,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}${clipResponseDetail(text)}`)
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`代理响应不是有效 JSON${clipResponseDetail(text)}`)
    }
  } finally {
    // close() 返回 Promise：reject 时 void 掉会变成 unhandledRejection。
    agent.close().catch(() => undefined)
  }
}

function clipResponseDetail(value: string) {
  const text = String(value ?? '').trim()
  return text ? `：${text.slice(0, 300)}` : ''
}

/** 展开 error.cause 链（undici 惯例：fetch failed ← TypeError ← ENOTFOUND 等）。
 * 迭代次数硬上限——cause 环（自引用/互引用）时 includes 去重会让 length
 * 永不增长，无界 while 会同步挂死事件循环。 */
export function describeFetchFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const causes: string[] = []
  let current = (error as { cause?: unknown }).cause
  for (let depth = 0; current && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code
    const described = current instanceof Error
      ? `${current.message}${typeof code === 'string' ? `（${code}）` : ''}`
      : String(current)
    if (!causes.includes(described)) causes.push(described)
    current = (current as { cause?: unknown }).cause
  }
  return causes.length ? `${error.message}｜原因链：${causes.join(' ← ')}` : error.message
}

/** Describe both transport failures and Koishi HTTP errors without losing the
 * response status/body. Koishi's HTTP layer throws an Error whose response is
 * still attached, so `error.message` alone turns a useful 400 into just
 * "Bad Request". Keep the body bounded because gateways sometimes echo large
 * validation payloads (or request fragments). */
export function describeHttpError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const response = (error as { response?: unknown }).response
  if (!response || typeof response !== 'object') return describeFetchFailure(error)

  const raw = response as {
    status?: unknown
    statusText?: unknown
    data?: unknown
  }
  const status = typeof raw.status === 'number' && Number.isFinite(raw.status) ? raw.status : undefined
  if (!status) return describeFetchFailure(error)

  const statusText = typeof raw.statusText === 'string' && raw.statusText.trim()
    ? raw.statusText.trim()
    : error.message.trim()
  const detail = formatResponseDetail(raw.data)
  return `HTTP ${status}${statusText ? ` ${statusText}` : ''}${detail}`
}

function formatResponseDetail(value: unknown) {
  if (value === undefined || value === null || value === '') return ''
  let text: string
  if (typeof value === 'string') text = value
  else {
    try { text = JSON.stringify(value) } catch { text = String(value) }
  }
  text = text.trim()
  return text ? `：${text.slice(0, 300)}` : ''
}
