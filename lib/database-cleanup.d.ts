/** Runtime records owned by HDSI. The directory-backed global sticker library
 * intentionally survives story resets and runtime database clearing. */
export declare const RUNTIME_TABLES: readonly ["interlude_script_entry", "interlude_memory", "interlude_intent", "interlude_scene", "interlude_arc", "interlude_fact", "interlude_state_patch", "interlude_overlay_snapshot", "interlude_web_observation", "interlude_schedule_preplan", "interlude_participant", "interlude_seeded_event", "interlude_qzone_post", "interlude_work", "interlude_story", "interlude_long_arc_guidance", "interlude_long_arc_progress", "interlude_endpoint", "interlude_endpoint_state", "interlude_story_alias"];
export type RuntimeTable = typeof RUNTIME_TABLES[number];
export declare function cleanupKey(table: RuntimeTable, row: Record<string, any>): {
    [x: string]: any;
};
/** Explicit payloads are validated by the real model on the fallback write. */
export declare function cleanupPayload(table: RuntimeTable, row: Record<string, any>, setting?: unknown): Record<string, any>;
