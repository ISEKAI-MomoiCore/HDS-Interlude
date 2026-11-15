import assert from 'node:assert/strict'
import test from 'node:test'
import { persistCompactionOutputs } from '../src/compaction/pipeline'
import { decodeStoryState, lifeRhythmStale } from '../src/story-state'
import { emptyStoryState } from '../src/types'
import { assembleGroupBackground } from '../src/narrative/group-background'
import { InterludeService } from '../src/service'
const noop = () => {}
const now = new Date('2026-11-13T12:00:00Z')
function rhythmFixture(attention = 'asleep', assessedAt = new Date(now.getTime() - 3 * 3600000)) {
  let stored: any = { ...emptyStoryState(), lifeRhythm: { attention, basis: 'old basis', assessedAt: assessedAt.toISOString(), source: 'narrator' } }
  const host: any = {
    memoryConfig: { sceneHookCharacters: 100, sceneSummaryCharacters: 300, arcSummaryCharacters: 300 },
    dbGet: async () => [], dbSet: async (table: string, _query: any, patch: any) => { if (table === 'interlude_story' && patch.state) stored = patch.state },
    getStory: async () => ({ id: 's', state: stored }), activeArc: async () => ({ id: 1 }), reportOperation: noop,
  }
  return { host, state: () => decodeStoryState(stored), decision: (attention: string, basis: string) => ({ scene: { summary: '生活继续' }, arc: { summary: '弧摘要' }, lifeRhythm: { attention, basis } }) }
}
const entries: any[] = [{ id: 1, storyId: 's', kind: 'script', content: '她仍在休息。', metadata: {}, occurredAt: now }]
async function assess(f: ReturnType<typeof rhythmFixture>, attention: string, at: Date, basis = 'new basis') {
  await persistCompactionOutputs(f.host, { id: 's' } as any, { id: 1, entryCount: 0 } as any, f.decision(attention, basis) as any, entries, at)
}
for (const attention of ['asleep', 'occupied']) test(`F10 renewed ${attention} refreshes basis/time and downstream freshness`, async () => {
  const f = rhythmFixture(attention)
  assert.equal(lifeRhythmStale(f.state().lifeRhythm, now.getTime()), true)
  await assess(f, attention, now)
  assert.equal(f.state().lifeRhythm?.assessedAt, now.toISOString())
  assert.equal(f.state().lifeRhythm?.basis, 'new basis')
  assert.equal(f.state().lifeRhythm?.source, 'compactor')
  assert.equal(lifeRhythmStale(f.state().lifeRhythm, now.getTime()), false)
})
for (const attention of ['asleep', 'available']) test(`F10 stale ${attention} assessment preserves newer rhythm`, async () => {
  const f = rhythmFixture('asleep', now)
  await assess(f, attention, new Date(now.getTime() - 1000), 'stale basis')
  assert.equal(f.state().lifeRhythm?.attention, 'asleep')
  assert.equal(f.state().lifeRhythm?.assessedAt, now.toISOString())
  assert.equal(f.state().lifeRhythm?.basis, 'old basis')
})
test('F10 valid attention change still commits, invalid draft preserves last assessment', async () => {
  const f = rhythmFixture()
  await assess(f, 'occupied', now)
  assert.equal(f.state().lifeRhythm?.attention, 'occupied')
  await assess(f, 'unknown', new Date(now.getTime() + 1000))
  assert.equal(f.state().lifeRhythm?.assessedAt, now.toISOString())
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
