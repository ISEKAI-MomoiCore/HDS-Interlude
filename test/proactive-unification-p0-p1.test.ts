import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService, normalizeDecision, type RuntimeConfig, type SharedStoryConfig } from '../src/service'
import { DEFAULT_AGENCY_CONFIG, resolveAgencyConfig } from '../src/agency'
import { aggregateDeliveryStatus, updateScriptDeliveryActions, type ScriptDeliveryAction } from '../src/script/delivery-ledger'
import { recordOutgoingDeliveryFailure } from '../src/delivery/pipeline'
import { deliveryReality } from '../src/script/delivery-reality'
import { normalizeKnowledgeEvidence } from '../src/script/knowledge-evidence'
import { adaptLegacyContactActions, contactPlanFromAction, contactPlanFromDraft, deriveSourceLabel, parseCommunicationActions } from '../src/script/contact-actions'
import type { ScriptEntry } from '../src/types'

const NOW = new Date('2026-11-14T12:00:00.000Z')
const noop = () => {}

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

// ── P0 特征基线：相位与解析层权限门（现状固定，P3 切换前不得漂移）──────────

// ── P3.1 新契约：意愿门退役（§10.1 A01），合法作者动作完整保留 ─────────────

test('P3.1 advance keeps below-threshold willingness actions with no drop record (A01)', () => {
  const decision = normalizeDecision({
    script: '她想了想，还是给 Alice 发了条消息。',
    crossConversationActions: [
      { participantId: 'alice', mode: 'immediate', content: '在吗？', willingness: 0.3 },
      { participantId: 'alice', mode: 'immediate', content: '回来啦', willingness: 0.9 },
    ],
  }, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  assert.deepEqual(decision.crossConversationActions.map(action => action.content), ['在吗？', '回来啦'], '两档意愿的行动都保留')
  assert.equal(decision.droppedProactiveActions, undefined, '意愿门退役后不再产生 dropped 留痕')
  assert.deepEqual(decision.crossConversationActions.map(action => action.willingness), [0.3, 0.9], 'willingness 仅作审计留档')
})

test('P3.1 actions survive normalization in every phase regardless of willingness or proactiveContact', () => {
  const action = { participantId: 'alice', mode: 'immediate' as const, content: '在吗？', willingness: 0.3 }
  const advance = normalizeDecision({ script: 's', crossConversationActions: [action] },
    NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  assert.equal(advance.crossConversationActions.length, 1, 'advance without proactiveContact keeps low-willingness actions')
  const withContact = normalizeDecision({ script: 's', crossConversationActions: [action], proactiveContact: { any: true } },
    NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  assert.equal(withContact.crossConversationActions.length, 1, 'proactiveContact presence changes nothing')
  const userMessage = normalizeDecision({ script: 's', crossConversationActions: [action] },
    NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'user-message')
  assert.equal(userMessage.crossConversationActions.length, 1, 'reply phase keeps actions too')
})

// ── P3.1 新格式端到端（normalizeDecision 层）：communicationActions + say 绑定 ──

test('P3.1 communicationActions timing=now merges into crossConversationActions with say-bound text', () => {
  const decision = normalizeDecision({
    script: '她打开对话框，敲下 <say id="a1">在吗？</say>，又给群里发了句 <say id="g1">今晚聚餐</say>。',
    communicationActions: [
      { id: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'now' },
      { id: 'g1', target: { kind: 'group', id: '123' }, timing: 'now' },
    ],
  } as never, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(['123']), 'advance')
  assert.equal(decision.communicationActionRejections, undefined)
  assert.deepEqual(decision.crossConversationActions, [
    { participantId: 'alice', mode: 'immediate', content: '在吗？' },
    { participantId: 'group:123', mode: 'immediate', content: '今晚聚餐' },
  ], 'timing=now 并入 crossConversationActions：群目标 participantId 为 group:ID，content 为 say 绑定原文')
})

test('P3.1 communicationActions timing=future becomes a contact-plan intent with the requested notBefore', () => {
  const dueAt = new Date(NOW.getTime() + 3 * 3_600_000).toISOString()
  const decision = normalizeDecision({
    script: '她想着晚点再问，先记下这个念头：<say id="a1">到时候问问她</say>。',
    communicationActions: [
      { id: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'future', dueAt },
    ],
  } as never, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  assert.deepEqual(decision.crossConversationActions, [], 'future 计划不并入即时动作')
  const plan = decision.intents.find(intent => intent.type === 'contact-plan')
  assert.ok(plan, 'intents 必须含 type=contact-plan')
  assert.equal(plan!.notBefore, dueAt)
  assert.equal(plan!.participantId, 'alice')
  assert.equal(plan!.payload!.plan!.target.id, 'alice')
  assert.equal(plan!.payload!.plan!.sourceQuote, '到时候问问她')
  assert.equal(plan!.payload!.plan!.originPhase, 'advance')
})

test('P5 fixed-delay communicationActions remain definite delayed deliveries', () => {
  const sendAt = new Date(NOW.getTime() + 30 * 60_000).toISOString()
  const decision = normalizeDecision({
    script: '她记下稍后要说的话：<say id="a1">晚点告诉她</say>。',
    communicationActions: [{ id: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'fixed-delay', sendAt }],
  } as never, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  assert.deepEqual(decision.crossConversationActions, [{ participantId: 'alice', mode: 'delayed', content: '晚点告诉她', sendAt }])
  assert.equal(decision.intents.some(intent => intent.type === 'contact-plan'), false)
})

test('P5 legacy proactiveContact recheck-later enters the unified contact-plan intent', () => {
  const notBefore = new Date(NOW.getTime() + 2 * 3_600_000).toISOString()
  const expiresAt = new Date(NOW.getTime() + 12 * 3_600_000).toISOString()
  const decision = normalizeDecision({
    script: '她记下这件事，打算之后再问问。',
    proactiveContact: { participantId: 'alice', origin: 'life-event', motive: '想再问问近况', disclosure: 'ordinary', outcome: 'recheck-later', notBefore, expiresAt, sourceEntryIds: [1] },
  } as never, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  const plan = decision.intents.find(intent => intent.type === 'contact-plan')
  assert.ok(plan)
  assert.equal(plan!.notBefore, notBefore)
  assert.equal(plan!.participantId, 'alice')
  assert.equal(plan!.payload!.plan!.sourceQuote, '想再问问近况')
})

test('P3.1 unbound or invalid communicationActions entries surface as id:reason rejections', () => {
  const decision = normalizeDecision({
    script: '她敲下 <say id="a1">在吗？</say>。',
    communicationActions: [
      { id: 'ghost', target: { kind: 'participant', id: 'alice' }, timing: 'now' },
      { id: 'a1', target: { kind: 'participant', id: 'mallory' }, timing: 'now' },
      { id: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'future' },
    ],
  } as never, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  assert.deepEqual(decision.communicationActionRejections, [
    'ghost:unknown-or-duplicate-say-id',
    'a1:target-not-permitted',
    'a1:missing-due-at',
  ], '绑定失败/目标越权/缺时效的条目以 id:reason 记录，不静默丢弃')
  assert.deepEqual(decision.crossConversationActions, [])
})

test('P3.1 the group-echo gate applies to the new communicationActions format as well', () => {
  const decision = normalizeDecision({
    script: '她回复了 bob，又把同一句话原样转发到群里：<say id="g1">这个周末有空吗，想约你吃饭</say>。',
    interaction: { seen: true, reply: { mode: 'immediate', content: '这个周末有空吗，想约你吃饭' } },
    communicationActions: [
      { id: 'g1', target: { kind: 'group', id: '123' }, timing: 'now' },
    ],
  } as never, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(['123']), 'user-message')
  assert.deepEqual(decision.crossConversationActions, [], '群动作逐字复述本回合私聊回复时不得投递')
  assert.deepEqual(decision.droppedProactiveActions, [
    { participantId: 'group:123', mode: 'immediate', content: '这个周末有空吗，想约你吃饭', reason: 'group-echo-of-private-reply' },
  ])
})

test('P0 message permission switches and target whitelists keep their current semantics', () => {
  const action = { participantId: 'alice', mode: 'immediate' as const, content: '在吗？', willingness: 0.9 }
  const base = [runtime(), shared(), 'bob', new Set(['alice']), new Set(['123'])] as const
  assert.equal(normalizeDecision({ script: 's', crossConversationActions: [action] }, NOW, NOW, true, ...base, 'advance').crossConversationActions.length, 1)
  assert.equal(normalizeDecision({ script: 's', crossConversationActions: [action] }, NOW, NOW, false, ...base, 'advance').crossConversationActions.length, 0, 'permitMessages=false')
  assert.equal(normalizeDecision({ script: 's', crossConversationActions: [action] }, NOW, NOW, true, runtime(), shared({ allowCrossConversationMessages: false }), 'bob', new Set(['alice']), new Set(['123']), 'advance').crossConversationActions.length, 0, 'cross-conversation switch off')
  assert.equal(normalizeDecision({ script: 's', crossConversationActions: [{ ...action, participantId: 'mallory' }] }, NOW, NOW, true, ...base, 'advance').crossConversationActions.length, 0, 'participant not whitelisted')
  assert.equal(normalizeDecision({ script: 's', crossConversationActions: [{ ...action, participantId: 'group:456' }] }, NOW, NOW, true, ...base, 'advance').crossConversationActions.length, 0, 'group not whitelisted')
  assert.equal(normalizeDecision({
    script: 's',
    crossConversationActions: [{ participantId: 'group:123', mode: 'delayed', content: '晚点见', sendAt: new Date(NOW.getTime() + 60 * 60_000).toISOString(), willingness: 0.9 }],
  }, NOW, NOW, true, ...base, 'advance').crossConversationActions.length, 0, 'group targets reject delayed mode')
})

// ── P0 兼容解码：Agency 配置与旧草稿仍可读取，执行裁决已迁移到统一策略 ─────

test('P0 agency config clamps and proactive contact normalization gates stay stable', () => {
  const config = resolveAgencyConfig({ contactMode: 'weird', naturalWillingnessThreshold: 5, proactiveDailyCap: 99, naturalMinimumIntervalMinutes: -5 } as any)
  assert.equal(config.contactMode, 'strict')
  assert.equal(config.naturalWillingnessThreshold, 1)
  assert.equal(config.proactiveDailyCap, 20)
  assert.equal(config.naturalMinimumIntervalMinutes, 0)
  const plan = contactPlanFromDraft({
    participantId: 'alice', origin: 'life-event', disclosure: 'ordinary', outcome: 'recheck-later',
    motive: '想再问问', sourceEntryIds: [1], notBefore: new Date(NOW.getTime() + 3_600_000).toISOString(),
  }, 'advance')
  assert.equal(plan?.target.id, 'alice')
  assert.equal(contactPlanFromDraft({ participantId: 'mallory', motive: 'm', outcome: 'recheck-later' } as any, 'advance')?.target.id, 'mallory', 'target whitelist is enforced by the normalizeDecision gate, not the draft parser')
  assert.equal(contactPlanFromDraft({ participantId: 'alice', motive: 'm', outcome: 'let-go' } as any, 'advance'), undefined, 'let-go creates no plan')
})

// ── P1 账本 unknown（设计 §7.2/§7.3：聚合优先级、迟到回执、恢复边界）────────

test('P1 aggregate precedence follows the declared order (delivered > unknown > partial > pending > failed > cancelled)', () => {
  const segment = (status: string) => ({ index: 0, kind: 'message' as const, content: 'x', status: status as any })
  assert.equal(aggregateDeliveryStatus([]), 'pending')
  assert.equal(aggregateDeliveryStatus([segment('delivered'), segment('delivered')]), 'delivered')
  assert.equal(aggregateDeliveryStatus([segment('delivered'), segment('unknown')]), 'unknown', 'any unknown dominates and keeps the confirmed count')
  assert.equal(aggregateDeliveryStatus([segment('unknown'), segment('pending')]), 'unknown')
  assert.equal(aggregateDeliveryStatus([segment('delivered'), segment('failed')]), 'partial')
  assert.equal(aggregateDeliveryStatus([segment('pending'), segment('failed')]), 'pending', 'scheduled or retriable work outranks failure')
  assert.equal(aggregateDeliveryStatus([segment('failed')]), 'failed')
  assert.equal(aggregateDeliveryStatus([segment('cancelled')]), 'cancelled')
})

test('P1 late receipts upgrade unknown to delivered; confirmed success survives a late failure', () => {
  const action: ScriptDeliveryAction = {
    commitId: 'c1', eventId: 'e1', eventKind: 'outgoing-message', participantId: 'p', status: 'unknown',
    updatedAt: NOW.toISOString(),
    segments: [{ index: 0, kind: 'message', content: 'hi', status: 'unknown' }],
  }
  const upgraded = updateScriptDeliveryActions([action], { commitId: 'c1', eventId: 'e1', scriptEntryId: 1, segmentIndex: 0 }, 'delivered', new Date())
  assert.equal(upgraded![0].segments[0].status, 'delivered')
  assert.equal(upgraded![0].status, 'delivered')
  const downgraded = updateScriptDeliveryActions(upgraded!, { commitId: 'c1', eventId: 'e1', scriptEntryId: 1, segmentIndex: 0 }, 'failed', new Date(), 'late-failure')
  assert.equal(downgraded, undefined, 'delivered stays delivered')
  const verified = updateScriptDeliveryActions([action], { commitId: 'c1', eventId: 'e1', scriptEntryId: 1, segmentIndex: 0 }, 'cancelled', new Date(), 'verified-not-sent')
  assert.equal(verified![0].segments[0].status, 'cancelled')
  assert.equal(verified![0].status, 'cancelled')
})

test('P1 pending recovery candidates exclude unknown segments', () => {
  const entryFor = (status: string): ScriptEntry => ({
    id: 7, kind: 'script', participantId: 'p', content: 'prose', occurredAt: NOW,
    metadata: {
      commitId: 'c1',
      scriptEvents: [{ commitId: 'c1', eventId: 'e1', kind: 'outgoing-message', actor: 'protagonist', occurredAt: NOW.toISOString(), causedByEventIds: [], participantId: 'p', content: 'hi', bubbles: ['hi'], deliveryMode: 'immediate' }],
      deliveryActions: [{ commitId: 'c1', eventId: 'e1', eventKind: 'outgoing-message', participantId: 'p', status, updatedAt: NOW.toISOString(), segments: [{ index: 0, kind: 'message', content: 'hi', status }] }],
    },
  } as unknown as ScriptEntry)
  const picker = (InterludeService.prototype as any).pendingOutgoingDeliveryCandidates
  assert.equal(picker.call(null, entryFor('unknown')).length, 0, 'unknown is never auto-resent')
  assert.equal(picker.call(null, entryFor('pending')).length, 1)
})

test('P1 transport timeouts record unknown without a failure entry or quota voiding', async () => {
  const ledger: any[] = [], entries: any[] = []
  const svc: any = {
    updateScriptDeliveryOutcome: async (_sid: string, ref: any, status: string) => { ledger.push({ ref, status }) },
    dbGet: async () => [], dbSet: async () => {},
    appendEntry: async (_sid: string, entry: any) => { entries.push(entry); return entry },
    reportOperation: noop, config: { runtime: { maxMessageCharacters: 500 } },
  }
  const story: any = { id: 's' }
  const message: any = {
    participantId: 'p', content: 'hi',
    scriptEvent: { commitId: 'c1', eventId: 'e1', scriptEntryId: 9, bubbleIndex: 0 },
  }
  await recordOutgoingDeliveryFailure(svc, story, 'p', message, 'transport timeout', 'unknown')
  assert.equal(ledger[0].status, 'unknown')
  assert.equal(entries.length, 0, 'unknown writes no fictional failure entry and keeps quota occupancy')
  await recordOutgoingDeliveryFailure(svc, story, 'p', message, 'boom', 'failed')
  assert.equal(entries.length, 1, 'determined failure still records the withdrawal entry')
})

// ── P1 送达消费者：deliveryReality 与知识证据（§6.4 触点 1/2）───────────────

test('P1 deliveryReality projects unknown as receipt-unconfirmed', () => {
  const entry = (status: string) => ({
    id: 3, kind: 'script', participantId: 'p',
    metadata: { commitId: 'c1', deliveryActions: [{ commitId: 'c1', eventId: 'e1', eventKind: 'outgoing-message', participantId: 'p', status, updatedAt: NOW.toISOString(), segments: [{ index: 0, kind: 'message', content: '你好呀', status }] }] },
  }) as any
  assert.deepEqual(deliveryReality([entry('unknown')], 'p').map(item => item.segments[0].outcome), ['receipt-unconfirmed'])
  assert.deepEqual(deliveryReality([entry('pending')], 'p').map(item => item.segments[0].outcome), ['not-confirmed'])
  assert.equal(deliveryReality([entry('delivered')], 'p').length, 0, 'fully delivered actions stay invisible')
})

test('P1 knowledge evidence observation citing an undelivered send is downgraded to interpretation', () => {
  const scriptEntry = (segmentStatus: string): ScriptEntry => ({
    id: 5, kind: 'script', participantId: 'p', content: '她给对方发了"在吗？"然后继续做事。',
    occurredAt: NOW, metadata: {
      deliveryActions: [{ commitId: 'c1', eventId: 'e1', eventKind: 'outgoing-message', participantId: 'alice', status: segmentStatus, updatedAt: NOW.toISOString(), segments: [{ index: 0, kind: 'message', content: '在吗？', status: segmentStatus }] }],
    },
  } as unknown as ScriptEntry)
  const evidence = (entry: ScriptEntry, quote: string) => normalizeKnowledgeEvidence(
    { mode: 'observed', clauses: [{ role: 'observation', sourceEntryId: 5, quote }] }, [entry], [5])
  assert.equal(evidence(scriptEntry('pending'), '她给对方发了"在吗？"').clauses[0].role, 'interpretation', 'undelivered send prose is her writing, not an observed outcome')
  assert.equal(evidence(scriptEntry('pending'), '她给对方发了"在吗？"').mode, 'belief')
  assert.equal(evidence(scriptEntry('delivered'), '她给对方发了"在吗？"').clauses[0].role, 'observation', 'confirmed delivery keeps the observation')
  assert.equal(evidence(scriptEntry('pending'), '然后继续做事').clauses[0].role, 'observation', 'non-send prose is unaffected')
})

// ── P1 统一动作适配器（§4：A02 等价、来源标签、userInitiated 不放宽）────────

const CONTEXT = { phase: 'advance' as const, permittedParticipantIds: new Set(['alice']), permittedGroupIds: new Set(['123']) }

test('P1 A02 old cross-action and new communicationActions normalize to the same unified action', () => {
  const legacy = adaptLegacyContactActions({
    ...CONTEXT,
    crossConversationActions: [{ participantId: 'alice', mode: 'immediate', content: '在吗？' }],
  })
  const modern = parseCommunicationActions(
    [{ id: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'now' }],
    '她打开对话框，敲下 <say id="a1">在吗？</say>', CONTEXT)
  assert.equal(modern.rejected.length, 0)
  assert.equal(legacy.length, 1)
  assert.equal(modern.actions.length, 1)
  for (const field of ['target', 'timing', 'textQuote', 'sourceLabel'] as const) {
    assert.deepEqual(modern.actions[0][field], legacy[0][field], field)
  }
  assert.equal(modern.actions[0].sourceLabel, 'initiation')
})

test('P1 source labels follow host-derived phase and inbound attribution', () => {
  assert.equal(deriveSourceLabel('user-message', 'alice', 'alice'), 'reply')
  assert.equal(deriveSourceLabel('user-message', 'bob', 'alice'), 'initiation', 'current inbound cannot label other targets as replies')
  assert.equal(deriveSourceLabel('conversation-follow-up', 'alice'), 'continuation')
  assert.equal(deriveSourceLabel('intent-due', 'alice'), 'continuation')
  assert.equal(deriveSourceLabel('advance', 'alice'), 'initiation')
  const reply = adaptLegacyContactActions({
    phase: 'user-message', inboundParticipantId: 'alice',
    permittedParticipantIds: new Set(['alice', 'bob']), permittedGroupIds: new Set(),
    interaction: { seen: true, reply: { mode: 'immediate', content: '收到' } } as any,
    crossConversationActions: [{ participantId: 'bob', mode: 'immediate', content: '顺便告诉 Bob' }],
  })
  assert.deepEqual(reply.map(action => [action.target.id, action.sourceLabel]), [['alice', 'reply'], ['bob', 'initiation']])
})

test('P1 model self-reported userInitiated never widens permissions or labels', () => {
  const actions = parseCommunicationActions(
    [{ id: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'now', userInitiated: true }],
    '<say id="a1">在吗？</say>', CONTEXT)
  assert.equal(actions.actions[0].sourceLabel, 'initiation', 'advance stays initiation regardless of self-report')
  assert.deepEqual(actions.actions[0].legacy, { userInitiated: true }, 'self-report is audit-only')
})

test('P1 communicationActions parsing rejects unbound, unpermitted and undated entries with reasons', () => {
  const result = parseCommunicationActions([
    { id: 'ghost', target: { kind: 'participant', id: 'alice' } },
    { id: '', target: { kind: 'participant', id: 'alice' } },
    { target: { kind: 'participant', id: 'alice' } },
    { id: 'a1', target: { kind: 'participant', id: 'mallory' } },
    { id: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'future' },
    { id: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'fixed-delay', sendAt: new Date(NOW.getTime() + 60_000).toISOString() },
  ], '<say id="a1">在吗？</say>', CONTEXT)
  assert.deepEqual(result.rejected.map(item => item.reason), [
    'unknown-or-duplicate-say-id', 'unknown-or-duplicate-say-id', 'unknown-or-duplicate-say-id',
    'target-not-permitted', 'missing-due-at',
  ])
  assert.equal(result.actions.length, 1)
  assert.equal(result.actions[0].timing, 'fixed-delay')
  assert.ok(result.actions[0].dueAt)
})

test('P1 duplicate say ids stay unreferenceable and group targets keep immediate-only semantics', () => {
  const result = parseCommunicationActions(
    [{ id: 'a1', target: { kind: 'group', id: '123' } }, { id: 'a1', target: { kind: 'group', id: '123' } }],
    '<say id="a1">大家好</say><say id="a1">大家好</say>', CONTEXT)
  assert.equal(result.actions.length, 0)
  assert.equal(result.rejected.length, 2)
})

test('P1 legacy delayed actions map to fixed-delay and proactive drafts seed contact plans', () => {
  const delayed = adaptLegacyContactActions({
    ...CONTEXT,
    crossConversationActions: [{ participantId: 'alice', mode: 'delayed', content: '晚点说', sendAt: new Date(NOW.getTime() + 3_600_000).toISOString() }],
  })
  assert.equal(delayed[0].timing, 'fixed-delay')
  assert.ok(delayed[0].dueAt)
  const recheck: ProactiveContactDraft = {
    participantId: 'alice', origin: 'life-event', motive: '想再问问', disclosure: 'ordinary',
    sourceEntryIds: [1], outcome: 'recheck-later', notBefore: new Date(NOW.getTime() + 1_800_000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 7_200_000).toISOString(),
  }
  const plan = contactPlanFromDraft(recheck, 'advance')
  assert.equal(plan?.target.id, 'alice')
  assert.equal(plan?.earliestAt, recheck.notBefore)
  assert.equal(contactPlanFromDraft({ ...recheck, outcome: 'send-now' }, 'advance'), undefined)
  assert.equal(contactPlanFromDraft({ ...recheck, outcome: 'let-go' }, 'advance'), undefined)
  const seeded = contactPlanFromAction({
    localId: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'future', textQuote: '晚点再聊',
    sourceLabel: 'initiation', originPhase: 'advance', adaptedFrom: 'communication-actions',
    dueAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
  })
  assert.equal(seeded?.sourceQuote, '晚点再聊')
})

// ── P5 补足回归：统一契约移植的旧守卫与计划兜底 ────────────────────────────

test('P5+ unified fixed-delay ports the legacy group rejection and delayed window', () => {
  const say = (id: string) => `<say id="${id}">消息</say>`
  const within = new Date(NOW.getTime() + 30 * 60_000).toISOString()
  // 群目标 + fixed-delay → 拒绝并留痕（旧行为：群从不接受 delayed）。
  const group = normalizeDecision({
    script: say('a1'),
    communicationActions: [{ id: 'a1', target: { kind: 'group', id: '123' }, timing: 'fixed-delay', dueAt: within }],
  }, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(['123']), 'advance')
  assert.equal(group.crossConversationActions.length, 0)
  assert.deepEqual(group.communicationActionRejections, ['a1:group-target-rejects-delayed'])
  // dueAt 过去/超窗 → 拒绝；窗口内 → 确定延迟。
  const past = normalizeDecision({
    script: say('a1'),
    communicationActions: [{ id: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'fixed-delay', dueAt: new Date(NOW.getTime() - 5_000).toISOString() }],
  }, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  assert.deepEqual(past.communicationActionRejections, ['a1:due-at-out-of-range'])
  assert.equal(past.crossConversationActions.length, 0)
  const ok = normalizeDecision({
    script: say('a1'),
    communicationActions: [{ id: 'a1', target: { kind: 'participant', id: 'alice' }, timing: 'fixed-delay', dueAt: within }],
  }, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  assert.equal(ok.crossConversationActions[0].mode, 'delayed')
  assert.equal(ok.crossConversationActions[0].sendAt, within)
  assert.equal(ok.communicationActionRejections, undefined)
})

test('P5+ legacy recheck-later without notBefore schedules at the old 30-minute fallback instead of being dropped', () => {
  const decision = normalizeDecision({
    script: '她想晚点再问问。',
    proactiveContact: { participantId: 'alice', origin: 'life-event', motive: '想再问问', disclosure: 'ordinary', outcome: 'recheck-later', expiresAt: new Date(NOW.getTime() + 7_200_000).toISOString() },
  }, NOW, NOW, true, runtime(), shared(), 'bob', new Set(['alice']), new Set(), 'advance')
  const plan = decision.intents.find(intent => intent.type === 'contact-plan')
  assert.ok(plan, 'plan is created without notBefore')
  assert.ok(new Date(plan.notBefore).getTime() > NOW.getTime(), 'fallback is strictly future (old chain: +30min)')
  assert.equal(Math.round((new Date(plan.notBefore).getTime() - NOW.getTime()) / 60_000), 30)
})
