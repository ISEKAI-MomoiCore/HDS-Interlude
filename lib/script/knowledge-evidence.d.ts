import type { NarrativeFact, ScriptEntry } from '../types';
/** Epistemic pointers into the original, never a replacement narrative. */
export interface KnowledgeEvidence {
    mode: 'observed' | 'reported' | 'belief' | 'proposal' | 'conditional' | 'confirmed' | 'unclassified';
    holder?: string;
    topic?: string;
    clauses: Array<{
        role: 'observation' | 'interpretation' | 'proposal' | 'condition' | 'confirmation';
        sourceEntryId: number;
        quote: string;
    }>;
    relatedFactIds: number[];
}
/** Validate references, not the meaning of natural language. A quote is evidence
 * of its author's words; a narrative quote cannot confirm another person's act. */
export declare function normalizeKnowledgeEvidence(raw: unknown, entries: ScriptEntry[], sourceEntryIds: number[], relatedFactIds?: number[]): KnowledgeEvidence;
/** Rows persisted before evidence fields existed may hold `{}` or partial
 * knowledge objects, so every read of stored evidence coerces defensively. */
export declare function knowledgeClauses(knowledge: KnowledgeEvidence | undefined): {
    role: "observation" | "interpretation" | "proposal" | "condition" | "confirmation";
    sourceEntryId: number;
    quote: string;
}[];
export declare function knowledgeRelatedIds(knowledge: KnowledgeEvidence | undefined): number[];
export declare function factEvidenceForPrompt(fact: NarrativeFact): {
    id: number;
    scope: "character" | "world" | "relationship" | "event" | "promise";
    content: string;
    unresolved: boolean;
    status: "active" | "superseded";
    sourceEntryIds: number[];
    authority: string;
    knowledge: KnowledgeEvidence;
};
export declare function supportsRecordedOutcome(knowledge: KnowledgeEvidence): boolean;
/** Navigation only for pre-evidence records. Literal condition wording earns
 * a retrieval lane; it never establishes that a condition is valid or fulfilled. */
export declare function legacyConditionCue(content: string): boolean;
export interface ContactEvidenceThread {
    fact: ReturnType<typeof factEvidenceForPrompt>;
    originals: Array<{
        id: number;
        kind: string;
        participantId: string;
        content: string;
        occurredAt: string;
    }>;
    originalEntryIds: number[];
    missingSourceEntryIds: number[];
}
/** Include original conditions and nearby replies. Durable facts are global,
 * but their original source entries still obey the caller's privacy boundary;
 * a hidden source is represented as missing rather than reconstructed. */
export declare function contactEvidenceThreads(facts: NarrativeFact[], entries: ScriptEntry[]): ContactEvidenceThread[];
export declare const KNOWLEDGE_WRITING_FRAME = "EVIDENCE AND EXPECTATION: the original remains the life script. Her belief, wish and imagined explanation belong to her perspective; an observed action belongs to its actor. Derived records retain these roles and conditions. contactThreads supplies original proposals, conditions and replies, not a second plot: unfinished contact may motivate another question or private anticipation while confirmation and timing stay open. Elapsed silence can change her feelings without changing what the other person promised; platform delivery alone establishes neither reading nor agreement.";
