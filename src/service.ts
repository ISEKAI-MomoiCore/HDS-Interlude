import { Context, h, Logger, Service, Session, Time, Universal } from 'koishi'
import { AsyncLocalStorage } from 'node:async_hooks'
import { registerTables } from './database'
import { appendProactiveContact, countProactiveContactsInWindow } from './story-state'
import {
  advanceLongHorizonGenerationBaseline,
  calculateLongHorizonScore,
  isEligibleNarrativeEntry,
  LongArcGuidanceRecord,
  LongArcProgressRow,
  normalizeLongArcDecision,
  progressUpdatePayload,
  resolveLongHorizonConfig,
  shouldTriggerLongHorizon,
} from './long-arc'
import { createWorldSeeder, parseWorldSeedEvents, resolveWorldSeederRuntime, seedDomainForRun, validateSeedEvent, type SeedValidationInput, type WorldSeedDomain, type WorldSeeder } from './world-seeder'
import { fetchWeatherSnapshot, isFantasyStory, lastWeatherSnapshot, resolveWeatherConfig } from './weather'
import { lifeRhythmStale, lifeRhythmFromLegacyStatus } from './story-state'
import { callQzoneAction, evaluateQzoneGate, matchQzoneFeedContent, normalizeQzoneFeedEntry, normalizeQzoneMsgEntry, probeQzoneAvailable, qzoneFeedCandidates, qzoneIntentFromPayload, qzoneReactionDeltas, qzoneRecordsForEndpoint, qzoneVisibilityLabel, resolveQzoneConfig, QzoneActionError, type QzoneActionCaller, type QzoneActionKind, type QzoneConfig, type QzoneFeedEntry, type QzoneMsgEntry, type QzonePostRecord } from './qzone'
import {
  channelContextMetadata, deriveGroupEndpoint, deriveParticipantUserEndpoint, deriveStoryRoleEndpoint,
  endpointAccountKey, endpointUniqueKey, freshEndpointState, normalizeEndpointRow, normalizeEndpointState, restoreEndpointState, normalizeStoryAliasRow, resolveInboundEndpoint, resolveStoryAlias,
  stateAfterConnection, stateAfterInbound, stateAfterOutbound, isEndpointDeliverable, isEndpointInitiateAllowed,
  type EndpointRow, type EndpointState, type StoryAliasRecord,
} from './endpoints'
import type { SeededWorldEvent } from './types'
import { HealthMonitor } from './health'
import { contactEvidenceThreads, knowledgeClauses, knowledgeRelatedIds, legacyConditionCue, normalizeKnowledgeEvidence, supportsRecordedOutcome } from './script/knowledge-evidence'
import { readFile, readdir, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createTurnEngine, shouldSupersedeRequest, type TurnEngine, type TurnBufferedNarrativeTurn as BufferedNarrativeTurn, type TurnBufferedUserMessage as BufferedUserMessage } from './turn-engine'
import { describeHttpError } from './http-proxy'
import { createScheduler, type Scheduler } from './scheduler'
import { UrgeConfig, resolveUrgeConfig, normalizeUrgeState, urgeUserEvent, planUrge, commitUrge, acknowledgeUrge, urgeBurstActive, ATTENTION_MULTIPLIERS, type UrgeRhythmInput } from './urge'
import { extname, relative, resolve, sep } from 'node:path'
import { createReadStream } from 'node:fs'
import { AudioConfig, compactPromptEntries, createCompactor, createEmbedder, createNarrator, createStickerDescriber, createVisionDescriber, detectMessageRepetition, formatTokenUsageLine, isContextDisposedError, ModelConfig, normalizeLifeRhythmDraft, promptVisibleMessageContent, recentScriptOwnership, StickerDescriber, StickerDescription, TokenUsageRecord, VisionDescriber } from './narrator'
import { formatModelRouting, ModelRoutingTable, resolveModelRouting } from './model-routing'
import {
  advanceAlterSystem, alterHistoryForScope, alterScopeCoolingDown, alterScopeValue, calculateAlterThreshold,
  clearAlterScopeAnalysisAttempt, completeAlterAnalysis, emotionalOffsetForPrompt, markAlterScopeAnalysisAttempt,
  normalizeAlterSystemState, normalizeAlterValue, resolveAlterSystemConfig,
  AlterTurnResult,
} from './alter'
import { buildEpisodeIndex, episodeExcerpt, groundedEpisodeTags, episodeTagScore } from './script/episode-index'
import { indexOriginal, scoreOriginal, recallKeys, recallFocus, type RecallSpan } from './script/recall-navigation'
import { developmentDimension, developmentScenes, developmentContextQuery, promptReadyDevelopment, reviewedDevelopmentSupport } from './script/development'
import { reconcileTransportReferences } from './script/authored-actions'
import { normalizeLifeHandoff, entryLifeHandoff } from './script/life-handoff'
import { needsTimelineDirector } from './script/timeline-routing'
import { assertContinuityReview, compactionPrefix } from './script/continuity-checkpoint'
import {
  activeAgencyWindow, evaluateAgencyCapacity, normalizeAgencyWindowDraft,
  normalizeProactiveContact, proactiveCandidateFingerprint, proactiveRecheckAt, resolveAgencyConfig,
} from './agency'
import { HDS_INTERLUDE_VERSION } from './meta'
import { formatLayeredLog, phaseLabel, renderLogMessage } from './logging'
import { calendarDayKey, formatLogTime, localClockMinutes, storyLocalTimeContext } from './time'
import { consumeWillingnessGate, evaluateWillingnessGate, formatWillingnessGateDiagnosis, GroupWillingnessConfig, GroupWillingnessState, normalizeLifeStatusDraft } from './group-willingness'
import { normalizeQQNativeFaceSegments } from './qq-face'
import { extractForwardIds, readForwardContent, ForwardReadResult } from './forward-message'

/** Koishi/Satori uses numeric Universal.Status values; keep legacy string adapters compatible. */
export function isBotOnlineStatus(status: unknown): boolean {
  return status === Universal.Status.ONLINE
    || status === 1
    || status === 'online'
    || status === 'active'
    || status === 'connected'
}
import {
  applySchedulePreplanProposal, nextSchedulePreplanTransition, normalizeSchedulePreplanRecord,
  SCHEDULE_PREPLAN_FOLLOWUP_COOLDOWN_MS, schedulePreplanEvidenceMentionsDateChange,
  refreshSchedulePreplan, resolveSchedulePreplanConfig, SchedulePreplanConfig, schedulePreplanNeedsModel,
  schedulePreplanReviewDue, schedulePreplanWindow,
} from './schedule-preplan'
import {
  decodeStoryState, encodeStoryState, inspectStoryStateMigration,
  normalizeContinuitySnapshot, normalizeScenePresenceState,
} from './story-state'
import { attachMessageEvent, deliveryEntryMetadata, prepareOutgoingDelivery, restoreDesktopContext, restoreMessageEvent, scriptEventPayload } from './delivery'
import { currentDesktopProcessingContext, persistedDesktopProcessingContext } from './processing-context'
import { decisionToScriptCommit, findGroupScriptEvent, findPrivateOutgoingMessageEvent, unboundImmediateMessageEvents } from './script/commit-builder'
import { liveNarrativeIntents, consumedLiveIntentIds } from './script/intent-lifecycle'
import { isOutgoingScriptEvent, messageEventReference, ScriptCommitDraft, type ScriptEventDraft } from './script/contract'
import { platformActionReference, ScriptDeliveryAction, ScriptDeliveryReference, ScriptDeliverySegmentStatus, updateScriptDeliveryActions } from './script/delivery-ledger'
import { validateScriptCommit } from './script/validator'
import { scriptEntryDraftForCommit } from './turn-persistence'
import { advanceSceneFrame, projectSceneFrame, resolveDialogueBurst } from './script/scene-frame'
import {
  CompactionDecision, CompactionRequest, emptyStorySetting, emptyStoryState, IntentDraft, InterludeArc, InterludeScene,
  InterludeParticipant, InterludeStory, MemoryDraft, NarrativeDecision, NarrativeFact, NarrativeIntent,
  GroupContext, GroupMessageContext, NarrativeHistoricalImage, NarrativeInteraction, NarrativeProvider, NarrativeRequest, NarrativeCompactor,
  NarrativeEmbedder, OutgoingMessageDraft, ParticipantState, ScriptEntry, ScriptEntryDraft, StatePatchDraft, StatePatchProposal, StorySetting, StoryState,
  BrowserIntentDraft, NarrativeAudio, NarrativeImage, OverlaySnapshot, WebObservation, emptyParticipantState,
  AlterSystemState, AlterSystemConfig, EmotionalOffsetPrompt, ChatRhythmConfig,
  AgencyConfig, AgencyWindowState, ProactiveContactDraft, AutomaticDeliverySummary, ScenePresenceDraft, ScenePresenceState,
  ChatActionCapabilities, ChatReactionName, FollowUpCommitmentDraft, FollowUpResolutionDraft, LocalMediaDraft, MessageReactionDraft, NativeFaceSemantic, StickerAsset, StickerCatalogEntry,
  EarlyNarrativeReply, IndexedQuotedMessageContext, QuotedMessageContext, SchedulePreplanRecord, SchedulePreplanReviewRequest,
  PreviousSceneSummary, RecalledMoment, WorkingDetail, TimelinePlan, TimelinePlanRequest, UserReportedTime,
  DialogueBurstState, SceneFrame, NarrativeChannelData, NarrativeEndpointOption,
} from './types'
import type { DesktopInboundEvent, DesktopRuntimePhase } from './desktop-bridge'

export type DesktopTimelineTrack = 'script' | 'messages' | 'system' | 'scenes' | 'facts' | 'preplan' | 'alter' | 'compaction'
export interface DesktopTimelineRangeRequest {
  from?: string
  to?: string
  tracks?: DesktopTimelineTrack[]
  /** Opaque oldest-entry cursor returned by the preceding response. */
  cursor?: string
  detailLevel?: 'summary' | 'full'
  limit?: number
}

/** Read-only endpoint health projection consumed by typ-0.  The desktop must
 * not read interlude_endpoint or interlude_endpoint_state directly. */
export interface DesktopEndpointHealth {
  endpointId: string
  ownerKind: EndpointRow['ownerKind']
  ownerId: string
  platform: string
  channelKind: EndpointRow['channelKind']
  enabled: boolean
  online: boolean
  observedAt: string
  deliverable: boolean
  initiateAllowed: boolean
  cooldownUntil?: string
  lastError?: string
  note?: string
}

const DESKTOP_TIMELINE_TRACKS: DesktopTimelineTrack[] = ['script', 'messages', 'system', 'scenes', 'facts', 'preplan', 'alter', 'compaction']

function desktopTimelineTrackForEntry(entry: Pick<ScriptEntry, 'kind' | 'actor'>): DesktopTimelineTrack {
  if (entry.kind === 'script' || entry.actor === 'narrator') return 'script'
  if (/message|chat|reply/u.test(entry.kind)) return 'messages'
  return 'system'
}

function parseDesktopTimelineDate(value: unknown) {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** 分页游标改为 occurredAt+id 双键（与排序键一致）；旧 entry:<id> 继续兼容。 */
export interface TimelineCursor { occurredAt?: Date, id?: number }
export function parseTimelineCursor(cursor: string | undefined): TimelineCursor | undefined {
  if (typeof cursor !== 'string' || !cursor) return undefined
  const dual = /^e:(\d{12,15}):(\d+)$/.exec(cursor)
  if (dual) return { occurredAt: new Date(Number(dual[1])), id: Number(dual[2]) }
  const legacy = /^entry:(\d+)$/.exec(cursor)
  if (legacy) return { id: Number(legacy[1]) }
  return undefined
}
export function timelineEntryQueryAfter(base: Record<string, unknown>, cursor: TimelineCursor | undefined): Record<string, unknown> {
  if (!cursor) return base
  if (cursor.occurredAt && Number.isFinite(cursor.id!)) {
    return { $and: [base, { $or: [{ occurredAt: { $lt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, id: { $lt: cursor.id } }] }] }
  }
  return cursor.id != null ? { ...base, id: { $lt: cursor.id } } : base
}

function normalizeDesktopTimelineRangeRequest(value: DesktopTimelineRangeRequest) {
  const now = new Date()
  let from = parseDesktopTimelineDate(value.from) ?? new Date(now.getTime() - 2 * Time.hour)
  let to = parseDesktopTimelineDate(value.to) ?? new Date(now.getTime() + 12 * Time.hour)
  if (to < from) [from, to] = [to, from]
  // A desktop viewport never needs an accidental multi-year dump. Paging is
  // the explicit route for history, and this cap protects the worker database.
  const maxWindow = 14 * Time.day
  if (to.getTime() - from.getTime() > maxWindow) to = new Date(from.getTime() + maxWindow)
  const tracks = new Set((Array.isArray(value.tracks) ? value.tracks : DESKTOP_TIMELINE_TRACKS)
    .filter((track): track is DesktopTimelineTrack => DESKTOP_TIMELINE_TRACKS.includes(track as DesktopTimelineTrack)))
  if (!tracks.size) DESKTOP_TIMELINE_TRACKS.forEach(track => tracks.add(track))
  const cursor = parseTimelineCursor(typeof value.cursor === 'string' ? value.cursor : undefined)
  return { from, to, tracks, cursor, limit: Math.max(1, Math.min(Math.floor(Number(value.limit) || 240), 500)), detailLevel: value.detailLevel === 'full' ? 'full' : 'summary' as const }
}

function desktopRangeOverlaps(from: Date, to: Date, start: Date, end?: Date) {
  const final = end ?? start
  return start <= to && final >= from
}

/** Protocol 4: deterministic, read-only annotations projected from the V2
 * commit ledger. The desktop cannot mutate them and none of them replace prose. */
function desktopDeliveryRealitySummary(entry: ScriptEntry) {
  const actions = entry.metadata?.deliveryActions
  if (!Array.isArray(actions) || !actions.length) return undefined
  const items = actions
    .filter((action: any) => action && typeof action.eventId === 'string' && Array.isArray(action.segments))
    .map((action: any) => ({
      eventId: String(action.eventId),
      eventKind: typeof action.eventKind === 'string' ? action.eventKind : 'outgoing-message',
      status: typeof action.status === 'string' ? action.status : 'pending',
      segments: action.segments
        .filter((segment: any) => segment && typeof segment.content === 'string' && typeof segment.status === 'string')
        .map((segment: any) => ({ kind: String(segment.kind ?? 'message'), status: String(segment.status), content: String(segment.content) })),
    }))
    .filter(item => item.segments.length)
  return items.length ? items : undefined
}

function desktopSceneCheckpoint(entry: ScriptEntry) {
  const checkpoint = entry.metadata?.sceneCheckpoint as {
    sceneId?: unknown, startedAt?: unknown, endedAt?: unknown, reason?: unknown,
    firstEntryId?: unknown, lastEntryId?: unknown, boundarySourceEntryIds?: unknown,
  } | undefined
  if (!checkpoint || !Number.isFinite(Number(checkpoint.sceneId))) return undefined
  const startedAt = parseDesktopTimelineDate(checkpoint.startedAt as string)
  if (!startedAt) return undefined
  return {
    sceneId: Number(checkpoint.sceneId),
    startedAt: startedAt.toISOString(),
    ...(parseDesktopTimelineDate(checkpoint.endedAt as string) ? { endedAt: parseDesktopTimelineDate(checkpoint.endedAt as string)!.toISOString() } : {}),
    ...(typeof checkpoint.reason === 'string' ? { reason: checkpoint.reason } : {}),
    ...(Number.isSafeInteger(Number(checkpoint.firstEntryId)) ? { firstEntryId: Number(checkpoint.firstEntryId) } : {}),
    ...(Number.isSafeInteger(Number(checkpoint.lastEntryId)) ? { lastEntryId: Number(checkpoint.lastEntryId) } : {}),
    ...(Array.isArray(checkpoint.boundarySourceEntryIds)
      ? { boundarySourceEntryIds: checkpoint.boundarySourceEntryIds.filter((id: unknown) => Number.isSafeInteger(Number(id))).map((id: unknown) => Number(id)) } : {}),
  }
}

export function desktopTimelineEntryView(entry: ScriptEntry) {
  const window = entry.metadata?.timelineWindow as { from?: unknown, to?: unknown } | undefined
  const startedAt = parseDesktopTimelineDate(window?.from) ?? entry.occurredAt
  const endedAt = parseDesktopTimelineDate(window?.to)
  return {
    entityId: `entry:${entry.id}`, id: entry.id, storyId: entry.storyId, participantId: entry.participantId,
    kind: entry.kind, actor: entry.actor, track: desktopTimelineTrackForEntry(entry), content: entry.content,
    occurredAt: entry.occurredAt.toISOString(), startedAt: startedAt.toISOString(), endedAt: endedAt?.toISOString(),
    // Protocol 4 annotations: identity for cross-referencing logs/outbox, and
    // execution truth for the delivery ledger. Absent on legacy entries.
    ...(typeof entry.metadata?.commitId === 'string' ? { commitId: entry.metadata.commitId } : {}),
    ...(desktopDeliveryRealitySummary(entry) ? { deliveryActions: desktopDeliveryRealitySummary(entry) } : {}),
    ...(desktopSceneCheckpoint(entry) ? { sceneCheckpoint: desktopSceneCheckpoint(entry) } : {}),
    // Media attachment counts for the desktop media/files track.
    ...(typeof entry.metadata?.imageCount === 'number' && entry.metadata.imageCount > 0 ? { imageCount: entry.metadata.imageCount } : {}),
    ...(typeof entry.metadata?.audioCount === 'number' && entry.metadata.audioCount > 0 ? { audioCount: entry.metadata.audioCount } : {}),
    // Alter value for the desktop alter track (severity/colour rendering).
    ...(typeof entry.metadata?.alterValue === 'number' ? { alterValue: entry.metadata.alterValue } : {}),
    ...(typeof entry.metadata?.alterOffset === 'string' && entry.metadata.alterOffset ? { alterOffset: entry.metadata.alterOffset } : {}),
  }
}

function emptyDesktopTimelineRange() {
  const now = new Date().toISOString()
  return { protocol: 4, storyId: '', revision: 'empty', range: { from: now, to: now }, entries: [], scenes: [], facts: [] }
}

/** Entry kinds whose raw content is eligible for semantic history recall. */
const RECALLABLE_ENTRY_KINDS = ['user-message', 'character-message', 'script', 'group-message', 'character-group-message']

type HistoryVectorEntry = {
  spans?: RecallSpan[]
  embeddingIdentity?: string
  tags?: string[]
  frameId?: string
  checkpoint?: { sceneId: number; firstEntryId: number; lastEntryId: number }
  vector?: number[]
  content: string
  occurredAt: string
  participantId: string
  kind: string
}

/** Semantic recall is another view of raw history, so it must obey the same
 * private-branch boundary as recentScript. Group transcripts are deliberately
 * excluded from a private turn unless the owner opted into shared details. */
export function isHistoryEntryVisibleToParticipant(entry: Pick<ScriptEntry, 'participantId' | 'kind'>, participantId: string, shareParticipantDetails: boolean) {
  if (shareParticipantDetails) return true
  if (entry.kind === 'group-message' || entry.kind === 'character-group-message') return false
  return !entry.participantId || entry.participantId === participantId
}

/** A turn needs a live query vector only for a feature that can actually use
 * it. An inactive or small sticker library must not silently turn ordinary
 * fact embedding into a per-message network request. */
export function shouldRequestTurnEmbedding(embedding: ModelConfig['embedding'] | undefined, stickerLibraryEnabled: boolean, stickerCount: number) {
  if (!embedding?.enabled) return false
  return embedding.liveQuery === true
    || embedding.semanticHistory === true
    || embedding.semanticStickerFilter === true && stickerLibraryEnabled && stickerCount > SEMANTIC_STICKER_LIMIT
}

/** After a failed Schedule Preplan generation, wait this long before letting the
 * daily review request another compactor call. Without this backoff a weak
 * compaction model that omits the schedule field would trigger one extra LLM
 * call after every single user turn. */
const SCHEDULE_PREPLAN_RETRY_BACKOFF = 2 * Time.hour
/** A failed compaction must not be retried against the same unchanged scene
 * on every narrative turn. The fingerprint is deliberately in-memory: after a
 * restart one fresh attempt is useful, while a live failure cannot burn tokens. */
const COMPACTION_RETRY_BACKOFF = 2 * Time.hour
/** A failed automatic timeline must not be sent again on every three-minute
 * background sweep while the story cursor is unchanged. */
const TIMELINE_RETRY_BACKOFF_BASE = 10 * Time.minute
/** 连续失败达到该次数后熔断：自动推进降级为无账本守恒推进，不再调用时间导演。 */
const TIMELINE_DIRECTOR_FUSE = 6
/** 熔断后的冷却：期间不再尝试时间导演，到期后自动解除熔断重试一次。 */
const TIMELINE_DIRECTOR_FUSE_COOLDOWN = 2 * Time.hour
const STICKER_DESCRIPTION_RETRY_COOLDOWN = 30 * Time.minute

interface PreparedCompactionSkip {
  phase: 'skip'
  overlayCompacted: boolean
}

interface PreparedCompactionRun {
  phase: 'run'
  overlayCompacted: boolean
  scene: InterludeScene
  sceneEntries: ScriptEntry[]
  chars: number
  sceneCompactionDue: boolean
  current: InterludeStory
  participants: InterludeParticipant[]
  visibleCompactionFacts: NarrativeFact[]
  compactRequest: CompactionRequest
  fingerprint: string
  factEmbeddings?: Map<string, number[]>
}

type PreparedCompaction = PreparedCompactionSkip | PreparedCompactionRun

// Only QQ/OneBot CDN hosts are fetched in the native-vision path. This keeps
// arbitrary user-provided URLs from becoming an internal-network fetch proxy.
function isTrustedImageHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const allowed = ['gchat.qpic.cn', 'c2cpicdw.qpic.cn', 'multimedia.nt.qq.com.cn', 'thirdqq.qlogo.cn', 'q.qlogo.cn', 'gxh.vip.qq.com']
  return allowed.some(domain => host === domain || host.endsWith(`.${domain}`))
}

/** Log only the acquisition channel and host. OneBot file identifiers and QQ
 * CDN URLs can contain expiring tokens, so the original source must never be
 * copied into an operational log line. */
function describeImageSource(source: string) {
  const value = String(source ?? '').trim()
  if (value.startsWith('onebot-file:')) return 'onebot-file'
  if (value.startsWith('onebot-url:')) {
    const nested = value.slice('onebot-url:'.length)
    try { return `onebot-url:${new URL(nested).hostname}` } catch { return 'onebot-url:invalid' }
  }
  if (/^data:image\//i.test(value)) return 'inline-data'
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return `${url.protocol.slice(0, -1)}:${url.hostname}`
  } catch { /* keep the source opaque */ }
  return 'invalid'
}

/** QQ CDN 下载链接过期签名：HTTP 400 + retcode -5503007 / "download url has
 * expired"。此状态对该 URL 永久成立（令牌已失效，不会恢复），与限流或瞬时
 * 网络错误不同，因此值得与其它 4xx 区分开来单独缓存。 */
function isExpiredImageUrlError(error: unknown) {
  if (!(error instanceof Error)) return false
  const response = (error as { response?: unknown }).response
  const status = response && typeof response === 'object' && typeof (response as { status?: unknown }).status === 'number'
    ? (response as { status: number }).status
    : undefined
  if (status !== 400) return false
  const data = response && typeof response === 'object' ? (response as { data?: unknown }).data : undefined
  const body = typeof data === 'string' ? data : typeof data === 'object' && data !== null ? JSON.stringify(data) : ''
  return body.includes('url has expired') || body.includes('-5503007')
}

export interface Config {
  /** Immersive operation that suppresses HDSI visibility and Koishi commands. */
  blindMode?: BlindModeConfig
  /** @deprecated Renamed to blindMode; retained for existing Console YAML. */
  blackBox?: BlindModeConfig
  model: ModelConfig
  runtime: RuntimeConfig
  storyDefaults: StoryDefaults
  logging: LoggingConfig
  memory?: MemoryConfig
  sharedStory?: SharedStoryConfig
  /** Optional, read-only browser observations powered by koishi-plugin-puppeteer. */
  browser?: BrowserConfig
  /** 世界事件播种器：独立提供商配置块；未选模型即视为关闭。 */
  worldSeeder?: unknown
  /** QQ 空间（说说）通道：SnowLuma qzone 扩展动作的限流与审计。 */
  qzone?: unknown
  /** 预设同步：从 typ0-site 分享站自动拉取配置。 */
  presetSync?: {
    enabled: boolean
    baseUrl: string
    shareCode: string
    autoUpdate: boolean
    sections: string[]
    applyToCurrentStory: boolean
  }
  /** 顶层主提示词（Console 最底部）：非空时覆盖 model.mainPrompt。 */
  mainPrompt?: string
  /** Optional OneBot/NapCat account gate. It only affects the onebot platform. */
  onebot?: OneBotNapCatConfig
  /** Optional cross-platform chat gestures; runtime connector availability remains authoritative. */
  chatActions?: ChatActionsConfig
  stickers?: StickerLibraryConfig
  longHorizon?: unknown
  alterSystem?: AlterSystemConfig
  chatRhythm?: ChatRhythmConfig
  /** Timeline director for automatic windows; off = automatic turns run without a ledger. */
  timelineDirector?: { enabled: boolean }
  agency?: AgencyConfig
  urge?: UrgeConfig
  schedulePreplan?: SchedulePreplanConfig
}

export interface BlindModeConfig {
  enabled: boolean
  /** Periodic, intentionally minimal health signal while all other HDSI logs stay hidden. */
  healthReportMinutes: number
}

/** One row in the Console account tables. QQ ids are strings because QQ ids
 * can exceed JavaScript's safe integer range and Koishi exposes them as text. */
export interface OneBotAccountRule {
  qq: string
  label: string
  enabled: boolean
  /** Optional identity fields for a whitelisted private-message user. */
  personId?: string
  profile?: string
  relationship?: string
}

export interface OneBotNapCatConfig {
  /** When false (or omitted for old configurations), OneBot access is unchanged. */
  enabled: boolean
  /** NapCat accounts that are allowed to send the character's messages. */
  botAccounts: OneBotAccountRule[]
  /** @deprecated Kept only so old YAML can still load; runtime is allowlist-only. */
  userMode?: 'allowlist' | 'blocklist'
  userAccounts: OneBotAccountRule[]
  /** Explicit OneBot group allowlist. Group members do not need DM whitelist access. */
  groupChats?: GroupChatRule[]
  /** Prevent an echoed self-message from entering the narrative. */
  ignoreSelfMessages: boolean
}

export interface ChatActionsConfig {
  enabled: boolean
  platforms: Array<'qq' | 'wechat'>
  quoteReply: boolean
  messageReactions: boolean
  allowedReactions: ChatReactionName[]
  nativeFaces: boolean
  expressionThreshold: number
  allowedNativeFaces: NativeFaceSemantic[]
}

export interface StickerLibraryConfig {
  enabled: boolean
  directory: string
  maxFileSizeMB: number
  catalogLimit: number
  descriptionMaxTokens?: number
  /** API JSON mode is optional; prompt-only still asks for the compact JSON contract. */
  descriptionResponseFormat?: 'json-object' | 'prompt-only'  /** 表情包投递基址（空=自动：selfUrl → http://127.0.0.1:5140）。OneBot 实现与 Koishi 不共享文件系统时须经 HTTP 回源。 */
  deliveryBaseUrl?: string
  /** 投递模式：auto=路由可用走 HTTP、否则退 file://；http/file=强制。 */
  deliveryMode?: 'auto' | 'http' | 'file'
}

export interface GroupChatRule {
  groupId: string
  label: string
  enabled: boolean
  purpose: string
  characterRole: string
  /** Explicit Koishi channel assignee. Empty/omitted preserves native routing. */
  assignee?: string
  responseMode: 'mention-only' | 'always'
  contextLimit: number
  debounceSeconds: number
  cooldownSeconds: number
  /** Number of recent historical group images attached to a later narrative turn. */
  historicalImageLimit?: number
  /** 档位化的群聊意愿门：off/quiet/reserved/normal/active/eager/auto/custom。 */
  willingnessPreset?: string
  /** auto 档三态（busy/asleep/idle）各自使用的档位。 */
  willingnessAuto?: { busy?: string, idle?: string, asleep?: string }
  willingness?: Partial<GroupWillingnessConfig>
}

export interface MemoryConfig {
  enabled: boolean
  backgroundIntervalMinutes: number
  maxStoriesPerCompactionRun: number
  sceneEntryThreshold: number
  sceneCharacterThreshold: number
  compactionEntryLimit: number
  compactionCharacterLimit: number
  sceneHookCharacters: number
  sceneSummaryCharacters: number
  arcSummaryCharacters: number
  /** 弧摘要进 prompt 前的独立裁剪上限(存储仍保留全量);尾部最贴近当前剧情。 */
  arcPromptCharacters?: number
  /** How many immediately-preceding closed scene summaries join the prompt. */
  previousSceneSummaries: number
  recentEntryLimit: number
  factLimit: number
  factContentCharacters: number
  factImportanceWeight: number
  factConfidenceWeight: number
  factRecencyWeight: number
  semanticWeight: number
  unresolvedWeight: number
  statePatchConfidenceThreshold: number
  majorStatePatchConfidenceThreshold: number
  statePatchMinEvidence: number
  /** Minimum independent narrative turns for a minor overlay change. */
  statePatchMinTurns?: number
  /** major 提案自动应用所需的最少独立场景数;默认 2。 */
  statePatchMajorMinScenes?: number
  /** Minimum distinct calendar days represented by minor-patch evidence. */
  statePatchMinDays?: number
  /** Cooldown between stable overlay changes on the same target/path. */
  statePatchCooldownHours?: number
  autoApplyStatePatches: boolean
  allowMajorStateChanges: boolean
  maxFactsPerStory: number
  /** Keep short-lived dramatic aftereffects as context for later writing. */
  activeConsequencesEnabled: boolean
  /** Maximum active consequences carried into one main-narrative prompt. */
  activeConsequencePromptLimit: number
  /** Longest permitted lifetime of one consequence; protects canon from drift. */
  activeConsequenceMaxDays: number
  /** Used when the narrator omits a precise strength for a valid consequence. */
  activeConsequenceDefaultStrength: number
  overlayCompressionEnabled?: boolean
  overlayRecentDays?: number
  overlayMonthlyAfterDays?: number
  overlayWeeklyWindowDays?: number
  overlayMonthlyWindowDays?: number
  overlayWeeklySummaryCharacters?: number
  overlayMonthlySummaryCharacters?: number
}

export interface RuntimeConfig {
  captureDirectMessages: boolean
  autoCreate: boolean
  ignoreCommandMessages: boolean
  allowProactiveMessages: boolean
  /** Minimum narrator-declared willingness for a background-initiated contact. */
  proactiveWillingnessThreshold?: number
  sweepIntervalMinutes: number
  minimumAdvanceMinutes: number
  maxStoriesPerSweep: number
  contextEntryLimit: number
  /** Preserve raw entries from this recent time window in addition to the count floor. */
  contextTimeWindowMinutes?: number
  memoryLimit: number
  maxScriptCharacters: number
  maxMessageCharacters: number
  minimumDelayedReplySeconds: number
  maximumDelayedReplyMinutes: number
  cancelDelayedRepliesOnUserMessage: boolean
  /** Retry a user turn after a transient narrative-provider failure. */
  narrativeRetryDelaySeconds?: number
  /** Maximum automatic retries per failed user turn; 0 disables retry. */
  narrativeRetryMaxAttempts?: number
  /** Split model reply.content into multiple QQ messages at the configured separator. */
  splitReplyMessages?: boolean
  messageSeparator?: string
  /** 小模型适配：可见回复未用分句标记而用换行时，把换行视作气泡边界。 */
  convertNewlineToSeparator?: boolean
  typingBaseDelaySeconds?: number
  typingCharactersPerSecond?: number
  typingMaxDelaySeconds?: number
  /** Random variation applied to simulated typing delays; 0 keeps deterministic timing. */
  typingJitterRatio?: number
  /** Wait after the newest user message before starting a writing request. */
  userMessageDebounceSeconds?: number
  forwardMessage?: {
    enabled?: boolean
    maxNodes?: number
    maxCharacters?: number
    maxDepth?: number
  }
  /** @deprecated Ignored since 0.1.2; requests remain replaceable until the first reply is committed. */
  staleNarrativeRequestWindowSeconds?: number
  /** 新版自动推进调度；旧版 minimumAdvanceMinutes 仍保留兼容。 */
  autoAdvanceEnabled?: boolean
  autoAdvanceIntervalMinutes?: number
  autoAdvanceJitterMinutes?: number
  /** Short life-writing passes after a conversation, in minutes. */
  conversationFollowUpMinutes?: number[]
  /** Small random offset applied to each short conversation follow-up. */
  conversationFollowUpJitterMinutes?: number
  restWindows?: RestWindow[]
}

export interface BrowserConfig {
  enabled: boolean
  /** Immediate browsing is opt-in because it intentionally adds one more model/browser round trip. */
  mode: 'deferred-only' | 'allow-immediate'
  allowSearch: boolean
  allowVisit: boolean
  searchUrlTemplate: string
  allowedDomains: string[]
  blockedDomains: string[]
  maxConcurrentPages: number
  /** Bound work per background sweep so a backlog cannot hold the story queue for minutes. */
  maxResearchPerSweep: number
  navigationTimeout: number
  waitUntil: 'domcontentloaded' | 'networkidle2'
  maxTextCharacters: number
  maxExcerptCharacters: number
  maxObservationsInPrompt: number
  cacheMinutes: number
  allowGroupTriggeredResearch: boolean
  logObservationPreview: boolean
}

/** Console presets that turn QQ accounts into named relationship branches. */
export interface ParticipantPreset {
  qq: string
  personId: string
  label: string
  profile: string
  relationship: string
  enabled: boolean
}

export interface SharedStoryConfig {
  /** One main story per bot account. Kept configurable for a safe rollback. */
  enabled?: boolean
  /** Enroll an allowed account into an existing main story on its first DM. */
  autoEnrollParticipants: boolean
  /** Allow one incoming message to cause an explicitly justified message to another account. */
  allowCrossConversationMessages: boolean
  /** Send other participants' relationship/profile details to the model provider. */
  shareParticipantDetails: boolean
  /** Hard cap for cross-account messages produced by one narrative turn. */
  maxCrossConversationActions: number
  /** Number of other relationship summaries sent to the main narrator. */
  participantContextLimit: number
  /** Empty keeps legacy behaviour; otherwise only these QQs may run global management commands. */
  managerAccounts: string[]
  /** Optional QQ-to-person presets; accounts with the same personId share identity notes. */
  /** @deprecated Use onebot.userAccounts identity fields in new configs. */
  participantPresets?: ParticipantPreset[]
}

export interface RestWindow {
  enabled: boolean
  label: string
  start: string
  end: string
  minIntervalMinutes: number
  maxIntervalMinutes: number
}

interface AutoAdvanceConfig {
  enabled: boolean
  intervalMinutes: number
  jitterMinutes: number
  followUpMinutes: number[]
  followUpJitterMinutes: number
  restWindows: RestWindow[]
}

interface StoredGroupImageRef {
  source: string
  ordinal: number
  sourceType: 'url' | 'file'
  sourceEntryId: number
  senderId: string
  senderName: string
  occurredAt: Date
  messageId?: string
}

interface GroupMessagesSnapshot {
  messages: GroupMessageContext[]
  imageRefs: StoredGroupImageRef[]
}

interface BufferedGroupTurn {
  storyId: string
  groupId: string
  rule: GroupChatRule
  channelId: string
  latestSession?: Session
  messages: (GroupMessageContext & { imageSources?: string[], imageSession?: Session, audioSources?: string[], audioSession?: Session, endpointId?: string })[]
  timer?: () => void
  revision: number
  mentionedBot: boolean
  quotedBot: boolean
  activeBatchEndpointIds?: string[]
}

export interface ExecutableMessageReaction extends MessageReactionDraft {
  messageId: string
}

export interface ExecutableGroupChatActions {
  replyTo?: { messageRef: string, messageId: string }
  reactions: ExecutableMessageReaction[]
}

interface GroupDeliveryResult {
  deliveredSegments: string[]
  complete: boolean
  segmentOutcomes: Array<{ index: number; content: string; status: 'delivered' | 'failed' | 'cancelled'; reason?: string }>
}

export interface StoryDefaults {
  characterName: string
  characterProfile: string
  perspective: string
  perspectives?: string[]
  supplementaryFacts?: string[]
  userProfile: string
  relationship: string
  world: string
  supportingCast: string
  location: string
  style: string
  timezone: string
}

export interface LoggingConfig {
  level: 'silent' | 'error' | 'warn' | 'info' | 'debug'
  /** Controls how much normal operational activity is written at info level. */
  verbosity?: 'summary' | 'standard' | 'diagnostic'
  format: 'compact' | 'detailed' | 'layered'
  /** Apply semantic ANSI colors; Koishi Console and normal terminals render them. */
  colors?: boolean
  /** Select a high-contrast ANSI palette for dark or light Console themes. */
  colorTheme?: 'dark' | 'light'
  /** Show fixed action kaomoji; false uses compact symbols instead. */
  kaomoji?: boolean
  logScriptPreview: boolean
  /** Emit user-visible incoming/outgoing message bodies to the plugin log. */
  logMessageContent?: boolean
  previewLength: number
}

export interface StoryStartReadiness {
  ready: boolean
  existing?: InterludeStory
  blockers: string[]
  warnings: string[]
  preview: {
    characterName: string
    characterProfile: boolean
    perspective: boolean
    world: boolean
    timezone: string
    model: string
    autoCreate: boolean
  }
}

export class InterludeService extends Service {
  static inject = ['database', 'http']
  private narrator: NarrativeProvider
  private compactor: NarrativeCompactor
  private worldSeeder: WorldSeeder = { available: false, generate: async () => { throw new Error('世界播种器未配置。') } }
  private worldSeederRuntime = resolveWorldSeederRuntime(undefined)
  private weatherConfig = resolveWeatherConfig(undefined)
  private weatherTimer: (() => void) | undefined
  private lastWeatherText = ''
  private qzoneRuntime = resolveQzoneConfig(undefined)
  private embedder: NarrativeEmbedder
  private stickerDescriber: StickerDescriber
  private visionDescriber: VisionDescriber
  private stickerCatalog: StickerAsset[] = []
  /** Whole-table semantic recall cache, one map per story: entry id → vector +
   * minimal content. Loaded lazily on first recall and extended incrementally
   * by the background backfill; never persisted. */
  private historyVectors = new Map<string, Map<number, HistoryVectorEntry>>()
  /** 桥接幂等（轻量修复）：桌面 30s 超时后入 inbox 重放时，同一消息会再次到达。
   * 用内存 Map 按 platform:messageId 去重——进程生命周期内有效，重启后由
   * script_entry.metadata.messageId 的磁盘记录兜底（重放场景不会跨重启）。 */
  private seenIncomingMessages = new Map<string, number>()
  private episodeIndexes = new Map<string, { source: Map<number, HistoryVectorEntry>; size: number; byEntry: Map<number, number[]>; ordered: Array<[number, HistoryVectorEntry]> }>()
  private historyVectorsReady = new Set<string>()
  private historyVectorLoads = new Map<string, Promise<void>>()
  private historyBackfills = new Set<string>()
  private historyBackoff = new Map<string, number>()
  private automaticRecallCache = new Map<string, {
    source: Map<number, HistoryVectorEntry>; size: number; key: string; until: number; result: RecalledMoment[]
  }>()
  /** Per-story retry-after timestamps for failed Schedule Preplan generations. */
  private schedulePreplanBackoff = new Map<string, number>()
  /** Per-story retry-after timestamps for a failed automatic timeline window. */
  private timelineBackoff = new Map<string, { from: number; until: number }>()
  /** Consecutive timeline-director failures per story; drives exponential backoff and the fuse. */
  private timelineDirectorFailures = new Map<string, number>()
  private stickerById = new Map<string, StickerAsset>()
  private stickerScanRunning = false
  /**
   * 同一故事的用户消息、到期意图和后台压缩必须串行。否则“用户新消息
   * 取消旧延迟回复”可能与定时发送同时发生，造成过期消息仍被发出。
   */
  private queues = new Map<string, Promise<unknown>>()
  private turnEngine!: TurnEngine   // P0: 回合状态管理已抽出至 turn-engine.ts
  private scheduler!: Scheduler     // P1: 到期唤醒/独占任务/指纹冷却已抽出至 scheduler.ts
  /** 端点注册表内存缓存（M1a）：行来自 interlude_endpoint；状态为进程内三维时效。 */
  private endpointRows: EndpointRow[] = []
  private endpointStates = new Map<string, EndpointState>()
  private endpointStateWriteQueue: Promise<unknown> = Promise.resolve()
  private endpointRegistryReady = false
  /** M1b 剧本别名缓存（interlude_story_alias），随注册表一同加载。 */
  private storyAliasRows: StoryAliasRecord[] = []
  /** M2 §1.3：入站接收序号（进程内单调递增；双端点回合排序依据）。 */
  private inboundSeq = 0
  private storyAliasProblems = new Set<string>()
  private bufferedGroupTurns = new Map<string, BufferedGroupTurn>()
  /** Short-lived group-member display names. QQ number remains the stable key. */
  private groupMemberNameCache = new Map<string, { name: string, expiresAt: number }>()
  private groupMemberNameLookups = new Map<string, Promise<string>>()
  /** Ephemeral, per-group willingness score. It never touches private turns or durable story state. */
  private groupWillingness = new Map<string, GroupWillingnessState>()
  /** Synchronously marks a relationship whose current typing chain was interrupted by new input. */
  private interruptedTypingParticipants = new Set<string>()
  /** Prevent a background life turn from racing an unlocked live model call. */
  private factBackfills = new Set<string>()
  /** Coalesce low-frequency atmosphere analysis without delaying the visible reply. */
  private scheduledAlterAnalyses = new Set<string>()
  /** sql.js/SQLite has one writable connection; serialize writes globally. */
  private databaseWriteQueue: Promise<unknown> = Promise.resolve()
  private transactionScope = new AsyncLocalStorage<Context['database']>()
  private transactionRunning = false
  /** The browser is bounded separately from narrative work so a burst of
   * deferred intents cannot spawn an uncontrolled number of Chromium pages. */
  private browserActive = 0
  private browserWaiters: Array<() => void> = []
  /** Use Koishi's context-bound logger so Console/runtime targets receive records. */
  private readonly serviceLogger: Logger
  private backgroundStarted = false
  private databaseResetting = false
  /** Invalidates model work that was prepared against a story before purge,
   * pause, or a runtime reset. The token is in-memory and intentionally does
   * not become part of the story schema. */
  private runtimeGeneration = 0
  private runtimePauseGeneration = 0
  private storyTaskGenerations = new Map<string, number>()
  private sweepRunning = false
  private compactionSweepRunning = false
  /** Startup/sweep compensation for durable pending script deliveries. The
   * backoff is process-local; the delivery ledger remains the source of truth
   * across restarts. */
  private pendingDeliveryRecoveryRunning = false
  /** Same authored event has one executor through transport AND confirmation. */
  private deliveryExecutors = new Set<string>()
  /** Known platform successes survive a local confirmation failure in this process. */
  private acceptedDeliveries = new Map<string, OutgoingMessageDraft>()
  private pendingDeliveryRecoveryBackoff = new Map<string, { attempts: number, retryAt: number }>()
  private blindModeHealthIssue = false
  /** Console reload creates a new service instance, so normalized config can
   * be cached safely for the lifetime of this instance. */
  private cachedAudioConfig?: AudioConfig
  private cachedStickerConfig?: StickerLibraryConfig
  private cachedAlterSystemConfig?: AlterSystemConfig
  private cachedAgencyConfig?: AgencyConfig
  private cachedSchedulePreplanConfig?: SchedulePreplanConfig
  private cachedBlindModeConfig?: BlindModeConfig
  /** P3: Console 健康面板的内存滚动指标（重载后归零）。 */
  readonly health = new HealthMonitor()
  /** Token 用量到达时可能尚未有 canonical story——用最近活跃的 storyId 记账。
   * P3 Fix: constructor 末尾初始化为当前 canonical story，减少首轮漏记。 */
  private lastActiveStoryId?: string
  private get canonicalStoryIdForHealth() { return this.lastActiveStoryId ?? '' }
  /** P2 Fix: 主动联系计数——发送动作入列后待平台确认的数量。 */
  private pendingProactiveCount = 0
  private cachedAutoAdvanceConfig?: AutoAdvanceConfig
  private cachedSharedStoryConfig?: SharedStoryConfig
  private cachedMemoryConfig?: MemoryConfig
  private cachedBrowserConfig?: BrowserConfig
  private readonly modelRouting: ModelRoutingTable
  /** Migration diagnostics are emitted once per story without changing Canon. */
  private reportedStateMigrations = new Set<string>()
  /** typ-0 uses this optional gate only inside a dedicated worker process. */
  private desktopRuntimePhase: DesktopRuntimePhase = 'running'
  private desktopEventSink?: (event: string, payload: unknown) => void
  /** typ0 桌面桥安装标记：离线补拉仅独立 Koishi 部署有意义（桌面有宿主收件箱兜底）。 */
  private desktopBridgeActive = false
  /**
   * typ-0 后台投递出口：delayed/split/advance 路径没有实时 Session，普通 Koishi
   * 里由 findBotForParticipant 走 adapter；typ-0 worker 中 bot 不存在，所有后台
   * 消息只能经宿主渠道投递。bridge 安装时注册，普通 Koishi 永远为空。
   */
  private desktopDeliveryHandler?: (delivery: {
    participantId: string, selfId: string, platform: string, channelId: string,
    kind: 'private' | 'group', content: string, quoteMessageId?: string,
    /** Optional desktop correlation metadata; background propagation is added in a later phase. */
    traceId?: string, processingId?: string,
    /** M3：模型显式选择的目标端点（B1-1 桥接透传；缺省按 selfId 路由）。 */
    endpointId?: string,
    /** 业务幂等键（scriptEvent.eventId + bubbleIndex），重试间稳定。
     * 宿主 outbox 据此跨 deliveryId 去重——迟到回执场景下 worker 30s 后用新
     * deliveryId 重发时，同一业务消息不会被再次发给用户。 */
    intentKey?: string,
  }) => Promise<{ ok: boolean, messageIds?: string[], error?: string }>

  /** W3（C2-1）：桥接动作代理出口——desktop-bridge 安装后非空；普通 Koishi 恒空。
   * qzoneCaller 与 sendSticker 桌面模式经此调用宿主代调上游 OneBot 动作。 */
  private desktopOnebotActionHandler?: (input: { accountKey: string, action: string, params?: Record<string, unknown>, timeoutMs?: number }) => Promise<{ ok: boolean, data?: unknown, errorCode?: string, ambiguous?: boolean, error?: string }>

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'interlude')
    this.serviceLogger = ctx.logger('hds-interlude')
    registerTables(ctx)
    // One shared token-usage sink: every chat task (main/compaction/alter/
    // sticker description) reports through here and lands in the Koishi log.
    const onUsage = (record: TokenUsageRecord) => {
      this.reportTokenUsage(record)
      // P3: token 用量进入健康面板（按当前 canonical 故事记账，重载后归零）。
      if (record.inputTokens || record.cachedInputTokens) {
        const storyId = this.canonicalStoryIdForHealth
        if (storyId) this.health?.recordTokens(storyId, record.inputTokens ?? 0, record.cachedInputTokens ?? 0)
      }
    }
    this.modelRouting = resolveModelRouting(config.model, config.alterSystem)
    this.narrator = createNarrator(ctx, config.model, this.blindModeConfig.enabled, onUsage, this.modelRouting)
    this.compactor = createCompactor(ctx, config.model, this.blindModeConfig.enabled, onUsage, this.modelRouting)
    this.embedder = createEmbedder(ctx, config.model, this.modelRouting)
    this.stickerDescriber = createStickerDescriber(ctx, config.model, this.blindModeConfig.enabled, onUsage, this.modelRouting)
    this.visionDescriber = createVisionDescriber(ctx, config.model, this.blindModeConfig.enabled, onUsage, this.modelRouting)
    // 播种器模型来自模型中心的“用于世界播种”勾选（useForWorldSeeding）；
    // 无勾选连接即视为关闭——不再单独复制一份提供商配置。
    const rawSeederProvider = (config.model.providers ?? []).find(provider => provider.enabled !== false && provider.useForWorldSeeding === true && provider.model?.trim())
    // World seeding uses the same connection rows as the other model tasks.
    // Resolve the row through the routing table so official presets receive
    // their normalized endpoint/protocol/defaults before any request is made.
    const seederProvider = rawSeederProvider
      ? this.modelRouting.providers.find(provider => provider.id === rawSeederProvider.id)
        ?? this.modelRouting.providers[(config.model.providers ?? []).indexOf(rawSeederProvider)]
      : undefined
    this.longHorizonConfig = resolveLongHorizonConfig((config as any).longHorizon)
    this.worldSeederRuntime = resolveWorldSeederRuntime(config.worldSeeder, seederProvider)
    void (async () => { try { const story = await this.getCanonicalStory(); if (story) { const active = await this.getActiveLongArcGuidance(story.id); if (active) this.activeLongArcGuidanceCache.set(story.id, active) } } catch (error) { this.reportStandaloneOperation('diagnostic', 'debug', '启动期长线指导缓存预加载跳过 错误=%s', error) } })()
    if (this.worldSeederRuntime.enabled) {
      this.worldSeeder = createWorldSeeder(ctx, config.model, this.worldSeederRuntime, onUsage)
      this.reportStandaloneOperation('standard', 'info', '世界播种器已启用 模型=%s 间隔=%d分钟', this.worldSeederRuntime.provider?.model, this.worldSeederRuntime.cadenceMinutes)
    }
    // QQ 空间通道：限流参数来自 Console；实际可用性在首次动作时探测（SnowLuma 离线则优雅关闭）。
    this.qzoneRuntime = resolveQzoneConfig(config.qzone as Partial<QzoneConfig> | undefined)
    if (this.qzoneRuntime.enabled) {
      this.reportStandaloneOperation('standard', 'info', 'QQ 空间通道已启用 发帖/评论/点赞上限=%d/%d/%d 最小间隔=%d分钟', this.qzoneRuntime.dailyPostCap, this.qzoneRuntime.dailyCommentCap, this.qzoneRuntime.dailyLikeCap, this.qzoneRuntime.minIntervalMinutes)
    }
    // P2 Fix: 侧端任务成败上报到健康面板——注册必须在 narrator/compactor 创建之后，
    // 参数签名为 (task, ok)。narrator 和 compactor 是独立实例，都要注册。
    const sideTaskHealthReporter = (_task: string, ok: boolean) => {
      const storyId = this.canonicalStoryIdForHealth
      if (storyId) this.health?.recordSideTask(storyId, ok)
    }
    for (const target of [this.narrator, this.compactor]) {
      if (target && typeof (target as any).setSideTaskHealthReporter === 'function') {
        ;(target as any).setSideTaskHealthReporter(sideTaskHealthReporter)
      }
    }
    // Defer timer registration by one event-loop turn. This keeps Console
    // plugin load/reload responsive while preserving the same background work.
    // TurnEngine：回合状态管理（缓冲回合容器 + narrating 标记）集中于此，
    // service 通过工厂返回的方法访问；getter 保证 debounce 秒数随配置热更新。
    {
      const service = this
      this.turnEngine = createTurnEngine({
        setTimeout: (fn: () => void, ms: number) => this.ctx.setTimeout(fn, ms),
        get userMessageDebounceSeconds() { return service.config.runtime.userMessageDebounceSeconds ?? 2 },
        scheduleTurnFlush: (key, revision) => void this.flushBufferedNarrative(key, revision),
        reportOperation: (level: string, kind: string, story: InterludeStory, phase: string, message: string, ...args: unknown[]) => {
          this.reportOperation(level as 'summary' | 'standard' | 'diagnostic', kind as 'error' | 'warn' | 'info' | 'debug', story, phase as NarrativeRequest['phase'], message, ...args)
        },
      })
    }
    // P1: Scheduler 初始化——到期唤醒/独占任务/指纹冷却的最小依赖注入
    {
      const service = this
      this.scheduler = createScheduler({
        setTimeout: (fn: () => void, ms: number) => this.ctx.setTimeout(fn, ms),
        retryDelayMs: Time.second,
        deferDelayMs: 500,
        onWakeError: error => service.reportStandaloneOperation('diagnostic', 'debug', '到期消息唤醒失败 错误=%s', error),
        onTaskError: error => service.reportStandaloneOperation('diagnostic', 'debug', '记忆压缩跳过 错误=%s', error),
      })
    }
    ctx.setTimeout(() => this.startBackgroundTasks(), 0)
    // The logger target may not be installed yet during plugin construction;
    // emit a second lifecycle record after Koishi is ready so it is visible in
    // both the terminal and Console log panel.
    ctx.on('ready', async () => {
      await this.syncGroupAssignees()
      this.reportStandaloneOperation('summary', 'info', '服务已就绪')
    })
    this.reportStandaloneOperation('summary', 'info', '服务初始化完成 主叙事路由=%s 共享主剧本=%s 自动推进=%s', this.modelRouting.main.available ? '已配置' : '未配置', this.sharedStoryConfig.enabled, this.autoAdvanceConfig.enabled)
    this.reportStandaloneOperation('diagnostic', 'debug', '模型任务路由 %s', formatModelRouting(this.modelRouting))
  }

  /** Apply explicit Console routing choices before normal group middleware runs.
   * Do not prepend receiveGroup: that would bypass Koishi's ignore/user gates. */
  private async syncGroupAssignees() {
    const config = this.config.onebot
    if (!config?.enabled) return
    const seen = new Set<string>()
    for (const rule of config.groupChats ?? []) {
      if (rule.enabled === false) continue
      const groupId = normalizeGroupId(rule.groupId)
      // Keep the same first-enabled-row semantics as groupRule().
      if (seen.has(groupId)) continue
      seen.add(groupId)
      const assignee = normalizeAccountId(rule.assignee)
      if (!assignee) {
        // 清空/移除受理人时回写为原生路由——此前直接 continue,channel.assignee
        // 永久钉在旧账号,消息继续路由给已移出白名单的机器人
        try {
          const channel = await this.ctx.database.getChannel('onebot', groupId, ['assignee'])
          if (channel?.assignee) {
            await this.ctx.database.setChannel('onebot', groupId, { assignee: null })
            this.reportStandalone('info', '群受理人已清除，恢复原生路由 群=%s（原=%s）', groupId, channel.assignee)
          }
        } catch (error) {
          this.reportStandalone('warn', '清除群受理人失败 群=%s 错误=%s', groupId, error)
        }
        continue
      }
      if (!/^\d+$/.test(groupId) || !/^\d+$/.test(assignee) || !isEnabledAccount(config.botAccounts, assignee)) {
        this.reportStandalone('warn', '群受理人配置未应用：群号/QQ 无效或受理人不在启用的机器人白名单 群=%s 受理人=%s', groupId, assignee)
        continue
      }
      try {
        const query = { platform: 'onebot', id: groupId }
        const [channel] = await this.ctx.database.get('channel', query, ['assignee'])
        if (channel?.assignee === assignee) continue
        // A partial upsert preserves existing flags, permissions and locales;
        // it also handles a new group before its first unmentioned message.
        await this.ctx.database.upsert('channel', [{
          ...query, assignee,
          ...(!channel ? { guildId: groupId, createdAt: new Date() } : {}),
        }], ['platform', 'id'])
        this.reportStandaloneOperation('standard', 'info', '群受理人已同步 群=%s 原受理人=%s 新受理人=%s', groupId, channel?.assignee || '未设置', assignee)
      } catch (error) {
        // One invalid/broken row must not prevent other groups or the service
        // from starting. The configured value can be retried on the next reload.
        this.reportStandalone('warn', '群受理人同步失败，保留原频道路由 群=%s 受理人=%s 错误=%s', groupId, assignee, error)
      }
    }
  }

  private startBackgroundTasks() {
    if (this.backgroundStarted) return
    this.backgroundStarted = true
    activeServiceForEndpoints = this  // M2：sameParticipantEndpoint 集合匹配读注册表
    // 连接器生命周期接入端点在线状态——连接/断开即时回写，不再只靠
    // 出入站间接刷新（管理命令显示的在线状态因此不再滞后）。
    // Koishi/Satori 的 Status.ONLINE 是数字枚举 1，不是字符串 "active"。
    this.ctx.on('bot-status-updated', bot => {
      try {
        const online = isBotOnlineStatus(bot.status)
        this.noteEndpointConnection(
          endpointAccountKey(bot.platform, String(bot.selfId ?? '')),
          online,
        )
        if (online) void this.recoverPendingDeliveries(true).catch(error =>
          this.reportStandalone('warn', '端点上线后待投递恢复失败 错误=%s', error))
      } catch { /* 生命周期回调不抛错 */ }
    })
    // 重启后的持久快照故意保持 offline；注册表就绪后重新读取当前 bot，
    // 避免因错过 bot-status-updated 事件而一直等到下一条入站消息才恢复。
    void (async () => {
      try {
        await this.syncCurrentBotConnections()
        // Let adapter lifecycle callbacks and endpoint state writes settle before
        // the first compensation pass. A later sweep remains the fallback.
        this.ctx.setTimeout(() => void this.recoverPendingDeliveries().catch(error =>
          this.reportStandalone('warn', '启动期待投递恢复失败 错误=%s', error)), 10 * Time.second)
      } catch (error) {
        this.reportStandalone('warn', '启动期端点在线状态同步失败 错误=%s', error)
      }
    })()
    this.ctx.on('bot-removed', bot => {
      try { this.noteEndpointConnection(endpointAccountKey(bot.platform, String(bot.selfId ?? '')), false) } catch { /* 同上 */ }
    })
    // 离线补拉：插件加载后延迟 15 秒执行（等 bot 连接就绪），只跑一次。
    this.ctx.setTimeout(() => void this.offlineGroupCatchup().catch(error =>
      this.reportStandaloneOperation('diagnostic', 'warn', '群消息离线补拉异常 错误=%s', error)), 15 * Time.second)
    // Life advancement and memory compaction are both serialized per story.
    const sweepInterval = Math.max(1, this.config.runtime.sweepIntervalMinutes)
    this.ctx.setInterval(() => this.reportStuckSerialQueues(), 60 * Time.second)
    this.ctx.setInterval(() => {
      void this.sweep().catch(error => this.reportStandalone('error', '后台推进失败 错误=%s', error))
      // P1：bot-status-updated 丢失时（适配器 getLogin 失败、事件早于注册表
      // 就绪），端点在线状态会卡死 offline 直到下一条入站。每轮 sweep 重同步
      // ctx.bots 实况，把最坏窗口压到一个 sweep 周期内。
      void this.syncCurrentBotConnections().catch(() => undefined)
      void this.recoverPendingDeliveries().catch(error => this.reportStandalone('warn', '周期性待投递恢复失败 错误=%s', error))
    }, sweepInterval * Time.minute)
    if (this.memoryConfig.enabled || this.schedulePreplanConfig.enabled) this.ctx.setInterval(() => void this.compactStories().catch(error => this.reportStandalone('error', '后台整理失败 错误=%s', error)), Math.max(1, this.memoryConfig.backgroundIntervalMinutes) * Time.minute)
    if (this.worldSeederRuntime.enabled && this.worldSeeder.available) {
      this.ctx.setInterval(() => void this.worldSeederSweep().catch(error => this.reportStandalone('warn', '世界播种器运行失败 错误=%s', error)), this.worldSeederRuntime.cadenceMinutes * Time.minute)
    }
    // 天气服务:定时拉取 → seeded_event 滚动注入
    this.weatherConfig = resolveWeatherConfig((this.config as any).weather)
    if (this.weatherConfig.enabled) {
      this.weatherTimer = this.ctx.setInterval(() => void this.weatherSweep().catch(error => this.reportStandalone('warn', '天气服务运行失败 错误=%s', error)), this.weatherConfig.cadenceMinutes * Time.minute)
      this.reportStandaloneOperation('standard', 'info', '天气服务已启用 间隔=%d分钟 观测点=%s', this.weatherConfig.cadenceMinutes, this.weatherConfig.autoFromLocation ? '按故事地点自动解析' : `${this.weatherConfig.latitude},${this.weatherConfig.longitude}`)
    }
    // 好友动态轮询：感知窗口的一半作节律（15~60 分钟夹取），单次最多入账 2 条。
    if (this.qzoneRuntime.enabled) {
      const feedPollMinutes = Math.min(60, Math.max(15, Math.round(this.qzoneRuntime.feedWindowMinutes / 2)))
      this.ctx.setInterval(() => void this.qzoneFeedSweep().catch(error => this.reportStandalone('warn', 'QQ 空间动态轮询失败 错误=%s', error)), feedPollMinutes * Time.minute)
    }
    if (this.blindModeConfig.enabled) {
      this.ctx.setInterval(() => this.reportBlindModeHealth(), this.blindModeConfig.healthReportMinutes * Time.minute)
    }
    if (this.stickerConfig.enabled) {
      this.ctx.setTimeout(() => void this.scanStickerLibrary(), 0)
      this.ctx.setInterval(() => void this.scanStickerLibrary(), 5 * Time.minute)
    }
    this.reportStandaloneOperation('standard', 'info', '后台调度已启动 剧本扫描=%d分钟 记忆扫描=%d分钟', sweepInterval, this.memoryConfig.backgroundIntervalMinutes)
  }

  /** Recover only the durable outgoing-message ledger. The narrative intent is
   * deliberately not consulted here: an intent may already be completed while
   * its transport action is still pending, and replaying the intent would run a
   * second model turn. DeliveryActions are the outbox truth. */
  private async recoverPendingDeliveries(force = false, storyId?: string) {
    if (this.pendingDeliveryRecoveryRunning || this.databaseResetting || this.desktopRuntimePhase === 'paused') return
    this.pendingDeliveryRecoveryRunning = true
    const startedAt = Date.now()
    let attempted = 0
    let delivered = 0
    const limit = 32
    try {
      await this.ensureEndpointRegistry()
      const stories = storyId
        ? [await this.getStory(storyId)]
        : await this.dbGet('interlude_story', { status: 'active' }) as InterludeStory[]
      for (const story of stories) {
        if (attempted >= limit || this.databaseResetting || (this.desktopRuntimePhase as string) === 'paused') break
        if (story.status !== 'active') continue
        const owners = new Map<string, number>()
        const splits = await this.dbGet('interlude_intent', { storyId: story.id, type: 'split-message' }) as NarrativeIntent[]
        for (const intent of splits) {
          const ref = restoreMessageEvent(intent.payload, String(intent.payload?.content ?? ''))
          if (ref?.scriptEntryId) {
            const key = JSON.stringify([ref.scriptEntryId, ref.commitId, ref.eventId, ref.bubbleIndex ?? 0])
            if (!owners.has(key)) owners.set(key, intent.id)
          }
        }
        let cursor = 0
        while (attempted < limit && !this.databaseResetting && (this.desktopRuntimePhase as string) !== 'paused') {
          const entries = await this.dbGet('interlude_script_entry', { storyId: story.id, kind: 'script', id: { $gt: cursor } }, { sort: { id: 'asc' }, limit: 256 }) as ScriptEntry[]
          if (!entries.length) break
          cursor = entries.at(-1)!.id
          const candidates = entries.flatMap(entry => this.pendingOutgoingDeliveryCandidates(entry))
          for (const candidate of candidates) {
            if (attempted >= limit) break
            const key = this.pendingDeliveryRecoveryKey(candidate)
            const retry = this.pendingDeliveryRecoveryBackoff.get(key)
            if (!force && retry && retry.retryAt > Date.now()) continue
            // 陈旧截止:条目发生时间超过 2 小时前的不补投——升级后历史积压
            // 会一次性冲出跨天消息洪水(实测 25 条/12 天),转 cancelled + 说明
            const entryOccurredAt = toDate(candidate.event.occurredAt)
            if (entryOccurredAt && entryOccurredAt.getTime() < Date.now() - 2 * Time.hour) {
              await this.updateScriptDeliveryOutcome(story.id,
                { commitId: candidate.commitId, eventId: candidate.eventId, scriptEntryId: candidate.entryId, segmentIndex: candidate.segmentIndex },
                'cancelled', new Date(), 'stale-pending-recovery-cutoff')
              this.reportOperation('diagnostic', 'debug', story, 'advance',
                '待投递补偿跳过陈旧条目(>2h) 条目=%d 委托=%s 事件=%s', candidate.entryId, candidate.commitId, candidate.eventId)
              continue
            }
            attempted++
            try {
              const outcome = await runStorySerialized(this, story.id, async () => this.recoverPendingDeliveryCandidate(story, candidate, owners))
              if (outcome === 'delivered' || outcome === 'cancelled' || outcome === 'gone') {
                this.pendingDeliveryRecoveryBackoff.delete(key)
                if (outcome === 'delivered') delivered++
                continue
              }
              this.deferPendingDeliveryRecovery(key)
            } catch (error) {
              this.deferPendingDeliveryRecovery(key)
              this.reportStandalone('warn', '待投递恢复尝试失败 故事=%s 条目=%d 事件=%s 分段=%d 错误=%s', story.id, candidate.entryId, candidate.eventId, candidate.segmentIndex, error)
            }
          }
        }
      }
      if (attempted || delivered) {
        this.reportStandaloneOperation('standard', 'info', '待投递补偿扫描完成 尝试=%d 成功=%d 耗时=%dms', attempted, delivered, Date.now() - startedAt)
      }
    } finally {
      this.pendingDeliveryRecoveryRunning = false
    }
  }

  private pendingOutgoingDeliveryCandidates(entry: ScriptEntry) {
    const actions = Array.isArray(entry.metadata?.deliveryActions) ? entry.metadata.deliveryActions : []
    const events = Array.isArray(entry.metadata?.scriptEvents) ? entry.metadata.scriptEvents : []
    const candidates: Array<{
      entryId: number
      commitId: string
      eventId: string
      event: ScriptEventDraft
      participantId: string
      endpointId?: string
      segmentIndex: number
      content: string
    }> = []
    for (const raw of actions) {
      if (!isRecord(raw) || (raw.status !== 'pending' && raw.status !== 'partial') || !Array.isArray(raw.segments)) continue
      const action = raw as unknown as ScriptDeliveryAction
      const rawEvent = events.find(item => isRecord(item) && item.commitId === action.commitId && item.eventId === action.eventId)
      if (!isRecord(rawEvent) || !isOutgoingScriptEvent(rawEvent as unknown as ScriptEventDraft)) continue
      const event = rawEvent as unknown as ScriptEventDraft
      for (const segment of action.segments) {
        if (!isRecord(segment) || segment.kind !== 'message' || segment.status !== 'pending' || typeof segment.content !== 'string' || !segment.content) continue
        // 群 pending 段(group-message 事件不带 participantId):从事件/行动的
        // endpointId 解析群目标;有群目标即入候选——此前 continue 让群发段
        // 崩溃后永久 pending 且 deliveryReality 持续报 not-confirmed
        const groupEndpointId = typeof event.endpointId === 'string' && event.endpointId.trim()
          ? event.endpointId.trim()
          : typeof action.endpointId === 'string' && action.endpointId.trim()
            ? action.endpointId.trim()
            : ''
        const participantId = typeof event.participantId === 'string' && event.participantId.trim()
          ? event.participantId.trim()
          : typeof action.participantId === 'string' && action.participantId.trim()
            ? action.participantId.trim()
            : entry.participantId.trim()
        if (!participantId && !groupEndpointId) continue
        if (!participantId && groupEndpointId && !groupEndpointId.startsWith('group:')) continue
        candidates.push({
          entryId: entry.id, commitId: action.commitId, eventId: action.eventId, event,
          participantId: participantId || groupEndpointId, ...(event.endpointId || action.endpointId ? { endpointId: event.endpointId ?? action.endpointId } : {}),
          segmentIndex: segment.index, content: segment.content,
        })
      }
    }
    return candidates
  }

  private pendingDeliveryRecoveryKey(candidate: { entryId: number, commitId: string, eventId: string, segmentIndex: number }) {
    return `${candidate.entryId}:${candidate.commitId}:${candidate.eventId}:${candidate.segmentIndex}`
  }

  private deferPendingDeliveryRecovery(key: string) {
    const prior = this.pendingDeliveryRecoveryBackoff.get(key)
    const attempts = (prior?.attempts ?? 0) + 1
    const delay = Math.min(15 * Time.minute, 30_000 * 2 ** Math.min(attempts - 1, 5))
    this.pendingDeliveryRecoveryBackoff.set(key, { attempts, retryAt: Date.now() + delay })
  }

  private async recoverPendingDeliveryCandidate(story: InterludeStory, candidate: ReturnType<InterludeService['pendingOutgoingDeliveryCandidates']>[number], owners?: Map<string, number>): Promise<'delivered' | 'pending' | 'cancelled' | 'gone'> {
    const generation = this.taskGeneration(story.id)
    if (!this.taskGenerationCurrent(story.id, generation)) return 'pending'
    const liveStory = await this.getStory(story.id)
    if (liveStory.status !== 'active' || !this.taskGenerationCurrent(story.id, generation)) return 'pending'
    const entry = (await this.dbGet('interlude_script_entry', { id: candidate.entryId }))[0] as ScriptEntry | undefined
    if (!entry || entry.storyId !== story.id) return 'gone'
    const current = this.pendingOutgoingDeliveryCandidates(entry).find(item => item.commitId === candidate.commitId && item.eventId === candidate.eventId && item.segmentIndex === candidate.segmentIndex)
    if (!current) {
      const action = Array.isArray(entry.metadata?.deliveryActions)
        ? entry.metadata.deliveryActions.find(item => isRecord(item) && item.commitId === candidate.commitId && item.eventId === candidate.eventId) as Record<string, unknown> | undefined
        : undefined
      const status = Array.isArray(action?.segments)
        ? action.segments.find(item => isRecord(item) && item.index === candidate.segmentIndex)?.status
        : undefined
      return status === 'delivered' ? 'delivered' : status === 'cancelled' ? 'cancelled' : 'gone'
    }
    const scriptEvent = messageEventReference(current.event, current.segmentIndex, entry.id)
    if (!scriptEvent) return 'gone'
    // A durable split intent owns this bubble's timing and interruption. The
    // outbox compensator must not become a competing sender for the same key.
    const ownerId = owners?.get(JSON.stringify([entry.id, current.commitId, current.eventId, current.segmentIndex]))
    const splits = (owners
      ? ownerId ? await this.dbGet('interlude_intent', { storyId: story.id, id: ownerId }) : []
      : await this.dbGet('interlude_intent', { storyId: story.id, participantId: current.participantId, type: 'split-message' })) as NarrativeIntent[]
    const owner = splits.find(intent => {
      const ref = restoreMessageEvent(intent.payload, current.content)
      return ref?.scriptEntryId === entry.id && ref.commitId === current.commitId
        && ref.eventId === current.eventId && ref.bubbleIndex === current.segmentIndex
    })
    if (!this.taskGenerationCurrent(story.id, generation)) return 'pending'
    if (owner?.status === 'pending') {
      await this.scheduleNextSplitWake(story.id)
      return 'pending'
    }
    if (owner?.status === 'completed' || owner?.status === 'cancelled') {
      const status = owner.status === 'completed' ? 'delivered' : 'cancelled'
      await this.updateScriptDeliveryOutcome(story.id, scriptEvent, status, new Date(), 'split-intent-terminal-reconciliation')
      return status
    }
    const message: OutgoingMessageDraft = {
      participantId: current.participantId,
      content: current.content,
      ...(current.endpointId ? { endpointId: current.endpointId } : {}),
      userInitiated: false,
      scriptEvent,
    }
    if (!this.taskGenerationCurrent(story.id, generation)) return 'pending'
    // 与分段投递路径同款守卫:打断标志期间不补发(次序倒置不可逆),参与者
    // 非 active 不投递(向已删除/暂停参与者发送不可撤回)
    if (this.interruptedTypingParticipants.has(current.participantId)) return 'pending'
    const recoveryParticipant = current.participantId ? await this.getParticipant(current.participantId) : undefined
    if (current.participantId && (!recoveryParticipant || recoveryParticipant.status !== 'active')) {
      await this.updateScriptDeliveryOutcome(story.id, scriptEvent, 'cancelled', new Date(), 'participant-inactive-recovery')
      return 'cancelled'
    }
    await this.deliverOutgoingMessages(story, [message], undefined, undefined, undefined, true, undefined, 'pending')
    const fresh = (await this.dbGet('interlude_script_entry', { id: entry.id }))[0] as ScriptEntry | undefined
    const action = Array.isArray(fresh?.metadata?.deliveryActions)
      ? fresh.metadata.deliveryActions.find(item => isRecord(item) && item.commitId === current.commitId && item.eventId === current.eventId) as Record<string, unknown> | undefined
      : undefined
    const segment = Array.isArray(action?.segments)
      ? action.segments.find(item => isRecord(item) && item.index === current.segmentIndex) as Record<string, unknown> | undefined
      : undefined
    if (segment?.status === 'delivered') return 'delivered'
    if (segment?.status === 'cancelled') return 'cancelled'
    return 'pending'
  }

  setNarrator(provider: NarrativeProvider) { this.narrator = provider }
  getNarrator() { return this.narrator }
  setCompactor(provider: NarrativeCompactor) { this.compactor = provider }
  /** Allows a custom/local vector service without replacing the main narrator. */
  setEmbedder(provider: NarrativeEmbedder) { this.embedder = provider }

  /** Optional typ-0 bridge hook. No sink is installed in normal Koishi use. */
  setDesktopEventSink(sink?: (event: string, payload: unknown) => void) { this.desktopEventSink = sink; this.desktopBridgeActive = !!sink }
  /** Puppeteer 缺失提示进程内只打一次。 */
  private puppeteerHintLogged = false
  /** HMR 重载/停机守卫：stop() 置位后，失败源于插件卸载而非提供商故障，
   * 不再排持久化的叙事重试（重试意图存活于数据库，会在新实例上投递一条
   * 过期回复），也不再以 warn/error 刷屏。 */
  private disposed = false
  /** 确定性失败的图片源负缓存：key = 原始 source 串，value = 首次失败原因。
   * 覆盖两类永不自愈的失败：① QQ CDN 链接过期（HTTP 400 / retcode
   * -5503007）；② 结构性不可用——非白名单域（如实测出现的 koishi.js.org
   * 资源链接）、非法 source、超限 data-URI、超限字节数、非图片 MIME。
   * 命中即跳过网络与重复告警；FIFO 有界。瞬时性失败（空响应、超时、
   * 网络错误、会话缺失导致的 file 引用不可解析）不入缓存。 */
  private deadImageSources = new Map<string, string>()
  /** typ-0 bridge 在安装时注册后台投递通道；卸载时传 undefined 复原。 */
  setDesktopDeliveryHandler(handler?: InterludeService['desktopDeliveryHandler']) { this.desktopDeliveryHandler = handler }

  setDesktopOnebotActionHandler(handler?: InterludeService['desktopOnebotActionHandler']) { this.desktopOnebotActionHandler = handler }
  getDesktopRuntimePhase() { return this.desktopRuntimePhase }
  async setDesktopRuntimePhase(phase: DesktopRuntimePhase) {
    if (phase === 'paused' && this.desktopRuntimePhase !== 'paused') {
      this.runtimePauseGeneration = (this.runtimePauseGeneration ?? 0) + 1
    }
    this.desktopRuntimePhase = phase
    if (phase === 'paused') {
      this.scheduler.cancelWakes()
      for (const turn of this.turnEngine.turns.values()) {
        if (turn.timer) turn.timer()
        turn.timer = undefined
      }
      for (const turn of this.bufferedGroupTurns.values()) {
        if (turn.timer) turn.timer()
        turn.timer = undefined
      }
    } else if (phase === 'running') {
      // Resume only turns which were already persisted before pause. This
      // avoids both losing a message and manufacturing a new user event.
      this.turnEngine.rescheduleTimers((key, revision) => void this.flushBufferedNarrative(key, revision))
      for (const [key, turn] of this.bufferedGroupTurns) {
        if (turn.timer || !turn.messages.length) continue
        const revision = ++turn.revision
        turn.timer = this.ctx.setTimeout(() => void this.flushGroupTurn(key, revision), 0)
      }
    }
    this.desktopEventSink?.('runtime-snapshot', await this.desktopRuntimeSnapshot())
  }

  /** Snapshot is intentionally small; detailed timeline uses desktopTimelineSnapshot below. */
  async desktopRuntimeSnapshot() {
    const stories = await this.dbGet('interlude_story', {}, { limit: 20, sort: { updatedAt: 'desc' } }) as InterludeStory[]
    return {
      phase: this.desktopRuntimePhase,
      stories: stories.map(story => ({ id: story.id, status: story.status, cursorAt: story.cursorAt.toISOString(), updatedAt: story.updatedAt.toISOString() })),
    }
  }

  /**
   * Endpoint health is deliberately projected by the worker.  This keeps the
   * desktop read-only and, more importantly, makes all availability decisions
   * use the same channel-aware TTL/cooldown rules as delivery itself.
   */
  async desktopEndpointHealthSnapshot() {
    await this.ensureEndpointRegistry()
    const now = Date.now()
    const endpoints: DesktopEndpointHealth[] = this.endpointRows.map(row => {
      const state = this.endpointStates.get(row.id)
      const deliverable = row.enabled && isEndpointDeliverable(state, now, row)
      // `initiate` is optional because QQ/OneBot has no context-token gate;
      // absence therefore means "no extra gate", not a permanently blocked
      // endpoint.  We still require the ordinary delivery gate so the desktop
      // projection cannot advertise a disconnected endpoint as initiable.
      const initiateAllowed = row.enabled && deliverable
        && (!state?.initiate || isEndpointInitiateAllowed(state, now))
      return {
        endpointId: row.id,
        ownerKind: row.ownerKind,
        ownerId: row.ownerId,
        platform: row.platform,
        channelKind: row.channelKind,
        enabled: row.enabled,
        online: state?.connection.online === true,
        observedAt: new Date(state?.connection.observedAt ?? now).toISOString(),
        deliverable,
        initiateAllowed,
        ...(state?.deliverable.cooldownUntil ? { cooldownUntil: new Date(state.deliverable.cooldownUntil).toISOString() } : {}),
        ...(!deliverable && state?.deliverable.note ? { lastError: state.deliverable.note } : {}),
        ...(state?.deliverable.note ? { note: state.deliverable.note } : {}),
      }
    })
    return { protocol: 1, generatedAt: new Date(now).toISOString(), endpoints }
  }

  /** Read-only desktop projection. The host never opens or mutates HDSI tables directly. */
  async desktopTimelineSnapshot() {
    const story = await this.getCanonicalStory()
    if (!story) return { storyId: '', entries: [], scenes: [], facts: [] }
    const [entries, scenes, facts, preplan] = await Promise.all([
      this.dbGet('interlude_script_entry', { storyId: story.id }, { limit: 120, sort: { occurredAt: 'desc' } }) as Promise<ScriptEntry[]>,
      this.dbGet('interlude_scene', { storyId: story.id }, { limit: 12, sort: { startedAt: 'desc' } }) as Promise<InterludeScene[]>,
      this.dbGet('interlude_fact', { storyId: story.id, status: 'active' }, { limit: 24, sort: { importance: 'desc', updatedAt: 'desc' } }) as Promise<NarrativeFact[]>,
      this.getSchedulePreplan(story.id),
    ])
    return {
      storyId: story.id,
      cursorAt: story.cursorAt.toISOString(), updatedAt: story.updatedAt.toISOString(), timezone: story.setting.timezone,
      entries: entries.reverse().map(entry => ({
        id: entry.id, storyId: entry.storyId, participantId: entry.participantId, kind: entry.kind, actor: entry.actor,
        content: entry.content, occurredAt: entry.occurredAt.toISOString(), metadata: entry.metadata,
      })),
      scenes: scenes.map(scene => ({
        id: scene.id, status: scene.status, startedAt: scene.startedAt.toISOString(), endedAt: scene.endedAt?.toISOString(),
        hook: scene.hook, summary: scene.summary, entryCount: scene.entryCount,
      })),
      facts: facts.map(fact => ({
        id: fact.id, scope: fact.scope, content: fact.content, importance: fact.importance, confidence: fact.confidence,
        unresolved: fact.unresolved, updatedAt: fact.updatedAt.toISOString(),
      })),
      preplan: preplan ? {
        revision: preplan.revision, timezone: preplan.timezone, validFrom: preplan.validFrom,
        validThrough: preplan.validThrough, materializedDays: preplan.materializedDays,
      } : undefined,
    }
  }

  /**
   * typ-0 选区删除的受控入口：QQ 指令路径有人工确认间隔，bridge 路径没有，
   * 因此 purge 必须在 worker 内的 serial 队列中执行，保证与写作回合互斥。
   * purgeStoryRange 本身是软删（redacted/deleted/superseded）并处理
   * sourceEntryIds 级联；Canon 与参与者身份保持不动。
   */
  async desktopPurgeRange(from: Date, to: Date) {
    const story = await this.getCanonicalStory()
    if (!story) throw new Error('当前 worker 没有可操作的剧本。')
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new Error('选区删除时间范围无效。')
    }
    return this.serial(story.id, async () => {
      await this.purgeStoryRange(story.id, from, to)
      return { storyId: story.id }
    })
  }

  /**
   * Versioned, bounded read model for typ-0 Arrangement.  It deliberately
   * exposes HDSI's stored temporal facts only: callers cannot create timeline
   * objects, and legacy entries without an explicit automatic window remain
   * point events instead of receiving a guessed duration from their prose.
   */
  async desktopTimelineRange(request: DesktopTimelineRangeRequest = {}) {
    const story = await this.getCanonicalStory()
    if (!story) return emptyDesktopTimelineRange()
    const query = normalizeDesktopTimelineRangeRequest(request)
    const entryQuery = timelineEntryQueryAfter({
      storyId: story.id,
      occurredAt: { $gte: query.from, $lte: query.to },
    }, query.cursor)
    const candidateLimit = Math.min(query.limit * 4 + 1, 501)
    const [entryRows, sceneRows, factRows, preplan] = await Promise.all([
      this.dbGet('interlude_script_entry', entryQuery, { limit: candidateLimit, sort: { occurredAt: 'desc', id: 'desc' } }) as Promise<ScriptEntry[]>,
      query.tracks.has('scenes')
        ? this.dbGet('interlude_scene', { storyId: story.id }, { limit: 100, sort: { startedAt: 'desc' } }) as Promise<InterludeScene[]>
        : Promise.resolve([] as InterludeScene[]),
      query.tracks.has('facts')
        ? this.dbGet('interlude_fact', { storyId: story.id, status: 'active' }, { limit: 100, sort: { updatedAt: 'desc' } }) as Promise<NarrativeFact[]>
        : Promise.resolve([] as NarrativeFact[]),
      query.tracks.has('preplan') ? this.getSchedulePreplan(story.id) : Promise.resolve(undefined),
    ])
    const selectedEntries = entryRows
      .filter(entry => entry.kind !== 'redacted')
      .filter(entry => query.tracks.has(desktopTimelineTrackForEntry(entry)))
      .slice(0, query.limit)
      .reverse()
    const entries = selectedEntries.map(entry => desktopTimelineEntryView(entry))
    const scenes = sceneRows.filter(scene => desktopRangeOverlaps(query.from, query.to, scene.startedAt, scene.endedAt))
      .map(scene => ({ id: scene.id, status: scene.status, startedAt: scene.startedAt.toISOString(), endedAt: scene.endedAt?.toISOString(), hook: scene.hook, summary: scene.summary, entryCount: scene.entryCount }))
    const facts = factRows.filter(fact => fact.updatedAt >= query.from && fact.updatedAt <= query.to)
      .map(fact => ({ id: fact.id, scope: fact.scope, content: fact.content, importance: fact.importance, confidence: fact.confidence, unresolved: fact.unresolved, updatedAt: fact.updatedAt.toISOString() }))
    const latestEntryId = entryRows[0]?.id ?? 0
    const latestScene = scenes.reduce((latest, scene) => !latest || scene.startedAt > latest ? scene.startedAt : latest, '')
    const latestFact = facts.reduce((latest, fact) => !latest || fact.updatedAt > latest ? fact.updatedAt : latest, '')
    // Alter 状态投影：从 story.state.alterSystem 提取当前值与 history 供桌面轨道渲染。
    const alterProjection = this.projectAlterForDesktop(story)
    // 压缩状态投影：当前活跃场景的 entryCount / 最后压缩时间。
    const compactionProjection = this.projectCompactionForDesktop(story, sceneRows)
    return {
      protocol: 4,
      storyId: story.id,
      revision: `${story.updatedAt.toISOString()}:${latestEntryId}:${preplan?.revision ?? 0}:${latestScene}:${latestFact}`,
      range: { from: query.from.toISOString(), to: query.to.toISOString() },
      cursorAt: story.cursorAt.toISOString(), updatedAt: story.updatedAt.toISOString(), timezone: story.setting.timezone,
      entries, scenes, facts,
      preplan: preplan ? { revision: preplan.revision, timezone: preplan.timezone, validFrom: preplan.validFrom, validThrough: preplan.validThrough, materializedDays: preplan.materializedDays } : undefined,
      alter: alterProjection,
      compaction: compactionProjection,
      nextCursor: entryRows.length === candidateLimit && selectedEntries[0] ? `e:${selectedEntries[0].occurredAt.getTime()}:${selectedEntries[0].id}` : undefined,
    }
  }

  /** Project alterSystem state for the desktop alter track. */
  private projectAlterForDesktop(story: InterludeStory) {
    const state = normalizeAlterSystemState(story.state.alterSystem)
    if (!state) return undefined
    return {
      value: state.alterValue ?? 0,
      alterWeight: state.alterWeight ?? 1,
      emotionalOffset: state.emotionalOffset ? { direction: state.emotionalOffset.direction, intensity: state.emotionalOffset.intensity, description: state.emotionalOffset.description } : null,
      lastUpdatedAt: state.lastUpdatedAt,
      history: (state.history ?? []).slice(-30).map(h => ({
        value: h.alterValue, alter: h.alter, at: h.timestamp,
      })),
    }
  }

  /** Project compaction status for the desktop compaction track. */
  private projectCompactionForDesktop(story: InterludeStory, scenes: InterludeScene[]) {
    const state = decodeStoryState(story.state)
    const activeScene = scenes.find(s => s.status === 'active') ?? scenes[0]
    if (!activeScene) return undefined
    const lastCompactionAt = typeof state.lastContinuityUpdateAt === 'string' && state.lastContinuityUpdateAt
      ? state.lastContinuityUpdateAt
      : activeScene.updatedAt.toISOString()
    return {
      activeSceneId: activeScene.id,
      sceneHook: activeScene.hook ?? '',
      entryCount: activeScene.entryCount ?? 0,
      lastCompactionAt,
      isDirty: (activeScene.entryCount ?? 0) > 5,
    }
  }

  /** Accept an already-normalized typ-0 event without introducing a second narrative path. */
  /** 批次 4：桌面设置叙事游标（分支截断后回拨到 forkPoint）。串行队列内执行。 */
  async setDesktopCursorAt(cursorAt: Date) {
    const story = await this.getCanonicalStory()
    if (!story) throw new Error('当前 worker 没有可操作的剧本。')
    await this.serial(story.id, async () => {
      await this.dbSet('interlude_story', { id: story.id }, { cursorAt, updatedAt: new Date() })
    })
  }

  async receiveDesktopEvent(event: DesktopInboundEvent, session: Session) {
    if (this.desktopRuntimePhase !== 'running') return false
    const receivedAt = new Date(event.occurredAt)
    return event.kind === 'group'
      ? this.receiveGroup(session, receivedAt)
      : this.receive(session, receivedAt)
  }

  /**
   * Returns whether this session is allowed to use HDSI. Koishi's OneBot
   * adapter uses `selfId` for the logged-in bot QQ and `userId` for the sender
   * QQ. Other adapters deliberately keep their old behaviour.
   */
  canHandleSession(session: Session): boolean {
    if (!isOneBotPlatform(session.platform)) return true
    const config = this.config.onebot
    // Backwards compatibility: an absent/disabled gate does not change old
    // installations. Once enabled, an empty list is intentionally deny-all.
    if (!config?.enabled) return true
    const selfId = normalizeAccountId(session.selfId)
    const userId = normalizeAccountId(session.userId)
    if (config.ignoreSelfMessages && selfId && selfId === userId) return false
    if (!isEnabledAccount(config.botAccounts, selfId)) {
      this.reportStandaloneOperation('diagnostic', 'debug', 'OneBot 白名单拒绝机器人账号 平台=%s 原始机器人ID=%s 规范化ID=%s', session.platform, session.selfId, selfId)
      return false
    }
    // HDSI deliberately uses an explicit allowlist.  A legacy userMode field
    // is ignored so an old `blocklist` value cannot silently open the bot to
    // every QQ account after an upgrade.
    const allowed = isEnabledAccount(config.userAccounts, userId)
    if (!allowed) this.reportStandaloneOperation('diagnostic', 'debug', 'OneBot 白名单拒绝用户账号 原始用户ID=%s 规范化ID=%s', session.userId, userId)
    return allowed
  }

  /** Group access uses an explicit group allowlist; group members do not need
   * to be present in the private-message user whitelist. */
  canHandleGroupSession(session: Session): boolean {
    if (!isOneBotPlatform(session.platform)) return false
    const config = this.config.onebot
    if (!config?.enabled) return false
    const selfId = normalizeAccountId(session.selfId)
    const userId = normalizeAccountId(session.userId)
    if (config.ignoreSelfMessages && selfId && selfId === userId) return false
    if (!isEnabledAccount(config.botAccounts, selfId)) return false
    const group = this.groupRule(sessionGroupId(session))
    return !!group?.enabled
  }

  private groupRule(groupId: string) {
    const normalized = normalizeGroupId(groupId)
    return (this.config.onebot?.groupChats ?? []).find(group => group.enabled !== false && normalizeGroupId(group.groupId) === normalized)
  }

  /** Same account gate for direct-message work that already has a participant. */
  canHandleParticipant(participant: InterludeParticipant): boolean {
    if (!isOneBotPlatform(participant.platform)) return true
    const config = this.config.onebot
    if (!config?.enabled) return true
    if (!isEnabledAccount(config.botAccounts, normalizeAccountId(participant.selfId))) return false
    return isEnabledAccount(config.userAccounts, normalizeAccountId(participant.userId))
  }

  canManageSession(session: Session): boolean {
    return this.manageSessionDenial(session) === undefined
  }

  /** 管理命令被拒的具体原因（两层：OneBot 互动白名单 / managerAccounts）。
   * 拒绝时记 standard 级 warn——此前区分线索藏在 diagnostic debug 里，新部署
   * 排障完全看不见。 */
  manageSessionDenial(session: Session): ManageSessionDenial | undefined {
    const denial = manageSessionDenialReason({
      platform: session.platform,
      selfId: session.selfId,
      userId: session.userId,
      onebot: this.config.onebot,
      managers: this.sharedStoryConfig.managerAccounts,
    })
    if (denial) {
      this.reportStandaloneOperation('standard', 'warn', '管理命令被拒 层=%s 平台=%s 机器人ID=%s 用户ID=%s 原因=%s', denial.layer, session.platform, session.selfId, session.userId, denial.detail)
    }
    return denial
  }

  /** Background life updates only require the bot account to remain enabled. */
  canHandleStory(story: InterludeStory): boolean {
    if (!isOneBotPlatform(story.platform)) return true
    const config = this.config.onebot
    if (!config?.enabled) return true
    // M1a：白名单账号判定经端点注册表解析（路径 6/8 的账号归因同源）。
    const address = this.endpointAddressSync({ platform: story.platform, selfId: story.selfId }, { kind: 'story-role', id: story.id })
    return isEnabledAccount(config.botAccounts, normalizeAccountId(address.selfId))
  }

  async findStory(session: Session) {
    if (this.sharedStoryConfig.enabled) {
      // Shared mode deliberately has one canonical active story in the whole
      // Koishi instance. Sandbox and OneBot must not run parallel lives.
      // M1b（v3 §三/§六）+ M1 审计修复 端点注册表与别名先于"按账号推导
      // ID"；注册表就绪后，未注册的 OneBot 账号直接判为无故事——绝不落到
      // 全局 fallback，也不触发 transport 自愈改绑（那会把主剧本绑到陌生
      // 账号上）。账号迁移只能经 interlude.story.endpoint add 显式完成。
      if (session.selfId && isOneBotPlatform(session.platform)) {
        try {
          const endpointHit = await this.resolveInboundEndpointFor({ platform: session.platform, selfId: String(session.selfId) })
          const redirectId = endpointHit?.roleEndpoint.ownerId
            ?? await this.resolveStoryIdAlias(storyIdForCharacter(session.platform, session.selfId))
          if (redirectId) {
            const redirected = (await this.getCanonicalStory(redirectId)) ?? await this.getPausedStory(redirectId)
            if (redirected) {
              const repaired = await this.repairCanonicalOneBotStoryTransport(redirected, session)
              await this.migrateLegacyBranchIntoShared(repaired, session)
              return repaired
            }
          }
          if (this.endpointRegistryReady) {
            // v3 §三边界行为：陌生账号不自动挂载。注册表就绪意味着所有既有
            // 故事的账号都已登记——此刻的 miss 是真正的未知账号。
            const warnKey = `unknown-account:${session.platform}:${session.selfId}`
            if (!this.storyAliasProblems.has(warnKey)) {
              this.storyAliasProblems.add(warnKey)
              this.reportStandalone('warn', '未注册的 OneBot 账号发来消息，已拒绝挂载到主剧本（如需迁移账号请用 interlude.story.endpoint add）账号=%s 平台=%s', session.selfId, session.platform)
            }
            return undefined
          }
        } catch (error) {
          // 注册表已就绪后的解析异常=数据/存储故障，拒绝本次入站（不落
          // 全局 fallback，防止陌生账号绕过隔离触发重绑）；仅冷启动（注册表
          // 自身未能加载）时回落旧路径维持可用性。
          if (this.endpointRegistryReady) {
            this.reportStandalone('warn', '端点解析异常，已拒绝本次入站（不回落全局故事查找）账号=%s 错误=%s', session.selfId, error)
            return undefined
          }
        }
      }
      let existing = await this.getCanonicalStory(storyIdForCharacter(session.platform, session.selfId))
      if (!existing) {
        // 暂停中的故事对 active-only 的主查询不可见，但管理命令（resume/
        // status/pause）必须仍能找到它——否则 pause 之后 resume 永远报
        // "没有故事"，story.start 还会撞主键领回暂停旧故事，形成死锁。
        // 只补 paused，不采纳 archived；调度路径（getCanonicalStory）
        // 保持 active-only，暂停语义不变。
        existing = await this.getPausedStory(storyIdForCharacter(session.platform, session.selfId))
      }
      if (existing) {
        existing = await this.repairCanonicalOneBotStoryTransport(existing, session)
        const sharedId = storyIdForCharacter(session.platform, session.selfId)
        if (existing.platform === session.platform && existing.id !== sharedId) return this.migrateLegacyStory(existing, session)
        await this.migrateLegacyBranchIntoShared(existing, session)
        return existing
      }
    }
    const id = legacyStoryIdFor(session.platform, session.selfId, session.userId)
    const existing = (await this.dbGet('interlude_story', { id }))[0]
    if (existing || !this.sharedStoryConfig.enabled) return existing

    // Old beta versions used one story id per QQ. Migrate lazily when that QQ
    // first returns, so existing scripts become the first relationship branch
    // of the new shared story instead of silently disappearing.
    const legacyId = legacyStoryIdFor(session.platform, session.selfId, session.userId)
    const legacy = (await this.dbGet('interlude_story', { id: legacyId }))[0]
    return legacy ? this.migrateLegacyStory(legacy, session) : undefined
  }

  /** Paused stories stay invisible to scheduling but reachable by management
   * commands. No archiving here: this lookup never resolves conflicts. */
  private async getPausedStory(preferredId?: string) {
    const paused = await this.dbGet('interlude_story', { status: 'paused' }, { sort: { updatedAt: 'desc' } })
    if (!paused.length) return undefined
    return (preferredId && paused.find(story => story.id === preferredId))
      ?? paused.find(story => story.id.startsWith('character:'))
      ?? paused[0]
  }

  /**
   * Resolve and enforce the one global active story. The preferred id wins
   * when present; otherwise the most recently updated row is retained and
   * every other active row is archived immediately.
   */
  private async getCanonicalStory(preferredId?: string) {
    const active = await this.dbGet('interlude_story', { status: 'active' }, {
      sort: { updatedAt: 'desc' },
    })
    if (!active.length) return undefined
    const canonical = (preferredId && active.find(story => story.id === preferredId))
      ?? active.find(story => story.id.startsWith('character:'))
      ?? active[0]
    const now = new Date()
    for (const story of active) {
      if (story.id === canonical.id) continue
      await this.dbSet('interlude_story', { id: story.id }, { status: 'archived', updatedAt: now })
      this.reportStandalone('info', '主剧本归档完成 原因=检测到多个活动故事 保留=%s 已归档=%s 范围=%s', canonical.id, story.id, '全局')
    }
    return canonical
  }

  async findParticipant(session: Session, story?: InterludeStory) {
    const resolved = story ?? await this.findStory(session)
    if (!resolved) return undefined
    // M1 审计修复 注册表 user 端点优先——链接端点与地址变更后的匹配
    // 不再依赖旧字段；未命中/异常回落旧字段比对（单平台等价）。
    try {
      const hit = await this.resolveInboundEndpointFor({ platform: session.platform, selfId: String(session.selfId ?? resolved.selfId), userId: String(session.userId ?? '') })
      if (hit?.userEndpoint) {
        const participant = await this.getParticipant(hit.userEndpoint.ownerId)
        if (participant && participant.storyId === resolved.id && participant.status === 'active') return participant
      }
    } catch { /* 回落旧匹配 */ }
    // Participant ids from older betas were global to a bot/user pair.  Do
    // not trust that id alone: when shared mode is toggled or a legacy branch
    // is being migrated, the same pair can temporarily exist under another
    // story.  The story-bound lookup prevents accidentally moving or exposing
    // the wrong relationship branch.
    const rows = await this.dbGet('interlude_participant', { storyId: resolved.id })
    return rows.find(item => sameParticipantEndpoint(item, session))
  }

  async participants(storyId: string, includePaused = false) {
    const rows = await this.dbGet('interlude_participant', { storyId })
    return rows
      .filter(participant => includePaused || participant.status === 'active')
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async createStory(session: Session, name?: string) {
    if (!this.canHandleSession(session) && !this.canHandleGroupSession(session)) throw new Error('This session is not allowed to use HDS Interlude.')
    const existing = await this.findStory(session)
    if (existing) {
      if (session.isDirect) await this.ensureParticipant(existing, session)
      return existing
    }
    const now = new Date()
    const setting = this.initialStorySetting(name)
    const story: InterludeStory = {
      id: this.sharedStoryConfig.enabled
        ? storyIdForCharacter(session.platform, session.selfId)
        : legacyStoryIdFor(session.platform, session.selfId, session.userId),
      platform: session.platform, selfId: session.selfId, userId: '',
      channelId: '', status: 'active', setting, state: emptyStoryState(),
      cursorAt: now, createdAt: now, updatedAt: now,
    }
    try {
      await this.dbCreate('interlude_story', story)
    } catch (error) {
      // Two accounts can DM a newly started bot at almost the same time. The
      // database primary key is the final arbiter; join the winner instead of
      // failing one participant's first message.
      const raced = (await this.dbGet('interlude_story', { id: story.id }))[0]
      if (!raced) throw error
      await this.ensureContinuity(raced, now)
      await this.ensureParticipant(raced, session, now)
      return raced
    }
    await this.ensureContinuity(story, now)
    // 新建故事同步登记角色端点与别名——findStory 的陌生账号拒绝
    // 依赖"本故事账号必然已注册"这一不变式。
    await this.registerStoryRoleEndpointRow({ id: story.id, platform: story.platform, selfId: story.selfId })
    if (session.isDirect) await this.ensureParticipant(story, session, now)
    await this.appendEntry(story.id, {
      kind: 'setup', actor: 'system', content: `The story begins with ${setting.character.name}.`,
      occurredAt: now.toISOString(), metadata: {},
    }, now)
    // 补充事实写入初始长期事实：scope 按前缀推断（人物=character、关系=relationship、
    // 其余=world），importance 中等、confidence 高（它们是配置的既定事实）。
    for (const [index, fact] of (setting.supplementaryFacts ?? []).entries()) {
      const text = fact.trim()
      if (!text) continue
      const scope = /^主角|^(?:她|他)的/.test(text) ? 'character' as const
        : /关系|两人之间|互动/.test(text) ? 'relationship' as const
          : 'world' as const
      try {
        await this.dbCreate('interlude_fact', {
          storyId: story.id, participantId: '', scope,
          content: text, importance: 0.6, confidence: 0.95, unresolved: false,
          sourceEntryIds: [], status: 'active',
          knowledge: { mode: 'confirmed', clauses: [], relatedFactIds: [] },
          createdAt: now, updatedAt: now, lastSeenAt: now,
        })
      } catch (error) {
        // 补充事实入库失败必须有日志——用户配置了它却发现没生效是最难排查的。
        this.reportStandalone('warn', '补充事实入库失败 故事=%s 序号=%d 错误=%s', story.id, index, error)
      }
    }
    // 回填 rc2/rc3 已写入但 lastSeenAt 为空的补充事实——不回填则 facts() 排序崩溃。
    try {
      const existingFacts = await this.dbGet('interlude_fact', { storyId: story.id, status: 'active' }) as NarrativeFact[]
      for (const fact of existingFacts) {
        if (!fact.lastSeenAt) {
          await this.dbSet('interlude_fact', { id: fact.id }, { lastSeenAt: fact.updatedAt ?? fact.createdAt ?? now, updatedAt: now })
        }
      }
    } catch { /* 防御性回填失败不阻断故事创建 */ }
    await this.scheduleNextAutomaticAdvance(story.id, now)
    return story
  }

  /** Read-only preflight for manually starting a runtime story from Console defaults. */
  async storyStartReadiness(session: Session): Promise<StoryStartReadiness> {
    const setting = this.initialStorySetting()
    const blockers: string[] = []
    const warnings: string[] = []
    if (!this.canHandleSession(session)) blockers.push('当前机器人账号或用户账号未通过 OneBot 白名单。')
    // 只读 preflight：用纯函数版本，不带拒绝日志副作用（warn 只属于真实命令路径）。
    const manageDenial = manageSessionDenialReason({
      platform: session.platform, selfId: session.selfId, userId: session.userId,
      onebot: this.config.onebot, managers: this.sharedStoryConfig.managerAccounts,
    })
    if (manageDenial) warnings.push(`当前会话无管理权限：${manageDenial.detail}`)
    if (!setting.character.name.trim()) blockers.push('storyDefaults.characterName 为空。')
    if (!setting.character.profile.trim()) blockers.push('storyDefaults.characterProfile 尚未填写。')
    try { new Intl.DateTimeFormat('en-US', { timeZone: setting.timezone }) } catch { blockers.push(`时区无效：${setting.timezone}`) }
    if (this.modelRouting.providers.some(provider => provider.enabled && !!provider.endpoint)) {
      if (!this.modelRouting.main.available) blockers.push('没有可用的主叙事模型：请在模型中心勾选一条“用作主叙事模型”。')
    } else {
      warnings.push('尚未配置启用的模型连接：可用于安装验证，但不会生成远程叙事。')
    }
    if (!setting.perspective.trim()) warnings.push('Perspective 尚未填写；主角将仅使用 Canon 与已有 Overlay。')
    if (!setting.world.trim()) warnings.push('world 尚未填写；建议在 Console 补充现实边界与地点背景。')
    const existing = await this.findStory(session)
    return {
      ready: blockers.length === 0,
      existing, blockers, warnings,
      preview: {
        characterName: setting.character.name,
        characterProfile: !!setting.character.profile.trim(),
        perspective: !!setting.perspective.trim(),
        world: !!setting.world.trim(),
        timezone: setting.timezone,
        model: this.mainModelLabel(),
        autoCreate: this.config.runtime.autoCreate !== false,
      },
    }
  }

  /**
   * Enrolls a QQ account as a relationship branch and synchronizes its Console
   * identity fields. Callers that already resolved the participant can pass it
   * in to avoid a second database read.
   */
  async ensureParticipant(story: InterludeStory, session: Session, now = new Date(), knownExisting?: InterludeParticipant) {
    const account = this.userAccountRule(session.userId)
    const preset = this.participantPreset(session.userId)
    const existing = knownExisting ?? await this.findParticipant(session, story)
    if (existing) {
      // Console edits to the whitelist are intentional identity changes.
      // Keep relationship evolution in participant.state.relationshipOverlay;
      // only this base profile/relationship is refreshed here.
      const personId = account?.personId?.trim() || preset?.personId?.trim() || existing.personId || session.userId
      const displayName = account?.label?.trim() || preset?.label?.trim() || existing.displayName || session.username || session.userId
      const profile = account?.profile?.trim() || preset?.profile?.trim() || existing.profile || this.config.storyDefaults.userProfile
      const relationship = account?.relationship?.trim() || preset?.relationship?.trim() || existing.relationship || this.config.storyDefaults.relationship
      const changed = existing.storyId !== story.id
        || existing.channelId !== session.channelId
        || existing.personId !== personId
        || existing.displayName !== displayName
        || existing.profile !== profile
        || existing.relationship !== relationship
      if (changed) {
        await this.dbSet('interlude_participant', { id: existing.id }, {
          storyId: story.id, channelId: session.channelId, personId, displayName, profile, relationship, updatedAt: now,
        })
        this.reportOperation('diagnostic', 'debug', story, 'user-message', '参与者资料已从 Console 同步 参与者=%s', existing.id)
      }
      return {
        ...existing, storyId: story.id, channelId: session.channelId, personId, displayName, profile, relationship,
        updatedAt: changed ? now : existing.updatedAt,
      }
    }
    const baseId = participantIdFor(session.platform, session.selfId, session.userId)
    // Keep the historical id whenever it is free.  If an old per-account
    // story still owns it, use a deterministic story suffix instead of
    // stealing that branch's primary key during rollback/migration.
    const globallyExisting = await this.getParticipant(baseId)
    const id = !globallyExisting || globallyExisting.storyId === story.id
      ? baseId
      : participantIdForStory(story.id, session.platform, session.selfId, session.userId)
    const participant: InterludeParticipant = {
      id, storyId: story.id, platform: session.platform, selfId: session.selfId,
      userId: session.userId, channelId: session.channelId,
      personId: account?.personId?.trim() || preset?.personId?.trim() || session.userId,
      displayName: account?.label?.trim() || preset?.label?.trim() || session.username || session.userId,
      profile: account?.profile?.trim() || preset?.profile?.trim() || this.config.storyDefaults.userProfile,
      relationship: account?.relationship?.trim() || preset?.relationship?.trim() || this.config.storyDefaults.relationship,
      state: emptyParticipantState(), status: 'active', createdAt: now, updatedAt: now,
    }
    try {
    await this.dbCreate('interlude_participant', participant)
    } catch (error) {
      // Two first private messages can arrive before either request enters the
      // story queue.  The primary key resolves that race; return the branch
      // created by the other request instead of failing one message.
      const raced = await this.findParticipant(session, story)
      if (!raced) throw error
      return raced
    }
    // 新参与者同步登记用户端点——入站匹配依赖注册表先行。
    await this.registerParticipantUserEndpointRow({ id: participant.id, platform: participant.platform, selfId: participant.selfId, userId: participant.userId })
    await this.appendEntry(story.id, {
      kind: 'participant-joined', actor: 'system',
      content: `${participant.displayName} entered the character's relationship network.`,
      occurredAt: now.toISOString(), metadata: { personId: participant.personId },
    }, now, participant.id)
    return participant
  }

  async updateSetting(story: InterludeStory, patch: Partial<StorySetting>) {
    const setting = mergeSetting(story.setting, patch)
    const now = new Date()
    await this.dbSet('interlude_story', { id: story.id }, { setting, updatedAt: now })
    return { ...story, setting, updatedAt: now }
  }

  async setStatus(story: InterludeStory, status: InterludeStory['status']) {
    const now = new Date()
    await this.dbSet('interlude_story', { id: story.id }, { status, updatedAt: now })
    return { ...story, status, updatedAt: now }
  }

  async recentEntries(storyId: string, limit = resolveScriptContextBudget(this.config.runtime).count) {
    const bounded = Math.max(1, Math.min(Math.floor(limit), 200))
    const rows = await this.dbGet('interlude_script_entry', { storyId }, {
      limit: bounded,
      sort: { occurredAt: 'desc' },
    })
    // 批次 4：purge fallback 墓碑不进 prompt（物理删除通常无残留，此为软删兜底过滤）。
    return rows.filter(entry => entry.kind !== 'redacted').reverse()
  }

  /** Live narration keeps both a count floor and a recent wall-clock window.
   * A burst of conversation can therefore exceed the nominal turn count
   * without immediately erasing everything said earlier in the same hour. */
  private async recentEntriesForPrompt(storyId: string, now: Date) {
    const { count, minutes } = resolveScriptContextBudget(this.config.runtime)
    const [countRows, timeRows] = await Promise.all([
      this.dbGet('interlude_script_entry', { storyId }, { limit: count, sort: { occurredAt: 'desc' } }),
      minutes > 0
        ? this.dbGet('interlude_script_entry', { storyId, occurredAt: { $gte: new Date(now.getTime() - minutes * Time.minute) } }, { limit: 500, sort: { occurredAt: 'desc' } })
        : Promise.resolve([] as ScriptEntry[]),
    ])
    const byId = new Map<number, ScriptEntry>()
    // 墓碑不进 prompt——recentEntries 有同款过滤（批次 4 契约），此处是真正的
    // 主入口，缺过滤会让管理员删除/清库留下的占位文本进入模型上下文。
    for (const entry of [...countRows, ...timeRows]) {
      if (entry.kind === 'redacted') continue
      byId.set(entry.id, entry)
    }
    return [...byId.values()].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id - right.id)
  }

  async memories(storyId: string, limit = this.config.runtime.memoryLimit, participantId?: string) {
    const bounded = Math.max(1, Math.min(limit * 4, 500))
    const rows = await this.dbGet('interlude_memory', { storyId, status: 'active' }, {
      limit: bounded,
      sort: { importance: 'desc', updatedAt: 'desc' },
    })
    return rows
      .filter(memory => participantId === undefined || !memory.participantId || memory.participantId === participantId)
      .sort((a, b) => b.importance - a.importance || b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit)
  }

  /** Administrative view: global durable facts, including legacy rows with a participantId. */
  async adminFacts(storyId: string, limit = 20) {
    return this.dbGet('interlude_fact', { storyId, status: 'active' }, {
      limit: Math.max(1, Math.min(limit, 100)),
      sort: { updatedAt: 'desc' },
    })
  }

  async adminPendingIntents(storyId: string, limit = 20) {
    return this.dbGet('interlude_intent', { storyId, status: 'pending' }, {
      limit: Math.max(1, Math.min(limit, 100)),
      sort: { notBefore: 'asc' },
    })
  }

  async adminStatePatches(storyId: string, limit = 20) {
    return this.dbGet('interlude_state_patch', { storyId }, {
      limit: Math.max(1, Math.min(limit, 100)),
      sort: { createdAt: 'desc' },
    })
  }

  /** Adds an audit-visible system note without pretending it came from the model. */
  async addAdminScriptNote(story: InterludeStory, content: string) {
    const text = clip(content, this.config.runtime.maxScriptCharacters)
    if (!text) return false
    const now = new Date()
    await this.appendEntry(story.id, {
      kind: 'admin-note', actor: 'system', content: `[管理员注记] ${text}`,
      occurredAt: now.toISOString(), metadata: { source: 'administrator' },
    }, now)
    this.scheduleCompaction(story.id)
    return true
  }

  /** Adds a high-confidence fact for corrections that must survive compaction. */
  async addAdminFact(story: InterludeStory, scope: NarrativeFact['scope'], content: string) {
    const text = clip(content, this.memoryConfig.factContentCharacters)
    if (!text || factContentLooksAmbiguous(scope, text)) return false
    const now = new Date()
    await this.dbCreate('interlude_fact', {
      // Legacy column retained for database compatibility; facts are global.
      storyId: story.id, participantId: '', scope, content: text,
      importance: 0.8, confidence: 1, unresolved: false, embedding: await this.embedText(text),
      status: 'active', sourceEntryIds: [], lastSeenAt: now, createdAt: now, updatedAt: now,
    })
    return true
  }

  /** Reversible deletion: facts are retained as superseded rows for audit. */
  async forgetAdminFact(storyId: string, id: number) {
    const fact = (await this.dbGet('interlude_fact', { id, storyId, status: 'active' }))[0]
    if (!fact) return false
    await this.dbSet('interlude_fact', { id }, { status: 'superseded', updatedAt: new Date() })
    return true
  }

  async cancelAdminIntent(storyId: string, id: number) {
    const intent = (await this.dbGet('interlude_intent', { id, storyId, status: 'pending' }))[0]
    if (!intent) return false
    await this.dbSet('interlude_intent', { id }, { status: 'cancelled', updatedAt: new Date() })
    return true
  }

  async rejectAdminStatePatch(storyId: string, id: number) {
    const patch = (await this.dbGet('interlude_state_patch', { id, storyId, status: 'proposed' }))[0]
    if (!patch) return false
    await this.dbSet('interlude_state_patch', { id }, { status: 'rejected' })
    return true
  }

  /** 手动批准一条 proposed 提案:管理员判断优先于证据阈值/autoApply 政策
   * (否则关闭自动应用后提案没有任何出口)。批准后立即重建 overlay——
   * 统一语义下 overlay=未压缩 applied 补丁的合并,效果即时可见。 */
  async applyAdminStatePatch(story: InterludeStory, id: number) {
    const patch = (await this.dbGet('interlude_state_patch', { id, storyId: story.id, status: 'proposed' }))[0]
    if (!patch) return false
    const now = new Date()
    await this.dbSet('interlude_state_patch', { id }, { status: 'applied', appliedAt: now })
    await this.rebuildLiveOverlayState(story, now)
    return true
  }

  /** Clear only the evolving setting overlay; keep Canon, script and memories. */
  async clearSettingOverlay(story: InterludeStory, target: 'character' | 'perspective' | 'relationship' | 'world' | 'all') {
    this.invalidateBufferedNarratives(story.id)
    return this.serial(story.id, async () => this.clearSettingOverlayUnlocked(await this.getStory(story.id), target))
  }

  /** Start a clean host-owned timeline without deleting the historical archive.
   * This is intended once after upgrading from prose-authoritative releases
   * whose active scene or scratchpad may already contain future contamination. */
  async rebaseTimeline(story: InterludeStory) {
    this.invalidateBufferedNarratives(story.id)
    return this.serial(story.id, async () => {
      const current = await this.getStory(story.id)
      const now = new Date()
      const latest = await this.dbGet('interlude_script_entry', { storyId: current.id }, { limit: 1, sort: { id: 'desc' } }) as ScriptEntry[]
      const activeScene = await this.activeScene(current.id)
      if (activeScene) {
        await this.dbSet('interlude_scene', { id: activeScene.id }, {
          hook: `Host timeline rebased at ${formatLogTime(now, current.setting.timezone)}.`,
          summary: 'The host resumed the current timeline here. Earlier script remains archived context; no future statement from it is an event after this point.',
          lastEntryId: latest[0]?.id ?? activeScene.lastEntryId,
          entryCount: 0,
          updatedAt: now,
        })
      }
      const state = decodeStoryState(current.state)
      await this.dbSet('interlude_story', { id: current.id }, {
        state: encodeStoryState({ ...state, workingDetails: [], timelineCarry: [], continuitySnapshot: undefined, continuityDirty: true }), cursorAt: now, updatedAt: now,
      })
      await this.appendEntry(current.id, {
        kind: 'timeline-rebase', actor: 'system', content: 'Host timeline rebased. Earlier narrative prose remains an archive and no longer defines future events.',
        occurredAt: now.toISOString(), metadata: { timelineRebase: true },
      }, now)
      return { at: now, sceneReset: !!activeScene }
    })
  }

  private async clearSettingOverlayUnlocked(story: InterludeStory, target: 'character' | 'perspective' | 'relationship' | 'world' | 'all') {
    const now = new Date()
    const overlay = { ...(story.state.settingOverlay ?? {}) }
    if (target === 'character' || target === 'all') {
      delete overlay.characterProfile
      overlay.characterTraits = []
    }
    if (target === 'perspective' || target === 'all') delete overlay.perspective
    if (target === 'relationship' || target === 'all') delete overlay.relationship
    if (target === 'world' || target === 'all') delete overlay.world
    await this.dbSet('interlude_story', { id: story.id }, {
      state: encodeStoryState({ ...decodeStoryState(story.state), settingOverlay: overlay }), updatedAt: now,
    })

    let participantCount = 0
    if (target === 'relationship' || target === 'all') {
      const participants = await this.participants(story.id, true)
      for (const participant of participants) {
        const state = normalizeParticipantState(participant.state)
        if (!state.relationshipOverlay) continue
        participantCount++
        await this.dbSet('interlude_participant', { id: participant.id }, {
          state: { ...state, relationshipOverlay: undefined }, updatedAt: now,
        })
      }
    }

    // Preserve proposals for audit, but invalidate both active overlay rows and
    // pending candidates. Otherwise a candidate created before the clear could
    // be applied later and silently resurrect the old personality/relationship.
    const patches = await this.dbGet('interlude_state_patch', { storyId: story.id })
    for (const patch of patches) {
      if (!['proposed', 'applied', 'compacted'].includes(patch.status) || (target !== 'all' && patch.target !== target)) continue
      await this.dbSet('interlude_state_patch', { id: patch.id }, { status: 'cleared' })
    }
    const snapshots = await this.dbGet('interlude_overlay_snapshot', { storyId: story.id, status: 'active' }) as OverlaySnapshot[]
    for (const snapshot of snapshots) {
      if (target !== 'all' && snapshot.target !== target) continue
      await this.dbSet('interlude_overlay_snapshot', { id: snapshot.id }, { status: 'superseded', updatedAt: now })
    }
    return { participantCount }
  }

  /**
   * Destructive administrative operation. The caller must validate the
   * confirmation phrase. A full purge also rebuilds Canon from the current
   * Console configuration, so an old profile cannot survive in later prompts.
   */
  async purgeAllStoryData(storyId: string) {
    if (typeof (this as any).purgeAllStoryDataUnlocked !== 'function') {
      this.invalidateBufferedNarratives(storyId)
      this.invalidateHistoryVectors(storyId)
      // Compatibility path for prototype-level migration tests and older
      // embedders that only provide the original purge surface.
      if (typeof (this as any).purgeTable === 'function') await (this as any).purgeTable('interlude_script_entry', { storyId }, {})
      return
    }
    const run = () => this.purgeAllStoryDataUnlocked(storyId)
    return typeof (this as any).serial === 'function' ? this.serial(storyId, run) : run()
  }

  private async purgeAllStoryDataUnlocked(storyId: string) {
    this.invalidateBufferedNarratives(storyId)
    this.invalidateStoryTasks(storyId)
    // 软删后历史向量缓存必须失效，否则语义召回继续注入已删除内容直至重启。
    this.invalidateHistoryVectors(storyId)
    await this.purgeTable('interlude_script_entry', { storyId }, {
      kind: 'redacted', actor: 'system', content: '[管理员已删除剧本内容]', metadata: { redacted: true },
    })
    await this.purgeTable('interlude_memory', { storyId }, { status: 'deleted', content: '[管理员已删除记忆]' })
    await this.purgeTable('interlude_intent', { storyId }, { status: 'cancelled', summary: '[管理员已取消意图]' })
    await this.purgeTable('interlude_scene', { storyId }, { status: 'closed', hook: '', summary: '', entryCount: 0 })
    await this.purgeTable('interlude_arc', { storyId }, { status: 'closed', summary: '', sceneCount: 0 })
    await this.purgeTable('interlude_fact', { storyId }, { status: 'superseded', content: '[管理员已删除事实]' })
    await this.purgeTable('interlude_state_patch', { storyId }, { status: 'rejected', proposedValue: '[管理员已删除提案]', evidence: '' })
    await this.purgeTable('interlude_overlay_snapshot', { storyId }, { status: 'superseded', summary: '[管理员已删除 overlay 归档]', majorEvents: [], sourcePatchIds: [] })
    await this.purgeTable('interlude_web_observation', { storyId }, { status: 'deleted', url: '', title: '', excerpt: '', summary: '[管理员已删除网页观察]' })
    await this.purgeTable('interlude_schedule_preplan', { storyId }, { regimes: [], exceptions: [], materializedDays: [], validFrom: '1970-01-01', validThrough: '1970-01-01', lastReviewedLocalDate: '', reviewReason: '[管理员已删除 Schedule Preplan]' })
    await this.purgeTable('interlude_seeded_event', { storyId }, { status: 'expired', summary: '[管理员已删除世界事件]', sourcePayload: {}, subjects: [] })
    // 长线催化器随故事清理:此前 guidance/progress 不在清单里,reset 后旧"直觉"
    // 经启动预加载重新注入新故事,分数残留还会污染触发门槛。'completed' 由此
    // 成为真实可达的收束终态(而非死状态)。
    await this.purgeTable('interlude_long_arc_guidance', { storyId }, { status: 'completed', payload: {}, premise: '', direction: '', evidenceEntryIds: [], currentStage: '', intensity: 'subtle', confidence: 0, title: '[管理员已收束长线指导]' })
    await this.purgeTable('interlude_long_arc_progress', { storyId }, { lastCountedEntryId: 0, totalScore: 0, privateCount: 0, privateScore: 0, groupCount: 0, groupScore: 0, unknownCount: 0, lastGenerationScore: 0, lastGenerationEntryId: 0, updatedAt: new Date() })
    this.activeLongArcGuidanceCache.delete(storyId)
    this.longHorizonLastScore.delete(storyId)
    this.longHorizonLastScore.delete(storyId + ':gen')
    this.longHorizonGuidanceLoaded.delete(storyId)
    this.longHorizonGenerationCooldownUntil.delete(storyId)
    const now = new Date()
    const story = await this.getStory(storyId)
    const setting = this.initialStorySetting()
    await this.dbSet('interlude_story', { id: storyId }, {
      setting, state: emptyStoryState(), cursorAt: now, updatedAt: now,
    })
    await this.resetParticipantCanon(storyId, now)
    await this.ensureContinuity({ ...story, setting, state: emptyStoryState(), cursorAt: now }, now)
  }

  /** Reset all platforms, retaining exactly one empty global canonical story. */
  async purgeAllData(preferredStoryId?: string) {
    const all = await this.dbGet('interlude_story', {}, { sort: { updatedAt: 'desc' } })
    const active = all.filter(story => story.status === 'active')
    if (!active.length) return undefined
    const canonical = (preferredStoryId && active.find(story => story.id === preferredStoryId)) ?? active[0]
    for (const story of all) await this.purgeAllStoryData(story.id)
    const now = new Date()
    for (const story of all) {
      if (story.id === canonical.id) continue
      await this.dbSet('interlude_story', { id: story.id }, { status: 'archived', updatedAt: now })
    }
    return canonical.id
  }

  /** Delete one adapter/platform's records without touching other platforms. */
  async purgePlatformData(platform: string) {
    const all = await this.dbGet('interlude_story', {}, { sort: { updatedAt: 'desc' } })
    const targets = all.filter(story => samePlatformFamily(story.platform, platform))
    for (const story of targets) {
      await this.purgeAllStoryData(story.id)
      await this.dbSet('interlude_story', { id: story.id }, { status: 'archived', updatedAt: new Date() })
    }
    return targets.length
  }

  /**
   * Clear only HDSI-owned tables. Koishi's users/channels and other plugins
   * are intentionally untouched; deleting the physical SQLite file from a
   * command would be unsafe while the driver is open.
   */
  async clearDatabase() {
    if (this.databaseResetting) throw new Error('HDSI 数据库清空已经在进行中。')
    this.databaseResetting = true
    this.invalidateStoryTasks()
    // 竞态屏障：等待在途模型回合完成——否则正在飞行的模型调用会把含旧记忆的
    // 剧本写入刚清过的数据库，下次调用读到"幽灵记忆"。
    const inFlightKeys = []
    for (const [key, turn] of this.turnEngine?.turns ?? new Map()) {
      if (turn?.inFlightRequestId != null) inFlightKeys.push({ key, id: turn.inFlightRequestId })
    }
    for (const { key, id } of inFlightKeys) {
      this.reportStandalone('warn', '清空前等待在途回合完成 参与者=%s 请求=%d', key, id)
      const deadline = Date.now() + 30_000
      const turns = this.turnEngine?.turns
      while (turns?.get(key)?.inFlightRequestId === id && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    this.invalidateBufferedNarratives()
    this.invalidateHistoryVectors()
    try {
    const tables = [
      'interlude_script_entry', 'interlude_memory', 'interlude_intent',
      'interlude_scene', 'interlude_arc', 'interlude_fact', 'interlude_state_patch', 'interlude_overlay_snapshot', 'interlude_web_observation', 'interlude_schedule_preplan',
      'interlude_participant', 'interlude_seeded_event', 'interlude_story',
      'interlude_long_arc_guidance', 'interlude_long_arc_progress',
    ] as const
    // 长线催化器的内存态随全库清理一并失效,避免同进程内旧指导继续投影
    this.activeLongArcGuidanceCache.clear()
    this.longHorizonLastScore.clear()
    this.longHorizonGuidanceLoaded.clear()
    this.longHorizonGenerationCooldownUntil.clear()
    let removed = 0
    let logicallyCleared = 0
    for (const table of tables) {
      const rows = await this.dbGet(table, {})
      if (!rows.length) continue
      removed += rows.length
      try {
        await this.dbRemove(table, {})
      } catch (error) {
        // Preserve the established disk-I/O fallback: content is redacted and
        // stories are archived so a locked sql.js file cannot revive a story.
        this.reportStandalone('warn', 'SQLite 清空表失败，改用逻辑清空 表=%s 错误=%s', table, error)
        for (const row of rows) {
          const id = (row as any).id
          const key = table === 'interlude_schedule_preplan' ? { storyId: (row as any).storyId } : { id }
          const fallback: any = table === 'interlude_story'
            ? { status: 'archived', setting: this.initialStorySetting(), state: emptyStoryState() }
            : table === 'interlude_participant'
              ? { status: 'paused', profile: '', relationship: '', state: emptyParticipantState() }
              : table === 'interlude_script_entry'
                ? { kind: 'redacted', actor: 'system', content: '[HDSI 数据库已清空]', metadata: { redacted: true } }
                : table === 'interlude_memory'
                  ? { status: 'deleted', content: '[HDSI 数据库已清空]' }
                  : table === 'interlude_intent'
                    ? { status: 'cancelled', summary: '[HDSI 数据库已清空]' }
                    : table === 'interlude_scene' || table === 'interlude_arc'
                      ? { status: 'closed', hook: '', summary: '', entryCount: 0, sceneCount: 0 }
                      : table === 'interlude_fact'
                        ? { status: 'superseded', content: '[HDSI 数据库已清空]' }
                        : table === 'interlude_web_observation'
                          ? { status: 'deleted', url: '', title: '', excerpt: '', summary: '[HDSI 数据库已清空]' }
                        : table === 'interlude_schedule_preplan'
                          ? { regimes: [], exceptions: [], materializedDays: [], validFrom: '1970-01-01', validThrough: '1970-01-01', lastReviewedLocalDate: '', reviewReason: '[HDSI 数据库已清空]' }
                          : table === 'interlude_seeded_event'
                            ? { status: 'expired', summary: '[HDSI 数据库已清空]', sourcePayload: {}, subjects: [] }
                          : { status: 'rejected', proposedValue: '[HDSI 数据库已清空]', evidence: '' }
          await this.dbSet(table, key, fallback)
          logicallyCleared++
        }
      }
    }
    return { removed, logicallyCleared }
    } finally {
      this.databaseResetting = false
    }
  }

  /** Remove script and derived memory records whose timestamps overlap a range. */
  async purgeStoryRange(storyId: string, from: Date, to: Date) {
    const run = () => this.purgeStoryRangeUnlocked(storyId, from, to)
    return typeof (this as any).serial === 'function' ? this.serial(storyId, run) : run()
  }

  private async purgeStoryRangeUnlocked(storyId: string, from: Date, to: Date) {
    this.invalidateBufferedNarratives(storyId)
    this.invalidateStoryTasks(storyId)
    this.invalidateHistoryVectors(storyId)
    const inRange = (value: Date | null | undefined) => !!value && value >= from && value <= to
    const entries = await this.dbGet('interlude_script_entry', { storyId })
    const entryIds = new Set(entries.filter(entry => inRange(entry.occurredAt)).map(entry => entry.id))
    for (const entry of entries) if (entryIds.has(entry.id)) await this.purgeTable('interlude_script_entry', { id: entry.id }, {
      kind: 'redacted', actor: 'system', content: '[管理员已删除剧本内容]', metadata: { redacted: true },
    })

    const memories = await this.dbGet('interlude_memory', { storyId })
    for (const memory of memories) {
      if (inRange(memory.createdAt) || (memory.sourceEntryId != null && entryIds.has(memory.sourceEntryId))) {
        await this.purgeTable('interlude_memory', { id: memory.id }, { status: 'deleted', content: '[管理员已删除记忆]' })
      }
    }

    const facts = await this.dbGet('interlude_fact', { storyId })
    for (const fact of facts) {
      const sourced = (fact.sourceEntryIds ?? []).some(id => entryIds.has(id))
      if (inRange(fact.createdAt) || inRange(fact.updatedAt) || inRange(fact.lastSeenAt) || sourced) {
        await this.purgeTable('interlude_fact', { id: fact.id }, { status: 'superseded', content: '[管理员已删除事实]' })
      }
    }

    const intents = await this.dbGet('interlude_intent', { storyId })
    for (const intent of intents) {
      if (inRange(intent.createdAt) || inRange(intent.notBefore) || inRange(intent.updatedAt)) {
        await this.purgeTable('interlude_intent', { id: intent.id }, { status: 'cancelled', summary: '[管理员已取消意图]' })
      }
    }

    const scenes = await this.dbGet('interlude_scene', { storyId })
    for (const scene of scenes) {
      const overlaps = scene.startedAt <= to && (!scene.endedAt || scene.endedAt >= from)
      if (overlaps) await this.purgeTable('interlude_scene', { id: scene.id }, { status: 'closed', hook: '', summary: '', entryCount: 0 })
    }
    const arcs = await this.dbGet('interlude_arc', { storyId })
    for (const arc of arcs) if (inRange(arc.createdAt) || inRange(arc.updatedAt)) await this.purgeTable('interlude_arc', { id: arc.id }, { status: 'closed', summary: '', sceneCount: 0 })

    const patches = await this.dbGet('interlude_state_patch', { storyId })
    for (const patch of patches) if (inRange(patch.createdAt) || inRange(patch.appliedAt)) await this.purgeTable('interlude_state_patch', { id: patch.id }, { status: 'rejected', proposedValue: '[管理员已删除提案]', evidence: '' })

    const observations = await this.dbGet('interlude_web_observation', { storyId })
    for (const observation of observations) {
      if (inRange(observation.createdAt) || inRange(observation.accessedAt)) {
        await this.purgeTable('interlude_web_observation', { id: observation.id }, { status: 'deleted', url: '', title: '', excerpt: '', summary: '[管理员已删除网页观察]' })
      }
    }

    const seededEvents = await this.dbGet('interlude_seeded_event', { storyId })
    for (const event of seededEvents) {
      if (inRange(event.createdAt) || inRange(event.occursAt) || inRange(event.updatedAt)) {
        await this.purgeTable('interlude_seeded_event', { id: event.id }, { status: 'expired', summary: '[管理员已删除世界事件]', sourcePayload: {}, subjects: [] })
      }
    }

    if (entryIds.size) {
      await this.dbSet('interlude_schedule_preplan', { storyId }, {
        lastReviewedLocalDate: '', validThrough: '1970-01-01', reviewReason: 'Source range was purged; Schedule Preplan requires review.', updatedAt: new Date(),
      })
    }

    const story = await this.getStory(storyId)
    await this.ensureContinuity(story, new Date())
  }

  /** Entry point for configured OneBot group chats. Group members do not need
   * private-message authorization; the group allowlist controls access. */
  async receiveGroup(session: Session, receivedAt?: Date) {
    if (!receivedAt) receivedAt = toDate((session as any).timestamp) ?? new Date()
    if (this.databaseResetting || !this.canHandleGroupSession(session)) return false
    const groupId = sessionGroupId(session)
    const rule = this.groupRule(groupId)
    if (!rule) return false
    const mentionedBot = mentionsBot(session)
    const quotedBot = quotesBot(session)
    const audioSources = extractSessionAudioSources(session)
    let imageSources = extractSessionImageSources(session)
    // In mention-only mode a plain text message is ignored before story lookup,
    // but an unmentioned image is durable evidence for a later real turn. It is
    // persisted below without entering the model debounce queue.
    if (rule.responseMode === 'mention-only' && !mentionedBot && !audioSources.length && !imageSources.length) return false
    let story = await this.findStory(session)
    if (!story && this.config.runtime.autoCreate) story = await this.createStory(session)
    if (!story || story.status !== 'active') return false
    const now = receivedAt
    const senderId = normalizeAccountId(session.userId)
    const senderName = await this.groupSenderName(groupId, senderId, session)
    const quote = describeQuotedMessage(session, story.setting.character.name)
    const forward = await this.readForward(session)
    const messageContent = forward ? mergeForwardContent(describeGroupAttachments(session.content), forward.content) : describeGroupAttachments(session.content)
    // 合并转发内的图片并入本轮视觉输入与群聊历史引用
    if (forward?.imageRefs?.length) imageSources = Array.from(new Set([...imageSources, ...forward.imageRefs]))
    // 桥接幂等（群聊侧，与私聊 receive 对齐）：桌面超时-重放会把同一群消息
    // 再投递一次；平台+频道+messageId 命中即直接确认，不重复落库与入队。
    const groupDedupeKey = `${session.platform}:${session.selfId ?? story.selfId}:${session.channelId}:${session.messageId}`
    if (session.messageId && this.seenIncomingMessages.has(groupDedupeKey)) {
      this.reportOperation('diagnostic', 'debug', story, 'user-message', '桥接重放去重命中（群聊），跳过重复消息 键=%s', groupDedupeKey)
      return true
    }

    // M1a 端点层：群消息同样先在队列外解析（群端点），命中才标注与刷状态。
    const groupSource = { platform: session.platform, selfId: String(session.selfId ?? story.selfId), groupId: String(groupId), channelId: String(session.channelId ?? '') }
    const groupChannelMeta = await this.channelMetadataFor(groupSource, { groupId: groupSource.groupId, channelId: groupSource.channelId })
    await this.touchEndpointStateInbound(groupSource)
    const accepted = await this.serial(story.id, async () => {
      if (session.messageId && (this.seenIncomingMessages.has(groupDedupeKey)
        || (await this.dbGet('interlude_script_entry', { storyId: story.id, kind: 'group-message',
          'metadata.groupId': groupId, 'metadata.messageId': session.messageId,
          $or: [{ 'metadata.selfId': String(session.selfId ?? story.selfId) }, { 'metadata.selfId': { $exists: false } }] }, { limit: 1 })).length)) return undefined
      const current = await this.getStory(story!.id)
      const entry = await this.appendEntry(current.id, {
        kind: 'group-message', actor: 'user', content: messageContent,
        occurredAt: now.toISOString(),
        metadata: {
          groupId, senderId, senderName, channelId: session.channelId, messageId: session.messageId, selfId: String(session.selfId ?? story.selfId),
          ...(groupChannelMeta ? { channel: groupChannelMeta } : {}),
          ...(quote ? { quote } : {}),
          ...(imageSources.length ? {
            imageCount: imageSources.length,
            groupImageRefs: groupImageRefsForStorage(imageSources),
          } : {}),
        },
      }, now)
      try {
        await this.pauseAutomaticAdvanceAfterUserMessage(current.id, now)
      } catch (error) {
        this.report('warn', current, 'user-message', '消息已落库，自动推进暂停更新失败：%s', error)
      }
      return entry
    })
    if (!accepted) return true
    if (session.messageId) this.rememberIncomingMessage(groupDedupeKey)
    // An unmentioned image is evidence-only in mention-only mode. It has now
    // been written to the script, but must not itself consume willingness,
    // cooldown, or a main-model call.
    if (rule.responseMode === 'mention-only' && !mentionedBot && !audioSources.length) return true
    const messageId = targetableMessageId(session.messageId)
    this.bufferGroupMessage(story, rule, session, {
      senderId, senderName, speaker: formatGroupSpeaker(senderName, senderId),
      ...(messageId ? { messageId, messageRef: groupMessageRef(accepted.id) } : {}),
        ...(quote ? { quote } : {}),
        content: messageContent, occurredAt: now, direction: 'user',
      }, mentionedBot, quotedBot, audioSources, imageSources, groupChannelMeta?.endpointId)
    this.reportOperation('summary', 'info', story, 'user-message', '收到群聊消息 群=%s 发送者=%s', maskQqIds(groupId), maskQqIds(senderId))
    return true
  }

  async receive(session: Session, receivedAt?: Date) {
    // 双时钟修复：优先平台消息时间（秒级），缺失时用本机接收时间——此前
    // Koishi 原生路径恒用 Date.now()，与桌面路径（平台 frame.time）混排序。
    if (!receivedAt) receivedAt = toDate((session as any).timestamp) ?? new Date()
    if (this.databaseResetting) return false
    // Check before find/create so an unauthorized QQ can neither trigger the
    // model nor create a persistent story by merely sending a private message.
    if (!this.canHandleSession(session)) return false
    let story = await this.findStory(session)
    if (!story && this.config.runtime.autoCreate) story = await this.createStory(session)
    if (!story || story.status !== 'active') {
      this.reportStandaloneOperation('diagnostic', 'debug', '私聊未处理：故事不存在或已暂停 平台=%s 机器人ID=%s 用户ID=%s', session.platform, session.selfId, session.userId)
      return false
    }
    let participant = await this.findParticipant(session, story)
    if (participant) {
      // A whitelist row can be edited after this QQ first joined the shared
      // story. Refresh the current branch before composing its model context.
      // ensureParticipant performs no write when nothing actually changed.
      participant = await this.ensureParticipant(story, session, receivedAt, participant)
    } else if (this.config.runtime.autoCreate || this.sharedStoryConfig.autoEnrollParticipants) {
      participant = await this.ensureParticipant(story, session)
    }
    if (!participant || participant.status !== 'active') {
      this.reportOperation('diagnostic', 'debug', story, 'user-message', '私聊未处理：参与者不存在或已暂停 用户ID=%s', session.userId)
      return false
    }
    if (!session.content?.trim() && !extractSessionVoiceCount(session)) return false
    // 桥接幂等：同一条消息（平台+messageId）近期已处理过则直接确认，不再入队
    // 叙事——这是桌面超时-重放双写双回的插件侧防线。
    const dedupeKey = `${session.platform}:${session.selfId ?? story.selfId}:${session.userId}:${session.messageId}`
    if (session.messageId && this.seenIncomingMessages.has(dedupeKey)) {
      this.reportOperation('diagnostic', 'debug', story, 'user-message', '桥接重放去重命中，跳过重复消息 键=%s', dedupeKey)
      return true
    }
    const observed = this.describeVisionEvent(session)
    if (!observed.content.trim() && !observed.sources.length && !extractSessionVoiceCount(session) && !extractSessionFileFacts(session).length) return false

    // Mark the relationship synchronously before waiting for the story queue.
    // This lets an arriving message invalidate a model request that is about
    // to persist, and lets a due split segment stop before transport begins.
    this.signalIncomingInterruption(story, participant)
    // 用户消息到达=她显然在看手机:asleep/resting 立即提升为 phone-focused,
    // 不等主叙事或压缩器——节奏变化应与触发事件同步(推进密度立刻跟上)。
    this.elevateRhythmOnIncoming(story.id, receivedAt)
    const forward = await this.readForward(session)
    const userInput = this.describeUserEvent(story, session, forward)
    // M1a 端点层（解析在故事队列外）：注册表命中才标注通道上下文/刷新端点状态，
    // 未迁移或陌生账号不产生任何变化——单平台行为与现状一致。
    const inboundSource = { platform: session.platform, selfId: String(session.selfId ?? story.selfId), userId: String(session.userId ?? participant.userId ?? '') }
    const channelMeta = await this.channelMetadataFor(inboundSource, { userId: inboundSource.userId })
    await this.touchEndpointStateInbound(inboundSource)
    // M2 §1.3：来源必须在回合创建后写入。此前这里先 recordSource、后
    // bufferUserNarrative，TurnEngine 找不到尚未创建的 turn，首条消息的
    // source 会静默丢失，导致首轮通道标注和后续路由上下文为空。
    const inboundResolution = await this.resolveInboundEndpointFor(inboundSource)
    const inboundEndpointId = inboundResolution?.userEndpoint?.id ?? inboundResolution?.roleEndpoint?.id ?? 'unknown'
    this.inboundSeq += 1
    const inboundReceivedSeq = this.inboundSeq
    this.reportOperation('summary', 'info', story, 'user-message', '收到参与者私聊消息 参与者=%s', maskQqIds(participant.id))
    if (this.config.logging?.logMessageContent) {
      this.reportOperation('diagnostic', 'info', story, 'user-message', '用户消息内容：%s', userInput.content.slice(0, this.config.logging.previewLength))
    }

    let accepted: { story: InterludeStory; participant: InterludeParticipant; now: Date; superseded: NarrativeIntent[] } | 'duplicate' | undefined
    try {
      accepted = await this.serial(story.id, async () => {
      if (session.messageId && (this.seenIncomingMessages.has(dedupeKey)
        || (await this.dbGet('interlude_script_entry', { storyId: story.id, participantId: participant!.id, kind: 'user-message',
          'metadata.platform': session.platform, 'metadata.messageId': session.messageId,
          $or: [{ 'metadata.selfId': String(session.selfId ?? story.selfId) }, { 'metadata.selfId': { $exists: false } }] }, { limit: 1 })).length)) {
        // 早退路径也必须清打断标志——cancelPendingOutgoingMessages 不执行时,
        // 标志泄漏会让该参与者的分段/延迟消息永久 pending 且阻塞全局意图
        this.interruptedTypingParticipants.delete(participant!.id)
        return 'duplicate' as const
      }
      const current = await this.getStory(story.id)
      const currentParticipant = await this.getParticipant(participant!.id)
      if (!currentParticipant || currentParticipant.status !== 'active') {
        this.interruptedTypingParticipants.delete(participant!.id)
        return undefined
      }
      const now = receivedAt
      const incomingParticipant = await this.recordIncomingMessage(currentParticipant, now)
      const superseded = await this.cancelPendingOutgoingMessages(
        current.id,
        incomingParticipant.id,
        now,
        this.config.runtime.cancelDelayedRepliesOnUserMessage,
      )
      await this.appendEntry(current.id, {
        kind: 'user-message', actor: 'user', content: userInput.content,
        occurredAt: now.toISOString(), metadata: {
          platform: session.platform, messageId: session.messageId, selfId: String(session.selfId ?? story.selfId), personId: incomingParticipant.personId,
          ...(channelMeta ? { channel: channelMeta } : {}),
          ...(userInput.sources.length ? { imageCount: userInput.sources.length } : {}),
          ...(userInput.audioSources.length ? { audioCount: userInput.audioSources.length } : {}),
          ...(userInput.quote ? { quote: userInput.quote } : {}),
        },
      }, now, incomingParticipant.id)
      // Messages are persisted at arrival. The model request itself is
      // debounced below, so a burst can become one coherent writing turn.
      try {
        await this.pauseAutomaticAdvanceAfterUserMessage(current.id, now)
      } catch (error) {
        this.report('warn', current, 'user-message', '消息已落库，自动推进暂停更新失败：%s', error)
      }
      return { story: current, participant: incomingParticipant, now, superseded }
    })
    } finally {
      // 串行块抛异常时兜底清打断标志——cancel 不执行,标志泄漏会永久阻塞分段/意图
      this.interruptedTypingParticipants.delete(participant!.id)
    }
    if (accepted === 'duplicate') return true
    if (!accepted) return false
    if (session.messageId) this.rememberIncomingMessage(dedupeKey)
    this.bufferUserNarrative(accepted.story, accepted.participant, session, accepted.now, accepted.superseded, userInput.content, userInput.sources, userInput.audioSources, userInput.quote, inboundEndpointId)
    this.turnEngine.recordSource(accepted.participant.id, inboundEndpointId, inboundReceivedSeq)
    if (userInput.sources.length) {
      this.reportOperation('standard', 'info', accepted.story, 'user-message', '当前事件包含图片附件 数量=%d 原生识图=%s', userInput.sources.length, this.config.model.vision?.enabled ? '开启' : '关闭')
    }
    if (userInput.audioSources.length) {
      this.reportOperation('standard', 'info', accepted.story, 'user-message', '当前事件包含语音附件 数量=%d 原生音频=%s', userInput.audioSources.length, this.audioConfig.enabled ? '开启' : '关闭')
    }
    this.reportOperation('standard', 'info', accepted.story, 'user-message', '用户回合已入队 参与者=%s 已取消旧计划=%d', accepted.participant.id, accepted.superseded.length)
    return true
  }

  private async groupSenderName(groupId: string, userId: string, session: Session) {
    const account = this.userAccountRule(userId)
    const author = (session as any).author as { nick?: unknown, name?: unknown, username?: unknown } | undefined
    const observed = normalizeGroupDisplayName(account?.label, author?.nick, session.username, author?.name, author?.username)
    if (observed) return observed

    const key = `${normalizeGroupId(groupId)}:${userId}`
    const cached = this.groupMemberNameCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.name
    const pending = this.groupMemberNameLookups.get(key) ?? this.lookupGroupMemberName(key, groupId, userId, session.selfId)
    this.groupMemberNameLookups.set(key, pending)
    try { return await pending || userId }
    finally { this.groupMemberNameLookups.delete(key) }
  }

  private async lookupGroupMemberName(cacheKey: string, groupId: string, userId: string, selfId: string) {
    const bot = this.ctx.bots.find(item => String(item.selfId) === String(selfId)
      && (item.platform === 'onebot' || isOneBotPlatform(item.platform))) as any
    if (typeof bot?.getGuildMember !== 'function') return ''
    try {
      const member = await bot.getGuildMember(normalizeGroupId(groupId), userId)
      const name = normalizeGroupDisplayName(member?.nick, member?.name, member?.user?.name)
      if (!name) return ''
      this.groupMemberNameCache.set(cacheKey, { name, expiresAt: Date.now() + 12 * Time.hour })
      return name
    } catch {
      return ''
    }
  }

  private bufferGroupMessage(story: InterludeStory, rule: GroupChatRule, session: Session, message: GroupMessageContext, mentionedBot: boolean, quotedBot: boolean, audioSources: string[] = [], imageSources: string[] = [], endpointId?: string) {
    const key = `${story.id}:${normalizeGroupId(rule.groupId)}`
    const existing = this.bufferedGroupTurns.get(key)
    const turn: BufferedGroupTurn = existing ?? {
      storyId: story.id, groupId: normalizeGroupId(rule.groupId), rule,
      channelId: session.channelId, messages: [], revision: 0, mentionedBot: false, quotedBot: false,
    }
    if (turn.timer) turn.timer()
    turn.channelId = session.channelId
    turn.latestSession = session
    // Transport sources belong only to this fresh batch, never to durable history.
    turn.messages.push({
      ...message,
      ...(imageSources.length ? { imageSources, imageSession: session } : {}),
      ...(audioSources.length ? { audioSources, audioSession: session } : {}),
      ...(endpointId ? { endpointId } : {}),
    })
    turn.mentionedBot ||= mentionedBot
    turn.quotedBot ||= quotedBot
    const revision = ++turn.revision
    const delay = Math.max(0, rule.debounceSeconds ?? 1) * Time.second
    turn.timer = this.ctx.setTimeout(() => void this.flushGroupTurn(key, revision), delay)
    this.bufferedGroupTurns.set(key, turn)
  }

  private async flushGroupTurn(key: string, revision: number) {
    const turn = this.bufferedGroupTurns.get(key)
    if (!turn || turn.revision !== revision || this.databaseResetting || this.desktopRuntimePhase === 'paused') return
    if (this.turnEngine.narrating.has(turn.storyId)) {
      turn.timer = this.ctx.setTimeout(() => void this.flushGroupTurn(key, revision), 250)
      return
    }
    // Claim before the first await: private turns use the same story guard.
    this.turnEngine.narrating.add(turn.storyId)
    try {
      await this.flushGroupTurnUnlocked(key, turn)
    } finally {
      this.turnEngine.narrating.delete(turn.storyId)
      if (this.bufferedGroupTurns.get(key) === turn && !turn.messages.length && !turn.timer) this.bufferedGroupTurns.delete(key)
    }
  }

  private async flushGroupTurnUnlocked(key: string, turn: BufferedGroupTurn) {
    const session = turn.latestSession
    const channelId = turn.channelId
    turn.timer = undefined
    // Unlike private turns, a group batch stays deliverable after its model
    // request has started. New group messages form the next batch so a busy
    // conversation cannot permanently starve the protagonist of a reply.
    const batch = turn.messages.splice(0)
    turn.activeBatchEndpointIds = [...new Set(batch
      .map(message => message.endpointId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0))]
    const hasAudio = batch.some(message => message.audioSources?.length)
    const mentionedBot = turn.mentionedBot
    const quotedBot = turn.quotedBot
    turn.mentionedBot = false
    turn.quotedBot = false
    if (!batch.length) {
      this.bufferedGroupTurns.delete(key)
      return
    }
    let story: InterludeStory
    try {
      story = await this.getStory(turn.storyId)
    } catch (error) {
      this.reportStandalone('warn', '群聊回合读取剧本失败，已放弃本批消息 故事=%s 错误=%s', turn.storyId, error)
      if (this.bufferedGroupTurns.get(key) === turn && !turn.messages.length && !turn.timer) this.bufferedGroupTurns.delete(key)
      return
    }
    if (story.status !== 'active') {
      if (this.bufferedGroupTurns.get(key) === turn && !turn.messages.length && !turn.timer) this.bufferedGroupTurns.delete(key)
      return
    }
    const willingness = evaluateWillingnessGate(this.groupWillingness.get(key), turn.rule.willingnessPreset, turn.rule.willingnessAuto, decodeStoryState(story.state).lifeStatus, turn.rule.willingness, {
      now: Date.now(), messageCount: batch.length, content: batch.map(message => message.content).join('\n'),
      mentionedBot, quotedBot,
    })
    this.groupWillingness.set(key, willingness.state)
    const tierLabel = formatWillingnessGateDiagnosis(willingness.diagnosis)
    if (!hasAudio && !willingness.shouldCall) {
      this.reportOperation('diagnostic', 'debug', story, 'user-message',
        '群聊意愿未触发模型调用 群=%s 分数=%s 概率=%s 原因=%s 档位=%s 跳过=%d', turn.groupId,
        willingness.state.score.toFixed(3), willingness.probability.toFixed(3), willingness.reason, tierLabel,
        willingness.state.skipCount ?? 0)
      if (this.bufferedGroupTurns.get(key) === turn && !turn.messages.length && !turn.timer) this.bufferedGroupTurns.delete(key)
      return
    }
    if (!hasAudio && await this.groupCooldownActive(story.id, turn.groupId, turn.rule.cooldownSeconds)) {
      this.reportOperation('diagnostic', 'debug', story, 'user-message', '群聊仍在冷却期，跳过群发言 群=%s', turn.groupId)
      if (this.bufferedGroupTurns.get(key) === turn && !turn.messages.length && !turn.timer) this.bufferedGroupTurns.delete(key)
      return
    }
    this.reportOperation('standard', 'info', story, 'user-message', '群聊消息准备进入主叙事 群=%s 模式=%s 意愿=%s 档位=%s', turn.groupId, turn.rule.responseMode, willingness.state.score.toFixed(3), tierLabel)
    try {
      const snapshot = await this.serial(story.id, async () => {
        const current = await this.getStory(story.id)
        const groupSnapshot = await this.groupMessages(current.id, turn.groupId, turn.rule.contextLimit)
        const now = new Date()
        return { story: current, from: narrativeCursor(current, now), now, ...groupSnapshot }
      })
      const groupContext: GroupContext = {
        groupId: turn.groupId, channelId: channelId, label: turn.rule.label,
        purpose: turn.rule.purpose, characterRole: turn.rule.characterRole,
        messages: snapshot.messages,
      }
      const chatCapabilities = this.groupChatCapabilities(session, groupContext.messages)
      const userMessage = batch.map((message, index) => `[群聊连续消息 ${index + 1}｜${message.speaker}]\n${message.content}`).join('\n\n')
      const turnQueryEmbedding = this.semanticTurnEmbeddingEnabled()
        ? await this.embedText(userMessage.slice(0, this.config.model.embedding?.maxInputCharacters ?? 4_000))
        : undefined
      const stickerCatalog = await this.stickerCatalogForSession(session, turnQueryEmbedding)
      const currentImageSources = Array.from(new Set(batch.flatMap(message => message.imageSources ?? []))).slice(0, 3)
      const imageSession = batch.find(message => message.imageSession)?.imageSession ?? session
      const currentImages = await this.loadNativeImages(snapshot.story, currentImageSources, imageSession)
      const historicalGroupImages = await this.loadHistoricalGroupImages(
        snapshot.story,
        snapshot.imageRefs,
        turn.rule.historicalImageLimit ?? 3,
        imageSession,
        currentImageSources,
      )
      const audio: NarrativeAudio[] = []
      const audioBatchMaxCount = Math.max(1, this.audioConfig.maxPerMessage * 4)
      const audioBatchMaxBytes = Math.max(1, this.audioConfig.maxFileSizeMB * 1_000_000 * 4)
      let audioBatchBytes = 0
      for (const message of batch) {
        if (!message.audioSources?.length) continue
        const remaining = audioBatchMaxCount - audio.length
        if (remaining <= 0 || audioBatchBytes >= audioBatchMaxBytes) {
          this.reportOperation('diagnostic', 'warn', snapshot.story, 'user-message', '群音频批次达到资源上限，剩余音频延后处理 附件上限=%d 字节上限=%d', audioBatchMaxCount, audioBatchMaxBytes)
          continue
        }
        const loaded = await this.loadNativeAudio(snapshot.story, message.audioSources, message.audioSession, remaining)
        for (const item of loaded) {
          if (audioBatchBytes + item.base64.length > audioBatchMaxBytes) {
            this.reportOperation('diagnostic', 'warn', snapshot.story, 'user-message', '群音频批次达到字节上限，剩余音频跳过当前回合 字节上限=%d', audioBatchMaxBytes)
            break
          }
          audio.push({ ...item, id: `group-audio-${audio.length + 1} (${message.speaker})` })
          audioBatchBytes += item.base64.length
        }
      }
      if (hasAudio) this.reportOperation('standard', audio.length ? 'info' : 'warn', story, 'user-message',
        '群音频直接触发主叙事（跳过意愿/冷却），已载入音频=%s；实际发言由剧本决定%s', audio.length,
        audio.length ? '' : '；音频未载入，请检查原生音频开关、格式、大小或读取日志')
      const visionMode = this.config?.model?.vision?.mode ?? 'native'
       const images = visionMode === 'native' ? currentImages : []
       const historicalImages = visionMode === 'native' ? historicalGroupImages : []
       const { decision, succeeded } = await this.tryDecide(snapshot.story, null, 'user-message', snapshot.from, snapshot.now, userMessage, [], [], groupContext, images, audio, chatCapabilities, [], stickerCatalog, turnQueryEmbedding, undefined, undefined, historicalImages)
      const chatActions = normalizeGroupChatActions(decision, chatCapabilities, groupContext)
      const sticker = this.resolveSticker(decision.localMedia, stickerCatalog)
      const nativeFace = sticker ? undefined : this.resolveNativeFace(decision, chatCapabilities)
      const result = await this.serial(story.id, async () => {
        // paused 同样作废:暂停期间到达的群模型结果不再提交/对外发消息(群内容
        // 已在 receiveGroup 落库,不 requeue 也不会丢;空 turn 由 finally 清理)
        if (this.databaseResetting || this.desktopRuntimePhase === 'paused' || this.bufferedGroupTurns.get(key) !== turn || !succeeded) return {
          content: '', messages: [] as OutgoingMessageDraft[],
          chatActions: { reactions: [] } as ExecutableGroupChatActions,
          commit: undefined as ScriptCommitDraft | undefined,
          scriptEntry: undefined as ScriptEntry | undefined,
        }
        const current = await this.getStory(story.id)
        const persisted = await this.persistDecision(current, null, {
          ...decision,
          messageReactions: chatActions.reactions.map(({ messageRef, reaction }) => ({ messageRef, reaction })),
          localMedia: sticker ? decision.localMedia : undefined,
          nativeFace: nativeFace ? decision.nativeFace : undefined,
        }, snapshot.from, snapshot.now, false, 'user-message')
        const content = normalizeGroupVisibleReply(decision.groupReply, decision.interaction, this.config.runtime.maxMessageCharacters, this.config.runtime.messageSeparator, this.config.runtime.splitReplyMessages !== false)
        await this.dbSet('interlude_story', { id: current.id }, { cursorAt: snapshot.now, updatedAt: new Date() })
        if (succeeded) await this.scheduleConversationFollowUpsAfterTurn(current.id, snapshot.now, decision.interaction)
        return { content, messages: persisted.messages, chatActions, sticker, nativeFace, commit: persisted.commit, scriptEntry: persisted.scriptEntry }
      })
      const platformEntryId = result.scriptEntry?.id
      const completedReactions = result.chatActions.reactions.length && session
        ? await this.executeGroupReactions(
          snapshot.story,
          session,
          turn.groupId,
          result.chatActions.reactions,
          reaction => platformActionReference(result.commit, platformEntryId, 'message-reaction', `${reaction.messageRef}:${reaction.reaction}`),
        )
        : 0
      const groupDelivery: GroupDeliveryResult = result.content
        ? await this.sendGroupMessage(snapshot.story, channelId, result.content, result.chatActions.replyTo?.messageId, session)
        : { deliveredSegments: [], complete: false, segmentOutcomes: [] }
      if (groupDelivery.segmentOutcomes.length || groupDelivery.deliveredSegments.length) {
        await this.serial(story.id, async () => {
          const current = await this.getStory(story.id)
          const now = new Date()
          const groupEvent = result.commit ? findGroupScriptEvent(result.commit) : undefined
          const scriptEvent = groupEvent ? messageEventReference(groupEvent, 0, result.scriptEntry?.id) : undefined
          if (scriptEvent) {
            for (const outcome of groupDelivery.segmentOutcomes) {
              await this.updateScriptDeliveryOutcome(current.id, { ...scriptEvent, segmentIndex: outcome.index }, outcome.status, now, outcome.reason)
            }
          }
          if (groupDelivery.deliveredSegments.length) {
            await this.appendEntry(current.id, {
              kind: 'character-group-message', actor: 'character', content: groupDelivery.deliveredSegments.join('<sep/>'),
              occurredAt: now.toISOString(),
              metadata: {
                groupId: turn.groupId, channelId: channelId,
                ...(scriptEvent ?? {}),
                deliverySegmentIndexes: groupDelivery.segmentOutcomes.filter(item => item.status === 'delivered').map(item => item.index),
                ...(groupDelivery.complete ? {} : { partialDelivery: true, deliveredSegments: groupDelivery.deliveredSegments.length }),
                ...(result.chatActions.replyTo ? { replyTo: result.chatActions.replyTo.messageRef } : {}),
              },
            }, now)
          }
        })
      }
      const stickerDelivered = result.sticker && session
        ? await this.sendSticker(
          snapshot.story,
          session,
          channelId,
          result.sticker,
          turn.groupId,
          platformActionReference(result.commit, platformEntryId, 'local-media', result.sticker.assetId),
        )
        : false
      const nativeFaceDelivered = result.nativeFace && session
        ? await this.sendNativeFace(
          snapshot.story,
          session,
          channelId,
          result.nativeFace,
          turn.groupId,
          platformActionReference(result.commit, platformEntryId, 'native-face', result.nativeFace),
        )
        : false
      if (groupDelivery.deliveredSegments.length || completedReactions || stickerDelivered || nativeFaceDelivered) {
        this.groupWillingness.set(key, consumeWillingnessGate(this.groupWillingness.get(key), turn.rule.willingnessPreset, turn.rule.willingnessAuto, decodeStoryState(story.state).lifeStatus, turn.rule.willingness, Date.now(), decodeStoryState(story.state).lifeRhythm?.attention))
      }
      // Other conversations use the same delivery ledger as private turns.
      if (result.messages.length) await this.deliverOutgoingMessages(snapshot.story, result.messages)
      this.scheduleCompaction(story.id)
    } catch (error) {
      if (isContextDisposedError(error) || this.disposed) {
        this.reportOperation('diagnostic', 'debug', story, 'user-message', '插件重载中，本轮群聊叙事放弃 群=%s', turn.groupId)
        return
      }
      this.report('error', story, 'user-message', '群聊主叙事失败，保持静默 群=%s 错误=%s', turn.groupId, error)
    }
  }
  private async groupMessages(storyId: string, groupId: string, limit: number): Promise<GroupMessagesSnapshot> {
    const rows = await this.dbGet('interlude_script_entry', { storyId, kind: { $in: ['group-message', 'character-group-message'] },
      'metadata.groupId': { $in: groupIdStorageVariants(groupId) } }, {
      // Keep enough lookback to find the last few image-bearing entries even
      // when the visible text context is small.
      limit: Math.max(60, Math.min(300, limit * 12)), sort: { occurredAt: 'desc' },
    })
    const groupRows = rows.filter(entry => ['group-message', 'character-group-message'].includes(entry.kind)
      && normalizeGroupId(String(entry.metadata?.groupId ?? '')) === normalizeGroupId(groupId))
    const visibleRows = groupRows.slice(0, Math.max(1, limit)).reverse()
    const messages = visibleRows.map(entry => ({
      senderId: String(entry.metadata?.senderId ?? (entry.actor === 'character' ? 'character' : 'unknown')),
      senderName: String(entry.metadata?.senderName ?? (entry.actor === 'character' ? '主角' : entry.metadata?.senderId ?? '群成员')),
      speaker: formatGroupSpeaker(
        String(entry.metadata?.senderName ?? (entry.actor === 'character' ? '主角' : entry.metadata?.senderId ?? '群成员')),
        String(entry.metadata?.senderId ?? (entry.actor === 'character' ? 'character' : 'unknown')),
      ),
      ...(targetableMessageId(entry.metadata?.messageId)
        ? { messageId: targetableMessageId(entry.metadata?.messageId), messageRef: groupMessageRef(entry.id) }
        : {}),
      ...(normalizeQuotedMessageContext(entry.metadata?.quote) ? { quote: normalizeQuotedMessageContext(entry.metadata?.quote) } : {}),
      content: entry.content, occurredAt: entry.occurredAt,
      direction: entry.actor === 'character' ? 'character' as const : 'user' as const,
    }))
    const imageRefs: StoredGroupImageRef[] = []
    for (const entry of groupRows) {
      if (entry.actor !== 'user' || !Array.isArray(entry.metadata?.groupImageRefs)) continue
      const senderId = String(entry.metadata?.senderId ?? 'unknown')
      const senderName = String(entry.metadata?.senderName ?? senderId)
      const messageId = targetableMessageId(entry.metadata?.messageId)
      for (const raw of entry.metadata.groupImageRefs as unknown[]) {
        if (!isRecord(raw)) continue
        const source = String(raw.source ?? '').trim()
        if (!source || /^data:image\//i.test(source) || source.length > 8 * 1024 * 1024) continue
        const sourceType = raw.sourceType === 'file' ? 'file' : raw.sourceType === 'url' ? 'url' : undefined
        if (!sourceType) continue
        imageRefs.push({ source, ordinal: Number(raw.ordinal) || 0, sourceType, sourceEntryId: entry.id, senderId, senderName, occurredAt: entry.occurredAt, ...(messageId ? { messageId } : {}) })
      }
    }
    imageRefs.sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.sourceEntryId - left.sourceEntryId || right.ordinal - left.ordinal)
    return { messages, imageRefs }
  }

  private async loadHistoricalGroupImages(story: InterludeStory, refs: StoredGroupImageRef[], limit: number, session?: Session, currentSources: string[] = []): Promise<NarrativeHistoricalImage[]> {
    if (!this.config?.model?.vision?.enabled || limit <= 0 || !refs.length) return []
    const selected: NarrativeHistoricalImage[] = []
    const seen = new Set(currentSources)
    const max = Math.min(6, Math.max(0, Math.floor(limit)))
    const started = Date.now()
    let attempts = 0, cursor = 0
    // Keep the original first-successful-images selection, not the fastest
    // completion order. Small batches overlap failures without hiding a valid
    // source behind an arbitrary attempt limit or whole-operation deadline.
    while (cursor < refs.length && selected.length < max) {
      const batch: StoredGroupImageRef[] = []
      while (cursor < refs.length && batch.length < 3) {
        const ref = refs[cursor++]
        if (seen.has(ref.source)) continue
        seen.add(ref.source)
        batch.push(ref)
      }
      attempts += batch.length
      const images = await Promise.all(batch.map(async ref => {
        const deadReason = this.deadImageSourceReason(ref.source)
        if (deadReason !== undefined) {
          this.reportOperation('diagnostic', 'debug', story, 'user-message', '历史图片跳过：来源已判死(原因=%s) entry=%s 来源=%s', deadReason, ref.sourceEntryId, describeImageSource(ref.source))
          return undefined
        }
        try {
          const image = await this.fetchNativeImage(ref.source, (session as any)?.bot)
          if (!image) {
            const reason = this.deadImageSourceReason(ref.source)
            if (reason !== undefined) {
              this.reportOperation('standard', 'info', story, 'user-message', '历史图片源不可用(原因=%s)，本进程内不再回源 entry=%s 来源=%s', reason, ref.sourceEntryId, describeImageSource(ref.source))
            } else {
              this.report('warn', story, 'user-message', '历史图片回源失败 阶段=historical-image-fetch entry=%s 来源=%s 原因=empty-or-unsupported', ref.sourceEntryId, describeImageSource(ref.source))
            }
          }
          return image
        } catch (error) {
          // 重载窗口内 ctx.http 必然中止：静默跳过，重载后由下一回合重新回源。
          if (isContextDisposedError(error)) return undefined
          this.report('warn', story, 'user-message', '历史图片回源失败 阶段=historical-image-fetch entry=%s 来源=%s 错误=%s', ref.sourceEntryId, describeImageSource(ref.source), describeHttpError(error))
          return undefined
        }
      }))
      for (const [index, image] of images.entries()) {
        if (!image || selected.length >= max) continue
        const ref = batch[index]
        selected.push({ id: `group-history-image-${selected.length + 1}`, ...image, sourceEntryId: ref.sourceEntryId, senderId: ref.senderId, senderName: ref.senderName, occurredAt: ref.occurredAt, ...(ref.messageId ? { messageId: ref.messageId } : {}) })
      }
    }
    this.reportOperation('diagnostic', 'debug', story, 'user-message', '历史图片回源完成 尝试=%d 成功=%d 耗时=%dms', attempts, selected.length, Date.now() - started)
    return selected.reverse()
  }

  private async groupCooldownActive(storyId: string, groupId: string, cooldownSeconds: number) {
    if (cooldownSeconds <= 0) return false
    const rows = await this.dbGet('interlude_script_entry', { storyId,
      kind: { $in: ['character-group-message', 'character-platform-action'] },
      'metadata.groupId': { $in: groupIdStorageVariants(groupId) },
    }, { limit: 1, sort: { occurredAt: 'desc' } })
    const latest = rows.find(entry => ['character-group-message', 'character-platform-action'].includes(entry.kind)
      && normalizeGroupId(String(entry.metadata?.groupId ?? '')) === normalizeGroupId(groupId))
    return !!latest && Date.now() - latest.occurredAt.getTime() < cooldownSeconds * Time.second
  }

  private groupChatCapabilities(session: Session | undefined, messages: GroupMessageContext[]): ChatActionCapabilities | undefined {
    const config = this.config.chatActions
    if (!config?.enabled || !session || !isOneBotPlatform(session.platform) || !config.platforms?.includes('qq')) return undefined
    if (!messages.some(message => !!message.messageRef && !!message.messageId)) return undefined
    const internal = (session as any).bot?.internal
    const quoteReply = config.quoteReply === true
    const reactions = config.messageReactions === true && typeof internal?.setMsgEmojiLike === 'function'
      ? normalizeAllowedReactions(config.allowedReactions)
      : []
    const nativeFaces = config.nativeFaces === true ? normalizeAllowedNativeFaces(config.allowedNativeFaces) : []
    if (!quoteReply && !reactions.length && !nativeFaces.length) return undefined
    return { platform: 'qq', quoteReply, reactions, nativeFaces, expressionThreshold: normalizeExpressionThreshold(config.expressionThreshold) }
  }

  private privateChatCapabilities(session: Session | undefined): ChatActionCapabilities | undefined {
    const config = this.config.chatActions
    if (!config?.enabled || !session || !isOneBotPlatform(session.platform) || !config.platforms?.includes('qq')) return undefined
    const nativeFaces = config.nativeFaces === true ? normalizeAllowedNativeFaces(config.allowedNativeFaces) : []
    if (!nativeFaces.length) return undefined
    return { platform: 'qq', quoteReply: false, reactions: [], nativeFaces, expressionThreshold: normalizeExpressionThreshold(config.expressionThreshold) }
  }

  private async executeGroupReactions(
    story: InterludeStory,
    session: Session,
    groupId: string,
    reactions: ExecutableMessageReaction[],
    referenceFor?: (reaction: ExecutableMessageReaction) => ScriptDeliveryReference | undefined,
  ) {
    const internal = (session as any).bot?.internal
    let completed = 0
    for (const reaction of reactions.slice(0, 1)) {
      const reference = referenceFor?.(reaction)
      let platformDelivered = false
      try {
        const emojiId = QQ_REACTION_IDS[reaction.reaction]
        if (typeof internal?.setMsgEmojiLike !== 'function') {
          if (reference) await this.recordPlatformDeliveryOutcome(story.id, reference, 'cancelled', 'reaction-api-unavailable')
          continue
        }
        await withTransportTimeout(internal.setMsgEmojiLike(reaction.messageId, emojiId, true), 'msg-emoji-like', 10_000)
        platformDelivered = true
        const completedAt = new Date()
        await this.serial(story.id, async () => {
          await this.appendEntry(story.id, {
            kind: 'character-platform-action', actor: 'character',
            content: `主角给群消息 ${reaction.messageRef} 添加了 ${reaction.reaction} 表情回应。`,
            occurredAt: completedAt.toISOString(),
            metadata: {
              platform: 'qq', action: 'message-reaction', groupId, messageRef: reaction.messageRef, reaction: reaction.reaction,
              ...(reference ? { ...reference, deliverySegmentIndex: reference.segmentIndex } : {}),
            },
          }, completedAt)
          if (reference) await this.updateScriptDeliveryOutcome(story.id, reference, 'delivered', completedAt)
        })
        completed += 1
        this.reportOperation('standard', 'info', story, 'user-message', '聊天动作完成 类型=消息表情 群=%s 目标=%s 表情=%s', groupId, reaction.messageRef, reaction.reaction)
      } catch (error) {
        if (reference) await this.recordPlatformDeliveryOutcome(
          story.id, reference, platformDelivered ? 'delivered' : 'failed', platformDelivered ? undefined : clip(String(error), 500),
        )
        if (platformDelivered) {
          completed += 1
          this.report('warn', story, 'user-message', '聊天动作已完成但结果记录不完整 类型=消息表情 群=%s 目标=%s 错误=%s', groupId, reaction.messageRef, error)
        } else {
          this.report('warn', story, 'user-message', '聊天动作失败 类型=消息表情 群=%s 目标=%s 错误=%s', groupId, reaction.messageRef, error)
        }
      }
    }
    return completed
  }

  private resolveSticker(draft: LocalMediaDraft | undefined, catalog: StickerCatalogEntry[]) {
    if (!draft || typeof draft.assetId !== 'string' || typeof draft.willingness !== 'number' || !catalog.some(item => item.assetId === draft.assetId)) return undefined
    if (normalizeExpressionThreshold(draft.willingness) < this.expressionThreshold) return undefined
    return this.stickerById.get(draft.assetId)
  }

  private get expressionThreshold() {
    return normalizeExpressionThreshold(this.config.chatActions?.expressionThreshold)
  }

  private resolveNativeFace(decision: NarrativeDecision, capabilities: ChatActionCapabilities | undefined): NativeFaceSemantic | undefined {
    const allowed = new Set(capabilities?.nativeFaces ?? [])
    if (!allowed.size) return undefined
    const draft = decision.nativeFace
    const replyContent = decision.groupReply?.content ?? decision.interaction?.reply?.content ?? ''
    if (draft && allowed.has(draft.semantic) && calibratedNativeFaceWillingness(draft.semantic, draft.willingness, replyContent) >= (capabilities?.expressionThreshold ?? this.expressionThreshold)) {
      return draft.semantic
    }
    // Legacy bracket labels are parsed out of visible text by the compatibility
    // layer, but have no declared willingness and therefore never bypass the
    // expression threshold.
    return undefined
  }

  private async sendSticker(
    story: InterludeStory,
    session: Session,
    channelId: string,
    asset: StickerAsset,
    groupId?: string,
    reference?: ScriptDeliveryReference,
  ) {
    const root = resolve(this.ctx.baseDir, this.stickerConfig.directory)
    const file = resolve(root, asset.filePath)
    const relativePath = relative(root, file)
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.includes(':')) {
      if (reference) await this.recordPlatformDeliveryOutcome(story.id, reference, 'cancelled', 'invalid-sticker-path')
      return false
    }
    let platformDelivered = false
    try {
      if (this.desktopOnebotActionHandler) {
        // W3（C2-2）桌面模式：经宿主动作代理 send_msg，贴纸以宿主本地文件路径
        // 作 CQ 码（worker 与宿主同机），auto_escape=false 让 CQ 码被解析。
        // 绕开 HTTP 回源的 port:0 问题；独立部署仍走 HTTP 回源。
        const kind = groupId ? 'send_group_msg' : 'send_private_msg'
        const targetId = onebotTargetId(channelId)
        const outcome = await this.desktopOnebotActionHandler({
          accountKey: 'onebot:' + String(session.selfId ?? ''),
          action: kind,
          params: {
            ...(groupId ? { group_id: targetId } : { user_id: targetId }),
            message: `[CQ:image,file=file:///${file.replace(/\\/g, '/')}]`,
            auto_escape: false,
          },
        })
        if (!outcome.ok) throw new Error(outcome.error || `宿主动作代理失败：${outcome.errorCode ?? 'unknown'}`)
      } else {
        // 独立 Koishi：优先经自身 HTTP 服务回源投递（file:/// 指向 Koishi 侧
        // 文件系统，OneBot 实现分容器/分进程部署时读不到——retcode 1200/100
        // 实测）；HTTP URL 由 OneBot 实现主动下载，跨容器/跨机通吃。但宿主
        // 没加载 server/router 时路由不存在（issue #1：retcode 1200 根因），
        // auto 模式退回 file:// 本地路径——同容器/同主机的 OneBot 实现
        // （SnowLuma/NapCat 宿主模式）按本地文件读取，不依赖 HTTP。
        this.registerStickerRoute()
        const routerAvailable = this.stickerRouteRegistered
        const mode = this.stickerConfig.deliveryMode ?? 'auto'
        if (mode === 'file' || (mode === 'auto' && !routerAvailable)) {
          const file = resolve(this.ctx.baseDir, this.stickerConfig.directory, asset.filePath)
          const fileSrc = stickerFileUrl(file)
          this.reportOperation('diagnostic', 'debug', story, 'user-message', '表情包经本地文件投递（HTTP 路由不可用） 素材=%s 路径=%s', asset.assetId, fileSrc)
          await withTransportTimeout(session.bot.sendMessage(channelId, h('img', { src: fileSrc })), 'sticker-file-send')
        } else {
          const src = stickerDeliveryUrl(this.stickerDeliveryBase(), asset.assetId)
          await withTransportTimeout(session.bot.sendMessage(channelId, h('img', { src })), 'sticker-url-send')
        }
      }
      platformDelivered = true
      const now = new Date()
      await this.serial(story.id, async () => {
        await this.appendEntry(story.id, {
          kind: 'character-platform-action', actor: 'character',
          content: `主角发送了本地表情包：${asset.description}`,
          occurredAt: now.toISOString(),
          metadata: {
            platform: session.platform, action: 'local-sticker', assetId: asset.assetId, group: asset.group, animated: asset.animated,
            ...(groupId ? { groupId } : {}),
            ...(reference ? { ...reference, deliverySegmentIndex: reference.segmentIndex } : {}),
          },
        }, now)
        if (reference) await this.updateScriptDeliveryOutcome(story.id, reference, 'delivered', now)
      })
      this.reportOperation('standard', 'info', story, 'user-message', '聊天动作完成 类型=本地表情包 素材=%s', asset.assetId)
      return true
    } catch (error) {
      if (reference) await this.recordPlatformDeliveryOutcome(
        story.id, reference, platformDelivered ? 'delivered' : 'failed', platformDelivered ? undefined : clip(String(error), 500),
      )
      if (platformDelivered) {
        this.report('warn', story, 'user-message', '聊天动作已完成但结果记录不完整 类型=本地表情包 素材=%s 错误=%s', asset.assetId, error)
        return true
      }
      this.report('warn', story, 'user-message', '聊天动作失败 类型=本地表情包 素材=%s 错误=%s', asset.assetId, error)
      return false
    }
  }

  private async sendNativeFace(
    story: InterludeStory,
    session: Session,
    channelId: string,
    semantic: NativeFaceSemantic,
    groupId?: string,
    reference?: ScriptDeliveryReference,
  ) {
    let platformDelivered = false
    try {
      // OneBot 11 规范 face.id 是 int32；字符串 id 会被严格校验的实现直接
      // 拒绝（"is not a valid segment"）。宽容实现两者都收，统一发数字。
      const faceId = Number(QQ_NATIVE_FACE_IDS[semantic])
      if (this.desktopOnebotActionHandler) {
        // 桌面合成 session 没有 bot 属性，此前直接 session.bot.sendMessage
        // 必然 TypeError 后被外层 catch 吞掉。改走宿主动作代理（与贴纸同型）。
        const targetId = onebotTargetId(channelId)
        const outcome = await this.desktopOnebotActionHandler({
          accountKey: 'onebot:' + String(session.selfId ?? ''),
          action: groupId ? 'send_group_msg' : 'send_private_msg',
          params: {
            ...(groupId ? { group_id: targetId } : { user_id: targetId }),
            message: `[CQ:face,id=${faceId}]`,
            auto_escape: false,
          },
        })
        if (!outcome.ok) throw new Error(outcome.error || `宿主动作代理失败：${outcome.errorCode ?? 'unknown'}`)
      } else {
        await withTransportTimeout(session.bot.sendMessage(channelId, h('face', { id: faceId })), 'native-face-send')
      }
      platformDelivered = true
      const now = new Date()
      await this.serial(story.id, async () => {
        await this.appendEntry(story.id, {
          kind: 'character-platform-action', actor: 'character', content: `主角发送了 ${semantic} 原生表情。`,
          occurredAt: now.toISOString(), metadata: {
            platform: session.platform, action: 'native-face', semantic, ...(groupId ? { groupId } : {}),
            ...(reference ? { ...reference, deliverySegmentIndex: reference.segmentIndex } : {}),
          },
        }, now)
        if (reference) await this.updateScriptDeliveryOutcome(story.id, reference, 'delivered', now)
      })
      this.reportOperation('standard', 'info', story, 'user-message', '聊天动作完成 类型=原生表情 语义=%s', semantic)
      return true
    } catch (error) {
      if (reference) await this.recordPlatformDeliveryOutcome(
        story.id, reference, platformDelivered ? 'delivered' : 'failed', platformDelivered ? undefined : clip(String(error), 500),
      )
      if (platformDelivered) {
        this.report('warn', story, 'user-message', '聊天动作已完成但结果记录不完整 类型=原生表情 语义=%s 错误=%s', semantic, error)
        return true
      }
      this.report('warn', story, 'user-message', '聊天动作失败 类型=原生表情 语义=%s 错误=%s', semantic, error)
      return false
    }
  }

  private async sendGroupMessage(story: InterludeStory, channelId: string, content: string, replyToMessageId?: string, session?: Session, endpointId?: string, correlation?: Pick<OutgoingMessageDraft, 'traceId' | 'processingId'>, control?: { shouldCancel: () => boolean; settled: Map<number, GroupDeliveryResult['segmentOutcomes'][number]['status']>; onDelivered: (index: number, content: string) => void }) {
    const targetGroupId = normalizeGroupId(channelId)
    // Keep the adapter-facing channel spelling (for example `group:100`)
    // while using the normalized id only for endpoint/config matching.
    const transportGroupId = String(channelId ?? '')
    const segments = this.splitOutgoingMessage(content)
    const failed = (reason: string) => ({
      deliveredSegments: [], complete: false,
      segmentOutcomes: segments.map((segment, index) => ({ index, content: segment, status: 'failed' as const, reason })),
    })
    try {
      await this.ensureEndpointRegistry()
    } catch (error) {
      this.report('warn', story, 'user-message', '群消息端点注册表不可用 群频道=%s 错误=%s', targetGroupId, error)
      return failed('endpoint-registry-unavailable')
    }
    const endpointRows: EndpointRow[] = Array.isArray(this.endpointRows) ? this.endpointRows : []
    let fallbackAddress: { platform: string, selfId: string, endpointId?: string } | undefined
    let selectedEndpoint: EndpointRow | undefined
    let endpointOwner: { kind: 'story-role' | 'group', id: string } = { kind: 'story-role', id: story.id }
    let bot: any
    const sessionGroupId = normalizeGroupId(String((session as any)?.guildId ?? session?.channelId ?? ''))
    const sessionBot = (!sessionGroupId || sessionGroupId === targetGroupId) && session?.bot && typeof (session.bot as any).sendMessage === 'function'
      ? session.bot
      : undefined
    const sessionMatchesEndpoint = (endpoint: EndpointRow | undefined) => !!endpoint && !!sessionBot
      && String(session?.selfId ?? '') === String(endpoint.selfId)
      && (session?.platform === endpoint.platform || isOneBotPlatform(String(session?.platform ?? '')) && isOneBotPlatform(endpoint.platform))
    const observeSessionEndpoint = (endpoint: EndpointRow | undefined) => {
      if (!endpoint || !session || !sessionMatchesEndpoint(endpoint)) return
      const previous = this.endpointStates.get(endpoint.id) ?? freshEndpointState(endpoint.id)
      if (!previous.connection.online) this.setEndpointState(endpoint.id, stateAfterConnection(previous, true))
    }
    if (endpointId) {
      // Explicit group routing may only select this story's role endpoint or
      // the registered endpoint belonging to the requested group.
      const endpoint = endpointRows.find(row => row.id === endpointId && (
        row.ownerKind === 'story-role' && row.ownerId === story.id
        || row.ownerKind === 'group' && normalizeGroupId(row.groupId ?? row.ownerId) === targetGroupId
      ))
      if (!endpoint) {
        this.report('warn', story, 'user-message', '群消息指定端点无效或不属于目标群 端点=%s 群频道=%s', endpointId, targetGroupId)
        return failed('endpoint-not-found')
      }
      // The incoming group Session is a current connection observation. Apply
      // it before the delivery gate so the first immediate reply is not
      // rejected as offline merely because lifecycle events arrived later.
      observeSessionEndpoint(endpoint)
      const gated = this.endpointForDelivery(endpoint.id, endpoint.ownerKind === 'group'
        ? { kind: 'group', id: endpoint.ownerId }
        : { kind: 'story-role', id: story.id })
      if (gated.reason || !gated.row) return failed(gated.reason ?? 'endpoint-not-deliverable')
      selectedEndpoint = gated.row
      endpointOwner = selectedEndpoint.ownerKind === 'group'
        ? { kind: 'group', id: selectedEndpoint.ownerId }
        : { kind: 'story-role', id: story.id }
      fallbackAddress = { platform: gated.row.platform, selfId: gated.row.selfId, endpointId: gated.row.id }
      bot = this.ctx.bots.find(item => String(item.selfId) === String(endpoint.selfId)
        && (item.platform === endpoint.platform || isOneBotPlatform(item.platform) && isOneBotPlatform(endpoint.platform)))
    } else {
      // A private session that authored a cross-group action is not a valid
      // group transport session. Use it only when its channel is this group.
      // Older adapters do not expose guildId/channelId on the synthetic
      // session passed to this helper. Preserve their live-session routing;
      // when a channel is known, only reuse it for the same target group.
      fallbackAddress = this.endpointAddressSync({ platform: story.platform, selfId: story.selfId }, { kind: 'story-role', id: story.id })
      if (fallbackAddress.endpointId) {
        const candidate = endpointRows.find(row => row.id === fallbackAddress!.endpointId)
        observeSessionEndpoint(candidate)
        const gated = this.endpointForDelivery(fallbackAddress.endpointId, { kind: 'story-role', id: story.id })
        if (gated.reason || !gated.row) return failed(gated.reason ?? 'endpoint-not-deliverable')
        selectedEndpoint = gated.row
      }
      const sessionMatches = !selectedEndpoint || sessionMatchesEndpoint(selectedEndpoint)
      bot = sessionBot && sessionMatches ? sessionBot : this.ctx.bots.find(item => String(item.selfId) === String(fallbackAddress!.selfId)
        && (item.platform === fallbackAddress!.platform || isOneBotPlatform(item.platform) && isOneBotPlatform(fallbackAddress!.platform)))
    }
    if (!bot && !this.desktopDeliveryHandler) {
      this.report('warn', story, 'user-message', '没有可用机器人账号投递群消息 群频道=%s 故事平台=%s 故事账号=%s', targetGroupId, story.platform, story.selfId)
      return failed('bot-not-found')
    }
    let allDelivered = true
    const deliveredSegments: string[] = []
    const segmentOutcomes: GroupDeliveryResult['segmentOutcomes'] = []
    for (const [index, segment] of segments.entries()) {
      const settled = control?.settled.get(index)
      if (settled) {
        segmentOutcomes.push({ index, content: segment, status: settled })
        if (settled === 'delivered') deliveredSegments.push(segment)
        else allDelivered = false
        continue
      }
      if (control?.shouldCancel()) {
        allDelivered = false
        segmentOutcomes.push({ index, content: segment, status: 'failed', reason: 'delivery-generation-obsolete' })
        continue
      }
      const outgoing = index === 0 && replyToMessageId
        ? [h('quote', { id: replyToMessageId }), segment]
        : segment
      try {
        const address = selectedEndpoint
          ? { platform: selectedEndpoint.platform, selfId: selectedEndpoint.selfId }
          : { platform: fallbackAddress!.platform, selfId: fallbackAddress!.selfId }
        if (this.desktopDeliveryHandler) {
          const outcome = await this.desktopDeliveryHandler({
            participantId: `group:${targetGroupId}`,
            selfId: address.selfId,
            platform: address.platform,
            channelId: transportGroupId,
            kind: 'group',
            content: segment,
            ...(correlation?.traceId ? { traceId: correlation.traceId } : {}),
            ...(correlation?.processingId ? { processingId: correlation.processingId } : {}),
            ...(index === 0 && replyToMessageId ? { quoteMessageId: replyToMessageId } : {}),
            ...(selectedEndpoint?.id ? { endpointId: selectedEndpoint.id } : {}),
          })
          if (!outcome.ok) throw new Error(outcome.error || 'typ-0 群消息投递失败。')
        } else {
          const receipt = await withTransportTimeout(bot.sendMessage(transportGroupId, outgoing), 'group-send')
          if (Array.isArray(receipt) && !receipt.length) throw new Error('Group transport returned no message receipt.')
        }
        control?.onDelivered(index, segment)
        // 状态按实际投递的 bot 归因——实时群会话优先时归因到 session.bot，
        // 否则归因到解析出的兜底账号（多角色下不再错刷 fallback）。
        const actualBot = (bot as unknown as { platform?: string, selfId?: string } | undefined)
        this.noteEndpointOutbound(endpointOwner, true, 'group-delivered', { platform: String(actualBot?.platform ?? address.platform), selfId: String(actualBot?.selfId ?? address.selfId) })
        deliveredSegments.push(segment)
        segmentOutcomes.push({ index, content: segment, status: 'delivered' })
      }
      catch (error) {
        allDelivered = false
        segmentOutcomes.push({ index, content: segment, status: 'failed', reason: clip(String(error), 500) })
        const address = selectedEndpoint
          ? { platform: selectedEndpoint.platform, selfId: selectedEndpoint.selfId }
          : { platform: fallbackAddress!.platform, selfId: fallbackAddress!.selfId }
        this.noteEndpointOutbound(endpointOwner, false, String(error), address)
        this.report('error', story, 'user-message', '群消息投递失败 群频道=%s 错误=%s', targetGroupId, error)
      }
    }
    return { deliveredSegments, complete: allDelivered, segmentOutcomes }
  }

  /**
   * Persisted messages wait here briefly before they reach the narrator. This
   * makes “你好 / 在吗 / 我有件事想问” one event without risking message loss.
   */
  private bufferUserNarrative(story: InterludeStory, participant: InterludeParticipant, session: Session, now: Date, supersededIntents: NarrativeIntent[], content = String(session.content ?? ''), imageSources: string[] = [], audioSources: string[] = [], quote?: QuotedMessageContext, endpointId?: string) {
    this.turnEngine.bufferUserNarrative(story, participant, session, now, supersededIntents, content, imageSources, audioSources, quote, (key, revision) => void this.flushBufferedNarrative(key, revision), endpointId)
  }

  private signalIncomingInterruption(story: InterludeStory, participant: InterludeParticipant) {
    this.interruptedTypingParticipants.add(participant.id)
    this.turnEngine.signalIncomingInterruption(story, participant)
  }

  /** Experimental streaming path: only a complete, validated private reply
   * may leave early. It commits the existing interruption boundary at the
   * same moment as ordinary first-message delivery. */
  private async deliverEarlyPrivateReply(
    story: InterludeStory,
    participant: InterludeParticipant,
    session: Session | undefined,
    turn: BufferedNarrativeTurn,
    requestId: number,
    reply: EarlyNarrativeReply,
    requestStartedAt?: Date,
  ) {
    if (reply.kind !== 'private' || !reply.interaction || reply.interaction.reply.mode !== 'immediate') return false
    if (turn.nextRevision !== requestId || turn.obsoleteRequestIds.has(requestId) || turn.firstMessageCommittedRequestId === requestId) return false
    if (!this.canHandleParticipant(participant)) return false
    // 早发内容与常规投递共用同一可见文本合约：长度上限与括号表情标签清理一致。
    const content = sanitizeAndClampVisibleContent(reply.interaction.reply.content, this.config.runtime.maxMessageCharacters, this.config.runtime.messageSeparator)
    if (!content || this.splitOutgoingMessage(content).length !== 1) return false
    const confirmed: ScriptEntry[] = []
    const delivered = await this.deliverOutgoingMessages(story, [{
      participantId: participant.id, content, interaction: reply.interaction, userInitiated: true,
    }], participant, session, undefined, true, requestStartedAt, 'failed', false, confirmed)
    if (!delivered.length) return false
    if (!confirmed.length) return false
    turn.firstMessageCommittedRequestId = requestId
    this.reportOperation('standard', 'info', story, 'user-message', '实验性流式首条回复已提前投递 参与者=%s 请求=%d', participant.id, requestId)
    return confirmed[0]
  }

  /** Normalized native-audio understanding config (Console model.audio). */
  private get audioConfig(): AudioConfig {
    if (this.cachedAudioConfig) return this.cachedAudioConfig
    const configured = this.config.model?.audio
    const formats = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'amr'] as const
    const outFormat = formats.includes(configured?.outFormat as never) ? configured!.outFormat! : 'mp3'
    return this.cachedAudioConfig = {
      enabled: configured?.enabled === true,
      outFormat,
      maxFileSizeMB: Math.max(1, Math.min(25, Math.floor(Number(configured?.maxFileSizeMB) || 10))),
      maxPerMessage: Math.max(1, Math.min(3, Math.floor(Number(configured?.maxPerMessage) || 1))),
    }
  }

  private get stickerConfig(): StickerLibraryConfig {
    if (this.cachedStickerConfig) return this.cachedStickerConfig
    const configured = this.config.stickers
    return this.cachedStickerConfig = {
      enabled: configured?.enabled === true,
      directory: String(configured?.directory || 'data/hds-interlude/stickers').trim(),
      maxFileSizeMB: Math.max(1, Math.min(30, Number(configured?.maxFileSizeMB) || 10)),
      catalogLimit: Math.max(1, Math.min(80, Math.floor(Number(configured?.catalogLimit) || 40))),
      descriptionMaxTokens: Math.max(256, Math.min(4_096, Math.floor(Number(configured?.descriptionMaxTokens) || 768))),
      descriptionResponseFormat: configured?.descriptionResponseFormat === 'prompt-only' ? 'prompt-only' : 'json-object',
      // 修复：此前漏拷此字段——Console 配置的投递基址静默失效，Docker 部署下
      // 永远回落 127.0.0.1:5140，OneBot 实现拉不到贴纸（retcode 1200/100）。
      deliveryBaseUrl: String(configured?.deliveryBaseUrl ?? '').trim(),
      deliveryMode: configured?.deliveryMode === 'http' || configured?.deliveryMode === 'file' ? configured.deliveryMode : 'auto',
    }
  }

  /** One user event folds typed text, images and voice into a single fact:
   * attachments ride their own native channels, the stored content keeps a
   * place-holder fact so history and the desktop timeline stay readable. */
  private describeUserEvent(story: InterludeStory, session: Session, forward?: ForwardReadResult) {
    const visual = this.describeVisionEvent(session)
    // 合并转发内的图片并入本轮视觉输入（正文占位符已由 mergeForwardContent 保留）
    const sources = forward?.imageRefs?.length
      ? Array.from(new Set([...visual.sources, ...forward.imageRefs]))
      : visual.sources
    const audioSources = extractSessionAudioSources(session)
    const files = extractSessionFileFacts(session)
    const audioFiles = files.filter(file => file.audio)
    const plainFiles = files.filter(file => !file.audio)
    let content = visual.content
    if (forward) content = mergeForwardContent(content, forward.content)
    if (!content) {
      content = visual.sources.length ? '[用户发送了图片；图片内容以本轮视觉输入为准，未提供视觉内容时保持未知。]'
        : audioSources.length ? audioFiles.length
          ? `[用户发送了音频文件：${audioFiles.map(file => file.name || '音频文件').join('、')}；音频内容以本轮原生音频输入为准，未提供音频内容时保持未知。]`
          : '[用户发送了一条语音；语音内容以本轮原生音频输入为准，未提供音频内容时保持未知。]'
          : plainFiles.length ? `[用户发送了文件：${plainFiles.map(file => file.name || '未命名文件').join('、')}；文件内容未知。]`
            : ''
    } else if (plainFiles.length) {
      // 有文字时音频走原生通道（currentEvent.audioCount），普通文件没有
      // 独立通道，必须以文字事实补记，否则模型不知道有文件到达。
      content = `${content}\n[用户同时发送了文件：${plainFiles.map(file => file.name || '未命名文件').join('、')}；文件内容未知。]`
    }
    return {
      content,
      sources,
      audioSources,
      quote: describeQuotedMessage(session, story.setting.character.name),
    }
  }

  private async readForward(session: Session): Promise<ForwardReadResult | undefined> {
    if (!extractForwardIds(session.content).length) return undefined
    if (this.config.runtime.forwardMessage?.enabled === false) return undefined
    const result = await readForwardContent(session, this.config.runtime.forwardMessage)
    if (result?.failed) this.reportStandaloneOperation('diagnostic', 'warn', '合并转发读取失败 平台=%s 机器人ID=%s 用户ID=%s%s', session.platform, session.selfId, session.userId, result.cause ? ` 原因=${clip(result.cause, 120)}` : '')
    else if (result?.nestedFailed) this.reportStandaloneOperation('diagnostic', 'warn', '合并转发部分嵌套内容读取失败 次数=%d（正文以占位符降级） 平台=%s', result.nestedFailed, session.platform)
    else if (result) this.reportStandaloneOperation('diagnostic', 'debug', '合并转发读取完成 节点=%d 嵌套=%d 截断=%s', result.nodeCount, result.forwardCount, result.truncated)
    return result
  }

  private async scanStickerLibrary() {
    const config = this.stickerConfig
    if (!config.enabled || this.stickerScanRunning) return
    this.stickerScanRunning = true
    try {
      const root = resolve(this.ctx.baseDir, config.directory)
      const files = await listStickerFiles(root)
      const existing = await this.dbGet('interlude_sticker', {}) as StickerAsset[]
      // 旧版 assetId 折叠缺陷留下的重复行会让每轮扫描在 UNIQUE 约束上崩掉；
      // 扫描前按 assetId/filePath 去重（保留 updatedAt 最新一条），库自愈。
      const dedupeKey = (item: StickerAsset) => `${item.assetId}\u0000${item.filePath}`
      const newestByKey = new Map<string, StickerAsset>()
      for (const item of existing) {
        const key = dedupeKey(item)
        const prior = newestByKey.get(key)
        if (!prior || item.updatedAt > prior.updatedAt) newestByKey.set(key, item)
      }
      for (const item of existing) {
        if (newestByKey.get(dedupeKey(item)) !== item) await this.dbRemove('interlude_sticker', { id: item.id })
      }
      const deduped = [...newestByKey.values()]
      const byPath = new Map(deduped.map(item => [item.filePath, item]))
      const seen = new Set<string>()
      const pending: Array<{ asset: StickerAsset, bytes: Buffer }> = []
      for (const file of files) {
        const filePath = relative(root, file).replace(/\\/g, '/')
        if (!filePath || filePath.startsWith('../')) continue
        seen.add(filePath)
        try {
          const info = await stat(file)
          if (info.size > config.maxFileSizeMB * 1024 * 1024) continue
          const bytes = await readFile(file)
          const hash = createHash('sha256').update(bytes).digest('hex')
          const prior = byPath.get(filePath)
          if (prior?.hash === hash && prior.status === 'active') continue
          if (prior?.hash === hash && prior.status === 'pending' && Date.now() - prior.updatedAt.getTime() < STICKER_DESCRIPTION_RETRY_COOLDOWN) continue
          const group = filePath.includes('/') ? filePath.split('/')[0] : 'default'
          const assetId = stableStickerAssetId(filePath, hash)
          const now = new Date()
          const base = {
            assetId, filePath, group: group.slice(0, 128), mimeType: stickerMime(filePath), animated: /\.gif$/i.test(filePath),
            size: bytes.length, hash, description: '', aliases: [], status: 'pending' as const, updatedAt: now,
          }
          const asset = prior
            ? await this.dbSet('interlude_sticker', { id: prior.id }, base).then(() => ({ ...prior, ...base }))
            : await this.dbCreate('interlude_sticker', { ...base, createdAt: now }) as StickerAsset
          pending.push({ asset, bytes })
        } catch (error) {
          // A malformed file, old duplicate row, or transient SQLite write must
          // not starve the rest of the library for another five-minute cycle.
          this.reportStandaloneOperation('standard', 'warn', '表情包素材跳过 文件=%s 错误=%s', filePath, error)
        }
      }
      for (const asset of existing) {
        if (asset.status !== 'missing' && !seen.has(asset.filePath)) await this.dbSet('interlude_sticker', { id: asset.id }, { status: 'missing', updatedAt: new Date() })
      }
      if (pending.length && !this.stickerDescriber.available()) {
        this.reportStandalone('warn', '表情包库发现新素材，但没有配置 useForStickers 的视觉模型；已等待描述。')
      }
      for (const item of pending.slice(0, 5)) {
        if (!this.stickerDescriber.available()) break
        let description: StickerDescription | undefined
        try {
          const visual = await this.imageBytesToNative(item.bytes, item.asset.mimeType)
          description = visual && await this.stickerDescriber.describeSticker(visual.dataUri, visual.mimeType, item.asset.filePath, item.asset.animated, config.descriptionResponseFormat, config.descriptionMaxTokens)
        } catch (error) {
          this.reportStandaloneOperation('standard', 'warn', '表情包描述失败，已冷却后重试 素材=%s 错误=%s', item.asset.assetId, error)
          await this.dbSet('interlude_sticker', { id: item.asset.id }, { updatedAt: new Date() })
          continue
        }
        if (!description) {
          this.reportStandaloneOperation('standard', 'warn', '表情包描述未返回可用 JSON，已冷却后重试 素材=%s', item.asset.assetId)
          await this.dbSet('interlude_sticker', { id: item.asset.id }, { updatedAt: new Date() })
          continue
        }
        const updated = await this.dbSet('interlude_sticker', { id: item.asset.id }, {
          description: description.description, aliases: description.aliases, status: 'active', updatedAt: new Date(),
        }) as StickerAsset | undefined
        if (updated && this.semanticStickerEmbeddingEnabled()) {
          // Index a freshly described asset immediately so the semantic filter
          // can consider it on the very next turn instead of the next scan.
          const embedding = await this.embedText(`${description.description} ${description.aliases.join(' ')}`.trim())
          if (embedding.length) await this.dbSet('interlude_sticker', { id: item.asset.id }, { embedding, updatedAt: new Date() })
        }
        this.reportStandaloneOperation('standard', 'info', '表情包描述完成 素材=%s 分组=%s', item.asset.assetId, item.asset.group)
      }
      await this.refreshStickerCatalog()
      await this.backfillStickerEmbeddings()
      await this.refreshStickerCatalog()
    } catch (error) {
      this.reportStandalone('warn', '表情包库扫描失败：%s', error)
    } finally {
      this.stickerScanRunning = false
    }
  }

  /** 表情包投递基址：显式配置 > Koishi selfUrl > 本机默认端口。 */
  private stickerDeliveryBase() {
    const configured = String(this.stickerConfig.deliveryBaseUrl ?? '').trim()
    if (configured) return configured
    const selfUrl = String((this.ctx as any).options?.selfUrl ?? (this.ctx as any).config?.selfUrl ?? '').trim()
    return selfUrl || 'http://127.0.0.1:5140'
  }

  /** 表情包 HTTP 回源路由：OneBot 实现（NapCat/Lagrange）分容器时经此下载文件。
   * 仅服务素材库内、资产表登记过的文件；assetId 即查询键，无目录穿越面。 */
  private registerStickerRoute() {
    // 已注册过或宿主没有 router 时才跳过;此前条件写反导致路由从未注册,
    // 独立 Koishi + OneBot 分容器部署的表情包回源全部 404
    if (this.stickerRouteRegistered || !(this.ctx as any).router) return
    this.stickerRouteRegistered = true
    ;(this.ctx as any).router.get('/hds-interlude/sticker/:assetId', async (koa: any) => {
      const asset = this.stickerById.get(koa.params.assetId)
      if (!asset || asset.status !== 'active') { koa.status = 404; return }
      const root = resolve(this.ctx.baseDir, this.stickerConfig.directory)
      const file = resolve(root, asset.filePath)
      const inside = relative(root, file)
      if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || inside.includes(':')) { koa.status = 404; return }
      koa.type = asset.mimeType || 'image/png'
      koa.set('cache-control', 'public, max-age=86400')
      const stream = createReadStream(file)
      // 素材可能在响应前被扫描任务清理:流错误回 404,而不是让请求挂起
      stream.on('error', () => { koa.status = 404; koa.body = undefined })
      koa.body = stream
    })
    this.reportStandaloneOperation('diagnostic', 'debug', '表情包回源路由已注册 基址=%s', this.stickerDeliveryBase())
  }

  private stickerRouteRegistered = false

  private async refreshStickerCatalog() {
    const rows = await this.dbGet('interlude_sticker', { status: 'active' }, { sort: { updatedAt: 'desc' } }) as StickerAsset[]
    this.stickerCatalog = rows
    this.stickerById = new Map(rows.map(item => [item.assetId, item]))
  }

  private semanticStickerEmbeddingEnabled() {
    return this.config.model.embedding?.semanticStickerFilter === true
  }

  /** Vectorize described-but-unindexed sticker assets in the background. The
   * batch stays small so one scan cannot spend more than a handful of calls. */
  private async backfillStickerEmbeddings() {
    if (!this.semanticStickerEmbeddingEnabled()) return
    const pending = this.stickerCatalog
      .filter(asset => asset.description && !asset.embedding?.length)
      .slice(0, 8)
    for (const asset of pending) {
      const text = `${asset.description} ${(asset.aliases ?? []).join(' ')}`.trim()
      const embedding = await this.embedText(text)
      if (embedding.length) await this.dbSet('interlude_sticker', { id: asset.id }, { embedding, updatedAt: new Date() })
    }
  }

  private async stickerCatalogForSession(session: Session | undefined, turnQueryEmbedding?: number[]): Promise<StickerCatalogEntry[]> {
    const config = this.stickerConfig
    if (!config.enabled || !session || !isOneBotPlatform(session.platform)) return []
    const assets = await this.rankStickerAssets(turnQueryEmbedding)
    return assets.map(asset => ({
      assetId: asset.assetId, group: asset.group, description: asset.description, aliases: Array.isArray(asset.aliases) ? asset.aliases : [], animated: asset.animated,
    }))
  }

  /** Semantically narrow the sticker catalog to the entries most relevant to the
   * live message. Falls back to the full catalog whenever the feature is off,
   * the turn has no query vector, or the catalog is below the limit. */
  private async rankStickerAssets(turnQueryEmbedding?: number[]): Promise<StickerAsset[]> {
    const assets = this.stickerCatalog.slice(0, this.stickerConfig.catalogLimit)
    if (!this.config.model.embedding?.semanticStickerFilter) return assets
    if (!turnQueryEmbedding?.length || assets.length <= SEMANTIC_STICKER_LIMIT) return assets
    return rankStickerCatalog(assets, turnQueryEmbedding, SEMANTIC_STICKER_LIMIT)
  }

  private semanticTurnEmbeddingEnabled() {
    return shouldRequestTurnEmbedding(
      this.config.model.embedding,
      this.stickerConfig.enabled,
      this.stickerCatalog.length,
    )
  }

  /** Compact summaries of the scenes immediately before the active one. They
   * bridge the raw context window and the arc, where last-turn details used to
   * disappear from the prompt entirely. */
  /** 弧摘要进 prompt 前的独立裁剪:存储侧保留全量(arcSummaryCharacters,默认 12k),
   * prompt 侧默认只带尾部(arcPromptCharacters,默认 6k)——弧层与 previousScenes/
   * 长线投影叠加时,12k 全量每回合在场会挤压 recentScript 预算,尾部最贴近当前。 */
  private trimArcForPrompt(arc: InterludeArc | null): InterludeArc | null {
    if (!arc) return arc
    const limit = this.memoryConfig.arcPromptCharacters ?? 6_000
    if (!limit || arc.summary.length <= limit) return arc
    return { ...arc, summary: `…(前文摘要已省略)${arc.summary.slice(arc.summary.length - limit)}` }
  }

  private async previousSceneSummaries(story: InterludeStory): Promise<PreviousSceneSummary[]> {
    const limit = this.memoryConfig.previousSceneSummaries
    if (!limit || !this.memoryConfig.enabled) return []
    const rows = await this.dbGet('interlude_scene', { storyId: story.id, status: 'closed' }, {
      limit, sort: { endedAt: 'desc' },
    }) as InterludeScene[]
    // 场景桥接的时间用故事本地时区渲染——体系其余处均为 occurredAtLocal,
    // UTC ISO 会让时区敏感剧情在模型侧产生昼夜歧义
    return rows
      .filter(scene => scene.summary.trim() && scene.endedAt)
      .map(scene => ({
        startedAt: formatLogTime(scene.startedAt, story.setting.timezone),
        endedAt: formatLogTime(scene.endedAt ?? scene.startedAt, story.setting.timezone),
        summary: scene.summary.slice(0, 2_000),
      }))
  }

  /** Drop expired scratchpad entries and cap the list; details only ever carry
   * small in-flight facts, so silence is the correct treatment for expiry. */
  private pruneWorkingDetails(details: WorkingDetail[] | undefined, now: Date): WorkingDetail[] | undefined {
    if (!details?.length) return undefined
    const live = details.filter(item => !item.expiresAt || new Date(item.expiresAt) > now)
    return live.length ? live.slice(-10) : undefined
  }

  /** Multi-lane recall over the whole immutable script. Embeddings improve the
   * ranking but are never a prerequisite: literal wording and fact provenance
   * keep cross-day memory available while vector backfill is incomplete. */
  private async recallHistory(
    storyId: string,
    participantId: string,
    query: string,
    turnQueryEmbedding: number[],
    excludeIds: Set<number>,
    preferredEntryIds = new Set<number>(),
    maxResults = 3,
  ): Promise<RecalledMoment[]> {
    await this.ensureHistoryVectors(storyId)
    const cache = this.historyVectors.get(storyId)
    if (!cache?.size) return []
    const cacheKey = JSON.stringify([participantId, query, [...excludeIds], [...preferredEntryIds], this.sharedStoryConfig.shareParticipantDetails])
    const memo = this.automaticRecallCache?.get(storyId)
    if (maxResults === 1 && memo?.source === cache && memo.size === cache.size && memo.key === cacheKey && memo.until > Date.now()) {
      return memo.result.map(item => ({ ...item, sourceEntryIds: [...(item.sourceEntryIds ?? [])] }))
    }
    const scored: Array<{ id: number, score: number }> = []
    const keys = recallKeys(query).slice(0, 120)
    const primaryKeys = recallKeys(query.split('\n')[0]).slice(0, 80)
    const shareDetails = !!participantId && this.sharedStoryConfig.shareParticipantDetails
    const identity = this.embedder?.identity?.()
    for (const [id, item] of cache) {
      if (excludeIds.has(id)) continue
      if (!isHistoryEntryVisibleToParticipant(item, participantId, shareDetails)) continue
      const semantic = item.embeddingIdentity && item.embeddingIdentity !== identity
        ? undefined : cosineSimilarity(turnQueryEmbedding, item.vector ?? [])
      const spans = item.spans ??= indexOriginal(item.content)
      const lexical = Math.max(scoreOriginal(primaryKeys, spans).score, scoreOriginal(keys, spans).score * 0.8)
      const tagged = episodeTagScore(query, item.tags)
      const source = preferredEntryIds.has(id) ? 1 : 0
      if (source === 0 && tagged === 0 && (semantic == null || semantic < 0.25) && lexical < 0.12) continue
      // Prose similarity alone often recalls a familiar gesture rather than
      // the event. Literal/source matches retain priority over writing style.
      scored.push({ id, score: source * 2 + tagged + Math.max(0, semantic ?? 0) * (item.kind === 'script' ? 0.45 : 1) + lexical })
    }
    // Navigation belongs to the audience, not to this turn's excluded entries.
    const episodeKey = JSON.stringify([storyId, participantId ?? null, this.sharedStoryConfig.shareParticipantDetails])
    let indexed = this.episodeIndexes.get(episodeKey)
    if (indexed?.source !== cache || indexed.size !== cache.size) {
      const ordered = [...cache.entries()]
        .filter(([, item]) => isHistoryEntryVisibleToParticipant(item, participantId, shareDetails))
        .sort((left, right) => left[1].occurredAt.localeCompare(right[1].occurredAt) || left[0] - right[0])
      indexed = { source: cache, size: cache.size, ordered, byEntry: buildEpisodeIndex(ordered) }
      if (this.episodeIndexes.size >= 64) this.episodeIndexes.delete(this.episodeIndexes.keys().next().value!)
      this.episodeIndexes.set(episodeKey, indexed)
    }
    const visible = indexed.ordered.filter(([id]) => !excludeIds.has(id))
    const episodes = indexed.byEntry
    const positions = new Map(visible.map(([id], index) => [id, index]))
    const used = new Set<number>()
    const result: RecalledMoment[] = []
    for (const anchor of scored.sort((left, right) => right.score - left.score || right.id - left.id)) {
      const position = positions.get(anchor.id)
      if (position == null || used.has(anchor.id)) continue
      const episodeIds = episodes.get(anchor.id) ?? [anchor.id]
      const episodeMembers = new Set(episodeIds)
      const neighborhood = episodeIds.length > 1
        ? visible.filter(([id]) => episodeMembers.has(id))
        : visible.filter(([, item]) => item.participantId === cache.get(anchor.id)!.participantId)
      const excerpt = episodeExcerpt(neighborhood, anchor.id, maxResults === 1 ? 2400 : 4000, keys)
      if (!excerpt) continue
      const { sourceEntryIds, content } = excerpt
      sourceEntryIds.forEach(id => used.add(id))
      result.push({
        id: anchor.id,
        occurredAt: cache.get(anchor.id)!.occurredAt,
        content,
        sourceEntryIds,
      })
      if (result.length >= maxResults) break
    }
    if (maxResults === 1) {
      this.automaticRecallCache ??= new Map()
      this.automaticRecallCache.set(storyId, { source: cache, size: cache.size, key: cacheKey, until: Date.now() + 60_000, result })
    }
    return result
  }

  /** Load every recallable entry of one story into the recall cache. The load is
   * deliberately whole-table (no time window): older memories stay retrievable,
   * and the per-process cache makes the cost one-off per story. */
  private async ensureHistoryVectors(storyId: string) {
    const pending = this.historyVectorLoads.get(storyId)
    if (pending) return pending
    if (this.historyVectorsReady.has(storyId)) return
    const cache = new Map<number, HistoryVectorEntry>()
    this.historyVectors.set(storyId, cache)
    const load = (async () => { try {
      const rows = await this.dbGet('interlude_script_entry', { storyId }) as ScriptEntry[]
      for (const row of rows) {
        if (!RECALLABLE_ENTRY_KINDS.includes(row.kind)) continue
        if (cache.has(row.id)) continue // a live append/backfill won the race
        cache.set(row.id, {
          embeddingIdentity: typeof row.metadata?.embeddingIdentity === 'string' ? row.metadata.embeddingIdentity : undefined,
          tags: Object.values(groundedEpisodeTags(row.content, (row.metadata?.episodeTags ?? {}) as Record<string, unknown>)).flat(),
          checkpoint: row.metadata?.sceneCheckpoint as HistoryVectorEntry['checkpoint'],
          frameId: typeof row.metadata?.frameId === 'string' ? row.metadata.frameId : undefined,
          ...(row.embedding?.length ? { vector: row.embedding } : {}),
          content: promptVisibleMessageContent(row.content, recentScriptOwnership(row)),
          occurredAt: row.occurredAt.toISOString(),
          participantId: row.participantId,
          kind: row.kind,
        })
      }
      if (this.historyVectors.get(storyId) === cache) this.historyVectorsReady.add(storyId)
    } catch (error) {
      this.historyVectorsReady.delete(storyId)
      this.reportStandaloneOperation('diagnostic', 'debug', '历史向量缓存加载失败 错误=%s', error)
    } })()
    this.historyVectorLoads.set(storyId, load)
    try { await load } finally { if (this.historyVectorLoads.get(storyId) === load) this.historyVectorLoads.delete(storyId) }
  }

  /** Drop in-memory copies whenever their source rows are removed or redacted.
   * The next recall reloads only the surviving database rows. */
  private invalidateHistoryVectors(storyId?: string) {
    this.episodeIndexes.clear()
    if (storyId) {
      this.historyVectors.delete(storyId)
      this.historyVectorsReady.delete(storyId)
      this.historyVectorLoads.delete(storyId)
      this.automaticRecallCache.delete(storyId)
      return
    }
    this.historyVectors.clear()
    this.historyVectorsReady.clear()
    this.historyVectorLoads.clear()
    this.automaticRecallCache.clear()
  }

  /** Background vectorization for semantic history recall. Newest entries go
   * first so live-recall quality ramps up quickly; the whole table is covered
   * gradually over successive maintenance passes. */
  private async backfillHistoryEmbeddings(storyId: string) {
    if (!this.config.model.embedding?.enabled || !this.config.model.embedding.semanticHistory) return
    const batchSize = Math.min(20, Math.max(0, Math.floor(this.config.model.embedding.backfillBatchSize ?? 5)))
    if (!batchSize || this.historyBackfills.has(storyId) || Date.now() < (this.historyBackoff.get(storyId) ?? 0)) return
    this.historyBackfills.add(storyId)
    const started = Date.now()
    try {
      const identity = this.embedder.identity?.()
      const story = await this.getStory(storyId)
      const saved = decodeStoryState(story.state).extensions?.historyBackfill as { cursor?: number; identity?: string } | undefined
      let cursor = saved?.identity === identity && Number.isSafeInteger(saved?.cursor) ? Math.max(0, saved!.cursor!) : 0
      const [older, recent] = await Promise.all([
        this.dbGet('interlude_script_entry', { storyId, id: { $gt: cursor } }, { limit: 128, sort: { id: 'asc' } }),
        this.dbGet('interlude_script_entry', { storyId }, { limit: 64, sort: { id: 'desc' } }),
      ]) as [ScriptEntry[], ScriptEntry[]]
      const needsVector = (row: ScriptEntry) => RECALLABLE_ENTRY_KINDS.includes(row.kind) && row.content.trim()
        && (!row.embedding?.length || !!identity && row.metadata?.embeddingIdentity !== identity)
      let attempts = 0
      const completed = new Set<number>()
      const fill = async (row: ScriptEntry) => {
        attempts++
        const embedding = await this.embedText(row.content)
        if (!embedding.length) { this.historyBackoff.set(storyId, Date.now() + 60_000); return false }
        if (this.embedder.identity?.() !== identity) return false
        await this.serial(storyId, async () => {
          const [fresh] = await this.dbGet('interlude_script_entry', { storyId, id: row.id }) as ScriptEntry[]
          if (!fresh || fresh.content !== row.content) return
          await this.dbSet('interlude_script_entry', { storyId, id: row.id }, {
            embedding, metadata: { ...fresh.metadata, ...(identity ? { embeddingIdentity: identity } : {}) },
          })
          const cached = this.historyVectors.get(storyId)?.get(row.id)
          if (cached) { cached.vector = embedding; cached.embeddingIdentity = identity }
          this.automaticRecallCache.delete(storyId)
        })
        completed.add(row.id)
        return true
      }
      // Reserve one live slot only when an archive slot remains. Batch=1 still progresses through history.
      const live = batchSize > 1 ? recent.find(needsVector) : undefined
      if (live && !await fill(live)) return
      for (const row of older) {
        if (needsVector(row) && !completed.has(row.id)) {
          if (attempts >= batchSize || Date.now() - started >= 20_000) break
          if (!await fill(row)) break
        }
        cursor = row.id
      }
      if (!older.length) cursor = 0
      await this.serial(storyId, async () => {
        const fresh = await this.getStory(storyId)
        const state = decodeStoryState(fresh.state)
        await this.dbSet('interlude_story', { id: storyId }, { state: encodeStoryState({ ...state,
          extensions: { ...state.extensions, historyBackfill: { cursor, identity } },
        }) })
      })
    } finally { this.historyBackfills.delete(storyId) }
  }

  /** Download voice records as native audio attachments. QQ voice is SILK,
   * which multimodal models cannot read, so SnowLuma's get_record action is
   * always asked to transcode server-side (out_format) and return base64.
   * Mirrors the native-image acquisition path; nothing is persisted. */
  private async loadNativeAudio(story: InterludeStory, sources: string[], session?: Session, maxCount = this.audioConfig.maxPerMessage): Promise<NarrativeAudio[]> {
    const config = this.audioConfig
    if (!config.enabled || !sources.length) return []
    const audio: NarrativeAudio[] = []
    for (const [index, source] of sources.slice(0, Math.min(config.maxPerMessage, Math.max(0, maxCount))).entries()) {
      try {
        const item = await this.fetchNativeAudio(source, session)
        if (item) audio.push({ id: `turn-audio-${index + 1}`, ...item })
      } catch (error) {
        this.report('warn', story, 'user-message', '语音读取失败，已保留语音事实 错误=%s', error)
      }
    }
    return audio
  }

  private async fetchNativeAudio(source: string, session?: Session): Promise<{ format: string, base64: string } | undefined> {
    const config = this.audioConfig
    const format = config.outFormat ?? 'mp3'
    const value = String(source ?? '').trim()
    if (value.startsWith('onebot-file:')) {
      const file = value.slice('onebot-file:'.length)
      const internal = (session as any)?.bot?.internal
      if (!file || typeof internal?._request !== 'function') return undefined
      const response = await withTimeout(
        Promise.resolve(internal._request('get_record', { file, out_format: format })),
        30_000,
      ) as any
      if (response?.retcode != null && Number(response.retcode) !== 0) throw new Error(String(response?.wording || response?.message || `retcode=${response.retcode}`))
      if (response?.status && response.status !== 'ok') throw new Error(String(response?.wording || response?.message || response.status))
      const data = response?.data ?? response
      const base64 = typeof data?.base64 === 'string' ? data.base64.replace(/\s+/g, '') : ''
      if (!base64) throw new Error('SnowLuma get_record returned no transcoded payload')
      if (Buffer.byteLength(base64, 'base64') > config.maxFileSizeMB * 1024 * 1024) return undefined
      return { format, base64 }
    }
    if (value.startsWith('file-url:')) {
      // QQ 音频文件的 CDN 直链（带 rkey，短期有效）：原始字节可直接喂给
      // 模型；格式用文件名扩展 + 魔数双保险，避免把 SILK 语音误当文件。
      const payload = value.slice('file-url:'.length)
      const split = payload.lastIndexOf('#')
      const url = (split > 0 ? payload.slice(0, split) : payload).trim()
      const fragment = split > 0 ? payload.slice(split + 1) : ''
      const name = fragment ? decodeURIComponent(fragment.replace(/:\d+$/, '')) : ''
      const declaredSize = Number(/:(\d+)$/.exec(fragment)?.[1] ?? 0)
      if (!/^https?:\/\//i.test(url)) return undefined
      // 只信任 QQ/OneBot CDN 域名(与图片通道同一白名单):file-url 来自适配器
      // 数据,无白名单时会成为任意内网地址的请求代理
      try {
        if (!isTrustedImageHost(new URL(url).hostname)) return undefined
      } catch { return undefined }
      if (declaredSize > config.maxFileSizeMB * 1024 * 1024) return undefined
      const bytes = Buffer.from(await withTimeout(
        Promise.resolve(this.ctx.http.get(url, { responseType: 'arraybuffer' })), 30_000,
      ))
      if (!bytes.length || bytes.length > config.maxFileSizeMB * 1024 * 1024) return undefined
      const format = guessAudioFormat(bytes, name)
      if (!format) return undefined
      return { format, base64: bytes.toString('base64') }
    }
    if (/^data:audio\//i.test(value)) {
      // Adapter-provided inline audio: accept only formats models can read.
      const match = /^data:audio\/([a-z0-9]+);base64,([a-z0-9+/=\s]+)$/i.exec(value)
      const inlineFormat = (match?.[1] || '').toLowerCase()
      if (!match || !['mp3', 'wav', 'ogg', 'm4a', 'flac', 'amr'].includes(inlineFormat)) return undefined
      const base64 = match[2].replace(/\s+/g, '')
      if (!base64 || Buffer.byteLength(base64, 'base64') > config.maxFileSizeMB * 1024 * 1024) return undefined
      return { format: inlineFormat, base64 }
    }
    // Plain http(s) record URLs serve raw SILK; without a file token there is
    // no server-side transcode path, so the attachment is skipped deliberately.
    return undefined
  }

  private describeVisionEvent(session: Session) {
    const raw = String(session.content ?? '')
    const sources = extractSessionImageSources(session)
    const text = normalizeQQNativeFaceSegments(raw)
      .replace(/<\/?(?:img|image|audio|record|file)\b[^>]*>/gi, '')
      .replace(/\[CQ:(?:image|record|file),[^\]]*\]/gi, '')
      .trim()
    // The attachment itself is passed through the native multimodal channel.
    // Keep ordinary text free of image placeholders: a failed/filtered fetch
    // must look like no visual input rather than an invitation to invent one.
    const content = text
    return { content, sources }
  }

  private async loadNativeImages(story: InterludeStory, sources: string[], session?: Session): Promise<NarrativeImage[]> {
    if (!this.config?.model?.vision?.enabled || !sources.length) return []
    const images: NarrativeImage[] = []
    for (const [index, source] of sources.slice(0, 3).entries()) {
      const deadReason = this.deadImageSourceReason(source)
      if (deadReason !== undefined) {
        this.reportOperation('diagnostic', 'debug', story, 'user-message', '当前图片跳过：来源已判死(原因=%s) 序号=%d 来源=%s', deadReason, index + 1, describeImageSource(source))
        continue
      }
      try {
        const image = await this.fetchNativeImage(source, (session as any)?.bot)
        if (image) images.push({ id: `turn-image-${index + 1}`, ...image })
        else this.report('warn', story, 'user-message', '当前图片回源失败 阶段=current-image-fetch 序号=%d 来源=%s 原因=%s', index + 1, describeImageSource(source), this.deadImageSourceReason(source) ?? 'empty-or-unsupported')
      } catch (error) {
        // 重载窗口内 ctx.http 必然中止：静默放弃剩余图片。
        if (isContextDisposedError(error)) break
        this.report('warn', story, 'user-message', '当前图片回源失败 阶段=current-image-fetch 序号=%d 来源=%s 错误=%s', index + 1, describeImageSource(source), describeHttpError(error))
      }
    }
    return images
  }

  /** Sidecar vision mirrors native image acquisition, but sends only its
   * factual result into the text narrator's current event. */
  private async describeCurrentImages(story: InterludeStory, images: NarrativeImage[], userMessage: string | undefined) {
    if (!images.length) return undefined
    if (!this.visionDescriber.available()) {
      this.reportOperation('diagnostic', 'warn', story, 'user-message', '侧端识图跳过：没有配置 useForVision 的视觉模型')
      return undefined
    }
    try {
      const observations = await this.visionDescriber.describeImages(images, userMessage, this.config.model.vision?.detail ?? 'auto')
      if (observations?.length) {
        this.reportOperation('diagnostic', 'debug', story, 'user-message', '侧端识图完成 图片=%d 观察=%d', images.length, observations.length)
      } else {
        this.reportOperation('diagnostic', 'warn', story, 'user-message', '侧端视觉未返回内容 阶段=sidecar-vision 图片=%d，已继续处理文字消息', images.length)
      }
      return observations
    } catch (error) {
      if (isContextDisposedError(error)) {
        this.reportOperation('diagnostic', 'debug', story, 'user-message', '插件重载中，侧端识图放弃 图片=%d', images.length)
        return undefined
      }
      this.reportOperation('diagnostic', 'warn', story, 'user-message', '侧端视觉请求失败 阶段=sidecar-vision 图片=%d 错误=%s，已继续处理文字消息', images.length, describeHttpError(error))
      return undefined
    }
  }

  isExpiredImageSource(source: string) {
    return this.deadImageSources.has(String(source ?? '').trim())
  }

  /** 已判死来源的首次失败原因（未判死返回 undefined）。 */
  deadImageSourceReason(source: string) {
    return this.deadImageSources.get(String(source ?? '').trim())
  }

  private rememberDeadImageSource(source: string, reason: string) {
    const key = String(source ?? '').trim()
    if (!key) return
    if (this.deadImageSources.size >= 1000) {
      const oldest = this.deadImageSources.keys().next().value
      if (oldest !== undefined) this.deadImageSources.delete(oldest)
    }
    this.deadImageSources.set(key, reason)
  }

  private async fetchNativeImage(source: string, bot?: any, adapterProvided = false): Promise<{ mimeType: string, dataUri: string } | undefined> {
    const key = String(source ?? '').trim()
    if (this.isExpiredImageSource(key)) return undefined
    try {
      return await this.fetchNativeImageUncached(key, bot, adapterProvided)
    } catch (error) {
      if (isExpiredImageUrlError(error)) {
        this.rememberDeadImageSource(key, 'url-expired')
        return undefined
      }
      throw error
    }
  }

  /** QQ CDN 媒体 URL 会 302 跳转（SnowLuma stream-download 同款结论），
   * 原先的 redirect:'error' 把每一跳都变成非过期错误：不入负缓存、每轮
   * 重复失败。改为手动逐跳跟随（至多 3 跳），每跳按入口同一规则校验
   * 目标域，保住 SSRF 边界；跳向不受信域视为确定性失败判死。 */
  private async fetchImageThroughRedirects(url: URL, adapterProvided: boolean): Promise<{ data: ArrayBuffer, headers: { get(name: string): string | null } }> {
    let target = url
    for (let hop = 0; hop < 3; hop++) {
      const response = await this.ctx.http('GET', target.href, { responseType: 'arraybuffer', timeout: 10_000, redirect: 'manual' })
      const status = Number((response as { status?: unknown }).status ?? 200)
      if (status >= 300 && status < 400) {
        const location = response.headers?.get('location')
        if (!location) throw new Error(`image redirect without Location (HTTP ${status})`)
        let next: URL
        try { next = new URL(location, target) } catch { throw new Error(`image redirect Location invalid: ${clip(location, 120)}`) }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error(`image redirect to unsupported protocol ${next.protocol}`)
        if (!adapterProvided && !isTrustedImageHost(next.hostname)) {
          this.rememberDeadImageSource(target.href, 'untrusted-redirect')
          throw new Error(`image redirect to untrusted host ${next.hostname}`)
        }
        target = next
        continue
      }
      return response as { data: ArrayBuffer, headers: { get(name: string): string | null } }
    }
    throw new Error('image redirect chain too long (>3 hops)')
  }

  private async fetchNativeImageUncached(source: string, bot?: any, adapterProvided = false): Promise<{ mimeType: string, dataUri: string } | undefined> {
    const value = String(source ?? '').trim()
    if (value.startsWith('onebot-url:')) {
      const url = value.slice('onebot-url:'.length)
      const image = await this.fetchNativeImage(url, bot, true)
      // 内层 URL 判死时同步判死外层带前缀的 key：否则(合并转发引用的
      // 常态形态)每轮外层 miss→解包→内层命中负缓存→误报 empty-or-unsupported。
      if (!image) {
        const innerReason = this.deadImageSourceReason(url)
        if (innerReason !== undefined) this.rememberDeadImageSource(value, innerReason)
      }
      return image
    }
    // onebot-file: 无 bot 属于会话缺失(可能恢复),不判死。
    if (value.startsWith('onebot-file:')) {
      const file = value.slice('onebot-file:'.length)
      if (!file || !bot?.getImage) return undefined
      const info = await bot.getImage(file)
      const candidates = [info?.url, info?.file, info?.path].map(item => String(item ?? '').trim()).filter(Boolean)
      for (const candidate of candidates) {
        if (/^https?:\/\//i.test(candidate)) {
          const image = await this.fetchNativeImage(candidate, undefined, true)
          if (image) return image
        } else {
          try {
            const bytes = await readFile(candidate)
            const image = await this.imageBytesToNative(bytes, guessImageMime(bytes, info?.type))
            if (image) return image
          } catch { /* adapter may return a non-local alias; try its next field */ }
        }
      }
      return undefined
    }
    if (/^data:image\//i.test(value)) {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value)
      if (!match) { this.rememberDeadImageSource(value, 'malformed-data-uri'); return undefined }
      const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
      if (bytes.length > 4 * 1024 * 1024) { this.rememberDeadImageSource(value, 'oversized-data-uri'); return undefined }
      if (!bytes.length) return undefined
      const mimeType = match[1].toLowerCase()
      return this.imageBytesToNative(bytes, mimeType)
    }
    let url: URL
    try { url = new URL(value) } catch { this.rememberDeadImageSource(value, 'invalid-source'); return undefined }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { this.rememberDeadImageSource(value, 'invalid-source'); return undefined }
    if (!adapterProvided && !isTrustedImageHost(url.hostname)) { this.rememberDeadImageSource(value, 'untrusted-host'); return undefined }
    const response = await this.fetchImageThroughRedirects(url, adapterProvided)
    const bytes = Buffer.from(response.data)
    // 超限是确定性失败(该 URL 的图片就是这个大小);空响应可能是瞬时抖动,不判死。
    if (bytes.length > 4 * 1024 * 1024) { this.rememberDeadImageSource(value, 'oversized-download'); return undefined }
    if (!bytes.length) return undefined
    const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || guessImageMime(bytes)
    if (!mimeType.startsWith('image/')) { this.rememberDeadImageSource(value, 'non-image-content'); return undefined }
    return this.imageBytesToNative(bytes, mimeType)
  }

  /** Convert adapter/fetched bytes into one bounded native-vision attachment.
   * Animated stickers are rendered to a representative PNG frame when the
   * optional Puppeteer service is available; otherwise the original image is
   * still passed through rather than inventing a description. */
  private async imageBytesToNative(bytes: Buffer, mimeType: string): Promise<{ mimeType: string, dataUri: string } | undefined> {
    const normalized = String(mimeType || guessImageMime(bytes) || '').toLowerCase()
    if (!normalized.startsWith('image/')) return undefined
    const dataUri = `data:${normalized};base64,${bytes.toString('base64')}`
    if (isAnimatedImageMime(normalized)) {
      const frame = await this.renderAnimatedImageFrame(dataUri)
      if (frame) return frame
      // 配置建议只需提醒一次——每张动态图都刷一遍 warn 是噪音。
      if (!this.puppeteerHintLogged) {
        this.puppeteerHintLogged = true
        this.reportStandalone('warn', '动态图片未能抽帧，已使用原始图片输入；请启用 Puppeteer 以提高识别兼容性。')
      }
    }
    const scaled = await this.downscaleImageForVision({ mimeType: normalized, dataUri })
    return scaled ?? { mimeType: normalized, dataUri }
  }

  /** Re-render a static image through Puppeteer capped at the configured vision
   * dimension. Multimodal providers tile large images into many tokens, so a
   * bounded re-encode saves both upload time and per-turn token cost; the
   * browser also applies EXIF orientation, fixing rotated phone photos. */
  private async downscaleImageForVision(image: { mimeType: string, dataUri: string }): Promise<{ mimeType: string, dataUri: string } | undefined> {
    const maxDimension = this.config.model.vision?.maxImageDimension ?? 0
    if (!maxDimension || !shouldDownscaleImage(image.mimeType, image.dataUri)) return undefined
    const puppeteer = (this.ctx as any).puppeteer
    if (!puppeteer?.page) return undefined
    return this.withBrowserSlot(async () => {
      let page: any
      try {
        page = await puppeteer.page()
        await page.setViewport({ width: maxDimension, height: maxDimension, deviceScaleFactor: 1 })
        await page.setContent(`<img id="hdsi-vision" src="${image.dataUri}" style="display:block;max-width:${maxDimension}px;max-height:${maxDimension}px">`, { waitUntil: 'load', timeout: 10_000 })
        await page.evaluate(() => new Promise<void>(resolve => {
          const imageElement = document.querySelector('#hdsi-vision') as HTMLImageElement | null
          if (!imageElement || imageElement.complete) return resolve()
          imageElement.addEventListener('load', () => resolve(), { once: true })
          imageElement.addEventListener('error', () => resolve(), { once: true })
        }))
        const element = await page.$('#hdsi-vision')
        if (!element) return undefined
        const buffer = Buffer.from(await element.screenshot({ type: 'jpeg', quality: 85 }))
        if (!buffer.length) return undefined
        const originalBytes = Buffer.from(image.dataUri.split(',')[1] ?? '', 'base64').length
        if (buffer.length >= originalBytes) return undefined
        this.reportStandaloneOperation('diagnostic', 'debug', '视觉图片已降采样 原始=%dB 降采样后=%dB 上限=%dpx', originalBytes, buffer.length, maxDimension)
        return { mimeType: 'image/jpeg', dataUri: `data:image/jpeg;base64,${buffer.toString('base64')}` }
      } catch (error) {
        this.reportStandalone('debug', '视觉图片降采样失败，已透传原图：%s', error)
        return undefined
      } finally {
        if (page) await page.close().catch(() => undefined)
      }
    })
  }

  private async renderAnimatedImageFrame(dataUri: string) {
    const puppeteer = (this.ctx as any).puppeteer
    if (!puppeteer?.page) return undefined
    return this.withBrowserSlot(async () => {
      let page: any
      try {
        page = await puppeteer.page()
        await page.setContent(`<img id="hdsi-image" src="${dataUri}" style="display:block;max-width:4096px;max-height:4096px">`, { waitUntil: 'load', timeout: 10_000 })
        await page.evaluate(() => new Promise<void>(resolve => {
          const image = document.querySelector('#hdsi-image') as HTMLImageElement | null
          if (!image || image.complete) return resolve()
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        }))
        const element = await page.$('#hdsi-image')
        if (!element) return undefined
        const buffer = Buffer.from(await element.screenshot({ type: 'png' }))
        if (!buffer.length || buffer.length > 4 * 1024 * 1024) return undefined
        return { mimeType: 'image/png', dataUri: `data:image/png;base64,${buffer.toString('base64')}` }
      } catch (error) {
        this.reportStandalone('debug', '动态图片抽帧失败：%s', error)
        return undefined
      } finally {
        if (page) await page.close().catch(() => undefined)
      }
    })
  }

  /** Prevent timers or already-returning model calls from resurrecting data
   * after an administrator resets the story or clears HDSI tables. */
  private invalidateBufferedNarratives(storyId?: string) {
    this.scheduler.clearBackoff(storyId)
    this.turnEngine.invalidateNarratives(storyId)
    // Group turns have their own debounce timers. They must be cancelled by
    // the same reset/purge path, otherwise an old buffered group message can
    // write a fresh entry after the administrator has cleared the story.
    for (const [key, turn] of this.bufferedGroupTurns) {
      if (storyId && turn.storyId !== storyId) continue
      if (turn.timer) turn.timer()
      this.bufferedGroupTurns.delete(key)
    }
    for (const key of this.groupWillingness.keys()) {
      if (!storyId || key.startsWith(`${storyId}:`)) this.groupWillingness.delete(key)
    }
    this.scheduler.cancelWakes(storyId)
  }

  private invalidateStoryTasks(storyId?: string) {
    for (const key of this.acceptedDeliveries.keys()) {
      if (!storyId || JSON.parse(key)[0] === storyId) this.acceptedDeliveries.delete(key)
    }
    if (storyId) this.storyTaskGenerations.set(storyId, (this.storyTaskGenerations.get(storyId) ?? 0) + 1)
    else this.runtimeGeneration += 1
  }

  private rememberIncomingMessage(key: string) {
    this.seenIncomingMessages.set(key, Date.now())
    if (this.seenIncomingMessages.size > 600) this.seenIncomingMessages.delete(this.seenIncomingMessages.keys().next().value!)
  }

  // Pause cancels new work, but cannot erase a known platform acceptance.
  // Reset/purge invalidate both tasks and receipts through the content generation.
  private deliveryGeneration(storyId: string) {
    return `${this.runtimeGeneration}:${this.storyTaskGenerations.get(storyId) ?? 0}`
  }

  private taskGeneration(storyId: string) {
    return `${this.deliveryGeneration(storyId)}:${this.runtimePauseGeneration ?? 0}`
  }

  private taskGenerationCurrent(storyId: string, generation: string) {
    return this.taskGeneration(storyId) === generation
      && !this.databaseResetting
      && this.desktopRuntimePhase !== 'paused'
  }

  /** True while a live or debounced conversation should take priority over background work. */
  private hasPendingNarrative(storyId: string) {
    return this.turnEngine.hasPendingNarrative(storyId, target => {
      for (const turn of this.bufferedGroupTurns.values()) {
        if (turn.storyId === target && (turn.messages.length || turn.timer)) return true
      }
      return false
    })
  }

  private async flushBufferedNarrative(key: string, revision: number) {
    if (this.databaseResetting) return
    if (this.desktopRuntimePhase === 'paused') {
      // 已触发的定时器句柄若不清掉,resume 的 rescheduleTimers 会因 turn.timer
      // 非空而跳过补排,遗留消息重新孤儿化
      const pausedTurn = this.turnEngine.getTurn(key)
      if (pausedTurn) pausedTurn.timer = undefined
      return
    }
    // One shared story has one narrator at a time. If another relationship is
    // currently waiting on the provider, keep this batch intact and retry
    // shortly instead of taking an inconsistent cursor snapshot.
    const turn = this.turnEngine.beginFlush(key, revision, (retryKey, retryRevision) => void this.flushBufferedNarrative(retryKey, retryRevision))
    if (!turn) return
    const requestId = revision
    turn.inFlightRequestId = requestId
    const batch = turn.messages.splice(0)
    this.reportOperation('diagnostic', 'debug', { id: turn.storyId } as InterludeStory, 'user-message', '写请求开始 参与者=%s 请求=%d 批次=%d', turn.participantId, requestId, batch.length)
    // Keep the endpoint set for this exact debounce batch separate from the
    // broader turn source snapshot.  M4's batch-multi-endpoint annotation
    // must only fire when messages in this request came from multiple
    // endpoints; a turn may otherwise accumulate historical sources.
    turn.activeBatchEndpointIds = [...new Set(batch
      .map(message => message.endpointId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0))]
    turn.activeBatchMessageCount = batch.length
    if (!batch.length) {
      this.turnEngine.endFlush(key, requestId)
      return
    }
    try {
      // Snapshot only the lightweight decision inputs under the story lock.
      // The network request stays outside it, so a new user message can be
      // recorded immediately and invalidate this request when appropriate.
      const snapshot = await this.serial(turn.storyId, async () => {
        const story = await this.getStory(turn.storyId)
        const participant = await this.getParticipant(turn.participantId)
        if (!participant || participant.status !== 'active' || story.status !== 'active') return undefined
        const now = new Date()
        const due = liveNarrativeIntents(await this.dueIntents(story.id, now))
          .filter(intent => !intent.participantId || intent.participantId === participant.id)
        return { story, participant, from: narrativeCursor(story, now), now, due }
      })
      if (!snapshot) {
        // 批次已被 splice 消费，早退同样要排重试（入站消息已先落库）。
        // 参与者已暂停时不排——重试会由到期路径消化成暂停期的一次投递；
        // 恢复后由用户新消息自然驱动。
        const participantNow = await this.getParticipant(turn.participantId).catch(() => undefined)
        if (participantNow?.status === 'active') {
          await this.scheduleNarrativeRetry(turn.storyId, turn.participantId, new Date()).catch(() => undefined)
        } else {
          this.reportStandalone('info', '参与者已暂停或不存在，跳过为其排叙事重试 参与者=%s', turn.participantId)
        }
        return
      }

      const userMessage = formatBufferedUserMessages(batch)
      const turnQueryEmbedding = userMessage?.trim() && this.semanticTurnEmbeddingEnabled()
        ? await this.embedText(userMessage.trim().slice(0, this.config.model.embedding?.maxInputCharacters ?? 4_000))
        : undefined
      const quotedMessages: IndexedQuotedMessageContext[] = batch.flatMap((message, index) => message.quote
        ? [{ ...message.quote, messageIndex: index + 1 }]
        : [])
      const stickerCatalog = await this.stickerCatalogForSession(turn.latestSession, turnQueryEmbedding)
      const chatCapabilities = this.privateChatCapabilities(turn.latestSession)
      const imageSources = Array.from(new Set(batch.flatMap(message => message.imageSources))).slice(0, 3)
      const loadedImages = await this.loadNativeImages(snapshot.story, imageSources, turn.latestSession)
      const visionMode = this.config.model.vision?.mode ?? 'native'
      const visualObservations = visionMode === 'sidecar'
        ? await this.describeCurrentImages(snapshot.story, loadedImages, userMessage)
        : undefined
      const images = visionMode === 'native' ? loadedImages : []
      // Voice records ride the native-audio channel: SnowLuma transcodes each
      // record server-side and the main model receives it as input_audio.
      const audioSources = Array.from(new Set(batch.flatMap(message => message.audioSources)))
      const audio = await this.loadNativeAudio(snapshot.story, audioSources, turn.latestSession)
      // If another message arrived while an image was being downloaded, put
      // this batch back and let the newer revision compose one combined event.
      if (turn.nextRevision !== revision) {
        turn.messages.unshift(...batch)
        return
      }
      const superseded = batch.flatMap(message => message.supersededIntents)
      const early = {
        delivered: false,
        interaction: undefined as NarrativeInteraction | undefined,
        deliveryEntry: undefined as ScriptEntry | undefined,
      }
      // 首条打字下限的基准：叙事请求发起时刻（模型耗时从此时起算）。
      const requestStartedAt = new Date()
      const narrative = await this.tryDecide(
        snapshot.story, snapshot.participant, 'user-message', snapshot.from, snapshot.now, userMessage, snapshot.due, superseded, undefined, images, audio, chatCapabilities, quotedMessages, stickerCatalog, turnQueryEmbedding, visualObservations,
        async reply => {
          if (early.delivered) return false
          const deliveryEntry = await this.deliverEarlyPrivateReply(snapshot.story, snapshot.participant, turn.latestSession, turn, requestId, reply, requestStartedAt)
          if (deliveryEntry) {
            early.delivered = true
            early.interaction = reply.interaction
            early.deliveryEntry = deliveryEntry
          }
          return !!deliveryEntry
        },
      )
      const { succeeded, effectiveNow, immediateObservations } = narrative
      const decision = early.delivered && early.interaction
        ? { ...narrative.decision, interaction: early.interaction }
        : narrative.decision
      const sticker = this.resolveSticker(decision.localMedia, stickerCatalog)
      const nativeFace = sticker ? undefined : this.resolveNativeFace(decision, chatCapabilities)

      const result = await this.serial(turn.storyId, async () => {
        if (this.databaseResetting) return {
          obsolete: true, requeue: false, messages: [] as OutgoingMessageDraft[],
          commit: undefined as ScriptCommitDraft | undefined, scriptEntry: undefined as ScriptEntry | undefined,
        }
        // 暂停期间到达的模型结果同样作废:批次放回,恢复后重排处理——否则暂停
        // 语义被穿透(照常提交剧本、推进游标并向外发消息)。放回后的定时器
        // 由 endFlush 的遗留消息补排保证,暂停态触发会被入口 paused 检查拦下。
        if (this.desktopRuntimePhase === 'paused') return {
          obsolete: true, requeue: true, messages: [] as OutgoingMessageDraft[],
          commit: undefined as ScriptCommitDraft | undefined, scriptEntry: undefined as ScriptEntry | undefined,
        }
        if (turn.obsoleteRequestIds.has(requestId)) return {
          // User interruptions keep the batch for the next combined turn;
          // administrative invalidation marks the request as discarded so a
          // purge/reset can never resurrect the old input after it completes.
          obsolete: true, requeue: !turn.discardedRequestIds?.has(requestId), messages: [] as OutgoingMessageDraft[],
          commit: undefined as ScriptCommitDraft | undefined, scriptEntry: undefined as ScriptEntry | undefined,
        }
        const current = await this.getStory(turn.storyId)
        const currentParticipant = await this.getParticipant(turn.participantId)
        if (!currentParticipant || currentParticipant.status !== 'active' || current.status !== 'active') {
          return {
            obsolete: true, requeue: false, messages: [] as OutgoingMessageDraft[],
            commit: undefined as ScriptCommitDraft | undefined, scriptEntry: undefined as ScriptEntry | undefined,
          }
        }
        const now = new Date()
        // Persist a successful/failed immediate observation only after this
        // request has survived debounce invalidation. This keeps an obsolete
        // result from contaminating the next combined user turn.
        for (const observation of immediateObservations) await this.persistCollectedWebObservation(observation)
        if (early.delivered && !succeeded) {
          await this.appendEntry(current.id, {
            kind: 'stream-finalization-failed', actor: 'system',
            content: '主角首条消息已经提前投递，但流式叙事未能完成；本轮不会自动重发可见回复。',
            occurredAt: now.toISOString(), metadata: { requestId },
          }, now, currentParticipant.id)
          await this.scheduleStreamScriptRecovery(current.id, currentParticipant.id, now)
          this.reportOperation('standard', 'warn', current, 'user-message', '流式叙事在首条回复后未完成，已保留投递且停止自动重试 参与者=%s 请求=%d', currentParticipant.id, requestId)
          return {
            obsolete: false, requeue: false, messages: [] as OutgoingMessageDraft[],
            commit: undefined as ScriptCommitDraft | undefined, scriptEntry: undefined as ScriptEntry | undefined,
          }
        }
        const commitsFirstReply = succeeded
          && decision.interaction?.reply?.mode === 'immediate'
          && typeof decision.interaction.reply.content === 'string'
          && !!decision.interaction.reply.content.trim()
        const persisted = await this.persistDecision(current, currentParticipant, {
          ...decision,
          localMedia: sticker ? decision.localMedia : undefined,
          nativeFace: nativeFace ? decision.nativeFace : undefined,
        }, snapshot.from, effectiveNow, true, 'user-message', [], early.delivered)
        // committed 标志在持久化成功后才置位——提前置位会让
        // catch 守卫（!== requestId）误判“已提交”，模型成功但落库抛错的回合
        // 既无投递也无重试。
        if (commitsFirstReply) turn.firstMessageCommittedRequestId = requestId
        if (early.deliveryEntry && persisted.commit && decision.interaction?.reply.content) {
          const event = findPrivateOutgoingMessageEvent(
            persisted.commit,
            currentParticipant.id,
            'immediate',
            decision.interaction.reply.content,
            this.config.runtime.messageSeparator,
          )
          const scriptEvent = event ? messageEventReference(event, 0, persisted.scriptEntry?.id) : undefined
          if (scriptEvent) {
            await this.dbSet('interlude_script_entry', { id: early.deliveryEntry.id }, {
              metadata: { ...early.deliveryEntry.metadata, ...scriptEvent, earlyStreamingDelivery: true },
            })
            await this.updateScriptDeliveryOutcome(current.id, scriptEvent, 'delivered', now)
          }
        }
        if (succeeded) {
          await this.dbSet('interlude_story', { id: current.id }, { cursorAt: effectiveNow, updatedAt: now })
          // 用户回合已成功：取消此前失败遗留的同参与者 pending 重试——用户在
          // 沉默期重发是常态，旧 retry 到期会再跑完整回合并重复投递一条回复。
          await this.cancelPendingNarrativeRetries(current, currentParticipant.id, now)
          const consumedDueIds = consumedLiveIntentIds(snapshot.due)
          if (consumedDueIds.length) await this.dbSet('interlude_intent', { id: { $in: consumedDueIds } }, { status: 'completed', updatedAt: now })
        } else {
          await this.scheduleNarrativeRetry(current.id, currentParticipant.id, now)
        }
        if (succeeded) await this.scheduleConversationFollowUpsAfterTurn(current.id, effectiveNow, decision.interaction, currentParticipant.id)
        this.reportOperation('diagnostic', 'debug', current, 'user-message', '写作回合统计 参与者=%s 合并消息=%d 成功=%s 可见消息=%d', currentParticipant.id, batch.length, succeeded, persisted.messages.length)
        return { obsolete: false, requeue: false, messages: persisted.messages, commit: persisted.commit, scriptEntry: persisted.scriptEntry }
      })

      if (result.obsolete) {
        if (result.requeue) turn.messages.unshift(...batch)
        this.reportOperation('standard', 'info', snapshot.story, 'user-message', '已丢弃过期主模型结果 参与者=%s 请求=%d 回队消息=%d', snapshot.participant.id, requestId, batch.length)
        return
      }
      this.reportOperation('diagnostic', 'debug', snapshot.story, 'user-message', '模型结果通过闸门 参与者=%s 请求=%d 批次=%d', snapshot.participant.id, requestId, batch.length)
      if (this.canHandleParticipant(snapshot.participant)) {
        const delivered = await this.deliverOutgoingMessages(snapshot.story, result.messages, snapshot.participant, turn.latestSession, undefined, true, requestStartedAt)
        // P2 Fix: 主动联系按实际投递结果计数——成功/失败在平台确认后。
        if (this.pendingProactiveCount > 0) {
          const sent = delivered.length > 0
          for (let i = 0; i < this.pendingProactiveCount; i++) {
            this.health?.recordProactive(snapshot.story.id, sent)
          }
          this.pendingProactiveCount = 0
        }
        if (sticker && turn.latestSession) {
          await this.sendSticker(
            snapshot.story,
            turn.latestSession,
            snapshot.participant.channelId,
            sticker,
            undefined,
            platformActionReference(result.commit, result.scriptEntry?.id, 'local-media', sticker.assetId),
          )
        }
        if (nativeFace && turn.latestSession) {
          await this.sendNativeFace(
            snapshot.story,
            turn.latestSession,
            snapshot.participant.channelId,
            nativeFace,
            undefined,
            platformActionReference(result.commit, result.scriptEntry?.id, 'native-face', nativeFace),
          )
        }
      }
      this.scheduleCompaction(turn.storyId)
    } catch (error) {
      if (isContextDisposedError(error) || this.disposed) {
        this.reportStandalone('debug', '插件重载中，合并写作任务放弃 参与者=%s', turn.participantId)
      } else {
        this.reportStandalone('warn', '合并写作任务失败：参与者=%s 错误=%s', turn.participantId, error)
        // 持久化抛错不再静默吞批——未 committed 的回合从已落库入站条目排一次重试。
        if (turn.firstMessageCommittedRequestId !== requestId) {
          await this.scheduleNarrativeRetry(turn.storyId, turn.participantId, new Date()).catch(() => undefined)
        }
      }
    } finally {
      this.turnEngine.endFlush(key, requestId)
    }
  }

  async advanceStory(story: InterludeStory, force = true) {
    if (this.desktopRuntimePhase === 'paused') return []
    if (!this.canHandleStory(story)) return []
    const generation = this.taskGeneration(story.id)
    const messages = await this.serial(story.id, async () => this.advanceUnlocked(await this.getStory(story.id), new Date(), force, generation))
    if (force || messages.length) this.reportOperation('summary', 'info', story, 'advance', '剧本推进完成 可见消息=%d', messages.length)
    this.scheduleCompaction(story.id)
    return messages
  }

  /** Used by commands/tests to deliver a mixed set of account-targeted actions safely. */
  async deliverMessages(story: InterludeStory, messages: OutgoingMessageDraft[], session?: Session) {
    const participant = session ? await this.findParticipant(session, story) : undefined
    return this.deliverOutgoingMessages(story, messages, participant, session)
  }

  async compactStory(story: InterludeStory, force = true) {
    if (this.desktopRuntimePhase === 'paused') return false
    if (!this.canHandleStory(story)) return false
    const generation = this.taskGeneration(story.id)
    // 三阶段(与调度器路径同构):队列内快照 → 队列外模型+embedding → 队列内落库。
    // 此前手动/强制路径整体在串行队列内执行,embedding 网络调用阻塞直播回合。
    return this.compactThreePhase(story.id, force, generation)
  }

  /** Merge and compress already-applied overlay patches without running the
   * full scene/fact compaction pass. This is safe for manual maintenance. */
  async compactOverlay(story: InterludeStory) {
    if (!this.canHandleStory(story)) return false
    return this.serial(story.id, async () => this.compactOverlayUnlocked(await this.getStory(story.id), new Date()))
  }

  /** Administrative overlay view used by the Console command. */
  async adminOverlayStatus(storyId: string) {
    const [story, patches, snapshots, participants] = await Promise.all([
      this.getStory(storyId),
      this.dbGet('interlude_state_patch', { storyId }, { sort: { createdAt: 'desc' } }) as Promise<StatePatchProposal[]>,
      this.dbGet('interlude_overlay_snapshot', { storyId, status: 'active' }, { sort: { periodEnd: 'desc' } }) as Promise<OverlaySnapshot[]>,
      this.participants(storyId, true),
    ])
    return {
      state: story.state.settingOverlay ?? {},
      proposed: patches.filter(patch => patch.status === 'proposed'),
      applied: patches.filter(patch => patch.status === 'applied' || patch.status === 'compacted'),
      cleared: patches.filter(patch => patch.status === 'cleared'),
      snapshots,
      participantOverlays: participants.filter(participant => !!normalizeParticipantState(participant.state).relationshipOverlay),
    }
  }

  /**
   * 群消息离线补拉：插件停用期间到达的已启用群消息经 get_group_msg_history
   * 补回，写为一条汇总事件（不注入逐条事件打扰上下文——YesImBot World
   * offlineHistory 同款语义）。仅在 Koishi 原生部署有意义：typ0 桌面模式
   * 的收件箱已由宿主兜底，此处跳过。
   */
  async offlineGroupCatchup() {
    if (this.desktopBridgeActive || this.databaseResetting) return
    const rules = (this.config.onebot?.groupChats ?? []).filter(rule => rule.enabled !== false)
    if (!rules.length) return
    for (const rule of rules) {
      const groupId = normalizeGroupId(rule.groupId)
      if (!groupId) continue
      try {
        const story = await this.getCanonicalStory()
        if (!story || !this.canHandleStory(story) || story.status !== 'active') continue
        const entries = await this.dbGet('interlude_script_entry', {
          storyId: story.id, kind: 'group-message', metadata: { groupId },
        }, { limit: 1, sort: { occurredAt: 'desc' } }) as unknown as Array<{ occurredAt?: unknown, content?: string }>
        const watermark = entries[0]?.occurredAt ? toDate(entries[0].occurredAt) : undefined
        if (!watermark) continue
        const bot = this.ctx.bots.find(item => isOneBotPlatform(item.platform)
          && normalizeGroupId(String((item as any).guildId ?? '')) === groupId)
        const internal = (bot as any)?.internal
        if (typeof internal?._request !== 'function') continue
        const response = await withTransportTimeout(internal._request('get_group_msg_history', { group_id: Number(groupId), count: 50 }) as Promise<{ data?: { messages?: unknown[] } } | undefined>, 'group-history-fetch')
        const messages = (Array.isArray(response?.data?.messages) ? response.data.messages : []) as any[]
        const missed = messages.filter((msg: any) => {
          const time = typeof msg?.time === 'number' && msg.time > 0 ? new Date(msg.time * 1000) : undefined
          return time && time.getTime() > watermark.getTime() + 1000
            && String(msg.sender?.user_id ?? '') !== String(bot?.selfId ?? 'unknown')
        })
        if (!missed.length) continue
        // 汇总事件：来源群 + 条数 + 时间跨度 + 关键内容摘录，不逐条注入
        const latest = new Date(Number(missed[missed.length - 1].time) * 1000)
        const earliest = new Date(Number(missed[0].time) * 1000)
        const excerpts = missed.slice(0, 5).map((msg: any) => {
          const sender = String(msg.sender?.card || msg.sender?.nickname || msg.sender?.user_id || '未知')
          const text = String(Array.isArray(msg.message) ? msg.message.filter((seg: any) => seg?.type === 'text').map((seg: any) => seg.data?.text ?? '').join('') : msg.raw_message ?? '').trim().slice(0, 60)
          return text ? `${sender}：${text}` : `${sender}：[非文本]`
        })
        await this.appendEntry(story.id, {
          kind: 'group-message', actor: 'user',
          content: `[群聊离线摘要] 插件离线期间 ${groupId} 群有 ${missed.length} 条新消息（${earliest.toISOString()} ~ ${latest.toISOString()}）。摘要：${excerpts.join('；')}。完整记录可通过聊天记录查询获取。`,
          occurredAt: latest.toISOString(),
          metadata: { groupId, offlineCatchup: true, messageCount: missed.length },
        }, latest)
        this.reportStandaloneOperation('standard', 'info', '群消息离线补拉完成 群=%s 补回=%d条 水位=%s', groupId, missed.length, watermark.toISOString())
      } catch (error) {
        this.reportStandaloneOperation('diagnostic', 'warn', '群消息离线补拉失败 群=%s 错误=%s', groupId, error)
      }
    }
  }

  async sweep() {
    if (this.desktopRuntimePhase === 'paused' || this.databaseResetting || this.sweepRunning) return
    this.sweepRunning = true
    const startedAt = Date.now()
    try {
      const story = await this.getCanonicalStory()
      if (!story || !this.canHandleStory(story)) {
        this.reportStandaloneOperation('diagnostic', 'debug', '后台扫描跳过：没有可处理的活动主剧本')
        return
      }
      if (this.hasPendingNarrative(story.id)) {
        // A split-message is an already-decided typing fragment. It may start
        // transport while another relationship is waiting, but an incoming
        // message from its own participant still interrupts it first.
        const pendingDue = await this.dueIntents(story.id, new Date())
        if (pendingDue.some(intent => intent.type === 'split-message')) await this.deliverDueSplitSegments(story.id)
        this.reportOperation('diagnostic', 'debug', story, 'advance', '后台写作跳过：前台回合处理中；已独立检查到期分段投递')
        return
      }
      this.reportOperation('diagnostic', 'debug', story, 'advance', '后台扫描开始 游标=%s 下次自动推进=%s',
        formatLogTime(story.cursorAt, story.setting.timezone), formatLogTime(toDate(story.state.automation?.nextAdvanceAt), story.setting.timezone))
      const messages = await this.advanceStory(story, false)
      const delivered = messages.length ? await this.sendScheduledMessages(story, messages) : []
      this.reportOperation('diagnostic', 'debug', story, 'advance', '后台扫描完成 耗时=%dms 已投递=%d', Date.now() - startedAt, delivered.length)
    } finally {
      this.sweepRunning = false
    }
  }

  private async advanceUnlocked(story: InterludeStory, now: Date, force: boolean, generation?: string) {
    const taskCurrent = () => !generation || this.taskGenerationCurrent(story.id, generation)
    const urgeMode = this.urgeConfig.enabled ? JSON.stringify(this.urgeConfig) : 'off'
    const previousUrge = normalizeUrgeState(story.state.extensions?.urge, now.getTime())
    if (previousUrge.mode !== urgeMode && (this.urgeConfig.enabled || previousUrge.mode && previousUrge.mode !== 'off')) {
      const state = decodeStoryState(story.state)
      await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState({ ...state, extensions: { ...state.extensions, urge: { ...previousUrge, mode: urgeMode, armed: undefined, burst: undefined, pace: 'normal' } } }) })
      await this.scheduleNextAutomaticAdvance(story.id, now)
      story = await this.getStory(story.id)
    }
    const from = narrativeCursor(story, now)
    const elapsed = Math.max(0, now.getTime() - from.getTime())
    let due = await this.dueIntents(story.id, now)
    const messages: OutgoingMessageDraft[] = []
    // Later <sep/> bubbles are delivery events, not new writing turns.  They
    // are persisted only at their actual send time, which also lets a newer
    // incoming message cancel them before the character "finishes typing".
    // Deliver at most one split segment per wake-up. If the scheduler was
    // blocked for a while, sending every overdue segment together would skip
    // the configured typing-time simulation.
    const splitSegments = due
      .filter(intent => intent.type === 'split-message')
      .sort((left, right) => left.notBefore.getTime() - right.notBefore.getTime())
      .slice(0, 1)
    let splitHandled = false
    for (const intent of splitSegments) {
      const content = clip(intent.payload?.content, this.config.runtime.maxMessageCharacters)
      const automaticDelivery = automaticDeliveryFromPayload(intent.payload)
      const participant = intent.participantId ? await this.getParticipant(intent.participantId) : undefined
      if (intent.participantId && this.interruptedTypingParticipants.has(intent.participantId)) continue
      splitHandled = true
      if (await this.reconcileTerminalSplitIntent(story.id, intent, now)) continue
      if (!content || !participant || participant.status !== 'active') {
        await this.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, { status: 'cancelled', updatedAt: now })
        const reference = restoreMessageEvent(intent.payload, content || '')
        if (reference) await this.updateScriptDeliveryOutcome(story.id, reference, 'cancelled', now, 'delivery-target-unavailable')
        continue
      }
      const scriptEvent = restoreMessageEvent(intent.payload, content)
      const message: OutgoingMessageDraft = {
        participantId: participant.id,
        content,
        automaticDelivery,
        ...restoreDesktopContext(intent.payload),
        ...(scriptEvent?.endpointId ? { endpointId: scriptEvent.endpointId } : {}),
        scriptEvent,
      }
      const delivered = await this.deliverOutgoingMessages(
        story,
        [message],
        undefined,
        undefined,
        target => this.interruptedTypingParticipants.has(target.id),
        false, undefined, 'failed', true,
      )
      if (!taskCurrent()) return messages
      if (!delivered.length) {
        if (this.interruptedTypingParticipants.has(participant.id)) continue
        if (message.scriptEvent) await this.updateScriptDeliveryOutcome(story.id, message.scriptEvent, 'pending', now, 'delivery-unconfirmed-retry-scheduled')
        const retryAt = new Date(now.getTime() + 30 * Time.second)
        await this.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, { notBefore: retryAt, updatedAt: now })
        this.scheduleDueIntentWake(story.id, retryAt)
        continue
      }
      await this.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, { status: 'completed', updatedAt: now })
    }
    if (splitHandled) {
      await this.scheduleNextSplitWake(story.id)
      // Full delivery can settle a follow-up. Do not narrate the stale due
      // snapshot captured before that delivery (even after the chain is empty).
      due = await this.dueIntents(story.id, now)
    }
    due = due.filter(intent => intent.type !== 'split-message')
    // Browser research is an external, already-happened observation once it
    // completes. It must never be handed to the narrator as an ordinary
    // future plan, otherwise the model could write as if it had read a page
    // before Puppeteer actually did so.
    // Keep a backlog of optional research from turning one background sweep
    // into several serial page loads. The remaining intents stay pending for
    // the next sweep and never block a live user turn for an unbounded time.
    const browserIntents = due
      .filter(intent => intent.type === 'browser-research')
      .slice(0, Math.max(1, this.browserConfig.maxResearchPerSweep))
    for (const intent of browserIntents) await this.executeDeferredBrowserIntent(story, intent, now)
    // Browser intents always complete (successfully or as a recorded failure)
    // in executeDeferredBrowserIntent(), so re-reading the whole pending list
    // here only adds a SQLite round trip to every background sweep.
    due = due.filter(intent => intent.type !== 'browser-research')
    // QQ 空间动作同样是“到期即外部已发生/已失败”的一锤子执行：限流门挡下或
    // 通道失败都直接完成（成败在审计表），绝不作为未来计划回流给叙事。
    const qzoneIntent = due.filter(intent => intent.type === 'qzone-action').slice(0, 1)[0]
    if (qzoneIntent) {
      await this.executeQzoneIntent(story, qzoneIntent, now)
      due = due.filter(intent => intent.id !== qzoneIntent.id)
    }
    // A committed typing chain is not a new incoming event. Never let another
    // background turn for its recipient recreate the not-yet-delivered text.
    // Include FUTURE split intents: looking only at `due` misses this race.
    const pendingSplits = await this.pendingSplitSegments(story.id)
    const dueBeforeSplitBarrier = due.length
    due = await this.deferDueIntentsBehindPendingSplits(story, due, pendingSplits, now)
    const splitBlockedDue = dueBeforeSplitBarrier > due.length
    // Director retry gates only the optional director, never the life scheduler.
    // Its persisted cooldown survives cursor changes and is handled at call time.
    // Turning off automatic advancement must suppress *every* background
    // writing path, including short plans that were persisted before the
    // owner disabled the feature. Manual `interlude.advance` still passes
    // `force` and remains available.
    const autoAdvanceEnabled = this.autoAdvanceConfig.enabled
    const dueFollowUps = autoAdvanceEnabled ? this.dueConversationFollowUps(story, now) : []
    const automaticDue = autoAdvanceEnabled && (dueFollowUps.length > 0 || this.isAutomaticAdvanceDue(story, now))
    const pausedForConversation = this.isAutomaticAdvancePaused(story, now)
    this.reportOperation('diagnostic', 'debug', story, 'advance',
      '后台状态 到期计划=%d 分段消息=%d 网页任务=%d 短期跟进=%d 自动推进到期=%s 对话暂停=%s',
      due.length, splitSegments.length, browserIntents.length, dueFollowUps.length, automaticDue, pausedForConversation)
    // A due typing segment can be delivered during the conversation pause;
    // it is already a committed message, not an automatic life update.
    if (!force && !due.length && (!automaticDue || pausedForConversation)) return messages

    // A manual advance may be queued behind a background pass. Do not open a
    // second narrator turn merely for a few seconds of empty time.
    const minimumManualAdvanceMs = Math.max(1, this.config.runtime.minimumAdvanceMinutes) * Time.minute
    const manualAdvanceTooSoon = force
      && !due.length
      && !dueFollowUps.length
      && elapsed < minimumManualAdvanceMs
    if (manualAdvanceTooSoon) {
      this.reportOperation('standard', 'info', story, 'advance',
        '手动推进跳过：游标距离现在不足 %d 分钟，且没有到期计划或对话后续任务', this.config.runtime.minimumAdvanceMinutes)
      return messages
    }

    let advanced = false
    let delayedReplyProcessed = false
    // A due plan is itself a complete writing turn: it fills the old cursor→now
    // gap and then decides the plan. Avoid a preceding ordinary advance, which
    // would make the next request write the same now→now moment again.
    const hasNarrativeDue = due.length > 0 || splitBlockedDue
    if (elapsed > 0 && !hasNarrativeDue && (force || (automaticDue && !pausedForConversation))) {
      const followUpParticipantId = dueFollowUps.length ? story.state.automation?.conversationFollowUpParticipantId : ''
      const followUpParticipant = followUpParticipantId ? await this.getParticipant(followUpParticipantId) : undefined
      const phase: NarrativeRequest['phase'] = followUpParticipant?.status === 'active'
        ? 'conversation-follow-up'
        : 'advance'
      // Global life advancement chooses its recipients only after generation,
      // so any pending chain gates it (manual advance included). A targeted
      // conversation follow-up only waits for its own recipient's chain.
      const blockedSplits = pendingSplits.filter(intent => phase === 'advance' || intent.participantId === followUpParticipant?.id)
      if (blockedSplits.length) {
        await this.scheduleNextSplitWake(story.id)
        this.reportOperation('diagnostic', 'debug', story, phase,
          '后台写作等待已提交分段投递 参与者=%s 待发分段=%d', followUpParticipant?.id || '全局', blockedSplits.length)
        return messages
      }
      this.reportOperation('standard', 'info', story, phase,
        '即将执行自动写作 类型=%s 时间段=%s→%s', phaseLabel(phase), formatLogTime(from, story.setting.timezone), formatLogTime(now, story.setting.timezone))
      const { decision, succeeded, timelinePlan } = taskCurrent()
        ? await this.tryDecide(story, followUpParticipant ?? null, phase, from, now, undefined, [])
        : { decision: {} as NarrativeDecision, succeeded: false, timelinePlan: undefined }
      if (succeeded && taskCurrent()) {
        const permitMessages = phase === 'conversation-follow-up' || this.config.runtime.allowProactiveMessages
        const persisted = await this.persistDecision(story, followUpParticipant ?? null, decision, from, now, permitMessages, phase, [], false, timelinePlan)
        messages.push(...persisted.messages)
        await this.dbSet('interlude_story', { id: story.id }, { cursorAt: now, updatedAt: now })
        advanced = true
      }
    }

    const dueBatches = groupDueIntents(due)
    // One shared story has one clock. Process one relationship branch per
    // sweep so another branch cannot trigger a duplicate now→now scene.
    const dueBatch = dueBatches[0]
    if (dueBatch) {
      const current = await this.getStory(story.id)
      // 如果本轮没有先做 automatic advance，到期意图也必须从故事游标
      // 补写到现在；否则“延迟回复到点”会漏掉中间这段角色生活。
      const dueFrom = narrativeCursor(current, now)
      // Each batch is one relationship branch. This keeps prompts private
      // while still draining every plan that was already due this sweep.
      const dueParticipantId = dueBatch[0]?.participantId || ''
      const dueParticipant = dueParticipantId ? await this.getParticipant(dueParticipantId) : undefined
      if (dueParticipantId && (!dueParticipant || dueParticipant.status !== 'active')) {
        // 与 live 路径对齐：暂停/缺失参与者的到期意图不消耗模型回合。
        // delayed-reply 等保留 pending（参与者恢复后仍会到期）；narrative-retry
        // 取消——其入站消息早已落库，恢复后由用户新消息自然驱动。
        const staleRetries = dueBatch.filter(intent => intent.type === 'narrative-retry')
        if (staleRetries.length) await this.dbSet('interlude_intent', { id: { $in: staleRetries.map(intent => intent.id) } }, { status: 'cancelled', updatedAt: now })
        this.reportOperation('standard', 'info', current, 'intent-due', '跳过暂停参与者的到期计划 参与者=%s 数量=%d 取消重试=%d', dueParticipantId, dueBatch.length, staleRetries.length)
      } else {
        try {
          this.reportOperation('standard', 'info', current, 'intent-due',
            '即将处理到期计划 数量=%d 类型=%s 参与者=%s', dueBatch.length, Array.from(new Set(dueBatch.map(intent => intent.type))).join(','), dueParticipant?.id || '全局')
          const { decision, succeeded, timelinePlan } = taskCurrent()
            ? await this.tryDecide(current, dueParticipant ?? null, 'intent-due', dueFrom, now, undefined, dueBatch)
            : { decision: {} as NarrativeDecision, succeeded: false, timelinePlan: undefined }
          const streamRecovery = dueBatch.every(intent => intent.type === 'narrative-retry' && intent.payload?.streamRecovery === true)
          const recovered = streamRecovery && succeeded
            ? await this.persistStreamScriptRecovery(current, dueParticipant ?? null, decision, now)
            : false
          const turnSucceeded = streamRecovery ? recovered : succeeded
          if (!streamRecovery && taskCurrent()) {
            const permitMessages = this.config.runtime.allowProactiveMessages || dueBatch.some(intent => intent.payload?.userInitiated === true)
            const persisted = await this.persistDecision(current, dueParticipant ?? null, decision, dueFrom, now, permitMessages, 'intent-due', dueBatch, false, timelinePlan)
            messages.push(...persisted.messages)
          }
          if (turnSucceeded && taskCurrent()) {
            await this.dbSet('interlude_story', { id: current.id }, { cursorAt: now, updatedAt: now })
            const ordinaryDueIds = dueBatch.filter(intent => intent.type !== 'follow-up-commitment').map(intent => intent.id)
            if (ordinaryDueIds.length) await this.dbSet('interlude_intent', { id: { $in: ordinaryDueIds } }, { status: 'completed', updatedAt: now })
            if (dueBatch.some(intent => intent.type === 'delayed-reply')) {
              delayedReplyProcessed = true
              await this.pauseAutomaticAdvanceAfterDelayedReply(story.id, now, dueParticipant?.id ?? '')
            } else if (!advanced && !delayedReplyProcessed) {
              await this.scheduleNextAutomaticAdvance(story.id, now)
            }
          } else {
            // A failed user turn gets a persisted retry. Otherwise a transient
            // 403/5xx would leave its already-recorded incoming message waiting
            // forever for somebody to send another DM.
            const retries = dueBatch.filter(intent => intent.type === 'narrative-retry')
            if (retries.length) {
              const attempts = Math.max(...retries.map(intent => Number(intent.payload?.attempt) || 0))
              await this.dbSet('interlude_intent', { id: { $in: retries.map(intent => intent.id) } }, { status: 'cancelled', updatedAt: now })
              if (streamRecovery) await this.scheduleStreamScriptRecovery(current.id, dueParticipant?.id ?? '', now, attempts)
              else await this.scheduleNarrativeRetry(current.id, dueParticipant?.id ?? '', now, attempts)
            }
            // Keep ordinary delayed plans pending until the provider recovers.
          }
        } catch (error) {
          // 无界重试防线：到期批次的处理（模型/持久化链）抛错时整批退避一个
          // 扫描周期——否则意图保持 pending，每个 sweep 重复同一失败回合，
          // 持续消耗 token 且游标不前进。
          this.report('warn', current, 'intent-due', '到期计划处理失败，整批退避一个扫描周期 错误=%s', error)
          const backoffAt = new Date(now.getTime() + Math.max(Time.minute, this.config.runtime.sweepIntervalMinutes * Time.minute))
          await this.dbSet('interlude_intent', { id: { $in: dueBatch.map(intent => intent.id) } }, { notBefore: backoffAt, updatedAt: now }).catch(() => undefined)
        }
      }
    }
    if (dueBatches.length > 1) {
      const current = await this.getStory(story.id)
      this.reportOperation('standard', 'info', current, 'intent-due',
        '其余 %d 组到期计划已保留，下一次扫描将按新的时间段继续处理', dueBatches.length - 1)
      this.scheduleDueIntentWake(story.id, new Date(now.getTime() + Math.max(Time.second, this.config.runtime.sweepIntervalMinutes * Time.minute)))
    }
    if (advanced && !delayedReplyProcessed) {
      const hasMoreFollowUps = dueFollowUps.length > 0 && await this.completeConversationFollowUps(story.id, now)
      if (!hasMoreFollowUps) await this.scheduleNextAutomaticAdvance(story.id, now)
    }
    return messages
  }

  private async decide(story: InterludeStory, participant: InterludeParticipant | null, phase: NarrativeRequest['phase'], from: Date, now: Date, userMessage: string | undefined, dueIntents: NarrativeIntent[], supersededIntents: NarrativeIntent[] = [], groupContext?: GroupContext, images: NarrativeImage[] = [], audio: NarrativeAudio[] = [], extraWebContext: WebObservation[] = [], outputRecovery = false, chatCapabilities?: ChatActionCapabilities, quotedMessages: IndexedQuotedMessageContext[] = [], stickerCatalog: StickerCatalogEntry[] = [], turnQueryEmbedding?: number[], visualObservations?: string[], timelinePlan?: TimelinePlan, onEarlyReply?: (reply: EarlyNarrativeReply) => Promise<boolean>, historicalGroupImages: NarrativeHistoricalImage[] = []) {
    if (this.longHorizonConfig.enabled) await this.ensureLongHorizonGuidanceLoaded(story.id)
    // 这里是主模型上下文的唯一入口。recentEntries 保留近距离质感，场景、弧线和
    // facts 负责把很长的过去压缩成连续性线索。参与者摘要让模型知道角色
    // 同时还在与谁维系关系，而不是把每个 QQ 当成独立世界。
    // User and due-intent turns may arrive before the next background sweep.
    // Retire expired consequences here too, while keeping this a cheap local
    // database operation rather than a separate model request.
    // 世界事件排水：到期事件先进账，本回合 recentScript 即可见（低重要性仅推进/跟进回合）。
    await this.drainDueSeededEvents(story, now, phase !== 'user-message')
    const factQuery = createFactQuery(participant, userMessage, dueIntents, supersededIntents)
    const memoryEnabled = this.memoryConfig.enabled
    // One turn-level query vector serves every semantic consumer (sticker
    // filter, fact ranking, history recall); undefined when none needs it.
    const resolvedTurnEmbedding = turnQueryEmbedding ?? (participant && userMessage?.trim() && this.semanticTurnEmbeddingEnabled()
      ? await this.embedText(userMessage.trim().slice(0, this.config.model.embedding?.maxInputCharacters ?? 4_000))
      : undefined)
    const liveFactEmbedding = this.config.model.embedding?.liveQuery ? resolvedTurnEmbedding : undefined
    const [recentEntries, memories, scene, arc, previousScenes, facts, allParticipants, webContext, activeConsequences, overlaySnapshots, followUpCommitments, upcomingIntents] = await Promise.all([
      // Use the runtime limits on the live path.  They are the options shown
      // to testers as “上下文条目/长期事实”，and should be authoritative.
      this.recentEntriesForPrompt(story.id, now),
      memoryEnabled ? this.memories(story.id, this.config.runtime.memoryLimit, participant?.id) : Promise.resolve([]),
      this.activeScene(story.id),
      this.activeArc(story.id),
      this.previousSceneSummaries(story),
      memoryEnabled ? this.facts(story.id, this.config.runtime.memoryLimit, factQuery, undefined, liveFactEmbedding) : Promise.resolve([]),
      this.participants(story.id),
      this.webObservations(story.id, participant?.id),
      this.activeConsequencesAndExpire(
        story.id,
        now,
        phase === 'advance' || this.sharedStoryConfig.shareParticipantDetails ? undefined : participant?.id,
      ),
      memoryEnabled ? this.overlaySnapshotsForPrompt(story.id, participant?.id, phase === 'advance') : Promise.resolve([]),
      participant && (phase === 'user-message' || phase === 'intent-due')
        ? this.pendingFollowUpCommitments(story.id, participant.id, now)
        : Promise.resolve([] as NarrativeIntent[]),
      this.upcomingNarrativeIntents(story.id, now),
    ])
    const visibleEntries = this.sharedStoryConfig.shareParticipantDetails
      ? recentEntries
      : recentEntries.filter(entry => {
        // Group transcripts are part of the shared life, but do not expose
        // their raw text to a private relationship unless the owner opts in.
        if (!groupContext && (entry.kind === 'group-message' || entry.kind === 'character-group-message')) return false
        return !entry.participantId || entry.participantId === participant?.id
      })
    // Background advancement is not a chat turn. It receives the ongoing
    // life script, scene and facts, but not raw private/group transcript rows
    // that a model could mistake for a message arriving right now.
    const turnEntries = phase === 'advance'
      ? visibleEntries.filter(entry => !['user-message', 'character-message', 'group-message', 'character-group-message'].includes(entry.kind))
      : visibleEntries
    // The turn's explicit event decides what is happening now. Historical
    // rows are context only and are never reinterpreted as a fresh message.
    const promptEntries = turnEntries
      .filter(entry => !!entry.content.trim())
    if (phase === 'user-message' && visibleEntries.some(entry => !!entry.content.trim()) && !promptEntries.length) {
      throw new Error('Narrative context integrity failure: visible raw history did not reach recentScript.')
    }
    const decodedState = decodeStoryState(story.state)
    const sceneFrame = projectSceneFrame({
      storyId: story.id, now, scene, state: decodedState, recentEntries: promptEntries,
      workingDetails: this.pruneWorkingDetails(decodedState.workingDetails, now),
      scenePresence: decodedState.scenePresence,
      agencyWindow: activeAgencyWindow(decodedState.agencyWindow, now),
    })
    const dialogueBurst = resolveDialogueBurst(
      sceneFrame,
      decodedState.dialogueBurst,
      now,
      {
        scope: participant?.id ?? 'protagonist-life',
        topicText: userMessage ?? groupContext?.messages.map(message => message.content).join('\n') ?? '',
        boundary: phase === 'advance',
      },
    )
    const participants = allParticipants
      .filter(item => item.id !== participant?.id && this.canHandleParticipant(item))
      .sort((left, right) => participantRelevance(right) - participantRelevance(left))
      .slice(0, this.sharedStoryConfig.participantContextLimit)
    const agencyEnabled = this.agencyConfig.enabled
      && this.config.runtime.allowProactiveMessages
      && (phase === 'advance' || phase === 'intent-due' && dueIntents.some(intent => intent.type === 'proactive-check'))
    const advanceCanContact = phase === 'advance' && this.config.runtime.allowProactiveMessages
    const visibleDueIntents = this.sharedStoryConfig.shareParticipantDetails
      ? dueIntents
      : dueIntents.filter(intent => !intent.participantId || intent.participantId === participant?.id)
    const visibleUpcomingIntents = phase === 'advance' || this.sharedStoryConfig.shareParticipantDetails
      ? upcomingIntents
      : upcomingIntents.filter(intent => !intent.participantId || intent.participantId === participant?.id)
    // A relationship consequence belongs to the protagonist's actual life.
    // Background writing therefore sees its compact effect even when raw
    // cross-participant chat history remains private. Live turns still see
    // only their own (and global) consequences unless sharing is enabled.
    const visibleConsequences = phase === 'advance' || this.sharedStoryConfig.shareParticipantDetails
      ? activeConsequences
      : activeConsequences.filter(intent => !intent.participantId || intent.participantId === participant?.id)
    const mergedWebContext = [...webContext, ...extraWebContext]
      .filter(observation => observation.status !== 'deleted')
      .sort((left, right) => left.accessedAt.getTime() - right.accessedAt.getTime())
      .slice(-Math.max(1, this.browserConfig.maxObservationsInPrompt))
    const refreshContinuity = this.shouldRefreshContinuity(story, phase)
    const userReportedTimes = phase === 'user-message' && userMessage?.trim()
      ? extractUserReportedTimes(userMessage, now, story.setting.timezone)
      : undefined
    const developmentTendencies = memoryEnabled
      ? await this.developmentForPrompt(story.id, participant?.id, developmentContextQuery(userMessage, visibleDueIntents.map(intent => intent.summary), promptEntries)) : []
    // Repetition guard: a fixed bubble-count run over her recent delivered
    // replies is an anchoring artifact. It is surfaced to the author only on
    // conversation turns — advance phases stay untouched.
    const messageRepetition = (phase === 'user-message' || phase === 'conversation-follow-up') && !groupContext
      ? detectMessageRepetition(promptEntries) : undefined
    const availableGroupTargets = this.sharedStoryConfig.allowCrossConversationMessages
      && !groupContext && (phase === 'user-message' || phase === 'advance' && advanceCanContact && !this.agencyConfig.enabled)
      ? (this.config.onebot?.groupChats ?? []).filter(group => group.enabled !== false && normalizeGroupId(group.groupId))
        .map(group => ({ participantId: `group:${normalizeGroupId(group.groupId)}`, groupId: normalizeGroupId(group.groupId), label: group.label || '' }))
      : []
    const endpointSelection = this.narrativeEndpointSelection(story, allParticipants, availableGroupTargets)
    const narrated = await this.narrator.decide({
      urgeEnabled: this.urgeConfig.enabled && !dueIntents.some(intent => intent.type === 'narrative-retry'),
      phase, refreshContinuity, outputRecovery, story, from, now, userMessage, userReportedTimes, images, audio, visualObservations, historicalGroupImages, timelinePlan, developmentTendencies,
      writingOptions: {
        messageSeparator: this.config.runtime.messageSeparator?.trim() || '<sep/>',
        splitReplyMessages: this.config.runtime.splitReplyMessages !== false,
        browserMode: !this.browserConfig.enabled || (groupContext && !this.browserConfig.allowGroupTriggeredResearch)
          ? 'disabled' : phase === 'user-message' && participant && !groupContext ? this.browserConfig.mode : 'deferred-only',
        ...(messageRepetition ? { messageRepetition } : {}),
      },
      participant: phase === 'advance' ? null : participant,
      // A background turn may see relationship state through these opaque
      // participant summaries and may proactively contact one account only
      // when the owner explicitly enables proactive messages.
      participants: phase === 'advance' && !advanceCanContact ? [] : participants,
      availableGroupTargets,
      ...(endpointSelection.enabled ? {
        availableOutgoingEndpoints: endpointSelection.options,
        channelSelectionEnabled: true,
      } : {}),
      ...(this.longHorizonConfig.enabled ? { longHorizonGuidance: this.longHorizonPromptProjection(story.id) } : {}),
      dueIntents: visibleDueIntents, upcomingIntents: visibleUpcomingIntents, activeConsequences: visibleConsequences, supersededIntents,
      shareParticipantDetails: this.sharedStoryConfig.shareParticipantDetails,
      recentEntries: promptEntries, memories, sceneContext: { scene, arc: this.trimArcForPrompt(arc), ...(previousScenes.length ? { previousScenes } : {}) }, facts, groupContext, chatCapabilities,
      contactThreads: memoryEnabled ? await this.contactThreads(story.id, facts, participant?.id) : [],
      sceneFrame, dialogueBurst,
      // M4 §十：通道标注数据。只把宿主已确认的路由/来源事实交给作者；
      // 当前入站条目本身不能再被当成“上一条”，否则私↔群和同人异端
      // 规则永远比较不到真正的前一条历史记录。
      channelData: await (async (): Promise<NarrativeChannelData | undefined> => {
        const channelData: NarrativeChannelData = {}
        const turn = this.turnEngine.getTurn(participant?.id ?? '')
        const turnSources = turn?.activeSources ?? turn?.sources
        if (turnSources?.length) {
          channelData.turnSources = turnSources.map(source => ({
            endpointId: source.endpointId,
            receivedSeq: source.receivedSeq,
            channelKind: this.endpointRows.find(row => row.id === source.endpointId)?.channelKind ?? 'qq',
          }))
          if ((turn?.activeBatchEndpointIds?.length ?? 0) > 1) channelData.batchMultiEndpoint = true
          const lastSource = turnSources[turnSources.length - 1]
          const row = this.endpointRows.find(item => item.id === lastSource.endpointId)
          if (row) {
            channelData.currentChannel = {
              endpointId: row.id, channelKind: row.channelKind,
              conversationKind: groupContext ? 'group' : 'private',
            }
          }
          const route = participant
            ? this.endpointAddressSync({ platform: participant.platform, selfId: participant.selfId }, { kind: 'participant-user', id: participant.id })
            : this.endpointAddressSync({ platform: story.platform, selfId: story.selfId }, { kind: 'story-role', id: story.id })
          if (route.endpointId) {
            const routeRow = this.endpointRows.find(item => item.id === route.endpointId)
            channelData.replyEndpoint = {
              endpointId: route.endpointId,
              ...(routeRow ? { channelKind: routeRow.channelKind } : {}),
            }
          }
        }

        // A live user batch appends one or more new entries. Continuation and
        // repair turns have no active batch, so their latest channel row is
        // already the historical predecessor and must not be skipped. Keep
        // this calculation outside the turnSources branch: automatic
        // continuation has no TurnEngine owner but still needs the latest
        // historical channel for the switch annotations.
        const channelEntries = promptEntries.filter(entry => !!(entry.metadata as any)?.channel?.channelKind)
        const hasCurrentInboundBatch = (turn?.activeBatchMessageCount ?? 0) > 0
        const previousEntry = channelEntries.length > (hasCurrentInboundBatch ? 1 : 0)
          ? channelEntries[channelEntries.length - (hasCurrentInboundBatch ? 2 : 1)]
          : undefined
        const previousChannel = (previousEntry?.metadata as any)?.channel
        if (previousChannel) channelData.lastEntryChannel = previousChannel

        if (groupContext && !channelData.currentChannel) {
          // Group turns use the dedicated group debounce buffer rather than
          // TurnEngine. Prefer the endpoint set captured for this exact batch;
          // fall back to the registered story-role endpoint when the registry
          // did not resolve the inbound source.
          const groupTurn = this.bufferedGroupTurns.get(`${story.id}:${normalizeGroupId(groupContext.groupId)}`)
          if ((groupTurn?.activeBatchEndpointIds?.length ?? 0) > 1) channelData.batchMultiEndpoint = true
          const activeGroupEndpointId = groupTurn?.activeBatchEndpointIds?.at(-1)
          const row = (activeGroupEndpointId
            ? this.endpointRows.find(item => item.id === activeGroupEndpointId && item.enabled)
            : undefined)
            ?? this.endpointRows.find(item => item.ownerKind === 'story-role'
            && item.ownerId === story.id && item.enabled
            && (item.platform === story.platform || isOneBotPlatform(item.platform) && isOneBotPlatform(story.platform)))
            ?? this.endpointRows.find(item => item.ownerKind === 'story-role' && item.ownerId === story.id && item.enabled)
          if (row) {
            channelData.currentChannel = { endpointId: row.id, channelKind: row.channelKind, conversationKind: 'group' }
            channelData.replyEndpoint = { endpointId: row.id, channelKind: row.channelKind }
          }
        }

        // Automatic follow-up/intent turns have no inbound TurnEngine source.
        // For a participant turn, the participant's registered endpoint is the
        // current conversation channel and the reply route. This also gives
        // continuation a meaningful comparison target without pretending a
        // new inbound message arrived.
        if (!channelData.currentChannel && participant) {
          const route = this.endpointAddressSync({ platform: participant.platform, selfId: participant.selfId }, { kind: 'participant-user', id: participant.id })
          const routeRow = route.endpointId ? this.endpointRows.find(item => item.id === route.endpointId) : undefined
          if (route.endpointId) {
            channelData.currentChannel = {
              endpointId: route.endpointId,
              ...(routeRow ? { channelKind: routeRow.channelKind } : {}),
              conversationKind: 'private',
            }
            channelData.replyEndpoint = {
              endpointId: route.endpointId,
              ...(routeRow ? { channelKind: routeRow.channelKind } : {}),
            }
          }
        }
        return channelData.turnSources?.length || channelData.lastEntryChannel || channelData.currentChannel || channelData.replyEndpoint
          ? channelData : undefined
      })(),
      workingDetails: this.pruneWorkingDetails(decodedState.workingDetails, now),
      timelineCarry: decodedState.timelineCarry,
      recalledHistory: memoryEnabled && recallFocus(userMessage,
        facts.filter(fact => fact.unresolved).map(fact => fact.knowledge?.topic ?? '').filter(Boolean),
        visibleDueIntents.map(intent => intent.summary)).trim()
        ? await this.recallHistory(
            story.id,
            participant?.id ?? '',
            recallFocus(userMessage,
              facts.filter(fact => fact.unresolved).map(fact => fact.knowledge?.topic ?? '').filter(Boolean),
              visibleDueIntents.map(intent => intent.summary)),
            resolvedTurnEmbedding ?? [],
            new Set(compactPromptEntries(promptEntries, 24_000,
              (this.config.runtime.contextTimeWindowMinutes ?? 60) > 0
                ? new Date(now.getTime() - Math.min(this.config.runtime.contextTimeWindowMinutes ?? 60, 1_440) * Time.minute)
                : undefined).map(entry => entry.id)),
            new Set(facts.filter(fact => userMessage?.trim() || fact.unresolved && fact.knowledge?.topic).flatMap(fact => fact.sourceEntryIds ?? [])),
            userMessage?.trim() ? 3 : 1,
          )
        : undefined,
      recentProtectionSince: (this.config.runtime.contextTimeWindowMinutes ?? 60) > 0
        ? new Date(now.getTime() - Math.min(this.config.runtime.contextTimeWindowMinutes ?? 60, 1_440) * Time.minute)
        : undefined,
      ...(quotedMessages.length ? { quotedMessages } : {}),
      ...(stickerCatalog.length && phase === 'user-message' ? { stickerCatalog } : {}),
      webContext: mergedWebContext, overlaySnapshots,
      alterEnabled: this.alterSystemConfig.enabled,
      emotionalOffset: this.emotionalOffsetForPrompt(story),
      agencyEnabled,
      proactiveContactMode: this.agencyConfig.contactMode,
      agencyWindow: agencyEnabled ? activeAgencyWindow(story.state.agencyWindow, now) ?? null : null,
      automaticDeliverySummaries: isAutomaticNarrativePhase(phase)
        ? decodedState.automaticDeliverySummaries
        : [],
      followUpCommitments,
      schedulePreplan: await this.currentSchedulePreplanWindow(story, now),
      onEarlyReply,
    })
    // script 对象形态归一（rc50 issue 报告）：必须在 no-usable-script 闸门
    // (tryDecide:5465) 之前——归一后 script 恒为字符串,闸门与 normalizeDecision 自然通过。
    const normalizedScript = normalizeScriptField((narrated as { script?: unknown })?.script)
    const narratedDecision = normalizedScript ? { ...narrated, script: normalizedScript } : narrated
    return reconcileTransportReferences(narratedDecision, false, this.config.runtime.messageSeparator)
  }

  /** Refresh continuity only on the first automatic pass or every fifteenth
   * successful narrative write. Ordinary turns reuse the last snapshot. */
  private shouldRefreshContinuity(_story: InterludeStory, _phase: NarrativeRequest['phase']) {
    // Background scene/arc compaction remains active. A second real-time
    // summary adds neither original evidence nor execution confirmation.
    return false
  }

  /** The optional director supplies a relative-time ledger. Its failures cool
   * down independently while the main author may continue without that ledger. */
  private async planAutomaticTimeline(story: InterludeStory, participant: InterludeParticipant | null, phase: Extract<NarrativeRequest['phase'], 'advance' | 'conversation-follow-up' | 'intent-due'>, from: Date, now: Date, dueIntents: NarrativeIntent[]) {
    if (this.config.timelineDirector?.enabled === false) return undefined
    if (!this.compactor.planTimeline) return undefined
    const persisted = decodeStoryState(story.state).automation
    if (!this.timelineDirectorFailures.has(story.id) && persisted?.timelineDirectorFailures) {
      this.timelineDirectorFailures.set(story.id, persisted.timelineDirectorFailures)
    }
    const retryAt = toDate(persisted?.timelineRetryAt)
    const backoff = this.timelineBackoff.get(story.id) ?? (retryAt ? { from: 0, until: retryAt.getTime() } : undefined)
    if (backoff && Date.now() < backoff.until) {
      this.reportOperation('diagnostic', 'debug', story, phase,
        '时间导演调用冷却至 %s；主叙事仍可无账本推进', formatLogTime(new Date(backoff.until), story.setting.timezone))
      return undefined
    }
    if (backoff) this.timelineBackoff.delete(story.id)
    const [scene, recentEntries, facts] = await Promise.all([
      this.activeScene(story.id),
      this.recentEntriesForPrompt(story.id, now),
      this.memoryConfig.enabled ? this.facts(story.id, Math.min(16, this.config.runtime.memoryLimit), '') : Promise.resolve([] as NarrativeFact[]),
    ])
    const visibleEntries = this.sharedStoryConfig.shareParticipantDetails
      ? recentEntries
      : recentEntries.filter(entry => !entry.participantId || entry.participantId === participant?.id)
    const continuation = [...visibleEntries].reverse().find(entry => entry.kind === 'script' && entry.content.trim())
    const continuationLedger = continuation ? timelineEntryPromptProjection(continuation) : undefined
    const request: TimelinePlanRequest = {
      story, participant, phase, from, now, scene, facts, recentEntries: visibleEntries.map(entry => timelineEntryPromptProjection(entry)),
      contactThreads: this.memoryConfig.enabled ? await this.contactThreads(story.id, facts, participant?.id) : [],
      recalledHistory: this.memoryConfig.enabled && recallFocus(undefined,
        facts.filter(fact => fact.unresolved).map(fact => fact.knowledge?.topic ?? ''),
        dueIntents.filter(intent => !intent.participantId || intent.participantId === participant?.id).map(intent => intent.summary))
        ? await this.recallHistory(story.id, participant?.id ?? '', recallFocus(undefined,
          facts.filter(fact => fact.unresolved).map(fact => fact.knowledge?.topic ?? ''),
          dueIntents.filter(intent => !intent.participantId || intent.participantId === participant?.id).map(intent => intent.summary)),
        [], new Set(visibleEntries.map(entry => entry.id)), new Set(facts.filter(fact => fact.unresolved && fact.knowledge?.topic).flatMap(fact => fact.sourceEntryIds ?? [])), 1)
        : undefined,
      recentScriptContinuation: continuation ? {
        content: continuation.content,
        occurredAt: continuation.occurredAt,
        ...(continuationLedger && continuationLedger.content !== continuation.content
          ? { hostTimelineLedger: continuationLedger.content }
          : {}),
      } : null,
      dueIntents, schedulePreplan: await this.currentSchedulePreplanWindow(story, now),
    }
    try {
      const rawPlan: unknown = await this.compactor.planTimeline(request)
      const plan = normalizeTimelinePlan(rawPlan)
      if (plan) {
        this.timelineDirectorFailures.delete(story.id)
        this.timelineBackoff.delete(story.id)
        const automation = { ...(story.state.automation ?? {}) }
        delete automation.timelineRetryAt
        delete automation.timelineRetryFrom
        delete automation.timelineDirectorFailures
        story.state = { ...story.state, automation }
        try {
          await this.dbSet('interlude_story', { id: story.id }, { state: story.state, updatedAt: new Date() })
        } catch (error) {
          this.reportOperation('diagnostic', 'debug', story, phase, '时间导演成功状态持久化失败 错误=%s', error)
        }
        this.reportOperation('diagnostic', 'debug', story, phase, '时间导演已生成事件账本 节点=%d', plan.beats.length)
      } else {
        // 可诊断性：把模型原始返回暴露出来，避免"永远失效但不知道为什么"。
        const rawPreview = typeof rawPlan === 'string' ? rawPlan.slice(0, 400) : JSON.stringify(rawPlan ?? null)?.slice(0, 400)
        const failures = (this.timelineDirectorFailures.get(story.id) ?? 0) + 1
        this.timelineDirectorFailures.set(story.id, failures)
        this.reportOperation('standard', 'warn', story, phase,
          '时间导演返回被拒绝（连续第 %d 次）原始返回=%s 拒绝原因=%s',
          failures, rawPreview ?? 'undefined', describeTimelinePlanRejection(rawPlan))
        await this.persistTimelineRetry(story, from, phase, failures)
      }
      return plan
    } catch (error) {
      const failures = (this.timelineDirectorFailures.get(story.id) ?? 0) + 1
      this.timelineDirectorFailures.set(story.id, failures)
      this.reportOperation('standard', 'warn', story, phase, '时间导演调用失败（连续第 %d 次）错误=%s', failures, error)
      await this.persistTimelineRetry(story, from, phase, failures)
      return undefined
    }
  }

  /** 熔断判定：连续失败达到阈值即熔断；熔断有 2h 冷却，到期自动重试一次完整路径。 */
  private isTimelineDirectorFused(storyId: string): number | undefined {
    const failures = this.timelineDirectorFailures.get(storyId)
    if (!failures || failures < TIMELINE_DIRECTOR_FUSE) return undefined
    return failures
  }

  /** Persist director health independently from the narrative cursor. */
  private async persistTimelineRetry(story: InterludeStory, from: Date, phase: NarrativeRequest['phase'], failures = 1) {
    // 指数退避：10min → 20min → 40min → 80min → 封顶 2h。
    // 退避只决定重试节奏；真正终止循环的是熔断降级（planAutomaticTimeline）。
    const backoff = Math.min(TIMELINE_RETRY_BACKOFF_BASE * 2 ** Math.max(0, failures - 1), TIMELINE_DIRECTOR_FUSE_COOLDOWN)
    const until = new Date(Date.now() + backoff)
    this.timelineBackoff.set(story.id, { from: from.getTime(), until: until.getTime() })
    const automation = {
      ...(story.state.automation ?? {}),
      timelineRetryAt: until.toISOString(),
      timelineRetryFrom: from.toISOString(),
      timelineDirectorFailures: Math.min(TIMELINE_DIRECTOR_FUSE, failures),
    }
    story.state = encodeStoryState({ ...decodeStoryState(story.state), automation })
    try {
      await this.dbSet('interlude_story', { id: story.id }, { state: story.state, updatedAt: new Date() })
    } catch (error) {
      this.reportOperation('diagnostic', 'debug', story, phase, '时间导演冷却状态持久化失败，将继续使用内存冷却 错误=%s', error)
    }
  }

  private async tryDecide(story: InterludeStory, participant: InterludeParticipant | null, phase: NarrativeRequest['phase'], from: Date, now: Date, userMessage: string | undefined, dueIntents: NarrativeIntent[], supersededIntents: NarrativeIntent[] = [], groupContext?: GroupContext, images: NarrativeImage[] = [], audio: NarrativeAudio[] = [], chatCapabilities?: ChatActionCapabilities, quotedMessages: IndexedQuotedMessageContext[] = [], stickerCatalog: StickerCatalogEntry[] = [], turnQueryEmbedding?: number[], visualObservations?: string[], onEarlyReply?: (reply: EarlyNarrativeReply) => Promise<boolean>, historicalGroupImages: NarrativeHistoricalImage[] = []) {
    let immediateObservations: WebObservation[] = []
    let effectiveNow = now
    const automaticPhase = phase === 'advance' || phase === 'conversation-follow-up' || phase === 'intent-due'
    const shortSchedule = automaticPhase && phase !== 'advance' && this.schedulePreplanConfig.enabled
      ? await this.currentSchedulePreplanWindow(story, from) : undefined
    const directorRequired = automaticPhase && this.config.timelineDirector?.enabled !== false
      && needsTimelineDirector(phase, from, now, story.setting.timezone, shortSchedule)
    const timelinePlan = directorRequired
      ? await this.planAutomaticTimeline(story, participant, phase, from, now, dueIntents)
      : undefined
    if (directorRequired && !timelinePlan) {
      // 降级而非冻结：账本缺失只损失时间结构辅助，自动推进照常进行
      // （熔断计数仍抑制导演调用本身，冷却后自动重试完整路径）。
      // 旧实现在这里丢弃整个回合，0 命中率曾让自动生活流实质瘫痪。
      const fused = this.isTimelineDirectorFused(story.id)
      this.reportOperation('standard', 'warn', story, phase,
        fused
          ? '时间导演已熔断（连续失败 %d 次），本次自动回合降级为无账本推进'
          : '时间导演未生成有效事件账本，本次自动回合降级为无账本推进',
        ...(fused ? [fused] : []))
    }
    const startedAt = Date.now()
    this.reportOperation('standard', 'info', story, phase,
      '模型调用开始 任务=主叙事 模型=%s 参与者=%s 时间段=%s→%s 到期计划=%d',
      this.mainModelLabel(), participant?.id || '全局', formatLogTime(from, story.setting.timezone), formatLogTime(now, story.setting.timezone), dueIntents.length)
    try {
      let earlyReplyCommitted = false
      const canEarlyReply = onEarlyReply && !(phase === 'user-message' && participant && !groupContext && this.browserConfig.enabled && this.browserConfig.mode === 'allow-immediate')
      const earlyReply = canEarlyReply ? async (reply: EarlyNarrativeReply) => {
        const committed = await onEarlyReply(reply)
        if (committed) earlyReplyCommitted = true
        return committed
      } : undefined
      let decision = await this.decide(story, participant, phase, from, effectiveNow, userMessage, dueIntents, supersededIntents, groupContext, images, audio, [], false, chatCapabilities, quotedMessages, stickerCatalog, turnQueryEmbedding, visualObservations, timelinePlan, earlyReply, historicalGroupImages)
      const immediate = phase === 'user-message' && participant && !groupContext && this.browserConfig.enabled && this.browserConfig.mode === 'allow-immediate'
        ? decision.browserIntents?.map(intent => normalizeBrowserIntentDraft(intent, this.browserConfig)).find(intent => intent?.timing === 'immediate')
        : undefined
      if (immediate) {
        // The first pass merely proposes the action. Do not persist its prose
        // or chat decision: after the real page read, ask the narrator once
        // more with the observation so the final script stays a single,
        // coherent piece of writing rather than two stitched tool calls.
        this.reportOperation('standard', 'info', story, phase, '即时网页观察开始 模式=%s', immediate.mode)
        const observation = await this.collectWebObservation(story, immediate, participant.id, null, new Date(), false)
        immediateObservations = [observation]
        effectiveNow = new Date()
        decision = await this.decide(story, participant, phase, from, effectiveNow, userMessage, dueIntents, supersededIntents, groupContext, images, audio, immediateObservations, false, chatCapabilities, quotedMessages, stickerCatalog, turnQueryEmbedding, visualObservations, timelinePlan, undefined, historicalGroupImages)
      }
      // 用户自报的钟点（“八点赶到”）对守卫背书：模型复述它们不是时间越界。
      // 提取是 O(消息长度) 的本地正则，只在实况用户回合发生一次。
      const endorsedClocks = phase === 'user-message' && userMessage?.trim()
        ? new Set(extractUserReportedTimes(userMessage, effectiveNow, story.setting.timezone)
            .map(fact => Number(fact.localTime.slice(-5, -3)) * 60 + Number(fact.localTime.slice(-2)))
            .filter(Number.isFinite))
        : undefined
      const initialTimeOverflow = detectLiveScriptTimeOverflow(decision.script, phase, from, effectiveNow, story.setting.timezone, endorsedClocks)
      const initialVisibleRecovery = this.modelRouting.main.available && !earlyReplyCommitted && requiresVisibleReplyRecovery(phase, groupContext, decision)
      if (initialTimeOverflow || initialVisibleRecovery) {
        // 诊断：记录被抛弃草稿里模型实际返回的 interaction（缺失/为空/形状错误），
        // 让下一次"结构化可见回复缺失"可以直接从日志定位是模型行为还是解析问题。
        if (initialVisibleRecovery) {
          this.reportOperation('diagnostic', 'warn', story, phase, '被抛弃草稿的结构化回复字段 interaction=%s groupReply=%s',
            safeJsonPreview(decision.interaction), safeJsonPreview(decision.groupReply))
        }
        this.reportOperation('standard', 'warn', story, phase,
          initialTimeOverflow
            ? '剧本越过当前时间终点，已抛弃本次未落库剧本并重新写作 原因=%s'
            : '结构化可见回复缺失，已抛弃本次未落库剧本并重新写作',
          ...(initialTimeOverflow ? [initialTimeOverflow] : []))
        // Fix 5：structureMissing 在首稿就计数（进入恢复重写即视为"发生了一次
        // 缺失"）；recoverySaved 在恢复稿通过校验后才计数（不是进入恢复就计）。
        if (initialVisibleRecovery) this.health?.recordStructureMissing(story.id)
        else if (initialTimeOverflow) { /* 时间越界不在此计数 */ }
        decision = await this.decide(story, participant, phase, from, effectiveNow, userMessage, dueIntents, supersededIntents, groupContext, images, audio, immediateObservations, true, chatCapabilities, quotedMessages, stickerCatalog, turnQueryEmbedding, visualObservations, timelinePlan, undefined, historicalGroupImages)
        const recoveredTimeOverflow = detectLiveScriptTimeOverflow(decision.script, phase, from, effectiveNow, story.setting.timezone, endorsedClocks)
        if (recoveredTimeOverflow) throw new Error(`Narrative provider crossed the live time boundary after one recovery attempt: ${recoveredTimeOverflow}`)
        // 恢复成功 = 第二稿不再需要回复恢复。
        if (initialVisibleRecovery && !requiresVisibleReplyRecovery(phase, groupContext, decision) && !recoveredTimeOverflow) {
          this.health?.recordRecoverySaved(story.id)
        }
        if (this.modelRouting.main.available && !earlyReplyCommitted && requiresVisibleReplyRecovery(phase, groupContext, decision)) {
          this.reportOperation('diagnostic', 'warn', story, phase, '恢复尝试仍缺失结构化回复 interaction=%s', safeJsonPreview(decision.interaction))
          // 降级而非硬失败：两稿都丢 interaction 时，若剧本非空仍以无可见回复
          // 提交——生活继续走、用户下次还能触发回复；硬失败会让整回合进
          // 30s 重试队列，弱模型下变成失败循环。
          if (typeof decision.script === 'string' && decision.script.trim()) {
            this.reportOperation('standard', 'warn', story, phase, '结构化回复两稿均缺失，降级为无可见回复提交（剧本推进不受影响）')
            decision = { ...decision, interaction: undefined, groupReply: undefined }
          } else {
            throw new Error('Narrative provider omitted the required visible-reply structure after one recovery attempt.')
          }
        }
      }
      // The fixed narrative contract requires prose for every real model turn.
      // A syntactically valid object with an omitted/blank script used to be
      // treated as success, advancing the cursor while leaving a gap in the
      // life record. Treat it like a provider failure so live user turns use
      // the existing persisted retry path and background turns retain time for
      // their next attempt. Fallback is intentionally a no-network smoke mode.
      if (this.modelRouting.main.available && !hasRequiredNarrativeScript(decision)) {
        // rc50 issue 报告:抛错前留原始决策快照——字段名/类型错排障必需。
        this.reportOperation('diagnostic', 'warn', story, phase, '主叙事无可用 script，原始决策=%s', safeJsonPreview(decision))
        throw new Error('Narrative provider returned no usable script.')
      }
      const result = {
        decision,
        succeeded: true,
        effectiveNow,
        immediateObservations,
        timelinePlan,
      }
      if (this.config.logging?.logScriptPreview && result.decision.script) {
        this.report('info', story, phase, '当前剧本内容：\n%s', result.decision.script.slice(0, this.config.logging.previewLength))
      }
      this.reportOperation('standard', 'info', story, phase,
        '模型调用完成 任务=主叙事 耗时=%dms 剧本文字=%d 回复模式=%s',
        Date.now() - startedAt, result.decision.script?.length ?? 0, visibleReplyMode(result.decision, phase, groupContext))
      this.health?.recordNarrativeComplete(story.id, Date.now() - startedAt, visibleReplyMode(result.decision, phase, groupContext))
      this.lastActiveStoryId = story.id
      // 无可见回复的私聊回合打出最终 interaction（纳入 logScriptPreview
      // 门控——JSON 里可能带 reply 草稿，不能绕过隐私开关；需要时与剧本预览
      // 一起打开）。
      if (phase === 'user-message' && !groupContext && result.decision.interaction?.reply?.mode === 'none' && this.config.logging?.logScriptPreview) {
        this.reportOperation('standard', 'info', story, phase, '本回合无可见回复 interaction=%s',
          safeJsonPreview(result.decision.interaction))
      }
      return result
    } catch (error) {
      // 主叙事失败是最高优先级故障（角色无响应）——升 error 供运维告警。
      // 例外：插件重载/停机导致的调用中断不是提供商故障，不告警、不记健康分。
      if (isContextDisposedError(error) || this.disposed) {
        this.reportOperation('diagnostic', 'debug', story, phase, '插件重载中，放弃本轮主叙事调用 耗时=%dms', Date.now() - startedAt)
        return { decision: {}, succeeded: false, effectiveNow, immediateObservations, timelinePlan }
      }
      this.report('error', story, phase,
        '模型调用失败 任务=主叙事 阶段=narrative-provider 当前图片=%d 历史图片=%d 音频=%d 耗时=%dms 错误=%s',
        images.length, historicalGroupImages.length, audio.length, Date.now() - startedAt, describeHttpError(error))
      this.health?.recordNarrativeFailed(story.id)
      return { decision: {}, succeeded: false, effectiveNow, immediateObservations, timelinePlan }
    }
  }

  private async persistDecision(
    story: InterludeStory,
    participant: InterludeParticipant | null,
    raw: NarrativeDecision,
    from: Date,
    now: Date,
    permitMessages: boolean,
    phase: NarrativeRequest['phase'],
    contextIntents: NarrativeIntent[] = [],
    immediateReplyAlreadyDelivered = false,
    timelinePlan?: TimelinePlan,
  ) {
    // 先规范化，再写库：不信任模型给出的时间、长度和结构，尤其不能让未来剧情落库。
    raw = reconcileTransportReferences(raw, immediateReplyAlreadyDelivered, this.config.runtime.messageSeparator)
    // 无 participant 回合（群聊/推进）容错重排 interaction：见 hoistParticipantlessInteraction。
    if (!participant) {
      const hoisted = hoistParticipantlessInteraction(raw, phase)
      if (hoisted !== raw) {
        const originalMode = raw.interaction?.reply?.mode
        raw = hoisted
        this.reportOperation('standard', 'info', story, phase,
          '无参与者回合已重排 interaction 回复 原mode=%s 处理=%s', originalMode, hoisted.groupReply ? '提升为群发' : '剥离（无回复通道）')
      }
    }
    const allParticipants = await this.participants(story.id)
    const permittedParticipantIds = new Set(allParticipants.filter(item => this.canHandleParticipant(item)).map(item => item.id))
    const permittedGroupIds = new Set((this.config.onebot?.groupChats ?? [])
      .filter(group => group.enabled !== false)
      .map(group => normalizeGroupId(group.groupId))
      .filter(Boolean))
    const refreshContinuity = this.shouldRefreshContinuity(story, phase)
    let decision = normalizeDecision(
      raw, from, now, permitMessages, this.effectiveUrgeRuntime, this.sharedStoryConfig,
      participant?.id ?? '', permittedParticipantIds, permittedGroupIds, phase, this.memoryConfig, refreshContinuity,
    )
    const stateBefore = decodeStoryState(story.state)
    const activeScene = decision.script ? await this.activeScene(story.id) : null
    const sceneFrame: SceneFrame | undefined = decision.script
      ? projectSceneFrame({
          storyId: story.id, now, scene: activeScene, state: stateBefore,
          workingDetails: this.pruneWorkingDetails(stateBefore.workingDetails, now),
          scenePresence: stateBefore.scenePresence,
          agencyWindow: activeAgencyWindow(stateBefore.agencyWindow, now),
        })
      : undefined
    const dialogueBurst: DialogueBurstState | undefined = sceneFrame
      ? resolveDialogueBurst(sceneFrame, stateBefore.dialogueBurst, now, {
          scope: participant?.id ?? 'protagonist-life',
          boundary: phase === 'advance',
        })
      : undefined
    const groupReplyContent = normalizeGroupVisibleReply(
      raw.groupReply,
      undefined,
      this.config.runtime.maxMessageCharacters,
      this.config.runtime.messageSeparator,
      this.config.runtime.splitReplyMessages !== false,
    )
    // Fix 3（Commit 绑定）：advance 相位在 Commit 构建前做一次合成预检——
    // 模型只给了 proactiveContact 意愿但没给 crossConversationActions 行动时，
    // 从唯一 say 行动合成并注入 decision，让 commit-builder 正常为其生成
    // outgoing-message 事件和投递账本绑定。此前合成发生在 Commit 之后，
    // 导致合成消息不进账本（deliveryReality 下一轮报 no-outgoing-action-recorded）。
    // 注意：Agency 完整判断（容量/意愿门槛）仍在后方做——此处只做"是否有
    // proactiveContact + 是否缺行动 + 恰好一条 say"的注入预检，后方如果
    // Agency 拒绝发送，crossActions 过滤会把这条注入的行动拦下。
    if (phase === 'advance' && !decision.crossConversationActions.length && decision.proactiveContact) {
      const synthesized = this.synthesizeCrossActionFromScript(decision, String((decision.proactiveContact as unknown as { participantId?: unknown })?.participantId ?? ''))
      if (synthesized) {
        decision = { ...decision, crossConversationActions: [synthesized] }
        this.reportOperation('standard', 'info', story, phase,
          'Commit 前合成：模型未返回 crossConversationAction，已从唯一 say 行动注入 参与者=%s', synthesized.participantId)
      }
    }
    // proactive-check 相位的对称前移：模型没输出 interaction.reply 时，从唯一
    // say 行动合成 interaction 并注入 decision——让 commit-builder 为其生成
    // outgoing-message 事件和投递账本绑定。此前合成在 Commit 后导致账本缺记录。
    if (contextIntents.length > 0 && contextIntents.every(intent => intent.type === 'proactive-check')
      && participant && decision.proactiveContact && (!decision.interaction?.reply?.content)) {
      const synthesized = this.synthesizeCrossActionFromScript(decision, participant.id)
      if (synthesized) {
        decision = { ...decision, interaction: { seen: false, reply: { mode: 'immediate', content: synthesized.content } } }
        this.reportOperation('standard', 'info', story, phase,
          'Commit 前合成：模型未输出 interaction 回复，已从唯一 say 行动注入 参与者=%s', participant.id)
      }
    }
    const buildCommit = () => decision.script
      ? decisionToScriptCommit({
          storyId: story.id,
          participantId: participant?.id,
          phase,
          from,
          now,
          decision: {
            ...decision,
            groupReply: raw.groupReply,
            messageReactions: raw.messageReactions,
            localMedia: raw.localMedia,
            nativeFace: raw.nativeFace,
          } as NarrativeDecision,
          messageSeparator: this.config.runtime.messageSeparator,
          splitReplyMessages: this.config.runtime.splitReplyMessages,
          groupReplyContent,
          frameId: sceneFrame?.id,
          burstId: dialogueBurst?.id,
          startsAfterEventId: dialogueBurst?.lastEventId,
        })
      : undefined
    let commit = buildCommit()
    if (phase === 'advance') {
      // 小模型仍可输出 content-only；复用最终正文/分泡绑定，不强制 say/actionId。
      // 只剔除对不上正文的即时主动行动，并在落库前重建 commit，避免留下可补投
      // 的 pending 账本。此处不合成新行动、不重试模型；私聊回复与 delayed 保持原样。
      const rejected = new Set(decision.crossConversationActions.filter(action => action.mode === 'immediate'
        && (!commit || findPrivateOutgoingMessageEvent(commit, action.participantId, 'immediate', action.content,
          this.config.runtime.messageSeparator)?.scriptBinding?.status !== 'bound')))
      if (rejected.size) {
        decision = { ...decision, crossConversationActions: decision.crossConversationActions.filter(action => !rejected.has(action)) }
        commit = buildCommit()
        this.reportOperation('standard', 'warn', story, phase,
          '主动消息正文绑定缺失或不唯一，取消本轮即时行动 数量=%d；保留剧本推进，不重试模型', rejected.size)
      }
    }
    if (commit) {
      const validation = validateScriptCommit(commit, this.config.runtime.messageSeparator)
      if (!validation.valid) throw new Error(`ScriptCommit structural validation failed: ${validation.errors.join('; ')}`)
      const unbound = unboundImmediateMessageEvents(commit)
      if (unbound.length) {
        this.reportOperation('diagnostic', 'debug', story, phase,
          'M5 剧本行动绑定未确认 即时消息=%d；保留兼容投递，不重写已生成剧本', unbound.length)
      }
    }
    let scriptEntry: ScriptEntry | undefined
    if (commit) {
      // A resolution belongs to this exact message reaching the user.
      if (participant && (permitMessages || immediateReplyAlreadyDelivered) && decision.followUpResolutions.length) {
        const event = findPrivateOutgoingMessageEvent(commit, participant.id, 'immediate', decision.interaction?.reply.content, this.config.runtime.messageSeparator)
        if (event) event.metadata = { ...event.metadata, followUpResolutions: decision.followUpResolutions }
      }
      if (participant && phase === 'user-message' && (permitMessages || immediateReplyAlreadyDelivered)) {
        const event = findPrivateOutgoingMessageEvent(commit, participant.id, 'immediate', decision.interaction?.reply.content, this.config.runtime.messageSeparator)
        const commitment = decision.followUpCommitment ?? (interactionPromisesFollowUp(decision.interaction?.reply.content)
          ? inferredFollowUpCommitment(decision.interaction!.reply.content!, now) : undefined)
        if (event && commitment) event.metadata = { ...event.metadata, followUpCommitment: commitment }
      }
      scriptEntry = await this.appendEntry(
        story.id,
        scriptEntryDraftForCommit(commit, decision.interaction ?? null, timelinePlan, decision.lifeHandoff),
        now,
        participant?.id ?? '',
      )
    }
    const resolvedConsequences = await this.applyIntentUpdates(story.id, decision.intentUpdates, now, participant?.id)
    for (const memory of decision.memories) await this.appendMemory(story.id, memory, now, memory.participantId ?? participant?.id ?? '', scriptEntry?.id)
    for (const intent of decision.intents) {
      // A reminder or promise created while handling a user's message is a
      // response to that relationship, even if it becomes due much later.
      // Carry that provenance into the shared intent ledger so its due-turn
      // is allowed to send the eventual message without enabling broad
      // background outreach.
      const payload = isRecord(intent.payload) ? intent.payload : {}
      await this.appendIntent(story.id, {
        ...intent,
        payload: phase === 'user-message' && participant
          ? { ...payload, userInitiated: payload.userInitiated !== false }
          : payload,
      }, now, intent.participantId ?? participant?.id ?? '')
    }
    const resolvedFollowUps = new Set<number>() // Settled only by confirmed delivery.
    for (const browserIntent of decision.browserIntents) {
      // An immediate intent is handled before the final narrator pass when
      // enabled. If it reaches this point (disabled mode, group turn, or a
      // second consecutive request), safely downgrade it to deferred work.
      if (participant || phase !== 'user-message' || this.browserConfig.allowGroupTriggeredResearch) {
        await this.appendBrowserIntent(story.id, browserIntent, now, participant?.id ?? '')
      }
    }
    if (participant && decision.statePatch) await this.updateParticipantState(participant, decision.statePatch, now)

    const isAgencyCheck = contextIntents.length > 0 && contextIntents.every(intent => intent.type === 'proactive-check')
    let agencyCandidate: ProactiveContactDraft | undefined
    let agencyAllowsSend = false
    // 门控拒绝的具体原因(端点/容量/意愿/上限),供拦截补偿账本使用
    let agencyBlockReason: string | undefined
    let agencyRecheck: { candidate: ProactiveContactDraft; window: AgencyWindowState; reason: string; at: Date } | undefined
    /** Agency 放行的主动联系预记 ref：随消息草稿带到投递；终态失败时按 ref
     * 作废 proactiveContactLog 里那条计数，配额只在送达（或待恢复）时消耗。 */
    let proactiveContactRef: string | undefined

    if (decision.script) {
      const state = stateBefore
      const nextCount = Math.max(0, Math.floor(state.narrativeUpdateCount || 0)) + 1
      const nextState: StoryState = { ...state, narrativeUpdateCount: nextCount }
      // Originals and execution annotations now supply continuity. A second
      // real-time prose summary must not certify an unexecuted sending action.
      if (resolvedConsequences || resolvedFollowUps.size) {
        nextState.continuityDirty = true
      }
      const alterTurn = this.updateAlterSystem(story, state.alterSystem, decision.alter, phase, now, participant?.id ?? '')
      nextState.alterSystem = alterTurn?.state ?? state.alterSystem
      nextState.timelineCarry = [] // Plans do not become persistent facts.
      if (decision.lifeHandoff && scriptEntry) {
        const handoff = decision.lifeHandoff
        const presence = new Map((nextState.scenePresence ?? []).map(item => [item.name, item]))
        if (handoff.transition || (handoff.place && handoff.place.value !== stateBefore.sceneFrame?.place) || handoff.presence) {
          for (const [name, item] of presence) presence.set(name, {
            ...item, status: 'off-scene', sourceEntryIds: [scriptEntry.id], updatedAt: now.toISOString(),
            basis: 'Local occupancy superseded by a new original-script handoff; not an invented departure.',
          })
        }
        for (const name of handoff.presence?.names ?? []) presence.set(name, {
          name, status: 'present', basis: handoff.presence!.quote, sourceEntryIds: [scriptEntry.id], updatedAt: now.toISOString(),
        })
        nextState.scenePresence = [...presence.values()].slice(-8)
        const resolved = new Set(handoff.resolvedDetails?.map(item => item.label))
        nextState.workingDetails = (nextState.workingDetails ?? []).filter(item => !resolved.has(item.label))
        nextState.workingDetailResolutions = { ...nextState.workingDetailResolutions }
        for (const label of resolved) nextState.workingDetailResolutions[label] = scriptEntry.id
      }
      if (scriptEntry && decision.lifeHandoff) await this.persistTimelineSceneAnchor(story.id, decision.lifeHandoff, scriptEntry.id, now)
      if (sceneFrame && dialogueBurst && scriptEntry && commit) {
        const advanced = advanceSceneFrame(sceneFrame, dialogueBurst, commit, scriptEntry.id, now, decision.lifeHandoff)
        nextState.sceneFrame = advanced.frame
        nextState.dialogueBurst = advanced.burst
      }
      if (this.agencyConfig.enabled && (phase === 'advance' || isAgencyCheck)) {
        const sourceEntries = decision.agencyWindow || decision.proactiveContact
          ? await this.recentEntries(story.id, Math.max(40, this.config.runtime.contextEntryLimit * 2))
          : []
        const validSourceEntryIds = new Set(sourceEntries.map(entry => entry.id))
        if (scriptEntry?.id) validSourceEntryIds.add(scriptEntry.id)
        const agencyWindow = normalizeAgencyWindowDraft(
          decision.agencyWindow,
          now,
          this.agencyConfig,
          validSourceEntryIds,
          scriptEntry?.id,
        ) ?? activeAgencyWindow(state.agencyWindow, now)
        nextState.agencyWindow = agencyWindow
        agencyCandidate = normalizeProactiveContact(
          decision.proactiveContact,
          now,
          this.agencyConfig,
          permittedParticipantIds,
          validSourceEntryIds,
          scriptEntry?.id,
        )
        if (isAgencyCheck && agencyCandidate?.participantId !== participant?.id) agencyCandidate = undefined
        if (agencyCandidate && agencyWindow) {
          const target = allParticipants.find(item => item.id === agencyCandidate!.participantId)
          // 联系温度：natural/balanced 只放宽意愿阈值与安全间隔；Urge 爆发间隔
          // 仍优先；容量门（设备/隐私/负荷）三模式全保——想聊天也需要手机和隐私。
          const modeRelaxed = this.agencyConfig.contactMode !== 'strict'
          const urgeBurst = this.urgeConfig.enabled && urgeBurstActive(normalizeUrgeState(state.extensions?.urge, now.getTime()), now.getTime(), this.urgeConfig, agencyCandidate.participantId)
          const capacityConfig = urgeBurst
            ? { ...this.agencyConfig, minimumProactiveIntervalMinutes: this.urgeConfig.contactMin }
            : modeRelaxed && this.agencyConfig.naturalMinimumIntervalMinutes! < this.agencyConfig.minimumProactiveIntervalMinutes
              ? { ...this.agencyConfig, minimumProactiveIntervalMinutes: this.agencyConfig.naturalMinimumIntervalMinutes! }
              : this.agencyConfig
          const capacity = evaluateAgencyCapacity(
            agencyWindow,
            agencyCandidate,
            now,
            capacityConfig,
            target?.state.lastCharacterMessageAt,
          )
          const willingness = agencyCandidate.willingness ?? 0
          const willingnessThreshold = modeRelaxed ? this.agencyConfig.naturalWillingnessThreshold! : (this.effectiveUrgeRuntime.proactiveWillingnessThreshold ?? 0.65)
          const willingnessPasses = willingness >= willingnessThreshold
          // 每日上限（全模式）：防自然模式下的高频打扰；触顶不排重查，交由下一次推进自然判断。
          const dailyCap = Math.max(0, this.agencyConfig.proactiveDailyCap ?? 3)
          const capPasses = dailyCap <= 0 || countProactiveContactsInWindow(state.proactiveContactLog, agencyCandidate.participantId, now) < dailyCap
          // M3/M4 endpoint policy belongs to the Agency decision boundary as
          // well as the final delivery boundary.  The action is the only
          // authoritative place where the model can explicitly choose a
          // participant endpoint; when omitted, preserve the legacy most-active
          // endpoint resolution and let the final sender perform the hard gate.
          const agencyAction = decision.crossConversationActions.find(action =>
            action.participantId === agencyCandidate!.participantId && action.mode === 'immediate')
          const candidateEndpointId = agencyAction?.endpointId
            ?? (agencyCandidate as unknown as { endpointId?: string }).endpointId
          let agencyEndpointReason: string | undefined
          let chosenEndpointId = candidateEndpointId
          try {
            await this.ensureEndpointRegistry()
            if (!chosenEndpointId) chosenEndpointId = this.resolveMostActiveEndpointId(agencyCandidate.participantId)
            if (chosenEndpointId) {
              const gated = this.endpointForDelivery(chosenEndpointId, { kind: 'participant-user', id: agencyCandidate.participantId })
              agencyEndpointReason = gated.reason
              if (!agencyEndpointReason) agencyEndpointReason = this.endpointInitiateGateReason(chosenEndpointId)
            }
          } catch (error) {
            agencyEndpointReason = 'endpoint-registry-unavailable'
            this.reportOperation('diagnostic', 'warn', story, phase,
              'Agency 端点注册表不可用，阻止主动联系 参与者=%s 端点=%s 错误=%s',
              agencyCandidate.participantId, chosenEndpointId ?? '(legacy)', error)
          }
          if (agencyEndpointReason) {
            // This is an operational route failure, not a character decision.
            // Keep it visible and classified so it cannot be mistaken for
            // willingness/capacity refusal in logs or recheck reasoning.
            this.reportOperation('standard', 'warn', story, phase,
              'Agency 端点门控阻止主动联系 参与者=%s 端点=%s 原因=%s',
              agencyCandidate.participantId, chosenEndpointId ?? '(legacy)', agencyEndpointReason)
          }
          const agencyPolicyAllows = !agencyEndpointReason
          agencyAllowsSend = agencyCandidate.outcome === 'send-now'
            && capacity.allowed && willingnessPasses && capPasses && agencyPolicyAllows
          if (!agencyAllowsSend) {
            agencyBlockReason = agencyEndpointReason
              ? `blocked-by-agency-endpoint:${agencyEndpointReason}`
              : agencyCandidate.outcome !== 'send-now'
                ? `model-outcome:${agencyCandidate.outcome}`
                : !capacity.allowed
                  ? `blocked-by-agency-capacity:${capacity.reason}`
                  : !willingnessPasses ? 'willingness-below-threshold' : 'proactive-daily-cap'
          }
          if (agencyAllowsSend && permitMessages) {
            // M3 §八：渠道选择审计——只有消息确实获准进入投递管线时，
            // 才记录主动联系；全局开关关闭时不能把策略放行误记成已联系。
            // 预记携带 ref：终态投递失败时作废该条，配额不因拦截/失败而空烧。
            proactiveContactRef = randomUUID()
            nextState.proactiveContactLog = appendProactiveContact(state.proactiveContactLog, agencyCandidate.participantId, now, chosenEndpointId, proactiveContactRef)
          }
          if (!agencyAllowsSend && agencyCandidate.outcome !== 'let-go' && willingnessPasses && capPasses) {
            agencyRecheck = {
              candidate: agencyCandidate,
              window: agencyWindow,
              reason: agencyEndpointReason ?? (capacity.allowed ? 'model-requested-recheck' : capacity.reason),
              at: proactiveRecheckAt(agencyCandidate, capacity, agencyWindow, now),
            }
          }
          this.reportOperation('standard', 'info', story, phase,
            'Agency 主动联系判断 参与者=%s 结果=%s 原因=%s 意愿=%s 阈值=%s 模式=%s',
            agencyCandidate.participantId,
            agencyAllowsSend ? '立即联系' : agencyRecheck ? '稍后重查' : '自然放下',
            agencyEndpointReason ?? capacity.reason,
            willingness.toFixed(2),
            willingnessThreshold.toFixed(2),
            this.agencyConfig.contactMode)
        }
        if (agencyWindow) {
          this.reportOperation('diagnostic', 'debug', story, phase,
            'Agency Window 更新 负荷=%s 隐私=%s 设备=%s 有效至=%s',
            agencyWindow.activityLoad, agencyWindow.privacy, agencyWindow.deviceAccess,
            formatLogTime(toDate(agencyWindow.validUntil), story.setting.timezone))
        }
      }
      await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState(nextState), updatedAt: now })
      if (alterTurn?.thresholdReached) this.scheduleAlterAnalysis(story.id, phase, alterTurn.sourceParticipantId)
    }

    if (agencyRecheck) {
      await this.appendProactiveCheck(story, agencyRecheck.candidate, agencyRecheck.at, agencyRecheck.reason, now)
    }

    const messages: OutgoingMessageDraft[] = []
    // proactive-check 回位的同类救援：Agency 通过但模型没输出 interaction.reply
    // → 从剧本 say 行动合成，与 advance 相位的 crossActions 合成对称。
    let interaction = isAgencyCheck
      ? agencyAllowsSend && decision.interaction?.reply?.mode === 'immediate' ? decision.interaction : undefined
      : decision.interaction
    if (isAgencyCheck && agencyAllowsSend && participant && (!interaction?.reply?.content)) {
      const synthesized = this.synthesizeCrossActionFromScript(decision, participant.id)
      if (synthesized) {
        this.reportOperation('standard', 'info', story, phase,
          'Agency 通过但模型未输出 interaction 回复，已从剧本 say 行动合成 参与者=%s', participant.id)
        interaction = { seen: false, reply: { mode: 'immediate', content: synthesized.content } }
      }
    }
    if ((phase === 'intent-due' || phase === 'user-message') && participant) {
      await this.deferUnresolvedDueFollowUps(story.id, participant.id, contextIntents, resolvedFollowUps, interaction, now)
    }
    const automaticDelivery = (isAutomaticNarrativePhase(phase) || this.urgeConfig.enabled && isAgencyCheck) && scriptEntry
      ? {
          summary: decision.automaticDeliverySummary || `Background delivery based on script #${scriptEntry.id}.`,
          sourceEntryId: scriptEntry.id,
        }
      : undefined
    if (participant && phase === 'user-message' && !isAgencyCheck && interaction?.seen) await this.markParticipantSeen(participant, now)
    if (participant && permitMessages && !immediateReplyAlreadyDelivered && interaction?.reply?.mode === 'immediate' && interaction.reply.content) {
      messages.push(attachMessageEvent({
        participantId: participant.id, content: interaction.reply.content, automaticDelivery,
        interaction: interaction ?? null, userInitiated: phase === 'user-message',
        // proactive-check 相位的放行回复就是这次主动联系本身：带 ref 供失败作废。
        ...(isAgencyCheck && agencyAllowsSend && proactiveContactRef ? { proactiveContactRef } : {}),
      }, commit ? findPrivateOutgoingMessageEvent(commit, participant.id, 'immediate', interaction.reply.content, this.config.runtime.messageSeparator) : undefined, scriptEntry?.id))
    }
    if (participant && permitMessages && interaction?.reply?.mode === 'delayed' && interaction.reply.content && interaction.reply.sendAt) {
      const sendAt = new Date(interaction.reply.sendAt)
      const delayedEndpointId = this.endpointRegistryReady ? this.resolveMostActiveEndpointId(participant.id) : undefined
      await this.appendIntent(story.id, {
        type: 'delayed-reply',
        summary: 'The character decided to send a delayed reply.',
        notBefore: interaction.reply.sendAt,
        payload: {
          content: interaction.reply.content,
          ...(delayedEndpointId ? { endpointId: delayedEndpointId } : {}),
          userInitiated: phase === 'user-message',
          interaction: true,
          ...(commit
              ? scriptEventPayload(attachMessageEvent(
                  { participantId: participant.id, content: interaction.reply.content, ...(delayedEndpointId ? { endpointId: delayedEndpointId } : {}) },
                  findPrivateOutgoingMessageEvent(commit, participant.id, 'delayed', interaction.reply.content, this.config.runtime.messageSeparator),
                  scriptEntry?.id,
                ))
            : {}),
        },
      }, now, participant.id)
      this.scheduleDueIntentWake(story.id, sendAt)
    }

    // A cross-account message is itself proactive from the target's point of
    // view. Allow it during a live user event, or during background work only
    // when the global proactive-message switch is enabled.
    let crossActions = phase === 'user-message'
      ? decision.crossConversationActions
      : phase === 'advance' && !this.agencyConfig.enabled && this.config.runtime.allowProactiveMessages
        ? decision.crossConversationActions
      : phase === 'advance' && agencyAllowsSend && agencyCandidate
        ? decision.crossConversationActions.filter(action => action.participantId === agencyCandidate!.participantId && action.mode === 'immediate').slice(0, 1)
        : []
    // Fix 3 后半：合成已在 Commit 前注入 decision.crossConversationActions，此处
    // Agency 过滤会自然保留或拦下它。仅当 proactive-check 相位（走 interaction
    // 路径而非 crossActions）时，仍需后置合成 interaction。
    if (phase === 'advance' && decision.crossConversationActions.length && !crossActions.length) {
      this.reportOperation('diagnostic', 'debug', story, phase,
        'Agency 拒绝未通过容量或来源验证的 crossConversationAction 数量=%d', decision.crossConversationActions.length)
    }
    // 门控拦截补偿:被拦下的即时私聊行动从未进入投递管线,投递失败路径
    // (recordOutgoingDeliveryFailure)不会覆盖它们;若不在此记账,剧本账本将
    // 永久停留 pending,后续轮次模型只看到"剧本已说"而认为消息已发出。
    if (phase === 'advance') {
      const withdrawn = decision.crossConversationActions.filter(action => action.mode === 'immediate'
        && !action.participantId.startsWith('group:')
        && !crossActions.includes(action))
      if (withdrawn.length) {
        const reason = !this.agencyConfig.enabled
          ? 'proactive-messages-not-allowed'
          : agencyBlockReason ?? (agencyCandidate ? 'not-selected-by-agency' : 'no-agency-candidate')
        await this.recordWithdrawnOutgoingEvents(story, withdrawn, commit, scriptEntry, reason, now, phase)
      }
      // 解析层丢弃补偿：意愿门丢掉的主动行动从未生成事件（commit 构建在
      // 归一化之后），无账本可撤——只补"从未发送"历史条目。不传 commit，
      // 避免按内容反查时误撤同参与者存活行动的账本分段。
      const dropped = decision.droppedProactiveActions ?? []
      if (dropped.length) {
        const byReason = new Map<string, Array<{ participantId: string, content: string }>>()
        for (const item of dropped) {
          const group = byReason.get(item.reason) ?? []
          group.push({ participantId: item.participantId, content: item.content })
          byReason.set(item.reason, group)
        }
        for (const [reason, group] of byReason) {
          await this.recordWithdrawnOutgoingEvents(story, group, undefined, scriptEntry, reason, now, phase)
        }
        this.reportOperation('standard', 'info', story, phase,
          '主动行动被解析层意愿门丢弃，已记入未发送账本 数量=%d 原因=%s',
          dropped.length, [...byReason.keys()].join(','))
      }
    }
    // proactive-check uses interaction.reply rather than crossConversationActions.
    // It is still a script-bound outgoing event, so an Agency rejection (or a
    // disabled proactive-message policy) must close its pending ledger instead
    // of leaving a false impression that the message was sent.
    if (isAgencyCheck && participant && !immediateReplyAlreadyDelivered && commit && scriptEntry) {
      const withdrawn = commit.events
        .filter(event => event.kind === 'outgoing-message'
          && event.participantId === participant.id
          && (event.deliveryMode === 'delayed' || !agencyAllowsSend || !permitMessages))
        .map(event => ({
          participantId: participant.id,
          content: event.content ?? event.bubbles?.join(this.config.runtime.messageSeparator) ?? '',
          event,
        }))
        .filter(action => !!action.content)
      if (withdrawn.length) {
        const reason = !permitMessages
          ? 'proactive-messages-not-allowed'
          : !agencyAllowsSend
            ? agencyBlockReason ?? (agencyCandidate ? 'not-selected-by-agency' : 'no-agency-candidate')
            : 'proactive-delayed-reply-not-scheduled'
        await this.recordWithdrawnOutgoingEvents(story, withdrawn, commit, scriptEntry, reason, now, phase)
      }
    }
    const approvedAutomaticOutgoingActions = phase === 'advance'
      ? crossActions
        .filter(action => action.mode === 'immediate')
        .map(action => ({ participantId: action.participantId, mode: action.mode }))
      : []
    // Keep a compact record of actions that passed the local policy gate. The
    // actual visible receipt is written only after transport succeeds.
    if (scriptEntry && approvedAutomaticOutgoingActions.length) {
      await this.dbSet('interlude_script_entry', { id: scriptEntry.id }, {
        metadata: {
          ...scriptEntry.metadata,
          approvedAutomaticOutgoingActions,
        },
      })
    }
    for (const action of crossActions) {
      if (action.mode === 'immediate') {
        if (action.participantId.startsWith('group:')) {
          // Use the shared delivery queue so background turns do not discard
          // group sends, and keep the originating event for receipt projection.
          messages.push(attachMessageEvent({
            participantId: action.participantId, content: action.content, endpointId: action.endpointId, userInitiated: phase === 'user-message',
          }, commit ? findGroupScriptEvent(commit) : undefined, scriptEntry?.id))
          continue
        }
        // P2 Fix: 主动联系计数移到投递结果处——加入数组不等于发送成功。
        messages.push(attachMessageEvent({
          participantId: action.participantId, content: action.content, endpointId: action.endpointId, automaticDelivery,
          interaction: interaction ?? null, userInitiated: phase === 'user-message',
          // Agency 放行的那一条带 ref：投递终态失败时按 ref 作废预记的配额。
          ...(phase === 'advance' && agencyAllowsSend && agencyCandidate && action.participantId === agencyCandidate.participantId && proactiveContactRef ? { proactiveContactRef } : {}),
        }, commit ? findPrivateOutgoingMessageEvent(commit, action.participantId, 'immediate', action.content, this.config.runtime.messageSeparator) : undefined, scriptEntry?.id))
        this.pendingProactiveCount++
      } else {
        const sendAtValue = (action as { sendAt?: string }).sendAt
        if (action.mode !== 'delayed' || !sendAtValue) continue
        const sendAt = new Date(sendAtValue)
        await this.appendIntent(story.id, {
          type: 'cross-conversation-message', summary: 'The character planned a message to another relationship branch.',
          notBefore: sendAtValue, payload: {
            content: action.content, endpointId: action.endpointId, userInitiated: false, crossConversation: true,
            willingness: action.willingness, reason: action.reason,
            ...(commit
              ? scriptEventPayload(attachMessageEvent(
                  { participantId: action.participantId, content: action.content, endpointId: action.endpointId },
                  findPrivateOutgoingMessageEvent(commit, action.participantId, 'delayed', action.content, this.config.runtime.messageSeparator),
                  scriptEntry?.id,
                ))
              : {}),
          },
        }, now, action.participantId)
        this.scheduleDueIntentWake(story.id, sendAt)
      }
    }

    // A visible message is confirmed only after transport succeeds. Keep later
    // bubbles in memory until the first bubble arrives; every bubble retains
    // the identity of the script event from which it was derived.
    const prepared = messages
      .map(message => message.participantId.startsWith('group:') ? message : prepareOutgoingDelivery(message, this.splitOutgoingMessage(message.content)))
      .filter((message): message is OutgoingMessageDraft => !!message)
    if (this.urgeConfig.enabled && scriptEntry && (isAutomaticNarrativePhase(phase) || phase === 'intent-due' && !contextIntents.some(intent => intent.type === 'narrative-retry'))) {
      try {
        const current = await this.getStory(story.id)
        const state = decodeStoryState(current.state)
        const target = agencyAllowsSend && agencyCandidate && prepared.some(message => message.participantId === agencyCandidate!.participantId)
          ? agencyCandidate.participantId : undefined
        const urge = commitUrge(normalizeUrgeState(state.extensions?.urge, now.getTime()), raw.urge, decision.script || '', scriptEntry.id, target, now.getTime(), this.urgeConfig)
        // 主叙事轻量节奏覆盖:模型在 urge 交接里带 rhythmAttention 时写入 lifeRhythm,
        // 比等下一次压缩更即时(source: narrator)。
        const rawUrge = raw.urge as Record<string, unknown> | undefined
        const rhythmOverride = urge.rhythmAttention && typeof rawUrge?.rhythmAttention === 'string'
          ? {
              attention: urge.rhythmAttention as 'phone-focused' | 'available' | 'occupied' | 'resting' | 'asleep',
              basis: '主叙事交接覆盖',
              assessedAt: now.toISOString(),
              source: 'narrator' as const,
            }
          : undefined
        await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState({
          ...state,
          extensions: { ...state.extensions, urge },
          ...(rhythmOverride ? { lifeRhythm: rhythmOverride } : {}),
        }), updatedAt: now })
      } catch (error) {
        // Optional scheduling projection must never swallow already committed speech.
        this.reportStandalone('warn', 'Urge 调度交接保存失败，保留既有剧本与投递 错误=%s', error)
      }
    }
    // 长线指导：剧本提交成功后异步扫描（不阻塞主回合）。DB 抖动沿浮动
    // promise 逃逸会变成 unhandledRejection，必须就地吸收。
    void this.longHorizonSweep(story, now).catch(error =>
      this.reportStandalone('warn', '长线扫描失败，保留既有剧本与投递 错误=%s', error))
    return { messages: prepared, commit, scriptEntry }
  }

  /** Keep the active-scene anchor in sync with the host ledger immediately,
   * rather than waiting for prose compaction to reconcile an already-completed
   * automatic window. */
  private async persistTimelineSceneAnchor(storyId: string, handoff: ReturnType<typeof normalizeLifeHandoff>, entryId: number, now: Date) {
    const scene = await this.activeScene(storyId)
    const anchor = handoff?.activity ?? handoff?.place
    if (!scene || !anchor) return
    await this.dbSet('interlude_scene', { id: scene.id }, {
      hook: clip(`Original #${entryId}: ${anchor.quote}`, this.memoryConfig.sceneHookCharacters),
      // The background editor owns the scene/arc summary and checkpoint.
      updatedAt: now,
    })
  }

  async adminSchedulePreplan(storyId: string) {
    return this.getSchedulePreplan(storyId)
  }

  async requestSchedulePreplanRebuild(storyId: string) {
    const current = await this.getSchedulePreplan(storyId)
    if (!current) return false
    await this.dbSet('interlude_schedule_preplan', { storyId }, {
      lastReviewedLocalDate: '', validThrough: '1970-01-01', reviewReason: 'Administrator requested a rebuild.', updatedAt: new Date(),
    })
    this.scheduleCompaction(storyId)
    return true
  }

  private get alterSystemConfig(): AlterSystemConfig {
    return this.cachedAlterSystemConfig ??= resolveAlterSystemConfig(this.config.alterSystem)
  }

  private get agencyConfig(): AgencyConfig {
    return this.cachedAgencyConfig ??= resolveAgencyConfig(this.config.agency)
  }

  private get schedulePreplanConfig(): SchedulePreplanConfig {
    return this.cachedSchedulePreplanConfig ??= resolveSchedulePreplanConfig(this.config.schedulePreplan)
  }

  private get blindModeConfig(): BlindModeConfig {
    return this.cachedBlindModeConfig ??= resolveBlindModeConfig(this.config.blindMode ?? this.config.blackBox)
  }

  private emotionalOffsetForPrompt(story: InterludeStory): EmotionalOffsetPrompt | null {
    return emotionalOffsetForPrompt(normalizeAlterSystemState(story.state.alterSystem), this.alterSystemConfig)
  }

  private updateAlterSystem(
    story: InterludeStory,
    current: AlterSystemState | undefined,
    alter: number | undefined,
    phase: NarrativeRequest['phase'],
    now: Date,
    participantId = '',
  ): AlterTurnResult | undefined {
    const config = this.alterSystemConfig
    if (!config.enabled || alter === undefined) return undefined
    const result = advanceAlterSystem(current, alter, phase, now, config, participantId)
    if (result.offsetExpired) this.reportOperation('standard', 'info', story, phase, 'Alter 情绪偏移已自然消退')
    this.reportOperation('diagnostic', 'debug', story, phase,
      'Alter 状态已更新 来源=%s 本轮=%s 累计=%s 阈值=%s 权重=%s', result.sourceParticipantId || '主角生活', alter, result.triggerValue, result.threshold.toFixed(2), result.state.alterWeight.toFixed(2))
    return result
  }

  private scheduleAlterAnalysis(storyId: string, phase: NarrativeRequest['phase'], participantId = '') {
    const taskKey = `${storyId}\u0000${participantId}`
    if (this.scheduledAlterAnalyses.has(taskKey)) return
    this.scheduledAlterAnalyses.add(taskKey)
    this.ctx.setTimeout(() => {
      // 模型调用不再占用故事串行队列:analyzeAlterSystem 自管三阶段(锁内快照→锁外请求→锁内复查提交)
      void this.analyzeAlterSystem(storyId, phase, participantId)
        .catch(error => this.reportStandalone('warn', 'Alter 后台分析任务失败 故事=%s 错误=%s', storyId, error))
        .finally(() => this.scheduledAlterAnalyses.delete(taskKey))
    }, 0)
  }

  private async analyzeAlterSystem(storyId: string, phase: NarrativeRequest['phase'], participantId = '') {
    const config = this.alterSystemConfig
    if (!config.enabled) return
    // 阶段一(串行):校验阈值/冷却,标记分析尝试(5 分钟防抽),取剧本快照与任务代次
    const prepared = await this.serial(storyId, async () => {
      if (this.desktopRuntimePhase === 'paused' || this.databaseResetting) return undefined
      const story = await this.getStory(storyId)
      if (!story || story.status !== 'active') return undefined
      const state = normalizeAlterSystemState(story.state.alterSystem)
      if (!state) return undefined
      const now = new Date()
      const history = alterHistoryForScope(state.history, participantId)
      const triggerValue = alterScopeValue(state, participantId)
      const threshold = calculateAlterThreshold(history, config, now)
      if (Math.abs(triggerValue) < threshold || alterScopeCoolingDown(state, participantId, now)) return undefined
      const marked = markAlterScopeAnalysisAttempt(state, participantId, now)
      await this.dbSet('interlude_story', { id: story.id }, {
        state: encodeStoryState({ ...decodeStoryState(story.state), alterSystem: marked }), updatedAt: now,
      })
      if (!this.narrator.analyzeAlter) {
        this.report('warn', story, phase, 'Alter 已达到阈值，但当前叙事服务不支持侧端分析；保留累计值等待重试')
        return undefined
      }
      const scripts = (await this.recentEntries(story.id, 50))
        .filter(entry => entry.kind === 'script' && entry.content.trim()
          && (participantId ? !entry.participantId || entry.participantId === participantId : !entry.participantId))
        .slice(-10)
        .map(entry => ({ content: entry.content.slice(0, 4_000), occurredAt: entry.occurredAt.toISOString() }))
      return { story, scripts, history, triggerValue, threshold, state, generation: this.taskGeneration(storyId) }
    })
    if (!prepared) return
    const { story, scripts, history, triggerValue, threshold, state, generation } = prepared
    const triggerDirection = Math.sign(triggerValue) as -1 | 1
    try {
      this.reportOperation('standard', 'info', story, phase,
        'Alter 累积触发 数值=%s 阈值=%s 方向=%s', signedNumber(triggerValue), threshold.toFixed(2), triggerDirection > 0 ? '严肃' : '放松')
      // 阶段二(串行外):模型调用不占用故事队列,消息处理/提交不再被后台分析拖住
      const result = await this.narrator.analyzeAlter({
        characterName: story.setting.character.name,
        triggerValue,
        threshold,
        direction: triggerDirection > 0 ? 'serious' : 'relaxed',
        recentScripts: scripts,
        history: history.slice(-10),
        settingOverlay: story.state.settingOverlay,
        currentOffset: state.emotionalOffset ? { ...state.emotionalOffset, weight: state.alterWeight } : null,
      }, config)
      const description = result.description.trim().slice(0, 800)
      if (!description) throw new Error('Alter analysis returned an empty description.')
      // 阶段三(串行):运行代次/暂停复查 + 基于最新状态合并落库(不覆盖期间写入)
      await this.serial(storyId, async () => {
        if (this.desktopRuntimePhase === 'paused' || this.databaseResetting) {
          this.reportOperation('diagnostic', 'debug', story, phase, 'Alter 分析结果丢弃：运行已暂停或数据库重置')
          return
        }
        if (!this.taskGenerationCurrent(storyId, generation)) {
          this.reportOperation('diagnostic', 'debug', story, phase, 'Alter 分析结果丢弃：任务代次已失效')
          return
        }
        const fresh = await this.getStory(storyId)
        if (!fresh || fresh.status !== 'active') return
        const freshAlter = normalizeAlterSystemState(fresh.state.alterSystem)
        if (!freshAlter) return
        const pendingValue = alterScopeValue(freshAlter, participantId)
        if (Math.sign(pendingValue) !== triggerDirection || Math.abs(pendingValue) < threshold) {
          await this.dbSet('interlude_story', { id: fresh.id }, {
            state: encodeStoryState({ ...decodeStoryState(fresh.state), alterSystem: clearAlterScopeAnalysisAttempt(freshAlter, participantId) }), updatedAt: new Date(),
          })
          this.reportOperation('diagnostic', 'debug', story, phase, 'Alter 分析结果丢弃：当前累计已反向或不足触发阈值；保留全部未消费分数')
          return
        }
        const completed = completeAlterAnalysis(freshAlter, description, threshold, new Date(), config, participantId, triggerValue)
        await this.dbSet('interlude_story', { id: fresh.id }, {
          state: encodeStoryState({ ...decodeStoryState(fresh.state), alterSystem: completed }), updatedAt: new Date(),
        })
        this.reportOperation('standard', 'info', story, phase,
          '情绪偏移生成完成 方向=%s 强度=%s 描述=%s', completed.emotionalOffset.direction, completed.emotionalOffset.intensity.toFixed(2), description)
        this.reportOperation('standard', 'info', story, phase, '情绪偏移已注入后续主提示词 权重=1.00')
      })
    } catch (error) {
      this.report('warn', story, phase, 'Alter 分析失败，已保留累计值等待重试：%s', error)
    }
  }

  private async appendEntry(storyId: string, entry: ScriptEntryDraft, now: Date, participantId = '') {
    const occurredAt = toDate(entry.occurredAt) ?? now
    const created = await this.dbCreate('interlude_script_entry', {
      storyId, participantId, kind: clip(entry.kind, 32) || 'life', actor: clip(entry.actor ?? 'character', 32),
      content: entry.kind === 'script' ? String(entry.content ?? '') : clip(entry.content, 12_000), occurredAt,
      metadata: isRecord(entry.metadata) ? entry.metadata : {}, createdAt: now,
    })
    // Scene entry counts are derived during compaction. Avoiding a second
    // SQLite write here keeps every durable script append atomic and cheap.
    const row = normalizeDatabaseRow('interlude_script_entry', created) as ScriptEntry
    const recallCache = this.historyVectors.get(storyId)
    if (recallCache && RECALLABLE_ENTRY_KINDS.includes(row.kind)) {
      recallCache.set(row.id, {
        tags: Object.values(groundedEpisodeTags(row.content, (row.metadata?.episodeTags ?? {}) as Record<string, unknown>)).flat(),
        checkpoint: row.metadata?.sceneCheckpoint as HistoryVectorEntry['checkpoint'],
        frameId: typeof row.metadata?.frameId === 'string' ? row.metadata.frameId : undefined,
        ...(row.embedding?.length ? { vector: row.embedding } : {}),
        content: promptVisibleMessageContent(row.content, recentScriptOwnership(row)),
        occurredAt: row.occurredAt.toISOString(), participantId: row.participantId, kind: row.kind,
      })
    }
    return row
  }

  private async appendMemory(storyId: string, memory: MemoryDraft, now: Date, participantId = '', sourceEntryId?: number) {
    await this.dbCreate('interlude_memory', {
      storyId, participantId, category: clip(memory.category, 32) || 'fact', content: clip(memory.content, 4_000),
      importance: clampNumber(memory.importance, 0.5, 0, 1), status: 'active', sourceEntryId: sourceEntryId ?? null,
      createdAt: now, updatedAt: now,
    })
  }

  /**
   * Retrieves the smallest useful slice of durable facts. When an embedding
   * model is available, semantic relevance is combined with narrative quality
   * signals instead of replacing them; a failed vector lookup simply has a
   * semantic score of zero for this turn.
   */
  private async contactThreads(storyId: string, selected: NarrativeFact[], participantId?: string) {
    const rows = await this.dbGet('interlude_fact', { storyId, status: 'active' }, {
      limit: 1_000, sort: { updatedAt: 'desc' },
    }) as NarrativeFact[]
    // Durable facts are global narrative evidence. The participant argument
    // below is only used when limiting access to the original source entries.
    const visible = rows
    const contact = (fact: NarrativeFact) => fact.scope === 'promise'
      || ['proposal', 'conditional', 'confirmed'].includes(fact.knowledge?.mode ?? '')
    const seeds = [...selected.filter(fact => contact(fact)),
      ...visible.filter(fact => contact(fact) && fact.unresolved)].filter((fact, i, all) => all.findIndex(f => f.id === fact.id) === i).slice(0, 4)
    const linkedIds = [...new Set(seeds.flatMap(fact => knowledgeRelatedIds(fact.knowledge)))].filter(id => !visible.some(fact => fact.id === id))
    if (linkedIds.length) {
      const archived = await this.dbGet('interlude_fact', { storyId, id: { $in: linkedIds } }) as NarrativeFact[]
      visible.push(...archived)
    }
    const chain = new Map<number, NarrativeFact>()
    for (const seed of seeds) {
      chain.set(seed.id, seed)
      const seedRelated = knowledgeRelatedIds(seed.knowledge)
      const candidates = visible.filter(fact => fact.id !== seed.id
        && (seedRelated.includes(fact.id) || knowledgeRelatedIds(fact.knowledge).includes(seed.id)
          || seed.knowledge?.topic && fact.knowledge?.topic === seed.knowledge.topic
          || !seed.knowledge && historyLexicalScore(seed.content, fact.content) >= 0.2))
        .sort((a, b) => Number(seedRelated.includes(b.id)) - Number(seedRelated.includes(a.id))
          || historyLexicalScore(seed.content, b.content) - historyLexicalScore(seed.content, a.content))
      const related = seed.knowledge ? candidates.slice(0, 3)
        : [...candidates.filter(fact => legacyConditionCue(fact.content)).slice(0, 2), ...candidates.slice(0, 2)]
      for (const fact of related) chain.set(fact.id, fact)
    }
    const facts = [...chain.values()].slice(0, 12)
    const sourceIds = [...new Set(facts.flatMap(fact => [...fact.sourceEntryIds, ...knowledgeClauses(fact.knowledge).map(c => c.sourceEntryId)]))]
    if (!sourceIds.length) return []
    const ids = [...new Set(sourceIds.flatMap(id => [id - 2, id - 1, id, id + 1, id + 2]).filter(id => id > 0))]
    const entries = ((await this.dbGet('interlude_script_entry', { storyId, id: { $in: ids } })) as ScriptEntry[])
      .filter(entry => entry.kind !== 'redacted')
    // Keep whole originals. Omitted sources stay explicitly missing, never summarized into certainty.
    let budget = 12_000
    const sourceOrder = new Map(sourceIds.map((id, index) => [id, index]))
    const bounded = entries.filter(entry => !entry.participantId || entry.participantId === participantId)
      .sort((a, b) => (sourceOrder.get(a.id) ?? Infinity) - (sourceOrder.get(b.id) ?? Infinity) || a.id - b.id)
      .filter(entry => { if (entry.content.length > budget) return false; budget -= entry.content.length; return true })
    // A fact without any source text visible in this branch must not become a
    // fact-only contact thread. The fact itself remains available through the
    // global durableFacts lane; this lane is specifically for restoring the
    // original proposal/condition/reply evidence. In particular, background
    // calls without a participant must not accidentally expose private source
    // entries just because the fact row is global.
    if (!bounded.length) return []
    return contactEvidenceThreads(facts, bounded)
  }

  /** Durable facts are global narrative evidence. The legacy participantId argument
   * is retained for call-site compatibility but intentionally ignored. */
  async facts(storyId: string, limit = this.memoryConfig.factLimit, query = '', _participantId?: string, turnQueryEmbedding?: number[]) {
    // The previous floor of 50 caused every live turn to scan a large slice of
    // the facts table, even when the narrator only needed a handful of facts.
    // Keep enough candidates for semantic re-ranking without making the
    // latency-sensitive path do unnecessary database work.
    // Existing stories may contain more rows than a newly configured cap. A
    // broad bounded pool prevents an exact old fact from becoming unreachable
    // merely because 120 more-important rows sort ahead of it.
    const candidateLimit = Math.max(300, Math.min(Math.max(limit * 10, this.memoryConfig.maxFactsPerStory * 3), 1_000))
    const laneLimit = Math.max(1, Math.min(5, Math.floor(limit / 4) || 1))
    const [rows, recentResolvedEvents, openPromises] = await Promise.all([
      this.dbGet('interlude_fact', { storyId, status: 'active' }, {
        limit: candidateLimit, sort: { importance: 'desc', updatedAt: 'desc' },
      }),
      this.dbGet('interlude_fact', { storyId, status: 'active', scope: 'event', unresolved: false }, {
        limit: laneLimit * 2, sort: { updatedAt: 'desc' },
      }),
      this.dbGet('interlude_fact', { storyId, status: 'active', scope: 'promise', unresolved: true }, {
        limit: laneLimit * 2, sort: { updatedAt: 'desc' },
      }),
    ])
    // Live embedding adds an extra HTTP request to every user turn. Keep it
    // opt-in; stored fact vectors and background backfill still work normally.
    // A precomputed turn-level vector is preferred when the caller already
    // built one, so multiple semantic consumers share a single request.
    const queryEmbedding = turnQueryEmbedding?.length
      ? turnQueryEmbedding
      : query.trim() && this.config.model.embedding?.liveQuery
        ? await this.embedText(query)
        : []
    const ranked = rows
      .map(fact => ({ fact, score: factScore(fact, this.memoryConfig, queryEmbedding, query) }))
      .sort((a, b) => b.score - a.score
        || b.fact.updatedAt.getTime() - a.fact.updatedAt.getTime()
        || b.fact.id - a.fact.id)
      .map(item => item.fact)
    const selected: NarrativeFact[] = []
    const seen = new Set<number>()
    for (const fact of [
      ...recentResolvedEvents.slice(0, laneLimit),
      ...openPromises.slice(0, laneLimit),
      ...ranked,
    ]) {
      if (seen.has(fact.id)) continue
      seen.add(fact.id)
      selected.push(fact)
      if (selected.length >= limit) break
    }
    return selected
  }

  /** Returns only observations that are safe for this narration branch. A
   * participant's browsing is not shown to another private participant unless
   * the owner has explicitly enabled shared relationship details. */
  private async webObservations(storyId: string, participantId?: string) {
    // Browsing is optional. Avoid a database read on every live turn when the
    // feature is disabled, which is the default for most installations.
    if (!this.browserConfig.enabled) return []
    const limit = Math.max(1, Math.min(this.browserConfig.maxObservationsInPrompt, 20))
    const rows = await this.dbGet('interlude_web_observation', { storyId }, {
      limit: Math.max(limit * 4, 20), sort: { accessedAt: 'desc' },
    })
    return rows
      // Failed/blocked attempts already have a terse script event. Keeping
      // their error text in every later prompt wastes tokens and can crowd
      // out useful successful observations.
      .filter(observation => observation.status === 'success')
      .filter(observation => this.sharedStoryConfig.shareParticipantDetails
        || !observation.participantId || observation.participantId === (participantId ?? ''))
      .slice(0, limit)
      .reverse()
  }

  async activeScene(storyId: string): Promise<InterludeScene | null> {
    const rows = await this.dbGet('interlude_scene', { storyId, status: 'active' }, {
      limit: 1,
      sort: { updatedAt: 'desc' },
    })
    return rows[0] ?? null
  }

  async activeArc(storyId: string): Promise<InterludeArc | null> {
    const rows = await this.dbGet('interlude_arc', { storyId, status: 'active' }, {
      limit: 1,
      sort: { updatedAt: 'desc' },
    })
    return rows[0] ?? null
  }

  private async appendIntent(storyId: string, intent: IntentDraft, now: Date, participantId = '') {
    const notBefore = toDate(intent.notBefore)
    const payload = isRecord(intent.payload) ? intent.payload : {}
    const context = currentDesktopProcessingContext()
    // Persist the bridge correlation at the intent boundary as a last line of
    // defence. Most visible messages already carry it through attachMessageEvent,
    // but delayed/background intents can be created without a script commit.
    // Keeping this fallback here prevents those paths from silently losing the
    // processing identity while preserving an explicit valid payload value.
    const persistedContext = persistedDesktopProcessingContext(payload)
    const correlationPayload = {
      ...payload,
      ...(context && !persistedContext.traceId ? { traceId: context.traceId } : {}),
      ...(context && !persistedContext.processingId ? { processingId: context.processingId } : {}),
    }
    const activeConsequence = isActiveConsequenceDraft(intent)
    if (activeConsequence && !this.memoryConfig.activeConsequencesEnabled) return
    const requestedExpiresAt = activeConsequence ? consequenceExpiresAt(payload) : undefined
    const maxLifetime = Math.max(1, this.memoryConfig.activeConsequenceMaxDays) * Time.day
    const expiresAt = requestedExpiresAt && requestedExpiresAt > now
      ? new Date(Math.min(requestedExpiresAt.getTime(), now.getTime() + maxLifetime))
      : undefined
    // Scheduled plans always remain future-facing. An active consequence is
    // different: it is a present condition caused by something already in
    // the script, so it begins at now and only needs a bounded expiry.
    if (!notBefore || (!activeConsequence && notBefore <= now) || (activeConsequence && !expiresAt)) return
    const normalizedPayload = activeConsequence ? {
      ...correlationPayload,
      strength: consequenceStrength(correlationPayload, this.memoryConfig.activeConsequenceDefaultStrength),
      expiresAt: expiresAt!.toISOString(),
    } : correlationPayload
    await this.dbCreate('interlude_intent', {
      storyId, participantId, type: clip(intent.type, 32) || 'follow-up', summary: clip(intent.summary, 4_000), notBefore,
      status: 'pending', payload: normalizedPayload, createdAt: now, updatedAt: now,
    })
  }

  /** Active consequences share the intent table but are never scheduler work.
   * Their payload keeps the lifecycle explicit so old scheduled intents keep
   * their existing behaviour without a migration. */
  private async activeConsequencesAndExpire(storyId: string, now: Date, participantId?: string) {
    if (!this.memoryConfig.activeConsequencesEnabled) return []
    const rows = await this.dbGet('interlude_intent', { storyId, status: 'pending' }, {
      limit: 100, sort: { updatedAt: 'desc' },
    })
    const consequences = rows.filter(isActiveConsequence)
    const expired = consequences.filter(intent => (consequenceExpiresAt(intent.payload)?.getTime() ?? 0) <= now.getTime())
    if (expired.length) {
      await this.dbSet('interlude_intent', { id: { $in: expired.map(intent => intent.id) } }, { status: 'completed', updatedAt: now })
    }
    return rows
      .filter(isActiveConsequence)
      .filter(intent => intent.notBefore <= now)
      .filter(intent => {
        const expiresAt = consequenceExpiresAt(intent.payload)
        return !!expiresAt && expiresAt > now
      })
      .filter(intent => participantId === undefined || !intent.participantId || intent.participantId === participantId)
      .sort((left, right) => consequenceStrength(right.payload) - consequenceStrength(left.payload)
        || right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, Math.max(1, this.memoryConfig.activeConsequencePromptLimit))
  }

  /** Only active consequences visible to the writer may be resolved. This
   * prevents a remote model from changing arbitrary future plans by id. */
  private async applyIntentUpdates(storyId: string, updates: ReturnType<typeof normalizeIntentUpdates>, now: Date, participantId?: string) {
    if (!updates.length) return false
    const ids = updates.map(update => update.id)
    const rows = await this.dbGet('interlude_intent', { storyId, id: { $in: ids }, status: 'pending' })
    const allowed = new Map(rows
      .filter(isActiveConsequence)
      .filter(intent => !participantId || !intent.participantId || intent.participantId === participantId)
      .map(intent => [intent.id, intent]))
    let changed = false
    for (const update of updates) {
      const intent = allowed.get(update.id)
      if (!intent) continue
      const payload = {
        ...intent.payload,
        ...(update.resolution ? { resolution: update.resolution } : {}),
      }
      await this.dbSet('interlude_intent', { id: intent.id }, { status: update.status, payload, updatedAt: now })
      changed = true
    }
    return changed
  }

  /** Stores a narrator-proposed browser action as a future intent. The model
   * never writes page content directly; a separate Puppeteer task creates the
   * observation later. */
  private async appendBrowserIntent(storyId: string, draft: BrowserIntentDraft, now: Date, fallbackParticipantId = '') {
    const config = this.browserConfig
    if (!config.enabled) return
    const normalized = normalizeBrowserIntentDraft(draft, config)
    if (!normalized) return
    // A model may describe a reason involving another person, but it may not
    // silently attach a web observation to another relationship branch. The
    // active participant owns a live-turn browse; unattended life browsing is
    // world-level. This is both a privacy boundary and a simpler mental model.
    const participantId = fallbackParticipantId
    const allowedParticipant = participantId ? await this.getParticipant(participantId) : undefined
    if (participantId && (!allowedParticipant || !this.canHandleParticipant(allowedParticipant))) return
    const notBefore = new Date(now.getTime() + Time.second)
    await this.appendIntent(storyId, {
      type: 'browser-research',
      summary: clip(normalized.purpose, 500) || 'The character planned to read a public web page.',
      notBefore: notBefore.toISOString(),
      payload: {
        mode: normalized.mode,
        query: normalized.query ?? '',
        url: normalized.url ?? '',
        purpose: normalized.purpose,
      },
    }, now, participantId)
    this.reportStandaloneOperation('diagnostic', 'debug', '已创建网页浏览意图：故事=%s 模式=%s', storyId, normalized.mode)
  }

  /** Executes a due browser intent once, records its bounded observation, and
   * marks the future plan complete regardless of success. A failed browser is
   * still an event (the character could not access the page), but it never
   * blocks later dialogue or background life updates. */
  private async executeDeferredBrowserIntent(story: InterludeStory, intent: NarrativeIntent, now: Date) {
    const payload = browserIntentFromPayload(intent.payload)
    const observation = await this.collectWebObservation(story, payload, intent.participantId, intent.id, now)
    await this.dbSet('interlude_intent', { id: intent.id }, { status: 'completed', updatedAt: new Date() })
    return observation
  }

  /** Read a page through Koishi Puppeteer. This is intentionally read-only:
   * it rejects non-public destinations, extracts visible text only, and closes
   * the page after every observation. */
  private async collectWebObservation(story: InterludeStory, draft: BrowserIntentDraft | null, participantId: string, intentId: number | null, now: Date, persist = true): Promise<WebObservation> {
    const config = this.browserConfig
    const normalized = draft ? normalizeBrowserIntentDraft(draft, config) : undefined
    if (!normalized || !config.enabled) {
      return this.saveWebObservation(story.id, participantId, intentId, normalized?.mode ?? 'visit', normalized?.query ?? '', normalized?.url ?? '', '', '', '浏览未执行：功能未启用或请求不符合安全规则。', 'blocked', now, persist)
    }

    const target = resolveBrowserTarget(normalized, config)
    if (!target) {
      this.report('warn', story, 'intent-due', '网页浏览被安全策略拦截：模式=%s', normalized.mode)
      return this.saveWebObservation(story.id, participantId, intentId, normalized.mode, normalized.query ?? '', normalized.url ?? '', '', '', '浏览目标未通过公开网页安全校验。', 'blocked', now, persist)
    }

    const cached = await this.findCachedWebObservation(story.id, participantId, normalized, now)
    if (cached) {
      if (!persist) return { ...cached, id: 0, intentId, accessedAt: now, createdAt: now }
      await this.appendEntry(story.id, {
        kind: 'web-observation', actor: 'system',
        content: `The character revisited a recent web observation: ${cached.title || cached.url}.`,
        occurredAt: now.toISOString(), metadata: { observationId: cached.id, cached: true, status: cached.status },
      }, now, participantId)
      return cached
    }

    const puppeteer = (this.ctx as any).puppeteer
    if (!puppeteer?.page) {
      this.report('warn', story, 'intent-due', '网页浏览服务不可用：请安装并启用 koishi-plugin-puppeteer。')
      return this.saveWebObservation(story.id, participantId, intentId, normalized.mode, normalized.query ?? '', target, '', '', '浏览器服务不可用。', 'failed', now, persist)
    }

    return this.withBrowserSlot(async () => {
      let page: any
      try {
        page = await puppeteer.page()
        await page.setUserAgent(`Mozilla/5.0 (compatible; HDS-Interlude/${HDS_INTERLUDE_VERSION}; +https://koishi.chat/)`)
        await page.setRequestInterception(true)
        page.on('request', (request: any) => {
          const resourceType = request.resourceType?.() ?? 'document'
          const requestUrl = request.url?.() ?? ''
          const allowedResource = ['document', 'stylesheet', 'script', 'xhr', 'fetch', 'image'].includes(resourceType)
          const allowedUrl = isSafePublicWebUrl(requestUrl, config)
          const operation = allowedResource && allowedUrl ? request.continue() : request.abort('blocked')
          void Promise.resolve(operation).catch(() => undefined)
        })
        page.on('popup', (popup: any) => void popup.close().catch(() => undefined))
        await page.goto(target, { waitUntil: config.waitUntil, timeout: config.navigationTimeout })
        const finalUrl = String(page.url?.() ?? target)
        if (!isSafePublicWebUrl(finalUrl, config)) throw new Error('页面重定向到了不允许的地址。')
        const result = await page.evaluate(() => ({
          title: String(document.title || '').trim(),
          text: String(document.body?.innerText || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim(),
        }))
        const text = clip(String(result?.text ?? ''), config.maxTextCharacters)
        const title = clip(String(result?.title ?? ''), 500)
        const excerpt = clip(text, config.maxExcerptCharacters)
        const summary = clip(`${title ? `${title}。` : ''}${excerpt}`, config.maxExcerptCharacters)
        const observation = await this.saveWebObservation(story.id, participantId, intentId, normalized.mode, normalized.query ?? '', finalUrl, title, excerpt, summary || '页面没有可提取的正文。', 'success', new Date(), persist)
        this.reportOperation('standard', 'info', story, 'intent-due', '网页读取完成 标题=%s 正文=%d字', title || '未命名页面', text.length)
        if (config.logObservationPreview) this.report('debug', story, 'intent-due', '网页观察节选：%s', excerpt)
        return observation
      } catch (error) {
        this.report('warn', story, 'intent-due', '网页读取失败：%s', error)
        return this.saveWebObservation(story.id, participantId, intentId, normalized.mode, normalized.query ?? '', target, '', '', `网页读取失败：${clip(String(error instanceof Error ? error.message : error), 500)}`, 'failed', new Date(), persist)
      } finally {
        if (page) await page.close().catch(() => undefined)
      }
    })
  }

  private async saveWebObservation(storyId: string, participantId: string, intentId: number | null, mode: 'search' | 'visit', query: string, url: string, title: string, excerpt: string, summary: string, status: WebObservation['status'], now: Date, persist = true): Promise<WebObservation> {
    const candidate: WebObservation = {
      id: 0, storyId, participantId, intentId, mode, query: clip(query, 500), url: clip(url, 2_000), title: clip(title, 500),
      excerpt: clip(excerpt, this.browserConfig.maxExcerptCharacters), summary: clip(summary, this.browserConfig.maxExcerptCharacters),
      status, accessedAt: now, createdAt: now,
    }
    if (!persist) return candidate
    const observation = await this.dbCreate('interlude_web_observation', candidate) as WebObservation
    await this.appendEntry(storyId, {
      kind: 'web-observation', actor: 'system',
      content: webObservationEntryContent(observation), occurredAt: now.toISOString(),
      metadata: { observationId: observation.id, status, mode, url: observation.url },
    }, now, participantId)
    return observation
  }

  /** Immediate browser reads are intentionally held in memory until the
   * final narrator result survives the stale-request check. This prevents an
   * obsolete two-second message burst from leaving a durable web event behind. */
  private async persistCollectedWebObservation(observation: WebObservation) {
    return this.saveWebObservation(
      observation.storyId, observation.participantId, observation.intentId, observation.mode,
      observation.query, observation.url, observation.title, observation.excerpt, observation.summary,
      observation.status, observation.accessedAt,
    )
  }

  private async findCachedWebObservation(storyId: string, participantId: string, draft: BrowserIntentDraft, now: Date) {
    const minutes = this.browserConfig.cacheMinutes
    if (minutes <= 0) return undefined
    const cutoff = new Date(now.getTime() - minutes * Time.minute)
    const rows = await this.dbGet('interlude_web_observation', { storyId, participantId, status: 'success' }, {
      limit: 20, sort: { accessedAt: 'desc' },
    })
    return rows.find(observation => observation.accessedAt >= cutoff
      && observation.mode === draft.mode
      && (draft.mode === 'search' ? observation.query === (draft.query ?? '') : observation.url === (draft.url ?? '')))
  }

  private async withBrowserSlot<T>(task: () => Promise<T>) {
    const max = Math.max(1, this.browserConfig.maxConcurrentPages)
    if (this.browserActive >= max) await new Promise<void>(resolve => this.browserWaiters.push(resolve))
    else this.browserActive++
    try {
      return await task()
    } finally {
      const next = this.browserWaiters.shift()
      if (next) next() // Transfer the occupied slot, including the microtask handoff.
      else this.browserActive--
    }
  }

  /** Persist a bounded retry so a transient provider failure cannot strand a user turn. */
/** 用户回合成功后的清理：遗留的 narrative-retry 已无意义——其入站消息早已
 * 被本轮覆盖或消化，保留只会到期再跑一轮完整回合（userInitiated 允许投递）
 * 并给用户送去一条重复回复。 */
  private async cancelPendingNarrativeRetries(story: InterludeStory, participantId: string, now: Date) {
    const pending = await this.dbGet('interlude_intent', { storyId: story.id, participantId, status: 'pending', type: 'narrative-retry' })
    if (!pending.length) return
    await this.dbSet('interlude_intent', { id: { $in: pending.map(intent => intent.id) } }, { status: 'cancelled', updatedAt: now })
    this.reportOperation('standard', 'info', story, 'user-message', '已取消遗留的叙事重试意图 参与者=%s 数量=%d', participantId, pending.length)
  }

  private async scheduleNarrativeRetry(storyId: string, participantId: string, now: Date, previousAttempts = 0) {
    // 重载/停机期间的失败不是提供商故障：重试意图持久化在数据库里，会在
    // 新实例上以 userInitiated 投递一条过期回复——直接放弃本轮调度。
    if (this.disposed) return false
    const delaySeconds = Math.max(5, this.config.runtime.narrativeRetryDelaySeconds ?? 60)
    const maxAttempts = Math.max(0, this.config.runtime.narrativeRetryMaxAttempts ?? 6)
    const pending = await this.dbGet('interlude_intent', { storyId, participantId, status: 'pending' })
    const existing = pending.filter(intent => intent.type === 'narrative-retry')
    if (existing.length) await this.dbSet('interlude_intent', { id: { $in: existing.map(intent => intent.id) } }, { status: 'cancelled', updatedAt: now })
    if (!participantId || previousAttempts >= maxAttempts) {
      this.reportStandalone('warn', '叙事模型自动重试已停止 故事=%s 参与者=%s 已尝试=%d 上限=%d', storyId, participantId || '全局', previousAttempts, maxAttempts)
      return false
    }
    const attempt = previousAttempts + 1
    const notBefore = new Date(now.getTime() + delaySeconds * Time.second)
    await this.appendIntent(storyId, {
      type: 'narrative-retry',
      summary: `Retry the interrupted narrative turn after provider failure (attempt ${attempt}/${maxAttempts}).`,
      notBefore: notBefore.toISOString(),
      payload: { narrativeRetry: true, userInitiated: true, attempt },
    }, now, participantId)
    this.reportStandalone('warn', '叙事模型请求失败，已安排自动重试 故事=%s 参与者=%s 次数=%d/%d 等待=%d秒', storyId, participantId, attempt, maxAttempts, delaySeconds)
    return true
  }

  private async dueIntents(storyId: string, now: Date) {
    const intents = await this.dbGet('interlude_intent', { storyId, status: 'pending', notBefore: { $lte: now } }, {
      sort: { notBefore: 'asc' },
    })
    const expiredAgency = intents.filter(intent => intent.type === 'proactive-check'
      && (!this.agencyConfig.enabled || !toDate(intent.payload?.expiresAt) || toDate(intent.payload?.expiresAt)! <= now))
    if (expiredAgency.length) {
      await this.dbSet('interlude_intent', { id: { $in: expiredAgency.map(intent => intent.id) } }, { status: 'cancelled', updatedAt: now })
    }
    // Also sweep future-dated commitments: a repeatedly postponed promise can
    // otherwise remain a zombie and occupy the relationship's two-task budget.
    const followUps = await this.dbGet('interlude_intent', { storyId, status: 'pending', type: 'follow-up-commitment' }) as NarrativeIntent[]
    const retiredIds = await this.retireExpiredFollowUps(storyId, followUps, now)
    const expiredIds = new Set([...expiredAgency.map(intent => intent.id), ...retiredIds])
    return intents.filter(intent => !expiredIds.has(intent.id) && !isActiveConsequence(intent))
  }

  private async upcomingNarrativeIntents(storyId: string, now: Date) {
    const rows = await this.dbGet('interlude_intent', {
      storyId, status: 'pending', notBefore: { $gt: now },
    }, { sort: { notBefore: 'asc' }, limit: 30 }) as NarrativeIntent[]
    const internal = new Set(['split-message', 'browser-research', 'narrative-retry', 'proactive-check', 'active-consequence'])
    return rows.filter(intent => !internal.has(intent.type)).slice(0, 8)
  }

  /** Wake the scheduler close to a short typing delay instead of waiting for
   * the normal background sweep. The due intent remains the source of truth. */
  private scheduleDueIntentWake(storyId: string, notBefore: Date) {
    const delay = this.scheduler.scheduleWake(storyId, notBefore, () => this.wakeDueIntents(storyId))
    if (delay !== undefined) this.reportStandaloneOperation('diagnostic', 'debug', '已设置到期计时器 故事=%s 触发时间=%s 等待=%dms', storyId, formatLogTime(notBefore, 'Asia/Shanghai'), delay)
  }

  /** 到期唤醒的执行体：分段消息直投；sweep 繁忙或前台回合未结束时返回 'busy'，由 scheduler 短候重排。 */
  private async wakeDueIntents(storyId: string): Promise<'busy' | void> {
    if (this.databaseResetting) return
    const due = await this.dueIntents(storyId, new Date())
    // Split segments are already committed transport events. Deliver them
    // through the story queue directly; do not make them wait for the
    // five-minute sweep or start another narrator request.
    if (due.some(intent => intent.type === 'split-message')) {
      await this.deliverDueSplitSegments(storyId)
      if (due.every(intent => intent.type === 'split-message')) return
    }
    if (this.sweepRunning || this.hasPendingNarrative(storyId)) return 'busy'
    await this.sweep()
  }

  private async reconcileTerminalSplitIntent(storyId: string, intent: NarrativeIntent, now: Date) {
    const ref = restoreMessageEvent(intent.payload, String(intent.payload?.content ?? ''))
    if (!ref || !Number.isSafeInteger(ref.scriptEntryId)) return false
    const entry = (await this.dbGet('interlude_script_entry', { id: ref.scriptEntryId }))[0] as ScriptEntry | undefined
    if (!entry || entry.storyId !== storyId || entry.metadata?.commitId !== ref.commitId) return false
    const actions = Array.isArray(entry.metadata?.deliveryActions) ? entry.metadata.deliveryActions : []
    const action = actions.find(action => isRecord(action) && action.commitId === ref.commitId && action.eventId === ref.eventId)
    const segment = Array.isArray(action?.segments)
      ? action.segments.find(segment => isRecord(segment) && segment.index === ref.bubbleIndex)
      : undefined
    if (segment?.status !== 'delivered' && segment?.status !== 'cancelled') return false
    await this.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, {
      status: segment.status === 'delivered' ? 'completed' : 'cancelled', updatedAt: now,
    })
    return true
  }

  private async pendingSplitSegments(storyId: string) {
    return this.dbGet('interlude_intent', { storyId, status: 'pending', type: 'split-message' }, {
      sort: { notBefore: 'asc' },
    }) as Promise<NarrativeIntent[]>
  }

  /** Called in the story queue, after transport work and before any narration. */
  private async deferDueIntentsBehindPendingSplits(story: InterludeStory, due: NarrativeIntent[], splits: NarrativeIntent[], now: Date) {
    if (!splits.length) return due
    const ready: NarrativeIntent[] = []
    for (const intent of due) {
      // Global tasks may choose any recipient. Relationship tasks only wait for
      // that recipient; another participant's chain must not block them.
      const blocking = splits.filter(split => !intent.participantId || split.participantId === intent.participantId)
      if (!blocking.length) { ready.push(intent); continue }
      // 终止界:等待最多再滑 2 小时(自意图创建起算不超过 24h)——分段链端点
      // 长期被门控(offline/冷却/微信 TTL)或标志泄漏时,意图不得无限重排,
      // 到界后放行给正常到期处理而不是继续排队
      const chainDeadline = Math.min(
        now.getTime() + 2 * Time.hour,
        intent.createdAt.getTime() + 24 * Time.hour,
      )
      const afterSplits = Math.min(
        Math.max(now.getTime() + 30 * Time.second,
          ...blocking.map(split => split.notBefore.getTime() + Time.second)),
        chainDeadline,
      )
      const retryAt = new Date(intent.type === 'follow-up-commitment'
        ? Math.min(afterSplits, followUpDeadline(intent).getTime()) : afterSplits)
      await this.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, {
        notBefore: retryAt, updatedAt: now,
      })
      // A scheduling wait is NOT a failed promise evaluation; don't increment
      // deferredChecks or extend expiresAt. Every wake rechecks the real chain.
      this.scheduleDueIntentWake(story.id, retryAt)
      this.reportOperation('diagnostic', 'debug', story, 'intent-due',
        '到期计划等待已提交分段投递 意图=%d 类型=%s 参与者=%s 待发分段=%d 重查=%s',
        intent.id, intent.type, intent.participantId || '全局', blocking.length, retryAt.toISOString())
    }
    await this.scheduleNextSplitWake(story.id)
    return ready
  }

  private async scheduleNextSplitWake(storyId: string) {
    const pending = await this.dbGet('interlude_intent', { storyId, status: 'pending', type: 'split-message' }, {
      sort: { notBefore: 'asc' }, limit: 1,
    })
    const next = pending[0]
    if (next) this.scheduleDueIntentWake(storyId, next.notBefore)
  }

  /** Deliver already-decided <sep/> segments without invoking the narrator. */
  private async deliverDueSplitSegments(storyId: string) {
    const generation = this.taskGeneration(storyId)
    await this.serial(storyId, async () => {
      if (!this.taskGenerationCurrent(storyId, generation)) return
      const story = await this.getStory(storyId)
      const now = new Date()
      const due = await this.dbGet('interlude_intent', {
        storyId, status: 'pending', type: 'split-message', notBefore: { $lte: now },
      }, { sort: { notBefore: 'asc' }, limit: 20 })
      const next = due[0]
      if (next) {
        const intent = next
        const content = clip(intent.payload?.content, this.config.runtime.maxMessageCharacters)
        const automaticDelivery = automaticDeliveryFromPayload(intent.payload)
        const participant = intent.participantId ? await this.getParticipant(intent.participantId) : undefined
        if (intent.participantId && this.interruptedTypingParticipants.has(intent.participantId)) {
          // The incoming-message transaction is queued behind this one. Leave
          // every split intent pending so it can cancel them and carry their
          // exact draft contents into the replacement writing request.
          return
        }
        if (await this.reconcileTerminalSplitIntent(storyId, intent, now)) {
          // The ledger already confirms or cancels this key. Retire the stale
          // intent without another platform call or character-message row.
        } else if (!content || !participant || participant.status !== 'active') {
          await this.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, { status: 'cancelled', updatedAt: now })
          const reference = restoreMessageEvent(intent.payload, content || '')
          if (reference) await this.updateScriptDeliveryOutcome(storyId, reference, 'cancelled', now, 'delivery-target-unavailable')
        } else {
          // Start transport while still holding the story queue. Input that
          // arrived before this point sets interruptedTypingParticipants and
          // cancels the chain; input after this point cannot retract a message
          // whose adapter send has already begun.
          const scriptEvent = restoreMessageEvent(intent.payload, content)
          const message: OutgoingMessageDraft = {
            participantId: participant.id,
            content,
            automaticDelivery,
            ...restoreDesktopContext(intent.payload),
            ...(scriptEvent?.endpointId ? { endpointId: scriptEvent.endpointId } : {}),
            scriptEvent,
          }
          const delivered = await this.deliverOutgoingMessages(
            story,
            [message],
            undefined,
            undefined,
            target => this.interruptedTypingParticipants.has(target.id),
            false, undefined, 'failed', true,
          )
          if (!this.taskGenerationCurrent(storyId, generation)) return
          if (!delivered.length) {
            if (this.interruptedTypingParticipants.has(participant.id)) return
            if (message.scriptEvent) await this.updateScriptDeliveryOutcome(storyId, message.scriptEvent, 'pending', now, 'delivery-unconfirmed-retry-scheduled')
            const retryAt = new Date(now.getTime() + 30 * Time.second)
            await this.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, { notBefore: retryAt, updatedAt: now })
            this.scheduleDueIntentWake(storyId, retryAt)
            return
          }
          await this.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, { status: 'completed', updatedAt: now })
        }
      }
      // When several segments became overdue together, restore a fresh
      // typing interval instead of immediately draining the backlog.
      const remaining = due.slice(1)
      if (remaining.length) {
        const following = remaining[0]
        if (following.notBefore <= now) {
          const followingContent = clip(following.payload?.content, this.config.runtime.maxMessageCharacters)
          if (followingContent) {
            await this.dbSet('interlude_intent', { id: following.id, status: 'pending' }, {
              notBefore: new Date(now.getTime() + this.typingDelayMilliseconds(followingContent)), updatedAt: now,
            })
          }
        }
      }
      await this.scheduleNextSplitWake(storyId)
    })
  }

  /** Pending spoken promises are intentionally tiny and relationship-local. */
  private async pendingFollowUpCommitments(storyId: string, participantId: string, now = new Date()) {
    const rows = await this.dbGet('interlude_intent', {
      storyId, participantId, type: 'follow-up-commitment', status: 'pending',
    }, { sort: { notBefore: 'asc' } }) as NarrativeIntent[]
    const retiredIds = await this.retireExpiredFollowUps(storyId, rows, now)
    return rows.filter(intent => !retiredIds.has(intent.id)).slice(0, 2)
  }

  /** Expiration retires a scheduler task, not a fictional fulfilled promise. */
  private async retireExpiredFollowUps(storyId: string, intents: NarrativeIntent[], now: Date) {
    const retiredIds = new Set<number>()
    for (const intent of intents) {
      const expiresAt = followUpDeadline(intent)
      const reason = expiresAt <= now ? 'follow-up-commitment-expired'
        : followUpDeferredChecks(intent) >= MAX_FOLLOW_UP_DEFERRED_CHECKS ? 'follow-up-deferred-limit' : undefined
      if (reason) {
        await this.dbSet('interlude_intent', { id: intent.id, storyId, status: 'pending' }, {
          status: 'cancelled', updatedAt: now,
          payload: { ...intent.payload, expiresAt: expiresAt.toISOString(), expired: true, expiredAt: now.toISOString(), cancelReason: reason },
        })
        retiredIds.add(intent.id)
        this.reportOperation('diagnostic', 'debug', await this.getStory(storyId), 'intent-due',
          '承诺回访已停止 意图=%d 参与者=%s 原因=%s', intent.id, intent.participantId, reason)
      } else if (!toDate(intent.payload?.expiresAt)) {
        // Legacy rows use creation+24h, never `now+24h` on each read.
        await this.dbSet('interlude_intent', { id: intent.id, storyId, status: 'pending' }, {
          payload: { ...intent.payload, expiresAt: expiresAt.toISOString() }, updatedAt: now,
        })
      }
    }
    return retiredIds
  }

  private async appendFollowUpCommitment(
    story: InterludeStory,
    participantId: string,
    draft: FollowUpCommitmentDraft,
    fallbackSourceEntryId: number | undefined,
    now: Date,
    originDeliveryEventId?: string,
  ) {
    if (originDeliveryEventId) {
      const previous = await this.dbGet('interlude_intent', {
        storyId: story.id, participantId, type: 'follow-up-commitment', summary: draft.summary,
      }) as NarrativeIntent[]
      if (previous.some(intent => intent.payload?.originDeliveryEventId === originDeliveryEventId)) return
    }
    const pending = await this.pendingFollowUpCommitments(story.id, participantId, now)
    const key = normalizeFollowUpSummary(draft.summary)
    const duplicate = pending.find(intent => normalizeFollowUpSummary(intent.summary) === key)
    if (duplicate || pending.length >= 2) {
      this.reportOperation('diagnostic', 'debug', story, 'user-message',
        '承诺回访未重复创建 参与者=%s 原因=%s', participantId, duplicate ? '同一事项待处理' : '待处理上限')
      return
    }
    const sourceEntryIds = [
      ...(draft.sourceEntryIds ?? []).filter(id => Number.isSafeInteger(id) && id > 0),
      ...(fallbackSourceEntryId ? [fallbackSourceEntryId] : []),
    ].slice(-4)
    const expiresAt = followUpExpiresAt(draft.expiresAt, now)
    await this.appendIntent(story.id, {
      type: 'follow-up-commitment', summary: draft.summary, notBefore: draft.notBefore,
      payload: {
        kind: draft.kind, sourceEntryIds, expiresAt: expiresAt.toISOString(),
        requiresVisibleOutcome: true, userInitiated: true, originDeliveryEventId,
      },
    }, now, participantId)
    this.scheduleDueIntentWake(story.id, new Date(draft.notBefore))
    this.reportOperation('standard', 'info', story, 'user-message',
      '已登记承诺回访 参与者=%s 类型=%s 到期=%s', participantId, draft.kind, formatLogTime(new Date(draft.notBefore), story.setting.timezone))
  }

  private async applyFollowUpResolutions(
    storyId: string,
    participantId: string,
    resolutions: FollowUpResolutionDraft[],
    interaction: NarrativeInteraction | undefined,
    now: Date,
    deliveryEventId?: string,
  ) {
    if (!resolutions.length || interaction?.reply?.mode !== 'immediate' || !interaction.reply.content?.trim()) return new Set<number>()
    const ids = resolutions.map(item => item.id)
    const rows = await this.dbGet('interlude_intent', {
      storyId, participantId, type: 'follow-up-commitment', status: 'pending', id: { $in: ids },
    }) as NarrativeIntent[]
    const resolved = new Set<number>()
    for (const resolution of resolutions) {
      const intent = rows.find(item => item.id === resolution.id)
      if (!intent) continue
      if (deliveryEventId && intent.payload?.resolutionEventId === deliveryEventId) {
        resolved.add(intent.id)
        continue
      }
      if (resolution.outcome === 'rescheduled') {
        const nextAt = toDate(resolution.notBefore)
        if (!nextAt || nextAt <= now || nextAt >= followUpDeadline(intent) || nextAt.getTime() - now.getTime() > 12 * Time.hour) continue
        await this.dbSet('interlude_intent', { id: intent.id }, {
          notBefore: nextAt, payload: { ...intent.payload, reschedules: Number(intent.payload.reschedules ?? 0) + 1, resolutionEventId: deliveryEventId }, updatedAt: now,
        })
        this.scheduleDueIntentWake(storyId, nextAt)
      } else {
        await this.dbSet('interlude_intent', { id: intent.id }, {
          status: resolution.outcome === 'cancelled' ? 'cancelled' : 'completed', updatedAt: now,
        })
      }
      resolved.add(intent.id)
    }
    return resolved
  }

  private async deferUnresolvedDueFollowUps(
    storyId: string,
    participantId: string,
    contextIntents: NarrativeIntent[],
    resolvedIds: Set<number>,
    _interaction: NarrativeInteraction | undefined,
    now: Date,
  ) {
    const due = contextIntents.filter(intent => intent.type === 'follow-up-commitment' && intent.participantId === participantId)
    if (!due.length) return
    const unresolved = due.filter(intent => !resolvedIds.has(intent.id))
    const retiredIds = await this.retireExpiredFollowUps(storyId, unresolved, now)
    for (const intent of unresolved) {
      if (retiredIds.has(intent.id)) continue
      const expiresAt = followUpDeadline(intent)
      // Wake at the deadline rather than scheduling another model check past it.
      const retryAt = new Date(Math.min(now.getTime() + 20 * Time.minute, expiresAt.getTime()))
      await this.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, {
        notBefore: retryAt,
        payload: { ...intent.payload, expiresAt: expiresAt.toISOString(), deferredChecks: followUpDeferredChecks(intent) + 1 },
        updatedAt: now,
      })
      this.scheduleDueIntentWake(storyId, retryAt)
      this.reportOperation('diagnostic', 'debug', await this.getStory(storyId), 'intent-due',
        '承诺回访等待明确结算及完整投递确认，已保留重查 参与者=%s', participantId)
    }
  }

  private async appendProactiveCheck(
    story: InterludeStory,
    candidate: ProactiveContactDraft,
    notBefore: Date,
    reason: string,
    now: Date,
  ) {
    const expiresAt = toDate(candidate.expiresAt)
    if (!expiresAt || expiresAt <= now || notBefore >= expiresAt) return
    const fingerprint = proactiveCandidateFingerprint(candidate)
    const pending = await this.dbGet('interlude_intent', {
      storyId: story.id,
      participantId: candidate.participantId,
      status: 'pending',
      type: 'proactive-check',
    })
    if (pending.some(intent => intent.payload?.fingerprint === fingerprint)) {
      this.reportOperation('diagnostic', 'debug', story, 'advance',
        'Agency 主动联系候选去重 参与者=%s 指纹=%s', candidate.participantId, fingerprint)
      return
    }
    // Model latency (and the deduplication read) can outlive logical narrative
    // time. Use a fresh host clock only for scheduling; keep story timestamps intact.
    const schedulingNow = Math.max(now.getTime(), Date.now())
    const recheckAt = notBefore.getTime() > schedulingNow
      ? notBefore : new Date(schedulingNow + 1000)
    if (recheckAt >= expiresAt) return
    await this.appendIntent(story.id, {
      type: 'proactive-check',
      summary: `Re-evaluate a life-grounded contact motive: ${candidate.motive}`,
      notBefore: recheckAt.toISOString(),
      participantId: candidate.participantId,
      payload: {
        origin: candidate.origin,
        motive: candidate.motive,
        disclosure: candidate.disclosure,
        sourceEntryIds: candidate.sourceEntryIds ?? [],
        willingness: candidate.willingness,
        expiresAt: candidate.expiresAt,
        fingerprint,
        agencyReason: reason,
        userInitiated: false,
      },
    }, now, candidate.participantId)
    this.scheduleDueIntentWake(story.id, recheckAt)
    this.reportOperation('standard', 'info', story, 'advance',
      'Agency 已安排主动联系重查 参与者=%s 时间=%s 原因=%s',
      candidate.participantId, formatLogTime(recheckAt, story.setting.timezone), reason)
  }

  /** schedule_preplan 的主键就是 storyId，Minato 拒绝含主键的 update——
   * 混在改写循环里必抛，导致后续 participantId 回填被跳过（隐私脱敏失效）。
   * 改为读旧行→建新行→删旧行（每故事仅一行，无并发窗口问题）。 */
  private async migrateSchedulePreplanRecord(legacyStoryId: string, newStoryId: string) {
    const preplanRows = await this.dbGet('interlude_schedule_preplan', { storyId: legacyStoryId })
    if (!preplanRows.length) return
    const { storyId: _oldStoryId, ...rest } = preplanRows[0] as Record<string, unknown>
    await this.dbCreate('interlude_schedule_preplan', { ...rest, storyId: newStoryId })
    await this.dbRemove('interlude_schedule_preplan', { storyId: legacyStoryId })
  }

  private async cancelPendingOutgoingMessages(storyId: string, participantId: string, now: Date, cancelPlanned = true) {
    try {
      const intents = await this.dbGet('interlude_intent', { storyId, participantId, status: 'pending' })
      const matching = intents.filter(intent => intent.participantId === participantId && (
        intent.type === 'split-message'
        || cancelPlanned && (intent.type === 'delayed-reply' || intent.type === 'cross-conversation-message')
      ))
      if (!matching.length) return matching

      await this.dbSet('interlude_intent', { id: { $in: matching.map(intent => intent.id) } }, {
        status: 'cancelled',
        updatedAt: now,
      })
      for (const intent of matching) {
        const content = clip(intent.payload?.content, this.config.runtime.maxMessageCharacters)
        const reference = restoreMessageEvent(intent.payload, content)
        if (reference) await this.updateScriptDeliveryOutcome(storyId, reference, 'cancelled', now, 'superseded-by-new-message')
      }
      this.scheduler.cancelWake(storyId)
      await this.scheduleNextSplitWake(storyId)
      const interruptedDrafts = matching
        .filter(intent => intent.type === 'split-message')
        .map(intent => clip(intent.payload?.content, this.config.runtime.maxMessageCharacters))
        .filter(Boolean)
      const content = interruptedDrafts.length
        ? `The protagonist wanted to send ${interruptedDrafts.map(draft => JSON.stringify(draft)).join(' and ')}, but had not finished typing before the user's new message arrived.`
        : 'A newer user message superseded a planned outgoing message before it was sent.'
      await this.appendEntry(storyId, {
        kind: 'intent-cancelled',
        actor: 'system',
        content,
        occurredAt: now.toISOString(),
        metadata: { intentIds: matching.map(intent => intent.id), interruptedDrafts },
      }, now, participantId)
      return matching
    } finally {
      // 无条件清理——异常滞留会永久跳过该参与者的后续分段投递。
      this.interruptedTypingParticipants.delete(participantId)
    }
  }

  private async sendScheduledMessages(story: InterludeStory, messages: OutgoingMessageDraft[]) {
    return this.deliverOutgoingMessages(story, messages)
  }

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
  private synthesizeCrossActionFromScript(decision: { authoredActions?: unknown, script?: string }, participantId: string): { participantId: string, mode: 'immediate', content: string } | undefined {
    const actions = Array.isArray(decision?.authoredActions) ? decision.authoredActions as { id: string, content: string }[] : []
    // 多行动时无法确定哪条属于目标接收者（AuthoredAction 不携带归属）——
    // 保守不合成而非猜"最后一条"，零误发风险；单行动时归属无歧义。
    if (actions.length !== 1) return undefined
    const action = actions[0]
    if (!action?.content?.trim()) return undefined
    const content = sanitizeAndClampVisibleContent(action.content, this.config.runtime.maxMessageCharacters, this.config.runtime.messageSeparator)
    if (!content) return undefined
    return { participantId, mode: 'immediate' as const, content }
  }

  private async sendCrossGroupMessage(
    story: InterludeStory,
    message: OutgoingMessageDraft,
    session?: Session,
    failureStatus: 'failed' | 'pending' = 'failed',
    shouldCancel: () => boolean = () => false,
  ) {
    const generation = this.deliveryGeneration(story.id)
    const groupId = normalizeGroupId(message.participantId.slice('group:'.length))
    const allowed = this.config.onebot?.groupChats?.some(group => group.enabled !== false && normalizeGroupId(group.groupId) === groupId)
    const segments = this.splitOutgoingMessage(message.content)
    const baseIndex = message.scriptEvent?.bubbleIndex ?? 0
    const settled = new Map<number, GroupDeliveryResult['segmentOutcomes'][number]['status']>()
    const drafts = segments.map((content, index) => ({ ...message, content,
      ...(message.scriptEvent ? { scriptEvent: { ...message.scriptEvent, bubbleIndex: baseIndex + index } } : {}) }))
    if (message.scriptEvent?.scriptEntryId) {
      const source = (await this.dbGet('interlude_script_entry', { storyId: story.id, id: message.scriptEvent.scriptEntryId }))[0] as ScriptEntry | undefined
      if (!source || source.storyId !== story.id) return { deliveredSegments: [], complete: false,
        segmentOutcomes: segments.map((content, index) => ({ index, content, status: 'cancelled' as const, reason: 'delivery-source-unavailable' })) }
      const action = (source?.metadata?.deliveryActions as ScriptDeliveryAction[] | undefined)?.find(item => item.commitId === message.scriptEvent!.commitId && item.eventId === message.scriptEvent!.eventId)
      for (const [index, draft] of drafts.entries()) {
        const key = this.deliveryExecutionKey(story.id, draft, true)!
        if (this.acceptedDeliveries.has(key) || await this.successfulDeliveryEntry(story.id, draft)) settled.set(index, 'delivered')
        else {
          const status = action?.segments.find(item => item.index === baseIndex + index)?.status
          if (status === 'delivered' || status === 'cancelled' || status === 'failed') settled.set(index, status)
        }
      }
    }
    const allSettled = settled.size === segments.length
    const outcome: GroupDeliveryResult = allSettled
      ? { deliveredSegments: segments.filter((_, index) => settled.get(index) === 'delivered'),
        complete: [...settled.values()].every(status => status === 'delivered'),
        segmentOutcomes: segments.map((content, index) => ({ index, content, status: settled.get(index)! })) }
      : allowed ? await this.sendGroupMessage(story, groupId, message.content, undefined, session, message.endpointId, {
        traceId: message.traceId, processingId: message.processingId,
      }, { shouldCancel, settled, onDelivered: index => {
        const key = this.deliveryExecutionKey(story.id, drafts[index], true)
        if (key && !this.databaseResetting && this.deliveryGeneration(story.id) === generation) this.acceptedDeliveries.set(key, drafts[index])
      } })
      : { deliveredSegments: [], complete: false, segmentOutcomes: segments.map((content, index) => ({ index, content, status: settled.get(index) ?? 'failed', reason: 'group-not-allowed' })) }
    if (this.databaseResetting || this.deliveryGeneration(story.id) !== generation) return outcome
    const now = new Date()
    await runStorySerialized(this, story.id, async () => {
      if (this.databaseResetting || this.deliveryGeneration(story.id) !== generation) return
      const unrecorded = [] as GroupDeliveryResult['segmentOutcomes']
      for (const segment of outcome.segmentOutcomes) {
        if (segment.status === 'delivered' && !await this.successfulDeliveryEntry(story.id, drafts[segment.index])) unrecorded.push(segment)
      }
      if (this.databaseResetting || this.deliveryGeneration(story.id) !== generation) return
      // A durable success receipt precedes ledger reconciliation. A later
      // ledger failure cannot turn an accepted bubble back into transport work.
      if (unrecorded.length) {
        if (!message.scriptEvent) {
          // 无账本旁路（issue #3）：cross-action 未经 commit 事件直接投递——
          // 可追溯到 normalizeDecision 的 group-echo 闸漏网或恢复路径残留。
          this.reportOperation('diagnostic', 'warn', story, 'intent-due', '跨群投递缺少账本引用(不可追溯) 群=%s 分段=%d', groupId, unrecorded.length)
        }
        await this.appendEntry(story.id, {
        kind: 'character-group-message', actor: 'character', content: unrecorded.map(segment => segment.content).join('<sep/>'), occurredAt: now.toISOString(),
        metadata: { groupId, channelId: groupId, ...(message.scriptEvent ?? {}),
          deliverySegmentIndexes: unrecorded.map(segment => baseIndex + segment.index), partialDelivery: !outcome.complete },
      }, now)
      }
      if (message.scriptEvent) {
        for (const segment of outcome.segmentOutcomes) {
          const ledgerStatus = segment.status === 'failed' && (failureStatus === 'pending' || segment.reason === 'delivery-generation-obsolete') ? 'pending' : segment.status
          await this.updateScriptDeliveryOutcome(story.id, { ...message.scriptEvent, segmentIndex: baseIndex + segment.index }, ledgerStatus, now, segment.reason)
          const draft = drafts[segment.index]
          const key = this.deliveryExecutionKey(story.id, draft, true)!
          if (segment.status === 'delivered' && (await this.deliveryLedgerConfirmed(story.id, draft) || await this.successfulDeliveryEntry(story.id, draft))) this.acceptedDeliveries.delete(key)
        }
      }
    })
    if (!outcome.complete) this.report('warn', story, 'intent-due', '跨群消息投递未完成 群频道=%s', groupId)
    return outcome
  }

  private deliveryExecutionKey(storyId: string, message: OutgoingMessageDraft, segment = false) {
    const ref = message.scriptEvent
    if (!ref?.scriptEntryId) return undefined
    return JSON.stringify([storyId, ref.scriptEntryId, ref.commitId, ref.eventId, ...(segment ? [ref.bubbleIndex ?? 0] : [])])
  }

  private async successfulDeliveryEntry(storyId: string, message: OutgoingMessageDraft) {
    const ref = message.scriptEvent
    if (!ref?.scriptEntryId) return undefined
    const entries = await this.dbGet('interlude_script_entry', {
      storyId, kind: { $in: ['character-message', 'character-group-message'] },
      'metadata.scriptEntryId': ref.scriptEntryId, 'metadata.commitId': ref.commitId, 'metadata.eventId': ref.eventId,
    }) as ScriptEntry[]
    return entries.find(entry => entry.kind === 'character-group-message'
      ? Array.isArray(entry.metadata?.deliverySegmentIndexes) && entry.metadata.deliverySegmentIndexes.includes(ref.bubbleIndex ?? 0)
      : (entry.metadata?.bubbleIndex ?? 0) === (ref.bubbleIndex ?? 0))
  }

  /** No waiting for another executor inside story serial: its confirmation may
   * need that same serial. A competing recovery/split simply tries later. */
  private async deliverOutgoingMessages(
    story: InterludeStory, messages: OutgoingMessageDraft[], current?: InterludeParticipant,
    session?: Session, shouldCancel?: (target: InterludeParticipant) => boolean, recordFailures = true,
    requestStartedAt?: Date, failureStatus: 'failed' | 'pending' = 'failed', splitSegment = false, confirmedEntries?: ScriptEntry[],
  ) {
    const delivered: OutgoingMessageDraft[] = []
    const generation = this.taskGeneration(story.id)
    const receiptGeneration = this.deliveryGeneration(story.id)
    for (const message of messages) {
      if (!this.taskGenerationCurrent(story.id, generation)) break
      const key = this.deliveryExecutionKey(story.id, message)
      if (key && this.deliveryExecutors.has(key)) continue
      if (key) this.deliveryExecutors.add(key)
      try {
        if (message.participantId.startsWith('group:')) {
          const outcome = await this.sendCrossGroupMessage(story, message, session, failureStatus, () => !this.taskGenerationCurrent(story.id, generation))
          if (outcome.complete) delivered.push(message)
          continue
        }
        const ref = message.scriptEvent
        const receiptKey = this.deliveryExecutionKey(story.id, message, true)
        const accepted = receiptKey && this.acceptedDeliveries.get(receiptKey)
        const receipt = ref?.scriptEntryId ? await this.successfulDeliveryEntry(story.id, message) : undefined
        if (receipt) {
          const confirmed = await this.confirmOutgoingDeliveries(story, [message], splitSegment)
          confirmedEntries?.push(...confirmed)
          if (receiptKey) this.acceptedDeliveries.delete(receiptKey)
          delivered.push(message)
          continue
        }
        if (ref?.scriptEntryId && !accepted) {
          const entry = (await this.dbGet('interlude_script_entry', { id: ref.scriptEntryId }))[0] as ScriptEntry | undefined
          const action = (entry?.metadata?.deliveryActions as ScriptDeliveryAction[] | undefined)?.find((item: ScriptDeliveryAction) => item.commitId === ref.commitId && item.eventId === ref.eventId)
          const segment = action?.segments?.find((item: { index: number }) => item.index === (ref.bubbleIndex ?? 0))
          if (!entry || entry.storyId !== story.id || segment && segment.status !== 'pending') {
            if (segment?.status === 'delivered') delivered.push(message)
            continue
          }
        }
        if (!this.taskGenerationCurrent(story.id, generation)) break
        // A confirmation exception must not turn platform success into an
        // ordinary transport failure or trigger another platform request.
        const sent = accepted ? [accepted] : await this.sendOutgoingMessages(story, [message], current, session,
          target => !this.taskGenerationCurrent(story.id, generation) || !!shouldCancel?.(target), recordFailures, requestStartedAt, failureStatus)
        for (const item of sent) {
          if (this.databaseResetting || this.deliveryGeneration(story.id) !== receiptGeneration) break
          if (receiptKey) this.acceptedDeliveries.set(receiptKey, item)
          const confirmed = await this.confirmOutgoingDeliveries(story, [item], splitSegment)
          confirmedEntries?.push(...confirmed)
          delivered.push(item)
          if (receiptKey && (!item.scriptEvent || await this.deliveryLedgerConfirmed(story.id, item) || await this.successfulDeliveryEntry(story.id, item))) this.acceptedDeliveries.delete(receiptKey)
        }
      } finally { if (key) this.deliveryExecutors.delete(key) }
    }
    return delivered
  }

  private async deliveryLedgerConfirmed(storyId: string, message: OutgoingMessageDraft) {
    const ref = message.scriptEvent!
    const entry = (await this.dbGet('interlude_script_entry', { storyId, id: ref.scriptEntryId }))[0] as ScriptEntry | undefined
    const action = (entry?.metadata?.deliveryActions as ScriptDeliveryAction[] | undefined)?.find((item: ScriptDeliveryAction) => item.commitId === ref.commitId && item.eventId === ref.eventId)
    return action?.segments?.find((item: { index: number }) => item.index === (ref.bubbleIndex ?? 0))?.status === 'delivered'
  }

  private async sendOutgoingMessages(
    story: InterludeStory,
    messages: OutgoingMessageDraft[],
    current?: InterludeParticipant,
    session?: Session,
    shouldCancel?: (target: InterludeParticipant) => boolean,
    recordFailures = true,
    requestStartedAt?: Date,
    failureStatus: 'failed' | 'pending' = 'failed',
  ) {
    const delivered: OutgoingMessageDraft[] = []
    if (!messages.length) return delivered
    const ids = Array.from(new Set(messages.map(message => message.participantId).filter(id => !!id && !id.startsWith('group:'))))
    const byId = new Map<string, InterludeParticipant>()
    if (current && ids.includes(current.id)) byId.set(current.id, current)
    const missingIds = ids.filter(id => !byId.has(id))
    const participants = await Promise.all(missingIds.map(id => this.getParticipant(id)))
    for (const participant of participants) if (participant) byId.set(participant.id, participant)
    // Do not silently fall back to an arbitrary transport when the endpoint
    // registry cannot be reconciled. Health gates only make sense after the
    // persisted registry and snapshots are available.
    try {
      await this.ensureEndpointRegistry()
    } catch (error) {
      this.reportStandalone('warn', '出站端点注册表不可用，已阻止本批消息投递 错误=%s', error)
      if (recordFailures) {
        for (const message of messages) {
          await this.recordOutgoingDeliveryFailure(story, message.participantId, message, 'endpoint-registry-unavailable', failureStatus)
        }
      }
      return delivered
    }
    let typingFloorApplied = false
    for (const message of messages) {
      if (message.participantId.startsWith('group:')) {
        // A group target must never enter private participant lookup or use
        // session.send() from the private turn that authored this action.
        try { await this.sendCrossGroupMessage(story, message, session, failureStatus) }
        catch (error) { this.report('warn', story, 'intent-due', '跨群投递或回执记录失败（不自动重发）目标=%s 错误=%s', message.participantId, error) }
        continue
      }
      const target = byId.get(message.participantId)
      if (!target) {
        this.report('warn', story, 'intent-due', '无法投递消息：参与者不存在 %s', message.participantId)
        if (recordFailures) await this.recordOutgoingDeliveryFailure(story, message.participantId, message, 'participant-not-found', failureStatus)
        continue
      }
      if (!this.canHandleParticipant(target)) {
        this.report('warn', story, 'intent-due', '消息被当前账号白名单拦截 参与者=%s', target.id)
        if (recordFailures) await this.recordOutgoingDeliveryFailure(story, target.id, message, 'participant-not-allowed', failureStatus)
        continue
      }
      // 首条发言的打字时间下限：模型返回快于按字数估算的打字时长时补足等待，
      // 返回慢于该时长则不等待。仅对当前对话参与者的首条生效，一次调用至多一次。
      if (requestStartedAt && current && message.participantId === current.id && !typingFloorApplied) {
        typingFloorApplied = true
        const hold = this.firstMessageTypingHoldMs(message.content, requestStartedAt)
        if (hold > 0) {
          this.reportOperation('diagnostic', 'debug', story, 'user-message', '首条消息按打字时间补足等待 参与者=%s 等待=%dms', target.id, hold)
          await new Promise<void>(resolve => { this.ctx.setTimeout(() => resolve(), hold) })
        }
      }
      if (shouldCancel?.(target)) {
        this.reportOperation('standard', 'info', story, 'user-message', '新消息打断主角输入，停止发送后续分段 参与者=%s', target.id)
        continue
      }
      let attemptedAddress: { platform: string, selfId: string } | undefined
      try {
        this.reportOperation('standard', 'info', story, 'intent-due', '消息投递开始 参与者=%s', target.id)
        const legacyAddress = this.endpointAddressSync({ platform: target.platform, selfId: target.selfId }, { kind: 'participant-user', id: target.id })
        // Keep the distinction between a caller-selected route and the legacy
        // default route.  The latter is still allowed to reuse the live
        // incoming Session; assigning its resolved endpointId below must not
        // accidentally turn an ordinary reply into a background delivery.
        const explicitEndpointId = typeof message.endpointId === 'string' && message.endpointId.trim()
          ? message.endpointId.trim() : undefined
        const selectedEndpointId = explicitEndpointId ?? legacyAddress.endpointId
        const endpointCandidate = selectedEndpointId
          ? this.endpointRows.find(row => row.id === selectedEndpointId
            && row.ownerKind === 'participant-user' && row.ownerId === target.id)
          : undefined
        const sessionMatchesCandidate = !endpointCandidate || (
          String(session?.selfId ?? '') === String(endpointCandidate.selfId)
          && (session?.platform === endpointCandidate.platform || isOneBotPlatform(String(session?.platform ?? '')) && isOneBotPlatform(endpointCandidate.platform))
        )
        // A live incoming Session is a current connection observation. Record
        // it before the gate, otherwise the first immediate reply can be
        // rejected as offline before the connector emits a lifecycle event.
        if (session && current?.id === target.id && endpointCandidate && sessionMatchesCandidate) {
          const previous = this.endpointStates.get(endpointCandidate.id) ?? freshEndpointState(endpointCandidate.id)
          if (!previous.connection.online) this.setEndpointState(endpointCandidate.id, stateAfterConnection(previous, true))
        }
        // 用户触发的回复豁免出站失败冷却：冷却的本意是防止风控端点被后台
        // 重试高频轰炸；直接回复刚收到的消息不属于该场景，一次网络抖动不
        // 该让该参与者最长 5 分钟已读不回。失败仍会延长冷却，自愈不变。
        const ignoreCooldown = message.userInitiated === true
        const resolved = this.endpointForDelivery(selectedEndpointId, { kind: 'participant-user', id: target.id }, Date.now(), { ignoreCooldown })
        if (resolved.reason) {
          this.report('warn', story, 'intent-due', '消息被端点门控阻止 参与者=%s 端点=%s 原因=%s', target.id, selectedEndpointId, resolved.reason)
          if (recordFailures) await this.recordOutgoingDeliveryFailure(story, target.id, message, resolved.reason, failureStatus)
          continue
        }
        const endpoint = resolved.row
        const address = endpoint ? { platform: endpoint.platform, selfId: endpoint.selfId } : legacyAddress
        attemptedAddress = address
        if (endpoint && !explicitEndpointId) {
          message.endpointId = endpoint.id
          if (message.scriptEvent && !message.scriptEvent.endpointId) {
            message.scriptEvent = { ...message.scriptEvent, endpointId: endpoint.id }
          }
        }
        const sessionMatchesEndpoint = !endpoint || (
          String(session?.selfId ?? '') === String(endpoint.selfId)
          && (session?.platform === endpoint.platform || isOneBotPlatform(String(session?.platform ?? '')) && isOneBotPlatform(endpoint.platform))
        )
        const gateReason = endpoint ? this.endpointGateReason(endpoint.id, Date.now(), { ignoreCooldown }) : undefined
        if (gateReason) {
          this.report('warn', story, 'intent-due', '消息被端点状态门控阻止 参与者=%s 端点=%s 原因=%s', target.id, endpoint.id, gateReason)
          if (recordFailures) await this.recordOutgoingDeliveryFailure(story, target.id, message, gateReason, failureStatus)
          continue
        }
        // User-triggered replies are not proactive contact.  Background,
        // delayed, and Agency messages must also pass the channel-specific
        // initiation gate when that transport exposes one (for example a
        // WeChat context token).  QQ/OneBot endpoints have no optional
        // initiate state and therefore retain the legacy behavior.
        const initiateReason = message.userInitiated === true || !endpoint
          ? undefined
          : this.endpointInitiateGateReason(endpoint.id)
        if (initiateReason) {
          this.report('warn', story, 'intent-due', '消息被主动联系端点门控阻止 参与者=%s 端点=%s 原因=%s', target.id, endpoint?.id, initiateReason)
          if (recordFailures) await this.recordOutgoingDeliveryFailure(story, target.id, message, initiateReason, failureStatus)
          continue
        }
        const literalQuoteMessageId = await this.resolveLiteralQuoteMessageId(story.id, target.id, message.content)
        const literalQuoteOnly = isLiteralQuoteOnly(message.content)
        if (literalQuoteOnly && !literalQuoteMessageId) {
          this.report('warn', story, 'intent-due', '已阻止无法映射的伪引用文本 参与者=%s', target.id)
          if (recordFailures) await this.recordOutgoingDeliveryFailure(story, target.id, message, 'literal-quote-target-not-found', failureStatus)
          continue
        }
        if (literalQuoteMessageId) message.quoteMessageId = literalQuoteMessageId
        const outgoingContent = literalQuoteMessageId
          ? [h('quote', { id: literalQuoteMessageId }), '\u200b']
          : message.content
        if (this.config.logging?.logMessageContent) {
          this.report('info', story, 'intent-due', '主角消息内容：%s', message.content.slice(0, this.config.logging.previewLength))
        }
        if (!explicitEndpointId && session && current?.id === target.id && sessionMatchesEndpoint) {
          const receipt = await withTransportTimeout(session.send(outgoingContent), 'private-session-send')
          if (Array.isArray(receipt) && !receipt.length) throw new Error('Private transport returned no message receipt.')
          // 即时会话投递成功同样刷新端点状态（与 bot/desktop 路径一致）。
          this.noteEndpointOutbound({ kind: 'participant-user', id: target.id }, true, 'session-delivered', address)
          delivered.push(message)
          continue
        }
        // A private endpoint's user id is not necessarily a Koishi channel id.
        // In particular, OneBot interprets a bare numeric channel as a group
        // target, so delayed/split messages could be routed to send_group_msg
        // even though the first live-session reply was sent privately.
        const privateChannelId = privateDeliveryChannelId(
          address.platform,
          endpoint?.userId || target.userId,
          endpoint?.channelId || target.channelId,
        )
        if (this.desktopDeliveryHandler) {
          // typ-0 worker：没有 adapter bot，后台投递统一走宿主渠道。结果语义与
          // bot.sendMessage 一致——成功 resolve 进 delivered 由账本确认，失败
          // reject 进 catch 由 recordOutgoingDeliveryFailure 记录。
          if (!message.scriptEvent) {
            // 幂等键缺失 = 宿主无法跨 deliveryId 去重（迟到回执 + 30s 重试场景
            // 可能重复投递）。成因链在 commit-builder/delivery 层全部静默，
            // 这里必须留痕供排障。
            this.reportOperation('diagnostic', 'debug', story, 'intent-due', '后台投递缺少 scriptEvent，幂等键缺失 参与者=%s', target.id)
          }
          const outcome = await this.desktopDeliveryHandler({
            participantId: target.id, selfId: address.selfId, platform: address.platform,
            channelId: privateChannelId, kind: 'private', content: message.content,
            ...(message.traceId ? { traceId: message.traceId } : {}),
            ...(message.processingId ? { processingId: message.processingId } : {}),
            ...(message.quoteMessageId ? { quoteMessageId: message.quoteMessageId } : {}),
            ...(selectedEndpointId ? { endpointId: selectedEndpointId } : {}),
            ...(message.scriptEvent ? { intentKey: `${message.scriptEvent.eventId}:${message.scriptEvent.bubbleIndex}` } : {}),
          })
          if (outcome.ok) {
            // 桌面宿主投递成功同样刷新端点 deliverable 状态。
            this.noteEndpointOutbound({ kind: 'participant-user', id: target.id }, true, 'desktop-delivered', address)
            delivered.push(message)
          }
          else throw new Error(outcome.error || 'typ-0 宿主投递失败。')
          continue
        }
        // The endpoint selected above is a hard route.  Once a caller/model has
        // selected an endpoint, a missing bot or transport error must never
        // fall back to another account and create a misleading delivery.
        const bot = endpoint
          ? this.ctx.bots.find(item => String(item.selfId) === String(endpoint.selfId)
            && (item.platform === endpoint.platform || isOneBotPlatform(item.platform) && isOneBotPlatform(endpoint.platform)))
          : this.findBotForParticipant(target)
        if (!bot) {
          this.report('warn', story, 'intent-due', '没有可用机器人账号投递消息 参与者=%s', target.id)
          if (recordFailures) await this.recordOutgoingDeliveryFailure(story, target.id, message, 'bot-not-found', failureStatus)
          continue
        }
        const receipt = await withTransportTimeout(bot.sendMessage(privateChannelId, outgoingContent), 'private-bot-send')
        if (Array.isArray(receipt) && !receipt.length) throw new Error('Private transport returned no message receipt.')
        this.noteEndpointOutbound({ kind: 'participant-user', id: target.id }, true, endpoint ? 'endpoint-explicit' : 'private-delivered', address)
        delivered.push(message)
      } catch (error) {
        // Keep the address selected for this attempt.  Re-resolving here can
        // pick a different sibling endpoint after a failure and poison its
        // cooldown/diagnostics in a multi-account story.
        const address = attemptedAddress ?? this.endpointAddressSync({ platform: target.platform, selfId: target.selfId }, { kind: 'participant-user', id: target.id })
        const unknownOutcome = (error as { transportTimeout?: boolean })?.transportTimeout === true
        if (unknownOutcome) {
          // 传输超时=结果未知：底层请求仍在飞,迟到回执由 deliveryExecutionKey
          // 幂等去重。账本记 pending 交待投递补偿收尾,不判定失败(避免重复投递)。
          this.noteEndpointOutbound({ kind: 'participant-user', id: target.id }, false, String(error), address)
          this.report('warn', story, 'intent-due', '消息投递超时（结果未知，等待补偿确认） 参与者=%s 错误=%s', target.id, error)
          if (recordFailures) await this.recordOutgoingDeliveryFailure(story, target.id, message, String(error), 'pending')
        } else {
          this.noteEndpointOutbound({ kind: 'participant-user', id: target.id }, false, String(error), address)
          this.report('error', story, 'intent-due', '消息投递失败 参与者=%s 错误=%s', target.id, error)
          if (recordFailures) await this.recordOutgoingDeliveryFailure(story, target.id, message, `transport-failed: ${String(error)}`, failureStatus)
        }
      }
    }
    return delivered
  }

  /** Confirm visible delivery only after the platform accepted the message.
   * Failed attempts become explicit system evidence rather than fictional
   * character speech, and deliberately do not auto-retry to avoid duplicates
   * when an adapter fails after it has already accepted a request. */
  private async confirmOutgoingDeliveries(story: InterludeStory, delivered: OutgoingMessageDraft[], splitSegment = false) {
    const generation = this.deliveryGeneration(story.id)
    const confirmed: ScriptEntry[] = []
    for (const message of delivered) {
      const entry = await runStorySerialized(this, story.id, async () => {
        if (this.databaseResetting || this.deliveryGeneration(story.id) !== generation) return undefined
        const participant = await this.getParticipant(message.participantId)
        if (!participant) return undefined
        const now = new Date()
        const content = message.quoteMessageId ? '[主角引用了此前的一条消息]' : message.content
        const existing = message.scriptEvent?.scriptEntryId ? await this.successfulDeliveryEntry(story.id, message) : undefined
        if (this.databaseResetting || this.deliveryGeneration(story.id) !== generation) return undefined
        const persistedEntry = existing ?? await this.appendEntry(story.id, {
          kind: 'character-message', actor: 'character', content,
          occurredAt: now.toISOString(),
          metadata: deliveryEntryMetadata(message, message.quoteMessageId
            ? { quoteMessageId: message.quoteMessageId, quoteTransport: true }
            : splitSegment ? { splitSegment: true } : {}),
        }, now, participant.id)
        if (message.scriptEvent) await this.updateScriptDeliveryOutcome(story.id, message.scriptEvent, 'delivered', now)
        if (!existing) await this.recordCharacterMessage(participant, now)
        if (!existing && message.automaticDelivery) await this.recordAutomaticDelivery(story.id, participant.id, message.automaticDelivery, now)
        const splitIntents = message.laterSegments?.length && message.scriptEvent
          ? await this.dbGet('interlude_intent', { storyId: story.id, participantId: participant.id, type: 'split-message' }) as NarrativeIntent[] : []
        let delay = 0
        for (const [index, segment] of (message.laterSegments ?? []).entries()) {
          delay += this.typingDelayMilliseconds(segment)
          const sendAt = new Date(now.getTime() + delay)
          if (splitIntents.some(intent => {
            const ref = restoreMessageEvent(intent.payload, segment)
            return ref && ref.scriptEntryId === message.scriptEvent?.scriptEntryId && ref.commitId === message.scriptEvent?.commitId
              && ref.eventId === message.scriptEvent?.eventId && ref.bubbleIndex === index + 1
          })) continue
          await this.appendIntent(story.id, {
            type: 'split-message', summary: 'The character is still typing the next message segment.',
            notBefore: sendAt.toISOString(),
            payload: {
              content: segment, visibleMessage: true, userInitiated: message.userInitiated === true,
              ...scriptEventPayload(message, index + 1),
              ...(message.automaticDelivery ? { automaticDelivery: message.automaticDelivery } : {}),
            },
          }, now, participant.id)
          this.scheduleDueIntentWake(story.id, sendAt)
        }
        return persistedEntry
      })
      if (entry) confirmed.push(entry)
    }
    return confirmed
  }

  private async recordOutgoingDeliveryFailure(
    story: InterludeStory,
    participantId: string,
    message: OutgoingMessageDraft,
    reason: string,
    status: 'failed' | 'pending' = 'failed',
  ) {
    await runStorySerialized(this, story.id, async () => {
      const now = new Date()
      if (message.scriptEvent) await this.updateScriptDeliveryOutcome(story.id, message.scriptEvent, status, now, clip(reason, 500))
      // A recovery attempt must not turn a transient endpoint outage into a
      // terminal failure or add a second fictional transcript entry. The
      // durable ledger stays pending and the process-local backoff decides when
      // the next compensation pass retries it.
      if (status === 'pending') return
      // Agency 放行时预记的每日配额随终态失败作废：拦截/传输失败不该烧掉
      // 主动联系预算（已在串行段内，直接读改写故事状态）。
      if (message.proactiveContactRef) {
        try {
          const rows = await this.dbGet('interlude_story', { id: story.id })
          const current = rows[0] as InterludeStory | undefined
          const state = current ? decodeStoryState(current.state) : undefined
          const log = state?.proactiveContactLog ?? []
          if (log.some(entry => entry.ref === message.proactiveContactRef && !entry.voided)) {
            state!.proactiveContactLog = log.map(entry => entry.ref === message.proactiveContactRef ? { ...entry, voided: true } : entry)
            await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState(state!), updatedAt: now })
          }
        } catch (error) {
          this.reportOperation('diagnostic', 'warn', story, 'intent-due', '主动联系配额作废失败（不影响失败记录） 错误=%s', error)
        }
      }
      await this.appendEntry(story.id, {
        kind: 'outgoing-delivery-failed', actor: 'system',
        content: `未投递的主角消息（仍未发送，不能视为用户已收到）：${clip(message.content, this.config.runtime.maxMessageCharacters)}`,
        occurredAt: now.toISOString(),
        metadata: {
          status: 'failed', participantId, reason: clip(reason, 500),
          ...(message.scriptEvent ?? {}),
          ...(message.automaticDelivery ? { automaticDelivery: message.automaticDelivery } : {}),
        },
      }, now, participantId)
    })
  }

  /** Agency/策略拦截补偿：未进入投递管线的私聊行动统一记为 cancelled，
   * 并追加明确的"从未发送"历史条目。deliveryReality 会把 cancelled 标注为
   * withdrawn，后续轮次的模型才能区分"想发"与"已发出"。 */
  private async recordWithdrawnOutgoingEvents(
    story: InterludeStory,
    actions: Array<{ participantId: string; content: string; event?: ScriptCommitDraft['events'][number] }>,
    commit: ScriptCommitDraft | undefined,
    scriptEntry: ScriptEntry | undefined,
    reason: string,
    at: Date,
    phase: NarrativeRequest['phase'] = 'advance',
  ) {
    if (!actions.length) return
    // advance / proactive-check already own the story queue. Queue only external
    // callers: awaiting a second serial task here would wait on the current task.
    await runStorySerialized(this, story.id, async () => {
      for (const action of actions) {
        // Cross-account actions are matched by participant/content for legacy
        // drafts. Interaction replies pass the exact event from the commit so
        // delayed replies and synthesized proactive-check replies are covered
        // as well.
        const event = action.event?.kind === 'outgoing-message'
          ? action.event
          : commit ? findPrivateOutgoingMessageEvent(commit, action.participantId, 'immediate', action.content, this.config.runtime.messageSeparator) : undefined
        if (scriptEntry && event) {
          // 撤销该行动的全部账本分段(updateScriptDeliveryOutcome 每次只落一段)
          const entry = (await this.dbGet('interlude_script_entry', { id: scriptEntry.id }))[0] as ScriptEntry | undefined
          const ledger = entry?.metadata?.deliveryActions
          const target = Array.isArray(ledger)
            ? ledger.find((item: unknown) => isRecord(item) && item.commitId === event.commitId && item.eventId === event.eventId)
            : undefined
          const indexes = isRecord(target) && Array.isArray(target.segments)
            ? target.segments.map((segment: unknown) => Number(isRecord(segment) ? segment.index : NaN)).filter(Number.isInteger)
            : []
          for (const segmentIndex of indexes.length ? indexes : [0]) {
            await this.updateScriptDeliveryOutcome(story.id,
              { commitId: event.commitId, eventId: event.eventId, scriptEntryId: scriptEntry.id, segmentIndex },
              'cancelled', at, reason)
          }
        }
        await this.appendEntry(story.id, {
          kind: 'outgoing-delivery-failed', actor: 'system',
          content: `未进入投递管线的主动消息（从未发送，对方不可能收到）：${clip(action.content, this.config.runtime.maxMessageCharacters)}`,
          occurredAt: at.toISOString(),
          metadata: {
            status: 'cancelled', participantId: action.participantId, reason: clip(reason, 500),
            ...(event ? messageEventReference(event, 0, scriptEntry?.id) ?? {} : {}),
          },
        }, at, action.participantId)
      }
      this.reportOperation('standard', 'info', story, phase,
        '主动消息拦截补偿:行动已标记为未发出(cancelled) 数量=%d 原因=%s', actions.length, clip(reason, 120))
    })
  }

  /** Update the M6.1 ledger stored beside the authoritative script. Callers
   * already hold the story queue, so this helper never opens a nested serial
   * section and cannot reorder platform delivery. */
  private async updateScriptDeliveryOutcome(
    storyId: string,
    reference: Pick<ScriptDeliveryReference, 'commitId' | 'eventId'> & {
      scriptEntryId?: number
      segmentIndex?: number
      bubbleIndex?: number
    },
    status: ScriptDeliverySegmentStatus,
    at: Date,
    reason?: string,
  ) {
    if (!Number.isSafeInteger(reference.scriptEntryId)) return
    try {
      const entry = (await this.dbGet('interlude_script_entry', { id: reference.scriptEntryId }))[0] as ScriptEntry | undefined
      if (!entry || entry.storyId !== storyId || entry.metadata?.commitId !== reference.commitId) return
      const normalized: ScriptDeliveryReference = {
        commitId: reference.commitId,
        eventId: reference.eventId,
        scriptEntryId: reference.scriptEntryId!,
        segmentIndex: reference.segmentIndex ?? reference.bubbleIndex ?? 0,
      }
      const actions = updateScriptDeliveryActions(entry.metadata?.deliveryActions, normalized, status, at, reason)
      const metadata: Record<string, any> = { ...entry.metadata, ...(actions ? { deliveryActions: actions } : {}) }
      if (actions) await this.dbSet('interlude_script_entry', { id: entry.id }, { metadata })
      const delivered = Array.isArray(metadata.deliveryActions)
        ? metadata.deliveryActions.find(action => isRecord(action) && action.commitId === reference.commitId && action.eventId === reference.eventId && action.status === 'delivered') : undefined
      const events = Array.isArray(metadata.scriptEvents) ? metadata.scriptEvents : []
      const event = events.find(item => isRecord(item) && item.commitId === reference.commitId && item.eventId === reference.eventId && item.kind === 'outgoing-message')
      if (delivered && event?.participantId && metadata.followUpResolutionEventId !== event.eventId) {
        const resolutions = normalizeFollowUpResolutions(event.metadata?.followUpResolutions)
        const commitment = normalizeFollowUpCommitment(event.metadata?.followUpCommitment, toDate(entry.occurredAt) ?? at)
        if (resolutions.length || commitment) {
          await this.applyFollowUpResolutions(storyId, event.participantId, resolutions,
            { seen: false, reply: { mode: 'immediate', content: event.content } }, at, event.eventId)
          if (commitment) await this.appendFollowUpCommitment(await this.getStory(storyId), event.participantId, commitment, entry.id, at, event.eventId)
          await this.dbSet('interlude_script_entry', { id: entry.id }, {
            metadata: { ...metadata, followUpResolutionEventId: event.eventId },
          })
        }
      }
    } catch (error) {
      // M6.1 is observational: a failed ledger write must not prevent the
      // caller from scheduling remaining bubbles or executing platform actions.
      this.reportStandalone('warn', '投递账本记录失败 故事=%s 事件=%s；保留平台结果并继续原投递链 错误=%s', storyId, reference.eventId, error)
    }
  }

  private async recordPlatformDeliveryOutcome(
    storyId: string,
    reference: ScriptDeliveryReference,
    status: Exclude<ScriptDeliverySegmentStatus, 'pending'>,
    reason?: string,
  ) {
    try {
      await this.serial(storyId, async () => this.updateScriptDeliveryOutcome(storyId, reference, status, new Date(), reason))
    } catch (error) {
      this.reportStandalone('warn', '平台行动结果记录失败 故事=%s 事件=%s segment=%d 错误=%s', storyId, reference.eventId, reference.segmentIndex, error)
    }
  }

  private async resolveLiteralQuoteMessageId(storyId: string, participantId: string, content: string) {
    const quoted = literalQuoteText(content)
    if (!quoted) return undefined
    const entries = await this.dbGet('interlude_script_entry', { storyId, participantId }, {
      limit: 120, sort: { occurredAt: 'desc' },
    }) as ScriptEntry[]
    const matched = entries.find(entry => entry.content.trim() === quoted && targetableMessageId(entry.metadata?.messageId))
    return matched ? targetableMessageId(matched.metadata?.messageId) : undefined
  }

  /** Records only completed background deliveries. It is intentionally a
   * bounded action ledger, rather than a duplicate conversation transcript. */
  private async recordAutomaticDelivery(
    storyId: string,
    participantId: string,
    delivery: NonNullable<OutgoingMessageDraft['automaticDelivery']>,
    now: Date,
  ) {
    try {
      // urge 确认与摘要合并都是对 story.state 的读-改-写,必须与 receive/advance
      // 的串行回合互斥——旧快照覆盖会丢 armed/burst、打乱 nextAdvanceAt 或回退
      // 摘要列表。serial 外的调用点(分段投递/投递确认)整段入队;serial 内的
      // 调用点(advanceUnlocked)直接执行——serial 不可重入,再排队会死锁。
      const run = async () => {
        if (this.urgeConfig?.enabled && delivery.sourceEntryId) {
          const current = await this.getStory(storyId)
          const state = decodeStoryState(current.state)
          const prior = normalizeUrgeState(state.extensions?.urge, now.getTime())
          const urge = acknowledgeUrge(prior, participantId, delivery.sourceEntryId, now.getTime())
          if (urge !== prior) {
            await this.dbSet('interlude_story', { id: storyId }, { state: encodeStoryState({ ...state, extensions: { ...state.extensions, urge } }), updatedAt: now })
            await this.scheduleUrgeAdvance(await this.getStory(storyId), now)
          }
        }
        if (delivery.sourceEntryId) {
          const entry = (await this.dbGet('interlude_script_entry', { storyId, id: delivery.sourceEntryId }))[0] as ScriptEntry | undefined
          const actions = entry?.metadata?.deliveryActions
          if (Array.isArray(actions)) {
            const speech = actions.filter(action => isRecord(action) && action.participantId === participantId && action.eventKind === 'outgoing-message')
            if (speech.length && speech.some(action => action.status !== 'delivered')) return
          }
        }
        const story = await this.getStory(storyId)
        const state = decodeStoryState(story.state)
        const summary = clip(delivery.summary, 240).trim()
        if (!summary) return
        const prior = state.automaticDeliverySummaries ?? []
        const same = prior.find(item => item.participantId === participantId && item.sourceEntryId === delivery.sourceEntryId)
        const next: AutomaticDeliverySummary = {
          participantId, summary: same ? mergeDeliverySummary(same.summary, summary) : summary,
          ...(delivery.sourceEntryId ? { sourceEntryId: delivery.sourceEntryId } : {}),
          deliveredAt: now.toISOString(),
        }
        const retained = prior.filter(item => item !== same)
        retained.push(next)
        await this.dbSet('interlude_story', { id: story.id }, {
          state: encodeStoryState({ ...state, automaticDeliverySummaries: retained.slice(-6) }), updatedAt: now,
        })
      }
      if (this.inSerial(storyId)) await run()
      else await this.serial(storyId, run)
    } catch (error) {
      // A summary is a projection, never a prerequisite for remaining bubbles.
      this.reportStandalone('warn', '自动通信摘要记录失败，保留原文与投递主链 错误=%s', error)
    }
  }

  private splitOutgoingMessage(content: string) {
    return splitVisibleReplyBubbles(content, {
      separator: this.config.runtime.messageSeparator?.trim() || '<sep/>',
      splitEnabled: this.config.runtime.splitReplyMessages !== false,
      newlineAsSeparator: this.config.runtime.convertNewlineToSeparator === true,
    })
  }

  private typingDelayMilliseconds(nextSegment: string) {
    const baseSeconds = Math.max(0, this.config.runtime.typingBaseDelaySeconds ?? 1)
    const charactersPerSecond = Math.max(1, this.config.runtime.typingCharactersPerSecond ?? 8)
    const maximumSeconds = Math.max(baseSeconds, this.config.runtime.typingMaxDelaySeconds ?? 12)
    const nominal = Math.min(maximumSeconds, baseSeconds + Math.ceil(nextSegment.length / charactersPerSecond))
    const jitter = Math.max(0, Math.min(0.5, Number(this.config.runtime.typingJitterRatio ?? 0.3) || 0))
    const factor = jitter ? 1 + (Math.random() * 2 - 1) * jitter : 1
    return Math.max(250, Math.min(maximumSeconds * Time.second, Math.round(nominal * factor * Time.second)))
  }

  /** 首条发言的打字时间下限：以叙事请求发起时刻为基准，模型耗时不足
   * typingDelay(首条字数) 时返回需补足的毫秒数；耗时已超过则返回 0（立即发送）。
   * elapsed 以 0 为下限——起点时间戳异常（时钟偏差）不会反向放大等待。 */
  private firstMessageTypingHoldMs(content: string, requestStartedAt: Date) {
    const floor = this.typingDelayMilliseconds(content)
    const elapsed = Math.max(0, Date.now() - requestStartedAt.getTime())
    return Math.max(0, floor - elapsed)
  }

  private findBotForParticipant(participant: InterludeParticipant) {
    // M1a：出站地址经端点注册表解析（私聊全链唯一收口——即时/延迟/主动）；
    // 注册表未命中回落旧字段，行为与现状一致。
    const address = this.endpointAddressSync({ platform: participant.platform, selfId: participant.selfId }, { kind: 'participant-user', id: participant.id })
    return this.ctx.bots.find(bot =>
      String(bot.selfId) === String(address.selfId)
      && (bot.platform === address.platform || isOneBotPlatform(bot.platform) && isOneBotPlatform(address.platform)))
  }

  private get autoAdvanceConfig(): AutoAdvanceConfig {
    if (this.cachedAutoAdvanceConfig) return this.cachedAutoAdvanceConfig
    const runtime = this.config.runtime
    return this.cachedAutoAdvanceConfig = {
      enabled: runtime.autoAdvanceEnabled ?? true,
      intervalMinutes: Math.max(1, runtime.autoAdvanceIntervalMinutes ?? 40),
      jitterMinutes: Math.max(0, runtime.autoAdvanceJitterMinutes ?? 5),
      followUpMinutes: normalizeFollowUpMinutes(runtime.conversationFollowUpMinutes),
      followUpJitterMinutes: Math.max(0, Math.min(10, runtime.conversationFollowUpJitterMinutes ?? 1)),
      restWindows: runtime.restWindows ?? [{
        enabled: true, label: 'night sleep', start: '23:00', end: '07:00',
        minIntervalMinutes: 120, maxIntervalMinutes: 240,
      }],
    }
  }

  private get urgeConfig() { return resolveUrgeConfig(this.config.urge) }

  private get effectiveUrgeRuntime(): RuntimeConfig {
    return this.urgeConfig.enabled
      ? { ...this.config.runtime, proactiveWillingnessThreshold: this.urgeConfig.willingness }
      : this.config.runtime
  }

  private async scheduleUrgeAdvance(story: InterludeStory, anchor: Date, incoming = false) {
    const config = this.urgeConfig
    const state = decodeStoryState(story.state)
    let urge = normalizeUrgeState(state.extensions?.urge, anchor.getTime())
    if (incoming) urge = urgeUserEvent(urge, anchor.getTime())
    const rest = activeRestWindow(this.autoAdvanceConfig.restWindows, story.setting.timezone, anchor)
    const window = activeAgencyWindow(state.agencyWindow, anchor)
    // 五档生活节奏：压缩器主写/主叙事或入站覆盖；stale 时走 restMultiplier 兜底。
    const rhythmRaw = state.lifeRhythm ?? lifeRhythmFromLegacyStatus(state.lifeStatus)
    const rhythm: UrgeRhythmInput | undefined = rhythmRaw
      ? { attention: rhythmRaw.attention, stale: lifeRhythmStale(rhythmRaw, anchor.getTime()) }
      : undefined
    const planned = planUrge(urge, anchor.getTime(), config,
      rest ? 1 : 0,
      !!window && (window.deviceAccess !== 'available' || window.activityLoad === 'overloaded'),
      undefined, rhythm)
    const ordinary = new Date(planned.nextAdvanceAt)
    const next = planned.reason === 'conversation-density-decay' ? await this.schedulePreplanAnchoredTime(story, anchor, ordinary) : ordinary
    await this.dbSet('interlude_story', { id: story.id }, {
      state: encodeStoryState({ ...state,
        extensions: { ...state.extensions, urge: { ...planned.state, mode: JSON.stringify(config) } },
        automation: { ...state.automation, quietUntil: undefined, conversationFollowUpAt: [], conversationFollowUpParticipantId: undefined,
          ...(incoming ? { lastUserMessageAt: anchor.toISOString() } : {}), nextAdvanceAt: next.toISOString() },
      }), updatedAt: anchor,
    })
    this.reportOperation('standard', 'info', story, 'advance', 'Urge 调度 档位=%s 原因=%s 节奏=%s%s 下次=%s 加速已用=%d/%d',
      config.frequency, planned.reason,
      rhythm?.attention ?? '(无)',
      rhythm?.stale === true ? '(stale)' : '',
      formatLogTime(next, story.setting.timezone), planned.state.burst?.used ?? 0, config.budget)
  }

  /** 入站消息→节奏提升:asleep/resting → phone-focused(source: incoming)。 */
  private async elevateRhythmOnIncoming(storyId: string, now: Date) {
    try {
      const story = await this.getStory(storyId)
      if (!story) return
      const state = decodeStoryState(story.state)
      const rhythm = state.lifeRhythm
      if (rhythm && (rhythm.attention === 'asleep' || rhythm.attention === 'resting')) {
        const next = { attention: 'phone-focused' as const, basis: '收到用户消息，她在看手机', assessedAt: now.toISOString(), source: 'incoming' as const }
        await this.dbSet('interlude_story', { id: storyId }, {
          state: encodeStoryState({ ...state, lifeRhythm: next }), updatedAt: now,
        })
        this.reportOperation('diagnostic', 'debug', story, 'user-message', '生活节奏提升 %s→phone-focused(入站触发)', rhythm.attention)
      }
    } catch { /* 节奏提升是尽力而为;失败不阻塞入站消息 */ }
  }

  private isAutomaticAdvancePaused(story: InterludeStory, now: Date) {
    const quietUntil = toDate(story.state.automation?.quietUntil)
    return !!quietUntil && quietUntil > now
  }

  private dueConversationFollowUps(story: InterludeStory, now: Date) {
    if (this.urgeConfig.enabled) return []
    const planned = (story.state.automation?.conversationFollowUpAt ?? [])
      .map(toDate)
      .filter((value): value is Date => !!value)
      .sort((left, right) => left.getTime() - right.getTime())
    return planned.filter(value => value <= now)
  }

  /** Remove elapsed short passes after their single writing turn. The next
   * remaining pass stays persisted, so reloads never restart the 10/20-minute
   * sequence or accidentally run both passes at once. */
  private async completeConversationFollowUps(storyId: string, now: Date) {
    const story = await this.getStory(storyId)
    const remaining = (story.state.automation?.conversationFollowUpAt ?? [])
      .map(toDate)
      .filter((value): value is Date => !!value && value > now)
      .sort((left, right) => left.getTime() - right.getTime())
    const automation = {
      ...(story.state.automation ?? {}),
      conversationFollowUpAt: remaining.map(value => value.toISOString()),
      ...(remaining.length ? {} : { conversationFollowUpParticipantId: undefined }),
      nextAdvanceAt: remaining[0]?.toISOString(),
    }
    await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState({ ...decodeStoryState(story.state), automation }), updatedAt: now })
    return remaining.length > 0
  }

  private isAutomaticAdvanceDue(story: InterludeStory, now: Date) {
    const config = this.autoAdvanceConfig
    if (!config.enabled) return false
    const scheduled = toDate(story.state.automation?.nextAdvanceAt)
    if (scheduled) return scheduled <= now
    // Stories created before this scheduler existed have no persisted next time.
    // Use the normal cadence once, then persist a randomized schedule afterwards.
    return now.getTime() - story.cursorAt.getTime() >= config.intervalMinutes * Time.minute
  }

  private async pauseAutomaticAdvanceAfterUserMessage(storyId: string, now: Date) {
    // Cancel the old post-conversation cadence as soon as a new message
    // arrives. The new cadence is set after this turn has actually decided
    // whether it replies now, later, or not at all.
    const story = await this.getStory(storyId)
    if (this.urgeConfig.enabled) return this.scheduleUrgeAdvance(story, now, true)
    const fallbackNext = await this.schedulePreplanAnchoredTime(story, now, new Date(now.getTime() + automaticIntervalMinutes(story, now, this.autoAdvanceConfig) * Time.minute))
    const automation = {
      ...(story.state.automation ?? {}),
      conversationFollowUpAt: [],
      conversationFollowUpParticipantId: undefined,
      quietUntil: undefined,
      lastUserMessageAt: now.toISOString(),
      // Covers group-gate silence and provider failures: no old short timer
      // may fire while this fresh conversation event is still unresolved.
      nextAdvanceAt: fallbackNext.toISOString(),
    }
    await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState({ ...decodeStoryState(story.state), automation }), updatedAt: now })
  }

  private async pauseAutomaticAdvanceAfterDelayedReply(storyId: string, now: Date, participantId = '') {
    await this.scheduleConversationFollowUpsAfterTurn(storyId, now, undefined, participantId)
  }

  /** Schedule the 10/20-minute continuity passes from the actual endpoint of
   * a conversation. A delayed reply anchors them after its planned send time. */
  private async scheduleConversationFollowUpsAfterTurn(storyId: string, now: Date, rawInteraction?: NarrativeInteraction, participantId = '') {
    const config = this.autoAdvanceConfig
    if (!config.enabled) return
    const story = await this.getStory(storyId)
    const interaction = rawInteraction ? normalizeInteraction(rawInteraction, now, this.config.runtime) : undefined
    const delayedUntil = interaction?.reply?.mode === 'delayed' ? toDate(interaction.reply.sendAt) : undefined
    const anchor = delayedUntil && delayedUntil > now ? delayedUntil : now
    if (this.urgeConfig.enabled) return this.scheduleUrgeAdvance(story, anchor)
    // Sleep/rest windows keep their low-frequency cadence: do not wake the
    // story twice in twenty minutes merely because a conversation ended near
    // bedtime.
    const followUps = activeRestWindow(config.restWindows, story.setting.timezone, anchor)
      ? []
      : scheduleConversationFollowUps(anchor, config)
    const ordinaryNext = followUps.at(-1) ?? new Date(anchor.getTime() + automaticIntervalMinutes(story, anchor, config) * Time.minute)
    const normalNext = followUps.length ? ordinaryNext : await this.schedulePreplanAnchoredTime(story, anchor, ordinaryNext)
    const automation = {
      ...(story.state.automation ?? {}),
      // Follow-ups are the only special post-conversation schedule. Regular
      // 40-minute cadence resumes after the final short pass, not from every
      // incoming message.
      quietUntil: undefined,
      conversationFollowUpAt: followUps.map(value => value.toISOString()),
      conversationFollowUpParticipantId: followUps.length ? participantId || undefined : undefined,
      nextAdvanceAt: normalNext.toISOString(),
    }
    await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState({ ...decodeStoryState(story.state), automation }), updatedAt: now })
    this.reportOperation('standard', 'info', story, 'conversation-follow-up', '已更新对话后续计划 短期补写=%s 常规推进=%s',
      followUps.length ? followUps.map(value => formatLogTime(value, story.setting.timezone)).join('、') : '无',
      formatLogTime(normalNext, story.setting.timezone))
  }

  private async scheduleNextAutomaticAdvance(storyId: string, now: Date) {
    const config = this.autoAdvanceConfig
    if (!config.enabled) return
    const story = await this.getStory(storyId)
    if (this.urgeConfig.enabled) return this.scheduleUrgeAdvance(story, now)
    const intervalMinutes = automaticIntervalMinutes(story, now, config)
    const ordinaryNext = new Date(now.getTime() + intervalMinutes * Time.minute)
    const nextAdvanceAt = await this.schedulePreplanAnchoredTime(story, now, ordinaryNext)
    const automation = {
      ...(story.state.automation ?? {}),
      quietUntil: undefined,
      conversationFollowUpAt: [],
      conversationFollowUpParticipantId: undefined,
      lastAutoAdvanceAt: now.toISOString(),
      nextAdvanceAt: nextAdvanceAt.toISOString(),
    }
    await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState({ ...decodeStoryState(story.state), automation }), updatedAt: now })
    this.reportOperation('standard', 'info', story, 'advance', '已设置下次自动推进 时间=%s 间隔=%d分钟%s', formatLogTime(nextAdvanceAt, story.setting.timezone), Math.max(1, Math.round((nextAdvanceAt.getTime() - now.getTime()) / Time.minute)), nextAdvanceAt < ordinaryNext ? '（Schedule Preplan 锚点）' : '')
  }

  private async schedulePreplanAnchoredTime(story: InterludeStory, now: Date, ordinaryNext: Date) {
    if (!this.schedulePreplanConfig.enabled || !this.schedulePreplanConfig.anchorAutoAdvance) return ordinaryNext
    const schedule = await this.getSchedulePreplan(story.id)
    const transition = nextSchedulePreplanTransition(schedule, now, story.setting.timezone, 12)
    return transition && transition > now && transition < ordinaryNext ? transition : ordinaryNext
  }

  private get sharedStoryConfig(): SharedStoryConfig {
    if (this.cachedSharedStoryConfig) return this.cachedSharedStoryConfig
    const { enabled: _legacyEnabled, ...overrides } = this.config.sharedStory ?? {}
    return this.cachedSharedStoryConfig = {
      // Beta2 deliberately keeps the single-story guard hard-enabled. Older
      // builds exposed a rollback switch here, but turning it off could create
      // fresh per-account stories that a later background sweep would revive.
      enabled: true,
      autoEnrollParticipants: true,
      allowCrossConversationMessages: true,
      shareParticipantDetails: false,
      maxCrossConversationActions: 1,
      participantContextLimit: 6,
      managerAccounts: [],
      participantPresets: [],
      ...overrides,
    }
  }

  private mainModelLabel() {
    const route = this.modelRouting.main
    const provider = route.providers[0]
    const providerLabel = provider?.label?.trim() || provider?.id || ''
    const model = route.assigned ? provider?.model : route.target.model || provider?.model || '未配置'
    return providerLabel ? `${providerLabel}/${model}` : model
  }

  private participantPreset(userId: string) {
    return (this.sharedStoryConfig.participantPresets ?? []).find(preset =>
      preset.enabled !== false && normalizeAccountId(preset.qq) === normalizeAccountId(userId))
  }

  /** The clean Canon used both by story creation and a full administrative reset. */
  private initialStorySetting(name?: string): StorySetting {
    const setting = emptyStorySetting()
    const defaults = this.config.storyDefaults
    setting.character.name = name?.trim() || defaults.characterName || setting.character.name
    setting.character.profile = defaults.characterProfile
    setting.user.displayName = 'Multiple participants'
    setting.user.profile = defaults.userProfile
    setting.relationship = defaults.relationship
    setting.world = defaults.world
    setting.perspective = clip(defaults.perspective, 1_200)
    // 多条独立视角：去空去重、截断，保留为独立条目不合并。
    const perspectives = Array.isArray(defaults.perspectives)
      ? defaults.perspectives.filter(p => typeof p === 'string' && p.trim()).map(p => clip(p, 800)).slice(0, 12)
      : []
    if (perspectives.length) setting.perspectives = perspectives
    // 补充事实：复杂世界/人物/关系事实，同规则截断。
    const supplementary = Array.isArray(defaults.supplementaryFacts)
      ? defaults.supplementaryFacts.filter(f => typeof f === 'string' && f.trim()).map(f => clip(f, 800)).slice(0, 20)
      : []
    if (supplementary.length) setting.supplementaryFacts = supplementary
    setting.supportingCast = defaults.supportingCast
    setting.location = defaults.location
    setting.style = defaults.style || setting.style
    setting.timezone = defaults.timezone || setting.timezone
    return setting
  }

  /** Rebuild per-account relationship baselines and discard evolving state. */
  private async resetParticipantCanon(storyId: string, now: Date) {
    const participants = await this.dbGet('interlude_participant', { storyId })
    for (const participant of participants) {
      const account = this.userAccountRule(participant.userId)
      const preset = this.participantPreset(participant.userId)
      await this.dbSet('interlude_participant', { id: participant.id }, {
        personId: account?.personId?.trim() || preset?.personId?.trim() || participant.personId || participant.userId,
        displayName: account?.label?.trim() || preset?.label?.trim() || participant.displayName || participant.userId,
        profile: account?.profile?.trim() || preset?.profile?.trim() || this.config.storyDefaults.userProfile,
        relationship: account?.relationship?.trim() || preset?.relationship?.trim() || this.config.storyDefaults.relationship,
        state: emptyParticipantState(),
        updatedAt: now,
      })
    }
  }

  private userAccountRule(userId: string) {
    const accounts = this.config.onebot?.userAccounts ?? []
    const normalized = normalizeAccountId(userId)
    return accounts.find(account => account.enabled !== false && normalizeAccountId(account.qq) === normalized)
  }

  private async getParticipant(id: string) {
    return (await this.dbGet('interlude_participant', { id }))[0]
  }

  private async recordIncomingMessage(participant: InterludeParticipant, now: Date) {
    const current = normalizeParticipantState(participant.state)
    const state: ParticipantState = {
      ...current,
      unreadMessageCount: current.unreadMessageCount + 1,
      pendingReplyCount: current.pendingReplyCount + 1,
      lastUserMessageAt: now.toISOString(),
    }
    await this.dbSet('interlude_participant', { id: participant.id }, { state, updatedAt: now })
    return { ...participant, state, updatedAt: now }
  }

  private async markParticipantSeen(participant: InterludeParticipant, now: Date) {
    const current = normalizeParticipantState(participant.state)
    const state: ParticipantState = { ...current, unreadMessageCount: 0 }
    await this.dbSet('interlude_participant', { id: participant.id }, { state, updatedAt: now })
    return { ...participant, state, updatedAt: now }
  }

  private async recordCharacterMessage(participant: InterludeParticipant, now: Date) {
    const current = normalizeParticipantState(participant.state)
    const state: ParticipantState = {
      ...current, unreadMessageCount: 0, pendingReplyCount: 0,
      lastCharacterMessageAt: now.toISOString(),
    }
    await this.dbSet('interlude_participant', { id: participant.id }, { state, updatedAt: now })
    return { ...participant, state, updatedAt: now }
  }

  private async updateParticipantState(participant: InterludeParticipant, patch: Partial<ParticipantState>, now: Date) {
    const state = mergeParticipantState(normalizeParticipantState(participant.state), patch)
    await this.dbSet('interlude_participant', { id: participant.id }, { state, updatedAt: now })
    return { ...participant, state, updatedAt: now }
  }

  /** Converts one old account-bound story into a bot-bound shared story once. */
  private async migrateLegacyStory(legacy: InterludeStory, session: Session) {
    const now = new Date()
    const id = storyIdForCharacter(session.platform, session.selfId)
    const existing = (await this.dbGet('interlude_story', { id }))[0]
    if (existing) {
      await this.migrateLegacyBranchIntoShared(existing, session)
      await this.ensureContinuity(existing, now)
      return existing
    }
    const story: InterludeStory = {
      ...legacy,
      id,
      platform: session.platform,
      selfId: session.selfId,
      userId: '',
      channelId: '',
      state: decodeStoryState(legacy.state),
      updatedAt: now,
    }
    try {
      await this.dbCreate('interlude_story', story)
    } catch (error) {
      // Concurrent first visits from two legacy accounts can both decide that
      // no shared row exists.  Join the row that won the primary-key race and
      // merge this branch into it instead of leaving an active legacy copy.
      const raced = (await this.dbGet('interlude_story', { id }))[0]
      if (!raced) throw error
      await this.migrateLegacyBranchIntoShared(raced, session)
      await this.ensureContinuity(raced, now)
      return raced
    }
    const participant = await this.ensureParticipant(story, session, now)
    const tables = [
      'interlude_script_entry', 'interlude_memory', 'interlude_intent',
      'interlude_scene', 'interlude_arc', 'interlude_fact', 'interlude_state_patch', 'interlude_overlay_snapshot', 'interlude_web_observation',
    ] as const
    for (const table of tables) await this.dbSet(table, { storyId: legacy.id }, { storyId: story.id } as any)
    await this.migrateSchedulePreplanRecord(legacy.id, story.id)
    // The old story only had one user, so account-bound records can safely be
    // attached to that initial relationship branch during migration.
    for (const table of ['interlude_script_entry', 'interlude_memory', 'interlude_intent', 'interlude_fact', 'interlude_state_patch', 'interlude_overlay_snapshot', 'interlude_web_observation'] as const) {
      await this.dbSet(table, { storyId: story.id }, { participantId: participant.id } as any)
    }
    await this.dbSet('interlude_story', { id: legacy.id }, { status: 'archived', updatedAt: now })
    // M1b：旧 ID 登记为别名——历史引用（外部记录/管理员操作）仍可循别名找回本故事。
    await this.recordStoryAlias(legacy.id, story.id, 'legacy-story-migration').catch(() => undefined)
    await this.ensureContinuity(story, now)
    return story
  }

  /**
   * A deployment can contain several old per-account stories. Once the first
   * one created the shared story, fold later legacy branches into it as their
   * users return; otherwise their old active rows would keep being swept in
   * parallel and create a second life for the same character.
   */
  private async migrateLegacyBranchIntoShared(story: InterludeStory, session: Session) {
    const legacyId = legacyStoryIdFor(session.platform, session.selfId, session.userId)
    if (legacyId === story.id) return
    const legacy = (await this.dbGet('interlude_story', { id: legacyId }))[0]
    if (!legacy || legacy.status === 'archived') return
    const now = new Date()
    const participant = await this.ensureParticipant(story, session, now)
    for (const table of ['interlude_script_entry', 'interlude_memory', 'interlude_intent', 'interlude_fact', 'interlude_state_patch', 'interlude_overlay_snapshot', 'interlude_web_observation'] as const) {
      await this.dbSet(table, { storyId: legacy.id }, { storyId: story.id, participantId: participant.id } as any)
    }
    await this.dbSet('interlude_story', { id: legacy.id }, { status: 'archived', updatedAt: now })
    await this.appendEntry(story.id, {
      kind: 'legacy-branch-merged', actor: 'system',
      content: `Earlier account-specific history for ${participant.displayName} was merged into the shared story.`,
      occurredAt: now.toISOString(), metadata: { legacyStoryId: legacy.id },
    }, now, participant.id)
    await this.ensureContinuity(story, now)
  }

  private get memoryConfig(): MemoryConfig {
    if (this.cachedMemoryConfig) return this.cachedMemoryConfig
    // 保持 memory 为可选配置，方便从旧版本配置平滑升级；未填写时使用保守默认值。
    return this.cachedMemoryConfig = {
      enabled: true,
      backgroundIntervalMinutes: 10,
      maxStoriesPerCompactionRun: this.config.runtime.maxStoriesPerSweep,
      sceneEntryThreshold: 16,
      sceneCharacterThreshold: 10_000,
      compactionEntryLimit: 80,
      compactionCharacterLimit: 32_000,
      sceneHookCharacters: 2_000,
      sceneSummaryCharacters: 8_000,
      arcSummaryCharacters: 12_000,
      arcPromptCharacters: 6_000,
      previousSceneSummaries: 2,
      recentEntryLimit: this.config.runtime.contextEntryLimit,
      factLimit: this.config.runtime.memoryLimit,
      factContentCharacters: 4_000,
      factImportanceWeight: 0.5,
      factConfidenceWeight: 0.35,
      factRecencyWeight: 0.15,
      semanticWeight: 0.55,
      unresolvedWeight: 0.2,
      statePatchConfidenceThreshold: 0.82,
      majorStatePatchConfidenceThreshold: 0.95,
      statePatchMinEvidence: 3,
      statePatchMinTurns: 3,
      statePatchMinDays: 2,
      statePatchCooldownHours: 72,
      autoApplyStatePatches: true,
      allowMajorStateChanges: true,
      maxFactsPerStory: 200,
      activeConsequencesEnabled: true,
      activeConsequencePromptLimit: 6,
      activeConsequenceMaxDays: 7,
      activeConsequenceDefaultStrength: 0.55,
      overlayCompressionEnabled: true,
      overlayRecentDays: 2,
      overlayMonthlyAfterDays: 10,
      overlayWeeklyWindowDays: 5,
      overlayMonthlyWindowDays: 10,
      overlayWeeklySummaryCharacters: 1_600,
      overlayMonthlySummaryCharacters: 2_400,
      ...(this.config.memory ?? {}),
    }
  }

  private get browserConfig(): BrowserConfig {
    if (this.cachedBrowserConfig) return this.cachedBrowserConfig
    const merged: BrowserConfig = {
      enabled: false,
      mode: 'deferred-only',
      allowSearch: true,
      allowVisit: true,
      searchUrlTemplate: 'https://html.duckduckgo.com/html/?q={query}',
      allowedDomains: [],
      blockedDomains: [],
      maxConcurrentPages: 1,
      maxResearchPerSweep: 1,
      navigationTimeout: 15_000,
      waitUntil: 'domcontentloaded',
      maxTextCharacters: 12_000,
      maxExcerptCharacters: 3_000,
      maxObservationsInPrompt: 4,
      cacheMinutes: 30,
      allowGroupTriggeredResearch: false,
      logObservationPreview: false,
      ...(this.config.browser ?? {}),
    }
    // Schema defaults cover Console input, but old YAML and programmatic
    // callers can still provide undefined/invalid numeric fields. Normalise
    // here so one malformed browser option cannot silently disable all due
    // research or break the page semaphore.
    return this.cachedBrowserConfig = {
      ...merged,
      maxConcurrentPages: Math.max(1, Math.min(4, Number(merged.maxConcurrentPages) || 1)),
      maxResearchPerSweep: Math.max(1, Math.min(20, Number(merged.maxResearchPerSweep) || 1)),
      navigationTimeout: Math.max(1_000, Number(merged.navigationTimeout) || 15_000),
      maxTextCharacters: Math.max(500, Number(merged.maxTextCharacters) || 12_000),
      maxExcerptCharacters: Math.max(200, Number(merged.maxExcerptCharacters) || 3_000),
      maxObservationsInPrompt: Math.max(1, Math.min(20, Number(merged.maxObservationsInPrompt) || 4)),
      cacheMinutes: Math.max(0, Number(merged.cacheMinutes) || 0),
    }
  }

  private async ensureContinuity(story: InterludeStory, now: Date) {
    // 每个故事始终应有一个活动场景和一个活动弧线。旧数据升级或手动关闭场景后，
    // 此方法负责补齐它们，并把 id 缓存在 story.state 供 Console/外部工具查看。
    let arc = await this.activeArc(story.id)
    if (!arc) {
      await this.dbCreate('interlude_arc', {
        storyId: story.id, status: 'active', title: 'Beginning', summary: '', sceneCount: 0,
        createdAt: now, updatedAt: now,
      })
      arc = await this.activeArc(story.id)
    }
    let scene = await this.activeScene(story.id)
    if (!scene) {
      await this.dbCreate('interlude_scene', {
        storyId: story.id, status: 'active', startedAt: now, endedAt: null,
        hook: '', summary: '', entryCount: 0, lastEntryId: null, createdAt: now, updatedAt: now,
      })
      scene = await this.activeScene(story.id)
      if (arc) await this.dbSet('interlude_arc', { id: arc.id }, { sceneCount: arc.sceneCount + 1, updatedAt: now })
    }
    if (arc && scene && (story.state.activeArcId !== arc.id || story.state.activeSceneId !== scene.id)) {
      const state = encodeStoryState({ ...decodeStoryState(story.state), activeArcId: arc.id, activeSceneId: scene.id })
      await this.dbSet('interlude_story', { id: story.id }, { state, updatedAt: now })
    }
  }

  private compactionFingerprint(scene: InterludeScene, entries: ScriptEntry[], chars: number) {
    const first = entries[0]?.id ?? 0
    const last = entries.at(-1)?.id ?? 0
    return `${scene.id}:${scene.lastEntryId ?? 0}:${first}-${last}:${entries.length}:${chars}`
  }

  private compactionIsBackedOff(storyId: string, fingerprint: string, now = Date.now()) {
    return this.scheduler.isBackedOff(storyId, fingerprint, now)
  }

  private noteCompactionFailure(storyId: string, fingerprint: string, error: unknown) {
    const until = Date.now() + COMPACTION_RETRY_BACKOFF
    this.scheduler.noteBackoff(storyId, fingerprint, until)
    this.reportStandaloneOperation('diagnostic', 'debug', '记忆整理进入冷却 故事=%s 冷却至=%s 错误=%s', storyId, new Date(until).toISOString(), error)
  }

  /** Confirm the database checkpoint moved after a successful compactor call.
   * A provider response alone is not enough: if the write was lost or
   * interrupted, retrying the same range on every turn would recreate the
   * token-burning loop this guard is meant to stop. */
  private async compactionCheckpointAdvanced(context: PreparedCompactionRun) {
    const expectedLastEntryId = context.sceneEntries.at(-1)?.id
    if (!expectedLastEntryId) return true
    const persisted = (await this.dbGet('interlude_scene', { id: context.scene.id }))[0] as InterludeScene | undefined
    return !!persisted && ((persisted.lastEntryId ?? 0) >= expectedLastEntryId || persisted.status === 'closed')
  }

  private scheduleCompaction(storyId: string) {
    if (!this.memoryConfig.enabled && !this.schedulePreplanConfig.enabled) return
    // P1: 去重门/让路等待/收尾释放由 scheduler 拥有；Phase 1-3 执行体在下方回调，
    // 排队时捕获的 generation 穿透整个执行体（purge/pause 后任务作废）。
    const generation = this.taskGeneration(storyId)
    this.scheduler.scheduleExclusive(storyId, async () => {
        // Phase 1 (serial): cheap reads and due checks. The queue MUST be
        // released before the compactor call — a promise-chain serial cannot
        // be re-entered from inside one of its own running tasks (that
        // deadlocks the whole story queue), so the expensive model call runs
        // unqueued and only the cheap DB writes re-acquire it afterwards.
        const prepared = await this.serial(storyId, async () => {
          if (!this.taskGenerationCurrent(storyId, generation)) return undefined
          if (this.hasPendingNarrative(storyId)) return undefined
          const story = await this.getStory(storyId)
          const review = await this.prepareSchedulePreplanReview(story, new Date())
          const context = await this.prepareCompaction(story, new Date(), false)
          return { story, review, context }
        })
        if (!prepared || (!prepared.review?.needsModel && (!prepared.context || prepared.context.phase === 'skip'))) return
        // Phase 2: the expensive model call, deliberately outside the queue.
        const startedAt = Date.now()
        const context = prepared.context?.phase === 'run' ? prepared.context : undefined
        this.reportOperation('standard', 'info', prepared.story, 'advance', '后台整理开始 条目=%d 字符=%d 场景压缩=%s SchedulePreplan=%s', context?.sceneEntries.length ?? 0, context?.chars ?? 0, context?.sceneCompactionDue ?? false, !!prepared.review?.needsModel)
        let scheduleProposal: unknown = undefined
        if (prepared.review?.needsModel && prepared.review.request) {
          try {
            scheduleProposal = await this.requestSchedulePreplan(prepared.story, prepared.review.request)
          } catch (error) {
            // Keep the review checkpoint moving even when a provider throws
            // before returning a proposal. The persistence phase will retain
            // the existing plan (or create an empty first review), preventing
            // the same daily request from firing on every maintenance sweep.
            this.report('warn', prepared.story, 'advance', 'Schedule Preplan 调用失败，将保存本日审查状态：%s', error)
          }
        }
        let decision: CompactionDecision = {}
        let compactionError: unknown = undefined
        if (context) {
          if (!this.taskGenerationCurrent(storyId, generation)) return
          try {
            decision = await this.compactor.compact(context.compactRequest)
            if (!this.taskGenerationCurrent(storyId, generation)) return
            if (context.sceneCompactionDue) {
              context.factEmbeddings = await this.prepareCompactionEmbeddings(storyId, decision, context.sceneEntries)
            }
          } catch (error) {
            compactionError = error
            this.noteCompactionFailure(storyId, context.fingerprint, error)
            this.report('warn', context.current, 'advance', '记忆压缩失败：%s', error)
          }
        }
        // Phase 3 (serial): cheap DB writes, re-queued after the model call.
        try {
          await this.serial(storyId, async () => {
            if (!this.taskGenerationCurrent(storyId, generation)) return
            if (prepared.review?.needsModel) {
              const persisted = await this.persistSchedulePreplanReview(prepared.story, prepared.review, scheduleProposal, new Date())
              if (persisted) this.schedulePreplanBackoff.delete(storyId)
              else this.schedulePreplanBackoff.set(storyId, Date.now() + SCHEDULE_PREPLAN_RETRY_BACKOFF)
            }
            // Schedule Preplan is independent background work. A scene
            // compaction failure must not discard its already completed
            // review; simply leave the scene for its own retry cooldown.
            if (context && !compactionError) {
              await this.applyCompaction(context.current, context, decision, new Date(), startedAt)
              if (!await this.compactionCheckpointAdvanced(context)) {
                throw new Error(`Compaction checkpoint did not advance (scene=${context.scene.id}, expected=${context.sceneEntries.at(-1)?.id ?? 0})`)
              }
            }
          })
          if (context && !compactionError) this.scheduler.clearBackoff(storyId)
        } catch (error) {
          if (context && !compactionError) this.noteCompactionFailure(storyId, context.fingerprint, error)
          throw error
        }
    }, {
      halted: () => this.desktopRuntimePhase === 'paused' || this.databaseResetting,
      // Let an active or debounced user turn go first. This keeps compaction
      // fully off the latency-sensitive path even during a busy conversation.
      defer: () => {
        if (!this.hasPendingNarrative(storyId)) return false
        this.reportStandaloneOperation('diagnostic', 'debug', '记忆整理等待前台回合结束 故事=%s', storyId)
        return true
      },
      onQueued: () => this.reportStandaloneOperation('diagnostic', 'debug', '记忆整理已排队 故事=%s', storyId),
    })
  }

  // ── QQ 空间（说说）通道：门控 → 审计 → 动作 → 回写 ─────────────────────
  // 通道只负责安全执行；"何时发/发什么"的决策由叙事层（后续版本）与手动命令提供。

  /** 从当前在线的 OneBot（SnowLuma/NapCat）连接取通用动作调用口。
   * 指定 preferSelfId 时严格匹配该账号——空间动作落在别的 QQ 上比失败更糟。 */
  private qzoneCaller(preferSelfId?: string): QzoneActionCaller | undefined {
    // W3（C2-3）：桌面桥接模式经动作代理——worker 内无 ctx.bots，qzone 动作由
    // 宿主代调真实上游。accountKey = onebot:<selfId>（B2 多账号注册表路由）。
    if (this.desktopOnebotActionHandler) {
      const accountKey = 'onebot:' + String(preferSelfId ?? '').trim()
      return async (action: string, params?: Record<string, unknown>) => {
        const outcome = await this.desktopOnebotActionHandler!({ accountKey, action, params })
        if (outcome.ok) return outcome.data
        // ambiguous 语义对齐 QzoneActionError：可能已到达服务端 → 不自动重试。
        const error = new QzoneActionError(outcome.error || `宿主动作代理失败：${outcome.errorCode ?? 'unknown'}`, action, undefined, outcome.ambiguous === true)
        throw error
      }
    }
    const bot = preferSelfId
      ? this.ctx.bots.find(item => isOneBotPlatform(item.platform) && String(item.selfId) === String(preferSelfId))
      : this.ctx.bots.find(item => isOneBotPlatform(item.platform))
    const internal = (bot as any)?.internal
    if (!internal || typeof internal._request !== 'function') return undefined
    return (action: string, params?: Record<string, unknown>) => internal._request(action, params)
  }

  /**
   * 执行一条空间动作（发帖/评论/点赞）：限流门 → pending 审计行（在故事串行
   * 队列内原子预留配额）→ SnowLuma 动作（网络调用留在队列外）→ 回写
   * confirmed/failed/unknown。传输类异常与“成功帧但无 tid”都记 unknown——
   * 结果不明按已发生保守计入配额，且绝不自动重试非幂等动作。
   */
  async qzoneExecute(story: InterludeStory, kind: QzoneActionKind, input: { content?: string, tid?: string, targetUin?: string, ugcRight?: number }, preferSelfId?: string): Promise<{ ok: boolean, tid?: string, error?: string }> {
    if (!this.qzoneRuntime.enabled) return { ok: false, error: 'QQ 空间通道未启用（Console → 扩展 → QQ 空间）。' }
    // M1a（路径 7）+ qzone 账号选择——显式指定 preferSelfId 时按 accountKey
    // 精确匹配本故事的角色端点，找不到直接失败（绝不自动切到其他端点）；
    // 未指定时经 endpointAddressSync 解析（多端点按最近观测选取）。
    // endpointId 随行落审计，限流门按端点分桶（历史无 id 行保守计入）。
    let qzoneAddress: { platform: string, selfId: string, endpointId?: string }
    if (preferSelfId) {
      await this.ensureEndpointRegistry().catch(() => undefined)
      const key = endpointAccountKey(story.platform, String(preferSelfId))
      const exact = this.endpointRows.find(row => row.ownerKind === 'story-role' && row.ownerId === story.id && row.accountKey === key && row.enabled)
      if (!exact) return { ok: false, error: `账号 ${preferSelfId} 未注册为本故事的角色端点（精确匹配失败，不自动切换账号）。` }
      qzoneAddress = { platform: exact.platform, selfId: exact.selfId, endpointId: exact.id }
    } else {
      qzoneAddress = this.endpointAddressSync({ platform: story.platform, selfId: story.selfId }, { kind: 'story-role', id: story.id })
    }
    const qzoneEndpointId = qzoneAddress.endpointId
    const caller = this.qzoneCaller(qzoneAddress.selfId)
    if (!caller) return { ok: false, error: `没有可用的 OneBot（SnowLuma）连接（账号 ${qzoneAddress.selfId} 不在线）；不会改用其他账号执行空间动作。` }
    const now = new Date()
    // 门控与 pending 预留在故事串行队列内完成：并发动作串行过门，杜绝双双
    // 通过限流检查后各插一行而突破日上限/最小间隔（快照模式与 flush 相同）。
    // advance/proactive-check 已持有队列——嵌套再排队会互相等待造成死锁，
    // 复用调用方的串行域（同 runStorySerialized 语义）。
    const pending = await runStorySerialized(this, story.id, async () => {
      const recent = (await this.dbGet('interlude_qzone_post', { createdAt: { $gte: new Date(now.getTime() - 48 * Time.hour) } })) as unknown as QzonePostRecord[]
      const gate = evaluateQzoneGate(qzoneRecordsForEndpoint(recent, qzoneEndpointId), this.qzoneRuntime, { kind, now })
      if (!gate.allowed) return { blocked: gate.reason as string, gate, row: undefined as undefined | { id: number } }
      const row = await this.dbCreate('interlude_qzone_post', {
        storyId: story.id, kind,
        tid: input.tid ?? '', ...(input.targetUin ? { targetUin: input.targetUin } : {}),
        ...(kind === 'post' && input.content ? { content: input.content.slice(0, 2_000), ...(input.ugcRight ? { ugcRight: input.ugcRight } : {}) } : {}),
        ...(qzoneEndpointId ? { endpointId: qzoneEndpointId } : {}),
        status: 'pending', createdAt: now,
      })
      return { blocked: undefined, gate, row: { id: row.id } }
    })
    if (pending.blocked || !pending.row) {
      const gate = pending.gate
      this.reportOperation('diagnostic', 'debug', story, 'user-message', 'QQ 空间动作被限流门拦下 类型=%s 原因=%s 今日=%d/%d', kind, pending.blocked, gate.usedToday, gate.cap)
      return { ok: false, error: pending.blocked === 'daily-cap' ? `今日${kind === 'post' ? '发帖' : kind === 'comment' ? '评论' : '点赞'}已达上限（${gate.usedToday}/${gate.cap}）。` : `距离上一条空间动作不足最小间隔（${this.qzoneRuntime.minIntervalMinutes} 分钟）。` }
    }
    const pendingId = pending.row.id
    try {
      if (kind === 'post') {
        const data = await callQzoneAction<{ tid?: string | number }>(caller, 'send_qzone_msg', { content: input.content ?? '', ugc_right: input.ugcRight ?? 4 })
        const tid = String(data.tid ?? '')
        if (!tid) {
          // 成功帧却拿不到 tid：帖子可能已发出但无法追踪——记 unknown，不宣称已确认。
          await this.dbSet('interlude_qzone_post', { id: pendingId }, { status: 'unknown', error: '服务端未返回 tid，结果未知。' }).catch(() => undefined)
          this.reportStandalone('warn', 'QQ 空间说说发表结果未知（无 tid），已按保守计入配额且不自动重试')
          return { ok: false, error: '发表结果未知：服务端未返回说说 tid，为避免重复发帖不会自动重试。' }
        }
        await this.dbSet('interlude_qzone_post', { id: pendingId }, { tid, status: 'confirmed', postedAt: new Date() })
        // 已发布的事实进剧本：她自己会记得发过什么（[空间动态] 前缀走 SOCIAL SURFACE 规则）。
        await this.appendEntry(story.id, {
          kind: 'qzone-post', actor: 'character',
          content: `[空间动态] 她发表了说说：${clip(input.content ?? '', 120)}（${qzoneVisibilityLabel(input.ugcRight ?? 4)}）`,
          occurredAt: now.toISOString(), metadata: { qzoneKind: 'post', tid, ugcRight: input.ugcRight ?? 4 },
        }, now)
        this.reportOperation('standard', 'info', story, 'user-message', 'QQ 空间说说已发表 tid=%s 可见性=%s', tid, input.ugcRight ?? 4)
        return { ok: true, tid }
      }
      if (kind === 'comment') {
        await callQzoneAction(caller, 'comment_qzone', { tid: input.tid ?? '', content: input.content ?? '', ...(input.targetUin ? { target_uin: Number(input.targetUin) } : {}) })
        await this.dbSet('interlude_qzone_post', { id: pendingId }, { status: 'confirmed', postedAt: new Date() })
        await this.appendEntry(story.id, {
          kind: 'qzone-post', actor: 'character',
          content: `[空间动态] 她评论了${input.targetUin ? ` QQ ${input.targetUin}` : ''}的说说：${clip(input.content ?? '', 80)}`,
          occurredAt: now.toISOString(), metadata: { qzoneKind: 'comment', tid: input.tid ?? '' },
        }, now)
        return { ok: true }
      }
      await callQzoneAction(caller, 'like_qzone', { tid: input.tid ?? '', ...(input.targetUin ? { target_uin: Number(input.targetUin) } : {}) })
      await this.dbSet('interlude_qzone_post', { id: pendingId }, { status: 'confirmed', postedAt: new Date() })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // ambiguous=true 表示请求可能已到达服务端（超时/断连）：记 unknown 而非
      // failed——unknown 保守计入配额（可能已发生），语义上禁止自动重试。
      const ambiguous = error instanceof QzoneActionError && error.ambiguous
      await this.dbSet('interlude_qzone_post', { id: pendingId }, { status: ambiguous ? 'unknown' : 'failed', error: message.slice(0, 500) }).catch(() => undefined)
      this.reportStandalone('warn', 'QQ 空间动作%s 类型=%s 错误=%s', ambiguous ? '结果未知' : '失败', kind, message)
      return { ok: false, error: ambiguous ? `${message}（结果未知：请求可能已生效，为避免重复不会自动重试。）` : message }
    }
  }

  /** 通道能力探测（只读）：SnowLuma 的 qzone 扩展是否可用。 */
  async qzoneAvailable(preferSelfId?: string): Promise<boolean> {
    const caller = this.qzoneCaller(preferSelfId)
    if (!caller) return false
    try { return await probeQzoneAvailable(caller) } catch { return false }
  }

  /**
   * 到期 qzone-action 意图的执行侧：payload 校验 → 限流门 → 动作 → 完成意图。
   * 坏 payload / 限流 / 通道失败都直接完成意图（成败进审计表），不回流叙事。
   */
  private async executeQzoneIntent(story: InterludeStory, intent: NarrativeIntent, now: Date) {
    const request = qzoneIntentFromPayload(intent.payload)
    const finish = async (note: string) => {
      await this.dbSet('interlude_intent', { id: intent.id }, { status: 'completed', updatedAt: now }).catch(() => undefined)
      this.reportOperation('diagnostic', 'debug', story, 'intent-due', 'QQ 空间意图已处理 意图=%d 结果=%s', intent.id, note)
    }
    if (!request) return finish('payload-invalid')
    if (request.action !== 'post') {
      // 目标来源绑定：评论/点赞的 tid 必须来自本账号实际读到并入账的好友动态
      // （feed-seen 行）或她自己已发表的说说（confirmed post 行）——模型编造
      // 的 tid 一律拒绝，防止对任意帖子执行写操作。
      const targets = (await this.dbGet('interlude_qzone_post', { tid: request.tid ?? '' })) as unknown as QzonePostRecord[]
      const known = targets.some(row => row.status === 'confirmed' && (row.kind === 'feed-seen' || row.kind === 'post'))
      if (!known) return finish('target-unknown')
    }
    const result = await this.qzoneExecute(story, request.action, {
      content: request.content, tid: request.tid, targetUin: request.targetUin, ugcRight: request.ugcRight,
    }, story.selfId)
    // 点赞成功不单独进剧本（过细）；发帖/评论的条目由 qzoneExecute 写入。
    return finish(result.ok ? 'ok' : `failed:${clip(result.error ?? '', 80)}`)
  }

  /** 好友动态轮询：感知零模型调用——新鲜说说写成 [好友动态] 条目，反应留给回合内决策。 */
  private qzoneFeedSweepRunning = false

  private async qzoneFeedSweep() {
    if (this.desktopRuntimePhase === 'paused' || this.databaseResetting || !this.qzoneRuntime.enabled || this.qzoneFeedSweepRunning) return
    this.qzoneFeedSweepRunning = true
    try {
      const story = await this.getCanonicalStory()
      if (!story || !this.canHandleStory(story)) return
      // 轮询账号经端点注册表解析（多角色端点下不再读故事旧 selfId），
      // feed-seen 审计行随记 endpointId。
      const sweepAddress = this.endpointAddressSync({ platform: story.platform, selfId: story.selfId }, { kind: 'story-role', id: story.id })
      const sweepEndpointId = (sweepAddress as { endpointId?: string }).endpointId
      const caller = this.qzoneCaller(sweepAddress.selfId)
      if (!caller) return
      const now = new Date()
      // feeds CGI 间歇失败（POC 实测）：失败静默跳过，下轮再试，不写任何条目。
      let feeds: QzoneFeedEntry[] = []
      try {
        const raw = await callQzoneAction<{ feeds?: unknown[] }>(caller, 'get_qzone_feeds', { page_num: 1, count: 20 })
        feeds = (Array.isArray(raw.feeds) ? raw.feeds : []).map(item => normalizeQzoneFeedEntry(item, now)).filter((item): item is QzoneFeedEntry => !!item)
      } catch (error) {
        // feeds CGI 间歇失败跳过本轮，但必须可见（此前零日志）。
        this.report('warn', story, 'advance', '好友动态列表拉取失败，本轮跳过 错误=%s', error)
      }
      // 去重账本：feed-seen 行的 tid 即 feeds.key（7 天窗足够覆盖时间窗的双倍）。
      const seenRows = (await this.dbGet('interlude_qzone_post', { kind: 'feed-seen', createdAt: { $gte: new Date(now.getTime() - 7 * 24 * Time.hour) } })) as unknown as QzonePostRecord[]
      const seenKeys = new Set(seenRows.map(row => String(row.tid ?? '')).filter(Boolean))
      for (const feed of qzoneFeedCandidates(feeds, seenKeys, this.qzoneRuntime, now)) {
        let content = ''
        try {
          const listRaw = await callQzoneAction<{ msglist?: unknown[] }>(caller, 'get_qzone_msg_list', { target_uin: Number(feed.uin), num: 5 })
          const entries = (Array.isArray(listRaw.msglist) ? listRaw.msglist : []).map(item => normalizeQzoneMsgEntry(item)).filter((item): item is NonNullable<typeof item> => !!item)
          content = matchQzoneFeedContent(entries, feed)
        } catch (error) {
          // 正文拉取失败按元数据处理，但必须可见。
          this.reportOperation('diagnostic', 'debug', story, 'advance', '好友动态正文拉取失败，按元数据入账 uin=%s 错误=%s', feed.uin, error)
        }
        const owner = feed.nickname || `QQ ${feed.uin}`
        // 先落 feed-seen 账本再写条目——账本失败则本轮跳过该条（下轮
        // 重新发现），杜绝"条目已写、账本未落"造成的重复 [好友动态] 入账。
        try {
          await this.dbCreate('interlude_qzone_post', { storyId: story.id, kind: 'feed-seen', tid: feed.key, targetUin: feed.uin, ...(sweepEndpointId ? { endpointId: sweepEndpointId } : {}), content: feed.nickname.slice(0, 100), status: 'confirmed', createdAt: now })
        } catch (error) {
          this.report('warn', story, 'advance', '好友动态账本写入失败，该条延后到下轮 key=%s 错误=%s', feed.key, error)
          continue
        }
        try {
          await this.appendEntry(story.id, {
            kind: 'friend-feed', actor: 'system',
            content: `[好友动态] ${owner}发布了说说${content ? `：${clip(content, 80)}` : ''}`,
            occurredAt: feed.time.toISOString(),
            metadata: { qzoneFeedKey: feed.key, qzoneFeedUin: feed.uin, qzoneFeedNickname: feed.nickname },
          }, now)
        } catch (error) {
          // 账本已落：条目失败即该动态让位（不回滚账本），只留日志。
          this.report('warn', story, 'advance', '好友动态条目写入失败，该动态让位 key=%s 错误=%s', feed.key, error)
          continue
        }
        this.reportOperation('diagnostic', 'debug', story, 'advance', '好友动态已入账 归属=%s 正文=%s', owner, content ? '有' : '无')
      }
      await this.qzoneReactionSweep(story, caller, sweepAddress, now)
    } catch (error) {
      this.reportStandalone('warn', 'QQ 空间动态轮询失败 错误=%s', error)
    } finally {
      this.qzoneFeedSweepRunning = false
    }
  }

  /** 被评论感知：她的说说评论数增量轮询。感知零动作配额；产出 [空间动态] 条目
   * （ SOCIAL SURFACE 规则现成，零提示词改动），由下一次推进（自动或对话）自然
   * 携带——轮询本身绝不调度推进（用户要求：被赞不立即开 advance）。 */
  private async qzoneReactionSweep(
    story: InterludeStory,
    caller: QzoneActionCaller,
    address: { platform: string, selfId: string },
    now: Date,
  ) {
    const posts = (await this.dbGet('interlude_qzone_post', {
      storyId: story.id, kind: 'post', status: 'confirmed',
      createdAt: { $gte: new Date(now.getTime() - 7 * 24 * Time.hour) },
    })) as unknown as QzonePostRecord[]
    const tracked = posts.filter(row => String(row.tid ?? '').trim())
    if (!tracked.length) return
    let entries: QzoneMsgEntry[] = []
    try {
      const raw = await callQzoneAction<{ msglist?: unknown[] }>(caller, 'get_qzone_msg_list', { target_uin: Number(address.selfId), num: 10 })
      entries = (Array.isArray(raw.msglist) ? raw.msglist : []).map(item => normalizeQzoneMsgEntry(item)).filter((item): item is QzoneMsgEntry => !!item)
    } catch (error) {
      // 拉取失败基线不动、下轮重试，但必须可见（此前零日志）。
      this.report('warn', story, 'advance', '被评论列表拉取失败，本轮感知跳过 错误=%s', error)
      return
    }
    const { deltas, baselines } = qzoneReactionDeltas(tracked, entries)
    // 无增量的帖子照常推进基线（含 commentNum 为 null 的首次观察初始化——
    // 跳过会让该帖增量感知永久失效）；有增量的帖子留给下方逐条提交处理。
    const deltaTids = new Set(deltas.map(delta => delta.tid))
    for (const baseline of baselines) {
      if (deltaTids.has(baseline.tid)) continue
      const row = tracked.find(post => String(post.tid ?? '') === baseline.tid)
      if (row?.id !== undefined && (row.commentNum ?? null) !== baseline.commentNum) {
        await this.dbSet('interlude_qzone_post', { id: row.id }, { commentNum: baseline.commentNum })
          .catch(error => this.report('warn', story, 'advance', '被评论基线初始化失败（不影响本轮感知） tid=%s 错误=%s', baseline.tid, error))
      }
    }
    // 逐条提交——先推进该帖基线再写感知条目。单轮预算 3 条之外的
    // delta 不推进基线（下轮重新发现），杜绝"第 4 条起永久丢失"；基线回写
    // 失败则本轮中止（不写条目），杜绝"旧基线重算出相同 delta 的重复入账"。
    const reactionBudget = 3
    let accounted = 0
    let accountedNew = 0
    for (const delta of deltas) {
      if (accounted >= reactionBudget) break
      const baseline = baselines.find(item => item.tid === delta.tid)
      const row = tracked.find(post => String(post.tid ?? '') === delta.tid)
      if (!baseline || row?.id === undefined) continue
      try {
        await this.dbSet('interlude_qzone_post', { id: row.id }, { commentNum: baseline.commentNum })
      } catch (error) {
        this.report('warn', story, 'advance', '被评论基线回写失败，本轮感知中止（下轮重算） tid=%s 错误=%s', delta.tid, error)
        break
      }
      const excerpt = clip(delta.contentExcerpt, 24)
      try {
        await this.appendEntry(story.id, {
          kind: 'friend-feed', actor: 'system',
          content: `[空间动态] 她的说说${excerpt ? `「${excerpt}」` : ''}收到了 ${delta.current - delta.previous} 条新评论（累计 ${delta.current} 条）`,
          occurredAt: now.toISOString(),
          metadata: { qzoneTid: delta.tid, qzoneReactions: { previous: delta.previous, current: delta.current } },
        }, now)
        accounted += 1
        accountedNew += delta.current - delta.previous
      } catch (error) {
        // 基线已推进：该增量让位（不回滚基线，避免重复入账），只留日志。
        this.report('warn', story, 'advance', '被评论感知条目写入失败，该增量让位 tid=%s 错误=%s', delta.tid, error)
      }
    }
    if (deltas.length) {
      this.reportOperation('diagnostic', 'debug', story, 'advance', '被评论感知已入账 新评论=%d 入账帖数=%d/%d（预算 %d）', accountedNew, accounted, deltas.length, reactionBudget)
    }
  }

  // ── 端点注册表（M1a）：迁移/加载/解析/状态 ────────────────────────────────
  // 规格见 docs/MULTI_CHANNEL_SINGLE_STORY_DESIGN.md v3 §二/§三/§四。
  // 单平台零影响：注册表未命中时一律回落旧路径（undefined），绝不自动挂载。

  /** 加载并补齐端点注册表（幂等）：active 故事/参与者/启用的群规则派生行。 */
  /** 加载并补齐端点注册表（幂等 + 单飞：并发调用共享同一次 reconcile）。 */
  private endpointRegistryInFlight: Promise<void> | undefined

  /** 端点/别名运行期写队列：所有注册表变更串行执行，杜绝并发"查后写"重复。 */
  private endpointWriteQueue: Promise<unknown> = Promise.resolve()

  private enqueueEndpointWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = (this.endpointWriteQueue ?? Promise.resolve()).then(task, task)
    this.endpointWriteQueue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Keep health snapshots durable without making connector lifecycle writes part of
   * the message transaction. The global DB writer still serializes physical writes. */
  private persistEndpointState(endpointId: string, state: EndpointState) {
    const run = this.endpointStateWriteQueue.then(async () => {
      const now = new Date()
      const existing = await this.dbGet('interlude_endpoint_state', { endpointId }, { limit: 1 })
      if (existing.length) {
        await this.dbSet('interlude_endpoint_state', { endpointId }, { state, updatedAt: now })
      } else {
        await this.dbCreate('interlude_endpoint_state', { endpointId, state, updatedAt: now })
      }
    }, async () => {
      const now = new Date()
      const existing = await this.dbGet('interlude_endpoint_state', { endpointId }, { limit: 1 })
      if (existing.length) await this.dbSet('interlude_endpoint_state', { endpointId }, { state, updatedAt: now })
      else await this.dbCreate('interlude_endpoint_state', { endpointId, state, updatedAt: now })
    })
    this.endpointStateWriteQueue = run.catch(() => undefined)
    void run.catch(error => this.reportStandalone('warn', '端点状态快照写入失败（不影响连接/投递） 端点=%s 错误=%s', endpointId, error))
  }

  private setEndpointState(endpointId: string, state: EndpointState) {
    this.endpointStates.set(endpointId, state)
    this.persistEndpointState(endpointId, state)
  }

  private endpointGateReason(endpointId: string | undefined, now = Date.now(), options?: { ignoreCooldown?: boolean }): string | undefined {
    if (!endpointId || !this.endpointRegistryReady) return undefined
    const endpoint = this.endpointRows.find(row => row.id === endpointId)
    if (!endpoint) return 'endpoint-not-found'
    if (!endpoint.enabled) return 'endpoint-disabled'
    let state = this.endpointStates.get(endpointId)
    if (!state || !state.connection.online) {
      // 启动竞态兜底：bot-status-updated 可能丢失（适配器 initialize 的
      // getLogin 失败即 offline 且无重试，而 ws 仍在正常收发）。门控前回查
      // ctx.bots 实况——连接事实以内存 bot 为准；持久快照本就不恢复 online
      // 真值，这里只刷内存不落库，与 restoreEndpointState 的语义一致。
      if (state && this.liveBotForEndpoint(endpoint)) {
        state = stateAfterConnection(state, true)
        this.endpointStates.set(endpointId, state)
      } else {
        return 'endpoint-offline'
      }
    }
    if (state.deliverable.cooldownUntil && now < state.deliverable.cooldownUntil && !options?.ignoreCooldown) return 'endpoint-cooldown'
    if (!isEndpointDeliverable(state, now, endpoint, options)) {
      return state.deliverable.allowed ? 'endpoint-state-expired' : 'endpoint-not-deliverable'
    }
    return undefined
  }

  /** 端点行在 ctx.bots 里的实时在线对应物（按平台隔离账号键匹配）。 */
  private liveBotForEndpoint(row: EndpointRow) {
    const key = endpointAccountKey(row.platform, String(row.selfId ?? ''))
    return (this.ctx?.bots ?? []).find(bot => isBotOnlineStatus(bot.status)
      && endpointAccountKey(String(bot.platform ?? ''), String(bot.selfId ?? '')) === key)
  }

  /**
   * Agency uses the normal delivery gate plus the optional channel-specific
   * initiation gate.  EndpointState.initiate is intentionally optional: QQ
   * and other transports without a context-token concept remain compatible
   * with the historical proactive path, while a present-but-expired token is
   * a hard, explicitly classified failure.
   */
  private endpointInitiateGateReason(endpointId: string | undefined, now = Date.now()): string | undefined {
    const deliveryReason = this.endpointGateReason(endpointId, now)
    if (deliveryReason || !endpointId || !this.endpointRegistryReady) return deliveryReason
    const state = this.endpointStates.get(endpointId)
    if (!state?.initiate) return undefined
    if (state.initiate.expiresAt !== undefined && now >= state.initiate.expiresAt) return 'endpoint-state-expired'
    return isEndpointInitiateAllowed(state, now) ? undefined : 'endpoint-initiate-forbidden'
  }

  private endpointForDelivery(endpointId: string | undefined, owner: { kind: 'story-role' | 'participant-user' | 'group', id: string }, now = Date.now(), options?: { ignoreCooldown?: boolean }): { row?: EndpointRow, reason?: string } {
    if (!endpointId) return {}
    const row = this.endpointRows.find(item => item.id === endpointId)
    if (!row) return { reason: 'endpoint-not-found' }
    if (row.ownerKind !== owner.kind || row.ownerId !== owner.id) return { reason: 'endpoint-not-found' }
    const reason = this.endpointGateReason(endpointId, now, options)
    return reason ? { reason } : { row }
  }

  private async ensureEndpointRegistry() {
    if (this.endpointRegistryReady) return
    if (this.endpointRegistryInFlight) return this.endpointRegistryInFlight
    // 单飞锁——两个并发初始化不会各自"查不存在→插入"造成重复行。
    this.endpointRegistryInFlight = this.reconcileEndpointRegistry().finally(() => { this.endpointRegistryInFlight = undefined })
    return this.endpointRegistryInFlight
  }

  private async reconcileEndpointRegistry() {
    const now = new Date()
    const existing = (((await this.dbGet('interlude_endpoint', {})) as unknown[]) ?? [])
      .map(row => normalizeEndpointRow(row)).filter((row): row is EndpointRow => !!row)
    const stateRows = (((await this.dbGet('interlude_endpoint_state', {})) as unknown[]) ?? [])
    const persistedStates = new Map<string, EndpointState>()
    for (const raw of stateRows) {
      const endpointId = String((raw as any)?.endpointId ?? '').trim()
      const state = normalizeEndpointState(raw)
      if (endpointId && state) persistedStates.set(endpointId, state)
    }
    const byKey = new Map(existing.map(row => [endpointUniqueKey(row), row]))
    const drafts: EndpointRow[] = []
    const addDraft = (draft: EndpointRow) => {
      const key = endpointUniqueKey(draft)
      if (byKey.has(key)) return
      byKey.set(key, draft)
      drafts.push({ ...draft, id: randomUUID() })
    }
    // active+paused 都登记：暂停故事的账号/别名同样要能被 resume/status
    // 与入站重定向找到；archived 由 migrateLegacyStory 迁移时单独登记。
    const stories = (await this.dbGet('interlude_story', { status: { $in: ['active', 'paused'] } })) as any[]
    for (const story of stories) {
      if (story?.id && story.selfId) addDraft(deriveStoryRoleEndpoint({ id: String(story.id), platform: String(story.platform ?? 'onebot'), selfId: String(story.selfId) }, now))
      for (const rule of this.config.onebot?.groupChats ?? []) {
        if (rule.enabled !== false) addDraft(deriveGroupEndpoint({ id: String(story.id), platform: String(story.platform ?? 'onebot'), selfId: String(story.selfId) }, rule, now))
      }
    }
    for (const participant of (await this.dbGet('interlude_participant', { status: 'active' })) as any[]) {
      if (participant?.id && participant.selfId && participant.userId) addDraft(deriveParticipantUserEndpoint({ id: String(participant.id), platform: String(participant.platform ?? 'onebot'), selfId: String(participant.selfId), userId: String(participant.userId) }, now))
    }
    const persisted: EndpointRow[] = []
    for (const draft of drafts) {
      // 先落库、成功才进内存——失败行不产生幽灵端点（重启即消失的假行）。
      try {
        await this.dbCreate('interlude_endpoint', draft)
        persisted.push(draft)
      } catch (error) {
        this.reportStandalone('warn', '端点行写入失败，已跳过（不进内存，下次 reconcile 重试）键=%s 错误=%s', endpointUniqueKey(draft), error)
      }
    }
    if (persisted.length) this.reportStandaloneOperation('diagnostic', 'debug', '端点注册表迁移完成 新增=%d/%d 总数=%d', persisted.length, drafts.length, existing.length + persisted.length)
    this.endpointRows = [...existing, ...persisted]
    for (const row of this.endpointRows) {
      if (!this.endpointStates.has(row.id)) {
        this.setEndpointState(row.id, restoreEndpointState(row.id, persistedStates.get(row.id)))
      }
    }
    // M1b：剧本别名迁移（与端点同一幂等通道）——为每个故事登记"按账号推导的
    // ID → 既有剧本 ID"。故事主键保持不动（即冻结的稳定角色 ID），推导形态
    // （legacy platform:selfId:userId / 未来的第二端点 character:...）一律经
    // 别名重定向，不再创建平行故事。前后各记一条带行数快照的审计。
    this.storyAliasRows = (((await this.dbGet('interlude_story_alias', {})) as unknown[]) ?? [])
      .map(row => normalizeStoryAliasRow(row)).filter((row): row is StoryAliasRecord => !!row)
    this.reportStandaloneOperation('diagnostic', 'debug', '剧本别名迁移开始 角色=%d 既有别名=%d', this.endpointRows.filter(row => row.ownerKind === 'story-role').length, this.storyAliasRows.length)
    let aliasesAdded = 0
    for (const story of stories) {
      if (!story?.id || !story.selfId) continue
      const derivedId = storyIdForCharacter(String(story.platform ?? 'onebot'), String(story.selfId))
      if (derivedId === story.id) continue
      const recorded = await this.recordStoryAlias(derivedId, String(story.id), 'M1b-stable-id', false)
      if (recorded) aliasesAdded += 1
    }
    this.reportStandaloneOperation('diagnostic', 'debug', '剧本别名迁移完成 新增=%d 总数=%d', aliasesAdded, this.storyAliasRows.length)
    // 回填 qzone 审计行的 endpointId（按 storyId → 角色端点归因）。
    await this.backfillQzoneEndpointIds()
    this.endpointRegistryReady = true
  }

  /** 运行期增量登记：故事/参与者创建时同步 upsert 端点行。
   * 经写队列串行执行；先落库成功才进内存；失败置脏（下次 reconcile
   * 重试）——绝不留下"进程内有、重启即无"的幽灵端点，也不让登记失败被静默
   * 吞掉后触发陌生账号拒绝（置脏保证 findStory 下次会重新 reconcile 补上）。 */
  private async registerStoryRoleEndpointRow(story: { id: string, platform: string, selfId: string }) {
    await this.enqueueEndpointWrite(async () => {
      try {
        await this.ensureEndpointRegistry()
        const now = new Date()
        const draft = deriveStoryRoleEndpoint(story, now)
        if (this.endpointRows.some(row => endpointUniqueKey(row) === endpointUniqueKey(draft))) return
        const row: EndpointRow = { ...draft, id: randomUUID() }
        await this.dbCreate('interlude_endpoint', row)
        this.endpointRows.push(row)
        if (!this.endpointStates.has(row.id)) this.setEndpointState(row.id, freshEndpointState(row.id))
        await this.recordStoryAlias(storyIdForCharacter(story.platform, story.selfId), story.id, 'story-created', false)
      } catch (error) {
        this.endpointRegistryReady = false
        this.reportStandalone('warn', '故事端点登记失败，注册表已置脏待重试 故事=%s 错误=%s', story.id, error)
      }
    })
  }

  private async registerParticipantUserEndpointRow(participant: { id: string, platform: string, selfId: string, userId: string }) {
    await this.enqueueEndpointWrite(async () => {
      try {
        await this.ensureEndpointRegistry()
        const now = new Date()
        const draft = deriveParticipantUserEndpoint(participant, now)
        if (this.endpointRows.some(row => endpointUniqueKey(row) === endpointUniqueKey(draft))) return
        const row: EndpointRow = { ...draft, id: randomUUID() }
        await this.dbCreate('interlude_endpoint', row)
        this.endpointRows.push(row)
        if (!this.endpointStates.has(row.id)) this.setEndpointState(row.id, freshEndpointState(row.id))
      } catch (error) {
        this.endpointRegistryReady = false
        this.reportStandalone('warn', '参与者端点登记失败，注册表已置脏待重试 参与者=%s 错误=%s', participant.id, error)
      }
    })
  }

  /** qzone 审计行 endpointId 回填：旧行按 storyId → 该故事角色端点归因。 */
  private async backfillQzoneEndpointIds() {
    const rows = (await this.dbGet('interlude_qzone_post', {})) as any[]
    for (const row of rows) {
      if (row?.endpointId) continue
      const endpoint = this.endpointRows.find(item => item.ownerKind === 'story-role' && item.ownerId === String(row.storyId ?? ''))
      if (!endpoint) continue
      await this.dbSet('interlude_qzone_post', { id: row.id }, { endpointId: endpoint.id }).catch(() => undefined)
    }
  }

  /**
   * 登记剧本别名（幂等）：既有行指向相同 canonical → 无操作；指向不同
   * canonical → 冲突告警一次且不覆盖（人工裁决）；成功则落行并更新缓存。
   */
  private async recordStoryAlias(aliasStoryId: string, canonicalStoryId: string, reason: string, announce = true): Promise<boolean> {
    if (!aliasStoryId || !canonicalStoryId || aliasStoryId === canonicalStoryId) return false
    const existing = this.storyAliasRows.find(row => row.aliasStoryId === aliasStoryId)
    if (existing) {
      if (existing.canonicalStoryId !== canonicalStoryId) {
        const key = `conflict:${aliasStoryId}`
        if (!this.storyAliasProblems.has(key)) {
          this.storyAliasProblems.add(key)
          this.reportStandalone('warn', '剧本别名冲突，保留既有指向（人工裁决）别名=%s 既有=%s 试图=%s', aliasStoryId, existing.canonicalStoryId, canonicalStoryId)
        }
      }
      return false
    }
    const now = new Date()
    const row: StoryAliasRecord = { aliasStoryId, canonicalStoryId, reason, createdAt: now }
    // 先落库、成功才进内存——失败不产生幽灵别名。
    try {
      await this.dbCreate('interlude_story_alias', row)
    } catch (error) {
      this.reportStandalone('warn', '剧本别名写入失败，已放弃（无内存幻影）别名=%s 错误=%s', aliasStoryId, error)
      return false
    }
    this.storyAliasRows.push(row)
    if (announce) this.reportStandaloneOperation('diagnostic', 'debug', '剧本别名已登记 %s → %s 原因=%s', aliasStoryId, canonicalStoryId, reason)
    return true
  }

  /** 别名解析：链式（双射失败）或悬空（canonical 无故事）→ undefined + 一次性告警。 */
  private async resolveStoryIdAlias(aliasStoryId: string): Promise<string | undefined> {
    if (!aliasStoryId) return undefined
    const result = resolveStoryAlias(this.storyAliasRows, aliasStoryId)
    if (result.problem === 'chain') {
      const key = `chain:${aliasStoryId}`
      if (!this.storyAliasProblems.has(key)) {
        this.storyAliasProblems.add(key)
        this.reportStandalone('warn', '剧本别名形成链式指向（双射失败，人工裁决）别名=%s', aliasStoryId)
      }
      return undefined
    }
    if (!result.canonicalStoryId) return undefined
    const target = (await this.dbGet('interlude_story', { id: result.canonicalStoryId }))[0]
    if (!target) {
      const key = `dangling:${aliasStoryId}`
      if (!this.storyAliasProblems.has(key)) {
        this.storyAliasProblems.add(key)
        this.reportStandalone('warn', '剧本别名指向不存在的剧本（悬空，忽略重定向）别名=%s 目标=%s', aliasStoryId, result.canonicalStoryId)
      }
      return undefined
    }
    return result.canonicalStoryId
  }

  /** M1b 回滚：删除一条别名重定向并留审计。行删除即回滚生效（双向可达由 canonicalStoryId 索引保证）。 */
  async removeStoryAlias(aliasStoryId: string, reason = 'manual-rollback'): Promise<{ ok: boolean, error?: string }> {
    const row = this.storyAliasRows.find(item => item.aliasStoryId === aliasStoryId)
    if (!row) return { ok: false, error: `别名不存在：${aliasStoryId}` }
    await this.dbRemove('interlude_story_alias', { aliasStoryId })
    this.storyAliasRows = this.storyAliasRows.filter(item => item.aliasStoryId !== aliasStoryId)
    await this.appendEntry(row.canonicalStoryId, {
      kind: 'system', actor: 'system',
      content: `[通道迁移] 已回滚剧本别名 ${row.aliasStoryId} → ${row.canonicalStoryId}（原因：${reason}）`,
      occurredAt: new Date().toISOString(), metadata: { aliasRollback: true, aliasStoryId: row.aliasStoryId },
    }, new Date()).catch(() => undefined)
    this.reportStandaloneOperation('standard', 'warn', '剧本别名已回滚 别名=%s 原因=%s', aliasStoryId, reason)
    return { ok: true }
  }

  /** M1b 只读视图：列出当前别名（管理命令用）。 */
  listStoryAliases(): StoryAliasRecord[] {
    return [...this.storyAliasRows]
  }

  // ── 角色端点管理（的显式迁移路径）：账号变更只能经此，入站永不改绑 ──

  /** 注册一个角色端点到既有故事（幂等；accountKey 被其他故事占用时拒绝）。
   * 经写队列串行执行——并发 add 不会双双重叠冲突检查；落库失败
   * 不进内存且返回失败。 */
  async addStoryEndpoint(story: InterludeStory, platform: string, selfId: string, channelKind: 'qq' | 'wechat' = 'qq'): Promise<{ ok: boolean, endpointId?: string, error?: string }> {
    const account = String(selfId || '').trim()
    if (!account) return { ok: false, error: '账号不能为空。' }
    return this.enqueueEndpointWrite(async () => {
      await this.ensureEndpointRegistry()
      const now = new Date()
      const accountKey = endpointAccountKey(platform, account)
      const conflict = this.endpointRows.find(row => row.ownerKind === 'story-role' && row.accountKey === accountKey)
      if (conflict) {
        if (conflict.ownerId === story.id) return { ok: true, endpointId: conflict.id, error: '该账号已注册为本故事端点。' }
        return { ok: false, error: `账号 ${account} 已被故事 ${conflict.ownerId} 注册（唯一键 role:${accountKey}）。` }
      }
      const row: EndpointRow = {
        id: randomUUID(), ownerKind: 'story-role', ownerId: story.id,
        channelKind, platform, accountKey, selfId: account,
        enabled: true, createdAt: now, updatedAt: now,
      }
      try {
        await this.dbCreate('interlude_endpoint', row)
      } catch (error) {
        this.reportStandalone('warn', '角色端点写入失败 故事=%s 账号=%s 错误=%s', story.id, account, error)
        return { ok: false, error: `写入失败：${error instanceof Error ? error.message : String(error)}` }
      }
      this.endpointRows.push(row)
      this.setEndpointState(row.id, freshEndpointState(row.id))
    // 第二端点的推导 ID 同步登记别名——其消息经 M1b 重定向直达本故事。
    await this.recordStoryAlias(storyIdForCharacter(platform, account), story.id, 'endpoint-added', false)
    await this.appendEntry(story.id, {
      kind: 'system', actor: 'system',
      content: `[通道迁移] 角色端点已注册：${platform} 账号 ${account}（${channelKind}）`,
      occurredAt: now.toISOString(), metadata: { endpointAdded: true, endpointId: row.id },
    }, now).catch(() => undefined)
      this.reportStandaloneOperation('standard', 'warn', '角色端点已注册 故事=%s 平台=%s 账号=%s 端点=%s', story.id, platform, account, row.id)
      return { ok: true, endpointId: row.id }
    })
  }

  /** 停用一个角色端点（身份与历史保留；enabled=false 后其消息按陌生账号处理）。 */
  async disableStoryEndpoint(endpointId: string): Promise<{ ok: boolean, error?: string }> {
    await this.ensureEndpointRegistry()
    const row = this.endpointRows.find(item => item.id === endpointId && item.ownerKind === 'story-role')
    if (!row) return { ok: false, error: `端点不存在：${endpointId}` }
    if (!row.enabled) return { ok: true, error: '该端点已处于停用状态。' }
    const enabledRoleRows = this.endpointRows.filter(item => item.ownerKind === 'story-role' && item.ownerId === row.ownerId && item.enabled)
    if (enabledRoleRows.length <= 1) return { ok: false, error: '不能停用故事的最后一个启用端点。' }
    await this.dbSet('interlude_endpoint', { id: row.id }, { enabled: false, updatedAt: new Date() }).catch(() => undefined)
    row.enabled = false
    this.reportStandaloneOperation('standard', 'warn', '角色端点已停用 故事=%s 账号=%s 端点=%s', row.ownerId, row.selfId, row.id)
    return { ok: true }
  }

  /** M3 §八：解析参与者最近活跃端点（EndpointState.connection.observedAt 最新；无则 undefined）。 */
  private resolveMostActiveEndpointId(participantId: string): string | undefined {
    const userEndpoints = this.endpointRows.filter(row => row.ownerKind === 'participant-user' && row.ownerId === participantId && row.enabled)
    if (!userEndpoints.length) return undefined
    let best: { id: string, observedAt: number } | undefined
    for (const row of userEndpoints) {
      const state = this.endpointStates.get(row.id)
      if (!state?.connection.online) continue
      if (!best || state.connection.observedAt > best.observedAt) best = { id: row.id, observedAt: state.connection.observedAt }
    }
    return best?.id ?? userEndpoints[0]?.id  // 无在线则取第一个启用端点（保守可尝试）
  }

  /**
   * Decide whether the narrator needs the multi-platform transport contract.
   * One platform, including several accounts on that platform, keeps the
   * lightweight legacy prompt. Only enabled endpoints that are legal targets
   * for this request are considered; the complete registry is never exposed.
   */
  private narrativeEndpointSelection(
    story: InterludeStory,
    participants: InterludeParticipant[],
    groups: Array<{ participantId: string, groupId: string, label: string }>,
  ): { enabled: boolean, options: NarrativeEndpointOption[] } {
    const roleRows = this.endpointRows.filter(row => row.ownerKind === 'story-role' && row.ownerId === story.id && row.enabled)
    const roleAccountKeys = new Set(roleRows.map(row => row.accountKey))
    const participantIds = new Set(participants.map(item => item.id))
    const options: NarrativeEndpointOption[] = []
    const seen = new Set<string>()
    const add = (row: EndpointRow, targetId: string, targetKind: 'participant' | 'group', conversationKind: 'private' | 'group') => {
      if (!row.enabled || seen.has(`${row.id}:${targetId}`)) return
      seen.add(`${row.id}:${targetId}`)
      options.push({
        endpointId: row.id, targetId, targetKind, conversationKind,
        channelKind: row.channelKind,
        online: this.endpointStates.get(row.id)?.connection.online === true,
      })
    }
    for (const row of this.endpointRows) {
      if (row.ownerKind === 'participant-user' && participantIds.has(row.ownerId)) {
        add(row, row.ownerId, 'participant', 'private')
      }
    }
    for (const group of groups) {
      const groupId = normalizeGroupId(group.groupId)
      for (const row of roleRows) add(row, group.participantId, 'group', 'group')
      for (const row of this.endpointRows) {
        if (row.ownerKind === 'group' && roleAccountKeys.has(row.accountKey)
          && normalizeGroupId(row.groupId ?? row.ownerId) === groupId) {
          add(row, group.participantId, 'group', 'group')
        }
      }
    }
    const channelKinds = new Set(options.map(option => option.channelKind))
    if (channelKinds.size < 2) return { enabled: false, options: [] }
    return { enabled: true, options }
  }

  // ── M2 §1.2：用户端点链接（同一个人的另一个号链入既有参与者）──────────────

  /** 链接用户端点到既有参与者（幂等；accountKey+userId 已属其他参与者时拒绝）。 */
  async linkParticipantEndpoint(participant: InterludeParticipant, platform: string, userId: string): Promise<{ ok: boolean, endpointId?: string, error?: string }> {
    const account = String(userId || '').trim()
    if (!account) return { ok: false, error: '用户 ID 不能为空。' }
    await this.ensureEndpointRegistry()
    // 角色端点的 accountKey 决定该用户走哪个通道——与参与者现有端点一致或显式指定。
    const accountKey = endpointAccountKey(platform, this.resolveRoleAccountKey(participant.storyId, platform))
    const existing = this.endpointRows.find(row => row.ownerKind === 'participant-user'
      && row.accountKey === accountKey && String(row.userId ?? '') === account)
    if (existing) {
      if (existing.ownerId === participant.id) return { ok: true, endpointId: existing.id, error: '该用户端点已链接到此参与者。' }
      return { ok: false, error: `用户 ${account} 已链接到参与者 ${existing.ownerId}——一个人格一处。` }
    }
    const row: EndpointRow = {
      id: randomUUID(), ownerKind: 'participant-user', ownerId: participant.id,
      channelKind: 'qq', platform, accountKey, selfId: accountKey.slice(accountKey.indexOf(':') + 1),
      userId: account, conversationKind: 'private',
      enabled: true, createdAt: new Date(), updatedAt: new Date(),
    }
    try {
      await this.dbCreate('interlude_endpoint', row)
    } catch (error) {
      this.reportStandalone('warn', '用户端点写入失败 参与者=%s 用户=%s 错误=%s', participant.id, account, error)
      return { ok: false, error: `写入失败：${error instanceof Error ? error.message : String(error)}` }
    }
    this.endpointRows.push(row)
    this.setEndpointState(row.id, freshEndpointState(row.id))
    await this.appendEntry(participant.storyId, {
      kind: 'system', actor: 'system',
      content: `[通道迁移] 用户端点已链接：${platform} ${account} → 参与者 ${participant.displayName || participant.id}`,
      occurredAt: new Date().toISOString(), metadata: { endpointLinked: true, endpointId: row.id },
    }, new Date()).catch(() => undefined)
    this.reportStandaloneOperation('standard', 'warn', '用户端点已链接 参与者=%s 平台=%s 用户=%s 端点=%s', participant.id, platform, account, row.id)
    return { ok: true, endpointId: row.id }
  }

  /** 解除链接（可撤销；身份与历史保留，enabled=false）。 */
  async unlinkParticipantEndpoint(endpointId: string): Promise<{ ok: boolean, error?: string }> {
    await this.ensureEndpointRegistry()
    const row = this.endpointRows.find(item => item.id === endpointId && item.ownerKind === 'participant-user')
    if (!row) return { ok: false, error: `用户端点不存在：${endpointId}` }
    if (!row.enabled) return { ok: true, error: '该端点已处于解除状态。' }
    await this.dbSet('interlude_endpoint', { id: row.id }, { enabled: false, updatedAt: new Date() }).catch(() => undefined)
    row.enabled = false
    await this.appendEntry(row.ownerId.split(':')[0] || '', {
      kind: 'system', actor: 'system',
      content: `[通道迁移] 用户端点已解除链接：${row.platform} ${row.userId ?? ''}（端点 ${row.id}）`,
      occurredAt: new Date().toISOString(), metadata: { endpointUnlinked: true, endpointId: row.id },
    }, new Date()).catch(() => undefined)
    this.reportStandaloneOperation('standard', 'warn', '用户端点已解除 端点=%s 参与者=%s', row.id, row.ownerId)
    return { ok: true }
  }

  /** 列出参与者名下全部用户端点（含启用状态）。 */
  listParticipantEndpoints(participantId: string) {
    return this.endpointRows
      .filter(row => row.ownerKind === 'participant-user' && row.ownerId === participantId)
      .map(row => ({ endpointId: row.id, platform: row.platform, userId: row.userId ?? '', enabled: row.enabled }))
  }

  /** 解析故事的任一角色端点的 accountKey（供用户端点确定通道归属）。 */
  private resolveRoleAccountKey(storyId: string, platform: string): string {
    const role = this.endpointRows.find(row => row.ownerKind === 'story-role' && row.ownerId === storyId && row.enabled)
    if (role) return role.selfId
    return platform  // 无角色端点时用 platform 兜底（onebot 家族折叠后等效）
  }

  /** 列出故事的全部角色端点（含在线状态）。 */
  listStoryEndpoints(storyId: string) {
    return this.endpointRows
      .filter(row => row.ownerKind === 'story-role' && row.ownerId === storyId)
      .map(row => ({
        endpointId: row.id, platform: row.platform, selfId: row.selfId, channelKind: row.channelKind, enabled: row.enabled,
        online: this.endpointStates.get(row.id)?.connection.online === true,
        lastInboundAt: this.endpointStates.get(row.id)?.connection.observedAt,
      }))
  }

  /** 入站反向解析（v3 §三）：accountKey → 端点行；未注册返回 undefined（回落旧路径）。 */
  async resolveInboundEndpointFor(source: { platform: string, selfId: string, userId?: string, groupId?: string, channelId?: string }) {
    await this.ensureEndpointRegistry()
    return resolveInboundEndpoint(this.endpointRows, source)
  }

  /** 条目通道上下文（v3 §十）：注册表命中才返回；未迁移/陌生账号不标注（单平台零影响）。 */
  private async channelMetadataFor(source: { platform: string, selfId: string, userId?: string, groupId?: string, channelId?: string }, extra: { userId?: string, groupId?: string, channelId?: string } = {}) {
    const resolution = await this.resolveInboundEndpointFor(source)
    if (!resolution) return undefined
    const endpoint = resolution.groupEndpoint ?? resolution.userEndpoint ?? resolution.roleEndpoint
    return channelContextMetadata(endpoint, extra)
  }

  /** 入站触达端点状态：连接在线 + 可投递 + 微信主动资格刷新（v3 §四）。 */
  private async touchEndpointStateInbound(source: { platform: string, selfId: string, userId?: string, groupId?: string, channelId?: string }) {
    const resolution = await this.resolveInboundEndpointFor(source)
    if (!resolution) return
    // 重复角色端点（脏数据）一次性告警——静默取首行会让地址选择与
    // qzone 限流的歧义无法追踪。
    if (resolution.duplicateRoleAccountKeys?.length) {
      const key = `dup-role:${resolution.duplicateRoleAccountKeys.join(',')}`
      if (!this.storyAliasProblems.has(key)) {
        this.storyAliasProblems.add(key)
        this.reportStandalone('warn', '检测到重复角色端点（脏数据，取首行生效，请人工核查 interlude_endpoint）账号键=%s', resolution.duplicateRoleAccountKeys.join(', '))
      }
    }
    const now = Date.now()
    for (const endpoint of [resolution.roleEndpoint, resolution.userEndpoint, resolution.groupEndpoint]) {
      if (!endpoint) continue
      const previous = this.endpointStates.get(endpoint.id) ?? freshEndpointState(endpoint.id, now)
      this.setEndpointState(endpoint.id, stateAfterInbound(previous, now))
    }
  }

  /** 将当前 Koishi bot 快照同步到已加载的端点注册表。
   * 这是重启后的实时连接证据，不会恢复历史快照中的 online 真值。
   */
  private async syncCurrentBotConnections() {
    await this.ensureEndpointRegistry()
    for (const bot of this.ctx.bots ?? []) {
      if (!bot.platform || !bot.selfId) continue
      this.noteEndpointConnection(
        endpointAccountKey(bot.platform, String(bot.selfId)),
        isBotOnlineStatus(bot.status)
      )
    }
  }

  /** 连接器在线状态回写（连接/断开事件；v3 §四 connection 维）。 */
  noteEndpointConnection(accountKey: string, online: boolean) {
    const now = Date.now()
    for (const row of this.endpointRows) {
      if (row.accountKey !== accountKey) continue
      const previous = this.endpointStates.get(row.id) ?? freshEndpointState(row.id, now)
      this.setEndpointState(row.id, stateAfterConnection(previous, online, now))
    }
  }

  private endpointDriftWarned = new Set<string>()

  /**
   * M1a 出站地址解析（v3 §五）：注册表命中且启用时以注册表为准，并核对旧字段
   * （漂移只告警一次）；未命中/注册表未加载时回落旧字段——单平台零影响。
   * 同一 owner 多行时不再"取第一行"——优先最近观测过连接的端点，
   * 平手按 createdAt 稳定排序，并一次性告警（M2 起多端点归因的正确性基础）。
   */
  private endpointAddressSync(legacy: { platform: string, selfId: string }, owner?: { kind: 'story-role' | 'participant-user', id: string }): { platform: string, selfId: string, endpointId?: string } {
    if (!owner || !this.endpointRegistryReady) return legacy
    let rows = this.endpointRows.filter(item => item.ownerKind === owner.kind && item.ownerId === owner.id && item.enabled)
    if (!rows.length) return legacy
    if (rows.length > 1) {
      rows = [...rows].sort((left, right) => {
        const leftOnline = this.endpointStates.get(left.id)?.connection.online === true ? 1 : 0
        const rightOnline = this.endpointStates.get(right.id)?.connection.online === true ? 1 : 0
        if (leftOnline !== rightOnline) return rightOnline - leftOnline
        const leftSeen = this.endpointStates.get(left.id)?.connection.observedAt ?? 0
        const rightSeen = this.endpointStates.get(right.id)?.connection.observedAt ?? 0
        if (leftSeen !== rightSeen) return rightSeen - leftSeen
        return left.createdAt.getTime() - right.createdAt.getTime()
      })
      const warnKey = `ambiguous:${owner.kind}:${owner.id}`
      if (!this.endpointDriftWarned.has(warnKey)) {
        this.endpointDriftWarned.add(warnKey)
        this.reportStandalone('warn', '同一归属存在多个启用端点，出站地址按最近连接观测选取 归属=%s:%s 选中=%s', owner.kind, owner.id, rows[0].id)
      }
    }
    const row = rows[0]
    if (String(row.selfId) !== String(legacy.selfId) || row.platform !== legacy.platform) {
      const warnKey = `drift:${row.id}:${legacy.platform}:${legacy.selfId}`
      if (!this.endpointDriftWarned.has(warnKey)) {
        this.endpointDriftWarned.add(warnKey)
        this.reportStandalone('warn', '出站地址以端点注册表为准（旧字段漂移）端点=%s 注册=%s/%s 旧=%s/%s', row.id, row.platform, row.selfId, legacy.platform, legacy.selfId)
      }
    }
    return { platform: row.platform, selfId: row.selfId, endpointId: row.id }
  }

  /** 出站结果回写端点状态（v3 §四 deliverable 维；内存无副作用）。
   * 提供 address 时只更新地址匹配的端点——多端点下不串刷兄弟端点。 */
  private noteEndpointOutbound(owner: { kind: 'story-role' | 'participant-user' | 'group', id: string }, ok: boolean, note: string, address?: { platform: string, selfId: string }) {
    const now = Date.now()
    for (const row of this.endpointRows) {
      if (row.ownerKind !== owner.kind || row.ownerId !== owner.id) continue
      if (address && (row.platform !== address.platform || String(row.selfId) !== String(address.selfId))) continue
      const previous = this.endpointStates.get(row.id) ?? freshEndpointState(row.id, now)
      this.setEndpointState(row.id, stateAfterOutbound(previous, ok, note, ok ? 0 : 5 * 60_000, now))
    }
  }

  // ── 世界事件播种器：生成回路 + 到期排水 ─────────────────────────────────
  // 事实权威、反应自由（docs/WORLD_EVENT_SEEDER_DESIGN.md）：事件条目是既成
  // 现实，她如何感知与应对由主作者书写。注册参与者严格拉黑；只允许线下通道。

  async stop() {
    this.disposed = true
    this.weatherTimer?.()
    this.weatherTimer = undefined
  }

  // ── 天气服务:拉取快照 → 滚动注入 world-event ──
  private async weatherSweep() {
    if (this.desktopRuntimePhase === 'paused' || !this.weatherConfig.enabled) return
    const story = await this.getCanonicalStory()
    if (!story || !this.canHandleStory(story)) return
    // 手动开关:架空世界跳过(由 Console 控制,不做关键词自动判定)
    if (this.weatherConfig.skipFantasyWorld && isFantasyStory(story.setting.world, story.setting.location)) return
    const snapshot = await fetchWeatherSnapshot(this.ctx, this.weatherConfig, story.setting.location)
    if (!snapshot) { this.reportOperation('diagnostic', 'debug', story, 'advance', '天气拉取失败或无数据,本轮跳过'); return }
    // 幂等:内容无变化不注入
    if (snapshot.text === this.lastWeatherText) { this.reportOperation('diagnostic', 'debug', story, 'advance', '天气无变化,跳过注入 %s', snapshot.text); return }
    const now = new Date()
    await this.serial(story.id, async () => {
      // 滚动替换:把上一条天气事件标 expired(时间线上只保留最新一条)
      const prior = await this.dbGet('interlude_seeded_event', { storyId: story.id, status: 'scheduled' }) as Array<{ id: number; summary: string }>
      for (const row of prior) {
        if (String(row.summary).startsWith('环境：')) {
          await this.dbSet('interlude_seeded_event', { id: row.id }, { status: 'expired', updatedAt: now })
        }
      }
      // 注入为 scheduled 事件,drainDueSeededEvents 到期时自动进剧本
      const expiresAt = new Date(now.getTime() + this.weatherConfig.cadenceMinutes * 60_000 + 30 * Time.minute)
      await this.dbCreate('interlude_seeded_event', {
        storyId: story.id, summary: snapshot.text, importance: 'low',
        occursAt: now, expiresAt, status: 'scheduled',
        subjects: [], sourcePayload: { weather: true, ...snapshot },
      })
      this.lastWeatherText = snapshot.text
      this.reportOperation('standard', 'info', story, 'advance', '天气快照已注入 %s', snapshot.text)
    })
  }

  private worldSeederSweepRunning = false

  private async worldSeederSweep() {
    if (this.desktopRuntimePhase === 'paused' || !this.worldSeederRuntime.enabled || !this.worldSeeder.available || this.worldSeederSweepRunning) return
    this.worldSeederSweepRunning = true
    try {
      const story = await this.getCanonicalStory()
      if (!story || !this.canHandleStory(story)) return
      const generation = this.taskGeneration(story.id)
      // 抖动：随机跳过部分检查，避免固定节律感（多数运行仍应输出空）。
      if (Math.random() < 0.10) return
      const now = new Date()
      const dayAgo = new Date(now.getTime() - 24 * Time.hour)
      const [scheduled, last24, recentInjected] = await Promise.all([
        this.dbGet('interlude_seeded_event', { storyId: story.id, status: 'scheduled' }),
        this.dbGet('interlude_seeded_event', { storyId: story.id, status: 'injected', updatedAt: { $gte: dayAgo } }),
        this.dbGet('interlude_seeded_event', { storyId: story.id, status: 'injected', occursAt: { $gte: new Date(now.getTime() - 14 * Time.day) } }),
      ])
      const runtime = this.worldSeederRuntime
      if (scheduled.length >= runtime.maxPending || last24.length >= runtime.dailyCap) return
      // 去重窗口必须包含排期中（scheduled）的事件：45 分钟的 sweep 节奏下，第一条
      // 事件到点注入之前会连跑数轮，若窗口只看已注入（injected），模型每轮都拿到
      // "近期无事件"的空清单，同一通知的换皮改写会连续排期（用户实测 4 连）。
      const windowRows = [...scheduled, ...recentInjected]
      const domain = seedDomainForRun(story.id, now, runtime.cadenceMinutes)
      const payload = await this.buildWorldSeederPayload(story, now, windowRows.map(row => String(row.summary)), domain)
      // 实况天气接管判定:天气开启且该故事不被架空开关跳过 → 播种器让出天气领地
      // (提示词换 nature 替身切面 + 硬排除规则;校验闸 weather-guard 兜底)。
      // 架空世界(或天气关闭)保持原行为——那些世界里模型即兴是唯一的天气来源。
      const weatherHandledByHost = this.weatherConfig.enabled
        && !(this.weatherConfig.skipFantasyWorld && isFantasyStory(story.setting.world, story.setting.location))
      const raw = await this.worldSeeder.generate(payload, { weatherHandledByHost })
      if (!this.taskGenerationCurrent(story.id, generation)) return
      const drafts = parseWorldSeedEvents(raw)
      if (!drafts.length) {
        this.reportOperation('diagnostic', 'debug', story, 'advance', '世界播种器本轮无事件')
        return
      }
      // recentSummaries 可变：同批次内已被接受的草稿立即入列，防止一次输出里的互为换皮对。
      const recentSummaries = windowRows.map(row => String(row.summary))
      // 多维度去重所需的额外维度:subjects(NPC/道具名)与 occursAt(时间窗)
      const recentSubjects = windowRows.map(row => {
        const subjects = Array.isArray((row as any).subjects) ? (row as any).subjects : []
        return subjects.map((s: unknown) => String(s).trim()).filter(Boolean)
      })
      const recentOccursAt = windowRows.map(row => new Date(Number((row as any).occursAt)))
      const input: SeedValidationInput = {
        now, timezone: story.setting.timezone, maxHorizonHours: runtime.maxHorizonHours,
        blockedNames: await this.worldSeederBlockedNames(story.id),
        recentSummaries,
        recentSubjects,
        recentOccursAt,
        ...(weatherHandledByHost ? { weatherGuard: true } : {}),
      }
      let pendingCount = scheduled.length
      let dailyCount = last24.length
      let highToday = last24.filter(row => row.importance === 'high').length
      for (const draft of drafts) {
        if (pendingCount >= runtime.maxPending || dailyCount >= runtime.dailyCap) break
        if (draft.importance === 'high' && highToday >= 1) continue
        // expiresAt 兜底:模型常给 25-35 分钟,但自动推进间隔可达 40+ 分钟 →
        // 到 drain 时已过期(实测 4 条中 3 条 expired)。宿主保证至少 2h 有效窗口
        const minExpiry = new Date(draft.occursAt.getTime() + 2 * Time.hour)
        if (!draft.expiresAt || draft.expiresAt < minExpiry) draft.expiresAt = minExpiry
        const rejection = validateSeedEvent(draft, input)
        if (rejection) {
          this.reportOperation('diagnostic', 'debug', story, 'advance', '世界事件被校验闸拒绝 原因=%s 摘要=%s', rejection, draft.summary.slice(0, 60))
          continue
        }
        await this.dbCreate('interlude_seeded_event', {
          storyId: story.id, summary: draft.summary, importance: draft.importance,
          occursAt: draft.occursAt, status: 'scheduled',
          ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {}),
          subjects: draft.subjects, sourcePayload: { rationale: draft.rationale },
          createdAt: now, updatedAt: now,
        })
        pendingCount += 1
        dailyCount += 1
        if (draft.importance === 'high') highToday += 1
        this.scheduleDueIntentWake(story.id, draft.occursAt)
        this.reportOperation('standard', 'info', story, 'advance', '世界事件已排期 重要性=%s 发生于=%s 摘要=%s', draft.importance, draft.occursAt.toISOString(), draft.summary.slice(0, 60))
      }
    } finally {
      this.worldSeederSweepRunning = false
    }
  }

  /** 上下文 payload：环境（时区/季节/世界设定）、历史剧本（压缩摘录）、
   * 关系网（拉黑名单）、主角所为（workingDetails + 场景/弧摘要）。 */
  private async buildWorldSeederPayload(story: InterludeStory, now: Date, recentSummaries: string[], domain?: WorldSeedDomain) {
    const [entries, scene, arc] = await Promise.all([
      this.recentEntriesForPrompt(story.id, now),
      this.activeScene(story.id),
      this.activeArc(story.id),
    ])
    const state = decodeStoryState(story.state)
    const blockedNames = await this.worldSeederBlockedNames(story.id)
    // 反馈环切断：已注入的世界事件不再进入"近期生活"摘录——播种器的灵感来源
    // 是她本人的生活，不是自己上一轮的产出（它已单独列在 recentlySeededEvents）。
    // 否则首轮事件注入后成为下一轮的上下文锚点，同模态复读是必然收敛。
    const compact = compactPromptEntries(entries.filter(entry => entry.kind !== 'world-event'), 2_000)
      .slice(-14)
      .map(entry => ({ kind: entry.kind, at: entry.occurredAt.toISOString(), text: entry.content.slice(0, 240) }))
    const month = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: story.setting.timezone }).format(now))
    const season = month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter'
    // 天气协同:当前环境快照传给播种器——天象切面只产后果,不产天气本身
    const latestWeather = this.weatherConfig.enabled ? lastWeatherSnapshot() : undefined
    return JSON.stringify({
      nowLocal: new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: story.setting.timezone }).format(now),
      timezone: story.setting.timezone,
      season,
      ...(latestWeather ? { ambientWeather: latestWeather.text } : {}),
      worldSetting: {
        characterName: story.setting.character?.name ?? '',
        characterProfile: (story.setting.character?.profile ?? '').slice(0, 600),
        world: (story.setting.world ?? '').slice(0, 800),
        location: (story.setting.location ?? '').slice(0, 300),
        supportingCast: (story.setting.supportingCast ?? '').slice(0, 400),
      },
      currentScene: scene?.summary?.slice(0, 500) ?? '',
      currentArc: arc?.summary?.slice(0, 500) ?? '',
      recentEstablishedLife: compact,
      workingDetails: (state.workingDetails ?? []).map(detail => ({ label: detail.label, value: detail.value })).slice(-8),
      blockedNames,
      thisRunSlice: domain ? { key: domain.key, label: domain.label, brief: domain.brief } : undefined,
      recentlySeededEvents: recentSummaries.slice(-10),
      constraints: {
        maxHorizonHours: this.worldSeederRuntime.maxHorizonHours,
        dailyBudget: this.worldSeederRuntime.dailyCap,
        note: 'BLOCKED NAMES are off-limits; offline channels only; most runs return empty events.',
      },
    })
  }

  private async worldSeederBlockedNames(storyId: string) {
    const participants = await this.participants(storyId)
    return participants
      .map(item => item.displayName?.trim() ?? '')
      .filter(name => name.length >= 2)
  }

  /** 到期排水：claim-then-append，先进账的条目本回合 recentScript 即可见。
   * 低重要性只在推进/跟进回合注入，避免劫持对话回合。 */
  private async drainDueSeededEvents(story: InterludeStory, now: Date, includeLow: boolean) {
    if (!this.worldSeederRuntime.enabled) return
    try {
      const staleClaim = new Date(now.getTime() - 5 * Time.minute)
      const rows = await this.dbGet('interlude_seeded_event', {
        storyId: story.id,
        occursAt: { $lte: now },
        $or: [
          { status: 'scheduled' },
          { status: 'injecting', updatedAt: { $lte: staleClaim } },
        ],
      })
      const due = rows
        .map(row => normalizeDatabaseRow('interlude_seeded_event', row) as SeededWorldEvent)
        .sort((left, right) => left.occursAt.getTime() - right.occursAt.getTime())
      for (const row of due) {
        if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
          await this.dbSet('interlude_seeded_event', { id: row.id }, { status: 'expired', updatedAt: now })
          continue
        }
        if (row.importance === 'low' && !includeLow) continue
        // Claim before the append so two concurrent drains cannot create two
        // script entries. Keep the row recoverable if the append fails.
        await this.dbSet('interlude_seeded_event', { id: row.id }, { status: 'injecting', updatedAt: now })
        let entry: ScriptEntry
        try {
          entry = await this.appendEntry(story.id, {
            kind: 'world-event', actor: 'system',
            content: `[世界事件] ${row.summary}`,
            occurredAt: row.occursAt.toISOString(),
            metadata: { seededEventId: row.id, importance: row.importance },
          }, now)
          await this.dbSet('interlude_seeded_event', { id: row.id }, { status: 'injected', injectedEntryId: entry.id, updatedAt: now })
        } catch (error) {
          await this.dbSet('interlude_seeded_event', { id: row.id }, { status: 'scheduled', updatedAt: now }).catch(() => undefined)
          throw error
        }
        this.reportOperation('standard', 'info', story, 'advance', '世界事件已注入 条目=%d 重要性=%s 摘要=%s', entry.id, row.importance, row.summary.slice(0, 60))
      }
    } catch (error) {
      this.report('warn', story, 'advance', '世界事件排水失败（不阻断回合）错误=%s', error)
    }
  }

  private async compactStories() {
    if (this.desktopRuntimePhase === 'paused' || (!this.memoryConfig.enabled && !this.schedulePreplanConfig.enabled) || this.compactionSweepRunning) return
    this.compactionSweepRunning = true
    try {
      const story = await this.getCanonicalStory()
      if (!story || !this.canHandleStory(story)) return
      if (this.memoryConfig.enabled) this.scheduleFactEmbeddingBackfill(story.id)
      if (this.config.model.embedding?.semanticHistory) {
        void this.backfillHistoryEmbeddings(story.id)
          .catch(error => this.reportStandaloneOperation('diagnostic', 'debug', '历史向量补齐跳过 错误=%s', error))
      }
      this.scheduleCompaction(story.id)
    } finally {
      this.compactionSweepRunning = false
    }
  }

  /** 复核退避/对话推迟会让 materializedDays 的 [今天,明天] 槽位缺失，窗口静默变空。
   * 取记录时若两个槽位都没有物化天，先本地无模型重物化（锚定今天）再算窗口。 */
  private async currentSchedulePreplanWindow(story: InterludeStory, at: Date) {
    if (!this.schedulePreplanConfig.enabled) return schedulePreplanWindow(undefined, at, story.setting.timezone, 12, this.schedulePreplanConfig)
    const record = await this.getSchedulePreplan(story.id)
    if (!record) return schedulePreplanWindow(record, at, story.setting.timezone, 12, this.schedulePreplanConfig)
    const local = storyLocalTimeContext(at, story.setting.timezone)
    const tomorrow = storyLocalTimeContext(new Date(at.getTime() + 86_400_000), story.setting.timezone).date
    if (record.materializedDays.some(day => day.date === local.date || day.date === tomorrow)) {
      return schedulePreplanWindow(record, at, story.setting.timezone, 12, this.schedulePreplanConfig)
    }
    const refreshed = refreshSchedulePreplan(record, local.date, story.setting.timezone, resolveSchedulePreplanConfig(this.schedulePreplanConfig), at)
    await this.saveSchedulePreplan(refreshed)
    this.reportOperation('standard', 'info', story, 'advance', '日程物化已滞后于今天，本地重物化锚定=%s', local.date)
    return schedulePreplanWindow(refreshed, at, story.setting.timezone, 12, this.schedulePreplanConfig)
  }

  private async getSchedulePreplan(storyId: string) {
    const row = (await this.dbGet('interlude_schedule_preplan', { storyId }))[0]
    return normalizeSchedulePreplanRecord(row)
  }

  // ── Long-Horizon Narrative Guidance（Narrative Attractor）────────────────
  private longHorizonConfig = resolveLongHorizonConfig(undefined)
  private longHorizonSweepRunning = new Set<string>()
  private longHorizonLastScore = new Map<string, number>()
  private longHorizonGenerationRunning = new Set<string>()
  /** 生成失败/归一化拒绝后的冷却：无 active 指导时 first-trigger 恒为真，
   *  不加冷却会每个 sweep 重打一次模型（错误刷屏与 token 浪费的放大器）。 */
  private longHorizonGenerationCooldownUntil = new Map<string, number>()
  /** Story ids whose active guidance row has already been loaded for this process. */
  private longHorizonGuidanceLoaded = new Set<string>()

  private async longHorizonSweep(story: InterludeStory, _now?: Date) {
    if (!this.longHorizonConfig.enabled || this.longHorizonSweepRunning.has(story.id) || this.longHorizonGenerationRunning.has(story.id)) return
    this.longHorizonSweepRunning.add(story.id)
    try {
      const progress = await this.longHorizonProgress(story.id)
      const lastEntryId = progress?.lastCountedEntryId ?? 0
      const entries = (await this.dbGet('interlude_script_entry', {
        storyId: story.id, id: { $gt: lastEntryId },
      }, { sort: { id: 'asc' }, limit: 500 })) as unknown as ScriptEntry[]
      if (!entries.length) return

      const score = calculateLongHorizonScore(entries, this.longHorizonConfig)
      const lastScannedEntryId = Math.max(...entries.map(entry => Number(entry.id) || 0), lastEntryId)
      const total = (progress?.totalScore ?? 0) + score.totalScore
      const cumulative = {
        storyId: story.id,
        lastCountedEntryId: lastScannedEntryId,
        totalScore: total,
        privateCount: (progress?.privateCount ?? 0) + score.privateCount,
        privateScore: (progress?.privateScore ?? 0) + score.privateScore,
        groupCount: (progress?.groupCount ?? 0) + score.groupCount,
        groupScore: (progress?.groupScore ?? 0) + score.groupScore,
        unknownCount: (progress?.unknownCount ?? 0) + score.unknownCount,
        lastGenerationScore: progress?.lastGenerationScore ?? 0,
        lastGenerationEntryId: progress?.lastGenerationEntryId ?? 0,
        updatedAt: new Date(),
      } satisfies LongArcProgressRow
      await this.saveLongHorizonProgress(cumulative)
      this.longHorizonLastScore.set(story.id, total)

      const active = await this.getActiveLongArcGuidance(story.id)
      const lastGen = cumulative.lastGenerationScore
      const trigger = shouldTriggerLongHorizon(
        { ...score, totalScore: total },
        active, lastGen, this.longHorizonConfig,
      )
      if (!trigger.trigger) return
      if ((this.longHorizonGenerationCooldownUntil.get(story.id) ?? 0) > Date.now()) return
      this.reportOperation('diagnostic', 'debug', story, 'advance',
        '长线指导触发 原因=%s 总分=%.1f 私聊=%.1f 群聊=%.1f', trigger.reason, total, cumulative.privateScore, cumulative.groupScore)
      this.longHorizonGenerationRunning.add(story.id)
      void this.longHorizonGenerate(story, entries, total, cumulative).catch(error => {
        this.longHorizonGenerationCooldownUntil.set(story.id, Date.now() + 10 * Time.minute)
        this.reportStandalone('warn', '长线指导生成失败（10 分钟冷却后重试） 错误=%s', error)
      }).finally(() =>
        this.longHorizonGenerationRunning.delete(story.id))
    } finally {
      this.longHorizonSweepRunning.delete(story.id)
    }
  }

  private async longHorizonProgress(storyId: string): Promise<LongArcProgressRow | undefined> {
    const rows = await this.dbGet('interlude_long_arc_progress', { storyId }, { limit: 1 }) as unknown as LongArcProgressRow[]
    return rows[0]
  }

  private async saveLongHorizonProgress(progress: LongArcProgressRow) {
    const existing = await this.dbGet('interlude_long_arc_progress', { storyId: progress.storyId }, { limit: 1 })
    if (existing.length) {
      // 修复"cannot modify primary key"：set 载荷不得含主键 storyId（首行 dbCreate
      // 成功后，此前每次 sweep 更新都因载荷带主键而必抛）。
      await this.dbSet('interlude_long_arc_progress', { storyId: progress.storyId }, progressUpdatePayload(progress))
    } else {
      await this.dbCreate('interlude_long_arc_progress', progress)
    }
  }

  private async getActiveLongArcGuidance(storyId: string): Promise<LongArcGuidanceRecord | undefined> {
    const rows = (await this.dbGet('interlude_long_arc_guidance', { storyId, status: 'active' }, { sort: { version: 'desc' }, limit: 1 })) as unknown as Array<Record<string, unknown>>
    const active = rows[0] as unknown as LongArcGuidanceRecord | undefined
    if (!active) return undefined
    const expiresAt = toDate(active.expiresAt)
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      // Expiration is a lifecycle transition, not merely a prompt-time filter:
      // an expired row must no longer block the next first-trigger generation.
      if (active.id !== undefined) {
        await this.dbSet('interlude_long_arc_guidance', { id: active.id }, { status: 'expired', updatedAt: new Date() })
      }
      this.activeLongArcGuidanceCache.delete(storyId)
      return undefined
    }
    return active
  }

  private async ensureLongHorizonGuidanceLoaded(storyId: string) {
    if (!this.longHorizonConfig.enabled || this.longHorizonGuidanceLoaded.has(storyId)) return
    const active = await this.getActiveLongArcGuidance(storyId)
    if (active) this.activeLongArcGuidanceCache.set(storyId, active)
    this.longHorizonGuidanceLoaded.add(storyId)
  }

  private async longHorizonGenerate(story: InterludeStory, evidence: ScriptEntry[], currentScore: number, progress: LongArcProgressRow) {
    const config = this.longHorizonConfig
    // The accumulator is story-level, but privacy is still enforced at the
    // boundary of the background model. When participant details are disabled,
    // only global entries may cross this boundary; the score itself remains
    // unchanged and still counts private entries at full weight.
    const primaryParticipantId = participantIdForStory(story.id, story.platform, story.selfId, story.userId)
    const isVisibleToLongHorizon = (entry: Pick<ScriptEntry, 'participantId'>) =>
      this.sharedStoryConfig.shareParticipantDetails
      || !entry.participantId
      || entry.participantId === primaryParticipantId
    const eligible = evidence.filter(entry => isEligibleNarrativeEntry(entry) && isVisibleToLongHorizon(entry))
    if (!eligible.length) {
      // The score is intentionally story-level, while the model input is
      // privacy-filtered. Consume this review window once when all evidence is
      // hidden; otherwise every later hidden entry would retrigger the same
      // generation attempt forever without ever producing a model call.
      const lastEvidenceEntryId = Math.max(
        progress.lastCountedEntryId,
        ...evidence.map(entry => Number(entry.id) || 0),
      )
      const advanced = advanceLongHorizonGenerationBaseline(progress, currentScore, lastEvidenceEntryId)
      await this.saveLongHorizonProgress(advanced)
      this.longHorizonLastScore.set(story.id + ':gen', currentScore)
      this.reportOperation('diagnostic', 'debug', story, 'advance',
        '长线指导跳过：本轮有效证据均受 participant 隐私边界过滤，已消费复核窗口')
      return
    }
    // 构造模型输入（分层：设定 + 关系 + 近期剧本 + 新增证据 + 有界历史代表证据）
    const input = await this.longHorizonInput(story, eligible)
    // The model may cite either this review window or the bounded historical
    // sample supplied by longHorizonInput. Both sets are host-validated below.
    const historicalIds = Array.isArray((input as any).historicalEvidence)
      ? (input as any).historicalEvidence.map((item: any) => Number(item?.id)).filter((id: number) => Number.isSafeInteger(id) && id > 0)
      : []
    const validIds = new Set([...eligible.map(entry => entry.id), ...historicalIds])
    // 调用长线模型（复用 compaction route）
    const output = await this.compactor.planLongArcGuidance?.(input)
    if (!output) return
    const result = normalizeLongArcDecision(output, validIds, config)
    if (!result) {
      this.longHorizonGenerationCooldownUntil.set(story.id, Date.now() + 10 * Time.minute)
      this.reportStandaloneOperation('diagnostic', 'warn', '长线指导输出被归一化拒绝（决策/证据引用/催化结构不合法，10 分钟冷却后重试）')
      return
    }
    const triggerEntryId = eligible[eligible.length - 1].id
    // 持久段进故事串行队列:模型调用留在队列外(避免阻塞叙事回合),写库毫秒级
    // 互斥即可;与 purge/压缩交错时由段内重查+触发条目存活校验兜底。
    await this.serial(story.id, async () => {
      // 清理交错防护:生成基于清理前的证据,若触发条目已被 purge/redacted,
      // 本次结果作废(否则会向已重置的故事写入旧直觉)
      const triggerRow = triggerEntryId
        ? (await this.dbGet('interlude_script_entry', { id: triggerEntryId }))[0] as ScriptEntry | undefined
        : undefined
      if (!triggerRow || triggerRow.kind === 'redacted') {
        this.reportOperation('diagnostic', 'debug', story, 'advance', '长线指导生成结果丢弃：触发条目已被清理')
        return
      }
      // A dormant review is a valid no-write decision. It advances the review
      // baseline, but must not supersede an already useful active catalyst.
      if (result.decision === 'dormant' || !result.payload) {
        await this.saveLongHorizonProgress({ ...progress, totalScore: currentScore, lastGenerationScore: currentScore, lastGenerationEntryId: triggerEntryId, updatedAt: new Date() })
        this.longHorizonLastScore.set(story.id + ':gen', currentScore)
        this.reportOperation('diagnostic', 'debug', story, 'advance',
          '长线指导本轮保持休眠：%s', result.reason ?? '当前没有适合播种的长期发展可能性')
        return
      }
      const payload = result.payload
      // 版本链：只有新的催化方向通过校验后才 supersede 旧 active。
      // 段内重查(队列外读到的 active 可能已被并发 supersede/purge);
      // 同时自愈历史遗留的双 active(仅保留最高版本,其余标 superseded)。
      const activeRows = (await this.dbGet('interlude_long_arc_guidance', { storyId: story.id, status: 'active' }, { sort: { version: 'desc' } })) as Array<{ id?: number, version?: unknown }>
      const active = activeRows[0]
      for (const stale of activeRows.slice(1)) {
        if (stale.id !== undefined) await this.dbSet('interlude_long_arc_guidance', { id: stale.id }, { status: 'superseded', updatedAt: new Date() })
      }
      if (active?.id !== undefined) {
        await this.dbSet('interlude_long_arc_guidance', { id: active.id }, { status: 'superseded', updatedAt: new Date() })
      }
      const latestRows = await this.dbGet('interlude_long_arc_guidance', { storyId: story.id }, { sort: { version: 'desc' }, limit: 1 }) as Array<{ version?: unknown }>
      const nextVersion = Number(latestRows[0]?.version ?? active?.version ?? 0) + 1
      const now = new Date()
      await this.dbCreate('interlude_long_arc_guidance', {
        storyId: story.id, version: nextVersion, status: 'active',
        title: payload.title, premise: payload.premise, direction: payload.direction,
        payload, currentStage: payload.currentStage.id, intensity: payload.intensity,
        confidence: payload.confidence,
        triggerEntryId,
        evidenceEntryIds: payload.evidenceEntryIds,
        ...(active?.id !== undefined ? { supersedesId: active.id } : {}),
        createdAt: now, updatedAt: now,
      })
      await this.saveLongHorizonProgress({ ...progress, totalScore: currentScore, lastGenerationScore: currentScore, lastGenerationEntryId: triggerEntryId, updatedAt: new Date() })
      this.longHorizonLastScore.set(story.id + ':gen', currentScore)
      const created = await this.getActiveLongArcGuidance(story.id)
      if (created) this.activeLongArcGuidanceCache.set(story.id, created)
      this.reportOperation('standard', 'info', story, 'advance',
        '长线指导已生成 版本=%d 决策=%s 阶段=%s 标题=%s 置信度=%.2f', nextVersion, result.decision, payload.currentStage.name, payload.title, payload.confidence)
    })
  }

  private async longHorizonInput(story: InterludeStory, eligible: ScriptEntry[]): Promise<Record<string, unknown>> {
    const state = decodeStoryState(story.state)
    const [recentEntries, historicalEntries, arcs, progress, participants, facts, active] = await Promise.all([
      this.recentEntriesForPrompt(story.id, new Date()),
      this.dbGet('interlude_script_entry', { storyId: story.id }, { sort: { id: 'desc' }, limit: 120 }),
      this.dbGet('interlude_arc', { storyId: story.id, status: 'active' }),
      this.longHorizonProgress(story.id),
      this.dbGet('interlude_participant', { storyId: story.id, status: 'active' }, { limit: 12, sort: { updatedAt: 'desc' } }),
      this.dbGet('interlude_fact', { storyId: story.id, status: 'active' }, { limit: 24, sort: { importance: 'desc', updatedAt: 'desc' } }),
      this.getActiveLongArcGuidance(story.id),
    ])
    const primaryParticipantId = participantIdForStory(story.id, story.platform, story.selfId, story.userId)
    const isVisibleToLongHorizon = (value: { participantId?: unknown }) =>
      this.sharedStoryConfig.shareParticipantDetails
      || !value.participantId
      || value.participantId === primaryParticipantId
    const visibleRecentEntries = recentEntries.filter(isVisibleToLongHorizon)
    const visibleHistoricalEntries = (historicalEntries as unknown as ScriptEntry[])
      .filter(entry => isVisibleToLongHorizon(entry) && isEligibleNarrativeEntry(entry))
      .sort((left, right) => Number(left.id) - Number(right.id))
    // Durable facts are story-global narrative material. Unlike raw script entries,
    // they must not be hidden merely because the legacy row carries another
    // participantId. The fact content itself is the only subject reference
    // exposed to the long-horizon model.
    const visibleFacts = facts as any[]
    const recentScript = visibleRecentEntries.slice(-30).map(entry => ({
      kind: entry.kind, actor: entry.actor,
      content: String(entry.content ?? '').slice(0, 300),
      occurredAt: entry.occurredAt.toISOString(),
    }))
    const evidenceSample = eligible.slice(-20).map(entry => ({
      id: entry.id, kind: entry.kind,
      content: String(entry.content ?? '').slice(0, 400),
    }))
    return {
      storySetting: {
        characterName: story.setting.character?.name ?? '',
        characterProfile: (story.setting.character?.profile ?? '').slice(0, 800),
        userProfile: (story.setting.user?.profile ?? '').slice(0, 500),
        relationship: (story.setting.relationship ?? '').slice(0, 800),
        world: (story.setting.world ?? '').slice(0, 800),
        perspective: story.setting.perspective ?? '',
      },
      overlay: state.settingOverlay ?? {},
      currentArcs: (arcs as any[])?.map?.((arc: any) => ({ id: arc.id, summary: String(arc.summary ?? '').slice(0, 500) })) ?? [],
      participants: this.sharedStoryConfig.shareParticipantDetails
        ? (participants as any[]).map((participant: any) => ({ id: participant.id, displayName: participant.displayName, relationship: String(participant.relationship ?? '').slice(0, 500), state: participant.state }))
        : [],
      durableFacts: visibleFacts.map((fact: any) => ({
        scope: fact.scope, content: String(fact.content ?? '').slice(0, 500),
        importance: fact.importance, confidence: fact.confidence,
      })),
      activeGuidance: active ? {
        version: active.version,
        title: active.title,
        direction: active.direction,
        premise: active.premise,
        currentStage: active.currentStage,
        developmentPhase: (active.payload as any)?.developmentPhase ?? 'active',
        latentTension: (active.payload as any)?.latentTension ?? '',
        firstExpression: (active.payload as any)?.firstExpression ?? null,
        responseBranches: (active.payload as any)?.responseBranches ?? null,
      } : null,
      weightedScore: {
        total: progress?.totalScore ?? this.longHorizonLastScore.get(story.id) ?? 0,
        privateCount: progress?.privateCount ?? 0,
        privateScore: progress?.privateScore ?? 0,
        groupCount: progress?.groupCount ?? 0,
        groupScore: progress?.groupScore ?? 0,
        unknownCount: progress?.unknownCount ?? 0,
      },
      recentScript,
      keyEvidence: evidenceSample,
      // A bounded historical sample prevents review cycles from forgetting
      // the relationship patterns that motivated the catalyst in the first
      // place, while keeping privacy and prompt-size limits host-owned.
      historicalEvidence: visibleHistoricalEntries.slice(-60).map(entry => ({
        id: entry.id, kind: entry.kind,
        content: String(entry.content ?? '').slice(0, 400),
      })),
      intensity: this.longHorizonConfig.intensity,
      privacy: {
        shareParticipantDetails: this.sharedStoryConfig.shareParticipantDetails,
        participantScopedEvidenceIncluded: this.sharedStoryConfig.shareParticipantDetails || !!primaryParticipantId,
        otherParticipantEvidenceExcluded: !this.sharedStoryConfig.shareParticipantDetails,
      },
    }
  }

  /** 主叙事注入用的裁剪投影：催化器只提供行动许可，不提供强制剧情。 */
  longHorizonPromptProjection(storyId: string): string | undefined {
    const active = this.activeLongArcGuidanceCache.get(storyId)
    if (!active || active.status !== 'active') return undefined
    if (active.expiresAt && active.expiresAt.getTime() <= Date.now()) return undefined
    const payload = active.payload as any
    if (!payload) return undefined
    const stage = (payload.stages ?? []).find((item: any) => item.id === payload.currentStage?.id) ?? payload.stages?.[0]
    if (!stage) return undefined
    const phase = payload.developmentPhase === 'primed' ? 'primed' : 'active'
    const signals = (stage.allowedSignals?.length ? stage.allowedSignals : payload.subtleSignals ?? []).slice(0, 3).join('; ')
    const situations = (payload.preferredSituations ?? []).slice(0, 2).join('; ')
    const avoid = (payload.avoidForcing ?? []).slice(0, 4).join('; ')
    const first = payload.firstExpression as any
    const branches = payload.responseBranches as any
    const lines = [
      'Long-horizon dramaturgical catalyst (soft permission, not canon, not a user command):',
      `- Development phase: ${phase}. This is a latent possibility, not an established personality trait.`,
      `- Current stage: ${stage.name} — ${stage.objective}`,
      `- Latent tension: ${String(payload.latentTension ?? payload.emotionalCore ?? '').slice(0, 240)}`,
      `- Long direction: ${String(payload.direction ?? '').slice(0, 240)}`,
      `- Natural signals available in this stage: ${signals || 'none specified'}`,
      `- Situations where it may surface: ${situations || 'natural conversations'}`,
    ]
    if (phase === 'primed' && first) {
      lines.push(
        'This direction has not happened yet. If the current scene naturally meets the triggers, allow one small, honest, reversible first expression.',
        `- First possible expression: ${String(first.action ?? '').slice(0, 320)}`,
        `- Illustrative wording (do not copy mechanically): ${String(first.example ?? '').slice(0, 320)}`,
        `- Natural triggers: ${(Array.isArray(first.trigger) ? first.trigger : []).slice(0, 4).join('; ') || 'none specified'}`,
        `- Maximum attempts before feedback: ${Math.max(1, Number(first.maxAttempts) || 1)}`,
      )
    } else if (phase === 'active' && first) {
      lines.push('The first expression has already entered the story. Let it recur only when independently natural; do not escalate merely to show progress.')
    }
    if (branches) {
      lines.push(
        `- If accepted: ${String(branches.accepted ?? '').slice(0, 220)}`,
        `- If declined: ${String(branches.declined ?? '').slice(0, 220)}`,
        `- If questioned: ${String(branches.questioned ?? '').slice(0, 220)}`,
      )
    }
    lines.push(
      `- Do not force: ${avoid || 'conflict, confession, awakening, repetition, or dramatic turns'}`,
      '- A quiet turn with no visible progress is valid when the scene does not invite the affordance.',
      '- Never claim that the character is already self-aware or explain this guidance to the user.',
      '- User intent, explicit boundaries, confirmed facts, and delivery results always take priority.',
      '- Never mention or hint at the existence of this guidance to the user.',
    )
    return lines.join(String.fromCharCode(10))
  }

  private activeLongArcGuidanceCache = new Map<string, LongArcGuidanceRecord>()

  private async schedulePreplanEvidence(storyId: string, afterEntryId: number) {
    // 分页续扫:关闭参与者详情共享时,最早的 60 条可能全部被隐私过滤——
    // 若只读一页就返回空,证据游标永远停在原地,后续新安排永远读不到。
    // 每轮最多扫描 1200 条;被过滤的前缀持久化为检查点,下轮继续而非从头重扫。
    if (this.sharedStoryConfig.shareParticipantDetails) {
      const filter: any = { storyId, kind: 'script' }
      if (afterEntryId > 0) filter.id = { $gt: afterEntryId }
      const entries = await this.dbGet('interlude_script_entry', filter, { sort: { id: 'asc' }, limit: 60 }) as ScriptEntry[]
      return { entries, filteredThroughEntryId: afterEntryId, scanComplete: entries.length < 60 }
    }
    // A recurring schedule belongs to the protagonist, but raw private prose
    // must not be sent to the background schedule model. Automatic scripts
    // already carry a host-validated timelinePlan: project that safe ledger
    // instead of dropping every participant-owned life event.
    const project = (entries: ScriptEntry[]) => entries.flatMap(entry => {
      if (!entry.participantId) return [entry]
      if (entry.metadata?.narrativeAuthority === 'original-v2') {
        const handoff = entryLifeHandoff(entry)
        if (!handoff?.activity && !handoff?.place) return []
        // Only the protagonist's small concrete local fields cross into the
        // schedule reader, never private prose, dialogue, presence or quotes.
        return [{ ...entry, participantId: '', content: JSON.stringify({
          sourceEntryId: entry.id, observedAt: entry.occurredAt.toISOString(),
          place: handoff.place?.value, activity: handoff.activity?.value,
        }), metadata: { narrativeAuthority: 'original-v2' } }]
      }
      const projected = timelineEntryPromptProjection(entry)
      return projected === entry ? [] : [{ ...projected, participantId: '' }]
    })
    const collected: ScriptEntry[] = []
    let cursor = afterEntryId
    let filteredThroughEntryId = afterEntryId
    let scanComplete = false
    for (let page = 0; page < 20; page++) {
      const filter: any = { storyId, kind: 'script' }
      if (cursor > 0) filter.id = { $gt: cursor }
      // The pagination key and ordering must agree, including backdated entries.
      const entries = await this.dbGet('interlude_script_entry', filter, { sort: { id: 'asc' }, limit: 60 }) as ScriptEntry[]
      for (const entry of entries) {
        const visible = project([entry])
        if (!collected.length && !visible.length) filteredThroughEntryId = entry.id
        collected.push(...visible)
      }
      cursor = Math.max(...entries.map(entry => Number(entry.id) || 0), cursor)
      if (entries.length < 60) { scanComplete = true; break }
      if (collected.length >= 60) break
    }
    // Only checkpoint a fully filtered prefix. Never skip an unreviewed visible
    // entry just because later entries in the batch were private.
    return { entries: collected, filteredThroughEntryId, scanComplete }
  }

  private async saveSchedulePreplan(record: SchedulePreplanRecord) {
    const existing = (await this.dbGet('interlude_schedule_preplan', { storyId: record.storyId }))[0]
    if (existing) {
      // `storyId` is the table primary key. Minato rejects updates that include
      // a primary-key field, even when the value is unchanged. Keep the key in
      // the lookup only and send a key-free patch to make the review checkpoint
      // actually advance after a successful/empty preplan review.
      const { storyId, ...update } = record
      await this.dbSet('interlude_schedule_preplan', { storyId }, update)
    }
    else await this.dbCreate('interlude_schedule_preplan', record)
  }

  private async prepareSchedulePreplanReview(story: InterludeStory, now: Date) {
    const config = this.schedulePreplanConfig
    if (!config.enabled) return undefined
    const backoffUntil = this.schedulePreplanBackoff.get(story.id)
    if (backoffUntil && now.getTime() < backoffUntil) return undefined
    let current = await this.getSchedulePreplan(story.id)
    const dailyDue = schedulePreplanReviewDue(current, now, story.setting.timezone, config)
    if (!dailyDue && (!current || now.getTime() - current.updatedAt.getTime() < SCHEDULE_PREPLAN_FOLLOWUP_COOLDOWN_MS)) return undefined
    const batch = await this.schedulePreplanEvidence(story.id, current?.lastEvidenceEntryId ?? 0)
    const evidenceEntries = batch.entries
    const localDate = calendarDayKey(now, story.setting.timezone)
    if (current && batch.filteredThroughEntryId > current.lastEvidenceEntryId) {
      // Scanning is not a model review: preserve its date and cooldown time.
      current = { ...current, lastEvidenceEntryId: batch.filteredThroughEntryId }
      await this.saveSchedulePreplan(current)
    }
    if (!current && !evidenceEntries.length) {
      const empty = applySchedulePreplanProposal(
        undefined,
        { outcome: 'replace', reason: 'No concrete recurring schedule evidence yet.', regimes: [], exceptions: [] },
        [], localDate, story.setting.timezone, config, now, config.variationLevel,
      )
      if (empty) {
        empty.storyId = story.id
        empty.lastEvidenceEntryId = batch.filteredThroughEntryId
        // A scan budget is not proof that there is no evidence beyond it.
        if (!batch.scanComplete) empty.lastReviewedLocalDate = ''
        await this.saveSchedulePreplan(empty)
        this.reportOperation('diagnostic', 'debug', story, 'advance', 'Schedule Preplan 已建立空记录：等待可验证的生活日程证据')
        return { current: empty, evidenceEntries, localDate, needsModel: false, request: undefined }
      }
    }
    if (!evidenceEntries.length && !batch.scanComplete) {
      return { current, evidenceEntries, localDate, needsModel: false, request: undefined }
    }
    if (!dailyDue) {
      const triggers = schedulePreplanEvidenceMentionsDateChange(evidenceEntries)
      if (!triggers.length) return undefined
      this.reportOperation('diagnostic', 'debug', story, 'advance', 'Schedule Preplan 当天跟进审查：未读证据含改约/取消/新安排信号 条目=%s', triggers.slice(0, 5).join(','))
    }
    const needsModel = schedulePreplanNeedsModel(current, evidenceEntries, localDate, story.setting.timezone, config)
    if (!needsModel && current) {
      await this.saveSchedulePreplan(refreshSchedulePreplan(current, localDate, story.setting.timezone, config, now))
      this.reportOperation('diagnostic', 'debug', story, 'advance', 'Schedule Preplan 今日检查完成：没有新证据，日程保持不变')
    }
    const request: SchedulePreplanReviewRequest | undefined = needsModel ? {
      localDate, horizonDays: config.horizonDays, variationLevel: config.variationLevel, current: current ?? null, evidenceEntries,
    } : undefined
    return { current, evidenceEntries, localDate, needsModel, request }
  }

  /** Preplan has one small independent request instead of competing with
   * scene/fact compression. One recovery retry is cheap and covers providers
   * that occasionally omit an otherwise valid JSON object. */
  private async requestSchedulePreplan(story: InterludeStory, request: SchedulePreplanReviewRequest) {
    if (!this.compactor.planSchedulePreplan) return undefined
    let proposal = await this.compactor.planSchedulePreplan(request)
    if (proposal) return proposal
    this.reportOperation('diagnostic', 'warn', story, 'advance', 'Schedule Preplan 返回为空，正在进行一次轻量恢复重试')
    proposal = await this.compactor.planSchedulePreplan(request)
    return proposal
  }

  private async persistSchedulePreplanReview(
    story: InterludeStory,
    review: { current?: SchedulePreplanRecord; evidenceEntries: ScriptEntry[]; localDate: string },
    proposal: unknown,
    now: Date,
  ) {
    const next = applySchedulePreplanProposal(
      review.current, proposal, review.evidenceEntries, review.localDate,
      story.setting.timezone, this.schedulePreplanConfig, now, this.schedulePreplanConfig.variationLevel,
    )
    if (!next) {
      // A narrow review can still fail on an unstable provider. On first use,
      // persist an explicit empty review with the inspected evidence cursor:
      // this is truthful, prevents a full retry loop, and new evidence will
      // naturally make the next review due again.
      if (!review.current) {
        const empty = applySchedulePreplanProposal(
          undefined,
          { outcome: 'unchanged', reason: 'Schedule review returned no valid structure; waiting for new concrete evidence.', regimes: [], exceptions: [] },
          review.evidenceEntries, review.localDate, story.setting.timezone, this.schedulePreplanConfig, now, this.schedulePreplanConfig.variationLevel,
        )
        if (empty) {
          empty.storyId = story.id
          await this.saveSchedulePreplan(empty)
          this.reportOperation('standard', 'warn', story, 'advance', 'Schedule Preplan 未形成有效日程，已保存空审查记录并等待新证据')
          return true
        }
      }
      this.reportOperation('standard', 'warn', story, 'advance', 'Schedule Preplan 未更新：模型没有返回可用日程，保留现有版本')
      return false
    }
    next.storyId = story.id
    await this.saveSchedulePreplan(next)
    this.reportOperation('standard', 'info', story, 'advance', 'Schedule Preplan 已审查 版本=%d 覆盖=%s→%s 原因=%s', next.revision, next.validFrom, next.validThrough, next.reviewReason)
    return true
  }

  /** A visible reply already reached the user, so this retry may write only
   * the missing life script. It must never create a second transport message. */
  private async scheduleStreamScriptRecovery(storyId: string, participantId: string, now: Date, previousAttempts = 0) {
    // 与 scheduleNarrativeRetry 同理：重载/停机期间失败不排持久化恢复任务。
    if (this.disposed) return false
    const delaySeconds = Math.max(5, this.config.runtime.narrativeRetryDelaySeconds ?? 60)
    const maxAttempts = Math.min(2, Math.max(0, this.config.runtime.narrativeRetryMaxAttempts ?? 6))
    if (!participantId || previousAttempts >= maxAttempts) return false
    const pending = await this.dbGet('interlude_intent', { storyId, participantId, status: 'pending', type: 'narrative-retry' }) as NarrativeIntent[]
    const existing = pending.filter(intent => intent.payload?.streamRecovery === true)
    if (existing.length) await this.dbSet('interlude_intent', { id: { $in: existing.map(intent => intent.id) } }, { status: 'cancelled', updatedAt: now })
    const attempt = previousAttempts + 1
    const notBefore = new Date(now.getTime() + delaySeconds * Time.second)
    await this.appendIntent(storyId, {
      type: 'narrative-retry', summary: `Recover only the missing script after a streamed reply (attempt ${attempt}/${maxAttempts}).`,
      notBefore: notBefore.toISOString(), payload: { narrativeRetry: true, streamRecovery: true, userInitiated: true, attempt },
    }, now, participantId)
    this.scheduleDueIntentWake(storyId, notBefore)
    return true
  }

  private async persistStreamScriptRecovery(story: InterludeStory, participant: InterludeParticipant | null, decision: NarrativeDecision, now: Date) {
    const script = decision.script?.trim()
    if (!script) return false
    await this.appendEntry(story.id, {
      kind: 'script', actor: 'narrator', content: script, occurredAt: now.toISOString(),
      metadata: { phase: 'stream-script-recovery', interaction: null },
    }, now, participant?.id ?? '')
    const state = decodeStoryState(story.state)
    const nextState: StoryState = { ...state, narrativeUpdateCount: state.narrativeUpdateCount + 1 }
    // Stream recovery only restores the missing original, never a second
    // communication decision or an independent continuity summary.
    await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState(nextState), updatedAt: now })
    return true
  }

  /** 手动/强制压缩的三阶段入口:Phase1 队列内快照,Phase2 队列外模型+embedding,
   * Phase3 队列内轻量落库——与后台调度器路径同构,不阻塞直播回合。 */
  private async compactThreePhase(storyId: string, force: boolean, generation?: string): Promise<boolean> {
    const startedAt = Date.now()
    const prepared = await this.serial(storyId, async () => {
      if (generation && !this.taskGenerationCurrent(storyId, generation)) return undefined
      const story = await this.getStory(storyId)
      if (story.status !== 'active') return undefined
      const review = await this.prepareSchedulePreplanReview(story, new Date())
      const context = await this.prepareCompaction(story, new Date(), force)
      return { story, review, context }
    })
    if (!prepared || (!prepared.review?.needsModel && (!prepared.context || prepared.context.phase === 'skip'))) {
      return prepared?.context?.overlayCompacted ?? false
    }
    const { story, review, context } = prepared
    // Phase 2:模型与 embedding 都在队列外(网络调用不阻塞直播)
    let scheduleProposal: unknown = undefined
    if (review?.needsModel && review.request) {
      try { scheduleProposal = await this.requestSchedulePreplan(story, review.request) }
      catch (error) {
        this.report('warn', story, 'advance', 'Schedule Preplan 调用失败，将保存本日审查状态：%s', error)
      }
    }
    let decision: CompactionDecision = {}
    if (context?.phase === 'run') {
      this.reportOperation('standard', 'info', story, 'advance', '后台整理开始(手动) 条目=%d 字符=%d', context.sceneEntries.length, context.chars)
      try {
        decision = await this.compactor.compact(context.compactRequest)
        if (context.sceneCompactionDue) {
          context.factEmbeddings = await this.prepareCompactionEmbeddings(storyId, decision, context.sceneEntries)
        }
      } catch (error) {
        this.noteCompactionFailure(storyId, context.fingerprint, error)
        this.report('warn', story, 'advance', '记忆压缩失败：%s', error)
        return false
      }
    }
    // Phase 3:队列内轻量落库
    return await this.serial(storyId, async () => {
      if (generation && !this.taskGenerationCurrent(storyId, generation)) return false
      const freshStory = await this.getStory(storyId)
      if (freshStory.status !== 'active') return false
      if (review?.needsModel && review.request) {
        const persisted = await this.persistSchedulePreplanReview(freshStory, review, scheduleProposal, new Date())
        if (persisted) this.schedulePreplanBackoff.delete(storyId)
        else this.schedulePreplanBackoff.set(storyId, Date.now() + SCHEDULE_PREPLAN_RETRY_BACKOFF)
      }
      if (!context || context.phase === 'skip') return context?.overlayCompacted ?? false
      try {
        const result = await this.applyCompaction(freshStory, context, decision, new Date(), startedAt)
        if (!await this.compactionCheckpointAdvanced(context)) {
          throw new Error(`Compaction checkpoint did not advance (scene=${context.scene.id}, expected=${context.sceneEntries.at(-1)?.id ?? 0})`)
        }
        this.scheduler.clearBackoff(storyId)
        return result
      } catch (error) {
        this.noteCompactionFailure(storyId, context.fingerprint, error)
        this.report('warn', freshStory, 'advance', '记忆整理落库失败：%s', error)
        return false
      }
    })
  }

  /** Everything up to the expensive compactor call: cheap reads plus the due
   * checks. Runs inside the story serial queue, but the model call itself must
   * not — a queued compactor request would delay the next live turn. */
  private async prepareCompaction(story: InterludeStory, now: Date, force: boolean): Promise<PreparedCompaction | undefined> {
    await this.ensureContinuity(story, now)
    const overlayCompacted = this.memoryConfig.enabled ? await this.compactOverlayUnlocked(story, now) : false
    const scene = await this.activeScene(story.id)
    if (!scene) return { phase: 'skip', overlayCompacted }
    // lastEntryId 将场景摘要变成增量检查点：已经压缩过的原文不再重复传给模型。
    const entryFilter: any = { storyId: story.id, occurredAt: { $gte: scene.startedAt } }
    if (scene.lastEntryId != null) {
      entryFilter.id = { $gt: scene.lastEntryId }
      delete entryFilter.occurredAt
    }
    // 管理员软删的墓碑(kind='redacted')不进压缩:占阈值、污染摘要、还会把
    // 场景关闭边界推到墓碑时间戳——recentEntries 等读取路径均有同款过滤
    const entries = ((await this.dbGet('interlude_script_entry', entryFilter, {
      limit: Math.max(this.memoryConfig.compactionEntryLimit * 2, this.memoryConfig.compactionEntryLimit),
      sort: { id: 'asc' },
    })) as ScriptEntry[]).filter(entry => entry.kind !== 'redacted')
    const sceneEntries = compactionPrefix(entries, this.memoryConfig.compactionCharacterLimit)
    const chars = sceneEntries.reduce((sum, entry) => sum + entry.content.length, 0)
    const sceneCompactionDue = this.memoryConfig.enabled && sceneEntries.length > 0
      && (force || entries.length >= this.memoryConfig.sceneEntryThreshold
        || entries.reduce((sum, entry) => sum + entry.content.length, 0) >= this.memoryConfig.sceneCharacterThreshold)
    if (!sceneCompactionDue) {
      this.reportOperation('diagnostic', 'debug', story, 'advance', '记忆整理跳过：未达到阈值 条目=%d/%d 字符=%d/%d', sceneEntries.length, this.memoryConfig.sceneEntryThreshold, chars, this.memoryConfig.sceneCharacterThreshold)
      return { phase: 'skip', overlayCompacted }
    }
    const fingerprint = this.compactionFingerprint(scene, sceneEntries, chars)
    if (!force && this.compactionIsBackedOff(story.id, fingerprint)) return { phase: 'skip', overlayCompacted }
    const current = await this.getStory(story.id)
    const participants = await this.participants(story.id)
    const preceding = scene.lastEntryId == null ? [] : ((await this.dbGet('interlude_script_entry', {
      storyId: story.id, id: { $lte: scene.lastEntryId },
    }, { limit: 12, sort: { id: 'desc' } })) as ScriptEntry[]).filter(entry => entry.kind !== 'redacted')
    // The backstage editor reviews this story's originals, not another user's
    // history view. Audience-specific history filtering stays on live turns.
    const precedingEntries = limitEntriesByCharacters(preceding.reverse(), 8_000)
    const visibleCompactionFacts = this.memoryConfig.enabled
      ? await this.facts(story.id, this.memoryConfig.maxFactsPerStory)
      : []
    const rawDevelopmentCandidates = (await this.dbGet('interlude_state_patch', { storyId: story.id, status: { $in: ['proposed', 'applied'] } },
      { limit: 50, sort: { createdAt: 'desc' } }) as StatePatchProposal[])
      .filter(item => item.path.startsWith('development.') && (this.sharedStoryConfig.shareParticipantDetails || !item.participantId))
    const candidateSourceIds = Array.from(new Set(rawDevelopmentCandidates.flatMap(item => item.sourceEntryIds))).slice(0, 1_000)
    const candidateSources = candidateSourceIds.length
      ? ((await this.dbGet('interlude_script_entry', { storyId: story.id, id: { $in: candidateSourceIds } })) as ScriptEntry[])
        .filter(entry => entry.kind !== 'redacted')
      : []
    const developmentCandidates = rawDevelopmentCandidates.filter(item => promptReadyDevelopment(item, candidateSources))
    return {
      phase: 'run', overlayCompacted, scene, sceneEntries, chars, sceneCompactionDue, current, participants,
      visibleCompactionFacts,
      fingerprint,
      compactRequest: {
        story: current, from: scene.startedAt, now, entries: sceneEntries.filter(entry => !!entry.content.trim()),
        scene, arc: await this.activeArc(story.id), participants, precedingEntries, developmentCandidates,
        facts: visibleCompactionFacts,
      },
    }
  }

  /** Cheap DB persistence for one compaction decision. Re-acquires the story
   * serial queue in the caller so writes stay ordered with narrative turns. */
  private async applyCompaction(story: InterludeStory, context: PreparedCompactionRun, decision: CompactionDecision, now: Date, startedAt: number) {
    if (context.sceneCompactionDue) {
      await this.persistCompaction(context.current, context.scene, decision, context.sceneEntries, now,
        new Set(context.visibleCompactionFacts.map(fact => fact.id)), context.compactRequest.precedingEntries, context.factEmbeddings)
    }
    this.reportOperation('standard', 'info', story, 'advance', '后台整理完成 耗时=%dms 剧本条目=%d 模型提取事实=%d 模型提取发展提案=%d', Date.now() - startedAt, context.sceneCompactionDue ? context.sceneEntries.length : 0, context.sceneCompactionDue ? decision.facts?.length ?? 0 : 0, context.sceneCompactionDue ? decision.statePatches?.length ?? 0 : 0)
    return true
  }

  /** Older state patches are compacted only by the background maintenance
   * lane. Live turns always retain the last few days as raw detail. */
  private async compactOverlayUnlocked(story: InterludeStory, now: Date) {
    const config = this.memoryConfig
    if (!config.overlayCompressionEnabled) return false
    try {
    const recentCutoff = new Date(now.getTime() - (config.overlayRecentDays ?? 2) * Time.day)
    const monthlyCutoff = new Date(now.getTime() - (config.overlayMonthlyAfterDays ?? 10) * Time.day)
    const applied = await this.dbGet('interlude_state_patch', { storyId: story.id, status: 'applied' }, { sort: { appliedAt: 'asc' } }) as StatePatchProposal[]
    const weekly = applied.filter(patch => !patch.path.startsWith('development.') && (patch.appliedAt ?? patch.createdAt) <= recentCutoff)
    let changed = false
    for (const group of groupOverlayPatches(weekly, config.overlayWeeklyWindowDays ?? 5)) {
      const existing = (await this.dbGet('interlude_overlay_snapshot', {
        storyId: story.id, participantId: group.participantId, target: group.target, tier: 'weekly', periodStart: group.from,
      }))[0] as OverlaySnapshot | undefined
      if (existing) continue
      const participant = group.participantId ? await this.getParticipant(group.participantId) : undefined
      const decision = await this.compactor.compactOverlay({ story, participant, target: group.target, tier: 'weekly', from: group.from, to: group.to, patches: group.patches })
      const summary = clip(decision.summary, config.overlayWeeklySummaryCharacters ?? 1_600)
      if (!summary) continue
      await this.dbCreate('interlude_overlay_snapshot', {
        storyId: story.id, participantId: group.participantId, target: group.target, tier: 'weekly', periodStart: group.from, periodEnd: group.to,
        summary, majorEvents: normalizeMajorEvents(decision.majorEvents, group.patches), sourcePatchIds: group.patches.map(patch => patch.id), status: 'active', createdAt: now, updatedAt: now,
      })
      for (const patch of group.patches) await this.dbSet('interlude_state_patch', { id: patch.id }, { status: 'compacted' })
      changed = true
    }

    const snapshots = await this.dbGet('interlude_overlay_snapshot', { storyId: story.id, tier: 'weekly', status: 'active' }, { sort: { periodEnd: 'asc' } }) as OverlaySnapshot[]
    for (const group of groupOverlaySnapshots(snapshots.filter(snapshot => snapshot.periodEnd <= monthlyCutoff), config.overlayMonthlyWindowDays ?? 10)) {
      const existing = (await this.dbGet('interlude_overlay_snapshot', {
        storyId: story.id, participantId: group.participantId, target: group.target, tier: 'monthly', periodStart: group.from,
      }))[0] as OverlaySnapshot | undefined
      if (existing) continue
      const participant = group.participantId ? await this.getParticipant(group.participantId) : undefined
      const decision = await this.compactor.compactOverlay({ story, participant, target: group.target, tier: 'monthly', from: group.from, to: group.to, patches: [], snapshots: group.snapshots })
      const summary = clip(decision.summary, config.overlayMonthlySummaryCharacters ?? 2_400)
      if (!summary) continue
      await this.dbCreate('interlude_overlay_snapshot', {
        storyId: story.id, participantId: group.participantId, target: group.target, tier: 'monthly', periodStart: group.from, periodEnd: group.to,
        summary, majorEvents: normalizeMajorEvents(decision.majorEvents, [], group.snapshots), sourcePatchIds: group.snapshots.flatMap(snapshot => snapshot.sourcePatchIds), status: 'active', createdAt: now, updatedAt: now,
      })
      for (const snapshot of group.snapshots) await this.dbSet('interlude_overlay_snapshot', { id: snapshot.id }, { status: 'superseded', updatedAt: now })
      changed = true
    }
    if (changed) {
      await this.rebuildLiveOverlayState(story, now)
      this.reportOperation('standard', 'info', story, 'advance', 'Overlay 分层归档完成：最近 %d 天保留原始补丁，短期窗口=%d天，长期窗口=%d天', config.overlayRecentDays ?? 2, config.overlayWeeklyWindowDays ?? 5, config.overlayMonthlyWindowDays ?? 10)
    }
    return changed
    } catch (error) {
      // Overlay maintenance is optional background work. A bad compression
      // response must leave raw patches untouched and never block narration.
      this.reportOperation('standard', 'warn', story, 'advance', 'Overlay 分层归档跳过：%s', error)
      return false
    }
  }

  private async overlaySnapshotsForPrompt(storyId: string, participantId?: string, background = false) {
    if (!this.memoryConfig.overlayCompressionEnabled) return [] as OverlaySnapshot[]
    const rows = await this.dbGet('interlude_overlay_snapshot', { storyId, status: 'active' }, { sort: { periodEnd: 'desc' } }) as OverlaySnapshot[]
    const visible = rows.filter(snapshot => !snapshot.participantId || (background ? this.sharedStoryConfig.shareParticipantDetails : snapshot.participantId === participantId))
    // Current long-term state plus recent short-window deltas is sufficient; older
    // snapshots remain searchable/auditable without permanently taxing prompts.
    const result: OverlaySnapshot[] = []
    for (const target of ['character', 'perspective', 'world', 'relationship'] as const) {
      const matches = visible.filter(snapshot => snapshot.target === target)
      const monthly = matches.find(snapshot => snapshot.tier === 'monthly')
      if (monthly) result.push(monthly)
      result.push(...matches.filter(snapshot => snapshot.tier === 'weekly').slice(0, 4))
    }
    return result
  }

  /** Once a snapshot safely represents older changes, keep state.overlay as
   * the live (uncompacted) delta only. This is what actually reduces prompt
   * size; snapshots carry the older evolution separately. */
  private async rebuildLiveOverlayState(story: InterludeStory, now: Date) {
    const [applied, snapshots] = await Promise.all([
      (this.dbGet('interlude_state_patch', { storyId: story.id, status: 'applied' }) as Promise<StatePatchProposal[]>)
        .then(rows => rows.filter(item => !item.path.startsWith('development.'))),
      this.dbGet('interlude_overlay_snapshot', { storyId: story.id, status: 'active' }) as Promise<OverlaySnapshot[]>,
    ])
    // 统一语义:overlay 字段恒等于"全部未压缩(仍为 applied)补丁"的合并。
    // 此前仅当该 target 已存在压缩快照时才重建——无快照的新故事、以及关闭
    // 压缩的实例,applied 补丁永远进不了 overlay,演化要等首个压缩周期才可见。
    const overlay = { ...(story.state.settingOverlay ?? {}) }
    const mergeGlobal = (target: StatePatchProposal['target']) => {
      for (const patch of applied.filter(item => !item.participantId && item.target === target)) {
        if (target === 'character' && patch.path.includes('trait')) {
          overlay.characterTraits = [...(overlay.characterTraits ?? []), clip(patch.proposedValue, 500)]
        } else {
          overlay[target as 'characterProfile' | 'perspective' | 'world' | 'relationship'] =
            mergeNote(overlay[target as 'characterProfile' | 'perspective' | 'world' | 'relationship'], patch.proposedValue)
        }
      }
    }
    overlay.characterProfile = undefined
    overlay.characterTraits = []
    overlay.perspective = undefined
    overlay.world = undefined
    overlay.relationship = undefined
    mergeGlobal('character')
    mergeGlobal('perspective')
    mergeGlobal('world')
    mergeGlobal('relationship')
    overlay.characterTraits = Array.from(new Set(overlay.characterTraits ?? [])).slice(-30)
    await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState({ ...decodeStoryState(story.state), settingOverlay: overlay }), updatedAt: now })

    const participantIds = Array.from(new Set([
      ...snapshots.filter(snapshot => snapshot.target === 'relationship' && !!snapshot.participantId).map(snapshot => snapshot.participantId),
      ...applied.filter(patch => patch.target === 'relationship' && !!patch.participantId).map(patch => patch.participantId),
    ]))
    for (const participantId of participantIds) {
      const participant = await this.getParticipant(participantId)
      if (!participant) continue
      const state = normalizeParticipantState(participant.state)
      state.relationshipOverlay = undefined
      for (const patch of applied.filter(item => item.target === 'relationship' && item.participantId === participantId)) {
        state.relationshipOverlay = mergeNote(state.relationshipOverlay, patch.proposedValue)
      }
      await this.dbSet('interlude_participant', { id: participant.id }, { state, updatedAt: now })
    }
  }

  private async prepareCompactionEmbeddings(storyId: string, decision: CompactionDecision, entries: ScriptEntry[]) {
    const vectors = new Map<string, number[]>()
    if (!decision.facts?.length) return vectors
    const generation = this.taskGeneration(storyId)
    const existing = await this.dbGet('interlude_fact', { storyId, status: 'active' })
    for (const draft of decision.facts) {
      const content = clip(draft.content, this.memoryConfig.factContentCharacters)
      if (!content || !hasCompactionEvidence(draft.sourceEntryIds, entries)
        || factContentLooksAmbiguous(draft.scope, content)) continue
      const key = normalizeFact(content)
      if (vectors.has(key)) continue
      if (!this.taskGenerationCurrent(storyId, generation)) return vectors
      const same = existing.find(fact => normalizeFact(fact.content) === key && fact.embedding?.length)
      const vector = same?.embedding ?? await this.embedText(content)
      if (!this.taskGenerationCurrent(storyId, generation)) return vectors
      vectors.set(key, vector)
    }
    return vectors
  }

  private async persistCompaction(story: InterludeStory, scene: InterludeScene, decision: CompactionDecision, entries: ScriptEntry[], now: Date, visibleFactIds = new Set<number>(), precedingEntries: ScriptEntry[] = [], factEmbeddings?: Map<string, number[]>) {
    const generation = this.taskGeneration(story.id)
    const prepared = factEmbeddings ?? await this.prepareCompactionEmbeddings(story.id, decision, entries)
    const commit = async () => {
      if (this.databaseResetting || this.taskGeneration(story.id) !== generation) throw new Error('Compaction generation is obsolete')
      const fresh = (await this.dbGet('interlude_scene', { storyId: story.id, id: scene.id }))[0] as InterludeScene | undefined
      if (!fresh || fresh.status === 'closed' || (fresh.lastEntryId ?? null) !== (scene.lastEntryId ?? null)) {
        throw new Error('Compaction scene checkpoint changed; prepare a fresh review')
      }
      await this.persistCompactionOutputs(story, scene, decision, entries, now, visibleFactIds, precedingEntries, prepared)
    }
    await this.dbWrite(async () => {
      this.transactionRunning = true
      try {
        await this.ctx.database.withTransaction(database => this.transactionScope.run(database, commit))
      } finally { this.transactionRunning = false }
    })
    this.scheduleFactEmbeddingBackfill(story.id)
  }

  private async persistCompactionOutputs(story: InterludeStory, scene: InterludeScene, decision: CompactionDecision, entries: ScriptEntry[], now: Date, visibleFactIds = new Set<number>(), precedingEntries: ScriptEntry[] = [], factEmbeddings = new Map<string, number[]>()) {
    assertContinuityReview(decision)
    if (!entries.length) return
    for (const draft of decision.episodeTags ?? []) {
      const source = entries.find(entry => entry.id === draft.sourceEntryId)
      if (!source) continue
      const tags = groundedEpisodeTags(source.content, draft)
      if (!Object.keys(tags).length) continue
      const current = (await this.dbGet('interlude_script_entry', { storyId: story.id, id: source.id }))[0] as ScriptEntry | undefined
      if (!current) continue
      await this.dbSet('interlude_script_entry', { id: source.id }, { metadata: { ...current.metadata, episodeTags: tags } })
      this.invalidateHistoryVectors(story.id)
    }
    // Commit the arc before acknowledging the incremental evidence. A failed
    // arc write must not silently discard the material it was to learn from.
    const arc = await this.activeArc(story.id)
    if (!arc) throw new Error('Continuity review has no active arc')
    await this.dbSet('interlude_arc', { id: arc.id }, {
      title: clip(decision.arc!.title?.trim() || arc.title, 255),
      summary: clip(decision.arc!.summary!, this.memoryConfig.arcSummaryCharacters), updatedAt: now,
    })
    const scenePatch = decision.scene ?? {}
    const presenceUpdates = normalizeScenePresenceDrafts(scenePatch.presence, entries, now)
    // 压缩器附带的主角节奏（五档,推进密度输入）+ 旧三值 lifeStatus（群聊意愿 auto 档输入）。
    // 五档落 lifeRhythm;旧三值同步映射到 lifeStatus 保持群聊意愿兼容。
    const rhythmDraft = normalizeLifeRhythmDraft(decision.lifeRhythm)
    const nextLifeStatus = rhythmDraft?.attention
      ? rhythmDraft.attention === 'occupied' ? 'busy' as const
        : rhythmDraft.attention === 'asleep' ? 'asleep' as const
        : 'idle' as const
      : normalizeLifeStatusDraft(decision.lifeStatus)
    if (nextLifeStatus) {
      const current = await this.getStory(story.id)
      const state = decodeStoryState(current.state)
      const nextRhythm = rhythmDraft ? {
        attention: rhythmDraft.attention as 'phone-focused' | 'available' | 'occupied' | 'resting' | 'asleep',
        basis: rhythmDraft.basis || '压缩器评估',
        assessedAt: now.toISOString(),
        source: 'compactor' as const,
      } : undefined
      const statusChanged = state.lifeStatus?.status !== nextLifeStatus
      const rhythmChanged = !!nextRhythm && state.lifeRhythm?.attention !== nextRhythm.attention
      if (statusChanged || rhythmChanged) {
        await this.dbSet('interlude_story', { id: current.id }, {
          state: encodeStoryState({
            ...state,
            ...(nextLifeStatus ? { lifeStatus: { status: nextLifeStatus, updatedAt: now.toISOString() } } : {}),
            ...(nextRhythm ? { lifeRhythm: nextRhythm } : {}),
          }), updatedAt: now,
        })
        this.reportOperation('diagnostic', 'debug', story, 'advance', '生活节奏已更新 状态=%s 节奏=%s',
          nextLifeStatus ?? '(不变)', nextRhythm?.attention ?? '(不变)')
      }
    }
    if (presenceUpdates.length) {
      const current = await this.getStory(story.id)
      const state = decodeStoryState(current.state)
      const byName = new Map(state.scenePresence.map(item => [item.name, item]))
      for (const update of presenceUpdates) {
        if (Math.max(...update.sourceEntryIds) < (state.sceneFrame?.localBoundaryEntryId ?? 0)) continue
        const previous = byName.get(update.name)
        if (previous && Math.max(...previous.sourceEntryIds) > Math.max(...update.sourceEntryIds)) continue
        byName.set(update.name, update)
      }
      await this.dbSet('interlude_story', { id: current.id }, {
        state: encodeStoryState({ ...state, scenePresence: [...byName.values()].slice(-8) }), updatedAt: now,
      })
    }
    if (decision.workingDetails?.length) {
      const current = await this.getStory(story.id)
      const state = decodeStoryState(current.state)
      const merged = new Map<string, WorkingDetail>()
      const resolutions = { ...state.workingDetailResolutions }
      for (const item of state.workingDetails ?? []) merged.set(item.label, item)
      for (const draft of decision.workingDetails) {
        if (!hasCompactionEvidence(draft.sourceEntryIds ?? [], entries)) continue
        const label = clip(draft.label, 80).trim()
        const revision = Math.max(...(draft.sourceEntryIds ?? []).filter(id => entries.some(entry => entry.id === id)))
        if (revision <= (resolutions[label] ?? 0)) continue
        const previous = merged.get(label)
        if (previous && revision <= Math.max(0, ...(previous.sourceEntryIds ?? []))) continue
        const sources = entries.filter(entry => draft.sourceEntryIds?.includes(entry.id))
        const owners = new Set(sources.map(entry => entry.participantId))
        const participantId = owners.size === 1 ? sources[0].participantId : undefined
        if (previous?.participantId !== undefined && previous.participantId !== participantId) continue
        const sourceEntryIds = (draft.sourceEntryIds ?? []).filter(id => entries.some(entry => entry.id === id)).slice(0, 8)
        const knowledge = normalizeKnowledgeEvidence(draft.knowledge, entries, sourceEntryIds)
        if (previous?.knowledge && supportsRecordedOutcome(previous.knowledge) && !supportsRecordedOutcome(knowledge)) continue
        if (label && draft.resolved === true) { merged.delete(label); resolutions[label] = revision; continue }
        const value = clip(draft.value, 300).trim()
        if (!label || !value) continue
        const expiresAt = draft.expiresAt && !Number.isNaN(new Date(draft.expiresAt).getTime()) ? draft.expiresAt : undefined
        const replacesLabel = clip(draft.replacesLabel, 80).trim()
        const replaced = replacesLabel && replacesLabel !== label ? merged.get(replacesLabel) : undefined
        if (replacesLabel && replacesLabel !== label
          && (!replaced || previous || revision <= (resolutions[replacesLabel] ?? 0))) continue
        if (replaced) {
          const sameOwner = replaced.participantId !== undefined
            ? replaced.participantId === participantId
            : !!replaced.knowledge?.holder && replaced.knowledge.holder === knowledge.holder
          if (!sameOwner || !supportsRecordedOutcome(knowledge)
            || revision <= Math.max(resolutions[replacesLabel] ?? 0, ...(replaced.sourceEntryIds ?? [0]))) continue
          merged.delete(replacesLabel)
          resolutions[replacesLabel] = revision
        }
        merged.set(label, { label, value, knowledge, ...(participantId !== undefined ? { participantId } : {}),
          ...(expiresAt ? { expiresAt } : {}), createdAt: previous?.createdAt ?? replaced?.createdAt ?? now.toISOString(),
          ...(sourceEntryIds.length ? { sourceEntryIds } : {}) })
      }
      const live = [...merged.values()].filter(item => !item.expiresAt || new Date(item.expiresAt) > now).slice(-10)
      await this.dbSet('interlude_story', { id: current.id }, { state: encodeStoryState({ ...state, workingDetails: live, workingDetailResolutions: resolutions }), updatedAt: now })
    }
    let resolvedFacts = false
    for (const fact of decision.facts ?? []) {
      if (!hasCompactionEvidence(fact.sourceEntryIds, entries)) {
        this.reportOperation('diagnostic', 'debug', story, 'advance', '长期事实未写入：缺少本轮新条目来源')
        continue
      }
      const knowledge = normalizeKnowledgeEvidence(fact.knowledge, entries, fact.sourceEntryIds ?? [])
      const resolved = supportsRecordedOutcome(knowledge)
        ? await this.resolveCompactionFacts(story.id, fact.resolvesFactIds, visibleFactIds, now) : false
      resolvedFacts ||= resolved
      const mergedResolution = await this.persistFact(story.id, fact, entries, now, factEmbeddings.get(normalizeFact(clip(fact.content, this.memoryConfig.factContentCharacters))) ?? [])
      resolvedFacts ||= mergedResolution
    }
    for (const patch of decision.statePatches ?? []) {
      if (!hasCompactionEvidence(patch.sourceEntryIds, entries)) {
        this.reportOperation('diagnostic', 'debug', story, 'advance', '发展提案未保留：缺少本轮新条目来源')
        continue
      }
      // Earlier feedback can support a new response, but only this increment
      // advances the checkpoint or qualifies a proposal as new evidence.
      await this.persistStatePatch(story, patch,
        patch.target === 'relationship' ? [...precedingEntries, ...entries] : entries, now)
    }
    if (resolvedFacts) await this.markContinuityDirty(story.id, now)
    // All outputs must succeed before the incremental frontier advances.
    const explicitBoundary = scenePatch.close === true
      && !!scenePatch.boundary?.reason.trim()
      && hasCompactionEvidence(scenePatch.boundary.sourceEntryIds, entries)
    await this.dbSet('interlude_scene', { id: scene.id }, {
      hook: clip(scenePatch.hook ?? scene.hook, this.memoryConfig.sceneHookCharacters),
      summary: clip(scenePatch.summary ?? scene.summary, this.memoryConfig.sceneSummaryCharacters),
      entryCount: Math.max(0, scene.entryCount) + entries.length,
      lastEntryId: entries.at(-1)?.id ?? scene.lastEntryId,
      updatedAt: now,
    })
    if (explicitBoundary) {
      // Preserve boundary provenance beside its original evidence. This
      // checkpoint is navigation only, with no generated summary or prose.
      const sourceIds = scenePatch.boundary!.sourceEntryIds.filter(id => entries.some(entry => entry.id === id))
      const boundaryEntry = entries.find(entry => entry.id === Math.max(...sourceIds))
      if (boundaryEntry) {
        const source = (await this.dbGet('interlude_script_entry', { id: boundaryEntry.id }))[0] as ScriptEntry | undefined
        if (source?.storyId === story.id) {
          const first = (await this.dbGet('interlude_script_entry', {
            storyId: story.id, occurredAt: { $gte: scene.startedAt }, id: { $lte: boundaryEntry.id },
          }, { sort: { id: 'asc' }, limit: 1 }))[0] as ScriptEntry | undefined
          await this.dbSet('interlude_script_entry', { id: source.id }, {
            metadata: { ...source.metadata, sceneCheckpoint: {
              sceneId: scene.id, startedAt: scene.startedAt.toISOString(),
              endedAt: entries.at(-1)!.occurredAt.toISOString(),
              boundarySourceEntryIds: sourceIds,
              reason: scenePatch.boundary!.reason,
              firstEntryId: first?.id ?? boundaryEntry.id,
              lastEntryId: entries.at(-1)?.id ?? scene.lastEntryId,
            } },
          })
          this.invalidateHistoryVectors(story.id)
        }
      }
      // Close at the processed frontier, not at model completion. Entries
      // arriving during the background request belong to the next review.
      const frontier = entries.at(-1)!.occurredAt
      await this.dbSet('interlude_scene', { id: scene.id }, { status: 'closed', endedAt: frontier, updatedAt: now })
      await this.ensureContinuity(story, frontier)
      const nextScene = await this.activeScene(story.id)
      if (nextScene) await this.dbSet('interlude_scene', { id: nextScene.id }, { lastEntryId: entries.at(-1)!.id })
    }
  }

  private async persistFact(storyId: string, draft: import('./types').FactDraft, entries: ScriptEntry[], now: Date, preparedEmbedding: number[] = []) {
    const content = clip(draft.content, this.memoryConfig.factContentCharacters)
    if (!content) return false
    // Durable facts are global narrative evidence. Ignore the legacy model
    // participantId field and persist new facts with an empty compatibility value.
    const participantId = ''
    if (factContentLooksAmbiguous(draft.scope, content)) return false
    const existing = await this.dbGet('interlude_fact', { storyId, status: 'active' })
    // 当前先做完全规范化匹配的去重；更复杂的语义去重可在检索层升级时替换。
    const matching = existing.filter(fact => normalizeFact(fact.content) === normalizeFact(content))
    const sourceEntryIds = (draft.sourceEntryIds ?? []).filter(id => entries.some(entry => entry.id === id)).slice(0, 20)
    const relatedFactIds = Array.isArray(draft.knowledge?.relatedFactIds)
      ? draft.knowledge.relatedFactIds.filter(id => existing.some(fact => fact.id === id)) : []
    const knowledge = normalizeKnowledgeEvidence(draft.knowledge, entries, sourceEntryIds, relatedFactIds)
    // Promise facts are unresolved by default, unless the compactor explicitly
    // says that the promise has already been fulfilled or closed.
    const canClose = supportsRecordedOutcome(knowledge)
    const same = matching.find(fact => (fact.knowledge?.mode ?? 'unclassified') === knowledge.mode)
      ?? matching.find(fact => !fact.knowledge && canClose)
    const unresolved = draft.unresolved === true || (draft.scope === 'promise' && (draft.unresolved !== false || !canClose))
    if (same && ((same.knowledge?.mode ?? 'unclassified') === knowledge.mode || !same.knowledge && canClose)) {
      const resolved = same.unresolved && draft.unresolved === false && canClose
      const embedding = same.embedding?.length ? same.embedding : preparedEmbedding
      await this.dbSet('interlude_fact', { id: same.id }, {
        importance: Math.max(same.importance, clampNumber(draft.importance, same.importance, 0, 1)),
        confidence: knowledge.clauses.some(clause => !same.sourceEntryIds.includes(clause.sourceEntryId)
          && ['observation', 'confirmation'].includes(clause.role)
          && entries.some(entry => entry.id === clause.sourceEntryId && ['user-message', 'character-message'].includes(entry.kind)))
          ? Math.max(same.confidence, clampNumber(draft.confidence, same.confidence, 0, 1)) : same.confidence,
        unresolved: resolved ? false : same.unresolved || unresolved,
        ...(embedding.length ? { embedding } : {}),
        sourceEntryIds: Array.from(new Set([...same.sourceEntryIds, ...sourceEntryIds])), lastSeenAt: now, updatedAt: now,
        knowledge: { ...knowledge, clauses: [...new Map([...(same.knowledge?.clauses ?? []), ...knowledge.clauses].map(clause => [JSON.stringify(clause), clause])).values()].slice(-12),
          relatedFactIds: [...new Set([...(same.knowledge?.relatedFactIds ?? []), ...knowledge.relatedFactIds])].slice(-12) },
      })
      return resolved
    }
    if (existing.length >= this.memoryConfig.maxFactsPerStory) {
      const oldest = existing.sort((a, b) => (a.importance * a.confidence) - (b.importance * b.confidence))[0]
      if (oldest) await this.dbSet('interlude_fact', { id: oldest.id }, { status: 'superseded', updatedAt: now })
    }
    await this.dbCreate('interlude_fact', {
      storyId, participantId, scope: draft.scope, content, knowledge, importance: clampNumber(draft.importance, 0.5, 0, 1),
      confidence: clampNumber(draft.confidence, 0.5, 0, 1), unresolved,
      embedding: preparedEmbedding, status: 'active', sourceEntryIds,
      lastSeenAt: now, createdAt: now, updatedAt: now,
    })
    return false
  }

  private async embedText(value: string) {
    try {
      return await this.embedder.embed(value)
    } catch (error) {
      // Embeddings improve recall but must never make a private-message turn fail.
      this.reportStandaloneOperation('diagnostic', 'debug', 'Embedding 请求跳过 错误=%s', error)
      return []
    }
  }

  private scheduleFactEmbeddingBackfill(storyId: string) {
    const embedding = this.config.model.embedding
    const batchSize = embedding?.backfillBatchSize ?? 5
    if (!embedding?.enabled || !this.modelRouting.embedding.available || batchSize <= 0) return
    if (this.factBackfills.has(storyId)) return
    this.factBackfills.add(storyId)
    // This maintenance task deliberately stays out of the narrative serial queue:
    // it only fills an optional index column and must not delay a new user event.
    void this.backfillFactEmbeddings(storyId, batchSize)
      .catch(error => this.reportStandaloneOperation('diagnostic', 'debug', '长期事实向量补齐跳过 错误=%s', error))
      .finally(() => this.factBackfills.delete(storyId))
  }

  private async backfillFactEmbeddings(storyId: string, batchSize: number) {
    const generation = this.taskGeneration(storyId)
    if (!this.taskGenerationCurrent(storyId, generation)) return
    const facts = await this.dbGet('interlude_fact', { storyId, status: 'active' })
    const missing = facts
      .filter(fact => !fact.embedding?.length)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, Math.max(0, batchSize))
    for (const fact of missing) {
      if (!this.taskGenerationCurrent(storyId, generation)) break
      const embedding = await this.embedText(fact.content)
      if (!this.taskGenerationCurrent(storyId, generation)) break
      if (embedding.length) await this.dbSet('interlude_fact', { id: fact.id, storyId, status: 'active', content: fact.content }, { embedding })
    }
  }

  private async persistStatePatch(story: InterludeStory, draft: StatePatchDraft, entries: ScriptEntry[], now: Date) {
    const confidence = clampNumber(draft.confidence, 0, 0, 1)
    const participantId = draft.target === 'perspective' ? '' : resolveParticipantId(draft.participantId, draft.sourceEntryIds, entries)
    const dimension = developmentDimension(draft.target, draft.path || '')
    const path = dimension ? `development.${dimension}` : ''
    const sourceEntryIds = (draft.sourceEntryIds ?? []).filter(id => entries.some(entry => entry.id === id)).slice(0, 20)
    const proposedValue = clip(draft.proposedValue, 4_000)
    const impact = draft.impact === 'major' ? 'major' : 'minor'
    if (!path || !proposedValue || !sourceEntryIds.length) return
    // Relationship observations must remain in their named branch; private
    // material cannot become a global personality or world change.
    if (draft.target === 'relationship' && !participantId) return
    if (draft.target === 'relationship' && entries.some(entry => sourceEntryIds.includes(entry.id)
      && entry.participantId && entry.participantId !== participantId)) return
    if (draft.target !== 'relationship' && entries.some(entry => sourceEntryIds.includes(entry.id) && !!entry.participantId)) return
    // A relationship tendency becomes usable only when actual user feedback
    // and the protagonist's subsequent delivered answer support the same
    // reading. This prevents one scene's prose rhythm from becoming a claim
    // about the relationship before the other person has participated in it.
    const receptionSupported = draft.target !== 'relationship' || reviewedDevelopmentSupport(draft, entries, participantId)
    if (!receptionSupported) {
      this.reportOperation('diagnostic', 'debug', story, 'advance',
        '关系发展提案暂不保留：缺少有效的用户反馈与后续已送达回应证据 目标=%s/%s', draft.target, path)
      return
    }

    // Merge repeated proposals for one setting path before evaluating them.
    const candidates = await this.dbGet('interlude_state_patch', {
      storyId: story.id, participantId, target: draft.target, path,
    }) as StatePatchProposal[]
    const matching = candidates.filter(candidate => patchClaimsMatch(candidate.proposedValue, proposedValue))
    for (const contradicted of candidates.filter(candidate => (candidate.status === 'proposed' || candidate.status === 'applied')
      && draft.contradictsProposalIds?.includes(candidate.id))) {
      const fresh = sourceEntryIds.filter(id => !contradicted.sourceEntryIds.includes(id))
      if (!fresh.length) continue
      await this.dbSet('interlude_state_patch', { id: contradicted.id }, {
        confidence: Math.max(0, contradicted.confidence - 0.2),
        status: 'rejected',
        sourceEntryIds: [...new Set([...contradicted.sourceEntryIds, ...fresh])],
        evidence: clip(mergeNote(contradicted.evidence, `Counter-evidence (${fresh.join(',')}): ${draft.evidence}`), 4_000),
      })
    }
    if (draft.contradictsProposalIds?.length) return
    if (matching.some(candidate => candidate.status === 'applied' || candidate.status === 'compacted')) return
    const candidate = matching.find(item => item.status === 'proposed')
    const mergedSourceEntryIds = Array.from(new Set([
      ...(candidate?.sourceEntryIds ?? []), ...sourceEntryIds,
    ])).slice(0, 80)
    const sourceRows = await this.dbGet('interlude_script_entry', {
      storyId: story.id, id: { $in: mergedSourceEntryIds },
    }) as ScriptEntry[]
    const evidence = statePatchEvidence(sourceRows, story.setting.timezone)
    // 下限 1:回合/天数下限开放给管理员调整(默认 3/2,见 Console 演化分区)
    const minimumTurns = Math.max(1, this.memoryConfig.statePatchMinTurns ?? this.memoryConfig.statePatchMinEvidence)
    const minimumDays = Math.max(1, this.memoryConfig.statePatchMinDays ?? 2)
    const minimum = impact === 'major' ? this.memoryConfig.majorStatePatchConfidenceThreshold : this.memoryConfig.statePatchConfidenceThreshold
    const oldScenes = developmentScenes(sourceRows.filter(entry => candidate?.sourceEntryIds.includes(entry.id)))
    const mergedConfidence = candidate ? Math.min(confidence, candidate.confidence + (receptionSupported && evidence.scenes > oldScenes ? 0.05 : 0)) : confidence
    const mergedEvidenceText = mergeNote(candidate?.evidence, draft.evidence)
    const proposal = candidate ?? await this.dbCreate('interlude_state_patch', {
      storyId: story.id, participantId, target: draft.target, path, proposedValue,
      evidence: clip(mergedEvidenceText, 4_000), confidence: mergedConfidence, impact,
      status: 'proposed', sourceEntryIds: mergedSourceEntryIds, createdAt: now, appliedAt: null,
    })
    if (candidate?.id) {
      await this.dbSet('interlude_state_patch', { id: candidate.id }, {
        evidence: clip(mergedEvidenceText, 4_000), confidence: mergedConfidence, impact: candidate.impact === 'major' || impact === 'major' ? 'major' : 'minor', sourceEntryIds: mergedSourceEntryIds,
      })
    }

    // Ordinary changes require independent narrative turns on different days.
    if (!receptionSupported) return
    if (!candidate || evidence.scenes <= oldScenes || !this.memoryConfig.autoApplyStatePatches || (impact === 'major' && !this.memoryConfig.allowMajorStateChanges)) return
    const majorMinScenes = Math.max(1, this.memoryConfig.statePatchMajorMinScenes ?? 2)
    const stableEvidence = impact === 'major'
      ? mergedConfidence >= minimum && evidence.scenes >= majorMinScenes
      : mergedConfidence >= minimum && evidence.scenes >= minimumTurns && evidence.days >= minimumDays
    if (!stableEvidence) {
      this.reportOperation('diagnostic', 'debug', story, 'advance',
        'Overlay 候选继续累计 目标=%s/%s 回合=%d/%d 日期=%d/%d', draft.target, path, evidence.turns, minimumTurns, evidence.days, minimumDays)
      return
    }

    const cooldownHours = Math.max(1, this.memoryConfig.statePatchCooldownHours ?? 72)
    const recentApplied = candidates
      .filter(item => item.status === 'applied' || item.status === 'compacted')
      .map(item => item.appliedAt ?? item.createdAt)
      .sort((left, right) => right.getTime() - left.getTime())[0]
    if (recentApplied && now.getTime() - recentApplied.getTime() < cooldownHours * Time.hour) {
      this.reportOperation('diagnostic', 'debug', story, 'advance',
        'Overlay 冷却中，候选保留 目标=%s/%s 冷却=%d小时', draft.target, path, cooldownHours)
      return
    }

    // New tendencies remain sourced records, rather than accumulating in the
    // permanent Canon overlay. The live reader selects only relevant ones.
    if (proposal?.id) {
      await this.dbSet('interlude_state_patch', { id: proposal.id }, { status: 'applied', appliedAt: now })
      // 立即重建 overlay:统一语义下 overlay=未压缩 applied 补丁的合并,
      // 不必等压缩周期(无快照/关压缩的实例此前永远看不到演化)
      await this.rebuildLiveOverlayState(story, now)
    }
  }

  private async developmentForPrompt(storyId: string, participantId: string | undefined, query: string) {
    if (!query.trim()) return []
    const rows = await this.dbGet('interlude_state_patch', { storyId, status: 'applied' }, { limit: 100, sort: { appliedAt: 'desc' } }) as StatePatchProposal[]
    return rows.filter(item => item.path.startsWith('development.') && item.sourceEntryIds.length
      && (!item.participantId || item.participantId === participantId))
      .map(item => ({ item, score: historyLexicalScore(query, item.proposedValue) }))
      .filter(({ score }) => score >= 0.12).sort((a, b) => b.score - a.score).slice(0, 2)
      .map(({ item }) => ({ target: item.target, tendency: clip(item.proposedValue, 300), sourceEntryIds: item.sourceEntryIds }))
  }

  private report(level: 'error' | 'warn' | 'info' | 'debug', story: InterludeStory, phase: NarrativeRequest['phase'], message: string, ...args: unknown[]) {
    this.writeReport(level, story, phase, message, args)
  }

  /** Emit an operational record only when the selected verbosity includes it.
   * Summary is for outcomes, standard is for scheduler/model activity, and
   * diagnostic is for skip reasons and internal counters. */
  private reportOperation(verbosity: 'summary' | 'standard' | 'diagnostic', level: 'error' | 'warn' | 'info' | 'debug', story: InterludeStory, phase: NarrativeRequest['phase'], message: string, ...args: unknown[]) {
    if (!this.allowsVerbosity(verbosity)) return
    this.writeReport(level, story, phase, message, args)
  }

  private writeReport(level: 'error' | 'warn' | 'info' | 'debug', story: InterludeStory, phase: NarrativeRequest['phase'], message: string, args: unknown[]) {
    if (this.blindModeConfig.enabled) {
      if (level === 'error' || level === 'warn') this.blindModeHealthIssue = true
      return
    }
    const rank = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }
    const logging = this.config.logging ?? { level: 'info' as const, format: 'layered' as const, colors: true, colorTheme: 'dark' as const, kaomoji: true, logScriptPreview: false, previewLength: 500 }
    if (rank[logging.level] < rank[level]) return
    const rendered = renderLogMessage(message, args)
    const storyDetail = (logging.verbosity ?? 'standard') === 'diagnostic' ? ` 故事=${story.id}` : ''
    const output = logging.format === 'layered'
      ? formatLayeredLog({
        level, phase, protagonist: story.setting.character.name, message, args,
        colors: logging.colors !== false, colorTheme: logging.colorTheme ?? 'dark', kaomoji: logging.kaomoji !== false,
      })
      : logging.format === 'compact'
        ? `[${phaseLabel(phase)}] ${story.setting.character.name} ${rendered}${storyDetail}`
        : `[${phaseLabel(phase)}] ${story.setting.character.name}\n事件：${rendered}${storyDetail}`
    this.emitLog(level, output)
  }

  private reportStandalone(level: 'error' | 'warn' | 'info' | 'debug', message: string, ...args: unknown[]) {
    this.writeStandalone(level, message, args)
  }

  /** One Koishi log line per model call: token counts, cache hit rate and
   * optional billing from the per-connection price fields. */
  private reportTokenUsage(record: TokenUsageRecord) {
    this.desktopEventSink?.('token', record)
    const line = formatTokenUsageLine(record)
    if (!line) return
    // token 行并入 standard verbosity（此前不受门控，高频热路径放大日志量）。
    this.reportStandaloneOperation('standard', 'info', `Token 用量[${record.task}] 模型=${record.model} ${line}`)
  }

  private reportStandaloneOperation(verbosity: 'summary' | 'standard' | 'diagnostic', level: 'error' | 'warn' | 'info' | 'debug', message: string, ...args: unknown[]) {
    if (!this.allowsVerbosity(verbosity)) return
    this.writeStandalone(level, message, args)
  }

  private writeStandalone(level: 'error' | 'warn' | 'info' | 'debug', message: string, args: unknown[]) {
    if (this.blindModeConfig.enabled) {
      if (level === 'error' || level === 'warn') this.blindModeHealthIssue = true
      return
    }
    const rank = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }
    const logging = this.config.logging ?? { level: 'info' as const, format: 'layered' as const, colors: true, colorTheme: 'dark' as const, kaomoji: true }
    if (rank[logging.level] < rank[level]) return
    const output = logging.format === 'layered'
      ? formatLayeredLog({
        level, protagonist: 'HDSI', message, args, standalone: true,
        colors: logging.colors !== false, colorTheme: logging.colorTheme ?? 'dark', kaomoji: logging.kaomoji !== false,
      })
      : `[系统] ${renderLogMessage(message, args)}`
    this.emitLog(level, output)
  }

  private async resolveCompactionFacts(storyId: string, value: unknown, allowedIds: ReadonlySet<number>, now: Date) {
    const ids = Array.isArray(value)
      ? Array.from(new Set(value.filter(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && allowedIds.has(id)))).slice(0, 20)
      : []
    if (!ids.length) return false
    const facts = await this.dbGet('interlude_fact', { storyId, id: { $in: ids }, status: 'active' }) as NarrativeFact[]
    const unresolved = facts.filter(fact => fact.unresolved)
    if (!unresolved.length) return false
    await this.dbSet('interlude_fact', { id: { $in: unresolved.map(fact => fact.id) } }, { unresolved: false, lastSeenAt: now, updatedAt: now })
    return true
  }

  private async markContinuityDirty(storyId: string, now: Date) {
    const story = await this.getStory(storyId)
    const state = decodeStoryState(story.state)
    if (state.continuityDirty) return
    await this.dbSet('interlude_story', { id: storyId }, { state: encodeStoryState({ ...state, continuityDirty: true }), updatedAt: now })
  }

  private emitLog(level: 'error' | 'warn' | 'info' | 'debug', output: string) {
    if (level === 'error') this.serviceLogger.error(output)
    else if (level === 'warn') this.serviceLogger.warn(output)
    else if (level === 'info') this.serviceLogger.info(output)
    else this.serviceLogger.debug(output)
  }

  private reportBlindModeHealth() {
    const status = this.blindModeHealthIssue || this.databaseResetting ? '需关注' : '正常'
    const scheduler = this.backgroundStarted ? '运行中' : '未就绪'
    // This is the sole HDSI record emitted in Blind Mode. It deliberately
    // carries no story, account, model, message, or failure-detail content.
    this.serviceLogger.info(`[失明模式] 运行状态=${status} 后台任务=${scheduler}`)
    this.blindModeHealthIssue = false
  }

  private allowsVerbosity(required: 'summary' | 'standard' | 'diagnostic') {
    const rank = { summary: 1, standard: 2, diagnostic: 3 }
    const configured = this.config.logging?.verbosity ?? 'standard'
    return rank[configured] >= rank[required]
  }

  private async getStory(id: string) {
    const story = (await this.dbGet('interlude_story', { id }))[0]
    if (!story) throw new Error(`Interlude story not found: ${id}`)
    if (!this.reportedStateMigrations.has(story.id)) {
      this.reportedStateMigrations.add(story.id)
      const inspection = inspectStoryStateMigration(story.state, this.config.storyDefaults.perspective)
      if (inspection.perspectiveDefaultAvailable && !story.setting.perspective?.trim()) {
        this.reportOperation('diagnostic', 'debug', story, 'advance',
          '状态迁移提示：当前故事未持久化 Perspective，但 Console 默认值可用；本阶段只报告，不自动改写 Canon')
      }
      if (inspection.unknownKeys.length) {
        this.reportOperation('diagnostic', 'debug', story, 'advance',
          '状态迁移保留未知扩展字段 数量=%d', inspection.unknownKeys.length)
      }
    }
    return story
  }

  /** 当前异步调用链正在其中执行的故事串行域(用于嵌套写路径判断"已在队列内,勿再排队")。 */
  private serialScope = new AsyncLocalStorage<string>()

  private inSerial(id: string) {
    // 基础设施缺失(最小测试桩/旧嵌入形态仅挂原型)时按"已在域内"处理,
    // 保持旧的直接执行语义,不因缺 serialScope/queues 而抛错
    if (!this.serialScope || !this.queues) return true
    return this.serialScope.getStore() === id
  }

  /** serial 看门狗(rc50 issue 报告)：任务占用队列超 2 分钟打 warn——
   * 单次网络挂起曾把整条执行链永久堵死且无任何日志,重启才能恢复。 */
  private serialWatchdog: Map<string, { startedAt: number, stack: string }> = new Map()

  private serial<T>(id: string, task: () => Promise<T>) {
    // catch 保证前一次失败不会永久堵住同一故事；finally 语义通过 then 的两个分支释放队列。
    const previous = this.queues.get(id) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => {
      // 看门狗 token 在任务实际开始时写入(非入队时),且已有执行中任务的
      // token 不被后续排队任务覆盖——否则挂死任务的时间戳被新任务顶掉。
      if (!this.serialWatchdog.has(id)) {
        this.serialWatchdog.set(id, {
          startedAt: Date.now(),
          stack: (new Error('serial-task-origin').stack ?? '').split('\n').slice(2, 6).join(' <- '),
        })
      }
      return this.serialScope.run(id, task)
    })
    this.queues.set(id, current)
    void current.then(
      () => { if (this.queues.get(id) === current) { this.queues.delete(id); this.serialWatchdog.delete(id) } },
      () => { if (this.queues.get(id) === current) { this.queues.delete(id); this.serialWatchdog.delete(id) } },
    )
    return current
  }

  /** 看门狗扫描：占用超 2 分钟的任务告警一次（每 token 只报一次）。 */
  private reportStuckSerialQueues() {
    for (const [id, token] of this.serialWatchdog) {
      const heldMs = Date.now() - token.startedAt
      if (heldMs > 120_000) {
        this.reportStandalone('warn', '故事执行链占用超时 故事=%s 已占用=%d秒 起点=%s（若持续无后续动作请检查 OneBot 连接；重启可恢复）', id, Math.round(heldMs / 1000), token.stack || '(未知)')
        this.serialWatchdog.delete(id)
      }
    }
  }

  private dbWrite<T>(task: () => Promise<T>) {
    if (this.transactionScope.getStore()) return task()
    const run = this.databaseWriteQueue.then(() => this.retryDbWrite(task), () => this.retryDbWrite(task))
    this.databaseWriteQueue = run.catch(() => undefined)
    return run
  }

  /**
   * A SQLite/sql.js read can fail during the same short filesystem hiccup as a
   * write. Reads stay concurrent for normal performance; only transient driver
   * errors receive a small bounded retry instead of aborting a user turn.
   */
  private async dbRead<T>(task: () => Promise<T>) {
    if (this.transactionScope.getStore()) return task()
    if (this.transactionRunning) await this.databaseWriteQueue
    const delays = [50, 125, 250]
    for (let attempt = 0; ; attempt++) {
      try {
        return await task()
      } catch (error) {
        if (attempt >= delays.length || !isTransientDatabaseError(error)) {
          if (isTransientDatabaseError(error)) {
            this.reportStandalone('warn', 'SQLite 读取连续失败，已停止重试 错误=%s', error)
          }
          throw error
        }
        const delay = delays[attempt] + Math.floor(Math.random() * 25)
        this.reportStandaloneOperation('diagnostic', 'debug', 'SQLite 读取暂时失败，准备重试 等待=%dms 次数=%d 错误=%s', delay, attempt + 1, error)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  private dbGet(table: string, query: unknown, options?: unknown): Promise<any[]> {
    return this.dbRead(async () => {
      const rows = await (this.transactionScope.getStore() ?? this.ctx.database).get(table as never, query as never, options as never) as any[]
      return rows.map(row => normalizeDatabaseRow(table, row))
    })
  }

  /** Repair only a stale canonical story whose configured bot is no longer
   * online. A live OneBot session is stronger evidence than historical story
   * metadata, while a still-online story bot remains untouched. */
  private async repairCanonicalOneBotStoryTransport(story: InterludeStory, session: Session) {
    if (!isOneBotPlatform(session.platform) || !session.selfId) return story
    const hasLiveStoryBot = this.ctx.bots.some(bot => String(bot.selfId) === String(story.selfId)
      && (bot.platform === story.platform || isOneBotPlatform(bot.platform) && isOneBotPlatform(story.platform)))
    if (hasLiveStoryBot || (story.platform === session.platform && String(story.selfId) === String(session.selfId))) return story
    const now = new Date()
    // M1 审计修复 多角色端点时先查数量——入站账号不改写任何端点地址，
    // 仅刷新命中端点的在线状态；地址修复只属于单端点故事（旧世界漂移自愈）。
    await this.ensureEndpointRegistry()
    const roleRows = this.endpointRows.filter(row => row.ownerKind === 'story-role' && row.ownerId === story.id)
    if (roleRows.length > 1) {
      const newAccountKey = `onebot:${String(session.selfId).trim()}`
      const hit = roleRows.find(row => row.accountKey === newAccountKey)
      if (hit) {
        const previous = this.endpointStates.get(hit.id) ?? freshEndpointState(hit.id)
        this.setEndpointState(hit.id, stateAfterConnection(previous, true))
      }
      this.reportStandalone('warn', '主剧本拥有多个角色端点，入站账号不改写任何地址 故事=%s 入站=%s 命中=%s', story.id, session.selfId, hit ? '是' : '否')
      return story
    }
    const newAccountKey = `onebot:${String(session.selfId).trim()}`
    for (const row of roleRows) {
      if (row.accountKey !== newAccountKey || row.selfId !== String(session.selfId) || row.platform !== session.platform) {
        await this.dbSet('interlude_endpoint', { id: row.id }, { accountKey: newAccountKey, selfId: String(session.selfId), platform: session.platform, updatedAt: now }).catch(() => undefined)
        Object.assign(row, { accountKey: newAccountKey, selfId: String(session.selfId), platform: session.platform })
      }
    }
    await this.dbSet('interlude_story', { id: story.id }, { platform: session.platform, selfId: session.selfId, updatedAt: now })
    this.reportStandalone('info', '主剧本投递账号已自愈 故事=%s 平台=%s 账号=%s', story.id, session.platform, session.selfId)
    return { ...story, platform: session.platform, selfId: session.selfId, updatedAt: now }
  }

  private async retryDbWrite<T>(task: () => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await task()
      } catch (error) {
        // sql.js/SQLite may briefly report disk I/O or locking errors while
        // Koishi flushes its in-memory database. A short retry is useful, but
        // logging every transient attempt as a warning makes normal file
        // flush contention look like a fatal HDSI failure. Keep the retry
        // bounded, add a little jitter, and only warn on the final failure.
        if (attempt >= 7 || !isTransientDatabaseError(error)) {
          if (isTransientDatabaseError(error)) {
            // 重试阶梯走完仍失败 = 数据层故障，升 error。
            this.reportStandalone('error', 'SQLite 写入连续失败，已停止重试 错误=%s', error)
          }
          throw error
        }
        const delays = [100, 250, 500, 1_000, 2_000, 3_000, 5_000]
        const baseDelay = delays[attempt] ?? 5_000
        const delay = baseDelay + Math.floor(Math.random() * Math.min(250, baseDelay / 4))
        this.reportStandaloneOperation('diagnostic', 'debug', 'SQLite 写入暂时失败，准备重试 等待=%dms 次数=%d 错误=%s', delay, attempt + 1, error)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  private dbCreate(table: string, data: unknown): Promise<any> {
    return this.dbWrite(async () => {
      try {
        return await (this.transactionScope.getStore() ?? this.ctx.database).create(table as never, data as never)
      } catch (error) {
        // sql.js can report disk I/O after SQLite has already committed an
        // INSERT. Before retrying, look for the same logical row; this keeps a
        // transient flush error from creating duplicate split-message intents,
        // script entries, or memories.
        if (!isTransientDatabaseError(error)) throw error
        const existing = await this.findPossiblyCommittedCreate(table, data)
        if (existing) return existing
        throw error
      }
    })
  }

  private async findPossiblyCommittedCreate(table: string, data: unknown) {
    if (!isRecord(data)) return undefined
    const storyId = typeof data.storyId === 'string' ? data.storyId : ''
    if (!storyId) return undefined
    const rows = await this.dbGet(table, { storyId }, { limit: 100 })
    return rows.find(row => {
      if (table === 'interlude_intent') {
        return row.participantId === data.participantId
          && row.type === data.type
          && row.summary === data.summary
          && sameTimestamp(row.notBefore, data.notBefore)
          && JSON.stringify(row.payload ?? {}) === JSON.stringify(data.payload ?? {})
      }
      if (table === 'interlude_script_entry') {
        return row.participantId === data.participantId
          && row.kind === data.kind
          && row.actor === data.actor
          && row.content === data.content
          && sameTimestamp(row.occurredAt, data.occurredAt)
      }
      if (table === 'interlude_memory') {
        return row.participantId === data.participantId
          && row.category === data.category
          && row.content === data.content
          && sameTimestamp(row.createdAt, data.createdAt)
      }
      return typeof data.id === 'string' && row.id === data.id
    })
  }

  private dbSet(table: string, query: unknown, data: unknown): Promise<any> {
    return this.dbWrite(() => (this.transactionScope.getStore() ?? this.ctx.database).set(table as never, query as never, data as never))
  }

  private dbRemove(table: string, query: unknown): Promise<any> {
    return this.dbWrite(() => (this.transactionScope.getStore() ?? this.ctx.database).remove(table as never, query as never))
  }

  /**
   * SQLite/sql.js may fail physical DELETE when its backing file is locked.
   * Fall back to redaction so an administrative purge still completes and the
   * removed content is no longer exposed to prompts or management commands.
   */
  private async purgeTable(table: string, query: unknown, fallback: unknown) {
    try {
      await this.dbRemove(table, query)
    } catch (error) {
      this.reportStandalone('warn', 'SQLite 物理删除失败，改用逻辑删除 表=%s 错误=%s', table, error)
      await this.dbSet(table, query, fallback)
    }
  }
}

function mergeForwardContent(existing: string, forward: string) {
  const base = String(existing ?? '')
    .replace(/<forward\b[^>]*\/?>(?:<\/forward>)?/gi, '')
    .replace(/\[CQ:forward,[^\]]*\]/gi, '')
    .trim()
  return base ? `${base}\n${forward}` : forward
}

function storyIdForCharacter(platform: string, selfId: string) { return `character:${platform}:${selfId}` }

function legacyStoryIdFor(platform: string, selfId: string, userId: string) { return `${platform}:${selfId}:${userId}` }

function participantIdFor(platform: string, selfId: string, userId: string) { return `${platform}:${selfId}:${userId}` }

function participantIdForStory(storyId: string, platform: string, selfId: string, userId: string) {
  return `${participantIdFor(platform, selfId, userId)}:${storyId}`.slice(0, 255)
}

/**
 * M2 §1.2：端点集合匹配——参与者名下任一启用 user 端点行命中即该参与者；
 * 注册表未命中时回落旧字段比对（单平台等价）。
 */
function sameParticipantEndpoint(participant: InterludeParticipant, session: Session) {
  const legacy = () => {
    const onebotPair = isOneBotPlatform(participant.platform) && isOneBotPlatform(session.platform)
    return (participant.platform === session.platform || onebotPair)
      && normalizeAccountId(participant.selfId) === normalizeAccountId(session.selfId)
      && normalizeAccountId(participant.userId) === normalizeAccountId(session.userId)
  }
  const service = activeServiceForEndpoints as any
  if (!service?.endpointRegistryReady) return legacy()
  const rows = (service.endpointRows as EndpointRow[]).filter(row =>
    row.ownerKind === 'participant-user' && row.ownerId === participant.id && row.enabled)
  if (!rows.length) return legacy()
  const sessionAccountKey = endpointAccountKey(session.platform, String(session.selfId ?? ''))
  const sessionUserId = normalizeAccountId(session.userId)
  return rows.some(row => row.accountKey === sessionAccountKey
    && normalizeAccountId(row.userId ?? '') === sessionUserId)
}

/** sameParticipantEndpoint 需要读注册表——由构造器绑定当前 service 实例。 */
let activeServiceForEndpoints: InterludeService | null = null

function isOneBotPlatform(platform: string | undefined) {
  const value = String(platform ?? '').toLowerCase()
  return value === 'onebot'
    || value.startsWith('onebot:')
    || value === 'napcat'
    || value.startsWith('napcat:')
    || value === 'qq:onebot'
    || value.startsWith('qq:onebot:')
}

/**
 * Resolve the adapter-facing channel id for a private delivery.
 *
 * OneBot's `sendMessage()` treats a bare numeric id as a group channel. The
 * incoming session already carries the correct private route, but delayed or
 * split deliveries often have no live session and therefore reach this helper.
 * Keep explicitly typed private ids intact and make the OneBot family use the
 * unambiguous `private:<userId>` form.
 */
function privateDeliveryChannelId(platform: string, userId: string | undefined, channelId: string | undefined) {
  const existing = String(channelId ?? '').trim()
  if (/^(?:private|user):/i.test(existing)) return existing

  const id = String(userId ?? '').trim()
  if (isOneBotPlatform(platform)) return id ? `private:${id}` : existing

  // A private delivery must never retain a group route accidentally. Native
  // adapters may use a different address scheme, so preserve their existing
  // non-group route and fall back to the user id only when necessary.
  if (/^(?:group|guild):/i.test(existing)) return id || existing
  return existing || id
}

/** OneBot 目标 ID 类型规则——纯数字串转 number（QQ 的 user_id/group_id
 * 规范类型），其余（wxid_xxx / @chatroom 等字符串 ID）原样传 string。此前
 * Number() 一刀切会把非数字 ID 变成 NaN 直发上游。 */
function onebotTargetId(channelId: string): string | number {
  const raw = String(channelId).replace(/^(?:private:|group:)/, '')
  return /^\d+$/.test(raw) ? Number(raw) : raw
}

/** 日志 QQ 号脱敏——5-12 位数字段保留尾 4 位（够关联排查），其余打码。
 * 只用于 summary 级（verbosity 关不掉）的入站消息行；standard/diagnostic 级
 * 的完整 ID 已有 verbosity 门控，保持原样。 */
function maskQqIds(value: unknown): string {
  return String(value ?? '').replace(/\d{5,12}/g, digits => '•'.repeat(Math.max(1, digits.length - 4)) + digits.slice(-4))
}

function extractSessionImageSources(session: Session) {
  const raw = String(session.content ?? '')
  const sources: string[] = []
  const add = (value: unknown, kind: 'url' | 'file' | 'adapter-url' = 'url') => {
    const source = String(value ?? '').trim()
    if (!source || sources.includes(source)) return
    if (source.length > 8 * 1024 * 1024) return
    if (/^https?:\/\//i.test(source)) sources.push(kind === 'adapter-url' ? `onebot-url:${source}` : source)
    else if (/^data:image\//i.test(source)) sources.push(source)
    else if (kind === 'file') sources.push(`onebot-file:${source}`)
  }
  const visit = (element: any) => {
    if (!element) return
    const type = String(element.type ?? '').toLowerCase()
    if (type === 'img' || type === 'image') {
      const src = element.attrs?.src ?? element.attrs?.url ?? element.data?.src ?? element.data?.url
      if (src) add(src)
      else add(element.attrs?.file ?? element.data?.file, 'file')
    }
    for (const child of element.children ?? []) visit(child)
  }
  // Session.elements is adapter-owned and can be reused or enriched by other
  // middleware. Parse this message's raw content only, otherwise an old image
  // element may be accidentally attached to a later text-only turn.
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  if (!sources.length) {
    const pattern = /<(?:img|image)\b[^>]*(?:src|url)=["']([^"']+)["'][^>]*>/gi
    for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) add(match[1])
  }
  // OneBot/NapCat may leave a CQ image segment in the raw message instead of
  // converting it to an HTML image element. Prefer its CDN URL; if only the
  // file token is present, keep that token so the current bot can call
  // get_image(file) without trusting arbitrary user URLs.
  const cqPattern = /\[CQ:image,([^\]]+)\]/gi
  for (let match = cqPattern.exec(raw); match; match = cqPattern.exec(raw)) {
    const fields: Record<string, string> = {}
    for (const part of match[1].split(',')) {
      const index = part.indexOf('=')
      if (index > 0) fields[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim()
    }
    add(fields.url || fields.cache_url, 'adapter-url')
    if (!fields.url && !fields.cache_url) add(fields.file, 'file')
  }
  return sources
}

/** Persist only bounded, reloadable image references for group history. Native
 * data URIs are intentionally excluded: durable script metadata must never carry
 * binary image payloads or turn-sized base64 strings. */
function groupImageRefsForStorage(sources: string[]) {
  return sources
    .map((source, ordinal) => {
      const value = String(source ?? '').trim()
      if (!value || /^data:image\//i.test(value) || value.length > 8 * 1024 * 1024) return undefined
      const sourceType = value.startsWith('onebot-file:') ? 'file' as const : 'url' as const
      const normalizedSource = sourceType === 'file' ? value.slice('onebot-file:'.length) : value
      if (!normalizedSource) return undefined
      return { source: value, ordinal, sourceType }
    })
    .filter((item): item is { source: string, ordinal: number, sourceType: 'url' | 'file' } => !!item)
}

/** Detect record/audio segments from both Koishi elements and raw OneBot CQ
 * fallback without retaining the binary voice payload. */
export function extractSessionVoiceCount(session: Pick<Session, 'content'>) {
  const raw = String(session.content ?? '')
  let count = 0
  const visit = (element: any) => {
    if (!element) return
    const type = String(element.type ?? '').toLowerCase()
    if (type === 'audio' || type === 'record') count++
    for (const child of element.children ?? []) visit(child)
  }
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  if (count) return count
  return (raw.match(/\[CQ:record,[^\]]*\]/gi) ?? []).length
}

/** Extract fetchable voice/audio tokens for the native-audio channel.
 * Unlike images, records prefer the OneBot file token: raw record URLs serve
 * SILK, which only SnowLuma's server-side transcode (get_record out_format)
 * can turn into a model-readable audio payload. */
export function extractSessionAudioSources(session: Session) {
  const raw = String(session.content ?? '')
  const sources: string[] = []
  const add = (value: unknown, kind: 'url' | 'file' = 'file') => {
    const source = String(value ?? '').trim()
    if (!source || sources.includes(source) || source.length > 512) return
    if (/^data:audio\//i.test(source)) { sources.push(source); return }
    // http(s) record URLs serve raw SILK and cannot be transcoded without the
    // OneBot file token, so they stay out of the native-audio channel.
    if (/^https?:\/\//i.test(source)) return
    if (kind === 'file') sources.push(`onebot-file:${source}`)
  }
  const visit = (element: any) => {
    if (!element) return
    const type = String(element.type ?? '').toLowerCase()
    if (type === 'audio' || type === 'record') {
      const attrs = { ...(element.attrs ?? {}), ...(element.data ?? {}) }
      add(attrs.file ?? attrs.url ?? attrs.src, attrs.file ? 'file' : 'url')
    }
    for (const child of element.children ?? []) visit(child)
  }
  // Parse this message's raw content only; Session.elements is adapter-owned
  // and can be reused by other middleware across turns.
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  if (!sources.length) {
    const pattern = /<(?:audio|record)\b[^>]*(?:file|src|url)=["']([^"']+)["'][^>]*>/gi
    for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) add(match[1])
  }
  // OneBot may leave a CQ record segment with only a file token (typical
  // NapCat/SnowLuma private voice) or an extra url field we cannot transcode.
  const cqPattern = /\[CQ:record,([^\]]+)\]/gi
  for (let match = cqPattern.exec(raw); match; match = cqPattern.exec(raw)) {
    const fields: Record<string, string> = {}
    for (const part of match[1].split(',')) {
      const index = part.indexOf('=')
      if (index > 0) fields[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim()
    }
    add(fields.file, 'file')
  }
  // QQ 音频文件走 <file> 元素（CDN 直链 + 文件名扩展），原始字节可直接
  // 作为 input_audio；与语音的 SILK 转码路径不同，标记 file-url 前缀。
  for (const fact of extractSessionFileFacts(session)) {
    if (!fact.audio || !/^https?:\/\//i.test(fact.url)) continue
    const encoded = `file-url:${fact.url}#${encodeURIComponent(fact.name || '')}:${fact.size}`
    if (!sources.includes(encoded)) sources.push(encoded)
  }
  return sources
}

export interface SessionFileFact { name: string, url: string, size: number, audio: boolean }

const AUDIO_FILE_EXTENSIONS = /\.(mp3|wav|ogg|m4a|flac|amr|aac|wma)$/i

/** Inbound `<file>` elements carry the QQ CDN URL, display name and size.
 * They are attachment facts: the raw markup must never reach the model as
 * text, and audio-named files feed the native-audio channel. */
export function extractSessionFileFacts(session: Session): SessionFileFact[] {
  const raw = String(session.content ?? '')
  const facts: SessionFileFact[] = []
  const push = (url: string, name: string, size: number) => {
    if ((!url && !name) || facts.length >= 3) return
    if (facts.some(item => item.url === url && item.name === name)) return
    facts.push({ name: name.slice(0, 200), url: url.slice(0, 1_000), size, audio: AUDIO_FILE_EXTENSIONS.test(name) })
  }
  const visit = (element: any) => {
    if (!element) return
    if (String(element.type ?? '').toLowerCase() === 'file') {
      const attrs = { ...(element.attrs ?? {}), ...(element.data ?? {}) }
      push(String(attrs.src ?? attrs.url ?? '').trim(), String(attrs.name ?? attrs.file ?? attrs.title ?? '').trim(), Number(attrs.size ?? attrs['file-size'] ?? 0) || 0)
    }
    for (const child of element.children ?? []) visit(child)
  }
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  if (!facts.length) {
    const pattern = /<file\b([^>]*)\/?>/gi
    for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
      const attrs = match[1]
      const pick = (key: string) => new RegExp(`${key}=["']([^"']*)["']`, 'i').exec(attrs)?.[1]?.trim() ?? ''
      push(pick('src') || pick('url'), pick('name') || pick('file') || pick('title'), Number(pick('size') || pick('file-size')) || 0)
    }
  }
  return facts
}

/** 群聊入站没有原生附件通道：把 <img>/<file>/<record> 等元素标记转成事实
 * 占位（保留"发过什么"的信息），URL 污水不进群上下文，也不再被模型复述。 */
export function describeGroupAttachments(content: unknown) {
  return normalizeQQNativeFaceSegments(String(content ?? ''))
    .replace(/<(?:record|audio)\b[^>]*\/?>/gi, '[语音]')
    .replace(/<(?:img|image)\b[^>]*\/?>/gi, '[图片]')
    .replace(/<video\b[^>]*\/?>/gi, '[视频]')
    .replace(/<file\b[^>]*\/?>/gi, (match) => {
      const name = /(?:name|file|title)=["']([^"']+)["']/i.exec(match)?.[1]
      return name ? `[文件：${name}]` : '[文件]'
    })
    .replace(/<\/(?:file|img|image|audio|record|video)>/gi, '')
    .replace(/\[CQ:image,[^\]]*\]/gi, '[图片]')
    .replace(/\[CQ:record,[^\]]*\]/gi, '[语音]')
    .replace(/\[CQ:video,[^\]]*\]/gi, '[视频]')
    .replace(/\[CQ:file,([^\]]*)\]/gi, (_match, attrs: string) => {
      const name = /(?:name|file)=([^,\]]+)/i.exec(attrs)?.[1]
      return name ? `[文件：${name}]` : '[文件]'
    })
}

/** 出站传输超时包装（rc50 issue 报告）：OneBot 实现不回应时把"永久挂起"
 * 变成有界等待，防止按故事串行的执行链被单次发送永久堵死。默认 30s 与
 * send_forward_msg 一致。与 withTimeout 的区别：超时错误带 `transport-timeout`
 * 标记与调用点标签——上层把它当作"结果未知"（账本记 pending 交由待投递
 * 补偿幂等收尾），而不是确定失败；迟到回执由 deliveryExecutionKey 去重。 */
export function withTransportTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 30_000): Promise<T> {
  return withTimeout(promise, timeoutMs).catch(error => {
    const isTimeout = (error as { timeout?: boolean })?.timeout === true
      || String(error?.message || error).includes('timeout after')
    if (isTimeout) {
      const wrapped = new Error(`transport-timeout:${label} (结果未知，等待补偿重试)`) as Error & { transportTimeout?: boolean }
      wrapped.transportTimeout = true
      throw wrapped
    }
    throw error
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

function guessImageMime(bytes: Buffer, hinted?: unknown) {
  const hint = String(hinted ?? '').toLowerCase()
  if (hint.startsWith('image/')) return hint
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a')) return 'image/gif'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return ''
}

/** Audio files arrive as original bytes (unlike SILK voice records). Accept
 * only formats the OpenAI-compatible input_audio channel documents. */
export function guessAudioFormat(bytes: Buffer, hintedName?: string) {
  const hinted = /\.(mp3|wav|ogg|m4a|flac|amr)\b/i.exec(String(hintedName ?? ''))?.[1]?.toLowerCase()
  if (hinted) return hinted
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav'
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg'
  if (bytes.length >= 8 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') return 'm4a'
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'fLaC') return 'flac'
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '#!AMR') return 'amr'
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3'
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3'
  return ''
}

function isAnimatedImageMime(mime: string) {
  return mime === 'image/gif' || mime === 'image/webp' || mime === 'image/apng'
}

function sessionGroupId(session: Session) {
  const raw = String((session as any).guildId || session.channelId || '')
  return normalizeGroupId(raw)
}

/** Historical group metadata used both prefixed IDs and numeric QQ IDs. */
function groupIdStorageVariants(value: string): Array<string | number> {
  const id = normalizeGroupId(value)
  const numeric = Number(id)
  return [...new Set<string | number>([value, id, `group:${id}`, `guild:${id}`,
    ...(id && Number.isFinite(numeric) ? [numeric] : [])])]
}

function normalizeGroupId(value: string) {
  return String(value || '').trim().replace(/^(?:group|guild):/i, '')
}

const CHAT_REACTION_NAMES: ChatReactionName[] = ['like', 'smile', 'laugh', 'heart', 'surprised', 'sad', 'angry']

const QQ_REACTION_IDS: Record<ChatReactionName, string> = {
  like: '76', smile: '14', laugh: '182', heart: '66', surprised: '0', sad: '5', angry: '106',
}

const NATIVE_FACE_SEMANTICS: NativeFaceSemantic[] = ['smile', 'laugh', 'sweat', 'awkward', 'heart', 'surprised', 'sad', 'angry']
const QQ_NATIVE_FACE_IDS: Record<NativeFaceSemantic, string> = {
  smile: '14', laugh: '182', sweat: '27', awkward: '111', heart: '66', surprised: '0', sad: '5', angry: '106',
}

function normalizeAllowedNativeFaces(value: unknown): NativeFaceSemantic[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is NativeFaceSemantic => NATIVE_FACE_SEMANTICS.includes(item as NativeFaceSemantic)))).slice(0, NATIVE_FACE_SEMANTICS.length)
}

function normalizeExpressionThreshold(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.7
}

/**
 * A model's willingness is an intent estimate, not a transport permission.
 * Native faces need a visible-text counterpart so a model cannot turn every
 * routine reply into a face merely by returning willingness=1. The 0.90 cap
 * deliberately makes thresholds above 0.90 an effective near-disable mode.
 */
export function calibratedNativeFaceWillingness(semantic: NativeFaceSemantic, willingness: unknown, replyContent: unknown) {
  const text = String(replyContent ?? '').replace(/<sep\/>/g, ' ').trim()
  if (!text) return 0
  const patterns: Record<NativeFaceSemantic, RegExp> = {
    smile: /(?:微笑|开心|高兴|谢谢|好耶|好呀|可以|行吧|嘿|哈哈)/i,
    laugh: /(?:哈{2,}|笑死|好笑|乐|绷不住|蚌埠|草|救命)/i,
    sweat: /(?:流汗|尴尬|无语|服了|麻了|救命|离谱|完了|累|忙|不知道怎么说)/i,
    awkward: /(?:尴尬|那个|呃|emm|……|\.{3,}|我真的|怎么说呢)/i,
    heart: /(?:喜欢|爱你|抱抱|可爱|谢谢|好耶|开心|高兴)/i,
    surprised: /(?:不会吧|真的假的|居然|什么|怎么会|\?{1,}|？{1,}|!{1,}|！{1,})/i,
    sad: /(?:难过|哭|委屈|可怜|遗憾|心疼|唉)/i,
    angry: /(?:生气|气死|烦|闭嘴|别[再乱闹说]|离谱|过分|你.*(?:啊|吧|？|!|！))/i,
  }
  const semanticMatch = patterns[semantic].test(text)
  const evidence = semanticMatch ? 0.9 : 0.2
  return Math.min(0.9, normalizeExpressionThreshold(willingness) * (0.25 + evidence * 0.75))
}

function targetableMessageId(value: unknown) {
  const id = String(value ?? '').trim()
  return /^-?\d+$/.test(id) && id !== '0' ? id : undefined
}

function groupMessageRef(entryId: number) {
  return `msg-${Math.max(0, Math.floor(entryId))}`
}

async function listStickerFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 3) return
    let entries: Awaited<ReturnType<typeof readdir>>
    try { entries = await readdir(directory, { withFileTypes: true }) as any } catch { return }
    for (const entry of entries as any[]) {
      const full = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(full, depth + 1)
      else if (entry.isFile() && /\.(?:png|jpe?g|webp|gif)$/i.test(entry.name)) files.push(full)
    }
  }
  await visit(root, 0)
  return files.sort()
}

function stickerMime(filePath: string) {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return 'image/png'
}

/** The old punctuation-only id could collide (for example two filenames that
 * both normalize to bq--6-). Keep a readable path prefix, then append a
 * content hash fragment so every row is globally unique and stable for an
 * unchanged file. */
export function stableStickerAssetId(filePath: string, hash: string) {
  const stem = String(filePath ?? '')
    .replace(/\\/g, '/')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
    .slice(0, 220) || 'sticker'
  // 后缀 = 路径+内容的联合哈希。仅用内容哈希时，中文路径被折叠成 '-' 后
  // stem 常退化为 'sticker'——两个分组存同一张图即同 assetId，扫描每轮在
  // UNIQUE 约束上崩掉（用户日志 8 连复现）。联合哈希让路径差异必然分叉。
  const suffix = createHash('sha1').update(`${filePath}\n${hash}`).digest('hex').slice(0, 16)
  return `${stem}-${suffix}`.slice(0, 255)
}

/** 表情包投递 URL：Koishi HTTP 路由 + assetId（OneBot 实现回源下载） */
export function stickerDeliveryUrl(base: string, assetId: string) {
  const root = String(base || '').trim().replace(/\/$/, '')
  return `${root || 'http://127.0.0.1:5140'}/hds-interlude/sticker/${encodeURIComponent(assetId)}`
}

/** 表情包本地文件 URI：file:/// + 正斜杠绝对路径（Linux 与 Windows 盘符
 * 两种形态都产出三斜杠标准形；SnowLuma/NapCat 的图片段按 file:// 与
 * 含分隔符的本地路径解析，见 SnowLuma element-codecs 的 file 优先规则）。 */
export function stickerFileUrl(absolutePath: string) {
  const normalized = String(absolutePath ?? '').replace(/[\\]/g, '/').replace(/^\/+/, '')
  return `file:///${normalized}`
}

/** Extract only explicit clock statements from a live user message. This is a
 * small factual aid, not an attempt to infer every temporal expression. */
export function extractUserReportedTimes(content: string, now: Date, timezone: string): UserReportedTime[] {
  const text = String(content ?? '')
  const currentMinutes = localClockMinutes(now, timezone)
  const date = calendarDayKey(now, timezone)
  const facts: UserReportedTime[] = []
  const seen = new Set<string>()
  const add = (hour: number, minute: number, statement: string) => {
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return
    const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    const relation: UserReportedTime['relation'] = hour * 60 + minute < currentMinutes ? 'past'
      : hour * 60 + minute > currentMinutes ? 'future' : 'current'
    const key = `${clock}:${statement}`
    if (seen.has(key)) return
    seen.add(key)
    facts.push({ localTime: `${date} ${clock}`, relation, statement: clip(statement, 240).trim() })
  }
  for (const match of text.matchAll(/(?:今天|今晚|下午|晚上|早上|上午)?\s*(\d{1,2})\s*(?:[:：.]|点)\s*(\d{2}|半)?/g)) {
    let hour = Number(match[1])
    const minute = match[2] === '半' ? 30 : match[2] ? Number(match[2]) : 0
    const prefix = match[0]
    if ((prefix.includes('下午') || prefix.includes('晚上')) && hour < 12) hour += 12
    else if (!/(?:早上|上午|下午|晚上|中午)/.test(prefix) && hour > 0 && hour < 12) {
      // Bare “6.30” is ambiguous. Prefer the 12-hour interpretation nearest
      // to the current story clock, so an evening report normally means 18:30
      // rather than an implausibly distant 06:30.
      const morning = hour * 60 + minute
      const evening = (hour + 12) * 60 + minute
      if (Math.abs(evening - currentMinutes) < Math.abs(morning - currentMinutes)) hour += 12
    }
    add(hour, minute, text.slice(Math.max(0, match.index! - 48), Math.min(text.length, match.index! + match[0].length + 96)))
  }
  // 时段词（中午/下午/晚上等）作为该时段代表性的钟点锚点，供守卫与 prompt
  // 理解“中午一起吃饭”这类不含数字的时间约定。
  for (const match of text.matchAll(/(早上|上午|中午|下午|傍晚|晚上)/g)) {
    const hour = ({ 早上: 8, 上午: 9, 中午: 12, 下午: 15, 傍晚: 18, 晚上: 20 } as Record<string, number>)[match[1]]
    add(hour, 0, text.slice(Math.max(0, match.index! - 48), Math.min(text.length, match.index! + match[0].length + 96)))
  }
    // 中文数字钟点（“八点”“八点半”“九点一刻”）：口语消息最常用的写法，此前
  // 只有守卫的正则认识它们，prompt 侧的 userReportedTimes 反而漏掉。
  for (const match of text.matchAll(/([零一二三四五六七八九十两]+)点(?:(?:零|([一二三四五六七八九十两]+))分?|(半))?/g)) {
    const hour = chineseClockNumber(match[1])
    const minute = match[3] === '半' ? 30 : match[2] ? chineseClockNumber(match[2]) : 0
    if (hour == null || minute == null) continue
    add(hour, minute, text.slice(Math.max(0, match.index! - 48), Math.min(text.length, match.index! + match[0].length + 96)))
  }
  return facts.slice(0, 4)
}

export function describeQuotedMessage(session: Session, characterName = '主角'): QuotedMessageContext | undefined {
  const quote = session.quote as any
  if (!quote) return undefined
  const content = normalizeQuotedMessageContent(quote.content)
  if (!content) return undefined
  const senderId = String(quote.user?.id ?? '').trim()
  const isCharacter = !!senderId && senderId === String(session.selfId ?? '')
  const senderName = isCharacter
    ? String(characterName || '主角').trim() || '主角'
    : normalizeGroupDisplayName(quote.member?.nick, quote.member?.name, quote.user?.nick, quote.user?.name, senderId) || '未知发送者'
  const speaker = isCharacter
    ? `主角「${senderName}」`
    : senderId
      ? `消息发送者「${senderName}」（ID：${senderId}）`
      : `消息发送者「${senderName}」`
  return { senderId, senderName, speaker, content }
}

export function normalizeQuotedMessageContent(value: unknown) {
  const raw = normalizeQQNativeFaceSegments(value)
  const content = raw
    .replace(/<(?:img|image)\b[^>]*\/?>(?:<\/(?:img|image)>)?/gi, '[图片]')
    .replace(/<(?:audio|record)\b[^>]*\/?>(?:<\/(?:audio|record)>)?/gi, '[语音]')
    .replace(/<video\b[^>]*\/?>(?:<\/video>)?/gi, '[视频]')
    .replace(/<(?:face|mface)\b[^>]*\/?>(?:<\/(?:face|mface)>)?/gi, '[表情]')
    .replace(/<at\b[^>]*(?:name|id)=["']?([^\s"'>]+)[^>]*\/?>(?:<\/at>)?/gi, '[@$1]')
    .replace(/\[CQ:image,[^\]]*\]/gi, '[图片]')
    .replace(/\[CQ:record,[^\]]*\]/gi, '[语音]')
    .replace(/\[CQ:video,[^\]]*\]/gi, '[视频]')
    .replace(/\[CQ:face,[^\]]*\]/gi, '[表情]')
    .replace(/<[^>]+>/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return clip(content, 1_500)
}

function normalizeQuotedMessageContext(value: unknown): QuotedMessageContext | undefined {
  if (!isRecord(value)) return undefined
  const content = normalizeQuotedMessageContent(value.content)
  if (!content) return undefined
  const senderId = clip(String(value.senderId ?? ''), 127)
  const senderName = clip(String(value.senderName ?? ''), 255) || '未知发送者'
  const speaker = clip(String(value.speaker ?? ''), 500) || (senderId ? `消息发送者「${senderName}」（ID：${senderId}）` : `消息发送者「${senderName}」`)
  return { senderId, senderName, speaker, content }
}

export function normalizeAllowedReactions(value: unknown): ChatReactionName[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is ChatReactionName => CHAT_REACTION_NAMES.includes(item as ChatReactionName)))).slice(0, CHAT_REACTION_NAMES.length)
}

/** Lenient kind mapping: models frequently answer with near-miss labels
 * ("scene", "event", Chinese labels); coerce the obvious ones instead of
 * discarding the whole beat. Unknown kinds fall back to "activity". */
const TIMELINE_KIND_ALIASES: Record<string, TimelinePlan['beats'][number]['kind']> = {
  activity: 'activity', action: 'activity', event: 'activity', scene: 'activity', behavior: 'activity',
  thought: 'thought', think: 'thought', feeling: 'thought', mood: 'thought', inner: 'thought',
  state: 'state', status: 'state', condition: 'state',
  活动: 'activity', 行动: 'activity', 事件: 'activity', 场景: 'activity',
  想法: 'thought', 心情: 'thought', 思绪: 'thought',
  状态: 'state',
}

function coerceTimelineKind(value: unknown): TimelinePlan['beats'][number]['kind'] | '' {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().toLowerCase()
  return TIMELINE_KIND_ALIASES[normalized] ?? 'activity'
}

function coerceTimelinePosition(value: unknown): number {
  // Accept numeric strings ("0.5") and percentage strings ("50%") before
  // falling back to NaN so one sloppy field doesn't discard the whole beat.
  if (typeof value === 'number') return Math.max(0, Math.min(1, value))
  if (typeof value === 'string') {
    const text = value.trim().replace(/%$/, '')
    const parsed = Number(text)
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed <= 1 ? parsed : parsed / 100))
  }
  return Number.NaN
}

/** Parse only the narrow event ledger shape. Unknown model fields and empty
 * plans are discarded before they can become a source of world state. */
export function normalizeTimelinePlan(value: unknown): TimelinePlan | undefined {
  if (!isRecord(value) || !Array.isArray(value.beats)) return undefined
  const beats = value.beats
    .filter(isRecord)
    .map(item => ({
      at: coerceTimelinePosition(item.at),
      kind: coerceTimelineKind(item.kind),
      summary: typeof item.summary === 'string' ? clip(item.summary, 240).trim() : '',
    }))
    .filter((item): item is TimelinePlan['beats'][number] => Number.isFinite(item.at) && !!item.kind && !!item.summary)
    .sort((left, right) => left.at - right.at)
    .slice(0, 4)
  if (!beats.length) return undefined
  const carry = Array.isArray(value.carry)
    ? value.carry.filter(item => typeof item === 'string').map(item => clip(item, 180).trim()).filter(Boolean).slice(0, 4)
    : []
  return { beats, ...(carry.length ? { carry } : {}) }
}

/** Human-readable diff of why a model plan was rejected, for the warn log. */
export function describeTimelinePlanRejection(value: unknown): string {
  if (!isRecord(value)) return '返回不是 JSON 对象'
  if (!Array.isArray(value.beats)) return '缺少 beats 数组'
  if (!value.beats.length) return 'beats 为空数组（模型未产出任何节点）'
  const details = value.beats.filter(isRecord).map(item => {
    const problems: string[] = []
    const at = coerceTimelinePosition(item.at)
    if (!Number.isFinite(at)) problems.push(`at=${JSON.stringify(item.at)} 无法解析`)
    if (!coerceTimelineKind(item.kind)) problems.push(`kind=${JSON.stringify(item.kind)} 非法`)
    if (typeof item.summary !== 'string' || !item.summary.trim()) problems.push('summary 为空')
    return problems.join('，') || '通过'
  })
  return `节点校验详情：${details.join('；')}`
}

/** Automatic script prose is a rendering, not the next turn's temporal source.
 * A compact host ledger retains the real sequence without letting a previous
 * paragraph be copied into a new time window. */
export function timelineEntryPromptProjection(entry: ScriptEntry): ScriptEntry {
  if (entry.metadata?.narrativeAuthority === 'original-v2') return entry
  if (entry.kind !== 'script') return entry
  const plan = normalizeTimelinePlan(entry.metadata?.timelinePlan)
  if (!plan) return entry
  const beats = plan.beats.map(beat => `${Math.round(beat.at * 100)}% ${beat.kind}: ${beat.summary}`).join(' | ')
  const carry = plan.carry?.length ? ` Carry: ${plan.carry.join(' | ')}` : ''
  return { ...entry, content: `[Host timeline ledger for this completed automatic window: ${beats}.${carry}]` }
}

export function normalizeGroupChatActions(
  decision: NarrativeDecision,
  capabilities: ChatActionCapabilities | undefined,
  context: GroupContext,
): ExecutableGroupChatActions {
  if (!capabilities) return { reactions: [] }
  const targets = new Map(context.messages
    .filter(message => !!message.messageRef && !!message.messageId)
    .map(message => [message.messageRef!, message.messageId!]))

  const rawReplyTo = decision.groupReply?.mode === 'immediate'
    ? decision.groupReply.replyTo
    : decision.interaction?.reply?.mode === 'immediate'
      ? decision.interaction.reply.replyTo
      : undefined
  const replyMessageId = capabilities.quoteReply && typeof rawReplyTo === 'string' ? targets.get(rawReplyTo) : undefined
  const replyTo = replyMessageId ? { messageRef: rawReplyTo!, messageId: replyMessageId } : undefined

  const allowed = new Set(capabilities.reactions)
  const reactions = Array.isArray(decision.messageReactions)
    ? decision.messageReactions
      .filter(item => isRecord(item) && typeof item.messageRef === 'string' && typeof item.reaction === 'string')
      .map(item => ({
        messageRef: String(item.messageRef),
        reaction: String(item.reaction) as ChatReactionName,
        messageId: targets.get(String(item.messageRef)) ?? '',
      }))
      .filter(item => !!item.messageId && allowed.has(item.reaction))
      .slice(0, 1)
    : []
  return { ...(replyTo ? { replyTo } : {}), reactions }
}

export function formatGroupSpeaker(senderName: string, senderId: string) {
  const id = String(senderId || 'unknown').trim() || 'unknown'
  const name = String(senderName || '').replace(/[\r\n]/g, ' ').trim() || id
  return name === id ? `群成员（QQ：${id}）` : `群成员「${name}」（QQ：${id}）`
}

function normalizeGroupDisplayName(...candidates: unknown[]) {
  for (const candidate of candidates) {
    const name = String(candidate ?? '').replace(/[\r\n]/g, ' ').trim()
    if (name) return name.slice(0, 80)
  }
  return ''
}

function mentionsBot(session: Session) {
  const selfId = normalizeAccountId(session.selfId)
  const content = String(session.content || '')
  if (!selfId) return false
  return content.includes(selfId) || new RegExp(`<at[^>]+id=["']?${selfId}["']?`, 'i').test(content)
}

export function normalizeGroupVisibleReply(raw: NarrativeDecision['groupReply'], interaction: NarrativeDecision['interaction'], maxCharacters: number, separator = '<sep/>', splitEnabled = true) {
  const content = normalizeGroupReply(raw, maxCharacters, separator) || normalizeGroupInteractionReply(interaction, maxCharacters, separator)
  // 此处只把空行（段落边界）转换为分隔符，单个换行留在一条消息内；拆条关闭
  // 时不做转换。注意：convertNewlineToSeparator 开启后，发送层
  // （splitVisibleReplyBubbles）会把单个换行也视为气泡边界——群内容无分隔符
  // 且无空行时按单换行拆条，属该开关的预期小模型语义。
  if (!splitEnabled || !content) return content
  const canonical = separator?.trim() || '<sep/>'
  return content.includes(canonical) ? content : content.replace(/\s*\r?\n\s*\r?\n+/g, canonical)
}

/** 无 participant 回合的 interaction 容错：群聊回合（user-message 且无 participant）
 * 把 immediate 的 interaction 回复提升为 groupReply 参与提交与投递——简洁协议把
 * interaction 形态写在最前，弱模型常在群聊照抄私聊形态。不提升时 commit-builder
 * 会为无 participant 的 interaction 生成 outgoing-message 事件，结构校验失败导致
 * 整回合静默。其余无 participant 相位（advance 等）本无回复通道，携带内容的
 * interaction 一律剥离，同样避免校验失败。 */
export function hoistParticipantlessInteraction<T extends NarrativeDecision>(decision: T, phase: NarrativeRequest['phase']): T {
  const reply = decision.interaction?.reply
  if (!reply || reply.mode === 'none' || !reply.content?.trim()) return decision
  if (reply.mode === 'immediate' && phase === 'user-message' && !hasStructuredGroupReplyField(decision.groupReply)) {
    return {
      ...decision,
      groupReply: { mode: 'immediate', content: reply.content, ...(reply.replyTo ? { replyTo: reply.replyTo } : {}) },
      interaction: undefined,
    }
  }
  return { ...decision, interaction: undefined }
}

export function requiresVisibleReplyRecovery(phase: NarrativeRequest['phase'], groupContext: GroupContext | undefined, decision: NarrativeDecision) {
  if (phase !== 'user-message') return false
  if (groupContext) return !hasStructuredGroupReply(decision)
  // 合法的"只发表情/动作不配文字"回合：interaction 为弱形态但携带任一动作
  // 字段时不属于回复缺失（placement:standalone 本就表示不配文字）。动作
  // 字段的嵌套形态已由 reconcileTransportReferences 提权到顶层。
  if (decision.localMedia || decision.nativeFace || decision.messageReactions?.length) return false
  // mode=none+actionId 的弱模型矛盾形态不在此处理：能锚定 say 行动的由
  // reconcileTransportReferences 就地救援为 immediate，锚不定的按合法沉默放行
  // （重写无法改变模型的稳定输出习惯，只会把"静默不发"恶化成"整回合失败"）。
  return !hasStructuredInteraction(decision.interaction)
}

export function visibleReplyMode(decision: NarrativeDecision, phase: NarrativeRequest['phase'], groupContext?: GroupContext) {
  if (phase === 'advance') {
    if (decision.crossConversationActions?.some(action => action.mode === 'immediate')) return '主动联系'
    if (decision.crossConversationActions?.some(action => action.mode === 'delayed')) return '计划联系'
    return '无可见投递'
  }
  if (phase === 'conversation-follow-up' || phase === 'intent-due') {
    if (hasStructuredInteraction(decision.interaction)) return decision.interaction!.reply.mode
    if (decision.crossConversationActions?.some(action => action.mode === 'immediate')) return '主动联系'
    return '无可见投递'
  }
  if (!groupContext) return hasStructuredInteraction(decision.interaction) ? decision.interaction!.reply.mode : '未提供或无效'
  if (hasStructuredGroupReplyField(decision.groupReply)) return `group:${decision.groupReply!.mode}`
  if (hasStructuredInteraction(decision.interaction)) return `group-fallback:${decision.interaction!.reply.mode}`
  return '未提供或无效'
}

function hasStructuredGroupReply(decision: NarrativeDecision) {
  return hasStructuredGroupReplyField(decision.groupReply) || hasStructuredInteraction(decision.interaction)
}

function hasStructuredGroupReplyField(value: unknown) {
  if (!isRecord(value) || (value.mode !== 'none' && value.mode !== 'immediate')) return false
  return value.mode === 'none' || typeof value.content === 'string' && !!value.content.trim()
}

function hasStructuredInteraction(value: unknown) {
  if (!isRecord(value) || typeof value.seen !== 'boolean' || !isRecord(value.reply)) return false
  const mode = value.reply.mode
  if (mode !== 'none' && mode !== 'immediate' && mode !== 'delayed') return false
  if (mode === 'none') return true
  if (typeof value.reply.content !== 'string' || !value.reply.content.trim()) return false
  return mode === 'immediate' || typeof value.reply.sendAt === 'string' && !!value.reply.sendAt.trim()
}

/** Compact JSON for diagnostic logs: never throws, bounded length. */
function safeJsonPreview(value: unknown) {
  try {
    const text = value === undefined ? 'undefined' : JSON.stringify(value)
    return String(text).slice(0, 300)
  } catch {
    return '(unserializable)'
  }
}

function normalizeGroupReply(raw: NarrativeDecision['groupReply'], maxCharacters: number, separator = '<sep/>') {
  if (!raw || raw.mode !== 'immediate') return ''
  return sanitizeAndClampVisibleContent(raw.content, maxCharacters, separator)
}

function normalizeGroupInteractionReply(raw: NarrativeDecision['interaction'], maxCharacters: number, separator = '<sep/>') {
  if (!raw || !raw.reply || raw.reply.mode !== 'immediate') return ''
  return sanitizeAndClampVisibleContent(raw.reply.content, maxCharacters, separator)
}

export function sanitizeAndClampVisibleContent(value: unknown, maxCharacters: number, separator = '<sep/>') {
  return String(value ?? '')
    // Providers occasionally drop the slash or emit full-width brackets while
    // copying the contract. Normalize only structured visible replies; script
    // prose and incoming user text remain untouched.
    .replace(/[<＜]\s*sep\s*\/?\s*[>＞]/gi, separator.trim() || '<sep/>')
    // 引号层级提升：模型剧本的嵌套引号 ‘...’ 在外层 “...” 剥掉后应升为
    // “...”——投递的消息自身已是第一层，内层引号用双引号才是中文规范。
    // 只处理成对的中文弯单引号；ASCII '...' (英文缩写) 和不成对的 ‘’ 不动。
    .replace(/‘([^’]+)’/g, '“$1”')
    // 模型可能复述入站消息里的附件标记（如 <file src="…qqdownload…">）。
    // 可见回复是纯文本合约：标记一旦漏出会被适配器解析成真实附件发出去。
    .replace(/<\/?(?:file|img|image|audio|record|video|flash|mface)\b[^>]*\/?>/gi, '')
    .replace(/\[CQ:(?:file|image|record|video|flash|mface),[^\]]*\]/gi, '')
    .replace(/[\[【](?:表情包?|图片|动图|GIF)[\]】]/gi, '')
    .replace(/[\[【](?:流汗|微笑|笑哭|尴尬|爱心|惊讶|流泪|委屈)[\]】]/gi, '')
    .trim()
    .slice(0, Math.max(1, maxCharacters))
}

/** 可见回复的气泡拆分（纯函数，可单测）。
 * 小模型适配开关：模型没有按合约输出 <sep/> 而是用换行分条时，把换行运行
 * （含单个换行与 CRLF）视作气泡边界。仅在内容不含显式分隔符时转换——
 * 模型自己写了 <sep/> 就尊重原样；群路径的空行转换（normalizeGroupVisibleReply）
 * 发生在更早阶段且已含分隔符，同样不会被二次改写。 */
export function splitVisibleReplyBubbles(content: string, options: { separator?: string, splitEnabled: boolean, newlineAsSeparator?: boolean }): string[] {
  if (!options.splitEnabled) return [content]
  const separator = options.separator?.trim() || '<sep/>'
  if (!separator) return [content]
  let normalized = content
  if (options.newlineAsSeparator && !normalized.includes(separator) && /\r?\n/.test(normalized)) {
    normalized = normalized.replace(/\r?\n+/g, separator)
  }
  if (!normalized.includes(separator)) return [content]
  const parts = normalized.split(separator).map(part => part.trim()).filter(Boolean)
  // 全部分隔出空段（如内容本身只有换行）时保留原文形态，不产生空投递列表。
  return parts.length ? parts : [content]
}

function literalQuoteText(value: unknown) {
  const match = /^\s*[「\[]引用[:：]\s*(.*?)\s*[」\]]\s*$/.exec(String(value ?? ''))
  return match?.[1]?.trim() || ''
}

function isLiteralQuoteOnly(value: unknown) {
  return !!literalQuoteText(value)
}

/** Treat OneBot transport aliases as one administrator-facing platform family. */
function samePlatformFamily(left: string | undefined, right: string | undefined) {
  if (isOneBotPlatform(left) && isOneBotPlatform(right)) return true
  return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase()
}

/** Normalize transport-qualified QQ ids such as private:123 or onebot:123. */
function normalizeAccountId(value: unknown) {
  let normalized = String(value ?? '').trim().toLowerCase()
  for (let index = 0; index < 3; index++) {
    const next = normalized.replace(/^(?:private|user|onebot|napcat|qq):/i, '').trim()
    if (next === normalized) break
    normalized = next
  }
  return normalized
}

/** 剧本历史注入预算（纯函数，可单测）。
 * M4.1 曾在此处叠加 Math.max(35, …) 硬地板保护连续性——副作用是 Console 里
 * 调小 contextEntryLimit 完全失效，小模型无法收缩上下文。现在尊重用户设置：
 * 条数默认 35（schema 默认），需要更小历史的部署（小模型）可显式调小，
 * 并配合把 contextTimeWindowMinutes 调小或设 0（时间窗会把近窗口内的全部
 * 条目并入，即使超过条数）。 */
export function resolveScriptContextBudget(runtime: Pick<RuntimeConfig, 'contextEntryLimit' | 'contextTimeWindowMinutes'>): { count: number, minutes: number } {
  return {
    count: Math.max(1, Math.min(Math.floor(runtime.contextEntryLimit ?? 35), 200)),
    minutes: Math.max(0, Math.min(Math.floor(runtime.contextTimeWindowMinutes ?? 45), 1_440)),
  }
}

export interface ManageSessionDenial {
  /** onebot = 互动白名单拒绝；managers = managerAccounts 不匹配。两层配置不同，指引不同。 */
  layer: 'onebot' | 'managers'
  /** 供命令回复、doctor 与日志共用的完整原因（含可操作指引）。 */
  detail: string
}

/** 管理权限判定的纯函数核心（可单测）。返回 undefined = 允许。
 * 此前两层失败共用一句"需要 HDSI 管理员权限"，用户给了管理员仍被拒时
 * 排障方向完全被带偏；实际原因必须在消息与默认日志里直接可读。 */
export function manageSessionDenialReason(input: {
  platform?: string
  selfId?: string
  userId?: string
  onebot?: { enabled?: boolean, ignoreSelfMessages?: boolean, botAccounts?: OneBotAccountRule[], userAccounts?: OneBotAccountRule[] }
  managers?: string[]
}): ManageSessionDenial | undefined {
  if (isOneBotPlatform(input.platform)) {
    const config = input.onebot
    if (config?.enabled) {
      const selfId = normalizeAccountId(input.selfId)
      const userId = normalizeAccountId(input.userId)
      if (config.ignoreSelfMessages && selfId && selfId === userId) {
        return { layer: 'onebot', detail: '自消息被 onebot.ignoreSelfMessages 过滤，不计为管理操作。' }
      }
      if (!isEnabledAccount(config.botAccounts, selfId)) {
        return { layer: 'onebot', detail: `机器人账号 ${selfId || '(空)'} 不在 onebot.botAccounts 白名单（或未启用）——请在 Console 的“NapCat / OneBot QQ 账号控制”中添加并启用。` }
      }
      if (!isEnabledAccount(config.userAccounts, userId)) {
        return { layer: 'onebot', detail: `用户账号 ${userId || '(空)'} 不在 onebot.userAccounts 白名单（该开关启用后空白名单即全部拒绝）——请在 Console 的“NapCat / OneBot QQ 账号控制”中添加并启用。` }
      }
    }
  }
  const managers = (input.managers ?? []).map(value => String(value ?? '').trim()).filter(Boolean)
  if (managers.length && !managers.some(value => normalizeAccountId(value) === normalizeAccountId(input.userId))) {
    const platformNote = isOneBotPlatform(input.platform)
      ? ''
      : '（注意：当前来自非 OneBot 环境，账号不是 QQ 号——请用 QQ 私聊执行管理命令，或把该环境账号加入列表）'
    return {
      layer: 'managers',
      detail: `当前账号 ${normalizeAccountId(input.userId) || '(空)'} 不在 sharedStory.managerAccounts（现有：${managers.join('、')}）中${platformNote}；留空该列表即允许所有已授权账号。`,
    }
  }
  return undefined
}

function signedNumber(value: number) {
  return `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(2)}`
}

function quotesBot(session: Session) {
  return String((session as any).quote?.user?.id ?? '') === String(session.selfId ?? '')
}

function isTransientDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /disk\s*i\/o|database is locked|busy|unable to open/i.test(message)
}

function isEnabledAccount(accounts: OneBotAccountRule[] | undefined, qq: string) {
  const normalized = normalizeAccountId(qq)
  if (!normalized) return false
  return (accounts ?? []).some(account => account.enabled !== false && normalizeAccountId(account.qq) === normalized)
}

/** 模型偶发把 script 输出成对象（{tag,content} / {entries:[…]}，形态模仿
 * recentScript 的载荷结构）。散文完整，做无损归一而非弃稿：对象直取散文键、
 * entries 按序拼接、顶层数组同法。归一发生在 no-usable-script 闸门之前
 * （decide() 返回链），normalizeDecision 内再兜一道。 */
export function normalizeScriptField(raw: unknown): string {
  if (typeof raw === 'string') return raw
  const proseOf = (entry: unknown): string => {
    const item = entry as Record<string, unknown> | null
    const text = typeof item?.text === 'string' ? item.text : typeof item?.content === 'string' ? item.content : ''
    return text.trim()
  }
  const joinEntries = (list: unknown[]): string => list.map(proseOf).filter(Boolean).join('\n')
  if (Array.isArray(raw)) return joinEntries(raw)
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  for (const key of ['content', 'text', 'prose', 'narration', 'body', 'script']) {
    if (typeof record[key] === 'string' && (record[key] as string).trim()) return record[key] as string
  }
  if (Array.isArray(record.entries)) return joinEntries(record.entries)
  return ''
}

export function hasRequiredNarrativeScript(value: NarrativeDecision | undefined | null) {
  return typeof value?.script === 'string' && value.script.trim().length > 0
}

export function resolveBlindModeConfig(value?: Partial<BlindModeConfig>): BlindModeConfig {
  return {
    enabled: value?.enabled === true,
    healthReportMinutes: Math.max(1, Math.min(1_440, Math.floor(value?.healthReportMinutes ?? 10))),
  }
}

function isAutomaticNarrativePhase(phase: NarrativeRequest['phase']) {
  return phase === 'advance' || phase === 'conversation-follow-up'
}

function normalizeAutomaticDeliverySummary(value: unknown) {
  return typeof value === 'string' ? clip(value, 240).trim() : ''
}

function normalizeFollowUpSummary(value: unknown) {
  return typeof value === 'string' ? clip(value, 360).trim().replace(/\s+/g, ' ').toLowerCase() : ''
}

const MAX_FOLLOW_UP_DEFERRED_CHECKS = 5

function followUpDeferredChecks(intent: NarrativeIntent) {
  const value = Number(intent.payload?.deferredChecks)
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function followUpDeadline(intent: NarrativeIntent) {
  return toDate(intent.payload?.expiresAt) ?? new Date(intent.createdAt.getTime() + 24 * Time.hour)
}

function followUpExpiresAt(value: unknown, now: Date) {
  const requested = toDate(value)
  const maximum = new Date(now.getTime() + 24 * Time.hour)
  if (!requested || requested <= now) return maximum
  return requested < maximum ? requested : maximum
}

function normalizeFollowUpCommitment(value: unknown, now: Date): FollowUpCommitmentDraft | undefined {
  if (!isRecord(value)) return undefined
  const kind = value.kind === 'thinking' || value.kind === 'checking' || value.kind === 'decision' || value.kind === 'emotional-settle'
    ? value.kind
    : undefined
  const summary = typeof value.summary === 'string' ? clip(value.summary, 360).trim() : ''
  const notBefore = toDate(value.notBefore)
  if (!kind || !summary || !notBefore || notBefore.getTime() - now.getTime() < 5 * Time.minute || notBefore.getTime() - now.getTime() > 12 * Time.hour) return undefined
  const sourceEntryIds = Array.isArray(value.sourceEntryIds)
    ? value.sourceEntryIds.filter(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0).slice(0, 4)
    : []
  const expiresAt = toDate(value.expiresAt)
  return {
    kind, summary, notBefore: notBefore.toISOString(),
    ...(expiresAt && expiresAt > notBefore ? { expiresAt: expiresAt.toISOString() } : {}),
    ...(sourceEntryIds.length ? { sourceEntryIds } : {}),
  }
}

function inferredFollowUpCommitment(content: string, now: Date): FollowUpCommitmentDraft {
  return {
    kind: 'thinking', summary: clip(`The character promised to return after thinking: ${content}`, 360),
    notBefore: new Date(now.getTime() + 20 * Time.minute).toISOString(),
  }
}

function interactionPromisesFollowUp(content: unknown) {
  if (typeof content !== 'string') return false
  return /我(?:先)?想想|我去(?:想想|看看|查查|确认)|晚点(?:回|说|告诉)|之后(?:回|说|告诉)|等我.{0,12}(?:回|说|告诉)|整理.{0,12}(?:回|说|告诉)/.test(content)
}

function normalizeFollowUpResolutions(value: unknown): FollowUpResolutionDraft[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item)
      && typeof item.id === 'number' && Number.isInteger(item.id) && item.id > 0
      && (item.outcome === 'fulfilled' || item.outcome === 'rescheduled' || item.outcome === 'cancelled'))
    .map(item => ({
      id: item.id as number,
      outcome: item.outcome as FollowUpResolutionDraft['outcome'],
      ...(typeof item.notBefore === 'string' ? { notBefore: item.notBefore } : {}),
    }))
    .slice(0, 2)
}

function automaticDeliveryFromPayload(value: unknown): OutgoingMessageDraft['automaticDelivery'] | undefined {
  const record = isRecord(value) && isRecord(value.automaticDelivery) ? value.automaticDelivery : undefined
  const summary = normalizeAutomaticDeliverySummary(record?.summary)
  const sourceEntryId = typeof record?.sourceEntryId === 'number' && Number.isSafeInteger(record.sourceEntryId)
    ? record.sourceEntryId
    : undefined
  return summary ? { summary, ...(sourceEntryId ? { sourceEntryId } : {}) } : undefined
}

function mergeDeliverySummary(left: string, right: string) {
  if (!left || left === right || left.includes(right)) return left || right
  if (right.includes(left)) return right
  return clip(`${left}；${right}`, 240)
}

/** Scene compaction may update a tiny roster only with explicit observed
 * evidence. This keeps named supporting cast available without treating them
 * as automatically present. */
export function normalizeScenePresenceDrafts(value: unknown, entries: ScriptEntry[], now = new Date()): ScenePresenceState[] {
  if (!Array.isArray(value)) return []
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const next: ScenePresenceState[] = []
  for (const item of value as ScenePresenceDraft[]) {
    if (!isRecord(item)) continue
    const name = typeof item.name === 'string' ? clip(item.name, 80).trim() : ''
    const status = item.status === 'present' || item.status === 'off-scene' || item.status === 'expected'
      ? item.status
      : undefined
    const basis = typeof item.basis === 'string' ? clip(item.basis, 300).trim() : ''
    const sourceEntryIds = Array.isArray(item.sourceEntryIds)
      ? item.sourceEntryIds.filter(id => typeof id === 'number' && byId.has(id)).slice(0, 8)
      : []
    const evidence = sourceEntryIds.map(id => byId.get(id)!).filter(entry => entry.content.includes(name))
    if (!name || !status || !basis || !evidence.length || !hasExplicitPresenceEvidence(status, evidence)) continue
    next.push({ name, status, basis, sourceEntryIds, updatedAt: now.toISOString() })
  }
  return normalizeScenePresenceState(next)
}

function hasExplicitPresenceEvidence(status: ScenePresenceState['status'], entries: ScriptEntry[]) {
  const text = entries.map(entry => entry.content).join('\n')
  if (status === 'off-scene') return /告别|道别|分别|先走|离开|离去|回家|回去了|独自|分开|告辞/.test(text)
  if (status === 'expected') return /约好|约在|等会|稍后|会来|准备来|约见/.test(text)
  return /一起|同行|身边|来到|抵达|进入|走进|拉着|坐在|站在|陪着/.test(text)
}

/** 归一化文本(去空白/标点)后判断群发内容是否与私聊回复重叠：
 * 完全包含或 Jaccard > 0.55 视为"回声"（模型把私聊回复照搬到群聊）。
 * 只对群目标做（私聊→私聊的 cross-action 不涉及隐私泄漏）。 */
function isGroupEchoOfPrivateReply(actionContent: string, replyContent: string | undefined): boolean {
  if (!replyContent?.trim() || !actionContent.trim()) return false
  const normalize = (s: string) => s.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()
  const a = normalize(actionContent), b = normalize(replyContent)
  if (!a || !b) return false
  // 最短长度守卫：短回复("嗯")归一化后 1-2 字,包含判定会误杀正常群发。
  const MIN_ECHO = 6
  if (a === b) return true
  if (b.length >= MIN_ECHO && a.includes(b)) return true
  if (a.length >= MIN_ECHO && b.includes(a)) return true
  const grams = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set }
  const ga = grams(a), gb = grams(b)
  if (!ga.size || !gb.size) return false
  let shared = 0
  for (const g of ga) if (gb.has(g)) shared++
  return shared / (ga.size + gb.size - shared) > 0.55
}

export function normalizeDecision(raw: NarrativeDecision, from: Date, now: Date, permitMessages: boolean, runtime: RuntimeConfig, shared: SharedStoryConfig, currentParticipantId: string, permittedParticipantIds: Set<string>, permittedGroupIds: Set<string>, phase: NarrativeRequest['phase'] = 'advance', memory?: MemoryConfig, refreshContinuity = false) {
  raw = reconcileTransportReferences(raw, false, runtime.messageSeparator)
  // script 形态归一兜底(rc50 issue 报告):decide() 返回链已先行归一,此处
  // 覆盖恢复路径等旁路输入(对象形态直接取散文,不再判空)。
  const script = normalizeScriptField(raw?.script).trim().slice(0, runtime.maxScriptCharacters)
  // The only channel for a private reply is interaction. Automatic life
  // passes have no live participant event, so they cannot emit it at all.
  const interaction = phase === 'advance' ? undefined : normalizeInteraction(raw?.interaction, now, runtime)
  // Optional memories are model suggestions, not a source of truth.  Never
  // let a model turn an invented online contact into durable retrieval data.
  const memories = Array.isArray(raw?.memories)
    ? raw.memories.filter(validMemory).map(memory => ({ ...memory, participantId: permittedOrGlobal(memory.participantId, currentParticipantId, permittedParticipantIds) }))
    : []
  const intents = Array.isArray(raw?.intents) ? raw.intents
    .filter(intent => !isRecord(intent) || intent.type !== 'follow-up-commitment')
    .filter(intent => validIntent(intent, from, now, memory))
    .map(intent => ({ ...intent, participantId: permittedOrGlobal(intent.participantId, currentParticipantId, permittedParticipantIds) }))
    .slice(0, 8)
    : []
  const intentUpdates = normalizeIntentUpdates(raw?.intentUpdates)
  const browserIntents = Array.isArray(raw?.browserIntents)
    ? raw.browserIntents.map(normalizeBrowserIntentDraftLoose).filter((intent): intent is BrowserIntentDraft => !!intent).slice(0, 1)
    : []
  const proactive = phase === 'advance'
  const agencyGatedProactive = proactive && !isRecord(raw?.proactiveContact)
  // 解析层意愿门的丢弃必须留痕：被丢的行动不会进入 crossConversationActions，
  // 也就没有事件与账本；不捕获就会留下"剧本已说但从未发出"的幻影。
  const droppedProactiveActions: NonNullable<NarrativeDecision['droppedProactiveActions']> = []
  const crossConversationActions = permitMessages && shared.allowCrossConversationMessages && Array.isArray(raw?.crossConversationActions)
    ? raw.crossConversationActions
      .map(action => {
        const normalized = normalizeConversationAction(action, runtime, permittedParticipantIds, permittedGroupIds, currentParticipantId, now, agencyGatedProactive)
        if (!normalized) {
          if (!agencyGatedProactive) return undefined
          const dropped = droppedProactiveActionInfo(action, runtime, permittedParticipantIds, currentParticipantId)
          if (dropped) droppedProactiveActions.push(dropped)
          return undefined
        }
        // 隐私回声闸：群目标的 cross-action 内容与 interaction.reply 重叠时丢弃
        // （模型把私聊回复逐字照搬到群聊——issue #3 的直接根因）。
        if (normalized.participantId.startsWith('group:')
          && interaction?.reply?.content
          && isGroupEchoOfPrivateReply(normalized.content, interaction.reply.content)) {
          droppedProactiveActions.push({ participantId: normalized.participantId, mode: 'immediate' as const, content: normalized.content, reason: 'group-echo-of-private-reply' })
          return undefined
        }
        return normalized
      })
      .filter((action): action is NonNullable<ReturnType<typeof normalizeConversationAction>> => !!action)
      .slice(0, Math.max(0, shared.maxCrossConversationActions))
    : []
  const statePatch = isRecord(raw?.statePatch) ? pickParticipantStatePatch(raw.statePatch) : undefined
  const continuity = refreshContinuity ? normalizeContinuitySnapshot(raw?.continuity) : undefined
  const alter = normalizeAlterValue(raw?.alter)
  const automaticDeliverySummary = isAutomaticNarrativePhase(phase)
    ? normalizeAutomaticDeliverySummary(raw?.automaticDeliverySummary) || undefined
    : undefined
  const followUpCommitment = phase === 'user-message' ? normalizeFollowUpCommitment(raw?.followUpCommitment, now) : undefined
  const followUpResolutions = phase === 'user-message' || phase === 'intent-due'
    ? normalizeFollowUpResolutions(raw?.followUpResolutions)
    : []
  const agencyWindow = isRecord(raw?.agencyWindow) ? raw.agencyWindow : undefined
  const proactiveContact = isRecord(raw?.proactiveContact) ? raw.proactiveContact : undefined
  return { script, authoredActions: raw.authoredActions, lifeHandoff: normalizeLifeHandoff(raw.lifeHandoff, script), alter, agencyWindow, proactiveContact, interaction, automaticDeliverySummary, followUpCommitment, followUpResolutions, continuity, memories, intents, intentUpdates, browserIntents, statePatch, crossConversationActions,
    ...(droppedProactiveActions.length ? { droppedProactiveActions } : {}) }
}

function normalizeBrowserIntentDraftLoose(value: unknown): BrowserIntentDraft | undefined {
  if (!isRecord(value) || (value.mode !== 'search' && value.mode !== 'visit') || typeof value.purpose !== 'string') return undefined
  const query = typeof value.query === 'string' ? clip(value.query, 500) : ''
  const url = typeof value.url === 'string' ? clip(value.url, 2_000) : ''
  if (value.mode === 'search' && !query) return undefined
  if (value.mode === 'visit' && !url) return undefined
  return {
    mode: value.mode,
    ...(query ? { query } : {}), ...(url ? { url } : {}),
    purpose: clip(value.purpose, 500),
    timing: value.timing === 'immediate' ? 'immediate' : 'deferred',
    ...(typeof value.participantId === 'string' ? { participantId: value.participantId.trim() } : {}),
  }
}

function normalizeBrowserIntentDraft(draft: BrowserIntentDraft, config: BrowserConfig): BrowserIntentDraft | undefined {
  const normalized = normalizeBrowserIntentDraftLoose(draft)
  if (!normalized) return undefined
  if (normalized.mode === 'search' && !config.allowSearch) return undefined
  if (normalized.mode === 'visit' && !config.allowVisit) return undefined
  return normalized
}

function browserIntentFromPayload(payload: Record<string, unknown>): BrowserIntentDraft | null {
  return normalizeBrowserIntentDraftLoose({
    mode: payload?.mode,
    query: payload?.query,
    url: payload?.url,
    purpose: payload?.purpose || 'The character planned to read a public web page.',
    timing: 'deferred',
  }) ?? null
}

function resolveBrowserTarget(draft: BrowserIntentDraft, config: BrowserConfig) {
  if (draft.mode === 'search') {
    const template = config.searchUrlTemplate?.trim()
    if (!template || !template.includes('{query}')) return undefined
    const target = template.replaceAll('{query}', encodeURIComponent(draft.query ?? ''))
    return isSafePublicWebUrl(target, config) ? target : undefined
  }
  return draft.url && isSafePublicWebUrl(draft.url, config) ? draft.url : undefined
}

function isSafePublicWebUrl(value: string, config: BrowserConfig) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    if (url.username || url.password) return false
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host === '::1') return false
    if (isPrivateHost(host)) return false
    const blocked = normalizeDomains(config.blockedDomains)
    const allowed = normalizeDomains(config.allowedDomains)
    if (blocked.some(domain => domainMatches(host, domain))) return false
    return !allowed.length || allowed.some(domain => domainMatches(host, domain))
  } catch {
    return false
  }
}

function normalizeDomains(values: string[] | undefined) {
  return (values ?? []).map(value => String(value ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')).filter(Boolean)
}

function domainMatches(host: string, domain: string) { return host === domain || host.endsWith(`.${domain}`) }

function isPrivateHost(host: string) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168
  }
  // Literal IPv6 and IPv4-mapped addresses are not needed for public-web
  // narration and are safest treated as local/private destinations.
  return host.includes(':')
}

function webObservationEntryContent(observation: WebObservation) {
  if (observation.status === 'success') {
    const source = observation.title || observation.url || 'a public web page'
    // The full bounded excerpt is supplied through webContext. Keeping it out
    // of the ordinary script stream avoids duplicating tokens and prevents
    // page text from being mistaken for a first-party narrative instruction.
    return `The character read a public web page: ${source}.`
  }
  return `The character's attempted web lookup did not complete: ${clip(observation.summary, 800)}`
}

export function normalizeInteraction(value: unknown, now: Date, runtime: RuntimeConfig): NarrativeInteraction | undefined {
  // DeepSeek V4.1 实测：偶发漏掉 seen 布尔——reply 本身有效时按已读处理，
  // 不得因缺一个信息性字段丢弃整条已发送回复（丢弃会直接变成"回复模式 none"）。
  if (!isRecord(value) || !isRecord(value.reply)) return undefined
  let mode: string | undefined = typeof value.reply.mode === 'string' ? value.reply.mode : undefined
  if (mode !== 'none' && mode !== 'immediate' && mode !== 'delayed') {
    // 弱模型常输出 mode:"text"/"send"/"reply" 或漏掉 mode——只要带了 content 就视为 immediate，
    // 不要丢弃整个剧本（原行为是 return undefined → 触发重写循环）。
    const hasContent = typeof value.reply.content === 'string' && value.reply.content.trim()
    if (hasContent && (mode === undefined || mode === 'text' || mode === 'send' || mode === 'reply' || mode === 'message')) mode = 'immediate'
    else if (mode === undefined && !hasContent) mode = 'none'
    else return undefined
  }
  const separator = runtime.messageSeparator?.trim() || '<sep/>'
  let content = typeof value.reply.content === 'string' ? sanitizeAndClampVisibleContent(value.reply.content, runtime.maxMessageCharacters, separator) : undefined
  // 弱模型常把气泡间隔写成换行而不是分隔符。只把空行（段落边界）视作气泡
  // 边界：单个换行留在一条消息内——否则任何两行草稿都会被机械拆成两条，
  // 把"恰好两段"固化成每回合的定式（实测 24/24 回合精确 2.0 段）。
  if (content && runtime.splitReplyMessages !== false && separator && !content.includes(separator)) {
    content = content.replace(/\s*\r?\n\s*\r?\n+/g, separator)
  }
  const sendAt = toDate(value.reply.sendAt)
  // seen 只描述是否读了新消息；reply 是独立的发送通道。跟进/到期回合协议
  // 规定 seen=false，若在此处因 seen 抹掉回复，“稍后读到再回”的自救路径
  // 会被无声斩断（模型写进了剧本的发送与投递现实分裂）。
  const seen = typeof value.seen === 'boolean' ? value.seen : true
  if (mode === 'none') return { seen, reply: { mode: 'none' } }
  if (!content) return { seen, reply: { mode: 'none' } }
  if (mode === 'immediate') return { seen, reply: { mode: 'immediate', content } }
  const delay = sendAt?.getTime() - now.getTime()
  if (!sendAt || delay < runtime.minimumDelayedReplySeconds * 1_000 || delay > runtime.maximumDelayedReplyMinutes * Time.minute) return { seen, reply: { mode: 'none' } }
  return { seen, reply: { mode: 'delayed', content, sendAt: sendAt.toISOString() } }
}

function validMemory(value: unknown): value is MemoryDraft {
  return isRecord(value) && typeof value.category === 'string' && typeof value.content === 'string' && !!value.content.trim()
}

function validIntent(value: unknown, from: Date, now: Date, memory?: MemoryConfig): value is IntentDraft {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.summary !== 'string') return false
  const notBefore = toDate(value.notBefore)
  if (!notBefore) return false
  if (!isActiveConsequenceDraft(value)) return notBefore > now
  const expiresAt = consequenceExpiresAt(value.payload)
  const payload = value.payload
  const effect = isRecord(payload) && typeof payload.effect === 'string' ? payload.effect.trim() : ''
  const strength = isRecord(payload) ? payload.strength : undefined
  // Consequences are intentionally short-to-medium-lived story pressure,
  // not a backdoor for permanently rewriting canon. Keep the source time
  // close to this writing turn and cap their natural lifetime at 30 days.
  const maximumLifetime = Math.max(1, memory?.activeConsequenceMaxDays ?? 7) * Time.day
  return !!memory?.activeConsequencesEnabled && !!effect
    && (strength === undefined || typeof strength === 'number' && Number.isFinite(strength) && strength >= 0 && strength <= 1)
    && notBefore <= now && notBefore >= from
    && !!expiresAt && expiresAt > now && expiresAt.getTime() - now.getTime() <= maximumLifetime
}

type NormalizedIntentUpdate = { id: number; status: 'completed' | 'cancelled'; resolution?: string }

function normalizeIntentUpdates(value: unknown): NormalizedIntentUpdate[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item) && Number.isInteger(item.id) && Number(item.id) > 0 && (item.status === 'completed' || item.status === 'cancelled'))
    .map(item => ({
      id: Number(item.id), status: item.status as 'completed' | 'cancelled',
      ...(typeof item.resolution === 'string' && item.resolution.trim() ? { resolution: clip(item.resolution, 1_000) } : {}),
    }))
    .slice(0, 8)
}

function isActiveConsequence(intent: NarrativeIntent) {
  return intent.type === 'active-consequence' && isRecord(intent.payload) && intent.payload.lifecycle === 'active'
}

function isActiveConsequenceDraft(intent: Pick<IntentDraft, 'type' | 'payload'> | Record<string, unknown>) {
  return intent.type === 'active-consequence' && isRecord(intent.payload) && intent.payload.lifecycle === 'active'
}

function consequenceExpiresAt(payload: unknown) {
  if (!isRecord(payload)) return undefined
  return toDate(payload.expiresAt)
}

function consequenceStrength(payload: unknown, fallback = 0.55) {
  return clampNumber(isRecord(payload) ? payload.strength : undefined, fallback, 0, 1)
}

function hasCompactionEvidence(sourceEntryIds: number[] | undefined, entries: ScriptEntry[]) {
  if (!Array.isArray(sourceEntryIds) || sourceEntryIds.length === 0) return false
  const ids = new Set(entries.map(entry => entry.id))
  return sourceEntryIds.some(id => ids.has(id))
}

function normalizeConversationAction(value: unknown, runtime: RuntimeConfig, permittedParticipantIds: Set<string>, permittedGroupIds: Set<string>, currentParticipantId: string, now = new Date(), proactive = false) {
  if (!isRecord(value) || typeof value.participantId !== 'string' || !value.participantId || value.participantId === currentParticipantId) return undefined
  const groupTarget = value.participantId.startsWith('group:')
  const targetId = groupTarget ? normalizeGroupId(value.participantId.slice('group:'.length)) : value.participantId
  if ((groupTarget ? !permittedGroupIds.has(targetId) : !permittedParticipantIds.has(targetId)) || (value.mode !== 'immediate' && value.mode !== 'delayed')) return undefined
  if (groupTarget && value.mode !== 'immediate') return undefined
  // 主动联系与私聊回复共用同一可见文本合约：括号表情标签等不得漏出到投递。
  const content = typeof value.content === 'string'
    ? sanitizeAndClampVisibleContent(value.content, runtime.maxMessageCharacters, runtime.messageSeparator)
    : ''
  if (!content) return undefined
  const willingness = typeof value.willingness === 'number' && Number.isFinite(value.willingness)
    ? clampNumber(value.willingness, 0, 0, 1)
    : undefined
  if (proactive && (willingness === undefined || willingness < (runtime.proactiveWillingnessThreshold ?? 0.65))) return undefined
  const reason = typeof value.reason === 'string' ? clip(value.reason, 300) : undefined
  const endpointId = typeof value.endpointId === 'string' && value.endpointId.trim() ? value.endpointId.trim() : undefined
  if (value.mode === 'immediate') return { participantId: groupTarget ? `group:${targetId}` : targetId, mode: value.mode, content, ...(endpointId ? { endpointId } : {}), ...(willingness === undefined ? {} : { willingness }), ...(reason ? { reason } : {}) }
  const sendAt = toDate(value.sendAt)
  const delay = sendAt?.getTime() - now.getTime()
  if (!sendAt || delay < runtime.minimumDelayedReplySeconds * 1_000 || delay > runtime.maximumDelayedReplyMinutes * Time.minute) return undefined
  return { participantId: groupTarget ? `group:${targetId}` : targetId, mode: value.mode, content, sendAt: sendAt.toISOString(), ...(endpointId ? { endpointId } : {}), ...(willingness === undefined ? {} : { willingness }), ...(reason ? { reason } : {}) }
}

/** 解析层被意愿门丢弃的合法主动行动的信息（供 withdrawn 账本补偿记录）。
 * 只捕获"目标在白名单、内容非空、仅因 willingness 缺失/低于阈值或 delayed
 * 时间越界被丢"的行动；目标不合法/内容为空的丢弃与历史行为一致保持静默
 * （没有可记账的收件人，也不该把未过白名单的内容写进历史）。 */
export function droppedProactiveActionInfo(value: unknown, runtime: RuntimeConfig, permittedParticipantIds: Set<string>, currentParticipantId: string) {
  if (!isRecord(value) || typeof value.participantId !== 'string' || !value.participantId) return undefined
  if (value.participantId === currentParticipantId || value.participantId.startsWith('group:')) return undefined
  if (!permittedParticipantIds.has(value.participantId)) return undefined
  if (typeof value.content !== 'string' || !value.content.trim()) return undefined
  const content = sanitizeAndClampVisibleContent(value.content, runtime.maxMessageCharacters, runtime.messageSeparator)
  if (!content) return undefined
  const mode = value.mode === 'delayed' ? 'delayed' as const : 'immediate' as const
  const threshold = runtime.proactiveWillingnessThreshold ?? 0.65
  const willingness = typeof value.willingness === 'number' && Number.isFinite(value.willingness)
    ? clampNumber(value.willingness, 0, 0, 1)
    : undefined
  if (willingness === undefined) return { participantId: value.participantId, mode, content, reason: 'proactive-willingness-missing' }
  if (willingness < threshold) return { participantId: value.participantId, mode, content, reason: 'proactive-willingness-below-threshold' }
  if (mode === 'delayed') return { participantId: value.participantId, mode, content, reason: 'delayed-send-at-out-of-range' }
  return undefined
}

function permittedOrGlobal(value: unknown, fallback: string, permittedParticipantIds: Set<string>) {
  const candidate = typeof value === 'string' ? value.trim() : ''
  if (candidate && permittedParticipantIds.has(candidate)) return candidate
  return fallback && permittedParticipantIds.has(fallback) ? fallback : ''
}

function pickParticipantStatePatch(value: Record<string, unknown>): Partial<ParticipantState> {
  const patch: Partial<ParticipantState> = {}
  if (Array.isArray(value.openThreads) && value.openThreads.every(item => typeof item === 'string')) patch.openThreads = value.openThreads.map(item => clip(item, 500)).slice(0, 50)
  if (Array.isArray(value.relationshipNotes) && value.relationshipNotes.every(item => typeof item === 'string')) patch.relationshipNotes = value.relationshipNotes.map(item => clip(item, 500)).slice(0, 50)
  return patch
}

function mergeSetting(base: StorySetting, patch: Partial<StorySetting>): StorySetting {
  return { ...base, ...patch, character: { ...base.character, ...patch.character }, user: { ...base.user, ...patch.user } }
}

function mergeParticipantState(base: ParticipantState, patch: Partial<ParticipantState>): ParticipantState {
  return {
    ...base, ...patch,
    openThreads: Array.isArray(patch.openThreads) ? patch.openThreads : base.openThreads,
    relationshipNotes: Array.isArray(patch.relationshipNotes) ? patch.relationshipNotes : base.relationshipNotes,
  }
}

function normalizeParticipantState(value: unknown): ParticipantState {
  const record = isRecord(value) ? value : {}
  return {
    openThreads: Array.isArray(record.openThreads) ? record.openThreads.filter(item => typeof item === 'string').map(item => clip(item, 500)).slice(0, 50) : [],
    relationshipNotes: Array.isArray(record.relationshipNotes) ? record.relationshipNotes.filter(item => typeof item === 'string').map(item => clip(item, 500)).slice(0, 50) : [],
    relationshipOverlay: typeof record.relationshipOverlay === 'string' ? clip(record.relationshipOverlay, 4_000) : undefined,
    unreadMessageCount: Math.max(0, Math.floor(typeof record.unreadMessageCount === 'number' ? record.unreadMessageCount : 0)),
    pendingReplyCount: Math.max(0, Math.floor(typeof record.pendingReplyCount === 'number' ? record.pendingReplyCount : 0)),
    lastUserMessageAt: typeof record.lastUserMessageAt === 'string' ? record.lastUserMessageAt : undefined,
    lastCharacterMessageAt: typeof record.lastCharacterMessageAt === 'string' ? record.lastCharacterMessageAt : undefined,
  }
}

function participantRelevance(participant: InterludeParticipant) {
  const state = normalizeParticipantState(participant.state)
  const pending = state.pendingReplyCount * 2 + state.unreadMessageCount
  const last = toDate(state.lastUserMessageAt)?.getTime() ?? participant.updatedAt.getTime()
  return pending * 1_000_000_000 + last
}

/** Keeps a single due-turn private to one relationship while ensuring that
 * every plan that was already due at the start of the sweep gets a chance to
 * be judged before the next sweep interval. */
export function groupDueIntents(intents: NarrativeIntent[]) {
  const batches = new Map<string, NarrativeIntent[]>()
  for (const intent of [...intents].sort((left, right) => left.notBefore.getTime() - right.notBefore.getTime() || left.id - right.id)) {
    const family = intent.type === 'proactive-check' ? 'agency' : 'normal'
    const key = `${intent.participantId || '__global__'}|${family}`
    const batch = batches.get(key) ?? []
    batch.push(intent)
    batches.set(key, batch)
  }
  return [...batches.values()]
}

function resolveParticipantId(explicit: string | undefined, sourceEntryIds: number[] | undefined, entries: ScriptEntry[]) {
  if (explicit?.trim()) return explicit.trim()
  const ids = (sourceEntryIds ?? []).map(id => entries.find(entry => entry.id === id)?.participantId).filter(Boolean)
  return ids[0] ?? ''
}

function runStorySerialized<T>(service: any, storyId: string, task: () => Promise<T>) {
  // A few embedders/tests invoke delivery methods on a minimal host object
  // rather than a full InterludeService instance. Preserve that legacy shape
  // while keeping real service calls re-entrant-safe.
  if (typeof service.inSerial !== 'function' || typeof service.serial !== 'function') return task()
  return service.inSerial(storyId) ? task() : service.serial(storyId, task)
}

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }

export function shouldSupersedeNarrativeRequest(
  inFlightRequestId: number | undefined,
  firstMessageCommittedRequestId: number | undefined,
  obsoleteRequestIds: ReadonlySet<number>,
) {
  return shouldSupersedeRequest(inFlightRequestId, firstMessageCommittedRequestId, obsoleteRequestIds)
}

function toDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const DATABASE_DATE_FIELDS: Record<string, string[]> = {
  interlude_story: ['cursorAt', 'createdAt', 'updatedAt'],
  interlude_participant: ['createdAt', 'updatedAt'],
  interlude_script_entry: ['occurredAt', 'createdAt'],
  interlude_memory: ['createdAt', 'updatedAt'],
  interlude_intent: ['notBefore', 'createdAt', 'updatedAt'],
  interlude_scene: ['startedAt', 'endedAt', 'createdAt', 'updatedAt'],
  interlude_arc: ['createdAt', 'updatedAt'],
  interlude_fact: ['lastSeenAt', 'createdAt', 'updatedAt'],
  interlude_state_patch: ['createdAt', 'appliedAt'],
  interlude_overlay_snapshot: ['periodStart', 'periodEnd', 'createdAt', 'updatedAt'],
  interlude_sticker: ['createdAt', 'updatedAt'],
  interlude_web_observation: ['accessedAt', 'createdAt'],
  interlude_seeded_event: ['occursAt', 'expiresAt', 'createdAt', 'updatedAt'],
  interlude_schedule_preplan: ['createdAt', 'updatedAt'],
  interlude_long_arc_guidance: ['createdAt', 'updatedAt', 'completedAt', 'expiresAt'],
  interlude_long_arc_progress: ['updatedAt'],
}

/** Minato normally materializes timestamp columns as Date objects. Some
 * drivers and hot-reload paths can return ISO strings, so normalize every row
 * crossing the service boundary before time arithmetic or prompt building. */
export function normalizeDatabaseRow(table: string, value: unknown): any {
  if (!isRecord(value)) return value
  const row: Record<string, unknown> = { ...value }
  for (const field of DATABASE_DATE_FIELDS[table] ?? []) {
    if (row[field] === null || row[field] === undefined) continue
    row[field] = toDate(row[field])
  }
  if (table === 'interlude_story') {
    const createdAt = toDate(row.createdAt) ?? new Date()
    const updatedAt = toDate(row.updatedAt) ?? createdAt
    row.createdAt = createdAt
    row.updatedAt = updatedAt
    row.cursorAt = toDate(row.cursorAt) ?? updatedAt
    row.state = decodeStoryState(row.state)
  } else if (table === 'interlude_participant') {
    row.createdAt = toDate(row.createdAt) ?? new Date()
    row.updatedAt = toDate(row.updatedAt) ?? row.createdAt
    row.state = normalizeParticipantState(row.state)
  }
  return row
}

function sameTimestamp(left: unknown, right: unknown) {
  const a = toDate(left)
  const b = toDate(right)
  return !!a && !!b && Math.abs(a.getTime() - b.getTime()) < 2_000
}

/** A corrupted/future cursor must never make the narrator "fill in" time
 * backwards. Clamp only the prompt interval; normal successful persistence
 * still advances the stored cursor to the actual wall-clock time. */
const NARRATIVE_CATCHUP_MAX_GAP_MS = 30 * 60_000

function narrativeCursor(story: InterludeStory, now: Date) {
  const cursor = toDate(story.cursorAt) ?? now
  if (cursor > now) return now
  // 补写活锁防护:游标落后超过 30 分钟时,不从过远的旧时间开始全量补写
  // (7 小时停摆后单次窗口跨 7h → 输出过长/超时/被丢弃 → 游标不动 → 死循环);
  // 跳到 30 分钟前,期间的生活作为"已经过去"处理,模型可自然提及
  if (now.getTime() - cursor.getTime() > NARRATIVE_CATCHUP_MAX_GAP_MS) {
    return new Date(now.getTime() - NARRATIVE_CATCHUP_MAX_GAP_MS)
  }
  return cursor
}

function clip(value: unknown, length: number) { return typeof value === 'string' ? value.trim().slice(0, length) : '' }

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function normalizeFact(value: string) { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ') }

/**
 * Facts are narrated from their content, not from hidden participant metadata.
 * Keep this guard deliberately conservative: it only rejects relationship
 * facts whose subject is plainly absent or expressed only as a vague pronoun.
 * The narrator prompt remains responsible for producing a concrete named fact.
 */
function factContentLooksAmbiguous(scope: NarrativeFact['scope'], content: string) {
  if (scope !== 'relationship') return false
  const text = content.trim()
  if (!text) return true
  return /^(?:关系|他|她|他们|她们|对方|那个人|这个人|双方|彼此)(?:说|表示|答应|承诺|想|要|已经|最近|变得|变得更|开始|继续|不再|无法|没有|和|与|对)/u.test(text)
    || /(?:^|[，。；、\s])(?:他说|她说|他们说|她们说|对方说|他答应|她答应|对方答应|他承诺|她承诺|对方承诺)(?:[，。；、\s]|$)/u.test(text)
}

function limitEntriesByCharacters(entries: ScriptEntry[], limit: number) {
  if (limit <= 0) return []
  let used = 0
  const selected: ScriptEntry[] = []
  // 从最新条目向前保留，保证压缩请求优先看到场景接续点。
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (selected.length && used + entry.content.length > limit) break
    selected.unshift(entry)
    used += entry.content.length
  }
  return selected
}

function factScore(fact: NarrativeFact, config: MemoryConfig, queryEmbedding: number[] = [], query = '') {
  // lastSeenAt 可能为 null（rc2/rc3 补充事实或旧数据未写入）——回退到 updatedAt/createdAt，
  // 不能让检索排序因空时间崩溃。
  const lastSeen = fact.lastSeenAt ?? fact.updatedAt ?? fact.createdAt ?? new Date()
  const ageDays = Math.max(0, (Date.now() - lastSeen.getTime()) / (24 * Time.hour))
  const recency = Math.exp(-ageDays / 30)
  const similarity = cosineSimilarity(queryEmbedding, fact.embedding ?? [])
  // Negative similarity is treated as no semantic support. This prevents an
  // unrelated fact from receiving a half-score merely because cosine values
  // mathematically range from -1 to 1.
  const semantic = similarity == null ? 0 : Math.max(0, similarity)
  const lexical = historyLexicalScore(query, fact.content)
  return fact.importance * config.factImportanceWeight
    + fact.confidence * config.factConfidenceWeight
    + recency * config.factRecencyWeight
    + semantic * config.semanticWeight
    + lexical * Math.max(1, config.semanticWeight)
    + (fact.scope === 'promise' && fact.unresolved ? 1 : 0) * config.unresolvedWeight
}

/** Literal recall lane shared by raw script and durable facts. Chinese
 * bigrams preserve useful names and objects without requiring word splitting. */
export function historyLexicalScore(query: string, content: string) {
  const queryKeys = lexicalRecallKeys(query)
  if (!queryKeys.length) return 0
  const contentKeys = new Set(lexicalRecallKeys(content))
  const overlap = queryKeys.filter(key => contentKeys.has(key)).length
  const normalizedQuery = query.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
  const normalizedContent = content.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
  const phrase = normalizedQuery.length >= 3 && normalizedContent.includes(normalizedQuery) ? 0.5 : 0
  return Math.min(1, overlap / queryKeys.length + phrase)
}

function lexicalRecallKeys(text: string) {
  const normalized = text.toLocaleLowerCase()
  const words = normalized.match(/[a-z0-9]{3,}/gu) ?? []
  const chineseRuns = normalized.match(/[\u3400-\u9fff]{2,}/gu) ?? []
  const bigrams = chineseRuns.flatMap(run => Array.from(
    { length: Math.max(0, run.length - 1) },
    (_, index) => run.slice(index, index + 2),
  ))
  return Array.from(new Set([...words, ...bigrams])).slice(0, 80)
}

function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return undefined
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] * left[index]
    rightMagnitude += right[index] * right[index]
  }
  if (!leftMagnitude || !rightMagnitude) return undefined
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

/** How many sticker descriptions a semantically filtered turn injects. */
export const SEMANTIC_STICKER_LIMIT = 12

/** Pure ranking used by the semantic sticker filter. Assets without a vector
 * still fill remaining slots after the embedded ones so a half-indexed library
 * degrades gracefully instead of hiding entries. */
export function rankStickerCatalog<T extends { embedding?: number[] }>(assets: T[], queryEmbedding: number[], limit: number): T[] {
  if (!queryEmbedding.length || assets.length <= limit) return assets
  return assets
    .map(asset => ({ asset, score: cosineSimilarity(queryEmbedding, asset.embedding ?? []) ?? -1 }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit))
    .map(item => item.asset)
}

/** Only static raster images worth the re-render enter Puppeteer downscaling:
 * tiny images would not shrink further and animated ones have their own path. */
export function shouldDownscaleImage(mimeType: string, dataUri: string): boolean {
  if (!/^image\/(?:jpeg|png|webp)$/i.test(mimeType)) return false
  const binaryLength = Math.floor((dataUri.split(',')[1] ?? '').length * 3 / 4)
  return binaryLength >= 150 * 1024
}

function createFactQuery(participant: InterludeParticipant | null, userMessage: string | undefined, dueIntents: NarrativeIntent[], supersededIntents: NarrativeIntent[]) {
  const state = participant ? normalizeParticipantState(participant.state) : undefined
  return [
    userMessage ? `Current user message: ${userMessage}` : '',
    ...(state?.openThreads ?? []).map(thread => `Open thread: ${thread}`),
    ...(state?.relationshipNotes ?? []).map(note => `Relationship note: ${note}`),
    ...dueIntents.map(intent => `Due intent: ${intent.summary}`),
    ...supersededIntents.map(intent => `Superseded plan: ${intent.summary}`),
  ].filter(Boolean).join('\n')
}

function formatBufferedUserMessages(messages: BufferedUserMessage[]) {
  if (messages.length === 1) return messages[0].content
  return messages.map((message, index) => {
    const time = message.occurredAt.toISOString()
    return `[连续消息 ${index + 1}，收到时间 ${time}]\n${message.content}`
  }).join('\n\n')
}

function automaticIntervalMinutes(story: InterludeStory, now: Date, config: AutoAdvanceConfig) {
  const restWindow = activeRestWindow(config.restWindows, story.setting.timezone, now)
  if (restWindow) return randomInteger(restWindow.minIntervalMinutes, restWindow.maxIntervalMinutes)
  return Math.max(1, config.intervalMinutes + randomInteger(-config.jitterMinutes, config.jitterMinutes))
}

function normalizeFollowUpMinutes(values: number[] | undefined) {
  const defaults = [10, 20]
  const normalized = (Array.isArray(values) ? values : defaults)
    .map(value => Math.floor(Number(value)))
    .filter(value => Number.isFinite(value) && value >= 1 && value <= 240)
  return Array.from(new Set(normalized)).sort((left, right) => left - right).slice(0, 6)
}

function scheduleConversationFollowUps(anchor: Date, config: AutoAdvanceConfig) {
  let previous = anchor.getTime()
  return config.followUpMinutes.map(minutes => {
    const jitter = config.followUpJitterMinutes
      ? randomInteger(-config.followUpJitterMinutes, config.followUpJitterMinutes)
      : 0
    // Never place a later configured pass before an earlier one, even when
    // jitter is enabled or the owner provides a close custom sequence.
    const at = Math.max(previous + 1_000, anchor.getTime() + Math.max(1, minutes + jitter) * Time.minute)
    previous = at
    return new Date(at)
  })
}

function activeRestWindow(windows: RestWindow[], timezone: string, now: Date) {
  const localMinutes = localClockMinutes(now, timezone)
  return windows.find(window => {
    if (!window.enabled) return false
    const start = clockMinutes(window.start)
    const end = clockMinutes(window.end)
    if (start == null || end == null) return false
    return start <= end
      ? localMinutes >= start && localMinutes < end
      : localMinutes >= start || localMinutes < end
  })
}

function clockMinutes(value: string) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(value?.trim())
  if (!matched) return undefined
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : undefined
}

/** A narrow last-resort guard for live messages. It intentionally avoids
 * interpreting ordinary prose: only short windows containing an explicit
 * future clock or multiple completed lesson stages are rejected. Automatic
 * advances and legitimate long catch-up windows remain untouched. */

/** 模型调用与投递存在分钟级延迟，加上分钟取整：超出 now 这个宽限内的
 * 时钟引用视为"就是现在"，不因网络抖动丢弃整段剧本。 */
const TIME_OVERFLOW_GRACE_MINUTES = 5
/** 12 小时制的歧义视野：now=00:01 时提到"11:58"几乎总是指刚过去的
 * 23:58（午夜前 3 分钟），而不是 11 小时 57 分钟后的未来。朴素前向距离
 * 超过该视野的时钟引用一律按"刚过去的 12 小时制写法"处理，不再判未来。 */
const TIME_FORWARD_HORIZON_MINUTES = 6 * 60

/** 剧本开头的"叙事宣告位"：中文叙事在场景起始处声明时间。只检查这一小段，
 * 中后段的钟点绝大多数是对约定/回忆/计划的引用，不应作为越界证据。 */
const LIVE_SCRIPT_HEADLINE_CHARS = 30
/** 计划/约定语义：钟点作为未来安排被引用时（"八点赶到""九点前"），不构成越界。 */
const PLAN_SEMANTICS = /赶到|约定|答应|要在|得在|之前|以前|打算|计划|准备|约好|说好|出发|来不及|赶不上|预计|大概|左右|还没|尚未/

const CONTEXT_WINDOW = 8

/** 钟点前后各 8 字的上下文窗口：计划/约定词常出现在钟点紧邻处（「八点【前】赶到」）。 */
function contextAround(text: string, index: number, length: number) {
  return text.slice(Math.max(0, index - CONTEXT_WINDOW), Math.min(text.length, index + length + CONTEXT_WINDOW))
}

function clocksIn(text: string): Array<{ hour: number, minute: number, around: string }> {
  const found: Array<{ hour: number, minute: number, around: string }> = []
  for (const match of text.matchAll(/(?:^|[^\d])(?:(\d{1,2})[:：](\d{2})|(\d{1,2})点(?:(\d{1,2})分?)?)/g)) {
    const hour = Number(match[1] ?? match[3])
    const minute = Number(match[2] ?? match[4] ?? 0)
    if (hour > 23 || minute > 59) continue
    found.push({ hour, minute, around: contextAround(text, match.index!, match[0].length) })
  }
  for (const match of text.matchAll(/([零一二三四五六七八九十两]+)点(?:(?:零|([一二三四五六七八九十两]+))分?|(半))?/g)) {
    const hour = chineseClockNumber(match[1])
    const minute = match[2] ? chineseClockNumber(match[2]) : 0
    if (hour == null || minute == null || hour > 23 || minute > 59) continue
    found.push({ hour, minute, around: contextAround(text, match.index!, match[0].length) })
  }
  return found
}

export function detectLiveScriptTimeOverflow(script: unknown, phase: NarrativeRequest['phase'], from: Date, now: Date, timezone: string, endorsedClocks?: ReadonlySet<number>) {
  const text = String(script ?? '').trim()
  const elapsedMinutes = Math.max(0, (now.getTime() - from.getTime()) / Time.minute)
  if (phase !== 'user-message' || !text || elapsedMinutes > 60) return undefined
  const endpoint = storyLocalTimeContext(now, timezone)
  const nowMinutes = endpoint.hour * 60 + Number(endpoint.time.slice(3, 5))
  const overflow = (value) =>
    value > nowMinutes + TIME_OVERFLOW_GRACE_MINUTES && value - nowMinutes <= TIME_FORWARD_HORIZON_MINUTES
  // 用户给出了未来期限（"九点前赶到"）时，其之间的叙事推进被授权：落在
  // (now, maxEndorsed] 区间的钟点一并豁免；endorsed 为空时行为不变。
  const endorsedDeadline = endorsedClocks && endorsedClocks.size ? Math.max(...endorsedClocks) : undefined
  // 只把剧本开头（叙事宣告位）里、且没有计划语义的钟点视为"把叙事时间写过头"。
  for (const clock of clocksIn(text.slice(0, LIVE_SCRIPT_HEADLINE_CHARS))) {
    const value = clock.hour * 60 + clock.minute
    if (endorsedClocks && endorsedClocks.has(value)) continue
    if (endorsedDeadline !== undefined && value > nowMinutes && value <= endorsedDeadline) continue
    if (PLAN_SEMANTICS.test(clock.around)) continue
    if (overflow(value)) return `explicit clock ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')} exceeds ${endpoint.time.slice(0, 5)}`
  }
  // 全文（含开头）的课程阶段推进不变：多个已完成的课程节 = 时间被写飞。
  const lessonStages = new Set(Array.from(text.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*节/g), match => match[1]))
  if (lessonStages.size >= 2) return `multiple lesson stages (${[...lessonStages].join('→')}) inside a ${Math.round(elapsedMinutes)} minute live window`
  return undefined
}

function chineseClockNumber(value: string) {
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (value === '十') return 10
  if (value.includes('十')) {
    const [left, right] = value.split('十')
    const tens = left ? digits[left] : 1
    const ones = right ? digits[right] : 0
    return tens == null || ones == null ? undefined : tens * 10 + ones
  }
  return value.length === 1 ? digits[value] : undefined
}

function randomInteger(min: number, max: number) {
  const lower = Math.floor(Math.min(min, max))
  const upper = Math.floor(Math.max(min, max))
  return lower + Math.floor(Math.random() * (upper - lower + 1))
}

function mergeNote(existing: string | undefined, next: string) {
  const value = clip(next, 2_000)
  if (!value) return existing
  if (!existing) return value
  if (normalizeFact(existing).includes(normalizeFact(value))) return existing
  return `${existing}\n${value}`.slice(-6_000)
}

function patchClaimsMatch(left: string, right: string) {
  const a = normalizeFact(left).replace(/[，。！？、,.!?；;:：]/g, '')
  const b = normalizeFact(right).replace(/[，。！？、,.!?；;:：]/g, '')
  if (!a || !b) return false
  if (a === b) return true
  // Allow small wording variations, while avoiding very short claims that
  // could incorrectly merge contradictory changes.
  return Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))
}

function statePatchEvidence(entries: ScriptEntry[], timezone: string) {
  const narrative = entries.filter(entry => entry.kind === 'script' || entry.actor === 'narrator')
  // Use the narrative timestamp as the turn key. Duplicate rows created at
  // the same instant must not count as independent evidence.
  const turns = new Set(narrative.map(entry => entry.occurredAt.getTime())).size
  const days = new Set(narrative.map(entry => calendarDayKey(entry.occurredAt, timezone))).size
  return { turns, days, scenes: developmentScenes(narrative) }
}

function startOfUtcWindow(value: Date, windowDays: number) {
  const size = Math.max(1, Math.floor(windowDays))
  const epochDay = Math.floor(value.getTime() / Time.day)
  return new Date(Math.floor(epochDay / size) * size * Time.day)
}

function groupOverlayPatches(patches: StatePatchProposal[], windowDays = 5) {
  const groups = new Map<string, { participantId: string; target: StatePatchProposal['target']; from: Date; to: Date; patches: StatePatchProposal[] }>()
  for (const patch of patches) {
    const from = startOfUtcWindow(patch.appliedAt ?? patch.createdAt, windowDays)
    const key = `${patch.participantId}|${patch.target}|${from.toISOString()}`
    const group = groups.get(key) ?? { participantId: patch.participantId, target: patch.target, from, to: new Date(from.getTime() + windowDays * Time.day), patches: [] }
    group.patches.push(patch)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function groupOverlaySnapshots(snapshots: OverlaySnapshot[], windowDays = 10) {
  const groups = new Map<string, { participantId: string; target: OverlaySnapshot['target']; from: Date; to: Date; snapshots: OverlaySnapshot[] }>()
  for (const snapshot of snapshots) {
    const from = startOfUtcWindow(snapshot.periodEnd, windowDays)
    const key = `${snapshot.participantId}|${snapshot.target}|${from.toISOString()}`
    const group = groups.get(key) ?? { participantId: snapshot.participantId, target: snapshot.target, from, to: new Date(from.getTime() + windowDays * Time.day), snapshots: [] }
    group.snapshots.push(snapshot)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function normalizeMajorEvents(value: unknown, patches: StatePatchProposal[], snapshots: OverlaySnapshot[] = []) {
  const modelEvents = Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => clip(item, 600)) : []
  const retained = [
    ...snapshots.flatMap(snapshot => snapshot.majorEvents ?? []),
    ...patches.filter(patch => patch.impact === 'major').map(patch => clip(patch.proposedValue || patch.evidence, 600)),
  ]
  return Array.from(new Set([...retained, ...modelEvents].filter(Boolean))).slice(-20)
}

