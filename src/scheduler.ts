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

export type MaybePromise<T> = T | Promise<T>

export interface DueIntentWake {
  cancel: () => void
  dueAt: number
}

export interface BackoffEntry {
  fingerprint: string
  until: number
}

/** 最小依赖集——不含到期判断/模型调用/持久化（那些留在 service 的回调里）。 */
export interface SchedulerDeps {
  setTimeout: (fn: () => void, ms: number) => () => void
  /** 注入时钟（测试用）；缺省 Date.now。 */
  now?: () => number
  /** 唤醒遇 busy 后的重排间隔（service 传 Time.second）。 */
  retryDelayMs: number
  /** 独占任务等待前台回合的重试间隔（service 传 500）。 */
  deferDelayMs: number
  onWakeError: (error: unknown) => void
  onTaskError: (error: unknown) => void
}

export interface ExclusiveControls {
  /** true = 放弃本次任务并释放去重门（暂停/数据库重置）。 */
  halted: () => boolean
  /** true = 让出执行权，deferDelayMs 后重试（前台回合进行中）。 */
  defer: () => boolean
  /** 入队成功后、首次运行前回调（打点“已排队”日志）。 */
  onQueued?: () => void
}

export interface Scheduler {
  /** 仲裁并安排唤醒；返回实际排定的延迟 ms，已有更早唤醒时返回 undefined 且不动现有定时器。 */
  scheduleWake(storyId: string, notBefore: Date, fire: () => MaybePromise<'busy' | void>): number | undefined
  cancelWake(storyId: string): void
  /** 取消全部（storyId 缺省）或指定故事的唤醒。 */
  cancelWakes(storyId?: string): void
  pendingWakeCount(): number

  /** 去重门 + 等待循环；返回 false 表示同 key 任务已在途。 */
  scheduleExclusive(key: string, task: () => Promise<unknown>, controls: ExclusiveControls): boolean
  hasExclusive(key: string): boolean

  isBackedOff(key: string, fingerprint: string, now?: number): boolean
  noteBackoff(key: string, fingerprint: string, until: number): void
  clearBackoff(key?: string): void
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const wakeTimers = new Map<string, DueIntentWake>()
  const exclusive = new Set<string>()
  const backoffs = new Map<string, BackoffEntry>()
  const now = () => deps.now?.() ?? Date.now()

  function scheduleWake(storyId: string, notBefore: Date, fire: () => MaybePromise<'busy' | void>): number | undefined {
    const dueAt = notBefore.getTime()
    const existing = wakeTimers.get(storyId)
    // Several <sep/> segments can be scheduled at once. Keep the earliest
    // wake-up; the next due segment schedules the following wake as needed.
    if (existing && existing.dueAt <= dueAt && existing.dueAt !== Infinity) return undefined
    if (existing) existing.cancel()
    const token: DueIntentWake = { cancel: () => {}, dueAt }
    const wake = () => {
      if (wakeTimers.get(storyId) !== token) return
      token.dueAt = Infinity
      // A long narrative request can overlap the simulated typing delay. The
      // fire callback reports 'busy' and the scheduler retries shortly,
      // rather than waiting for the next normal sweep. The .then indirection
      // funnels synchronous throws into the same catch, like the async IIFE
      // it replaced.
      Promise.resolve().then(() => fire()).then(result => {
        if (wakeTimers.get(storyId) !== token) return
        if (result !== 'busy') { wakeTimers.delete(storyId); return }
        token.dueAt = now() + deps.retryDelayMs
        token.cancel = deps.setTimeout(wake, deps.retryDelayMs)
      }).catch(error => {
        if (wakeTimers.get(storyId) === token) wakeTimers.delete(storyId)
        deps.onWakeError(error)
      })
    }
    const delay = Math.max(0, dueAt - now())
    const timer = deps.setTimeout(wake, delay)
    token.cancel = timer
    wakeTimers.set(storyId, token)
    return delay
  }

  function cancelWake(storyId: string) {
    const wake = wakeTimers.get(storyId)
    if (!wake) return
    wake.cancel()
    wakeTimers.delete(storyId)
  }

  function cancelWakes(storyId?: string) {
    for (const [key, wake] of wakeTimers) {
      if (storyId && key !== storyId) continue
      wake.cancel()
      wakeTimers.delete(key)
    }
  }

  function scheduleExclusive(key: string, task: () => Promise<unknown>, controls: ExclusiveControls): boolean {
    if (exclusive.has(key)) return false
    exclusive.add(key)
    controls.onQueued?.()
    const run = () => {
      if (controls.halted()) {
        exclusive.delete(key)
        return
      }
      if (controls.defer()) {
        deps.setTimeout(run, deps.deferDelayMs)
        return
      }
      Promise.resolve().then(() => task())
        .catch(error => deps.onTaskError(error))
        .finally(() => exclusive.delete(key))
    }
    run()
    return true
  }

  function isBackedOff(key: string, fingerprint: string, atNow?: number): boolean {
    const current = atNow ?? now()
    const entry = backoffs.get(key)
    if (!entry || entry.fingerprint !== fingerprint || current >= entry.until) {
      if (entry && current >= entry.until) backoffs.delete(key)
      return false
    }
    return true
  }

  function noteBackoff(key: string, fingerprint: string, until: number) {
    backoffs.set(key, { fingerprint, until })
  }

  function clearBackoff(key?: string) {
    if (key) backoffs.delete(key)
    else backoffs.clear()
  }

  return {
    scheduleWake, cancelWake, cancelWakes,
    pendingWakeCount: () => wakeTimers.size,
    scheduleExclusive,
    hasExclusive: (key: string) => exclusive.has(key),
    isBackedOff, noteBackoff, clearBackoff,
  }
}
