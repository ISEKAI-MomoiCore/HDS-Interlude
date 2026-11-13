import assert from 'node:assert/strict'
import test from 'node:test'
import { compactionPrompt } from '../src/narrator'
import { InterludeService } from '../src/service'
import { emptyStorySetting, emptyStoryState, InterludeStory, ScriptEntry, StatePatchDraft } from '../src/types'

/**
 * Issue #21 回归（方向 b）：群素材晋升全局设定需显式共享标记。
 *  群条目的 participantId 恒为 ''（群消息无接收者），既有私料门拦不住群来源：
 *  群的集体话题/氛围可以悄悄成为全局人格/世界观补丁。第四道门要求非 relationship
 *  提案在来源含群条目时显式声明 groupShared:true，默认拒绝；fact 全局语义不动。
 *  A. 无标记群来源提案被拒，门在一切 DB 访问之前（dbGet 零调用）；
 *  B. 严格 === true 判定：false / 'yes' / 1 一律拒绝；
 *  C. 私料门、纯 script 来源与 relationship 行为不变（回归）；
 *  D. 矛盾提案同受门约束；applyCompaction 全链路只看新增量；
 *  E. 压缩合约 lite/full 两档含 groupShared 示例与契约句。
 */

const proto = InterludeService.prototype as any
const now = new Date('2026-11-01T10:00:00Z')
const story: InterludeStory = {
  id: 's', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
  setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now,
}

function groupEntry(id: number, kind = 'group-message', content = `群里连续几天在开玩笑 ${id}`): ScriptEntry {
  return {
    id, storyId: story.id, kind, actor: kind === 'group-message' ? 'user' : 'character', participantId: '',
    content, occurredAt: new Date(now.getTime() + id * 1_000), createdAt: now,
    metadata: { groupId: '12345', senderId: 'u1' },
  }
}

function privateEntry(id: number, kind = 'user-message', participantId = 'alice'): ScriptEntry {
  return {
    id, storyId: story.id, kind, actor: kind === 'user-message' ? 'user' : 'character', participantId,
    content: `私聊素材 ${id}`, occurredAt: new Date(now.getTime() + id * 1_000), createdAt: now, metadata: {},
  }
}

function scriptEntry(id: number): ScriptEntry {
  return {
    id, storyId: story.id, kind: 'script', actor: 'narrator', participantId: '',
    content: `她的原始剧本 ${id}`, occurredAt: new Date(now.getTime() + id * 1_000), createdAt: now,
    metadata: { frameId: 'same-scene' },
  }
}

const groupDraft = (overrides: Partial<StatePatchDraft> = {}): StatePatchDraft => ({
  target: 'character', path: 'traits', proposedValue: '她变得爱开玩笑', evidence: '群里连续几天的玩笑氛围',
  confidence: 0.9, sourceEntryIds: [1, 2], ...overrides,
})

function gateHarness(rows: ScriptEntry[], initial: any[] = []) {
  const proposals: any[] = [...initial]
  const logs: any[] = []
  let dbGetCalls = 0
  const service: any = {
    memoryConfig: { autoApplyStatePatches: true, allowMajorStateChanges: true, statePatchMinTurns: 3, statePatchMinDays: 2,
      statePatchConfidenceThreshold: 0.8, majorStatePatchConfidenceThreshold: 0.9, statePatchCooldownHours: 72 },
    dbGet: async (table: string, query: any) => {
      dbGetCalls += 1
      return table === 'interlude_state_patch' ? proposals : rows.filter(row => query.id.$in.includes(row.id))
    },
    dbCreate: async (_table: string, value: any) => { const item = { ...value, id: proposals.length + 1 }; proposals.push(item); return item },
    dbSet: async (_table: string, query: any, value: any) => { Object.assign(proposals.find(item => item.id === query.id), value) },
    reportOperation: (...args: any[]) => logs.push(args),
    // persistStatePatch 应用后即重建 overlay;mock 桩无需真实重建,只需存在
    rebuildLiveOverlayState: async () => {},
  }
  const call = (draft: StatePatchDraft) => proto.persistStatePatch.call(service,
    { id: 's', setting: { timezone: 'Asia/Shanghai' }, state: emptyStoryState() }, draft, rows, now)
  return { proposals, logs, call, dbGetCalls: () => dbGetCalls }
}

test('A1: 无标记的群来源提案被拒，且门不触达数据库', async () => {
  for (const kind of ['group-message', 'character-group-message']) {
    const h = gateHarness([groupEntry(1, kind), groupEntry(2, kind)])
    await h.call(groupDraft())
    assert.equal(h.proposals.length, 0, `${kind} 无标记应被拒绝`)
    assert.equal(h.dbGetCalls(), 0, '拒绝路径必须零 DB 开销')
  }
})

