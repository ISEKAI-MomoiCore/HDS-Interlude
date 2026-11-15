import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService, embeddingDegradationNotice } from '../src/service'
import { semanticFactStats } from '../src/narrative-normalizers'
import { recallHistory } from '../src/history-recall'
import { backfillFactEmbeddings } from '../src/compaction/pipeline'
import { rankStickerAssets } from '../src/sticker-library'

/** 向量检索可观测性（分级日志）回归：
 * - 回合向量成功 = standard info；请求失败 = standard warn（降级必须可见）；
 *   本地跳过（SilentEmbedder/未启用）= diagnostic debug。
 * - Embedding 已启用但无可用连接的静默降级 → 启动 standard warn（纯函数判定）。
 * - 事实语义重排统计（semanticFactStats）供 facts() diagnostic 行。
 * - 补齐批次行（standard/summary）、贴纸过滤行、历史召回行。 */

function embedTextHost(embed: (value: string) => Promise<number[]>) {
  const lines: Array<{ density: string, level: string, message: string, args: unknown[] }> = []
  const service: any = Object.create(InterludeService.prototype)
  service.embedder = { embed }
  service.modelRouting = { embedding: { assigned: true, providers: [{ model: 'text-embedding-3-small' }], target: { model: 'text-embedding-3-small' } } }
  service.config = { model: { embedding: { model: '' } } }
  service.reportStandaloneOperation = (density: string, level: string, message: string, ...args: unknown[]) => { lines.push({ density, level, message, args }) }
  return { service, lines }
}

test('embedText 成功：standard info 一行，含模型/维度/耗时', async () => {
  const { service, lines } = embedTextHost(async () => [0.1, 0.2, 0.3])
  const vector = await service.embedText('她昨晚说要去图书馆')
  assert.deepEqual(vector, [0.1, 0.2, 0.3])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].density, 'standard')
  assert.equal(lines[0].level, 'info')
  assert.match(lines[0].message, /向量请求完成/)
  assert.equal(lines[0].args[0], '回合检索')
  assert.equal(lines[0].args[1], 'text-embedding-3-small')
})

test('embedText 失败：升级为 standard warn（降级可见），仍返回空数组不阻塞回合', async () => {
  const { service, lines } = embedTextHost(async () => { throw new Error('gateway 502') })
  const vector = await service.embedText('查询')
  assert.deepEqual(vector, [])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].density, 'standard')
  assert.equal(lines[0].level, 'warn')
  assert.match(lines[0].message, /降级为规则排序/)
  assert.match(String(lines[0].args.at(-1)), /gateway 502/)
})

test('embedText 本地跳过（SilentEmbedder 空向量）：diagnostic debug，不打扰标准档', async () => {
  const { service, lines } = embedTextHost(async () => [])
  assert.deepEqual(await service.embedText('查询'), [])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].density, 'diagnostic')
  assert.equal(lines[0].level, 'debug')
  assert.match(lines[0].message, /本地跳过/)
})

test('embedText 后台补齐调用传 density=diagnostic：成功行降密度，由批次行汇总', async () => {
  const { service, lines } = embedTextHost(async () => [0.5])
  await service.embedText('事实内容', { purpose: '事实向量补齐', density: 'diagnostic' })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].density, 'diagnostic')
  assert.equal(lines[0].args[0], '事实向量补齐')
})

test('启动降级警告：启用但路由不可用才提示，其余组合静默', () => {
  const unavailable = { embedding: { available: false, assigned: false, providers: [], target: { model: '' } } } as any
  const available = { embedding: { available: true, assigned: true, providers: [{ model: 'm' }], target: { model: 'm' } } } as any
  assert.match(embeddingDegradationNotice({ embedding: { enabled: true } } as any, unavailable)!, /用作 Embedding/)
  assert.equal(embeddingDegradationNotice({ embedding: { enabled: true } } as any, available), undefined)
  assert.equal(embeddingDegradationNotice({ embedding: { enabled: false } } as any, unavailable), undefined)
  assert.equal(embeddingDegradationNotice({} as any, unavailable), undefined)
})

