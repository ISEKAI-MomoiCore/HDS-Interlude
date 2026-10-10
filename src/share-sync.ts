/* 分享码同步 —— 与 typ0-site 分享站的机器通道。
 *
 * 安全铁律(与站点 core.mjs 同源):预设只允许携带白名单分区,任何连接类
 * 字段(apiKey/endpoint/proxyAgent/extraHeaders)在拉取后立即被深度剔除;
 * model 与 onebot 永不出现在应用范围内。站点已清洗过一次,插件侧再清洗
 * 一次,构成纵深防御——不信任任何一端的清洗是完备的。
 *
 * 应用语义:
 * - 配置分区(runtime/urge/agency/…)整段替换进插件配置,经 scope.update()
 *   写回 koishi.yml;
 * - storyDefaults 是特例:它不属于"运行时配置"而是"故事档案模板",因此
 *   默认跳过、仅在 --story 标志下同时应用到当前故事(复用 updateSetting)。
 */

import { Context } from 'koishi'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { InterludeService } from './service'
import { StorySetting } from './types'
import { HDS_INTERLUDE_VERSION } from './meta'

export const SHARE_SECTIONS = [
  'storyDefaults', 'runtime', 'urge', 'schedulePreplan', 'timelineDirector', 'agency',
  'chatActions', 'stickers', 'sharedStory', 'memory', 'alterSystem', 'browser',
  'worldSeeder', 'longHorizon', 'qzone', 'blindMode', 'logging',
] as const
export type ShareSection = typeof SHARE_SECTIONS[number]

/** 分区内部绝不允许出现的字段名(深度扫描)。 */
const FORBIDDEN_FIELDS = /^(apiKey|endpoint|extraHeaders|proxyAgent|deliveryBaseUrl|priceInput|priceOutput|priceCachedInput)$/i
const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** 插件侧二次清洗:只保留白名单分区,深度剔除连接类字段。 */
export function sanitizeSharePayload(raw: unknown): { preset: Record<string, unknown>; removed: string[] } {
  if (!isPlainObject(raw)) throw new Error('预设 payload 不是对象。')
  const removed: string[] = []
  const scrub = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) return value.map((item, i) => scrub(item, `${path}[${i}]`))
    if (!isPlainObject(value)) return value
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.test(key) || /^(secret|token|password|authorization)$/i.test(key)) {
        removed.push(`${path}.${key}`)
        continue
      }
      out[key] = scrub(val, `${path}.${key}`)
    }
    return out
  }
  const preset: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if ((SHARE_SECTIONS as readonly string[]).includes(key)) preset[key] = scrub(value, key)
    else removed.push(key)
  }
  return { preset, removed }
}

export interface ShareInfo {
  code: string
  slug: string
  title: string
  type: string
  nsfw: boolean
  author: { id: number; name: string }
  hdsi_version: string
  revision: number
  sections: string[]
  payload: Record<string, unknown>
}

/** 规范化分享码:大写、去连字符与空白;非法返回 null。 */
export function normalizeShareCode(input: string): string | null {
  const code = String(input ?? '').toUpperCase().replace(/[\s-]/g, '')
  return /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(code) ? code : null
}

/** 快照必须深拷贝:存活引用会在 scope.update/updateSetting 原地改动后变成"应用后"的值,回滚失效。 */
export function snapshotDeepCopy<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

