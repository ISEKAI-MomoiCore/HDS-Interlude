import { calendarDayKey, localClockMinutes, storyLocalTimeContext } from './time'
import {
  SchedulePreplanBlock, SchedulePreplanBlockKind, SchedulePreplanDay, SchedulePreplanException,
  SchedulePreplanProposal, SchedulePreplanRecord, SchedulePreplanRegime, SchedulePreplanWeekday,
  SchedulePreplanWindow, ScriptEntry,
} from './types'

export interface SchedulePreplanConfig {
  enabled: boolean
  horizonDays: number
  reviewAfterLocalHour: number
  anchorAutoAdvance: boolean
  variationLevel: 'stable' | 'contextual' | 'granular'
  candidateActivationProbability: number
  candidateRevealMinutes: number
}

export const DEFAULT_SCHEDULE_PREPLAN_CONFIG: SchedulePreplanConfig = {
  enabled: true,
  horizonDays: 14,
  reviewAfterLocalHour: 3,
  anchorAutoAdvance: true,
  variationLevel: 'stable',
  candidateActivationProbability: 0.25,
  candidateRevealMinutes: 120,
}

const WEEKDAYS: SchedulePreplanWeekday[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]
const KINDS: SchedulePreplanBlockKind[] = ['fixed', 'routine', 'flexible', 'open']
const PRIORITY: Record<SchedulePreplanBlockKind, number> = { fixed: 4, routine: 3, flexible: 2, open: 1 }

export function resolveSchedulePreplanConfig(value?: Partial<SchedulePreplanConfig>): SchedulePreplanConfig {
  return {
    enabled: value?.enabled !== false,
    horizonDays: clampInt(value?.horizonDays, 3, 30, 14),
    reviewAfterLocalHour: clampInt(value?.reviewAfterLocalHour, 0, 23, 3),
    anchorAutoAdvance: value?.anchorAutoAdvance !== false,
    variationLevel: ['stable', 'contextual', 'granular'].includes(String(value?.variationLevel))
      ? value!.variationLevel as SchedulePreplanConfig['variationLevel'] : 'stable',
    candidateActivationProbability: clampNumber(value?.candidateActivationProbability, 0.05, 0.5, 0.25),
    candidateRevealMinutes: clampInt(value?.candidateRevealMinutes, 15, 360, 120),
  }
}

export function normalizeSchedulePreplanRecord(value: unknown): SchedulePreplanRecord | undefined {
  if (!isRecord(value) || typeof value.storyId !== 'string') return undefined
  const validFrom = dateKey(value.validFrom)
  const validThrough = dateKey(value.validThrough)
  if (!validFrom || !validThrough) return undefined
  return {
    storyId: value.storyId,
    revision: clampInt(value.revision, 0, 1_000_000, 0),
    timezone: text(value.timezone, 127) || 'UTC',
    validFrom,
    validThrough,
    lastReviewedLocalDate: dateKey(value.lastReviewedLocalDate) ?? '',
    lastEvidenceEntryId: clampInt(value.lastEvidenceEntryId, 0, Number.MAX_SAFE_INTEGER, 0),
    reviewReason: text(value.reviewReason, 500),
    regimes: normalizeRegimes(value.regimes),
    exceptions: normalizeExceptions(value.exceptions),
    materializedDays: normalizeDays(value.materializedDays),
    createdAt: validDate(value.createdAt) ?? new Date(0),
    updatedAt: validDate(value.updatedAt) ?? new Date(0),
  }
}

export function schedulePreplanReviewDue(record: SchedulePreplanRecord | undefined, now: Date, timezone: string, config: SchedulePreplanConfig) {
  if (!config.enabled) return false
  const today = calendarDayKey(now, timezone)
  if (!record) return true
  if (record.timezone !== timezone) return true
  return record.lastReviewedLocalDate !== today && localClockMinutes(now, timezone) >= config.reviewAfterLocalHour * 60
}

/** 当天例外的确定性触发词：取消/改期/新确认安排在已提交剧本中的语言痕迹。
 * 只作"是否值得跟进审查"的廉价预筛——是否真登记例外仍由审查模型依据
 * 证据判定（愿望与未实现计划在教学行里被明确排除，见 schedulePreplanPrompt）。 */
