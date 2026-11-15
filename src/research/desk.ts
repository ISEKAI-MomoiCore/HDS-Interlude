/**
 * 考据 Agent（research，设计见 docs/RESEARCH_AGENT_DESIGN.md）。
 * 本文件：配置解析、资料案头（TTL 分级/容量/去重）、查询防火墙与蒸馏解析。
 * 案头是 author-facing 工作台：条目是"世界实际上是什么样"的核实事实，
 * 主角是否知晓由主叙事作者每轮裁决——案头从不说"她知道"。
 */
import { createHash } from 'node:crypto'
import { JevConfig, resolveJevConfig } from './jev'

export type ResearchSearchBackend = 'auto' | 'tavily' | 'bocha' | 'searxng' | 'duckduckgo-html'

export interface ResearchConfig {
  enabled: boolean
  searchBackend: ResearchSearchBackend
  searchApiKey: string
  searxngBaseUrl: string
  /** 审计修复 #5：考据网络出口代理；空 = 回退考据连接的 proxyAgent。 */
  proxyAgent: string
  /** 审计修复 #6：json-object 发 API JSON mode；不兼容网关用 prompt-only。 */
  responseFormat: 'json-object' | 'prompt-only'
  maxRounds: number
  taskTokenBudget: number
  deskCapacity: number
  stableFactTtlHours: number
  volatileFactTtlHours: number
  prefetchEnabled: boolean
  /** P3'：Jev 门控（被动推进叙事前的是非判断）。 */
  jev: JevConfig
}

export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  enabled: false,
  searchBackend: 'auto',
  searchApiKey: '',
  searxngBaseUrl: '',
  proxyAgent: '',
  responseFormat: 'json-object' as const,
  maxRounds: 2,
  taskTokenBudget: 6_000,
  deskCapacity: 8,
  stableFactTtlHours: 168,
  volatileFactTtlHours: 12,
  prefetchEnabled: false,
  jev: { enabled: false, apiKey: '', baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13.0', noulThreshold: 0.6, timeoutMs: 2_500 },
}

export function resolveResearchConfig(value: unknown): ResearchConfig {
  const raw = (value ?? {}) as Partial<ResearchConfig>
  const merged: ResearchConfig = { ...DEFAULT_RESEARCH_CONFIG, ...raw }
  merged.enabled = merged.enabled === true
  merged.prefetchEnabled = merged.prefetchEnabled === true
  merged.jev = resolveJevConfig((raw as { jev?: unknown }).jev ?? (merged as { jev?: unknown }).jev)
  const backends: ResearchSearchBackend[] = ['auto', 'tavily', 'bocha', 'searxng', 'duckduckgo-html']
  merged.searchBackend = backends.includes(merged.searchBackend) ? merged.searchBackend : 'auto'
  merged.maxRounds = Math.max(1, Math.min(2, Number(merged.maxRounds) || 2))
  merged.taskTokenBudget = Math.max(600, Math.min(20_000, Number(merged.taskTokenBudget) || 6_000))
  merged.deskCapacity = Math.max(2, Math.min(32, Number(merged.deskCapacity) || 8))
  merged.stableFactTtlHours = Math.max(1, Math.min(2_160, Number(merged.stableFactTtlHours) || 168))
  merged.volatileFactTtlHours = Math.max(1, Math.min(168, Number(merged.volatileFactTtlHours) || 12))
  merged.searchApiKey = String(merged.searchApiKey ?? '').trim()
  merged.searxngBaseUrl = String(merged.searxngBaseUrl ?? '').trim().replace(/\/+$/, '')
  merged.proxyAgent = String(merged.proxyAgent ?? '').trim()
  merged.responseFormat = merged.responseFormat === 'prompt-only' ? 'prompt-only' : 'json-object'
  return merged
}

/** 实际生效的搜索后端：显式选择 > 按 Key 推断 > DDG 零配置回退。 */
export function effectiveSearchBackend(config: ResearchConfig): Exclude<ResearchSearchBackend, 'auto'> {
  if (config.searchBackend === 'tavily') return config.searchApiKey ? 'tavily' : 'duckduckgo-html'
  if (config.searchBackend === 'bocha') return config.searchApiKey ? 'bocha' : 'duckduckgo-html'
  if (config.searchBackend === 'searxng') return config.searxngBaseUrl ? 'searxng' : 'duckduckgo-html'
  if (config.searchBackend === 'duckduckgo-html') return 'duckduckgo-html'
  if (config.searxngBaseUrl) return 'searxng'
  if (config.searchApiKey) return 'tavily'
  return 'duckduckgo-html'
}

export interface DeskEntry {
  /** 查询键哈希：同主题复用未过期条目时零调用。 */
  id: string
  text: string
  sourceUrl: string
  confidence: number
  /** ★硬约束（舞台物理） / 软材料（自由取用）。 */
  hard: boolean
  ttlUntil: number
  capturedAt: number
  originIntentId?: number
}

export interface DeskSnapshotItem {
  text: string
  source: string
  confidence: number
  hard: boolean
}

/** 资料案头：每故事一份内存工作台（重载清空——长期价值走压缩器晋升，
 * 不在案头持久化）。过期静默撤下；容量满淘汰最旧。 */
export class ResearchDesk {
  private readonly entries = new Map<string, DeskEntry>()
  readonly counters = { offered: 0, reused: 0, evicted: 0 }

  constructor(private readonly capacity = 8) {}

  /** 未过期的同主题条目直接复用（零调用路径）。多事实子键共享主题前缀。 */
  reusable(topic: string, now: number): DeskEntry | undefined {
    const prefix = `${deskKey(topic)}:`
    for (const [id, entry] of this.entries) {
      if (id.startsWith(prefix) && entry.ttlUntil > now) return entry
    }
    return undefined
  }

