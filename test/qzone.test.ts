import assert from 'node:assert/strict'
import test from 'node:test'
import {
  callQzoneAction, evaluateQzoneGate, freshQzoneFeeds, matchQzoneFeedContent, normalizeQzoneFeedEntry, normalizeQzoneMsgEntry,
  probeQzoneAvailable, qzoneFeedCandidates, qzoneIntentFromPayload, qzoneVisibilityLabel, QzoneActionError, resolveQzoneConfig,
  qzoneReactionDeltas,
  type QzoneFeedEntry, type QzonePostRecord,
} from '../src/qzone'

const HOUR = 3_600_000
const baseConfig = resolveQzoneConfig({ enabled: true })

function record(partial: Partial<QzonePostRecord>): QzonePostRecord {
  return { storyId: 's1', kind: 'post', tid: 't1', status: 'confirmed', createdAt: new Date(), ...partial }
}

test('resolveQzoneConfig applies conservative defaults and clamps out-of-range values', () => {
  const defaults = resolveQzoneConfig()
  assert.equal(defaults.enabled, false)
  assert.equal(defaults.dailyPostCap, 3)
  assert.equal(defaults.minIntervalMinutes, 90)
  assert.equal(defaults.feedWindowMinutes, 120)
  const clamped = resolveQzoneConfig({ enabled: true, dailyPostCap: 99, minIntervalMinutes: 1, feedWindowMinutes: 9 })
  assert.equal(clamped.dailyPostCap, 20)
  assert.equal(clamped.minIntervalMinutes, 10)
  assert.equal(clamped.feedWindowMinutes, 15)
})

test('evaluateQzoneGate enforces per-kind daily caps and counts pending as used', () => {
  const now = new Date('2026-09-29T15:00:00')
  const morning = new Date(now.getTime() - 6 * HOUR)
  const used: QzonePostRecord[] = [
    record({ kind: 'post', createdAt: morning }),
    record({ kind: 'post', createdAt: new Date(morning.getTime() + 2 * HOUR) }),
    record({ kind: 'post', status: 'pending', createdAt: new Date(morning.getTime() + 4 * HOUR) }),
    // failed 不计数；昨日动作不计入今日
    record({ kind: 'post', status: 'failed', createdAt: new Date(now.getTime() - 2 * HOUR) }),
    record({ kind: 'like', createdAt: new Date(now.getTime() - 30 * HOUR) }),
  ]
  const gate = evaluateQzoneGate(used, { ...baseConfig, minIntervalMinutes: 10 }, { kind: 'post', now: new Date(now.getTime() + HOUR) })
  assert.equal(gate.allowed, false)
  assert.equal(gate.reason, 'daily-cap')
  assert.equal(gate.usedToday, 3)
  // comment/like 独立配额，不受 post 占满影响
  const commentGate = evaluateQzoneGate(used, { ...baseConfig, minIntervalMinutes: 10 }, { kind: 'comment', now: new Date(now.getTime() + HOUR) })
  assert.equal(commentGate.allowed, true)
  assert.equal(commentGate.cap, 6)
})

test('evaluateQzoneGate enforces cross-kind minimum interval and disabled switch', () => {
  const now = new Date('2026-09-29T15:00:00')
  const recentLike = record({ kind: 'like', createdAt: new Date(now.getTime() - 30 * 60_000) })
  const blocked = evaluateQzoneGate([recentLike], baseConfig, { kind: 'post', now })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.reason, 'min-interval')
  const later = evaluateQzoneGate([recentLike], baseConfig, { kind: 'post', now: new Date(now.getTime() + 91 * 60_000) })
  assert.equal(later.allowed, true)
  const off = evaluateQzoneGate([], resolveQzoneConfig({ enabled: false }), { kind: 'post', now })
  assert.equal(off.allowed, false)
  assert.equal(off.reason, 'disabled')
})

