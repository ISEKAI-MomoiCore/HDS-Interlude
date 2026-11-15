import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assembleGroupBackground, mergeGroupBackgroundWatermarks, readGroupBackgroundWatermarks,
} from '../src/narrative/group-background'
import type { ScriptEntry } from '../src/types'

/** I-6a 群消息背景通道（设计 v2.4 §2 I-6 / §5 步骤 2）回归：
 * 概况 + 每群 K 条 + 全局合计 + 覆盖水位 + 热身 A/B 的迁移语义。 */

function groupEntry(id: number, minutesAgo: number, senderName: string, content: string): ScriptEntry {
  return {
    id, storyId: 's', kind: 'group-message', actor: 'user', content,
    occurredAt: new Date(1_000_000 - minutesAgo * 60_000),
    metadata: { groupId: '100', senderId: `u${id}`, senderName },
  } as unknown as ScriptEntry
}

test('I-6a 装配：概况 + 每群 K 条原文；全局上限按最新群优先', () => {
  const entriesA = Array.from({ length: 12 }, (_, i) => groupEntry(100 + i, 12 - i, '甲', `消息${i}`))
  const entriesB = Array.from({ length: 5 }, (_, i) => groupEntry(200 + i, 5 - i, '乙', `B消息${i}`))
  const { sections, coverage } = assembleGroupBackground({
    sections: [
      { groupId: '100', label: '活跃群', entries: entriesA },
      { groupId: '200', label: '次群', entries: entriesB },
    ],
  })
  assert.equal(sections.length, 2)
  // 群 100 更新（最新条目更晚）→ 优先获得预算：8 条原文。
  const active = sections.find(section => section.groupId === '100')!
  assert.equal(active.entries.length, 8, '每群 K=8')
  assert.match(active.summary, /多了 12 条/, '概况覆盖未进原文的 4 条')
  assert.match(active.summary, /较早的有/, '概况含未覆盖部分摘录')
  // 群 200 分得剩余全局预算 16-8=8 → 但它只有 5 条，全部进入。
  const second = sections.find(section => section.groupId === '200')!
  assert.equal(second.entries.length, 5)
  // 覆盖水位 = 各群已呈现原文的最大条目 id。
  assert.equal(coverage.watermarks['100'], 111)
  assert.equal(coverage.watermarks['200'], 204)
})

test('I-6a 装配：全局预算耗尽时该群降为概况-only（概况不清空全部内容级资格）', () => {
  const entriesA = Array.from({ length: 10 }, (_, i) => groupEntry(300 + i, 10 - i, '甲', `A${i}`))
  const entriesB = Array.from({ length: 9 }, (_, i) => groupEntry(400 + i, 8 - i, '乙', `B${i}`))
  const { sections, coverage } = assembleGroupBackground({
    sections: [
      { groupId: 'A', label: 'a', entries: entriesA },
      { groupId: 'B', label: 'b', entries: entriesB },
    ],
    budget: { perGroupLimit: 8, globalLimit: 10, excerptCount: 2 },
  })
  // B 的最新条目更晚 → B 优先获 8 条；A 只剩 2 条预算 → 2 原文 + 8 进概况。
  const a = sections.find(s => s.groupId === 'A')!
  const b = sections.find(s => s.groupId === 'B')!
  assert.equal(b.entries.length, 8, '更新的群优先获得预算')
  assert.equal(a.entries.length, 2)
  assert.match(a.summary, /多了 10 条/)
  assert.equal(coverage.watermarks['A'], 309, '水位只推进到已呈现的最大 id（309 而非 309+）')
})

test('I-6a 装配：截断群获得诚实标注；无条目的群不产节', () => {
  const { sections } = assembleGroupBackground({
    sections: [
      { groupId: 'X', label: 'x', entries: [groupEntry(1, 1, '甲', '唯一')] },
      { groupId: 'Y', label: 'y', entries: [] },
    ],
    truncatedGroups: new Set(['X']),
  })
  assert.equal(sections.length, 1)
  assert.equal(sections[0].truncated, true)
  assert.match(sections[0].summary, /仅统计最近一批/)
})

