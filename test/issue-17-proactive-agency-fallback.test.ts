import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { Config } from '../src/index'
import { InterludeService } from '../src/service'
import { emptyStorySetting, emptyStoryState, type NarrativeDecision } from '../src/types'

/**
 * Issue #17 后继回归（P3.1 统一动作契约重写）：advance 相位下，模型已写出
 * 即时 crossConversationAction 且通过正文绑定——Agency 候选合成/数值裁决退役，
 * 绑定行动直接进入统一投递策略：
 *  - A1. 缺 proactiveContact 不再需要 host 合成候选：行动即"现在发"的声明，
 *    无策略限制时照常投递；
 *  - A2. 显式 deliveryPolicy（minimumRunIntervalMinutes）+ 窗口内已占用记录 →
 *    逐目标策略拦截，撤回原因含 policy-run-interval；
 *  - A3. 多目标不再有单候选过滤：每个动作独立评估、独立投递；
 *  - 正文绑定失败的诊断明细带参与者与分段文本摘要（截断）（A4 源码钉）。
 */

const now = new Date('2026-11-11T12:00:00.000Z')
const future = new Date(now.getTime() + 3 * 60 * 60 * 1000)

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

async function persistAdvance(decision: NarrativeDecision, options: { deliveryPolicy?: Record<string, unknown>, seedEntries?: any[] } = {}) {
  const story: any = { id: 's', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now }
  const entries: any[] = [...(options.seedEntries ?? [])]
  const intents: any[] = []
  const reports: string[] = []
  const rechecks: unknown[] = []
  let intentSeq = 100
  const participants = [
    { id: 'alice', state: {}, updatedAt: now },
    { id: 'bob', state: {}, updatedAt: now },
  ]
  const host: any = Object.assign(Object.create(InterludeService.prototype), {
    queues: new Map(), serialScope: new AsyncLocalStorage<string>(), serialWatchdog: new Map(),
    config: {
      runtime: { ...Config.dict.runtime({}), allowProactiveMessages: true },
      sharedStory: { maxCrossConversationActions: 8 },
      onebot: { groupChats: [] },
      urge: { enabled: false },
      agency: { enabled: true, contactMode: 'natural', naturalWillingnessThreshold: 0.15, minimumProactiveIntervalMinutes: 30 },
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
      if (table === 'interlude_intent') {
        let rows = intents.slice()
        if (query?.status) rows = rows.filter((intent: any) => intent.status === query.status)
        if (opts?.sort?.id === 'desc') rows = rows.sort((left: any, right: any) => right.id - left.id)
        return rows
      }
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
    reportCommunicationEvent: (...args: any[]) => { reports.push(args.slice(4).map(String).join(' ')) },
    reportStandalone: () => {},
    pendingProactiveCount: 0,
    longHorizonSweep: async () => {},
    sendOutgoingMessages: () => assert.fail('Persistence must not send directly'),
  })
  const result = await host.persistDecision(story, null, decision, now, now, true, 'advance', [])
  return { ...result, entries, intents, reports, rechecks, host } as any
}

const advanceDecision = (extra: Partial<NarrativeDecision> = {}): NarrativeDecision => ({
  // 正文以引号逐字写出将发内容 → 正文绑定 bound。P3.1 意愿门退役：行动字段
  // 无需 willingness 也能存活（#17 的真实场景是行动齐全、唯独 proactiveContact
  // 缺失——现在这不再需要 host 合成候选）。
  script: '晚饭后她想起 alice 独自在家，拿起手机发去一句“到家了记得说一声”，然后把手机放回口袋继续收拾桌面。',
  crossConversationActions: [{ participantId: 'alice', mode: 'immediate', content: '到家了记得说一声' }],
  agencyWindow: { activityLoad: 'free', privacy: 'private', deviceAccess: 'available', validUntil: future.toISOString(), basis: '宿舍独处，手机在手上' },
  intents: [],
  // 注意：刻意不提供 proactiveContact——绑定行动本身就是"现在发"的声明。
  ...extra,
} as NarrativeDecision)

test('#17 A1: advance 缺 proactiveContact 但即时行动已绑定 → 统一动作直接投递（无需候选合成）', async () => {
  const result = await persistAdvance(advanceDecision())
  assert.ok(result.messages.some((message: any) => message.participantId === 'alice' && message.content === '到家了记得说一声'),
    '已绑定的即时主动行动必须进入投递管线')
  assert.equal(result.messages[0].proactiveContactRef, undefined, 'proactiveContactRef 不再附着')
  assert.equal(result.entries.filter((entry: any) => entry.kind === 'outgoing-delivery-failed').length, 0, '不得出现撤回账目')
  const script = result.entries.find((entry: any) => entry.kind === 'script')
  assert.ok(script.metadata.deliveryActions.every((action: any) => action.status !== 'cancelled'), '账本不得有 cancelled')
})

test('#17 A2: 统一策略（安全间隔）拦截 → 逐目标撤回带 policy-run-interval', async () => {
  const result = await persistAdvance(advanceDecision(), {
    deliveryPolicy: { minimumRunIntervalMinutes: 30 },
    seedEntries: [occupiedLedgerEntry('alice', 10, 50)],
  })
  assert.equal(result.messages.filter((message: any) => message.participantId === 'alice').length, 0, '策略拦截时不得投递')
  const failed = result.entries.filter((entry: any) => entry.kind === 'outgoing-delivery-failed')
  assert.equal(failed.length, 1, '撤回必须留痕')
  assert.equal(failed[0].metadata.reason, 'policy-run-interval', '撤回原因是具体统一策略而非 no-agency-candidate')
  const script = result.entries.find((entry: any) => entry.kind === 'script' && entry.metadata.commitId === result.commit.commitId)
  assert.ok(script, '当前回合的剧本条目必须在账本中')
  assert.ok(script.metadata.deliveryActions.every((action: any) => action.status === 'cancelled'), '被拦动作的账本条目闭环为 cancelled')
})

test('#17 A3: 即时行动指向多个参与者 → 每个动作独立评估，全部照常投递（歧义不再拦截）', async () => {
  const result = await persistAdvance(advanceDecision({
    script: '她想起 alice 和 bob，分别发去一句“到家了记得说一声”“明天见”，然后继续收拾桌面。',
    crossConversationActions: [
      { participantId: 'alice', mode: 'immediate', content: '到家了记得说一声' },
      { participantId: 'bob', mode: 'immediate', content: '明天见' },
    ],
  }))
  assert.deepEqual(result.messages.map((message: any) => [message.participantId, message.content]).sort(),
    [['alice', '到家了记得说一声'], ['bob', '明天见']], '两个目标的绑定动作都必须独立投递')
  assert.equal(result.entries.filter((entry: any) => entry.kind === 'outgoing-delivery-failed').length, 0, '多目标不再触发撤回')
})

test('#17 A4: 正文绑定失败诊断带参与者与分段文本摘要（截断，源码钉）', () => {
  const source = readFileSync('src/service.ts', 'utf8')
  assert.ok(source.includes('clip(failed.bubble, 60)'), '分段文本按 60 字截断')
  assert.ok(source.includes('无对应消息事件「${clip(action.content, 60)}」'), '无事件分支带内容摘要')
})

// ── Issue #19 后继：agencyWindow 缺失不再影响执行（P3.1 后窗口仅为场景证据）──

const noWindowDecision = (extra: Partial<NarrativeDecision> = {}): NarrativeDecision => ({
  script: '晚饭后她想起 alice 独自在家，拿起手机发去一句“到家了记得说一声”，然后把手机放回口袋继续收拾桌面。',
  crossConversationActions: [{ participantId: 'alice', mode: 'immediate', content: '到家了记得说一声', willingness: 0.9 }],
  proactiveContact: {
    participantId: 'alice', origin: 'life-event', motive: '她独自在家，想到该叮嘱一句',
    disclosure: 'ordinary', willingness: 0.9, outcome: 'send-now',
  },
  // 注意：刻意不提供 agencyWindow，且故事状态为空（无持久化窗口）。
  intents: [],
  ...extra,
} as NarrativeDecision)

test('#19 A5: 行动合法但 agencyWindow 与持久化窗口都缺失 → 照常放行（窗口退役出执行链）', async () => {
  const result = await persistAdvance(noWindowDecision())
  assert.ok(result.messages.some((message: any) => message.participantId === 'alice' && message.content === '到家了记得说一声'),
    '合法绑定行动不得因窗口缺失被作废（此前死于 not-selected-by-agency）')
  assert.equal(result.entries.filter((entry: any) => entry.kind === 'outgoing-delivery-failed').length, 0, '不得出现撤回账目')
  const script = result.entries.find((entry: any) => entry.kind === 'script')
  assert.ok(script.metadata.deliveryActions.every((action: any) => action.status !== 'cancelled'), '账本不得有 cancelled')
})

test('#19 A6: 兜底窗口不落库（nextState 只写持久化窗口，源码钉）；有窗口时不兜底', async () => {
  const source = readFileSync('src/service.ts', 'utf8')
  assert.ok(source.includes('nextState.agencyWindow = persistedAgencyWindow'), '兜底窗口不得写入故事状态')
  // 模型给出 agencyWindow 时走正常路径，无兜底日志。
  const result = await persistAdvance(advanceDecision())
  assert.ok(!result.reports.some(line => line.includes('中性兜底窗口')), '有窗口时不得兜底')
  assert.ok(result.messages.some((message: any) => message.participantId === 'alice'), '正常窗口路径照常放行')
})
