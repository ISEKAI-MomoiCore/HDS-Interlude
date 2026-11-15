/**
 * cev WebExplore 服务层测试：会话生命周期、编号校验、会话互斥、超时清理、
 * 意图路由与向后兼容（exploreEnabled=false 走旧一次性浏览）。
 * 通过 InterludeService.prototype + 假 this 复用真实方法体（同 qq-face 测试模式）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { InterludeService } from '../src/service'
import type { WebPageSnapshot } from '../src/web-session'

const proto = InterludeService.prototype as any
const story: any = { id: 'story-1' }

function pageSnapshot(url: string, title: string, fullText = 'X'.repeat(6_000), links: Array<{ n: number; url: string; text: string }> = []): WebPageSnapshot {
  return { url, title, fullText, links, images: [], description: '', capturedAt: '2026-09-30T10:00:00.000Z' }
}

interface Harness {
  service: any
  saved: any[]
  logs: string[]
  legacyCalls: any[][]
  completedIntents: any[]
  capturesTaken: () => number
}

function exploreService(options: { exploreEnabled?: boolean; captures?: WebPageSnapshot[] } = {}): Harness {
  const saved: any[] = []
  const logs: string[] = []
  const legacyCalls: any[][] = []
  const completedIntents: any[] = []
  const captures = options.captures ?? [pageSnapshot('https://example.test/fallback', '兜底页')]
  let captureIndex = 0
  // 继承真实原型：被测方法内部 this.closeWebExplore / this.openWebExplore 等
  // 互调走真实实现，依赖（快照/入库/日志）用自有属性遮蔽；browserConfig 是
  // 原型 getter，只能 defineProperty 遮蔽。
  const service: any = Object.create(InterludeService.prototype)
  Object.assign(service, {
    ctx: { puppeteer: { page: async () => ({}) } },
    activeWebExplore: new Map(),
    withBrowserSlot: async (task: () => Promise<unknown>) => task(),
    captureWebSnapshot: async () => captures[Math.min(captureIndex++, captures.length - 1)],
    saveWebObservation: async (storyId: string, participantId: string, intentId: number | null, mode: string, query: string, url: string, title: string, excerpt: string, summary: string, status: string) => {
      const record = { storyId, participantId, intentId, mode, query, url, title, excerpt, summary, status }
      saved.push(record)
      return { id: saved.length, ...record, accessedAt: new Date(), createdAt: new Date() }
    },
    collectWebObservation: async (...args: unknown[]) => { legacyCalls.push(args); return { id: 1, status: 'success' } },
    dbSet: async (_table: string, query: any, patch: any) => { if (query?.id) completedIntents.push({ id: query.id, patch }) },
    report: (level: string, _story: unknown, _phase: string, message: string) => { logs.push(`${level} ${message}`) },
    reportOperation: (_verbosity: string, level: string, _story: unknown, _phase: string, message: string) => { logs.push(`${level} ${message}`) },
    reportStandalone: (level: string, message: string) => { logs.push(`${level} ${message}`) },
    reportStandaloneOperation: (_verbosity: string, level: string, message: string) => { logs.push(`${level} ${message}`) },
  })
  Object.defineProperty(service, 'browserConfig', {
    value: {
      enabled: true, mode: 'deferred-only', allowSearch: true, allowVisit: true,
      searchUrlTemplate: 'https://html.duckduckgo.com/html/?q={query}',
      allowedDomains: [], blockedDomains: [], maxConcurrentPages: 1, maxResearchPerSweep: 1,
      navigationTimeout: 15_000, waitUntil: 'domcontentloaded', maxTextCharacters: 12_000,
      maxExcerptCharacters: 3_000, maxObservationsInPrompt: 4, cacheMinutes: 30,
      allowGroupTriggeredResearch: false, logObservationPreview: false,
      exploreEnabled: options.exploreEnabled ?? true, exploreSessionTimeoutMinutes: 5, exploreMaxTrailPages: 8,
    },
  })
  return { service, saved, logs, legacyCalls, completedIntents, capturesTaken: () => captureIndex }
}

test('探索会话生命周期：开页→翻屏→点链接→关闭入库', async () => {
  const first = pageSnapshot('https://example.test/weather', '天气页', 'A'.repeat(6_000), [
    { n: 1, url: 'https://example.test/tomorrow', text: '明天天气' },
  ])
  const second = pageSnapshot('https://example.test/tomorrow', '明天天气页', 'B'.repeat(1_000))
  const harness = exploreService({ captures: [first, second] })
  const now = new Date('2026-09-30T10:00:00Z')

  const session = await proto.openWebExplore.call(harness.service, story, 'p1', { kind: 'visit', url: 'https://example.test/weather' }, now)
  assert.ok(session, '会话应创建成功')
  assert.equal(session.current.screenIndex, 0)
  assert.equal(session.current.totalScreens, Math.ceil(6_000 / 2_600), '6000 字按 2600/屏分屏')
  assert.equal(harness.service.activeWebExplore.get('story-1'), session)

  const scrolled = await proto.applyWebExploreAction.call(harness.service, story, { kind: 'scroll-down' }, now)
  assert.equal(scrolled.current.screenIndex, 1)
  const bottom = await proto.applyWebExploreAction.call(harness.service, story, { kind: 'scroll-down' }, now)
  assert.equal(bottom.current.screenIndex, 2)
  const pastEnd = await proto.applyWebExploreAction.call(harness.service, story, { kind: 'scroll-down' }, now)
  assert.equal(pastEnd.current.screenIndex, 2, '末屏后再翻保持原屏')

  const jumped = await proto.applyWebExploreAction.call(harness.service, story, { kind: 'open-link', n: 1 }, now)
  assert.equal(jumped.current.url, 'https://example.test/tomorrow')
  assert.equal(jumped.current.screenIndex, 0, '点链接后回到新页首屏')
  assert.equal(jumped.history.length, 1, '原页进入历史栈')
  assert.equal(jumped.trail.length, 2, '轨迹累计两页')

  await proto.closeWebExplore.call(harness.service, 'story-1', 'test', now)
  assert.equal(harness.service.activeWebExplore.size, 0, '关闭后 Map 清空')
  assert.equal(harness.saved.length, 1)
  assert.equal(harness.saved[0].mode, 'explore', '轨迹以 explore 模式入库')
  assert.equal(harness.saved[0].url, 'https://example.test/tomorrow', '入库 URL 为最后停留页')
  assert.match(harness.saved[0].summary, /访问了 2 页/, '汇总含访问页数')
})

test('点链接编号超范围：停留原页并告警，不消耗浏览', async () => {
  const first = pageSnapshot('https://example.test/a', '页面A', 'A'.repeat(1_000), [
    { n: 1, url: 'https://example.test/1', text: '链接一' },
  ])
  const harness = exploreService({ captures: [first] })
  const now = new Date()
  await proto.openWebExplore.call(harness.service, story, 'p1', { kind: 'visit', url: 'https://example.test/a' }, now)
  const takenBefore = harness.capturesTaken()

  const result = await proto.applyWebExploreAction.call(harness.service, story, { kind: 'open-link', n: 99 }, now)
  assert.equal(result.current.url, 'https://example.test/a', '编号超范围停留原页')
  assert.equal(harness.capturesTaken(), takenBefore, '没有发起真实页面加载')
  assert.ok(harness.logs.some(line => line.includes('不在当前页链接清单内')), '记录告警')
  assert.equal(harness.saved.length, 0, '不产生入库')
})

test('会话互斥：重复 open 先把旧轨迹入库再开新会话', async () => {
  const first = pageSnapshot('https://example.test/a', '旧页', 'A'.repeat(500))
  const second = pageSnapshot('https://example.test/b', '新页', 'B'.repeat(500))
  const harness = exploreService({ captures: [first, second] })
  const now = new Date()

  await proto.openWebExplore.call(harness.service, story, 'p1', { kind: 'visit', url: 'https://example.test/a' }, now)
  const reopened = await proto.openWebExplore.call(harness.service, story, 'p1', { kind: 'visit', url: 'https://example.test/b' }, now)
  assert.equal(reopened.current.url, 'https://example.test/b')
  assert.equal(harness.saved.length, 1, '旧会话轨迹在重开时入库一次')
  assert.equal(harness.saved[0].mode, 'explore')
  assert.equal(harness.saved[0].url, 'https://example.test/a', '入库的是被替换的旧会话')
  assert.equal(harness.service.activeWebExplore.size, 1, '仍只有一个会话')
})

test('超时清理：无活动的会话被关闭入库', async () => {
  const harness = exploreService({ captures: [pageSnapshot('https://example.test/a', '页面', 'A'.repeat(500))] })
  const now = new Date()
  await proto.openWebExplore.call(harness.service, story, 'p1', { kind: 'visit', url: 'https://example.test/a' }, now)

  // 5 分钟超时；把会话标记为 6 分钟前活动。
  const session = harness.service.activeWebExplore.get('story-1')
  session.lastActiveAt = new Date(now.getTime() - 6 * 60_000).toISOString()
  proto.webExploreSweepTimeout.call(harness.service, now)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(harness.service.activeWebExplore.size, 0, '过期会话被清理')
  assert.equal(harness.saved.length, 1, '清理时轨迹入库')
  assert.ok(harness.logs.some(line => line.includes('网页探索会话已关闭')), '记录关闭原因')

  // 未过期会话保持不动。
  await proto.openWebExplore.call(harness.service, story, 'p1', { kind: 'visit', url: 'https://example.test/a' }, now)
  proto.webExploreSweepTimeout.call(harness.service, now)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(harness.service.activeWebExplore.size, 1, '活跃会话不被清理')
})

test('意图路由：exploreEnabled 时 explore-* 与 search/visit 都走会话路径', async () => {
  const page = pageSnapshot('https://example.test/a', '页面', 'A'.repeat(3_000), [{ n: 1, url: 'https://example.test/1', text: '链接' }])
  const harness = exploreService({ captures: [page] })
  const now = new Date()

  await proto.executeDeferredBrowserIntent.call(harness.service, story, { id: 11, participantId: 'p1', payload: { mode: 'visit', url: 'https://example.test/a', purpose: '查资料' } }, now)
  assert.equal(harness.legacyCalls.length, 0, '开启探索后 visit 不再走一次性浏览')
  assert.ok(harness.service.activeWebExplore.has('story-1'), 'visit 升级为开会话')
  assert.deepEqual(harness.completedIntents.map(item => item.id), [11], '意图完成后出账')

  await proto.executeDeferredBrowserIntent.call(harness.service, story, { id: 12, participantId: 'p1', payload: { mode: 'explore-scroll', purpose: '继续读' } }, now)
  assert.equal(harness.service.activeWebExplore.get('story-1').current.screenIndex, 1, 'explore-scroll 作用于会话')

  await proto.executeDeferredBrowserIntent.call(harness.service, story, { id: 13, participantId: 'p1', payload: { mode: 'explore-open-link', linkN: 1, purpose: '点开链接' } }, now)
  assert.equal(harness.service.activeWebExplore.get('story-1').current.screenIndex, 0, 'explore-open-link 载入新页首屏')

  await proto.executeDeferredBrowserIntent.call(harness.service, story, { id: 14, participantId: 'p1', payload: { mode: 'explore-close', purpose: '看完了' } }, now)
  assert.equal(harness.service.activeWebExplore.size, 0, 'explore-close 合上会话')
  assert.equal(harness.saved.length, 1, '关闭时轨迹入库')
  assert.deepEqual(harness.completedIntents.map(item => item.id), [11, 12, 13, 14])
})

test('向后兼容：exploreEnabled=false 时 visit 保持旧一次性浏览', async () => {
  const harness = exploreService({ exploreEnabled: false, captures: [pageSnapshot('https://example.test/a', '页面')] })
  const now = new Date()

  await proto.executeDeferredBrowserIntent.call(harness.service, story, { id: 21, participantId: 'p1', payload: { mode: 'visit', url: 'https://example.test/a', purpose: '查资料' } }, now)
  assert.equal(harness.legacyCalls.length, 1, '关闭探索时走 collectWebObservation')
  assert.equal(harness.service.activeWebExplore.size, 0, '不产生会话')
  assert.equal(harness.completedIntents.length, 1, '意图照常完成')
})
