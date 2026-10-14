/**
 * 端点注册表（M1a）——单剧本多通道设计的身份与地址层。
 *
 * 设计规格：docs/MULTI_CHANNEL_SINGLE_STORY_DESIGN.md（v3）第二/三/四节。
 * 纯策略模块（与 group-willingness / qzone 同构）：本文件无 IO、无副作用，
 * 状态由 service 持有（interlude_endpoint 表 + 内存 EndpointState）。
 *
 * 单平台零影响纪律：M1a 只建表、派生端点行、并轨解析与元数据标注——
 * 现有查找/投递/回合路径不动；注册表只有派生单端点时，一切解析结果
 * 必须与旧字段逐字节一致（equivalence 测试锚定）。
 */

export type EndpointChannelKind = 'qq' | 'wechat'
export type EndpointOwnerKind = 'story-role' | 'participant-user' | 'group'

/** 身份与地址分离：主键是持久随机 ID；账号/对端标识是可变字段。 */
export interface EndpointDescriptor {
  id: string
  ownerKind: EndpointOwnerKind
  ownerId: string
  channelKind: EndpointChannelKind
  platform: string
  /** 角色账号绑定键（onebot:<selfId>；原生通道自定义）。 */
  accountKey: string
  selfId: string
  /** 用户端点专有：对端账号。 */
  userId?: string
  /** 群端点专有。 */
  channelId?: string
  groupId?: string
  conversationKind?: 'private' | 'group'
}

