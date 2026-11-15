import { createHash } from 'node:crypto'
import type {
  AgencyWindowState, DialogueBurstState, InterludeScene, SceneFrame, SceneFrameField,
  ScenePresenceState, ScriptEntry, StoryState, WorkingDetail,
} from '../types'
import type { ScriptCommitDraft } from './contract'
import { entryLifeHandoff, type LifeHandoff } from './life-handoff'

export interface SceneFrameProjectionInput {
  storyId: string
  now: Date
  scene: InterludeScene | null
  state: StoryState
  recentEntries?: ScriptEntry[]
  workingDetails?: WorkingDetail[]
  scenePresence?: ScenePresenceState[]
  agencyWindow?: AgencyWindowState | null
}

export interface DialogueBurstSignal {
  /** Relationship/group/life branch. It is hashed before persistence. */
  scope?: string
  /** Current external-event text. Only hashed topic keys are persisted. */
  topicText?: string
  /** A committed structural transition, never an elapsed-time timeout. */
  boundary?: boolean
}

/**
 * Deterministically projects already-established evidence into a read-only
 * scene scaffold. It never asks a model to summarize the scene and never uses
 * elapsed time to change frame or burst identity.
 */
export function projectSceneFrame(input: SceneFrameProjectionInput): SceneFrame {
  // The active-scene query is authoritative. A persisted activeSceneId may
  // briefly point at a scene that has just been closed.
  const sceneId = input.scene?.id
  const id = stableId('frame', input.storyId, String(sceneId ?? 'root'))
  // Re-project from factual sources on every turn. Persisted beta1 frames may
  // contain prose tails; cloning them would keep that feedback loop alive.
  const values: SceneFrame = {
    id, ...(sceneId ? { sceneId } : {}), presentPeople: [], openMotions: [], openTopics: [],
    ...(input.state.sceneFrame?.localBoundaryEntryId ? { localBoundaryEntryId: input.state.sceneFrame.localBoundaryEntryId } : {}),
    sourceEntryIds: [], sources: {}, updatedAt: input.now.toISOString(),
  }

  const presence = input.scenePresence ?? input.state.scenePresence ?? []
  const visible = input.recentEntries ? new Set(input.recentEntries.map(entry => entry.id)) : undefined
  const grounded = (ids: number[]) => ids.length > 0 && (!visible || ids.some(id => visible.has(id)))
  const present = presence.filter(item => item.status === 'present' && grounded(item.sourceEntryIds)
    && Math.max(...item.sourceEntryIds) >= (values.localBoundaryEntryId ?? 0))
  if (present.length) assign(values, 'presentPeople', present.map(item => item.name), present.flatMap(item => item.sourceEntryIds))

  const details = input.workingDetails ?? input.state.workingDetails ?? []
  const groundedDetails = details.filter(item => grounded(item.sourceEntryIds ?? []))
  if (groundedDetails.length) {
    assign(values, 'openMotions', groundedDetails.map(item => `${item.label}：${item.value}`), groundedDetails.flatMap(item => item.sourceEntryIds ?? []))
  }

  const agency = input.agencyWindow ?? input.state.agencyWindow
  if (agency?.sourceEntryIds.length) {
    assign(values, 'deviceAccess', agency.deviceAccess, agency.sourceEntryIds)
    assign(values, 'privacy', agency.privacy, agency.sourceEntryIds)
    assign(values, 'attention', agency.activityLoad, agency.sourceEntryIds)
  }

  // Each handoff points into the original. A new location/structural transition
  // replaces local occupancy, not the long-lived relationship or plot arc.
  for (const entry of [...(input.recentEntries ?? [])].sort((a, b) => a.id - b.id)) {
    const handoff = entryLifeHandoff(entry)
    if (!handoff) continue
    applyLifeHandoff(values, handoff, entry.id)
  }

  values.sourceEntryIds = unionIds(Object.values(values.sources).flatMap(ids => ids ?? []))
  values.updatedAt = input.now.toISOString()
  return values
}

export function resolveDialogueBurst(
  frame: SceneFrame,
  previous: DialogueBurstState | undefined,
  startedAt: Date,
  signal: DialogueBurstSignal = {},
): DialogueBurstState {
  const scopeKey = signal.scope?.trim() ? stableId('scope', signal.scope.trim()) : undefined
  const nextTopicKeys = dialogueTopicKeys(signal.topicText ?? '')
  const sameScope = !scopeKey || !previous?.scopeKey || scopeKey === previous.scopeKey
  const sameTopic = !nextTopicKeys.length || !previous?.topicKeys?.length
    ? true
    : topicKeysOverlap(previous.topicKeys, nextTopicKeys) || isConversationalFollowUp(signal.topicText ?? '')
  if (!signal.boundary && previous?.frameId === frame.id && sameScope && sameTopic) return {
    ...previous,
    sourceEntryIds: unionIds([...previous.sourceEntryIds, ...frame.sourceEntryIds]),
    ...(scopeKey ? { scopeKey } : {}),
    ...(nextTopicKeys.length ? { topicKeys: unionStrings([...(previous.topicKeys ?? []), ...nextTopicKeys], 12) } : {}),
  }
  return {
    id: stableId('burst', frame.id, startedAt.toISOString()),
    frameId: frame.id,
    startedAt: startedAt.toISOString(),
    sourceEntryIds: [...frame.sourceEntryIds],
    ...(scopeKey ? { scopeKey } : {}),
    ...(nextTopicKeys.length ? { topicKeys: nextTopicKeys } : {}),
  }
}