/** 从分享站拉取预设并做插件侧清洗。失败时抛出带用户可读信息的 Error。 */
export async function fetchShare(ctx: Context, baseUrl: string, rawCode: string): Promise<{ info: ShareInfo; removed: string[] }> {
  const code = normalizeShareCode(rawCode)
  if (!code) throw new Error('分享码格式不正确:应为 8 位字母数字(大小写均可,可带连字符)。')
  const url = `${baseUrl.replace(/\/$/, '')}/api/share/${code}`
  let status: number
  let body: unknown
  try {
    const response = await ctx.http.get(url, { timeout: 15_000, responseType: 'json' })
    status = 200
    body = response
  } catch (error) {
    const response = (error as any)?.response
    if (response) {
      status = response.status
      body = (await response.json?.().catch(() => ({}))) ?? {}
    } else {
      throw new Error(`无法连接分享站(${baseUrl}):${(error as Error).message}`)
    }
  }
  if (status === 404) throw new Error('分享码不存在、已过期或不可用。作者修改预设后旧码会失效——请到 typ0-site 获取新分享码。')
  if (status === 429) throw new Error('分享站限流:请求过于频繁,请约 1 分钟后重试。')
  if (status !== 200) throw new Error(`分享站返回异常状态 ${status}。`)
  if (!isPlainObject(body)) throw new Error('分享站响应格式异常。')
  // 远端响应 schema 校验:防止旧接口/网关错误/恶意响应被当作有效预设
  const responseCode = normalizeShareCode(String(body.code ?? ''))
  if (responseCode !== code) throw new Error('分享站返回的分享码与请求不一致。')
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) throw new Error('分享站返回的 revision 无效。')
  const sectionsRaw = body.sections
  if (!Array.isArray(sectionsRaw) || !sectionsRaw.every((s) => typeof s === 'string')) {
    throw new Error('分享站返回的 sections 无效。')
  }
  const author = isPlainObject(body.author) ? body.author : {}
  const { preset, removed } = sanitizeSharePayload(body.payload)
  if (!Object.keys(preset).length) throw new Error('该预设经插件侧清洗后没有可应用的分区。')
  return {
    info: {
      code: String(body.code ?? code),
      slug: String(body.slug ?? ''),
      title: String(body.title ?? '(untitled)'),
      type: String(body.type ?? ''),
      nsfw: body.nsfw === true,
      author: { id: Number(author.id ?? 0), name: String(author.name ?? '') },
      hdsi_version: String(body.hdsi_version ?? ''),
      revision: revision,
      sections: Object.keys(preset),
      payload: preset,    },
    removed,
  }
}

export interface SectionDiff {
  section: string
  changed: string[]
  added: string[]
  removedKeys: string[]
}

/** 键序无关的稳定序列化:同内容不同键序不误报"修改"。 */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

/** 计算某分区 远端 vs 本地 的键级差异。 */
export function diffSection(local: unknown, remote: unknown): SectionDiff {
  const localObj = isPlainObject(local) ? local : {}
  const remoteObj = isPlainObject(remote) ? remote : {}
  const changed: string[] = []
  const added: string[] = []
  for (const key of Object.keys(remoteObj)) {
    if (!(key in localObj)) added.push(key)
    else if (stableStringify(localObj[key]) !== stableStringify(remoteObj[key])) changed.push(key)
  }
  const removedKeys = Object.keys(localObj).filter((key) => !(key in remoteObj))
  return { section: '', changed, added, removedKeys }
}

/** storyDefaults(预设侧) → StorySetting patch(插件侧)的字段映射。
 *  与 service.initialStorySetting() 同源;只放入远程实际存在且非空的字段,
 *  空字段跳过——避免部分覆盖时清空当前故事的已有设定。 */
