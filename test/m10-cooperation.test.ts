import assert from 'node:assert/strict'
import test from 'node:test'
import { toPromptPayload, writingAffordances } from '../src/narrator'
import { decisionToScriptCommit } from '../src/script/commit-builder'
import { scriptEntryDraftForCommit } from '../src/turn-persistence'
import { consumedLiveIntentIds, liveNarrativeIntents } from '../src/script/intent-lifecycle'
import { InterludeService } from '../src/service'
import { developmentContextQuery } from '../src/script/development'
import { emptyStorySetting, emptyStoryState, NarrativeIntent, NarrativePhase } from '../src/types'

const now = new Date('2026-09-05T08:00:00Z')
const intent = (id: number, type: string, participantId = 'alice'): NarrativeIntent => ({
  id, type, participantId, storyId: 's', summary: `task ${id}`, status: 'pending', notBefore: now, createdAt: now, updatedAt: now, payload: {},
})
const request = (phase: NarrativePhase): any => ({
  phase, from: now, now, story: { setting: emptyStorySetting(), state: emptyStoryState() },
  participant: { id: 'alice', displayName: 'Alice', profile: '', relationship: '', state: {}, updatedAt: now }, participants: [],
  recentEntries: [], memories: [], activeConsequences: [], supersededIntents: [], dueIntents: [intent(11, 'follow-up-commitment')],
})

for (const phase of ['user-message', 'conversation-follow-up', 'intent-due', 'advance'] as const) {
  test(`${phase}: event source and due task identity survive both prompt orders`, () => {
    for (const cacheFirst of [false, true]) {
      const p = toPromptPayload(request(phase), { cacheFirst })
      assert.equal(p.availableNearFuture.dueIntents[0].id, 11)
      assert.equal(p.incomingEvent.event.type, phase === 'user-message' ? 'private-message-batch' : phase === 'intent-due' ? 'due-intents' : 'none')
    }
    const commit = decisionToScriptCommit({ storyId: 's', participantId: 'alice', phase, from: now, now,
      decision: { script: '她惦记着那件事。', interaction: { seen: true, reply: { mode: 'none' } } } })
    assert.equal(commit.events.some(event => event.kind === 'message-perceived'), phase === 'user-message')
  })
}

test('live turns never consume pending promises or host-owned executor tasks', () => {
  const types = ['follow-up-commitment', 'split-message', 'browser-research', 'proactive-check', 'active-consequence', 'delayed-reply', 'narrative-retry']
  const tasks = types.map((type, index) => intent(index + 1, type))
  // Fix#7: narrative-retry 有专用执行器，不归 live 回合。
  assert.deepEqual(liveNarrativeIntents(tasks).map(item => item.id), [1, 6])
  assert.deepEqual(consumedLiveIntentIds(tasks), [6])
})

test('private follow-up summaries are relationship-local while independent life keeps compact contacts', () => {
  const r = request('conversation-follow-up')
  r.automaticDeliverySummaries = ['alice', 'bob'].map(participantId => ({ participantId, summary: `${participantId} private`, deliveredAt: now.toISOString() }))
  for (const cacheFirst of [false, true]) {
    const p = toPromptPayload(r, { cacheFirst })
    assert.deepEqual(p.ongoingThreads.automaticDeliverySummaries.map((item: any) => item.participantId), ['alice'])
    assert.equal(toPromptPayload({ ...r, phase: 'advance' }, { cacheFirst }).ongoingThreads.automaticDeliverySummaries.length, 2)
  }
})

