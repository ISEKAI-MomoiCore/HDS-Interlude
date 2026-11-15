import { deliveryHost } from './helpers/delivery-host'
import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'

/** P0 特征测试：投递区仅靠注释约束的隐式契约，搬迁（P2）前后必须逐位成立。 */
const methods = InterludeService.prototype as any

function baseHost(overrides: Record<string, unknown> = {}) {
  const host: Record<string, any> = {
    config: { runtime: { maxMessageCharacters: 500 } },
    report: () => {}, reportStandalone: () => {}, reportOperation: () => {},
    dbGet: async () => [], dbSet: async () => {},
    appendEntry: async () => { throw new Error('unexpected appendEntry') },
    serial: async (_id: string, run: () => Promise<any>) => run(),
    ...overrides,
  }
  return deliveryHost(host)
}

test('deliveryExecutionKey: 无账本引用时无键；键格式含 story/entry/commit/event，分段变体追加 bubbleIndex', () => {
  const host = baseHost()
  const ref = { commitId: 'c1', eventId: 'e1', scriptEntryId: 7 }
  assert.equal(methods.deliveryExecutionKey.call(host, 's1', { participantId: 'p', content: 'x' }), undefined)
  assert.equal(methods.deliveryExecutionKey.call(host, 's1', { participantId: 'p', content: 'x' }), undefined)
  assert.deepEqual(JSON.parse(methods.deliveryExecutionKey.call(host, 's1', { participantId: 'p', content: 'x', scriptEvent: ref })), ['s1', 7, 'c1', 'e1'])
  assert.deepEqual(JSON.parse(methods.deliveryExecutionKey.call(host, 's1', { participantId: 'p', content: 'x', scriptEvent: { ...ref, bubbleIndex: 2 } }, true)), ['s1', 7, 'c1', 'e1', 2])
  // 分段键 bubbleIndex 缺省为 0，与显式 0 不可区分（幂等去重依赖这一点）。
  assert.equal(
    methods.deliveryExecutionKey.call(host, 's1', { participantId: 'p', content: 'x', scriptEvent: ref }, true),
    methods.deliveryExecutionKey.call(host, 's1', { participantId: 'p', content: 'x', scriptEvent: { ...ref, bubbleIndex: 0 } }, true),
  )
})

test('successfulDeliveryEntry: 私聊按 bubbleIndex 相等匹配，群聊按 deliverySegmentIndexes 包含匹配，其余 kind 不算回执', async () => {
  const host = baseHost({
    dbGet: async (_table: string, query: any) => {
      assert.equal(query.storyId, 's1')
      assert.deepEqual(query.kind.$in, ['character-message', 'character-group-message'])
      return [
        { id: 1, kind: 'character-message', metadata: { scriptEntryId: 7, commitId: 'c1', eventId: 'e1', bubbleIndex: 3 } },
        { id: 2, kind: 'character-group-message', metadata: { scriptEntryId: 7, commitId: 'c1', eventId: 'e1', deliverySegmentIndexes: [0, 2] } },
      ]
    },
  })
  const ref = { commitId: 'c1', eventId: 'e1', scriptEntryId: 7 }
  // 私聊分段 3 → 命中条目 1；分段 0 私聊语义不命中条目 1（bubbleIndex 3 ≠ 0）。
  assert.equal((await methods.successfulDeliveryEntry.call(host, 's1', { participantId: 'p', content: 'x', scriptEvent: { ...ref, bubbleIndex: 3 } }))?.id, 1)
  // 群聊分段 2 命中条目 2 的 deliverySegmentIndexes。
  const groupHit = await methods.successfulDeliveryEntry.call(host, 's1', { participantId: 'group:g', content: 'x', scriptEvent: { ...ref, bubbleIndex: 2 } })
  assert.equal(groupHit?.id, 2)
  const miss = await methods.successfulDeliveryEntry.call(host, 's1', { participantId: 'p', content: 'x', scriptEvent: { ...ref, bubbleIndex: 1 } })
  assert.equal(miss, undefined)
})

test('deliverOutgoingMessages: 账本终态分段不再触达传输——delivered 计入已投递，cancelled 跳过且不计入', async () => {
  const transport: string[] = []
  for (const status of ['delivered', 'cancelled'] as const) {
    const host = baseHost({
      dbGet: async (_table: string, query: any) => {
        if (query.kind) return []
        return [{ id: 7, storyId: 's1', metadata: { commitId: 'c1', deliveryActions: [
          { commitId: 'c1', eventId: 'e1', participantId: 'p1', segments: [{ index: 0, kind: 'message', content: 'hi', status }] },
        ] } }]
      },
      sendOutgoingMessages: async (_story: any, msgs: any[]) => { transport.push(...msgs.map((m: any) => m.content)); return msgs },
    })
    const delivered = await methods.deliverOutgoingMessages.call(host, { id: 's1' }, [
      { participantId: 'p1', content: 'hi', scriptEvent: { commitId: 'c1', eventId: 'e1', scriptEntryId: 7, bubbleIndex: 0 } },
    ])
    assert.equal(transport.length, 0, `${status} 不应触达传输`)
    assert.equal(delivered.length, status === 'delivered' ? 1 : 0, `${status} 计入语义`)
  }
})

