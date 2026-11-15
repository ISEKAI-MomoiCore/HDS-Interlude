/** A pending batch keeps its first local enqueue time across timer resets.
 * The deadline bounds debounce only; story ownership/pause remain scheduler gates. */
export interface DebounceWindow {
    debounceStartedAt?: number;
}
export declare function boundedDebounceDelay(window: DebounceWindow, quietMs: number, maxWaitMs: number, now?: number): number;