const DATE_CHANGE_TRIGGER = /取消|改期|改成|推迟|提前到|延到|改约|另约|延期|定在|敲定|约好|约了|确认了?(时间|地点|日子)?/

/** 未读证据里出现改约/取消/新确认信号 → 返回命中条目 id（去重，至多 20）。
 * 输入与 schedulePreplanEvidence 同源（kind=script 的剧本条目）；世界事件/
 * 好友动态/空间条目是外部观测，不进入该管道，天然不构成她的日程改变。 */
export function schedulePreplanEvidenceMentionsDateChange(entries: ReadonlyArray<Pick<ScriptEntry, 'id' | 'content'>>): number[] {
  const matched: number[] = []
  for (const entry of entries) {
    if (Number.isSafeInteger(entry.id) && entry.id > 0 && DATE_CHANGE_TRIGGER.test(String(entry.content ?? ''))) matched.push(entry.id)
  }
  return [...new Set(matched)].slice(0, 20)
}

export const SCHEDULE_PREPLAN_FOLLOWUP_COOLDOWN_MS = 2 * 60 * 60_000

/** 当天跟进审查是否到期：日审查已完成后（reviewDue=false 的场景），
 * 未读证据出现改约信号且冷却已过 → 允许一次带外审查。此前单次改约要等
 * 到次日审查才入例外，而那个改约属于"今天"（backlog：当天例外的及时收束）。 */
export function schedulePreplanFollowUpDue(
  record: SchedulePreplanRecord | undefined,
  unseenEvidence: ReadonlyArray<Pick<ScriptEntry, 'id' | 'content'>>,
  now: Date,
  config: SchedulePreplanConfig,
) {
  if (!config.enabled || !record) return false
  if (schedulePreplanReviewDue(record, now, record.timezone, config)) return false
  if (now.getTime() - record.updatedAt.getTime() < SCHEDULE_PREPLAN_FOLLOWUP_COOLDOWN_MS) return false
  return schedulePreplanEvidenceMentionsDateChange(unseenEvidence).length > 0
}

export function schedulePreplanNeedsModel(
  record: SchedulePreplanRecord | undefined,
  evidence: ScriptEntry[],
  today: string,
  timezone: string,
  config: SchedulePreplanConfig,
) {
  if (!record || record.timezone !== timezone) return true
  if (evidence.some(entry => entry.id > record.lastEvidenceEntryId)) return true
  // An explicit empty record means “reviewed, but no reliable recurring
  // schedule exists yet”. It must not cause a model request on every sweep.
  if (!record.regimes.length) return false
  const coverageTarget = addDate(today, Math.max(1, config.horizonDays - 3))
  if (!record.regimes.some(regime => regime.from <= coverageTarget && (!regime.to || regime.to >= coverageTarget))) return true
  return record.validThrough < coverageTarget
}

export function refreshSchedulePreplan(
  record: SchedulePreplanRecord,
  today: string,
  timezone: string,
  config: SchedulePreplanConfig,
  now: Date,
  reason = 'Daily review found no schedule-changing evidence.',
): SchedulePreplanRecord {
  const validThrough = addDate(today, config.horizonDays - 1)
  return {
    ...record,
    timezone,
    validFrom: today,
    validThrough,
    lastReviewedLocalDate: today,
    reviewReason: reason,
    materializedDays: materializeSchedulePreplan(record.regimes, record.exceptions, today, config.horizonDays),
    updatedAt: now,
  }
}

