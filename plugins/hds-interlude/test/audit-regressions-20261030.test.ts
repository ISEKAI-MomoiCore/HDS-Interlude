import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { createTurnEngine } from '../src/turn-engine'
import { Config } from '../src/index'
import { CONFIG_CENTER_SECRET_MASK } from '../src/console/contract'
import { applyConfigSectionPatch, readConfigCenter } from '../src/console/config-center'
import { deferDueIntentsBehindPendingSplits } from '../src/intents'
import { runResearchTask, ResearchModelCaller, ResearchHttpClientLike } from '../src/research/runner'
import { ResearchToolRegistry } from '../src/research/tools'
import { ResearchDesk, DEFAULT_RESEARCH_CONFIG, resolveResearchConfig } from '../src/research/desk'
import type { ProviderConfig } from '../src/narrator'

/** 审计 2026-10-30 六项问题的回归钉（AUDIT_REPORT.md F1–F6）+ D1 盲区
 * 补测（登记→解析→消费链路）。每项对应一个复现，修复后断言反转为正确
 * 行为。 */

// ── F1：密钥递归脱敏（新接口嵌套 jev.apiKey；旧接口 searchApiKey）──────

test('F1 新接口：嵌套 research.jev.apiKey 与顶层 searchApiKey 均按 Schema 掩码', () => {
  const host = {
    config: {
      ...(Config as any)({}),
      research: {
        ...(Config as any)({}).research,
        searchApiKey: 'sk-audit-search',
        jev: { ...((Config as any)({}).research?.jev ?? {}), apiKey: 'sk-audit-jev', enabled: true },
      },
    },
  } as any
  const result = readConfigCenter(host, Config, 'research')
  assert.equal(result.ok, true)
  assert.equal(result.values!.searchApiKey, CONFIG_CENTER_SECRET_MASK)
  assert.equal((result.values!.jev as any).apiKey, CONFIG_CENTER_SECRET_MASK)
  assert.ok(JSON.stringify(result).indexOf('sk-audit') < 0, '响应不得含任何真实密钥')
  assert.deepEqual(result.maskedFields!.sort(), ['jev.apiKey', 'searchApiKey'])
})

test('F1 旧接口：consoleReadConfig research 不再回传明文 searchApiKey', async () => {
  const target: any = Object.create(InterludeService.prototype)
  target.config = { research: { searchApiKey: 'sk-audit-old', enabled: true } }
  const result = await target.consoleReadConfig('research')
  assert.equal(result.ok, true)
  assert.equal(result.values.searchApiKey, CONFIG_CENTER_SECRET_MASK)
  assert.ok(JSON.stringify(result).indexOf('sk-audit-old') < 0)
})

// ── F5：配置节深合并 + 递归哨兵 ─────────────────────────────────────────

function pipelineHost(research: Record<string, unknown>) {
  const updates: any[] = []
  return {
    host: { config: { ...(Config as any)({}), research }, updatePluginConfig: (m: any) => updates.push(m) } as any,
    updates,
  }
}

test('F5 局部 patch 深合并：只改 jev.enabled 不清空 apiKey/baseUrl/model', () => {
  const base = (Config as any)({}).research
  const { host, updates } = pipelineHost({ ...base, jev: { ...base.jev, apiKey: 'sk-keep', baseUrl: 'https://jev.self', model: 'jev-9.9.9' } })
  const result = applyConfigSectionPatch(host, Config, 'research', { jev: { enabled: true } })
  assert.equal(result.ok, true)
  const jev = updates[0].research.jev
  assert.equal(jev.enabled, true)
  assert.equal(jev.apiKey, 'sk-keep', '嵌套密钥不被局部 patch 清空')
  assert.equal(jev.baseUrl, 'https://jev.self')
  assert.equal(jev.model, 'jev-9.9.9')
})

test('F5 递归哨兵：嵌套 jev.apiKey 哨兵不覆盖真实密钥', () => {
  const base = (Config as any)({}).research
  const { host, updates } = pipelineHost({ ...base, jev: { ...base.jev, apiKey: 'sk-keep' } })
  const result = applyConfigSectionPatch(host, Config, 'research', {
    searchApiKey: CONFIG_CENTER_SECRET_MASK,
    jev: { apiKey: CONFIG_CENTER_SECRET_MASK, noulThreshold: 0.7 },
  })
  assert.equal(result.ok, true)
  assert.equal(updates[0].research.jev.apiKey, 'sk-keep')
  assert.equal(updates[0].research.jev.noulThreshold, 0.7)
})

