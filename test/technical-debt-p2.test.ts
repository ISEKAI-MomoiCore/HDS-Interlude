import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { OpenAICompatibleNarrator, isContextDisposedError } from '../src/narrator'
import { emptyStorySetting, emptyStoryState } from '../src/types'

function request(): any {
  const now = new Date('2026-11-19T00:00:00Z')
  return { phase: 'user-message', story: { id: 's', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now },
    from: now, now, participant: null, participants: [], dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [], userMessage: '你好' }
}
const prose = JSON.stringify({ script: '她放下杯子。', interaction: { seen: true, reply: { mode: 'none' } } })
const response = (text: string, finish_reason?: string) => ({ choices: [{ message: { content: text }, finish_reason }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
function harness(post: (...args: any[]) => any, attempts = 1, extra: any = {}) {
  const calls: any[] = [], usage: any[] = []
  const provider = { id: 'p', label: 'p', enabled: true, endpoint: 'https://test.invalid/v1/chat/completions', model: 'm', temperature: 0.8, topP: 1, maxTokens: 100, timeout: 2000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForMain: true, ...extra }
  const narrator: any = new OpenAICompatibleNarrator({ http: { post: async (...args: any[]) => { calls.push(args); return post(...args) } } } as any,
    { providers: [provider], mainStreamingMode: 'experimental', fixedPrompt: '', stylePrompt: '', failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: attempts, cooldownMinutes: 0 } } as any,
    true, record => usage.push(record))
  return { narrator, calls, usage, provider }
}

test('P2 invalid JSON, empty replies and HTTP body wording do not grant an uncapped retry', async () => {
  for (const result of [response('invalid JSON incomplete'), response('', 'stop'), Object.assign(new Error('invalid JSON incomplete'), { response: { status: 400, data: 'incomplete' } })]) {
    const h = harness(() => { if (result instanceof Error) throw result; return result })
    await assert.rejects(h.narrator.decide(request()))
    assert.equal(h.calls.length, 1)
  }
})

test('P2 explicit length triggers one recovery, preserves usage and refuses parseable truncated JSON', async () => {
  let n = 0
  const h = harness(() => response(prose, ++n === 1 ? 'length' : 'stop'))
  const decision = await h.narrator.decide(request())
  assert.equal(decision.script, '她放下杯子。')
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0][1].max_tokens, 100)
  assert.equal(h.calls[1][1].max_tokens, undefined)
  assert.equal(h.usage.length, 1)
  assert.equal(h.usage[0].outputTokens, 10)
})

test('P2 a provider gets at most one extra recovery across all normal attempts', async () => {
  const h = harness(() => response(prose, 'length'), 3)
  await assert.rejects(h.narrator.decide(request()))
  assert.equal(h.calls.length, 4)
  assert.equal(h.calls.filter(call => call[1].max_tokens === undefined).length, 1)
})

test('P2 side tasks distinguish invalid JSON from explicit truncation', async () => {
  for (const truncated of [false, true]) {
    let n = 0
    const h = harness(() => response(++n === 1 ? '{' : '{"ok":true}', truncated && n === 1 ? 'length' : 'stop'))
    const run = () => h.narrator.sideTaskJson(h.provider, 'm', 'test', 2000, (capped: boolean) => ({ messages: [], ...(capped ? { max_tokens: 100 } : {}) }), JSON.parse)
    if (truncated) assert.deepEqual(await run(), { ok: true })
    else await assert.rejects(run())
    assert.equal(h.calls.length, truncated ? 2 : 1)
  }
})

test('P2 recovery shares the provider time budget', async () => {
  const originalNow = Date.now
  let clock = originalNow()
  Date.now = () => clock
  try {
    const h = harness(() => { clock += 2500; return response('{', 'length') })
    await assert.rejects(h.narrator.decide(request()))
    assert.equal(h.calls.length, 1, 'deadline exhausted before recovery')
  } finally { Date.now = originalNow }
})

test('P2 disposal during recovery aborts all later attempts and keeps provider cooldown clear', async () => {
  let n = 0
  const h = harness(() => { if (++n === 1) return response('{', 'length'); throw new Error('Context has been disposed') }, 3)
  await assert.rejects(h.narrator.decide(request()), /disposed/i)
  assert.equal(h.calls.length, 2)
  assert.equal(h.narrator.cooldownUntil.size, 0)
  assert.equal(isContextDisposedError(new Error('Context has been disposed')), true)
})

test('P2 Anthropic truncation keeps required max_tokens and preserves failed usage', async () => {
  const h = harness(() => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: prose }], usage: { input_tokens: 10, output_tokens: 7 } }), 1, { protocol: 'anthropic-messages' })
  await assert.rejects(h.narrator.decide(request()))
  assert.equal(h.calls.length, 1)
  assert.ok(h.calls[0][1].max_tokens > 0)
  assert.equal(h.usage[0]?.outputTokens, 7)
})