test('A2: 显式共享标记的群来源提案建立候选（群条目不计自动晋升证据，保持 proposed）', async () => {
  const h = gateHarness([groupEntry(1), groupEntry(2)])
  await h.call(groupDraft({ groupShared: true }))
  assert.equal(h.proposals.length, 1)
  assert.equal(h.proposals[0].status, 'proposed')
  assert.equal(h.proposals[0].target, 'character')
  assert.equal(h.proposals[0].path, 'development.traits')
})

test('A3: 她自己在群的郑重发言算群来源，带标记可晋升', async () => {
  const h = gateHarness([groupEntry(1, 'character-group-message', '我认真地说：以后我会先听完再回应。')])
  await h.call(groupDraft({ sourceEntryIds: [1], groupShared: true }))
  assert.equal(h.proposals.length, 1)
  assert.equal(h.proposals[0].status, 'proposed')
})

test('A4: perspective 与 world 目标同受共享门约束', async () => {
  for (const [target, path] of [['perspective', 'values'], ['world', 'established']] as const) {
    const unmarked = gateHarness([groupEntry(1)])
    await unmarked.call(groupDraft({ target, path, sourceEntryIds: [1] }))
    assert.equal(unmarked.proposals.length, 0, `${target} 无标记应被拒绝`)
    const marked = gateHarness([groupEntry(1)])
    await marked.call(groupDraft({ target, path, sourceEntryIds: [1], groupShared: true }))
    assert.equal(marked.proposals.length, 1, `${target} 带标记应建立候选`)
  }
})

test('A5: 拒绝日志在 args[4] 点名群素材共享标记要求', async () => {
  const h = gateHarness([groupEntry(1)])
  await h.call(groupDraft({ sourceEntryIds: [1] }))
  const log = h.logs.find(args => String(args[4]).includes('群素材晋升全局设定需显式共享标记'))
  assert.ok(log, '拒绝必须留下诊断日志')
  assert.equal(log[0], 'diagnostic')
  assert.equal(log[1], 'debug')
  assert.equal(log[3], 'advance')
})

test('B: groupShared 只认严格 true，false/yes/1 一律拒绝', async () => {
  for (const groupShared of [false, 'yes', 1] as any[]) {
    const h = gateHarness([groupEntry(1)])
    await h.call(groupDraft({ sourceEntryIds: [1], groupShared }))
    assert.equal(h.proposals.length, 0, `groupShared=${JSON.stringify(groupShared)} 应被拒绝`)
    assert.equal(h.dbGetCalls(), 0)
  }
})

test('C1: 群与私聊混合来源即使带标记仍被私料门拦下', async () => {
  const h = gateHarness([groupEntry(1), privateEntry(2)])
  await h.call(groupDraft({ sourceEntryIds: [1, 2], groupShared: true }))
  assert.equal(h.proposals.length, 0)
  assert.equal(h.dbGetCalls(), 0)
  assert.ok(!h.logs.some(args => String(args[4]).includes('群素材晋升全局设定需显式共享标记')), '私料门先于共享门生效')
})

test('C2: 纯 script 来源无标记提案不受新门影响', async () => {
  const h = gateHarness([scriptEntry(1), scriptEntry(2), scriptEntry(3)])
  await h.call(groupDraft({ sourceEntryIds: [1, 2, 3] }))
  assert.equal(h.proposals.length, 1)
  assert.equal(h.proposals[0].status, 'proposed')
})

test('C3: relationship 提案无 participantId 仍被既有门拦下（行为不变）', async () => {
  const h = gateHarness([groupEntry(1)])
  await h.call(groupDraft({ target: 'relationship', path: 'trust', sourceEntryIds: [1] }))
  assert.equal(h.proposals.length, 0)
  assert.equal(h.dbGetCalls(), 0)
})

test('C4: relationship 提案不受共享门约束（分支局部，非全局晋升）', async () => {
  const rows = [privateEntry(1), groupEntry(2), privateEntry(3, 'character-message')]
  const h = gateHarness(rows)
  await h.call(groupDraft({
    target: 'relationship', participantId: 'alice', path: 'trust', sourceEntryIds: [1, 2, 3],
    interactionReview: { outcome: 'supported', feedbackEntryIds: [1], responseEntryIds: [3] },
  }))
  assert.equal(h.proposals.length, 1)
  assert.equal(h.proposals[0].status, 'proposed')
})

const existingCandidate = () => ({
  id: 1, storyId: 's', participantId: '', target: 'character', path: 'development.traits',
  proposedValue: '她变得爱开玩笑', evidence: '早先的群观察', confidence: 0.9, impact: 'minor',
  status: 'proposed', sourceEntryIds: [1], createdAt: now, appliedAt: null,
})

