import assert from 'node:assert/strict'
import test from 'node:test'
import { weatherSweep } from '../src/weather-runner'
import { drainDueSeededEvents, worldSeederSweep } from '../src/world-seeder-runner'
import { DEFAULT_WEATHER_CONFIG } from '../src/weather'

const noop = () => {}
function deferred<T = void>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(r => { resolve = r }), resolve: (value: T) => resolve(value) } }
let latitude = 1
function fixture() {
  const rows: any[] = [], entries: any[] = []
  let id = 0
  const story: any = { id: 's', status: 'active', setting: { location: 'A', world: '现实' } }
  const svc: any = {
    weatherConfig: { ...DEFAULT_WEATHER_CONFIG, enabled: true, autoFromLocation: false, latitude: latitude++ },
    worldSeederRuntime: { enabled: false }, worldSeeder: { available: false },
    generation: 0, pause: 0, desktopRuntimePhase: 'running', databaseResetting: false,
    deliveryGeneration: () => String(svc.generation), taskGeneration: () => `${svc.generation}:${svc.pause}`,
    ctx: { http: { get: async () => ({ current: { temperature_2m: 22, weather_code: 0 } }) } },
    getCanonicalStory: async () => story, getStory: async () => story, canHandleStory: () => true,
    serial: async (_: string, run: () => unknown) => run(),
    dbGet: async (_: string, query: any) => rows.filter(r => r.storyId === query.storyId && (!query.status || r.status === query.status || query.status.$in?.includes(r.status)) && (!query.$or || r.status === 'scheduled' || (r.status === 'injecting' && r.updatedAt <= query.$or[1].updatedAt.$lte))),
    dbCreate: async (_: string, data: any) => { const row = { ...data, id: ++id, updatedAt: new Date() }; rows.push(row); return row },
    dbSet: async (_: string, query: any, patch: any) => { for (const row of rows) if (row.id === query.id) Object.assign(row, patch) },
    appendEntry: async (storyId: string, entry: any) => { const row = { ...entry, storyId, id: entries.length + 1 }; entries.push(row); return row },
    reportOperation: noop, report: noop,
  }
  return { svc, story, rows, entries }
}

for (const enabled of [false, true]) test(`F06 weather reaches script when seeder enabled=${enabled}, model unavailable`, async () => {
  const f = fixture(); f.svc.worldSeederRuntime.enabled = enabled
  await weatherSweep(f.svc)
  assert.equal(f.rows.length, 1)
  await drainDueSeededEvents(f.svc, f.story, new Date(), false)
  assert.equal(f.entries.length, 0, 'user-message phase preserves low-importance filter')
  await drainDueSeededEvents(f.svc, f.story, new Date(), true)
  assert.equal(f.entries.length, 1)
  assert.equal(f.rows[0].status, 'injected')
})

test('F06 disabled event sources stay out of script while the enabled source drains', async () => {
  const f = fixture()
  await weatherSweep(f.svc)
  f.rows.push({ ...f.rows[0], id: 100, summary: 'model event', sourcePayload: {}, importance: 'high' })
  await drainDueSeededEvents(f.svc, f.story, new Date(), true)
  assert.deepEqual(f.entries.map(e => e.content), ['[世界事件] 环境：22°C 晴。'])
  f.svc.weatherConfig.enabled = false; f.svc.worldSeederRuntime.enabled = true
  f.rows[0].status = 'scheduled'
  await drainDueSeededEvents(f.svc, f.story, new Date(), true)
  assert.equal(f.entries.length, 2)
  assert.equal(f.entries[1].content, '[世界事件] model event')
  assert.equal(f.rows[0].status, 'scheduled')
})

for (const stage of ['http', 'serial']) for (const action of ['reset', 'pause-resume']) {
  test(`F07 retires weather after ${action} during ${stage}`, async () => {
    const f = fixture(), started = deferred(), release = deferred()
    if (stage === 'http') f.svc.ctx.http.get = async () => { started.resolve(); await release.promise; return { current: { temperature_2m: 22, weather_code: 0 } } }
    else f.svc.serial = async (_: string, run: () => unknown) => { started.resolve(); await release.promise; return run() }
    const running = weatherSweep(f.svc)
    await started.promise
    if (action === 'reset') f.svc.generation++
    else { f.svc.desktopRuntimePhase = 'paused'; f.svc.pause++; f.svc.desktopRuntimePhase = 'running' }
    release.resolve(); await running
    assert.equal(f.rows.length, 0)
  })
}

