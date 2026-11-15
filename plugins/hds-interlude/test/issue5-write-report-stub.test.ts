import assert from 'node:assert/strict'
import test from 'node:test'
import { createTurnEngine } from '../src/turn-engine'
import { InterludeService } from '../src/service'

// issue #5：verbosity=diagnostic 时 writeReport 读 story.setting.character 抛
// TypeError，且异常落在 flushBufferedNarrative 的 splice 与 try 之间——endFlush
// 永不执行，turn 永久 in-flight，叙事管线死锁到重启。

test('issue#5 writeReport 对轻量 story 桩防御：回退故事 ID 而不是抛 TypeError', () => {
  const lines: string[] = []
  const svc = {
    blindModeConfig: { enabled: false },
    config: { logging: { level: 'debug', verbosity: 'diagnostic', format: 'layered', colors: false, kaomoji: false } },
    emitLog: (_level: string, output: string) => { lines.push(output) },
  } as unknown as InterludeService
  // 修复前：{ id: 's1' } 桩在 layered 分支读 setting.character.name 直接抛
  ;(InterludeService.prototype as any).writeReport.call(svc, 'debug', { id: 's1' }, 'user-message', '写请求开始 参与者=%s', ['p1'])
  // layered 格式仅根行渲染主角名；此处验证不抛 + 正常产出（回退值由 compact/detailed 分支断言）
  assert.equal(lines.length, 1, 'layered 分支不抛且日志已产出')
  // compact / detailed 分支同样安全
  for (const format of ['compact', 'detailed']) {
    const compactLines: string[] = []
    const svcFormat = { ...svc, config: { logging: { level: 'debug', verbosity: 'diagnostic', format, colors: false, kaomoji: false } }, emitLog: (_l: string, o: string) => { compactLines.push(o) } } as unknown as InterludeService
    ;(InterludeService.prototype as any).writeReport.call(svcFormat, 'debug', { id: 's2' }, 'advance', '推进 参与者=%s', ['p2'])
    assert.equal(compactLines.length, 1, format + ' 分支不抛')
    assert.match(compactLines[0], /s2/, format + ' 分支回退故事 ID')
  }
})

test('issue#5 flush 前段抛错不再死锁：endFlush 必达 + 未提交批次排重试', async () => {
  const turn = {
    storyId: 's', participantId: 'p1', messages: [{ content: '在吗' }], latestSession: undefined,
    timer: undefined, nextRevision: 1, inFlightRequestId: undefined, firstMessageCommittedRequestId: undefined,
    obsoleteRequestIds: new Set<number>(),
  }
  const engine = createTurnEngine({ setTimeout: () => () => {}, userMessageDebounceSeconds: 2, reportOperation: () => {} })
  engine.turns.set('p1', turn as never)
  const retries: Array<[string, string]> = []
  let reportBoom = true
  const svc = {
    databaseResetting: false, desktopRuntimePhase: 'running',
    turnEngine: engine,
    serial: async () => { throw new Error('不应到达：前段已抛') },
    scheduleNarrativeRetry: async (storyId: string, participantId: string) => { retries.push([storyId, participantId]); return true },
    // 模拟原始故障形态：splice 后、模型调度前的诊断日志抛 TypeError。
    // 修复后该异常落在 try 内——catch 消化 + finally endFlush。
    reportStandalone: () => { if (reportBoom) { reportBoom = false; throw new TypeError("Cannot read properties of undefined (reading 'character')") } },
    reportOperation: () => {},
  } as unknown as InterludeService
  // flush 本身不再向上抛出未处理异常（catch 消化了它）
  await (InterludeService.prototype as any).flushBufferedNarrative.call(svc, 'p1', 1)
  // 死锁断言：endFlush 必须已执行（修复前 turn 永久 in-flight）
  assert.equal(turn.inFlightRequestId, undefined, 'endFlush 已执行，turn 不再 in-flight')
  assert.equal(engine.narrating.has('s'), false, '故事级写作互斥已释放')
  assert.deepEqual(retries, [['s', 'p1']], '未提交批次已排叙事重试（消息不丢）')
  assert.equal(turn.messages.length, 0, '批次已被消费（重试从已落库入站条目恢复）')
})
