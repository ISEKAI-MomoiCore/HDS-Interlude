import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WEB_SCREEN_CHARS,
  totalScreensOf,
  screenTextOf,
  toWebPageSnapshot,
  openWebExploreSession,
  exploreLinkTarget,
  exploreScroll,
  exploreBackTarget,
  advanceWebExploreSession,
  webExploreExpired,
  webExploreTrailToObservation,
  sessionContextText,
  type WebPageSnapshot,
} from '../src/web-session'

function snapshot(overrides: Partial<WebPageSnapshot> = {}): WebPageSnapshot {
  return {
    url: 'https://example.test/page',
    title: '测试页面',
    fullText: 'A'.repeat(300),
    links: [
      { n: 1, url: 'https://example.test/1', text: '链接一' },
      { n: 2, url: 'https://example.test/2', text: '链接二' },
    ],
    images: [{ n: 1, url: 'https://example.test/img.png', alt: '示意图' }],
    description: '页面描述',
    capturedAt: '2026-10-06T10:00:00.000Z',
    ...overrides,
  }
}

test('分屏：fullText 按固定字符数切屏，空文本仍为 1 屏', () => {
  assert.equal(WEB_SCREEN_CHARS, 2600)
  assert.equal(totalScreensOf({ fullText: '' }), 1)
  assert.equal(totalScreensOf({ fullText: 'A'.repeat(2600) }), 1)
  assert.equal(totalScreensOf({ fullText: 'A'.repeat(2601) }), 2)
  assert.equal(totalScreensOf({ fullText: 'A'.repeat(7800) }), 3)
})

test('分屏：screenTextOf 返回对应切片，越界返回空串', () => {
  const text = '0123456789'.repeat(600) // 6000 字符
  assert.equal(screenTextOf({ fullText: text }, 0).length, 2600)
  assert.equal(screenTextOf({ fullText: text }, 1).length, 2600)
  assert.equal(screenTextOf({ fullText: text }, 2).length, 800)
  assert.equal(screenTextOf({ fullText: text }, 3), '')
  assert.equal(screenTextOf({ fullText: text }, -1), '')
})

test('快照构造：截断正文、过滤非法链接/图片、保留描述', () => {
  const raw = {
    title: '标题',
    fullText: 'B'.repeat(20_000),
    links: [
      { n: 1, url: 'https://ok.test/1', text: '有效' },
      { n: 0, url: 'https://bad.test/0', text: '编号无效' },
      { n: 2, url: 'javascript:alert(1)', text: '非 http 会被链接过滤器跳过？不——快照不过滤协议' },
      null,
    ],
    images: [
      { n: 1, url: 'https://ok.test/img', alt: '图' },
      { n: -1, url: 'https://bad.test/img', alt: '编号无效' },
    ],
    description: '描述',
    url: 'https://final.test',
  }
  const snap = toWebPageSnapshot(raw, 12_000)
  assert.equal(snap.fullText.length, 12_000)
  assert.equal(snap.url, 'https://final.test')
  // 编号无效的条目被过滤；协议过滤在 evaluate 侧（只收 http/https），快照层信任 evaluate
  assert.equal(snap.links.length, 2)
  assert.equal(snap.images.length, 1)
  assert.ok(snap.capturedAt)
})

test('会话生命周期：开→翻屏→点链接→后退→关', () => {
  const session = openWebExploreSession({ storyId: 's1', participantId: 'p1', snapshot: snapshot(), initialQuery: '天气' })
  assert.equal(session.current.screenIndex, 0)
  assert.equal(session.current.totalScreens, 1)
  assert.equal(session.trail.length, 1)
  assert.equal(session.initialQuery, '天气')

  // 翻屏：单屏到头
  assert.equal(exploreScroll(session), undefined)

  // 多屏快照翻屏
  const multi = openWebExploreSession({ storyId: 's1', participantId: 'p1', snapshot: snapshot({ fullText: 'C'.repeat(6000) }) })
  assert.equal(multi.current.totalScreens, 3)
  assert.equal(exploreScroll(multi), 1)
  const scrolled = { ...multi, current: { ...multi.current, screenIndex: 1 } }
  assert.equal(exploreScroll(scrolled), 2)
  assert.equal(exploreScroll({ ...scrolled, current: { ...scrolled.current, screenIndex: 2 } }), undefined)

  // 点链接：编号校验
  assert.equal(exploreLinkTarget(session, 1), 'https://example.test/1')
  assert.equal(exploreLinkTarget(session, 2), 'https://example.test/2')
  assert.equal(exploreLinkTarget(session, 3), undefined, '超范围')
  assert.equal(exploreLinkTarget(session, 0), undefined)
  assert.equal(exploreLinkTarget(undefined, 1), undefined)

  // 前进到新页面
  const page2 = snapshot({ url: 'https://example.test/1', title: '第二页' })
  const advanced = advanceWebExploreSession(session, page2, { pushHistory: true, maxTrailPages: 8 })
  assert.equal(advanced.current.url, 'https://example.test/1')
  assert.equal(advanced.current.screenIndex, 0, '新页面回到第一屏')
  assert.equal(advanced.history.length, 1)
  assert.equal(advanced.history[0].title, '测试页面')
  assert.equal(advanced.trail.length, 2)

  // 后退
  assert.deepEqual(exploreBackTarget(advanced), { url: 'https://example.test/page', title: '测试页面' })
  assert.equal(exploreBackTarget(session), undefined, '无历史')
})

