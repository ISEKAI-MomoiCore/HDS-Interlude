import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/** 2026-11-11 复核报告（hdsi-responsiveness-review-20261111）确认缺陷 F1–F8 的回归：
 * 重点覆盖此前缺失的 service 装配层与提交边界——纯函数层之外的读写往返、
 * 跨群保留、冻结范围、调度下界与生产接线。 */

const executorSource = readFileSync('src/narrative/turn-executor.ts', 'utf8')

// ── F1：背景水位读写往返（真实 service 原型） ──────────────────────────

function groupRow(id: number, minutesAgo: number) {
  return { id, occurredAt: new Date(Date.now() - minutesAgo * 60_000), content: `消息${id}`, metadata: { senderName: '甲' } }
}

async function backgroundHost(rules: any[], rowsByGroup: Record<string, any[]>) {
  const { InterludeService } = await import('../src/service')
  let stored: any = { schemaVersion: 5, extensions: { groupBackground: { watermarks: { 100: 20, 200: 30 } } } }
  // 挂原型：commitGroupBackgroundCoverage 与水位推进会互调私有方法。
  const host: any = Object.create(InterludeService.prototype)
  host.config = { onebot: { groupChats: rules } }
  // 审计修正后水位推进在故事串行锁内执行——桩直通。
  host.serial = async (_id: string, fn: () => unknown) => fn()
  host.dbGet = async (_t: string, query: any) => {
    const variants = query['metadata.groupId']?.$in as string[] | undefined
    if (!variants) return []
    return rowsByGroup[variants[0]] ?? []
  }
  host.dbSet = async (_t: string, _q: any, patch: any) => { stored = patch.state }
  host.getStory = async () => ({ id: 's', status: 'active', state: stored, setting: { timezone: 'Asia/Shanghai' } })
  host.reportOperation = () => {}
  host.__stored = () => stored
  return host
}

test('F1 水位往返：预置 100=20/200=30 → 查询只呈现未覆盖条目（不再重复旧消息）', async () => {
  const { decodeStoryState } = await import('../src/story-state')
  const rows100 = Array.from({ length: 8 }, (_, i) => groupRow(21 + i, 8 - i))
  const rows200 = Array.from({ length: 5 }, (_, i) => groupRow(36 + i, 5 - i))
  const host = await backgroundHost(
    [{ groupId: '100', label: 'A', enabled: true, responseMode: 'always' }, { groupId: '200', label: 'B', enabled: true, responseMode: 'always' }],
    { 100: [...rows100, groupRow(19), groupRow(20)], 200: [...rows200, groupRow(30), groupRow(29)] },
  )
  const result = await host.groupBackgroundForAdvance({ id: 's', state: host.__stored() })
  assert.ok(result, '有未覆盖条目时应产出背景')
  const g100 = result.sections.find((s: any) => s.groupId === '100')
  const g200 = result.sections.find((s: any) => s.groupId === '200')
  assert.ok(g100.entries.every((e: any) => e.id > 20), '群 100 只呈现 id>20（水位生效）')
  assert.ok(g200.entries.every((e: any) => e.id > 30), '群 200 只呈现 id>30')
  // F2 顺带：两群未覆盖条目都在 K 内全量呈现 → 内容完备。
  assert.equal(result.coverage.contentComplete['100'], true)
  assert.equal(result.coverage.contentComplete['200'], true)
  // 提交群 100 的新水位后，群 200 的水位保留（不再被整体替换丢失）。
  await host.commitGroupBackgroundCoverage('s', result.coverage, new Date(), result.sections)
  const merged = decodeStoryState(host.__stored()).extensions?.groupBackground?.watermarks
  assert.equal(merged?.['100'], 28, '群 100 水位推进到已呈现最大 id')
  assert.equal(merged?.['200'], 40, '群 200 既有水位保留（F1 修复核心）')
})

