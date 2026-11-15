import assert from 'node:assert/strict'
import test from 'node:test'
import { compileNarrativeContext, compiledContextConflicts } from '../src/script/context-compiler'

test('context compiler creates one eight-part scaffold without recomputing shared facts', () => {
  const payload = {
    setting: { character: { name: '水濑' } }, state: {}, currentParticipant: null, participants: [],
    recentScript: [{ id: 1, content: '她还坐在窗边。' }], sceneContext: { scene: null }, continuitySnapshot: null,
    durableFacts: [], memories: [], overlayEvolution: [], currentEvent: { type: 'private-message-batch', content: '在吗' },
    interval: { from: 'a', now: 'b' }, timelinePlan: undefined, activeConsequences: [], dueIntents: [], upcomingPlans: [],
    phase: 'user-message', refreshContinuity: false, outputRecovery: false,
  }
  const compiled = compileNarrativeContext(payload, undefined, undefined)
  assert.deepEqual(Object.keys(compiled), [
    'storyIdentity', 'relevantEstablishedEpisodes', 'currentSceneEvidence', 'ongoingThreads',
    'availableNearFuture', 'writingReference', 'incomingEvent', 'authoringWindow',
  ])
  assert.deepEqual(compiledContextConflicts(payload, compiled), [])
  assert.strictEqual(compiled.relevantEstablishedEpisodes.recentScript, payload.recentScript)
  assert.strictEqual(compiled.incomingEvent.event, payload.currentEvent)
})

test('scene evidence already visible in recentScript is not injected twice', () => {
  const payload = {
    setting: {}, state: {}, recentScript: [{ id: 7, content: '她仍在书桌前。' }],
    currentEvent: {}, interval: {},
  }
  const compiled = compileNarrativeContext(payload, {
    id: 'frame', presentPeople: [], openMotions: [], openTopics: [],
    sourceEntryIds: [7], sources: { place: [7] }, place: '书桌前', updatedAt: 'now',
  }, undefined)
  assert.equal(compiled.currentSceneEvidence.place, undefined)
  assert.equal(compiled.currentSceneEvidence.sceneId, undefined)
  assert.equal(compiled.relevantEstablishedEpisodes.recentScript[0].content, '她仍在书桌前。')
})

test('availableOutgoingEndpoints rides ongoingThreads and is dropped when absent', () => {
  const options = [{ endpointId: 'ep-1', targetId: 'p1', targetKind: 'participant', channelKind: 'wechat', conversationKind: 'private', online: true }]
  const compiled = compileNarrativeContext({ availableOutgoingEndpoints: options }, undefined, undefined)
  assert.strictEqual(compiled.ongoingThreads.availableOutgoingEndpoints, options)
  const single = compileNarrativeContext({}, undefined, undefined)
  assert.equal('availableOutgoingEndpoints' in single.ongoingThreads, false)
})
