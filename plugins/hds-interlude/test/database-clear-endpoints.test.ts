import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Context } from 'koishi'
import { SQLiteDriver } from '@minatojs/driver-sqlite'
import { registerTables } from '../src/database'
import { InterludeService } from '../src/service'
import { freshEndpointState } from '../src/endpoints'
import { emptyStorySetting, emptyStoryState } from '../src/types'

const proto = InterludeService.prototype as any
const now = new Date('2026-10-17T00:00:00Z')

async function sqlite(task: (ctx: Context) => Promise<void>) {
  const app = new Context()
  app.plugin(SQLiteDriver, { path: ':memory:' })
  let resolve!: () => void, reject!: (error: unknown) => void
  const finished = new Promise<void>((a, b) => { resolve = a; reject = b })
  app.inject(['database'], async ctx => {
    try { registerTables(ctx); await task(ctx); resolve() } catch (error) { reject(error) }
  })
  try { await app.start(); await finished } finally { await app.stop() }
}

/** clearDatabase 只依赖 DB 原型方法与少量可空/可桩的成员——绑定这些即可
 * 在不启动完整服务的情况下验证端点注册表清理与内存重置。 */
function clearHost(ctx: Context) {
  const host: any = Object.create(proto)
  host.ctx = ctx
  host.databaseResetting = false
  host.transactionScope = new AsyncLocalStorage()
  host.transactionRunning = false
  host.databaseWriteQueue = Promise.resolve()
  host.runtimeGeneration = 0
  host.storyTaskGenerations = new Map()
  host.turnEngine = undefined
  host.invalidateStoryTasks = () => {}
  host.invalidateBufferedNarratives = () => {}
  host.invalidateHistoryVectors = () => {}
  host.reportStandalone = () => {}
  host.reportStandaloneOperation = () => {}
  host.reportOperation = () => {}
  host.activeLongArcGuidanceCache = new Map()
  host.longHorizonLastScore = new Map()
  host.longHorizonGuidanceLoaded = new Map()
  host.longHorizonGenerationCooldownUntil = new Map()
  host.endpointRows = []
  host.endpointStates = new Map()
  host.storyAliasRows = []
  host.storyAliasProblems = new Set()
  host.endpointRegistryReady = false
  host.endpointRegistryInFlight = undefined
  for (const name of ['dbGet', 'dbRemove', 'dbSet']) host[name] = proto[name].bind(host)
  host.initialStorySetting = () => emptyStorySetting()
  return host
}

test('clearDatabase removes endpoint registry and alias tables and resets in-memory snapshots', async () => {
  await sqlite(async ctx => {
    const host = clearHost(ctx)
    const story = { id: 'character:onebot:732295780', platform: 'onebot', selfId: '732295780', userId: '', channelId: '',
      status: 'active', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now }
    await ctx.database.create('interlude_story', story)
    await ctx.database.create('interlude_endpoint', { id: 'ep-1', ownerKind: 'story-role', ownerId: story.id,
      accountKey: 'onebot:732295780', platform: 'onebot', selfId: '732295780', enabled: true, createdAt: now, updatedAt: now } as any)
    await ctx.database.create('interlude_endpoint_state', { endpointId: 'ep-1', state: freshEndpointState('ep-1'), updatedAt: now } as any)
    await ctx.database.create('interlude_story_alias', { aliasStoryId: 'character:onebot:732295780', canonicalStoryId: story.id,
      reason: 'story-created', createdAt: now } as any)
    // 模拟清理前的运行时内存快照：注册表已就绪并持有行、告警去重集非空。
    host.endpointRows = [{ id: 'ep-1', ownerKind: 'story-role', enabled: true }]
    host.storyAliasRows = [{ aliasStoryId: 'character:onebot:732295780', canonicalStoryId: story.id, reason: 'story-created', createdAt: now }]
    host.storyAliasProblems.add('unknown-account:onebot:732295780')
    host.endpointRegistryReady = true

    const result = await host.clearDatabase()
    assert.ok(result.removed >= 4, `应清理至少 4 行,实际 ${result.removed}`)

    // 三张端点/别名表与故事表全部清空。
    assert.equal((await ctx.database.get('interlude_story', {})).length, 0)
    assert.equal((await ctx.database.get('interlude_endpoint', {})).length, 0)
    assert.equal((await ctx.database.get('interlude_endpoint_state', {})).length, 0)
    assert.equal((await ctx.database.get('interlude_story_alias', {})).length, 0)

    // 内存快照同步重置：下一条消息会走 ensureEndpointRegistry 空表重建，
    // findStory 的空注册表护栏不再把自家账号误报为陌生账号。
    assert.equal(host.endpointRows.length, 0)
    assert.equal(host.storyAliasRows.length, 0)
    assert.equal(host.storyAliasProblems.size, 0)
    assert.equal(host.endpointStates.size, 0)
    assert.equal(host.endpointRegistryReady, false)
  })
})
