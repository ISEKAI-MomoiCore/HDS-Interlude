import assert from 'node:assert/strict'
import test from 'node:test'
import { systemPrompt, toPromptPayload } from '../src/narrator'
import {
  applySchedulePreplanProposal, DEFAULT_SCHEDULE_PREPLAN_CONFIG, materializeSchedulePreplan,
  nextSchedulePreplanTransition, schedulePreplanNeedsModel, schedulePreplanReviewDue, schedulePreplanWindow, SCHEDULE_PREPLAN_FOLLOWUP_COOLDOWN_MS, schedulePreplanEvidenceMentionsDateChange, schedulePreplanFollowUpDue } from '../src/schedule-preplan'
import { emptyStorySetting, emptyStoryState, NarrativeRequest, SchedulePreplanRecord, SchedulePreplanRegime, ScriptEntry } from '../src/types'

const regime: SchedulePreplanRegime = {
  id: 'summer', label: '暑假', from: '2026-08-01', to: '2026-09-02',
  weekly: {
    monday: [
      { id: 'class', start: '14:00', end: '17:00', label: '补课', kind: 'fixed' },
      { id: 'drawing', start: '20:00', end: '21:30', label: '画画', kind: 'flexible' },
    ],
    tuesday: [{ id: 'morning-rest', start: '09:00', end: '11:00', label: '休息', kind: 'open' }],
  },
}

function record(): SchedulePreplanRecord {
  const now = new Date('2026-08-30T00:00:00.000Z')
  return {
    storyId: 'story', revision: 2, timezone: 'Asia/Shanghai', validFrom: '2026-08-30', validThrough: '2026-09-12',
    lastReviewedLocalDate: '2026-08-30', lastEvidenceEntryId: 10, reviewReason: 'stable', regimes: [regime], exceptions: [],
    materializedDays: materializeSchedulePreplan([regime], [], '2026-08-30', 14), createdAt: now, updatedAt: now,
  }
}

test('Schedule Preplan expands recurring rules and applies dated exceptions deterministically', () => {
  const days = materializeSchedulePreplan([regime], [{
    date: '2026-08-31', mode: 'patch', reason: '停课', removeBlockIds: ['class'],
    blocks: [{ id: 'library', start: '15:00', end: '17:00', label: '图书馆', kind: 'flexible' }],
  }], '2026-08-31', 2)
  assert.deepEqual(days[1].blocks.map(item => item.id), ['library', 'drawing'])
  assert.deepEqual(days[2].blocks.map(item => item.id), ['morning-rest'])
})

test('life-stage boundaries switch from vacation to school without leaking the old weekly plan', () => {
  const school: SchedulePreplanRegime = {
    id: 'school-term', label: '开学后', from: '2026-09-01',
    weekly: { tuesday: [{ id: 'at-school', start: '07:20', end: '17:20', label: '在校', kind: 'fixed' }] },
  }
  const vacation = { ...regime, to: '2026-08-31' }
  const days = materializeSchedulePreplan([vacation, school], [], '2026-08-31', 2)
  assert.deepEqual(days[1].blocks.map(item => item.id), ['class', 'drawing'])
  assert.deepEqual(days[2].blocks.map(item => item.id), ['at-school'])
})

test('main narration receives only the coming twelve hours, not the stored multi-day horizon', () => {
  const current = record()
  const now = new Date('2026-08-31T04:00:00.000Z') // 12:00 Asia/Shanghai
  const window = schedulePreplanWindow(current, now, 'Asia/Shanghai', 12)
  assert.ok(window)
  assert.equal(window!.name, 'Schedule Preplan')
  assert.deepEqual(window!.blocks.map(item => item.id), ['class', 'drawing'])
  assert.equal(window!.blocks.some(item => item.date > '2026-08-31'), false)
  assert.match(systemPrompt('advance', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, true), /roughly twelve hours/)
})

test('daily review is once per local day and unchanged reviews preserve revision', () => {
  const current = record()
  assert.equal(schedulePreplanReviewDue(current, new Date('2026-08-30T18:30:00.000Z'), 'Asia/Shanghai', DEFAULT_SCHEDULE_PREPLAN_CONFIG), false)
  assert.equal(schedulePreplanReviewDue(current, new Date('2026-08-31T04:00:00.000Z'), 'Asia/Shanghai', DEFAULT_SCHEDULE_PREPLAN_CONFIG), true)
  const evidence = [{ id: 11 }] as ScriptEntry[]
  const next = applySchedulePreplanProposal(current, { outcome: 'unchanged', reason: '没有足以改变日程的新证据', sourceEntryIds: [11] }, evidence, '2026-08-31', 'Asia/Shanghai', DEFAULT_SCHEDULE_PREPLAN_CONFIG, new Date('2026-08-31T04:00:00.000Z'))!
  assert.equal(next.revision, current.revision)
  assert.equal(next.lastEvidenceEntryId, 11)
  assert.equal(next.lastReviewedLocalDate, '2026-08-31')
})

