import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { OpenAICompatibleNarrator } from '../src/narrator'

test('Zhipu side tasks honor the total timeout even after the first visible SSE token', async () => {
  let requests = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const frame = (content: string) => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n'
    response.write(frame('{"ok":'))
    const timer = setTimeout(() => {
      response.write(frame('true}'))
      response.end('data: [DONE]\n\n')
    }, 2500)
    timers.add(timer)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const narrator: any = Object.create(OpenAICompatibleNarrator.prototype)
    const provider = { endpoint: 'http://127.0.0.1:' + address.port, zhipuOfficial: true, protocol: 'chat-completions', extraHeaders: '' }
    const start = Date.now()
    await assert.rejects(narrator.sideTaskJson(provider, 'glm-test', 'Alter 分析', 1000, () => ({}), JSON.parse, []), /Zhipu task total timeout exceeded 1000ms/)
    assert.ok(Date.now() - start < 2400, 'the total deadline must beat the remaining stream')
    assert.equal(requests, 1, 'a total timeout is not a parse-error recovery retry')
  } finally {
    for (const timer of timers) clearTimeout(timer)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
