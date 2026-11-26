/** Bound a Puppeteer operation even when its underlying protocol call cannot be
 * aborted. Discard late results (closing a page that was created too late). */
export function runBrowserOperation<T>(signal: AbortSignal, start: () => Promise<T>, onLate?: (value: T) => Promise<unknown>) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => {
      signal.throwIfAborted()
      return start()
    }).then(value => {
      signal.removeEventListener('abort', abort)
      if (!signal.aborted) resolve(value)
      else if (onLate) void Promise.resolve().then(() => onLate(value)).catch((): undefined => undefined)
    }, error => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
  })
}

// Keep real Chromium capacity separate from the bounded caller's slot. If
// open/close never settles, later jobs fail fast instead of piling up pages.
const leases = new WeakMap<object, number>()

export async function openBrowserPage(browser: { page(): Promise<any> }, max: number, signal: AbortSignal) {
  const release = () => {
    const remaining = (leases.get(browser) ?? 1) - 1
    if (remaining) leases.set(browser, remaining)
    else leases.delete(browser)
  }
  const close = (page: any) => Promise.resolve().then(() => page.close()).catch((): undefined => undefined).finally(release)
  const page = await runBrowserOperation(signal, () => {
    const count = leases.get(browser) ?? 0
    if (count >= max) throw new Error('browser page capacity is awaiting Chromium cleanup')
    leases.set(browser, count + 1)
    return Promise.resolve().then(() => browser.page()).catch(error => { release(); throw error })
  }, close)
  return { page, close: () => close(page) }
}
