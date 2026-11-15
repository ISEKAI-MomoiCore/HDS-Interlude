import assert from 'node:assert/strict'
import test from 'node:test'
import { decisionToScriptCommit } from '../src/script/commit-builder'
import { validateScriptCommit } from '../src/script/validator'

/** 审计回归 P1-7：模型给出空白 delayed content 时丢弃该消息事件，
 * 而不是让空 bubbles 校验拒绝整个 commit（整回合失败）。 */
test('whitespace-only delayed reply drops its message event instead of failing the commit', () => {
  const commit = decisionToScriptCommit({
    storyId: 's', participantId: 'p1', phase: 'user-message',
    from: new Date('2026-09-26T10:00:00Z'), now: new Date('2026-09-26T10:00:30Z'),
    decision: {
      script: '她想着晚点再回。',
      interaction: { seen: true, reply: { mode: 'delayed', content: '   ', sendAt: '2026-09-26T11:00:00Z' } },
    } as any,
    frameId: 'f1', burstId: 'b1',
  })
  const validation = validateScriptCommit(commit)
  assert.equal(validation.valid, true, validation.errors.join('; '))
  assert.ok(!commit.events.some(event => event.kind === 'outgoing-message'), 'no message event for blank content')
  assert.ok(commit.events.some(event => event.kind === 'narrative'), 'prose still commits')
})

test('normal delayed reply still produces its message event', () => {
  const commit = decisionToScriptCommit({
    storyId: 's', participantId: 'p1', phase: 'user-message',
    from: new Date('2026-09-26T10:00:00Z'), now: new Date('2026-09-26T10:00:30Z'),
    decision: {
      script: '她想着晚点再回。',
      interaction: { seen: true, reply: { mode: 'delayed', content: '到家跟你说', sendAt: '2026-09-26T11:00:00Z' } },
    } as any,
    frameId: 'f1', burstId: 'b1',
  })
  assert.ok(commit.events.some(event => event.kind === 'outgoing-message'))
  assert.equal(validateScriptCommit(commit).valid, true)
})
