import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEpisodeIndex, episodeExcerpt, EpisodeSource } from '../src/script/episode-index'
import { deliveryReality } from '../src/script/delivery-reality'
import { compileNarrativeContext } from '../src/script/context-compiler'

const row = (content: string, participantId = 'a', frameId = 'scene:1'): EpisodeSource => ({
  content, participantId, frameId, occurredAt: '2026-09-05T00:00:00Z', kind: 'script',
})

test('episode navigation rebuilds identically and never groups separate relationships or scenes', () => {
  const rows: Array<[number, EpisodeSource]> = [[1, row('出发')], [2, row('抵达')], [3, row('秘密', 'b')], [4, row('新场景', 'a', 'scene:2')]]
  assert.deepEqual(buildEpisodeIndex(rows), buildEpisodeIndex(JSON.parse(JSON.stringify(rows))))
  assert.deepEqual(buildEpisodeIndex(rows).get(1), [1, 2])
  assert.deepEqual(buildEpisodeIndex(rows).get(3), [3])
})

test('long preceding prose cannot displace the recall hit and source ids reflect included text', () => {
  const rows: Array<[number, EpisodeSource]> = [[1, row('旧'.repeat(5000))], [2, row('取餐码8914')], [3, row('取走奶茶')]]
  const excerpt = episodeExcerpt(rows, 2, 200)!
  assert.match(excerpt.content, /取餐码8914/)
  assert.ok(excerpt.sourceEntryIds.includes(2))
  assert.ok(excerpt.sourceEntryIds.includes(3))
  assert.ok(!excerpt.sourceEntryIds.includes(1))
  assert.equal(rows[0][1].content.length, 5000)
})

test('delivery reality keeps execution outcomes without duplicating message prose', () => {
  const entry: any = { id: 1, kind: 'script', content: '她发了两句话。', metadata: { commitId: 'c', deliveryActions: [{ commitId: 'c', eventId: 'e', segments: [
    { kind: 'message', content: '第一句', status: 'delivered' },
    { kind: 'message', content: '第二句', status: 'pending' },
  ] }] } }
  const before = JSON.stringify(entry)
  const result = deliveryReality([entry])
  assert.equal(result[0].segments[1].outcome, 'not-confirmed')
  assert.deepEqual(result[0].segments[1], { index: 1, kind: 'message', head: '第二句', outcome: 'not-confirmed' })
  assert.equal(result[0].eventKind, 'outgoing-message')
  // 投影只读：账本与条目原文保持字节一致。
  assert.equal(JSON.stringify(entry), before)
  assert.equal(deliveryReality([{ ...entry, kind: 'user-message' }]).length, 0)
})

test('delivery reality heads truncate prose by code points and pass identifier kinds through', () => {
  const long = '这是一段长得多的消息原文会被截断成指针'.repeat(3)
  const emojiLed = '😀😀😀😀😀😀😀😀😀😀😀😀😀😀结尾'
  const entry: any = { id: 2, kind: 'script', metadata: { commitId: 'c', deliveryActions: [{ commitId: 'c', eventId: 'e', eventKind: 'platform-action', segments: [
    { index: 0, kind: 'message', content: long, status: 'pending' },
    { index: 1, kind: 'message', content: emojiLed, status: 'failed' },
    { index: 2, kind: 'native-face', content: 'smile', status: 'delivered' },
    { index: 3, kind: 'message-reaction', content: 'msg-3:like', status: 'cancelled' },
  ] }] } }
  const [action] = deliveryReality([entry])
  assert.equal(action.eventKind, 'platform-action')
  assert.equal(action.segments[0].head, `${Array.from(long).slice(0, 12).join('')}…`)
  assert.ok(!action.segments[0].head.includes('指针'))
  // 代理对按码点截断，不产生半个代理项。
  assert.equal(action.segments[1].head, '😀😀😀😀😀😀😀😀😀😀😀😀…')
  assert.equal(action.segments[2].head, 'smile')
  assert.equal(action.segments[3].head, 'msg-3:like')
  assert.equal(action.segments[1].outcome, 'delivery-not-confirmed-after-error')
  assert.equal(action.segments[3].outcome, 'cancelled')
})

