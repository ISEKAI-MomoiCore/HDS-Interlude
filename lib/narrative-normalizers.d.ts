/** 叙事归一化与计算助手：可见回复裁剪、决策/交互/意图/事实/回访归一化、
 * 召回打分、节奏与钟点越界检测、overlay 归并，及通用微工具（clip/isRecord/toDate 等）。
 * P1 自 service.ts 尾部迁出（2026-10-29），行为不变。 */
import { IntentDraft, InterludeParticipant, InterludeStory, NarrativeDecision, NarrativeFact, NarrativeIntent, GroupContext, NarrativeInteraction, NarrativeRequest, OutgoingMessageDraft, ParticipantState, ScriptEntry, StatePatchProposal, StorySetting, BrowserIntentDraft, OverlaySnapshot, WebObservation, ScenePresenceState, FollowUpCommitmentDraft, FollowUpResolutionDraft, NarrativeContractFeatures } from './types';
import { type TurnBufferedUserMessage as BufferedUserMessage } from './turn-engine';
import type { BlindModeConfig, MemoryConfig, RuntimeConfig, BrowserConfig, SharedStoryConfig, RestWindow, AutoAdvanceConfig } from './service';
export declare function normalizeGroupVisibleReply(raw: NarrativeDecision['groupReply'], interaction: NarrativeDecision['interaction'], maxCharacters: number, separator?: string, splitEnabled?: boolean): string;
/** 无 participant 回合的 interaction 容错：群聊回合（user-message 且无 participant）
 * 把 immediate 的 interaction 回复提升为 groupReply 参与提交与投递——简洁协议把
 * interaction 形态写在最前，弱模型常在群聊照抄私聊形态。不提升时 commit-builder
 * 会为无 participant 的 interaction 生成 outgoing-message 事件，结构校验失败导致
 * 整回合静默。其余无 participant 相位（advance 等）本无回复通道，携带内容的
 * interaction 一律剥离，同样避免校验失败。 */
/** 无 participant 回合的 interaction 容错：群聊回合（user-message 且无 participant）
 * 把 immediate 的 interaction 回复提升为 groupReply 参与提交与投递——简洁协议把
 * interaction 形态写在最前，弱模型常在群聊照抄私聊形态。不提升时 commit-builder
 * 会为无 participant 的 interaction 生成 outgoing-message 事件，结构校验失败导致
 * 整回合静默。其余无 participant 相位（advance 等）本无回复通道，携带内容的
 * interaction 一律剥离，同样避免校验失败。 */
export declare function hoistParticipantlessInteraction<T extends NarrativeDecision>(decision: T, phase: NarrativeRequest['phase']): T;
export declare function requiresVisibleReplyRecovery(phase: NarrativeRequest['phase'], groupContext: GroupContext | undefined, decision: NarrativeDecision): boolean;
export declare function visibleReplyMode(decision: NarrativeDecision, phase: NarrativeRequest['phase'], groupContext?: GroupContext): string;
/** Compact JSON for diagnostic logs: never throws, bounded length. */
/** Compact JSON for diagnostic logs: never throws, bounded length. */
export declare function safeJsonPreview(value: unknown): string;
export declare function sanitizeAndClampVisibleContent(value: unknown, maxCharacters: number, separator?: string): string;
/** 可见回复的气泡拆分（纯函数，可单测）。
 * 小模型适配开关：模型没有按合约输出 <sep/> 而是用换行分条时，把换行运行
 * （含单个换行与 CRLF）视作气泡边界。仅在内容不含显式分隔符时转换——
 * 模型自己写了 <sep/> 就尊重原样；群路径的空行转换（normalizeGroupVisibleReply）
 * 发生在更早阶段且已含分隔符，同样不会被二次改写。 */
/** 可见回复的气泡拆分（纯函数，可单测）。
 * 小模型适配开关：模型没有按合约输出 <sep/> 而是用换行分条时，把换行运行
 * （含单个换行与 CRLF）视作气泡边界。仅在内容不含显式分隔符时转换——
 * 模型自己写了 <sep/> 就尊重原样；群路径的空行转换（normalizeGroupVisibleReply）
 * 发生在更早阶段且已含分隔符，同样不会被二次改写。 */
