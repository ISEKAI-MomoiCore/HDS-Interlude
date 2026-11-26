import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from 'cordis'
import { Context } from 'koishi'
import { Config } from '../src/index'
import { InterludeService } from '../src/service'
import { CONFIG_CENTER_MENU, CONFIG_CENTER_SECRET_MASK, isOpenConfigCenterSection } from '../src/console/contract'
import { applyConfigSectionPatch, readConfigCenter, serializeConfigSection } from '../src/console/config-center'

/** 配置中心 P1 测试：菜单树与 Config 键集的对齐、Schema 序列化往返、
 * 读取掩码与保存管线（哨兵跳过 / 深合并 / 预校验拒绝）。
 * 设计与验收项见 docs/CONSOLE_CONFIG_CENTER_DESIGN.md §9 P1。 */

const menuSectionIds = () => CONFIG_CENTER_MENU.flatMap(group => group.sections.map(section => section.id))

/** 解析一份全默认配置（Config({}) 即 schema 解析空输入）。 */
const resolvedConfig: Record<string, any> = (Config as any)({})

test('菜单树覆盖全部可见配置节（隐藏节除外），新增配置节忘挂菜单时此处变红', () => {
  const visibleKeys = Object.keys((Config as any).dict).filter(key => key !== 'chatRhythm')
  const ids = menuSectionIds()
  assert.equal(new Set(ids).size, ids.length, '菜单节 id 不得重复')
  assert.deepEqual([...new Set(ids)].sort(), [...visibleKeys].sort())
})

test('全部可见节开放编辑，隐藏兼容节和未知节拒绝访问', () => {
  for (const id of menuSectionIds()) assert.equal(isOpenConfigCenterSection(id), true, id)
  assert.equal(isOpenConfigCenterSection('chatRhythm'), false)
  assert.equal(isOpenConfigCenterSection('nope'), false)
})

test('每个菜单节的 Schema 都能经 {uid, refs} JSON 往返（P1 验收：防传输退化）', () => {
  for (const id of menuSectionIds()) {
    const original = (Config as any).dict[id]
    const revived = new (Schema as any)(serializeConfigSection(Config, id))
    assert.ok(revived, id)
    assert.equal(revived.type, original.type === 'string' ? 'object' : original.type, `节 ${id} 往返后 type 应一致`)
    if (original.dict) {
      assert.deepEqual(
        Object.keys(revived.dict).sort(),
        Object.keys(original.dict).filter(key => !(id === 'model' && ['fixedPrompt', 'formatPrompt', 'stylePrompt'].includes(key)) && !(id === 'storyDefaults' && key === 'style')).sort(),
        `节 ${id} 往返后字段集应一致`,
      )
    }
    if (original.list) {
      assert.equal(Array.isArray(revived.list), true, `节 ${id} 的数组 schema 往返后仍为数组`)
    }
  }
  // 抽查：默认值与描述文案完整保留（客户端渲染依赖）。
  const runtime = new (Schema as any)(serializeConfigSection(Config, 'runtime'))
  assert.equal(runtime.dict.contextEntryLimit.meta.default, 18)
  assert.equal(typeof runtime.dict.contextEntryLimit.meta.description, 'string')
  assert.ok(runtime.dict.contextEntryLimit.meta.description.length > 0)
})

test('readConfigCenter: 无参只返回菜单；开放节附带 schema 与当前值', () => {
  const host = { config: resolvedConfig } as unknown as InterludeService
  const menuOnly = readConfigCenter(host, Config)
  assert.equal(menuOnly.ok, true)
  assert.ok(menuOnly.menu!.length >= 7)
  assert.equal(menuOnly.schema, undefined)

  const runtime = readConfigCenter(host, Config, 'runtime')
  assert.equal(runtime.ok, true)
  assert.ok(runtime.schema)
  assert.equal(runtime.values!.contextEntryLimit, resolvedConfig.runtime.contextEntryLimit)
  assert.equal(runtime.values!.contextEntryMode, resolvedConfig.runtime.contextEntryMode)
})