test('typingDelayMilliseconds: 250ms 下限、配置上限封顶、抖动始终在比值区间内', () => {
  const host = baseHost({ config: { runtime: { typingBaseDelaySeconds: 0, typingCharactersPerSecond: 100, typingMaxDelaySeconds: 3, typingJitterRatio: 0.5 } } })
  // 空串 + base 0 → 名义 0，仍受 250ms 下限保护。
  assert.equal(methods.typingDelayMilliseconds.call(host, ''), 250)
  // 10_000 字 @100cps → 名义 100s，被 3s 上限封顶；抖动后仍 ≤ 3s。
  for (let i = 0; i < 20; i++) {
    const delay = methods.typingDelayMilliseconds.call(host, 'a'.repeat(10_000))
    assert.ok(delay <= 3000 && delay >= 250, `delay=${delay}`)
  }
  // 抖动区间：无抖动时确定 = min(max, base + ceil(len/cps)) * 1000。
  const fixed = baseHost({ config: { runtime: { typingBaseDelaySeconds: 1, typingCharactersPerSecond: 10, typingMaxDelaySeconds: 12, typingJitterRatio: 0 } } })
  assert.equal(methods.typingDelayMilliseconds.call(fixed, 'a'.repeat(20)), 3000)
})

test('splitOutgoingMessage: 分隔符投影（trim 回退 <sep/>）、换行模式与整体关闭', () => {
  const host = (runtime: Record<string, unknown>) => baseHost({ config: { runtime } })
  assert.deepEqual(methods.splitOutgoingMessage.call(host({}), 'a<sep/>b<sep/>c'), ['a', 'b', 'c'])
  assert.deepEqual(methods.splitOutgoingMessage.call(host({ messageSeparator: ' ｜ ' }), 'a ｜ b'), ['a', 'b'])
  assert.deepEqual(methods.splitOutgoingMessage.call(host({ convertNewlineToSeparator: true }), 'a\nb'), ['a', 'b'])
  assert.deepEqual(methods.splitOutgoingMessage.call(host({ splitReplyMessages: false }), 'a<sep/>b'), ['a<sep/>b'])
})

test('updateScriptDeliveryOutcome: 非整数 entryId 与 story/commit 不匹配均为无写入静默守卫；合法引用写账本', async () => {
  const writes: any[] = []
  const entry = { id: 7, storyId: 's1', metadata: { commitId: 'c1', deliveryActions: [
    { commitId: 'c1', eventId: 'e1', participantId: 'p1', segments: [{ index: 0, kind: 'message', content: 'hi', status: 'pending' }] },
  ] } }
  const host = (row: any) => baseHost({
    dbGet: async () => (row ? [row] : []),
    dbSet: async (_table: string, query: any, patch: any) => { writes.push([query, patch]) },
  })
  // 非整数 scriptEntryId：无任何读写。
  await methods.updateScriptDeliveryOutcome.call(host(entry), 's1', { commitId: 'c1', eventId: 'e1' }, 'delivered', new Date())
  await methods.updateScriptDeliveryOutcome.call(host(entry), 's1', { commitId: 'c1', eventId: 'e1', scriptEntryId: Number.NaN }, 'delivered', new Date())
  assert.equal(writes.length, 0)
  // storyId 不匹配 / commitId 不匹配：静默跳过。
  await methods.updateScriptDeliveryOutcome.call(host(entry), 'other', { commitId: 'c1', eventId: 'e1', scriptEntryId: 7 }, 'delivered', new Date())
  await methods.updateScriptDeliveryOutcome.call(host(entry), 's1', { commitId: 'other', eventId: 'e1', scriptEntryId: 7 }, 'delivered', new Date())
  assert.equal(writes.length, 0)
  // 合法引用：账本写入 delivered（metadata 无 scriptEvents，不触发回访联动）。
  await methods.updateScriptDeliveryOutcome.call(host(entry), 's1', { commitId: 'c1', eventId: 'e1', scriptEntryId: 7, segmentIndex: 0 }, 'delivered', new Date())
  assert.equal(writes.length, 1)
  const action = writes[0][1].metadata.deliveryActions.find((a: any) => a.eventId === 'e1')
  assert.equal(action.status, 'delivered')
  assert.equal(action.segments[0].status, 'delivered')
})

test('recordOutgoingDeliveryFailure: pending 只落账本不写正文；failed 追加“从未发送”系统条目', async () => {
  const outcomes: any[] = [], entries: any[] = []
  const host = baseHost({
    dbGet: async () => [],
    updateScriptDeliveryOutcome: async (_sid: string, ref: any, status: string) => outcomes.push([ref.eventId, status]),
    appendEntry: async (_sid: string, draft: any) => entries.push(draft),
  })
  const message = { participantId: 'p1', content: 'hi', scriptEvent: { commitId: 'c1', eventId: 'e1', scriptEntryId: 7 } }
  await methods.recordOutgoingDeliveryFailure.call(host, { id: 's1' }, 'p1', message as any, 'transport-timeout', 'pending')
  assert.deepEqual(outcomes, [['e1', 'pending']])
  assert.equal(entries.length, 0, 'pending 不得追加虚构正文条目')
  await methods.recordOutgoingDeliveryFailure.call(host, { id: 's1' }, 'p1', message as any, 'offline', 'failed')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'outgoing-delivery-failed')
  assert.equal(entries[0].metadata.status, 'failed')
  assert.ok(entries[0].content.includes('仍未发送'))
})
