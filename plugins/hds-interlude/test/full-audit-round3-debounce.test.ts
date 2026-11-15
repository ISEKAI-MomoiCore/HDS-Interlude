import assert from 'node:assert/strict'
import test from 'node:test'
import { createTurnEngine } from '../src/turn-engine'
import { InterludeService } from '../src/service'
import { executeGroupNarrativeTurn } from '../src/narrative/turn-executor'
const proto = InterludeService.prototype as any
const noop = () => {}
function clock(t: any) {
  let at = 0, seq = 0
  const jobs = new Map<number, { at: number, run: () => void }>()
  t.mock.method(Date, 'now', () => at)
  return {
    now: () => at,
    schedule: (run: () => void, ms: number) => { const id = ++seq; jobs.set(id, { at: at + ms, run }); return () => { jobs.delete(id) } },
    advance: async (target: number) => {
      for (let n = 0; n < 10000; n++) {
        const next = [...jobs].filter(([, j]) => j.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) { at = target; return }
        jobs.delete(next[0]); at = next[1].at; next[1].run()
        await new Promise(resolve => setImmediate(resolve))
      }
      throw new Error('Timer did not settle')
    },
  }
}
function privateFixture(t: any, quiet = 2) {
  const c = clock(t), starts: any[] = []
  let hold = false, engine: ReturnType<typeof createTurnEngine>
  const flush = (key: string, revision: number) => {
    const turn = engine.beginFlush(key, revision, flush)
    if (!turn) return
    turn.inFlightRequestId = revision
    starts.push({ at: c.now(), count: turn.messages.splice(0).length, revision })
    if (!hold) engine.endFlush(key, revision)
  }
  engine = createTurnEngine({ setTimeout: c.schedule, userMessageDebounceSeconds: quiet, scheduleTurnFlush: flush, reportOperation: noop })
  const add = (content = 'hello') => engine.bufferUserNarrative({ id: 's' } as any, { id: 'p' } as any, {} as any, new Date(c.now()), [], content, [], [], undefined, flush)
  return { c, engine, starts, add, hold: (value: boolean) => { hold = value }, flush }
}
function groupFixture(t: any, active = false) {
  const c = clock(t), starts: number[] = []
  const host: any = {
    ctx: { setTimeout: c.schedule }, bufferedGroupTurns: new Map(), desktopRuntimePhase: 'running',
    turnEngine: { narrating: new Set(), turns: new Map(), rescheduleTimers: noop },
    groupSessionActiveCached: () => active, platformPort: { adoptSession: () => ({}) },
    reportStandalone: noop, getStory: async () => { starts.push(c.now()); throw new Error('finish test batch before model') },
    flushGroupTurn: proto.flushGroupTurn, flushGroupTurnUnlocked: (key: string, turn: any) => executeGroupNarrativeTurn(host, key, turn),
    scheduler: { cancelWakes: noop }, desktopRuntimeSnapshot: async () => ({}),
  }
  const add = () => proto.bufferGroupMessage.call(host, { id: 's' }, { groupId: '100', debounceSeconds: 1 }, { channelId: '100' }, { content: 'hello', occurredAt: new Date(c.now()) }, false, false)
  return { c, starts, host, add }
}
for (const active of [false, true]) test(`F11 group continuous input flushes by 3s and starts fresh batches (active=${active})`, async t => {
  const f = groupFixture(t, active)
  f.add()
  for (let at = 200; at <= 6200; at += 200) { await f.c.advance(at); f.add() }
  assert.equal(f.starts[0], 3000)
  assert.equal(f.starts[1], 6000)
})

test('F11 private continuous input flushes by 3s and starts fresh batches', async t => {
  const f = privateFixture(t); f.add()
  for (let at = 200; at <= 6200; at += 200) { await f.c.advance(at); f.add() }
  assert.equal(f.starts[0]?.at, 3000)
  assert.equal(f.starts[1]?.at, 6000)
  assert.equal(f.starts[0].count, 15)
})

test('F11 private large configured quiet window retains its custom duration and a finite deadline', async t => {
  const f = privateFixture(t, 10); f.add()
  for (let at = 200; at <= 10200; at += 200) { await f.c.advance(at); f.add() }
  assert.equal(f.starts[0]?.at, 10000)
})

test('F11 private zero quiet window triggers immediately', async t => {
  const f = privateFixture(t, 0); f.add(); await f.c.advance(0)
  assert.equal(f.starts[0]?.at, 0)
})

test('F11 short private bursts retain the quiet merge window', async t => {
  const f = privateFixture(t); f.add(); await f.c.advance(200); f.add()
  await f.c.advance(2199); assert.equal(f.starts.length, 0)
  await f.c.advance(2200); assert.equal(f.starts[0]?.count, 2)
})

test('F11 private in-flight replacement keeps a bounded next batch and releases after busy owner', async t => {
  const f = privateFixture(t); f.hold(true); f.add(); await f.c.advance(2000)
  assert.equal(f.starts.length, 1)
  for (let at = 2200; at <= 5600; at += 200) { await f.c.advance(at); f.add() }
  const turn = f.engine.getTurn('p')!
  assert.equal(turn.obsoleteRequestIds.has(f.starts[0].revision), true)
  assert.equal(f.starts.length, 1, 'busy owner remains exclusive')
  f.hold(false); f.engine.endFlush('p', f.starts[0].revision)
  await f.c.advance(5850)
  assert.equal(f.starts.length, 2)
  assert.ok(f.starts[1].at <= 5850)
})

test('F11 first committed private reply preserves existing supersession rule', async t => {
  const f = privateFixture(t); f.hold(true); f.add(); await f.c.advance(2000)
  const turn = f.engine.getTurn('p')!; turn.firstMessageCommittedRequestId = turn.inFlightRequestId
  f.add(); assert.equal(turn.obsoleteRequestIds.size, 0)
})

test('F11 group busy retry remains eligible after the deadline', async t => {
  const f = groupFixture(t); f.host.turnEngine.narrating.add('s'); f.add()
  for (let at = 200; at <= 3600; at += 200) { await f.c.advance(at); f.add() }
  assert.equal(f.starts.length, 0)
  f.host.turnEngine.narrating.delete('s'); await f.c.advance(3850)
  assert.ok(f.starts.length >= 1)
})

test('F11 paused group preserves pending deadline through resume and another input', async t => {
  const f = groupFixture(t); f.add(); await f.c.advance(200)
  await proto.setDesktopRuntimePhase.call(f.host, 'paused'); await f.c.advance(6000)
  assert.equal(f.starts.length, 0)
  await proto.setDesktopRuntimePhase.call(f.host, 'running'); f.add(); await f.c.advance(6000)
  assert.equal(f.starts[0], 6000)
})

test('F11 group batch buffered during pause flushes on resume without new input', async t => {
  const f = groupFixture(t)
  await proto.setDesktopRuntimePhase.call(f.host, 'paused')
  f.add()
  await f.c.advance(4000)
  assert.equal(f.starts.length, 0)
  // 暂停中触发的定时器早退后不得留下死句柄，否则恢复循环误判跳过补排。
  await proto.setDesktopRuntimePhase.call(f.host, 'running')
  await f.c.advance(4010)
  assert.equal(f.starts.length, 1)
})

test('F11 private resumed overdue batch remains ready when another input arrives', async t => {
  const f = privateFixture(t); f.add(); f.engine.getTurn('p')!.timer!(); f.engine.getTurn('p')!.timer = undefined
  await f.c.advance(6000); f.engine.rescheduleTimers(f.flush); f.add(); await f.c.advance(6000)
  assert.equal(f.starts[0]?.at, 6000)
})
