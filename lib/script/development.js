/** References into the supplied originals keep observation, interpretation
 * and reception together without writing another psychological summary. */
export function interactionEvidence(entries) {
    const ordered = [...entries].sort((a, b) => a.id - b.id);
    return ordered.filter(entry => entry.kind === 'user-message').slice(-16).map(feedback => {
        const branch = ordered.filter(entry => entry.participantId === feedback.participantId);
        const next = branch.find(entry => entry.id > feedback.id && entry.kind === 'user-message')?.id ?? Infinity;
        return {
            participantId: feedback.participantId, feedbackEntryId: feedback.id,
            priorCommunicationEntryId: branch.filter(entry => entry.id < feedback.id && entry.kind === 'character-message').at(-1)?.id,
            interpretationEntryIds: branch.filter(entry => entry.id > feedback.id && entry.id < next && entry.kind === 'script').map(entry => entry.id),
            responseEntryIds: branch.filter(entry => entry.id > feedback.id && entry.id < next && entry.kind === 'character-message').map(entry => entry.id),
        };
    });
}
export function reviewedDevelopmentSupport(draft, entries, participantId) {
    const review = draft.interactionReview;
    if (!review || review.outcome !== 'supported' || !Array.isArray(review.feedbackEntryIds) || !Array.isArray(review.responseEntryIds))
        return false;
    const cited = new Set(draft.sourceEntryIds ?? []);
    const valid = (id, kind) => cited.has(id) && entries.some(entry => entry.id === id
        && entry.kind === kind && entry.participantId === participantId);
    return review.feedbackEntryIds.length > 0 && review.responseEntryIds.length > 0
        && review.feedbackEntryIds.every(id => valid(id, 'user-message'))
        && review.responseEntryIds.every(id => valid(id, 'character-message'))
        && review.responseEntryIds.some(id => id > Math.max(...review.feedbackEntryIds));
}
/** A quiet turn still has a life context. Use visible original text only as a
 * relevance query, never as a fresh learning observation or evidence weight. */
export function developmentContextQuery(userMessage, dueSummaries, visibleEntries) {
    if (userMessage?.trim())
        return userMessage.trim();
    const lastScript = visibleEntries.filter(entry => entry.kind === 'script').at(-1);
    return [...dueSummaries, lastScript?.content.slice(-800) ?? ''].filter(Boolean).join('\n').slice(0, 1_200);
}
const dimensions = {
    character: ['traits', 'preferences', 'coping'],
    perspective: ['values', 'interpretation'],
    relationship: ['trust', 'closeness', 'boundaries'],
    world: ['established'],
};
/** Canon stays intact. New development proposals use a small vocabulary. */
export function developmentDimension(target, path) {
    const normalized = path.trim().replace(/^(development|character|perspective|relationship|world)\./, '');
    return dimensions[target]?.includes(normalized) ? normalized : undefined;
}
/** One completed scene contributes once regardless of prose length or turns.
 * Legacy rows without scene provenance remain readable but cannot multiply
 * confidence by their timestamps. */
export function developmentScenes(entries) {
    const checkpoints = entries.flatMap(entry => {
        const checkpoint = entry.metadata?.sceneCheckpoint;
        return checkpoint && typeof checkpoint === 'object' ? [checkpoint] : [];
    });
    const scenes = new Set();
    const frameScenes = new Map();
    for (const entry of entries) {
        const checkpoint = checkpoints.find(item => Number.isSafeInteger(item.sceneId)
            && entry.id >= item.firstEntryId && entry.id <= item.lastEntryId);
        if (checkpoint && typeof entry.metadata?.frameId === 'string')
            frameScenes.set(entry.metadata.frameId, `scene:${checkpoint.sceneId}`);
    }
    for (const entry of entries.filter(entry => entry.kind === 'script')) {
        const checkpoint = checkpoints.find(item => Number.isSafeInteger(item.sceneId)
            && entry.id >= item.firstEntryId && entry.id <= item.lastEntryId);
        const frame = entry.metadata?.frameId;
        if (checkpoint)
            scenes.add(`scene:${checkpoint.sceneId}`);
        else if (typeof frame === 'string' && frame)
            scenes.add(frameScenes.get(frame) ?? frame);
    }
    return scenes.size;
}
/** Provisional learning remains auditable in storage, but does not become a
 * prompt-side expectation until it has crossed a scene boundary. Applied
 * tendencies already passed the host's stricter evidence gate. */
export function promptReadyDevelopment(candidate, entries) {
    if (candidate.status === 'applied')
        return true;
    const sources = new Set(candidate.sourceEntryIds);
    return developmentScenes(entries.filter(entry => sources.has(entry.id))) >= 2;
}
