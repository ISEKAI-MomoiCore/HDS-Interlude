import assert from 'node:assert/strict'
import test from 'node:test'
import { performance } from 'node:perf_hooks'
import { InterludeService } from '../src/service'
import { emptyStoryState } from '../src/types'
import { indexOriginal, scoreOriginal, recallKeys, recallFocus, originalWindow } from '../src/script/recall-navigation'
import { episodeExcerpt } from '../src/script/episode-index'
import { promptReadyDevelopment } from '../src/script/development'
import { OpenAICompatibleEmbedder } from '../src/narrator'

const proto = InterludeService.prototype as any
const now = new Date('2026-09-06T12:00:00Z')
const entry = (id: number, content = `原始记录 ${id}`, participantId = 'alice'): any => ({
  id, storyId: 's', content, participantId, kind: 'user-message', actor: 'user',
  occurredAt: now, createdAt: now, metadata: {},
})

test('provisional development reaches the compactor only after independent scenes', () => {
  const candidate: any = { status: 'proposed', sourceEntryIds: [1, 2, 3] }
  const script = (id: number, frame: string) => ({ ...entry(id), kind: 'script', actor: 'narrator', metadata: { frameId: frame } })
  assert.equal(promptReadyDevelopment(candidate, [script(1, 'same'), script(2, 'same'), script(3, 'same')]), false)
  assert.equal(promptReadyDevelopment(candidate, [script(1, 'a'), script(2, 'b'), script(3, 'b')]), true)
  assert.equal(promptReadyDevelopment({ ...candidate, status: 'applied' }, [script(1, 'same')]), true)
})

test('relationship development without received feedback never reaches proposal storage', async () => {
  let consulted = false
  const service: any = {
    memoryConfig: { statePatchMinTurns: 3, statePatchMinDays: 2, statePatchConfidenceThreshold: .8 },
    dbGet: async () => { consulted = true; return [] }, reportOperation: () => {},
  }
  await proto.persistStatePatch.call(service,
    { id: 's', setting: { timezone: 'Asia/Shanghai' } },
    { target: 'relationship', participantId: 'alice', path: 'closeness', proposedValue: '这段关系会在共同活动中更愿意协作。', evidence: '单次互动', sourceEntryIds: [1] },
    [entry(1)], now)
  assert.equal(consulted, false)
})

function backfillHost(rows: any[], batchSize = 5) {
  let state: any = { ...emptyStoryState(), extensions: { unrelated: 'preserved' } }
  const calls: string[] = []
  const queries: any[] = []
  const host: any = {
    config: { model: { embedding: { enabled: true, semanticHistory: true, backfillBatchSize: batchSize } } },
    embedder: { identity: () => 'model-a' }, historyBackfills: new Set(), historyBackoff: new Map(), historyVectors: new Map(), automaticRecallCache: new Map(),
    getStory: async () => ({ id: 's', state }), serial: async (_id: string, fn: () => any) => fn(),
    embedText: async (text: string) => { calls.push(text); return [1, 0] },
    dbGet: async (_table: string, query: any, options: any = {}) => {
      queries.push({ query, options })
      let result = rows.filter(row => row.storyId === query.storyId
        && (typeof query.id === 'number' ? row.id === query.id : row.id > (query.id?.$gt ?? -1)))
      result = [...result].sort((a, b) => options.sort?.id === 'desc' ? b.id - a.id : a.id - b.id)
      return result.slice(0, options.limit ?? result.length)
    },
    dbSet: async (table: string, query: any, patch: any) => {
      if (table === 'interlude_story') state = patch.state
      else Object.assign(rows.find(row => row.id === query.id), patch)
    },
  }
  return { host, calls, queries, state: () => state }
}

test('P1 archive cursor reaches records outside latest 4000 with a strict shared attempt budget', async () => {
  const rows = Array.from({ length: 5002 }, (_, i) => entry(i + 1))
  const { host, calls, queries, state } = backfillHost(rows)
  await proto.backfillHistoryEmbeddings.call(host, 's')
  assert.equal(calls.length, 5)
  assert.deepEqual(rows.filter(row => row.embedding).map(row => row.id), [1, 2, 3, 4, 5002])
  assert.equal(state().extensions.historyBackfill.cursor, 4)
  assert.equal(state().extensions.unrelated, 'preserved')
  await proto.backfillHistoryEmbeddings.call(host, 's')
  assert.equal(calls.length, 10)
  assert.equal(state().extensions.historyBackfill.cursor, 8)
  assert.ok(queries.every(q => !q.options.limit || q.options.limit <= 128))
})

