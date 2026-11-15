import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeKnowledgeEvidence, supportsRecordedOutcome, contactEvidenceThreads, factEvidenceForPrompt } from '../src/script/knowledge-evidence'
import { reconcileTransportReferences } from '../src/script/authored-actions'
import { decisionToScriptCommit } from '../src/script/commit-builder'
import { validateScriptCommit } from '../src/script/validator'
import { scriptEntryDraftForCommit } from '../src/turn-persistence'
import { prepareOutgoingDelivery, attachMessageEvent } from '../src/delivery'
import { InterludeService } from '../src/service'
import { decodeStoryState, encodeStoryState } from '../src/story-state'
import type { NarrativeDecision, NarrativeFact, ScriptEntry } from '../src/types'
import { emptyStorySetting, emptyStoryState } from '../src/types'
import { toPromptPayload } from '../src/narrator'

const now = new Date('2026-09-06T09:38:00Z')
const entry = (id: number, kind: string, content: string, participantId = 'alice') => ({
  id, storyId: 'story', kind, content, participantId, actor: kind === 'user-message' ? 'user' : 'character',
  occurredAt: now, createdAt: now, metadata: {},
}) as ScriptEntry
const fact = (id: number, content: string, sourceEntryIds: number[], participantId = 'alice'): NarrativeFact => ({
  id, storyId: 'story', participantId, scope: 'promise', content, sourceEntryIds,
  importance: 0.5, confidence: 0.6, unresolved: true, status: 'active', lastSeenAt: now, createdAt: now, updatedAt: now,
})

test('a narrative imagining acceptance remains interpretation, not mutual confirmation', () => {
  const rows = [entry(1, 'user-message', '我想再跟你看一次电影'), entry(2, 'script', '她觉得自己已经默认接受了')]
  const knowledge = normalizeKnowledgeEvidence({ mode: 'confirmed', clauses: [
    { role: 'proposal', sourceEntryId: 1, quote: rows[0].content },
    { role: 'confirmation', sourceEntryId: 2, quote: rows[1].content },
  ] }, rows, [1, 2])
  assert.equal(knowledge.mode, 'unclassified')
  assert.equal(knowledge.clauses[1].role, 'interpretation')
  assert.equal(supportsRecordedOutcome(knowledge), false)
})

test('actual acceptance can be recorded while retaining the original condition and relationship', () => {
  const rows = [entry(1, 'user-message', '如果电影好看，我想再跟你看一次'), entry(2, 'character-message', '行吧')]
  const knowledge = normalizeKnowledgeEvidence({ mode: 'confirmed', topic: '电影', clauses: [
    { role: 'proposal', sourceEntryId: 1, quote: rows[0].content },
    { role: 'condition', sourceEntryId: 1, quote: '如果电影好看' },
    { role: 'confirmation', sourceEntryId: 2, quote: '行吧' },
  ] }, rows, [1, 2], [99])
  assert.equal(knowledge.mode, 'confirmed')
  assert.equal(supportsRecordedOutcome(knowledge), true)
  assert.equal(knowledge.clauses[1].quote, '如果电影好看')
  assert.deepEqual(knowledge.relatedFactIds, [99])
  assert.equal(normalizeKnowledgeEvidence(knowledge, [rows[0], { ...rows[1], participantId: 'bob' }], [1, 2]).mode, 'conditional')
})

test('missing or forged quotations never acquire stronger authority and old facts are not rewritten', () => {
  const rows = [entry(1, 'user-message', '想睡觉')]
  const k = normalizeKnowledgeEvidence({ mode: 'observed', clauses: [{ role: 'observation', sourceEntryId: 1, quote: '睡了五小时' }] }, rows, [1])
  assert.equal(k.mode, 'unclassified')
  const old = fact(1, '旧的承诺摘要', [1])
  assert.equal(factEvidenceForPrompt(old).knowledge.mode, 'unclassified')
  assert.equal(old.knowledge, undefined)
})

