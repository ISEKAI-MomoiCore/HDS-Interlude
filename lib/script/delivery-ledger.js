import { isOutgoingScriptEvent } from './contract';
/** Materialize an outbox-shaped ledger inside the authoritative script row.
 * The ledger itself is metadata-only: it creates no sender or schema
 * migration. Pending compensation reuses the existing transport, and durable
 * split intents retain ownership of their typing schedule. */
export function createScriptDeliveryActions(commit) {
    return commit.events.flatMap(event => {
        const segments = deliverySegments(event);
        if (!segments.length)
            return [];
        return [{
                commitId: commit.commitId,
                eventId: event.eventId,
                eventKind: event.kind,
                ...(event.participantId ? { participantId: event.participantId } : {}),
                ...(event.endpointId ? { endpointId: event.endpointId } : {}),
                status: 'pending',
                segments,
                updatedAt: commit.window.to,
            }];
    });
}
export function updateScriptDeliveryActions(current, reference, status, at, reason) {
    if (!Array.isArray(current))
        return undefined;
    let changed = false;
    const timestamp = at.toISOString();
    const actions = current.map(raw => {
        if (!isDeliveryAction(raw) || raw.commitId !== reference.commitId || raw.eventId !== reference.eventId)
            return raw;
        let actionChanged = false;
        const segments = raw.segments.map(segment => {
            if (segment.index !== reference.segmentIndex)
                return segment;
            // 终态不可逆：平台已接受的发言（delivered）与已明确撤销的行动
            // （cancelled）不会被后续记账失败或迟到回执改写。failed 允许重试。
            if (segment.status === 'delivered' || segment.status === 'cancelled')
                return segment;
            if (segment.status === status && segment.reason === reason)
                return segment;
            changed = true;
            actionChanged = true;
            const next = {
                ...segment,
                status,
                attemptedAt: segment.attemptedAt ?? timestamp,
                ...(status === 'pending' ? {} : { completedAt: timestamp }),
            };
            // 回到 pending 意味着重试：上一轮的完成时间不再是事实，随理由一起清除。
            if (status === 'pending')
                delete next.completedAt;
            if (reason)
                next.reason = reason;
            else
                delete next.reason;
            return next;
        });
        if (!actionChanged)
            return raw;
        return { ...raw, segments, status: aggregateDeliveryStatus(segments), updatedAt: timestamp };
    });
    return changed ? actions : undefined;
}
export function deliveryReference(event, scriptEntryId, segmentIndex = 0) {
    if (!event || !Number.isSafeInteger(scriptEntryId))
        return undefined;
    return { commitId: event.commitId, eventId: event.eventId, scriptEntryId: scriptEntryId, segmentIndex };
}
export function platformActionReference(commit, scriptEntryId, kind, content) {
    const event = commit?.events.find(item => item.kind === 'platform-action');
    if (!event || !Number.isSafeInteger(scriptEntryId))
        return undefined;
    const segment = deliverySegments(event).find(item => item.kind === kind && (content === undefined || item.content === content));
    return segment ? deliveryReference(event, scriptEntryId, segment.index) : undefined;
}
export function aggregateDeliveryStatus(segments) {
    if (!segments.length || segments.every(item => item.status === 'pending'))
        return 'pending';
    if (segments.every(item => item.status === 'delivered'))
        return 'delivered';
    if (segments.some(item => item.status === 'delivered'))
        return 'partial';
    if (segments.some(item => item.status === 'pending'))
        return 'pending';
    if (segments.some(item => item.status === 'failed'))
        return 'failed';
    return 'cancelled';
}
function deliverySegments(event) {
    if (isOutgoingScriptEvent(event)) {
        return event.bubbles.map((content, index) => ({ index, kind: 'message', content, status: 'pending' }));
    }
    if (event.kind !== 'platform-action' || !event.metadata)
        return [];
    const segments = [];
    const localMedia = event.metadata.localMedia;
    if (isRecord(localMedia) && typeof localMedia.assetId === 'string') {
        segments.push({ index: segments.length, kind: 'local-media', content: localMedia.assetId, status: 'pending' });
    }
    const nativeFace = event.metadata.nativeFace;
    if (isRecord(nativeFace) && typeof nativeFace.semantic === 'string') {
        segments.push({ index: segments.length, kind: 'native-face', content: nativeFace.semantic, status: 'pending' });
    }
    const reactions = Array.isArray(event.metadata.messageReactions) ? event.metadata.messageReactions : [];
    for (const reaction of reactions) {
        if (!isRecord(reaction) || typeof reaction.messageRef !== 'string' || typeof reaction.reaction !== 'string')
            continue;
        segments.push({
            index: segments.length,
            kind: 'message-reaction',
            content: `${reaction.messageRef}:${reaction.reaction}`,
            status: 'pending',
        });
    }
    return segments;
}
function isDeliveryAction(value) {
    if (!isRecord(value) || typeof value.commitId !== 'string' || typeof value.eventId !== 'string' || !Array.isArray(value.segments))
        return false;
    return value.segments.every(segment => isRecord(segment)
        && Number.isSafeInteger(segment.index)
        && typeof segment.kind === 'string'
        && typeof segment.content === 'string'
        && typeof segment.status === 'string');
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
