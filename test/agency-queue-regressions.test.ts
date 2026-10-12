import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { InterludeService } from '../src/service'
import { proactiveCandidateFingerprint } from '../src/agency'
import { formatLogTime } from '../src/time'

const proto = InterludeService.prototype as any
const now = new Date('2026-10-11T08:00:00.000Z')
const story = { id: 's', setting: { timezone: 'Asia/Shanghai' } }
const settle = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function withdrawalHost() {
  const event = { kind: 'outgoing-message', commitId: 'c', eventId: 'e', participantId: 'p',
    content: 'first<sep/>second', bubbles: ['first', 'second'], deliveryMode: 'immediate', causedByEventIds: [], metadata: {} }
  const entry: any = { id: 1, storyId: story.id, metadata: { commitId: 'c', scriptEvents: [event],
    deliveryActions: [{ commitId: 'c', eventId: 'e', eventKind: 'outgoing-message', status: 'pending',
      segments: ['first', 'second'].map((content, index) => ({ index, kind: 'message', content, status: 'pending' })) }],
  } }
  const audits: any[] = []
  const host: any = Object.assign(Object.create(proto), {
    queues: new Map(), serialScope: new AsyncLocalStorage<string>(),
    config: { runtime: { messageSeparator: '<sep/>', maxMessageCharacters: 2000 } },
    dbGet: async () => [structuredClone(entry)],
    dbSet: async (_table: string, _query: any, patch: any) => { entry.metadata = patch.metadata },
    appendEntry: async (_id: string, draft: any) => { audits.push(draft) },
    reportOperation: () => {}, reportStandalone: () => {},
    sendOutgoingMessages: async () => { assert.fail('Withdrawn actions must never be sent') },
  })
  // advance matches participant/content against the commit; proactive-check
  // passes the exact event through interaction.reply. Exercise both call shapes.
  const withdraw = (phase = 'advance') => host.recordWithdrawnOutgoingEvents(story,
    [{ participantId: 'p', content: event.content, ...(phase === 'intent-due' ? { event } : {}) }],
    { events: [event] }, entry, 'agency-blocked', now, phase)
  return { host, entry, audits, withdraw }
}

for (const phase of ['advance', 'intent-due']) {
  test('real story queue: ' + phase + ' withdrawal completes before queued incoming work', { timeout: 2000 }, async () => {
    const { host, entry, audits, withdraw } = withdrawalHost()
    const order: string[] = []
    const advance = host.serial(story.id, async () => {
      await withdraw(phase)
      order.push('withdrawn')
    })
    const incoming = host.serial(story.id, async () => {
      assert.deepEqual(entry.metadata.deliveryActions[0].segments.map((s: any) => s.status), ['cancelled', 'cancelled'])
      order.push('incoming')
    })
    await Promise.all([advance, incoming])
    assert.deepEqual(order, ['withdrawn', 'incoming'])
    assert.equal(entry.metadata.deliveryActions[0].status, 'cancelled')
    assert.equal(audits.length, 1)
    assert.equal(audits[0].metadata.status, 'cancelled')
    assert.equal(host.queues.size, 0)
  })
}

test('real sweep -> advanceStory releases sweepRunning and queued incoming after withdrawal', { timeout: 2000 }, async () => {
  const { host, entry, withdraw } = withdrawalHost()
  const currentStory = { ...story, cursorAt: now, state: {} }
  Object.assign(host, {
    desktopRuntimePhase: 'running', databaseResetting: false, sweepRunning: false,
    getCanonicalStory: async () => currentStory, getStory: async () => currentStory,
    canHandleStory: () => true, taskGeneration: () => 'generation',
    hasPendingNarrative: () => false, scheduleCompaction: () => {},
    advanceUnlocked: async () => { await withdraw(); return [] },
  })
  const sweeping = host.sweep()
  await settle()
  const incoming = host.serial(story.id, async () => 'incoming processed')
  await sweeping
  assert.equal(host.sweepRunning, false)
  assert.equal(await incoming, 'incoming processed')
  assert.equal(entry.metadata.deliveryActions[0].status, 'cancelled')
  assert.equal(host.queues.size, 0)
  await host.sweep()
  assert.equal(host.sweepRunning, false, 'The next sweep must remain available')
})

test('withdrawal outside the queue waits for a genuine concurrent story task', { timeout: 2000 }, async () => {
  const { host, entry, audits, withdraw } = withdrawalHost()
  const hold = deferred(), started = deferred()
  const busy = host.serial(story.id, async () => { started.resolve(); await hold.promise })
  await started.promise
  const withdrawal = withdraw()
  await settle()
  assert.equal(audits.length, 0)
  assert.equal(entry.metadata.deliveryActions[0].status, 'pending')
  hold.resolve()
  await Promise.all([busy, withdrawal])
  assert.equal(entry.metadata.deliveryActions[0].status, 'cancelled')
  assert.equal(host.queues.size, 0)
})

