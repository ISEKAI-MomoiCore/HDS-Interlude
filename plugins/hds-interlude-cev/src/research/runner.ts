/**
 * 考据 Agent 编排（P2）：预算门 → 改写+防火墙 → 程序化检索（零 LLM）→
 * 蒸馏 → 案头。检索与抓取面向工具注册表编程（tools.ts），append-only
 * 任务日志随结果返回（存意图 payload，可审计重放；保留失败记录——
 * Manus 原则）。循环契约对齐前缀缓存：system 合约逐字节固定、上下文
 * append-only、JSON 确定性序列化。典型成本：2 次模型调用 + 1-2 次检索。
 */
import type { ProviderConfig } from '../narrator'
import {
  DistilledFact, normalizeTopic, parseDistillation,
  parseRewrite, RESEARCH_DISTILL_SYSTEM, RESEARCH_REWRITE_SYSTEM, ResearchConfig, ResearchDesk,
  sanitizeQueries,
} from './desk'
import { SearchHit } from './search'

/** 侧端模型调用的最小形态（OpenAICompatibleNarrator.customSideTask 同构，便于测试注入）。 */
export interface ResearchModelCaller {
  customSideTask<T>(provider: ProviderConfig, task: string, timeout: number, temperature: number, maxTokens: number, system: string, user: string, responseFormat?: 'json-object' | 'prompt-only'): Promise<T>
}

export interface ResearchHttpClientLike {
  get(url: string, options?: Record<string, unknown>): Promise<unknown>
  post(url: string, body: unknown, options?: Record<string, unknown>): Promise<unknown>
}

/** 工具注册表的最小形态（ResearchToolRegistry 同构，便于测试注入）。 */
export interface ResearchToolRegistryLike {
  search(config: ResearchConfig, http: ResearchHttpClientLike, query: string, now?: number, forceFresh?: boolean): Promise<SearchHit[]>
  fetch(http: ResearchHttpClientLike, url: string, maxCharacters?: number): Promise<{ title: string, text: string, url: string } | undefined>
}

/** append-only 任务日志条目；上限 40 条、单条 200 字，随意图 payload 存档。 */
export interface ResearchLogEntry {
  at: number
  step: string
  detail: string
}

export class ResearchTaskLog {
  readonly entries: ResearchLogEntry[] = []
  private readonly modelCalls: string[] = []

  append(step: string, detail: unknown, at: number) {
    this.entries.push({ at, step, detail: String(detail ?? '').slice(0, 200) })
    while (this.entries.length > 40) this.entries.shift()
  }

  noteModelCall(task: string) {
    this.modelCalls.push(task)
  }

  summary() {
    return { modelCalls: this.modelCalls.length, modelTasks: [...new Set(this.modelCalls)].join(','), logEntries: this.entries.length }
  }
}

export interface ResearchTaskInput {
  storyId: string
  topic: string
  /** 参与者身份词（防火墙禁查清单：userId/昵称等）。 */
  forbiddenTerms: string[]
  originIntentId?: number
}

export type ResearchTaskOutcome =
  | { status: 'completed', added: number, reused: boolean, reason: string, log: ResearchLogEntry[] }
  | { status: 'skipped', reason: string, log: ResearchLogEntry[] }
  | { status: 'failed', reason: string, log: ResearchLogEntry[] }

export interface ResearchRunnerDeps {
  config: ResearchConfig
  provider: ProviderConfig
  model: ResearchModelCaller
  http: ResearchHttpClientLike
  registry: ResearchToolRegistryLike
  desk: ResearchDesk
  now?: () => number
}