/** interlude_endpoint 持久行：描述符 + 管理配置（enabled 与动态状态分离）。 */
export interface EndpointRow extends EndpointDescriptor {
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

/** onebot 家族判定（与 service.ts isOneBotPlatform 同语义的镜像副本——
 *  endpoints.ts 不得反向 import service，保持两处同步）。 */
function isOneBotFamilyPlatform(platform: string) {
  const value = String(platform ?? '').toLowerCase()
  return value === 'onebot' || value.startsWith('onebot:')
    || value === 'napcat' || value.startsWith('napcat:')
    || value === 'qq:onebot' || value.startsWith('qq:onebot:')
}

/**
 * 平台隔离的账号键：onebot 家族折叠到 `onebot:` 前缀（历史行不变），
 * 原生平台（wechat 等）用专属前缀——不同平台同 selfId 不再碰撞。键本身已
 * 编码平台族，解析时的平台校验由键匹配隐式完成（比逐字段比对更严）。
 */
export function endpointAccountKey(platform: string, selfId: string) {
  const account = String(selfId || '').trim()
  return isOneBotFamilyPlatform(platform) ? `onebot:${account}` : `${String(platform || '').toLowerCase()}:${account}`
}

/** 唯一键（非主键）：注册表防重复约束。地址可变，键随之校验，但主键不变。 */
export function endpointUniqueKey(row: Pick<EndpointDescriptor, 'ownerKind' | 'ownerId' | 'accountKey' | 'userId' | 'channelId' | 'groupId'>): string {
  if (row.ownerKind === 'story-role') return `role:${row.accountKey}`
  if (row.ownerKind === 'participant-user') return `user:${row.ownerId}:${row.accountKey}:${row.userId ?? ''}`
  return `group:${row.accountKey}:${row.channelId ?? ''}:${row.groupId ?? ''}`
}

/** 迁移派生：旧故事的单一角色端点（channelKind 默认 qq——onebots 别名覆盖层随 M2 接入）。 */
export function deriveStoryRoleEndpoint(story: { id: string, platform: string, selfId: string }, now = new Date()): EndpointRow {
  return {
    id: '', // 由持久化侧生成 UUID；派生函数不造主键
    ownerKind: 'story-role', ownerId: story.id,
    channelKind: 'qq', platform: story.platform,
    accountKey: endpointAccountKey(story.platform, story.selfId), selfId: String(story.selfId ?? ''),
    conversationKind: undefined,
    enabled: true, createdAt: now, updatedAt: now,
  }
}

/** 迁移派生：旧参与者的单一用户端点。 */
export function deriveParticipantUserEndpoint(participant: { id: string, platform: string, selfId: string, userId: string }, now = new Date()): EndpointRow {
  return {
    id: '',
    ownerKind: 'participant-user', ownerId: participant.id,
    channelKind: 'qq', platform: participant.platform,
    accountKey: endpointAccountKey(participant.platform, participant.selfId),
    selfId: String(participant.selfId ?? ''), userId: String(participant.userId ?? ''),
    conversationKind: 'private',
    enabled: true, createdAt: now, updatedAt: now,
  }
}

/** 群号归一化（与 service.ts normalizeGroupId 同语义镜像）：配置写 `group:123`
 * 或 `guild:123` 时与裸群号等价——派生与解析双侧都过这层，避免配置形态差异
 * 导致群端点永不命中。 */
function normalizedGroupId(value: string) {
  return String(value ?? '').trim().replace(/^(?:group|guild):/i, '')
}

/** 迁移派生：群规则的群端点。群端点独立于私聊参与者，群规则是唯一配置来源。 */
export function deriveGroupEndpoint(story: { id: string, platform: string, selfId: string }, rule: { groupId: string }, now = new Date()): EndpointRow {
  return {
    id: '',
    ownerKind: 'group', ownerId: normalizedGroupId(rule.groupId),
    channelKind: 'qq', platform: story.platform,
    accountKey: endpointAccountKey(story.platform, story.selfId),
    selfId: String(story.selfId ?? ''), groupId: normalizedGroupId(rule.groupId),
    conversationKind: 'group',
    enabled: true, createdAt: now, updatedAt: now,
  }
}

/** 防御性归一化：坏行丢弃（undefined）。 */
export function normalizeEndpointRow(raw: unknown): EndpointRow | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const ownerKind = String(row.ownerKind ?? '')
  if (ownerKind !== 'story-role' && ownerKind !== 'participant-user' && ownerKind !== 'group') return undefined
  const id = String(row.id ?? '').trim()
  const accountKey = String(row.accountKey ?? '').trim()
  const ownerId = String(row.ownerId ?? '').trim()
  if (!id || !accountKey || !ownerId) return undefined
  const channelKind = row.channelKind === 'wechat' ? 'wechat' : 'qq'
  return {
    id, ownerKind, ownerId, channelKind,
    platform: String(row.platform ?? 'onebot'),
    accountKey, selfId: String(row.selfId ?? ''),
    ...(row.userId !== undefined && row.userId !== null && String(row.userId) !== '' ? { userId: String(row.userId) } : {}),
    ...(row.channelId !== undefined && row.channelId !== null && String(row.channelId) !== '' ? { channelId: String(row.channelId) } : {}),
    ...(row.groupId !== undefined && row.groupId !== null && String(row.groupId) !== '' ? { groupId: String(row.groupId) } : {}),
    conversationKind: row.conversationKind === 'group' ? 'group' : row.conversationKind === 'private' ? 'private' : ownerKind === 'group' ? 'group' : ownerKind === 'participant-user' ? 'private' : undefined,
    enabled: row.enabled !== false,
    createdAt: toDateValue(row.createdAt),
    updatedAt: toDateValue(row.updatedAt),
  }
}

function toDateValue(value: unknown) {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') return new Date(value)
  return new Date()
}

// ── 入站反向解析（v3 §三）：accountKey → 端点行 → 故事，先于 story 查询 ───────

export interface InboundSource {
  platform: string
  selfId: string
  /** 私聊对端；群消息可缺省。 */
  userId?: string
  groupId?: string
  channelId?: string
}

export interface InboundResolution {
  /** 命中的角色端点（其 ownerId 即 storyId）。 */
  roleEndpoint: EndpointRow
  /** 命中的用户端点（陌生 userId 时为 undefined——调用方走既有新参与者路径）。 */
  userEndpoint?: EndpointRow
  /** 群消息时命中的群端点。 */
  groupEndpoint?: EndpointRow
  /** 同 accountKey 存在多行角色端点（脏数据）——调用方需一次性告警。 */
  duplicateRoleAccountKeys?: string[]
}

