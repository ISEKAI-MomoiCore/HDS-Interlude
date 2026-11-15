import assert from 'node:assert/strict'
import test from 'node:test'
import { updateScriptDeliveryOutcome } from '../src/delivery/pipeline'
import { appendIntent, dueIntents } from '../src/intents'
import { cancelCommunicationAction } from '../src/console/actions'

const NOW = new Date('2026-11-15T12:00:00Z')
const REF = { commitId: 'c1', eventId: 'e1', scriptEntryId: 1, segmentIndex: 0 }

function deliveryHost() {
  const entry: any = { id: 1, storyId: 's1', metadata: {
    commitId: 'c1', traceId: 'trace1', processingId: 'processing1',
    deliveryActions: [null, { commitId: 'c1', eventId: 'e1', participantId: 'alice', endpointId: 'qq1',
      eventKind: 'outgoing-message', status: 'pending', segments: [{ index: 0, kind: 'message', content: 'hello', status: 'pending' }] }],
  } }
  const logs: any[] = []
  const host: any = {
    dbGet: async () => [entry],
    dbSet: async (_table: string, _query: any, patch: any) => Object.assign(entry, patch),
    reportStandalone: () => undefined,
    reportCommunicationEvent: (...args: any[]) => {
      // The event observes the committed ledger, never an attempted update.
      assert.equal(entry.metadata.deliveryActions[1].segments[0].status, args[5].status)
      logs.push(args[5])
    },
  }
  return { entry, logs, host }
}

function planHost() {
  const intents: any[] = []
  const logs: any[] = []
  const host: any = {
    memoryConfig: { activeConsequenceMaxDays: 7 }, agencyConfig: { enabled: false },
    dbCreate: async (_table: string, value: any) => { const row = { ...value, id: 31 }; intents.push(row); return row },
    dbGet: async (_table: string, query: any) => intents.filter(row => (!query.type || row.type === query.type)
      && (!query.status || row.status === query.status) && (query.id === undefined || row.id === query.id)),
    dbSet: async (_table: string, _query: any, patch: any) => { for (const row of intents) Object.assign(row, patch) },
    retireExpiredFollowUps: async () => [],
    reportCommunicationEvent: (...args: any[]) => { assert.equal(intents[0].status, args[5].status); logs.push(args[5]) },
  }
  return { intents, logs, host }
}

const PLAN: any = { type: 'contact-plan', summary: '稍后问候', notBefore: '2026-11-15T12:01:00Z', payload: {
  traceId: 'trace1', plan: { target: { kind: 'participant', id: 'alice', endpointId: 'qq1' }, expiresAt: '2026-11-15T12:02:00Z' },
} }

test('P5 delivery events follow durable unknown and late success; duplicate or rejected results emit no new event', async () => {
  const { host, logs } = deliveryHost()
  await updateScriptDeliveryOutcome(host, 's1', REF, 'unknown', NOW, 'transport-timeout')
  await updateScriptDeliveryOutcome(host, 's1', REF, 'delivered', NOW)
  await updateScriptDeliveryOutcome(host, 's1', REF, 'failed', NOW, 'late-failure')
  await updateScriptDeliveryOutcome(host, 's1', REF, 'delivered', NOW)
  assert.deepEqual(logs.map(log => log.status), ['unknown', 'delivered'])
  assert.equal(logs[0].type, 'delivery-result')
  assert.equal(logs[0].reasonCode, 'transport-timeout')
  assert.deepEqual([logs[1].commitId, logs[1].eventId, logs[1].segmentIndex, logs[1].targetId, logs[1].endpointId, logs[1].traceId, logs[1].processingId],
    ['c1', 'e1', 0, 'alice', 'qq1', 'trace1', 'processing1'])
})

test('P5 failed ledger writes emit no delivery event; logger errors preserve a committed delivery', async () => {
  const { host, entry, logs } = deliveryHost()
  const save = host.dbSet
  host.dbSet = async () => { throw new Error('db unavailable') }
  await updateScriptDeliveryOutcome(host, 's1', REF, 'unknown', NOW)
  assert.equal(logs.length, 0)
  assert.equal(entry.metadata.deliveryActions[1].status, 'pending')
  host.dbSet = save
  host.reportCommunicationEvent = () => { throw new Error('log unavailable') }
  await updateScriptDeliveryOutcome(host, 's1', REF, 'delivered', NOW)
  assert.equal(entry.metadata.deliveryActions[1].status, 'delivered')
})

test('P5 plan creation emits durable plan identity and correlation; rejected and failed writes emit nothing', async () => {
  const { host, logs } = planHost()
  await appendIntent(host, 's1', { ...PLAN, notBefore: NOW.toISOString() }, NOW, 'alice')
  assert.equal(logs.length, 0)
  await appendIntent(host, 's1', PLAN, NOW, 'alice')
  assert.equal(logs[0].type, 'contact-plan-updated')
  assert.equal(logs[0].intentId, 31)
  assert.equal(logs[0].targetId, 'alice')
  assert.equal(logs[0].endpointId, 'qq1')
  assert.equal(logs[0].traceId, 'trace1')
  assert.equal(logs[0].reasonCode, 'plan-created')
  host.dbCreate = async () => { throw new Error('db unavailable') }
  await assert.rejects(appendIntent(host, 's1', PLAN, NOW, 'alice'), /db unavailable/)
  assert.equal(logs.length, 1)
})

test('P5 expired plans log cancellation after persistence and leave the due batch', async () => {
  const { host, logs, intents } = planHost()
  await appendIntent(host, 's1', PLAN, NOW, 'alice')
  const batch = await dueIntents(host, 's1', new Date('2026-11-15T12:03:00Z'))
  assert.equal(batch.length, 0)
  assert.equal(intents[0].status, 'cancelled')
  assert.deepEqual(logs.map(log => log.reasonCode), ['plan-created', 'plan-expired'])
})

test('P5 Console plan cancellation logs its durable transition once', async () => {
  const { host, logs } = planHost()
  await appendIntent(host, 's1', PLAN, NOW, 'alice')
  assert.equal((await cancelCommunicationAction(host, 'intent:31', NOW)).changed, 1)
  assert.equal((await cancelCommunicationAction(host, 'intent:31', NOW)).changed, 0)
  assert.deepEqual(logs.map(log => log.reasonCode), ['plan-created', 'console-cancel'])
})
