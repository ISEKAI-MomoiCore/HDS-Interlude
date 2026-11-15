import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { createTurnEngine } from '../src/turn-engine'
import { OneBotAdapter } from '../src/platform/onebot-adapter'
import { runResearchTask, ResearchModelCaller, ResearchHttpClientLike } from '../src/research/runner'
import { ResearchToolRegistry } from '../src/research/tools'
import { ResearchDesk, resolveResearchConfig } from '../src/research/desk'
import type { ProviderConfig } from '../src/narrator'

/** 复审 2026-10-30（REAUDIT_REPORT R1–R5）回归钉。 */

// ── R1：历史图片经端口，句柄不再直传宿主（宿主第四参是 Session）──────

function groupExecutorHost() {
  const service: any = Object.create(InterludeService.prototype)
  const sessionA = { platform: 'onebot', channelId: 'group:100', selfId: 'bot-a', bot: { getImage: async () => ({}) } } as any
  const sessionB = { platform: 'onebot', channelId: 'group:100', selfId: 'bot-b', bot: { getImage: async () => ({}) } } as any
  const rule = { groupId: '100', contextLimit: 20 } as any
  const turn = {
    storyId: 's', groupId: '100', rule, channelId: 'group:100',
    latestHandle: { platform: 'onebot', channelId: 'group:100', selfId: 'bot-a' },
    messages: [{ speaker: '成员', content: '看这张老图' }], revision: 1, mentionedBot: false,
  } as any
  const hostCalls: Array<{ table?: string, session?: unknown, method: string }> = []
  Object.assign(service, {
    bufferedGroupTurns: new Map([['s:100', turn]]),
    turnEngine: { turns: new Map(), narrating: new Set() },
    groupWillingness: new Map(),
    databaseResetting: false, desktopRuntimePhase: 'running', disposed: false,
    config: { runtime: { maxMessageCharacters: 500, messageSeparator: '<sep/>', splitReplyMessages: true }, model: { vision: { enabled: true, mode: 'native' } } },
    serial: async (_: unknown, fn: () => unknown) => fn(),
    getStory: async () => ({ id: 's', status: 'active', setting: { timezone: 'Asia/Shanghai', character: { name: 'X' } }, state: {}, cursorAt: new Date() }),
    groupMessages: async () => ({ messages: [], imageRefs: [{ source: 'onebot-file:abc', sourceEntryId: 1, occurredAt: new Date(), senderId: 'u1' }] }),
    groupCooldownActive: async () => false,
    pauseAutomaticAdvanceAfterUserMessage: async () => {},
    groupChatCapabilities: (session: unknown) => { hostCalls.push({ method: 'groupCapabilities', session }); return undefined },
    resolveNativeFace: (decision: any) => decision?.nativeFace,
    semanticTurnEmbeddingEnabled: () => false,
    stickerCatalogForSession: async () => [],
    loadNativeImages: async () => [],
    loadHistoricalGroupImages: async (_s: unknown, _refs: unknown, _limit: unknown, session: unknown) => {
      hostCalls.push({ method: 'historicalImages', session })
      // 宿主按 Session 读取 .bot——句柄没有 .bot，必须返回 0 张（复现断言面）
      return (session as any)?.bot ? [{ source: 'onebot-file:abc', dataUrl: 'data:image/png;base64,x' }] : []
    },
    loadNativeAudio: async () => [],
    jevGatePassiveResearch: async () => {},
    tryDecide: async (...args: any[]) => {
      hostCalls.push({ method: 'decide', session: undefined, table: `images=${args[9]?.length ?? 0},hist=${args[17]?.length ?? 0}` })
      return { decision: {}, succeeded: false }
    },
    persistDecision: async () => ({ messages: [], commit: undefined, scriptEntry: undefined }),
    dbSet: async () => {},
    scheduleConversationFollowUpsAfterTurn: async () => {},
    executeGroupReactions: async () => 0,
    sendGroupMessage: async () => ({ deliveredSegments: [], complete: false, segmentOutcomes: [] }),
    sendSticker: async () => false,
    resolveSticker: () => undefined,
    sendNativeFace: async (_s: unknown, session: unknown) => { hostCalls.push({ method: 'nativeFace', session }); return true },
    deliverOutgoingMessages: async () => [],
    scheduleCompaction: () => {},
    report: () => {}, reportOperation: () => {}, reportStandalone: () => {},
  })
  Object.defineProperty(service, 'platformPort', { value: new OneBotAdapter(service), configurable: true })
  return { service, turn, sessionA, sessionB, hostCalls }
}

