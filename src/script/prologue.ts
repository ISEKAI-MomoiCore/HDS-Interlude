import type { ScriptEntry, StoryState } from '../types'
import { normalizeLifeHandoff } from './life-handoff'

export const MAX_PROLOGUE_PASSAGES = 3
export const MAX_PROLOGUE_PASSAGE_LENGTH = 2000
const PROLOGUE_STEP_MS = 5 * 60_000

export interface PrologueConfig {
  passages: string[]
  place?: string
  activity?: string
  presentPeople?: string[]
  presenceQuote?: string
}

export function preparePrologue(config: PrologueConfig | undefined, storyId: string, createdAt: Date, receivedAt?: Date): Omit<ScriptEntry, 'id'>[] {
  const passages = config?.passages?.filter(text => text.trim()) ?? []
  const anchor = receivedAt && Number.isFinite(receivedAt.getTime()) && receivedAt < createdAt ? receivedAt : createdAt
  return passages.map((content, index) => {
    const isOpening = index === passages.length - 1
    const place = config?.place?.trim()
    const activity = config?.activity?.trim()
    const presenceQuote = config?.presenceQuote?.trim()
    const lifeHandoff = isOpening ? normalizeLifeHandoff({
      ...(place ? { place: { value: place, quote: place } } : {}),
      ...(activity ? { activity: { value: activity, quote: activity } } : {}),
      ...(presenceQuote ? { presence: { names: config?.presentPeople ?? [], quote: presenceQuote } } : {}),
    }, content) : undefined
    return {
      storyId, participantId: '', kind: 'prologue', actor: 'narrator', content,
      occurredAt: new Date(anchor.getTime() - (passages.length - index) * PROLOGUE_STEP_MS), createdAt,
      metadata: { source: 'administrator', ...(lifeHandoff ? { lifeHandoff } : {}) },
    }
  })
}

export function isOpeningPrologue(state: StoryState) {
  return state.extensions?.hasPrologue === true && !state.narrativeUpdateCount
}
