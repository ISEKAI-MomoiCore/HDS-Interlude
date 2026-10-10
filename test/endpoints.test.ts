import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { InterludeService, isBotOnlineStatus } from '../src/service'
import { Universal } from 'koishi'
import {
  channelContextMetadata, deriveGroupEndpoint, deriveParticipantUserEndpoint, deriveStoryRoleEndpoint,
  endpointUniqueKey, freshEndpointState, isEndpointDeliverable, isEndpointInitiateAllowed,
  normalizeEndpointRow, restoreEndpointState, resolveInboundEndpoint, stateAfterConnection, stateAfterInbound, stateAfterOutbound,
  type EndpointRow,
} from '../src/endpoints'

const NOW = new Date('2026-09-29T12:00:00')

test('bot status normalization accepts Koishi ONLINE and legacy online strings only', () => {
  assert.equal(isBotOnlineStatus(Universal.Status.ONLINE), true)
  assert.equal(isBotOnlineStatus(1), true)
  assert.equal(isBotOnlineStatus('online'), true)
  assert.equal(isBotOnlineStatus('active'), true)
  assert.equal(isBotOnlineStatus('connected'), true)
  assert.equal(isBotOnlineStatus(Universal.Status.OFFLINE), false)
  assert.equal(isBotOnlineStatus(Universal.Status.CONNECT), false)
  assert.equal(isBotOnlineStatus(Universal.Status.DISCONNECT), false)
  assert.equal(isBotOnlineStatus(Universal.Status.RECONNECT), false)
  assert.equal(isBotOnlineStatus(undefined), false)
})

test('startup bot snapshot synchronizes already-online endpoints after registry load', async () => {
  const calls: Array<[string, boolean]> = []
  const host = {
    ctx: {
      bots: [
        { platform: 'onebot', selfId: '100', status: Universal.Status.ONLINE },
        { platform: 'onebot', selfId: '200', status: Universal.Status.OFFLINE },
        { platform: 'onebot', selfId: '300', status: Universal.Status.CONNECT },
      ],
    },
    ensureEndpointRegistry: async () => undefined,
    noteEndpointConnection: (accountKey: string, online: boolean) => calls.push([accountKey, online]),
  }
  await (InterludeService.prototype as any).syncCurrentBotConnections.call(host)
  assert.deepEqual(calls, [
    ['onebot:100', true],
    ['onebot:200', false],
    ['onebot:300', false],
  ])
})

function row(partial: Partial<EndpointRow> & Pick<EndpointRow, 'ownerKind' | 'ownerId' | 'accountKey'>): EndpointRow {
  return {
    id: partial.id ?? 'ep-1', channelKind: 'qq', platform: 'onebot', selfId: '100',
    conversationKind: partial.ownerKind === 'group' ? 'group' : partial.ownerKind === 'participant-user' ? 'private' : undefined,
    enabled: true, createdAt: NOW, updatedAt: NOW,
    ...partial,
  } as EndpointRow
}

test('derive functions project legacy single-endpoint shapes without inventing ids', () => {
  const role = deriveStoryRoleEndpoint({ id: 's1', platform: 'onebot', selfId: '100' }, NOW)
  assert.equal(role.ownerKind, 'story-role')
  assert.equal(role.ownerId, 's1')
  assert.equal(role.accountKey, 'onebot:100')
  assert.equal(role.id, '', '持久化侧生成 UUID，派生函数不造主键')
  const user = deriveParticipantUserEndpoint({ id: 'p1', platform: 'onebot', selfId: '100', userId: '200' }, NOW)
  assert.equal(user.conversationKind, 'private')
  assert.equal(user.userId, '200')
  const group = deriveGroupEndpoint({ id: 's1', platform: 'onebot', selfId: '100' }, { groupId: '421430402' }, NOW)
  assert.equal(group.ownerKind, 'group')
  assert.equal(group.ownerId, '421430402')
  assert.equal(group.conversationKind, 'group')
})

