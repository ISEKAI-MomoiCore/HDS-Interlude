import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Config } from '../src/index'
import { InterludeService } from '../src/service'
import { sendOutgoingMessages } from '../src/delivery/pipeline'
import { emptyStorySetting, emptyStoryState, type NarrativeDecision, type NarrativeIntent } from '../src/types'

/**
 * Issue #10 回归（P3.1 统一动作契约重写）：proactive-check（intent-due）相位下
 * Agency 数值裁决退役，执行许可由统一投递策略决定——
 *  A1. 无策略限制配置（agency.enabled=false → 派生全 0）→ 回复默认放行，
 *      投递照常、无撤回条目、无重查排期（appendProactiveCheck 退役）。
 *  A2. 显式 deliveryPolicy（minimumRunIntervalMinutes）+ 窗口内已占用记录 →
 *      参与者级策略拦截，撤回原因含 policy-run-interval，同轮同参与者的新
 *      意图被注入"从未发出"中和注记（summary 尾缀 + payload 标记），不再
 *      安排 agency 重查。
 *  A3. 参与者不在白名单 → persistDecision 不再提前撤回（候选合成已退役），
 *      白名单拒绝由投递边界执行：transport 层 participant-not-allowed 拦截。
 */

const now = new Date('2026-10-19T08:29:11.000Z')
const future = new Date(now.getTime() + 3 * 60 * 60 * 1000)

function proactiveCheckIntent(participantId: string, id: number): NarrativeIntent {
  return { id, storyId: 's', participantId, type: 'proactive-check', summary: 'recheck whether to reach out',
    notBefore: now, status: 'pending', payload: {}, createdAt: now, updatedAt: now } as NarrativeIntent
}

/** 投递账本里一条窗口内已结算占用的既往动作（间隔/额度评估的锚点）。 */
function occupiedLedgerEntry(participantId: string, minutesAgo: number, id: number) {
  const at = new Date(now.getTime() - minutesAgo * 60_000)
  return {
    id, storyId: 's', kind: 'script', participantId: 'p', content: 'x', occurredAt: at, createdAt: at,
    metadata: {
      commitId: `c${id}`,
      deliveryActions: [{
        commitId: `c${id}`, eventId: `e${id}`, eventKind: 'outgoing-message', participantId,
        status: 'delivered' as const, updatedAt: at.toISOString(),
        segments: [{ index: 0, kind: 'message' as const, content: 'hi', status: 'delivered' as const }],
      }],
    },
  }
}

interface PersistResult {
  messages: Array<{ participantId: string, content: string, proactiveContactRef?: string }>
  entries: any[]
  intents: any[]
  reports: string[]
  rechecks: unknown[]
  host: any
}

