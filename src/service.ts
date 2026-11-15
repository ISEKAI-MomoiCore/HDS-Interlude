import { $, Context, Logger, Service, Session, Time } from 'koishi'
import { AsyncLocalStorage } from 'node:async_hooks'
import { registerTables } from './database'
import { boundedDebounceDelay } from './debounce-window'
import { offlineGroupCatchup } from './platform/onebot-offline-catchup'
import { RUNTIME_TABLES, cleanupKey, cleanupPayload, type RuntimeTable } from './database-cleanup'
import { createWorldSeeder, resolveWorldSeederRuntime, type WorldSeedDomain, type WorldSeeder } from './world-seeder'
import { resolveWeatherConfig } from './weather'
import { lifeRhythmStale } from './story-state'
import { resolveQzoneConfig, type QzoneActionCaller, type QzoneActionKind, type QzoneConfig } from './qzone'
import {
  endpointAccountKey, freshEndpointState,
  stateAfterConnection, isEndpointDeliverable, isEndpointInitiateAllowed,
  type EndpointRow, type EndpointState, type StoryAliasRecord, type EndpointChannelKind,
} from './endpoints'
import { HealthMonitor } from './health'
import { contactEvidenceThreads, knowledgeClauses, knowledgeRelatedIds, legacyConditionCue } from './script/knowledge-evidence'


import { createTurnEngine, type TurnEngine, type TurnHandle, type TurnBufferedNarrativeTurn as BufferedNarrativeTurn } from './turn-engine'
import type { PlatformAdapter } from './platform/adapter'
import { OneBotAdapter } from './platform/onebot-adapter'
import { describeHttpError } from './http-proxy'
import { createScheduler, type Scheduler } from './scheduler'
import { UrgeConfig, resolveUrgeConfig, normalizeUrgeState, urgeUserEvent, planUrge, commitUrge, type UrgeRhythmInput } from './urge'
import { resolve } from 'node:path'

import { AudioConfig, compactPromptEntries, createCompactor, createEmbedder, createNarrator, createStickerDescriber, createVisionDescriber, detectMessageRepetition, formatTokenUsageLine, isContextDisposedError, ModelConfig, OpenAICompatibleNarrator, promptVisibleMessageContent, recentScriptOwnership, StickerDescriber, TokenUsageRecord, VisionDescriber } from './narrator'
import { ModelCaptureConfig, ModelCaptureSink } from './capture'
import { DailyQuotaTracker, resolveStickerHarvestConfig, StickerHarvestConfig, StickerHarvestStore } from './sticker-harvest'
import { effectiveSearchBackend, ResearchConfig, ResearchDesk, resolveResearchConfig } from './research/desk'
import { CONFIG_CENTER_SECRET_MASK, EDITABLE_STORY_KEYS, isConfigSection, type ConfigReadResult, type ConfigSaveResult } from './console/contract'
import { ResearchToolRegistry } from './research/tools'



import {
  ConversationDensityTracker, ContextEntryAutoConfig,
  densityTier, effectiveContextEntryLimit, effectiveScopeMode, resolveContextEntryAutoConfig,
} from './context-density'
import { formatModelRouting, ModelRoutingTable, resolveModelRouting } from './model-routing'
import { providerEndpointHost } from './narrator'
import {
  advanceAlterSystem, alterHistoryForScope, alterScopeCoolingDown, alterScopeValue, calculateAlterThreshold,
  clearAlterScopeAnalysisAttempt, completeAlterAnalysis, emotionalOffsetForPrompt, markAlterScopeAnalysisAttempt,
  normalizeAlterSystemState, resolveAlterSystemConfig,
  AlterTurnResult,
} from './alter'
import { groundedEpisodeTags } from './script/episode-index'
import { recallFocus } from './script/recall-navigation'
import { developmentContextQuery } from './script/development'
import { reconcileTransportReferences } from './script/authored-actions'

export { isBotOnlineStatus } from './session-platform'
// P1 拆分（2026-10-29）：原文件尾部助手已迁至 session-platform / chat-artifacts / narrative-normalizers，
// 此处保留 re-export 垫片（既有测试与外部导入不变）并 import 类内部使用的助手。行为不变。
import { isBotOnlineStatus, bindActiveServiceForEndpoints, storyIdForCharacter, legacyStoryIdFor, participantIdFor, participantIdForStory, sameParticipantEndpoint, isOneBotPlatform, sessionGroupId, groupIdStorageVariants, normalizeGroupId, samePlatformFamily, normalizeAccountId } from './session-platform'
export { extractSessionVoiceCount, extractSessionAudioSources, SessionFileFact, extractSessionFileFacts, describeGroupAttachments, withTransportTimeout, guessAudioFormat } from './session-platform'
import { normalizeExpressionThreshold, targetableMessageId, groupMessageRef, extractUserReportedTimes, normalizeQuotedMessageContext, normalizeTimelinePlan, describeTimelinePlanRejection, timelineEntryPromptProjection, formatGroupSpeaker } from './chat-artifacts'
export { calibratedNativeFaceWillingness, stableStickerAssetId, stickerDeliveryUrl, stickerFileUrl, extractUserReportedTimes, describeQuotedMessage, normalizeQuotedMessageContent, normalizeAllowedReactions, normalizeTimelinePlan, describeTimelinePlanRejection, timelineEntryPromptProjection, normalizeGroupChatActions, formatGroupSpeaker } from './chat-artifacts'
import { normalizeGroupVisibleReply, hoistParticipantlessInteraction, requiresVisibleReplyRecovery, visibleReplyMode, safeJsonPreview, sanitizeAndClampVisibleContent, resolveScriptContextBudget, signedNumber, isTransientDatabaseError, resolveNarrativeContractFeatures, normalizeScriptField, hasRequiredNarrativeScript, resolveBlindModeConfig, isAutomaticNarrativePhase, inferredFollowUpCommitment, interactionPromisesFollowUp, automaticDeliveryFromPayload, normalizeDecision, normalizeBrowserIntentDraft, resolveBrowserTarget, isSafePublicWebUrl, webObservationEntryContent, normalizeInteraction, normalizeIntentUpdates, isActiveConsequence, consequenceExpiresAt, consequenceStrength, mergeSetting, mergeParticipantState, normalizeParticipantState, participantRelevance, groupDueIntents, runStorySerialized, isRecord, toDate, normalizeDatabaseRow, sameTimestamp, narrativeCursor, clip, clampNumber, factContentLooksAmbiguous, factScore, historyLexicalScore, SEMANTIC_STICKER_LIMIT, createFactQuery, semanticFactStats, automaticIntervalMinutes, normalizeFollowUpMinutes, scheduleConversationFollowUps, activeRestWindow, detectLiveScriptTimeOverflow } from './narrative-normalizers'
export { normalizeGroupVisibleReply, hoistParticipantlessInteraction, requiresVisibleReplyRecovery, visibleReplyMode, sanitizeAndClampVisibleContent, splitVisibleReplyBubbles, resolveScriptContextBudget, resolveNarrativeContractFeatures, normalizeScriptField, hasRequiredNarrativeScript, resolveBlindModeConfig, normalizeScenePresenceDrafts, normalizeDecision, normalizeInteraction, droppedProactiveActionInfo, groupDueIntents, shouldSupersedeNarrativeRequest, normalizeDatabaseRow, historyLexicalScore, SEMANTIC_STICKER_LIMIT, rankStickerCatalog, shouldDownscaleImage, detectLiveScriptTimeOverflow } from './narrative-normalizers'
import { tryHarvestStickers, harvestLibraryHashIndex, runStickerHarvestScan, noteHarvestFailure, stickerHarvestStatusLines, scanStickerLibrary, stickerDeliveryBase, registerStickerRoute, refreshStickerCatalog, semanticStickerEmbeddingEnabled, backfillStickerEmbeddings, stickerCatalogForSession, rankStickerAssets } from './sticker-library'
import { describeImageSource, describeUserEvent, readForward, loadNativeAudio, fetchNativeAudio, describeVisionEvent, loadNativeImages, describeCurrentImages, isExpiredImageSource, deadImageSourceReason, rememberDeadImageSource, fetchNativeImage, fetchImageThroughRedirects, fetchNativeImageUncached, imageBytesToNative, downscaleImageForVision, renderAnimatedImageFrame } from './media-loading'
import { RECALLABLE_ENTRY_KINDS, recallHistory, type HistoryVectorEntry, ensureHistoryVectors, invalidateHistoryVectors, backfillHistoryEmbeddings } from './history-recall'
export { isHistoryEntryVisibleToParticipant } from './history-recall'
import { groupCooldownActive, groupChatCapabilities, privateChatCapabilities, executeGroupReactions, resolveSticker, resolveNativeFace, sendSticker, sendNativeFace } from './group-actions'
import { receiveGroup, receive, groupSenderName, lookupGroupMemberName } from './inbound-gate'
import { ManageSessionDenial, manageSessionDenialReason, isEnabledAccount } from './session-platform'
export { ManageSessionDenial, manageSessionDenialReason, isEnabledAccount }
import type { GroupWillingnessConfig, GroupWillingnessState } from './group-willingness'
import { normalizeWillingnessPreset } from './group-willingness'
import { resolveGroupDimensions, activeProactiveGroupTargets } from './group-dimensions'
import { executePrivateNarrativeTurn, executeGroupNarrativeTurn } from './narrative/turn-executor'
import { assembleGroupBackground, mergeGroupBackgroundWatermarks, readGroupBackgroundWatermarks, type GroupBackgroundCoverage, type GroupBackgroundSection } from './narrative/group-background'
import { recordBlockedBatch, consumeSalience, maxSalienceScore, salienceGlanceDelayMs, DEFAULT_SALIENCE_CONFIG, type GroupSalienceState } from './narrative/narrative-salience'
import { bootstrapAttentionWords, type AttentionWordState, type AttentionWord } from './narrative/attention-words'
import { sampleInteractionRhythm, renderInteractionRhythm, formatMedianDuration, RHYTHM_SAMPLE_WINDOW, type RhythmSampleEntry, type RhythmSampleResult } from './narrative/rhythm-impression'
import { reportContactPlanUpdate, researchScriptTail, jevGatePassiveResearch, researchDeskFor, researchProvider, appendIntent, applyIntentUpdates, appendBrowserIntent, executeResearchIntent, researchStatusLines, executeDeferredBrowserIntent, dueIntents, upcomingNarrativeIntents, scheduleDueIntentWake, wakeDueIntents, reconcileTerminalSplitIntent, pendingSplitSegments, deferDueIntentsBehindPendingSplits, scheduleNextPendingWake, deliverDueSplitSegments, pendingFollowUpCommitments, retireExpiredFollowUps, appendFollowUpCommitment, applyFollowUpResolutions, deferUnresolvedDueFollowUps } from './intents'
import { longHorizonSweep, longHorizonProgress, saveLongHorizonProgress, getActiveLongArcGuidance, ensureLongHorizonGuidanceLoaded, longHorizonGenerate, longHorizonInput, longHorizonPromptProjection } from './long-arc-runner'
import { currentSchedulePreplanWindow, getSchedulePreplan, schedulePreplanEvidence, saveSchedulePreplan, prepareSchedulePreplanReview, requestSchedulePreplan, persistSchedulePreplanReview } from './schedule-preplan-runner'
import { worldSeederSweep, buildWorldSeederPayload, worldSeederBlockedNames, drainDueSeededEvents } from './world-seeder-runner'
import { resolveLongHorizonConfig, type LongArcGuidanceRecord, type LongArcProgressRow } from './long-arc'
import { weatherSweep } from './weather-runner'
import { compactionCheckpointAdvanced, scheduleCompaction, compactStory, compactOverlay, compactStories, compactThreePhase, prepareCompaction, applyCompaction, compactOverlayUnlocked, rebuildLiveOverlayState, prepareCompactionEmbeddings, persistCompaction, persistCompactionOutputs, persistFact, scheduleFactEmbeddingBackfill, backfillFactEmbeddings, persistStatePatch, type PreparedCompaction, type PreparedCompactionRun } from './compaction/pipeline'
import { enqueueEndpointWrite, persistEndpointState, setEndpointState, endpointGateReason, liveBotForEndpoint, endpointInitiateGateReason, endpointForDelivery, ensureEndpointRegistry, reconcileEndpointRegistry, registerStoryRoleEndpointRow, registerParticipantUserEndpointRow, backfillQzoneEndpointIds, recordStoryAlias, resolveStoryIdAlias, removeStoryAlias, listStoryAliases, addStoryEndpoint, disableStoryEndpoint, resolveMostActiveEndpointId, narrativeEndpointSelection, linkParticipantEndpoint, unlinkParticipantEndpoint, listParticipantEndpoints, resolveRoleAccountKey, listStoryEndpoints, resolveInboundEndpointFor, channelMetadataFor, touchEndpointStateInbound, syncCurrentBotConnections, noteEndpointConnection, endpointAddressSync, noteEndpointOutbound } from './endpoint-registry'
import { qzoneCaller, qzoneExecute, qzoneAvailable, executeQzoneIntent, qzoneFeedSweep, qzoneReactionSweep } from './qzone-executor'
import { sendGroupMessage, sendCrossGroupMessage, deliveryExecutionKey, successfulDeliveryEntry, deliverOutgoingMessages, deliveryLedgerConfirmed, sendOutgoingMessages, confirmOutgoingDeliveries, recordOutgoingDeliveryFailure, updateScriptDeliveryOutcome, recordPlatformDeliveryOutcome, resolveLiteralQuoteMessageId, recordAutomaticDelivery, splitOutgoingMessage, typingDelayMilliseconds, firstMessageTypingHoldMs, type GroupDeliveryResult } from './delivery/pipeline'
import { normalizeLifeHandoff } from './script/life-handoff'
import { needsTimelineDirector } from './script/timeline-routing'

import {
  activeAgencyWindow, normalizeAgencyWindowDraft,
  resolveAgencyConfig,
} from './agency'
import { HDS_INTERLUDE_VERSION } from './meta'
import { formatLayeredLog, phaseLabel, renderLogMessage, type CommunicationEventLog } from './logging'
import { formatLogTime, formatStoryDisplayTime } from './time'


import { ForwardReadResult } from './forward-message'


import { nextSchedulePreplanTransition, resolveSchedulePreplanConfig, type SchedulePreplanConfig } from './schedule-preplan'
import {
  decodeStoryState, encodeStoryState, inspectStoryStateMigration,
} from './story-state'
import { attachMessageEvent, prepareOutgoingDelivery, restoreDesktopContext, restoreMessageEvent, scriptEventPayload } from './delivery'

import { decisionToScriptCommit, findGroupScriptEvent, findPrivateOutgoingMessageEvent, unboundImmediateMessageEvents } from './script/commit-builder'
import { isOutgoingScriptEvent, messageEventReference, ScriptCommitDraft, type ScriptEventDraft } from './script/contract'
import { ScriptDeliveryAction, ScriptDeliveryReference, ScriptDeliverySegmentStatus } from './script/delivery-ledger'
import { DeliveryPolicyConfig, evaluateDeliveryPolicy, migrateLegacyRunLimits, policyActionRecordsFromLedger, resolveDeliveryPolicyConfig, type PolicyActionRecord } from './script/delivery-policy'
import { validateScriptCommit } from './script/validator'
import { scriptEntryDraftForCommit } from './turn-persistence'
import { advanceSceneFrame, projectSceneFrame, resolveDialogueBurst } from './script/scene-frame'
import {
  CompactionDecision, emptyStorySetting, emptyStoryState, IntentDraft, InterludeArc, InterludeScene,
  InterludeParticipant, InterludeStory, MemoryDraft, NarrativeDecision, NarrativeFact, NarrativeIntent,
  GroupContext, GroupMessageContext, NarrativeHistoricalImage, NarrativeInteraction, NarrativeProvider, NarrativeRequest, NarrativeCompactor,
  NarrativeEmbedder, OutgoingMessageDraft, ParticipantState, ScriptEntry, ScriptEntryDraft, StatePatchDraft, StatePatchProposal, StorySetting, StoryState,
  BrowserIntentDraft, NarrativeAudio, NarrativeImage, OverlaySnapshot, WebObservation, emptyParticipantState,
  AlterSystemState, AlterSystemConfig, EmotionalOffsetPrompt, ChatRhythmConfig,
  AgencyConfig,
  ChatActionCapabilities, ChatReactionName, FollowUpCommitmentDraft, FollowUpResolutionDraft, LocalMediaDraft, MessageReactionDraft, NativeFaceSemantic, StickerAsset, StickerCatalogEntry,
  EarlyNarrativeReply, IndexedQuotedMessageContext, QuotedMessageContext, SchedulePreplanRecord, SchedulePreplanReviewRequest,
  PreviousSceneSummary, RecalledMoment, WorkingDetail, TimelinePlan, TimelinePlanRequest,
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
  return { protocol: 4, storyId: '', revision: 'empty', range: { from: now, to: now }, entries: [] as ScriptEntry[], scenes: [] as InterludeScene[], facts: [] as NarrativeFact[] }
}

/** Entry kinds whose raw content is eligible for semantic history recall. */

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
  /** 预设同步：从 typ0-site 分享站拉取配置（码变更触发：首次填写/换码时同步一次）。 */
  presetSync?: {
    enabled: boolean
    baseUrl: string
    shareCode: string
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
  /** 统一投递策略（P2）：可选部署额度与 shadow 比较；总开关与渠道权限不在此层。 */
  deliveryPolicy?: unknown
  schedulePreplan?: SchedulePreplanConfig
  /** 实验性：主叙事微调数据采集（原始输入/输出 JSONL）；盲模式下强制关闭。 */
  modelCapture?: ModelCaptureConfig
  /** 实验性：考据 Agent——资料案头为作者供应经核实的写作参考。 */
  research?: ResearchConfig
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
  /** F7：意愿档位一次性迁移标志——加载时归一历史 off+enabled 规则后置 true
   * 并持久化；此后用户显式选择的 off 稳定表达关闭（groupRule 不再运行时归一）。 */
  willingnessPresetMigrated?: boolean
  /** Prevent an echoed self-message from entering the narrative. */
  ignoreSelfMessages: boolean
}

export interface ChatActionsConfig {
  enabled: boolean
  /** Console 配置面枚举保持封闭（仅列已知平台）；新平台的动作能力由适配器协商。 */
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
  /** 实验性：表情包采集（偷表情包）——他人表情即时暂存、周期判定入库。 */
  harvest?: StickerHarvestConfig
}

/** Embedding 已启用但路由不可用时的启动提示文案；未降级返回 undefined。
 * 纯函数供构造器与测试共用（向量可观测性：静默降级必须显性化）。 */
export function embeddingDegradationNotice(model: ModelConfig, routing: ModelRoutingTable): string | undefined {
  if (model.embedding?.enabled !== true) return undefined
  if (routing.embedding.available) return undefined
  return 'Embedding 已启用但没有可用连接（请在模型中心为某条连接勾选“用作 Embedding”，或在 Embedding 设置中显式填写模型）——语义检索全程降级为规则排序，直到修复配置并重载'
}

export interface GroupChatRule {
  groupId: string
  label: string
  enabled: boolean
  purpose: string
  characterRole: string
  /** Explicit Koishi channel assignee. Empty/omitted preserves native routing. */
  assignee?: string
  /** 旧字段（等价于下方三维度的预设组合，显式维度逐维优先）：
   * mention-only → directed/mention/off；always → background/willingness/active。 */
  responseMode: 'mention-only' | 'always'
  /** I-6b 采集范围：off=不采集 / directed=仅定向消息（@、引用、语音、图片）/
   * background=背景采集（含普通消息入库）。未设置时由 responseMode 派生。 */
  collectionScope?: 'off' | 'directed' | 'background'
  /** I-6b 即时触发：mention=仅 @（音频按 audioAlwaysTriggers 模态策略）/
   * willingness=交意愿门与冷却。未设置时由 responseMode 派生。 */
  immediateTrigger?: 'mention' | 'willingness'
  /** I-6b 后台参与：off=不参与（不进推进背景，不作主动目标）/ background=仅
   * 背景材料 / active=可主动回应。未设置时由 responseMode 派生。 */
  backgroundParticipation?: 'off' | 'background' | 'active'
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
  /** 群内出现语音/音频是否必定触发主叙事（跳过意愿与冷却；mention-only 也响应）。
   * 默认开启；关闭后语音与普通消息一样受响应模式、意愿与冷却控制。 */
  audioAlwaysTriggers?: boolean
  /** 本群是否采集成员发送的表情包（需配合 stickers.harvest 总开关）。 */
  stickerHarvest?: boolean
  /** §7.6.3 兼容选项：回复后跳过条数抖动（默认开启=现行为）。关闭后群门仅按
   * 评分/概率与会话相位调度，不再按条数观察。 */
  skipJitter?: boolean
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
  /** auto 模式：按对话密度自适应条目预算（方案 A：生效值为硬上限）。 */
  contextEntryMode?: 'fixed' | 'auto'
  contextEntry?: { private?: unknown, group?: unknown }
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

export interface AutoAdvanceConfig {
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
  /** D4：群回合通道句柄（替代旧会话直存）。 */
  latestHandle?: TurnHandle
  messages: (GroupMessageContext & { imageSources?: string[], imageSession?: Session, audioSources?: string[], audioSession?: Session, endpointId?: string })[]
  timer?: () => void
  debounceStartedAt?: number
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
  private qzoneRuntime = resolveQzoneConfig(undefined)
  private embedder: NarrativeEmbedder
  stickerDescriber: StickerDescriber
  visionDescriber: VisionDescriber
  private stickerCatalog: StickerAsset[] = []
  /** Whole-table semantic recall cache, one map per story: entry id → vector +
   * minimal content. Loaded lazily on first recall and extended incrementally
   * by the background backfill; never persisted. */
  private historyVectors = new Map<string, Map<number, HistoryVectorEntry>>()
  /** 桥接幂等（轻量修复）：桌面 30s 超时后入 inbox 重放时，同一消息会再次到达。
   * 用内存 Map 按 platform:messageId 去重——进程生命周期内有效，重启后由
   * script_entry.metadata.messageId 的磁盘记录兜底（重放场景不会跨重启）。 */
  private seenIncomingMessages = new Map<string, number>()
  episodeIndexes = new Map<string, { source: Map<number, HistoryVectorEntry>; size: number; byEntry: Map<number, number[]>; ordered: Array<[number, HistoryVectorEntry]> }>()
  historyVectorsReady = new Set<string>()
  historyVectorLoads = new Map<string, Promise<void>>()
  historyBackfills = new Set<string>()
  historyBackoff = new Map<string, number>()
  automaticRecallCache = new Map<string, {
    source: Map<number, HistoryVectorEntry>; size: number; key: string; until: number; result: RecalledMoment[]
  }>()
  /** Per-story retry-after timestamps for failed Schedule Preplan generations. */
  schedulePreplanBackoff = new Map<string, number>()
  /** Per-story retry-after timestamps for a failed automatic timeline window. */
  private timelineBackoff = new Map<string, { from: number; until: number }>()
  /** Consecutive timeline-director failures per story; drives exponential backoff and the fuse. */
  private timelineDirectorFailures = new Map<string, number>()
  stickerById = new Map<string, StickerAsset>()
  stickerScanRunning = false
  /**
   * 同一故事的用户消息、到期意图和后台压缩必须串行。否则“用户新消息
   * 取消旧延迟回复”可能与定时发送同时发生，造成过期消息仍被发出。
   */
  private queues = new Map<string, Promise<unknown>>()
  turnEngine!: TurnEngine   // P0: 回合状态管理已抽出至 turn-engine.ts；D2 起适配器读取 turns 做会话引用判定，可见性放宽
  private scheduler!: Scheduler     // P1: 到期唤醒/独占任务/指纹冷却已抽出至 scheduler.ts
  /** 端点注册表内存缓存（M1a）：行来自 interlude_endpoint；状态为进程内三维时效。 */
  private endpointRows: EndpointRow[] = []
  private endpointStates = new Map<string, EndpointState>()
  endpointStateWriteQueue: Promise<unknown> = Promise.resolve()
  private endpointRegistryReady = false
  /** M1b 剧本别名缓存（interlude_story_alias），随注册表一同加载。 */
  storyAliasRows: StoryAliasRecord[] = []
  /** M2 §1.3：入站接收序号（进程内单调递增；双端点回合排序依据）。 */
  inboundSeq = 0
  private storyAliasProblems = new Set<string>()