test('F2 K 截断 ≠ 全群覆盖：contentComplete=false，显著度按概况减半而非清零', async () => {
  const { assembleGroupBackground } = await import('../src/narrative/group-background')
  const { consumeSalience } = await import('../src/narrative/narrative-salience')
  const rows = Array.from({ length: 20 }, (_, i) => groupRow(1 + i, 20 - i))
  const { sections, coverage } = assembleGroupBackground({ sections: [{ groupId: 'g', label: 'g', entries: rows }] })
  const section = sections[0]
  assert.equal(section.entries.length, 8, '每群 K=8')
  assert.equal(coverage.watermarks['g'], 20, '水位推进到最新呈现 id（旧积压按概况级过期）')
  assert.equal(coverage.contentComplete['g'], false, '20 条只呈现 8 → 内容不完备')
  // 显著度：概况覆盖 ×0.5，不是整群删除。
  const after = consumeSalience({ g: { score: 2, batchKeys: [], updatedAt: Date.now() } }, [{ groupId: 'g', contentCovered: false }], Date.now())
  assert.equal(after.g?.score, 1, '截断群减半保留内容级资格')
  // 消费端把 contentComplete 传给显著度（源码钉：不再用 watermark 存在性判定）。
  const serviceSource = readFileSync('src/service.ts', 'utf8')
  assert.ok(serviceSource.includes('contentCovered: coverage.contentComplete?.[section.groupId] === true'))
})

// ── F3：提交边界与冻结范围 ────────────────────────────────────────────

test('F3 冻结上界：快照后到达的新消息不被记成已覆盖', async () => {
  const { decodeStoryState } = await import('../src/story-state')
  const host = await backgroundHost([{ groupId: '100', label: 'A', enabled: true, responseMode: 'always' }], {})
  host.dbGet = async () => [groupRow(999, 0)] // 模型在途期间到达的最新消息
  await host.advanceGroupBackgroundWatermarkForTurn('s', '100', new Date(), 25)
  const watermarks = decodeStoryState(host.__stored()).extensions?.groupBackground?.watermarks
  assert.equal(watermarks?.['100'], 25, '水位只推进到冻结输入上界（25），不含在途新消息 999')
})

test('F3 提交边界：显著度消费与水位推进移到持久化成功之后（源码钉）', () => {
  const fnStart = executorSource.indexOf('export async function executeGroupNarrativeTurn')
  const body = executorSource.slice(fnStart)
  const serialIdx = body.indexOf('const result = await svc.serial(story.id, async () => {')
  const consumeIdx = body.indexOf('svc.consumeNarrativeSalienceForGroup?.(story.id, turn.groupId)')
  const persistIdx = body.indexOf('await svc.persistDecision(')
  assert.ok(serialIdx > 0 && persistIdx > serialIdx, 'serial 持久化块存在')
  assert.ok(consumeIdx > persistIdx, '显著度消费在 persistDecision 之后')
  assert.ok(body.includes('if (result.scriptEntry && task.contentCurrent()) {'), '以 result.scriptEntry 为门（守卫早退不清覆盖）')
  assert.ok(body.includes('frozenMaxEntryId'), '冻结上界解析在位')
})

// ── F4：瞥视约束下界 + 参与资格 ───────────────────────────────────────

