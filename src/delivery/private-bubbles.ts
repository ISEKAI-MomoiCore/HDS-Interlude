import { restoreDesktopContext, restoreMessageEvent, scriptEventPayload } from '../delivery'
import { normalizeInteraction, splitVisibleReplyBubbles } from '../narrative-normalizers'
import type { RuntimeConfig } from '../service'
import type { ScriptDeliveryAction } from '../script/delivery-ledger'
import type { TurnHandle } from '../turn-engine'
import type { InterludeParticipant, InterludeStory, NarrativeDecision, NarrativeIntent, NarrativeRequest, OutgoingMessageDraft, ScriptEntry } from '../types'

// Keep relative deadlines representable by the JS/Koishi timer. This is not a writing target.
const maximumWaitMs = 2_147_483_647

export function firstPrivateBubbleDueAt(startedAt: Date, availableAt: Date, waitMs: number) {
  return new Date(Math.max(availableAt.getTime(), startedAt.getTime() + waitMs))
}

/** Match the actual transport segmentation, including the operator's newline setting. */
export function validatePrivateBubbleDelay(decision: NarrativeDecision, now: Date, runtime: RuntimeConfig) {
  const reply = normalizeInteraction(decision.interaction, now, runtime)?.reply
  if (reply?.mode !== 'immediate' || !reply.content) return { valid: true } as const
  const bubbles = splitPrivateBubbleContent(reply.content, runtime)
  const values = reply.bubbleDelaySeconds
  if (!Array.isArray(values) || values.length !== bubbles.length || !Array.from(values).every(value =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value * 1000 <= maximumWaitMs)) {
    return { valid: false, bubbleCount: bubbles.length } as const
  }
  return { valid: true, immediate: true } as const
}

export function splitPrivateBubbleContent(content: string, runtime: RuntimeConfig) {
  return splitVisibleReplyBubbles(content, {
    separator: runtime.messageSeparator, splitEnabled: runtime.splitReplyMessages !== false,
    newlineAsSeparator: runtime.convertNewlineToSeparator === true,
  })
}

interface PrivateBubble { content: string; waitMs: number }
interface PrivateBubblePlan { bubbles: PrivateBubble[]; nextIndex: number; attempting?: true }
export interface PrivateBubbleInterruption {
  sourceAction: { commitId: string; eventId: string; scriptEntryId: number }
  interruptedAt: string
  triggerMessageIndex?: number
  deliveredBubbleIndexes: number[]
  cancelledBubbles: Array<{ bubbleIndex: number; content: string }>
  confirmedBubbles: Array<{ bubbleIndex: number; content: string; deliveredAt?: string }>
  unresolvedBubbleIndexes: number[]
}

export function privateBubblePlan(intent: NarrativeIntent): PrivateBubblePlan | undefined {
  return intent.type === 'split-message' ? intent.payload?.privateBubblePlan as PrivateBubblePlan | undefined : undefined
}

interface Attempt { handedOff: boolean; cancelled: boolean }
interface LiveRoute { participant: InterludeParticipant; handle: TurnHandle }
interface Runtime { attempts: Map<number, Attempt>; routes: Map<number, LiveRoute> }
const runtimes = new WeakMap<object, Runtime>()
function runtimeFor(svc: object) {
  let runtime = runtimes.get(svc)
  if (!runtime) {
    runtime = { attempts: new Map(), routes: new Map() }
    runtimes.set(svc, runtime)
  }
  return runtime
}

export function privateBubbleBusy(svc: object, intent: NarrativeIntent) {
  return runtimes.get(svc)?.attempts.has(intent.id) === true
}

export interface PrivateBubbleCommitOptions {
  startedAt: Date
  handle?: TurnHandle
  sourceEndpointId?: string
  onCommitted(): void
}