test('normalizeQzoneMsgEntry drops malformed rows and coerces fields', () => {
  const ok = normalizeQzoneMsgEntry({ tid: 12345, content: '今天天气不错', time: 1_760_000_000, comment_num: '3', is_private: true, images: ['u1', 2, ''] })
  assert.ok(ok)
  assert.equal(ok!.tid, '12345')
  assert.equal(ok!.commentNum, 3)
  assert.equal(ok!.isPrivate, true)
  assert.deepEqual(ok!.images, ['u1', '2'])
  assert.equal(ok!.time.getTime(), 1_760_000_000_000)
  assert.equal(normalizeQzoneMsgEntry({ content: 'no tid' }), undefined)
  assert.equal(normalizeQzoneMsgEntry(null), undefined)
})

test('normalizeQzoneFeedEntry keeps structural fields only; freshQzoneFeeds filters by window', () => {
  const now = new Date('2026-09-29T15:00:00')
  const feed = normalizeQzoneFeedEntry({ uin: 10001, nickname: '好友A', time: 1_760_000_000, appid: 311, key: 'abc' }, now)
  assert.ok(feed)
  assert.equal(feed!.uin, '10001')
  assert.equal(feed!.appid, 311)
  assert.equal(normalizeQzoneFeedEntry({ uin: 10001 }), undefined)
  const feeds = [
    { uin: '1', nickname: '', time: new Date(now.getTime() - 10 * 60_000), appid: 311, key: 'k1' },
    { uin: '2', nickname: '', time: new Date(now.getTime() - 5 * HOUR), appid: 311, key: 'k2' },
  ]
  const fresh = freshQzoneFeeds(feeds, baseConfig, now)
  assert.deepEqual(fresh.map(item => item.key), ['k1'])
})

test('callQzoneAction validates echo frames and preserves retcode for risk classification', async () => {
  const ok = await callQzoneAction(() => ({ status: 'ok', retcode: 0, data: { tid: '777' } }), 'send_qzone_msg')
  assert.deepEqual(ok, { tid: '777' })
  await assert.rejects(
    callQzoneAction(() => ({ status: 'failed', retcode: 1200, message: '操作过于频繁' }), 'send_qzone_msg'),
    (error: unknown) => error instanceof QzoneActionError && error.retcode === 1200 && /操作过于频繁/.test(error.message),
  )
  await assert.rejects(
    callQzoneAction(() => { throw new Error('socket closed') }, 'like_qzone'),
    /socket closed/,
  )
  assert.equal(await probeQzoneAvailable(() => { throw new Error('nope') }), false)
  assert.equal(await probeQzoneAvailable(() => ({ status: 'ok', retcode: 0, data: {} })), true)
})

test('qzoneIntentFromPayload validates the three actions and their required fields', () => {
  // 发帖：内容必填、默认好友可见、隐私档白名单
  const post = qzoneIntentFromPayload({ action: 'post', content: '今晚的风很好。' })
  assert.deepEqual(post, { action: 'post', content: '今晚的风很好。', targetUin: undefined, targetName: undefined, ugcRight: 4 })
  const privatePost = qzoneIntentFromPayload({ action: 'post', content: '写给自己。', ugcRight: 64 })
  assert.equal(privatePost!.ugcRight, 64)
  assert.equal(qzoneIntentFromPayload({ action: 'post', content: '' }), null)
  assert.equal(qzoneIntentFromPayload({ action: 'post', content: 'x'.repeat(2_001) }), null)
  assert.equal(qzoneIntentFromPayload({ action: 'post', content: 'ok', ugcRight: 7 })!.ugcRight, 4, '非法隐私档回退默认好友可见')
  // 评论：tid + 内容必填、长度上限、目标账号数字校验
  const comment = qzoneIntentFromPayload({ action: 'comment', content: '哈哈哈', tid: '58a87a00', targetUin: '8038488', targetName: 'creme' })
  assert.deepEqual(comment, { action: 'comment', content: '哈哈哈', tid: '58a87a00', targetUin: '8038488', targetName: 'creme' })
  assert.equal(qzoneIntentFromPayload({ action: 'comment', content: '无目标' }), null)
  assert.equal(qzoneIntentFromPayload({ action: 'comment', content: 'x'.repeat(501), tid: 't' }), null)
  assert.equal(qzoneIntentFromPayload({ action: 'comment', content: '好', tid: 'tid12345', targetUin: 'abc' })!.targetUin, undefined, '非数字目标回退为未提供')
  // 点赞：tid 必填
  const like = qzoneIntentFromPayload({ action: 'like', tid: '58a87a00', targetUin: '2233029096' })
  assert.deepEqual(like, { action: 'like', tid: '58a87a00', targetUin: '2233029096', targetName: undefined })
  assert.equal(qzoneIntentFromPayload({ action: 'like' }), null)
  // 未知动作 / 非 object
  assert.equal(qzoneIntentFromPayload({ action: 'share', content: 'x' }), null)
  assert.equal(qzoneIntentFromPayload('junk'), null)
})

