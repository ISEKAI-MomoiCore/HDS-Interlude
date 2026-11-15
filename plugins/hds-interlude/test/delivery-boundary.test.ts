import assert from 'node:assert/strict'
import test from 'node:test'
import { attachMessageEvent, deliveryEntryMetadata, prepareOutgoingDelivery, restoreDesktopContext, restoreMessageEvent, scriptEventPayload } from '../src/delivery'
import { desktopProcessingContext } from '../src/processing-context'
import { ScriptEventDraft } from '../src/script/contract'

test('all bubbles retain the script event identity across delivery intents and receipts', () => {
  const event: ScriptEventDraft = {
    commitId: 'commit:x', eventId: 'commit:x:e2', kind: 'outgoing-message', actor: 'protagonist',
    occurredAt: '2026-09-04T00:00:00.000Z', causedByEventIds: ['commit:x:e1'], participantId: 'alice',
    content: '第一句<sep/>第二句', bubbles: ['第一句', '第二句'], deliveryMode: 'immediate',
  }
  const attached = attachMessageEvent({ participantId: 'alice', content: event.content! }, event)
  const prepared = prepareOutgoingDelivery(attached, event.bubbles!)
  assert.equal(prepared?.content, '第一句')
  assert.deepEqual(prepared?.laterSegments, ['第二句'])
  assert.equal(prepared?.scriptEvent?.bubbleCount, 2)

  const payload = { content: '第二句', ...scriptEventPayload(prepared!, 1) }
  const restored = restoreMessageEvent(payload, '第二句')
  assert.equal(restored?.eventId, event.eventId)
  assert.equal(restored?.bubbleIndex, 1)
  assert.equal(restored?.fullContent, event.content)
  assert.equal(deliveryEntryMetadata({ participantId: 'alice', content: '第二句', scriptEvent: restored }).eventId, event.eventId)
})


test('typ-0 correlation survives persisted split-message payloads and async context ends cleanly', async () => {
  const context = { traceId: 'msg-live-round', processingId: 'proc-live-round' }
  const message = await desktopProcessingContext.run(context, async () => {
    await Promise.resolve()
    return attachMessageEvent({ participantId: 'alice', content: '第一句<sep/>第二句' }, undefined)
  })
  const first = prepareOutgoingDelivery(message, ['第一句', '第二句'])!
  const persistedPayload = { content: '第二句', ...scriptEventPayload(first, 1) }
  assert.equal(persistedPayload.traceId, context.traceId)
  assert.equal(persistedPayload.processingId, context.processingId)
  assert.deepEqual(restoreDesktopContext(persistedPayload), context)
  assert.equal(desktopProcessingContext.getStore(), undefined)
})