export declare function splitVisibleReplyBubbles(content: string, options: {
    separator?: string;
    splitEnabled: boolean;
    newlineAsSeparator?: boolean;
}): string[];
export declare function literalQuoteText(value: unknown): string;
export declare function isLiteralQuoteOnly(value: unknown): boolean;
/** Treat OneBot transport aliases as one administrator-facing platform family. */
/** 剧本历史注入预算（纯函数，可单测）。
 * M4.1 曾在此处叠加 Math.max(35, …) 硬地板保护连续性——副作用是 Console 里
 * 调小 contextEntryLimit 完全失效，小模型无法收缩上下文。现在尊重用户设置：
 * 条数默认 35（schema 默认），需要更小历史的部署（小模型）可显式调小，
 * 并配合把 contextTimeWindowMinutes 调小或设 0（时间窗会把近窗口内的全部
 * 条目并入，即使超过条数）。 */
export declare function resolveScriptContextBudget(runtime: Pick<RuntimeConfig, 'contextEntryLimit' | 'contextTimeWindowMinutes'>): {
    count: number;
    minutes: number;
};
/** 合约自动拼装的纯信号解析（可单测）。每条门控都是"配置 OR 窗口数据"：
 * 功能关闭后，窗口内的历史条目与待办意图仍会保留对应解释行，直到它们
 * 自然滚出上下文——模型永远不该看到无合约解释的 payload 字段。 */
/** 合约自动拼装的纯信号解析（可单测）。每条门控都是"配置 OR 窗口数据"：
 * 功能关闭后，窗口内的历史条目与待办意图仍会保留对应解释行，直到它们
 * 自然滚出上下文——模型永远不该看到无合约解释的 payload 字段。 */
export declare function resolveNarrativeContractFeatures(signals: {
    qzoneEnabled: boolean;
    pendingQzoneActionIntents: boolean;
    windowHasQzoneFeedEntries: boolean;
    groupTargetsPresent: boolean;
    anyGroupEnabled: boolean;
    windowHasGroupEntries: boolean;
    hasWechatEndpoint: boolean;
    browserActive: boolean;
    webContextPresent: boolean;
    semanticRecallEnabled: boolean;
    recallQueryActive: boolean;
    worldEventsEnabled: boolean;
    windowHasWorldEventEntries: boolean;
    windowHasAdminNotes: boolean;
    researchEnabled: boolean;
}): NarrativeContractFeatures;
export declare function signedNumber(value: number): string;
export declare function quotesBot(session: {
    quote?: {
        user?: {
            id?: unknown;
        };
    };
    selfId?: unknown;
}): boolean;
export declare function isTransientDatabaseError(error: unknown): boolean;
/** 模型偶发把 script 输出成对象（{tag,content} / {entries:[…]}，形态模仿
 * recentScript 的载荷结构）。散文完整，做无损归一而非弃稿：对象直取散文键、
 * entries 按序拼接、顶层数组同法。归一发生在 no-usable-script 闸门之前
 * （decide() 返回链），normalizeDecision 内再兜一道。 */
/** 模型偶发把 script 输出成对象（{tag,content} / {entries:[…]}，形态模仿
 * recentScript 的载荷结构）。散文完整，做无损归一而非弃稿：对象直取散文键、
 * entries 按序拼接、顶层数组同法。归一发生在 no-usable-script 闸门之前
 * （decide() 返回链），normalizeDecision 内再兜一道。 */
