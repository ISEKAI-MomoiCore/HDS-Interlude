/** P4（设计 §14.2）：通信动作只读视图的服务端投影。
 * 从投递账本（script 条目 metadata.deliveryActions）与既有意图表派生，
 * 不维护独立状态机；列表游标分页，详情按动作 ID 惰性读取。
 * 权威仍在账本与意图本身——这里只做有界投影。 */
import type { Context } from 'koishi'
import type { InterludeService } from '../service'
import type { ScriptDeliveryAction } from '../script/delivery-ledger'
import { reportContactPlanUpdate } from '../intents'

type ProjectionHost = {
  getCanonicalStory(): Promise<any>
  dbGet(table: string, query: unknown, options?: unknown): Promise<any[]>
}

const LIST_DEFAULT = 20
const LIST_MAX = 50
const ENTRY_WINDOW = 200
const PLAN_TYPES = ['contact-plan', 'delayed-reply', 'split-message', 'cross-conversation-message']
const HEAD_POINTS = 40

export interface CommunicationActionRow {
  id: string
  kind: 'action' | 'plan' | 'fixed-delay'
  target: string
  channel: 'private' | 'group'
  status: string
  reason?: string
  updatedAt: string
  scriptEntryId?: number
  head: string
  dueAt?: string
  expiresAt?: string
  segmentCount: number
  deliveredCount: number
}

export interface CommunicationActionDetail extends CommunicationActionRow {
  segments: Array<{ index: number, kind: string, status: string, head: string, reason?: string, attemptedAt?: string, completedAt?: string }>
  quote: string
}

export interface CommunicationActionsListResult {
  rows: CommunicationActionRow[]
  cursor?: string
  total: number
}

function head(text: string) {
  const points = Array.from(String(text ?? ''))
  return points.length <= HEAD_POINTS ? points.join('') : `${points.slice(0, HEAD_POINTS).join('')}…`
}

function rowFromAction(action: ScriptDeliveryAction, entryId: number): CommunicationActionRow {
  const group = action.participantId?.startsWith('group:')
  return {
    id: `${action.commitId}:${action.eventId}`,
    kind: 'action',
    target: action.participantId ?? '(无目标)',
    channel: group ? 'group' : 'private',
    status: action.status,
    updatedAt: action.updatedAt,
    scriptEntryId: entryId,
    head: head(action.segments?.[0]?.content ?? ''),
    segmentCount: action.segments?.length ?? 0,
    deliveredCount: action.segments?.filter(segment => segment.status === 'delivered').length ?? 0,
  }
}

function rowFromIntent(intent: Record<string, any>): CommunicationActionRow | undefined {
  if (!PLAN_TYPES.includes(intent.type) || intent.status === 'completed' || intent.status === 'cancelled') return undefined
  const target = String(intent.participantId ?? '')
  if (!target) return undefined
  const plan = intent.payload?.plan as { target?: { id?: string, kind?: string }, sourceQuote?: string, expiresAt?: string } | undefined
  const quote = typeof plan?.sourceQuote === 'string' ? plan.sourceQuote : String(intent.payload?.content ?? intent.summary ?? '')
  return {
    id: `intent:${intent.id}`,
    kind: intent.type === 'contact-plan' ? 'plan' : 'fixed-delay',
    target,
    channel: target.startsWith('group:') ? 'group' : 'private',
    status: intent.type === 'contact-plan' ? 'pending-plan' : intent.status,
    updatedAt: new Date(intent.updatedAt ?? intent.createdAt ?? Date.now()).toISOString(),
    head: head(quote),
    dueAt: intent.notBefore ? new Date(intent.notBefore).toISOString() : undefined,
    ...(plan?.expiresAt ? { expiresAt: new Date(plan.expiresAt).toISOString() } : {}),
    segmentCount: 0,
    deliveredCount: 0,
  }
}

