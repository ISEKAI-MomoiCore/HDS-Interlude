import assert from 'node:assert/strict'
import test from 'node:test'
import { compactionPrompt } from '../src/narrator'
import { InterludeService, isHistoryEntryVisibleToParticipant } from '../src/service'
import { emptyStorySetting, emptyStoryState, InterludeStory, ScriptEntry, StatePatchDraft } from '../src/types'

const proto = InterludeService.prototype as any
const now = new Date('2026-10-10T10:00:00Z')
const story: InterludeStory = {
  id: 's', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
  setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now,
}

function entry(id: number, kind = 'script', participantId = 'alice', content = `小林的原始剧本 ${id}`): ScriptEntry {
  return {
    id, storyId: story.id, participantId, kind, actor: kind === 'script' ? 'narrator' : kind === 'user-message' ? 'user' : 'character',
    content, occurredAt: new Date(now.getTime() + id * 1_000), createdAt: now, metadata: { frameId: 'same-scene', original: true },
  }
}

function preparationHost(rows: ScriptEntry[], lastEntryId: number | null = null) {
  const queries: any[] = []
  const scene = { id: 1, storyId: story.id, startedAt: now, lastEntryId, entryCount: 0 }
  const host: any = {
    memoryConfig: { enabled: true, compactionEntryLimit: 80, compactionCharacterLimit: 32_000, sceneEntryThreshold: 1, sceneCharacterThreshold: 10_000, maxFactsPerStory: 200 },
    sharedStoryConfig: { shareParticipantDetails: false }, ensureContinuity: async () => {}, compactOverlayUnlocked: async () => false,
    activeScene: async () => scene, activeArc: async () => ({ id: 1 }), getStory: async () => story, participants: async () => [], facts: async () => [],
    compactionFingerprint: () => 'fingerprint', compactionIsBackedOff: () => false, reportOperation: () => {},
    dbGet: async (table: string, query: any, options: any = {}) => {
      queries.push({ table, query, options })
      if (table !== 'interlude_script_entry') return []
      let selected = rows.filter(row => row.storyId === query.storyId
        && (query.id?.$gt === undefined || row.id > query.id.$gt)
        && (query.id?.$lte === undefined || row.id <= query.id.$lte)
        && (!query.occurredAt?.$gte || row.occurredAt >= query.occurredAt.$gte))
      selected = selected.sort((a, b) => options.sort?.id === 'desc' ? b.id - a.id : a.id - b.id)
      return selected.slice(0, options.limit)
    },
  }
  const prepare = () => proto.prepareCompaction.call(host, story, now, false)
  return { host, scene, queries, prepare }
}

const decision = (patches: StatePatchDraft[] = []) => ({ scene: { summary: '完成本轮整理' }, arc: { summary: '弧线延续' }, statePatches: patches })

function persistenceHost(rows: ScriptEntry[]) {
  const proposals: any[] = []
  const writes: any[] = []
  const logs: any[] = []
  const scene: any = { id: 1, storyId: story.id, startedAt: now, entryCount: 0, lastEntryId: 2 }
  const host: any = {
    memoryConfig: { arcSummaryCharacters: 12_000, sceneSummaryCharacters: 8_000, sceneHookCharacters: 2_000,
      statePatchMinTurns: 3, statePatchMinDays: 2, statePatchConfidenceThreshold: 0.82, majorStatePatchConfidenceThreshold: 0.95,
      autoApplyStatePatches: true, allowMajorStateChanges: true, statePatchCooldownHours: 72 },
    activeArc: async () => ({ id: 1, title: '正在发生的故事' }),
    dbGet: async (table: string, query: any) => table === 'interlude_state_patch' ? proposals
      : table === 'interlude_script_entry' ? rows.filter(row => query.id.$in.includes(row.id)) : [],
    dbSet: async (table: string, query: any, value: any) => {
      writes.push({ table, query, value })
      if (table === 'interlude_scene') Object.assign(scene, value)
      if (table === 'interlude_state_patch') Object.assign(proposals.find(item => item.id === query.id), value)
    },
    dbCreate: async (table: string, value: any) => {
      assert.equal(table, 'interlude_state_patch')
      const proposal = { id: proposals.length + 1, ...value }
      proposals.push(proposal)
      return proposal
    },
    reportOperation: (...args: any[]) => logs.push(args),
  }
  host.persistCompaction = (...args: any[]) => proto.persistCompactionOutputs.call(host, ...args)
  host.persistStatePatch = (...args: any[]) => proto.persistStatePatch.call(host, ...args)
  const apply = (nextDecision: any, entries: ScriptEntry[], precedingEntries: ScriptEntry[] = []) => proto.applyCompaction.call(host, story, {
    sceneCompactionDue: true, current: story, scene, sceneEntries: entries, visibleCompactionFacts: [], compactRequest: { precedingEntries },
  }, nextDecision, now, Date.now())
  return { host, proposals, writes, logs, scene, apply }
}