export function applySchedulePreplanProposal(
  current: SchedulePreplanRecord | undefined,
  proposalValue: unknown,
  evidence: ScriptEntry[],
  today: string,
  timezone: string,
  config: SchedulePreplanConfig,
  now: Date,
  variationLevel: SchedulePreplanConfig['variationLevel'] = 'stable',
): SchedulePreplanRecord | undefined {
  const proposal = normalizeProposal(proposalValue, new Set(evidence.map(entry => entry.id)), variationLevel)
  if (!proposal) return current ? refreshSchedulePreplan(current, today, timezone, config, now, 'Invalid proposal ignored; existing Schedule Preplan retained.') : undefined
  if (proposal.outcome === 'unchanged' && current) {
    return {
      ...refreshSchedulePreplan(current, today, timezone, config, now, proposal.reason),
      lastEvidenceEntryId: Math.max(current.lastEvidenceEntryId, ...evidence.map(entry => entry.id), 0),
    }
  }

  let regimes = current?.regimes ?? []
  let exceptions = current?.exceptions ?? []
  if (proposal.outcome === 'replace' || !current) {
    regimes = proposal.regimes ?? []
    exceptions = proposal.exceptions ?? []
  } else {
    regimes = mergeBy(regimes, proposal.regimes ?? [], item => item.id)
    exceptions = mergeBy(exceptions, proposal.exceptions ?? [], item => item.date)
  }
  if (!regimes.length && !exceptions.length) {
    // Empty is a valid initial result when the story has not established any
    // recurring rhythm. Persist that review so the system waits for new
    // evidence instead of repeatedly paying for the same empty conclusion.
    // (单次安排住在 exceptions 里:没有重复规律 ≠ 没有任何日程,两者分开判断)
    if (!current) {
      return {
        storyId: '', revision: 1, timezone, validFrom: today, validThrough: addDate(today, config.horizonDays - 1),
        lastReviewedLocalDate: today,
        lastEvidenceEntryId: Math.max(...evidence.map(entry => entry.id), 0),
        reviewReason: proposal.reason,
        regimes: [], exceptions: [], materializedDays: [], createdAt: now, updatedAt: now,
      }
    }
    return refreshSchedulePreplan(current, today, timezone, config, now, 'Empty proposal ignored; existing Schedule Preplan retained.')
  }
  const validThrough = addDate(today, config.horizonDays - 1)
  const retainedRegimes = retainSchedulePreplanRegimes(regimes, today, config.horizonDays)
  const retainedExceptions = retainSchedulePreplanExceptions(exceptions, today, validThrough)
  return {
    storyId: current?.storyId ?? '',
    revision: (current?.revision ?? 0) + 1,
    timezone,
    validFrom: today,
    validThrough,
    lastReviewedLocalDate: today,
    lastEvidenceEntryId: Math.max(current?.lastEvidenceEntryId ?? 0, ...evidence.map(entry => entry.id), 0),
    reviewReason: proposal.reason,
    // Keep every effective stage in the window (including yesterday's overnight
    // segment), rather than evicting today's plan when a future stage is added.
    regimes: retainedRegimes,
    exceptions: retainedExceptions,
    materializedDays: materializeSchedulePreplan(retainedRegimes, retainedExceptions, today, config.horizonDays),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  }
}

function retainSchedulePreplanRegimes(regimes: SchedulePreplanRegime[], today: string, horizonDays: number) {
  const retained = new Set<SchedulePreplanRegime>()
  for (let offset = -1; offset < Math.max(1, horizonDays); offset++) {
    const date = addDate(today, offset)
    const matching = regimes.filter(regime => regime.from <= date && (!regime.to || regime.to >= date))
      .sort((left, right) => right.from.localeCompare(left.from))[0]
    if (matching) retained.add(matching)
  }
  const validThrough = addDate(today, horizonDays - 1)
  for (const regime of regimes.filter(item => item.from > validThrough)
    .sort((left, right) => left.from.localeCompare(right.from)).slice(0, 6)) retained.add(regime)
  return regimes.filter(item => retained.has(item))
}

function retainSchedulePreplanExceptions(exceptions: SchedulePreplanException[], today: string, validThrough: string) {
  const upcoming = exceptions.filter(item => item.date >= addDate(today, -1))
    .sort((left, right) => left.date.localeCompare(right.date))
  return [...upcoming.filter(item => item.date <= validThrough), ...upcoming.filter(item => item.date > validThrough).slice(0, 6)]
}

