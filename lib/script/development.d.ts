import type { ScriptEntry, StatePatchDraft, StatePatchProposal } from '../types';
/** References into the supplied originals keep observation, interpretation
 * and reception together without writing another psychological summary. */
export declare function interactionEvidence(entries: ScriptEntry[]): {
    participantId: string;
    feedbackEntryId: number;
    priorCommunicationEntryId: number;
    interpretationEntryIds: number[];
    responseEntryIds: number[];
}[];
export declare function reviewedDevelopmentSupport(draft: StatePatchDraft, entries: ScriptEntry[], participantId: string): boolean;
/** A quiet turn still has a life context. Use visible original text only as a
 * relevance query, never as a fresh learning observation or evidence weight. */
export declare function developmentContextQuery(userMessage: string | undefined, dueSummaries: string[], visibleEntries: ScriptEntry[]): string;
/** Canon stays intact. New development proposals use a small vocabulary. */
export declare function developmentDimension(target: StatePatchDraft['target'], path: string): string;
/** Count distinct narrative turns by their occurrence timestamp.
 * Multiple storage rows emitted for the same turn count once, while repeated
 * turns in one long-lived scene remain valid evidence for gradual evolution. */
export declare function developmentTurns(entries: ScriptEntry[]): number;
/** One completed scene contributes once regardless of prose length or turns.
 * Legacy rows without scene provenance remain readable but cannot multiply
 * scene evidence by their timestamps. */
export declare function developmentScenes(entries: ScriptEntry[]): number;
/** Provisional learning remains auditable in storage, but repeated narrative
 * turns in one long-lived scene are also valid evidence. A scene boundary is
 * still sufficient, but it is no longer the only way to project a proposal. */
export declare function promptReadyDevelopment(candidate: StatePatchProposal, entries: ScriptEntry[]): boolean;
