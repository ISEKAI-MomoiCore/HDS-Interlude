import { deliveryHost } from './helpers/delivery-host'
import assert from 'node:assert/strict'
import test from 'node:test'
import { h } from 'koishi'
import { readFileSync } from 'node:fs'
import { InterludeService } from '../src/service'
import { freshEndpointState } from '../src/endpoints'

const methods = InterludeService.prototype as any

test('cross-group partial delivery records only accepted segments and preserves event identity', async () => {
  const updates: any[] = [], entries: any[] = []
  const host = {
    config: { onebot: { groupChats: [{ groupId: '12345', enabled: true }] } },
    dbGet: async (_table: string, query: any) => query.kind ? [] : [{ id: 7, storyId: 's', metadata: { commitId: 'c' } }],
    serial: async (_id: string, run: () => Promise<void>) => run(),
    sendGroupMessage: async () => ({ complete: false, deliveredSegments: ['first'], segmentOutcomes: [
      { index: 0, content: 'first', status: 'delivered' }, { index: 1, content: 'second', status: 'failed', reason: 'offline' },
    ] }),
    updateScriptDeliveryOutcome: async (...args: any[]) => updates.push(args),
    appendEntry: async (...args: any[]) => entries.push(args), report: () => {},
  }
  deliveryHost(host)
  await methods.sendCrossGroupMessage.call(host, { id: 's' }, { participantId: 'group:12345', content: 'first<sep/>second', scriptEvent: { commitId: 'c', eventId: 'e', segmentIndex: 0, scriptEntryId: 7 } })
  assert.deepEqual(updates.map(x => [x[1].eventId, x[1].segmentIndex, x[2]]), [['e', 0, 'delivered'], ['e', 1, 'failed']])
  assert.equal(entries[0][1].kind, 'character-group-message')
  assert.equal(entries[0][1].content, 'first')
  assert.equal(entries[0][1].metadata.partialDelivery, true)
})

test('disabled cross-group target fails ledger without transport or invented speech', async () => {
  let sends = 0, entries = 0
  const statuses: string[] = []
  await methods.sendCrossGroupMessage.call(deliveryHost({
    config: { onebot: { groupChats: [] } }, splitOutgoingMessage: () => ['text'],
    serial: async (_id: string, run: () => Promise<void>) => run(),
    sendGroupMessage: async () => { sends++ }, appendEntry: async () => { entries++ },
    updateScriptDeliveryOutcome: async (_id: string, _ref: any, status: string) => { statuses.push(status) }, report: () => {},
  }), { id: 's' }, { participantId: 'group:12345', content: 'text', scriptEvent: { eventId: 'e', segmentIndex: 0 } })
  assert.equal(sends, 0); assert.equal(entries, 0); assert.deepEqual(statuses, ['failed'])
})

test('cross-group queue works without a live session and never looks up a private participant', async () => {
  let groups = 0
  const result = await methods.sendOutgoingMessages.call({ ensureEndpointRegistry: async () => {}, endpointForDelivery: () => ({}), reportStandalone: () => {}, endpointAddressSync: () => ({}), noteEndpointOutbound: () => {}, recordOutgoingDeliveryFailure: async () => {}, 
    getParticipant: async () => { throw new Error('group routed as private') },
    sendCrossGroupMessage: async (_story: any, message: any, session: any) => {
      assert.equal(message.participantId, 'group:12345'); assert.equal(session, undefined); groups++
    }, report: () => {},
  }, { id: 's' }, [{ participantId: 'group:12345', content: 'text' }])
  assert.equal(groups, 1); assert.deepEqual(result, [])
})

