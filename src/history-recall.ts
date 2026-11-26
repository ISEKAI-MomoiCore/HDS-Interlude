/** 历史召回与向量：语义历史检索（历史条目向量补齐、余弦+词键混合召回）、
 * 历史向量缓存与失效。打分纯函数（lexicalScore/cosineSimilarity 等）在
 * narrative-normalizers。
 *
 * P8-S3 自 service.ts 迁出（2026-10-29），行为不变；函数接收宿主（service
 * 或测试假宿主）为第一参数，service 保留同名薄委托。向量缓存容器留守
 * service，经宿主引用读写。 */

import { cosineSimilarity } from './narrative-normalizers'
import { recallKeys, scoreOriginal, indexOriginal, type RecallSpan } from './script/recall-navigation'
import { buildEpisodeIndex, episodeExcerpt, episodeTagScore, groundedEpisodeTags } from './script/episode-index'
import { decodeStoryState, encodeStoryState } from './story-state'
import { promptVisibleMessageContent, recentScriptOwnership } from './narrator'
import type { ScriptEntry, RecalledMoment } from './types'

export const RECALLABLE_ENTRY_KINDS = ['user-message', 'character-message', 'script', 'prologue', 'group-message', 'character-group-message']

export type HistoryVectorEntry = {
  spans?: RecallSpan[]
  embeddingIdentity?: string
  tags?: string[]
  frameId?: string
  checkpoint?: { sceneId: number; firstEntryId: number; lastEntryId: number }
  vector?: number[]
  content: string
  occurredAt: string
  participantId: string
  kind: string
}

/** Semantic recall is another view of raw history, so it must obey the same
 * private-branch boundary as recentScript. Group transcripts are deliberately
 * excluded from a private turn unless the owner opted into shared details. */
export function isHistoryEntryVisibleToParticipant(entry: Pick<ScriptEntry, 'participantId' | 'kind'>, participantId: string, shareParticipantDetails: boolean) {
  if (shareParticipantDetails) return true
  if (entry.kind === 'group-message' || entry.kind === 'character-group-message') return false
  return !entry.participantId || entry.participantId === participantId
}

