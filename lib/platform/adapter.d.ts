/**
 * PlatformAdapter 端口（解耦设计 §4 / D2 切片）。
 *
 * 端口是叙事核心与平台之间的唯一边界：接口只使用中性类型（TurnHandle、
 * types.ts 的数据形状）——不 import koishi 的 Session、不 import
 * session-platform。平台实现（OneBotAdapter，后续 Discord/Telegram 各一）
 * 在端口另一侧解析句柄、回源媒体并执行传输。
 *
 * D2 形态约定：包装不搬移——适配器方法委托宿主（InterludeService）的既有
 * 函数，函数本体与锁相位不动，只把私聊回合执行体的调用路径改经端口。
 * D3 提取 NarrativeTurnExecutor 后，执行体将只持有本接口。
 */
import type { TurnHandle, TurnBufferedNarrativeTurn } from '../turn-engine';
import type { ChatActionCapabilities, EarlyNarrativeReply, InterludeParticipant, InterludeStory, NarrativeAudio, NarrativeImage, NativeFaceSemantic, OutgoingMessageDraft, ScriptEntry, StickerAsset, StickerCatalogEntry } from '../types';
import type { ScriptDeliveryReference } from '../script/delivery-ledger';
export interface PlatformAdapter {
    /** 入站登记：同通道后写覆盖（= 该通道最后一条消息的会话），刷新近用顺序。 */
    rememberSession(handle: TurnHandle, session: unknown): void;
    /** 按句柄取回会话；未登记/已回收返回 undefined，消费方按缺会话路径降级。 */
    resolveSession(handle: TurnHandle | undefined): unknown;
    /** 回收无回合引用的会话（上限只约束无引用项，引用项绝不逐出）。 */
    pruneSessions(cap: number): void;
    /** 解析表当前条目数（诊断/测试）。 */
    sessionCount(): number;
    privateCapabilities(handle: TurnHandle | undefined): ChatActionCapabilities | undefined;
    stickerCatalog(handle: TurnHandle | undefined, turnQueryEmbedding?: number[]): Promise<StickerCatalogEntry[]>;
    loadImages(story: InterludeStory, sources: string[], handle: TurnHandle | undefined): Promise<NarrativeImage[]>;
    loadAudio(story: InterludeStory, sources: string[], handle: TurnHandle | undefined, maxCount?: number): Promise<NarrativeAudio[]>;
    deliverOutgoing(story: InterludeStory, messages: OutgoingMessageDraft[], participant?: InterludeParticipant, handle?: TurnHandle, shouldCancel?: (target: InterludeParticipant) => boolean, recordFailures?: boolean, requestStartedAt?: Date, failureStatus?: 'failed' | 'pending', splitSegment?: boolean, confirmedEntries?: ScriptEntry[]): Promise<OutgoingMessageDraft[]>;
    /** 流式首泡提前投递（D3 起作为模型调用边界的端口回调）。 */
    deliverEarlyReply(story: InterludeStory, participant: InterludeParticipant, handle: TurnHandle | undefined, turn: TurnBufferedNarrativeTurn, requestId: number, reply: EarlyNarrativeReply, requestStartedAt?: Date): Promise<ScriptEntry | false | undefined>;
    /** 无可用会话时静默跳过并返回 false（旧调用点的 turnSession 守卫内化）。 */
    sendSticker(story: InterludeStory, handle: TurnHandle | undefined, channelId: string, asset: StickerAsset, groupId?: string, reference?: ScriptDeliveryReference): Promise<unknown>;
    sendNativeFace(story: InterludeStory, handle: TurnHandle | undefined, channelId: string, semantic: NativeFaceSemantic, groupId?: string, reference?: ScriptDeliveryReference): Promise<unknown>;
    /** 从宿主会话对象提取中性句柄并登记解析表；非会话对象返回 undefined。 */
    adoptSession(session: unknown): TurnHandle | undefined;
    groupCapabilities(handle: TurnHandle | undefined, messages: unknown[]): ChatActionCapabilities | undefined;
    historicalImages(story: InterludeStory, refs: unknown, limit: number, handle: TurnHandle | undefined, currentSources?: string[]): Promise<unknown[]>;
    sendGroupMessage(story: InterludeStory, channelId: string, content: string, replyTo?: string, handle?: TurnHandle, shouldCancel?: () => boolean): Promise<unknown>;
    executeGroupReactions(story: InterludeStory, handle: TurnHandle | undefined, groupId: string, reactions: unknown[], reference: (reaction: unknown) => unknown): Promise<number>;
}
