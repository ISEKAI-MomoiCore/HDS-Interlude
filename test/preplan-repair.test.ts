import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import {
  applySchedulePreplanProposal, DEFAULT_SCHEDULE_PREPLAN_CONFIG, materializeSchedulePreplan,
  normalizeSchedulePreplanRecord, nextSchedulePreplanTransition, refreshSchedulePreplan, schedulePreplanWindow,
} from '../src/schedule-preplan'
import { emptyStorySetting, SchedulePreplanRecord, SchedulePreplanRegime, ScriptEntry } from '../src/types'

const today = '2026-10-08'
const zone = 'Asia/Shanghai'
const now = new Date('2026-10-08T04:00:00Z')
const config = { ...DEFAULT_SCHEDULE_PREPLAN_CONFIG, horizonDays: 30 }
const evidence = [{ id: 1 }] as ScriptEntry[]
const block = { id: 'today-plan', start: '19:00', end: '21:00', label: '已确认的安排', kind: 'fixed' as const }
function emptyRecord() {
  const record = applySchedulePreplanProposal(undefined, { outcome: 'replace', reason: 'empty', regimes: [], exceptions: [] }, [], today, zone, config, now)!
  record.storyId = 'story'
  return record
}

for (const initial of ['first', 'existing empty'] as const) {
  test('exceptions-only schedules persist on ' + initial + ' review', () => {
    const next = applySchedulePreplanProposal(initial === 'first' ? undefined : emptyRecord(), {
      outcome: 'patch', reason: '电影已确认', sourceEntryIds: [1],
      exceptions: [{ date: today, mode: 'replace', reason: '约定', blocks: [block] }],
    }, evidence, today, zone, config, now)!
    assert.equal(next.regimes.length, 0)
    assert.equal(next.exceptions.length, 1)
    assert.equal(schedulePreplanWindow(next, now, zone, 12)!.blocks[0].id, block.id)
  })
}

test('future regime extensions preserve today across normalization and refresh', () => {
  const current = emptyRecord()
  current.regimes = Array.from({ length: 6 }, (_, index) => ({
    id: 'r' + index, label: '阶段' + index, from: '2026-10-' + String(8 + index).padStart(2, '0'),
    weekly: { thursday: [{ ...block, id: 'r' + index + '-block' }] },
  }))
  const next = applySchedulePreplanProposal(current, {
    outcome: 'extend', reason: '下一阶段', regimes: [{ id: 'r6', label: '未来', from: '2026-10-20', weekly: {} }],
  }, evidence, today, zone, config, now)!
  assert.equal(next.regimes.length, 7)
  assert.ok(next.regimes.some(r => r.id === 'r0'))
  const reload = normalizeSchedulePreplanRecord(next)!
  const refreshed = refreshSchedulePreplan(reload, today, zone, config, now)
  assert.equal(reload.regimes.length, 7)
  assert.equal(refreshed.materializedDays.find(d => d.date === today)!.blocks[0].id, 'r0-block')
})

test('a thirty-day horizon can retain more than six effective regimes', () => {
  let current = emptyRecord()
  for (let batch = 0; batch < 5; batch++) {
    const regimes = Array.from({ length: 6 }, (_, i): SchedulePreplanRegime => ({
      id: 'stage-' + (batch * 6 + i), label: '阶段',
      from: new Date(Date.UTC(2026, 9, 8 + batch * 6 + i)).toISOString().slice(0, 10), weekly: {},
    }))
    current = applySchedulePreplanProposal(current, { outcome: 'extend', reason: 'confirmed stages', regimes }, evidence, today, zone, config, now)!
  }
  assert.equal(current.regimes.length, 30)
  assert.equal(normalizeSchedulePreplanRecord(current)!.regimes.length, 30)
})

