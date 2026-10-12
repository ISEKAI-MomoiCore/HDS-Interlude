export function recallKeys(text) {
    const normalized = text.toLowerCase();
    const words = normalized.match(/[a-z0-9]{2,}/g) ?? [];
    for (const run of normalized.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
        for (let i = 0; i < run.length - 1; i++)
            words.push(run.slice(i, i + 2));
    }
    return [...new Set(words)];
}
export function indexOriginal(content) {
    const spans = [];
    // Sentence boundaries keep conditions with their sentence, unlike token cuts.
    const sentences = [...content.matchAll(/[^。！？\n]+[。！？\n]*|[。！？\n]+/g)];
    let start = 0;
    let end = 0;
    const push = () => {
        if (end > start)
            spans.push({ start, end, keys: new Set(recallKeys(content.slice(start, end))) });
        start = end;
    };
    for (const sentence of sentences) {
        if (end > start && end - start + sentence[0].length > 700)
            push();
        end = sentence.index + sentence[0].length;
    }
    push();
    return spans;
}
export function scoreOriginal(keys, spans) {
    let score = 0;
    let index = 0;
    if (!keys.length)
        return { score, index };
    for (let i = 0; i < spans.length; i++) {
        const value = keys.reduce((n, key) => n + Number(spans[i].keys.has(key)), 0) / keys.length;
        if (value > score) {
            score = value;
            index = i;
        }
    }
    return { score, index };
}
export function originalWindow(content, spans, index, budget, queryKeys = []) {
    if (content.length <= budget)
        return { content, start: 0, end: content.length };
    const anchor = spans[index];
    if (!anchor)
        return { content: content.slice(0, budget), start: 0, end: Math.min(budget, content.length) };
    let start = anchor.start;
    let end = anchor.end;
    if (end - start > budget && queryKeys.length) {
        const lower = content.toLowerCase();
        const offsets = queryKeys.map(key => lower.indexOf(key, anchor.start)).filter(offset => offset >= start && offset < end);
        if (offsets.length) {
            const hit = Math.min(...offsets);
            start = Math.max(start, Math.min(hit - Math.floor(budget / 3), end - budget));
        }
    }
    for (const neighbor of [spans[index - 1], spans[index + 1]]) {
        if (neighbor && Math.max(end, neighbor.end) - Math.min(start, neighbor.start) <= budget) {
            start = Math.min(start, neighbor.start);
            end = Math.max(end, neighbor.end);
        }
    }
    // A single very long sentence is explicitly an excerpt, not a complete record.
    end = Math.min(end, start + budget);
    return { content: content.slice(start, end), start, end };
}
/** Bounded query cues; plans navigate to evidence, never become that evidence. */
export function recallFocus(message, topics, intentSummaries) {
    const cues = [...new Set([...intentSummaries, ...topics].map(s => s.trim()).filter(Boolean))].slice(0, 3);
    return [message?.trim().slice(0, 400), ...cues.map(s => s.slice(0, 80))].filter(Boolean).join('\n');
}
