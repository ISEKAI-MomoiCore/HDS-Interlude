/** Streaming HTTP errors can carry a body in their internal message. Keep a
 * separate log-safe summary without altering the error used by callers. */
const publicProviderErrors = new WeakMap<Error, string>()

export function providerHttpFailure(message: string, status: number) {
  const error = new Error(message)
  publicProviderErrors.set(error, `HTTP ${status}`)
  return error
}

export function providerSafeErrorText(error: Error): string | undefined {
  if (error instanceof ProviderResponseError && error.kind === 'provider-error') return '服务商返回错误（响应详情未输出）'
  return publicProviderErrors.get(error)
}

/** Provider completion facts are separate from diagnostics and authored text. */
export type ProviderFailureKind = 'budget-truncated' | 'parse-failed' | 'empty-response' | 'stream-incomplete' | 'refused' | 'provider-error' | 'timeout'

export class ProviderResponseError extends Error {
  constructor(
    readonly kind: ProviderFailureKind,
    message: string,
    readonly finishReason?: string,
    /** Usage carried only when an adapter fails before returning its normalized response. */
    readonly usage?: unknown,
  ) {
    super(message)
    this.name = 'ProviderResponseError'
  }
}

export function assertProviderCompletion(reason: unknown) {
  if (reason === 'length' || reason === 'max_tokens' || reason === 'MAX_OUTPUT_TOKENS' || reason === 'MAX_TOKENS') {
    throw new ProviderResponseError('budget-truncated', 'Provider output budget exhausted (' + reason + ').', String(reason))
  }
  if (reason === 'content_filter' || reason === 'refusal') {
    throw new ProviderResponseError('refused', 'Provider refused the response (' + reason + ').', String(reason))
  }
}

export function isBudgetTruncation(error: unknown): error is ProviderResponseError {
  return error instanceof ProviderResponseError && error.kind === 'budget-truncated'
}

export function providerFailureLabel(error: unknown) {
  if (error instanceof ProviderResponseError) return error.kind + ' finish=' + (error.finishReason || 'unknown')
  const raw = error as { response?: { status?: unknown }, code?: unknown, name?: unknown } | null
  if (typeof raw?.response?.status === 'number') return 'http-error status=' + raw.response.status
  if (raw?.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(String(raw?.code))) return 'timeout'
  return 'transport-or-provider-error'
}
