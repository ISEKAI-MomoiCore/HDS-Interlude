import type { OutgoingMessageDraft } from './types';
import { ScriptEventDraft, ScriptMessageEventReference } from './script/contract';
export declare function attachMessageEvent(message: OutgoingMessageDraft, event: ScriptEventDraft | undefined, scriptEntryId?: number): OutgoingMessageDraft;
export declare function prepareOutgoingDelivery(message: OutgoingMessageDraft, bubbles: string[]): OutgoingMessageDraft | undefined;
export declare function scriptEventPayload(message: OutgoingMessageDraft, bubbleIndex?: number): {
    scriptEvent?: {
        bubbleIndex: number;
        commitId: string;
        eventId: string;
        scriptEntryId?: number;
        eventKind: "outgoing-message" | "group-message";
        causedByEventIds: string[];
        endpointId?: string;
        fullContent: string;
        bubbleCount: number;
    };
    processingId?: string;
    traceId?: string;
};
export declare function restoreDesktopContext(value: unknown): Pick<OutgoingMessageDraft, 'traceId' | 'processingId'>;
export declare function restoreMessageEvent(value: unknown, content: string): ScriptMessageEventReference | undefined;
export declare function deliveryEntryMetadata(message: OutgoingMessageDraft, extra?: Record<string, unknown>): {
    bubbleIndex?: number;
    commitId?: string;
    eventId?: string;
    scriptEntryId?: number;
    eventKind?: "outgoing-message" | "group-message";
    causedByEventIds?: string[];
    endpointId?: string;
    fullContent?: string;
    bubbleCount?: number;
    visible: boolean;
    interaction: import("./types").NarrativeInteraction;
};