test('endpointUniqueKey separates the three owner kinds', () => {
  assert.equal(endpointUniqueKey({ ownerKind: 'story-role', ownerId: 's1', accountKey: 'onebot:100' }), 'role:onebot:100')
  assert.equal(endpointUniqueKey({ ownerKind: 'participant-user', ownerId: 'p1', accountKey: 'onebot:100', userId: '200' }), 'user:p1:onebot:100:200')
  assert.equal(endpointUniqueKey({ ownerKind: 'group', ownerId: 'g1', accountKey: 'onebot:100', groupId: '777', channelId: 'c1' }), 'group:onebot:100:c1:777')
})

test('normalizeEndpointRow drops malformed rows and coerces optional fields', () => {
  assert.equal(normalizeEndpointRow(null), undefined)
  assert.equal(normalizeEndpointRow({ ownerKind: 'bogus', id: 'x', ownerId: 'y', accountKey: 'k' }), undefined)
  assert.equal(normalizeEndpointRow({ ownerKind: 'story-role', id: ' ', ownerId: 'y', accountKey: 'k' }), undefined)
  const ok = normalizeEndpointRow({ id: 'ep9', ownerKind: 'participant-user', ownerId: 'p1', accountKey: 'onebot:100', selfId: 100, userId: 200, enabled: false, createdAt: '2026-09-01T00:00:00Z' })
  assert.ok(ok)
  assert.equal(ok!.selfId, '100')
  assert.equal(ok!.userId, '200')
  assert.equal(ok!.enabled, false)
  assert.equal(ok!.conversationKind, 'private')
  assert.ok(ok!.createdAt instanceof Date)
})

test('resolveInboundEndpoint follows the v3 boundary rules', () => {
  const rows = [
    row({ id: 'role', ownerKind: 'story-role', ownerId: 's1', accountKey: 'onebot:100', selfId: '100' }),
    row({ id: 'user', ownerKind: 'participant-user', ownerId: 'p1', accountKey: 'onebot:100', selfId: '100', userId: '200' }),
    row({ id: 'group', ownerKind: 'group', ownerId: 'g1', accountKey: 'onebot:100', selfId: '100', groupId: '777' }),
    row({ id: 'off', ownerKind: 'participant-user', ownerId: 'p2', accountKey: 'onebot:100', selfId: '100', userId: '300', enabled: false }),
  ]
  const privateHit = resolveInboundEndpoint(rows, { platform: 'onebot', selfId: '100', userId: '200' })
  assert.equal(privateHit!.roleEndpoint.ownerId, 's1')
  assert.equal(privateHit!.userEndpoint!.ownerId, 'p1')
  const groupHit = resolveInboundEndpoint(rows, { platform: 'onebot', selfId: '100', groupId: '777' })
  assert.equal(groupHit!.groupEndpoint!.ownerId, 'g1')
  assert.equal(groupHit!.userEndpoint, undefined)
  // 陌生账号 → undefined（回落旧路径，绝不自动挂载）
  assert.equal(resolveInboundEndpoint(rows, { platform: 'onebot', selfId: '999' }), undefined)
  // 未注册 userId → 仅角色端点；停用端点不命中
  const stranger = resolveInboundEndpoint(rows, { platform: 'onebot', selfId: '100', userId: '404' })
  assert.equal(stranger!.userEndpoint, undefined)
  const disabled = resolveInboundEndpoint(rows, { platform: 'onebot', selfId: '100', userId: '300' })
  assert.equal(disabled!.userEndpoint, undefined)
})

test('channelContextMetadata carries the full disambiguated structure', () => {
  const endpoint = row({ ownerKind: 'group', ownerId: 'g1', accountKey: 'onebot:100', groupId: '777' })
  const meta = channelContextMetadata(endpoint, { groupId: '777', channelId: 'c9', userId: '' })
  assert.equal(meta.endpointId, 'ep-1')
  assert.equal(meta.channelKind, 'qq')
  assert.equal(meta.conversationKind, 'group')
  assert.equal(meta.accountKey, 'onebot:100')
  assert.equal(meta.groupId, '777')
  assert.equal(meta.channelId, 'c9')
  assert.equal('userId' in meta, false, '空 userId 不落键')
})

