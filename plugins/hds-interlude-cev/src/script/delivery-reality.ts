import type { ScriptEntry } from '../types'
import { formatStoryClock } from '../time'

/** Message bubbles are the only ledger kind whose content is full prose. The
 * prompt keeps just enough code points to identify the bubble inside its own
 * script entry — the original text is already carried by recentScript (or the
 * compaction payload's entries), so projecting it again is pure duplication.
 * Identifier kinds (local-media assetId, native-face semantic, message-reaction
 * refs) stay intact: that short string is the identity, not prose. */
const MESSAGE_HEAD_CODE_POINTS = 12
const DEFAULT_DELIVERY_REALITY_LIMIT = 8
const DEFAULT_DELIVERY_REALITY_BUDGET = 2_000

export interface DeliveryRealityOptions {
  limit?: number
  characterBudget?: number
  timezone?: string
}

/** Truncated pointer into message prose, shared by prompt-side anchors
 * (deliveryReality segments, recentExchange) so every "head" in the payload
 * follows the same code-point convention. */
export function messageHead(content: string) {
  const points = Array.from(content)
  if (points.length <= MESSAGE_HEAD_CODE_POINTS) return content
  return `${points.slice(0, MESSAGE_HEAD_CODE_POINTS).join('')}…`
}

function segmentHead(kind: string, content: string) {
  if (kind !== 'message') return content
  return messageHead(content)
}

function receiptClock(segment: Record<string, unknown>, timezone: string | undefined) {
  if (!timezone) return ''
  const stamp = typeof segment.completedAt === 'string' ? segment.completedAt
    : typeof segment.attemptedAt === 'string' ? segment.attemptedAt : ''
  if (!stamp) return ''
  return formatStoryClock(new Date(stamp), timezone)
}

/** Only call with entries already filtered for the current relationship.
 * This is an execution annotation of the same script, never replacement
 * prose: outcomes, bubble order and receipt clocks travel; message text
 * stays in the entry itself. Character budget keeps the newest actions and
 * lets one intact action overflow it (same soft-budget semantics as
 * compactPromptEntries) rather than truncating mid-segment. */
export function deliveryReality(
  entries: ScriptEntry[],
  participantId?: string,
  shareParticipantDetails = false,
  options: DeliveryRealityOptions = {},
) {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_DELIVERY_REALITY_LIMIT))
  const characterBudget = Math.max(200, Math.floor(options.characterBudget ?? DEFAULT_DELIVERY_REALITY_BUDGET))
  const timezone = options.timezone?.trim() || undefined
  const projected: Array<Record<string, unknown>> = []
  for (const entry of entries) {
    if (entry.kind !== 'script') continue
    const actions = entry.metadata?.deliveryActions
    if (!Array.isArray(actions)) continue
    if (!actions.length && entry.metadata?.commitId) {
      projected.push({ sourceEntryId: entry.id, eventId: '', segments: [], communicationOutcome: 'no-outgoing-action-recorded' })
      continue
    }
    for (const action of actions) {
      if (!action || action.commitId !== entry.metadata.commitId || !Array.isArray(action.segments)) continue
      if (action.participantId && action.participantId !== participantId && !shareParticipantDetails) continue
      const segments = action.segments.filter((item: any) => item && typeof item.content === 'string'
        && ['pending', 'delivered', 'failed', 'cancelled'].includes(item.status))
      if (!segments.some((item: any) => item.status !== 'delivered')) continue
      projected.push({
        sourceEntryId: entry.id,
        eventId: action.eventId,
        eventKind: typeof action.eventKind === 'string' ? action.eventKind : 'outgoing-message',
        segments: segments.map((item: any, position: number) => {
          const kind = String(item.kind ?? 'message')
          const at = receiptClock(item, timezone)
          return {
            index: Number.isSafeInteger(item.index) ? item.index : position,
            kind,
            head: segmentHead(kind, String(item.content)),
            outcome: item.status === 'pending' ? 'not-confirmed' : item.status === 'failed' ? 'delivery-not-confirmed-after-error' : item.status,
            ...(at ? { at } : {}),
          }
        }),
      })
    }
  }
  const limited = projected.slice(-limit)
  const kept: Array<Record<string, unknown>> = []
  let remaining = characterBudget
  for (let index = limited.length - 1; index >= 0; index--) {
    const size = JSON.stringify(limited[index]).length
    if (kept.length && size > remaining) break
    kept.unshift(limited[index])
    remaining -= size
  }
  return kept
}
