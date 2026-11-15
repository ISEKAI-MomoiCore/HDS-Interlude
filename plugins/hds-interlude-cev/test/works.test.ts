import assert from 'node:assert/strict'
import test from 'node:test'
import { SharedWorks, type WorkRow, type WorkStore, parseWorkEdit } from '../src/works'
import { toPromptPayload, OpenAICompatibleNarrator } from '../src/narrator'
import { emptyStorySetting, emptyStoryState } from '../src/types'
import { Config } from '../src/index'
import { InterludeService } from '../src/service'
import { resolveModelRouting } from '../src/model-routing'

function fixture() {
  const rows = new Map<string, WorkRow>()
  const store: WorkStore = {
    get: async id => { const r = rows.get(id); return r && structuredClone(r) },
    create: async r => { if (rows.has(r.id)) throw Error('duplicate'); rows.set(r.id, structuredClone(r)) },
    replace: async (r, generation) => {
      if (rows.get(r.id)?.generation !== generation) return false
      rows.set(r.id, structuredClone(r)); return true
    },
  }
  return { rows, store, works: new SharedWorks(store) }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('CEV separate generation returns before inference, persists status, deduplicates and needs acceptance', async () => {
  const { works } = fixture()
  const row = await works.create('s', 'p', '短篇', '原稿')
  let finish!: (text: string) => void
  let calls = 0
  const generate = async (input: any) => { calls++; assert.equal(input.content, '原稿'); return new Promise<string>(resolve => { finish = resolve }) }
  const request = { baseRevisionId: row.state.head, brief: '从窗外雨声开始' }
  const job = await works.generate('s', 'p', request, 'script:1', 1, 'writer', generate)
  assert.equal(calls, 1)
  assert.equal((await works.context('s', 'p', 'separate'))!.generationJobs[0].status, 'running')
  assert.equal((await works.generate('s', 'p', request, 'script:1', 1, 'writer', generate)).id, job.id)
  assert.equal(calls, 1)
  finish('雨滴敲在玻璃上。')
  await settle()
  const result = (await works.read('s', 'p'))!
  assert.equal(result.state.head, row.state.head)
  assert.equal(result.state.jobs![0].status, 'completed')
  await works.resolve('s', 'p', result.state.proposals[0].id, true)
  assert.equal((await works.context('s', 'p'))!.content, '雨滴敲在玻璃上。')
})

test('CEV asynchronous stale result is retained as a proposal, never overwrites a newer revision', async () => {
  const { works } = fixture()
  const row = await works.create('s', 'p', '标题', '原稿')
  let finish!: (text: string) => void
  await works.generate('s', 'p', { baseRevisionId: row.state.head, brief: '改写' }, 'script:2', 2, 'writer', () => new Promise(resolve => { finish = resolve }))
  const edit = await works.propose('s', 'p', { baseRevisionId: row.state.head, content: '用户新稿', reason: '新选择' }, 'user', 'user:3')
  await works.resolve('s', 'p', edit.id, true)
  finish('较早基础的独立模型草稿')
  await settle()
  const current = (await works.read('s', 'p'))!
  const generated = current.state.proposals.find(p => p.operationKey === 'script:2')!
  assert.ok(generated)
  await assert.rejects(works.resolve('s', 'p', generated.id, true), /旧版本/)
  assert.equal((await works.context('s', 'p'))!.content, '用户新稿')
})

test('CEV failure has no retry; old rows, interruption and cancellation remain explicit', async () => {
  const { works, store } = fixture()
  const row = await works.create('s', 'p', '标题', '原稿')
  assert.deepEqual(await works.generationStatus('s', 'p'), [])
  let calls = 0
  const input = { baseRevisionId: row.state.head, brief: '改写' }
  await works.generate('s', 'p', input, 'script:1', 1, 'writer', async () => { calls++; throw Error('request failed') })
  await settle()
  assert.equal(calls, 1)
  assert.equal((await works.generationStatus('s', 'p'))[0].status, 'failed')
  assert.equal((await works.read('s', 'p'))!.state.proposals.length, 0)
  let finish!: (text: string) => void
  const job = await works.generate('s', 'p', input, 'script:2', 2, 'writer', () => new Promise(resolve => { finish = resolve }))
  const reopened = new SharedWorks(store)
  assert.equal((await reopened.generationStatus('s', 'p'))[1].status, 'interrupted')
  await assert.rejects(reopened.generate('s', 'p', input, 'script:3', 3, 'writer', async () => 'no'), /中断/)
  await reopened.cancelGeneration('s', 'p', job.id)
  finish('不应写入')
  await settle()
  assert.equal((await works.read('s', 'p'))!.state.proposals.length, 0)
})

test('CEV deletion/recreation and disposal invalidate pending results; concurrency is bounded', async () => {
  const { works, rows, store } = fixture()
  const row = await works.create('s', 'p', '标题', '原稿')
  const second = await works.create('s', 'other', '另一作品', '另一原稿')
  let finish!: (text: string) => void
  await works.generate('s', 'p', { baseRevisionId: row.state.head, brief: '改写' }, 'script:1', 1, 'writer', () => new Promise(resolve => { finish = resolve }))
  await assert.rejects(works.generate('s', 'other', { baseRevisionId: second.state.head, brief: '改写' }, 'script:2', 2, 'writer', async () => 'no'), /进行中/)
  rows.delete(row.id)
  await works.create('s', 'p', '重建作品', '全新原文')
  finish('旧任务输出')
  await settle()
  assert.equal((await works.read('s', 'p'))!.state.proposals.length, 0)
  await works.generate('s', 'other', { baseRevisionId: second.state.head, brief: '改写' }, 'script:3', 3, 'writer', () => new Promise(resolve => { finish = resolve }))
  works.stop()
  finish('关闭后的输出')
  await settle()
  assert.equal((await new SharedWorks(store).generationStatus('s', 'other'))[0].status, 'interrupted')
})


test('CEV create -> proposal -> accept keeps immutable versions and survives reopening', async () => {
  const { works, store } = fixture()
  const initial = await works.create('s', 'alice', '共同短篇', '旧正文')
  const p = await works.propose('s', 'alice', { baseRevisionId: initial.state.head, content: '新正文', reason: '保留留白' }, 'protagonist', 'script:1', 1)
  assert.equal((await works.read('s', 'alice'))!.state.head, initial.state.head)
  const accepted = await works.resolve('s', 'alice', p.id, true)
  assert.equal(accepted.state.revisions[0].content, '旧正文')
  assert.equal(accepted.state.revisions[1].parentId, initial.state.head)
  assert.equal(accepted.state.revisions[1].content, '新正文')
  assert.deepEqual(await new SharedWorks(store).read('s', 'alice'), accepted)
  assert.deepEqual(await works.resolve('s', 'alice', p.id, true), accepted)
})

test('CEV rejection does not modify head; other user and other story cannot access it', async () => {
  const { works } = fixture()
  const row = await works.create('s', 'alice', '标题', '正文')
  const p = await works.propose('s', 'alice', { baseRevisionId: row.state.head, content: '另一稿', reason: '提案' }, 'user', '1')
  const rejected = await works.resolve('s', 'alice', p.id, false)
  assert.equal(rejected.state.head, row.state.head)
  assert.equal(rejected.state.proposals[0].status, 'rejected')
  assert.equal(await works.read('s', 'bob'), undefined)
  assert.equal(await works.context('other', 'alice'), undefined)
  await assert.rejects(works.resolve('s', 'bob', p.id, true))
  await assert.rejects(works.resolve('s', 'alice', p.id, true), /已经处理/)
})

test('CEV stale proposal stays pending instead of overwriting a newer revision', async () => {
  const { works } = fixture()
  const row = await works.create('s', 'p', '标题', '正文')
  const edit = { baseRevisionId: row.state.head, content: 'A', reason: '修改' }
  const a = await works.propose('s', 'p', edit, 'user', 'a')
  const b = await works.propose('s', 'p', { ...edit, content: 'B' }, 'protagonist', 'b')
  await works.resolve('s', 'p', a.id, true)
  await assert.rejects(works.resolve('s', 'p', b.id, true), /旧版本/)
  assert.equal((await works.read('s', 'p'))!.state.proposals[1].status, 'pending')
})

test('CEV concurrent edits use compare-and-swap, not last-writer overwrite', async () => {
  const { works } = fixture()
  const row = await works.create('s', 'p', '标题', '正文')
  const result = await Promise.allSettled(['a', 'b'].map(key => works.propose('s', 'p', { baseRevisionId: row.state.head, content: key, reason: '修改' }, 'user', key)))
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((await works.read('s', 'p'))!.state.proposals.length, 1)
})

test('CEV operation idempotence, failure feedback and corrupt legacy rows are safe', async () => {
  const { works, rows } = fixture()
  const row = await works.create('s', 'p', '标题', '正文')
  await works.recordFailure('s', 'p', 5)
  assert.equal((await works.context('s', 'p'))!.lastFailure?.status, 'proposal-not-saved')
  const edit = { baseRevisionId: row.state.head, content: 'A', reason: '修改' }
  const first = await works.propose('s', 'p', edit, 'protagonist', 'script:6', 6)
  assert.deepEqual(await works.propose('s', 'p', edit, 'protagonist', 'script:6', 6), first)
  assert.equal((await works.context('s', 'p'))!.lastFailure, undefined)
  await assert.rejects(works.create('s', 'p', '替换', '覆盖'), /已有共同作品/)
  rows.get(row.id)!.state = {} as any
  await assert.rejects(works.read('s', 'p'), /形状不兼容/)
  assert.deepEqual(rows.get(row.id)!.state, {})
})

test('CEV bounded full-text proposals preserve literal source and reject oversized drafts', () => {
  const content = '  原文\n\n保留标点。  '
  assert.equal(parseWorkEdit({ content, baseRevisionId: 'r', reason: '保留' }).content, content)
  for (const input of [null, {}, { content: 'x'.repeat(8001), baseRevisionId: 'r', reason: 'x' }]) assert.throws(() => parseWorkEdit(input))
})


