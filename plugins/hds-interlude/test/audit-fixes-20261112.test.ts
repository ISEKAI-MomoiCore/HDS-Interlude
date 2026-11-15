import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from 'koishi'
import { SQLiteDriver } from '@minatojs/driver-sqlite'
import { registerTables } from '../src/database'

/** 2026-11-12 全量审计修正回归：P1 数据库列 / F8 TTL 顺序 / F3 frozen=0 /
 * 幻影配额 / 模型自检重试正则恢复。 */

test('审计 P1：interlude_fact.sourceChannel 列在真实 SQLite 上可写可读', async () => {
  const app = new Context()
  app.plugin(SQLiteDriver, { path: ':memory:' })
  let done!: () => void, fail!: (error: unknown) => void
  const finished = new Promise<void>((resolve, reject) => { done = resolve; fail = reject })
  app.inject(['database'], async ctx => {
    try {
      registerTables(ctx)
      const now = new Date()
      await ctx.database.create('interlude_fact', {
        storyId: 's', participantId: '', scope: 'world', content: '橙儿最近睡眠不好',
        importance: 0.6, confidence: 0.6, unresolved: false, status: 'active',
        sourceEntryIds: [1], sourceChannel: 'group', lastSeenAt: now, createdAt: now, updatedAt: now,
      } as never)
      const [row] = await ctx.database.get('interlude_fact', { storyId: 's' })
      assert.equal(row.sourceChannel, 'group', 'sourceChannel 列已声明（修复前 minato 严格格式化直接抛错，压缩落库无限失败）')
      done()
    } catch (error) { fail(error) }
  })
  try { await app.start(); await finished } finally { await app.stop() }
})

test('审计 F8：超有效期的生效词本轮被重新提名 → 保留并刷新（不降级候选）', async () => {
  const { advanceAttentionWords } = await import('../src/narrative/attention-words')
  const t0 = new Date('2026-11-10T10:00:00Z')
  const state = advanceAttentionWords(undefined, { draft: [{ term: '考试' }], batchId: 'b1', now: t0 })!
  const later = new Date(t0.getTime() + 40 * 86_400_000) // 超 30 天稳定档有效期
  const refreshed = advanceAttentionWords(state, { draft: [{ term: '考试' }], batchId: 'b2', now: later })!
  assert.equal(refreshed.effective.length, 1, '在场提名即确认——不得因 TTL 误删')
  assert.equal(refreshed.effective[0].lastConfirmedAt, later.toISOString(), '确认时刻刷新（TTL 重置）')
})

test('审计 F3：frozenMaxEntryId=0 时跳过水位推进（行为与注释一致，不推进到此刻最新）', async () => {
  const { InterludeService } = await import('../src/service')
  const { decodeStoryState } = await import('../src/story-state')
  let stored: any = { schemaVersion: 5 }
  const writes: any[] = []
  const host: any = Object.create(InterludeService.prototype)
  host.serial = async (_id: string, fn: () => unknown) => fn()
  host.dbGet = async () => [{ id: 999, occurredAt: new Date(), content: '在途消息', metadata: { senderName: '甲' } }]
  host.dbSet = async (_t: string, _q: any, patch: any) => { writes.push(patch); stored = patch.state }
  host.getStory = async () => ({ id: 's', status: 'active', state: stored, setting: { timezone: 'Asia/Shanghai' } })
  host.reportOperation = () => {}
  await host.advanceGroupBackgroundWatermarkForTurn('s', '100', new Date(), 0)
  assert.equal(writes.length, 0, '无可解析冻结 id → 保守跳过（修复前会推进到查询时刻最新，误标在途消息）')
})

