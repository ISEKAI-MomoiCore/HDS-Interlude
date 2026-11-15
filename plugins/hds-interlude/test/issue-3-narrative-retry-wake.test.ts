import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { InterludeService } from '../src/service'

/**
 * issue #3 回归：秒级意图必须有到期唤醒，不能只等 sweepIntervalMinutes 的
 * 周期网格（默认 5 分钟）。
 *
 * 覆盖四个面：
 *  1. scheduleNarrativeRetry / appendBrowserIntent 创建即注册唤醒；
 *  2. 早退路径（disposed / 无参与者 / 超上限）不注册唤醒；
 *  3. cancelPendingOutgoingMessages 的 story 级 cancelWake 之后，幸存的
 *     narrative-retry 意图经 scheduleNextPendingWake 重新获得唤醒（旧实现
 *     只补排 split 类，重试唤醒被新消息路径误杀后掉回网格）；
 *  4. wakeDueIntents 空转（keep-earliest 让位后无事可做）自我删除前，为最早
 *     的未到期白名单意图补排——且白名单排除 active-consequence /
 *     follow-up-commitment，notBefore 只看严格未来。
 */

const proto = InterludeService.prototype as any

function runtimeHost(extra: Record<string, any> = {}) {
  return Object.assign(Object.create(proto), {
    queues: new Map(), serialWatchdog: new Map(), serialScope: new AsyncLocalStorage(), runtimeGeneration: 0,
    storyTaskGenerations: new Map(), databaseResetting: false, desktopRuntimePhase: 'running',
    report: () => {}, reportOperation: () => {}, reportStandalone: () => {}, reportStandaloneOperation: () => {},
    interruptedTypingParticipants: new Set<string>(),
    deadImageSources: new Map(), disposed: false,
  }, extra)
}

interface WakeCall { storyId: string, notBefore: Date }

function wakeSpy() {
  const wakes: WakeCall[] = []
  const cancelled: string[] = []
  return {
    wakes, cancelled,
    scheduler: {
      scheduleWake: (storyId: string, notBefore: Date) => { wakes.push({ storyId, notBefore }); return Math.max(0, notBefore.getTime() - Date.now()) },
      cancelWake: (storyId: string) => { cancelled.push(storyId) },
      cancelWakes: (storyId?: string) => { if (storyId) cancelled.push(storyId) },
    },
  }
}

// ── 1. 创建即注册唤醒 ───────────────────────────────────────────────────────

test('issue-3: scheduleNarrativeRetry 注册 notBefore=now+15s 的到期唤醒', async () => {
  const spy = wakeSpy()
  const appended: any[] = []
  const host = runtimeHost({
    config: { runtime: { narrativeRetryDelaySeconds: 15, narrativeRetryMaxAttempts: 6 } },
    dbGet: async () => [], dbSet: async () => {},
    appendIntent: async (_storyId: string, intent: any) => { appended.push(intent) },
    scheduler: spy.scheduler,
  })
  const scheduled = await host.scheduleNarrativeRetry('s', 'p', new Date(1_000_000))
  assert.equal(scheduled, true)
  assert.equal(appended.length, 1)
  assert.equal(appended[0].type, 'narrative-retry')
  assert.equal(spy.wakes.length, 1, '必须为秒级重试注册到期唤醒')
  assert.equal(spy.wakes[0].storyId, 's')
  assert.equal(spy.wakes[0].notBefore.getTime(), 1_000_000 + 15_000)
})

test('issue-3: narrativeRetryDelaySeconds 低于 5 秒被钳制到 5 秒（含唤醒目标）', async () => {
  const spy = wakeSpy()
  const host = runtimeHost({
    config: { runtime: { narrativeRetryDelaySeconds: 3, narrativeRetryMaxAttempts: 6 } },
    dbGet: async () => [], dbSet: async () => {},
    appendIntent: async () => {},
    scheduler: spy.scheduler,
  })
  await host.scheduleNarrativeRetry('s', 'p', new Date(0))
  assert.equal(spy.wakes[0].notBefore.getTime(), 5_000)
})

test('issue-3: appendBrowserIntent 注册 notBefore=now+1s 的到期唤醒（同类漏网）', async () => {
  const spy = wakeSpy()
  const appended: any[] = []
  const host = runtimeHost({
    getParticipant: async () => undefined,
    appendIntent: async (_storyId: string, intent: any) => { appended.push(intent) },
    scheduler: spy.scheduler,
  })
  // browserConfig 是原型 getter，须以自有属性覆盖
  Object.defineProperty(host, 'browserConfig', { value: { enabled: true, allowVisit: true, allowSearch: false }, configurable: true })
  await host.appendBrowserIntent('s', { mode: 'visit', url: 'https://example.com/page', purpose: '看看那页', timing: 'deferred' }, new Date(10_000))
  assert.equal(appended.length, 1)
  assert.equal(appended[0].type, 'browser-research')
  assert.equal(spy.wakes.length, 1, '浏览意图 notBefore 只有 1 秒，必须注册唤醒')
  assert.equal(spy.wakes[0].notBefore.getTime(), 11_000)
})

// ── 2. 早退路径不注册唤醒 ───────────────────────────────────────────────────

