import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CURRENT_STORY_STATE_VERSION, decodeStoryState, encodeStoryState, inspectStoryStateMigration,
} from '../src/story-state'

test('legacy beta10 state upgrades without losing chat rhythm or unknown extensions', () => {
  const legacy = {
    narrativeUpdateCount: 7,
    settingOverlay: { perspective: '先理解处境', characterTraits: ['克制'] },
    chatRhythm: {
      recent: [{ bubbles: 2, shape: ['s', 'm'], tail: 'statement', totalChars: 18, occurredAt: '2026-09-04T00:00:00.000Z' }],
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    futureCodecField: { retained: true },
  }

  const decoded = decodeStoryState(legacy)
  assert.equal(decoded.schemaVersion, CURRENT_STORY_STATE_VERSION)
  assert.equal(decoded.narrativeUpdateCount, 7)
  assert.equal(decoded.settingOverlay.perspective, '先理解处境')
  assert.deepEqual(decoded.chatRhythm, legacy.chatRhythm)
  assert.deepEqual(decoded.extensions?.futureCodecField, { retained: true })
  assert.deepEqual(encodeStoryState(decoded), decoded)
  assert.deepEqual(decodeStoryState(decoded), decoded)
})

test('migration inspection is diagnostic and never injects configured perspective into canon', () => {
  const inspection = inspectStoryStateMigration({}, '配置中的默认视角')
  assert.equal(inspection.upgraded, true)
  assert.equal(inspection.perspectiveDefaultAvailable, true)
  assert.equal(decodeStoryState({}).settingOverlay.perspective, undefined)
})

test('scene frame codec retains only fields backed by script entry provenance', () => {
  const decoded = decodeStoryState({
    sceneFrame: {
      id: 'frame:one', place: '没有证据的地点', attention: '正在读消息',
      presentPeople: ['A'], sourceEntryIds: [12],
      sources: { attention: [12], presentPeople: [12] },
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    dialogueBurst: {
      id: 'burst:one', frameId: 'frame:one', startedAt: '2026-09-04T00:00:00.000Z', sourceEntryIds: [12],
    },
  })
  assert.equal(decoded.sceneFrame?.place, undefined)
  assert.equal(decoded.sceneFrame?.attention, '正在读消息')
  assert.deepEqual(decoded.sceneFrame?.presentPeople, ['A'])
  assert.equal(decoded.dialogueBurst?.frameId, decoded.sceneFrame?.id)
  assert.deepEqual(decodeStoryState(decoded), decoded)
})
