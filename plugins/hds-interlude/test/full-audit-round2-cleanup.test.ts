import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Context } from 'koishi'
import { SQLiteDriver } from '@minatojs/driver-sqlite'
import { registerTables } from '../src/database'
import { InterludeService } from '../src/service'
import { emptyStorySetting } from '../src/types'
import { weatherSweep } from '../src/weather-runner'
import { drainDueSeededEvents } from '../src/world-seeder-runner'
import { DEFAULT_WEATHER_CONFIG } from '../src/weather'
import { SharedWorks, workKey } from '../src/works'

const proto = InterludeService.prototype as any
const noop = () => {}
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve: (value: T) => resolve(value) } }
async function sqlite(task: (ctx: Context, host: any) => Promise<void>) {
  const app = new Context()
  app.plugin(SQLiteDriver, { path: ':memory:' })
  let resolve!: () => void, reject!: (error: unknown) => void
  const done = new Promise<void>((a, b) => { resolve = a; reject = b })
  app.inject(['database'], async ctx => {
    try {
      registerTables(ctx)
      const host = Object.assign(Object.create(proto), {
        ctx, databaseResetting: false, transactionScope: new AsyncLocalStorage(), transactionRunning: false,
        databaseWriteQueue: Promise.resolve(), runtimeGeneration: 0, storyTaskGenerations: new Map(),
        invalidateStoryTasks: noop, invalidateBufferedNarratives: noop, invalidateHistoryVectors: noop,
        reportStandalone: noop, reportStandaloneOperation: noop, reportOperation: noop,
        activeLongArcGuidanceCache: new Map(), longHorizonLastScore: new Map(), longHorizonGuidanceLoaded: new Map(),
        longHorizonGenerationCooldownUntil: new Map(), endpointRows: [], endpointStates: new Map(), storyAliasRows: [],
        storyAliasProblems: new Set(), endpointRegistryReady: false, endpointRegistryInFlight: undefined,
        initialStorySetting: emptyStorySetting, serial: async (_: string, run: () => unknown) => run(),
        resetParticipantCanon: noop, ensureContinuity: noop,
        getStory: async (id: string) => (await ctx.database.get('interlude_story', { id }))[0],
      })
      await task(ctx, host); resolve()
    } catch (error) { reject(error) }
  })
  try { await app.start(); await done } finally { await app.stop() }
}
function worksStore(ctx: Context) {
  return {
    get: async (id: string) => (await ctx.database.get('interlude_work', { id }))[0],
    create: async (row: any) => { await ctx.database.create('interlude_work', row) },
    replace: async (row: any, generation: number) => (await ctx.database.set('interlude_work', { id: row.id, generation }, { state: row.state, generation: row.generation })).matched === 1,
    remove: async (query: { storyId: string, participantId: string }) => { await ctx.database.remove('interlude_work', query) },
  }
}
async function seed(ctx: Context) {
  const tables = Object.keys(ctx.model.tables).filter(t => t.startsWith('interlude_'))
  for (const table of tables) {
    if (table === 'interlude_work') continue
    const model = ctx.model.tables[table]
    const fields = model.fields
    const row: any = {}
    const primary = String(model.primary)
    row[primary] = ['interlude_story', 'interlude_participant', 'interlude_endpoint'].includes(table) ? 'row' : primary === 'storyId' ? 's' : primary === 'id' ? 1 : 'row'
    if (fields.storyId) row.storyId = 's'
    for (const field of ['content', 'summary', 'hook', 'title', 'premise', 'direction', 'proposedValue', 'evidence']) {
      if (fields[field]) row[field] = 'OLD-secret'
    }
    if (table === 'interlude_story') { row.setting = emptyStorySetting(); row.status = 'active' }
    if (table === 'interlude_sticker') { row.assetId = 'global-asset'; row.status = 'active' }
    await ctx.database.create(table as any, row)
  }
  const works = new SharedWorks(worksStore(ctx))
  await works.create('s', 'p', 'OLD-secret', 'OLD-secret')
  return { tables, works }
}

