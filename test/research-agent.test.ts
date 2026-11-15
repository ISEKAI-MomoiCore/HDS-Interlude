import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_RESEARCH_CONFIG, deskKey, effectiveSearchBackend, parseDistillation, parseRewrite,
  ResearchDesk, resolveResearchConfig, sanitizeQueries,
} from '../src/research/desk'
import { parseDuckDuckGoHtml, rankHits, extractReadableText, SearchHit } from '../src/research/search'
import { runResearchTask, ResearchModelCaller, ResearchHttpClientLike } from '../src/research/runner'
import { ResearchToolRegistry, SearchCache } from '../src/research/tools'
import { DEFAULT_RESEARCH_CONFIG as RC } from '../src/research/desk'
import type { ProviderConfig } from '../src/narrator'

const provider: ProviderConfig = { label: 'research', enabled: true, endpoint: 'https://gateway.test/v1/chat/completions', apiKey: 'k', model: 'cheap-model',
  temperature: 0.2, topP: 1, maxTokens: 512, timeout: 1_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForResearch: true }

test('research config resolves defaults, clamps numerics and infers the search backend', () => {
  const resolved = resolveResearchConfig(undefined)
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.searchBackend, 'auto')
  assert.equal(resolved.maxRounds, 2)
  assert.equal(resolved.deskCapacity, 8)
  // auto 推断：有 Key 走 tavily，有 searxng 走 searxng，都没有回退 DDG 零配置。
  assert.equal(effectiveSearchBackend({ ...DEFAULT_RESEARCH_CONFIG, searchApiKey: 'tvly-x' }), 'tavily')
  assert.equal(effectiveSearchBackend({ ...DEFAULT_RESEARCH_CONFIG, searxngBaseUrl: 'http://127.0.0.1:8888/' }), 'searxng')
  assert.equal(effectiveSearchBackend({ ...DEFAULT_RESEARCH_CONFIG }), 'duckduckgo-html')
  assert.equal(effectiveSearchBackend({ ...DEFAULT_RESEARCH_CONFIG, searchBackend: 'tavily' }), 'duckduckgo-html', 'tavily 无 Key 回退 DDG')
  const clamped = resolveResearchConfig({ enabled: true, maxRounds: 9, taskTokenBudget: 1, deskCapacity: 1, volatileFactTtlHours: 999 })
  assert.equal(clamped.maxRounds, 2)
  assert.equal(clamped.taskTokenBudget, 600)
  assert.equal(clamped.deskCapacity, 2, '容量夹取下限 2')
  assert.equal(clamped.volatileFactTtlHours, 168, '易变 TTL 夹取上限')
})

test('the desk dedupes by topic key, expires by TTL tiers and evicts the oldest beyond capacity', async () => {
  const desk = new ResearchDesk(2)
  const t0 = 1_000_000
  desk.offer('东湖 骑行', { text: '环湖骑行约 20 公里', sourceUrl: 'https://example.test/a', confidence: 0.8, hard: true, ttlUntil: t0 + 7 * 3_600_000 }, t0)
  assert.equal(desk.size, 1)
  // 同主题键（大小写/空白归一）命中复用，未过期不写新条目。
  assert.ok(desk.reusable('东湖  骑行', t0 + 1), '空白/大小写归一后同主题命中')
  assert.ok(!desk.reusable('别的主题', t0 + 1))
  desk.offer('电影 时长', { text: '片长 116 分钟', sourceUrl: 'https://example.test/b', confidence: 0.9, hard: false, ttlUntil: t0 + 12 * 3_600_000 }, t0 + 1)
  desk.offer('第三条', { text: '满容量淘汰最旧', sourceUrl: 'https://example.test/c', confidence: 0.5, hard: false, ttlUntil: t0 + 24 * 3_600_000 }, t0 + 2)
  assert.equal(desk.size, 2, '容量 2：最旧的被淘汰')
  const snapshot = desk.snapshot(t0 + 3)
  assert.equal(snapshot?.length, 2)
  assert.ok(snapshot!.every(item => item.text !== '环湖骑行约 20 公里'), '最旧的（东湖条目）已被淘汰')
  const later = t0 + 13 * 3_600_000
  const remaining = desk.snapshot(later)
  assert.equal(remaining?.length, 1, '易变条目过期撤下')
})

