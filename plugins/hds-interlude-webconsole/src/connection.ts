import { resolve, join } from 'node:path'
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'

/**
 * 数据库路径解析：不再依赖 ctx.database.select().driver 内部链（table 未注册时
 * select() 会直接抛错，这是「无法连接 HDSI database」反馈的根因）。
 *
 * 优先级：显式配置 databasePath > minato driver 暴露的 path > Koishi 标准文件
 * 位置扫描。driver 与文件系统候选都必须通过 SQLite 文件头校验（前 16 字节
 * "SQLite format 3\0"），避免拿到被截断或非数据库的文件。
 */

/** Koishi Desktop / 脚手架的默认 SQLite 文件名。 */
const DEFAULT_DB_FILES = ['koishi.db', 'data/koishi.db', 'data/database.sqlite', 'database.sqlite']

export interface DatabaseResolution {
  path: string
  /** 如何找到的（日志/诊断用）。 */
  source: 'driver' | 'filesystem' | 'configured'
}

/** 校验文件存在且为合法 SQLite 镜像（主插件 sql.js 每次提交整体重写文件，
 * 截断窗口内会出现 0 字节或半写文件，这类候选必须跳过）。 */
function isSqliteFile(full: string): boolean {
  try {
    if (!existsSync(full) || !statSync(full).isFile()) return false
    const fd = openSync(full, 'r')
    try {
      const header = Buffer.alloc(16)
      const bytes = readSync(fd, header, 0, 16, 0)
      return bytes === 16 && header.toString('ascii').startsWith('SQLite format 3')
    } finally { closeSync(fd) }
  } catch { return false }
}

/** 尝试从 minato driver 获取数据库路径。@minatojs/driver-sqlite 在构造时把
 * config.path 解析为绝对路径挂在实例 path 字段上；兼容 config.path 形态。 */
function resolveFromDriver(baseDir: string, driver: unknown): string | undefined {
  try {
    const value = driver as { path?: string; config?: { path?: string } } | undefined
    if (!value) return undefined
    const raw = value.path || value.config?.path
    if (!raw || raw === ':memory:') return undefined
    const full = resolve(baseDir, raw)
    return isSqliteFile(full) ? full : undefined
  } catch { return undefined }
}

/** 在 Koishi 标准位置扫描 SQLite 文件（table 未注册 / driver 拿不到时的主路径）。 */
function resolveFromFilesystem(baseDir: string): string | undefined {
  for (const candidate of DEFAULT_DB_FILES) {
    const full = resolve(baseDir, candidate)
    if (isSqliteFile(full)) return full
  }
  return undefined
}

/** 优先级：显式配置 > driver 链 > 文件系统默认位置。 */
export function resolveInterludeDatabase(baseDir: string, driver: unknown, configured = ''): string {
  const configTrimmed = configured.trim()

  if (configTrimmed) {
    const requested = resolve(baseDir, configTrimmed)
    if (!existsSync(requested)) throw new Error(`databasePath 指定的文件不存在：${requested}`)
    if (!isSqliteFile(requested)) throw new Error(`databasePath 指定的文件不是有效的 SQLite 数据库：${requested}`)
    return requested
  }

  const fromDriver = resolveFromDriver(baseDir, driver)
  if (fromDriver) return fromDriver

  const fromFs = resolveFromFilesystem(baseDir)
  if (fromFs) return fromFs

  const searched = DEFAULT_DB_FILES.map(f => join(baseDir, f)).join(' 或 ')
  throw new Error(
    `未找到 HDSI SQLite 数据库文件。已搜索：${searched}。` +
    '请在观测站配置中显式填写 databasePath（相对 Koishi baseDir），' +
    '或确认 HDSI 插件已启用且使用 SQLite 数据库。',
  )
}

export function resolveInterludeDatabaseSafe(baseDir: string, driver: unknown, configured = ''): DatabaseResolution {
  const path = resolveInterludeDatabase(baseDir, driver, configured)
  const source = configured.trim() ? 'configured' as const
    : resolveFromDriver(baseDir, driver) === path ? 'driver' as const : 'filesystem' as const
  return { path, source }
}
