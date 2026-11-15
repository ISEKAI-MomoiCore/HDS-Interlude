/**
 * Long-Horizon Narrative Guidance（Narrative Attractor）纯函数层。
 * 设计文档：docs/LONG_HORIZON_NARRATIVE_GUIDANCE_DESIGN.md
 *
 * 本文件只包含累计器与判定纯函数——不触碰数据库、模型调用或主叙事。
 * 分层纪律：宿主根据 ScriptEntry.kind/actor/metadata 确定 eligible 和权重，
 * 长线模型只消费宿主给出的分数和证据，不自行判断哪些行算数。
 */
import type { ScriptEntry } from './types'

// ── 配置 ─────────────────────────────────────────────────────────────────────

export interface LongHorizonGuidanceConfig {
  enabled: boolean
  /** 首次进入催化生成窗口的加权分数门槛。 */
  triggerScore: number
  /** 上次催化生成后再积累多少分触发下一次机会审查。 */
  reviewIncrement: number
  /** 私聊条目权重。 */
  privateWeight: number
  /** 群聊条目权重。 */
  groupWeight: number
  intensity: 'subtle' | 'moderate' | 'strong'
  /** 同一故事同时持有的 active 指导上限（第一版固定 1）。 */
  maxActiveGuidance: number
}

export const DEFAULT_LONG_HORIZON_CONFIG: LongHorizonGuidanceConfig = {
  enabled: false,
  triggerScore: 25,
  reviewIncrement: 40,
  privateWeight: 1.0,
  groupWeight: 0.5,
  intensity: 'subtle',
  maxActiveGuidance: 1,
}

