import { deliveryHost } from './helpers/delivery-host'
import assert from 'node:assert/strict'
import test from 'node:test'
import { attachMessageEvent, prepareOutgoingDelivery, restoreMessageEvent, scriptEventPayload } from '../src/delivery'
import { decisionToScriptCommit, findPrivateOutgoingMessageEvent } from '../src/script/commit-builder'
import {
  createScriptDeliveryActions, deliveryReference, platformActionReference, updateScriptDeliveryActions,
} from '../src/script/delivery-ledger'
import { scriptEntryDraftForCommit } from '../src/turn-persistence'
import { InterludeService } from '../src/service'
import { aggregateDeliveryStatus, ScriptDeliverySegmentStatus } from '../src/script/delivery-ledger'

test('partial requires actual delivery, while unfinished attempts remain pending', () => {
  const status = (...values: ScriptDeliverySegmentStatus[]) => aggregateDeliveryStatus(values.map((status, index) => ({ index, kind: 'message', content: 'text', status })))
  assert.equal(status('failed', 'cancelled'), 'failed')
  assert.equal(status('failed', 'pending'), 'pending')
  assert.equal(status('delivered', 'cancelled'), 'partial')
  assert.equal(status('cancelled', 'cancelled'), 'cancelled')
})

test('ledger read and write failures do not interrupt confirmation or remaining bubble scheduling', async () => {
  for (const failure of ['read', 'write']) {
    const value = commit()
    const event = findPrivateOutgoingMessageEvent(value, 'alice')!
    const intents: any[] = []
    const warnings: any[] = []
    const service: any = {
      serial: async (_id: string, task: () => Promise<any>) => task(),
      getParticipant: async () => ({ id: 'alice' }),
      appendEntry: async () => ({ id: 99 }),
      dbGet: async (table: string, query: any) => {
        if (table === 'interlude_intent' || query.kind) return []
        if (failure === 'read') throw new Error('ledger read failed')
        return [{ id: 42, storyId: 'story:1', metadata: { commitId: value.commitId, deliveryActions: createScriptDeliveryActions(value) } }]
      },
      dbSet: async () => { throw new Error('ledger write failed') },
      reportStandalone: (...args: any[]) => warnings.push(args),
      recordCharacterMessage: async () => undefined,
      typingDelayMilliseconds: () => 100,
      appendIntent: async (_id: string, intent: any) => intents.push(intent),
      scheduleDueIntentWake: () => undefined,
      config: { chatRhythm: { enabled: false } },
      updateScriptDeliveryOutcome: (InterludeService.prototype as any).updateScriptDeliveryOutcome,
    }
    deliveryHost(service)
    const message = prepareOutgoingDelivery(attachMessageEvent({ participantId: 'alice', content: event.content! }, event, 42), event.bubbles!)!
    await (InterludeService.prototype as any).confirmOutgoingDeliveries.call(service, { id: 'story:1' }, [message])
    assert.equal(intents.length, 1)
    assert.equal(intents[0].payload.content, '第二句')
    assert.equal(warnings.length, 1)
  }
})

function commit() {
  return decisionToScriptCommit({
    storyId: 'story:1', participantId: 'alice', phase: 'user-message',
    from: new Date('2026-09-05T10:00:00.000Z'), now: new Date('2026-09-05T10:01:00.000Z'),
    messageSeparator: '<sep/>', splitReplyMessages: true,
    decision: {
      script: '她放下杯子，发来“第一句”，紧接着又发来“第二句”。',
      interaction: { seen: true, reply: { mode: 'immediate', content: '第一句<sep/>第二句' } },
      localMedia: { assetId: 'sticker:cat', willingness: 0.9 },
      nativeFace: { semantic: 'smile', willingness: 0.8 },
      messageReactions: [{ messageRef: 'group-message:7', reaction: 'heart' }],
    } as any,
  })
}

test('M6 ledger groups text and platform segments under their script event identities', () => {
  const value = commit()
  const actions = createScriptDeliveryActions(value)
  const speech = actions.find(item => item.eventKind === 'outgoing-message')!
  const platform = actions.find(item => item.eventKind === 'platform-action')!

  assert.deepEqual(speech.segments.map(item => [item.kind, item.content, item.status]), [
    ['message', '第一句', 'pending'], ['message', '第二句', 'pending'],
  ])
  assert.deepEqual(platform.segments.map(item => [item.kind, item.content]), [
    ['local-media', 'sticker:cat'], ['native-face', 'smile'], ['message-reaction', 'group-message:7:heart'],
  ])
  assert.equal(new Set(actions.map(item => item.commitId)).size, 1)
})

