export function isOutgoingScriptEvent(event) {
    return (event.kind === 'outgoing-message' || event.kind === 'group-message')
        && typeof event.content === 'string'
        && Array.isArray(event.bubbles)
        && (event.deliveryMode === 'immediate' || event.deliveryMode === 'delayed');
}
export function messageEventReference(event, bubbleIndex = 0, scriptEntryId) {
    if (!isOutgoingScriptEvent(event))
        return undefined;
    return {
        commitId: event.commitId,
        eventId: event.eventId,
        ...(Number.isSafeInteger(scriptEntryId) ? { scriptEntryId } : {}),
        eventKind: event.kind,
        causedByEventIds: [...event.causedByEventIds],
        ...(event.endpointId ? { endpointId: event.endpointId } : {}),
        fullContent: event.content,
        bubbleIndex,
        bubbleCount: event.bubbles.length,
    };
}