test('I-6a 水位：读取容错 + 合并只前进', () => {
  assert.deepEqual(readGroupBackgroundWatermarks(undefined), {})
  assert.deepEqual(readGroupBackgroundWatermarks({ extensions: { groupBackground: { watermarks: { g1: 5, bad: 'x', zero: 0 } } } }), { g1: 5 })
  const merged = mergeGroupBackgroundWatermarks({ g1: 5, g2: 3 }, { watermarks: { g1: 4, g2: 9, g3: 1 } })
  assert.deepEqual(merged, { g1: 5, g2: 9, g3: 1 }, '只前进不后退')
})

test('热身 A：quietUntil 字段已从类型与归一化中移除（加载即迁移）', () => {
  const automationType = require('fs').readFileSync('src/types.ts', 'utf8')
  assert.ok(!automationType.includes('quietUntil'), '类型字段删除')
  const stateSrc = require('fs').readFileSync('src/story-state.ts', 'utf8')
  assert.ok(stateSrc.includes('旧存档值在归一化时丢弃'), '归一化丢弃注释在位')
})

test('热身 B：off 稳定表达关闭；迁移入口幂等归一', async () => {
  const { normalizeWillingnessPreset, evaluateWillingnessGate } = await import('../src/group-willingness')
  const legacy = { enabled: true, threshold: 999, baseGain: 0, probabilityAmplifier: 0 }
  // off + 旧 enabled：门关闭（shouldCall 直通），不再隐式 custom。
  const off = evaluateWillingnessGate(undefined, 'off', undefined, undefined, legacy, {
    now: 1, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: false,
  })
  assert.equal(off.diagnosis.preset, 'off')
  // 迁移入口：旧组合 → custom；已是其它档位则原样（幂等）。
  assert.equal(normalizeWillingnessPreset({ willingnessPreset: 'off', willingness: legacy }).willingnessPreset, 'custom')
  assert.equal(normalizeWillingnessPreset({ willingnessPreset: '', willingness: legacy }).willingnessPreset, 'custom')
  assert.equal(normalizeWillingnessPreset({ willingnessPreset: 'eager', willingness: legacy }).willingnessPreset, 'eager')
  assert.equal(normalizeWillingnessPreset({ willingnessPreset: 'off' }).willingnessPreset, 'off', '无数值门的 off 不迁移')
})

test('I-6a 合约：advance 相位指令含背景通道说明（历史背景非当前事件）', async () => {
  const { systemPrompt } = await import('../src/narrator')
  const prompt = systemPrompt('advance', '', '', '', '', '')
  assert.ok(prompt.includes('groupBackground is historical background'), '背景通道说明在 advance 指令中')
  assert.ok(prompt.includes('not a current event and not an obligation'))
  // user-message 相位不含该说明（最小切片仅 advance）。
  const userPrompt = systemPrompt('user-message', '', '', '', '', '')
  assert.ok(!userPrompt.includes('groupBackground is historical background'))
})

// ── §3.2 回合关联放行 + 冷却协调 + I-1 会话迟滞 ──────────────────────

test('§3.2 引用放行：跳过期间引用她的消息不再被 skip-jitter 拦截', async () => {
  const { evaluateGroupWillingness } = await import('../src/group-willingness')
  const config = { enabled: true, maxScore: 1, threshold: 0.01, probabilityAmplifier: 2, decayHalfLifeSeconds: 180, replyCost: 0.55, baseGain: 0.12, quoteGain: 0.5, keywordGain: 0.18, keywords: [] }
  const skipState = { version: 1 as const, buckets: [], skipCount: 5 }
  // 无关联：跳过拦截。
  const plain = evaluateGroupWillingness(skipState, config, { now: 1_000, messageCount: 1, content: '闲聊', quotedBot: false, mentionedBot: false, random: 1 })
  assert.equal(plain.reason, 'skip-jitter')
  assert.equal(plain.shouldCall, false)
  // 引用她：放行进入评分（引用增益使分数过阈）。
  const quoted = evaluateGroupWillingness({ ...skipState, skipCount: 5 }, config, { now: 1_000, messageCount: 1, content: '你说得对', quotedBot: true, mentionedBot: false, random: 0.99 })
  assert.notEqual(quoted.reason, 'skip-jitter', '引用批次不得被跳过检查拦截')
  assert.equal(quoted.shouldCall, true, '引用增益推过阈值并过概率')
})

