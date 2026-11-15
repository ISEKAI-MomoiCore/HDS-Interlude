/** 旧 proactive-check 任务迁移执行器（设计 §8.2/§12.3，P2 构建件）。
 * 分页扫描、按 §8.2 表处置、幂等（转换后行不再命中扫描条件）。本执行器
 * 只构建不接线：contact-plan 的运行时消费随 P3 切换提供，切换前执行会把
 * 到期计划暴露给现行 intent-due 唤醒——因此由切换步骤在建立快照后显式
 * 调用，不在启动或命令中自动运行。
 * 活跃额度无需数据迁移：新额度窗口在强制执行时由投递账本派生重建（§7.1）。 */
import type { ContactPlanSeed } from './contact-actions';
export interface ProactiveCheckIntentRow {
    id: number;
    storyId: string;
    participantId: string;
    status: string;
    notBefore: string;
    summary: string;
    payload?: {
        origin?: string;
        motive?: string;
        disclosure?: string;
        sourceEntryIds?: number[];
        willingness?: number;
        expiresAt?: string;
        fingerprint?: string;
        agencyReason?: string;
        [key: string]: unknown;
    };
}
export interface MigrationDb {
    getPendingProactiveChecks(storyId: string, afterId: number, limit: number): Promise<ProactiveCheckIntentRow[]>;
    writeConverted(row: ProactiveCheckIntentRow, plan: ContactPlanSeed, legacy: Record<string, unknown>, now: Date): Promise<void>;
    retire(row: ProactiveCheckIntentRow, reason: string, now: Date): Promise<void>;
}
export interface MigrationSummary {
    scanned: number;
    converted: number;
    retiredPolicyRecheck: number;
    retiredExpired: number;
    retiredSuperseded: number;
    pausedUnidentifiable: number;
    notes: string[];
}
/** §8.2 处置表：
 * ①模型要求的稍后再处理（agencyReason=model-requested-recheck）且未过期、
 *   有原文支持 → 转 contact-plan（保留旧 ID 映射与来源）；
 * ②仅因意愿阈值/安全间隔/容量 fallback 产生的重查 → 终结
 *   legacy-policy-recheck-retired，未尽事项经原文继续可见；
 * ③已过期 → 终结并记录依据；
 * ④已被后续动作替代（调用方提供 deliveredToSince）→ 终结并记录依据；
 * ⑤来源无法可靠识别（缺候选载荷）→ 终结为只读审计，暂停旧重查自动执行；
 * ⑥处于技术恢复中的实际动作不在本扫描范围（账本恢复独立处理）。 */
export declare function migrateProactiveCheckIntents(db: MigrationDb, storyId: string, now: Date, options?: {
    /** 此集合内参与者自重查排定后已有确认送达的主动联系（由调用方按账本核算）。 */
    supersededParticipantIds?: ReadonlySet<string>;
    dryRun?: boolean;
}): Promise<MigrationSummary>;