/** Materialize only the newly committed append; prior prose remains immutable. */
export function advanceSceneFrame(
  frame: SceneFrame,
  burst: DialogueBurstState,
  commit: ScriptCommitDraft,
  sourceEntryId: number,
  now: Date,
  handoff?: LifeHandoff,
) {
  // Script prose remains immutable narrative evidence. It is never projected
  // back into a frame field, even for global automatic-life commits.
  const next = cloneFrame(frame, now)
  if (handoff) applyLifeHandoff(next, handoff, sourceEntryId)
  next.sourceEntryIds = unionIds(Object.values(next.sources).flatMap(ids => ids ?? []))
  const nextBurst: DialogueBurstState = {
    ...burst,
    sourceEntryIds: unionIds([...burst.sourceEntryIds, sourceEntryId]),
    lastEventId: commit.events.at(-1)?.eventId,
  }
  return { frame: next, burst: nextBurst }
}

export function sceneFrameProvenanceErrors(frame: SceneFrame) {
  const errors: string[] = []
  const fields: SceneFrameField[] = [
    'place', 'presentPeople', 'ongoingActivity', 'postureOrMotion', 'attention', 'deviceAccess',
    'privacy', 'affectiveBaseline', 'openMotions', 'openTopics', 'narrativeFocus',
  ]
  for (const field of fields) {
    const value = frame[field]
    const populated = Array.isArray(value) ? value.length > 0 : typeof value === 'string' && !!value.trim()
    if (populated && !frame.sources[field]?.length) errors.push(`${field} has no source entry`)
  }
  return errors
}

function assign<K extends SceneFrameField>(frame: SceneFrame, field: K, value: SceneFrame[K], sourceIds: Array<number | null | undefined>) {
  const ids = positiveIds(sourceIds)
  if (!ids.length) return
  ;(frame[field] as SceneFrame[K]) = value
  frame.sources[field] = ids
}

function applyLifeHandoff(values: SceneFrame, handoff: LifeHandoff, entryId: number) {
  if (entryId < (values.localBoundaryEntryId ?? 0)) return
  if (handoff.transition || (handoff.place && values.place !== handoff.place.value)) {
    values.localBoundaryEntryId = entryId
    values.presentPeople = []; delete values.sources.presentPeople
    delete values.ongoingActivity; delete values.sources.ongoingActivity
    values.openMotions = []; delete values.sources.openMotions
  }
  if (handoff.place) assign(values, 'place', handoff.place.value, [entryId])
  if (handoff.activity) assign(values, 'ongoingActivity', handoff.activity.value, [entryId])
  if (handoff.presence) assign(values, 'presentPeople', handoff.presence.names, [entryId])
  if (handoff.resolvedDetails?.length) {
    const labels = handoff.resolvedDetails.map(item => `${item.label}：`)
    values.openMotions = values.openMotions.filter(item => !labels.some(label => item.startsWith(label)))
    if (!values.openMotions.length) delete values.sources.openMotions
  }
}

function cloneFrame(frame: SceneFrame, now: Date): SceneFrame {
  return {
    id: frame.id, ...(frame.sceneId ? { sceneId: frame.sceneId } : {}),
    ...(frame.localBoundaryEntryId ? { localBoundaryEntryId: frame.localBoundaryEntryId } : {}),
    ...(frame.place ? { place: frame.place } : {}),
    ...(frame.ongoingActivity ? { ongoingActivity: frame.ongoingActivity } : {}),
    ...(frame.attention ? { attention: frame.attention } : {}),
    ...(frame.deviceAccess ? { deviceAccess: frame.deviceAccess } : {}),
    ...(frame.privacy ? { privacy: frame.privacy } : {}),
    presentPeople: [...frame.presentPeople], openMotions: [...frame.openMotions], openTopics: [...frame.openTopics],
    sourceEntryIds: [...frame.sourceEntryIds],
    sources: Object.fromEntries(Object.entries(frame.sources)
      .filter(([key]) => !['postureOrMotion', 'affectiveBaseline', 'narrativeFocus'].includes(key))
      .map(([key, ids]) => [key, [...(ids ?? [])]])),
    updatedAt: now.toISOString(),
  }
}

function positiveIds(values: Array<number | null | undefined>) {
  return unionIds(values.filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0))
}

function unionIds(values: number[]) {
  return Array.from(new Set(values)).sort((left, right) => left - right).slice(-80)
}

function dialogueTopicKeys(text: string) {
  const normalized = text.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
  if (!normalized) return []
  const raw = /[\u3400-\u9fff]/u.test(normalized)
    ? Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2))
    : (text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  return unionStrings(raw.map(value => stableId('topic', value)), 12)
}

function topicKeysOverlap(left: string[], right: string[]) {
  const known = new Set(left)
  return right.some(key => known.has(key))
}

function isConversationalFollowUp(text: string) {
  const normalized = text.trim()
  if (!normalized) return true
  return /^(那|这|所以|然后|但是|可是|怎么|为什么|你|我|刚才|昨天|前面|不是|对啊|嗯|啊)/u.test(normalized)
}

function unionStrings(values: string[], limit: number) {
  return Array.from(new Set(values)).slice(-limit)
}

function stableId(prefix: string, ...parts: string[]) {
  const digest = createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 18)
  return `${prefix}:${digest}`
}
