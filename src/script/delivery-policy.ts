/** 统一投递策略（PROACTIVE_ACTION_UNIFICATION_DESIGN §6.1/§6.2/§7.4，P2）。
 * 策略只承载可选部署额度——每目标滚动 24 小时上限、最短运行间隔与延期
 * 有效期——是部署边界而非人物人格；总开关（allowProactiveMessages 等）
 * 与渠道/端点权限仍由既有配置作为前提，不在本层重复。P3 起强制执行；
 * 显式配置优先，全默认按旧 Agency 实际生效限制保守派生（A18）。 */
import type { ScriptDeliveryStatus, ScriptDeliveryAction } from './delivery-ledger'

export interface DeliveryPolicyConfig {
  /** 每目标滚动 24h 逻辑主动动作上限；0 = 无额外额度约束（默认）。 */
  proactivePerTargetDailyCap: number
  /** 逻辑主动动作最短运行间隔（分钟）；0 = 不设间隔。 */
  minimumRunIntervalMinutes: number
  /** 明确延期动作的有效期（分钟），过期未执行即终止。 */
  deferralValidityMinutes: number
}

export const DEFAULT_DELIVERY_POLICY_CONFIG: DeliveryPolicyConfig = {
  proactivePerTargetDailyCap: 0,
  minimumRunIntervalMinutes: 0,
  deferralValidityMinutes: 0,
}

export interface PolicyActionRecord {
  /** 逻辑动作身份：由脚本事件 eventId 提供。 */
  actionId: string
  participantId: string
  occurredAt: Date
  /** pending/delivered/partial/unknown 计占用；failed/cancelled 已释放。 */
  settled: boolean
}

export type DeliveryPolicyReason =
  | 'policy-off' | 'policy-available' | 'policy-run-interval'
  | 'policy-daily-cap' | 'policy-deferral-expired'

export interface DeliveryPolicyEvaluation {
  allowed: boolean
  reason: DeliveryPolicyReason
  reasonText: string
  targetId: string
  policyRevision: string
  counted: number
  nextEligibleAt?: string
}

export function resolveDeliveryPolicyConfig(value: unknown): DeliveryPolicyConfig {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<DeliveryPolicyConfig>
  const clamp = (candidate: unknown, min: number, max: number) => {
    const parsed = Number(candidate)
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : min
  }
  return {
    ...DEFAULT_DELIVERY_POLICY_CONFIG,
    proactivePerTargetDailyCap: clamp(raw.proactivePerTargetDailyCap, 0, 200),
    minimumRunIntervalMinutes: clamp(raw.minimumRunIntervalMinutes, 0, 10_080),
    deferralValidityMinutes: clamp(raw.deferralValidityMinutes, 0, 10_080),
  }
}

/** 复核与写作前快照共用同一修订标识：配置变化即失效旧判定。 */
export function deliveryPolicyRevision(config: DeliveryPolicyConfig): string {
  return [config.proactivePerTargetDailyCap, config.minimumRunIntervalMinutes,
    config.deferralValidityMinutes].join(':')
}

/** P3 数据源（本函数为强制执行前置）：从投递账本派生完整有效窗口，
 * 重启后可重建、不受 log 的 20 条诊断截断影响。 */
export function policyActionRecordsFromLedger(
  entries: ReadonlyArray<{ kind?: string, metadata?: Record<string, unknown> }>,
  now: Date,
  windowMs = 86_400_000,
): PolicyActionRecord[] {
  const records: PolicyActionRecord[] = []
  for (const entry of entries) {
    if (entry.kind !== 'script') continue
    const actions = Array.isArray(entry.metadata?.deliveryActions) ? entry.metadata.deliveryActions as ScriptDeliveryAction[] : []
    for (const action of actions) {
      if (!action?.eventId || typeof action.participantId !== 'string' || !action.participantId) continue
      const at = new Date(action.updatedAt)
      if (Number.isNaN(at.getTime()) || now.getTime() - at.getTime() >= windowMs) continue
      records.push({
        actionId: `${action.commitId}:${action.eventId}`,
        participantId: action.participantId,
        occurredAt: at,
        settled: occupiesQuota(action.status),
      })
    }
  }
  return records
}

function occupiesQuota(status: ScriptDeliveryStatus): boolean {
  // §7.4：首次尝试前持久占用；部分或全部确定送达计一次；全部确定未送达
  // 释放；任一 unknown 保留占用至核实或窗口自然结束。
  return status === 'pending' || status === 'delivered' || status === 'partial' || status === 'unknown'
}

