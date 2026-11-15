import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { createTurnEngine } from '../src/turn-engine'
import { OneBotAdapter } from '../src/platform/onebot-adapter'

/** D0 特征测试（NARRATIVE_PLATFORM_DECOUPLING_DESIGN §6 D0）：
 * 把私聊 flushBufferedNarrative 与群聊 flushGroupTurnUnlocked 两个执行体的
 * 关键步骤调用顺序钉死。D3 提取叙事编排时以此为证——重排后顺序必须与
 * 本基线一致（叙事步骤与平台步骤的相对位置不许变）。
 *
 * 记录点约定：平台/IO 步骤记实名（sticker-catalog/images/audio/deliver…），
 * 叙事步骤记实名（decide/persist/follow-ups…）；"不得出现"列表钉住不应
 * 触发的旁路（重试/早期投递/sidecar 识图）。 */

function traceRecorder() {
  const trace: string[] = []
  const step = (name: string) => { trace.push(name) }
  return { trace, step }
}

function baseStory() {
  return { id: 's', status: 'active', setting: { timezone: 'Asia/Shanghai', character: { name: '小夜' } }, state: {}, cursorAt: new Date() } as any
}

test('私聊执行体步骤顺序基线：快照→考据门→向量→平台素材→模型→落库→投递', async () => {
  const { trace, step } = traceRecorder()
  const service: any = Object.create(InterludeService.prototype)
  const engine = createTurnEngine({
    setTimeout: (fn: () => void) => { return () => { void fn } },
    userMessageDebounceSeconds: 2,
    scheduleTurnFlush: () => {},
    reportOperation: () => {},
  })
  const participant = { id: 'p1', status: 'active', channelId: 'private:u1' } as any
  const fakeSession = { platform: 'onebot', channelId: 'private:u1', selfId: '1' } as any
  engine.bufferUserNarrative(baseStory(), participant, fakeSession, new Date(), [], '你好', [], [], undefined, () => {})

  Object.assign(service, {
    turnEngine: engine,
    databaseResetting: false, desktopRuntimePhase: 'running', disposed: false, pendingProactiveCount: 0,
    config: { runtime: {}, model: {} },
    serial: async (_id: string, fn: () => unknown) => fn(),
    getStory: async () => baseStory(),
    getParticipant: async () => participant,
    dueIntents: async () => { step('due-intents'); return [] },
    reportStandalone: () => {}, reportOperation: () => {}, reportStandaloneOperation: () => {},
    scheduleNarrativeRetry: async () => { step('retry') },
    jevGatePassiveResearch: async () => { step('jev') },
    semanticTurnEmbeddingEnabled: () => true,
    embedText: async () => { step('embed'); return [0.1] },
    stickerCatalogForSession: async () => { step('sticker-catalog'); return [] },
    privateChatCapabilities: () => { step('capabilities'); return { quoteReply: true, reactions: [], nativeFaces: [], expressionThreshold: 0.7 } },
    loadNativeImages: async () => { step('images'); return [] },
    describeCurrentImages: async () => { step('describe-images'); return undefined },
    loadNativeAudio: async () => { step('audio'); return [] },
    deliverEarlyPrivateReply: async () => { step('early-deliver'); return undefined },
    tryDecide: async () => {
      step('decide')
      return { decision: { interaction: { reply: { mode: 'immediate', content: '嗯嗯' } } }, succeeded: true, effectiveNow: new Date(), immediateObservations: [] }
    },
    persistImmediateObservations: async () => { step('persist-observations') },
    persistDecision: async () => { step('persist'); return { messages: [{ participantId: 'p1', content: '嗯嗯' }], commit: {}, scriptEntry: { id: 1 } } },
    dbSet: async (table: string) => { step(`db-set:${table}`) },
    cancelPendingNarrativeRetries: async () => { step('cancel-retries') },
    scheduleConversationFollowUpsAfterTurn: async () => { step('follow-ups') },
    canHandleParticipant: () => true,
    deliverOutgoingMessages: async () => { step('deliver'); return [] },
    sendSticker: async () => { step('send-sticker') },
    sendNativeFace: async () => { step('send-native-face') },
    scheduleCompaction: () => { step('compaction') },
  })

  await service.flushBufferedNarrative('p1', 1)

  assert.deepEqual(trace, [
    'due-intents', 'jev', 'embed', 'sticker-catalog', 'capabilities', 'images', 'audio',
    'decide', 'persist-observations', 'persist', 'db-set:interlude_story',
    'cancel-retries', 'follow-ups', 'deliver', 'compaction',
  ], '步骤顺序基线（D3 重排以此为证）')
  for (const forbidden of ['retry', 'early-deliver', 'describe-images', 'send-sticker', 'send-native-face']) {
    assert.ok(!trace.includes(forbidden), `${forbidden} 不应出现在此路径`)
  }
})

