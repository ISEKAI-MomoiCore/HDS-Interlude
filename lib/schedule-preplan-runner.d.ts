import type { SchedulePreplanReviewRequest, SchedulePreplanRecord, InterludeStory, ScriptEntry } from './types';
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function currentSchedulePreplanWindow(svc: any, story: InterludeStory, at: Date): Promise<import("./types").SchedulePreplanWindow>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function getSchedulePreplan(svc: any, storyId: string): Promise<SchedulePreplanRecord>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function schedulePreplanEvidence(svc: any, storyId: string, afterEntryId: number): Promise<{
    entries: ScriptEntry[];
    filteredThroughEntryId: number;
    scanComplete: boolean;
}>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function saveSchedulePreplan(svc: any, record: SchedulePreplanRecord): Promise<void>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function prepareSchedulePreplanReview(svc: any, story: InterludeStory, now: Date): Promise<{
    current: any;
    evidenceEntries: any;
    localDate: string;
    needsModel: boolean;
    request: SchedulePreplanReviewRequest;
}>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function requestSchedulePreplan(svc: any, story: InterludeStory, request: SchedulePreplanReviewRequest): Promise<any>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function persistSchedulePreplanReview(svc: any, story: InterludeStory, review: {
    current?: SchedulePreplanRecord;
    evidenceEntries: ScriptEntry[];
    localDate: string;
}, proposal: unknown, now: Date): Promise<boolean>;