function relationshipPatch(overrides: Partial<StatePatchDraft> = {}): StatePatchDraft {
  return {
    target: 'relationship', participantId: 'alice', path: 'trust', proposedValue: '主角与小林在协作时会先说明界限',
    evidence: '小林提出界限，主角随后明确回应', confidence: 0.9, sourceEntryIds: [1, 2, 3],
    interactionReview: { outcome: 'supported', feedbackEntryIds: [1], responseEntryIds: [3] }, ...overrides,
  }
}

const feedback = () => entry(1, 'user-message', 'alice', '小林说：这件事请先问过我。')
const interpretation = () => entry(2)
const response = () => entry(3, 'character-message', 'alice', '好，我会先确认你的意见。')

test('default privacy no longer hides originals or ownership from the backstage editor', async () => {
  const rows = [entry(1, 'user-message'), entry(2), entry(3, 'character-message'), entry(4, 'user-message', 'bob')]
  const h = preparationHost(rows)
  const before = structuredClone(rows)
  const prepared = await h.prepare()
  assert.equal(prepared.phase, 'run')
  assert.deepEqual(prepared.compactRequest.entries, before)
  assert.deepEqual(rows, before, 'preparation must not mutate stored originals')
  assert.equal(h.host.sharedStoryConfig.shareParticipantDetails, false)
})

test('the editor only reads its own story and continues to exclude redacted originals', async () => {
  const h = preparationHost([entry(1), entry(2, 'redacted'), { ...entry(3), storyId: 'other-story' }])
  const prepared = await h.prepare()
  assert.deepEqual(prepared.compactRequest.entries.map((row: ScriptEntry) => row.id), [1])
  assert.ok(h.queries.filter(query => query.table === 'interlude_script_entry').every(query => query.query.storyId === story.id))
})

test('preceding originals retain scoped feedback and metadata without replaying them as the new increment', async () => {
  const h = preparationHost([feedback(), interpretation(), response()], 2)
  const prepared = await h.prepare()
  assert.deepEqual(prepared.compactRequest.entries.map((row: ScriptEntry) => row.id), [3])
  assert.deepEqual(prepared.compactRequest.precedingEntries, [feedback(), interpretation()])
  assert.equal(prepared.compactRequest.precedingEntries[0].participantId, 'alice')
})

test('original character budget still takes a contiguous new prefix', async () => {
  const h = preparationHost([entry(1, 'script', 'alice', 'a'.repeat(80)), entry(2, 'script', 'alice', 'b'.repeat(80))])
  h.host.memoryConfig.compactionCharacterLimit = 100
  const prepared = await h.prepare()
  assert.deepEqual(prepared.compactRequest.entries.map((row: ScriptEntry) => row.id), [1])
})

test('preceding context remains limited to twelve non-redacted recent rows and the character budget', async () => {
  const h = preparationHost([...Array.from({ length: 14 }, (_, index) => entry(index + 1, 'script', 'alice', 'x'.repeat(2_000))), entry(15)], 14)
  const prepared = await h.prepare()
  assert.deepEqual(prepared.compactRequest.precedingEntries.map((row: ScriptEntry) => row.id), [11, 12, 13, 14])
  assert.ok(h.queries.some(query => query.options.limit === 12 && query.options.sort.id === 'desc'))
})