test('F4 调度保护：瞥视受约束下界钳制，slow+asleep 不再被拽到分钟级', async () => {
  const { InterludeService } = await import('../src/service')
  const now = Date.now()
  const makeHost = (lifeRhythm: any, urgeState: any) => {
    const writes: string[] = []
    const host: any = Object.create(InterludeService.prototype)
    // urgeConfig/autoAdvanceConfig 是原型 getter（读 config），经 config 注入。
    host.config = { urge: { enabled: true, frequency: 'medium' } }
    host.cachedAutoAdvanceConfig = { restWindows: [], intervalMinutes: 40, jitterMinutes: 5, followUpMinutes: [10, 20] }
    host.groupNarrativeSalience = new Map([['s', { g1: { score: 2, batchKeys: [], updatedAt: now } }]])
    host.serial = async (_id: string, fn: () => unknown) => fn()
    host.getStory = async () => ({
      id: 's', status: 'active', setting: { timezone: 'Asia/Shanghai' },
      state: {
        schemaVersion: 5,
        ...(lifeRhythm ? { lifeRhythm } : {}),
        ...(urgeState ? { extensions: { urge: urgeState } } : {}),
        automation: { nextAdvanceAt: new Date(now + 3 * 3_600_000).toISOString() },
      },
    })
    host.dbSet = async (_t: string, _q: any, patch: any) => { writes.push(patch.state.automation.nextAdvanceAt) }
    host.reportOperation = () => {}
    host.__writes = writes
    return host
  }
  // 场景 A：普通节奏 + asleep——下界（idle 35~55min ÷ 0.15 ≈ 233 分钟）
  // 超过 3 小时原计划 → 不写（约束压倒提前）。
  const constrained = makeHost(
    { attention: 'asleep', basis: '她在睡觉', assessedAt: new Date(now).toISOString(), source: 'compactor' },
    undefined,
  )
  await constrained.maybeScheduleSalienceGlance('s')
  assert.equal(constrained.__writes.length, 0, '约束下界晚于原计划 → 瞥视不写（不再出现 4.5 分钟复现）')
  // 场景 B（复现报告原场景）：urge pace=slow + asleep——script-slow 固定区间
  // 下界 110 分钟钳住瞥视（旧实现 4.5 分钟）。
  const clamped = makeHost(
    { attention: 'asleep', basis: '她在睡觉', assessedAt: new Date(now).toISOString(), source: 'compactor' },
    { version: 1, buckets: [], pace: 'slow' },
  )
  await clamped.maybeScheduleSalienceGlance('s')
  assert.equal(clamped.__writes.length, 1, '下界早于原计划 → 写入')
  const glanceAt = new Date(clamped.__writes[0]).getTime()
  assert.ok(glanceAt >= now + 100 * 60_000, `瞥视被钳到 script-slow 下界之上（实际提前量 ${(glanceAt - now) / 60_000} 分钟）`)
  assert.ok(glanceAt < now + 3 * 3_600_000, '仍只提前不推后')
})

test('F4 参与资格：后台参与 off 的群不累积显著度（两处记录点都被门控，源码钉）', () => {
  const gated = executorSource.match(/if \(salienceEligible\) \{/g) ?? []
  assert.ok(gated.length >= 2, '意愿门与冷却两处记录点均在资格门内')
  assert.ok(executorSource.includes("ruleDimensions.backgroundParticipation !== 'off'"), '资格判定按后台参与维度')
})

// ── F5：I-3/I-4 生产接线 + 缓存 TTL ───────────────────────────────────

test('F5 接线（源码钉）：执行器取私聊忙碌并传入门输入；会话态写缓存', () => {
  assert.ok(executorSource.includes('svc.privateAttentionBusy'), 'I-3 忙碌查询已接线')
  assert.ok(executorSource.includes('attentionBusy'), '忙碌标志进入门输入')
  assert.ok(executorSource.includes('svc.noteGroupSessionActive?.(story.id, turn.groupId, true)'), 'I-4 缓存在门分支前刷新且仅写 true')
})

test('F5 缓存 TTL：会话态缓存 30 分钟过期；无记录为 false', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  service.noteGroupSessionActive('s', '100', true)
  assert.equal(service.groupSessionActiveCached('s', '100'), true)
  // 写入时刻拨回 31 分钟 → 过期为冷态。
  const cache = service.groupSessionActiveCache as Map<string, { active: boolean, at: number }>
  const entry = cache.get('s:100')!
  cache.set('s:100', { active: true, at: entry.at - 31 * 60_000 })
  assert.equal(service.groupSessionActiveCached('s', '100'), false, 'TTL 过期回冷态')
  assert.equal(service.groupSessionActiveCached('s', 'other'), false, '无记录为冷态')
})

// ── F6：背景字符预算 ─────────────────────────────────────────────────