test('sanitizeQueries drops person identifiers, dedupes and bounds length', () => {
  const kept = sanitizeQueries(['流浪地球2 片长', '流浪地球2 片长', 'a'], ['10086', '小明'])
  assert.deepEqual(kept, ['流浪地球2 片长'])
  assert.deepEqual(sanitizeQueries(['小明 的 家门口'], ['小明']), [], '命中身份词的查询整体丢弃')
  assert.equal(sanitizeQueries(['x'.repeat(200)], []).length, 0, '超长查询丢弃')
})

test('distillation parsing tolerates noise and drops malformed facts', () => {
  const longText = '长'.repeat(191)
  const parsed = parseDistillation('噪声 ```json\n{"facts":[{"text":"片长 116 分钟","sourceUrl":"https://e.test/x","confidence":0.9,"hard":true},{"text":"","sourceUrl":"bad"},{"text":"' + longText + '","sourceUrl":"https://e.test/y","confidence":2},{"text":"置信度超界条目","sourceUrl":"https://e.test/z","confidence":2}],"insufficient":false,"reason":"ok"}\n```')
  assert.equal(parsed?.facts.length, 2, '空文本与超长条目被丢弃')
  assert.equal(parsed?.facts[0].hard, true)
  assert.equal(parsed?.facts[1].confidence, 1, '置信度夹取到 1')
  assert.equal(parseDistillation('{"insufficient":true}')?.insufficient, true)
  assert.equal(parseDistillation('完全不是 JSON'), undefined)
  assert.deepEqual(parseRewrite('{"queries":["流浪地球2 片长","流浪地球2 豆瓣"]}'), ['流浪地球2 片长', '流浪地球2 豆瓣'])
  assert.equal(parseRewrite('{"queries":[]}'), undefined)
})

test('duckduckgo html parsing unwraps redirects, pairs snippets and dedupes urls', () => {
  const html = [
    '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fmovie.test%2Fa&amp;rut=abc">流浪地球2 (2027) - 豆瓣</a>',
    '<a rel="nofollow" class="result__a" href="https://movie.test/a">重复链接</a>',
    '<a rel="nofollow" class="result__a" href="https://movie.test/b">片长 116 分钟 - 电影网</a>',
    '<a class="result__snippet" href="#">郭帆执导，<b>片长 116 分钟</b>。</a>',
    '<a class="result__snippet" href="#">第二条摘要。</a>',
  ].join('\n')
  const hits = parseDuckDuckGoHtml(html)
  assert.equal(hits.length, 2, 'URL 去重后两条')
  assert.equal(hits[0].url, 'https://movie.test/a', 'uddg 跳转解包 + 实体解码')
  assert.equal(hits[0].snippet, '郭帆执导，片长 116 分钟。', '标签剥离')
})

test('rankHits prefers title term overlap and extractReadableText strips noise blocks', () => {
  const hits: SearchHit[] = [
    { title: '无关内容', url: 'https://a.test/x', snippet: '' },
    { title: '流浪地球2 片长多少', url: 'https://b.test/y', snippet: '' },
    { title: '流浪地球2 豆瓣评分', url: 'https://c.test/z', snippet: '片长 116 分钟' },
  ]
  const ranked = rankHits(hits, '流浪地球2 片长', 2)
  assert.equal(ranked[0].url, 'https://c.test/z', '标题整词 + 摘要命中合计得分最高')
  assert.ok(!ranked.some(hit => hit.url === 'https://a.test/x'), '零相关被挤出 top-k')
  const text = extractReadableText('<html><style>.x{}</style><script>bad()</script><nav>菜单</nav><h1>标题</h1><p>正文第一段。</p><p>正文第二段。</p></html>')
  assert.ok(text.includes('标题') && text.includes('正文第一段。'))
  assert.ok(!text.includes('bad()') && !text.includes('菜单'))
})

// ── runner 全链路（stub 模型 + stub HTTP） ────────────────────────────────

