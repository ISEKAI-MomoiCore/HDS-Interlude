import assert from 'node:assert/strict'
import test from 'node:test'
import { toPromptPayload } from '../src/narrator'
import { normalizeScenePresenceDrafts } from '../src/service'
import { emptyStorySetting, emptyStoryState, InterludeStory, NarrativeRequest, ScriptEntry } from '../src/types'

const now = new Date('2026-08-25T08:00:00.000Z')

function entry(id: number, content: string): ScriptEntry {
  return {
    id, storyId: 'story', participantId: '', kind: 'script', actor: 'narrator', content,
    occurredAt: now, metadata: {}, createdAt: now,
  }
}

function request(phase: NarrativeRequest['phase']): NarrativeRequest {
  const state = emptyStoryState()
  state.automaticDeliverySummaries = [{
    participantId: 'friend', summary: '已向对方确认 Gate 的试听结论。', sourceEntryId: 7, deliveredAt: now.toISOString(),
  }]
  const story: InterludeStory = {
    id: 'story', platform: 'onebot', selfId: 'bot', userId: 'global', channelId: 'private:global',
    status: 'active', setting: emptyStorySetting(), state, cursorAt: now, createdAt: now, updatedAt: now,
  }
  return {
    phase, story, from: now, now, participant: null, participants: [], shareParticipantDetails: false,
    dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [],
    automaticDeliverySummaries: state.automaticDeliverySummaries,
  }
}

test('scene presence accepts explicit arrival/departure evidence and rejects inferred departures', () => {
  const departure = normalizeScenePresenceDrafts([{
    name: '希绘', status: 'off-scene', basis: '希绘在电梯口与水濑道别后回家。', sourceEntryIds: [1],
  }], [entry(1, '希绘在电梯口与水濑道别后回家。')], now)
  assert.equal(departure[0]?.status, 'off-scene')

  const inferred = normalizeScenePresenceDrafts([{
    name: '希绘', status: 'off-scene', basis: '希绘似乎该离开了。', sourceEntryIds: [2],
  }], [entry(2, '希绘和水濑一起走进音频馆。')], now)
  assert.deepEqual(inferred, [])
})

test('automatic delivery summaries stay on background turns only', () => {
  const advance = toPromptPayload(request('advance')) as Record<string, any>
  const user = toPromptPayload(request('user-message')) as Record<string, any>
  assert.equal(advance.ongoingThreads.automaticDeliverySummaries.length, 1)
  assert.equal(advance.ongoingThreads.state.automaticDeliverySummaries, undefined)
  assert.equal(user.ongoingThreads.automaticDeliverySummaries, undefined)
  assert.equal(user.ongoingThreads.state.automaticDeliverySummaries, undefined)
})
