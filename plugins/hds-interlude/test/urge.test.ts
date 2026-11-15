import assert from 'node:assert/strict'
import test from 'node:test'
import * as urgeModule from '../src/urge'
import { commitUrge, normalizeUrgeState, planUrge, resolveUrgeConfig, urgeDensity, urgeInstruction, urgeUserEvent } from '../src/urge'
import { decodeStoryState, encodeStoryState } from '../src/story-state'
import { storyStateForPrompt } from '../src/narrator'
import { InterludeService } from '../src/service'
import { Config } from '../src/index'

/** P3.2（设计 §9）：Urge 收敛为生活推进调度。联系专用状态（value 意愿值、
 * armed/burst/spent、contactMin、hot 区间、抖动与 extremeChance）全部退役；
 * 本文件按新契约断言：buckets/密度/halfLife、五档节奏倍率、slow/normal、
 * 建议间隔、rest-window 兜底与乘法模型。 */
const now = Date.parse('2026-09-07T04:00:00Z'), minute = 60_000
const c = resolveUrgeConfig({ enabled: true })
const fresh = () => normalizeUrgeState({}, now)
const quote = '她想再问一句。'
const handoff = { pace: 'normal' as const, basisQuote: quote }
const arm = () => commitUrge(fresh(), handoff, quote, 9, 'alice', now, c)

