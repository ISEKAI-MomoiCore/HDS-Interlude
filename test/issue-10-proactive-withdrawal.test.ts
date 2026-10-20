import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Config } from '../src/index'
import { InterludeService } from '../src/service'
import { emptyStorySetting, emptyStoryState, type NarrativeDecision, type NarrativeIntent } from '../src/types'

/**
 * Issue #10 回归：proactive-check（intent-due）相位下，模型已按契约把话写进
 * interaction.reply(mode=immediate) 但 proactiveContact 缺失/不规范时——
 *  A. host 合成 send-now 候选：真实风控（容量/日上限/端点）通过则放行投递，
 *     不再以 no-agency-candidate 静默撤回；意愿门对合成候选跳过。
 *  B. 真实风控拦截时照常撤回（真实原因 + 重查），且本轮新写的、指向同一参与
 *     者的模型意图被注入"从未发出"中和注记（summary 尾缀 + payload 标记）。
 */

const now = new Date('2026-10-19T08:29:11.000Z')
const future = new Date(now.getTime() + 3 * 60 * 60 * 1000)

function proactiveCheckIntent(participantId: string, id: number): NarrativeIntent {
  return { id, storyId: 's', participantId, type: 'proactive-check', summary: 'recheck whether to reach out',
    notBefore: now, status: 'pending', payload: {}, createdAt: now, updatedAt: now } as NarrativeIntent
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
  lastCharacterMessageAt?: Date
  agency?: Record<string, unknown>
} = {}): Promise<PersistResult> {
  const participantId = options.participantId ?? 'alice'
  const story: any = { id: 's', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now }
  const entries: any[] = []
  const intents: any[] = []
  const reports: string[] = []
  const rechecks: unknown[] = []
  let intentSeq = 100
  const participants = [
    { id: participantId, state: options.lastCharacterMessageAt ? { lastCharacterMessageAt: options.lastCharacterMessageAt.toISOString() } : {}, updatedAt: now },
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
      agency: { enabled: true, contactMode: 'natural', naturalWillingnessThreshold: 0.15, minimumProactiveIntervalMinutes: 30, ...options.agency },
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
      if (table === 'interlude_script_entry') return entries.filter((entry: any) => entry.id === query?.id)
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
  agencyWindow: { activityLoad: 'free', privacy: 'private', deviceAccess: 'available', validUntil: future.toISOString(), basis: '宿舍独处，手机在手上' },
  intents: [
    { type: 'follow-up', summary: '刚发过吃饱的消息，对方尚未查看', notBefore: future.toISOString(), participantId: 'alice' } as never,
    { type: 'reminder', summary: '提醒 bob 还书', notBefore: future.toISOString(), participantId: 'bob' } as never,
  ],
  ...extra,
} as NarrativeDecision)

test('A1: proactive-check 缺 proactiveContact 但回复就绪 → host 合成候选并放行（不再静默撤回）', async () => {
  const result = await persist(replyDecision())
  assert.equal(result.messages.length, 1, '已写好的可见回复必须进入投递管线')
  assert.equal(result.messages[0].content, '吃饱了 撑得走不动路')
  assert.equal(result.messages[0].participantId, 'alice')
  assert.ok(result.messages[0].proactiveContactRef, '合成放行的主动联系必须预记配额 ref')
  assert.ok(result.reports.some(line => line.includes('候选=host合成')), '审计日志必须标记合成候选')
  assert.ok(result.reports.some(line => line.includes('立即联系')), '风控全过应判定为立即联系')
  assert.equal(result.entries.filter((entry: any) => entry.kind === 'outgoing-delivery-failed').length, 0, '不得出现撤回账目')
  const script = result.entries.find((entry: any) => entry.kind === 'script')
  assert.ok(script.metadata.deliveryActions.every((action: any) => action.status !== 'cancelled'), '账本不得有 cancelled')
  // B 不触发：没有撤回就不该有中和注记
  assert.equal(result.intents.filter((intent: any) => intent.summary.includes('从未发出')).length, 0)
})

test('A2: 真实风控（安全间隔）拦截 → 撤回带真实原因 + 安排重查 + 同轮意图注入中和注记', async () => {
  const result = await persist(replyDecision(), { lastCharacterMessageAt: new Date(now.getTime() - 10 * 60 * 1000) })
  assert.deepEqual(result.messages, [], '风控拦截时仍不得投递')
  const failed = result.entries.filter((entry: any) => entry.kind === 'outgoing-delivery-failed')
  assert.equal(failed.length, 1, '撤回必须留痕')
  assert.match(failed[0].metadata.reason, /blocked-by-agency-capacity:minimum-proactive-interval/, '撤回原因必须是真实风控而非 no-agency-candidate')
  assert.ok(result.rechecks.length === 1, '容量拦截应安排重查而非让动机链静默死亡')
  // B：同参与者的新意图被中和，其他参与者的意图不动
  const poisoned = result.intents.find((intent: any) => intent.participantId === 'alice')
  const untouched = result.intents.find((intent: any) => intent.participantId === 'bob')
  assert.match(poisoned.summary, /从未发出/, '同轮同参与者的意图必须携带未发送注记')
  assert.equal(poisoned.payload.sendWithdrawnTurn, 'blocked-by-agency-capacity:minimum-proactive-interval')
  assert.doesNotMatch(untouched.summary, /从未发出/, '无关参与者的意图不得被注记')
  assert.equal(untouched.payload.sendWithdrawnTurn, undefined)
  // 注记幂等
  await result.host.annotateWithdrawnTurnIntents({ id: 's', setting: {} }, 100, new Set(['alice']), 'blocked-by-agency-capacity:minimum-proactive-interval', now)
  assert.equal(poisoned.summary.split('从未发出').length - 1, 1, '重复调用不得叠加尾缀')
})

test('A3: 参与者不在白名单 → 合成失败，回落既有 no-agency-candidate 撤回（旧行为保留）', async () => {
  const result = await persist(replyDecision(), { participantId: 'carol' })
  assert.deepEqual(result.messages, [])
  const failed = result.entries.filter((entry: any) => entry.kind === 'outgoing-delivery-failed')
  assert.equal(failed.length, 1)
  assert.equal(failed[0].metadata.reason, 'no-agency-candidate')
  assert.ok(result.reports.some(line => line.includes('候选=host合成')) === false, '白名单外不得合成')
})
