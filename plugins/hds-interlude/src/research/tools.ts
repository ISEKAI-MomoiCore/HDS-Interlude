/**
 * 考据工具注册表（P2）：检索/抓取后端注册进一个 Cordis 服务，编排循环
 * （runner）只面向注册表编程——P3 的 MCP search 适配器或 puppeteer 抓取
 * 回退可直接 register，不改循环。内置后端在构造时注册；带查询级 TTL
 * 缓存（同查询 30 分钟内零网络调用）。
 */
import { Context, Service } from 'koishi'
import { SearchBackendOptions, SearchHit, PageText, ResearchHttpClient, fetchPageText, webSearch } from './search'
import { createHash } from 'node:crypto'
import { effectiveSearchBackend, ResearchConfig } from './desk'

/** 可插拔检索后端的最小接口。id 与 Console 的 searchBackend 取值对应。 */
export interface ResearchSearchBackend {
  id: 'tavily' | 'bocha' | 'searxng' | 'duckduckgo-html' | string
  search(http: ResearchHttpClient, options: SearchBackendOptions, query: string, forceFresh?: boolean): Promise<SearchHit[]>
}

/** 可插拔抓取器：按注册顺序尝试，首个返回非空文本者胜；全空则该来源不可读。 */
export interface ResearchFetchTool {
  id: string
  fetch(http: ResearchHttpClient, url: string, maxCharacters: number): Promise<PageText | undefined>
}

declare module 'koishi' {
  interface Context {
    researchTools: ResearchToolRegistry
  }
}

/** 查询级结果缓存：查询词哈希 → 命中列表 + 过期时刻；容量上限内淘汰最旧。 */
export class SearchCache {
  private readonly entries = new Map<string, { hits: SearchHit[], until: number }>()
  readonly counters = { hits: 0, misses: 0, evictions: 0 }

  constructor(private readonly capacity = 100, private readonly ttlMs = 30 * 60_000) {}

  private key(query: string) {
    return createHash('sha256').update(String(query ?? '').trim().toLowerCase()).digest('hex').slice(0, 16)
  }

  get(query: string, now: number): SearchHit[] | undefined {
    const key = this.key(query)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.until <= now) {
      this.entries.delete(key)
      return undefined
    }
    // 重新插入维持 LRU 顺序（淘汰最久未用）。
    this.entries.delete(key)
    this.entries.set(key, entry)
    this.counters.hits += 1
    return entry.hits
  }

  set(query: string, hits: SearchHit[], now: number) {
    if (!hits.length) return
    const key = this.key(query)
    this.entries.delete(key)
    this.entries.set(key, { hits, until: now + this.ttlMs })
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
      this.counters.evictions += 1
    }
    this.counters.misses += 1
  }

  get size() { return this.entries.size }
}

export class ResearchToolRegistry extends Service {
  private readonly searchBackends = new Map<string, ResearchSearchBackend>()
  private readonly fetchTools: ResearchFetchTool[] = []
  readonly searchCache = new SearchCache()

  static readonly inject: readonly string[] = []

  constructor(ctx: Context) {
    super(ctx, 'researchTools')
    // 内置后端：实现来自 search.ts 的单函数派发，拆成四个注册项便于逐个替换。
    for (const id of ['tavily', 'bocha', 'searxng', 'duckduckgo-html'] as const) {
      this.registerSearch({
        id,
        search: (http, options, query) => {
          if (options.backend !== id) {
            return webSearch(http, { ...options, backend: id }, query)
          }
          return webSearch(http, options, query)
        },
      })
    }
    this.registerFetch({
      id: 'http',
      fetch: (http, url, maxCharacters) => fetchPageText(http, url, maxCharacters),
    })
  }

  /** 注册/替换一个检索后端；同 id 后注册者胜（MCP 适配器可整替 duckduckgo-html）。 */
  registerSearch(backend: ResearchSearchBackend): this {
    this.searchBackends.set(backend.id, backend)
    return this
  }

  /** 注册抓取器；顺序敏感——后注册者插队到最前（专用回退优先于内置 http）。 */
  registerFetch(tool: ResearchFetchTool): this {
    this.fetchTools.unshift(tool)
    return this
  }

  /** 检索入口：配置解析后端 → 注册表查找 → 缺失回退 DDG；查询级 TTL 缓存。
   * forceFresh（审计修复 #3）：证据不足的二轮检索绕过缓存读（仍回写缓存），
   * 否则同词二轮只会拿到与一轮完全相同的结果，追加机制空转。 */
  async search(config: ResearchConfig, http: ResearchHttpClient, query: string, now = Date.now(), forceFresh = false): Promise<SearchHit[]> {
    if (!forceFresh) {
      const cached = this.searchCache.get(query, now)
      if (cached) return cached
    }
    const backendId = effectiveSearchBackend(config)
    const backend = this.searchBackends.get(backendId) ?? this.searchBackends.get('duckduckgo-html')
    if (!backend) return []
    const hits = await backend.search(http, { backend: backendId as SearchBackendOptions['backend'], apiKey: config.searchApiKey, searxngBaseUrl: config.searxngBaseUrl }, query, forceFresh)
    this.searchCache.set(query, hits, now)
    return hits
  }

  /** 抓取入口：按注册顺序尝试，首个成功者胜。 */
  async fetch(http: ResearchHttpClient, url: string, maxCharacters = 2_500): Promise<PageText | undefined> {
    for (const tool of this.fetchTools) {
      const page = await tool.fetch(http, url, maxCharacters)
      if (page) return page
    }
    return undefined
  }

  get registeredSearchIds(): string[] {
    return [...this.searchBackends.keys()]
  }

  get registeredFetchIds(): string[] {
    return this.fetchTools.map(tool => tool.id)
  }
}
