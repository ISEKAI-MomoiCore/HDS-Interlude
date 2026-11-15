import assert from 'node:assert/strict'
import test from 'node:test'
import { registerTables } from '../src/database'

test('existing installations extend raw script entries with persistent embeddings', () => {
  const calls: Array<{ name: string, fields: Record<string, unknown> }> = []
  const tables: Record<string, any> = {
    cev_interlude_story: { fields: {} },
    cev_interlude_script_entry: { fields: { content: {} } },
    cev_interlude_web_observation: { fields: {} },
    cev_interlude_overlay_snapshot: { fields: {} },
    cev_interlude_sticker: { fields: {} },
    cev_interlude_schedule_preplan: { fields: {} },
  }
  const ctx = {
    model: {
      tables,
      extend(name: string, fields: Record<string, unknown>) {
        calls.push({ name, fields })
        tables[name] ??= { fields: {} }
        Object.assign(tables[name].fields, fields)
      },
    },
  } as any
  registerTables(ctx)
  assert.deepEqual(calls, [
    { name: 'cev_interlude_script_entry', fields: { embedding: 'json' } },
    { name: 'cev_interlude_seeded_event', fields: {
      id: 'unsigned', storyId: 'string(255)', summary: 'text', importance: 'string(16)',
      occursAt: 'timestamp', expiresAt: 'timestamp', status: 'string(16)',
      subjects: 'json', sourcePayload: 'json', injectedEntryId: 'unsigned',
      createdAt: 'timestamp', updatedAt: 'timestamp',
    } },
    { name: 'cev_interlude_qzone_post', fields: {
      id: 'unsigned', storyId: 'string(255)', kind: 'string(16)', tid: 'string(127)',
      targetUin: 'string(63)', content: 'text', ugcRight: 'unsigned', endpointId: 'string(63)', commentNum: 'unsigned',
      status: 'string(16)', error: 'text', createdAt: 'timestamp', postedAt: 'timestamp',
    } },
    { name: 'cev_interlude_endpoint', fields: {
      id: 'string(63)', ownerKind: 'string(24)', ownerId: 'string(255)',
      channelKind: 'string(8)', platform: 'string(63)', accountKey: 'string(127)', selfId: 'string(63)',
      userId: 'string(127)', channelId: 'string(127)', groupId: 'string(127)',
      conversationKind: 'string(16)', enabled: 'boolean', createdAt: 'timestamp', updatedAt: 'timestamp',
    } },
    { name: 'cev_interlude_endpoint_state', fields: {
      endpointId: 'string(63)', state: 'json', updatedAt: 'timestamp',
    } },
    { name: 'cev_interlude_story_alias', fields: {
      aliasStoryId: 'string(255)', canonicalStoryId: 'string(255)', reason: 'string(255)', createdAt: 'timestamp',
    } },
    { name: 'cev_interlude_work', fields: {
      id: 'string(64)', storyId: 'string(255)', participantId: 'string(255)', generation: 'unsigned', state: 'json',
    } },
    { name: 'cev_interlude_long_arc_guidance', fields: {
      id: 'unsigned', storyId: 'string(255)', version: 'unsigned', status: 'string(16)',
      title: 'string(255)', premise: 'text', direction: 'text',
      payload: 'json', currentStage: 'string(80)', intensity: 'string(16)',
      confidence: 'double', triggerEntryId: 'unsigned', evidenceEntryIds: 'json',
      supersedesId: 'unsigned', createdAt: 'timestamp', updatedAt: 'timestamp',
      completedAt: 'timestamp', expiresAt: 'timestamp',
    } },
    { name: 'cev_interlude_long_arc_progress', fields: {
      storyId: 'string(255)', lastCountedEntryId: 'unsigned', totalScore: 'double',
      privateCount: 'unsigned', privateScore: 'double', groupCount: 'unsigned', groupScore: 'double',
      unknownCount: 'unsigned', lastGenerationScore: 'double', lastGenerationEntryId: 'unsigned',
      updatedAt: 'timestamp',
    } },
  ])
})

