import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import {
  DEFAULT_DELIVERY_POLICY_CONFIG, deliveryPolicyRevision, evaluateDeliveryPolicy,
  migrateLegacyRunLimits, policyActionRecordsFromLedger,
  resolveDeliveryPolicyConfig, type PolicyActionRecord,
} from '../src/script/delivery-policy'

const NOW = new Date('2026-11-14T12:00:00.000Z')
const MINUTE = 60_000

// ── 配置解析与修订标识 ─────────────────────────────────────────────────────

test('P2 policy config resolves defaults and clamps out-of-range values', () => {
  assert.deepEqual(resolveDeliveryPolicyConfig(undefined), DEFAULT_DELIVERY_POLICY_CONFIG)
  assert.deepEqual(resolveDeliveryPolicyConfig({ proactivePerTargetDailyCap: 999, minimumRunIntervalMinutes: -5 }), {
    ...DEFAULT_DELIVERY_POLICY_CONFIG, proactivePerTargetDailyCap: 200, minimumRunIntervalMinutes: 0,
  })
})

test('P2 policy revision changes with config and stays stable otherwise', () => {
  const base = deliveryPolicyRevision(DEFAULT_DELIVERY_POLICY_CONFIG)
  assert.equal(deliveryPolicyRevision({ ...DEFAULT_DELIVERY_POLICY_CONFIG }), base)
  assert.notEqual(deliveryPolicyRevision({ ...DEFAULT_DELIVERY_POLICY_CONFIG, minimumRunIntervalMinutes: 30 }), base)
})

// ── 额度记录派生：P2 数据源（contactLog）与 P3 数据源（投递账本）────────────

test('P2 ledger derivation rebuilds the full window from persisted script entries (restart-safe)', () => {
  const entries = [
    { kind: 'user-message', metadata: {} },
    { kind: 'script', metadata: { deliveryActions: [
      { commitId: 'c1', eventId: 'e1', participantId: 'alice', status: 'delivered', updatedAt: new Date(NOW.getTime() - 10 * MINUTE).toISOString(), segments: [] },
      { commitId: 'c1', eventId: 'e2', participantId: 'alice', status: 'failed', updatedAt: new Date(NOW.getTime() - 20 * MINUTE).toISOString(), segments: [] },
    ] } },
    { kind: 'script', metadata: { deliveryActions: [
      { commitId: 'c2', eventId: 'e3', participantId: 'bob', status: 'unknown', updatedAt: new Date(NOW.getTime() - 30 * MINUTE).toISOString(), segments: [] },
    ] } },
    // 窗口外（>24h）不参与额度。
    { kind: 'script', metadata: { deliveryActions: [
      { commitId: 'c3', eventId: 'e4', participantId: 'alice', status: 'pending', updatedAt: new Date(NOW.getTime() - 25 * 3_600_000).toISOString(), segments: [] },
    ] } },
  ]
  const records = policyActionRecordsFromLedger(entries as any, NOW)
  assert.deepEqual(records.map(record => [record.actionId, record.participantId, record.settled]), [
    ['c1:e1', 'alice', true],
    ['c1:e2', 'alice', false],
    ['c2:e3', 'bob', true],
  ], 'delivered/partial/pending/unknown occupy; failed/cancelled release; window bounded')
})

