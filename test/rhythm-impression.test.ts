import assert from 'node:assert/strict'
import test from 'node:test'
import {
  sampleInteractionRhythm, renderInteractionRhythm,
  RHYTHM_QUIET_THRESHOLD_MS, RHYTHM_MIN_SAMPLES, RHYTHM_SAMPLE_WINDOW,
  type RhythmSampleEntry,
} from '../src/narrative/rhythm-impression'

/** II-1 交往节奏印象（设计 v2.4 §4 II-1，仅私聊）回归：
 * 开场采样（安静阈值 + 多气泡计一）、承接归属（含混排除）、待定记录、
 * 最小样本门、三档渲染；service 查询接线与 payload 编译投影；II-2 合约句。 */

const base = new Date('2026-11-10T12:00:00.000Z')
const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000)
const user = (minutes: number): RhythmSampleEntry => ({ kind: 'user-message', occurredAt: at(minutes) })
const her = (minutes: number): RhythmSampleEntry => ({ kind: 'character-message', occurredAt: at(minutes) })

/** 三个间距充足的开场→承接样本（响应分钟数可指定；开场槽位间隔远大于
 * 最大延迟，避免承接时间与下一次开场碰撞）。 */
function samples(latenciesMin: [number, number, number]): RhythmSampleEntry[] {
  return [
    user(0),
    her(60), user(60 + latenciesMin[0]),
    her(600), user(600 + latenciesMin[1]),
    her(1200), user(1200 + latenciesMin[2]),
  ]
}

test('II-1 开场识别：双边安静 ≥30 分钟才算开场；多气泡计一', () => {
  const now = at(400)
  // 安静不足：会话中途的 character-message（间隔 10 分钟）不是开场。
  const midConversation = sampleInteractionRhythm([user(0), her(10), user(20)], now)
  assert.equal(midConversation.openings, 0)
  // 多气泡开场：气泡间隔远小于阈值 → 只计首条为开场。
  const burst = sampleInteractionRhythm([user(0), her(60), her(60.5), her(61), user(63)], now)
  assert.equal(burst.openings, 1)
  assert.equal(burst.respondedLatenciesMs.length, 1, '承接按开场后首条 user-message 归属')
})

test('II-1 窗口边缘保守：最旧一条无法证明此前安静，不计开场', () => {
  const now = at(400)
  const edge = sampleInteractionRhythm([her(0), user(5)], now)
  assert.equal(edge.openings, 0)
})

test('II-1 归属含混：开场与承接之间夹着她又一次开场 → 旧开场含混、新开场承接', () => {
  const now = at(400)
  // her(60) 开场后对方未回；her(120) 距上场 60 分钟 → 本身是新开场（追问）。
  const mixed = sampleInteractionRhythm([user(0), her(60), her(120), user(130)], now)
  assert.equal(mixed.openings, 2)
  assert.equal(mixed.respondedLatenciesMs.length, 1, '承接归属到最近的开场')
  assert.equal(mixed.respondedLatenciesMs[0], 10 * 60_000)
  assert.equal(mixed.ambiguous, 1, '被追问顶替的旧开场留在诊断侧')
})

test('II-1 待定开场：24 小时视界内未回应计入待定，超视界不再催动', () => {
  // 视界内：开场在 20 分钟前。
  const recent = sampleInteractionRhythm([user(0), her(60)], at(80))
  assert.equal(recent.pending, 1)
  // 视界外：25 小时前未回应的开场已定格。
  const stale = sampleInteractionRhythm([user(0), her(60)], at(60 + 25 * 60))
  assert.equal(stale.pending, 0)
})

test('II-1 渲染：最小样本门（<3 不注入）', () => {
  const two = sampleInteractionRhythm([user(0), her(60), user(62), her(600), user(610)], at(2000))
  assert.equal(two.respondedLatenciesMs.length, 2)
  assert.equal(renderInteractionRhythm(two), undefined)
  assert.equal(renderInteractionRhythm(two, { minSamples: 2 }) !== undefined, true, '阈值可显式放宽（测试用）')
  assert.equal(RHYTHM_MIN_SAMPLES, 3)
})

