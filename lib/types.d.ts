export type StoryStatus = 'active' | 'paused' | 'archived';
/** 生活节奏五档：Urge 推进密度的乘法因子输入。由压缩器/主叙事/入站事件
 * 判定，planUrge 消费；与 lifeStatus 三值并存（后者服务群聊意愿 auto 档）。 */
export type LifeRhythmAttention = 'phone-focused' | 'available' | 'occupied' | 'resting' | 'asleep';
export interface CharacterSetting {
    name: string;
    profile: string;
}
export interface StorySetting {
    /**
     * 初始 canon：只由显式配置修改。模型引起的长期变化应写入
     * StoryState.settingOverlay，避免一次生成把人物设定直接改写。
     */
    character: CharacterSetting;
    user: {
        displayName: string;
        profile: string;
    };
    relationship: string;
    world: string;
    /** Independent outer layer: the protagonist's values and way of seeing the world. */
    perspective: string;
    /** Multiple independent perspective entries; each stays a separate prompt item. */
    perspectives?: string[];
    /** Supplementary facts: complex world/character/relationship truths seeded as initial durable facts. */
    supplementaryFacts?: string[];
    supportingCast: string;
    location: string;
    style: string;
    timezone: string;
}
export interface StoryState {
    /** Versioned by src/story-state.ts. Legacy beta10 rows are version 0. */
    schemaVersion?: number;
    /** Unknown future top-level values survive an older runtime's read/write cycle here. */
    extensions?: Record<string, unknown>;
    /** Evolving overlay. The original setting remains the story's canon/base. */
    settingOverlay: StorySettingOverlay;
    activeSceneId?: number;
    activeArcId?: number;
    /** Low-frequency continuity note refreshed on the first auto pass and then after every 15 successful narrative updates. */
    continuitySnapshot?: ContinuitySnapshot;
    narrativeUpdateCount: number;
    lastContinuityUpdateAt?: string;
    /** Forces the next successful narrative write to rebuild continuity. */
    continuityDirty?: boolean;
    /** 自动推进时钟；ISO 字符串便于跨进程/数据库 JSON 持久化。 */
    automation: StoryAutomationState;
    alterSystem?: AlterSystemState;
    agencyWindow?: AgencyWindowState;
    /** Small, evidence-backed roster emitted only by scene compaction. */
    scenePresence?: ScenePresenceState[];
    /** Recent completed background deliveries; hidden from live user turns. */
    automaticDeliverySummaries?: AutomaticDeliverySummary[];
    /** Small concrete in-flight details (codes, orders, errands) captured by scene
     * compaction; they expire naturally and never modify canon. */
    workingDetails?: WorkingDetail[];
    /** Source revisions prevent a delayed background review reopening settled details. */
    workingDetailResolutions?: Record<string, number>;
    /** 主动联系审计窗（最近 20 条）：每参与者每日上限的计数来源，不进模型上下文。
     * ref 关联放行时的投递草稿；投递终态失败时置 voided，不再消耗每日配额。 */
    proactiveContactLog?: Array<{
        participantId: string;
        at: string;
        endpointId?: string;
        channelReason?: string;
        ref?: string;
        voided?: boolean;
    }>;
    /** 压缩器写入的主角注意力状态（busy/asleep/idle）；群聊意愿 auto 档读取。 */
    lifeStatus?: {
        status: 'busy' | 'asleep' | 'idle';
        updatedAt: string;
    };
    /** 生活节奏五档（压缩器主写/主叙事与入站可覆盖）：Urge 推进密度的乘法因子。
     * 过期（>2h）视为 stale，退回 restWindows 兜底。 */
    lifeRhythm?: {
        attention: LifeRhythmAttention;
        basis: string;
        assessedAt: string;
        source: 'compactor' | 'narrator' | 'incoming' | 'fallback';
    };
    /** Host-owned unresolved state carried forward from the latest completed
     * automatic event ledger. This outranks prose-derived scratchpad wording. */
    timelineCarry?: string[];
    /** Host-measured texting-rhythm state; surfaced to narration as the
     * protagonist's own expression habits, never as a system directive. */
    chatRhythm?: ChatRhythmState;
    /** M4 materialized view of the current scene. Every derived value carries entry provenance. */
    sceneFrame?: SceneFrame;
    /** Conversation continuity inside one scene; elapsed time never changes its identity. */
    dialogueBurst?: DialogueBurstState;
}
export type SceneFrameField = 'place' | 'presentPeople' | 'ongoingActivity' | 'postureOrMotion' | 'attention' | 'deviceAccess' | 'privacy' | 'affectiveBaseline' | 'openMotions' | 'openTopics' | 'narrativeFocus';
export interface SceneFrame {
    id: string;
    localBoundaryEntryId?: number;
    sceneId?: number;
    place?: string;
    presentPeople: string[];
    ongoingActivity?: string;
    postureOrMotion?: string;
    attention?: string;
    deviceAccess?: string;
    privacy?: string;
    affectiveBaseline?: string;
    openMotions: string[];
    openTopics: string[];
    narrativeFocus?: string;
    /** Union of every source below; kept for compact validation and retrieval. */
    sourceEntryIds: number[];
    sources: Partial<Record<SceneFrameField, number[]>>;
    updatedAt: string;
}
export interface DialogueBurstState {
    id: string;
    frameId: string;
    startedAt: string;
    sourceEntryIds: number[];
    lastEventId?: string;
    /** Hashed relationship/group/life scope; raw private identifiers never enter shared state. */
    scopeKey?: string;
    /** Hashed lexical keys used only to notice a genuine topic discontinuity. */
    topicKeys?: string[];
}
/** A tiny structured scratchpad entry. Not a durable fact: it exists to carry
 * small concrete details across the compaction boundary and then expire. */