test('writing affordances follow transport and browsing switches without a mandatory tool routine', () => {
  const disabled = writingAffordances({ messageSeparator: '||', splitReplyMessages: false, browserMode: 'disabled' })
  assert.match(disabled, /splitting is disabled/)
  assert.match(disabled, /leave browserIntents empty/)
  assert.doesNotMatch(disabled, /timing=immediate|<sep\//)
  const deferred = writingAffordances({ messageSeparator: '||', splitReplyMessages: true, browserMode: 'deferred-only' })
  assert.match(deferred, /"\|\|"/)
  assert.match(deferred, /timing=deferred/)
  assert.doesNotMatch(deferred, /timing=immediate/)
  assert.match(writingAffordances({ messageSeparator: '<sep/>', splitReplyMessages: true, browserMode: 'allow-immediate' }), /timing=immediate/)
})

function settlementHarness(outcome = 'fulfilled') {
  const task = intent(11, 'follow-up-commitment')
  const commit = decisionToScriptCommit({ storyId: 's', participantId: 'alice', phase: 'intent-due', from: now, now,
    decision: { script: '她发出“想好了”，接着说“选第一个”。', interaction: { seen: false, reply: { mode: 'immediate', content: '想好了<sep/>选第一个' } } } })
  const event = commit.events.find(item => item.kind === 'outgoing-message')!
  event.metadata = { followUpResolutions: [{ id: 11, outcome, notBefore: new Date(now.getTime() + 60_000).toISOString() }] }
  const entry: any = { id: 3, storyId: 's', ...scriptEntryDraftForCommit(commit, null) }
  let writes = 0
  let warnings = 0
  const registrations: any[] = []
  const service: any = {
    dbGet: async (table: string, query: any) => table === 'interlude_script_entry' ? [structuredClone(entry)]
      : task.status === 'pending' && query.participantId === task.participantId && query.id.$in.includes(task.id) ? [structuredClone(task)] : [],
    dbSet: async (table: string, _query: any, patch: any) => {
      if (table === 'interlude_script_entry') Object.assign(entry, structuredClone(patch))
      else { Object.assign(task, structuredClone(patch)); writes++ }
    },
    scheduleDueIntentWake: () => {},
    reportStandalone: () => { warnings++ },
    applyFollowUpResolutions: (InterludeService.prototype as any).applyFollowUpResolutions,
    getStory: async () => ({ id: 's' }),
    appendFollowUpCommitment: async (_story: any, _participant: string, draft: any) => registrations.push({ draft, previousStatus: task.status }),
  }
  const update = (segmentIndex: number, status: string, storyId = 's') => (InterludeService.prototype as any).updateScriptDeliveryOutcome.call(service,
    storyId, { commitId: commit.commitId, eventId: event.eventId, scriptEntryId: entry.id, segmentIndex }, status, now)
  return { task, entry, update, registrations, writes: () => writes, warnings: () => warnings }
}

test('promise settles after all bubbles are confirmed, never after first or failed delivery', async () => {
  const h = settlementHarness()
  await h.update(0, 'delivered')
  assert.equal(h.task.status, 'pending')
  await h.update(1, 'failed')
  assert.equal(h.task.status, 'pending')
  await h.update(1, 'pending')
  assert.equal(h.task.status, 'pending')
  await h.update(1, 'delivered')
  assert.equal(h.task.status, 'completed')
  assert.equal(h.writes(), 1)
  await h.update(1, 'delivered')
  assert.equal(h.writes(), 1)
  assert.equal(h.warnings(), 0)
})

test('interrupted last bubble and wrong-story callbacks leave the promise pending', async () => {
  const h = settlementHarness()
  await h.update(0, 'delivered', 'other-story')
  await h.update(1, 'delivered', 'other-story')
  assert.equal(h.writes(), 0)
  await h.update(0, 'delivered')
  await h.update(1, 'cancelled')
  assert.equal(h.task.status, 'pending')
  assert.equal(h.writes(), 0)
})

test('reschedule is idempotent even if the script settlement marker was lost', async () => {
  const h = settlementHarness('rescheduled')
  await h.update(0, 'delivered')
  await h.update(1, 'delivered')
  assert.equal(h.task.payload.reschedules, 1)
  delete h.entry.metadata.followUpResolutionEventId
  await h.update(1, 'delivered')
  assert.equal(h.task.payload.reschedules, 1)
  assert.equal(h.writes(), 1)
})

test('an unrelated immediate reply cannot silently fulfil an unresolved due promise', async () => {
  const patches: any[] = []
  await (InterludeService.prototype as any).deferUnresolvedDueFollowUps.call({
    dbSet: async (_table: string, _query: any, patch: any) => patches.push(patch),
    retireExpiredFollowUps: (InterludeService.prototype as any).retireExpiredFollowUps,
    scheduleDueIntentWake: () => {}, reportOperation: () => {}, getStory: async () => ({ id: 's' }),
  }, 's', 'alice', [{ ...intent(11, 'follow-up-commitment'), payload: { expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString() } }], new Set(),
  { seen: false, reply: { mode: 'immediate', content: '我还在书店' } }, now)
  assert.equal(patches.length, 1)
  assert.equal(patches[0].status, undefined)
  assert.ok(patches[0].notBefore > now)
})

test('mixed due work does not starve committed typing or start background narration during a live turn', async () => {
  let deliveries = 0
  let advances = 0
  const service: any = {
    desktopRuntimePhase: 'running', databaseResetting: false, sweepRunning: false,
    getCanonicalStory: async () => ({ id: 's' }), canHandleStory: () => true,
    hasPendingNarrative: () => true,
    dueIntents: async () => [intent(1, 'split-message'), intent(2, 'follow-up-commitment'), intent(3, 'browser-research')],
    deliverDueSplitSegments: async () => { deliveries++ },
    advanceStory: async () => { advances++; return [] },
    reportOperation: () => {},
  }
  await InterludeService.prototype.sweep.call(service)
  assert.equal(deliveries, 1)
  assert.equal(advances, 0)
  assert.equal(service.sweepRunning, false)
})

test('quiet-life development selection uses a bounded visible scene, not a new training sample', () => {
  const entries: any[] = [{ kind: 'script', content: '她仍在书店查证那个问题。' }, { kind: 'user-message', content: 'incoming' }]
  const before = JSON.stringify(entries)
  assert.equal(developmentContextQuery('', [], entries), '她仍在书店查证那个问题。')
  assert.equal(developmentContextQuery('当前问题', ['due'], entries), '当前问题')
  assert.equal(developmentContextQuery('', [], []), '')
  assert.equal(JSON.stringify(entries), before)
})

test('sidecar evidence does not conflict with zero native attachments', () => {
  for (const cacheFirst of [false, true]) {
    const r = { ...request('user-message'), images: [], visualObservations: ['图片上是一只猫'] }
    const event = toPromptPayload(r, { cacheFirst }).incomingEvent.event
    assert.equal(event.imageCount, 0)
    assert.equal(event.visualEvidenceMode, 'sidecar-observations')
    assert.deepEqual(event.visualObservations, r.visualObservations)
    assert.equal(toPromptPayload({ ...r, visualObservations: [] }, { cacheFirst }).incomingEvent.event.visualEvidenceMode, 'none')
  }
})

test('new spoken promise is registered only after full delivery and after old resolution', async () => {
  const h = settlementHarness()
  const event = h.entry.metadata.scriptEvents.find((item: any) => item.kind === 'outgoing-message')
  event.metadata.followUpCommitment = { kind: 'checking', summary: '明白了，稍后确认库存', notBefore: new Date(now.getTime() + 10 * 60_000).toISOString() }
  await h.update(0, 'delivered')
  assert.equal(h.registrations.length, 0)
  await h.update(1, 'failed')
  assert.equal(h.registrations.length, 0)
  await h.update(1, 'delivered')
  assert.equal(h.registrations.length, 1)
  assert.equal(h.registrations[0].previousStatus, 'completed')
  await h.update(1, 'delivered')
  assert.equal(h.registrations.length, 1)
})

test('a completed promise cannot be recreated by replaying its original delivery callback', async () => {
  let writes = 0
  await (InterludeService.prototype as any).appendFollowUpCommitment.call({
    dbGet: async () => [{ ...intent(1, 'follow-up-commitment'), status: 'completed', payload: { originDeliveryEventId: 'e1' } }],
    appendIntent: async () => { writes++ },
  }, { id: 's' }, 'alice', { summary: '旧承诺' }, 3, now, 'e1')
  assert.equal(writes, 0)
})

test('background summary waits for the complete delivery and projection failure is isolated', async () => {
  let writes = 0
  let warnings = 0
  const speech = { participantId: 'alice', eventKind: 'outgoing-message', status: 'partial' }
  const service: any = {
    dbGet: async () => [{ metadata: { deliveryActions: [speech] } }],
    getStory: async () => ({ id: 's', state: emptyStoryState() }),
    dbSet: async () => { writes++ },
    reportStandalone: () => { warnings++ },
    // 裸桩无串行基础设施:按"已在域内"直接执行(与 inSerial 的降级语义一致)
    inSerial: () => true,
  }
  const call = () => (InterludeService.prototype as any).recordAutomaticDelivery.call(service, 's', 'alice', { sourceEntryId: 3, summary: '已经问过对方' }, now)
  await call()
  assert.equal(writes, 0)
  speech.status = 'delivered'
  await call()
  assert.equal(writes, 1)
  service.dbGet = async () => { throw new Error('read unavailable') }
  await assert.doesNotReject(call)
  assert.equal(warnings, 1)
})