/** P8-S3 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function recallHistory(svc: any, 
    storyId: string,
    participantId: string,
    query: string,
    turnQueryEmbedding: number[],
    excludeIds: Set<number>,
    preferredEntryIds = new Set<number>(),
    maxResults = 3,
  ) {
    await svc.ensureHistoryVectors(storyId)
    const cache = svc.historyVectors.get(storyId)
    if (!cache?.size) return []
    const cacheKey = JSON.stringify([participantId, query, [...excludeIds], [...preferredEntryIds], svc.sharedStoryConfig.shareParticipantDetails])
    const memo = svc.automaticRecallCache?.get(storyId)
    if (maxResults === 1 && memo?.source === cache && memo.size === cache.size && memo.key === cacheKey && memo.until > Date.now()) {
      return memo.result.map((item: any) => ({ ...item, sourceEntryIds: [...(item.sourceEntryIds ?? [])] }))
    }
    const scored: Array<{ id: number, score: number }> = []
    const keys = recallKeys(query).slice(0, 120)
    const primaryKeys = recallKeys(query.split('\n')[0]).slice(0, 80)
    const shareDetails = !!participantId && svc.sharedStoryConfig.shareParticipantDetails
    const identity = svc.embedder?.identity?.()
    let semanticAvailable = 0
    for (const [id, item] of cache) {
      if (excludeIds.has(id)) continue
      if (!isHistoryEntryVisibleToParticipant(item, participantId, shareDetails)) continue
      const semantic = item.embeddingIdentity && item.embeddingIdentity !== identity
        ? undefined : cosineSimilarity(turnQueryEmbedding, item.vector ?? [])
      if (semantic != null) semanticAvailable++
      const spans = item.spans ??= indexOriginal(item.content)
      const lexical = Math.max(scoreOriginal(primaryKeys, spans).score, scoreOriginal(keys, spans).score * 0.8)
      const tagged = episodeTagScore(query, item.tags)
      const source = preferredEntryIds.has(id) ? 1 : 0
      if (source === 0 && tagged === 0 && (semantic == null || semantic < 0.25) && lexical < 0.12) continue
      // Prose similarity alone often recalls a familiar gesture rather than
      // the event. Literal/source matches retain priority over writing style.
      scored.push({ id, score: source * 2 + tagged + Math.max(0, semantic ?? 0) * (item.kind === 'script' || item.kind === 'prologue' ? 0.45 : 1) + lexical })
    }
    // Navigation belongs to the audience, not to this turn's excluded entries.
    const episodeKey = JSON.stringify([storyId, participantId ?? null, svc.sharedStoryConfig.shareParticipantDetails])
    let indexed = svc.episodeIndexes.get(episodeKey)
    if (indexed?.source !== cache || indexed.size !== cache.size) {
      const ordered = [...cache.entries()]
        .filter(([, item]) => isHistoryEntryVisibleToParticipant(item, participantId, shareDetails))
        .sort((left: any, right: any) => left[1].occurredAt.localeCompare(right[1].occurredAt) || left[0] - right[0])
      indexed = { source: cache, size: cache.size, ordered, byEntry: buildEpisodeIndex(ordered) }
      if (svc.episodeIndexes.size >= 64) svc.episodeIndexes.delete(svc.episodeIndexes.keys().next().value!)
      svc.episodeIndexes.set(episodeKey, indexed)
    }
    const visible = indexed.ordered.filter(([id]: any) => !excludeIds.has(id))
    const episodes = indexed.byEntry
    const positions = new Map(visible.map(([id]: any, index: number) => [id, index]))
    const used = new Set<number>()
    const result: RecalledMoment[] = []
    for (const anchor of scored.sort((left: any, right: any) => right.score - left.score || right.id - left.id)) {
      const position = positions.get(anchor.id)
      if (position == null || used.has(anchor.id)) continue
      const episodeIds = episodes.get(anchor.id) ?? [anchor.id]
      const episodeMembers = new Set(episodeIds)
      const neighborhood = episodeIds.length > 1
        ? visible.filter(([id]: any) => episodeMembers.has(id))
        : visible.filter(([, item]: any) => item.participantId === cache.get(anchor.id)!.participantId)
      const excerpt = episodeExcerpt(neighborhood, anchor.id, maxResults === 1 ? 2400 : 4000, keys)
      if (!excerpt) continue
      const { sourceEntryIds, content } = excerpt
      sourceEntryIds.forEach((id: any) => used.add(id))
      result.push({
        id: anchor.id,
        occurredAt: cache.get(anchor.id)!.occurredAt,
        content,
        sourceEntryIds,
      })
      if (result.length >= maxResults) break
    }
    if (maxResults === 1) {
      svc.automaticRecallCache ??= new Map()
      svc.automaticRecallCache.set(storyId, { source: cache, size: cache.size, key: cacheKey, until: Date.now() + 60_000, result })
    }
    // 向量可观测性（diagnostic）：召回是否真的在工作、语义通道覆盖多少，
    // 排障时开诊断密度即可看见。可选调用保护测试假宿主。
    svc.reportStandaloneOperation?.('diagnostic', 'info',
      '历史语义召回 故事=%s 缓存=%d 进入评分=%d 向量可用=%d 召回=%d 查询=%d字',
      storyId, cache.size, scored.length, semanticAvailable, result.length, query.trim().length)
    return result
  }


/** P8-S3 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function ensureHistoryVectors(svc: any, storyId: string) {
    const pending = svc.historyVectorLoads.get(storyId)
    if (pending) return pending
    if (svc.historyVectorsReady.has(storyId)) return
    const cache = new Map<number, HistoryVectorEntry>()
    svc.historyVectors.set(storyId, cache)
    const load = (async () => { try {
      const rows = await svc.dbGet('interlude_script_entry', { storyId }) as ScriptEntry[]
      for (const row of rows) {
        if (!RECALLABLE_ENTRY_KINDS.includes(row.kind)) continue
        if (cache.has(row.id)) continue // a live append/backfill won the race
        cache.set(row.id, {
          embeddingIdentity: typeof row.metadata?.embeddingIdentity === 'string' ? row.metadata.embeddingIdentity : undefined,
          tags: Object.values(groundedEpisodeTags(row.content, (row.metadata?.episodeTags ?? {}) as Record<string, unknown>)).flat(),
          checkpoint: row.metadata?.sceneCheckpoint as HistoryVectorEntry['checkpoint'],
          frameId: typeof row.metadata?.frameId === 'string' ? row.metadata.frameId : undefined,
          ...(row.embedding?.length ? { vector: row.embedding } : {}),
          content: promptVisibleMessageContent(row.content, recentScriptOwnership(row)),
          occurredAt: row.occurredAt.toISOString(),
          participantId: row.participantId,
          kind: row.kind,
        })
      }
      if (svc.historyVectors.get(storyId) === cache) svc.historyVectorsReady.add(storyId)
    } catch (error) {
      svc.historyVectorsReady.delete(storyId)
      svc.reportStandaloneOperation('diagnostic', 'debug', '历史向量缓存加载失败 错误=%s', error)
    } })()
    svc.historyVectorLoads.set(storyId, load)
    try { await load } finally { if (svc.historyVectorLoads.get(storyId) === load) svc.historyVectorLoads.delete(storyId) }
  }


/** P8-S3 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function invalidateHistoryVectors(svc: any, storyId?: string) {
    svc.episodeIndexes.clear()
    if (storyId) {
      svc.historyVectors.delete(storyId)
      svc.historyVectorsReady.delete(storyId)
      svc.historyVectorLoads.delete(storyId)
      svc.automaticRecallCache.delete(storyId)
      return
    }
    svc.historyVectors.clear()
    svc.historyVectorsReady.clear()
    svc.historyVectorLoads.clear()
    svc.automaticRecallCache.clear()
  }


/** P8-S3 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function backfillHistoryEmbeddings(svc: any, storyId: string) {
    if (!svc.config.model.embedding?.enabled || !svc.config.model.embedding.semanticHistory) return
    const batchSize = Math.min(20, Math.max(0, Math.floor(svc.config.model.embedding.backfillBatchSize ?? 5)))
    if (!batchSize || svc.historyBackfills.has(storyId) || Date.now() < (svc.historyBackoff.get(storyId) ?? 0)) return
    svc.historyBackfills.add(storyId)
    const started = Date.now()
    try {
      const identity = svc.embedder.identity?.()
      const story = await svc.getStory(storyId)
      const saved = decodeStoryState(story.state).extensions?.historyBackfill as { cursor?: number; identity?: string } | undefined
      let cursor = saved?.identity === identity && Number.isSafeInteger(saved?.cursor) ? Math.max(0, saved!.cursor!) : 0
      const [older, recent] = await Promise.all([
        svc.dbGet('interlude_script_entry', { storyId, id: { $gt: cursor } }, { limit: 128, sort: { id: 'asc' } }),
        svc.dbGet('interlude_script_entry', { storyId }, { limit: 64, sort: { id: 'desc' } }),
      ]) as [ScriptEntry[], ScriptEntry[]]
      const needsVector = (row: ScriptEntry) => RECALLABLE_ENTRY_KINDS.includes(row.kind) && row.content.trim()
        && (!row.embedding?.length || !!identity && row.metadata?.embeddingIdentity !== identity)
      let attempts = 0
      const completed = new Set<number>()
      const fill = async (row: ScriptEntry) => {
        attempts++
        const embedding = await svc.embedText(row.content, { purpose: '历史向量补齐', density: 'diagnostic' })
        if (!embedding.length) { svc.historyBackoff.set(storyId, Date.now() + 60_000); return false }
        if (svc.embedder.identity?.() !== identity) return false
        await svc.serial(storyId, async () => {
          const [fresh] = await svc.dbGet('interlude_script_entry', { storyId, id: row.id }) as ScriptEntry[]
          if (!fresh || fresh.content !== row.content) return
          await svc.dbSet('interlude_script_entry', { storyId, id: row.id }, {
            embedding, metadata: { ...fresh.metadata, ...(identity ? { embeddingIdentity: identity } : {}) },
          })
          const cached = svc.historyVectors.get(storyId)?.get(row.id)
          if (cached) { cached.vector = embedding; cached.embeddingIdentity = identity }
          svc.automaticRecallCache.delete(storyId)
        })
        completed.add(row.id)
        return true
      }
      // Reserve one live slot only when an archive slot remains. Batch=1 still progresses through history.
      const live = batchSize > 1 ? recent.find(needsVector) : undefined
      if (live && !await fill(live)) return
      for (const row of older) {
        if (needsVector(row) && !completed.has(row.id)) {
          if (attempts >= batchSize || Date.now() - started >= 20_000) break
          if (!await fill(row)) break
        }
        cursor = row.id
      }
      if (!older.length) cursor = 0
      // 向量可观测性：每批一行（standard），attempts=0（本批无待补）静默。
      if (attempts) svc.reportStandaloneOperation?.('standard', 'info',
        '历史向量补齐 故事=%s 尝试=%d 完成=%d 游标=%d 耗时=%dms',
        storyId, attempts, completed.size, cursor, Date.now() - started)
      await svc.serial(storyId, async () => {
        const fresh = await svc.getStory(storyId)
        const state = decodeStoryState(fresh.state)
        await svc.dbSet('interlude_story', { id: storyId }, { state: encodeStoryState({ ...state,
          extensions: { ...state.extensions, historyBackfill: { cursor, identity } },
        }) })
      })
    } finally { svc.historyBackfills.delete(storyId) }
  }

