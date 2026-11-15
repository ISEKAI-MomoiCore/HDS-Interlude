import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as vue from 'vue'
import ts from 'typescript'

function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void
  const promise = new Promise<any>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function actions() {
  const reads: any[] = [], unmount: Array<() => void> = [], calls: string[] = []
  const raw = readFileSync('client/src/pages/ActionsPage.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const code = ts.transpileModule(raw + '\nexport const api = { openDetail, fetchDetail, operate, detail, detailLoading, operating, error, feedback, selectedId };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: any = {}
  runInNewContext(code, { exports, defineOptions() {}, require: (id: string) => id === 'vue'
    ? { ...vue, onMounted() {}, onUnmounted(fn: () => void) { unmount.push(fn) } }
    : id === '../store' ? { store: {
      actionDetail(id: string) { const ticket = { id, ...deferred() }; reads.push(ticket); return ticket.promise },
      async actionsList() { calls.push('list'); return { rows: [{ id: 'latest' }], total: 1 } },
    } } : {} })
  return { api: exports.api, reads, calls, unmount: () => unmount.forEach(fn => fn()) }
}

test('通信详情：逆序完成和旧请求报错均不会替换最新动作', async () => {
  const f = actions(), first = f.api.openDetail('first'), second = f.api.openDetail('second')
  f.reads[1].resolve({ id: 'second', segments: [] }); await second
  f.reads[0].reject(new Error('stale error')); await first
  assert.equal(f.api.detail.value.id, 'second')
  assert.equal(f.api.error.value, '')
  assert.equal(f.api.detailLoading.value, false)
})

test('通信详情：折叠与卸载使未完成请求失效', async () => {
  const f = actions(), first = f.api.openDetail('first')
  await f.api.openDetail('first')
  f.reads[0].resolve({ id: 'first', segments: [] }); await first
  assert.equal(f.api.detail.value, null)
  assert.equal(f.api.selectedId.value, '')
  const second = f.api.openDetail('second'); f.unmount()
  f.reads[1].resolve({ id: 'second', segments: [] }); await second
  assert.equal(f.api.detail.value, null)
})

test('通信管理：失败和零变更都有反馈，重复操作只提交一次', async () => {
  const f = actions()
  await f.api.operate(async () => ({ ok: false, changed: 0, reason: 'not-found' }))
  assert.match(f.api.error.value, /记录已移除/)
  assert.equal(f.api.feedback.value, '')
  await f.api.operate(async () => ({ ok: true, changed: 0, reason: 'nothing-unknown' }))
  assert.match(f.api.feedback.value, /没有待核实/)
  assert.deepEqual(f.calls, [])
  const ticket = deferred()
  const pending = f.api.operate(() => ticket.promise)
  let repeated = 0
  await f.api.operate(async () => { repeated++; return { ok: true, changed: 0, reason: '' } })
  assert.equal(repeated, 0)
  ticket.resolve({ ok: true, changed: 0, reason: 'nothing-pending' }); await pending
  assert.equal(f.api.operating.value, false)
})


test('通信详情读取失败后重试成功会清除旧错误', async () => {
  const f = actions(), first = f.api.openDetail('first')
  f.reads[0].reject(new Error('transport failure')); await first
  assert.match(f.api.error.value, /transport failure/)
  const retry = f.api.fetchDetail('first')
  f.reads[1].resolve({ id: 'first', segments: [] }); await retry
  assert.equal(f.api.detail.value.id, 'first')
  assert.equal(f.api.error.value, '')
})
