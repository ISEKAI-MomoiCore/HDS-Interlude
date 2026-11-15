import assert from 'node:assert/strict'
import test from 'node:test'
import { acknowledgeUrge, commitUrge, normalizeUrgeState, planUrge, resolveUrgeConfig, urgeBurstActive, urgeDensity, urgeInstruction, urgeUserEvent } from '../src/urge'
import { decodeStoryState, encodeStoryState } from '../src/story-state'
import { storyStateForPrompt } from '../src/narrator'
import { InterludeService } from '../src/service'
import { Config } from '../src/index'

const now = Date.parse('2026-09-07T04:00:00Z'), minute = 60_000
const c = resolveUrgeConfig({ enabled: true, advanced: { jitter: 0, extremeChance: 0 } })
const fresh = () => normalizeUrgeState({}, now)
const high = { value: .9, pace: 'normal', basisQuote: '她想再问一句。' }
const arm = () => commitUrge(fresh(), high, high.basisQuote, 9, 'alice', now, c, () => .5)

test('Urge legacy JSON including empty/partial state always reads defensively', () => {
  for (const raw of [null, {}, [], 'bad', { version: 1 }, { version: 1, buckets: {}, armed: [], burst: { started: 'bad' } }, { version: 99, buckets: [now] }]) {
    const state = normalizeUrgeState(raw, now)
    assert.ok(Array.isArray(state.buckets))
    assert.ok(Number.isFinite(Date.parse(planUrge(state, now, c).nextAdvanceAt)))
  }
})
test('Urge round trips through existing story JSON without schema migration or leaking into prompts', () => {
  const state = decodeStoryState({ extensions: { urge: arm(), custom: 'keep' } })
  const restored = decodeStoryState(JSON.parse(JSON.stringify(encodeStoryState(state))))
  assert.equal(normalizeUrgeState(restored.extensions?.urge, now).armed?.entryId, 9)
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
test('only committed quoted script can supply Urge, never a missing/imagined quote', () => {
  assert.equal(commitUrge(fresh(), high, '别的剧本', 9, 'alice', now, c).armed, undefined)
  assert.equal(commitUrge(fresh(), { ...high, value: NaN }, high.basisQuote, 9, 'alice', now, c).armed, undefined)
  assert.equal(arm().armed?.participantId, 'alice')
  assert.equal(commitUrge(fresh(), high, high.basisQuote, 9, undefined, now, c).armed, undefined)
})
test('burst begins only at matching actual delivery, duplicate/other receipts do not restart it', () => {
  const state = arm()
  assert.equal(state.burst, undefined)
  assert.equal(acknowledgeUrge(state, 'bob', 9, now), state)
  assert.equal(acknowledgeUrge(state, 'alice', 10, now), state)
  const active = acknowledgeUrge(state, 'alice', 9, now)
  assert.equal(active.burst?.started, now)
  assert.equal(acknowledgeUrge(active, 'alice', 9, now + minute), active)
  assert.equal(urgeBurstActive(active, now, c, 'bob'), false)
})
test('burst cadence backs off and exhausts budget without self-rearming', () => {
  let state = acknowledgeUrge(arm(), 'alice', 9, now), t = now
  const waits: number[] = []
  for (let i = 0; i < 3; i++) {
    const plan = planUrge(state, t, c, 0, false, () => .5)
    waits.push(plan.minutes); t = Date.parse(plan.nextAdvanceAt)
    state = commitUrge(plan.state, high, high.basisQuote, 10 + i, 'alice', t, c, () => .5)
  }
  assert.deepEqual(waits, [5, 10, 20])
  const final = planUrge(state, t, c, 0, false, () => .5)
  assert.equal(final.state.burst, undefined)
  assert.equal(commitUrge(final.state, high, high.basisQuote, 20, 'alice', t, c).armed, undefined)
  assert.equal(urgeUserEvent(final.state, t).spent, false)
})
test('low Urge stops acceleration without inventing density', () => {
  const active = acknowledgeUrge(arm(), 'alice', 9, now)
  const low = commitUrge(active, { ...high, value: .1 }, high.basisQuote, 10, 'alice', now, c)
  assert.equal(low.burst, undefined)
  assert.deepEqual(low.buckets, [])
  assert.equal(low.spent, true)
})
test('slow/rest/device constraints win over high urge, real input clears slow', () => {
  const slow = commitUrge(fresh(), { ...high, pace: 'slow', suggestedDelayMinutes: 120 }, high.basisQuote, 10, 'alice', now, c)
  assert.equal(planUrge(slow, now, c, 0, false, () => .5).minutes, 120)
  // 乘法模型:restMinutes 不再替换 slow 的绝对间隔,只影响正常分支的密度因子
  assert.equal(planUrge(slow, now, c, 1, false, () => .5).minutes, 120)
  const active = acknowledgeUrge(arm(), 'alice', 9, now)
  assert.equal(planUrge(active, now, c, 0, true).state.burst, undefined)
  assert.equal(urgeUserEvent(slow, now).pace, 'normal')
})
test('restart expires stale armed/burst state and keeps the already sampled deadline', () => {
  const state = acknowledgeUrge(arm(), 'alice', 9, now)
  const plan = planUrge(state, now, c)
  const stored = JSON.parse(JSON.stringify({ urge: plan.state, nextAdvanceAt: plan.nextAdvanceAt }))
  assert.equal(stored.nextAdvanceAt, plan.nextAdvanceAt)
  assert.equal(urgeBurstActive(normalizeUrgeState(stored.urge, now + 120 * minute), now + 120 * minute, c), false)
  assert.equal(normalizeUrgeState(arm(), now + 11 * minute).armed, undefined)
})
test('Urge handoff exists only on automatic main narration and does not request independent speech', () => {
  assert.equal(urgeInstruction(true, 'user-message'), '')
  assert.equal(urgeInstruction(false, 'advance'), '')
  assert.match(urgeInstruction(true, 'intent-due'), /full script/)
})
test('Console schema has opt-in defaults and advanced ranges validate', () => {
  const schema = (Config as any).dict.urge
  const config = schema({})
  assert.equal(config.enabled, false)
  assert.equal(config.frequency, 'medium')
  assert.equal(resolveUrgeConfig(config).willingness, .4)
  assert.throws(() => schema({ advanced: { burstBudget: 99 } }))
  assert.deepEqual(resolveUrgeConfig({ advanced: { hotMin: 30, hotMax: 2 } }).hot, [30, 30])
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
test('real service scheduling replaces fixed followups, persists one deadline and shares willingness threshold', async () => {
  const h = host()
  await h.service.pauseAutomaticAdvanceAfterUserMessage('s', new Date(now))
  assert.deepEqual(h.story().state.automation.conversationFollowUpAt, [])
  const before = h.story().state.automation.nextAdvanceAt
  h.service.isAutomaticAdvanceDue(h.story(), new Date(now + minute))
  assert.equal(h.story().state.automation.nextAdvanceAt, before)
  assert.equal(h.service.effectiveUrgeRuntime.proactiveWillingnessThreshold, .4)
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

test('service first-bubble receipt activates Urge but still waits to summarize all bubbles', async () => {
  const h = host()
  h.story().state.extensions = { urge: arm() }
  h.service.dbGet = async () => [{ metadata: { deliveryActions: [{ participantId: 'alice', eventKind: 'outgoing-message', status: 'partial' }] } }]
  h.service.reportStandalone = () => assert.fail('unexpected projection error')
  await h.service.recordAutomaticDelivery('s', 'alice', { sourceEntryId: 9, summary: 'contact' }, new Date(now))
  assert.equal(h.story().state.extensions.urge.burst.participantId, 'alice')
  assert.equal(h.story().state.extensions.urge.burst.used, 1)
  assert.equal(h.story().state.automaticDeliverySummaries?.length ?? 0, 0)
  const deadline = h.story().state.automation.nextAdvanceAt
  await h.service.recordAutomaticDelivery('s', 'alice', { sourceEntryId: 9, summary: 'contact' }, new Date(now + minute))
  assert.equal(h.story().state.automation.nextAdvanceAt, deadline)
})

test('service slow excludes soft Preplan and due planning never overwrites unrelated state', async () => {
  const h = host()
  const slow = commitUrge(fresh(), { ...high, pace: 'slow', suggestedDelayMinutes: 120 }, high.basisQuote, 9, undefined, now, c)
  h.story().state.extensions = { urge: slow, untouched: { x: 1 } }
  h.story().state.automation.timelineRetryAt = new Date(now + 2 * minute).toISOString()
  h.service.schedulePreplanAnchoredTime = () => assert.fail('soft Preplan must not shorten slow')
  await h.service.scheduleNextAutomaticAdvance('s', new Date(now))
  assert.ok(Date.parse(h.story().state.automation.nextAdvanceAt) >= now + 110 * minute)
  assert.deepEqual(h.story().state.extensions.untouched, { x: 1 })
  assert.equal(h.story().state.automation.timelineRetryAt, new Date(now + 2 * minute).toISOString())
})
