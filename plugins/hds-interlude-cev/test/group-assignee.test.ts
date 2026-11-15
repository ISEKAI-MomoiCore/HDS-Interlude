import assert from 'node:assert/strict'
import test from 'node:test'
import { Channel, Context, User } from 'koishi'
import { Session } from '@satorijs/core'
import { getTraceable } from '@cordisjs/core'
import { SQLiteDriver } from '@minatojs/driver-sqlite'
import { Config } from '../src/index'
import { InterludeService } from '../src/service'

const sync = (InterludeService.prototype as any).syncGroupAssignees
function host(ctx: Context | any, groupChats: any[], overrides: any = {}) {
  const logs: any[] = []
  return {
    ctx, logs,
    config: { onebot: { enabled: true, botAccounts: [{ qq: '200', enabled: true }, { qq: '300', enabled: true }], groupChats, ...overrides } },
    reportStandalone: (...args: any[]) => logs.push(args),
    reportStandaloneOperation: (...args: any[]) => logs.push(args),
  }
}
async function sqlite(task: (ctx: Context) => Promise<void>) {
  const app = new Context()
  app.plugin(SQLiteDriver, { path: ':memory:' })
  let resolve!: () => void, reject!: (error: unknown) => void
  const finished = new Promise<void>((a, b) => { resolve = a; reject = b })
  app.inject(['database'], async ctx => {
    try { await task(ctx); resolve() } catch (error) { reject(error) }
  })
  try { await app.start(); await finished } finally { await app.stop() }
}

// Exercise Koishi's actual attach stage, not a duplicated version of its gate.
async function attached(ctx: Context, userId: string, groupId = '100', content = '普通群消息') {
  const session = new Session({ ctx, platform: 'onebot', selfId: '200' } as any, {
    user: { id: userId }, channel: { id: groupId, type: 0 }, guild: { id: groupId }, message: { content },
  })
  session.content = content
  let passed = false
  await (ctx as any).$processor.attach(getTraceable(ctx, session), async () => { passed = true })
  return passed
}

test('Console exposes an opt-in per-group assignee without altering old config defaults', () => {
  const schema = Config.dict.onebot.dict.groupChats.inner!.dict.assignee
  assert.equal(schema.meta.default, '')
  assert.match(schema.meta.description!, /受理人/)
  const config = Config({ onebot: { groupChats: [{ groupId: '100' }] } })
  assert.equal(config.onebot.groupChats![0].assignee, '')
})

test('SQLite: switch old assignee, admit both group members and preserve other channel fields', async () => {
  await sqlite(async ctx => {
    const createdAt = new Date('2026-10-01T00:00:00Z')
    await ctx.database.createChannel('onebot', '100', {
      assignee: '999', guildId: '100', locales: ['zh-CN'], permissions: ['custom'], createdAt,
    })
    assert.equal(await attached(ctx, '400'), false, 'old assignee blocks ordinary messages')
    assert.equal(await attached(ctx, '400', '100', '<at id="200"/>'), true, '@ bypass reproduces the reported issue')
    const before = (await ctx.database.get('channel', { platform: 'onebot', id: '100' }))[0]
    const h = host(ctx, [{ groupId: '100', enabled: true, assignee: '200' }])
    await sync.call(h)
    const after = (await ctx.database.get('channel', { platform: 'onebot', id: '100' }))[0]
    assert.deepEqual(after, { ...before, assignee: '200' })
    assert.equal(await attached(ctx, '400'), true)
    assert.equal(await attached(ctx, '500'), true, 'no private-message allowlist needed')
    assert.equal(h.logs.length, 1)
    await sync.call(h)
    assert.equal(h.logs.length, 1, 'unchanged routing does not rewrite or spam logs')
    h.config.onebot.groupChats[0].assignee = '300'
    await sync.call(h)
    assert.equal((await ctx.database.getChannel('onebot', '100', ['assignee'])).assignee, '300', 'reload applies the new explicit choice')
  })
})

test('SQLite: create only configured OneBot group and preserve ignore/user gates', async () => {
  await sqlite(async ctx => {
    await ctx.database.createChannel('onebot', '101', { assignee: '999', flag: Channel.Flag.ignore })
    await ctx.database.createChannel('other', '100', { assignee: '777' })
    const h = host(ctx, [{ groupId: 'group:100', assignee: 'qq:200' }, { groupId: '101', assignee: '200' }])
    await sync.call(h)
    const created = await ctx.database.getChannel('onebot', '100', ['assignee', 'guildId', 'createdAt'])
    assert.equal(created.assignee, '200')
    assert.equal(created.guildId, '100')
    assert.ok(created.createdAt instanceof Date)
    assert.equal((await ctx.database.getChannel('other', '100', ['assignee'])).assignee, '777')
    assert.equal(await attached(ctx, '400', '101'), false, 'assignment does not unignore a channel')
    await ctx.database.createUser('onebot', '500', { flag: User.Flag.ignore })
    assert.equal(await attached(ctx, '500'), false, 'assignment does not bypass ignored users')
  })
})

test('disabled and unauthorized settings never write; blank assignee clears stale pinning', async () => {
  let reads = 0, writes = 0
  const cleared: string[] = []
  const ctx = { database: {
    get: async () => { reads++; return [] },
    upsert: async () => { writes++ },
    getChannel: async (_platform: string, id: string) => { reads++; return id === '101' ? { assignee: '999' } : undefined },
    setChannel: async (_platform: string, id: string, data: any) => { writes++; if (data.assignee === null) cleared.push(id) },
  } }
  const h = host(ctx, [
    { groupId: '100' }, { groupId: '101', assignee: ' ' }, { groupId: '102', assignee: '200', enabled: false },
    { groupId: '103', assignee: '999' }, { groupId: '104', assignee: '600' },
    { groupId: 'not-a-group', assignee: '200' }, { groupId: '105', assignee: '*' },
  ], { botAccounts: [{ qq: '200' }, { qq: '600', enabled: false }] })
  await sync.call(h)
  // 无效/禁用/未授权不 upsert;但 101 旧值存在时清空回写 null
  assert.deepEqual(cleared, ['101'], 'blank assignee clears stale channel pinning')
  assert.equal(h.logs.length, 5, '4 条原有警告 + 1 条清除日志')
  await sync.call(host(ctx, [{ groupId: '100', assignee: '200' }], { enabled: false }))
})

test('duplicate groups follow first enabled rule, and one database failure does not block later groups', async () => {
  const applied: string[] = []
  const ctx = { database: {
    get: async (_table: string, query: any) => { if (query.id === '100') throw new Error('read failed'); return [] },
    upsert: async (_table: string, rows: any[]) => { applied.push(rows[0].id + ':' + rows[0].assignee) },
  } }
  const h = host(ctx, [
    { groupId: '100', assignee: '200' }, { groupId: '101', assignee: '200' }, { groupId: 'group:101', assignee: '300' },
    { groupId: '102', assignee: '' }, { groupId: '102', assignee: '200' },
    { groupId: '103', assignee: '300', enabled: false }, { groupId: '103', assignee: '200' },
  ])
  await sync.call(h)
  assert.deepEqual(applied, ['101:200', '103:200'])
  assert.match(h.logs[0][1], /同步失败/)
})