export declare function normalizeScriptField(raw: unknown): string;
export declare function hasRequiredNarrativeScript(value: NarrativeDecision | undefined | null): boolean;
export declare function resolveBlindModeConfig(value?: Partial<BlindModeConfig>): BlindModeConfig;
export declare function isAutomaticNarrativePhase(phase: NarrativeRequest['phase']): phase is "advance" | "conversation-follow-up";
export declare function normalizeFollowUpSummary(value: unknown): string;
export declare const MAX_FOLLOW_UP_DEFERRED_CHECKS = 5;
export declare function followUpDeferredChecks(intent: NarrativeIntent): number;
export declare function followUpDeadline(intent: NarrativeIntent): Date;
export declare function followUpExpiresAt(value: unknown, now: Date): Date;
export declare function normalizeFollowUpCommitment(value: unknown, now: Date): FollowUpCommitmentDraft | undefined;
export declare function inferredFollowUpCommitment(content: string, now: Date): FollowUpCommitmentDraft;
export declare function interactionPromisesFollowUp(content: unknown): boolean;
export declare function normalizeFollowUpResolutions(value: unknown): FollowUpResolutionDraft[];
export declare function automaticDeliveryFromPayload(value: unknown): OutgoingMessageDraft['automaticDelivery'] | undefined;
export declare function mergeDeliverySummary(left: string, right: string): string;
/** Scene compaction may update a tiny roster only with explicit observed
 * evidence. This keeps named supporting cast available without treating them
 * as automatically present. */
/** Scene compaction may update a tiny roster only with explicit observed
 * evidence. This keeps named supporting cast available without treating them
 * as automatically present. */
export declare function normalizeScenePresenceDrafts(value: unknown, entries: ScriptEntry[], now?: Date): ScenePresenceState[];
export declare function normalizeDecision(raw: NarrativeDecision, from: Date, now: Date, permitMessages: boolean, runtime: RuntimeConfig, shared: SharedStoryConfig, currentParticipantId: string, permittedParticipantIds: Set<string>, permittedGroupIds: Set<string>, phase?: NarrativeRequest['phase'], memory?: MemoryConfig, refreshContinuity?: boolean): {
    communicationActionRejections?: string[];
    droppedProactiveActions?: {
        participantId: string;
        mode: "immediate" | "delayed";
        content: string;
        reason: string;
    }[];
    script: string;
    authoredActions: import("./script/authored-actions").AuthoredAction[];
    lifeHandoff: import("./script/life-handoff").LifeHandoff;
    alter: number;
    agencyWindow: Partial<import("./types").AgencyWindowState>;
    proactiveContact: import("./types").ProactiveContactDraft & Record<string, unknown>;
    interaction: NarrativeInteraction;
    automaticDeliverySummary: string;
    followUpCommitment: FollowUpCommitmentDraft;
    followUpResolutions: FollowUpResolutionDraft[];
    continuity: import("./types").ContinuitySnapshot;
    memories: {
        participantId: string;
        category: string;
        content: string;
        importance?: number;
    }[];
    intents: IntentDraft[];
    intentUpdates: NormalizedIntentUpdate[];
    browserIntents: BrowserIntentDraft[];
    statePatch: Partial<ParticipantState>;
    crossConversationActions: NonNullable<{
        reason?: string;
        willingness?: number;
        endpointId?: string;
        participantId: string;
        mode: string;
        content: string;
    } | {
        reason?: string;
        willingness?: number;
        endpointId?: string;
        participantId: string;
        mode: string;
        content: string;
        sendAt: string;
    }>[];
};
export declare function normalizeBrowserIntentDraft(draft: BrowserIntentDraft, config: BrowserConfig): BrowserIntentDraft | undefined;
export declare function browserIntentFromPayload(payload: Record<string, unknown>): BrowserIntentDraft | null;
export declare function resolveBrowserTarget(draft: BrowserIntentDraft, config: BrowserConfig): string;
export declare function isSafePublicWebUrl(value: string, config: BrowserConfig): boolean;
export declare function webObservationEntryContent(observation: WebObservation): string;
export declare function normalizeInteraction(value: unknown, now: Date, runtime: RuntimeConfig): NarrativeInteraction | undefined;
type NormalizedIntentUpdate = {
    id: number;
    status: 'completed' | 'cancelled';
    resolution?: string;
};
export declare function normalizeIntentUpdates(value: unknown): NormalizedIntentUpdate[];
export declare function isActiveConsequence(intent: NarrativeIntent): boolean;
export declare function isActiveConsequenceDraft(intent: Pick<IntentDraft, 'type' | 'payload'> | Record<string, unknown>): boolean;
export declare function consequenceExpiresAt(payload: unknown): Date;
export declare function consequenceStrength(payload: unknown, fallback?: number): number;
export declare function hasCompactionEvidence(sourceEntryIds: number[] | undefined, entries: ScriptEntry[]): boolean;
/** 解析层被意愿门丢弃的合法主动行动的信息（供 withdrawn 账本补偿记录）。
 * 只捕获"目标在白名单、内容非空、仅因 willingness 缺失/低于阈值或 delayed
 * 时间越界被丢"的行动；目标不合法/内容为空的丢弃与历史行为一致保持静默
 * （没有可记账的收件人，也不该把未过白名单的内容写进历史）。 */
