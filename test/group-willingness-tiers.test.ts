import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ASLEEP_PROBABILITY_MULTIPLIER, consumeWillingnessGate, evaluateWillingnessGate, formatWillingnessGateDiagnosis, LIFE_STATUS_STALE_MS,
  normalizeLifeStatusDraft, type GroupWillingnessState, type WillingnessTier,
} from '../src/group-willingness'

const NOW = 1_700_000_000_000

/** 连续单条消息、固定掷骰值：返回首次触发调用的消息序号（1 基）。 */
function firstCallAt(preset: unknown, options: { random?: number, auto?: unknown, lifeStatus?: { status: unknown, updatedAt: string }, legacy?: Record<string, unknown> } = {}) {
  let state: GroupWillingnessState | undefined
  for (let index = 1; index <= 24; index += 1) {
    const decision = evaluateWillingnessGate(state, preset, options.auto, options.lifeStatus, options.legacy as never, {
      now: NOW, messageCount: 1, content: `普通消息${index}`, quotedBot: false, mentionedBot: false, random: options.random ?? 0.4,
    })
    state = decision.state
    if (decision.shouldCall) return index
  }
  return Infinity
}

test('tier calibration: normal first call lands on message 4~5 (baseline), neighbours scale around it', () => {
  // 固定掷骰 0.4：概率越过 0.4 才触发——近似期望首发位置。
  assert.equal(firstCallAt('eager'), 1, 'eager: msg1 probability 0.63')
  assert.equal(firstCallAt('active'), 2, 'active: msg2 probability ~0.59')
  const normal = firstCallAt('normal')
  assert.ok(normal === 4 || normal === 5, `normal expected 4~5, got ${normal}`)
  const reserved = firstCallAt('reserved')
  assert.ok(reserved >= 6 && reserved <= 8, `reserved expected 6~8, got ${reserved}`)
  const quiet = firstCallAt('quiet')
  assert.ok(quiet >= 9 && quiet <= 13, `quiet expected 9~13, got ${quiet}`)
})

test('off disables the gate entirely (legacy numbers ignored)', () => {
  const decision = evaluateWillingnessGate(undefined, 'off', undefined, undefined, { enabled: false }, {
    now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: false,
  })
  assert.equal(decision.shouldCall, true)
  assert.equal(decision.reason, 'disabled')
  assert.equal(decision.diagnosis.preset, 'off')
})

test('legacy numeric gate with preset off is treated as custom (migration-safe)', () => {
  const legacy = { enabled: true, threshold: 2, baseGain: 0.1, keywords: [] }
  assert.equal(firstCallAt('off', { legacy }), Infinity, 'an unreachable legacy threshold never calls')
  const decision = evaluateWillingnessGate(undefined, 'off', undefined, undefined, legacy, {
    now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: true,
  })
  assert.equal(decision.diagnosis.preset, 'custom')
  assert.equal(decision.reason, 'forced-mention')
})

test('auto maps each life status to its configured tier', () => {
  const idle = { status: 'idle', updatedAt: new Date(NOW - 60_000).toISOString() }
  const busy = { status: 'busy', updatedAt: new Date(NOW - 60_000).toISOString() }
  assert.equal(firstCallAt('auto', { lifeStatus: idle }), firstCallAt('active'), 'idle → active by default')
  assert.equal(firstCallAt('auto', { lifeStatus: busy }), firstCallAt('quiet'), 'busy → quiet by default')
  const custom = { busy: 'normal', idle: 'eager', asleep: 'reserved' }
  assert.equal(firstCallAt('auto', { auto: custom, lifeStatus: idle }), firstCallAt('eager'), 'idle → user-configured eager')
  assert.equal(firstCallAt('auto', { auto: custom, lifeStatus: busy }), firstCallAt('normal'), 'busy → user-configured normal')
})

test('asleep blocks the mention bypass and multiplies probability', () => {
  const asleep = { status: 'asleep', updatedAt: new Date(NOW - 60_000).toISOString() }
  // @ 不再直通：睡眠态下首条消息（eager 映射时概率 0.63×0.2≈0.13）不触发。
  const blocked = evaluateWillingnessGate(undefined, 'auto', { asleep: 'eager' }, asleep, undefined, {
    now: NOW, messageCount: 1, content: '在吗', quotedBot: false, mentionedBot: true, random: 0.5,
  })
  assert.equal(blocked.shouldCall, false)
  assert.equal(blocked.reason, 'asleep')
  assert.ok(blocked.probability <= ASLEEP_PROBABILITY_MULTIPLIER + 1e-9, `multiplied probability ${blocked.probability}`)
  // 概率乘数后的掷骰仍可命中：掷 0.05 < 0.126 触发。
  const lucky = evaluateWillingnessGate(undefined, 'auto', { asleep: 'eager' }, asleep, undefined, {
    now: NOW, messageCount: 1, content: '在吗', quotedBot: false, mentionedBot: true, random: 0.05,
  })
  assert.equal(lucky.shouldCall, true)
  assert.equal(lucky.diagnosis.asleep, true)
})