test('II-1 渲染：三档分桶（很快 / 稍后 / 较长间隔）与中位数描述', () => {
  const now = at(2000)
  const fast = renderInteractionRhythm(sampleInteractionRhythm(samples([1.5, 3, 2]), now))!
  assert.match(fast, /通常很快接上（中位约 2 分钟）/)
  assert.doesNotMatch(fast, /尚未等到回应/)
  const soon = renderInteractionRhythm(sampleInteractionRhythm(samples([10, 20, 90]), now))!
  assert.match(soon, /多在稍后接上（中位约 20 分钟）/)
  const long = renderInteractionRhythm(sampleInteractionRhythm(samples([120, 180, 240]), now))!
  assert.match(long, /常在较长间隔后续上（中位约 3 小时）/)
})

test('II-1 渲染：待定开场的附注让选择偏差可见', () => {
  const now = at(2000)
  const entries = [...samples([1, 2, 3]), her(1900)]
  const rendered = renderInteractionRhythm(sampleInteractionRhythm(entries, now))!
  assert.match(rendered, /另有 1 次发起后尚未等到回应/)
})

test('II-1 service 采样查询：participantId + 双 kind 窗口；异常静默降级', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  const now = new Date('2026-11-10T12:00:00Z')
  const queries: any[] = []
  service.dbGet = async (_t: string, query: any, options: any) => {
    queries.push({ query, options })
    return [
      { kind: 'user-message', occurredAt: new Date(now.getTime() - 500 * 60_000) },
      { kind: 'character-message', occurredAt: new Date(now.getTime() - 400 * 60_000) },
      { kind: 'user-message', occurredAt: new Date(now.getTime() - 398 * 60_000) },
      { kind: 'character-message', occurredAt: new Date(now.getTime() - 300 * 60_000) },
      { kind: 'user-message', occurredAt: new Date(now.getTime() - 295 * 60_000) },
      { kind: 'character-message', occurredAt: new Date(now.getTime() - 200 * 60_000) },
      { kind: 'user-message', occurredAt: new Date(now.getTime() - 196 * 60_000) },
    ]
  }
  const rendered = await service.interactionRhythmFor('s', 'p', now)
  assert.equal(queries.length, 1)
  assert.equal(queries[0].query.storyId, 's')
  assert.equal(queries[0].query.participantId, 'p')
  assert.deepEqual(queries[0].query.kind.$in, ['user-message', 'character-message'])
  assert.equal(queries[0].options.limit, RHYTHM_SAMPLE_WINDOW)
  // 三个样本：开场后 2 / 5 / 4 分钟 → 中位 4 分钟 → 很快接上。
  assert.match(rendered, /通常很快接上（中位约 4 分钟）/)
  // 查询失败 → 不注入，不抛出。
  service.dbGet = async () => { throw new Error('db down') }
  assert.equal(await service.interactionRhythmFor('s', 'p', now), undefined)
})

test('II-1 decide() 门控：仅私聊相位查询（advance / 群回合 / 无参与者不查）', async () => {
  // 门控表达式在 decide() 内联（三条件），此处按仓库惯例（I-7 压缩合约同款）
  // 以源码包含断言钉住接线存在；行为正确性由上面 interactionRhythmFor 单测覆盖。
  const source = require('fs').readFileSync('src/service.ts', 'utf8')
  assert.ok(source.includes('participant && !groupContext && phase !== \'advance\''), '私聊相位门控在 decide()')
  assert.ok(source.includes('interactionRhythmFor(story.id, participant.id, now)'), '查询接线存在')
  assert.ok(RHYTHM_QUIET_THRESHOLD_MS === 30 * 60_000, '安静阈值起步 30 分钟')
})

