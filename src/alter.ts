import {
  AlterHistoryEntry, AlterPendingScope, AlterSystemConfig, AlterSystemState, EmotionalOffsetPrompt, NarrativePhase,
} from './types'

const HOUR = 60 * 60 * 1000
const HISTORY_LIMIT = 50

export const DEFAULT_ALTER_SYSTEM_CONFIG: AlterSystemConfig = {
  enabled: false,
  baseThreshold: 10,
  densityFactor: 0.3,
  sameDirectionBoost: 0.05,
  oppositeDecay: 0.15,
  minWeight: 0.2,
  maxIntensity: 2,
  modelId: '',
  providerId: '',
  model: '',
  temperature: 0.3,
  topP: 1,
  maxTokens: 400,
  timeout: 30_000,
  prompt: '',
}

export interface AlterTurnResult {
  state: AlterSystemState
  threshold: number
  offsetExpired: boolean
  thresholdReached: boolean
  sourceParticipantId: string
  triggerValue: number
}

export function resolveAlterSystemConfig(value?: Partial<AlterSystemConfig>): AlterSystemConfig {
  return { ...DEFAULT_ALTER_SYSTEM_CONFIG, ...value }
}

export function normalizeAlterValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(-5, Math.min(5, Math.round(value)))
}

export function createAlterSystemState(now = new Date()): AlterSystemState {
  return {
    alterValue: 0,
    alterWeight: 0,
    lastTriggerDirection: 0,
    emotionalOffset: null,
    history: [],
    lastUpdatedAt: now.toISOString(),
  }
}

export function normalizeAlterSystemState(value: unknown): AlterSystemState | undefined {
  if (!isRecord(value)) return undefined
  const history: AlterHistoryEntry[] = Array.isArray(value.history)
    ? value.history.filter(isRecord).map((entry, index) => ({
      turn: Math.max(1, Math.floor(finiteNumber(entry.turn, index + 1))),
      phase: normalizePhase(entry.phase),
      alter: normalizeAlterValue(entry.alter) ?? 0,
      alterValue: clamp(finiteNumber(entry.alterValue, 0), -1_000, 1_000),
      timestamp: normalizedIso(entry.timestamp) ?? new Date(0).toISOString(),
      ...(typeof entry.participantId === 'string' && entry.participantId.trim()
        ? { participantId: entry.participantId.trim().slice(0, 255) }
        : {}),
    })).slice(-HISTORY_LIMIT)
    : []
  const emotionalOffset = isRecord(value.emotionalOffset) && typeof value.emotionalOffset.description === 'string'
    ? {
      direction: value.emotionalOffset.direction === 'relaxed' ? 'relaxed' as const : 'serious' as const,
      description: value.emotionalOffset.description.trim().slice(0, 800),
      intensity: clamp(finiteNumber(value.emotionalOffset.intensity, 1), 0, 3),
      generatedAt: normalizedIso(value.emotionalOffset.generatedAt) ?? new Date(0).toISOString(),
    }
    : null
  const legacyDirection = Math.sign(finiteNumber(value.lastTriggerAlter, 0))
  const direction = Math.sign(finiteNumber(value.lastTriggerDirection, legacyDirection)) as -1 | 0 | 1
  const pendingScopes = normalizePendingScopes(value.pendingScopes)
  // A persisted pre-scope state has only one safe interpretation: its prior
  // accumulated value belonged to the protagonist/global story stream.
  if (!pendingScopes.length && Math.abs(finiteNumber(value.alterValue, 0)) > 0) {
    pendingScopes.push({ participantId: '', alterValue: clamp(finiteNumber(value.alterValue, 0), -1_000, 1_000) })
  }
  return {
    alterValue: clamp(finiteNumber(value.alterValue, 0), -1_000, 1_000),
    alterWeight: clamp(finiteNumber(value.alterWeight, 0), 0, 1),
    lastTriggerDirection: direction,
    emotionalOffset,
    history,
    pendingScopes,
    lastUpdatedAt: normalizedIso(value.lastUpdatedAt) ?? new Date(0).toISOString(),
    lastAnalysisAttemptAt: normalizedIso(value.lastAnalysisAttemptAt),
  }
}

export function calculateAlterThreshold(history: AlterHistoryEntry[], config: AlterSystemConfig, now = new Date()) {
  const oneHourAgo = now.getTime() - HOUR
  const turns = history.filter(entry => (dateValue(entry.timestamp)?.getTime() ?? 0) >= oneHourAgo).length
  const density = Math.min(turns / 10, 1)
  const base = Math.max(1, finiteNumber(config.baseThreshold, 10))
  const factor = clamp(finiteNumber(config.densityFactor, 0.3), 0, 1)
  return Math.max(base * 0.5, base * (1 - density * factor))
}