export function storyDefaultsToSettingPatch(defaults: unknown): Partial<StorySetting> {
  const d = isPlainObject(defaults) ? defaults : {}
  const clip = (v: unknown, max: number) => typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined
  const patch: Partial<StorySetting> = {}
  const name = clip(d.characterName, 60)
  const profile = clip(d.characterProfile, 20_000)
  // 只放入远程实际存在的字段:只给 name 时不同时清空 profile
  const character: { name?: string; profile?: string } = {}
  if (name) character.name = name
  if (profile) character.profile = profile
  if (Object.keys(character).length) patch.character = character as StorySetting['character']
  const userProfile = clip(d.userProfile, 20_000)
  if (userProfile) patch.user = { displayName: '', profile: userProfile }
  const relationship = clip(d.relationship, 4_000)
  if (relationship) patch.relationship = relationship
  const world = clip(d.world, 20_000)
  if (world) patch.world = world
  const perspective = clip(d.perspective, 1_200)
  if (perspective) patch.perspective = perspective
  if (Array.isArray(d.perspectives)) {
    const perspectives = d.perspectives.filter((p): p is string => typeof p === 'string' && !!p.trim()).map((p) => p.slice(0, 800)).slice(0, 12)
    if (perspectives.length) patch.perspectives = perspectives
  }
  if (Array.isArray(d.supplementaryFacts)) {
    const supplementaryFacts = d.supplementaryFacts.filter((f): f is string => typeof f === 'string' && !!f.trim()).map((f) => f.slice(0, 800)).slice(0, 20)
    if (supplementaryFacts.length) patch.supplementaryFacts = supplementaryFacts
  }
  const supportingCast = clip(d.supportingCast, 20_000)
  if (supportingCast) patch.supportingCast = supportingCast
  const location = clip(d.location, 500)
  if (location) patch.location = location
  const style = clip(d.style, 20_000)
  if (style) patch.style = style
  const timezone = clip(d.timezone, 60)
  if (timezone) patch.timezone = timezone
  return patch
}

/** 应用配置分区:整段替换进当前 config 的副本,白名单分区以外一概不碰。
 * includeStoryDefaults 时 storyDefaults(故事档案模板)一并写入配置——模板是
 * 新故事的孵化来源,database clear 后重建即取自这里;不写模板的同步成果
 * 活不过一次清库(rc48 修复)。 */
export function buildConfigPatch(config: Record<string, unknown>, preset: Record<string, unknown>, sections: string[], opts: { includeStoryDefaults?: boolean } = {}): Record<string, unknown> {
  const next = { ...config }
  for (const section of sections) {
    if (section === 'storyDefaults' && !opts.includeStoryDefaults) continue // 默认仍走故事设定路径
    if (!(SHARE_SECTIONS as readonly string[]).includes(section)) continue
    if (!isPlainObject(preset[section])) continue
    next[section] = JSON.parse(JSON.stringify(preset[section]))
  }
  return next
}

/** 统一提取版本标识(rc46/beta16 等),避免 '1.0.1-rc46' vs 'rc46' 的误报。 */
function normalizeHdsiVersion(value: string): string {
  return value.match(/(?:rc|beta|alpha)\d+/i)?.[0]?.toLowerCase() ?? value.toLowerCase()
}

export interface ShareSummaryLines {
  header: string[]
  diffs: SectionDiff[]
  configSections: string[]
  storyPatch: Partial<StorySetting>
}

/** 组装 check 输出:标题/作者/版本/分区 + 每分区键级 diff 摘要。 */
export function summarizeShare(service: InterludeService, info: ShareInfo, sections: string[]): ShareSummaryLines {
  const config = service.config as unknown as Record<string, unknown>
  const header = [
    `远程预设:${info.title}`,
    `作者:@${info.author.name} · 类型:${info.type} · 适配 ${info.hdsi_version} · revision ${info.revision}`,
    info.nsfw ? '⚠ 此预设标记为含成人内容(NSFW)' : '',
    HDS_INTERLUDE_VERSION !== info.hdsi_version && normalizeHdsiVersion(HDS_INTERLUDE_VERSION) !== normalizeHdsiVersion(info.hdsi_version)
      ? `⚠ 版本差异:预设来自 ${info.hdsi_version},当前插件 ${HDS_INTERLUDE_VERSION};个别字段可能有出入` : '',
    `包含分区:${info.sections.join('、')}`,
    sections.length !== info.sections.length ? `本次将应用:${sections.join('、')}` : '',
  ].filter(Boolean)
  const diffs = sections
    .filter((s) => s !== 'storyDefaults')
    .map((section) => ({ ...diffSection(config[section], info.payload[section]), section }))
    .filter((d) => d.changed.length || d.added.length || d.removedKeys.length)
  const storyPatch = sections.includes('storyDefaults') ? storyDefaultsToSettingPatch(info.payload.storyDefaults) : {}
  return { header, diffs, configSections: sections.filter((s) => s !== 'storyDefaults'), storyPatch }
}