test('restoreEndpointState never restores online truth across a restart', () => {
  const now = 2_000_000
  const restored = restoreEndpointState('ep-restart', {
    endpointId: 'ep-restart',
    connection: { online: true, observedAt: now - 10_000 },
    deliverable: { allowed: true, checkedAt: now - 10_000, note: 'last-ok' },
    initiate: { allowed: true, observedAt: now - 10_000, expiresAt: now + 10_000 },
  }, now)
  assert.equal(restored.connection.online, false)
  assert.equal(restored.connection.observedAt, now)
  assert.equal(restored.deliverable.allowed, true, 'diagnostic delivery snapshot remains available')
  assert.equal(restored.deliverable.note, 'last-ok')
  assert.equal(restored.initiate?.allowed, true)
})

test('EndpointState is conservative: fresh/unknown, refreshed by inbound, cooled by failures, expired initiate', () => {
  const t0 = 1_000_000
  // 重启初值：一切按不可用
  const fresh = freshEndpointState('ep1', t0)
  assert.equal(isEndpointDeliverable(fresh, t0), false)
  assert.equal(isEndpointInitiateAllowed(fresh, t0), false)
  // 入站刷新：在线+可投递+主动资格恢复
  const inbound = stateAfterInbound({ ...fresh, initiate: { allowed: false, observedAt: t0 } }, t0 + 1_000)
  assert.equal(isEndpointDeliverable(inbound, t0 + 2_000), true)
  assert.equal(isEndpointInitiateAllowed(inbound, t0 + 2_000), true)
  // 出站失败进入冷却；冷却结束回到"在线即可重试"
  const failed = stateAfterOutbound(inbound, false, '风控', 60_000, t0 + 3_000)
  assert.equal(isEndpointDeliverable(failed, t0 + 30_000), false)
  assert.equal(isEndpointDeliverable(failed, t0 + 63_001), true)
  // token 过期即保守；断连覆盖一切
  const expired = { ...inbound, initiate: { allowed: true, observedAt: t0, expiresAt: t0 + 500 } }
  assert.equal(isEndpointInitiateAllowed(expired, t0 + 600), false)
  const offline = stateAfterConnection(inbound, false, t0 + 5_000)
  assert.equal(isEndpointDeliverable(offline, t0 + 5_001), false)
})

// ── M1a 等价性：迁移后单端点故事的解析结果与旧字段一一对应 ───────────────────

test('M1a migration derives endpoints that resolve identically to legacy fields', async () => {
  const tables: Record<string, unknown[]> = {
    interlude_story: [{ id: 's1', platform: 'onebot', selfId: '100', status: 'active' }],
    interlude_participant: [{ id: 'p1', storyId: 's1', platform: 'onebot', selfId: '100', userId: '200', status: 'active' }],
    interlude_endpoint: [],
    interlude_qzone_post: [],
  }
  const created: unknown[] = []
  const svc = {
    endpointRegistryReady: false,
    endpointRows: [] as EndpointRow[],
    endpointStates: new Map(),
    setEndpointState: function (id: string, state: unknown) { (this.endpointStates as Map<string, unknown>).set(id, state) },
    persistEndpointState: () => {},
    config: { onebot: { groupChats: [{ groupId: '777', enabled: true }] } },
    dbGet: async (table: string, query: Record<string, unknown>) => (tables[table] ?? []).filter(r => Object.entries(query).every(([k, v]) =>
      v && typeof v === 'object' && Array.isArray((v as any).$in)
        ? (v as any).$in.includes((r as any)[k])
        : (r as any)[k] === v)),
    dbCreate: async (table: string, data: unknown) => { created.push({ table, data }); (tables[table] ??= []).push(data); return data },
    reportStandaloneOperation: () => {},
  } as unknown as InterludeService
  const proto = InterludeService.prototype as unknown as Record<string, Function>
  ;(svc as any).ensureEndpointRegistry = proto.ensureEndpointRegistry.bind(svc)
  ;(svc as any).recordStoryAlias = proto.recordStoryAlias.bind(svc)
  ;(svc as any).reconcileEndpointRegistry = proto.reconcileEndpointRegistry.bind(svc)
  ;(svc as any).backfillQzoneEndpointIds = proto.backfillQzoneEndpointIds.bind(svc)
  const priv = (InterludeService.prototype as unknown as { resolveInboundEndpointFor: Function })
  // 首次解析触发幂等迁移
  const hit = await priv.resolveInboundEndpointFor.call(svc, { platform: 'onebot', selfId: '100', userId: '200' })
  assert.equal(hit.roleEndpoint.ownerId, 's1', '角色端点归属 = 旧 story.id')
  assert.equal(hit.userEndpoint!.ownerId, 'p1', '用户端点归属 = 旧 participant.id')
  // 群端点来自群规则派生
  const groupHit = await priv.resolveInboundEndpointFor.call(svc, { platform: 'onebot', selfId: '100', groupId: '777' })
  assert.equal(groupHit.groupEndpoint!.ownerId, '777')
  // 等价性：旧字段能推出的归属，解析层逐一命中；陌生账号回落 undefined
  assert.equal(await priv.resolveInboundEndpointFor.call(svc, { platform: 'onebot', selfId: '404', userId: '200' }), undefined)
  // 幂等：再次触达不重复建行
  const before = created.length
  await priv.resolveInboundEndpointFor.call(svc, { platform: 'onebot', selfId: '100', userId: '200' })
  assert.equal(created.length, before, '重复迁移零新增')
})