async function serverRun(frames: any[], run: (endpoint: string) => Promise<void>, done = true) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(frames.map(frame => 'data: ' + JSON.stringify(frame) + '\n\n').join('') + (done ? 'data: [DONE]\n\n' : ''))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try { await run('http://127.0.0.1:' + (server.address() as any).port + '/v1/chat/completions') }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}

test('P2 SSE length is retained and truncated final JSON cannot be accepted; early delivery prevents retry', async () => {
  await serverRun([{ choices: [{ delta: { content: prose }, finish_reason: 'length' }], usage: { completion_tokens: 5 } }], async endpoint => {
    const h = harness(() => { throw new Error('SSE expected') }, 1, { endpoint })
    let early = 0
    const input = request(); input.onEarlyReply = async () => { early++; return true }
    await assert.rejects(h.narrator.decide(input), /length|max_tokens|truncat/i)
    assert.equal(h.usage[0]?.outputTokens, 10) // two attempts; no early message in reply:none
    assert.equal(early, 0)
  })
  const earlyText = JSON.stringify({ interaction: { seen: true, reply: { mode: 'immediate', content: '收到' } }, script: '她放下杯子。' })
  await serverRun([{ choices: [{ delta: { content: earlyText } }] }], async endpoint => {
    const h = harness(() => {}, 3, { endpoint })
    const input = request(); let early = 0; input.onEarlyReply = async () => { early++; return true }
    await assert.rejects(h.narrator.decide(input), /early visible reply/)
    assert.equal(early, 1)
  }, false)
})


test('P2 normal gateway responses without finish_reason remain compatible; refusal and no-cap cannot expand budget', async () => {
  const good = harness(() => response(prose))
  assert.equal((await good.narrator.decide(request())).script, '她放下杯子。')
  assert.equal(good.calls.length, 1)
  for (const [finish, cap] of [['content_filter', 100], ['length', 0]] as const) {
    const h = harness(() => response(prose, finish), 1, { maxTokens: cap })
    await assert.rejects(h.narrator.decide(request()))
    assert.equal(h.calls.length, 1)
  }
})

test('P2 Gemini budget evidence allows recovery while unknown incomplete does not', async () => {
  for (const reason of ['MAX_OUTPUT_TOKENS', 'unknown']) {
    let n = 0
    const h = harness(() => ++n === 1
      ? { status: 'incomplete', incomplete_reason: reason, usage: { total_input_tokens: 10, total_output_tokens: 5 } }
      : { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"ok":true}' }] }] },
      1, { protocol: 'gemini-interactions' })
    const run = () => h.narrator.sideTaskJson(h.provider, 'm', 'test', 2000, (capped: boolean) => ({ messages: [], ...(capped ? { max_tokens: 100 } : {}) }), JSON.parse)
    if (reason === 'MAX_OUTPUT_TOKENS') assert.deepEqual(await run(), { ok: true })
    else await assert.rejects(run())
    assert.equal(h.calls.length, reason === 'MAX_OUTPUT_TOKENS' ? 2 : 1)
  }
})

test('P2 Alter shares one recovery across its normal attempts', async () => {
  const h = harness(() => response('{', 'length'), 3, { useForAlter: true })
  await assert.rejects(h.narrator.analyzeAlter({ entries: [] }, { enabled: true, maxTokens: 100, timeout: 2000 }))
  assert.equal(h.calls.length, 4)
  assert.equal(h.calls.filter(call => call[1].max_tokens === undefined).length, 1)
})

test('P2 streaming JSON fallback and text-free finish frames retain truncation evidence', async () => {
  await serverRun([
    { choices: [{ delta: { content: '{' } }] },
    { choices: [{ delta: {}, finish_reason: 'length' }], usage: { completion_tokens: 5 } },
  ], async endpoint => {
    const h = harness(() => {}, 1, { endpoint })
    await assert.rejects(h.narrator.sideTaskJson({ ...h.provider, zhipuOfficial: true, protocol: 'chat-completions' }, 'm', 'test', 2000,
      (capped: boolean) => ({ messages: [], ...(capped ? { max_tokens: 100 } : {}) }), JSON.parse), /length/)
    assert.equal(h.usage[0]?.outputTokens, 10)
  })
  let calls = 0
  const server = createServer((_req, res) => {
    calls++
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(response(prose, calls === 1 ? 'length' : 'stop')))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const h = harness(() => {}, 1, { endpoint: 'http://127.0.0.1:' + (server.address() as any).port + '/v1/chat/completions' })
    const input = request(); input.onEarlyReply = async () => false
    assert.equal((await h.narrator.decide(input)).script, '她放下杯子。')
    assert.equal(calls, 2)
    assert.equal(h.usage[0]?.outputTokens, 10)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
