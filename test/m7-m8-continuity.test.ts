import assert from 'node:assert/strict'
import test from 'node:test'
import { developmentDimension, developmentScenes } from '../src/script/development'
import { groundedEpisodeTags, episodeExcerpt } from '../src/script/episode-index'
import { needsTimelineDirector } from '../src/script/timeline-routing'
import { InterludeService } from '../src/service'
import { toPromptPayload } from '../src/narrator'
import { emptyStorySetting, emptyStoryState, ScriptEntry } from '../src/types'

const now = new Date('2026-09-05T08:00:00Z')
const source = (id: number, frame = 'one', participantId = ''): ScriptEntry => ({
  id, storyId: 's', participantId, kind: 'script', actor: 'narrator', content: '她答应明天在书店归还书本。',
  occurredAt: new Date(now.getTime() - id * 86_400_000), createdAt: now, metadata: { frameId: frame },
})

test('episode tags remain literal spans, and recalled inner narration never becomes user speech', () => {
  assert.deepEqual(groundedEpisodeTags('明天在书店还书', { places: ['书店'], outcomes: ['已还书'], commitments: ['还书'] }),
    { places: ['书店'], commitments: ['还书'] })
  const excerpt = episodeExcerpt([[1, { content: '她想他或许会来。', kind: 'script', occurredAt: now.toISOString(), participantId: 'a' }]], 1)!
  assert.match(excerpt.content, /protagonist-narrative/)
  assert.deepEqual(excerpt.sourceEntryIds, [1])
})

test('a paused shared story stays reachable so pause can always be resumed', async () => {
  const pausedStory: any = {
    id: 'character:onebot:1', platform: 'onebot', selfId: '1', userId: '', channelId: '',
    status: 'paused', setting: emptyStorySetting(), state: emptyStoryState(),
    cursorAt: now, createdAt: now, updatedAt: now,
  }
  const queries: any[] = []
  const service: any = {
    sharedStoryConfig: { enabled: true },
    getCanonicalStory: (InterludeService.prototype as any).getCanonicalStory,
    getPausedStory: (InterludeService.prototype as any).getPausedStory,
    dbGet: async (_table: string, query: any) => {
      queries.push(query)
      if (query.status === 'paused') return [pausedStory]
      if (query.status === 'active') return []
      return []
    },
    repairCanonicalOneBotStoryTransport: async (story: any) => story,
    migrateLegacyBranchIntoShared: async () => {},
  }
  const found = await (InterludeService.prototype as any).findStory.call(service,
    { platform: 'onebot', selfId: '1', userId: 'u', isDirect: true })
  // 死锁回归：active-only 查询找不到 paused 故事时必须补查，resume 才有目标。
  assert.equal(found?.id, 'character:onebot:1')
  assert.equal(found?.status, 'paused')
  assert.ok(queries.some(query => query.status === 'paused'), '补查了 paused 状态')
})

test('archived stories are never adopted by the paused fallback', async () => {
  const queries: any[] = []
  const service: any = {
    sharedStoryConfig: { enabled: true },
    getCanonicalStory: (InterludeService.prototype as any).getCanonicalStory,
    getPausedStory: (InterludeService.prototype as any).getPausedStory,
    dbGet: async (_table: string, query: any) => {
      queries.push(query)
      return []
    },
    dbGetById: async () => undefined,
    migrateLegacyStory: async () => undefined,
  }
  const found = await (InterludeService.prototype as any).findStory.call(service,
    { platform: 'onebot', selfId: '1', userId: 'u', isDirect: true })
  assert.equal(found, undefined)
  assert.ok(!queries.some(query => query.status === 'archived'), '不查询 archived')
})

test('ten turns in one scene remain one development observation; unknown provenance contributes none', () => {
  assert.equal(developmentScenes(Array.from({ length: 10 }, (_, index) => source(index + 1))), 1)
  assert.equal(developmentScenes([source(1, 'a'), source(2, 'b'), source(3, 'c')]), 3)
  assert.equal(developmentScenes([{ ...source(1), metadata: {} }]), 0)
  assert.equal(developmentDimension('character', 'invented.secret.path'), undefined)
  assert.equal(developmentDimension('relationship', 'relationship.trust'), 'trust')
})