test('withdrawal preserves a previously delivered segment', { timeout: 2000 }, async () => {
  const { host, entry, withdraw } = withdrawalHost()
  entry.metadata.deliveryActions[0].segments[0].status = 'delivered'
  await host.serial(story.id, withdraw)
  assert.deepEqual(entry.metadata.deliveryActions[0].segments.map((s: any) => s.status), ['delivered', 'cancelled'])
})

test('a withdrawal audit failure rejects its task without poisoning later incoming work', { timeout: 2000 }, async () => {
  const { host, withdraw } = withdrawalHost()
  host.appendEntry = async () => { throw new Error('audit unavailable') }
  const failed = host.serial(story.id, withdraw)
  const rejected = assert.rejects(failed, /audit unavailable/)
  const incoming = host.serial(story.id, async () => 'incoming processed')
  await rejected
  assert.equal(await incoming, 'incoming processed')
  assert.equal(host.queues.size, 0)
})

const candidate = {
  participantId: 'p', origin: 'life-event', motive: 'share a life event', disclosure: 'ordinary',
  sourceEntryIds: [1], willingness: 0.8, outcome: 'recheck-later',
  expiresAt: new Date(now.getTime() + 600_000).toISOString(),
}
function schedulingHost(pending: any[] = [], afterRead = () => {}) {
  const intents: any[] = [], wakes: Date[] = [], logs: any[][] = []
  const host: any = Object.assign(Object.create(proto), {
    dbGet: async () => { afterRead(); return pending },
    appendIntent: async (_id: string, draft: any, at: Date) => { intents.push({ ...draft, at }) },
    scheduleDueIntentWake: (_id: string, at: Date) => { wakes.push(at) },
    reportOperation: (...args: any[]) => { logs.push(args) },
  })
  return { host, intents, wakes, logs }
}

for (const scenario of [
  { name: 'past request becomes a short future retry', requested: 30_000, wall: 80_000, afterRead: 80_000, expected: 81_000 },
  { name: 'request at commit time becomes a short future retry', requested: 80_000, wall: 80_000, afterRead: 80_000, expected: 81_000 },
  { name: 'valid future request is unchanged', requested: 180_000, wall: 80_000, afterRead: 80_000, expected: 180_000 },
  { name: 'clock is refreshed after the deduplication read', requested: 90_000, wall: 80_000, afterRead: 100_000, expected: 101_000 },
  { name: 'logical time still bounds a backwards host clock', requested: -10_000, wall: -20_000, afterRead: -20_000, expected: 1000 },
]) {
  test('Agency scheduling: ' + scenario.name, async t => {
    let wall = now.getTime() + scenario.wall
    t.mock.method(Date, 'now', () => wall)
    const { host, intents, wakes, logs } = schedulingHost([], () => { wall = now.getTime() + scenario.afterRead })
    await host.appendProactiveCheck(story, candidate, new Date(now.getTime() + scenario.requested), 'minimum-interval', now)
    const expected = new Date(now.getTime() + scenario.expected)
    assert.equal(intents.length, 1)
    assert.equal(intents[0].notBefore, expected.toISOString())
    assert.equal(intents[0].at, now, 'Keep narrative timestamps separate from the scheduling clock')
    assert.deepEqual(wakes, [expected])
    assert.equal(logs.at(-1)![6], formatLogTime(expected, story.setting.timezone))
  })
}

for (const scenario of [
  { name: 'expired during model latency', requested: 30_000, wall: 80_000, afterRead: 80_000, expiry: 70_000 },
  { name: 'expired during deduplication read', requested: 90_000, wall: 80_000, afterRead: 110_000, expiry: 100_000 },
  { name: 'retry would exceed expiry', requested: 30_000, wall: 80_000, afterRead: 80_000, expiry: 80_500 },
  { name: 'retry at expiry is not scheduled', requested: 30_000, wall: 80_000, afterRead: 80_000, expiry: 81_000 },
  { name: 'original request at expiry is not scheduled', requested: 100_000, wall: 80_000, afterRead: 80_000, expiry: 100_000 },
]) {
  test('Agency scheduling skips candidate: ' + scenario.name, async t => {
    let wall = now.getTime() + scenario.wall
    t.mock.method(Date, 'now', () => wall)
    const { host, intents, wakes } = schedulingHost([], () => { wall = now.getTime() + scenario.afterRead })
    await host.appendProactiveCheck(story, { ...candidate, expiresAt: new Date(now.getTime() + scenario.expiry).toISOString() },
      new Date(now.getTime() + scenario.requested), 'minimum-interval', now)
    assert.equal(intents.length, 0)
    assert.equal(wakes.length, 0)
  })
}

test('Agency scheduling retains fingerprint deduplication', async t => {
  t.mock.method(Date, 'now', () => now.getTime() + 80_000)
  const { host, intents, wakes } = schedulingHost([{ payload: { fingerprint: proactiveCandidateFingerprint(candidate as any) } }])
  await host.appendProactiveCheck(story, candidate, new Date(now.getTime() + 180_000), 'minimum-interval', now)
  assert.equal(intents.length, 0)
  assert.equal(wakes.length, 0)
})
