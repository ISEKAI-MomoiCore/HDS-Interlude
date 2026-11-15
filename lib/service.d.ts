import { Context, Service, Session } from 'koishi';
import { type WorldSeedDomain } from './world-seeder';
import { type QzoneActionCaller, type QzoneActionKind } from './qzone';
import { type EndpointRow, type EndpointState, type StoryAliasRecord, type EndpointChannelKind } from './endpoints';
import { HealthMonitor } from './health';
import { type TurnEngine, type TurnHandle, type TurnBufferedNarrativeTurn as BufferedNarrativeTurn } from './turn-engine';
import { UrgeConfig } from './urge';
import { ModelConfig, OpenAICompatibleNarrator, StickerDescriber, VisionDescriber } from './narrator';
import { ModelCaptureConfig } from './capture';
import { DailyQuotaTracker, StickerHarvestConfig, StickerHarvestStore } from './sticker-harvest';
import { ResearchConfig, ResearchDesk } from './research/desk';
import { type ConfigReadResult, type ConfigSaveResult } from './console/contract';
import { ModelRoutingTable } from './model-routing';
export { isBotOnlineStatus } from './session-platform';
export { extractSessionVoiceCount, extractSessionAudioSources, SessionFileFact, extractSessionFileFacts, describeGroupAttachments, withTransportTimeout, guessAudioFormat } from './session-platform';
export { calibratedNativeFaceWillingness, stableStickerAssetId, stickerDeliveryUrl, stickerFileUrl, extractUserReportedTimes, describeQuotedMessage, normalizeQuotedMessageContent, normalizeAllowedReactions, normalizeTimelinePlan, describeTimelinePlanRejection, timelineEntryPromptProjection, normalizeGroupChatActions, formatGroupSpeaker } from './chat-artifacts';
import { normalizeIntentUpdates } from './narrative-normalizers';
export { normalizeGroupVisibleReply, hoistParticipantlessInteraction, requiresVisibleReplyRecovery, visibleReplyMode, sanitizeAndClampVisibleContent, splitVisibleReplyBubbles, resolveScriptContextBudget, resolveNarrativeContractFeatures, normalizeScriptField, hasRequiredNarrativeScript, resolveBlindModeConfig, normalizeScenePresenceDrafts, normalizeDecision, normalizeInteraction, droppedProactiveActionInfo, groupDueIntents, shouldSupersedeNarrativeRequest, normalizeDatabaseRow, historyLexicalScore, SEMANTIC_STICKER_LIMIT, rankStickerCatalog, shouldDownscaleImage, detectLiveScriptTimeOverflow } from './narrative-normalizers';
import { type HistoryVectorEntry } from './history-recall';
export { isHistoryEntryVisibleToParticipant } from './history-recall';
import { ManageSessionDenial, manageSessionDenialReason, isEnabledAccount } from './session-platform';
export { ManageSessionDenial, manageSessionDenialReason, isEnabledAccount };
import type { GroupWillingnessConfig } from './group-willingness';
import { type AttentionWordState, type AttentionWord } from './narrative/attention-words';
import { type LongArcGuidanceRecord, type LongArcProgressRow } from './long-arc';
import { type PreparedCompaction, type PreparedCompactionRun } from './compaction/pipeline';
import { type GroupDeliveryResult } from './delivery/pipeline';
import { ForwardReadResult } from './forward-message';
import { type SchedulePreplanConfig } from './schedule-preplan';
import { ScriptDeliveryReference, ScriptDeliverySegmentStatus } from './script/delivery-ledger';
import { DeliveryPolicyConfig } from './script/delivery-policy';
import { CompactionDecision, IntentDraft, InterludeArc, InterludeScene, InterludeParticipant, InterludeStory, NarrativeDecision, NarrativeFact, NarrativeIntent, GroupMessageContext, NarrativeHistoricalImage, NarrativeInteraction, NarrativeProvider, NarrativeRequest, NarrativeCompactor, NarrativeEmbedder, OutgoingMessageDraft, ParticipantState, ScriptEntry, StatePatchDraft, StatePatchProposal, StorySetting, StoryState, BrowserIntentDraft, NarrativeAudio, NarrativeImage, OverlaySnapshot, WebObservation, AlterSystemConfig, ChatRhythmConfig, AgencyConfig, ChatActionCapabilities, ChatReactionName, FollowUpCommitmentDraft, FollowUpResolutionDraft, LocalMediaDraft, MessageReactionDraft, NativeFaceSemantic, StickerAsset, StickerCatalogEntry, EarlyNarrativeReply, QuotedMessageContext, SchedulePreplanRecord, SchedulePreplanReviewRequest, RecalledMoment, NarrativeEndpointOption } from './types';
import type { DesktopInboundEvent, DesktopRuntimePhase } from './desktop-bridge';
export type DesktopTimelineTrack = 'script' | 'messages' | 'system' | 'scenes' | 'facts' | 'preplan' | 'alter' | 'compaction';
export interface DesktopTimelineRangeRequest {
    from?: string;
    to?: string;
    tracks?: DesktopTimelineTrack[];
    /** Opaque oldest-entry cursor returned by the preceding response. */
    cursor?: string;
    detailLevel?: 'summary' | 'full';
    limit?: number;
}
/** Read-only endpoint health projection consumed by typ-0.  The desktop must
 * not read interlude_endpoint or interlude_endpoint_state directly. */
export interface DesktopEndpointHealth {
    endpointId: string;
    ownerKind: EndpointRow['ownerKind'];
    ownerId: string;
    platform: string;
    channelKind: EndpointRow['channelKind'];
    enabled: boolean;
    online: boolean;
    observedAt: string;
    deliverable: boolean;
    initiateAllowed: boolean;
    cooldownUntil?: string;
    lastError?: string;
    note?: string;
}
/** 分页游标改为 occurredAt+id 双键（与排序键一致）；旧 entry:<id> 继续兼容。 */
export interface TimelineCursor {
    occurredAt?: Date;
    id?: number;
}
export declare function parseTimelineCursor(cursor: string | undefined): TimelineCursor | undefined;
export declare function timelineEntryQueryAfter(base: Record<string, unknown>, cursor: TimelineCursor | undefined): Record<string, unknown>;
export declare function desktopTimelineEntryView(entry: ScriptEntry): {
    alterOffset?: string;
    alterValue?: number;
    audioCount?: number;
    imageCount?: number;
    sceneCheckpoint?: {
        boundarySourceEntryIds?: number[];
        lastEntryId?: number;
        firstEntryId?: number;
        reason?: string;
        endedAt?: string;
        sceneId: number;
        startedAt: string;
    };
    deliveryActions?: {
        eventId: string;
        eventKind: any;
        status: any;
        segments: any;
    }[];
    commitId?: string;
    entityId: string;
    id: number;
    storyId: string;
    participantId: string;
    kind: string;
    actor: string;
    track: DesktopTimelineTrack;
    content: string;
    occurredAt: string;
    startedAt: string;
    endedAt: string;
};
/** Entry kinds whose raw content is eligible for semantic history recall. */
/** A turn needs a live query vector only for a feature that can actually use
 * it. An inactive or small sticker library must not silently turn ordinary
 * fact embedding into a per-message network request. */
export declare function shouldRequestTurnEmbedding(embedding: ModelConfig['embedding'] | undefined, stickerLibraryEnabled: boolean, stickerCount: number): boolean;
export interface Config {
    /** Immersive operation that suppresses HDSI visibility and Koishi commands. */
    blindMode?: BlindModeConfig;
    /** @deprecated Renamed to blindMode; retained for existing Console YAML. */
    blackBox?: BlindModeConfig;
    model: ModelConfig;
    runtime: RuntimeConfig;
    storyDefaults: StoryDefaults;
    logging: LoggingConfig;
    memory?: MemoryConfig;
    sharedStory?: SharedStoryConfig;
    /** Optional, read-only browser observations powered by koishi-plugin-puppeteer. */
    browser?: BrowserConfig;
    /** 世界事件播种器：独立提供商配置块；未选模型即视为关闭。 */
    worldSeeder?: unknown;
    /** QQ 空间（说说）通道：SnowLuma qzone 扩展动作的限流与审计。 */
    qzone?: unknown;
    /** 预设同步：从 typ0-site 分享站拉取配置（码变更触发：首次填写/换码时同步一次）。 */
    presetSync?: {
        enabled: boolean;
        baseUrl: string;
        shareCode: string;
        sections: string[];
        applyToCurrentStory: boolean;
    };
    /** 顶层主提示词（Console 最底部）：非空时覆盖 model.mainPrompt。 */
    mainPrompt?: string;
    /** Optional OneBot/NapCat account gate. It only affects the onebot platform. */
    onebot?: OneBotNapCatConfig;
    /** Optional cross-platform chat gestures; runtime connector availability remains authoritative. */
    chatActions?: ChatActionsConfig;
    stickers?: StickerLibraryConfig;
    longHorizon?: unknown;
    alterSystem?: AlterSystemConfig;
    chatRhythm?: ChatRhythmConfig;
    /** Timeline director for automatic windows; off = automatic turns run without a ledger. */
    timelineDirector?: {
        enabled: boolean;
    };
    agency?: AgencyConfig;
    urge?: UrgeConfig;
    /** 统一投递策略（P2）：可选部署额度与 shadow 比较；总开关与渠道权限不在此层。 */
    deliveryPolicy?: unknown;
    schedulePreplan?: SchedulePreplanConfig;
    /** 实验性：主叙事微调数据采集（原始输入/输出 JSONL）；盲模式下强制关闭。 */
    modelCapture?: ModelCaptureConfig;
    /** 实验性：考据 Agent——资料案头为作者供应经核实的写作参考。 */
    research?: ResearchConfig;
}
export interface BlindModeConfig {
    enabled: boolean;
    /** Periodic, intentionally minimal health signal while all other HDSI logs stay hidden. */
    healthReportMinutes: number;
}
/** One row in the Console account tables. QQ ids are strings because QQ ids
 * can exceed JavaScript's safe integer range and Koishi exposes them as text. */
export interface OneBotAccountRule {
    qq: string;
    label: string;
    enabled: boolean;
    /** Optional identity fields for a whitelisted private-message user. */
    personId?: string;
    profile?: string;
    relationship?: string;
}
export interface OneBotNapCatConfig {
    /** When false (or omitted for old configurations), OneBot access is unchanged. */
    enabled: boolean;
    /** NapCat accounts that are allowed to send the character's messages. */
    botAccounts: OneBotAccountRule[];
    /** @deprecated Kept only so old YAML can still load; runtime is allowlist-only. */
    userMode?: 'allowlist' | 'blocklist';
    userAccounts: OneBotAccountRule[];
    /** Explicit OneBot group allowlist. Group members do not need DM whitelist access. */
    groupChats?: GroupChatRule[];
    /** F7：意愿档位一次性迁移标志——加载时归一历史 off+enabled 规则后置 true
     * 并持久化；此后用户显式选择的 off 稳定表达关闭（groupRule 不再运行时归一）。 */
    willingnessPresetMigrated?: boolean;
    /** Prevent an echoed self-message from entering the narrative. */
    ignoreSelfMessages: boolean;
}
export interface ChatActionsConfig {
    enabled: boolean;
    /** Console 配置面枚举保持封闭（仅列已知平台）；新平台的动作能力由适配器协商。 */
    platforms: Array<'qq' | 'wechat'>;
    quoteReply: boolean;
    messageReactions: boolean;
    allowedReactions: ChatReactionName[];
    nativeFaces: boolean;
    expressionThreshold: number;
    allowedNativeFaces: NativeFaceSemantic[];
}
export interface StickerLibraryConfig {
    enabled: boolean;
    directory: string;
    maxFileSizeMB: number;
    catalogLimit: number;
    descriptionMaxTokens?: number;
    /** API JSON mode is optional; prompt-only still asks for the compact JSON contract. */
    descriptionResponseFormat?: 'json-object' | 'prompt-only'; /** 表情包投递基址（空=自动：selfUrl → http://127.0.0.1:5140）。OneBot 实现与 Koishi 不共享文件系统时须经 HTTP 回源。 */
    deliveryBaseUrl?: string;
    /** 投递模式：auto=路由可用走 HTTP、否则退 file://；http/file=强制。 */
    deliveryMode?: 'auto' | 'http' | 'file';
    /** 实验性：表情包采集（偷表情包）——他人表情即时暂存、周期判定入库。 */
    harvest?: StickerHarvestConfig;
}
/** Embedding 已启用但路由不可用时的启动提示文案；未降级返回 undefined。
 * 纯函数供构造器与测试共用（向量可观测性：静默降级必须显性化）。 */
