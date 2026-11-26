export declare function providerHttpFailure(message: string, status: number): Error;
export declare function providerSafeErrorText(error: Error): string | undefined;
/** Provider completion facts are separate from diagnostics and authored text. */
export type ProviderFailureKind = 'budget-truncated' | 'parse-failed' | 'empty-response' | 'stream-incomplete' | 'refused' | 'provider-error' | 'timeout';
export declare class ProviderResponseError extends Error {
    readonly kind: ProviderFailureKind;
    readonly finishReason?: string;
    /** Usage carried only when an adapter fails before returning its normalized response. */
    readonly usage?: unknown;
    constructor(kind: ProviderFailureKind, message: string, finishReason?: string, 
    /** Usage carried only when an adapter fails before returning its normalized response. */
    usage?: unknown);
}
export declare function assertProviderCompletion(reason: unknown): void;
export declare function isBudgetTruncation(error: unknown): error is ProviderResponseError;
export declare function providerFailureLabel(error: unknown): string;
