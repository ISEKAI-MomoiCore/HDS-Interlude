import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { OneBotAdapter } from '../src/platform/onebot-adapter'

/** 回归：issue hdsi-issue-urge-density-decay-deadlock-20261029（rc58 报告）。
 * Bug 2（死锁主因）：群消息接收路径曾无条件重置 nextAdvanceAt，且发生在
 * mention-only 证据过滤之前——活跃群每条未 @ 消息都把自动推进推回未来，
 * 永不触发（日志反复 conversation-density-decay、0 次模型调用）。
 * 修复：pause 移至 flushGroupTurnUnlocked 意愿/冷却两道门通过之后。
 */

const methods = InterludeService.prototype as any

function groupReceiveHost(rule: Record<string, unknown>) {
  const story = { id: 's1', status: 'active', selfId: '10001', platform: 'onebot', state: {}, setting: { character: { name: '主角' } } }
  const pauses: number[] = []
  const host: Record<string, any> = {
    config: { runtime: {} },
    seenIncomingMessages: new Map(),
    contextDensity: { record: () => {} },
    serial: async (_id: string, run: () => unknown) => run(),
    canHandleGroupSession: () => true,
    groupRule: () => rule,
    findStory: async () => story,
    getStory: async () => story,
    groupSenderName: async () => '某人',
    readForward: async () => undefined,
    tryHarvestStickers: () => {},
    channelMetadataFor: async () => undefined,
    touchEndpointStateInbound: async () => {},
    dbGet: async () => [],
    appendEntry: async () => ({ id: 1 }),
    pauseAutomaticAdvanceAfterUserMessage: async () => { pauses.push(Date.now()) },
    rememberIncomingMessage: () => {},
    bufferGroupMessage: () => {},
    report: () => {}, reportOperation: () => {},
  }
  return { host, pauses }
}

const groupSession = (patch: Record<string, unknown> = {}) => ({
  platform: 'onebot', selfId: '10001', userId: '20002', channelId: 'group:123',
  messageId: 'm-1', content: '闲聊', timestamp: undefined, type: 'message', ...patch,
} as any)

test('Bug2 接收层：群消息不再重置自动推进——mention-only 未@证据消息与 always 普通消息都不调用 pause', async () => {
  // mention-only 群的纯文本未@消息在第一道门（故事查找前）即返回，到不了
  // pause；死锁的实际载体是未@的图片证据消息（旧代码 pause 在证据早退之前
  // 执行）与 always 群的每条消息。
  const mentionOnly = groupReceiveHost({ groupId: '123', enabled: true, responseMode: 'mention-only', debounceSeconds: 1 })
  assert.equal(await methods.receiveGroup.call(mentionOnly.host, groupSession({ content: '<img src="https://gchat.qpic.cn/x"/>' })), true)
  assert.equal(mentionOnly.pauses.length, 0, 'mention-only 未@证据消息不得重置 nextAdvanceAt（死锁主场景）')

  const always = groupReceiveHost({ groupId: '123', enabled: true, responseMode: 'always', debounceSeconds: 1 })
  assert.equal(await methods.receiveGroup.call(always.host, groupSession({ messageId: 'm-2' })), true)
  assert.equal(always.pauses.length, 0, '接收路径不再 pause——改由 flush 在门通过后执行')
})

function flushHarness(ruleOverrides: Record<string, unknown> = {}, turnOverrides: Record<string, unknown> = {}) {
  const service = Object.create(InterludeService.prototype) as any
  const session = { channelId: 'group:100', selfId: '1' }
  const order: string[] = []
  const rule = { groupId: '100', contextLimit: 20, willingnessPreset: 'custom', willingness: { enabled: true, threshold: 999, baseGain: 0, probabilityAmplifier: 0 }, ...ruleOverrides }
  const message = { speaker: '成员', content: '闲聊' }
  const turn = { storyId: 's', groupId: '100', rule, channelId: 'group:100', latestHandle: { platform: 'onebot', channelId: 'group:100', selfId: '1' }, messages: [message], revision: 1, ...turnOverrides }
  Object.assign(service, {
    bufferedGroupTurns: new Map([['s:100', turn]]), turnEngine: { turns: new Map(), narrating: new Set() }, groupWillingness: new Map(),
    config: { runtime: {} }, getStory: async () => ({ id: 's', status: 'active' }),
    serial: async (_: unknown, fn: () => unknown) => fn(),
    groupMessages: async () => [],
    groupCooldownActive: async () => false,
    pauseAutomaticAdvanceAfterUserMessage: async () => { order.push('pause') },
    groupChatCapabilities: () => undefined, semanticTurnEmbeddingEnabled: () => false,
    stickerCatalogForSession: async () => [], resolveSticker: () => undefined, resolveNativeFace: () => undefined,
    reportOperation: () => {}, reportStandalone: () => {}, report: () => {},
    scheduleCompaction: () => {}, scheduleConversationFollowUpsAfterTurn: async () => {},
    jevGatePassiveResearch: async () => {},
    tryDecide: async () => { order.push('decide'); return { decision: {}, succeeded: false } },
  })
  Object.defineProperty(service, 'platformPort', { value: new OneBotAdapter(service), configurable: true })
  return { service, order }
}

test('Bug2 冲刷层：意愿门未触发时不得 pause——nextAdvanceAt 保持原计划，生活按节奏继续', async () => {
  const { service, order } = flushHarness()
  await service.flushGroupTurn('s:100', 1)
  assert.deepEqual(order, [], '意愿门拦截的批次不应重置自动推进，也不得调用模型')
})

test('Bug2 冲刷层：冷却期内不得 pause（非关联批次；@ 已豁免冷却）', async () => {
  // @ 批次现在豁免冷却（§3.2 v2.4），改用无关联但过门的批次（preset off = 门关闭直通）。
  const { service, order } = flushHarness({ willingnessPreset: 'off' } as any)
  service.groupCooldownActive = async () => true
  await service.flushGroupTurn('s:100', 1)
  assert.deepEqual(order, [], '冷却拦截的批次不应重置自动推进')
})

test('Bug2 冲刷层：@ 直通通过两道门后 pause 先于主叙事调用（回合伞语义保留）', async () => {
  const { service, order } = flushHarness({}, { mentionedBot: true })
  await service.flushGroupTurn('s:100', 1)
  assert.deepEqual(order, ['pause', 'decide'], '进入主叙事的批次应先 pause 再调用模型')
})