export function resolveLongHorizonConfig(value: unknown): LongHorizonGuidanceConfig {
  const record = !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const num = (input: unknown, fallback: number) => {
    const parsed = Number(input)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return {
    enabled: record.enabled === true,
    triggerScore: Math.max(10, Math.min(500, num(record.triggerScore, DEFAULT_LONG_HORIZON_CONFIG.triggerScore))),
    reviewIncrement: Math.max(10, Math.min(500, num(record.reviewIncrement, DEFAULT_LONG_HORIZON_CONFIG.reviewIncrement))),
    // The channel policy is deliberately fixed: private evidence counts in
    // full and group evidence counts half. Keep accepting legacy config keys
    // so old Koishi configs remain readable, but never let them weaken or
    // amplify the privacy/relationship weighting contract.
    privateWeight: DEFAULT_LONG_HORIZON_CONFIG.privateWeight,
    groupWeight: DEFAULT_LONG_HORIZON_CONFIG.groupWeight,
    intensity: (['subtle', 'moderate', 'strong'] as const).includes(record.intensity as any)
      ? record.intensity as LongHorizonGuidanceConfig['intensity'] : 'subtle',
    maxActiveGuidance: 1,
  }
}

// ── 指导数据模型 ─────────────────────────────────────────────────────────────

export type LongArcGuidanceStatus = 'draft' | 'active' | 'paused' | 'completed' | 'superseded' | 'expired' | 'rejected'

export interface LongArcGuidanceStage {
  id: string
  name: string
  objective: string
  allowedSignals: string[]
  activationConditions: string[]
  completionEvidence: string[]
}

/**
 * The first, deliberately small action through which a latent direction may
 * enter the story. This is the part that turns an attractor from a passive
 * observation into a dramaturgical catalyst.
 */
export interface LongArcFirstExpression {
  action: string
  example: string
  trigger: string[]
  intensity: 'minimal' | 'subtle' | 'moderate'
  maxAttempts: number
  reversibility: 'high' | 'medium'
}

export interface LongArcResponseBranches {
  accepted: string
  declined: string
  questioned: string
}

export type LongArcDecision = 'dormant' | 'prime' | 'activate'

/** 结构化 payload（interlude_long_arc_guidance.payload 列）。 */
export interface LongArcGuidancePayload {
  /** Explicit lifecycle phase inside the durable active row. */
  developmentPhase?: 'primed' | 'active'
  /** Backward-compatible marker for rows generated before the catalyst model. */
  decision?: Exclude<LongArcDecision, 'dormant'>
  title: string
  premise: string
  /** The unresolved dramatic tension, not a claim that the change is canon. */
  latentTension?: string
  direction: string
  emotionalCore: string
  firstExpression?: LongArcFirstExpression
  responseBranches?: LongArcResponseBranches
  currentStage: { id: string, name: string, purpose: string }
  stages: LongArcGuidanceStage[]
  subtleSignals: string[]
  preferredSituations: string[]
  avoidForcing: string[]
  intensity: 'subtle' | 'moderate' | 'strong'
  horizon: 'short' | 'medium' | 'long'
  confidence: number
  evidenceEntryIds: number[]
}

export interface LongArcGenerationResult {
  decision: LongArcDecision
  payload?: LongArcGuidancePayload
  reason?: string
  evidenceEntryIds: number[]
}

/** 数据库行（interlude_long_arc_guidance）。 */
export interface LongArcGuidanceRecord {
  id?: number
  storyId: string
  version: number
  status: LongArcGuidanceStatus
  title: string
  premise: string
  direction: string
  payload: LongArcGuidancePayload
  currentStage: string
  intensity: 'subtle' | 'moderate' | 'strong'
  confidence: number
  triggerEntryId: number
  evidenceEntryIds: number[]
  supersedesId?: number
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
  expiresAt?: Date
}

// ── 有效条目判定与权重 ───────────────────────────────────────────────────────

/** 具有叙事意义、可为人物/关系发展提供证据的条目 kind 白名单。 */
const ELIGIBLE_KINDS = new Set([
  'user-message',
  'character-message',
  'character-group-message',
  'script',
  'character-platform-action',
  'world-event',
  'friend-feed',
  'qzone-post',
])

/** 纯导航或技术性 kind，永远不计入。 */
const INELIGIBLE_KINDS = new Set([
  'system',
  'compaction',
  'delivery-failure',
  'retry',
  'technical',
])

/**
 * 判定一条剧本条目是否为有效叙事证据。
 * 宿主（而非长线模型）拥有此裁决权——§4.1 的核心约束。
 */
export function isEligibleNarrativeEntry(entry: Pick<ScriptEntry, 'kind' | 'actor' | 'content' | 'metadata'>): boolean {
  const kind = String(entry.kind ?? '')
  if (INELIGIBLE_KINDS.has(kind)) return false
  if (!ELIGIBLE_KINDS.has(kind)) return false
  const content = String(entry.content ?? '').trim()
  if (!content) return false
  // 纯格式控制（分隔符、空白、占位符）不算叙事证据。
  if (/^(?:<sep\/>|\s|…|\.{3}|—|-)+$/.test(content)) return false
  return true
}

/**
 * 解析条目的会话来源（private/group/unknown）。
 * 优先级：metadata.conversationKind > metadata.channel.conversationKind >
 * 按 kind 反推（群消息 kind 含 "group"）> unknown。
 */
export function resolveConversationKind(entry: Pick<ScriptEntry, 'kind' | 'metadata'>): 'private' | 'group' | 'unknown' {
  const metadata = entry.metadata as Record<string, any> | undefined
  // 1. 显式 conversationKind（M4 后入口侧写入）
  const direct = metadata?.conversationKind
  if (direct === 'private' || direct === 'group' || direct === 'unknown') return direct
  // 2. M4 通道标注
  const channel = metadata?.channel
  if (channel?.conversationKind === 'private' || channel?.conversationKind === 'group') return channel.conversationKind
  // 3. 按 kind 反推（历史回填路径）
  const kind = String(entry.kind ?? '')
  if (kind === 'script') {
    // A script row is a rendered commit and may contain both private and
    // group delivery events. Prefer the event ledger over the row kind so a
    // group commit is not accidentally counted as a private entry.
    const events = Array.isArray(metadata?.scriptEvents) ? metadata.scriptEvents : []
    const hasGroup = events.some((event: any) => event?.kind === 'group-message')
    const hasPrivate = events.some((event: any) => event?.kind === 'outgoing-message')
    if (hasGroup && hasPrivate) return 'unknown'
    if (hasGroup) return 'group'
    if (hasPrivate) return 'private'
    // Legacy script rows had no event ledger and were private by convention.
    return 'private'
  }
  if (kind.includes('group')) return 'group'
  if (kind === 'user-message' || kind === 'character-message') return 'private'
  // 4. 无法确认
  return 'unknown'
}

/** 计算单条条目的加权分数。 */
export function resolveConversationWeight(
  entry: Pick<ScriptEntry, 'kind' | 'actor' | 'content' | 'metadata'>,
  config: Pick<LongHorizonGuidanceConfig, 'privateWeight' | 'groupWeight'>,
): number {
  if (!isEligibleNarrativeEntry(entry)) return 0
  const conversationKind = resolveConversationKind(entry)
  if (conversationKind === 'private') return config.privateWeight
  if (conversationKind === 'group') return config.groupWeight
  return 0 // unknown → 保守 0 分
}

export interface LongHorizonScoreResult {
  totalScore: number
  privateCount: number
  privateScore: number
  groupCount: number
  groupScore: number
  unknownCount: number
  latestEligibleEntryId: number
}

/**
 * 计算一组条目的加权有效叙事分数（§4.2 核心公式）。
 * weightedScore = Σ(privateEligible × privateWeight) + Σ(groupEligible × groupWeight)
 */
export function calculateLongHorizonScore(
  entries: ReadonlyArray<Pick<ScriptEntry, 'id' | 'kind' | 'actor' | 'content' | 'metadata'>>,
  config: Pick<LongHorizonGuidanceConfig, 'privateWeight' | 'groupWeight'>,
): LongHorizonScoreResult {
  let privateCount = 0, privateScore = 0
  let groupCount = 0, groupScore = 0
  let unknownCount = 0
  let latestEligibleEntryId = 0
  for (const entry of entries) {
    if (!isEligibleNarrativeEntry(entry)) continue
    const conversationKind = resolveConversationKind(entry)
    const id = Number(entry.id) || 0
    if (id > latestEligibleEntryId) latestEligibleEntryId = id
    if (conversationKind === 'private') {
      privateCount += 1
      privateScore += config.privateWeight
    } else if (conversationKind === 'group') {
      groupCount += 1
      groupScore += config.groupWeight
    } else {
      unknownCount += 1
    }
  }
  return {
    totalScore: privateScore + groupScore,
    privateCount, privateScore,
    groupCount, groupScore,
    unknownCount,
    latestEligibleEntryId,
  }
}

// ── 触发判定 ─────────────────────────────────────────────────────────────────

export type LongHorizonTriggerReason = 'first-trigger' | 'review-due' | 'no-active' | 'not-due'

/**
 * 判定是否应触发生成/复审任务。
 * - 无 active 且达到 triggerScore → first-trigger
 * - 有 active 且距上次生成分数增量 ≥ reviewIncrement → review-due
 * - 无 active 但未达阈值 → not-due
 * - active 已 paused/expired/completed → no-active（条件满足即重建）
 */
export function shouldTriggerLongHorizon(
  score: LongHorizonScoreResult,
  activeGuidance: LongArcGuidanceRecord | undefined,
  lastGenerationScore: number | undefined,
  config: LongHorizonGuidanceConfig,
): { trigger: boolean, reason: LongHorizonTriggerReason } {
  const hasActive = activeGuidance?.status === 'active'
  if (!hasActive) {
    // 无 active（或已 paused/expired/completed）：达阈值即触发
    if (score.totalScore >= config.triggerScore) return { trigger: true, reason: activeGuidance ? 'no-active' : 'first-trigger' }
    return { trigger: false, reason: 'not-due' }
  }
  // 有 active：复审增量判定
  const baseline = lastGenerationScore ?? 0
  if (score.totalScore - baseline >= config.reviewIncrement) return { trigger: true, reason: 'review-due' }
  return { trigger: false, reason: 'not-due' }
}

// ── 生成结果归一化 ───────────────────────────────────────────────────────────

/**
 * 校验并归一化长线模型输出。
 *
 * `prime` and `activate` both create a durable guidance row, but they must
 * carry a firstExpression. `prime` means the first expression is merely
 * permitted once; `activate` means an earlier expression has been met by a
 * response and may now become a recurring tendency. `dormant` is a valid
 * no-write result and intentionally does not require an arc payload.
 */
export function normalizeLongArcDecision(
  value: unknown,
  validEvidenceIds: ReadonlySet<number>,
  config: LongHorizonGuidanceConfig,
): LongArcGenerationResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const explicitDecision = raw.decision
  // 缺省 decision 从 activate 改为 dormant——模型未显式声明催化意图时
  // 保守不写入（无 active 指导产生），避免 legacy 格式绕过催化结构校验。
  const decision: LongArcDecision = explicitDecision === 'dormant' || explicitDecision === 'prime' || explicitDecision === 'activate'
    ? explicitDecision : 'dormant'
  const evidenceEntryIds = normalizeEvidenceIds(raw.evidenceEntryIds, validEvidenceIds)

  if (decision === 'dormant') {
    const reason = text(raw.reason, 1_000) || 'No sufficiently grounded developmental affordance is ready for this story.'
    return { decision, reason, evidenceEntryIds }
  }

  const title = text(raw.title, 200)
  const premise = text(raw.premise, 2_000)
  const latentTension = text(raw.latentTension, 1_000)
  const direction = text(raw.direction, 2_000)
  const emotionalCore = text(raw.emotionalCore, 500)
  if (!title || !premise || !direction || !emotionalCore || !evidenceEntryIds.length) return undefined

  const stagesRaw = Array.isArray(raw.stages) ? raw.stages : []
  const stages: LongArcGuidanceStage[] = stagesRaw
    .map(stage => normalizeStage(stage))
    .filter((stage): stage is LongArcGuidanceStage => !!stage)
    .slice(0, 8)
  if (!stages.length) return undefined

  const currentStageRaw = raw.currentStage
  const currentStage = currentStageRaw && typeof currentStageRaw === 'object'
    ? {
        id: text((currentStageRaw as any).id, 80),
        name: text((currentStageRaw as any).name, 200),
        purpose: text((currentStageRaw as any).purpose, 1_000),
      }
    : undefined
  const resolvedCurrentStage = currentStage?.id && stages.some(stage => stage.id === currentStage.id)
    ? currentStage
    : { id: stages[0].id, name: stages[0].name, purpose: stages[0].objective }

  const firstExpression = normalizeFirstExpression(raw.firstExpression)
  // 催化结构校验按解析后的 decision 判定（不再仅看 explicitDecision）——
  // 任何要写入 prime/activate 行的输出都必须携带完整的首次表达与回应分支。
  if (decision === 'prime' || decision === 'activate') {
    if (!firstExpression) return undefined
  }
  const responseBranches = normalizeResponseBranches(raw.responseBranches)
  if (decision === 'prime' || decision === 'activate') {
    if (!responseBranches) return undefined
  }

  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
    ? Math.max(0, Math.min(1, raw.confidence)) : 0.5

  const intensity = (['subtle', 'moderate', 'strong'] as const).includes(raw.intensity as any)
    ? raw.intensity as LongArcGuidancePayload['intensity'] : 'subtle'
  // 第一版硬约束：非 subtle 只在显式配置允许时生效
  const allowedIntensity = config.intensity === 'moderate' || config.intensity === 'strong' ? intensity : 'subtle'

  return {
    decision,
    payload: {
      developmentPhase: decision === 'prime' ? 'primed' : 'active',
      ...(explicitDecision ? { decision } : {}),
      title, premise,
      ...(latentTension ? { latentTension } : {}),
      direction, emotionalCore,
      ...(firstExpression ? { firstExpression } : {}),
      ...(responseBranches ? { responseBranches } : {}),
      currentStage: resolvedCurrentStage,
      stages,
      subtleSignals: stringList(raw.subtleSignals, 10),
      preferredSituations: stringList(raw.preferredSituations, 10),
      avoidForcing: stringList(raw.avoidForcing, 10),
      intensity: allowedIntensity,
      horizon: (['short', 'medium', 'long'] as const).includes(raw.horizon as any)
        ? raw.horizon as LongArcGuidancePayload['horizon'] : 'long',
      confidence,
      evidenceEntryIds,
    },
    evidenceEntryIds,
  }
}

