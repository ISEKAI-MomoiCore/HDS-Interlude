import { deliveryHost } from './helpers/delivery-host'
import assert from 'node:assert/strict'
import test from 'node:test'
import { systemPrompt, toPromptPayload } from '../src/narrator'
import { calibratedNativeFaceWillingness, describeQuotedMessage, formatGroupSpeaker, InterludeService, normalizeAllowedReactions, normalizeGroupChatActions, normalizeQuotedMessageContent } from '../src/service'
import { ChatActionCapabilities, emptyStorySetting, emptyStoryState, GroupContext, InterludeStory, NarrativeDecision, NarrativeRequest } from '../src/types'

test('group speaker labels retain both display name and stable QQ identity', () => {
  assert.equal(formatGroupSpeaker('渔社', '2171322646'), '群成员「渔社」（QQ：2171322646）')
  assert.equal(formatGroupSpeaker('', '2171322646'), '群成员（QQ：2171322646）')
})

const context: GroupContext = {
  groupId: '100', channelId: 'group:100', label: '测试群', purpose: '', characterRole: '',
  messages: [{
    senderId: '200', senderName: '成员', speaker: '群成员「成员」（QQ：200）',
    messageRef: 'msg-7', messageId: '-12345', content: '这条消息可以被操作',
    occurredAt: new Date('2026-08-28T00:00:00.000Z'), direction: 'user',
  }],
}

const capabilities: ChatActionCapabilities = {
  platform: 'qq', quoteReply: true, reactions: ['like', 'heart'],
}

test('chat action validation accepts only advertised actions and supplied message references', () => {
  const valid: NarrativeDecision = {
    groupReply: { mode: 'immediate', content: '指定回复', replyTo: 'msg-7' },
    messageReactions: [{ messageRef: 'msg-7', reaction: 'heart' }],
  }
  assert.deepEqual(normalizeGroupChatActions(valid, capabilities, context), {
    replyTo: { messageRef: 'msg-7', messageId: '-12345' },
    reactions: [{ messageRef: 'msg-7', messageId: '-12345', reaction: 'heart' }],
  })

  const invalid = normalizeGroupChatActions({
    groupReply: { mode: 'immediate', content: '越界回复', replyTo: 'msg-999' },
    messageReactions: [{ messageRef: 'msg-7', reaction: 'angry' }],
  }, capabilities, context)
  assert.deepEqual(invalid, { reactions: [] })
  assert.deepEqual(normalizeGroupChatActions(valid, undefined, context), { reactions: [] })
})

test('group replies tolerate an incomplete compatibility interaction object', () => {
  const decision: NarrativeDecision = {
    groupReply: { mode: 'immediate', content: '收到' },
    interaction: {} as NarrativeDecision['interaction'],
  }
  assert.deepEqual(normalizeGroupChatActions(decision, capabilities, context), { reactions: [] })
})

test('reaction allowlist is semantic, deduplicated and bounded', () => {
  assert.deepEqual(normalizeAllowedReactions(['like', 'like', 'unknown', 'heart']), ['like', 'heart'])
})

test('native-face threshold is calibrated against reply meaning instead of a model-declared maximum', () => {
  assert.ok(calibratedNativeFaceWillingness('sweat', 1, '你还好意思问咋了') < 0.95)
  assert.ok(calibratedNativeFaceWillingness('laugh', 1, '哈哈哈你也太离谱了') < 0.95)
  assert.ok(calibratedNativeFaceWillingness('laugh', 1, '哈哈哈你也太离谱了') >= 0.7)
})

test('prompt payload hides message references until chat capabilities are active', () => {
  const now = new Date('2026-08-28T00:00:00.000Z')
  const story: InterludeStory = {
    id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: 'group:100', status: 'active',
    setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now,
  }
  const base: NarrativeRequest = {
    phase: 'user-message', story, from: now, now, participant: null, participants: [], shareParticipantDetails: false,
    dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [], groupContext: context,
  }
  const hidden = toPromptPayload(base) as Record<string, any>
  const visible = toPromptPayload({ ...base, chatCapabilities: capabilities }) as Record<string, any>
  assert.equal(hidden.incomingEvent.chatCapabilities, undefined)
  assert.equal(hidden.incomingEvent.groupContext.messages[0].messageRef, undefined)
  assert.equal(hidden.incomingEvent.groupContext.messages[0].messageId, undefined)
  assert.equal(visible.incomingEvent.groupContext.messages[0].messageRef, 'msg-7')
  assert.equal(visible.incomingEvent.groupContext.messages[0].messageId, undefined)
})