// ── M1a 收尾：出站收口点的注册表等价性（路径 1-3/4/6/7 共用收口）────────────

test('findBotForParticipant resolves via registry with legacy equivalence and drift-warns once', async () => {
  const proto = InterludeService.prototype as unknown as Record<string, Function>
  const bots = [
    { selfId: '100', platform: 'onebot', tag: 'legacy-account' },
    { selfId: '999', platform: 'onebot', tag: 'registry-account' },
  ]
  const participant = { id: 'p1', platform: 'onebot', selfId: '100', userId: '200' }
  const base = (rows: EndpointRow[], ready = true) => ({
    ctx: { bots },
    endpointRegistryReady: ready,
    endpointRows: rows,
    endpointDriftWarned: new Set<string>(),
    reportStandalone: (...args: unknown[]) => { (warnings as unknown[]).push(args) },
  })
  let warnings: unknown[] = []
  const userRow = row({ id: 'ep-u1', ownerKind: 'participant-user', ownerId: 'p1', accountKey: 'onebot:100', selfId: '100', userId: '200' })
  const bindResolver = (svc: object) => { (svc as any).endpointAddressSync = proto.endpointAddressSync.bind(svc); return svc }
  // 等价：注册表与旧字段一致 → 与旧实现同一 bot
  const agree = proto.findBotForParticipant.call(bindResolver(base([userRow])), participant)
  assert.equal((agree as any).tag, 'legacy-account')
  // 冷注册表 → 回落旧字段（单平台零影响）
  const cold = proto.findBotForParticipant.call(bindResolver(base([], false)), participant)
  assert.equal((cold as any).tag, 'legacy-account')
  // 漂移：注册表地址优先 + 只告警一次
  warnings = []
  const drifted = row({ ...userRow, id: 'ep-u2', selfId: '999', accountKey: 'onebot:999' })
  const svc = bindResolver(base([drifted]))
  assert.equal((proto.findBotForParticipant.call(svc, participant) as any).tag, 'registry-account')
  assert.equal((proto.findBotForParticipant.call(svc, participant) as any).tag, 'registry-account')
  assert.equal(warnings.length, 1, '同一漂移只告警一次')
})