/** Backward-compatible payload-only normalizer used by older callers/tests. */
export function normalizeLongArcGuidance(
  value: unknown,
  validEvidenceIds: ReadonlySet<number>,
  config: LongHorizonGuidanceConfig,
): LongArcGuidancePayload | undefined {
  return normalizeLongArcDecision(value, validEvidenceIds, config)?.payload
}

function normalizeEvidenceIds(value: unknown, validEvidenceIds: ReadonlySet<number>): number[] {
  return Array.isArray(value)
    ? value.map(Number)
      .filter(id => Number.isSafeInteger(id) && id > 0 && validEvidenceIds.has(id))
      .slice(0, 30)
    : []
}

function normalizeFirstExpression(value: unknown): LongArcFirstExpression | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const action = text(raw.action, 1_000)
  const example = text(raw.example, 1_000)
  const trigger = stringList(raw.trigger, 8)
  if (!action || !example || !trigger.length) return undefined
  return {
    action, example, trigger,
    intensity: (['minimal', 'subtle', 'moderate'] as const).includes(raw.intensity as any)
      ? raw.intensity as LongArcFirstExpression['intensity'] : 'minimal',
    maxAttempts: Math.max(1, Math.min(3, Math.round(Number.isFinite(Number(raw.maxAttempts)) ? Number(raw.maxAttempts) : 1))),
    reversibility: raw.reversibility === 'medium' ? 'medium' : 'high',
  }
}

