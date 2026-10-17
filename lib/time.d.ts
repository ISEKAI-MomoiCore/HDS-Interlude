export declare function resolveTimezone(timezone: string): string;
export declare function storyLocalTimeContext(value: Date, timezone: string): {
    timezone: string;
    utc: string;
    local: string;
    date: string;
    time: string;
    hour: number;
    weekday: string;
    offset: string;
    period: string;
    periodZh: "上午" | "下午" | "傍晚/晚上" | "夜间";
    daylightExpectation: string;
};
export declare function formatLogTime(value: Date | null | undefined, timezone: string): string;
/** Human-facing command output: unlike logs, include the configured story
 * timezone offset so copied timeline records never look like UTC. */
export declare function formatStoryDisplayTime(value: Date | null | undefined, timezone: string): string;
export declare function localClockMinutes(value: Date, timezone: string): number;
/** Prompt-side compact clock (HH:mm, story timezone) for pointers such as
 * delivery receipts. Returns '' for absent or invalid dates and timezones. */
export declare function formatStoryClock(value: Date | null | undefined, timezone: string | undefined): string;
export declare function calendarDayKey(value: Date, timezone: string): string;
export declare function timeFormatterCacheSize(): number;
