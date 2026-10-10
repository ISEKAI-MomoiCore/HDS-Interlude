import { Context } from 'koishi'
import {
  InterludeArc, InterludeParticipant, InterludeScene, InterludeStory, NarrativeFact, NarrativeIntent,
  NarrativeMemory, OverlaySnapshot, SchedulePreplanRecord, ScriptEntry, SeededWorldEvent, StatePatchProposal, StickerAsset, WebObservation,
} from './types'
import type { QzonePostRecord } from './qzone'
import type { EndpointRow, EndpointStateRecord, StoryAliasRecord } from './endpoints'
import type { WorkRow } from './works'
import type { LongArcGuidanceRow, LongArcProgressRow } from './long-arc'

declare module 'koishi' {
  interface Tables {
    interlude_story: InterludeStory
    interlude_participant: InterludeParticipant
    interlude_script_entry: ScriptEntry
    interlude_memory: NarrativeMemory
    interlude_intent: NarrativeIntent
    interlude_scene: InterludeScene
    interlude_arc: InterludeArc
    interlude_fact: NarrativeFact
    interlude_state_patch: StatePatchProposal
    interlude_overlay_snapshot: OverlaySnapshot
    interlude_sticker: StickerAsset
    interlude_web_observation: WebObservation
    interlude_schedule_preplan: SchedulePreplanRecord
    interlude_seeded_event: SeededWorldEvent
    interlude_qzone_post: QzonePostRecord
    interlude_endpoint: EndpointRow
    interlude_endpoint_state: EndpointStateRecord
    interlude_long_arc_guidance: LongArcGuidanceRow
    interlude_long_arc_progress: LongArcProgressRow
    interlude_story_alias: StoryAliasRecord
    interlude_work: WorkRow
  }
}

export function registerTables(ctx: Context) {
  // Koishi keeps the model registry on the parent context during plugin
  // reloads. Re-registering the same schemas forces minato to rebuild
  // indexes and is a noticeable source of reload latency.
  const existingTables = (ctx.model as any).tables ?? {}
  // Existing installations already have the original tables registered by a
  // parent context. Do not rebuild those schemas on reload, but keep adding
  // genuinely new tables introduced by later releases.
  if (existingTables.interlude_story) {
    registerScriptEntryEmbedding(ctx, existingTables)
    if (existingTables.interlude_fact && !existingTables.interlude_fact.fields?.knowledge) {
      ctx.model.extend('interlude_fact', { knowledge: 'json' })
    }
    if (existingTables.interlude_qzone_post && !existingTables.interlude_qzone_post.fields?.endpointId) {
      ctx.model.extend('interlude_qzone_post', { endpointId: 'string(63)' })
    }
    // 被评论感知基线（rc29）：老库补列，缺省 undefined=尚未立基线。
    if (existingTables.interlude_qzone_post && !existingTables.interlude_qzone_post.fields?.commentNum) {
      ctx.model.extend('interlude_qzone_post', { commentNum: 'unsigned' })
    }
    if (!existingTables.interlude_web_observation) registerWebObservationTable(ctx)
    if (!existingTables.interlude_overlay_snapshot) registerOverlaySnapshotTable(ctx)
    if (!existingTables.interlude_sticker) registerStickerTable(ctx)
    if (!existingTables.interlude_schedule_preplan) registerSchedulePreplanTable(ctx)
    if (!existingTables.interlude_seeded_event) registerSeededEventTable(ctx)
    if (!existingTables.interlude_qzone_post) registerQzonePostTable(ctx)
    if (!existingTables.interlude_endpoint) registerEndpointTable(ctx)
    if (!existingTables.interlude_endpoint_state) registerEndpointStateTable(ctx)
    if (!existingTables.interlude_story_alias) registerStoryAliasTable(ctx)
    if (!existingTables.interlude_work) registerWorkTable(ctx)
    if (!existingTables.interlude_long_arc_guidance) registerLongArcGuidanceTable(ctx)
    if (!existingTables.interlude_long_arc_progress) registerLongArcProgressTable(ctx)
    return
  }

  // 故事表保存可追溯的 canon 与可变的当前状态；原始剧本文本不内嵌在这里。
  ctx.model.extend('interlude_story', {
    id: 'string(255)', platform: 'string(63)', selfId: 'string(63)', userId: 'string(127)',
    channelId: 'string(127)', status: 'string(16)', setting: 'json', state: 'json',
    cursorAt: 'timestamp', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', indexes: ['platform', 'selfId', 'userId'] })

  // A main story belongs to one character/bot identity. Participants point to
  // individual private-message accounts and carry relationship-local state.
  ctx.model.extend('interlude_participant', {
    id: 'string(255)', storyId: 'string(255)', platform: 'string(63)', selfId: 'string(63)',
    userId: 'string(127)', channelId: 'string(127)', personId: 'string(255)',
    displayName: 'string(255)', profile: 'text', relationship: 'text', state: 'json',
    status: 'string(16)', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', indexes: ['storyId', 'status', 'personId', 'userId'] })

  // 这是事实来源。场景、事实与状态变化都可以回溯到这些不可变的原始条目。
  ctx.model.extend('interlude_script_entry', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', kind: 'string(32)', actor: 'string(32)',
    content: 'text', occurredAt: 'timestamp', metadata: 'json', embedding: 'json', createdAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'occurredAt'] })

  ctx.model.extend('interlude_memory', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', category: 'string(32)', content: 'text',
    importance: 'double', status: 'string(16)', sourceEntryId: 'unsigned',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'importance'] })

  // intent 是未来的可能性，不是已经发生的剧情；到期后仍需模型重新裁决。
  ctx.model.extend('interlude_intent', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', type: 'string(32)', summary: 'text',
    notBefore: 'timestamp', status: 'string(16)', payload: 'json',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'notBefore'] })

  // 场景摘要是对原始条目的低 token 索引，不替代原文。
  ctx.model.extend('interlude_scene', {
    id: 'unsigned', storyId: 'string(255)', status: 'string(16)',
    startedAt: 'timestamp', endedAt: 'timestamp', hook: 'text', summary: 'text',
    entryCount: 'unsigned', lastEntryId: 'unsigned', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'startedAt'] })

  // 剧情弧线比场景更长，用于维持关系和长期事件的方向感。
  ctx.model.extend('interlude_arc', {
    id: 'unsigned', storyId: 'string(255)', status: 'string(16)', title: 'string(255)',
    summary: 'text', sceneCount: 'unsigned', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'updatedAt'] })

  // 长期事实是全局叙事材料；participantId 仅为旧数据库兼容保留，
  // 不再表达事实主体或可见性。来源条目仍供审计或重建。
  ctx.model.extend('interlude_fact', {
    knowledge: 'json',
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', scope: 'string(32)', content: 'text',
    importance: 'double', confidence: 'double', unresolved: 'boolean', embedding: 'json', status: 'string(16)', sourceEntryIds: 'json',
    lastSeenAt: 'timestamp', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'importance'] })

  // 设定变化先以提案存在，经过证据与阈值检查后才写入 story.state 的 overlay。
  ctx.model.extend('interlude_state_patch', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', target: 'string(32)', path: 'string(255)',
    proposedValue: 'text', evidence: 'text', confidence: 'double', impact: 'string(16)',
    status: 'string(16)', sourceEntryIds: 'json', createdAt: 'timestamp', appliedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'confidence'] })

  registerWebObservationTable(ctx)
  registerOverlaySnapshotTable(ctx)
  registerStickerTable(ctx)
  registerSchedulePreplanTable(ctx)
  registerSeededEventTable(ctx)
  registerQzonePostTable(ctx)
  registerEndpointTable(ctx)
  registerEndpointStateTable(ctx)
  registerStoryAliasTable(ctx)
  registerWorkTable(ctx)
  registerLongArcGuidanceTable(ctx)
  registerLongArcProgressTable(ctx)
}