test('§3.2 计数不清零：引用放行后 skipCount 保持（退出会话态后恢复消耗）', async () => {
  const { evaluateGroupWillingness } = await import('../src/group-willingness')
  const config = { enabled: true, maxScore: 1, threshold: 2, probabilityAmplifier: 0, decayHalfLifeSeconds: 180, replyCost: 0.55, baseGain: 0.12, quoteGain: 0.12, keywordGain: 0.18, keywords: [] }
  const state = { version: 1 as const, buckets: [], skipCount: 3 }
  const quoted = evaluateGroupWillingness(state, config, { now: 1_000, messageCount: 1, content: 'x', quotedBot: true, mentionedBot: false, random: 1 })
  assert.equal(quoted.state.skipCount, 3, '同 @ 直通：引用放行不清零跳过计数')
})

test('I-1 会话迟滞：近期参与态让跳过抖动让位（窗口内）', async () => {
  const { evaluateGroupWillingness } = await import('../src/group-willingness')
  const config = { enabled: true, maxScore: 1, threshold: 2, probabilityAmplifier: 0, decayHalfLifeSeconds: 180, replyCost: 0.55, baseGain: 0.12, quoteGain: 0.12, keywordGain: 0.18, keywords: [] }
  const state = { version: 1 as const, buckets: [], skipCount: 4 }
  // 会话态：跳过检查放行（分数不够阈值 → below-threshold，而非 skip-jitter）。
  const inSession = evaluateGroupWillingness(state, config, { now: 1_000, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: false, sessionActive: true, random: 1 })
  assert.equal(inSession.reason, 'below-threshold', '会话态绕过跳过检查，进入正常评分')
  // 非会话态：跳过照常。
  const cold = evaluateGroupWillingness(state, config, { now: 1_000, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: false, random: 1 })
  assert.equal(cold.reason, 'skip-jitter')
})

test('I-1 groupSessionActive：30 分钟窗口判定 + 查询容错', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  const now = new Date('2026-11-09T12:00:00Z')
  // 她最近一条群发消息在 10 分钟前 → 会话态。
  service.dbGet = async () => [{ occurredAt: new Date(now.getTime() - 10 * 60_000) }]
  assert.equal(await service.groupSessionActive('s', 'group:100', now), true)
  // 40 分钟前 → 非会话态。
  service.dbGet = async () => [{ occurredAt: new Date(now.getTime() - 40 * 60_000) }]
  assert.equal(await service.groupSessionActive('s', 'group:100', now), false)
  // 无记录 / 查询异常 → 非会话态。
  service.dbGet = async () => []
  assert.equal(await service.groupSessionActive('s', 'group:100', now), false)
  service.dbGet = async () => { throw new Error('db down') }
  assert.equal(await service.groupSessionActive('s', 'group:100', now), false)
})

// ── I-2 待叙事显著度 ──────────────────────────────────────────────