test('运行时配置页说明私聊首泡、打字上限与打断范围，不暴露模型的逐泡字段', () => {
  const host = { config: resolvedConfig } as unknown as InterludeService
  const result = readConfigCenter(host, Config, 'runtime')
  assert.equal(result.ok, true)
  const fields = new (Schema as any)(result.schema).dict
  assert.match(fields.typingBaseDelaySeconds.meta.description, /首个气泡/)
  assert.match(fields.typingMaxDelaySeconds.meta.description, /不限制模型/)
  assert.match(fields.cancelDelayedRepliesOnUserMessage.meta.description, /无论此项是否开启.*打断.*首泡/)
  assert.equal(fields.bubbleDelaySeconds, undefined)
  assert.equal(result.values!.bubbleDelaySeconds, undefined)
})

test('readConfigCenter: 空参数只读菜单，未知节返回错误且仍随菜单', () => {
  const host = { config: resolvedConfig } as unknown as InterludeService
  for (const section of [null, undefined, '']) {
    const result = readConfigCenter(host, Config, section)
    assert.equal(result.ok, true)
    assert.ok(result.menu)
    assert.equal(result.schema, undefined)
  }
  assert.equal(readConfigCenter(host, Config, 'storyDefaults').ok, true)
  const unknown = readConfigCenter(host, Config, 'nope')
  assert.equal(unknown.ok, false)
  assert.match(unknown.error!, /未知配置节/)
})

test('readConfigCenter: research 密钥字段掩码返回并列入 maskedFields', () => {
  const host = {
    config: { ...resolvedConfig, research: { ...resolvedConfig.research, searchApiKey: 'sk-secret' } },
  } as unknown as InterludeService
  const result = readConfigCenter(host, Config, 'research')
  assert.equal(result.ok, true)
  assert.equal(result.values!.searchApiKey, CONFIG_CENTER_SECRET_MASK)
  assert.deepEqual(result.maskedFields, ['searchApiKey'])
})

function pipelineHost(config: Record<string, any>) {
  const updates: Record<string, any>[] = []
  const host = {
    config,
    updatePluginConfig: (merged: Record<string, any>) => updates.push(merged),
  } as unknown as InterludeService
  return { host, updates }
}

test('applyConfigSectionPatch: 合并 patch 后整树 scope.update（未动字段与其它节原样保留）', () => {
  const { host, updates } = pipelineHost(resolvedConfig)
  const result = applyConfigSectionPatch(host, Config, 'runtime', { contextEntryLimit: 25 })
  assert.equal(result.ok, true)
  assert.equal(updates.length, 1)
  const merged = updates[0]
  assert.equal(merged.runtime.contextEntryLimit, 25)
  assert.equal(merged.runtime.contextTimeWindowMinutes, resolvedConfig.runtime.contextTimeWindowMinutes, '未提及字段保留现值')
  assert.equal(merged.model, resolvedConfig.model, '其它节按引用原样传递')
})

test('applyConfigSectionPatch: 密钥哨兵跳过合并，真实密钥不被掩码覆盖', () => {
  const config = { ...resolvedConfig, research: { ...resolvedConfig.research, searchApiKey: 'sk-secret' } }
  const { host, updates } = pipelineHost(config)
  const result = applyConfigSectionPatch(host, Config, 'research', {
    searchApiKey: CONFIG_CENTER_SECRET_MASK,
    enabled: true,
  })
  assert.equal(result.ok, true)
  assert.equal(updates[0].research.searchApiKey, 'sk-secret')
  assert.equal(updates[0].research.enabled, true)
})

test('applyConfigSectionPatch: 校验失败不落盘并返回字段路径', () => {
  const { host, updates } = pipelineHost(resolvedConfig)
  const result = applyConfigSectionPatch(host, Config, 'runtime', { contextEntryLimit: 9999 })
  assert.equal(result.ok, false)
  assert.match(result.error!, /contextEntryLimit/)
  assert.equal(updates.length, 0, '校验失败不得触达 scope.update')
})

