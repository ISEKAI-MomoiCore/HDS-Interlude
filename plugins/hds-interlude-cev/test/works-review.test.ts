import assert from 'node:assert/strict'
import test from 'node:test'
import { SharedWorks, splitDumpParts, workKey, type WorkRow, type WorkStore, WORK_INSTRUCTION, ASYNC_WORK_INSTRUCTION } from '../src/works'

function fixture(seed?: (row: WorkRow) => void) {
  const rows = new Map<string, WorkRow>()
  const removed: Array<{ storyId: string, participantId: string }> = []
  const store: WorkStore = {
    get: async id => rows.get(id),
    create: async row => { rows.set(row.id, row) },
    replace: async (row, generation) => {
      const current = rows.get(row.id)
      if (!current || current.generation !== generation) return false
      rows.set(row.id, row)
      return true
    },
    list: async () => [...rows.values()],
    remove: async query => { removed.push(query); for (const [id, row] of rows) if (row.storyId === query.storyId && row.participantId === query.participantId) rows.delete(id) },
  }
  const works = new SharedWorks(store)
  if (seed) {
    const row: WorkRow = { id: workKey('s', 'p'), storyId: 's', participantId: 'p', generation: 0, state: { schemaVersion: 1, title: '标题', head: 'r0', revisions: [{ id: 'r0', parentId: null, content: '底稿', author: 'user', createdAt: '2026-01-01T00:00:00Z' }], proposals: [], jobs: [] } }
    seed(row)
    rows.set(workKey('s', 'p'), row)
  }
  return { works, rows, removed }
}

test('review#1 resolved proposals are pruned at propose time; pending cap still enforced', async () => {
  const { works, rows } = fixture(row => {
    for (let i = 0; i < 30; i++) {
      row.state.proposals.push({ id: `done${i}`, baseRevisionId: 'r0', content: `稿${i}`, reason: 'r', status: i % 2 ? 'accepted' : 'rejected', author: 'user', operationKey: `k${i}`, createdAt: '2026-01-01T00:00:00Z' })
    }
  })
  const before = rows.get(workKey('s', 'p'))!.state.proposals.length
  await works.propose('s', 'p', { baseRevisionId: 'r0', content: '新稿', reason: '测试' }, 'user', 'cmd:1')
  const state = rows.get(workKey('s', 'p'))!.state
  assert.equal(before, 30)
  // 终态只保留最近 8 条 + 1 条新 pending
  const terminal = state.proposals.filter(p => p.status !== 'pending')
  assert.equal(terminal.length, 8)
  assert.ok(state.proposals.some(p => p.status === 'pending'))
  // pending 打满后仍然拒绝（需用户处理，而不是锁死历史）
  for (let i = 0; i < 40; i++) {
    try { await works.propose('s', 'p', { baseRevisionId: rows.get(workKey('s', 'p'))!.state.head, content: `稿${i}`, reason: 'x' }, 'user', `cmd:1${i}`) } catch { break }
  }
  const finalState = rows.get(workKey('s', 'p'))!.state
  assert.equal(finalState.proposals.length, 32, '总量精确停在 decode 上限（剪除为待决腾出空间）')
  await assert.rejects(works.propose('s', 'p', { baseRevisionId: rows.get(workKey('s', 'p'))!.state.head, content: '超', reason: 'x' }, 'user', 'cmd:overflow'), /提案已达 32 条上限/)
})

test('review#1 revisions roll instead of bricking at 64', async () => {
  const { works, rows } = fixture()
  await works.create('s', 'p', '标题', '底稿')
  for (let i = 0; i < 70; i++) {
    const p = await works.propose('s', 'p', { baseRevisionId: rows.get(workKey('s', 'p'))!.state.head, content: `第${i}版`, reason: '滚动' }, 'user', `k${i}`)
    await works.resolve('s', 'p', p.id, true)
  }
  const state = rows.get(workKey('s', 'p'))!.state
  assert.equal(state.revisions.length, 64, '滚动窗口封顶 64，不再抛错锁死')
  assert.ok(state.revisions.every(r => typeof r.content === 'string'))
  // 剪掉最旧后 decode 兼容（读回不炸）
  const reread = await works.read('s', 'p')
  assert.ok(reread)
})

