import assert from 'node:assert/strict'
import test from 'node:test'
import { Config } from '../src/index'
import { InterludeService } from '../src/service'
import { systemPrompt } from '../src/narrator'
import { validateScriptCommit } from '../src/script/validator'
import { deliveryReality } from '../src/script/delivery-reality'
import { emptyStorySetting, emptyStoryState, type NarrativeDecision, type NarrativePhase } from '../src/types'

const now = new Date('2026-10-11T09:03:00Z')
const action = (content: string, extra = {}) => ({ participantId: 'alice', mode: 'immediate' as const, content, willingness: 0.9, ...extra })

async function persist(decision: NarrativeDecision, phase: NarrativePhase = 'advance', runtime = {}, agency = {}) {
  const story: any = { id: 's', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now }
  const entries: any[] = [], intents: any[] = [], warnings: any[] = []
  const host: any = Object.assign(Object.create(InterludeService.prototype), {
    config: { runtime: { ...Config.dict.runtime({}), allowProactiveMessages: true, ...runtime },
      sharedStory: { maxCrossConversationActions: 8 }, onebot: { groupChats: [{ enabled: true, groupId: '123' }] }, agency },
    participants: async () => ['alice', 'bob'].map(id => ({ id, state: {}, updatedAt: now })),
    canHandleParticipant: () => true, shouldRefreshContinuity: () => false,
    activeScene: async () => null, pruneWorkingDetails: (value: any) => value ?? [],
    appendEntry: async (_storyId: string, draft: any) => {
      const entry = { ...draft, id: entries.length + 1, storyId: 's', createdAt: now }
      entries.push(entry); return entry
    },
    applyIntentUpdates: async () => 0, updateAlterSystem: () => undefined,
    dbGet: async (_table: string, query: any) => entries.filter(entry => entry.id === query.id),
    dbSet: async (table: string, query: any, patch: any) => {
      if (table === 'interlude_script_entry') Object.assign(entries.find(entry => entry.id === query.id), patch)
    }, longHorizonSweep: async () => {},
    appendIntent: async (_id: string, draft: any) => { intents.push(draft) }, scheduleDueIntentWake: () => {},
    reportOperation: (...args: any[]) => { if (args[1] === 'warn') warnings.push(args) }, reportStandalone: () => {},
    pendingProactiveCount: 0,
    decide: () => assert.fail('The compatibility gate must not request model recovery'),
    sendOutgoingMessages: () => assert.fail('Persistence must not send directly'),
  })
  const result = await host.persistDecision(story, null, decision, now, now, true, phase)
  assert.equal(validateScriptCommit(result.commit, host.config.runtime.messageSeparator).valid, true)
  assert.equal(entries.filter(entry => entry.kind === 'script').length, 1, 'only the final commit is persisted')
  assert.equal(entries[0].metadata.commitId, result.commit.commitId)
  return { ...result, entries, intents, warnings, host }
}

test('advance: content-only small-model output sends without say/actionId', async () => {
  const result = await persist({ script: '她发出「在吗」', crossConversationActions: [action('在吗', { endpointId: 'qq:alice' })] })
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].content, '在吗')
  assert.equal(result.messages[0].endpointId, 'qq:alice')
  assert.equal(result.messages[0].scriptEvent.commitId, result.commit.commitId)
  assert.equal(result.entries[0].metadata.deliveryActions.length, 1)
  assert.equal(result.warnings.length, 0)
})

for (const script of ['她发出「消息甲」', '她想起「消息乙」，又想起「消息乙」']) {
  test('advance: missing/ambiguous words drop only transport before the first write: ' + script, async () => {
    const result = await persist({ script, crossConversationActions: [action('消息乙')] })
    assert.deepEqual(result.messages, [])
    assert.equal(result.commit.prose, script)
    assert.deepEqual(result.entries[0].metadata.deliveryActions, [])
    assert.equal(result.commit.events.filter((event: any) => event.kind === 'outgoing-message').length, 0)
    assert.equal(result.intents.length, 0, 'no deferred resend')
    assert.equal(result.warnings.length, 1)
    assert.equal(deliveryReality(result.entries)[0].communicationOutcome, 'no-outgoing-action-recorded')
  })
}

test('advance: valid messages survive beside rejected messages with their final ledger ids', async () => {
  const result = await persist({ script: '她发出「消息甲」', crossConversationActions: [action('消息乙'), action('消息甲', { participantId: 'bob' })] })
  assert.deepEqual(result.messages.map((message: any) => message.participantId), ['bob'])
  assert.equal(result.entries[0].metadata.deliveryActions.length, 1)
  assert.equal(result.entries[0].metadata.deliveryActions[0].participantId, 'bob')
  assert.equal(result.messages[0].scriptEvent.eventId, result.entries[0].metadata.deliveryActions[0].eventId)
})