test('P1 batch one, restart cursor and model change progress without clearing old vectors', async () => {
  const rows = [entry(1), entry(2), entry(3)]
  rows[0].embedding = [0, 1]; rows[0].metadata.embeddingIdentity = 'older-model'
  const { host, calls, state } = backfillHost(rows, 1)
  await proto.backfillHistoryEmbeddings.call(host, 's')
  assert.equal(calls.length, 1)
  assert.equal(rows[0].metadata.embeddingIdentity, 'model-a')
  host.historyBackfills = new Set() // process-local state can be lost
  await proto.backfillHistoryEmbeddings.call(host, 's')
  assert.equal(state().extensions.historyBackfill.cursor, 2)
  host.embedder.identity = () => 'model-b'
  await proto.backfillHistoryEmbeddings.call(host, 's')
  assert.equal(rows[0].metadata.embeddingIdentity, 'model-b')
  assert.equal(rows[1].metadata.embeddingIdentity, 'model-a', 'no eager destructive rebuild')
})

test('P1 backfill is single-flight, preserves concurrent ledger updates, backs off on failure', async () => {
  const rows = [entry(1)]
  const { host, calls, state } = backfillHost(rows, 1)
  let release!: () => void
  host.embedText = async () => { calls.push('one'); await new Promise<void>(resolve => { release = resolve }); return [1, 0] }
  const pending = proto.backfillHistoryEmbeddings.call(host, 's')
  while (!release) await Promise.resolve()
  await proto.backfillHistoryEmbeddings.call(host, 's')
  rows[0].metadata.delivery = { status: 'delivered' }
  release(); await pending
  assert.equal(calls.length, 1)
  assert.equal(rows[0].metadata.delivery.status, 'delivered')
  assert.equal(state().extensions.historyBackfill.cursor, 1)
  rows.push(entry(2))
  host.embedText = async () => { calls.push('failed'); return [] }
  await proto.backfillHistoryEmbeddings.call(host, 's')
  await proto.backfillHistoryEmbeddings.call(host, 's')
  assert.equal(calls.length, 2)
  assert.equal(state().extensions.historyBackfill.cursor, 1)
})

test('P1 long original tail and its conditional sentence survive bounded exact-span recall', () => {
  const content = '她整理了一页普通笔记。'.repeat(600) + '\n如果电影好看，我想再和你一起看一次。取餐码是 8914。\n她收起手机，继续手边的事。'
  const spans = indexOriginal(content)
  const hit = scoreOriginal(recallKeys('电影 8914'), spans)
  assert.ok(hit.score > 0)
  const window = originalWindow(content, spans, hit.index, 2200)
  assert.equal(window.content, content.slice(window.start, window.end))
  assert.match(window.content, /如果电影好看，我想再和你一起看一次/)
  const excerpt = episodeExcerpt([[1, { content, kind: 'script', participantId: 'alice', occurredAt: now.toISOString(), spans }]], 1, 2400, recallKeys('电影 8914'))!
  assert.ok(excerpt.content.length <= 2400)
  assert.match(excerpt.content, /8914/)
  assert.match(excerpt.content, /not a complete event/)
  assert.deepEqual(excerpt.sourceEntryIds, [1])
  const unpunctuated = '普通笔记'.repeat(2000) + '取餐码8914'
  const longLine = episodeExcerpt([[2, { content: unpunctuated, kind: 'script', participantId: 'alice', occurredAt: now.toISOString() }]],
    2, 2400, recallKeys('取餐码8914'))!
  assert.match(longLine.content, /取餐码8914/)
  assert.ok(longLine.content.length <= 2400)
})

