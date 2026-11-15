import { Context, Logger, Schema } from 'koishi'
import { join } from 'node:path'
import { SqliteStore } from './store'
import { attachLogCapture, LogRing } from './logring'
import { createWebServer, isLoopback } from './server'
import { resolveInterludeDatabaseSafe } from './connection'

export { MIME } from './server'
export const name = 'hds-interlude-webconsole'
export const inject = { required: ['database', 'interlude'] } as const

export interface WebconsoleConfig {
  enabled: boolean
  port: number
  host: string
  token: string
  pollSeconds: number
  logBuffer: number
  databasePath?: string
  autoRefresh?: boolean
}

export const Config = Schema.intersect([
  Schema.object({
    enabled: Schema.boolean().default(false).description('启用独立只读观测站；需先启用 HDSI 本体与 SQLite 数据库。'),
    host: Schema.union(['127.0.0.1', 'localhost', '::1']).default('127.0.0.1').description('仅允许回环监听；不要通过反向代理或隧道暴露公网。'),
    port: Schema.natural().min(1024).max(65535).default(5178).description('网页端口；默认访问 http://127.0.0.1:5178，非 Koishi Console 内嵌页面。'),
    token: Schema.string().role('secret').default('').description('API 令牌（含 SSE）；建议强随机字符串。在网页侧栏输入；静态页面本身不含数据。'),
  }).description('服务与访问'),
  Schema.object({
    databasePath: Schema.string().role('path').default('').description('留空自动定位 HDSI SQLite 文件（优先 Koishi 标准位置，降级 minato driver）。手动路径相对 Koishi baseDir；不支持内存/MySQL/PostgreSQL。'),
  }).description('主插件数据源'),
  Schema.object({
    autoRefresh: Schema.boolean().default(true).description('网页默认自动更新所有数据页；保留筛选、提案和日历周。网页可临时暂停；剧本/日志另有追尾开关。'),
    pollSeconds: Schema.natural().min(1).max(60).default(3).description('统一刷新间隔：SSE 变更探测、断线补查、剧本与日志轮询（秒）。仅展示已持久化数据，不是模型逐 token 流。'),
    logBuffer: Schema.natural().min(200).max(20000).default(2000).description('插件启用后的整个 Koishi 进程 Logger 缓冲容量；不按故事过滤，不补读终端历史。'),
  }).description('实时更新与日志'),
]).description('HDSI 本地观测站 · 只读 · Node.js 22.5+ / SQLite')

export function apply(ctx: Context, config: WebconsoleConfig) {
  const logger = new Logger(name)
  let cleanup: (() => void) | undefined
  let disposed = false
  ctx.on('ready', async () => {
    if (!config.enabled || disposed) return
    if (!isLoopback(config.host)) { logger.warn('拒绝非回环监听地址。'); return }
    let store: SqliteStore
    try {
      await ctx.database.prepared()
      if (disposed) return
      // 连接修复：不再依赖 ctx.database.select('interlude_story').driver 内部链。
      // 新路径以文件系统标准位置为主（baseDir/data/koishi.db），driver 链作为
      // 异位路径降级。table 未注册不再阻止观测站启动。
      let driver: unknown = undefined
      try {
        const database = ctx.database as unknown as { select(table: string): { driver: unknown } }
        driver = database.select('interlude_story')?.driver
      } catch {
        // table 尚未注册（HDSI 加载窗口或版本差异）——不阻止，走文件系统定位
        logger.info('HDSI 表尚未注册到 database.select，改用文件系统定位 SQLite 文件。')
      }
      const resolution = resolveInterludeDatabaseSafe(ctx.baseDir, driver, config.databasePath)
      logger.info('数据库文件定位成功 来源=%s 路径=%s', resolution.source, resolution.path)
      store = new SqliteStore(resolution.path)
    }
    catch (error) { logger.warn('SQLite 只读连接失败，服务未启动：%s', error instanceof Error ? error.message : String(error)); return }

    // HDSI 版本：从服务实例取（比静态 import 更可靠——运行中的实例才是真版本）
    let interludeVersion = 'unknown'
    try {
      const service = (ctx as unknown as { interlude?: { getDesktopRuntimePhase?: () => string } }).interlude
      // InterludeService 上可能没有直接暴露 version 字段；尝试读取
      const anyService = service as unknown as Record<string, unknown>
      if (typeof anyService?.version === 'string') interludeVersion = anyService.version
      else {
        // 从 lib 包读取（静态 import fallback，但不阻塞启动）
        const pkg = require('koishi-plugin-hds-interlude') as { version?: string }
        interludeVersion = pkg?.version ?? 'unknown'
      }
    } catch { /* 版本取不到不阻塞 */ }

    const ring = new LogRing(config.logBuffer)
    const detach = attachLogCapture(ring)
    const web = createWebServer({
      store, ring, token: config.token, pollSeconds: config.pollSeconds,
      autoRefresh: config.autoRefresh ?? true, integration: { service: 'interlude', version: interludeVersion },
      publicRoot: join(__dirname, '..', 'public'),
      onRequestError(error) { logger.warn('观测站读取失败：%s', error instanceof Error ? error.message : String(error)) },
      onError(error) { logger.warn('观测站服务错误：%s', error instanceof Error ? error.message : String(error)); cleanup?.() },
    })
    let closed = false
    cleanup = () => {
      if (closed) return
      closed = true; web.stopStreams(); web.server.close(); detach(); store.close()
    }
    web.server.listen(config.port, config.host, () => logger.info('本地只读观测站已启动，端口 %d；请勿暴露公网。', config.port))
  })
  ctx.on('dispose', () => { disposed = true; cleanup?.() })
}
