import type { ScriptEntry, StoryState } from '../types';
export declare const MAX_PROLOGUE_PASSAGES = 3;
export declare const MAX_PROLOGUE_PASSAGE_LENGTH = 2000;
export interface PrologueConfig {
    passages: string[];
    place?: string;
    activity?: string;
    presentPeople?: string[];
    presenceQuote?: string;
}
export declare function preparePrologue(config: PrologueConfig | undefined, storyId: string, createdAt: Date, receivedAt?: Date): Omit<ScriptEntry, 'id'>[];
export declare function isOpeningPrologue(state: StoryState): boolean;