test('applyConfigSectionPatch: 隐藏节 / 未知节 / 非对象 patch 均拒绝', () => {
  const { host, updates } = pipelineHost(resolvedConfig)
  assert.match(applyConfigSectionPatch(host, Config, 'chatRhythm', {}).error!, /未知配置节/)
  assert.match(applyConfigSectionPatch(host, Config, 'nope', {}).error!, /未知配置节/)
  assert.match(applyConfigSectionPatch(host, Config, 'runtime', undefined as never).error!, /invalid patch/)
  assert.equal(updates.length, 0)
})


test('全部 25 节可读写且主提示词采用对象表单', () => {
  for (const id of menuSectionIds()) {
    const { host, updates } = pipelineHost(resolvedConfig)
    const read = readConfigCenter(host, Config, id)
    assert.equal(read.ok, true, id)
    assert.equal(applyConfigSectionPatch(host, Config, id, read.values!).ok, true, id)
    assert.equal(updates.length, 1, id)
    assert.deepEqual(updates[0][id], resolvedConfig[id], id)
  }
  const { host, updates } = pipelineHost(resolvedConfig)
  assert.equal(applyConfigSectionPatch(host, Config, 'mainPrompt', { value: '以剧本事实推进写作。' }).ok, true)
  assert.equal(updates[0].mainPrompt, '以剧本事实推进写作。')
})

test('模型列表密钥全部掩码，按 ID 重排与删除后仍对应原连接', () => {
  const config: any = Config({ model: { providers: [
    { id: 'first', apiKey: 'first-secret' }, { id: 'second', apiKey: 'second-secret' },
  ] } })
  const { host, updates } = pipelineHost(config)
  const read = readConfigCenter(host, Config, 'model')
  const rows = read.values!.providers as any[]
  assert.equal(rows[0].apiKey, CONFIG_CENTER_SECRET_MASK)
  assert.equal(rows[1].apiKey, CONFIG_CENTER_SECRET_MASK)
  assert.ok(!JSON.stringify(read).includes('first-secret'))
  assert.equal(config.model.providers[0].apiKey, 'first-secret')
  assert.equal(applyConfigSectionPatch(host, Config, 'model', { ...read.values, providers: [rows[1], rows[0]] }).ok, true)
  assert.deepEqual(updates[0].model.providers.map((row: any) => row.apiKey), ['second-secret', 'first-secret'])
  assert.equal(applyConfigSectionPatch(host, Config, 'model', { providers: [rows[1]] }).ok, true)
  assert.equal(updates[1].model.providers[0].apiKey, 'second-secret')
  assert.equal(applyConfigSectionPatch(host, Config, 'model', { providers: [{ ...rows[0], id: 'new' }] }).ok, false)
})

test('列表字段重置、嵌套字段重置与强制重载被完整提交', () => {
  const config: any = Config({ model: { providers: [{ id: 'first', apiKey: 'secret', temperature: 1.1 }] } })
  let next: any, reload: boolean | undefined
  const host = { config, updatePluginConfig(value: any, force: boolean) { next = value; reload = force } } as any
  const read = readConfigCenter(host, Config, 'model')
  const rows = read.values!.providers as any[]
  delete rows[0].temperature
  assert.equal(applyConfigSectionPatch(host, Config, 'model', read.values!, { reload: true }).ok, true)
  assert.equal(next.model.providers[0].temperature, undefined)
  assert.equal(next.model.providers[0].apiKey, 'secret')
  assert.equal(reload, true)
  config.runtime.contextEntry.private.mode = 'auto'
  assert.equal(applyConfigSectionPatch(host, Config, 'runtime', {}, { unset: ['contextEntry.private.mode'] }).ok, true)
  assert.equal(next.runtime.contextEntry.private.mode, undefined)
  assert.equal(config.runtime.contextEntry.private.mode, 'auto', 'reset must not mutate live config')
  assert.equal(applyConfigSectionPatch(host, Config, 'runtime', { contextEntryLimit: 9999 }, { unset: ['contextEntry.private.mode'] }).ok, false)
  assert.equal(config.runtime.contextEntry.private.mode, 'auto')
  assert.equal(applyConfigSectionPatch(host, Config, 'runtime', []).ok, false)
  assert.equal(applyConfigSectionPatch(host, Config, 'runtime', {}, { unset: ['__proto__.polluted'] }).ok, false)
})