export function adjustAlterWeight(weight: number, sameDirection: boolean, magnitude: number, config: AlterSystemConfig) {
  const rate = sameDirection ? config.sameDirectionBoost : -config.oppositeDecay
  return clamp(weight + Math.max(0, magnitude) * finiteNumber(rate, 0), 0, 1)
}

export function advanceAlterSystem(
  current: AlterSystemState | undefined,
  alter: number,
  phase: NarrativePhase,
  now: Date,
  config: AlterSystemConfig,
  participantId = '',
): AlterTurnResult {
  const state = current
    ? { ...current, history: [...current.history], pendingScopes: normalizePendingScopes(current.pendingScopes) }
    : createAlterSystemState(now)
  materializeLegacyPendingValue(state)
  const sourceParticipantId = normalizeParticipantId(participantId)
  const scope = ensurePendingScope(state, sourceParticipantId)
  scope.alterValue = clamp(scope.alterValue + alter, -1_000, 1_000)
  state.alterValue = totalPendingAlter(state.pendingScopes)
  const direction = Math.sign(alter)
  let offsetExpired = false
  if (state.emotionalOffset && direction) {
    state.alterWeight = adjustAlterWeight(
      state.alterWeight,
      direction === state.lastTriggerDirection,
      Math.abs(alter),
      config,
    )
    if (state.alterWeight < config.minWeight) {
      state.emotionalOffset = null
      state.alterWeight = 0
      offsetExpired = true
    }
  }
  state.history.push({
    turn: (state.history.at(-1)?.turn ?? 0) + 1,
    phase,
    alter,
    alterValue: state.alterValue,
    timestamp: now.toISOString(),
    ...(sourceParticipantId ? { participantId: sourceParticipantId } : {}),
  })
  state.history = state.history.slice(-HISTORY_LIMIT)
  state.lastUpdatedAt = now.toISOString()
  const scopeHistory = alterHistoryForScope(state.history, sourceParticipantId)
  const threshold = calculateAlterThreshold(scopeHistory, config, now)
  return {
    state, threshold, offsetExpired,
    thresholdReached: Math.abs(scope.alterValue) >= threshold,
    sourceParticipantId,
    triggerValue: scope.alterValue,
  }
}

export function completeAlterAnalysis(
  state: AlterSystemState,
  description: string,
  threshold: number,
  now: Date,
  config: AlterSystemConfig,
  participantId = '',
  analyzedValue?: number,
) {
  const sourceParticipantId = normalizeParticipantId(participantId)
  const scopes = normalizePendingScopes(state.pendingScopes)
  if (!scopes.length && Math.abs(state.alterValue) > 0) scopes.push({ participantId: '', alterValue: state.alterValue })
  const scope = ensurePendingScope({ ...state, pendingScopes: scopes }, sourceParticipantId)
  // The model analyzed a snapshot, not scores committed while it was in flight.
  const triggerValue = analyzedValue ?? scope.alterValue
  if (!Number.isFinite(triggerValue) || !triggerValue) return state
  if (analyzedValue !== undefined && (Math.sign(scope.alterValue) !== Math.sign(triggerValue) || Math.abs(scope.alterValue) < threshold)) return state
  const direction = Math.sign(triggerValue) as -1 | 1
  scope.alterValue = clamp(scope.alterValue - triggerValue, -1_000, 1_000)
  scope.lastAnalysisAttemptAt = undefined
  return {
    ...state,
    alterValue: totalPendingAlter(scopes),
    pendingScopes: scopes,
    alterWeight: 1,
    lastTriggerDirection: direction,
    emotionalOffset: {
      direction: direction > 0 ? 'serious' as const : 'relaxed' as const,
      description: description.trim().slice(0, 800),
      intensity: Math.min(Math.abs(triggerValue) / Math.max(1, threshold), config.maxIntensity),
      generatedAt: now.toISOString(),
    },
    lastUpdatedAt: now.toISOString(),
  }
}

export function emotionalOffsetForPrompt(
  state: AlterSystemState | undefined,
  config: AlterSystemConfig,
): EmotionalOffsetPrompt | null {
  if (!config.enabled || !state?.emotionalOffset || state.alterWeight < config.minWeight) return null
  return { ...state.emotionalOffset, weight: state.alterWeight }
}

/** The current scope has its own retry gate, so a failed relationship-local
 * analysis does not suppress an unrelated piece of independent life. */
