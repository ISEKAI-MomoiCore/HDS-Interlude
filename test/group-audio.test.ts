import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { OneBotAdapter } from '../src/platform/onebot-adapter'

function harness(audio = true, ruleOverrides: Record<string, unknown> = {}) {
  const service = Object.create(InterludeService.prototype) as any
  const session = { platform: 'onebot', channelId: 'group:100', selfId: '1' }
  const rule = { groupId: '100', contextLimit: 20, willingnessPreset: 'custom', willingness: { enabled: true, threshold: 999, baseGain: 0, probabilityAmplifier: 0 }, ...ruleOverrides }
  const message = { speaker: '成员', content: '[文件：demo.mp3]', ...(audio ? { audioSources: ['audio-source'], audioSession: session } : {}) }
  const turn = { storyId: 's', groupId: '100', rule, channelId: 'group:100', latestHandle: { platform: 'onebot', channelId: 'group:100', selfId: '1' }, messages: [message], revision: 1 }
  Object.assign(service, {
    bufferedGroupTurns: new Map([['s:100', turn]]), turnEngine: { turns: new Map(), narrating: new Set() }, groupWillingness: new Map(),
    config: { runtime: {} }, getStory: async () => ({ id: 's', status: 'active' }),
    serial: async (_: unknown, fn: () => unknown) => fn(), groupMessages: async () => [],
    groupCooldownActive: async () => { throw new Error('audio must bypass cooldown') },
    pauseAutomaticAdvanceAfterUserMessage: async () => {},
    groupChatCapabilities: () => undefined, semanticTurnEmbeddingEnabled: () => false,
    stickerCatalogForSession: async () => [], resolveSticker: () => undefined, resolveNativeFace: () => undefined,
    reportOperation: () => {}, reportStandalone: () => {}, report: (...args: unknown[]) => { throw new Error(String(args)) },
    scheduleCompaction: () => {}, scheduleConversationFollowUpsAfterTurn: async () => {},
  })
  Object.defineProperty(service, 'platformPort', { value: new OneBotAdapter(service), configurable: true })
  return { service, session, turn }
}

test('fresh group audio bypasses willingness and cooldown, reaches narrator once without forcing delivery', async () => {
  const { service, session } = harness()
  let calls = 0
  service.loadNativeAudio = async (story: any, sources: string[], sourceSession: unknown) => {
    assert.deepEqual(sources, ['audio-source'])
    assert.equal(sourceSession, session)
    return [{ id: 'turn-audio-1', format: 'mp3', base64: 'AAAA' }]
  }
  service.tryDecide = async (...args: any[]) => {
    calls++
    assert.equal(args[10][0].base64, 'AAAA')
    assert.match(args[10][0].id, /成员/)
    return { decision: {}, succeeded: false }
  }
  await service.flushGroupTurn('s:100', 1)
  await service.flushGroupTurn('s:100', 1)
  assert.equal(calls, 1)
  assert.equal(service.bufferedGroupTurns.size, 0)
  assert.equal(service.turnEngine.narrating.size, 0)
})

test('ordinary group text still obeys willingness', async () => {
  const { service } = harness(false)
  service.tryDecide = async () => assert.fail('text should not trigger this turn')
  await service.flushGroupTurn('s:100', 1)
  assert.equal(service.bufferedGroupTurns.size, 0)
})

test('audio obeys willingness when the group disables audioAlwaysTriggers', async () => {
  const { service } = harness(true, { audioAlwaysTriggers: false })
  service.tryDecide = async () => assert.fail('audio without always-trigger must still pass the willingness gate')
  await service.flushGroupTurn('s:100', 1)
  assert.equal(service.bufferedGroupTurns.size, 0)
})