test('I-2 累积与去重：回合关联加权、批键防双计、上限封顶', async () => {
  const { recordBlockedBatch, DEFAULT_SALIENCE_CONFIG } = await import('../src/narrative/narrative-salience')
  const now = 1_000_000
  let states = recordBlockedBatch(undefined, 'g1', { turnRelated: false, batchKey: 'b1', now })
  assert.equal(states.g1.score, 1)
  states = recordBlockedBatch(states, 'g1', { turnRelated: false, batchKey: 'b1', now }, DEFAULT_SALIENCE_CONFIG)
  assert.equal(states.g1.score, 1, '同批键双计防护')
  states = recordBlockedBatch(states, 'g1', { turnRelated: true, batchKey: 'b2', now })
  assert.equal(states.g1.score, 3, '回合关联 +2')
  for (let i = 3; i <= 10; i++) states = recordBlockedBatch(states, 'g1', { turnRelated: true, batchKey: `b${i}`, now })
  assert.equal(states.g1.score, DEFAULT_SALIENCE_CONFIG.cap, '上限封顶')
})

test('I-2 衰减与瞥视延迟：半衰退场、分数越高瞥视越早', async () => {
  const { recordBlockedBatch, salienceGlanceDelayMs, maxSalienceScore, DEFAULT_SALIENCE_CONFIG } = await import('../src/narrative/narrative-salience')
  const now = 1_000_000
  const states = recordBlockedBatch(undefined, 'g1', { turnRelated: true, batchKey: 'b1', now })
  assert.equal(states.g1.score, 2)
  // 30 分钟后衰减到一半。
  assert.equal(Math.round(maxSalienceScore(states, now + 30 * 60_000)), 1)
  // 5 个半衰期（150 分钟）后 2×(1/32)=0.0625 → 衰减判定 <0.05 阈值附近：
  // 用 180 分钟（6 个半衰期）确保移除。
  const longDecayed = recordBlockedBatch(states, 'other', { turnRelated: false, batchKey: 'x', now: now + 180 * 60_000 })
  assert.equal(longDecayed.g1, undefined, '长期未覆盖自然退场')
  // 瞥视延迟单调：分数越高越早。
  const low = salienceGlanceDelayMs(0.5)
  const high = salienceGlanceDelayMs(DEFAULT_SALIENCE_CONFIG.cap)
  assert.ok(high < low)
  assert.equal(high, DEFAULT_SALIENCE_CONFIG.glanceMinDelayMs, '封顶时到达未来下界')
})

test('I-2 覆盖消费：内容覆盖完全、概况覆盖减半、未呈现不动', async () => {
  const { recordBlockedBatch, consumeSalience } = await import('../src/narrative/narrative-salience')
  const now = 1_000_000
  let states = recordBlockedBatch(undefined, 'g1', { turnRelated: true, batchKey: 'b1', now })
  states = recordBlockedBatch(states, 'g2', { turnRelated: false, batchKey: 'b2', now })
  states = recordBlockedBatch(states, 'g3', { turnRelated: false, batchKey: 'b3', now })
  states = consumeSalience(states, [
    { groupId: 'g1', contentCovered: true },
    { groupId: 'g2', contentCovered: false },
  ], now)
  assert.equal(states.g1, undefined, '内容覆盖完全消费')
  assert.equal(states.g2.score, 0.5, '概况覆盖减半')
  assert.equal(states.g3.score, 1, '未呈现的群保留资格')
})

test('I-2 瞥视调度：过阈才动、只提前不推后、绝不排过去时间', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  const writes: any[] = []
  let story = { id: 's', status: 'active', setting: { timezone: 'Asia/Shanghai' }, state: { automation: { nextAdvanceAt: new Date(Date.now() + 60 * 60_000).toISOString() } }, cursorAt: new Date() }
  service.getStory = async () => story
  service.serial = async (_id: string, fn: () => unknown) => fn()
  service.dbSet = async (_t: string, _q: unknown, update: any) => { writes.push(update) }
  service.decodeStoryState = undefined // 用类方法
  service.reportOperation = () => {}
  service.recordNarrativeSalience('s', 'g1', { turnRelated: true, batchKey: 'b1' })  // score=2 过阈
  await service.maybeScheduleSalienceGlance('s')
  assert.equal(writes.length, 1, '过阈 → 瞥视写入')
  const written = new Date(writes[0].state.automation.nextAdvanceAt)
  assert.ok(written.getTime() > Date.now(), '未来下界（绝不排过去）')
  assert.ok(written.getTime() < Date.now() + 60 * 60_000, '早于原计划（只提前）')
  // 幂等：再触发一次，若现有计划已早于瞥视时刻则不写。
  story = { ...story, state: { automation: { nextAdvanceAt: new Date(Date.now() + 30_000).toISOString() } } }
  writes.length = 0
  await service.maybeScheduleSalienceGlance('s')
  assert.equal(writes.length, 0, '现有计划更早时不覆盖（幂等）')
  // 不过阈不动。
  const service2: any = Object.create(InterludeService.prototype)
  service2.getStory = async () => story
  service2.serial = async (_i: string, fn: () => unknown) => fn()
  service2.dbSet = async () => { throw new Error('should not write') }
  service2.reportOperation = () => {}
  service2.recordNarrativeSalience('s', 'gx', { turnRelated: false, batchKey: 'x' }) // score=1 < 1.5
  await service2.maybeScheduleSalienceGlance('s')
})

