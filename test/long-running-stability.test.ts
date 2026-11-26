import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { DEFAULT_QZONE_CONFIG } from '../src/qzone'

const story = { id: 's', status: 'active', platform: 'onebot', selfId: '42', setting: { world: '', location: '' } }
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function hostFor(input: Record<string, unknown> = {}) {
  let generation = 0
  const host: any = Object.assign(Object.create(InterludeService.prototype), {
    config: { browser: { enabled: true, navigationTimeout: 1_000, maxConcurrentPages: 1 } },
    serialScope: new AsyncLocalStorage<string>(), queues: new Map(), serialWatchdog: new Map(),
    browserActive: 0, browserWaiters: [],
    getStory: async () => story, getCanonicalStory: async () => story, canHandleStory: () => true,
    taskGeneration: () => String(generation), deliveryGeneration: () => String(generation),
    taskGenerationCurrent: (_id: string, captured: string) => captured === String(generation),
    report: () => {}, reportStandalone: () => {}, reportOperation: () => {},
    hasPendingNarrative: () => false, scheduleCompaction: () => {},
    ...input,
  })
  return { host, reset: () => { generation++ } }
}

test('native deferred Qzone timeout leaves the story queue free and does not retry a possibly sent post', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const entered = deferred(), remote = deferred<object>()
  const intent = { id: 1, type: 'qzone-action', status: 'pending', payload: { action: 'post', content: 'test' } }
  const audit: Array<Record<string, unknown>> = [], entries: unknown[] = []
  let sends = 0, advances = 0
  const { host } = hostFor({
    qzoneRuntime: { ...DEFAULT_QZONE_CONFIG, enabled: true },
    endpointRows: [{ id: 'role', ownerId: 's', ownerKind: 'story-role', enabled: true, accountKey: 'onebot:42', platform: 'onebot', selfId: '42' }],
    ensureEndpointRegistry: async () => {},
    ctx: { bots: [{ platform: 'onebot', selfId: '42', internal: { _request: () => {
      sends++; entered.resolve(); return remote.promise
    } } }] },
    dbGet: async (table: string, query: any) => table === 'interlude_intent' && intent.status === 'pending'
      && (query.id === intent.id || query.type === 'qzone-action') ? [intent] : table === 'interlude_qzone_post' ? audit : [],
    dbSet: async (table: string, _query: any, patch: object) => Object.assign(table === 'interlude_intent' ? intent : audit[0], patch),
    dbCreate: async (_table: string, draft: object) => { const row = { ...draft, id: 1 }; audit.push(row); return row },
    appendEntry: async (...args: unknown[]) => { entries.push(args) },
    advanceUnlocked: async () => { advances++; return [] },
  })
  let finished = false
  const sweep = host.advanceStory(story, false).then(() => { finished = true })
  await entered.promise
  assert.equal(intent.status, 'completed')
  assert.equal(await host.serial(story.id, async () => 'incoming can run'), 'incoming can run')
  assert.equal(finished, false)
  const duplicate = await host.runDeferredAdvanceWork(story.id, new Date(), host.taskGeneration(story.id))
  assert.equal(duplicate, false)
  t.mock.timers.tick(30_000)
  await sweep
  assert.equal(advances, 1)
  assert.equal(audit[0].status, 'unknown')
  assert.deepEqual(entries, [])
  remote.resolve({ status: 'ok', data: { tid: 'late' } })
  await tick()
  await host.advanceStory(story, true)
  assert.equal(sends, 1)
  assert.equal(audit[0].status, 'unknown')
  assert.deepEqual(entries, [])
})

test('deferred web read runs outside the story queue; a reset rejects the old result', async () => {
  const entered = deferred(), remote = deferred<object>()
  const intent = { id: 1, type: 'browser-research', status: 'pending', payload: {} }
  let reads = 0, commits = 0, advances = 0
  const { host, reset } = hostFor({
    dbGet: async (_table: string, query: any) => query.type === 'browser-research' || query.id === intent.id ? [intent] : [],
    dbSet: async () => { commits++ },
    collectWebObservation: async () => { reads++; entered.resolve(); return remote.promise },
    persistCollectedWebObservation: async () => { commits++ },
    advanceUnlocked: async () => { advances++; return [] },
  })
  const sweep = host.advanceStory(story, false)
  await entered.promise
  await host.serial(story.id, async () => { reset() })
  remote.resolve({ id: 0, status: 'success' })
  await sweep
  assert.equal(reads, 1)
  assert.equal(commits, 0)
  assert.equal(advances, 0)
})

test('browser deadline removes a queued waiter and disposes a page that arrives after timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const queuedStart = deferred(), release = deferred(), pageCalled = deferred(), page = deferred<object>()
  let closed = 0, created = 0
  const { host } = hostFor({ ctx: { puppeteer: { page: () => { created++; pageCalled.resolve(); return page.promise } } } })
  const occupant = host.withBrowserSlot(async () => { queuedStart.resolve(); await release.promise })
  await queuedStart.promise
  const queued = assert.rejects(host.withBrowserPage(10, async () => assert.fail('expired waiter acquired a slot')), /browser deadline/)
  assert.equal(host.browserWaiters.length, 1)
  t.mock.timers.tick(10)
  await queued
  assert.equal(host.browserWaiters.length, 0)
  assert.equal(created, 0)
  release.resolve()
  await occupant
  const opening = assert.rejects(host.withBrowserPage(10, async () => assert.fail('late page reached caller')), /browser deadline/)
  await pageCalled.promise
  t.mock.timers.tick(10)
  await opening
  assert.equal(host.browserActive, 0)
  page.resolve({ close: async () => { closed++ } })
  await tick()
  assert.equal(closed, 1)
})

test('a hung Chromium close releases the caller but cannot pile up more pages', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const closing = deferred()
  const release = deferred()
  const { host } = hostFor({ ctx: { puppeteer: { page: async () => ({ close: () => { closing.resolve(); return release.promise } }) } } })
  const reading = host.withBrowserPage(10, async () => 'already read')
  await closing.promise
  t.mock.timers.tick(10)
  assert.equal(await reading, 'already read')
  assert.equal(host.browserActive, 0)
  await assert.rejects(host.withBrowserPage(10, async () => assert.fail('opened a second page')), /awaiting Chromium cleanup/)
  release.resolve()
  await tick()
  assert.equal(await host.withBrowserPage(10, async () => 'recovered'), 'recovered')
})

test('weather ticks coalesce even while the first sample is waiting to commit', async () => {
  const release = deferred(), waiting = deferred()
  let fetches = 0, queued = 0, creates = 0
  const { host } = hostFor({
    weatherConfig: { enabled: true, autoFromLocation: false, latitude: 1, longitude: 89, cadenceMinutes: 30 },
    ctx: { http: { get: async () => { fetches++; return { current: { temperature_2m: 20, weather_code: 0 } } } } },
    dbGet: async () => [], dbCreate: async () => { creates++ },
  })
  const occupied = host.serial(story.id, async () => release.promise)
  const serial = host.serial.bind(host)
  host.serial = (id: string, task: () => Promise<unknown>) => {
    queued++; waiting.resolve(); return serial(id, task)
  }
  const first = host.weatherSweep()
  await waiting.promise
  await Promise.all(Array.from({ length: 10 }, () => host.weatherSweep()))
  assert.equal(fetches, 1)
  assert.equal(queued, 1)
  assert.equal(creates, 0)
  release.resolve()
  await Promise.all([first, occupied])
  assert.equal(creates, 1)
  await host.weatherSweep()
  assert.equal(queued, 2)
})
