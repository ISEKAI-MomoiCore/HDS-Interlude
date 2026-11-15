/**
 * HDSI Console 服务端：DataService 快照（P1 只读）+ 配置读写 RPC（P2）
 * + 客户端 bundle 入口。Console 未安装时完全不影响后端（可选依赖注入）。
 */
import { Context } from 'koishi'
import { dirname } from 'node:path'
import type { Schema } from 'koishi'
import { DataService } from '@koishijs/console'
import type { InterludeService } from '../service'
import { installConfigRpc } from './rpc'
import { installConfigCenterRpc } from './config-center'
import { installActionsRpc } from './actions'

/** 快照形状（客户端与服务端共享的唯一契约）。 */
export interface HdsiOverview {
  version: string
  story: {
    found: boolean
    characterName: string
    participantCount: number
    entryCount: number
    status: string
    cursorLocal: string
    rhythm: string
  }
  models: Array<{ task: string, provider: string, model: string, available: boolean, reason?: string }>
  switches: Array<{ key: string, label: string, value: string, ok: boolean | null }>
  research: {
    enabled: boolean
    backend: string
    deskEntries: number
    counters: { offered: number, reused: number, evicted: number }
    cache: { size: number, hits: number, misses: number }
    jev: { enabled: boolean, keyConfigured: boolean, calls: number, triggered: number }
  }
  density: {
    counts: { count5: number, count15: number, count30: number }
    tier: string
    effectiveLimit: number
    mode: string
    anchor: number
    globalMode: string
    scopes: { private: import('../context-density').ScopeContextEntryConfig, group: import('../context-density').ScopeContextEntryConfig }
  }
  health: { successes: number, retries: number, failures: number, avgLatencyMs: number }
}

declare module '@koishijs/console' {
  interface Events {
    'hdsi-overview/get'(): Promise<HdsiOverview>
    'hdsi/actions/list'(payload: { cursor?: string, limit?: number }): Promise<import('./actions').CommunicationActionsListResult>
    'hdsi/actions/get'(payload: { id: string }): Promise<import('./actions').CommunicationActionDetail | undefined>
    'hdsi/actions/cancel'(payload: { id: string }): Promise<import('./actions').CommunicationActionResult>
    'hdsi/actions/verify'(payload: { id: string, outcome: 'delivered' | 'not-sent' }): Promise<import('./actions').CommunicationActionResult>
  }

  namespace Console {
    interface Services {
      'hdsi-overview': OverviewProvider
    }
  }
}

export class OverviewProvider extends DataService<HdsiOverview> {
  static inject = ['interlude']

  constructor(ctx: Context, private readonly host: InterludeService) {
    super(ctx, 'hdsi-overview', { authority: 1 })
  }

  async get(): Promise<HdsiOverview> {
    return this.host.consoleOverview()
  }
}

/** 安装入口：数据服务 + 配置 RPC + 配置中心 RPC + 客户端 bundle。
 * configSchema 是 index.ts 导出的 Config Schema 实例——配置中心用它做
 * 序列化渲染与保存前预校验；经参数传入以避免 service/console 与 index
 * 之间的运行时循环引用。
 * bundle 产物在 client-dist/（vite 构建产出，随包发布）；从打包后的
 * lib/ 解析必须用 ../client-dist/——指向 ../client/ 是 CEV 侧遗留的
 * 路径缺陷（client/ 只有源码，安装环境必抛 MODULE_NOT_FOUND）。 */
export function installHdsiConsole(ctx: Context, host: InterludeService, configSchema: Schema): void {
  ctx.plugin(OverviewProvider, host)
  // DataService 推送与显式读取共用同一快照源；读取 RPC 沿用相同权限。
  ctx.console.addListener('hdsi-overview/get', () => host.consoleOverview(), { authority: 1 })
  installConfigRpc(ctx, host, configSchema)
  installConfigCenterRpc(ctx, host, configSchema)
  installActionsRpc(ctx, host)
  try {
    // Bundled (lib/index.js → ../client-dist/) and dev-from-source
    // (src/console/index.ts → ../../client-dist/) differ in depth.
    let dist: string | undefined
    try { dist = dirname(require.resolve('../client-dist/index.js')) } catch { /* not bundled */ }
    if (!dist) try { dist = dirname(require.resolve('../../client-dist/index.js')) } catch { /* not source either */ }
    if (!dist) throw new Error('client-dist not found from either bundled or source path')
    ctx.console.addEntry(dist)
  } catch (error) {
    ctx.logger('hds-interlude').warn('HDSI Console 客户端资源缺失（只读数据服务仍可用）错误=%s', error)
  }
}
