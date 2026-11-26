/** The protagonist’s attention at the endpoint of a committed script. */
export const FOCUS_ATTENTIONS = [
  'device-focus-chat', 'device-focus-other', 'busy-work', 'busy-play',
  'avaliable-relax', 'avaliable-tense', 'rest-conscious', 'rest-dazed', 'asleep',
] as const
export type FocusAttention = typeof FOCUS_ATTENTIONS[number]

const legacyAttentions = ['phone-focused', 'available', 'occupied', 'resting', 'asleep'] as const
export type LegacyRhythmAttention = typeof legacyAttentions[number]
export type LifeRhythmAttention = FocusAttention | LegacyRhythmAttention

const legacyByFocus: Record<FocusAttention, LegacyRhythmAttention> = {
  'device-focus-chat': 'phone-focused',
  'device-focus-other': 'phone-focused',
  'busy-work': 'occupied',
  'busy-play': 'occupied',
  'avaliable-relax': 'available',
  'avaliable-tense': 'available',
  'rest-conscious': 'resting',
  'rest-dazed': 'resting',
  asleep: 'asleep',
}

export function isFocusAttention(value: unknown): value is FocusAttention {
  return typeof value === 'string' && (FOCUS_ATTENTIONS as readonly string[]).includes(value)
}

export function isLegacyRhythmAttention(value: unknown): value is LegacyRhythmAttention {
  return typeof value === 'string' && (legacyAttentions as readonly string[]).includes(value)
}

export function legacyRhythmAttention(value: unknown): LegacyRhythmAttention | undefined {
  if (isFocusAttention(value)) return legacyByFocus[value]
  return isLegacyRhythmAttention(value) ? value : undefined
}

export interface FocusDraft { attention: FocusAttention; quote: string }
export interface CompactionFocusDraft extends FocusDraft { sourceEntryId: number }

export function normalizeFocusDraft(value: unknown, prose: string): FocusDraft | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { attention, quote } = value as Record<string, unknown>
  if (!isFocusAttention(attention) || typeof quote !== 'string' || quote.trim().length < 2 || quote.length > 500 || !prose.includes(quote)) return undefined
  return { attention, quote }
}

const choices = FOCUS_ATTENTIONS.join('|')
const focusGuidance = 'Classify only the protagonist at the endpoint of the committed prose. Use device-focus-chat for deliberately reading or following chats, device-focus-other for casual non-chat device use, busy-work for absorbed work or study, busy-play for absorbing play (including a live game on a device), avaliable-relax or avaliable-tense for alert unoccupied attention (relaxed or tense), rest-conscious or rest-dazed for resting while lucid or groggy, and asleep only once asleep. Sustained work or play takes priority over incidental device use. Incoming messages alone and mere device access do not establish focus. Omit the assessment when the endpoint is unclear.'

export const narrativeFocusInstruction = `After the script, optionally include "focus":{"attention":"${choices}","quote":"exact words from the script supporting the endpoint"} inside lifeHandoff. Reaffirm the same focus if the new script gives fresh evidence. ${focusGuidance}`
export const compactionFocusInstruction = `Optionally return lifeRhythm:{"attention":"${choices}","quote":"exact words from that script supporting its endpoint","sourceEntryId":1}. Cite only the latest committed protagonist script in entries, and omit when it already has an evidenced lifeHandoff.focus. ${focusGuidance}`
