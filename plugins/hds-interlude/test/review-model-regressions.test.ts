import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import Module, { createRequire } from 'node:module'
import { createServer, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { buildSync } from 'esbuild'
import { OpenAICompatibleNarrator, OpenAICompatibleEmbedder } from '../src/narrator'
import { requestAnthropicStreaming } from '../src/anthropic'

// Expose private parsers only in this in-memory test module, never in production API/lib.
const source = resolve(__dirname, '../src/narrator.ts')
const bundle = buildSync({ stdin: { contents: readFileSync(source, 'utf8') + '\nexport { requestOpenAICompatibleStreaming, requestZhipuStreaming, providerKey };',
  resolveDir: dirname(source), sourcefile: source, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' })
const compiled: any = new Module(source, module)
compiled.filename = source; compiled.paths = (Module as any)._nodeModulePaths(dirname(source)); compiled.require = createRequire(source)
compiled._compile(bundle.outputFiles[0].text, source)
const { requestOpenAICompatibleStreaming: openai, requestZhipuStreaming: zhipu, providerKey } = compiled.exports
const parsers = [
  { name: 'OpenAI', run: (onText?: any, usage?: any) => openai('http://test.invalid', {}, {}, 1500, onText, usage) },
  { name: 'Zhipu', run: (onText?: any, usage?: any) => zhipu('http://test.invalid', {}, {}, onText, usage, 1500) },
]
const event = (content: string, usage?: any) => `data: ${JSON.stringify({ choices: [{ delta: { content } }], ...(usage ? { usage } : {}) })}\r\n\r\n`

for (const parser of parsers) {
  for (const terminal of ['DONE-open', 'EOF-final'] as const) {
    test(`C11 ${parser.name} completes on ${terminal}, decodes chunk boundaries and collects usage`, async () => {
      const originalFetch = globalThis.fetch
      let cancelled = 0
      const usage: any[] = [], visible: string[] = []
      const data = new TextEncoder().encode(event('小林', { total_tokens: 5 }) + (terminal === 'DONE-open' ? 'data: [DONE]\r\n\r\n' : event('来了').trimEnd()))
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        // Deliberately split JSON, SSE delimiters and Chinese UTF-8 bytes.
        for (let i = 0; i < data.length; i += 7) controller.enqueue(data.slice(i, i + 7))
        if (terminal === 'EOF-final') controller.close()
      }, cancel() { cancelled++ } })
      globalThis.fetch = (async () => new Response(stream)) as typeof fetch
      try {
        const result = await parser.run(async (text: string) => { visible.push(text) }, (value: any) => usage.push(value))
        assert.equal(result, terminal === 'DONE-open' ? '小林' : '小林来了')
        assert.equal(visible.at(-1), result)
        assert.deepEqual(usage, [{ total_tokens: 5 }])
        if (terminal === 'DONE-open') assert.equal(cancelled, 1)
      } finally { globalThis.fetch = originalFetch; await stream.cancel().catch(() => {}) }
    })
  }
  test(`C11 ${parser.name} cancels its response reader when the visible callback fails`, async () => {
    const originalFetch = globalThis.fetch
    let cancelled = 0
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(event('回复'))) }, cancel() { cancelled++ } })
    globalThis.fetch = (async () => new Response(stream)) as typeof fetch
    try {
      await assert.rejects(parser.run(async () => { throw Error('callback failure') }), /callback failure/)
      assert.equal(cancelled, 1)
    } finally { globalThis.fetch = originalFetch }
  })
}
test('C11 OpenAI ordinary JSON fallback is retained for gateways ignoring stream:true', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '普通响应' } }] }))) as typeof fetch
  try { assert.equal(await openai('http://test.invalid', {}, {}, 1500), '普通响应') } finally { globalThis.fetch = original }
})