test('F07 deduplication follows effective event, story and location rather than process text', async () => {
  const f = fixture()
  await weatherSweep(f.svc); await weatherSweep(f.svc)
  assert.equal(f.rows.length, 1, 'same active event deduplicates')
  f.rows[0].status = 'injected'; f.rows[0].injectedEntryId = 1
  await weatherSweep(f.svc)
  assert.equal(f.rows.length, 1, 'injected event remains effective until expiry')
  f.rows[0].expiresAt = new Date(0)
  await weatherSweep(f.svc)
  assert.equal(f.rows.length, 2, 'expired equal weather refreshes')
  f.rows.length = 0; f.svc.generation++
  await weatherSweep(f.svc)
  assert.equal(f.rows.length, 1, 'reset restores equal weather')
  f.story.id = 'other'
  await weatherSweep(f.svc)
  assert.equal(f.rows.length, 2, 'same weather in another story has own event')
  f.story.setting.location = 'B'
  await weatherSweep(f.svc)
  assert.equal(f.rows.length, 3, 'location change refreshes equal weather')
})

test('F07 location/config changes during HTTP retire old-location weather', async () => {
  const f = fixture(), started = deferred(), release = deferred()
  f.svc.ctx.http.get = async () => { started.resolve(); await release.promise; return { current: { temperature_2m: 22, weather_code: 0 } } }
  const running = weatherSweep(f.svc); await started.promise
  f.story.setting.location = 'new location'
  release.resolve(); await running
  assert.equal(f.rows.length, 0)
})

test('F06 fantasy skip applies to queued host weather with seeder enabled', async () => {
  const f = fixture(); await weatherSweep(f.svc)
  f.story.setting.world = '架空世界'; f.svc.weatherConfig.skipFantasyWorld = true; f.svc.worldSeederRuntime.enabled = true
  await drainDueSeededEvents(f.svc, f.story, new Date(), true)
  assert.equal(f.entries.length, 0)
})

test('F06 host-weather rows stay outside the model seeder budget', async t => {
  const calls: string[] = [], rows: any[] = [], now = new Date()
  const row = (status: string, weather: boolean) => ({ storyId: 's', status, summary: '环境：22°C 晴。', importance: 'low',
    occursAt: now, updatedAt: now, expiresAt: now, subjects: [], sourcePayload: weather ? { weather: true } : {} })
  const svc: any = {
    desktopRuntimePhase: 'running', worldSeederSweepRunning: false, weatherConfig: { enabled: false },
    worldSeederRuntime: { enabled: true, maxPending: 6, dailyCap: 8, cadenceMinutes: 45, maxHorizonHours: 48 },
    worldSeeder: { available: true, generate: async () => { calls.push('generate'); return '' } },
    taskGeneration: () => '0:0', taskGenerationCurrent: () => true,
    getCanonicalStory: async () => ({ id: 's', status: 'active', setting: {} }), canHandleStory: () => true,
    dbGet: async (_table: string, q: any) => rows.filter(r => r.storyId === q.storyId && r.status === q.status
      && (!q.updatedAt || new Date(r.updatedAt) >= new Date(q.updatedAt.$gte))
      && (!q.occursAt || new Date(r.occursAt) >= new Date(q.occursAt.$gte))),
    buildWorldSeederPayload: async () => { calls.push('payload'); return {} },
    reportOperation: noop,
  }
  t.mock.method(Math, 'random', () => 0.5)
  // 天气行同时填满排期与日预算：预算按来源隔离，播种不应被挤占。
  for (let n = 0; n < 8; n++) rows.push(row('injected', true))
  for (let n = 0; n < 6; n++) rows.push(row('scheduled', true))
  await worldSeederSweep(svc)
  assert.ok(calls.includes('payload'), 'weather-filled budget must not block the model seeder')
  // 播种器自身来源的行仍受预算约束。
  rows.length = 0; calls.length = 0
  for (let n = 0; n < 8; n++) rows.push(row('injected', false))
  await worldSeederSweep(svc)
  assert.ok(!calls.includes('payload'), 'seeder-sourced budget is still enforced')
})
