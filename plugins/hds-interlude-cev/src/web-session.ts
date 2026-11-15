/**
 * 网页探索会话：Web Explore Session（cev 路线图 #WebExplore）
 *
 * 设计文档：docs/WEB_EXPLORE_IMPLEMENTATION.md
 * 把她从"提出浏览意图、等一轮拿到文本快照"升级为持续探索一个网页会话——
 * 翻页、点编号链接、后退、信息够了自然合上。轨迹在会话关闭时沉淀为
 * WebObservation（mode='explore'），成为正式剧本证据。
 *
 * 本文件全部是纯函数/纯类型，不依赖 Koishi 或 Puppeteer。
 */

import { randomUUID } from 'node:crypto'

/** 每屏正文字符数（YesImBot 同款 2600——手机上的阅读节奏）。 */
export const WEB_SCREEN_CHARS = 2600

/** 快照内链接/图片上限（提取时即截断，防超长列表占据上下文）。 */
export const WEB_SNAPSHOT_MAX_LINKS = 30
export const WEB_SNAPSHOT_MAX_IMAGES = 10

/** 页面快照：一次 page.evaluate 提取的完整可导航结构。 */
export interface WebPageSnapshot {
  url: string
  title: string
  /** 全部正文（已截到 maxTextCharacters），注入时按屏切分。 */
  fullText: string
  /** 编号链接清单（[n] 对应清单里的 n）。 */
  links: Array<{ n: number; url: string; text: string }>
  /** 编号图片清单（{图n} 对应清单里的 n）。 */
  images: Array<{ n: number; url: string; alt: string }>
  /** 页面元描述（首屏时给，翻屏后省略）。 */
  description: string
  capturedAt: string
}

/** 探索会话：她当前开着的浏览器上下文（内存态，进程重启即失）。 */
export interface WebExploreSession {
  sessionId: string
  storyId: string
  /** 归属关系分支——轨迹入库时写此 participantId。 */
  participantId: string
  /** 当前页面状态。 */
  current: {
    url: string
    snapshot: WebPageSnapshot
    /** 0-based 屏号。 */
    screenIndex: number
    totalScreens: number
  }
  /** 导航历史（可后退，不含当前页）。 */
  history: Array<{ url: string; title: string }>
  /** 探索轨迹（全部快照，关闭时入库；上限 exploreMaxTrailPages）。 */
  trail: WebPageSnapshot[]
  /** 会话初始搜索词（visit 打开时为空）。 */
  initialQuery: string
  openedAt: string
  lastActiveAt: string
}

/** 叙事模型可产出的探索动作（BrowserIntentDraft.mode 的扩展值）。 */
export type WebExploreAction =
  | { kind: 'open-link'; n: number }
  | { kind: 'scroll-down' }
  | { kind: 'back' }
  | { kind: 'close' }

/** 计算快照正文总分屏数（至少 1 屏，空文本也是 1 屏）。 */
export function totalScreensOf(snapshot: Pick<WebPageSnapshot, 'fullText'>): number {
  const text = String(snapshot.fullText ?? '')
  if (!text) return 1
  return Math.max(1, Math.ceil(text.length / WEB_SCREEN_CHARS))
}

/** 取快照第 N 屏的正文切片（越界返回空串，末屏为剩余全部）。 */
export function screenTextOf(snapshot: Pick<WebPageSnapshot, 'fullText'>, screenIndex: number): string {
  if (screenIndex < 0) return ''
  const text = String(snapshot.fullText ?? '')
  if (!text) return screenIndex === 0 ? '' : ''
  return text.slice(screenIndex * WEB_SCREEN_CHARS, (screenIndex + 1) * WEB_SCREEN_CHARS)
}

/** page.evaluate 的返回结构（captureWebSnapshot 在 service 侧接收）。 */
export interface WebPageEvaluateResult {
  title: string
  fullText: string
  links: Array<{ n: number; url: string; text: string }>
  images: Array<{ n: number; url: string; alt: string }>
  description: string
  url: string
}

/**
 * 在 page.evaluate 里执行的提取逻辑（无外部依赖，返回原始结构）。
 * 作为字符串传给 Puppeteer——这里保留为可读模板，service 侧序列化注入。
 *
 * 设计决策：链接/图片不往正文里插 [n] 标注（innerText 提取后不可逆插入），
 * 改为清单附加在 sessionContextText 末尾，模型看清单选编号效果等同。
 */
