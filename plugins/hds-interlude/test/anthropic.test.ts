import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { anthropicBody, anthropicHeaders, anthropicResponse, anthropicUsage, requestAnthropicStreaming } from '../src/anthropic'
import { configuredProviders, resolveModelRouting } from '../src/model-routing'
import { OpenAICompatibleNarrator, parseTokenUsage, toPromptPayload, type ModelConfig, type ProviderConfig } from '../src/narrator'
import { emptyStorySetting, emptyStoryState, type NarrativeRequest } from '../src/types'

const provider: ProviderConfig = { label: 'messages', enabled: true, endpoint: 'https://gateway.test/v1/messages', apiKey: 'test-key', model: 'test-model', protocol: 'anthropic-messages', anthropicCache: true,
  temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 1000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForMain: true, useForCompaction: true, useForVision: true, useForStickers: true }
const config = (providers = [provider]): ModelConfig => ({ providers, fixedPrompt: '', stylePrompt: '', mainPayloadOrder: 'cache-first', failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 0 } })
function request(): NarrativeRequest {
  const now = new Date('2026-09-15T00:00:00Z')
  return { phase: 'user-message', story: { id: 's', platform: 'onebot', selfId: 'b', userId: '', channelId: '', status: 'active', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now },
    from: now, now, participant: null, participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [], images: [], audio: [], userMessage: '你好' }
}
const textResponse = (text: string) => ({ type: 'message', content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 30, output_tokens: 5 } })

test('group event declares native audio evidence in both payload orders', () => {
  const input = request()
  input.groupContext = { groupId: '100', channelId: 'group:100', messages: [] } as any
  input.audio = [{ id: 'a', format: 'mp3', base64: 'AAAA' }]
  for (const cacheFirst of [false, true]) {
    const payload = JSON.stringify(toPromptPayload(input, { cacheFirst }))
    assert.match(payload, /"audioCount":1/)
    assert.match(payload, /group-message-batch/)
    assert.doesNotMatch(payload, /AAAA/)
  }
})

test('Messages request lifts system, converts images and never sends OpenAI JSON mode', () => {
  const body = anthropicBody({ model: 'm', max_tokens: 0, temperature: 1.5, top_p: 0.9, response_format: { type: 'json_object' }, messages: [
    { role: 'system', content: 'write JSON' }, { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] },
  ] }, provider)
  assert.equal(body.max_tokens, 4096); assert.equal(body.temperature, 1)
  assert.equal('response_format' in body, false); assert.equal('top_p' in body, false)
  assert.equal(body.system[0].text, 'write JSON'); assert.equal(body.messages.length, 1)
  assert.deepEqual(body.messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } })
  assert.equal(anthropicHeaders(provider)['x-api-key'], 'test-key')
  assert.equal('authorization' in anthropicHeaders(provider), false)
})

test('both payload orders retain exact JSON bytes; cache-first markers stop before live scene', () => {
  for (const cacheFirst of [false, true]) {
    const text = JSON.stringify(toPromptPayload(request(), { cacheFirst }))
    const body = anthropicBody({ messages: [{ role: 'system', content: 'system' }, { role: 'user', content: text }] }, provider, cacheFirst)
    const content = body.messages[0].content
    assert.equal(content.map((part: any) => part.text).join(''), text)
    assert.equal(content.length, cacheFirst ? 2 : 1)
    if (cacheFirst) {
      assert.equal(content[0].cache_control.type, 'ephemeral')
      assert.equal(content[0].text.includes('"incomingEvent":'), false)
    }
    const off = anthropicBody({ messages: [{ role: 'system', content: 'system' }, { role: 'user', content: text }] }, { ...provider, anthropicCache: false }, cacheFirst)
    assert.equal(JSON.stringify(off).includes('cache_control'), false)
  }
})

test('Messages responses exclude thinking and normalize total input plus cache reads', () => {
  const result = anthropicResponse(textResponse('{"script":"正文"}'))
  assert.equal(result.choices[0].message.content, '{"script":"正文"}')
  assert.deepEqual(parseTokenUsage(result.usage), { inputTokens: 150, outputTokens: 5, cachedInputTokens: 100 })
  assert.throws(() => anthropicResponse({ ...textResponse('{}'), stop_reason: 'max_tokens' }), /max_tokens/)
  assert.throws(() => anthropicResponse({ type: 'error', error: { message: 'overloaded' } }), /overloaded/)
  assert.equal(anthropicUsage(null), undefined)
})

test('native audio is explicitly unsupported and thinking sampling is compatible', () => {
  assert.throws(() => anthropicBody({ messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'AA==' } }] }] }, provider), /native audio/)
  const body = anthropicBody({ messages: [], temperature: 0.8, thinking: { type: 'enabled', budget_tokens: 1024 } }, provider)
  assert.equal('temperature' in body, false); assert.equal(body.thinking.budget_tokens, 1024)
})

test('protocol switching preserves gateway prefix; historical and official rows stay compatible', () => {
  assert.equal(configuredProviders(config([{ ...provider, endpoint: 'https://gateway.test/proxy/v1/chat/completions?x=1' }]))[0].endpoint, 'https://gateway.test/proxy/v1/messages?x=1')
  assert.equal(configuredProviders(config([{ ...provider, protocol: 'chat-completions' }]))[0].endpoint, 'https://gateway.test/v1/chat/completions')
  assert.equal(configuredProviders(config([{ ...provider, protocol: undefined, endpoint: 'https://old.test/v1/chat/completions' }]))[0].protocol, 'chat-completions')
  assert.equal(configuredProviders(config([{ ...provider, mode: 'zhipu-official' }]))[0].protocol, 'chat-completions')
  assert.equal(resolveModelRouting({ ...config(), embedding: { enabled: true } as any }).embedding.available, false)
})