function mainFixture(strategy = 'ordered', failover = true) {
  const providers = ['a', 'b', 'c'].map(id => ({ id, enabled: true, label: id, endpoint: `http://${id}.invalid`, model: `${id}-model`, maxTokens: 100,
    protocol: 'chat-completions', temperature: .5, topP: 1, timeout: 2000, responseFormat: 'json-object', useForMain: true }))
  const host: any = Object.create(OpenAICompatibleNarrator.prototype)
  Object.assign(host, { config: { providers, failover: { enabled: failover, strategy, maxAttemptsPerProvider: 1, cooldownMinutes: 1 } },
    routing: { main: { assigned: true, providers, target: { model: 'assigned' } } }, cooldownUntil: new Map(), roundRobinOffset: 0 })
  const calls: string[] = []
  host.requestProvider = async (provider: any) => { calls.push(provider.id); return { script: provider.id } }
  return { host, providers, calls }
}
test('C10 assigned main providers respect cooldown and recover through normal selection', async () => {
  const f = mainFixture()
  f.host.cooldownUntil.set(providerKey(f.providers[0]), Date.now() + 60000)
  assert.equal((await f.host.decide({ phase: 'advance' })).script, 'b')
  assert.deepEqual(f.calls, ['b'])
  // All cooling candidates remain available for a recovery attempt.
  for (const p of f.providers) f.host.cooldownUntil.set(providerKey(p), Date.now() + 60000)
  assert.equal((await f.host.decide({ phase: 'advance' })).script, 'a')
})
test('C10 assigned main providers rotate round-robin rather than fixing the first provider', async () => {
  const f = mainFixture('round-robin')
  for (let i = 0; i < 4; i++) await f.host.decide({ phase: 'advance' })
  assert.deepEqual(f.calls, ['a', 'b', 'c', 'a'])
})
test('C10 native-audio capability filtering occurs before disabled-failover truncation', async () => {
  const f = mainFixture('ordered', false)
  f.providers[0].protocol = 'anthropic-messages'
  await f.host.decide({ phase: 'user-message', audio: [{}] })
  assert.deepEqual(f.calls, ['b'])
  assert.ok(!f.host.cooldownUntil.has(providerKey(f.providers[0])))
})
test('C10 successful failover cools only the failed assigned provider', async () => {
  const f = mainFixture()
  f.host.requestProvider = async (provider: any) => { f.calls.push(provider.id); if (provider.id === 'a') throw Error('HTTP 503'); return { script: 'ok' } }
  await f.host.decide({ phase: 'advance' }); await f.host.decide({ phase: 'advance' })
  assert.deepEqual(f.calls, ['a', 'b', 'b'])
  assert.ok(f.host.cooldownUntil.has(providerKey(f.providers[0])))
})

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}
async function close(server: Server, sockets: Set<Socket>) {
  for (const socket of sockets) socket.destroy()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
test('C12 OpenAI, Zhipu, Anthropic streams and embedding all traverse an explicit HTTP CONNECT proxy', async () => {
  const targetSockets = new Set<Socket>(), proxySockets = new Set<Socket>()
  const calls: Array<{ path: string; body: any; authorization: string | undefined }> = []
  let tunnels = 0
  const target = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString())
    calls.push({ path: request.url!, body, authorization: request.headers.authorization })
    if (request.url === '/embeddings') {
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] })); return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (request.url === '/anthropic') {
      response.end('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"通过代理"}}\n\ndata: {"type":"message_stop"}\n\n')
    } else response.end(event('通过代理') + 'data: [DONE]\n\n')
  })
  target.on('connection', socket => { targetSockets.add(socket); socket.on('close', () => targetSockets.delete(socket)) })
  const proxy = createServer((_request, response) => { response.writeHead(405); response.end() })
  proxy.on('connection', socket => { proxySockets.add(socket); socket.on('close', () => proxySockets.delete(socket)) })
  proxy.on('connect', (request, client, head) => {
    tunnels++
    const [host, port] = request.url!.split(':')
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client); client.pipe(upstream)
    })
    proxySockets.add(upstream); upstream.on('close', () => proxySockets.delete(upstream))
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy()); client.on('close', () => upstream.destroy())
  })
  const endpoint = await listen(target), proxyAgent = await listen(proxy)
  try {
    assert.equal(await openai(endpoint + '/openai', {}, {}, 3000, undefined, undefined, proxyAgent), '通过代理')
    assert.equal(await zhipu(endpoint + '/zhipu', {}, {}, undefined, undefined, 3000, proxyAgent), '通过代理')
    assert.equal(await requestAnthropicStreaming(endpoint + '/anthropic', {}, {}, 3000, undefined, undefined, proxyAgent), '通过代理')
    const provider: any = { id: 'embed', enabled: true, endpoint: endpoint + '/chat/completions', model: 'embed-model', useForEmbedding: true, apiKey: 'test-secret', proxyAgent, extraHeaders: '' }
    const embedder = new OpenAICompatibleEmbedder({ http: { post: async () => { throw Error('direct HTTP must not run') } } } as any, {
      providers: [provider], failover: { enabled: true, strategy: 'ordered', maxAttemptsPerProvider: 1, cooldownMinutes: 1 },
      embedding: { enabled: true, model: '', endpoint: endpoint + '/embeddings', maxInputCharacters: 1000, dimensions: 0, timeout: 3000 },
    } as any)
    assert.deepEqual(await embedder.embed('事实内容'), [1, 2, 3])
    assert.equal(tunnels, 4)
    assert.deepEqual(calls.map(call => call.path), ['/openai', '/zhipu', '/anthropic', '/embeddings'])
    assert.equal(calls[3].body.input, '事实内容')
    assert.equal(calls[3].body.model, 'embed-model')
    assert.equal(calls[3].authorization, 'Bearer test-secret')
  } finally { await close(proxy, proxySockets); await close(target, targetSockets) }
})
test('C12 unproxied embedding still uses the Koishi HTTP path and validates vectors', async () => {
  let calls = 0
  const provider: any = { id: 'embed', enabled: true, endpoint: 'http://local.invalid/chat/completions', model: 'embed-model', useForEmbedding: true, extraHeaders: '' }
  const embedder = new OpenAICompatibleEmbedder({ http: { post: async () => { calls++; return { data: [{ embedding: [NaN] }] } } } } as any, {
    providers: [provider], failover: { enabled: true }, embedding: { enabled: true, model: '', endpoint: '', maxInputCharacters: 1000, dimensions: 0, timeout: 3000 },
  } as any)
  await assert.rejects(embedder.embed('事实'), /invalid vector/)
  assert.equal(calls, 1)
})