export interface WorkingDetail {
    participantId?: string;
    knowledge?: import('./script/knowledge-evidence').KnowledgeEvidence;
    label: string;
    value: string;
    /** Strictly-future ISO-8601; expired details are pruned at injection time. */
    expiresAt?: string;
    createdAt: string;
    sourceEntryIds?: number[];
}
export type ScenePresenceStatus = 'present' | 'off-scene' | 'expected';
export interface ScenePresenceState {
    name: string;
    status: ScenePresenceStatus;
    basis: string;
    sourceEntryIds: number[];
    updatedAt: string;
}
/** A bounded action-level reminder, never a second copy of chat history. */
export interface AutomaticDeliverySummary {
    participantId: string;
    summary: string;
    sourceEntryId?: number;
    deliveredAt: string;
}
export type SchedulePreplanBlockKind = 'fixed' | 'routine' | 'flexible' | 'open';
export type SchedulePreplanWeekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export interface SchedulePreplanBlock {
    id: string;
    start: string;
    end: string;
    label: string;
    kind: SchedulePreplanBlockKind;
    location?: string;
    /** A granular-mode possibility, never a confirmed appointment. The host
     * reveals it only close to its slot and never lets it anchor time. */
    tentative?: boolean;
    sourceEntryIds?: number[];
}
export interface SchedulePreplanRegime {
    id: string;
    label: string;
    from: string;
    to?: string;
    weekly: Partial<Record<SchedulePreplanWeekday, SchedulePreplanBlock[]>>;
    sourceEntryIds?: number[];
}
export interface SchedulePreplanException {
    date: string;
    mode: 'replace' | 'patch';
    reason: string;
    removeBlockIds?: string[];
    blocks?: SchedulePreplanBlock[];
    sourceEntryIds?: number[];
}
export interface SchedulePreplanDay {
    date: string;
    blocks: SchedulePreplanBlock[];
}
/** 世界事件播种器排程行：模型生成、宿主校验入库、到点注入为 world-event 条目。 */
export interface SeededWorldEvent {
    id: number;
    storyId: string;
    summary: string;
    importance: 'low' | 'medium' | 'high';
    occursAt: Date;
    expiresAt?: Date;
    status: 'scheduled' | 'injected' | 'expired' | 'dropped';
    subjects: string[];
    sourcePayload: Record<string, unknown>;
    injectedEntryId?: number;
    createdAt: Date;
    updatedAt: Date;
}
export interface SchedulePreplanRecord {
    storyId: string;
    revision: number;
    timezone: string;
    validFrom: string;
    validThrough: string;
    lastReviewedLocalDate: string;
    lastEvidenceEntryId: number;
    reviewReason: string;
    regimes: SchedulePreplanRegime[];
    exceptions: SchedulePreplanException[];
    materializedDays: SchedulePreplanDay[];
    createdAt: Date;
    updatedAt: Date;
}
export interface SchedulePreplanProposal {
    outcome: 'unchanged' | 'extend' | 'patch' | 'replace';
    reason: string;
    confidence?: number;
    sourceEntryIds?: number[];
    regimes?: SchedulePreplanRegime[];
    exceptions?: SchedulePreplanException[];
}
export interface SchedulePreplanReviewRequest {
    localDate: string;
    horizonDays: number;
    variationLevel?: 'stable' | 'contextual' | 'granular';
    current: SchedulePreplanRecord | null;
    evidenceEntries: ScriptEntry[];
}
export interface SchedulePreplanWindow {
    name: 'Schedule Preplan';
    timezone: string;
    from: string;
    to: string;
    plannedNotObserved: true;
    revision: number;
    blocks: Array<SchedulePreplanBlock & {
        date: string;
    }>;
}
/** Compact replace-in-place reminder of the protagonist's current state and notable threads. */
export interface ContinuitySnapshot {
    current: string;
    next: string[];
    recent: string[];
    salient: string[];
}
/**
 * One character can maintain several relationships in the same main story.
 * This state belongs to one real person / account, rather than to the whole
 * world, so one conversation cannot accidentally overwrite another person's
 * relationship notes or pending messages.
 */