test('advance: say/actionId still supplies authoritative text instead of an inconsistent mirror', async () => {
  const result = await persist({ script: '她发出<say id="p-1">消息甲</say>', crossConversationActions: [action('消息乙', { actionId: 'p-1' })] })
  assert.equal(result.messages[0].content, '消息甲')
  assert.equal(result.commit.prose, '她发出消息甲')
})

test('advance: a wrong explicit id cannot fall back to content-only', async () => {
  const result = await persist({ script: '她发出<say id="p-1">消息甲</say>', crossConversationActions: [action('消息甲', { actionId: 'missing' })] })
  assert.deepEqual(result.messages, [])
  assert.deepEqual(result.entries[0].metadata.deliveryActions, [])
})

test('advance: host synthesis from the sole say still passes the same gate', async () => {
  const result = await persist({ script: '她发出<say id="p-1">消息甲</say>', proactiveContact: { participantId: 'alice' } as any })
  assert.equal(result.messages[0].content, '消息甲')
  assert.equal(result.entries[0].metadata.deliveryActions.length, 1)
})

test('advance: quotation marks or say alone do not create a send', async () => {
  for (const script of ['她发出「消息甲」', '她发出<say id="p-1">消息甲</say>']) {
    const result = await persist({ script })
    assert.deepEqual(result.messages, [])
    assert.deepEqual(result.entries[0].metadata.deliveryActions, [])
  }
})

for (const separator of ['<sep/>', '|']) {
  test('advance: content-only multi-bubble text stays supported: ' + separator, async () => {
    const result = await persist({ script: '她先发「消息甲」，接着发「消息乙」', crossConversationActions: [action('消息甲' + separator + '消息乙')] }, 'advance', { messageSeparator: separator })
    assert.equal(result.messages[0].content, '消息甲')
    assert.deepEqual(result.messages[0].laterSegments, ['消息乙'])
    assert.equal(result.messages[0].scriptEvent.bubbleCount, 2)
    assert.equal(result.entries[0].metadata.deliveryActions.length, 1)
  })
}

test('advance: checking uses final clipped prose, not the earlier raw script', async () => {
  const result = await persist({ script: '她拿起手机，发出「消息甲」', crossConversationActions: [action('消息甲')] }, 'advance', { maxScriptCharacters: 6 })
  assert.deepEqual(result.messages, [])
  assert.deepEqual(result.entries[0].metadata.deliveryActions, [])
})

test('advance: immediate cross-group sends are checked without removing valid groups', async () => {
  for (const [content, count] of [['消息甲', 1], ['消息乙', 0]] as const) {
    const result = await persist({ script: '她在群里发出「消息甲」', crossConversationActions: [action(content, { participantId: 'group:123' })] })
    assert.equal(result.messages.length, count)
    assert.equal(result.entries[0].metadata.deliveryActions.length, count)
  }
})

test('advance: delayed scheduling and future binding stay unchanged', async () => {
  const result = await persist({ script: '她把手机收起来', crossConversationActions: [action('晚点说', { mode: 'delayed', sendAt: new Date(now.getTime() + 60000).toISOString() })] })
  assert.deepEqual(result.messages, [])
  assert.equal(result.intents.length, 1)
  assert.equal(result.intents[0].payload.content, '晚点说')
  assert.equal(result.commit.events.find((event: any) => event.deliveryMode === 'delayed').scriptBinding.status, 'future')
})

test('user-message: unbound legacy cross-contact compatibility is unchanged', async () => {
  const result = await persist({ script: '她看了一眼手机', crossConversationActions: [action('旧式消息')] }, 'user-message')
  assert.equal(result.messages[0].content, '旧式消息')
  assert.equal(result.commit.events.find((event: any) => event.kind === 'outgoing-message').scriptBinding.status, 'unbound')
})

test('advance: compatible binding does not bypass the global proactive-message switch', async () => {
  const result = await persist({ script: '她发出「消息甲」', crossConversationActions: [action('消息甲')] }, 'advance', { allowProactiveMessages: false })
  assert.deepEqual(result.messages, [])
})

test('advance: content-only binding does not bypass Agency with no eligible candidate', async () => {
  const result = await persist({ script: '她发出「消息甲」', crossConversationActions: [action('消息甲')] }, 'advance', {}, { enabled: true })
  assert.deepEqual(result.messages, [])
})

test('all advance prompt tiers explicitly permit content-only and require literal message bubbles', () => {
  for (const tier of ['lite', 'standard', 'full'] as const) {
    const prompt = systemPrompt('advance', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
      { tier, family: 'generic', source: 'manual', probe: 'manual' })
    assert.match(prompt, /content-only actions are supported; say markup and actionId are not required/)
    assert.match(prompt, /Write each message bubble verbatim in the script/)
    assert.doesNotMatch(prompt, /"actionId":"authored say id"/)
  }
})
