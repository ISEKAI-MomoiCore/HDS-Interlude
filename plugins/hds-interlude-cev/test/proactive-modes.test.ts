import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_AGENCY_CONFIG, evaluateAgencyCapacity, normalizeProactiveContact, resolveAgencyConfig } from '../src/agency'
import { appendProactiveContact, countProactiveContactsInWindow, normalizeProactiveContactLog } from '../src/story-state'
import { systemPrompt } from '../src/narrator'

const NOW = new Date('2026-09-27T12:00:00+08:00')

function advancePrompt(mode?: 'strict' | 'natural' | 'balanced') {
  return systemPrompt('advance', '', '', '', '', '', false, false, true, false, false, undefined, false, undefined, false, false, false, false, undefined, undefined, mode)
}

test('strict is the byte-identical default: undefined mode equals strict and differs from natural', () => {
  const strict = advancePrompt('strict')
  const unset = advancePrompt(undefined)
  const natural = advancePrompt('natural')
  assert.equal(strict, unset, 'unset mode must render exactly the strict doctrine')
  assert.notEqual(strict, natural)
  assert.ok(!strict.includes('Contact temperature'), 'strict prompt carries no temperature doctrine')
})

test('natural and balanced doctrines teach the quieter motives', () => {
  const natural = advancePrompt('natural')
  assert.match(natural, /missing someone, wondering how they are doing, or wanting to share a small moment/)
  assert.match(natural, /participants\[\]\.lastUserMessageAt/)
  assert.match(natural, /reaching out then is human/)
  const balanced = advancePrompt('balanced')
  assert.match(balanced, /use these quieter motives sparingly/)
  assert.ok(!natural.includes('sparingly'))
})

test('agency config resolves mode whitelist and clamps, keeping strict defaults', () => {
  const defaults = resolveAgencyConfig(undefined)
  assert.equal(defaults.contactMode, 'strict')
  assert.equal(DEFAULT_AGENCY_CONFIG.contactMode, 'strict')
  assert.equal(defaults.proactiveDailyCap, 3)
  const clamped = resolveAgencyConfig({ contactMode: 'wild' as never, naturalWillingnessThreshold: 5, naturalMinimumIntervalMinutes: -1, proactiveDailyCap: 99 })
  assert.equal(clamped.contactMode, 'strict')
  assert.equal(clamped.naturalWillingnessThreshold, 1)
  assert.equal(clamped.naturalMinimumIntervalMinutes, 0)
  assert.equal(clamped.proactiveDailyCap, 20)
  const zero = resolveAgencyConfig({ proactiveDailyCap: 0 })
  assert.equal(zero.proactiveDailyCap, 0, '0 = unlimited must survive clamping')
})

test('the daily-cap log counts per participant inside the 24h window', () => {
  const base = [
    { participantId: 'p1', at: new Date(NOW.getTime() - 2 * 3_600_000).toISOString() },
    { participantId: 'p1', at: new Date(NOW.getTime() - 30 * 3_600_000).toISOString() },
    { participantId: 'p2', at: new Date(NOW.getTime() - 1 * 3_600_000).toISOString() },
  ]
  assert.equal(countProactiveContactsInWindow(base, 'p1', NOW), 1, '30h-old entry falls outside the window')
  assert.equal(countProactiveContactsInWindow(base, 'p2', NOW), 1)
  assert.equal(countProactiveContactsInWindow(undefined, 'p1', NOW), 0)
  const appended = appendProactiveContact(base, 'p1', NOW)
  assert.deepEqual(appended.at(-1), { participantId: 'p1', at: NOW.toISOString() })
  assert.equal(countProactiveContactsInWindow(appended, 'p1', NOW), 2)
  const bounded = appendProactiveContact(Array.from({ length: 25 }, (_, i) => ({ participantId: 'p1', at: new Date(NOW.getTime() - i * 60_000).toISOString() })), 'p1', NOW)
  assert.equal(bounded.length, 20, 'log keeps only the most recent 20 entries')
})

test('normalizeProactiveContactLog drops malformed entries and survives a codec roundtrip', () => {
  const dirty = [
    { participantId: 'p1', at: NOW.toISOString() },
    { participantId: '', at: NOW.toISOString() },
    { participantId: 'p2', at: 'not-a-date' },
    'junk',
    { participantId: 'p3', at: new Date(NOW.getTime() - 60_000).toISOString() },
  ]
  const clean = normalizeProactiveContactLog(dirty)
  assert.deepEqual(clean.map(item => item.participantId), ['p1', 'p3'])
  assert.deepEqual(normalizeProactiveContactLog(undefined), [])
})

test('capacity keeps hard gates while the interval follows the config (mode applied by the caller)', () => {
  const window = {
    activityLoad: 'free' as const, privacy: 'private' as const, deviceAccess: 'available' as const,
    validUntil: new Date(NOW.getTime() + 3_600_000).toISOString(), basis: '课间休息', sourceEntryIds: [1],
  }
  const candidate = {
    participantId: 'p1', origin: 'life-event' as const, motive: '想起了上次的话题', disclosure: 'ordinary' as const,
    sourceEntryIds: [1], outcome: 'send-now' as const, expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
  }
  const strictConfig = resolveAgencyConfig({ minimumProactiveIntervalMinutes: 60 })
  const naturalConfig = resolveAgencyConfig({ contactMode: 'natural', minimumProactiveIntervalMinutes: 60, naturalMinimumIntervalMinutes: 30 })
  const lastContact = new Date(NOW.getTime() - 45 * 60_000).toISOString()
  const strict = evaluateAgencyCapacity(window, candidate, NOW, strictConfig, lastContact)
  const natural = evaluateAgencyCapacity(window, candidate, NOW, { ...naturalConfig, minimumProactiveIntervalMinutes: naturalConfig.naturalMinimumIntervalMinutes! }, lastContact)
  assert.equal(strict.allowed, false, '45min < 60min strict interval blocks')
  assert.equal(strict.reason, 'minimum-proactive-interval')
  assert.equal(natural.allowed, true, '45min > 30min relaxed interval passes')
  // 容量硬门不因模式放宽：设备不可用与日程占用（非承诺/实用类）仍阻止。
  const noDevice = evaluateAgencyCapacity({ ...window, deviceAccess: 'unavailable' }, candidate, NOW, naturalConfig)
  assert.equal(noDevice.allowed, false)
  assert.equal(noDevice.reason, 'device-unavailable')
  const occupied = evaluateAgencyCapacity({ ...window, activityLoad: 'occupied' }, candidate, NOW, naturalConfig)
  assert.equal(occupied.allowed, false)
  assert.equal(occupied.reason, 'schedule-occupied')
})

test('normalizeProactiveContact keeps its strict validation for all origins', () => {
  const permitted = new Set(['p1'])
  const valid = new Set([1])
  const draft = normalizeProactiveContact({
    participantId: 'p1', origin: 'life-event', motive: '想分享今天的事', disclosure: 'ordinary',
    sourceEntryIds: [1], willingness: 0.2, outcome: 'send-now',
  }, NOW, resolveAgencyConfig({ contactMode: 'natural' }), permitted, valid, 1)
  assert.equal(draft?.origin, 'life-event')
  assert.equal(normalizeProactiveContact({ participantId: 'p1', origin: 'missing-you', motive: 'x', disclosure: 'ordinary', outcome: 'send-now' }, NOW, resolveAgencyConfig({ contactMode: 'natural' }), permitted, valid, 1), undefined, 'taxonomy unchanged: unknown origin still rejected')
})