test('qzoneFeedCandidates keeps only fresh talk-type unseen feeds, capped at 2', () => {
  const now = new Date('2026-09-29T15:00:00')
  const feed = (key: string, appid: number, uin: string, minutesAgo: number): QzoneFeedEntry =>
    ({ uin, nickname: `n${key}`, time: new Date(now.getTime() - minutesAgo * 60_000), appid, key })
  const feeds = [
    feed('k1', 311, '10001', 20),          // ✓ 新鲜说说
    feed('ad', 6600, '0', 5),              // ✗ 广告位
    feed('k2', 311, '10002', 40),          // ✓
    feed('seen', 311, '10003', 10),        // ✗ 已入账
    feed('k3', 311, '10004', 50),          // ✓ 但超过单轮上限
    feed('old', 311, '10005', 200),        // ✗ 超出时间窗（默认 120 分钟）
    feed('official', 5000, '20050606', 5), // ✗ 官方号
  ]
  const candidates = qzoneFeedCandidates(feeds, new Set(['seen']), resolveQzoneConfig({ enabled: true }), now)
  assert.deepEqual(candidates.map(item => item.key), ['k1', 'k2'])
})

test('matchQzoneFeedContent aligns by exact tid only', () => {
  const feed: QzoneFeedEntry = { uin: '10001', nickname: 'a', time: new Date(1_760_000_000_000), appid: 311, key: 'feedkey' }
  const entries = [
    { tid: 'other', content: '更早的一条', time: new Date(1_760_000_000_000 - 3_600_000), commentNum: 0, isPrivate: false, images: [] },
    { tid: 'almost', content: '三十秒前', time: new Date(1_760_000_000_000 - 30_000), commentNum: 0, isPrivate: false, images: [] },
  ]
  // 审计修复：近似时间配对会错配连发正文——只认 tid 精确命中，否则空串。
  assert.equal(matchQzoneFeedContent(entries, feed), '')
  assert.equal(matchQzoneFeedContent([...entries, { tid: 'feedkey', content: '精确命中', time: new Date(1_760_000_000_000 - 120_000), commentNum: 0, isPrivate: false, images: [] }], feed), '精确命中')
  assert.equal(matchQzoneFeedContent([], feed), '')
})

test('qzoneVisibilityLabel maps the five rights', () => {
  assert.equal(qzoneVisibilityLabel(1), '所有人可见')
  assert.equal(qzoneVisibilityLabel(4), '好友可见')
  assert.equal(qzoneVisibilityLabel(64), '仅自己可见')
  assert.equal(qzoneVisibilityLabel(0), '好友可见')
})

// ── 审计修复回归（2026-09-29 六项）───────────────────────────────────────────

test('feed-seen rows never consume action quota or interval; unknown outcomes do', () => {
  const now = new Date('2026-09-29T15:00:00')
  const config = { ...baseConfig, minIntervalMinutes: 90 }
  // 一分钟前刚读到好友动态（feed-seen）——不得挡住动作
  const seenOnly = [record({ kind: 'feed-seen', tid: 'feedkey', createdAt: new Date(now.getTime() - 60_000) })]
  assert.equal(evaluateQzoneGate(seenOnly, config, { kind: 'post', now }).allowed, true)
  // 结果未知（unknown）的动作按已发生保守计入：占间隔、占配额
  const unknownAction = [record({ kind: 'like', status: 'unknown', createdAt: new Date(now.getTime() - 60_000) })]
  const blocked = evaluateQzoneGate(unknownAction, config, { kind: 'post', now })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.reason, 'min-interval')
  const capConfig = { ...baseConfig, minIntervalMinutes: 10, dailyPostCap: 1 }
  const unknownPost = [record({ kind: 'post', status: 'unknown', createdAt: new Date(now.getTime() - 3 * HOUR) })]
  assert.equal(evaluateQzoneGate(unknownPost, capConfig, { kind: 'post', now }).reason, 'daily-cap')
})

