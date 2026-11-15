import type { NarrativeIntent } from '../types'

/** These tasks have their own executor, never the live narrator's completion. */
export function liveNarrativeIntents(intents: NarrativeIntent[]) {
  return intents.filter(intent => !['split-message', 'browser-research', 'narrative-retry', 'proactive-check', 'active-consequence'].includes(intent.type))
}

export function consumedLiveIntentIds(intents: NarrativeIntent[]) {
  return liveNarrativeIntents(intents).filter(intent => intent.type !== 'follow-up-commitment').map(intent => intent.id)
}
