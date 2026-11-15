import { AgencyConfig, AgencyWindowState } from './types';
export declare const DEFAULT_AGENCY_CONFIG: AgencyConfig;
export declare function resolveAgencyConfig(value?: Partial<AgencyConfig>): AgencyConfig;
export declare function normalizeAgencyWindowState(value: unknown): AgencyWindowState | undefined;
export declare function normalizeAgencyWindowDraft(value: unknown, now: Date, config: AgencyConfig, validSourceEntryIds: ReadonlySet<number>, fallbackSourceEntryId?: number): AgencyWindowState | undefined;
export declare function activeAgencyWindow(value: unknown, now?: Date): AgencyWindowState;
