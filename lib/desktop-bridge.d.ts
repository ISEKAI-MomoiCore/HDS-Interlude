import type { InterludeService } from './service';
export type DesktopRuntimePhase = 'running' | 'muted' | 'paused';
export type DesktopDeliveryStatus = 'sent' | 'retryable-failed' | 'permanent-failed';
/** W3 桥接动作代理结果帧（宿主 → worker）。ambiguous 与插件 QzoneActionError 同族：
 * 传输异常/超时时可能已到达服务端，调用方必须保守处理（计入配额、禁止自动重试）。 */
export interface DesktopOnebotActionResult {
    ok: boolean;
    data?: unknown;
    errorCode?: string;
    ambiguous?: boolean;
    error?: string;
}
export interface DesktopInboundEvent {
    /** Host-owned business correlation ID; optional for older desktop hosts. */
    traceId?: string;
    transport: 'snowluma' | 'onebot-external' | 'sandbox';
    accountKey: string;
    platform: string;
    selfId: string;
    senderId: string;
    senderName?: string;
    channelId?: string;
    kind: 'private' | 'group';
    content: string;
    occurredAt: string;
    quote?: unknown;
    imageSources?: string[];
    voice?: unknown;
    rawMessageId?: string;
}
export declare function installDesktopBridge(service: InterludeService): () => void;
