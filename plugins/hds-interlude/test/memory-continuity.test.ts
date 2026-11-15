import assert from 'node:assert/strict'
import test from 'node:test'
import { systemPrompt, toPromptPayload } from '../src/narrator'
import { InterludeService } from '../src/service'
import { emptyStorySetting, emptyStoryState, InterludeStory, NarrativeFact, NarrativeIntent, NarrativeRequest, ScriptEntry } from '../src/types'

const now = new Date('2026-08-30T11:22:00.000Z')

function story(): InterludeStory {
  return {
    id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
    setting: emptyStorySetting(),
    state: {
      ...emptyStoryState(),
      continuitySnapshot: { current: '在房间', next: ['下楼取已经拿到的奶茶'], recent: ['奶茶已经喝完'], salient: [] },
      lastContinuityUpdateAt: '2026-08-30T11:21:00.000Z',
    },
    cursorAt: now, createdAt: now, updatedAt: now,
  }
}

function entry(id: number, kind: string, content: string, occurredAt: Date): ScriptEntry {
  return { id, storyId: 'story', participantId: 'participant', kind, actor: kind === 'script' ? 'narrator' : 'character', content, occurredAt, metadata: {}, createdAt: occurredAt }
}

test('legacy free-text continuity next is hidden and host-owned upcoming plans remain visible', () => {
  const upcoming: NarrativeIntent = {
    id: 7, storyId: 'story', participantId: 'participant', type: 'follow-up-commitment', summary: '下周完成体检',
    notBefore: new Date('2026-09-02T00:00:00.000Z'), status: 'pending', payload: {}, createdAt: now, updatedAt: now,
  }
  const request: NarrativeRequest = {
    phase: 'user-message', story: story(), from: now, now, userMessage: '然后呢', participant: null,
    participants: [], shareParticipantDetails: false, dueIntents: [], upcomingIntents: [upcoming],
    activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [],
  }
  const payload = toPromptPayload(request) as any
  assert.deepEqual(payload.relevantEstablishedEpisodes.continuitySnapshot.next, [])
  assert.equal(payload.ongoingThreads.state.continuitySnapshot, undefined)
  assert.equal(payload.availableNearFuture.upcomingPlans[0].summary, '下周完成体检')
  const refresh = systemPrompt('user-message', '', '', '', '', '', true)
  assert.match(refresh, /Do not copy or create free-text future plans/)
  assert.doesNotMatch(refresh, /"next":\[/)
})

test('raw messages inside the time window survive a large prose entry and the normal character budget', () => {
  const request: NarrativeRequest = {
    phase: 'user-message', story: story(), from: now, now, participant: null, participants: [], shareParticipantDetails: false,
    dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentProtectionSince: new Date(now.getTime() - 60 * 60_000),
    recentEntries: [
      entry(1, 'character-message', '拿到了。', new Date(now.getTime() - 50 * 60_000)),
      entry(2, 'script', '长'.repeat(20_000), new Date(now.getTime() - 1_000)),
    ],
  }
  const payload = toPromptPayload(request) as any
  assert.ok(payload.relevantEstablishedEpisodes.recentScript.some((item: any) => item.content === '拿到了。'))
  assert.equal(payload.relevantEstablishedEpisodes.recentScript.find((item: any) => item.id === 2).content, request.recentEntries[1].content)
})

function fact(id: number, scope: NarrativeFact['scope'], unresolved: boolean, content: string): NarrativeFact {
  return {
    id, storyId: 'story', participantId: '', scope, content, importance: 0.8, confidence: 1,
    unresolved, embedding: [], status: 'active', sourceEntryIds: [], lastSeenAt: now, createdAt: now, updatedAt: now,
  }
}

test('fact retrieval reserves lanes for recently resolved events and open promises', async () => {
  const resolved = fact(100, 'event', false, '奶茶已经取回并喝完')
  const promise = fact(101, 'promise', true, '下周完成体检')
  const crowded = Array.from({ length: 30 }, (_, index) => fact(index + 1, 'event', true, `旧的未完成事件 ${index}`))
  const service = {
    memoryConfig: { factLimit: 20, maxFactsPerStory: 200, factImportanceWeight: 0.5, factConfidenceWeight: 0.35, factRecencyWeight: 0.15, semanticWeight: 0.55, unresolvedWeight: 0.2 },
    config: { model: { embedding: { liveQuery: false } } },
    dbGet: async (_table: string, query: any) => query.scope === 'event' && query.unresolved === false
      ? [resolved]
      : query.scope === 'promise' ? [promise] : crowded,
  }
  const selected = await (InterludeService.prototype as any).facts.call(service, 'story', 20, '', undefined) as NarrativeFact[]
  assert.ok(selected.some(item => item.id === resolved.id))
  assert.ok(selected.some(item => item.id === promise.id))
})

test('participant-specific legacy facts remain global narrative evidence', async () => {
  const factAboutOtherParticipant = fact(201, 'relationship', false, '小林说他准备出门')
  factAboutOtherParticipant.participantId = 'legacy-private-id'
  const service = {
    memoryConfig: { factLimit: 10, maxFactsPerStory: 100, factImportanceWeight: 0.5, factConfidenceWeight: 0.35, factRecencyWeight: 0.15, semanticWeight: 0.55, unresolvedWeight: 0.2 },
    config: { model: { embedding: { liveQuery: false } } },
    dbGet: async (_table: string, query: any) => query.scope === 'event' && query.unresolved === false
      ? []
      : query.scope === 'promise' ? [] : [factAboutOtherParticipant],
  }
  const selected = await (InterludeService.prototype as any).facts.call(service, 'story', 10, '', 'current-participant') as NarrativeFact[]
  assert.deepEqual(selected.map(item => item.id), [factAboutOtherParticipant.id])
})

test('narrator facts expose content but not the legacy participant id', () => {
  const request: NarrativeRequest = {
    phase: 'user-message', story: story(), from: now, now, userMessage: '你好', participant: null,
    participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [],
    recentEntries: [], memories: [], facts: [fact(202, 'relationship', false, '小林说他准备出门')],
  }
  ;(request.facts![0] as any).participantId = 'legacy-private-id'
  const payload = toPromptPayload(request) as any
  const durableFacts = payload.relevantEstablishedEpisodes.durableFacts
  assert.equal(durableFacts[0].participantId, undefined)
  assert.equal(durableFacts[0].content, '小林说他准备出门')
})

test('ambiguous relationship facts are not persisted as standalone facts', async () => {
  const service = {
    memoryConfig: { factContentCharacters: 4_000, maxFactsPerStory: 200 },
    dbGet: async () => { throw new Error('ambiguous fact should be rejected before reading existing rows') },
  }
  const rejected = await (InterludeService.prototype as any).persistFact.call(service, 'story', {
    scope: 'relationship', content: '他说他准备出门', sourceEntryIds: [],
  }, [], now)
  assert.equal(rejected, false)
})

test('fact retrieval scans a broad bounded pool and lets literal old evidence outrank generic rows', async () => {
  const target = { ...fact(999, 'event', false, '星期二男孩是 13 号，不是 27 号'), importance: 0.1 }
  const crowded = Array.from({ length: 220 }, (_, index) => fact(index + 1, 'event', true, `普通高重要度事件 ${index}`))
  let generalLimit = 0
  const service = {
    memoryConfig: { factLimit: 5, maxFactsPerStory: 100, factImportanceWeight: 0.5, factConfidenceWeight: 0.35, factRecencyWeight: 0.15, semanticWeight: 0.55, unresolvedWeight: 0.2 },
    config: { model: { embedding: { liveQuery: false } } },
    dbGet: async (_table: string, query: any, options: any) => {
      if (query.scope) return []
      generalLimit = options.limit
      return [...crowded, target]
    },
  }
  const selected = await (InterludeService.prototype as any).facts.call(service, 'story', 5, '星期二男孩 13 号', undefined) as NarrativeFact[]
  assert.ok(generalLimit >= 300)
  assert.equal(selected[0].id, target.id)
})

test('an explicit resolved fact can close the old unresolved row', async () => {
  const existing = fact(12, 'promise', true, '奶茶配送事项')
  let patch: any
  const service = {
    memoryConfig: { factContentCharacters: 4_000, maxFactsPerStory: 200 },
    dbGet: async () => [existing],
    dbSet: async (_table: string, _query: any, value: any) => { patch = value },
    embedText: async () => [],
  }
  const source = entry(1, 'script', '奶茶已经取回', now)
  existing.participantId = source.participantId
  const resolved = await (InterludeService.prototype as any).persistFact.call(service, 'story', {
    scope: 'promise', content: '奶茶配送事项', unresolved: false, sourceEntryIds: [1],
    knowledge: { mode: 'observed', clauses: [{ role: 'observation', sourceEntryId: 1, quote: '奶茶已经取回' }] },
  }, [source], now)
  assert.equal(resolved, true)
  assert.equal(patch.unresolved, false)
})

test('legacy continuity dirty state does not restart an independent real-time summary', () => {
  const current = story()
  current.state.continuityDirty = true
  current.state.narrativeUpdateCount = 3
  assert.equal((InterludeService.prototype as any).shouldRefreshContinuity.call({}, current, 'user-message'), false)
})