export async function communicationActionsList(host: ProjectionHost, options: { cursor?: string, limit?: number } = {}): Promise<CommunicationActionsListResult> {
  const limit = Math.max(1, Math.min(LIST_MAX, Math.floor(options.limit ?? LIST_DEFAULT)))
  const offset = Math.max(0, Math.floor(Number(options.cursor) || 0))
  const story = await host.getCanonicalStory()
  if (!story) return { rows: [], total: 0 }
  const entries = await host.dbGet('interlude_script_entry', { storyId: story.id, kind: 'script' }, { sort: { id: 'desc' }, limit: ENTRY_WINDOW })
  const rows: CommunicationActionRow[] = []
  for (const entry of entries as Array<Record<string, any>>) {
    const actions = Array.isArray(entry.metadata?.deliveryActions) ? entry.metadata.deliveryActions as ScriptDeliveryAction[] : []
    for (const action of actions) {
      if (!action?.commitId || !action.eventId) continue
      rows.push(rowFromAction(action, entry.id))
    }
  }
  const intents = await host.dbGet('interlude_intent', { storyId: story.id, status: 'pending', type: { $in: PLAN_TYPES } }, { sort: { notBefore: 'asc' }, limit: 100 })
  for (const intent of intents as Array<Record<string, any>>) {
    const row = rowFromIntent(intent)
    if (row) rows.push(row)
  }
  rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const page = rows.slice(offset, offset + limit)
  return { rows: page, total: rows.length, ...(offset + page.length < rows.length ? { cursor: String(offset + page.length) } : {}) }
}

export async function communicationActionDetail(host: ProjectionHost, id: string): Promise<CommunicationActionDetail | undefined> {
  const story = await host.getCanonicalStory()
  if (!story) return undefined
  if (id.startsWith('intent:')) {
    const rows = await host.dbGet('interlude_intent', { id: Number(id.slice('intent:'.length)) })
    const intent = rows[0] as Record<string, any> | undefined
    const row = intent ? rowFromIntent(intent) : undefined
    if (!row) return undefined
    return { ...row, segments: [], quote: row.head }
  }
  const [commitId, eventId] = [id.slice(0, id.lastIndexOf(':')), id.slice(id.lastIndexOf(':') + 1)]
  const entries = await host.dbGet('interlude_script_entry', { storyId: story.id, kind: 'script' }, { sort: { id: 'desc' }, limit: ENTRY_WINDOW })
  for (const entry of entries as Array<Record<string, any>>) {
    const actions = Array.isArray(entry.metadata?.deliveryActions) ? entry.metadata.deliveryActions as ScriptDeliveryAction[] : []
    const action = actions.find(item => item?.commitId === commitId && item?.eventId === eventId)
    if (!action) continue
    const row = rowFromAction(action, entry.id)
    return {
      ...row,
      quote: String(entry.content ?? '').slice(0, 400),
      segments: (action.segments ?? []).map(segment => ({
        index: segment.index, kind: segment.kind, status: segment.status, head: head(segment.content),
        ...(segment.reason ? { reason: segment.reason } : {}),
        ...(segment.attemptedAt ? { attemptedAt: segment.attemptedAt } : {}),
        ...(segment.completedAt ? { completedAt: segment.completedAt } : {}),
      })),
    }
  }
  return undefined
}

/** RPC 安装：动作列表/详情为只读（authority=1），取消/核实为管理写操作
 * （authority=3，§14.4）。dbGet/dbSet 在服务上是私有方法——以结构化接口
 * 声明投影与写操作所需的面，安装边界单点转型。 */
export interface ActionsHost {
  getCanonicalStory(): Promise<any>
  dbGet(table: string, query: unknown, options?: unknown): Promise<any[]>
}

export interface ActionsWriteHost extends ActionsHost {
  dbSet(table: string, query: unknown, patch: unknown): Promise<unknown>
  updateScriptDeliveryOutcome(storyId: string, reference: Record<string, unknown>, status: string, at: Date, reason?: string): Promise<unknown>
}

