import { normalizeAlterSystemState } from './alter';
import { normalizeAgencyWindowState } from './agency';
/**
 * Version 1 is the first state envelope that is decoded and encoded in one
 * place. Older beta10 rows have no version and are upgraded on read.
 */
export const CURRENT_STORY_STATE_VERSION = 4;
const KNOWN_STORY_STATE_KEYS = new Set([
    'schemaVersion', 'extensions', 'settingOverlay', 'activeSceneId', 'activeArcId',
    'continuitySnapshot', 'narrativeUpdateCount', 'lastContinuityUpdateAt',
    'continuityDirty', 'automation', 'alterSystem', 'agencyWindow', 'scenePresence',
    'automaticDeliverySummaries', 'workingDetails', 'timelineCarry', 'chatRhythm',
    'sceneFrame', 'dialogueBurst', 'workingDetailResolutions', 'lifeStatus', 'proactiveContactLog',
]);
export function inspectStoryStateMigration(value, configuredPerspective = '') {
    const record = isRecord(value) ? value : {};
    const sourceVersion = finiteInteger(record.schemaVersion) ?? 0;
    return {
        sourceVersion,
        targetVersion: CURRENT_STORY_STATE_VERSION,
        upgraded: sourceVersion !== CURRENT_STORY_STATE_VERSION,
        unknownKeys: Object.keys(record).filter(key => !KNOWN_STORY_STATE_KEYS.has(key)).sort(),
        perspectiveDefaultAvailable: !!configuredPerspective.trim(),
    };
}
/** Decode any persisted version into the current, complete state envelope. */
export function decodeStoryState(value) {
    return upgradeStoryState(value);
}
/**
 * Pure and idempotent upgrade. Unknown top-level keys are deliberately moved
 * into extensions so a later plugin can recover them instead of losing them
 * during an unrelated state write.
 */
