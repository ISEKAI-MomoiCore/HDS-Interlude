/** 表情包库与采集：入站表情即时暂存（哈希三重去重+丢弃记忆+每聊天日配额）、
 * 周期看图判定（复用表情包识别连接）与入库交接、本地目录扫描与目录刷新、
 * HTTP 回源路由（ctx.server）、语义过滤与目录排序。纯策略与判定 prompt 在
 * sticker-harvest.ts。
 *
 * P8-S1 自 service.ts 迁出（2026-10-29），行为不变；函数接收宿主（service 或
 * 测试假宿主）为第一参数，service 保留同名薄委托。采集是锁外旁路：不参与
 * 叙事判定，mention-only 群同样可采集。 */
import { shouldHarvestSticker, parseHarvestJudgment, DEFAULT_HARVEST_JUDGMENT_PROMPT } from './sticker-harvest'
import { stableStickerAssetId, stickerMime, listStickerFiles } from './chat-artifacts'

import { createHash } from 'node:crypto'
import { createReadStream, realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { readFile, stat } from 'node:fs/promises'

import { Time, type Session } from 'koishi'
import type { StickerDescription } from './narrator'
import { SEMANTIC_STICKER_LIMIT, rankStickerCatalog } from './narrative-normalizers'
import { sessionGroupId, maskQqIds, isOneBotPlatform } from './session-platform'
import { describeHttpError } from './http-proxy'
import type { StickerAsset } from './types'
import type { GroupChatRule } from './service'

/** P8-S1：自 service.ts 迁入（2026-10-29），行为不变。 */
export const STICKER_DESCRIPTION_RETRY_COOLDOWN = 30 * Time.minute

/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function tryHarvestStickers(svc: any, session: Session, chatType: 'private' | 'group', sources: string[], rule?: GroupChatRule) {
    try {
      if (!svc.stickerHarvestActive || !svc.harvestStore) return
      if (!shouldHarvestSticker(svc.harvestConfig, svc.stickerConfig.enabled, chatType, rule?.stickerHarvest === true)) return
      if (!sources.length) return
      if (String(session.userId ?? '') === String(session.selfId ?? '')) return
      const chatKey = chatType === 'group' ? sessionGroupId(session) : String(session.userId ?? '')
      for (const source of sources.slice(0, 3)) {
        if (!svc.harvestQuota.within(chatKey, svc.harvestConfig.maxPerChatPerDay)) return
        const image = await svc.fetchNativeImage(source, session.bot)
        if (!image?.dataUri) continue
        const outcome = await svc.harvestStore.ingest(
          image.dataUri,
          { platform: String(session.platform ?? ''), chatType, chatKey, senderId: String(session.userId ?? ''), receivedAt: new Date().toISOString() },
          { maxStagingFiles: svc.harvestConfig.maxStagingFiles, maxFileSizeMB: svc.harvestConfig.maxFileSizeMB },
          (hash: any) => svc.harvestLibraryHashIndex().then((index: any) => index.has(hash)),
        )
        if (outcome === 'stored') svc.reportStandaloneOperation('diagnostic', 'debug', '表情包采集已暂存 聊天=%s 来源=%s', chatType, maskQqIds(chatKey))
      }
    } catch (error) {
      svc.reportStandaloneOperation('diagnostic', 'debug', '表情包采集跳过 错误=%s', error)
    }
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function harvestLibraryHashIndex(svc: any) {
    if (svc.harvestLibraryHashes) return svc.harvestLibraryHashes
    try {
      const rows = await svc.dbGet('interlude_sticker', {}) as Array<{ hash?: string }>
      svc.harvestLibraryHashes = new Set(rows.map(row => String(row.hash ?? '')).filter(Boolean))
    } catch {
      svc.harvestLibraryHashes = new Set()
    }
    return svc.harvestLibraryHashes
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function runStickerHarvestScan(svc: any) {
    if (!svc.stickerHarvestActive || svc.harvestScanRunning || !svc.harvestStore || !svc.harvestJudge) return
    const provider = svc.modelRouting.stickers.providers.find((item: any) => item.enabled !== false && item.model?.trim())
    if (!provider) {
      svc.reportStandaloneOperation('diagnostic', 'debug', '表情包采集判定跳过：表情包识别连接不可用（模型中心需勾选"用于表情包描述"）')
      return
    }
    svc.harvestScanRunning = true
    try {
      const staged = await svc.harvestStore.listStaged()
      if (!staged.length) return
      const batch = staged.slice(0, 8)
      const systemPrompt = svc.harvestConfig.harvestPrompt.trim() || DEFAULT_HARVEST_JUDGMENT_PROMPT
      const keptDirectory = join(resolve(svc.ctx.baseDir, svc.stickerConfig.directory), svc.harvestConfig.keptSubfolder)
      let kept = 0, dropped = 0
      for (const item of batch) {
        try {
          const dataUri = await svc.harvestStore.readStagedDataUri(item)
          if (!dataUri) {
            await svc.harvestStore.markDiscarded(item.hash)
            dropped += 1
            continue
          }
          const userText = `来源：${item.provenance.chatType === 'group' ? '群聊' : '私聊'}。判定这张表情图片是否值得加入表情包库。`
          const raw = await svc.harvestJudge.customSideTaskWithImage(
            provider, '表情包采集判定', 60_000, 0.2, 512, systemPrompt, userText, dataUri)
          const judgment = parseHarvestJudgment(JSON.stringify(raw ?? {}))
          if (!judgment) {
            svc.noteHarvestFailure(item.hash, '判定输出无法解析')
            continue
          }
          svc.harvestAttempts.delete(item.hash)
          if (judgment.keep) {
            const target = await svc.harvestStore.markKept(item.hash, keptDirectory)
            if (target) {
              kept += 1
              svc.reportStandaloneOperation('standard', 'info', '表情包采集保留并入库 hash=%s 理由=%s', item.hash.slice(0, 12), judgment.reason)
            }
          } else {
            await svc.harvestStore.markDiscarded(item.hash)
            dropped += 1
            svc.reportStandaloneOperation('diagnostic', 'debug', '表情包采集丢弃 hash=%s 理由=%s', item.hash.slice(0, 12), judgment.reason)
          }
        } catch (error) {
          svc.noteHarvestFailure(item.hash, describeHttpError(error))
        }
      }
      if (kept || dropped) {
        svc.reportStandaloneOperation('standard', 'info', '表情包采集判定完成 本批=%d 保留=%d 丢弃=%d', batch.length, kept, dropped)
        svc.harvestLibraryHashes = undefined
      }
    } finally {
      svc.harvestScanRunning = false
    }
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function noteHarvestFailure(svc: any, hash: string, detail: string) {
    const attempts = (svc.harvestAttempts.get(hash) ?? 0) + 1
    svc.harvestAttempts.set(hash, attempts)
    if (attempts >= 3 && svc.harvestStore) {
      void svc.harvestStore.markDiscarded(hash)
      svc.reportStandaloneOperation('standard', 'warn', '表情包采集判定连续失败%d次，按丢弃处理 hash=%s 原因=%s', attempts, hash.slice(0, 12), detail)
      svc.harvestAttempts.delete(hash)
    } else {
      svc.reportStandaloneOperation('diagnostic', 'debug', '表情包采集判定失败（保留待下轮重试）第%d次 hash=%s 原因=%s', attempts, hash.slice(0, 12), detail)
    }
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function stickerHarvestStatusLines(svc: any) {
    const config = svc.harvestConfig
    const lines = [
      `表情包采集：${svc.stickerHarvestActive ? '已开启' : '未生效'}（表情库${svc.stickerConfig.enabled ? '已启用' : '未启用'}，需两者同时开启）`,
      `私聊采集：${config.privateChats ? '开' : '关'}；群聊采集：按各群规则的"采集表情包"开关`,
      `暂存目录：${config.stagingDirectory}；判定间隔：${config.scanIntervalMinutes} 分钟；单聊天日配额：${config.maxPerChatPerDay}`,
    ]
    if (svc.stickerHarvestActive && svc.harvestStore) {
      const staged = await svc.harvestStore.listStaged()
      const provider = svc.modelRouting.stickers.providers.find((item: any) => item.enabled !== false && item.model?.trim())
      lines.push(`暂存待判定：${staged.length} 张；判定模型：${provider ? `${provider.label || provider.id}（${provider.model}）` : '不可用（模型中心需勾选"用于表情包描述"）'}`)
      const counters = svc.harvestStore.counters
      lines.push(`累计（重载后归零）：暂存 ${counters.staged}、入库 ${counters.kept}、丢弃 ${counters.discarded}、重复跳过 ${counters.deduped}、积压清理 ${counters.evicted}；丢弃记忆 ${svc.harvestStore.discardedMemorySize} 条`)
    }
    return lines
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function scanStickerLibrary(svc: any) {
    const config = svc.stickerConfig
    if (!config.enabled || svc.stickerScanRunning) return
    svc.stickerScanRunning = true
    try {
      const root = resolve(svc.ctx.baseDir, config.directory)
      const files = await listStickerFiles(root)
      const existing = await svc.dbGet('interlude_sticker', {}) as StickerAsset[]
      // 旧版 assetId 折叠缺陷留下的重复行会让每轮扫描在 UNIQUE 约束上崩掉；
      // 扫描前按 assetId/filePath 去重（保留 updatedAt 最新一条），库自愈。
      const dedupeKey = (item: StickerAsset) => `${item.assetId}\u0000${item.filePath}`
      const newestByKey = new Map<string, StickerAsset>()
      for (const item of existing) {
        const key = dedupeKey(item)
        const prior = newestByKey.get(key)
        if (!prior || item.updatedAt > prior.updatedAt) newestByKey.set(key, item)
      }
      for (const item of existing) {
        if (newestByKey.get(dedupeKey(item)) !== item) await svc.dbRemove('interlude_sticker', { id: item.id })
      }
      const deduped = [...newestByKey.values()]
      const byPath = new Map(deduped.map(item => [item.filePath, item]))
      const seen = new Set<string>()
      const pending: Array<{ asset: StickerAsset, bytes: Buffer }> = []
      for (const file of files) {
        const filePath = relative(root, file).replace(/\\/g, '/')
        if (!filePath || filePath.startsWith('../')) continue
        seen.add(filePath)
        try {
          const info = await stat(file)
          if (info.size > config.maxFileSizeMB * 1024 * 1024) continue
          const bytes = await readFile(file)
          const hash = createHash('sha256').update(bytes).digest('hex')
          const prior = byPath.get(filePath)
          if (prior?.hash === hash && prior.status === 'active') continue
          if (prior?.hash === hash && prior.status === 'pending' && Date.now() - prior.updatedAt.getTime() < STICKER_DESCRIPTION_RETRY_COOLDOWN) continue
          const group = filePath.includes('/') ? filePath.split('/')[0] : 'default'
          const assetId = stableStickerAssetId(filePath, hash)
          const now = new Date()
          const base = {
            assetId, filePath, group: group.slice(0, 128), mimeType: stickerMime(filePath), animated: /\.gif$/i.test(filePath),
            size: bytes.length, hash, description: '', aliases: [] as string[], status: 'pending' as const, updatedAt: now,
          }
          const asset = prior
            ? await svc.dbSet('interlude_sticker', { id: prior.id }, base).then(() => ({ ...prior, ...base }))
            : await svc.dbCreate('interlude_sticker', { ...base, createdAt: now }) as StickerAsset
          pending.push({ asset, bytes })
        } catch (error) {
          // A malformed file, old duplicate row, or transient SQLite write must
          // not starve the rest of the library for another five-minute cycle.
          svc.reportStandaloneOperation('standard', 'warn', '表情包素材跳过 文件=%s 错误=%s', filePath, error)
        }
      }
      for (const asset of existing) {
        if (asset.status !== 'missing' && !seen.has(asset.filePath)) await svc.dbSet('interlude_sticker', { id: asset.id }, { status: 'missing', updatedAt: new Date() })
      }
      if (pending.length && !svc.stickerDescriber.available()) {
        svc.reportStandalone('warn', '表情包库发现新素材，但没有配置 useForStickers 的视觉模型；已等待描述。')
      }
      for (const item of pending.slice(0, 5)) {
        if (!svc.stickerDescriber.available()) break
        let description: StickerDescription | undefined
        try {
          const visual = await svc.imageBytesToNative(item.bytes, item.asset.mimeType)
          description = visual && await svc.stickerDescriber.describeSticker(visual.dataUri, visual.mimeType, item.asset.filePath, item.asset.animated, config.descriptionResponseFormat, config.descriptionMaxTokens)
        } catch (error) {
          svc.reportStandaloneOperation('standard', 'warn', '表情包描述失败，已冷却后重试 素材=%s 错误=%s', item.asset.assetId, error)
          await svc.dbSet('interlude_sticker', { id: item.asset.id }, { updatedAt: new Date() })
          continue
        }
        if (!description) {
          svc.reportStandaloneOperation('standard', 'warn', '表情包描述未返回可用 JSON，已冷却后重试 素材=%s', item.asset.assetId)
          await svc.dbSet('interlude_sticker', { id: item.asset.id }, { updatedAt: new Date() })
          continue
        }
        const updated = await svc.dbSet('interlude_sticker', { id: item.asset.id }, {
          description: description.description, aliases: description.aliases, status: 'active', updatedAt: new Date(),
        }) as StickerAsset | undefined
        if (updated && svc.semanticStickerEmbeddingEnabled()) {
          // Index a freshly described asset immediately so the semantic filter
          // can consider it on the very next turn instead of the next scan.
          const embedding = await svc.embedText(`${description.description} ${description.aliases.join(' ')}`.trim(), { purpose: '贴纸向量补齐', density: 'diagnostic' })
          if (embedding.length) await svc.dbSet('interlude_sticker', { id: item.asset.id }, { embedding, updatedAt: new Date() })
        }
        svc.reportStandaloneOperation('standard', 'info', '表情包描述完成 素材=%s 分组=%s', item.asset.assetId, item.asset.group)
      }
      await svc.refreshStickerCatalog()
      await svc.backfillStickerEmbeddings()
      await svc.refreshStickerCatalog()
    } catch (error) {
      svc.reportStandalone('warn', '表情包库扫描失败：%s', error)
    } finally {
      svc.stickerScanRunning = false
    }
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function stickerDeliveryBase(svc: any) {
    const configured = String(svc.stickerConfig.deliveryBaseUrl ?? '').trim()
    if (configured) return configured
    const selfUrl = String((svc.ctx as any).options?.selfUrl ?? (svc.ctx as any).config?.selfUrl ?? '').trim()
    return selfUrl || 'http://127.0.0.1:5140'
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function registerStickerRoute(svc: any) {
    // issue #6：读 ctx.server 而非 ctx.router。@cordisjs/plugin-server 先
    // provide("server") 再 alias("server", ["router"])，而 cordis 的 alias()
    // 在名字已注册时直接早退——router 别名从未真正建立，ctx.router 在当前
    // cordis 上恒为 undefined（官方 plugin-console 5.30 同样只用 ctx.server）。
    // 此前读 ctx.router 导致路由从未注册，分容器部署的表情包回源全部失败。
    if (svc.stickerRouteRegistered || !(svc.ctx as any).server) return
    ;(svc.ctx as any).server.get('/hds-interlude/sticker/:assetId', async (koa: any) => {
      const asset = svc.stickerById.get(koa.params.assetId)
      if (!asset || asset.status !== 'active') { koa.status = 404; return }
      const root = resolve(svc.ctx.baseDir, svc.stickerConfig.directory)
      const file = resolve(root, asset.filePath)
      // 审计 P2-1：resolve/relative 挡不住 root 内符号链接指向目录外——
      // realpath 双侧取真实路径后再做边界判定；root 或文件缺失/损坏同样 404。
      let realFile: string
      let realRoot: string
      try {
        realRoot = realpathSync(root)
        realFile = realpathSync(file)
      } catch { koa.status = 404; return }
      const inside = relative(realRoot, realFile)
      if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || inside.includes(':')) { koa.status = 404; return }
      koa.type = asset.mimeType || 'image/png'
      koa.set('cache-control', 'public, max-age=86400')
      const stream = createReadStream(realFile)
      // 素材可能在响应前被扫描任务清理:流错误回 404,而不是让请求挂起。
      // 审计 P2-2：头已发出后改状态码无效——只能销毁流让连接异常终止，
      // 客户端（OneBot 下载器）按失败重试，不再悬挂。
      stream.on('error', () => {
        if ((koa as { res?: { headersSent?: boolean } })?.res?.headersSent) { stream.destroy(); return }
        koa.status = 404; koa.body = undefined
      })
      koa.body = stream
    })
    // 审计 P2-3：标志在注册成功之后置位——server.get 抛出（如路径冲突）时
    // 保持未注册态，下次发送可重试，而不是永久跳过。
    svc.stickerRouteRegistered = true
    svc.reportStandaloneOperation('diagnostic', 'debug', '表情包回源路由已注册 基址=%s', svc.stickerDeliveryBase())
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function refreshStickerCatalog(svc: any) {
    const rows = await svc.dbGet('interlude_sticker', { status: 'active' }, { sort: { updatedAt: 'desc' } }) as StickerAsset[]
    svc.stickerCatalog = rows
    svc.stickerById = new Map(rows.map(item => [item.assetId, item]))
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function semanticStickerEmbeddingEnabled(svc: any) {
    return svc.config.model.embedding?.semanticStickerFilter === true
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function backfillStickerEmbeddings(svc: any) {
    if (!svc.semanticStickerEmbeddingEnabled()) return
    const pending = svc.stickerCatalog
      .filter((asset: any) => asset.description && !asset.embedding?.length)
      .slice(0, 8)
    if (!pending.length) return
    const startedAt = Date.now()
    let completed = 0
    for (const asset of pending) {
      const text = `${asset.description} ${(asset.aliases ?? []).join(' ')}`.trim()
      const embedding = await svc.embedText(text, { purpose: '贴纸向量补齐', density: 'diagnostic' })
      if (embedding.length) {
        await svc.dbSet('interlude_sticker', { id: asset.id }, { embedding, updatedAt: new Date() })
        completed++
      }
    }
    // 向量可观测性：每批一行（standard）；无待补静默。
    svc.reportStandaloneOperation?.('standard', 'info', '贴纸向量补齐 尝试=%d 完成=%d 耗时=%dms', pending.length, completed, Date.now() - startedAt)
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function stickerCatalogForSession(svc: any, session: Session | undefined, turnQueryEmbedding?: number[]) {
    const config = svc.stickerConfig
    if (!config.enabled || !session || !isOneBotPlatform(session.platform)) return []
    const assets = await svc.rankStickerAssets(turnQueryEmbedding)
    return assets.map((asset: any) => ({
      assetId: asset.assetId, group: asset.group, description: asset.description, aliases: Array.isArray(asset.aliases) ? asset.aliases : [], animated: asset.animated,
    }))
  }


/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function rankStickerAssets(svc: any, turnQueryEmbedding?: number[]) {
    const assets = svc.stickerCatalog.slice(0, svc.stickerConfig.catalogLimit)
    if (!svc.config.model.embedding?.semanticStickerFilter) return assets
    if (!turnQueryEmbedding?.length || assets.length <= SEMANTIC_STICKER_LIMIT) return assets
    const ranked = rankStickerCatalog(assets, turnQueryEmbedding, SEMANTIC_STICKER_LIMIT)
    // 向量可观测性（diagnostic）：过滤是否生效一目了然。可选调用保护测试假宿主。
    svc.reportStandaloneOperation?.('diagnostic', 'info', '贴纸语义过滤 目录=%d 过滤后=%d', assets.length, ranked.length)
    return ranked
  }