test('short follow-up omits director, but long, cross-day and schedule-transition windows retain it', () => {
  const from = new Date(now.getTime() - 10 * 60_000)
  assert.equal(needsTimelineDirector('conversation-follow-up', from, now, 'Asia/Shanghai'), false)
  assert.equal(needsTimelineDirector('advance', from, now, 'Asia/Shanghai'), true)
  assert.equal(needsTimelineDirector('intent-due', new Date(now.getTime() - 30 * 60_000), now, 'Asia/Shanghai'), true)
  assert.equal(needsTimelineDirector('conversation-follow-up', from, now, 'Asia/Shanghai', {
    blocks: [{ date: '2026-09-05', start: '15:55', end: '16:30' }],
  } as any), true)
  assert.equal(needsTimelineDirector('conversation-follow-up', new Date('2026-09-05T15:59:00Z'), new Date('2026-09-05T16:01:00Z'), 'Asia/Shanghai'), true)
})

test('both prompt orders retain original automatic prose and separate timeline evidence', () => {
  const entry = source(1)
  entry.metadata.timelinePlan = { beats: [{ at: 1, kind: 'state', summary: '仍在书店' }] }
  for (const cacheFirstPayload of [false, true]) {
    const request: any = { phase: 'user-message', from: now, now, participant: null, participants: [],
      story: { setting: emptyStorySetting(), state: emptyStoryState() }, recentEntries: [entry],
      dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], cacheFirstPayload,
      developmentTendencies: [{ target: 'relationship', tendency: '归还借书时更主动确认', sourceEntryIds: [1] }],
    }
    const payload: any = toPromptPayload(request, { cacheFirst: cacheFirstPayload })
    assert.equal(payload.relevantEstablishedEpisodes.recentScript[0].content, entry.content)
    assert.deepEqual(payload.relevantEstablishedEpisodes.recentScript[0].timelineEvidence, entry.metadata.timelinePlan)
    assert.equal(payload.ongoingThreads.developmentTendencies.length, 1)
  }
})

function learningHarness(rows: ScriptEntry[]) {
  const proposals: any[] = []
  const service = {
    memoryConfig: { autoApplyStatePatches: true, allowMajorStateChanges: true, statePatchMinTurns: 3, statePatchMinDays: 2,
      statePatchConfidenceThreshold: 0.8, majorStatePatchConfidenceThreshold: 0.9, statePatchCooldownHours: 72 },
    dbGet: async (table: string, query: any) => table === 'interlude_state_patch' ? proposals : rows.filter(row => query.id.$in.includes(row.id)),
    dbCreate: async (_table: string, value: any) => { const item = { ...value, id: proposals.length + 1 }; proposals.push(item); return item },
    dbSet: async (_table: string, query: any, value: any) => { Object.assign(proposals.find(item => item.id === query.id), value) },
    reportOperation: () => {},
    // persistStatePatch 应用后即重建 overlay;mock 桩无需真实重建,只需存在
    rebuildLiveOverlayState: async () => {},
  }
  const call = (ids: number[], extras = {}) => (InterludeService.prototype as any).persistStatePatch.call(service,
    { id: 's', setting: { timezone: 'Asia/Shanghai' }, state: emptyStoryState() },
    { target: 'character', path: 'preferences', proposedValue: '她遇到困惑时倾向先去书店查证。', evidence: '跨场景观察', confidence: 0.95, sourceEntryIds: ids, ...extras }, rows, now)
  return { proposals, service, call }
}

test('development requires an observation cycle and independent scenes, then counter-evidence retires projection', async () => {
  const h = learningHarness([source(1, 'a'), source(2, 'b'), source(3, 'c'), source(4, 'd')])
  await h.call([1, 2, 3])
  assert.equal(h.proposals[0].status, 'proposed')
  await h.call([1, 2, 3])
  assert.equal(h.proposals[0].status, 'proposed')
  await h.call([4])
  assert.equal(h.proposals[0].status, 'applied')
  h.proposals[0].sourceEntryIds = [1, 2, 3]
  await h.call([4], { contradictsProposalIds: [1], evidence: '同等条件下明确放弃这一选择' })
  assert.equal(h.proposals[0].status, 'rejected')
  assert.ok(h.proposals[0].confidence < 0.8)
})

