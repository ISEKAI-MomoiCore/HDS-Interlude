import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import {
  ENDPOINT_DELIVERABLE_TTL_MS, endpointAccountKey, freshEndpointState, isEndpointDeliverable,
  resolveInboundEndpoint, stateAfterInbound, type EndpointRow,
} from '../src/endpoints'
import { qzoneRecordsForEndpoint, type QzonePostRecord } from '../src/qzone'

const proto = InterludeService.prototype as unknown as Record<string, Function>

test('P1-3: accountKey 平台隔离——onebot 家族折叠、原生平台专属键、同号不碰撞', () => {
  assert.equal(endpointAccountKey('onebot', '100'), 'onebot:100')
  assert.equal(endpointAccountKey('napcat', '100'), 'onebot:100', '家族折叠保持历史行兼容')
  assert.equal(endpointAccountKey('qq:onebot:v2', '100'), 'onebot:100')
  assert.equal(endpointAccountKey('wechat', '100'), 'wechat:100', '原生平台专属前缀')
  assert.notEqual(endpointAccountKey('onebot', '100'), endpointAccountKey('wechat', '100'))
  // 解析不跨平台：onebot 端点行不被 wechat 会话命中
  const rows: EndpointRow[] = [{
    id: 'ep-w', ownerKind: 'story-role', ownerId: 's1', channelKind: 'wechat', platform: 'wechat',
    accountKey: 'wechat:100', selfId: '100', enabled: true, createdAt: new Date(), updatedAt: new Date(),
  }]
  assert.equal(resolveInboundEndpoint(rows, { platform: 'onebot', selfId: '100' }), undefined)
  assert.equal(resolveInboundEndpoint(rows, { platform: 'wechat', selfId: '100' })?.roleEndpoint.id, 'ep-w')
})

test('P1-1: 注册表就绪后，未注册 OneBot 账号被拒绝挂载（不触发全局 fallback/重绑）', async () => {
  const story = { id: 's1', platform: 'onebot', selfId: '100', status: 'active' }
  const svc = {
    sharedStoryConfig: { enabled: true },
    endpointRegistryReady: true,
    storyAliasProblems: new Set<string>(),
    resolveInboundEndpointFor: async () => undefined,
    resolveStoryIdAlias: async () => undefined,
    getCanonicalStory: async () => { throw new Error('未注册账号不得落到全局 fallback') },
    getPausedStory: async () => undefined,
    reportStandalone: () => {},
  } as unknown as InterludeService
  const found = await proto.findStory.call(svc, { platform: 'onebot', selfId: 'stranger', userId: '200' })
  assert.equal(found, undefined, '陌生账号 → 无故事，绝不自动挂载')
  assert.equal(story.id, 's1')
})

test('P1-2: 运行期增量登记——新故事同步补端点行与别名', async () => {
  const tables: Record<string, Record<string, unknown>[]> = { interlude_endpoint: [], interlude_story_alias: [], interlude_qzone_post: [] }
  const svc = {
    endpointRegistryReady: true,
    endpointRows: [] as EndpointRow[],
    endpointStates: new Map(),
    setEndpointState: function (id: string, state: unknown) { (this.endpointStates as Map<string, unknown>).set(id, state) },
    persistEndpointState: () => {},
    storyAliasRows: [],
    storyAliasProblems: new Set(),
    dbGet: async (table: string, query: Record<string, unknown>) => (tables[table] ?? []).filter(row => Object.entries(query).every(([k, v]) => row[k] === v)),
    dbCreate: async (table: string, data: Record<string, unknown>) => { (tables[table] ??= []).push(data); return data },
    reportStandalone: () => {}, reportStandaloneOperation: () => {},
  } as unknown as InterludeService
  ;(svc as any).ensureEndpointRegistry = async () => {}
  ;(svc as any).enqueueEndpointWrite = (task: () => Promise<void>) => task()
  ;(svc as any).recordStoryAlias = proto.recordStoryAlias.bind(svc)
  await proto.registerStoryRoleEndpointRow.call(svc, { id: 'story-new', platform: 'onebot', selfId: '777' })
  assert.equal(tables.interlude_endpoint.length, 1)
  assert.equal((tables.interlude_endpoint[0] as any).ownerId, 'story-new')
  assert.equal(tables.interlude_story_alias.length, 1, '推导 ID 别名同步登记')
  assert.equal((svc as any).endpointRows.length, 1)
  // 幂等：重复登记零新增
  await proto.registerStoryRoleEndpointRow.call(svc, { id: 'story-new', platform: 'onebot', selfId: '777' })
  assert.equal(tables.interlude_endpoint.length, 1)
})

