/**
 * 表情包采集（stickers.harvest，实验性）：私聊/群聊中他人发送的表情图片
 * 即时落盘暂存，后台周期交给表情包识别连接判定去留；保留的移入表情库
 * keptSubfolder 子目录，由既有 scanStickerLibrary 管线自动编目与描述。
 * 全链路锁外异步，任何失败只降级采集本身，不影响叙事与消息路径。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface StickerHarvestConfig {
  enabled: boolean
  /** 私聊采集开关；群聊开关在每条群规则（groupChats[].stickerHarvest）。 */
  privateChats: boolean
  stagingDirectory: string
  keptSubfolder: string
  scanIntervalMinutes: number
  /** 判定准则提示词；留空使用内置默认。 */
  harvestPrompt: string
  maxPerChatPerDay: number
  maxStagingFiles: number
  maxFileSizeMB: number
}

export const DEFAULT_STICKER_HARVEST_CONFIG: StickerHarvestConfig = {
  enabled: false,
  privateChats: false,
  stagingDirectory: 'data/hds-interlude/sticker-harvest',
  keptSubfolder: 'harvested',
  scanIntervalMinutes: 30,
  harvestPrompt: '',
  maxPerChatPerDay: 20,
  maxStagingFiles: 200,
  maxFileSizeMB: 10,
}

export function resolveStickerHarvestConfig(value: unknown): StickerHarvestConfig {
  const raw = (value ?? {}) as Partial<StickerHarvestConfig>
  const merged: StickerHarvestConfig = { ...DEFAULT_STICKER_HARVEST_CONFIG, ...raw }
  merged.enabled = merged.enabled === true
  merged.privateChats = merged.privateChats === true
  merged.scanIntervalMinutes = Math.max(5, Math.min(1_440, Number(merged.scanIntervalMinutes) || 30))
  merged.maxPerChatPerDay = Math.max(0, Math.min(500, Number(merged.maxPerChatPerDay) || 0))
  merged.maxStagingFiles = Math.max(10, Math.min(2_000, Number(merged.maxStagingFiles) || 200))
  merged.maxFileSizeMB = Math.max(1, Math.min(30, Number(merged.maxFileSizeMB) || 10))
  merged.stagingDirectory = String(merged.stagingDirectory ?? '').trim() || DEFAULT_STICKER_HARVEST_CONFIG.stagingDirectory
  // 子目录是表情库一级分组名，禁止路径分隔符逃逸分组结构。
  merged.keptSubfolder = String(merged.keptSubfolder ?? '').trim().replace(/[\\/]+/g, '') || 'harvested'
  merged.harvestPrompt = String(merged.harvestPrompt ?? '')
  return merged
}

/** 内置判定准则；harvestPrompt 非空时整体替换。 */
export const DEFAULT_HARVEST_JUDGMENT_PROMPT = [
  '你正在为一位聊天角色的表情包库筛选新表情。对给出的图片判定去留。',
  '保留：情绪或语义表达清晰；通用性强，可在多种日常语境使用；画面质量可接受。',
  '丢弃：低俗、暴力或敏感内容；纯文字截图或聊天记录；带二维码、广告或明显水印；时效性内容（带日期的梗图）；画面模糊无法辨认。',
  '只返回 JSON：{"keep": true 或 false, "reason": "简短理由", "tags": ["可选标签"]}',
].join('\n')

export interface HarvestJudgment {
  keep: boolean
  reason: string
  tags?: string[]
}

/** 宽容解析：提取首个 JSON 对象，keep 非布尔视为无效。 */
export function parseHarvestJudgment(text: string): HarvestJudgment | undefined {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return undefined
  try {
    const parsed = JSON.parse(match[0]) as { keep?: unknown, reason?: unknown, tags?: unknown }
    if (typeof parsed.keep !== 'boolean') return undefined
    const tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6).map(tag => String(tag)).filter(Boolean) : undefined
    return { keep: parsed.keep, reason: String(parsed.reason ?? '').slice(0, 200), ...(tags?.length ? { tags } : {}) }
  } catch {
    return undefined
  }
}

