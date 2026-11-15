import {
  AgencyConfig, AgencyWindowState, ProactiveContactDraft,
} from './types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const DEFAULT_AGENCY_CONFIG: AgencyConfig = {
  enabled: false,
  maxWindowMinutes: 240,
  minimumProactiveIntervalMinutes: 60,
  maxCandidateHours: 24,
  contactMode: 'strict',
  naturalWillingnessThreshold: 0.25,
  naturalMinimumIntervalMinutes: 30,
  proactiveDailyCap: 3,
}

export interface AgencyCapacityResult {
  allowed: boolean
  reason: string
  nextOpportunityAt?: Date
}

export function resolveAgencyConfig(value?: Partial<AgencyConfig>): AgencyConfig {
  const merged = { ...DEFAULT_AGENCY_CONFIG, ...value } as AgencyConfig
  const clampNumber = (candidate: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(candidate)
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
  }
  return {
    ...merged,
    contactMode: merged.contactMode === 'natural' || merged.contactMode === 'balanced' ? merged.contactMode : 'strict',
    naturalWillingnessThreshold: clampNumber(merged.naturalWillingnessThreshold, 0, 1, 0.25),
    naturalMinimumIntervalMinutes: Math.floor(clampNumber(merged.naturalMinimumIntervalMinutes, 0, 10_080, 30)),
    proactiveDailyCap: Math.floor(clampNumber(merged.proactiveDailyCap, 0, 20, 3)),
  }
}

export function normalizeAgencyWindowState(value: unknown): AgencyWindowState | undefined {
  if (!isRecord(value)) return undefined
  if (!['free', 'occupied', 'overloaded'].includes(String(value.activityLoad))) return undefined
  if (!['private', 'shared', 'public'].includes(String(value.privacy))) return undefined
  if (!['available', 'limited', 'unavailable'].includes(String(value.deviceAccess))) return undefined
  const validUntil = toDate(value.validUntil)
  const updatedAt = toDate(value.updatedAt)
  if (!validUntil || !updatedAt) return undefined
  const nextOpportunityAt = toDate(value.nextOpportunityAt)
  return {
    activityLoad: value.activityLoad as AgencyWindowState['activityLoad'],
    privacy: value.privacy as AgencyWindowState['privacy'],
    deviceAccess: value.deviceAccess as AgencyWindowState['deviceAccess'],
    nextOpportunityAt: nextOpportunityAt?.toISOString(),
    validUntil: validUntil.toISOString(),
    basis: text(value.basis, 500),
    sourceEntryIds: positiveIds(value.sourceEntryIds).slice(-20),
    updatedAt: updatedAt.toISOString(),
  }
}

export function normalizeAgencyWindowDraft(
  value: unknown,
  now: Date,
  config: AgencyConfig,
  validSourceEntryIds: ReadonlySet<number>,
  fallbackSourceEntryId?: number,
): AgencyWindowState | undefined {
  if (!isRecord(value)) return undefined
  if (!['free', 'occupied', 'overloaded'].includes(String(value.activityLoad))) return undefined
  if (!['private', 'shared', 'public'].includes(String(value.privacy))) return undefined
  if (!['available', 'limited', 'unavailable'].includes(String(value.deviceAccess))) return undefined
  const maximum = new Date(now.getTime() + Math.max(5, config.maxWindowMinutes) * MINUTE)
  const requestedUntil = toDate(value.validUntil)
  const validUntil = requestedUntil && requestedUntil > now
    ? new Date(Math.min(requestedUntil.getTime(), maximum.getTime()))
    : maximum
  const requestedOpportunity = toDate(value.nextOpportunityAt)
  const nextOpportunityAt = requestedOpportunity && requestedOpportunity > now
    ? new Date(Math.min(requestedOpportunity.getTime(), validUntil.getTime()))
    : undefined
  const sourceEntryIds = groundedIds(value.sourceEntryIds, validSourceEntryIds, fallbackSourceEntryId)
  const basis = text(value.basis, 500)
  if (!basis || !sourceEntryIds.length) return undefined
  return {
    activityLoad: value.activityLoad as AgencyWindowState['activityLoad'],
    privacy: value.privacy as AgencyWindowState['privacy'],
    deviceAccess: value.deviceAccess as AgencyWindowState['deviceAccess'],
    nextOpportunityAt: nextOpportunityAt?.toISOString(),
    validUntil: validUntil.toISOString(),
    basis,
    sourceEntryIds,
    updatedAt: now.toISOString(),
  }
}

export function activeAgencyWindow(value: unknown, now = new Date()) {
  const state = normalizeAgencyWindowState(value)
  return state && new Date(state.validUntil) > now ? state : undefined
}

