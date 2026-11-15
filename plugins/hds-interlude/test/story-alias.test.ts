import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { normalizeStoryAliasRow, resolveStoryAlias, type EndpointRow, type StoryAliasRecord } from '../src/endpoints'

const proto = InterludeService.prototype as unknown as Record<string, Function>

test('resolveStoryAlias: hit, miss, self-alias rejected, chain detected', () => {
  const rows: StoryAliasRecord[] = [
    { aliasStoryId: 'onebot:100:200', canonicalStoryId: 'character:onebot:100', reason: 'legacy', createdAt: new Date() },
    { aliasStoryId: 'character:onebot:999', canonicalStoryId: 'character:onebot:100', reason: 'M2', createdAt: new Date() },
  ]
  assert.equal(resolveStoryAlias(rows, 'onebot:100:200').canonicalStoryId, 'character:onebot:100')
  assert.equal(resolveStoryAlias(rows, 'missing').canonicalStoryId, undefined)
  // 链式：character:onebot:100 本身又是另一行的别名 → 双射失败，交人工裁决
  const chained: StoryAliasRecord[] = [...rows, { aliasStoryId: 'character:onebot:100', canonicalStoryId: 'x', reason: 'bad', createdAt: new Date() }]
  assert.equal(resolveStoryAlias(chained, 'onebot:100:200').problem, 'chain')
  assert.equal(normalizeStoryAliasRow({ aliasStoryId: 'a', canonicalStoryId: 'a', reason: '' }), undefined, '自指别名无效')
})

function aliasFixture() {
  const tables: Record<string, Record<string, unknown>[]> = {
    interlude_story: [{ id: 's-legacy', platform: 'onebot', selfId: '100', status: 'active' }],
    interlude_endpoint: [],
    interlude_story_alias: [],
    interlude_qzone_post: [],
  }
  const auditEntries: string[] = []
  const svc = {
    endpointRegistryReady: false,
    endpointRows: [] as EndpointRow[],
    endpointStates: new Map(),
    setEndpointState: function (id: string, state: unknown) { (this.endpointStates as Map<string, unknown>).set(id, state) },
    persistEndpointState: () => {},
    storyAliasRows: [] as StoryAliasRecord[],
    storyAliasProblems: new Set<string>(),
    config: { onebot: { groupChats: [] } },
    dbGet: async (table: string, query: Record<string, unknown>) =>
      (tables[table] ?? []).filter(row => Object.entries(query).every(([k, v]) =>
        v && typeof v === 'object' && Array.isArray((v as any).$in)
          ? (v as any).$in.includes(row[k])
          : row[k] === v)),
    dbCreate: async (table: string, data: Record<string, unknown>) => { (tables[table] ??= []).push(data); return data },
    dbRemove: async (table: string, query: { aliasStoryId: string }) => {
      tables[table] = (tables[table] ?? []).filter(row => row.aliasStoryId !== query.aliasStoryId)
    },
    appendEntry: async (storyId: string, entry: { content: string }) => { auditEntries.push(`${storyId}:${entry.content}`); return {} },
    reportStandalone: () => {},
    reportStandaloneOperation: () => {},
  } as unknown as InterludeService
  for (const method of ['ensureEndpointRegistry', 'reconcileEndpointRegistry', 'recordStoryAlias', 'resolveStoryIdAlias', 'removeStoryAlias', 'backfillQzoneEndpointIds']) {
    ;(svc as any)[method] = proto[method].bind(svc)
  }
  return { svc, tables, auditEntries }
}

test('M1b migration registers derived-id aliases idempotently and skips identical ids', async () => {
  const { svc, tables } = aliasFixture()
  await (svc as any).ensureEndpointRegistry()
  // legacy id 's-legacy' ≠ 推导 'character:onebot:100' → 登记别名
  assert.equal(tables.interlude_story_alias.length, 1)
  assert.equal(tables.interlude_story_alias[0].aliasStoryId, 'character:onebot:100')
  assert.equal(tables.interlude_story_alias[0].canonicalStoryId, 's-legacy')
  // 幂等：重跑零新增
  ;(svc as any).endpointRegistryReady = false
  await (svc as any).ensureEndpointRegistry()
  assert.equal(tables.interlude_story_alias.length, 1)
  // 已是推导形态的故事（id === derivedId）不登记
  tables.interlude_story = [{ id: 'character:onebot:100', platform: 'onebot', selfId: '100', status: 'active' }]
  tables.interlude_story_alias = []
  ;(svc as any).storyAliasRows = []
  ;(svc as any).endpointRegistryReady = false
  await (svc as any).ensureEndpointRegistry()
  assert.equal(tables.interlude_story_alias.length, 0)
})