test('the live audience history visibility rule is unchanged', () => {
  assert.equal(isHistoryEntryVisibleToParticipant(entry(1, 'user-message', 'alice'), 'alice', false), true)
  assert.equal(isHistoryEntryVisibleToParticipant(entry(2, 'user-message', 'bob'), 'alice', false), false)
  assert.equal(isHistoryEntryVisibleToParticipant(entry(3, 'character-message', 'bob'), 'alice', false), false)
  assert.equal(isHistoryEntryVisibleToParticipant(entry(4, 'script', ''), 'alice', false), true)
})

for (const tier of ['lite', 'full']) {
  test(`${tier} compaction example includes existing source ids and legal development instructions`, () => {
    const prompt = compactionPrompt('', '', '', '', { tier })
    const schema = JSON.parse(prompt.split('\n').find(line => line.startsWith('{'))!)
    assert.deepEqual(schema.facts[0].sourceEntryIds, [1])
    assert.deepEqual(schema.statePatches[0].sourceEntryIds, [1])
    assert.ok(schema.statePatches[0].target.includes('perspective'))
    assert.ok(schema.statePatches[0].participantId)
    assert.match(prompt, /character\/traits\|preferences\|coping/)
    assert.match(prompt, /perspective\/values\|interpretation/)
    assert.match(prompt, /relationship\/trust\|closeness\|boundaries/)
    assert.match(prompt, /world\/established/)
    assert.match(prompt, /interactionReview:\{outcome:"supported\|contested\|unresolved",feedbackEntryIds:/)
    assert.match(prompt, /responseEntryIds:/)
    assert.match(prompt, /every proposal must cite at least one new entry/)
    assert.match(prompt, /Return empty facts\/statePatches arrays when nothing qualifies/)
  })
}

test('feedback before the checkpoint supports its subsequent newly delivered response', async () => {
  const h = persistenceHost([feedback(), interpretation(), response()])
  await h.apply(decision([relationshipPatch()]), [response()], [feedback(), interpretation()])
  assert.equal(h.proposals.length, 1)
  assert.deepEqual(h.proposals[0].sourceEntryIds, [1, 2, 3])
  assert.equal(h.proposals[0].status, 'proposed', 'existing promotion gates must remain intact')
  assert.equal(h.scene.lastEntryId, 3)
  assert.equal(h.scene.entryCount, 1, 'old context is not counted as newly compacted entries')
})

test('old feedback alone cannot create a proposal or count as fresh evidence', async () => {
  const h = persistenceHost([feedback(), interpretation(), response(), entry(4)])
  await h.apply(decision([relationshipPatch()]), [entry(4)], [feedback(), interpretation(), response()])
  assert.equal(h.proposals.length, 0)
  assert.ok(h.logs.some(args => args[4] === '发展提案未保留：缺少本轮新条目来源'))
})

test('reusing preceding feedback in the same scene keeps unique sources without raising confidence', async () => {
  const rows = [feedback(), interpretation(), response(), entry(4)]
  const h = persistenceHost(rows)
  await h.apply(decision([relationshipPatch()]), [response()], [feedback(), interpretation()])
  const confidence = h.proposals[0].confidence
  await h.apply(decision([relationshipPatch({ sourceEntryIds: [1, 2, 3, 4] })]), [entry(4)], rows.slice(0, 3))
  assert.equal(h.proposals.length, 1)
  assert.deepEqual(h.proposals[0].sourceEntryIds, [1, 2, 3, 4])
  assert.equal(h.proposals[0].confidence, confidence)
  assert.equal(h.proposals[0].status, 'proposed')
})

test('relationship evidence outside the actually supplied context is not recovered from storage', async () => {
  const h = persistenceHost([feedback(), interpretation(), response()])
  await h.apply(decision([relationshipPatch()]), [response()], [interpretation()])
  assert.equal(h.proposals.length, 0, 'feedback absent from the request cannot be used')
})

test('cross-participant feedback remains invalid after the checkpoint fix', async () => {
  const wrongFeedback = { ...feedback(), participantId: 'bob' }
  const h = persistenceHost([wrongFeedback, interpretation(), response()])
  await h.apply(decision([relationshipPatch()]), [response()], [wrongFeedback, interpretation()])
  assert.equal(h.proposals.length, 0)
})

test('an unsent script passage cannot stand in for a delivered character response', async () => {
  const unsentResponse = { ...response(), kind: 'script', actor: 'narrator' }
  const h = persistenceHost([feedback(), interpretation(), unsentResponse])
  await h.apply(decision([relationshipPatch()]), [unsentResponse], [feedback(), interpretation()])
  assert.equal(h.proposals.length, 0)
  assert.ok(h.logs.some(args => args[4].includes('缺少有效的用户反馈与后续已送达回应证据')))
})

for (const outcome of ['contested', 'unresolved'] as const) {
  test(`${outcome} relationship reception still cannot create a proposal`, async () => {
    const h = persistenceHost([feedback(), interpretation(), response()])
    await h.apply(decision([relationshipPatch({ interactionReview: { outcome, feedbackEntryIds: [1], responseEntryIds: [3] } })]), [response()], [feedback(), interpretation()])
    assert.equal(h.proposals.length, 0)
  })
}

test('a response that predates the actual feedback remains invalid', async () => {
  const earlyResponse = entry(1, 'character-message')
  const laterFeedback = entry(2, 'user-message')
  const h = persistenceHost([earlyResponse, laterFeedback, entry(3)])
  await h.apply(decision([relationshipPatch({ interactionReview: { outcome: 'supported', feedbackEntryIds: [2], responseEntryIds: [1] } })]), [entry(3)], [earlyResponse, laterFeedback])
  assert.equal(h.proposals.length, 0)
})

test('non-relationship development continues to validate only the new increment', async () => {
  const old = entry(1, 'script', '')
  const current = entry(3, 'script', '')
  const h = persistenceHost([old, current])
  await h.apply(decision([{ target: 'perspective', path: 'values', proposedValue: '主角会先确认界限', evidence: '本轮决定', confidence: 0.9, sourceEntryIds: [1, 3] }]), [current], [old])
  assert.deepEqual(h.proposals[0].sourceEntryIds, [3])
})

test('facts are not given the expanded relationship evidence range', async () => {
  const h = persistenceHost([feedback(), response()])
  let sources: ScriptEntry[] = []
  h.host.persistFact = async (_storyId: string, _draft: any, entries: ScriptEntry[]) => { sources = entries; return false }
  await h.apply({ ...decision(), facts: [{ scope: 'relationship', content: '小林要求先确认界限', sourceEntryIds: [1, 3] }] }, [response()], [feedback()])
  assert.deepEqual(sources, [response()])
})

test('completion logs name model output counts even when proposals were not persisted', async () => {
  const h = persistenceHost([entry(3)])
  await h.apply({ ...decision([relationshipPatch()]), facts: [{ scope: 'event', content: '模型产出但无本轮来源', sourceEntryIds: [99] }] }, [entry(3)])
  assert.equal(h.proposals.length, 0)
  const completion = h.logs.find(args => args[4].startsWith('后台整理完成'))
  assert.match(completion[4], /模型提取事实=%d 模型提取发展提案=%d/)
  assert.doesNotMatch(completion[4], /长期事实=%d|状态变更=%d/)
  assert.deepEqual(completion.slice(-3), [1, 1, 1])
  assert.ok(h.logs.some(args => args[4] === '长期事实未写入：缺少本轮新条目来源'))
})

test('existing direct compaction callers do not need preceding context', async () => {
  const h = persistenceHost([entry(3)])
  await proto.persistCompactionOutputs.call(h.host, story, h.scene, decision(), [entry(3)], now)
  assert.equal(h.scene.lastEntryId, 3)
})
