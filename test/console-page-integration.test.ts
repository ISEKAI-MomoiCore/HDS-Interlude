import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as vue from 'vue'
import { createI18n } from 'vue-i18n'
import ts from 'typescript'
import { Client } from '@koishijs/console'
import { Context } from 'koishi'
import { Config } from '../src/index'
import { installHdsiConsole } from '../src/console'
import { applyConfigSectionPatch, readConfigCenter } from '../src/console/config-center'

// Compile the real SFCs and the installed Koishi Schema form. Only the Console
// transport and DOM-dependent Element controls are replaced by in-memory hosts.
const root = resolve('.')
const req = createRequire(resolve('package.json'))
const state: any = { route: vue.reactive({ params: { page: 'overview' } }) }
;(globalThis as any).__HDSI_CONSOLE_RENDER_TEST__ = state
let vite: any, Center: any, Shell: any, FormPlugin: any
before(async () => {
  const { createServer } = await import('vite')
  const { default: pluginVue } = await import('@vitejs/plugin-vue')
  const { default: yaml } = await import('@maikolib/vite-plugin-yaml')
  const vuePlugin: any = pluginVue()
  const transform = typeof vuePlugin.transform === 'function' ? vuePlugin.transform : vuePlugin.transform.handler
  vuePlugin.transform = function (code: string, id: string, options: any) {
    return transform.call(this, code, id, { ...options, ssr: false })
  }
  const form = req.resolve('@koishijs/components').replaceAll('\\', '/').replace(/index\.ts$/, 'form/index.ts')
  vite = await createServer({
    root, configFile: false, logLevel: 'error',
    resolve: { alias: { '@koishijs/client': 'virtual:hdsi-test-client', 'vue-router': 'virtual:hdsi-test-router' } },
    plugins: [{
      name: 'hdsi-test-no-styles', enforce: 'pre',
      load(id) { if (/\.(?:css|scss)(?:\?|$)|[?&]type=style/.test(id)) return '' },
    }, {
      name: 'hdsi-test-host', enforce: 'pre',
      resolveId(id) { if (id.startsWith('virtual:hdsi-test-')) return id },
      load(id) {
        if (id === 'virtual:hdsi-test-client') return `export { Schema, SchemaBase } from ${JSON.stringify(form)}; export const send = (...args) => globalThis.__HDSI_CONSOLE_RENDER_TEST__.send(...args);`
        if (id === 'virtual:hdsi-test-router') return 'export const useRoute = () => globalThis.__HDSI_CONSOLE_RENDER_TEST__.route; export const onBeforeRouteLeave = () => {}; export const onBeforeRouteUpdate = () => {};'
      },
    }, vuePlugin, yaml()],
    server: { middlewareMode: true, hmr: false },
    ssr: { noExternal: ['@koishijs/components', 'schemastery-vue'], external: ['vue', 'vue-i18n', 'element-plus', '@vueuse/core'] },
  })
  FormPlugin = (await vite.ssrLoadModule(form)).default
  Center = (await vite.ssrLoadModule('/client/src/pages/ConfigCenterPage.vue')).default
  Shell = (await vite.ssrLoadModule('/client/src/HdsiApp.vue')).default
})
after(async () => { await vite?.close(); delete (globalThis as any).__HDSI_CONSOLE_RENDER_TEST__ })

