const formatterCache = new Map();
const timezoneCache = new Map();
function formatter(kind, locale, timezone, options) {
    const resolved = resolveTimezone(timezone);
    const key = `${kind}:${locale}:${resolved}`;
    const existing = formatterCache.get(key);
    if (existing)
        return existing;
    const created = new Intl.DateTimeFormat(locale, { ...options, timeZone: resolved });
    formatterCache.set(key, created);
    return created;
}
export function resolveTimezone(timezone) {
    const candidate = timezone?.trim() || 'UTC';
    const cached = timezoneCache.get(candidate);
    if (cached !== undefined)
        return cached ? candidate : 'UTC';
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
        timezoneCache.set(candidate, true);
        return candidate;
    }
    catch {
        timezoneCache.set(candidate, false);
        return 'UTC';
    }
}
export function storyLocalTimeContext(value, timezone) {
    const resolvedTimezone = resolveTimezone(timezone);
    const parts = formatter('story', 'en-US', resolvedTimezone, {
        year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        timeZoneName: 'shortOffset',
    }).formatToParts(value);
    const part = (type) => parts.find(item => item.type === type)?.value ?? '';
    const hour = Number(part('hour'));
    const period = hour >= 5 && hour < 12 ? 'morning'
        : hour >= 12 && hour < 18 ? 'afternoon'
            : hour >= 18 && hour < 22 ? 'evening'
                : 'night';
    const periodZh = { morning: '上午', afternoon: '下午', evening: '傍晚/晚上', night: '夜间' }[period];
    const daylightExpectation = period === 'morning' || period === 'afternoon'
        ? 'normally daylight unless current weather, season, or setting explicitly says otherwise'
        : period === 'evening'
            ? 'transitioning toward darkness; use the established season and setting'
            : 'normally dark outside unless the setting explicitly says otherwise';
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    const time = `${part('hour')}:${part('minute')}:${part('second')}`;
    return {
        timezone: resolvedTimezone,
        utc: value.toISOString(),
        local: `${date} ${time}`,
        date,
        time,
        hour,
        weekday: part('weekday'),
        offset: part('timeZoneName'),
        period,
        periodZh,
        daylightExpectation,
    };
}
export function formatLogTime(value, timezone) {
    if (!value || Number.isNaN(value.getTime()))
        return '-';
    return formatter('log', 'zh-CN', timezone, {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(value);
}
/** Human-facing command output: unlike logs, include the configured story
 * timezone offset so copied timeline records never look like UTC. */
export function formatStoryDisplayTime(value, timezone) {
    if (!value || Number.isNaN(value.getTime()))
        return '-';
    const context = storyLocalTimeContext(value, timezone);
    return `${context.local} ${context.offset || 'GMT+0'}`;
}
export function localClockMinutes(value, timezone) {
    const parts = formatter('clock', 'en-GB', timezone, {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(value);
    const hour = Number(parts.find(part => part.type === 'hour')?.value ?? value.getUTCHours());
    const minute = Number(parts.find(part => part.type === 'minute')?.value ?? value.getUTCMinutes());
    return hour * 60 + minute;
}
export function calendarDayKey(value, timezone) {
    return formatter('day', 'en-CA', timezone, {
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(value);
}
export function timeFormatterCacheSize() {
    return formatterCache.size;
}