export function upgradeStoryState(value) {
    const record = isRecord(value) ? value : {};
    const overlay = isRecord(record.settingOverlay) ? record.settingOverlay : {};
    const automation = isRecord(record.automation) ? record.automation : {};
    const existingExtensions = isRecord(record.extensions) ? record.extensions : {};
    const unknownExtensions = Object.fromEntries(Object.entries(record).filter(([key]) => !KNOWN_STORY_STATE_KEYS.has(key)));
    const extensions = { ...existingExtensions, ...unknownExtensions };
    const continuity = normalizeContinuitySnapshot(record.continuitySnapshot);
    return {
        schemaVersion: CURRENT_STORY_STATE_VERSION,
        ...(Object.keys(extensions).length ? { extensions } : {}),
        settingOverlay: {
            characterProfile: textOrUndefined(overlay.characterProfile),
            perspective: clippedTextOrUndefined(overlay.perspective, 1_000),
            relationship: textOrUndefined(overlay.relationship),
            world: textOrUndefined(overlay.world),
            characterTraits: Array.isArray(overlay.characterTraits)
                ? overlay.characterTraits.filter((item) => typeof item === 'string')
                : [],
        },
        activeSceneId: finiteNumber(record.activeSceneId),
        activeArcId: finiteNumber(record.activeArcId),
        continuitySnapshot: continuity,
        narrativeUpdateCount: Math.max(0, Math.floor(finiteNumber(record.narrativeUpdateCount) ?? 0)),
        lastContinuityUpdateAt: textOrUndefined(record.lastContinuityUpdateAt),
        continuityDirty: record.continuityDirty === true,
        alterSystem: normalizeAlterSystemState(record.alterSystem),
        agencyWindow: normalizeAgencyWindowState(record.agencyWindow),
        scenePresence: normalizeScenePresenceState(record.scenePresence),
        workingDetails: normalizeWorkingDetails(record.workingDetails),
        workingDetailResolutions: Object.fromEntries(Object.entries(isRecord(record.workingDetailResolutions) ? record.workingDetailResolutions : {})
            .filter(([label, id]) => label.length <= 80 && typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
            .slice(-32).map(([label, id]) => [label, Number(id)])),
        timelineCarry: normalizeTimelineCarry(record.timelineCarry),
        lifeStatus: normalizeLifeStatus(record.lifeStatus),
        proactiveContactLog: normalizeProactiveContactLog(record.proactiveContactLog),
        automaticDeliverySummaries: normalizeAutomaticDeliverySummaries(record.automaticDeliverySummaries),
        // beta10 declared this field but its old decoder forgot to return it.
        chatRhythm: isRecord(record.chatRhythm) ? record.chatRhythm : undefined,
        sceneFrame: normalizeSceneFrame(record.sceneFrame),
        dialogueBurst: normalizeDialogueBurst(record.dialogueBurst),
        automation: {
            quietUntil: textOrUndefined(automation.quietUntil),
            nextAdvanceAt: textOrUndefined(automation.nextAdvanceAt),
            timelineRetryAt: textOrUndefined(automation.timelineRetryAt),
            timelineRetryFrom: textOrUndefined(automation.timelineRetryFrom),
            timelineDirectorFailures: Math.max(0, Math.min(6, Math.floor(finiteNumber(automation.timelineDirectorFailures) ?? 0))),
            lastAutoAdvanceAt: textOrUndefined(automation.lastAutoAdvanceAt),
            lastUserMessageAt: textOrUndefined(automation.lastUserMessageAt),
            conversationFollowUpAt: Array.isArray(automation.conversationFollowUpAt)
                ? automation.conversationFollowUpAt.filter((item) => typeof item === 'string').slice(0, 8)
                : [],
            conversationFollowUpParticipantId: clippedTextOrUndefined(automation.conversationFollowUpParticipantId, 255),
        },
    };
}
const SCENE_FRAME_FIELDS = [
    'place', 'presentPeople', 'ongoingActivity', 'attention',
    'deviceAccess', 'privacy', 'openMotions', 'openTopics',
];
export function normalizeSceneFrame(value) {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim())
        return undefined;
    const rawSources = isRecord(value.sources) ? value.sources : {};
    const sources = {};
    for (const field of SCENE_FRAME_FIELDS) {
        const ids = integerArray(rawSources[field], 24);
        if (ids.length)
            sources[field] = ids;
    }
    // Version 3 deliberately drops beta1 prose-shaped source fields. Keeping
    // their ids would make a cleaned frame still look grounded by stale prose.
    const sourceEntryIds = Array.from(new Set(Object.values(sources).flatMap(ids => ids ?? []))).slice(0, 80);
    const groundedText = (field, raw, limit) => sources[field]?.length ? clippedTextOrUndefined(raw, limit) : undefined;
    const groundedList = (field, raw, count, limit) => sources[field]?.length ? stringArray(raw, count, limit) : [];
    return {
        id: value.id.trim().slice(0, 120),
        ...(finiteInteger(value.localBoundaryEntryId) ? { localBoundaryEntryId: finiteInteger(value.localBoundaryEntryId) } : {}),
        ...(finiteInteger(value.sceneId) ? { sceneId: finiteInteger(value.sceneId) } : {}),
        place: groundedText('place', value.place, 240),
        presentPeople: groundedList('presentPeople', value.presentPeople, 16, 80),
        ongoingActivity: groundedText('ongoingActivity', value.ongoingActivity, 320),
        attention: groundedText('attention', value.attention, 320),
        deviceAccess: groundedText('deviceAccess', value.deviceAccess, 80),
        privacy: groundedText('privacy', value.privacy, 80),
        openMotions: groundedList('openMotions', value.openMotions, 8, 320),
        openTopics: groundedList('openTopics', value.openTopics, 8, 320),
        sourceEntryIds,
        sources,
        updatedAt: validIsoString(value.updatedAt) ?? new Date(0).toISOString(),
    };
}
export function normalizeDialogueBurst(value) {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.frameId !== 'string')
        return undefined;
    const id = value.id.trim().slice(0, 160);
    const frameId = value.frameId.trim().slice(0, 120);
    const startedAt = validIsoString(value.startedAt);
    if (!id || !frameId || !startedAt)
        return undefined;
    return {
        id, frameId, startedAt,
        sourceEntryIds: integerArray(value.sourceEntryIds, 80),
        lastEventId: clippedTextOrUndefined(value.lastEventId, 180),
        scopeKey: clippedTextOrUndefined(value.scopeKey, 120),
        topicKeys: stringArray(value.topicKeys, 12, 120),
    };
}
/** Encode through the same codec so writes can never bypass normalization. */
export function encodeStoryState(value) {
    return upgradeStoryState(value);
}
export function normalizeAutomaticDeliverySummaries(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const normalized = [];
    for (const item of value) {
        if (!isRecord(item))
            continue;
        const participantId = clippedTextOrUndefined(item.participantId, 255) ?? '';
        const summary = clippedTextOrUndefined(item.summary, 240) ?? '';
        const deliveredAt = validIsoString(item.deliveredAt) ?? '';
        const sourceEntryId = finiteInteger(item.sourceEntryId);
        const key = `${participantId}|${sourceEntryId ?? 0}|${summary}`;
        if (!participantId || !summary || !deliveredAt || seen.has(key))
            continue;
        seen.add(key);
        normalized.push({ participantId, summary, ...(sourceEntryId ? { sourceEntryId } : {}), deliveredAt });
    }
    return normalized.slice(-6);
}
export function normalizeScenePresenceState(value) {
    if (!Array.isArray(value))
        return [];
    const latest = new Map();
    for (const item of value) {
        if (!isRecord(item))
            continue;
        const name = clippedTextOrUndefined(item.name, 80) ?? '';
        const status = item.status === 'present' || item.status === 'off-scene' || item.status === 'expected'
            ? item.status
            : undefined;
        const basis = clippedTextOrUndefined(item.basis, 300) ?? '';
        const sourceEntryIds = integerArray(item.sourceEntryIds, 8);
        const updatedAt = validIsoString(item.updatedAt) ?? '';
        if (!name || !status || !basis || !sourceEntryIds.length || !updatedAt)
            continue;
        latest.set(name, { name, status, basis, sourceEntryIds, updatedAt });
    }
    return [...latest.values()].slice(-8);
}
export function normalizeWorkingDetails(value) {
    if (!Array.isArray(value))
        return [];
    const latest = new Map();
    for (const item of value) {
        if (!isRecord(item))
            continue;
        const label = clippedTextOrUndefined(item.label, 80) ?? '';
        const detailValue = clippedTextOrUndefined(item.value, 300) ?? '';
        const expiresAt = validIsoString(item.expiresAt);
        const createdAt = validIsoString(item.createdAt) ?? new Date(0).toISOString();
        const sourceEntryIds = integerArray(item.sourceEntryIds, 8);
        if (!label || !detailValue)
            continue;
        latest.set(label, {
            label,
            ...(typeof item.participantId === 'string' ? { participantId: item.participantId.slice(0, 255) } : {}),
            value: detailValue,
            ...(expiresAt ? { expiresAt } : {}),
            createdAt,
            ...(sourceEntryIds.length ? { sourceEntryIds } : {}),
            ...(isRecord(item.knowledge) ? { knowledge: item.knowledge } : {}),
        });
    }
    return [...latest.values()].slice(-10);
}
/** 主动联系审计窗：每参与者每日上限的计数来源（最近 20 条；不进模型上下文）。 */
export function normalizeProactiveContactLog(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => !!item && typeof item === 'object' && !Array.isArray(item)
        && typeof item.participantId === 'string' && !!item.participantId
        && typeof item.at === 'string' && !Number.isNaN(Date.parse(item.at)))
        .map(item => ({ participantId: item.participantId, at: item.at,
        ...(item.endpointId ? { endpointId: String(item.endpointId) } : {}),
        ...(item.channelReason ? { channelReason: String(item.channelReason).slice(0, 100) } : {}),
        ...(item.ref ? { ref: String(item.ref).slice(0, 120) } : {}),
        ...(item.voided === true ? { voided: true } : {}) }))
        .slice(-20);
}
/** 作废条目不再计入每日上限：一次被端点/传输拦下的主动联系不该烧掉配额。 */
export function countProactiveContactsInWindow(log, participantId, now, windowMs = 86_400_000) {
    return (log ?? []).filter(entry => entry.participantId === participantId
        && !entry.voided
        && now.getTime() - Date.parse(entry.at) < windowMs).length;
}
export function appendProactiveContact(log, participantId, at, endpointId, ref) {
    return [...(log ?? []), { participantId, at: at.toISOString(), ...(endpointId ? { endpointId } : {}), ...(ref ? { ref } : {}) }].slice(-20);
}
export function normalizeLifeStatus(value) {
    if (!isRecord(value))
        return undefined;
    const status = value.status;
    if (status !== 'busy' && status !== 'asleep' && status !== 'idle')
        return undefined;
    const updatedAt = typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt)) ? value.updatedAt : undefined;
    return updatedAt ? { status, updatedAt } : undefined;
}
export function normalizeTimelineCarry(value) {
    if (!Array.isArray(value))
        return [];
    return Array.from(new Set(value
        .filter((item) => typeof item === 'string')
        .map(item => item.trim().slice(0, 240))
        .filter(Boolean))).slice(0, 4);
}
export function normalizeContinuitySnapshot(value) {
    if (!isRecord(value))
        return undefined;
    const text = (item, limit) => typeof item === 'string' ? item.trim().slice(0, limit) : '';
    const list = (item, limit) => Array.isArray(item)
        ? item.map(entry => text(entry, limit)).filter(Boolean).slice(0, 5)
        : [];
    const current = text(value.current, 500);
    const recent = list(value.recent, 300);
    const salient = list(value.salient, 400);
    if (!current && !recent.length && !salient.length)
        return undefined;
    return { current, next: [], recent, salient };
}
function textOrUndefined(value) {
    return typeof value === 'string' ? value : undefined;
}
function clippedTextOrUndefined(value, limit) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;
}
function validIsoString(value) {
    return typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) ? value : undefined;
}
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function finiteInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}
function integerArray(value, limit) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'number' && Number.isSafeInteger(item)).slice(0, limit)
        : [];
}
function stringArray(value, limit, itemLimit) {
    return Array.isArray(value)
        ? Array.from(new Set(value.filter((item) => typeof item === 'string')
            .map(item => item.trim().slice(0, itemLimit)).filter(Boolean))).slice(0, limit)
        : [];
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