test('M6 ledger reports partial and terminal delivery without downgrading delivered speech', () => {
  const value = commit()
  const event = findPrivateOutgoingMessageEvent(value, 'alice')!
  const initial = createScriptDeliveryActions(value)
  const first = deliveryReference(event, 42, 0)!
  const second = deliveryReference(event, 42, 1)!

  const partial = updateScriptDeliveryActions(initial, first, 'delivered', new Date('2026-09-05T10:01:02.000Z'))!
  assert.equal(partial.find(item => item.eventId === event.eventId)?.status, 'partial')
  const complete = updateScriptDeliveryActions(partial, second, 'delivered', new Date('2026-09-05T10:01:03.000Z'))!
  assert.equal(complete.find(item => item.eventId === event.eventId)?.status, 'delivered')
  assert.equal(updateScriptDeliveryActions(complete, first, 'failed', new Date(), 'late bookkeeping failure'), undefined)
  assert.equal(updateScriptDeliveryActions(complete, second, 'delivered', new Date()), undefined)
})

test('cancelled is terminal: later bookkeeping cannot revive a withdrawn action', () => {
  const value = commit()
  const event = findPrivateOutgoingMessageEvent(value, 'alice')!
  const reference = deliveryReference(event, 42, 0)!
  const cancelled = updateScriptDeliveryActions(createScriptDeliveryActions(value), reference, 'cancelled', new Date('2026-09-05T10:00:00.000Z'), 'delivery-target-unavailable')!
  assert.equal(updateScriptDeliveryActions(cancelled, reference, 'pending', new Date(), 'delivery-unconfirmed-retry-scheduled'), undefined)
  assert.equal(updateScriptDeliveryActions(cancelled, reference, 'delivered', new Date()), undefined)
  const segment = cancelled.find(item => item.eventId === event.eventId)!.segments[0]
  assert.equal(segment.status, 'cancelled')
  assert.equal(segment.reason, 'delivery-target-unavailable')
})

test('returning to pending for a retry clears the previous completion timestamp', () => {
  const value = commit()
  const event = findPrivateOutgoingMessageEvent(value, 'alice')!
  const reference = deliveryReference(event, 42, 0)!
  const failed = updateScriptDeliveryActions(createScriptDeliveryActions(value), reference, 'failed', new Date('2026-09-05T10:00:00.000Z'), 'timeout')!
  const retried = updateScriptDeliveryActions(failed, reference, 'pending', new Date('2026-09-05T10:00:30.000Z'), 'delivery-unconfirmed-retry-scheduled')!
  const segment = retried.find(item => item.eventId === event.eventId)!.segments[0]
  assert.equal(segment.status, 'pending')
  assert.equal(segment.completedAt, undefined)
  assert.equal(segment.reason, 'delivery-unconfirmed-retry-scheduled')
})

test('a successful retry clears an earlier transport failure reason', () => {
  const value = commit()
  const event = findPrivateOutgoingMessageEvent(value, 'alice')!
  const reference = deliveryReference(event, 42, 0)!
  const failed = updateScriptDeliveryActions(createScriptDeliveryActions(value), reference, 'failed', new Date(), 'temporary network failure')!
  const recovered = updateScriptDeliveryActions(failed, reference, 'delivered', new Date())!
  const segment = recovered.find(item => item.eventId === event.eventId)!.segments[0]
  assert.equal(segment.status, 'delivered')
  assert.equal(segment.reason, undefined)
})

test('M6 persistence changes metadata only and delivery preserves exact bubble text and source row', () => {
  const value = commit()
  const draft = scriptEntryDraftForCommit(value, value.events.length ? ({ seen: true, reply: { mode: 'immediate', content: '第一句<sep/>第二句' } } as any) : null)
  assert.equal(draft.content, value.prose)
  assert.deepEqual(draft.metadata?.scriptEvents, value.events)
  assert.ok(Array.isArray(draft.metadata?.deliveryActions))

  const event = findPrivateOutgoingMessageEvent(value, 'alice')!
  const attached = attachMessageEvent({ participantId: 'alice', content: event.content! }, event, 42)
  const prepared = prepareOutgoingDelivery(attached, event.bubbles!)!
  assert.equal(prepared.content, '第一句')
  assert.deepEqual(prepared.laterSegments, ['第二句'])
  const restored = restoreMessageEvent({ ...scriptEventPayload(prepared, 1) }, '第二句')!
  assert.equal(restored.scriptEntryId, 42)
  assert.equal(restored.fullContent, '第一句<sep/>第二句')
})

test('platform references resolve the exact action segment and reject absent actions', () => {
  const value = commit()
  assert.equal(platformActionReference(value, 42, 'local-media', 'sticker:cat')?.segmentIndex, 0)
  assert.equal(platformActionReference(value, 42, 'native-face', 'smile')?.segmentIndex, 1)
  assert.equal(platformActionReference(value, 42, 'message-reaction', 'group-message:7:heart')?.segmentIndex, 2)
  assert.equal(platformActionReference(value, 42, 'local-media', 'missing'), undefined)
})
