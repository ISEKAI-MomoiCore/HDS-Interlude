import assert from 'node:assert/strict'
import test from 'node:test'
import { factEvidenceForPrompt, factSourceGroupIds } from '../src/script/knowledge-evidence'
import { systemPrompt, toPromptPayload } from '../src/narrator'
import { InterludeService } from '../src/service'
import { emptyStorySetting, emptyStoryState } from '../src/types'
import type { InterludeStory, NarrativeFact, NarrativeRequest, ScriptEntry } from '../src/types'

/**
 * Issue #21 方向 c 回归：fact 携带群来源出处，叙事区分「听说」与「亲历」。
 *  A. factSourceGroupIds 归一化历史前缀/数字群 ID，只认来源内的群条目；
 *  B. persistFact 新建/合并写入 sourceGroupIds，私聊确认不擦除群出处；
 *  C. factEvidenceForPrompt / toPromptPayload 投影携带出处，legacy 行无字段不输出；
 *  D. full 与 lite 两档 systemPrompt 均含 FACT PROVENANCE 合约。
 *  事实仍是全局叙事材料：出处只影响叙事口吻，不控制可见性。
 */

const now = new Date('2026-11-07T09:00:00.000Z')

const entry = (id: number, kind: string, metadata: Record<string, unknown> = {}, content = '群里的话'): ScriptEntry => ({
  id, storyId: 'story', kind, content, participantId: '', actor: kind.startsWith('character') ? 'character' : 'user',
  occurredAt: now, createdAt: now, metadata,
}) as ScriptEntry

const fact = (id: number, content: string, sourceEntryIds: number[], sourceGroupIds?: string[]): NarrativeFact => ({
  id, storyId: 'story', participantId: '', scope: 'event', content, sourceEntryIds,
  importance: 0.5, confidence: 0.6, unresolved: false, status: 'active', lastSeenAt: now, createdAt: now, updatedAt: now,
  ...(sourceGroupIds ? { sourceGroupIds } : {}),
})

function story(): InterludeStory {
  return { id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
    setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now }
}

test('A1: factSourceGroupIds 归一化历史前缀与数字群 ID 并去重', () => {
  const entries = [
    entry(1, 'group-message', { groupId: 'group:12345', senderId: 'alan' }),
    entry(2, 'group-message', { groupId: 'guild:12345' }),
    entry(3, 'character-group-message', { groupId: 12345 }),
    entry(4, 'group-message', { groupId: '12345' }),
    entry(5, 'group-message', { groupId: '  group:12345  ' }),
  ]
  assert.deepEqual(factSourceGroupIds(entries, [1, 2, 3, 4, 5]), ['12345'])
})

test('A2: factSourceGroupIds 只认来源内的群条目，缺群号不计出处', () => {
  const entries = [
    entry(1, 'user-message', { groupId: '12345' }),
    entry(2, 'script', { groupId: '12345' }),
    entry(3, 'group-message', {}),
    entry(4, 'group-message', { groupId: '' }),
    entry(5, 'group-message', { groupId: 'group:999' }),
    entry(6, 'character-group-message', { groupId: '888', offlineCatchup: true }),
  ]
  assert.deepEqual(factSourceGroupIds(entries, [1, 2, 3, 4, 6]), ['888'])
  assert.deepEqual(factSourceGroupIds(entries, [5]), ['999'])
  assert.deepEqual(factSourceGroupIds(entries, []), [])
})

test('B1: persistFact 新建：群来源 fact 携带归一化群出处，participantId 仍为全局空值', async () => {
  let created: any
  const host: any = { memoryConfig: { factContentCharacters: 4000, maxFactsPerStory: 200 },
    dbGet: async () => [], dbCreate: async (_t: any, value: any) => { created = value }, embedText: async () => [] }
  const source = entry(1, 'group-message', { groupId: 'group:12345', senderId: 'alan' }, '阿蓝最近睡眠不好')
  await (InterludeService.prototype as any).persistFact.call(host, 'story', {
    scope: 'event', content: '阿蓝最近睡眠不好', sourceEntryIds: [1],
  }, [source], now)
  assert.deepEqual(created.sourceGroupIds, ['12345'])
  assert.equal(created.participantId, '')
})

test('B2: persistFact 新建：仅私聊/script 来源不写 sourceGroupIds 键', async () => {
  let created: any
  const host: any = { memoryConfig: { factContentCharacters: 4000, maxFactsPerStory: 200 },
    dbGet: async () => [], dbCreate: async (_t: any, value: any) => { created = value }, embedText: async () => [] }
  const sources = [entry(1, 'user-message', {}, '阿蓝最近睡眠不好'), entry(2, 'script', {}, '她记下了这件事')]
  await (InterludeService.prototype as any).persistFact.call(host, 'story', {
    scope: 'event', content: '阿蓝最近睡眠不好', sourceEntryIds: [1, 2],
  }, sources, now)
  assert.equal('sourceGroupIds' in created, false)
})