test('P1 detail handoff uses newer same-owner evidence, preserves identity age and blocks stale resurrection', async () => {
  let state: any = { ...emptyStoryState(), workingDetails: [{ label: '休息', value: '想睡觉', participantId: 'alice',
    createdAt: '2026-09-05T12:00:00.000Z', sourceEntryIds: [10] }] }
  const host: any = { memoryConfig: { sceneHookCharacters: 100, sceneSummaryCharacters: 300, arcSummaryCharacters: 300 },
    dbGet: async () => [], dbSet: async (table: string, _q: any, patch: any) => { if (table === 'interlude_story') state = patch.state },
    getStory: async () => ({ id: 's', state }), activeArc: async () => ({ id: 1 }),
  }
  const review = async (id: number, label: string, replacesLabel?: string, owner = 'alice', mode = 'reported') => {
    const row = entry(id, '我现在不睡了，正在玩游戏', owner)
    return proto.persistCompactionOutputs.call(host, { id: 's' }, { id: 1, entryCount: 0 }, {
      scene: { summary: '生活继续' }, arc: { summary: '原剧情弧' }, workingDetails: [{ label, replacesLabel,
        value: row.content, sourceEntryIds: [id], knowledge: { mode, clauses: [{ role: 'observation', sourceEntryId: id, quote: row.content }] } }],
    }, [row], now)
  }
  await review(9, '休息')
  assert.equal(state.workingDetails[0].value, '想睡觉')
  await review(11, '当前活动', '休息', 'bob')
  assert.equal(state.workingDetails.length, 1)
  assert.equal(state.workingDetails[0].label, '休息')
  await review(12, '当前活动', '休息', 'alice', 'belief')
  assert.equal(state.workingDetails[0].label, '休息')
  await review(13, '当前活动', '休息')
  assert.equal(state.workingDetails.length, 1)
  assert.equal(state.workingDetails[0].label, '当前活动')
  assert.equal(state.workingDetails[0].createdAt, '2026-09-05T12:00:00.000Z')
  assert.equal(state.workingDetailResolutions.休息, 13)
  await review(14, '当前活动', undefined, 'alice', 'belief')
  assert.deepEqual(state.workingDetails[0].sourceEntryIds, [13], 'a newer belief cannot overwrite an evidenced state')
  await review(12, '休息')
  assert.equal(state.workingDetails.length, 1)
})

test('P1 embedding identity follows effective route and dimensions, never credentials', () => {
  const config: any = { embedding: { endpoint: '', dimensions: 1536, maxInputCharacters: 4000 } }
  const routing: any = { embedding: { assigned: true, providers: [{ endpoint: 'https://example.invalid/v1/chat/completions', model: 'embedding-a', apiKey: 'secret-a' }], target: { model: 'ignored' } } }
  const embedder = new OpenAICompatibleEmbedder({} as any, config, routing)
  const first = embedder.identity()
  routing.embedding.providers[0].apiKey = 'secret-b'
  assert.equal(embedder.identity(), first)
  config.embedding.dimensions = 768
  assert.notEqual(embedder.identity(), first)
})

test('P1 cold-load requests join one promise and do not overwrite a concurrent live cache entry', async () => {
  let release!: (rows: any[]) => void
  let calls = 0
  const host: any = { historyVectors: new Map(), historyVectorsReady: new Set(), historyVectorLoads: new Map(),
    dbGet: async () => { calls++; return new Promise(resolve => { release = resolve }) }, reportStandaloneOperation: () => {},
  }
  const first = proto.ensureHistoryVectors.call(host, 's')
  const second = proto.ensureHistoryVectors.call(host, 's')
  assert.equal(calls, 1)
  assert.equal(host.historyVectorsReady.has('s'), false)
  host.historyVectors.get('s').set(1, { content: 'new live value' })
  release([entry(1), entry(2)])
  await Promise.all([first, second])
  assert.equal(host.historyVectors.get('s').get(1).content, 'new live value')
  assert.equal(host.historyVectors.get('s').size, 2)
  assert.equal(host.historyVectorsReady.has('s'), true)
})

