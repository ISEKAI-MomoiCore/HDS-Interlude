import type { RuntimeConfig } from '../service';
import type { TurnHandle } from '../turn-engine';
import type { InterludeParticipant, InterludeStory, NarrativeDecision, NarrativeIntent, NarrativeRequest, OutgoingMessageDraft } from '../types';
export declare function firstPrivateBubbleDueAt(startedAt: Date, availableAt: Date, waitMs: number): Date;
/** Match the actual transport segmentation, including the operator's newline setting. */
export declare function validatePrivateBubbleDelay(decision: NarrativeDecision, now: Date, runtime: RuntimeConfig): {
    readonly valid: true;
    readonly bubbleCount?: undefined;
    readonly immediate?: undefined;
} | {
    readonly valid: false;
    readonly bubbleCount: number;
    readonly immediate?: undefined;
} | {
    readonly valid: true;
    readonly immediate: true;
    readonly bubbleCount?: undefined;
};
export declare function splitPrivateBubbleContent(content: string, runtime: RuntimeConfig): string[];
interface PrivateBubble {
    content: string;
    waitMs: number;
}
interface PrivateBubblePlan {
    bubbles: PrivateBubble[];
    nextIndex: number;
    attempting?: true;
}
export interface PrivateBubbleInterruption {
    sourceAction: {
        commitId: string;
        eventId: string;
        scriptEntryId: number;
    };
    interruptedAt: string;
    triggerMessageIndex?: number;
    deliveredBubbleIndexes: number[];
    cancelledBubbles: Array<{
        bubbleIndex: number;
        content: string;
    }>;
    confirmedBubbles: Array<{
        bubbleIndex: number;
        content: string;
        deliveredAt?: string;
    }>;
    unresolvedBubbleIndexes: number[];
}
export declare function privateBubblePlan(intent: NarrativeIntent): PrivateBubblePlan | undefined;
export declare function privateBubbleBusy(svc: object, intent: NarrativeIntent): boolean;
export interface PrivateBubbleCommitOptions {
    startedAt: Date;
    handle?: TurnHandle;
    sourceEndpointId?: string;
    onCommitted(): void;
}
/** Persist the group alongside its script entry. Only the head has a deadline. */
export declare function persistPrivateBubbleGroup(svc: any, story: InterludeStory, participant: InterludeParticipant, message: OutgoingMessageDraft, startedAt: Date, endpointId?: string): Promise<NarrativeIntent>;
export declare function activatePrivateBubbleGroup(svc: any, intent: NarrativeIntent, participant: InterludeParticipant, handle?: TurnHandle): void;
/** Called within the inbound transaction. The live handoff check and this cancellation
 * share a synchronous token, so an awaited endpoint lookup cannot leak another bubble. */
export declare function interruptPrivateBubbleGroup(svc: any, storyId: string, intent: NarrativeIntent, now: Date): Promise<{
    sourceAction: {
        commitId: string;
        eventId: string;
        scriptEntryId: number;
    };
    interruptedAt: string;
    deliveredBubbleIndexes: number[];
    cancelledBubbles: {
        bubbleIndex: number;
        content: string;
    }[];
    confirmedBubbles: {
        bubbleIndex: number;
        content: string;
        deliveredAt: string;
    }[];
    unresolvedBubbleIndexes: number[];
}>;
export declare function deliverPrivateBubbleGroup(svc: any, storyId: string, intentId: number): Promise<void>;
/** Project only this private batch's interruption(s). A late receipt can clarify the
 * snapshot; exact confirmed text is repeated only if its delivery row was clipped. */
export declare function projectPrivateBubbleInterruptions(request: Pick<NarrativeRequest, 'phase' | 'groupContext' | 'participant' | 'supersededIntents' | 'recentEntries'>, visibleScript: Array<{
    id: number;
    content: string;
}>): {
    unconfirmedBubbleIndexes?: number[];
    confirmedOutsideHistory?: {
        bubbleIndex: number;
        content: string;
        deliveredAt?: string;
    }[];
    sourceAction: {
        commitId: string;
        eventId: string;
        scriptEntryId: number;
    };
    interruptedAt: string;
    triggerMessageIndex: number;
    deliveredBubbleIndexes: number[];
    cancelledBubbles: {
        bubbleIndex: number;
        content: string;
    }[];
}[];
export {};
