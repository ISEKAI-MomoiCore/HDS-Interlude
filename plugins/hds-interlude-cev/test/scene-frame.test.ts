import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceSceneFrame, projectSceneFrame, resolveDialogueBurst, sceneFrameProvenanceErrors } from '../src/script/scene-frame'
import { decisionToScriptCommit as legacyDecisionToScriptCommit } from '../src/script/commit-builder'
import { emptyStoryState, InterludeScene, ScriptEntry } from '../src/types'

const now = new Date('2026-09-04T08:00:00.000Z')
const scene: InterludeScene = {
  id: 12, storyId: 'story', status: 'active', startedAt: new Date('2026-09-04T07:00:00.000Z'), endedAt: null,
  hook: '她还坐在窗边整理录音。', summary: '窗边的录音整理仍在继续。', entryCount: 4, lastEntryId: 40,
  createdAt: now, updatedAt: now,
}

function script(id: number, content: string): ScriptEntry {
  return { id, storyId: 'story', participantId: '', kind: 'script', actor: 'narrator', content, occurredAt: now, metadata: {}, createdAt: now }
}

test('SceneFrame projects only sourced values and keeps one id across message densities', () => {
  const state = {
    ...emptyStoryState(), activeSceneId: 12,
    scenePresence: [{ name: '希绘', status: 'present' as const, basis: '一起坐下', sourceEntryIds: [31], updatedAt: now.toISOString() }],
    workingDetails: [{ label: '录音', value: '还剩最后两段', createdAt: now.toISOString(), sourceEntryIds: [35] }],
    agencyWindow: { activityLoad: 'occupied' as const, privacy: 'shared' as const, deviceAccess: 'limited' as const, validUntil: '2026-09-04T09:00:00.000Z', basis: '正在整理', sourceEntryIds: [36], updatedAt: now.toISOString() },
  }
  const project = (count: number) => projectSceneFrame({
    storyId: 'story', now, scene, state,
    recentEntries: [script(31, '希绘一起坐下。'), script(35, '录音还剩两段。'), ...Array.from({ length: count }, (_, index) => script(41 + index, `她继续整理第 ${index + 1} 段录音。`))],
  })
  const one = project(1)
  const five = project(5)
  const ten = project(10)
  assert.equal(one.id, five.id)
  assert.equal(five.id, ten.id)
  assert.deepEqual(sceneFrameProvenanceErrors(ten), [])
  assert.deepEqual(ten.presentPeople, ['希绘'])
  assert.equal(ten.deviceAccess, 'limited')
})

test('a successful commit appends a SceneDelta without replacing the frame', () => {
  const frame = projectSceneFrame({ storyId: 'story', now, scene, state: emptyStoryState(), recentEntries: [script(41, '她仍坐在窗边。')] })
  const burst = resolveDialogueBurst(frame, undefined, scene.startedAt)
  const commit = legacyDecisionToScriptCommit({
    storyId: 'story', participantId: 'friend', phase: 'user-message', from: now, now,
    frameId: frame.id, burstId: burst.id,
    decision: { script: '屏幕亮起来，她低头看见消息，手指停在波形上。', interaction: { seen: true, reply: { mode: 'none' } } },
  })
  const advanced = advanceSceneFrame(frame, burst, commit, 42, now)
  assert.equal(advanced.frame.id, frame.id)
  assert.equal(advanced.burst.id, burst.id)
  assert.equal(advanced.burst.lastEventId, commit.events.at(-1)?.eventId)
  assert.ok(!advanced.frame.sourceEntryIds.includes(42), '新 prose 不能回灌为场景事实')
  assert.ok(advanced.burst.sourceEntryIds.includes(42), 'burst 只保留提交链路来源')
  assert.doesNotMatch(advanced.frame.narrativeFocus ?? '', /屏幕亮起来/, 'private prose must not leak through the shared frame')
  assert.deepEqual(sceneFrameProvenanceErrors(advanced.frame), [])
})
