/** The protagonist’s attention at the endpoint of a committed script. */
export declare const FOCUS_ATTENTIONS: readonly ["device-focus-chat", "device-focus-other", "busy-work", "busy-play", "avaliable-relax", "avaliable-tense", "rest-conscious", "rest-dazed", "asleep"];
export type FocusAttention = typeof FOCUS_ATTENTIONS[number];
declare const legacyAttentions: readonly ["phone-focused", "available", "occupied", "resting", "asleep"];
export type LegacyRhythmAttention = typeof legacyAttentions[number];
export type LifeRhythmAttention = FocusAttention | LegacyRhythmAttention;
export declare function isFocusAttention(value: unknown): value is FocusAttention;
export declare function isLegacyRhythmAttention(value: unknown): value is LegacyRhythmAttention;
export declare function legacyRhythmAttention(value: unknown): LegacyRhythmAttention | undefined;
export interface FocusDraft {
    attention: FocusAttention;
    quote: string;
}
export interface CompactionFocusDraft extends FocusDraft {
    sourceEntryId: number;
}
export declare function normalizeFocusDraft(value: unknown, prose: string): FocusDraft | undefined;
export declare const narrativeFocusInstruction: string;
export declare const compactionFocusInstruction: string;
export {};