test('canHandleStory whitelist judgment uses the registry-resolved account', async () => {
  const proto = InterludeService.prototype as unknown as Record<string, Function>
  const userRow = row({ ownerKind: 'story-role', ownerId: 's1', accountKey: 'onebot:100', selfId: '100' })
  const svc = {
    config: { onebot: { enabled: true, botAccounts: [{ qq: '100', label: '', enabled: true }] } },
    endpointRegistryReady: true,
    endpointRows: [userRow],
    endpointDriftWarned: new Set<string>(),
    reportStandalone: () => {},
  }
  ;(svc as any).endpointAddressSync = proto.endpointAddressSync.bind(svc)
  const story = { id: 's1', platform: 'onebot', selfId: '100' }
  assert.equal(proto.canHandleStory.call(svc, story), true)
  // 注册表漂移到未白名单账号 → 以注册表为准判定为不可处理
  const drifted = row({ ownerKind: 'story-role', ownerId: 's1', accountKey: 'onebot:999', selfId: '999' })
  ;(svc as any).endpointRows = [drifted]
  assert.equal(proto.canHandleStory.call(svc, story), false)
})

// ── M2 验收测试（§1.2/§1.3/§1.4）────────────────────────────────────────────

test('M2-1.4: channelKindForAccount 按注册表判别，未注册默认 qq', async () => {
  const { channelKindForAccount } = await import('../src/endpoints')
  const qq = row({ ownerKind: 'story-role', ownerId: 's1', accountKey: 'onebot:100', selfId: '100' })
  const wx = row({ ownerKind: 'story-role', ownerId: 's2', accountKey: 'onebot:200', selfId: '200', channelKind: 'wechat' as never })
  const rows = [qq, wx]
  assert.equal(channelKindForAccount(rows, 'onebot:100'), 'qq')
  assert.equal(channelKindForAccount(rows, 'onebot:200'), 'wechat')
  assert.equal(channelKindForAccount(rows, 'onebot:999'), 'qq', '未注册默认 qq')
})

test('M2-1.3: recordSource 追加端点并按接收序号排序', async () => {
  const { createTurnEngine } = await import('../src/turn-engine')
  const engine = createTurnEngine({ setTimeout: (fn: () => void) => { return () => {} }, userMessageDebounceSeconds: 2, reportOperation: () => {} })
  const session = { content: 'hi' } as any
  const story = { id: 's1' } as any
  const participant = { id: 'p1' } as any
  engine.bufferUserNarrative(story, participant, session, new Date(), [], 'hi', [], [], undefined, () => {})
  engine.recordSource('p1', 'ep-qq', 5)
  engine.recordSource('p1', 'ep-wechat', 3)  // 先收但后记录——按 receivedSeq 排序
  const turn = engine.getTurn('p1')!
  assert.deepEqual(turn.sources, [
    { endpointId: 'ep-wechat', receivedSeq: 3 },
    { endpointId: 'ep-qq', receivedSeq: 5 },
  ], 'sources 按接收序号有序')
  // 重复端点不追加
  engine.recordSource('p1', 'ep-qq', 7)
  assert.equal(turn.sources.length, 2, '重复端点幂等')
})

test('M2-1.2: sameParticipantEndpoint 冷注册表回落旧字段（单平台等价）', async () => {
  const proto = InterludeService.prototype as unknown as Record<string, Function>
  const participant = { id: 'p3', storyId: 's1', platform: 'onebot', selfId: '100', userId: 'legacy_user', displayName: '测试' }
  const svc = {
    // activeServiceForEndpoints 为 null（构造器未跑）→ sameParticipantEndpoint 走旧字段
    findStory: async () => ({ id: 's1' }),
    resolveInboundEndpointFor: async () => undefined,
    getParticipant: async (id: string) => id === 'p3' ? participant : undefined,
    dbGet: async () => [participant],
  } as unknown as InterludeService
  // 旧字段命中
  const found = await proto.findParticipant.call(svc, { platform: 'onebot', selfId: '100', userId: 'legacy_user' })
  assert.equal(found?.id, 'p3', '冷注册表回落旧字段比对')
  // 旧字段不命中（第二端点）→ undefined（集合匹配需真实 service 实例，由实机验收覆盖）
  const notFound = await proto.findParticipant.call(svc, { platform: 'onebot', selfId: '300', userId: 'wx_9' })
  assert.equal(notFound, undefined, '冷注册表下第二端点不误匹配')
})

// ── M3 验收（§八：出站端点 + 主动渠道选择）──────────────────────────────────

