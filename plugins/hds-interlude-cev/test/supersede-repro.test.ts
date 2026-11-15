/* 复现 10-12 16:59 异常:标记作废的请求结果仍被投递 + 回合重建 revision 归零。
 * 用真实 createTurnEngine,flush 侧按 flushBufferedNarrative 的真实结构
 * (beginFlush→inFlight→splice→model await→serial gate→endFlush)搭骨架。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createTurnEngine, shouldSupersedeRequest } from '../src/turn-engine'
import type { InterludeStory, InterludeParticipant } from '../src/types'

const story = { id: 's1' } as unknown as InterludeStory
const participant = { id: 'p1' } as unknown as InterludeParticipant
const session = {} as any

function makeEngine() {
  const timers: Array<{ fn: () => void, fired: boolean }> = []
  const setTimeoutFn = (fn: () => void, _ms: number) => { const t = { fn, fired: false }; timers.push(t); return () => { t.fired = true } }
  const flushAllTimers = () => { for (const t of [...timers]) if (!t.fired) { t.fired = true; t.fn() } }
  const engine = createTurnEngine({
    setTimeout: setTimeoutFn,
    userMessageDebounceSeconds: 2,
    reportOperation: () => {},
  })
  const flushes: Array<{ revision: number, batch: string[] }> = []
  const inFlight: Array<{ revision: number, resolve: (obsolete: boolean) => void }> = []
  const flush = (key: string, revision: number) => {
    const turn = engine.beginFlush(key, revision, (rk, rv) => flush(rk, rv))
    if (!turn) return
    const rid = revision
    turn.inFlightRequestId = rid
    const batch = turn.messages.splice(0).map(m => m.content)
    flushes.push({ revision: rid, batch })
    new Promise<void>(resolve => {
      inFlight.push({ revision: rid, resolve: () => resolve() })
    }).then(() => {
      // 模拟模型返回后的 serial 闸:与真实代码同一判定
      const obsolete = turn.obsoleteRequestIds.has(rid)
      if (!obsolete) turn.firstMessageCommittedRequestId = rid
      engine.endFlush(key, rid)
    })
  }
  const trigger = () => { flushAllTimers() }
  const settleModel = (revision: number) => {
    const idx = inFlight.findIndex(r => r.revision === revision && !('settled' in r))
    const req = inFlight.find(r => r.revision === revision)
    assert.ok(req, `no in-flight request ${revision}`)
    inFlight.splice(inFlight.indexOf(req), 1)
    req.resolve()
  }
  return { engine, flush, trigger, settleModel, flushes }
}

const buffer = (e: ReturnType<typeof makeEngine>, content: string) => {
  e.engine.bufferUserNarrative(story, participant, session, new Date(), [], content, [], [], undefined, (key, rev) => e.flush(key, rev))
}

test('基线:模型在飞时第二句到达 → 旧结果应作废且批回队', async () => {
  const e = makeEngine()
  buffer(e, 'msg1')
  e.trigger()                       // 防抖到期 → flush(rev1) 开始,inFlight=1
  buffer(e, 'msg2')                 // 模型在飞时到达 → 标记 1 作废
  const turn = e.engine.getTurn(participant.id)!
  assert.ok(turn.obsoleteRequestIds.has(1), '请求 1 应被标记作废')
  assert.deepEqual(turn.messages.map(m => m.content), ['msg2'])
  e.settleModel(1)                  // 模型返回 → serial 闸判定 obsolete(真实 flush 负责 requeue)
  await new Promise(resolve => setImmediate(resolve))   // 等 endFlush 微任务链跑完
  const turnAfter = e.engine.getTurn(participant.id)
  assert.ok(!turnAfter || turnAfter.obsoleteRequestIds.size === 0, 'endFlush 后作废标记应清理')
  assert.ok(!turnAfter || turnAfter.inFlightRequestId === undefined, 'endFlush 后在飞标记应清空')
})

test('复现目标:narrating 忙导致重试期间的标记是否会被误清', () => {
  const e = makeEngine()
  buffer(e, 'msg1')
  e.trigger()                       // flush(1) inFlight=1(模型未返回,narrating 占用)
  buffer(e, 'msg2')                 // 标记 1 作废;msg2 → rev2,timer
  e.trigger()                       // rev2 timer → beginFlush(2):narrating 忙 → 250ms 重试
  const turn = e.engine.getTurn(participant.id)!
  assert.ok(turn.obsoleteRequestIds.has(1))
  assert.deepEqual(turn.messages.map(m => m.content), ['msg2'], 'narrating 忙时不得取批,msg2 应仍在队')
  // 关键:此刻再触发任意 timer(重试),观察 beginFlush(2) 是否误清 1 的作废标记
  e.trigger()
  const turn2 = e.engine.getTurn(participant.id)!
  assert.ok(turn2.obsoleteRequestIds.has(1), '重试不得清除在飞请求的作废标记')
})

test('shouldSupersedeRequest 语义基线', () => {
  assert.equal(shouldSupersedeRequest(1, undefined, new Set()), true)
  assert.equal(shouldSupersedeRequest(1, 1, new Set()), false, '已提交首条后不再接管')
  assert.equal(shouldSupersedeRequest(undefined, undefined, new Set()), false)
  assert.equal(shouldSupersedeRequest(1, undefined, new Set([1])), false, '已标记过不重复标记')
})
