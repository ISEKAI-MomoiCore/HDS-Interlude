import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWillingnessPreset,
  ASLEEP_PROBABILITY_MULTIPLIER, consumeWillingnessGate, evaluateWillingnessGate, formatWillingnessGateDiagnosis, LIFE_RHYTHM_STALE_MS,
  rhythmTierBucket, type GroupWillingnessState, type WillingnessTier,
} from '../src/group-willingness'

const NOW = 1_700_000_000_000

/** 连续单条消息、固定掷骰值：返回首次触发调用的消息序号（1 基）。 */
function firstCallAt(preset: unknown, options: { random?: number, auto?: unknown, lifeRhythm?: { attention: unknown, assessedAt: string }, legacy?: Record<string, unknown> } = {}) {
  let state: GroupWillingnessState | undefined
  for (let index = 1; index <= 24; index += 1) {
    const decision = evaluateWillingnessGate(state, preset, options.auto, options.lifeRhythm, options.legacy as never, {
      now: NOW, messageCount: 1, content: `普通消息${index}`, quotedBot: false, mentionedBot: false, random: options.random ?? 0.4,
    })
    state = decision.state
    if (decision.shouldCall) return index
  }
  return Infinity
}

const rhythm = (attention: string, assessedAt: number | string = NOW - 60_000) => ({
  attention,
  assessedAt: typeof assessedAt === 'number' ? new Date(assessedAt).toISOString() : assessedAt,
})

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

test('preset off is stable off; legacy enabled+off is normalized to custom at rule entry (warmup B)', () => {
  const legacy = { enabled: true, threshold: 2, baseGain: 0.1, keywords: [] }
  // off 稳定表达关闭——不再被旧 enabled 隐式改成 custom。
  const offDecision = evaluateWillingnessGate(undefined, 'off', undefined, undefined, legacy, {
    now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: true,
  })
  assert.equal(offDecision.diagnosis.preset, 'off')
  assert.equal(offDecision.shouldCall, true, 'off 档 = 门关闭，普通消息直通评分外规则')
  // 迁移入口：旧组合在 groupRule() 归一为 custom（幂等）。
  const normalized = normalizeWillingnessPreset({ willingnessPreset: 'off', willingness: legacy })
  assert.equal(normalized.willingnessPreset, 'custom')
  const customDecision = evaluateWillingnessGate(undefined, normalized.willingnessPreset, undefined, undefined, legacy, {
    now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: true,
  })
  assert.equal(customDecision.diagnosis.preset, 'custom')
  assert.equal(customDecision.reason, 'forced-mention')
})

test('rhythmTierBucket: five attentions map to the three buckets (7.1.4 与压缩器旧派生同映射)', () => {
  assert.equal(rhythmTierBucket('occupied'), 'busy')
  assert.equal(rhythmTierBucket('asleep'), 'asleep')
  assert.equal(rhythmTierBucket('phone-focused'), 'idle')
  assert.equal(rhythmTierBucket('available'), 'idle')
  assert.equal(rhythmTierBucket('resting'), 'idle')
  assert.equal(rhythmTierBucket('dancing'), undefined)
  assert.equal(rhythmTierBucket(''), undefined)
})

test('auto maps each rhythm bucket to its configured tier', () => {
  assert.equal(firstCallAt('auto', { lifeRhythm: rhythm('available') }), firstCallAt('active'), 'available → idle 桶 → active by default')
  assert.equal(firstCallAt('auto', { lifeRhythm: rhythm('phone-focused') }), firstCallAt('active'), 'phone-focused → idle 桶 → active')
  assert.equal(firstCallAt('auto', { lifeRhythm: rhythm('occupied') }), firstCallAt('quiet'), 'occupied → busy 桶 → quiet by default')
  const custom = { busy: 'normal', idle: 'eager', asleep: 'reserved' }
  assert.equal(firstCallAt('auto', { auto: custom, lifeRhythm: rhythm('resting') }), firstCallAt('eager'), 'resting → idle 桶 → user-configured eager')
  assert.equal(firstCallAt('auto', { auto: custom, lifeRhythm: rhythm('occupied') }), firstCallAt('normal'), 'occupied → busy 桶 → user-configured normal')
})

test('asleep bucket blocks the mention bypass and multiplies probability', () => {
  const asleep = rhythm('asleep')
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
  assert.equal(lucky.diagnosis.bucket, 'asleep')
})

