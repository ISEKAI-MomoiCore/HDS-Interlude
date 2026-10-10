import { deliveryHost } from './helpers/delivery-host'
import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { emptyStorySetting, emptyStoryState, NarrativeIntent } from '../src/types'

const methods = InterludeService.prototype as any
const now = new Date('2026-10-10T05:12:16.000Z')
const minute = 60_000
function intent(id: number, type: string, participantId = 'alice', delay = 0): NarrativeIntent {
  return { id, storyId: 's', participantId, type, summary: `task ${id}`, status: 'pending',
    notBefore: new Date(now.getTime() + delay), createdAt: now, updatedAt: now,
    payload: type === 'split-message' ? { content: `bubble ${id}` }
      : type === 'follow-up-commitment' ? { expiresAt: new Date(now.getTime() + 60 * minute).toISOString() } : {} }
}

// Exercise the actual scheduler/service methods with snapshot reads, not source
// regexes or a mocked barrier. The fixture models platform acceptance separately
// from character-message confirmation, and detects accidental narrator calls.
function harness(rows: NarrativeIntent[] = []) {
  const state = emptyStoryState()
  const story: any = { id: 's', status: 'active', setting: emptyStorySetting(), state,
    cursorAt: new Date(now.getTime() - 10 * minute), createdAt: now, updatedAt: now }
  const entries: any[] = []
  const writes: any[] = [], wakes: Date[] = [], calls: any[] = [], sends: any[] = [], errors: any[] = []
  let acceptTransport = true
  let afterDelivery: (() => void) | undefined
  function matches(row: any, query: any) {
    return Object.entries(query).every(([key, value]: [string, any]) => {
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if (value.$in) return value.$in.includes(row[key])
        if (value.$lte) return row[key] <= value.$lte
        if (value.$gt) return row[key] > value.$gt
      }
      return row[key] === value
    })
  }
  const host: any = {
    config: { runtime: { maxMessageCharacters: 1000, minimumAdvanceMinutes: 1,
      allowProactiveMessages: true, sweepIntervalMinutes: 5 } },
    urgeConfig: { enabled: false }, autoAdvanceConfig: { enabled: false }, agencyConfig: { enabled: true },
    browserConfig: { maxResearchPerSweep: 1 }, interruptedTypingParticipants: new Set<string>(),
    scheduler: { cancelWake: () => {} },
    serial: async (_id: string, run: () => Promise<unknown>) => run(),
    getStory: async () => structuredClone(story), getParticipant: async (id: string) => ({ id, status: 'active' }),
    dbGet: async (table: string, query: any, options: any = {}) => {
      let result = (table === 'interlude_intent' ? rows : table === 'interlude_script_entry' ? entries : [])
        .filter(row => matches(row, query))
      if (options.sort?.notBefore === 'asc') result = [...result].sort((a, b) => a.notBefore.getTime() - b.notBefore.getTime())
      if (options.limit) result = result.slice(0, options.limit)
      return structuredClone(result)
    },
    dbSet: async (table: string, query: any, patch: any) => {
      writes.push({ table, query, patch: structuredClone(patch) })
      const data = table === 'interlude_intent' ? rows : table === 'interlude_story' ? [story] : entries
      for (const row of data) if (matches(row, query)) Object.assign(row, structuredClone(patch))
    },
    appendEntry: async (_id: string, draft: any, _at: Date, participantId: string) => {
      const entry = { ...draft, id: entries.length + 1, storyId: 's', participantId }
      entries.push(entry); return entry
    },
    sendOutgoingMessages: async (_story: any, messages: any[]) => {
      if (!acceptTransport) return []
      sends.push(...messages); return messages
    },
    updateScriptDeliveryOutcome: async (_id: string, ref: any, status: string) => {
      const entry = entries.find(row => row.id === ref.scriptEntryId)
      const action = entry?.metadata?.deliveryActions?.find((a: any) => a.commitId === ref.commitId && a.eventId === ref.eventId)
      const segment = action?.segments?.find((s: any) => s.index === (ref.segmentIndex ?? ref.bubbleIndex ?? 0))
      if (segment) segment.status = status
      afterDelivery?.()
    },
    recordCharacterMessage: async () => {}, recordAutomaticDelivery: async () => {},
    typingDelayMilliseconds: () => 2000,
    scheduleDueIntentWake: (_id: string, at: Date) => wakes.push(at),
    dueConversationFollowUps: () => [], isAutomaticAdvanceDue: () => true, isAutomaticAdvancePaused: () => false,
    tryDecide: async (_story: any, participant: any, phase: string, _from: Date, _at: Date, _user: any, due: any[]) => {
      calls.push({ participantId: participant?.id, phase, due }); return { decision: {}, succeeded: true }
    },
    persistDecision: async (_story: any, _p: any, _decision: any, _from: Date, _at: Date, _permit: any, _phase: any, due: any[]) => {
      // Simulate a promise fulfilled by this new round, but make an accidental
      // round visible in `calls`, independently of delivery/ledger assertions.
      for (const item of due) rows.find(row => row.id === item.id)!.status = 'completed'
      return { messages: [] }
    },
    scheduleNextAutomaticAdvance: async () => {}, completeConversationFollowUps: async () => false,
    pauseAutomaticAdvanceAfterDelayedReply: async () => {},
    executeDeferredBrowserIntent: async (_story: any, item: any) => { rows.find(row => row.id === item.id)!.status = 'completed' },
    executeQzoneIntent: async (_story: any, item: any) => { rows.find(row => row.id === item.id)!.status = 'completed' },
    reportOperation: () => {}, reportStandalone: () => {}, report: (...args: any[]) => errors.push(args),
  }
  for (const name of ['dueIntents', 'retireExpiredFollowUps', 'pendingFollowUpCommitments', 'pendingSplitSegments',
    'deferDueIntentsBehindPendingSplits', 'scheduleNextSplitWake', 'reconcileTerminalSplitIntent',
    'deferUnresolvedDueFollowUps', 'cancelPendingOutgoingMessages', 'deliverDueSplitSegments',
    'pendingOutgoingDeliveryCandidates', 'recoverPendingDeliveryCandidate', 'applyFollowUpResolutions']) host[name] = methods[name]
  deliveryHost(host)
  return { host, rows, story, entries, writes, wakes, calls, sends, errors,
    accept: (value: boolean) => { acceptTransport = value },
    onDelivery: (callback: () => void) => { afterDelivery = callback },
    advance: async (at = now, force = false) => {
      const result = await methods.advanceUnlocked.call(host, structuredClone(story), at, force)
      assert.deepEqual(errors, []); return result
    },
    defer: (items = rows, resolved = new Set<number>(), at = now) =>
      methods.deferUnresolvedDueFollowUps.call(host, 's', 'alice', structuredClone(items), resolved, undefined, at),
  }
}

