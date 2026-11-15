import assert from 'node:assert/strict'
import test from 'node:test'
import { systemPrompt, toPromptPayload } from '../src/narrator'
import { emptyStorySetting, emptyStoryState, InterludeStory, NarrativeIntent, NarrativeRequest } from '../src/types'

const now = new Date('2026-08-25T08:00:00.000Z')

function commitment(): NarrativeIntent {
  return {
    id: 7, storyId: 'story', participantId: 'friend', type: 'follow-up-commitment', summary: '答应想清楚后回复耳机选择。',
    notBefore: new Date('2026-08-25T08:30:00.000Z'), status: 'pending',
    payload: { kind: 'thinking', sourceEntryIds: [12], expiresAt: '2026-08-25T20:00:00.000Z', requiresVisibleOutcome: true },
    createdAt: now, updatedAt: now,
  }
}

function request(phase: NarrativeRequest['phase']): NarrativeRequest {
  const story: InterludeStory = {
    id: 'story', platform: 'onebot', selfId: 'bot', userId: 'global', channelId: 'private:global',
    status: 'active', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now,
  }
  return {
    phase, story, from: now, now, participant: null, participants: [], shareParticipantDetails: false,
    dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [],
    followUpCommitments: [commitment()],
  }
}

test('follow-up commitment instructions are limited to live and due turns', () => {
  assert.match(systemPrompt('user-message', '', '', '', '', ''), /followUpCommitment/)
  assert.match(systemPrompt('intent-due', '', '', '', '', ''), /do not silently finish/)
  assert.doesNotMatch(systemPrompt('advance', '', '', '', '', ''), /followUpCommitment/)
})

test('only live and due prompt payloads carry the bounded commitment list', () => {
  const user = toPromptPayload(request('user-message')) as Record<string, any>
  const due = toPromptPayload(request('intent-due')) as Record<string, any>
  const advance = toPromptPayload(request('advance')) as Record<string, any>
  assert.equal(user.ongoingThreads.followUpCommitments[0].id, 7)
  assert.equal(due.ongoingThreads.followUpCommitments[0].summary, '答应想清楚后回复耳机选择。')
  assert.equal(advance.ongoingThreads.followUpCommitments, undefined)
})