function makeRegistry(http: ResearchHttpClientLike, overrides: { searchResults?: SearchHit[] } = {}) {
  const registry = new ResearchToolRegistry({} as any)
  registry.registerSearch({
    id: 'duckduckgo-html',
    search: async () => (overrides.searchResults === undefined
      ? [{ title: '流浪地球2 片长', url: 'https://movie.test/a', snippet: '116 分钟' }]
      : overrides.searchResults),
  })
  return registry
}

function stubEnvironment(overrides: {
  model?: (task: string, user: string) => unknown
  searchResults?: SearchHit[]
} = {}) {
  const modelCalls: Array<{ task: string, system: string, user: string }> = []
  const model: ResearchModelCaller = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async customSideTask<T>(_provider: any, task: string, _timeout: number, _temp: number, _max: number, system: string, user: string): Promise<T> {
      modelCalls.push({ task, system, user })
      if (overrides.model) return overrides.model(task, user) as T
      if (task === '考据改写') return { queries: ['流浪地球2 片长'] } as T
      return {
        facts: [{ text: '片长 116 分钟', sourceUrl: 'https://movie.test/a', confidence: 0.9, hard: true, volatile: false }],
        insufficient: false, reason: 'ok',
      } as T
    },
  }
  const http: ResearchHttpClientLike = {
    async get(url: string) {
      if (String(url).includes('duckduckgo')) {
        return overrides.searchResults === undefined
          ? '<a class="result__a" href="https://movie.test/a">流浪地球2 片长</a><a class="result__snippet">116 分钟</a>'
          : ''
      }
      return '<html><title>流浪地球2</title><p>' + '片长 116 分钟，郭帆执导。'.repeat(20) + '</p></html>'
    },
    async post() { return {} },
  }
  return { model, http, modelCalls }
}

const baseConfig = resolveResearchConfig({ enabled: true, dailyTaskCap: 10 })

test('single-round research task: rewrite → search → distill → desk', async () => {
  const { model, http, modelCalls } = stubEnvironment()
  const desk = new ResearchDesk(8)
  const outcome = await runResearchTask({ config: baseConfig, provider, model, http, registry: makeRegistry(http), desk, now: () => 1_000_000 },
    { storyId: 's', topic: '流浪地球2看多久', forbiddenTerms: [], originIntentId: 7 })
  assert.equal(outcome.status, 'completed')
  assert.equal('added' in outcome ? outcome.added : 0, 1)
  assert.equal(modelCalls.length, 2, '改写 + 蒸馏各一次')
  assert.equal(modelCalls[0].task, '考据改写')
  assert.equal(modelCalls[1].task, '考据蒸馏')
  const snapshot = desk.snapshot(1_000_001)
  assert.equal(snapshot?.length, 1)
  assert.equal(snapshot![0].hard, true)
  assert.equal(snapshot![0].text, '片长 116 分钟')
})

test('desk cache hit costs zero model calls; the firewall and low budget behave as designed', async () => {
  const { model, http, modelCalls } = stubEnvironment()
  const desk = new ResearchDesk(8)
  const deps = { config: baseConfig, provider, model, http, registry: makeRegistry(http), desk, now: () => 1_000_000 }
  const first = await runResearchTask(deps, { storyId: 's', topic: '流浪地球2', forbiddenTerms: [] })
  assert.equal(first.status, 'completed')
  const callsAfterFirst = modelCalls.length
  const second = await runResearchTask(deps, { storyId: 's', topic: '流浪地球2', forbiddenTerms: [] })
  assert.equal(second.status, 'completed')
  assert.equal('reused' in second ? second.reused : false, true, '案头复用')
  assert.equal(modelCalls.length, callsAfterFirst, '零模型调用')
  // 防火墙拦截全部查询：跳过（stub 回显主题词，模拟改写输出含身份词）。
  const echoModel: ResearchModelCaller = {
    async customSideTask<T>(p: any, task: string): Promise<T> {
      if (task === '考据改写') return { queries: ['10086 的住址'] } as T
      return { facts: [], insufficient: false, reason: '' } as T
    },
  }
  const blocked = await runResearchTask({ ...deps, model: echoModel }, { storyId: 's', topic: '10086 的住址', forbiddenTerms: ['10086'] })
  assert.equal(blocked.status, 'skipped')
  // 低预算降级：跳过改写，直接主题词检索（只调用蒸馏）。
  const degraded = await runResearchTask({ ...deps, config: { ...baseConfig, taskTokenBudget: 800 } },
    { storyId: 's', topic: '另一个主题', forbiddenTerms: [] })
  assert.equal(degraded.status, 'completed')
  const degradedTasks = modelCalls.slice(-2).map(call => call.task)
  assert.ok(!degradedTasks.includes('考据改写'), '低预算跳过改写')
})

