/**
 * HDSI Console 服务端：DataService 快照（P1 只读）+ 配置读写 RPC（P2）
 * + 客户端 bundle 入口。Console 未安装时完全不影响后端（可选依赖注入）。
 */
import { Context } from 'koishi'
import { DataService } from '@koishijs/console'
import type { InterludeService } from '../service'
import { installConfigRpc } from './rpc'

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
  models: Array<{ task: string, provider: string, model: string, available: boolean }>
  switches: Array<{ key: string, label: string, value: string, ok: boolean | null }>
  research: {
    enabled: boolean
    backend: string
    deskEntries: number
    counters: { offered: number, reused: number, evicted: number }
    cache: { size: number, hits: number, misses: number }
    jev: { enabled: boolean, calls: number, triggered: number }
  }
  density: {
    counts: { count5: number, count15: number, count30: number }
    tier: string
    effectiveLimit: number
    mode: string
  }
  health: { successes: number, retries: number, failures: number, avgLatencyMs: number }
}

declare module '@koishijs/console' {
  namespace Console {
    interface Services {
      'hdsi-overview-cev': OverviewProvider
    }
  }
}

export class OverviewProvider extends DataService<HdsiOverview> {
  static inject = ['interlude']

  constructor(ctx: Context, private readonly host: InterludeService) {
    super(ctx, 'hdsi-overview-cev', { authority: 1 })
  }

  async get(): Promise<HdsiOverview> {
    return this.host.consoleOverview()
  }
}

/** 安装入口：数据服务 + 配置 RPC + 客户端 bundle（dist 目录由 client 构建产出）。 */
export function installHdsiConsole(ctx: Context, host: InterludeService): void {
  ctx.plugin(OverviewProvider, host)
  installConfigRpc(ctx, host)
  try {
    ctx.console.addEntry([require.resolve('../client-dist/hdsi-console.js')])
  } catch (error) {
    ctx.logger('hds-interlude').warn('HDSI Console 客户端资源缺失（只读数据服务仍可用）错误=%s', error)
  }
}
