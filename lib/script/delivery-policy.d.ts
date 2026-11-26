export interface DeliveryPolicyConfig {
    /** 每目标滚动 24h 逻辑主动动作上限；0 = 无额外额度约束（默认）。 */
    proactivePerTargetDailyCap: number;
    /** 逻辑主动动作最短运行间隔（分钟）；0 = 不设间隔。 */
    minimumRunIntervalMinutes: number;
    /** 明确延期动作的有效期（分钟），过期未执行即终止。 */
    deferralValidityMinutes: number;
}
export declare const DEFAULT_DELIVERY_POLICY_CONFIG: DeliveryPolicyConfig;
export interface PolicyActionRecord {
    /** 逻辑动作身份：由脚本事件 eventId 提供。 */
    actionId: string;
    participantId: string;
    occurredAt: Date;
    /** pending/delivered/partial/unknown 计占用；failed/cancelled 已释放。 */
    settled: boolean;
    /** Explicit user-message replies are excluded from the daily proactive cap. */
    userInitiated?: boolean;
}
export type DeliveryPolicyReason = 'policy-off' | 'policy-available' | 'policy-run-interval' | 'policy-daily-cap' | 'policy-deferral-expired';
export interface DeliveryPolicyEvaluation {
    allowed: boolean;
    reason: DeliveryPolicyReason;
    reasonText: string;
    targetId: string;
    policyRevision: string;
    counted: number;
    nextEligibleAt?: string;
}
export declare function resolveDeliveryPolicyConfig(value: unknown): DeliveryPolicyConfig;
/** 复核与写作前快照共用同一修订标识：配置变化即失效旧判定。 */
export declare function deliveryPolicyRevision(config: DeliveryPolicyConfig): string;
/** P3 数据源（本函数为强制执行前置）：从投递账本派生完整有效窗口，
 * 重启后可重建、不受 log 的 20 条诊断截断影响。 */
export declare function policyActionRecordsFromLedger(entries: ReadonlyArray<{
    kind?: string;
    metadata?: Record<string, unknown>;
}>, now: Date, windowMs?: number): PolicyActionRecord[];
/** 纯函数策略：每次返回明确原因、适用对象、revision 与可选下次可执行
 * 时间。行动批准与心理状态分开；P2 只 shadow，不改变任何旧链结果。 */
export declare function evaluateDeliveryPolicy(input: {
    config: DeliveryPolicyConfig;
    targetId: string;
    records: PolicyActionRecord[];
    now: Date;
    /** A18 保守切换：旧链 promise/practical 联系豁免安全间隔，首期保留。 */
    intervalExempt?: boolean;
    /** 延期动作的起算时刻（存在即按延期有效期校验）。 */
    deferredSince?: Date;
    windowMs?: number;
}): DeliveryPolicyEvaluation;
export interface LegacyRunLimits {
    agencyEnabled: boolean;
    contactMode: 'strict' | 'natural' | 'balanced';
    minimumProactiveIntervalMinutes: number;
    naturalMinimumIntervalMinutes: number;
    proactiveDailyCap: number;
}
export interface LegacyMigrationResult {
    config: DeliveryPolicyConfig;
    notes: string[];
}
/** §12.2 旧限制迁移：以"旧链路实际生效的值"为依据，而非字段存在与否。
 * 未启用过的限制迁移为 0（新旧等效：都不约束）；承诺豁免按 A18 首期保留，
 * 语义差异（旧间隔锚定任何上次发言 / 新间隔锚定逻辑主动动作）记入 notes。 */
export declare function migrateLegacyRunLimits(limits: LegacyRunLimits): LegacyMigrationResult;