test('knowledge evidence is an additive nullable field and reload does not rebuild it', () => {
  const calls: any[] = []
  const tables: Record<string, any> = {
    cev_interlude_story: { fields: {} }, cev_interlude_fact: { fields: { content: {} } },
    cev_interlude_script_entry: { fields: { embedding: {} } },
    cev_interlude_web_observation: {}, cev_interlude_overlay_snapshot: {}, cev_interlude_sticker: {}, cev_interlude_schedule_preplan: {},
  }
  const ctx = { model: { tables, extend(name: string, fields: any) {
    calls.push({ name, fields }); tables[name] ??= { fields: {} }; Object.assign(tables[name].fields, fields)
  } } } as any
  registerTables(ctx)
  registerTables(ctx)
  assert.deepEqual(calls, [
    { name: 'cev_interlude_fact', fields: { knowledge: 'json' } },
    { name: 'cev_interlude_seeded_event', fields: {
      id: 'unsigned', storyId: 'string(255)', summary: 'text', importance: 'string(16)',
      occursAt: 'timestamp', expiresAt: 'timestamp', status: 'string(16)',
      subjects: 'json', sourcePayload: 'json', injectedEntryId: 'unsigned',
      createdAt: 'timestamp', updatedAt: 'timestamp',
    } },
    { name: 'cev_interlude_qzone_post', fields: {
      id: 'unsigned', storyId: 'string(255)', kind: 'string(16)', tid: 'string(127)',
      targetUin: 'string(63)', content: 'text', ugcRight: 'unsigned', endpointId: 'string(63)', commentNum: 'unsigned',
      status: 'string(16)', error: 'text', createdAt: 'timestamp', postedAt: 'timestamp',
    } },
    { name: 'cev_interlude_endpoint', fields: {
      id: 'string(63)', ownerKind: 'string(24)', ownerId: 'string(255)',
      channelKind: 'string(8)', platform: 'string(63)', accountKey: 'string(127)', selfId: 'string(63)',
      userId: 'string(127)', channelId: 'string(127)', groupId: 'string(127)',
      conversationKind: 'string(16)', enabled: 'boolean', createdAt: 'timestamp', updatedAt: 'timestamp',
    } },
    { name: 'cev_interlude_endpoint_state', fields: {
      endpointId: 'string(63)', state: 'json', updatedAt: 'timestamp',
    } },
    { name: 'cev_interlude_story_alias', fields: {
      aliasStoryId: 'string(255)', canonicalStoryId: 'string(255)', reason: 'string(255)', createdAt: 'timestamp',
    } },
    { name: 'cev_interlude_work', fields: {
      id: 'string(64)', storyId: 'string(255)', participantId: 'string(255)', generation: 'unsigned', state: 'json',
    } },
    { name: 'cev_interlude_long_arc_guidance', fields: {
      id: 'unsigned', storyId: 'string(255)', version: 'unsigned', status: 'string(16)',
      title: 'string(255)', premise: 'text', direction: 'text',
      payload: 'json', currentStage: 'string(80)', intensity: 'string(16)',
      confidence: 'double', triggerEntryId: 'unsigned', evidenceEntryIds: 'json',
      supersedesId: 'unsigned', createdAt: 'timestamp', updatedAt: 'timestamp',
      completedAt: 'timestamp', expiresAt: 'timestamp',
    } },
    { name: 'cev_interlude_long_arc_progress', fields: {
      storyId: 'string(255)', lastCountedEntryId: 'unsigned', totalScore: 'double',
      privateCount: 'unsigned', privateScore: 'double', groupCount: 'unsigned', groupScore: 'double',
      unknownCount: 'unsigned', lastGenerationScore: 'double', lastGenerationEntryId: 'unsigned',
      updatedAt: 'timestamp',
    } },
  ])
})
