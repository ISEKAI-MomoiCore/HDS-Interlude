import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'

/** 原型宿主（无类字段）：consoleReadConfig/consoleSaveConfig 只依赖
 * config、getCanonicalStory、updateSetting 与两个缓存槽，均可注入。 */
function host(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ story: unknown, patch: Record<string, unknown> }> = []
  const target: any = Object.create(InterludeService.prototype)
  target.config = {
    runtime: { contextEntryLimit: 18, contextTimeWindowMinutes: 5, allowProactiveMessages: false },
  }
  target.getCanonicalStory = async () => undefined
  target.updateSetting = async (story: unknown, patch: Record<string, unknown>) => {
    calls.push({ story, patch })
    return story
  }
  Object.assign(target, overrides)
  return { target, calls }
}

const story = { id: 'story-1', setting: { character: { name: '小夜', traits: ['安静', '爱看书'] }, world: '海边小镇', timezone: 'Asia/Shanghai' } }

test('consoleReadConfig: runtime 节回填默认值', async () => {
  const { target } = host()
  const result = await target.consoleReadConfig('runtime')
  assert.equal(result.ok, true)
  assert.equal(result.values.contextEntryLimit, 18)
  assert.equal(result.values.contextEntryMode, 'fixed')
  assert.equal(result.values.userMessageDebounceSeconds, 3)
})

test('consoleReadConfig: story 节把 traits 数组渲染为换行文本', async () => {
  const { target } = host({ getCanonicalStory: async () => story })
  const result = await target.consoleReadConfig('story')
  assert.equal(result.ok, true)
  assert.equal(result.values['character.name'], '小夜')
  assert.equal(result.values['character.traits'], '安静\n爱看书')
  assert.equal(result.values.timezone, 'Asia/Shanghai')
})

test('consoleReadConfig: 无活跃故事返回空 values 而非错误', async () => {
  const { target } = host()
  const result = await target.consoleReadConfig('story')
  assert.deepEqual(result, { ok: true, values: {} })
})

test('consoleReadConfig: 未知节报错', async () => {
  const { target } = host()
  const result = await target.consoleReadConfig('nope')
  assert.equal(result.ok, false)
  assert.match(result.error, /未知节/)
})

test('consoleSaveConfig: runtime 节写入 config 并清 contextEntry 缓存', async () => {
  const { target } = host()
  target.cachedContextEntryConfig = { mode: 'fixed' }
  const result = await target.consoleSaveConfig('runtime', { contextEntryLimit: 30, contextEntryMode: 'auto', evil: 'x' })
  assert.deepEqual(result, { ok: true, applied: 2 })
  assert.equal(target.config.runtime.contextEntryLimit, 30)
  assert.equal(target.config.runtime.contextEntryMode, 'auto')
  assert.equal((target.config.runtime as any).evil, undefined)
  assert.equal(target.cachedContextEntryConfig, undefined)
})

test('consoleSaveConfig: research 节在缺省 config.research 上落键并清缓存', async () => {
  const { target } = host()
  target.cachedResearchConfig = { enabled: false } as never
  const result = await target.consoleSaveConfig('research', { enabled: true, searchBackend: 'tavily', maxRounds: 2 })
  assert.deepEqual(result, { ok: true, applied: 3 })
  assert.equal(target.config.research.enabled, true)
  assert.equal(target.config.research.searchBackend, 'tavily')
  assert.equal(target.cachedResearchConfig, undefined)
})

test('consoleSaveConfig: story 节经 updateSetting 落库，traits 文本转数组', async () => {
  const { target, calls } = host({ getCanonicalStory: async () => story })
  const result = await target.consoleSaveConfig('story', {
    'character.name': '小昼',
    'character.traits': '开朗\n\n夜行\n',
    'world': '山间小镇',
    'not.in.whitelist': 'x',
  })
  assert.deepEqual(result, { ok: true, applied: 3 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].patch.character.name, '小昼')
  assert.deepEqual(calls[0].patch.character.traits, ['开朗', '夜行'])
  assert.equal(calls[0].patch.world, '山间小镇')
  assert.equal(calls[0].patch.not, undefined)
})

test('consoleSaveConfig: 无活跃故事时 story 节拒绝写入', async () => {
  const { target, calls } = host()
  const result = await target.consoleSaveConfig('story', { world: 'x' })
  assert.equal(result.ok, false)
  assert.match(result.error, /没有活跃故事/)
  assert.equal(calls.length, 0)
})

test('consoleSaveConfig: 非对象 values 与未知节均报错', async () => {
  const { target } = host()
  assert.equal((await target.consoleSaveConfig('runtime', undefined as never)).ok, false)
  assert.match((await target.consoleSaveConfig('nope', {})).error, /未知节/)
})

test('addEntry 的 bundle 路径指向随包发布的 client-dist（回归防线）', () => {
  // ../client/ 只有源码（ts/vue），安装环境 require.resolve 必抛
  // MODULE_NOT_FOUND 并被 try/catch 吞掉——Console 页面会整个不出现。
  const source = require('node:fs').readFileSync('src/console/index.ts', 'utf8')
  assert.ok(source.includes("require.resolve('../client-dist/hdsi-console.js')"), 'addEntry 指向 client-dist')
  assert.ok(!source.includes("require.resolve('../client/hdsi-console.js')"), '不再指向源码目录 client/')
  const exists = require('node:fs').existsSync('client-dist/hdsi-console.js')
  assert.ok(exists, 'client-dist/hdsi-console.js 存在（先在 client/ 目录跑 vite build）')
})
