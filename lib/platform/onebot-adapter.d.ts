import type { InterludeService } from '../service';
import type { TurnHandle } from '../turn-engine';
import type { EarlyNarrativeReply, InterludeParticipant, InterludeStory, NarrativeAudio, NarrativeImage, NativeFaceSemantic, OutgoingMessageDraft, ScriptEntry, StickerAsset } from '../types';
import type { ScriptDeliveryReference } from '../script/delivery-ledger';
import type { PlatformAdapter } from './adapter';
export declare class OneBotAdapter implements PlatformAdapter {
    private readonly host;
    /** 句柄→会话解析表。引用语义见 service 旧注释（审计 F3）：被引擎
     * turns 的 latestHandle 引用的键绝不逐出；同通道重登记刷新近用顺序。 */
    private readonly sessions;
    constructor(host: InterludeService);
    private key;
    rememberSession(handle: TurnHandle, session: unknown): void;
    resolveSession(handle: TurnHandle | undefined): unknown;
    pruneSessions(cap: number, protectKey?: string): void;
    sessionCount(): number;
    private session;
    privateCapabilities(handle: TurnHandle | undefined): import("..").ChatActionCapabilities;
    stickerCatalog(handle: TurnHandle | undefined, turnQueryEmbedding?: number[]): Promise<import('../types').StickerCatalogEntry[]>;
    loadImages(story: InterludeStory, sources: string[], handle: TurnHandle | undefined): Promise<NarrativeImage[]>;
    loadAudio(story: InterludeStory, sources: string[], handle: TurnHandle | undefined, maxCount?: number): Promise<NarrativeAudio[]>;
    deliverOutgoing(story: InterludeStory, messages: OutgoingMessageDraft[], participant?: InterludeParticipant, handle?: TurnHandle, shouldCancel?: (target: InterludeParticipant) => boolean, recordFailures?: boolean, requestStartedAt?: Date, failureStatus?: 'failed' | 'pending', splitSegment?: boolean, confirmedEntries?: ScriptEntry[]): Promise<OutgoingMessageDraft[]>;
    deliverEarlyReply(story: InterludeStory, participant: InterludeParticipant, handle: TurnHandle | undefined, turn: Parameters<PlatformAdapter['deliverEarlyReply']>[3], requestId: number, reply: EarlyNarrativeReply, requestStartedAt?: Date): Promise<ScriptEntry | false | undefined>;
    sendSticker(story: InterludeStory, handle: TurnHandle | undefined, channelId: string, asset: StickerAsset, groupId?: string, reference?: ScriptDeliveryReference): Promise<boolean>;
    sendNativeFace(story: InterludeStory, handle: TurnHandle | undefined, channelId: string, semantic: NativeFaceSemantic, groupId?: string, reference?: ScriptDeliveryReference): Promise<boolean>;
    adoptSession(session: unknown): TurnHandle | undefined;
    groupCapabilities(handle: TurnHandle | undefined, messages: unknown[]): import("..").ChatActionCapabilities;
    historicalImages(story: InterludeStory, refs: unknown, limit: number, handle: TurnHandle | undefined, currentSources?: string[]): Promise<import("..").NarrativeHistoricalImage[]>;
    sendGroupMessage(story: InterludeStory, channelId: string, content: string, replyTo?: string, handle?: TurnHandle, shouldCancel?: () => boolean): Promise<{
        deliveredSegments: string[];
        complete: boolean;
        segmentOutcomes: any;
    }>;
    executeGroupReactions(story: InterludeStory, handle: TurnHandle | undefined, groupId: string, reactions: unknown[], reference: (reaction: unknown) => unknown): Promise<number>;
}
