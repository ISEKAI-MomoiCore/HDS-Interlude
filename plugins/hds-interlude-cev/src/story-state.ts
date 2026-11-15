import { normalizeAlterSystemState } from './alter'
import { normalizeAgencyWindowState } from './agency'
import {
  AutomaticDeliverySummary, ContinuitySnapshot, ScenePresenceState, StoryState, WorkingDetail,
  DialogueBurstState, SceneFrame, SceneFrameField,
} from './types'

/**
 * Version 1 is the first state envelope that is decoded and encoded in one
 * place. Older beta10 rows have no version and are upgraded on read.
 */
export const CURRENT_STORY_STATE_VERSION = 4

const KNOWN_STORY_STATE_KEYS = new Set([
  'schemaVersion', 'extensions', 'settingOverlay', 'activeSceneId', 'activeArcId',
  'continuitySnapshot', 'narrativeUpdateCount', 'lastContinuityUpdateAt',
  'continuityDirty', 'automation', 'alterSystem', 'agencyWindow', 'scenePresence',
  'automaticDeliverySummaries', 'workingDetails', 'timelineCarry', 'chatRhythm',
  'sceneFrame', 'dialogueBurst', 'workingDetailResolutions', 'lifeStatus', 'proactiveContactLog', 'lifeRhythm',
])

export interface StoryStateMigrationInspection {
  sourceVersion: number
  targetVersion: number
  upgraded: boolean
  unknownKeys: string[]
  perspectiveDefaultAvailable: boolean
}

export function inspectStoryStateMigration(value: unknown, configuredPerspective = ''): StoryStateMigrationInspection {
  const record = isRecord(value) ? value : {}
  const sourceVersion = finiteInteger(record.schemaVersion) ?? 0
  return {
    sourceVersion,
    targetVersion: CURRENT_STORY_STATE_VERSION,
    upgraded: sourceVersion !== CURRENT_STORY_STATE_VERSION,
    unknownKeys: Object.keys(record).filter(key => !KNOWN_STORY_STATE_KEYS.has(key)).sort(),
    perspectiveDefaultAvailable: !!configuredPerspective.trim(),
  }
}

/** Decode any persisted version into the current, complete state envelope. */
export function decodeStoryState(value: unknown): StoryState {
  return upgradeStoryState(value)
}

/**
 * Pure and idempotent upgrade. Unknown top-level keys are deliberately moved
 * into extensions so a later plugin can recover them instead of losing them
 * during an unrelated state write.
 */
