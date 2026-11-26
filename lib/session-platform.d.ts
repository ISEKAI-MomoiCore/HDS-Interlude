/** 平台身份与会话素材：story/participant/群号归一化、OneBot 平台判定、
 * 会话图片/语音/文件提取、超时与 MIME 探测、端点参与者匹配（模块级单例）。
 * P1 自 service.ts 尾部迁出（2026-10-29），行为不变。 */
import { Session } from 'koishi';
import type { InterludeService } from './service';
import { InterludeParticipant } from './types';
import type { OneBotAccountRule } from './service';
export declare function mergeForwardContent(existing: string, forward: string): string;
export declare function storyIdForCharacter(platform: string, selfId: string): string;
export declare function legacyStoryIdFor(platform: string, selfId: string, userId: string): string;
export declare function participantIdFor(platform: string, selfId: string, userId: string): string;
export declare function participantIdForStory(storyId: string, platform: string, selfId: string, userId: string): string;
/**
 * M2 §1.2：端点集合匹配——参与者名下任一启用 user 端点行命中即该参与者；
 * 注册表未命中时回落旧字段比对（单平台等价）。
 */
/**
 * M2 §1.2：端点集合匹配——参与者名下任一启用 user 端点行命中即该参与者；
 * 注册表未命中时回落旧字段比对（单平台等价）。
 */
export declare function sameParticipantEndpoint(participant: InterludeParticipant, session: Session): boolean;
export declare function bindActiveServiceForEndpoints(service: InterludeService | null): void;
export declare function isOneBotPlatform(platform: string | undefined): boolean;
/**
 * Resolve the adapter-facing channel id for a private delivery.
 *
 * OneBot's `sendMessage()` treats a bare numeric id as a group channel. The
 * incoming session already carries the correct private route, but delayed or
 * split deliveries often have no live session and therefore reach this helper.
 * Keep explicitly typed private ids intact and make the OneBot family use the
 * unambiguous `private:<userId>` form.
 */
/**
 * Resolve the adapter-facing channel id for a private delivery.
 *
 * OneBot's `sendMessage()` treats a bare numeric id as a group channel. The
 * incoming session already carries the correct private route, but delayed or
 * split deliveries often have no live session and therefore reach this helper.
 * Keep explicitly typed private ids intact and make the OneBot family use the
 * unambiguous `private:<userId>` form.
 */
export declare function privateDeliveryChannelId(platform: string, userId: string | undefined, channelId: string | undefined): string;
/** OneBot 目标 ID 类型规则——纯数字串转 number（QQ 的 user_id/group_id
 * 规范类型），其余（wxid_xxx / @chatroom 等字符串 ID）原样传 string。此前
 * Number() 一刀切会把非数字 ID 变成 NaN 直发上游。 */
/** OneBot 目标 ID 类型规则——纯数字串转 number（QQ 的 user_id/group_id
 * 规范类型），其余（wxid_xxx / @chatroom 等字符串 ID）原样传 string。此前
 * Number() 一刀切会把非数字 ID 变成 NaN 直发上游。 */
export declare function onebotTargetId(channelId: string): string | number;
/** 日志 QQ 号脱敏——5-12 位数字段保留尾 4 位（够关联排查），其余打码。
 * 只用于 summary 级（verbosity 关不掉）的入站消息行；standard/diagnostic 级
 * 的完整 ID 已有 verbosity 门控，保持原样。 */
/** 日志 QQ 号脱敏——5-12 位数字段保留尾 4 位（够关联排查），其余打码。
 * 只用于 summary 级（verbosity 关不掉）的入站消息行；standard/diagnostic 级
 * 的完整 ID 已有 verbosity 门控，保持原样。 */
export declare function maskQqIds(value: unknown): string;
export declare function extractSessionImageSources(session: Session): string[];
/** Persist only bounded, reloadable image references for group history. Native
 * data URIs are intentionally excluded: durable script metadata must never carry
 * binary image payloads or turn-sized base64 strings. */
/** Persist only bounded, reloadable image references for group history. Native
 * data URIs are intentionally excluded: durable script metadata must never carry
 * binary image payloads or turn-sized base64 strings. */
export declare function groupImageRefsForStorage(sources: string[]): {
    source: string;
    ordinal: number;
    sourceType: "url" | "file";
}[];
/** Detect record/audio segments from both Koishi elements and raw OneBot CQ
 * fallback without retaining the binary voice payload. */
/** Detect record/audio segments from both Koishi elements and raw OneBot CQ
 * fallback without retaining the binary voice payload. */
export declare function extractSessionVoiceCount(session: Pick<Session, 'content'>): number;
/** Extract fetchable voice/audio tokens for the native-audio channel.
 * Unlike images, records prefer the OneBot file token: raw record URLs serve
 * SILK, which only SnowLuma's server-side transcode (get_record out_format)
 * can turn into a model-readable audio payload. */