test('insufficient evidence triggers exactly one more round with an append-only, prefix-stable context', async () => {
  let distillCount = 0
  const { model, http, modelCalls } = stubEnvironment({
    model: task => {
      if (task === '考据改写') return { queries: ['环东湖骑行 距离'] }
      distillCount += 1
      if (distillCount === 1) return { facts: [], insufficient: true, reason: '摘要无数据' }
      return { facts: [{ text: '环湖绿道全程约 20 公里', sourceUrl: 'https://donghu.test/route', confidence: 0.85, hard: true, volatile: false }], insufficient: false, reason: 'ok' }
    },
  })
  const desk = new ResearchDesk(8)
  const outcome = await runResearchTask({ config: baseConfig, provider, model, http, registry: makeRegistry(http), desk, now: () => 1_000_000 },
    { storyId: 's', topic: '环东湖骑一圈多远', forbiddenTerms: [] })
  assert.equal(outcome.status, 'completed')
  assert.equal(distillCount, 2, '恰好追加一轮')
  const distills = modelCalls.filter(call => call.task === '考据蒸馏')
  assert.equal(distills.length, 2)
  // 前缀缓存对齐：两轮 system 逐字节一致；第二轮 user 包含第一轮全部内容且只追加。
  assert.equal(distills[0].system, distills[1].system)
  assert.ok(distills[1].user.startsWith(distills[0].user), 'append-only：第二轮只追加补充块')
  assert.ok(distills[1].user.includes('Additional results:'))
  // 单轮配置下 insufficient 直接按失败收尾，不多发调用。
  const single = await runResearchTask({ config: { ...baseConfig, maxRounds: 1 }, provider, model, http, registry: makeRegistry(http), desk: new ResearchDesk(8), now: () => 1_000_000 },
    { storyId: 's', topic: '查不到的主题', forbiddenTerms: [] })
  assert.ok(single.status === 'completed' || single.status === 'failed')
})

test('unparseable distillation and empty search both fail fast without blocking anything', async () => {
  const broken = stubEnvironment({ model: task => (task === '考据改写' ? { queries: ['x 主题'] } : 'not json at all') })
  const failed = await runResearchTask({ config: baseConfig, provider, model: broken.model, http: broken.http, registry: makeRegistry(broken.http), desk: new ResearchDesk(8), now: () => 0 },
    { storyId: 's', topic: 'x 主题', forbiddenTerms: [] })
  assert.equal(failed.status, 'failed')
  assert.match('reason' in failed ? failed.reason : '', /distill-unparseable/)
  const empty = stubEnvironment({ searchResults: [] as SearchHit[] })
  const noResults = await runResearchTask({ config: baseConfig, provider, model: empty.model, http: empty.http, registry: makeRegistry(empty.http, { searchResults: [] as SearchHit[] }), desk: new ResearchDesk(8), now: () => 0 },
    { storyId: 's', topic: '查无结果', forbiddenTerms: [] })
  assert.equal(noResults.status, 'failed')
})

// ── P2：工具注册表 / 查询缓存 / 任务日志 ─────────────────────────────────

