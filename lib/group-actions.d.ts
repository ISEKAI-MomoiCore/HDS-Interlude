/** 群能力与动作执行：能力投影（群/私聊可用动作）、群反应执行、贴纸与
 * 原生表情发送（含桌面桥动作代理与结果语义——ambiguous 只记 pending）。
 * 表情语义映射在 qq-face.ts，意愿校准纯函数在 chat-artifacts。
 *
 * P8-S4 自 service.ts 迁出（2026-10-29），行为不变；函数接收宿主（service
 * 或测试假宿主）为第一参数，service 保留同名薄委托。 */
import { type Session } from 'koishi';
import type { ChatActionCapabilities, LocalMediaDraft, NarrativeDecision, StickerAsset, StickerCatalogEntry } from './types';
import type { ScriptDeliveryReference } from './script/delivery-ledger';
import type { InterludeStory, GroupMessageContext, NativeFaceSemantic } from './types';
import type { ExecutableMessageReaction } from './service';
/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function groupCooldownActive(svc: any, storyId: string, groupId: string, cooldownSeconds: number): Promise<boolean>;
/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function groupChatCapabilities(svc: any, session: Session | undefined, messages: GroupMessageContext[]): ChatActionCapabilities | undefined;
/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function privateChatCapabilities(svc: any, session: Session | undefined): ChatActionCapabilities | undefined;
/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function executeGroupReactions(svc: any, story: InterludeStory, session: Session, groupId: string, reactions: ExecutableMessageReaction[], referenceFor?: (reaction: ExecutableMessageReaction) => ScriptDeliveryReference | undefined): Promise<number>;
/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function resolveSticker(svc: any, draft: LocalMediaDraft | undefined, catalog: StickerCatalogEntry[]): any;
/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function resolveNativeFace(svc: any, decision: NarrativeDecision, capabilities: ChatActionCapabilities | undefined): NativeFaceSemantic;
/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function sendSticker(svc: any, story: InterludeStory, session: Session, channelId: string, asset: StickerAsset, groupId?: string, reference?: ScriptDeliveryReference): Promise<boolean>;
/** P8-S4 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function sendNativeFace(svc: any, story: InterludeStory, session: Session, channelId: string, semantic: NativeFaceSemantic, groupId?: string, reference?: ScriptDeliveryReference): Promise<boolean>;
