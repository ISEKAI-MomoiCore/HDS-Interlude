import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { OpenAICompatibleNarrator } from '../src/narrator'
import { decodeStoryState, encodeStoryState } from '../src/story-state'
import { emptyStorySetting, emptyStoryState } from '../src/types'

function fixture() {
  const now = new Date()
  const story = { id: 's', setting: emptyStorySetting(), state: emptyStoryState() } as any
  const service = Object.create(InterludeService.prototype) as any
  const logs: any[][] = []
  const writes: any[] = []
  Object.assign(service, {
    config: {}, timelineBackoff: new Map(), timelineDirectorFailures: new Map(),
    compactor: { planTimeline: async () => ({ beats: [{ at: 0, kind: 'state', summary: '仍在休息' }] }) },
    activeScene: async () => null, recentEntriesForPrompt: async () => [],
    dbSet: async (_table: string, _query: unknown, value: any) => writes.push(value),
    reportOperation: (...args: any[]) => logs.push(args),
  })
  for (const [key, value] of Object.entries({ memoryConfig: { enabled: false }, schedulePreplanConfig: { enabled: false }, sharedStoryConfig: { shareParticipantDetails: false } })) {
    Object.defineProperty(service, key, { value })
  }
  const run = (from = new Date(now.getTime() - 60000)) => service.planAutomaticTimeline(story, null, 'advance', from, new Date(), [])
  return { service, story, run, logs, writes }
}

test('director transport failure counts once, retains cause and does not reschedule life', async () => {
  const { service, story, run, logs } = fixture()
  const next = new Date(Date.now() + 5000).toISOString()
  story.state.automation.nextAdvanceAt = next
  let calls = 0
  service.compactor.planTimeline = async () => { calls++; throw new Error('request timeout') }
  assert.equal(await run(), undefined)
  assert.equal(service.timelineDirectorFailures.get('s'), 1)
  assert.equal(story.state.automation.nextAdvanceAt, next)
  assert.equal(logs.filter(row => row[1] === 'warn').length, 1)
  assert.match(String(logs.flat()), /request timeout/)
  assert.doesNotMatch(String(logs.flat()), /返回被拒绝/)
  await run(new Date()) // successful life advancement must not reset health
  assert.equal(calls, 1)
  service.timelineBackoff.clear()
  service.timelineDirectorFailures.clear() // simulate reload
  story.state = decodeStoryState(encodeStoryState(story.state))
  await run(new Date())
  assert.equal(calls, 1)
  assert.equal(service.timelineDirectorFailures.get('s'), 1)
})

test('expired persistent fuse permits recovery and clears durable failure state', async () => {
  const { service, story, run, writes } = fixture()
  story.state.automation = { timelineRetryAt: new Date(Date.now() - 1000).toISOString(), timelineDirectorFailures: 6 }
  assert.ok(await run())
  assert.equal(service.timelineDirectorFailures.size, 0)
  assert.equal(service.timelineBackoff.size, 0)
  assert.equal(writes.at(-1).state.automation.timelineRetryAt, undefined)
  assert.equal(writes.at(-1).state.automation.timelineDirectorFailures, undefined)
})

test('invalid ledger remains a validation failure rather than transport failure', async () => {
  const { service, run, logs } = fixture()
  service.compactor.planTimeline = async () => ({ beats: [] })
  assert.equal(await run(), undefined)
  assert.equal(service.timelineDirectorFailures.get('s'), 1)
  assert.match(String(logs.flat()), /返回被拒绝/)
  assert.match(String(logs.flat()), /beats 为空数组/)
})

test('legacy director health accepts missing and malformed counts without migration', () => {
  for (const value of [undefined, {}, null, 'bad', -1]) {
    assert.equal(decodeStoryState({ automation: { timelineDirectorFailures: value } }).automation?.timelineDirectorFailures, 0)
  }
})

test('real narrator preserves network timeout instead of returning an empty plan', async () => {
  const error = new Error('request timeout')
  const narrator = new OpenAICompatibleNarrator({ http: { post: async () => { throw error } } } as any, {
    providers: [{ enabled: true, label: 'test', endpoint: 'https://example.test/chat', model: 'm', timeout: 1000, temperature: 0.3, useForCompaction: true }],
  } as any, true)
  const now = new Date()
  await assert.rejects(narrator.planTimeline({ story: { setting: emptyStorySetting() }, from: now, now, phase: 'advance', facts: [], recentEntries: [], dueIntents: [] } as any), e => e === error)
})

test('malformed director JSON is identified separately from a request failure', async () => {
  const narrator = new OpenAICompatibleNarrator({ http: { post: async () => ({ choices: [{ message: { content: 'not-json' } }] }) } } as any, {
    providers: [{ enabled: true, label: 'test', endpoint: 'https://example.test/chat', model: 'm', timeout: 1000, temperature: 0.3, useForCompaction: true }],
  } as any, true)
  const now = new Date()
  await assert.rejects(narrator.planTimeline({ story: { setting: emptyStorySetting() }, from: now, now, phase: 'advance', facts: [], recentEntries: [], dueIntents: [] } as any), /时间导演 JSON 解析失败/)
})

test('failed health persistence keeps the in-memory cooldown effective', async () => {
  const { service, run } = fixture()
  let calls = 0
  service.dbSet = async () => { throw new Error('storage unavailable') }
  service.compactor.planTimeline = async () => { calls++; throw new Error('request timeout') }
  await run()
  await run(new Date())
  assert.equal(calls, 1)
})
