import type { ScriptEntry, StatePatchDraft, StatePatchProposal } from '../types'

/** References into the supplied originals keep observation, interpretation
 * and reception together without writing another psychological summary. */
export function interactionEvidence(entries: ScriptEntry[]) {
  const ordered = [...entries].sort((a, b) => a.id - b.id)
  return ordered.filter(entry => entry.kind === 'user-message').slice(-16).map(feedback => {
    const branch = ordered.filter(entry => entry.participantId === feedback.participantId)
    const next = branch.find(entry => entry.id > feedback.id && entry.kind === 'user-message')?.id ?? Infinity
    return {
      participantId: feedback.participantId, feedbackEntryId: feedback.id,
      priorCommunicationEntryId: branch.filter(entry => entry.id < feedback.id && entry.kind === 'character-message').at(-1)?.id,
      interpretationEntryIds: branch.filter(entry => entry.id > feedback.id && entry.id < next && entry.kind === 'script').map(entry => entry.id),
      responseEntryIds: branch.filter(entry => entry.id > feedback.id && entry.id < next && entry.kind === 'character-message').map(entry => entry.id),
    }
  })
}

export function reviewedDevelopmentSupport(draft: StatePatchDraft, entries: ScriptEntry[], participantId: string) {
  const review = draft.interactionReview
  if (!review || review.outcome !== 'supported' || !Array.isArray(review.feedbackEntryIds) || !Array.isArray(review.responseEntryIds)) return false
  const cited = new Set(draft.sourceEntryIds ?? [])
  const valid = (id: number, kind: string) => cited.has(id) && entries.some(entry => entry.id === id
    && entry.kind === kind && entry.participantId === participantId)
  return review.feedbackEntryIds.length > 0 && review.responseEntryIds.length > 0
    && review.feedbackEntryIds.every(id => valid(id, 'user-message'))
    && review.responseEntryIds.every(id => valid(id, 'character-message'))
    && review.responseEntryIds.some(id => id > Math.max(...review.feedbackEntryIds))
}

/** A quiet turn still has a life context. Use visible original text only as a
 * relevance query, never as a fresh learning observation or evidence weight. */
export function developmentContextQuery(userMessage: string | undefined, dueSummaries: string[], visibleEntries: ScriptEntry[]) {
  if (userMessage?.trim()) return userMessage.trim()
  const lastScript = visibleEntries.filter(entry => entry.kind === 'script').at(-1)
  return [...dueSummaries, lastScript?.content.slice(-800) ?? ''].filter(Boolean).join('\n').slice(0, 1_200)
}

const dimensions: Record<string, string[]> = {
  character: ['traits', 'preferences', 'coping'],
  perspective: ['values', 'interpretation'],
  relationship: ['trust', 'closeness', 'boundaries'],
  world: ['established'],
}

/** Canon stays intact. New development proposals use a small vocabulary. */
export function developmentDimension(target: StatePatchDraft['target'], path: string) {
  const normalized = path.trim().replace(/^(development|character|perspective|relationship|world)\./, '')
  return dimensions[target]?.includes(normalized) ? normalized : undefined
}

/** Count distinct narrative turns by their occurrence timestamp.
 * Multiple storage rows emitted for the same turn count once, while repeated
 * turns in one long-lived scene remain valid evidence for gradual evolution. */
export function developmentTurns(entries: ScriptEntry[]) {
  const narrative = entries.filter(entry => entry.kind === 'script' || entry.actor === 'narrator')
  return new Set(narrative.map(entry => entry.occurredAt.getTime())).size
}

/** One completed scene contributes once regardless of prose length or turns.
 * Legacy rows without scene provenance remain readable but cannot multiply
 * scene evidence by their timestamps. */
export function developmentScenes(entries: ScriptEntry[]) {
  const checkpoints = entries.flatMap(entry => {
    const checkpoint = entry.metadata?.sceneCheckpoint
    return checkpoint && typeof checkpoint === 'object' ? [checkpoint as Record<string, any>] : []
  })
  const scenes = new Set<string>()
  const frameScenes = new Map<string, string>()
  for (const entry of entries) {
    const checkpoint = checkpoints.find(item => Number.isSafeInteger(item.sceneId)
      && entry.id >= item.firstEntryId && entry.id <= item.lastEntryId)
    if (checkpoint && typeof entry.metadata?.frameId === 'string') frameScenes.set(entry.metadata.frameId, `scene:${checkpoint.sceneId}`)
  }
  for (const entry of entries.filter(entry => entry.kind === 'script')) {
    const checkpoint = checkpoints.find(item => Number.isSafeInteger(item.sceneId)
      && entry.id >= item.firstEntryId && entry.id <= item.lastEntryId)
    const frame = entry.metadata?.frameId
    if (checkpoint) scenes.add(`scene:${checkpoint.sceneId}`)
    else if (typeof frame === 'string' && frame) scenes.add(frameScenes.get(frame) ?? frame)
  }
  return scenes.size
}

/** Provisional learning remains auditable in storage, but repeated narrative
 * turns in one long-lived scene are also valid evidence. A scene boundary is
 * still sufficient, but it is no longer the only way to project a proposal. */
export function promptReadyDevelopment(candidate: StatePatchProposal, entries: ScriptEntry[]) {
  if (candidate.status === 'applied') return true
  const sources = new Set(candidate.sourceEntryIds)
  const sourceEntries = entries.filter(entry => sources.has(entry.id))
  return developmentScenes(sourceEntries) >= 2 || developmentTurns(sourceEntries) >= 2
}
