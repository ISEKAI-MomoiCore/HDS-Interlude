import assert from 'node:assert/strict'
import test from 'node:test'
import { Universal } from 'koishi'
import { InterludeService, droppedProactiveActionInfo, normalizeDecision, type RuntimeConfig, type SharedStoryConfig } from '../src/service'
import { appendProactiveContact, countProactiveContactsInWindow, normalizeProactiveContactLog } from '../src/story-state'
import { decodeStoryState, encodeStoryState } from '../src/story-state'
import type { OutgoingMessageDraft } from '../src/types'

const NOW = new Date('2026-10-12T12:00:00.000Z')

function runtime(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    captureDirectMessages: true, autoCreate: true, ignoreCommandMessages: true, allowProactiveMessages: true,
    proactiveWillingnessThreshold: 0.65,
    sweepIntervalMinutes: 3, minimumAdvanceMinutes: 40, maxStoriesPerSweep: 25, contextEntryLimit: 40,
    memoryLimit: 30, maxScriptCharacters: 1400, maxMessageCharacters: 1200,
    minimumDelayedReplySeconds: 3, maximumDelayedReplyMinutes: 240, cancelDelayedRepliesOnUserMessage: true,
    ...overrides,
  } as RuntimeConfig
}

function shared(overrides: Partial<SharedStoryConfig> = {}): SharedStoryConfig {
  return {
    autoEnrollParticipants: true, allowCrossConversationMessages: true, shareParticipantDetails: true,
    maxCrossConversationActions: 3, participantContextLimit: 6, managerAccounts: [],
    ...overrides,
  } as SharedStoryConfig
}

// ── 解析层丢弃留痕（幻影发送闭环）──────────────────────────────────────────

test('proactive actions dropped by the parse-level willingness gate are captured with reasons', () => {
  const permitted = new Set(['alice'])
  const rt = runtime({ proactiveWillingnessThreshold: 0.65 })
  assert.deepEqual(droppedProactiveActionInfo(
    { participantId: 'alice', mode: 'immediate', content: '在吗？' }, rt, permitted, 'bob',
  ), { participantId: 'alice', mode: 'immediate', content: '在吗？', reason: 'proactive-willingness-missing' })
  assert.deepEqual(droppedProactiveActionInfo(
    { participantId: 'alice', mode: 'immediate', content: '在吗？', willingness: 0.4 }, rt, permitted, 'bob',
  ), { participantId: 'alice', mode: 'immediate', content: '在吗？', reason: 'proactive-willingness-below-threshold' })
  assert.deepEqual(droppedProactiveActionInfo(
    { participantId: 'alice', mode: 'delayed', content: '晚点说', willingness: 0.9, sendAt: '1999-01-01T00:00:00.000Z' }, rt, permitted, 'bob',
  ), { participantId: 'alice', mode: 'delayed', content: '晚点说', reason: 'delayed-send-at-out-of-range' })
  // 不该留痕的丢弃保持静默：非白名单目标 / 群目标 / 空内容 / 自身。
  assert.equal(droppedProactiveActionInfo(
    { participantId: 'mallory', mode: 'immediate', content: 'hi', willingness: 0.9 }, rt, permitted, 'bob',
  ), undefined)
  assert.equal(droppedProactiveActionInfo(
    { participantId: 'group:123', mode: 'immediate', content: 'hi', willingness: 0.1 }, rt, permitted, 'bob',
  ), undefined)
  assert.equal(droppedProactiveActionInfo(
    { participantId: 'alice', mode: 'immediate', content: '  ', willingness: 0.9 }, rt, permitted, 'bob',
  ), undefined)
})

test('normalizeDecision surfaces dropped proactive actions on advance turns without proactiveContact', () => {
  const decision = normalizeDecision({
    script: '她给 Alice 发了条消息。',
    crossConversationActions: [
      { participantId: 'alice', mode: 'immediate', content: '在吗？', willingness: 0.3 },
      { participantId: 'alice', mode: 'immediate', content: '顺便问下', willingness: 0.9 },
    ],
  } as never, NOW, NOW, true, runtime({ proactiveWillingnessThreshold: 0.65 }), shared(), 'bob',
    new Set(['alice']), new Set(), 'advance')
  // 低意愿行动被丢弃但留痕；高意愿行动正常保留。
  assert.equal(decision.crossConversationActions.length, 1)
  assert.equal(decision.crossConversationActions[0].content, '顺便问下')
  assert.deepEqual(decision.droppedProactiveActions, [
    { participantId: 'alice', mode: 'immediate', content: '在吗？', reason: 'proactive-willingness-below-threshold' },
  ])
})