test('dense same-scene evidence and private evidence cannot promote global personality', async () => {
  const h = learningHarness(Array.from({ length: 10 }, (_, index) => source(index + 1)))
  await h.call([1, 2, 3])
  await h.call([4, 5, 6])
  assert.equal(h.proposals[0].status, 'proposed')
  const privateH = learningHarness([source(1, 'a', 'friend')])
  await privateH.call([1])
  assert.equal(privateH.proposals.length, 0)
})

test('development projection omits unrelated and other-relationship tendencies', async () => {
  const rows = [
    { path: 'development.trust', participantId: 'a', target: 'relationship', proposedValue: '在书店归还书本时更愿意主动确认', sourceEntryIds: [1] },
    { path: 'development.trust', participantId: 'b', target: 'relationship', proposedValue: '书店归还书本的秘密', sourceEntryIds: [2] },
  ]
  const service = { dbGet: async () => rows }
  const read = (query: string) => (InterludeService.prototype as any).developmentForPrompt.call(service, 's', 'a', query)
  assert.equal((await read('书店归还书本')).length, 1)
  assert.deepEqual(await read('天气晴朗'), [])
})

test('failed long-window director degrades to director-less advance instead of freezing', async () => {
  let narrated = false
  const service = { config: {}, schedulePreplanConfig: { enabled: false },
    planAutomaticTimeline: async () => undefined, isTimelineDirectorFused: () => 6,
    reportOperation: () => {}, report: () => {}, mainModelLabel: () => 'mock',
    modelRouting: { main: { available: true } },
    decide: async () => { narrated = true; return { script: '降级后的无账本推进剧本。' } },
  }
  const result = await (InterludeService.prototype as any).tryDecide.call(service,
    { id: 's', setting: { timezone: 'Asia/Shanghai' } }, null, 'advance', new Date(now.getTime() - 86_400_000), now, undefined, [])
  // 熔断只抑制导演调用本身：自动推进必须降级继续，不再丢弃整个回合。
  assert.equal(result.succeeded, true)
  assert.equal(narrated, true)
})

test('resolved working detail removes only the evidence-backed label', async () => {
  const patches: any[] = []
  const state = { ...emptyStoryState(), workingDetails: [
    { label: '归还书本', value: '尚未归还', createdAt: now.toISOString() },
    { label: '取餐', value: '等待取餐', createdAt: now.toISOString() },
  ] }
  const service = { memoryConfig: { arcSummaryCharacters: 1000, sceneSummaryCharacters: 1000, sceneHookCharacters: 100 },
    activeArc: async () => ({ id: 1, title: '测试弧' }), getStory: async () => ({ id: 's', state }),
    dbSet: async (table: string, _query: any, value: any) => { if (table === 'interlude_story') patches.push(value) },
  }
  await (InterludeService.prototype as any).persistCompactionOutputs.call(service, { id: 's' }, { id: 2, entryCount: 0 },
    { scene: { summary: '归还完成' }, arc: { summary: '承诺已履行' }, workingDetails: [
      { label: '归还书本', value: '', resolved: true, sourceEntryIds: [1] },
      { label: '取餐', value: '', resolved: true, sourceEntryIds: [999] },
    ] }, [source(1)], now)
  assert.deepEqual(patches[0].state.workingDetails.map((item: any) => item.label), ['取餐'])
})

test('raw script persistence keeps a long original passage without truncation', async () => {
  const content = '完整原始剧本。'.repeat(3000)
  let saved: any
  const service = { historyVectors: new Map(), dbCreate: async (_table: string, value: any) => { saved = { ...value, id: 1 }; return saved } }
  await (InterludeService.prototype as any).appendEntry.call(service, 's', { kind: 'script', content, actor: 'narrator' }, now)
  assert.equal(saved.content, content)
})
