/**
 * Long-Horizon Narrative Guidance（Narrative Attractor）纯函数层。
 * 设计文档：docs/LONG_HORIZON_NARRATIVE_GUIDANCE_DESIGN.md
 *
 * 本文件只包含累计器与判定纯函数——不触碰数据库、模型调用或主叙事。
 * 分层纪律：宿主根据 ScriptEntry.kind/actor/metadata 确定 eligible 和权重，
 * 长线模型只消费宿主给出的分数和证据，不自行判断哪些行算数。
 */
import type { ScriptEntry } from './types';
export interface LongHorizonGuidanceConfig {
    enabled: boolean;
    /** 首次进入催化生成窗口的加权分数门槛。 */
    triggerScore: number;
    /** 上次催化生成后再积累多少分触发下一次机会审查。 */
    reviewIncrement: number;
    /** 私聊条目权重。 */
    privateWeight: number;
    /** 群聊条目权重。 */
    groupWeight: number;
    intensity: 'subtle' | 'moderate' | 'strong';
    /** 同一故事同时持有的 active 指导上限（第一版固定 1）。 */
    maxActiveGuidance: number;
}
export declare const DEFAULT_LONG_HORIZON_CONFIG: LongHorizonGuidanceConfig;
export declare function resolveLongHorizonConfig(value: unknown): LongHorizonGuidanceConfig;
export type LongArcGuidanceStatus = 'draft' | 'active' | 'paused' | 'completed' | 'superseded' | 'expired' | 'rejected';
export interface LongArcGuidanceStage {
    id: string;
    name: string;
    objective: string;
    allowedSignals: string[];
    activationConditions: string[];
    completionEvidence: string[];
}
/**
 * The first, deliberately small action through which a latent direction may
 * enter the story. This is the part that turns an attractor from a passive
 * observation into a dramaturgical catalyst.
 */
export interface LongArcFirstExpression {
    action: string;
    example: string;
    trigger: string[];
    intensity: 'minimal' | 'subtle' | 'moderate';
    maxAttempts: number;
    reversibility: 'high' | 'medium';
}
export interface LongArcResponseBranches {
    accepted: string;
    declined: string;
    questioned: string;
}
export type LongArcDecision = 'dormant' | 'prime' | 'activate';
/** 结构化 payload（interlude_long_arc_guidance.payload 列）。 */
export interface LongArcGuidancePayload {
    /** Explicit lifecycle phase inside the durable active row. */
    developmentPhase?: 'primed' | 'active';
    /** Backward-compatible marker for rows generated before the catalyst model. */
    decision?: Exclude<LongArcDecision, 'dormant'>;
    title: string;
    premise: string;
    /** The unresolved dramatic tension, not a claim that the change is canon. */
    latentTension?: string;
    direction: string;
    emotionalCore: string;
    firstExpression?: LongArcFirstExpression;
    responseBranches?: LongArcResponseBranches;
    currentStage: {
        id: string;
        name: string;
        purpose: string;
    };
    stages: LongArcGuidanceStage[];
    subtleSignals: string[];
    preferredSituations: string[];
    avoidForcing: string[];
    intensity: 'subtle' | 'moderate' | 'strong';
    horizon: 'short' | 'medium' | 'long';
    confidence: number;
    evidenceEntryIds: number[];
}
export interface LongArcGenerationResult {
    decision: LongArcDecision;
    payload?: LongArcGuidancePayload;
    reason?: string;
    evidenceEntryIds: number[];
}
/** 数据库行（interlude_long_arc_guidance）。 */
export interface LongArcGuidanceRecord {
    id?: number;
    storyId: string;
    version: number;
    status: LongArcGuidanceStatus;
    title: string;
    premise: string;
    direction: string;
    payload: LongArcGuidancePayload;
    currentStage: string;
    intensity: 'subtle' | 'moderate' | 'strong';
    confidence: number;
    triggerEntryId: number;
    evidenceEntryIds: number[];
    supersedesId?: number;
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
    expiresAt?: Date;
}
/**
 * 判定一条剧本条目是否为有效叙事证据。
 * 宿主（而非长线模型）拥有此裁决权——§4.1 的核心约束。
 */
export declare function isEligibleNarrativeEntry(entry: Pick<ScriptEntry, 'kind' | 'actor' | 'content' | 'metadata'>): boolean;
/**
 * 解析条目的会话来源（private/group/unknown）。
 * 优先级：metadata.conversationKind > metadata.channel.conversationKind >
 * 按 kind 反推（群消息 kind 含 "group"）> unknown。
 */