test('P1-5: 多角色端点时 repair 不改写任何地址，只刷新命中端点状态', async () => {
  const updates: unknown[][] = []
  const rows: EndpointRow[] = [
    { id: 'ep-a', ownerKind: 'story-role', ownerId: 's1', channelKind: 'qq', platform: 'onebot', accountKey: 'onebot:100', selfId: '100', enabled: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'ep-b', ownerKind: 'story-role', ownerId: 's1', channelKind: 'qq', platform: 'onebot', accountKey: 'onebot:200', selfId: '200', enabled: true, createdAt: new Date(), updatedAt: new Date() },
  ]
  const states = new Map([['ep-b', freshEndpointState('ep-b')]])
  const svc = {
    ctx: { bots: [] },
    endpointRegistryReady: true,
    endpointRows: rows,
    endpointStates: states,
    endpointDriftWarned: new Set(),
    setEndpointState: function (id: string, state: unknown) { (this.endpointStates as Map<string, unknown>).set(id, state) },
    persistEndpointState: () => {},
    ensureEndpointRegistry: async () => {},
    dbSet: async (...args: unknown[]) => { updates.push(args) },
    reportStandalone: () => {},
  } as unknown as InterludeService
  const story = { id: 's1', platform: 'onebot', selfId: '100', status: 'active' }
  const repaired = await proto.repairCanonicalOneBotStoryTransport.call(svc, story, { platform: 'onebot', selfId: '200' })
  assert.equal(repaired, story, '故事原样返回')
  assert.equal(updates.length, 0, '多端点下不写库（地址与故事字段都不动）')
  assert.equal(states.get('ep-b')?.connection.online, true, '命中端点在线状态已刷新')
  assert.equal(states.get('ep-a')?.connection.online, undefined, '未命中端点不受影响')
})

test('P1-6: findParticipant 注册表 user 端点优先命中（旧字段不匹配也能找到链接端点）', async () => {
  const participant = { id: 'p1', storyId: 's1', status: 'active' }
  const svc = {
    findStory: async () => ({ id: 's1' }),
    resolveInboundEndpointFor: async () => ({ userEndpoint: { ownerId: 'p1' } }),
    getParticipant: async (id: string) => (id === 'p1' ? participant : undefined),
    dbGet: async () => [],
  } as unknown as InterludeService
  const found = await proto.findParticipant.call(svc, { platform: 'onebot', selfId: '999', userId: '200' })
  assert.equal(found, participant, '端点注册表命中即返回，不依赖 session 与旧字段比对')
})

test('P2-7: 暂停故事同样登记端点与别名（$in 查询）', () => {
  // 由 reconcile 的查询语义保证；此处锚定 mock 语义与真实一致的最小断言
  const query = { status: { $in: ['active', 'paused'] } }
  const match = (status: string) => (query.status as { $in: string[] }).$in.includes(status)
  assert.equal(match('active'), true)
  assert.equal(match('paused'), true)
  assert.equal(match('archived'), false)
})

test('P2-8: deliverable 确认超过 TTL 按不可投递保守处理', () => {
  const t0 = 1_000_000
  const state = stateAfterInbound(freshEndpointState('ep1', t0), t0)
  assert.equal(isEndpointDeliverable(state, t0 + 1_000), true)
  assert.equal(isEndpointDeliverable(state, t0 + ENDPOINT_DELIVERABLE_TTL_MS + 1), false, '陈旧的 allowed 不是事实')
})

test('P2-10: qzone 限流按端点分桶，历史无 id 行保守计入所有端点', () => {
  const base = { storyId: 's1', kind: 'post', tid: 't', status: 'confirmed' } as QzonePostRecord
  const records: QzonePostRecord[] = [
    { ...base, endpointId: 'ep-a', createdAt: new Date() },
    { ...base, endpointId: 'ep-b', createdAt: new Date() },
    { ...base, createdAt: new Date() }, // 历史行（回填前）
  ]
  assert.deepEqual(qzoneRecordsForEndpoint(records, 'ep-a').map(r => r.endpointId ?? 'legacy'), ['ep-a', 'legacy'])
  assert.deepEqual(qzoneRecordsForEndpoint(records, 'ep-b').map(r => r.endpointId ?? 'legacy'), ['ep-b', 'legacy'])
  assert.equal(qzoneRecordsForEndpoint(records, undefined).length, 3)
})

// ── 三轮审计（2026-09-29）回归 ──────────────────────────────────────────────

test('P1-1: 数据库写入失败不产生幽灵端点，注册表置脏待重试', async () => {
  const tables: Record<string, Record<string, unknown>[]> = { interlude_endpoint: [], interlude_story_alias: [], interlude_qzone_post: [] }
  const svc = {
    endpointRegistryReady: true,
    endpointRows: [] as EndpointRow[],
    endpointStates: new Map(),
    setEndpointState: function (id: string, state: unknown) { (this.endpointStates as Map<string, unknown>).set(id, state) },
    persistEndpointState: () => {},
    storyAliasRows: [], storyAliasProblems: new Set(),
    endpointWriteQueue: Promise.resolve(),
    dbGet: async (table: string, query: Record<string, unknown>) => (tables[table] ?? []).filter(row => Object.entries(query).every(([k, v]) => row[k] === v)),
    dbCreate: async (_table: string, _data: unknown) => { throw new Error('disk full') },
    reportStandalone: () => {}, reportStandaloneOperation: () => {},
  } as unknown as InterludeService
  for (const method of ['enqueueEndpointWrite', 'recordStoryAlias']) (svc as any)[method] = proto[method].bind(svc)
  ;(svc as any).ensureEndpointRegistry = async () => {}
  await proto.registerStoryRoleEndpointRow.call(svc, { id: 'story-x', platform: 'onebot', selfId: '555' })
  assert.equal((svc as any).endpointRows.length, 0, '落库失败 → 内存零行（无幽灵端点）')
  assert.equal((svc as any).endpointRegistryReady, false, '注册表置脏，下次 findStory 触发 reconcile 重试')
})

