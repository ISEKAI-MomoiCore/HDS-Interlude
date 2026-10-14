import { Context, Schema } from 'koishi';
import { Config as InterludeConfig, InterludeService } from './service';
export { fetchShare, sanitizeSharePayload, summarizeShare, formatDiffLines, buildConfigPatch, diffSection, storyDefaultsToSettingPatch, normalizeShareCode, SHARE_SECTIONS, runAutoSync, readSyncState, writeSyncState } from './share-sync';
export type { ShareInfo, ShareSection, SectionDiff, ShareSummaryLines, SyncState, AutoUpdateResult } from './share-sync';
declare module 'koishi' {
    interface Context {
        interlude: InterludeService;
    }
}
export declare const name = "hds-interlude";
export declare const version = "1.0.1-rc52";
export declare const inject: {
    required: string[];
    optional: string[];
};
export declare const Config: Schema<InterludeConfig>;
export declare function apply(ctx: Context, config: InterludeConfig): void;
/** 空格子命令归一化:把能命中已注册命令的空格前缀重写为点分形式。
 * 背景:Koishi 解析器逐 token 贪心匹配,中间层命令(如 interlude.script)声明了
 * 参数即停止贪心——"interlude script note x" 会路由到 interlude.script(limit
 * 收到 note),与点分写法行为完全不同。返回 undefined 表示无需重写。 */
export declare function normalizeInterludeSpacing(content: string, isRegistered: (name: string) => boolean): string | undefined;
export declare function looksLikeInterludeCommand(content: string): boolean;
export * from './narrator';
export * from './service';
export * from './types';
export { decodeStoryState } from './story-state';
