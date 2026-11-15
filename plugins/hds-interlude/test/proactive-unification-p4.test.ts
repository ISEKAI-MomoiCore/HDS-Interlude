import assert from 'node:assert/strict'
import test from 'node:test'
import { communicationActionDetail, communicationActionsList } from '../src/console/actions'
import { CONFIG_CENTER_MENU, isOpenConfigCenterSection } from '../src/console/contract'
import { InterludeService } from '../src/service'

const NOW = new Date('2026-11-15T12:00:00.000Z')

// ── hdsi/actions/list + get：账本与计划派生的只读投影 ──────────────────────

function host(entries: any[], intents: any[]) {
  return {
    getCanonicalStory: async () => ({ id: 's1' }),
    dbGet: async (table: string, query: any) => {
      if (table === 'interlude_script_entry') return query.kind === 'script' ? entries : []
      if (table === 'interlude_intent') {
        if (query.id !== undefined) return intents.filter(intent => intent.id === query.id)
        return intents.filter(intent => intent.status === query.status && query.type.$in.includes(intent.type))
      }
      return []
    },
  }
}

const ENTRIES = [{
  id: 7, kind: 'script', content: '她给对方发了在吗。',
  metadata: { commitId: 'c1', deliveryActions: [
    { commitId: 'c1', eventId: 'e1', eventKind: 'outgoing-message', participantId: 'p-alice', status: 'unknown', updatedAt: '2026-11-15T11:00:00.000Z',
      segments: [{ index: 0, kind: 'message', content: '在吗？', status: 'unknown' }] },
    { commitId: 'c1', eventId: 'e2', eventKind: 'group-message', participantId: 'group:100', status: 'delivered', updatedAt: '2026-11-15T10:00:00.000Z',
      segments: [{ index: 0, kind: 'message', content: '群里说一声', status: 'delivered' }, { index: 1, kind: 'message', content: '晚点交', status: 'delivered' }] },
  ] },
}]
const INTENTS = [
  { id: 21, storyId: 's1', type: 'contact-plan', status: 'pending', participantId: 'p-alice', notBefore: NOW.toISOString(),
    updatedAt: '2026-11-15T11:30:00.000Z', payload: { plan: { target: { kind: 'participant', id: 'p-alice' }, sourceQuote: '想再问问近况', originPhase: 'advance', expiresAt: '2026-11-16T00:00:00.000Z' } } },
  { id: 22, storyId: 's1', type: 'delayed-reply', status: 'pending', participantId: 'p-lin', notBefore: NOW.toISOString(),
    updatedAt: '2026-11-15T09:00:00.000Z', payload: { content: '晚点回复你' } },
]

test('P4 actions list merges ledger actions and pending plans, newest first, with cursor paging', async () => {
  const result = await communicationActionsList(host(ENTRIES, INTENTS) as any, {})
  assert.equal(result.total, 4)
  assert.deepEqual(result.rows.map(row => row.id), ['intent:21', 'c1:e1', 'c1:e2', 'intent:22'], 'sorted by updatedAt desc')
  assert.deepEqual(result.rows.map(row => row.kind), ['plan', 'action', 'action', 'fixed-delay'])
  assert.equal(result.rows[1].status, 'unknown')
  assert.equal(result.rows[1].deliveredCount, 0)
  assert.equal(result.rows[2].deliveredCount, 2)
  assert.equal(result.rows[2].channel, 'group')
  const page1 = await communicationActionsList(host(ENTRIES, INTENTS) as any, { limit: 2 })
  assert.equal(page1.rows.length, 2)
  assert.equal(page1.cursor, '2')
  const page2 = await communicationActionsList(host(ENTRIES, INTENTS) as any, { limit: 2, cursor: page1.cursor })
  assert.deepEqual(page2.rows.map(row => row.id), ['c1:e2', 'intent:22'])
  assert.equal(page2.cursor, undefined)
})