test('R1 历史图片经端口：宿主收到 Session 身份，模型拿到 1 张历史图片', async () => {
  const { service, sessionA, hostCalls } = groupExecutorHost()
  // 群回合开始前登记 A 会话（模拟 bufferGroupMessage 的 adoptSession 路径）
  service.platformPort.rememberSession({ platform: 'onebot', channelId: 'group:100', selfId: 'bot-a' }, sessionA)
  await service.flushGroupTurn('s:100', 1)
  const histCall = hostCalls.find(call => call.method === 'historicalImages')
  assert.ok(histCall, '历史图片必须经宿主调用')
  assert.equal(histCall!.session, sessionA, '宿主第四参必须是 Session 实例（非句柄）')
  const decide = hostCalls.find(call => call.method === 'decide')!
  assert.match(decide.table as string, /hist=1/, '经端口回源后模型收到 1 张历史图片')
})

// ── R4：批次句柄快照——模型在途期间新批次更新 latestHandle 不改当前账号 ──

test('R4 activeHandle 快照：A 启动回合、B 在模型期间入站，行动仍用 A 会话', async () => {
  const { service, turn, sessionA, sessionB, hostCalls } = groupExecutorHost()
  service.platformPort.rememberSession({ platform: 'onebot', channelId: 'group:100', selfId: 'bot-a' }, sessionA)
  const originalTryDecide = service.tryDecide
  service.tryDecide = async (...args: any[]) => {
    // 模拟模型在途：B 的新消息更新了 turn.latestHandle（为下一批服务）
    turn.latestHandle = { platform: 'onebot', channelId: 'group:100', selfId: 'bot-b' }
    service.platformPort.rememberSession(turn.latestHandle, sessionB)
    return originalTryDecide(...args)
  }
  // 让决策产生原生表情，走 sendNativeFace 路径验证账号
  service.tryDecide = async () => {
    turn.latestHandle = { platform: 'onebot', channelId: 'group:100', selfId: 'bot-b' }
    service.platformPort.rememberSession(turn.latestHandle, sessionB)
    return {
      decision: { nativeFace: { semantic: 'smile' }, groupReply: { mode: 'immediate', content: '好' } },
      succeeded: true,
    }
  }
  await service.flushGroupTurn('s:100', 1)
  const faceCall = hostCalls.find(call => call.method === 'nativeFace')
  assert.ok(faceCall, '原生表情路径已执行')
  assert.equal(faceCall!.session, sessionA, '当前批次的行动必须用批次开始时的 A 会话，不得漂移到 B')
})

// ── R2：pruneSessions 保护排队中的群回合会话 ──────────────────────────

test('R2 群回合引用受保护：待处理群批次不会被 pruneSessions(32) 回收', () => {
  const service: any = Object.create(InterludeService.prototype)
  service.turnEngine = { turns: new Map(), narrating: new Set() }
  const groupSession = { platform: 'onebot', channelId: 'group:100', selfId: '1' } as any
  const groupHandle = { platform: 'onebot', channelId: 'group:100', selfId: '1' }
  service.bufferedGroupTurns = new Map([['s:100', { storyId: 's', groupId: '100', latestHandle: groupHandle, messages: [{}], rule: {} }]])
  Object.defineProperty(service, 'platformPort', { value: new OneBotAdapter(service), configurable: true })
  service.platformPort.rememberSession(groupHandle, groupSession)
  for (let index = 0; index < 40; index++) {
    service.platformPort.rememberSession(
      { platform: 'onebot', channelId: `private:other-${index}`, selfId: '1' },
      { platform: 'onebot', channelId: `private:other-${index}`, selfId: '1' } as any)
  }
  service.platformPort.pruneSessions(32)
  assert.equal(service.platformPort.resolveSession(groupHandle), groupSession, '排队中的群回合会话不得被回收')
})

// ── R3：新登记会话在回合引用建立前不被自己清掉 ────────────────────────