test('group failure is isolated from a subsequent private reply', async () => {
  const privateTarget = { id: 'p', channelId: 'private:p' }
  let sends = 0
  const delivered = await methods.sendOutgoingMessages.call({ ensureEndpointRegistry: async () => {}, endpointForDelivery: () => ({}), reportStandalone: () => {}, endpointAddressSync: () => ({}), noteEndpointOutbound: () => {}, recordOutgoingDeliveryFailure: async () => {}, 
    sendCrossGroupMessage: async () => { throw new Error('group receipt failure') },
    canHandleParticipant: () => true, resolveLiteralQuoteMessageId: async () => undefined,
    noteEndpointOutbound: () => {},
    config: { logging: {} }, report: () => {}, reportOperation: () => {},
  }, { id: 's' }, [{ participantId: 'group:12345', content: 'group' }, { participantId: 'p', content: 'private' }], privateTarget, { send: async () => { sends++; return ['id'] } })
  assert.equal(sends, 1); assert.equal(delivered.length, 1); assert.equal(delivered[0].content, 'private')
})

test('empty group transport receipt is not recorded as delivery', async () => {
  const outcome = await methods.sendGroupMessage.call({
    ctx: { bots: [] }, splitOutgoingMessage: () => ['text'], endpointAddressSync: (legacy: unknown) => legacy, noteEndpointOutbound: () => {}, report: () => {},
  }, { id: 's' }, '12345', 'text', undefined, { bot: { sendMessage: async () => [] } })
  assert.equal(outcome.complete, false); assert.deepEqual(outcome.deliveredSegments, [])
})

test('cross-group delivery consumes an explicitly selected story endpoint', async () => {
  const sent: string[] = []
  const botA = { platform: 'onebot', selfId: '10001', sendMessage: async () => { sent.push('a'); return ['a1'] } }
  const botB = { platform: 'onebot', selfId: '10002', sendMessage: async () => { sent.push('b'); return ['b1'] } }
  const outcome = await methods.sendGroupMessage.call({
    ctx: { bots: [botA, botB] }, splitOutgoingMessage: () => ['text'], report: () => {}, ensureEndpointRegistry: async () => {},
    endpointRows: [{ id: 'ep-b', ownerKind: 'story-role', ownerId: 's', enabled: true, platform: 'onebot', selfId: '10002' }],
    endpointForDelivery: (id: string) => id === 'ep-b' ? { row: { id: 'ep-b', ownerKind: 'story-role', ownerId: 's', enabled: true, platform: 'onebot', selfId: '10002' } } : { reason: 'endpoint-not-found' },
    noteEndpointOutbound: () => {}, report: () => {},
  }, { id: 's' }, '12345', 'text', undefined, { bot: botA }, 'ep-b')
  assert.equal(outcome.complete, true)
  assert.deepEqual(sent, ['b'])
})

test('cross-group delivery rejects an endpoint from another story', async () => {
  let sends = 0
  const outcome = await methods.sendGroupMessage.call({ ensureEndpointRegistry: async () => {}, report: () => {}, 
    ctx: { bots: [{ platform: 'onebot', selfId: '10002', sendMessage: async () => { sends++; return ['x'] } }] },
    splitOutgoingMessage: () => ['text'], endpointRows: [{ id: 'ep-other', ownerKind: 'story-role', ownerId: 'other-story', enabled: true, platform: 'onebot', selfId: '10002' }],
    noteEndpointOutbound: () => {}, report: () => {},
  }, { id: 's' }, '12345', 'text', undefined, undefined, 'ep-other')
  assert.equal(outcome.complete, false)
  assert.equal(outcome.segmentOutcomes[0].reason, 'endpoint-not-found')
  assert.equal(sends, 0)
})

test('history commands render stored segments as literal text', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  for (const command of ['interlude.timeline [limit:number]', 'interlude.script [limit:number]']) {
    const block = source.slice(source.indexOf(`ctx.command('${command}'`)).split('\n  ctx.command(')[0]
    assert.match(block, /return h\.text\(entries\.map/)
  }
  const text = '[history] <at id="12345"/> <img src="file:///not-to-send"/>'
  const parsed = h.parse(h.text(text).toString())
  assert.ok(parsed.every(element => element.type === 'text'))
})

