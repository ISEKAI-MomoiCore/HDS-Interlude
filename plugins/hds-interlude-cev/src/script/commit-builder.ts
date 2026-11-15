import { createHash } from 'node:crypto'
import type { NarrativeDecision, NarrativePhase } from '../types'
import { reconcileTransportReferences, type AuthoredAction } from './authored-actions'
import {
  isOutgoingScriptEvent, ScriptActionBinding, ScriptCommitDraft, ScriptDeliveryMode, ScriptEventDraft,
} from './contract'

export interface ScriptFirstDecisionInput {
  storyId: string
  participantId?: string
  phase: NarrativePhase
  from: Date
  now: Date
  decision: NarrativeDecision
  messageSeparator?: string
  splitReplyMessages?: boolean
  /** Group output is normalized by the service before it enters this adapter. */
  groupReplyContent?: string
  frameId?: string
  burstId?: string
  startsAfterEventId?: string
}

/**
 * The only beta10 → V2 bridge. It does not call a model or invent narrative
 * decisions; it gives the existing single response stable commit/event ids.
 */
export function decisionToScriptCommit(input: ScriptFirstDecisionInput): ScriptCommitDraft {
  input = { ...input, decision: reconcileTransportReferences(input.decision, false, input.messageSeparator) }
  const participantId = input.participantId?.trim() ?? ''
  const prose = input.decision.script?.trim() ?? ''
  const commitId = stableCommitId(input, participantId, prose)
  const events: ScriptEventDraft[] = []
  const add = (event: Omit<ScriptEventDraft, 'eventId' | 'commitId'>) => {
    const result: ScriptEventDraft = { ...event, commitId, eventId: `${commitId}:e${events.length + 1}` }
    events.push(result)
    return result
  }

  const interaction = input.decision.interaction
  const perceived = input.phase === 'user-message' && interaction?.seen && participantId
    ? add({
        kind: 'message-perceived', actor: 'protagonist', occurredAt: input.now.toISOString(),
        causedByEventIds: [], participantId,
      })
    : undefined
  const narrative = add({
    kind: 'narrative', actor: 'protagonist', occurredAt: input.now.toISOString(),
    causedByEventIds: perceived ? [perceived.eventId] : [], content: prose,
  })
  // 空白 content（模型偶发输出纯空格）不生成消息事件：truthy 检查会放过 ' '，
  // 随后 validator 的空 bubbles 检查将拒绝整个 commit——一条废消息不该炸掉整回合。
  if (interaction?.reply.content?.trim() && (interaction.reply.mode === 'immediate' || interaction.reply.mode === 'delayed')) {
    addMessageEvent(add, {
      participantId,
      content: interaction.reply.content,
      mode: interaction.reply.mode,
      occurredAt: interaction.reply.mode === 'delayed' && interaction.reply.sendAt
        ? interaction.reply.sendAt
        : input.now.toISOString(),
      causedByEventIds: [perceived?.eventId ?? narrative.eventId],
      separator: input.messageSeparator,
      split: input.splitReplyMessages,
      prose,
      actions: input.decision.authoredActions,
    })
  }
  for (const action of input.decision.crossConversationActions ?? []) {
    if (!action.content || (action.mode !== 'immediate' && action.mode !== 'delayed')) continue
    addMessageEvent(add, {
      participantId: action.participantId,
      endpointId: action.endpointId,
      content: action.content,
      mode: action.mode,
      occurredAt: action.mode === 'delayed' && action.sendAt ? action.sendAt : input.now.toISOString(),
      causedByEventIds: [narrative.eventId],
      separator: input.messageSeparator,
      split: input.splitReplyMessages,
      prose,
      actions: input.decision.authoredActions,
    })
  }
  if (input.groupReplyContent) {
    const bubbles = splitBubbles(input.groupReplyContent, input.messageSeparator, input.splitReplyMessages)
    const content = canonicalBubbleContent(input.groupReplyContent, bubbles, input.messageSeparator, input.splitReplyMessages)
    add({
      kind: 'group-message', actor: 'protagonist', occurredAt: input.now.toISOString(),
      causedByEventIds: [narrative.eventId], content,
      bubbles, deliveryMode: 'immediate',
      scriptBinding: bindImmediateMessageAction(prose, bubbles, input.decision.authoredActions),
    })
  }
  if (input.decision.followUpCommitment) {
    add({
      kind: 'follow-up-promise', actor: 'protagonist', occurredAt: input.now.toISOString(),
      causedByEventIds: [narrative.eventId], participantId,
      content: input.decision.followUpCommitment.summary,
      metadata: { notBefore: input.decision.followUpCommitment.notBefore, kind: input.decision.followUpCommitment.kind },
    })
  }
  for (const intent of input.decision.intents ?? []) {
    add({
      kind: 'future-intent', actor: 'protagonist', occurredAt: input.now.toISOString(),
      causedByEventIds: [narrative.eventId], participantId: intent.participantId || participantId,
      content: intent.summary, metadata: { type: intent.type, notBefore: intent.notBefore },
    })
  }
  for (const browser of input.decision.browserIntents ?? []) {
    add({
      kind: 'browser-intent', actor: 'protagonist', occurredAt: input.now.toISOString(),
      causedByEventIds: [narrative.eventId], participantId: browser.participantId || participantId,
      content: browser.purpose, metadata: { mode: browser.mode, timing: browser.timing ?? 'deferred' },
    })
  }
  if (input.decision.localMedia || input.decision.nativeFace || input.decision.messageReactions?.length) {
    add({
      kind: 'platform-action', actor: 'protagonist', occurredAt: input.now.toISOString(),
      causedByEventIds: [narrative.eventId], participantId,
      metadata: {
        ...(input.decision.localMedia ? { localMedia: input.decision.localMedia } : {}),
        ...(input.decision.nativeFace ? { nativeFace: input.decision.nativeFace } : {}),
        ...(input.decision.messageReactions?.length ? { messageReactions: input.decision.messageReactions } : {}),
      },
    })
  }

  return {
    commitId, storyId: input.storyId, participantId, phase: input.phase,
    window: { from: input.from.toISOString(), to: input.now.toISOString() },
    prose, events,
    sceneDelta: {
      frameId: input.frameId ?? '', burstId: input.burstId ?? '',
      ...(input.startsAfterEventId ? { startsAfterEventId: input.startsAfterEventId } : {}),
      proseAppend: prose, eventIds: events.map(event => event.eventId),
    },
    sourceFormat: 'script-first-v1',
  }
}

