import type { ScriptEntry } from '../types';
import { type FocusDraft } from '../life-rhythm';
export interface QuotedLifeValue {
    value: string;
    quote: string;
}
export interface LifeHandoff {
    focus?: FocusDraft;
    place?: QuotedLifeValue;
    activity?: QuotedLifeValue;
    /** Complete local roster, including an explicitly evidenced empty roster. */
    presence?: {
        names: string[];
        quote: string;
    };
    transition?: {
        quote: string;
    };
    resolvedDetails?: Array<{
        label: string;
        quote: string;
    }>;
}
/** Small pointers into this committed original, not a second scene summary.
 * Quotes establish provenance, not semantic proof; inference stays literary. */
export declare function normalizeLifeHandoff(raw: unknown, prose: string): LifeHandoff | undefined;
export declare function entryLifeHandoff(entry: ScriptEntry): LifeHandoff;
/** New originals are the completed record; their director plan stays a plan.
 * Legacy ledgers remain distinguishable rather than reinterpreted in place. */
export declare function narrativeEvidence(entry: ScriptEntry): {
    narrativeAuthority?: string;
    lifeHandoff?: LifeHandoff;
    proposedTimeline?: unknown;
    timelineEvidence?: unknown;
    communicationOutcome?: string;
};
