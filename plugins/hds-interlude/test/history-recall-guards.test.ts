import assert from 'node:assert/strict'
import test from 'node:test'
import { historyLexicalScore, InterludeService, isHistoryEntryVisibleToParticipant, shouldRequestTurnEmbedding } from '../src/service'

test('semantic history recall keeps private branches and group transcripts out of another participant prompt', () => {
  assert.equal(isHistoryEntryVisibleToParticipant({ participantId: 'a', kind: 'user-message' }, 'a', false), true)
  assert.equal(isHistoryEntryVisibleToParticipant({ participantId: 'a', kind: 'character-message' }, 'b', false), false)
  assert.equal(isHistoryEntryVisibleToParticipant({ participantId: '', kind: 'script' }, 'b', false), true)
  assert.equal(isHistoryEntryVisibleToParticipant({ participantId: '', kind: 'group-message' }, 'b', false), false)
  assert.equal(isHistoryEntryVisibleToParticipant({ participantId: 'a', kind: 'user-message' }, 'b', true), true)
})

test('sticker filtering requests a live vector only for an active oversized library', () => {
  const base = { enabled: true, liveQuery: false, semanticHistory: false, semanticStickerFilter: true }
  assert.equal(shouldRequestTurnEmbedding(base, false, 100), false)
  assert.equal(shouldRequestTurnEmbedding(base, true, 12), false)
  assert.equal(shouldRequestTurnEmbedding(base, true, 13), true)
  assert.equal(shouldRequestTurnEmbedding({ ...base, semanticHistory: true }, false, 0), true)
  assert.equal(shouldRequestTurnEmbedding({ ...base, enabled: false }, true, 100), false)
})

test('raw history has a Chinese lexical recall lane without embeddings', () => {
  assert.ok(historyLexicalScore('昨天那杯奶茶拿到了吗', '昨天傍晚，她取走了奶茶，取餐码是 8914。') >= 0.12)
  assert.equal(historyLexicalScore('昨天那杯奶茶', '她正在整理完全无关的课程笔记。'), 0)
})

test('a lexical anchor returns its contiguous original-script neighborhood', async () => {
  const rows = new Map<number, any>([
    [1, { content: '她从教学楼出来。', occurredAt: '2026-09-03T09:00:00.000Z', participantId: 'alice', kind: 'script' }],
    [2, { content: '她在奶茶店报出取餐码 8914。', occurredAt: '2026-09-03T09:03:00.000Z', participantId: 'alice', kind: 'script' }],
    [3, { content: '杯子拿到手时还是冰的。', occurredAt: '2026-09-03T09:04:00.000Z', participantId: 'alice', kind: 'script' }],
  ])
  const service = {
    ensureHistoryVectors: async () => {},
    historyVectorsReady: new Set(['story']),
    historyVectors: new Map([['story', rows]]),
    episodeIndexes: new Map(), sharedStoryConfig: { shareParticipantDetails: false },
  }
  const recalled = await (InterludeService.prototype as any).recallHistory.call(
    service, 'story', 'alice', '昨天奶茶的取餐码', [], new Set(),
  )
  assert.deepEqual(recalled[0].sourceEntryIds, [1, 2, 3])
  assert.match(recalled[0].content, /教学楼出来[\s\S]*8914[\s\S]*还是冰的/)
})