async function persist(decision: NarrativeDecision, options: {
  phase?: 'intent-due' | 'advance'
  participantId?: string
  deliveryPolicy?: Record<string, unknown>
  seedEntries?: any[]
} = {}): Promise<PersistResult> {
  const participantId = options.participantId ?? 'alice'
  const story: any = { id: 's', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now }
  const entries: any[] = [...(options.seedEntries ?? [])]
  const intents: any[] = []
  const reports: string[] = []
  const rechecks: unknown[] = []
  let intentSeq = 100
  const participants = [
    { id: participantId, state: {}, updatedAt: now },
    { id: 'bob', state: {}, updatedAt: now },
  ]
  const queryIntents = (query: any, opts?: any) => {
    let rows = intents.slice()
    if (query?.status) rows = rows.filter((intent: any) => intent.status === query.status)
    if (query?.participantId?.$in) rows = rows.filter((intent: any) => query.participantId.$in.includes(intent.participantId))
    if (query?.id?.$gt) rows = rows.filter((intent: any) => intent.id > query.id.$gt)
    if (opts?.sort?.id === 'desc') rows = rows.sort((left: any, right: any) => right.id - left.id)
    return rows.slice(0, opts?.limit ?? rows.length)
  }
  const host: any = Object.assign(Object.create(InterludeService.prototype), {
    queues: new Map(), serialScope: new AsyncLocalStorage<string>(), serialWatchdog: new Map(),
    config: {
      runtime: { ...Config.dict.runtime({}), allowProactiveMessages: true },
      sharedStory: { maxCrossConversationActions: 8 },
      onebot: { groupChats: [] },
      urge: { enabled: false },
      // agency.enabled=false → deliveryPolicyConfig 派生全 0（不过滤）；显式
      // deliveryPolicy 配置优先于派生（§12.2）。
      agency: { enabled: false },
      ...(options.deliveryPolicy ? { deliveryPolicy: options.deliveryPolicy } : {}),
    },
    participants: async () => participants,
    canHandleParticipant: (participant: any) => participant.id !== 'carol',
    shouldRefreshContinuity: () => false,
    activeScene: async () => null,
    pruneWorkingDetails: (value: any) => value ?? [],
    appendEntry: async (_storyId: string, draft: any) => {
      const entry = { ...draft, id: entries.length + 1, storyId: 's', createdAt: now }
      entries.push(entry)
      return entry
    },
    applyIntentUpdates: async () => 0,
    updateAlterSystem: () => undefined,
    appendMemory: async () => {},
    appendIntent: async (_id: string, draft: any) => {
      const notBefore = new Date(draft.notBefore)
      if (!notBefore || notBefore <= now) return
      intents.push({ ...draft, id: ++intentSeq, storyId: 's', status: 'pending', createdAt: now, updatedAt: now })
    },
    appendProactiveCheck: async (_story: unknown, candidate: unknown, _at: unknown, reason: unknown) => { rechecks.push({ candidate, reason }) },
    scheduleDueIntentWake: () => {},
    deferUnresolvedDueFollowUps: async () => {},
    ensureEndpointRegistry: async () => {},
    resolveMostActiveEndpointId: () => undefined,
    dbGet: async (table: string, query: any, opts?: any) => {
      if (table === 'interlude_intent') return queryIntents(query, opts)
      if (table === 'interlude_script_entry') {
        if (query?.id) return entries.filter((entry: any) => entry.id === query.id)
        return entries.filter((entry: any) => entry.kind === 'script')
      }
      return []
    },
    dbSet: async (table: string, query: any, patch: any) => {
      if (table === 'interlude_intent') Object.assign(intents.find((intent: any) => intent.id === query.id), patch)
      if (table === 'interlude_script_entry') Object.assign(entries.find((entry: any) => entry.id === query.id), patch)
    },
    reportOperation: (...args: any[]) => { reports.push(args.slice(4).map(String).join(' ')) },
    reportStandalone: () => {},
    pendingProactiveCount: 0,
    longHorizonSweep: async () => {},
    sendOutgoingMessages: () => assert.fail('Persistence must not send directly'),
  })
  const participant: any = participants.find(item => item.id === participantId)
  const phase = options.phase ?? 'intent-due'
  const contextIntents = phase === 'intent-due' ? [proactiveCheckIntent(participantId, 900)] : []
  const result = await host.persistDecision(story, participant, decision, now, now, true, phase, contextIntents)
  return { ...result, entries, intents, reports, rechecks, host } as PersistResult
}

const replyDecision = (extra: Partial<NarrativeDecision> = {}): NarrativeDecision => ({
  script: '她拿起手机，把吃饱了的消息发了出去。',
  interaction: { seen: false, reply: { mode: 'immediate', content: '吃饱了 撑得走不动路' } },
  intents: [
    { type: 'follow-up', summary: '刚发过吃饱的消息，对方尚未查看', notBefore: future.toISOString(), participantId: 'alice' } as never,
    { type: 'reminder', summary: '提醒 bob 还书', notBefore: future.toISOString(), participantId: 'bob' } as never,
  ],
  ...extra,
} as NarrativeDecision)