test('an evidence-free first review persists an explicit empty schedule instead of retrying forever', () => {
  const now = new Date('2026-08-31T04:00:00.000Z')
  const empty = applySchedulePreplanProposal(
    undefined,
    { outcome: 'replace', reason: '暂无可靠的重复日程证据', regimes: [], exceptions: [] },
    [], '2026-08-31', 'Asia/Shanghai', DEFAULT_SCHEDULE_PREPLAN_CONFIG, now,
  )
  assert.ok(empty)
  assert.deepEqual(empty!.regimes, [])
  assert.equal(empty!.lastReviewedLocalDate, '2026-08-31')
  assert.equal(schedulePreplanNeedsModel(empty, [], '2026-08-31', 'Asia/Shanghai', DEFAULT_SCHEDULE_PREPLAN_CONFIG), false)
})

test('Chinese stable ids from a Chinese compaction model remain distinct', () => {
  const evidence = [{ id: 11 }] as ScriptEntry[]
  const next = applySchedulePreplanProposal(undefined, {
    outcome: 'replace', reason: '根据明确剧本建立暑假日程', sourceEntryIds: [11],
    regimes: [{ id: '暑假安排', label: '暑假', from: '2026-08-31', weekly: { monday: [{ id: '下午补课', start: '14:00', end: '17:00', label: '补课', kind: 'fixed', sourceEntryIds: [11] }] }, sourceEntryIds: [11] }],
  }, evidence, '2026-08-31', 'Asia/Shanghai', DEFAULT_SCHEDULE_PREPLAN_CONFIG, new Date('2026-08-31T04:00:00.000Z'))!
  assert.equal(next.regimes[0].id, '暑假安排')
  assert.equal(next.regimes[0].weekly.monday?.[0].id, '下午补课')
})

test('fixed blocks can anchor automatic advance while flexible hobbies cannot', () => {
  const current = record()
  const now = new Date('2026-08-31T05:30:00.000Z') // 13:30 local
  assert.equal(nextSchedulePreplanTransition(current, now, 'Asia/Shanghai')?.toISOString(), '2026-08-31T06:00:00.000Z')
})

test('granular tentative blocks use a stable activation and reveal only their vague availability early', () => {
  const now = new Date('2026-08-31T04:00:00.000Z') // 12:00 Asia/Shanghai
  let current: SchedulePreplanRecord | undefined
  for (let index = 0; index < 40 && !current; index++) {
    const candidate: SchedulePreplanRegime = {
      id: `candidate-regime-${index}`, label: '近期节奏', from: '2026-08-01',
      weekly: { monday: [{ id: `candidate-${index}`, start: '20:00', end: '21:00', label: '社团活动调整', kind: 'flexible', tentative: true }] },
    }
    const draft = { ...record(), regimes: [candidate], materializedDays: materializeSchedulePreplan([candidate], [], '2026-08-31', 14) }
    if (schedulePreplanWindow(draft, now, 'Asia/Shanghai', 12, { candidateActivationProbability: 0.5, candidateRevealMinutes: 120 })?.blocks.length) current = draft
  }
  assert.ok(current)
  const far = schedulePreplanWindow(current, now, 'Asia/Shanghai', 12, { candidateActivationProbability: 0.5, candidateRevealMinutes: 120 })!
  assert.equal(far.blocks[0].label, '可能的个人安排')
  const near = schedulePreplanWindow(current, new Date('2026-08-31T10:30:00.000Z'), 'Asia/Shanghai', 3, { candidateActivationProbability: 0.5, candidateRevealMinutes: 120 })!
  assert.equal(near.blocks[0].label, '社团活动调整')
})

test('stable and contextual reviews reject model-proposed tentative blocks', () => {
  const evidence = [{ id: 11 }] as ScriptEntry[]
  const proposal = {
    outcome: 'replace', reason: '有规律的晚间活动', sourceEntryIds: [11],
    regimes: [{ id: 'weekly', label: '日常', from: '2026-08-31', sourceEntryIds: [11], weekly: { monday: [{ id: 'maybe', start: '20:00', end: '21:00', label: '可能活动', kind: 'flexible', tentative: true, sourceEntryIds: [11] }] } }],
  }
  const stable = applySchedulePreplanProposal(undefined, proposal, evidence, '2026-08-31', 'Asia/Shanghai', DEFAULT_SCHEDULE_PREPLAN_CONFIG, new Date(), 'stable')!
  assert.deepEqual(stable.regimes[0].weekly.monday ?? [], [])
  const contextual = applySchedulePreplanProposal(undefined, proposal, evidence, '2026-08-31', 'Asia/Shanghai', DEFAULT_SCHEDULE_PREPLAN_CONFIG, new Date(), 'contextual')!
  assert.deepEqual(contextual.regimes[0].weekly.monday ?? [], [])
  const granular = applySchedulePreplanProposal(undefined, proposal, evidence, '2026-08-31', 'Asia/Shanghai', DEFAULT_SCHEDULE_PREPLAN_CONFIG, new Date(), 'granular')!
  assert.equal(granular.regimes[0].weekly.monday?.[0].tentative, true)
})