/** 解析层被意愿门丢弃的合法主动行动的信息（供 withdrawn 账本补偿记录）。
 * 只捕获"目标在白名单、内容非空、仅因 willingness 缺失/低于阈值或 delayed
 * 时间越界被丢"的行动；目标不合法/内容为空的丢弃与历史行为一致保持静默
 * （没有可记账的收件人，也不该把未过白名单的内容写进历史）。 */
export declare function droppedProactiveActionInfo(value: unknown, runtime: RuntimeConfig, permittedParticipantIds: Set<string>, currentParticipantId: string, now?: Date): {
    participantId: string;
    mode: "delayed";
    content: string;
    reason: string;
};
export declare function mergeSetting(base: StorySetting, patch: Partial<StorySetting>): StorySetting;
export declare function mergeParticipantState(base: ParticipantState, patch: Partial<ParticipantState>): ParticipantState;
export declare function normalizeParticipantState(value: unknown): ParticipantState;
export declare function participantRelevance(participant: InterludeParticipant): number;
/** Keeps a single due-turn private to one relationship while ensuring that
 * every plan that was already due at the start of the sweep gets a chance to
 * be judged before the next sweep interval. */
/** Keeps a single due-turn private to one relationship while ensuring that
 * every plan that was already due at the start of the sweep gets a chance to
 * be judged before the next sweep interval. */
export declare function groupDueIntents(intents: NarrativeIntent[]): NarrativeIntent[][];
export declare function resolveParticipantId(explicit: string | undefined, sourceEntryIds: number[] | undefined, entries: ScriptEntry[]): string;
export declare function runStorySerialized<T>(service: any, storyId: string, task: () => Promise<T>): any;
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function shouldSupersedeNarrativeRequest(inFlightRequestId: number | undefined, firstMessageCommittedRequestId: number | undefined, obsoleteRequestIds: ReadonlySet<number>): boolean;
export declare function toDate(value: unknown): Date;
/** Minato normally materializes timestamp columns as Date objects. Some
 * drivers and hot-reload paths can return ISO strings, so normalize every row
 * crossing the service boundary before time arithmetic or prompt building. */
/** Minato normally materializes timestamp columns as Date objects. Some
 * drivers and hot-reload paths can return ISO strings, so normalize every row
 * crossing the service boundary before time arithmetic or prompt building. */
export declare function normalizeDatabaseRow(table: string, value: unknown): any;
export declare function sameTimestamp(left: unknown, right: unknown): boolean;
export declare function narrativeCursor(story: InterludeStory, now: Date): Date;
export declare function clip(value: unknown, length: number): string;
export declare function clampNumber(value: unknown, fallback: number, min: number, max: number): number;
export declare function normalizeFact(value: string): string;
/**
 * Facts are narrated from their content, not from hidden participant metadata.
 * Keep this guard deliberately conservative: it only rejects relationship
 * facts whose subject is plainly absent or expressed only as a vague pronoun.
 * The narrator prompt remains responsible for producing a concrete named fact.
 */
/**
 * Facts are narrated from their content, not from hidden participant metadata.
 * Keep this guard deliberately conservative: it only rejects relationship
 * facts whose subject is plainly absent or expressed only as a vague pronoun.
 * The narrator prompt remains responsible for producing a concrete named fact.
 */