test('无 ID 的旧模型连接在表单重排与删除后仍保留各自密钥', () => {
  const config: any = Config({ model: { providers: [
    { label: 'First', model: 'chat', apiKey: 'first-key' },
    { label: 'Second', model: 'chat', apiKey: 'second-key' },
  ] } })
  const { host, updates } = pipelineHost(config)
  const read = readConfigCenter(host, Config, 'model')
  const rows = read.values!.providers as any[]
  assert.deepEqual(rows.map(row => row.id), ['First:chat', 'Second:chat'])
  assert.equal(config.model.providers[0].id, '')
  assert.equal(applyConfigSectionPatch(host, Config, 'model', { providers: [rows[1], rows[0]] }).ok, true)
  assert.deepEqual(updates[0].model.providers.map((row: any) => row.apiKey), ['second-key', 'first-key'])
  assert.equal(applyConfigSectionPatch(host, Config, 'model', { providers: [rows[1]] }).ok, true)
  assert.equal(updates[1].model.providers[0].apiKey, 'second-key')
  assert.equal(applyConfigSectionPatch(host, Config, 'model', { providers: [rows[0], rows[0]] }).ok, false)
  const { id: _id, ...withoutId } = rows[1]
  assert.equal(applyConfigSectionPatch(host, Config, 'model', { providers: [withoutId] }).ok, false)
})


test('写作提示词独立投影：读写保留原键、模型密钥和故事档案', () => {
  const config: any = Config({ mainPrompt: '主指令', model: { fixedPrompt: '长期规则', providers: [{ id: 'p', apiKey: 'private-key' }] }, storyDefaults: { characterName: '主角', style: '旧文风' } })
  const { host, updates } = pipelineHost(config)
  const writing = readConfigCenter(host, Config, 'mainPrompt')
  assert.equal(writing.values!.value, '主指令')
  assert.equal((writing.values!.model as any).fixedPrompt, '长期规则')
  assert.equal((writing.values!.storyDefaults as any).style, '旧文风')
  assert.ok(!JSON.stringify(writing).includes('private-key'))
  assert.equal(readConfigCenter(host, Config, 'model').values!.fixedPrompt, undefined)
  assert.equal(readConfigCenter(host, Config, 'storyDefaults').values!.style, undefined)
  assert.match(new Schema(serializeConfigSection(Config, 'storyDefaults') as any).meta.description as string, /默认文风在「写作提示词」/)
  const result = applyConfigSectionPatch(host, Config, 'mainPrompt', { value: '新指令', model: { fixedPrompt: '新规则' }, storyDefaults: { style: '新文风' } })
  assert.equal(result.ok, true)
  assert.equal(updates[0].mainPrompt, '新指令')
  assert.equal(updates[0].model.fixedPrompt, '新规则')
  assert.deepEqual(updates[0].model.providers, config.model.providers)
  assert.equal(updates[0].storyDefaults.characterName, '主角')
  assert.equal(updates[0].storyDefaults.style, '新文风')
  assert.equal(config.storyDefaults.style, '旧文风')
  assert.equal((result.values!.model as any).fixedPrompt, '新规则')
  assert.equal(applyConfigSectionPatch(host, Config, 'mainPrompt', { model: { providers: [] } }).ok, false)
  assert.equal(applyConfigSectionPatch(host, Config, 'mainPrompt', {}, { unset: ['model.providers'] }).ok, false)
  assert.equal(applyConfigSectionPatch(host, Config, 'mainPrompt', {}, { unset: ['model.fixedPrompt', 'storyDefaults.style'] }).ok, true)
  assert.equal(updates[1].model.fixedPrompt, undefined)
  assert.equal(updates[1].storyDefaults.style, undefined)
  assert.equal(config.model.fixedPrompt, '长期规则')
})