test('F04 real SQLite global clear removes all runtime tables and retains global sticker assets', async () => {
  await sqlite(async (ctx, host) => {
    const { tables } = await seed(ctx)
    const result = await host.clearDatabase()
    assert.equal(result.removed, tables.length - 1)
    assert.equal(result.logicallyCleared, 0)
    for (const table of tables) assert.equal((await ctx.database.get(table as any, {})).length, table === 'interlude_sticker' ? 1 : 0, table)
    assert.equal(host.databaseResetting, false)
  })
})

test('F05 real SQLite forced DELETE failures use each model primary and legal redaction payload', async () => {
  await sqlite(async (ctx, host) => {
    const { tables, works } = await seed(ctx)
    host.dbRemove = async () => { throw new Error('forced DELETE failure') }
    const result = await host.clearDatabase()
    assert.equal(result.logicallyCleared, tables.length - 1)
    for (const table of tables.filter(t => t !== 'interlude_sticker')) {
      const rows = await ctx.database.get(table as any, {})
      assert.equal(rows.length, 1, table)
      assert.ok(!JSON.stringify(rows).includes('OLD-secret'), table + ' exposes old content')
    }
    assert.equal((await works.read('s', 'p'))!.state.jobs?.length ?? 0, 0)
    assert.equal((await ctx.database.get('interlude_story', {}))[0].status, 'archived')
    assert.equal((await ctx.database.get('interlude_long_arc_progress', {}))[0].storyId, 's')
    assert.equal(host.databaseResetting, false)
  })
})

test('F05 a failing logical-clear row is skipped and the global clear still completes', async () => {
  await sqlite(async (ctx, host) => {
    const { tables } = await seed(ctx)
    host.dbRemove = async () => { throw new Error('forced DELETE failure') }
    const originalSet = host.dbSet.bind(host)
    let blocked = 0
    host.dbSet = async (table: string, key: any, payload: any) => {
      if (table === 'interlude_memory') { blocked++; throw new Error('forced SET failure') }
      return originalSet(table, key, payload)
    }
    const result = await host.clearDatabase()
    assert.equal(blocked, 1)
    assert.equal(result.logicallyCleared, tables.length - 2)
    for (const table of tables.filter(t => t !== 'interlude_sticker' && t !== 'interlude_memory')) {
      const rows = await ctx.database.get(table as any, {})
      assert.ok(!JSON.stringify(rows).includes('OLD-secret'), table + ' exposes old content')
    }
    assert.ok(JSON.stringify(await ctx.database.get('interlude_memory', {})).includes('OLD-secret'), 'locked row keeps old content')
    assert.equal(host.databaseResetting, false)
  })
})

test('F05 story purge skips a failing logical-clear table and completes the rest', async () => {
  await sqlite(async (ctx, host) => {
    await ctx.database.create('interlude_story', { id: 's', status: 'active', setting: emptyStorySetting() } as any)
    await ctx.database.create('interlude_memory', { storyId: 's', content: 'secret memory' } as any)
    await ctx.database.create('interlude_qzone_post', { storyId: 's', content: 'secret post', status: 'posted' } as any)
    host.dbRemove = async () => { throw new Error('forced DELETE failure') }
    const originalSet = host.dbSet.bind(host)
    host.dbSet = async (table: string, key: any, payload: any) => {
      if (table === 'interlude_qzone_post') throw new Error('forced SET failure')
      return originalSet(table, key, payload)
    }
    await host.purgeAllStoryData('s')
    const memory = (await ctx.database.get('interlude_memory', { storyId: 's' }))[0]
    assert.ok(!String(memory.content).includes('secret'))
    assert.equal(host.databaseResetting, false)
  })
})

