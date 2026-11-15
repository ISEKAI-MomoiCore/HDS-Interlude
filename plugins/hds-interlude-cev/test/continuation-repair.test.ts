import assert from 'node:assert/strict'
import test from 'node:test'
import { continuationBookmark, proseReuseObservation } from '../src/script/continuation'
import { decisionToScriptCommit, findPrivateOutgoingMessageEvent } from '../src/script/commit-builder'
import { validateScriptCommit } from '../src/script/validator'
import { toPromptPayload, systemPrompt, storyStateForPrompt } from '../src/narrator'
import { emptyStorySetting, emptyStoryState, ScriptEntry } from '../src/types'
import { decodeStoryState, encodeStoryState } from '../src/story-state'
import { Config } from '../src/index'

const from = new Date('2026-09-05T06:30:00Z')
const now = new Date('2026-09-05T06:40:00Z')
const row = (id: number, kind: ScriptEntry['kind'], content: string, at = from): ScriptEntry => ({
  id, kind, content, actor: kind === 'user-message' ? 'user' : kind === 'script' ? 'narrator' : 'character',
  storyId: 's', participantId: 'alice', occurredAt: at, createdAt: at, metadata: {},
})
const request = (recentEntries: ScriptEntry[], phase = 'conversation-follow-up'): any => ({
  phase, from, now, participant: null, participants: [],
  story: { setting: emptyStorySetting(), state: emptyStoryState() }, recentEntries,
  dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [],
})

for (const [content, separator, split, expected] of [
  ['在吗<sep/>', '<sep/>', true, ['在吗']],
  ['<sep/>在吗', '<sep/>', true, ['在吗']],
  [' <sep/> 在吗 <sep/> ', '<sep/>', true, ['在吗']],
  ['在吗||想好了吗||', '||', true, ['在吗', '想好了吗']],
  ['在吗<sep/>', '<sep/>', false, ['在吗<sep/>']],
  [' 在吗 ', '<sep/>', true, [' 在吗 ']],
] as const) {
  test(`bubble reconstruction keeps transport binding: ${JSON.stringify(content)} split=${split}`, () => {
    const commit = decisionToScriptCommit({ storyId: 's', participantId: 'alice', phase: 'conversation-follow-up', from, now,
      frameId: 'f', burstId: 'b', messageSeparator: separator, splitReplyMessages: split,
      decision: { script: `她又惦记起那件事，发出“${content}”。`, interaction: { seen: false, reply: { mode: 'immediate', content } } },
    })
    assert.deepEqual(validateScriptCommit(commit, separator), { valid: true, errors: [] })
    assert.deepEqual(findPrivateOutgoingMessageEvent(commit, 'alice', 'immediate', content, separator)?.bubbles, expected)
    assert.equal(commit.prose, `她又惦记起那件事，发出“${content}”。`)
  })
}

test('bookmark resolves original text, includes already delivered reply, excludes current incoming event', () => {
  const entries = [row(1, 'user-message', '我想想'), row(2, 'script', '她决定等他想好。'),
    row(3, 'character-message', '想好叫我', new Date(from.getTime() + 1000)),
    row(4, 'user-message', '想好了', now)]
  const bookmark = continuationBookmark(entries, from, now)
  assert.equal(bookmark.lastScript?.entryId, 2)
  assert.deepEqual(bookmark.recentCommunications.map(item => item.entryId), [1, 3])
  assert.doesNotMatch(JSON.stringify(bookmark), /我想想|想好叫我|unanswered/)
  assert.equal(continuationBookmark([], from, now).lastScript, undefined)
})