export function materializeSchedulePreplan(regimes: SchedulePreplanRegime[], exceptions: SchedulePreplanException[], startDate: string, horizonDays: number): SchedulePreplanDay[] {
  const days: SchedulePreplanDay[] = []
  // 从 -1 开始物化:昨日开始的跨夜安排(end<=start)在今日凌晨仍是进行中,
  // 只物化今天会让值夜班/通宵出行在午夜后从日程里凭空消失
  for (let offset = -1; offset < Math.max(1, horizonDays); offset++) {
    const date = addDate(startDate, offset)
    const matching = regimes
      .filter(regime => regime.from <= date && (!regime.to || regime.to >= date))
      .sort((left, right) => right.from.localeCompare(left.from))[0]
    const weekday = WEEKDAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()]
    let blocks = matching?.weekly[weekday]?.map(block => ({ ...block })) ?? []
    const exception = exceptions.find(item => item.date === date)
    if (exception?.mode === 'replace') blocks = exception.blocks?.map(block => ({ ...block })) ?? []
    else if (exception) {
      const removed = new Set(exception.removeBlockIds ?? [])
      blocks = [...blocks.filter(block => !removed.has(block.id)), ...(exception.blocks ?? []).map(block => ({ ...block }))]
    }
    days.push({ date, blocks: resolveOverlaps(blocks).slice(0, 12) })
  }
  return days
}

/** Project only the coming twelve hours; the rest of the stored horizon never enters the main prompt. */
export function schedulePreplanWindow(record: SchedulePreplanRecord | undefined, now: Date, timezone: string, hours = 12, config: Pick<SchedulePreplanConfig, 'candidateActivationProbability' | 'candidateRevealMinutes'> = DEFAULT_SCHEDULE_PREPLAN_CONFIG): SchedulePreplanWindow | null {
  if (!record || record.timezone !== timezone) return null
  const local = storyLocalTimeContext(now, timezone)
  const today = local.date
  const startMinute = local.hour * 60 + Number(local.time.slice(3, 5))
  const endMinute = startMinute + Math.max(1, hours) * 60
  const blocks: SchedulePreplanWindow['blocks'] = []
  for (const day of record.materializedDays) {
    const dayOffset = dateDifference(today, day.date)
    // -1 允许昨日跨夜安排(23:00–次日 07:00)的剩余区间进入窗口;
    // 块级 start/end 比较会自然过滤早已结束的昨日块
    if (dayOffset < -1 || dayOffset > 1) continue
    for (const block of day.blocks) {
      const start = dayOffset * 1_440 + timeMinutes(block.start)
      let end = dayOffset * 1_440 + timeMinutes(block.end)
      if (end <= start) end += 1_440
      if (end <= startMinute || start >= endMinute) continue
      if (block.tentative) {
        if (!isTentativeBlockActive(record.storyId, day.date, block.id, config.candidateActivationProbability)) continue
        const minutesUntil = (start - startMinute)
        if (minutesUntil > config.candidateRevealMinutes) {
          blocks.push({ ...block, label: '可能的个人安排', location: undefined, date: day.date, tentative: true })
          continue
        }
      }
      blocks.push({ ...block, date: day.date })
    }
  }
  const toTotal = endMinute
  const toDate = addDate(today, Math.floor(toTotal / 1_440))
  const toClock = clock(toTotal % 1_440)
  return {
    name: 'Schedule Preplan', timezone,
    from: `${today} ${clock(startMinute)}`,
    to: `${toDate} ${toClock}`,
    plannedNotObserved: true,
    revision: record.revision,
    blocks: blocks.slice(0, 8),
  }
}

export function nextSchedulePreplanTransition(record: SchedulePreplanRecord | undefined, now: Date, timezone: string, maxHours = 12) {
  const window = schedulePreplanWindow(record, now, timezone, maxHours)
  if (!window) return undefined
  const local = storyLocalTimeContext(now, timezone)
  const current = local.hour * 60 + Number(local.time.slice(3, 5))
  const candidates: number[] = []
  for (const block of window.blocks.filter(item => item.kind === 'fixed')) {
    const offset = dateDifference(local.date, block.date) * 1_440
    const start = offset + timeMinutes(block.start)
    let end = offset + timeMinutes(block.end)
    if (end <= start) end += 1_440
    if (start > current) candidates.push(start)
    if (end > current) candidates.push(end)
  }
  const next = candidates.sort((left, right) => left - right)[0]
  return next == null ? undefined : new Date(now.getTime() + (next - current) * 60_000)
}

