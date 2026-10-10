import { Context } from 'koishi';
import { InterludeService } from './service';
import { StorySetting } from './types';
export declare const SHARE_SECTIONS: readonly ["storyDefaults", "runtime", "urge", "schedulePreplan", "timelineDirector", "agency", "chatActions", "stickers", "sharedStory", "memory", "alterSystem", "browser", "worldSeeder", "longHorizon", "qzone", "blindMode", "logging"];
export type ShareSection = typeof SHARE_SECTIONS[number];
/** 插件侧二次清洗:只保留白名单分区,深度剔除连接类字段。 */
export declare function sanitizeSharePayload(raw: unknown): {
    preset: Record<string, unknown>;
    removed: string[];
};
export interface ShareInfo {
    code: string;
    slug: string;
    title: string;
    type: string;
    nsfw: boolean;
    author: {
        id: number;
        name: string;
    };
    hdsi_version: string;
    revision: number;
    sections: string[];
    payload: Record<string, unknown>;
}
/** 规范化分享码:大写、去连字符与空白;非法返回 null。 */
export declare function normalizeShareCode(input: string): string | null;
/** 快照必须深拷贝:存活引用会在 scope.update/updateSetting 原地改动后变成"应用后"的值,回滚失效。 */
export declare function snapshotDeepCopy<T>(value: T): T;
/** 从分享站拉取预设并做插件侧清洗。失败时抛出带用户可读信息的 Error。 */
export declare function fetchShare(ctx: Context, baseUrl: string, rawCode: string): Promise<{
    info: ShareInfo;
    removed: string[];
}>;
export interface SectionDiff {
    section: string;
    changed: string[];
    added: string[];
    removedKeys: string[];
}
/** 计算某分区 远端 vs 本地 的键级差异。 */
export declare function diffSection(local: unknown, remote: unknown): SectionDiff;
/** storyDefaults(预设侧) → StorySetting patch(插件侧)的字段映射。
 *  与 service.initialStorySetting() 同源;只放入远程实际存在且非空的字段,
 *  空字段跳过——避免部分覆盖时清空当前故事的已有设定。 */
export declare function storyDefaultsToSettingPatch(defaults: unknown): Partial<StorySetting>;
/** 应用配置分区:整段替换进当前 config 的副本,白名单分区以外一概不碰。
 * includeStoryDefaults 时 storyDefaults(故事档案模板)一并写入配置——模板是
 * 新故事的孵化来源,database clear 后重建即取自这里;不写模板的同步成果
 * 活不过一次清库(rc48 修复)。 */
export declare function buildConfigPatch(config: Record<string, unknown>, preset: Record<string, unknown>, sections: string[], opts?: {
    includeStoryDefaults?: boolean;
}): Record<string, unknown>;
export interface ShareSummaryLines {
    header: string[];
    diffs: SectionDiff[];
    configSections: string[];
    storyPatch: Partial<StorySetting>;
}
/** 组装 check 输出:标题/作者/版本/分区 + 每分区键级 diff 摘要。 */
export declare function summarizeShare(service: InterludeService, info: ShareInfo, sections: string[]): ShareSummaryLines;
export declare function formatDiffLines(summary: ShareSummaryLines): string[];
export interface SyncState {
    code: string;
    revision: number;
    title: string;
    appliedAt: string;
    lastError?: string;
    configSections?: Record<string, unknown>;
    storySetting?: unknown;
    storyId?: string | null;
}
export declare function readSyncState(baseDir: string): Promise<SyncState | null>;
export declare function writeSyncState(baseDir: string, state: SyncState): Promise<void>;
export interface AutoUpdateResult {
    applied: boolean;
    reason: string;
    revision?: number;
    title?: string;
}
/**
 * 自动/手动同步入口。自动路径(enabled && autoUpdate && shareCode)在重载时执行;
 * 手动路径由 interlude.preset.sync 以 force 调用。
 * - 自动:远端 revision == lastRevision → 跳过(幂等)
 * - 手动(force):revision 未变也强制重新应用
 * - storyDefaults(若选中):同时写入配置模板(Console 可见、清库重建与新故事
 *   的孵化来源)并按 applyToCurrentStory 打到当前故事
 * - 网络失败 → 静默保留本地配置,记录 lastError,不影响启动
 */
export declare function runAutoSync(ctx: Context, service: InterludeService, opts?: {
    force?: boolean;
}): Promise<AutoUpdateResult | null>;
