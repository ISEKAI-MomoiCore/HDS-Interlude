require('tsx/cjs/api').register()
const fs = require('fs')
let src = fs.readFileSync('backup/2026-09-03-timeline-fix/service.ts', 'utf8')
const startFn = src.indexOf('export function detectLiveScriptTimeOverflow')
const endFn = src.indexOf('function chineseClockNumber')
const chineseEnd = src.indexOf('\n}', src.indexOf('return value.length === 1', endFn)) + 2
let chinese = src.slice(endFn, chineseEnd)
let guardBody = src.slice(startFn).split('\n').slice(0, 22).join('\n').replace('export ', '')
// 剥 TS 类型标注
chinese = chinese.replace('function chineseClockNumber(value: string)', 'function chineseClockNumber(value)')
  .replace('const digits: Record<string, number> =', 'const digits =')
guardBody = guardBody
  .replace('function detectLiveScriptTimeOverflow(script: unknown, phase: NarrativeRequest[\'phase\'], from: Date, now: Date, timezone: string)', 'function detectLiveScriptTimeOverflow(script, phase, from, now, timezone)')
  .replace('const clockMatches = text.matchAll', 'const clockMatches = text.matchAll')
const Time = { minute: 60_000 }
const storyLocalTimeContext = (value, timezone) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(value)
  const p = t => parts.find(x => x.type === t)?.value ?? ''
  return { time: `${p('hour')}:${p('minute')}:${p('second')}`, hour: Number(p('hour')) }
}
const fn = new Function('Time', 'storyLocalTimeContext', chinese + '\n' + guardBody + '\nreturn detectLiveScriptTimeOverflow')(Time, storyLocalTimeContext)
const from = new Date('2026-09-03T23:30:00.000Z'), now = new Date('2026-09-03T23:47:40.000Z')
console.log('旧版守卫（beta7修复前）· 中文八点 →', fn('她想起小桃说的八点赶到万松园的约定。', 'user-message', from, now, 'Asia/Shanghai') ?? '放行')
console.log('旧版守卫 · 数字 08:00 →', fn('08:00 她出现在校门口。', 'user-message', from, now, 'Asia/Shanghai') ?? '放行')
