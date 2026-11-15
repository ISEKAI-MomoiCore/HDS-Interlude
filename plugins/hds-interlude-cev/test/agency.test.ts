import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeAgencyWindow, evaluateAgencyCapacity, normalizeAgencyWindowDraft, normalizeProactiveContact,
  proactiveCandidateFingerprint, proactiveRecheckAt, resolveAgencyConfig,
} from '../src/agency'
import { groupDueIntents } from '../src/service'
import { AgencyWindowState, NarrativeIntent, ProactiveContactDraft } from '../src/types'

const config = resolveAgencyConfig({
  enabled: true,
  maxWindowMinutes: 240,
  minimumProactiveIntervalMinutes: 60,
  maxCandidateHours: 24,
})
const now = new Date('2026-08-24T08:00:00.000Z')

function candidate(overrides: Partial<ProactiveContactDraft> = {}): ProactiveContactDraft {
  return {
    participantId: 'friend', origin: 'life-event', motive: '她遇到一件想分享的事。',
    disclosure: 'ordinary', sourceEntryIds: [10], willingness: 0.8,
    outcome: 'send-now', expiresAt: '2026-08-25T08:00:00.000Z', ...overrides,
  }
}

function window(overrides: Partial<AgencyWindowState> = {}): AgencyWindowState {
  return {
    activityLoad: 'free', privacy: 'private', deviceAccess: 'available',
    validUntil: '2026-08-24T12:00:00.000Z', basis: '她已经回到自己的房间。',
    sourceEntryIds: [10], updatedAt: now.toISOString(), ...overrides,
  }
}

test('Agency Window accepts only grounded, bounded practical state', () => {
  const normalized = normalizeAgencyWindowDraft({
    activityLoad: 'occupied', privacy: 'public', deviceAccess: 'limited',
    nextOpportunityAt: '2026-08-24T10:00:00.000Z', validUntil: '2026-08-25T10:00:00.000Z',
    basis: '她还在教室里，周围有人。', sourceEntryIds: [10, 999],
  }, now, config, new Set([10]))
  assert.equal(normalized?.activityLoad, 'occupied')
  assert.deepEqual(normalized?.sourceEntryIds, [10])
  assert.equal(normalized?.validUntil, '2026-08-24T12:00:00.000Z')
  assert.equal(activeAgencyWindow(normalized, now)?.privacy, 'public')
})

test('capacity rules separate schedule, privacy and device access from emotion', () => {
  assert.equal(evaluateAgencyCapacity(window(), candidate(), now, config).allowed, true)
  assert.equal(evaluateAgencyCapacity(window({ activityLoad: 'overloaded' }), candidate(), now, config).reason, 'schedule-overloaded')
  assert.equal(evaluateAgencyCapacity(window({ privacy: 'public' }), candidate({ disclosure: 'personal' }), now, config).reason, 'privacy-insufficient')
  assert.equal(evaluateAgencyCapacity(window({ deviceAccess: 'unavailable' }), candidate(), now, config).reason, 'device-unavailable')
  assert.equal(evaluateAgencyCapacity(window({ activityLoad: 'occupied' }), candidate({ origin: 'promise' }), now, config).allowed, true)
})

test('ordinary proactive contact respects the minimum interval while promises bypass it', () => {
  const recent = '2026-08-24T07:30:00.000Z'
  assert.equal(evaluateAgencyCapacity(window(), candidate(), now, config, recent).reason, 'minimum-proactive-interval')
  assert.equal(evaluateAgencyCapacity(window(), candidate({ origin: 'promise' }), now, config, recent).allowed, true)
})

test('contact candidates require a permitted target and real source evidence', () => {
  const normalized = normalizeProactiveContact({
    participantId: 'friend', origin: 'life-event', motive: '她想告诉对方今天发生的事。',
    disclosure: 'ordinary', willingness: 0.8, outcome: 'recheck-later',
  }, now, config, new Set(['friend']), new Set(), 42)
  assert.deepEqual(normalized?.sourceEntryIds, [42])
  assert.equal(normalizeProactiveContact({ ...normalized, participantId: 'blocked' }, now, config, new Set(['friend']), new Set([42])), undefined)
})

test('candidate identity ignores wording changes and recheck time stays bounded', () => {
  const first = candidate({ motive: '第一种措辞' })
  const second = candidate({ motive: '完全不同的措辞' })
  assert.equal(proactiveCandidateFingerprint(first), proactiveCandidateFingerprint(second))
  const capacity = evaluateAgencyCapacity(window({ activityLoad: 'overloaded', nextOpportunityAt: '2026-08-24T09:00:00.000Z' }), first, now, config)
  assert.equal(proactiveRecheckAt(first, capacity, window({ nextOpportunityAt: '2026-08-24T09:00:00.000Z' }), now).toISOString(), '2026-08-24T09:00:00.000Z')
})

test('proactive checks are isolated from ordinary due messages for the same participant', () => {
  const intent = (id: number, type: string): NarrativeIntent => ({
    id, storyId: 'story', participantId: 'friend', type, summary: type,
    notBefore: now, status: 'pending', payload: {}, createdAt: now, updatedAt: now,
  })
  const batches = groupDueIntents([intent(1, 'delayed-reply'), intent(2, 'proactive-check')])
  assert.equal(batches.length, 2)
  assert.deepEqual(batches.map(batch => batch[0].type).sort(), ['delayed-reply', 'proactive-check'])
})