test('D1: 无标记的群来源反证被拒，既有候选不被退役', async () => {
  const existing = existingCandidate()
  const h = gateHarness([groupEntry(1), groupEntry(2)], [existing])
  await h.call(groupDraft({ sourceEntryIds: [2], contradictsProposalIds: [1] }))
  assert.equal(existing.status, 'proposed')
  assert.equal(existing.confidence, 0.9)
  assert.equal(h.dbGetCalls(), 0)
})

test('D2: 带共享标记的群来源反证可以退役既有候选', async () => {
  const existing = existingCandidate()
  const h = gateHarness([groupEntry(1), groupEntry(2)], [existing])
  await h.call(groupDraft({ sourceEntryIds: [2], contradictsProposalIds: [1], groupShared: true }))
  assert.equal(existing.status, 'rejected')
  assert.ok(existing.confidence < 0.9)
})

function persistenceHost(rows: ScriptEntry[]) {
  const proposals: any[] = []
  const logs: any[] = []
  const scene: any = { id: 1, storyId: story.id, startedAt: now, entryCount: 0, lastEntryId: 0 }
  const host: any = {
    memoryConfig: { arcSummaryCharacters: 12_000, sceneSummaryCharacters: 8_000, sceneHookCharacters: 2_000,
      statePatchMinTurns: 3, statePatchMinDays: 2, statePatchConfidenceThreshold: 0.82, majorStatePatchConfidenceThreshold: 0.95,
      autoApplyStatePatches: true, allowMajorStateChanges: true, statePatchCooldownHours: 72 },
    activeArc: async () => ({ id: 1, title: '正在发生的故事' }),
    dbGet: async (table: string, query: any) => table === 'interlude_state_patch' ? proposals
      : table === 'interlude_script_entry' ? rows.filter(row => query.id.$in.includes(row.id)) : [],
    dbSet: async (table: string, query: any, value: any) => {
      if (table === 'interlude_scene') Object.assign(scene, value)
      if (table === 'interlude_state_patch') Object.assign(proposals.find(item => item.id === query.id), value)
    },
    dbCreate: async (table: string, value: any) => {
      assert.equal(table, 'interlude_state_patch')
      const proposal = { id: proposals.length + 1, ...value }
      proposals.push(proposal)
      return proposal
    },
    reportOperation: (...args: any[]) => logs.push(args),
  }
  host.persistCompaction = (...args: any[]) => proto.persistCompactionOutputs.call(host, ...args)
  host.persistStatePatch = (...args: any[]) => proto.persistStatePatch.call(host, ...args)
  const apply = (nextDecision: any, entries: ScriptEntry[], precedingEntries: ScriptEntry[] = []) => proto.applyCompaction.call(host, story, {
    sceneCompactionDue: true, current: story, scene, sceneEntries: entries, visibleCompactionFacts: [], compactRequest: { precedingEntries },
  }, nextDecision, now, Date.now())
  return { host, proposals, logs, scene, apply }
}

const decision = (patches: StatePatchDraft[]) => ({ scene: { summary: '完成本轮整理' }, arc: { summary: '弧线延续' }, statePatches: patches })

test('D3: 全链路——群条目在新增量且无标记，提案不保留', async () => {
  const rows = [groupEntry(1), groupEntry(2)]
  const h = persistenceHost(rows)
  await h.apply(decision([groupDraft()]), rows)
  assert.equal(h.proposals.length, 0)
  assert.ok(h.logs.some(args => String(args[4]).includes('群素材晋升全局设定需显式共享标记')))
})

test('D4: 全链路——带共享标记的群来源提案建立候选', async () => {
  const rows = [groupEntry(1), groupEntry(2)]
  const h = persistenceHost(rows)
  await h.apply(decision([groupDraft({ groupShared: true })]), rows)
  assert.equal(h.proposals.length, 1)
  assert.equal(h.proposals[0].status, 'proposed')
})

test('D5: 非 relationship 提案只看新增量——前置群条目不触发共享门', async () => {
  const old = groupEntry(1)
  const current = scriptEntry(3)
  const h = persistenceHost([old, current])
  await h.apply(decision([groupDraft({ sourceEntryIds: [1, 3] })]), [current], [old])
  assert.equal(h.proposals.length, 1)
  assert.deepEqual(h.proposals[0].sourceEntryIds, [3])
})

for (const tier of ['lite', 'full']) {
  test(`E: ${tier} 压缩合约含 groupShared 示例与显式共享契约句`, () => {
    const prompt = compactionPrompt('', '', '', '', { tier })
    const schema = JSON.parse(prompt.split('\n').find(line => line.startsWith('{'))!)
    assert.equal(schema.statePatches[0].groupShared, false)
    assert.match(prompt, /groupShared:true/)
    assert.match(prompt, /adopted/)
  })
}