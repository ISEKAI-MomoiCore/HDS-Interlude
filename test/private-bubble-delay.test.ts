import assert from 'node:assert/strict'
import test from 'node:test'
import { activatePrivateBubbleGroup, deliverPrivateBubbleGroup, firstPrivateBubbleDueAt, persistPrivateBubbleGroup, privateBubblePlan, splitPrivateBubbleContent, validatePrivateBubbleDelay } from '../src/delivery/private-bubbles'
import { deliverDueSplitSegments } from '../src/intents'
import { prepareOutgoingDelivery } from '../src/delivery'
import { systemPrompt, toPromptPayload } from '../src/narrator'
import { splitVisibleReplyBubbles } from '../src/narrative-normalizers'
import { InterludeService } from '../src/service'
import { updateScriptDeliveryActions } from '../src/script/delivery-ledger'
import { attentionFixture } from './event-attention-fixture'
import { emptyStorySetting, emptyStoryState, type NarrativeDecision, type NarrativeIntent, type OutgoingMessageDraft } from '../src/types'

const base = new Date('2026-11-25T13:10:00.000Z')
const at = (ms: number) => new Date(+base + ms)
const story = { id: 'story', status: 'active' } as any
const participant = { id: 'p', status: 'active' } as any
const text = ['那就明天吧', '等等，我明晚好像有事', '周五呢？']
const separator = '<sep/>'
const runtime = { messageSeparator: separator, maxMessageCharacters: 500, splitReplyMessages: true } as any
const decision = (content: string, delays?: unknown) => ({ script: '她发了消息。', interaction: {
  seen: true, reply: { mode: 'immediate', content, ...(delays !== undefined ? { bubbleDelaySeconds: delays } : {}) },
} }) as NarrativeDecision

function fixture() {
  let intent: NarrativeIntent | undefined
  let statuses = [{ commitId: 'c', eventId: 'e', eventKind: 'outgoing-message', participantId: 'p', status: 'pending', updatedAt: base.toISOString(),
    segments: text.map((content, index) => ({ index, kind: 'message', content, status: 'pending' })) }]
  const sends: string[] = []
  const wakes: number[] = []
  let typingCalls = 0
  const entry = () => ({ id: 8, storyId: story.id, kind: 'script', actor: 'character', participantId: participant.id,
    content: text.join(' '), occurredAt: base, createdAt: base, metadata: { commitId: 'c', deliveryActions: statuses } })
  const dbMatches = (filter: any) => intent && (filter.id === undefined || filter.id === intent.id || filter.id.$in?.includes(intent.id))
    && (filter.status === undefined || filter.status === intent.status) && (!filter.notBefore?.$lte || intent.notBefore <= filter.notBefore.$lte)
  const host: any = {
    interruptedTypingParticipants: new Set<string>(), desktopRuntimePhase: 'running',
    reportStandalone() {}, scheduleDueIntentWake: (_story: string, time: Date) => wakes.push(+time), scheduleNextPendingWake: async () => {},
    scheduler: { cancelWake() {} }, config: { runtime }, appendEntry: async () => {},
    deliveryGeneration: () => 'valid', taskGeneration: () => 'valid', taskGenerationCurrent: () => true,
    serial: async (_id: string, fn: () => any) => fn(), getStory: async () => story, getParticipant: async () => participant,
    splitOutgoingMessage: (content: string) => splitVisibleReplyBubbles(content, { separator, splitEnabled: true }),
    typingDelayMilliseconds: () => { typingCalls++; return 1_000 },
    dbCreate: async (_table: string, row: NarrativeIntent) => (intent = { ...row, id: 1 }),
    dbGet: async (table: string, filter: any) => table === 'interlude_script_entry' ? [entry()] : dbMatches(filter) ? [{ ...intent! }] : [],
    dbSet: async (_table: string, filter: any, patch: any) => { if (dbMatches(filter)) intent = { ...intent!, ...patch } },
    updateScriptDeliveryOutcome: async (_id: string, reference: any, status: any, time: Date, reason: string) => {
      statuses = updateScriptDeliveryActions(statuses, { ...reference, segmentIndex: reference.bubbleIndex }, status, time, reason) as typeof statuses
    },
    deliverOutgoingMessages: async (_story: any, [message]: OutgoingMessageDraft[]) => {
      if (!message.beginPrivateBubbleTransport?.()) return []
      sends.push(message.content)
      await host.updateScriptDeliveryOutcome(story.id, message.scriptEvent, 'delivered', new Date())
      return [message]
    },
  }
  const message: OutgoingMessageDraft = {
    participantId: participant.id, content: text.join(separator), userInitiated: true,
    interaction: decision(text.join(separator), [4, 3, 0]).interaction,
    scriptEvent: { scriptEntryId: 8, commitId: 'c', eventId: 'e', eventKind: 'outgoing-message', causedByEventIds: [],
      fullContent: text.join(separator), bubbleIndex: 0, bubbleCount: 3 },
  }
  const cancel = () => (InterludeService.prototype as any).cancelPendingOutgoingMessages.call(host, story.id, participant.id, new Date()) as Promise<NarrativeIntent[]>
  return { host, message, sends, wakes, entry, cancel, intent: () => intent!, typingCalls: () => typingCalls,
    stage: async () => {
      const plan = await persistPrivateBubbleGroup(host, story, participant, prepareOutgoingDelivery(message, host.splitOutgoingMessage(message.content))!, base)
      activatePrivateBubbleGroup(host, plan, participant)
    } }
}

