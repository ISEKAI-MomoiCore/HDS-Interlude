/** A pending batch keeps its first local enqueue time across timer resets.
 * The deadline bounds debounce only; story ownership/pause remain scheduler gates. */
export interface DebounceWindow { debounceStartedAt?: number }
export function boundedDebounceDelay(window: DebounceWindow, quietMs: number, maxWaitMs: number, now = Date.now()): number {
  window.debounceStartedAt ??= now
  return Math.max(0, Math.min(quietMs, window.debounceStartedAt + maxWaitMs - now))
}