/** 纯函数策略：每次返回明确原因、适用对象、revision 与可选下次可执行
 * 时间。行动批准与心理状态分开；P2 只 shadow，不改变任何旧链结果。 */
export function evaluateDeliveryPolicy(input: {
  config: DeliveryPolicyConfig
  targetId: string
  records: PolicyActionRecord[]
  now: Date
  /** A18 保守切换：旧链 promise/practical 联系豁免安全间隔，首期保留。 */
  intervalExempt?: boolean
  /** 延期动作的起算时刻（存在即按延期有效期校验）。 */
  deferredSince?: Date
  windowMs?: number
}): DeliveryPolicyEvaluation {
  const { config, targetId, records, now } = input
  const windowMs = input.windowMs ?? 86_400_000
  const revision = deliveryPolicyRevision(config)
  const base = { targetId, policyRevision: revision }
  if (config.proactivePerTargetDailyCap <= 0 && config.minimumRunIntervalMinutes <= 0 && config.deferralValidityMinutes <= 0) {
    return { ...base, allowed: true, reason: 'policy-off', reasonText: '未配置额外运行额度', counted: 0 }
  }
  if (input.deferredSince && config.deferralValidityMinutes > 0) {
    const deadline = input.deferredSince.getTime() + config.deferralValidityMinutes * 60_000
    if (now.getTime() > deadline) {
      return { ...base, allowed: false, reason: 'policy-deferral-expired', reasonText: '延期已过有效期', counted: 0 }
    }
  }
  const settled = records.filter(record => record.settled && record.participantId === targetId
    && now.getTime() - record.occurredAt.getTime() < windowMs)
  if (config.proactivePerTargetDailyCap > 0 && settled.length >= config.proactivePerTargetDailyCap) {
    return { ...base, allowed: false, reason: 'policy-daily-cap', reasonText: '滚动 24 小时额度已满', counted: settled.length }
  }
  if (!input.intervalExempt && config.minimumRunIntervalMinutes > 0) {
    const last = settled.reduce<Date | undefined>((latest, record) =>
      !latest || record.occurredAt > latest ? record.occurredAt : latest, undefined)
    if (last) {
      const eligibleAt = new Date(last.getTime() + config.minimumRunIntervalMinutes * 60_000)
      if (now < eligibleAt) {
        return { ...base, allowed: false, reason: 'policy-run-interval', reasonText: '命中最短运行间隔',
          counted: settled.length, nextEligibleAt: eligibleAt.toISOString() }
      }
    }
  }
  return { ...base, allowed: true, reason: 'policy-available', reasonText: '运行策略放行', counted: settled.length }
}

export interface LegacyRunLimits {
  agencyEnabled: boolean
  contactMode: 'strict' | 'natural' | 'balanced'
  minimumProactiveIntervalMinutes: number
  naturalMinimumIntervalMinutes: number
  proactiveDailyCap: number
}

export interface LegacyMigrationResult {
  config: DeliveryPolicyConfig
  notes: string[]
}

/** §12.2 旧限制迁移：以"旧链路实际生效的值"为依据，而非字段存在与否。
 * 未启用过的限制迁移为 0（新旧等效：都不约束）；承诺豁免按 A18 首期保留，
 * 语义差异（旧间隔锚定任何上次发言 / 新间隔锚定逻辑主动动作）记入 notes。 */
export function migrateLegacyRunLimits(limits: LegacyRunLimits): LegacyMigrationResult {
  const notes: string[] = []
  if (!limits.agencyEnabled) {
    notes.push('旧 Agency 未启用：意愿/容量/间隔/上限从未实际生效，迁移为无额外额度（新旧等效）')
    return { config: { ...DEFAULT_DELIVERY_POLICY_CONFIG }, notes }
  }
  const interval = limits.contactMode === 'strict'
    ? limits.minimumProactiveIntervalMinutes
    : Math.min(limits.minimumProactiveIntervalMinutes, limits.naturalMinimumIntervalMinutes)
  notes.push(`运行间隔按旧 ${limits.contactMode} 模式有效值 ${interval} 分钟迁移（旧语义锚定任何上次发言，新语义锚定逻辑主动动作）`)
  notes.push('旧链 promise/practical 联系的安全间隔豁免按 A18 首期保留（intervalExempt），待管理员明确调整后再统一语义')
  return {
    config: {
      ...DEFAULT_DELIVERY_POLICY_CONFIG,
      minimumRunIntervalMinutes: Math.max(0, Math.min(10_080, Math.floor(interval))),
      proactivePerTargetDailyCap: Math.max(0, Math.min(200, Math.floor(limits.proactiveDailyCap))),
    },
    notes,
  }
}
