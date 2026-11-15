import { esc, array, toDate, fmtTime, localDate, validDay, addDays, weekStart, calendarWeek, appliedComparisons, chartSvg } from './helpers.mjs'
const $ = selector => document.querySelector(selector)
const getStored = (key, fallback = '') => { try { return sessionStorage.getItem(key) || fallback } catch { return fallback } }
const state = { token: new URLSearchParams(location.search).get('token') || getStored('hds.token'), story: getStored('hds.story'), timezone: undefined, pollSeconds: 3, autoRefresh: true }
// Remove credential from address/history after accepting it; API fetches use a header.
if (new URLSearchParams(location.search).has('token')) { const url = new URL(location.href); url.searchParams.delete('token'); history.replaceState(null, '', url.pathname + url.search + url.hash) }
const saveSession = (key, value) => { try { sessionStorage.setItem(key, value) } catch { /* private mode */ } }
saveSession('hds.token', state.token)
async function api(path, signal) {
  const url = new URL(path, location.origin)
  if (state.story && !['/api/stories', '/api/status'].includes(path)) url.searchParams.set('story', state.story)
  const response = await fetch(url, { signal, cache: 'no-store', headers: { Accept: 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}
const chip = (text, color = 'gray') => `<span class="chip ${color}">${esc(text)}</span>`
const json = value => `<pre class="yaml-preview">${esc(JSON.stringify(value ?? {}, null, 2))}</pre>`
const empty = text => `<p class="muted empty">${esc(text)}</p>`
const head = (title, subtitle, count = '') => `<div class="page-head"><div><h2>${esc(title)}</h2><p class="subtitle">${esc(subtitle)}</p></div>${count ? chip(count) : ''}</div>`
const card = (title, content) => `<section class="card"><h3>${esc(title)}</h3>${content}</section>`
const number = value => typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)).toString() : '—'
const time = value => esc(fmtTime(value, state.timezone))
const labels = { applied: '已应用', proposed: '待审提案', rejected: '已拒绝', cleared: '已清除', pending: '待裁决', active: '活动', unresolved: '未解决', deleted: '已删除', superseded: '已替代' }
const status = value => chip(labels[value] || value || '未知', ['applied', 'active'].includes(value) ? 'green' : ['proposed', 'pending'].includes(value) ? 'warn' : 'gray')
function notice(ctx, error) {
  if (!ctx.active() || error?.name === 'AbortError') return
  let node = ctx.root.querySelector('.page-error')
  if (!node) { node = document.createElement('div'); node.className = 'notice danger page-error'; node.setAttribute('role', 'alert'); ctx.root.prepend(node) }
  node.textContent = error.message || String(error)
}
function on(ctx, selector, event, handler) {
  ctx.root.querySelector(selector)?.addEventListener(event, e => { Promise.resolve().then(() => handler(e)).catch(error => notice(ctx, error)) })
}
function poller(ctx, action, ms = state.pollSeconds * 1000) {
  let busy = false
  const timer = setInterval(async () => {
    if (!ctx.active() || busy || document.hidden) return
    busy = true
    try { await action() } catch (error) { notice(ctx, error) } finally { busy = false }
  }, ms)
  ctx.cleanup.push(() => clearInterval(timer))
}
const RHYTHM_LABELS = { 'phone-focused': '关注手机', available: '空闲', occupied: '忙碌', resting: '休息', asleep: '入睡' }
const RHYTHM_SOURCE = { compactor: '压缩器', narrator: '叙事模型', incoming: '用户消息升级', fallback: '旧状态迁移' }
function rhythmCard(s) {
  const r = s.lifeRhythm
  if (!r?.attention) {
    const legacy = s.lifeStatus
    if (legacy?.status) return card('Life Rhythm · 生活节奏', `<div class="chip-row">${chip('旧版三值状态', 'gray')}${chip(legacy.status, 'gray')}</div><p class="muted">最后更新 ${time(legacy.updatedAt)}。主插件升级到 rc52 并完成一次压缩后，这里会展示五档节奏。</p>`)
    return card('Life Rhythm · 生活节奏', empty(r ? '节奏数据无效。' : '尚未评估（旧版本故事或压缩器未输出）。'))
  }
  const assessed = Date.parse(r.assessedAt)
  const stale = Number.isNaN(assessed) || Date.now() - assessed > 2 * 3_600_000
  return card('Life Rhythm · 生活节奏', `<div class="chip-row">${chip(RHYTHM_LABELS[r.attention] || r.attention, r.attention === 'available' || r.attention === 'phone-focused' ? 'green' : r.attention === 'asleep' ? 'gray' : 'warn')}${stale ? chip('已过期 · 退回作息兜底', 'warn') : ''}${chip(RHYTHM_SOURCE[r.source] || r.source || '—', 'cyan')}</div>` +
    `<p class="muted">评估于 ${time(r.assessedAt)}${r.basis ? '' : ' · 无依据说明'}</p>` +
    (r.basis ? `<p class="prose">${esc(r.basis)}</p>` : '') +
    `<details><summary>节奏如何影响调度</summary><p class="muted">档位作为乘法因子进入 Urge 间隔（关注手机 1.4 / 空闲 1.0 / 忙碌 0.7 / 休息 0.5 / 入睡 0.15），并影响群聊回应跳过计数。</p></details>`)
}
async function overview(ctx) {
  const data = await ctx.api('/api/overview'), s = data.story
  if (!s) { ctx.root.innerHTML = head('总览', 'OVERVIEW') + card('暂无故事', empty('数据库尚未产生故事记录。缺表时请先确认主插件已完成初始化。')); return }
  setTimezone(s.setting?.timezone || data.preplan?.timezone)
  const a = s.alter ?? {}, u = s.urge ?? {}, auto = s.automation ?? {}
  ctx.root.innerHTML = head('故事总览', 'OVERVIEW · READ ONLY', s.id) +
    (data.missingTables.length ? `<div class="notice info">部分数据表尚未初始化：${esc(data.missingTables.join('、'))}</div>` : '') +
    `<div class="stat-bar"><span class="item"><b>${esc(s.entryCount)}</b>剧本条目</span><span class="item"><b>${esc(a.alterValue ?? 0)}</b>Alter 全局累计</span><span class="item"><b>${a.emotionalOffset?.direction === 'serious' ? '严肃' : a.emotionalOffset?.direction === 'relaxed' ? '放松' : '无'}</b>当前情绪偏移</span><span class="item"><b>${esc(s.lifeRhythm ? (RHYTHM_LABELS[s.lifeRhythm.attention] || s.lifeRhythm.attention) : '—')}</b>生活节奏</span><span class="item"><b>${time(s.cursorAt)}</b>叙事游标</span></div>` +
    `<div class="notice info">推进时间是调度快照，不保证一定在该时刻写作；意图与 Preplan 是未来可能性，不是已发生的事实。时间显示：${esc(state.timezone || '浏览器本地时区')}。</div>` +
    `<div class="ov-grid">${card('推进与自动调度', `<p class="muted">下次推进：${time(auto.nextAdvanceAt)}</p>${json(auto)}`)}
    ${rhythmCard(s)}${card('Urge · 续写调度', json(u))}${card('Alter · 情绪偏移', json(a.emotionalOffset ?? { note: '当前无激活偏移' }) + `<a href="#alter">查看历史折线 →</a>`)}
    ${card('Agency Window · 能动窗口', json(s.agencyWindow))}${card('当前剧情弧', data.arc ? `<p><b>${esc(data.arc.title)}</b></p><p class="prose">${esc(data.arc.summary)}</p>` : empty('无活动弧。'))}
    ${card('长线叙事指导', array(data.longArc).length ? `<p><b>${esc(data.longArc[0].title)}</b> ${status(data.longArc[0].status)}</p><p class="prose">${esc(data.longArc[0].direction)}</p><p class="muted">指导方向不是事实权威。</p>` : empty('暂无指导记录。'))}
    ${card('Preplan · 物化计划', data.preplan ? `<p>revision ${esc(data.preplan.revision)} · ${esc(data.preplan.timezone)}</p><p class="muted">${esc(data.preplan.validFrom)} — ${esc(data.preplan.validThrough)}</p><a href="#preplan">打开周日历 →</a>` : empty('暂无计划。'))}</div>`
}
let scriptFilter = { kind: '', participant: '' }, scriptFollow = true
async function script(ctx) {
  ctx.root.innerHTML = head('剧本流', 'SCRIPT TIMELINE · ID 倒序 · 每次 50 条') + `<div class="toolbar"><select id="kind" aria-label="条目类型"><option value="">全部类型</option>${['script', 'user-message', 'character-message', 'group-message', 'character-group-message', 'character-platform-action', 'admin-note', 'world-event', 'setup', 'system'].map(k => `<option ${scriptFilter.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select><input id="participant" aria-label="参与者 ID" placeholder="参与者 ID" value="${esc(scriptFilter.participant)}"><button id="filter" class="btn primary">应用过滤</button><button id="follow" class="btn">${scriptFollow ? '暂停追尾' : '恢复追尾'}</button><span id="total" class="muted"></span></div><div id="script-list"></div><button id="older" class="btn">加载更早</button><p class="muted">本页最多展示 1000 条；总数仅按故事和过滤条件计算。</p>`
  let rows = [], hasMore = false, busy = false
  const list = ctx.root.querySelector('#script-list'), earlier = ctx.root.querySelector('#older')
  const load = params => { const query = new URLSearchParams({ limit: '50', ...params }); if (scriptFilter.kind) query.set('kind', scriptFilter.kind); if (scriptFilter.participant) query.set('participant', scriptFilter.participant); return ctx.api('/api/script?' + query) }
  const draw = () => {
    list.innerHTML = rows.map(e => `<article class="entry"><div class="entry-side"><span class="entry-id">#${esc(e.id)}</span><span class="entry-time">${time(e.occurredAt)}</span></div><div class="entry-main"><div class="chip-row">${chip(e.kind, 'blue')}${chip(e.actor || '—', 'cyan')}${e.participantId ? chip(e.participantId) : ''}${array(e.metadata?.deliveryActions).filter(a => a && typeof a === 'object').map(a => chip(`${a.eventKind || ''}: ${a.status || ''}`, a.status === 'delivered' ? 'green' : 'warn')).join('')}</div><pre class="entry-content">${esc(e.content)}</pre></div></article>`).join('') || empty('没有符合过滤条件的条目。')
    earlier.disabled = !hasMore || rows.length >= 1000
  }
  const initial = await load({}); rows = initial.rows; hasMore = initial.hasMore; ctx.root.querySelector('#total').textContent = `共 ${initial.total} 条`; draw()
  ctx.mount = () => {
    on(ctx, '#filter', 'click', () => { scriptFilter = { kind: ctx.root.querySelector('#kind').value, participant: ctx.root.querySelector('#participant').value.trim() }; return router() })
    on(ctx, '#follow', 'click', e => { scriptFollow = !scriptFollow; e.target.textContent = scriptFollow ? '暂停追尾' : '恢复追尾' })
    on(ctx, '#older', 'click', async () => {
      if (busy || !hasMore) return
      busy = true; earlier.disabled = true
      try { const data = await load({ before: String(rows.at(-1).id) }); if (!ctx.active()) return; rows.push(...data.rows); hasMore = data.hasMore; draw() } finally { busy = false; if (ctx.active()) earlier.disabled = !hasMore || rows.length >= 1000 }
    })
    poller(ctx, async () => {
      if (!scriptFollow || busy) return
      busy = true
      try {
        const data = await load(rows.length ? { after: String(rows[0].id) } : {})
        if (!ctx.active()) return
        ctx.root.querySelector('#total').textContent = `共 ${data.total} 条`
        if (!rows.length) { rows = data.rows; hasMore = data.hasMore }
        else if (data.rows.length) {
          // Ascending incremental pagination prevents silently skipping busy intervals.
          const incoming = [...data.rows]
          let page = data, pages = 1
          while (page.hasMore && pages++ < 20) { page = await load({ after: String(incoming.at(-1).id) }); incoming.push(...page.rows); if (!ctx.active()) return }
          rows = [...incoming.reverse(), ...rows].slice(0, 1000)
        }
        draw()
      } finally { busy = false }
    })
  }
}
async function scenes(ctx) {
  const { rows, arc } = await ctx.api('/api/scenes')
  ctx.root.innerHTML = head('场景与弧线', 'SCENES & ARC · 摘要索引不替代原文', `${rows.length} 场景（最多 200）`) + card('当前活动弧', arc ? `<h4>${esc(arc.title)}</h4><p class="prose">${esc(arc.summary)}</p>` : empty('暂无活动弧。')) + rows.map(s => card(`场景 #${s.id}`, `${status(s.status)}<p class="muted">${time(s.startedAt)} → ${time(s.endedAt)} · ${esc(s.entryCount)} 条目</p><p><b>${esc(s.hook)}</b></p><p class="prose">${esc(s.summary)}</p>`)).join('')
}
async function alter(ctx) {
  const { alter: a } = await ctx.api('/api/alter'), history = array(a?.history)
  ctx.root.innerHTML = head('Alter 历史', 'ALTER SYSTEM · 保存顺序 / TURN') + `<div class="stat-bar"><span class="item"><b>${esc(a?.alterValue ?? 0)}</b>当前全局累计</span><span class="item"><b>${history.length}</b>已保留历史点</span><span class="item"><b>${array(a?.pendingScopes).length}</b>待分析来源</span></div><div class="notice info">历史来自主插件保存的有限窗口，可能不含更早记录。累计值始终属于故事全局；按来源筛选后也不是该参与者的独立累计。零线仅用于读图，不代表触发阈值。</div><div class="toolbar"><select id="metric" aria-label="折线指标"><option value="alterValue">故事全局累计</option><option value="alter">单轮变化</option></select><select id="scope" aria-label="历史来源"><option value="*">全部来源</option>${[...new Set(history.map(h => h.participantId || ''))].map(id => `<option value="${esc(id)}">${esc(id || '全局来源')}</option>`).join('')}</select></div>${card('历史折线', '<div id="chart"></div>')}<div class="ov-grid">${card('当前情绪偏移', json(a?.emotionalOffset ?? { note: '未激活' }))}${card('待分析来源累计', json(a?.pendingScopes))}</div>${card('历史点明细', '<div class="table-scroll"><table><thead><tr><th>时间</th><th>Turn</th><th>阶段</th><th>来源</th><th>单轮变化</th><th>全局累计</th></tr></thead><tbody id="history"></tbody></table></div>')}`
  const draw = () => {
    const scope = ctx.root.querySelector('#scope').value, metric = ctx.root.querySelector('#metric').value
    const points = history.filter(h => scope === '*' || (h.participantId || '') === scope)
    ctx.root.querySelector('#chart').innerHTML = chartSvg(points, metric, state.timezone) || empty('此来源没有已保存的历史。')
    ctx.root.querySelector('#history').innerHTML = points.slice().reverse().map(h => `<tr><td>${time(h.timestamp)}</td><td>${esc(h.turn)}</td><td>${esc(h.phase)}</td><td>${esc(h.participantId || '全局')}</td><td>${esc(number(h.alter))}</td><td title="${esc(h.alterValue)}">${esc(number(h.alterValue))}</td></tr>`).join('')
  }
  ctx.restore = () => { draw() }; draw(); ctx.mount = () => { on(ctx, '#metric', 'change', draw); on(ctx, '#scope', 'change', draw) }
}
async function overlay(ctx) {
  const data = await ctx.api('/api/overlay'), comparisons = appliedComparisons(data.patches)
  ctx.root.innerHTML = head('Overlay 演化', 'OVERLAY · PROPOSALS & DIFF', `${data.patches.length} 提案（最多 200）`) + `<div class="notice info">这里比较同一 target / path / 参与者的相邻「已应用提案文本」。主插件会合并文本，并未保存每次应用前的完整状态，因此这不是完整 overlay 状态回放。首条记录或窗口外基线标为未知；待审和拒绝提案不会被当作已生效变化。</div><div class="ov-grid">${card('当前故事 Overlay', json(data.current))}${card('当前参与者关系 Overlay', data.participants.filter(p => p.state?.relationshipOverlay).map(p => `<h4>${esc(p.displayName || p.id)}</h4><p class="prose">${esc(p.state.relationshipOverlay)}</p>`).join('') || empty('暂无参与者关系 Overlay。'))}</div>${card('已应用提案 · 演化 diff', comparisons.length ? `<div class="toolbar"><select id="patch-select" aria-label="选择已应用提案">${comparisons.map(c => `<option value="${esc(c.patch.id)}" data-key="${esc(c.patch.id)}">#${esc(c.patch.id)} · ${esc(c.patch.target)} / ${esc(c.patch.path)} · ${esc(c.patch.participantId || '全局')}</option>`).join('')}</select></div><div id="patch-diff"></div>` : empty('没有已应用提案。'))}${card('压缩快照 · 摘要而非完整状态', data.snapshots.map(s => `<div class="snap-item">${chip(s.tier, 'blue')}${status(s.status)}<p class="muted">${time(s.periodStart)} — ${time(s.periodEnd)} · ${esc(s.participantId || '全局')} / ${esc(s.target)}</p><p class="prose">${esc(s.summary)}</p><details><summary>主要事件与来源</summary>${json({ majorEvents: s.majorEvents, sourcePatchIds: s.sourcePatchIds })}</details></div>`).join('') || empty('暂无快照。'))}${card('提案流水 · 最新 200 条', data.patches.map(p => `<div class="patch-item"><div class="chip-row">${status(p.status)}${chip(`#${p.id}`)}${chip(`${p.target} / ${p.path}`, 'cyan')}${chip(p.participantId || '全局')}${chip(`置信 ${Number(p.confidence || 0).toFixed(2)}`)}</div><p class="prose">${esc(p.proposedValue)}</p><details><summary>证据 · ${array(p.sourceEntryIds).length} 条来源</summary><p class="prose">${esc(p.evidence)}</p>${json(p.sourceEntryIds)}</details></div>`).join('') || empty('暂无提案。'))}`
  const draw = () => {
    if (!comparisons.length) return
    const selectedId = ctx.root.querySelector('#patch-select').value
    const c = comparisons.find(item => String(item.patch.id) === selectedId) || comparisons[0]
    ctx.root.querySelector('#patch-diff').innerHTML = `<p class="muted">${c.before ? `#${esc(c.before.id)} → #${esc(c.patch.id)}` : '之前的基线未知（没有较早已应用记录）'} · 应用时间 ${time(c.patch.appliedAt)}</p><div class="diff-columns"><div><h4>较早提案文本</h4><pre class="entry-content">${esc(c.before?.proposedValue ?? '未知；不等同于空字符串')}</pre></div><div><h4>选中提案文本</h4><pre class="entry-content">${esc(c.patch.proposedValue)}</pre></div></div>${c.diff ? `<pre class="diff-code">${c.diff.map(line => `<span class="diff-${line.type}">${line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '} ${esc(line.text)}</span>`).join('')}</pre>` : ''}`
  }
  ctx.restore = () => { draw() }; draw(); ctx.mount = () => on(ctx, '#patch-select', 'change', draw)
}
let calendarAnchor = null
async function preplan(ctx) {
  const { preplan: plan, cursorAt } = await ctx.api('/api/preplan')
  if (!plan) { ctx.root.innerHTML = head('Preplan 周日历', 'MATERIALIZED WEEK') + card('暂无物化计划', empty('主插件尚未生成 Schedule Preplan。')); return }
  const days = array(plan.materializedDays), dates = days.map(d => d?.date).filter(validDay).sort()
  const today = localDate(Date.now(), plan.timezone), cursor = localDate(cursorAt, plan.timezone)
  const firstWeek = weekStart(dates[0]), lastWeek = weekStart(dates.at(-1))
  let monday = calendarAnchor && calendarAnchor >= firstWeek && calendarAnchor <= lastWeek ? calendarAnchor : weekStart(cursor && dates.includes(cursor) ? cursor : today && dates.includes(today) ? today : dates[0])
  ctx.root.innerHTML = head('Preplan 物化周日历', 'PREPLAN · PLAN ≠ OBSERVATION', `revision ${plan.revision}`) + `<div class="notice info">只展示 materializedDays 中已保存的时间块，不临时推导规律。计划并不证明事件已发生；虚线「候选」仍需临近时裁决。跨午夜块拆到次日，保留来源日期。时区：${esc(plan.timezone)}${today ? '' : '（无效时区，无法定位今天）'}。</div><div class="toolbar"><button id="prev-week" class="btn">← 上周</button><b id="week-label"></b><button id="next-week" class="btn">下周 →</button><button id="calendar-today" class="btn">首个物化周</button><span class="muted">覆盖 ${esc(plan.validFrom)} — ${esc(plan.validThrough)}</span></div><div class="calendar-scroll" tabindex="0" role="region" aria-label="物化周日历，可横向滚动查看七天"><div id="calendar" class="week-calendar"></div></div><p class="scroll-hint" aria-hidden="true">左右滑动查看完整一周 →</p><div class="calendar-legend">${chip('已保存计划', 'blue')}${chip('候选 · 非确认预约', 'warn')}${chip('跨午夜续段', 'purple')}</div>${card('复查依据与规律 / 例外', `<p class="prose">${esc(plan.reviewReason)}</p><p class="muted">已审查证据至 #${esc(plan.lastEvidenceEntryId)} · 最近复查本地日期 ${esc(plan.lastReviewedLocalDate)}</p><details><summary>查看已保存规律与例外</summary>${json({ regimes: plan.regimes, exceptions: plan.exceptions })}</details>`)} `
  const draw = () => {
    if (!monday) { ctx.root.querySelector('#calendar').innerHTML = empty('暂无有效物化日期。'); ctx.root.querySelector('#prev-week').disabled = true; ctx.root.querySelector('#next-week').disabled = true; return }
    calendarAnchor = monday
    ctx.root.querySelector('#week-label').textContent = `${monday} — ${addDays(monday, 6)}`
    ctx.root.querySelector('#prev-week').disabled = monday <= firstWeek
    ctx.root.querySelector('#next-week').disabled = monday >= lastWeek
    ctx.root.querySelector('#calendar').innerHTML = calendarWeek(days, monday).map((day, i) => `<section class="calendar-day ${day.date === today ? 'today' : ''}"><header><b>周${'一二三四五六日'[i]}</b><span>${esc(day.date.slice(5))}${day.date === cursor ? ' · 游标' : ''}</span></header>${day.blocks.map(b => `<article class="calendar-block ${b.tentative ? 'tentative' : ''} ${b.carry ? 'carry' : ''}"><b>${esc(b.displayStart)}–${esc(b.displayEnd)}</b><p>${esc(b.label)}</p><small>${esc(b.kind)}${b.location ? ` · ${esc(b.location)}` : ''}</small>${b.tentative ? '<small>候选 · 非确认预约</small>' : ''}${b.carry ? `<small>续 ${esc(b.sourceDate)}</small>` : ''}</article>`).join('') || empty(day.covered ? '已物化 · 无时间块' : '未物化 / 不在覆盖范围')}${array(plan.exceptions).filter(e => e?.date === day.date).map(e => `<div class="calendar-exception"><b>例外 · ${esc(e.mode)}</b><p>${esc(e.reason)}</p></div>`).join('')}</section>`).join('')
  }
  draw(); ctx.mount = () => {
    on(ctx, '#prev-week', 'click', () => { if (monday > firstWeek) { monday = addDays(monday, -7); draw() } })
    on(ctx, '#next-week', 'click', () => { if (monday < lastWeek) { monday = addDays(monday, 7); draw() } })
    on(ctx, '#calendar-today', 'click', () => { monday = firstWeek; draw() })
  }
}
async function facts(ctx) {
  const data = await ctx.api('/api/facts')
  const scopes = [...new Set(data.facts.map(f => f.scope || '?'))]
  const factGroups = scopes.map(scope => {
    const list = data.facts.filter(f => (f.scope || '?') === scope)
    const rows = list.map(f => `<div class="fact-item">${chip(f.unresolved ? '未解决' : '已提取', f.unresolved ? 'warn' : 'green')}${status(f.status)}<p class="prose">${esc(f.content)}</p><small class="muted">置信 ${esc(f.confidence)} · ${array(f.sourceEntryIds).length} 条来源</small></div>`).join('')
    return `<h4>${esc(scope)} · ${list.length}</h4>${rows}`
  }).join('')
  const intentRows = data.intents.map(i => `<div class="intent-item">${chip(i.type, 'blue')}${status(i.status)}<p class="muted">${time(i.notBefore)} · ${toDate(i.notBefore) && toDate(i.notBefore) <= new Date() ? '已到候选裁决时间' : '未来候选'}</p><p class="prose">${esc(i.summary)}</p></div>`).join('')
  const memoryRows = data.memories.map(m => `<div class="fact-item">${chip(m.category)}${status(m.status)}<p class="prose">${esc(m.content)}</p></div>`).join('')
  ctx.root.innerHTML = head('事实、意图与记忆', 'FACTS · INTENTS · MEMORIES') +
    '<div class="notice info">事实是带置信度的提取记录，并不等于绝对真实；「未解决」标记待解释。待办意图即使到期，也仍需重新裁决。</div>' +
    `<div class="ov-grid">${card('长期事实 · 最新最多 200 条', factGroups || empty('暂无事实。'))}${card('待办意图 · 到期升序，最多 100 条', intentRows || empty('暂无待办意图。'))}${card('近期记忆 · 最新最多 100 条', memoryRows || empty('暂无记忆。'))}</div>`
}
async function participants(ctx) {
  const { rows } = await ctx.api('/api/participants')
  ctx.root.innerHTML = head('参与者', 'PARTICIPANTS · 当前故事', `${rows.length} 人（最多 200）`) + `<div class="ov-grid">${rows.map(p => card(p.displayName || p.userId || p.id, `${chip(p.id)}${chip(p.platform)}${status(p.status)}<p class="muted">未读 ${esc(p.state?.unreadMessageCount ?? 0)} · 待回复 ${esc(p.state?.pendingReplyCount ?? 0)}</p><p class="prose">${esc(p.state?.relationshipOverlay || p.relationship)}</p><details><summary>状态快照</summary>${json(p.state)}</details>`)).join('') || empty('暂无参与者。')}</div>`
}
let logLevel = '', logName = '', logFollow = true
async function logs(ctx) {
  ctx.root.innerHTML = head('进程日志', 'KOISHI LOGGER · 内存环形缓冲 · 非终端历史') + `<div class="notice info">日志来自整个 Koishi 进程，不按故事过滤；仅保留观测站启用后的 Logger 记录，不拦截原生 console 或补读旧日志。前端最多显示 1000 条。</div><div class="toolbar"><select id="log-level" aria-label="日志级别"><option value="">全部级别</option>${['debug', 'info', 'warn', 'error', 'success'].map(l => `<option ${logLevel === l ? 'selected' : ''}>${l}</option>`).join('')}</select><input id="log-name" aria-label="Logger 名称" placeholder="Logger 名称包含…" value="${esc(logName)}"><button id="log-filter" class="btn">应用过滤</button><button id="log-follow" class="btn">${logFollow ? '暂停更新' : '恢复更新'}</button><button id="log-clear" class="btn">清屏</button><span id="log-note" class="muted"></span></div><div id="log-list" class="log-list"></div>`
  let cursor, session, rows = []
  const list = ctx.root.querySelector('#log-list')
  const poll = async initial => {
    if (!initial && !logFollow) return
    const params = new URLSearchParams({ limit: '300' })
    if (cursor != null) params.set('since', String(cursor))
    if (session) params.set('session', session)
    if (logLevel) params.set('level', logLevel)
    if (logName) params.set('name', logName)
    const data = await ctx.api('/api/logs?' + params)
    if (!ctx.active()) return
    if (data.reset) rows = []
    session = data.session; cursor = data.cursor
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60
    rows = [...rows, ...data.lines].slice(-1000)
    list.innerHTML = rows.map(l => `<div class="log-line"><span class="log-time">${time(l.time)}</span><span class="log-name">${esc(l.level)} · ${esc(l.name)}</span><span class="log-msg">${esc(l.message)}</span></div>`).join('') || empty('当前过滤条件下没有日志。')
    if (initial || atBottom) list.scrollTop = list.scrollHeight
    ctx.root.querySelector('#log-note').textContent = data.reset ? '服务已重启，日志游标已重置' : data.dropped ? '缓冲已覆盖部分旧日志' : `游标 #${cursor}`
  }
  // Initial load uses the same filter as subsequent polling.
  await poll(true)
  ctx.mount = () => {
    on(ctx, '#log-filter', 'click', () => { logLevel = ctx.root.querySelector('#log-level').value; logName = ctx.root.querySelector('#log-name').value.trim(); return router() })
    on(ctx, '#log-follow', 'click', e => { logFollow = !logFollow; e.target.textContent = logFollow ? '暂停更新' : '恢复更新' })
    on(ctx, '#log-clear', 'click', () => { rows = []; list.innerHTML = empty('已清屏，继续从当前游标接收新日志。') })
    poller(ctx, () => poll(false))
  }
}
const pages = { overview, script, scenes, alter, overlay, preplan, facts, participants, logs }
let generation = 0, current, source, liveTimer, dirty = false, syncing = false, revisionKey = '', connectionEpoch = 0
const routeName = () => Object.hasOwn(pages, location.hash.slice(1)) ? location.hash.slice(1) : 'overview'
const interactionActive = () => document.querySelector('input:not([type=checkbox]):not([type=radio]):focus,select:focus,textarea:focus,[contenteditable]:focus') || Boolean(window.getSelection()?.toString())
function captureView(root) {
  return {
    controls: [...root.querySelectorAll('select[id]')].map(el => ({ id: el.id, value: el.value, key: el.id === 'patch-select' ? el.selectedOptions[0]?.dataset.key : undefined })),
    details: [...root.querySelectorAll('details')].map(el => el.open),
    scroll: [...root.querySelectorAll('.calendar-scroll,.table-scroll')].map(el => [el.scrollLeft, el.scrollTop]),
    x: window.scrollX, y: window.scrollY,
  }
}
function restoreView(ctx, saved) {
  for (const item of saved.controls) {
    const el = ctx.root.querySelector('#' + item.id)
    if (!el) continue
    const option = [...el.options].find(o => item.key ? o.dataset.key === item.key : o.value === item.value)
    if (option) el.value = option.value
  }
  ctx.root.querySelectorAll('details').forEach((el, i) => { el.open = saved.details[i] ?? false })
  ctx.restore?.()
  const patch = ctx.root.querySelector('#patch-select'), patchKey = saved.controls.find(item => item.id === 'patch-select')?.key
  if (patch && patchKey) { const option = [...patch.options].find(o => o.dataset.key === patchKey); if (option) { patch.value = option.value; patch.dispatchEvent(new Event('change')) } }
  requestAnimationFrame(() => {
    if (!ctx.active()) return
    ctx.root.querySelectorAll('.calendar-scroll,.table-scroll').forEach((el, i) => { if (saved.scroll[i]) { el.scrollLeft = saved.scroll[i][0]; el.scrollTop = saved.scroll[i][1] } })
    window.scrollTo(saved.x, saved.y)
  })
}
async function router({ live = false } = {}) {
  const version = ++generation
  current?.abort.abort(); current?.cleanup.forEach(fn => fn())
  const route = routeName(), previous = $('#view')
  document.querySelectorAll('[data-nav]').forEach(button => { button.classList.toggle('active', button.dataset.nav === route); if (button.dataset.nav === route) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current') })
  const root = document.createElement('div'); root.className = 'view visible'; root.id = 'view'
  const abort = new AbortController()
  const ctx = { root, abort, cleanup: [], active: () => version === generation, api: path => api(path, abort.signal), mount: null, restore: null, loading: true }
  current = ctx
  if (!live) previous.innerHTML = '<p class="muted" role="status">加载只读快照…</p>'
  $('#changed').hidden = true
  try {
    await pages[route](ctx)
    if (!ctx.active()) return
    const saved = live ? captureView(previous) : null
    $('#view').replaceWith(root); ctx.mount?.()
    if (saved) restoreView(ctx, saved)
    $('#updated-at').textContent = '快照读取：' + new Date().toLocaleTimeString()
  } catch (error) {
    if (!ctx.active() || error.name === 'AbortError') return
    if (live) { dirty = true; $('#changed').hidden = false; $('#connection-error').textContent = error.message; return }
    root.innerHTML = head('加载失败', 'READ ONLY') + `<div class="notice danger" role="alert">${esc(error.message)}</div><p class="muted">可检查侧栏令牌、数据库路径后重试。</p>`
    $('#view').replaceWith(root)
  } finally { ctx.loading = false }
}
function setTimezone(zone) { state.timezone = zone || undefined; if ($('#timezone')) $('#timezone').textContent = '时间：' + (state.timezone || '浏览器本地时区') }
async function loadStories() {
  const epoch = connectionEpoch, story = state.story
  try {
    const { rows } = await api('/api/stories')
    if (epoch !== connectionEpoch || story !== state.story) return false
    if (!rows.some(s => s.id === state.story)) state.story = rows[0]?.id || ''
    const changed = story !== state.story
    if (changed) calendarAnchor = null
    saveSession('hds.story', state.story)
    setTimezone(rows.find(s => s.id === state.story)?.timezone)
    $('#story-select').innerHTML = rows.length ? rows.map(s => `<option value="${esc(s.id)}" data-timezone="${esc(s.timezone || '')}" ${s.id === state.story ? 'selected' : ''}>${esc(s.id)} · ${esc(s.status)}</option>`).join('') : '<option value="">暂无故事</option>'
    $('#connection-error').textContent = ''
    return changed
  } catch (error) { if (epoch === connectionEpoch) $('#connection-error').textContent = error.message; throw error }
}
async function loadStatus() {
  const data = await api('/api/status')
  state.pollSeconds = Math.max(1, Math.min(60, Number(data.pollSeconds) || 3))
  state.autoRefresh = getStored('hds.autoRefresh', String(data.autoRefresh)) === 'true'
  $('#auto-refresh').checked = state.autoRefresh
  $('#integration-status').textContent = data.integration ? 'HDSI ' + data.integration.version + ' · 依赖已就绪 · ' + state.pollSeconds + 's' : '只读数据库 · ' + state.pollSeconds + 's'
  const key = data.session + ':' + data.revision
  if (revisionKey && key !== revisionKey) dirty = true
  revisionKey = key
}
async function flushLive() {
  if (!dirty || document.hidden || current?.loading || interactionActive()) return
  const changedStory = await loadStories()
  if (changedStory) { dirty = false; await router(); return }
  if (['script', 'logs'].includes(routeName())) { dirty = false; return } // Their incremental pollers own pause/cursors.
  if (!state.autoRefresh) { $('#changed').hidden = false; return }
  dirty = false
  await router({ live: true })
}
async function syncLive() {
  if (syncing || document.hidden) return
  syncing = true
  try { await loadStatus(); await flushLive() } catch (error) { $('#connection-error').textContent = error.message }
  finally { syncing = false }
}
function startLiveTimer() { clearInterval(liveTimer); liveTimer = setInterval(syncLive, state.pollSeconds * 1000) }
function connectSSE() {
  source?.close()
  const query = new URLSearchParams()
  if (state.token) query.set('token', state.token) // EventSource cannot set Authorization headers.
  const stream = source = new EventSource('/api/stream?' + query)
  stream.onopen = () => {
    if (source !== stream) return
    $('#live-dot').classList.add('on'); $('#live-text').textContent = '实时连接已建立'
    void syncLive() // Status comparison catches missed writes; duplicate SSE notifications must not redraw.
  }
  stream.onerror = () => { if (source !== stream) return; $('#live-dot').classList.remove('on'); $('#live-text').textContent = '实时连接断开 / 轮询补查中' }
  stream.onmessage = () => { if (source !== stream) return; void syncLive() }
}
for (const button of document.querySelectorAll('[data-nav]')) button.addEventListener('click', () => { location.hash = button.dataset.nav })
window.addEventListener('hashchange', router)
$('#refresh').addEventListener('click', async () => { try { await loadStatus(); await loadStories(); dirty = false; await router() } catch (error) { $('#connection-error').textContent = error.message } })
$('#story-select').addEventListener('change', () => { connectionEpoch++; dirty = false; state.story = $('#story-select').value; setTimezone($('#story-select').selectedOptions[0]?.dataset.timezone); calendarAnchor = null; saveSession('hds.story', state.story); connectSSE(); void router() })
$('#access-token').value = state.token
$('#apply-token').addEventListener('click', async () => { connectionEpoch++; source?.close(); state.token = $('#access-token').value.trim(); saveSession('hds.token', state.token); try { await loadStatus(); await loadStories(); startLiveTimer(); connectSSE(); await router() } catch (error) { $('#connection-error').textContent = error.message } })
$('#auto-refresh').addEventListener('change', () => { state.autoRefresh = $('#auto-refresh').checked; saveSession('hds.autoRefresh', String(state.autoRefresh)); if (state.autoRefresh) { dirty = true; void syncLive() } })
try { if (localStorage.getItem('webconsole.theme') === 'dark') document.documentElement.dataset.theme = 'dark' } catch { /* private mode */ }
const syncThemeButton = () => $('#theme-toggle').setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'))
syncThemeButton()
$('#theme-toggle').addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; syncThemeButton(); try { localStorage.setItem('webconsole.theme', next) } catch { /* private mode */ } })
window.addEventListener('pagehide', () => { clearInterval(liveTimer); source?.close(); current?.abort.abort(); current?.cleanup.forEach(fn => fn()) })
window.addEventListener('pageshow', event => { if (event.persisted) { startLiveTimer(); connectSSE(); void router() } })
try { await loadStatus(); await loadStories(); startLiveTimer(); connectSSE(); await router() } catch (error) { $('#connection-error').textContent = error.message; await router() }