export const WEB_SNAPSHOT_EVALUATE_SOURCE = `(() => {
  const clean = (value, max = 160) => String(value == null ? '' : value).replace(/\\s+/g, ' ').trim().slice(0, max)
  const fullText = String(document.body && document.body.innerText || '').replace(/\\r/g, '').replace(/\\n{3,}/g, '\\n\\n').trim()
  const links = []
  let linkN = 0
  for (const anchor of document.querySelectorAll('a[href]')) {
    if (linkN >= ${WEB_SNAPSHOT_MAX_LINKS}) break
    const box = anchor.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) continue
    const url = String(anchor.href == null ? '' : anchor.href)
    if (!/^https?:/i.test(url)) continue
    linkN += 1
    links.push({ n: linkN, url, text: clean(anchor.textContent) || clean(url) })
  }
  const images = []
  let imageN = 0
  for (const img of document.images) {
    if (imageN >= ${WEB_SNAPSHOT_MAX_IMAGES}) break
    if (img.naturalWidth <= 40 || img.naturalHeight <= 40) continue
    const box = img.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) continue
    imageN += 1
    images.push({ n: imageN, url: String(img.currentSrc || img.src), alt: clean(img.alt) })
  }
  const description = clean(document.querySelector('meta[name="description"], meta[property="og:description"]') && document.querySelector('meta[name="description"], meta[property="og:description"]').getAttribute('content'), 500)
  return { title: clean(document.title, 500), fullText, links, images, description, url: location.href }
})()`

/** 从 evaluate 原始返回构造快照（截断到 maxTextChars，补 capturedAt）。 */
export function toWebPageSnapshot(raw: Partial<WebPageEvaluateResult> | undefined | null, maxTextChars: number): WebPageSnapshot {
  const source = raw ?? {}
  const fullText = clip(String(source.fullText ?? ''), Math.max(500, maxTextChars))
  const links = Array.isArray(source.links)
    ? source.links
        .filter((link): link is { n: number; url: string; text: string } => !!link && Number.isInteger(link.n) && link.n > 0 && typeof link.url === 'string')
        .slice(0, WEB_SNAPSHOT_MAX_LINKS)
        .map(link => ({ n: link.n, url: clip(link.url, 2_000), text: clip(link.text ?? '', 120) }))
    : []
  const images = Array.isArray(source.images)
    ? source.images
        .filter((image): image is { n: number; url: string; alt: string } => !!image && Number.isInteger(image.n) && image.n > 0 && typeof image.url === 'string')
        .slice(0, WEB_SNAPSHOT_MAX_IMAGES)
        .map(image => ({ n: image.n, url: clip(image.url, 2_000), alt: clip(image.alt ?? '', 100) }))
    : []
  return {
    url: clip(String(source.url ?? ''), 2_000),
    title: clip(String(source.title ?? ''), 500),
    fullText,
    links,
    images,
    description: clip(String(source.description ?? ''), 500),
    capturedAt: new Date().toISOString(),
  }
}

/** 构造新会话。 */
export function openWebExploreSession(input: {
  storyId: string
  participantId: string
  snapshot: WebPageSnapshot
  initialQuery?: string
}): WebExploreSession {
  const now = new Date().toISOString()
  return {
    sessionId: `web-${randomUUID()}`,
    storyId: input.storyId,
    participantId: input.participantId,
    current: {
      url: input.snapshot.url,
      snapshot: input.snapshot,
      screenIndex: 0,
      totalScreens: totalScreensOf(input.snapshot),
    },
    history: [],
    trail: [input.snapshot],
    initialQuery: clip(String(input.initialQuery ?? ''), 500),
    openedAt: now,
    lastActiveAt: now,
  }
}

/** 点编号链接：校验 n 在快照链接清单范围内，返回目标 URL（无会话或超范围返回 undefined）。 */
export function exploreLinkTarget(session: WebExploreSession | undefined, n: number): string | undefined {
  if (!session || !Number.isInteger(n) || n <= 0) return undefined
  const link = session.current.snapshot.links.find(item => item.n === n)
  return link?.url
}

/** 翻屏：返回新屏号（到底时返回 undefined 表示无法继续翻）。 */
export function exploreScroll(session: WebExploreSession | undefined): number | undefined {
  if (!session) return undefined
  const next = session.current.screenIndex + 1
  return next < session.current.totalScreens ? next : undefined
}