test('review#1 terminal jobs pruned before the generate cap check', async () => {
  const { works, rows } = fixture(row => {
    row.state.jobs = Array.from({ length: 30 }, (_, i) => ({ baseRevisionId: 'r0', brief: 'b', id: `j${i}`, operationKey: `op${i}`, sourceEntryId: i, modelId: 'm', status: i < 25 ? 'failed' : 'completed', createdAt: '2026-01-01T00:00:00Z' }) as never)
  })
  const job = await works.generate('s', 'p', { baseRevisionId: 'r0', brief: '新任务' }, 'op-new', 1, 'm', async () => '生成稿')
  const jobs = rows.get(workKey('s', 'p'))!.state.jobs!
  assert.equal(job.status, 'running')
  assert.ok(jobs.length <= 32, '任务滚动窗口不超过 decode 上限')
  assert.equal(jobs.filter(j => j.status !== 'running').length, 8, '终态任务保留最近 8 条')
  await new Promise(r => setTimeout(r, 20))
})

test('review#2 startup recovery marks stale running jobs failed and frees mayPropose', async () => {
  const { works, rows } = fixture(row => {
    row.state.jobs = [{ baseRevisionId: 'r0', brief: 'b', id: 'j1', operationKey: 'op1', sourceEntryId: 1, modelId: 'm', status: 'running', createdAt: '2026-01-01T00:00:00Z' }] as never
  })
  let ctx0 = await works.context('s', 'p', 'separate')
  assert.equal(ctx0!.mayPropose, false, 'DB running 任务压住 mayPropose')
  await works.startupRecover()
  const state = rows.get(workKey('s', 'p'))!.state
  assert.equal(state.jobs![0].status, 'failed')
  const ctx1 = await works.context('s', 'p', 'separate')
  assert.equal(ctx1!.mayPropose, true, '清扫后 mayPropose 解锁')
})

test('review#3 deleteAll goes through the store abstraction', async () => {
  const { works, rows, removed } = fixture()
  await works.create('s', 'p', '标题', '正文')
  await works.deleteAll('s', 'p')
  assert.deepEqual(removed, [{ storyId: 's', participantId: 'p' }])
  assert.equal(rows.size, 0)
})

test('review#4 splitDumpParts chunks oversized dumps losslessly', () => {
  const text = JSON.stringify({ a: 'x'.repeat(6000) })
  const parts = splitDumpParts(text, 2400)
  assert.ok(parts.length >= 3)
  assert.equal(parts.join(''), text, '分段无损可拼接')
  assert.deepEqual(splitDumpParts('short'), ['short'])
})

test('review#11 lastFailure carries a timestamp the model can judge recency by', async () => {
  const { works, rows } = fixture()
  await works.create('s', 'p', '标题', '底稿')
  await works.recordFailure('s', 'p', 7)
  const failure = rows.get(workKey('s', 'p'))!.state.lastFailure!
  assert.equal(failure.sourceEntryId, 7)
  assert.ok(failure.at && !Number.isNaN(Date.parse(failure.at)), 'at 是可解析时间戳')
  const ctx = await works.context('s', 'p')
  assert.ok(ctx!.lastFailure?.at)
})

test('review#5 instructions state the mayPropose semantics consistently', () => {
  assert.match(WORK_INSTRUCTION, /mayPropose shows whether a new request is wanted/)
  assert.match(WORK_INSTRUCTION, /allowed regardless of running jobs/)
  assert.match(ASYNC_WORK_INSTRUCTION, /lastFailure\.at timestamps the most recent failure/)
  assert.match(WORK_INSTRUCTION, /lastFailure\.at timestamps a failed save attempt/)
})
