import { withProviderStream } from './http-proxy'
/** Messages transport adapter. Narrative JSON and delivery decisions remain protocol-independent. */
export interface AnthropicOptions {
  apiKey: string
  maxTokens?: number
  anthropicCache?: boolean
}

export function anthropicHeaders(provider: AnthropicOptions, overrides: Record<string, unknown> = {}) {
  return { 'content-type': 'application/json', 'anthropic-version': '2023-06-01',
    ...(provider.apiKey ? { 'x-api-key': provider.apiKey } : {}), ...overrides }
}

function blocks(content: any): any[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) throw new Error('Anthropic message content must be text or content blocks.')
  return content.map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'input_audio') throw new Error('Anthropic Messages does not support HDSI native audio input; use an audio-capable Chat Completions connection for this turn.')
    if (part.type === 'image_url') {
      const url = part.image_url?.url
      const data = typeof url === 'string' && /^data:(image\/(?:jpeg|png|gif|webp));base64,([\s\S]+)$/.exec(url)
      if (data) return { type: 'image', source: { type: 'base64', media_type: data[1], data: data[2] } }
      if (typeof url === 'string' && /^https?:\/\//.test(url)) return { type: 'image', source: { type: 'url', url } }
      throw new Error('Unsupported Anthropic image source or media type.')
    }
    throw new Error(`Unsupported Anthropic input block: ${part.type}`)
  })
}

/** Splits the serialized scaffold without changing one character of its JSON. */
function cachePrefix(content: any[]) {
  const first = content[0]
  if (first?.type !== 'text') return content
  let payload: any
  try { payload = JSON.parse(first.text) } catch { return content }
  if (!payload?.storyIdentity || !payload?.relevantEstablishedEpisodes || !payload?.currentSceneEvidence) return content
  // Index the top-level key via a serialized prefix, never a substring inside user prose.
  const prefix: Record<string, unknown> = {}
  for (const key of Object.keys(payload)) {
    if (key === 'currentSceneEvidence') break
    prefix[key] = payload[key]
  }
  const text = JSON.stringify(prefix).slice(0, -1) + ','
  if (!first.text.startsWith(text)) return content
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: first.text.slice(text.length) }, ...content.slice(1)]
}

export function anthropicBody(body: Record<string, any>, provider: AnthropicOptions, cacheFirst = false) {
  const { messages, response_format: _format, top_p: _topP, reasoning_effort: _effort,
    stream_options: _streamOptions, temperature: _temperature, ...rest } = body
  const system: any[] = []
  const turns: any[] = []
  for (const message of messages ?? []) {
    if (message.role === 'system') system.push(...blocks(message.content))
    else if (message.role === 'user' || message.role === 'assistant') {
      const content = blocks(message.content)
      turns.push({ role: message.role, content: cacheFirst && provider.anthropicCache && message.role === 'user' ? cachePrefix(content) : content })
    } else throw new Error(`Unsupported Anthropic message role: ${message.role}`)
  }
  if (provider.anthropicCache && system.length) system[system.length - 1].cache_control = { type: 'ephemeral' }
  const maxTokens = Number(body.max_tokens ?? provider.maxTokens)
  return { ...rest, stream: false, max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 4096,
    // Claude models may reject temperature + top_p together. Use temperature only.
    ...(typeof body.temperature === 'number' && !['enabled', 'adaptive'].includes(body.thinking?.type) ? { temperature: Math.max(0, Math.min(1, body.temperature)) } : {}),
    system, messages: turns }
}

export function anthropicUsage(usage: any) {
  if (!usage || typeof usage !== 'object') return undefined
  const hasInput = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].some(key => typeof usage[key] === 'number')
  return {
    ...(hasInput ? { prompt_tokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) } : {}),
    ...(typeof usage.output_tokens === 'number' ? { completion_tokens: usage.output_tokens } : {}),
    ...(typeof usage.cache_read_input_tokens === 'number' ? { prompt_tokens_details: { cached_tokens: usage.cache_read_input_tokens } } : {}),
  }
}