export function alterScopeCoolingDown(state: AlterSystemState, participantId = '', now = new Date(), cooldownMs = 5 * 60 * 1000) {
  const scope = findPendingScope(state.pendingScopes, normalizeParticipantId(participantId))
  const lastAttempt = dateValue(scope ? scope.lastAnalysisAttemptAt : state.lastAnalysisAttemptAt)
  return !!lastAttempt && now.getTime() - lastAttempt.getTime() < cooldownMs
}

export function markAlterScopeAnalysisAttempt(state: AlterSystemState, participantId = '', now = new Date()) {
  const scopes = normalizePendingScopes(state.pendingScopes)
  const scope = ensurePendingScope({ ...state, pendingScopes: scopes }, normalizeParticipantId(participantId))
  scope.lastAnalysisAttemptAt = now.toISOString()
  return { ...state, pendingScopes: scopes }
}

/** A stale result consumed no evidence; allow the changed scope to be reviewed again. */
export function clearAlterScopeAnalysisAttempt(state: AlterSystemState, participantId = '') {
  const sourceParticipantId = normalizeParticipantId(participantId)
  const scopes = normalizePendingScopes(state.pendingScopes)
  const scope = findPendingScope(scopes, sourceParticipantId)
  if (scope) scope.lastAnalysisAttemptAt = undefined
  return { ...state, pendingScopes: scopes }
}

export function alterScopeValue(state: AlterSystemState, participantId = '') {
  return findPendingScope(state.pendingScopes, normalizeParticipantId(participantId))?.alterValue ?? 0
}

export function alterHistoryForScope(history: AlterHistoryEntry[], participantId = '') {
  const sourceParticipantId = normalizeParticipantId(participantId)
  return history.filter(entry => normalizeParticipantId(entry.participantId ?? '') === sourceParticipantId)
}

function normalizePendingScopes(value: unknown): AlterPendingScope[] {
  if (!Array.isArray(value)) return []
  const byParticipant = new Map<string, AlterPendingScope>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const participantId = normalizeParticipantId(item.participantId)
    const existing = byParticipant.get(participantId)
    const alterValue = clamp(finiteNumber(item.alterValue, 0), -1_000, 1_000)
    byParticipant.set(participantId, {
      participantId,
      alterValue: clamp((existing?.alterValue ?? 0) + alterValue, -1_000, 1_000),
      ...(normalizedIso(item.lastAnalysisAttemptAt) ? { lastAnalysisAttemptAt: normalizedIso(item.lastAnalysisAttemptAt) } : {}),
    })
  }
  const scopes = Array.from(byParticipant.values())
  // 容量策略:活跃累计(非零)永不截断;零值 scope 只在 32 个名额有剩余时保留
  // (丢弃零值 scope 仅丢失该 scope 的 5 分钟分析冷却信息——值为零本就不会触发)。
  // 此前固定按首见顺序 slice(0,32):先到的 32 个零值 scope 永久占位,
  // 之后新建的参与者/独立生活 scope 的累计被静默丢弃(饥饿)。
  const active = scopes.filter(scope => scope.alterValue !== 0)
  if (active.length >= 32) return active
  const idle = scopes.filter(scope => scope.alterValue === 0)
  return [...active, ...idle].slice(0, 32)
}

function normalizeParticipantId(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 255) : ''
}

function findPendingScope(scopes: AlterPendingScope[] | undefined, participantId: string) {
  return scopes?.find(scope => scope.participantId === participantId)
}

function ensurePendingScope(state: Pick<AlterSystemState, 'pendingScopes'>, participantId: string) {
  const scopes = state.pendingScopes ?? (state.pendingScopes = [])
  let scope = findPendingScope(scopes, participantId)
  if (!scope) {
    scope = { participantId, alterValue: 0 }
    scopes.push(scope)
  }
  return scope
}

function totalPendingAlter(scopes: AlterPendingScope[] | undefined) {
  return clamp((scopes ?? []).reduce((sum, scope) => sum + scope.alterValue, 0), -1_000, 1_000)
}

function materializeLegacyPendingValue(state: AlterSystemState) {
  if (!state.pendingScopes?.length && Math.abs(state.alterValue) > 0) {
    state.pendingScopes = [{ participantId: '', alterValue: state.alterValue }]
  }
}

function normalizePhase(value: unknown): NarrativePhase {
  return ['advance', 'conversation-follow-up', 'user-message', 'intent-due'].includes(String(value))
    ? value as NarrativePhase
    : 'user-message'
}

function normalizedIso(value: unknown) {
  return dateValue(value)?.toISOString()
}

function dateValue(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