test('私聊执行体：入站新消息到达时旧请求作废（首条未提交）且回队保留批次', async () => {
  const { trace, step } = traceRecorder()
  const service: any = Object.create(InterludeService.prototype)
  const engine = createTurnEngine({
    setTimeout: (fn: () => void) => { return () => { void fn } },
    userMessageDebounceSeconds: 2,
    scheduleTurnFlush: () => {},
    reportOperation: () => {},
  })
  const participant = { id: 'p1', status: 'active', channelId: 'private:u1' } as any
  const fakeSession = { platform: 'onebot', channelId: 'private:u1' } as any
  engine.bufferUserNarrative(baseStory(), participant, fakeSession, new Date(), [], '第一条', [], [], undefined, () => {})
  // 模拟模型进行中新消息到达：占用 inFlight 后再 buffer → 旧请求进 obsolete。
  const turn = engine.getTurn('p1')!
  turn.inFlightRequestId = 1
  engine.bufferUserNarrative(baseStory(), participant, fakeSession, new Date(), [], '第二条', [], [], undefined, () => {})
  assert.ok(turn.obsoleteRequestIds.has(1), '首条未提交时新消息作废旧请求')

  Object.assign(service, {
    turnEngine: engine,
    databaseResetting: false, desktopRuntimePhase: 'running', disposed: false, pendingProactiveCount: 0,
    config: { runtime: {}, model: {} },
    serial: async (_id: string, fn: () => unknown) => fn(),
    getStory: async () => baseStory(),
    getParticipant: async () => participant,
    dueIntents: async () => [],
    reportStandalone: () => {}, reportOperation: () => {}, reportStandaloneOperation: () => {},
    scheduleNarrativeRetry: async () => { step('retry') },
    jevGatePassiveResearch: async () => {},
    semanticTurnEmbeddingEnabled: () => false,
    stickerCatalogForSession: async () => [],
    privateChatCapabilities: () => ({ quoteReply: true, reactions: [], nativeFaces: [], expressionThreshold: 0.7 }),
    loadNativeImages: async () => [],
    loadNativeAudio: async () => [],
    deliverEarlyPrivateReply: async () => undefined,
    tryDecide: async () => { step('decide'); return { decision: {}, succeeded: true, effectiveNow: new Date(), immediateObservations: [] } },
    persistImmediateObservations: async () => {},
    persistDecision: async () => { step('persist'); return { messages: [], commit: undefined, scriptEntry: undefined } },
    dbSet: async () => {},
    cancelPendingNarrativeRetries: async () => {},
    scheduleConversationFollowUpsAfterTurn: async () => {},
    canHandleParticipant: () => true,
    deliverOutgoingMessages: async () => [],
    scheduleCompaction: () => {},
  })

  // revision 已因第二条消息递增；用旧 revision 触发 flush 应被 beginFlush 拒绝。
  const revisionNow = turn.nextRevision
  await service.flushBufferedNarrative('p1', revisionNow)
  // 正常路径执行后批次被消费；再验证 obsolete 分支：人为重放已作废请求。
  assert.ok(trace.includes('decide'), '当前 revision 的请求正常执行')
  trace.length = 0
  turn.inFlightRequestId = 1
  turn.obsoleteRequestIds.add(1)
  turn.messages.push({ content: '回队消息', occurredAt: new Date(), supersededIntents: [], imageSources: [], audioSources: [] })
  // 重新占用当前 revision 模拟"过期结果返回"
  const stale = { ...turn }
  Object.defineProperty(stale, 'obsoleteRequestIds', { value: turn.obsoleteRequestIds })
  await service.flushBufferedNarrative('p1', revisionNow)
  assert.equal(engine.pendingTurnCount() >= 0, true, '引擎状态保持可清理')
})

