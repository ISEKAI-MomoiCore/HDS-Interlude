import assert from 'node:assert/strict'
import test from 'node:test'
import { storyLocalTimeContext, toPromptPayload } from '../src/narrator'
import { detectLiveScriptTimeOverflow, extractUserReportedTimes, normalizeDatabaseRow } from '../src/service'
import { formatLogTime, formatStoryDisplayTime, timeFormatterCacheSize } from '../src/time'
import { emptyParticipantState, emptyStorySetting, emptyStoryState, InterludeStory, NarrativeRequest } from '../src/types'

function requestAt(from: Date, now: Date): NarrativeRequest {
  const setting = emptyStorySetting()
  setting.timezone = 'Asia/Shanghai'
  const state = emptyStoryState()
  state.lastContinuityUpdateAt = from.toISOString()
  const story: InterludeStory = {
    id: 'story', platform: 'onebot', selfId: 'bot', userId: 'global', channelId: 'private:global',
    status: 'active', setting, state, cursorAt: from, createdAt: from, updatedAt: now,
  }
  return {
    phase: 'advance', story, from, now, participant: null, participants: [], shareParticipantDetails: false,
    dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [],
  }
}

test('16:00 in Shanghai is an authoritative daylight afternoon', () => {
  const instant = new Date('2026-08-23T08:00:00.000Z')
  const local = storyLocalTimeContext(instant, 'Asia/Shanghai')
  assert.equal(local.local, '2026-08-23 16:00:00')
  assert.equal(local.hour, 16)
  assert.equal(local.period, 'afternoon')
  assert.equal(local.periodZh, '下午')
  assert.match(local.daylightExpectation, /normally daylight/)
})

test('long intervals expose both endpoint clocks and continuity age', () => {
  const from = new Date('2026-08-22T15:00:00.000Z') // Shanghai 23:00
  const now = new Date('2026-08-23T08:00:00.000Z') // Shanghai 16:00
  const payload = toPromptPayload(requestAt(from, now))
  assert.equal(payload.authoringWindow.interval.fromLocal, '2026-08-22 23:00:00')
  assert.equal(payload.authoringWindow.interval.nowLocal, '2026-08-23 16:00:00')
  assert.equal(payload.authoringWindow.interval.nowLocalContext.period, 'afternoon')
  assert.equal(payload.authoringWindow.interval.elapsedSeconds, 61_200)
  assert.equal(payload.relevantEstablishedEpisodes.continuitySnapshotAgeMinutes, 1_020)
})

test('reload-style ISO timestamp rows are materialized as Date objects', () => {
  const normalized = normalizeDatabaseRow('interlude_story', {
    id: 'story', state: emptyStoryState(),
    cursorAt: '2026-08-23T07:55:00.000Z',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-23T08:00:00.000Z',
  })
  assert.ok(normalized.cursorAt instanceof Date)
  assert.ok(normalized.createdAt instanceof Date)
  assert.ok(normalized.updatedAt instanceof Date)
  assert.equal(normalized.cursorAt.toISOString(), '2026-08-23T07:55:00.000Z')
  assert.equal(normalized.state.agencyWindow, undefined)
})

test('timezone formatters are reused instead of rebuilt on every turn', () => {
  const instant = new Date('2026-08-23T08:00:00.000Z')
  storyLocalTimeContext(instant, 'Asia/Shanghai')
  formatLogTime(instant, 'Asia/Shanghai')
  const warmed = timeFormatterCacheSize()
  for (let index = 0; index < 100; index++) {
    storyLocalTimeContext(instant, 'Asia/Shanghai')
    formatLogTime(instant, 'Asia/Shanghai')
  }
  assert.equal(timeFormatterCacheSize(), warmed)
  assert.equal(storyLocalTimeContext(instant, 'Not/A_Timezone').timezone, 'UTC')
})

test('recentScript payload carries derived ownership without changing stored entries', () => {
  const now = new Date('2026-08-23T08:00:00.000Z')
  const request = requestAt(now, now)
  request.recentEntries = [{
    id: 1, storyId: 'story', participantId: 'participant', kind: 'script', actor: 'narrator',
    content: '她觉得这件事有点奇怪，但没有说出口。', occurredAt: now, metadata: {}, createdAt: now,
  }]
  const payload = toPromptPayload(request)
  assert.equal(payload.relevantEstablishedEpisodes.recentScript[0].ownership, 'protagonist-narrative')
  assert.equal('ownership' in request.recentEntries[0], false)
})

test('timeline display uses the story timezone and prints its GMT offset', () => {
  assert.equal(formatStoryDisplayTime(new Date('2026-08-31T00:37:00.000Z'), 'Asia/Shanghai'), '2026-08-31 08:37:00 GMT+8')
})