export function upgradeStoryState(value: unknown): StoryState {
  const record = isRecord(value) ? value : {}
  const overlay = isRecord(record.settingOverlay) ? record.settingOverlay : {}
  const automation = isRecord(record.automation) ? record.automation : {}
  const existingExtensions = isRecord(record.extensions) ? record.extensions : {}
  const unknownExtensions = Object.fromEntries(Object.entries(record).filter(([key]) => !KNOWN_STORY_STATE_KEYS.has(key)))
  const extensions = { ...existingExtensions, ...unknownExtensions }
  const continuity = normalizeContinuitySnapshot(record.continuitySnapshot)

  return {
    schemaVersion: CURRENT_STORY_STATE_VERSION,
    ...(Object.keys(extensions).length ? { extensions } : {}),
    settingOverlay: {
      characterProfile: textOrUndefined(overlay.characterProfile),
      perspective: clippedTextOrUndefined(overlay.perspective, 1_000),
      relationship: textOrUndefined(overlay.relationship),
      world: textOrUndefined(overlay.world),
      characterTraits: Array.isArray(overlay.characterTraits)
        ? overlay.characterTraits.filter((item): item is string => typeof item === 'string')
        : [],
    },
    activeSceneId: finiteNumber(record.activeSceneId),
    activeArcId: finiteNumber(record.activeArcId),
    continuitySnapshot: continuity,
    narrativeUpdateCount: Math.max(0, Math.floor(finiteNumber(record.narrativeUpdateCount) ?? 0)),
    lastContinuityUpdateAt: textOrUndefined(record.lastContinuityUpdateAt),
    continuityDirty: record.continuityDirty === true,
    alterSystem: normalizeAlterSystemState(record.alterSystem),
    agencyWindow: normalizeAgencyWindowState(record.agencyWindow),
    scenePresence: normalizeScenePresenceState(record.scenePresence),
    workingDetails: normalizeWorkingDetails(record.workingDetails),
    workingDetailResolutions: Object.fromEntries(Object.entries(isRecord(record.workingDetailResolutions) ? record.workingDetailResolutions : {})
      .filter(([label, id]) => label.length <= 80 && typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
      .slice(-32).map(([label, id]) => [label, Number(id)])),
    timelineCarry: normalizeTimelineCarry(record.timelineCarry),
    lifeStatus: normalizeLifeStatus(record.lifeStatus),
    lifeRhythm: normalizeLifeRhythm(record.lifeRhythm),
    proactiveContactLog: normalizeProactiveContactLog(record.proactiveContactLog),
    automaticDeliverySummaries: normalizeAutomaticDeliverySummaries(record.automaticDeliverySummaries),
    // beta10 declared this field but its old decoder forgot to return it.
    chatRhythm: isRecord(record.chatRhythm) ? record.chatRhythm as unknown as StoryState['chatRhythm'] : undefined,
    sceneFrame: normalizeSceneFrame(record.sceneFrame),
    dialogueBurst: normalizeDialogueBurst(record.dialogueBurst),
    automation: {
      quietUntil: textOrUndefined(automation.quietUntil),
      nextAdvanceAt: textOrUndefined(automation.nextAdvanceAt),
      timelineRetryAt: textOrUndefined(automation.timelineRetryAt),
      timelineRetryFrom: textOrUndefined(automation.timelineRetryFrom),
      timelineDirectorFailures: Math.max(0, Math.min(6, Math.floor(finiteNumber(automation.timelineDirectorFailures) ?? 0))),
      lastAutoAdvanceAt: textOrUndefined(automation.lastAutoAdvanceAt),
      lastUserMessageAt: textOrUndefined(automation.lastUserMessageAt),
      conversationFollowUpAt: Array.isArray(automation.conversationFollowUpAt)
        ? automation.conversationFollowUpAt.filter((item): item is string => typeof item === 'string').slice(0, 8)
        : [],
      conversationFollowUpParticipantId: clippedTextOrUndefined(automation.conversationFollowUpParticipantId, 255),
    },
  }
}

const SCENE_FRAME_FIELDS: SceneFrameField[] = [
  'place', 'presentPeople', 'ongoingActivity', 'attention',
  'deviceAccess', 'privacy', 'openMotions', 'openTopics',
]

export function normalizeSceneFrame(value: unknown): SceneFrame | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return undefined
  const rawSources = isRecord(value.sources) ? value.sources : {}
  const sources: Partial<Record<SceneFrameField, number[]>> = {}
  for (const field of SCENE_FRAME_FIELDS) {
    const ids = integerArray(rawSources[field], 24)
    if (ids.length) sources[field] = ids
  }
  // Version 3 deliberately drops beta1 prose-shaped source fields. Keeping
  // their ids would make a cleaned frame still look grounded by stale prose.
  const sourceEntryIds = Array.from(new Set(Object.values(sources).flatMap(ids => ids ?? []))).slice(0, 80)
  const groundedText = (field: SceneFrameField, raw: unknown, limit: number) =>
    sources[field]?.length ? clippedTextOrUndefined(raw, limit) : undefined
  const groundedList = (field: SceneFrameField, raw: unknown, count: number, limit: number) =>
    sources[field]?.length ? stringArray(raw, count, limit) : []
  return {
    id: value.id.trim().slice(0, 120),
    ...(finiteInteger(value.localBoundaryEntryId) ? { localBoundaryEntryId: finiteInteger(value.localBoundaryEntryId) } : {}),
    ...(finiteInteger(value.sceneId) ? { sceneId: finiteInteger(value.sceneId) } : {}),
    place: groundedText('place', value.place, 240),
    presentPeople: groundedList('presentPeople', value.presentPeople, 16, 80),
    ongoingActivity: groundedText('ongoingActivity', value.ongoingActivity, 320),
    attention: groundedText('attention', value.attention, 320),
    deviceAccess: groundedText('deviceAccess', value.deviceAccess, 80),
    privacy: groundedText('privacy', value.privacy, 80),
    openMotions: groundedList('openMotions', value.openMotions, 8, 320),
    openTopics: groundedList('openTopics', value.openTopics, 8, 320),
    sourceEntryIds,
    sources,
    updatedAt: validIsoString(value.updatedAt) ?? new Date(0).toISOString(),
  }
}

