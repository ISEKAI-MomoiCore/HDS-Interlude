/** Google Gemini Interactions API 传输适配（v1beta）。
 *
 * 背景：Gemini 的 OpenAI 兼容层（/v1beta/openai/chat/completions）对部分
 * AI Studio 密钥不再开放，官方方向是 Interactions API 成为唯一入口（旧
 * generateContent schema 已于 2026-06 移除）。本模块把 HDSI 内部的
 * OpenAI 形态请求映射为 Interactions 请求，并把响应归一化回 choices 形态，
 * 与 anthropic.ts 的适配方式同构：
 *   鉴权   x-goog-api-key（AI Studio 密钥直用，非 Bearer）
 *   请求   POST /v1beta/interactions { model, input: Step[], system_instruction,
 *          generation_config, response_format }
 *   响应   Interaction { status, steps[].content[].text, usage.total_*_tokens }
 */

export interface GeminiInteractionsOptions {
  apiKey?: string
}

export function geminiInteractionsHeaders(provider: GeminiInteractionsOptions, overrides: Record<string, unknown> = {}) {
  return {
    'content-type': 'application/json',
    // Interactions API 走 Google API key 头；Bearer 形态不被接受。
    ...(provider.apiKey ? { 'x-goog-api-key': provider.apiKey } : {}),
    ...overrides,
  }
}

/** OpenAI 消息内容 → Gemini Content parts。data URI 图片/音频转 inline_data，
 * http(s) 图片 URL 转 file_data（由 Google 侧拉取）。 */
function interactionContentParts(content: unknown): Array<Record<string, unknown>> {
  const parts = Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }]
  const mapped: Array<Record<string, unknown>> = []
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, any>
    if (record.type === 'text' && typeof record.text === 'string') {
      if (record.text) mapped.push({ type: 'text', text: record.text })
    } else if (record.type === 'image_url') {
      const url = String(record.image_url?.url ?? '')
      const dataUri = /^data:([^;,]+);base64,(.+)$/s.exec(url)
      if (dataUri) mapped.push({ type: 'inline_data', mime_type: dataUri[1], data: dataUri[2] })
      else if (url) mapped.push({ type: 'file_data', file_uri: url })
    } else if (record.type === 'input_audio' && record.input_audio?.data) {
      const format = String(record.input_audio.format ?? 'mp3')
      mapped.push({
        type: 'inline_data',
        mime_type: format.startsWith('audio/') ? format : `audio/${format}`,
        data: record.input_audio.data,
      })
    }
  }
  // Gemini 系 API 拒绝空 text part（"Empty text parameter"）；全过滤/空串时
  // 用单空格占位，避免整 provider 失败进冷却。
  return mapped.length ? mapped : [{ type: 'text', text: ' ' }]
}

/** OpenAI Chat Completions 请求体 → Interactions 请求体（纯函数，可单测）。 */
export function geminiInteractionsBody(body: Record<string, any>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const system: string[] = []
  const input: Array<Record<string, unknown>> = []
  for (const message of messages) {
    const role = String(message?.role ?? '')
    if (role === 'system') {
      const text = Array.isArray(message.content)
        ? message.content.filter((part: any) => part?.type === 'text').map((part: any) => String(part.text ?? '')).join('')
        : String(message.content ?? '')
      if (text.trim()) system.push(text)
    } else if (role === 'user' || role === 'assistant') {
      input.push({
        type: role === 'assistant' ? 'model_output' : 'user_input',
        content: interactionContentParts(message.content),
      })
    }
  }
  const config: Record<string, unknown> = {}
  if (typeof body.temperature === 'number') config.temperature = body.temperature
  if (typeof body.top_p === 'number') config.top_p = body.top_p
  if (Number(body.max_tokens) > 0) config.max_output_tokens = Math.floor(Number(body.max_tokens))
  const stop = Array.isArray(body.stop)
    ? body.stop.map((value: unknown) => String(value)).filter(Boolean)
    : typeof body.stop === 'string' && body.stop ? [body.stop] : []
  if (stop.length) config.stop_sequences = stop
  const format = String(body.response_format?.type ?? '')
  return {
    ...(body.model ? { model: String(body.model) } : {}),
    input,
    ...(system.length ? { system_instruction: system.join('\n\n') } : {}),
    ...(Object.keys(config).length ? { generation_config: config } : {}),
    // Interactions 的 JSON 模式：mime_type 表达 json-object 语义（schema 可选）。
    ...(format === 'json_object' || format === 'json_schema'
      ? { response_format: { type: 'text', mime_type: 'application/json' } } : {}),
  }
}

/** Interactions usage（total_*_tokens）→ OpenAI usage 形态（含缓存明细）。
 * Gemini 惯例 total_input_tokens 已包含 cached 部分（与 Anthropic 三字段互斥
 * 不同）——直接取值，cached 只进 details，避免双重计费。 */
export function geminiInteractionsUsage(usage: any) {
  if (!usage || typeof usage !== 'object') return undefined
  const input = typeof usage.total_input_tokens === 'number'
    ? usage.total_input_tokens
    : typeof usage.total_cached_tokens === 'number' ? usage.total_cached_tokens : undefined
  return {
    ...(input !== undefined ? { prompt_tokens: input } : {}),
    ...(typeof usage.total_output_tokens === 'number' ? { completion_tokens: usage.total_output_tokens } : {}),
    ...(typeof usage.total_cached_tokens === 'number' ? { prompt_tokens_details: { cached_tokens: usage.total_cached_tokens } } : {}),
  }
}

/** Interaction 资源 → OpenAI choices 形态。失败/未完成显式抛错（与
 * anthropicResponse 同语义：宁可触发服务商重试，不静默接受截断输出）。 */
export function geminiInteractionsResponse(response: any) {
  if (!response || typeof response !== 'object') throw new Error('Gemini Interactions 响应为空。')
  if (response.error) throw new Error(`Gemini Interactions error: ${response.error.status ?? response.error.code ?? 'unknown'} ${response.error.message ?? ''}`)
  const status = String(response.status ?? '')
  if (status === 'failed') throw new Error(`Gemini Interactions 交互失败：${String(response.error?.message ?? '未知错误')}`)
  if (status === 'incomplete') throw new Error(`Gemini Interactions 输出未完成（${String(response.incomplete_reason ?? response.error?.message ?? '未知')}）——可能被 max_output_tokens 截断。`)
  const chunks: string[] = []
  for (const step of Array.isArray(response.steps) ? response.steps : []) {
    if (String(step?.type ?? '') !== 'model_output') continue
    for (const part of Array.isArray(step.content) ? step.content : []) {
      if (part?.type === 'text' && typeof part.text === 'string') chunks.push(part.text)
    }
  }
  const text = chunks.join('')
  if (!text) throw new Error('Gemini Interactions provider returned an empty text response.')
  return { choices: [{ message: { content: text } }], usage: geminiInteractionsUsage(response.usage) }
}