/** Persist the group alongside its script entry. Only the head has a deadline. */
export async function persistPrivateBubbleGroup(svc: any, story: InterludeStory, participant: InterludeParticipant,
  message: OutgoingMessageDraft, startedAt: Date, endpointId?: string): Promise<NarrativeIntent> {
  const delays = message.interaction?.reply.bubbleDelaySeconds
  // persistDecision already split the transport draft; its content now contains only the head.
  const contents = [message.content, ...(message.laterSegments ?? [])]
  const ref = message.scriptEvent
  if (!ref?.scriptEntryId || !delays || delays.length !== contents.length || ref.bubbleCount !== contents.length) {
    throw new Error('Cannot stage private bubbles without the validated action and matching ledger.')
  }
  const bubbles = contents.map((content, index) => ({
    content, waitMs: Math.max(Math.round(delays[index] * 1000), svc.typingDelayMilliseconds(content)),
  }))
  const now = new Date()
  const notBefore = firstPrivateBubbleDueAt(startedAt, now, bubbles[0].waitMs)
  const sourceEndpointId = svc.endpointRows?.find((row: { id: string; ownerKind: string; ownerId: string }) =>
    row.id === endpointId && row.ownerKind === 'participant-user' && row.ownerId === participant.id)?.id
  // A ready head is allowed at `now` (the generic future-intent helper rejects it).
  return svc.dbCreate('interlude_intent', {
    storyId: story.id, participantId: participant.id, type: 'split-message', status: 'pending',
    summary: 'A private message has bubbles waiting to be sent.', notBefore, createdAt: now, updatedAt: now,
    payload: {
      ...scriptEventPayload(message), privateBubblePlan: { bubbles, nextIndex: 0 },
      userInitiated: message.userInitiated === true,
      ...(sourceEndpointId ? { sourceEndpointId } : {}),
    },
  })
}

export function activatePrivateBubbleGroup(svc: any, intent: NarrativeIntent, participant: InterludeParticipant, handle?: TurnHandle) {
  if (handle) runtimeFor(svc).routes.set(intent.id, { participant, handle })
  svc.scheduleDueIntentWake(intent.storyId, intent.notBefore)
}

async function readAction(svc: any, storyId: string, intent: NarrativeIntent) {
  const ref = restoreMessageEvent(intent.payload, '')
  if (!ref?.scriptEntryId) return {}
  const entry = (await svc.dbGet('interlude_script_entry', { storyId, id: ref.scriptEntryId }))[0] as ScriptEntry | undefined
  const actions = entry?.metadata?.deliveryActions as ScriptDeliveryAction[] | undefined
  const action = actions?.find(item => item.commitId === ref.commitId && item.eventId === ref.eventId)
  return { ref, action }
}

/** Called within the inbound transaction. The live handoff check and this cancellation
 * share a synchronous token, so an awaited endpoint lookup cannot leak another bubble. */
export async function interruptPrivateBubbleGroup(svc: any, storyId: string, intent: NarrativeIntent, now: Date) {
  const plan = privateBubblePlan(intent)!
  const runtime = runtimeFor(svc)
  const attempt = runtime.attempts.get(intent.id)
  if (attempt) attempt.cancelled = true
  runtime.routes.delete(intent.id)
  const { ref, action } = await readAction(svc, storyId, intent)
  if (!ref?.scriptEntryId || !action) return undefined
  const confirmedBubbles = action.segments.filter(segment => segment.status === 'delivered').map(segment => ({
    bubbleIndex: segment.index + 1, content: segment.content, deliveredAt: segment.completedAt,
  }))
  const deliveredBubbleIndexes = confirmedBubbles.map(segment => segment.bubbleIndex)
  const unresolvedBubbleIndexes = action.segments.filter(segment => segment.status === 'unknown').map(segment => segment.index + 1)
  const cancelledBubbles: PrivateBubbleInterruption['cancelledBubbles'] = []
  for (let index = plan.nextIndex; index < plan.bubbles.length; index++) {
    if (action.segments.find(segment => segment.index === index)?.status !== 'pending') continue
    const handedOff = index === plan.nextIndex && (attempt ? attempt.handedOff : plan.attempting)
    if (handedOff) {
      unresolvedBubbleIndexes.push(index + 1)
      await svc.updateScriptDeliveryOutcome(storyId, { ...ref, bubbleIndex: index }, 'unknown', now, 'interrupted-after-transport-handoff')
      continue
    }
    await svc.updateScriptDeliveryOutcome(storyId, { ...ref, bubbleIndex: index }, 'cancelled', now, 'superseded-by-new-message')
    cancelledBubbles.push({ bubbleIndex: index + 1, content: plan.bubbles[index].content })
  }
  // An in-flight platform call is an interruption fact even when it leaves no
  // definitely-cancelled tail (for example, a one-bubble reply).
  if (!cancelledBubbles.length && !unresolvedBubbleIndexes.length) return undefined
  return {
    sourceAction: { commitId: ref.commitId, eventId: ref.eventId, scriptEntryId: ref.scriptEntryId },
    interruptedAt: now.toISOString(), deliveredBubbleIndexes, cancelledBubbles, confirmedBubbles, unresolvedBubbleIndexes,
  } satisfies PrivateBubbleInterruption
}