// ── I-7 生活关注词（观察性产出）──────────────────────────────────────

test('I-7 防线：长度/停用词/去重/上限；冷启动用现成结构', async () => {
  const { sanitizeAttentionTerms, bootstrapAttentionWords } = await import('../src/narrative/attention-words')
  const sanitized = sanitizeAttentionTerms([
    { term: '考试' }, { term: '哈哈' }, { term: '长' }, { term: '考试成绩答辩超长词组' }, { term: '考试' }, { term: '小猫', stable: true },
  ])
  assert.deepEqual(sanitized.map(word => word.term), ['考试', '小猫'])
  assert.equal(sanitized[1].stable, true)
  const boot = bootstrapAttentionWords(
    { character: { name: '小夜', aliases: ['夜夜'] }, interests: ['摄影', '过长兴趣词组'] },
    ['手填词'],
  )
  // "过长兴趣词组"恰 6 字（TERM_MAX 内）被保留；截断发生在词超过 6 字时。
  assert.deepEqual(boot.effective.map(word => word.term), ['小夜', '夜夜', '摄影', '过长兴趣词组', '手填词'])
  assert.ok(boot.effective.every(word => word.stable), '冷启动词全为稳定档')
})

test('I-7 滞回：两轮提名晋升、两轮缺席淘汰、同批去重', async () => {
  const { advanceAttentionWords } = await import('../src/narrative/attention-words')
  const t0 = new Date('2026-11-10T10:00:00Z')
  // 第一轮：新词入候选。
  let state = advanceAttentionWords(undefined, { draft: [{ term: '考试', basis: '她在备考' }], batchId: 'b1', now: t0 })
  assert.equal(state.effective.length, 0)
  assert.equal(state.candidates[0].nominations, 1)
  // 同批重试 → 不推进。
  const sameBatch = advanceAttentionWords(state, { draft: [{ term: '考试' }], batchId: 'b1', now: t0 })
  assert.equal(sameBatch.candidates[0].nominations, 1, '同批去重')
  // 第二轮（新批次）→ 晋升生效。
  state = advanceAttentionWords(state, { draft: [{ term: '考试' }], batchId: 'b2', now: t0 })
  assert.equal(state.effective[0].term, '考试')
  // 缺席两轮 → 淘汰。
  state = advanceAttentionWords(state, { draft: [], batchId: 'b3', now: t0 })
  assert.equal(state.effective.length, 1, '缺席一轮仍在')
  state = advanceAttentionWords(state, { draft: [], batchId: 'b4', now: t0 })
  assert.equal(state.effective.length, 0, '缺席两轮淘汰')
})

test('I-7 命中检测（观察性）：内容匹配生效词', async () => {
  const { advanceAttentionWords, matchAttentionWords } = await import('../src/narrative/attention-words')
  const t0 = new Date('2026-11-10T10:00:00Z')
  let state = advanceAttentionWords(undefined, { draft: [{ term: '考试' }], batchId: 'b1', now: t0 })
  state = advanceAttentionWords(state, { draft: [{ term: '考试' }], batchId: 'b2', now: t0 })
  const hits = matchAttentionWords(state, '你们考试准备得怎么样了')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].term, '考试')
  assert.equal(matchAttentionWords(state, '今天天气不错').length, 0)
})