test('P1 automatic recall is original-only, public-only without participant, and cached without model calls', async () => {
  const rows = new Map<number, any>([
    [1, { ...entry(1, '尚未完成取餐，取餐码8914', ''), occurredAt: now.toISOString() }],
    [2, { ...entry(2, '取餐的私聊秘密'), occurredAt: now.toISOString() }],
  ])
  const host: any = { ensureHistoryVectors: async () => {}, historyVectors: new Map([['s', rows]]),
    episodeIndexes: new Map(), sharedStoryConfig: { shareParticipantDetails: true }, automaticRecallCache: new Map() }
  const focus = recallFocus(undefined, ['取餐'], ['取餐'])
  assert.equal(focus, '取餐')
  const first = await proto.recallHistory.call(host, 's', '', focus, [], new Set(), new Set(), 1)
  assert.equal(first.length, 1)
  assert.doesNotMatch(JSON.stringify(first), /私聊秘密/)
  assert.deepEqual(first[0].sourceEntryIds, [1])
  const second = await proto.recallHistory.call(host, 's', '', focus, [], new Set(), new Set(), 1)
  assert.deepEqual(first, second)
  rows.set(3, { ...entry(3, '取餐已经完成', ''), occurredAt: now.toISOString() })
  const third = await proto.recallHistory.call(host, 's', '', focus, [], new Set(), new Set(), 1)
  assert.match(JSON.stringify(third), /已经完成/)
})

test('P1 incompatible known model vectors do not enter semantic ranking', async () => {
  const host: any = { ensureHistoryVectors: async () => {}, historyVectors: new Map([['s', new Map([[1, {
    ...entry(1, '完全无关的内容'), occurredAt: now.toISOString(), vector: [1, 0], embeddingIdentity: 'old',
  }]])]]), episodeIndexes: new Map(), sharedStoryConfig: { shareParticipantDetails: false }, embedder: { identity: () => 'new' } }
  assert.deepEqual(await proto.recallHistory.call(host, 's', 'alice', '取餐码', [1, 0], new Set()), [])
})

test('P1 6000-entry recall benchmark (synthetic, no external requests)', async t => {
  const rows = new Map<number, any>(Array.from({ length: 6000 }, (_, i) => [i + 1, {
    ...entry(i + 1, `${'她继续整理普通笔记。'.repeat(40)}编号${i}。${i === 3000 ? '取餐码8914。' : ''}`),
    occurredAt: now.toISOString(), frameId: `frame-${Math.floor(i / 20)}`,
  }]))
  const host: any = { ensureHistoryVectors: async () => {}, historyVectors: new Map([['s', rows]]),
    episodeIndexes: new Map(), sharedStoryConfig: { shareParticipantDetails: false } }
  const before = process.memoryUsage().heapUsed
  const cold = performance.now()
  const result = await proto.recallHistory.call(host, 's', 'alice', '取餐码8914', [], new Set())
  const coldMs = performance.now() - cold
  const warm = performance.now()
  await proto.recallHistory.call(host, 's', 'alice', '取餐码8914', [], new Set())
  const warmMs = performance.now() - warm
  const vector = Array.from({ length: 1536 }, (_, i) => i === 0 ? 1 : 0.01)
  for (const row of rows.values()) row.vector = vector
  const semantic = performance.now()
  await proto.recallHistory.call(host, 's', 'alice', '取餐码8914', vector, new Set())
  const semanticMs = performance.now() - semantic
  assert.match(result[0].content, /取餐码8914/)
  t.diagnostic(`6000 rows: cold=${coldMs.toFixed(1)}ms warm=${warmMs.toFixed(1)}ms semantic1536=${semanticMs.toFixed(1)}ms heapDelta=${((process.memoryUsage().heapUsed - before) / 1048576).toFixed(1)}MiB`)
  assert.ok(warmMs < 3000, 'generous regression ceiling, not a production SLA')
})

test('P03 history vector backfill invalidates recall memo despite unchanged cache size', async () => {
  const rows = [entry(1)]
  const { host } = backfillHost(rows, 1)
  const cached = { vector: [], content: rows[0].content }
  host.historyVectors.set('s', new Map([[1, cached]]))
  host.automaticRecallCache.set('s', { stale: true })
  host.automaticRecallCache.set('unrelated', { retained: true })
  await proto.backfillHistoryEmbeddings.call(host, 's')
  assert.equal(host.historyVectors.get('s').size, 1)
  assert.deepEqual(cached.vector, [1, 0])
  assert.equal(host.automaticRecallCache.has('s'), false)
  assert.equal(host.automaticRecallCache.has('unrelated'), true)
})
