import { Context } from 'koishi';
import { type ContractTier, type ModelFamily, type SpecialtyProfile } from './specialization';
import { AlterAnalysisDecision, AlterAnalysisRequest, AlterSystemConfig, ChatActionCapabilities, CompactionDecision, CompactionRequest, NarrativeDecision, NarrativeProvider, OverlayCompactionDecision, OverlayCompactionRequest, EarlyNarrativeReply, LongArcGuidanceRequest, NarrativeCompactor, NarrativeEmbedder, NarrativeImage, NarrativeRequest, SchedulePreplanProposal, SchedulePreplanReviewRequest, ScriptEntry, StickerCatalogEntry, TimelinePlan, TimelinePlanRequest } from './types';
import { ModelRoutingTable } from './model-routing';
export { configuredProviders, effectiveMainModelId, resolveModelRouting, usesRemoteProviders, ZHIPU_OFFICIAL_CHAT_ENDPOINT, } from './model-routing';
/** 插件作用域已销毁（HMR 重载/停机）时的失败签名：在途 ctx.http 请求被
 * "context disposed" 中止；此后新建 effect 抛 "cannot create effect on
 * inactive context"。这类失败与提供商和服务质量无关——重试必然失败、
 * 冷却与告警都是噪音。调用方应立即放弃本轮并静默退出。 */
export declare function isContextDisposedError(error: unknown): boolean;
export { storyLocalTimeContext } from './time';
export type ProviderResponseFormat = 'json-object' | 'prompt-only';
export type ProviderStrategy = 'priority' | 'round-robin';
export type ZhipuReasoningEffort = 'low' | 'high' | 'max';
export type DeepSeekThinkingMode = 'inherit' | 'disabled' | 'enabled';
export type ProviderMode = 'openai-compatible' | 'zhipu-official' | 'openai-official' | 'deepseek-official' | 'moonshot-official' | 'dashscope-official' | 'siliconflow-official' | 'openrouter' | 'gemini-openai' | 'gemini-interactions';
export declare const ZHIPU_FIRST_VISIBLE_TOKEN_TIMEOUT = 45000;
/** 首 token 之后不再设总超时(长思考合法),但持续的流内静默判死:
 * 正常流式即使思考期也有 reasoning/心跳 chunk 不断续命,半开连接只会
 * 让 reader.read() 永久 pending——冻结整个回合且 failover 永远到不了下一家。 */
export declare const ZHIPU_STREAM_IDLE_TIMEOUT = 120000;
export interface StickerDescription {
    description: string;
    aliases: string[];
}
export interface StickerDescriber {
    available(): boolean;
    describeSticker(dataUri: string, mimeType: string, fileName: string, animated: boolean, responseFormat?: ProviderResponseFormat, maxTokens?: number): Promise<StickerDescription | undefined>;
}
/** Converts current user images into factual text for a text-only main narrator.
 * Results are transient and deliberately have no memory API. */