  /** 写入/刷新一条。审计修复 #2：键 = 主题前缀 + 事实内容哈希——同主题多条
   * 事实共存互不覆盖，同内容重写幂等刷新。 */
  offer(topic: string, entry: Omit<DeskEntry, 'id' | 'capturedAt'>, now: number): DeskEntry {
    const id = `${deskKey(topic)}:${createHash('sha256').update(entry.text).digest('hex').slice(0, 8)}`
    this.entries.delete(id)
    this.entries.set(id, { ...entry, id, capturedAt: now })
    this.counters.offered += 1
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
      this.counters.evicted += 1
    }
    return this.entries.get(id)!
  }

  markReused() { this.counters.reused += 1 }

  /** 过滤过期并清理；空案头返回 undefined（不注入上下文段）。 */
  snapshot(now: number, capacity = this.capacity): DeskSnapshotItem[] | undefined {
    for (const [id, entry] of this.entries) {
      if (entry.ttlUntil <= now) this.entries.delete(id)
    }
    while (this.entries.size > capacity) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
    }
    if (!this.entries.size) return undefined
    return [...this.entries.values()].map(entry => ({
      text: entry.text, source: entry.sourceUrl, confidence: entry.confidence, hard: entry.hard,
    }))
  }

  get size() { return this.entries.size }
}

export function deskKey(topic: string): string {
  return createHash('sha256').update(normalizeTopic(topic)).digest('hex').slice(0, 16)
}

export function normalizeTopic(topic: string): string {
  return String(topic ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120)
}

// ── 查询防火墙 ─────────────────────────────────────────────────────────────

/** 程序化防线：命中参与者身份词的查询词直接丢弃（模型侧防线在改写合约里）。 */
export function sanitizeQueries(queries: string[], forbiddenTerms: string[]): string[] {
  const forbidden = forbiddenTerms.map(term => normalizeTopic(term)).filter(term => term.length >= 2)
  const kept: string[] = []
  for (const raw of queries) {
    const query = String(raw ?? '').replace(/\s+/g, ' ').trim()
    if (query.length < 2 || query.length > 120) continue
    const normalized = normalizeTopic(query)
    if (forbidden.some(term => normalized.includes(term))) continue
    if (kept.some(prior => normalizeTopic(prior) === normalized)) continue
    kept.push(query)
  }
  return kept.slice(0, 4)
}


// ── 固定合约（前缀缓存对齐：逐字节稳定，不含时间戳等变化量） ───────────────

export const RESEARCH_REWRITE_SYSTEM = [
  'You rewrite a research topic into web search queries for a fact-checking assistant.',
  'Rules: queries contain only world-level terms (work titles, place names, organizations, general concepts); never include user ids, nicknames, private-chat details or anything that could identify a person; keep the original language of the topic unless it is clearly a title better searched as-is; 2 to 4 queries, shortest first.',
  'Return only JSON: {"queries": ["..."], "language": "zh" or "en"}',
].join('\n')

export const RESEARCH_DISTILL_SYSTEM = [
  'You distill search results into verified writing-reference facts for a narrative author.',
  'Rules: state only what the supplied results actually support; prefer concrete numbers and durations; one fact per item, at most 120 Chinese characters; set hard=true only for physical constraints that prose must obey (runtimes, distances, opening hours); set confidence 0.0-1.0; if the results cannot answer the topic, return an empty facts array with insufficient=true — never invent.',
  'Return only JSON: {"facts": [{"text": "...", "sourceUrl": "...", "confidence": 0.0, "hard": false, "volatile": false}], "insufficient": false, "reason": "brief"}',
].join('\n')

export interface DistilledFact {
  text: string
  sourceUrl: string
  confidence: number
  hard: boolean
  volatile: boolean
}

export interface Distillation {
  facts: DistilledFact[]
  insufficient: boolean
  reason: string
}

/** 宽容解析：提取首个 JSON 对象；字段级校验，坏条目丢弃而非整体失败。 */
export function parseDistillation(text: string): Distillation | undefined {
  const match = String(text ?? '').match(/\{[\s\S]*\}/)
  if (!match) return undefined
  try {
    const parsed = JSON.parse(match[0]) as { facts?: unknown, insufficient?: unknown, reason?: unknown }
    const facts: DistilledFact[] = []
    if (Array.isArray(parsed.facts)) {
      for (const item of parsed.facts) {
        const fact = item as Record<string, unknown>
        const text = String(fact?.text ?? '').trim()
        const sourceUrl = String(fact?.sourceUrl ?? '').trim()
        if (!text || text.length > 160) continue
        facts.push({
          text: text.slice(0, 160),
          sourceUrl: /^https?:\/\//.test(sourceUrl) ? sourceUrl : '',
          confidence: Math.max(0, Math.min(1, Number(fact?.confidence) || 0)),
          hard: fact?.hard === true,
          volatile: fact?.volatile === true,
        })
      }
    }
    return {
      facts: facts.slice(0, 5),
      insufficient: parsed.insufficient === true,
      reason: String(parsed.reason ?? '').slice(0, 200),
    }
  } catch {
    return undefined
  }
}

export function parseRewrite(text: string): string[] | undefined {
  const match = String(text ?? '').match(/\{[\s\S]*\}/)
  if (!match) return undefined
  try {
    const parsed = JSON.parse(match[0]) as { queries?: unknown }
    if (!Array.isArray(parsed.queries)) return undefined
    const queries = parsed.queries.map(item => String(item ?? '').trim()).filter(Boolean)
    return queries.length ? queries : undefined
  } catch {
    return undefined
  }
}