test('Urge legacy JSON including empty/partial state always reads defensively', () => {
  for (const raw of [null, {}, [], 'bad', { version: 1 }, { version: 1, buckets: {}, armed: [], burst: { started: 'bad' } }, { version: 99, buckets: [now] }]) {
    const state = normalizeUrgeState(raw, now)
    assert.ok(Array.isArray(state.buckets))
    assert.ok(Number.isFinite(Date.parse(planUrge(state, now, c).nextAdvanceAt)))
  }
})
test('Urge round trips through existing story JSON without schema migration or leaking into prompts', () => {
  const committed = commitUrge(fresh(), { pace: 'slow', suggestedDelayMinutes: 90, rhythmAttention: 'occupied', basisQuote: quote }, quote, 9, 'alice', now, c)
  const state = decodeStoryState({ extensions: { urge: committed, custom: 'keep' } })
  const restored = decodeStoryState(JSON.parse(JSON.stringify(encodeStoryState(state))))
  const urge = normalizeUrgeState(restored.extensions?.urge, now)
  assert.equal(urge.sourceEntryId, 9)
  assert.equal(urge.pace, 'slow')
  assert.equal(urge.suggested, 90)
  assert.equal(urge.rhythmAttention, 'occupied')
  // §9：往返后的状态集只剩调度字段——联系专用字段不再出现。
  for (const key of ['armed', 'burst', 'spent', 'value', 'contactMin', 'hot']) assert.ok(!(key in urge), `${key} 应随 §9 退役`)
  assert.equal(storyStateForPrompt(restored).extensions?.urge, undefined)
  assert.equal(storyStateForPrompt(restored).extensions?.custom, 'keep')
})
test('dense real turns shorten cadence, split messages merge, silence decays', () => {
  let state = fresh()
  for (let i = 0; i < 6; i++) state = urgeUserEvent(state, now - (5 - i) * 2 * minute)
  state = urgeUserEvent(state, now + 1000)
  assert.equal(state.buckets.length, 6)
  assert.equal(urgeDensity(state, now, c), 1)
  assert.equal(urgeDensity(state, now + 90 * minute, c), .5)  // 半衰期 90min
  assert.ok(planUrge(state, now, c, 0, false, () => .5).minutes < planUrge(state, now + 90 * minute, c, 0, false, () => .5).minutes)
})
test('only a basis quote present in the committed script hands Urge over; value no longer gates anything', () => {
  // 缺失/虚构 quote：不提交新 entry，且不能让旧的 slow 相位苟延（重置 normal）。
  const slow = commitUrge(fresh(), { pace: 'slow', suggestedDelayMinutes: 90, basisQuote: quote }, quote, 9, 'alice', now, c)
  assert.equal(slow.pace, 'slow')
  const reset = commitUrge(slow, { pace: 'slow', suggestedDelayMinutes: 90, basisQuote: '根本不存在的话' }, '别的剧本', 10, 'alice', now, c)
  assert.equal(reset.pace, 'normal')
  assert.equal(reset.suggested, undefined)
  assert.equal(reset.sourceEntryId, 9, '无效 quote 不得记录新 entry')
  // §9：无 value 要求——只要 basisQuote 在剧本中即提交（value 字段出现与否都不参与）。
  const noValue = commitUrge(fresh(), { basisQuote: quote }, `结尾：${quote}`, 11, undefined, now, c)
  assert.equal(noValue.sourceEntryId, 11)
  const staleValue = commitUrge(fresh(), { value: NaN, basisQuote: quote }, quote, 12, 'alice', now, c)
  assert.equal(staleValue.sourceEntryId, 12)
})
test('delivery no longer changes scheduling state: acknowledgeUrge/urgeBurstActive are retired', () => {
  // §9：送达确认（acknowledgeUrge/urgeBurstActive 导出）已删除——调度状态
  // 只由 plan/commit 决定，"burst begins at matching delivery" 语义整体退役。
  assert.equal('acknowledgeUrge' in urgeModule, false)
  assert.equal('urgeBurstActive' in urgeModule, false)
  const committed = arm()
  for (const key of ['armed', 'burst', 'spent', 'value']) assert.ok(!(key in committed), `${key} 应随 §9 退役`)
  const planned = planUrge(committed, now, c)
  for (const key of ['armed', 'burst', 'spent']) assert.ok(!(key in planned.state))
})
test('normal cadence keeps the multiplicative model indefinitely: no burst budget, no self-rearming', () => {
  let state = arm(), t = now
  const waits: number[] = []
  for (let i = 0; i < 4; i++) {
    const plan = planUrge(state, t, c, 0, false, () => .5)
    waits.push(plan.minutes); t = Date.parse(plan.nextAdvanceAt)
    state = commitUrge(plan.state, handoff, quote, 10 + i, 'alice', t, c)
  }
  // 空 buckets → 密度 0 → 恒定基础间隔（medium idle [35,55]，random .5 → 45）。
  // 旧的 burst 递增等待（5/10/20…）与预算耗尽路径已随 §9 删除。
  assert.deepEqual(waits, [45, 45, 45, 45])
  for (const key of ['armed', 'burst', 'spent', 'value']) assert.ok(!(key in state))
  assert.equal(state.sourceEntryId, 13, '提交链持续记录最新 entry')
})
test('low Urge stops acceleration without inventing density', () => {
  const idle = planUrge(fresh(), now, c, 0, false, () => .5)
  assert.equal(urgeDensity(fresh(), now, c), 0)
  assert.equal(idle.minutes, 45, '密度 0 → 不加速')
  let dense = fresh()
  for (let i = 0; i < 6; i++) dense = urgeUserEvent(dense, now - (5 - i) * 2 * minute)
  const hot = planUrge(dense, now, c, 0, false, () => .5)
  assert.ok(hot.minutes < idle.minutes)
  assert.ok(Math.abs(hot.minutes - 45 / (1 + 1 * (c.activeMultiplier - 1))) < 1e-9, '密度满值只走 activeMultiplier 乘法')
  // 提交不发明密度：buckets 只由真实入站事件（urgeUserEvent）产生。
  const committed = commitUrge(fresh(), handoff, quote, 9, 'alice', now, c)
  assert.deepEqual(committed.buckets, [])
})
test('multiplicative model: density and five-tier rhythm multiply; no burst acceleration path exists', () => {
  const rnd = () => .5
  let dense = fresh()
  for (let i = 0; i < 6; i++) dense = urgeUserEvent(dense, now - (5 - i) * 2 * minute)
  const base = planUrge(fresh(), now, c, 0, false, rnd).minutes
  // 密度×盯手机 = 最密推进；沉默×睡眠 = 最稀。
  const phone = planUrge(dense, now, c, 0, false, rnd, { attention: 'phone-focused' })
  const asleep = planUrge(fresh(), now, c, 0, false, rnd, { attention: 'asleep' })
  assert.ok(phone.minutes < base && base < asleep.minutes, `phone=${phone.minutes} base=${base} asleep=${asleep.minutes}`)
  assert.ok(Math.abs(phone.minutes - 45 / ((1 + (c.activeMultiplier - 1)) * 1.4)) < 1e-9)
  assert.ok(Math.abs(asleep.minutes - 45 / .15) < 1e-9)
  assert.equal(phone.reason, 'rhythm:phone-focused')
  // 节奏过期/缺失走兜底：rest 窗口内 restMultiplier，窗口外 1.0。
  assert.equal(planUrge(fresh(), now, c, 1, false, rnd, { attention: 'phone-focused', stale: true }).reason, 'rest-window-fallback')
  assert.equal(planUrge(fresh(), now, c, 1, false, rnd).minutes, 45 / c.restMultiplier)
  assert.equal(planUrge(fresh(), now, c, 0, false, rnd).reason, 'conversation-density-decay')
  // §9：调度原因枚举只剩这四种——不再有任何 burst 路径。
  for (const reason of [phone.reason, asleep.reason, 'script-slow', 'rest-window-fallback', 'conversation-density-decay']) assert.ok(!reason.includes('burst'))
})
test('slow keeps its absolute interval, rest only scales the normal branch, real input clears slow', () => {
  const slow = commitUrge(fresh(), { pace: 'slow', suggestedDelayMinutes: 120, basisQuote: quote }, quote, 10, 'alice', now, c)
  assert.equal(planUrge(slow, now, c, 0, false, () => .5).minutes, 120)
  // 乘法模型:restMinutes 不再替换 slow 的绝对间隔,只影响正常分支的密度因子
  assert.equal(planUrge(slow, now, c, 1, false, () => .5).minutes, 120)
  // §9：armed 加速退役——设备不可用只在正常分支把节奏因子减半。
  const plain = planUrge(fresh(), now, c, 0, false, () => .5).minutes
  assert.equal(planUrge(fresh(), now, c, 0, true, () => .5).minutes, plain * 2)
  // 真实入站清掉 slow。
  assert.equal(urgeUserEvent(slow, now).pace, 'normal')
})
test('legacy persisted armed/burst/spent/value are cleaned at load; the sampled deadline stays stored', () => {
  // §9：旧持久化联系状态在 normalizeUrgeState 读出时一次性清理。
  const legacy = {
    version: 1, pace: 'slow', suggested: 60, buckets: [now - minute], rhythmAttention: 'occupied',
    armed: { participantId: 'alice', entryId: 9 }, burst: { started: now, used: 2 }, spent: true, value: .9,
  }
  const cleaned = normalizeUrgeState(legacy, now + 120 * minute)
  for (const key of ['armed', 'burst', 'spent', 'value']) assert.ok(!(key in cleaned), `${key} 应在加载归一时被清理`)
  assert.deepEqual(cleaned.buckets, [now - minute], '真实对话密度桶保留')
  assert.equal(cleaned.pace, 'slow')
  assert.equal(cleaned.suggested, 60)
  assert.equal(cleaned.rhythmAttention, 'occupied')
  // 已采样的 deadline 存在 automation 上，urge 状态重载归一不影响它。
  const plan = planUrge(cleaned, now, c)
  const stored = JSON.parse(JSON.stringify({ urge: plan.state, nextAdvanceAt: plan.nextAdvanceAt }))
  const reloaded = normalizeUrgeState(stored.urge, now + 5 * minute)
  assert.equal(stored.nextAdvanceAt, plan.nextAdvanceAt)
  for (const key of ['armed', 'burst', 'spent', 'value']) assert.ok(!(key in reloaded))
})
test('Urge handoff exists only on automatic main narration and does not request independent speech', () => {
  assert.equal(urgeInstruction(true, 'user-message'), '')
  assert.equal(urgeInstruction(false, 'advance'), '')
  assert.match(urgeInstruction(true, 'intent-due'), /full script/)
})
test('urge handoff wording is scheduling-only: no proactiveContact/value teaching', () => {
  // §9 新文案：交接只有 pace/suggestedDelayMinutes/rhythmAttention/basisQuote，
  // 明言不是联系决策（outbound contact 属于 CONTACT ACTIONS 契约）。
  const text = urgeInstruction(true, 'advance')
  assert.match(text, /pace:"normal"\|"slow"/)
  assert.match(text, /suggestedDelayMinutes/)
  assert.match(text, /rhythmAttention/)
  assert.match(text, /basisQuote/)
  assert.match(text, /not speech, a future event, or a contact decision/)
  assert.match(text, /outbound contact belongs to the CONTACT ACTIONS contract/)
  assert.ok(!text.includes('proactiveContact'))
  assert.ok(!text.includes('value'))
})