test('future split bubbles gate a due promise, including automatic fallback, without becoming character speech', async () => {
  const h = harness([intent(1, 'split-message', 'alice', 3000), intent(2, 'follow-up-commitment')])
  h.host.autoAdvanceConfig.enabled = true
  await h.advance()
  assert.equal(h.calls.length, 0); assert.equal(h.sends.length, 0); assert.equal(h.entries.length, 0)
  assert.equal(h.rows[0].status, 'pending'); assert.equal(h.rows[1].status, 'pending')
  assert.equal(h.rows[1].notBefore.getTime(), now.getTime() + 30_000)
  assert.equal(h.rows[1].payload.deferredChecks, undefined)
  assert.equal(h.rows[1].payload.expiresAt, new Date(now.getTime() + 60 * minute).toISOString())
})

test('due split is delivered first, remaining future split blocks the promise until the chain drains', async () => {
  const h = harness([intent(1, 'split-message'), intent(2, 'split-message', 'alice', 5000), intent(3, 'follow-up-commitment')])
  await h.advance()
  assert.deepEqual(h.sends.map(m => m.content), ['bubble 1']); assert.equal(h.calls.length, 0)
  assert.deepEqual(h.entries.filter(e => e.kind === 'character-message').map(e => e.content), ['bubble 1'])
  await h.advance(new Date(now.getTime() + 31_000))
  assert.deepEqual(h.sends.map(m => m.content), ['bubble 1', 'bubble 2'])
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].phase, 'intent-due')
  assert.equal(h.rows[2].status, 'completed')
})

test('a promise settled by the last split is removed from the stale pre-send due snapshot', async () => {
  const h = harness([intent(1, 'split-message'), intent(2, 'follow-up-commitment')])
  h.rows[0].payload.scriptEvent = reference()
  h.entries.push(ledgerEntry())
  h.onDelivery(() => { h.rows[1].status = 'completed' })
  await h.advance()
  assert.equal(h.sends.length, 1); assert.equal(h.calls.length, 0)
  assert.equal(h.rows[1].status, 'completed')
})

