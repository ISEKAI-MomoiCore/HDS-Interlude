import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { updateScriptDeliveryActions } from '../src/script/delivery-ledger'
import { deliveryHost } from './helpers/delivery-host'

const proto = InterludeService.prototype as any
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function fixture(target = 'p', count = 1) {
  const source: any = { id: 1, storyId: 's', participantId: '', kind: 'script', metadata: { commitId: 'c',
    scriptEvents: [{ kind: 'outgoing-message', commitId: 'c', eventId: 'e', participantId: target,
      content: Array.from({ length: count }, (_, i) => `bubble-${i}`).join('<sep/>'),
      bubbles: Array.from({ length: count }, (_, i) => `bubble-${i}`), deliveryMode: 'immediate', causedByEventIds: [], metadata: {} }],
    deliveryActions: [{ commitId: 'c', eventId: 'e', eventKind: 'outgoing-message', participantId: target, status: 'pending',
      segments: Array.from({ length: count }, (_, index) => ({ index, kind: 'message', content: `bubble-${index}`, status: 'pending' })) }],
  } }
  const receipts: any[] = [], intents: any[] = [], sent: string[] = []
  const story = { id: 's', status: 'active' }
  const host: any = deliveryHost({
    config: { chatRhythm: { enabled: false }, onebot: { groupChats: [{ groupId: '123', enabled: true }] } },
    getStory: async () => story, inSerial: () => false, serial: async (_id: string, task: any) => task(),
    getParticipant: async (id: string) => ({ id, status: 'active' }),
    recordCharacterMessage: async () => {}, typingDelayMilliseconds: () => 10,
    recordAutomaticDelivery: async () => {}, reportStandalone: () => {}, report: () => {},
    interruptedTypingParticipants: new Set<string>(),
    appendIntent: async (_s: string, draft: any) => { intents.push({ id: intents.length + 1, ...draft, participantId: target }) },
    scheduleDueIntentWake: () => {}, scheduleNextSplitWake: async () => {},
    dbGet: async (table: string, query: any) => {
      if (table === 'interlude_intent') return intents.filter(row => !query.id || row.id === query.id)
      if (table !== 'interlude_script_entry') return []
      if (!query.kind) return query.id === source.id ? [structuredClone(source)] : []
      return receipts.filter(row => row.metadata.scriptEntryId === query['metadata.scriptEntryId']
        && row.metadata.commitId === query['metadata.commitId'] && row.metadata.eventId === query['metadata.eventId'])
    },
    dbSet: async (_table: string, _query: any, patch: any) => { source.metadata = patch.metadata },
    appendEntry: async (_s: string, draft: any) => { const row = { id: receipts.length + 10, ...draft }; receipts.push(row); return row },
    sendOutgoingMessages: async (_s: any, messages: any[]) => { sent.push(...messages.map(item => item.content)); return messages },
  })
  for (const name of ['updateScriptDeliveryOutcome', 'pendingOutgoingDeliveryCandidates', 'pendingDeliveryRecoveryKey', 'recoverPendingDeliveryCandidate', 'sendCrossGroupMessage']) host[name] = proto[name]
  const message = (index = 0, content = `bubble-${index}`): any => ({ participantId: target, content,
    scriptEvent: { scriptEntryId: 1, commitId: 'c', eventId: 'e', eventKind: 'outgoing-message', bubbleIndex: index } })
  return { host, source, story, receipts, intents, sent, message }
}

test('C01 transport and receipt waits retain exclusive event ownership against recovery', async () => {
  for (const stage of ['transport', 'receipt']) {
    const f = fixture(), waiting = deferred()
    if (stage === 'transport') f.host.sendOutgoingMessages = async (_s: any, messages: any[]) => { f.sent.push(messages[0].content); await waiting.promise; return messages }
    else {
      const append = f.host.appendEntry
      f.host.appendEntry = async (...args: any[]) => { await waiting.promise; return append(...args) }
    }
    const normal = f.host.deliverOutgoingMessages(f.story, [f.message()])
    await tick()
    const candidate = f.host.pendingOutgoingDeliveryCandidates(f.source)[0]
    assert.equal(await f.host.recoverPendingDeliveryCandidate(f.story, candidate), 'pending')
    assert.equal(f.sent.length, 1)
    waiting.resolve()
    await normal
    assert.equal(f.receipts.length, 1)
    assert.equal(f.source.metadata.deliveryActions[0].segments[0].status, 'delivered')
    assert.equal(f.host.deliveryExecutors.size, 0)
  }
})