test('I-7 压缩合约：attentionKeywords 进入压缩提示词', async () => {
  const source = require('fs').readFileSync('src/narrator.ts', 'utf8')
  assert.ok(source.includes('attentionKeywords'), '合约字段在提示词中')
  assert.ok(source.includes('NEVER from what the group chats about frequently'), '证据来源限定人物侧')
})

// ── I-3 共享注意力 + I-4 自适应防抖与事实性时间线索 ─────────────────

test('I-3 attentionBusy：私聊活跃时门槛收紧（× 1.5），@ 照常直通', async () => {
  const { evaluateGroupWillingness } = await import('../src/group-willingness')
  const config = { enabled: true, maxScore: 1, threshold: 0.3, probabilityAmplifier: 10, decayHalfLifeSeconds: 180, replyCost: 0.55, baseGain: 0.12, quoteGain: 0.12, keywordGain: 0.18, keywords: [] }
  const input = { now: 1_000, messageCount: 1, content: 'x', quotedBot: false, mentionedBot: false, random: 0.3 }
  // 3 轮递减增益 score ≈ 0.35：> 0.3（正常阈），< 0.45（忙碌阈 ×1.5）
  // 2 轮累积 + 第 3 轮评估（评估本身也累积增益）：评估时 score ≈ 0.35
  let state: any = undefined
  for (let i = 0; i < 2; i++) state = evaluateGroupWillingness(state, config, { ...input, attentionBusy: false, random: 1 }).state
  assert.ok(state.score > 0.15 && state.score < 0.35, `2 轮累积后 score 应在 (0.15, 0.35) 区间，实际 ${state.score}`)
  const normal = evaluateGroupWillingness(state, config, { ...input, attentionBusy: false })
  assert.equal(normal.shouldCall, true, '不忙碌时过阈 0.3 且过概率')
  const busy = evaluateGroupWillingness(state, config, { ...input, attentionBusy: true })
  assert.equal(busy.shouldCall, false, '忙碌时收紧到 0.45，score 不够')
  assert.equal(busy.reason, 'below-threshold')
  // @ 直通不受影响
  const mentionBusy = evaluateGroupWillingness(state, config, { ...input, mentionedBot: true, attentionBusy: true })
  assert.equal(mentionBusy.shouldCall, true)
})

test('I-4 自适应防抖：会话态缩短、冷态放长、有界', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  service.bufferedGroupTurns = new Map()
  service.ctx = { setTimeout: (fn: () => void, ms: number) => { (service as any).__lastDelay = ms; return () => {} } }
  const rule = { groupId: '100', debounceSeconds: 1, contextLimit: 20, responseMode: 'always' }
  const session = { platform: 'onebot', channelId: 'group:100', selfId: '1' }
  const story = { id: 's' }
  Object.defineProperty(service, 'platformPort', { value: { adoptSession: () => undefined }, configurable: true })
  // 冷态：1s × 1.5 = 1.5s
  service.noteGroupSessionActive('s', '100', false)
  service.bufferGroupMessage(story, rule, session, { content: '冷' }, false, false)
  assert.equal(service.__lastDelay, 1_500)
  // 会话态：1s × 0.5 = 0.5s
  service.noteGroupSessionActive('s', '100', true)
  service.bufferGroupMessage(story, rule, session, { content: '热' }, false, false)
  assert.equal(service.__lastDelay, 500)
})