test('the tool registry resolves backends, allows replacement and short-circuits via cache', async () => {
  const registry = new ResearchToolRegistry({} as any)
  assert.deepEqual(registry.registeredSearchIds.sort(), ['bocha', 'duckduckgo-html', 'searxng', 'tavily'])
  assert.ok(registry.registeredFetchIds.includes('http'))
  // 整替 duckduckgo-html：MCP 适配器的等价路径——不改 runner 一行。
  let backendCalls = 0
  registry.registerSearch({
    id: 'duckduckgo-html',
    search: async () => {
      backendCalls += 1
      return [{ title: '自定义后端结果', url: 'https://custom.test/a', snippet: '内容' }]
    },
  })
  const http: ResearchHttpClientLike = { async get() { throw new Error('不应触网') }, async post() { throw new Error('不应触网') } }
  const config = resolveResearchConfig({ enabled: true }) // 无 Key → DDG 回退 → 命中自定义后端
  const first = await registry.search(config, http, '测试查询', 1_000_000)
  assert.equal(first.length, 1)
  assert.equal(backendCalls, 1)
  // TTL 内同查询（大小写/空白归一）：缓存命中，后端零调用。
  const second = await registry.search(config, http, '  测试查询 ', 1_000_001)
  assert.equal(second.length, 1)
  assert.equal(backendCalls, 1, '缓存命中不再触达后端')
  assert.equal(registry.searchCache.counters.hits, 1)
  // 过期后重新触达后端。
  await registry.search(config, http, '测试查询', 1_000_000 + 31 * 60_000)
  assert.equal(backendCalls, 2)
  // 注册表抓取：内置 http 抓取器可被插队替换。
  registry.registerFetch({ id: 'custom', fetch: async () => ({ title: '替换抓取', text: 'x'.repeat(100), url: 'https://x.test' }) })
  const page = await registry.fetch(http, 'https://any.test')
  assert.equal(page?.title, '替换抓取')
})

test('the search cache evicts the least recently used entry beyond capacity', () => {
  const cache = new SearchCache(2, 60_000)
  cache.set('a', [{ title: 'a', url: 'https://a.test', snippet: '' }], 0)
  cache.set('b', [{ title: 'b', url: 'https://b.test', snippet: '' }], 0)
  assert.ok(cache.get('a', 1), '触碰 a 维持 LRU 顺序')
  cache.set('c', [{ title: 'c', url: 'https://c.test', snippet: '' }], 0)
  assert.equal(cache.size, 2, '容量 2：最久未用的 b 被淘汰')
  assert.ok(cache.get('a', 1))
  assert.equal(cache.get('b', 1), undefined)
  assert.equal(cache.counters.evictions, 1)
})

test('single-round tasks carry an append-only audit log with firewall drops recorded', async () => {
  const { model, http, modelCalls } = stubEnvironment({
    model: task => (task === '考据改写'
      ? { queries: ['流浪地球2 片长', '10086 住址', '流浪地球2 片长'] }
      : { facts: [{ text: '片长 116 分钟', sourceUrl: 'https://movie.test/a', confidence: 0.9, hard: true, volatile: false }], insufficient: false, reason: 'ok' }),
  })
  const desk = new ResearchDesk(8)
  const outcome = await runResearchTask({ config: baseConfig, provider, model, http, registry: makeRegistry(http), desk, now: () => 1_000_000 },
    { storyId: 's', topic: '流浪地球2', forbiddenTerms: ['10086'], originIntentId: 42 })
  assert.equal(outcome.status, 'completed')
  const steps = outcome.log.map(entry => entry.step)
  assert.ok(steps.includes('task-start') && steps[0] === 'task-start')
  assert.ok(steps.includes('rewrite'))
  assert.ok(steps.includes('firewall'), '防火墙丢弃（身份词+重复）被记录')
  assert.ok(steps.includes('round-1-search'))
  assert.ok(steps.includes('round-1-distill'))
  assert.ok(steps.includes('desk-offer'))
  assert.ok(steps.includes('task-complete'))
  const firewall = outcome.log.find(entry => entry.step === 'firewall')!
  assert.match(firewall.detail, /2/)
  const complete = outcome.log.find(entry => entry.step === 'task-complete')!
  assert.match(complete.detail, /模型调用=2/)
  assert.ok(outcome.log.every(entry => entry.detail.length <= 200), '单条日志 ≤200 字')
  assert.ok(modelCalls.length >= 2)
})

// ── P3'：Jev 决策门控 ─────────────────────────────────────────────────────

import { DEFAULT_JEV_CONFIG, jevGateDecision, jevNoul, resolveJevConfig } from '../src/research/jev'