test('R3 129 个并发待处理回合：第 129 个回合的会话从建立起可解析', () => {
  const service: any = Object.create(InterludeService.prototype)
  service.turnEngine = createTurnEngine({
    setTimeout: (fn: () => void) => () => { void fn },
    userMessageDebounceSeconds: 2,
    scheduleTurnFlush: () => {},
    reportOperation: () => {},
  })
  const story = { id: 's', status: 'active', setting: { timezone: 'Asia/Shanghai', character: { name: 'X' } }, state: {}, cursorAt: new Date() } as any
  let lastSession: any
  let lastHandle: any
  for (let index = 0; index < 129; index++) {
    const session = { platform: 'onebot', channelId: `private:u${index}`, selfId: '1', content: 'hi' } as any
    const participant = { id: `p${index}`, status: 'active', channelId: `private:u${index}` } as any
    service.bufferUserNarrative(story, participant, session, new Date(), [], 'hi')
    lastSession = session
    lastHandle = service.turnEngine.getTurn(`p${index}`)!.latestHandle
  }
  assert.equal(service.turnEngine.pendingTurnCount(), 129)
  assert.equal(service.platformPort.resolveSession(lastHandle), lastSession, '第 129 个回合的会话在登记后必须立即可解析（防自逐出）')
})

// ── R5：蒸馏预算硬上界（1199/1200/1299/1300 边界）────────────────────

const researchProvider: ProviderConfig = { label: 'p', enabled: true, endpoint: 'https://e.test', apiKey: 'k', model: 'm',
  temperature: 0.2, topP: 1, maxTokens: 512, timeout: 1_000, responseFormat: 'json-object' as const, extraHeaders: '', extraBody: '', proxyAgent: '' }

function budgetEnv() {
  const calls: Array<{ task: string, maxTokens: number }> = []
  const model: ResearchModelCaller = {
    async customSideTask<T>(_p: any, task: string, _t: number, _temp: number, maxTokens: number): Promise<T> {
      calls.push({ task, maxTokens })
      if (task === '考据改写') return { queries: ['流浪地球2 片长'] } as T
      // 第一轮蒸馏永远"证据不足"，逼出第二轮
      return { facts: [], insufficient: true, reason: '证据不足' } as T
    },
  }
  const http: ResearchHttpClientLike = { async get() { return '' }, async post() { return {} } }
  const registry = new ResearchToolRegistry({} as any)
  registry.registerSearch({ id: 'duckduckgo-html', search: async () => [{ title: 't', url: 'https://movie.test/a', snippet: '116 分钟' }] })
  return { calls, deps: (config: unknown) => ({ config, provider: researchProvider, model, http, registry, desk: new ResearchDesk(8), now: () => 1_000_000 }) }
}

test('R5 预算是硬上界：全部请求的出向上限合计不超过任务预算（1199/1200/1299/1300）', async () => {
  for (const budget of [1199, 1200, 1299, 1300]) {
    const { calls, deps } = budgetEnv()
    const config = resolveResearchConfig({ enabled: true, taskTokenBudget: budget, maxRounds: 2 }) as any
    const outcome = await runResearchTask(deps(config), { storyId: 's', topic: '流浪地球2', forbiddenTerms: [] })
    const total = calls.reduce((sum, call) => sum + call.maxTokens, 0)
    assert.ok(total <= budget, `预算 ${budget}：出向上限合计 ${total} 超额`)
    assert.ok(calls.every(call => call.maxTokens >= 200 || call.task === '考据改写' && call.maxTokens === 400), '蒸馏单次不低于 200（改写固定 400 预扣）')
    // 1200 及以下：首轮后剩余不足以做第二次 700 蒸馏 → 只有一轮蒸馏或跳轮
    if (budget <= 1200) {
      assert.equal(calls.filter(call => call.task === '考据蒸馏').length, 1, `预算 ${budget}：剩余不足时第二轮必须跳过`)
    }
    assert.ok(['completed', 'failed'].includes(outcome.status))
  }
})

test('R5 高预算双轮不受影响：1800 可按需进入第二轮且第二轮被剩余预算钳制', async () => {
  const { calls, deps } = budgetEnv()
  const config = resolveResearchConfig({ enabled: true, taskTokenBudget: 1800, maxRounds: 2 }) as any
  await runResearchTask(deps(config), { storyId: 's', topic: '流浪地球2', forbiddenTerms: [] })
  const distills = calls.filter(call => call.task === '考据蒸馏')
  assert.equal(distills.length, 2, '改写 400 + 两轮 700 = 1800 预算内')
  assert.equal(distills[0].maxTokens, 700)
  assert.equal(distills[1].maxTokens, 700)
})
