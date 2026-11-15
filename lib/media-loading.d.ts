/** 媒体加载：原生音频（SnowLuma 转码获取）、原生图片（获取/重定向穿透/缓存/降采样/动图帧）、
 * 视觉侧端描述、事件文本投影（describeUserEvent）与 QQ 合并转发读取。
 * 会话内容提取纯函数在 session-platform/chat-artifacts。
 *
 * P8-S2 自 service.ts 迁出（2026-10-29），行为不变；函数接收宿主（service
 * 或测试假宿主）为第一参数，service 保留同名薄委托。死图源记录与缓存
 * 容器留守 service，经宿主引用读写。 */
import { type Session } from 'koishi';
import { type ForwardReadResult } from './forward-message';
import type { InterludeStory, NarrativeImage, NarrativeAudio } from './types';
/** P8-S2：自 service.ts 迁入（2026-10-29），行为不变。 */
export declare function isTrustedImageHost(hostname: string): boolean;
/** Log only the acquisition channel and host. OneBot file identifiers and QQ
 * CDN URLs can contain expiring tokens, so the original source must never be
 * copied into an operational log line. */
export declare function describeImageSource(source: string): string;
/** QQ CDN 下载链接过期签名：HTTP 400 + retcode -5503007 / "download url has
 * expired"。此状态对该 URL 永久成立（令牌已失效，不会恢复），与限流或瞬时
 * 网络错误不同，因此值得与其它 4xx 区分开来单独缓存。 */
export declare function isExpiredImageUrlError(error: unknown): boolean;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function describeUserEvent(svc: any, story: InterludeStory, session: Session, forward?: ForwardReadResult): {
    content: any;
    sources: any;
    audioSources: string[];
    quote: import("./types").QuotedMessageContext;
};
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function readForward(svc: any, session: Session): Promise<ForwardReadResult>;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function loadNativeAudio(svc: any, story: InterludeStory, sources: string[], session?: Session, maxCount?: number): Promise<NarrativeAudio[]>;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function fetchNativeAudio(svc: any, source: string, session?: Session): Promise<{
    format: any;
    base64: any;
}>;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function describeVisionEvent(svc: any, session: Session): {
    content: string;
    sources: string[];
};
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function loadNativeImages(svc: any, story: InterludeStory, sources: string[], session?: Session): Promise<NarrativeImage[]>;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function describeCurrentImages(svc: any, story: InterludeStory, images: NarrativeImage[], userMessage: string | undefined): Promise<any>;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function isExpiredImageSource(svc: any, source: string): any;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function deadImageSourceReason(svc: any, source: string): any;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function rememberDeadImageSource(svc: any, source: string, reason: string): void;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function fetchNativeImage(svc: any, source: string, bot?: any, adapterProvided?: boolean): Promise<any>;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function fetchImageThroughRedirects(svc: any, url: URL, adapterProvided: boolean): Promise<{
    data: ArrayBuffer;
    headers: {
        get(name: string): string | null;
    };
}>;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function fetchNativeImageUncached(svc: any, source: string, bot?: any, adapterProvided?: boolean): Promise<any>;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function imageBytesToNative(svc: any, bytes: Buffer, mimeType: string): Promise<any>;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function downscaleImageForVision(svc: any, image: {
    mimeType: string;
    dataUri: string;
}): Promise<any>;
/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function renderAnimatedImageFrame(svc: any, dataUri: string): Promise<any>;