export async function runResearchTask(deps: ResearchRunnerDeps, input: ResearchTaskInput): Promise<ResearchTaskOutcome> {
  const now = deps.now ?? Date.now
  const log = new ResearchTaskLog()
  const config = deps.config
  const topic = normalizeTopic(input.topic)
  log.append('task-start', `主题=${topic} 来源意图=${input.originIntentId ?? '预取'}`, now())
  if (!topic) return { status: 'skipped', reason: 'empty-topic', log: log.entries }

  // 案头命中：未过期同主题条目直接复用，零模型调用、零检索。
  if (deps.desk.reusable(input.topic, now())) {
    deps.desk.markReused()
    log.append('desk-cache-hit', '同主题条目未过期，直接复用', now())
    return { status: 'completed', added: 0, reused: true, reason: 'desk-cache-hit', log: log.entries }
  }

  // 预算门：低预算任务降级为单轮（跳过改写，主题词直接检索）。
  const degraded = config.taskTokenBudget < 1_200
  if (degraded) log.append('budget-degraded', `预算 ${config.taskTokenBudget} 低于单轮阈值，跳过查询改写`, now())
  const maxRounds = Math.max(1, Math.min(2, config.maxRounds))

  let queries: string[] = [input.topic]
  if (!degraded) {
    try {
      log.noteModelCall('考据改写')
      const raw = await deps.model.customSideTask<unknown>(
        deps.provider, '考据改写', 30_000, 0.2, 400, RESEARCH_REWRITE_SYSTEM,
        `Topic: ${input.topic}`, deps.config.responseFormat)
      const rewritten = parseRewrite(typeof raw === 'string' ? raw : JSON.stringify(raw ?? {}))
      if (rewritten?.length) queries = rewritten
      log.append('rewrite', `改写输出=${queries.join(' / ')}`, now())
    } catch (error) {
      log.append('rewrite-failed', `改写失败退回主题词原样检索：${error instanceof Error ? error.message : String(error)}`, now())
    }
  }
  const sanitized = sanitizeQueries(queries, input.forbiddenTerms)
  const dropped = queries.length - sanitized.length
  if (dropped > 0) log.append('firewall', `防火墙丢弃 ${dropped} 条查询（身份词/超长/重复）`, now())
  if (!sanitized.length) {
    log.append('firewall-rejected-all', '全部查询被拦截，任务跳过', now())
    return { status: 'skipped', reason: 'firewall-rejected-all-queries', log: log.entries }
  }
  queries = sanitized

  const gathered: SearchHit[] = []
  let round = 0
  let distillText = ''

  while (round < maxRounds) {
    round += 1
    // 程序化检索（零 LLM）：本轮查询并发、URL 去重并入；一轮走查询缓存，
    // 二轮 forceFresh 绕缓存（审计修复 #3）——同词重查拿新鲜结果，追加才有信息增益。
    const roundQueries = round === 1 ? queries : queries.slice(0, 2)
    const forceFresh = round > 1
    const fresh = (await Promise.all(roundQueries.map(query => deps.registry.search(config, deps.http, query, now(), forceFresh)))).flat()
    const hits = dedupe([...gathered, ...fresh])
    gathered.splice(0, gathered.length, ...hits)
    log.append(`round-${round}-search`, `查询=[${roundQueries.join(' / ')}] 新命中=${fresh.length} 累计去重=${hits.length}`, now())
    const top = rankHits(gathered, topic, 5)
    if (!top.length) {
      log.append(`round-${round}-empty`, '检索无结果', now())
      break
    }

    // 摘要优先：摘要普遍过短的来源补抓 1-2 页正文（程序化判断，无模型裁量）。
    const enriched = await enrichWithPages(deps, top, log, now)

    // 蒸馏（append-only：第 2 轮只追加补充检索块，不重写第 1 轮）。
    distillText += (distillText ? '\n\nAdditional results:\n' : '') + serializeSources(enriched)
    let distilled
    try {
      log.noteModelCall('考据蒸馏')
      const raw = await deps.model.customSideTask<unknown>(
        deps.provider, '考据蒸馏', 60_000, 0.2, 700, RESEARCH_DISTILL_SYSTEM,
        `Topic: ${input.topic}\n\nResults:\n${distillText}`)
      distilled = parseDistillation(typeof raw === 'string' ? raw : JSON.stringify(raw ?? {}))
    } catch (error) {
      log.append(`round-${round}-distill-error`, String(error), now())
      return { status: 'failed', reason: `distill-error:${error instanceof Error ? error.message : String(error)}`.slice(0, 160), log: log.entries }
    }
    if (!distilled) {
      log.append(`round-${round}-distill-unparseable`, '蒸馏输出不可解析', now())
      return { status: 'failed', reason: 'distill-unparseable', log: log.entries }
    }
    log.append(`round-${round}-distill`, `事实=${distilled.facts.length} 证据不足=${distilled.insufficient} ${distilled.reason}`, now())
    if (distilled.facts.length || distilled.insufficient === false || round >= maxRounds) {
      return finish(deps, input, distilled.facts, now(), distilled.reason, log)
    }
    log.append(`round-${round}-insufficient`, '证据不足，追加一轮检索', now())
  }
  return finish(deps, input, [], now(), 'no-results', log)
}