test('轨迹上限：maxTrailPages 截断保留最新页', () => {
  let session = openWebExploreSession({ storyId: 's1', participantId: 'p1', snapshot: snapshot() })
  for (let index = 0; index < 5; index += 1) {
    session = advanceWebExploreSession(session, snapshot({ url: `https://p${index}.test`, title: `第${index + 2}页` }), { pushHistory: true, maxTrailPages: 3 })
  }
  assert.equal(session.trail.length, 3, '轨迹截到最新 3 页')
  assert.equal(session.trail[0].title, '第4页')
  assert.equal(session.trail[2].title, '第6页')
})

test('会话超时：lastActiveAt 超过 timeoutMs 判过期', () => {
  const session = openWebExploreSession({ storyId: 's1', participantId: 'p1', snapshot: snapshot() })
  const now = new Date()
  assert.equal(webExploreExpired(session, now, 60_000), false)
  assert.equal(webExploreExpired(session, new Date(now.getTime() + 61_000), 60_000), true)
})

test('轨迹入库汇总：含搜索词/页面数/标题链/最后停留页', () => {
  const session = openWebExploreSession({ storyId: 's1', participantId: 'p1', snapshot: snapshot({ title: '搜索结果' }), initialQuery: '上海天气' })
  const advanced = advanceWebExploreSession(session, snapshot({ url: 'https://weather.test', title: '天气预报' }), { pushHistory: true, maxTrailPages: 8 })
  const trail = webExploreTrailToObservation(advanced, 3_000)
  assert.equal(trail.mode, 'explore')
  assert.equal(trail.query, '上海天气')
  assert.equal(trail.url, 'https://weather.test')
  assert.equal(trail.title, '天气预报')
  assert.ok(trail.summary.includes('访问了 2 页'))
  assert.ok(trail.summary.includes('1. 搜索结果 → 2. 天气预报'))
  assert.ok(trail.excerpt.includes('[第1页 搜索结果]'))
  assert.ok(trail.excerpt.includes('[第2页 天气预报]'))
})

test('会话上下文注入：首屏带描述，翻屏省略，含链接/图片清单与动作提示', () => {
  const session = openWebExploreSession({ storyId: 's1', participantId: 'p1', snapshot: snapshot() })
  const text = sessionContextText(session)
  assert.ok(text.includes('[网页探索·进行中]'))
  assert.ok(text.includes('第 1/1 屏'))
  assert.ok(text.includes('页面描述：页面描述'), '首屏带 description')
  assert.ok(text.includes('可点链接：[1] 链接一 [2] 链接二'))
  assert.ok(text.includes('页面图片：{图1} 示意图'))
  assert.ok(text.includes('explore-open-link'))
  assert.ok(text.includes('explore-close'))

  // 翻屏后不再给页面描述
  const scrolled = { ...session, current: { ...session.current, screenIndex: 1 } }
  const scrolledText = sessionContextText(scrolled)
  assert.ok(!scrolledText.includes('页面描述：'), '非首屏省略 description')
})

test('会话上下文注入：无链接无图片时不输出空清单', () => {
  const session = openWebExploreSession({ storyId: 's1', participantId: 'p1', snapshot: snapshot({ links: [], images: [] }) })
  const text = sessionContextText(session)
  assert.ok(!text.includes('可点链接：'))
  assert.ok(!text.includes('页面图片：'))
})

test('evaluate 源码：自包含无外部依赖，模板引用上限常量', () => {
  // 引用 WEB_SNAPSHOT_MAX_LINKS 的值已内联到源码字符串里
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'web-session.ts'), 'utf-8')
  const match = source.match(/WEB_SNAPSHOT_EVALUATE_SOURCE = `([\s\S]*?)`/)
  assert.ok(match, 'evaluate 源码模板存在')
  const evaluateSource = match[1]
  assert.ok(evaluateSource.includes('document.querySelectorAll'), '在页面上下文执行')
  assert.ok(evaluateSource.includes('>= ${WEB_SNAPSHOT_MAX_LINKS}'), '链接上限引用常量（模板运行时插值）')
  assert.ok(!evaluateSource.includes('import '), '无外部导入')
})