test('first bubble credits elapsed model time instead of adding it to both floors', () => {
  assert.equal(+firstPrivateBubbleDueAt(base, at(8_000), 20_000), +at(20_000))
  assert.equal(+firstPrivateBubbleDueAt(base, at(25_000), 20_000), +at(25_000))
})

test('one finite number per actual private bubble, including zero and split disabled', () => {
  for (const values of [undefined, [], [0, 1], [-1], ['0'], [Infinity], [NaN], [3e10]]) {
    assert.equal(validatePrivateBubbleDelay(decision(text[0], values), base, runtime).valid, false)
  }
  assert.equal(validatePrivateBubbleDelay(decision(text[0], [0]), base, runtime).valid, true)
  const two = text.slice(0, 2).join(separator)
  assert.equal(validatePrivateBubbleDelay(decision(two, [0, 1.5]), base, runtime).valid, true)
  assert.equal(validatePrivateBubbleDelay(decision(two, [0]), base, { ...runtime, splitReplyMessages: false }).valid, true)
  const lines = text.slice(0, 2).join('\n')
  assert.equal(validatePrivateBubbleDelay(decision(lines, [0, 1]), base, { ...runtime, convertNewlineToSeparator: true }).valid, true)
  assert.deepEqual(splitPrivateBubbleContent(lines, { ...runtime, convertNewlineToSeparator: true }), text.slice(0, 2))
  assert.equal(validatePrivateBubbleDelay({ interaction: { seen: true, reply: { mode: 'none' } } }, base, runtime).valid, true)
})

test('the prompt change is confined to the opted-in private output contract', () => {
  const prompt = (group: boolean, timed: boolean) => systemPrompt('user-message', '', '', '', '', '', false, false,
    false, false, false, undefined, false, undefined, false, false, false, group,
    { messageSeparator: separator, splitReplyMessages: true, privateBubbleDelay: timed, browserMode: 'disabled' })
  assert.match(prompt(false, true), /"bubbleDelaySeconds":\[0\]/)
  assert.match(prompt(false, true), /Do not change the wording or split a message just to add a delay/)
  assert.doesNotMatch(prompt(false, true), /first segment immediately/)
  assert.doesNotMatch(prompt(true, false), /bubbleDelaySeconds/)
  assert.doesNotMatch(prompt(false, false), /bubbleDelaySeconds/)
})

test('new contract repairs once and never passes an early callback or an invalid action through', async () => {
  const calls: any[][] = []
  const fixtureStory = { ...attentionFixture('private').story, setting: emptyStorySetting(), state: emptyStoryState() }
  const host = {
    usesPrivateBubbleDelay: InterludeService.prototype.usesPrivateBubbleDelay, modelResponseLogLimit: () => 0,
    config: { runtime }, modelRouting: { main: { available: true } }, browserConfig: { enabled: false },
    report: () => {}, reportOperation: () => {}, mainModelLabel: () => 'fake',
    decide: async (...args: unknown[]) => { calls.push(args); return decision(text[0], calls.length === 2 ? [0] : undefined) },
  }
  const run = () => (InterludeService.prototype as any).tryDecide.call(host, fixtureStory, participant, 'user-message',
    at(-1_000), base, '你好', [], [], undefined, [], [], undefined, [], [], undefined, undefined, () => { throw Error('early send') })
  assert.equal((await run()).succeeded, true)
  assert.deepEqual(calls.map(call => [call[12], call[18]]), [[false, undefined], [true, undefined]])
  const exact = '第一句\n第二句'
  host.config.runtime = { ...runtime, convertNewlineToSeparator: true, maxMessageCharacters: exact.length }
  host.decide = async () => decision(exact, [0, 0])
  assert.equal((await run()).decision.interaction?.reply.content, exact, 'inserting canonical separators before the persist-time clamp would clip the second bubble')
  host.decide = async () => decision(text[0])
  assert.deepEqual((await run()).decision, {})
})

