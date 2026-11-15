import { isOutgoingScriptEvent, ScriptCommitDraft } from './contract'

export interface ScriptCommitValidation {
  valid: boolean
  errors: string[]
}

/** Structural validation only; literary style never becomes a rejection rule. */
export function validateScriptCommit(commit: ScriptCommitDraft, separator = '<sep/>'): ScriptCommitValidation {
  const errors: string[] = []
  if (!commit.prose.trim()) errors.push('script prose is empty')
  if (!commit.sceneDelta.frameId || !commit.sceneDelta.burstId) errors.push('scene delta identity is missing')
  if (commit.sceneDelta.proseAppend !== commit.prose) errors.push('scene delta prose differs from commit prose')
  if (commit.sceneDelta.eventIds.join('\u001f') !== commit.events.map(event => event.eventId).join('\u001f')) {
    errors.push('scene delta event order differs from commit events')
  }
  const from = new Date(commit.window.from)
  const to = new Date(commit.window.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) errors.push('commit window is invalid')
  const ids = new Set<string>()
  for (const event of commit.events) {
    if (event.commitId !== commit.commitId) errors.push(`event ${event.eventId} belongs to another commit`)
    if (!event.eventId || ids.has(event.eventId)) errors.push(`event id is missing or duplicated: ${event.eventId}`)
    ids.add(event.eventId)
    if (isOutgoingScriptEvent(event)) {
      if (!event.participantId && event.kind !== 'group-message') errors.push(`message event ${event.eventId} has no participant`)
      if (!event.bubbles.length || event.bubbles.some(item => !item.trim())) errors.push(`message event ${event.eventId} has empty bubbles`)
      if (event.bubbles.join(separator) !== event.content) errors.push(`message event ${event.eventId} cannot reconstruct its content`)
    }
  }
  for (const event of commit.events) {
    for (const parent of event.causedByEventIds) if (!ids.has(parent)) errors.push(`event ${event.eventId} has unknown cause ${parent}`)
  }
  return { valid: errors.length === 0, errors }
}
