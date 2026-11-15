import assert from 'node:assert/strict'
import test from 'node:test'
import { createTurnEngine, shouldSupersedeRequest, type TurnEngineDeps } from '../src/turn-engine'

const noopStory = { id: 's1', setting: { timezone: 'Asia/Shanghai' } } as any
const noopParticipant = { id: 'p1', displayName: 'test' } as any

function fixture(overrides?: Partial<TurnEngineDeps>) {
  const timeouts: Array<{ fn: () => void, ms: number, id: number }> = []
  let seq = 0
  const deps: TurnEngineDeps = {
    setTimeout: (fn, ms) => { const id = ++seq; timeouts.push({ fn, ms, id }); return () => { const i = timeouts.findIndex(t => t.id === id); if (i >= 0) timeouts.splice(i, 1) } },
    userMessageDebounceSeconds: 2,
    reportOperation: () => {},
    ...overrides,
  }
  return { engine: createTurnEngine(deps), timeouts, deps }
}

test('bufferUserNarrative creates turn, sets debounce timer, accumulates messages', () => {
  const { engine, timeouts } = fixture()
  const session = { content: '你好' } as any
  const now = new Date()
  const flushCalls: Array<[string, number]> = []
  engine.bufferUserNarrative(noopStory, noopParticipant, session, now, [], '你好', [], [], undefined, (k, r) => flushCalls.push([k, r]))
  assert.equal(engine.pendingTurnCount(), 1)
  const turn = engine.getTurn('p1')!
  assert.ok(turn)
  assert.equal(turn.messages.length, 1)
  assert.equal(turn.messages[0].content, '你好')
  assert.equal(turn.nextRevision, 1)
  assert.equal(timeouts.length, 1)
  assert.equal(timeouts[0].ms, 2000)  // 2s debounce
  // 触发定时器 → flush 回调收到正确的 key+revision
  timeouts[0].fn()
  assert.deepEqual(flushCalls, [['p1', 1]])
  // 第二条消息：同 turn、revision 递增、旧定时器被取消
  engine.bufferUserNarrative(noopStory, noopParticipant, session, now, [], '在吗', [], [], undefined, () => {})
  assert.equal(engine.getTurn('p1')!.messages.length, 2)
  assert.equal(engine.getTurn('p1')!.nextRevision, 2)
})

test('beginFlush guards against narrating stories and revision mismatch', () => {
  const { engine } = fixture()
  const session = { content: 'x' } as any
  engine.bufferUserNarrative(noopStory, noopParticipant, session, new Date(), [], 'x', [], [], undefined, () => {})
  // 正常 flush：返回 turn
  const turn = engine.beginFlush('p1', 1, () => {})
  assert.ok(turn)
  assert.equal(engine.isNarrating('s1'), true)
  // 模拟 service 的用法：flush 开始后设置 inFlightRequestId
  turn.inFlightRequestId = 1
  // 同故事再次 begin → null（narrating 已标记）
  assert.equal(engine.beginFlush('p1', 1, () => {}), null)
  // revision 不匹配 → null
  assert.equal(engine.beginFlush('p1', 99, () => {}), null)
  // 清掉 narrating 重试可能挂的 timer（模拟 service 收到 null 后不动 turn）
  turn.timer = undefined
  // endFlush 清理（先 splice 消息，模拟 service 的 flush 处理完 batch）
  turn.messages.splice(0)
  engine.endFlush('p1', 1)
  assert.equal(engine.isNarrating('s1'), false)
  assert.equal(engine.pendingTurnCount(), 0)  // 空 turn 被删除
})

test('signalIncomingInterruption marks in-flight request as obsolete', () => {
  const { engine } = fixture()
  const session = { content: 'x' } as any
  engine.bufferUserNarrative(noopStory, noopParticipant, session, new Date(), [], 'x', [], [], undefined, () => {})
  const turn = engine.getTurn('p1')!
  turn.inFlightRequestId = 5
  engine.signalIncomingInterruption(noopStory, noopParticipant)
  assert.ok(turn.obsoleteRequestIds.has(5), 'in-flight request should be marked obsolete')
})