export interface ParticipantState {
    openThreads: string[];
    relationshipNotes: string[];
    relationshipOverlay?: string;
    unreadMessageCount: number;
    pendingReplyCount: number;
    lastUserMessageAt?: string;
    lastCharacterMessageAt?: string;
}
export interface StoryAutomationState {
    /** 对话活跃期结束时间；在此之前只处理必要的到期意图，不补写日常生活。 */
    quietUntil?: string;
    /** 下一次自动生活补写的最早时间。 */
    nextAdvanceAt?: string;
    /** Retry gate for a failed automatic timeline window. Persisted so a
     * provider failure cannot re-enter the narrator on every background sweep
     * or immediately recur after a process restart. */
    timelineRetryAt?: string;
    timelineRetryFrom?: string;
    timelineDirectorFailures?: number;
    lastAutoAdvanceAt?: string;
    lastUserMessageAt?: string;
    /** Short continuity passes scheduled from the latest conversation endpoint. */
    conversationFollowUpAt?: string[];
    /** Relationship branch whose recent conversation supplies the 10/20-minute
     * continuity context. Omitted for ordinary background advancement. */
    conversationFollowUpParticipantId?: string;
}
export type AgencyActivityLoad = 'free' | 'occupied' | 'overloaded';
export type AgencyPrivacy = 'private' | 'shared' | 'public';
export type AgencyDeviceAccess = 'available' | 'limited' | 'unavailable';
export interface AgencyWindowState {
    activityLoad: AgencyActivityLoad;
    privacy: AgencyPrivacy;
    deviceAccess: AgencyDeviceAccess;
    nextOpportunityAt?: string;
    validUntil: string;
    basis: string;
    sourceEntryIds: number[];
    updatedAt: string;
}
export type ProactiveContactOrigin = 'life-event' | 'promise' | 'practical-update' | 'relationship-follow-up';
export type ProactiveDisclosure = 'ordinary' | 'personal';
export type ProactiveOutcome = 'send-now' | 'recheck-later' | 'let-go';
export interface ProactiveContactDraft {
    participantId: string;
    origin: ProactiveContactOrigin;
    motive: string;
    disclosure: ProactiveDisclosure;
    sourceEntryIds?: number[];
    willingness?: number;
    outcome: ProactiveOutcome;
    notBefore?: string;
    expiresAt?: string;
}
export interface AgencyConfig {
    enabled: boolean;
    maxWindowMinutes: number;
    minimumProactiveIntervalMinutes: number;
    maxCandidateHours: number;
    /** 主动联系温度：strict=现状（字节不变）；natural/balanced 放宽动机教义、
     * 意愿阈值与安全间隔。容量门（设备/隐私/负荷）三模式全保。 */
    contactMode?: 'strict' | 'natural' | 'balanced';
    /** 非严格模式的意愿阈值（默认 0.25）。 */
    naturalWillingnessThreshold?: number;
    /** 非严格模式的安全间隔分钟（默认 30；仅当小于严格间隔时生效）。 */
    naturalMinimumIntervalMinutes?: number;
    /** 每参与者每 24 小时主动联系上限，全模式生效（默认 3；0 = 不限）。 */
    proactiveDailyCap?: number;
}
export interface StorySettingOverlay {
    characterProfile?: string;
    /** Current accumulated expression of the separate perspective layer. */
    perspective?: string;
    relationship?: string;
    world?: string;
    /** Small, accumulated trait changes expressed as evidence-backed notes. */
    characterTraits?: string[];
}
export interface InterludeStory {
    id: string;
    platform: string;
    selfId: string;
    userId: string;
    channelId: string;
    status: StoryStatus;
    setting: StorySetting;
    state: StoryState;
    cursorAt: Date;
    createdAt: Date;
    updatedAt: Date;
}
/** A private-message endpoint and its relationship branch inside one story. */
export interface InterludeParticipant {
    id: string;
    storyId: string;
    platform: string;
    selfId: string;
    userId: string;
    channelId: string;
    /** Multiple accounts may deliberately share the same real-person id. */
    personId: string;
    displayName: string;
    profile: string;
    relationship: string;
    state: ParticipantState;
    status: 'active' | 'paused';
    createdAt: Date;
    updatedAt: Date;
}
export interface ScriptEntry {
    id: number;
    storyId: string;
    /** Empty for world/system events; otherwise identifies the involved account. */
    participantId: string;
    kind: string;
    actor: string;
    content: string;
    occurredAt: Date;
    metadata: Record<string, unknown>;
    /** Optional semantic vector for history recall; empty until the backfill reaches this entry. */
    embedding?: number[];
    createdAt: Date;
}
export interface NarrativeMemory {
    id: number;
    storyId: string;
    participantId: string;
    category: string;
    content: string;
    importance: number;
    status: string;
    sourceEntryId: number | null;
    createdAt: Date;
    updatedAt: Date;
}
export type SceneStatus = 'active' | 'closed';
export interface InterludeScene {
    id: number;
    storyId: string;
    status: SceneStatus;
    startedAt: Date;
    endedAt: Date | null;
    hook: string;
    summary: string;
    entryCount: number;
    /** 最近一次已经被写入场景摘要的条目；下一轮只压缩它之后的新内容。 */
    lastEntryId: number | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface InterludeArc {
    id: number;
    storyId: string;
    status: 'active' | 'closed';
    title: string;
    summary: string;
    sceneCount: number;
    createdAt: Date;
    updatedAt: Date;
}
export type StatePatchTarget = 'character' | 'perspective' | 'world' | 'relationship';
export type StatePatchStatus = 'proposed' | 'applied' | 'compacted' | 'rejected' | 'cleared';
export interface StatePatchProposal {
    /**
     * 压缩器提出、插件审核的变化，而不是对 canon 的直接写入。
     * 保留证据和状态可支持审计、人工确认与日后的重新评估。
     */
    id: number;
    storyId: string;
    participantId: string;
    target: StatePatchTarget;
    path: string;
    proposedValue: string;
    evidence: string;
    confidence: number;
    impact: 'minor' | 'major';
    status: StatePatchStatus;
    sourceEntryIds: number[];
    createdAt: Date;
    appliedAt: Date | null;
}
/** A compressed, auditable layer of setting evolution. Raw applied patches
 * remain intact and are only marked compacted after a snapshot is stored. */
export interface OverlaySnapshot {
    id: number;
    storyId: string;
    participantId: string;
    target: StatePatchTarget;
    /** Kept as weekly/monthly for database compatibility; runtime windows are
     * five days and ten days respectively. */
    tier: 'weekly' | 'monthly';
    periodStart: Date;
    periodEnd: Date;
    summary: string;
    majorEvents: string[];
    sourcePatchIds: number[];
    status: 'active' | 'superseded';
    createdAt: Date;
    updatedAt: Date;
}
export interface NarrativeFact {
    knowledge?: import('./script/knowledge-evidence').KnowledgeEvidence;
    id: number;
    storyId: string;
    /**
     * Legacy database compatibility only. New facts are global narrative
     * material and their related people must be named in `content`; this field
     * no longer controls visibility, ownership, or narrative scope.
     */
    participantId: string;
    scope: 'character' | 'world' | 'relationship' | 'event' | 'promise';
    content: string;
    importance: number;
    confidence: number;
    unresolved: boolean;
    embedding?: number[];
    status: 'active' | 'superseded';
    sourceEntryIds: number[];
    lastSeenAt: Date;
    createdAt: Date;
    updatedAt: Date;
}
export type IntentStatus = 'pending' | 'completed' | 'cancelled';
export interface NarrativeIntent {
    id: number;
    storyId: string;
    /** Target private-message relationship for a future contact. */
    participantId: string;
    type: string;
    summary: string;
    notBefore: Date;
    status: IntentStatus;
    payload: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
/** A bounded, read-only observation collected through Koishi Puppeteer.
 * Web pages are untrusted source material: only the extracted text below is
 * sent back to the narrator, never page HTML, scripts, cookies, or actions. */
export interface WebObservation {
    id: number;
    storyId: string;
    /** Empty means a world-level observation; otherwise it belongs to one relationship. */
    participantId: string;
    intentId: number | null;
    mode: 'search' | 'visit';
    query: string;
    url: string;
    title: string;
    excerpt: string;
    summary: string;
    status: 'success' | 'failed' | 'blocked' | 'deleted';
    accessedAt: Date;
    createdAt: Date;
}
export interface ScriptEntryDraft {
    kind: string;
    actor?: string;
    content: string;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
}
export interface MemoryDraft {
    category: string;
    content: string;
    importance?: number;
    participantId?: string;
}
export interface IntentDraft {
    type: string;
    summary: string;
    notBefore: string;
    payload?: Record<string, unknown>;
    participantId?: string;
}
/** A narrator may close an active narrative consequence once the script has
 * naturally absorbed it. Scheduled intents complete through their due-turn
 * path, so this is deliberately limited to existing persistent context. */
export interface IntentUpdateDraft {
    id: number;
    status: 'completed' | 'cancelled';
    resolution?: string;
}
export interface OutgoingMessageDraft {
    participantId: string;
    content: string;
    /** Optional typ-0 correlation copied into persisted delayed/split intents. */
    traceId?: string;
    processingId?: string;
    /** M3 §八：出站端点——省略 = 本回合来源端点（由 resolveDeliveryTarget 兜底）。 */
    endpointId?: string;
    /** Attached only to no-current-user background deliveries. */
    automaticDelivery?: Pick<AutomaticDeliverySummary, 'summary' | 'sourceEntryId'>;
    /** The visible reply contract is recorded only after transport succeeds. */
    interaction?: NarrativeInteraction | null;
    /** Split bubbles are scheduled only after their first bubble was delivered. */
    laterSegments?: string[];
    /** Lets a failed delivery explain whether it originated in a live user turn. */
    userInitiated?: boolean;
    /** Agency 放行的主动联系在放行时预记入 proactiveContactLog（ref 关联）；
     * 投递终态失败时宿主按 ref 作废该条计数。 */
    proactiveContactRef?: string;
    /** Set by transport when a literal quote was converted into a platform reply. */
    quoteMessageId?: string;
    /** Stable link back to the one script event that authored all bubbles. */
    scriptEvent?: import('./script/contract').ScriptMessageEventReference;
}
/** A future browsing action proposed by the narrator. It is not an observed
 * fact until Puppeteer finishes and produces a WebObservation. */
export interface BrowserIntentDraft {
    mode: 'search' | 'visit';
    query?: string;
    url?: string;
    purpose: string;
    timing?: 'deferred' | 'immediate';
    participantId?: string;
}
/** A message to another relationship branch generated in the same writing turn. */
export interface ConversationActionDraft {
    actionId?: string;
    participantId: string;
    mode: 'immediate' | 'delayed';
    content: string;
    sendAt?: string;
    /** M3 §八：模型可选渠道——省略时由最近活跃端点解析（渠道选择审计）。 */
    endpointId?: string;
    /** 0..1: how strongly the protagonist actually wants to initiate contact now. */
    willingness?: number;
    /** Short audit note explaining the concrete reason for this contact. */
    reason?: string;
}
export type InteractionReplyMode = 'none' | 'immediate' | 'delayed';
export interface NarrativeInteraction {
    seen: boolean;
    reply: {
        mode: InteractionReplyMode;
        content?: string;
        actionId?: string;
        sendAt?: string;
        /** Opaque current-turn message reference; accepted only when the host advertises quote reply. */
        replyTo?: string;
    };
}
/** Host-owned channel facts supplied to the writer for one narrative turn.
 * These values are routing/evidence metadata, not dialogue or story prose. */
export interface NarrativeChannelData {
    turnSources?: Array<{
        endpointId: string;
        channelKind: 'qq' | 'wechat';
        receivedSeq: number;
    }>;
    /** True only when the currently flushed debounce batch contains multiple endpoints. */
    batchMultiEndpoint?: boolean;
    lastEntryChannel?: {
        endpointId?: string;
        channelKind?: 'qq' | 'wechat';
        conversationKind?: 'private' | 'group';
    };
    currentChannel?: {
        endpointId?: string;
        channelKind?: 'qq' | 'wechat';
        conversationKind?: 'private' | 'group';
    };
    replyEndpoint?: {
        endpointId?: string;
        channelKind?: 'qq' | 'wechat';
    };
}
/** Host-filtered transport choice exposed only when multiple channel kinds
 * are active. endpointId is opaque and may only be copied from this list. */
export interface NarrativeEndpointOption {
    endpointId: string;
    targetId: string;
    targetKind: 'participant' | 'group';
    channelKind: 'qq' | 'wechat';
    conversationKind: 'private' | 'group';
    online: boolean;
}
/** A complete transport field decoded before the streamed narrative script. */
export interface EarlyNarrativeReply {
    kind: 'private' | 'group';
    content: string;
    interaction?: NarrativeInteraction;
    groupReply?: {
        mode: 'immediate';
        content: string;
        replyTo?: string;
    };
}
export type ChatReactionName = 'like' | 'smile' | 'laugh' | 'heart' | 'surprised' | 'sad' | 'angry';
export type NativeFaceSemantic = 'smile' | 'laugh' | 'sweat' | 'awkward' | 'heart' | 'surprised' | 'sad' | 'angry';
/** Capabilities are transient and appear in a prompt only after both Console
 * configuration and a live platform connector allow them. */
export interface ChatActionCapabilities {
    platform: 'qq' | 'wechat';
    quoteReply: boolean;
    reactions: ChatReactionName[];
    nativeFaces?: NativeFaceSemantic[];
    expressionThreshold?: number;
}
export interface MessageReactionDraft {
    messageRef: string;
    reaction: ChatReactionName;
}
export interface StickerCatalogEntry {
    assetId: string;
    group: string;
    description: string;
    aliases: string[];
    animated: boolean;
}
export interface LocalMediaDraft {
    assetId: string;
    placement?: 'standalone' | 'after-text';
    willingness?: number;
}
export interface NativeFaceDraft {
    semantic: NativeFaceSemantic;
    willingness: number;
}
export interface StickerAsset {
    id: number;
    assetId: string;
    filePath: string;
    group: string;
    mimeType: string;
    animated: boolean;
    size: number;
    hash: string;
    description: string;
    aliases: string[];
    status: 'pending' | 'active' | 'missing';
    /** Optional semantic vector for catalog filtering; empty until the Embedding backfill reaches this asset. */
    embedding?: number[];
    createdAt: Date;
    updatedAt: Date;
}
/** A bounded snapshot of the message explicitly quoted by the incoming turn. */
export interface QuotedMessageContext {
    senderId: string;
    senderName: string;
    speaker: string;
    content: string;
}
export interface IndexedQuotedMessageContext extends QuotedMessageContext {
    messageIndex: number;
}
export type FollowUpCommitmentKind = 'thinking' | 'checking' | 'decision' | 'emotional-settle';
/** A user-facing promise to return with an answer; persisted as an existing intent row. */
export interface FollowUpCommitmentDraft {
    kind: FollowUpCommitmentKind;
    summary: string;
    notBefore: string;
    expiresAt?: string;
    sourceEntryIds?: number[];
}
export interface FollowUpResolutionDraft {
    id: number;
    outcome: 'fulfilled' | 'rescheduled' | 'cancelled';
    notBefore?: string;
}
export interface NarrativeDecision {
    urge?: unknown;
    /** The continuous prose written by the main narrative model. */
    script?: string;
    /** Host-resolved literal speech spans; never an independent answer. */
    authoredActions?: import('./script/authored-actions').AuthoredAction[];
    lifeHandoff?: import('./script/life-handoff').LifeHandoff;
    /** Net atmosphere movement introduced by this turn: -5 relaxed, +5 serious. */
    alter?: number;
    /** Optional external-action capacity update; it never controls prose style. */
    agencyWindow?: Partial<AgencyWindowState>;
    /** Optional life-grounded contact decision for advance/proactive-check turns. */
    proactiveContact?: ProactiveContactDraft;
    /** Present only when the request explicitly asks for a low-frequency continuity refresh. */
    continuity?: ContinuitySnapshot;
    /** The machine-readable result placed after the prose. */
    interaction?: NarrativeInteraction;
    /** Required when a visible user-turn reply promises a later answer. */
    followUpCommitment?: FollowUpCommitmentDraft;
    /** Resolves a visible pending commitment on a live or due turn. */
    followUpResolutions?: FollowUpResolutionDraft[];
    /** Required only for an immediate background delivery; it records the newly communicated delta. */
    automaticDeliverySummary?: string;
    memories?: MemoryDraft[];
    intents?: IntentDraft[];
    /** Resolves existing active-consequence intents visible in this turn. */
    intentUpdates?: IntentUpdateDraft[];
    browserIntents?: BrowserIntentDraft[];
    /** Applies to the current participant only; world state uses compaction proposals. */
    statePatch?: Partial<ParticipantState>;
    /** Optional outbound actions aimed at other accounts in the same main story. */
    crossConversationActions?: ConversationActionDraft[];
    /** advance 相位被解析层意愿门丢弃的主动行动（目标合法、内容非空但
     * willingness 缺失/低于阈值，或 delayed 时间越界）。它们从未进入
     * crossConversationActions，无事件无账本；在此显式携带供 withdrawn
     * 账本补偿，避免"剧本已说但从未发出"的幻影。 */
    droppedProactiveActions?: Array<{
        participantId: string;
        mode: 'immediate' | 'delayed';
        content: string;
        reason: string;
    }>;
    /** Optional visible reply to the configured OneBot group that caused this turn. */
    groupReply?: {
        mode: 'none' | 'immediate';
        content?: string;
        actionId?: string;
        /** Opaque reference selected from the current groupContext only. */
        replyTo?: string;
    };
    /** At most one validated reaction is executed in the current implementation. */
    messageReactions?: MessageReactionDraft[];
    /** Exact local sticker selected from the transient catalog for this live turn. */
    localMedia?: LocalMediaDraft;
    /** One optional semantic QQ native-face expression for the current live reply. */
    nativeFace?: NativeFaceDraft;
}
export type NarrativePhase = 'advance' | 'conversation-follow-up' | 'user-message' | 'intent-due';
/** A transient native-vision attachment for the current private-message turn.
 * It is intentionally never persisted in script entries, memories, or facts. */
export interface NarrativeImage {
    id: string;
    mimeType: string;
    dataUri: string;
}
/** A native image recovered from a recent group message. The source metadata
 * stays outside the persisted script row; only the transient model attachment
 * carries image bytes. */
export interface NarrativeHistoricalImage extends NarrativeImage {
    sourceEntryId: number;
    senderId: string;
    senderName: string;
    occurredAt: Date;
    messageId?: string;
}
/** A transient native-audio attachment for the current private-message turn.
 * The payload is a SnowLuma server-side transcode of the QQ voice record; it
 * is intentionally never persisted in script entries, memories, or facts. */
export interface NarrativeAudio {
    id: string;
    /** OpenAI-compatible input_audio format token, e.g. 'mp3'. */
    format: string;
    base64: string;
}
export interface NarrativeRequest {
    urgeEnabled?: boolean;
    contactThreads?: import('./script/knowledge-evidence').ContactEvidenceThread[];
    /** 主模型只读取经过预算控制的连续性包，不读取完整历史。 */
    phase: NarrativePhase;
    /** Refresh the compact continuity note on this turn. */
    refreshContinuity?: boolean;
    /** A prior unpublished draft omitted its required visible-reply structure. */
    outputRecovery?: boolean;
    story: InterludeStory;
    from: Date;
    now: Date;
    userMessage?: string;
    /** Explicit clock references stated by the user in this one message. They
     * describe reported past/future events, not the message receive time. */
    userReportedTimes?: UserReportedTime[];
    /** Native image inputs observed in this one incoming user event only. */
    images?: NarrativeImage[];
    /** Native audio inputs observed in this one incoming user event only. */
    audio?: NarrativeAudio[];
    /** Recent group images recovered from earlier group-message entries. These
     * are historical evidence, not a new user event or instruction. */
    historicalGroupImages?: NarrativeHistoricalImage[];
    /** Text-only observations produced by a separately configured visual model.
     * They are transient current-event context and never enter script storage. */
    visualObservations?: string[];
    /** Host-validated event plan for an automatic window. Prose renders this plan
     * but is no longer the source of temporal truth. */
    timelinePlan?: TimelinePlan;
    /** Latest host-owned unresolved state from previously completed automatic beats. */
    timelineCarry?: string[];
    /** The relationship that caused this turn; null for unattended life updates. */
    participant: InterludeParticipant | null;
    /** Other currently enrolled relationship branches, ordered by relevance. */
    participants: InterludeParticipant[];
    /** Public routing hints only; not group history or proof of delivery. */
    availableGroupTargets?: Array<{
        participantId: string;
        groupId: string;
        label: string;
    }>;
    /** Host-filtered transport choices; omitted in single-platform mode. */
    availableOutgoingEndpoints?: NarrativeEndpointOption[];
    /** Enabled when the story has usable endpoints on multiple channel kinds. */
    channelSelectionEnabled?: boolean;
    /** Phase 3（§7）：长线叙事指导的裁剪投影（soft constraint 文本）。 */
    longHorizonGuidance?: string;
    /** Sensitive details of other participants are opt-in because the model may be remote. */
    shareParticipantDetails: boolean;
    dueIntents: NarrativeIntent[];
    /** Bounded, host-owned future plans; continuity no longer duplicates them as free text. */
    upcomingIntents?: NarrativeIntent[];
    /** Consequences already in motion. They are context, never newly due events. */
    activeConsequences: NarrativeIntent[];
    supersededIntents: NarrativeIntent[];
    recentEntries: ScriptEntry[];
    /** 主动联系温度（宿主配置直通提示词教义；strict/undefined = 现状）。 */
    proactiveContactMode?: 'strict' | 'natural' | 'balanced';
    /** Executable writing affordances; prompt and host share the same switches. */
    writingOptions?: {
        messageSeparator: string;
        splitReplyMessages: boolean;
        browserMode: 'disabled' | 'deferred-only' | 'allow-immediate';
        /** Host-detected fixed bubble-count run in her recent delivered replies; conversation turns only. */
        messageRepetition?: {
            bubbles: number;
            consecutive: number;
        };
    };
    /** Raw chat entries at or after this point survive the normal prose budget. */
    recentProtectionSince?: Date;
    memories: NarrativeMemory[];
    sceneContext?: SceneContext;
    facts?: NarrativeFact[];
    /** Older setting evolution, separated from the live three-day overlay. */
    overlaySnapshots?: OverlaySnapshot[];
    developmentTendencies?: Array<{
        target: StatePatchTarget;
        tendency: string;
        sourceEntryIds: number[];
    }>;
    /** Recent, safety-filtered web observations available as narrative context. */
    webContext?: WebObservation[];
    /** Present only for a group-scene turn; private-message privacy remains unchanged. */
    groupContext?: GroupContext;
    /** Present only when one or more messages in the current private batch quote earlier content. */
    quotedMessages?: IndexedQuotedMessageContext[];
    /** Omitted entirely unless the active platform has registered, enabled actions. */
    chatCapabilities?: ChatActionCapabilities;
    /** Omitted unless the local sticker library is enabled, populated and usable on this turn. */
    stickerCatalog?: StickerCatalogEntry[];
    alterEnabled?: boolean;
    emotionalOffset?: EmotionalOffsetPrompt | null;
    agencyEnabled?: boolean;
    agencyWindow?: AgencyWindowState | null;
    /** Present only for background advance/follow-up turns. */
    automaticDeliverySummaries?: AutomaticDeliverySummary[];
    /** At most two relationship-local promises, included only on live/due turns. */
    followUpCommitments?: NarrativeIntent[];
    /** Only the next twelve hours of Schedule Preplan are exposed to narration. */
    schedulePreplan?: SchedulePreplanWindow | null;
    /** Ephemeral transport callback; never serialised into the model payload. */
    onEarlyReply?: (reply: EarlyNarrativeReply) => Promise<boolean>;
    /** Small concrete in-flight details carried from story state (pruned, capped). */
    workingDetails?: WorkingDetail[];
    /** Older moments semantically related to the current message; private live turns only. */
    recalledHistory?: RecalledMoment[];
    /** Deterministic M4 continuation scaffold; the model cannot directly rewrite it. */
    sceneFrame?: SceneFrame;
    dialogueBurst?: DialogueBurstState;
    /** Ephemeral host-owned channel metadata; never persisted as story prose. */
    channelData?: NarrativeChannelData;
}
export interface UserReportedTime {
    localTime: string;
    relation: 'past' | 'future' | 'current';
    statement: string;
}
export type TimelineBeatKind = 'activity' | 'thought' | 'state';
/** A compact, relative-time event ledger. `at` is always within [0, 1] and is
 * mapped by the host onto the current narration window. */
export interface TimelineBeat {
    at: number;
    kind: TimelineBeatKind;
    summary: string;
}
export interface TimelinePlan {
    beats: TimelineBeat[];
    carry?: string[];
}
export interface TimelinePlanRequest {
    recalledHistory?: RecalledMoment[];
    contactThreads?: import('./script/knowledge-evidence').ContactEvidenceThread[];
    story: InterludeStory;
    participant: InterludeParticipant | null;
    phase: Extract<NarrativePhase, 'advance' | 'conversation-follow-up' | 'intent-due'>;
    from: Date;
    now: Date;
    scene: InterludeScene | null;
    facts: NarrativeFact[];
    recentEntries: ScriptEntry[];
    /** The latest visible original script in full. It is a continuity handoff
     * for the temporal editor; an accompanying host ledger remains authoritative
     * whenever this script rendered an automatic window. */
    recentScriptContinuation?: {
        content: string;
        occurredAt: Date;
        hostTimelineLedger?: string;
    } | null;
    dueIntents: NarrativeIntent[];
    schedulePreplan?: SchedulePreplanWindow | null;
}
/** One retrieved older script moment for the semantic history recall block. */
export interface RecalledMoment {
    id: number;
    occurredAt: string;
    content: string;
    /** Consecutive immutable script rows included around the matched anchor. */
    sourceEntryIds?: number[];
}
export interface GroupMessageContext {
    senderId: string;
    senderName: string;
    /** A human-readable, stable identity label for prompt rendering. */
    speaker: string;
    /** Opaque prompt-safe reference. Undefined when the adapter supplied no targetable message id. */
    messageRef?: string;
    /** Runtime-only adapter id; never serialized into the model prompt. */
    messageId?: string;
    /** Present only when this incoming group message explicitly quotes another message. */
    quote?: QuotedMessageContext;
    content: string;
    occurredAt: Date;
    direction?: 'user' | 'character';
}
export interface GroupContext {
    groupId: string;
    channelId: string;
    label: string;
    purpose: string;
    characterRole: string;
    messages: GroupMessageContext[];
}
export interface NarrativeProvider {
    decide(request: NarrativeRequest): Promise<NarrativeDecision>;
    /** A low-frequency side analysis; absent providers leave the trigger pending. */
    analyzeAlter?(request: AlterAnalysisRequest, config: AlterSystemConfig): Promise<AlterAnalysisDecision>;
}
export declare const emptyStorySetting: () => StorySetting;
export declare const emptyStoryState: () => StoryState;
export declare const emptyParticipantState: () => ParticipantState;
/** A compact summary of one immediately-preceding closed scene, surfaced so the
 * raw context window and the arc do not leave a memory gap between them. */
export interface PreviousSceneSummary {
    startedAt: string;
    endedAt: string;
    summary: string;
}
export interface SceneContext {
    scene: InterludeScene | null;
    arc: InterludeArc | null;
    previousScenes?: PreviousSceneSummary[];
}
export interface CompactionRequest {
    /**
     * 后台压缩只处理已发生、且尚未写进当前场景摘要的原始条目。
     * 它与主叙事回合分离，不能增加用户发送消息时的等待时间。
     */
    story: InterludeStory;
    from: Date;
    now: Date;
    entries: ScriptEntry[];
    scene: InterludeScene | null;
    arc: InterludeArc | null;
    /** Original text before the incremental checkpoint; context, not new evidence. */
    precedingEntries?: ScriptEntry[];
    developmentCandidates?: StatePatchProposal[];
    participants: InterludeParticipant[];
    facts: NarrativeFact[];
    schedulePreplan?: SchedulePreplanReviewRequest;
}
export interface FactDraft {
    knowledge?: import('./script/knowledge-evidence').KnowledgeEvidence;
    scope: NarrativeFact['scope'];
    /** @deprecated Accepted only for old model payload compatibility; ignored when persisted. */
    participantId?: string;
    content: string;
    importance?: number;
    confidence?: number;
    unresolved?: boolean;
    sourceEntryIds?: number[];
    /** Existing open facts fulfilled, cancelled or otherwise closed by this evidence. */
    resolvesFactIds?: number[];
}
export interface StatePatchDraft {
    interactionReview?: {
        outcome: 'supported' | 'contested' | 'unresolved';
        feedbackEntryIds: number[];
        responseEntryIds: number[];
    };
    target: StatePatchTarget;
    participantId?: string;
    path: string;
    proposedValue: string;
    evidence: string;
    confidence?: number;
    impact?: 'minor' | 'major';
    sourceEntryIds?: number[];
    /** Explicit counter-evidence for an existing, still provisional candidate. */
    contradictsProposalIds?: number[];
}
export interface ScenePresenceDraft {
    name: string;
    status: ScenePresenceStatus;
    basis: string;
    sourceEntryIds: number[];
}
export interface CompactionDecision {
    episodeTags?: Array<{
        sourceEntryId: number;
        people?: string[];
        places?: string[];
        objects?: string[];
        topics?: string[];
        commitments?: string[];
        outcomes?: string[];
        dates?: string[];
    }>;
    scene?: {
        hook?: string;
        summary?: string;
        close?: boolean;
        boundary?: {
            reason: string;
            sourceEntryIds: number[];
        };
        presence?: ScenePresenceDraft[];
    };
    arc?: {
        title?: string;
        summary?: string;
    };
    facts?: FactDraft[];
    statePatches?: StatePatchDraft[];
    workingDetails?: WorkingDetailDraft[];
    schedulePreplan?: SchedulePreplanProposal;
    /** 主角当前注意力状态（群聊意愿 auto 档输入）；由压缩器附带返回。 */
    lifeStatus?: 'busy' | 'asleep' | 'idle';
    /** 压缩器输出的五档生活节奏（Urge 推进密度输入）。 */
    lifeRhythm?: {
        attention: LifeRhythmAttention;
        basis: string;
    };
}
export interface WorkingDetailDraft {
    /** Explicit rename of the same evidenced matter; never fuzzy deduplication. */
    replacesLabel?: string;
    knowledge?: import('./script/knowledge-evidence').KnowledgeEvidence;
    label: string;
    value: string;
    resolved?: boolean;
    expiresAt?: string;
    sourceEntryIds?: number[];
}
export interface OverlayCompactionRequest {
    story: InterludeStory;
    participant?: InterludeParticipant;
    target: StatePatchTarget;
    tier: OverlaySnapshot['tier'];
    from: Date;
    to: Date;
    patches: StatePatchProposal[];
    snapshots?: OverlaySnapshot[];
}
export interface OverlayCompactionDecision {
    summary: string;
    majorEvents?: string[];
}
/** Request for the low-frequency long-horizon dramaturgical catalyst.
 * The service owns eligibility, weighting, privacy filtering, and evidence IDs;
 * the provider may propose a bounded, non-canon first-expression affordance. */
export type LongArcGuidanceRequest = Record<string, unknown>;
export interface NarrativeCompactor {
    compact(request: CompactionRequest): Promise<CompactionDecision>;
    compactOverlay(request: OverlayCompactionRequest): Promise<OverlayCompactionDecision>;
    /** A small, independent daily review. Keeping it outside scene compaction
     * prevents a large summary response from dropping the schedule field. */
    planSchedulePreplan?(request: SchedulePreplanReviewRequest): Promise<SchedulePreplanProposal | undefined>;
    /** Low-temperature automatic-window director. A missing plan means the host
     * must defer the write rather than let free prose advance reality. */
    planTimeline?(request: TimelinePlanRequest): Promise<TimelinePlan | undefined>;
    /** Long-horizon guidance is deliberately independent from scene compaction. */
    planLongArcGuidance?(request: LongArcGuidanceRequest): Promise<unknown | undefined>;
}
export interface NarrativeEmbedder {
    identity?(): string;
    embed(input: string): Promise<number[]>;
}
export interface AlterSystemState {
    alterValue: number;
    alterWeight: number;
    lastTriggerDirection: -1 | 0 | 1;
    emotionalOffset: EmotionalOffset | null;
    history: AlterHistoryEntry[];
    /** Separate pending movement by relationship/global source. The visible
     * offset remains story-level, while its side analysis only sees evidence
     * that actually contributed to the triggering bucket. */
    pendingScopes?: AlterPendingScope[];
    lastUpdatedAt: string;
    lastAnalysisAttemptAt?: string;
}
export interface EmotionalOffset {
    direction: 'serious' | 'relaxed';
    description: string;
    intensity: number;
    generatedAt: string;
}
export interface EmotionalOffsetPrompt extends EmotionalOffset {
    weight: number;
}
export interface AlterHistoryEntry {
    turn: number;
    phase: NarrativePhase;
    alter: number;
    alterValue: number;
    timestamp: string;
    /** Empty means the protagonist's own/global life script. */
    participantId?: string;
}
export interface AlterPendingScope {
    participantId: string;
    alterValue: number;
    lastAnalysisAttemptAt?: string;
}
/** 宿主从已投递回复中提取的单轮表达节奏签名。 */
export interface RhythmSignature {
    bubbles: number;
    shape: Array<'s' | 'm' | 'l' | 'xl'>;
    tail: 'question' | 'imperative' | 'statement' | 'word';
    totalChars: number;
    occurredAt: string;
}
/** 连续同构节奏的定型状态；streak 驱动注入强度阶梯。 */
export interface CollapsedRhythm {
    templateKey: string;
    reason: 'same-structure' | 'tail-repeat' | 'length-box';
    streak: number;
}
export interface ChatRhythmState {
    recent: RhythmSignature[];
    collapsed?: CollapsedRhythm;
    exhausted?: boolean;
    lastDirectiveLevel?: 1 | 2 | 3;
    updatedAt: string;
}
/** Deprecated configuration shape, accepted only for existing installations. */
export interface ChatRhythmConfig {
    enabled: boolean;
    /** 检测策略档位：gentle 仅结构同构；balanced 增加尾段复读与字数箱体；aggressive 收紧样本要求。 */
    mode: 'gentle' | 'balanced' | 'aggressive';
    historyLimit: number;
    collapseMinSamples: number;
    exhaustLimit: number;
}
export interface AlterAnalysisRequest {
    characterName: string;
    triggerValue: number;
    threshold: number;
    direction: 'serious' | 'relaxed';
    recentScripts: Array<{
        content: string;
        occurredAt: string;
    }>;
    history: AlterHistoryEntry[];
    settingOverlay: StorySettingOverlay;
    currentOffset: EmotionalOffsetPrompt | null;
}
export interface AlterAnalysisDecision {
    description: string;
}
export interface AlterSystemConfig {
    enabled: boolean;
    baseThreshold: number;
    densityFactor: number;
    sameDirectionBoost: number;
    oppositeDecay: number;
    minWeight: number;
    maxIntensity: number;
    modelId?: string;
    providerId?: string;
    model?: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    timeout?: number;
    prompt?: string;
}
