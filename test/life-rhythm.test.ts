/* 生活节奏五档 × Urge 乘法模型回归：
 * - ATTENTION_MULTIPLIERS 五档映射
 * - planUrge 乘法公式(base / (densityFactor × rhythmFactor))
 * - 节奏过期(stale)走 restMultiplier 兜底
 * - normalizeLifeRhythm / lifeRhythmStale / lifeRhythmFromLegacyStatus
 * - 旧 Urge 字段兼容和剧本 focus 补写 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ATTENTION_MULTIPLIERS, planUrge, commitUrge, urgeUserEvent, resolveUrgeConfig, normalizeUrgeState, type UrgeState } from '../src/urge'
import { normalizeLifeRhythm, lifeRhythmStale, lifeRhythmFromLegacyStatus, decodeStoryState, CURRENT_STORY_STATE_VERSION } from '../src/story-state'

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

// ── 7.1.4 统一事实源：lifeStatus 加载迁移（版本 4→5）────────────────────

test('7.1.4 迁移：旧存档 lifeStatus-only → 并入 lifeRhythm，字段消失', () => {
  const legacy = {
    schemaVersion: 4,
    lifeStatus: { status: 'busy', updatedAt: new Date(now).toISOString() },
  }
  const decoded = decodeStoryState(legacy)
  assert.equal(decoded.lifeRhythm?.attention, 'occupied')
  assert.equal(decoded.lifeRhythm?.source, 'fallback')
  assert.equal(decoded.lifeRhythm?.assessedAt, legacy.lifeStatus.updatedAt)
  assert.equal('lifeStatus' in decoded, false, '字段不再输出')
  assert.equal(decoded.schemaVersion, CURRENT_STORY_STATE_VERSION)
  // 幂等：重解码（旧值已消费）不再产生变化。
  const twice = decodeStoryState(JSON.parse(JSON.stringify(decoded)))
  assert.deepEqual(twice.lifeRhythm, decoded.lifeRhythm)
  assert.equal('lifeStatus' in twice, false)
})

test('7.1.4 迁移：已有 lifeRhythm 不被旧 lifeStatus 覆盖；无效旧值被丢弃', () => {
  const both = {
    schemaVersion: 4,
    lifeStatus: { status: 'asleep', updatedAt: new Date(now).toISOString() },
    lifeRhythm: { attention: 'phone-focused', basis: '她在看手机', assessedAt: new Date(now).toISOString(), source: 'narrator' },
  }
  const decoded = decodeStoryState(both)
  assert.equal(decoded.lifeRhythm?.attention, 'phone-focused', '五档优先')
  assert.equal(decoded.lifeRhythm?.source, 'narrator')
  assert.equal('lifeStatus' in decoded, false)
  // 无效旧值（非法状态/坏时间戳）不产生 fallback 节奏。
  const invalid = decodeStoryState({ schemaVersion: 4, lifeStatus: { status: 'dancing', updatedAt: new Date(now).toISOString() } })
  assert.equal(invalid.lifeRhythm, undefined)
  // 旧值也不漏进 extensions（键仍在已知集合）。
  assert.equal(invalid.extensions ? 'lifeStatus' in invalid.extensions : false, false)
})

test('commitUrge ignores the retired model rhythmAttention field', () => {
  const script = '她躺在床上，闭目养神。'
  const raw = { pace: 'slow', basisQuote: '她躺在床上', rhythmAttention: 'phone-focused' }
  const committed = commitUrge(fresh(), raw, script, 1, undefined, now, c)
  assert.equal(committed.pace, 'slow')
  assert.equal(committed.rhythmAttention, undefined)
})

test('normalizeUrgeState drops the retired rhythmAttention handoff field', () => {
  const state: UrgeState = { ...fresh(), rhythmAttention: 'occupied' }
  const restored = normalizeUrgeState(JSON.parse(JSON.stringify({ ...state, mode: '{}' })), now)
  assert.equal(restored.rhythmAttention, undefined)
})

test('7.1.4 压缩器只写 lifeRhythm：不再派生/写入 lifeStatus（含经迁移的旧存档）', async () => {
  const { InterludeService } = await import('../src/service')
  let stored: any = { schemaVersion: 4, lifeStatus: { status: 'idle', updatedAt: new Date(now).toISOString() } }
  const host: any = {
    memoryConfig: { sceneHookCharacters: 100, sceneSummaryCharacters: 300, arcSummaryCharacters: 300 },
    dbGet: async (table: string, query: any) => table === 'interlude_script_entry' ? (query.kind === 'script' ? entries : []) : [],
    dbSet: async (table: string, _q: any, patch: any) => { if (table === 'interlude_story') stored = patch.state },
    getStory: async () => ({ id: 's', state: stored }),
    activeArc: async () => ({ id: 1 }),
    reportOperation: () => {},
  }
  const decision = { scene: { summary: '生活继续' }, arc: { summary: '原剧情弧' }, lifeRhythm: { attention: 'busy-work', quote: '她专心写着报告。', sourceEntryId: 1 } }
  const entries: any[] = [{ id: 1, storyId: 's', kind: 'script', actor: 'narrator', content: '她专心写着报告。', occurredAt: new Date(now), metadata: {}, createdAt: new Date(now) }]
  await (InterludeService.prototype as any).persistCompactionOutputs.call(host, { id: 's' }, { id: 1, entryCount: 0 }, decision, entries, new Date(now))
  const first = decodeStoryState(stored)
  assert.equal(first.lifeRhythm?.attention, 'busy-work')
  assert.equal(first.lifeRhythm?.source, 'compactor')
  assert.equal('lifeStatus' in first, false, '旧三值不再落库')
  assert.equal(first.schemaVersion, CURRENT_STORY_STATE_VERSION)
  // 同一段证据的重复评估不刷新证据时间。
  await (InterludeService.prototype as any).persistCompactionOutputs.call(host, { id: 's' }, { id: 1, entryCount: 0 }, decision, entries, new Date(now))
  assert.equal(decodeStoryState(stored).lifeRhythm?.attention, 'busy-work')
  assert.equal('lifeStatus' in decodeStoryState(stored), false)
})