function host(enabled = true) {
  const service: any = Object.create(InterludeService.prototype)
  let story: any = { id: 's', setting: { timezone: 'Asia/Shanghai' }, cursorAt: new Date(now), state: decodeStoryState({ automation: { conversationFollowUpAt: [new Date(now).toISOString()] } }) }
  service.config = { urge: { enabled }, runtime: { autoAdvanceEnabled: true, autoAdvanceIntervalMinutes: 40, autoAdvanceJitterMinutes: 0, restWindows: [], proactiveWillingnessThreshold: .65 }, schedulePreplan: { enabled: false } }
  service.getStory = async () => story
  service.dbSet = async (_table: string, _query: unknown, update: any) => { story = { ...story, ...update } }
  service.reportOperation = () => {}
  return { service, story: () => story }
}
test('real service scheduling replaces fixed followups, persists one deadline and passes runtime through unchanged', async () => {
  const h = host()
  await h.service.pauseAutomaticAdvanceAfterUserMessage('s', new Date(now))
  assert.deepEqual(h.story().state.automation.conversationFollowUpAt, [])
  const before = h.story().state.automation.nextAdvanceAt
  h.service.isAutomaticAdvanceDue(h.story(), new Date(now + minute))
  assert.equal(h.story().state.automation.nextAdvanceAt, before)
  // §9：Urge 不再携带意愿门槛——effectiveUrgeRuntime 原样透传 runtime，
  // 开关 Urge 都不再注入/覆盖阈值（旧的 0.4 共享语义退役）。
  assert.equal(h.service.effectiveUrgeRuntime.proactiveWillingnessThreshold, .65)
  h.service.config.urge.enabled = false
  assert.equal(h.service.effectiveUrgeRuntime.proactiveWillingnessThreshold, .65)
  await h.service.scheduleNextAutomaticAdvance('s', new Date(now))
  assert.equal(h.story().state.automation.nextAdvanceAt, new Date(now + 40 * minute).toISOString())
})
test('delayed reply anchors Urge at actual/planned endpoint without adding density', async () => {
  const h = host()
  await h.service.pauseAutomaticAdvanceAfterDelayedReply('s', new Date(now + 15 * minute), 'alice')
  assert.equal(normalizeUrgeState(h.story().state.extensions.urge, now + 15 * minute).buckets.length, 0)
  assert.ok(Date.parse(h.story().state.automation.nextAdvanceAt) > now + 15 * minute)
})
test('disabled Urge preserves old followup scheduling', async () => {
  const h = host(false)
  await h.service.scheduleConversationFollowUpsAfterTurn('s', new Date(now), undefined, 'alice')
  assert.equal(h.story().state.automation.conversationFollowUpAt.length, 2)
  assert.equal(h.story().state.extensions?.urge, undefined)
})