test('explicit user-reported clocks stay distinct from the message receive time', () => {
  const facts = extractUserReportedTimes('我 6.30 开始吃，刚吃完', new Date('2026-08-31T11:36:00.000Z'), 'Asia/Shanghai')
  assert.deepEqual(facts, [{ localTime: '2026-08-31 18:30', relation: 'past', statement: '我 6.30 开始吃，刚吃完' }])
})

test('prompt payload keeps receive time and user-reported action time as separate fields', () => {
  const now = new Date('2026-08-31T11:36:00.000Z')
  const request = requestAt(now, now)
  request.phase = 'user-message'
  request.userMessage = '我 6.30 开始吃，刚吃完'
  request.userReportedTimes = extractUserReportedTimes(request.userMessage, now, 'Asia/Shanghai')
  const payload = toPromptPayload(request)
  assert.equal(payload.incomingEvent.event.observedAtLocal, '2026-08-31 19:36:00')
  assert.deepEqual(payload.incomingEvent.event.userReportedTimes, [{ localTime: '2026-08-31 18:30', relation: 'past', statement: '我 6.30 开始吃，刚吃完' }])
  assert.equal(payload.authoringWindow.liveTimeBoundary.mustStopAtNow, true)
  assert.equal(payload.authoringWindow.liveTimeBoundary.nowLocal, '2026-08-31 19:36:00')
})

test('short live windows reject explicit future clocks and multiple completed lesson stages', () => {
  const from = new Date('2026-09-01T00:35:00.000Z') // 08:35 Shanghai
  const now = new Date('2026-09-01T00:45:00.000Z') // 08:45 Shanghai
  assert.match(detectLiveScriptTimeOverflow('九点二十，她走进下一节课的教室。', 'user-message', from, now, 'Asia/Shanghai') || '', /explicit clock/)
  assert.match(detectLiveScriptTimeOverflow('第一节课结束后，她去上第二节数学课。', 'user-message', from, now, 'Asia/Shanghai') || '', /multiple lesson stages/)
  assert.equal(detectLiveScriptTimeOverflow('她继续在第一节课记笔记。', 'user-message', from, now, 'Asia/Shanghai'), undefined)
  assert.equal(detectLiveScriptTimeOverflow('第一节课结束后，她去上第二节数学课。', 'advance', from, now, 'Asia/Shanghai'), undefined)
})

test('midnight wraparound and latency grace do not drop legitimate live scripts', () => {
  // now = 00:01（刚过午夜）；"11:58" 是 12 小时制对 23:58（3 分钟前）的写法，不能判未来
  const from = new Date('2026-09-01T15:56:00.000Z') // 23:56 Shanghai
  const now = new Date('2026-09-01T16:01:00.000Z') // 00:01 Shanghai (+1 day)
  assert.equal(detectLiveScriptTimeOverflow('屏幕亮起，23:58，他的消息停在午夜前三分钟。', 'user-message', from, now, 'Asia/Shanghai'), undefined)
  assert.equal(detectLiveScriptTimeOverflow('11:58 的那条消息还停在屏幕上。', 'user-message', from, now, 'Asia/Shanghai'), undefined, '12 小时制歧义按刚过去的过去处理')
  // 宽限期内的微小超前（≤5 分钟）不丢弃
  assert.equal(detectLiveScriptTimeOverflow('00:05，闹钟该响了，她还没睡。', 'user-message', from, now, 'Asia/Shanghai'), undefined)
  // 歧义视野内（<6h）的真实未来时钟仍然拒绝
  assert.match(detectLiveScriptTimeOverflow('凌晨两点，她终于合上笔记本。', 'user-message', from, now, 'Asia/Shanghai') || '', /explicit clock/)
})

test('the current user message remains both a durable event and the explicit currentEvent', () => {
  const now = new Date('2026-08-23T08:00:00.000Z')
  const request = requestAt(now, now)
  request.phase = 'user-message'
  request.userMessage = '现在发生的这一条消息'
  request.recentEntries = [{
    id: 2, storyId: 'story', participantId: 'participant', kind: 'user-message', actor: 'user',
    content: '现在发生的这一条消息', occurredAt: now, metadata: {}, createdAt: now,
  }]
  const payload = toPromptPayload(request)
  assert.equal(payload.incomingEvent.event.content, '现在发生的这一条消息')
  assert.equal(payload.relevantEstablishedEpisodes.recentScript[0].content, '现在发生的这一条消息')
  assert.equal(payload.relevantEstablishedEpisodes.recentScript[0].ownership, 'user-delivered-message')
})

