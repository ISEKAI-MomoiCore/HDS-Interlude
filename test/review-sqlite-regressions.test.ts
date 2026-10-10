import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Context } from 'koishi'
import { SQLiteDriver } from '@minatojs/driver-sqlite'
import { registerTables } from '../src/database'
import { InterludeService } from '../src/service'
import { emptyStorySetting, emptyStoryState } from '../src/types'
const proto = InterludeService.prototype as any
const now = new Date('2026-10-11T00:00:00Z')

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
function localHost(ctx: Context) {
  const host: any = {
    ctx, transactionScope: new AsyncLocalStorage(), transactionRunning: false, databaseWriteQueue: Promise.resolve(),
    runtimeGeneration: 0, storyTaskGenerations: new Map(),
    memoryConfig: { arcSummaryCharacters: 1000, sceneSummaryCharacters: 1000, sceneHookCharacters: 100,
      factContentCharacters: 1000, maxFactsPerStory: 100, autoApplyStatePatches: false, statePatchMinTurns: 3,
      statePatchMinDays: 2, statePatchConfidenceThreshold: .8, majorStatePatchConfidenceThreshold: .95 },
    reportOperation: () => {}, reportStandalone: () => {}, reportStandaloneOperation: () => {},
    scheduleFactEmbeddingBackfill: () => {}, invalidateHistoryVectors: () => {},
    activeArc: async (storyId: string) => (await host.dbGet('interlude_arc', { storyId, status: 'active' }))[0],
    activeScene: async (storyId: string) => (await host.dbGet('interlude_scene', { storyId, status: 'active' }))[0],
    ensureContinuity: async (story: any, frontier: Date) => {
      if (!await host.activeScene(story.id)) await host.dbCreate('interlude_scene', { storyId: story.id, status: 'active',
        startedAt: frontier, lastEntryId: null, entryCount: 0, summary: '', hook: '', createdAt: now, updatedAt: now })
    },
  }
  for (const name of ['dbRead', 'dbWrite', 'retryDbWrite', 'dbGet', 'dbSet', 'dbCreate', 'dbRemove', 'findPossiblyCommittedCreate',
    'deliveryGeneration', 'taskGeneration', 'taskGenerationCurrent', 'persistCompaction', 'persistCompactionOutputs', 'persistFact', 'persistStatePatch',
    'resolveCompactionFacts', 'getStory', 'markContinuityDirty', 'successfulDeliveryEntry', 'groupMessages', 'groupCooldownActive']) host[name] = proto[name]
  return host
}
async function seed(ctx: Context) {
  const story: any = { id: 's', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
    setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now }
  await ctx.database.create('interlude_story', story)
  await ctx.database.create('interlude_arc', { storyId: 's', status: 'active', title: '旧弧', summary: '旧摘要', sceneCount: 1, createdAt: now, updatedAt: now })
  const scene = await ctx.database.create('interlude_scene', { storyId: 's', status: 'active', startedAt: now,
    lastEntryId: null, entryCount: 0, hook: '', summary: '', createdAt: now, updatedAt: now })
  const row = await ctx.database.create('interlude_script_entry', { storyId: 's', participantId: '', kind: 'script', actor: 'narrator',
    content: '小林说他明天要出门，主角认真听完。', metadata: {}, occurredAt: now, createdAt: now })
  const decision: any = { arc: { summary: '新的弧摘要' }, scene: { summary: '新的场景摘要', close: true,
    boundary: { reason: '谈话结束', sourceEntryIds: [row.id] } },
    episodeTags: [{ sourceEntryId: row.id, people: ['小林'] }],
    facts: [{ scope: 'relationship', content: '小林说他明天要出门。', sourceEntryIds: [row.id], importance: .7, confidence: .8 }],
    statePatches: [{ target: 'character', path: 'traits', proposedValue: '主角会更认真听别人说话。', sourceEntryIds: [row.id], confidence: .7, evidence: '原始对话' }] }
  return { story, scene, row, decision }
}

for (const stage of ['tags', 'arc', 'fact', 'proposal', 'checkpoint', 'close', 'new-scene']) {
  test(`C05 real SQLite rolls back ${stage} failure and retries all outputs once`, async () => sqlite(async ctx => {
    const f = await seed(ctx), host = localHost(ctx)
    const create = host.dbCreate.bind(host), set = host.dbSet.bind(host)
    let failed = false
    const crash = (match: boolean) => { if (match && !failed) { failed = true; throw new Error(`injected-${stage}`) } }
    host.dbCreate = async (table: string, value: any) => {
      const result = await create(table, value)
      crash(stage === 'fact' && table === 'interlude_fact' || stage === 'proposal' && table === 'interlude_state_patch'
        || stage === 'new-scene' && table === 'interlude_scene')
      return result
    }
    host.dbSet = async (table: string, query: any, patch: any) => {
      const result = await set(table, query, patch)
      crash(stage === 'tags' && !!patch.metadata?.episodeTags || stage === 'arc' && table === 'interlude_arc'
        || stage === 'checkpoint' && table === 'interlude_scene' && 'entryCount' in patch
        || stage === 'close' && patch.status === 'closed')
      return result
    }
    const vectors = new Map([[f.decision.facts[0].content.trim().toLocaleLowerCase(), [1, 0]]])
    const persist = () => host.persistCompaction(f.story, f.scene, f.decision, [f.row], now, new Set(), [], vectors)
    await assert.rejects(persist(), new RegExp(`injected-${stage}`))
    assert.equal((await ctx.database.get('interlude_arc', {}))[0].summary, '旧摘要')
    assert.equal((await ctx.database.get('interlude_fact', {})).length, 0)
    assert.equal((await ctx.database.get('interlude_state_patch', {})).length, 0)
    const scenes = await ctx.database.get('interlude_scene', {})
    assert.equal(scenes.length, 1)
    assert.equal(scenes[0].lastEntryId, null)
    assert.equal(scenes[0].entryCount, 0)
    assert.equal(scenes[0].status, 'active')
    assert.deepEqual((await ctx.database.get('interlude_script_entry', {}))[0].metadata, {})
    await persist()
    const facts = await ctx.database.get('interlude_fact', {})
    assert.equal(facts.length, 1)
    assert.equal(facts[0].participantId, '')
    assert.deepEqual(facts[0].embedding, [1, 0], 'new fact has its vector immediately, not only later backfill')
    assert.equal((await ctx.database.get('interlude_state_patch', {})).length, 1)
    const finished = (await ctx.database.get('interlude_scene', { id: f.scene.id }))[0]
    assert.equal(finished.entryCount, 1)
    assert.equal(finished.lastEntryId, f.row.id)
    assert.equal(finished.status, 'closed')
    const active = (await ctx.database.get('interlude_scene', { status: 'active' }))[0]
    assert.equal(active.lastEntryId, f.row.id)
    await assert.rejects(persist(), /checkpoint changed/, 'stale snapshot cannot accumulate evidence twice')
  }))
}

