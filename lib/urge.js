const minute = 60_000;
const record = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const finite = (v, fallback, min, max) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
export function resolveUrgeConfig(raw) {
    const c = record(raw), a = record(c.advanced);
    const frequency = ['low', 'medium', 'high', 'custom'].includes(String(c.frequency)) ? String(c.frequency) : 'medium';
    const defaults = frequency === 'low' ? [20, 30, 60, 90, 5, 10, 120, 180] : frequency === 'high' ? [6, 12, 20, 35, 2, 5, 90, 120] : [10, 20, 35, 55, 3, 7, 110, 130];
    const range = (name, i) => {
        const lo = finite(a[name + 'Min'], defaults[i], 1, 1440);
        return [lo, Math.max(lo, finite(a[name + 'Max'], defaults[i + 1], 1, 1440))];
    };
    return {
        enabled: c.enabled === true, frequency,
        willingness: finite(c.proactiveWillingnessThreshold, .4, 0, 1),
        hot: range('hot', 0), idle: range('idle', 2), burst: range('burst', 4), slow: range('slow', 6),
        halfLife: finite(a.halfLifeMinutes, 45, 5, 240), threshold: finite(a.burstThreshold, .75, 0, 1),
        jitter: finite(a.jitter, .15, 0, 1), extremeChance: finite(a.extremeChance, .03, 0, 1),
        ttl: finite(a.burstTtlMinutes, 35, 5, 120), budget: Math.floor(finite(a.burstBudget, 3, 0, 10)),
        contactMin: finite(a.burstContactMinMinutes, 5, 1, 60),
    };
}
export function normalizeUrgeState(raw, now) {
    const r = record(raw);
    if (r.version !== 1)
        return { version: 1, buckets: [] };
    const a = record(r.armed), b = record(r.burst);
    const timestamp = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= now;
    return {
        version: 1, mode: typeof r.mode === 'string' ? r.mode : undefined,
        buckets: Array.isArray(r.buckets) ? [...new Set(r.buckets.filter((v) => timestamp(v) && now - v < 240 * minute))].sort((a, b) => a - b).slice(-120) : [],
        value: typeof r.value === 'number' ? finite(r.value, 0, 0, 1) : undefined,
        pace: r.pace === 'slow' ? 'slow' : 'normal', suggested: typeof r.suggested === 'number' ? finite(r.suggested, 120, 1, 1440) : undefined,
        sourceEntryId: typeof r.sourceEntryId === 'number' ? r.sourceEntryId : undefined,
        spent: r.spent === true, reason: typeof r.reason === 'string' ? r.reason.slice(0, 160) : undefined,
        armed: typeof a.participantId === 'string' && typeof a.entryId === 'number' && timestamp(a.at) && now - Number(a.at) < 10 * minute
            ? { participantId: a.participantId, entryId: a.entryId, at: Number(a.at) } : undefined,
        burst: typeof b.participantId === 'string' && timestamp(b.started)
            ? { participantId: b.participantId, started: Number(b.started), used: Math.floor(finite(b.used, 0, 0, 10)) } : undefined,
    };
}
export function urgeUserEvent(state, now) {
    // Two-minute buckets merge typing fragments; only real incoming events call this.
    const bucket = Math.floor(now / (2 * minute)) * 2 * minute;
    return { ...state, buckets: [...new Set([...state.buckets, bucket])].slice(-120), pace: 'normal', suggested: undefined, armed: undefined, burst: undefined, spent: false };
}
export function urgeDensity(state, now, c) {
    const last = state.buckets.at(-1);
    if (last === undefined)
        return 0;
    const recent = state.buckets.filter(t => t >= last - 15 * minute).length;
    return Math.min(1, recent / 6) * Math.pow(.5, Math.max(0, now - last) / (c.halfLife * minute));
}
export function commitUrge(state, raw, script, entryId, target, now, c, random = Math.random) {
    const r = record(raw);
    const quote = typeof r.basisQuote === 'string' ? r.basisQuote.trim() : '';
    // A missing/invalid handoff cannot perpetuate an old slow phase or burst.
    if (!quote || !script.includes(quote) || typeof r.value !== 'number' || !Number.isFinite(r.value))
        return { ...state, pace: 'normal', suggested: undefined, armed: undefined, burst: undefined };
    const value = random() < c.extremeChance ? random() : finite(r.value + (random() * 2 - 1) * c.jitter, 0, 0, 1);
    const pace = r.pace === 'slow' ? 'slow' : 'normal';
    const high = value >= c.threshold && pace !== 'slow';
    return { ...state, value, pace, sourceEntryId: entryId,
        suggested: typeof r.suggestedDelayMinutes === 'number' ? finite(r.suggestedDelayMinutes, 120, 1, 1440) : undefined,
        burst: high ? state.burst : undefined,
        armed: high && target && !state.spent && !state.burst && c.budget > 0 ? { participantId: target, entryId, at: now } : undefined,
    };
}
export function acknowledgeUrge(state, participantId, entryId, now) {
    if (!state.armed || state.armed.participantId !== participantId || state.armed.entryId !== entryId || state.spent)
        return state;
    return { ...state, armed: undefined, spent: true, burst: { participantId, started: now, used: 0 } };
}
export function urgeBurstActive(state, now, c, participantId) {
    return !!state.burst && (!participantId || participantId === state.burst.participantId)
        && now - state.burst.started < c.ttl * minute && state.burst.used <= c.budget && state.pace !== 'slow';
}
export function planUrge(state, now, c, restMinutes = 0, unavailable = false, random = Math.random) {
    const sample = (range) => range[0] + random() * (range[1] - range[0]);
    let next = { ...state };
    let minutes, reason;
    if (restMinutes > 0 || state.pace === 'slow') {
        const suggested = state.suggested === undefined ? sample(c.slow) : Math.max(c.slow[0], Math.min(c.slow[1], state.suggested * (.9 + random() * .2)));
        minutes = Math.max(restMinutes, suggested);
        reason = restMinutes ? 'rest-window' : 'script-slow';
        next = { ...next, burst: undefined, armed: undefined };
    }
    else if (!unavailable && urgeBurstActive(state, now, c) && state.burst.used < c.budget) {
        minutes = sample(c.burst) * Math.pow(2, state.burst.used);
        minutes = Math.min(minutes, Math.max(1, (state.burst.started + c.ttl * minute - now) / minute));
        reason = 'confirmed-contact-burst';
        next.burst = { ...state.burst, used: state.burst.used + 1 };
    }
    else {
        const idle = sample(c.idle), hot = Math.min(idle, sample(c.hot));
        minutes = idle - urgeDensity(state, now, c) * (idle - hot);
        reason = 'conversation-density-decay';
        next.burst = undefined;
        if (unavailable)
            next.armed = undefined;
    }
    next.reason = reason;
    return { state: next, nextAdvanceAt: new Date(now + minutes * minute).toISOString(), minutes, reason };
}
export function urgeInstruction(enabled, phase) {
    return enabled && ['advance', 'conversation-follow-up', 'intent-due'].includes(phase)
        ? '\nAfter writing the full script and its actions, optionally return urge:{value:0..1, pace:"normal"|"slow", suggestedDelayMinutes:number, basisQuote:"exact sentence from this script"}. Reflect the protagonist\'s present impulse and natural next opportunity to continue life; slow suits sleep or sustained focus. This is only a scheduling handoff, not speech, a future event, or a second contact decision. Continue using the existing authored actions and proactiveContact for any contact.' : '';
}
