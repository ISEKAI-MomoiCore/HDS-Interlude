import test from 'node:test'
import assert from 'node:assert/strict'
import { geminiInteractionsBody, geminiInteractionsHeaders, geminiInteractionsResponse, geminiInteractionsUsage } from '../src/gemini-interactions'
import { normalizeProtocolEndpoint, resolveModelRouting } from '../src/model-routing'
import type { ModelConfig } from '../src/types'

test('Interactions 头：API key 走 x-goog-api-key 而非 Bearer', () => {
  assert.deepEqual(geminiInteractionsHeaders({ apiKey: 'AIza-key' }), { 'content-type': 'application/json', 'x-goog-api-key': 'AIza-key' })
  assert.deepEqual(geminiInteractionsHeaders({}), { 'content-type': 'application/json' })
  assert.deepEqual(geminiInteractionsHeaders({ apiKey: 'k' }, { 'x-custom': '1' }), { 'content-type': 'application/json', 'x-goog-api-key': 'k', 'x-custom': '1' })
})

test('Interactions 请求体：system/messages → system_instruction/input 步骤 + generation_config', () => {
  const body = geminiInteractionsBody({
    model: 'gemini-2.5-flash',
    temperature: 0.8,
    top_p: 0.95,
    max_tokens: 4096,
    stop: ['</script>'],
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '固定合约' },
      { role: 'user', content: '第一条用户输入' },
      { role: 'assistant', content: '上一次输出' },
      { role: 'user', content: '第二条用户输入' },
    ],
  })
  assert.equal(body.model, 'gemini-2.5-flash')
  assert.equal(body.system_instruction, '固定合约')
  assert.deepEqual(body.input, [
    { type: 'user_input', content: [{ type: 'text', text: '第一条用户输入' }] },
    { type: 'model_output', content: [{ type: 'text', text: '上一次输出' }] },
    { type: 'user_input', content: [{ type: 'text', text: '第二条用户输入' }] },
  ])
  assert.deepEqual(body.generation_config, { temperature: 0.8, top_p: 0.95, max_output_tokens: 4096, stop_sequences: ['</script>'] })
  assert.deepEqual(body.response_format, { type: 'text', mime_type: 'application/json' })
})

test('Interactions 请求体：多模态 parts 映射（data URI 图片 → inline_data，URL → file_data，音频 → inline_data）', () => {
  const body = geminiInteractionsBody({
    model: 'gemini-2.5-flash',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '看看这张图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD', detail: 'auto' } },
        { type: 'image_url', image_url: { url: 'https://example.test/photo.jpg', detail: 'low' } },
        { type: 'input_audio', input_audio: { data: 'AQID', format: 'mp3' } },
      ],
    }],
  }) as { input: Array<{ content: Array<Record<string, unknown>> }> }
  const parts = body.input[0].content
  assert.deepEqual(parts[0], { type: 'text', text: '看看这张图' })
  assert.deepEqual(parts[1], { type: 'inline_data', mime_type: 'image/png', data: 'QUJD' })
  assert.deepEqual(parts[2], { type: 'file_data', file_uri: 'https://example.test/photo.jpg' })
  assert.deepEqual(parts[3], { type: 'inline_data', mime_type: 'audio/mp3', data: 'AQID' })
})

test('Interactions 响应：拼接 model_output 文本并归一化 usage（含缓存明细）', () => {
  const normalized = geminiInteractionsResponse({
    status: 'completed',
    steps: [
      { type: 'user_input', content: [{ type: 'text', text: '不该入选' }] },
      { type: 'model_output', content: [{ type: 'text', text: '{"script":' }] },
      { type: 'model_output', content: [{ type: 'text', text: '"你好"}' }] },
    ],
    usage: { total_input_tokens: 100, total_output_tokens: 40, total_cached_tokens: 60, total_thought_tokens: 0, total_tokens: 140 },
  })
  assert.equal(normalized.choices[0].message.content, '{"script":"你好"}')
  assert.deepEqual(normalized.usage, {
    prompt_tokens: 100,
    completion_tokens: 40,
    prompt_tokens_details: { cached_tokens: 60 },
  })
})