test('C03 group-authored cross-private delivery creates one receipt and settles ledger', async () => {
  const f = fixture()
  await f.host.deliverOutgoingMessages(f.story, [f.message()])
  await f.host.deliverOutgoingMessages(f.story, [f.message()])
  assert.deepEqual(f.sent, ['bubble-0'])
  assert.equal(f.receipts.length, 1)
  assert.equal(f.receipts[0].kind, 'character-message')
  assert.equal(f.source.metadata.deliveryActions[0].status, 'delivered')
})

test('C04 persisted success plus failed ledger reconciles after service restart without transport', async () => {
  const f = fixture(), write = f.host.dbSet
  f.host.dbSet = async () => { throw new Error('disk failure') }
  await f.host.deliverOutgoingMessages(f.story, [f.message()])
  assert.equal(f.source.metadata.deliveryActions[0].status, 'pending')
  assert.equal(f.receipts.length, 1)
  f.host.acceptedDeliveries.clear() // process memory lost; durable receipt remains
  f.host.dbSet = write
  await f.host.deliverOutgoingMessages(f.story, [f.message()])
  assert.equal(f.sent.length, 1)
  assert.equal(f.receipts.length, 1)
  assert.equal(f.source.metadata.deliveryActions[0].status, 'delivered')
})

test('C04 receipt insertion failure keeps accepted result; cancellation does not erase actual success', async () => {
  const f = fixture(), append = f.host.appendEntry
  f.host.appendEntry = async () => { throw new Error('receipt failure') }
  await assert.rejects(f.host.deliverOutgoingMessages(f.story, [f.message()]), /receipt failure/)
  assert.equal(f.host.acceptedDeliveries.size, 1)
  f.source.metadata.deliveryActions = updateScriptDeliveryActions(f.source.metadata.deliveryActions,
    { ...f.message().scriptEvent, segmentIndex: 0 }, 'cancelled', new Date())
  f.host.appendEntry = append
  await f.host.deliverOutgoingMessages(f.story, [f.message()])
  assert.equal(f.sent.length, 1)
  assert.equal(f.receipts.length, 1)
  assert.equal(f.host.acceptedDeliveries.size, 0)
})

function groupTransport(f: ReturnType<typeof fixture>, failIndex?: number) {
  f.host.sendGroupMessage = async (_s: any, _g: any, text: string, _reply: any, _session: any, _endpoint: any, _correlation: any, controls: any) => {
    const outcomes: any[] = []
    for (const [index, content] of text.split('<sep/>').entries()) {
      let status = controls.settled.get(index)
      if (!status) {
        f.sent.push(content)
        status = index === failIndex ? 'failed' : 'delivered'
        if (status === 'delivered') controls.onDelivered(index, content)
      }
      outcomes.push({ index, content, status })
    }
    return { segmentOutcomes: outcomes, deliveredSegments: outcomes.filter(item => item.status === 'delivered').map(item => item.content), complete: outcomes.every(item => item.status === 'delivered') }
  }
}

test('C02 recovering group bubble 2 preserves original index in receipt and ledger', async () => {
  const f = fixture('group:123', 3)
  groupTransport(f)
  await f.host.deliverOutgoingMessages(f.story, [f.message(2)])
  assert.deepEqual(f.receipts[0].metadata.deliverySegmentIndexes, [2])
  assert.deepEqual(f.source.metadata.deliveryActions[0].segments.map((s: any) => s.status), ['pending', 'pending', 'delivered'])
})

test('C01/C02/C04 partial group retries reconcile accepted segments without resending them', async () => {
  const f = fixture('group:123', 3), append = f.host.appendEntry
  groupTransport(f, 1)
  f.host.appendEntry = async () => { throw new Error('group receipt failure') }
  await assert.rejects(f.host.deliverOutgoingMessages(f.story, [f.message(0, 'bubble-0<sep/>bubble-1<sep/>bubble-2')], undefined, undefined, undefined, true, undefined, 'pending'), /group receipt failure/)
  assert.deepEqual(f.sent, ['bubble-0', 'bubble-1', 'bubble-2'])
  f.host.appendEntry = append
  groupTransport(f)
  await f.host.deliverOutgoingMessages(f.story, [f.message(0, 'bubble-0<sep/>bubble-1<sep/>bubble-2')], undefined, undefined, undefined, true, undefined, 'pending')
  assert.deepEqual(f.sent, ['bubble-0', 'bubble-1', 'bubble-2', 'bubble-1'])
  assert.equal(f.receipts.length, 1)
  assert.deepEqual(f.receipts[0].metadata.deliverySegmentIndexes, [0, 1, 2])
  assert.equal(f.source.metadata.deliveryActions[0].status, 'delivered')
  assert.equal(f.host.acceptedDeliveries.size, 0)
})

