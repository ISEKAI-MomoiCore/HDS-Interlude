import assert from 'node:assert/strict'
import test from 'node:test'
import { createScheduler, type SchedulerDeps } from '../src/scheduler'

function fixture(overrides?: Partial<SchedulerDeps>) {
  const timeouts: Array<{ fn: () => void, ms: number, id: number, cancelled: boolean }> = []
  let seq = 0
  let clock = 1_000_000
  const deps: SchedulerDeps = {
    setTimeout: (fn, ms) => {
      const entry = { fn, ms, id: ++seq, cancelled: false }
      timeouts.push(entry)
      return () => { entry.cancelled = true }
    },
    now: () => clock,
    retryDelayMs: 1000,
    deferDelayMs: 500,
    onWakeError: () => {},
    onTaskError: () => {},
    ...overrides,
  }
  return {
    scheduler: createScheduler(deps),
    timeouts,
    tick: (ms: number) => { clock += ms },
    get clock() { return clock },
    pending: () => timeouts.filter(t => !t.cancelled),
  }
}

// ── 到期唤醒 ───────────────────────────────────────────────────────────────

test('scheduleWake keeps the earliest wake and cancels a later existing one', async () => {
  const { scheduler, timeouts } = fixture()
  const fires: number[] = []
  const delay1 = scheduler.scheduleWake('s1', new Date(1_000_000 + 5_000), () => { fires.push(1) })
  assert.equal(delay1, 5_000)
  // 更晚的唤醒不覆盖：返回 undefined，旧定时器保留
  const delay2 = scheduler.scheduleWake('s1', new Date(1_000_000 + 9_000), () => { fires.push(2) })
  assert.equal(delay2, undefined)
  assert.equal(scheduler.pendingWakeCount(), 1)
  assert.equal(timeouts.length, 1)
  // 更早的唤醒覆盖：旧定时器被取消
  const delay3 = scheduler.scheduleWake('s1', new Date(1_000_000 + 2_000), () => { fires.push(3) })
  assert.equal(delay3, 2_000)
  assert.equal(timeouts[0].cancelled, true)
  assert.equal(scheduler.pendingWakeCount(), 1)
  // 触发的是最后排定的定时器
  timeouts[1].fn()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fires, [3])
  assert.equal(scheduler.pendingWakeCount(), 0)
})

test('wake fire returning busy rearms after retryDelayMs and retries', async () => {
  const { scheduler, timeouts, tick } = fixture()
  let calls = 0
  scheduler.scheduleWake('s1', new Date(1_000_000), () => { calls++; return calls < 2 ? 'busy' : undefined })
  assert.equal(timeouts.length, 1)
  timeouts[0].fn()                       // 第一次：busy
  await new Promise(resolve => setImmediate(resolve))  // 等 then 链
  assert.equal(calls, 1)
  assert.equal(timeouts.length, 2)
  assert.equal(timeouts[1].ms, 1000)     // retryDelayMs
  assert.equal(scheduler.pendingWakeCount(), 1)
  tick(1000)
  timeouts[1].fn()                       // 第二次：正常结束
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 2)
  assert.equal(timeouts.length, 2)       // 不再重排
  assert.equal(scheduler.pendingWakeCount(), 0)
})

test('wake fire throwing reports to onWakeError without rearm', async () => {
  const wakeErrors: unknown[] = []
  const { scheduler, timeouts } = fixture({ onWakeError: error => wakeErrors.push(error) })
  scheduler.scheduleWake('s1', new Date(1_000_000), () => { throw new Error('boom') })
  timeouts[0].fn()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(wakeErrors.length, 1)
  assert.match(String(wakeErrors[0]), /boom/)
  assert.equal(timeouts.length, 1)
  assert.equal(scheduler.pendingWakeCount(), 0)
})

