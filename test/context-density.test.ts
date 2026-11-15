import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ConversationDensityTracker, DEFAULT_CONTEXT_ENTRY_AUTO, DEFAULT_CONTEXT_ENTRY_TIERS,
  densityTier, effectiveContextEntryLimit, effectiveScopeMode, resolveContextEntryAutoConfig,
} from '../src/context-density'

const minute = 60_000
const t0 = 1_000_000_000

test('density tiers map windowed message counts onto four levels', () => {
  assert.equal(densityTier({ count5: 5, count15: 8, count30: 9 }), 'burst', '近 5 分钟 ≥4 条 → 极高')
  assert.equal(densityTier({ count5: 4, count15: 4, count30: 6 }), 'burst')
  assert.equal(densityTier({ count5: 2, count15: 3, count30: 5 }), 'high', '近 5 分钟 ≥2 条 → 高')
  assert.equal(densityTier({ count5: 1, count15: 5, count30: 7 }), 'high', '近 15 分钟 ≥4 条 → 高')
  assert.equal(densityTier({ count5: 1, count15: 2, count30: 4 }), 'normal')
  assert.equal(densityTier({ count5: 0, count15: 1, count30: 2 }), 'normal', '30 分钟内有但稀疏 → 日常')
  assert.equal(densityTier({ count5: 0, count15: 0, count30: 0 }), 'low', '30 分钟无消息 → 低')
})

test('the density tracker keeps a 30-minute rolling window per story', () => {
  const tracker = new ConversationDensityTracker()
  tracker.record('a', t0)
  tracker.record('a', t0 + 2 * minute)
  tracker.record('b', t0 + 3 * minute)
  assert.deepEqual(tracker.counts('a', t0 + 4 * minute), { count5: 2, count15: 2, count30: 2 })
  assert.deepEqual(tracker.counts('b', t0 + 4 * minute), { count5: 1, count15: 1, count30: 1 })
  assert.deepEqual(tracker.counts('c', t0 + 4 * minute), { count5: 0, count15: 0, count30: 0 }, '未知故事为低密度')
  // 超 30 分钟的旧消息滑出窗口（33 分钟时记录，2 分钟档那条也过期）。
  tracker.record('a', t0 + 33 * minute)
  const later = tracker.counts('a', t0 + 33 * minute + 1)
  assert.equal(later.count30, 1)
})

test('auto mode maps tiers to entry budgets with advance override and anchor as normal', () => {
  const config = resolveContextEntryAutoConfig({ mode: 'auto' })
  const base = { config, scope: 'private' as const, anchor: 18 }
  assert.equal(effectiveContextEntryLimit({ ...base, phase: 'user-message', tier: 'burst' }), 12)
  assert.equal(effectiveContextEntryLimit({ ...base, phase: 'user-message', tier: 'high' }), 15)
  assert.equal(effectiveContextEntryLimit({ ...base, phase: 'user-message', tier: 'normal' }), 18, '日常档 = 锚点')
  assert.equal(effectiveContextEntryLimit({ ...base, phase: 'user-message', tier: 'low' }), 22)
  assert.equal(effectiveContextEntryLimit({ ...base, phase: 'advance', tier: 'low' }), 25, '自动推进无视密度用推进档')
  // 锚点变化 → 日常档跟随；其余档保持配置绝对值。
  assert.equal(effectiveContextEntryLimit({ ...base, anchor: 20, phase: 'user-message', tier: 'normal' }), 20)
  assert.equal(effectiveContextEntryLimit({ ...base, anchor: 20, phase: 'user-message', tier: 'burst' }), 12)
  // fixed 模式恒返回锚点。
  const fixed = resolveContextEntryAutoConfig({ mode: 'fixed' })
  assert.equal(effectiveContextEntryLimit({ config: fixed, scope: 'private', anchor: 18, phase: 'user-message', tier: 'burst' }), 18)
})

test('scopes can diverge or follow the top-level mode via inherit', () => {
  const config = resolveContextEntryAutoConfig({
    mode: 'auto',
    group: { mode: 'fixed' },
    private: { mode: 'auto', tiers: { burst: 10, high: 14, low: 24, advance: 28 } },
  })
  assert.equal(effectiveScopeMode(config, 'private'), 'auto')
  assert.equal(effectiveScopeMode(config, 'group'), 'fixed', '群聊覆写为固定')
  assert.equal(effectiveContextEntryLimit({ config, scope: 'group', anchor: 18, phase: 'user-message', tier: 'burst' }), 18, '群聊 fixed → 锚点')
  assert.equal(effectiveContextEntryLimit({ config, scope: 'private', anchor: 18, phase: 'user-message', tier: 'burst' }), 10, '私聊自定义档位')
  assert.equal(effectiveContextEntryLimit({ config, scope: 'private', anchor: 18, phase: 'advance', tier: 'low' }), 28)
  // 默认：两类型 inherit 跟随顶层 fixed。
  assert.equal(effectiveScopeMode(DEFAULT_CONTEXT_ENTRY_AUTO, 'private'), 'fixed')
  assert.equal(effectiveScopeMode(DEFAULT_CONTEXT_ENTRY_AUTO, 'group'), 'fixed')
  assert.deepEqual(DEFAULT_CONTEXT_ENTRY_TIERS, { burst: 12, high: 15, low: 22, advance: 25 })
})

test('tier resolution clamps values into a sane range and tolerates junk', () => {
  const clamped = resolveContextEntryAutoConfig({ mode: 'auto', private: { mode: 'auto', tiers: { burst: 1, high: 9999, low: 'x', advance: 0 } } })
  assert.deepEqual(clamped.private.tiers, { burst: 4, high: 200, low: 22, advance: 25 }, '夹取到 [4,200]，垃圾值回默认')
  assert.equal(resolveContextEntryAutoConfig(undefined).mode, 'fixed')
  assert.equal(resolveContextEntryAutoConfig({ private: { mode: 'weird' } }).private.mode, 'inherit')
})

test('group replay duplicates do not double-count density (audit: record sits after dedup)', () => {
  // 结构断言：receiveGroup 内 contextDensity.record 必须出现在群去重块之后。
  const source = require('node:fs').readFileSync('src/inbound-gate.ts', 'utf8') // P8-S5：receiveGroup/receive 迁至 inbound-gate，标记随代码逐字搬运
  const recordPos = source.indexOf('密度计数在去重之后：桌面超时-重放的同一条群消息不得双计')
  const dedupPos = source.indexOf('桥接重放去重命中（群聊）')
  assert.ok(recordPos > 0 && dedupPos > 0, '两个标记都存在')
  assert.ok(recordPos > dedupPos, '密度记录位于群去重之后')
  // 私聊侧：记录位于私聊去重之后。
  const privateDedup = source.indexOf('桥接重放去重命中，跳过重复消息')
  const privateRecord = source.indexOf('svc.contextDensity.record(story.id, receivedAt!.getTime())\n    const observed = svc.describeVisionEvent(session)')
  assert.ok(privateRecord > privateDedup, '私聊密度记录位于私聊去重之后')
})
