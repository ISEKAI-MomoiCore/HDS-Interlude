/**
 * P0 试点：TurnEngine——从 service.ts 抽出的缓冲回合状态管理。
 *
 * 拥有 bufferedNarrativeTurns + narratingStories 两个状态容器，
 * 以及直接操作它们的四个方法（buffer/signal/invalidate/hasPending）。
 * flushBufferedNarrative 的执行体留在 service（它调用模型/投递/持久化），
 * 但通过 beginFlush/endFlush 与本模块交互状态。
 */
import type { Session } from 'koishi';
import type { InterludeStory, InterludeParticipant, NarrativeIntent, QuotedMessageContext } from './types';
export interface BufferedUserMessage {
    content: string;
    occurredAt: Date;
    /** Registered inbound endpoint for deterministic batch attribution. */
    endpointId?: string;
    supersededIntents: NarrativeIntent[];
    imageSources: string[];
    audioSources: string[];
    quote?: QuotedMessageContext;
}
export interface BufferedNarrativeTurn {
    storyId: string;
    participantId: string;
    messages: BufferedUserMessage[];
    latestSession?: Session;
    timer?: () => void;
    nextRevision: number;
    inFlightRequestId?: number;
    firstMessageCommittedRequestId?: number;
    obsoleteRequestIds: Set<number>;
    /** Requests invalidated by an administrative reset/purge must not be requeued. */
    discardedRequestIds?: Set<number>;
    /** M2 §1.3：本回合涉及端点按接收序号有序；空 = 未解析（单端点等价）。 */
    sources: Array<{
        endpointId: string;
        receivedSeq: number;
    }>;
    /** Snapshot used by the request currently being flushed. */
    activeSources?: Array<{
        endpointId: string;
        receivedSeq: number;
    }>;
    /** Endpoint ids represented by the messages in the active debounce batch. */
    activeBatchEndpointIds?: string[];
    /** Number of messages represented by the active batch (including legacy
     * messages whose endpoint could not be resolved). */
    activeBatchMessageCount?: number;
}
/** 最小依赖集——不含模型调用/投递/持久化（那些留在 service）。 */
export interface TurnEngineDeps {
    setTimeout: (fn: () => void, ms: number) => () => void;
    userMessageDebounceSeconds: number;
    /** endFlush 为遗留消息补定时器用的统一触发入口(service 的 flushBufferedNarrative)。 */
    scheduleTurnFlush: (key: string, revision: number) => void;
    reportOperation: (level: string, kind: string, story: InterludeStory, phase: string, format: string, ...args: unknown[]) => void;
}
export declare function shouldSupersedeRequest(inFlightRequestId: number | undefined, firstMessageCommittedRequestId: number | undefined, obsoleteRequestIds: ReadonlySet<number>): boolean;
export interface TurnEngine {
    /** 状态容器（service 的 flushBufferedNarrative 直接访问） */
    readonly turns: Map<string, BufferedNarrativeTurn>;
    readonly narrating: Set<string>;
    bufferUserNarrative(story: InterludeStory, participant: InterludeParticipant, session: Session, now: Date, supersededIntents: NarrativeIntent[], content: string, imageSources: string[], audioSources: string[], quote: QuotedMessageContext | undefined, flushTrigger: (key: string, revision: number) => void, endpointId?: string): void;
    signalIncomingInterruption(story: InterludeStory, participant: InterludeParticipant): void;
    hasPendingNarrative(storyId: string, hasPendingGroupTurn: (storyId: string) => boolean): boolean;
    /** flush 开始：取回 turn 并标记 narrating；返回 null 表示不该 flush。 */
    beginFlush(key: string, revision: number, retryDelay: (key: string, revision: number) => void): BufferedNarrativeTurn | null;
    /** flush 结束：清理 narrating 标记和空 turn。 */
    endFlush(key: string, requestId: number): void;
    /** 暂停/恢复时重设定时器。 */
    rescheduleTimers(flushTrigger: (key: string, revision: number) => void): void;
    /** 使全部（或指定故事的）回合失效。 */
    invalidateNarratives(storyId?: string, invalidateGroups?: (storyId?: string) => void): void;
    /** M2 §1.3：追加本回合来源端点（同回合第二端点追加而非新回合）。 */
    recordSource(key: string, endpointId: string, receivedSeq: number): void;
    /** 只读查询 */
    isNarrating(storyId: string): boolean;
    getTurn(key: string): BufferedNarrativeTurn | undefined;
    pendingTurnCount(): number;
}
export declare function createTurnEngine(deps: TurnEngineDeps): TurnEngine;
export type { BufferedNarrativeTurn as TurnBufferedNarrativeTurn, BufferedUserMessage as TurnBufferedUserMessage };