test('an unrelated participant due turn is not blocked or cancelled by another typing chain', async () => {
  const h = harness([intent(1, 'split-message', 'alice', 5000), intent(2, 'follow-up-commitment', 'bob')])
  await h.advance()
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].participantId, 'bob')
  assert.equal(h.rows[0].status, 'pending')
})

test('global due work waits for any chain because its recipient is only known after writing', async () => {
  const h = harness([intent(1, 'split-message', 'alice', 5000), intent(2, 'some-global-plan', '')])
  await h.advance(); assert.equal(h.calls.length, 0); assert.ok(h.rows[1].notBefore > now)
})

for (const force of [false, true]) {
  test(`${force ? 'manual' : 'automatic'} life advance cannot bypass future pending splits`, async () => {
    const h = harness([intent(1, 'split-message', 'alice', 5000)])
    h.host.autoAdvanceConfig.enabled = true
    await h.advance(now, force); assert.equal(h.calls.length, 0)
  })
}

for (const participantId of ['alice', 'bob']) {
  test(`conversation follow-up for ${participantId} waits only for its own chain`, async () => {
    const h = harness([intent(1, 'split-message', 'alice', 5000)])
    h.host.autoAdvanceConfig.enabled = true
    h.story.state.automation = { conversationFollowUpParticipantId: participantId }
    h.host.dueConversationFollowUps = () => ['follow-up']
    await h.advance()
    assert.equal(h.calls.length, participantId === 'alice' ? 0 : 1)
    if (h.calls.length) assert.equal(h.calls[0].phase, 'conversation-follow-up')
  })
}

test('browser and qzone execution remain available behind the narrative barrier', async () => {
  const h = harness([intent(1, 'split-message', 'alice', 5000), intent(2, 'browser-research'), intent(3, 'qzone-action')])
  await h.advance()
  assert.equal(h.rows[1].status, 'completed'); assert.equal(h.rows[2].status, 'completed')
  assert.equal(h.rows[0].status, 'pending'); assert.equal(h.calls.length, 0)
})

test('failed split transport neither confirms character speech nor releases the due narration barrier', async () => {
  const h = harness([intent(1, 'split-message'), intent(2, 'follow-up-commitment')])
  h.accept(false); await h.advance()
  assert.equal(h.entries.length, 0); assert.equal(h.calls.length, 0)
  assert.equal(h.rows[0].status, 'pending'); assert.ok(h.rows[0].notBefore > now)
})

test('incoming interruption cancels the typing chain and releases subsequent due work', async () => {
  const h = harness([intent(1, 'split-message', 'alice', 5000), intent(2, 'follow-up-commitment')])
  h.host.interruptedTypingParticipants.add('alice')
  await h.host.cancelPendingOutgoingMessages('s', 'alice', now)
  assert.equal(h.rows[0].status, 'cancelled'); assert.equal(h.host.interruptedTypingParticipants.size, 0)
  await h.advance(); assert.equal(h.calls.length, 1); assert.equal(h.sends.length, 0)
  assert.equal(h.entries.some(e => e.kind === 'character-message'), false)
})

test('past expiresAt retires both due and future-dated zombies before any model invocation', async () => {
  const due = intent(1, 'follow-up-commitment'), future = intent(2, 'follow-up-commitment', 'alice', 20 * minute)
  for (const row of [due, future]) row.payload.expiresAt = new Date(now.getTime() - 1).toISOString()
  const h = harness([due, future]); await h.advance()
  assert.equal(h.calls.length, 0)
  assert.ok(h.rows.every(row => row.status === 'cancelled' && row.payload.cancelReason === 'follow-up-commitment-expired'))
})

test('legacy promises use creation+24h, persist that deadline, and never get a sliding lifespan', async () => {
  const row = intent(1, 'follow-up-commitment'); row.payload = {}; row.createdAt = new Date(now.getTime() - 23 * 60 * minute)
  const h = harness([row]); await h.host.pendingFollowUpCommitments('s', 'alice', now)
  const deadline = new Date(now.getTime() + 60 * minute).toISOString()
  assert.equal(row.payload.expiresAt, deadline)
  await h.host.pendingFollowUpCommitments('s', 'alice', new Date(now.getTime() + 30 * minute))
  assert.equal(row.payload.expiresAt, deadline)
  const visible = await h.host.pendingFollowUpCommitments('s', 'alice', new Date(deadline))
  assert.deepEqual(visible, []); assert.equal(row.status, 'cancelled')
})

