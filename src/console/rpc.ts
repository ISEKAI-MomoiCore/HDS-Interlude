/**
 * Console RPC 事件壳：把 hdsi/config/read 与 hdsi/config/save 两个事件
 * 转发给 InterludeService 的 consoleReadConfig / consoleSaveConfig。
 * 业务与白名单见 contract.ts 与 service.ts；这里只做权限分级——
 * 读 authority=1（登录即可见），写 authority=3（管理员）。
 *
 * 配置中心上线（设计 docs/CONSOLE_CONFIG_CENTER_DESIGN.md）后的写入
 * 语义变化：runtime/research 两节的旧接口不再走 service 的进程内改写
 * （重启即回退），而是与配置中心共用 applyConfigSectionPatch 持久化
 * 管线（scope.update → koishi.yml）。story 节维持 updateSetting 落库。
 */
import type { Context, Schema } from 'koishi'
import type { InterludeService } from '../service'
import type { ConfigReadResult, ConfigSaveResult } from './contract'
import { EDITABLE_RESEARCH_KEYS, EDITABLE_RUNTIME_KEYS } from './contract'
import { applyConfigSectionPatch } from './config-center'

export * from './contract'
export * from './config-center'

declare module '@koishijs/console' {
  interface Events {
    'hdsi/config/read'(section: string): Promise<ConfigReadResult>
    'hdsi/config/save'(input: { section: string, values: Record<string, unknown> }): Promise<ConfigSaveResult>
  }
}

export function installConfigRpc(ctx: Context, host: InterludeService, configSchema: Schema): void {
  const READ = 1
  const WRITE = 3
  ctx.console.addListener('hdsi/config/read', section => host.consoleReadConfig(section), { authority: READ })
  ctx.console.addListener('hdsi/config/save', ({ section, values }) => {
    if (section === 'runtime' || section === 'research') {
      const whitelist = section === 'runtime' ? EDITABLE_RUNTIME_KEYS : EDITABLE_RESEARCH_KEYS
      const patch: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(values ?? {})) {
        if (!whitelist.has(key)) continue
        patch[key] = value
      }
      const result = applyConfigSectionPatch(host, configSchema, section, patch)
      return Promise.resolve({ ok: result.ok, applied: result.ok ? Object.keys(patch).length : 0, error: result.error } satisfies ConfigSaveResult)
    }
    return host.consoleSaveConfig(section, values ?? {})
  }, { authority: WRITE })
}
