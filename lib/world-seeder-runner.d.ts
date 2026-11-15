import { type WorldSeedDomain } from './world-seeder';
import type { InterludeStory } from './types';
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function worldSeederSweep(svc: any): Promise<void>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function buildWorldSeederPayload(svc: any, story: InterludeStory, now: Date, recentSummaries: string[], domain?: WorldSeedDomain): Promise<string>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function worldSeederBlockedNames(svc: any, storyId: string): Promise<any>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function drainDueSeededEvents(svc: any, story: InterludeStory, now: Date, includeLow: boolean): Promise<void>;