test('already-old legacy promises do not consume the two-commitment prompt budget', async () => {
  const old = intent(1, 'follow-up-commitment'); old.payload = {}; old.createdAt = new Date(now.getTime() - 25 * 60 * minute)
  const h = harness([old, intent(2, 'follow-up-commitment'), intent(3, 'follow-up-commitment')])
  const visible = await h.host.pendingFollowUpCommitments('s', 'alice', now)
  assert.deepEqual(visible.map((row: NarrativeIntent) => row.id), [2, 3]); assert.equal(old.status, 'cancelled')
})

test('unresolved promise expires at the hard deadline, without a new wake or a fictional completion', async () => {
  const row = intent(1, 'follow-up-commitment'); row.payload.expiresAt = now.toISOString()
  const h = harness([row]); await h.defer()
  assert.equal(row.status, 'cancelled'); assert.equal(h.wakes.length, 0)
  assert.equal(row.payload.cancelReason, 'follow-up-commitment-expired')
})

test('unresolved deferral is capped at five checks and cannot wake the model forever', async () => {
  const h = harness([intent(1, 'follow-up-commitment')])
  // A long enough deadline lets the count limit (not expiry) end the test.
  h.rows[0].payload.expiresAt = new Date(now.getTime() + 24 * 60 * minute).toISOString()
  for (let i = 0; i < 5; i++) await h.defer(h.rows, new Set(), new Date(now.getTime() + i * 20 * minute))
  assert.equal(h.rows[0].payload.deferredChecks, 5); assert.equal(h.rows[0].status, 'pending')
  const due = await h.host.dueIntents('s', new Date(now.getTime() + 100 * minute))
  assert.deepEqual(due, []); assert.equal(h.rows[0].status, 'cancelled')
  assert.equal(h.rows[0].payload.cancelReason, 'follow-up-deferred-limit'); assert.equal(h.wakes.length, 5)
})

test('deferral cannot schedule evaluation beyond expiry or resurrect a resolved task', async () => {
  const row = intent(1, 'follow-up-commitment'); row.payload.expiresAt = new Date(now.getTime() + minute).toISOString()
  const h = harness([row]); await h.defer()
  assert.equal(row.notBefore.toISOString(), row.payload.expiresAt)
  const other = intent(2, 'follow-up-commitment'); other.payload.expiresAt = now.toISOString()
  const resolved = harness([other]); await resolved.defer(resolved.rows, new Set([2]))
  assert.equal(resolved.writes.length, 0); assert.equal(resolved.wakes.length, 0)
})

test('explicit rescheduling cannot escape a promise hard deadline', async () => {
  const h = harness([intent(1, 'follow-up-commitment')])
  const result = await h.host.applyFollowUpResolutions('s', 'alice',
    [{ id: 1, outcome: 'rescheduled', notBefore: new Date(now.getTime() + 61 * minute).toISOString() }],
    { reply: { mode: 'immediate', content: '明天再说' } }, now)
  assert.equal(result.size, 0); assert.equal(h.writes.length, 0)
})

function reference() {
  return { commitId: 'c', eventId: 'e', scriptEntryId: 100, eventKind: 'outgoing-message',
    fullContent: 'bubble', bubbleIndex: 1, bubbleCount: 2, causedByEventIds: [] }
}
function ledgerEntry(status = 'pending') {
  return { id: 100, storyId: 's', participantId: '', metadata: { commitId: 'c',
    scriptEvents: [{ commitId: 'c', eventId: 'e', kind: 'outgoing-message', actor: 'protagonist', occurredAt: now.toISOString(),
      causedByEventIds: [], participantId: 'alice', content: 'first<sep/>bubble',
      bubbles: ['first', 'bubble'], deliveryMode: 'immediate' }],
    deliveryActions: [{ commitId: 'c', eventId: 'e', eventKind: 'outgoing-message', status: 'partial', participantId: 'alice',
      segments: [{ kind: 'message', index: 0, content: 'first', status: 'delivered' }, { kind: 'message', index: 1, content: 'bubble', status }] }] } }
}

for (const status of ['delivered', 'cancelled']) {
  test(`a stale pending split with ${status} ledger does not send or create character speech again`, async () => {
    const h = harness([intent(1, 'split-message')]); h.rows[0].payload.scriptEvent = reference()
    h.entries.push(ledgerEntry(status))
    await h.advance(); assert.equal(h.sends.length, 0)
    assert.equal(h.entries.length, 1); assert.equal(h.rows[0].status, status === 'delivered' ? 'completed' : 'cancelled')
  })
}

