import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureDateTag, captureEndpointHost, captureFileName, ModelCaptureSink, sanitizeCapturedMessages, type MainNarrativeCaptureRecord } from '../src/capture'
import { OpenAICompatibleNarrator, type ModelConfig, type ProviderConfig } from '../src/narrator'
import { emptyStorySetting, emptyStoryState, type NarrativeRequest } from '../src/types'

const provider: ProviderConfig = { label: 'capture-test', enabled: true, endpoint: 'https://gateway.test/v1/chat/completions', apiKey: 'test-key', model: 'test-model',
  temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 1000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForMain: true }
const modelConfig = (providers = [provider]): ModelConfig => ({ providers, fixedPrompt: '', stylePrompt: '', failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: 2, cooldownMinutes: 0 } })
function request(phase: NarrativeRequest['phase'] = 'user-message'): NarrativeRequest {
  const now = new Date('2026-10-21T12:00:00Z')
  return { phase, story: { id: 's', platform: 'onebot', selfId: 'b', userId: '', channelId: '', status: 'active', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now },
    from: now, now, participant: null, participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [], images: [], audio: [], userMessage: '你好' }
}
const decisionText = JSON.stringify({ script: '正文内容。', interaction: { seen: true, reply: { mode: 'immediate', content: '你好' } } })
const chatResponse = (text: string) => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 11, completion_tokens: 7 } })
const entryFixture = (index: number): MainNarrativeCaptureRecord => ({
  capturedAt: new Date().toISOString(), task: 'main', phase: 'advance', storyId: 's', participantId: null,
  provider: { label: 'p', model: 'm', host: 'h.test' }, attemptIndex: index, latencyMs: 5,
  request: { messages: [{ role: 'system', content: 'contract' }], responseFormat: 'json-object', temperature: 0.8, topP: 1, maxTokens: 4096 },
  responseText: '{"script":"正文"}',
})

function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function readCaptureLines(dir: string): MainNarrativeCaptureRecord[] {
  const files = readdirSync(dir)
  return files.flatMap(file => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)))
}

