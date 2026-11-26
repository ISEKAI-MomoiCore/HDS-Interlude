/**
 * 配置中心管线（分级导航整合，设计见 docs/CONSOLE_CONFIG_CENTER_DESIGN.md）。
 *
 * 读取：节 Schema 经 cordis toJSON 序列化为 {uid, refs} JSON，客户端用
 * schemastery 的 new Schema() 复活后交给 k-schema 渲染——与 Koishi 标准
 * 配置页同一条 Schema→表单链路，字段清单零手写。
 *
 * 写入：按节深合并 patch → 整树 Config.value 预校验（失败不落盘，直接
 * 返回字段路径错误）→ ctx.scope.update(merged)。后者由框架完成两件事：
 * cordis 热更新 fork 配置；loader 的 internal/before-update 钩子把
 * schema.simplify 后的值原子写回 koishi.yml。保存即持久，插件与标准
 * 配置页共用同一机制（设计 §6）。
 *
 * 密钥：按 Schema 的 secret role 推导掩码，保存时保留占位值对应的原密钥。
 * 危险项确认名单（CONFIG_CENTER_DANGEROUS_FIELDS）由客户端在提交前
 * 弹确认；服务端不重复拦截。
 */
import { Schema, type Context } from 'koishi'
import type { Config, InterludeService } from '../service'
import type { ConfigCenterReadResult, ConfigCenterSaveResult } from './contract'
import { CONFIG_CENTER_MENU, CONFIG_CENTER_SECRET_MASK, collectSecretPaths, findConfigCenterSection, isOpenConfigCenterSection, maskSecretPaths } from './contract'

export * from './contract'

declare module '@koishijs/console' {
  interface Events {
    'hdsi/config-center/read'(section?: string | null): Promise<ConfigCenterReadResult>
    'hdsi/config-center/save'(input: { section: string, patch: Record<string, unknown>, reload?: boolean, unset?: string[] }): Promise<ConfigCenterSaveResult>
  }
}

/** The writing page projects existing keys; stored configuration remains compatible. */
const WRITING_FIELDS = {
  value: ['mainPrompt'],
  'model.fixedPrompt': ['model', 'fixedPrompt'],
  'model.formatPrompt': ['model', 'formatPrompt'],
  'model.stylePrompt': ['model', 'stylePrompt'],
  'storyDefaults.style': ['storyDefaults', 'style'],
} as const
const separatedFields: Record<string, string[]> = {
  model: ['fixedPrompt', 'formatPrompt', 'stylePrompt'],
  storyDefaults: ['style'],
}

function sectionNode(configSchema: Schema, section: string): Schema {
  const nodes = (configSchema as unknown as { dict: Record<string, Schema> }).dict
  if (!nodes[section]) throw new Error(`配置节不存在: ${section}`)
  const clone = (node: Schema) => new Schema(JSON.parse(JSON.stringify(node)))
  if (section === 'mainPrompt') {
    return Schema.object({
      value: clone(nodes.mainPrompt),
      model: Schema.object({
        fixedPrompt: clone(nodes.model.dict.fixedPrompt),
        formatPrompt: clone(nodes.model.dict.formatPrompt),
        stylePrompt: clone(nodes.model.dict.stylePrompt),
      }).description('全局写作提示词'),
      storyDefaults: Schema.object({ style: clone(nodes.storyDefaults.dict.style) })
        .description('新故事的默认文风；现有故事在「当前故事」中调整'),
    }).description('写作提示词')
  }
  const node = clone(nodes[section])
  for (const key of separatedFields[section] ?? []) delete node.dict[key]
  node.meta = { ...node.meta, collapse: false }
  if (section === 'storyDefaults') node.meta.description = '故事档案：主角、世界、关系、地点、时区与前置剧本。新故事默认文风在「写作提示词」中设置。'
  return node
}

function sectionValues(config: Record<string, unknown>, configSchema: Schema, section: string): Record<string, unknown> {
  const node = sectionNode(configSchema, section)
  if (section === 'mainPrompt') {
    const model = config.model as Record<string, unknown> | undefined
    const story = config.storyDefaults as Record<string, unknown> | undefined
    const legacyDefault = (configSchema as unknown as { dict: Record<string, Schema> }).dict.model.dict.mainPrompt.meta.default
    const mainPrompt = typeof config.mainPrompt === 'string' && config.mainPrompt.trim()
      ? config.mainPrompt : typeof model?.mainPrompt === 'string' && model.mainPrompt !== legacyDefault ? model.mainPrompt : ''
    return node({ value: mainPrompt, model: {
      fixedPrompt: model?.fixedPrompt, formatPrompt: model?.formatPrompt, stylePrompt: model?.stylePrompt,
    }, storyDefaults: { style: story?.style } })
  }
  const raw = withProviderIds(section, config[section] ?? node(undefined) ?? {}) as Record<string, unknown>
  const values = { ...raw }
  for (const key of separatedFields[section] ?? []) delete values[key]
  return values
}

