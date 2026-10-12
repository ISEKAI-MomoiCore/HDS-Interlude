/** Only call with entries already filtered for the current relationship.
 * This is an execution annotation of the same script, never replacement prose. */
export function deliveryReality(entries, participantId, shareParticipantDetails = false, limit = 8) {
    return entries.filter(entry => entry.kind === 'script').flatMap(entry => {
        const actions = entry.metadata?.deliveryActions;
        if (!Array.isArray(actions))
            return [];
        if (!actions.length && entry.metadata?.commitId)
            return [{
                    sourceEntryId: entry.id, eventId: '', segments: [],
                    communicationOutcome: 'no-outgoing-action-recorded',
                }];
        return actions.flatMap(action => {
            if (!action || action.commitId !== entry.metadata.commitId || !Array.isArray(action.segments))
                return [];
            if (action.participantId && action.participantId !== participantId && !shareParticipantDetails)
                return [];
            const segments = action.segments.filter((item) => item && typeof item.content === 'string'
                && ['pending', 'delivered', 'failed', 'cancelled'].includes(item.status));
            if (!segments.some((item) => item.status !== 'delivered'))
                return [];
            return [{ sourceEntryId: entry.id, eventId: action.eventId,
                    segments: segments.map((item) => ({ kind: item.kind, content: item.content,
                        outcome: item.status === 'pending' ? 'not-confirmed' : item.status === 'failed' ? 'delivery-not-confirmed-after-error' : item.status })) }];
        });
    }).slice(-limit);
}