test('普通保存触发真实 Cordis 更新，未修改时保持运行，强制重载重新应用', async () => {
  const app = new Context()
  const applied: number[] = [], persisted: any[] = []
  let pluginContext: Context
  const plugin = Object.assign((ctx: Context, config: any) => {
    pluginContext = ctx
    applied.push(config.runtime.contextEntryLimit)
  }, { Config })
  const fork = app.plugin(plugin, Config({}))
  app.on('internal/before-update', (_scope, config) => { persisted.push(config) })
  try {
    await app.start()
    const host: any = {
      config: Config({}),
      updatePluginConfig(next: any, reload: boolean) {
        InterludeService.prototype.updatePluginConfig.call({ ctx: pluginContext } as any, next, reload)
      },
    }
    assert.equal(applyConfigSectionPatch(host, Config, 'runtime', { contextEntryLimit: 31 }).ok, true)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(applied, [18, 31])
    assert.equal(persisted[0].runtime.contextEntryLimit, 31)
    host.config = fork.config
    assert.equal(applyConfigSectionPatch(host, Config, 'runtime', { contextEntryLimit: 31 }).ok, true)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(applied, [18, 31])
    assert.equal(applyConfigSectionPatch(host, Config, 'runtime', { contextEntryLimit: 31 }, { reload: true }).ok, true)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(applied, [18, 31, 31])
  } finally { await app.stop() }
})

test('保存响应返回规范化字段和密钥占位值，可跨重载直接更新表单', () => {
  const config: any = Config({ research: { searchApiKey: 'original-secret' } })
  const { host } = pipelineHost(config)
  const result = applyConfigSectionPatch(host, Config, 'research', { searchApiKey: 'replacement-secret' })
  assert.equal(result.ok, true)
  assert.equal(result.values!.searchApiKey, CONFIG_CENTER_SECRET_MASK)
  assert.ok(result.maskedFields!.includes('searchApiKey'))
  assert.ok(!JSON.stringify(result).includes('replacement-secret'))
})


test('写作页显示旧版有效主提示词，清空后恢复内置默认并保留其它模型设置', () => {
  const config: any = Config({ model: { mainPrompt: '旧版自定义主提示词', temperature: 0.7 } })
  const { host, updates } = pipelineHost(config)
  assert.equal(readConfigCenter(host, Config, 'mainPrompt').values!.value, '旧版自定义主提示词')
  assert.equal(applyConfigSectionPatch(host, Config, 'mainPrompt', { value: '' }).ok, true)
  assert.equal(updates[0].mainPrompt, '')
  assert.equal(updates[0].model.mainPrompt, (Config as any).dict.model.dict.mainPrompt(undefined))
  assert.equal(updates[0].model.temperature, 0.7)
  assert.equal(config.model.mainPrompt, '旧版自定义主提示词')
  const override: any = Config({ mainPrompt: '顶层主提示词', model: { mainPrompt: '曾经的覆盖值' } })
  const f = pipelineHost(override)
  assert.equal(readConfigCenter(f.host, Config, 'mainPrompt').values!.value, '顶层主提示词')
  assert.equal(applyConfigSectionPatch(f.host, Config, 'mainPrompt', {}, { unset: ['value'] }).ok, true)
  assert.equal(f.updates[0].mainPrompt, undefined)
  assert.equal(f.updates[0].model.mainPrompt, (Config as any).dict.model.dict.mainPrompt(undefined))
})