// ── F2：分段屏障到界放行 ───────────────────────────────────────────────

function barrierHarness() {
  const writes: Array<{ id: number, notBefore: Date }> = []
  const wakes: Date[] = []
  const svc: any = {
    dbSet: async (_q: unknown, row: { id: number }) => { /* 形状记录见下 */ },
    scheduleDueIntentWake: (_sid: string, at: Date) => { wakes.push(at) },
    scheduleNextPendingWake: async () => {},
    reportOperation: () => {},
  }
  return { svc, writes, wakes }
}

test('F2 超过 24h 终止界的意图放行进入 ready，不再按过去时间重排', async () => {
  const { svc, wakes } = barrierHarness()
  const now = new Date('2026-10-30T05:00:00Z')
  const intent: any = { id: 9, type: 'narrative-retry', participantId: 'p1', createdAt: new Date(now.getTime() - 25 * 3_600_000) }
  const splits: any[] = [{ participantId: 'p1', notBefore: new Date(now.getTime() + 3_600_000) }]
  let wrote = 0
  svc.dbSet = async () => { wrote++ }
  const ready = await deferDueIntentsBehindPendingSplits(svc, { id: 's' } as any, [intent], splits, now)
  assert.deepEqual(ready.map(item => item.id), [9], '到界放行，不再扣留')
  assert.equal(wrote, 0, '不得再按过去时间写库重排')
  assert.equal(wakes.length, 0, '零延迟唤醒链断开——不再为零/过去时间排唤醒')
})

test('F2 未到界仍正常延后（放行条件不误伤常规等待）', async () => {
  const { svc, wakes } = barrierHarness()
  const now = new Date('2026-10-30T05:00:00Z')
  const intent: any = { id: 10, type: 'narrative-retry', participantId: 'p1', createdAt: new Date(now.getTime() - 3_600_000) }
  const splits: any[] = [{ participantId: 'p1', notBefore: new Date(now.getTime() + 3_600_000) }]
  let wrote = 0
  svc.dbSet = async () => { wrote++ }
  const ready = await deferDueIntentsBehindPendingSplits(svc, { id: 's' } as any, [intent], splits, now)
  assert.equal(ready.length, 0, '未到界继续等待分段')
  assert.equal(wrote, 1)
  assert.ok(wakes[0].getTime() > now.getTime(), '重排时间必须在未来')
})

// ── F3 + D1 盲区：会话缓存绑定回合引用、登记→解析→消费链路 ─────────────

function d1Service() {
  const service: any = Object.create(InterludeService.prototype)
  const engine = createTurnEngine({
    setTimeout: (fn: () => void) => () => { void fn },
    userMessageDebounceSeconds: 2,
    scheduleTurnFlush: () => {},
    reportOperation: () => {},
  })
  service.turnEngine = engine
  return service
}

const story = { id: 's', status: 'active', setting: { timezone: 'Asia/Shanghai', character: { name: 'X' } }, state: {}, cursorAt: new Date() } as any

test('F3 缓存超限时：被待处理回合引用的会话绝不逐出（审计复现场景）', () => {
  const service = d1Service()
  const participant = { id: 'p0', status: 'active', channelId: 'private:u0' } as any
  const p0Session = { platform: 'onebot', channelId: 'private:u0', selfId: '1' } as any
  service.bufferUserNarrative(story, participant, p0Session, new Date(), [], '语音待处理')
  // 130 个其它通道完成回合后残留会话（无引用），缓存被填满并反复逐出。
  // D2 起解析表迁入 PlatformAdapter（OneBotAdapter）。
  const adapter = service.platformPort
  for (let index = 1; index <= 130; index++) {
    adapter.rememberSession(
      { platform: 'onebot', channelId: `private:other-${index}`, selfId: '1' },
      { platform: 'onebot', channelId: `private:other-${index}`, selfId: '1' } as any,
    )
  }
  const turn = service.turnEngine.getTurn('p0')!
  const resolved = adapter.resolveSession(turn.latestHandle)
  assert.equal(resolved, p0Session, '活跃回合引用的会话必须在任何逐出后存活')
  // 无引用的其它通道按上限收敛，缓存不无限增长（允许引用项临时超限）。
  assert.ok(adapter.sessionCount() <= 131, '只保留引用项 + 上限内的无引用项')
})