function finish(deps: ResearchRunnerDeps, input: ResearchTaskInput, facts: DistilledFact[], now: number, reason: string, log: ResearchTaskLog): ResearchTaskOutcome {
  if (!facts.length) return { status: 'failed', reason: reason || 'no-facts', log: log.entries }
  const config = deps.config
  let added = 0
  for (const fact of facts) {
    deps.desk.offer(input.topic, {
      text: fact.text,
      sourceUrl: fact.sourceUrl,
      confidence: fact.confidence,
      hard: fact.hard,
      ttlUntil: now + (fact.volatile ? config.volatileFactTtlHours : config.stableFactTtlHours) * 3_600_000,
      ...(input.originIntentId ? { originIntentId: input.originIntentId } : {}),
    }, now)
    added += 1
  }
  log.append('desk-offer', `入案 ${added} 条（稳定 TTL=${config.stableFactTtlHours}h 易变 TTL=${config.volatileFactTtlHours}h）`, now)
  const summary = log.summary()
  log.append('task-complete', `模型调用=${summary.modelCalls}（${summary.modelTasks}）`, now)
  return { status: 'completed', added, reused: false, reason: reason || 'ok', log: log.entries }
}

/** 摘要过短的来源补抓页面正文（最多 2 页，经注册表抓取，失败也入日志）。 */
async function enrichWithPages(deps: ResearchRunnerDeps, hits: SearchHit[], log: ResearchTaskLog, now: () => number): Promise<SearchHit[]> {
  const thin = hits.filter(hit => hit.snippet.length < 60).slice(0, 2)
  const enriched = [...hits]
  for (const hit of thin) {
    const page = await deps.registry.fetch(deps.http, hit.url)
    if (page) {
      const index = enriched.findIndex(item => item.url === hit.url)
      if (index >= 0) enriched[index] = { ...hit, snippet: `${page.title}\n${page.text.slice(0, 800)}` }
      log.append('page-fetch', `补抓正文 ${hit.url}`, now())
    } else {
      log.append('page-fetch-failed', `来源不可读（跳过）${hit.url}`, now())
    }
  }
  return enriched
}

/** 确定性序列化（键序固定）：多轮请求的前缀逐字节一致，命中服务商前缀缓存。 */
function serializeSources(hits: SearchHit[]): string {
  return hits.map(hit => [
    `title: ${hit.title || '(untitled)'}`,
    `url: ${hit.url}`,
    `content: ${hit.snippet || '(no excerpt)'}`,
  ].join('\n')).join('\n\n')
}

function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>()
  return hits.filter(hit => {
    if (!hit.url || seen.has(hit.url)) return false
    seen.add(hit.url)
    return true
  })
}

function rankHits(hits: SearchHit[], topic: string, limit: number): SearchHit[] {
  // 与 search.ts 的 rankHits 同策略；独立实现以便 runner 只依赖注册表接口。
  const terms = String(topic ?? '').toLowerCase().split(/[\s,，。:：;；!！?？/\\|\-—·]+/).filter(term => term.length >= 2 && term.length <= 24)
  const scored = hits.map(hit => {
    const titleTerms = hit.title.toLowerCase()
    const snippetTerms = hit.snippet.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (titleTerms.includes(term)) score += 2
      if (snippetTerms.includes(term)) score += 1
    }
    return { hit, score }
  })
  return scored.sort((left, right) => right.score - left.score).slice(0, limit).map(item => item.hit)
}