export async function deliverPrivateBubbleGroup(svc: any, storyId: string, intentId: number) {
  const runtime = runtimeFor(svc)
  const generation = svc.taskGeneration(storyId)
  const deliveryGeneration = svc.deliveryGeneration(storyId)
  const contentCurrent = () => !svc.databaseResetting && !svc.disposed && svc.deliveryGeneration(storyId) === deliveryGeneration
  const current = () => contentCurrent() && svc.taskGenerationCurrent(storyId, generation)
  if (runtime.attempts.has(intentId)) return
  const attempt: Attempt = { handedOff: false, cancelled: false }
  runtime.attempts.set(intentId, attempt)
  let continueWake = false
  try {
    const job = await svc.serial(storyId, async () => {
      if (!current() || svc.desktopRuntimePhase === 'paused') return undefined
      const intent = (await svc.dbGet('interlude_intent', { id: intentId, storyId, status: 'pending' }))[0] as NarrativeIntent | undefined
      if (!intent || !intent.participantId || intent.notBefore.getTime() > Date.now()
        || svc.interruptedTypingParticipants.has(intent.participantId)) return undefined
      const plan = privateBubblePlan(intent)
      if (!plan) return undefined
      const story: InterludeStory = await svc.getStory(storyId)
      const participant: InterludeParticipant | undefined = await svc.getParticipant(intent.participantId)
      const { ref, action } = await readAction(svc, storyId, intent)
      const index = plan.nextIndex
      const head = action?.segments.find(segment => segment.index === index)
      if (!ref?.scriptEntryId || !head || !plan.bubbles[index]) {
        await svc.dbSet('interlude_intent', { id: intentId, status: 'pending' }, { status: 'cancelled', updatedAt: new Date() })
        continueWake = true
        return undefined
      }
      if (plan.attempting || head.status !== 'pending' || !participant || participant.status !== 'active' || story.status !== 'active') {
        // Recover a confirmed head without another transport call. An interrupted process
        // during an attempt may have sent it; never blindly replay or release the tail.
        await settle(svc, intent, plan, ref, head.status === 'delivered', head.completedAt,
          head.status === 'pending' ? plan.attempting ? 'unknown' : 'failed' : undefined)
        continueWake = true
        return undefined
      }
      await svc.dbSet('interlude_intent', { id: intentId, status: 'pending' }, {
        payload: { ...intent.payload, privateBubblePlan: { ...plan, attempting: true } }, updatedAt: new Date(),
      })
      return { intent, plan, ref, story, participant }
    })
    if (!job) return
    const { intent, plan, ref, story, participant } = job
    const shouldCancel = () => attempt.cancelled || !current() || svc.desktopRuntimePhase === 'paused'
      || svc.interruptedTypingParticipants.has(participant.id)
    const route = runtime.routes.get(intentId)
    const sourceEndpointId = typeof intent.payload.sourceEndpointId === 'string' ? intent.payload.sourceEndpointId : undefined
    const message: OutgoingMessageDraft = {
      participantId: participant.id, content: plan.bubbles[plan.nextIndex].content, userInitiated: true,
      ...restoreDesktopContext(intent.payload), scriptEvent: { ...ref, bubbleIndex: plan.nextIndex },
      ...(ref.endpointId || (!route && sourceEndpointId) ? { endpointId: ref.endpointId ?? sourceEndpointId } : {}),
      beginPrivateBubbleTransport: () => {
        if (shouldCancel()) return false
        attempt.handedOff = true
        return true
      },
    }
    const receipts: ScriptEntry[] = []
    let delivered = false
    try {
      if (!shouldCancel()) {
        const sent: OutgoingMessageDraft[] = route && svc.platformPort
          ? await svc.platformPort.deliverOutgoing(story, [message], participant, route.handle, shouldCancel, true, undefined, 'failed', true, receipts)
          : await svc.deliverOutgoingMessages(story, [message], participant, undefined, shouldCancel, true, undefined, 'failed', true, receipts)
        delivered = sent.length > 0
      }
    } catch (error) {
      svc.reportStandalone('warn', '私聊逐泡发送流程异常，按已有回执和交付状态结算 计划=%d 分段=%d 错误=%s', intentId, plan.nextIndex + 1, error)
    }
    await svc.serial(storyId, async () => {
      if (!contentCurrent() || attempt.cancelled) return // ingress owns the cancelled tail; a late receipt updates only its own ledger segment
      if (!attempt.handedOff && shouldCancel()) {
        // Pausing invalidates the task, but its live token proves no handoff took place.
        // Clear the durable attempt marker so resume will not misclassify this as unknown.
        await svc.dbSet('interlude_intent', { id: intentId, status: 'pending' }, { payload: intent.payload, updatedAt: new Date() })
        continueWake = !svc.interruptedTypingParticipants.has(participant.id)
        return
      }
      if (!current()) {
        // Resume may already have scanned this intent while its live attempt was still busy.
        continueWake = true
        return
      }
      const { action } = await readAction(svc, storyId, intent)
      const head = action?.segments.find(segment => segment.index === plan.nextIndex)
      await settle(svc, intent, plan, ref, delivered || head?.status === 'delivered', receipts[0]?.occurredAt ?? head?.completedAt,
        !head || head.status === 'pending' ? attempt.handedOff ? 'unknown' : 'failed' : undefined)
      continueWake = true
    })
  } finally {
    runtime.attempts.delete(intentId)
    if (continueWake && contentCurrent() && svc.desktopRuntimePhase !== 'paused') svc.scheduleDueIntentWake(storyId, new Date())
  }
}