test('Interactions 响应：failed / incomplete / 空输出显式抛错（触发服务商重试而非静默截断）', () => {
  assert.throws(() => geminiInteractionsResponse({ status: 'failed' }), /交互失败/)
  assert.throws(() => geminiInteractionsResponse({ status: 'incomplete', incomplete_reason: 'MAX_OUTPUT_TOKENS' }), /未完成/)
  assert.throws(() => geminiInteractionsResponse({ status: 'completed', steps: [{ type: 'model_output', content: [] }] }), /empty text/)
  assert.throws(() => geminiInteractionsResponse({ error: { code: 400, message: 'bad request' } }), /Gemini Interactions error/)
})

test('Interactions usage：缺字段时返回 undefined 或部分字段', () => {
  assert.equal(geminiInteractionsUsage(undefined), undefined)
  assert.deepEqual(geminiInteractionsUsage({ total_output_tokens: 7 }), { completion_tokens: 7 })
})

test('路由：gemini-interactions 预设获得独立协议与端点，embedding 任务被排除', () => {
  const config = {
    providers: [
      { label: 'gemini', enabled: true, mode: 'gemini-interactions', apiKey: 'AIza-key', model: 'gemini-2.5-flash', useForMain: true, useForEmbedding: true },
    ],
  } as unknown as ModelConfig
  const routing = resolveModelRouting(config)
  const main = routing.main.providers[0]
  assert.equal(main.protocol, 'gemini-interactions')
  assert.equal(main.endpoint, 'https://generativelanguage.googleapis.com/v1beta/interactions')
  assert.equal(routing.embedding.providers.length, 0, 'Interactions 协议不提供 embedding，应被路由排除')
})

test('端点规范化：gemini-interactions 协议把兼容层地址改写为 /interactions', () => {
  assert.equal(
    normalizeProtocolEndpoint('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-interactions'),
    'https://generativelanguage.googleapis.com/v1beta/interactions',
  )
  assert.equal(normalizeProtocolEndpoint('https://host/v1/chat/completions', 'chat-completions'), 'https://host/v1/chat/completions')
})

test('fetch 失败诊断：cause 链与错误码拼进消息', async () => {
  const { describeFetchFailure, describeHttpError } = await import('../src/http-proxy')
  const chained = new Error('fetch https://host/interactions failed', {
    cause: Object.assign(new Error('connect ETIMEDOUT 142.250.0.1:443'), { code: 'ETIMEDOUT' }),
  })
  assert.match(describeFetchFailure(chained), /原因链：connect ETIMEDOUT.*ETIMEDOUT/)
  const plain = new Error('HTTP 400 Bad Request')
  assert.equal(describeFetchFailure(plain), 'HTTP 400 Bad Request')
  assert.equal(describeFetchFailure('not an error'), 'not an error')

  const httpError = Object.assign(new Error('Bad Request'), {
    response: { status: 400, statusText: 'Bad Request', data: { error: { message: 'invalid image payload' } } },
  })
  assert.equal(describeHttpError(httpError), 'HTTP 400 Bad Request：{"error":{"message":"invalid image payload"}}')
  assert.equal(describeHttpError(new Error('fetch failed')), 'fetch failed')
})

test('路由：proxyAgent 透传到运行时 provider（供 postChat 分流）', async () => {
  const config = {
    providers: [
      { label: 'gemini', enabled: true, mode: 'gemini-interactions', apiKey: 'AIza-key', model: 'gemini-2.5-flash', proxyAgent: ' http://127.0.0.1:7890 ', useForMain: true },
    ],
  } as unknown as ModelConfig
  const routing = resolveModelRouting(config)
  assert.equal(routing.main.providers[0].proxyAgent, 'http://127.0.0.1:7890', '代理地址去空白透传')
})

test('催化器截断回归：Gemini incomplete 错误文本必须命中 sideTaskJson 的重试正则', async () => {
  const { geminiInteractionsResponse } = await import('../src/gemini-interactions')
  // 与 narrator.ts sideTaskJson 的重试条件保持一致（截断必须走"去掉 max_tokens 重试一次"路径）
  const retryPattern = /invalid JSON|Unterminated|Unexpected token|empty response|输出未完成|incomplete/i
  let thrown = ''
  try { geminiInteractionsResponse({ status: 'incomplete', incomplete_reason: 'MAX_OUTPUT_TOKENS' }) } catch (error) { thrown = String(error) }
  assert.match(thrown, /输出未完成/)
  assert.ok(retryPattern.test(thrown), '截断错误文本必须能命中重试正则（首次封顶尝试被思考预算挤爆时，去封顶重试是唯一出路）')
})
