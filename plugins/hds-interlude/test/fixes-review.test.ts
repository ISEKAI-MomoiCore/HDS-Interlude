import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractUserReportedTimes, normalizeDatabaseRow, parseTimelineCursor, timelineEntryQueryAfter,
  InterludeService,
} from '../src/service'
import { looksLikeInterludeCommand } from '../src/index'
import { reconcileTransportReferences } from '../src/script/authored-actions'
import { liveNarrativeIntents } from '../src/script/intent-lifecycle'
import { materializeSchedulePreplan, resolveSchedulePreplanConfig, schedulePreplanWindow, type SchedulePreplanRecord } from '../src/schedule-preplan'
import { storyLocalTimeContext } from '../src/time'
import { createTurnEngine } from '../src/turn-engine'

const now = new Date('2026-09-20T12:00:00+08:00')

// ── Fix#1 邻接: 日期防御层对无前缀表生效（主仓无前缀，验证防御层本身）────
test('fix#1 normalizeDatabaseRow applies date fields to tables', () => {
  const row = normalizeDatabaseRow('interlude_script_entry', { id: 1, occurredAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-02T00:00:00.000Z' })
  assert.ok(row.occurredAt instanceof Date, 'occurredAt should become Date')
  assert.ok(row.createdAt instanceof Date)
  const story = normalizeDatabaseRow('interlude_story', { id: 'x', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', state: {} })
  assert.ok(story.createdAt instanceof Date && story.cursorAt instanceof Date)
})

// ── Fix#4: 命令识别覆盖点分子命令 ──────────────────────────────────────────
test('fix#4 command guard recognizes dotted subcommands', () => {
  assert.equal(looksLikeInterludeCommand('interlude.status'), true)
  assert.equal(looksLikeInterludeCommand('interlude.story.start'), true)
  assert.equal(looksLikeInterludeCommand('/interlude.timeline'), true)
  assert.equal(looksLikeInterludeCommand('interlude今天不想说话'), false)
  assert.equal(looksLikeInterludeCommand('interlude倒是没什么'), false)
})

// ── Fix#5: 中文"半"进入捕获组 ──────────────────────────────────────────────
test('fix#5 chinese half-past parses to :30', () => {
  const facts = extractUserReportedTimes('我们八点半在楼下见', now, 'Asia/Shanghai')
  assert.ok(facts.some(f => f.localTime.endsWith('08:30')), JSON.stringify(facts))
})

// ── Fix#7: narrative-retry 不归 live 回合 ──────────────────────────────────
test('fix#7 narrative-retry is excluded from live intents', () => {
  const mk = (type: string, id: number) => ({ id, type, summary: '', notBefore: now.toISOString(), payload: {} }) as any
  assert.equal(liveNarrativeIntents([mk('narrative-retry', 1), mk('delayed-reply', 2)]).map(i => i.id).join(), '2')
})

// ── Fix#3: purgeAllStoryData 失效历史向量缓存 ──────────────────────────────
test('fix#3 purgeAllStoryData invalidates history vectors', async () => {
  const calls: string[] = []
  const svc = {
    invalidateBufferedNarratives: () => { calls.push('buffers') },
    invalidateHistoryVectors: () => { calls.push('vectors') },
    purgeTable: async () => { calls.push('purge') },
    getStory: async () => ({ id: 's', setting: {}, state: {} }),
    initialStorySetting: () => ({}),
    dbSet: async () => { calls.push('set') },
    resetParticipantCanon: async () => { calls.push('canon') },
    ensureContinuity: async () => { calls.push('continuity') },
  } as unknown as InterludeService
  await (InterludeService.prototype as any).purgeAllStoryData.call(svc, 's')
  assert.ok(calls.includes('vectors'), 'invalidateHistoryVectors must run: ' + calls.join(','))
  assert.ok(calls.indexOf('vectors') < calls.indexOf('purge'), 'invalidation should precede table purges')
})

// ── Fix#2: preplan 迁移不再对主键 update ───────────────────────────────────
test('fix#2 schedule preplan migrates via create+remove, never set on primary key', async () => {
  const ops: Array<[string, unknown]> = []
  const svc = {
    dbGet: async (_t: string, q: unknown) => { ops.push(['get', q]); return [{ storyId: 'legacy', revision: 3, regimes: [], exceptions: [], materializedDays: [] }] },
    dbCreate: async (_t: string, d: unknown) => { ops.push(['create', d]) },
    dbRemove: async (_t: string, q: unknown) => { ops.push(['remove', q]) },
    dbSet: async (_t: string, q: unknown, d: unknown) => { ops.push(['set', { q, d }]) },
  } as unknown as InterludeService
  await (InterludeService.prototype as any).migrateSchedulePreplanRecord.call(svc, 'legacy', 'shared')
  assert.ok(!ops.some(([op]) => op === 'set'), 'must not dbSet the primary-key table')
  const create = ops.find(([op]) => op === 'create')![1] as Record<string, unknown>
  assert.equal(create.storyId, 'shared')
  assert.equal(create.revision, 3)
  assert.deepEqual(ops.find(([op]) => op === 'remove')![1], { storyId: 'legacy' })
})

// ── Fix#6: say 内容尾随空白不再丢回复 ─────────────────────────────────────
test('fix#6 authored say survives trailing whitespace inside the tag', () => {
  const decision: any = {
    script: '她停下了手里的事。<say id="r1">在呢。 </say>',
    interaction: { seen: true, reply: { mode: 'immediate', actionId: 'r1' } },
  }
  const resolved = reconcileTransportReferences(decision, false, '<sep/>')
  assert.equal(resolved.interaction.reply.mode, 'immediate')
  assert.equal(resolved.interaction.reply.content, '在呢。')
  const leading: any = {
    script: '<say id="r1"> 在呢。</say>她低下头继续吃。',
    interaction: { seen: true, reply: { mode: 'immediate', actionId: 'r1' } },
  }
  const resolved2 = reconcileTransportReferences(leading, false, '<sep/>')
  assert.equal(resolved2.interaction.reply.mode, 'immediate')
  assert.equal(resolved2.interaction.reply.content, '在呢。')
})

// ── Fix#8: 物化滞后的日程窗口本地重物化 ───────────────────────────────────
test('fix#8 stale materialized days are re-materialized locally before the window', async () => {
  // horizon=3 + 滞后 4 天：物化跨度已整体落后于今天，[今天,明天] 槽位缺失——真实空窗场景
  const config = resolveSchedulePreplanConfig({ enabled: true, horizonDays: 3 })
  const today = storyLocalTimeContext(now, 'Asia/Shanghai').date
  const threeDaysAgo = new Date(now.getTime() - 4 * 86_400_000)
  const staleFrom = storyLocalTimeContext(threeDaysAgo, 'Asia/Shanghai').date
  const regime = {
    id: 'r1', label: '日常', from: staleFrom, to: '',
    weekly: { monday: [{ id: 'b1', start: '00:00', end: '23:50', label: '在家', kind: 'open' as const }], tuesday: [{ id: 'b2', start: '00:00', end: '23:50', label: '在家', kind: 'open' as const }], wednesday: [{ id: 'b3', start: '00:00', end: '23:50', label: '在家', kind: 'open' as const }], thursday: [{ id: 'b4', start: '00:00', end: '23:50', label: '在家', kind: 'open' as const }], friday: [{ id: 'b5', start: '00:00', end: '23:50', label: '在家', kind: 'open' as const }], saturday: [{ id: 'b6', start: '00:00', end: '23:50', label: '在家', kind: 'open' as const }], sunday: [{ id: 'b7', start: '00:00', end: '23:50', label: '在家', kind: 'open' as const }] },
    sourceEntryIds: [1],
  } as any
  const record: SchedulePreplanRecord = {
    storyId: 's', revision: 1, timezone: 'Asia/Shanghai', validFrom: staleFrom,
    validThrough: staleFrom, lastReviewedLocalDate: staleFrom, lastEvidenceEntryId: 0, reviewReason: '',
    regimes: [regime], exceptions: [], materializedDays: materializeSchedulePreplan([regime], [], staleFrom, 3),
    createdAt: threeDaysAgo, updatedAt: threeDaysAgo,
  }
  const saved: SchedulePreplanRecord[] = []
  const svc = {
    getSchedulePreplan: async () => record,
    saveSchedulePreplan: async (r: SchedulePreplanRecord) => { saved.push(r) },
    reportOperation: () => {},
    schedulePreplanConfig: config,
  } as unknown as InterludeService
  const story = { id: 's', setting: { timezone: 'Asia/Shanghai' } } as any
  const window = await (InterludeService.prototype as any).currentSchedulePreplanWindow.call(svc, story, now)
  assert.equal(saved.length, 1, 'stale record should be re-materialized and saved')
  assert.ok(saved[0].materializedDays.some(d => d.date >= today), 're-materialized days must cover today')
  assert.ok(window.blocks.length > 0, 'window must not be silently empty')
  // 未滞后时不落库
  const fresh = { ...record, materializedDays: materializeSchedulePreplan([regime], [], today, 14) }
  const saved2: SchedulePreplanRecord[] = []
  const svc2 = { ...svc, getSchedulePreplan: async () => fresh, saveSchedulePreplan: async (r: SchedulePreplanRecord) => { saved2.push(r) } } as unknown as InterludeService
  const window2 = await (InterludeService.prototype as any).currentSchedulePreplanWindow.call(svc2, story, now)
  assert.equal(saved2.length, 0, 'fresh record must not be rewritten')
  assert.ok(window2.blocks.length > 0)
  // 纯窗口函数对滞后记录仍为空（对照，证明 wrapper 是修复层）
  assert.equal(schedulePreplanWindow(record, now, 'Asia/Shanghai', 12, config)!.blocks.length, 0)
})

// ── Fix#9: 游标双键纯函数 ─────────────────────────────────────────────────
test('fix#9 timeline cursor parses dual-key and legacy formats', () => {
  const dual = parseTimelineCursor('e:1758360000000:42')!
  assert.equal(dual.id, 42)
  assert.equal(dual.occurredAt!.getTime(), 1758360000000)
  const legacy = parseTimelineCursor('entry:42')!
  assert.equal(legacy.id, 42)
  assert.equal(legacy.occurredAt, undefined)
  assert.equal(parseTimelineCursor('garbage'), undefined)
  assert.equal(parseTimelineCursor(undefined), undefined)
  const base = { storyId: 's', occurredAt: { $gte: 1, $lte: 2 } }
  const q = timelineEntryQueryAfter(base, dual) as any
  assert.ok(q.$and, 'dual cursor should build a compound query')
  assert.deepEqual(q.$and[0], base)
  const qLegacy = timelineEntryQueryAfter(base, legacy) as any
  assert.deepEqual(qLegacy.id, { $lt: 42 })
  assert.deepEqual(timelineEntryQueryAfter(base, undefined), base)
})

// ── Fix#10: 持久化抛错排 narrative-retry ───────────────────────────────────
// P0 切分后 flushBufferedNarrative 经 turnEngine.beginFlush/endFlush 取状态，
// mock 改用真引擎实例（断言保持不变）。
function seedTurnEngine(turn: unknown) {
  const engine = createTurnEngine({ setTimeout: () => () => {}, userMessageDebounceSeconds: 2, reportOperation: () => {} })
  engine.turns.set('p1', turn as never)
  return engine
}

test('fix#10 flush failure schedules a narrative retry when nothing committed', async () => {
  const retries: Array<[string, string]> = []
  const turn = {
    storyId: 's', participantId: 'p1', messages: [{ content: '在吗' }], latestSession: undefined,
    timer: undefined, nextRevision: 1, inFlightRequestId: undefined, firstMessageCommittedRequestId: undefined,
    obsoleteRequestIds: new Set<number>(),
  }
  const svc = {
    databaseResetting: false, desktopRuntimePhase: 'running',
    turnEngine: seedTurnEngine(turn),
    serial: async () => { throw new Error('persist boom') },
    scheduleNarrativeRetry: async (storyId: string, participantId: string) => { retries.push([storyId, participantId]); return true },
    reportStandalone: () => {},
    reportOperation: () => {},
  } as unknown as InterludeService
  await (InterludeService.prototype as any).flushBufferedNarrative.call(svc, 'p1', 1)
  assert.deepEqual(retries, [['s', 'p1']], 'uncommitted failure must schedule a retry')
  // 已 committed（早发已投递）时不重复排重试
  const turn2 = { ...turn, messages: [{ content: '在吗' }], firstMessageCommittedRequestId: undefined }
  const retries2: Array<[string, string]> = []
  const svc2 = {
    ...svc, turnEngine: seedTurnEngine(turn2),
    scheduleNarrativeRetry: async (a: string, b: string) => { retries2.push([a, b]); return true },
  } as unknown as InterludeService
  ;(svc2 as any).serial = async () => { throw new Error('boom') }
  await (InterludeService.prototype as any).flushBufferedNarrative.call(svc2, 'p1', 1)
  assert.deepEqual(retries2, [['s', 'p1']])
})

// ── Fix#11: 取消抛错也清理 interruptedTyping 标志 ──────────────────────────
test('fix#11 interruptedTyping flag is cleared even when cancel throws', async () => {
  const flag = new Set(['p1'])
  const svc = {
    interruptedTypingParticipants: flag,
    dbGet: async () => { throw new Error('db down') },
  } as unknown as InterludeService
  await assert.rejects((InterludeService.prototype as any).cancelPendingOutgoingMessages.call(svc, 's', 'p1', new Date()), /db down/)
  assert.equal(flag.has('p1'), false, 'flag must not leak past the failed cancel')
})

// ── Fix#11 邻接：正常路径同样清理（回归保护） ──────────────────────────────
test('fix#11 normal cancel path still clears the flag', async () => {
  const flag = new Set(['p1'])
  const svc = {
    interruptedTypingParticipants: flag,
    dbGet: async () => [],
  } as unknown as InterludeService
  await (InterludeService.prototype as any).cancelPendingOutgoingMessages.call(svc, 's', 'p1', new Date())
  assert.equal(flag.has('p1'), false)
})