test('future exceptions do not evict today or yesterday overnight exceptions', () => {
  const current = emptyRecord()
  current.exceptions = [
    { date: '2026-10-07', mode: 'replace', reason: 'night', blocks: [{ ...block, start: '23:00', end: '07:00' }] },
    { date: today, mode: 'replace', reason: 'today', blocks: [block] },
  ]
  const next = applySchedulePreplanProposal(current, {
    outcome: 'extend', reason: 'new exceptions', exceptions: Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 9 + i)).toISOString().slice(0, 10), mode: 'replace', reason: 'confirmed', blocks: [block],
    })),
  }, evidence, today, zone, config, now)!
  const reloaded = normalizeSchedulePreplanRecord(next)!
  assert.equal(reloaded.exceptions[0].date, '2026-10-07')
  assert.equal(reloaded.exceptions[1].date, today)
  assert.equal(reloaded.exceptions.length, 32)
})

test('yesterday overnight blocks remain visible and yield their real end transition', () => {
  const current = emptyRecord()
  const nightNow = new Date('2026-10-07T17:00:00Z') // October 8, 01:00 local
  current.regimes = [{ id: 'night', label: '夜班', from: '2026-10-07', weekly: {
    wednesday: [{ ...block, start: '23:00', end: '07:00' }],
  } }]
  current.materializedDays = materializeSchedulePreplan(current.regimes, [], today, 30)
  assert.equal(schedulePreplanWindow(current, nightNow, zone, 12)!.blocks[0].id, block.id)
  assert.equal(nextSchedulePreplanTransition(current, nightNow, zone)!.toISOString(), '2026-10-07T23:00:00.000Z')
  const refreshed = refreshSchedulePreplan(current, today, zone, config, nightNow)
  assert.equal(schedulePreplanWindow(refreshed, nightNow, zone, 12)!.blocks[0].id, block.id)
})

for (const variation of ['stable', 'contextual', 'granular'] as const) {
  test(variation + ' rejects forbidden tentative blocks instead of confirming them', () => {
    const next = applySchedulePreplanProposal(undefined, {
      outcome: 'replace', reason: 'candidate rules', sourceEntryIds: [1],
      regimes: [{ id: 'r', label: '日常', from: today, weekly: { thursday: [
        { ...block, id: 'fixed', tentative: true },
        { ...block, id: 'routine', kind: 'routine', tentative: true },
        { ...block, id: 'flexible', kind: 'flexible', tentative: true },
      ] } }],
      exceptions: [{ date: '2026-10-09', mode: 'replace', reason: 'test', blocks: [{ ...block, tentative: true }] }],
    }, evidence, today, zone, config, now, variation)!
    const blocks = next.regimes[0].weekly.thursday ?? []
    assert.deepEqual(blocks.map(b => b.id), variation === 'granular' ? ['flexible'] : [])
    if (blocks.length) assert.equal(blocks[0].tentative, true)
    assert.deepEqual(next.exceptions[0].blocks, [])
  })
}

function entry(id: number, privateEntry = true): ScriptEntry {
  return { id, storyId: 'story', participantId: privateEntry ? 'alice' : '', kind: 'script', actor: 'narrator',
    content: privateEntry ? 'private conversation' : '她确认明天去医院，已约好时间。',
    occurredAt: new Date(now.getTime() - id * 1000), metadata: {}, createdAt: now }
}
function scanFixture(entries: ScriptEntry[], initial?: SchedulePreplanRecord, share = false) {
  let persisted = initial ? structuredClone(initial) : undefined
  const service: any = Object.create(InterludeService.prototype)
  Object.defineProperty(service, 'schedulePreplanConfig', { value: config })
  Object.defineProperty(service, 'sharedStoryConfig', { value: { shareParticipantDetails: share } })
  Object.assign(service, {
    schedulePreplanBackoff: new Map(), reportOperation() {},
    getSchedulePreplan: async () => persisted ? normalizeSchedulePreplanRecord(structuredClone(persisted)) : undefined,
    saveSchedulePreplan: async (record: SchedulePreplanRecord) => { persisted = structuredClone(record) },
    dbGet: async (_table: string, filter: any, options: any) => {
      assert.deepEqual(options.sort, { id: 'asc' })
      return entries.filter(e => e.id > (filter.id?.$gt ?? 0)).slice(0, options.limit)
    },
  })
  const story = { id: 'story', setting: { ...emptyStorySetting(), timezone: zone } }
  return { service, story, record: () => persisted }
}

