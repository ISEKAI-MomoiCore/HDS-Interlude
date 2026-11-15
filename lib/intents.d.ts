import { normalizeIntentUpdates } from './narrative-normalizers';
import type { NarrativeIntent, InterludeStory, IntentDraft, BrowserIntentDraft, WebObservation, FollowUpCommitmentDraft, FollowUpResolutionDraft, NarrativeInteraction } from './types';
/** Emit only after the plan write succeeds; observation never changes its lifecycle. */
export declare function reportContactPlanUpdate(svc: any, intent: Pick<NarrativeIntent, 'storyId' | 'type' | 'participantId' | 'payload'> & {
    id?: number;
}, status: string, reasonCode: string): void;
export declare const WAKE_DRIVEN_INTENT_TYPES: readonly ["split-message", "delayed-reply", "cross-conversation-message", "narrative-retry", "browser-research", "proactive-check"];
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function researchScriptTail(svc: any, storyId: string, limit?: number): Promise<string>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function jevGatePassiveResearch(svc: any, story: InterludeStory, userMessage: string | undefined, now: Date): Promise<void>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function researchDeskFor(svc: any, storyId: string): any;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function researchProvider(svc: any): any;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function appendIntent(svc: any, storyId: string, intent: IntentDraft, now: Date, participantId?: string): Promise<void>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function applyIntentUpdates(svc: any, storyId: string, updates: ReturnType<typeof normalizeIntentUpdates>, now: Date, participantId?: string): Promise<boolean>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function appendBrowserIntent(svc: any, storyId: string, draft: BrowserIntentDraft, now: Date, fallbackParticipantId?: string): Promise<void>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function executeResearchIntent(svc: any, story: InterludeStory, intent: NarrativeIntent, now: Date): Promise<void>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function researchStatusLines(svc: any): string[];
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function executeDeferredBrowserIntent(svc: any, story: InterludeStory, intent: NarrativeIntent, now: Date): Promise<WebObservation>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function dueIntents(svc: any, storyId: string, now: Date): Promise<any>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function upcomingNarrativeIntents(svc: any, storyId: string, now: Date): Promise<NarrativeIntent[]>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function scheduleDueIntentWake(svc: any, storyId: string, notBefore: Date): void;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function wakeDueIntents(svc: any, storyId: string): Promise<'busy' | void>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function reconcileTerminalSplitIntent(svc: any, storyId: string, intent: NarrativeIntent, now: Date): Promise<boolean>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function pendingSplitSegments(svc: any, storyId: string): Promise<NarrativeIntent[]>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function deferDueIntentsBehindPendingSplits(svc: any, story: InterludeStory, due: NarrativeIntent[], splits: NarrativeIntent[], now: Date): Promise<NarrativeIntent[]>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function scheduleNextPendingWake(svc: any, storyId: string): Promise<void>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function deliverDueSplitSegments(svc: any, storyId: string): Promise<void>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function pendingFollowUpCommitments(svc: any, storyId: string, participantId: string, now?: Date): Promise<NarrativeIntent[]>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function retireExpiredFollowUps(svc: any, storyId: string, intents: NarrativeIntent[], now: Date): Promise<Set<number>>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function appendFollowUpCommitment(svc: any, story: InterludeStory, participantId: string, draft: FollowUpCommitmentDraft, fallbackSourceEntryId: number | undefined, now: Date, originDeliveryEventId?: string): Promise<void>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function applyFollowUpResolutions(svc: any, storyId: string, participantId: string, resolutions: FollowUpResolutionDraft[], interaction: NarrativeInteraction | undefined, now: Date, deliveryEventId?: string): Promise<Set<number>>;
/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function deferUnresolvedDueFollowUps(svc: any, storyId: string, participantId: string, contextIntents: NarrativeIntent[], resolvedIds: Set<number>, _interaction: NarrativeInteraction | undefined, now: Date): Promise<void>;
