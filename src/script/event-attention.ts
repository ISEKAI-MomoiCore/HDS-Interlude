import { isFocusAttention, type FocusAttention } from '../life-rhythm'
import { lifeRhythmStale } from '../story-state'
import type { ScriptEntry, StoryState } from '../types'
import { weatherAttentionOffset } from '../weather'

export type AttentionTier = 1 | 2 | 3 | 4 | 5
export type FixedAttentionEvent = 'privateBatch' | 'groupBatch' | 'groupBackground' | 'weather' | 'friendFeed'

type AttentionRow = Record<FixedAttentionEvent, AttentionTier>
const row = (privateBatch: AttentionTier, groupBatch: AttentionTier, groupBackground: AttentionTier,
  weather: AttentionTier, friendFeed: AttentionTier): AttentionRow => ({ privateBatch, groupBatch, groupBackground, weather, friendFeed })

const byFocus: Record<FocusAttention, AttentionRow> = {
  'device-focus-chat': row(1, 2, 2, 4, 2),
  'device-focus-other': row(2, 3, 3, 4, 3),
  'busy-work': row(3, 4, 5, 4, 5),
  'busy-play': row(4, 5, 5, 4, 5),
  'avaliable-relax': row(2, 3, 4, 3, 3),
  'avaliable-tense': row(3, 4, 5, 3, 5),
  'rest-conscious': row(3, 4, 5, 3, 4),
  'rest-dazed': row(4, 5, 5, 4, 5),
  asleep: row(5, 5, 5, 5, 5),
}
const neutral = row(3, 3, 3, 3, 3)

export function resolveEventAttentionFocus(rhythm: StoryState['lifeRhythm'], now: Date): FocusAttention | null {
  return rhythm && isFocusAttention(rhythm.attention) && !lifeRhythmStale(rhythm, now.getTime())
    ? rhythm.attention : null
}

export function fixedEventTier(focus: FocusAttention | null, event: FixedAttentionEvent): AttentionTier {
  return (focus === null ? neutral : byFocus[focus])[event]
}

const seededTierByScore: Readonly<Record<number, AttentionTier>> = { 1: 5, 2: 4, 3: 3, 4: 2, 6: 1 }

export function seededEventTier(importance: unknown, involvement: unknown): AttentionTier {
  const weight = importance === 'high' ? 3 : importance === 'medium' ? 2 : 1
  return seededTierByScore[weight * (involvement === 'involved' ? 2 : 1)]
}

export function entryEventAttention(entry: Pick<ScriptEntry, 'kind' | 'metadata'>, focus: FocusAttention | null): string | undefined {
  if (entry.kind === 'friend-feed') return describeEventAttention('这条社交动态', fixedEventTier(focus, 'friendFeed'))
  if (entry.kind !== 'world-event') return undefined
  const metadata = entry.metadata
  if (metadata?.eventSource === 'weather') {
    const tier = Math.min(5, Math.max(1, fixedEventTier(focus, 'weather') + weatherAttentionOffset(metadata))) as AttentionTier
    return describeEventAttention('这条实况天气事件', tier)
  }
  const tier = metadata?.eventSource === 'world-seeder' ? seededEventTier(metadata.importance, metadata.involvement) : 5
  return describeEventAttention('这条世界事件', tier)
}

const likelihood: Record<AttentionTier, string> = { 1: '很高', 2: '较高', 3: '中等', 4: '较低', 5: '很低' }

export function describeEventAttention(event: string, tier: AttentionTier): string {
  return `主角注意到${event}的可能性${likelihood[tier]}（T${tier}）`
}

export const EVENT_ATTENTION_GUIDE = 'T 档描述主角此刻注意到对应事件的可能性，T1 最高，T5 最低。它不表示已经或必然注意到、已经阅读，或必须回应；也不规定感知顺序，不要求每条事件都写进剧本。'