test('II-1 payload 编译投影：interactionRhythm 两种顺序都到达 ongoingThreads', async () => {
  const { toPromptPayload } = await import('../src/narrator')
  const { emptyStorySetting, emptyStoryState } = await import('../src/types')
  const now = new Date('2026-11-10T12:00:00.000Z')
  const story: any = {
    id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
    setting: emptyStorySetting(), state: emptyStoryState(),
    cursorAt: now, createdAt: now, updatedAt: now,
  }
  const sentence = '最近她主动开启话题的 3 次里，对方通常很快接上（中位约 2 分钟）。'
  const build = (interactionRhythm?: string): any => ({
    phase: 'user-message', story, from: now, now, userMessage: '在吗',
    participant: null, participants: [], shareParticipantDetails: false,
    dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [],
    ...(interactionRhythm ? { interactionRhythm } : {}),
  })
  for (const cacheFirst of [false, true]) {
    const compiled: any = toPromptPayload(build(sentence), { cacheFirst })
    assert.equal(compiled.ongoingThreads.interactionRhythm, sentence, `cacheFirst=${cacheFirst} 投影到位`)
  }
  // 证据不足时（undefined）字段整体省略，不留空键。
  for (const cacheFirst of [false, true]) {
    const compiled: any = toPromptPayload(build(), { cacheFirst })
    assert.equal('interactionRhythm' in compiled.ongoingThreads, false)
  }
})

test('II-2 合约：full 档含时机元语言段与 interactionRhythm 说明；lite 档不加', async () => {
  const { systemPrompt } = await import('../src/narrator')
  const full = systemPrompt('user-message', '', '', '', '', '')
  assert.ok(full.includes('sometimes read by the other person as signals about the relationship'), 'II-2 元语言段在')
  assert.ok(full.includes('familiarity and trust can also hold an unhurried reply'))
  assert.ok(full.includes('interactionRhythm, when present in ongoingThreads'), 'II-1 字段说明在')
  assert.ok(full.includes('not a rule about how anyone must reply'))
  const lite = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined, { tier: 'lite', family: 'generic' } as any)
  assert.ok(!lite.includes('signals about the relationship'), 'lite 档保持精简')
})

// ── II-4 最小观测：状态行 + 注入日志 ────────────────────────────────

test('II-4 状态行：每位活跃参与者输出样本/中位/待定；样本不足有占位', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  const now = new Date('2026-11-10T12:00:00Z')
  service.participants = async () => [
    { id: 'p1', status: 'active', displayName: '小明' },
    { id: 'p2', status: 'active', displayName: '小红' },
    { id: 'p3', status: 'archived', displayName: '旧账号' },
  ]
  service.dbGet = async (_t: string, query: any) => {
    if (query.participantId !== 'p1') return []
    // 三个开场→承接样本（2/5/4 分钟）+ 一条锚定用户消息。
    return [
      { kind: 'user-message', occurredAt: new Date(now.getTime() - 500 * 60_000) },
      { kind: 'character-message', occurredAt: new Date(now.getTime() - 400 * 60_000) },
      { kind: 'user-message', occurredAt: new Date(now.getTime() - 398 * 60_000) },
      { kind: 'character-message', occurredAt: new Date(now.getTime() - 300 * 60_000) },
      { kind: 'user-message', occurredAt: new Date(now.getTime() - 295 * 60_000) },
      { kind: 'character-message', occurredAt: new Date(now.getTime() - 200 * 60_000) },
      { kind: 'user-message', occurredAt: new Date(now.getTime() - 196 * 60_000) },
    ]
  }
  const lines = await service.interactionRhythmStatusLines({ id: 's' } as any)
  const text = lines.join('\n')
  assert.match(text, /小明：样本 3\/3 次，中位约 4 分钟；待定 0；含混 0/)
  assert.match(text, /印象：最近她主动开启话题的 3 次里/)
  assert.match(text, /小红：\(样本不足——还在熟悉彼此节奏\)/)
  assert.ok(!text.includes('旧账号'), '非活跃参与者不展示')
})

test('II-4 注入日志：decide() 计算出印象时输出诊断行（源码钉）', () => {
  const source = require('fs').readFileSync('src/service.ts', 'utf8')
  assert.ok(source.includes('交往节奏印象已注入'), '诊断日志在 decide() 路径')
})