  bufferedGroupTurns = new Map<string, BufferedGroupTurn>()  // 复审 R2：适配器读取群回合句柄做会话引用判定，可见性放宽
  /** Short-lived group-member display names. QQ number remains the stable key. */
  groupMemberNameCache = new Map<string, { name: string, expiresAt: number }>()
  groupMemberNameLookups = new Map<string, Promise<string>>()
  /** Ephemeral, per-group willingness score. It never touches private turns or durable story state. */
  private groupWillingness = new Map<string, GroupWillingnessState>()
  /** Synchronously marks a relationship whose current typing chain was interrupted by new input. */
  private interruptedTypingParticipants = new Set<string>()
  /** Prevent a background life turn from racing an unlocked live model call. */
  factBackfills = new Set<string>() // P5：压缩管线经宿主引用读写
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
  compactionSweepRunning = false // P5：压缩管线经宿主引用读写
  /** Startup/sweep compensation for durable pending script deliveries. The
   * backoff is process-local; the delivery ledger remains the source of truth
   * across restarts. */
  private pendingDeliveryRecoveryRunning = false
  /** Same authored event has one executor through transport AND confirmation. */
  deliveryExecutors = new Set<string>() // P2：投递管线经宿主引用读写（执行器去重）
  /** Known platform successes survive a local confirmation failure in this process. */
  private acceptedDeliveries = new Map<string, OutgoingMessageDraft>()
  private pendingDeliveryRecoveryBackoff = new Map<string, { attempts: number, retryAt: number }>()
  private blindModeHealthIssue = false
  /** Console reload creates a new service instance, so normalized config can
   * be cached safely for the lifetime of this instance. */
  private cachedAudioConfig?: AudioConfig
  private cachedStickerConfig?: StickerLibraryConfig
  private cachedHarvestConfig?: StickerHarvestConfig
  /** 表情包采集运行时（锁外旁路；重载重建、计数归零）。 */
  harvestStore?: StickerHarvestStore
  readonly harvestQuota = new DailyQuotaTracker()
  harvestJudge?: OpenAICompatibleNarrator
  harvestLibraryHashes?: Set<string>
  harvestScanRunning = false
  /** 判定失败计数（跨扫描周期累计，≥3 按丢弃处理，防毒图无限重试）。 */
  readonly harvestAttempts = new Map<string, number>()
  /** 考据 Agent 运行时：每故事一张案头（内存工作台，重载清空）。 */
  readonly researchDesks = new Map<string, ResearchDesk>()
  /** 对话密度轨迹（auto 条目预算的信号源；重载归零，30 分钟窗口）。
   * 惰性初始化——原型宿主（测试）没有类字段。 */
  private contextDensityTracker?: ConversationDensityTracker
  private get contextDensity(): ConversationDensityTracker {
    return this.contextDensityTracker ??= new ConversationDensityTracker()
  }
  private cachedContextEntryConfig?: ContextEntryAutoConfig
  researchNarrator?: OpenAICompatibleNarrator
  private researchToolsRegistry?: ResearchToolRegistry
  private cachedResearchConfig?: ResearchConfig
  private cachedAlterSystemConfig?: AlterSystemConfig
  private cachedAgencyConfig?: AgencyConfig
  private cachedDeliveryPolicyConfig?: DeliveryPolicyConfig
  private cachedSchedulePreplanConfig?: SchedulePreplanConfig
  private cachedBlindModeConfig?: BlindModeConfig
  private cachedModelCaptureConfig?: ModelCaptureConfig
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
  desktopDeliveryHandler?: (delivery: {
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
  }) => Promise<{ ok: boolean, messageIds?: string[], error?: string, /** true = 请求已写出但结果不可知（宿主 echo 超时/桥关闭），按 pending 补偿而非终态失败。 */ transportTimeout?: boolean }>