export function formatDiffLines(summary: ShareSummaryLines): string[] {
  const lines = [...summary.header]
  for (const d of summary.diffs) {
    const parts: string[] = []
    if (d.changed.length) parts.push(`修改 ${d.changed.length} 项(${d.changed.slice(0, 6).join('、')}${d.changed.length > 6 ? '…' : ''})`)
    if (d.added.length) parts.push(`新增 ${d.added.length} 项`)
    if (d.removedKeys.length) parts.push(`移除 ${d.removedKeys.length} 项`)
    lines.push(`- ${d.section}:${parts.join(' · ') || '内容相同'}`)
  }
  if (summary.storyPatch && Object.keys(summary.storyPatch).length) {
    lines.push(`- storyDefaults:写入配置模板(新故事孵化来源,Console 可见),并按配置应用到当前故事(角色名/人设/世界等 ${Object.keys(summary.storyPatch).length} 个字段)`)
  }
  return lines
}

/* ══════════ 同步状态持久化与自动更新 ══════════ */

export interface SyncState {
  code: string
  revision: number
  title: string
  appliedAt: string
  lastError?: string
  configSections?: Record<string, unknown>
  storySetting?: unknown
  storyId?: string | null
}

const syncStateFile = (baseDir: string) => join(baseDir, 'data', 'hds-interlude', 'preset-sync-state.json')

export async function readSyncState(baseDir: string): Promise<SyncState | null> {
  try {
    const text = await fs.readFile(syncStateFile(baseDir), 'utf8')
    return JSON.parse(text) as SyncState
  } catch { return null }
}

export async function writeSyncState(baseDir: string, state: SyncState): Promise<void> {
  const file = syncStateFile(baseDir)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(state, null, 2))
}

export interface AutoUpdateResult {
  applied: boolean
  reason: string
  revision?: number
  title?: string
}

/**
 * 自动/手动同步入口。自动路径(enabled && autoUpdate && shareCode)在重载时执行;
 * 手动路径由 interlude.preset.sync 以 force 调用。
 * - 自动:远端 revision == lastRevision → 跳过(幂等)
 * - 手动(force):revision 未变也强制重新应用
 * - storyDefaults(若选中):同时写入配置模板(Console 可见、清库重建与新故事
 *   的孵化来源)并按 applyToCurrentStory 打到当前故事
 * - 网络失败 → 静默保留本地配置,记录 lastError,不影响启动
 */
