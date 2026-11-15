import type { ModelConfig, ProviderConfig, ProviderResponseFormat } from './narrator';
import type { AlterSystemConfig } from './types';
export type ModelTask = 'main' | 'compaction' | 'timeline' | 'alter' | 'embedding' | 'stickers' | 'vision' | 'research';
export interface ResolvedModelTarget {
    providerId: string;
    model: string;
    maxTokens?: number;
    timeout?: number;
    responseFormat?: ProviderResponseFormat;
}
export interface ResolvedModelRoute {
    task: ModelTask;
    target: ResolvedModelTarget;
    /** Ordered static candidates. Runtime cooldown may temporarily reorder them. */
    providers: ProviderConfig[];
    assigned: boolean;
    available: boolean;
    reason: 'assigned-provider' | 'model-profile' | 'task-config' | 'legacy-fallback' | 'disabled' | 'unavailable';
}
export interface ModelRoutingTable {
    providers: ProviderConfig[];
    main: ResolvedModelRoute;
    compaction: ResolvedModelRoute;
    timeline: ResolvedModelRoute;
    alter: ResolvedModelRoute;
    embedding: ResolvedModelRoute;
    stickers: ResolvedModelRoute;
    vision: ResolvedModelRoute;
    research: ResolvedModelRoute;
}
export declare const ZHIPU_OFFICIAL_CHAT_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
export declare function resolveModelRouting(config: ModelConfig, alterConfig?: AlterSystemConfig): ModelRoutingTable;
export declare function resolveModelTarget(config: ModelConfig, modelId: string | undefined, providerId: string | undefined, model: string | undefined): ResolvedModelTarget;
export declare function effectiveMainModelId(config: ModelConfig): string;
export declare function configuredProviders(config: ModelConfig): ProviderConfig[];
export declare function usesRemoteProviders(config: ModelConfig): boolean;
export declare function providerKey(provider: ProviderConfig): string;
export declare function isAssignedTo(provider: ProviderConfig, task: Exclude<ModelTask, 'timeline'>): boolean;
export declare function formatModelRouting(table: ModelRoutingTable): string;
export declare function normalizeProtocolEndpoint(endpoint: string, protocol: ProviderConfig['protocol']): string;