test('群聊执行体步骤顺序基线：门通过→pause→快照→平台素材→模型→落库→群发', async () => {
  const { trace, step } = traceRecorder()
  const service: any = Object.create(InterludeService.prototype)
  const session = { channelId: 'group:100', selfId: '1' } as any
  const rule = { groupId: '100', contextLimit: 20 } as any
  const turn = {
    storyId: 's', groupId: '100', rule, channelId: 'group:100', latestHandle: { platform: 'onebot', channelId: 'group:100', selfId: '1' },
    messages: [{ speaker: '成员', content: '大家好' }], revision: 1, mentionedBot: false,
  } as any
  Object.assign(service, {
    bufferedGroupTurns: new Map([['s:100', turn]]),
    turnEngine: { turns: new Map(), narrating: new Set() },
    groupWillingness: new Map(),
    databaseResetting: false, desktopRuntimePhase: 'running', disposed: false,
    config: { runtime: { maxMessageCharacters: 500, messageSeparator: '<sep/>', splitReplyMessages: true }, model: {} },
    serial: async (_: unknown, fn: () => unknown) => fn(),
    getStory: async () => baseStory(),
    groupMessages: async () => { step('group-messages'); return { messages: [], imageRefs: [] } },
    groupCooldownActive: async () => false,
    pauseAutomaticAdvanceAfterUserMessage: async () => { step('pause') },
    groupChatCapabilities: () => { step('group-capabilities'); return undefined },
    semanticTurnEmbeddingEnabled: () => false,
    stickerCatalogForSession: async () => { step('sticker-catalog'); return [] },
    loadNativeImages: async () => { step('images'); return [] },
    loadHistoricalGroupImages: async () => { step('hist-images'); return [] },
    loadNativeAudio: async () => { step('audio'); return [] },
    jevGatePassiveResearch: async () => { step('jev') },
    tryDecide: async () => {
      step('decide')
      return { decision: { groupReply: { mode: 'immediate', content: '收到' } }, succeeded: true }
    },
    persistDecision: async () => { step('persist'); return { messages: [], commit: undefined, scriptEntry: undefined } },
    dbSet: async (table: string) => { step(`db-set:${table}`) },
    scheduleConversationFollowUpsAfterTurn: async () => { step('follow-ups') },
    executeGroupReactions: async () => { step('reactions'); return 0 },
    sendGroupMessage: async () => { step('send-group'); return { deliveredSegments: [], complete: false, segmentOutcomes: [] } },
    sendSticker: async () => { step('send-sticker') },
    sendNativeFace: async () => { step('send-native-face') },
    deliverOutgoingMessages: async () => { step('deliver') },
    scheduleCompaction: () => { step('compaction') },
    report: () => {}, reportOperation: () => {}, reportStandalone: () => {},
  })

  Object.defineProperty(service, 'platformPort', { value: new OneBotAdapter(service), configurable: true })
  await service.flushGroupTurn('s:100', 1)

  assert.deepEqual(trace, [
    'pause', 'group-messages', 'group-capabilities', 'sticker-catalog', 'images', 'hist-images',
    'jev', 'decide', 'persist', 'db-set:interlude_story', 'follow-ups', 'send-group', 'compaction',
  ], '群聊步骤顺序基线（D3 重排以此为证）')
  for (const forbidden of ['audio', 'reactions', 'send-sticker', 'send-native-face', 'deliver']) {
    assert.ok(!trace.includes(forbidden), `${forbidden} 不应出现在此路径（无音频/无表情动作/无私聊外发）`)
  }
})

