import assert from 'node:assert/strict'
import test from 'node:test'
import { bindImmediateMessageAction, decisionToScriptCommit, findPrivateOutgoingMessageEvent } from '../src/script/commit-builder'
import { Config } from '../src/index'
import { InterludeService } from '../src/service'
import { emptyStorySetting, emptyStoryState, type NarrativeDecision } from '../src/types'

// Issue #15 / #413 现场复刻：正文里“早”共出现 5 次（词内巧合 4 + 引号消息 1），
// 单字分段旧实现被全局唯一性否决，整组主动消息被取消。新实现按候选分级绑定。
const issueProse = '她想起“等这一早呢”的约定，便签上写着“今早它爱喝不喝”。她拿起手机回了“早”，又补一句“昨晚就睡啦”，最后发了个“刚起来”。要早起吗？吃过早饭再说。'
const issueBubbles = ['早', '昨晚就睡啦', '刚起来']

test('issue-15: a single-character bubble binds to its quoted occurrence beside word-internal decoys', () => {
  const binding = bindImmediateMessageAction(issueProse, issueBubbles)
  assert.equal(binding.status, 'bound')
  assert.equal(binding.spans?.length, 3)
  assert.equal(binding.spans![0].start, issueProse.indexOf('“早”') + 1)
  for (const span of binding.spans!) assert.equal(issueProse.slice(span.start, span.end), issueBubbles[span.bubbleIndex])
})

test('issue-15: word-internal occurrences alone never qualify as a send', () => {
  const binding = bindImmediateMessageAction('今早吃过早饭，她考虑要不要早起。', ['早'])
  assert.equal(binding.status, 'unbound')
  assert.deepEqual(binding.failed, { bubbleIndex: 0, bubble: '早', quoted: 0, standalone: 0, occurrences: 3 })
})

test('issue-15: two identical quoted segments stay unbound (recall-twice is not a send)', () => {
  const binding = bindImmediateMessageAction('她想起「消息乙」，又想起「消息乙」。', ['消息乙'])
  assert.equal(binding.status, 'unbound')
  assert.deepEqual(binding.failed, { bubbleIndex: 0, bubble: '消息乙', quoted: 2, standalone: 2, occurrences: 2 })
})

test('issue-15: bubbles must appear in delivery order; a later out-of-order bubble fails with detail', () => {
  const binding = bindImmediateMessageAction('她发出「甲」，随后发出「乙」。', ['乙', '甲'])
  assert.equal(binding.status, 'unbound')
  assert.equal(binding.failed?.bubbleIndex, 1)
  assert.equal(binding.failed?.bubble, '甲')
  assert.equal(binding.failed?.occurrences, 1)
})

test('issue-15: a quoted occurrence outranks an earlier bare standalone one and is flagged ambiguous', () => {
  const prose = '早。她犹豫片刻，终于打出“早”。'
  const binding = bindImmediateMessageAction(prose, ['早'])
  assert.equal(binding.status, 'bound')
  assert.equal(binding.ambiguous, true)
  assert.equal(binding.spans![0].start, prose.indexOf('“早”') + 1)
})

test('issue-15: multi-bubble cross-conversation actions survive the commit adapter', () => {
  const content = issueBubbles.join('<sep/>')
  const commit = decisionToScriptCommit({
    storyId: 's', participantId: 'alice', phase: 'advance',
    from: new Date('2026-10-25T07:40:00Z'), now: new Date('2026-10-25T07:43:00Z'),
    messageSeparator: '<sep/>', splitReplyMessages: true,
    decision: {
      script: issueProse,
      crossConversationActions: [{ participantId: 'alice', mode: 'immediate', content }],
    } as NarrativeDecision,
  })
  const event = findPrivateOutgoingMessageEvent(commit, 'alice', 'immediate', content)
  assert.equal(event?.scriptBinding?.status, 'bound')
  assert.equal(event?.scriptBinding?.spans?.length, 3)
  assert.deepEqual(event?.bubbles, issueBubbles)
})

test('issue-15: the advance gate delivers the short-bubble group and names the failing segment on rejection', async () => {
  const now = new Date('2026-10-25T07:43:00Z')
  const entries: any[] = [], warnings: any[] = []
  const host: any = Object.assign(Object.create(InterludeService.prototype), {
    config: { runtime: { ...Config.dict.runtime({}), allowProactiveMessages: true },
      sharedStory: { maxCrossConversationActions: 8 }, onebot: { groupChats: [] }, agency: {} },
    participants: async () => [{ id: 'alice', state: {}, updatedAt: now }],
    canHandleParticipant: () => true, shouldRefreshContinuity: () => false,
    activeScene: async () => null, pruneWorkingDetails: (value: any) => value ?? [],
    appendEntry: async (_storyId: string, draft: any) => {
      const entry = { ...draft, id: entries.length + 1, storyId: 's', createdAt: now }
      entries.push(entry); return entry
    },
    applyIntentUpdates: async () => 0, updateAlterSystem: () => undefined,
    dbGet: async (_table: string, query: any) => entries.filter(entry => entry.id === query.id),
    dbSet: async (table: string, query: any, patch: any) => {
      if (table === 'interlude_script_entry') Object.assign(entries.find(entry => entry.id === query.id), patch)
    }, longHorizonSweep: async () => {},
    appendIntent: async () => {}, scheduleDueIntentWake: () => {},
    reportOperation: (...args: any[]) => { if (args[1] === 'warn') warnings.push(args) }, reportStandalone: () => {},
    pendingProactiveCount: 0,
    decide: () => assert.fail('The gate must not request model recovery'),
    sendOutgoingMessages: () => assert.fail('Persistence must not send directly'),
  })
  const story: any = { id: 's', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now }
  const decision = (content: string): NarrativeDecision => ({
    script: issueProse,
    crossConversationActions: [{ participantId: 'alice', mode: 'immediate', content, willingness: 0.9 }],
  })

  // 修复前：单字“早”被唯一性否决，整组取消、无投递记录；修复后：正常进入账本。
  const delivered = await host.persistDecision(story, null, decision(issueBubbles.join('<sep/>')), now, now, true, 'advance')
  assert.equal(delivered.messages.length, 1)
  assert.equal(delivered.messages[0].content, '早')
  const deliveredScript = entries.filter(entry => entry.kind === 'script').at(-1)
  assert.equal(deliveredScript?.metadata.deliveryActions.length, 1)
  assert.equal(warnings.length, 0)

  // 缺文本的行动仍被取消，且警告点名具体分段与候选层级。
  const rejected = await host.persistDecision(story, null, decision('这句话不在正文里'), now, now, true, 'advance')
  assert.equal(rejected.messages.length, 0)
  const rejectedScript = entries.filter(entry => entry.kind === 'script').at(-1)
  assert.equal(rejectedScript?.metadata.deliveryActions.length, 0)
  assert.equal(warnings.length, 1)
  assert.match(String(warnings[0][6]), /分段1「这句话不在正文里」引号候选=0 独立候选=0 原文出现=0/)
})