test('wake sends one bubble and anchors the next delay to actual successful delivery', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: base })
  const f = fixture()
  await f.stage()
  assert.equal(+f.intent().notBefore, +at(4_000))
  assert.deepEqual(f.sends, [])
  t.mock.timers.setTime(+at(9_000)) // scheduler/transport did not run at the intended time
  await deliverDueSplitSegments(f.host, story.id)
  assert.deepEqual(f.sends, [text[0]])
  assert.equal(+f.intent().notBefore, +at(12_000))
  await deliverDueSplitSegments(f.host, story.id)
  assert.deepEqual(f.sends, [text[0]])
  t.mock.timers.setTime(+at(12_000))
  await deliverDueSplitSegments(f.host, story.id)
  assert.deepEqual(f.sends, text.slice(0, 2))
  assert.equal(+f.intent().notBefore, +at(13_000), '0 does not delete the typing floor')
  t.mock.timers.setTime(+at(13_000))
  await deliverDueSplitSegments(f.host, story.id)
  assert.deepEqual(f.sends, text)
  assert.equal(f.typingCalls(), 3)
  assert.equal(f.intent().status, 'completed')
})

test('first bubble can be cancelled; next prompt sees only definite drafts in both payload modes', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: base })
  const f = fixture()
  await f.stage()
  t.mock.timers.setTime(+at(2_000))
  const drafts = await f.cancel()
  const interruption = drafts[0].payload.privateBubbleInterruption as any
  assert.deepEqual(interruption.cancelledBubbles.map((item: any) => item.content), text)
  assert.deepEqual(interruption.deliveredBubbleIndexes, [])
  assert.equal(interruption.interruptedAt, at(2_000).toISOString())
  interruption.triggerMessageIndex = 1
  for (const cacheFirst of [false, true]) {
    const request = { ...attentionFixture('private'), story: { ...attentionFixture('private').story, setting: emptyStorySetting(), state: emptyStoryState() },
    participant: { id: participant.id, state: { relationshipOverlay: [], openThreads: [], relationshipNotes: [], unreadMessageCount: 1, pendingReplyCount: 0 }, updatedAt: base, displayName: 'P', profile: '', relationship: '', personId: 'person' },
    participants: [], dueIntents: [], activeConsequences: [], memories: [], facts: [], supersededIntents: drafts, recentEntries: [f.entry()] } as any
    const payload = toPromptPayload(request, { cacheFirst }) as any
    const group = (payload.interruptedOutgoingDrafts ?? payload.ongoingThreads.interruptedOutgoingDrafts)[0]
    assert.equal(group.triggerMessageIndex, 1)
    assert.deepEqual(group.cancelledBubbles, text.map((content, i) => ({ content, bubbleIndex: i + 1 })))
    assert.doesNotMatch(JSON.stringify(group), /没打完/)
  }
  t.mock.timers.setTime(+at(9_000))
  await deliverPrivateBubbleGroup(f.host, story.id, f.intent().id)
  assert.deepEqual(f.sends, [])
})

test('a new message does not wait for an in-flight handoff and a late receipt cannot release a cancelled tail', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: base })
  const f = fixture()
  await f.stage()
  t.mock.timers.setTime(+at(4_000))
  await deliverDueSplitSegments(f.host, story.id)
  t.mock.timers.setTime(+at(7_000))
  const handoff = Promise.withResolvers<OutgoingMessageDraft>()
  const ack = Promise.withResolvers<void>()
  f.host.deliverOutgoingMessages = async (_story: any, [message]: OutgoingMessageDraft[]) => {
    assert.ok(message.beginPrivateBubbleTransport?.())
    f.sends.push(message.content)
    handoff.resolve(message)
    await ack.promise
    await f.host.updateScriptDeliveryOutcome(story.id, message.scriptEvent, 'delivered', new Date())
    return [message]
  }
  const running = deliverDueSplitSegments(f.host, story.id)
  await handoff.promise
  t.mock.timers.setTime(+at(7_100))
  const interrupt = (await f.cancel())[0].payload.privateBubbleInterruption as any
  assert.deepEqual(interrupt.deliveredBubbleIndexes, [1])
  assert.deepEqual(interrupt.unresolvedBubbleIndexes, [2])
  assert.deepEqual(interrupt.cancelledBubbles, [{ bubbleIndex: 3, content: text[2] }])
  ack.resolve()
  await running
  assert.equal(f.intent().status, 'cancelled')
  assert.equal(privateBubblePlan(f.intent())?.nextIndex, 1)
  assert.deepEqual(f.entry().metadata.deliveryActions[0].segments.map(segment => segment.status), ['delivered', 'delivered', 'cancelled'])
  await deliverDueSplitSegments(f.host, story.id)
  assert.deepEqual(f.sends, text.slice(0, 2))
})