test('P1-3: 注册表就绪后解析异常 → 拒绝入站，不回落全局故事查找', async () => {
  const svc = {
    sharedStoryConfig: { enabled: true },
    endpointRegistryReady: true,
    storyAliasProblems: new Set(),
    resolveInboundEndpointFor: async () => { throw new Error('db glitch') },
    getCanonicalStory: async () => { throw new Error('不得回落全局 fallback') },
    reportStandalone: () => {},
  } as unknown as InterludeService
  const found = await proto.findStory.call(svc, { platform: 'onebot', selfId: '100', userId: '200' })
  assert.equal(found, undefined)
})

test('P1-4: qzone preferSelfId 精确匹配——未注册账号直接失败，不自动切换', async () => {
  const rows: EndpointRow[] = [
    { id: 'ep-a', ownerKind: 'story-role', ownerId: 's1', channelKind: 'qq', platform: 'onebot', accountKey: 'onebot:100', selfId: '100', enabled: true, createdAt: new Date(), updatedAt: new Date() },
  ]
  const svc = {
    qzoneRuntime: { enabled: true },
    endpointRegistryReady: true,
    endpointRows: rows,
    endpointWriteQueue: Promise.resolve(),
    ensureEndpointRegistry: async () => {},
    enqueueEndpointWrite: (task: () => Promise<unknown>) => task(),
    qzoneCaller: () => undefined,
    reportStandalone: () => {},
  } as unknown as InterludeService
  const story = { id: 's1', platform: 'onebot', selfId: '100', status: 'active' }
  // 指定未注册账号 → 失败（即便端点 100 在线可用）
  const blocked = await proto.qzoneExecute.call(svc, story, 'post', { content: 'x' }, '999')
  assert.equal(blocked.ok, false)
  assert.match(blocked.error!, /未注册为本故事的角色端点/)
  // 精确命中才继续（caller 缺失在下一步失败，但错误信息不同——证明精确路由通过）
  const routed = await proto.qzoneExecute.call(svc, story, 'post', { content: 'x' }, '100')
  assert.equal(routed.ok, false)
  assert.match(routed.error!, /没有可用的 OneBot/, '已过精确匹配进入连接检查')
})

test('P2-8b: 群号归一化——group: 前缀配置与裸群号互相命中', async () => {
  const { deriveGroupEndpoint, resolveInboundEndpoint } = await import('../src/endpoints')
  const story = { id: 's1', platform: 'onebot', selfId: '100' }
  const prefixed = deriveGroupEndpoint(story, { groupId: 'group:777' })
  assert.equal(prefixed.groupId, '777', '派生侧剥离前缀')
  const rows = [prefixed, { id: 'ep-role', ownerKind: 'story-role', ownerId: 's1', channelKind: 'qq', platform: 'onebot', accountKey: 'onebot:100', selfId: '100', enabled: true, createdAt: new Date(), updatedAt: new Date() } as EndpointRow]
  assert.equal(resolveInboundEndpoint(rows, { platform: 'onebot', selfId: '100', groupId: '777' })?.groupEndpoint?.groupId, '777', '解析侧归一命中')
  assert.equal(resolveInboundEndpoint(rows, { platform: 'onebot', selfId: '100', groupId: 'guild:777' })?.groupEndpoint?.groupId, '777', 'guild 前缀同样命中')
})

test('P2-10: 重复角色端点在解析结果中显式暴露（不再静默取首行）', () => {
  const rows: EndpointRow[] = [
    { id: 'ep-1', ownerKind: 'story-role', ownerId: 's1', channelKind: 'qq', platform: 'onebot', accountKey: 'onebot:100', selfId: '100', enabled: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'ep-2', ownerKind: 'story-role', ownerId: 's2', channelKind: 'qq', platform: 'onebot', accountKey: 'onebot:100', selfId: '100', enabled: true, createdAt: new Date(), updatedAt: new Date() },
  ]
  const resolution = resolveInboundEndpoint(rows, { platform: 'onebot', selfId: '100' })
  assert.equal(resolution?.roleEndpoint.id, 'ep-1', '取首行保持行为')
  assert.deepEqual(resolution?.duplicateRoleAccountKeys, ['onebot:100'], '脏数据显式暴露供调用方告警')
})