test('condition chains retain whole originals, adjacent responses and missing-source markers without leaking branches', async () => {
  const condition = fact(10, '早睡一周才看电影', [100])
  const proposal = fact(11, '如果好看，想再看一次', [200])
  proposal.knowledge = { mode: 'conditional', clauses: [], relatedFactIds: [10] }
  const rows = [entry(100, 'character-message', '至少连续一周再说'), entry(101, 'user-message', '好吧'),
    entry(200, 'user-message', '如果好看，我想再跟你看一次'), entry(201, 'character-message', '別急'), entry(202, 'user-message', '私密', 'bob')]
  const service: any = { dbGet: async (table: string) => table === 'interlude_fact'
    ? [proposal, condition, fact(12, '另一个人的电影', [202], 'bob')] : rows }
  const chain = await (InterludeService.prototype as any).contactThreads.call(service, 'story', [proposal], 'alice')
  assert.ok(chain.some((item: any) => item.originals.some((r: any) => r.content === '至少连续一周再说')))
  assert.ok(!JSON.stringify(chain).includes('私密'))
  assert.deepEqual(contactEvidenceThreads([fact(1, 'missing', [999])], rows)[0].missingSourceEntryIds, [999])
  const publicChain = await (InterludeService.prototype as any).contactThreads.call(service, 'story', [proposal], undefined)
  assert.deepEqual(publicChain, [])
})

test('working-detail evidence survives state encoding without modifying its prose', () => {
  const knowledge = normalizeKnowledgeEvidence({ mode: 'belief', holder: 'protagonist', clauses: [
    { role: 'interpretation', sourceEntryId: 1, quote: '她希望他今天来' },
  ] }, [entry(1, 'script', '她希望他今天来')], [1])
  const state = decodeStoryState({ workingDetails: [{ label: '期待', value: '她希望他今天来', createdAt: now.toISOString(), sourceEntryIds: [1], knowledge }] })
  assert.deepEqual(decodeStoryState(encodeStoryState(state)).workingDetails?.[0].knowledge, knowledge)
})

test('main user and automatic windows keep contact conditions in both payload orders', () => {
  const source = entry(1, 'character-message', '至少连续一周再说')
  const chain = contactEvidenceThreads([fact(1, '电影条件', [1])], [source])
  const story: any = { id: 'story', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now }
  for (const phase of ['user-message', 'conversation-follow-up', 'advance'] as const) {
    for (const cacheFirst of [true, false]) {
      const payload = toPromptPayload({ story, phase, from: now, now, participant: null, participants: [],
        shareParticipantDetails: false, recentEntries: [source], memories: [], dueIntents: [], activeConsequences: [],
        supersededIntents: [], contactThreads: chain }, { cacheFirst })
      assert.deepEqual(payload.ongoingThreads.contactThreads, chain)
    }
  }
})

test('unclassified or imagined completion cannot close a promise, and repeated belief adds no confidence', async () => {
  const existing = fact(12, '电影安排', [1], '')
  let patch: any
  const host: any = { memoryConfig: { factContentCharacters: 4000, maxFactsPerStory: 200 },
    dbGet: async () => [existing], dbSet: async (_t: any, _q: any, value: any) => { patch = value }, embedText: async () => [] }
  const source = entry(2, 'script', '她觉得他默认接受了', '')
  await (InterludeService.prototype as any).persistFact.call(host, 'story', {
    scope: 'promise', content: existing.content, unresolved: false, confidence: 1, sourceEntryIds: [2],
  }, [source], now)
  assert.equal(patch.unresolved, true)
  assert.equal(patch.confidence, 0.6)
  assert.equal(patch.knowledge.mode, 'unclassified')
})

