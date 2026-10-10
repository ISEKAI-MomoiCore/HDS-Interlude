import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adjustAlterWeight, advanceAlterSystem, calculateAlterThreshold, completeAlterAnalysis,
  alterHistoryForScope, alterScopeValue, createAlterSystemState, emotionalOffsetForPrompt,
  normalizeAlterSystemState, normalizeAlterValue,
} from '../src/alter'
import { AlterHistoryEntry, AlterSystemConfig } from '../src/types'

const config: AlterSystemConfig = {
  enabled: true,
  baseThreshold: 10,
  densityFactor: 0.3,
  sameDirectionBoost: 0.05,
  oppositeDecay: 0.15,
  minWeight: 0.2,
  maxIntensity: 2,
}

test('model Alter values are bounded integers and invalid values are ignored', () => {
  assert.equal(normalizeAlterValue(3.4), 3)
  assert.equal(normalizeAlterValue(20), 5)
  assert.equal(normalizeAlterValue(-20), -5)
  assert.equal(normalizeAlterValue(Number.NaN), undefined)
  assert.equal(normalizeAlterValue('3'), undefined)
})

test('dynamic threshold moves gradually from ten to seven under dense narration', () => {
  const now = new Date('2026-08-22T12:00:00.000Z')
  const entry = (turn: number): AlterHistoryEntry => ({
    turn,
    phase: 'user-message',
    alter: 1,
    alterValue: turn,
    timestamp: new Date(now.getTime() - turn * 1_000).toISOString(),
  })
  assert.equal(calculateAlterThreshold([], config, now), 10)
  assert.equal(calculateAlterThreshold(Array.from({ length: 5 }, (_, index) => entry(index + 1)), config, now), 8.5)
  assert.equal(calculateAlterThreshold(Array.from({ length: 20 }, (_, index) => entry(index + 1)), config, now), 7)
})

test('same-direction movement strengthens while opposite movement decays', () => {
  assert.equal(adjustAlterWeight(0.6, true, 2, config), 0.7)
  assert.ok(Math.abs(adjustAlterWeight(0.6, false, 2, config) - 0.3) < 1e-9)
  assert.equal(adjustAlterWeight(0.95, true, 5, config), 1)
  assert.equal(adjustAlterWeight(0.2, false, 5, config), 0)
})

test('a trigger is completed only after a valid side-model description', () => {
  const now = new Date('2026-08-22T12:00:00.000Z')
  const state = createAlterSystemState(now)
  state.alterValue = 8
  const turn = advanceAlterSystem(state, 3, 'user-message', now, config)
  assert.equal(turn.thresholdReached, true)
  assert.equal(turn.state.alterValue, 11)

  const completed = completeAlterAnalysis(turn.state, '氛围开始转向更谨慎、私密的交流。', turn.threshold, now, config)
  assert.equal(completed.alterValue, 0)
  assert.equal(completed.alterWeight, 1)
  assert.equal(completed.lastTriggerDirection, 1)
  assert.equal(completed.emotionalOffset?.direction, 'serious')
  assert.ok((completed.emotionalOffset?.intensity ?? 0) >= 1)
})

test('legacy persisted Alter state is normalized without exposing duplicate weight', () => {
  const normalized = normalizeAlterSystemState({
    alterValue: -4,
    alterWeight: 0.75,
    lastTriggerAlter: -12,
    emotionalOffset: {
      direction: 'relaxed', description: '较轻松', intensity: 1.2,
      generatedAt: 1787400000000, weight: 0.1,
    },
    history: [],
    lastUpdatedAt: 1787400000000,
  })
  assert.equal(normalized?.lastTriggerDirection, -1)
  assert.equal(normalized?.alterWeight, 0.75)
  const prompt = emotionalOffsetForPrompt(normalized, config)
  assert.equal(prompt?.weight, 0.75)
  assert.equal('weight' in (normalized?.emotionalOffset ?? {}), false)
})

test('Alter keeps relationship-local accumulation and analysis evidence in the same source bucket', () => {
  const now = new Date('2026-09-06T12:00:00.000Z')
  let state = createAlterSystemState(now)
  const aliceFirst = advanceAlterSystem(state, 6, 'user-message', now, config, 'alice')
  state = aliceFirst.state
  const bobFirst = advanceAlterSystem(state, 6, 'user-message', new Date(now.getTime() + 1_000), config, 'bob')
  state = bobFirst.state

  // Story-level diagnostics still see twelve points, but neither private
  // relationship may borrow the other's evidence to trigger an analysis.
  assert.equal(state.alterValue, 12)
  assert.equal(aliceFirst.thresholdReached, false)
  assert.equal(bobFirst.thresholdReached, false)
  assert.equal(alterScopeValue(state, 'alice'), 6)
  assert.equal(alterScopeValue(state, 'bob'), 6)

  const aliceTrigger = advanceAlterSystem(state, 4, 'conversation-follow-up', new Date(now.getTime() + 2_000), config, 'alice')
  assert.equal(aliceTrigger.thresholdReached, true)
  assert.equal(aliceTrigger.sourceParticipantId, 'alice')
  assert.equal(aliceTrigger.triggerValue, 10)
  assert.equal(alterHistoryForScope(aliceTrigger.state.history, 'alice').length, 2)
  assert.equal(alterHistoryForScope(aliceTrigger.state.history, 'bob').length, 1)

  const completed = completeAlterAnalysis(aliceTrigger.state, '她在这段关系里变得更谨慎。', aliceTrigger.threshold, now, config, 'alice')
  assert.equal(alterScopeValue(completed, 'alice'), 0)
  assert.equal(alterScopeValue(completed, 'bob'), 6)
  assert.equal(completed.alterValue, 6)
})


test('Alter does not lose the 33rd active source during normalization', () => {
  const now = new Date('2026-10-08T04:00:00Z')
  let state = createAlterSystemState(now)
  for (let i = 0; i < 40; i++) state = advanceAlterSystem(state, 1, 'user-message', now, config, 'p' + i).state
  const normalized = normalizeAlterSystemState(state)!
  assert.equal(normalized.pendingScopes!.length, 40)
  assert.equal(normalized.alterValue, 40)
  for (let i = 0; i < 40; i++) assert.equal(alterScopeValue(normalized, 'p' + i), 1)
})

test('idle Alter scopes cannot evict a new participant or the protagonist life source', () => {
  const now = new Date('2026-10-08T04:00:00Z')
  const original = createAlterSystemState(now)
  original.pendingScopes = Array.from({ length: 32 }, (_, i) => ({ participantId: 'idle-' + i, alterValue: 0 }))
  const next = advanceAlterSystem(original, 5, 'user-message', now, config, 'new-participant').state
  const life = advanceAlterSystem(next, -4, 'advance', now, config).state
  const normalized = normalizeAlterSystemState(life)!
  assert.equal(alterScopeValue(normalized, 'new-participant'), 5)
  assert.equal(alterScopeValue(normalized), -4)
  assert.equal(normalized.alterValue, 1)
})
