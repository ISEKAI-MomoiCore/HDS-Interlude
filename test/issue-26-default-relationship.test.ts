import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'

const now = new Date('2026-11-16T12:00:00.000Z')
const story = { id: 'story-1', setting: { defaultRelationship: '故事级默认关系' } } as any
const session = { platform: 'onebot', selfId: 'bot-1', userId: 'user-1', channelId: 'private:user-1', username: '访客', isDirect: true } as any

function host(overrides: Record<string, unknown> = {}) {
  const created: any[] = []
  const updates: any[] = []
  const service: any = Object.assign(Object.create(InterludeService.prototype), {
    config: { storyDefaults: { userProfile: '全局背景', relationship: '全局默认关系' }, onebot: { userAccounts: [] }, sharedStory: { participantPresets: [] } },
    userAccountRule: () => undefined,
    participantPreset: () => undefined,
    findParticipant: async () => undefined,
    getParticipant: async () => undefined,
    dbCreate: async (_table: string, value: unknown) => { created.push(value) },
    dbSet: async (_table: string, query: unknown, patch: unknown) => { updates.push({ query, patch }) },
    registerParticipantUserEndpointRow: async () => {},
    appendEntry: async () => {},
    dbGet: async () => [],
  })
  Object.assign(service, overrides)
  return { service, created, updates }
}

test('Issue #26: new participants use story default before global fallback', async () => {
  const { service, created } = host()
  await service.ensureParticipant(story, session, now)
  assert.equal(created[0].relationship, '故事级默认关系')

  const noStoryOverride = { ...story, setting: { defaultRelationship: '' } }
  const fallback = host()
  await fallback.service.ensureParticipant(noStoryOverride, session, now)
  assert.equal(fallback.created[0].relationship, '全局默认关系')
})

test('Issue #26: account and preset relationships outrank story default; existing relationship remains stable', async () => {
  const account = host({ userAccountRule: () => ({ relationship: '账号关系' }), participantPreset: () => ({ relationship: '预设关系' }) })
  await account.service.ensureParticipant(story, session, now)
  assert.equal(account.created[0].relationship, '账号关系')

  const preset = host({ participantPreset: () => ({ relationship: '预设关系' }) })
  await preset.service.ensureParticipant(story, session, now)
  assert.equal(preset.created[0].relationship, '预设关系')

  const existingParticipant = { id: 'p1', storyId: story.id, channelId: session.channelId, personId: session.userId, displayName: '访客', profile: '资料', relationship: '已形成的关系', updatedAt: now }
  const existing = host()
  const result = await existing.service.ensureParticipant(story, session, now, existingParticipant)
  assert.equal(result.relationship, '已形成的关系')
})

test('Issue #26: reset rebuilds relationship baseline from story setting', async () => {
  const participant = { id: 'p1', userId: 'user-1', personId: 'user-1', displayName: '访客' }
  const { service, updates } = host({ dbGet: async () => [participant] })
  await service.resetParticipantCanon(story.id, now, story.setting)
  assert.equal(updates[0].patch.relationship, '故事级默认关系')
  assert.deepEqual(updates[0].patch.state.openThreads, [])
})
test('Issue #26: full reset preserves the story-level default and reapplies it to participants', async () => {
  const participant = { id: 'p1', userId: 'user-1', personId: 'user-1', displayName: '访客' }
  const writes: Array<{ table: string, patch: any }> = []
  const { service } = host({
    invalidateBufferedNarratives: () => {}, invalidateStoryTasks: () => {}, invalidateHistoryVectors: () => {},
    purgeTable: async () => {},
    activeLongArcGuidanceCache: new Map(), longHorizonLastScore: new Map(),
    longHorizonGuidanceLoaded: new Map(), longHorizonGenerationCooldownUntil: new Map(),
    getStory: async () => ({ ...story, setting: { defaultRelationship: '保存的故事级关系' } }),
    initialStorySetting: () => ({ defaultRelationship: '全局默认关系' }),
    dbGet: async (table: string) => table === 'interlude_participant' ? [participant] : [],
    dbSet: async (table: string, _query: unknown, patch: any) => { writes.push({ table, patch }) },
    ensureContinuity: async () => {},
  })

  await service.purgeAllStoryDataUnlocked(story.id)
  const storyWrite = writes.find(write => write.table === 'interlude_story')
  const participantWrite = writes.find(write => write.table === 'interlude_participant')
  assert.equal(storyWrite.patch.setting.defaultRelationship, '保存的故事级关系')
  assert.equal(participantWrite.patch.relationship, '保存的故事级关系')
})
