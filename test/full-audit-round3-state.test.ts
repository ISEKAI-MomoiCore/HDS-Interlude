import assert from 'node:assert/strict'
import test from 'node:test'
import { persistCompactionOutputs } from '../src/compaction/pipeline'
import { decodeStoryState, lifeRhythmStale } from '../src/story-state'
import { emptyStoryState } from '../src/types'
import { assembleGroupBackground } from '../src/narrative/group-background'
import { InterludeService } from '../src/service'
const noop = () => {}
const now = new Date('2026-11-13T12:00:00Z')
const quote = '她还在专心写报告。'
const evidence = { id: 11, storyId: 's', kind: 'script', actor: 'narrator', content: quote, metadata: {}, occurredAt: now }
function rhythmFixture(attention = 'asleep', assessedAt = new Date(now.getTime() - 3 * 3600000), sourceEntryId?: number) {
  let stored: any = { ...emptyStoryState(), lifeRhythm: { attention, basis: 'old basis', assessedAt: assessedAt.toISOString(), sourceEntryId, source: 'narrator' } }
  let latest = evidence
  const host: any = {
    memoryConfig: { sceneHookCharacters: 100, sceneSummaryCharacters: 300, arcSummaryCharacters: 300 },
    dbGet: async (table: string, query: any) => table === 'interlude_script_entry' ? (query.kind === 'script' ? [latest] : []) : [],
    dbSet: async (table: string, _query: any, patch: any) => { if (table === 'interlude_story' && patch.state) stored = patch.state },
    getStory: async () => ({ id: 's', state: stored }), activeArc: async () => ({ id: 1 }), reportOperation: noop,
  }
  return { host, state: () => decodeStoryState(stored), setLatest: (entry: typeof evidence) => { latest = entry } }
}
async function assess(f: ReturnType<typeof rhythmFixture>, attention = 'busy-work', sourceEntryId = evidence.id, draftQuote = quote) {
  const decision = { scene: { summary: '生活继续' }, arc: { summary: '弧摘要' }, lifeRhythm: { attention, quote: draftQuote, sourceEntryId } }
  await persistCompactionOutputs(f.host, { id: 's' } as any, { id: 1, entryCount: 0 } as any, decision as any, [evidence] as any, new Date(now.getTime() + 5000))
}
test('F10 compaction fills missing focus using the script timestamp and evidence id', async () => {
  const f = rhythmFixture('busy-work', undefined, 10)
  assert.equal(lifeRhythmStale(f.state().lifeRhythm, now.getTime()), true)
  await assess(f)
  assert.deepEqual(f.state().lifeRhythm, { attention: 'busy-work', basis: quote, assessedAt: now.toISOString(), sourceEntryId: 11, source: 'compactor' })
  await assess(f, 'busy-play')
  assert.equal(f.state().lifeRhythm?.attention, 'busy-work', 'same entry does not get reassessed')
})
test('F10 compaction preserves a later legacy assessment without an evidence id', async () => {
  const laterAssessment = new Date(now.getTime() + 1000)
  const f = rhythmFixture('rest-conscious', laterAssessment)
  await assess(f)
  assert.equal(f.state().lifeRhythm?.attention, 'rest-conscious')
  assert.equal(f.state().lifeRhythm?.assessedAt, laterAssessment.toISOString())
})
test('F10 compaction result from an older snapshot is ignored even if latest script omitted focus', async () => {
  const f = rhythmFixture()
  f.setLatest({ ...evidence, id: 12 })
  await assess(f)
  assert.equal(f.state().lifeRhythm?.attention, 'asleep')
})
test('F10 compaction respects a grounded narrator handoff on the same entry', async () => {
  const f = rhythmFixture()
  f.setLatest({ ...evidence, metadata: { lifeHandoff: { focus: { attention: 'busy-work', quote } } } })
  await assess(f, 'busy-play')
  assert.equal(f.state().lifeRhythm?.attention, 'asleep')
})
test('F10 compaction rejects invalid attention, an unknown source, and an ungrounded quote', async () => {
  const f = rhythmFixture()
  await assess(f, 'occupied')
  await assess(f, 'busy-work', 99)
  await assess(f, 'busy-work', evidence.id, '她睡着了。')
  assert.equal(f.state().lifeRhythm?.attention, 'asleep')
})
function background(content: string, truncated = false, perEntryCharacters = 200) {
  return assembleGroupBackground({
    sections: [{ groupId: '100', label: '群', entries: [{ id: 1, content, occurredAt: now, metadata: { senderName: '甲' } } as any] }],
    truncatedGroups: truncated ? new Set(['100']) : new Set(), budget: { perEntryCharacters },
  })
}
for (const [label, content, truncated, expected] of [
  ['body clipped', '字'.repeat(1000), false, false],
  ['query clipped', 'short', true, false],
  ['both clipped', '字'.repeat(1000), true, false],
  ['complete', 'short', false, true],
  ['exact boundary', '字'.repeat(200), false, true],
] as const) test(`F12 ${label} reports honest completeness to salience consumer`, async () => {
  const result = background(content, truncated)
  assert.equal(result.coverage.contentComplete['100'], expected)
  assert.equal(result.coverage.watermarks['100'], 1, 'partial coverage still advances the presentation watermark')
  const consumed: any[] = []
  const host = { consumeNarrativeSalienceOnAdvance: (_: string, value: any) => consumed.push(...value),
    getStory: async () => ({ id: 's', state: emptyStoryState() }), dbSet: async () => {} }
  await (InterludeService.prototype as any).commitGroupBackgroundCoverage.call(host, 's', result.coverage, now, result.sections)
  assert.equal(consumed[0].contentCovered, expected)
})