  /** W3（C2-1）：桥接动作代理出口——desktop-bridge 安装后非空；普通 Koishi 恒空。
   * qzoneCaller 与 sendSticker 桌面模式经此调用宿主代调上游 OneBot 动作。 */
  desktopOnebotActionHandler?: (input: { accountKey: string, action: string, params?: Record<string, unknown>, timeoutMs?: number }) => Promise<{ ok: boolean, data?: unknown, errorCode?: string, ambiguous?: boolean, error?: string }>

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
    // 实验性微调数据采集：仅主叙事 narrator 持有 sink；写盘失败只降级采集本身。
    const modelCaptureDirectory = this.modelCaptureConfig.enabled ? resolve(ctx.baseDir, this.modelCaptureConfig.directory) : ''
    const modelCapture = this.modelCaptureConfig.enabled ? new ModelCaptureSink(modelCaptureDirectory, this.serviceLogger) : undefined
    if (modelCapture) this.serviceLogger.info('主叙事微调数据采集已开启 目录=%s（按天分 JSONL，仅记录解析成功的往返）', modelCaptureDirectory)
    this.narrator = createNarrator(ctx, config.model, this.blindModeConfig.enabled, onUsage, this.modelRouting, modelCapture)
    // 表情包采集：暂存存储与判定客户端（复用表情包识别连接），纯锁外旁路。
    if (this.stickerHarvestActive) {
      this.harvestStore = new StickerHarvestStore(resolve(ctx.baseDir, this.harvestConfig.stagingDirectory), this.serviceLogger)
      this.harvestJudge = new OpenAICompatibleNarrator(ctx, config.model, this.blindModeConfig.enabled, onUsage)
      this.reportStandaloneOperation('standard', 'info', '表情包采集已开启 暂存目录=%s（判定走表情包识别连接；保留表情自动进入表情库）', this.harvestConfig.stagingDirectory)
    }
    if (this.researchActive) {
      this.researchNarrator = new OpenAICompatibleNarrator(ctx, config.model, this.blindModeConfig.enabled, onUsage)
      this.researchToolsRegistry = new ResearchToolRegistry(ctx)
      this.reportStandaloneOperation('standard', 'info', '考据 Agent 已开启（应答式：她承诺去查 → 后台核实 → 案头供作者参考）')
    }
    this.compactor = createCompactor(ctx, config.model, this.blindModeConfig.enabled, onUsage, this.modelRouting)
    this.embedder = createEmbedder(ctx, config.model, this.modelRouting)
    // D2：平台端口（QQ/OneBot 首个实现；包装本类既有方法，行为零变化）。
    this.platform = new OneBotAdapter(this)
    // 静默降级显性化：embedding 已启用但路由不可用（模型中心未勾选
    // “用作 Embedding”且未显式配置模型）时，embedder 是返回空向量的哑对象，
    // 语义检索全程退化为规则排序——此前无任何日志，排障完全不可见。
    // 每次插件加载提示一次，修好配置前不刷屏。
    const embeddingDegraded = embeddingDegradationNotice(config.model, this.modelRouting)
    if (embeddingDegraded) this.reportStandaloneOperation('standard', 'warn', embeddingDegraded)
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
    bindActiveServiceForEndpoints(this)  // M2：sameParticipantEndpoint 集合匹配读注册表
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
      void this.syncCurrentBotConnections().catch((): undefined => undefined)
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
    if (this.stickerHarvestActive) {
      // 首轮延迟 15 秒给启动期让路；空暂存零模型调用。
      this.ctx.setTimeout(() => void this.runStickerHarvestScan(), 15_000)
      this.ctx.setInterval(() => void this.runStickerHarvestScan(), this.harvestConfig.scanIntervalMinutes * Time.minute)
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
    const owner = splits.find((intent: any) => {
      const ref = restoreMessageEvent(intent.payload, current.content)
      return ref?.scriptEntryId === entry.id && ref.commitId === current.commitId
        && ref.eventId === current.eventId && ref.bubbleIndex === current.segmentIndex
    })
    if (!this.taskGenerationCurrent(story.id, generation)) return 'pending'
    if (owner?.status === 'pending') {
      await this.scheduleNextPendingWake(story.id)
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
  puppeteerHintLogged = false
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
  deadImageSources = new Map<string, string>()
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
    if (!story) return { storyId: '', entries: [] as ScriptEntry[], scenes: [] as InterludeScene[], facts: [] as NarrativeFact[] }
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

  groupRule(groupId: string) {
    const normalized = normalizeGroupId(groupId)
    const found = (this.config.onebot?.groupChats ?? []).find(group => group.enabled !== false && normalizeGroupId(group.groupId) === normalized)
    if (!found) return undefined
    // 热身 B 的运行时归一仅作迁移前的兜底——F7：一次性迁移标志落库后
    // （config.onebot.willingnessPresetMigrated），用户显式选择的 off 稳定
    // 表达关闭，不再被改写为 custom。
    const base = this.config.onebot?.willingnessPresetMigrated === true ? found : normalizeWillingnessPreset(found)
    // I-6b：三维度（采集/触发/后台参与）在此归一——缺省由 responseMode
    // 派生，显式维度逐维优先（消费点另做防御式解析，见 group-dimensions.ts）。
    return { ...base, ...resolveGroupDimensions(base) }
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
            // 例外：注册表为空（database clear 之后或全新部署）时 miss 不构成
            // 陌生账号证据——没有任何故事存在，autoCreate 随即接管建本。
            const knownDeployment = this.endpointRows.some(row => row.ownerKind === 'story-role')
            const warnKey = `unknown-account:${session.platform}:${session.selfId}`
            if (knownDeployment && !this.storyAliasProblems.has(warnKey)) {
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
  /** 四类原始聊天行——advance 相位在查询阶段即排除（F6：生活席位上游独立
   * 选取；此前的"先限量查询后过滤"会让群刷屏把 script 挤出候选集）。 */
  private static readonly CHAT_ENTRY_KINDS = ['user-message', 'character-message', 'group-message', 'character-group-message'] as const

  private async recentEntriesForPrompt(storyId: string, now: Date, budget?: { count: number, minutes: number, mode: 'fixed' | 'auto' }, options?: { excludeChatKinds?: boolean }) {
    const resolved = budget ?? resolveScriptContextBudget(this.config.runtime)
    const { count, minutes } = resolved
    // F6：排除条件下推到查询（minato/sqlite 均支持 $nin）——生活条目的席位
    // 不再被聊天行在查询阶段挤占；调用侧的查询后过滤保留为防御。
    const query = options?.excludeChatKinds
      ? { storyId, kind: { $nin: [...InterludeService.CHAT_ENTRY_KINDS] } }
      : { storyId }
    const [countRows, timeRows] = await Promise.all([
      this.dbGet('interlude_script_entry', query, { limit: count, sort: { occurredAt: 'desc' } }),
      minutes > 0
        ? this.dbGet('interlude_script_entry', { ...query, occurredAt: { $gte: new Date(now.getTime() - minutes * Time.minute) } }, { limit: 500, sort: { occurredAt: 'desc' } })
        : Promise.resolve([] as ScriptEntry[]),
    ])
    const byId = new Map<number, ScriptEntry>()
    // 墓碑不进 prompt——recentEntries 有同款过滤（批次 4 契约），此处是真正的
    // 主入口，缺过滤会让管理员删除/清库留下的占位文本进入模型上下文。
    for (const entry of [...countRows, ...timeRows]) {
      if (entry.kind === 'redacted') continue
      byId.set(entry.id, entry)
    }
    // 方案 A：auto 模式下生效条目数是硬上限——时间窗并入的条目同样受约束，
    // 超出时从最旧端裁剪（保留贴近决策点的最新内容）。fixed 模式维持并集语义。
    if (budget?.mode === 'auto' && byId.size > count) {
      const ordered = [...byId.values()].sort((left: any, right: any) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id - right.id)
      for (const entry of ordered.slice(0, ordered.length - count)) byId.delete(entry.id)
    }
    return [...byId.values()].sort((left: any, right: any) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id - right.id)
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
      importance: 0.8, confidence: 1, unresolved: false, embedding: await this.embedText(text, { purpose: '管理员事实', density: 'diagnostic' }),
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
    reportContactPlanUpdate(this, intent, 'cancelled', 'admin-cancel')
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
    // Space audit and experimental works share the story's content lifetime.
    // The global directory-backed sticker library remains reusable across resets.
    for (const table of ['interlude_qzone_post', 'interlude_work'] as const) {
      await this.purgeTable(table, { storyId }, (row: Record<string, any>) => cleanupPayload(table, row))
    }
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
    // Global directory-backed sticker assets survive runtime clearing.
    const tables = RUNTIME_TABLES
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
          const key = cleanupKey(table, row)
          const fallback = cleanupPayload(table, row, table === 'interlude_story' ? this.initialStorySetting() : undefined)
          try {
            await this.dbSet(table, key, fallback)
            logicallyCleared++
          } catch (setError) {
            // 逻辑清空单行失败只跳过该行：清空的语义是尽量撤下旧内容，
            // 一行写失败不应中断其余行与后续表的清理。
            this.reportStandalone('warn', 'SQLite 逻辑清空单行失败，跳过 表=%s 键=%s 错误=%s', table, JSON.stringify(key), setError)
          }
        }
      }
    }
    // 端点注册表与剧本别名的内存快照随全库清理一并失效。先等在途 reconcile
    // 结束，防止它晚到把旧行和 ready 标志写回刚重置的状态；随后清零注册表、
    // 别名与告警去重集合并置 not-ready——下一条消息经 ensureEndpointRegistry
    // 从空库重建，autoCreate 建故事后正常登记，全程不再误报陌生账号。
    if (this.endpointRegistryInFlight) await this.endpointRegistryInFlight.catch(() => {})
    this.endpointRows = []
    this.endpointStates.clear()
    this.storyAliasRows = []
    this.storyAliasProblems.clear()
    this.endpointRegistryReady = false
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
      const sourced = (fact.sourceEntryIds ?? []).some((id: number) => entryIds.has(id))
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
    return receiveGroup(this, session, receivedAt)
  }
  async receive(session: Session, receivedAt?: Date) {
    return receive(this, session, receivedAt)
  }
  async groupSenderName(groupId: string, userId: string, session: Session) {
    return groupSenderName(this, groupId, userId, session)
  }
  async lookupGroupMemberName(cacheKey: string, groupId: string, userId: string, selfId: string) {
    return lookupGroupMemberName(this, cacheKey, groupId, userId, selfId)
  }
  bufferGroupMessage(story: InterludeStory, rule: GroupChatRule, session: Session, message: GroupMessageContext, mentionedBot: boolean, quotedBot: boolean, audioSources: string[] = [], imageSources: string[] = [], endpointId?: string) {
    const key = `${story.id}:${normalizeGroupId(rule.groupId)}`
    const existing = this.bufferedGroupTurns.get(key)
    const turn: BufferedGroupTurn = existing ?? {
      storyId: story.id, groupId: normalizeGroupId(rule.groupId), rule,
      channelId: session.channelId, messages: [], revision: 0, mentionedBot: false, quotedBot: false,
    }
    if (turn.timer) turn.timer()
    turn.channelId = session.channelId
    // 审计修正：复用中的群 turn 刷新规则快照——模型在途期间用户改配置
    //（维度/档位）后，排队批次按新规则评估，不再等到下一批才生效。
    turn.rule = rule
    turn.latestHandle = session ? this.platformPort.adoptSession(session) : undefined
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
    // I-4 自适应防抖：会话态缩短（正盯着群，连发很快合并完就写），冷态放长
    // （不在看，多攒几条成一个事件）；静默窗口 0.3–3s，当前批次最多合并 3s。
    const baseDelay = Math.max(0, rule.debounceSeconds ?? 1) * Time.second
    const sessionActive = this.groupSessionActiveCached(story.id, normalizeGroupId(rule.groupId))
    const quietMs = Math.min(3_000, Math.max(300, sessionActive ? baseDelay * 0.5 : baseDelay * 1.5))
    const delay = boundedDebounceDelay(turn, quietMs, 3_000)
    turn.timer = this.ctx.setTimeout(() => void this.flushGroupTurn(key, revision), delay)
    this.bufferedGroupTurns.set(key, turn)
  }

  private async flushGroupTurn(key: string, revision: number) {
    const turn = this.bufferedGroupTurns.get(key)
    if (!turn || turn.revision !== revision) return
    if (this.databaseResetting || this.desktopRuntimePhase === 'paused') {
      // 暂停期间入站仍会缓冲并重臂定时器；触发后的死句柄若保持真值，
      // 恢复循环会误判"仍有活定时器"而跳过补排，批次搁浅到下一条消息。
      if (turn.timer) turn.timer = undefined
      return
    }
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

  /** D3b：群聊执行体已迁出至 narrative/turn-executor.ts（行为不变）；同名薄委托。 */
  private async flushGroupTurnUnlocked(key: string, turn: BufferedGroupTurn) {
    return executeGroupNarrativeTurn(this, key, turn)
  }
  /** D3b：群执行体迁出后经宿主调用。 */
  async groupMessages(storyId: string, groupId: string, limit: number): Promise<GroupMessagesSnapshot> {
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
    imageRefs.sort((left: any, right: any) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.sourceEntryId - left.sourceEntryId || right.ordinal - left.ordinal)
    return { messages, imageRefs }
  }

  /** D3b：群执行体迁出后经宿主调用。 */
  async loadHistoricalGroupImages(story: InterludeStory, refs: StoredGroupImageRef[], limit: number, session?: Session, currentSources: string[] = []): Promise<NarrativeHistoricalImage[]> {
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

  async groupCooldownActive(storyId: string, groupId: string, cooldownSeconds: number) {
    return groupCooldownActive(this, storyId, groupId, cooldownSeconds)
  }
  groupChatCapabilities(session: Session | undefined, messages: GroupMessageContext[]): ChatActionCapabilities | undefined {
    return groupChatCapabilities(this, session, messages)
  }
  privateChatCapabilities(session: Session | undefined): ChatActionCapabilities | undefined {
    return privateChatCapabilities(this, session)
  }
  async executeGroupReactions(
    story: InterludeStory,
    session: Session,
    groupId: string,
    reactions: ExecutableMessageReaction[],
    referenceFor?: (reaction: ExecutableMessageReaction) => ScriptDeliveryReference | undefined,
  ) {
    return executeGroupReactions(this, story, session, groupId, reactions, referenceFor)
  }
  resolveSticker(draft: LocalMediaDraft | undefined, catalog: StickerCatalogEntry[]) {
    return resolveSticker(this, draft, catalog)
  }
  get expressionThreshold() {
    return normalizeExpressionThreshold(this.config.chatActions?.expressionThreshold)
  }

  resolveNativeFace(decision: NarrativeDecision, capabilities: ChatActionCapabilities | undefined): NativeFaceSemantic | undefined {
    return resolveNativeFace(this, decision, capabilities)
  }
  async sendSticker(
    story: InterludeStory,
    session: Session,
    channelId: string,
    asset: StickerAsset,
    groupId?: string,
    reference?: ScriptDeliveryReference,
  ) {
    return sendSticker(this, story, session, channelId, asset, groupId, reference)
  }
  async sendNativeFace(
    story: InterludeStory,
    session: Session,
    channelId: string,
    semantic: NativeFaceSemantic,
    groupId?: string,
    reference?: ScriptDeliveryReference,
  ) {
    return sendNativeFace(this, story, session, channelId, semantic, groupId, reference)
  }
  async sendGroupMessage(story: InterludeStory, channelId: string, content: string, replyToMessageId?: string, session?: Session, endpointId?: string, correlation?: Pick<OutgoingMessageDraft, 'traceId' | 'processingId'>, control?: { shouldCancel: () => boolean; settled: Map<number, GroupDeliveryResult['segmentOutcomes'][number]['status']>; onDelivered: (index: number, content: string) => void }) {
    return sendGroupMessage(this, story, channelId, content, replyToMessageId, session, endpointId, correlation, control)
  }
  /**
   * Persisted messages wait here briefly before they reach the narrator. This
   * makes “你好 / 在吗 / 我有件事想问” one event without risking message loss.
   */
  bufferUserNarrative(story: InterludeStory, participant: InterludeParticipant, session: Session, now: Date, supersededIntents: NarrativeIntent[], content = String(session.content ?? ''), imageSources: string[] = [], audioSources: string[] = [], quote?: QuotedMessageContext, endpointId?: string) {
    // D1（解耦设计 §6）：回合状态只存中性句柄；session 经通道键登记到
    // 适配器解析表（同通道后写覆盖前写 = 旧"最后一条消息的会话"语义）。
    const handle: TurnHandle = {
      platform: String(session.platform ?? ''),
      channelId: String(session.channelId ?? ''),
      ...(session.selfId != null ? { selfId: String(session.selfId) } : {}),
      ...(endpointId ? { endpointId } : {}),
    }
    // 复审 R3：先建回合引用（引擎落 latestHandle）、再登记会话——登记内的
    // 回收此时能看到本回合引用；适配器侧另有新键保护双保险。
    this.turnEngine.bufferUserNarrative(story, participant, handle, now, supersededIntents, content, imageSources, audioSources, quote, (key, revision) => void this.flushBufferedNarrative(key, revision), endpointId)
    this.platformPort.rememberSession(handle, session)
  }

  /** D2（解耦设计 §6）：平台端口——私聊回合执行体的全部平台调用经此发出。
   * 真实实例构造器赋值；原型测试宿主经 getter 惰性创建（包装不搬移：
   * 适配器委托本类既有方法，函数本体与锁相位零改动）。 */
  private platform?: PlatformAdapter

  private get platformPort(): PlatformAdapter {
    return this.platform ??= new OneBotAdapter(this)
  }

  signalIncomingInterruption(story: InterludeStory, participant: InterludeParticipant) {
    this.interruptedTypingParticipants.add(participant.id)
    this.turnEngine.signalIncomingInterruption(story, participant)
  }

  /** Experimental streaming path: only a complete, validated private reply
   * may leave early. It commits the existing interruption boundary at the
   * same moment as ordinary first-message delivery. */
  /** D2：经 PlatformAdapter 调用（适配器解析句柄后转发至此）；可见性
   * 因此自 private 放宽——函数本体不动。 */
  async deliverEarlyPrivateReply(
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
  describeUserEvent(story: InterludeStory, session: Session, forward?: ForwardReadResult) {
    return describeUserEvent(this, story, session, forward)
  }
  async readForward(session: Session): Promise<ForwardReadResult | undefined> {
    return readForward(this, session)
  }
  /** 表情包采集入站口：门控（总开关+聊天类型+每群规则）→ 配额 → 下载 →
   * 三重去重（丢弃记忆/暂存/表情库哈希）→ 暂存。任何失败静默跳过。 */
  async tryHarvestStickers(session: Session, chatType: 'private' | 'group', sources: string[], rule?: GroupChatRule): Promise<void> {
    return tryHarvestStickers(this, session, chatType, sources, rule)
  }
  /** 表情库哈希索引（懒加载缓存；判定入库后失效重建）。 */
  async harvestLibraryHashIndex(): Promise<Set<string>> {
    return harvestLibraryHashIndex(this)
  }
  /** 周期判定：表情包识别连接看图裁决暂存表情；保留的移入表情库 keptSubfolder
   * 子目录，由既有 scanStickerLibrary（5 分钟轮询）自动编目与描述。 */
  async runStickerHarvestScan(): Promise<void> {
    return runStickerHarvestScan(this)
  }
  /** 判定失败累计；≥3 次按丢弃处理，防止无法判定的图片每轮重试浪费调用。 */
  noteHarvestFailure(hash: string, detail: string): void {
    return noteHarvestFailure(this, hash, detail)
  }
  /** interlude.stickerharvest.status 的只读输出。 */
  async stickerHarvestStatusLines(): Promise<string[]> {
    return stickerHarvestStatusLines(this)
  }
  async scanStickerLibrary() {
    return scanStickerLibrary(this)
  }
  /** 表情包投递基址：显式配置 > Koishi selfUrl > 本机默认端口。 */
  stickerDeliveryBase() {
    return stickerDeliveryBase(this)
  }
  /** 表情包 HTTP 回源路由：OneBot 实现（NapCat/Lagrange）分容器时经此下载文件。
   * 仅服务素材库内、资产表登记过的文件；assetId 即查询键，无目录穿越面。 */
  registerStickerRoute() {
    return registerStickerRoute(this)
  }
  stickerRouteRegistered = false

  async refreshStickerCatalog() {
    return refreshStickerCatalog(this)
  }
  semanticStickerEmbeddingEnabled() {
    return semanticStickerEmbeddingEnabled(this)
  }
  /** Vectorize described-but-unindexed sticker assets in the background. The
   * batch stays small so one scan cannot spend more than a handful of calls. */
  async backfillStickerEmbeddings() {
    return backfillStickerEmbeddings(this)
  }
  async stickerCatalogForSession(session: Session | undefined, turnQueryEmbedding?: number[]): Promise<StickerCatalogEntry[]> {
    return stickerCatalogForSession(this, session, turnQueryEmbedding)
  }
  /** Semantically narrow the sticker catalog to the entries most relevant to the
   * live message. Falls back to the full catalog whenever the feature is off,
   * the turn has no query vector, or the catalog is below the limit. */
  async rankStickerAssets(turnQueryEmbedding?: number[]): Promise<StickerAsset[]> {
    return rankStickerAssets(this, turnQueryEmbedding)
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
  async recallHistory(
    storyId: string,
    participantId: string,
    query: string,
    turnQueryEmbedding: number[],
    excludeIds: Set<number>,
    preferredEntryIds = new Set<number>(),
    maxResults = 3,
  ): Promise<RecalledMoment[]> {
    return recallHistory(this, storyId, participantId, query, turnQueryEmbedding, excludeIds, preferredEntryIds, maxResults)
  }
  /** Load every recallable entry of one story into the recall cache. The load is
   * deliberately whole-table (no time window): older memories stay retrievable,
   * and the per-process cache makes the cost one-off per story. */
  async ensureHistoryVectors(storyId: string) {
    return ensureHistoryVectors(this, storyId)
  }
  /** Drop in-memory copies whenever their source rows are removed or redacted.
   * The next recall reloads only the surviving database rows. */
  invalidateHistoryVectors(storyId?: string) {
    return invalidateHistoryVectors(this, storyId)
  }
  /** Background vectorization for semantic history recall. Newest entries go
   * first so live-recall quality ramps up quickly; the whole table is covered
   * gradually over successive maintenance passes. */
  async backfillHistoryEmbeddings(storyId: string) {
    return backfillHistoryEmbeddings(this, storyId)
  }
  /** Download voice records as native audio attachments. QQ voice is SILK,
   * which multimodal models cannot read, so SnowLuma's get_record action is
   * always asked to transcode server-side (out_format) and return base64.
   * Mirrors the native-image acquisition path; nothing is persisted. */
  async loadNativeAudio(story: InterludeStory, sources: string[], session?: Session, maxCount = this.audioConfig.maxPerMessage): Promise<NarrativeAudio[]> {
    return loadNativeAudio(this, story, sources, session, maxCount)
  }
  async fetchNativeAudio(source: string, session?: Session): Promise<{ format: string, base64: string } | undefined> {
    return fetchNativeAudio(this, source, session)
  }
  describeVisionEvent(session: Session) {
    return describeVisionEvent(this, session)
  }
  async loadNativeImages(story: InterludeStory, sources: string[], session?: Session): Promise<NarrativeImage[]> {
    return loadNativeImages(this, story, sources, session)
  }
  /** Sidecar vision mirrors native image acquisition, but sends only its
   * factual result into the text narrator's current event. */
  async describeCurrentImages(story: InterludeStory, images: NarrativeImage[], userMessage: string | undefined) {
    return describeCurrentImages(this, story, images, userMessage)
  }
  isExpiredImageSource(source: string) {
    return isExpiredImageSource(this, source)
  }
  /** 已判死来源的首次失败原因（未判死返回 undefined）。 */
  deadImageSourceReason(source: string) {
    return deadImageSourceReason(this, source)
  }
  rememberDeadImageSource(source: string, reason: string) {
    return rememberDeadImageSource(this, source, reason)
  }
  async fetchNativeImage(source: string, bot?: any, adapterProvided = false): Promise<{ mimeType: string, dataUri: string } | undefined> {
    return fetchNativeImage(this, source, bot, adapterProvided)
  }
  /** QQ CDN 媒体 URL 会 302 跳转（SnowLuma stream-download 同款结论），
   * 原先的 redirect:'error' 把每一跳都变成非过期错误：不入负缓存、每轮
   * 重复失败。改为手动逐跳跟随（至多 3 跳），每跳按入口同一规则校验
   * 目标域，保住 SSRF 边界；跳向不受信域视为确定性失败判死。 */
  async fetchImageThroughRedirects(url: URL, adapterProvided: boolean): Promise<{ data: ArrayBuffer, headers: { get(name: string): string | null } }> {
    return fetchImageThroughRedirects(this, url, adapterProvided)
  }
  async fetchNativeImageUncached(source: string, bot?: any, adapterProvided = false): Promise<{ mimeType: string, dataUri: string } | undefined> {
    return fetchNativeImageUncached(this, source, bot, adapterProvided)
  }
  /** Convert adapter/fetched bytes into one bounded native-vision attachment.
   * Animated stickers are rendered to a representative PNG frame when the
   * optional Puppeteer service is available; otherwise the original image is
   * still passed through rather than inventing a description. */
  async imageBytesToNative(bytes: Buffer, mimeType: string): Promise<{ mimeType: string, dataUri: string } | undefined> {
    return imageBytesToNative(this, bytes, mimeType)
  }
  /** Re-render a static image through Puppeteer capped at the configured vision
   * dimension. Multimodal providers tile large images into many tokens, so a
   * bounded re-encode saves both upload time and per-turn token cost; the
   * browser also applies EXIF orientation, fixing rotated phone photos. */
  async downscaleImageForVision(image: { mimeType: string, dataUri: string }): Promise<{ mimeType: string, dataUri: string } | undefined> {
    return downscaleImageForVision(this, image)
  }
  async renderAnimatedImageFrame(dataUri: string) {
    return renderAnimatedImageFrame(this, dataUri)
  }
  /** Prevent timers or already-returning model calls from resurrecting data
   * after an administrator resets the story or clears HDSI tables. */
  private invalidateBufferedNarratives(storyId?: string) {
    this.scheduler.clearBackoff(storyId)
    this.turnEngine.invalidateNarratives(storyId)
    // 审计 F3：失效后回收无引用会话（D2 起经适配器）。
    this.platformPort?.pruneSessions(32)
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
    if (storyId) this.researchDesks?.delete(storyId)
    else this.researchDesks?.clear()
    this.researchDueIntents = storyId
      ? this.researchDueIntents?.filter(intent => intent.storyId !== storyId)
      : undefined
    for (const key of this.acceptedDeliveries.keys()) {
      if (!storyId || JSON.parse(key)[0] === storyId) this.acceptedDeliveries.delete(key)
    }
    if (storyId) this.storyTaskGenerations.set(storyId, (this.storyTaskGenerations.get(storyId) ?? 0) + 1)
    else this.runtimeGeneration += 1
  }

  rememberIncomingMessage(key: string) {
    this.seenIncomingMessages.set(key, Date.now())
    if (this.seenIncomingMessages.size > 600) this.seenIncomingMessages.delete(this.seenIncomingMessages.keys().next().value!)
  }

  // Pause cancels new work, but cannot erase a known platform acceptance.
  // Reset/purge invalidate both tasks and receipts through the content generation.
  private deliveryGeneration(storyId: string) {
    return `${this.runtimeGeneration ?? 0}:${this.storyTaskGenerations?.get(storyId) ?? 0}`
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

  /** D3a：执行体已迁出至 narrative/turn-executor.ts（行为不变）；保留
   * 同名薄委托，既有调用点与全部测试零改动。 */
  private async flushBufferedNarrative(key: string, revision: number) {
    return executePrivateNarrativeTurn(this, key, revision)
  }

  async advanceStory(story: InterludeStory, force = true) {
    if (this.desktopRuntimePhase === 'paused') return []
    if (!this.canHandleStory(story)) return []
    const generation = this.taskGeneration(story.id)
    const messages = await this.serial(story.id, async () => this.advanceUnlocked(await this.getStory(story.id), new Date(), force, generation))
    // 审计修复 #4：到期考据在故事串行队列外执行，不阻塞后续用户回合。
    const researchQueue = this.researchDueIntents ?? []
    const dueResearch = researchQueue.filter(intent => intent.storyId === story.id)
    this.researchDueIntents = researchQueue.filter(intent => intent.storyId !== story.id)
    for (const intent of dueResearch) {
      if (!this.taskGenerationCurrent(story.id, generation)) break
      const storyNow = await this.getStory(intent.storyId).catch((): undefined => undefined)
      if (storyNow && this.taskGenerationCurrent(story.id, generation)) await this.executeResearchIntent(storyNow, intent, new Date())
    }
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
    return compactStory(this, story, force)
  }
  /** Merge and compress already-applied overlay patches without running the
   * full scene/fact compaction pass. This is safe for manual maintenance. */
  async compactOverlay(story: InterludeStory) {
    return compactOverlay(this, story)
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
    if (this.desktopBridgeActive) return
    return offlineGroupCatchup(this)
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
        if (pendingDue.some((intent: any) => intent.type === 'split-message')) await this.deliverDueSplitSegments(story.id)
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

  /** I-2 待叙事显著度（内存态，重载即清——与 groupWillingness 同生命周期）：
   * storyId → groupId → 状态。纯函数模块见 narrative/narrative-salience.ts。
   * 惰性初始化以兼容原型测试宿主（issue #5 桩防御惯例）。 */
  private groupNarrativeSalience?: Map<string, Record<string, GroupSalienceState>>

  private salienceStore(): Map<string, Record<string, GroupSalienceState>> {
    return this.groupNarrativeSalience ??= new Map()
  }

  /** 门拦截批次累积显著度（executor 调用；批键去重、上限封顶在纯函数内）。 */
  recordNarrativeSalience(storyId: string, groupId: string, input: { turnRelated: boolean, batchKey?: string }): void {
    const store = this.salienceStore()
    const states = store.get(storyId) ?? {}
    store.set(storyId, recordBlockedBatch(states, groupId, { ...input, now: Date.now() }))
  }

  /** I-3 共享注意力：私聊近期是否有活跃对话（她在跟人认真说话）——
   * 只读查询最近 5 分钟内的 user-message 条目；尽力而为。 */
  async privateAttentionBusy(storyId: string, now = new Date()): Promise<boolean> {
    try {
      const rows = await this.dbGet('interlude_script_entry', {
        storyId, kind: 'user-message',
        occurredAt: { $gte: new Date(now.getTime() - 5 * Time.minute) },
      }, { limit: 1, sort: { occurredAt: 'desc' } }) as any[]
      return rows.length > 0
    } catch {
      return false
    }
  }

  /** I-4 事实性时间线索：群批次的事实性时间背景（供群执行体注入 userMessage
   * 头部）。两个事实——群安静时长与她上次发言距今——均来自已确认记录。 */
  async groupFactualTimeCues(storyId: string, groupId: string, now: Date, batch: Array<{ occurredAt?: Date }>): Promise<string> {
    try {
      const normalized = normalizeGroupId(groupId)
      if (!normalized) return ''
      const cues: string[] = []
      // 本批次最早消息与群上一条消息的间隔 → 安静时长。
      const batchEarliest = batch?.map(message => toDate(message.occurredAt)).filter(Boolean).sort((left: any, right: any) => left.getTime() - right.getTime())[0]
      if (batchEarliest) {
        const previous = await this.dbGet('interlude_script_entry', {
          storyId, kind: 'group-message',
          'metadata.groupId': { $in: groupIdStorageVariants(normalized) },
          occurredAt: { $lt: batchEarliest },
        }, { limit: 1, sort: { occurredAt: 'desc' } }) as any[]
        const prevTime = previous[0]?.occurredAt ? toDate(previous[0].occurredAt) : undefined
        if (prevTime) {
          const gapMs = batchEarliest.getTime() - prevTime.getTime()
          if (gapMs >= 60 * Time.minute) cues.push(`[事实] 群里安静了约 ${Math.round(gapMs / Time.minute)} 分钟后有人说话`)
        }
      }
      // 她上次群发消息距今。
      const hers = await this.dbGet('interlude_script_entry', {
        storyId, kind: 'character-group-message',
        'metadata.groupId': { $in: groupIdStorageVariants(normalized) },
        occurredAt: { $lte: now },
      }, { limit: 1, sort: { occurredAt: 'desc' } }) as any[]
      const herLast = hers[0]?.occurredAt ? toDate(hers[0].occurredAt) : undefined
      if (herLast) {
        const sinceMs = now.getTime() - herLast.getTime()
        if (sinceMs < 60 * Time.minute) cues.push(`[事实] 她约 ${Math.max(1, Math.round(sinceMs / Time.minute))} 分钟前刚在这个群发过言`)
        else if (sinceMs < 24 * Time.hour) cues.push(`[事实] 她上次在这个群发言是约 ${Math.round(sinceMs / Time.minute)} 分钟前`)
      }
      return cues.join('\n')
    } catch {
      return ''
    }
  }

  /** I-4 自适应防抖：缓存各群最近的会话活跃判定（bufferGroupMessage 是同步
   * 路径，不能查库；由 executor 在 flush 时刷新——F5 接线后仅在判定为 true
   * 时写入，查询失败不毒化）。会话态缩短合并窗口（她正盯着群），冷态放长
   * （反正不在看，多攒几条成一个事件更自然）。F5：值带写入时刻，读取按
   * groupSessionActive 同源的 30 分钟窗口过期——群安静后陈旧 true 不再长期
   * 影响防抖。 */
  private groupSessionActiveCache?: Map<string, { active: boolean, at: number }>

  private sessionActiveCache(): Map<string, { active: boolean, at: number }> {
    return this.groupSessionActiveCache ??= new Map()
  }

  noteGroupSessionActive(storyId: string, groupId: string, active: boolean): void {
    this.sessionActiveCache().set(`${storyId}:${groupId}`, { active, at: Date.now() })
  }

  groupSessionActiveCached(storyId: string, groupId: string): boolean {
    const cached = this.groupSessionActiveCache?.get(`${storyId}:${groupId}`)
    return cached?.active === true && Date.now() - cached.at <= 30 * Time.minute
  }

  /** I-7 观察性产出：读取故事的生活关注词状态（无则冷启动种子——现成结构，
   * 零模型调用；不写库，首个压缩评估后接管）。 */
  attentionWordState(story: InterludeStory): AttentionWordState {
    const existing = (decodeStoryState(story.state).extensions?.attention as AttentionWordState | undefined)
    if (existing?.version === 1) return existing
    const manual = (this.config.onebot?.groupChats ?? []).flatMap((rule: any) => rule.willingness?.keywords ?? []).map(String)
    return bootstrapAttentionWords(story.setting as any, manual)
  }

  /** I-7 状态命令的命中读取。 */
  attentionHitsFor(storyId: string): Array<{ groupId: string, terms: string[], at: number }> {
    return (this.attentionHitLog ?? []).filter(hit => hit.storyId === storyId)
  }

  /** I-7 观察性命中：群批次与生效词的匹配记录（内存环形，最近 20 条）。
   * 不接门控/显著度——回放确认质量后另行接入。 */
  private attentionHitLog?: Array<{ storyId: string, groupId: string, terms: string[], at: number }>
  recordAttentionHits(storyId: string, groupId: string, terms: AttentionWord[], now = Date.now()): void {
    if (!terms.length) return
    const log = this.attentionHitLog ??= []
    log.push({ storyId, groupId, terms: terms.map(word => word.term), at: now })
    if (log.length > 20) log.splice(0, log.length - 20)
    this.reportOperation('diagnostic', 'debug', { id: storyId, setting: { timezone: 'Asia/Shanghai' } } as any, 'user-message',
      '生活关注词命中（观察性，未接门控）群=%s 词=%s', groupId, terms.map(word => word.term).join('、'))
  }

  /** 瞥视调度：显著度过阈 → 计算瞥视时刻；仅当早于现有 nextAdvanceAt 且满足
   * 未来下界时写入（幂等：一旦写过更早时间，后续更晚的瞥视不再覆盖）。
   * 只提前不推后——rest/Preplan 等既有安排若本就更早则不动。 */
  async maybeScheduleSalienceGlance(storyId: string): Promise<void> {
    try {
      const states = this.groupNarrativeSalience.get(storyId)
      const score = maxSalienceScore(states, Date.now())
      if (score < DEFAULT_SALIENCE_CONFIG.triggerThreshold) return
      const updated = await this.serial(storyId, async () => {
        const story = await this.getStory(storyId)
        if (!story || story.status !== 'active') return false
        const state = decodeStoryState(story.state)
        const now = Date.now()
        // F4 修正：瞥视时刻 clamp 到"当前调度约束下能排出的最早推进时刻"
        // （Urge 路径含 slow 区间/休息窗口/五档节奏/设备减半；非 Urge 路径含
        // 休息窗口与基础间隔）——显著度只能在此之上提前，不得绕过更高优先
        // 级约束（slow+asleep/夜间休息不再被拽到分钟级）。
        const floor = this.salienceGlanceFloor(story, state, now)
        const glanceAt = new Date(Math.max(now + salienceGlanceDelayMs(score), floor.getTime()))
        const current = toDate(story.state.automation?.nextAdvanceAt)
        // 仅当瞥视早于现有计划，且不早于未来下界（F2 教训：绝不排过去时间）。
        if (current && current.getTime() <= glanceAt.getTime()) return false
        await this.dbSet('interlude_story', { id: storyId }, {
          state: encodeStoryState({ ...state, automation: { ...state.automation, nextAdvanceAt: glanceAt.toISOString() } }),
          // 审计修正：updatedAt 用真实当前时刻——未来时刻会扰动按 updatedAt
          // 排序/判旧的逻辑（瞥视时刻本身已写入 automation.nextAdvanceAt）。
          updatedAt: new Date(),
        })
        return glanceAt.toISOString()
      })
      if (updated) {
        const story = await this.getStory(storyId)
        this.reportOperation('diagnostic', 'info', story, 'advance',
          '待叙事显著度触发瞥视提前 分数=%s 瞥视=%s', score.toFixed(2), formatLogTime(new Date(updated as string), story.setting.timezone))
      }
    } catch { /* 尽力而为：瞥视失败不阻塞门路径 */ }
  }

  /** F4：瞥视的约束下界——复用既有调度仲裁按当前约束重排一次能得出的最早
   * 推进时刻（区间采样取下限），显著度提前不得越过它。尽力而为：计算失败
   * 退回瞥视最小延迟。 */
  private salienceGlanceFloor(story: InterludeStory, state: ReturnType<typeof decodeStoryState>, now: number): Date {
    try {
      const anchor = new Date(now)
      if (this.urgeConfig.enabled) {
        const urge = normalizeUrgeState(state.extensions?.urge, now)
        const rest = activeRestWindow(this.autoAdvanceConfig.restWindows, story.setting.timezone, anchor)
        const window = activeAgencyWindow(state.agencyWindow, anchor)
        const rhythmRaw = state.lifeRhythm
        const rhythm: UrgeRhythmInput | undefined = rhythmRaw
          ? { attention: rhythmRaw.attention, stale: lifeRhythmStale(rhythmRaw, now) } : undefined
        const planned = planUrge(urge, now, this.urgeConfig,
          rest ? 1 : 0,
          !!window && (window.deviceAccess !== 'available' || window.activityLoad === 'overloaded'),
          () => 0, rhythm)
        return new Date(planned.nextAdvanceAt)
      }
      const rest = activeRestWindow(this.autoAdvanceConfig.restWindows, story.setting.timezone, anchor)
      if (rest) return new Date(now + rest.minIntervalMinutes * 60_000)
      return new Date(now + Math.max(1, this.autoAdvanceConfig.intervalMinutes - this.autoAdvanceConfig.jitterMinutes) * 60_000)
    } catch {
      return new Date(now + DEFAULT_SALIENCE_CONFIG.glanceMinDelayMs)
    }
  }

  /** advance 成功后的覆盖消费（内容覆盖完全 / 概况覆盖×0.5）——由
   * commitGroupBackgroundCoverage 传入本轮呈现的群与覆盖类型。 */
  private consumeNarrativeSalienceOnAdvance(storyId: string, presented: Array<{ groupId: string, contentCovered: boolean }>): void {
    const states = this.groupNarrativeSalience?.get(storyId)
    if (!states || !Object.keys(states).length) return
    this.salienceStore().set(storyId, consumeSalience(states, presented, Date.now()))
  }

  /** 群触发回合成功：该群完全消费（executor 调用）。 */
  consumeNarrativeSalienceForGroup(storyId: string, groupId: string): void {
    this.consumeNarrativeSalienceOnAdvance(storyId, [{ groupId, contentCovered: true }])
  }

  /** 群触发回合成功：推进该群水位（通道共享覆盖）——取该群此刻最大
   * group-message 条目 id（她刚以当前事件身份处理过这批消息）。 */
  /** 群触发回合成功提交后推进水位。F3 修正：frozenMaxEntryId 是本回合冻结
   * 输入的最大条目 id（批次/群上下文 messageRef 解析）——查询此刻最新后
   * clamp 到该上界，模型在途期间到达的新消息不再被误标覆盖；无可解析 id
   * 时保守跳过推进（显著度消费由调用方独立处理）。审计修正：读改写整份
   * story.state 必须在故事串行锁内（此前 fire-and-forget 在锁外，与持锁的
   * advance/瞥视写入存在丢失更新竞态）。 */
  async advanceGroupBackgroundWatermarkForTurn(storyId: string, groupId: string, now: Date, frozenMaxEntryId = 0): Promise<void> {
    if (frozenMaxEntryId <= 0) return
    const generation = this.deliveryGeneration(storyId)
    const contentCurrent = () => !this.databaseResetting && !this.disposed && this.deliveryGeneration(storyId) === generation
    const run = async () => {
      if (!contentCurrent()) return
      const normalized = normalizeGroupId(groupId)
      if (!normalized) return
      const rows = await this.dbGet('interlude_script_entry', {
        storyId, kind: 'group-message',
        'metadata.groupId': { $in: groupIdStorageVariants(normalized) },
      }, { limit: 1, sort: { id: 'desc' } }) as any[]
      const latest = rows[0]?.id
      if (typeof latest !== 'number' || !contentCurrent()) return
      const maxId = Math.min(latest, frozenMaxEntryId)
      if (maxId <= 0) return
      await this.commitGroupBackgroundCoverage(storyId, { watermarks: { [normalized]: maxId }, contentComplete: { [normalized]: true } }, now)
    }
    await this.serial(storyId, run)
  }

  /** I-1 会话迟滞：她最近一条（确认送达的）群发消息是否在窗口内——近期
   * 参与态让跳过抖动让位于会话延续（窗口 30 分钟起步，回放验证后调整；
   * 查询失败/无记录 = 非会话态）。送达确认的最小近似：character-group-message
   * 条目存在于该群即视为她曾发言（条目在成功提交后写入）；分段全失败时
   * 条目仍会带 partialDelivery 标注——精确回执过滤留待回放验证后收窄。 */
  async groupSessionActive(storyId: string, groupId: string, now = new Date()): Promise<boolean> {
    try {
      const normalized = normalizeGroupId(groupId)
      if (!normalized) return false
      const rows = await this.dbGet('interlude_script_entry', {
        storyId, kind: 'character-group-message',
        'metadata.groupId': { $in: groupIdStorageVariants(normalized) },
      }, { limit: 1, sort: { occurredAt: 'desc' } }) as InterludeStory[] & { occurredAt?: unknown }[] as any[]
      const latest = rows[0]?.occurredAt ? toDate(rows[0].occurredAt) : undefined
      return !!latest && now.getTime() - latest.getTime() <= 30 * Time.minute
    } catch {
      return false
    }
  }

  /** II-1 交往节奏印象（仅私聊）：从该参与者最近私聊条目采样"她确认的开场
   * → 对方承接"的节奏，渲染为一句话事实。character-message 行仅在投递成功
   * 后落库，存在即已确认送达；证据不足（样本 < 3）返回 undefined 不注入。
   * 尽力而为：查询失败静默降级为无印象。 */
  private async interactionRhythmFor(storyId: string, participantId: string, now = new Date()): Promise<string | undefined> {
    const result = await this.sampleInteractionRhythmFor(storyId, participantId, now)
    return result ? renderInteractionRhythm(result) : undefined
  }

  /** II-4 最小观测：查询并采样某参与者的交往节奏（结构化结果；印象与状态命令共用）。 */
  private async sampleInteractionRhythmFor(storyId: string, participantId: string, now = new Date()): Promise<RhythmSampleResult | undefined> {
    try {
      const rows = await this.dbGet('interlude_script_entry', {
        storyId, participantId, kind: { $in: ['user-message', 'character-message'] },
      }, { limit: RHYTHM_SAMPLE_WINDOW, sort: { occurredAt: 'desc' } }) as any[]
      const entries: RhythmSampleEntry[] = (rows ?? [])
        .filter(row => row?.kind === 'user-message' || row?.kind === 'character-message')
        .map(row => ({ kind: row.kind, occurredAt: toDate(row.occurredAt) }))
        .filter(entry => !Number.isNaN(entry.occurredAt.getTime()))
      return sampleInteractionRhythm(entries, now)
    } catch {
      return undefined
    }
  }

  /** II-4 最小观测：每位活跃参与者的节奏采样状态行（interlude.rhythm.status）。 */
  async interactionRhythmStatusLines(story: InterludeStory): Promise<string[]> {
    const participants = (await this.participants(story.id)).filter(item => item.status === 'active')
    const lines = ['交往节奏观测（开场=她确认送达且此前安静≥30分钟；承接=对方首条回复；样本≥3 才注入印象）:']
    if (!participants.length) return ['交往节奏观测：暂无活跃参与者。']
    const now = new Date()
    for (const item of participants) {
      const result = await this.sampleInteractionRhythmFor(story.id, item.id, now)
      if (!result || !result.respondedLatenciesMs.length) {
        lines.push(`· ${item.displayName || item.id}：(样本不足——还在熟悉彼此节奏)`)
        continue
      }
      const median = result.respondedLatenciesMs[Math.floor(result.respondedLatenciesMs.length / 2)]
      const impression = renderInteractionRhythm(result)
      lines.push(`· ${item.displayName || item.id}：样本 ${result.respondedLatenciesMs.length}/${result.openings} 次，${formatMedianDuration(median)}；待定 ${result.pending}；含混 ${result.ambiguous}${impression ? `\n  印象：${impression}` : ''}`)
    }
    return lines
  }

  /** Issue #20：模型调用一条龙自检——按任务路由逐提供商发送最小探测请求
   * （主叙事/压缩/播种走 customSideTask 的 JSON 探针，嵌入走一次 embedText），
   * 报告路由解析、逐提供商成功（耗时）或失败（错误 + 模型原文头）。只读探测
   * 但消耗少量 token，命令侧由管理员门控。 */
  async modelProbeLines(): Promise<string[]> {
    const lines: string[] = ['模型自检（按任务路由逐提供商最小探测，消耗少量 token）:']
    try { lines.push(`路由：${formatModelRouting(this.modelRouting)}`) } catch { /* 尽力而为 */ }
    const sideTask = (this.narrator as unknown as {
      customSideTask<T>(provider: { endpoint: string, apiKey: string, model: string, label?: string, id?: string, protocol?: string, zhipuOfficial?: boolean, topP?: number, extraBody?: unknown, extraHeaders?: unknown, proxyAgent?: unknown }, task: string, timeout: number, temperature: number, maxTokens: number, system: string, user: string): Promise<T>
    }).customSideTask
    const chatProbes: Array<[string, ModelRoutingTable['main']]> = [
      ['主叙事', this.modelRouting.main],
      ['压缩', this.modelRouting.compaction],
      ['播种/贴纸', this.modelRouting.stickers],
      ['考据', this.modelRouting.research],
    ]
    for (const [taskName, route] of chatProbes) {
      if (!route?.available || !route.providers.length) {
        lines.push(`· ${taskName}：（未配置/不可用）`)
        continue
      }
      for (const provider of route.providers.slice(0, 3)) {
        const label = `${provider.label || provider.id} · ${provider.model} @ ${providerEndpointHost(provider.endpoint)}`
        const startedAt = Date.now()
        try {
          await sideTask(provider, `自检·${taskName}`, 30_000, 0, 64,
            'Return exactly one JSON object {"ok":true} with no other text.', 'ping')
          lines.push(`· ${taskName} ✔ ${label} 成功 耗时=${Date.now() - startedAt}ms`)
        } catch (error) {
          lines.push(`· ${taskName} ✘ ${label} 失败：${String(error instanceof Error ? error.message : error).slice(0, 200)}`)
        }
      }
    }
    if (this.modelRouting.embedding.available) {
      const startedAt = Date.now()
      try {
        const vector = await this.embedText('ping', { purpose: '模型自检', density: 'diagnostic' })
        lines.push(`· 嵌入 ✔ 成功 维度=${Array.isArray(vector) ? vector.length : '?'} 耗时=${Date.now() - startedAt}ms`)
      } catch (error) {
        lines.push(`· 嵌入 ✘ 失败：${String(error instanceof Error ? error.message : error).slice(0, 200)}`)
      }
    } else {
      lines.push('· 嵌入：（未配置/不可用）')
    }
    lines.push('提示：失败信息中的 原文头=/raw= 是模型实际返回的开头片段，可据此判断拒答、JSON 包裹在文本里或思考截断。')
    return lines
  }

  /** I-6a：装配 advance 相位的群消息背景（always 群；每群查最近 64 条中未
   * 覆盖的部分 → 概况 + 每群 K 条原文 + 全局合计上限）。尽力而为：任何失败
   * 由调用方 catch 静默，不阻塞推进。 */
  private async groupBackgroundForAdvance(story: InterludeStory): Promise<{ sections: GroupBackgroundSection[], coverage: GroupBackgroundCoverage } | undefined> {
    // I-6b 后台参与维度：off 不进背景通道，background/active 均进（数据密度
    // 由采集维度天然决定——directed 采集的群只有定向消息可呈现）。
    const rules = (this.config?.onebot?.groupChats ?? []).filter((rule: any) => rule.enabled !== false && resolveGroupDimensions(rule).backgroundParticipation !== 'off')
    if (!rules.length) return undefined
    // F1 修正：readGroupBackgroundWatermarks 收完整状态对象（读 value.extensions.
    // groupBackground.watermarks）——此前误传 extensions 袋导致恒空，已覆盖消息
    // 反复进入背景、局部提交丢失其他群水位。
    const watermarks = readGroupBackgroundWatermarks(story.state)
    const queryLimit = 64
    const sections: Array<{ groupId: string, label: string, entries: any[] }> = []
    const truncatedGroups = new Set<string>()
    for (const rule of rules) {
      const groupId = normalizeGroupId(rule.groupId)
      if (!groupId) continue
      const sinceId = watermarks[groupId] ?? 0
      const rows = await this.dbGet('interlude_script_entry', {
        storyId: story.id, kind: 'group-message',
        'metadata.groupId': { $in: groupIdStorageVariants(groupId) },
      }, { limit: queryLimit, sort: { occurredAt: 'desc' } }) as any[]
      const uncovered = rows.filter(row => row.id > sinceId)
        .sort((left: any, right: any) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.id - left.id)
      if (!uncovered.length) continue
      if (rows.length >= queryLimit && uncovered.length === rows.length) truncatedGroups.add(groupId)
      sections.push({ groupId, label: String(rule.label ?? '').trim() || groupId, entries: uncovered })
    }
    if (!sections.length) return undefined
    return assembleGroupBackground({ sections, truncatedGroups, timezone: story.setting?.timezone })
  }

  /** I-6a：成功提交后推进内容覆盖水位（只前进；概况不清空全部——未获原文
   * 呈现的批次保留内容级催动资格，I-2 接入时消费）。 */
  private async commitGroupBackgroundCoverage(storyId: string, coverage: GroupBackgroundCoverage, now: Date, sections?: GroupBackgroundSection[]): Promise<void> {
    // I-2 覆盖消费：F2 修正——内容完备（全部未覆盖条目获原文呈现）= 完全消费；
    // 被条数/字符预算截断的群按概况覆盖 ×0.5，未获原文呈现的旧积压保留部分资格。
    if (sections?.length) {
      this.consumeNarrativeSalienceOnAdvance(storyId, sections.map(section => ({
        groupId: section.groupId,
        contentCovered: coverage.contentComplete?.[section.groupId] === true,
      })))
    }
    if (!Object.keys(coverage.watermarks).length) return
    const fresh = await this.getStory(storyId)
    const state = decodeStoryState(fresh.state)
    // F1 修正：与读取侧对称——传完整状态，保留其他群既有水位。
    const previous = readGroupBackgroundWatermarks(state)
    const merged = mergeGroupBackgroundWatermarks(previous, coverage)
    await this.dbSet('interlude_story', { id: storyId }, {
      state: encodeStoryState({ ...state, extensions: { ...state.extensions, groupBackground: { watermarks: merged, updatedAt: now.toISOString() } } }),
      updatedAt: now,
    })
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
      .filter((intent: any) => intent.type === 'split-message')
      .sort((left: any, right: any) => left.notBefore.getTime() - right.notBefore.getTime())
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
      await this.scheduleNextPendingWake(story.id)
      // Full delivery can settle a follow-up. Do not narrate the stale due
      // snapshot captured before that delivery (even after the chain is empty).
      due = await this.dueIntents(story.id, now)
    }
    due = due.filter((intent: any) => intent.type !== 'split-message')
    // 考据意图：到期即后台执行（预算门+防火墙+单/双轮检索+蒸馏），
    // 结果只进资料案头（author-facing），意图本身完成后从叙事 due 批次移除——
    // 她怎么汇报查到的内容由作者在后续轮次裁决。
    // 审计修复 #4：锁内只收集过滤，执行移到串行队列外（advanceStory 内）。
    // 网络请求在队列外执行；提交资料与完成意图时核验任务代次，清理可让旧任务退休。
    const researchIntents = due.filter((intent: any) => intent.type === 'research-lookup').slice(0, 2)
    if (researchIntents.length) {
      ;(this.researchDueIntents ??= []).push(...researchIntents)
      due = due.filter((intent: any) => intent.type !== 'research-lookup')
    }
    // Browser research is an external, already-happened observation once it
    // completes. It must never be handed to the narrator as an ordinary
    // future plan, otherwise the model could write as if it had read a page
    // before Puppeteer actually did so.
    // Keep a backlog of optional research from turning one background sweep
    // into several serial page loads. The remaining intents stay pending for
    // the next sweep and never block a live user turn for an unbounded time.
    const browserIntents = due
      .filter((intent: any) => intent.type === 'browser-research')
      .slice(0, Math.max(1, this.browserConfig.maxResearchPerSweep))
    for (const intent of browserIntents) await this.executeDeferredBrowserIntent(story, intent, now)
    // Browser intents always complete (successfully or as a recorded failure)
    // in executeDeferredBrowserIntent(), so re-reading the whole pending list
    // here only adds a SQLite round trip to every background sweep.
    due = due.filter((intent: any) => intent.type !== 'browser-research')
    // QQ 空间动作同样是“到期即外部已发生/已失败”的一锤子执行：限流门挡下或
    // 通道失败都直接完成（成败在审计表），绝不作为未来计划回流给叙事。
    const qzoneIntent = due.filter((intent: any) => intent.type === 'qzone-action').slice(0, 1)[0]
    if (qzoneIntent) {
      await this.executeQzoneIntent(story, qzoneIntent, now)
      due = due.filter((intent: any) => intent.id !== qzoneIntent.id)
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
    // 热身 A（收敛 §7.1.1）：quietUntil 遗留分支已清理——历史遗留暂停值在
    // 状态归一化加载时即被丢弃，运行期不再存在该暂停来源。
    const pausedForConversation = false
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
      const blockedSplits = pendingSplits.filter((intent: any) => phase === 'advance' || intent.participantId === followUpParticipant?.id)
      if (blockedSplits.length) {
        await this.scheduleNextPendingWake(story.id)
        this.reportOperation('diagnostic', 'debug', story, phase,
          '后台写作等待已提交分段投递 参与者=%s 待发分段=%d', followUpParticipant?.id || '全局', blockedSplits.length)
        return messages
      }
      this.reportOperation('standard', 'info', story, phase,
        '即将执行自动写作 类型=%s 时间段=%s→%s', phaseLabel(phase), formatLogTime(from, story.setting.timezone), formatLogTime(now, story.setting.timezone))
      // I-6a：advance 相位装配群消息背景（有界：概况 + 每群 K 条；尽力而为，
      // 失败静默不阻塞推进）。conversation-follow-up 不注入（最小切片）。
      const groupBackground = phase === 'advance' ? await this.groupBackgroundForAdvance(story).catch((): undefined => undefined) : undefined
      const { decision, succeeded, timelinePlan } = taskCurrent()
        ? await this.tryDecide(story, followUpParticipant ?? null, phase, from, now, undefined, [], [], undefined, [], [], undefined, [], [], undefined, undefined, undefined, undefined, groupBackground?.sections)
        : { decision: {} as NarrativeDecision, succeeded: false, timelinePlan: undefined }
      if (succeeded && taskCurrent()) {
        const permitMessages = phase === 'conversation-follow-up' || this.config.runtime.allowProactiveMessages
        const persisted = await this.persistDecision(story, followUpParticipant ?? null, decision, from, now, permitMessages, phase, [], false, timelinePlan)
        messages.push(...persisted.messages)
        await this.dbSet('interlude_story', { id: story.id }, { cursorAt: now, updatedAt: now })
        advanced = true
        // 成功提交 → 内容覆盖水位推进（失败不推，批次保留催动资格）。
        if (groupBackground) await this.commitGroupBackgroundCoverage(story.id, groupBackground.coverage, now, groupBackground.sections).catch((): undefined => undefined)
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
        const staleRetries = dueBatch.filter((intent: any) => intent.type === 'narrative-retry')
        if (staleRetries.length) await this.dbSet('interlude_intent', { id: { $in: staleRetries.map((intent: any) => intent.id) } }, { status: 'cancelled', updatedAt: now })
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
            const permitMessages = this.config.runtime.allowProactiveMessages || dueBatch.some((intent: any) => intent.payload?.userInitiated === true)
            const persisted = await this.persistDecision(current, dueParticipant ?? null, decision, dueFrom, now, permitMessages, 'intent-due', dueBatch, false, timelinePlan)
            messages.push(...persisted.messages)
          }
          if (turnSucceeded && taskCurrent()) {
            await this.dbSet('interlude_story', { id: current.id }, { cursorAt: now, updatedAt: now })
            const ordinaryDueIds = dueBatch.filter((intent: any) => intent.type !== 'follow-up-commitment').map(intent => intent.id)
            if (ordinaryDueIds.length) {
              await this.dbSet('interlude_intent', { id: { $in: ordinaryDueIds } }, { status: 'completed', updatedAt: now })
              for (const intent of dueBatch) reportContactPlanUpdate(this, intent, 'completed', 'plan-consumed')
            }
            if (dueBatch.some((intent: any) => intent.type === 'delayed-reply')) {
              delayedReplyProcessed = true
              await this.pauseAutomaticAdvanceAfterDelayedReply(story.id, now, dueParticipant?.id ?? '')
            } else if (!advanced && !delayedReplyProcessed) {
              await this.scheduleNextAutomaticAdvance(story.id, now)
            }
          } else {
            // A failed user turn gets a persisted retry. Otherwise a transient
            // 403/5xx would leave its already-recorded incoming message waiting
            // forever for somebody to send another DM.
            const retries = dueBatch.filter((intent: any) => intent.type === 'narrative-retry')
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
          await this.dbSet('interlude_intent', { id: { $in: dueBatch.map(intent => intent.id) } }, { notBefore: backoffAt, updatedAt: now }).catch((): undefined => undefined)
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

  private async decide(story: InterludeStory, participant: InterludeParticipant | null, phase: NarrativeRequest['phase'], from: Date, now: Date, userMessage: string | undefined, dueIntents: NarrativeIntent[], supersededIntents: NarrativeIntent[] = [], groupContext?: GroupContext, images: NarrativeImage[] = [], audio: NarrativeAudio[] = [], extraWebContext: WebObservation[] = [], outputRecovery = false, chatCapabilities?: ChatActionCapabilities, quotedMessages: IndexedQuotedMessageContext[] = [], stickerCatalog: StickerCatalogEntry[] = [], turnQueryEmbedding?: number[], visualObservations?: string[], timelinePlan?: TimelinePlan, onEarlyReply?: (reply: EarlyNarrativeReply) => Promise<boolean>, historicalGroupImages: NarrativeHistoricalImage[] = [], groupBackground?: GroupBackgroundSection[]) {
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
      // F6：advance 相位把聊天行排除下推到查询——生活条目（script 等）的
      // 席位不再被群刷屏在查询阶段挤出。
      this.recentEntriesForPrompt(story.id, now, this.effectiveContextBudget(story.id, groupContext ? 'group' : 'private', phase, now), { excludeChatKinds: phase === 'advance' }),
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
      .sort((left: any, right: any) => participantRelevance(right) - participantRelevance(left))
      .slice(0, this.sharedStoryConfig.participantContextLimit)
    const agencyEnabled = this.agencyConfig.enabled
      && this.config.runtime.allowProactiveMessages
      && (phase === 'advance' || phase === 'intent-due' && dueIntents.some((intent: any) => intent.type === 'proactive-check'))
    const advanceCanContact = phase === 'advance' && this.config.runtime.allowProactiveMessages
    const visibleDueIntents = this.sharedStoryConfig.shareParticipantDetails
      ? dueIntents
      : dueIntents.filter((intent: any) => !intent.participantId || intent.participantId === participant?.id)
    const visibleUpcomingIntents = phase === 'advance' || this.sharedStoryConfig.shareParticipantDetails
      ? upcomingIntents
      : upcomingIntents.filter((intent: any) => !intent.participantId || intent.participantId === participant?.id)
    // A relationship consequence belongs to the protagonist's actual life.
    // Background writing therefore sees its compact effect even when raw
    // cross-participant chat history remains private. Live turns still see
    // only their own (and global) consequences unless sharing is enabled.
    const visibleConsequences = phase === 'advance' || this.sharedStoryConfig.shareParticipantDetails
      ? activeConsequences
      : activeConsequences.filter((intent: any) => !intent.participantId || intent.participantId === participant?.id)
    const mergedWebContext = [...webContext, ...extraWebContext]
      .filter(observation => observation.status !== 'deleted')
      .sort((left: any, right: any) => left.accessedAt.getTime() - right.accessedAt.getTime())
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
      // I-6b：主动群发目标 = 后台参与 active 档（mention-only 旧映射 off，不再作为主动目标）。
      ? activeProactiveGroupTargets(this.config.onebot?.groupChats ?? [])
        .map(({ groupId, label }) => ({ participantId: `group:${groupId}`, groupId, label }))
      : []
    const endpointSelection = this.narrativeEndpointSelection(story, allParticipants, availableGroupTargets)
    const turnBrowserMode = !this.browserConfig.enabled || (groupContext && !this.browserConfig.allowGroupTriggeredResearch)
      ? 'disabled' as const : phase === 'user-message' && participant && !groupContext ? this.browserConfig.mode : 'deferred-only' as const
    // 合约自动拼装：一次窗口扫描按"配置 OR 数据"判定功能板块去留；开关关闭时
    // 不发送信号对象，系统合约回退到完整原样。
    const anyGroupEnabled = (this.config.onebot?.groupChats ?? []).some(group => group.enabled !== false && normalizeGroupId(group.groupId))
    let windowHasGroupEntries = false
    let windowHasAdminNotes = false
    let windowHasWorldEventEntries = false
    let windowHasQzoneFeedEntries = false
    for (const entry of promptEntries) {
      if (entry.kind === 'group-message' || entry.kind === 'character-group-message') windowHasGroupEntries = true
      else if (entry.kind === 'admin-note') windowHasAdminNotes = true
      const text = typeof entry.content === 'string' ? entry.content : ''
      if (text.startsWith('[世界事件]')) windowHasWorldEventEntries = true
      else if (text.startsWith('[空间动态]') || text.startsWith('[好友动态]')) windowHasQzoneFeedEntries = true
    }
    const recallQueryText = memoryEnabled
      ? recallFocus(userMessage,
        facts.filter(fact => fact.unresolved).map(fact => fact.knowledge?.topic ?? '').filter(Boolean),
        visibleDueIntents.map(intent => intent.summary)).trim()
      : ''
    const contractFeatures = this.config.model.specializationAutoTrim === false ? undefined : resolveNarrativeContractFeatures({
      qzoneEnabled: this.qzoneRuntime.enabled,
      pendingQzoneActionIntents: visibleDueIntents.some((intent: any) => intent.type === 'qzone-action'),
      windowHasQzoneFeedEntries,
      groupTargetsPresent: availableGroupTargets.length > 0,
      anyGroupEnabled,
      windowHasGroupEntries,
      hasWechatEndpoint: this.endpointRows.some(row => row.enabled && row.channelKind === 'wechat'),
      browserActive: turnBrowserMode !== 'disabled',
      webContextPresent: mergedWebContext.length > 0,
      semanticRecallEnabled: this.config.model.embedding?.enabled === true && this.config.model.embedding?.semanticHistory === true,
      recallQueryActive: !!recallQueryText,
      worldEventsEnabled: this.worldSeederRuntime.enabled || this.weatherConfig.enabled,
      windowHasWorldEventEntries,
      windowHasAdminNotes,
      researchEnabled: this.researchActive,
    })
    // II-1 交往节奏印象：仅私聊相位（user-message / intent-due / conversation-
    // follow-up）注入；advance 是她自己的生活、群回合另有通道，均不查询。
    const interactionRhythm = participant && !groupContext && phase !== 'advance'
      ? await this.interactionRhythmFor(story.id, participant.id, now)
      : undefined
    if (interactionRhythm) this.reportOperation('diagnostic', 'debug', story, phase, '交往节奏印象已注入 参与者=%s 印象=%s', participant!.id, interactionRhythm)
    const narrated = await this.narrator.decide({
      urgeEnabled: this.urgeConfig.enabled && !dueIntents.some((intent: any) => intent.type === 'narrative-retry'),
      phase, refreshContinuity, outputRecovery, story, from, now, userMessage, userReportedTimes, images, audio, visualObservations, historicalGroupImages, timelinePlan, developmentTendencies,
      ...(groupBackground?.length ? { groupBackground } : {}),
      ...(interactionRhythm ? { interactionRhythm } : {}),
      writingOptions: {
        messageSeparator: this.config.runtime.messageSeparator?.trim() || '<sep/>',
        splitReplyMessages: this.config.runtime.splitReplyMessages !== false,
        browserMode: turnBrowserMode,
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
      contractFeatures,
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
              (this.config.runtime.contextTimeWindowMinutes ?? 5) > 0
                ? new Date(now.getTime() - Math.min(this.config.runtime.contextTimeWindowMinutes ?? 5, 1_440) * Time.minute)
                : undefined).map(entry => entry.id)),
            new Set(facts.filter(fact => userMessage?.trim() || fact.unresolved && fact.knowledge?.topic).flatMap(fact => fact.sourceEntryIds ?? [])),
            userMessage?.trim() ? 3 : 1,
          )
        : undefined,
      recentProtectionSince: (this.config.runtime.contextTimeWindowMinutes ?? 5) > 0
        ? new Date(now.getTime() - Math.min(this.config.runtime.contextTimeWindowMinutes ?? 5, 1_440) * Time.minute)
        : undefined,
      ...(quotedMessages.length ? { quotedMessages } : {}),
      ...(stickerCatalog.length && phase === 'user-message' ? { stickerCatalog } : {}),
      webContext: mergedWebContext, overlaySnapshots,
      ...(this.researchActive ? { researchDesk: this.researchDeskFor(story.id).snapshot(now.getTime(), this.researchConfig.deskCapacity) } : {}),
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
        dueIntents.filter((intent: any) => !intent.participantId || intent.participantId === participant?.id).map(intent => intent.summary))
        ? await this.recallHistory(story.id, participant?.id ?? '', recallFocus(undefined,
          facts.filter(fact => fact.unresolved).map(fact => fact.knowledge?.topic ?? ''),
          dueIntents.filter((intent: any) => !intent.participantId || intent.participantId === participant?.id).map(intent => intent.summary)),
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

  private async tryDecide(story: InterludeStory, participant: InterludeParticipant | null, phase: NarrativeRequest['phase'], from: Date, now: Date, userMessage: string | undefined, dueIntents: NarrativeIntent[], supersededIntents: NarrativeIntent[] = [], groupContext?: GroupContext, images: NarrativeImage[] = [], audio: NarrativeAudio[] = [], chatCapabilities?: ChatActionCapabilities, quotedMessages: IndexedQuotedMessageContext[] = [], stickerCatalog: StickerCatalogEntry[] = [], turnQueryEmbedding?: number[], visualObservations?: string[], onEarlyReply?: (reply: EarlyNarrativeReply) => Promise<boolean>, historicalGroupImages: NarrativeHistoricalImage[] = [], groupBackground?: GroupBackgroundSection[]) {
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
      let decision = await this.decide(story, participant, phase, from, effectiveNow, userMessage, dueIntents, supersededIntents, groupContext, images, audio, [], false, chatCapabilities, quotedMessages, stickerCatalog, turnQueryEmbedding, visualObservations, timelinePlan, earlyReply, historicalGroupImages, groupBackground)
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
        decision = await this.decide(story, participant, phase, from, effectiveNow, userMessage, dueIntents, supersededIntents, groupContext, images, audio, immediateObservations, false, chatCapabilities, quotedMessages, stickerCatalog, turnQueryEmbedding, visualObservations, timelinePlan, undefined, historicalGroupImages, groupBackground)
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
        decision = await this.decide(story, participant, phase, from, effectiveNow, userMessage, dueIntents, supersededIntents, groupContext, images, audio, immediateObservations, true, chatCapabilities, quotedMessages, stickerCatalog, turnQueryEmbedding, visualObservations, timelinePlan, undefined, historicalGroupImages, groupBackground)
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
    const permittedGroupIds = new Set(activeProactiveGroupTargets(this.config.onebot?.groupChats ?? []).map(({ groupId }) => groupId))
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
    if (phase === 'advance' && !decision.crossConversationActions.length && decision.proactiveContact
      && (decision.proactiveContact as unknown as { outcome?: unknown }).outcome === 'send-now') {
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
      const rejectedActions = decision.crossConversationActions.filter(action => action.mode === 'immediate'
        && (!commit || findPrivateOutgoingMessageEvent(commit, action.participantId, 'immediate', action.content,
          this.config.runtime.messageSeparator)?.scriptBinding?.status !== 'bound'))
      if (rejectedActions.length) {
        // Issue #15：诊断必须点名具体分段与候选层级，否则"唯一性否决"类误杀无从排查。
        const rejectedDetails = rejectedActions.map(action => {
          const failed = commit ? findPrivateOutgoingMessageEvent(commit, action.participantId, 'immediate', action.content,
            this.config.runtime.messageSeparator)?.scriptBinding?.failed : undefined
          // Issue #17：诊断必须带参与者与分段文本摘要（截断），便于判断是
          // 模型改写了措辞还是完全遗漏正文。
          return failed
            ? `${action.participantId}:分段${failed.bubbleIndex + 1}「${clip(failed.bubble, 60)}」引号候选=${failed.quoted} 独立候选=${failed.standalone} 原文出现=${failed.occurrences}`
            : `${action.participantId}:无对应消息事件「${clip(action.content, 60)}」`
        })
        const rejected = new Set(rejectedActions)
        decision = { ...decision, crossConversationActions: decision.crossConversationActions.filter(action => !rejected.has(action)) }
        commit = buildCommit()
        this.reportOperation('standard', 'warn', story, phase,
          '主动消息正文绑定缺失或同级不唯一，取消本轮即时行动 数量=%d 明细=%s；保留剧本推进，不重试模型',
          rejectedActions.length, rejectedDetails.join('；'))
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
    // Issue #10 根因 B：记录本轮新意图的 id 上界。若本轮稍后发生可见投递撤回
    //（Agency/策略拦截），以此圈定"以已发出为前提"的同轮新意图做中和注记
    //（annotateWithdrawnTurnIntents）——它们 otherwise 会带着中毒前提进入后续
    // dueIntents（summary 与 payload 都会再进 prompt）。
    const turnIntentIdCeiling = Number(((await this.dbGet('interlude_intent', { storyId: story.id }, { sort: { id: 'desc' }, limit: 1 }))[0] as NarrativeIntent | undefined)?.id ?? 0)
    for (const memory of decision.memories) await this.appendMemory(story.id, memory, now, memory.participantId ?? participant?.id ?? '', scriptEntry?.id)
    for (const intent of decision.intents) {
      // A reminder or promise created while handling a user's message is a
      // response to that relationship, even if it becomes due much later.
      // Carry that provenance into the shared intent ledger so its due-turn
      // is allowed to send the eventual message without enabling broad
      // background outreach.
      // 调度边界（issue #3 审计留档）：模型自主规划意图不注册到期唤醒、也不参与
      // scheduleNextPendingWake 补排——分钟级以上尺度按设计契约走 sweep 网格。
      // 秒级意图（重试/分段/浏览）必须在创建点各自注册唤醒。
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
    // P3 统一执行边界：Agency 数值裁决退役（§10.1），主动出站按逻辑动作过
    // 统一策略（总开关与端点门照旧在各自边界生效）。legacy proactive-check
    // 意图仍按期消费至 P3.2 迁移；策略阻塞以 cancelled+policy-* 闭环记账。
    const policyBlockedActions: Array<{ participantId: string, content: string, reason: string }> = []
    let policyCheckAllowed = !isAgencyCheck || !!participant
    let policyCheckBlockedReason: string | undefined
    let policyRecordsCache: PolicyActionRecord[] | undefined
    // 形成点评估只看既往动作：本次 commit 自己的 pending 占用（第一次尝试前
    // 持久预占，§7.4）不得锚定本次间隔/额度——否则任何 interval>0 的配置会
    // 让每个动作自己拦自己（P2 的 contactLog 路径同样排除本次预记条目）。
    const policyRecords = async () => policyRecordsCache ??= policyActionRecordsFromLedger(
      await this.dbGet('interlude_script_entry', { storyId: story.id, kind: 'script' }, { sort: { occurredAt: 'desc' }, limit: 100 }) as any[], now)
      .filter(record => !commit || !record.actionId.startsWith(`${commit.commitId}:`))

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
        const persistedAgencyWindow = normalizeAgencyWindowDraft(
          decision.agencyWindow,
          now,
          this.agencyConfig,
          validSourceEntryIds,
          scriptEntry?.id,
        ) ?? activeAgencyWindow(state.agencyWindow, now)
        nextState.agencyWindow = persistedAgencyWindow
        if (persistedAgencyWindow) {
          this.reportOperation('diagnostic', 'debug', story, phase,
            'Agency Window 更新 负荷=%s 隐私=%s 设备=%s 有效至=%s',
            persistedAgencyWindow.activityLoad, persistedAgencyWindow.privacy, persistedAgencyWindow.deviceAccess,
            formatLogTime(toDate(persistedAgencyWindow.validUntil), story.setting.timezone))
        }
      }
        // P3 统一执行边界：Agency 数值裁决退役（设计 §10.1）——候选选择、容量
        // 否决、意愿阈值、日上限预记、合成豁免与重查排期全部退出运行链；
        // proactiveContact 兼容解析不再产生执行差异。窗口缓存保留为场景证据。
        // 形成点的统一策略评估在此执行（advance 的逐动作过滤在 crossActions
        // 选择处）；legacy proactive-check 按参与者整体评估。
        if (isAgencyCheck && participant && permitMessages) {
          const policy = this.deliveryPolicyConfig
          if (policy.proactivePerTargetDailyCap > 0 || policy.minimumRunIntervalMinutes > 0) {
            const evaluation = evaluateDeliveryPolicy({
              config: policy,
              targetId: participant.id,
              records: await policyRecords(),
              now,
            })
            policyCheckAllowed = evaluation.allowed
            if (!evaluation.allowed) {
              // 撤回留痕沿用具体策略原因（policy-run-interval 等），不再泛化
              // 为 policy-run-limit——否则诊断无从区分间隔与额度。
              policyCheckBlockedReason = evaluation.reason
              this.reportOperation('standard', 'warn', story, phase,
                '运行限制：proactive-check 回复暂未执行 原因=%s 已计=%d 下次=%s revision=%s',
                evaluation.reasonText, evaluation.counted, evaluation.nextEligibleAt ?? '-', evaluation.policyRevision)
            }
          }
        }
        if (decision.communicationActionRejections?.length) {
          this.reportOperation('diagnostic', 'warn', story, phase,
            '通信动作适配拒绝（say 绑定/目标/时效校验未过） 条目=%s',
            decision.communicationActionRejections.join(' | ').slice(0, 400))
        }
      await this.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState(nextState), updatedAt: now })
      if (alterTurn?.thresholdReached) this.scheduleAlterAnalysis(story.id, phase, alterTurn.sourceParticipantId)
    }

    const messages: OutgoingMessageDraft[] = []
    // proactive-check 回位救援：模型没输出 interaction.reply 时从剧本 say 行动
    // 合成（legacy 意图沿用；策略与总开关照常把关）。
    let interaction = isAgencyCheck
      ? policyCheckAllowed && decision.interaction?.reply?.mode === 'immediate' ? decision.interaction : undefined
      : decision.interaction
    if (isAgencyCheck && policyCheckAllowed && participant && (!interaction?.reply?.content)) {
      const synthesized = this.synthesizeCrossActionFromScript(decision, participant.id)
      if (synthesized) {
        this.reportOperation('standard', 'info', story, phase,
          '策略放行但模型未输出 interaction 回复，已从剧本 say 行动合成 参与者=%s', participant.id)
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

    // P3 统一执行边界：跨会话动作在 live 用户事件中随回合放行；后台（advance）
    // 仅当总开关开启时进入策略过滤。每个逻辑动作独立评估（§7.4 群目标首期
    // 不占私聊额度），被阻塞动作以 cancelled+policy-* 闭环记账，不进入投递。
    let crossActions = phase === 'user-message'
      ? decision.crossConversationActions
      : phase === 'advance' && this.config.runtime.allowProactiveMessages
        ? [...decision.crossConversationActions]
        : []
    if (phase === 'advance' && crossActions.length) {
      const policy = this.deliveryPolicyConfig
      if (policy.proactivePerTargetDailyCap > 0 || policy.minimumRunIntervalMinutes > 0) {
        const records = await policyRecords()
        crossActions = crossActions.filter(action => {
          if (action.mode !== 'immediate' || action.participantId.startsWith('group:')) return true
          const evaluation = evaluateDeliveryPolicy({ config: policy, targetId: action.participantId, records, now })
          if (evaluation.allowed) return true
          policyBlockedActions.push({ participantId: action.participantId, content: action.content, reason: evaluation.reason })
          this.reportCommunicationEvent('standard', 'warn', story, phase,
            '运行限制：当前消息暂未执行 原因=%s 目标=%s 已计=%d 下次=%s revision=%s',
            { type: 'action-policy', storyId: story.id, targetId: action.participantId, domain: 'policy', reasonCode: evaluation.reason, status: 'blocked', policyRevision: evaluation.policyRevision },
            evaluation.reasonText, action.participantId, evaluation.counted, evaluation.nextEligibleAt ?? '-', evaluation.policyRevision)
          return false
        })
      }
    }
    // 策略/总开关拦截补偿：被拦下的即时私聊行动从未进入投递管线，投递失败
    // 路径不覆盖它们；不在此闭环记账，账本将停留 pending，后续轮次只看到
    // "剧本已说"而误以为已发出。
    if (phase === 'advance' && !this.config.runtime.allowProactiveMessages) {
      const withdrawn = decision.crossConversationActions.filter(action => action.mode === 'immediate'
        && !action.participantId.startsWith('group:'))
      if (withdrawn.length) {
        await this.recordWithdrawnOutgoingEvents(story, withdrawn, commit, scriptEntry, 'proactive-messages-not-allowed', now, phase)
        await this.annotateWithdrawnTurnIntents(story, turnIntentIdCeiling,
          new Set(withdrawn.map(item => item.participantId)), 'proactive-messages-not-allowed', now)
      }
    }
    if (policyBlockedActions.length) {
      await this.recordWithdrawnOutgoingEvents(story, policyBlockedActions, commit, scriptEntry, policyBlockedActions[0].reason, now, phase)
      await this.annotateWithdrawnTurnIntents(story, turnIntentIdCeiling,
        new Set(policyBlockedActions.map(item => item.participantId)), policyBlockedActions[0].reason, now)
    }
    // 解析层丢弃补偿：结构性丢弃（回声闸/时效越界/新契约适配拒绝目标）从未
    // 生成事件，无账本可撤——只补"从未发送"历史条目。不传 commit，避免按
    // 内容反查时误撤同参与者存活行动的账本分段。
    {
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
          '解析层结构性丢弃已记入未发送账本 数量=%d 原因=%s',
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
          && (event.deliveryMode === 'delayed' || !policyCheckAllowed || !permitMessages))
        .map(event => ({
          participantId: participant.id,
          content: event.content ?? event.bubbles?.join(this.config.runtime.messageSeparator) ?? '',
          event,
        }))
        .filter(action => !!action.content)
      if (withdrawn.length) {
        const reason = !permitMessages
          ? 'proactive-messages-not-allowed'
          : !policyCheckAllowed
            ? policyCheckBlockedReason ?? 'policy-run-limit'
            : 'proactive-delayed-reply-not-scheduled'
        await this.recordWithdrawnOutgoingEvents(story, withdrawn, commit, scriptEntry, reason, now, phase)
        await this.annotateWithdrawnTurnIntents(story, turnIntentIdCeiling, new Set([participant.id]), reason, now)
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
    if (this.urgeConfig.enabled && scriptEntry && (isAutomaticNarrativePhase(phase) || phase === 'intent-due' && !contextIntents.some((intent: any) => intent.type === 'narrative-retry'))) {
      try {
        const current = await this.getStory(story.id)
        const state = decodeStoryState(current.state)
        const target = (isAgencyCheck && policyCheckAllowed && participant && prepared.some(message => message.participantId === participant.id))
          ? participant.id
          : (phase === 'advance' && this.config.runtime.allowProactiveMessages
            ? crossActions.find(action => action.mode === 'immediate' && !action.participantId.startsWith('group:'))?.participantId
            : undefined)
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

  /** P2 统一投递策略（shadow）：显式配置优先；全默认值视为未显式配置，
   * 按旧链实际生效限制保守派生（§12.2 的 schema 展开歧义以此口径处理）。 */
  get deliveryPolicyConfig(): DeliveryPolicyConfig {
    if (this.cachedDeliveryPolicyConfig) return this.cachedDeliveryPolicyConfig
    const raw = resolveDeliveryPolicyConfig(this.config.deliveryPolicy)
    const explicit = raw.proactivePerTargetDailyCap > 0 || raw.minimumRunIntervalMinutes > 0
      || raw.deferralValidityMinutes > 0
    this.cachedDeliveryPolicyConfig = explicit ? raw : migrateLegacyRunLimits({
      agencyEnabled: this.agencyConfig.enabled,
      contactMode: this.agencyConfig.contactMode,
      minimumProactiveIntervalMinutes: this.agencyConfig.minimumProactiveIntervalMinutes,
      naturalMinimumIntervalMinutes: this.agencyConfig.naturalMinimumIntervalMinutes ?? this.agencyConfig.minimumProactiveIntervalMinutes,
      proactiveDailyCap: this.agencyConfig.proactiveDailyCap,
    }).config
    return this.cachedDeliveryPolicyConfig
  }

  private get schedulePreplanConfig(): SchedulePreplanConfig {
    return this.cachedSchedulePreplanConfig ??= resolveSchedulePreplanConfig(this.config.schedulePreplan)
  }

  private get blindModeConfig(): BlindModeConfig {
    return this.cachedBlindModeConfig ??= resolveBlindModeConfig(this.config.blindMode ?? this.config.blackBox)
  }

  private get modelCaptureConfig(): ModelCaptureConfig {
    if (this.cachedModelCaptureConfig) return this.cachedModelCaptureConfig
    const merged: ModelCaptureConfig = {
      enabled: false,
      directory: 'data/hds-interlude/model-capture',
      ...(this.config.modelCapture ?? {}),
    }
    // 盲模式收束模型侧调试与剧本预览；原始输入/输出采集与其边界冲突，强制关闭。
    if (this.blindModeConfig.enabled) merged.enabled = false
    merged.directory = String(merged.directory ?? '').trim() || 'data/hds-interlude/model-capture'
    return this.cachedModelCaptureConfig = merged
  }

  private get harvestConfig(): StickerHarvestConfig {
    return this.cachedHarvestConfig ??= resolveStickerHarvestConfig((this.config.stickers as StickerLibraryConfig | undefined)?.harvest)
  }

  private get contextEntryConfig(): ContextEntryAutoConfig {
    if (this.cachedContextEntryConfig) return this.cachedContextEntryConfig
    const runtime = this.config.runtime as { contextEntryMode?: unknown, contextEntry?: unknown }
    const nested = resolveContextEntryAutoConfig(runtime.contextEntry)
    const flat = runtime.contextEntryMode === 'auto' || runtime.contextEntryMode === 'fixed' ? runtime.contextEntryMode : undefined
    return this.cachedContextEntryConfig = { ...nested, mode: flat ?? nested.mode }
  }

  /** 生效条目预算：scope/相位/密度 → auto 硬上限或 fixed 锚点。 */
  private effectiveContextBudget(storyId: string, scope: 'private' | 'group', phase: string, now: Date): { count: number, minutes: number, mode: 'fixed' | 'auto' } {
    const config = this.contextEntryConfig
    const mode = effectiveScopeMode(config, scope)
    const anchor = Math.max(1, Math.min(Math.floor(this.config.runtime.contextEntryLimit ?? 18), 200))
    const minutes = Math.max(0, Math.min(Math.floor(this.config.runtime.contextTimeWindowMinutes ?? 5), 1_440))
    if (mode === 'fixed') return { count: anchor, minutes, mode }
    const tier = densityTier(this.contextDensity.counts(storyId, now.getTime()))
    return { count: effectiveContextEntryLimit({ config, scope, anchor, phase, tier }), minutes, mode }
  }

  private get researchConfig(): ResearchConfig {
    return this.cachedResearchConfig ??= resolveResearchConfig((this.config as Config).research)
  }

  private get researchActive(): boolean {
    return this.researchConfig.enabled
  }

  /** 到期考据意图收集：锁内入队，advanceStory 在串行队列外执行。
   * 惰性初始化——原型宿主（测试）没有类字段。 */
  private researchDueIntents?: NarrativeIntent[]

  /** P3' Jev 门控计数（status 可见；重载归零）。 */
  readonly researchJevCounters = { calls: 0, triggered: 0 }

  /** 近期剧本尾部（门控上下文）。 */
  async researchScriptTail(storyId: string, limit = 3): Promise<string> {
    return researchScriptTail(this, storyId, limit)
  }
  /** P3' 被动推进门控：主叙事调用前先问 Jev（Noul 概率）。TRUE → 内联跑
   * 考据（先查后写，本轮带着核实事实写作）；FALSE/不可用/超时/低置信 →
   * 直通。任何异常静默放行——考据永不阻塞对话。 */
  async jevGatePassiveResearch(story: InterludeStory, userMessage: string | undefined, now: Date): Promise<void> {
    return jevGatePassiveResearch(this, story, userMessage, now)
  }
  researchDeskFor(storyId: string): ResearchDesk {
    return researchDeskFor(this, storyId)
  }
  researchProvider() {
    return researchProvider(this)
  }
  /** 采集只在表情库同时启用时生效：保留文件需要既有编目管线消化。 */
  private get stickerHarvestActive(): boolean {
    return this.harvestConfig.enabled && this.stickerConfig.enabled
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
    if (queryEmbedding.length) {
      const stats = semanticFactStats(rows, queryEmbedding)
      this.reportStandaloneOperation('diagnostic', 'info', '事实语义重排 故事=%s 候选=%d 有向量=%d 语义命中=%d 最高相似度=%s',
        storyId, stats.candidates, stats.withVector, stats.hits, stats.topSimilarity == null ? 'n/a' : stats.topSimilarity.toFixed(2))
    }
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

  async appendIntent(storyId: string, intent: IntentDraft, now: Date, participantId = '') {
    return appendIntent(this, storyId, intent, now, participantId)
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
    const expired = consequences.filter((intent: any) => (consequenceExpiresAt(intent.payload)?.getTime() ?? 0) <= now.getTime())
    if (expired.length) {
      await this.dbSet('interlude_intent', { id: { $in: expired.map(intent => intent.id) } }, { status: 'completed', updatedAt: now })
    }
    return rows
      .filter(isActiveConsequence)
      .filter((intent: any) => intent.notBefore <= now)
      .filter((intent: any) => {
        const expiresAt = consequenceExpiresAt(intent.payload)
        return !!expiresAt && expiresAt > now
      })
      .filter((intent: any) => participantId === undefined || !intent.participantId || intent.participantId === participantId)
      .sort((left: any, right: any) => consequenceStrength(right.payload) - consequenceStrength(left.payload)
        || right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, Math.max(1, this.memoryConfig.activeConsequencePromptLimit))
  }

  /** Only active consequences visible to the writer may be resolved. This
   * prevents a remote model from changing arbitrary future plans by id. */
  async applyIntentUpdates(storyId: string, updates: ReturnType<typeof normalizeIntentUpdates>, now: Date, participantId?: string) {
    return applyIntentUpdates(this, storyId, updates, now, participantId)
  }
  /** Stores a narrator-proposed browser action as a future intent. The model
   * never writes page content directly; a separate Puppeteer task creates the
   * observation later. */
  async appendBrowserIntent(storyId: string, draft: BrowserIntentDraft, now: Date, fallbackParticipantId = '') {
    return appendBrowserIntent(this, storyId, draft, now, fallbackParticipantId)
  }
  /** 到期考据意图执行（advanceStory 串行队列外调用）：预算门→改写→检索→
   * 蒸馏→案头；结果只进案头（author-facing），意图完成后由作者在后续轮次
   * 裁决她怎么汇报。失败按完成处理——"她没查到"是合法剧情。 */
  async executeResearchIntent(story: InterludeStory, intent: NarrativeIntent, now: Date) {
    return executeResearchIntent(this, story, intent, now)
  }
  /** interlude.research.status 的只读输出。 */
  researchStatusLines(): string[] {
    return researchStatusLines(this)
  }
  /** Console 概览快照（hdsi-overview DataService 的数据源）。全部为既有只读
   * 状态的聚合；条目数使用数据库聚合，故事不存在时返回占位形状。 */
  /** P4（§14.1）：当前行动条件的只读摘要——来自场景证据缓存（agencyWindow），
   * 过期/缺失以未知表达，不再有"全可用"伪事实。 */
  private async sceneConditionSummary(): Promise<string> {
    try {
      const story = await this.getCanonicalStory()
      const window = story ? activeAgencyWindow(decodeStoryState(story.state).agencyWindow, new Date()) : undefined
      if (!window) return '未知（无有效条件证据）'
      const validHours = Math.max(0, (new Date(window.validUntil).getTime() - Date.now()) / 3_600_000).toFixed(1)
      const labels: Record<string, string> = { available: '可用', limited: '受限', unavailable: '不可用', private: '私密', shared: '共享', public: '公开', free: '空闲', occupied: '忙碌', overloaded: '过载' }
      const sources = window.sourceEntryIds.length ? `；来源条目 #${window.sourceEntryIds.join('、#')}` : ''
      return `设备${labels[window.deviceAccess]} · ${labels[window.privacy]} · ${labels[window.activityLoad]}（有效 ${validHours} 小时${sources}）`
    } catch {
      return '未知（读取失败）'
    }
  }

  async consoleOverview(): Promise<import('./console/index').HdsiOverview> {
    const tasks = ['main', 'compaction', 'timeline', 'alter', 'embedding', 'stickers', 'vision', 'research'] as const
    const models = tasks.map(task => {
      const route = this.modelRouting[task]
      const provider = route.providers[0]
      return {
        task, available: route.available, reason: route.reason,
        provider: route.available ? provider?.label || provider?.id || '未命名连接' : route.reason === 'disabled' ? '未启用' : '未配置',
        model: route.available ? (route.assigned ? provider?.model : route.target.model || provider?.model) || '未指定' : '—',
      }
    })
    let canonicalId = 'console'
    let storyBlock: import('./console/index').HdsiOverview['story'] = { found: false, characterName: '', participantCount: 0, entryCount: 0, status: '', cursorLocal: '', rhythm: '' }
    try {
      const story = await this.getCanonicalStory()
      if (story) {
        const participants = await this.participants(story.id)
        canonicalId = story.id
        const entryCount = await this.dbRead(() => this.ctx.database.eval('interlude_script_entry', row => $.count(row.id), { storyId: story.id }))
        const decoded = decodeStoryState(story.state)
        storyBlock = {
          found: true,
          characterName: story.setting.character?.name ?? '',
          participantCount: participants.length,
          entryCount,
          status: story.status,
          cursorLocal: formatStoryDisplayTime(story.cursorAt, story.setting.timezone),
          rhythm: decoded.lifeRhythm?.attention ?? '未建立',
        }
      }
    } catch { /* 无故事时用占位 */ }
    const researchDesk = this.researchDeskFor(canonicalId)
    researchDesk.snapshot(Date.now())
    const cache = this.researchToolsRegistry?.searchCache
    const densityStoryId = canonicalId
    const densityCounts = this.contextDensity.counts(densityStoryId, Date.now())
    return {
      version: HDS_INTERLUDE_VERSION,
      story: storyBlock,
      models,
      switches: [
        { key: 'allowProactiveMessages', label: '主动可见消息', value: this.config.runtime.allowProactiveMessages ? '开启' : '关闭', ok: this.config.runtime.allowProactiveMessages },
        { key: 'urge', label: 'Urge 弹性推进', value: this.urgeConfig.enabled ? '开启' : '关闭', ok: this.urgeConfig.enabled },
        // P4（§14.1）：旧 Agency 模式行退役，改为三行独立信息——出站边界、
        // 当前行动条件（来源+时效）、动作结果概览。
        {
          key: 'deliveryPolicy', label: '出站运行限制', ok: null,
          value: (() => {
            const policy = this.deliveryPolicyConfig
            const parts = [
              policy.proactivePerTargetDailyCap > 0 ? `上限 ${policy.proactivePerTargetDailyCap}/日` : '',
              policy.minimumRunIntervalMinutes > 0 ? `间隔 ${policy.minimumRunIntervalMinutes} 分钟` : '',
            ].filter(Boolean)
            return parts.length ? parts.join(' · ') : '无额外额度'
          })(),
        },
        {
          key: 'sceneConditions', label: '当前行动条件', ok: null,
          value: await this.sceneConditionSummary(),
        },
        { key: 'research', label: '考据 Agent', value: this.researchConfig.enabled ? '开启' : '关闭', ok: this.researchConfig.enabled },
        { key: 'jev', label: 'Jev 门控', value: this.researchConfig.jev.enabled ? (this.researchConfig.jev.apiKey ? `已开启（${this.researchConfig.jev.model}）` : '已开启 · 待配置密钥') : '未启用', ok: this.researchConfig.jev.enabled ? !!this.researchConfig.jev.apiKey : null },
      ],
      research: {
        enabled: this.researchConfig.enabled,
        backend: effectiveSearchBackend(this.researchConfig),
        deskEntries: researchDesk.size,
        counters: { ...researchDesk.counters },
        cache: { size: cache?.size ?? 0, hits: cache?.counters.hits ?? 0, misses: cache?.counters.misses ?? 0 },
        jev: { enabled: this.researchConfig.jev.enabled, keyConfigured: !!this.researchConfig.jev.apiKey, calls: this.researchJevCounters.calls, triggered: this.researchJevCounters.triggered },
      },
      density: {
        counts: densityCounts,
        tier: densityTier(densityCounts),
        effectiveLimit: this.effectiveContextBudget(densityStoryId, 'private', 'user-message', new Date()).count,
        mode: effectiveScopeMode(this.contextEntryConfig, 'private'),
        anchor: this.config.runtime.contextEntryLimit,
        scopes: { private: this.contextEntryConfig.private, group: this.contextEntryConfig.group },
        globalMode: this.contextEntryConfig.mode,
      },
      health: { successes: 0, retries: 0, failures: 0, avgLatencyMs: 0 },
    }
  }

  /** 配置中心持久化管线入口（console/config-center.ts 调用）：整树更新
   * 插件配置。ctx.scope 在 Service 上是 protected，经此公开；框架随后
   * 完成热更新与 loader 写回 koishi.yml（设计 §6.1）。 */
  updatePluginConfig(next: Config, reload = false): void {
    this.ctx.scope.update(next as never, reload)
  }

  /** Console 配置读取（hdsi/config/read 的数据源）。无活跃故事时 story 节
   * 返回空值而不是错误——页面据空值提示先启动故事。 */
  async consoleReadConfig(section: string): Promise<ConfigReadResult> {
    if (!isConfigSection(section)) return { ok: false, error: `未知节: ${section}` }
    if (section === 'story') {
      const story = await this.getCanonicalStory()
      if (!story) return { ok: true, values: {} }
      const s = story.setting as any
      return {
        ok: true,
        values: {
          'character.name': s.character?.name ?? '',
          'character.profile': s.character?.profile ?? '',
          'character.traits': Array.isArray(s.character?.traits) ? s.character.traits.join('\n') : (s.character?.traits ?? ''),
          'world': s.world ?? '',
          'location': s.location ?? '',
          'supportingCast': s.supportingCast ?? '',
          'style': s.style ?? '',
          'perspective': s.perspective ?? '',
          'defaultRelationship': s.defaultRelationship ?? '',
          'timezone': s.timezone ?? 'Asia/Shanghai',
        },
      }
    }
    if (section === 'runtime') {
      const rt = this.config.runtime as unknown as Record<string, unknown>
      return {
        ok: true,
        values: {
          contextEntryLimit: rt.contextEntryLimit ?? 18,
          contextEntryMode: rt.contextEntryMode ?? 'fixed',
          contextTimeWindowMinutes: rt.contextTimeWindowMinutes ?? 5,
          allowProactiveMessages: rt.allowProactiveMessages === true,
          userMessageDebounceSeconds: rt.userMessageDebounceSeconds ?? 3,
        },
      }
    }
    const r = (this.config.research ?? {}) as Record<string, unknown>
    return {
      ok: true,
      values: {
        enabled: r.enabled ?? false,
        searchBackend: r.searchBackend ?? 'auto',
        // 审计 F1：旧读取入口同样不得回传明文密钥（authority=1 可读）；
        // 掩码哨兵经旧保存路径（已并入配置中心持久化管线）提交时自动跳过。
        searchApiKey: typeof r.searchApiKey === 'string' && r.searchApiKey.length ? CONFIG_CENTER_SECRET_MASK : '',
        proxyAgent: r.proxyAgent ?? '',
        responseFormat: r.responseFormat ?? 'json-object',
        maxRounds: r.maxRounds ?? 2,
        taskTokenBudget: r.taskTokenBudget ?? 6_000,
        deskCapacity: r.deskCapacity ?? 8,
        stableFactTtlHours: r.stableFactTtlHours ?? 168,
        volatileFactTtlHours: r.volatileFactTtlHours ?? 12,
      },
    }
  }

  /** Console 配置写入（hdsi/config/save 的落地实现）。配置中心上线后
   * 本方法只处理 story 节（经 updateSetting 落库，跨重启持久）；
   * runtime/research 节在 rpc 层改走 applyConfigSectionPatch 持久化
   * 管线（scope.update → koishi.yml），不再进程内改写。 */
  async consoleSaveConfig(section: string, values: Record<string, unknown>): Promise<ConfigSaveResult> {
    if (!values || typeof values !== 'object') return { ok: false, error: 'invalid values' }
    if (!isConfigSection(section)) return { ok: false, error: `未知节: ${section}` }
    if (section !== 'story') return { ok: false, error: `节 ${section} 已迁移到配置中心持久化管线` }

    const story = await this.getCanonicalStory()
    if (!story) return { ok: false, error: '没有活跃故事' }
    const patch: Record<string, unknown> = {}
    let applied = 0
    for (const [key, value] of Object.entries(values)) {
      if (!EDITABLE_STORY_KEYS.has(key)) continue
      const parts = key.split('.')
      if (parts.length === 2 && parts[0] === 'character') {
        // character.traits 在表单里是换行分隔文本，落库回数组。
        const target = (patch.character ??= {}) as Record<string, unknown>
        target[parts[1]] = parts[1] === 'traits'
          ? String(value ?? '').split('\n').map(line => line.trim()).filter(Boolean)
          : value
      } else {
        patch[key] = value
      }
      applied++
    }
    if (applied) await this.updateSetting(story, patch as never)
    return { ok: true, applied }
  }

  /** Executes a due browser intent once, records its bounded observation, and
   * marks the future plan complete regardless of success. A failed browser is
   * still an event (the character could not access the page), but it never
   * blocks later dialogue or background life updates. */
  async executeDeferredBrowserIntent(story: InterludeStory, intent: NarrativeIntent, now: Date) {
    return executeDeferredBrowserIntent(this, story, intent, now)
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
          void Promise.resolve(operation).catch((): undefined => undefined)
        })
        page.on('popup', (popup: any): void => void popup.close().catch((): undefined => undefined))
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
        if (page) await page.close().catch((): undefined => undefined)
      }
    })
  }

  private async saveWebObservation(storyId: string, participantId: string, intentId: number | null, mode: 'search' | 'visit', query: string, url: string, title: string, excerpt: string, summary: string, status: WebObservation['status'], now: Date, persist = true): Promise<WebObservation> {
    // Issue #14：主键交给 AUTOINCREMENT。此前 candidate 硬编码 id:0——首次落库
    // 占用 0 后，第 2 次起必然 UNIQUE constraint failed 并沿调用链炸掉整轮
    // 已生成的回复。内存路径（persist=false）仍带占位 id:0，无消费方读取。
    const candidate: Omit<WebObservation, 'id'> = {
      storyId, participantId, intentId, mode, query: clip(query, 500), url: clip(url, 2_000), title: clip(title, 500),
      excerpt: clip(excerpt, this.browserConfig.maxExcerptCharacters), summary: clip(summary, this.browserConfig.maxExcerptCharacters),
      status, accessedAt: now, createdAt: now,
    }
    if (!persist) return { ...candidate, id: 0 }
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

  /** Issue #14：网页观察是旁路增强信息——单条落库失败只降级为 warn 并继续
   * 其余观察，绝不否决本轮已生成、可能已计费的回复投递。抽成独立方法以便
   * 直接回归（dbCreate 注入抛错 → 不上抛、逐条继续、留下可定位日志）。 */
  /** D3a：经 narrative/turn-executor 以宿主身份调用，可见性放宽。 */
  async persistImmediateObservations(story: InterludeStory, participantId: string, observations: WebObservation[], phase: NarrativeRequest['phase']) {
    for (const observation of observations) {
      try {
        await this.persistCollectedWebObservation(observation)
      } catch (error) {
        this.reportOperation('standard', 'warn', story, phase,
          '网页观察落库失败（已跳过该条，不影响本轮回复） 参与者=%s 错误=%s', participantId, error instanceof Error ? error.message : String(error))
      }
    }
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
  /** D3a：经 narrative/turn-executor 以宿主身份调用，可见性放宽。 */
  async cancelPendingNarrativeRetries(story: InterludeStory, participantId: string, now: Date) {
    const pending = await this.dbGet('interlude_intent', { storyId: story.id, participantId, status: 'pending', type: 'narrative-retry' })
    if (!pending.length) return
    await this.dbSet('interlude_intent', { id: { $in: pending.map(intent => intent.id) } }, { status: 'cancelled', updatedAt: now })
    this.reportOperation('standard', 'info', story, 'user-message', '已取消遗留的叙事重试意图 参与者=%s 数量=%d', participantId, pending.length)
  }

  private async scheduleNarrativeRetry(storyId: string, participantId: string, now: Date, previousAttempts = 0) {
    // 重载/停机期间的失败不是提供商故障：重试意图持久化在数据库里，会在
    // 新实例上以 userInitiated 投递一条过期回复——直接放弃本轮调度。
    if (this.disposed) return false
    const delaySeconds = Math.max(5, this.config.runtime.narrativeRetryDelaySeconds ?? 15)
    const maxAttempts = Math.max(0, this.config.runtime.narrativeRetryMaxAttempts ?? 6)
    const pending = await this.dbGet('interlude_intent', { storyId, participantId, status: 'pending' })
    const existing = pending.filter((intent: any) => intent.type === 'narrative-retry')
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
    // 重试延迟是秒级的：注册到期唤醒，否则意图只能等 sweepIntervalMinutes 的
    // 周期网格（默认 5 分钟）——issue #3：日志说“等待=15秒”实际最多等 5 分钟。
    // 与 scheduleStreamScriptRecovery 同理（该函数自始就有唤醒）。
    this.scheduleDueIntentWake(storyId, notBefore)
    this.reportStandalone('warn', '叙事模型请求失败，已安排自动重试 故事=%s 参与者=%s 次数=%d/%d 等待=%d秒', storyId, participantId, attempt, maxAttempts, delaySeconds)
    return true
  }

  async dueIntents(storyId: string, now: Date) {
    return dueIntents(this, storyId, now)
  }
  async upcomingNarrativeIntents(storyId: string, now: Date) {
    return upcomingNarrativeIntents(this, storyId, now)
  }
  /** Wake the scheduler close to a short typing delay instead of waiting for
   * the normal background sweep. The due intent remains the source of truth. */
  scheduleDueIntentWake(storyId: string, notBefore: Date) {
    return scheduleDueIntentWake(this, storyId, notBefore)
  }
  /** 到期唤醒的执行体：分段消息直投；sweep 繁忙或前台回合未结束时返回 'busy'，由 scheduler 短候重排。 */
  async wakeDueIntents(storyId: string): Promise<'busy' | void> {
    return wakeDueIntents(this, storyId)
  }
  async reconcileTerminalSplitIntent(storyId: string, intent: NarrativeIntent, now: Date) {
    return reconcileTerminalSplitIntent(this, storyId, intent, now)
  }
  async pendingSplitSegments(storyId: string) {
    return pendingSplitSegments(this, storyId)
  }
  /** Called in the story queue, after transport work and before any narration. */
  async deferDueIntentsBehindPendingSplits(story: InterludeStory, due: NarrativeIntent[], splits: NarrativeIntent[], now: Date) {
    return deferDueIntentsBehindPendingSplits(this, story, due, splits, now)
  }
  /** 参与到期唤醒补排的意图族 = 创建时即注册 scheduleDueIntentWake 的类型。
   *  排除项及理由：
   *  - active-consequence：常驻 intent 表但“永远不是调度工作”，且 notBefore
   *    可能在过去——进入补排会造成“立即触发→无事可做→再补排”的死循环；
   *  - 模型自主规划意图（decision.intents，含 follow-up-commitment）：分钟级
   *    以上尺度，按设计契约走 sweep 网格（见 appendIntent 调用点注释）。 */
  /** 为最早的未到期唤醒意图补排计时器（keep-earliest 仲裁，重复调用安全）。
   *  只看严格未来的 notBefore——已到期的行属于 wakeDueIntents/sweep 的消费范围，
   *  补排指过去只会空转。 */
  async scheduleNextPendingWake(storyId: string) {
    return scheduleNextPendingWake(this, storyId)
  }
  /** Deliver already-decided <sep/> segments without invoking the narrator. */
  async deliverDueSplitSegments(storyId: string) {
    return deliverDueSplitSegments(this, storyId)
  }
  /** Pending spoken promises are intentionally tiny and relationship-local. */
  async pendingFollowUpCommitments(storyId: string, participantId: string, now = new Date()) {
    return pendingFollowUpCommitments(this, storyId, participantId, now)
  }
  /** Expiration retires a scheduler task, not a fictional fulfilled promise. */
  async retireExpiredFollowUps(storyId: string, intents: NarrativeIntent[], now: Date) {
    return retireExpiredFollowUps(this, storyId, intents, now)
  }
  async appendFollowUpCommitment(
    story: InterludeStory,
    participantId: string,
    draft: FollowUpCommitmentDraft,
    fallbackSourceEntryId: number | undefined,
    now: Date,
    originDeliveryEventId?: string,
  ) {
    return appendFollowUpCommitment(this, story, participantId, draft, fallbackSourceEntryId, now, originDeliveryEventId)
  }
  async applyFollowUpResolutions(
    storyId: string,
    participantId: string,
    resolutions: FollowUpResolutionDraft[],
    interaction: NarrativeInteraction | undefined,
    now: Date,
    deliveryEventId?: string,
  ) {
    return applyFollowUpResolutions(this, storyId, participantId, resolutions, interaction, now, deliveryEventId)
  }
  async deferUnresolvedDueFollowUps(
    storyId: string,
    participantId: string,
    contextIntents: NarrativeIntent[],
    resolvedIds: Set<number>,
    _interaction: NarrativeInteraction | undefined,
    now: Date,
  ) {
    return deferUnresolvedDueFollowUps(this, storyId, participantId, contextIntents, resolvedIds, _interaction, now)
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

  async cancelPendingOutgoingMessages(storyId: string, participantId: string, now: Date, cancelPlanned = true) {
    try {
      const intents = await this.dbGet('interlude_intent', { storyId, participantId, status: 'pending' })
      const matching = intents.filter((intent: any) => intent.participantId === participantId && (
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
      await this.scheduleNextPendingWake(storyId)
      const interruptedDrafts = matching
        .filter((intent: any) => intent.type === 'split-message')
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

  async sendCrossGroupMessage(
    story: InterludeStory,
    message: OutgoingMessageDraft,
    session?: Session,
    failureStatus: 'failed' | 'pending' = 'failed',
    shouldCancel: () => boolean = () => false,
  ) {
    return sendCrossGroupMessage(this, story, message, session, failureStatus, shouldCancel)
  }
  deliveryExecutionKey(storyId: string, message: OutgoingMessageDraft, segment = false) {
    return deliveryExecutionKey(this, storyId, message, segment)
  }
  async successfulDeliveryEntry(storyId: string, message: OutgoingMessageDraft) {
    return successfulDeliveryEntry(this, storyId, message)
  }
  /** No waiting for another executor inside story serial: its confirmation may
   * need that same serial. A competing recovery/split simply tries later. */
  async deliverOutgoingMessages(
    story: InterludeStory, messages: OutgoingMessageDraft[], current?: InterludeParticipant,
    session?: Session, shouldCancel?: (target: InterludeParticipant) => boolean, recordFailures = true,
    requestStartedAt?: Date, failureStatus: 'failed' | 'pending' = 'failed', splitSegment = false, confirmedEntries?: ScriptEntry[],
  ) {
    return deliverOutgoingMessages(this, story, messages, current, session, shouldCancel, recordFailures, requestStartedAt, failureStatus, splitSegment, confirmedEntries)
  }
  async deliveryLedgerConfirmed(storyId: string, message: OutgoingMessageDraft) {
    return deliveryLedgerConfirmed(this, storyId, message)
  }
  async sendOutgoingMessages(
    story: InterludeStory,
    messages: OutgoingMessageDraft[],
    current?: InterludeParticipant,
    session?: Session,
    shouldCancel?: (target: InterludeParticipant) => boolean,
    recordFailures = true,
    requestStartedAt?: Date,
    failureStatus: 'failed' | 'pending' = 'failed',
  ) {
    return sendOutgoingMessages(this, story, messages, current, session, shouldCancel, recordFailures, requestStartedAt, failureStatus)
  }
  /** Confirm visible delivery only after the platform accepted the message.
   * Failed attempts become explicit system evidence rather than fictional
   * character speech, and deliberately do not auto-retry to avoid duplicates
   * when an adapter fails after it has already accepted a request. */
  async confirmOutgoingDeliveries(story: InterludeStory, delivered: OutgoingMessageDraft[], splitSegment = false) {
    return confirmOutgoingDeliveries(this, story, delivered, splitSegment)
  }
  async recordOutgoingDeliveryFailure(
    story: InterludeStory,
    participantId: string,
    message: OutgoingMessageDraft,
    reason: string,
    status: 'failed' | 'pending' = 'failed',
  ) {
    return recordOutgoingDeliveryFailure(this, story, participantId, message, reason, status)
  }
  /** Issue #10 根因 B：本轮可见投递被整体撤回时，同一轮新写、指向同一参与者
   * 的模型意图（提醒/余波/后续）可能携带"已发出"的中毒前提进入后续轮次——
   * dueIntents 的 summary 与 payload 都会再进 prompt，而剧本正文里的既成叙述
   * 不会回改。host 无法语义判别哪些意图预设了发送，按"本轮创建 + 参与者与
   * 被撤回行动一致"圈定风险集，注入显式中和注记：不删除、不改 status，到
   * 期轮次仍由模型结合注记自行决断。幂等：已注记的意图不重复加尾缀。 */
  private async annotateWithdrawnTurnIntents(
    story: InterludeStory,
    turnIntentIdCeiling: number,
    participantIds: ReadonlySet<string>,
    reason: string,
    now: Date,
  ) {
    if (!participantIds.size) return
    const rows = await this.dbGet('interlude_intent', {
      storyId: story.id, status: 'pending', id: { $gt: turnIntentIdCeiling }, participantId: { $in: [...participantIds] },
    }) as NarrativeIntent[]
    let annotated = 0
    for (const intent of rows) {
      if (isRecord(intent.payload) && intent.payload.sendWithdrawnTurn) continue
      await this.dbSet('interlude_intent', { id: intent.id }, {
        summary: `${intent.summary}［注：同轮拟发送消息从未发出（${clip(reason, 80)}），不要假定对方已收到］`,
        payload: { ...(isRecord(intent.payload) ? intent.payload : {}), sendWithdrawnTurn: clip(reason, 200), sendWithdrawnAt: now.toISOString() },
        updatedAt: now,
      })
      annotated += 1
    }
    if (annotated) {
      this.reportOperation('standard', 'info', story, 'advance',
        '已为同轮新意图注入未发送中和注记 数量=%d 参与者=%s 原因=%s', annotated, [...participantIds].join(','), clip(reason, 120))
    }
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
  async updateScriptDeliveryOutcome(
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
    return updateScriptDeliveryOutcome(this, storyId, reference, status, at, reason)
  }
  async recordPlatformDeliveryOutcome(
    storyId: string,
    reference: ScriptDeliveryReference,
    // 审计 P1-3：放宽允许 'pending'——桌面动作代理 ambiguous（结果未知）时使用。
    // 平台动作（local-media/native-face）不在补偿回放的 kind 过滤内，记 pending
    // 不会触发自动重发，账本如实反映"可能已发送"而非谎报 failed。
    status: ScriptDeliverySegmentStatus,
    reason?: string,
  ) {
    return recordPlatformDeliveryOutcome(this, storyId, reference, // 审计 P1-3：放宽允许 'pending'——桌面动作代理 ambiguous（结果未知）时使用。
    // 平台动作（local-media/native-face）不在补偿回放的 kind 过滤内，记 pending
    // 不会触发自动重发，账本如实反映"可能已发送"而非谎报 failed。
    status, reason)
  }
  async resolveLiteralQuoteMessageId(storyId: string, participantId: string, content: string) {
    return resolveLiteralQuoteMessageId(this, storyId, participantId, content)
  }
  /** Records only completed background deliveries. It is intentionally a
   * bounded action ledger, rather than a duplicate conversation transcript. */
  async recordAutomaticDelivery(
    storyId: string,
    participantId: string,
    delivery: NonNullable<OutgoingMessageDraft['automaticDelivery']>,
    now: Date,
  ) {
    return recordAutomaticDelivery(this, storyId, participantId, delivery, now)
  }
  splitOutgoingMessage(content: string) {
    return splitOutgoingMessage(this, content)
  }
  typingDelayMilliseconds(nextSegment: string) {
    return typingDelayMilliseconds(this, nextSegment)
  }
  /** 首条发言的打字时间下限：以叙事请求发起时刻为基准，模型耗时不足
   * typingDelay(首条字数) 时返回需补足的毫秒数；耗时已超过则返回 0（立即发送）。
   * elapsed 以 0 为下限——起点时间戳异常（时钟偏差）不会反向放大等待。 */
  firstMessageTypingHoldMs(content: string, requestStartedAt: Date) {
    return firstMessageTypingHoldMs(this, content, requestStartedAt)
  }
  findBotForParticipant(participant: InterludeParticipant) {
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
    // P3.2：Urge 不再携带意愿门槛（§9 退役）——运行时阈值字段对裁决已无
    // 消费者，保持原样透传。
    return this.config.runtime
  }

  private async scheduleUrgeAdvance(story: InterludeStory, anchor: Date, incoming = false) {
    const config = this.urgeConfig
    const state = decodeStoryState(story.state)
    let urge = normalizeUrgeState(state.extensions?.urge, anchor.getTime())
    if (incoming) urge = urgeUserEvent(urge, anchor.getTime())
    const rest = activeRestWindow(this.autoAdvanceConfig.restWindows, story.setting.timezone, anchor)
    const window = activeAgencyWindow(state.agencyWindow, anchor)
    // 五档生活节奏：压缩器主写/主叙事或入站覆盖；stale 时走 restMultiplier 兜底。
    // 7.1.4：生活节奏唯一事实源——旧 lifeStatus 由 story-state 加载迁移并入。
    const rhythmRaw = state.lifeRhythm
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
        automation: { ...state.automation, conversationFollowUpAt: [], conversationFollowUpParticipantId: undefined,
          ...(incoming ? { lastUserMessageAt: anchor.toISOString() } : {}), nextAdvanceAt: next.toISOString() },
      }), updatedAt: anchor,
    })
    this.reportOperation('standard', 'info', story, 'advance', 'Urge 调度 档位=%s 原因=%s 节奏=%s%s 下次=%s',
      config.frequency, planned.reason,
      rhythm?.attention ?? '(无)',
      rhythm?.stale === true ? '(stale)' : '',
      formatLogTime(next, story.setting.timezone))
  }

  /** 入站消息→节奏提升:asleep/resting → phone-focused(source: incoming)。
   * 已是 phone-focused 但评估过期（>2h 无更新）时仅续期 assessedAt——消息
   * 到达即"仍在看手机"的最新证据；不续期会让持续对话在 2 小时后节奏 stale，
   * Urge 推进无端退化到兜底因子（phone-focused 1.4 → 1.0，间隔慢 40%）。
   * 仅私聊路径调用：群消息的节奏由压缩器与主叙事交接维护。 */
  async elevateRhythmOnIncoming(storyId: string, now: Date) {
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
      } else if (rhythm?.attention === 'phone-focused' && lifeRhythmStale(rhythm, now.getTime())) {
        await this.dbSet('interlude_story', { id: storyId }, {
          state: encodeStoryState({ ...state, lifeRhythm: { ...rhythm, assessedAt: now.toISOString(), source: 'incoming' } }), updatedAt: now,
        })
        this.reportOperation('diagnostic', 'debug', story, 'user-message', '生活节奏续期 phone-focused(入站触发，原评估已过期)')
      }
    } catch { /* 节奏提升是尽力而为;失败不阻塞入站消息 */ }
  }

  private dueConversationFollowUps(story: InterludeStory, now: Date) {
    if (this.urgeConfig.enabled) return []
    const planned = (story.state.automation?.conversationFollowUpAt ?? [])
      .map(toDate)
      .filter((value): value is Date => !!value)
      .sort((left: any, right: any) => left.getTime() - right.getTime())
    return planned.filter(value => value <= now)
  }

  /** Remove elapsed short passes after their single writing turn. The next
   * remaining pass stays persisted, so reloads never restart the 10/20-minute
   * sequence or accidentally run both passes at once. */
  private async completeConversationFollowUps(storyId: string, now: Date) {
    const story = await this.getStory(storyId)
    const remaining = (story.state.automation?.conversationFollowUpAt ?? [])
      .map(toDate)
      .filter((value: Date | undefined): value is Date => !!value && value > now)
      .sort((left: Date, right: Date) => left.getTime() - right.getTime())
    const automation = {
      ...(story.state.automation ?? {}),
      conversationFollowUpAt: remaining.map((value: Date) => value.toISOString()),
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

  async pauseAutomaticAdvanceAfterUserMessage(storyId: string, now: Date) {
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

  userAccountRule(userId: string) {
    const accounts = this.config.onebot?.userAccounts ?? []
    const normalized = normalizeAccountId(userId)
    return accounts.find(account => account.enabled !== false && normalizeAccountId(account.qq) === normalized)
  }

  private async getParticipant(id: string) {
    return (await this.dbGet('interlude_participant', { id }))[0]
  }

  async recordIncomingMessage(participant: InterludeParticipant, now: Date) {
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

  async recordCharacterMessage(participant: InterludeParticipant, now: Date) {
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
    await this.recordStoryAlias(legacy.id, story.id, 'legacy-story-migration').catch((): undefined => undefined)
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

  compactionFingerprint(scene: InterludeScene, entries: ScriptEntry[], chars: number) {
    const first = entries[0]?.id ?? 0
    const last = entries.at(-1)?.id ?? 0
    return `${scene.id}:${scene.lastEntryId ?? 0}:${first}-${last}:${entries.length}:${chars}`
  }

  compactionIsBackedOff(storyId: string, fingerprint: string, now = Date.now()) {
    return this.scheduler.isBackedOff(storyId, fingerprint, now)
  }

  noteCompactionFailure(storyId: string, fingerprint: string, error: unknown) {
    const until = Date.now() + COMPACTION_RETRY_BACKOFF
    this.scheduler.noteBackoff(storyId, fingerprint, until)
    this.reportStandaloneOperation('diagnostic', 'debug', '记忆整理进入冷却 故事=%s 冷却至=%s 错误=%s', storyId, new Date(until).toISOString(), error)
  }

  /** Confirm the database checkpoint moved after a successful compactor call.
   * A provider response alone is not enough: if the write was lost or
   * interrupted, retrying the same range on every turn would recreate the
   * token-burning loop this guard is meant to stop. */
  async compactionCheckpointAdvanced(context: PreparedCompactionRun) {
    return compactionCheckpointAdvanced(this, context)
  }
  scheduleCompaction(storyId: string) {
    return scheduleCompaction(this, storyId)
  }
  // ── QQ 空间（说说）通道：门控 → 审计 → 动作 → 回写 ─────────────────────
  // 通道只负责安全执行；"何时发/发什么"的决策由叙事层（后续版本）与手动命令提供。

  /** 从当前在线的 OneBot（SnowLuma/NapCat）连接取通用动作调用口。
   * 指定 preferSelfId 时严格匹配该账号——空间动作落在别的 QQ 上比失败更糟。 */
  qzoneCaller(preferSelfId?: string): QzoneActionCaller | undefined {
    return qzoneCaller(this, preferSelfId)
  }
  /**
   * 执行一条空间动作（发帖/评论/点赞）：限流门 → pending 审计行（在故事串行
   * 队列内原子预留配额）→ SnowLuma 动作（网络调用留在队列外）→ 回写
   * confirmed/failed/unknown。传输类异常与“成功帧但无 tid”都记 unknown——
   * 结果不明按已发生保守计入配额，且绝不自动重试非幂等动作。
   */
  async qzoneExecute(story: InterludeStory, kind: QzoneActionKind, input: { content?: string, tid?: string, targetUin?: string, ugcRight?: number }, preferSelfId?: string): Promise<{ ok: boolean, tid?: string, error?: string }> {
    return qzoneExecute(this, story, kind, input, preferSelfId)
  }
  /** 通道能力探测（只读）：SnowLuma 的 qzone 扩展是否可用。 */
  async qzoneAvailable(preferSelfId?: string): Promise<boolean> {
    return qzoneAvailable(this, preferSelfId)
  }
  /**
   * 到期 qzone-action 意图的执行侧：payload 校验 → 限流门 → 动作 → 完成意图。
   * 坏 payload / 限流 / 通道失败都直接完成意图（成败进审计表），不回流叙事。
   */
  async executeQzoneIntent(story: InterludeStory, intent: NarrativeIntent, now: Date) {
    return executeQzoneIntent(this, story, intent, now)
  }
  /** 好友动态轮询：感知零模型调用——新鲜说说写成 [好友动态] 条目，反应留给回合内决策。 */
  qzoneFeedSweepRunning = false // P3：qzone-executor 经宿主引用读写（轮询互斥）

  async qzoneFeedSweep() {
    return qzoneFeedSweep(this)
  }
  /** 被评论感知：她的说说评论数增量轮询。感知零动作配额；产出 [空间动态] 条目
   * （ SOCIAL SURFACE 规则现成，零提示词改动），由下一次推进（自动或对话）自然
   * 携带——轮询本身绝不调度推进（用户要求：被赞不立即开 advance）。 */
  async qzoneReactionSweep(
    story: InterludeStory,
    caller: QzoneActionCaller,
    address: { platform: string, selfId: string },
    now: Date,
  ) {
    return qzoneReactionSweep(this, story, caller, address, now)
  }
  // ── 端点注册表（M1a）：迁移/加载/解析/状态 ────────────────────────────────
  // 规格见 docs/MULTI_CHANNEL_SINGLE_STORY_DESIGN.md v3 §二/§三/§四。
  // 单平台零影响：注册表未命中时一律回落旧路径（undefined），绝不自动挂载。

  /** 加载并补齐端点注册表（幂等）：active 故事/参与者/启用的群规则派生行。 */
  /** 加载并补齐端点注册表（幂等 + 单飞：并发调用共享同一次 reconcile）。 */
  private endpointRegistryInFlight: Promise<void> | undefined

  /** 端点/别名运行期写队列：所有注册表变更串行执行，杜绝并发"查后写"重复。 */
  endpointWriteQueue: Promise<unknown> = Promise.resolve() // P4：endpoint-registry 经宿主引用读写

  enqueueEndpointWrite<T>(task: () => Promise<T>): Promise<T> {
    return enqueueEndpointWrite(this, task)
  }
  /** Keep health snapshots durable without making connector lifecycle writes part of
   * the message transaction. The global DB writer still serializes physical writes. */
  persistEndpointState(endpointId: string, state: EndpointState) {
    return persistEndpointState(this, endpointId, state)
  }
  setEndpointState(endpointId: string, state: EndpointState) {
    return setEndpointState(this, endpointId, state)
  }
  endpointGateReason(endpointId: string | undefined, now = Date.now(), options?: { ignoreCooldown?: boolean }): string | undefined {
    return endpointGateReason(this, endpointId, now, options)
  }
  /** 端点行在 ctx.bots 里的实时在线对应物（按平台隔离账号键匹配）。 */
  liveBotForEndpoint(row: EndpointRow) {
    return liveBotForEndpoint(this, row)
  }
  /**
   * Agency uses the normal delivery gate plus the optional channel-specific
   * initiation gate.  EndpointState.initiate is intentionally optional: QQ
   * and other transports without a context-token concept remain compatible
   * with the historical proactive path, while a present-but-expired token is
   * a hard, explicitly classified failure.
   */
  endpointInitiateGateReason(endpointId: string | undefined, now = Date.now()): string | undefined {
    return endpointInitiateGateReason(this, endpointId, now)
  }
  endpointForDelivery(endpointId: string | undefined, owner: { kind: 'story-role' | 'participant-user' | 'group', id: string }, now = Date.now(), options?: { ignoreCooldown?: boolean }): { row?: EndpointRow, reason?: string } {
    return endpointForDelivery(this, endpointId, owner, now, options)
  }
  async ensureEndpointRegistry() {
    return ensureEndpointRegistry(this)
  }
  async reconcileEndpointRegistry() {
    return reconcileEndpointRegistry(this)
  }
  /** 运行期增量登记：故事/参与者创建时同步 upsert 端点行。
   * 经写队列串行执行；先落库成功才进内存；失败置脏（下次 reconcile
   * 重试）——绝不留下"进程内有、重启即无"的幽灵端点，也不让登记失败被静默
   * 吞掉后触发陌生账号拒绝（置脏保证 findStory 下次会重新 reconcile 补上）。 */
  async registerStoryRoleEndpointRow(story: { id: string, platform: string, selfId: string }) {
    return registerStoryRoleEndpointRow(this, story)
  }
  async registerParticipantUserEndpointRow(participant: { id: string, platform: string, selfId: string, userId: string }) {
    return registerParticipantUserEndpointRow(this, participant)
  }
  /** qzone 审计行 endpointId 回填：旧行按 storyId → 该故事角色端点归因。 */
  async backfillQzoneEndpointIds() {
    return backfillQzoneEndpointIds(this)
  }
  /**
   * 登记剧本别名（幂等）：既有行指向相同 canonical → 无操作；指向不同
   * canonical → 冲突告警一次且不覆盖（人工裁决）；成功则落行并更新缓存。
   */
  async recordStoryAlias(aliasStoryId: string, canonicalStoryId: string, reason: string, announce = true): Promise<boolean> {
    return recordStoryAlias(this, aliasStoryId, canonicalStoryId, reason, announce)
  }
  /** 别名解析：链式（双射失败）或悬空（canonical 无故事）→ undefined + 一次性告警。 */
  async resolveStoryIdAlias(aliasStoryId: string): Promise<string | undefined> {
    return resolveStoryIdAlias(this, aliasStoryId)
  }
  /** M1b 回滚：删除一条别名重定向并留审计。行删除即回滚生效（双向可达由 canonicalStoryId 索引保证）。 */
  async removeStoryAlias(aliasStoryId: string, reason = 'manual-rollback'): Promise<{ ok: boolean, error?: string }> {
    return removeStoryAlias(this, aliasStoryId, reason)
  }
  /** M1b 只读视图：列出当前别名（管理命令用）。 */
  listStoryAliases(): StoryAliasRecord[] {
    return listStoryAliases(this)
  }
  // ── 角色端点管理（的显式迁移路径）：账号变更只能经此，入站永不改绑 ──

  /** 注册一个角色端点到既有故事（幂等；accountKey 被其他故事占用时拒绝）。
   * 经写队列串行执行——并发 add 不会双双重叠冲突检查；落库失败
   * 不进内存且返回失败。 */
  async addStoryEndpoint(story: InterludeStory, platform: string, selfId: string, channelKind: EndpointChannelKind = 'qq'): Promise<{ ok: boolean, endpointId?: string, error?: string }> {
    return addStoryEndpoint(this, story, platform, selfId, channelKind)
  }
  /** 停用一个角色端点（身份与历史保留；enabled=false 后其消息按陌生账号处理）。 */
  async disableStoryEndpoint(endpointId: string): Promise<{ ok: boolean, error?: string }> {
    return disableStoryEndpoint(this, endpointId)
  }
  /** M3 §八：解析参与者最近活跃端点（EndpointState.connection.observedAt 最新；无则 undefined）。 */
  resolveMostActiveEndpointId(participantId: string): string | undefined {
    return resolveMostActiveEndpointId(this, participantId)
  }
  /**
   * Decide whether the narrator needs the multi-platform transport contract.
   * One platform, including several accounts on that platform, keeps the
   * lightweight legacy prompt. Only enabled endpoints that are legal targets
   * for this request are considered; the complete registry is never exposed.
   */
  narrativeEndpointSelection(
    story: InterludeStory,
    participants: InterludeParticipant[],
    groups: Array<{ participantId: string, groupId: string, label: string }>,
  ): { enabled: boolean, options: NarrativeEndpointOption[] } {
    return narrativeEndpointSelection(this, story, participants, groups)
  }
  // ── M2 §1.2：用户端点链接（同一个人的另一个号链入既有参与者）──────────────

  /** 链接用户端点到既有参与者（幂等；accountKey+userId 已属其他参与者时拒绝）。 */
  async linkParticipantEndpoint(participant: InterludeParticipant, platform: string, userId: string): Promise<{ ok: boolean, endpointId?: string, error?: string }> {
    return linkParticipantEndpoint(this, participant, platform, userId)
  }
  /** 解除链接（可撤销；身份与历史保留，enabled=false）。 */
  async unlinkParticipantEndpoint(endpointId: string): Promise<{ ok: boolean, error?: string }> {
    return unlinkParticipantEndpoint(this, endpointId)
  }
  /** 列出参与者名下全部用户端点（含启用状态）。 */
  listParticipantEndpoints(participantId: string) {
    return listParticipantEndpoints(this, participantId)
  }
  /** 解析故事的任一角色端点的 accountKey（供用户端点确定通道归属）。 */
  resolveRoleAccountKey(storyId: string, platform: string): string {
    return resolveRoleAccountKey(this, storyId, platform)
  }
  /** 列出故事的全部角色端点（含在线状态）。 */
  listStoryEndpoints(storyId: string) {
    return listStoryEndpoints(this, storyId)
  }
  /** 入站反向解析（v3 §三）：accountKey → 端点行；未注册返回 undefined（回落旧路径）。 */
  async resolveInboundEndpointFor(source: { platform: string, selfId: string, userId?: string, groupId?: string, channelId?: string }) {
    return resolveInboundEndpointFor(this, source)
  }
  /** 条目通道上下文（v3 §十）：注册表命中才返回；未迁移/陌生账号不标注（单平台零影响）。 */
  async channelMetadataFor(source: { platform: string, selfId: string, userId?: string, groupId?: string, channelId?: string }, extra: { userId?: string, groupId?: string, channelId?: string } = {}) {
    return channelMetadataFor(this, source, extra)
  }
  /** 入站触达端点状态：连接在线 + 可投递 + 微信主动资格刷新（v3 §四）。 */
  async touchEndpointStateInbound(source: { platform: string, selfId: string, userId?: string, groupId?: string, channelId?: string }) {
    return touchEndpointStateInbound(this, source)
  }
  /** 将当前 Koishi bot 快照同步到已加载的端点注册表。
   * 这是重启后的实时连接证据，不会恢复历史快照中的 online 真值。
   */
  async syncCurrentBotConnections() {
    return syncCurrentBotConnections(this)
  }
  /** 连接器在线状态回写（连接/断开事件；v3 §四 connection 维）。 */
  noteEndpointConnection(accountKey: string, online: boolean) {
    return noteEndpointConnection(this, accountKey, online)
  }
  endpointDriftWarned = new Set<string>()

  /**
   * M1a 出站地址解析（v3 §五）：注册表命中且启用时以注册表为准，并核对旧字段
   * （漂移只告警一次）；未命中/注册表未加载时回落旧字段——单平台零影响。
   * 同一 owner 多行时不再"取第一行"——优先最近观测过连接的端点，
   * 平手按 createdAt 稳定排序，并一次性告警（M2 起多端点归因的正确性基础）。
   */
  endpointAddressSync(legacy: { platform: string, selfId: string }, owner?: { kind: 'story-role' | 'participant-user', id: string }): { platform: string, selfId: string, endpointId?: string } {
    return endpointAddressSync(this, legacy, owner)
  }
  /** 出站结果回写端点状态（v3 §四 deliverable 维；内存无副作用）。
   * 提供 address 时只更新地址匹配的端点——多端点下不串刷兄弟端点。 */
  noteEndpointOutbound(owner: { kind: 'story-role' | 'participant-user' | 'group', id: string }, ok: boolean, note: string, address?: { platform: string, selfId: string }) {
    return noteEndpointOutbound(this, owner, ok, note, address)
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
  async weatherSweep() {
    return weatherSweep(this)
  }
  worldSeederSweepRunning = false

  async worldSeederSweep() {
    return worldSeederSweep(this)
  }
  /** 上下文 payload：环境（时区/季节/世界设定）、历史剧本（压缩摘录）、
   * 关系网（拉黑名单）、主角所为（workingDetails + 场景/弧摘要）。 */
  async buildWorldSeederPayload(story: InterludeStory, now: Date, recentSummaries: string[], domain?: WorldSeedDomain) {
    return buildWorldSeederPayload(this, story, now, recentSummaries, domain)
  }
  async worldSeederBlockedNames(storyId: string) {
    return worldSeederBlockedNames(this, storyId)
  }
  /** 到期排水：claim-then-append，先进账的条目本回合 recentScript 即可见。
   * 低重要性只在推进/跟进回合注入，避免劫持对话回合。 */
  async drainDueSeededEvents(story: InterludeStory, now: Date, includeLow: boolean) {
    return drainDueSeededEvents(this, story, now, includeLow)
  }
  async compactStories() {
    return compactStories(this)
  }
  /** 复核退避/对话推迟会让 materializedDays 的 [今天,明天] 槽位缺失，窗口静默变空。
   * 取记录时若两个槽位都没有物化天，先本地无模型重物化（锚定今天）再算窗口。 */
  async currentSchedulePreplanWindow(story: InterludeStory, at: Date) {
    return currentSchedulePreplanWindow(this, story, at)
  }
  async getSchedulePreplan(storyId: string) {
    return getSchedulePreplan(this, storyId)
  }
  // ── Long-Horizon Narrative Guidance（Narrative Attractor）────────────────
  private longHorizonConfig = resolveLongHorizonConfig(undefined)
  longHorizonSweepRunning = new Set<string>()
  private longHorizonLastScore = new Map<string, number>()
  longHorizonGenerationRunning = new Set<string>()
  /** 生成失败/归一化拒绝后的冷却：无 active 指导时 first-trigger 恒为真，
   *  不加冷却会每个 sweep 重打一次模型（错误刷屏与 token 浪费的放大器）。 */
  private longHorizonGenerationCooldownUntil = new Map<string, number>()
  /** Story ids whose active guidance row has already been loaded for this process. */
  private longHorizonGuidanceLoaded = new Set<string>()

  async longHorizonSweep(story: InterludeStory, _now?: Date) {
    return longHorizonSweep(this, story, _now)
  }
  async longHorizonProgress(storyId: string): Promise<LongArcProgressRow | undefined> {
    return longHorizonProgress(this, storyId)
  }
  async saveLongHorizonProgress(progress: LongArcProgressRow) {
    return saveLongHorizonProgress(this, progress)
  }
  async getActiveLongArcGuidance(storyId: string): Promise<LongArcGuidanceRecord | undefined> {
    return getActiveLongArcGuidance(this, storyId)
  }
  async ensureLongHorizonGuidanceLoaded(storyId: string) {
    return ensureLongHorizonGuidanceLoaded(this, storyId)
  }
  async longHorizonGenerate(story: InterludeStory, evidence: ScriptEntry[], currentScore: number, progress: LongArcProgressRow) {
    return longHorizonGenerate(this, story, evidence, currentScore, progress)
  }
  async longHorizonInput(story: InterludeStory, eligible: ScriptEntry[]): Promise<Record<string, unknown>> {
    return longHorizonInput(this, story, eligible)
  }
  /** 主叙事注入用的裁剪投影：催化器只提供行动许可，不提供强制剧情。 */
  longHorizonPromptProjection(storyId: string): string | undefined {
    return longHorizonPromptProjection(this, storyId)
  }
  private activeLongArcGuidanceCache = new Map<string, LongArcGuidanceRecord>()

  async schedulePreplanEvidence(storyId: string, afterEntryId: number) {
    return schedulePreplanEvidence(this, storyId, afterEntryId)
  }
  async saveSchedulePreplan(record: SchedulePreplanRecord) {
    return saveSchedulePreplan(this, record)
  }
  async prepareSchedulePreplanReview(story: InterludeStory, now: Date) {
    return prepareSchedulePreplanReview(this, story, now)
  }
  /** Preplan has one small independent request instead of competing with
   * scene/fact compression. One recovery retry is cheap and covers providers
   * that occasionally omit an otherwise valid JSON object. */
  async requestSchedulePreplan(story: InterludeStory, request: SchedulePreplanReviewRequest) {
    return requestSchedulePreplan(this, story, request)
  }
  async persistSchedulePreplanReview(
    story: InterludeStory,
    review: { current?: SchedulePreplanRecord; evidenceEntries: ScriptEntry[]; localDate: string },
    proposal: unknown,
    now: Date,
  ) {
    return persistSchedulePreplanReview(this, story, review, proposal, now)
  }
  /** A visible reply already reached the user, so this retry may write only
   * the missing life script. It must never create a second transport message. */
  private async scheduleStreamScriptRecovery(storyId: string, participantId: string, now: Date, previousAttempts = 0) {
    // 与 scheduleNarrativeRetry 同理：重载/停机期间失败不排持久化恢复任务。
    if (this.disposed) return false
    const delaySeconds = Math.max(5, this.config.runtime.narrativeRetryDelaySeconds ?? 15)
    const maxAttempts = Math.min(2, Math.max(0, this.config.runtime.narrativeRetryMaxAttempts ?? 6))
    if (!participantId || previousAttempts >= maxAttempts) return false
    const pending = await this.dbGet('interlude_intent', { storyId, participantId, status: 'pending', type: 'narrative-retry' }) as NarrativeIntent[]
    const existing = pending.filter((intent: any) => intent.payload?.streamRecovery === true)
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
  async compactThreePhase(storyId: string, force: boolean, generation?: string): Promise<boolean> {
    return compactThreePhase(this, storyId, force, generation)
  }
  /** Everything up to the expensive compactor call: cheap reads plus the due
   * checks. Runs inside the story serial queue, but the model call itself must
   * not — a queued compactor request would delay the next live turn. */
  async prepareCompaction(story: InterludeStory, now: Date, force: boolean): Promise<PreparedCompaction | undefined> {
    return prepareCompaction(this, story, now, force)
  }
  /** Cheap DB persistence for one compaction decision. Re-acquires the story
   * serial queue in the caller so writes stay ordered with narrative turns. */
  async applyCompaction(story: InterludeStory, context: PreparedCompactionRun, decision: CompactionDecision, now: Date, startedAt: number) {
    return applyCompaction(this, story, context, decision, now, startedAt)
  }
  /** Older state patches are compacted only by the background maintenance
   * lane. Live turns always retain the last few days as raw detail. */
  async compactOverlayUnlocked(story: InterludeStory, now: Date) {
    return compactOverlayUnlocked(this, story, now)
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
  async rebuildLiveOverlayState(story: InterludeStory, now: Date) {
    return rebuildLiveOverlayState(this, story, now)
  }
  async prepareCompactionEmbeddings(storyId: string, decision: CompactionDecision, entries: ScriptEntry[]) {
    return prepareCompactionEmbeddings(this, storyId, decision, entries)
  }
  async persistCompaction(story: InterludeStory, scene: InterludeScene, decision: CompactionDecision, entries: ScriptEntry[], now: Date, visibleFactIds = new Set<number>(), precedingEntries: ScriptEntry[] = [], factEmbeddings?: Map<string, number[]>) {
    return persistCompaction(this, story, scene, decision, entries, now, visibleFactIds, precedingEntries, factEmbeddings)
  }
  async persistCompactionOutputs(story: InterludeStory, scene: InterludeScene, decision: CompactionDecision, entries: ScriptEntry[], now: Date, visibleFactIds = new Set<number>(), precedingEntries: ScriptEntry[] = [], factEmbeddings = new Map<string, number[]>()) {
    return persistCompactionOutputs(this, story, scene, decision, entries, now, visibleFactIds, precedingEntries, factEmbeddings)
  }
  async persistFact(storyId: string, draft: import('./types').FactDraft, entries: ScriptEntry[], now: Date, preparedEmbedding: number[] = []) {
    return persistFact(this, storyId, draft, entries, now, preparedEmbedding)
  }
  /** 全部向量请求的共用漏斗。日志分级（向量可观测性）：
   * 成功 = standard info（回合级一行：模型/维度/耗时；后台补齐调用传
   * density=diagnostic，由各补齐函数的批次行汇总）；网络/格式失败 =
   * standard warn——"本轮语义检索降级为规则排序"必须让用户看得见；
   * 本地跳过（Embedding 未启用或无可用连接，含 SilentEmbedder）=
   * diagnostic debug——启动时已有一次性的降级警告兜底。
   * 行为语义不变：失败/跳过返回 []，绝不阻塞回合。 */
  private async embedText(value: string, options?: { purpose?: string, density?: 'standard' | 'diagnostic' }) {
    const purpose = options?.purpose ?? '回合检索'
    const density = options?.density ?? 'standard'
    const startedAt = Date.now()
    try {
      const vector = await this.embedder.embed(value)
      if (vector.length) {
        this.reportStandaloneOperation(density, 'info', '向量请求完成 用途=%s 模型=%s 维度=%d 耗时=%dms 输入=%d字',
          purpose, this.embeddingModelLabel(), vector.length, Date.now() - startedAt, value.trim().length)
      } else {
        this.reportStandaloneOperation('diagnostic', 'debug', '向量请求本地跳过 用途=%s（Embedding 未启用或无可用连接）', purpose)
      }
      return vector
    } catch (error) {
      // Embeddings improve recall but must never make a private-message turn fail.
      this.reportStandaloneOperation('standard', 'warn', '向量请求失败，语义检索本轮降级为规则排序 用途=%s 模型=%s 耗时=%dms 错误=%s',
        purpose, this.embeddingModelLabel(), Date.now() - startedAt, error)
      return []
    }
  }

  private embeddingModelLabel() {
    const route = this.modelRouting?.embedding
    const explicit = this.config?.model?.embedding?.model?.trim()
    return explicit || (route?.assigned ? route.providers[0]?.model : route?.target?.model) || '(未配置)'
  }

  scheduleFactEmbeddingBackfill(storyId: string) {
    return scheduleFactEmbeddingBackfill(this, storyId)
  }
  async backfillFactEmbeddings(storyId: string, batchSize: number) {
    return backfillFactEmbeddings(this, storyId, batchSize)
  }
  async persistStatePatch(story: InterludeStory, draft: StatePatchDraft, entries: ScriptEntry[], now: Date) {
    return persistStatePatch(this, story, draft, entries, now)
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

  private writeReport(level: 'error' | 'warn' | 'info' | 'debug', story: InterludeStory, phase: NarrativeRequest['phase'], message: string, args: unknown[], communication?: CommunicationEventLog) {
    if (this.blindModeConfig.enabled) {
      if (level === 'error' || level === 'warn') this.blindModeHealthIssue = true
      return
    }
    const rank = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }
    const logging = this.config.logging ?? { level: 'info' as const, format: 'layered' as const, colors: true, colorTheme: 'dark' as const, kaomoji: true, logScriptPreview: false, previewLength: 500 }
    if (rank[logging.level] < rank[level]) return
    const rendered = renderLogMessage(message, args)
    const storyDetail = (logging.verbosity ?? 'standard') === 'diagnostic' ? ` 故事=${story.id}` : ''
    // issue #5：调用方可能传入轻量 story 桩（只有 id）——读 setting.character.name
    // 直接抛 TypeError，且发生在叙事管线关键路径上会造成死锁。防御式回退到
    // 故事 ID，日志层永不成为故障源。
    const protagonist = story.setting?.character?.name ?? story.id
    const communicationAction = communication
      ? communication.domain === 'policy' ? 'warning' as const
        : communication.domain === 'transport' ? 'send' as const
        : communication.domain === 'authoring' ? 'processing' as const : 'system' as const
      : undefined
    const output = logging.format === 'layered'
      ? formatLayeredLog({
        level, phase, protagonist, message, args,
        ...(communicationAction ? { action: communicationAction } : {}),
        ...(communication ? { communication } : {}),
        colors: logging.colors !== false, colorTheme: logging.colorTheme ?? 'dark', kaomoji: logging.kaomoji !== false,
      })
      : logging.format === 'compact'
        ? `[${phaseLabel(phase)}] ${protagonist} ${rendered}${storyDetail}`
        : `[${phaseLabel(phase)}] ${protagonist}\n事件：${rendered}${storyDetail}`
    this.emitLog(level, output)
  }

  /** P4（§13）：统一动作链路的结构化事件——文本渲染与结构载荷同一对象；
   * 旧消息继续走正则分类，两者兼容。 */
  private reportCommunicationEvent(verbosity: 'summary' | 'standard' | 'diagnostic', level: 'error' | 'warn' | 'info' | 'debug', story: InterludeStory, phase: NarrativeRequest['phase'], message: string, communication: CommunicationEventLog, ...args: unknown[]) {
    if (!this.allowsVerbosity(verbosity)) return
    this.writeReport(level, story, phase, message, args, communication)
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
    this.reportStandaloneOperation('standard', 'info', `Token 用量[${record.task}] 模型=${record.model} 来源=${record.providerLabel || '未标注'} ${line}`)
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

  async resolveCompactionFacts(storyId: string, value: unknown, allowedIds: ReadonlySet<number>, now: Date) {
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

  async markContinuityDirty(storyId: string, now: Date) {
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

  inSerial(id: string) {
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
    const current = previous.catch((): undefined => undefined).then(() => {
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
    this.databaseWriteQueue = run.catch((): undefined => undefined)
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
        await this.dbSet('interlude_endpoint', { id: row.id }, { accountKey: newAccountKey, selfId: String(session.selfId), platform: session.platform, updatedAt: now }).catch((): undefined => undefined)
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
      // 逻辑清空单行失败只跳过该行，清理流程继续完成其余行与表。
      const write = async (key: unknown, payload: unknown) => {
        try {
          await this.dbSet(table, key, payload)
        } catch (setError) {
          this.reportStandalone('warn', 'SQLite 逻辑清空单行失败，跳过 表=%s 键=%s 错误=%s', table, JSON.stringify(key), setError)
        }
      }
      if (typeof fallback === 'function') {
        const rows = await this.dbGet(table, query)
        for (const row of rows) await write(cleanupKey(table as RuntimeTable, row), fallback(row))
      } else {
        await write(query, fallback)
      }
    }
  }
}