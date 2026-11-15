import { calendarDayKey, localClockMinutes } from '../time'
import type { NarrativePhase, SchedulePreplanWindow } from '../types'

/** Routing changes model work, never prose resolution. A known schedule
 * boundary keeps the temporal editor even during a short conversation. */
export function needsTimelineDirector(phase: NarrativePhase, from: Date, now: Date, timezone: string, schedule?: SchedulePreplanWindow | null) {
  if (phase === 'user-message') return false
  if (phase === 'advance' || now.getTime() - from.getTime() > 20 * 60_000) return true
  if (calendarDayKey(from, timezone) !== calendarDayKey(now, timezone)) return true
  const start = localClockMinutes(from, timezone)
  const end = localClockMinutes(now, timezone)
  return !!schedule?.blocks.some(block => block.date === calendarDayKey(now, timezone)
    && [block.start, block.end].some(clock => {
      const [hour, minute] = clock.split(':').map(Number)
      return hour * 60 + minute > start && hour * 60 + minute <= end
    }))
}
