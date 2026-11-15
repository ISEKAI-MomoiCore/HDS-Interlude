import { type QzoneActionCaller, type QzoneActionKind } from './qzone';
import type { InterludeStory, NarrativeIntent } from './types';
/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function qzoneCaller(svc: any, preferSelfId?: string): (action: string, params?: Record<string, unknown>) => any;
/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function qzoneExecute(svc: any, story: InterludeStory, kind: QzoneActionKind, input: {
    content?: string;
    tid?: string;
    targetUin?: string;
    ugcRight?: number;
}, preferSelfId?: string): Promise<{
    ok: boolean;
    error: string;
    tid?: undefined;
} | {
    ok: boolean;
    tid: string;
    error?: undefined;
} | {
    ok: boolean;
    error?: undefined;
    tid?: undefined;
}>;
/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function qzoneAvailable(svc: any, preferSelfId?: string): Promise<boolean>;
/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function executeQzoneIntent(svc: any, story: InterludeStory, intent: NarrativeIntent, now: Date): Promise<void>;
/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function qzoneFeedSweep(svc: any): Promise<void>;
/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function qzoneReactionSweep(svc: any, story: InterludeStory, caller: QzoneActionCaller, address: {
    platform: string;
    selfId: string;
}, now: Date): Promise<void>;