test('M3: resolveMostActiveEndpointId 选最近在线端点，无在线取首个启用', async () => {
  const proto = InterludeService.prototype as unknown as Record<string, Function>
  const now = Date.now()
  const svc = {
    endpointRows: [
      row({ id: 'ep-a', ownerKind: 'participant-user', ownerId: 'p1', accountKey: 'onebot:100', selfId: '100', userId: '200', enabled: true }),
      row({ id: 'ep-b', ownerKind: 'participant-user', ownerId: 'p1', accountKey: 'onebot:300', selfId: '300', userId: 'wx_9', enabled: true }),
      row({ id: 'ep-c', ownerKind: 'participant-user', ownerId: 'p1', accountKey: 'onebot:400', selfId: '400', userId: 'wx_10', enabled: false }),
    ],
    endpointStates: new Map([
      ['ep-a', { endpointId: 'ep-a', connection: { online: true, observedAt: now - 1000 }, deliverable: { allowed: true, checkedAt: now } }],
      ['ep-b', { endpointId: 'ep-b', connection: { online: true, observedAt: now }, deliverable: { allowed: true, checkedAt: now } }],
      // ep-c disabled，不参与
    ]),
  } as unknown as InterludeService
  // ep-b 最近活跃 → 选中
  assert.equal((proto as any).resolveMostActiveEndpointId.call(svc, 'p1'), 'ep-b', '最近在线端点')
  // 全部离线 → 取首个启用（ep-a）
  ;(svc as any).endpointStates.get('ep-b').connection.online = false
  assert.equal((proto as any).resolveMostActiveEndpointId.call(svc, 'p1'), 'ep-a', '无在线取首个启用')
  // 无端点 → undefined
  assert.equal((proto as any).resolveMostActiveEndpointId.call(svc, 'p999'), undefined)
})

test('M3: appendProactiveContact 携带 endpointId 并保留审计窗口', async () => {
  const { appendProactiveContact } = await import('../src/story-state')
  const now = new Date()
  const log1 = appendProactiveContact(undefined, 'p1', now, 'ep-qq')
  assert.equal(log1.length, 1)
  assert.equal(log1[0].endpointId, 'ep-qq')
  const log2 = appendProactiveContact(log1, 'p2', now)  // 无 endpointId
  assert.equal(log2.length, 2)
  assert.equal(log2[1].endpointId, undefined, '无端点时不落键')
  // 滚动窗口 20 条
  let log = log2
  for (let i = 0; i < 25; i++) log = appendProactiveContact(log, 'px', now, 'ep-x')
  assert.equal(log.length, 20)
  assert.equal(log[0].participantId, 'px', '窗口滚动丢弃最旧')
})

// ── M4 验收（§十：确定性标注 + CHANNELS 规则行）────────────────────────────

