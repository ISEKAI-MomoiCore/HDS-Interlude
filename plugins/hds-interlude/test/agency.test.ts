import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeAgencyWindow, normalizeAgencyWindowDraft, normalizeProactiveContact, resolveAgencyConfig,
} from '../src/agency'
import { groupDueIntents } from '../src/service'
import { NarrativeIntent } from '../src/types'

const config = resolveAgencyConfig({
  enabled: true,
  maxWindowMinutes: 240,
  minimumProactiveIntervalMinutes: 60,
  maxCandidateHours: 24,
})
const now = new Date('2026-08-24T08:00:00.000Z')


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

test('legacy recheck-later drafts require a concrete target and motive (contactPlanFromDraft)', () => {
  const { contactPlanFromDraft } = require('../src/script/contact-actions')
  const plan = contactPlanFromDraft({
    participantId: 'friend', origin: 'life-event', motive: '她想告诉对方今天发生的事。',
    disclosure: 'ordinary', willingness: 0.8, outcome: 'recheck-later',
  }, 'advance')
  assert.equal(plan?.target.id, 'friend')
  assert.equal(contactPlanFromDraft({ participantId: '  ', motive: 'm', outcome: 'recheck-later' } as any, 'advance'), undefined, 'empty target rejected')
  assert.equal(contactPlanFromDraft({ participantId: 'friend', motive: '', outcome: 'recheck-later' } as any, 'advance'), undefined, 'empty motive rejected')
  assert.equal(contactPlanFromDraft({ participantId: 'friend', motive: 'm', outcome: 'recheck-later', notBefore: 'not-a-date' } as any, 'advance'), undefined, 'unparseable notBefore rejected')
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
