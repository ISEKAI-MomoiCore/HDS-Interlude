import assert from 'node:assert/strict'
import test from 'node:test'
import { sendOutgoingMessages } from '../src/delivery/pipeline'
import { migrateProactiveCheckIntents, type MigrationDb, type ProactiveCheckIntentRow } from '../src/script/contact-plan-migration'
import { normalizeProactiveContactLog } from '../src/story-state'
import { encodeStoryState } from '../src/story-state'
import { DEFAULT_DELIVERY_POLICY_CONFIG } from '../src/script/delivery-policy'

const NOW = new Date('2026-11-14T12:00:00.000Z')

// ── 迁移执行器：§8.2 处置表、幂等、分页与 dryRun ───────────────────────────

interface MemoryRow extends ProactiveCheckIntentRow { type: string }

function memoryDb(initial: Array<Partial<MemoryRow> & { id: number }>) {
  const rows: MemoryRow[] = initial.map(row => ({
    type: 'proactive-check', storyId: 's', participantId: 'alice', status: 'pending',
    notBefore: new Date(NOW.getTime() + 3_600_000).toISOString(), summary: 'recheck',
    payload: {
      origin: 'life-event', motive: '想再问问近况', disclosure: 'ordinary', sourceEntryIds: [11],
      expiresAt: new Date(NOW.getTime() + 7_200_000).toISOString(), fingerprint: 'f', agencyReason: 'model-requested-recheck',
    }, ...row,
  } as MemoryRow))
  const converted: any[] = [], retired: any[] = []
  const db: MigrationDb = {
    getPendingProactiveChecks: async (storyId, afterId, limit) =>
      rows.filter(row => row.type === 'proactive-check' && row.storyId === storyId
        && row.status === 'pending' && row.id > afterId).sort((a, b) => a.id - b.id).slice(0, limit),
    writeConverted: async (row, plan, legacy, at) => {
      row.type = 'contact-plan'
      row.notBefore = plan.earliestAt ?? row.notBefore
      row.payload = { plan, legacy }
      converted.push({ id: row.id, plan, legacy, at })
    },
    retire: async (row, reason) => { row.status = 'cancelled'; retired.push({ id: row.id, reason }) },
  }
  return { db, rows, converted, retired }
}

test('P2b migration follows the §8.2 disposition table', async () => {
  const { db, converted, retired } = memoryDb([
    { id: 1 }, // 模型要求的稍后再处理 → contact-plan
    { id: 2, payload: { origin: 'life-event', motive: 'm', disclosure: 'ordinary', sourceEntryIds: [12], agencyReason: 'minimum-proactive-interval', fingerprint: 'f2', expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() } }, // 策略重查 → 退役
    { id: 3, payload: { origin: 'life-event', motive: 'm', disclosure: 'ordinary', sourceEntryIds: [13], agencyReason: 'model-requested-recheck', fingerprint: 'f3', expiresAt: new Date(NOW.getTime() - 1_000).toISOString() } }, // 已过期 → 终结
    { id: 4, participantId: 'bob' }, // 已被后续动作替代 → 终结
    { id: 5, payload: { origin: 'life-event' } }, // 来源不可识别 → 只读暂停
  ])
  const summary = await migrateProactiveCheckIntents(db, 's', NOW, { supersededParticipantIds: new Set(['bob']) })
  assert.equal(summary.scanned, 5)
  assert.equal(summary.converted, 1)
  assert.equal(summary.retiredPolicyRecheck, 1)
  assert.equal(summary.retiredExpired, 1)
  assert.equal(summary.retiredSuperseded, 1)
  assert.equal(summary.pausedUnidentifiable, 1)
  assert.equal(converted[0].id, 1)
  assert.equal(converted[0].plan.target.id, 'alice')
  assert.equal(converted[0].plan.sourceQuote, '想再问问近况')
  assert.equal(converted[0].legacy.legacyId, 1, '旧 ID 映射保留')
  assert.deepEqual(retired.map(item => [item.id, item.reason]), [
    [2, 'legacy-policy-recheck-retired'], [3, 'expired-at-migration'], [4, 'superseded-by-later-action'], [5, 'legacy-unidentifiable-paused'],
  ])
  assert.ok(summary.notes.some(note => note.includes('投递账本派生重建')), 'quota derivation note present')
})

test('P2b migration is idempotent and paginates past converted rows', async () => {
  const initial = Array.from({ length: 120 }, (_, index) => ({ id: index + 1 }))
  const { db, converted } = memoryDb(initial)
  const first = await migrateProactiveCheckIntents(db, 's', NOW)
  assert.equal(first.scanned, 120)
  assert.equal(first.converted, 120, 'single page size is 50; all pages processed')
  const second = await migrateProactiveCheckIntents(db, 's', NOW)
  assert.equal(second.scanned, 0, 'converted and retired rows no longer match the scan')
  assert.equal(converted.length, 120)
})

test('P2b migration dryRun computes dispositions without writing', async () => {
  const { db, converted, retired } = memoryDb([{ id: 1 }, { id: 2, payload: { origin: 'x', agencyReason: 'minimum-proactive-interval' } }])
  const summary = await migrateProactiveCheckIntents(db, 's', NOW, { dryRun: true })
  assert.equal(summary.scanned, 2)
  assert.equal(summary.converted + summary.retiredPolicyRecheck + summary.pausedUnidentifiable, 2)
  assert.equal(converted.length, 0)
  assert.equal(retired.length, 0)
})

// ── origin 贯通与发送前 shadow（不改变执行）───────────────────────────────

test('P2b proactive contact log keeps the origin across append and normalize', () => {
  const appended = normalizeProactiveContactLog([{ participantId: 'alice', at: NOW.toISOString(), endpointId: 'ep1', ref: 'ref-1', origin: 'promise' }])
  assert.equal(appended[0].origin, 'promise')
  const normalized = normalizeProactiveContactLog([{ participantId: 'alice', at: NOW.toISOString(), ref: 'ref-1', origin: 'practical-update' }])
  assert.equal(normalized[0].origin, 'practical-update')
  assert.equal(normalizeProactiveContactLog([{ participantId: 'alice', at: NOW.toISOString() }])[0].origin, undefined, 'legacy rows stay origin-free')
})