test('P4 action detail returns segments and the original prose; plan detail carries due and expiry', async () => {
  const ledger = await communicationActionDetail(host(ENTRIES, INTENTS) as any, 'c1:e1')
  assert.equal(ledger?.segments.length, 1)
  assert.equal(ledger?.segments[0].status, 'unknown')
  assert.ok(ledger?.quote.includes('在吗'))
  assert.equal(ledger?.scriptEntryId, 7)
  const plan = await communicationActionDetail(host(ENTRIES, INTENTS) as any, 'intent:21')
  assert.equal(plan?.status, 'pending-plan')
  assert.equal(plan?.dueAt, NOW.toISOString())
  assert.ok(plan?.expiresAt)
  assert.equal(await communicationActionDetail(host(ENTRIES, INTENTS) as any, 'c1:missing'), undefined)
})

test('P4 actions list survives a missing canonical story', async () => {
  const empty = { getCanonicalStory: async () => undefined, dbGet: async () => [] }
  const result = await communicationActionsList(empty as any, {})
  assert.deepEqual(result, { rows: [], total: 0 })
})

// ── 概览三行独立信息（§14.1）与配置中心开放节（§14.3）────────────────────

test('P4 overview replaces the agency mode row with policy limits and scene conditions', async () => {
  const host: any = Object.create(InterludeService.prototype)
  host.config = { runtime: { allowProactiveMessages: false }, agency: { enabled: true, contactMode: 'natural', minimumProactiveIntervalMinutes: 60, naturalMinimumIntervalMinutes: 30, proactiveDailyCap: 3 } }
  assert.equal(host.deliveryPolicyConfig.minimumRunIntervalMinutes, 30, 'derived policy feeds the overview label')
  // sceneConditionSummary 在无故事时显式表达未知，而不是伪"全可用"。
  host.getCanonicalStory = async () => undefined
  assert.equal(await host.sceneConditionSummary(), '未知（无有效条件证据）')
})

test('P4 config center opens deliveryPolicy and urge; legacy agency has migration guidance', () => {
  for (const id of ['runtime', 'research', 'deliveryPolicy', 'urge']) {
    assert.equal(isOpenConfigCenterSection(id), true, `${id} 应开放（stage 1）`)
  }
  for (const id of ['agency', 'sharedStory', 'memory']) {
    assert.equal(isOpenConfigCenterSection(id), true, `${id} 应开放`)
  }
  const agencyMeta = CONFIG_CENTER_MENU.flatMap(group => group.sections).find(section => section.id === 'agency')
  assert.match(agencyMeta?.label ?? '', /兼容期/)
  assert.match(agencyMeta?.description ?? '', /迁移/)
})

// ── P4.2：结构化日志信封、可写操作幂等、桥接能力 ──────────────────────────

import { formatLayeredLog, type CommunicationEventLog } from '../src/logging'
import { cancelCommunicationAction, verifyCommunicationAction } from '../src/console/actions'
import { DESKTOP_BRIDGE_CAPABILITIES } from '../src/desktop-bridge'

test('P4.2 structured communication log takes precedence over regex classification and renders identity fields', () => {
  const communication: CommunicationEventLog = {
    type: 'action-policy', storyId: 's1', commitId: 'c1', eventId: 'e1', targetId: 'p-alice',
    domain: 'policy', reasonCode: 'policy-run-interval', status: 'blocked', policyRevision: '0:60:0:false',
  }
  const lines = formatLayeredLog({ level: 'warn', phase: 'advance', message: '运行限制：当前消息暂未执行', communication, colors: false })
  // 显式 action（policy→warning）优先：不再依赖中文正则命中。
  assert.match(lines, /运行限制/)
  assert.match(lines, /策略版本: 0:60:0:false/)
  assert.match(lines, /委托: c1/)
  // 旧消息（无结构载荷）继续正则分类，不回归。
  assert.ok(formatLayeredLog({ level: 'info', message: '消息投递失败 参与者=x' }).length > 0)
})