test('C08 paused delivery does not send; resume recovers; reset during transport never resurrects receipt', async () => {
  const f = fixture()
  f.host.desktopRuntimePhase = 'paused'
  assert.deepEqual(await f.host.deliverOutgoingMessages(f.story, [f.message()]), [])
  assert.equal(f.sent.length, 0)
  f.host.desktopRuntimePhase = 'running'
  await f.host.deliverOutgoingMessages(f.story, [f.message()])
  assert.equal(f.sent.length, 1)
  const g = fixture(), waiting = deferred()
  g.host.sendOutgoingMessages = async (_s: any, messages: any[]) => { await waiting.promise; return messages }
  const run = g.host.deliverOutgoingMessages(g.story, [g.message()])
  await tick()
  g.host.runtimeGeneration++
  waiting.resolve()
  assert.deepEqual(await run, [])
  assert.equal(g.receipts.length, 0)
  assert.equal(g.host.acceptedDeliveries.size, 0)
})

test('C08 reset while success confirmation is waiting for story serial cannot append old receipt', async () => {
  const f = fixture(), waiting = deferred()
  f.host.serial = async (_s: string, task: any) => { await waiting.promise; return task() }
  const confirmation = f.host.confirmOutgoingDeliveries(f.story, [f.message()])
  await tick()
  f.host.runtimeGeneration++
  waiting.resolve()
  assert.deepEqual(await confirmation, [])
  assert.equal(f.receipts.length, 0)
})

test('split reconciliation preserves terminal intent ownership and schedules later bubbles only once', async () => {
  const f = fixture('p', 3)
  const msg = { ...f.message(), laterSegments: ['bubble-1', 'bubble-2'] }
  await f.host.deliverOutgoingMessages(f.story, [msg])
  f.source.metadata.deliveryActions[0].segments[0].status = 'pending'
  await f.host.deliverOutgoingMessages(f.story, [msg])
  assert.equal(f.intents.length, 2)
  f.intents[0].status = 'cancelled'
  const candidate = f.host.pendingOutgoingDeliveryCandidates(f.source).find((item: any) => item.segmentIndex === 1)
  assert.equal(await f.host.recoverPendingDeliveryCandidate(f.story, candidate), 'cancelled')
  assert.equal(f.source.metadata.deliveryActions[0].segments[1].status, 'cancelled')
  assert.equal(f.sent.length, 1)
})

test('early reply confirmation output comes from the shared entrance without a second append', async () => {
  const f = fixture(), confirmed: any[] = []
  await f.host.deliverOutgoingMessages(f.story, [f.message()], undefined, undefined, undefined, true, undefined, 'failed', false, confirmed)
  assert.equal(confirmed.length, 1)
  assert.equal(confirmed[0].id, f.receipts[0].id)
  assert.equal(f.receipts.length, 1)
})

test('C04 group accepted success survives cancelled ledger and releases memory after durable receipt', async () => {
  const f = fixture('group:123'), append = f.host.appendEntry
  groupTransport(f)
  f.host.appendEntry = async () => { throw Error('receipt failure') }
  await assert.rejects(f.host.deliverOutgoingMessages(f.story, [f.message()]), /receipt failure/)
  assert.equal(f.host.acceptedDeliveries.size, 1)
  f.source.metadata.deliveryActions = updateScriptDeliveryActions(f.source.metadata.deliveryActions,
    { ...f.message().scriptEvent, segmentIndex: 0 }, 'cancelled', new Date())
  f.host.appendEntry = append
  await f.host.deliverOutgoingMessages(f.story, [f.message()])
  assert.deepEqual(f.sent, ['bubble-0'])
  assert.equal(f.receipts.length, 1)
  assert.equal(f.host.acceptedDeliveries.size, 0)
  await f.host.deliverOutgoingMessages(f.story, [f.message()])
  assert.equal(f.sent.length, 1)
})
test('C08 persisted group delivery with missing source cannot bypass the private-path source guard', async () => {
  const f = fixture('group:123')
  groupTransport(f)
  f.host.dbGet = async () => []
  assert.deepEqual(await f.host.deliverOutgoingMessages(f.story, [f.message()]), [])
  assert.equal(f.sent.length, 0); assert.equal(f.receipts.length, 0)
  assert.equal(f.host.deliveryExecutors.size, 0)
})

function installRuntimePhase(f: ReturnType<typeof fixture>) {
  Object.assign(f.host, {
    desktopRuntimePhase: 'running', scheduler: { cancelWakes: () => {} },
    turnEngine: { turns: new Map(), rescheduleTimers: () => {} }, bufferedGroupTurns: new Map(),
    desktopRuntimeSnapshot: async () => ({}),
  })
  f.host.setDesktopRuntimePhase = proto.setDesktopRuntimePhase
}