test('transport errors are flagged ambiguous; explicit failure frames are not', async () => {
  await assert.rejects(
    callQzoneAction(() => { throw new Error('socket hang up') }, 'send_qzone_msg'),
    (error: unknown) => error instanceof QzoneActionError && error.ambiguous === true,
  )
  await assert.rejects(
    callQzoneAction(() => ({ status: 'failed', retcode: 1200, message: '操作过于频繁' }), 'send_qzone_msg'),
    (error: unknown) => error instanceof QzoneActionError && error.ambiguous === false,
  )
})

test('comment/like tids must match a strict charset', () => {
  assert.equal(qzoneIntentFromPayload({ action: 'like', tid: '58a87a00746eb96ab88f0000' }) !== null, true)
  assert.equal(qzoneIntentFromPayload({ action: 'like', tid: 'ab' }), null)
  assert.equal(qzoneIntentFromPayload({ action: 'like', tid: 'tid with spaces!!' }), null)
  assert.equal(qzoneIntentFromPayload({ action: 'comment', content: '好', tid: `x`.repeat(65) }), null)
})

test('matchQzoneFeedContent is exact-tid only — no nearest-time fallback', () => {
  const feed: QzoneFeedEntry = { uin: '10001', nickname: 'a', time: new Date(1_760_000_000_000), appid: 311, key: 'feedkey' }
  const nearMiss = [{ tid: 'other', content: '连发的另一条', time: new Date(1_760_000_000_000 - 30_000), commentNum: 0, isPrivate: false, images: [] }]
  assert.equal(matchQzoneFeedContent(nearMiss, feed), '')
  assert.equal(matchQzoneFeedContent([...nearMiss, { tid: 'feedkey', content: '精确命中', time: new Date(0), commentNum: 0, isPrivate: false, images: [] }], feed), '精确命中')
})

// ── 服务层：并发预留与目标绑定（prototype.call mock，与 Fix#10 同模式）──────
import { InterludeService } from '../src/service'

test('qzoneExecute serializes quota reservation: concurrent posts cannot both pass a cap of 1', async () => {
  const rows: Array<Record<string, unknown> & { id: number, kind: string, status: string, createdAt: Date }> = []
  let seq = 0
  let chain: Promise<unknown> = Promise.resolve()
  // 与真实 serial 同语义的按序链：后进者等待先行者完成（同一故事队列）。
  const serial = (_storyId: string, fn: () => Promise<unknown>) => {
    const run = chain.then(fn)
    chain = run.then(() => undefined, () => undefined)
    return run
  }
  const svc = {
    qzoneRuntime: resolveQzoneConfig({ enabled: true, dailyPostCap: 1, minIntervalMinutes: 10 }),
    serial,
    inSerial: () => false,
    dbGet: async (_table: string, query: { createdAt: { $gte: Date } }) => rows.filter(row => row.createdAt >= query.createdAt.$gte),
    dbCreate: async (_table: string, data: Record<string, unknown>) => { const row = { id: rows.length + 1, ...data } as typeof rows[number]; rows.push(row); return row },
    dbSet: async (_table: string, where: { id: number }, patch: Record<string, unknown>) => { const row = rows.find(item => item.id === where.id); if (row) Object.assign(row, patch); return row },
    endpointAddressSync: (legacy: unknown) => legacy,
    qzoneCaller: () => async () => ({ status: 'ok', retcode: 0, data: { tid: `t${++seq}` } }),
    appendEntry: async () => ({}),
    reportOperation: () => {}, reportStandalone: () => {},
  } as unknown as InterludeService
  const story = { id: 's1', selfId: '12345' } as never
  const [first, second] = await Promise.all([
    (InterludeService.prototype as unknown as { qzoneExecute: Function }).qzoneExecute.call(svc, story, 'post', { content: '第一条' }),
    (InterludeService.prototype as unknown as { qzoneExecute: Function }).qzoneExecute.call(svc, story, 'post', { content: '第二条' }),
  ])
  assert.ok(first.ok !== second.ok, '配额=1 时并发两次发帖必须恰有一次成功')
  assert.equal(rows.filter(row => row.kind === 'post' && row.status !== 'failed').length, 1)
})