function normalizeResponseBranches(value: unknown): LongArcResponseBranches | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const accepted = text(raw.accepted, 800)
  const declined = text(raw.declined, 800)
  const questioned = text(raw.questioned, 800)
  if (!accepted || !declined || !questioned) return undefined
  return { accepted, declined, questioned }
}

function normalizeStage(value: unknown): LongArcGuidanceStage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const id = text(raw.id, 80)
  const name = text(raw.name, 200)
  const objective = text(raw.objective, 1_000)
  if (!id || !name || !objective) return undefined
  return {
    id, name, objective,
    allowedSignals: stringList(raw.allowedSignals, 8),
    activationConditions: stringList(raw.activationConditions, 8),
    completionEvidence: stringList(raw.completionEvidence, 8),
  }
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/[\r\n]+/g, ' ').slice(0, limit) : ''
}

function stringList(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map(item => item.trim().slice(0, 500)).slice(0, limit)
    : []
}

/** 数据库行类型（database.ts 的表声明引用）。 */
/** Durable accumulator state, kept separate from versioned guidance rows. */
/** Minato 的 set 拒绝更新载荷包含主键（"cannot modify primary key"）——
 * progress 表主键为 storyId，更新时必须从载荷中剔除。 */
export function progressUpdatePayload(
  progress: LongArcProgressRow,
): Omit<LongArcProgressRow, 'storyId'> {
  const { storyId: _primaryKey, ...mutable } = progress
  return mutable
}

export interface LongArcProgressRow {
  storyId: string
  lastCountedEntryId: number
  totalScore: number
  privateCount: number
  privateScore: number
  groupCount: number
  groupScore: number
  unknownCount: number
  lastGenerationScore: number
  lastGenerationEntryId: number
  updatedAt: Date
}

/**
 * Consume a review window when no evidence is visible to the background model.
 * The score remains cumulative, but the already-audited window must not trigger
 * the same generation again on every later private/hidden entry.
 */
export function advanceLongHorizonGenerationBaseline(
  progress: LongArcProgressRow,
  currentScore: number,
  lastGenerationEntryId: number,
  updatedAt = new Date(),
): LongArcProgressRow {
  return {
    ...progress,
    totalScore: currentScore,
    lastGenerationScore: currentScore,
    lastGenerationEntryId: Math.max(progress.lastGenerationEntryId, lastGenerationEntryId),
    updatedAt,
  }
}
export interface LongArcGuidanceRow {
  id?: number
  storyId: string
  version: number
  status: string
  title: string
  premise: string
  direction: string
  payload: any
  currentStage: string
  intensity: string
  confidence: number
  triggerEntryId: number
  evidenceEntryIds: any
  supersedesId?: number
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
  expiresAt?: Date
}
