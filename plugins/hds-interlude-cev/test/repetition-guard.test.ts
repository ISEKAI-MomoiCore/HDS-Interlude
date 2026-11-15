import assert from 'node:assert/strict'
import test from 'node:test'
import { detectMessageRepetition, repetitionGuardInstruction, systemPrompt, writingAffordances } from '../src/narrator'
import type { ScriptEntry } from '../src/types'

function entry(id: number, kind: ScriptEntry['kind'], metadata: Record<string, unknown> = {}): ScriptEntry {
  return { id, storyId: 's', kind, actor: kind === 'user-message' ? 'user' : 'character', content: `m${id}`,
    occurredAt: new Date(0, 0, 1, 0, 0, id).toISOString(), metadata } as ScriptEntry
}

/** One delivered reply batch: leader carries authoritative delivery metadata. */
function batch(from: number, bubbles: number): ScriptEntry[] {
  return Array.from({ length: bubbles }, (_, index) => entry(from + index, 'character-message', {
    scriptEvent: { commitId: 'c', eventId: 'e', bubbleIndex: index, bubbleCount: bubbles },
  }))
}

const user = (id: number) => entry(id, 'user-message')

test('detectMessageRepetition triggers on a fixed two-bubble run with delivery metadata', () => {
  const entries = [...batch(10, 2), user(12), ...batch(20, 2), user(22)]
  assert.deepEqual(detectMessageRepetition(entries), { bubbles: 2, consecutive: 2 })
})

test('a trailing batch whose later bubbles are still typing counts by its leader metadata', () => {
  const entries = [...batch(10, 2), user(12), batch(20, 2)[0]!]
  assert.deepEqual(detectMessageRepetition(entries), { bubbles: 2, consecutive: 2 })
})

test('contiguous character-message runs without metadata still form batches', () => {
  const entries = [entry(1, 'character-message'), entry(2, 'character-message'), user(3),
    entry(4, 'character-message'), entry(5, 'character-message')]
  assert.deepEqual(detectMessageRepetition(entries), { bubbles: 2, consecutive: 2 })
})

test('a broken run or a single-bubble habit does not trigger the guard', () => {
  assert.equal(detectMessageRepetition([...batch(10, 2), user(12), ...batch(20, 3)]), undefined)
  assert.equal(detectMessageRepetition([...batch(10, 1), user(12), ...batch(20, 1)]), undefined)
  assert.equal(detectMessageRepetition([user(1), ...batch(10, 2)]), undefined)
})

test('narration entries separate batches, so one mixed passage cannot fake a run', () => {
  const entries = [entry(1, 'character-message'), entry(2, 'character-message'), entry(3, 'script'),
    entry(4, 'character-message'), entry(5, 'character-message')]
  assert.deepEqual(detectMessageRepetition(entries), { bubbles: 2, consecutive: 2 })
  const spread = [entry(1, 'character-message'), entry(2, 'character-message'), entry(3, 'script'),
    user(4), entry(5, 'character-message')]
  assert.equal(detectMessageRepetition(spread), undefined)
})

test('repetitionGuardInstruction renders the observed numbers and refuses weak signals', () => {
  assert.match(repetitionGuardInstruction({ bubbles: 2, consecutive: 3 })!, /last 3 outgoing replies arrived as exactly 2 separate chat bubbles/)
  assert.match(repetitionGuardInstruction({ bubbles: 2, consecutive: 3 })!, /do not reproduce the same 2-bubble shape/)
  assert.equal(repetitionGuardInstruction(undefined), '')
  assert.equal(repetitionGuardInstruction({ bubbles: 1, consecutive: 4 }), '')
  assert.equal(repetitionGuardInstruction({ bubbles: 3, consecutive: 1 }), '')
})

test('writingAffordances carries the guard paragraph only when a run was detected', () => {
  const withRun = writingAffordances({ messageSeparator: '<sep/>', splitReplyMessages: true, browserMode: 'deferred-only', messageRepetition: { bubbles: 2, consecutive: 2 } })
  assert.match(withRun, /REPETITION GUARD/)
  const withoutRun = writingAffordances({ messageSeparator: '<sep/>', splitReplyMessages: true, browserMode: 'deferred-only' })
  assert.doesNotMatch(withoutRun, /REPETITION GUARD/)
})

test('both contract tiers surface the guard inside the system prompt when the host reports a run', () => {
  const writingOptions = { messageSeparator: '<sep/>', splitReplyMessages: true, browserMode: 'deferred-only' as const, messageRepetition: { bubbles: 2, consecutive: 2 } }
  const full = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, writingOptions, { tier: 'full', family: 'generic', source: 'auto', probe: '' })
  assert.match(full, /REPETITION GUARD/)
  const lite = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, writingOptions, { tier: 'lite', family: 'gemini-flash', source: 'auto', probe: 'gemini-3-flash' })
  assert.match(lite, /REPETITION GUARD/)
})
