/**
 * Console RPC 事件壳：把 hdsi-cev/config/read 与 hdsi-cev/config/save 两个事件
 * 转发给 InterludeService 的 consoleReadConfig / consoleSaveConfig。
 * 事件名带 -cev 后缀——与主仓插件的 hdsi/config/* 并存不撞名。
 * 业务与白名单见 contract.ts 与 service.ts；这里只做权限分级——
 * 读 authority=1（登录即可见），写 authority=3（管理员）。
 */
import type { Context } from 'koishi'
import type { InterludeService } from '../service'
import type { ConfigReadResult, ConfigSaveResult } from './contract'

export * from './contract'

declare module '@koishijs/console' {
  interface Events {
    'hdsi-cev/config/read'(section: string): Promise<ConfigReadResult>
    'hdsi-cev/config/save'(input: { section: string, values: Record<string, unknown> }): Promise<ConfigSaveResult>
  }
}

export function installConfigRpc(ctx: Context, host: InterludeService): void {
  const READ = 1
  const WRITE = 3
  ctx.console.addListener('hdsi-cev/config/read', section => host.consoleReadConfig(section), { authority: READ })
  ctx.console.addListener('hdsi-cev/config/save', ({ section, values }) => host.consoleSaveConfig(section, values ?? {}), { authority: WRITE })
}
