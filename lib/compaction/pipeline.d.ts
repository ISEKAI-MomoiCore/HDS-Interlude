import type { ScriptEntry, InterludeStory, InterludeScene, InterludeParticipant, NarrativeFact, StatePatchDraft, CompactionDecision, CompactionRequest } from '../types';
export interface PreparedCompactionSkip {
    phase: 'skip';
    overlayCompacted: boolean;
}
export interface PreparedCompactionRun {
    phase: 'run';
    overlayCompacted: boolean;
    scene: InterludeScene;
    sceneEntries: ScriptEntry[];
    chars: number;
    sceneCompactionDue: boolean;
    current: InterludeStory;
    participants: InterludeParticipant[];
    visibleCompactionFacts: NarrativeFact[];
    compactRequest: CompactionRequest;
    fingerprint: string;
    factEmbeddings?: Map<string, number[]>;
}
export type PreparedCompaction = PreparedCompactionSkip | PreparedCompactionRun;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function compactStory(svc: any, story: InterludeStory, force?: boolean): Promise<any>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function compactOverlay(svc: any, story: InterludeStory): Promise<any>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function compactionCheckpointAdvanced(svc: any, context: PreparedCompactionRun): Promise<boolean>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function scheduleCompaction(svc: any, storyId: string): void;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function compactStories(svc: any): Promise<void>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function compactThreePhase(svc: any, storyId: string, force: boolean, generation?: string): Promise<any>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function prepareCompaction(svc: any, story: InterludeStory, now: Date, force: boolean): Promise<PreparedCompaction | undefined>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function applyCompaction(svc: any, story: InterludeStory, context: PreparedCompactionRun, decision: CompactionDecision, now: Date, startedAt: number): Promise<boolean>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function compactOverlayUnlocked(svc: any, story: InterludeStory, now: Date): Promise<boolean>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function rebuildLiveOverlayState(svc: any, story: InterludeStory, now: Date): Promise<void>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function prepareCompactionEmbeddings(svc: any, storyId: string, decision: CompactionDecision, entries: ScriptEntry[]): Promise<Map<string, number[]>>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function persistCompaction(svc: any, story: InterludeStory, scene: InterludeScene, decision: CompactionDecision, entries: ScriptEntry[], now: Date, visibleFactIds?: Set<number>, precedingEntries?: ScriptEntry[], factEmbeddings?: Map<string, number[]>): Promise<void>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function persistCompactionOutputs(svc: any, story: InterludeStory, scene: InterludeScene, decision: CompactionDecision, entries: ScriptEntry[], now: Date, visibleFactIds?: Set<number>, precedingEntries?: ScriptEntry[], factEmbeddings?: Map<string, number[]>): Promise<void>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
/** Issue #21（方向 c）：从来源条目 kind 推导事实的通道域。群消息（含她在群
 * 里的发言）= group、私聊往返 = private、两者都有 = mixed；生活/剧本条目不
 * 计入（返回 undefined = 她自己的经历，不携带通道）。事实保持全局——这层
 * 只让提示词能区分"听说"与"亲历"，不做可见性过滤。 */
export declare function factSourceChannel(entries: ScriptEntry[], sourceEntryIds: number[]): 'group' | 'private' | 'mixed' | undefined;
/** 更新路径的通道合并：旧值不可回溯（旧来源条目不在本批 entries 内），按
 * "出现过两种不同通道即 mixed"合并；任一侧缺省则取另一侧。 */
export declare function mergeFactSourceChannel(existing: 'group' | 'private' | 'mixed' | undefined, next: 'group' | 'private' | 'mixed' | undefined): 'group' | 'private' | 'mixed' | undefined;
export declare function persistFact(svc: any, storyId: string, draft: import('../types').FactDraft, entries: ScriptEntry[], now: Date, preparedEmbedding?: number[]): Promise<boolean>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function scheduleFactEmbeddingBackfill(svc: any, storyId: string): void;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function backfillFactEmbeddings(svc: any, storyId: string, batchSize: number): Promise<void>;
/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function persistStatePatch(svc: any, story: InterludeStory, draft: StatePatchDraft, entries: ScriptEntry[], now: Date): Promise<void>;
/** I-7 观察性产出：推进生活关注词滞回状态机（压缩评估成功后调用）。
 * 状态存 story.state.extensions.attention；批次标识用当前场景 id + 最新
 * 条目 id（同场景重试视为同一次评估）。观察阶段不接门控。 */
export declare function advanceStoryAttentionWords(svc: any, storyId: string, decision: any, entries: any[], now: Date): Promise<void>;