function normalizeProposal(value: unknown, validEvidenceIds: ReadonlySet<number>, variationLevel: SchedulePreplanConfig['variationLevel']): SchedulePreplanProposal | undefined {
  if (!isRecord(value) || !['unchanged', 'extend', 'patch', 'replace'].includes(String(value.outcome))) return undefined
  const outcome = value.outcome as SchedulePreplanProposal['outcome']
  const reason = text(value.reason, 500)
  if (!reason) return undefined
  const sourceEntryIds = ids(value.sourceEntryIds).filter(id => validEvidenceIds.has(id))
  const allowTentative = variationLevel === 'granular'
  const regimes = normalizeRegimes(value.regimes, validEvidenceIds, allowTentative, 6)
  const exceptions = normalizeExceptions(value.exceptions, validEvidenceIds, allowTentative, 30)
  if ((outcome === 'patch' || outcome === 'replace') && validEvidenceIds.size && !sourceEntryIds.length && !regimes.some(item => item.sourceEntryIds?.length) && !exceptions.some(item => item.sourceEntryIds?.length)) return undefined
  return { outcome, reason, confidence: finite(value.confidence), sourceEntryIds, regimes, exceptions }
}

function normalizeRegimes(value: unknown, validEvidenceIds?: ReadonlySet<number>, allowTentative = true, limit = 64) {
  if (!Array.isArray(value)) return []
  return value.map(item => normalizeRegime(item, validEvidenceIds, allowTentative)).filter((item): item is SchedulePreplanRegime => !!item).slice(0, limit)
}

function normalizeRegime(value: unknown, validEvidenceIds?: ReadonlySet<number>, allowTentative = true): SchedulePreplanRegime | undefined {
  if (!isRecord(value) || !isRecord(value.weekly)) return undefined
  const id = slug(value.id, 80)
  const label = text(value.label, 120)
  const from = dateKey(value.from)
  const to = dateKey(value.to)
  if (!id || !label || !from || to && to < from) return undefined
  const weekly: SchedulePreplanRegime['weekly'] = {}
  for (const weekday of WEEKDAYS) {
    const blocks = normalizeBlocks(value.weekly[weekday], validEvidenceIds, allowTentative)
    if (blocks.length) weekly[weekday] = blocks
  }
  return { id, label, from, ...(to ? { to } : {}), weekly, sourceEntryIds: evidenceIds(value.sourceEntryIds, validEvidenceIds) }
}

function normalizeExceptions(value: unknown, validEvidenceIds?: ReadonlySet<number>, allowTentative = true, limit = 64) {
  if (!Array.isArray(value)) return []
  return value.map(item => normalizeException(item, validEvidenceIds, allowTentative)).filter((item): item is SchedulePreplanException => !!item).slice(0, limit)
}

function normalizeException(value: unknown, validEvidenceIds?: ReadonlySet<number>, allowTentative = true): SchedulePreplanException | undefined {
  if (!isRecord(value)) return undefined
  const date = dateKey(value.date)
  const mode = value.mode === 'replace' ? 'replace' as const : value.mode === 'patch' ? 'patch' as const : undefined
  const reason = text(value.reason, 300)
  if (!date || !mode || !reason) return undefined
  return {
    date, mode, reason,
    removeBlockIds: Array.isArray(value.removeBlockIds) ? value.removeBlockIds.map(item => slug(item, 80)).filter(Boolean).slice(0, 20) : [],
    blocks: normalizeBlocks(value.blocks, validEvidenceIds, allowTentative),
    sourceEntryIds: evidenceIds(value.sourceEntryIds, validEvidenceIds),
  }
}

function normalizeDays(value: unknown): SchedulePreplanDay[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => isRecord(item) && dateKey(item.date)
    ? [{ date: dateKey(item.date)!, blocks: normalizeBlocks(item.blocks) }]
    : []).slice(0, 31)
}

