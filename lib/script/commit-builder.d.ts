import type { NarrativeDecision, NarrativePhase } from '../types';
import { type AuthoredAction } from './authored-actions';
import { ScriptActionBinding, ScriptCommitDraft, ScriptDeliveryMode, ScriptEventDraft } from './contract';
export interface ScriptFirstDecisionInput {
    storyId: string;
    participantId?: string;
    phase: NarrativePhase;
    from: Date;
    now: Date;
    decision: NarrativeDecision;
    messageSeparator?: string;
    splitReplyMessages?: boolean;
    /** Group output is normalized by the service before it enters this adapter. */
    groupReplyContent?: string;
    frameId?: string;
    burstId?: string;
    startsAfterEventId?: string;
}
/**
 * The only beta10 → V2 bridge. It does not call a model or invent narrative
 * decisions; it gives the existing single response stable commit/event ids.
 */
export declare function decisionToScriptCommit(input: ScriptFirstDecisionInput): ScriptCommitDraft;
export declare function findPrivateOutgoingMessageEvent(commit: ScriptCommitDraft, participantId: string, mode?: ScriptDeliveryMode, content?: string, separator?: string): ScriptEventDraft;
export declare function findGroupScriptEvent(commit: ScriptCommitDraft): ScriptEventDraft;
/** Bind an immediate transport action to the literal message text in the
 * current script without interpreting prose or adding another model task.
 * Candidates are tiered: a complete quoted segment (“早”/「早」) outranks a
 * bare standalone occurrence, and occurrences inside other words (今早/早饭)
 * never qualify. Equal-tier duplicates stay unbound — the prose mentions the
 * same text twice without singling out a send — while a quote-anchored match
 * beside weaker decoys binds (issue #15: 单字问候被词内巧合否决)。 */
export declare function bindImmediateMessageAction(prose: string, bubbles: string[], actions?: AuthoredAction[]): ScriptActionBinding;
export declare function unboundImmediateMessageEvents(commit: ScriptCommitDraft): ScriptEventDraft[];