test('A1: proactive-check 缺 proactiveContact 但回复就绪 → 无策略限制时默认放行（无撤回、无重查）', async () => {
  const result = await persist(replyDecision())
  assert.equal(result.messages.length, 1, '已写好的可见回复必须进入投递管线')
  assert.equal(result.messages[0].content, '吃饱了 撑得走不动路')
  assert.equal(result.messages[0].participantId, 'alice')
  assert.equal(result.messages[0].proactiveContactRef, undefined, 'proactiveContactRef 不再附着')
  assert.equal(result.entries.filter((entry: any) => entry.kind === 'outgoing-delivery-failed').length, 0, '不得出现撤回账目')
  const script = result.entries.find((entry: any) => entry.kind === 'script')
  assert.ok(script.metadata.deliveryActions.every((action: any) => action.status !== 'cancelled'), '账本不得有 cancelled')
  assert.equal(result.rechecks.length, 0, 'Agency 重查排期已退役（appendProactiveCheck 不再被调用）')
  assert.equal(result.intents.filter((intent: any) => intent.summary.includes('从未发出')).length, 0)
})

test('A2: 统一策略（安全间隔）拦截 → 撤回带 policy-run-interval + 同轮意图注入中和注记（不再排重查）', async () => {
  const result = await persist(replyDecision(), {
    deliveryPolicy: { minimumRunIntervalMinutes: 30 },
    seedEntries: [occupiedLedgerEntry('alice', 10, 50)],
  })
  assert.deepEqual(result.messages, [], '策略拦截时仍不得投递')
  const failed = result.entries.filter((entry: any) => entry.kind === 'outgoing-delivery-failed')
  assert.equal(failed.length, 1, '撤回必须留痕')
  assert.equal(failed[0].metadata.reason, 'policy-run-interval', '撤回原因必须是具体统一策略而非 no-agency-candidate')
  assert.equal(result.rechecks.length, 0, 'P3.1：Agency 重查排期退役，动机链交回正常写作')
  // 同参与者的新意图被中和，其他参与者的意图不动
  const poisoned = result.intents.find((intent: any) => intent.participantId === 'alice')
  const untouched = result.intents.find((intent: any) => intent.participantId === 'bob')
  assert.match(poisoned.summary, /从未发出/, '同轮同参与者的意图必须携带未发送注记')
  assert.equal(poisoned.payload.sendWithdrawnTurn, 'policy-run-interval')
  assert.doesNotMatch(untouched.summary, /从未发出/, '无关参与者的意图不得被注记')
  assert.equal(untouched.payload.sendWithdrawnTurn, undefined)
  // 注记幂等
  await result.host.annotateWithdrawnTurnIntents({ id: 's', setting: {} }, 100, new Set(['alice']), 'policy-run-interval', now)
  assert.equal(poisoned.summary.split('从未发出').length - 1, 1, '重复调用不得叠加尾缀')
})

test('A3: 参与者不在白名单 → persistDecision 照常排队，白名单拒绝由投递边界执行（消息不投递）', async () => {
  const result = await persist(replyDecision(), { participantId: 'carol' })
  // P3.1：候选合成/agency 过滤退役后，persistDecision 不再提前撤回——
  // 白名单拒绝移到传输边界（delivery/pipeline.ts 的 canHandleParticipant 门）。
  assert.equal(result.messages.length, 1, '回复照常进入投递管线')
  assert.equal(result.messages[0].participantId, 'carol')
  assert.equal(result.entries.filter((entry: any) => entry.kind === 'outgoing-delivery-failed').length, 0)
  // 投递边界：白名单外参与者的消息被 participant-not-allowed 拦下，不触达传输。
  const failures: Array<{ participantId: string, reason: string }> = []
  const deliveryHost = {
    getParticipant: async (id: string) => (id === 'carol' ? { id: 'carol', platform: 'onebot', selfId: '100', userId: 'u1' } : undefined),
    ensureEndpointRegistry: async () => {},
    canHandleParticipant: () => false,
    recordOutgoingDeliveryFailure: async (_story: unknown, participantId: string, _message: unknown, reason: string) => { failures.push({ participantId, reason }) },
    report: () => {}, reportStandalone: () => {},
  }
  const delivered = await sendOutgoingMessages(deliveryHost as never, { id: 's' } as never, result.messages as never)
  assert.deepEqual(delivered, [], '白名单外参与者不得收到消息')
  assert.deepEqual(failures, [{ participantId: 'carol', reason: 'participant-not-allowed' }], '拦截留痕必须点名白名单原因')
})
