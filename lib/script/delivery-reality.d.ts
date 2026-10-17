import type { ScriptEntry } from '../types';
export interface DeliveryRealityOptions {
    limit?: number;
    characterBudget?: number;
    timezone?: string;
}
/** Truncated pointer into message prose, shared by prompt-side anchors
 * (deliveryReality segments, recentExchange) so every "head" in the payload
 * follows the same code-point convention. */
export declare function messageHead(content: string): string;
/** Only call with entries already filtered for the current relationship.
 * This is an execution annotation of the same script, never replacement
 * prose: outcomes, bubble order and receipt clocks travel; message text
 * stays in the entry itself. Character budget keeps the newest actions and
 * lets one intact action overflow it (same soft-budget semantics as
 * compactPromptEntries) rather than truncating mid-segment. */
export declare function deliveryReality(entries: ScriptEntry[], participantId?: string, shareParticipantDetails?: boolean, options?: DeliveryRealityOptions): Record<string, unknown>[];