test('quoted messages retain author ownership and bounded readable content', () => {
  assert.equal(normalizeQuotedMessageContent('看这个<image src="x"/><record src="y"/>'), '看这个[图片][语音]')
  const quote = describeQuotedMessage({
    selfId: '100',
    quote: { user: { id: '100', name: '机器人旧名' }, content: '这是主角之前说的话' },
  } as any, 'Yukiyo')
  assert.deepEqual(quote, {
    senderId: '100', senderName: 'Yukiyo', speaker: '主角「Yukiyo」', content: '这是主角之前说的话',
  })
})

test('quoted context is conditional and remains separate from the new message', () => {
  const now = new Date('2026-08-28T00:00:00.000Z')
  const story: InterludeStory = {
    id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: 'private:200', status: 'active',
    setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now,
  }
  const base: NarrativeRequest = {
    phase: 'user-message', story, from: now, now, userMessage: '你这句话是什么意思', participant: null,
    participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [],
    supersededIntents: [], recentEntries: [], memories: [],
  }
  const withoutQuote = toPromptPayload(base) as Record<string, any>
  const withQuote = toPromptPayload({
    ...base,
    quotedMessages: [{ messageIndex: 1, senderId: 'bot', senderName: 'Yukiyo', speaker: '主角「Yukiyo」', content: '早点休息。' }],
  }) as Record<string, any>
  assert.equal(withoutQuote.incomingEvent.event.quotedMessages, undefined)
  assert.equal(withQuote.incomingEvent.event.content, '你这句话是什么意思')
  assert.equal(withQuote.incomingEvent.event.quotedMessages[0].content, '早点休息。')

  const ordinaryPrompt = systemPrompt('user-message', '', '', '', '', '')
  const quotedPrompt = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, true)
  assert.doesNotMatch(ordinaryPrompt, /CURRENT EVENT QUOTE/)
  assert.match(quotedPrompt, /quoted text as a second incoming message/)
  assert.match(quotedPrompt, /never change its author/)
})

const transportStory: InterludeStory = {
  id: 'character:onebot:old-bot', platform: 'onebot', selfId: 'old-bot', userId: '', channelId: 'group:100', status: 'active',
  setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: new Date('2026-08-28T00:00:00.000Z'),
  createdAt: new Date('2026-08-28T00:00:00.000Z'), updatedAt: new Date('2026-08-28T00:00:00.000Z'),
}

test('group delivery uses the bot from the live session before stale story transport metadata', async () => {
  const sentBySession: unknown[][] = []
  const sentByStaleBot: unknown[][] = []
  const service = {
    ctx: { bots: [{ selfId: 'old-bot', platform: 'onebot', sendMessage: async (...args: unknown[]) => sentByStaleBot.push(args) }] },
    ensureEndpointRegistry: async () => {}, splitOutgoingMessage: () => ['你好'],
    endpointAddressSync: (legacy: unknown) => legacy,
    noteEndpointOutbound: () => {},
    report: () => undefined,
  }
  const liveSession = { bot: { sendMessage: async (...args: unknown[]) => sentBySession.push(args) } }
  const sendGroupMessage = (InterludeService.prototype as any).sendGroupMessage
  const delivered = await sendGroupMessage.call(service, transportStory, 'group:100', '你好', undefined, liveSession)

  assert.deepEqual(delivered, {
    deliveredSegments: ['你好'], complete: true,
    segmentOutcomes: [{ index: 0, content: '你好', status: 'delivered' }],
  })
  assert.deepEqual(sentBySession, [['group:100', '你好']])
  assert.deepEqual(sentByStaleBot, [])
})