test('both payload orders retain clock evidence, open contact, source text and current event separately', () => {
  const entries = [row(1, 'script', '她还等着对方决定，但先把书合上。'), row(2, 'character-message', '想好了吗')]
  const r = request(entries)
  r.timelinePlan = { beats: [{ at: 1, kind: 'state', summary: '她仍在书店等候' }], carry: ['等对方决定'] }
  r.timelineCarry = ['约定仍未解决']
  r.activeConsequences = [{ id: 7, participantId: 'alice', summary: '惦记未决的约定', notBefore: from, payload: { effect: '仍关心结果', strength: 0.5 } }]
  r.upcomingIntents = [{ id: 8, type: 'follow-up-commitment', participantId: 'alice', summary: '稍后告诉对方结果', notBefore: now }]
  for (const cacheFirst of [false, true]) {
    const p = toPromptPayload(r, { cacheFirst })
    assert.equal(p.authoringWindow.continuation.lastScript.entryId, 1)
    assert.deepEqual(p.incomingEvent.event, { type: 'none' })
    assert.deepEqual(p.availableNearFuture.timelinePlan, r.timelinePlan)
    assert.deepEqual(p.availableNearFuture.timelineCarry, r.timelineCarry)
    assert.equal(p.ongoingThreads.activeConsequences[0].id, 7)
    assert.equal(p.availableNearFuture.upcomingPlans[0].id, 8)
    assert.deepEqual(p.relevantEstablishedEpisodes.recentScript.map((item: any) => item.content), entries.map(item => item.content))
  }
})

test('40 mixed fixture turns move the bookmark without turning silence into user input or rewriting originals', () => {
  const entries: ScriptEntry[] = [row(1, 'script', '她在书店等他决定。')]
  let clock = from
  for (let i = 0; i < 40; i++) {
    const next = new Date(clock.getTime() + 60_000)
    const live = i % 3 === 0
    if (live) entries.push(row(entries.length + 1, 'user-message', i === 39 ? '想好了' : '我再想想', next))
    const before = JSON.stringify(entries)
    const r = { ...request(entries, live ? 'user-message' : 'conversation-follow-up'), from: clock, now: next, userMessage: live ? entries.at(-1)!.content : undefined }
    const expected = entries.filter(entry => entry.kind === 'script').at(-1)!
    const p = toPromptPayload(r, { cacheFirst: i % 2 === 0 })
    assert.equal(p.authoringWindow.continuation.lastScript.entryId, expected.id)
    assert.equal(p.incomingEvent.event.type, live ? 'private-message-batch' : 'none')
    assert.equal(JSON.stringify(entries), before)
    const prose = i === 39 ? '收到他的决定，她把约定落实下来。' : `她翻过第${i + 1}页，仍然惦记那件事。`
    entries.push(row(entries.length + 1, 'script', prose, next))
    clock = next
  }
})

test('literal reuse observation never suppresses a new contact or modifies prose', () => {
  assert.equal(proseReuseObservation('在吗', '在吗'), 0)
  const prose = '她放下书，看向手机，又记起那件尚未决定的小事。'.repeat(8)
  assert.equal(proseReuseObservation(prose, prose), 1)
  const commit = decisionToScriptCommit({ storyId: 's', participantId: 'alice', phase: 'conversation-follow-up', from, now,
    frameId: 'f', burstId: 'b', decision: { script: prose, interaction: { seen: false, reply: { mode: 'immediate', content: '在吗' } } },
  })
  assert.equal(validateScriptCommit(commit).valid, true)
  assert.equal(commit.prose, prose)
  assert.ok(findPrivateOutgoingMessageEvent(commit, 'alice', 'immediate', '在吗'))
})

test('positive continuation contract explicitly preserves renewed contact', () => {
  const prompt = systemPrompt('conversation-follow-up', '', '', '', '', '')
  assert.match(prompt, /CONTINUATION BOOKMARK/)
  assert.match(prompt, /renewed question is a new action/)
  assert.match(prompt, /not a requirement to stay silent/)
})

test('retired rhythm state round-trips for rollback but never enters narrative context', () => {
  const state = decodeStoryState({ chatRhythm: { recent: [], updatedAt: now.toISOString(), exhausted: true } })
  assert.deepEqual(decodeStoryState(encodeStoryState(state)).chatRhythm, state.chatRhythm)
  assert.equal((storyStateForPrompt(state) as any).chatRhythm, undefined)
  assert.equal(Config.dict.chatRhythm.meta.hidden, true)
})