export function normalizeDialogueBurst(value: unknown): DialogueBurstState | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.frameId !== 'string') return undefined
  const id = value.id.trim().slice(0, 160)
  const frameId = value.frameId.trim().slice(0, 120)
  const startedAt = validIsoString(value.startedAt)
  if (!id || !frameId || !startedAt) return undefined
  return {
    id, frameId, startedAt,
    sourceEntryIds: integerArray(value.sourceEntryIds, 80),
    lastEventId: clippedTextOrUndefined(value.lastEventId, 180),
    scopeKey: clippedTextOrUndefined(value.scopeKey, 120),
    topicKeys: stringArray(value.topicKeys, 12, 120),
  }
}

/** Encode through the same codec so writes can never bypass normalization. */
export function encodeStoryState(value: StoryState): StoryState {
  return upgradeStoryState(value)
}

export function normalizeAutomaticDeliverySummaries(value: unknown): AutomaticDeliverySummary[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: AutomaticDeliverySummary[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const participantId = clippedTextOrUndefined(item.participantId, 255) ?? ''
    const summary = clippedTextOrUndefined(item.summary, 240) ?? ''
    const deliveredAt = validIsoString(item.deliveredAt) ?? ''
    const sourceEntryId = finiteInteger(item.sourceEntryId)
    const key = `${participantId}|${sourceEntryId ?? 0}|${summary}`
    if (!participantId || !summary || !deliveredAt || seen.has(key)) continue
    seen.add(key)
    normalized.push({ participantId, summary, ...(sourceEntryId ? { sourceEntryId } : {}), deliveredAt })
  }
  return normalized.slice(-6)
}

export function normalizeScenePresenceState(value: unknown): ScenePresenceState[] {
  if (!Array.isArray(value)) return []
  const latest = new Map<string, ScenePresenceState>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const name = clippedTextOrUndefined(item.name, 80) ?? ''
    const status = item.status === 'present' || item.status === 'off-scene' || item.status === 'expected'
      ? item.status
      : undefined
    const basis = clippedTextOrUndefined(item.basis, 300) ?? ''
    const sourceEntryIds = integerArray(item.sourceEntryIds, 8)
    const updatedAt = validIsoString(item.updatedAt) ?? ''
    if (!name || !status || !basis || !sourceEntryIds.length || !updatedAt) continue
    latest.set(name, { name, status, basis, sourceEntryIds, updatedAt })
  }
  return [...latest.values()].slice(-8)
}

export function normalizeWorkingDetails(value: unknown): WorkingDetail[] {
  if (!Array.isArray(value)) return []
  const latest = new Map<string, WorkingDetail>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const label = clippedTextOrUndefined(item.label, 80) ?? ''
    const detailValue = clippedTextOrUndefined(item.value, 300) ?? ''
    const expiresAt = validIsoString(item.expiresAt)
    const createdAt = validIsoString(item.createdAt) ?? new Date(0).toISOString()
    const sourceEntryIds = integerArray(item.sourceEntryIds, 8)
    if (!label || !detailValue) continue
    latest.set(label, {
      label,
      ...(typeof item.participantId === 'string' ? { participantId: item.participantId.slice(0, 255) } : {}),
      value: detailValue,
      ...(expiresAt ? { expiresAt } : {}),
      createdAt,
      ...(sourceEntryIds.length ? { sourceEntryIds } : {}),
      ...(isRecord(item.knowledge) ? { knowledge: item.knowledge as unknown as NonNullable<WorkingDetail['knowledge']> } : {}),
    })
  }
  return [...latest.values()].slice(-10)
}

/** 主动联系审计窗：每参与者每日上限的计数来源（最近 20 条；不进模型上下文）。 */
export function normalizeProactiveContactLog(value: unknown): NonNullable<StoryState['proactiveContactLog']> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is { participantId: string, at: string } => !!item && typeof item === 'object' && !Array.isArray(item)
      && typeof (item as Record<string, unknown>).participantId === 'string' && !!(item as Record<string, unknown>).participantId
      && typeof (item as Record<string, unknown>).at === 'string' && !Number.isNaN(Date.parse((item as Record<string, unknown>).at as string)))
    .map(item => ({ participantId: item.participantId, at: item.at,
      ...((item as Record<string, unknown>).endpointId ? { endpointId: String((item as Record<string, unknown>).endpointId) } : {}),
      ...((item as Record<string, unknown>).channelReason ? { channelReason: String((item as Record<string, unknown>).channelReason).slice(0, 100) } : {}),
      ...((item as Record<string, unknown>).ref ? { ref: String((item as Record<string, unknown>).ref).slice(0, 120) } : {}),
      ...((item as Record<string, unknown>).voided === true ? { voided: true } : {}) }))
    .slice(-20)
}