type Node = { tag: string, text: string, children: Node[], parent: Node | null, props: Record<string, any>, style: Record<string, any> }
const node = (tag: string, text = ''): Node => ({ tag, text, children: [], parent: null, props: {}, style: {}, addEventListener() {}, removeEventListener() {} } as Node)
const renderer = vue.createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  patchProp: (el, key, _prev, value) => { el.props[key] = value },
  insert(el, parent, anchor = null) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, el); el.parent = parent
  },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null },
})
const all = (el: Node): Node[] => [el, ...el.children.flatMap(all)]
const text = (el: Node): string => el.tag === '#comment' ? '' : el.text + el.children.map(text).join('')
async function until(predicate: () => boolean) {
  const end = Date.now() + 5000
  while (!predicate() && Date.now() < end) { await new Promise(resolve => setTimeout(resolve, 10)); await vue.nextTick() }
  assert.ok(predicate(), 'rendered state did not become ready')
}
function mount(component: any) {
  const tree = node('root'), errors: unknown[] = []
  const app = renderer.createApp(component, { overview: {} })
  app.config.errorHandler = error => { errors.push(error) }
  app.use(FormPlugin)
  app.use(createI18n({ legacy: false, locale: 'zh-CN', missingWarn: false, fallbackWarn: false }))
  app.component('k-layout', { setup(_props, { slots }) { return () => vue.h('div', [slots.header?.(), slots.default?.()]) } })
  app.component('k-markdown', { props: ['source'], render() { return vue.h('p', this.source) } })
  app.component('router-link', { props: ['to'], render() { return vue.h('a', { href: this.to }, this.$slots.default?.()) } })
  for (const name of ['input', 'input-number', 'slider', 'switch', 'checkbox', 'select', 'option', 'radio', 'color-picker', 'date-picker', 'time-picker']) {
    app.component('el-' + name, {
      props: ['modelValue', 'disabled', 'type', 'value'], emits: ['update:modelValue'],
      setup(props, { emit, slots }) { return () => vue.h('control-' + name, { value: props.modelValue, disabled: props.disabled, type: props.type, onChange: (value: unknown) => emit('update:modelValue', value) }, slots.default?.()) },
    })
  }
  for (const name of ['tooltip', 'button', 'dialog', 'collapse-transition']) {
    app.component('el-' + name, { setup(_props, { slots }) { return () => vue.h('div', slots.default?.()) } })
  }
  app.mount(tree)
  return { tree, errors, unmount: () => app.unmount() }
}
function fixture() {
  const config: any = Config({})
  config.research.searchApiKey = 'test-private-key'
  config.research.jev.apiKey = 'test-jev-key'
  const updates: any[] = [], calls: any[] = []
  const host: any = { config, updatePluginConfig(next: any) { updates.push(next); host.config = next } }
  state.send = async (event: string, input?: any) => {
    calls.push({ event, input })
    if (event === 'hdsi/config-center/read') return readConfigCenter(host, Config, input)
    if (event === 'hdsi/config-center/save') return applyConfigSectionPatch(host, Config, input.section, input.patch, input)
    throw new Error('overview unavailable')
  }
  return { host, updates, calls }
}
function field(tree: Node, key: string, control: string): Node {
  const row = all(tree).find(el => String(el.props.class ?? '').split(' ').includes('k-schema-item') && text(all(el).find(item => item.tag === 'h3') ?? node('empty')).includes(key))
  assert.ok(row, `missing field ${key}`)
  const input = all(row).find(el => el.tag === 'control-' + control)
  assert.ok(input, `missing ${control} control for ${key}`)
  return input
}
function click(tree: Node, label: string) {
  const button = all(tree).find(el => ['button', 'a'].includes(el.tag) && text(el).trim() === label)
  assert.ok(button, `missing action ${label}`); button.props.onClick()
}

test('overview RPC is registered, dispatched by the real Console client and enforces read authority', async () => {
  let reads = 0, denied = false
  const overview = { version: 'test' }
  const consoleHost: any = { listeners: {}, addEntry() {}, addListener(event: string, callback: any, options: any) { this.listeners[event] = { callback, ...options } } }
  const ctx: any = { console: consoleHost, plugin() {}, logger: () => ({ warn() {} }), on() {}, get: () => consoleHost, serial: async () => denied, root: { [Context.internal]: {} } }
  installHdsiConsole(ctx, { consoleOverview: async () => { reads++; return overview } } as any, Config)
  assert.equal(consoleHost.listeners['hdsi-overview/get']?.authority, 1)
  const responses: any[] = []
  const client = new Client(ctx, { addEventListener() {}, send: (value: string) => responses.push(JSON.parse(value)) } as any)
  const request = { data: JSON.stringify({ id: 'overview', type: 'hdsi-overview/get', args: [] }) } as any
  await client.receive(request)
  assert.deepEqual(responses[0].body, { id: 'overview', value: overview })
  denied = true; await client.receive(request)
  assert.equal(responses[1].body.error, 'unauthorized'); assert.equal(reads, 1)
})

