import type { ScriptCommitDraft, ScriptEventDraft } from './contract';
export type ScriptDeliveryStatus = 'pending' | 'delivered' | 'partial' | 'failed' | 'cancelled' | 'unknown';
export type ScriptDeliverySegmentStatus = 'pending' | 'delivered' | 'failed' | 'cancelled' | 'unknown';
export type ScriptDeliverySegmentKind = 'message' | 'local-media' | 'native-face' | 'message-reaction';
export interface ScriptDeliverySegment {
    index: number;
    kind: ScriptDeliverySegmentKind;
    content: string;
    status: ScriptDeliverySegmentStatus;
    attemptedAt?: string;
    completedAt?: string;
    reason?: string;
}
export interface ScriptDeliveryAction {
    commitId: string;
    eventId: string;
    eventKind: ScriptEventDraft['kind'];
    participantId?: string;
    /** User-message replies share the delivery ledger but do not consume proactive quota. */
    userInitiated?: boolean;
    /** Authored route, retained so a restart can retry the same endpoint. */
    endpointId?: string;
    status: ScriptDeliveryStatus;
    segments: ScriptDeliverySegment[];
    updatedAt: string;
}
export interface ScriptDeliveryReference {
    commitId: string;
    eventId: string;
    scriptEntryId: number;
    segmentIndex: number;
}
/** Materialize an outbox-shaped ledger inside the authoritative script row.
 * The ledger itself is metadata-only: it creates no sender or schema
 * migration. Pending compensation reuses the existing transport, and durable
 * split intents retain ownership of their typing schedule. */
export declare function createScriptDeliveryActions(commit: ScriptCommitDraft): ScriptDeliveryAction[];
export declare function updateScriptDeliveryActions(current: unknown, reference: ScriptDeliveryReference, status: ScriptDeliverySegmentStatus, at: Date, reason?: string): ScriptDeliveryAction[] | undefined;
export declare function deliveryReference(event: ScriptEventDraft | undefined, scriptEntryId: number | undefined, segmentIndex?: number): ScriptDeliveryReference | undefined;
export declare function platformActionReference(commit: ScriptCommitDraft | undefined, scriptEntryId: number | undefined, kind: Exclude<ScriptDeliverySegmentKind, 'message'>, content?: string): ScriptDeliveryReference;
/** 聚合优先级（设计 §7.2，按序求值取第一条匹配）：全部送达 > 任一 unknown >
 * 有确定送达（partial）> 已排期或可重试（pending）> 确定失败 > 取消。
 * unknown 是"调用可能已到达平台"的待核实态，高于未完成而低于确定送达。 */
export declare function aggregateDeliveryStatus(segments: ScriptDeliverySegment[]): ScriptDeliveryStatus;
