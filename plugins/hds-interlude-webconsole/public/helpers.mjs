/** Pure view helpers, shared with regression tests. No browser globals. */
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const array = value => Array.isArray(value) ? value : []
export function toDate(value) {
  if (value == null || value === '') return null
  let normalized = value
  if (typeof value === 'string' && /^\d{12,14}$/.test(value)) normalized = Number(value)
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) normalized = value.replace(' ', 'T') + (/Z$|[+-]\d{2}:\d{2}$/.test(value) ? '' : 'Z')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}
export function fmtTime(value, timezone) {
  const date = toDate(value)
  if (!date) return value == null || value === '' ? '—' : String(value)
  try { return date.toLocaleString('zh-CN', { timeZone: timezone || undefined, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) }
  catch { return date.toISOString() }
}
export function localDate(value, timezone = 'UTC') {
  const date = toDate(value)
  if (!date) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    const get = key => parts.find(p => p.type === key)?.value
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch { return null }
}
export function validDay(day) { return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && toDate(day)?.toISOString().slice(0, 10) === day }
export function addDays(day, n) { return validDay(day) ? new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10) : null }
export function weekStart(day) {
  if (!validDay(day)) return null
  return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))
}
function minutes(clock) {
  if (!/^\d{2}:\d{2}$/.test(clock ?? '')) return null
  const [h, m] = clock.split(':').map(Number)
  return h >= 0 && h < 24 && m >= 0 && m < 60 ? h * 60 + m : clock === '24:00' ? 1440 : null
}
/** Cross-midnight tails come from the persisted previous day, not a guessed weekly rule. */
export function calendarWeek(materializedDays, monday) {
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(monday, i), blocks: [], covered: false }))
  const byDate = new Map(days.map(d => [d.date, d]))
  for (const source of array(materializedDays)) {
    if (!validDay(source?.date)) continue
    if (byDate.has(source.date)) byDate.get(source.date).covered = true
    for (const block of array(source.blocks)) {
      const start = minutes(block?.start), end = minutes(block?.end)
      if (start == null || end == null || start >= 1440 || start === end) continue
      const push = (date, from, to, carry) => {
        if (to > from && byDate.has(date)) byDate.get(date).blocks.push({ ...block, sourceDate: source.date, from, to, carry, displayStart: carry ? '00:00' : block.start, displayEnd: to === 1440 ? '24:00' : block.end })
      }
      if (end > start) push(source.date, start, end, false)
      else { push(source.date, start, 1440, false); push(addDays(source.date, 1), 0, end, true) }
    }
  }
  for (const day of days) day.blocks.sort((a, b) => a.from - b.from || a.to - b.to)
  return days
}
/** LCS text diff, bounded to avoid pathological audit-record memory use. */
export function textDiff(before, after) {
  const a = String(before ?? '').split('\n'), b = String(after ?? '').split('\n')
  if (a.length > 200 || b.length > 200 || String(before).length + String(after).length > 40000) return [{ type: 'remove', text: String(before ?? '') }, { type: 'add', text: String(after ?? '') }]
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1])
  let i = 0, j = 0; const result = []
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) result.push({ type: 'same', text: a[i++] }), j++
    else if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1])) result.push({ type: 'remove', text: a[i++] })
    else result.push({ type: 'add', text: b[j++] })
  }
  return result
}
export function appliedComparisons(patches) {
  const previous = new Map()
  return array(patches).filter(p => p.status === 'applied').sort((a, b) => (toDate(a.appliedAt ?? a.createdAt)?.getTime() ?? 0) - (toDate(b.appliedAt ?? b.createdAt)?.getTime() ?? 0) || a.id - b.id).map(patch => {
    const key = JSON.stringify([patch.target, patch.path, patch.participantId || ''])
    const before = previous.get(key) ?? null
    previous.set(key, patch)
    return { patch, before, diff: before ? textDiff(before.proposedValue, patch.proposedValue) : null }
  }).reverse()
}
export function chartSvg(history, field = 'alterValue', timezone) {
  const points = array(history).filter(h => typeof h?.[field] === 'number' && Number.isFinite(h[field]))
  if (!points.length) return ''
  const values = points.map(h => h[field]), min = Math.min(0, ...values), max = Math.max(0, ...values)
  const padding = Math.max((max - min) * .12, 1), lo = min - padding, hi = max + padding
  const x = i => points.length === 1 ? 450 : 64 + i * 772 / (points.length - 1)
  const y = value => 225 - (value - lo) / (hi - lo) * 193
  const grid = Array.from({ length: 5 }, (_, i) => lo + i * (hi - lo) / 4).map(v => `<line class="chart-grid" x1="64" x2="836" y1="${y(v)}" y2="${y(v)}"/><text class="chart-label" x="54" y="${y(v) + 4}" text-anchor="end">${Math.abs(v) < .05 ? "0.0" : v.toFixed(1)}</text>`).join('')
  return `<svg class="history-chart" viewBox="0 0 880 276" role="img" aria-label="${field === 'alterValue' ? '故事全局累计' : '单轮变化'}历史折线图，横轴为保存顺序，明细见下表">${grid}<line class="chart-zero" x1="64" x2="836" y1="${y(0)}" y2="${y(0)}"/><polyline class="chart-line" points="${points.map((h, i) => `${x(i)},${y(h[field])}`).join(' ')}"/>${points.map((h, i) => `<circle class="chart-point" cx="${x(i)}" cy="${y(h[field])}" r="4"><title>${esc(fmtTime(h.timestamp, timezone))} · turn ${esc(h.turn)} · ${esc(h[field])} · ${esc(h.participantId || '全局来源')}</title></circle>`).join('')}<text class="chart-label" x="64" y="260">turn ${esc(points[0].turn)}</text><text class="chart-label" x="836" y="260" text-anchor="end">turn ${esc(points.at(-1).turn)}</text></svg>`
}


