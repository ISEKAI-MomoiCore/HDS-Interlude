export const DEFAULT_LONG_HORIZON_CONFIG = {
    enabled: false,
    triggerScore: 25,
    reviewIncrement: 40,
    privateWeight: 1.0,
    groupWeight: 0.5,
    intensity: 'subtle',
    maxActiveGuidance: 1,
};
export function resolveLongHorizonConfig(value) {
    const record = !!value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const num = (input, fallback) => {
        const parsed = Number(input);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
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
        intensity: ['subtle', 'moderate', 'strong'].includes(record.intensity)
            ? record.intensity : 'subtle',
        maxActiveGuidance: 1,
    };
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
]);
/** 纯导航或技术性 kind，永远不计入。 */
const INELIGIBLE_KINDS = new Set([
    'system',
    'compaction',
    'delivery-failure',
    'retry',
    'technical',
]);
/**
 * 判定一条剧本条目是否为有效叙事证据。
 * 宿主（而非长线模型）拥有此裁决权——§4.1 的核心约束。
 */
export function isEligibleNarrativeEntry(entry) {
    const kind = String(entry.kind ?? '');
    if (INELIGIBLE_KINDS.has(kind))
        return false;
    if (!ELIGIBLE_KINDS.has(kind))
        return false;
    const content = String(entry.content ?? '').trim();
    if (!content)
        return false;
    // 纯格式控制（分隔符、空白、占位符）不算叙事证据。
    if (/^(?:<sep\/>|\s|…|\.{3}|—|-)+$/.test(content))
        return false;
    return true;
}
/**
 * 解析条目的会话来源（private/group/unknown）。
 * 优先级：metadata.conversationKind > metadata.channel.conversationKind >
 * 按 kind 反推（群消息 kind 含 "group"）> unknown。
 */
export function resolveConversationKind(entry) {
    const metadata = entry.metadata;
    // 1. 显式 conversationKind（M4 后入口侧写入）
    const direct = metadata?.conversationKind;
    if (direct === 'private' || direct === 'group' || direct === 'unknown')
        return direct;
    // 2. M4 通道标注
    const channel = metadata?.channel;
    if (channel?.conversationKind === 'private' || channel?.conversationKind === 'group')
        return channel.conversationKind;
    // 3. 按 kind 反推（历史回填路径）
    const kind = String(entry.kind ?? '');
    if (kind === 'script') {
        // A script row is a rendered commit and may contain both private and
        // group delivery events. Prefer the event ledger over the row kind so a
        // group commit is not accidentally counted as a private entry.
        const events = Array.isArray(metadata?.scriptEvents) ? metadata.scriptEvents : [];
        const hasGroup = events.some((event) => event?.kind === 'group-message');
        const hasPrivate = events.some((event) => event?.kind === 'outgoing-message');
        if (hasGroup && hasPrivate)
            return 'unknown';
        if (hasGroup)
            return 'group';
        if (hasPrivate)
            return 'private';
        // Legacy script rows had no event ledger and were private by convention.
        return 'private';
    }
    if (kind.includes('group'))
        return 'group';
    if (kind === 'user-message' || kind === 'character-message')
        return 'private';
    // 4. 无法确认
    return 'unknown';
}
/** 计算单条条目的加权分数。 */
export function resolveConversationWeight(entry, config) {
    if (!isEligibleNarrativeEntry(entry))
        return 0;
    const conversationKind = resolveConversationKind(entry);
    if (conversationKind === 'private')
        return config.privateWeight;
    if (conversationKind === 'group')
        return config.groupWeight;
    return 0; // unknown → 保守 0 分
}
/**
 * 计算一组条目的加权有效叙事分数（§4.2 核心公式）。
 * weightedScore = Σ(privateEligible × privateWeight) + Σ(groupEligible × groupWeight)
 */