/**
 * 入站解析（纯函数）。边界行为（v3 §三表）：
 * accountKey 未注册 → undefined（调用方回落旧路径，绝不自动挂载）；
 * 重复行 → 首行生效（持久层另有唯一约束，此处兜底）；
 * 用户端点未命中 → 仅返回角色端点，userEndpoint 缺省。
 */
export function resolveInboundEndpoint(rows: ReadonlyArray<EndpointRow>, source: InboundSource): InboundResolution | undefined {
  const accountKey = endpointAccountKey(source.platform, source.selfId)
  const roleMatches = rows.filter(row => row.ownerKind === 'story-role' && row.accountKey === accountKey && row.enabled)
  const roleEndpoint = roleMatches[0]
  if (!roleEndpoint) return undefined
  const resolution: InboundResolution = { roleEndpoint }
  // 重复角色端点是脏数据——不再静默取首行，暴露给调用方告警。
  if (roleMatches.length > 1) resolution.duplicateRoleAccountKeys = [accountKey]
  if (source.groupId) {
    const groupId = normalizedGroupId(String(source.groupId))
    const groupEndpoint = rows.find(row => row.ownerKind === 'group' && row.accountKey === accountKey
      && row.groupId === groupId && row.enabled)
    if (groupEndpoint) resolution.groupEndpoint = groupEndpoint
  } else if (source.userId) {
    const userEndpoint = rows.find(row => row.ownerKind === 'participant-user' && row.accountKey === accountKey
      && row.userId === String(source.userId) && row.enabled)
    if (userEndpoint) resolution.userEndpoint = userEndpoint
  }
  return resolution
}

/** 条目通道上下文（v3 §十）：消除 kind 双义的完整结构。 */
export function channelContextMetadata(endpoint: EndpointDescriptor, extra: { userId?: string, groupId?: string, channelId?: string } = {}) {
  return {
    endpointId: endpoint.id,
    channelKind: endpoint.channelKind,
    platform: endpoint.platform,
    accountKey: endpoint.accountKey,
    selfId: endpoint.selfId,
    conversationKind: endpoint.conversationKind ?? (endpoint.ownerKind === 'group' ? 'group' : 'private'),
    ...(extra.channelId !== undefined && extra.channelId !== '' ? { channelId: extra.channelId } : {}),
    ...(extra.userId !== undefined && extra.userId !== '' ? { userId: extra.userId } : {}),
    ...(extra.groupId !== undefined && extra.groupId !== '' ? { groupId: extra.groupId } : {}),
  }
}

// ── EndpointState（v3 §四）：三维时效，过期即保守 ─────────────────────────────

export interface EndpointState {
  endpointId: string
  connection: { online: boolean, observedAt: number }
  deliverable: { allowed: boolean, checkedAt: number, cooldownUntil?: number, note?: string }
  initiate?: { allowed: boolean, observedAt: number, expiresAt?: number, reason?: string }
}

/** interlude_endpoint_state 持久快照。动态状态写入独立表，避免污染身份注册表。 */
export interface EndpointStateRecord {
  endpointId: string
  state: EndpointState
  updatedAt: Date
}

function finiteTimestamp(value: unknown, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** 防御性读取持久快照；坏快照不会阻塞端点注册表启动。 */
export function normalizeEndpointState(raw: unknown, endpointId?: string): EndpointState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const source = row.state && typeof row.state === 'object' ? row.state as Record<string, unknown> : row
  const id = String(endpointId ?? source.endpointId ?? row.endpointId ?? '').trim()
  if (!id) return undefined
  const connection = source.connection && typeof source.connection === 'object' ? source.connection as Record<string, unknown> : {}
  const deliverable = source.deliverable && typeof source.deliverable === 'object' ? source.deliverable as Record<string, unknown> : {}
  const initiate = source.initiate && typeof source.initiate === 'object' ? source.initiate as Record<string, unknown> : undefined
  const now = Date.now()
  const state: EndpointState = {
    endpointId: id,
    connection: {
      online: connection.online === true,
      observedAt: finiteTimestamp(connection.observedAt, now),
    },
    deliverable: {
      allowed: deliverable.allowed === true,
      checkedAt: finiteTimestamp(deliverable.checkedAt, now),
      ...(Number.isFinite(Number(deliverable.cooldownUntil)) ? { cooldownUntil: Number(deliverable.cooldownUntil) } : {}),
      ...(typeof deliverable.note === 'string' && deliverable.note ? { note: deliverable.note.slice(0, 500) } : {}),
    },
    ...(initiate ? {
      initiate: {
        allowed: initiate.allowed === true,
        observedAt: finiteTimestamp(initiate.observedAt, now),
        ...(Number.isFinite(Number(initiate.expiresAt)) ? { expiresAt: Number(initiate.expiresAt) } : {}),
        ...(typeof initiate.reason === 'string' && initiate.reason ? { reason: initiate.reason.slice(0, 500) } : {}),
      },
    } : {}),
  }
  return state
}

