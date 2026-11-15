import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeGroupWillingness, evaluateGroupWillingness } from '../src/group-willingness'

const config = {
  enabled: true, maxScore: 1, threshold: 0.24, probabilityAmplifier: 1.3,
  decayHalfLifeSeconds: 180, replyCost: 0.55, baseGain: 0.12,
  quoteGain: 0.12, keywordGain: 0.18, keywords: ['水濑'],
}

test('group willingness accumulates locally, respects threshold, and uses a bounded probability', () => {
  const first = evaluateGroupWillingness(undefined, config, {
    now: 0, messageCount: 1, content: '大家晚上好', mentionedBot: false, quotedBot: false, random: 0,
  })
  assert.equal(first.shouldCall, false)
  assert.equal(first.reason, 'below-threshold')

  const second = evaluateGroupWillingness(first.state, config, {
    now: 1_000, messageCount: 2, content: '水濑你怎么看', mentionedBot: false, quotedBot: false, random: 0,
  })
  assert.equal(second.reason, 'probability-roll')
  assert.ok(second.probability > 0 && second.probability <= 1)
  assert.equal(second.shouldCall, true)
})

test('mentions bypass group willingness while a sent group reply consumes score', () => {
  const forced = evaluateGroupWillingness(undefined, config, {
    now: 0, messageCount: 1, content: '在吗', mentionedBot: true, quotedBot: false, random: 0.99,
  })
  assert.equal(forced.shouldCall, true)
  assert.equal(forced.reason, 'forced-mention')
  const afterReply = consumeGroupWillingness(forced.state, config, 1_000)
  assert.ok(afterReply.score < forced.state.score)
})

test('disabled group willingness preserves the existing always-trigger behavior', () => {
  const decision = evaluateGroupWillingness(undefined, { enabled: false }, {
    now: 0, messageCount: 1, content: '普通消息', mentionedBot: false, quotedBot: false,
  })
  assert.equal(decision.shouldCall, true)
  assert.equal(decision.reason, 'disabled')
})
