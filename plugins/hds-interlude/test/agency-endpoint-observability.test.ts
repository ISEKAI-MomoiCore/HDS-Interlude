import assert from 'node:assert/strict'
import test from 'node:test'
import { Universal } from 'koishi'
import { InterludeService, droppedProactiveActionInfo, normalizeDecision, type RuntimeConfig, type SharedStoryConfig } from '../src/service'
import { normalizeProactiveContactLog } from '../src/story-state'
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

// ── 解析层丢弃留痕（幻影发送闭环；P3.1 意愿门退役后仅剩结构性原因）────────

test('droppedProactiveActionInfo only records structural drops: delayed timing out of range, never willingness', () => {
  const permitted = new Set(['alice'])
  const rt = runtime({ proactiveWillingnessThreshold: 0.65 })
  // P3.1（§10.1）：意愿门退役——immediate 行动无论 willingness 缺失/低于阈值
  // 都不再被解析层丢弃，因此也不再产生留痕。
  assert.equal(droppedProactiveActionInfo(
    { participantId: 'alice', mode: 'immediate', content: '在吗？' }, rt, permitted, 'bob',
  ), undefined, 'missing willingness no longer drops an immediate action')
  assert.equal(droppedProactiveActionInfo(
    { participantId: 'alice', mode: 'immediate', content: '在吗？', willingness: 0.4 }, rt, permitted, 'bob',
  ), undefined, 'below-threshold willingness no longer drops an immediate action')
  // 唯一残留的结构性留痕：delayed 时效越界（sendAt 缺失/过早/过晚）。
  assert.deepEqual(droppedProactiveActionInfo(
    { participantId: 'alice', mode: 'delayed', content: '晚点说', willingness: 0.9, sendAt: '1999-01-01T00:00:00.000Z' }, rt, permitted, 'bob',
  ), { participantId: 'alice', mode: 'delayed', content: '晚点说', reason: 'delayed-send-at-out-of-range' })
  assert.equal(droppedProactiveActionInfo(
    { participantId: 'alice', mode: 'delayed', content: '晚点说', sendAt: new Date(NOW.getTime() + 30 * 60_000).toISOString() }, rt, permitted, 'bob', NOW,
  ), undefined, 'delayed within the allowed window stays unlogged')
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

test('normalizeDecision keeps low-willingness advance actions; willingness survives for audit only', () => {
  const decision = normalizeDecision({
    script: '她给 Alice 发了条消息。',
    crossConversationActions: [
      { participantId: 'alice', mode: 'immediate', content: '在吗？', willingness: 0.3 },
      { participantId: 'alice', mode: 'immediate', content: '顺便问下', willingness: 0.9 },
    ],
  } as never, NOW, NOW, true, runtime({ proactiveWillingnessThreshold: 0.65 }), shared(), 'bob',
    new Set(['alice']), new Set(), 'advance')
  // P3.1：两档意愿的行动都完整保留（执行许可由宿主统一策略决定），
  // 解析层不再产生 droppedProactiveActions 留痕。
  assert.equal(decision.crossConversationActions.length, 2)
  assert.deepEqual(decision.crossConversationActions.map(action => action.content), ['在吗？', '顺便问下'])
  assert.equal(decision.droppedProactiveActions, undefined)
  // willingness 字段仍在归一化输出中，仅作审计留档。
  assert.deepEqual(decision.crossConversationActions.map(action => action.willingness), [0.3, 0.9])
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

