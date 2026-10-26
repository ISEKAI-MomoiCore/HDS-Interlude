import type { NarrativePhase } from '../types'

export type ScriptEventKind =
  | 'narrative'
  | 'message-perceived'
  | 'outgoing-message'
  | 'group-message'
  | 'future-intent'
  | 'browser-intent'
  | 'follow-up-promise'
  | 'platform-action'

export type ScriptDeliveryMode = 'immediate' | 'delayed'

export interface ScriptActionBinding {
  /** Immediate actions bind to literal message spans in the authoritative
   * prose. Delayed actions have not happened inside the current window yet. */
  status: 'bound' | 'unbound' | 'future'
  spans?: Array<{ bubbleIndex: number; start: number; end: number }>
  /** Bound text also had weaker standalone occurrences elsewhere; spans are
   * audit-only so the quote-anchored (or sole) occurrence stays authoritative. */
  ambiguous?: boolean
  /** Diagnostic detail for the first bubble that could not be located safely. */
  failed?: { bubbleIndex: number, bubble: string, quoted: number, standalone: number, occurrences: number }
}

export interface ScriptEventDraft {
  eventId: string
  commitId: string
  kind: ScriptEventKind
  actor: 'protagonist' | 'system'
  occurredAt: string
  causedByEventIds: string[]
  participantId?: string
  /** M4: selected transport endpoint is part of the authored event, not only the runtime draft. */
  endpointId?: string
  content?: string
  bubbles?: string[]
  deliveryMode?: ScriptDeliveryMode
  scriptBinding?: ScriptActionBinding
  metadata?: Record<string, unknown>
}

export interface ScriptCommitDraft {
  commitId: string
  storyId: string
  participantId: string
  phase: NarrativePhase
  window: { from: string; to: string }
  prose: string
  events: ScriptEventDraft[]
  /** M4 append identity: the message and prose remain one scene delta. */
  sceneDelta: {
    frameId: string
    burstId: string
    startsAfterEventId?: string
    proseAppend: string
    eventIds: string[]
  }
  sourceFormat: 'beta10' | 'script-first-v1'
}

export interface ScriptMessageEventReference {
  commitId: string
  eventId: string
  /** Source script row containing the authoritative commit and delivery ledger. */
  scriptEntryId?: number
  eventKind: 'outgoing-message' | 'group-message'
  causedByEventIds: string[]
  endpointId?: string
  fullContent: string
  bubbleIndex: number
  bubbleCount: number
}

export function isOutgoingScriptEvent(event: ScriptEventDraft): event is ScriptEventDraft & {
  kind: 'outgoing-message' | 'group-message'
  content: string
  bubbles: string[]
  deliveryMode: ScriptDeliveryMode
} {
  return (event.kind === 'outgoing-message' || event.kind === 'group-message')
    && typeof event.content === 'string'
    && Array.isArray(event.bubbles)
    && (event.deliveryMode === 'immediate' || event.deliveryMode === 'delayed')
}

export function messageEventReference(event: ScriptEventDraft, bubbleIndex = 0, scriptEntryId?: number): ScriptMessageEventReference | undefined {
  if (!isOutgoingScriptEvent(event)) return undefined
  return {
    commitId: event.commitId,
    eventId: event.eventId,
    ...(Number.isSafeInteger(scriptEntryId) ? { scriptEntryId } : {}),
    eventKind: event.kind,
    causedByEventIds: [...event.causedByEventIds],
    ...(event.endpointId ? { endpointId: event.endpointId } : {}),
    fullContent: event.content,
    bubbleIndex,
    bubbleCount: event.bubbles.length,
  }
}
