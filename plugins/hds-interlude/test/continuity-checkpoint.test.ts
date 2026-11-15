import assert from 'node:assert/strict'
import test from 'node:test'
import { compactionPrefix, assertContinuityReview } from '../src/script/continuity-checkpoint'
import { InterludeService } from '../src/service'
import { ScriptEntry } from '../src/types'

const date = new Date('2026-09-05T00:00:00Z')
const entries = [1, 2, 3].map(id => ({ id, storyId: 's', participantId: '', kind: 'script', actor: 'narrator', content: `${id}`.repeat(80), occurredAt: date, createdAt: date, metadata: {} } as ScriptEntry))

test('incremental review exhausts an oversized backlog without skipping any original', () => {
  const processed: number[] = []
  while (processed.length < entries.length) {
    const batch = compactionPrefix(entries.filter(entry => entry.id > (processed.at(-1) ?? 0)), 100)
    processed.push(...batch.map(entry => entry.id))
  }
  assert.deepEqual(processed, [1, 2, 3])
  assert.equal(compactionPrefix(entries, 10)[0].content, entries[0].content)
})

test('empty or partial continuity output cannot acknowledge scene evidence', () => {
  assert.throws(() => assertContinuityReview({}))
  assert.throws(() => assertContinuityReview({ scene: { summary: '已下课' } }))
  assert.doesNotThrow(() => assertContinuityReview({ scene: { summary: '已下课' }, arc: { summary: '约定尚未履行' } }))
})

test('closing a reviewed scene retains the processed frontier despite later message arrival', async () => {
  const writes: Array<{ table: string; query: any; patch: any }> = []
  let nextAt: Date | undefined
  const service = {
    memoryConfig: { arcSummaryCharacters: 1000, sceneHookCharacters: 100, sceneSummaryCharacters: 1000 },
    activeArc: async () => ({ id: 7, title: '旧弧' }),
    activeScene: async () => ({ id: 9 }),
    dbGet: async () => [],
    dbSet: async (table: string, query: any, patch: any) => { writes.push({ table, query, patch }) },
    ensureContinuity: async (_story: any, at: Date) => { nextAt = at },
  }
  await (InterludeService.prototype as any).persistCompactionOutputs.call(service,
    { id: 's' }, { id: 8, entryCount: 0, startedAt: date },
    { scene: { summary: '下课离开', close: true, boundary: { reason: '已离开教室', sourceEntryIds: [3] } }, arc: { summary: '约定延续' } },
    entries, new Date(date.getTime() + 60_000))
  assert.equal(nextAt?.getTime(), date.getTime())
  assert.equal(writes[0].table, 'interlude_arc')
  assert.ok(writes.some(write => write.table === 'interlude_scene' && write.query.id === 9 && write.patch.lastEntryId === 3))
})

test('failed arc persistence leaves the scene checkpoint untouched', async () => {
  const writes: string[] = []
  const service = {
    memoryConfig: { arcSummaryCharacters: 1000 }, activeArc: async () => ({ id: 7, title: '旧弧' }),
    dbSet: async (table: string) => { writes.push(table); throw new Error('database unavailable') },
  }
  await assert.rejects((InterludeService.prototype as any).persistCompactionOutputs.call(service,
    { id: 's' }, { id: 8 }, { scene: { summary: '下课' }, arc: { summary: '约定' } }, entries, date))
  assert.deepEqual(writes, ['interlude_arc'])
})

test('image-only input remains an observed media event and never gains invented words', async () => {
  const service = {
    describeVisionEvent: () => ({ content: '', sources: ['image-source'] }),
    transcribeVoiceEvent: async () => ({ detected: 0, transcripts: [], provider: '' }),
  }
  const result = await (InterludeService.prototype as any).describeUserEvent.call(service,
    { setting: { character: { name: '测试角色' } } }, { content: '<img src="image-source"/>' })
  assert.deepEqual(result.sources, ['image-source'])
  assert.match(result.content, /用户发送了图片/)
  assert.match(result.content, /未知/)
  assert.doesNotMatch(result.content, /非文本消息/)
})
