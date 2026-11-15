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
 * 密钥：读取掩码、保存哨兵跳过（CONFIG_CENTER_SECRET_FIELDS）。
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

/** 序列化一个配置节的 Schema（顶层键 → 子 Schema）。节不存在时抛错。 */
export function serializeConfigSection(configSchema: Schema, section: string): unknown {
  const node = (configSchema as unknown as { dict?: Record<string, unknown> }).dict?.[section]
  if (!node) throw new Error(`配置节不存在: ${section}`)
  const cloned = new Schema(JSON.parse(JSON.stringify(node)))
  cloned.meta = { ...cloned.meta, collapse: false }
  // A string section (mainPrompt) needs the same object-shaped form model.
  return JSON.parse(JSON.stringify(cloned.type === 'object' || cloned.type === 'intersect'
    ? cloned : Schema.object({ value: cloned }).description('主提示词内容')))
}

/** 配置中心读取：菜单恒随行；开放节附带序列化 Schema 与当前值。
 * 密钥脱敏以 Schema 为唯一事实来源（审计 F1）：递归收集 role=secret 的
 * 字段路径——嵌套如 research.jev.apiKey 同样掩码，不依赖手工清单。 */
export function readConfigCenter(host: InterludeService, configSchema: Schema, section?: string | null): ConfigCenterReadResult {
  if (section == null || section === '') return { ok: true, menu: CONFIG_CENTER_MENU }
  if (!isOpenConfigCenterSection(section)) {
    return { ok: false, menu: CONFIG_CENTER_MENU, error: `未知配置节: ${String(section)}` }
  }
  const node = (configSchema as unknown as { dict: Record<string, Schema> }).dict[section]
  const configured = (host.config as unknown as Record<string, unknown>)[section]
  const raw = withProviderIds(section, configured ?? (node as unknown as (value: unknown) => unknown)(undefined) ?? {})
  const secretPaths = collectSecretPaths((configSchema as unknown as { dict?: Record<string, unknown> }).dict?.[section])
  const { value, masked } = maskSecretPaths(raw, secretPaths)
  return {
    ok: true,
    menu: CONFIG_CENTER_MENU,
    schema: serializeConfigSection(configSchema, section),
    values: node.type === 'object' || node.type === 'intersect' ? value as Record<string, unknown> : { value },
    maskedFields: masked,
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

  const node = (configSchema as unknown as { dict: Record<string, Schema> }).dict[section]
  const scalar = node.type !== 'object' && node.type !== 'intersect'
  let merged: Record<string, unknown>
  try {
    const current = withProviderIds(section, (host.config as unknown as Record<string, unknown>)[section])
    const next = withProviderIds(section, deepMergePatch(current, scalar ? patch.value : patch))
    // Removing a field must never mutate live configuration before validation.
    const sectionValue = !scalar && options.unset?.length ? JSON.parse(JSON.stringify(next)) : next
    if (!scalar && isPlainObject(sectionValue)) unsetPaths(sectionValue, options.unset ?? [])
    merged = { ...(host.config as unknown as Record<string, unknown>), [section]: sectionValue }
  } catch (error) { return { ok: false, error: describeSchemaError(error) } }
  // 预校验必须先于 scope.update：后者内部的 resolveConfig 失败会 cancel
  // 整个插件作用域（@cordisjs/core scope.ts Fork.update），把插件打停。
  try {
    ;(configSchema as unknown as (input: unknown) => unknown)(merged)
  } catch (error) {
    return { ok: false, error: describeSchemaError(error) }
  }
  try {
    host.updatePluginConfig(merged as unknown as Config, options.reload === true)
  } catch (error) {
    return { ok: false, error: `配置更新失败: ${describeSchemaError(error)}` }
  }
  return { ok: true }
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