test('missing life status follows the configured idle tier, not a hardcoded tier', () => {
  assert.equal(firstCallAt('auto'), firstCallAt('active'), 'missing → default idle(active)')
  for (const idle of ['quiet', 'reserved', 'normal', 'active', 'eager'] as const) {
    assert.equal(firstCallAt('auto', { auto: { idle } }), firstCallAt(idle))
  }
  const decision = evaluateWillingnessGate(undefined, 'auto', { idle: 'eager' }, undefined, undefined, {
    now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: false, random: 0.4,
  })
  assert.equal(decision.shouldCall, true)
  assert.equal(decision.diagnosis.lifeStatus, 'idle')
  assert.equal(decision.diagnosis.fallback, 'missing')
  assert.equal(decision.diagnosis.stale, undefined)
  assert.equal(formatWillingnessGateDiagnosis(decision.diagnosis), 'auto(无状态→idle→eager)')
})

test('stale and invalid life status use idle and never retain the asleep penalty', () => {
  const inputs = [
    { value: { status: 'asleep', updatedAt: new Date(NOW - LIFE_STATUS_STALE_MS - 1).toISOString() }, fallback: 'stale', label: '过期' },
    { value: { status: 'unknown', updatedAt: new Date(NOW).toISOString() }, fallback: 'invalid', label: '无效' },
    { value: { status: 'asleep', updatedAt: 'not-a-date' }, fallback: 'invalid', label: '无效' },
  ]
  for (const { value, fallback, label } of inputs) {
    assert.equal(firstCallAt('auto', { auto: { idle: 'eager' }, lifeStatus: value }), firstCallAt('eager'))
    const decision = evaluateWillingnessGate(undefined, 'auto', { idle: 'eager' }, value, undefined, {
      now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: true, random: 0.99,
    })
    assert.equal(decision.reason, 'forced-mention')
    assert.equal(decision.diagnosis.stale, true)
    assert.equal(decision.diagnosis.fallback, fallback)
    assert.equal(decision.diagnosis.lifeStatus, 'idle')
    assert.equal(decision.diagnosis.tier, 'eager')
    assert.equal(decision.diagnosis.asleep, false)
    assert.equal(formatWillingnessGateDiagnosis(decision.diagnosis), 'auto(' + label + '→idle→eager)')
  }
})

test('fresh life status at the expiry boundary keeps its real state', () => {
  const lifeStatus = { status: 'busy', updatedAt: new Date(NOW - LIFE_STATUS_STALE_MS).toISOString() }
  const decision = evaluateWillingnessGate(undefined, 'auto', { busy: 'quiet', idle: 'eager' }, lifeStatus, undefined, {
    now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: false, random: 0.4,
  })
  assert.equal(decision.diagnosis.tier, 'quiet')
  assert.equal(decision.diagnosis.fallback, undefined)
  assert.equal(formatWillingnessGateDiagnosis(decision.diagnosis), 'auto(busy→quiet)')
})

test('reply cost uses the same idle fallback as the invocation gate', () => {
  const state = { score: 1.2, updatedAt: NOW }
  const absent = consumeWillingnessGate(state, 'auto', { idle: 'eager' }, undefined, undefined, NOW)
  const idle = consumeWillingnessGate(state, 'auto', { idle: 'eager' }, { status: 'idle', updatedAt: new Date(NOW).toISOString() }, undefined, NOW)
  assert.deepEqual(absent, idle)
  assert.equal(absent.score, 0.7)
})

test('normalizeLifeStatusDraft accepts exactly the three documented values', () => {
  assert.equal(normalizeLifeStatusDraft('busy'), 'busy')
  assert.equal(normalizeLifeStatusDraft('asleep'), 'asleep')
  assert.equal(normalizeLifeStatusDraft('idle'), 'idle')
  assert.equal(normalizeLifeStatusDraft('sleeping'), undefined)
  assert.equal(normalizeLifeStatusDraft(undefined), undefined)
  assert.equal(normalizeLifeStatusDraft(42), undefined)
})

test('all five tiers are distinct and ordered by invocation frequency', () => {
  const rates = (['quiet', 'reserved', 'normal', 'active', 'eager'] as WillingnessTier[]).map(tier => firstCallAt(tier))
  for (let index = 1; index < rates.length; index += 1) {
    assert.ok(rates[index]! < rates[index - 1]!, `tier ordering broken at ${index}: ${rates.join(',')}`)
  }
})