export async function runAutoSync(ctx: Context, service: InterludeService, opts: { force?: boolean } = {}): Promise<AutoUpdateResult | null> {
  const sync = service.config.presetSync
  // 手动 sync 只要求 enabled+shareCode;autoUpdate 闸只属于自动路径
  if (!sync?.enabled || !sync.shareCode?.trim()) return null
  if (!opts.force && !sync?.autoUpdate) return null
  const baseUrl = sync.baseUrl?.trim() || 'https://typ0.space'
  const code = sync.shareCode.trim()
  const logger = ctx.logger('hds-interlude')

  try {
    // 拉取远端
    const { info } = await fetchShare(ctx, baseUrl, code)
    const state = await readSyncState(ctx.baseDir)

    // revision 未变 → 自动路径跳过;手动路径强制重新应用
    if (state && state.code === info.code && state.revision === info.revision) {
      if (!opts.force) {
        logger.info('预设同步:远端 revision %d 未变,跳过', info.revision)
        return { applied: false, reason: 'revision 未变', revision: info.revision, title: info.title }
      }
      logger.info('预设同步:revision %d 未变,手动触发强制重新应用', info.revision)
    }

    // 确定要应用的分区
    const sectionFilter = sync.sections?.length ? sync.sections : info.sections
    const sections = info.sections.filter((s) => sectionFilter.includes(s))
    if (!sections.length) {
      logger.warn('预设同步:预设 %s 中没有匹配的分区', info.title)
      return { applied: false, reason: '没有匹配的分区', revision: info.revision, title: info.title }
    }

    const summary = summarizeShare(service, info, sections)
    // 配置写入面 = 运行时分区 + storyDefaults 模板(模板是新故事的孵化来源,
    // 不写模板则清库重建会回退到旧人设——rc48 修复的核心)
    const patchSections = sections.includes('storyDefaults') && isPlainObject(info.payload.storyDefaults)
      ? [...summary.configSections, 'storyDefaults']
      : summary.configSections

    // 应用前快照(深拷贝,防止后续原地修改污染快照)
    const snapshot: Record<string, unknown> = {}
    for (const section of patchSections) {
      snapshot[section] = snapshotDeepCopy((service.config as any)[section] ?? null)
    }

    // 查找当前故事(如需);故事设定快照必须在 updateSetting 之前深拷贝,
    // 否则原地修改会把"应用后"的值写进快照,回滚失效
    let storyForApply = null as any
    let storySettingSnapshot: unknown = null
    if (sync.applyToCurrentStory && Object.keys(summary.storyPatch).length) {
      const stories = await (service as any).dbGet('interlude_story', { status: 'active' }, { limit: 1 })
      storyForApply = stories?.[0] ?? null
      storySettingSnapshot = snapshotDeepCopy(storyForApply?.setting ?? null)
    }

    // 写入配置(含 storyDefaults 模板)
    if (patchSections.length) {
      const patch = buildConfigPatch(service.config as unknown as Record<string, unknown>, info.payload, patchSections, { includeStoryDefaults: true })
      ctx.scope.update(patch as any)
    }

    // 应用故事设定
    if (storyForApply && Object.keys(summary.storyPatch).length) {
      const cleanPatch = JSON.parse(JSON.stringify(summary.storyPatch))
      if (cleanPatch.user && !cleanPatch.user.displayName) delete cleanPatch.user.displayName
      if (cleanPatch.user && !Object.keys(cleanPatch.user).length) delete cleanPatch.user
      await service.updateSetting(storyForApply, cleanPatch)
    }

    // 更新状态
    await writeSyncState(ctx.baseDir, {
      code: info.code,
      revision: info.revision,
      title: info.title,
      appliedAt: new Date().toISOString(),
      configSections: snapshot,
      storySetting: storySettingSnapshot,
      storyId: storyForApply?.id ?? null,
    })

    const changes = summary.diffs.map((d) => `${d.section}(${d.changed.length + d.added.length}项)`).join('、')
    const templateNote = patchSections.includes('storyDefaults') ? '含 storyDefaults 模板' : ''
    logger.info('预设同步:已应用「%s」revision %d(%s%s)', info.title, info.revision, changes || '无变化', templateNote ? `;${templateNote}` : '')
    return { applied: true, reason: `已应用 ${changes || '配置'}${templateNote ? `(${templateNote})` : ''}`, revision: info.revision, title: info.title }
  } catch (error) {
    // 静默保留本地配置,仅记录错误
    const state = await readSyncState(ctx.baseDir).catch(() => null)
    if (state) {
      state.lastError = `${new Date().toISOString()}: ${(error as Error).message}`
      await writeSyncState(ctx.baseDir, state).catch(() => undefined)
    }
    // 404 时给出明确提示(分享码可能因作者修改而过期)
    const is404 = /分享码不存在|已过期/.test((error as Error).message)
    if (is404) {
      logger.warn('预设同步失败:分享码已过期(作者修改了预设,旧码失效)。请到 typ0-site 获取新分享码并更新 Console 配置。')
    } else {
      logger.warn('预设同步失败(保留本地配置):%s', (error as Error).message)
    }
    return { applied: false, reason: is404 ? '分享码已过期,请获取新码' : `失败:${(error as Error).message}` }
  }
}