test('cancelWake cancels a single story; cancelWakes filters by story', () => {
  const { scheduler, timeouts } = fixture()
  scheduler.scheduleWake('s1', new Date(1_000_000 + 100), () => {})
  scheduler.scheduleWake('s2', new Date(1_000_000 + 200), () => {})
  scheduler.cancelWake('s1')
  assert.equal(timeouts[0].cancelled, true)
  assert.equal(timeouts[1].cancelled, false)
  assert.equal(scheduler.pendingWakeCount(), 1)
  scheduler.cancelWakes('s2')
  assert.equal(timeouts[1].cancelled, true)
  assert.equal(scheduler.pendingWakeCount(), 0)
  // 全量取消
  scheduler.scheduleWake('s3', new Date(1_000_000 + 100), () => {})
  scheduler.cancelWakes()
  assert.equal(scheduler.pendingWakeCount(), 0)
})

// ── 独占任务 ───────────────────────────────────────────────────────────────

test('scheduleExclusive dedupes, defers while busy, and releases after completion', async () => {
  const order: string[] = []
  const { scheduler, timeouts } = fixture()
  let deferFirst = true
  const queued = scheduler.scheduleExclusive('s1', async () => { order.push('task') }, {
    halted: () => false,
    defer: () => {
      if (deferFirst) { deferFirst = false; order.push('defer'); return true }
      return false
    },
    onQueued: () => order.push('queued'),
  })
  assert.equal(queued, true)
  // onQueued 先于首次运行分支；首个 defer 分支已让路（500ms 后重试）
  assert.deepEqual(order, ['queued', 'defer'])
  assert.equal(timeouts.length, 1)
  assert.equal(timeouts[0].ms, 500)
  // defer 期间重复入队被拒
  assert.equal(scheduler.scheduleExclusive('s1', async () => {}, { halted: () => false, defer: () => false }), false)
  assert.equal(scheduler.hasExclusive('s1'), true)
  timeouts[0].fn()   // 第二次运行：不 defer，执行任务
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['queued', 'defer', 'task'])
  assert.equal(scheduler.hasExclusive('s1'), false)   // finally 已释放
  // 释放后可再次入队
  assert.equal(scheduler.scheduleExclusive('s1', async () => {}, { halted: () => false, defer: () => false }), true)
})

test('scheduleExclusive halted releases the gate without running the task', () => {
  const { scheduler } = fixture()
  let ran = false
  const queued = scheduler.scheduleExclusive('s1', async () => { ran = true }, {
    halted: () => true,
    defer: () => false,
    onQueued: () => {},
  })
  assert.equal(queued, true)
  assert.equal(ran, false)
  assert.equal(scheduler.hasExclusive('s1'), false)
})

test('scheduleExclusive task failure reports to onTaskError and still releases', async () => {
  const taskErrors: unknown[] = []
  const { scheduler } = fixture({ onTaskError: error => taskErrors.push(error) })
  scheduler.scheduleExclusive('s1', async () => { throw new Error('task boom') }, {
    halted: () => false,
    defer: () => false,
  })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(taskErrors.length, 1)
  assert.match(String(taskErrors[0]), /task boom/)
  assert.equal(scheduler.hasExclusive('s1'), false)
})

// ── 指纹冷却 ───────────────────────────────────────────────────────────────

test('backoff gates by fingerprint and expires into deletion', () => {
  const { scheduler, tick } = fixture()
  scheduler.noteBackoff('s1', 'fp-a', 1_000_000 + 5_000)
  assert.equal(scheduler.isBackedOff('s1', 'fp-a'), true)
  // 不同指纹不拦截
  assert.equal(scheduler.isBackedOff('s1', 'fp-b'), false)
  // 冷却中不删除条目
  assert.equal(scheduler.isBackedOff('s1', 'fp-a'), true)
  // 过期后：拦截解除且条目被删除
  tick(5_000)
  assert.equal(scheduler.isBackedOff('s1', 'fp-a'), false)
  assert.equal(scheduler.isBackedOff('s1', 'fp-a'), false)
  // clearBackoff 定向 / 全量
  scheduler.noteBackoff('s1', 'fp-a', 1_000_000 + 60_000)
  scheduler.noteBackoff('s2', 'fp-a', 1_000_000 + 60_000)
  scheduler.clearBackoff('s1')
  assert.equal(scheduler.isBackedOff('s1', 'fp-a'), false)
  assert.equal(scheduler.isBackedOff('s2', 'fp-a'), true)
  scheduler.clearBackoff()
  assert.equal(scheduler.isBackedOff('s2', 'fp-a'), false)
})
