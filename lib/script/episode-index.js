import { indexOriginal, scoreOriginal, originalWindow } from './recall-navigation';
export function buildEpisodeIndex(rows) {
    const groups = new Map();
    const checkpoints = rows.map(([, row]) => row.checkpoint).filter((item) => !!item
        && Number.isSafeInteger(item.firstEntryId) && Number.isSafeInteger(item.lastEntryId));
    const ordered = [...checkpoints].sort((a, b) => a.firstEntryId - b.firstEntryId);
    const disjoint = ordered.every((item, i) => !i || ordered[i - 1].lastEntryId < item.firstEntryId);
    const checkpointAt = (id) => {
        if (!disjoint)
            return checkpoints.find(item => id >= item.firstEntryId && id <= item.lastEntryId);
        let lo = 0, hi = ordered.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (ordered[mid].firstEntryId <= id)
                lo = mid + 1;
            else
                hi = mid;
        }
        const item = ordered[lo - 1];
        return item && id <= item.lastEntryId ? item : undefined;
    };
    for (const [id, row] of rows) {
        const checkpoint = checkpointAt(id);
        const key = JSON.stringify([row.participantId, checkpoint ? `scene:${checkpoint.sceneId}` : row.frameId || `entry:${id}`]);
        const ids = groups.get(key) ?? [];
        ids.push(id);
        groups.set(key, ids);
    }
    const byEntry = new Map();
    for (const ids of groups.values())
        for (const id of ids)
            byEntry.set(id, ids);
    return byEntry;
}
/** Keep the actual hit, then the closest original entries. Source ids always
 * describe text included in the result, not an omitted part of the episode. */
export function episodeExcerpt(rows, anchorId, budget = 4000, queryKeys = []) {
    const position = rows.findIndex(([id]) => id === anchorId);
    if (position < 0)
        return undefined;
    const selected = new Map();
    let remaining = budget;
    for (const index of [position, position + 1, position - 1, position + 2, position - 2]) {
        const row = rows[index];
        if (!row || remaining < 40)
            continue;
        if (index !== position && row[1].content.length + 100 > remaining)
            continue;
        const owner = row[1].kind === 'user-message' ? 'user-delivered-message'
            : row[1].kind === 'script' ? 'protagonist-narrative'
                : row[1].kind === 'group-message' ? 'group-member-message' : 'protagonist-delivered-message';
        const spans = row[1].spans ??= indexOriginal(row[1].content);
        const hit = scoreOriginal(queryKeys, spans);
        const window = originalWindow(row[1].content, spans, hit.index, Math.max(0, remaining - 180), queryKeys);
        const partial = window.start > 0 || window.end < row[1].content.length;
        const text = `[${row[1].occurredAt}; ${owner}; entry:${row[0]}${partial ? `; source-view UTF-16 [${window.start},${window.end})/${row[1].content.length}, not a complete event` : ''}] ${window.content}`;
        if (index !== position && text.length > remaining)
            continue;
        selected.set(row[0], text);
        remaining -= text.length + 1;
    }
    const ordered = rows.filter(([id]) => selected.has(id));
    return { sourceEntryIds: ordered.map(([id]) => id), content: ordered.map(([id]) => selected.get(id)).join('\n') };
}
/** Tags are literal navigation spans, never generated summaries or facts. */
export function groundedEpisodeTags(content, draft) {
    const result = {};
    for (const key of ['people', 'places', 'objects', 'topics', 'commitments', 'outcomes', 'dates']) {
        const values = draft[key];
        if (!Array.isArray(values))
            continue;
        const grounded = [...new Set(values.filter((value) => typeof value === 'string'
                && value.trim().length >= 2 && value.length <= 100 && content.includes(value)))].slice(0, 8);
        if (grounded.length)
            result[key] = grounded;
    }
    return result;
}
export function episodeTagScore(query, tags = []) {
    return tags.some(tag => query.includes(tag)) ? 0.8 : 0;
}