test('executeQzoneIntent rejects comment/like tids that were never observed', async () => {
  const intentUpdates: Array<{ id: number, status: string }> = []
  let executed = 0
  const svc = {
    dbGet: async () => [] as unknown[],
    dbSet: async (_table: string, where: { id: number }, patch: { status: string }) => { intentUpdates.push({ id: where.id, status: patch.status }); return {} },
    qzoneExecute: async () => { executed += 1; return { ok: true } },
    reportOperation: () => {},
  } as unknown as InterludeService
  const story = { id: 's1', selfId: '12345' } as never
  await (InterludeService.prototype as unknown as { executeQzoneIntent: Function }).executeQzoneIntent.call(svc, story, { id: 9, payload: { action: 'like', tid: 'deadbeefcafe' } }, new Date())
  assert.equal(executed, 0, '未入账的 tid 不得触达执行器')
  assert.deepEqual(intentUpdates, [{ id: 9, status: 'completed' }], '意图仍要完成，防止账本排水被卡')
})

test('被评论感知：首次立基线不报，增量>0 报，回落下修，不在列表不动', () => {
  const entries = [
    { tid: 'a', content: '今天的晚霞', time: new Date(0), commentNum: 3, isPrivate: false, images: [] },
    { tid: 'b', content: '考试结束啦', time: new Date(0), commentNum: 1, isPrivate: false, images: [] },
  ]
  // 首次观测：只立基线，零感知（新帖自带评论是常态）
  const first = qzoneReactionDeltas([{ storyId: 's', kind: 'post', tid: 'a', status: 'confirmed', createdAt: new Date() }], entries)
  assert.equal(first.deltas.length, 0)
  assert.deepEqual(first.baselines, [{ tid: 'a', commentNum: 3 }])
  // 增量：a 3→5 报 2 条；b 首次立基线不报
  const second = qzoneReactionDeltas([
    { storyId: 's', kind: 'post', tid: 'a', status: 'confirmed', commentNum: 3, createdAt: new Date() },
    { storyId: 's', kind: 'post', tid: 'b', status: 'confirmed', createdAt: new Date() },
  ], [
    { ...entries[0], commentNum: 5 }, entries[1],
  ])
  assert.equal(second.deltas.length, 1)
  assert.equal(second.deltas[0].previous, 3)
  assert.equal(second.deltas[0].current, 5)
  assert.equal(second.deltas[0].contentExcerpt, '今天的晚霞')
  assert.deepEqual(second.baselines.map(b => b.tid), ['a', 'b'])
  // 回落（删评）：5→4 静默下修基线，不产出
  const third = qzoneReactionDeltas([{ storyId: 's', kind: 'post', tid: 'a', status: 'confirmed', commentNum: 5, createdAt: new Date() }], [{ ...entries[0], commentNum: 4 }])
  assert.equal(third.deltas.length, 0)
  assert.deepEqual(third.baselines, [{ tid: 'a', commentNum: 4 }])
  // 帖子不在拉取列表：基线保持、不产出、不写 baselines
  const absent = qzoneReactionDeltas([{ storyId: 's', kind: 'post', tid: 'zzz', status: 'confirmed', commentNum: 2, createdAt: new Date() }], entries)
  assert.equal(absent.deltas.length, 0)
  assert.equal(absent.baselines.length, 0)
  // 空 tid / 未确认帖不参与
  const empty = qzoneReactionDeltas([{ storyId: 's', kind: 'post', tid: ' ', status: 'confirmed', createdAt: new Date() }], entries)
  assert.equal(empty.baselines.length, 0)
})
