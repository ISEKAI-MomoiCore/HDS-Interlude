import type { OutgoingMessageDraft } from './types'
import { messageEventReference, ScriptEventDraft, ScriptMessageEventReference } from './script/contract'
import { currentDesktopProcessingContext, persistedDesktopProcessingContext } from './processing-context'

export function attachMessageEvent(message: OutgoingMessageDraft, event: ScriptEventDraft | undefined, scriptEntryId?: number): OutgoingMessageDraft {
  const scriptEvent = event ? messageEventReference(event, 0, scriptEntryId) : undefined
  const context = currentDesktopProcessingContext()
  return {
    ...message,
    ...(context && !message.traceId ? { traceId: context.traceId } : {}),
    ...(context && !message.processingId ? { processingId: context.processingId } : {}),
    ...(event?.endpointId && !message.endpointId ? { endpointId: event.endpointId } : {}),
    ...(scriptEvent ? { scriptEvent } : {}),
  }
}

export function prepareOutgoingDelivery(message: OutgoingMessageDraft, bubbles: string[]): OutgoingMessageDraft | undefined {
  const [first, ...later] = bubbles
  if (!first) return undefined
  const scriptEvent = message.scriptEvent
    ? { ...message.scriptEvent, bubbleIndex: 0, bubbleCount: bubbles.length, fullContent: message.scriptEvent.fullContent || message.content }
    : undefined
  return {
    ...message,
    content: first,
    ...(later.length ? { laterSegments: later } : {}),
    ...(scriptEvent ? { scriptEvent } : {}),
  }
}

export function scriptEventPayload(message: OutgoingMessageDraft, bubbleIndex = 0) {
  return {
    ...(message.traceId ? { traceId: message.traceId } : {}),
    ...(message.processingId ? { processingId: message.processingId } : {}),
    ...(message.scriptEvent ? { scriptEvent: { ...message.scriptEvent, bubbleIndex } } : {}),
  }
}

export function restoreDesktopContext(value: unknown): Pick<OutgoingMessageDraft, 'traceId' | 'processingId'> {
  return persistedDesktopProcessingContext(value)
}

export function restoreMessageEvent(value: unknown, content: string): ScriptMessageEventReference | undefined {
  if (!isRecord(value) || !isRecord(value.scriptEvent)) return undefined
  const event = value.scriptEvent
  if (typeof event.commitId !== 'string' || typeof event.eventId !== 'string') return undefined
  if (event.eventKind !== 'outgoing-message' && event.eventKind !== 'group-message') return undefined
  const causedByEventIds = Array.isArray(event.causedByEventIds)
    ? event.causedByEventIds.filter((item): item is string => typeof item === 'string')
    : []
  return {
    commitId: event.commitId,
    eventId: event.eventId,
    ...(typeof event.scriptEntryId === 'number' && Number.isSafeInteger(event.scriptEntryId) ? { scriptEntryId: event.scriptEntryId } : {}),
    eventKind: event.eventKind,
    causedByEventIds,
    ...(typeof event.endpointId === 'string' && event.endpointId ? { endpointId: event.endpointId } : {}),
    fullContent: typeof event.fullContent === 'string' ? event.fullContent : content,
    bubbleIndex: typeof event.bubbleIndex === 'number' && Number.isSafeInteger(event.bubbleIndex) ? event.bubbleIndex : 0,
    bubbleCount: typeof event.bubbleCount === 'number' && Number.isSafeInteger(event.bubbleCount) ? event.bubbleCount : 1,
  }
}

export function deliveryEntryMetadata(message: OutgoingMessageDraft, extra: Record<string, unknown> = {}) {
  return {
    visible: true,
    interaction: message.interaction ?? null,
    ...(message.scriptEvent
      ? { ...message.scriptEvent, bubbleIndex: message.scriptEvent.bubbleIndex ?? 0 }
      : {}),
    ...extra,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
