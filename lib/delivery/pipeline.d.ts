/** 投递管线：出站消息编排、传输执行（session→桌面桥→bot 三级路由）、
 * 分段打字节奏、投递回执与账本回写、失败/撤回记账、自动投递摘要。
 *
 * P2 自 service.ts 投递区迁出（2026-10-29），行为不变。函数接收宿主（service
 * 实例或测试假宿主）为第一参数——与 runStorySerialized 同一形态；service.ts
 * 保留同名薄委托，既有调用点与全部测试零改动。锁相位纪律随代码原样保留：
 * 传输在故事串行队列之外，回执/账本回写经 runStorySerialized 在队列内。
 * 账本边界（ARCHITECTURE.md“投递与调度边界”）：账本是跨重启唯一真相；
 * 终态不可逆；transportTimeout/ambiguous 记 pending 不判失败；pending 补偿
 * 只重放传输不重跑模型。 */
import { Session } from 'koishi';
import { type ScriptDeliveryReference, type ScriptDeliverySegmentStatus } from '../script/delivery-ledger';
import type { InterludeParticipant, InterludeStory, OutgoingMessageDraft, ScriptEntry } from '../types';
export interface GroupDeliveryResult {
    deliveredSegments: string[];
    complete: boolean;
    segmentOutcomes: Array<{
        index: number;
        content: string;
        status: 'delivered' | 'failed' | 'cancelled';
        reason?: string;
    }>;
}
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function sendCrossGroupMessage(svc: any, story: InterludeStory, message: OutgoingMessageDraft, session?: Session, failureStatus?: 'failed' | 'pending', shouldCancel?: () => boolean): Promise<GroupDeliveryResult>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function deliveryExecutionKey(svc: any, storyId: string, message: OutgoingMessageDraft, segment?: boolean): string;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function successfulDeliveryEntry(svc: any, storyId: string, message: OutgoingMessageDraft): Promise<ScriptEntry>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function deliverOutgoingMessages(svc: any, story: InterludeStory, messages: OutgoingMessageDraft[], current?: InterludeParticipant, session?: Session, shouldCancel?: (target: InterludeParticipant) => boolean, recordFailures?: boolean, requestStartedAt?: Date, failureStatus?: 'failed' | 'pending', splitSegment?: boolean, confirmedEntries?: ScriptEntry[]): Promise<OutgoingMessageDraft[]>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function deliveryLedgerConfirmed(svc: any, storyId: string, message: OutgoingMessageDraft): Promise<boolean>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function sendOutgoingMessages(svc: any, story: InterludeStory, messages: OutgoingMessageDraft[], current?: InterludeParticipant, session?: Session, shouldCancel?: (target: InterludeParticipant) => boolean, recordFailures?: boolean, requestStartedAt?: Date, failureStatus?: 'failed' | 'pending'): Promise<OutgoingMessageDraft[]>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function confirmOutgoingDeliveries(svc: any, story: InterludeStory, delivered: OutgoingMessageDraft[], splitSegment?: boolean): Promise<ScriptEntry[]>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function recordOutgoingDeliveryFailure(svc: any, story: InterludeStory, participantId: string, message: OutgoingMessageDraft, reason: string, status?: 'failed' | 'pending' | 'unknown'): Promise<void>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function updateScriptDeliveryOutcome(svc: any, storyId: string, reference: Pick<ScriptDeliveryReference, 'commitId' | 'eventId'> & {
    scriptEntryId?: number;
    segmentIndex?: number;
    bubbleIndex?: number;
}, status: ScriptDeliverySegmentStatus, at: Date, reason?: string): Promise<void>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function recordPlatformDeliveryOutcome(svc: any, storyId: string, reference: ScriptDeliveryReference, status: ScriptDeliverySegmentStatus, reason?: string): Promise<void>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function resolveLiteralQuoteMessageId(svc: any, storyId: string, participantId: string, content: string): Promise<string>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function recordAutomaticDelivery(svc: any, storyId: string, participantId: string, delivery: NonNullable<OutgoingMessageDraft['automaticDelivery']>, now: Date): Promise<void>;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function splitOutgoingMessage(svc: any, content: string): string[];
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function typingDelayMilliseconds(svc: any, nextSegment: string): number;
/** P2 自 service.ts 投递区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function firstMessageTypingHoldMs(svc: any, content: string, requestStartedAt: Date): number;
/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function sendGroupMessage(svc: any, story: InterludeStory, channelId: string, content: string, replyToMessageId?: string, session?: Session, endpointId?: string, correlation?: Pick<OutgoingMessageDraft, 'traceId' | 'processingId'>, control?: {
    shouldCancel: () => boolean;
    settled: Map<number, GroupDeliveryResult['segmentOutcomes'][number]['status']>;
    onDelivered: (index: number, content: string) => void;
}): Promise<{
    deliveredSegments: string[];
    complete: boolean;
    segmentOutcomes: any;
}>;
