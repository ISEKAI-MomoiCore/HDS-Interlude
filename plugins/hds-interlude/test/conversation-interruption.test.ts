import assert from 'node:assert/strict'
import test from 'node:test'
import { toPromptPayload } from '../src/narrator'
import { shouldSupersedeNarrativeRequest } from '../src/service'
import { emptyStorySetting, emptyStoryState, InterludeStory, NarrativeIntent, NarrativeRequest } from '../src/types'

test('an in-flight request stays replaceable until its first reply is committed', () => {
  assert.equal(shouldSupersedeNarrativeRequest(7, undefined, new Set()), true)
  assert.equal(shouldSupersedeNarrativeRequest(7, 7, new Set()), false)
  assert.equal(shouldSupersedeNarrativeRequest(7, undefined, new Set([7])), false)
  assert.equal(shouldSupersedeNarrativeRequest(undefined, undefined, new Set()), false)
})

test('cancelled split segments become interrupted typing context, not delivered dialogue', () => {
  const now = new Date('2026-08-23T08:00:00.000Z')
  const setting = emptyStorySetting()
  setting.timezone = 'Asia/Shanghai'
  const story: InterludeStory = {
    id: 'story', platform: 'onebot', selfId: 'bot', userId: 'global', channelId: 'private:global',
    status: 'active', setting, state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now,
  }
  const intent = (id: number, type: string, content: string): NarrativeIntent => ({
    id, storyId: story.id, participantId: 'participant', type,
    summary: 'pending output', notBefore: now, status: 'cancelled', payload: { content },
    createdAt: now, updatedAt: now,
  })
  const request: NarrativeRequest = {
    phase: 'user-message', story, from: now, now, userMessage: '你在干嘛？', participant: null,
    participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [],
    supersededIntents: [intent(1, 'split-message', '我刚才其实想说'), intent(2, 'delayed-reply', '晚点回复')],
    recentEntries: [], memories: [],
  }
  const payload = toPromptPayload(request)
  assert.equal(payload.ongoingThreads.interruptedOutgoingDrafts.length, 1)
  assert.equal(payload.ongoingThreads.interruptedOutgoingDrafts[0].content, '我刚才其实想说')
  assert.match(payload.ongoingThreads.interruptedOutgoingDrafts[0].narrativeContext, /还没打完字，用户的新消息就发来了/)
  assert.equal(payload.ongoingThreads.supersededDelayedReplies.length, 1)
  assert.equal(payload.ongoingThreads.supersededDelayedReplies[0].payload.content, '晚点回复')
})
