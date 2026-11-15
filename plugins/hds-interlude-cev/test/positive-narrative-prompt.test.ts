import assert from 'node:assert/strict'
import test from 'node:test'
import { systemPrompt } from '../src/narrator'

test('live writing is guided by event density instead of elapsed-time length quotas', () => {
  const prompt = systemPrompt('user-message', '', '', '', '', '')
  // alphatest 旧版嵌入：核心写作指导为 0.1.5-beta3 逐字文本，篇幅断言跟随等价语义。
  assert.match(prompt, /Write this as a living stage script in prose/)
  assert.match(prompt, /Length follows what actually happens/)
  assert.match(prompt, /a quiet interval has its own occupation, pace and texture/)
  assert.doesNotMatch(prompt, /may consist mainly of dialogue|interval can pass lightly/)
  assert.doesNotMatch(prompt, /400-700 characters/)
})

test('the visible reply remains an event inside one causal script', () => {
  const prompt = systemPrompt('user-message', '', '', '', '', '')
  assert.match(prompt, /next passage AFTER the last completed original/)
  assert.doesNotMatch(prompt, /say id=/)
  assert.match(prompt, /same causal passage/)
})

test('continuity evolves positively without forced novelty templates', () => {
  const prompt = systemPrompt('user-message', '', '', '', '', '')
  // 旧版嵌入下以英文等价语义断言：开放结尾、动机可以不完整。
  assert.match(prompt, /inner motives and relationships/)
  assert.doesNotMatch(prompt, /fresh piece of writing/)
  assert.doesNotMatch(prompt, /putting the phone away/)
})

test('dense dialogue continues from changed beats without a fixed reply ceremony', () => {
  const prompt = systemPrompt('user-message', '', '', '', '', '')
  assert.match(prompt, /first change not yet written/)
  assert.match(prompt, /need not be restated, but remain present wherever they touch her attention or mood/)
  assert.doesNotMatch(prompt, /Keep a consideration, draft, or typing moment/)
  assert.doesNotMatch(prompt, /First write the life that has unfolded/)
})

test('M5 exposes only the transport channel available to the current phase', () => {
  const privateTurn = systemPrompt('user-message', '', '', '', '', '')
  const groupTurn = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, true)
  const advance = systemPrompt('advance', '', '', '', '', '')
  assert.match(privateTurn, /For this private turn, interaction describes ONLY messages to the current private participant/)
  assert.doesNotMatch(privateTurn, /return groupReply as/)
  assert.match(groupTurn, /return groupReply as/)
  assert.doesNotMatch(groupTurn, /For this private turn, interaction describes ONLY messages to the current private participant/)
  assert.match(groupTurn, /actually posts to the group/)
  assert.doesNotMatch(groupTurn, /actually sends a private reply/)
  assert.doesNotMatch(advance, /For this private turn, interaction describes ONLY messages to the current private participant/)
})