export interface VisionDescriber {
    available(): boolean;
    describeImages(images: NarrativeImage[], userText?: string, detail?: VisionDetail): Promise<string[] | undefined>;
}
export interface ProviderConfig {
    /** Missing in historical rows means Chat Completions. */
    protocol?: 'chat-completions' | 'anthropic-messages' | 'gemini-interactions';
    /** HTTP(S) 代理地址（如 http://127.0.0.1:7890）；空 = 直连。cordis http
     * 不读系统代理，需要代理的服务商（如 Google）在此显式配置。 */
    proxyAgent?: string;
    anthropicCache?: boolean;
    /** Legacy internal identifier. New Console rows derive identity from the model connection. */
    id?: string;
    label: string;
    enabled: boolean;
    endpoint: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number;
    maxTokens: number;
    timeout: number;
    responseFormat: ProviderResponseFormat;
    extraHeaders: string;
    extraBody: string;
    mode?: ProviderMode;
    /** One model connection can be assigned directly to each HDSI task. */
    useForMain?: boolean;
    useForCompaction?: boolean;
    useForAlter?: boolean;
    useForEmbedding?: boolean;
    useForStickers?: boolean;
    useForVision?: boolean;
    useForWorldSeeding?: boolean;
    zhipuOfficial?: boolean;
    reasoningEffort?: ZhipuReasoningEffort;
    deepseekOfficial?: boolean;
    deepseekThinking?: DeepSeekThinkingMode;
    deepseekReasoningEffort?: ZhipuReasoningEffort;
    dashscopeRegion?: 'beijing' | 'singapore' | 'us';
    /** Optional billing prices per one million tokens; 0 disables cost logging. */
    priceInput?: number;
    priceOutput?: number;
    priceCachedInput?: number;
}
export interface FailoverConfig {
    enabled: boolean;
    strategy: ProviderStrategy;
    maxAttemptsPerProvider: number;
    cooldownMinutes: number;
}
export interface ModelConfig {
    /** @deprecated Remote mode is inferred from enabled provider rows. */
    mode?: 'fallback' | 'openai-compatible';
    providers: ProviderConfig[];
    failover: FailoverConfig;
    mainPrompt?: string;
    formatPrompt?: string;
    fixedPrompt: string;
    stylePrompt: string;
    /** Central model catalogue. Task-specific settings may reference an entry by id. */
    models?: ModelProfile[];
    mainModelId?: string;
    mainTemperature?: number;
    mainTopP?: number;
    mainMaxTokens?: number;
    mainTimeout?: number;
    mainResponseFormat?: ProviderResponseFormat;
    /** 模型特化档位：off（默认，rc12 原样）/ lite / standard / full，Console 手动选择。 */
    specialization?: 'off' | ContractTier;
    /** 特化家族：auto（默认，按模型名识别，仅决定特化块）或显式指定（中转别名场景）。 */
    specializationFamily?: 'auto' | ModelFamily;
    /** Manual opt-in for streaming JSON transport; unavailable providers remain on full-response mode. */
    mainStreamingMode?: 'off' | 'experimental';
    /** cache-first reorders the user payload so stable blocks (history, memory layers) precede
     * per-turn fields, letting provider prefix caches hit across consecutive turns. */
    mainPayloadOrder?: 'legacy' | 'cache-first';
    compaction?: CompactionConfig;
    embedding?: EmbeddingConfig;
    /** OpenAI-compatible native image inputs for the current private-message turn. */
    vision?: VisionConfig;
    /** OpenAI-compatible native audio inputs for the current private-message turn. */
    audio?: AudioConfig;
}
export interface VisionConfig {
    enabled: boolean;
    /** native passes image_url to main narration; sidecar makes temporary factual observations. */
    mode?: 'native' | 'sidecar';
    detail?: VisionDetail;
    /** Longest allowed image edge for native vision inputs; 0 disables downscaling.
     * Downscaling re-renders the image through the optional Puppeteer service and
     * silently passes the original through when Puppeteer is unavailable. */
    maxImageDimension?: 0 | 512 | 768 | 1024;
}
export type VisionDetail = 'low' | 'high' | 'auto';
export interface AudioConfig {
    enabled: boolean;
    /** SnowLuma server-side transcode container for QQ voice records.
     * Raw SILK cannot be read by multimodal models, so the OneBot get_record
     * action is always asked for this output format. */
    outFormat?: 'mp3' | 'wav' | 'ogg' | 'm4a' | 'flac' | 'amr';
    /** Hard upper bound for one native audio attachment; larger files are skipped. */
    maxFileSizeMB?: number;
    /** Audio attachments accepted per incoming event. */
    maxPerMessage?: number;
}
export interface ModelProfile {
    id: string;
    label: string;
    enabled?: boolean;
    providerId: string;
    model: string;
    maxTokens: number;
    timeout: number;
    responseFormat: ProviderResponseFormat;
}
export interface CompactionConfig {
    enabled: boolean;
    modelId?: string;
    providerId: string;
    model: string;
    temperature: number;
    topP: number;
    maxTokens: number;
    timeout: number;
    responseFormat: ProviderResponseFormat;
    mainPrompt?: string;
    fixedPrompt: string;
    stylePrompt: string;
    /** 侧端 JSON 任务的输出预算（时间导演/长线指导/日程预排共用）。
     * 0 = 不发送 max_tokens（交由网关默认）。思考型模型需给 reasoning 留余量。 */
    sideTaskMaxTokens?: number;
}
/**
 * Embedding is deliberately configured separately from chat generation. A single
 * provider can be reused for its credentials, while the endpoint and model may
 * point at a cheaper or local vector model.
 */
