/** Read-only, story-scoped SQLite access. No writes, migrations or model calls.
 * decodeStoryState 由本模块内联实现（而非 import 主插件包）——主插件的
 * CJS bundle 在 esbuild 侧会被整段内联进 webconsole，导致 21k 行重复代码
 * 与独立内部状态；纯函数内联消除该依赖。 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

type Row = Record<string, any>

export function parseJson(value: unknown, fallback: unknown = null): any {
  if (typeof value !== 'string') return value ?? fallback
  try { return JSON.parse(value) } catch { return fallback }
}

/** StoryState 解码（与主插件 story-state.ts 的 normalizeStoryState 语义对齐）。
 * 只提取 webconsole 需要的字段，不做完整模型验证。 */
function decodeStoryState(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, any>
  return {
    automation: parseJson(record.automation, undefined) ?? record.automation,
    extensions: typeof record.extensions === 'object' && record.extensions !== null
      ? { urge: parseJson(record.extensions.urge, undefined) ?? record.extensions.urge }
      : {},
    alterSystem: parseJson(record.alterSystem, undefined) ?? record.alterSystem,
    agencyWindow: parseJson(record.agencyWindow, undefined) ?? record.agencyWindow,
    settingOverlay: parseJson(record.settingOverlay, undefined) ?? record.settingOverlay,
    lifeRhythm: parseJson(record.lifeRhythm, undefined) ?? record.lifeRhythm,
    lifeStatus: parseJson(record.lifeStatus, undefined) ?? record.lifeStatus,
    proactiveContactLog: parseJson(record.proactiveContactLog, []) ?? [],
    sceneFrame: parseJson(record.sceneFrame, undefined) ?? record.sceneFrame,
    workingDetails: parseJson(record.workingDetails, []) ?? [],
  }
}

const JSON_FIELDS = new Set([
  'setting', 'state', 'metadata', 'sourceEntryIds', 'sourcePatchIds',
  'majorEvents', 'regimes', 'exceptions', 'materializedDays', 'payload',
  'knowledge', 'evidenceEntryIds', 'subjects',
])

function decodeRow(row: Row): Row {
  const result = { ...row }
  for (const key of JSON_FIELDS) if (key in result) result[key] = parseJson(result[key])
  return result
}

const bounded = (n: number, max: number) => Number.isFinite(n) ? Math.max(1, Math.min(Math.floor(n), max)) : max

/** 连接层错误（撕裂镜像 / 失效句柄 / 无法打开）才值得重建连接重试；
 * 参数校验等业务错误原样抛出。 */
function isConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /database|sqlite|disk image|short read/i.test(message)
}

export class SqliteStore {
  private db: DatabaseSync
  private readonly dbFile: string
  constructor(dbFile: string) {
    this.dbFile = dbFile
    this.db = new DatabaseSync(dbFile, { readOnly: true })
  }
  close() { this.db.close() }

  /** 主插件（sql.js）每次提交都会整体重写数据库文件；长连接可能读到撕裂
   * 镜像或失效句柄。任何读失败时重建连接并重试一次，仍失败才抛出。 */
  private reopen() {
    try { this.db.close() } catch { /* 已损坏连接的关闭失败直接丢弃 */ }
    this.db = new DatabaseSync(this.dbFile, { readOnly: true })
  }

