import { AgencyConfig, AgencyWindowState } from './types'

const MINUTE = 60_000

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


function toDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
