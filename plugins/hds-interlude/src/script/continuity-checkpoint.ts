import { CompactionDecision, ScriptEntry } from '../types'

/** A checkpoint consumes a contiguous prefix. Keeping the newest suffix here
 * would permanently skip the older evidence when lastEntryId advances. */
export function compactionPrefix(entries: ScriptEntry[], budget: number) {
  const selected: ScriptEntry[] = []
  let used = 0
  for (const entry of entries) {
    if (selected.length && used + entry.content.length > budget) break
    selected.push(entry)
    used += entry.content.length
  }
  return selected
}

export function assertContinuityReview(decision: CompactionDecision) {
  // An empty/silent provider response must leave the evidence available for retry.
  if (!decision.scene?.summary?.trim() || !decision.arc?.summary?.trim()) {
    throw new Error('Continuity review needs both scene and arc summaries; checkpoint retained for retry')
  }
}