  /** A read transaction makes each JSON response internally consistent. */
  snapshot<T>(read: () => T): T {
    try { return this.runReadTransaction(read) }
    catch (error) {
      if (!isConnectionError(error)) throw error
      this.reopen()
      return this.runReadTransaction(read)
    }
  }
  private runReadTransaction<T>(read: () => T): T {
    this.db.exec('BEGIN')
    try { const value = read(); this.db.exec('COMMIT'); return value }
    catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* 连接已坏时 rollback 失败不掩盖原始错误 */ }
      throw error
    }
  }

  private hasTable(table: string) { return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) }

  missingTables() {
    // 只列观测站实际查询的表；主插件其余表（endpoint/sticker/qzone…）缺省不告警
    return [
      'story', 'script_entry', 'scene', 'arc', 'state_patch', 'overlay_snapshot',
      'fact', 'intent', 'memory', 'participant', 'schedule_preplan', 'long_arc_guidance',
    ].map(name => `interlude_${name}`).filter(name => !this.hasTable(name))
  }

  /** Freezes the latest-story choice once per HTTP request. */
  resolveStoryId(id?: string): string | null {
    if (!this.hasTable('interlude_story')) return null
    const row = id
      ? this.db.prepare('SELECT id FROM interlude_story WHERE id=?').get(id)
      : this.db.prepare('SELECT id FROM interlude_story ORDER BY updatedAt DESC, id ASC LIMIT 1').get()
    return row ? String(row.id) : null
  }

  stories() {
    if (!this.hasTable('interlude_story')) return []
    return this.db.prepare('SELECT id,status,cursorAt,updatedAt,setting FROM interlude_story ORDER BY updatedAt DESC,id ASC').all()
      .map(row => ({
        id: row.id, status: row.status, cursorAt: row.cursorAt, updatedAt: row.updatedAt,
        timezone: parseJson(row.setting)?.timezone || null,
      }))
  }

  storySummary(id: string | null = this.resolveStoryId()) {
    if (!id) return null
    const raw = this.db.prepare('SELECT * FROM interlude_story WHERE id=?').get(id)
    if (!raw) return null
    const story = decodeRow(raw)
    const state = decodeStoryState(story.state ?? {})
    const entryCount = this.hasTable('interlude_script_entry')
      ? Number(this.db.prepare('SELECT COUNT(*) c FROM interlude_script_entry WHERE storyId=?').get(id)?.c ?? 0) : 0
    return {
      id, status: story.status, cursorAt: story.cursorAt, updatedAt: story.updatedAt, setting: story.setting,
      entryCount,
      automation: state.automation,
      urge: state.extensions?.urge ?? null,
      alter: state.alterSystem,
      agencyWindow: state.agencyWindow,
      settingOverlay: state.settingOverlay,
      lifeRhythm: state.lifeRhythm ?? null,
      lifeStatus: state.lifeStatus ?? null,
      proactiveContactCount: Array.isArray(state.proactiveContactLog) ? state.proactiveContactLog.length : 0,
    }
  }

  private rows(table: string, id: string | null, order: string, limit: number, extra = '', args: SQLInputValue[] = []): Row[] {
    if (!id || !this.hasTable(table)) return []
    return this.db.prepare(`SELECT * FROM ${table} WHERE storyId=? ${extra} ORDER BY ${order} LIMIT ?`).all(id, ...args, limit).map(decodeRow)
  }

  scriptEntries(opts: { before?: number; after?: number; limit: number; kind?: string; participantId?: string }, id: string | null = this.resolveStoryId()) {
    if (!id || !this.hasTable('interlude_script_entry')) return { rows: [], hasMore: false, total: 0 }
    const filters = ['storyId=?'], args: SQLInputValue[] = [id]
    if (opts.kind) { filters.push('kind=?'); args.push(opts.kind) }
    if (opts.participantId) { filters.push('participantId=?'); args.push(opts.participantId) }
    const total = Number(this.db.prepare(`SELECT COUNT(*) c FROM interlude_script_entry WHERE ${filters.join(' AND ')}`).get(...args)?.c ?? 0)
    if (opts.before != null) { filters.push('id<?'); args.push(opts.before) }
    if (opts.after != null) { filters.push('id>?'); args.push(opts.after) }
    const limit = bounded(opts.limit, 200)
    const rows = this.db.prepare(
      `SELECT id,storyId,participantId,kind,actor,content,occurredAt,metadata FROM interlude_script_entry WHERE ${filters.join(' AND ')} ORDER BY id ${opts.after != null ? 'ASC' : 'DESC'} LIMIT ?`,
    ).all(...args, limit + 1).map(decodeRow)
    return { rows: rows.slice(0, limit), hasMore: rows.length > limit, total }
  }

  scenes(id: string | null) { return this.rows('interlude_scene', id, 'id DESC', 200) }
  arc(id: string | null) { return this.rows('interlude_arc', id, 'updatedAt DESC,id DESC', 1, "AND status='active'")[0] ?? null }
  overlayPatches(id: string | null) { return this.rows('interlude_state_patch', id, 'id DESC', 200) }
  overlaySnapshots(id: string | null) { return this.rows('interlude_overlay_snapshot', id, 'periodEnd DESC,id DESC', 200) }
  facts(opts: { scope?: string; limit: number }, id: string | null) {
    return this.rows('interlude_fact', id, 'id DESC', bounded(opts.limit, 500), opts.scope ? 'AND scope=?' : '', opts.scope ? [opts.scope] : [])
  }
  intents(opts: { status?: string; limit: number }, id: string | null) {
    return this.rows('interlude_intent', id, 'notBefore ASC,id ASC', bounded(opts.limit, 300), opts.status ? 'AND status=?' : '', opts.status ? [opts.status] : [])
  }
  memories(limit: number, id: string | null) { return this.rows('interlude_memory', id, 'id DESC', bounded(limit, 300)) }
  participants(id: string | null) { return this.rows('interlude_participant', id, 'updatedAt DESC,id ASC', 200) }
  preplan(id: string | null) { return this.rows('interlude_schedule_preplan', id, 'updatedAt DESC', 1)[0] ?? null }
  longArcGuidance(id: string | null) { return this.rows('interlude_long_arc_guidance', id, 'version DESC,id DESC', 20) }

  /** SQLite data_version catches changes to ANY table committed by other connections. */
  revision() {
    try { return Number(this.db.prepare('PRAGMA data_version').get()?.data_version ?? 0) }
    catch { this.reopen(); return Number(this.db.prepare('PRAGMA data_version').get()?.data_version ?? 0) }
  }
}

export type WebconsoleStore = SqliteStore
