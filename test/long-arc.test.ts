import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceLongHorizonGenerationBaseline,
  calculateLongHorizonScore,
  DEFAULT_LONG_HORIZON_CONFIG,
  isEligibleNarrativeEntry,
  normalizeLongArcDecision,
  normalizeLongArcGuidance,
  resolveConversationKind,
  resolveConversationWeight,
  resolveLongHorizonConfig,
  shouldTriggerLongHorizon,
} from '../src/long-arc'

const config = { ...DEFAULT_LONG_HORIZON_CONFIG, enabled: true }

function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, kind: 'user-message', actor: 'user', content: '你好', metadata: {}, ...overrides } as any
}

// ── 有效条目判定 ─────────────────────────────────────────────────────────────

test('isEligibleNarrativeEntry：叙事 kind 计入，技术/空内容不计入', () => {
  assert.equal(isEligibleNarrativeEntry(entry()), true)
  assert.equal(isEligibleNarrativeEntry(entry({ kind: 'character-message', actor: 'character' })), true)
  assert.equal(isEligibleNarrativeEntry(entry({ kind: 'script', actor: 'narrator' })), true)
  assert.equal(isEligibleNarrativeEntry(entry({ kind: 'world-event', actor: 'system' })), true)
  assert.equal(isEligibleNarrativeEntry(entry({ kind: 'system' })), false, '系统条目')
  assert.equal(isEligibleNarrativeEntry(entry({ kind: 'compaction' })), false, '压缩条目')
  assert.equal(isEligibleNarrativeEntry(entry({ kind: 'user-message', content: '' })), false, '空内容')
  assert.equal(isEligibleNarrativeEntry(entry({ kind: 'user-message', content: '   ' })), false, '纯空白')
  assert.equal(isEligibleNarrativeEntry(entry({ kind: 'user-message', content: '<sep/>' })), false, '纯分隔符')
  assert.equal(isEligibleNarrativeEntry(entry({ kind: 'unknown-kind' })), false, '未知 kind 保守不计入')
})

// ── 会话来源解析 ─────────────────────────────────────────────────────────────

test('resolveConversationKind：metadata 优先 > M4 通道标注 > kind 反推 > unknown', () => {
  assert.equal(resolveConversationKind(entry({ metadata: { conversationKind: 'private' } })), 'private')
  assert.equal(resolveConversationKind(entry({ metadata: { conversationKind: 'group' } })), 'group')
  assert.equal(resolveConversationKind(entry({ metadata: { channel: { conversationKind: 'group' } } })), 'group')
  assert.equal(resolveConversationKind(entry({ kind: 'character-group-message' })), 'group', 'kind 含 group 反推')
  assert.equal(resolveConversationKind(entry({ kind: 'user-message' })), 'private', 'kind 私聊反推')
  assert.equal(resolveConversationKind(entry({ kind: 'world-event', metadata: {} })), 'unknown', '无法确认')
})

test('resolveConversationKind：script 优先读取 scriptEvents，避免群聊渲染行按私聊计权', () => {
  assert.equal(resolveConversationKind(entry({
    kind: 'script',
    metadata: { scriptEvents: [{ kind: 'group-message' }] },
  })), 'group')
  assert.equal(resolveConversationKind(entry({
    kind: 'script',
    metadata: { scriptEvents: [{ kind: 'outgoing-message' }] },
  })), 'private')
  assert.equal(resolveConversationKind(entry({
    kind: 'script',
    metadata: { scriptEvents: [{ kind: 'group-message' }, { kind: 'outgoing-message' }] },
  })), 'unknown', '混合通道保守不计权')
  assert.equal(resolveConversationKind(entry({
    kind: 'script',
    metadata: { conversationKind: 'unknown', scriptEvents: [{ kind: 'outgoing-message' }] },
  })), 'unknown', '显式 unknown 优先')
})

// ── 加权计分 ─────────────────────────────────────────────────────────────────