test('service first-bubble receipt no longer changes scheduling; summaries still wait for all bubbles', async () => {
  const h = host()
  h.story().state.extensions = { urge: arm() }
  h.story().state.automation.nextAdvanceAt = new Date(now + 10 * minute).toISOString()
  const deadline = h.story().state.automation.nextAdvanceAt
  h.service.dbGet = async () => [{ metadata: { deliveryActions: [{ participantId: 'alice', eventKind: 'outgoing-message', status: 'partial' }] } }]
  h.service.reportStandalone = () => assert.fail('unexpected projection error')
  await h.service.recordAutomaticDelivery('s', 'alice', { sourceEntryId: 9, summary: 'contact' }, new Date(now))
  // §9：送达不再改变调度状态——不写 burst、不改 deadline（acknowledgeUrge 退役）。
  assert.equal(h.story().state.extensions.urge.burst, undefined)
  assert.equal(h.story().state.automation.nextAdvanceAt, deadline)
  assert.equal(h.story().state.automaticDeliverySummaries?.length ?? 0, 0, 'partial 投递仍等全部气泡送达才记摘要')
  // 全部气泡送达后：只记摘要，调度状态依旧不动。
  h.service.dbGet = async () => [{ metadata: { deliveryActions: [{ participantId: 'alice', eventKind: 'outgoing-message', status: 'delivered' }] } }]
  await h.service.recordAutomaticDelivery('s', 'alice', { sourceEntryId: 9, summary: 'contact' }, new Date(now + minute))
  assert.equal(h.story().state.automaticDeliverySummaries.length, 1)
  assert.equal(h.story().state.automaticDeliverySummaries[0].summary, 'contact')
  assert.equal(h.story().state.automation.nextAdvanceAt, deadline, '送达永不重写 deadline')
  for (const key of ['armed', 'burst', 'spent', 'value']) assert.ok(!(key in h.story().state.extensions.urge))
})

