/**
 * 考据 Agent 检索栈：API 优先（设计 v2）。搜索走可配置后端
 * （Tavily/博查/SearXNG，DuckDuckGo HTML 为零配置回退），页面访问用
 * 纯 HTTP 拉取 + HTML→文本（undici/cordis http，无浏览器依赖）。
 * puppeteer 仅作为 JS 重页面的可选回退，由宿主决定，不在本模块内。
 */

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

/** 结构化 HTTP 客户端（cordis ctx.http 的最小形态，便于测试注入）。 */
export interface ResearchHttpClient {
  get(url: string, options?: Record<string, unknown>): Promise<unknown>
  post(url: string, body: unknown, options?: Record<string, unknown>): Promise<unknown>
}

export interface SearchBackendOptions {
  backend: 'tavily' | 'bocha' | 'searxng' | 'duckduckgo-html'
  apiKey: string
  searxngBaseUrl: string
  timeoutMs?: number
}

const DDG_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/'

/** 单查询检索；后端失败返回空数组（考据失败永不阻塞叙事）。 */
export async function webSearch(http: ResearchHttpClient, options: SearchBackendOptions, query: string): Promise<SearchHit[]> {
  const timeout = { timeout: options.timeoutMs ?? 12_000 }
  try {
    if (options.backend === 'tavily') {
      const response = await http.post('https://api.tavily.com/search', {
        api_key: options.apiKey, query, max_results: 6, search_depth: 'basic',
      }, { ...timeout, headers: { 'content-type': 'application/json' } }) as { results?: Array<{ title?: string, url?: string, content?: string }> }
      return (response?.results ?? []).map(item => ({
        title: String(item?.title ?? ''), url: String(item?.url ?? ''), snippet: String(item?.content ?? ''),
      })).filter(hit => hit.url)
    }
    if (options.backend === 'bocha') {
      const response = await http.post('https://api.bochaai.com/v1/web-search', { query, summary: true, count: 6 },
        { ...timeout, headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` } }) as { data?: { webPages?: { value?: Array<{ name?: string, url?: string, snippet?: string }> } } }
      return (response?.data?.webPages?.value ?? []).map(item => ({
        title: String(item?.name ?? ''), url: String(item?.url ?? ''), snippet: String(item?.snippet ?? ''),
      })).filter(hit => hit.url)
    }
    if (options.backend === 'searxng') {
      const response = await http.get(`${options.searxngBaseUrl}/search`, {
        ...timeout, params: { q: query, format: 'json' },
      }) as { results?: Array<{ title?: string, url?: string, content?: string }> }
      return (response?.results ?? []).slice(0, 6).map(item => ({
        title: String(item?.title ?? ''), url: String(item?.url ?? ''), snippet: String(item?.content ?? ''),
      })).filter(hit => hit.url)
    }
    const html = await http.get(DDG_HTML_ENDPOINT, {
      ...timeout,
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      params: { q: query },
    })
    return parseDuckDuckGoHtml(String(html ?? ''))
  } catch {
    return []
  }
}

/** DDG 轻量结果页解析：result__a 链接 + result__snippet 摘要；
 * 兼容 //duckduckgo.com/l/?uddg= 跳转包装。无 DOM 依赖（正则），零配置回退专用。 */
export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  const block = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(block)) {
    const url = unwrapDdgRedirect(decodeHtmlEntities(match[1]))
    const title = stripTags(match[2])
    if (!url || !title) continue
    hits.push({ title, url, snippet: '' })
  }
  const snippet = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g
  let index = 0
  for (const match of html.matchAll(snippet)) {
    if (index >= hits.length) break
    hits[index].snippet = stripTags(match[1])
    index += 1
  }
  return dedupeHits(hits).slice(0, 6)
}

function unwrapDdgRedirect(href: string): string {
  if (!href.startsWith('//duckduckgo.com/l/')) return href
  const encoded = /[?&]uddg=([^&]+)/.exec(href)?.[1]
  return encoded ? decodeURIComponent(encoded) : ''
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

function stripTags(text: string): string {
  return decodeHtmlEntities(String(text ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>()
  return hits.filter(hit => {
    if (seen.has(hit.url)) return false
    seen.add(hit.url)
    return true
  })
}

// ── 页面访问（HTTP 优先，替代浏览器渲染） ─────────────────────────────────

export interface PageText {
  title: string
  text: string
  url: string
}

/** 拉取公开页面并抽取正文文本（标题 + 去标签正文，字符预算截断）。
 * 仅 http(s)；失败/超时/非文本返回 undefined——来源不可读就跳过。 */
export async function fetchPageText(http: ResearchHttpClient, url: string, maxCharacters = 2_500, timeoutMs = 12_000): Promise<PageText | undefined> {
  try {
    const body = await http.get(url, {
      timeout: timeoutMs,
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', accept: 'text/html,application/xhtml+xml,text/plain' },
      responseType: 'text',
    })
    const html = String(body ?? '')
    if (!html || html.length > 2 * 1024 * 1024) return undefined
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''
    const text = extractReadableText(html).slice(0, maxCharacters)
    if (text.length < 80) return undefined
    return { title: stripTags(title).slice(0, 120), text, url }
  } catch {
    return undefined
  }
}

/** 粗粒度正文抽取：去 script/style/nav 头部等噪音块后取文本。
 * 考据事实（片长/时长/路线）多在正文表格与段落，宁可粗一点也不引 DOM 依赖。 */
export function extractReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:nav|header|footer|aside|form)[\s\S]*?<\/(?:nav|header|footer|aside|form)>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** 程序化预排序：标题与主题词的重叠度 + 简单域名信任加分。
 * 零 LLM 成本地把 top-k 送进蒸馏。 */
export function rankHits(hits: SearchHit[], topic: string, limit = 5): SearchHit[] {
  const terms = normalizeTerms(topic)
  const scored = hits.map(hit => {
    const titleTerms = normalizeTerms(hit.title)
    let score = 0
    for (const term of terms) if (titleTerms.includes(term)) score += 2
    for (const term of terms) if (normalizeTerms(hit.snippet).includes(term)) score += 1
    try { score += new URL(hit.url).hostname.endsWith('.wikipedia.org') ? 1 : 0 } catch { /* 非法 URL 不加分 */ }
    return { hit, score }
  })
  return scored.sort((left, right) => right.score - left.score).slice(0, limit).map(item => item.hit)
}

function normalizeTerms(text: string): string[] {
  return String(text ?? '').toLowerCase().split(/[\s,，。:：;；!！?？/\\|\-—·]+/).filter(term => term.length >= 2 && term.length <= 24)
}