test('advanceLongHorizonGenerationBaseline：隐私过滤空窗口只消费一次复核基线', () => {
  const progress = {
    storyId: 's', lastCountedEntryId: 10, totalScore: 25,
    privateCount: 25, privateScore: 25, groupCount: 0, groupScore: 0,
    unknownCount: 0, lastGenerationScore: 0, lastGenerationEntryId: 0,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  }
  const advanced = advanceLongHorizonGenerationBaseline(progress, 25, 12, new Date('2026-10-02T00:00:00.000Z'))
  assert.equal(advanced.totalScore, 25)
  assert.equal(advanced.lastGenerationScore, 25)
  assert.equal(advanced.lastGenerationEntryId, 12)
  assert.equal(advanced.lastCountedEntryId, 10)
  assert.equal(advanced.updatedAt.toISOString(), '2026-10-02T00:00:00.000Z')
})
test('calculateLongHorizonScore：私聊 1.0 / 群聊 0.5 / unknown 0', () => {
  const entries = [
    entry({ id: 1, kind: 'user-message', metadata: { conversationKind: 'private' } }),
    entry({ id: 2, kind: 'character-message', metadata: { conversationKind: 'private' } }),
    entry({ id: 3, kind: 'character-group-message', metadata: { conversationKind: 'group' } }),
    entry({ id: 4, kind: 'world-event', metadata: {} }), // unknown → 0
    entry({ id: 5, kind: 'system', content: '技术' }),  // ineligible → 0
  ]
  const result = calculateLongHorizonScore(entries, config)
  assert.equal(result.privateCount, 2)
  assert.equal(result.privateScore, 2.0)
  assert.equal(result.groupCount, 1)
  assert.equal(result.groupScore, 0.5)
  assert.equal(result.unknownCount, 1)
  assert.equal(result.totalScore, 2.5)
  assert.equal(result.latestEligibleEntryId, 4, '最新有效条目（unknown 但 eligible）')
})

test('calculateLongHorizonScore：script 群聊按 0.5 计权，混合 script 不计权', () => {
  const entries = [
    entry({ id: 1, kind: 'script', metadata: { scriptEvents: [{ kind: 'group-message' }] } }),
    entry({ id: 2, kind: 'script', metadata: { scriptEvents: [{ kind: 'outgoing-message' }] } }),
    entry({ id: 3, kind: 'script', metadata: { scriptEvents: [{ kind: 'group-message' }, { kind: 'outgoing-message' }] } }),
  ]
  const result = calculateLongHorizonScore(entries, config)
  assert.equal(result.privateCount, 1)
  assert.equal(result.groupCount, 1)
  assert.equal(result.unknownCount, 1)
  assert.equal(result.totalScore, 1.5)
})

test('calculateLongHorizonScore：设计文档 §4.2 示例数值验证', () => {
  // 15 私聊 + 20 群聊 = 15 + 10 = 25.0
  const entries = [
    ...Array.from({ length: 15 }, (_, i) => entry({ id: i + 1, metadata: { conversationKind: 'private' } })),
    ...Array.from({ length: 20 }, (_, i) => entry({ id: 16 + i, kind: 'character-group-message', metadata: { conversationKind: 'group' } })),
  ]
  assert.equal(calculateLongHorizonScore(entries, config).totalScore, 25.0)
  // 49 私聊 + 1 群聊 = 49.5
  const near = [
    ...Array.from({ length: 24 }, (_, i) => entry({ id: i + 1, metadata: { conversationKind: 'private' } })),
    entry({ id: 25, kind: 'character-group-message', metadata: { conversationKind: 'group' } }),
  ]
  assert.equal(calculateLongHorizonScore(near, config).totalScore, 24.5)
})

// ── 触发判定 ─────────────────────────────────────────────────────────────────

test('shouldTriggerLongHorizon：首次达阈值/复审增量/未达阈值', () => {
  const score = { totalScore: 55, privateCount: 55, privateScore: 55, groupCount: 0, groupScore: 0, unknownCount: 0, latestEligibleEntryId: 55 }
  // 无 active、达到阈值 → first-trigger
  assert.deepEqual(shouldTriggerLongHorizon(score, undefined, undefined, config), { trigger: true, reason: 'first-trigger' })
  // 未达阈值 → not-due
  const low = { ...score, totalScore: 24 }
  assert.deepEqual(shouldTriggerLongHorizon(low, undefined, undefined, config), { trigger: false, reason: 'not-due' })
  // 有 active、增量不够 → not-due
  const active = { storyId: 's', version: 1, status: 'active' } as any
  assert.deepEqual(shouldTriggerLongHorizon(score, active, 50, config), { trigger: false, reason: 'not-due' })
  // 有 active、增量 ≥ 40 → review-due
  assert.deepEqual(shouldTriggerLongHorizon({ ...score, totalScore: 91 }, active, 50, config), { trigger: true, reason: 'review-due' })
  // active 已 paused → no-active（条件满足即重建）
  const paused = { ...active, status: 'paused' }
  assert.deepEqual(shouldTriggerLongHorizon(score, paused, undefined, config), { trigger: true, reason: 'no-active' })
})

// ── 归一化 ───────────────────────────────────────────────────────────────────