test('审计 幻影配额（P3.1）：预记机制整体退役 → persistDecision 全程不写 proactiveContactLog，消息照常投递', async () => {
  const { readFileSync } = await import('node:fs')
  const { AsyncLocalStorage } = await import('node:async_hooks')
  const { Config } = await import('../src/index')
  const { InterludeService } = await import('../src/service')
  const { decodeStoryState, encodeStoryState } = await import('../src/story-state')
  const { emptyStorySetting } = await import('../src/types')

  const now = new Date('2026-11-12T12:00:00.000Z')
  const seededLog = [{ participantId: 'alice', at: new Date(now.getTime() - 3_600_000).toISOString(), ref: 'legacy-ref-1' }]
  const story: any = { id: 's', setting: emptyStorySetting(), state: encodeStoryState({ proactiveContactLog: seededLog } as never), cursorAt: now }
  const entries: any[] = []
  const storyWrites: any[] = []
  const participants = [
    { id: 'alice', state: {}, updatedAt: now },
    { id: 'bob', state: {}, updatedAt: now },
  ]
  const host: any = Object.assign(Object.create(InterludeService.prototype), {
    queues: new Map(), serialScope: new AsyncLocalStorage<string>(), serialWatchdog: new Map(),
    config: {
      runtime: { ...Config.dict.runtime({}), allowProactiveMessages: true },
      sharedStory: { maxCrossConversationActions: 8 }, onebot: { groupChats: [] },
      urge: { enabled: false }, agency: { enabled: false },
    },
    participants: async () => participants,
    canHandleParticipant: () => true, shouldRefreshContinuity: () => false,
    activeScene: async () => null, pruneWorkingDetails: (value: any) => value ?? [],
    appendEntry: async (_storyId: string, draft: any) => {
      const entry = { ...draft, id: entries.length + 1, storyId: 's', createdAt: now }
      entries.push(entry); return entry
    },
    applyIntentUpdates: async () => 0, updateAlterSystem: () => undefined, appendMemory: async () => {},
    appendIntent: async () => {}, scheduleDueIntentWake: () => {}, deferUnresolvedDueFollowUps: async () => {},
    longHorizonSweep: async () => {}, pendingProactiveCount: 0,
    dbGet: async (table: string, query: any) => {
      if (table === 'interlude_script_entry') return entries.filter(entry => entry.id === query?.id)
      return []
    },
    dbSet: async (table: string, _query: any, patch: any) => {
      if (table === 'interlude_story') storyWrites.push(patch)
      if (table === 'interlude_script_entry') Object.assign(entries.find(entry => entry.id === _query.id), patch)
    },
    reportOperation: () => {}, reportStandalone: () => {},
    sendOutgoingMessages: () => assert.fail('Persistence must not send directly'),
  })
  const decision = {
    script: '她发出「在吗」',
    crossConversationActions: [{ participantId: 'alice', mode: 'immediate', content: '在吗' }],
  } as never
  const result = await host.persistDecision(story, null, decision, now, now, true, 'advance', [])
  assert.equal(result.messages.length, 1, '即时主动行动照常进入投递管线')
  assert.equal(result.messages[0].participantId, 'alice')
  assert.equal((result.messages[0] as any).proactiveContactRef, undefined, '投递消息不再附着 proactiveContactRef')
  // 故事状态重写时 proactiveContactLog 原样透传：无预记、无追写、无作废。
  assert.ok(storyWrites.length >= 1, 'advance 回合会重写故事状态')
  for (const write of storyWrites) {
    const log = decodeStoryState(write.state as never).proactiveContactLog
    assert.deepEqual(log, seededLog, '全程不得预记或改写每日配额日志')
  }
  // 守卫语义源码钉：预记调用链已从运行链整体移除（P3.1 §10.1）。
  const source = readFileSync('src/service.ts', 'utf8')
  assert.ok(!source.includes('appendProactiveContact('), 'persistDecision 链路不再预记每日配额')
})

test('审计 #20：侧任务非法 JSON 错误保留英文解析细节 → 去 cap 重试正则恢复匹配', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync('src/narrator.ts', 'utf8')
  assert.ok(source.includes('error instanceof Error ? error.message : error'), '原始解析错误附入消息')
})