/** 作废条目不再计入每日上限：一次被端点/传输拦下的主动联系不该烧掉配额。 */
export function countProactiveContactsInWindow(
  log: StoryState['proactiveContactLog'] | undefined,
  participantId: string,
  now: Date,
  windowMs = 86_400_000,
): number {
  return (log ?? []).filter(entry => entry.participantId === participantId
    && !entry.voided
    && now.getTime() - Date.parse(entry.at) < windowMs).length
}

export function appendProactiveContact(
  log: StoryState['proactiveContactLog'] | undefined,
  participantId: string,
  at: Date,
  endpointId?: string,
  ref?: string,
): NonNullable<StoryState['proactiveContactLog']> {
  return [...(log ?? []), { participantId, at: at.toISOString(), ...(endpointId ? { endpointId } : {}), ...(ref ? { ref } : {}) }].slice(-20)
}

export function normalizeLifeStatus(value: unknown): StoryState['lifeStatus'] {
  if (!isRecord(value)) return undefined
  const status = value.status
  if (status !== 'busy' && status !== 'asleep' && status !== 'idle') return undefined
  const updatedAt = typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt)) ? value.updatedAt : undefined
  return updatedAt ? { status, updatedAt } : undefined
}

const LIFE_RHYTHM_ATTENTIONS = ['phone-focused', 'available', 'occupied', 'resting', 'asleep'] as const

/** 五档节奏归一化：合法档位+有效时间戳+合法来源才保留。 */
export function normalizeLifeRhythm(value: unknown): StoryState['lifeRhythm'] {
  if (!isRecord(value)) return undefined
  const attention = value.attention
  if (typeof attention !== 'string' || !(LIFE_RHYTHM_ATTENTIONS as readonly string[]).includes(attention)) return undefined
  const assessedAt = typeof value.assessedAt === 'string' && !Number.isNaN(Date.parse(value.assessedAt)) ? value.assessedAt : undefined
  const source = value.source === 'compactor' || value.source === 'narrator' || value.source === 'incoming' || value.source === 'fallback' ? value.source : 'compactor'
  const basis = typeof value.basis === 'string' ? value.basis.trim().slice(0, 500) : ''
  return assessedAt ? { attention: attention as StoryState['lifeRhythm'] extends { attention: infer A } ? A : never, basis, assessedAt, source } : undefined
}

/** 节奏过期判定（>2h 无更新视为 stale，退回 restWindows 兜底）。 */
export function lifeRhythmStale(rhythm: StoryState['lifeRhythm'] | undefined, now = Date.now()): boolean {
  if (!rhythm) return true
  const assessed = Date.parse(rhythm.assessedAt)
  return Number.isNaN(assessed) || now - assessed > 2 * 3_600_000
}

/** 旧三值 lifeStatus → 五档映射（读侧兼容：升级前的存量状态在首次读取时转换）。 */
export function lifeRhythmFromLegacyStatus(status: StoryState['lifeStatus'] | undefined): StoryState['lifeRhythm'] | undefined {
  if (!status) return undefined
  const attention = status.status === 'busy' ? 'occupied' as const : status.status === 'asleep' ? 'asleep' as const : 'available' as const
  return { attention, basis: `从旧 lifeStatus(${status.status}) 映射`, assessedAt: status.updatedAt, source: 'fallback' }
}

export function normalizeTimelineCarry(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, 240))
    .filter(Boolean))).slice(0, 4)
}

export function normalizeContinuitySnapshot(value: unknown): ContinuitySnapshot | undefined {
  if (!isRecord(value)) return undefined
  const text = (item: unknown, limit: number) => typeof item === 'string' ? item.trim().slice(0, limit) : ''
  const list = (item: unknown, limit: number) => Array.isArray(item)
    ? item.map(entry => text(entry, limit)).filter(Boolean).slice(0, 5)
    : []
  const current = text(value.current, 500)
  const recent = list(value.recent, 300)
  const salient = list(value.salient, 400)
  if (!current && !recent.length && !salient.length) return undefined
  return { current, next: [], recent, salient }
}

function textOrUndefined(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function clippedTextOrUndefined(value: unknown, limit: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined
}

function validIsoString(value: unknown) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) ? value : undefined
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finiteInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function integerArray(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isSafeInteger(item)).slice(0, limit)
    : []
}

function stringArray(value: unknown, limit: number, itemLimit: number) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string')
      .map(item => item.trim().slice(0, itemLimit)).filter(Boolean))).slice(0, limit)
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
