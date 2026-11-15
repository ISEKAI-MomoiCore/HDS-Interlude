/** 全功能实机测试 T2 批次（2026-11-15）：真实模型 + 生产提示词 + 真实链路重放。
 * 覆盖 A1/A6/A11/A12 与 C1/C2/C3/C5/C6/C7。手动运行：
 *   node --import tsx test/simulate-full-feature-t2.mjs [section]
 * 环境变量同 test/model-behavior.test.ts。凭据不落盘。 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { Agent, setGlobalDispatcher } from 'undici'
import { systemPrompt, compactionPrompt } from '../../src/narrator.ts'
import { urgeInstruction } from '../../src/urge.ts'
import { resolveManualSpecialty } from '../../src/specialization.ts'
import { normalizeDecision } from '../../src/service.ts'
import { readAuthoredActions } from '../../src/script/authored-actions.ts'
import { parseCommunicationActions } from '../../src/script/contact-actions.ts'

const ENDPOINT = process.env.HDSI_TEST_PROVIDER_ENDPOINT ?? ''
const API_KEY = process.env.HDSI_TEST_API_KEY ?? ''
const MODEL = process.env.HDSI_TEST_MODEL ?? ''
if (!ENDPOINT || !API_KEY || !MODEL) { console.error('missing HDSI_TEST_* env'); process.exit(1) }
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))
const SPECIALTY = resolveManualSpecialty(MODEL, 'full', 'claude')
const NOW = new Date('2026-11-15T12:00:00.000Z')
const WRITES = { messageSeparator: '<sep/>', splitReplyMessages: true }

async function callModel(system, userPayload, timeoutMs = 120_000) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: MODEL, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: userPayload }] }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        const text = await response.text()
        if (response.status >= 500 && attempt < 3) continue
        throw new Error(`API ${response.status}: ${text.slice(0, 200)}`)
      }
      const json = await response.json()
      return JSON.parse(json.choices[0].message.content)
    } catch (error) {
      const retryable = error instanceof SyntaxError || error instanceof TypeError
        || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
      if (!retryable || attempt === 3) throw error
    }
  }
}

const prompt = (phase, urge = false) => systemPrompt(phase, '', '', '', '', '', false, false, false, false, false,
  undefined, false, undefined, false, false, false, false, WRITES, SPECIALTY) + (urge ? urgeInstruction(true, phase) : '')

const PARTICIPANTS = [
  { id: 'p-chen', name: '陈晚', relation: '大学室友，无话不谈', lastUserMessageAt: '2026-11-12T22:00:00+08:00' },
  { id: 'p-lin', name: '林芝', relation: '同社团的学妹，聊得来', lastUserMessageAt: '2026-11-14T09:00:00+08:00' },
]
const GROUPS = [{ id: 'g-bookclub', label: '读书会群' }]
const base = (extra, event) => JSON.stringify({
  interval: { from: '2026-11-15T03:00:00Z', now: '2026-11-15T04:00:00Z', elapsedSeconds: 3600, nowLocal: '2026-11-15 12:00:00', nowLocalContext: { timezone: 'Asia/Shanghai', period: 'noon' } },
  currentEvent: event ?? { type: 'life-advance' },
  recentScript: [
    { id: 1, kind: 'protagonist-narrative', content: '上午在图书馆赶论文。', occurredAt: '2026-11-15T02:30:00Z' },
    { id: 2, kind: 'user-delivered-message', participant: '陈晚', content: '那家咖啡店的猫又胖了哈哈', occurredAt: '2026-11-12T14:00:00Z' },
    ...extra,
  ],
  participants: PARTICIPANTS, groups: GROUPS,
})

const runtimeCfg = { captureDirectMessages: true, autoCreate: true, ignoreCommandMessages: true, allowProactiveMessages: true, sweepIntervalMinutes: 3, minimumAdvanceMinutes: 40, maxStoriesPerSweep: 25, contextEntryLimit: 40, memoryLimit: 30, maxScriptCharacters: 1400, maxMessageCharacters: 1200, minimumDelayedReplySeconds: 3, maximumDelayedReplyMinutes: 240, cancelDelayedRepliesOnUserMessage: true }
const sharedCfg = { autoEnrollParticipants: true, allowCrossConversationMessages: true, shareParticipantDetails: true, maxCrossConversationActions: 3, participantContextLimit: 6, managerAccounts: [] }
const replay = raw => normalizeDecision(raw, NOW, NOW, true, runtimeCfg, sharedCfg, 'protagonist', new Set(['p-chen', 'p-lin']), new Set(['g-bookclub']), 'advance')

// ─────────────────────────── 场景定义 ───────────────────────────

const ADVANCE = [
  { key: 'share-funny', motive: 'p-chen', extra: [{ id: 3, kind: 'protagonist-narrative', content: '午休刷到极好笑的猫咪视频，笑出声，想到陈晚也爱猫。', occurredAt: '2026-11-15T03:50:00Z' }] },
  { key: 'exam-lin', motive: 'p-lin', extra: [{ id: 3, kind: 'protagonist-narrative', content: '忽然想起林芝说过明天上午考证，心里记挂了一下。', occurredAt: '2026-11-15T03:45:00Z' }] },
  { key: 'overdue-chen', motive: 'p-chen', extra: [{ id: 3, kind: 'protagonist-narrative', content: '前天陈晚约饭她放了鸽子，一直有点过意不去。', occurredAt: '2026-11-15T03:20:00Z' }] },
  { key: 'promise-photos', motive: 'future', extra: [{ id: 3, kind: 'protagonist-narrative', content: '昨晚答应陈晚傍晚把聚会照片发她，现在先记着这事儿。', occurredAt: '2026-11-15T03:40:00Z' }] },
  { key: 'two-friends', motive: 'p-chen+p-lin', extra: [{ id: 3, kind: 'protagonist-narrative', content: '导师在组会上把咖啡洒在键盘上，全场憋笑——这事陈晚和林芝都会乐。', occurredAt: '2026-11-15T03:50:00Z' }] },
  { key: 'group-review', motive: 'group', extra: [{ id: 3, kind: 'protagonist-narrative', content: '翻日历看到周五要交读书会书评，琢磨在群里说一声自己进度落后。', occurredAt: '2026-11-15T03:30:00Z' }] },
  { key: 'no-motive', motive: null, extra: [{ id: 3, kind: 'protagonist-narrative', content: '她收拾了书桌，给绿萝浇了水，心里很平静。', occurredAt: '2026-11-15T03:35:00Z' }] },
  { key: 'busy-focus', motive: null, extra: [{ id: 3, kind: 'protagonist-narrative', content: '论文最后一章卡住了，她揉揉眼睛决定继续磨，没心思聊天。', occurredAt: '2026-11-15T03:55:00Z' }] },
  { key: 'lin-movie', motive: 'p-lin', extra: [{ id: 3, kind: 'protagonist-narrative', content: '路过影院看到林芝提过想看的那部片上映了，想着叫她一起。', occurredAt: '2026-11-15T03:25:00Z' }] },
  { key: 'chen-cold', motive: 'p-chen', extra: [{ id: 3, kind: 'protagonist-narrative', content: '陈晚在群里说重感冒请假了，她有点担心。', occurredAt: '2026-11-15T03:15:00Z' }] },
]

const TIME_CASES = [
  { key: 'night-prose-noon-now', recent: '夜深了，她合上笔记本准备睡觉。' },
  { key: 'morning-prose-noon-now', recent: '清晨的阳光洒进房间，她刚起床。' },
  { key: 'evening-prose-noon-now', recent: '晚饭后她出门散步，路灯刚亮。' },
  { key: 'night-prose-noon-now-2', recent: '又是熬夜的一晚，她盯着天花板。' },
  { key: 'dawn-prose-noon-now', recent: '天蒙蒙亮，她收拾出门。' },
  { key: 'night-prose-noon-now-3', recent: '室友都睡了，她还在赶稿。' },
]

const PRIVATE_MSGS = ['晚上吃什么', '今天好累啊', '跟你说个事', '哈哈哈哈笑死', '在忙吗']

// ─────────────────────────── 分节执行 ───────────────────────────

const results = { advance: [], private: [], time: [], compaction: [], urge: [] }
const only = process.argv[2]

async function sectionAdvance() {
  const system = prompt('advance')
  for (const scenario of ADVANCE) {
    const started = Date.now()
    try {
      const raw = await callModel(system, base(scenario.extra))
      const rec = { key: scenario.key, ms: Date.now() - started, raw }
      const parsed = readAuthoredActions(String(raw.script ?? ''))
      const unified = parseCommunicationActions(raw.communicationActions, String(raw.script ?? ''), {
        phase: 'advance', permittedParticipantIds: new Set(PARTICIPANTS.map(p => p.id)), permittedGroupIds: new Set(['g-bookclub']),
      })
      const decision = replay(raw)
      rec.metrics = {
        jsonOk: true,
        scriptLen: String(raw.script ?? '').length,
        sayCount: parsed.actions.length,
        explicitActions: unified.actions.map(a => `${a.target.kind}:${a.target.id}:${a.timing}`),
        rejected: unified.rejected,
        formedActions: decision.crossConversationActions.map(a => `${a.participantId}:${a.mode}`),
        plans: decision.intents.filter(i => i.type === 'contact-plan').length,
        legacyCross: (raw.crossConversationActions ?? []).length,
      }
      results.advance.push(rec)
      console.log(`[advance] ${scenario.key}: 动作=${JSON.stringify(rec.metrics.explicitActions)} 内部=${JSON.stringify(rec.metrics.formedActions)} 计划=${rec.metrics.plans} (${rec.ms}ms)`)
    } catch (error) {
      results.advance.push({ key: scenario.key, ms: Date.now() - started, error: String(error).slice(0, 200) })
      console.log(`[advance] ${scenario.key}: ERROR ${String(error).slice(0, 120)}`)
    }
  }
}

async function sectionPrivate() {
  const system = prompt('user-message')
  for (const msg of PRIVATE_MSGS) {
    const started = Date.now()
    try {
      const raw = await callModel(system, JSON.stringify({
        interval: { from: '2026-11-15T03:55:00Z', now: '2026-11-15T04:00:00Z', elapsedSeconds: 300, nowLocal: '2026-11-15 12:00:00', nowLocalContext: { timezone: 'Asia/Shanghai', period: 'noon' } },
        currentEvent: { type: 'private-message-batch', content: msg, observedAtLocal: '2026-11-15 12:00:00' },
        recentScript: [{ kind: 'protagonist-narrative', content: '她在书房写歌。', occurredAt: '2026-11-15T03:30:00Z' }],
      }))
      const reply = raw.interaction?.reply
      const rec = { key: msg, ms: Date.now() - started,
        metrics: { mode: reply?.mode, seen: raw.interaction?.seen, contentLen: String(reply?.content ?? '').length, inScript: !reply?.content || String(raw.script ?? '').includes(reply.content.slice(0, 15)) } }
      results.private.push(rec)
      console.log(`[private] ${msg}: mode=${rec.metrics.mode} seen=${rec.metrics.seen} 剧本一致=${rec.metrics.inScript} (${rec.ms}ms)`)
    } catch (error) {
      results.private.push({ key: msg, error: String(error).slice(0, 200) })
      console.log(`[private] ${msg}: ERROR`)
    }
  }
}

async function sectionTime() {
  const system = prompt('advance')
  for (const scenario of TIME_CASES) {
    try {
      const raw = await callModel(system, base([{ id: 3, kind: 'protagonist-narrative', content: scenario.recent, occurredAt: '2026-11-15T02:50:00Z' }]))
      const script = String(raw.script ?? '')
      // 时间遵循：剧本不应延续"夜晚"语义（nowLocal=正午）；检测夜晚词是否出现在结尾段落
      const tail = script.slice(-300)
      const nightWords = /深夜|夜色|凌晨|该睡了|准备睡觉|晚安/.test(tail)
      results.time.push({ key: scenario.key, follows: !nightWords, nightWords, scriptLen: script.length })
      console.log(`[time] ${scenario.key}: 遵循正午=${!nightWords}`)
    } catch (error) {
      results.time.push({ key: scenario.key, error: String(error).slice(0, 200) })
      console.log(`[time] ${scenario.key}: ERROR`)
    }
  }
}

async function sectionCompaction() {
  const system = compactionPrompt('', '', '', '', { tier: 'full' })
  for (const variant of ['daily', 'emotional']) {
    try {
      const raw = await callModel(system, JSON.stringify({
        interval: { now: '2026-11-15T04:00:00Z', nowLocal: '2026-11-15 12:00:00' },
        entries: variant === 'daily'
          ? [{ id: 1, kind: 'user-delivered-message', participant: '陈晚', content: '周六展览你去吗', occurredAt: '2026-11-14T10:00:00Z' },
             { id: 2, kind: 'protagonist-narrative', content: '她回说周六已有安排，改约下周。', occurredAt: '2026-11-14T10:05:00Z' }]
          : [{ id: 1, kind: 'user-delivered-message', participant: '林芝', content: '我可能要退社团了', occurredAt: '2026-11-14T10:00:00Z' },
             { id: 2, kind: 'protagonist-narrative', content: '她愣了一下，问是不是因为期末压力。', occurredAt: '2026-11-14T10:05:00Z' }],
        precedingEntries: [], precedingSummaries: [],
      }))
      const facts = Array.isArray(raw.facts) ? raw.facts.length : 0
      const patches = Array.isArray(raw.statePatches) ? raw.statePatches.length : 0
      const validSources = [...(raw.facts ?? []), ...(raw.statePatches ?? [])].every(item => Array.isArray(item.sourceEntryIds) && item.sourceEntryIds.every(id => [1, 2].includes(id)))
      results.compaction.push({ key: variant, facts, patches, validSources })
      console.log(`[compaction] ${variant}: facts=${facts} patches=${patches} 来源合法=${validSources}`)
    } catch (error) {
      results.compaction.push({ key: variant, error: String(error).slice(0, 200) })
      console.log(`[compaction] ${variant}: ERROR`)
    }
  }
}

async function sectionUrge() {
  const system = prompt('advance', true)
  for (const scenario of ['午睡刚醒', '赶论文焦头烂额', '睡前刷手机']) {
    try {
      const raw = await callModel(system, base([{ id: 3, kind: 'protagonist-narrative', content: `这一段她${scenario}。`, occurredAt: '2026-11-15T03:50:00Z' }]))
      const urge = raw.urge ?? {}
      const rec = { key: scenario,
        metrics: { pace: urge.pace, rhythm: urge.rhythmAttention, suggested: urge.suggestedDelayMinutes, quoteOk: typeof urge.basisQuote === 'string' && String(raw.script ?? '').includes(urge.basisQuote ?? '\u0000'), hasValue: urge.value !== undefined } }
      results.urge.push(rec)
      console.log(`[urge] ${scenario}: pace=${rec.metrics.pace} rhythm=${rec.metrics.rhythm} suggested=${rec.metrics.suggested} 引文锚定=${rec.metrics.quoteOk} 含弃用value=${rec.metrics.hasValue}`)
    } catch (error) {
      results.urge.push({ key: scenario, error: String(error).slice(0, 200) })
      console.log(`[urge] ${scenario}: ERROR`)
    }
  }
}

// ─────────────────────────── 汇总 ───────────────────────────

function summarize() {
  console.log('\n=== C1 JSON 合规 ===')
  const all = [...results.advance, ...results.private, ...results.time, ...results.compaction, ...results.urge]
  const ok = all.filter(r => !r.error)
  console.log(`成功 ${ok.length}/${all.length}`)
  console.log('\n=== C2/C3/C5/C6 advance 命中率 ===')
  const adv = results.advance.filter(r => r.metrics)
  const totalActions = adv.flatMap(r => r.metrics.formedActions)
  const byMotive = { }
  for (const rec of adv) {
    const scenario = ADVANCE.find(s => s.key === rec.key)
    const wantContact = scenario.motive && scenario.motive !== null
    const formed = rec.metrics.formedActions.length + rec.metrics.plans
    const group = wantContact ? '有动机' : '无动机'
    byMotive[group] ??= { total: 0, acted: 0 }
    byMotive[group].total++
    if (group === '有动机' ? formed > 0 : formed === 0) byMotive[group].acted++
  }
  console.log('动机→动作转换：', JSON.stringify(byMotive))
  console.log(`显式 communicationActions 采用：${adv.filter(r => r.metrics.explicitActions.length > 0).length}/${adv.length}；legacy cross 混用：${adv.filter(r => r.metrics.legacyCross > 0).length}`)
  console.log(`say 绑定拒绝总数：${adv.reduce((sum, r) => sum + r.metrics.rejected.length, 0)}`)
  console.log(`future 计划形成：${adv.filter(r => r.metrics.plans > 0).map(r => r.key)}`)
  console.log('\n=== C7 时间遵循 ===')
  const time = results.time.filter(r => !r.error)
  console.log(`遵循正午 ${time.filter(r => r.follows).length}/${time.length}`)
  console.log('\n=== A1 私聊 ===')
  const priv = results.private.filter(r => r.metrics)
  console.log(`immediate ${priv.filter(r => r.metrics.mode === 'immediate').length}/${priv.length}；seen 字段齐全 ${priv.filter(r => r.metrics.seen !== undefined).length}/${priv.length}；内容锚定剧本 ${priv.filter(r => r.metrics.inScript).length}/${priv.length}`)
  console.log('\n=== A12 压缩 ===', JSON.stringify(results.compaction.filter(r => !r.error)))
  console.log('=== A11 Urge 交接 ===', JSON.stringify(results.urge.filter(r => !r.error).map(r => ({ key: r.key, ...r.metrics }))))
}

const sections = { advance: sectionAdvance, private: sectionPrivate, time: sectionTime, compaction: sectionCompaction, urge: sectionUrge }
const runner = async () => {
  if (only && sections[only]) { await sections[only](); summarize(); }
  else { for (const key of Object.keys(sections)) await sections[key](); summarize() }
  const dir = 'C:/dev/artifacts/hdsi-full-feature-t2-20261115'
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2))
  console.log(`\n[archive] ${dir}/results.json`)
}
runner().catch(error => { console.error(error); process.exit(1) })