export function anthropicResponse(response: any) {
  if (response?.type === 'error' || response?.error) throw new Error(`Anthropic error: ${response.error?.type || 'unknown'} ${response.error?.message || ''}`)
  if (response?.stop_reason === 'max_tokens') throw new Error('Anthropic output reached max_tokens before completion.')
  if (response?.stop_reason === 'refusal') throw new Error('Anthropic provider refused the request.')
  const text = Array.isArray(response?.content)
    ? response.content.filter((block: any) => block.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('') : ''
  if (!text) throw new Error('Anthropic provider returned an empty text response.')
  return { choices: [{ message: { content: text } }], usage: anthropicUsage(response.usage) }
}

export async function requestAnthropicStreaming(endpoint: string, body: Record<string, unknown>, headers: Record<string, string>, timeout: number,
  onText?: (text: string) => Promise<void>, collect?: (usage: unknown) => void, proxyAgent?: string) {
  return withProviderStream(proxyAgent, async request => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    // 首帧守卫：部分网关接受连接后长时间静默。总超时仍然兜底，但这里让
    // "无任何响应"的失败在 timeout/3（至多 30s）内暴露，而不是耗满全程。
    const firstFrameTimeout = Math.min(Math.floor(timeout / 3), 30_000)
    let receivedAnyFrame = false
    const firstFrameTimer = setTimeout(() => { if (!receivedAnyFrame) controller.abort() }, firstFrameTimeout)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let usage: Record<string, unknown> = {}, hasUsage = false
    try {
      const response = await request(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }), signal: controller.signal })
      if (!response.ok) throw new Error(`Anthropic streaming request failed (${response.status}): ${(await response.text()).slice(0, 500)}`)
      if (/application\/json/i.test(response.headers.get('content-type') || '')) {
        const result = anthropicResponse(await response.json())
        collect?.(result.usage)
        return result.choices[0].message.content
      }
      if (!response.body) throw new Error('Anthropic stream has no response body.')
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = '', text = '', stopped = false, stopReason = ''
      const event = async (frame: string) => {
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
        if (!data) return
        // 网关注入的 keep-alive/[DONE]/畸形帧不是 Anthropic 协议事件；同文件的
        // 其他流解析器对坏帧容错，这里对齐——一帧垃圾不该废掉整个用户回合。
        let value: any
        try {
          value = JSON.parse(data)
        } catch {
          return
        }
        if (value.type === 'error') throw new Error(`Anthropic stream error: ${value.error?.type || 'unknown'} ${value.error?.message || ''}`)
        if (value.type === 'message_start' && value.message?.usage) { usage = { ...usage, ...value.message.usage }; hasUsage = true }
        if (value.type === 'message_delta') {
          if (value.usage) { usage = { ...usage, ...value.usage }; hasUsage = true }
          stopReason = value.delta?.stop_reason || stopReason
        }
        let delta = ''
        if (value.type === 'content_block_start' && value.content_block?.type === 'text') delta = value.content_block.text || ''
        if (value.type === 'content_block_delta' && value.delta?.type === 'text_delta') delta = value.delta.text || ''
        if (delta) { text += delta; await onText?.(text) }
        if (value.type === 'message_stop') stopped = true
      }
      while (!stopped) {
        const chunk = await reader.read()
        if (chunk.value?.length || chunk.done) {
          receivedAnyFrame = true
          clearTimeout(firstFrameTimer)
        }
        pending += decoder.decode(chunk.value, { stream: !chunk.done })
        const frames = pending.split(/\r?\n\r?\n/)
        pending = frames.pop() || ''
        for (const frame of frames) await event(frame)
        if (chunk.done) { if (pending.trim()) await event(pending); break }
      }
      if (!stopped) throw new Error('Anthropic stream ended before message_stop; response is incomplete.')
      if (stopReason === 'max_tokens' || stopReason === 'refusal') throw new Error(`Anthropic stream stopped with ${stopReason}.`)
      if (!text) throw new Error('Anthropic stream ended without visible text.')
      return text
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Anthropic streaming request timed out after ${!receivedAnyFrame ? `first frame within ${firstFrameTimeout}ms` : `${timeout}ms`}.`)
      throw error
    } finally {
      clearTimeout(timer)
      clearTimeout(firstFrameTimer)
      await reader?.cancel().catch(() => {})
      if (hasUsage) collect?.(anthropicUsage(usage))
    }
  })
}