test('F6 字符预算：单条截断 + 全局合计上限；被预算退出的条目不算呈现', async () => {
  const { assembleGroupBackground, DEFAULT_GROUP_BACKGROUND_BUDGET } = await import('../src/narrative/group-background')
  const long = '字'.repeat(100_000)
  const group = (base: number) => Array.from({ length: 8 }, (_, i) => ({ id: base + 8 - i, occurredAt: new Date(Date.now() - (8 - i) * 60_000), content: long, metadata: { senderName: '甲' } }))
  // 三群各 8 条长文：全局 16 条的条数预算先在第二群耗尽，第三群无原文呈现。
  const { sections, coverage } = assembleGroupBackground({ sections: [
    { groupId: 'a', label: 'a', entries: group(100) },
    { groupId: 'b', label: 'b', entries: group(200) },
    { groupId: 'c', label: 'c', entries: group(300) },
  ] })
  for (const section of sections) {
    for (const entry of section.entries) {
      assert.ok(entry.content.length <= DEFAULT_GROUP_BACKGROUND_BUDGET.perEntryCharacters + '[已截断]'.length, '单条不超上限并带标注')
      assert.ok(entry.content.endsWith('[已截断]'))
    }
  }
  const totalChars = sections.reduce((sum: number, section: any) => sum + section.entries.reduce((inner: number, entry: any) => inner + entry.content.length, 0), 0)
  assert.ok(totalChars <= DEFAULT_GROUP_BACKGROUND_BUDGET.globalCharacters + 16 * '[已截断]'.length, `全局字符合计受预算（实际 ${totalChars}）`)
  // 多群按新近度分预算：恰好两群用完 16 条，第三群仅概况（顺序无关断言）。
  const presentedGroups = sections.filter((s: any) => s.entries.length > 0)
  const summaryOnly = sections.filter((s: any) => s.entries.length === 0)
  assert.equal(presentedGroups.length, 2, '全局条数预算只够两群')
  assert.equal(summaryOnly.length, 1, '预算耗尽的群无原文呈现（仅概况）')
  assert.equal(presentedGroups.reduce((sum: number, s: any) => sum + s.entries.length, 0), 16)
  assert.equal(coverage.watermarks[summaryOnly[0].groupId], undefined, '未呈现的群不推水位')
  for (const section of presentedGroups) {
    assert.ok(coverage.watermarks[section.groupId] > 0, '已呈现群水位只记实际呈现条目')
  }
  // 全量在预算内的群（短内容）内容完备。
  const shortRows = Array.from({ length: 3 }, (_, i) => ({ id: 3 - i, occurredAt: new Date(Date.now() - (3 - i) * 60_000), content: '短消息', metadata: { senderName: '乙' } }))
  const complete = assembleGroupBackground({ sections: [{ groupId: 'd', label: 'd', entries: shortRows }] })
  assert.equal(complete.coverage.contentComplete['d'], true)
})

test('F6 生活席位：advance 相位把聊天行排除下推到查询（$nin）', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  const queries: any[] = []
  service.config = { runtime: {} }
  service.dbGet = async (_t: string, query: any) => { queries.push(query); return [] }
  await (InterludeService.prototype as any).recentEntriesForPrompt.call(service, 's', new Date(), { count: 10, minutes: 60, mode: 'auto' }, { excludeChatKinds: true })
  assert.ok(queries.length >= 1)
  assert.deepEqual(queries[0].kind.$nin.sort(), ['character-group-message', 'character-message', 'group-message', 'user-message'], '查询阶段即排除四类聊天行')
})

// ── F7：off 一次性迁移 ────────────────────────────────────────────────

test('F7 迁移纯函数：历史规则归一 + 标志置位；已迁移跳过；干净配置只置标志', async () => {
  const { migrateWillingnessPresetsConfig } = await import('../src/group-willingness')
  const legacy = { groupChats: [
    { groupId: '1', enabled: true, willingnessPreset: 'off', willingness: { enabled: true } },
    { groupId: '2', enabled: true, willingnessPreset: 'eager' },
  ] }
  const result = migrateWillingnessPresetsConfig(legacy)!
  assert.equal(result.changed, true)
  assert.equal(result.next.groupChats[0].willingnessPreset, 'custom', '历史 off+enabled → custom')
  assert.equal(result.next.groupChats[1].willingnessPreset, 'eager', '显式档位不动')
  assert.equal(result.next.willingnessPresetMigrated, true)
  assert.equal(migrateWillingnessPresetsConfig(result.next), undefined, '标志置位后跳过（幂等）')
  const clean = migrateWillingnessPresetsConfig({ groupChats: [{ groupId: '3', enabled: true }] })!
  assert.equal(clean.changed, false, '无历史规则不改内容')
  assert.equal(clean.next.willingnessPresetMigrated, true, '仍写入标志（一次性完成）')
})