for (const mode of ['initial', 'daily', 'followup'] as const) {
  test('privacy-filtered scan persists progress past 1200 entries on ' + mode + ' review', async () => {
    const initial = mode === 'initial' ? undefined : emptyRecord()
    if (initial) {
      initial.updatedAt = new Date(now.getTime() - 3 * 3600_000)
      if (mode === 'daily') initial.lastReviewedLocalDate = '2026-10-07'
    }
    const entries = Array.from({ length: 1200 }, (_, i) => entry(i + 1)).concat(entry(1201, false))
    const f = scanFixture(entries, initial)
    const first = await f.service.prepareSchedulePreplanReview(f.story, now)
    assert.equal(first.needsModel, false)
    assert.equal(f.record()!.lastEvidenceEntryId, 1200)
    if (initial) {
      assert.equal(f.record()!.updatedAt.getTime(), initial.updatedAt.getTime())
      assert.equal(f.record()!.lastReviewedLocalDate, initial.lastReviewedLocalDate)
    } else assert.equal(f.record()!.lastReviewedLocalDate, '')
    // Simulate restart: the scan cursor lives in the record, not a process-local Map.
    const restarted = scanFixture(entries, f.record())
    const next = await restarted.service.prepareSchedulePreplanReview(restarted.story, now)
    assert.equal(next.needsModel, true)
    assert.deepEqual(next.evidenceEntries.map((e: ScriptEntry) => e.id), [1201])
    assert.equal(restarted.record()!.lastEvidenceEntryId, 1200)
  })
}

test('privacy checkpoints never skip an unreviewed visible entry', async () => {
  const entries = Array.from({ length: 200 }, (_, i) => entry(i + 1, i !== 10 && i !== 190))
  const f = scanFixture(entries)
  const batch = await f.service.schedulePreplanEvidence('story', 0)
  assert.equal(batch.filteredThroughEntryId, 10)
  assert.deepEqual(batch.entries.map((e: ScriptEntry) => e.id), [11, 191])
  assert.equal(batch.scanComplete, true)
})

test('explicit participant-detail sharing does not checkpoint raw evidence before review', async () => {
  const f = scanFixture([entry(1), entry(2)], undefined, true)
  const batch = await f.service.schedulePreplanEvidence('story', 0)
  assert.equal(batch.filteredThroughEntryId, 0)
  assert.equal(batch.entries.length, 2)
  assert.equal(batch.entries[0].participantId, 'alice')
})

test('first failed model review persists an empty checkpoint even with evidence', async () => {
  const f = scanFixture([])
  const saved = await f.service.persistSchedulePreplanReview(f.story, { evidenceEntries: evidence, localDate: today }, undefined, now)
  assert.equal(saved, true)
  assert.equal(f.record()!.lastEvidenceEntryId, 1)
  assert.deepEqual(f.record()!.regimes, [])
})


test('Preplan updates keep the primary key in the query, not in the database patch', async () => {
  const record = emptyRecord()
  let writes = 0
  const host = {
    dbGet: async () => [record],
    dbSet: async (table: string, query: unknown, patch: any) => {
      writes++
      assert.equal(table, 'interlude_schedule_preplan')
      assert.deepEqual(query, { storyId: record.storyId })
      assert.equal(Object.hasOwn(patch, 'storyId'), false)
      assert.equal(patch.lastEvidenceEntryId, 1200)
    },
  }
  await (InterludeService.prototype as any).saveSchedulePreplan.call(host, { ...record, lastEvidenceEntryId: 1200 })
  assert.equal(writes, 1)
})

test('inactive candidates stay hidden both before and inside the reveal window', () => {
  const record = applySchedulePreplanProposal(undefined, {
    outcome: 'replace', reason: 'candidate', sourceEntryIds: [1],
    regimes: [{ id: 'r', label: '柔性安排', from: today, weekly: { thursday: [
      { ...block, kind: 'flexible', tentative: true },
    ] } }],
  }, evidence, today, zone, config, now, 'granular')!
  record.storyId = 'story'
  for (const time of [now, new Date('2026-10-08T10:30:00Z')]) {
    const window = schedulePreplanWindow(record, time, zone, 12, {
      ...config, variationLevel: 'granular', candidateActivationProbability: 0,
    })
    assert.ok(!window || window.blocks.length === 0)
  }
})
