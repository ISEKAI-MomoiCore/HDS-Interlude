/* issue #3 回归：私聊→群聊的"回声"内容闸（normalizeDecision 层）。
 * 模型把 interaction.reply 的内容逐字照搬为群目标 crossConversationActions 时，
 * 该 action 被丢弃并留痕（droppedProactiveActions），不再投递到群聊。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDecision, type RuntimeConfig, type SharedStoryConfig } from '../src/service'
import type { NarrativeDecision } from '../src/types'

const now = new Date('2026-10-14T10:00:00Z')
const from = new Date('2026-10-14T09:00:00Z')
const runtime = {
  captureDirectMessages: true, autoCreate: true, ignoreCommandMessages: true, allowProactiveMessages: true,
  sweepIntervalMinutes: 3, minimumAdvanceMinutes: 40, maxStoriesPerSweep: 25, contextEntryLimit: 40,
  memoryLimit: 30, maxScriptCharacters: 5000, maxMessageCharacters: 2000,
  minimumDelayedReplySeconds: 3, maximumDelayedReplyMinutes: 240, cancelDelayedRepliesOnUserMessage: true,
} as RuntimeConfig
const shared = {
  autoEnrollParticipants: true, allowCrossConversationMessages: true, shareParticipantDetails: true,
  maxCrossConversationActions: 3, participantContextLimit: 6, managerAccounts: [],
} as SharedStoryConfig

function decide(raw: Partial<NarrativeDecision>) {
  return normalizeDecision(
    raw as NarrativeDecision, from, now, true, runtime, shared,
    'alice', new Set(['alice']), new Set(['123']), 'user-message',
  )
}

test('群目标 cross-action 内容与私聊回复完全一致 → 丢弃', () => {
  const d = decide({
    script: '她回复了消息，然后在群里也说了同样的话。',
    interaction: { seen: true, reply: { mode: 'immediate', content: '今晚一起去吃火锅吧' } },
    crossConversationActions: [
      { participantId: 'group:123', mode: 'immediate', content: '今晚一起去吃火锅吧' },
    ],
  })
  assert.equal(d.crossConversationActions.length, 0, '完全一致的群发应被丢弃')
  assert.ok(d.droppedProactiveActions?.some(a => a.reason === 'group-echo-of-private-reply'))
})

test('群目标 cross-action 内容是私聊回复的子串 → 丢弃(包含关系)', () => {
  const d = decide({
    script: '她私聊里说了很长一段，然后在群里简短复述。',
    interaction: { seen: true, reply: { mode: 'immediate', content: '今晚一起去吃火锅吧，我记得你说过喜欢麻辣的' } },
    crossConversationActions: [
      { participantId: 'group:123', mode: 'immediate', content: '今晚一起去吃火锅吧' },
    ],
  })
  assert.equal(d.crossConversationActions.length, 0, '子串也应被丢弃')
})

test('群目标 cross-action 内容与私聊回复无关 → 保留', () => {
  const d = decide({
    script: '她在私聊回复了一件事，然后在群里说了另一件事。',
    interaction: { seen: true, reply: { mode: 'immediate', content: '今晚一起去吃火锅吧' } },
    crossConversationActions: [
      { participantId: 'group:123', mode: 'immediate', content: '明天上午的课改到下午了' },
    ],
  })
  assert.equal(d.crossConversationActions.length, 1, '无关内容正常保留')
})

test('私聊目标(非群)的 cross-action 不受闸门影响(即使内容相同)', () => {
  const d = normalizeDecision({
    script: '她给两个人都发了同样的消息。',
    interaction: { seen: true, reply: { mode: 'immediate', content: '今晚一起去吃火锅吧' } },
    crossConversationActions: [
      { participantId: 'bob', mode: 'immediate', content: '今晚一起去吃火锅吧' },
    ],
  } as never, from, now, true, runtime, shared, 'alice', new Set(['alice', 'bob']), new Set(['123']), 'user-message')
  assert.equal(d.crossConversationActions.length, 1, '私聊→私聊不涉及隐私泄漏')
})

test('无 interaction.reply 时(如 advance)闸门不生效', () => {
  const raw = decide({
    script: '她在群里主动发了一条消息。',
    crossConversationActions: [
      { participantId: 'group:123', mode: 'immediate', content: '大家好' },
    ],
  })
  assert.equal(raw.crossConversationActions.length, 1, '无 reply 可比较时不过滤')
})
