import { Context, Service, Session } from 'koishi';
import { type QzoneActionKind } from './qzone';
import { type EndpointRow, type StoryAliasRecord } from './endpoints';
import { HealthMonitor } from './health';
import { UrgeConfig } from './urge';
import { ModelConfig } from './narrator';
import { GroupWillingnessConfig } from './group-willingness';
/** Koishi/Satori uses numeric Universal.Status values; keep legacy string adapters compatible. */
export declare function isBotOnlineStatus(status: unknown): boolean;
import { SchedulePreplanConfig } from './schedule-preplan';
import { InterludeArc, InterludeScene, InterludeParticipant, InterludeStory, NarrativeDecision, NarrativeFact, NarrativeIntent, GroupContext, NarrativeInteraction, NarrativeProvider, NarrativeRequest, NarrativeCompactor, NarrativeEmbedder, OutgoingMessageDraft, ParticipantState, ScriptEntry, StatePatchProposal, StorySetting, StoryState, BrowserIntentDraft, OverlaySnapshot, AlterSystemConfig, ChatRhythmConfig, AgencyConfig, AgencyWindowState, ProactiveContactDraft, ScenePresenceState, ChatActionCapabilities, ChatReactionName, FollowUpCommitmentDraft, FollowUpResolutionDraft, MessageReactionDraft, NativeFaceSemantic, QuotedMessageContext, SchedulePreplanRecord, TimelinePlan, UserReportedTime } from './types';
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
/** Semantic recall is another view of raw history, so it must obey the same
 * private-branch boundary as recentScript. Group transcripts are deliberately
 * excluded from a private turn unless the owner opted into shared details. */