test('daily cap excludes explicitly user-initiated replies but conservatively counts legacy rows', () => {
  const entries = [{ kind: 'script', metadata: { deliveryActions: [
    ...Array.from({ length: 9 }, (_, index) => ({
      commitId: `reply-${index}`, eventId: `r${index}`, participantId: 'alice', status: 'delivered',
      updatedAt: new Date(NOW.getTime() - (index + 1) * MINUTE).toISOString(), userInitiated: true,
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      commitId: `proactive-${index}`, eventId: `p${index}`, participantId: 'alice', status: 'delivered',
      updatedAt: new Date(NOW.getTime() - (index + 20) * MINUTE).toISOString(),
    })),
  ] } }]
  const records = policyActionRecordsFromLedger(entries as any, NOW)
  const config = { ...DEFAULT_DELIVERY_POLICY_CONFIG, proactivePerTargetDailyCap: 8 }
  const allowed = evaluateDeliveryPolicy({ config, targetId: 'alice', records, now: NOW })
  assert.equal(allowed.allowed, true, '9 user replies plus 2 proactive actions use only 2 cap slots')
  assert.equal(allowed.counted, 2)

  const atLimit = [...records, ...Array.from({ length: 6 }, (_, index) => record('alice', 40 + index))]
  const blocked = evaluateDeliveryPolicy({ config, targetId: 'alice', records: atLimit, now: NOW })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.reason, 'policy-daily-cap')
  assert.equal(blocked.counted, 8, 'cap diagnostics report only quota-counted actions')

  const legacy = policyActionRecordsFromLedger([{ kind: 'script', metadata: { deliveryActions: [
    { commitId: 'legacy', eventId: 'e1', participantId: 'alice', status: 'delivered', updatedAt: NOW.toISOString() },
  ] } }], NOW)
  assert.equal(evaluateDeliveryPolicy({ config: { ...config, proactivePerTargetDailyCap: 1 }, targetId: 'alice', records: legacy, now: NOW }).allowed,
    false, 'missing origin stamp retains the old counting behavior')
})

test('user replies remain interval anchors even though the daily cap excludes them', () => {
  const config = { ...DEFAULT_DELIVERY_POLICY_CONFIG, proactivePerTargetDailyCap: 8, minimumRunIntervalMinutes: 60 }
  const reply = { ...record('alice', 30), userInitiated: true }
  const blocked = evaluateDeliveryPolicy({ config, targetId: 'alice', records: [reply], now: NOW })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.reason, 'policy-run-interval')
  assert.equal(blocked.counted, 0)
})

// ── evaluateDeliveryPolicy：矩阵（A06/A14/A18 的纯函数部分）────────────────

function record(participantId: string, minutesAgo: number, settled = true): PolicyActionRecord {
  return { actionId: `${participantId}:${minutesAgo}:${settled}`, participantId,
    occurredAt: new Date(NOW.getTime() - minutesAgo * MINUTE), settled }
}

test('P2 all-zero policy is inert (policy-off) and never blocks', () => {
  const evaluation = evaluateDeliveryPolicy({
    config: DEFAULT_DELIVERY_POLICY_CONFIG, targetId: 'alice',
    records: [record('alice', 1), record('alice', 2)], now: NOW,
  })
  assert.equal(evaluation.allowed, true)
  assert.equal(evaluation.reason, 'policy-off')
})

test('P2 rolling cap counts settled actions per target only and blocks at the limit', () => {
  const config = { ...DEFAULT_DELIVERY_POLICY_CONFIG, proactivePerTargetDailyCap: 2 }
  const records = [record('alice', 30), record('alice', 300), record('bob', 10), record('alice', 600, false)]
  const blocked = evaluateDeliveryPolicy({ config, targetId: 'alice', records, now: NOW })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.reason, 'policy-daily-cap')
  assert.equal(blocked.counted, 2, 'other targets and released actions do not consume quota')
  const otherTarget = evaluateDeliveryPolicy({ config, targetId: 'bob', records, now: NOW })
  assert.equal(otherTarget.allowed, true, 'multi-target quotas stay independent')
})

test('P2 run interval anchors on logical proactive actions with next eligibility; A18 keeps the promise exemption', () => {
  const config = { ...DEFAULT_DELIVERY_POLICY_CONFIG, minimumRunIntervalMinutes: 60 }
  const records = [record('alice', 30)]
  const blocked = evaluateDeliveryPolicy({ config, targetId: 'alice', records, now: NOW })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.reason, 'policy-run-interval')
  assert.equal(blocked.nextEligibleAt, new Date(NOW.getTime() + 30 * MINUTE).toISOString())
  const exempt = evaluateDeliveryPolicy({ config, targetId: 'alice', records, now: NOW, intervalExempt: true })
  assert.equal(exempt.allowed, true, 'first switch keeps the legacy promise/practical exemption')
  const stale = evaluateDeliveryPolicy({ config, targetId: 'alice', records: [record('alice', 90)], now: NOW })
  assert.equal(stale.allowed, true)
})

