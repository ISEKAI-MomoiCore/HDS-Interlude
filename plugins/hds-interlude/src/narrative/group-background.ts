/**
 * I-6a 群消息背景通道（设计 v2.4 §2 I-6 / §5 步骤 2）：advance 相位的有界群视图。
 *
 * 职责边界（公理）：本模块只做**装配**——把已入库的群消息整理为"系统侧消息概况
 * + 最新 K 条原文"的背景材料；人物是否看见、是否在意，由剧本写出（§1.2 三层事实）。
 *
 * 覆盖语义（v2.3 双标记的最小实现）：
 * - 概况呈现 = 活动层事实（条数/时间跨度/摘录）；
 * - 原文呈现 = 内容层覆盖 → 推进该群水位（成功提交后生效）；
 * - 概况不清空全部：未获原文呈现的批次保留内容级催动资格（I-2 接入时消费）。
 *
 * 预算：每群 K（默认 8）+ 全局合计（默认 16）——多群按最新条目新近度排序分配；
 * 生活条目不参与本预算（独立选取，通道只增不改）。
 */
import type { ScriptEntry } from '../types'
import { formatStoryClock } from '../time'

export interface GroupBackgroundEntryView {
  id: number
  speaker: string
  content: string
  occurredAt: string
}

export interface GroupBackgroundSection {
  groupId: string
  label: string
  /** 系统侧消息概况——事实层；"她瞥见未读"由剧本写出。 */
  summary: string
  /** 最新 K 条原文（具体内容覆盖）。 */
  entries: GroupBackgroundEntryView[]
  /** 概况是否为截断计数（查询上限截到的诚实标注）。 */
  truncated?: boolean
}

/** 成功提交后应推进的水位（每群 = 已呈现原文的最大条目 id）。
 * F2 修正：watermark 只代表"推进位置"（旧积压按概况级过期，不重复呈现）；
 * contentComplete 才代表内容完备——该群全部未覆盖条目都获得原文呈现时为
 * true，被 K/字符预算截断为 false。显著度消费据此区分完全消费与概况 ×0.5。 */
export interface GroupBackgroundCoverage {
  watermarks: Record<string, number>
  contentComplete: Record<string, boolean>
}

export interface GroupBackgroundBudget {
  perGroupLimit: number
  globalLimit: number
  excerptCount: number
  /** F6：每条原文的字符上限（超限截断并标注）。 */
  perEntryCharacters: number
  /** F6：全部背景原文的字符合计上限。 */
  globalCharacters: number
}

export const DEFAULT_GROUP_BACKGROUND_BUDGET: GroupBackgroundBudget = {
  perGroupLimit: 8,
  globalLimit: 16,
  excerptCount: 3,
  perEntryCharacters: 200,
  globalCharacters: 4_000,
}

export interface AssembleGroupBackgroundParams {
  /** 每群：groupId / 显示标签 / 未覆盖条目（新→旧排序）。 */
  sections: Array<{ groupId: string, label: string, entries: ScriptEntry[] }>
  /** 概况是否因查询上限截断（各群独立标注）。 */
  truncatedGroups?: Set<string>
  budget?: Partial<GroupBackgroundBudget>
  /** 概况时间跨度用的故事时区（缺省回退 UTC——审计修正前的一致行为）。 */
  timezone?: string
}

function shapeEntry(entry: ScriptEntry, charLimit: number): GroupBackgroundEntryView {
  const metadata = (entry.metadata ?? {}) as Record<string, unknown>
  const speaker = String(metadata.senderName ?? '群成员')
  const text = entry.content
  return {
    id: entry.id,
    speaker,
    // F6：单条字符预算——超限截断并诚实标注（沿用仓库 [已截断] 先例）。
    content: text.length > charLimit ? `${text.slice(0, charLimit)}[已截断]` : text,
    occurredAt: entry.occurredAt.toISOString(),
  }
}

function formatLocalTime(entry: ScriptEntry, timezone?: string): string {
  // 审计修正：优先用故事本地钟——此前按 UTC 切片，东八区部署的小时差 8，
  // 会给模型喂错误的昼夜信息（这正是节奏链路想保护的东西）。
  return formatStoryClock(entry.occurredAt, timezone) || entry.occurredAt.toISOString().slice(11, 16)
}