test('invalidateNarratives cancels timers and clears turns for target story', () => {
  const { engine } = fixture()
  const session = { content: 'x' } as any
  engine.bufferUserNarrative(noopStory, noopParticipant, session, new Date(), [], 'x', [], [], undefined, () => {})
  let groupInvalidated = false
  engine.invalidateNarratives('s1', () => { groupInvalidated = true })
  assert.equal(engine.pendingTurnCount(), 0)
  assert.equal(groupInvalidated, true)
})

test('bufferUserNarrative keeps endpoint identity on each message and active batch metadata', () => {
  const { engine } = fixture()
  engine.bufferUserNarrative(noopStory, noopParticipant, { content: 'qq' } as any, new Date(), [], 'qq', [], [], undefined, () => {}, 'ep-qq')
  engine.bufferUserNarrative(noopStory, noopParticipant, { content: 'wechat' } as any, new Date(), [], 'wechat', [], [], undefined, () => {}, 'ep-wx')
  const turn = engine.getTurn('p1')!
  assert.deepEqual(turn.messages.map(message => message.endpointId), ['ep-qq', 'ep-wx'])
  const flushed = engine.beginFlush('p1', 2, () => {})!
  const batch = flushed.messages.splice(0)
  flushed.activeBatchEndpointIds = [...new Set(batch.map(message => message.endpointId).filter(Boolean))] as string[]
  flushed.activeBatchMessageCount = batch.length
  assert.deepEqual(flushed.activeBatchEndpointIds, ['ep-qq', 'ep-wx'])
  assert.equal(flushed.activeBatchMessageCount, 2)
})

test('recordSource keeps the first source after the turn has been created', () => {
  const { engine } = fixture()
  engine.recordSource('p1', 'ep-before-buffer', 1)
  assert.deepEqual(engine.getTurn('p1'), undefined, 'recording before buffering is intentionally a no-op')
  engine.bufferUserNarrative(noopStory, noopParticipant, { content: '你好' } as any, new Date(), [], '你好', [], [], undefined, () => {})
  engine.recordSource('p1', 'ep-first', 2)
  engine.recordSource('p1', 'ep-second', 3)
  engine.recordSource('p1', 'ep-first', 4)
  assert.deepEqual(engine.getTurn('p1')!.sources, [
    { endpointId: 'ep-first', receivedSeq: 2 },
    { endpointId: 'ep-second', receivedSeq: 3 },
  ])
})

test('invalidateNarratives keeps an in-flight owner until endFlush releases narrating', () => {
  const { engine } = fixture()
  const session = { content: 'x' } as any
  engine.bufferUserNarrative(noopStory, noopParticipant, session, new Date(), [], 'x', [], [], undefined, () => {})
  const turn = engine.beginFlush('p1', 1, () => {})!
  turn.inFlightRequestId = 1
  engine.invalidateNarratives('s1')
  assert.equal(engine.isNarrating('s1'), true)
  assert.equal(engine.pendingTurnCount(), 1)
  assert.equal(turn.messages.length, 0)
  assert.equal(turn.discardedRequestIds.has(1), true)
  engine.endFlush('p1', 1)
  assert.equal(engine.isNarrating('s1'), false)
  assert.equal(engine.pendingTurnCount(), 0)
})

test('shouldSupersedeRequest pure function covers the three guard conditions', () => {
  // 正常在途：应取代
  assert.equal(shouldSupersedeRequest(5, undefined, new Set()), true)
  // 已 committed：不取代
  assert.equal(shouldSupersedeRequest(5, 5, new Set()), false)
  // 已标 obsolete：不取代
  assert.equal(shouldSupersedeRequest(5, undefined, new Set([5])), false)
  // 无在途请求：不取代
  assert.equal(shouldSupersedeRequest(undefined, undefined, new Set()), false)
})