test('I-4 事实性时间线索：安静时长 + 她上次发言（已确认记录）', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  const now = new Date('2026-11-10T12:00:00Z')
  const batchEarliest = new Date(now.getTime() - 2 * 60_000)
  // 上一条群消息在 3 小时前（安静 180 分钟）→ 批次间隔 ≈ 178 分钟
  service.dbGet = async (_t: string, query: any) => {
    if (query.kind === 'group-message' && query.occurredAt?.$lt) {
      // 安静间隔查询（occurredAt < batchEarliest）
      return [{ occurredAt: new Date(batchEarliest.getTime() - 178 * 60_000) }]
    }
    if (query.kind === 'character-group-message') {
      return [{ occurredAt: new Date(now.getTime() - 10 * 60_000) }]
    }
    return []
  }
  const cues = await service.groupFactualTimeCues('s', 'group:100', now, [{ occurredAt: batchEarliest }])
  assert.match(cues, /安静了约 17[89] 分钟/)
  assert.match(cues, /她约 10 分钟前刚在这个群发过言/)
})

test('I-6a 编译投影回归：groupBackground 必须到达模型输入（两种 payload 顺序）', async () => {
  // 修复前缺陷：payload 字面量携带 groupBackground（narrator 两处），但
  // context-compiler 段映射白名单未包含该字段 → compactObject 静默丢弃，
  // advance 从未真正看到群背景（合约句仍在描述它）。
  const { toPromptPayload } = await import('../src/narrator')
  const { emptyStorySetting, emptyStoryState } = await import('../src/types')
  const now = new Date('2026-11-10T12:00:00.000Z')
  const story: any = {
    id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
    setting: emptyStorySetting(), state: emptyStoryState(),
    cursorAt: now, createdAt: now, updatedAt: now,
  }
  const sections = [{
    groupId: '100', label: '活跃群',
    summary: '系统侧消息概况——自上次推进以来群里多了 3 条（约 20 分钟）',
    entries: [], coverageNote: '更早的记录可以翻看',
  }]
  for (const cacheFirst of [false, true]) {
    const request: any = {
      phase: 'advance', story, from: new Date(now.getTime() - 30 * 60_000), now, userMessage: undefined,
      participant: null, participants: [], shareParticipantDetails: false,
      dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [],
      groupBackground: sections,
    }
    const compiled: any = toPromptPayload(request, { cacheFirst })
    assert.ok(compiled.relevantEstablishedEpisodes.groupBackground, `cacheFirst=${cacheFirst}：群背景进入既往事料段`)
    assert.equal(compiled.relevantEstablishedEpisodes.groupBackground[0].groupId, '100')
  }
  // 未携带时省略字段（空对象不进模型）。
  const without: any = toPromptPayload({ ...{ phase: 'advance', story, from: now, now, userMessage: undefined, participant: null, participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [] } })
  assert.equal(without.relevantEstablishedEpisodes.groupBackground, undefined)
})

test('I-6b 背景过滤：后台参与 off 排除，background/active 均进入（不再只看 always）', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  const now = new Date('2026-11-10T12:00:00Z')
  service.config = {
    onebot: { groupChats: [
      { groupId: '100', label: 'always 群', enabled: true, responseMode: 'always' },
      { groupId: '200', label: 'mention-only 群', enabled: true, responseMode: 'mention-only' },
      { groupId: '300', label: '定向但可见', enabled: true, responseMode: 'mention-only', backgroundParticipation: 'background' },
      { groupId: '400', label: '已停用', enabled: false, responseMode: 'always' },
    ] },
  }
  service.dbGet = async (_t: string, query: any) => {
    const variants = query['metadata.groupId'].$in as string[]
    const groupId = variants[0]
    return [{ id: Number(groupId) + 1, occurredAt: new Date(now.getTime() - 5 * 60_000), content: `群${groupId}的消息` }]
  }
  const result = await service.groupBackgroundForAdvance({ id: 's', state: {} })
  assert.ok(result, '至少一个群进入背景')
  const groupIds = result.sections.map((section: any) => section.groupId)
  assert.deepEqual(groupIds.sort(), ['100', '300'], 'always(→active) 与显式 background 进入；mention-only(→off) 与停用群排除')
})