test('delivery reality attaches story-local receipt clocks and falls back to attempt time', () => {
  const entry: any = { id: 3, kind: 'script', metadata: { commitId: 'c', deliveryActions: [{ commitId: 'c', eventId: 'e', segments: [
    { index: 0, kind: 'message', content: '送达的', status: 'delivered', completedAt: '2026-10-17T06:34:00Z' },
    { index: 1, kind: 'message', content: '未确认的', status: 'pending', attemptedAt: '2026-10-17T06:31:00Z' },
    { index: 2, kind: 'message', content: '无时间戳', status: 'cancelled' },
  ] }] } }
  const [action] = deliveryReality([entry], undefined, false, { timezone: 'Asia/Shanghai' })
  assert.equal(action.segments[0].at, '14:34')
  assert.equal(action.segments[1].at, '14:31')
  assert.ok(!('at' in action.segments[2]))
  // 未提供时区时保持紧凑形状，不输出时间字段。
  const [bare] = deliveryReality([entry])
  assert.ok(!('at' in bare.segments[0]))
})

test('delivery reality character budget keeps newest actions and allows one overflow', () => {
  const actionEntry = (id: number) => ({
    id, kind: 'script', metadata: { commitId: 'c', deliveryActions: [{ commitId: 'c', eventId: `e${id}`, segments: [
      { index: 0, kind: 'message', content: `第${id}条未送达的消息原文占位`.repeat(6), status: 'pending' },
    ] }] },
  })
  const entries: any[] = [1, 2, 3, 4].map(actionEntry)
  // 每条投影约 60-80 字符；预算 200 只容得下最新的 2-3 条。
  const kept = deliveryReality(entries, undefined, false, { characterBudget: 200 })
  assert.ok(kept.length >= 1 && kept.length < entries.length)
  assert.deepEqual(kept.map(item => item.sourceEntryId), entries.slice(-kept.length).map(entry => entry.id))
  // 单条超过预算时仍保留最新一条（软预算语义）。
  const only = deliveryReality([actionEntry(9)], undefined, false, { characterBudget: 200 })
  assert.equal(only.length, 1)
})

test('compiled writing context excludes legacy rhythm directives and carries execution evidence', () => {
  const result = compileNarrativeContext({ chatRhythm: { drift: '强制三段' }, deliveryReality: [{ sourceEntryId: 1 }] }, undefined, undefined)
  assert.doesNotMatch(JSON.stringify(result), /强制三段|chatRhythm/)
  assert.deepEqual(result.ongoingThreads.deliveryReality, [{ sourceEntryId: 1 }])
})

test('checkpoint provenance groups legacy original entries without merging relationships', () => {
  const rows: Array<[number, EpisodeSource]> = [
    [1, { ...row('起点'), frameId: undefined }],
    [2, { ...row('结束'), frameId: undefined, checkpoint: { sceneId: 7, firstEntryId: 1, lastEntryId: 3 } }],
    [3, { ...row('另一关系', 'b'), frameId: undefined }],
  ]
  assert.deepEqual(buildEpisodeIndex(rows).get(1), [1, 2])
  assert.deepEqual(buildEpisodeIndex(rows).get(3), [3])
})

test('cross-relationship action text stays out of delivery reality unless sharing is enabled', () => {
  const entry: any = { id: 1, kind: 'script', metadata: { commitId: 'c', deliveryActions: [{
    commitId: 'c', participantId: 'b', eventId: 'e', segments: [{ kind: 'message', content: '私密行动', status: 'pending' }],
  }] } }
  assert.deepEqual(deliveryReality([entry], 'a', false), [])
  assert.equal(deliveryReality([entry], 'b', false).length, 1)
})