export function findPrivateOutgoingMessageEvent(
  commit: ScriptCommitDraft,
  participantId: string,
  mode?: ScriptDeliveryMode,
  content?: string,
  separator = '<sep/>',
) {
  return commit.events.find(event => isOutgoingScriptEvent(event)
    && event.kind === 'outgoing-message'
    && event.participantId === participantId
    && (!mode || event.deliveryMode === mode)
    && (content === undefined || event.content === content
      || event.bubbles.join(separator) === splitBubbles(content, separator, true).join(separator)))
}

export function findGroupScriptEvent(commit: ScriptCommitDraft) {
  return commit.events.find(event => isOutgoingScriptEvent(event) && event.kind === 'group-message')
}

function addMessageEvent(
  add: (event: Omit<ScriptEventDraft, 'eventId' | 'commitId'>) => ScriptEventDraft,
  input: {
    participantId: string
    endpointId?: string
    content: string
    mode: ScriptDeliveryMode
    occurredAt: string
    causedByEventIds: string[]
    separator?: string
    split?: boolean
    prose: string
    actions?: AuthoredAction[]
  },
) {
  const bubbles = splitBubbles(input.content, input.separator, input.split)
  add({
    kind: 'outgoing-message', actor: 'protagonist', occurredAt: input.occurredAt,
    causedByEventIds: input.causedByEventIds, participantId: input.participantId,
    ...(input.endpointId ? { endpointId: input.endpointId } : {}),
    content: canonicalBubbleContent(input.content, bubbles, input.separator, input.split),
    bubbles,
    deliveryMode: input.mode,
    scriptBinding: input.mode === 'delayed'
      ? { status: 'future' }
      : bindImmediateMessageAction(input.prose, bubbles, input.actions),
  })
}

/** Bind an immediate transport action to the literal message text in the
 * current script without interpreting prose or adding another model task.
 * Candidates are tiered: a complete quoted segment (“早”/「早」) outranks a
 * bare standalone occurrence, and occurrences inside other words (今早/早饭)
 * never qualify. Equal-tier duplicates stay unbound — the prose mentions the
 * same text twice without singling out a send — while a quote-anchored match
 * beside weaker decoys binds (issue #15: 单字问候被词内巧合否决)。 */