test('default private endpoint route observes the live session before gating and preserves immediate delivery', async () => {
  const sent: unknown[] = []
  const endpoint = {
    id: 'ep-private', ownerKind: 'participant-user', ownerId: 'p1', channelKind: 'qq',
    platform: 'onebot', accountKey: 'onebot:100', selfId: '100', userId: '200',
    conversationKind: 'private', enabled: true, createdAt: new Date(), updatedAt: new Date(),
  }
  const endpointStates = new Map([['ep-private', freshEndpointState('ep-private')]])
  const host: any = {
    endpointRegistryReady: true, endpointRows: [endpoint], endpointStates,
    ensureEndpointRegistry: async () => {},
    endpointAddressSync: () => ({ platform: 'onebot', selfId: '100', endpointId: 'ep-private' }),
    setEndpointState: (id: string, state: any) => endpointStates.set(id, state),
    persistEndpointState: () => {},
    endpointGateReason: methods.endpointGateReason,
    endpointForDelivery: methods.endpointForDelivery,
    getParticipant: async () => ({ id: 'p1', platform: 'onebot', selfId: '100', channelId: 'private:200' }),
    canHandleParticipant: () => true,
    resolveLiteralQuoteMessageId: async () => undefined,
    noteEndpointOutbound: () => {},
    recordOutgoingDeliveryFailure: async (...args: unknown[]) => { throw new Error(`unexpected failure: ${args.join('|')}`) },
    report: () => {}, reportOperation: () => {}, reportStandalone: () => {},
    config: { logging: {} },
    ctx: { bots: [] },
  }
  const session = { platform: 'onebot', selfId: '100', send: async (content: unknown) => { sent.push(content); return ['msg-1'] } }
  const delivered = await methods.sendOutgoingMessages.call(host, { id: 's1' }, [{ participantId: 'p1', content: '收到', userInitiated: true }], { id: 'p1' }, session)
  assert.equal(delivered.length, 1)
  assert.deepEqual(sent, ['收到'])
  assert.equal(endpointStates.get('ep-private')?.connection.online, true)
  assert.equal(delivered[0].endpointId, 'ep-private')
})

test('delayed OneBot private delivery prefixes bare user ids instead of sending to a group', async () => {
  const sent: unknown[][] = []
  const bot = {
    platform: 'onebot', selfId: '1303322392',
    sendMessage: async (...args: unknown[]) => { sent.push(args); return ['msg-2'] },
  }
  const host: any = {
    endpointRegistryReady: false,
    ensureEndpointRegistry: async () => {},
    endpointForDelivery: () => ({}),
    endpointAddressSync: () => ({ platform: 'onebot', selfId: '1303322392' }),
    getParticipant: async () => ({
      id: 'p-private', platform: 'onebot', selfId: '1303322392',
      userId: '1319973221', channelId: '1319973221',
    }),
    canHandleParticipant: () => true,
    resolveLiteralQuoteMessageId: async () => undefined,
    findBotForParticipant: () => bot,
    noteEndpointOutbound: () => {},
    recordOutgoingDeliveryFailure: async (...args: unknown[]) => { throw new Error(`unexpected failure: ${args.join('|')}`) },
    report: () => {}, reportOperation: () => {}, reportStandalone: () => {},
    config: { logging: {} }, ctx: { bots: [bot] },
  }

  const delivered = await methods.sendOutgoingMessages.call(
    host,
    { id: 's1' },
    [{ participantId: 'p-private', content: '第二条消息' }],
  )

  assert.equal(delivered.length, 1)
  assert.deepEqual(sent, [['private:1319973221', '第二条消息']])
})