test('background Agency payload includes relationship identity but not raw chat history', () => {
  const now = new Date('2026-08-24T08:00:00.000Z')
  const request = requestAt(now, now)
  request.agencyEnabled = true
  request.agencyWindow = null
  request.participants = [{
    id: 'friend', storyId: 'story', platform: 'onebot', selfId: 'bot', userId: 'user', channelId: 'private:user',
    personId: 'friend', displayName: '小桃', profile: '主角信任的朋友', relationship: '关系亲近',
    state: emptyParticipantState(), status: 'active', createdAt: now, updatedAt: now,
  }]
  const payload = toPromptPayload(request)
  assert.equal(payload.ongoingThreads.participants[0].displayName, '小桃')
  assert.equal(payload.ongoingThreads.participants[0].relationship, '关系亲近')
  assert.equal(payload.ongoingThreads.participants[0].profile, '主角信任的朋友')
  assert.equal(payload.relevantEstablishedEpisodes.recentScript.length, 0)
})



test('headline-window semantics: narrative declarations block, references and user deadlines pass', () => {
  const from = new Date('2026-09-03T23:30:00.000Z') // 07:30 Shanghai
  const now = new Date('2026-09-03T23:47:40.000Z')  // 07:47:40 Shanghai
  const run = (message, script, nowT = now) => {
    const facts = message ? extractUserReportedTimes(message, nowT, 'Asia/Shanghai') : []
    const endorsed = new Set(facts.map(fact => Number(fact.localTime.slice(-5, -3)) * 60 + Number(fact.localTime.slice(-2))))
    return detectLiveScriptTimeOverflow(script, 'user-message', from, nowT, 'Asia/Shanghai', endorsed)
  }
  // 2026-09-03/04 的三个真实误杀案，全部必须放行：
  assert.equal(run('。。。我看你怎么在八点赶到万松园', '水濑看了一眼时间，还不到七点五十。她想起小桃说的八点赶到万松园的约定，手忙脚乱地收拾书包。'), undefined)
  assert.equal(run('希望你能在九点前赶到万松园', '她抓起书包冲出门。08:47，她气喘吁吁地赶到了万松园校门口。', new Date('2026-09-04T00:05:49.000Z')), undefined, '用户期限（九点前=540）授权区间内的到达时刻')
  assert.equal(run('我们中午一起吃饭吧', '十二点的铃声响了，她收起课本走向食堂。', new Date('2026-09-03T03:19:43.000Z')), undefined, '时段词（中午=12:00）作为背书锚点')
  // 叙事宣告位（开头无计划语义、无背书）仍拦截：
  assert.match(run('', '八点整，她出现在校门口，课已经开始了。') || '', /explicit clock/)
  assert.match(run('', '08:20，教室里已经坐满了人。') || '', /explicit clock/)
  // 中段钟点不再是证据（引用/回忆区）：
  assert.equal(run('', '她一边刷牙一边想着上午的事。昨天说好今天要早到。'), undefined)
})

test('user-endorsed clocks from the message exempt the guard while unendorsed ones stay blocked', () => {
  const from = new Date('2026-09-03T23:30:00.000Z') // 07:30 Shanghai
  const now = new Date('2026-09-03T23:47:40.000Z')  // 07:47:40 Shanghai
  const message = '。。。我看你怎么在八点赶到万松园'
  const facts = extractUserReportedTimes(message, now, 'Asia/Shanghai')
  assert.ok(facts.some(fact => fact.localTime.endsWith('08:00')), '中文“八点”必须能被提取为自报时间')
  const endorsed = new Set(facts.map(fact => Number(fact.localTime.slice(-5, -3)) * 60 + Number(fact.localTime.slice(-2))))
  // 2026-09-03 早间的真实死循环：用户说“八点”，模型每次照写，守卫每次丢弃。
  const script = '水濑看了一眼时间，还不到七点五十。她想起小桃说的八点赶到万松园的约定，手忙脚乱地收拾书包。'
  assert.equal(detectLiveScriptTimeOverflow(script, 'user-message', from, now, 'Asia/Shanghai', endorsed), undefined)
  // 阿拉伯数字自报与中文剧本写法互通。
  const numericEndorsed = new Set(extractUserReportedTimes('我8点出门', now, 'Asia/Shanghai').map(fact => Number(fact.localTime.slice(-5, -3)) * 60 + Number(fact.localTime.slice(-2))))
  assert.equal(detectLiveScriptTimeOverflow('八点整她出门。', 'user-message', from, now, 'Asia/Shanghai', numericEndorsed), undefined)
  // 未背书的其它未来钟点（数字与中文）仍然拦截；背景回合不受影响。
  assert.match(detectLiveScriptTimeOverflow('她抬头看了钟：08:40，才慢悠悠出门。', 'user-message', from, now, 'Asia/Shanghai', endorsed) || '', /explicit clock/)
  assert.match(detectLiveScriptTimeOverflow('八点四十她才出门。', 'user-message', from, now, 'Asia/Shanghai', endorsed) || '', /explicit clock/)
  assert.equal(detectLiveScriptTimeOverflow(script, 'advance', from, now, 'Asia/Shanghai'), undefined)
})