test('resolveStoryIdAlias ignores dangling targets and chains with one-time warnings', async () => {
  const { svc, tables } = aliasFixture()
  await (svc as any).ensureEndpointRegistry()
  // 悬空：canonical 无对应故事行
  tables.interlude_story = []
  assert.equal(await (svc as any).resolveStoryIdAlias('character:onebot:100'), undefined)
  // 命中：canonical 存在
  tables.interlude_story = [{ id: 's-legacy', platform: 'onebot', selfId: '100', status: 'active' }]
  assert.equal(await (svc as any).resolveStoryIdAlias('character:onebot:100'), 's-legacy')
  // 链式：canonical 又是别名 → undefined
  tables.interlude_story_alias.push({ aliasStoryId: 's-legacy', canonicalStoryId: 'x', reason: 'chain', createdAt: new Date() })
  ;(svc as any).storyAliasRows.push({ aliasStoryId: 's-legacy', canonicalStoryId: 'x', reason: 'chain', createdAt: new Date() } as StoryAliasRecord)
  assert.equal(await (svc as any).resolveStoryIdAlias('character:onebot:100'), undefined)
})

test('recordStoryAlias refuses conflicting redirects; removeStoryAlias rolls back with audit', async () => {
  const { svc, auditEntries } = aliasFixture()
  await (svc as any).ensureEndpointRegistry()
  // 冲突：同一别名指向不同 canonical → 拒绝且不覆盖（人工裁决）
  const conflicted = await (svc as any).recordStoryAlias('character:onebot:100', 'other-story', 'test')
  assert.equal(conflicted, false)
  assert.equal((svc as any).storyAliasRows[0].canonicalStoryId, 's-legacy')
  // 回滚：删行 + 审计条目写入 canonical 故事
  const rollback = await (svc as any).removeStoryAlias('character:onebot:100', 'test-rollback')
  assert.equal(rollback.ok, true)
  assert.equal((svc as any).storyAliasRows.length, 0)
  assert.equal(auditEntries.length, 1)
  assert.match(auditEntries[0], /已回滚剧本别名 character:onebot:100 → s-legacy/)
  const missing = await (svc as any).removeStoryAlias('character:onebot:100')
  assert.equal(missing.ok, false)
})

test('findStory redirects registry hits to the existing story instead of deriving a new id', async () => {
  const story = { id: 's-legacy', platform: 'onebot', selfId: '100', status: 'active' }
  const calls: string[] = []
  const svc = {
    sharedStoryConfig: { enabled: true },
    resolveInboundEndpointFor: async () => ({ roleEndpoint: { ownerId: 's-legacy' } }),
    resolveStoryIdAlias: async () => undefined,
    getCanonicalStory: async (preferredId?: string) => { calls.push(`canonical:${preferredId}`); return preferredId === 's-legacy' ? story : undefined },
    getPausedStory: async () => undefined,
    repairCanonicalOneBotStoryTransport: async (s: unknown) => s,
    migrateLegacyBranchIntoShared: async (s: unknown) => { calls.push('branch-merged'); return s },
    migrateLegacyStory: async () => { throw new Error('registry hit must not rename the story') },
  } as unknown as InterludeService
  const findStory = proto.findStory.bind(svc)
  const found = await findStory.call(svc, { platform: 'onebot', selfId: '100', userId: '200' })
  assert.equal(found.id, 's-legacy')
  assert.deepEqual(calls, ['canonical:s-legacy', 'branch-merged'], '注册表命中 → 直达既有故事，不再推导/改名')
})
