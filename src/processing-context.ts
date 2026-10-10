import { AsyncLocalStorage } from 'node:async_hooks'

export interface DesktopProcessingContext {
  traceId: string
  processingId: string
}

/** Shared only by the optional typ-0 bridge and HDSI delivery code. */
export const desktopProcessingContext = new AsyncLocalStorage<DesktopProcessingContext>()

export function currentDesktopProcessingContext(): DesktopProcessingContext | undefined {
  return desktopProcessingContext.getStore()
}

export function persistedDesktopProcessingContext(value: unknown): Partial<DesktopProcessingContext> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const traceId = typeof record.traceId === 'string' && record.traceId.length > 0 && record.traceId.length <= 128
    ? record.traceId
    : undefined
  const processingId = typeof record.processingId === 'string' && record.processingId.length > 0 && record.processingId.length <= 128
    ? record.processingId
    : undefined
  return {
    ...(traceId ? { traceId } : {}),
    ...(processingId ? { processingId } : {}),
  }
}