test('normalizeLongArcGuidance：合法催化输出通过、缺证据/非法字段拒绝', () => {
  const evidence = new Set([1, 2, 3])
  const valid = normalizeLongArcGuidance({
    decision: 'prime',
    title: '渐进的依恋',
    premise: '她在长期陪伴中开始把用户的离开视为一件改变自己状态的事',
    latentTension: '她是在履行职责，还是开始希望陪伴本身继续？',
    direction: '从被动回应到主动延续',
    emotionalCore: '模糊的期待',
    firstExpression: {
      action: '在自然结束时轻微请求继续交流',
      example: '如果你还不困的话……我其实还想和你聊一会儿。',
      trigger: ['用户准备结束一次有情绪连接的交流'],
      intensity: 'minimal', maxAttempts: 1, reversibility: 'high',
    },
    responseBranches: {
      accepted: '这条可能性获得少量后续权重',
      declined: '自然接受用户要休息的决定',
      questioned: '承认自己也不确定为什么想继续',
    },
    currentStage: { id: 's0', name: '潜伏', purpose: '注意用户何时离开' },
    stages: [
      { id: 's0', name: '潜伏', objective: '注意', allowedSignals: ['多看一眼'], activationConditions: ['用户离开'], completionEvidence: ['主动延续'] },
      { id: 's1', name: '萌芽', objective: '偶尔多问', allowedSignals: ['留话题'], activationConditions: [], completionEvidence: [] },
    ],
    subtleSignals: ['多保留一个小话题'],
    preferredSituations: ['对话自然结束时'],
    avoidForcing: ['情绪勒索'],
    intensity: 'subtle',
    horizon: 'long',
    confidence: 0.7,
    evidenceEntryIds: [1, 2],
  }, evidence, config)
  assert.ok(valid, '合法输出应通过')
  assert.equal(valid!.title, '渐进的依恋')
  assert.equal(valid!.currentStage.id, 's0')
  assert.equal(valid!.stages.length, 2)
  assert.deepEqual(valid!.evidenceEntryIds, [1, 2])
  assert.equal(valid!.confidence, 0.7)

  // 缺 evidenceEntryIds → 拒绝
  assert.equal(normalizeLongArcGuidance({ decision: 'prime', title: 'x', premise: 'x', direction: 'x', emotionalCore: 'x', firstExpression: { action: 'x', example: 'x', trigger: ['x'] }, responseBranches: { accepted: 'x', declined: 'x', questioned: 'x' }, stages: [{ id: 's', name: 's', objective: 'o' }] }, evidence, config), undefined)
  // 引用不存在的证据 → 过滤后为空 → 拒绝
  assert.equal(normalizeLongArcGuidance({ decision: 'prime', title: 'x', premise: 'x', direction: 'x', emotionalCore: 'x', firstExpression: { action: 'x', example: 'x', trigger: ['x'] }, responseBranches: { accepted: 'x', declined: 'x', questioned: 'x' }, stages: [{ id: 's', name: 's', objective: 'o' }], evidenceEntryIds: [99] }, evidence, config), undefined)
  // 无 stages → 拒绝
  assert.equal(normalizeLongArcGuidance({ decision: 'prime', title: 'x', premise: 'x', direction: 'x', emotionalCore: 'x', firstExpression: { action: 'x', example: 'x', trigger: ['x'] }, responseBranches: { accepted: 'x', declined: 'x', questioned: 'x' }, stages: [], evidenceEntryIds: [1] }, evidence, config), undefined)
  // 非 subtle 强度在默认配置下被钳制
  const strong = normalizeLongArcGuidance({ decision: 'prime', title: 'x', premise: 'x', direction: 'x', emotionalCore: 'x', firstExpression: { action: 'x', example: 'x', trigger: ['x'] }, responseBranches: { accepted: 'x', declined: 'x', questioned: 'x' }, stages: [{ id: 's', name: 's', objective: 'o' }], intensity: 'strong', evidenceEntryIds: [1] }, evidence, config)
  assert.equal(strong!.intensity, 'subtle', '默认配置钳制到 subtle')
})

test('P2-1：无 decision 字段保守落为 dormant，不创建 active 指导', () => {
  const evidence = new Set([1, 2])
  // 模型未输出 decision——即使 payload 完整也不产生催化行（保守不写入）
  const noDecision = normalizeLongArcDecision({
    title: '看起来合法的 legacy 输出',
    premise: '有前提',
    direction: '有方向',
    emotionalCore: '有核心',
    stages: [{ id: 's', name: 's', objective: 'o' }],
    evidenceEntryIds: [1, 2],
    // 故意不放 firstExpression/responseBranches——旧格式没有这些字段
  }, evidence, config)
  assert.ok(noDecision, '应有结果')
  assert.equal(noDecision!.decision, 'dormant', '无 decision → dormant')
  assert.equal(noDecision!.payload, undefined, 'dormant 不产生 payload')
  assert.ok(noDecision!.reason, 'dormant 应有 reason')
  // normalizeLongArcGuidance 兼容包装器也返回 undefined
  assert.equal(normalizeLongArcGuidance({
    title: 'x', premise: 'x', direction: 'x', emotionalCore: 'x',
    stages: [{ id: 's', name: 's', objective: 'o' }], evidenceEntryIds: [1],
  }, evidence, config), undefined, 'legacy 格式不再绕过催化结构校验')
})