function normalizeBlocks(value: unknown, validEvidenceIds?: ReadonlySet<number>, allowTentative = true) {
  if (!Array.isArray(value)) return []
  return value.map(item => normalizeBlock(item, validEvidenceIds, allowTentative)).filter((item): item is SchedulePreplanBlock => !!item).slice(0, 20)
}

function normalizeBlock(value: unknown, validEvidenceIds?: ReadonlySet<number>, allowTentative = true): SchedulePreplanBlock | undefined {
  if (!isRecord(value)) return undefined
  const id = slug(value.id, 80)
  const start = timeKey(value.start)
  const end = timeKey(value.end)
  const label = text(value.label, 160)
  const kind = KINDS.includes(value.kind as SchedulePreplanBlockKind) ? value.kind as SchedulePreplanBlockKind : undefined
  if (!id || !start || !end || start === end || !label || !kind) return undefined
  const location = text(value.location, 120)
  // 候选模式未启用时,模型违规返回的 tentative 块明确丢弃——擦掉标志把它
  // 转成普通日程等于把不确定安排升级为已确认,失去候选激活/隐藏机制
  if (value.tentative === true && (!allowTentative || kind === 'fixed' || kind === 'routine')) return undefined
  const tentative = allowTentative && value.tentative === true && (kind === 'flexible' || kind === 'open')
  return { id, start, end, label, kind, ...(location ? { location } : {}), ...(tentative ? { tentative: true } : {}), sourceEntryIds: evidenceIds(value.sourceEntryIds, validEvidenceIds) }
}

function isTentativeBlockActive(storyId: string, date: string, blockId: string, probability: number) {
  const input = `${storyId}|${date}|${blockId}`
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619)
  return ((hash >>> 0) / 0x1_0000_0000) < probability
}

function resolveOverlaps(blocks: SchedulePreplanBlock[]) {
  const chosen: SchedulePreplanBlock[] = []
  for (const candidate of [...blocks].sort((left, right) => PRIORITY[right.kind] - PRIORITY[left.kind] || timeMinutes(left.start) - timeMinutes(right.start))) {
    const start = timeMinutes(candidate.start)
    let end = timeMinutes(candidate.end)
    if (end <= start) end += 1_440
    const overlaps = chosen.some(block => {
      const otherStart = timeMinutes(block.start)
      let otherEnd = timeMinutes(block.end)
      if (otherEnd <= otherStart) otherEnd += 1_440
      return start < otherEnd && end > otherStart
    })
    if (!overlaps && !chosen.some(block => block.id === candidate.id)) chosen.push(candidate)
  }
  return chosen.sort((left, right) => timeMinutes(left.start) - timeMinutes(right.start))
}

function evidenceIds(value: unknown, valid?: ReadonlySet<number>) {
  const normalized = ids(value)
  return valid ? normalized.filter(id => valid.has(id)) : normalized
}

function ids(value: unknown) {
  return Array.isArray(value) ? Array.from(new Set(value.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))).slice(0, 30) : []
}

function mergeBy<T>(current: T[], changes: T[], key: (item: T) => string) {
  const merged = new Map(current.map(item => [key(item), item]))
  for (const item of changes) merged.set(key(item), item)
  return [...merged.values()]
}

function dateKey(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined
  const date = new Date(`${raw}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : undefined
}

function addDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dateDifference(left: string, right: string) {
  return Math.round((new Date(`${right}T00:00:00.000Z`).getTime() - new Date(`${left}T00:00:00.000Z`).getTime()) / 86_400_000)
}

function timeKey(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const match = /^(\d{2}):(\d{2})$/.exec(raw)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined
  return raw
}

function timeMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function clock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function slug(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().replace(/[^\p{L}\p{N}_-]/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, limit) : ''
}

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().replace(/[\r\n]+/g, ' ').slice(0, limit) : ''
}

function finite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined
}

function validDate(value: unknown) {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : undefined
  return date && !Number.isNaN(date.getTime()) ? date : undefined
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