export declare function isHistoryEntryVisibleToParticipant(entry: Pick<ScriptEntry, 'participantId' | 'kind'>, participantId: string, shareParticipantDetails: boolean): boolean;
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
    /** 预设同步：从 typ0-site 分享站自动拉取配置。 */
    presetSync?: {
        enabled: boolean;
        baseUrl: string;
        shareCode: string;
        autoUpdate: boolean;
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
    schedulePreplan?: SchedulePreplanConfig;
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
    /** Prevent an echoed self-message from entering the narrative. */
    ignoreSelfMessages: boolean;
}
export interface ChatActionsConfig {
    enabled: boolean;
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
}
export interface GroupChatRule {
    groupId: string;
    label: string;
    enabled: boolean;
    purpose: string;
    characterRole: string;
    /** Explicit Koishi channel assignee. Empty/omitted preserves native routing. */
    assignee?: string;
    responseMode: 'mention-only' | 'always';
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
    private lastWeatherText;
    private qzoneRuntime;
    private embedder;
    private stickerDescriber;
    private visionDescriber;
    private stickerCatalog;
    /** Whole-table semantic recall cache, one map per story: entry id → vector +
     * minimal content. Loaded lazily on first recall and extended incrementally
     * by the background backfill; never persisted. */
    private historyVectors;
    /** 桥接幂等（轻量修复）：桌面 30s 超时后入 inbox 重放时，同一消息会再次到达。
     * 用内存 Map 按 platform:messageId 去重——进程生命周期内有效，重启后由
     * script_entry.metadata.messageId 的磁盘记录兜底（重放场景不会跨重启）。 */
    private seenIncomingMessages;
    private episodeIndexes;
    private historyVectorsReady;
    private historyVectorLoads;
    private historyBackfills;
    private historyBackoff;
    private automaticRecallCache;
    /** Per-story retry-after timestamps for failed Schedule Preplan generations. */
    private schedulePreplanBackoff;
    /** Per-story retry-after timestamps for a failed automatic timeline window. */
    private timelineBackoff;
    /** Consecutive timeline-director failures per story; drives exponential backoff and the fuse. */
    private timelineDirectorFailures;
    private stickerById;
    private stickerScanRunning;
    /**
     * 同一故事的用户消息、到期意图和后台压缩必须串行。否则“用户新消息
     * 取消旧延迟回复”可能与定时发送同时发生，造成过期消息仍被发出。
     */
    private queues;
    private turnEngine;
    private scheduler;
    /** 端点注册表内存缓存（M1a）：行来自 interlude_endpoint；状态为进程内三维时效。 */
    private endpointRows;
    private endpointStates;
    private endpointStateWriteQueue;
    private endpointRegistryReady;
    /** M1b 剧本别名缓存（interlude_story_alias），随注册表一同加载。 */
    private storyAliasRows;
    /** M2 §1.3：入站接收序号（进程内单调递增；双端点回合排序依据）。 */
    private inboundSeq;
    private storyAliasProblems;
    private bufferedGroupTurns;
    /** Short-lived group-member display names. QQ number remains the stable key. */
    private groupMemberNameCache;
    private groupMemberNameLookups;
    /** Ephemeral, per-group willingness score. It never touches private turns or durable story state. */
    private groupWillingness;
    /** Synchronously marks a relationship whose current typing chain was interrupted by new input. */
    private interruptedTypingParticipants;
    /** Prevent a background life turn from racing an unlocked live model call. */
    private factBackfills;
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
    private compactionSweepRunning;
    /** Startup/sweep compensation for durable pending script deliveries. The
     * backoff is process-local; the delivery ledger remains the source of truth
     * across restarts. */
    private pendingDeliveryRecoveryRunning;
    /** Same authored event has one executor through transport AND confirmation. */
    private deliveryExecutors;
    /** Known platform successes survive a local confirmation failure in this process. */
    private acceptedDeliveries;
    private pendingDeliveryRecoveryBackoff;
    private blindModeHealthIssue;
    /** Console reload creates a new service instance, so normalized config can
     * be cached safely for the lifetime of this instance. */
    private cachedAudioConfig?;
    private cachedStickerConfig?;
    private cachedAlterSystemConfig?;
    private cachedAgencyConfig?;
    private cachedSchedulePreplanConfig?;
    private cachedBlindModeConfig?;
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
    private desktopDeliveryHandler?;
    /** W3（C2-1）：桥接动作代理出口——desktop-bridge 安装后非空；普通 Koishi 恒空。
     * qzoneCaller 与 sendSticker 桌面模式经此调用宿主代调上游 OneBot 动作。 */
    private desktopOnebotActionHandler?;
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
    private puppeteerHintLogged;
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
    private deadImageSources;
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
        entries: any[];
        scenes: any[];
        facts: any[];
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
        entries: any[];
        scenes: any[];
        facts: any[];
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
    private groupRule;
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
    private groupSenderName;
    private lookupGroupMemberName;
    private bufferGroupMessage;
    private flushGroupTurn;
    private flushGroupTurnUnlocked;
    private groupMessages;
    private loadHistoricalGroupImages;
    private groupCooldownActive;
    private groupChatCapabilities;
    private privateChatCapabilities;
    private executeGroupReactions;
    private resolveSticker;
    private get expressionThreshold();
    private resolveNativeFace;
    private sendSticker;
    private sendNativeFace;
    private sendGroupMessage;
    /**
     * Persisted messages wait here briefly before they reach the narrator. This
     * makes “你好 / 在吗 / 我有件事想问” one event without risking message loss.
     */
    private bufferUserNarrative;
    private signalIncomingInterruption;
    /** Experimental streaming path: only a complete, validated private reply
     * may leave early. It commits the existing interruption boundary at the
     * same moment as ordinary first-message delivery. */
    private deliverEarlyPrivateReply;
    /** Normalized native-audio understanding config (Console model.audio). */
    private get audioConfig();
    private get stickerConfig();
    /** One user event folds typed text, images and voice into a single fact:
     * attachments ride their own native channels, the stored content keeps a
     * place-holder fact so history and the desktop timeline stay readable. */
    private describeUserEvent;
    private readForward;
    private scanStickerLibrary;
    /** 表情包投递基址：显式配置 > Koishi selfUrl > 本机默认端口。 */
    private stickerDeliveryBase;
    /** 表情包 HTTP 回源路由：OneBot 实现（NapCat/Lagrange）分容器时经此下载文件。
     * 仅服务素材库内、资产表登记过的文件；assetId 即查询键，无目录穿越面。 */
    private registerStickerRoute;
    private stickerRouteRegistered;
    private refreshStickerCatalog;
    private semanticStickerEmbeddingEnabled;
    /** Vectorize described-but-unindexed sticker assets in the background. The
     * batch stays small so one scan cannot spend more than a handful of calls. */
    private backfillStickerEmbeddings;
    private stickerCatalogForSession;
    /** Semantically narrow the sticker catalog to the entries most relevant to the
     * live message. Falls back to the full catalog whenever the feature is off,
     * the turn has no query vector, or the catalog is below the limit. */
    private rankStickerAssets;
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
    private recallHistory;
    /** Load every recallable entry of one story into the recall cache. The load is
     * deliberately whole-table (no time window): older memories stay retrievable,
     * and the per-process cache makes the cost one-off per story. */
    private ensureHistoryVectors;
    /** Drop in-memory copies whenever their source rows are removed or redacted.
     * The next recall reloads only the surviving database rows. */
    private invalidateHistoryVectors;
    /** Background vectorization for semantic history recall. Newest entries go
     * first so live-recall quality ramps up quickly; the whole table is covered
     * gradually over successive maintenance passes. */
    private backfillHistoryEmbeddings;
    /** Download voice records as native audio attachments. QQ voice is SILK,
     * which multimodal models cannot read, so SnowLuma's get_record action is
     * always asked to transcode server-side (out_format) and return base64.
     * Mirrors the native-image acquisition path; nothing is persisted. */
    private loadNativeAudio;
    private fetchNativeAudio;
    private describeVisionEvent;
    private loadNativeImages;
    /** Sidecar vision mirrors native image acquisition, but sends only its
     * factual result into the text narrator's current event. */
    private describeCurrentImages;
    isExpiredImageSource(source: string): boolean;
    /** 已判死来源的首次失败原因（未判死返回 undefined）。 */
    deadImageSourceReason(source: string): string;
    private rememberDeadImageSource;
    private fetchNativeImage;
    /** QQ CDN 媒体 URL 会 302 跳转（SnowLuma stream-download 同款结论），
     * 原先的 redirect:'error' 把每一跳都变成非过期错误：不入负缓存、每轮
     * 重复失败。改为手动逐跳跟随（至多 3 跳），每跳按入口同一规则校验
     * 目标域，保住 SSRF 边界；跳向不受信域视为确定性失败判死。 */
    private fetchImageThroughRedirects;
    private fetchNativeImageUncached;
    /** Convert adapter/fetched bytes into one bounded native-vision attachment.
     * Animated stickers are rendered to a representative PNG frame when the
     * optional Puppeteer service is available; otherwise the original image is
     * still passed through rather than inventing a description. */
    private imageBytesToNative;
    /** Re-render a static image through Puppeteer capped at the configured vision
     * dimension. Multimodal providers tile large images into many tokens, so a
     * bounded re-encode saves both upload time and per-turn token cost; the
     * browser also applies EXIF orientation, fixing rotated phone photos. */
    private downscaleImageForVision;
    private renderAnimatedImageFrame;
    /** Prevent timers or already-returning model calls from resurrecting data
     * after an administrator resets the story or clears HDSI tables. */
    private invalidateBufferedNarratives;
    private invalidateStoryTasks;
    private rememberIncomingMessage;
    private deliveryGeneration;
    private taskGeneration;
    private taskGenerationCurrent;
    /** True while a live or debounced conversation should take priority over background work. */
    private hasPendingNarrative;
    private flushBufferedNarrative;
    advanceStory(story: InterludeStory, force?: boolean): Promise<OutgoingMessageDraft[]>;
    /** Used by commands/tests to deliver a mixed set of account-targeted actions safely. */
    deliverMessages(story: InterludeStory, messages: OutgoingMessageDraft[], session?: Session): Promise<OutgoingMessageDraft[]>;
    compactStory(story: InterludeStory, force?: boolean): Promise<boolean>;
    /** Merge and compress already-applied overlay patches without running the
     * full scene/fact compaction pass. This is safe for manual maintenance. */
    compactOverlay(story: InterludeStory): Promise<boolean>;
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
    private get schedulePreplanConfig();
    private get blindModeConfig();
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
    private appendIntent;
    /** Active consequences share the intent table but are never scheduler work.
     * Their payload keeps the lifecycle explicit so old scheduled intents keep
     * their existing behaviour without a migration. */
    private activeConsequencesAndExpire;
    /** Only active consequences visible to the writer may be resolved. This
     * prevents a remote model from changing arbitrary future plans by id. */
    private applyIntentUpdates;
    /** Stores a narrator-proposed browser action as a future intent. The model
     * never writes page content directly; a separate Puppeteer task creates the
     * observation later. */
    private appendBrowserIntent;
    /** Executes a due browser intent once, records its bounded observation, and
     * marks the future plan complete regardless of success. A failed browser is
     * still an event (the character could not access the page), but it never
     * blocks later dialogue or background life updates. */
    private executeDeferredBrowserIntent;
    /** Read a page through Koishi Puppeteer. This is intentionally read-only:
     * it rejects non-public destinations, extracts visible text only, and closes
     * the page after every observation. */
    private collectWebObservation;
    private saveWebObservation;
    /** Immediate browser reads are intentionally held in memory until the
     * final narrator result survives the stale-request check. This prevents an
     * obsolete two-second message burst from leaving a durable web event behind. */
    private persistCollectedWebObservation;
    private findCachedWebObservation;
    private withBrowserSlot;
    /** Persist a bounded retry so a transient provider failure cannot strand a user turn. */
    /** 用户回合成功后的清理：遗留的 narrative-retry 已无意义——其入站消息早已
     * 被本轮覆盖或消化，保留只会到期再跑一轮完整回合（userInitiated 允许投递）
     * 并给用户送去一条重复回复。 */
    private cancelPendingNarrativeRetries;
    private scheduleNarrativeRetry;
    private dueIntents;
    private upcomingNarrativeIntents;
    /** Wake the scheduler close to a short typing delay instead of waiting for
     * the normal background sweep. The due intent remains the source of truth. */
    private scheduleDueIntentWake;
    /** 到期唤醒的执行体：分段消息直投；sweep 繁忙或前台回合未结束时返回 'busy'，由 scheduler 短候重排。 */
    private wakeDueIntents;
    private reconcileTerminalSplitIntent;
    private pendingSplitSegments;
    /** Called in the story queue, after transport work and before any narration. */
    private deferDueIntentsBehindPendingSplits;
    private scheduleNextSplitWake;
    /** Deliver already-decided <sep/> segments without invoking the narrator. */
    private deliverDueSplitSegments;
    /** Pending spoken promises are intentionally tiny and relationship-local. */
    private pendingFollowUpCommitments;
    /** Expiration retires a scheduler task, not a fictional fulfilled promise. */
    private retireExpiredFollowUps;
    private appendFollowUpCommitment;
    private applyFollowUpResolutions;
    private deferUnresolvedDueFollowUps;
    private appendProactiveCheck;
    /** schedule_preplan 的主键就是 storyId，Minato 拒绝含主键的 update——
     * 混在改写循环里必抛，导致后续 participantId 回填被跳过（隐私脱敏失效）。
     * 改为读旧行→建新行→删旧行（每故事仅一行，无并发窗口问题）。 */
    private migrateSchedulePreplanRecord;
    private cancelPendingOutgoingMessages;
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
    private sendCrossGroupMessage;
    private deliveryExecutionKey;
    private successfulDeliveryEntry;
    /** No waiting for another executor inside story serial: its confirmation may
     * need that same serial. A competing recovery/split simply tries later. */
    private deliverOutgoingMessages;
    private deliveryLedgerConfirmed;
    private sendOutgoingMessages;
    /** Confirm visible delivery only after the platform accepted the message.
     * Failed attempts become explicit system evidence rather than fictional
     * character speech, and deliberately do not auto-retry to avoid duplicates
     * when an adapter fails after it has already accepted a request. */
    private confirmOutgoingDeliveries;
    private recordOutgoingDeliveryFailure;
    /** Agency/策略拦截补偿：未进入投递管线的私聊行动统一记为 cancelled，
     * 并追加明确的"从未发送"历史条目。deliveryReality 会把 cancelled 标注为
     * withdrawn，后续轮次的模型才能区分"想发"与"已发出"。 */
    private recordWithdrawnOutgoingEvents;
    /** Update the M6.1 ledger stored beside the authoritative script. Callers
     * already hold the story queue, so this helper never opens a nested serial
     * section and cannot reorder platform delivery. */
    private updateScriptDeliveryOutcome;
    private recordPlatformDeliveryOutcome;
    private resolveLiteralQuoteMessageId;
    /** Records only completed background deliveries. It is intentionally a
     * bounded action ledger, rather than a duplicate conversation transcript. */
    private recordAutomaticDelivery;
    private splitOutgoingMessage;
    private typingDelayMilliseconds;
    /** 首条发言的打字时间下限：以叙事请求发起时刻为基准，模型耗时不足
     * typingDelay(首条字数) 时返回需补足的毫秒数；耗时已超过则返回 0（立即发送）。
     * elapsed 以 0 为下限——起点时间戳异常（时钟偏差）不会反向放大等待。 */
    private firstMessageTypingHoldMs;
    private findBotForParticipant;
    private get autoAdvanceConfig();
    private get urgeConfig();
    private get effectiveUrgeRuntime();
    private scheduleUrgeAdvance;
    /** 入站消息→节奏提升:asleep/resting → phone-focused(source: incoming)。 */
    private elevateRhythmOnIncoming;
    private isAutomaticAdvancePaused;
    private dueConversationFollowUps;
    /** Remove elapsed short passes after their single writing turn. The next
     * remaining pass stays persisted, so reloads never restart the 10/20-minute
     * sequence or accidentally run both passes at once. */
    private completeConversationFollowUps;
    private isAutomaticAdvanceDue;
    private pauseAutomaticAdvanceAfterUserMessage;
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
    private userAccountRule;
    private getParticipant;
    private recordIncomingMessage;
    private markParticipantSeen;
    private recordCharacterMessage;
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
    private compactionFingerprint;
    private compactionIsBackedOff;
    private noteCompactionFailure;
    /** Confirm the database checkpoint moved after a successful compactor call.
     * A provider response alone is not enough: if the write was lost or
     * interrupted, retrying the same range on every turn would recreate the
     * token-burning loop this guard is meant to stop. */
    private compactionCheckpointAdvanced;
    private scheduleCompaction;
    /** 从当前在线的 OneBot（SnowLuma/NapCat）连接取通用动作调用口。
     * 指定 preferSelfId 时严格匹配该账号——空间动作落在别的 QQ 上比失败更糟。 */
    private qzoneCaller;
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
    private executeQzoneIntent;
    /** 好友动态轮询：感知零模型调用——新鲜说说写成 [好友动态] 条目，反应留给回合内决策。 */
    private qzoneFeedSweepRunning;
    private qzoneFeedSweep;
    /** 被评论感知：她的说说评论数增量轮询。感知零动作配额；产出 [空间动态] 条目
     * （ SOCIAL SURFACE 规则现成，零提示词改动），由下一次推进（自动或对话）自然
     * 携带——轮询本身绝不调度推进（用户要求：被赞不立即开 advance）。 */
    private qzoneReactionSweep;
    /** 加载并补齐端点注册表（幂等）：active 故事/参与者/启用的群规则派生行。 */
    /** 加载并补齐端点注册表（幂等 + 单飞：并发调用共享同一次 reconcile）。 */
    private endpointRegistryInFlight;
    /** 端点/别名运行期写队列：所有注册表变更串行执行，杜绝并发"查后写"重复。 */
    private endpointWriteQueue;
    private enqueueEndpointWrite;
    /** Keep health snapshots durable without making connector lifecycle writes part of
     * the message transaction. The global DB writer still serializes physical writes. */
    private persistEndpointState;
    private setEndpointState;
    private endpointGateReason;
    /** 端点行在 ctx.bots 里的实时在线对应物（按平台隔离账号键匹配）。 */
    private liveBotForEndpoint;
    /**
     * Agency uses the normal delivery gate plus the optional channel-specific
     * initiation gate.  EndpointState.initiate is intentionally optional: QQ
     * and other transports without a context-token concept remain compatible
     * with the historical proactive path, while a present-but-expired token is
     * a hard, explicitly classified failure.
     */
    private endpointInitiateGateReason;
    private endpointForDelivery;
    private ensureEndpointRegistry;
    private reconcileEndpointRegistry;
    /** 运行期增量登记：故事/参与者创建时同步 upsert 端点行。
     * 经写队列串行执行；先落库成功才进内存；失败置脏（下次 reconcile
     * 重试）——绝不留下"进程内有、重启即无"的幽灵端点，也不让登记失败被静默
     * 吞掉后触发陌生账号拒绝（置脏保证 findStory 下次会重新 reconcile 补上）。 */
    private registerStoryRoleEndpointRow;
    private registerParticipantUserEndpointRow;
    /** qzone 审计行 endpointId 回填：旧行按 storyId → 该故事角色端点归因。 */
    private backfillQzoneEndpointIds;
    /**
     * 登记剧本别名（幂等）：既有行指向相同 canonical → 无操作；指向不同
     * canonical → 冲突告警一次且不覆盖（人工裁决）；成功则落行并更新缓存。
     */
    private recordStoryAlias;
    /** 别名解析：链式（双射失败）或悬空（canonical 无故事）→ undefined + 一次性告警。 */
    private resolveStoryIdAlias;
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
    addStoryEndpoint(story: InterludeStory, platform: string, selfId: string, channelKind?: 'qq' | 'wechat'): Promise<{
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
    private resolveMostActiveEndpointId;
    /**
     * Decide whether the narrator needs the multi-platform transport contract.
     * One platform, including several accounts on that platform, keeps the
     * lightweight legacy prompt. Only enabled endpoints that are legal targets
     * for this request are considered; the complete registry is never exposed.
     */
    private narrativeEndpointSelection;
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
    listParticipantEndpoints(participantId: string): {
        endpointId: string;
        platform: string;
        userId: string;
        enabled: boolean;
    }[];
    /** 解析故事的任一角色端点的 accountKey（供用户端点确定通道归属）。 */
    private resolveRoleAccountKey;
    /** 列出故事的全部角色端点（含在线状态）。 */
    listStoryEndpoints(storyId: string): {
        endpointId: string;
        platform: string;
        selfId: string;
        channelKind: import("./endpoints").EndpointChannelKind;
        enabled: boolean;
        online: boolean;
        lastInboundAt: number;
    }[];
    /** 入站反向解析（v3 §三）：accountKey → 端点行；未注册返回 undefined（回落旧路径）。 */
    resolveInboundEndpointFor(source: {
        platform: string;
        selfId: string;
        userId?: string;
        groupId?: string;
        channelId?: string;
    }): Promise<import("./endpoints").InboundResolution>;
    /** 条目通道上下文（v3 §十）：注册表命中才返回；未迁移/陌生账号不标注（单平台零影响）。 */
    private channelMetadataFor;
    /** 入站触达端点状态：连接在线 + 可投递 + 微信主动资格刷新（v3 §四）。 */
    private touchEndpointStateInbound;
    /** 将当前 Koishi bot 快照同步到已加载的端点注册表。
     * 这是重启后的实时连接证据，不会恢复历史快照中的 online 真值。
     */
    private syncCurrentBotConnections;
    /** 连接器在线状态回写（连接/断开事件；v3 §四 connection 维）。 */
    noteEndpointConnection(accountKey: string, online: boolean): void;
    private endpointDriftWarned;
    /**
     * M1a 出站地址解析（v3 §五）：注册表命中且启用时以注册表为准，并核对旧字段
     * （漂移只告警一次）；未命中/注册表未加载时回落旧字段——单平台零影响。
     * 同一 owner 多行时不再"取第一行"——优先最近观测过连接的端点，
     * 平手按 createdAt 稳定排序，并一次性告警（M2 起多端点归因的正确性基础）。
     */
    private endpointAddressSync;
    /** 出站结果回写端点状态（v3 §四 deliverable 维；内存无副作用）。
     * 提供 address 时只更新地址匹配的端点——多端点下不串刷兄弟端点。 */
    private noteEndpointOutbound;
    stop(): Promise<void>;
    private weatherSweep;
    private worldSeederSweepRunning;
    private worldSeederSweep;
    /** 上下文 payload：环境（时区/季节/世界设定）、历史剧本（压缩摘录）、
     * 关系网（拉黑名单）、主角所为（workingDetails + 场景/弧摘要）。 */
    private buildWorldSeederPayload;
    private worldSeederBlockedNames;
    /** 到期排水：claim-then-append，先进账的条目本回合 recentScript 即可见。
     * 低重要性只在推进/跟进回合注入，避免劫持对话回合。 */
    private drainDueSeededEvents;
    private compactStories;
    /** 复核退避/对话推迟会让 materializedDays 的 [今天,明天] 槽位缺失，窗口静默变空。
     * 取记录时若两个槽位都没有物化天，先本地无模型重物化（锚定今天）再算窗口。 */
    private currentSchedulePreplanWindow;
    private getSchedulePreplan;
    private longHorizonConfig;
    private longHorizonSweepRunning;
    private longHorizonLastScore;
    private longHorizonGenerationRunning;
    /** 生成失败/归一化拒绝后的冷却：无 active 指导时 first-trigger 恒为真，
     *  不加冷却会每个 sweep 重打一次模型（错误刷屏与 token 浪费的放大器）。 */
    private longHorizonGenerationCooldownUntil;
    /** Story ids whose active guidance row has already been loaded for this process. */
    private longHorizonGuidanceLoaded;
    private longHorizonSweep;
    private longHorizonProgress;
    private saveLongHorizonProgress;
    private getActiveLongArcGuidance;
    private ensureLongHorizonGuidanceLoaded;
    private longHorizonGenerate;
    private longHorizonInput;
    /** 主叙事注入用的裁剪投影：催化器只提供行动许可，不提供强制剧情。 */
    longHorizonPromptProjection(storyId: string): string | undefined;
    private activeLongArcGuidanceCache;
    private schedulePreplanEvidence;
    private saveSchedulePreplan;
    private prepareSchedulePreplanReview;
    /** Preplan has one small independent request instead of competing with
     * scene/fact compression. One recovery retry is cheap and covers providers
     * that occasionally omit an otherwise valid JSON object. */
    private requestSchedulePreplan;
    private persistSchedulePreplanReview;
    /** A visible reply already reached the user, so this retry may write only
     * the missing life script. It must never create a second transport message. */
    private scheduleStreamScriptRecovery;
    private persistStreamScriptRecovery;
    /** 手动/强制压缩的三阶段入口:Phase1 队列内快照,Phase2 队列外模型+embedding,
     * Phase3 队列内轻量落库——与后台调度器路径同构,不阻塞直播回合。 */
    private compactThreePhase;
    /** Everything up to the expensive compactor call: cheap reads plus the due
     * checks. Runs inside the story serial queue, but the model call itself must
     * not — a queued compactor request would delay the next live turn. */
    private prepareCompaction;
    /** Cheap DB persistence for one compaction decision. Re-acquires the story
     * serial queue in the caller so writes stay ordered with narrative turns. */
    private applyCompaction;
    /** Older state patches are compacted only by the background maintenance
     * lane. Live turns always retain the last few days as raw detail. */
    private compactOverlayUnlocked;
    private overlaySnapshotsForPrompt;
    /** Once a snapshot safely represents older changes, keep state.overlay as
     * the live (uncompacted) delta only. This is what actually reduces prompt
     * size; snapshots carry the older evolution separately. */
    private rebuildLiveOverlayState;
    private prepareCompactionEmbeddings;
    private persistCompaction;
    private persistCompactionOutputs;
    private persistFact;
    private embedText;
    private scheduleFactEmbeddingBackfill;
    private backfillFactEmbeddings;
    private persistStatePatch;
    private developmentForPrompt;
    private report;
    /** Emit an operational record only when the selected verbosity includes it.
     * Summary is for outcomes, standard is for scheduler/model activity, and
     * diagnostic is for skip reasons and internal counters. */
    private reportOperation;
    private writeReport;
    private reportStandalone;
    /** One Koishi log line per model call: token counts, cache hit rate and
     * optional billing from the per-connection price fields. */
    private reportTokenUsage;
    private reportStandaloneOperation;
    private writeStandalone;
    private resolveCompactionFacts;
    private markContinuityDirty;
    private emitLog;
    private reportBlindModeHealth;
    private allowsVerbosity;
    private getStory;
    /** 当前异步调用链正在其中执行的故事串行域(用于嵌套写路径判断"已在队列内,勿再排队")。 */
    private serialScope;
    private inSerial;
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
/** Detect record/audio segments from both Koishi elements and raw OneBot CQ
 * fallback without retaining the binary voice payload. */
export declare function extractSessionVoiceCount(session: Pick<Session, 'content'>): number;
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
export declare function extractSessionFileFacts(session: Session): SessionFileFact[];
/** 群聊入站没有原生附件通道：把 <img>/<file>/<record> 等元素标记转成事实
 * 占位（保留"发过什么"的信息），URL 污水不进群上下文，也不再被模型复述。 */
export declare function describeGroupAttachments(content: unknown): string;
/** 出站传输超时包装（rc50 issue 报告）：OneBot 实现不回应时把"永久挂起"
 * 变成有界等待，防止按故事串行的执行链被单次发送永久堵死。默认 30s 与
 * send_forward_msg 一致。与 withTimeout 的区别：超时错误带 `transport-timeout`
 * 标记与调用点标签——上层把它当作"结果未知"（账本记 pending 交由待投递
 * 补偿幂等收尾），而不是确定失败；迟到回执由 deliveryExecutionKey 去重。 */
export declare function withTransportTimeout<T>(promise: Promise<T>, label: string, timeoutMs?: number): Promise<T>;
/** Audio files arrive as original bytes (unlike SILK voice records). Accept
 * only formats the OpenAI-compatible input_audio channel documents. */
export declare function guessAudioFormat(bytes: Buffer, hintedName?: string): string;
/**
 * A model's willingness is an intent estimate, not a transport permission.
 * Native faces need a visible-text counterpart so a model cannot turn every
 * routine reply into a face merely by returning willingness=1. The 0.90 cap
 * deliberately makes thresholds above 0.90 an effective near-disable mode.
 */
export declare function calibratedNativeFaceWillingness(semantic: NativeFaceSemantic, willingness: unknown, replyContent: unknown): number;
/** The old punctuation-only id could collide (for example two filenames that
 * both normalize to bq--6-). Keep a readable path prefix, then append a
 * content hash fragment so every row is globally unique and stable for an
 * unchanged file. */
export declare function stableStickerAssetId(filePath: string, hash: string): string;
/** 表情包投递 URL：Koishi HTTP 路由 + assetId（OneBot 实现回源下载） */
export declare function stickerDeliveryUrl(base: string, assetId: string): string;
/** 表情包本地文件 URI：file:/// + 正斜杠绝对路径（Linux 与 Windows 盘符
 * 两种形态都产出三斜杠标准形；SnowLuma/NapCat 的图片段按 file:// 与
 * 含分隔符的本地路径解析，见 SnowLuma element-codecs 的 file 优先规则）。 */
export declare function stickerFileUrl(absolutePath: string): string;
/** Extract only explicit clock statements from a live user message. This is a
 * small factual aid, not an attempt to infer every temporal expression. */
export declare function extractUserReportedTimes(content: string, now: Date, timezone: string): UserReportedTime[];
export declare function describeQuotedMessage(session: Session, characterName?: string): QuotedMessageContext | undefined;
export declare function normalizeQuotedMessageContent(value: unknown): string;
export declare function normalizeAllowedReactions(value: unknown): ChatReactionName[];
/** Parse only the narrow event ledger shape. Unknown model fields and empty
 * plans are discarded before they can become a source of world state. */
export declare function normalizeTimelinePlan(value: unknown): TimelinePlan | undefined;
/** Human-readable diff of why a model plan was rejected, for the warn log. */
export declare function describeTimelinePlanRejection(value: unknown): string;
/** Automatic script prose is a rendering, not the next turn's temporal source.
 * A compact host ledger retains the real sequence without letting a previous
 * paragraph be copied into a new time window. */
export declare function timelineEntryPromptProjection(entry: ScriptEntry): ScriptEntry;
export declare function normalizeGroupChatActions(decision: NarrativeDecision, capabilities: ChatActionCapabilities | undefined, context: GroupContext): ExecutableGroupChatActions;
export declare function formatGroupSpeaker(senderName: string, senderId: string): string;
export declare function normalizeGroupVisibleReply(raw: NarrativeDecision['groupReply'], interaction: NarrativeDecision['interaction'], maxCharacters: number, separator?: string, splitEnabled?: boolean): string;
/** 无 participant 回合的 interaction 容错：群聊回合（user-message 且无 participant）
 * 把 immediate 的 interaction 回复提升为 groupReply 参与提交与投递——简洁协议把
 * interaction 形态写在最前，弱模型常在群聊照抄私聊形态。不提升时 commit-builder
 * 会为无 participant 的 interaction 生成 outgoing-message 事件，结构校验失败导致
 * 整回合静默。其余无 participant 相位（advance 等）本无回复通道，携带内容的
 * interaction 一律剥离，同样避免校验失败。 */
export declare function hoistParticipantlessInteraction<T extends NarrativeDecision>(decision: T, phase: NarrativeRequest['phase']): T;
export declare function requiresVisibleReplyRecovery(phase: NarrativeRequest['phase'], groupContext: GroupContext | undefined, decision: NarrativeDecision): boolean;
export declare function visibleReplyMode(decision: NarrativeDecision, phase: NarrativeRequest['phase'], groupContext?: GroupContext): string;
export declare function sanitizeAndClampVisibleContent(value: unknown, maxCharacters: number, separator?: string): string;
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
/** 模型偶发把 script 输出成对象（{tag,content} / {entries:[…]}，形态模仿
 * recentScript 的载荷结构）。散文完整，做无损归一而非弃稿：对象直取散文键、
 * entries 按序拼接、顶层数组同法。归一发生在 no-usable-script 闸门之前
 * （decide() 返回链），normalizeDecision 内再兜一道。 */
export declare function normalizeScriptField(raw: unknown): string;
export declare function hasRequiredNarrativeScript(value: NarrativeDecision | undefined | null): boolean;
export declare function resolveBlindModeConfig(value?: Partial<BlindModeConfig>): BlindModeConfig;
/** Scene compaction may update a tiny roster only with explicit observed
 * evidence. This keeps named supporting cast available without treating them
 * as automatically present. */
export declare function normalizeScenePresenceDrafts(value: unknown, entries: ScriptEntry[], now?: Date): ScenePresenceState[];
export declare function normalizeDecision(raw: NarrativeDecision, from: Date, now: Date, permitMessages: boolean, runtime: RuntimeConfig, shared: SharedStoryConfig, currentParticipantId: string, permittedParticipantIds: Set<string>, permittedGroupIds: Set<string>, phase?: NarrativeRequest['phase'], memory?: MemoryConfig, refreshContinuity?: boolean): {
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
    agencyWindow: Partial<AgencyWindowState>;
    proactiveContact: ProactiveContactDraft & Record<string, unknown>;
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
    intents: {
        participantId: string;
        type: string;
        summary: string;
        notBefore: string;
        payload?: Record<string, unknown>;
    }[];
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
export declare function normalizeInteraction(value: unknown, now: Date, runtime: RuntimeConfig): NarrativeInteraction | undefined;
type NormalizedIntentUpdate = {
    id: number;
    status: 'completed' | 'cancelled';
    resolution?: string;
};
/** 解析层被意愿门丢弃的合法主动行动的信息（供 withdrawn 账本补偿记录）。
 * 只捕获"目标在白名单、内容非空、仅因 willingness 缺失/低于阈值或 delayed
 * 时间越界被丢"的行动；目标不合法/内容为空的丢弃与历史行为一致保持静默
 * （没有可记账的收件人，也不该把未过白名单的内容写进历史）。 */
export declare function droppedProactiveActionInfo(value: unknown, runtime: RuntimeConfig, permittedParticipantIds: Set<string>, currentParticipantId: string): {
    participantId: string;
    mode: "immediate" | "delayed";
    content: string;
    reason: string;
};
/** Keeps a single due-turn private to one relationship while ensuring that
 * every plan that was already due at the start of the sweep gets a chance to
 * be judged before the next sweep interval. */
export declare function groupDueIntents(intents: NarrativeIntent[]): NarrativeIntent[][];
export declare function shouldSupersedeNarrativeRequest(inFlightRequestId: number | undefined, firstMessageCommittedRequestId: number | undefined, obsoleteRequestIds: ReadonlySet<number>): boolean;
/** Minato normally materializes timestamp columns as Date objects. Some
 * drivers and hot-reload paths can return ISO strings, so normalize every row
 * crossing the service boundary before time arithmetic or prompt building. */
export declare function normalizeDatabaseRow(table: string, value: unknown): any;
/** Literal recall lane shared by raw script and durable facts. Chinese
 * bigrams preserve useful names and objects without requiring word splitting. */
export declare function historyLexicalScore(query: string, content: string): number;
/** How many sticker descriptions a semantically filtered turn injects. */
export declare const SEMANTIC_STICKER_LIMIT = 12;
/** Pure ranking used by the semantic sticker filter. Assets without a vector
 * still fill remaining slots after the embedded ones so a half-indexed library
 * degrades gracefully instead of hiding entries. */
export declare function rankStickerCatalog<T extends {
    embedding?: number[];
}>(assets: T[], queryEmbedding: number[], limit: number): T[];
/** Only static raster images worth the re-render enter Puppeteer downscaling:
 * tiny images would not shrink further and animated ones have their own path. */
export declare function shouldDownscaleImage(mimeType: string, dataUri: string): boolean;
export declare function detectLiveScriptTimeOverflow(script: unknown, phase: NarrativeRequest['phase'], from: Date, now: Date, timezone: string, endorsedClocks?: ReadonlySet<number>): string;
export {};