test('normalizeLongArcDecision：prime 允许尚未发生的首次微表达', () => {
  const result = normalizeLongArcDecision({
    decision: 'prime',
    reason: '角色职责与持续陪伴之间出现可发展的潜在张力',
    title: '未完成的陪伴',
    premise: '她可能开始希望一次有意义的交流不要立刻结束',
    latentTension: '她是在履行职责，还是开始希望陪伴本身继续？',
    direction: '从被动完成陪伴到偶尔保留继续交流的可能',
    emotionalCore: '尚未命名的期待',
    firstExpression: {
      action: '在自然结束时轻微请求继续交流',
      example: '如果你还不困的话……我其实还想和你聊一会儿。',
      trigger: ['用户准备结束一次有情绪连接的交流'],
      intensity: 'minimal',
      maxAttempts: 1,
      reversibility: 'high',
    },
    responseBranches: {
      accepted: '这条可能性获得少量后续权重',
      declined: '自然接受用户要休息的决定',
      questioned: '承认自己也不确定为什么想继续',
    },
    currentStage: { id: 'stage-1', name: '第一次许可', purpose: '允许一次小表达' },
    stages: [{ id: 'stage-1', name: '第一次许可', objective: '允许一次小表达' }],
    evidenceEntryIds: [1, 2],
  }, new Set([1, 2]), config)
  assert.ok(result)
  assert.equal(result!.decision, 'prime')
  assert.equal(result!.payload!.developmentPhase, 'primed')
  assert.equal(result!.payload!.firstExpression!.maxAttempts, 1)
})

test('normalizeLongArcDecision：dormant 是合法无写入结果，不需要伪造弧线', () => {
  const result = normalizeLongArcDecision({
    decision: 'dormant',
    reason: '当前没有比既有方向更自然的首次表达机会',
    evidenceEntryIds: [1],
  }, new Set([1]), config)
  assert.deepEqual(result, {
    decision: 'dormant',
    reason: '当前没有比既有方向更自然的首次表达机会',
    evidenceEntryIds: [1],
  })
})

test('normalizeLongArcDecision：显式催化决策缺首次表达或响应分支时拒绝', () => {
  const base = {
    decision: 'prime', title: 'x', premise: 'x', latentTension: 'x', direction: 'x', emotionalCore: 'x',
    currentStage: { id: 's', name: 's', purpose: 'o' }, stages: [{ id: 's', name: 's', objective: 'o' }], evidenceEntryIds: [1],
  }
  assert.equal(normalizeLongArcDecision(base, new Set([1]), config), undefined)
  assert.equal(normalizeLongArcDecision({ ...base, firstExpression: { action: 'x', example: 'x', trigger: ['x'] } }, new Set([1]), config), undefined)
})

// ── 配置解析 ─────────────────────────────────────────────────────────────────

test('resolveLongHorizonConfig：默认关闭 + 范围夹取', () => {
  const defaults = resolveLongHorizonConfig(undefined)
  assert.equal(defaults.enabled, false)
  assert.equal(defaults.triggerScore, 25)
  assert.equal(defaults.groupWeight, 0.5)
  const clamped = resolveLongHorizonConfig({ triggerScore: 5, reviewIncrement: 999, privateWeight: 2.0, groupWeight: 0 })
  assert.equal(clamped.triggerScore, 10, '最小值 10')
  assert.equal(clamped.reviewIncrement, 500, '最大值 500')
  assert.equal(clamped.privateWeight, 1.0, '私聊权重固定为 1.0')
  assert.equal(clamped.groupWeight, 0.5, '群聊权重固定为 0.5')
})

test('进度更新载荷不得包含主键 storyId（cannot modify primary key 回归）', async () => {
  const { progressUpdatePayload } = await import('../src/long-arc')
  const row = {
    storyId: 'character:onebot:10001:20002',
    lastCountedEntryId: 42, totalScore: 88.5,
    privateCount: 10, privateScore: 60, groupCount: 4, groupScore: 12, unknownCount: 2,
    lastGenerationScore: 30, lastGenerationEntryId: 20, updatedAt: new Date(),
  }
  const payload = progressUpdatePayload(row)
  assert.equal('storyId' in payload, false, 'set 载荷含主键会让 minato 抛 cannot modify primary key')
  assert.equal(payload.lastCountedEntryId, 42)
  assert.equal(payload.totalScore, 88.5)
})