/** Extract fetchable voice/audio tokens for the native-audio channel.
 * Unlike images, records prefer the OneBot file token: raw record URLs serve
 * SILK, which only SnowLuma's server-side transcode (get_record out_format)
 * can turn into a model-readable audio payload. */
export declare function extractSessionAudioSources(session: Session): string[];
export interface SessionFileFact {
    name: string;
    url: string;
    size: number;
    audio: boolean;
}
/** Inbound `<file>` elements carry the QQ CDN URL, display name and size.
 * They are attachment facts: the raw markup must never reach the model as
 * text, and audio-named files feed the native-audio channel. */
/** Inbound `<file>` elements carry the QQ CDN URL, display name and size.
 * They are attachment facts: the raw markup must never reach the model as
 * text, and audio-named files feed the native-audio channel. */
export declare function extractSessionFileFacts(session: Session): SessionFileFact[];
/** 群聊入站没有原生附件通道：把 <img>/<file>/<record> 等元素标记转成事实
 * 占位（保留"发过什么"的信息），URL 污水不进群上下文，也不再被模型复述。 */
/** 群聊入站没有原生附件通道：把 <img>/<file>/<record> 等元素标记转成事实
 * 占位（保留"发过什么"的信息），URL 污水不进群上下文，也不再被模型复述。 */
export declare function describeGroupAttachments(content: unknown): string;
/** Limit transport waits. Timeout only marks the outcome unknown; callers own
 * ledger transitions, reconciliation, and any decision to schedule retries. */
export declare function withTransportTimeout<T>(promise: Promise<T>, label: string, timeoutMs?: number): Promise<T>;
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T>;
export declare function guessImageMime(bytes: Buffer, hinted?: unknown): string;
/** Audio files arrive as original bytes (unlike SILK voice records). Accept
 * only formats the OpenAI-compatible input_audio channel documents. */
/** Audio files arrive as original bytes (unlike SILK voice records). Accept
 * only formats the OpenAI-compatible input_audio channel documents. */
export declare function guessAudioFormat(bytes: Buffer, hintedName?: string): string;
export declare function isAnimatedImageMime(mime: string): mime is "image/gif" | "image/webp" | "image/apng";
export declare function sessionGroupId(session: Session): string;
/** Historical group metadata used both prefixed IDs and numeric QQ IDs. */
/** Historical group metadata used both prefixed IDs and numeric QQ IDs. */
export declare function groupIdStorageVariants(value: string): Array<string | number>;
export { normalizeGroupId, normalizeAccountId } from './platform/identity';
/** Treat OneBot transport aliases as one administrator-facing platform family. */
export declare function samePlatformFamily(left: string | undefined, right: string | undefined): boolean;
/** Normalize transport-qualified QQ ids such as private:123 or onebot:123. */
/** Normalize transport-qualified QQ ids such as private:123 or onebot:123. */
/** 剧本历史注入预算（纯函数，可单测）。
 * M4.1 曾在此处叠加 Math.max(35, …) 硬地板保护连续性——副作用是 Console 里
 * 调小 contextEntryLimit 完全失效，小模型无法收缩上下文。现在尊重用户设置：
 * 条数默认 35（schema 默认），需要更小历史的部署（小模型）可显式调小，
 * 并配合把 contextTimeWindowMinutes 调小或设 0（时间窗会把近窗口内的全部
 * 条目并入，即使超过条数）。 */
/** Koishi/Satori uses numeric Universal.Status values; keep legacy string adapters compatible. */
export declare function isBotOnlineStatus(status: unknown): boolean;
export interface ManageSessionDenial {
    /** onebot = 互动白名单拒绝；managers = managerAccounts 不匹配。两层配置不同，指引不同。 */
    layer: 'onebot' | 'managers';
    /** 供命令回复、doctor 与日志共用的完整原因（含可操作指引）。 */
    detail: string;
}
/** 管理权限判定的纯函数核心（可单测）。返回 undefined = 允许。
 * 此前两层失败共用一句"需要 HDSI 管理员权限"，用户给了管理员仍被拒时
 * 排障方向完全被带偏；实际原因必须在消息与默认日志里直接可读。 */
export declare function manageSessionDenialReason(input: {
    platform?: string;
    selfId?: string;
    userId?: string;
    onebot?: {
        enabled?: boolean;
        ignoreSelfMessages?: boolean;
        botAccounts?: OneBotAccountRule[];
        userAccounts?: OneBotAccountRule[];
    };
    managers?: string[];
}): ManageSessionDenial | undefined;
export declare function isEnabledAccount(accounts: OneBotAccountRule[] | undefined, qq: string): boolean;
