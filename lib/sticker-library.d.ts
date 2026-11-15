import { type Session } from 'koishi';
import type { GroupChatRule } from './service';
/** P8-S1：自 service.ts 迁入（2026-10-29），行为不变。 */
export declare const STICKER_DESCRIPTION_RETRY_COOLDOWN: number;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function tryHarvestStickers(svc: any, session: Session, chatType: 'private' | 'group', sources: string[], rule?: GroupChatRule): Promise<void>;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function harvestLibraryHashIndex(svc: any): Promise<any>;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function runStickerHarvestScan(svc: any): Promise<void>;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function noteHarvestFailure(svc: any, hash: string, detail: string): void;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function stickerHarvestStatusLines(svc: any): Promise<string[]>;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function scanStickerLibrary(svc: any): Promise<void>;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function stickerDeliveryBase(svc: any): string;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function registerStickerRoute(svc: any): void;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function refreshStickerCatalog(svc: any): Promise<void>;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function semanticStickerEmbeddingEnabled(svc: any): boolean;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function backfillStickerEmbeddings(svc: any): Promise<void>;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function stickerCatalogForSession(svc: any, session: Session | undefined, turnQueryEmbedding?: number[]): Promise<any>;
/** P8-S1 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function rankStickerAssets(svc: any, turnQueryEmbedding?: number[]): Promise<any>;