test('B3: persistFact 新建：角色群消息与离线补拉条目同样计出处', async () => {
  let created: any
  const host: any = { memoryConfig: { factContentCharacters: 4000, maxFactsPerStory: 200 },
    dbGet: async () => [], dbCreate: async (_t: any, value: any) => { created = value }, embedText: async () => [] }
  const sources = [entry(1, 'character-group-message', { groupId: 'guild:777' }, '她在群里说的话'),
    entry(2, 'group-message', { groupId: 777, offlineCatchup: true }, '补拉的群消息')]
  await (InterludeService.prototype as any).persistFact.call(host, 'story', {
    scope: 'event', content: '阿蓝最近睡眠不好', sourceEntryIds: [1, 2],
  }, sources, now)
  assert.deepEqual(created.sourceGroupIds, ['777'])
})

test('B4: persistFact 合并：群出处取并集，legacy 行补字段，私聊确认不擦除', async () => {
  const merge = async (existing: NarrativeFact, entries: ScriptEntry[], sourceEntryIds: number[]) => {
    let patch: any
    const host: any = { memoryConfig: { factContentCharacters: 4000, maxFactsPerStory: 200 },
      dbGet: async () => [existing], dbSet: async (_t: any, _q: any, value: any) => { patch = value }, embedText: async () => [] }
    await (InterludeService.prototype as any).persistFact.call(host, 'story', {
      scope: 'event', content: existing.content, sourceEntryIds,
    }, entries, now)
    return patch
  }
  const existing = fact(12, '阿蓝最近睡眠不好', [1], ['111'])
  const legacy = fact(12, '阿蓝最近睡眠不好', [1])
  const groupSource = entry(2, 'group-message', { groupId: '222', senderId: 'alan' })
  const privateSource = entry(3, 'user-message', {}, '私聊里确认了这件事')
  assert.deepEqual((await merge(existing, [groupSource], [2])).sourceGroupIds, ['111', '222'])
  assert.deepEqual((await merge(legacy, [groupSource], [2])).sourceGroupIds, ['222'])
  assert.deepEqual((await merge(existing, [privateSource], [3])).sourceGroupIds, ['111'])
  assert.equal('sourceGroupIds' in (await merge(legacy, [privateSource], [3])), false)
})

test('C1: factEvidenceForPrompt：legacy 无字段不输出，非字符串垃圾过滤', () => {
  const legacy = fact(1, '旧事实', [1])
  assert.equal('sourceGroupIds' in factEvidenceForPrompt(legacy), false)
  const modern = fact(2, '新事实', [2], ['12345'])
  assert.deepEqual(factEvidenceForPrompt(modern).sourceGroupIds, ['12345'])
  const dirty = fact(3, '脏数据', [3])
  ;(dirty as any).sourceGroupIds = ['12345', 42, '', null]
  assert.deepEqual(factEvidenceForPrompt(dirty).sourceGroupIds, ['12345'])
  ;(dirty as any).sourceGroupIds = 'not-an-array'
  assert.equal('sourceGroupIds' in factEvidenceForPrompt(dirty), false)
})

test('C2: toPromptPayload：durableFacts 携带群出处，legacy fact 不带键', () => {
  const request: NarrativeRequest = {
    phase: 'user-message', story: story(), from: now, now, userMessage: '你好', participant: null,
    participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [],
    recentEntries: [], memories: [], facts: [fact(202, '阿蓝最近睡眠不好', [1], ['12345']), fact(203, '旧的全局知识', [2])],
  }
  const payload = toPromptPayload(request) as any
  const durableFacts = payload.relevantEstablishedEpisodes.durableFacts
  assert.deepEqual(durableFacts[0].sourceGroupIds, ['12345'])
  assert.equal('sourceGroupIds' in durableFacts[1], false)
})

test('D1: systemPrompt：full 与 lite 两档均含 FACT PROVENANCE 合约', () => {
  const full = systemPrompt('user-message', '', '', '', '', '')
  assert.match(full, /FACT PROVENANCE/)
  assert.match(full, /sourceGroupIds/)
  const lite = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'lite', family: 'gemini-flash', source: 'auto', probe: 'gemini-3.7-flash' })
  assert.match(lite, /FACT PROVENANCE/)
  assert.match(lite, /sourceGroupIds/)
})