export interface EmbeddingConfig {
    enabled: boolean;
    /** Enable semantic query embedding on the latency-sensitive live turn. */
    liveQuery?: boolean;
    /** Filter the sticker catalog to the most semantically relevant entries before injection. */
    semanticStickerFilter?: boolean;
    /** Vectorize raw history entries and recall the most relevant older moments per turn. */
    semanticHistory?: boolean;
    /** Reuses apiKey and extraHeaders from a configured chat provider. */
    providerId: string;
    modelId?: string;
    /** OpenAI-compatible /embeddings endpoint. Leave empty to derive it from the chat endpoint. */
    endpoint: string;
    model: string;
    /** 0 omits the optional OpenAI dimensions parameter. */
    dimensions: number;
    timeout: number;
    maxInputCharacters: number;
    /** Number of legacy facts to vectorize in each background maintenance pass. */
    backfillBatchSize: number;
}
export declare class SilentNarrator implements NarrativeProvider {
    decide(): Promise<NarrativeDecision>;
}
export declare class SilentCompactor implements NarrativeCompactor {
    compact(): Promise<CompactionDecision>;
    compactOverlay(): Promise<OverlayCompactionDecision>;
    planSchedulePreplan(): Promise<SchedulePreplanProposal | undefined>;
    planTimeline(): Promise<TimelinePlan | undefined>;
    planLongArcGuidance(): Promise<unknown | undefined>;
}
/** A no-op embedder lets memory retrieval fall back to rule-based ranking. */
export declare class SilentEmbedder implements NarrativeEmbedder {
    embed(): Promise<number[]>;
}
/**
 * Minimal OpenAI-compatible embedding client. It intentionally performs no
 * chat-provider failover: an embedding failure is non-fatal and the caller
 * simply uses importance/confidence/recency ranking for that turn.
 */
export declare class OpenAICompatibleEmbedder implements NarrativeEmbedder {
    private ctx;
    private config;
    private readonly routing;
    constructor(ctx: Context, config: ModelConfig, routing?: ModelRoutingTable);
    identity(): string;
    embed(input: string): Promise<number[]>;
}
export declare class OpenAICompatibleNarrator implements NarrativeProvider {
    private ctx;
    private config;
    private onUsage?;
    /**
     * 主写作与压缩共用服务商选择、冷却和 OpenAI 兼容协议；二者的提示词和
     * token/temperature 配置不同，因此同一个实例可承担两个接口。
     */
    private cooldownUntil;
    private roundRobinOffset;
    private lastSpecialtyKey;
    /** 侧端任务（压缩/时间导演）共用同一手动档位。 */
    private sideSpecialty;
    /** 手动特化：档位由 Console 显式选择（默认 off=rc12 原样）；家族默认按模型名识别。 */
    private resolveSpecialty;
    private readonly logger?;
    private readonly routing;
    constructor(ctx: Context, config: ModelConfig, silentLogs?: boolean, onUsage?: (record: TokenUsageRecord) => void, routing?: ModelRoutingTable);
    private assignedProviders;
    available(): boolean;
    visionAvailable(): boolean;
    decide(request: NarrativeRequest): Promise<NarrativeDecision>;
    /** 独立配置块（世界播种器等）复用侧任务请求链：提供商与参数显式传入，
     * 不经主叙事/压缩路由。JSON 合约与压缩器一致（json-object + 宽容解析）。 */
    customSideTask<T>(provider: ProviderConfig, task: string, timeout: number, temperature: number, maxTokens: number, system: string, user: string): Promise<T>;
    /** 思考型网关把 reasoning 计入 completion 预算：带小 cap 的侧端 JSON 任务
     * 会被推理挤到只剩残句（invalid JSON / Unterminated string at position N）。
     * 首次解析失败时去掉 max_tokens 原样重试一次；成功路径不多发任何请求。
     * 非流式响应逐一尝试全部文本字段（content/reasoning_content 等），与
     * parseChatJsonResponse 的宽容度一致。 */
    private sideTaskJson;
    /** P2 Fix: 侧端任务成败在 sideTaskJson 内直接上报——不依赖调用方改用新入口。 */
    onSideTaskHealth?: (task: string, ok: boolean) => void;
    setSideTaskHealthReporter(reporter: (task: string, ok: boolean) => void): void;
    compact(request: CompactionRequest): Promise<CompactionDecision>;
    planTimeline(request: TimelinePlanRequest): Promise<TimelinePlan | undefined>;
    planLongArcGuidance(request: LongArcGuidanceRequest): Promise<unknown | undefined>;
    planSchedulePreplan(request: SchedulePreplanReviewRequest): Promise<SchedulePreplanProposal | undefined>;
    compactOverlay(request: OverlayCompactionRequest): Promise<OverlayCompactionDecision>;
    analyzeAlter(request: AlterAnalysisRequest, alterConfig: AlterSystemConfig): Promise<AlterAnalysisDecision>;
    describeSticker(dataUri: string, mimeType: string, fileName: string, animated: boolean, responseFormat?: ProviderResponseFormat, maxTokens?: number): Promise<StickerDescription | undefined>;
    describeImages(images: NarrativeImage[], userText?: string, detail?: VisionDetail): Promise<string[] | undefined>;
    /** Record one provider response's token usage (if the provider reports any). */
    private collectUsage;
    private emitUsage;
    private postChat;
    private selectRouteProviders;
    private requestProvider;
}
export declare function createNarrator(ctx: Context, config: ModelConfig, silentLogs?: boolean, onUsage?: (record: TokenUsageRecord) => void, routing?: ModelRoutingTable): NarrativeProvider;
export declare function createStickerDescriber(ctx: Context, config: ModelConfig, silentLogs?: boolean, onUsage?: (record: TokenUsageRecord) => void, routing?: ModelRoutingTable): StickerDescriber;
export declare function createVisionDescriber(ctx: Context, config: ModelConfig, silentLogs?: boolean, onUsage?: (record: TokenUsageRecord) => void, routing?: ModelRoutingTable): VisionDescriber;
/** A single enabled model preset is the natural main narrator. This keeps the
 * Console configuration linear while preserving explicit selection for
 * installations that deliberately configure several models. */