/** Restart recovery keeps diagnostic observations but never restores live connection truth. */
export function restoreEndpointState(endpointId: string, snapshot: EndpointState | undefined, now = Date.now()): EndpointState {
  const state = snapshot ? normalizeEndpointState(snapshot, endpointId) : undefined
  if (!state) return freshEndpointState(endpointId, now)
  return {
    ...state,
    endpointId,
    connection: { online: false, observedAt: now },
    deliverable: { ...state.deliverable, note: state.deliverable.note ?? 'restart-awaiting-connection' },
  }
}

/** 进程重启后的保守初值：一切未知按不可用处理，待连接器/首次投递/入站恢复。 */
export function freshEndpointState(endpointId: string, now = Date.now()): EndpointState {
  return {
    endpointId,
    connection: { online: false, observedAt: now },
    deliverable: { allowed: false, checkedAt: now, note: 'fresh-start' },
  }
}

export function stateAfterConnection(state: EndpointState, online: boolean, now = Date.now()): EndpointState {
  return { ...state, connection: { online, observedAt: now } }
}

export function stateAfterInbound(state: EndpointState, now = Date.now()): EndpointState {
  // 入站即证明连接在线；微信 context_token 也随有效入站刷新。
  // 但"收到消息"不等于"可发出消息"——出站失败冷却(cooldownUntil)必须保留,
  // 否则同账号任一无关入站(如同群任何人发言)都会清零 5 分钟冷却,风控中的
  // 端点被高频重试。冷却到期后 isEndpointDeliverable 自然放行。
  const cooldown = state.deliverable?.cooldownUntil
  const cooldownActive = cooldown != null && now < cooldown
  return {
    ...state,
    connection: { online: true, observedAt: now },
    deliverable: cooldownActive
      ? { ...state.deliverable, checkedAt: now }
      : { allowed: true, checkedAt: now },
    ...(state.initiate && !cooldownActive ? { initiate: { ...state.initiate, allowed: true, observedAt: now } } : {}),
  }
}

export function stateAfterOutbound(state: EndpointState, ok: boolean, note: string, cooldownMs = 0, now = Date.now()): EndpointState {
  return {
    ...state,
    deliverable: ok
      ? { allowed: true, checkedAt: now }
      : { allowed: false, checkedAt: now, ...(cooldownMs > 0 ? { cooldownUntil: now + cooldownMs } : {}), note },
  }
}

/** deliverable 确认的保质期：超过 TTL 的 allowed 按未知处理。
 *  QQ/OneBot 在线端点允许实际投递探测，避免过期门控阻止出站刷新；
 *  其它通道保持保守。重启快照仍须经过当前连接器的在线事实确认。 */
export const ENDPOINT_DELIVERABLE_TTL_MS = 24 * 3_600_000

/** 返回是否可尝试投递，不代表投递成功；失败冷却与通道主动联系限制独立生效。
 * ignoreCooldown 供用户触发回复豁免冷却（一次网络抖动不该让该参与者已读不回
 * 5 分钟）；冷却的防轰炸语义只针对后台/主动重试路径。 */
