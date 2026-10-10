import { AlterHistoryEntry, AlterPendingScope, AlterSystemConfig, AlterSystemState, EmotionalOffsetPrompt, NarrativePhase } from './types';
export declare const DEFAULT_ALTER_SYSTEM_CONFIG: AlterSystemConfig;
export interface AlterTurnResult {
    state: AlterSystemState;
    threshold: number;
    offsetExpired: boolean;
    thresholdReached: boolean;
    sourceParticipantId: string;
    triggerValue: number;
}
export declare function resolveAlterSystemConfig(value?: Partial<AlterSystemConfig>): AlterSystemConfig;
export declare function normalizeAlterValue(value: unknown): number | undefined;
export declare function createAlterSystemState(now?: Date): AlterSystemState;
export declare function normalizeAlterSystemState(value: unknown): AlterSystemState | undefined;
export declare function calculateAlterThreshold(history: AlterHistoryEntry[], config: AlterSystemConfig, now?: Date): number;
export declare function adjustAlterWeight(weight: number, sameDirection: boolean, magnitude: number, config: AlterSystemConfig): number;
export declare function advanceAlterSystem(current: AlterSystemState | undefined, alter: number, phase: NarrativePhase, now: Date, config: AlterSystemConfig, participantId?: string): AlterTurnResult;
export declare function completeAlterAnalysis(state: AlterSystemState, description: string, threshold: number, now: Date, config: AlterSystemConfig, participantId?: string, analyzedValue?: number): AlterSystemState;
export declare function emotionalOffsetForPrompt(state: AlterSystemState | undefined, config: AlterSystemConfig): EmotionalOffsetPrompt | null;
/** The current scope has its own retry gate, so a failed relationship-local
 * analysis does not suppress an unrelated piece of independent life. */
export declare function alterScopeCoolingDown(state: AlterSystemState, participantId?: string, now?: Date, cooldownMs?: number): boolean;
export declare function markAlterScopeAnalysisAttempt(state: AlterSystemState, participantId?: string, now?: Date): {
    pendingScopes: AlterPendingScope[];
    alterValue: number;
    alterWeight: number;
    lastTriggerDirection: -1 | 0 | 1;
    emotionalOffset: import("./types").EmotionalOffset | null;
    history: AlterHistoryEntry[];
    lastUpdatedAt: string;
    lastAnalysisAttemptAt?: string;
};
/** A stale result consumed no evidence; allow the changed scope to be reviewed again. */
export declare function clearAlterScopeAnalysisAttempt(state: AlterSystemState, participantId?: string): {
    pendingScopes: AlterPendingScope[];
    alterValue: number;
    alterWeight: number;
    lastTriggerDirection: -1 | 0 | 1;
    emotionalOffset: import("./types").EmotionalOffset | null;
    history: AlterHistoryEntry[];
    lastUpdatedAt: string;
    lastAnalysisAttemptAt?: string;
};
export declare function alterScopeValue(state: AlterSystemState, participantId?: string): number;
export declare function alterHistoryForScope(history: AlterHistoryEntry[], participantId?: string): AlterHistoryEntry[];
