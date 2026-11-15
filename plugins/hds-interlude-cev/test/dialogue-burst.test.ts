import assert from 'node:assert/strict'
import test from 'node:test'
import { projectSceneFrame, resolveDialogueBurst } from '../src/script/scene-frame'
import { emptyStoryState } from '../src/types'

test('DialogueBurst identity follows scene identity rather than inactivity or message count', () => {
  const state = emptyStoryState()
  const frame = projectSceneFrame({ storyId: 'story', now: new Date('2026-09-04T08:00:00Z'), scene: null, state })
  const first = resolveDialogueBurst(frame, undefined, new Date('2026-09-04T00:00:00Z'))
  const muchLater = resolveDialogueBurst(frame, first, new Date('2026-09-05T00:00:00Z'))
  assert.equal(muchLater.id, first.id)

  const nextFrame = projectSceneFrame({
    storyId: 'story', now: new Date('2026-09-05T00:00:00Z'),
    scene: {
      id: 2, storyId: 'story', status: 'active', startedAt: new Date('2026-09-05T00:00:00Z'),
      endedAt: null, hook: '', summary: '', entryCount: 0, lastEntryId: null,
      createdAt: new Date('2026-09-05T00:00:00Z'), updatedAt: new Date('2026-09-05T00:00:00Z'),
    },
    state,
  })
  assert.notEqual(resolveDialogueBurst(nextFrame, first, new Date('2026-09-05T00:00:00Z')).id, first.id)
})

test('DialogueBurst changes on an explicit event boundary, scope change, or unrelated topic', () => {
  const state = emptyStoryState()
  const frame = projectSceneFrame({ storyId: 'story', now: new Date('2026-09-04T08:00:00Z'), scene: null, state })
  const first = resolveDialogueBurst(frame, undefined, new Date('2026-09-04T08:00:00Z'), { scope: 'alice', topicText: '昨天的奶茶拿到了吗' })
  assert.equal(resolveDialogueBurst(frame, first, new Date('2026-09-05T08:00:00Z'), { scope: 'alice', topicText: '那取餐码还记得吗' }).id, first.id)
  assert.notEqual(resolveDialogueBurst(frame, first, new Date('2026-09-04T08:01:00Z'), { scope: 'bob', topicText: '昨天的奶茶拿到了吗' }).id, first.id)
  assert.notEqual(resolveDialogueBurst(frame, first, new Date('2026-09-04T08:02:00Z'), { scope: 'alice', topicText: '新买的键盘怎么样' }).id, first.id)
  assert.notEqual(resolveDialogueBurst(frame, first, new Date('2026-09-04T08:03:00Z'), { scope: 'alice', topicText: '昨天的奶茶拿到了吗', boundary: true }).id, first.id)
})