export function installActionsRpc(ctx: Context, host: InterludeService): void {
  const actionsHost = host as unknown as ActionsHost
  const writeHost = host as unknown as ActionsWriteHost
  ctx.console.addListener('hdsi/actions/list', ({ cursor, limit }) => Promise.resolve(communicationActionsList(actionsHost, { cursor, limit })), { authority: 1 })
  ctx.console.addListener('hdsi/actions/get', ({ id }) => Promise.resolve(communicationActionDetail(actionsHost, String(id ?? ''))), { authority: 1 })
  ctx.console.addListener('hdsi/actions/cancel', ({ id }) => Promise.resolve(cancelCommunicationAction(writeHost, String(id ?? ''))), { authority: 3 })
  ctx.console.addListener('hdsi/actions/verify', ({ id, outcome }) => Promise.resolve(verifyCommunicationAction(writeHost, String(id ?? ''), outcome === 'delivered' ? 'delivered' : 'not-sent')), { authority: 3 })
}

export interface CommunicationActionResult {
  ok: boolean
  changed: number
  reason: string
}



/** P4（§14.4）：取消未来计划或未执行分段。计划/确定延迟取消意图行；
 * 账本动作取消 pending 与 unknown 分段（§7.3 unknown 的人工处置：取消后续）。
 * 幂等：重复取消返回 changed=0。 */
export async function cancelCommunicationAction(host: ActionsWriteHost, id: string, now = new Date()): Promise<CommunicationActionResult> {
  if (id.startsWith('intent:')) {
    const rows = await host.dbGet('interlude_intent', { id: Number(id.slice('intent:'.length)) })
    const intent = rows[0] as Record<string, any> | undefined
    if (!intent) return { ok: false, changed: 0, reason: 'not-found' }
    if (intent.status !== 'pending') return { ok: true, changed: 0, reason: `already-${intent.status}` }
    await host.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, {
      status: 'cancelled', payload: { ...(intent.payload ?? {}), cancelledBy: 'console', cancelledAt: now.toISOString() }, updatedAt: now,
    })
    reportContactPlanUpdate(host, intent as any, 'cancelled', 'console-cancel')
    return { ok: true, changed: 1, reason: 'plan-cancelled' }
  }
  const story = await host.getCanonicalStory()
  if (!story) return { ok: false, changed: 0, reason: 'no-story' }
  const detail = await communicationActionDetail(host, id)
  if (!detail?.scriptEntryId) return { ok: false, changed: 0, reason: 'not-found' }
  let changed = 0
  for (const segment of detail.segments) {
    if (segment.status !== 'pending' && segment.status !== 'unknown') continue
    await host.updateScriptDeliveryOutcome(story.id,
      { commitId: id.slice(0, id.lastIndexOf(':')), eventId: id.slice(id.lastIndexOf(':') + 1), scriptEntryId: detail.scriptEntryId, segmentIndex: segment.index },
      'cancelled', now, 'console-cancel')
    changed++
  }
  return { ok: true, changed, reason: changed ? 'segments-cancelled' : 'nothing-pending' }
}

/** P4（§14.4）：unknown 分段的人工核实——确认送达或确认未发送（§7.3：
 * 只有确定依据的人工操作可改写 unknown；迟到成功回执的自动优先级不变）。 */
export async function verifyCommunicationAction(host: ActionsWriteHost, id: string, outcome: 'delivered' | 'not-sent', now = new Date()): Promise<CommunicationActionResult> {
  const story = await host.getCanonicalStory()
  if (!story) return { ok: false, changed: 0, reason: 'no-story' }
  const detail = await communicationActionDetail(host, id)
  if (!detail?.scriptEntryId) return { ok: false, changed: 0, reason: 'not-found' }
  let changed = 0
  for (const segment of detail.segments) {
    if (segment.status !== 'unknown') continue
    await host.updateScriptDeliveryOutcome(story.id,
      { commitId: id.slice(0, id.lastIndexOf(':')), eventId: id.slice(id.lastIndexOf(':') + 1), scriptEntryId: detail.scriptEntryId, segmentIndex: segment.index },
      outcome === 'delivered' ? 'delivered' : 'cancelled', now,
      outcome === 'delivered' ? 'manual-verified-delivered' : 'manual-verified-not-sent')
    changed++
  }
  return { ok: true, changed, reason: changed ? `verified-${outcome}` : 'nothing-unknown' }
}