test('jev config resolves defaults and clamps threshold and timeout', () => {
  const resolved = resolveJevConfig(undefined)
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.baseUrl, 'https://api.typesafe.ai')
  assert.equal(resolved.model, 'jev-1.13.0')
  assert.equal(resolved.noulThreshold, 0.6)
  const clamped = resolveJevConfig({ enabled: true, apiKey: 'k', baseUrl: 'https://proxy.test///', noulThreshold: 0.1, timeoutMs: 10 })
  assert.equal(clamped.baseUrl, 'https://proxy.test')
  assert.equal(clamped.noulThreshold, 0.5, '阈值夹取下限')
  assert.equal(clamped.timeoutMs, 500, '超时夹取下限')
})

test('the gate decision only fires at or above the configured probability', () => {
  const config = DEFAULT_JEV_CONFIG
  assert.equal(jevGateDecision(config, 0.9), true)
  assert.equal(jevGateDecision(config, 0.6), true, '等于阈值触发')
  assert.equal(jevGateDecision(config, 0.59), false)
  assert.equal(jevGateDecision(config, undefined), false, '服务不可用直通')
})

test('jevNoul posts the systemone shape and parses the noul probability; failures return undefined', async () => {
  const calls: any[] = []
  const http = {
    async post(url: string, body: any, options: any) {
      calls.push({ url, body, options })
      return { nouls: { needs_lookup: { noul: 0.73 } }, usage: { input_tokens: 120 } }
    },
  }
  const config = resolveJevConfig({ enabled: true, apiKey: 'tsk-test' })
  const noul = await jevNoul(http as any, config, 'needs_lookup', '是否需要核实？', { message: '帮我查下流浪地球2片长' })
  assert.equal(noul, 0.73)
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(calls[0].body.model, 'jev-1.13.0')
  assert.equal(calls[0].body.questions.needs_lookup.type, 'noul')
  assert.equal(calls[0].options.headers.authorization, 'Bearer tsk-test')
  // 失败与畸形响应 → undefined（fail-open）。
  const broken = {
    async post() { throw new Error('timeout') },
  }
  assert.equal(await jevNoul(broken as any, config, 'q', 'i', {}), undefined)
  const malformed = {
    async post() { return { choices: [] } },
  }
  assert.equal(await jevNoul(malformed as any, config, 'q', 'i', {}), undefined)
  // 未启用/无 Key：不发请求。
  const off = resolveJevConfig({ enabled: false })
  assert.equal(await jevNoul(http as any, off, 'q', 'i', {}), undefined)
  assert.equal(calls.length, 1)
})

// ── 审计修复回归 ─────────────────────────────────────────────────────────