export declare function embeddingDegradationNotice(model: ModelConfig, routing: ModelRoutingTable): string | undefined;
export interface GroupChatRule {
    groupId: string;
    label: string;
    enabled: boolean;
    purpose: string;
    characterRole: string;
    /** Explicit Koishi channel assignee. Empty/omitted preserves native routing. */
    assignee?: string;
    /** 旧字段（等价于下方三维度的预设组合，显式维度逐维优先）：
     * mention-only → directed/mention/off；always → background/willingness/active。 */
    responseMode: 'mention-only' | 'always';
    /** I-6b 采集范围：off=不采集 / directed=仅定向消息（@、引用、语音、图片）/
     * background=背景采集（含普通消息入库）。未设置时由 responseMode 派生。 */
    collectionScope?: 'off' | 'directed' | 'background';
    /** I-6b 即时触发：mention=仅 @（音频按 audioAlwaysTriggers 模态策略）/
     * willingness=交意愿门与冷却。未设置时由 responseMode 派生。 */
    immediateTrigger?: 'mention' | 'willingness';
    /** I-6b 后台参与：off=不参与（不进推进背景，不作主动目标）/ background=仅
     * 背景材料 / active=可主动回应。未设置时由 responseMode 派生。 */
    backgroundParticipation?: 'off' | 'background' | 'active';
    contextLimit: number;
    debounceSeconds: number;
    cooldownSeconds: number;
    /** Number of recent historical group images attached to a later narrative turn. */
    historicalImageLimit?: number;
    /** 档位化的群聊意愿门：off/quiet/reserved/normal/active/eager/auto/custom。 */
    willingnessPreset?: string;
    /** auto 档三态（busy/asleep/idle）各自使用的档位。 */
    willingnessAuto?: {
        busy?: string;
        idle?: string;
        asleep?: string;
    };
    willingness?: Partial<GroupWillingnessConfig>;
    /** 群内出现语音/音频是否必定触发主叙事（跳过意愿与冷却；mention-only 也响应）。
     * 默认开启；关闭后语音与普通消息一样受响应模式、意愿与冷却控制。 */
    audioAlwaysTriggers?: boolean;
    /** 本群是否采集成员发送的表情包（需配合 stickers.harvest 总开关）。 */
    stickerHarvest?: boolean;
    /** §7.6.3 兼容选项：回复后跳过条数抖动（默认开启=现行为）。关闭后群门仅按
     * 评分/概率与会话相位调度，不再按条数观察。 */
    skipJitter?: boolean;
}
export interface MemoryConfig {
    enabled: boolean;
    backgroundIntervalMinutes: number;
    maxStoriesPerCompactionRun: number;
    sceneEntryThreshold: number;
    sceneCharacterThreshold: number;
    compactionEntryLimit: number;
    compactionCharacterLimit: number;
    sceneHookCharacters: number;
    sceneSummaryCharacters: number;
    arcSummaryCharacters: number;
    /** 弧摘要进 prompt 前的独立裁剪上限(存储仍保留全量);尾部最贴近当前剧情。 */
    arcPromptCharacters?: number;
    /** How many immediately-preceding closed scene summaries join the prompt. */
    previousSceneSummaries: number;
    recentEntryLimit: number;
    factLimit: number;
    factContentCharacters: number;
    factImportanceWeight: number;
    factConfidenceWeight: number;
    factRecencyWeight: number;
    semanticWeight: number;
    unresolvedWeight: number;
    statePatchConfidenceThreshold: number;
    majorStatePatchConfidenceThreshold: number;
    statePatchMinEvidence: number;
    /** Minimum independent narrative turns for a minor overlay change. */
    statePatchMinTurns?: number;
    /** major 提案自动应用所需的最少独立场景数;默认 2。 */
    statePatchMajorMinScenes?: number;
    /** Minimum distinct calendar days represented by minor-patch evidence. */
    statePatchMinDays?: number;
    /** Cooldown between stable overlay changes on the same target/path. */
    statePatchCooldownHours?: number;
    autoApplyStatePatches: boolean;
    allowMajorStateChanges: boolean;
    maxFactsPerStory: number;
    /** Keep short-lived dramatic aftereffects as context for later writing. */
    activeConsequencesEnabled: boolean;
    /** Maximum active consequences carried into one main-narrative prompt. */
    activeConsequencePromptLimit: number;
    /** Longest permitted lifetime of one consequence; protects canon from drift. */
    activeConsequenceMaxDays: number;
    /** Used when the narrator omits a precise strength for a valid consequence. */
    activeConsequenceDefaultStrength: number;
    overlayCompressionEnabled?: boolean;
    overlayRecentDays?: number;
    overlayMonthlyAfterDays?: number;
    overlayWeeklyWindowDays?: number;
    overlayMonthlyWindowDays?: number;
    overlayWeeklySummaryCharacters?: number;
    overlayMonthlySummaryCharacters?: number;
}
export interface RuntimeConfig {
    captureDirectMessages: boolean;
    autoCreate: boolean;
    ignoreCommandMessages: boolean;
    allowProactiveMessages: boolean;
    /** Minimum narrator-declared willingness for a background-initiated contact. */
    proactiveWillingnessThreshold?: number;
    sweepIntervalMinutes: number;
    minimumAdvanceMinutes: number;
    maxStoriesPerSweep: number;
    contextEntryLimit: number;
    /** Preserve raw entries from this recent time window in addition to the count floor. */
    contextTimeWindowMinutes?: number;
    /** auto 模式：按对话密度自适应条目预算（方案 A：生效值为硬上限）。 */
    contextEntryMode?: 'fixed' | 'auto';
    contextEntry?: {
        private?: unknown;
        group?: unknown;
    };
    memoryLimit: number;
    maxScriptCharacters: number;
    maxMessageCharacters: number;
    minimumDelayedReplySeconds: number;
    maximumDelayedReplyMinutes: number;
    cancelDelayedRepliesOnUserMessage: boolean;
    /** Retry a user turn after a transient narrative-provider failure. */
    narrativeRetryDelaySeconds?: number;
    /** Maximum automatic retries per failed user turn; 0 disables retry. */
    narrativeRetryMaxAttempts?: number;
    /** Split model reply.content into multiple QQ messages at the configured separator. */
    splitReplyMessages?: boolean;
    messageSeparator?: string;
    /** 小模型适配：可见回复未用分句标记而用换行时，把换行视作气泡边界。 */
    convertNewlineToSeparator?: boolean;
    typingBaseDelaySeconds?: number;
    typingCharactersPerSecond?: number;
    typingMaxDelaySeconds?: number;
    /** Random variation applied to simulated typing delays; 0 keeps deterministic timing. */
    typingJitterRatio?: number;
    /** Wait after the newest user message before starting a writing request. */
    userMessageDebounceSeconds?: number;
    forwardMessage?: {
        enabled?: boolean;
        maxNodes?: number;
        maxCharacters?: number;
        maxDepth?: number;
    };
    /** @deprecated Ignored since 0.1.2; requests remain replaceable until the first reply is committed. */
    staleNarrativeRequestWindowSeconds?: number;
    /** 新版自动推进调度；旧版 minimumAdvanceMinutes 仍保留兼容。 */
    autoAdvanceEnabled?: boolean;
    autoAdvanceIntervalMinutes?: number;
    autoAdvanceJitterMinutes?: number;
    /** Short life-writing passes after a conversation, in minutes. */
    conversationFollowUpMinutes?: number[];
    /** Small random offset applied to each short conversation follow-up. */
    conversationFollowUpJitterMinutes?: number;
    restWindows?: RestWindow[];
}
export interface BrowserConfig {
    enabled: boolean;
    /** Immediate browsing is opt-in because it intentionally adds one more model/browser round trip. */
    mode: 'deferred-only' | 'allow-immediate';
    allowSearch: boolean;
    allowVisit: boolean;
    searchUrlTemplate: string;
    allowedDomains: string[];
    blockedDomains: string[];
    maxConcurrentPages: number;
    /** Bound work per background sweep so a backlog cannot hold the story queue for minutes. */
    maxResearchPerSweep: number;
    navigationTimeout: number;
    waitUntil: 'domcontentloaded' | 'networkidle2';
    maxTextCharacters: number;
    maxExcerptCharacters: number;
    maxObservationsInPrompt: number;
    cacheMinutes: number;
    allowGroupTriggeredResearch: boolean;
    logObservationPreview: boolean;
}
/** Console presets that turn QQ accounts into named relationship branches. */
export interface ParticipantPreset {
    qq: string;
    personId: string;
    label: string;
    profile: string;
    relationship: string;
    enabled: boolean;
}
export interface SharedStoryConfig {
    /** One main story per bot account. Kept configurable for a safe rollback. */
    enabled?: boolean;
    /** Enroll an allowed account into an existing main story on its first DM. */
    autoEnrollParticipants: boolean;
    /** Allow one incoming message to cause an explicitly justified message to another account. */
    allowCrossConversationMessages: boolean;
    /** Send other participants' relationship/profile details to the model provider. */
    shareParticipantDetails: boolean;
    /** Hard cap for cross-account messages produced by one narrative turn. */
    maxCrossConversationActions: number;
    /** Number of other relationship summaries sent to the main narrator. */
    participantContextLimit: number;
    /** Empty keeps legacy behaviour; otherwise only these QQs may run global management commands. */
    managerAccounts: string[];
    /** Optional QQ-to-person presets; accounts with the same personId share identity notes. */
    /** @deprecated Use onebot.userAccounts identity fields in new configs. */
    participantPresets?: ParticipantPreset[];
}
export interface RestWindow {
    enabled: boolean;
    label: string;
    start: string;
    end: string;
    minIntervalMinutes: number;
    maxIntervalMinutes: number;
}
export interface AutoAdvanceConfig {
    enabled: boolean;
    intervalMinutes: number;
    jitterMinutes: number;
    followUpMinutes: number[];
    followUpJitterMinutes: number;
    restWindows: RestWindow[];
}
interface StoredGroupImageRef {
    source: string;
    ordinal: number;
    sourceType: 'url' | 'file';
    sourceEntryId: number;
    senderId: string;
    senderName: string;
    occurredAt: Date;
    messageId?: string;
}
interface GroupMessagesSnapshot {
    messages: GroupMessageContext[];
    imageRefs: StoredGroupImageRef[];
}
interface BufferedGroupTurn {
    storyId: string;
    groupId: string;
    rule: GroupChatRule;
    channelId: string;
    /** D4：群回合通道句柄（替代旧会话直存）。 */
    latestHandle?: TurnHandle;
    messages: (GroupMessageContext & {
        imageSources?: string[];
        imageSession?: Session;
        audioSources?: string[];
        audioSession?: Session;
        endpointId?: string;
    })[];
    timer?: () => void;
    debounceStartedAt?: number;
    revision: number;
    mentionedBot: boolean;
    quotedBot: boolean;
    activeBatchEndpointIds?: string[];
}
export interface ExecutableMessageReaction extends MessageReactionDraft {
    messageId: string;
}
export interface ExecutableGroupChatActions {
    replyTo?: {
        messageRef: string;
        messageId: string;
    };
    reactions: ExecutableMessageReaction[];
}
export interface StoryDefaults {
    characterName: string;
    characterProfile: string;
    perspective: string;
    perspectives?: string[];
    supplementaryFacts?: string[];
    userProfile: string;
    relationship: string;
    world: string;
    supportingCast: string;
    location: string;
    style: string;
    timezone: string;
}
export interface LoggingConfig {
    level: 'silent' | 'error' | 'warn' | 'info' | 'debug';
    /** Controls how much normal operational activity is written at info level. */
    verbosity?: 'summary' | 'standard' | 'diagnostic';
    format: 'compact' | 'detailed' | 'layered';
    /** Apply semantic ANSI colors; Koishi Console and normal terminals render them. */
    colors?: boolean;
    /** Select a high-contrast ANSI palette for dark or light Console themes. */
    colorTheme?: 'dark' | 'light';
    /** Show fixed action kaomoji; false uses compact symbols instead. */
    kaomoji?: boolean;
    logScriptPreview: boolean;
    /** Emit user-visible incoming/outgoing message bodies to the plugin log. */
    logMessageContent?: boolean;
    previewLength: number;
}
export interface StoryStartReadiness {
    ready: boolean;
    existing?: InterludeStory;
    blockers: string[];
    warnings: string[];
    preview: {
        characterName: string;
        characterProfile: boolean;
        perspective: boolean;
        world: boolean;
        timezone: string;
        model: string;
        autoCreate: boolean;
    };
}
export declare class InterludeService extends Service {
    config: Config;
    static inject: string[];
    private narrator;
    private compactor;
    private worldSeeder;
    private worldSeederRuntime;
    private weatherConfig;
    private weatherTimer;
    private qzoneRuntime;
    private embedder;
    stickerDescriber: StickerDescriber;
    visionDescriber: VisionDescriber;
    private stickerCatalog;
    /** Whole-table semantic recall cache, one map per story: entry id → vector +
     * minimal content. Loaded lazily on first recall and extended incrementally
     * by the background backfill; never persisted. */
    private historyVectors;
    /** 桥接幂等（轻量修复）：桌面 30s 超时后入 inbox 重放时，同一消息会再次到达。
     * 用内存 Map 按 platform:messageId 去重——进程生命周期内有效，重启后由
     * script_entry.metadata.messageId 的磁盘记录兜底（重放场景不会跨重启）。 */
    private seenIncomingMessages;
    episodeIndexes: Map<string, {
        source: Map<number, HistoryVectorEntry>;
        size: number;
        byEntry: Map<number, number[]>;
        ordered: Array<[number, HistoryVectorEntry]>;
    }>;
    historyVectorsReady: Set<string>;
    historyVectorLoads: Map<string, Promise<void>>;
    historyBackfills: Set<string>;
    historyBackoff: Map<string, number>;
    automaticRecallCache: Map<string, {
        source: Map<number, HistoryVectorEntry>;
        size: number;
        key: string;
        until: number;
        result: RecalledMoment[];
    }>;
    /** Per-story retry-after timestamps for failed Schedule Preplan generations. */
    schedulePreplanBackoff: Map<string, number>;
    /** Per-story retry-after timestamps for a failed automatic timeline window. */
    private timelineBackoff;
    /** Consecutive timeline-director failures per story; drives exponential backoff and the fuse. */
    private timelineDirectorFailures;
    stickerById: Map<string, StickerAsset>;
    stickerScanRunning: boolean;
    /**
     * 同一故事的用户消息、到期意图和后台压缩必须串行。否则“用户新消息
     * 取消旧延迟回复”可能与定时发送同时发生，造成过期消息仍被发出。
     */
    private queues;
    turnEngine: TurnEngine;
    private scheduler;
    /** 端点注册表内存缓存（M1a）：行来自 interlude_endpoint；状态为进程内三维时效。 */
    private endpointRows;
    private endpointStates;
    endpointStateWriteQueue: Promise<unknown>;
    private endpointRegistryReady;
    /** M1b 剧本别名缓存（interlude_story_alias），随注册表一同加载。 */
    storyAliasRows: StoryAliasRecord[];
    /** M2 §1.3：入站接收序号（进程内单调递增；双端点回合排序依据）。 */
    inboundSeq: number;
    private storyAliasProblems;
    bufferedGroupTurns: Map<string, BufferedGroupTurn>;
    /** Short-lived group-member display names. QQ number remains the stable key. */
    groupMemberNameCache: Map<string, {
        name: string;
        expiresAt: number;
    }>;
    groupMemberNameLookups: Map<string, Promise<string>>;
    /** Ephemeral, per-group willingness score. It never touches private turns or durable story state. */
    private groupWillingness;
    /** Synchronously marks a relationship whose current typing chain was interrupted by new input. */
    private interruptedTypingParticipants;
    /** Prevent a background life turn from racing an unlocked live model call. */
    factBackfills: Set<string>;
    /** Coalesce low-frequency atmosphere analysis without delaying the visible reply. */
    private scheduledAlterAnalyses;
    /** sql.js/SQLite has one writable connection; serialize writes globally. */
    private databaseWriteQueue;
    private transactionScope;
    private transactionRunning;
    /** The browser is bounded separately from narrative work so a burst of
     * deferred intents cannot spawn an uncontrolled number of Chromium pages. */
    private browserActive;
    private browserWaiters;
    /** Use Koishi's context-bound logger so Console/runtime targets receive records. */
    private readonly serviceLogger;
    private backgroundStarted;
    private databaseResetting;
    /** Invalidates model work that was prepared against a story before purge,
     * pause, or a runtime reset. The token is in-memory and intentionally does
     * not become part of the story schema. */
    private runtimeGeneration;
    private runtimePauseGeneration;
    private storyTaskGenerations;
    private sweepRunning;
    compactionSweepRunning: boolean;
    /** Startup/sweep compensation for durable pending script deliveries. The
     * backoff is process-local; the delivery ledger remains the source of truth
     * across restarts. */
    private pendingDeliveryRecoveryRunning;
    /** Same authored event has one executor through transport AND confirmation. */
    deliveryExecutors: Set<string>;
    /** Known platform successes survive a local confirmation failure in this process. */
    private acceptedDeliveries;
    private pendingDeliveryRecoveryBackoff;
    private blindModeHealthIssue;
    /** Console reload creates a new service instance, so normalized config can
     * be cached safely for the lifetime of this instance. */
    private cachedAudioConfig?;
    private cachedStickerConfig?;
    private cachedHarvestConfig?;
    /** 表情包采集运行时（锁外旁路；重载重建、计数归零）。 */
    harvestStore?: StickerHarvestStore;
    readonly harvestQuota: DailyQuotaTracker;
    harvestJudge?: OpenAICompatibleNarrator;
    harvestLibraryHashes?: Set<string>;
    harvestScanRunning: boolean;
    /** 判定失败计数（跨扫描周期累计，≥3 按丢弃处理，防毒图无限重试）。 */
    readonly harvestAttempts: Map<string, number>;
    /** 考据 Agent 运行时：每故事一张案头（内存工作台，重载清空）。 */
    readonly researchDesks: Map<string, ResearchDesk>;
    /** 对话密度轨迹（auto 条目预算的信号源；重载归零，30 分钟窗口）。
     * 惰性初始化——原型宿主（测试）没有类字段。 */
    private contextDensityTracker?;
    private get contextDensity();
    private cachedContextEntryConfig?;
    researchNarrator?: OpenAICompatibleNarrator;
    private researchToolsRegistry?;
    private cachedResearchConfig?;
    private cachedAlterSystemConfig?;
    private cachedAgencyConfig?;
    private cachedDeliveryPolicyConfig?;
    private cachedSchedulePreplanConfig?;
    private cachedBlindModeConfig?;
    private cachedModelCaptureConfig?;
    /** P3: Console 健康面板的内存滚动指标（重载后归零）。 */
    readonly health: HealthMonitor;
    /** Token 用量到达时可能尚未有 canonical story——用最近活跃的 storyId 记账。
     * P3 Fix: constructor 末尾初始化为当前 canonical story，减少首轮漏记。 */
    private lastActiveStoryId?;
    private get canonicalStoryIdForHealth();
    /** P2 Fix: 主动联系计数——发送动作入列后待平台确认的数量。 */
    private pendingProactiveCount;
    private cachedAutoAdvanceConfig?;
    private cachedSharedStoryConfig?;
    private cachedMemoryConfig?;
    private cachedBrowserConfig?;
    private readonly modelRouting;
    /** Migration diagnostics are emitted once per story without changing Canon. */
    private reportedStateMigrations;
    /** typ-0 uses this optional gate only inside a dedicated worker process. */
    private desktopRuntimePhase;
    private desktopEventSink?;
    /** typ0 桌面桥安装标记：离线补拉仅独立 Koishi 部署有意义（桌面有宿主收件箱兜底）。 */
    private desktopBridgeActive;
    /**
     * typ-0 后台投递出口：delayed/split/advance 路径没有实时 Session，普通 Koishi
     * 里由 findBotForParticipant 走 adapter；typ-0 worker 中 bot 不存在，所有后台
     * 消息只能经宿主渠道投递。bridge 安装时注册，普通 Koishi 永远为空。
     */
    desktopDeliveryHandler?: (delivery: {
        participantId: string;
        selfId: string;
        platform: string;
        channelId: string;
        kind: 'private' | 'group';
        content: string;
        quoteMessageId?: string;
        /** Optional desktop correlation metadata; background propagation is added in a later phase. */
        traceId?: string;
        processingId?: string;
        /** M3：模型显式选择的目标端点（B1-1 桥接透传；缺省按 selfId 路由）。 */
        endpointId?: string;
        /** 业务幂等键（scriptEvent.eventId + bubbleIndex），重试间稳定。
         * 宿主 outbox 据此跨 deliveryId 去重——迟到回执场景下 worker 30s 后用新
         * deliveryId 重发时，同一业务消息不会被再次发给用户。 */
        intentKey?: string;
    }) => Promise<{
        ok: boolean;
        messageIds?: string[];
        error?: string; /** true = 请求已写出但结果不可知（宿主 echo 超时/桥关闭），按 pending 补偿而非终态失败。 */
        transportTimeout?: boolean;
    }>;
    /** W3（C2-1）：桥接动作代理出口——desktop-bridge 安装后非空；普通 Koishi 恒空。
     * qzoneCaller 与 sendSticker 桌面模式经此调用宿主代调上游 OneBot 动作。 */
    desktopOnebotActionHandler?: (input: {
        accountKey: string;
        action: string;
        params?: Record<string, unknown>;
        timeoutMs?: number;
    }) => Promise<{
        ok: boolean;
        data?: unknown;
        errorCode?: string;
        ambiguous?: boolean;
        error?: string;
    }>;
    constructor(ctx: Context, config: Config);
    /** Apply explicit Console routing choices before normal group middleware runs.
     * Do not prepend receiveGroup: that would bypass Koishi's ignore/user gates. */
    private syncGroupAssignees;
    private startBackgroundTasks;
    /** Recover only the durable outgoing-message ledger. The narrative intent is
     * deliberately not consulted here: an intent may already be completed while
     * its transport action is still pending, and replaying the intent would run a
     * second model turn. DeliveryActions are the outbox truth. */
    private recoverPendingDeliveries;
    private pendingOutgoingDeliveryCandidates;
    private pendingDeliveryRecoveryKey;
    private deferPendingDeliveryRecovery;
    private recoverPendingDeliveryCandidate;
    setNarrator(provider: NarrativeProvider): void;
    getNarrator(): NarrativeProvider;
    setCompactor(provider: NarrativeCompactor): void;
    /** Allows a custom/local vector service without replacing the main narrator. */
    setEmbedder(provider: NarrativeEmbedder): void;
    /** Optional typ-0 bridge hook. No sink is installed in normal Koishi use. */
    setDesktopEventSink(sink?: (event: string, payload: unknown) => void): void;
    /** Puppeteer 缺失提示进程内只打一次。 */
    puppeteerHintLogged: boolean;
    /** HMR 重载/停机守卫：stop() 置位后，失败源于插件卸载而非提供商故障，
     * 不再排持久化的叙事重试（重试意图存活于数据库，会在新实例上投递一条
     * 过期回复），也不再以 warn/error 刷屏。 */
    private disposed;
    /** 确定性失败的图片源负缓存：key = 原始 source 串，value = 首次失败原因。
     * 覆盖两类永不自愈的失败：① QQ CDN 链接过期（HTTP 400 / retcode
     * -5503007）；② 结构性不可用——非白名单域（如实测出现的 koishi.js.org
     * 资源链接）、非法 source、超限 data-URI、超限字节数、非图片 MIME。
     * 命中即跳过网络与重复告警；FIFO 有界。瞬时性失败（空响应、超时、
     * 网络错误、会话缺失导致的 file 引用不可解析）不入缓存。 */
    deadImageSources: Map<string, string>;
    /** typ-0 bridge 在安装时注册后台投递通道；卸载时传 undefined 复原。 */
    setDesktopDeliveryHandler(handler?: InterludeService['desktopDeliveryHandler']): void;
    setDesktopOnebotActionHandler(handler?: InterludeService['desktopOnebotActionHandler']): void;
    getDesktopRuntimePhase(): DesktopRuntimePhase;
    setDesktopRuntimePhase(phase: DesktopRuntimePhase): Promise<void>;
    /** Snapshot is intentionally small; detailed timeline uses desktopTimelineSnapshot below. */
    desktopRuntimeSnapshot(): Promise<{
        phase: DesktopRuntimePhase;
        stories: {
            id: string;
            status: import("./types").StoryStatus;
            cursorAt: string;
            updatedAt: string;
        }[];
    }>;
    /**
     * Endpoint health is deliberately projected by the worker.  This keeps the
     * desktop read-only and, more importantly, makes all availability decisions
     * use the same channel-aware TTL/cooldown rules as delivery itself.
     */
    desktopEndpointHealthSnapshot(): Promise<{
        protocol: number;
        generatedAt: string;
        endpoints: DesktopEndpointHealth[];
    }>;
    /** Read-only desktop projection. The host never opens or mutates HDSI tables directly. */
    desktopTimelineSnapshot(): Promise<{
        storyId: string;
        entries: ScriptEntry[];
        scenes: InterludeScene[];
        facts: NarrativeFact[];
        cursorAt?: undefined;
        updatedAt?: undefined;
        timezone?: undefined;
        preplan?: undefined;
    } | {
        storyId: any;
        cursorAt: any;
        updatedAt: any;
        timezone: any;
        entries: {
            id: number;
            storyId: string;
            participantId: string;
            kind: string;
            actor: string;
            content: string;
            occurredAt: string;
            metadata: Record<string, unknown>;
        }[];
        scenes: {
            id: number;
            status: import("./types").SceneStatus;
            startedAt: string;
            endedAt: string;
            hook: string;
            summary: string;
            entryCount: number;
        }[];
        facts: {
            id: number;
            scope: "character" | "world" | "relationship" | "event" | "promise";
            content: string;
            importance: number;
            confidence: number;
            unresolved: boolean;
            updatedAt: string;
        }[];
        preplan: {
            revision: number;
            timezone: string;
            validFrom: string;
            validThrough: string;
            materializedDays: import("./types").SchedulePreplanDay[];
        };
    }>;
    /**
     * typ-0 选区删除的受控入口：QQ 指令路径有人工确认间隔，bridge 路径没有，
     * 因此 purge 必须在 worker 内的 serial 队列中执行，保证与写作回合互斥。
     * purgeStoryRange 本身是软删（redacted/deleted/superseded）并处理
     * sourceEntryIds 级联；Canon 与参与者身份保持不动。
     */
    desktopPurgeRange(from: Date, to: Date): Promise<{
        storyId: any;
    }>;
    /**
     * Versioned, bounded read model for typ-0 Arrangement.  It deliberately
     * exposes HDSI's stored temporal facts only: callers cannot create timeline
     * objects, and legacy entries without an explicit automatic window remain
     * point events instead of receiving a guessed duration from their prose.
     */
    desktopTimelineRange(request?: DesktopTimelineRangeRequest): Promise<{
        protocol: number;
        storyId: string;
        revision: string;
        range: {
            from: string;
            to: string;
        };
        entries: ScriptEntry[];
        scenes: InterludeScene[];
        facts: NarrativeFact[];
    } | {
        protocol: number;
        storyId: any;
        revision: string;
        range: {
            from: string;
            to: string;
        };
        cursorAt: any;
        updatedAt: any;
        timezone: any;
        entries: {
            alterOffset?: string;
            alterValue?: number;
            audioCount?: number;
            imageCount?: number;
            sceneCheckpoint?: {
                boundarySourceEntryIds?: number[];
                lastEntryId?: number;
                firstEntryId?: number;
                reason?: string;
                endedAt?: string;
                sceneId: number;
                startedAt: string;
            };
            deliveryActions?: {
                eventId: string;
                eventKind: any;
                status: any;
                segments: any;
            }[];
            commitId?: string;
            entityId: string;
            id: number;
            storyId: string;
            participantId: string;
            kind: string;
            actor: string;
            track: DesktopTimelineTrack;
            content: string;
            occurredAt: string;
            startedAt: string;
            endedAt: string;
        }[];
        scenes: {
            id: number;
            status: import("./types").SceneStatus;
            startedAt: string;
            endedAt: string;
            hook: string;
            summary: string;
            entryCount: number;
        }[];
        facts: {
            id: number;
            scope: "character" | "world" | "relationship" | "event" | "promise";
            content: string;
            importance: number;
            confidence: number;
            unresolved: boolean;
            updatedAt: string;
        }[];
        preplan: {
            revision: any;
            timezone: any;
            validFrom: any;
            validThrough: any;
            materializedDays: any;
        };
        alter: {
            value: number;
            alterWeight: number;
            emotionalOffset: {
                direction: "serious" | "relaxed";
                intensity: number;
                description: string;
            };
            lastUpdatedAt: string;
            history: {
                value: number;
                alter: number;
                at: string;
            }[];
        };
        compaction: {
            activeSceneId: number;
            sceneHook: string;
            entryCount: number;
            lastCompactionAt: string;
            isDirty: boolean;
        };
        nextCursor: string;
    }>;
    /** Project alterSystem state for the desktop alter track. */
    private projectAlterForDesktop;
    /** Project compaction status for the desktop compaction track. */
    private projectCompactionForDesktop;
    /** Accept an already-normalized typ-0 event without introducing a second narrative path. */
    /** 批次 4：桌面设置叙事游标（分支截断后回拨到 forkPoint）。串行队列内执行。 */
    setDesktopCursorAt(cursorAt: Date): Promise<void>;
    receiveDesktopEvent(event: DesktopInboundEvent, session: Session): Promise<boolean>;
    /**
     * Returns whether this session is allowed to use HDSI. Koishi's OneBot
     * adapter uses `selfId` for the logged-in bot QQ and `userId` for the sender
     * QQ. Other adapters deliberately keep their old behaviour.
     */
    canHandleSession(session: Session): boolean;
    /** Group access uses an explicit group allowlist; group members do not need
     * to be present in the private-message user whitelist. */
    canHandleGroupSession(session: Session): boolean;
    groupRule(groupId: string): {
        collectionScope: import("./group-dimensions").GroupCollectionScope;
        immediateTrigger: import("./group-dimensions").GroupImmediateTrigger;
        backgroundParticipation: import("./group-dimensions").GroupBackgroundParticipation;
        groupId: string;
        label: string;
        enabled: boolean;
        purpose: string;
        characterRole: string;
        /** Explicit Koishi channel assignee. Empty/omitted preserves native routing. */
        assignee?: string;
        /** 旧字段（等价于下方三维度的预设组合，显式维度逐维优先）：
         * mention-only → directed/mention/off；always → background/willingness/active。 */
        responseMode: "mention-only" | "always";
        contextLimit: number;
        debounceSeconds: number;
        cooldownSeconds: number;
        /** Number of recent historical group images attached to a later narrative turn. */
        historicalImageLimit?: number;
        /** 档位化的群聊意愿门：off/quiet/reserved/normal/active/eager/auto/custom。 */
        willingnessPreset?: string;
        /** auto 档三态（busy/asleep/idle）各自使用的档位。 */
        willingnessAuto?: {
            busy?: string;
            idle?: string;
            asleep?: string;
        };
        willingness?: Partial<GroupWillingnessConfig>;
        /** 群内出现语音/音频是否必定触发主叙事（跳过意愿与冷却；mention-only 也响应）。
         * 默认开启；关闭后语音与普通消息一样受响应模式、意愿与冷却控制。 */
        audioAlwaysTriggers?: boolean;
        /** 本群是否采集成员发送的表情包（需配合 stickers.harvest 总开关）。 */
        stickerHarvest?: boolean;
        /** §7.6.3 兼容选项：回复后跳过条数抖动（默认开启=现行为）。关闭后群门仅按
         * 评分/概率与会话相位调度，不再按条数观察。 */
        skipJitter?: boolean;
    };
    /** Same account gate for direct-message work that already has a participant. */
    canHandleParticipant(participant: InterludeParticipant): boolean;
    canManageSession(session: Session): boolean;
    /** 管理命令被拒的具体原因（两层：OneBot 互动白名单 / managerAccounts）。
     * 拒绝时记 standard 级 warn——此前区分线索藏在 diagnostic debug 里，新部署
     * 排障完全看不见。 */
    manageSessionDenial(session: Session): ManageSessionDenial | undefined;
    /** Background life updates only require the bot account to remain enabled. */
    canHandleStory(story: InterludeStory): boolean;
    findStory(session: Session): Promise<any>;
    /** Paused stories stay invisible to scheduling but reachable by management
     * commands. No archiving here: this lookup never resolves conflicts. */
    private getPausedStory;
    /**
     * Resolve and enforce the one global active story. The preferred id wins
     * when present; otherwise the most recently updated row is retained and
     * every other active row is archived immediately.
     */
    private getCanonicalStory;
    findParticipant(session: Session, story?: InterludeStory): Promise<any>;
    participants(storyId: string, includePaused?: boolean): Promise<any[]>;
    createStory(session: Session, name?: string): Promise<any>;
    /** Read-only preflight for manually starting a runtime story from Console defaults. */
    storyStartReadiness(session: Session): Promise<StoryStartReadiness>;
    /**
     * Enrolls a QQ account as a relationship branch and synchronizes its Console
     * identity fields. Callers that already resolved the participant can pass it
     * in to avoid a second database read.
     */
    ensureParticipant(story: InterludeStory, session: Session, now?: Date, knownExisting?: InterludeParticipant): Promise<any>;
    updateSetting(story: InterludeStory, patch: Partial<StorySetting>): Promise<{
        setting: StorySetting;
        updatedAt: Date;
        id: string;
        platform: string;
        selfId: string;
        userId: string;
        channelId: string;
        status: import("./types").StoryStatus;
        state: StoryState;
        cursorAt: Date;
        createdAt: Date;
    }>;
    setStatus(story: InterludeStory, status: InterludeStory['status']): Promise<{
        status: import("./types").StoryStatus;
        updatedAt: Date;
        id: string;
        platform: string;
        selfId: string;
        userId: string;
        channelId: string;
        setting: StorySetting;
        state: StoryState;
        cursorAt: Date;
        createdAt: Date;
    }>;
    recentEntries(storyId: string, limit?: number): Promise<any[]>;
    /** Live narration keeps both a count floor and a recent wall-clock window.
     * A burst of conversation can therefore exceed the nominal turn count
     * without immediately erasing everything said earlier in the same hour. */
    /** 四类原始聊天行——advance 相位在查询阶段即排除（F6：生活席位上游独立
     * 选取；此前的"先限量查询后过滤"会让群刷屏把 script 挤出候选集）。 */
    private static readonly CHAT_ENTRY_KINDS;
    private recentEntriesForPrompt;
    memories(storyId: string, limit?: number, participantId?: string): Promise<any[]>;
    /** Administrative view: global durable facts, including legacy rows with a participantId. */
    adminFacts(storyId: string, limit?: number): Promise<any[]>;
    adminPendingIntents(storyId: string, limit?: number): Promise<any[]>;
    adminStatePatches(storyId: string, limit?: number): Promise<any[]>;
    /** Adds an audit-visible system note without pretending it came from the model. */
    addAdminScriptNote(story: InterludeStory, content: string): Promise<boolean>;
    /** Adds a high-confidence fact for corrections that must survive compaction. */
    addAdminFact(story: InterludeStory, scope: NarrativeFact['scope'], content: string): Promise<boolean>;
    /** Reversible deletion: facts are retained as superseded rows for audit. */
    forgetAdminFact(storyId: string, id: number): Promise<boolean>;
    cancelAdminIntent(storyId: string, id: number): Promise<boolean>;
    rejectAdminStatePatch(storyId: string, id: number): Promise<boolean>;
    /** 手动批准一条 proposed 提案:管理员判断优先于证据阈值/autoApply 政策
     * (否则关闭自动应用后提案没有任何出口)。批准后立即重建 overlay——
     * 统一语义下 overlay=未压缩 applied 补丁的合并,效果即时可见。 */
    applyAdminStatePatch(story: InterludeStory, id: number): Promise<boolean>;
    /** Clear only the evolving setting overlay; keep Canon, script and memories. */
    clearSettingOverlay(story: InterludeStory, target: 'character' | 'perspective' | 'relationship' | 'world' | 'all'): Promise<{
        participantCount: number;
    }>;
    /** Start a clean host-owned timeline without deleting the historical archive.
     * This is intended once after upgrading from prose-authoritative releases
     * whose active scene or scratchpad may already contain future contamination. */
    rebaseTimeline(story: InterludeStory): Promise<{
        at: Date;
        sceneReset: boolean;
    }>;
    private clearSettingOverlayUnlocked;
    /**
     * Destructive administrative operation. The caller must validate the
     * confirmation phrase. A full purge also rebuilds Canon from the current
     * Console configuration, so an old profile cannot survive in later prompts.
     */
    purgeAllStoryData(storyId: string): Promise<void>;
    private purgeAllStoryDataUnlocked;
    /** Reset all platforms, retaining exactly one empty global canonical story. */
    purgeAllData(preferredStoryId?: string): Promise<any>;
    /** Delete one adapter/platform's records without touching other platforms. */
    purgePlatformData(platform: string): Promise<number>;
    /**
     * Clear only HDSI-owned tables. Koishi's users/channels and other plugins
     * are intentionally untouched; deleting the physical SQLite file from a
     * command would be unsafe while the driver is open.
     */
    clearDatabase(): Promise<{
        removed: number;
        logicallyCleared: number;
    }>;
    /** Remove script and derived memory records whose timestamps overlap a range. */
    purgeStoryRange(storyId: string, from: Date, to: Date): Promise<void>;
    private purgeStoryRangeUnlocked;
    /** Entry point for configured OneBot group chats. Group members do not need
     * private-message authorization; the group allowlist controls access. */
    receiveGroup(session: Session, receivedAt?: Date): Promise<boolean>;
    receive(session: Session, receivedAt?: Date): Promise<boolean>;
    groupSenderName(groupId: string, userId: string, session: Session): Promise<any>;
    lookupGroupMemberName(cacheKey: string, groupId: string, userId: string, selfId: string): Promise<string>;
    bufferGroupMessage(story: InterludeStory, rule: GroupChatRule, session: Session, message: GroupMessageContext, mentionedBot: boolean, quotedBot: boolean, audioSources?: string[], imageSources?: string[], endpointId?: string): void;
    private flushGroupTurn;
    /** D3b：群聊执行体已迁出至 narrative/turn-executor.ts（行为不变）；同名薄委托。 */
    private flushGroupTurnUnlocked;
    /** D3b：群执行体迁出后经宿主调用。 */
    groupMessages(storyId: string, groupId: string, limit: number): Promise<GroupMessagesSnapshot>;
    /** D3b：群执行体迁出后经宿主调用。 */
    loadHistoricalGroupImages(story: InterludeStory, refs: StoredGroupImageRef[], limit: number, session?: Session, currentSources?: string[]): Promise<NarrativeHistoricalImage[]>;
    groupCooldownActive(storyId: string, groupId: string, cooldownSeconds: number): Promise<boolean>;
    groupChatCapabilities(session: Session | undefined, messages: GroupMessageContext[]): ChatActionCapabilities | undefined;
    privateChatCapabilities(session: Session | undefined): ChatActionCapabilities | undefined;
    executeGroupReactions(story: InterludeStory, session: Session, groupId: string, reactions: ExecutableMessageReaction[], referenceFor?: (reaction: ExecutableMessageReaction) => ScriptDeliveryReference | undefined): Promise<number>;
    resolveSticker(draft: LocalMediaDraft | undefined, catalog: StickerCatalogEntry[]): any;
    get expressionThreshold(): number;
    resolveNativeFace(decision: NarrativeDecision, capabilities: ChatActionCapabilities | undefined): NativeFaceSemantic | undefined;
    sendSticker(story: InterludeStory, session: Session, channelId: string, asset: StickerAsset, groupId?: string, reference?: ScriptDeliveryReference): Promise<boolean>;
    sendNativeFace(story: InterludeStory, session: Session, channelId: string, semantic: NativeFaceSemantic, groupId?: string, reference?: ScriptDeliveryReference): Promise<boolean>;
    sendGroupMessage(story: InterludeStory, channelId: string, content: string, replyToMessageId?: string, session?: Session, endpointId?: string, correlation?: Pick<OutgoingMessageDraft, 'traceId' | 'processingId'>, control?: {
        shouldCancel: () => boolean;
        settled: Map<number, GroupDeliveryResult['segmentOutcomes'][number]['status']>;
        onDelivered: (index: number, content: string) => void;
    }): Promise<{
        deliveredSegments: string[];
        complete: boolean;
        segmentOutcomes: any;
    }>;
    /**
     * Persisted messages wait here briefly before they reach the narrator. This
     * makes “你好 / 在吗 / 我有件事想问” one event without risking message loss.
     */
    bufferUserNarrative(story: InterludeStory, participant: InterludeParticipant, session: Session, now: Date, supersededIntents: NarrativeIntent[], content?: string, imageSources?: string[], audioSources?: string[], quote?: QuotedMessageContext, endpointId?: string): void;
    /** D2（解耦设计 §6）：平台端口——私聊回合执行体的全部平台调用经此发出。
     * 真实实例构造器赋值；原型测试宿主经 getter 惰性创建（包装不搬移：
     * 适配器委托本类既有方法，函数本体与锁相位零改动）。 */
    private platform?;
    private get platformPort();
    signalIncomingInterruption(story: InterludeStory, participant: InterludeParticipant): void;
    /** Experimental streaming path: only a complete, validated private reply
     * may leave early. It commits the existing interruption boundary at the
     * same moment as ordinary first-message delivery. */
    /** D2：经 PlatformAdapter 调用（适配器解析句柄后转发至此）；可见性
     * 因此自 private 放宽——函数本体不动。 */
    deliverEarlyPrivateReply(story: InterludeStory, participant: InterludeParticipant, session: Session | undefined, turn: BufferedNarrativeTurn, requestId: number, reply: EarlyNarrativeReply, requestStartedAt?: Date): Promise<false | ScriptEntry>;
    /** Normalized native-audio understanding config (Console model.audio). */
    private get audioConfig();
    private get stickerConfig();
    /** One user event folds typed text, images and voice into a single fact:
     * attachments ride their own native channels, the stored content keeps a
     * place-holder fact so history and the desktop timeline stay readable. */
    describeUserEvent(story: InterludeStory, session: Session, forward?: ForwardReadResult): {
        content: any;
        sources: any;
        audioSources: string[];
        quote: QuotedMessageContext;
    };
    readForward(session: Session): Promise<ForwardReadResult | undefined>;
    /** 表情包采集入站口：门控（总开关+聊天类型+每群规则）→ 配额 → 下载 →
     * 三重去重（丢弃记忆/暂存/表情库哈希）→ 暂存。任何失败静默跳过。 */
    tryHarvestStickers(session: Session, chatType: 'private' | 'group', sources: string[], rule?: GroupChatRule): Promise<void>;
    /** 表情库哈希索引（懒加载缓存；判定入库后失效重建）。 */
    harvestLibraryHashIndex(): Promise<Set<string>>;
    /** 周期判定：表情包识别连接看图裁决暂存表情；保留的移入表情库 keptSubfolder
     * 子目录，由既有 scanStickerLibrary（5 分钟轮询）自动编目与描述。 */
    runStickerHarvestScan(): Promise<void>;
    /** 判定失败累计；≥3 次按丢弃处理，防止无法判定的图片每轮重试浪费调用。 */
    noteHarvestFailure(hash: string, detail: string): void;
    /** interlude.stickerharvest.status 的只读输出。 */
    stickerHarvestStatusLines(): Promise<string[]>;
    scanStickerLibrary(): Promise<void>;
    /** 表情包投递基址：显式配置 > Koishi selfUrl > 本机默认端口。 */
    stickerDeliveryBase(): string;
    /** 表情包 HTTP 回源路由：OneBot 实现（NapCat/Lagrange）分容器时经此下载文件。
     * 仅服务素材库内、资产表登记过的文件；assetId 即查询键，无目录穿越面。 */
    registerStickerRoute(): void;
    stickerRouteRegistered: boolean;
    refreshStickerCatalog(): Promise<void>;
    semanticStickerEmbeddingEnabled(): boolean;
    /** Vectorize described-but-unindexed sticker assets in the background. The
     * batch stays small so one scan cannot spend more than a handful of calls. */
    backfillStickerEmbeddings(): Promise<void>;
    stickerCatalogForSession(session: Session | undefined, turnQueryEmbedding?: number[]): Promise<StickerCatalogEntry[]>;
    /** Semantically narrow the sticker catalog to the entries most relevant to the
     * live message. Falls back to the full catalog whenever the feature is off,
     * the turn has no query vector, or the catalog is below the limit. */
    rankStickerAssets(turnQueryEmbedding?: number[]): Promise<StickerAsset[]>;
    private semanticTurnEmbeddingEnabled;
    /** Compact summaries of the scenes immediately before the active one. They
     * bridge the raw context window and the arc, where last-turn details used to
     * disappear from the prompt entirely. */
    /** 弧摘要进 prompt 前的独立裁剪:存储侧保留全量(arcSummaryCharacters,默认 12k),
     * prompt 侧默认只带尾部(arcPromptCharacters,默认 6k)——弧层与 previousScenes/
     * 长线投影叠加时,12k 全量每回合在场会挤压 recentScript 预算,尾部最贴近当前。 */
    private trimArcForPrompt;
    private previousSceneSummaries;
    /** Drop expired scratchpad entries and cap the list; details only ever carry
     * small in-flight facts, so silence is the correct treatment for expiry. */
    private pruneWorkingDetails;
    /** Multi-lane recall over the whole immutable script. Embeddings improve the
     * ranking but are never a prerequisite: literal wording and fact provenance
     * keep cross-day memory available while vector backfill is incomplete. */
    recallHistory(storyId: string, participantId: string, query: string, turnQueryEmbedding: number[], excludeIds: Set<number>, preferredEntryIds?: Set<number>, maxResults?: number): Promise<RecalledMoment[]>;
    /** Load every recallable entry of one story into the recall cache. The load is
     * deliberately whole-table (no time window): older memories stay retrievable,
     * and the per-process cache makes the cost one-off per story. */
    ensureHistoryVectors(storyId: string): Promise<any>;
    /** Drop in-memory copies whenever their source rows are removed or redacted.
     * The next recall reloads only the surviving database rows. */
    invalidateHistoryVectors(storyId?: string): void;
    /** Background vectorization for semantic history recall. Newest entries go
     * first so live-recall quality ramps up quickly; the whole table is covered
     * gradually over successive maintenance passes. */
    backfillHistoryEmbeddings(storyId: string): Promise<void>;
    /** Download voice records as native audio attachments. QQ voice is SILK,
     * which multimodal models cannot read, so SnowLuma's get_record action is
     * always asked to transcode server-side (out_format) and return base64.
     * Mirrors the native-image acquisition path; nothing is persisted. */
    loadNativeAudio(story: InterludeStory, sources: string[], session?: Session, maxCount?: number): Promise<NarrativeAudio[]>;
    fetchNativeAudio(source: string, session?: Session): Promise<{
        format: string;
        base64: string;
    } | undefined>;
    describeVisionEvent(session: Session): {
        content: string;
        sources: string[];
    };
    loadNativeImages(story: InterludeStory, sources: string[], session?: Session): Promise<NarrativeImage[]>;
    /** Sidecar vision mirrors native image acquisition, but sends only its
     * factual result into the text narrator's current event. */
    describeCurrentImages(story: InterludeStory, images: NarrativeImage[], userMessage: string | undefined): Promise<any>;
    isExpiredImageSource(source: string): any;
    /** 已判死来源的首次失败原因（未判死返回 undefined）。 */
    deadImageSourceReason(source: string): any;
    rememberDeadImageSource(source: string, reason: string): void;
    fetchNativeImage(source: string, bot?: any, adapterProvided?: boolean): Promise<{
        mimeType: string;
        dataUri: string;
    } | undefined>;
    /** QQ CDN 媒体 URL 会 302 跳转（SnowLuma stream-download 同款结论），
     * 原先的 redirect:'error' 把每一跳都变成非过期错误：不入负缓存、每轮
     * 重复失败。改为手动逐跳跟随（至多 3 跳），每跳按入口同一规则校验
     * 目标域，保住 SSRF 边界；跳向不受信域视为确定性失败判死。 */
    fetchImageThroughRedirects(url: URL, adapterProvided: boolean): Promise<{
        data: ArrayBuffer;
        headers: {
            get(name: string): string | null;
        };
    }>;
    fetchNativeImageUncached(source: string, bot?: any, adapterProvided?: boolean): Promise<{
        mimeType: string;
        dataUri: string;
    } | undefined>;
    /** Convert adapter/fetched bytes into one bounded native-vision attachment.
     * Animated stickers are rendered to a representative PNG frame when the
     * optional Puppeteer service is available; otherwise the original image is
     * still passed through rather than inventing a description. */
    imageBytesToNative(bytes: Buffer, mimeType: string): Promise<{
        mimeType: string;
        dataUri: string;
    } | undefined>;
    /** Re-render a static image through Puppeteer capped at the configured vision
     * dimension. Multimodal providers tile large images into many tokens, so a
     * bounded re-encode saves both upload time and per-turn token cost; the
     * browser also applies EXIF orientation, fixing rotated phone photos. */
    downscaleImageForVision(image: {
        mimeType: string;
        dataUri: string;
    }): Promise<{
        mimeType: string;
        dataUri: string;
    } | undefined>;
    renderAnimatedImageFrame(dataUri: string): Promise<any>;
    /** Prevent timers or already-returning model calls from resurrecting data
     * after an administrator resets the story or clears HDSI tables. */
    private invalidateBufferedNarratives;
    private invalidateStoryTasks;
    rememberIncomingMessage(key: string): void;
    private deliveryGeneration;
    private taskGeneration;
    private taskGenerationCurrent;
    /** True while a live or debounced conversation should take priority over background work. */
    private hasPendingNarrative;
    /** D3a：执行体已迁出至 narrative/turn-executor.ts（行为不变）；保留
     * 同名薄委托，既有调用点与全部测试零改动。 */
    private flushBufferedNarrative;
    advanceStory(story: InterludeStory, force?: boolean): Promise<OutgoingMessageDraft[]>;
    /** Used by commands/tests to deliver a mixed set of account-targeted actions safely. */
    deliverMessages(story: InterludeStory, messages: OutgoingMessageDraft[], session?: Session): Promise<OutgoingMessageDraft[]>;
    compactStory(story: InterludeStory, force?: boolean): Promise<any>;
    /** Merge and compress already-applied overlay patches without running the
     * full scene/fact compaction pass. This is safe for manual maintenance. */
    compactOverlay(story: InterludeStory): Promise<any>;
    /** Administrative overlay view used by the Console command. */
    adminOverlayStatus(storyId: string): Promise<{
        state: any;
        proposed: StatePatchProposal[];
        applied: StatePatchProposal[];
        cleared: StatePatchProposal[];
        snapshots: OverlaySnapshot[];
        participantOverlays: any[];
    }>;
    /**
     * 群消息离线补拉：插件停用期间到达的已启用群消息经 get_group_msg_history
     * 补回，写为一条汇总事件（不注入逐条事件打扰上下文——YesImBot World
     * offlineHistory 同款语义）。仅在 Koishi 原生部署有意义：typ0 桌面模式
     * 的收件箱已由宿主兜底，此处跳过。
     */
    offlineGroupCatchup(): Promise<void>;
    sweep(): Promise<void>;
    /** I-2 待叙事显著度（内存态，重载即清——与 groupWillingness 同生命周期）：
     * storyId → groupId → 状态。纯函数模块见 narrative/narrative-salience.ts。
     * 惰性初始化以兼容原型测试宿主（issue #5 桩防御惯例）。 */
    private groupNarrativeSalience?;
    private salienceStore;
    /** 门拦截批次累积显著度（executor 调用；批键去重、上限封顶在纯函数内）。 */
    recordNarrativeSalience(storyId: string, groupId: string, input: {
        turnRelated: boolean;
        batchKey?: string;
    }): void;
    /** I-3 共享注意力：私聊近期是否有活跃对话（她在跟人认真说话）——
     * 只读查询最近 5 分钟内的 user-message 条目；尽力而为。 */
    privateAttentionBusy(storyId: string, now?: Date): Promise<boolean>;
    /** I-4 事实性时间线索：群批次的事实性时间背景（供群执行体注入 userMessage
     * 头部）。两个事实——群安静时长与她上次发言距今——均来自已确认记录。 */
    groupFactualTimeCues(storyId: string, groupId: string, now: Date, batch: Array<{
        occurredAt?: Date;
    }>): Promise<string>;
    /** I-4 自适应防抖：缓存各群最近的会话活跃判定（bufferGroupMessage 是同步
     * 路径，不能查库；由 executor 在 flush 时刷新——F5 接线后仅在判定为 true
     * 时写入，查询失败不毒化）。会话态缩短合并窗口（她正盯着群），冷态放长
     * （反正不在看，多攒几条成一个事件更自然）。F5：值带写入时刻，读取按
     * groupSessionActive 同源的 30 分钟窗口过期——群安静后陈旧 true 不再长期
     * 影响防抖。 */
    private groupSessionActiveCache?;
    private sessionActiveCache;
    noteGroupSessionActive(storyId: string, groupId: string, active: boolean): void;
    groupSessionActiveCached(storyId: string, groupId: string): boolean;
    /** I-7 观察性产出：读取故事的生活关注词状态（无则冷启动种子——现成结构，
     * 零模型调用；不写库，首个压缩评估后接管）。 */
    attentionWordState(story: InterludeStory): AttentionWordState;
    /** I-7 状态命令的命中读取。 */
    attentionHitsFor(storyId: string): Array<{
        groupId: string;
        terms: string[];
        at: number;
    }>;
    /** I-7 观察性命中：群批次与生效词的匹配记录（内存环形，最近 20 条）。
     * 不接门控/显著度——回放确认质量后另行接入。 */
    private attentionHitLog?;
    recordAttentionHits(storyId: string, groupId: string, terms: AttentionWord[], now?: number): void;
    /** 瞥视调度：显著度过阈 → 计算瞥视时刻；仅当早于现有 nextAdvanceAt 且满足
     * 未来下界时写入（幂等：一旦写过更早时间，后续更晚的瞥视不再覆盖）。
     * 只提前不推后——rest/Preplan 等既有安排若本就更早则不动。 */
    maybeScheduleSalienceGlance(storyId: string): Promise<void>;
    /** F4：瞥视的约束下界——复用既有调度仲裁按当前约束重排一次能得出的最早
     * 推进时刻（区间采样取下限），显著度提前不得越过它。尽力而为：计算失败
     * 退回瞥视最小延迟。 */
    private salienceGlanceFloor;
    /** advance 成功后的覆盖消费（内容覆盖完全 / 概况覆盖×0.5）——由
     * commitGroupBackgroundCoverage 传入本轮呈现的群与覆盖类型。 */
    private consumeNarrativeSalienceOnAdvance;
    /** 群触发回合成功：该群完全消费（executor 调用）。 */
    consumeNarrativeSalienceForGroup(storyId: string, groupId: string): void;
    /** 群触发回合成功：推进该群水位（通道共享覆盖）——取该群此刻最大
     * group-message 条目 id（她刚以当前事件身份处理过这批消息）。 */
    /** 群触发回合成功提交后推进水位。F3 修正：frozenMaxEntryId 是本回合冻结
     * 输入的最大条目 id（批次/群上下文 messageRef 解析）——查询此刻最新后
     * clamp 到该上界，模型在途期间到达的新消息不再被误标覆盖；无可解析 id
     * 时保守跳过推进（显著度消费由调用方独立处理）。审计修正：读改写整份
     * story.state 必须在故事串行锁内（此前 fire-and-forget 在锁外，与持锁的
     * advance/瞥视写入存在丢失更新竞态）。 */
    advanceGroupBackgroundWatermarkForTurn(storyId: string, groupId: string, now: Date, frozenMaxEntryId?: number): Promise<void>;
    /** I-1 会话迟滞：她最近一条（确认送达的）群发消息是否在窗口内——近期
     * 参与态让跳过抖动让位于会话延续（窗口 30 分钟起步，回放验证后调整；
     * 查询失败/无记录 = 非会话态）。送达确认的最小近似：character-group-message
     * 条目存在于该群即视为她曾发言（条目在成功提交后写入）；分段全失败时
     * 条目仍会带 partialDelivery 标注——精确回执过滤留待回放验证后收窄。 */
    groupSessionActive(storyId: string, groupId: string, now?: Date): Promise<boolean>;
    /** II-1 交往节奏印象（仅私聊）：从该参与者最近私聊条目采样"她确认的开场
     * → 对方承接"的节奏，渲染为一句话事实。character-message 行仅在投递成功
     * 后落库，存在即已确认送达；证据不足（样本 < 3）返回 undefined 不注入。
     * 尽力而为：查询失败静默降级为无印象。 */
    private interactionRhythmFor;
    /** II-4 最小观测：查询并采样某参与者的交往节奏（结构化结果；印象与状态命令共用）。 */
    private sampleInteractionRhythmFor;
    /** II-4 最小观测：每位活跃参与者的节奏采样状态行（interlude.rhythm.status）。 */
    interactionRhythmStatusLines(story: InterludeStory): Promise<string[]>;
    /** Issue #20：模型调用一条龙自检——按任务路由逐提供商发送最小探测请求
     * （主叙事/压缩/播种走 customSideTask 的 JSON 探针，嵌入走一次 embedText），
     * 报告路由解析、逐提供商成功（耗时）或失败（错误 + 模型原文头）。只读探测
     * 但消耗少量 token，命令侧由管理员门控。 */
    modelProbeLines(): Promise<string[]>;
    /** I-6a：装配 advance 相位的群消息背景（always 群；每群查最近 64 条中未
     * 覆盖的部分 → 概况 + 每群 K 条原文 + 全局合计上限）。尽力而为：任何失败
     * 由调用方 catch 静默，不阻塞推进。 */
    private groupBackgroundForAdvance;
    /** I-6a：成功提交后推进内容覆盖水位（只前进；概况不清空全部——未获原文
     * 呈现的批次保留内容级催动资格，I-2 接入时消费）。 */
    private commitGroupBackgroundCoverage;
    private advanceUnlocked;
    private decide;
    /** Refresh continuity only on the first automatic pass or every fifteenth
     * successful narrative write. Ordinary turns reuse the last snapshot. */
    private shouldRefreshContinuity;
    /** The optional director supplies a relative-time ledger. Its failures cool
     * down independently while the main author may continue without that ledger. */
    private planAutomaticTimeline;
    /** 熔断判定：连续失败达到阈值即熔断；熔断有 2h 冷却，到期自动重试一次完整路径。 */
    private isTimelineDirectorFused;
    /** Persist director health independently from the narrative cursor. */
    private persistTimelineRetry;
    private tryDecide;
    private persistDecision;
    /** Keep the active-scene anchor in sync with the host ledger immediately,
     * rather than waiting for prose compaction to reconcile an already-completed
     * automatic window. */
    private persistTimelineSceneAnchor;
    adminSchedulePreplan(storyId: string): Promise<SchedulePreplanRecord>;
    requestSchedulePreplanRebuild(storyId: string): Promise<boolean>;
    private get alterSystemConfig();
    private get agencyConfig();
    /** P2 统一投递策略（shadow）：显式配置优先；全默认值视为未显式配置，
     * 按旧链实际生效限制保守派生（§12.2 的 schema 展开歧义以此口径处理）。 */
    get deliveryPolicyConfig(): DeliveryPolicyConfig;
    private get schedulePreplanConfig();
    private get blindModeConfig();
    private get modelCaptureConfig();
    private get harvestConfig();
    private get contextEntryConfig();
    /** 生效条目预算：scope/相位/密度 → auto 硬上限或 fixed 锚点。 */
    private effectiveContextBudget;
    private get researchConfig();
    private get researchActive();
    /** 到期考据意图收集：锁内入队，advanceStory 在串行队列外执行。
     * 惰性初始化——原型宿主（测试）没有类字段。 */
    private researchDueIntents?;
    /** P3' Jev 门控计数（status 可见；重载归零）。 */
    readonly researchJevCounters: {
        calls: number;
        triggered: number;
    };
    /** 近期剧本尾部（门控上下文）。 */
    researchScriptTail(storyId: string, limit?: number): Promise<string>;
    /** P3' 被动推进门控：主叙事调用前先问 Jev（Noul 概率）。TRUE → 内联跑
     * 考据（先查后写，本轮带着核实事实写作）；FALSE/不可用/超时/低置信 →
     * 直通。任何异常静默放行——考据永不阻塞对话。 */
    jevGatePassiveResearch(story: InterludeStory, userMessage: string | undefined, now: Date): Promise<void>;
    researchDeskFor(storyId: string): ResearchDesk;
    researchProvider(): any;
    /** 采集只在表情库同时启用时生效：保留文件需要既有编目管线消化。 */
    private get stickerHarvestActive();
    private emotionalOffsetForPrompt;
    private updateAlterSystem;
    private scheduleAlterAnalysis;
    private analyzeAlterSystem;
    private appendEntry;
    private appendMemory;
    /**
     * Retrieves the smallest useful slice of durable facts. When an embedding
     * model is available, semantic relevance is combined with narrative quality
     * signals instead of replacing them; a failed vector lookup simply has a
     * semantic score of zero for this turn.
     */
    private contactThreads;
    /** Durable facts are global narrative evidence. The legacy participantId argument
     * is retained for call-site compatibility but intentionally ignored. */
    facts(storyId: string, limit?: number, query?: string, _participantId?: string, turnQueryEmbedding?: number[]): Promise<NarrativeFact[]>;
    /** Returns only observations that are safe for this narration branch. A
     * participant's browsing is not shown to another private participant unless
     * the owner has explicitly enabled shared relationship details. */
    private webObservations;
    activeScene(storyId: string): Promise<InterludeScene | null>;
    activeArc(storyId: string): Promise<InterludeArc | null>;
    appendIntent(storyId: string, intent: IntentDraft, now: Date, participantId?: string): Promise<void>;
    /** Active consequences share the intent table but are never scheduler work.
     * Their payload keeps the lifecycle explicit so old scheduled intents keep
     * their existing behaviour without a migration. */
    private activeConsequencesAndExpire;
    /** Only active consequences visible to the writer may be resolved. This
     * prevents a remote model from changing arbitrary future plans by id. */
    applyIntentUpdates(storyId: string, updates: ReturnType<typeof normalizeIntentUpdates>, now: Date, participantId?: string): Promise<boolean>;
    /** Stores a narrator-proposed browser action as a future intent. The model
     * never writes page content directly; a separate Puppeteer task creates the
     * observation later. */
    appendBrowserIntent(storyId: string, draft: BrowserIntentDraft, now: Date, fallbackParticipantId?: string): Promise<void>;
    /** 到期考据意图执行（advanceStory 串行队列外调用）：预算门→改写→检索→
     * 蒸馏→案头；结果只进案头（author-facing），意图完成后由作者在后续轮次
     * 裁决她怎么汇报。失败按完成处理——"她没查到"是合法剧情。 */
    executeResearchIntent(story: InterludeStory, intent: NarrativeIntent, now: Date): Promise<void>;
    /** interlude.research.status 的只读输出。 */
    researchStatusLines(): string[];
    /** Console 概览快照（hdsi-overview DataService 的数据源）。全部为既有只读
     * 状态的聚合；条目数使用数据库聚合，故事不存在时返回占位形状。 */
    /** P4（§14.1）：当前行动条件的只读摘要——来自场景证据缓存（agencyWindow），
     * 过期/缺失以未知表达，不再有"全可用"伪事实。 */
    private sceneConditionSummary;
    consoleOverview(): Promise<import('./console/index').HdsiOverview>;
    /** 配置中心持久化管线入口（console/config-center.ts 调用）：整树更新
     * 插件配置。ctx.scope 在 Service 上是 protected，经此公开；框架随后
     * 完成热更新与 loader 写回 koishi.yml（设计 §6.1）。 */
    updatePluginConfig(next: Config, reload?: boolean): void;
    /** Console 配置读取（hdsi/config/read 的数据源）。无活跃故事时 story 节
     * 返回空值而不是错误——页面据空值提示先启动故事。 */
    consoleReadConfig(section: string): Promise<ConfigReadResult>;
    /** Console 配置写入（hdsi/config/save 的落地实现）。配置中心上线后
     * 本方法只处理 story 节（经 updateSetting 落库，跨重启持久）；
     * runtime/research 节在 rpc 层改走 applyConfigSectionPatch 持久化
     * 管线（scope.update → koishi.yml），不再进程内改写。 */
    consoleSaveConfig(section: string, values: Record<string, unknown>): Promise<ConfigSaveResult>;
    /** Executes a due browser intent once, records its bounded observation, and
     * marks the future plan complete regardless of success. A failed browser is
     * still an event (the character could not access the page), but it never
     * blocks later dialogue or background life updates. */
    executeDeferredBrowserIntent(story: InterludeStory, intent: NarrativeIntent, now: Date): Promise<WebObservation>;
    /** Read a page through Koishi Puppeteer. This is intentionally read-only:
     * it rejects non-public destinations, extracts visible text only, and closes
     * the page after every observation. */
    private collectWebObservation;
    private saveWebObservation;
    /** Immediate browser reads are intentionally held in memory until the
     * final narrator result survives the stale-request check. This prevents an
     * obsolete two-second message burst from leaving a durable web event behind. */
    private persistCollectedWebObservation;
    /** Issue #14：网页观察是旁路增强信息——单条落库失败只降级为 warn 并继续
     * 其余观察，绝不否决本轮已生成、可能已计费的回复投递。抽成独立方法以便
     * 直接回归（dbCreate 注入抛错 → 不上抛、逐条继续、留下可定位日志）。 */
    /** D3a：经 narrative/turn-executor 以宿主身份调用，可见性放宽。 */
    persistImmediateObservations(story: InterludeStory, participantId: string, observations: WebObservation[], phase: NarrativeRequest['phase']): Promise<void>;
    private findCachedWebObservation;
    private withBrowserSlot;
    /** Persist a bounded retry so a transient provider failure cannot strand a user turn. */
    /** 用户回合成功后的清理：遗留的 narrative-retry 已无意义——其入站消息早已
     * 被本轮覆盖或消化，保留只会到期再跑一轮完整回合（userInitiated 允许投递）
     * 并给用户送去一条重复回复。 */
    /** D3a：经 narrative/turn-executor 以宿主身份调用，可见性放宽。 */
    cancelPendingNarrativeRetries(story: InterludeStory, participantId: string, now: Date): Promise<void>;
    private scheduleNarrativeRetry;
    dueIntents(storyId: string, now: Date): Promise<any>;
    upcomingNarrativeIntents(storyId: string, now: Date): Promise<NarrativeIntent[]>;
    /** Wake the scheduler close to a short typing delay instead of waiting for
     * the normal background sweep. The due intent remains the source of truth. */
    scheduleDueIntentWake(storyId: string, notBefore: Date): void;
    /** 到期唤醒的执行体：分段消息直投；sweep 繁忙或前台回合未结束时返回 'busy'，由 scheduler 短候重排。 */
    wakeDueIntents(storyId: string): Promise<'busy' | void>;
    reconcileTerminalSplitIntent(storyId: string, intent: NarrativeIntent, now: Date): Promise<boolean>;
    pendingSplitSegments(storyId: string): Promise<NarrativeIntent[]>;
    /** Called in the story queue, after transport work and before any narration. */
    deferDueIntentsBehindPendingSplits(story: InterludeStory, due: NarrativeIntent[], splits: NarrativeIntent[], now: Date): Promise<NarrativeIntent[]>;
    /** 参与到期唤醒补排的意图族 = 创建时即注册 scheduleDueIntentWake 的类型。
     *  排除项及理由：
     *  - active-consequence：常驻 intent 表但“永远不是调度工作”，且 notBefore
     *    可能在过去——进入补排会造成“立即触发→无事可做→再补排”的死循环；
     *  - 模型自主规划意图（decision.intents，含 follow-up-commitment）：分钟级
     *    以上尺度，按设计契约走 sweep 网格（见 appendIntent 调用点注释）。 */
    /** 为最早的未到期唤醒意图补排计时器（keep-earliest 仲裁，重复调用安全）。
     *  只看严格未来的 notBefore——已到期的行属于 wakeDueIntents/sweep 的消费范围，
     *  补排指过去只会空转。 */
    scheduleNextPendingWake(storyId: string): Promise<void>;
    /** Deliver already-decided <sep/> segments without invoking the narrator. */
    deliverDueSplitSegments(storyId: string): Promise<void>;
    /** Pending spoken promises are intentionally tiny and relationship-local. */
    pendingFollowUpCommitments(storyId: string, participantId: string, now?: Date): Promise<NarrativeIntent[]>;
    /** Expiration retires a scheduler task, not a fictional fulfilled promise. */
    retireExpiredFollowUps(storyId: string, intents: NarrativeIntent[], now: Date): Promise<Set<number>>;
    appendFollowUpCommitment(story: InterludeStory, participantId: string, draft: FollowUpCommitmentDraft, fallbackSourceEntryId: number | undefined, now: Date, originDeliveryEventId?: string): Promise<void>;
    applyFollowUpResolutions(storyId: string, participantId: string, resolutions: FollowUpResolutionDraft[], interaction: NarrativeInteraction | undefined, now: Date, deliveryEventId?: string): Promise<Set<number>>;
    deferUnresolvedDueFollowUps(storyId: string, participantId: string, contextIntents: NarrativeIntent[], resolvedIds: Set<number>, _interaction: NarrativeInteraction | undefined, now: Date): Promise<void>;
    /** schedule_preplan 的主键就是 storyId，Minato 拒绝含主键的 update——
     * 混在改写循环里必抛，导致后续 participantId 回填被跳过（隐私脱敏失效）。
     * 改为读旧行→建新行→删旧行（每故事仅一行，无并发窗口问题）。 */
    private migrateSchedulePreplanRecord;
    cancelPendingOutgoingMessages(storyId: string, participantId: string, now: Date, cancelPlanned?: boolean): Promise<any[]>;
    private sendScheduledMessages;
    /**
     * Immediate replies may reuse the incoming Session; cross-account and timed
     * messages are delivered through the target participant's channel instead.
     * This is the boundary that prevents a shared story from accidentally
     * sending every reply back to the account that happened to trigger the turn.
     */
    /** When Agency approves a proactive contact but the model omitted the
     * crossConversationAction field, synthesize one from the script's say
     * actions. The model wrote what she sends in the script; the host only
     * fills the transport envelope. Never invents words not in the script. */
    private synthesizeCrossActionFromScript;
    sendCrossGroupMessage(story: InterludeStory, message: OutgoingMessageDraft, session?: Session, failureStatus?: 'failed' | 'pending', shouldCancel?: () => boolean): Promise<GroupDeliveryResult>;
    deliveryExecutionKey(storyId: string, message: OutgoingMessageDraft, segment?: boolean): string;
    successfulDeliveryEntry(storyId: string, message: OutgoingMessageDraft): Promise<ScriptEntry>;
    /** No waiting for another executor inside story serial: its confirmation may
     * need that same serial. A competing recovery/split simply tries later. */
    deliverOutgoingMessages(story: InterludeStory, messages: OutgoingMessageDraft[], current?: InterludeParticipant, session?: Session, shouldCancel?: (target: InterludeParticipant) => boolean, recordFailures?: boolean, requestStartedAt?: Date, failureStatus?: 'failed' | 'pending', splitSegment?: boolean, confirmedEntries?: ScriptEntry[]): Promise<OutgoingMessageDraft[]>;
    deliveryLedgerConfirmed(storyId: string, message: OutgoingMessageDraft): Promise<boolean>;
    sendOutgoingMessages(story: InterludeStory, messages: OutgoingMessageDraft[], current?: InterludeParticipant, session?: Session, shouldCancel?: (target: InterludeParticipant) => boolean, recordFailures?: boolean, requestStartedAt?: Date, failureStatus?: 'failed' | 'pending'): Promise<OutgoingMessageDraft[]>;
    /** Confirm visible delivery only after the platform accepted the message.
     * Failed attempts become explicit system evidence rather than fictional
     * character speech, and deliberately do not auto-retry to avoid duplicates
     * when an adapter fails after it has already accepted a request. */
    confirmOutgoingDeliveries(story: InterludeStory, delivered: OutgoingMessageDraft[], splitSegment?: boolean): Promise<ScriptEntry[]>;
    recordOutgoingDeliveryFailure(story: InterludeStory, participantId: string, message: OutgoingMessageDraft, reason: string, status?: 'failed' | 'pending'): Promise<void>;
    /** Issue #10 根因 B：本轮可见投递被整体撤回时，同一轮新写、指向同一参与者
     * 的模型意图（提醒/余波/后续）可能携带"已发出"的中毒前提进入后续轮次——
     * dueIntents 的 summary 与 payload 都会再进 prompt，而剧本正文里的既成叙述
     * 不会回改。host 无法语义判别哪些意图预设了发送，按"本轮创建 + 参与者与
     * 被撤回行动一致"圈定风险集，注入显式中和注记：不删除、不改 status，到
     * 期轮次仍由模型结合注记自行决断。幂等：已注记的意图不重复加尾缀。 */
    private annotateWithdrawnTurnIntents;
    /** Agency/策略拦截补偿：未进入投递管线的私聊行动统一记为 cancelled，
     * 并追加明确的"从未发送"历史条目。deliveryReality 会把 cancelled 标注为
     * withdrawn，后续轮次的模型才能区分"想发"与"已发出"。 */
    private recordWithdrawnOutgoingEvents;
    /** Update the M6.1 ledger stored beside the authoritative script. Callers
     * already hold the story queue, so this helper never opens a nested serial
     * section and cannot reorder platform delivery. */
    updateScriptDeliveryOutcome(storyId: string, reference: Pick<ScriptDeliveryReference, 'commitId' | 'eventId'> & {
        scriptEntryId?: number;
        segmentIndex?: number;
        bubbleIndex?: number;
    }, status: ScriptDeliverySegmentStatus, at: Date, reason?: string): Promise<void>;
    recordPlatformDeliveryOutcome(storyId: string, reference: ScriptDeliveryReference, status: ScriptDeliverySegmentStatus, reason?: string): Promise<void>;
    resolveLiteralQuoteMessageId(storyId: string, participantId: string, content: string): Promise<string>;
    /** Records only completed background deliveries. It is intentionally a
     * bounded action ledger, rather than a duplicate conversation transcript. */
    recordAutomaticDelivery(storyId: string, participantId: string, delivery: NonNullable<OutgoingMessageDraft['automaticDelivery']>, now: Date): Promise<void>;
    splitOutgoingMessage(content: string): string[];
    typingDelayMilliseconds(nextSegment: string): number;
    /** 首条发言的打字时间下限：以叙事请求发起时刻为基准，模型耗时不足
     * typingDelay(首条字数) 时返回需补足的毫秒数；耗时已超过则返回 0（立即发送）。
     * elapsed 以 0 为下限——起点时间戳异常（时钟偏差）不会反向放大等待。 */
    firstMessageTypingHoldMs(content: string, requestStartedAt: Date): number;
    findBotForParticipant(participant: InterludeParticipant): import("koishi").Bot<Context, any>;
    private get autoAdvanceConfig();
    private get urgeConfig();
    private get effectiveUrgeRuntime();
    private scheduleUrgeAdvance;
    /** 入站消息→节奏提升:asleep/resting → phone-focused(source: incoming)。
     * 已是 phone-focused 但评估过期（>2h 无更新）时仅续期 assessedAt——消息
     * 到达即"仍在看手机"的最新证据；不续期会让持续对话在 2 小时后节奏 stale，
     * Urge 推进无端退化到兜底因子（phone-focused 1.4 → 1.0，间隔慢 40%）。
     * 仅私聊路径调用：群消息的节奏由压缩器与主叙事交接维护。 */
    elevateRhythmOnIncoming(storyId: string, now: Date): Promise<void>;
    private dueConversationFollowUps;
    /** Remove elapsed short passes after their single writing turn. The next
     * remaining pass stays persisted, so reloads never restart the 10/20-minute
     * sequence or accidentally run both passes at once. */
    private completeConversationFollowUps;
    private isAutomaticAdvanceDue;
    pauseAutomaticAdvanceAfterUserMessage(storyId: string, now: Date): Promise<void>;
    private pauseAutomaticAdvanceAfterDelayedReply;
    /** Schedule the 10/20-minute continuity passes from the actual endpoint of
     * a conversation. A delayed reply anchors them after its planned send time. */
    private scheduleConversationFollowUpsAfterTurn;
    private scheduleNextAutomaticAdvance;
    private schedulePreplanAnchoredTime;
    private get sharedStoryConfig();
    private mainModelLabel;
    private participantPreset;
    /** The clean Canon used both by story creation and a full administrative reset. */
    private initialStorySetting;
    /** Rebuild per-account relationship baselines and discard evolving state. */
    private resetParticipantCanon;
    userAccountRule(userId: string): OneBotAccountRule;
    private getParticipant;
    recordIncomingMessage(participant: InterludeParticipant, now: Date): Promise<{
        state: ParticipantState;
        updatedAt: Date;
        id: string;
        storyId: string;
        platform: string;
        selfId: string;
        userId: string;
        channelId: string;
        personId: string;
        displayName: string;
        profile: string;
        relationship: string;
        status: "active" | "paused";
        createdAt: Date;
    }>;
    private markParticipantSeen;
    recordCharacterMessage(participant: InterludeParticipant, now: Date): Promise<{
        state: ParticipantState;
        updatedAt: Date;
        id: string;
        storyId: string;
        platform: string;
        selfId: string;
        userId: string;
        channelId: string;
        personId: string;
        displayName: string;
        profile: string;
        relationship: string;
        status: "active" | "paused";
        createdAt: Date;
    }>;
    private updateParticipantState;
    /** Converts one old account-bound story into a bot-bound shared story once. */
    private migrateLegacyStory;
    /**
     * A deployment can contain several old per-account stories. Once the first
     * one created the shared story, fold later legacy branches into it as their
     * users return; otherwise their old active rows would keep being swept in
     * parallel and create a second life for the same character.
     */
    private migrateLegacyBranchIntoShared;
    private get memoryConfig();
    private get browserConfig();
    private ensureContinuity;
    compactionFingerprint(scene: InterludeScene, entries: ScriptEntry[], chars: number): string;
    compactionIsBackedOff(storyId: string, fingerprint: string, now?: number): boolean;
    noteCompactionFailure(storyId: string, fingerprint: string, error: unknown): void;
    /** Confirm the database checkpoint moved after a successful compactor call.
     * A provider response alone is not enough: if the write was lost or
     * interrupted, retrying the same range on every turn would recreate the
     * token-burning loop this guard is meant to stop. */
    compactionCheckpointAdvanced(context: PreparedCompactionRun): Promise<boolean>;
    scheduleCompaction(storyId: string): void;
    /** 从当前在线的 OneBot（SnowLuma/NapCat）连接取通用动作调用口。
     * 指定 preferSelfId 时严格匹配该账号——空间动作落在别的 QQ 上比失败更糟。 */
    qzoneCaller(preferSelfId?: string): QzoneActionCaller | undefined;
    /**
     * 执行一条空间动作（发帖/评论/点赞）：限流门 → pending 审计行（在故事串行
     * 队列内原子预留配额）→ SnowLuma 动作（网络调用留在队列外）→ 回写
     * confirmed/failed/unknown。传输类异常与“成功帧但无 tid”都记 unknown——
     * 结果不明按已发生保守计入配额，且绝不自动重试非幂等动作。
     */
    qzoneExecute(story: InterludeStory, kind: QzoneActionKind, input: {
        content?: string;
        tid?: string;
        targetUin?: string;
        ugcRight?: number;
    }, preferSelfId?: string): Promise<{
        ok: boolean;
        tid?: string;
        error?: string;
    }>;
    /** 通道能力探测（只读）：SnowLuma 的 qzone 扩展是否可用。 */
    qzoneAvailable(preferSelfId?: string): Promise<boolean>;
    /**
     * 到期 qzone-action 意图的执行侧：payload 校验 → 限流门 → 动作 → 完成意图。
     * 坏 payload / 限流 / 通道失败都直接完成意图（成败进审计表），不回流叙事。
     */
    executeQzoneIntent(story: InterludeStory, intent: NarrativeIntent, now: Date): Promise<void>;
    /** 好友动态轮询：感知零模型调用——新鲜说说写成 [好友动态] 条目，反应留给回合内决策。 */
    qzoneFeedSweepRunning: boolean;
    qzoneFeedSweep(): Promise<void>;
    /** 被评论感知：她的说说评论数增量轮询。感知零动作配额；产出 [空间动态] 条目
     * （ SOCIAL SURFACE 规则现成，零提示词改动），由下一次推进（自动或对话）自然
     * 携带——轮询本身绝不调度推进（用户要求：被赞不立即开 advance）。 */
    qzoneReactionSweep(story: InterludeStory, caller: QzoneActionCaller, address: {
        platform: string;
        selfId: string;
    }, now: Date): Promise<void>;
    /** 加载并补齐端点注册表（幂等）：active 故事/参与者/启用的群规则派生行。 */
    /** 加载并补齐端点注册表（幂等 + 单飞：并发调用共享同一次 reconcile）。 */
    private endpointRegistryInFlight;
    /** 端点/别名运行期写队列：所有注册表变更串行执行，杜绝并发"查后写"重复。 */
    endpointWriteQueue: Promise<unknown>;
    enqueueEndpointWrite<T>(task: () => Promise<T>): Promise<T>;
    /** Keep health snapshots durable without making connector lifecycle writes part of
     * the message transaction. The global DB writer still serializes physical writes. */
    persistEndpointState(endpointId: string, state: EndpointState): void;
    setEndpointState(endpointId: string, state: EndpointState): void;
    endpointGateReason(endpointId: string | undefined, now?: number, options?: {
        ignoreCooldown?: boolean;
    }): string | undefined;
    /** 端点行在 ctx.bots 里的实时在线对应物（按平台隔离账号键匹配）。 */
    liveBotForEndpoint(row: EndpointRow): any;
    /**
     * Agency uses the normal delivery gate plus the optional channel-specific
     * initiation gate.  EndpointState.initiate is intentionally optional: QQ
     * and other transports without a context-token concept remain compatible
     * with the historical proactive path, while a present-but-expired token is
     * a hard, explicitly classified failure.
     */
    endpointInitiateGateReason(endpointId: string | undefined, now?: number): string | undefined;
    endpointForDelivery(endpointId: string | undefined, owner: {
        kind: 'story-role' | 'participant-user' | 'group';
        id: string;
    }, now?: number, options?: {
        ignoreCooldown?: boolean;
    }): {
        row?: EndpointRow;
        reason?: string;
    };
    ensureEndpointRegistry(): Promise<any>;
    reconcileEndpointRegistry(): Promise<void>;
    /** 运行期增量登记：故事/参与者创建时同步 upsert 端点行。
     * 经写队列串行执行；先落库成功才进内存；失败置脏（下次 reconcile
     * 重试）——绝不留下"进程内有、重启即无"的幽灵端点，也不让登记失败被静默
     * 吞掉后触发陌生账号拒绝（置脏保证 findStory 下次会重新 reconcile 补上）。 */
    registerStoryRoleEndpointRow(story: {
        id: string;
        platform: string;
        selfId: string;
    }): Promise<void>;
    registerParticipantUserEndpointRow(participant: {
        id: string;
        platform: string;
        selfId: string;
        userId: string;
    }): Promise<void>;
    /** qzone 审计行 endpointId 回填：旧行按 storyId → 该故事角色端点归因。 */
    backfillQzoneEndpointIds(): Promise<void>;
    /**
     * 登记剧本别名（幂等）：既有行指向相同 canonical → 无操作；指向不同
     * canonical → 冲突告警一次且不覆盖（人工裁决）；成功则落行并更新缓存。
     */
    recordStoryAlias(aliasStoryId: string, canonicalStoryId: string, reason: string, announce?: boolean): Promise<boolean>;
    /** 别名解析：链式（双射失败）或悬空（canonical 无故事）→ undefined + 一次性告警。 */
    resolveStoryIdAlias(aliasStoryId: string): Promise<string | undefined>;
    /** M1b 回滚：删除一条别名重定向并留审计。行删除即回滚生效（双向可达由 canonicalStoryId 索引保证）。 */
    removeStoryAlias(aliasStoryId: string, reason?: string): Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** M1b 只读视图：列出当前别名（管理命令用）。 */
    listStoryAliases(): StoryAliasRecord[];
    /** 注册一个角色端点到既有故事（幂等；accountKey 被其他故事占用时拒绝）。
     * 经写队列串行执行——并发 add 不会双双重叠冲突检查；落库失败
     * 不进内存且返回失败。 */
    addStoryEndpoint(story: InterludeStory, platform: string, selfId: string, channelKind?: EndpointChannelKind): Promise<{
        ok: boolean;
        endpointId?: string;
        error?: string;
    }>;
    /** 停用一个角色端点（身份与历史保留；enabled=false 后其消息按陌生账号处理）。 */
    disableStoryEndpoint(endpointId: string): Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** M3 §八：解析参与者最近活跃端点（EndpointState.connection.observedAt 最新；无则 undefined）。 */
    resolveMostActiveEndpointId(participantId: string): string | undefined;
    /**
     * Decide whether the narrator needs the multi-platform transport contract.
     * One platform, including several accounts on that platform, keeps the
     * lightweight legacy prompt. Only enabled endpoints that are legal targets
     * for this request are considered; the complete registry is never exposed.
     */
    narrativeEndpointSelection(story: InterludeStory, participants: InterludeParticipant[], groups: Array<{
        participantId: string;
        groupId: string;
        label: string;
    }>): {
        enabled: boolean;
        options: NarrativeEndpointOption[];
    };
    /** 链接用户端点到既有参与者（幂等；accountKey+userId 已属其他参与者时拒绝）。 */
    linkParticipantEndpoint(participant: InterludeParticipant, platform: string, userId: string): Promise<{
        ok: boolean;
        endpointId?: string;
        error?: string;
    }>;
    /** 解除链接（可撤销；身份与历史保留，enabled=false）。 */
    unlinkParticipantEndpoint(endpointId: string): Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** 列出参与者名下全部用户端点（含启用状态）。 */
    listParticipantEndpoints(participantId: string): any;
    /** 解析故事的任一角色端点的 accountKey（供用户端点确定通道归属）。 */
    resolveRoleAccountKey(storyId: string, platform: string): string;
    /** 列出故事的全部角色端点（含在线状态）。 */
    listStoryEndpoints(storyId: string): any;
    /** 入站反向解析（v3 §三）：accountKey → 端点行；未注册返回 undefined（回落旧路径）。 */
    resolveInboundEndpointFor(source: {
        platform: string;
        selfId: string;
        userId?: string;
        groupId?: string;
        channelId?: string;
    }): Promise<import("./endpoints").InboundResolution>;
    /** 条目通道上下文（v3 §十）：注册表命中才返回；未迁移/陌生账号不标注（单平台零影响）。 */
    channelMetadataFor(source: {
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
    /** 入站触达端点状态：连接在线 + 可投递 + 微信主动资格刷新（v3 §四）。 */
    touchEndpointStateInbound(source: {
        platform: string;
        selfId: string;
        userId?: string;
        groupId?: string;
        channelId?: string;
    }): Promise<void>;
    /** 将当前 Koishi bot 快照同步到已加载的端点注册表。
     * 这是重启后的实时连接证据，不会恢复历史快照中的 online 真值。
     */
    syncCurrentBotConnections(): Promise<void>;
    /** 连接器在线状态回写（连接/断开事件；v3 §四 connection 维）。 */
    noteEndpointConnection(accountKey: string, online: boolean): void;
    endpointDriftWarned: Set<string>;
    /**
     * M1a 出站地址解析（v3 §五）：注册表命中且启用时以注册表为准，并核对旧字段
     * （漂移只告警一次）；未命中/注册表未加载时回落旧字段——单平台零影响。
     * 同一 owner 多行时不再"取第一行"——优先最近观测过连接的端点，
     * 平手按 createdAt 稳定排序，并一次性告警（M2 起多端点归因的正确性基础）。
     */
    endpointAddressSync(legacy: {
        platform: string;
        selfId: string;
    }, owner?: {
        kind: 'story-role' | 'participant-user';
        id: string;
    }): {
        platform: string;
        selfId: string;
        endpointId?: string;
    };
    /** 出站结果回写端点状态（v3 §四 deliverable 维；内存无副作用）。
     * 提供 address 时只更新地址匹配的端点——多端点下不串刷兄弟端点。 */
    noteEndpointOutbound(owner: {
        kind: 'story-role' | 'participant-user' | 'group';
        id: string;
    }, ok: boolean, note: string, address?: {
        platform: string;
        selfId: string;
    }): void;
    stop(): Promise<void>;
    weatherSweep(): Promise<void>;
    worldSeederSweepRunning: boolean;
    worldSeederSweep(): Promise<void>;
    /** 上下文 payload：环境（时区/季节/世界设定）、历史剧本（压缩摘录）、
     * 关系网（拉黑名单）、主角所为（workingDetails + 场景/弧摘要）。 */
    buildWorldSeederPayload(story: InterludeStory, now: Date, recentSummaries: string[], domain?: WorldSeedDomain): Promise<string>;
    worldSeederBlockedNames(storyId: string): Promise<any>;
    /** 到期排水：claim-then-append，先进账的条目本回合 recentScript 即可见。
     * 低重要性只在推进/跟进回合注入，避免劫持对话回合。 */
    drainDueSeededEvents(story: InterludeStory, now: Date, includeLow: boolean): Promise<void>;
    compactStories(): Promise<void>;
    /** 复核退避/对话推迟会让 materializedDays 的 [今天,明天] 槽位缺失，窗口静默变空。
     * 取记录时若两个槽位都没有物化天，先本地无模型重物化（锚定今天）再算窗口。 */
    currentSchedulePreplanWindow(story: InterludeStory, at: Date): Promise<import("./types").SchedulePreplanWindow>;
    getSchedulePreplan(storyId: string): Promise<SchedulePreplanRecord>;
    private longHorizonConfig;
    longHorizonSweepRunning: Set<string>;
    private longHorizonLastScore;
    longHorizonGenerationRunning: Set<string>;
    /** 生成失败/归一化拒绝后的冷却：无 active 指导时 first-trigger 恒为真，
     *  不加冷却会每个 sweep 重打一次模型（错误刷屏与 token 浪费的放大器）。 */
    private longHorizonGenerationCooldownUntil;
    /** Story ids whose active guidance row has already been loaded for this process. */
    private longHorizonGuidanceLoaded;
    longHorizonSweep(story: InterludeStory, _now?: Date): Promise<void>;
    longHorizonProgress(storyId: string): Promise<LongArcProgressRow | undefined>;
    saveLongHorizonProgress(progress: LongArcProgressRow): Promise<void>;
    getActiveLongArcGuidance(storyId: string): Promise<LongArcGuidanceRecord | undefined>;
    ensureLongHorizonGuidanceLoaded(storyId: string): Promise<void>;
    longHorizonGenerate(story: InterludeStory, evidence: ScriptEntry[], currentScore: number, progress: LongArcProgressRow): Promise<void>;
    longHorizonInput(story: InterludeStory, eligible: ScriptEntry[]): Promise<Record<string, unknown>>;
    /** 主叙事注入用的裁剪投影：催化器只提供行动许可，不提供强制剧情。 */
    longHorizonPromptProjection(storyId: string): string | undefined;
    private activeLongArcGuidanceCache;
    schedulePreplanEvidence(storyId: string, afterEntryId: number): Promise<{
        entries: ScriptEntry[];
        filteredThroughEntryId: number;
        scanComplete: boolean;
    }>;
    saveSchedulePreplan(record: SchedulePreplanRecord): Promise<void>;
    prepareSchedulePreplanReview(story: InterludeStory, now: Date): Promise<{
        current: any;
        evidenceEntries: any;
        localDate: string;
        needsModel: boolean;
        request: SchedulePreplanReviewRequest;
    }>;
    /** Preplan has one small independent request instead of competing with
     * scene/fact compression. One recovery retry is cheap and covers providers
     * that occasionally omit an otherwise valid JSON object. */
    requestSchedulePreplan(story: InterludeStory, request: SchedulePreplanReviewRequest): Promise<any>;
    persistSchedulePreplanReview(story: InterludeStory, review: {
        current?: SchedulePreplanRecord;
        evidenceEntries: ScriptEntry[];
        localDate: string;
    }, proposal: unknown, now: Date): Promise<boolean>;
    /** A visible reply already reached the user, so this retry may write only
     * the missing life script. It must never create a second transport message. */
    private scheduleStreamScriptRecovery;
    private persistStreamScriptRecovery;
    /** 手动/强制压缩的三阶段入口:Phase1 队列内快照,Phase2 队列外模型+embedding,
     * Phase3 队列内轻量落库——与后台调度器路径同构,不阻塞直播回合。 */
    compactThreePhase(storyId: string, force: boolean, generation?: string): Promise<boolean>;
    /** Everything up to the expensive compactor call: cheap reads plus the due
     * checks. Runs inside the story serial queue, but the model call itself must
     * not — a queued compactor request would delay the next live turn. */
    prepareCompaction(story: InterludeStory, now: Date, force: boolean): Promise<PreparedCompaction | undefined>;
    /** Cheap DB persistence for one compaction decision. Re-acquires the story
     * serial queue in the caller so writes stay ordered with narrative turns. */
    applyCompaction(story: InterludeStory, context: PreparedCompactionRun, decision: CompactionDecision, now: Date, startedAt: number): Promise<boolean>;
    /** Older state patches are compacted only by the background maintenance
     * lane. Live turns always retain the last few days as raw detail. */
    compactOverlayUnlocked(story: InterludeStory, now: Date): Promise<boolean>;
    private overlaySnapshotsForPrompt;
    /** Once a snapshot safely represents older changes, keep state.overlay as
     * the live (uncompacted) delta only. This is what actually reduces prompt
     * size; snapshots carry the older evolution separately. */
    rebuildLiveOverlayState(story: InterludeStory, now: Date): Promise<void>;
    prepareCompactionEmbeddings(storyId: string, decision: CompactionDecision, entries: ScriptEntry[]): Promise<Map<string, number[]>>;
    persistCompaction(story: InterludeStory, scene: InterludeScene, decision: CompactionDecision, entries: ScriptEntry[], now: Date, visibleFactIds?: Set<number>, precedingEntries?: ScriptEntry[], factEmbeddings?: Map<string, number[]>): Promise<void>;
    persistCompactionOutputs(story: InterludeStory, scene: InterludeScene, decision: CompactionDecision, entries: ScriptEntry[], now: Date, visibleFactIds?: Set<number>, precedingEntries?: ScriptEntry[], factEmbeddings?: Map<string, number[]>): Promise<void>;
    persistFact(storyId: string, draft: import('./types').FactDraft, entries: ScriptEntry[], now: Date, preparedEmbedding?: number[]): Promise<boolean>;
    /** 全部向量请求的共用漏斗。日志分级（向量可观测性）：
     * 成功 = standard info（回合级一行：模型/维度/耗时；后台补齐调用传
     * density=diagnostic，由各补齐函数的批次行汇总）；网络/格式失败 =
     * standard warn——"本轮语义检索降级为规则排序"必须让用户看得见；
     * 本地跳过（Embedding 未启用或无可用连接，含 SilentEmbedder）=
     * diagnostic debug——启动时已有一次性的降级警告兜底。
     * 行为语义不变：失败/跳过返回 []，绝不阻塞回合。 */
    private embedText;
    private embeddingModelLabel;
    scheduleFactEmbeddingBackfill(storyId: string): void;
    backfillFactEmbeddings(storyId: string, batchSize: number): Promise<void>;
    persistStatePatch(story: InterludeStory, draft: StatePatchDraft, entries: ScriptEntry[], now: Date): Promise<void>;
    private developmentForPrompt;
    private report;
    /** Emit an operational record only when the selected verbosity includes it.
     * Summary is for outcomes, standard is for scheduler/model activity, and
     * diagnostic is for skip reasons and internal counters. */
    private reportOperation;
    private writeReport;
    /** P4（§13）：统一动作链路的结构化事件——文本渲染与结构载荷同一对象；
     * 旧消息继续走正则分类，两者兼容。 */
    private reportCommunicationEvent;
    private reportStandalone;
    /** One Koishi log line per model call: token counts, cache hit rate and
     * optional billing from the per-connection price fields. */
    private reportTokenUsage;
    private reportStandaloneOperation;
    private writeStandalone;
    resolveCompactionFacts(storyId: string, value: unknown, allowedIds: ReadonlySet<number>, now: Date): Promise<boolean>;
    markContinuityDirty(storyId: string, now: Date): Promise<void>;
    private emitLog;
    private reportBlindModeHealth;
    private allowsVerbosity;
    private getStory;
    /** 当前异步调用链正在其中执行的故事串行域(用于嵌套写路径判断"已在队列内,勿再排队")。 */
    private serialScope;
    inSerial(id: string): boolean;
    /** serial 看门狗(rc50 issue 报告)：任务占用队列超 2 分钟打 warn——
     * 单次网络挂起曾把整条执行链永久堵死且无任何日志,重启才能恢复。 */
    private serialWatchdog;
    private serial;
    /** 看门狗扫描：占用超 2 分钟的任务告警一次（每 token 只报一次）。 */
    private reportStuckSerialQueues;
    private dbWrite;
    /**
     * A SQLite/sql.js read can fail during the same short filesystem hiccup as a
     * write. Reads stay concurrent for normal performance; only transient driver
     * errors receive a small bounded retry instead of aborting a user turn.
     */
    private dbRead;
    private dbGet;
    /** Repair only a stale canonical story whose configured bot is no longer
     * online. A live OneBot session is stronger evidence than historical story
     * metadata, while a still-online story bot remains untouched. */
    private repairCanonicalOneBotStoryTransport;
    private retryDbWrite;
    private dbCreate;
    private findPossiblyCommittedCreate;
    private dbSet;
    private dbRemove;
    /**
     * SQLite/sql.js may fail physical DELETE when its backing file is locked.
     * Fall back to redaction so an administrative purge still completes and the
     * removed content is no longer exposed to prompts or management commands.
     */
    private purgeTable;
}
