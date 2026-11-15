import assert from 'node:assert/strict'
import test from 'node:test'
import { extractEarlyNarrativeReply, systemPrompt } from '../src/narrator'
import { InterludeService } from '../src/service'

test('stream parser emits only a complete private interaction before the script arrives', () => {
  const partial = '{"interaction":{"seen":true,"reply":{"mode":"immediate","content":"收到啦"}},"script":"'
  assert.deepEqual(extractEarlyNarrativeReply(partial, false), {
    kind: 'private', content: '收到啦', interaction: { seen: true, reply: { mode: 'immediate', content: '收到啦' } },
  })
  assert.equal(extractEarlyNarrativeReply('{"interaction":{"seen":true,"reply":{"mode":"immediate","content":"未结束', false), undefined)
})

test('stream parser supports a complete groupReply field without requiring the later script', () => {
  const partial = '{"groupReply":{"mode":"immediate","content":"群里见","replyTo":"msg-7"},"script":"'
  assert.deepEqual(extractEarlyNarrativeReply(partial, true), {
    kind: 'group', content: '群里见', groupReply: { mode: 'immediate', content: '群里见', replyTo: 'msg-7' },
  })
})

test('fixed contract asks for transport before script when experimental streaming is enabled', () => {
  const prompt = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, true, true)
  assert.match(prompt, /put interaction first and script after it/i)
  assert.match(prompt, /streaming protocol/)
  const ordinary = systemPrompt('advance', '', '', '', '', '')
  assert.match(ordinary, /script first/)
})

test('typing delay applies bounded ±30 percent variation and can be made deterministic', () => {
  const method = (InterludeService.prototype as any).typingDelayMilliseconds
  const original = Math.random
  try {
    Math.random = () => 0
    assert.equal(method.call({ config: { runtime: { typingBaseDelaySeconds: 1, typingCharactersPerSecond: 8, typingMaxDelaySeconds: 12, typingJitterRatio: 0.3 } } }, '12345678'), 1_400)
    Math.random = () => 1
    assert.equal(method.call({ config: { runtime: { typingBaseDelaySeconds: 1, typingCharactersPerSecond: 8, typingMaxDelaySeconds: 12, typingJitterRatio: 0.3 } } }, '12345678'), 2_600)
    assert.equal(method.call({ config: { runtime: { typingBaseDelaySeconds: 1, typingCharactersPerSecond: 8, typingMaxDelaySeconds: 12, typingJitterRatio: 0 } } }, '12345678'), 2_000)
  } finally {
    Math.random = original
  }
})