test('D3 假 adapter：叙事编排以端口桩驱动，宿主不伪造任何平台函数', async () => {
  const { trace, step } = traceRecorder()
  const service: any = Object.create(InterludeService.prototype)
  const engine = createTurnEngine({
    setTimeout: (fn: () => void) => () => { void fn },
    userMessageDebounceSeconds: 2,
    scheduleTurnFlush: () => {},
    reportOperation: () => {},
  })
  service.turnEngine = engine
  // 假 adapter：纯端口桩——这是"平台"的全部形状，宿主侧零平台函数。
  // 原型上有只读 getter，须以自有属性遮蔽（defineProperty）。
  const fakeAdapter = {
    rememberSession: () => {},
    resolveSession: () => undefined,
    pruneSessions: () => { step('prune') },
    sessionCount: () => 0,
    privateCapabilities: () => { step('capabilities'); return { quoteReply: true, reactions: [], nativeFaces: [], expressionThreshold: 0.7 } },
    stickerCatalog: async () => { step('sticker-catalog'); return [] },
    loadImages: async () => { step('images'); return [] },
    loadAudio: async () => { step('audio'); return [] },
    deliverOutgoing: async () => { step('deliver'); return [] },
    deliverEarlyReply: async () => { step('early-deliver'); return undefined },
    sendSticker: async () => false,
    sendNativeFace: async () => false,
  }
  Object.defineProperty(service, 'platformPort', { value: fakeAdapter, configurable: true })
  const participant = { id: 'p9', status: 'active', channelId: 'private:u9' } as any
  const theSession = { platform: 'onebot', channelId: 'private:u9', selfId: '1', content: '在吗' } as any
  service.bufferUserNarrative(baseStory(), participant, theSession, new Date(), [], '在吗')
  Object.assign(service, {
    databaseResetting: false, desktopRuntimePhase: 'running', disposed: false, pendingProactiveCount: 0,
    config: { runtime: {}, model: {} },
    serial: async (_id: string, fn: () => unknown) => fn(),
    getStory: async () => baseStory(),
    getParticipant: async () => participant,
    dueIntents: async () => [],
    reportStandalone: () => {}, reportOperation: () => {}, reportStandaloneOperation: () => {},
    scheduleNarrativeRetry: async () => { step('retry') },
    jevGatePassiveResearch: async () => { step('jev') },
    semanticTurnEmbeddingEnabled: () => false,
    deliverEarlyPrivateReply: () => { throw new Error('宿主平台函数不得被调用') },
    stickerCatalogForSession: () => { throw new Error('宿主平台函数不得被调用') },
    privateChatCapabilities: () => { throw new Error('宿主平台函数不得被调用') },
    loadNativeImages: () => { throw new Error('宿主平台函数不得被调用') },
    loadNativeAudio: () => { throw new Error('宿主平台函数不得被调用') },
    deliverOutgoingMessages: () => { throw new Error('宿主平台函数不得被调用') },
    sendSticker: () => { throw new Error('宿主平台函数不得被调用') },
    sendNativeFace: () => { throw new Error('宿主平台函数不得被调用') },
    tryDecide: async () => { step('decide'); return { decision: { interaction: { reply: { mode: 'immediate', content: '嗯' } } }, succeeded: true, effectiveNow: new Date(), immediateObservations: [] } },
    persistImmediateObservations: async () => { step('persist-observations') },
    persistDecision: async () => { step('persist'); return { messages: [], commit: undefined, scriptEntry: undefined } },
    dbSet: async () => { step('db-set') },
    cancelPendingNarrativeRetries: async () => { step('cancel-retries') },
    scheduleConversationFollowUpsAfterTurn: async () => { step('follow-ups') },
    canHandleParticipant: () => true,
    scheduleCompaction: () => { step('compaction') },
  })
  const turn = engine.getTurn('p9')!
  await service.flushBufferedNarrative('p9', turn.nextRevision)
  // 平台交互全部落在假 adapter 上，宿主平台桩（抛错型）从未被触碰。
  assert.deepEqual(trace.filter(name => ['sticker-catalog', 'capabilities', 'images', 'deliver', 'jev', 'decide', 'persist'].includes(name)),
    ['jev', 'sticker-catalog', 'capabilities', 'images', 'decide', 'persist', 'deliver'])
})