test('cooldown: @ batch is exempt (§3.2 v2.4), non-related batch still blocked', async () => {
  // 新语义：@ 她的批次豁免冷却（否则放行只越过跳过检查，冷却仍拦掉）。
  const at = harness(true, { audioAlwaysTriggers: false })
  at.turn.mentionedBot = true
  at.service.groupCooldownActive = async () => true
  let atCalls = 0
  at.service.tryDecide = async () => { atCalls++; return { decision: {}, succeeded: false } }
  await at.service.flushGroupTurn('s:100', 1)
  assert.equal(atCalls, 1, '@ 批次应越过冷却进入主叙事')

  // 旧保护保留：非关联批次（无 @ 无引用）在冷却内仍被拦。
  const plain = harness(false, { willingnessPreset: 'off' } as any)
  plain.service.groupCooldownActive = async () => true
  let plainCalls = 0
  plain.service.tryDecide = async () => { plainCalls++; return { decision: {}, succeeded: false } }
  await plain.service.flushGroupTurn('s:100', 1)
  assert.equal(plainCalls, 0, '非关联批次在冷却内不得进入主叙事')
})

test('audio still bypasses willingness and cooldown when audioAlwaysTriggers is explicitly on', async () => {
  const { service } = harness(true, { audioAlwaysTriggers: true })
  service.groupCooldownActive = async () => true
  service.loadNativeAudio = async () => [{ id: 'a', format: 'mp3', base64: 'AAAA' }]
  let calls = 0
  service.tryDecide = async () => { calls++; return { decision: {}, succeeded: false } }
  await service.flushGroupTurn('s:100', 1)
  assert.equal(calls, 1)
})

test('buffer retains audio sources with their original session when a later text arrives', () => {
  const { service, session, turn } = harness()
  service.bufferedGroupTurns.clear()
  service.ctx = { setTimeout: () => () => {} }
  service.bufferGroupMessage({ id: 's' }, turn.rule, session, { content: '[音频]' }, false, false, ['source'])
  service.bufferGroupMessage({ id: 's' }, turn.rule, { channelId: 'group:100' }, { content: '后续文字' }, false, false)
  const messages = service.bufferedGroupTurns.get('s:100').messages
  assert.equal(messages[0].audioSession, session)
  assert.deepEqual(messages[0].audioSources, ['source'])
  assert.equal(messages[1].audioSources, undefined)
})

test('group claims the story before reading storage and releases it when storage fails', async () => {
  const { service } = harness()
  service.getStory = async () => {
    assert.equal(service.turnEngine.narrating.has('s'), true)
    throw new Error('database unavailable')
  }
  await service.flushGroupTurn('s:100', 1)
  assert.equal(service.turnEngine.narrating.size, 0)
})

test('group-authored cross-conversation messages reach the shared delivery queue', async () => {
  const { service, turn, session } = harness()
  const outgoing = [{ participantId: 'group:200', content: '转达' }]
  service.loadNativeAudio = async () => []
  service.tryDecide = async () => {
    // A newer incoming message must not change this batch's adapter session.
    turn.latestHandle = { platform: 'onebot', channelId: 'group:100', selfId: 'different-bot' }
    return { decision: { groupReply: { mode: 'immediate', content: '收到' } }, succeeded: true }
  }
  service.persistDecision = async () => ({ messages: outgoing })
  service.dbSet = async () => {}
  service.scheduleConversationFollowUpsAfterTurn = async () => {}
  service.sendGroupMessage = async (_story: any, channel: string, _content: string, _quote: any, usedSession: any) => {
    assert.equal(channel, 'group:100')
    assert.equal(usedSession, session)
    return { deliveredSegments: [], complete: false, segmentOutcomes: [] }
  }
  let sent = 0
  service.deliverOutgoingMessages = async (_story: any, messages: any[]) => {
    sent++
    assert.equal(messages, outgoing)
  }
  await service.flushGroupTurn('s:100', 1)
  assert.equal(sent, 1)
})

test('reset invalidates a group draft already in flight without deleting a replacement buffer', async () => {
  const { service, turn } = harness()
  const replacement = { ...turn, messages: [] }
  service.loadNativeAudio = async () => []
  service.tryDecide = async () => {
    service.bufferedGroupTurns.set('s:100', replacement)
    return { decision: {}, succeeded: true }
  }
  service.persistDecision = async () => assert.fail('obsolete draft must not commit')
  await service.flushGroupTurn('s:100', 1)
  assert.equal(service.bufferedGroupTurns.get('s:100'), replacement)
})