for (const status of ['pending', 'completed', 'cancelled'] as const) {
  test(`outbox recovery respects ${status} split ownership instead of competing with its sender`, async () => {
    const h = harness([intent(1, 'split-message', 'alice', 5000)])
    h.rows[0].payload.scriptEvent = reference(); h.rows[0].status = status
    const entry = ledgerEntry(); h.entries.push(entry)
    const candidate = h.host.pendingOutgoingDeliveryCandidates(entry)[0]
    const outcome = await h.host.recoverPendingDeliveryCandidate(h.story, candidate)
    assert.equal(h.sends.length, 0); assert.equal(h.entries.length, 1)
    assert.equal(outcome, status === 'completed' ? 'delivered' : status)
    if (status === 'pending') assert.ok(h.wakes.length > 0)
  })
}

test('orphan pending outgoing ledger still uses normal recovery when there is no split owner', async () => {
  const h = harness(); const entry = ledgerEntry(); h.entries.push(entry)
  h.host.confirmOutgoingDeliveries = async (_story: any, messages: any[]) => {
    await h.host.updateScriptDeliveryOutcome('s', messages[0].scriptEvent, 'delivered')
  }
  const outcome = await h.host.recoverPendingDeliveryCandidate(h.story, h.host.pendingOutgoingDeliveryCandidates(entry)[0])
  assert.equal(h.sends.length, 1); assert.equal(outcome, 'delivered')
})


test('split waiting wakes at the promise deadline instead of extending it past a long typing chain', async () => {
  const h = harness([intent(1, 'split-message', 'alice', 90 * minute), intent(2, 'follow-up-commitment')])
  await h.advance()
  assert.equal(h.rows[1].notBefore.toISOString(), h.rows[1].payload.expiresAt)
  assert.equal(h.rows[1].payload.deferredChecks, undefined)
  await h.host.dueIntents('s', h.rows[1].notBefore)
  assert.equal(h.rows[1].status, 'cancelled'); assert.equal(h.calls.length, 0)
})

for (const status of ['delivered', 'cancelled']) {
  test(`standalone split executor reconciles a ${status} segment without a second transport call`, async () => {
    const row = intent(1, 'split-message'); row.notBefore = new Date(0); row.payload.scriptEvent = reference()
    const h = harness([row]); h.entries.push(ledgerEntry(status))
    await h.host.deliverDueSplitSegments('s')
    assert.equal(h.sends.length, 0); assert.equal(h.entries.length, 1)
    assert.equal(row.status, status === 'delivered' ? 'completed' : 'cancelled')
  })
}

test('terminal split preflight safely ignores damaged ledger metadata', async () => {
  const row = intent(1, 'split-message'); row.payload.scriptEvent = reference()
  const h = harness([row]); const entry: any = ledgerEntry()
  entry.metadata.deliveryActions = [null, { commitId: 'c', eventId: 'e', segments: 'broken' }]
  h.entries.push(entry)
  assert.equal(await h.host.reconcileTerminalSplitIntent('s', row, now), false)
  assert.equal(h.writes.length, 0)
})

test('C08 advance cannot complete or retry a split owned by an obsolete generation', async () => {
  const h = harness([intent(1, 'split-message')])
  const generation = h.host.taskGeneration('s')
  h.host.sendOutgoingMessages = async (_s: any, messages: any[]) => { h.sends.push(...messages); h.host.runtimeGeneration++; return messages }
  const result = await methods.advanceUnlocked.call(h.host, structuredClone(h.story), now, false, generation)
  assert.deepEqual(result, [])
  assert.equal(h.sends.length, 1)
  assert.equal(h.entries.filter(e => e.kind === 'character-message').length, 0)
  assert.equal(h.rows[0].status, 'pending')
  assert.equal(h.writes.filter(w => w.table === 'interlude_intent').length, 0)
})
test('C08 split retry cannot overwrite an intent cancelled during transport', async () => {
  const h = harness([intent(1, 'split-message')])
  h.host.sendOutgoingMessages = async () => { h.rows[0].status = 'cancelled'; return [] }
  await h.advance()
  assert.equal(h.rows[0].status, 'cancelled')
  assert.equal(h.rows[0].notBefore.getTime(), now.getTime())
  const retries = h.writes.filter(w => w.table === 'interlude_intent' && w.patch.notBefore)
  assert.ok(retries.every(w => w.query.status === 'pending'))
})
