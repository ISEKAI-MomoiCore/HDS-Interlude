import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as vue from 'vue'
import ts from 'typescript'

function deferred() {
  let resolve!: (value: any) => void, reject!: (value: any) => void
  return { promise: new Promise<any>((a, b) => { resolve = a; reject = b }), resolve: (value: any) => resolve(value), reject: (value: any) => reject(value) }
}
/** Run the actual SFC setup script with real Vue refs; RPC ordering is controlled.
 * Template/schema rendering remains covered by the production frontend build. */
function page(center: boolean) {
  const reads: any[] = [], saves: any[] = [], unmount: Array<() => void> = [], guards: Array<{ kind: string, fn: (...args: any[]) => boolean }> = []
  let confirmAnswer = true
  const read = (id: string) => { const ticket = { id, ...deferred() }; reads.push(ticket); return ticket.promise }
  const save = (id: string, values: any) => { const ticket = { id, values, ...deferred() }; saves.push(ticket); return ticket.promise }
  const store = { readConfigCenter: read, readConfig: read, saveConfigCenter: save, saveConfig: save }
  const path = `client/src/pages/${center ? 'ConfigCenterPage' : 'ConfigPage'}.vue`
  const raw = readFileSync(resolve(process.env.HDSI_CONFIG_REGRESSION_BASELINE ?? '.', path), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const exposed = ['loadSection', 'saveSection', 'loading', 'saving', 'notice', 'noticeKind', ...(center ? ['currentId', 'model', 'initial', 'sectionSchema', 'menu'] : ['section', 'form', 'storyMissing'])]
  const script = ts.transpileModule(raw + `\nexport const testApi = { ${exposed.join(', ')} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: any = {}
  runInNewContext(script, { exports, defineOptions: () => {}, defineProps: () => ({}), window: { confirm: () => confirmAnswer },
    require: (name: string) => name === 'vue' ? { ...vue, onMounted: () => {}, onUnmounted: (fn: () => void) => unmount.push(fn) }
      : name === 'vue-router' ? { onBeforeRouteLeave(fn: any) { guards.push({ kind: 'leave', fn }) }, onBeforeRouteUpdate(fn: any) { guards.push({ kind: 'update', fn }) } } : name === '../store' ? { store } : name === '@koishijs/client' ? { Schema: class { constructor(public raw: any) {} } } : {},
  }, { filename: path })
  const api = exports.testApi
  if (center) api.menu.value = [{ id: 'test', sections: [{ id: 'story', stage: 1, label: 'Story' }, { id: 'research', stage: 1, label: 'Research' }] }]
  const values = () => center ? api.model.value : api.form
  const success = (values: any) => ({ ok: true, values, schema: { type: 'object' }, maskedFields: [] })
  const load = async (id: string, values: any) => { const pending = api.loadSection(id); reads[reads.length - 1].resolve(success(values)); await pending }
  return { api, reads, saves, values, success, load, guards, setConfirm: (value: boolean) => { confirmAnswer = value }, unmount: () => unmount.forEach(fn => fn()) }
}
for (const center of [true, false]) {
  const label = center ? 'ConfigCenter' : 'ConfigPage'
  const nextId = center ? 'research' : 'story'
  const nextValues = center ? { enabled: true } : { world: '第二世界' }
  const assertNext = (f: ReturnType<typeof page>) => center ? assert.equal(f.values().enabled, true) : assert.equal(f.values().world, '第二世界')
  test(`F13 ${label} latest section wins reversed read responses`, async () => {
    const f = page(center), a = f.api.loadSection('story'), b = f.api.loadSection(nextId)
    f.reads[1].resolve(f.success(nextValues)); await b
    f.reads[0].resolve(f.success({ world: '第一世界' })); await a
    assertNext(f)
    if (center) assert.ok(!('world' in f.values()))
    assert.equal(f.api.loading.value, false)
  })
  test(`F13 ${label} stale read finally cannot stop the current loading state`, async () => {
    const f = page(center), a = f.api.loadSection('story'), b = f.api.loadSection(nextId)
    f.reads[0].resolve(f.success({ world: '第一世界' })); await a
    assert.equal(f.api.loading.value, true)
    assert.deepEqual(Object.keys(f.values()), [])
    f.reads[1].resolve(f.success(nextValues)); await b
  })
  test(`F13 ${label} stale read error cannot replace current success notice or form`, async () => {
    const f = page(center), a = f.api.loadSection('story'), b = f.api.loadSection(nextId)
    f.reads[1].resolve(f.success(nextValues)); await b
    f.reads[0].reject(new Error('stale failure')); await a
    assert.equal(f.api.notice.value, '')
    assertNext(f)
  })
  for (const reject of [true, false]) test(`F13 ${label} failed current load blocks stale-form saving (reject=${reject})`, async () => {
    const f = page(center); await f.load('story', { world: '测试世界' })
    const pending = f.api.loadSection(nextId)
    if (reject) f.reads[1].reject(new Error('current failure'))
    else f.reads[1].resolve({ ok: false, error: 'current failure' })
    await pending
    assert.equal(f.api.loading.value, false)
    const saving = f.api.saveSection()
    assert.equal(f.saves.length, 0)
    await saving
    assert.ok(!('world' in f.values()))
  })
  test(`F13 ${label} saving is blocked until current read succeeds`, async () => {
    const f = page(center), pending = f.api.loadSection('story')
    const saving = f.api.saveSection()
    assert.equal(f.saves.length, 0)
    await saving
    f.reads[0].resolve(f.success({ world: '测试世界' })); await pending
  })
  for (const error of [false, true]) test(`F13 ${label} save receipt stays with original view (error=${error})`, async () => {
    const f = page(center); await f.load('story', { world: '测试世界' })
    const saving = f.api.saveSection()
    assert.equal(f.saves[0].id, 'story')
    await f.load(nextId, nextValues)
    if (error) f.saves[0].reject(new Error('old save error'))
    else f.saves[0].resolve({ ok: true, applied: 1 })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.reads.length, 2, 'old save does not reload newly selected section')
    await saving
    assert.equal(f.api.notice.value, '')
    assertNext(f)
    assert.equal(f.api.saving.value, false)
  })
  test(`F13 ${label} returning to same section retires old save view token`, async () => {
    const f = page(center); await f.load('story', { world: '测试世界' })
    const saving = f.api.saveSection()
    await f.load(nextId, nextValues); await f.load('story', { world: '第二世界' })
    f.saves[0].resolve({ ok: true, applied: 1 }); await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.reads.length, 3)
    await saving
    assert.equal(f.values().world, '第二世界')
    assert.equal(f.api.notice.value, '')
  })
  test(`F13 ${label} unmount retires pending reads`, async () => {
    const f = page(center), pending = f.api.loadSection('story')
    f.unmount(); f.reads[0].resolve(f.success({ world: '第九世界' })); await pending
    assert.ok(!('world' in f.values()))
  })
}

test('F13 ConfigCenter save captures deep snapshot, preserves newer edits and ignores repeat clicks', async () => {
  const f = page(true); await f.load('story', { world: '测试世界', nested: { value: 'saved' } })
  const saving = f.api.saveSection()
  f.values().nested.value = 'edited later'; f.values().world = 99
  assert.equal(f.saves[0].values.world, '测试世界')
  assert.equal(f.saves[0].values.nested.value, 'saved')
  const duplicate = f.api.saveSection(); assert.equal(f.saves.length, 1); await duplicate
  f.saves[0].resolve({ ok: true }); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.reads.length, 1, 'a refresh cannot overwrite edits made during save')
  await saving
  assert.equal(f.values().nested.value, 'edited later')
  assert.equal(f.values().world, 99)
  assert.equal(f.api.initial.value.nested.value, 'saved')
  assert.equal(f.api.saving.value, false)
})

test('F13 ConfigCenter failed post-save refresh leaves form unready and explains failure', async () => {
  const f = page(true); await f.load('story', { world: '测试世界' })
  const saving = f.api.saveSection(); f.saves[0].resolve({ ok: true }); await new Promise(resolve => setImmediate(resolve))
  f.reads[1].resolve({ ok: false, error: 'refresh failed' }); await saving
  assert.equal(f.api.noticeKind.value, 'warn')
  assert.match(f.api.notice.value, /refresh failed/)
  const next = f.api.saveSection(); assert.equal(f.saves.length, 1); await next
})


test('F13 ConfigCenter unchanged submitted form refreshes normalized values after success', async () => {
  const f = page(true); await f.load('story', { world: '测试世界' })
  const saving = f.api.saveSection(); f.saves[0].resolve({ ok: true }); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.reads[1].id, 'story')
  assert.equal(f.api.loading.value, true)
  f.reads[1].resolve(f.success({ world: '第二世界' })); await saving
  assert.equal(f.values().world, '第二世界')
  assert.equal(f.api.noticeKind.value, 'ok')
})

test('F13 ConfigCenter post-save refresh returning after section switch stays retired', async () => {
  const f = page(true); await f.load('story', { world: '测试世界' })
  const saving = f.api.saveSection(); f.saves[0].resolve({ ok: true }); await new Promise(resolve => setImmediate(resolve))
  await f.load('research', { enabled: true })
  f.reads[1].resolve(f.success({ world: '第九世界' })); await saving
  assert.equal(f.values().enabled, true)
  assert.ok(!('world' in f.values()))
  assert.equal(f.api.notice.value, '')
})

for (const center of [true, false]) {
  const label = center ? 'ConfigCenter' : 'ConfigPage'
  const nextId = center ? 'research' : 'story'
  const nextValues = center ? { enabled: true } : { world: '第二世界' }
  const assertNext = (f: ReturnType<typeof page>) => center ? assert.equal(f.values().enabled, true) : assert.equal(f.values().world, '第二世界')
  test(`F13 ${label} read A-B-A keeps newest request even when section id matches`, async () => {
    const f = page(center), first = f.api.loadSection('story')
    await f.load(nextId, nextValues); await f.load('story', { world: '第二世界' })
    f.reads[0].resolve(f.success({ world: '过期响应' })); await first
    assert.equal(f.values().world, '第二世界')
  })
  test(`F13 ${label} unmounted save receipt starts no refresh`, async () => {
    const f = page(center); await f.load('story', { world: '测试世界' })
    const saving = f.api.saveSection(); f.unmount(); f.saves[0].resolve({ ok: true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.reads.length, 1)
    await saving
    assert.equal(f.api.notice.value, '')
  })
}

test('F13 ConfigPage captures submitted primitive values and rejects duplicate save clicks', async () => {
  const f = page(false); await f.load('story', { world: '测试世界' })
  const saving = f.api.saveSection(); f.values().world = 99
  const duplicate = f.api.saveSection()
  assert.equal(f.saves.length, 1)
  assert.equal(f.saves[0].values.world, '测试世界')
  f.saves[0].resolve({ ok: true, applied: 1 }); await Promise.all([saving, duplicate])
  assert.equal(f.values().world, 99)
})


test('F13 ConfigPage distinguishes missing active story from a failed story read', async () => {
  const f = page(false)
  assert.equal(f.api.storyMissing(), false)
  await f.load('story', {})
  assert.equal(f.api.storyMissing(), true)
  const pending = f.api.loadSection('story'); f.reads[1].reject(new Error('transport unavailable')); await pending
  assert.equal(f.api.storyMissing(), false)
  assert.match(f.api.notice.value, /transport unavailable/)
})


for (const center of [true, false]) test(`${center ? '配置中心' : '当前故事'}在共享路由的页签切换时保护未保存内容`, async () => {
  const f = page(center); await f.load('story', { world: '保存值' })
  const update = f.guards.find(guard => guard.kind === 'update')!.fn
  const leave = f.guards.find(guard => guard.kind === 'leave')!.fn
  f.setConfirm(false)
  assert.equal(update({ path: '/hdsi/overview' }, { path: '/hdsi/config' }), true)
  f.values().world = '尚未保存的修改'
  assert.equal(leave(), false)
  assert.equal(update({ path: '/hdsi/overview' }, { path: '/hdsi/config' }), false)
  assert.equal(update({ path: '/hdsi/config' }, { path: '/hdsi/config' }), true)
  f.setConfirm(true)
  assert.equal(leave(), true)
})