test('stale OneBot transport repairs only when its configured account is no longer online', async () => {
  const updates: unknown[][] = []
  const warnings: unknown[][] = []
  const repair = (InterludeService.prototype as any).repairCanonicalOneBotStoryTransport
  const offlineService = {
    ctx: { bots: [] },
    endpointRegistryReady: true,
    endpointRows: [],
    ensureEndpointRegistry: async () => {},
    dbSet: async (...args: unknown[]) => { updates.push(args) },
    reportStandalone: (...args: unknown[]) => { warnings.push(args) },
  }
  const repaired = await repair.call(offlineService, transportStory, { platform: 'onebot', selfId: 'new-bot' })
  assert.equal(repaired.platform, 'onebot')
  assert.equal(repaired.selfId, 'new-bot')
  assert.equal(updates.length, 1)
  assert.equal(warnings.length, 1)

  const activeService = {
    ctx: { bots: [{ selfId: 'old-bot', platform: 'onebot' }] },
    dbSet: async () => { throw new Error('a live configured bot must not be rewritten') },
    reportStandalone: () => { throw new Error('a live configured bot must not warn') },
  }
  const unchanged = await repair.call(activeService, transportStory, { platform: 'onebot', selfId: 'new-bot' })
  assert.equal(unchanged, transportStory)
})

test('a failed segment makes group delivery incomplete, even when an earlier segment arrived', async () => {
  const deliveredSegments: string[] = []
  const service = {
    ctx: { bots: [] },
    ensureEndpointRegistry: async () => {}, splitOutgoingMessage: () => ['第一段', '第二段'],
    endpointAddressSync: (legacy: unknown) => legacy,
    noteEndpointOutbound: () => {},
    report: () => undefined,
  }
  const liveSession = { bot: { sendMessage: async (_channelId: string, content: string) => {
    deliveredSegments.push(content)
    if (content === '第二段') throw new Error('network interruption')
  } } }
  const sendGroupMessage = (InterludeService.prototype as any).sendGroupMessage
  const delivered = await sendGroupMessage.call(service, transportStory, 'group:100', '第一段<sep/>第二段', undefined, liveSession)

  assert.deepEqual(delivered, {
    deliveredSegments: ['第一段'], complete: false,
    segmentOutcomes: [
      { index: 0, content: '第一段', status: 'delivered' },
      { index: 1, content: '第二段', status: 'failed', reason: 'Error: network interruption' },
    ],
  })
  assert.deepEqual(deliveredSegments, ['第一段', '第二段'])
})

test('private visible messages are confirmed only after transport, while failed drafts stay system-owned', async () => {
  const entries: any[] = []
  const characterUpdates: string[] = []
  const service = deliveryHost({
    serial: async (_storyId: string, task: () => Promise<void>) => task(),
    getParticipant: async (id: string) => ({ id }),
    appendEntry: async (_storyId: string, entry: any) => { entries.push(entry) },
    recordCharacterMessage: async (participant: { id: string }) => { characterUpdates.push(participant.id) },
    recordAutomaticDelivery: async () => undefined,
    typingDelayMilliseconds: () => 100,
    appendIntent: async () => undefined,
    scheduleDueIntentWake: () => undefined,
    endpointAddressSync: (legacy: unknown) => legacy,
    noteEndpointOutbound: () => {},
    config: { runtime: { maxMessageCharacters: 1_000 } },
  })
  const confirm = (InterludeService.prototype as any).confirmOutgoingDeliveries
  const recordFailure = (InterludeService.prototype as any).recordOutgoingDeliveryFailure
  await confirm.call(service, transportStory, [{ participantId: 'user', content: '已经送达', interaction: { seen: true, reply: { mode: 'immediate', content: '已经送达' } } }])
  await recordFailure.call(service, transportStory, 'user', { participantId: 'user', content: '未送达' }, 'transport-error')

  assert.equal(entries[0].kind, 'character-message')
  assert.equal(entries[0].actor, 'character')
  assert.equal(entries[0].content, '已经送达')
  assert.equal(entries[1].kind, 'outgoing-delivery-failed')
  assert.equal(entries[1].actor, 'system')
  assert.match(entries[1].content, /未送达/)
  assert.deepEqual(characterUpdates, ['user'])
})
