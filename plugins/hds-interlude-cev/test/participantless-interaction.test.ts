import assert from 'node:assert/strict'
import test from 'node:test'
import { hoistParticipantlessInteraction } from '../src/service'
import { decisionToScriptCommit } from '../src/script/commit-builder'
import { validateScriptCommit } from '../src/script/validator'

test('a group turn hoists an immediate interaction reply into groupReply', () => {
  const decision = hoistParticipantlessInteraction({
    script: '她在群里回了一句。',
    interaction: { seen: true, reply: { mode: 'immediate', content: '在的在的' } },
  } as any, 'user-message')
  assert.equal(decision.groupReply?.mode, 'immediate')
  assert.equal(decision.groupReply?.content, '在的在的')
  assert.equal(decision.interaction, undefined)
})

test('an existing structured groupReply wins over the interaction fallback', () => {
  const decision = hoistParticipantlessInteraction({
    script: 's',
    groupReply: { mode: 'immediate', content: '群回复' },
    interaction: { seen: true, reply: { mode: 'immediate', content: '私聊形态' } },
  } as any, 'user-message')
  assert.equal(decision.groupReply?.content, '群回复')
  assert.equal(decision.interaction, undefined)
})

test('delayed or advance-phase interaction replies are stripped, not hoisted', () => {
  const delayed = hoistParticipantlessInteraction({
    script: 's',
    interaction: { seen: true, reply: { mode: 'delayed', content: '晚点说', sendAt: '2026-09-24T12:00:00.000Z' } },
  } as any, 'user-message')
  assert.equal(delayed.interaction, undefined)
  assert.equal(delayed.groupReply, undefined)
  const advance = hoistParticipantlessInteraction({
    script: 's',
    interaction: { seen: true, reply: { mode: 'immediate', content: '不该有' } },
  } as any, 'advance')
  assert.equal(advance.interaction, undefined)
  assert.equal(advance.groupReply, undefined)
})

test('a participantless group commit with interaction-only reply passes structural validation', () => {
  // 复现线上形态：群聊回合（无 participant），模型只返回 interaction。
  const commit = decisionToScriptCommit({
    storyId: 's', participantId: undefined, phase: 'user-message',
    from: new Date('2026-09-24T10:00:00Z'), now: new Date('2026-09-24T10:00:30Z'),
    decision: hoistParticipantlessInteraction({
      script: '她慢吞吞地敲下回复。',
      interaction: { seen: true, reply: { mode: 'immediate', content: '在的' } },
    } as any, 'user-message') as any,
    groupReplyContent: '在的',
    frameId: 'f1', burstId: 'b1',
  })
  const validation = validateScriptCommit(commit)
  assert.equal(validation.valid, true, validation.errors.join('; '))
  assert.ok(commit.events.some(event => event.kind === 'group-message'), 'hoisted reply lands as a group-message event')
  assert.ok(!commit.events.some(event => event.kind === 'outgoing-message'), 'no participantless outgoing-message event is created')
})
