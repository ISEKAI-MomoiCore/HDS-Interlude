/** Bound a Puppeteer operation even when its underlying protocol call cannot be
 * aborted. Discard late results (closing a page that was created too late). */
export declare function runBrowserOperation<T>(signal: AbortSignal, start: () => Promise<T>, onLate?: (value: T) => Promise<unknown>): Promise<T>;
export declare function openBrowserPage(browser: {
    page(): Promise<any>;
}, max: number, signal: AbortSignal): Promise<{
    page: any;
    close: () => Promise<any>;
}>;