export function isEndpointDeliverable(
  state: EndpointState | undefined,
  now = Date.now(),
  endpoint?: Pick<EndpointDescriptor, 'channelKind' | 'platform'>,
  options?: { ignoreCooldown?: boolean },
): boolean {
  if (!state) return false
  if (state.connection.online === false) return false
  if (state.deliverable.cooldownUntil && now < state.deliverable.cooldownUntil && !options?.ignoreCooldown) return false
  if (state.deliverable.allowed) {
    // A stale observation is not a new success. Only QQ/OneBot may probe it;
    // the existing outbound result handler refreshes success or starts cooldown.
    return now - state.deliverable.checkedAt <= ENDPOINT_DELIVERABLE_TTL_MS
      || endpoint?.channelKind === 'qq' && isOneBotFamilyPlatform(endpoint.platform)
  }
  if (state.deliverable.cooldownUntil) return now >= state.deliverable.cooldownUntil || options?.ignoreCooldown === true
  // A connector lifecycle event is enough to make a freshly started endpoint
  // eligible for its first probe.  Without this exception the M3 gate would
  // deadlock: the first outbound could never refresh deliverable because the
  // gate required a previous outbound observation.  Explicit failures still
  // remain blocked unless their cooldown has elapsed.
  return state.deliverable.note === 'fresh-start'
    || state.deliverable.note === 'restart-awaiting-connection'
}

/** token 过期按不允许保守处理；重新获得有效信号（入站/探测）即恢复。 */
export function isEndpointInitiateAllowed(state: EndpointState | undefined, now = Date.now()): boolean {
  if (!state?.initiate) return false
  if (state.initiate.expiresAt !== undefined && now >= state.initiate.expiresAt) return false
  return state.initiate.allowed
}

// ── 剧本别名（M1b）：推导 ID → 稳定剧本 ID 的持久重定向 ──────────────────────

/** interlude_story_alias 持久行。回滚 = 删除行；行本身即审计（reason + 时间）。 */
export interface StoryAliasRecord {
  aliasStoryId: string
  canonicalStoryId: string
  reason: string
  createdAt: Date
}

export function normalizeStoryAliasRow(raw: unknown): StoryAliasRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const aliasStoryId = String(row.aliasStoryId ?? '').trim()
  const canonicalStoryId = String(row.canonicalStoryId ?? '').trim()
  if (!aliasStoryId || !canonicalStoryId || aliasStoryId === canonicalStoryId) return undefined
  return {
    aliasStoryId, canonicalStoryId,
    reason: String(row.reason ?? '').slice(0, 255),
    createdAt: row.createdAt instanceof Date ? row.createdAt
      : typeof row.createdAt === 'string' || typeof row.createdAt === 'number' ? new Date(row.createdAt)
        : new Date(),
  }
}

export interface StoryAliasResolution {
  canonicalStoryId?: string
  /** chain=别名指向的 canonical 又是另一行的别名（双射校验失败，需人工裁决）。 */
  problem?: 'chain'
}

/**
 * 别名解析（纯函数）：命中返回 canonical；链式（canonical 自身也是别名）返回
 * problem='chain'——不跟随多跳，把裁决留给人。悬空（canonical 无对应故事）由
 * 调用方查库后判定（持久层职责）。
 */
export function resolveStoryAlias(rows: ReadonlyArray<StoryAliasRecord>, aliasStoryId: string): StoryAliasResolution {
  const row = rows.find(item => item.aliasStoryId === aliasStoryId)
  if (!row) return {}
  if (rows.some(item => item.aliasStoryId === row.canonicalStoryId)) return { problem: 'chain' }
  return { canonicalStoryId: row.canonicalStoryId }
}
/** M2 §1.4：按 accountKey 查注册表判别通道类型——onebots 别名路线的唯一判别依据。
 * 未注册默认 qq（M2 内全部为 qq；微信接入时注册表行带 wechat 标签即自动切换）。 */
export function channelKindForAccount(rows: ReadonlyArray<EndpointRow>, accountKey: string): 'qq' | 'wechat' {
  const row = rows.find(item => item.accountKey === accountKey && item.enabled)
  return row?.channelKind === 'wechat' ? 'wechat' : 'qq'
}
