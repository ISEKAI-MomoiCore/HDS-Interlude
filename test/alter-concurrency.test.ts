import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { InterludeService } from '../src/service'
import { advanceAlterSystem, alterScopeValue, createAlterSystemState, DEFAULT_ALTER_SYSTEM_CONFIG } from '../src/alter'
import { emptyStorySetting, emptyStoryState } from '../src/types'
import { decodeStoryState } from '../src/story-state'

const config = { ...DEFAULT_ALTER_SYSTEM_CONFIG, enabled: true, densityFactor: 0 }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
function fixture() {
  const service: any = Object.create(InterludeService.prototype)
  Object.defineProperty(service, 'alterSystemConfig', { value: config })
  Object.assign(service, {
    queues: new Map(), serialScope: new AsyncLocalStorage(), runtimeGeneration: 0,
    storyTaskGenerations: new Map(), desktopRuntimePhase: 'running', databaseResetting: false,
    recentEntries: async () => [], report: () => {}, reportOperation: () => {},
    scheduler: { cancelWakes() {} }, turnEngine: { turns: new Map() },
    bufferedGroupTurns: new Map(), desktopRuntimeSnapshot: async () => ({}),
  })
  const now = new Date()
  let alter = createAlterSystemState(now)
  for (let i = 0; i < 2; i++) alter = advanceAlterSystem(alter, 5, 'user-message', now, config, 'alice').state
  alter = advanceAlterSystem(alter, 4, 'user-message', now, config, 'bob').state
  let story: any = { id: 'story', status: 'active', setting: emptyStorySetting(), state: { ...emptyStoryState(), alterSystem: alter } }
  let writes = 0
  service.getStory = async () => ({ ...structuredClone(story), state: decodeStoryState(story.state) })
  service.dbSet = async (_table: string, _filter: unknown, update: any) => { story = { ...story, ...update }; writes++ }
  const started = deferred<any>()
  const response = deferred<any>()
  service.narrator = { analyzeAlter: async (request: any) => { started.resolve(request); return response.promise } }
  return {
    service, started, response, state: () => decodeStoryState(story.state), writes: () => writes,
    async add(scores: number[]) {
      await service.serial('story', async () => {
        const fresh = await service.getStory('story')
        let state = fresh.state.alterSystem
        for (const score of scores) state = advanceAlterSystem(state, score, 'user-message', new Date(), config, 'alice').state
        fresh.state.alterSystem = state
        fresh.state.settingOverlay.world = 'Concurrent world update'
        await service.dbSet('interlude_story', { id: 'story' }, { state: fresh.state })
      })
    },
  }
}

test('Alter consumes only the analyzed snapshot and preserves concurrent scores and world changes', async () => {
  const f = fixture()
  const task = f.service.analyzeAlterSystem('story', 'user-message', 'alice')
  const request = await f.started.promise
  assert.equal(request.triggerValue, 10)
  await f.add([5]) // Must complete while the model response is still pending.
  f.response.resolve({ description: '她在这段关系中变得更谨慎。' })
  await task
  const state = f.state()
  assert.equal(alterScopeValue(state.alterSystem!, 'alice'), 5)
  assert.equal(alterScopeValue(state.alterSystem!, 'bob'), 4)
  assert.equal(state.alterSystem!.alterValue, 9)
  assert.equal(state.alterSystem!.emotionalOffset!.intensity, 1)
  assert.equal(state.alterSystem!.emotionalOffset!.direction, 'serious')
  assert.equal(state.settingOverlay.world, 'Concurrent world update')
})

for (const [label, scores, remaining] of [
  ['reversed', [-5, -5, -5], -5], ['below threshold', [-5], 5],
] as const) {
  test('Alter discards stale analysis when accumulated scores are ' + label, async () => {
    const f = fixture()
    const task = f.service.analyzeAlterSystem('story', 'user-message', 'alice')
    await f.started.promise
    await f.add([...scores])
    f.response.resolve({ description: 'A serious snapshot description' })
    await task
    const state = f.state().alterSystem!
    assert.equal(alterScopeValue(state, 'alice'), remaining)
    assert.equal(alterScopeValue(state, 'bob'), 4)
    assert.equal(state.emotionalOffset, null)
    assert.equal(state.pendingScopes!.find(s => s.participantId === 'alice')!.lastAnalysisAttemptAt, undefined)
  })
}

for (const invalidation of ['pause', 'generation'] as const) {
  test('Alter does not commit in-flight results after ' + invalidation, async () => {
    const f = fixture()
    const task = f.service.analyzeAlterSystem('story', 'user-message', 'alice')
    await f.started.promise
    if (invalidation === 'pause') await f.service.setDesktopRuntimePhase('paused')
    else f.service.storyTaskGenerations.set('story', 1)
    const before = f.writes()
    f.response.resolve({ description: 'Discard this old response' })
    await task
    assert.equal(f.writes(), before)
    assert.equal(f.state().alterSystem!.emotionalOffset, null)
    assert.equal(alterScopeValue(f.state().alterSystem!, 'alice'), 10)
  })
}
