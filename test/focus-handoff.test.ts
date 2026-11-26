import assert from 'node:assert/strict'
import test from 'node:test'
import { Config } from '../src/index'
import { InterludeService } from '../src/service'
import { FOCUS_ATTENTIONS, legacyRhythmAttention } from '../src/life-rhythm'
import { decodeStoryState } from '../src/story-state'
import { consumeWillingnessGate, rhythmTierBucket } from '../src/group-willingness'
import { compactionPrompt, systemPrompt } from '../src/narrator'
import { planUrge, resolveUrgeConfig } from '../src/urge'
import { emptyStorySetting, emptyStoryState, type NarrativeDecision } from '../src/types'

const now = new Date('2026-11-25T07:43:00Z')
const cursor = new Date(now.getTime() - 60_000)
const quote = '她放下手机，闭着眼清醒地歇了一会儿。'
const script = `她打开私聊看了眼。${quote}`
const focus = { attention: 'rest-conscious', quote } as const

function fixture() {
  const entries: any[] = []
  const agencyWindow = {
    activityLoad: 'free', privacy: 'private', deviceAccess: 'unavailable',
    updatedAt: cursor.toISOString(), validUntil: new Date(now.getTime() + 600_000).toISOString(),
    basis: '手机在另一个房间', sourceEntryIds: [1],
  }
  const story: any = { id: 's', setting: emptyStorySetting(), cursorAt: cursor, state: {
    ...emptyStoryState(), agencyWindow,
    lifeRhythm: { attention: 'phone-focused', basis: '旧剧本', assessedAt: cursor.toISOString(), source: 'narrator' },
  } }
  const participant = { id: 'alice', storyId: story.id, state: {}, updatedAt: now }
  const host: any = Object.assign(Object.create(InterludeService.prototype), {
    config: { runtime: Config.dict.runtime({}), sharedStory: {}, onebot: { groupChats: [] }, agency: {} },
    participants: async () => [participant], canHandleParticipant: () => true, shouldRefreshContinuity: () => false,
    activeScene: async () => null, pruneWorkingDetails: (value: any) => value ?? [],
    appendEntry: async (_storyId: string, draft: any) => {
      const entry = { ...draft, id: entries.length + 1, storyId: story.id, occurredAt: new Date(draft.occurredAt), createdAt: now }
      entries.push(entry)
      return entry
    },
    applyIntentUpdates: async () => 0, updateAlterSystem: () => undefined,
    dbGet: async (_table: string, query: any) => query?.kind === 'script' ? entries.filter((entry: any) => entry.kind === 'script') : [], dbSet: async (table: string, _q: unknown, patch: any) => {
      if (table === 'interlude_story') Object.assign(story, patch)
    },
    longHorizonSweep: async () => {}, appendIntent: async () => {}, scheduleDueIntentWake: () => {},
    reportOperation: () => {}, reportStandalone: () => {},
  })
  return { host, story, participant, entries, agency: decodeStoryState(story.state).agencyWindow }
}

for (const turn of ['private', 'group', 'advance'] as const) {
  test(`committed ${turn} focus is independent of Urge and device access`, async () => {
    const { host, story, participant, entries, agency } = fixture()
    assert.equal(host.urgeConfig.enabled, false)
    const decision: NarrativeDecision = { script, lifeHandoff: { focus } }
    await host.persistDecision(story, turn === 'private' ? participant : null, decision, cursor, now, false, turn === 'advance' ? 'advance' : 'user-message', [])
    assert.deepEqual(entries[0].metadata.lifeHandoff.focus, focus)
    assert.deepEqual(story.state.lifeRhythm, { attention: focus.attention, basis: quote, assessedAt: now.toISOString(), source: 'narrator', sourceEntryId: entries[0].id })
    assert.equal(agency?.deviceAccess, 'unavailable')
    assert.deepEqual(story.state.agencyWindow, agency)
  })
}

test('only a grounded new script can reaffirm the same focus', async () => {
  const { host, story } = fixture()
  const decision: NarrativeDecision = { script, lifeHandoff: { focus } }
  await host.persistDecision(story, null, decision, cursor, now, false, 'advance', [])
  const later = new Date(now.getTime() + 60_000)
  for (const draft of [
    { script, lifeHandoff: { focus: { ...focus, quote: '无关引文' } } },
    { script, lifeHandoff: { focus: { ...focus, attention: 'resting' } } },
    { lifeHandoff: { focus } },
  ]) {
    await host.persistDecision(story, null, draft, now, later, false, 'advance', [])
    assert.equal(story.state.lifeRhythm.assessedAt, now.toISOString())
  }
  await host.persistDecision(story, null, decision, now, later, false, 'advance', [])
  assert.equal(story.state.lifeRhythm.assessedAt, later.toISOString())
  assert.ok(story.state.lifeRhythm.sourceEntryId > 1)
})

test('all new focus states keep existing Urge and group willingness behavior through the common mapping', () => {
  const timestamp = now.getTime()
  const urge = { version: 1 as const, buckets: [] }
  const config = resolveUrgeConfig({ enabled: true })
  for (const attention of FOCUS_ATTENTIONS) {
    const legacy = legacyRhythmAttention(attention)!
    const assessedAt = now.toISOString()
    assert.equal(decodeStoryState({ lifeRhythm: { attention, assessedAt, source: 'narrator', sourceEntryId: 5 } }).lifeRhythm?.attention, attention)
    const newPlan = planUrge(urge, timestamp, config, 0, false, () => 0, { attention })
    const oldPlan = planUrge(urge, timestamp, config, 0, false, () => 0, { attention: legacy })
    assert.equal(newPlan.minutes, oldPlan.minutes)
    assert.equal(newPlan.reason, `rhythm:${attention}`)
    assert.equal(rhythmTierBucket(attention), rhythmTierBucket(legacy))
    const consume = (value: string) => consumeWillingnessGate(undefined, 'auto', undefined, { attention: value, assessedAt }, undefined, timestamp, value, () => 0.5)
    assert.equal(consume(attention).skipCount, consume(legacy).skipCount)
  }
})

test('full and lite model contracts share the focus choices and request script evidence', () => {
  const main = (tier: 'full' | 'lite') => systemPrompt('user-message', undefined, undefined, '', '', '',
    false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier, family: 'generic', source: 'auto', probe: '' })
  for (const tier of ['full', 'lite'] as const) {
    assert.match(main(tier), /inside lifeHandoff/)
    assert.ok(main(tier).includes(FOCUS_ATTENTIONS.join('|')))
    const compactor = compactionPrompt('', '', '', '', { tier })
    assert.ok(compactor.includes(FOCUS_ATTENTIONS.join('|')))
    assert.match(compactor, /latest committed protagonist script/)
  }
})