export interface HarvestProvenance {
  platform: string
  chatType: 'private' | 'group'
  /** private=对方 userId；group=groupId。 */
  chatKey: string
  senderId: string
  receivedAt: string
}

export interface HarvestCounters {
  staged: number
  kept: number
  discarded: number
  deduped: number
  evicted: number
}

export type HarvestIngestOutcome = 'stored' | 'duplicate' | 'quota' | 'skipped'

export interface StagedHarvestFile {
  hash: string
  /** 暂存目录内的图片文件名（含扩展名）。 */
  fileName: string
  provenance: HarvestProvenance
}

function imageExtension(mimeType: string): string {
  if (mimeType.includes('gif')) return 'gif'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('bmp')) return 'bmp'
  return 'png'
}

/** 每聊天每日配额（进程内存；重载归零——采集是可丢失的旁路，不值得持久化）。 */
export class DailyQuotaTracker {
  private readonly counts = new Map<string, { date: string, count: number }>()

  within(chatKey: string, maxPerDay: number): boolean {
    if (maxPerDay <= 0) return false
    const today = new Date().toISOString().slice(0, 10)
    const entry = this.counts.get(chatKey)
    if (!entry || entry.date !== today) {
      this.counts.set(chatKey, { date: today, count: 1 })
      return true
    }
    if (entry.count >= maxPerDay) return false
    entry.count += 1
    return true
  }
}

/** 暂存存储：哈希命名 + 来源 sidecar + 丢弃记忆（防同一张被拒表情反复判定）。
 * 所有方法永不上抛——采集失败只降级为跳过。 */
export class StickerHarvestStore {
  private readonly discardedHashes: string[] = []
  private readonly discardedSet = new Set<string>()
  readonly counters: HarvestCounters = { staged: 0, kept: 0, discarded: 0, deduped: 0, evicted: 0 }

  constructor(
    private readonly directory: string,
    private readonly logger?: { debug?: (template: string, ...args: unknown[]) => void },
    private readonly maxDiscardMemory = 2_000,
  ) {}

  /** 测试与状态命令用：丢弃记忆规模。 */
  get discardedMemorySize() { return this.discardedSet.size }

  private hashFromFileName(fileName: string) {
    const dot = fileName.lastIndexOf('.')
    return dot > 0 ? fileName.slice(0, dot) : fileName
  }

  private rememberDiscarded(hash: string) {
    if (this.discardedSet.has(hash)) return
    this.discardedSet.add(hash)
    this.discardedHashes.push(hash)
    while (this.discardedHashes.length > this.maxDiscardMemory) {
      this.discardedSet.delete(this.discardedHashes.shift()!)
    }
  }

  hasDiscarded(hash: string) { return this.discardedSet.has(hash) }

  async listStaged(): Promise<StagedHarvestFile[]> {
    try {
      const names = await readdir(this.directory)
      const images = names.filter(name => !name.endsWith('.json'))
      const staged: StagedHarvestFile[] = []
      for (const fileName of images) {
        let provenance: HarvestProvenance = { platform: '', chatType: 'private', chatKey: '', senderId: '', receivedAt: '' }
        try {
          const manifest = JSON.parse(await readFile(join(this.directory, `${fileName}.json`), 'utf8')) as HarvestProvenance
          if (manifest && typeof manifest === 'object') provenance = manifest
        } catch { /* 缺失或损坏的 sidecar 不阻止判定，仅丢失来源上下文。 */ }
        staged.push({ hash: this.hashFromFileName(fileName), fileName, provenance })
      }
      return staged
    } catch {
      return []
    }
  }

