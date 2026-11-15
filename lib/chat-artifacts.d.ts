/** 聊天工件归一化：QQ 表情/贴纸/引用消息/用户报时/时间线计划/群聊动作。
 * P1 自 service.ts 尾部迁出（2026-10-29），行为不变。 */
import { Session } from 'koishi';
import { NarrativeDecision, GroupContext, ScriptEntry, ChatActionCapabilities, ChatReactionName, NativeFaceSemantic, QuotedMessageContext, TimelinePlan, UserReportedTime } from './types';
import type { ExecutableGroupChatActions } from './service';
export declare const QQ_REACTION_IDS: Record<ChatReactionName, string>;
export declare const QQ_NATIVE_FACE_IDS: Record<NativeFaceSemantic, string>;
export declare function normalizeAllowedNativeFaces(value: unknown): NativeFaceSemantic[];
export declare function normalizeExpressionThreshold(value: unknown): number;
/**
 * A model's willingness is an intent estimate, not a transport permission.
 * Native faces need a visible-text counterpart so a model cannot turn every
 * routine reply into a face merely by returning willingness=1. The 0.90 cap
 * deliberately makes thresholds above 0.90 an effective near-disable mode.
 */
/**
 * A model's willingness is an intent estimate, not a transport permission.
 * Native faces need a visible-text counterpart so a model cannot turn every
 * routine reply into a face merely by returning willingness=1. The 0.90 cap
 * deliberately makes thresholds above 0.90 an effective near-disable mode.
 */
export declare function calibratedNativeFaceWillingness(semantic: NativeFaceSemantic, willingness: unknown, replyContent: unknown): number;
export declare function targetableMessageId(value: unknown): string;
export declare function groupMessageRef(entryId: number): string;
export declare function listStickerFiles(root: string): Promise<string[]>;
export declare function stickerMime(filePath: string): "image/gif" | "image/webp" | "image/jpeg" | "image/png";
/** The old punctuation-only id could collide (for example two filenames that
 * both normalize to bq--6-). Keep a readable path prefix, then append a
 * content hash fragment so every row is globally unique and stable for an
 * unchanged file. */
/** The old punctuation-only id could collide (for example two filenames that
 * both normalize to bq--6-). Keep a readable path prefix, then append a
 * content hash fragment so every row is globally unique and stable for an
 * unchanged file. */
export declare function stableStickerAssetId(filePath: string, hash: string): string;
/** 表情包投递 URL：Koishi HTTP 路由 + assetId（OneBot 实现回源下载） */
/** 表情包投递 URL：Koishi HTTP 路由 + assetId（OneBot 实现回源下载） */
export declare function stickerDeliveryUrl(base: string, assetId: string): string;
/** 表情包本地文件 URI：file:/// + 正斜杠绝对路径（Linux 与 Windows 盘符
 * 两种形态都产出三斜杠标准形；SnowLuma/NapCat 的图片段按 file:// 与
 * 含分隔符的本地路径解析，见 SnowLuma element-codecs 的 file 优先规则）。 */
/** 表情包本地文件 URI：file:/// + 正斜杠绝对路径（Linux 与 Windows 盘符
 * 两种形态都产出三斜杠标准形；SnowLuma/NapCat 的图片段按 file:// 与
 * 含分隔符的本地路径解析，见 SnowLuma element-codecs 的 file 优先规则）。 */
export declare function stickerFileUrl(absolutePath: string): string;
/** Extract only explicit clock statements from a live user message. This is a
 * small factual aid, not an attempt to infer every temporal expression. */
/** Extract only explicit clock statements from a live user message. This is a
 * small factual aid, not an attempt to infer every temporal expression. */
export declare function extractUserReportedTimes(content: string, now: Date, timezone: string): UserReportedTime[];
export declare function describeQuotedMessage(session: Session, characterName?: string): QuotedMessageContext | undefined;
export declare function normalizeQuotedMessageContent(value: unknown): string;
export declare function normalizeQuotedMessageContext(value: unknown): QuotedMessageContext | undefined;
export declare function normalizeAllowedReactions(value: unknown): ChatReactionName[];
/** Parse only the narrow event ledger shape. Unknown model fields and empty
 * plans are discarded before they can become a source of world state. */
/** Parse only the narrow event ledger shape. Unknown model fields and empty
 * plans are discarded before they can become a source of world state. */
export declare function normalizeTimelinePlan(value: unknown): TimelinePlan | undefined;
/** Human-readable diff of why a model plan was rejected, for the warn log. */
/** Human-readable diff of why a model plan was rejected, for the warn log. */
export declare function describeTimelinePlanRejection(value: unknown): string;
/** Automatic script prose is a rendering, not the next turn's temporal source.
 * A compact host ledger retains the real sequence without letting a previous
 * paragraph be copied into a new time window. */
/** Automatic script prose is a rendering, not the next turn's temporal source.
 * A compact host ledger retains the real sequence without letting a previous
 * paragraph be copied into a new time window. */
export declare function timelineEntryPromptProjection(entry: ScriptEntry): ScriptEntry;
export declare function normalizeGroupChatActions(decision: NarrativeDecision, capabilities: ChatActionCapabilities | undefined, context: GroupContext): ExecutableGroupChatActions;
export declare function formatGroupSpeaker(senderName: string, senderId: string): string;
export declare function normalizeGroupDisplayName(...candidates: unknown[]): string;
export declare function mentionsBot(session: Session): boolean;
