/** 历史召回与向量：语义历史检索（历史条目向量补齐、余弦+词键混合召回）、
 * 历史向量缓存与失效。打分纯函数（lexicalScore/cosineSimilarity 等）在
 * narrative-normalizers。
 *
 * P8-S3 自 service.ts 迁出（2026-10-29），行为不变；函数接收宿主（service
 * 或测试假宿主）为第一参数，service 保留同名薄委托。向量缓存容器留守
 * service，经宿主引用读写。 */
import { type RecallSpan } from './script/recall-navigation';
import type { ScriptEntry } from './types';
export declare const RECALLABLE_ENTRY_KINDS: string[];
export type HistoryVectorEntry = {
    spans?: RecallSpan[];
    embeddingIdentity?: string;
    tags?: string[];
    frameId?: string;
    checkpoint?: {
        sceneId: number;
        firstEntryId: number;
        lastEntryId: number;
    };
    vector?: number[];
    content: string;
    occurredAt: string;
    participantId: string;
    kind: string;
};
/** Semantic recall is another view of raw history, so it must obey the same
 * private-branch boundary as recentScript. Group transcripts are deliberately
 * excluded from a private turn unless the owner opted into shared details. */
export declare function isHistoryEntryVisibleToParticipant(entry: Pick<ScriptEntry, 'participantId' | 'kind'>, participantId: string, shareParticipantDetails: boolean): boolean;
/** P8-S3 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function recallHistory(svc: any, storyId: string, participantId: string, query: string, turnQueryEmbedding: number[], excludeIds: Set<number>, preferredEntryIds?: Set<number>, maxResults?: number): Promise<any>;
/** P8-S3 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function ensureHistoryVectors(svc: any, storyId: string): Promise<any>;
/** P8-S3 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function invalidateHistoryVectors(svc: any, storyId?: string): void;
/** P8-S3 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function backfillHistoryEmbeddings(svc: any, storyId: string): Promise<void>;