for (const caseName of ['disposed', '无参与者', '超过尝试上限'] as const) {
  test(`issue-3: 早退路径（${caseName}）不注册唤醒`, async () => {
    const spy = wakeSpy()
    const host = runtimeHost({
      disposed: caseName === 'disposed',
      config: { runtime: { narrativeRetryDelaySeconds: 15, narrativeRetryMaxAttempts: 6 } },
      dbGet: async () => [], dbSet: async () => {},
      appendIntent: async () => {},
      scheduler: spy.scheduler,
    })
    const scheduled = await host.scheduleNarrativeRetry('s', caseName === '无参与者' ? '' : 'p', new Date(0), caseName === '超过尝试上限' ? 6 : 0)
    assert.equal(scheduled, false)
    assert.equal(spy.wakes.length, 0, '早退路径不得注册唤醒')
  })
}

// ── 3. 新消息取代计划外发后，幸存的重试意图重新获得唤醒 ───────────────────

test('issue-3: cancelPendingOutgoingMessages 后 scheduleNextPendingWake 为幸存 narrative-retry 补排', async () => {
  // 基线用真实时钟：补排查询以 new Date() 为“严格未来”基准，固定历史日期
  // 会被正确过滤（下方另有专测该语义）。
  const now = new Date()
  const retryNotBefore = new Date(now.getTime() + 15_000)
  const rows: any[] = [
    { id: 1, storyId: 's', participantId: 'p', type: 'delayed-reply', status: 'pending', payload: {}, notBefore: new Date(now.getTime() + 60_000) },
    // narrative-retry 不在取代范围内，必须幸存并重新获得唤醒
    { id: 2, storyId: 's', participantId: 'p', type: 'narrative-retry', status: 'pending', payload: { attempt: 1 }, notBefore: retryNotBefore },
  ]
  const spy = wakeSpy()
  const cancelledIds: any[] = []
  const wakeQueries: any[] = []
  const host = runtimeHost({
    config: { runtime: { maxMessageCharacters: 4000 } },
    dbGet: async (_table: string, query: any) => {
      if (query?.type?.$in) {
        wakeQueries.push(query)
        // 忠实执行白名单 + 严格未来过滤（模拟数据库语义）
        const filterAfter = query.notBefore.$gt.getTime()
        return rows.filter(row => query.type.$in.includes(row.type) && row.status === 'pending' && row.notBefore.getTime() > filterAfter)
      }
      return rows.filter(row => row.storyId === query.storyId && row.participantId === query.participantId && row.status === query.status)
    },
    dbSet: async (_table: string, query: any, patch: any) => {
      cancelledIds.push(query.id.$in)
      // 忠实应用取消（补排查询按 status 过滤，mock 必须与数据库语义一致）
      for (const id of query.id.$in as number[]) rows.find(row => row.id === id)!.status = patch.status
    },
    updateScriptDeliveryOutcome: async () => {},
    appendEntry: async () => {},
    scheduler: spy.scheduler,
  })
  const matched = await host.cancelPendingOutgoingMessages('s', 'p', now)
  assert.equal(matched.length, 1, '只有 delayed-reply 被取代')
  assert.deepEqual(cancelledIds[0], [1])
  // story 级唤醒被取消后，必须按白名单补排——幸存的重试拿到新计时器
  assert.deepEqual(spy.cancelled, ['s'])
  assert.equal(spy.wakes.length, 1, '幸存的 narrative-retry 必须重新获得唤醒')
  assert.equal(spy.wakes[0].notBefore.getTime(), retryNotBefore.getTime())
})

// ── 4. wakeDueIntents 空转后的补排与白名单契约 ─────────────────────────────

test('issue-3: wakeDueIntents 空转后为最早的未到期白名单意图补排（keep-earliest 链闭环）', async () => {
  const now = Date.now()
  const retryNotBefore = new Date(now + 15_000)
  const spy = wakeSpy()
  let swept = false
  const wakeQueries: any[] = []
  const host = runtimeHost({
    dueIntents: async () => [],
    sweepRunning: false,
    hasPendingNarrative: () => false,
    sweep: async () => { swept = true },
    dbGet: async (_table: string, query: any) => {
      wakeQueries.push(query)
      return [{ id: 9, storyId: 's', participantId: 'p', type: 'narrative-retry', status: 'pending', payload: {}, notBefore: retryNotBefore }]
    },
    scheduler: spy.scheduler,
  })
  const result = await host.wakeDueIntents('s')
  assert.equal(result, undefined, '非 busy 空转正常返回')
  assert.equal(swept, true)
  assert.equal(spy.wakes.length, 1, '空转删除计时器前必须为最早未到期意图补排')
  assert.equal(spy.wakes[0].notBefore.getTime(), retryNotBefore.getTime())
  // 查询契约：白名单 + 严格未来
  const query = wakeQueries[0]
  assert.deepEqual([...query.type.$in].sort(), ['browser-research', 'cross-conversation-message', 'delayed-reply', 'narrative-retry', 'proactive-check', 'split-message'])
  assert.equal(query.type.$in.includes('active-consequence'), false, 'active-consequence 常驻且可在过去，进入补排会死循环')
  assert.equal(query.type.$in.includes('follow-up-commitment'), false, '模型规划意图按契约走 sweep 网格')
  assert.ok(query.notBefore.$gt instanceof Date, '补排只看严格未来的 notBefore')
})

test('issue-3: 补排查询过滤过去时间——已到期行不再成为补排目标', async () => {
  const spy = wakeSpy()
  const host = runtimeHost({
    dbGet: async (_table: string, query: any) => {
      assert.ok(query.notBefore.$gt.getTime() > Date.now() - 5_000, '过滤基准必须是当前时刻')
      return []
    },
    scheduler: spy.scheduler,
  })
  await host.scheduleNextPendingWake('s')
  assert.equal(spy.wakes.length, 0, '没有可补排的未到期意图时不注册计时器')
})