function buildSummary(older: ScriptEntry[], newest: ScriptEntry | undefined, total: number, excerpts: number, truncated: boolean, timezone?: string): string {
  if (!total) return ''
  const spanFrom = older.length ? formatLocalTime(older[older.length - 1], timezone) : formatLocalTime(newest!, timezone)
  const spanTo = newest ? formatLocalTime(newest, timezone) : ''
  const parts = [`自上次推进以来群里多了 ${total} 条（${spanFrom}~${spanTo}）`]
  if (older.length) {
    const sampled = older.slice(-excerpts).reverse()
      .map(entry => {
        const view = shapeEntry(entry, Number.MAX_SAFE_INTEGER)
        const text = view.content.trim().slice(0, 60)
        return text ? `${view.speaker}：${text}` : `${view.speaker}：[非文本]`
      })
      .filter(Boolean)
    if (sampled.length) parts.push(`较早的有：${sampled.join('；')}`)
  }
  if (truncated) parts.push('条数仅统计最近一批')
  return parts.join('。') + '。'
}

/** 纯装配：输入按群排序好的未覆盖条目（新→旧），输出背景节与覆盖水位。 */
export function assembleGroupBackground(params: AssembleGroupBackgroundParams): { sections: GroupBackgroundSection[], coverage: GroupBackgroundCoverage } {
  const budget = { ...DEFAULT_GROUP_BACKGROUND_BUDGET, ...params.budget }
  const truncatedGroups = params.truncatedGroups ?? new Set<string>()
  const shaped = params.sections
    .filter(section => section.entries.length > 0)
    .map(section => {
      const newestFirst = [...section.entries].sort((left: any, right: any) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.id - left.id)
      const newest = newestFirst[0]
      return { groupId: section.groupId, label: section.label, newestFirst, newest }
    })
    // 多群分配：最新条目越新的群优先获得原文预算。
    .sort((left, right) => right.newest.occurredAt.getTime() - left.newest.occurredAt.getTime() || right.newest.id - left.newest.id)

  const sections: GroupBackgroundSection[] = []
  const coverage: GroupBackgroundCoverage = { watermarks: {}, contentComplete: {} }
  let globalRemaining = budget.globalLimit
  let charRemaining = budget.globalCharacters
  for (const item of shaped) {
    const take = Math.max(0, Math.min(budget.perGroupLimit, globalRemaining))
    // F6：全局字符预算内的最新条目优先呈现；预算中途耗尽时较早条目退出呈现
    //（不算 presented——水位与 contentComplete 只记实际呈现条目）。
    const presented: ScriptEntry[] = []
    for (const entry of take > 0 ? item.newestFirst.slice(0, take) : []) {
      // 审计修正：cost 计入说话人昵称长度——长昵称会让实际渲染超出全局预算。
      const cost = Math.min(budget.perEntryCharacters, entry.content.length) + 32
        + String((entry.metadata as Record<string, unknown> | undefined)?.senderName ?? '').length
      if (charRemaining < cost) break
      presented.push(entry)
      charRemaining -= cost
    }
    const older = presented.length ? item.newestFirst.slice(presented.length) : item.newestFirst
    globalRemaining -= presented.length
    if (presented.length) {
      coverage.watermarks[item.groupId] = presented[0].id
      // F2：全部未覆盖条目都获得原文呈现才算内容完备；否则消费端按概况 ×0.5。
      coverage.contentComplete[item.groupId] = older.length === 0
        && !truncatedGroups.has(item.groupId)
        && presented.every(entry => entry.content.length <= budget.perEntryCharacters)
    }
    sections.push({
      groupId: item.groupId,
      label: item.label,
      summary: buildSummary(older, item.newest, item.newestFirst.length, budget.excerptCount, truncatedGroups.has(item.groupId), params.timezone),
      entries: presented.map(entry => shapeEntry(entry, budget.perEntryCharacters)),
      ...(truncatedGroups.has(item.groupId) ? { truncated: true } : {}),
    })
  }
  return { sections, coverage }
}

/** 从故事状态读取群背景水位（ extensions.groupBackground.watermarks ）。 */
export function readGroupBackgroundWatermarks(state: { extensions?: Record<string, unknown> } | undefined): Record<string, number> {
  const raw = state?.extensions?.groupBackground as { watermarks?: unknown } | undefined
  const watermarks = raw?.watermarks
  if (!watermarks || typeof watermarks !== 'object' || Array.isArray(watermarks)) return {}
  const out: Record<string, number> = {}
  for (const [groupId, value] of Object.entries(watermarks as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[groupId] = value
  }
  return out
}

/** 合并水位（成功提交后调用；只前进不后退）。 */
export function mergeGroupBackgroundWatermarks(previous: Record<string, number>, coverage: GroupBackgroundCoverage): Record<string, number> {
  const out = { ...previous }
  for (const [groupId, id] of Object.entries(coverage.watermarks)) {
    if (!out[groupId] || id > out[groupId]) out[groupId] = id
  }
  return out
}