let WRITE_ENTRIES = [{
  id: 9, kind: 'script', content: '她发了一条。',
  metadata: { commitId: 'c9', deliveryActions: [
    { commitId: 'c9', eventId: 'e9', eventKind: 'outgoing-message', participantId: 'p-alice', status: 'unknown', updatedAt: '2026-11-15T11:00:00.000Z',
      segments: [{ index: 0, kind: 'message', content: '第一条', status: 'unknown' }, { index: 1, kind: 'message', content: '第二条', status: 'pending' }] },
  ] },
}]

function writeHost() {
  WRITE_ENTRIES = [{
    id: 9, kind: 'script', content: '她发了一条。',
    metadata: { commitId: 'c9', deliveryActions: [
      { commitId: 'c9', eventId: 'e9', eventKind: 'outgoing-message', participantId: 'p-alice', status: 'unknown', updatedAt: '2026-11-15T11:00:00.000Z',
        segments: [{ index: 0, kind: 'message', content: '第一条', status: 'unknown' }, { index: 1, kind: 'message', content: '第二条', status: 'pending' }] },
    ] },
  }]
  const updates: any[] = []
  const intents = [{ id: 31, storyId: 's1', type: 'contact-plan', status: 'pending', participantId: 'p-alice', notBefore: NOW.toISOString(), payload: { plan: {} } }]
  return {
    updates, intents,
    host: {
      getCanonicalStory: async () => ({ id: 's1' }),
      dbGet: async (table: string, query: any) => {
        if (table === 'interlude_intent') return query.id !== undefined ? intents.filter(intent => intent.id === query.id) : []
        if (table === 'interlude_script_entry') return query.kind === 'script' ? WRITE_ENTRIES : []
        return []
      },
      dbSet: async (_table: string, query: any, patch: any) => { const intent = intents.find(item => item.id === query.id); if (intent) Object.assign(intent, patch) },
      updateScriptDeliveryOutcome: async (_storyId: string, reference: any, status: string, _at: Date, reason?: string) => {
        updates.push({ reference, status, reason })
        const action = WRITE_ENTRIES[0].metadata.deliveryActions[0]
        const segment = action.segments.find(item => item.index === reference.segmentIndex)
        if (segment) { segment.status = status; segment.reason = reason }
      },
    } as any,
  }
}

test('P4.2 cancel closes pending plans and pending/unknown segments idempotently', async () => {
  const { host, intents, updates } = writeHost()
  const plan = await cancelCommunicationAction(host, 'intent:31')
  assert.deepEqual(plan, { ok: true, changed: 1, reason: 'plan-cancelled' })
  assert.equal(intents[0].status, 'cancelled')
  const again = await cancelCommunicationAction(host, 'intent:31')
  assert.equal(again.changed, 0, 'repeat cancel is a no-op')
  const segments = await cancelCommunicationAction(host, 'c9:e9')
  assert.equal(segments.changed, 2, 'unknown + pending segments both closed')
  assert.deepEqual(updates.map(update => update.status), ['cancelled', 'cancelled'])
  assert.ok(updates.every(update => update.reason === 'console-cancel'))
  const repeat = await cancelCommunicationAction(host, 'c9:e9')
  assert.equal(repeat.changed, 0)
})

test('P4.2 verify rewrites only unknown segments with manual reasons', async () => {
  const { host, updates } = writeHost()
  const delivered = await verifyCommunicationAction(host, 'c9:e9', 'delivered')
  assert.equal(delivered.changed, 1, 'only the unknown segment, pending untouched')
  assert.equal(updates[0].reason, 'manual-verified-delivered')
  const notSent = await verifyCommunicationAction(host, 'c9:e9', 'not-sent')
  assert.equal(notSent.changed, 0, 'no unknown segments left to verify')
})

test('P4.2 desktop bridge declares communication-actions-v1', () => {
  assert.ok((DESKTOP_BRIDGE_CAPABILITIES as readonly string[]).includes('communication-actions-v1'))
})