test('17:38 regression: a two-bubble terminal script block becomes one complete delivery event', () => {
  const raw: NarrativeDecision = { script: '她拿起手机。\n\n牛逼<sep/>你继续勿扰吧',
    interaction: { seen: true, reply: { mode: 'immediate', content: '牛逼' } } }
  const decision = reconcileTransportReferences(raw)
  assert.equal(decision.interaction?.reply.content, '牛逼<sep/>你继续勿扰吧')
  assert.equal(decision.script, raw.script)
  assert.deepEqual(reconcileTransportReferences(decision), decision)
  const commit = decisionToScriptCommit({ storyId: 'story', participantId: 'alice', phase: 'user-message', from: now, now, decision, frameId: 'frame', burstId: 'burst' })
  assert.equal(validateScriptCommit(commit).valid, true)
  const event = commit.events.find(event => event.kind === 'outgoing-message')!
  assert.deepEqual(event.bubbles, ['牛逼', '你继续勿扰吧'])
  const output = prepareOutgoingDelivery(attachMessageEvent({ participantId: 'alice', content: event.content! }, event), event.bubbles!)!
  assert.equal(output.content, '牛逼')
  assert.deepEqual(output.laterSegments, ['你继续勿扰吧'])
  assert.equal((scriptEntryDraftForCommit(commit, null).metadata as any).deliveryActions[0].segments.length, 2)
})

test('tail repair respects non-actions, explicit action ids, custom separators and early-delivery idempotency', () => {
  const raw: NarrativeDecision = { script: '她拿起手机。\n\n甲||乙', interaction: { seen: true, reply: { mode: 'immediate', content: '甲' } } }
  assert.equal(reconcileTransportReferences(raw, false, '||').interaction?.reply.content, '甲||乙')
  const sent = reconcileTransportReferences(raw, true, '||')
  assert.equal(reconcileTransportReferences(sent, false, '||').interaction?.reply.content, '甲')
  for (const script of ['她想起“甲||乙”。', '她拿起手机。\n\n甲||乙\n然后放下手机。'])
    assert.equal(reconcileTransportReferences({ ...raw, script }, false, '||').interaction?.reply.content, '甲')
  const none: NarrativeDecision = { ...raw, interaction: { seen: true, reply: { mode: 'none' } } }
  assert.equal(reconcileTransportReferences(none).interaction?.reply.mode, 'none')
  const tagged: NarrativeDecision = { script: '她发出<say id="r">甲||乙</say>。', interaction: { seen: true, reply: { mode: 'immediate', actionId: 'r' } } }
  assert.equal(reconcileTransportReferences(tagged, false, '||').interaction?.reply.content, '甲||乙')
  const partial = reconcileTransportReferences({ ...tagged, script: '她拿起手机。\n\n<say id="r">甲</say>||乙' }, false, '||')
  assert.equal(partial.interaction?.reply.content, '甲||乙')
  assert.equal(partial.authoredActions?.[0].content, '甲||乙')
  assert.deepEqual(reconcileTransportReferences(partial, false, '||'), partial)
})

test('legacy knowledge rows persisted as empty objects never crash evidence reads', () => {
  // Rows written before evidence fields existed hold knowledge = {} with no
  // clauses or relatedFactIds arrays. All read paths must coerce defensively.
  const legacy = fact(9, '她答应周末一起去万松园', [1], 'alice')
  ;(legacy as any).knowledge = {}
  const modern = fact(10, '另一条事实', [2])
  ;(modern as any).knowledge = { mode: 'proposal', topic: '万松园' }
  assert.deepEqual(factEvidenceForPrompt(legacy).knowledge, { mode: 'unclassified', clauses: [], relatedFactIds: [] })
  // A partial legacy shape (mode without clauses) is treated as no evidence too.
  assert.deepEqual(factEvidenceForPrompt(modern).knowledge, { mode: 'unclassified', clauses: [], relatedFactIds: [] })
  assert.equal(supportsRecordedOutcome({ ...(legacy.knowledge as any), mode: 'confirmed' }), false)
  const threads = contactEvidenceThreads([legacy, modern], [entry(1, 'user-message', '她答应周末一起去万松园')])
  assert.equal(threads.length, 2)
  assert.deepEqual(threads[0].fact.knowledge.clauses, [])
})
