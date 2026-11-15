/** 端点注册表接线层（M1a）：加载/补齐/迁移端点行与别名、三维时效状态
 * （连接/可投递/主动联系）的观测与门控、出站地址解析、端点写队列串行化、
 * 入站反向解析封装与用户/角色端点链接管理。纯策略与表结构在 endpoints.ts
 * （规格：docs/MULTI_CHANNEL_SINGLE_STORY_DESIGN.md v3）。
 *
 * P4 自 service.ts 迁出（2026-10-29），行为不变。函数接收宿主（service 实例
 * 或测试假宿主）为第一参数——与 delivery/pipeline.ts、qzone-executor.ts 同一
 * 形态；service.ts 保留同名薄委托，既有调用点（含 index.ts 管理命令）与测试
 * 零改动。单平台零影响纪律：注册表未命中一律回落旧路径，绝不自动挂载。 */
import { type EndpointRow, type EndpointState, type EndpointChannelKind } from './endpoints';
import type { InterludeParticipant, InterludeStory, NarrativeEndpointOption } from './types';
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function enqueueEndpointWrite<T>(svc: any, task: () => Promise<T>): any;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function persistEndpointState(svc: any, endpointId: string, state: EndpointState): void;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function setEndpointState(svc: any, endpointId: string, state: EndpointState): void;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function endpointGateReason(svc: any, endpointId: string | undefined, now?: number, options?: {
    ignoreCooldown?: boolean;
}): "endpoint-not-found" | "endpoint-not-deliverable" | "endpoint-disabled" | "endpoint-offline" | "endpoint-cooldown" | "endpoint-state-expired";
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function liveBotForEndpoint(svc: any, row: EndpointRow): any;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function endpointInitiateGateReason(svc: any, endpointId: string | undefined, now?: number): any;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function endpointForDelivery(svc: any, endpointId: string | undefined, owner: {
    kind: 'story-role' | 'participant-user' | 'group';
    id: string;
}, now?: number, options?: {
    ignoreCooldown?: boolean;
}): {
    reason?: undefined;
    row?: undefined;
} | {
    reason: any;
    row?: undefined;
} | {
    row: any;
    reason?: undefined;
};
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function ensureEndpointRegistry(svc: any): Promise<any>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function reconcileEndpointRegistry(svc: any): Promise<void>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function registerStoryRoleEndpointRow(svc: any, story: {
    id: string;
    platform: string;
    selfId: string;
}): Promise<void>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function registerParticipantUserEndpointRow(svc: any, participant: {
    id: string;
    platform: string;
    selfId: string;
    userId: string;
}): Promise<void>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function backfillQzoneEndpointIds(svc: any): Promise<void>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function recordStoryAlias(svc: any, aliasStoryId: string, canonicalStoryId: string, reason: string, announce?: boolean): Promise<boolean>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function resolveStoryIdAlias(svc: any, aliasStoryId: string): Promise<string>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function removeStoryAlias(svc: any, aliasStoryId: string, reason?: string): Promise<{
    ok: boolean;
    error: string;
} | {
    ok: boolean;
    error?: undefined;
}>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function listStoryAliases(svc: any): any[];
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function addStoryEndpoint(svc: any, story: InterludeStory, platform: string, selfId: string, channelKind?: EndpointChannelKind): Promise<any>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function disableStoryEndpoint(svc: any, endpointId: string): Promise<{
    ok: boolean;
    error: string;
} | {
    ok: boolean;
    error?: undefined;
}>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function resolveMostActiveEndpointId(svc: any, participantId: string): any;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function narrativeEndpointSelection(svc: any, story: InterludeStory, participants: InterludeParticipant[], groups: Array<{
    participantId: string;
    groupId: string;
    label: string;
}>): {
    enabled: boolean;
    options: NarrativeEndpointOption[];
};
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function linkParticipantEndpoint(svc: any, participant: InterludeParticipant, platform: string, userId: string): Promise<{
    ok: boolean;
    error: string;
    endpointId?: undefined;
} | {
    ok: boolean;
    endpointId: any;
    error: string;
} | {
    ok: boolean;
    endpointId: string;
    error?: undefined;
}>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function unlinkParticipantEndpoint(svc: any, endpointId: string): Promise<{
    ok: boolean;
    error: string;
} | {
    ok: boolean;
    error?: undefined;
}>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function listParticipantEndpoints(svc: any, participantId: string): any;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function resolveRoleAccountKey(svc: any, storyId: string, platform: string): any;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function listStoryEndpoints(svc: any, storyId: string): any;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function resolveInboundEndpointFor(svc: any, source: {
    platform: string;
    selfId: string;
    userId?: string;
    groupId?: string;
    channelId?: string;
}): Promise<import("./endpoints").InboundResolution>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function channelMetadataFor(svc: any, source: {
    platform: string;
    selfId: string;
    userId?: string;
    groupId?: string;
    channelId?: string;
}, extra?: {
    userId?: string;
    groupId?: string;
    channelId?: string;
}): Promise<{
    groupId?: string;
    userId?: string;
    channelId?: string;
    endpointId: string;
    channelKind: string;
    platform: string;
    accountKey: string;
    selfId: string;
    conversationKind: "group" | "private";
}>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function touchEndpointStateInbound(svc: any, source: {
    platform: string;
    selfId: string;
    userId?: string;
    groupId?: string;
    channelId?: string;
}): Promise<void>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function syncCurrentBotConnections(svc: any): Promise<void>;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function noteEndpointConnection(svc: any, accountKey: string, online: boolean): void;
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function endpointAddressSync(svc: any, legacy: {
    platform: string;
    selfId: string;
}, owner?: {
    kind: 'story-role' | 'participant-user';
    id: string;
}): {
    platform: string;
    selfId: string;
} | {
    platform: any;
    selfId: any;
    endpointId: any;
};
/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function noteEndpointOutbound(svc: any, owner: {
    kind: 'story-role' | 'participant-user' | 'group';
    id: string;
}, ok: boolean, note: string, address?: {
    platform: string;
    selfId: string;
}): void;