test('P2 deferral validity terminates expired deferred actions', () => {
  const config = { ...DEFAULT_DELIVERY_POLICY_CONFIG, deferralValidityMinutes: 30 }
  const expired = evaluateDeliveryPolicy({
    config, targetId: 'alice', records: [], now: NOW,
    deferredSince: new Date(NOW.getTime() - 31 * MINUTE),
  })
  assert.equal(expired.allowed, false)
  assert.equal(expired.reason, 'policy-deferral-expired')
  const active = evaluateDeliveryPolicy({
    config, targetId: 'alice', records: [], now: NOW,
    deferredSince: new Date(NOW.getTime() - 29 * MINUTE),
  })
  assert.equal(active.allowed, true)
})

// ── 旧限制保守迁移（§12.2 / A18）──────────────────────────────────────────

test('P2 legacy migration maps only limits that actually applied', () => {
  const disabled = migrateLegacyRunLimits({
    agencyEnabled: false, contactMode: 'strict', minimumProactiveIntervalMinutes: 60,
    naturalMinimumIntervalMinutes: 30, proactiveDailyCap: 3,
  })
  assert.deepEqual(disabled.config, DEFAULT_DELIVERY_POLICY_CONFIG)
  assert.ok(disabled.notes.some(note => note.includes('从未实际生效')))

  const strict = migrateLegacyRunLimits({
    agencyEnabled: true, contactMode: 'strict', minimumProactiveIntervalMinutes: 60,
    naturalMinimumIntervalMinutes: 30, proactiveDailyCap: 3,
  })
  assert.equal(strict.config.minimumRunIntervalMinutes, 60)
  assert.equal(strict.config.proactivePerTargetDailyCap, 3)

  const natural = migrateLegacyRunLimits({
    agencyEnabled: true, contactMode: 'natural', minimumProactiveIntervalMinutes: 60,
    naturalMinimumIntervalMinutes: 30, proactiveDailyCap: 3,
  })
  assert.equal(natural.config.minimumRunIntervalMinutes, 30, 'natural mode used its smaller effective interval')

  const balanced = migrateLegacyRunLimits({
    agencyEnabled: true, contactMode: 'balanced', minimumProactiveIntervalMinutes: 60,
    naturalMinimumIntervalMinutes: 90, proactiveDailyCap: 3,
  })
  assert.equal(balanced.config.minimumRunIntervalMinutes, 60, 'relaxation never raises the strict interval')

  for (const result of [strict, natural, balanced]) {
    assert.ok(result.notes.some(note => note.includes('A18') && note.includes('豁免')), 'exemption retention is recorded')
    assert.ok(result.notes.some(note => note.includes('任何上次发言')), 'semantic difference is recorded')
  }
})

// ── 服务层派生：显式配置优先，全默认值按旧链保守派生 ───────────────────────

test('P2 service getter prefers explicit policy and derives conservatively from legacy otherwise', () => {
  const host: any = Object.create(InterludeService.prototype)
  host.config = {
    agency: { enabled: true, contactMode: 'natural', minimumProactiveIntervalMinutes: 60,
      naturalMinimumIntervalMinutes: 30, proactiveDailyCap: 3 },
  }
  assert.deepEqual(host.deliveryPolicyConfig, {
    ...DEFAULT_DELIVERY_POLICY_CONFIG, minimumRunIntervalMinutes: 30, proactivePerTargetDailyCap: 3,
  }, 'all-default policy derives from the legacy effective limits')

  host.config = {
    agency: { enabled: true, contactMode: 'strict', minimumProactiveIntervalMinutes: 60,
      naturalMinimumIntervalMinutes: 30, proactiveDailyCap: 3 },
    deliveryPolicy: { proactivePerTargetDailyCap: 0, minimumRunIntervalMinutes: 15, deferralValidityMinutes: 0 },
  }
  host.cachedAgencyConfig = undefined
  host.cachedDeliveryPolicyConfig = undefined
  assert.equal(host.deliveryPolicyConfig.minimumRunIntervalMinutes, 15, 'explicit values win over derivation')
  assert.equal(host.deliveryPolicyConfig.proactivePerTargetDailyCap, 0)

  host.config = { agency: { enabled: false } }
  host.cachedAgencyConfig = undefined
  host.cachedDeliveryPolicyConfig = undefined
  assert.deepEqual(host.deliveryPolicyConfig, DEFAULT_DELIVERY_POLICY_CONFIG, 'disabled legacy derives no extra quota')
})