export function normalizeProactiveContact(
  value: unknown,
  now: Date,
  config: AgencyConfig,
  permittedParticipantIds: ReadonlySet<string>,
  validSourceEntryIds: ReadonlySet<number>,
  fallbackSourceEntryId?: number,
): ProactiveContactDraft | undefined {
  if (!isRecord(value) || !permittedParticipantIds.has(String(value.participantId))) return undefined
  if (!['life-event', 'promise', 'practical-update', 'relationship-follow-up'].includes(String(value.origin))) return undefined
  if (!['ordinary', 'personal'].includes(String(value.disclosure))) return undefined
  if (!['send-now', 'recheck-later', 'let-go'].includes(String(value.outcome))) return undefined
  const motive = text(value.motive, 600)
  const sourceEntryIds = groundedIds(value.sourceEntryIds, validSourceEntryIds, fallbackSourceEntryId)
  if (!motive || !sourceEntryIds.length) return undefined
  const maximumExpiry = new Date(now.getTime() + Math.max(1, config.maxCandidateHours) * HOUR)
  const requestedExpiry = toDate(value.expiresAt)
  const expiresAt = requestedExpiry && requestedExpiry > now
    ? new Date(Math.min(requestedExpiry.getTime(), maximumExpiry.getTime()))
    : maximumExpiry
  const requestedNotBefore = toDate(value.notBefore)
  const notBefore = requestedNotBefore && requestedNotBefore > now && requestedNotBefore < expiresAt
    ? requestedNotBefore.toISOString()
    : undefined
  const willingness = finite(value.willingness)
  return {
    participantId: String(value.participantId),
    origin: value.origin as ProactiveContactDraft['origin'],
    motive,
    disclosure: value.disclosure as ProactiveContactDraft['disclosure'],
    sourceEntryIds,
    willingness: willingness === undefined ? undefined : clamp(willingness, 0, 1),
    outcome: value.outcome as ProactiveContactDraft['outcome'],
    notBefore,
    expiresAt: expiresAt.toISOString(),
  }
}

export function evaluateAgencyCapacity(
  window: AgencyWindowState | undefined,
  candidate: ProactiveContactDraft,
  now: Date,
  config: AgencyConfig,
  lastCharacterMessageAt?: string,
): AgencyCapacityResult {
  if (!window || new Date(window.validUntil) <= now) return { allowed: false, reason: 'agency-window-missing-or-expired' }
  const nextOpportunityAt = futureDate(window.nextOpportunityAt, now)
  if (window.deviceAccess === 'unavailable') return { allowed: false, reason: 'device-unavailable', nextOpportunityAt }
  if (window.deviceAccess === 'limited') return { allowed: false, reason: 'device-limited', nextOpportunityAt }
  if (window.activityLoad === 'overloaded') return { allowed: false, reason: 'schedule-overloaded', nextOpportunityAt }
  if (candidate.disclosure === 'personal' && window.privacy !== 'private') {
    return { allowed: false, reason: 'privacy-insufficient', nextOpportunityAt }
  }
  const lastContact = toDate(lastCharacterMessageAt)
  const minimumInterval = Math.max(0, config.minimumProactiveIntervalMinutes) * MINUTE
  if (candidate.origin !== 'promise' && lastContact && now.getTime() - lastContact.getTime() < minimumInterval) {
    return {
      allowed: false,
      reason: 'minimum-proactive-interval',
      nextOpportunityAt: new Date(lastContact.getTime() + minimumInterval),
    }
  }
  if (window.activityLoad === 'occupied' && candidate.origin !== 'promise' && candidate.origin !== 'practical-update') {
    return { allowed: false, reason: 'schedule-occupied', nextOpportunityAt }
  }
  return { allowed: true, reason: 'capacity-available' }
}

export function proactiveCandidateFingerprint(candidate: ProactiveContactDraft) {
  return [
    candidate.participantId,
    candidate.origin,
    [...(candidate.sourceEntryIds ?? [])].sort((a, b) => a - b).join(','),
  ].join('|')
}

export function proactiveRecheckAt(candidate: ProactiveContactDraft, capacity: AgencyCapacityResult, window: AgencyWindowState, now: Date) {
  const requested = toDate(candidate.notBefore)
  const capacityTime = capacity.nextOpportunityAt
  const windowTime = toDate(window.nextOpportunityAt)
  const fallback = new Date(now.getTime() + 30 * MINUTE)
  const selected = [requested, capacityTime, windowTime]
    .filter((value): value is Date => !!value && value > now)
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? fallback
  const expiry = toDate(candidate.expiresAt) ?? new Date(now.getTime() + HOUR)
  return new Date(Math.min(selected.getTime(), expiry.getTime()))
}

function groundedIds(value: unknown, valid: ReadonlySet<number>, fallback?: number) {
  const ids = positiveIds(value).filter(id => valid.has(id))
  if (!ids.length && fallback && fallback > 0) ids.push(fallback)
  return Array.from(new Set(ids)).slice(-20)
}

function positiveIds(value: unknown) {
  return Array.isArray(value)
    ? value.map(Number).filter(id => Number.isInteger(id) && id > 0)
    : []
}

function futureDate(value: unknown, now: Date) {
  const date = toDate(value)
  return date && date > now ? date : undefined
}

function toDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function finite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