test('semanticFactStats：候选/有向量/语义命中/最高相似度', () => {
  const query = [1, 0]
  const facts: any[] = [
    { embedding: [1, 0] },     // 相似度 1.0，命中
    { embedding: [0.6, 0.8] }, // 相似度 0.6，命中
    { embedding: [-1, 0] },    // 负相关不计命中
    { embedding: [] },         // 无向量（与 undefined 等价）
    {},                        // 无向量
  ]
  const stats = semanticFactStats(facts, query)
  assert.equal(stats.candidates, 5)
  assert.equal(stats.withVector, 3)
  assert.equal(stats.hits, 2)
  assert.equal(stats.topSimilarity!.toFixed(2), '1.00')
})

test('backfillFactEmbeddings：批次行报补齐/剩余/耗时，全部补齐升 summary', async () => {
  const fact = (id: number, embedding?: number[]) => ({ id, storyId: 's', status: 'active', content: `事实${id}`, embedding, updatedAt: new Date() })
  const lines: Array<{ density: string, message: string, args: unknown[] }> = []
  const svc: any = {
    taskGeneration: () => 1,
    taskGenerationCurrent: () => true,
    dbGet: async () => [fact(1, [0.1]), fact(2, [0.1]), fact(3), fact(4), fact(5)],
    embedText: async () => [0.2, 0.3],
    dbSet: async () => {},
    reportStandaloneOperation: (density: string, _level: string, message: string, ...args: unknown[]) => { lines.push({ density, message, args }) },
  }
  await backfillFactEmbeddings(svc, 's', 5)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].density, 'summary', '剩余 0 时升 summary')
  assert.match(lines[0].message, /事实向量补齐/)
  assert.deepEqual([lines[0].args[1], lines[0].args[2]], [3, 0])

  lines.length = 0
  await backfillFactEmbeddings(svc, 's', 2)
  assert.equal(lines[0].density, 'standard')
  assert.deepEqual([lines[0].args[1], lines[0].args[2]], [2, 1])

  lines.length = 0
  svc.dbGet = async () => [fact(1, [0.1])]
  await backfillFactEmbeddings(svc, 's', 5)
  assert.equal(lines.length, 0, '无待补时静默，不刷屏')
})

test('rankStickerAssets：语义过滤生效时报 diagnostic 行（目录/过滤后）', async () => {
  const lines: string[] = []
  const assets = Array.from({ length: 20 }, (_, index) => ({
    assetId: `a${index}`, group: 'g', description: `贴纸${index}`, aliases: [], animated: false, embedding: [1, index % 2],
  }))
  const svc: any = {
    stickerCatalog: assets,
    stickerConfig: { catalogLimit: 40 },
    config: { model: { embedding: { semanticStickerFilter: true } } },
    reportStandaloneOperation: (_density: string, _level: string, message: string, ...args: unknown[]) => { lines.push(`${message} ${args.join(' ')}`) },
  }
  const ranked = await rankStickerAssets(svc, [1, 0])
  assert.equal(ranked.length, 12)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /贴纸语义过滤/)
  assert.match(lines[0], /20 12/)
  // 无报告方法的测试假宿主不得因日志而崩（可选调用保护）。
  const silent: any = { ...svc }
  delete silent.reportStandaloneOperation
  await rankStickerAssets(silent, [1, 0])
})

test('recallHistory：召回结束报 diagnostic 行；无日志方法的宿主不崩', async () => {
  const lines: string[] = []
  const entry = (id: number, vector?: number[]) => [id, {
    content: `历史内容${id}`, occurredAt: new Date().toISOString(), participantId: 'p1', kind: 'user-message',
    ...(vector ? { vector } : {}),
  }] as [number, any]
  const svc: any = {
    ensureHistoryVectors: async () => {},
    historyVectors: new Map([['s', new Map([[1, entry(1)[1]], [2, entry(2, [0.5, 0.5])[1]]])]]),
    sharedStoryConfig: { shareParticipantDetails: false },
    embedder: { identity: () => 'identity-a' },
    automaticRecallCache: new Map(),
    episodeIndexes: new Map(),
    reportStandaloneOperation: (_density: string, _level: string, message: string, ...args: unknown[]) => { lines.push(`${message} ${args.join(' ')}`) },
  }
  const result = await recallHistory(svc, 's', 'p1', '历史内容', [1, 0], new Set<number>())
  assert.ok(Array.isArray(result))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /历史语义召回/)
  assert.match(lines[0], /s 2 2 1 1 4$/, '故事/缓存/评分/向量可用/召回/查询字数')

  const silent: any = { ...svc }
  delete silent.reportStandaloneOperation
  await recallHistory(silent, 's', 'p1', '历史内容', [1, 0], new Set<number>())
})