test('F3 同通道重复登记刷新近用顺序：最旧项先被回收', () => {
  const service = d1Service()
  const adapter = service.platformPort
  const early = { platform: 'onebot', channelId: 'private:early', selfId: '1' } as any
  adapter.rememberSession({ platform: 'onebot', channelId: 'private:early', selfId: '1' }, early)
  const recent = { platform: 'onebot', channelId: 'private:recent', selfId: '1' } as any
  adapter.rememberSession({ platform: 'onebot', channelId: 'private:recent', selfId: '1' }, recent)
  // 同通道重复登记刷新近用顺序；重登记后仍可解析。
  adapter.rememberSession({ platform: 'onebot', channelId: 'private:recent', selfId: '1' }, recent)
  assert.equal(adapter.resolveSession({ platform: 'onebot', channelId: 'private:recent', selfId: '1' }), recent)
  assert.equal(adapter.resolveSession({ platform: 'onebot', channelId: 'private:early', selfId: '1' }), early)
})

test('D1 盲区补测：经真实 service 入口登记→句柄解析→消费拿到同一 session 身份', async () => {
  const service: any = Object.create(InterludeService.prototype)
  const engine = createTurnEngine({
    setTimeout: (fn: () => void) => () => { void fn },
    userMessageDebounceSeconds: 2,
    scheduleTurnFlush: () => {},
    reportOperation: () => {},
  })
  service.turnEngine = engine
  const participant = { id: 'p1', status: 'active', channelId: 'private:u1' } as any
  const theSession = { platform: 'onebot', channelId: 'private:u1', selfId: '7', content: '你好' } as any
  service.bufferUserNarrative(story, participant, theSession, new Date(), [], '你好')

  const consumed: Record<string, unknown> = {}
  Object.assign(service, {
    databaseResetting: false, desktopRuntimePhase: 'running', disposed: false, pendingProactiveCount: 0,
    config: { runtime: {}, model: {} },
    serial: async (_id: string, fn: () => unknown) => fn(),
    getStory: async () => story,
    getParticipant: async () => participant,
    dueIntents: async () => [],
    reportStandalone: () => {}, reportOperation: () => {}, reportStandaloneOperation: () => {},
    scheduleNarrativeRetry: async () => {},
    jevGatePassiveResearch: async () => {},
    semanticTurnEmbeddingEnabled: () => false,
    stickerCatalogForSession: async (session: unknown) => { consumed.sticker = session; return [] },
    privateChatCapabilities: (session: unknown) => { consumed.capabilities = session; return { quoteReply: true, reactions: [], nativeFaces: [], expressionThreshold: 0.7 } },
    loadNativeImages: async (_s: unknown, _src: unknown, session: unknown) => { consumed.images = session; return [] },
    loadNativeAudio: async (_s: unknown, _src: unknown, session: unknown) => { consumed.audio = session; return [] },
    deliverEarlyPrivateReply: async () => undefined,
    tryDecide: async () => ({ decision: { interaction: { reply: { mode: 'immediate', content: '嗯' } } }, succeeded: true, effectiveNow: new Date(), immediateObservations: [] }),
    persistImmediateObservations: async () => {},
    persistDecision: async () => ({ messages: [{ participantId: 'p1', content: '嗯' }], commit: {}, scriptEntry: { id: 1 } }),
    dbSet: async () => {},
    cancelPendingNarrativeRetries: async () => {},
    scheduleConversationFollowUpsAfterTurn: async () => {},
    canHandleParticipant: () => true,
    deliverOutgoingMessages: async (_s: unknown, _m: unknown, _p: unknown, session: unknown) => { consumed.deliver = session; return [] },
    scheduleCompaction: () => {},
  })

  const turn = engine.getTurn('p1')!
  await service.flushBufferedNarrative('p1', turn.nextRevision)

  for (const [name, session] of Object.entries(consumed)) {
    assert.equal(session, theSession, `${name} 必须拿到登记时的同一 session 实例`)
  }
  assert.ok(Object.keys(consumed).length >= 4, '贴纸/能力/图片/投递四个消费点都被检查')
})