test('prompt payload exposes Schedule Preplan as planned structure separate from story state', () => {
  const now = new Date('2026-08-31T04:00:00.000Z')
  const story = { id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active' as const, setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now }
  story.setting.timezone = 'Asia/Shanghai'
  const request: NarrativeRequest = {
    phase: 'advance', story, from: now, now, participant: null, participants: [], shareParticipantDetails: false,
    dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [],
    schedulePreplan: schedulePreplanWindow(record(), now, 'Asia/Shanghai', 12),
  }
  const payload = toPromptPayload(request) as any
  assert.equal(payload.availableNearFuture.schedulePreplan.plannedNotObserved, true)
  assert.equal(payload.ongoingThreads.state.schedulePreplan, undefined)
  assert.ok(payload.availableNearFuture.schedulePreplan.blocks.length <= 8)
})

test('当天例外触发扫描：改约/取消/新确认命中，愿望与闲聊不命中', () => {
  const hit = schedulePreplanEvidenceMentionsDateChange([
    { id: 1, content: '她给对方发消息：今晚的健身取消啦，改天再约。' },
    { id: 2, content: '"那我们把见面改成八点半？"对方回复说好。' },
    { id: 3, content: '她和朋友敲定了周六上午十点的牙医。' },
  ])
  assert.deepEqual(hit, [1, 2, 3])
  const miss = schedulePreplanEvidenceMentionsDateChange([
    { id: 4, content: '她想去看那部新电影，但还没买票。' },
    { id: 5, content: '晚饭是昨天的剩面，味道一般。' },
  ])
  assert.deepEqual(miss, [])
  // 去重 + 非法 id 过滤
  const dupes = schedulePreplanEvidenceMentionsDateChange([
    { id: 7, content: '约好了周日去爬山' }, { id: 7, content: '约好了周日去爬山' }, { id: 0, content: '取消了' },
  ])
  assert.deepEqual(dupes, [7])
})

test('当天跟进审查到期：日审已过 + 冷却已过 + 未读含信号', () => {
  const config = { ...DEFAULT_SCHEDULE_PREPLAN_CONFIG, reviewAfterLocalHour: 3 }
  const tz = 'Asia/Shanghai'
  // 日审已于今晨完成（lastReviewedLocalDate=今天），updatedAt=3:20 本地
  const reviewed = {
    storyId: 's', revision: 1, timezone: tz, validFrom: '2026-10-02', validThrough: '2026-10-15',
    lastReviewedLocalDate: '2026-10-02', lastEvidenceEntryId: 100, reviewReason: 'r',
    regimes: [], exceptions: [], materializedDays: [],
    createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T19:20:00Z'),
  }
  const nowLate = new Date('2026-10-01T22:00:00Z') // 本地 06:00？——用 UTC 差表达冷却 >2h：updatedAt+2h41m
  // 冷却未过（updatedAt+1h）
  const tooSoon = new Date(reviewed.updatedAt.getTime() + 60 * 60_000)
  assert.equal(schedulePreplanFollowUpDue(reviewed, [{ id: 101, content: '今晚的课取消了' }], tooSoon, config), false, '冷却未过')
  // 冷却已过 + 信号命中
  assert.equal(schedulePreplanFollowUpDue(reviewed, [{ id: 101, content: '今晚的课取消了' }], nowLate, config), true, '命中放行')
  // 冷却已过但无信号
  assert.equal(schedulePreplanFollowUpDue(reviewed, [{ id: 101, content: '平平无奇的一天' }], nowLate, config), false, '无信号零成本')
  // 无记录 / 未启用 → false
  assert.equal(schedulePreplanFollowUpDue(undefined, [{ id: 1, content: '取消了' }], nowLate, config), false)
  assert.equal(schedulePreplanFollowUpDue(reviewed, [{ id: 101, content: '取消了' }], nowLate, { ...config, enabled: false }), false)
  // 日审查本身到期时走正常路径（跟进返回 false）
  const stale = { ...reviewed, lastReviewedLocalDate: '2026-10-01' }
  assert.equal(schedulePreplanFollowUpDue(stale, [{ id: 101, content: '取消了' }], nowLate, config), false, '日审到期让位正常路径')
})

test('审查教学：单次事件只进例外、不得吸收进周规律；愿望不算证据', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/narrator.ts', import.meta.url), 'utf8')
  assert.match(src, /belongs to exceptions for its exact date\. Do NOT change weekly blocks because of a single occurrence/)
  assert.match(src, /shows the new time repeating on separate dates or being stated as permanent/)
  assert.match(src, /A wish, a suggestion, a tentative idea, or an unexecuted plan in conversation is not evidence/)
})