test('C05 external service reads wait for rollback rather than expose uncommitted arc', async () => sqlite(async ctx => {
  const f = await seed(ctx), host = localHost(ctx), set = host.dbSet.bind(host)
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  let entered!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  host.dbSet = async (table: string, query: any, patch: any) => {
    const value = await set(table, query, patch)
    if (table === 'interlude_arc') { entered(); await hold; throw new Error('rollback after observer') }
    return value
  }
  const write = host.persistCompaction(f.story, f.scene, f.decision, [f.row], now, new Set(), [], new Map())
  const rejection = assert.rejects(write, /rollback after observer/)
  await waiting
  let readFinished = false
  const reader = host.dbGet('interlude_arc', {}).then((rows: any[]) => { readFinished = true; return rows })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(readFinished, false)
  release()
  await rejection
  assert.equal((await reader)[0].summary, '旧摘要')
}))

test('C02/C04 successful receipt JSON keys and original group segment indexes work on real SQLite', async () => sqlite(async ctx => {
  const host = localHost(ctx)
  await ctx.database.create('interlude_script_entry', { storyId: 's', participantId: '', kind: 'character-group-message', actor: 'character',
    content: 'bubble-2', metadata: { scriptEntryId: 42, commitId: 'c', eventId: 'e', bubbleIndex: 2, deliverySegmentIndexes: [2] }, occurredAt: now, createdAt: now })
  const message: any = { participantId: 'group:123', content: 'bubble-2', scriptEvent: { scriptEntryId: 42, commitId: 'c', eventId: 'e', bubbleIndex: 2 } }
  assert.ok(await host.successfulDeliveryEntry('s', message))
  assert.equal(await host.successfulDeliveryEntry('s', { ...message, scriptEvent: { ...message.scriptEvent, bubbleIndex: 0 } }), undefined)
  assert.equal(await host.successfulDeliveryEntry('other-story', message), undefined)
}))

test('R02 group context and cooldown SQL filter before limit, preserving numeric/prefixed metadata', async () => sqlite(async ctx => {
  const host = localHost(ctx), recent = new Date()
  await ctx.database.create('interlude_script_entry', { storyId: 's', participantId: '', kind: 'character-group-message', actor: 'character',
    content: '目标群回复', metadata: { groupId: 'group:123' }, occurredAt: recent, createdAt: recent })
  await ctx.database.create('interlude_script_entry', { storyId: 's', participantId: '', kind: 'group-message', actor: 'user',
    content: '数字群号原文', metadata: { groupId: 123 }, occurredAt: recent, createdAt: recent })
  for (let i = 0; i < 120; i++) await ctx.database.create('interlude_script_entry', { storyId: 's', participantId: 'other', kind: 'user-message', actor: 'user',
    content: `无关私聊-${i}`, metadata: {}, occurredAt: new Date(recent.getTime() + i + 1), createdAt: recent })
  const snapshot = await host.groupMessages('s', '123', 2)
  assert.deepEqual(new Set(snapshot.messages.map((item: any) => item.content)), new Set(['目标群回复', '数字群号原文']))
  assert.equal(await host.groupCooldownActive('s', 'guild:123', 60), true)
  assert.equal(await host.groupCooldownActive('s', 'other-non-numeric', 60), false)
}))

test('C07 durable replay SQL distinguishes current bot accounts while retaining unscoped legacy evidence', async () => sqlite(async ctx => {
  for (const selfId of [undefined, 'bot-a', 'bot-b']) {
    await ctx.database.create('interlude_script_entry', { storyId: 's', participantId: 'canonical-alice', kind: 'user-message', actor: 'user',
      content: selfId ?? 'legacy', occurredAt: now, metadata: { platform: 'onebot', messageId: 'm1', ...(selfId ? { selfId } : {}) } })
  }
  const query = (selfId: string): any => ({ storyId: 's', participantId: 'canonical-alice', kind: 'user-message',
    'metadata.platform': 'onebot', 'metadata.messageId': 'm1',
    $or: [{ 'metadata.selfId': selfId }, { 'metadata.selfId': { $exists: false } }] })
  assert.deepEqual((await ctx.database.get('interlude_script_entry', query('bot-a'))).map(row => row.content).sort(), ['bot-a', 'legacy'])
  assert.deepEqual((await ctx.database.get('interlude_script_entry', query('bot-b'))).map(row => row.content).sort(), ['bot-b', 'legacy'])
  assert.deepEqual((await ctx.database.get('interlude_script_entry', query('bot-c'))).map(row => row.content), ['legacy'])
}))
