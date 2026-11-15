/* 生活节奏五档 × Urge 乘法模型回归：
 * - ATTENTION_MULTIPLIERS 五档映射
 * - planUrge 乘法公式(base / (densityFactor × rhythmFactor))
 * - 节奏过期(stale)走 restMultiplier 兜底
 * - normalizeLifeRhythm / lifeRhythmStale / lifeRhythmFromLegacyStatus
 * - commitUrge 的 rhythmAttention 提取 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ATTENTION_MULTIPLIERS, planUrge, commitUrge, urgeUserEvent, resolveUrgeConfig, normalizeUrgeState, type UrgeState } from '../src/urge'
import { normalizeLifeRhythm, lifeRhythmStale, lifeRhythmFromLegacyStatus } from '../src/story-state'

const minute = 60_000
const now = Date.now()
const c = resolveUrgeConfig({ enabled: true, frequency: 'custom', advanced: { idleMin: 20, idleMax: 20, hotMin: 10, hotMax: 10 } })

function fresh(): UrgeState { return { version: 1, buckets: [] } }
function dense(): UrgeState {
  let s = fresh()
  for (let i = 0; i < 6; i++) s = urgeUserEvent(s, now - (5 - i) * 2 * minute)
  return urgeUserEvent(s, now + 1000)
}
const noRandom = () => 0 // 采样固定在区间下限:idle=20min

test('ATTENTION_MULTIPLIERS 五档映射正确', () => {
  assert.equal(ATTENTION_MULTIPLIERS['phone-focused'], 1.4)
  assert.equal(ATTENTION_MULTIPLIERS['available'], 1.0)
  assert.equal(ATTENTION_MULTIPLIERS['occupied'], 0.7)
  assert.equal(ATTENTION_MULTIPLIERS['resting'], 0.5)
  assert.equal(ATTENTION_MULTIPLIERS['asleep'], 0.15)
})

test('planUrge 乘法公式:沉默×各档节奏 → 间隔 = 20/factor', () => {
  const silence = fresh()
  // density=0 → densityFactor=1 → minutes = 20 / rhythmFactor
  const phone = planUrge(silence, now, c, 0, false, noRandom, { attention: 'phone-focused' })
  assert.equal(phone.reason, 'rhythm:phone-focused')
  assert.equal(phone.minutes, 20 / 1.4)
  const asleep = planUrge(silence, now, c, 0, false, noRandom, { attention: 'asleep' })
  assert.equal(asleep.minutes, 20 / 0.15)
  const idle = planUrge(silence, now, c, 0, false, noRandom, { attention: 'available' })
  assert.equal(idle.minutes, 20)
  assert.equal(idle.reason, 'rhythm:available')
})

test('planUrge 密度×节奏相乘:密集对话+phone-focused 最密,沉默+asleep 最稀', () => {
  const d = dense()
  // density=1 → densityFactor=activeMultiplier(1.4)
  const hotPhone = planUrge(d, now, c, 0, false, noRandom, { attention: 'phone-focused' })
  assert.ok(Math.abs(hotPhone.minutes - 20 / (1.4 * 1.4)) < 0.1)
  const silenceAsleep = planUrge(fresh(), now, c, 0, false, noRandom, { attention: 'asleep' })
  assert.ok(hotPhone.minutes < silenceAsleep.minutes)
})

test('planUrge stale 节奏走 restMultiplier 兜底,不再替换为 restMinutes', () => {
  const d = fresh() // density=0
  const stale = planUrge(d, now, c, 1, false, noRandom, { attention: 'asleep', stale: true })
  // stale → rhythmFactor = restMultiplier(0.6),不是 asleep 的 0.15
  assert.equal(stale.reason, 'rest-window-fallback')
  assert.equal(stale.minutes, 20 / 0.6)
  // 非 stale + 无节奏 → 正常 conversation-density-decay
  const noRhythm = planUrge(d, now, c, 0, false, noRandom)
  assert.equal(noRhythm.reason, 'conversation-density-decay')
  assert.equal(noRhythm.minutes, 20)
})

test('planUrge unavailable 额外减速 50%', () => {
  const d = fresh()
  const normal = planUrge(d, now, c, 0, false, noRandom, { attention: 'available' })
  const unavailable = planUrge(d, now, c, 0, true, noRandom, { attention: 'available' })
  assert.equal(unavailable.minutes, normal.minutes / 0.5)
})

test('normalizeLifeRhythm 合法/非法输入', () => {
  const valid = normalizeLifeRhythm({ attention: 'phone-focused', basis: '她在看手机', assessedAt: new Date(now).toISOString(), source: 'compactor' })
  assert.ok(valid && valid.attention === 'phone-focused')
  assert.equal(normalizeLifeRhythm({ attention: 'invalid' }), undefined)
  assert.equal(normalizeLifeRhythm(null), undefined)
  assert.equal(normalizeLifeRhythm({ attention: 'asleep' }), undefined, '缺 assessedAt 拒绝')
})

test('lifeRhythmStale 2h 过期判定', () => {
  const fresh2 = { attention: 'available' as const, basis: '', assessedAt: new Date(now).toISOString(), source: 'compactor' as const }
  const old = { attention: 'available' as const, basis: '', assessedAt: new Date(now - 3 * 3_600_000).toISOString(), source: 'compactor' as const }
  assert.equal(lifeRhythmStale(fresh2, now), false)
  assert.equal(lifeRhythmStale(old, now), true)
  assert.equal(lifeRhythmStale(undefined, now), true)
})

test('lifeRhythmFromLegacyStatus 三值→五档映射', () => {
  assert.equal(lifeRhythmFromLegacyStatus({ status: 'busy', updatedAt: new Date(now).toISOString() })?.attention, 'occupied')
  assert.equal(lifeRhythmFromLegacyStatus({ status: 'asleep', updatedAt: new Date(now).toISOString() })?.attention, 'asleep')
  assert.equal(lifeRhythmFromLegacyStatus({ status: 'idle', updatedAt: new Date(now).toISOString() })?.attention, 'available')
  assert.equal(lifeRhythmFromLegacyStatus(undefined), undefined)
})

test('commitUrge 提取 rhythmAttention(合法五档才带)', () => {
  const script = '她躺在床上翻看手机。'
  const raw = { value: 0.8, basisQuote: '她躺在床上', rhythmAttention: 'phone-focused' }
  const committed = commitUrge(fresh(), raw, script, 1, undefined, now, c, () => 0.5)
  assert.equal(committed.rhythmAttention, 'phone-focused')
  const invalid = commitUrge(fresh(), { ...raw, rhythmAttention: 'surfing' }, script, 1, undefined, now, c, () => 0.5)
  assert.equal(invalid.rhythmAttention, undefined)
  const none = commitUrge(fresh(), { value: 0.8, basisQuote: '她躺在床上' }, script, 1, undefined, now, c, () => 0.5)
  assert.equal(none.rhythmAttention, undefined)
})

test('normalizeUrgeState 保留 rhythmAttention', () => {
  const state: UrgeState = { ...fresh(), rhythmAttention: 'occupied' }
  const restored = normalizeUrgeState(JSON.parse(JSON.stringify({ ...state, mode: '{}' })), now)
  assert.equal(restored.rhythmAttention, 'occupied')
})