/** Serialize the section as displayed in the dedicated Console. */
export function serializeConfigSection(configSchema: Schema, section: string): unknown {
  return JSON.parse(JSON.stringify(sectionNode(configSchema, section)))
}

export function readConfigCenter(host: InterludeService, configSchema: Schema, section?: string | null): ConfigCenterReadResult {
  if (section == null || section === '') return { ok: true, menu: CONFIG_CENTER_MENU }
  if (!isOpenConfigCenterSection(section)) {
    return { ok: false, menu: CONFIG_CENTER_MENU, error: `未知配置节: ${String(section)}` }
  }
  const node = sectionNode(configSchema, section)
  const raw = sectionValues(host.config as unknown as Record<string, unknown>, configSchema, section)
  const { value, masked } = maskSecretPaths(raw, collectSecretPaths(node))
  return {
    ok: true, menu: CONFIG_CENTER_MENU,
    schema: serializeConfigSection(configSchema, section),
    values: value as Record<string, unknown>, maskedFields: masked,
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Give legacy rows stable identities before masking. Use the same base ID as
 * runtime model routing, so existing advanced route references stay valid. */
function withProviderIds(section: string, value: unknown): unknown {
  if (section !== 'model' || !isPlainObject(value) || !Array.isArray(value.providers)) return value
  const used = new Set(value.providers.flatMap(row => isPlainObject(row) && typeof row.id === 'string' && row.id.trim() ? [row.id.trim()] : []))
  return { ...value, providers: value.providers.map((row, index) => {
    if (!isPlainObject(row) || typeof row.id === 'string' && row.id.trim()) return row
    const base = `${typeof row.label === 'string' && row.label.trim() || 'provider'}:${typeof row.model === 'string' && row.model.trim() || ''}`
    let id = base, suffix = index + 1
    while (used.has(id)) id = `${base}-${suffix++}`
    used.add(id)
    return { ...row, id }
  }) }
}

/** 审计 F5：字段级深合并——普通对象逐键递归，数组与标量整体替换；
 * 任意层级的密钥哨兵跳过（不覆盖现值）。局部 patch（如只改 research.jev.
 * enabled）不再清空同对象的其余配置。 */
function deepMergePatch(current: unknown, patch: unknown, replace = false): unknown {
  if (patch === CONFIG_CENTER_SECRET_MASK) {
    if (current === undefined) throw new Error('新增条目中的密钥需要填写实际值，或留空。')
    return current
  }
  if (Array.isArray(patch)) {
    const rows = Array.isArray(current) ? current : []
    const keyed = rows.some(row => isPlainObject(row) && typeof row.id === 'string' && row.id.trim())
    const ids = patch.flatMap(row => isPlainObject(row) && typeof row.id === 'string' && row.id.trim() ? [row.id.trim()] : [])
    if (new Set(ids).size !== ids.length) throw new Error('连接 ID 应保持唯一，请修改重复的 ID 后保存。')
    return patch.map((value, index) => {
      // Provider IDs remain stable when rows are reordered or deleted.
      const previous = isPlainObject(value) && typeof value.id === 'string' && value.id
        ? rows.find(row => isPlainObject(row) && row.id === value.id) : keyed && isPlainObject(value) ? undefined : rows[index]
      return deepMergePatch(previous, value, true)
    })
  }
  if (!isPlainObject(patch)) return patch
  const source = isPlainObject(current) ? current : {}
  const out: Record<string, unknown> = replace ? {} : { ...source }
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('配置字段无效。')
    out[key] = deepMergePatch(Object.hasOwn(source, key) ? source[key] : undefined, value, replace)
  }
  return out
}

function unsetPaths(value: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    if (typeof path !== 'string') throw new Error('配置重置路径无效。')
    const keys = path.split('.')
    if (keys.some(key => !key || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('配置重置路径无效。')
    let parent: any = value
    for (const key of keys.slice(0, -1)) parent = isPlainObject(parent) ? parent[key] : undefined
    if (isPlainObject(parent)) delete parent[keys[keys.length - 1]]
  }
}

/** 按节持久化写入：深合并（审计 F5，嵌套字段不丢）→ 整树预校验 →
 * scope.update（热更新 + loader 写回 koishi.yml）。任何失败都不落盘。 */
export function applyConfigSectionPatch(host: InterludeService, configSchema: Schema, section: string, patch: Record<string, unknown>, options: { reload?: boolean, unset?: string[] } = {}): ConfigCenterSaveResult {
  const meta = findConfigCenterSection(section)
  if (!meta) return { ok: false, error: `未知配置节: ${section}` }
  if (!isOpenConfigCenterSection(section)) return { ok: false, error: `未知配置节: ${String(section)}` }
  if (!isPlainObject(patch)) return { ok: false, error: 'invalid patch' }

  let merged: Record<string, unknown>
  try {
    const config = host.config as unknown as Record<string, unknown>
    if (section === 'mainPrompt') {
      // Only this view's fields may write through to their original locations.
      const check = (value: Record<string, unknown>, prefix = '') => {
        for (const [key, child] of Object.entries(value)) {
          const path = prefix ? `${prefix}.${key}` : key
          if (Object.hasOwn(WRITING_FIELDS, path)) continue
          if (!['model', 'storyDefaults'].includes(path) || !isPlainObject(child)) throw new Error(`写作提示词字段无效: ${path}`)
          check(child, path)
        }
      }
      check(patch)
      for (const path of options.unset ?? []) {
        if (!Object.hasOwn(WRITING_FIELDS, path) && !['model', 'storyDefaults'].includes(path)) throw new Error(`写作提示词重置路径无效: ${path}`)
      }
      const next = deepMergePatch(sectionValues(config, configSchema, section), patch) as Record<string, unknown>
      unsetPaths(next, options.unset ?? [])
      merged = { ...config, model: { ...config.model as object }, storyDefaults: { ...config.storyDefaults as object } }
      // Clearing the visible prompt also resets the legacy fallback used by older YAML.
      if (Object.hasOwn(patch, 'value') || options.unset?.includes('value')) {
        ;(merged.model as Record<string, unknown>).mainPrompt = (configSchema as unknown as { dict: Record<string, Schema> }).dict.model.dict.mainPrompt(undefined)
      }
      for (const [path, keys] of Object.entries(WRITING_FIELDS)) {
        const viewKeys = path.split('.')
        const source = viewKeys.length === 1 ? next : next[viewKeys[0]] as Record<string, unknown> | undefined
        const key = viewKeys[viewKeys.length - 1]
        const target = keys.length === 1 ? merged : merged[keys[0]] as Record<string, unknown>
        const targetKey = keys[keys.length - 1]
        if (source && Object.hasOwn(source, key)) target[targetKey] = source[key]
        else delete target[targetKey]
      }
    } else {
      const current = withProviderIds(section, config[section])
      const next = withProviderIds(section, deepMergePatch(current, patch))
      // Removing a field must never mutate live configuration before validation.
      const sectionValue = options.unset?.length ? JSON.parse(JSON.stringify(next)) : next
      if (isPlainObject(sectionValue)) unsetPaths(sectionValue, options.unset ?? [])
      merged = { ...config, [section]: sectionValue }
    }
  } catch (error) { return { ok: false, error: describeSchemaError(error) } }
  let resolved: Config
  // 预校验必须先于 scope.update：后者内部的 resolveConfig 失败会 cancel
  // 整个插件作用域（@cordisjs/core scope.ts Fork.update），把插件打停。
  try {
    resolved = (configSchema as unknown as (input: unknown) => Config)(merged)
  } catch (error) {
    return { ok: false, error: describeSchemaError(error) }
  }
  try {
    host.updatePluginConfig(merged as unknown as Config, options.reload === true)
  } catch (error) {
    return { ok: false, error: `配置更新失败: ${describeSchemaError(error)}` }
  }
  // Return the validated view directly; an automatic restart may replace this RPC host.
  const saved = readConfigCenter({ config: resolved } as InterludeService, configSchema, section)
  return { ok: true, values: saved.values, maskedFields: saved.maskedFields }
}

function describeSchemaError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n')[0]?.slice(0, 500) ?? '配置校验失败'
}

/** RPC 安装：读 authority=1（登录可见），写 authority=3（管理员）。 */
export function installConfigCenterRpc(ctx: Context, host: InterludeService, configSchema: Schema): void {
  const READ = 1
  const WRITE = 3
  ctx.console.addListener('hdsi/config-center/read', section => Promise.resolve(readConfigCenter(host, configSchema, section)), { authority: READ })
  ctx.console.addListener('hdsi/config-center/save', (input) => {
    if (!input || typeof input.section !== 'string') return Promise.resolve({ ok: false, error: '请选择有效配置节。' })
    return Promise.resolve(applyConfigSectionPatch(host, configSchema, input.section, input.patch, { reload: input.reload, unset: Array.isArray(input.unset) ? input.unset : [] }))
  }, { authority: WRITE })
}