export declare function withDeepSeekThinking(provider: ProviderConfig, requestBody: Record<string, unknown>): Record<string, unknown>;
export declare function createCompactor(ctx: Context, config: ModelConfig, silentLogs?: boolean, onUsage?: (record: TokenUsageRecord) => void, routing?: ModelRoutingTable): NarrativeCompactor;
export declare function createEmbedder(ctx: Context, config: ModelConfig, routing?: ModelRoutingTable): NarrativeEmbedder;
/** Returns the first complete transport object while the rest of the JSON is
 * still arriving. The contract asks for this field first, but scanning only
 * accepts a fully closed top-level value and never sends partial text. */
export declare function extractEarlyNarrativeReply(raw: string, group: boolean): EarlyNarrativeReply | undefined;
/** 裸引号修补(rc50 issue 报告):字符串内遇 '"' 前瞻跳过空白,下一字符是
 * , } ] : 之一或文本结束时视为真结束符;否则判定为散文里的裸引号(模型引用
 * 聊天内容的稳定习惯),补逃生符并留在字符串内。合法 \" 不受影响。 */
export declare function repairBareQuotes(text: string): string;
/** Normalized token accounting for one provider response. `cachedInputTokens`
 * is the provider-reported subset of input tokens served from prefix cache. */
export interface TokenUsageRecord {
    task: string;
    providerLabel: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    /** Prices per one million tokens; 0/undefined disables cost reporting. */
    priceInput?: number;
    priceOutput?: number;
    priceCachedInput?: number;
}
/** Accepts the OpenAI `usage` shape, DeepSeek's legacy cache fields, or anything
 * providers invent; unknown shapes simply yield an empty record. */
export declare function parseTokenUsage(usage: unknown): {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
};
/** Sum usage across attempts (failover/recovery each consume tokens); identity
 * and pricing come from the last record, i.e. the attempt that produced the
 * final answer. */
export declare function aggregateTokenUsages(records: TokenUsageRecord[]): TokenUsageRecord | undefined;
/** Billing for one record. Cached tokens are a subset of input tokens and are
 * billed at the cache price; everything else at the plain input price. */
