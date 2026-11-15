/**
 * 语义分析面板数据源：聚合 Alter 轨迹、场景/事实嵌入、叙事连贯度、压缩健康。
 * 桥接命令 'semantic-analysis' 一次返回全部面板所需数据。
 */
import type { InterludeScene, NarrativeFact, ScriptEntry } from './types'

// ── 数据接口（桌面端消费） ─────────────────────────────────────────────────

export interface SemanticAnalysisResult {
  /** 面板 A: 情绪×场景关联 */
  emotionScenes: Array<{
    sceneId: number
    hook: string
    summary: string
    startedAt: string
    endedAt: string | null
    /** 该场景期间的平均 alter 值 */
    avgAlter: number
    /** 场景摘要的嵌入向量（可能无） */
    embedding?: number[]
  }>
  /** 场景间相似度（只返回 >threshold 的对，上三角） */
  sceneSimilarities: Array<{
    sceneA: number
    sceneB: number
    similarity: number
  }>

  /** 面板 B: 语义记忆地图 */
  factMap: Array<{
    factId: number
    content: string
    scope: string
    importance: number
    confidence: number
    unresolved: boolean
    embedding?: number[]
    relatedFactIds: number[]
  }>

  /** 面板 C: 压缩健康 */
  compactionHealth: {
    totalEntries: number
    compressedEntries: number
    coveragePercent: number
    activeScenes: number
    closedScenes: number
    activeFacts: number
    maxFacts: number
    workingDetailCount: number
    expiredWorkingDetails: number
    lastCompactionAt: string | null
    embeddingCoverage: number
    /** 嵌入维度（全部一致时返回，否则 0） */
    embeddingDimension: number
  }

  /** 面板 D: 叙事节奏（相邻 script entry 的余弦相似度） */
  narrativeCoherence: Array<{
    entryId: number
    occurredAt: string
    kind: string
    /** 与前一个有条目嵌入的条目的余弦相似度（第一条为 null） */
    similarityToPrev: number | null
  }>
}

// ── 工具函数 ───────────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}

function extractEmbedding(value: unknown): number[] | undefined {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number') return value as number[]
  return undefined
}

// ── 主入口：由 service.desktopSemanticAnalysis 调用 ────────────────────────

export async function computeSemanticAnalysis(

  dbGet: (table: string, query: unknown, options?: unknown) => Promise<any[]>,
  storyId: string,
  _options?: { sceneSimilarityThreshold?: number },
): Promise<SemanticAnalysisResult> {


  const [scenes, facts, entries] = await Promise.all([
    dbGet('cev_interlude_scene', { storyId }, { sort: { startedAt: 'desc' }, limit: 50 }),
    dbGet('cev_interlude_fact', { storyId, status: 'active' }, { sort: { importance: 'desc' }, limit: 100 }),
    dbGet('cev_interlude_script_entry', { storyId }, { sort: { occurredAt: 'desc', id: 'desc' }, limit: 200 }),
  ] as Array<Promise<any[]>>)

  // ── 面板 A: 场景 + alter 关联 ─────────────────────────────────────────
  const sortedScenes = (scenes as InterludeScene[]).slice().reverse()
  const emotionScenes: SemanticAnalysisResult['emotionScenes'] = []
  for (const scene of sortedScenes) {
    const start = scene.startedAt instanceof Date ? scene.startedAt : new Date(scene.startedAt)
    const end = scene.endedAt instanceof Date ? scene.endedAt : scene.endedAt ? new Date(scene.endedAt) : null
    // 找该时间段内的 alter 值
    const alterEntries = (entries as ScriptEntry[]).filter(e => {
      const at = new Date(e.occurredAt)
      return at >= start && (!end || at <= end) && typeof (e.metadata as any)?.alterValue === 'number'
    })
    const avgAlter = alterEntries.length
      ? alterEntries.reduce((sum, e) => sum + (e.metadata as any).alterValue, 0) / alterEntries.length
      : 0
    emotionScenes.push({
      sceneId: scene.id,
      hook: scene.hook ?? '',
      summary: scene.summary ?? '',
      startedAt: start.toISOString(),
      endedAt: end ? end.toISOString() : null,
      avgAlter: Math.round(avgAlter * 10) / 10,
    })
  }

  // 场景相似度（仅对有嵌入的场景算——当前 scene 表无嵌入列，返回空）
  const sceneSimilarities: SemanticAnalysisResult['sceneSimilarities'] = []
  // TODO: scene embedding 落地后填充

  // ── 面板 B: 事实地图 ──────────────────────────────────────────────────
  const factMap: SemanticAnalysisResult['factMap'] = (facts as NarrativeFact[]).map(fact => ({
    factId: fact.id,
    content: fact.content,
    scope: fact.scope,
    importance: fact.importance,
    confidence: fact.confidence,
    unresolved: fact.unresolved,
    embedding: extractEmbedding(fact.embedding),
    relatedFactIds: fact.knowledge?.relatedFactIds ?? [],
  }))

  // ── 面板 C: 压缩健康 ──────────────────────────────────────────────────
  const allEntries = entries as ScriptEntry[]
  const entriesWithEmbedding = allEntries.filter(e => extractEmbedding(e.embedding))
  const activeScenes = scenes.filter((s: any) => s.status === 'active')
  const closedScenes = scenes.filter((s: any) => s.status === 'closed')
  const dim = entriesWithEmbedding.length > 0 ? (entriesWithEmbedding[0].embedding as number[]).length : 0
  const dimConsistent = dim > 0 && entriesWithEmbedding.every(e => (e.embedding as number[]).length === dim)

  const compactionHealth: SemanticAnalysisResult['compactionHealth'] = {
    totalEntries: allEntries.length,
    compressedEntries: allEntries.filter(e => e.kind === 'script').length,
    coveragePercent: allEntries.length > 0
      ? Math.round((allEntries.filter(e => e.kind === 'script').length / allEntries.length) * 100)
      : 0,
    activeScenes: activeScenes.length,
    closedScenes: closedScenes.length,
    activeFacts: facts.length,
    maxFacts: 200,
    workingDetailCount: 0,   // 由 service 侧填充
    expiredWorkingDetails: 0,
    lastCompactionAt: null,  // 由 service 侧填充
    embeddingCoverage: allEntries.length > 0
      ? Math.round((entriesWithEmbedding.length / allEntries.length) * 100)
      : 0,
    embeddingDimension: dimConsistent ? dim : 0,
  }

  // ── 面板 D: 叙事节奏（按时间正序的 script entry 相邻相似度） ──────────
  const sortedEntries = allEntries
    .filter(e => e.kind === 'script')
    .slice()
    .reverse()
  const narrativeCoherence: SemanticAnalysisResult['narrativeCoherence'] = []
  let prevEmbedding: number[] | undefined
  for (const entry of sortedEntries) {
    const emb = extractEmbedding(entry.embedding)
    const similarity = emb && prevEmbedding ? cosineSimilarity(emb, prevEmbedding) : null
    narrativeCoherence.push({
      entryId: entry.id,
      occurredAt: new Date(entry.occurredAt).toISOString(),
      kind: entry.kind,
      similarityToPrev: similarity !== null ? Math.round(similarity * 1000) / 1000 : null,
    })
    if (emb) prevEmbedding = emb
  }

  return { emotionScenes, sceneSimilarities, factMap, compactionHealth, narrativeCoherence }
}