export declare function resolveConversationKind(entry: Pick<ScriptEntry, 'kind' | 'metadata'>): 'private' | 'group' | 'unknown';
/** 计算单条条目的加权分数。 */
export declare function resolveConversationWeight(entry: Pick<ScriptEntry, 'kind' | 'actor' | 'content' | 'metadata'>, config: Pick<LongHorizonGuidanceConfig, 'privateWeight' | 'groupWeight'>): number;
export interface LongHorizonScoreResult {
    totalScore: number;
    privateCount: number;
    privateScore: number;
    groupCount: number;
    groupScore: number;
    unknownCount: number;
    latestEligibleEntryId: number;
}
/**
 * 计算一组条目的加权有效叙事分数（§4.2 核心公式）。
 * weightedScore = Σ(privateEligible × privateWeight) + Σ(groupEligible × groupWeight)
 */
export declare function calculateLongHorizonScore(entries: ReadonlyArray<Pick<ScriptEntry, 'id' | 'kind' | 'actor' | 'content' | 'metadata'>>, config: Pick<LongHorizonGuidanceConfig, 'privateWeight' | 'groupWeight'>): LongHorizonScoreResult;
export type LongHorizonTriggerReason = 'first-trigger' | 'review-due' | 'no-active' | 'not-due';
/**
 * 判定是否应触发生成/复审任务。
 * - 无 active 且达到 triggerScore → first-trigger
 * - 有 active 且距上次生成分数增量 ≥ reviewIncrement → review-due
 * - 无 active 但未达阈值 → not-due
 * - active 已 paused/expired/completed → no-active（条件满足即重建）
 */
export declare function shouldTriggerLongHorizon(score: LongHorizonScoreResult, activeGuidance: LongArcGuidanceRecord | undefined, lastGenerationScore: number | undefined, config: LongHorizonGuidanceConfig): {
    trigger: boolean;
    reason: LongHorizonTriggerReason;
};
/**
 * 校验并归一化长线模型输出。
 *
 * `prime` and `activate` both create a durable guidance row, but they must
 * carry a firstExpression. `prime` means the first expression is merely
 * permitted once; `activate` means an earlier expression has been met by a
 * response and may now become a recurring tendency. `dormant` is a valid
 * no-write result and intentionally does not require an arc payload.
 */
export declare function normalizeLongArcDecision(value: unknown, validEvidenceIds: ReadonlySet<number>, config: LongHorizonGuidanceConfig): LongArcGenerationResult | undefined;
/** Backward-compatible payload-only normalizer used by older callers/tests. */
export declare function normalizeLongArcGuidance(value: unknown, validEvidenceIds: ReadonlySet<number>, config: LongHorizonGuidanceConfig): LongArcGuidancePayload | undefined;
/** 数据库行类型（database.ts 的表声明引用）。 */
/** Durable accumulator state, kept separate from versioned guidance rows. */
/** Minato 的 set 拒绝更新载荷包含主键（"cannot modify primary key"）——
 * progress 表主键为 storyId，更新时必须从载荷中剔除。 */
export declare function progressUpdatePayload(progress: LongArcProgressRow): Omit<LongArcProgressRow, 'storyId'>;
export interface LongArcProgressRow {
    storyId: string;
    lastCountedEntryId: number;
    totalScore: number;
    privateCount: number;
    privateScore: number;
    groupCount: number;
    groupScore: number;
    unknownCount: number;
    lastGenerationScore: number;
    lastGenerationEntryId: number;
    updatedAt: Date;
}
/**
 * Consume a review window when no evidence is visible to the background model.
 * The score remains cumulative, but the already-audited window must not trigger
 * the same generation again on every later private/hidden entry.
 */
export declare function advanceLongHorizonGenerationBaseline(progress: LongArcProgressRow, currentScore: number, lastGenerationEntryId: number, updatedAt?: Date): LongArcProgressRow;
export interface LongArcGuidanceRow {
    id?: number;
    storyId: string;
    version: number;
    status: string;
    title: string;
    premise: string;
    direction: string;
    payload: any;
    currentStage: string;
    intensity: string;
    confidence: number;
    triggerEntryId: number;
    evidenceEntryIds: any;
    supersedesId?: number;
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
    expiresAt?: Date;
}
