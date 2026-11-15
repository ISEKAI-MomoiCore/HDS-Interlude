import assert from 'node:assert/strict'
import test from 'node:test'
import { systemPrompt, writingAffordances } from '../src/narrator'
import { LIVED_WRITING_PROMPT } from '../src/script/lived-writing'

test('alphatest embeds the 0.1.5 writing guidance while keeping v2 contracts', () => {
  for (const phase of ['user-message', 'advance', 'conversation-follow-up', 'intent-due', 'agency-check'] as const) {
    const prompt = systemPrompt(phase, '', '', '', '', '')
    assert.ok(prompt.startsWith(LIVED_WRITING_PROMPT))
    assert.equal(prompt.split(LIVED_WRITING_PROMPT).length, 2)
    assert.match(prompt, /A user message is one event entering that life/)
    assert.match(prompt, /Length follows what actually happens/)
    assert.match(prompt, /FORMAT AND REALITY CONTRACT/)
    assert.match(prompt, /interval.nowLocal/)
    assert.match(prompt, /Never invent an incoming message/)
  }
})

test('writing experiment retains owner additions and optional feature contracts', () => {
  const prompt = systemPrompt('user-message', 'OWNER_MAIN', 'OWNER_FORMAT', 'OWNER_FIXED', 'OWNER_STYLE', 'STORY_STYLE', true, true, true)
  for (const marker of ['OWNER_MAIN', 'OWNER_FORMAT', 'OWNER_FIXED', 'OWNER_STYLE', 'STORY_STYLE', 'POST-COMMIT CONTINUITY REFRESH', 'integer field named alter']) assert.ok(prompt.includes(marker), marker)
  assert.match(systemPrompt('advance', '', '', '', '', '', false, false, true), /agencyWindow/)
  assert.match(writingAffordances({ splitReplyMessages: false }), /Message splitting is disabled/)
  assert.match(writingAffordances({ messageSeparator: '<pause/>' }), /<pause\/>/)
})
