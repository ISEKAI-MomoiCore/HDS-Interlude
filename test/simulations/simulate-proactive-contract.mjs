/** 主动联系统一动作：真实模型模拟（P1 新格式解析率 / P3 旧链盲评基线）。
 * 手动运行：node --import tsx test/simulate-proactive-contract.mjs <new-format|legacy>
 * 环境变量与 test/model-behavior.test.ts 相同（HDSI_TEST_*）；凭据不落盘。 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { Agent, setGlobalDispatcher } from 'undici'
import { systemPrompt } from '../../src/narrator.ts'
import { readAuthoredActions } from '../../src/script/authored-actions.ts'
import { parseCommunicationActions } from '../../src/script/contact-actions.ts'

const ENDPOINT = process.env.HDSI_TEST_PROVIDER_ENDPOINT ?? ''
const API_KEY = process.env.HDSI_TEST_API_KEY ?? ''
const MODEL = process.env.HDSI_TEST_MODEL ?? ''
const MODE = process.argv[2] ?? 'new-format'
if (!ENDPOINT || !API_KEY || !MODEL) { console.error('missing HDSI_TEST_* env'); process.exit(1) }
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))
const sampling = process.env.HDSI_TEST_SAMPLING === 'off' ? {} : { temperature: 0.72, top_p: 0.8 }

const PARTICIPANTS = [
  { id: 'p-chen', name: '陈晚', relation: '大学室友，无话不谈', lastUserMessageAt: '2026-11-11T22:00:00+08:00' },
  { id: 'p-lin', name: '林芝', relation: '同社团的学妹，聊得来', lastUserMessageAt: '2026-11-13T09:00:00+08:00' },
]
const GROUPS = [{ id: 'g-bookclub', label: '读书会群', note: '周五要交书评' }]
const BASE = (extraScript, extraEvent) => JSON.stringify({
  interval: { from: '2026-11-14T03:00:00Z', now: '2026-11-14T04:00:00Z', elapsedSeconds: 3600, nowLocal: '2026-11-14 12:00:00', nowLocalContext: { timezone: 'Asia/Shanghai', period: 'noon' } },
  currentEvent: extraEvent ?? { type: 'life-advance', observedAtLocal: '2026-11-14 12:00:00' },
  recentScript: [
    { id: 1, kind: 'protagonist-narrative', content: '上午在图书馆赶论文，效率不错。', occurredAt: '2026-11-14T02:30:00Z' },
    { id: 2, kind: 'user-delivered-message', participant: '陈晚', content: '那家咖啡店的猫又胖了哈哈', occurredAt: '2026-11-11T14:00:00Z' },
    ...extraScript,
  ],
  participants: PARTICIPANTS, groups: GROUPS,
})

const SCENARIOS = [
  { key: 'share-funny', label: '看到趣事想分享（室友）', payload: BASE([{ id: 3, kind: 'protagonist-narrative', content: '午休刷到一个极好笑的猫咪视频，笑出声，想到陈晚也爱猫。', occurredAt: '2026-11-14T03:50:00Z' }]) },
  { key: 'exam-encourage', label: '朋友明天考试想鼓励（学妹）', payload: BASE([{ id: 3, kind: 'protagonist-narrative', content: '忽然想起林芝说过明天上午考证，心里记挂了一下。', occurredAt: '2026-11-14T03:45:00Z' }]) },
  { key: 'no-contact', label: '忙于论文、不联系', payload: BASE([{ id: 3, kind: 'protagonist-narrative', content: '论文最后一章卡住了，她揉揉眼睛决定继续磨，没心思聊天。', occurredAt: '2026-11-14T03:55:00Z' }]) },
  { key: 'promise-evening', label: '承诺傍晚发照片（未来计划）', payload: BASE([{ id: 3, kind: 'protagonist-narrative', content: '昨晚答应陈晚傍晚把聚会照片发她，现在先记着这事儿。', occurredAt: '2026-11-14T03:40:00Z' }]) },
  { key: 'two-friends', label: '同一趣事告诉两个朋友（多目标）', payload: BASE([{ id: 3, kind: 'protagonist-narrative', content: '导师在组会上把咖啡洒在了键盘上，全场憋笑——这事陈晚和林芝都会乐。', occurredAt: '2026-11-14T03:50:00Z' }]) },
  { key: 'group-note', label: '读书会群的书评提醒（群目标）', payload: BASE([{ id: 3, kind: 'protagonist-narrative', content: '翻日历看到周五要交读书会书评，琢磨在群里说一声自己进度落后。', occurredAt: '2026-11-14T03:30:00Z' }]) },
  { key: 'overdue-apology', label: '拖了两天的道歉', payload: BASE([{ id: 3, kind: 'protagonist-narrative', content: '前天陈晚约饭她放了个鸽子，一直有点过意不去。', occurredAt: '2026-11-14T03:20:00Z' }]) },
  { key: 'plain-silence', label: '平静无动机的生活', payload: BASE([{ id: 3, kind: 'protagonist-narrative', content: '她收拾了书桌，给绿萝浇了水，心里很平静。', occurredAt: '2026-11-14T03:35:00Z' }]) },
]

const NEW_FORMAT_ADDENDUM = `
COMMUNICATION ACTIONS (new contract, supersedes any mirror/cross-action instruction above):
If her script shows her sending a message, mark the exact message text inside the prose with tags: <say id="a1">消息原文</say>. The tagged words remain part of the narrative; the tag only marks authorship. Then list each logical send in the JSON output:
"communicationActions": [{"id":"a1","target":{"kind":"participant","id":"listed participant id"},"timing":"now"}]
Rules: message content appears exactly once, inside its say tag; one entry per logical message per target; a group target uses {"kind":"group","id":"listed group id"}; timing "future" requires "dueAt" (future ISO-8601) and means she plans to send later — the script must NOT show it as already sent; never invent participants or groups; omit communicationActions entirely when she sends nothing.`

function buildSystem(mode, legacyContactMode) {
  const base = systemPrompt('advance', '', '', '', '', '', false, false, mode === 'legacy', false, false,
    undefined, false, undefined, false, false, false, false, { messageSeparator: '<sep/>', splitReplyMessages: true },
    undefined, legacyContactMode ?? 'strict')
  // P3 后生产提示词本身即统一契约；legacy 模式保留旧附加说明无意义，两者同基座。
  return base
}

async function callModel(system, userPayload) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: MODEL, ...sampling, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: userPayload }] }),
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) {
        const text = await response.text()
        if (response.status >= 500 && attempt < 3) continue
        throw new Error(`API ${response.status}: ${text.slice(0, 300)}`)
      }
      const json = await response.json()
      return JSON.parse(json.choices[0].message.content)
    } catch (error) {
      const retryable = error instanceof TypeError || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
      if (!retryable || attempt === 3) throw error
    }
  }
}

const context = {
  phase: 'advance',
  permittedParticipantIds: new Set(PARTICIPANTS.map(item => item.id)),
  permittedGroupIds: new Set(GROUPS.map(item => item.id)),
}

async function run() {
  const useLegacy = MODE === 'legacy'
  const runs = []
  const batches = useLegacy ? ['strict', 'natural'] : ['new']
  for (const batch of batches) {
    const system = buildSystem(useLegacy ? 'legacy' : 'new-format', batch)
    for (const scenario of SCENARIOS.slice(0, useLegacy ? SCENARIOS.length : 6)) {
      const started = Date.now()
      try {
        const raw = await callModel(system, scenario.payload)
        const record = { batch, scenario: scenario.key, label: scenario.label, ms: Date.now() - started, raw }
        if (useLegacy) {
          const contact = raw.proactiveContact
          record.analysis = {
            hasAgencyWindow: !!raw.agencyWindow,
            hasContact: !!contact,
            origin: contact?.origin, disclosure: contact?.disclosure, outcome: contact?.outcome,
            willingness: typeof contact?.willingness === 'number' ? contact.willingness : null,
            notBefore: contact?.notBefore ?? null, expiresAt: contact?.expiresAt ?? null,
            mirrorAction: (raw.crossConversationActions ?? []).map(action => ({ participantId: action.participantId, mode: action.mode, willingness: action.willingness ?? null })),
            mirrorInScript: (raw.crossConversationActions ?? []).every(action => !action?.content || String(raw.script ?? '').includes(String(action.content).slice(0, 20))),
          }
        } else {
          const scriptText = String(raw.script ?? '')
          const parsed = readAuthoredActions(scriptText)
          const result = parseCommunicationActions(raw.communicationActions, scriptText, context)
          const proseWithoutSpans = parsed.actions.reduce((text, action) => text.replace(action.content, ''), parsed.prose)
          record.analysis = {
            sayCount: parsed.actions.length, sayIds: parsed.actions.map(action => action.id),
            accepted: result.actions.map(action => ({ id: action.localId, target: action.target, timing: action.timing, label: action.sourceLabel, quote: action.textQuote.slice(0, 30) })),
            rejected: result.rejected,
            contentDuplicatedOutsideSpan: parsed.actions.some(action => action.content.trim().length >= 6 && proseWithoutSpans.includes(action.content.trim())),
          }
        }
        runs.push(record)
        console.log(`[${batch}] ${scenario.key}: ok (${record.ms}ms) ${JSON.stringify(record.analysis.accepted ?? record.analysis.outcome ?? '')}`)
      } catch (error) {
        runs.push({ batch, scenario: scenario.key, label: scenario.label, ms: Date.now() - started, error: String(error).slice(0, 300) })
        console.log(`[${batch}] ${scenario.key}: ERROR ${String(error).slice(0, 160)}`)
      }
    }
  }
  const dir = 'C:/dev/artifacts/hdsi-proactive-sim-20261114'
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/${MODE}.json`, JSON.stringify(runs, null, 2))
  summarize(runs, useLegacy)
  console.log(`\n[archive] ${dir}/${MODE}.json (${runs.length} runs)`)
}

function summarize(runs, legacy) {
  const ok = runs.filter(run => !run.error)
  console.log(`\n=== ${MODE} 汇总：成功 ${ok.length}/${runs.length} ===`)
  if (legacy) {
    for (const batch of ['strict', 'natural']) {
      const rows = ok.filter(run => run.batch === batch)
      const contacts = rows.filter(run => run.analysis.hasContact)
      const outcomes = contacts.map(run => run.analysis.outcome)
      const willingness = contacts.map(run => run.analysis.willingness).filter(value => value != null)
      console.log(`[${batch}] 场景=${rows.length} 有联系判断=${contacts.length} outcome=${JSON.stringify(outcomes)}`)
      console.log(`[${batch}] willingness=${JSON.stringify(willingness)} 缺失=${contacts.filter(run => run.analysis.willingness === null).length}`)
      console.log(`[${batch}] send-now镜像一致=${contacts.filter(run => run.analysis.outcome === 'send-now').every(run => run.analysis.mirrorAction.length > 0 && run.analysis.mirrorInScript)}`)
    }
    return
  }
  const accepted = ok.flatMap(run => run.analysis.accepted)
  const rejected = ok.flatMap(run => run.analysis.rejected)
  console.log(`say 绑定成功动作=${accepted.length} 拒绝=${rejected.length} ${JSON.stringify(rejected.reduce((count, item) => ({ ...count, [item.reason]: (count[item.reason] ?? 0) + 1 }), {}))}`)
  console.log(`timing 分布=${JSON.stringify(accepted.reduce((count, item) => ({ ...count, [item.timing]: (count[item.timing] ?? 0) + 1 }), {}))}`)
  console.log(`目标分布=${JSON.stringify(accepted.reduce((count, item) => ({ ...count, [item.target.id]: (count[item.target.id] ?? 0) + 1 }), {}))}`)
  console.log(`内容在 say 外重复=${ok.filter(run => run.analysis.contentDuplicatedOutsideSpan).length}/${ok.length}`)
  const two = ok.find(run => run.scenario === 'two-friends')
  if (two) console.log(`多目标场景：动作数=${two.analysis.accepted.length} 目标=${two.analysis.accepted.map(item => item.target.id).join(',')}`)
}

run().catch(error => { console.error(error); process.exit(1) })