for (const fallback of [false, true]) {
  test(`F04 story purge isolates qzone/works and retires generation jobs (fallback=${fallback})`, async () => {
    await sqlite(async (ctx, host) => {
      const works = new SharedWorks(worksStore(ctx))
      await ctx.database.create('interlude_story', { id: 's', status: 'active', setting: emptyStorySetting() } as any)
      const row = await works.create('s', 'p', 'secret title', 'secret body')
      await works.create('other', 'p', 'keep title', 'keep body')
      await ctx.database.create('interlude_qzone_post', { storyId: 's', content: 'secret post', status: 'posted' } as any)
      await ctx.database.create('interlude_qzone_post', { storyId: 'other', content: 'keep post', status: 'posted' } as any)
      await ctx.database.create('interlude_sticker', { assetId: 'global', status: 'active' } as any)
      const returned = deferred<string>()
      await works.generate('s', 'p', { baseRevisionId: row.state.head, brief: 'secret brief' }, 'op', 1, 'model', () => returned.promise)
      const generated = worksStore(ctx)
      const before = (await generated.get(workKey('s', 'p')))!
      if (fallback) host.dbRemove = async () => { throw new Error('forced DELETE failure') }
      await host.purgeAllStoryData('s')
      const post = (await ctx.database.get('interlude_qzone_post', { storyId: 's' }))[0]
      assert.ok(!post || (!post.content.includes('secret') && post.status !== 'posted'))
      const cleared = await works.read('s', 'p')
      assert.ok(!cleared || (!JSON.stringify(cleared.state).includes('secret') && !cleared.state.jobs?.length))
      if (!fallback) await works.create('s', 'p', 'new title', 'new body')
      returned.resolve('old generated draft')
      // Drain the inference continuation and its real SQLite writes deterministically.
      for (let n = 0; n < 15; n++) await new Promise(resolve => setImmediate(resolve))
      const current = await works.read('s', 'p')
      assert.ok(!JSON.stringify(current).includes('old generated draft'))
      assert.equal((await works.read('other', 'p'))!.state.title, 'keep title')
      assert.equal((await ctx.database.get('interlude_qzone_post', { storyId: 'other' }))[0].content, 'keep post')
      assert.equal((await ctx.database.get('interlude_sticker', {})).length, 1)
      if (fallback) assert.equal(await generated.replace(before, before.generation), false, 'stale CAS cannot restore old work')
    })
  })
}


test('F06/F07 real SQLite weather queries deduplicate active events and drain independently of model seeder', async () => {
  await sqlite(async (ctx, host) => {
    const story = { id: 's', platform: 'onebot', selfId: '10001', status: 'active', setting: { ...emptyStorySetting(), location: 'A' } }
    host.ctx = { database: ctx.database, http: { get: async () => ({ current: { temperature_2m: 22, weather_code: 0 } }) } }
    host.weatherConfig = { ...DEFAULT_WEATHER_CONFIG, enabled: true, autoFromLocation: false, latitude: 50.123 }
    host.worldSeederRuntime = { enabled: false }; host.desktopRuntimePhase = 'running'
    host.getCanonicalStory = async () => story; host.canHandleStory = () => true; host.report = noop
    host.appendEntry = async (storyId: string, entry: any) => ctx.database.create('interlude_script_entry', { ...entry, storyId, occurredAt: new Date(entry.occurredAt) })
    await weatherSweep(host); await weatherSweep(host)
    assert.equal((await ctx.database.get('interlude_seeded_event', {})).length, 1)
    await drainDueSeededEvents(host, story as any, new Date(), true)
    assert.equal((await ctx.database.get('interlude_script_entry', {})).length, 1)
    assert.equal((await ctx.database.get('interlude_seeded_event', {}))[0].status, 'injected')
    await weatherSweep(host)
    assert.equal((await ctx.database.get('interlude_seeded_event', {})).length, 1)
    await ctx.database.remove('interlude_seeded_event', {}); host.runtimeGeneration++
    await weatherSweep(host)
    assert.equal((await ctx.database.get('interlude_seeded_event', {})).length, 1)
  })
})