export function bindImmediateMessageAction(prose: string, bubbles: string[], actions: AuthoredAction[] = []): ScriptActionBinding {
  const matching = actions.filter(action => prose.slice(action.start, action.end) === action.content
    && bubbles.every(bubble => action.content.includes(bubble.trim())))
  if (matching.length === 1) {
    const action = matching[0]
    const binding = bindImmediateMessageAction(action.content, bubbles)
    if (binding.status === 'bound') return { ...binding, spans: binding.spans!.map(span => ({
      ...span, start: span.start + action.start, end: span.end + action.start,
    })) }
    return binding
  }
  const spans: Array<{ bubbleIndex: number; start: number; end: number }> = []
  const quotePairs: Array<[string, string]> = [['\u201c', '\u201d'], ['「', '」'], ['『', '』']]
  let ambiguous = false
  let cursor = 0
  for (const [bubbleIndex, rawBubble] of bubbles.entries()) {
    const bubble = rawBubble.trim()
    if (!bubble) return unboundDetail(bubbleIndex, bubble, prose)
    const quoted: number[] = []
    for (const [open, close] of quotePairs) {
      let at = prose.indexOf(open, cursor)
      while (at >= 0) {
        const innerStart = at + open.length
        const closeAt = prose.indexOf(close, innerStart)
        if (closeAt < 0) break
        if (prose.slice(innerStart, closeAt).trim() === bubble) quoted.push(innerStart)
        at = prose.indexOf(open, closeAt + close.length)
      }
    }
    quoted.sort((a, b) => a - b)
    const standalone: number[] = []
    let occurrences = 0
    let at = prose.indexOf(bubble, 0)
    while (at >= 0) {
      occurrences += 1
      const end = at + bubble.length
      if (at >= cursor && isBubbleBoundary(prose[at - 1]) && isBubbleBoundary(prose[end])) standalone.push(at)
      at = prose.indexOf(bubble, at + 1)
    }
    const chosen = quoted.length === 1 ? quoted[0]
      : quoted.length > 1 || standalone.length > 1 ? undefined
      : standalone[0]
    if (chosen === undefined) return unboundDetail(bubbleIndex, bubble, prose, { quoted: quoted.length, standalone: standalone.length, occurrences })
    if (quoted.length === 1 && standalone.length > 1) ambiguous = true
    spans.push({ bubbleIndex, start: chosen, end: chosen + bubble.length })
    cursor = chosen + bubble.length
  }
  return { status: 'bound' as const, spans, ...(ambiguous ? { ambiguous: true } : {}) }
}

function unboundDetail(bubbleIndex: number, bubble: string, prose: string, counts?: { quoted: number, standalone: number, occurrences: number }): ScriptActionBinding {
  const occurrences = bubble ? (counts?.occurrences ?? prose.split(bubble).length - 1) : 0
  return {
    status: 'unbound' as const,
    failed: {
      bubbleIndex,
      bubble: bubble.length > 16 ? `${bubble.slice(0, 16)}…` : bubble,
      quoted: counts?.quoted ?? 0,
      standalone: counts?.standalone ?? 0,
      occurrences,
    },
  }
}

/** Message-grade edges: string boundaries, quotes, punctuation, symbols and
 * whitespace. A CJK ideograph (今 before 早) is not an edge, so word-internal
 * hits never become candidates. */
const isBubbleBoundary = (char: string | undefined): boolean =>
  char === undefined || /[\p{P}\p{S}\s]/u.test(char)

export function unboundImmediateMessageEvents(commit: ScriptCommitDraft) {
  return commit.events.filter(event => isOutgoingScriptEvent(event)
    && event.deliveryMode === 'immediate'
    && event.scriptBinding?.status !== 'bound')
}

function canonicalBubbleContent(content: string, bubbles: string[], separator = '<sep/>', enabled = true) {
  return enabled ? bubbles.join(separator || '<sep/>') : content
}

function splitBubbles(content: string, separator = '<sep/>', enabled = true) {
  if (!enabled || !separator || !content.includes(separator)) return [content]
  const bubbles = content.split(separator).map(item => item.trim()).filter(Boolean)
  return bubbles.length ? bubbles : [content]
}

function stableCommitId(input: ScriptFirstDecisionInput, participantId: string, prose: string) {
  const semanticPayload = {
    participantId,
    prose,
    interaction: input.decision.interaction ?? null,
    groupReplyContent: input.groupReplyContent ?? '',
    crossConversationActions: input.decision.crossConversationActions ?? [],
    intents: input.decision.intents ?? [],
    browserIntents: input.decision.browserIntents ?? [],
    followUpCommitment: input.decision.followUpCommitment ?? null,
    messageReactions: input.decision.messageReactions ?? [],
    localMedia: input.decision.localMedia ?? null,
    nativeFace: input.decision.nativeFace ?? null,
    frameId: input.frameId ?? '',
    burstId: input.burstId ?? '',
    startsAfterEventId: input.startsAfterEventId ?? '',
  }
  const digest = createHash('sha256')
    .update([input.storyId, input.phase, input.from.toISOString(), input.now.toISOString(), JSON.stringify(semanticPayload)].join('\u001f'))
    .digest('hex')
    .slice(0, 20)
  return `commit:${digest}`
}