test('a one-bubble reply interrupted after platform handoff still gives the next turn an unresolved-delivery record', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: base })
  const f = fixture()
  await f.stage()
  privateBubblePlan(f.intent())!.bubbles.splice(1)
  f.entry().metadata.deliveryActions[0].segments.splice(1)
  t.mock.timers.setTime(+at(4_000))
  const handoff = Promise.withResolvers<void>()
  const ack = Promise.withResolvers<void>()
  f.host.deliverOutgoingMessages = async (_story: any, [message]: OutgoingMessageDraft[]) => {
    assert.ok(message.beginPrivateBubbleTransport?.())
    handoff.resolve()
    await ack.promise
    return []
  }
  const running = deliverDueSplitSegments(f.host, story.id)
  await handoff.promise
  const interruption = (await f.cancel())[0].payload.privateBubbleInterruption as any
  assert.deepEqual(interruption.cancelledBubbles, [])
  assert.deepEqual(interruption.unresolvedBubbleIndexes, [1])
  ack.resolve()
  await running
})

test('after restart an attempted bubble with no receipt is never replayed or followed by its tail', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: base })
  const f = fixture()
  await f.stage()
  privateBubblePlan(f.intent())!.attempting = true
  t.mock.timers.setTime(+at(5_000))
  await deliverDueSplitSegments(f.host, story.id)
  assert.deepEqual(f.sends, [])
  assert.deepEqual(f.entry().metadata.deliveryActions[0].segments.map(segment => segment.status), ['unknown', 'cancelled', 'cancelled'])
})

test('pause before platform handoff clears the attempt marker without invalidating the draft', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: base })
  const f = fixture()
  await f.stage()
  t.mock.timers.setTime(+at(4_000))
  let generation = 'before-pause'
  f.host.taskGeneration = () => generation
  f.host.taskGenerationCurrent = (_storyId: string, value: string) => generation === value
    && f.host.desktopRuntimePhase !== 'paused'
  const lookup = Promise.withResolvers<void>()
  const resumeLookup = Promise.withResolvers<void>()
  const originalDeliver = f.host.deliverOutgoingMessages
  f.host.deliverOutgoingMessages = async (_story: any, [message]: OutgoingMessageDraft[]) => {
    lookup.resolve()
    await resumeLookup.promise
    assert.equal(message.beginPrivateBubbleTransport?.(), false)
    return []
  }
  const running = deliverDueSplitSegments(f.host, story.id)
  await lookup.promise
  assert.equal(privateBubblePlan(f.intent())?.attempting, true)
  f.host.desktopRuntimePhase = 'paused'
  generation = 'after-pause'
  f.host.desktopRuntimePhase = 'running'
  resumeLookup.resolve()
  await running
  assert.equal(privateBubblePlan(f.intent())?.attempting, undefined)
  assert.equal(f.entry().metadata.deliveryActions[0].segments[0].status, 'pending')
  assert.equal(f.wakes.length, 2, 'fast resume must not lose the wake while the original attempt is busy')
  f.host.deliverOutgoingMessages = originalDeliver
  await deliverDueSplitSegments(f.host, story.id)
  assert.deepEqual(f.sends, [text[0]])
})

test('a persisted attempt interrupted before platform handoff is still a cancelled draft', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: base })
  const f = fixture()
  await f.stage()
  t.mock.timers.setTime(+at(4_000))
  const lookup = Promise.withResolvers<void>()
  const resumeLookup = Promise.withResolvers<void>()
  f.host.deliverOutgoingMessages = async (_story: any, [message]: OutgoingMessageDraft[]) => {
    lookup.resolve()
    await resumeLookup.promise
    assert.equal(message.beginPrivateBubbleTransport?.(), false)
    return []
  }
  const running = deliverDueSplitSegments(f.host, story.id)
  await lookup.promise
  const interruption = (await f.cancel())[0].payload.privateBubbleInterruption as any
  assert.deepEqual(interruption.unresolvedBubbleIndexes, [])
  assert.deepEqual(interruption.cancelledBubbles.map((bubble: any) => bubble.content), text)
  resumeLookup.resolve()
  await running
  assert.equal(f.intent().status, 'cancelled')
})