test('C04/C08 actual pause/resume preserves in-flight acceptance but stops remaining old-task bubbles', async () => {
  const f = fixture('p', 2), gate = deferred()
  installRuntimePhase(f)
  f.host.sendOutgoingMessages = async (_s: any, messages: any[]) => { f.sent.push(messages[0].content); await gate.promise; return messages }
  const generation = f.host.taskGeneration('s')
  const run = f.host.deliverOutgoingMessages(f.story, [f.message(), f.message(1)])
  await tick()
  await f.host.setDesktopRuntimePhase('paused')
  await f.host.setDesktopRuntimePhase('running')
  assert.equal(f.host.taskGenerationCurrent('s', generation), false)
  gate.resolve()
  await run
  assert.deepEqual(f.sent, ['bubble-0'])
  assert.equal(f.receipts.length, 1)
  assert.equal(f.source.metadata.deliveryActions[0].segments[0].status, 'delivered')
  assert.equal(f.source.metadata.deliveryActions[0].segments[1].status, 'pending')
  await f.host.deliverOutgoingMessages(f.story, [f.message(), f.message(1)])
  assert.deepEqual(f.sent, ['bubble-0', 'bubble-1'])
  assert.equal(f.receipts.length, 2)
})

test('C04/C08 receipt confirmation waiting for story serial survives actual pause, not purge', async () => {
  for (const purge of [false, true]) {
    const f = fixture(), gate = deferred()
    installRuntimePhase(f)
    f.host.serial = async (_s: string, task: any) => { await gate.promise; return task() }
    const run = f.host.confirmOutgoingDeliveries(f.story, [f.message()])
    await tick()
    await f.host.setDesktopRuntimePhase('paused')
    if (purge) proto.invalidateStoryTasks.call(f.host, 's')
    gate.resolve()
    await run
    assert.equal(f.receipts.length, purge ? 0 : 1)
  }
})

test('C04/C08 group pause records accepted bubble and keeps unstarted bubbles pending until resume', async () => {
  const f = fixture('group:123', 3), gate = deferred()
  installRuntimePhase(f)
  f.host.sendGroupMessage = async (_s: any, _g: any, text: string, _r: any, _session: any, _endpoint: any, _correlation: any, control: any) => {
    const segmentOutcomes: any[] = []
    for (const [index, content] of text.split('<sep/>').entries()) {
      if (control.shouldCancel()) { segmentOutcomes.push({ index, content, status: 'failed', reason: 'delivery-generation-obsolete' }); continue }
      f.sent.push(content)
      await gate.promise
      control.onDelivered(index, content)
      segmentOutcomes.push({ index, content, status: 'delivered' })
    }
    return { segmentOutcomes, deliveredSegments: segmentOutcomes.filter(s => s.status === 'delivered').map(s => s.content), complete: segmentOutcomes.every(s => s.status === 'delivered') }
  }
  const run = f.host.deliverOutgoingMessages(f.story, [f.message(0, 'bubble-0<sep/>bubble-1<sep/>bubble-2')])
  await tick()
  await f.host.setDesktopRuntimePhase('paused')
  gate.resolve()
  await run
  assert.deepEqual(f.sent, ['bubble-0'])
  assert.deepEqual(f.source.metadata.deliveryActions[0].segments.map((s: any) => s.status), ['delivered', 'pending', 'pending'])
  assert.deepEqual(f.receipts[0].metadata.deliverySegmentIndexes, [0])
  await f.host.setDesktopRuntimePhase('running')
  groupTransport(f)
  await f.host.deliverOutgoingMessages(f.story, [f.message(0, 'bubble-0<sep/>bubble-1<sep/>bubble-2')])
  assert.deepEqual(f.sent, ['bubble-0', 'bubble-1', 'bubble-2'])
  assert.equal(f.host.acceptedDeliveries.size, 0)
})

test('C08 pause/reset after owner lookup prevents obsolete terminal-ledger reconciliation', async () => {
  const f = fixture(), gate = deferred(), read = f.host.dbGet
  installRuntimePhase(f)
  f.intents.push({ id: 1, status: 'completed', type: 'split-message', payload: { content: 'bubble-0', ...f.message().scriptEvent } })
  f.host.dbGet = async (table: string, query: any) => {
    if (table === 'interlude_intent') { await gate.promise; return f.intents }
    return read(table, query)
  }
  const candidate = f.host.pendingOutgoingDeliveryCandidates(f.source)[0]
  const run = f.host.recoverPendingDeliveryCandidate(f.story, candidate)
  await tick()
  await f.host.setDesktopRuntimePhase('paused')
  gate.resolve()
  assert.equal(await run, 'pending')
  assert.equal(f.source.metadata.deliveryActions[0].segments[0].status, 'pending')
  assert.equal(f.sent.length, 0)
})
