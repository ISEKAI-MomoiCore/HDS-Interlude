import { randomUUID } from 'node:crypto'
import { freshEndpointState } from './endpoints'
import { emptyStoryState, emptyParticipantState } from './types'

/** Runtime records owned by HDSI. The directory-backed global sticker library
 * intentionally survives story resets and runtime database clearing. */
export const RUNTIME_TABLES = [
  'interlude_script_entry', 'interlude_memory', 'interlude_intent',
  'interlude_scene', 'interlude_arc', 'interlude_fact', 'interlude_state_patch',
  'interlude_overlay_snapshot', 'interlude_web_observation', 'interlude_schedule_preplan',
  'interlude_participant', 'interlude_seeded_event', 'interlude_qzone_post', 'interlude_work',
  'interlude_story', 'interlude_long_arc_guidance', 'interlude_long_arc_progress',
  'interlude_endpoint', 'interlude_endpoint_state', 'interlude_story_alias',
] as const
export type RuntimeTable = typeof RUNTIME_TABLES[number]

export function cleanupKey(table: RuntimeTable, row: Record<string, any>) {
  const primary = table === 'interlude_schedule_preplan' || table === 'interlude_long_arc_progress' ? 'storyId'
    : table === 'interlude_endpoint_state' ? 'endpointId'
      : table === 'interlude_story_alias' ? 'aliasStoryId' : 'id'
  if (row[primary] === undefined || row[primary] === null) throw new Error(`Missing cleanup key: ${table}.${primary}`)
  return { [primary]: row[primary] }
}

/** Explicit payloads are validated by the real model on the fallback write. */
export function cleanupPayload(table: RuntimeTable, row: Record<string, any>, setting?: unknown): Record<string, any> {
  const text = '[HDSI 数据已清空]'
  switch (table) {
    case 'interlude_story': return { status: 'archived', setting, state: emptyStoryState() }
    case 'interlude_participant': return { status: 'paused', profile: '', relationship: '', state: emptyParticipantState() }
    case 'interlude_script_entry': return { kind: 'redacted', actor: 'system', content: text, metadata: { redacted: true }, embedding: [] }
    case 'interlude_memory': return { status: 'deleted', content: text }
    case 'interlude_intent': return { status: 'cancelled', summary: text, payload: {} }
    case 'interlude_scene': return { status: 'closed', hook: '', summary: '', entryCount: 0, lastEntryId: 0 }
    case 'interlude_arc': return { status: 'closed', title: '', summary: '', sceneCount: 0 }
    case 'interlude_fact': return { status: 'superseded', content: text, knowledge: [], embedding: [], sourceEntryIds: [] }
    case 'interlude_state_patch': return { status: 'rejected', proposedValue: text, evidence: '', sourceEntryIds: [] }
    case 'interlude_overlay_snapshot': return { status: 'superseded', summary: text, majorEvents: [], sourcePatchIds: [] }
    case 'interlude_web_observation': return { status: 'deleted', query: '', url: '', title: '', excerpt: '', summary: text }
    case 'interlude_schedule_preplan': return { regimes: [], exceptions: [], materializedDays: [], validFrom: '1970-01-01', validThrough: '1970-01-01', lastReviewedLocalDate: '', reviewReason: text }
    case 'interlude_seeded_event': return { status: 'expired', summary: text, sourcePayload: {}, subjects: [] }
    case 'interlude_long_arc_guidance': return { status: 'completed', payload: {}, premise: '', direction: '', evidenceEntryIds: [], currentStage: '', intensity: 'subtle', confidence: 0, title: text }
    case 'interlude_long_arc_progress': return { lastCountedEntryId: 0, totalScore: 0, privateCount: 0, privateScore: 0, groupCount: 0, groupScore: 0, unknownCount: 0, lastGenerationScore: 0, lastGenerationEntryId: 0, updatedAt: new Date() }
    case 'interlude_endpoint': return { enabled: false }
    case 'interlude_endpoint_state': return { state: freshEndpointState(String(row.endpointId)) }
    case 'interlude_story_alias': return { canonicalStoryId: '', reason: text }
    case 'interlude_qzone_post': return { status: 'failed', content: text, tid: '', targetUin: '', error: text, commentNum: 0, createdAt: new Date(0), postedAt: new Date(0) }
    case 'interlude_work': {
      // Retain a decodable redacted document while retiring every old job ID and CAS.
      const id = randomUUID()
      return { generation: Number.isSafeInteger(row.generation) ? row.generation + 1 : 1,
        state: { schemaVersion: 1, title: text, head: id, revisions: [{ id, parentId: null, content: text, author: 'user', createdAt: new Date().toISOString() }], proposals: [], jobs: [] } }
    }
  }
}