export declare function factContentLooksAmbiguous(scope: NarrativeFact['scope'], content: string): boolean;
export declare function limitEntriesByCharacters(entries: ScriptEntry[], limit: number): ScriptEntry[];
export declare function factScore(fact: NarrativeFact, config: MemoryConfig, queryEmbedding?: number[], query?: string): number;
/** 事实池的语义可用性统计（向量可观测性）：候选数、已存向量数、与查询
 * 向量正相关（会被语义加分）的事实数、最高余弦相似度。纯函数供 facts()
 * 组装 diagnostic 日志与测试直接断言。 */
export declare function semanticFactStats(facts: NarrativeFact[], queryEmbedding: number[]): {
    candidates: number;
    withVector: number;
    hits: number;
    topSimilarity: number;
};
/** Literal recall lane shared by raw script and durable facts. Chinese
 * bigrams preserve useful names and objects without requiring word splitting. */
/** Literal recall lane shared by raw script and durable facts. Chinese
 * bigrams preserve useful names and objects without requiring word splitting. */
export declare function historyLexicalScore(query: string, content: string): number;
export declare function cosineSimilarity(left: number[], right: number[]): number;
/** How many sticker descriptions a semantically filtered turn injects. */
/** How many sticker descriptions a semantically filtered turn injects. */
export declare const SEMANTIC_STICKER_LIMIT = 12;
/** Pure ranking used by the semantic sticker filter. Assets without a vector
 * still fill remaining slots after the embedded ones so a half-indexed library
 * degrades gracefully instead of hiding entries. */
/** Pure ranking used by the semantic sticker filter. Assets without a vector
 * still fill remaining slots after the embedded ones so a half-indexed library
 * degrades gracefully instead of hiding entries. */
export declare function rankStickerCatalog<T extends {
    embedding?: number[];
}>(assets: T[], queryEmbedding: number[], limit: number): T[];
/** Only static raster images worth the re-render enter Puppeteer downscaling:
 * tiny images would not shrink further and animated ones have their own path. */
/** Only static raster images worth the re-render enter Puppeteer downscaling:
 * tiny images would not shrink further and animated ones have their own path. */
export declare function shouldDownscaleImage(mimeType: string, dataUri: string): boolean;
export declare function createFactQuery(participant: InterludeParticipant | null, userMessage: string | undefined, dueIntents: NarrativeIntent[], supersededIntents: NarrativeIntent[]): string;
export declare function formatBufferedUserMessages(messages: BufferedUserMessage[]): string;
export declare function automaticIntervalMinutes(story: InterludeStory, now: Date, config: AutoAdvanceConfig): number;
export declare function normalizeFollowUpMinutes(values: number[] | undefined): number[];
export declare function scheduleConversationFollowUps(anchor: Date, config: AutoAdvanceConfig): Date[];
export declare function activeRestWindow(windows: RestWindow[], timezone: string, now: Date): RestWindow;
export declare function detectLiveScriptTimeOverflow(script: unknown, phase: NarrativeRequest['phase'], from: Date, now: Date, timezone: string, endorsedClocks?: ReadonlySet<number>): string;
export declare function chineseClockNumber(value: string): number;
export declare function mergeNote(existing: string | undefined, next: string): string;
export declare function patchClaimsMatch(left: string, right: string): boolean;
export declare function statePatchEvidence(entries: ScriptEntry[], timezone: string): {
    turns: number;
    days: number;
    scenes: number;
};
export declare function groupOverlayPatches(patches: StatePatchProposal[], windowDays?: number): {
    participantId: string;
    target: StatePatchProposal["target"];
    from: Date;
    to: Date;
    patches: StatePatchProposal[];
}[];
export declare function groupOverlaySnapshots(snapshots: OverlaySnapshot[], windowDays?: number): {
    participantId: string;
    target: OverlaySnapshot["target"];
    from: Date;
    to: Date;
    snapshots: OverlaySnapshot[];
}[];
export declare function normalizeMajorEvents(value: unknown, patches: StatePatchProposal[], snapshots?: OverlaySnapshot[]): string[];
export {};