function registerScriptEntryEmbedding(ctx: Context, tables = (ctx.model as any).tables ?? {}) {
  if (tables.interlude_script_entry?.fields?.embedding) return
  ctx.model.extend('interlude_script_entry', { embedding: 'json' })
}

/** Kept separately so an upgrade can register only this new table without
 * forcing Minato/sql.js to rebuild every long-lived HDSI index on reload. */
function registerWebObservationTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_web_observation) return
  ctx.model.extend('interlude_web_observation', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', intentId: 'unsigned',
    mode: 'string(16)', query: 'text', url: 'text', title: 'text', excerpt: 'text', summary: 'text',
    status: 'string(16)', accessedAt: 'timestamp', createdAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'accessedAt'] })
}

/** Snapshot rows keep older overlay evolution compact without discarding the
 * original state-patch audit trail. Registered separately for fast upgrades. */
function registerOverlaySnapshotTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_overlay_snapshot) return
  ctx.model.extend('interlude_overlay_snapshot', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', target: 'string(32)', tier: 'string(16)',
    periodStart: 'timestamp', periodEnd: 'timestamp', summary: 'text', majorEvents: 'json', sourcePatchIds: 'json',
    status: 'string(16)', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'target', 'periodEnd'] })
}

function registerStickerTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_sticker) return
  ctx.model.extend('interlude_sticker', {
    id: 'unsigned', assetId: 'string(255)', filePath: 'string(1024)', group: 'string(128)', mimeType: 'string(127)',
    animated: 'boolean', size: 'unsigned', hash: 'string(64)', description: 'text', aliases: 'json', status: 'string(16)',
    embedding: 'json',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, unique: ['assetId'], indexes: ['status', 'group', 'updatedAt'] })
}

function registerSeededEventTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_seeded_event) return
  ctx.model.extend('interlude_seeded_event', {
    id: 'unsigned', storyId: 'string(255)', summary: 'text', importance: 'string(16)',
    occursAt: 'timestamp', expiresAt: 'timestamp', status: 'string(16)',
    subjects: 'json', sourcePayload: 'json', injectedEntryId: 'unsigned',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'occursAt'] })
}

function registerQzonePostTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_qzone_post) return
  // 空间动作审计行：限流门（当日计数/最小间隔）与投递结果追溯共用。
  ctx.model.extend('interlude_qzone_post', {
    id: 'unsigned', storyId: 'string(255)', kind: 'string(16)', tid: 'string(127)',
    targetUin: 'string(63)', content: 'text', ugcRight: 'unsigned', endpointId: 'string(63)', commentNum: 'unsigned',
    status: 'string(16)', error: 'text', createdAt: 'timestamp', postedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'kind', 'status', 'createdAt'] })
}

/** M1b 剧本别名：推导 ID → 稳定剧本 ID 的重定向；回滚 = 删行，行自带审计（reason/时间）。 */
function registerStoryAliasTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_story_alias) return
  ctx.model.extend('interlude_story_alias', {
    aliasStoryId: 'string(255)', canonicalStoryId: 'string(255)', reason: 'string(255)', createdAt: 'timestamp',
  }, { primary: 'aliasStoryId', indexes: ['canonicalStoryId'] })
}

function registerEndpointStateTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_endpoint_state) return
  // M3：动态端点健康状态是诊断/门控快照，不改变 interlude_endpoint 的身份行。
  // endpointId 为稳定主键；状态 JSON 保留未来字段，便于小版本扩展而无需再加列。
  ctx.model.extend('interlude_endpoint_state', {
    endpointId: 'string(63)', state: 'json', updatedAt: 'timestamp',
  }, { primary: 'endpointId', indexes: ['updatedAt'] })
}

function registerEndpointTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_endpoint) return
  // 端点注册表（M1a）：身份与地址分离——主键为持久随机 ID，accountKey 等地址字段
  // 可变；唯一性靠唯一键约束在应用层校验（endpointUniqueKey）。
  ctx.model.extend('interlude_endpoint', {
    id: 'string(63)', ownerKind: 'string(24)', ownerId: 'string(255)',
    channelKind: 'string(8)', platform: 'string(63)', accountKey: 'string(127)', selfId: 'string(63)',
    userId: 'string(127)', channelId: 'string(127)', groupId: 'string(127)',
    conversationKind: 'string(16)', enabled: 'boolean',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', indexes: ['accountKey', 'ownerKind', 'ownerId'] })
}

function registerSchedulePreplanTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_schedule_preplan) return
  ctx.model.extend('interlude_schedule_preplan', {
    storyId: 'string(255)', revision: 'unsigned', timezone: 'string(127)',
    validFrom: 'string(10)', validThrough: 'string(10)', lastReviewedLocalDate: 'string(10)',
    lastEvidenceEntryId: 'unsigned', reviewReason: 'text', regimes: 'json', exceptions: 'json', materializedDays: 'json',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'storyId', indexes: ['validThrough', 'lastReviewedLocalDate'] })
}


function registerLongArcGuidanceTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_long_arc_guidance) return
  // 长线叙事指导（Narrative Attractor）：版本化生命周期行，非事实权威。
  ctx.model.extend('interlude_long_arc_guidance', {
    id: 'unsigned', storyId: 'string(255)', version: 'unsigned', status: 'string(16)',
    title: 'string(255)', premise: 'text', direction: 'text',
    payload: 'json', currentStage: 'string(80)', intensity: 'string(16)',
    confidence: 'double', triggerEntryId: 'unsigned', evidenceEntryIds: 'json',
    supersedesId: 'unsigned', createdAt: 'timestamp', updatedAt: 'timestamp',
    completedAt: 'timestamp', expiresAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'version'] })
}

function registerLongArcProgressTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_long_arc_progress) return
  // Durable scan cursor and score baseline. Never overload a guidance version
  // row with mutable accumulator state.
  ctx.model.extend('interlude_long_arc_progress', {
    storyId: 'string(255)', lastCountedEntryId: 'unsigned', totalScore: 'double',
    privateCount: 'unsigned', privateScore: 'double', groupCount: 'unsigned', groupScore: 'double',
    unknownCount: 'unsigned', lastGenerationScore: 'double', lastGenerationEntryId: 'unsigned',
    updatedAt: 'timestamp',
  }, { primary: 'storyId', indexes: ['lastCountedEntryId', 'updatedAt'] })
}

function registerWorkTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_work) return
  ctx.model.extend('interlude_work', {
    id: 'string(64)', storyId: 'string(255)', participantId: 'string(255)', generation: 'unsigned', state: 'json',
  }, { primary: 'id' })
}
