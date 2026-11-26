/**
 * 文风拟真度测试 · 模型请求适配（设计文档 §6.3）。
 *
 * Phase 0 未确认端点协议前只实现 chat-completions（默认）；anthropic-messages /
 * gemini-interactions 为预留分支。请求/重试策略对齐 test/model-behavior.test.ts：
 * 60s 超时，网络类失败与 5xx 单次重试，4xx 与解析错误不重试。
 */
import { Agent, ProxyAgent, setGlobalDispatcher, type Dispatcher } from 'undici'

export type Protocol = 'chat-completions' | 'anthropic-messages' | 'gemini-interactions'

export interface ProviderTarget {
  protocol: Protocol
  endpoint: string
  apiKey: string
  model: string
}

export interface CallOptions {
  system: string
  user: string
  temperature?: number
  topP?: number
  maxTokens?: number
  jsonMode: boolean
  timeoutMs: number
  proxy?: string
}

export interface CallResult {
  raw: string
  latencyMs: number
  usage?: { promptTokens?: number, completionTokens?: number, totalTokens?: number }
}

let dispatcherConfigured = false

function ensureDispatcher(proxy?: string): void {
  if (dispatcherConfigured) return
  const agent: Dispatcher = proxy
    ? new ProxyAgent({ uri: proxy, connect: { timeout: 30_000 } })
    : new Agent({ connect: { timeout: 30_000 } })
  setGlobalDispatcher(agent)
  dispatcherConfigured = true
}

function retryable(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
}

/** chat-completions 请求体；sampling=off 时省略采样参数（兼容弃用 temperature 的端点）。 */
function chatCompletionsBody(target: ProviderTarget, options: CallOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: target.model,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
  }
  if (options.jsonMode) body.response_format = { type: 'json_object' }
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.topP !== undefined) body.top_p = options.topP
  if (options.maxTokens) body.max_tokens = options.maxTokens
  return body
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  } as RequestInit)
}

/** 主入口。按协议分派；未实现协议给出明确的 Phase 0 指引。 */
export async function callModel(target: ProviderTarget, options: CallOptions): Promise<CallResult> {
  if (target.protocol !== 'chat-completions') {
    throw new Error(
      `协议 ${target.protocol} 适配尚未实现：Phase 0（设计文档 §2.0.3）确认端点协议后补充 protocol.ts 的分支，` +
      '或改用支持 chat-completions 的端点地址。',
    )
  }
  ensureDispatcher(options.proxy)
  const startedAt = Date.now()
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await postJson(target.endpoint, { authorization: `Bearer ${target.apiKey}` }, chatCompletionsBody(target, options), options.timeoutMs)
      if (!response.ok) {
        const text = await response.text()
        if (response.status >= 500 && attempt === 1) continue
        const detail = target.apiKey ? text.split(target.apiKey).join('[redacted]') : text
        throw new Error(`API ${response.status}: ${detail.slice(0, 400)}`)
      }
      const json = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number }
      }
      const raw = json.choices?.[0]?.message?.content ?? ''
      return {
        raw,
        latencyMs: Date.now() - startedAt,
        usage: json.usage ? {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        } : undefined,
      }
    } catch (error) {
      if (retryable(error) && attempt === 1) continue
      throw error
    }
  }
  throw new Error('unreachable')
}
