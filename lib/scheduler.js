/**
 * P1: Scheduler——从 service.ts 抽出的调度状态管理。
 *
 * 拥有三块状态：
 *  - wakeTimers: 每故事一个“最早到期唤醒”（keep-earliest 仲裁；fire 返回 'busy'
 *    时按 retryDelayMs 自动重排，而不是等下一个常规 sweep）
 *  - exclusive: 独占任务去重门（同 key 任务在途时不再入队；可 halted 放弃让出门，
 *    defer 等待前台回合结束后再跑）
 *  - backoffs: 指纹冷却表（同一失败范围在 until 之前不重试）
 * 执行体（模型调用/投递/持久化）留在 service，经 fire/task 回调交互。
 */
export function createScheduler(deps) {
    const wakeTimers = new Map();
    const exclusive = new Set();
    const backoffs = new Map();
    const now = () => deps.now?.() ?? Date.now();
    function scheduleWake(storyId, notBefore, fire) {
        const dueAt = notBefore.getTime();
        const existing = wakeTimers.get(storyId);
        // Several <sep/> segments can be scheduled at once. Keep the earliest
        // wake-up; the next due segment schedules the following wake as needed.
        if (existing && existing.dueAt <= dueAt && existing.dueAt !== Infinity)
            return undefined;
        if (existing)
            existing.cancel();
        const token = { cancel: () => { }, dueAt };
        const wake = () => {
            if (wakeTimers.get(storyId) !== token)
                return;
            token.dueAt = Infinity;
            // A long narrative request can overlap the simulated typing delay. The
            // fire callback reports 'busy' and the scheduler retries shortly,
            // rather than waiting for the next normal sweep. The .then indirection
            // funnels synchronous throws into the same catch, like the async IIFE
            // it replaced.
            Promise.resolve().then(() => fire()).then(result => {
                if (wakeTimers.get(storyId) !== token)
                    return;
                if (result !== 'busy') {
                    wakeTimers.delete(storyId);
                    return;
                }
                token.dueAt = now() + deps.retryDelayMs;
                token.cancel = deps.setTimeout(wake, deps.retryDelayMs);
            }).catch(error => {
                if (wakeTimers.get(storyId) === token)
                    wakeTimers.delete(storyId);
                deps.onWakeError(error);
            });
        };
        const delay = Math.max(0, dueAt - now());
        const timer = deps.setTimeout(wake, delay);
        token.cancel = timer;
        wakeTimers.set(storyId, token);
        return delay;
    }
    function cancelWake(storyId) {
        const wake = wakeTimers.get(storyId);
        if (!wake)
            return;
        wake.cancel();
        wakeTimers.delete(storyId);
    }
    function cancelWakes(storyId) {
        for (const [key, wake] of wakeTimers) {
            if (storyId && key !== storyId)
                continue;
            wake.cancel();
            wakeTimers.delete(key);
        }
    }
    function scheduleExclusive(key, task, controls) {
        if (exclusive.has(key))
            return false;
        exclusive.add(key);
        controls.onQueued?.();
        const run = () => {
            if (controls.halted()) {
                exclusive.delete(key);
                return;
            }
            if (controls.defer()) {
                deps.setTimeout(run, deps.deferDelayMs);
                return;
            }
            Promise.resolve().then(() => task())
                .catch(error => deps.onTaskError(error))
                .finally(() => exclusive.delete(key));
        };
        run();
        return true;
    }
    function isBackedOff(key, fingerprint, atNow) {
        const current = atNow ?? now();
        const entry = backoffs.get(key);
        if (!entry || entry.fingerprint !== fingerprint || current >= entry.until) {
            if (entry && current >= entry.until)
                backoffs.delete(key);
            return false;
        }
        return true;
    }
    function noteBackoff(key, fingerprint, until) {
        backoffs.set(key, { fingerprint, until });
    }
    function clearBackoff(key) {
        if (key)
            backoffs.delete(key);
        else
            backoffs.clear();
    }
    return {
        scheduleWake, cancelWake, cancelWakes,
        pendingWakeCount: () => wakeTimers.size,
        scheduleExclusive,
        hasExclusive: (key) => exclusive.has(key),
        isBackedOff, noteBackoff, clearBackoff,
    };
}