  async ingest(
    dataUri: string,
    provenance: HarvestProvenance,
    limits: { maxStagingFiles: number, maxFileSizeMB: number },
    libraryHasHash?: (hash: string) => boolean | Promise<boolean>,
  ): Promise<HarvestIngestOutcome> {
    try {
      const base64 = dataUri.slice(dataUri.indexOf(',') + 1)
      const bytes = Buffer.from(base64, 'base64')
      if (!bytes.length) return 'skipped'
      const mimeType = /^data:([^;,]+)/.exec(dataUri)?.[1] ?? ''
      if (!mimeType.startsWith('image/') || mimeType === 'image/unknown') return 'skipped'
      if (bytes.length > limits.maxFileSizeMB * 1024 * 1024) return 'skipped'
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (this.discardedSet.has(hash)) return 'duplicate'
      if (await libraryHasHash?.(hash)) {
        this.counters.deduped += 1
        return 'duplicate'
      }
      const staged = await this.listStaged()
      if (staged.some(item => item.hash === hash)) return 'duplicate'
      // 积压上限：最旧的直接清理，不再消耗判定调用。
      const sorted = [...staged].sort((a, b) => a.provenance.receivedAt.localeCompare(b.provenance.receivedAt))
      while (sorted.length >= limits.maxStagingFiles) {
        const oldest = sorted.shift()!
        await this.removeStaged(oldest.fileName)
        this.counters.evicted += 1
      }
      await mkdir(this.directory, { recursive: true })
      const fileName = `${hash}.${imageExtension(mimeType)}`
      await writeFile(join(this.directory, fileName), bytes)
      await writeFile(join(this.directory, `${fileName}.json`), JSON.stringify({ ...provenance, hash }, null, 2), 'utf8')
      this.counters.staged += 1
      return 'stored'
    } catch (error) {
      this.logger?.debug?.('表情包采集暂存失败（忽略）错误=%s', error)
      return 'skipped'
    }
  }

  /** 读取暂存图为 dataUri（判定模型的图片输入）；读取失败返回 undefined。 */
  async readStagedDataUri(item: StagedHarvestFile): Promise<string | undefined> {
    try {
      const bytes = await readFile(join(this.directory, item.fileName))
      const ext = item.fileName.slice(item.fileName.lastIndexOf('.') + 1).toLowerCase()
      const mimeType = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : ext === 'bmp' ? 'image/bmp' : 'image/jpeg'
      return `data:${mimeType};base64,${bytes.toString('base64')}`
    } catch {
      return undefined
    }
  }

  /** 保留：移入表情库目标目录（含 sidecar 清理），返回目标绝对路径。 */
  async markKept(hash: string, targetDirectory: string): Promise<string | undefined> {
    try {
      const staged = await this.listStaged()
      const item = staged.find(entry => entry.hash === hash)
      if (!item) return undefined
      await mkdir(targetDirectory, { recursive: true })
      const target = join(targetDirectory, item.fileName)
      await rename(join(this.directory, item.fileName), target)
      await rm(join(this.directory, `${item.fileName}.json`), { force: true })
      this.counters.kept += 1
      return target
    } catch (error) {
      this.logger?.debug?.('表情包采集入库失败（保留在暂存区等待重试）hash=%s 错误=%s', hash, error)
      return undefined
    }
  }

  /** 丢弃：删除暂存文件并写入丢弃记忆，同一张图不再重复进入判定。 */
  async markDiscarded(hash: string): Promise<void> {
    try {
      const staged = await this.listStaged()
      const item = staged.find(entry => entry.hash === hash)
      if (item) await this.removeStaged(item.fileName)
      this.rememberDiscarded(hash)
      this.counters.discarded += 1
    } catch (error) {
      this.logger?.debug?.('表情包采集丢弃清理失败（忽略）hash=%s 错误=%s', hash, error)
    }
  }

  private async removeStaged(fileName: string) {
    await rm(join(this.directory, fileName), { force: true })
    await rm(join(this.directory, `${fileName}.json`), { force: true })
  }
}

/** 采集门控：总开关 + 聊天类型开关（群聊看每群规则的 stickerHarvest）。 */
export function shouldHarvestSticker(
  config: StickerHarvestConfig,
  stickersEnabled: boolean,
  chatType: 'private' | 'group',
  groupRuleStickerHarvest = false,
): boolean {
  if (!config.enabled || !stickersEnabled) return false
  return chatType === 'private' ? config.privateChats : groupRuleStickerHarvest
}