test('missing rhythm follows the configured idle tier, not a hardcoded tier', () => {
  assert.equal(firstCallAt('auto'), firstCallAt('active'), 'missing → default idle(active)')
  for (const idle of ['quiet', 'reserved', 'normal', 'active', 'eager'] as const) {
    assert.equal(firstCallAt('auto', { auto: { idle } }), firstCallAt(idle))
  }
  const decision = evaluateWillingnessGate(undefined, 'auto', { idle: 'eager' }, undefined, undefined, {
    now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: false, random: 0.4,
  })
  assert.equal(decision.shouldCall, true)
  assert.equal(decision.diagnosis.bucket, 'idle')
  assert.equal(decision.diagnosis.fallback, 'missing')
  assert.equal(decision.diagnosis.stale, undefined)
  assert.equal(formatWillingnessGateDiagnosis(decision.diagnosis), 'auto(无状态→idle→eager)')
})

test('stale and invalid rhythm use idle and never retain the asleep penalty', () => {
  const inputs = [
    { value: rhythm('asleep', NOW - LIFE_RHYTHM_STALE_MS - 1), fallback: 'stale', label: '过期' },
    { value: rhythm('dancing', NOW), fallback: 'invalid', label: '无效' },
    { value: rhythm('asleep', 'not-a-date'), fallback: 'invalid', label: '无效' },
  ]
  for (const { value, fallback, label } of inputs) {
    assert.equal(firstCallAt('auto', { auto: { idle: 'eager' }, lifeRhythm: value }), firstCallAt('eager'))
    const decision = evaluateWillingnessGate(undefined, 'auto', { idle: 'eager' }, value, undefined, {
      now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: true, random: 0.99,
    })
    assert.equal(decision.reason, 'forced-mention')
    assert.equal(decision.diagnosis.stale, true)
    assert.equal(decision.diagnosis.fallback, fallback)
    assert.equal(decision.diagnosis.bucket, 'idle')
    assert.equal(decision.diagnosis.tier, 'eager')
    assert.equal(decision.diagnosis.asleep, false)
    assert.equal(formatWillingnessGateDiagnosis(decision.diagnosis), 'auto(' + label + '→idle→eager)')
  }
})

test('fresh rhythm at the 2h expiry boundary keeps its real bucket', () => {
  const lifeRhythm = rhythm('occupied', NOW - LIFE_RHYTHM_STALE_MS)
  const decision = evaluateWillingnessGate(undefined, 'auto', { busy: 'quiet', idle: 'eager' }, lifeRhythm, undefined, {
    now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: false, random: 0.4,
  })
  assert.equal(decision.diagnosis.tier, 'quiet')
  assert.equal(decision.diagnosis.bucket, 'busy')
  assert.equal(decision.diagnosis.fallback, undefined)
  assert.equal(formatWillingnessGateDiagnosis(decision.diagnosis), 'auto(busy→quiet)')
})

test('7.1.4 semantic migration: 3h-old rhythm is now stale under the unified 2h window (was 6h for lifeStatus)', () => {
  // 旧 lifeStatus 口径下 3 小时仍在 6 小时窗内（busy 档）；统一后按 2 小时
  // 过期 → idle 桶回退。这是显式语义迁移，钉住防止悄悄回退。
  const decision = evaluateWillingnessGate(undefined, 'auto', { busy: 'quiet', idle: 'eager' }, rhythm('occupied', NOW - 3 * 3_600_000), undefined, {
    now: NOW, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: false, random: 0.4,
  })
  assert.equal(decision.diagnosis.fallback, 'stale')
  assert.equal(decision.diagnosis.bucket, 'idle')
  assert.equal(decision.diagnosis.tier, 'eager')
  assert.equal(formatWillingnessGateDiagnosis(decision.diagnosis), 'auto(过期→idle→eager)')
})

test('reply cost uses the same idle fallback as the invocation gate', () => {
  const state = { score: 1.2, updatedAt: NOW }
  const absent = consumeWillingnessGate(state, 'auto', { idle: 'eager' }, undefined, undefined, NOW, undefined, () => 0.5)
  const idleRhythm = consumeWillingnessGate(state, 'auto', { idle: 'eager' }, rhythm('available'), undefined, NOW, undefined, () => 0.5)
  assert.deepEqual(absent, idleRhythm)
  assert.equal(absent.score, 0.7)
})

test('all five tiers are distinct and ordered by invocation frequency', () => {
  const rates = (['quiet', 'reserved', 'normal', 'active', 'eager'] as WillingnessTier[]).map(tier => firstCallAt(tier))
  for (let index = 1; index < rates.length; index += 1) {
    assert.ok(rates[index]! < rates[index - 1]!, `tier ordering broken at ${index}: ${rates.join(',')}`)
  }
})