test('service slow excludes soft Preplan and due planning never overwrites unrelated state', async () => {
  const h = host()
  const slow = commitUrge(fresh(), { pace: 'slow', suggestedDelayMinutes: 120, basisQuote: quote }, quote, 9, undefined, now, c)
  h.story().state.extensions = { urge: slow, untouched: { x: 1 } }
  h.story().state.automation.timelineRetryAt = new Date(now + 2 * minute).toISOString()
  h.service.schedulePreplanAnchoredTime = () => assert.fail('soft Preplan must not shorten slow')
  await h.service.scheduleNextAutomaticAdvance('s', new Date(now))
  assert.ok(Date.parse(h.story().state.automation.nextAdvanceAt) >= now + 110 * minute)
  assert.deepEqual(h.story().state.extensions.untouched, { x: 1 })
  assert.equal(h.story().state.automation.timelineRetryAt, new Date(now + 2 * minute).toISOString())
})

test('Console schema has opt-in defaults, §9 field set validates, retired fields are gone', () => {
  const schema = (Config as any).dict.urge
  const config = schema({})
  assert.equal(config.enabled, false)
  assert.equal(config.frequency, 'medium')
  // §9：resolveUrgeConfig 不再有 willingness；新乘法因子默认值就位。
  assert.equal((resolveUrgeConfig(config) as any).willingness, undefined)
  assert.deepEqual(resolveUrgeConfig(config).idle, [35, 55])
  assert.deepEqual(resolveUrgeConfig(config).slow, [110, 130])
  assert.equal(resolveUrgeConfig(config).halfLife, 90)
  assert.equal(resolveUrgeConfig(config).activeMultiplier, 1.4)
  assert.equal(resolveUrgeConfig(config).restMultiplier, .6)
  // 高级区间校验：现存字段越界即抛错（旧的 burstBudget 用例随字段删除）。
  assert.throws(() => schema({ advanced: { halfLifeMinutes: 3 } }))
  assert.throws(() => schema({ advanced: { activeMultiplier: 5 } }))
  // UrgeAdvanced 只剩七个字段；urge 节不再有 proactiveWillingnessThreshold。
  assert.deepEqual(Object.keys(schema.dict.advanced.dict), ['idleMin', 'idleMax', 'slowMin', 'slowMax', 'halfLifeMinutes', 'activeMultiplier', 'restMultiplier'])
  for (const key of ['hotMin', 'hotMax', 'burstMin', 'burstMax', 'burstThreshold', 'jitter', 'extremeChance', 'burstTtlMinutes', 'burstBudget', 'burstContactMinMinutes']) {
    assert.ok(!(key in schema.dict.advanced.dict), `${key} 应随 §9 从 Schema 删除`)
  }
  assert.ok(!('proactiveWillingnessThreshold' in schema.dict))
  // runtime 阈值字段仍在但已隐藏并标注弃用（兼容解析一个迁移周期）。
  const runtimeThreshold = (Config as any).dict.runtime.dict.proactiveWillingnessThreshold
  assert.equal(runtimeThreshold.meta.hidden, true)
  assert.match(runtimeThreshold.meta.description, /已弃用/)
  // 乱序区间照旧被钳回 lo。
  assert.deepEqual(resolveUrgeConfig({ advanced: { idleMin: 30, idleMax: 2 } }).idle, [30, 30])
})