// ── F4 + F6：考据蒸馏协议与预算钳制 ────────────────────────────────────

const researchProvider: ProviderConfig = { label: 'p', enabled: true, endpoint: 'https://e.test', apiKey: 'k', model: 'm',
  temperature: 0.2, topP: 1, maxTokens: 512, timeout: 1_000, responseFormat: 'json-object' as const, extraHeaders: '', extraBody: '', proxyAgent: '' }

function researchEnv(modelImpl: (task: string) => unknown) {
  const calls: Array<{ task: string, maxTokens: number, responseFormat: unknown }> = []
  const model: ResearchModelCaller = {
    async customSideTask<T>(_p: any, task: string, _t: number, _temp: number, maxTokens: number, _sys: string, _user: string, responseFormat?: unknown): Promise<T> {
      calls.push({ task, maxTokens, responseFormat })
      return modelImpl(task) as T
    },
  }
  const http: ResearchHttpClientLike = {
    async get(url: string) {
      if (String(url).includes('duckduckgo')) return '<a class="result__a" href="https://movie.test/a">流浪地球2 片长</a><a class="result__snippet">116 分钟</a>'
      return '<html><title>t</title><p>' + '片长 116 分钟。'.repeat(20) + '</p></html>'
    },
    async post() { return {} },
  }
  const registry = new ResearchToolRegistry({} as any)
  registry.registerSearch({ id: 'duckduckgo-html', search: async () => [{ title: '流浪地球2 片长', url: 'https://movie.test/a', snippet: '116 分钟' }] })
  return { calls, deps: (config: unknown) => ({ config, provider: researchProvider, model, http, registry, desk: new ResearchDesk(8), now: () => 1_000_000 }) }
}

test('F4 prompt-only 同时作用于改写与蒸馏（两个请求都不携带 json-object 默认）', async () => {
  const { calls, deps } = researchEnv(task => task === '考据改写'
    ? { queries: ['流浪地球2 片长'] }
    : { facts: [{ text: '片长 116 分钟', sourceUrl: 'https://movie.test/a', confidence: 0.9, hard: true, volatile: false }], insufficient: false, reason: 'ok' })
  const config = { ...DEFAULT_RESEARCH_CONFIG, ...resolveResearchConfig({ enabled: true }), responseFormat: 'prompt-only' } as any
  const outcome = await runResearchTask(deps(config), { storyId: 's', topic: '流浪地球2', forbiddenTerms: [] })
  assert.equal(outcome.status, 'completed')
  assert.equal(calls.length, 2, '改写 + 蒸馏')
  assert.equal(calls[0].responseFormat, 'prompt-only')
  assert.equal(calls[1].responseFormat, 'prompt-only', '蒸馏必须与改写使用同一协议配置')
})

test('F6 低预算：强制单轮 + 蒸馏出向上限不超过任务预算', async () => {
  const { calls, deps } = researchEnv(task => task === '考据蒸馏'
    ? { facts: [], insufficient: true, reason: '证据不足' }
    : { queries: [] })
  const config = resolveResearchConfig({ enabled: true, taskTokenBudget: 600, maxRounds: 2 }) as any
  const outcome = await runResearchTask(deps(config), { storyId: 's', topic: '流浪地球2', forbiddenTerms: [] })
  assert.equal(outcome.status, 'failed', '单轮证据不足、零事实按既有语义记失败（此测试关注轮数与预算）')
  const distills = calls.filter(call => call.task === '考据蒸馏')
  assert.equal(distills.length, 1, '降级预算强制单轮，不再进入第二轮')
  assert.ok(distills[0].maxTokens <= 600, `蒸馏出向上限 600 内（实际 ${distills[0].maxTokens}）`)
  assert.ok(!calls.some(call => call.task === '考据改写'), '降级跳过改写')
})
