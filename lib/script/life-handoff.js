/** Small pointers into this committed original, not a second scene summary.
 * Quotes establish provenance, not semantic proof; inference stays literary. */
export function normalizeLifeHandoff(raw, prose) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    const value = raw;
    const quoted = (quote) => typeof quote === 'string'
        && quote.trim().length >= 2 && quote.length <= 500 && prose.includes(quote);
    const result = {};
    for (const key of ['place', 'activity']) {
        const item = value[key];
        if (item && typeof item.value === 'string' && item.value.trim() && item.value.length <= 160 && quoted(item.quote))
            result[key] = { value: item.value.trim(), quote: item.quote };
    }
    if (value.presence && Array.isArray(value.presence.names) && quoted(value.presence.quote)
        && value.presence.names.every((name) => typeof name === 'string' && name.trim() && value.presence.quote.includes(name))) {
        result.presence = { names: [...new Set(value.presence.names)].slice(0, 8), quote: value.presence.quote };
    }
    if (value.transition && quoted(value.transition.quote))
        result.transition = { quote: value.transition.quote };
    if (Array.isArray(value.resolvedDetails))
        result.resolvedDetails = value.resolvedDetails
            .filter((item) => item && typeof item.label === 'string' && item.label.length <= 80 && quoted(item.quote))
            .slice(0, 10).map((item) => ({ label: item.label, quote: item.quote }));
    return Object.keys(result).length ? result : undefined;
}
export function entryLifeHandoff(entry) {
    return entry.kind === 'script' ? normalizeLifeHandoff(entry.metadata?.lifeHandoff, entry.content) : undefined;
}
/** New originals are the completed record; their director plan stays a plan.
 * Legacy ledgers remain distinguishable rather than reinterpreted in place. */
export function narrativeEvidence(entry) {
    return {
        ...(entry.metadata?.commitId && Array.isArray(entry.metadata.deliveryActions) && !entry.metadata.deliveryActions.length
            ? { communicationOutcome: 'no-outgoing-action-recorded' } : {}),
        ...(entry.metadata?.narrativeAuthority === 'original-v2' ? {
            narrativeAuthority: 'original-v2', lifeHandoff: entryLifeHandoff(entry),
            ...(entry.metadata?.timelinePlan ? { proposedTimeline: entry.metadata.timelinePlan } : {}),
        } : entry.metadata?.timelinePlan ? { timelineEvidence: entry.metadata.timelinePlan } : {}),
    };
}
