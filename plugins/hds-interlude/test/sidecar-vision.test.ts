import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenAICompatibleNarrator, systemPrompt, toPromptPayload } from '../src/narrator'
import { emptyStorySetting, emptyStoryState, InterludeStory, NarrativeRequest } from '../src/types'

const now = new Date('2026-08-31T10:00:00.000Z')

function request(overrides: Partial<NarrativeRequest> = {}): NarrativeRequest {
  const story: InterludeStory = {
    id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
    setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now,
  }
  return {
    phase: 'user-message', story, from: now, now, userMessage: '看看这张图', participant: null,
    participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [],
    ...overrides,
  }
}

test('sidecar observations remain in the current event and never become native image input', () => {
  const payload = toPromptPayload(request({
    images: [],
    visualObservations: ['1. 一只橘猫趴在键盘上。'],
  })) as any
  assert.deepEqual(payload.incomingEvent.event.visualObservations, ['1. 一只橘猫趴在键盘上。'])
  assert.equal(payload.incomingEvent.event.content, '看看这张图')
  assert.match(systemPrompt('user-message', '', '', '', '', ''), /visualObservations/)
})

test('a dedicated vision provider receives OpenAI image_url content and returns bounded plain observations', async () => {
  const calls: any[] = []
  const ctx = {
    http: {
      post: async (_endpoint: string, body: any) => {
        calls.push(body)
        return { choices: [{ message: { content: '1. 图片中是一只趴在键盘上的橘猫。' } }] }
      },
    },
  }
  const narrator = new OpenAICompatibleNarrator(ctx as any, {
    providers: [{
      label: 'Vision', enabled: true, endpoint: 'https://example.test/v1/chat/completions', apiKey: 'key', model: 'vision-model',
      temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 20_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '',
      useForVision: true,
    }],
    failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 },
  } as any, true)
  assert.equal(narrator.visionAvailable(), true)
  const observed = await narrator.describeImages([{ id: 'image-1', mimeType: 'image/jpeg', dataUri: 'data:image/jpeg;base64,AA==' }], '看看这张图', 'low')
  assert.deepEqual(observed, ['1. 图片中是一只趴在键盘上的橘猫。'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].temperature, 0.2)
  assert.equal(calls[0].messages[1].content[1].type, 'image_url')
  assert.equal(calls[0].messages[1].content[1].image_url.detail, 'low')
})

test('sticker describer supports prompt-only transport while retaining its JSON text contract', async () => {
  const calls: any[] = []
  const ctx = { http: { post: async (_endpoint: string, body: any) => {
    calls.push(body)
    return { choices: [{ message: { content: '{"description":"一只挥手的猫","aliases":["打招呼"]}' } }] }
  } } }
  const narrator = new OpenAICompatibleNarrator(ctx as any, {
    providers: [{ label: 'Sticker', enabled: true, endpoint: 'https://example.test/v1/chat/completions', apiKey: 'key', model: 'vision-model', temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 20_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForStickers: true }],
    failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 },
  } as any, true)
  const description = await narrator.describeSticker('data:image/png;base64,AA==', 'image/png', 'hello.png', false, 'prompt-only')
  assert.equal(description?.description, '一只挥手的猫')
  assert.equal('response_format' in calls[0], false)
})