test('cache-first payload keeps the research desk (audit #1)', async () => {
  const { toPromptPayload } = await import('../src/narrator')
  const request: any = {
    phase: 'user-message',
    story: { id: 's', platform: 'onebot', selfId: 'b', userId: '', channelId: '', status: 'active', setting: { character: { name: '她' }, style: '' } as any, state: {} as any, cursorAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
    from: new Date(), now: new Date(), participant: null, participants: [], shareParticipantDetails: false,
    dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [],
    images: [], audio: [], userMessage: '在吗',
    researchDesk: [{ text: '片长 116 分钟', source: 'https://m.test/a', confidence: 0.9, hard: true }],
  }
  const payload = toPromptPayload(request, { cacheFirst: true }) as any
  const compiled = payload.relevantEstablishedEpisodes ?? payload
  assert.ok(JSON.stringify(payload).includes('片长 116 分钟'), 'cache-first 输出必须携带案头事实')
})

test('multiple facts under one topic coexist and the topic stays reusable (audit #2)', () => {
  const desk = new ResearchDesk(8)
  const t0 = 1_000_000
  desk.offer('流浪地球2', { text: '片长 116 分钟', sourceUrl: 'https://a.test/1', confidence: 0.9, hard: true, ttlUntil: t0 + 1_000 }, t0)
  desk.offer('流浪地球2', { text: '导演郭帆', sourceUrl: 'https://a.test/2', confidence: 0.8, hard: false, ttlUntil: t0 + 1_000 }, t0)
  desk.offer('流浪地球2', { text: '片长 116 分钟', sourceUrl: 'https://a.test/1', confidence: 0.95, hard: true, ttlUntil: t0 + 2_000 }, t0 + 1)
  assert.equal(desk.size, 2, '同主题两条不同事实共存，同内容幂等刷新不新增')
  const snapshot = desk.snapshot(t0 + 2)!
  assert.equal(snapshot.length, 2)
  assert.ok(snapshot.some(item => item.text === '导演郭帆'))
  assert.ok(desk.reusable('流浪地球2', t0 + 2), '主题级复用命中任一未过期子键')
  assert.ok(!desk.reusable('别的主题', t0 + 2))
})

test('the second research round bypasses the query cache (audit #3)', async () => {
  const registry = new ResearchToolRegistry({} as any)
  let backendCalls = 0
  let lastFresh: boolean | undefined
  registry.registerSearch({
    id: 'duckduckgo-html',
    search: async (_http, _options, query, forceFresh) => {
      backendCalls += 1
      lastFresh = forceFresh
      return [{ title: `结果${backendCalls}`, url: `https://r.test/${backendCalls}`, snippet: query }]
    },
  } as any)
  const http: ResearchHttpClientLike = { async get() { return '' }, async post() { return {} } }
  const config = resolveResearchConfig({ enabled: true })
  const first = await registry.search(config, http, '同一查询', 1_000_000)
  assert.equal(first.length, 1)
  assert.equal(backendCalls, 1)
  const cached = await registry.search(config, http, '同一查询', 1_000_001)
  assert.equal(backendCalls, 1, '一轮命中缓存零后端调用')
  const fresh = await registry.search(config, http, '同一查询', 1_000_002, true)
  assert.equal(backendCalls, 2, 'forceFresh 绕过缓存重新触达后端')
  assert.equal(fresh[0].url, 'https://r.test/2')
  assert.equal(lastFresh, true)
})

test('proxy resolution prefers explicit research config then falls back to the provider (audit #5)', async () => {
  const { proxyAgentResolved, researchHttpWithProxy } = await import('../src/research/http')
  const provider = { label: 'p', enabled: true, endpoint: 'https://e.test', apiKey: 'k', model: 'm', temperature: 0.2, topP: 1, maxTokens: 512, timeout: 1_000, responseFormat: 'json-object' as const, extraHeaders: '', extraBody: '', proxyAgent: 'http://provider-proxy:7890' }
  assert.equal(proxyAgentResolved('http://mine:7890', provider), 'http://mine:7890', 'research 显式代理优先')
  assert.equal(proxyAgentResolved('', provider), 'http://provider-proxy:7890', '空则继承考据连接代理')
  assert.equal(proxyAgentResolved(undefined, { ...provider, proxyAgent: '' }), '', '都空则直连')
  const passthrough = researchHttpWithProxy({ async get() { return 'ok' }, async post() { return {} } }, '')
  assert.equal(await passthrough.get('https://x.test'), 'ok', '直连透传原客户端')
  const wrapped = researchHttpWithProxy({ async get() { throw new Error('不应触达') }, async post() { throw new Error('不应触达') } }, 'http://p:1')
  assert.ok(wrapped.get instanceof Function && wrapped.get !== passthrough.get, '有代理返回包装客户端')
})

test('prompt-only skips response_format while json-object keeps it (audit #6)', async () => {
  const { OpenAICompatibleNarrator } = await import('../src/narrator')
  type ModelConfig = import('../src/narrator').ModelConfig
  const captured: any[] = []
  const prov: any = { label: 'r', enabled: true, endpoint: 'https://g.test/v1/chat/completions', apiKey: 'k', model: 'm',
    temperature: 0.2, topP: 1, maxTokens: 512, timeout: 1_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '' }
  const narrator = new OpenAICompatibleNarrator({ http: { post: async (_u: string, body: any) => {
    captured.push(body)
    return { choices: [{ message: { content: '{"lookups":[]}' } }] }
  } } } as any, { providers: [prov], fixedPrompt: '', stylePrompt: '' } as ModelConfig, true)
  await narrator.customSideTask(prov, '考据改写', 1_000, 0.2, 100, 's', 'u')
  assert.deepEqual(captured[0].response_format, { type: 'json_object' }, '默认发送 json_object')
  await narrator.customSideTask(prov, '考据改写', 1_000, 0.2, 100, 's', 'u', 'prompt-only')
  assert.equal('response_format' in captured[1], false, 'prompt-only 不发送 response_format')
})
