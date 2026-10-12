/**
 * P3: In-memory rolling health metrics for the Console panel.
 * Counters are maintained per story and reported via a Console-exposed getter.
 * No persistence: resets on plugin reload, which is the expected behaviour for
 * a "since last reload" health view.
 */
const MAX_LATENCIES = 200;
function newState() {
    return {
        narrativeTotal: 0, narrativeFailed: 0, structureMissing: 0, recoverySaved: 0,
        replyModes: { immediate: 0, none: 0, delayed: 0, noDelivery: 0 },
        sideTaskTotal: 0, sideTaskFailed: 0,
        proactiveTotal: 0, proactiveSent: 0,
        inputTokens: 0, cachedTokens: 0,
        latenciesMs: [],
        startedAt: new Date(),
    };
}
export class HealthMonitor {
    stories = new Map();
    state(storyId) {
        let state = this.stories.get(storyId);
        if (!state) {
            state = newState();
            this.stories.set(storyId, state);
        }
        return state;
    }
    recordNarrativeComplete(storyId, latencyMs, replyMode) {
        const s = this.state(storyId);
        s.narrativeTotal++;
        s.latenciesMs.push(latencyMs);
        if (s.latenciesMs.length > MAX_LATENCIES)
            s.latenciesMs.shift();
        if (replyMode === 'immediate')
            s.replyModes.immediate++;
        else if (replyMode === 'none')
            s.replyModes.none++;
        else if (replyMode === 'delayed')
            s.replyModes.delayed++;
        else
            s.replyModes.noDelivery++;
    }
    recordNarrativeFailed(storyId) {
        this.state(storyId).narrativeFailed++;
    }
    recordStructureMissing(storyId) {
        this.state(storyId).structureMissing++;
    }
    recordRecoverySaved(storyId) {
        this.state(storyId).recoverySaved++;
    }
    recordSideTask(storyId, ok) {
        const s = this.state(storyId);
        s.sideTaskTotal++;
        if (!ok)
            s.sideTaskFailed++;
    }
    recordProactive(storyId, sent) {
        const s = this.state(storyId);
        s.proactiveTotal++;
        if (sent)
            s.proactiveSent++;
    }
    recordTokens(storyId, input, cached) {
        const s = this.state(storyId);
        s.inputTokens += input;
        s.cachedTokens += cached;
    }
    snapshot(storyId) {
        const s = this.state(storyId);
        const total = s.narrativeTotal + s.narrativeFailed;
        const sorted = [...s.latenciesMs].sort((a, b) => a - b);
        const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
        return {
            narrativeTotal: s.narrativeTotal,
            narrativeFailed: s.narrativeFailed,
            structureMissing: s.structureMissing,
            recoverySaved: s.recoverySaved,
            replyModes: { ...s.replyModes },
            sideTaskTotal: s.sideTaskTotal,
            sideTaskFailed: s.sideTaskFailed,
            proactiveTotal: s.proactiveTotal,
            proactiveSent: s.proactiveSent,
            inputTokens: s.inputTokens,
            cachedTokens: s.cachedTokens,
            latenciesMs: [...s.latenciesMs],
            sinceAt: s.startedAt.toISOString(),
            successRate: total ? s.narrativeTotal / total : 1,
            structureMissingRate: s.narrativeTotal ? s.structureMissing / s.narrativeTotal : 0,
            cacheHitRate: s.inputTokens ? s.cachedTokens / s.inputTokens : 0,
            proactiveRate: s.proactiveTotal ? s.proactiveSent / s.proactiveTotal : 0,
            medianLatencyMs: median,
        };
    }
    all() {
        const out = {};
        for (const [id] of this.stories)
            out[id] = this.snapshot(id);
        return out;
    }
}
