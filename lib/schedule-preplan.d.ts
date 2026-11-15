/** P5：自 service.ts 迁入（2026-10-29），行为不变。 */
export declare const SCHEDULE_PREPLAN_RETRY_BACKOFF: number;
import { SchedulePreplanDay, SchedulePreplanException, SchedulePreplanRecord, SchedulePreplanRegime, SchedulePreplanWindow, ScriptEntry } from './types';
export interface SchedulePreplanConfig {
    enabled: boolean;
    horizonDays: number;
    reviewAfterLocalHour: number;
    anchorAutoAdvance: boolean;
    variationLevel: 'stable' | 'contextual' | 'granular';
    candidateActivationProbability: number;
    candidateRevealMinutes: number;
}
export declare const DEFAULT_SCHEDULE_PREPLAN_CONFIG: SchedulePreplanConfig;
export declare function resolveSchedulePreplanConfig(value?: Partial<SchedulePreplanConfig>): SchedulePreplanConfig;
export declare function normalizeSchedulePreplanRecord(value: unknown): SchedulePreplanRecord | undefined;
export declare function schedulePreplanReviewDue(record: SchedulePreplanRecord | undefined, now: Date, timezone: string, config: SchedulePreplanConfig): boolean;
/** 未读证据里出现改约/取消/新确认信号 → 返回命中条目 id（去重，至多 20）。
 * 输入与 schedulePreplanEvidence 同源（kind=script 的剧本条目）；世界事件/
 * 好友动态/空间条目是外部观测，不进入该管道，天然不构成她的日程改变。 */
export declare function schedulePreplanEvidenceMentionsDateChange(entries: ReadonlyArray<Pick<ScriptEntry, 'id' | 'content'>>): number[];
export declare const SCHEDULE_PREPLAN_FOLLOWUP_COOLDOWN_MS: number;
/** 当天跟进审查是否到期：日审查已完成后（reviewDue=false 的场景），
 * 未读证据出现改约信号且冷却已过 → 允许一次带外审查。此前单次改约要等
 * 到次日审查才入例外，而那个改约属于"今天"（backlog：当天例外的及时收束）。 */
export declare function schedulePreplanFollowUpDue(record: SchedulePreplanRecord | undefined, unseenEvidence: ReadonlyArray<Pick<ScriptEntry, 'id' | 'content'>>, now: Date, config: SchedulePreplanConfig): boolean;
export declare function schedulePreplanNeedsModel(record: SchedulePreplanRecord | undefined, evidence: ScriptEntry[], today: string, timezone: string, config: SchedulePreplanConfig): boolean;
export declare function refreshSchedulePreplan(record: SchedulePreplanRecord, today: string, timezone: string, config: SchedulePreplanConfig, now: Date, reason?: string): SchedulePreplanRecord;
export declare function applySchedulePreplanProposal(current: SchedulePreplanRecord | undefined, proposalValue: unknown, evidence: ScriptEntry[], today: string, timezone: string, config: SchedulePreplanConfig, now: Date, variationLevel?: SchedulePreplanConfig['variationLevel']): SchedulePreplanRecord | undefined;
export declare function materializeSchedulePreplan(regimes: SchedulePreplanRegime[], exceptions: SchedulePreplanException[], startDate: string, horizonDays: number): SchedulePreplanDay[];
/** Project only the coming twelve hours; the rest of the stored horizon never enters the main prompt. */
export declare function schedulePreplanWindow(record: SchedulePreplanRecord | undefined, now: Date, timezone: string, hours?: number, config?: Pick<SchedulePreplanConfig, 'candidateActivationProbability' | 'candidateRevealMinutes'>): SchedulePreplanWindow | null;
export declare function nextSchedulePreplanTransition(record: SchedulePreplanRecord | undefined, now: Date, timezone: string, maxHours?: number): Date;