async function settle(svc: any, intent: NarrativeIntent, plan: PrivateBubblePlan, ref: NonNullable<ReturnType<typeof restoreMessageEvent>>,
  delivered: boolean, deliveredAt?: string | Date, unresolved?: 'failed' | 'unknown') {
  const now = new Date()
  const nextIndex = plan.nextIndex + 1
  if (delivered && plan.bubbles[nextIndex]) {
    const at = deliveredAt ? new Date(deliveredAt).getTime() : now.getTime()
    const notBefore = new Date((Number.isFinite(at) ? at : now.getTime()) + plan.bubbles[nextIndex].waitMs)
    await svc.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, {
      payload: { ...intent.payload, privateBubblePlan: { bubbles: plan.bubbles, nextIndex } }, notBefore, updatedAt: now,
    })
    return
  }
  if (!delivered) {
    if (unresolved) await svc.updateScriptDeliveryOutcome(intent.storyId, { ...ref, bubbleIndex: plan.nextIndex }, unresolved, now, 'private-bubble-delivery-unconfirmed')
    for (let index = nextIndex; index < plan.bubbles.length; index++) {
      await svc.updateScriptDeliveryOutcome(intent.storyId, { ...ref, bubbleIndex: index }, 'cancelled', now, 'preceding-private-bubble-not-delivered')
    }
  }
  runtimeFor(svc).routes.delete(intent.id)
  await svc.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, {
    status: delivered ? 'completed' : 'cancelled', updatedAt: now,
  })
}

/** Project only this private batch's interruption(s). A late receipt can clarify the
 * snapshot; exact confirmed text is repeated only if its delivery row was clipped. */
export function projectPrivateBubbleInterruptions(request: Pick<NarrativeRequest, 'phase' | 'groupContext' | 'participant' | 'supersededIntents' | 'recentEntries'>,
  visibleScript: Array<{ id: number; content: string }>) {
  if (request.phase !== 'user-message' || request.groupContext || !request.participant) return []
  const visible = new Map(visibleScript.map(entry => [entry.id, entry.content]))
  const seen = new Set<string>()
  return request.supersededIntents.flatMap(intent => {
    const record = intent.payload?.privateBubbleInterruption as PrivateBubbleInterruption | undefined
    if (intent.type !== 'split-message' || intent.participantId !== request.participant!.id || !record) return []
    const { sourceAction, cancelledBubbles } = record
    const key = JSON.stringify([sourceAction.scriptEntryId, sourceAction.commitId, sourceAction.eventId])
    if (seen.has(key)) return []
    seen.add(key)
    const entry = request.recentEntries.find(item => item.id === sourceAction.scriptEntryId)
    const action = (entry?.metadata?.deliveryActions as ScriptDeliveryAction[] | undefined)?.find(item =>
      item.commitId === sourceAction.commitId && item.eventId === sourceAction.eventId)
    const confirmed = action ? action.segments.filter(segment => segment.status === 'delivered').map(segment => ({
      bubbleIndex: segment.index + 1, content: segment.content, deliveredAt: segment.completedAt,
    })) : record.confirmedBubbles
    const unconfirmed = action ? action.segments.filter(segment => segment.status === 'unknown').map(segment => segment.index + 1)
      : record.unresolvedBubbleIndexes
    const confirmedOutsideHistory = confirmed.filter(segment => !request.recentEntries.some(item =>
      item.kind === 'character-message' && item.metadata?.scriptEntryId === sourceAction.scriptEntryId
      && item.metadata?.eventId === sourceAction.eventId && item.metadata?.bubbleIndex === segment.bubbleIndex - 1
      && visible.get(item.id) === segment.content))
    return [{
      sourceAction, interruptedAt: record.interruptedAt, triggerMessageIndex: record.triggerMessageIndex,
      deliveredBubbleIndexes: confirmed.map(segment => segment.bubbleIndex), cancelledBubbles,
      ...(confirmedOutsideHistory.length ? { confirmedOutsideHistory } : {}),
      ...(unconfirmed.length ? { unconfirmedBubbleIndexes: unconfirmed } : {}),
    }]
  })
}