test('default group endpoint route observes the live group session before gating', async () => {
  const sent: unknown[][] = []
  const endpoint = {
    id: 'ep-group', ownerKind: 'story-role', ownerId: 's1', channelKind: 'qq',
    platform: 'onebot', accountKey: 'onebot:100', selfId: '100', enabled: true,
    createdAt: new Date(), updatedAt: new Date(),
  }
  const endpointStates = new Map([['ep-group', freshEndpointState('ep-group')]])
  const host: any = {
    endpointRegistryReady: true, endpointRows: [endpoint], endpointStates,
    config: { onebot: { groupChats: [{ groupId: '100', enabled: true }] } },
    ctx: { bots: [] }, ensureEndpointRegistry: async () => {}, splitOutgoingMessage: () => ['群里收到'],
    endpointAddressSync: () => ({ platform: 'onebot', selfId: '100', endpointId: 'ep-group' }),
    setEndpointState: (id: string, state: any) => endpointStates.set(id, state),
    persistEndpointState: () => {}, endpointGateReason: methods.endpointGateReason,
    endpointForDelivery: methods.endpointForDelivery, noteEndpointOutbound: () => {}, report: () => {},
  }
  const session = {
    platform: 'onebot', selfId: '100', channelId: 'group:100',
    bot: { sendMessage: async (...args: unknown[]) => { sent.push(args); return ['msg-1'] } },
  }
  const outcome = await methods.sendGroupMessage.call(host, { id: 's1', platform: 'onebot', selfId: '100' }, 'group:100', '群里收到', undefined, session)
  assert.equal(outcome.complete, true)
  assert.deepEqual(sent, [['group:100', '群里收到']])
  assert.equal(endpointStates.get('ep-group')?.connection.online, true)
})
test('split-message delivery restores the explicit endpoint onto the outgoing draft', async () => {
  const captured: any[] = []
  const intent = {
    id: 41, storyId: 's1', participantId: 'p1', type: 'split-message', status: 'pending',
    notBefore: new Date(Date.now() - 1_000),
    payload: {
      content: '显式端点分段', endpointId: 'ep-explicit',
      scriptEvent: {
        commitId: 'commit-1', eventId: 'event-1', eventKind: 'outgoing-message',
        endpointId: 'ep-explicit', causedByEventIds: [], scriptEntryId: 7,
        fullContent: '显式端点分段', bubbleIndex: 0, bubbleCount: 1,
      },
    },
  }
  const host: any = {
    config: { runtime: { maxMessageCharacters: 1_000 } },
    serial: async (_id: string, run: () => Promise<void>) => run(),
    getStory: async () => ({ id: 's1' }),
    dbGet: async (table: string, query: any) => table === 'interlude_script_entry' && !query.kind
      ? [{ id: 7, storyId: 's1' }] : query?.notBefore ? [intent] : [],
    dbSet: async () => {},
    getParticipant: async () => ({ id: 'p1', status: 'active' }),
    interruptedTypingParticipants: new Set(),
    sendOutgoingMessages: async (_story: any, messages: any[]) => { captured.push(...messages); return messages },
    updateScriptDeliveryOutcome: async () => {},
    appendEntry: async () => {},
    recordAutomaticDelivery: async () => {},
    recordCharacterMessage: async () => {},
    scheduleNextSplitWake: async () => {},
    reconcileTerminalSplitIntent: methods.reconcileTerminalSplitIntent,
  }
  deliveryHost(host)
  await methods.deliverDueSplitSegments.call(host, 's1')
  assert.equal(captured.length, 1)
  assert.equal(captured[0].endpointId, 'ep-explicit')
  assert.equal(captured[0].scriptEvent.endpointId, 'ep-explicit')
})
test('desktop bridge exposes endpoint-health with a typed result even on validation failure', () => {
  const source = readFileSync(new URL('../src/desktop-bridge.ts', import.meta.url), 'utf8')
  assert.match(source, /'endpoint-health'/)
  assert.match(source, /sendToDesktop\('endpoint-health-result'/)
  assert.match(source, /command\.command === 'endpoint-health' \? 'endpoint-health-result'/)
})
