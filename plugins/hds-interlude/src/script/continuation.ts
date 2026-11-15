import type { ScriptEntry } from '../types'

/** A bookmark into the visible originals, not another summary or scene author.
 * Communication references record occurrences, never infer an unanswered debt. */
export function continuationBookmark(entries: ScriptEntry[], from: Date, now: Date) {
  const visible = entries.filter(entry => entry.occurredAt <= now)
  const lastScript = visible.filter(entry => entry.kind === 'script' && entry.occurredAt <= from).at(-1)
  const reference = (entry: ScriptEntry) => ({
    entryId: entry.id, kind: entry.kind, participantId: entry.participantId,
    occurredAt: entry.occurredAt.toISOString(),
  })
  return {
    establishedThrough: from.toISOString(),
    ...(lastScript ? { lastScript: reference(lastScript) } : {}),
    writingStart: 'after-last-completed-passage',
    ...(lastScript ? { originalEndpoint: { entryId: lastScript.id, characterOffset: lastScript.content.length } } : {}),
    // A new batch is not another copy of recent dialogue. Original references
    // let short follow-ups retain the objection/question they actually answer.
    newEventEntryIds: visible.filter(entry => entry.kind === 'user-message' && entry.occurredAt > from).map(entry => entry.id),
    // These pointers resolve within recentScript; no second copy of dialogue.
    recentCommunications: visible.filter(entry => (entry.kind !== 'user-message' || entry.occurredAt <= from)
      && ['user-message', 'character-message', 'character-group-message', 'character-platform-action'].includes(entry.kind))
      .slice(-4).map(reference),
  }
}

/** Diagnostic only: long literal reuse is evidence to inspect, not a literary
 * rejection rule. Identical short questions must never be treated as a fault. */
export function proseReuseObservation(previous: string, next: string, width = 40) {
  if (previous.length < width || next.length < width) return 0
  const spans = new Set<string>()
  for (let i = 0; i <= previous.length - width; i++) spans.add(previous.slice(i, i + width))
  let covered = 0
  let end = 0
  for (let i = 0; i <= next.length - width; i++) {
    if (!spans.has(next.slice(i, i + width))) continue
    covered += Math.max(0, i + width - Math.max(end, i))
    end = i + width
  }
  return covered / next.length
}