export declare function computeTokenCost(record: TokenUsageRecord): {
    inputCost: number;
    outputCost: number;
    total: number;
    saved: number;
} | undefined;
/** One human-readable log line: usage numbers, cache hit rate, and optional
 * billing. Absent fields are simply omitted instead of printed as zero. */
export declare function formatTokenUsageLine(record: TokenUsageRecord): string;
export declare function systemPrompt(phase: NarrativeRequest['phase'], mainPrompt: string | undefined, formatPrompt: string | undefined, fixedPrompt: string, baseStylePrompt: string, storyStylePrompt: string, refreshContinuity?: boolean, alterEnabled?: boolean, agencyEnabled?: boolean, perspectiveEnabled?: boolean, outputRecovery?: boolean, chatCapabilities?: ChatActionCapabilities, hasQuotedMessage?: boolean, stickerCatalog?: StickerCatalogEntry[], schedulePreplanEnabled?: boolean, streamingReplyFirst?: boolean, cacheFirstPayload?: boolean, groupTurn?: boolean, writingOptions?: NarrativeRequest['writingOptions'], specialty?: SpecialtyProfile, proactiveContactMode?: 'strict' | 'natural' | 'balanced', channelSelectionEnabled?: boolean, longHorizonGuidance?: string): string;
export declare function writingAffordances(options?: NarrativeRequest['writingOptions']): string;
/** A guard paragraph rendered into the writing affordances when the host has
 * detected a fixed bubble-count run in her recent delivered replies. */
export declare function repetitionGuardInstruction(repetition?: {
    bubbles: number;
    consecutive: number;
}): string;
/** Detect a fixed bubble-count run in her recent delivered private replies.
 * Walks backward over the entries that will become recentScript; a batch
 * leader’s delivery metadata (bubbleIndex 0 with bubbleCount) is authoritative
 * for its whole batch, and entries without it fall back to contiguous
 * character-message runs bounded by any other entry kind. */
export declare function detectMessageRepetition(entries: ReadonlyArray<Pick<ScriptEntry, 'kind' | 'actor' | 'metadata'>>): {
    bubbles: number;
    consecutive: number;
} | undefined;
export declare function storyStateForPrompt(state: NarrativeRequest['story']['state']): {
    schemaVersion?: number;
    extensions?: Record<string, unknown>;
    settingOverlay: import("./types").StorySettingOverlay;
    activeSceneId?: number;
    activeArcId?: number;
    narrativeUpdateCount: number;
    lastContinuityUpdateAt?: string;
    automation: import("./types").StoryAutomationState;
    scenePresence?: import("./types").ScenePresenceState[];
    workingDetailResolutions?: Record<string, number>;
};
export type RecentScriptOwnership = 'protagonist-narrative' | 'user-delivered-message' | 'protagonist-delivered-message' | 'external-group-message' | 'system-event';
export declare function recentScriptOwnership(entry: Pick<NarrativeRequest['recentEntries'][number], 'kind' | 'actor'>): RecentScriptOwnership;
export declare function toPromptPayload(request: NarrativeRequest, options?: {
    cacheFirst?: boolean;
}): import("./script/context-compiler").CompiledNarrativeContext;
/** Compact ownership tags for cache-first payloads: one short label replaces the
 * kind/actor/participantId triple. Distinctions the ownership label alone would
 * lose (group posting, platform actions) survive as suffixes. */
export declare function compactScriptTag(kind: string, actor: string): "system" | "user" | "protagonist(group)" | "protagonist(action)" | "protagonist" | "protagonist-narration" | "group-member";
export declare function promptVisibleMessageContent(content: string, ownership: RecentScriptOwnership): string;
export declare function compactPromptEntries(entries: NarrativeRequest['recentEntries'], characterBudget: number, protectedSince?: Date): ScriptEntry[];
/** 压缩器输出的 lifeRhythm 五档归一化（narrator 侧轻校验；完整校验在 story-state）。 */
export declare function normalizeLifeRhythmDraft(value: unknown): {
    attention: string;
    basis: string;
} | undefined;
export declare function compactionPrompt(fixedPrompt: string, compactionMainPrompt?: string, compactionFixedPrompt?: string, compactionStylePrompt?: string, specialty?: {
    tier?: string;
}): string;
export declare function timelineDirectorPrompt(specialty?: {
    tier?: string;
}): string;