export function calculateLongHorizonScore(entries, config) {
    let privateCount = 0, privateScore = 0;
    let groupCount = 0, groupScore = 0;
    let unknownCount = 0;
    let latestEligibleEntryId = 0;
    for (const entry of entries) {
        if (!isEligibleNarrativeEntry(entry))
            continue;
        const conversationKind = resolveConversationKind(entry);
        const id = Number(entry.id) || 0;
        if (id > latestEligibleEntryId)
            latestEligibleEntryId = id;
        if (conversationKind === 'private') {
            privateCount += 1;
            privateScore += config.privateWeight;
        }
        else if (conversationKind === 'group') {
            groupCount += 1;
            groupScore += config.groupWeight;
        }
        else {
            unknownCount += 1;
        }
    }
    return {
        totalScore: privateScore + groupScore,
        privateCount, privateScore,
        groupCount, groupScore,
        unknownCount,
        latestEligibleEntryId,
    };
}
/**
 * 判定是否应触发生成/复审任务。
 * - 无 active 且达到 triggerScore → first-trigger
 * - 有 active 且距上次生成分数增量 ≥ reviewIncrement → review-due
 * - 无 active 但未达阈值 → not-due
 * - active 已 paused/expired/completed → no-active（条件满足即重建）
 */
export function shouldTriggerLongHorizon(score, activeGuidance, lastGenerationScore, config) {
    const hasActive = activeGuidance?.status === 'active';
    if (!hasActive) {
        // 无 active（或已 paused/expired/completed）：达阈值即触发
        if (score.totalScore >= config.triggerScore)
            return { trigger: true, reason: activeGuidance ? 'no-active' : 'first-trigger' };
        return { trigger: false, reason: 'not-due' };
    }
    // 有 active：复审增量判定
    const baseline = lastGenerationScore ?? 0;
    if (score.totalScore - baseline >= config.reviewIncrement)
        return { trigger: true, reason: 'review-due' };
    return { trigger: false, reason: 'not-due' };
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
export function normalizeLongArcDecision(value, validEvidenceIds, config) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const raw = value;
    const explicitDecision = raw.decision;
    // P2-1：缺省 decision 从 activate 改为 dormant——模型未显式声明催化意图时
    // 保守不写入（无 active 指导产生），避免 legacy 格式绕过催化结构校验。
    const decision = explicitDecision === 'dormant' || explicitDecision === 'prime' || explicitDecision === 'activate'
        ? explicitDecision : 'dormant';
    const evidenceEntryIds = normalizeEvidenceIds(raw.evidenceEntryIds, validEvidenceIds);
    if (decision === 'dormant') {
        const reason = text(raw.reason, 1_000) || 'No sufficiently grounded developmental affordance is ready for this story.';
        return { decision, reason, evidenceEntryIds };
    }
    const title = text(raw.title, 200);
    const premise = text(raw.premise, 2_000);
    const latentTension = text(raw.latentTension, 1_000);
    const direction = text(raw.direction, 2_000);
    const emotionalCore = text(raw.emotionalCore, 500);
    if (!title || !premise || !direction || !emotionalCore || !evidenceEntryIds.length)
        return undefined;
    const stagesRaw = Array.isArray(raw.stages) ? raw.stages : [];
    const stages = stagesRaw
        .map(stage => normalizeStage(stage))
        .filter((stage) => !!stage)
        .slice(0, 8);
    if (!stages.length)
        return undefined;
    const currentStageRaw = raw.currentStage;
    const currentStage = currentStageRaw && typeof currentStageRaw === 'object'
        ? {
            id: text(currentStageRaw.id, 80),
            name: text(currentStageRaw.name, 200),
            purpose: text(currentStageRaw.purpose, 1_000),
        }
        : undefined;
    const resolvedCurrentStage = currentStage?.id && stages.some(stage => stage.id === currentStage.id)
        ? currentStage
        : { id: stages[0].id, name: stages[0].name, purpose: stages[0].objective };
    const firstExpression = normalizeFirstExpression(raw.firstExpression);
    // P2-1：催化结构校验按解析后的 decision 判定（不再仅看 explicitDecision）——
    // 任何要写入 prime/activate 行的输出都必须携带完整的首次表达与回应分支。
    if (decision === 'prime' || decision === 'activate') {
        if (!firstExpression)
            return undefined;
    }
    const responseBranches = normalizeResponseBranches(raw.responseBranches);
    if (decision === 'prime' || decision === 'activate') {
        if (!responseBranches)
            return undefined;
    }
    const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence)) : 0.5;
    const intensity = ['subtle', 'moderate', 'strong'].includes(raw.intensity)
        ? raw.intensity : 'subtle';
    // 第一版硬约束：非 subtle 只在显式配置允许时生效
    const allowedIntensity = config.intensity === 'moderate' || config.intensity === 'strong' ? intensity : 'subtle';
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
            horizon: ['short', 'medium', 'long'].includes(raw.horizon)
                ? raw.horizon : 'long',
            confidence,
            evidenceEntryIds,
        },
        evidenceEntryIds,
    };
}
/** Backward-compatible payload-only normalizer used by older callers/tests. */
export function normalizeLongArcGuidance(value, validEvidenceIds, config) {
    return normalizeLongArcDecision(value, validEvidenceIds, config)?.payload;
}
function normalizeEvidenceIds(value, validEvidenceIds) {
    return Array.isArray(value)
        ? value.map(Number)
            .filter(id => Number.isSafeInteger(id) && id > 0 && validEvidenceIds.has(id))
            .slice(0, 30)
        : [];
}
function normalizeFirstExpression(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const raw = value;
    const action = text(raw.action, 1_000);
    const example = text(raw.example, 1_000);
    const trigger = stringList(raw.trigger, 8);
    if (!action || !example || !trigger.length)
        return undefined;
    return {
        action, example, trigger,
        intensity: ['minimal', 'subtle', 'moderate'].includes(raw.intensity)
            ? raw.intensity : 'minimal',
        maxAttempts: Math.max(1, Math.min(3, Math.round(Number.isFinite(Number(raw.maxAttempts)) ? Number(raw.maxAttempts) : 1))),
        reversibility: raw.reversibility === 'medium' ? 'medium' : 'high',
    };
}
function normalizeResponseBranches(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const raw = value;
    const accepted = text(raw.accepted, 800);
    const declined = text(raw.declined, 800);
    const questioned = text(raw.questioned, 800);
    if (!accepted || !declined || !questioned)
        return undefined;
    return { accepted, declined, questioned };
}
function normalizeStage(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const raw = value;
    const id = text(raw.id, 80);
    const name = text(raw.name, 200);
    const objective = text(raw.objective, 1_000);
    if (!id || !name || !objective)
        return undefined;
    return {
        id, name, objective,
        allowedSignals: stringList(raw.allowedSignals, 8),
        activationConditions: stringList(raw.activationConditions, 8),
        completionEvidence: stringList(raw.completionEvidence, 8),
    };
}
function text(value, limit) {
    return typeof value === 'string' ? value.trim().replace(/[\r\n]+/g, ' ').slice(0, limit) : '';
}
function stringList(value, limit) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string' && !!item.trim()).map(item => item.trim().slice(0, 500)).slice(0, limit)
        : [];
}
/** 数据库行类型（database.ts 的表声明引用）。 */
/** Durable accumulator state, kept separate from versioned guidance rows. */
/** Minato 的 set 拒绝更新载荷包含主键（"cannot modify primary key"）——
 * progress 表主键为 storyId，更新时必须从载荷中剔除。 */
export function progressUpdatePayload(progress) {
    const { storyId: _primaryKey, ...mutable } = progress;
    return mutable;
}
/**
 * Consume a review window when no evidence is visible to the background model.
 * The score remains cumulative, but the already-audited window must not trigger
 * the same generation again on every later private/hidden entry.
 */
export function advanceLongHorizonGenerationBaseline(progress, currentScore, lastGenerationEntryId, updatedAt = new Date()) {
    return {
        ...progress,
        totalScore: currentScore,
        lastGenerationScore: currentScore,
        lastGenerationEntryId: Math.max(progress.lastGenerationEntryId, lastGenerationEntryId),
        updatedAt,
    };
}
