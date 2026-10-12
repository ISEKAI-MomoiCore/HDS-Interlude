import { AsyncLocalStorage } from 'node:async_hooks';
/** Shared only by the optional typ-0 bridge and HDSI delivery code. */
export const desktopProcessingContext = new AsyncLocalStorage();
export function currentDesktopProcessingContext() {
    return desktopProcessingContext.getStore();
}
export function persistedDesktopProcessingContext(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const record = value;
    const traceId = typeof record.traceId === 'string' && record.traceId.length > 0 && record.traceId.length <= 128
        ? record.traceId
        : undefined;
    const processingId = typeof record.processingId === 'string' && record.processingId.length > 0 && record.processingId.length <= 128
        ? record.processingId
        : undefined;
    return {
        ...(traceId ? { traceId } : {}),
        ...(processingId ? { processingId } : {}),
    };
}