test('M4: projectChannelContext 五规则命中即标，不命中不标', async () => {
  const { projectChannelContext } = await import('../src/script/context-compiler')

  // 无通道数据 → 不标注
  assert.equal(projectChannelContext({}), undefined)

  // 规则 1：回合内端点切换（多端点 sources）
  const multi = projectChannelContext({
    _channelTurnSources: [
      { endpointId: 'ep-qq', channelKind: 'qq', receivedSeq: 1 },
      { endpointId: 'ep-wx', channelKind: 'wechat', receivedSeq: 2 },
    ],
    _channelCurrentChannel: { endpointId: 'ep-wx', channelKind: 'wechat', conversationKind: 'private' },
  })
  assert.ok(multi, '多端点回合必须标注')
  assert.ok(multi.rules.includes('multi-endpoint-turn'), '规则1命中')
  assert.equal(multi.sources.length, 2)
  assert.equal(multi.tag, '[微信·私]', '简短标记格式正确')

  // 规则 3：私聊↔群聊切换
  const switch_ = projectChannelContext({
    _channelTurnSources: [{ endpointId: 'ep-qq', channelKind: 'qq', receivedSeq: 4 }],
    _channelLastEntryChannel: { conversationKind: 'private' },
    _channelCurrentChannel: { conversationKind: 'group', channelKind: 'qq' },
  })
  assert.ok(switch_?.rules.includes('conversation-kind-switch'), '规则3命中')
  assert.equal(switch_.tag, '[QQ·群]')
  assert.deepEqual(switch_.sources, [{ endpointId: 'ep-qq', channelKind: 'qq', receivedSeq: 4 }], '其他规则命中时仍保留来源端点集')

  // 规则 4：同一参与者不同端点连续
  const pSwitch = projectChannelContext({
    _channelLastEntryChannel: { endpointId: 'ep-a' },
    _channelCurrentChannel: { endpointId: 'ep-b', channelKind: 'qq', conversationKind: 'private' },
    currentParticipant: { id: 'p1' },
  })
  assert.ok(pSwitch?.rules.includes('participant-endpoint-switch'), '规则4命中')

  // 规则 5：回复目标 ≠ 来源端点
  const replyDiff = projectChannelContext({
    _channelCurrentChannel: { endpointId: 'ep-a', channelKind: 'qq', conversationKind: 'private' },
    _channelReplyEndpoint: { endpointId: 'ep-b' },
  })
  assert.ok(replyDiff?.rules.includes('reply-target-differs'), '规则5命中')

  // 规则 2 is independent: multiple turn sources alone means rule 1, while
  // the batch flag is required for the same-batch annotation.
  const turnOnly = projectChannelContext({
    _channelTurnSources: [
      { endpointId: 'ep-a', channelKind: 'qq', receivedSeq: 1 },
      { endpointId: 'ep-b', channelKind: 'wechat', receivedSeq: 2 },
    ],
    _channelCurrentChannel: { endpointId: 'ep-b', channelKind: 'wechat', conversationKind: 'private' },
  })
  assert.ok(turnOnly)
  assert.ok(turnOnly.rules.includes('multi-endpoint-turn'))
  assert.equal(turnOnly.rules.includes('batch-multi-endpoint'), false)
  const batchOnly = projectChannelContext({
    _channelTurnSources: [{ endpointId: 'ep-a', channelKind: 'qq', receivedSeq: 1 }],
    _channelBatchMultiEndpoint: true,
    _channelCurrentChannel: { endpointId: 'ep-a', channelKind: 'qq', conversationKind: 'private' },
  })
  assert.ok(batchOnly?.rules.includes('batch-multi-endpoint'))
})

test('M4: narrator 提示词含 CHANNELS 规则行', async () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/narrator.ts'), 'utf8')
  assert.ok(src.includes('CHANNELS (writer rule):'), 'CHANNELS 常设行存在')
  assert.ok(src.includes('Do not send the same content on both platforms'), '不同平台不重复内容')
})

test('M3: narrator channel selection is enabled only for multi-platform target choices', () => {
  const select = (InterludeService.prototype as any).narrativeEndpointSelection
  const story = { id: 'story-1' }
  const participant = { id: 'person-1' }
  const rows = [
    { id: 'role-qq', ownerKind: 'story-role', ownerId: 'story-1', accountKey: 'onebot:100', channelKind: 'qq', enabled: true },
    { id: 'user-qq', ownerKind: 'participant-user', ownerId: 'person-1', channelKind: 'qq', enabled: true },
    { id: 'user-wx', ownerKind: 'participant-user', ownerId: 'person-1', channelKind: 'wechat', enabled: true },
  ]
  const states = new Map([
    ['user-qq', { connection: { online: true } }],
    ['user-wx', { connection: { online: false } }],
  ])
  const host = { endpointRows: rows, endpointStates: states }
  const multi = select.call(host, story, [participant], [])
  assert.equal(multi.enabled, true)
  assert.deepEqual(multi.options.map((item: any) => item.endpointId), ['user-qq', 'user-wx'])
  assert.equal(multi.options[1].online, false)

  const single = select.call({ endpointRows: rows.filter(row => row.channelKind === 'qq'), endpointStates: states }, story, [participant], [])
  assert.equal(single.enabled, false)
  assert.deepEqual(single.options, [])
})