test('F7 groupRule：迁移标志置位后显式 off 稳定表达关闭', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  service.config = { onebot: { willingnessPresetMigrated: true, groupChats: [
    { groupId: '100', enabled: true, willingnessPreset: 'off', willingness: { enabled: true } },
  ] } }
  assert.equal(service.groupRule('group:100').willingnessPreset, 'off', '标志置位：不再运行时归一为 custom')
  service.config = { onebot: { groupChats: [{ groupId: '100', enabled: true, willingnessPreset: 'off', willingness: { enabled: true } }] } }
  assert.equal(service.groupRule('group:100').willingnessPreset, 'custom', '未迁移（兜底）：历史组合仍归一为 custom')
})

// ── F8：关注词状态机三态 / 连续提名 / 有效期 ──────────────────────────

test('F8 三态：字段省略与整批不合格 → 完全 no-op（两次省略不再全灭）', async () => {
  const { advanceAttentionWords } = await import('../src/narrative/attention-words')
  const t0 = new Date('2026-11-10T10:00:00Z')
  let state = advanceAttentionWords(undefined, { draft: [{ term: '考试' }], batchId: 'b1', now: t0 })
  state = advanceAttentionWords(state, { draft: [{ term: '考试' }], batchId: 'b2', now: t0 })
  assert.equal(state!.effective[0].term, '考试')
  // 连续两次字段省略：不推进缺席、不消耗批次。
  const afterOmit1 = advanceAttentionWords(state, { draft: undefined, batchId: 'b3', now: t0 })
  const afterOmit2 = advanceAttentionWords(afterOmit1, { draft: undefined, batchId: 'b4', now: t0 })
  assert.equal(afterOmit2!.effective.length, 1, '省略不淘汰生效词')
  // 整批不合格（全停用词）→ 沿用旧集。
  const afterInvalid = advanceAttentionWords(afterOmit2, { draft: [{ term: '哈哈' }], batchId: 'b5', now: t0 })
  assert.equal(afterInvalid!.effective.length, 1, '宁可旧、不可空')
  // 显式空集仍计缺席（模型明确说当前无关切）。
  const afterEmpty = advanceAttentionWords(afterInvalid, { draft: [], batchId: 'b6', now: t0 })
  assert.equal(afterEmpty!.effective.length, 1, '缺席一轮仍在')
  assert.equal(afterEmpty!.absences['考试'], 1)
})

test('F8 连续提名：A/B/A 不再累计晋升 A', async () => {
  const { advanceAttentionWords } = await import('../src/narrative/attention-words')
  const t0 = new Date('2026-11-10T10:00:00Z')
  let state = advanceAttentionWords(undefined, { draft: [{ term: '考试' }], batchId: 'b1', now: t0 })
  state = advanceAttentionWords(state, { draft: [{ term: '旅行' }], batchId: 'b2', now: t0 })
  assert.equal(state!.candidates.length, 1, '考试缺席本轮 → 候选断档让位，旅行入候选')
  assert.equal(state!.candidates[0].term, '旅行')
  state = advanceAttentionWords(state, { draft: [{ term: '考试' }], batchId: 'b3', now: t0 })
  assert.equal(state!.candidates.find((c: any) => c.term === '考试')?.nominations ?? 0, 1, '考试重新提名从 1 起算（连续语义）')
  assert.equal(state!.effective.length, 0, '未连续两轮 → 不晋升')
})

test('F8 有效期：短期关切 7 天未确认退出；稳定兴趣 30 天', async () => {
  const { advanceAttentionWords, ATTENTION_STABLE_TTL_DAYS, ATTENTION_SHORT_TTL_DAYS } = await import('../src/narrative/attention-words')
  assert.equal(ATTENTION_STABLE_TTL_DAYS, 30)
  assert.equal(ATTENTION_SHORT_TTL_DAYS, 7)
  const t0 = new Date('2026-11-10T10:00:00Z')
  const state = advanceAttentionWords(undefined, { draft: [{ term: '考试' }], batchId: 'b1', now: t0 })
  // 8 天后（非稳定词超 7 天有效期）→ 退出。
  const later = advanceAttentionWords(state, { draft: [], batchId: 'b2', now: new Date(t0.getTime() + 8 * 86_400_000) })
  assert.equal(later!.effective.length, 0, '短期关切超有效期退出')
})
