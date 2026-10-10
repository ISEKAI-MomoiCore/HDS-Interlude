import { AsyncLocalStorage } from 'node:async_hooks';
export interface DesktopProcessingContext {
    traceId: string;
    processingId: string;
}
/** Shared only by the optional typ-0 bridge and HDSI delivery code. */
export declare const desktopProcessingContext: AsyncLocalStorage<DesktopProcessingContext>;
export declare function currentDesktopProcessingContext(): DesktopProcessingContext | undefined;
export declare function persistedDesktopProcessingContext(value: unknown): Partial<DesktopProcessingContext>;
