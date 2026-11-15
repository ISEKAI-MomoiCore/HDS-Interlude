/** Synthetic-data browser regression. Run from this plugin directory. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { fixture } from './fixture'
import { SqliteStore } from '../src/store'
import { createWebServer } from '../src/server'
import { LogRing } from '../src/logring'
async function main() {
  const f = fixture(), store = new SqliteStore(f.file), ring = new LogRing(200)
  ring.push('warn', 'fixture', '演示日志（合成数据）')
  const web = createWebServer({ publicRoot: resolve('public'), token: 'browser-test', pollSeconds: 1, autoRefresh: true, integration: { service: 'interlude', version: '1.0.1-rc50' }, store, ring })
  web.server.listen(0, '127.0.0.1'); await once(web.server, 'listening')
  const port = (web.server.address() as any).port
  const browser = await puppeteer.launch({ executablePath: process.env.HDS_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-first-run', '--disable-extensions'] })
  console.log('ENGINE', await browser.version())
  const page = await browser.newPage(), errors: string[] = []
  const cdp = await page.createCDPSession(); await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', info => console.error('EXCEPTION', JSON.stringify(info.exceptionDetails)))
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR', error.stack) })
  page.on('console', msg => { if (msg.type() === 'error') console.error('BROWSER:', msg.text()) })
  page.on('response', res => { if (res.status() >= 400) console.error('HTTP', res.status(), res.url()) })
  await page.evaluateOnNewDocument(() => { document.addEventListener('securitypolicyviolation', e => (window as any).__csp = [...((window as any).__csp || []), e.violatedDirective]) })
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
  const out = resolve('docs/screenshots'); mkdirSync(out, { recursive: true })
  const ready = (title: string) => page.waitForFunction(title => document.querySelector('#view h2')?.textContent === title, {}, title)
  const nav = async (route: string, title: string) => { await page.click(`[data-nav="${route}"]`); await ready(title) }
  try {
    await page.goto(`http://127.0.0.1:${port}/?token=browser-test`, { waitUntil: 'domcontentloaded' }); await ready('故事总览')
    assert.equal(await page.evaluate(() => location.search), '')
    assert.equal(await page.$eval('#story-select', el => (el as HTMLSelectElement).value), 'demo-a')
    for (const [route, title] of [['scenes', '场景与弧线'], ['alter', 'Alter 历史'], ['overlay', 'Overlay 演化'], ['preplan', 'Preplan 物化周日历'], ['facts', '事实、意图与记忆'], ['participants', '参与者'], ['logs', '进程日志']]) await nav(route, title)
    await nav('alter', 'Alter 历史'); assert.equal(await page.$$eval('.chart-point', els => els.length), 16)
    await page.select('#scope', 'friend-a'); assert.equal(await page.$$eval('.chart-point', els => els.length), 8)
    await page.select('#scope', '*'); await page.screenshot({ path: resolve(out, 'alter-light.png'), fullPage: true })
    await nav('overlay', 'Overlay 演化'); assert.equal(await page.$eval('.diff-add', el => el.textContent?.trim()), '+ 重新开门')
    await page.screenshot({ path: resolve(out, 'overlay-light.png'), fullPage: true })
    await nav('preplan', 'Preplan 物化周日历'); assert.equal(await page.$eval('#week-label', el => el.textContent), '2026-10-05 — 2026-10-11')
    assert.ok(await page.$('.calendar-block.carry')); assert.ok(await page.$('.calendar-block.tentative'))
    await page.click('#next-week'); assert.equal(await page.$eval('#week-label', el => el.textContent), '2026-10-12 — 2026-10-18')
    await page.click('#prev-week'); await page.screenshot({ path: resolve(out, 'preplan-light.png'), fullPage: true })
    await page.click('#theme-toggle'); assert.equal(await page.$eval('#theme-toggle', el => el.getAttribute('aria-pressed')), 'true'); await page.screenshot({ path: resolve(out, 'preplan-dark.png'), fullPage: true })
    await nav('facts', '事实、意图与记忆'); assert.equal(await page.$$eval('#view img', els => els.length), 0)
    assert.ok((await page.$eval('#view', el => el.textContent || '')).includes('<img src=x onerror=alert(1)>'))
    // Coupling / near-realtime regressions: write only the synthetic SQLite writer.
    assert.ok((await page.$eval('#integration-status', el => el.textContent || '')).includes('1s'))
    await nav('overview', '故事总览')
    const liveState = JSON.parse(f.db.prepare("SELECT state FROM interlude_story WHERE id='demo-a'").get()!.state as string)
    liveState.extensions.urge.value = .91
    f.db.prepare("UPDATE interlude_story SET state=? WHERE id='demo-a'").run(JSON.stringify(liveState))
    await page.waitForFunction(() => document.querySelector('#view')?.textContent?.includes('0.91'), { timeout: 6000 })
    await nav('scenes', '场景与弧线'); f.db.exec("UPDATE interlude_scene SET summary='场景实时联动' WHERE id=1")
    await page.waitForFunction(() => document.querySelector('#view')?.textContent?.includes('场景实时联动'), { timeout: 6000 })
    await nav('alter', 'Alter 历史'); await page.select('#scope', 'friend-a'); await page.select('#metric', 'alter')
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    liveState.alterSystem.history.push({ turn: 17, phase: 'advance', alter: .7, alterValue: 4.7, participantId: 'friend-a', timestamp: new Date(f.now).toISOString() })
    f.db.prepare("UPDATE interlude_story SET state=? WHERE id='demo-a'").run(JSON.stringify(liveState))
    await page.waitForFunction(() => document.querySelectorAll('.chart-point').length === 9, { timeout: 6000 })
    assert.equal(await page.$eval('#scope', el => (el as HTMLSelectElement).value), 'friend-a')
    assert.equal(await page.$eval('#metric', el => (el as HTMLSelectElement).value), 'alter')
    await nav('overlay', 'Overlay 演化')
    const patchValue = await page.$eval('#patch-select', el => [...(el as HTMLSelectElement).options].find(o => o.dataset.key === '1')!.value)
    await page.select('#patch-select', patchValue); await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    f.db.prepare("UPDATE interlude_state_patch SET status='applied',appliedAt=?,proposedValue='新提案实时联动' WHERE id=3").run(f.now)
    await page.waitForFunction(() => document.querySelector('#view')?.textContent?.includes('新提案实时联动'), { timeout: 6000 })
    assert.equal(await page.$eval('#patch-select', el => (el as HTMLSelectElement).selectedOptions[0].dataset.key), '1', '提案须按稳定 id 保留，而非旧索引')
    await nav('preplan', 'Preplan 物化周日历'); await page.click('#next-week')
    await page.$eval('#view details', el => { (el as HTMLDetailsElement).open = true })
    const liveDays = JSON.parse(f.db.prepare("SELECT materializedDays FROM interlude_schedule_preplan WHERE storyId='demo-a'").get()!.materializedDays as string)
    liveDays.find((d: any) => d.date === '2026-10-12').blocks[0].label = '物化日程实时联动'
    f.db.prepare("UPDATE interlude_schedule_preplan SET revision=4,materializedDays=?,reviewReason='计划复查实时联动' WHERE storyId='demo-a'").run(JSON.stringify(liveDays))
    await page.waitForFunction(() => document.querySelector('#calendar')?.textContent?.includes('物化日程实时联动'), { timeout: 6000 })
    assert.equal(await page.$eval('#week-label', el => el.textContent), '2026-10-12 — 2026-10-18')
    assert.equal(await page.$eval('#view details', el => (el as HTMLDetailsElement).open), true)
    await nav('facts', '事实、意图与记忆'); web.stopStreams()
    f.db.exec("UPDATE interlude_fact SET content='SSE断线轮询补查' WHERE id=1")
    await page.waitForFunction(() => document.querySelector('#view')?.textContent?.includes('SSE断线轮询补查'), { timeout: 3500 })
    await page.click('#auto-refresh'); f.db.exec("UPDATE interlude_fact SET content='暂停后恢复更新' WHERE id=1")
    await new Promise(done => setTimeout(done, 2200))
    assert.ok(!(await page.$eval('#view', el => el.textContent || '')).includes('暂停后恢复更新'))
    await page.click('#auto-refresh')
    await page.waitForFunction(() => document.querySelector('#view')?.textContent?.includes('暂停后恢复更新'), { timeout: 6000 })
    await nav('participants', '参与者'); f.db.exec("UPDATE interlude_participant SET displayName='参与者实时联动' WHERE id='friend-a'")
    await page.waitForFunction(() => document.querySelector('#view')?.textContent?.includes('参与者实时联动'), { timeout: 6000 })
    f.db.prepare("INSERT INTO interlude_story VALUES ('demo-c','paused','{}','{}',?,?)").run(f.now, f.now + 2)
    await page.waitForFunction(() => document.querySelector('#story-select option[value="demo-c"]') !== null, { timeout: 6000 })
    assert.equal(await page.$eval('#story-select', el => (el as HTMLSelectElement).value), 'demo-a', '新故事不能抢走已选故事')
    await nav('script', '剧本流'); assert.equal(await page.$$eval('.entry', els => els.length), 50)
    assert.equal(await page.$eval('.entry-id', el => el.textContent), '#115')
    await page.click('#older'); await page.waitForFunction(() => document.querySelectorAll('.entry').length === 100)
    assert.equal(await page.$eval('.entry-id', el => el.textContent), '#115')
    assert.equal(await page.$$eval('.entry-id', els => els.at(-1)?.textContent), '#16')
    f.db.prepare('INSERT INTO interlude_script_entry VALUES (?,?,?,?,?,?,?,?)').run(117, 'demo-a', '', 'script', 'demo', '新增追尾记录', f.now, '{}')
    await page.waitForFunction(() => document.querySelector('.entry-id')?.textContent === '#117', { timeout: 10000 })
    await page.click('#follow'); f.db.prepare('INSERT INTO interlude_script_entry VALUES (?,?,?,?,?,?,?,?)').run(118, 'demo-a', '', 'script', 'demo', '暂停期间记录', f.now, '{}')
    await new Promise(done => setTimeout(done, 3400)); assert.equal(await page.$eval('.entry-id', el => el.textContent), '#117')
    await nav('logs', '进程日志'); ring.push('error', 'fixture', '轮询追加测试')
    await page.waitForFunction(() => document.querySelector('#log-list')?.textContent?.includes('轮询追加测试'), { timeout: 10000 })
    await page.select('#log-level', 'warn'); await page.click('#log-filter'); await ready('进程日志')
    await page.waitForFunction(() => document.querySelector('#log-list')?.textContent?.includes('演示日志'))
    assert.ok(!(await page.$eval('#log-list', el => el.textContent || '')).includes('轮询追加测试'))
    await page.evaluate(() => { const original = window.fetch; window.fetch = async (...args) => { const response = await original(...args); if (String(args[0]).includes('/api/alter')) await new Promise(done => setTimeout(done, 500)); return response } })
    await page.click('[data-nav="alter"]'); await page.click('[data-nav="participants"]'); await ready('参与者')
    await new Promise(done => setTimeout(done, 700)); assert.equal(await page.$eval('#view h2', el => el.textContent), '参与者')
    await page.select('#story-select', 'demo-b'); await ready('参与者'); await page.waitForFunction(() => document.querySelector('#view')?.textContent?.includes('其他故事'))
    assert.ok(!(await page.$eval('#view', el => el.textContent || '')).includes('邻居（演示）'))
    await page.select('#story-select', 'demo-a'); await ready('参与者')
    for (const width of [390, 320]) {
      await page.setViewport({ width, height: 844, deviceScaleFactor: 1 })
      for (const [route, title] of [['overview', '故事总览'], ['alter', 'Alter 历史'], ['overlay', 'Overlay 演化'], ['preplan', 'Preplan 物化周日历'], ['logs', '进程日志']]) {
        await nav(route, title)
        const sizes = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
        assert.ok(sizes[0] <= sizes[1], `${width}px ${route} document overflow: ${sizes}`)
      }
      await nav('preplan', 'Preplan 物化周日历')
      assert.equal(await page.$eval('.scroll-hint', el => getComputedStyle(el).display), 'block')
      assert.ok(await page.$eval('.calendar-scroll', el => el.scrollWidth > el.clientWidth), `${width}px calendar should scroll horizontally`)
      assert.equal(await page.$eval('.calendar-scroll', el => el.getAttribute('role')), 'region')
      assert.ok((await page.$$eval('.step-nav', els => els.map(el => el.getBoundingClientRect().height))).every(height => height >= 40))
      if (width === 390) await page.screenshot({ path: resolve(out, 'preplan-mobile.png'), fullPage: true })
    }
    assert.deepEqual(await page.evaluate(() => (window as any).__csp || []), [], 'CSP violations'); assert.deepEqual(errors, [], 'runtime errors')
    console.log('Browser PASS: 9 pages, charts/diff/calendar, paging, live tail/pause, log polling/filter, navigation race, story isolation, all snapshot pages realtime, SSE fallback, pause/resume, preserved selections, story-list discovery, mobile, themes, no XSS/CSP/runtime errors.')
  } catch (error) { console.error('PAGE:', await page.evaluate(() => document.body.innerText)); console.error('ERRORS', errors); throw error
  } finally {
    await browser.close(); web.stopStreams(); web.server.closeAllConnections(); await new Promise<void>(done => web.server.close(() => done())); store.close(); f.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })



