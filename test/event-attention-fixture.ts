import { createHash } from 'node:crypto'
import type { NarrativeRequest, ScriptEntry } from '../src/types'
import { emptyStoryState } from '../src/types'

export const now = new Date('2026-11-25T04:00:00.000Z')
export const from = new Date('2026-11-25T03:56:00.000Z')
const entry = (id: number, kind: string, content: string, metadata: ScriptEntry['metadata'] = {}): ScriptEntry => ({
  id, kind, content, metadata, actor: 'system', storyId: 's', participantId: '', occurredAt: from, createdAt: from,
})

export function attentionFixture(variant: 'private' | 'group' | 'advance'): NarrativeRequest {
  return {
    phase: variant === 'advance' ? 'advance' : 'user-message', from, now,
    story: { id: 's', status: 'active', setting: { timezone: 'Asia/Shanghai' }, state: {
      ...emptyStoryState(), lifeRhythm: { attention: 'busy-work', assessedAt: from.toISOString(), basis: '写报告', source: 'narrator' },
    } },
    participant: null, participants: [], dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [],
    recentEntries: [
      entry(1, 'script', '她在家写报告。'),
      entry(2, 'world-event', '[世界事件] 环境：22°C 大雨。', { eventSource: 'weather', weatherCode: 65, weatherChanged: true }),
      entry(3, 'world-event', '[世界事件] 她预约的维修人员临时改了上门时间。', { eventSource: 'world-seeder', importance: 'high', involvement: 'involved' }),
      entry(4, 'friend-feed', '一位好友发了说说。'),
      entry(5, 'world-event', '旧来源不明。', { seededEventId: 123, importance: 'high' }),
      entry(6, 'group-message', '历史群聊，不是新到达的消息。'),
    ],
    ...(variant !== 'advance' ? { userMessage: '今晚有空吗？', audio: [{}], images: [{}] } : {}),
    ...(variant === 'private' ? { quotedMessages: [{ index: 1, content: '上次的消息' }], agencyWindow: { deviceAccess: 'unavailable' } } : {}),
    ...(variant === 'group' ? {
      groupContext: { groupId: 'g', messages: [{ speaker: '朋友', senderId: 'u', content: '今晚有空吗？', occurredAt: now, messageRef: 1 }] },
      chatCapabilities: { quoteReply: true, reactions: [], nativeFaces: [] },
      historicalGroupImages: [{ id: 'image', sourceEntryId: 6, senderId: 'u', occurredAt: from }],
    } : {}),
    ...(variant === 'advance' ? { groupBackground: [
      { groupId: 'g1', label: '一群', summary: '两条消息', entries: [{ id: 6, speaker: '一号', content: '原文', occurredAt: from.toISOString() }] },
      { groupId: 'g2', label: '二群', summary: '三条消息', entries: [] },
    ] } : {}),
    recalledHistory: [{ id: 55, occurredAt: from.toISOString(), content: '历史原文的摘录', sourceEntryIds: [55] }],
  } as unknown as NarrativeRequest
}

export function attentionBaselineDigest(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload, (key, value) =>
    ['eventAttention', 'groupBackgroundAttention', 'eventAttentionGuide'].includes(key) ? undefined : value,
  )).digest('hex')
}
