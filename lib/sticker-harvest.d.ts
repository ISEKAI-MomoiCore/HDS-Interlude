export interface StickerHarvestConfig {
    enabled: boolean;
    /** 私聊采集开关；群聊开关在每条群规则（groupChats[].stickerHarvest）。 */
    privateChats: boolean;
    stagingDirectory: string;
    keptSubfolder: string;
    scanIntervalMinutes: number;
    /** 判定准则提示词；留空使用内置默认。 */
    harvestPrompt: string;
    maxPerChatPerDay: number;
    maxStagingFiles: number;
    maxFileSizeMB: number;
}
export declare const DEFAULT_STICKER_HARVEST_CONFIG: StickerHarvestConfig;
export declare function resolveStickerHarvestConfig(value: unknown): StickerHarvestConfig;
/** 内置判定准则；harvestPrompt 非空时整体替换。 */
export declare const DEFAULT_HARVEST_JUDGMENT_PROMPT: string;
export interface HarvestJudgment {
    keep: boolean;
    reason: string;
    tags?: string[];
}
/** 宽容解析：提取首个 JSON 对象，keep 非布尔视为无效。 */
export declare function parseHarvestJudgment(text: string): HarvestJudgment | undefined;
export interface HarvestProvenance {
    platform: string;
    chatType: 'private' | 'group';
    /** private=对方 userId；group=groupId。 */
    chatKey: string;
    senderId: string;
    receivedAt: string;
}
export interface HarvestCounters {
    staged: number;
    kept: number;
    discarded: number;
    deduped: number;
    evicted: number;
}
export type HarvestIngestOutcome = 'stored' | 'duplicate' | 'quota' | 'skipped';
export interface StagedHarvestFile {
    hash: string;
    /** 暂存目录内的图片文件名（含扩展名）。 */
    fileName: string;
    provenance: HarvestProvenance;
}
/** 每聊天每日配额（进程内存；重载归零——采集是可丢失的旁路，不值得持久化）。 */
export declare class DailyQuotaTracker {
    private readonly counts;
    within(chatKey: string, maxPerDay: number): boolean;
}
/** 暂存存储：哈希命名 + 来源 sidecar + 丢弃记忆（防同一张被拒表情反复判定）。
 * 所有方法永不上抛——采集失败只降级为跳过。 */
export declare class StickerHarvestStore {
    private readonly directory;
    private readonly logger?;
    private readonly maxDiscardMemory;
    private readonly discardedHashes;
    private readonly discardedSet;
    readonly counters: HarvestCounters;
    constructor(directory: string, logger?: {
        debug?: (template: string, ...args: unknown[]) => void;
    }, maxDiscardMemory?: number);
    /** 测试与状态命令用：丢弃记忆规模。 */
    get discardedMemorySize(): number;
    private hashFromFileName;
    private rememberDiscarded;
    hasDiscarded(hash: string): boolean;
    listStaged(): Promise<StagedHarvestFile[]>;
    ingest(dataUri: string, provenance: HarvestProvenance, limits: {
        maxStagingFiles: number;
        maxFileSizeMB: number;
    }, libraryHasHash?: (hash: string) => boolean | Promise<boolean>): Promise<HarvestIngestOutcome>;
    /** 读取暂存图为 dataUri（判定模型的图片输入）；读取失败返回 undefined。 */
    readStagedDataUri(item: StagedHarvestFile): Promise<string | undefined>;
    /** 保留：移入表情库目标目录（含 sidecar 清理），返回目标绝对路径。 */
    markKept(hash: string, targetDirectory: string): Promise<string | undefined>;
    /** 丢弃：删除暂存文件并写入丢弃记忆，同一张图不再重复进入判定。 */
    markDiscarded(hash: string): Promise<void>;
    private removeStaged;
}
/** 采集门控：总开关 + 聊天类型开关（群聊看每群规则的 stickerHarvest）。 */
export declare function shouldHarvestSticker(config: StickerHarvestConfig, stickersEnabled: boolean, chatType: 'private' | 'group', groupRuleStickerHarvest?: boolean): boolean;