test('sanitize strips inline base64 media but keeps text parts and metadata', () => {
  const messages = [
    { role: 'system', content: 'contract' },
    { role: 'user', content: [
      { type: 'text', text: 'payload' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==', detail: 'auto' } },
      { type: 'input_audio', input_audio: { data: 'AA==', format: 'mp3' } },
    ] },
  ] as any[]
  const sanitized = sanitizeCapturedMessages(messages)
  assert.equal(sanitized[0].content, 'contract')
  const parts = sanitized[1].content as any[]
  assert.equal(parts[0].text, 'payload')
  assert.match(parts[1].image_url.url, /^\[omitted data-uri /)
  assert.equal(parts[1].image_url.detail, 'auto')
  assert.match(parts[2].input_audio.data, /^\[omitted base64 /)
  assert.equal(parts[2].input_audio.format, 'mp3')
  // 原数组保持不变（浅拷贝替换，不原地改写）。
  assert.equal((messages[1].content as any[])[1].image_url.url, 'data:image/png;base64,AA==')
  assert.equal((messages[1].content as any[])[2].input_audio.data, 'AA==')
})

test('date tags and file names use the local calendar day', () => {
  assert.equal(captureDateTag(new Date(2026, 9, 21, 23, 59)), '2026-10-21')
  assert.match(captureFileName(new Date(2026, 9, 21)), /^hdsi-capture-2026-10-21\.jsonl$/)
  assert.equal(captureEndpointHost('https://gateway.test/v1/chat/completions?x=1'), 'gateway.test')
  assert.equal(captureEndpointHost('not a url'), '')
})

test('sink appends one JSONL line per record into the dated file', async () => {
  const dir = tempDir('hdsi-capture-write-')
  try {
    const sink = new ModelCaptureSink(dir)
    sink.record(entryFixture(1))
    sink.record(entryFixture(2))
    await sink.flush()
    assert.deepEqual(readdirSync(dir), [captureFileName()])
    const records = readCaptureLines(dir)
    assert.equal(records.length, 2)
    assert.equal(records[0].storyId, 's')
    assert.equal(records[1].attemptIndex, 2)
    assert.equal(records[1].responseText, '{"script":"正文"}')
    assert.equal(sink.active, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sink never throws and auto-disables after consecutive write failures', async () => {
  const root = tempDir('hdsi-capture-fail-')
  try {
    // 用一个普通文件作为父路径，mkdir recursive 必然失败。
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'x')
    const sink = new ModelCaptureSink(join(blocker, 'sub'))
    for (let index = 0; index < 3; index++) {
      sink.record(entryFixture(index + 1))
      await sink.flush()
    }
    assert.equal(sink.active, false)
    sink.record(entryFixture(4))
    await sink.flush()
    assert.equal(sink.active, false)
    assert.deepEqual(readdirSync(root), ['blocker'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('narrator captures the raw request and response of a successful dialogue turn', async () => {
  const dir = tempDir('hdsi-capture-turn-')
  try {
    const sink = new ModelCaptureSink(dir)
    const narrator = new OpenAICompatibleNarrator({ http: { post: async () => chatResponse(decisionText) } } as any, modelConfig(), true, undefined, undefined, sink)
    const decision = await narrator.decide(request())
    await sink.flush()
    assert.equal(decision.script, '正文内容。')
    const records = readCaptureLines(dir)
    assert.equal(records.length, 1)
    const record = records[0]
    assert.equal(record.task, 'main')
    assert.equal(record.phase, 'user-message')
    assert.equal(record.storyId, 's')
    assert.equal(record.participantId, null)
    assert.equal(record.provider.host, 'gateway.test')
    assert.equal(record.provider.model, 'test-model')
    assert.equal(record.provider.label, 'capture-test')
    assert.equal(record.attemptIndex, 1)
    assert.deepEqual(record.usage, { inputTokens: 11, outputTokens: 7 })
    assert.equal(record.request.messages.length, 2)
    assert.equal(record.request.messages[0].role, 'system')
    assert.equal(typeof record.request.messages[0].content, 'string')
    assert.ok(String(record.request.messages[0].content).length > 100)
    assert.equal(record.request.messages[1].role, 'user')
    assert.equal(typeof record.request.messages[1].content, 'string')
    assert.equal(record.request.responseFormat, 'json-object')
    assert.equal(record.request.maxTokens, 4096)
    assert.ok(record.responseText.includes('正文内容。'))
    assert.ok(typeof record.latencyMs === 'number')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('narrator captures automatic-life advance turns under the same phase field', async () => {
  const dir = tempDir('hdsi-capture-advance-')
  try {
    const sink = new ModelCaptureSink(dir)
    const narrator = new OpenAICompatibleNarrator({ http: { post: async () => chatResponse(decisionText) } } as any, modelConfig(), true, undefined, undefined, sink)
    await narrator.decide(request('advance'))
    await sink.flush()
    const records = readCaptureLines(dir)
    assert.equal(records.length, 1)
    assert.equal(records[0].phase, 'advance')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid model JSON discards the capture entirely', async () => {
  const dir = tempDir('hdsi-capture-invalid-')
  try {
    const sink = new ModelCaptureSink(dir)
    const narrator = new OpenAICompatibleNarrator({ http: { post: async () => chatResponse('这不是 JSON') } } as any, modelConfig(), true, undefined, undefined, sink)
    await assert.rejects(narrator.decide(request()), /All narrative providers failed/)
    await sink.flush()
    assert.deepEqual(readdirSync(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed first attempt is not captured; the successful retry carries its attempt index', async () => {
  const dir = tempDir('hdsi-capture-retry-')
  try {
    const sink = new ModelCaptureSink(dir)
    let calls = 0
    const narrator = new OpenAICompatibleNarrator({ http: { post: async () => {
      if (++calls === 1) throw new Error('gateway unavailable')
      return chatResponse(decisionText)
    } } } as any, modelConfig(), true, undefined, undefined, sink)
    const decision = await narrator.decide(request())
    await sink.flush()
    assert.equal(decision.script, '正文内容。')
    assert.equal(calls, 2)
    const records = readCaptureLines(dir)
    assert.equal(records.length, 1)
    assert.equal(records[0].attemptIndex, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('multimodal user messages land in the capture with base64 replaced by placeholders', async () => {
  const dir = tempDir('hdsi-capture-media-')
  try {
    const sink = new ModelCaptureSink(dir)
    const narrator = new OpenAICompatibleNarrator({ http: { post: async () => chatResponse(decisionText) } } as any, modelConfig(), true, undefined, undefined, sink)
    const input = request()
    input.images = [{ id: '1', mimeType: 'image/png', dataUri: 'data:image/png;base64,QUJDREVG' }]
    input.audio = [{ id: 'a', format: 'mp3', base64: 'QUJDREVG' }]
    await narrator.decide(input)
    await sink.flush()
    const records = readCaptureLines(dir)
    assert.equal(records.length, 1)
    const parts = records[0].request.messages[1].content as any[]
    assert.equal(parts[0].type, 'text')
    assert.match(parts.find(part => part.type === 'image_url').image_url.url, /^\[omitted data-uri /)
    assert.match(parts.find(part => part.type === 'input_audio').input_audio.data, /^\[omitted base64 /)
    assert.ok(!readFileSync(join(dir, readdirSync(dir)[0]), 'utf8').includes('QUJDREVG'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