test('production main and visual side tasks use Messages while retaining the narrative contract', async () => {
  const calls: any[] = []
  const narrator = new OpenAICompatibleNarrator({ http: { post: async (url: string, body: any, options: any) => {
    calls.push({ url, body, options })
    return textResponse(JSON.stringify({ script: '正文', interaction: { seen: true, reply: { mode: 'immediate', content: '你好' } }, description: '一只猫', aliases: [] }))
  } } } as any, config(), true)
  const decision = await narrator.decide(request())
  assert.equal(decision.script, '正文')
  await narrator.describeSticker('data:image/png;base64,AA==', 'image/png', 'cat.png', false)
  await narrator.describeImages([{ id: '1', mimeType: 'image/png', dataUri: 'data:image/png;base64,AA==' }])
  assert.equal(calls.length, 3)
  for (const call of calls) {
    assert.equal(call.options.headers['anthropic-version'], '2023-06-01')
    assert.equal(call.body.messages.some((message: any) => message.role === 'system'), false)
    assert.equal(call.body.system.length, 1)
  }
  assert.equal(calls[0].body.messages[0].content.length, 2)
})

test('side-task JSON path keeps max_tokens and does not retry uncapped on Messages', async () => {
  const narrator = new OpenAICompatibleNarrator({ http: { post: async (_url: string, body: any) => {
    assert.ok(body.max_tokens > 0); return textResponse('{"ok":true}')
  } } } as any, config(), true)
  const result = await (narrator as any).sideTaskJson(provider, 'm', 'test', 1000,
    () => ({ messages: [{ role: 'system', content: 'JSON' }, { role: 'user', content: 'test' }] }), JSON.parse)
  assert.deepEqual(result, { ok: true })
})

async function streamFixture(frames: any[], run: (url: string) => Promise<void>) {
  const server = createServer(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const wire = frames.map(frame => `event: ${frame.type}\r\ndata: ${JSON.stringify(frame)}\r\n\r\n`).join('')
    const bytes = Buffer.from(wire)
    for (let i = 0; i < bytes.length; i += 7) res.write(bytes.subarray(i, i + 7))
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try { await run(`http://127.0.0.1:${(server.address() as any).port}/v1/messages`) }
  finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}

test('Anthropic SSE accumulates text only and counts cumulative usage once', async () => {
  await streamFixture([
    { type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 30, output_tokens: 1 } } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"script":"你' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '好"}' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ], async url => {
    const usage: any[] = [], chunks: string[] = []
    const text = await requestAnthropicStreaming(url, {}, {}, 2000, async part => { chunks.push(part) }, part => usage.push(part))
    assert.equal(text, '{"script":"你好"}')
    assert.equal(chunks.length, 2); assert.equal(usage.length, 1)
    assert.deepEqual(parseTokenUsage(usage[0]), { inputTokens: 40, outputTokens: 8, cachedInputTokens: 30 })
  })
})

test('Anthropic truncated/error streams do not masquerade as completed script', async () => {
  for (const frames of [
    [{ type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } }],
    [{ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }],
    [{ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, { type: 'message_stop' }],
  ]) await streamFixture(frames, async url => { await assert.rejects(requestAnthropicStreaming(url, {}, {}, 2000)) })
})

test('production experimental early reply uses Anthropic SSE once and keeps the completed script', async () => {
  const first = '{"interaction":{"seen":true,"reply":{"mode":"immediate","content":"收到"}},"script":"'
  await streamFixture([
    { type: 'message_start', message: { usage: { input_tokens: 20, output_tokens: 1 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: first } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '她发出了消息。"}' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } },
    { type: 'message_stop' },
  ], async url => {
    const replies: any[] = [], usages: any[] = []
    const narrator = new OpenAICompatibleNarrator({} as any, { ...config([{ ...provider, endpoint: url }]), mainStreamingMode: 'experimental' }, true, usage => usages.push(usage))
    const result = await narrator.decide({ ...request(), onEarlyReply: async reply => { replies.push(reply); return true } })
    assert.equal(result.script, '她发出了消息。')
    assert.equal(replies.length, 1); assert.equal(replies[0].content, '收到')
    assert.equal(usages.length, 1); assert.equal(usages[0].outputTokens, 30)
  })
})

test('Messages failure can fall back to Chat Completions without changing payload content', async () => {
  const calls: any[] = []
  const narrator = new OpenAICompatibleNarrator({ http: { post: async (_url: string, body: any) => {
    calls.push(body)
    if (body.system) throw new Error('messages unavailable')
    return { choices: [{ message: { content: '{"script":"继续生活","interaction":{"seen":false,"reply":{"mode":"none"}}}' } }] }
  } } } as any, config([provider, { ...provider, label: 'fallback', protocol: 'chat-completions', endpoint: 'https://fallback.test/v1/chat/completions' }]), true)
  const result = await narrator.decide(request())
  assert.equal(result.script, '继续生活'); assert.equal(calls.length, 2)
  const messagesText = calls[0].messages[0].content.map((part: any) => part.text).join('')
  assert.equal(messagesText, calls[1].messages[1].content)
  assert.deepEqual(calls[1].response_format, { type: 'json_object' })
})