test('normalizeDecision keeps legacy silence when proactiveContact is present (agency boundary owns judgment)', () => {
  const decision = normalizeDecision({
    script: '她想联系 Alice。',
    proactiveContact: { participantId: 'alice' },
    crossConversationActions: [
      { participantId: 'alice', mode: 'immediate', content: '在吗？' },
    ],
  } as never, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  // agencyGatedProactive=false：解析层不做意愿过滤，由 Agency 决策边界全权判断。
  assert.equal(decision.crossConversationActions.length, 1)
  assert.equal(decision.droppedProactiveActions, undefined)
})

// ── 端点门控：ctx.bots 实况回查 + 冷却豁免 ─────────────────────────────────

function gateHost(overrides: Record<string, unknown> = {}) {
  const states = new Map()
  const host: any = Object.create(InterludeService.prototype)
  Object.assign(host, {
    endpointRegistryReady: true,
    endpointRows: [{
      id: 'ep-1', ownerKind: 'participant-user', ownerId: 'p1', channelKind: 'qq',
      platform: 'onebot', accountKey: 'onebot:100', selfId: '100', userId: 'u1',
      enabled: true, createdAt: NOW, updatedAt: NOW,
    }],
    endpointStates: states,
    ctx: { bots: [] as Array<{ platform: string, selfId: string, status: unknown }> },
  }, overrides)
  return { host, states }
}

test('endpoint gate recovers a stale offline state when ctx.bots has a live matching bot', () => {
  const { host, states } = gateHost()
  states.set('ep-1', {
    endpointId: 'ep-1',
    connection: { online: false, observedAt: NOW.getTime() },
    deliverable: { allowed: true, checkedAt: Date.now(), note: 'restart-awaiting-connection' },
  })
  host.ctx.bots = [{ platform: 'onebot', selfId: '100', status: Universal.Status.ONLINE }]
  assert.equal(host.endpointGateReason('ep-1'), undefined)
  assert.equal(states.get('ep-1').connection.online, true)
})

test('endpoint gate still reports offline when no live bot matches the account key', () => {
  const { host, states } = gateHost()
  states.set('ep-1', {
    endpointId: 'ep-1',
    connection: { online: false, observedAt: NOW.getTime() },
    deliverable: { allowed: true, checkedAt: Date.now() },
  })
  // 平台不匹配 / 状态离线：都算无实况。
  host.ctx.bots = [
    { platform: 'onebot', selfId: '999', status: Universal.Status.ONLINE },
    { platform: 'onebot', selfId: '100', status: Universal.Status.OFFLINE },
  ]
  assert.equal(host.endpointGateReason('ep-1'), 'endpoint-offline')
  assert.equal(states.get('ep-1').connection.online, false)
})

test('endpoint cooldown still blocks background sends but not user-initiated replies', () => {
  const { host, states } = gateHost()
  states.set('ep-1', {
    endpointId: 'ep-1',
    connection: { online: true, observedAt: Date.now() },
    deliverable: { allowed: true, checkedAt: Date.now(), cooldownUntil: Date.now() + 60_000 },
  })
  assert.equal(host.endpointGateReason('ep-1'), 'endpoint-cooldown')
  assert.equal(host.endpointGateReason('ep-1', Date.now(), {}), 'endpoint-cooldown')
  assert.equal(host.endpointGateReason('ep-1', Date.now(), { ignoreCooldown: true }), undefined)
  // 显式失败（allowed=false + 冷却）同样只拦后台，不拦用户回复。
  states.set('ep-1', {
    endpointId: 'ep-1',
    connection: { online: true, observedAt: Date.now() },
    deliverable: { allowed: false, checkedAt: Date.now(), cooldownUntil: Date.now() + 60_000, note: 'send-failed' },
  })
  assert.equal(host.endpointGateReason('ep-1'), 'endpoint-cooldown')
  assert.equal(host.endpointGateReason('ep-1', Date.now(), { ignoreCooldown: true }), undefined)
})

// ── 主动联系配额：ref 预记 + 终态失败作废 ──────────────────────────────────

test('voided contact log entries do not consume the daily cap', () => {
  const now = new Date('2026-10-12T20:00:00.000Z')
  let log = appendProactiveContact(undefined, 'alice', now, undefined, 'ref-1')
  log = appendProactiveContact(log, 'alice', now, undefined, 'ref-2')
  assert.equal(countProactiveContactsInWindow(log, 'alice', now), 2)
  const voided = log.map(entry => entry.ref === 'ref-1' ? { ...entry, voided: true } : entry)
  assert.equal(countProactiveContactsInWindow(voided, 'alice', now), 1)
  // 归一化保留 ref/voided（重启后不丢）。
  const restored = normalizeProactiveContactLog(voided)
  assert.deepEqual(restored.filter(entry => entry.voided).map(entry => entry.ref), ['ref-1'])
  assert.equal(countProactiveContactsInWindow(restored, 'alice', now), 1)
})

test('recordOutgoingDeliveryFailure voids the pre-recorded contact budget entry', async () => {
  const now = new Date()
  const storyRow = { id: 's1', state: encodeStoryState({ proactiveContactLog: [
    { participantId: 'alice', at: now.toISOString(), ref: 'ref-1' },
  ] }) }
  const writes: Array<Record<string, unknown>> = []
  const entries: Array<{ kind: string, metadata: Record<string, unknown> }> = []
  const host = {
    config: { runtime: { maxMessageCharacters: 1200 } },
    dbGet: async (table: string) => table === 'interlude_story' ? [storyRow] : [],
    dbSet: async (_table: string, query: Record<string, unknown>, patch: Record<string, unknown>) => {
      writes.push({ query, patch })
    },
    appendEntry: async (_storyId: string, draft: { kind: string, metadata: Record<string, unknown> }) => {
      entries.push(draft)
      return draft as never
    },
    reportOperation: () => {},
  }
  const message: OutgoingMessageDraft = { participantId: 'alice', content: '在吗？', proactiveContactRef: 'ref-1' }
  await (InterludeService.prototype as any).recordOutgoingDeliveryFailure.call(host,
    { id: 's1' } as never, 'alice', message, 'bot-not-found', 'failed')
  const stateWrite = writes.find(write => !!write.patch.state)
  assert.ok(stateWrite, 'story state must be rewritten')
  const log = decodeStoryState(stateWrite.patch.state as never).proactiveContactLog ?? []
  assert.equal(log[0].voided, true)
  assert.equal(entries[0].kind, 'outgoing-delivery-failed')
  // pending（可恢复）失败不作废——消息之后仍可能送达。
  writes.length = 0
  await (InterludeService.prototype as any).recordOutgoingDeliveryFailure.call(host,
    { id: 's1' } as never, 'alice', message, 'endpoint-offline', 'pending')
  assert.equal(writes.length, 0)
})