test('activity icon renders as a Vue 3 SVG with real attributes', () => {
  let icon: any
  const entry: any = { exports: {} }
  const code = ts.transpileModule(readFileSync(resolve(root, 'client/index.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { module: entry, exports: entry.exports, require: (id: string) => id === 'vue' ? vue : id === '@koishijs/client' ? { icons: { register: (_name: string, component: any) => { icon = component } } } : {} })
  entry.exports.default({ page() {} })
  const f = mount(icon)
  try {
    assert.deepEqual(f.errors, [])
    const svg = all(f.tree).find(el => el.tag === 'svg')!
    assert.ok(svg); assert.equal(svg.props.viewBox, '0 0 24 24')
    assert.equal(all(svg).find(el => el.tag === 'circle')?.props.cx, '20')
  } finally { f.unmount() }
})

test('real configuration form renders and saves runtime numbers, switches and private/group nested fields', async () => {
  const f = fixture(), view = mount(Center)
  try {
    await until(() => !text(view.tree).includes('读取中') && f.calls.length >= 2)
    assert.deepEqual(view.errors, [])
    field(view.tree, 'contextEntryLimit', 'input-number').props.onChange(30)
    field(view.tree, 'allowProactiveMessages', 'switch').props.onChange(true)
    field(view.tree, 'contextEntryMode', 'select').props.onChange(1)
    field(view.tree, 'conversationFollowUpMinutes[0]', 'input-number').props.onChange(12)
    field(view.tree, 'private.tiers.burst', 'input-number').props.onChange(14)
    await vue.nextTick(); click(view.tree, '保存本节')
    await until(() => f.updates.length === 1)
    assert.equal(f.host.config.runtime.contextEntryLimit, 30)
    assert.equal(f.host.config.runtime.allowProactiveMessages, true)
    assert.equal(f.host.config.runtime.contextEntryMode, 'auto')
    assert.deepEqual(f.host.config.runtime.conversationFollowUpMinutes, [12, 20])
    assert.equal(f.host.config.runtime.contextEntry.private.tiers.burst, 14)
    assert.equal(f.host.config.runtime.contextEntry.group.tiers.burst, 12)
  } finally { view.unmount() }
})

test('real research form renders SearXNG/Jev, preserves masked secrets and saves edited nested credentials', async () => {
  const f = fixture(), view = mount(Center)
  try {
    await until(() => f.calls.length >= 2); click(view.tree, '考据 Agent')
    await until(() => all(view.tree).some(el => el.tag === 'h3' && text(el).includes('searxngBaseUrl')))
    field(view.tree, 'searxngBaseUrl', 'input').props.onChange('http://127.0.0.1:8888')
    field(view.tree, 'searchBackend', 'select').props.onChange(3)
    assert.equal(field(view.tree, 'searchApiKey', 'input').props.type, 'password')
    assert.ok(!text(view.tree).includes('test-private-key'))
    field(view.tree, 'jev.apiKey', 'input').props.onChange('replacement-jev-key')
    field(view.tree, 'jev.enabled', 'switch').props.onChange(true)
    await vue.nextTick(); click(view.tree, '保存本节')
    await until(() => f.updates.length === 1)
    assert.equal(f.host.config.research.searchApiKey, 'test-private-key')
    assert.equal(f.host.config.research.jev.apiKey, 'replacement-jev-key')
    assert.equal(f.host.config.research.jev.enabled, true)
    assert.equal(f.host.config.research.searxngBaseUrl, 'http://127.0.0.1:8888')
    assert.equal(f.host.config.research.searchBackend, 'searxng')
    assert.deepEqual(view.errors, [])
  } finally { view.unmount() }
})

test('configuration menu RPC rejection is visible and retry recovers', async () => {
  const f = fixture(), send = state.send
  let broken = true
  state.send = (event: string, input: any) => broken && event === 'hdsi/config-center/read' ? Promise.reject(new Error('menu unavailable')) : send(event, input)
  const view = mount(Center)
  try {
    await until(() => text(view.tree).includes('menu unavailable'))
    assert.deepEqual(view.errors, [])
    broken = false; click(view.tree, '重试')
    await until(() => f.calls.length >= 2)
    field(view.tree, 'contextEntryLimit', 'input-number')
  } finally { view.unmount() }
})

test('overview failure leaves configuration accessible and offers retry on observation pages', async () => {
  const f = fixture(); state.route.params.page = 'config-center'
  const view = mount(Shell)
  try {
    await until(() => f.calls.some((item: any) => item.event === 'hdsi/config-center/read' && item.input === 'runtime'))
    field(view.tree, 'contextEntryLimit', 'input-number')
    state.route.params.page = 'overview'; await vue.nextTick()
    await until(() => text(view.tree).includes('overview unavailable'))
    state.send = async () => ({ version: 'recovered', story: { found: false }, models: [], switches: [], research: { counters: {}, jev: {} }, density: {} })
    click(view.tree, '重试')
    await until(() => text(view.tree).includes('recovered'))
    assert.deepEqual(view.errors, [])
  } finally { view.unmount() }
})


test('all visible sections render with the installed Schema form, including scalar mainPrompt', async () => {
  const f = fixture(), view = mount(Center)
  try {
    await until(() => f.calls.length >= 2)
    const menu = readConfigCenter(f.host, Config).menu!
    for (const meta of menu.flatMap(group => group.sections)) {
      {
        click(view.tree, meta.label)
        await until(() => f.calls.some((call: any) => call.event === 'hdsi/config-center/read' && call.input === meta.id))
        await until(() => all(view.tree).some(el => el.tag === 'form') && !text(view.tree).includes('读取中'))
      }
      assert.ok(all(view.tree).some(el => el.tag === 'form'), meta.id)
      assert.deepEqual(view.errors, [], meta.id)
    }
    field(view.tree, 'value', 'input').props.onChange('剧本事实与人物行动保持一致。')
    await vue.nextTick(); click(view.tree, '保存并重载')
    await until(() => f.updates.length === 1)
    assert.equal(f.host.config.mainPrompt, '剧本事实与人物行动保持一致。')
    const saved = f.calls.find((call: any) => call.event === 'hdsi/config-center/save')
    assert.equal(saved.input.reload, true)
  } finally { view.unmount() }
})

test('configuration menu RPC tolerates null produced by real Console JSON transport', async () => {
  const consoleHost: any = { listeners: {}, addEntry() {}, addListener(event: string, callback: any, options: any) { this.listeners[event] = { callback, ...options } } }
  const host: any = { config: Config({}), consoleOverview: async () => ({}) }
  const ctx: any = { console: consoleHost, plugin() {}, logger: () => ({ warn() {} }), on() {}, get: () => consoleHost, serial: async () => false, root: { [Context.internal]: {} } }
  installHdsiConsole(ctx, host, Config)
  const responses: any[] = []
  const client = new Client(ctx, { addEventListener() {}, send: (value: string) => responses.push(JSON.parse(value)) } as any)
  await client.receive({ data: JSON.stringify({ id: 'menu', type: 'hdsi/config-center/read', args: [undefined] }) } as any)
  assert.equal(responses[0].body.value.ok, true)
  assert.equal(responses[0].body.value.menu.flatMap((group: any) => group.sections).length, 25)
  assert.equal(responses[0].body.value.schema, undefined)
})