/** 后退：返回历史栈顶（空时 undefined）。不修改会话——调用方负责推进。 */
export function exploreBackTarget(session: WebExploreSession | undefined): { url: string; title: string } | undefined {
  if (!session || !session.history.length) return undefined
  return session.history[session.history.length - 1]
}

/** 会话快照切换（点链接/后退后加载新页面）。 */
export function advanceWebExploreSession(
  session: WebExploreSession,
  snapshot: WebPageSnapshot,
  options: { pushHistory: boolean, maxTrailPages: number },
): WebExploreSession {
  const history = options.pushHistory
    ? [...session.history, { url: session.current.url, title: session.current.snapshot.title }].slice(-10)
    : session.history
  const trail = [...session.trail, snapshot].slice(-Math.max(1, options.maxTrailPages))
  return {
    ...session,
    current: {
      url: snapshot.url,
      snapshot,
      screenIndex: 0,
      totalScreens: totalScreensOf(snapshot),
    },
    history,
    trail,
    lastActiveAt: new Date().toISOString(),
  }
}

/** 会话是否已超时（无活动超过 timeoutMs）。 */
export function webExploreExpired(session: WebExploreSession, now: Date, timeoutMs: number): boolean {
  return now.getTime() - new Date(session.lastActiveAt).getTime() > timeoutMs
}

/** 关闭时的轨迹汇总 observation 输入。 */
export interface WebExploreTrailSummary {
  mode: 'explore'
  query: string
  url: string
  title: string
  excerpt: string
  summary: string
}

/** 轨迹→observation 汇总（不直接写库——调用方走 saveWebObservation）。 */
export function webExploreTrailToObservation(session: WebExploreSession, maxExcerptChars: number): WebExploreTrailSummary {
  const pages = session.trail.length
  const lastPage = session.trail[session.trail.length - 1]
  const titles = session.trail.map((snapshot, index) => `${index + 1}. ${snapshot.title || snapshot.url}`).join(' → ')
  const summary = `她在 ${session.openedAt.slice(11, 19)} 开始${session.initialQuery ? `搜索"${session.initialQuery}"` : '浏览'}，访问了 ${pages} 页：${titles}。最后停留在"${lastPage?.title ?? ''}"。`
  const excerpt = clip(
    session.trail
      .map((snapshot, index) => `[第${index + 1}页 ${snapshot.title || snapshot.url}]\n${clip(snapshot.fullText, 300)}`)
      .join('\n\n'),
    maxExcerptChars,
  )
  return {
    mode: 'explore',
    query: session.initialQuery,
    url: lastPage?.url ?? session.current.url,
    title: lastPage?.title ?? '',
    excerpt,
    summary: clip(summary, maxExcerptChars),
  }
}

/**
 * 会话的叙事化上下文文本——注入 narrator 的 webExplore 字段。
 * 当前屏 + 编号链接清单 + 编号图片清单 + 可用动作提示。
 */
export function sessionContextText(session: WebExploreSession): string {
  const lines: string[] = []
  const isCurrentFirstScreen = session.current.screenIndex === 0
  lines.push(`[网页探索·进行中] 她正开着浏览器，停留在"${session.current.snapshot.title || session.current.snapshot.url}"（第 ${session.current.screenIndex + 1}/${session.current.totalScreens} 屏）。`)
  if (isCurrentFirstScreen && session.current.snapshot.description) {
    lines.push(`页面描述：${session.current.snapshot.description}`)
  }
  lines.push('当前屏内容：')
  lines.push(screenTextOf(session.current.snapshot, session.current.screenIndex) || '（空白屏）')
  if (session.current.snapshot.links.length) {
    lines.push(`可点链接：${session.current.snapshot.links.map(link => `[${link.n}] ${link.text}`).join(' ')}`)
  }
  if (session.current.snapshot.images.length) {
    lines.push(`页面图片：${session.current.snapshot.images.map(image => `{图${image.n}} ${image.alt || '（无描述）'}`).join(' ')}`)
  }
  lines.push('可用动作：browserIntents 里用 mode=explore-open-link(linkN=n) 点链接、explore-scroll 翻下一屏、explore-back 后退、explore-close 合上浏览器。信息足够时可不产出任何动作。')
  return lines.join('\n')
}

function clip(value: string, max: number) {
  const text = String(value ?? '')
  return text.length > max ? text.slice(0, max) : text
}
