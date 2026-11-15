import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request } from 'node:http'
import { resolve } from 'node:path'
import { Logger } from 'koishi'
import { fixture } from './fixture'
import { SqliteStore } from '../src/store'
import { createWebServer, isLoopback } from '../src/server'
import { num } from '../src/routes'
import { attachLogCapture, LogRing } from '../src/logring'
import { addDays, weekStart, calendarWeek, toDate, localDate, textDiff, appliedComparisons, chartSvg, esc } from '../public/helpers.mjs'

test('SQLite 故事隔离、JSON 解码、数字时间与稳定分页', () => {
  const f = fixture(), store = new SqliteStore(f.file)
  try {
    assert.equal(store.resolveStoryId(), 'demo-a')
    assert.equal(store.storySummary('demo-a')?.entryCount, 115)
    assert.equal(store.storySummary('demo-a')?.alter?.history.length, 16)
    assert.equal(store.storySummary('demo-a')?.lifeRhythm?.attention, 'resting', 'rc52 lifeRhythm 暴露')
    assert.equal(store.storySummary('demo-a')?.lifeRhythm?.source, 'compactor')
    assert.equal(store.storySummary('demo-a')?.proactiveContactCount, 2)
    assert.equal(store.storySummary('demo-b')?.lifeRhythm, null, '旧版本故事无节奏数据')
    assert.equal(store.scriptEntries({ limit: 10 }, 'demo-a').rows[0].id, 115)
    const next = store.scriptEntries({ limit: 10, after: 1 }, 'demo-a')
    assert.deepEqual(next.rows.map(e => e.id), [2,3,4,5,6,7,8,9,10,11])
    assert.equal(next.total, 115)
    assert.equal(next.hasMore, true)
    assert.equal(store.scriptEntries({ limit: 10, before: 10 }, 'demo-a').rows[0].id, 9)
    assert.equal(store.scriptEntries({ limit: 10 }, 'demo-b').total, 1)
    assert.equal(store.scenes('demo-b').length, 0)
    assert.equal(store.arc('demo-b'), null)
    assert.equal(store.preplan('demo-b'), null)
    assert.equal(store.participants('demo-a').some(p => p.id === 'other'), false)
    assert.equal(store.participants('demo-a').find(p => p.id === 'corrupt')?.state, null)
    assert.deepEqual(store.overlayPatches('demo-a')[0].sourceEntryIds, [5])
    assert.equal(Array.isArray(store.preplan('demo-a')?.materializedDays), true)
    assert.equal(store.missingTables().length, 0)
    assert.throws(() => (store as any).db.exec('DELETE FROM interlude_story'), /readonly/i)
  } finally { store.close(); f.close() }
})
test('缺少可选表不导致整个页面崩溃，data_version 检测非剧本表更新', () => {
  const f = fixture(), store = new SqliteStore(f.file)
  try {
    const rev = store.revision()
    f.db.exec("UPDATE interlude_intent SET summary='changed'; DROP TABLE interlude_schedule_preplan")
    assert.notEqual(store.revision(), rev)
    assert.equal(store.preplan('demo-a'), null)
    assert.ok(store.missingTables().includes('interlude_schedule_preplan'))
    assert.equal(store.storySummary('demo-a')?.id, 'demo-a')
  } finally { store.close(); f.close() }
})
test('LogRing 初始过滤、非匹配游标推进、缓冲覆盖及重启恢复', () => {
  const ring = new LogRing(2)
  ring.push('info', 'a', 'first'); ring.push('warn', 'a', 'second'); ring.push('info', 'b', 'third')
  assert.deepEqual(ring.latest(10, 'warn').map(l => l.message), ['second'])
  assert.deepEqual(ring.read({ since: 2, level: 'warn' }).lines, [])
  assert.equal(ring.read({ since: 2, level: 'warn' }).cursor, 3)
  assert.equal(ring.read({ since: 0 }).dropped, true)
  assert.equal(ring.read({ session: 'old', since: 100 }).reset, true)
  assert.equal(ring.read({ session: 'old', since: 100 }).lines.length, 2)
})
test('Logger transport 捕获真级别 / 名称，不覆写 console，乱序卸载安全', () => {
  const a = new LogRing(10), b = new LogRing(10), original = console.log
  const detachA = attachLogCapture(a), detachB = attachLogCapture(b)
  try {
    new Logger('fixture').warn('warning %s', 'one')
    assert.equal(a.latest()[0].level, 'warn'); assert.equal(a.latest()[0].name, 'fixture')
    assert.equal(a.latest()[0].message, 'warning one')
    assert.equal(console.log, original)
    detachA(); new Logger('fixture').error('error two')
    assert.equal(a.latest().length, 1); assert.equal(b.latest().length, 2)
    detachB(); detachB()
  } finally { detachA(); detachB() }
})
test('时间解析不追加重复 Z，周日期无 DST 偏移，故事时区正确', () => {
  const time = Date.parse('2026-10-08T10:00:00Z')
  assert.equal(toDate(time)?.getTime(), time)
  assert.equal(toDate(String(time))?.getTime(), time)
  assert.equal(toDate('2026-10-08 10:00:00')?.getTime(), time)
  assert.equal(toDate('2026-10-08T18:00:00+08:00')?.getTime(), time)
  assert.equal(localDate('2026-10-08T20:00:00Z', 'Asia/Shanghai'), '2026-10-09')
  assert.equal(weekStart('2026-10-11'), '2026-10-05')
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(weekStart('2026-02-30'), null)
})
test('Preplan 跨午夜 / 上周续段 / 候选 / 空白及未物化区分', () => {
  const rows = [{ date: '2026-10-04', blocks: [{ id: 'n', start: '23:00', end: '01:00', label: '夜班', tentative: true }] }, { date: '2026-10-06', blocks: [] }]
  const week = calendarWeek(rows, '2026-10-05')
  assert.equal(week[0].blocks[0].displayStart, '00:00')
  assert.equal(week[0].blocks[0].displayEnd, '01:00')
  assert.equal(week[0].blocks[0].sourceDate, '2026-10-04')
  assert.equal(week[0].blocks[0].tentative, true)
  assert.equal(week[0].covered, false); assert.equal(week[1].covered, true)
  assert.equal(week[2].blocks.length, 0)
})
test('Overlay diff 仅比较同源已应用文本，未知基线不是空值', () => {
  const patches = [{ id: 1, target: 'world', path: 'x', status: 'applied', proposedValue: 'a\nb', appliedAt: 1 }, { id: 2, target: 'world', path: 'x', status: 'proposed', proposedValue: 'ignored' }, { id: 3, target: 'world', path: 'x', status: 'applied', proposedValue: 'a\nc', appliedAt: 3 }, { id: 4, target: 'world', path: 'x', participantId: 'other', status: 'applied', proposedValue: 'other', appliedAt: 4 }]
  const comparisons = appliedComparisons(patches)
  assert.equal(comparisons.length, 3); assert.equal(comparisons[0].before, null)
  assert.equal(comparisons[1].before?.id, 1); assert.equal(comparisons[2].diff, null)
  assert.deepEqual(textDiff('a\nb', 'a\nc').map(l => l.type), ['same', 'remove', 'add'])
})
test('图表退化数据 / XSS 安全与严格整数参数', () => {
  assert.equal(chartSvg([]), '')
  assert.match(chartSvg([{ alterValue: 0, turn: '<img>', timestamp: 'bad' }]), /&lt;img&gt;/)
  assert.doesNotMatch(chartSvg([{ alterValue: NaN }]), /NaN/)
  assert.equal(esc('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;')
  assert.throws(() => num('12x')); assert.throws(() => num('-1')); assert.throws(() => num('9007199254740992'))
  assert.equal(isLoopback('0.0.0.0'), false)
})
async function raw(port: number, path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; body: string; headers: any }>((done, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers, method }, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => done({ status: res.statusCode!, body, headers: res.headers })) }); req.on('error', reject); req.end()
  })
}
test('HTTP 静态页 / token（含 SSE）/ 方法 / Host / Origin / 畸形路径', async () => {
  const f = fixture(), store = new SqliteStore(f.file), ring = new LogRing(10)
  const web = createWebServer({ publicRoot: resolve('public'), token: 'secret', pollSeconds: 1, store, ring })
  web.server.listen(0, '127.0.0.1'); await once(web.server, 'listening')
  const port = (web.server.address() as any).port
  try {
    assert.equal((await raw(port, '/')).status, 200)
    assert.equal((await raw(port, '/app.js')).status, 200)
    assert.equal((await raw(port, '/missing.css')).status, 404)
    assert.equal((await raw(port, '/%XX')).status, 400)
    assert.equal((await raw(port, '/api/overview')).status, 403)
    assert.equal((await raw(port, '/api/stream')).status, 403)
    assert.equal((await raw(port, '/api/overview?token=secret')).status, 200)
    assert.equal((await raw(port, '/api/overview', { Authorization: 'Bearer secret' })).status, 200)
    assert.equal((await raw(port, '/api/overview?token=secret', {}, 'POST')).status, 405)
    assert.equal((await raw(port, '/api/overview?token=secret', { Host: `evil.example:${port}` })).status, 403)
    assert.equal((await raw(port, '/api/overview?token=secret', { Origin: 'https://evil.example' })).status, 403)
    assert.equal((await raw(port, '/api/overview?token=secret', { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
    assert.equal((await raw(port, '/api/script?token=secret&limit=10abc')).status, 400)
    assert.equal((await raw(port, '/api/script?token=secret&before=2&after=1')).status, 400)
    assert.equal((await raw(port, '/api/overview?token=secret&story=absent')).status, 404)
    const b = await raw(port, '/api/overview?token=secret&story=demo-b')
    assert.equal(JSON.parse(b.body).arc, null)
    assert.equal(b.headers['referrer-policy'], 'no-referrer')
    assert.ok(b.headers['content-security-policy'].includes("style-src 'self'"))
  } finally { web.stopStreams(); await new Promise<void>(done => web.server.close(() => done())); store.close(); f.close() }
})
test('SSE 已鉴权，非剧本数据变化仍推送；关闭客户端释放连接', async () => {
  const f = fixture(), store = new SqliteStore(f.file)
  const web = createWebServer({ publicRoot: resolve('public'), token: 'secret', pollSeconds: 1, store })
  web.server.listen(0, '127.0.0.1'); await once(web.server, 'listening')
  const port = (web.server.address() as any).port
  const controller = new AbortController()
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/stream?token=secret`, { signal: controller.signal })
    assert.equal(response.status, 200)
    const reader = response.body!.getReader(); await reader.read()
    f.db.exec("UPDATE interlude_fact SET content='new fact'")
    const event = await reader.read()
    assert.match(new TextDecoder().decode(event.value), /data:.*rev/)
    await reader.cancel()
  } finally { controller.abort(); web.stopStreams(); web.server.closeAllConnections(); await new Promise<void>(done => web.server.close(() => done())); store.close(); f.close() }
})
