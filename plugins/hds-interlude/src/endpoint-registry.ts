/** 端点注册表接线层（M1a）：加载/补齐/迁移端点行与别名、三维时效状态
 * （连接/可投递/主动联系）的观测与门控、出站地址解析、端点写队列串行化、
 * 入站反向解析封装与用户/角色端点链接管理。纯策略与表结构在 endpoints.ts
 * （规格：docs/MULTI_CHANNEL_SINGLE_STORY_DESIGN.md v3）。
 *
 * P4 自 service.ts 迁出（2026-10-29），行为不变。函数接收宿主（service 实例
 * 或测试假宿主）为第一参数——与 delivery/pipeline.ts、qzone-executor.ts 同一
 * 形态；service.ts 保留同名薄委托，既有调用点（含 index.ts 管理命令）与测试
 * 零改动。单平台零影响纪律：注册表未命中一律回落旧路径，绝不自动挂载。 */
import { endpointAccountKey, freshEndpointState, stateAfterConnection, stateAfterInbound, stateAfterOutbound, restoreEndpointState, normalizeEndpointRow, normalizeStoryAliasRow, resolveInboundEndpoint, resolveStoryAlias, deriveGroupEndpoint, deriveParticipantUserEndpoint, deriveStoryRoleEndpoint, endpointUniqueKey, channelContextMetadata, isEndpointDeliverable, isEndpointInitiateAllowed, normalizeEndpointState, type EndpointRow, type EndpointState, type StoryAliasRecord, type EndpointChannelKind } from './endpoints'
import { isBotOnlineStatus, normalizeGroupId, storyIdForCharacter } from './session-platform'
import { randomUUID } from 'node:crypto'


import type { InterludeParticipant, InterludeStory, NarrativeEndpointOption } from './types'

/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function enqueueEndpointWrite<T>(svc: any, task: () => Promise<T>) {
    const run = (svc.endpointWriteQueue ?? Promise.resolve()).then(task, task)
    svc.endpointWriteQueue = run.then((): undefined => undefined, (): undefined => undefined)
    return run
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function persistEndpointState(svc: any, endpointId: string, state: EndpointState) {
    const run = svc.endpointStateWriteQueue.then(async () => {
      const now = new Date()
      const existing = await svc.dbGet('interlude_endpoint_state', { endpointId }, { limit: 1 })
      if (existing.length) {
        await svc.dbSet('interlude_endpoint_state', { endpointId }, { state, updatedAt: now })
      } else {
        await svc.dbCreate('interlude_endpoint_state', { endpointId, state, updatedAt: now })
      }
    }, async () => {
      const now = new Date()
      const existing = await svc.dbGet('interlude_endpoint_state', { endpointId }, { limit: 1 })
      if (existing.length) await svc.dbSet('interlude_endpoint_state', { endpointId }, { state, updatedAt: now })
      else await svc.dbCreate('interlude_endpoint_state', { endpointId, state, updatedAt: now })
    })
    svc.endpointStateWriteQueue = run.catch((): undefined => undefined)
    void run.catch((error: any) => svc.reportStandalone('warn', '端点状态快照写入失败（不影响连接/投递） 端点=%s 错误=%s', endpointId, error))
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function setEndpointState(svc: any, endpointId: string, state: EndpointState) {
    svc.endpointStates.set(endpointId, state)
    svc.persistEndpointState(endpointId, state)
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function endpointGateReason(svc: any, endpointId: string | undefined, now = Date.now(), options?: { ignoreCooldown?: boolean }) {
    if (!endpointId || !svc.endpointRegistryReady) return undefined
    const endpoint = svc.endpointRows.find((row: any) => row.id === endpointId)
    if (!endpoint) return 'endpoint-not-found'
    if (!endpoint.enabled) return 'endpoint-disabled'
    let state = svc.endpointStates.get(endpointId)
    if (!state || !state.connection.online) {
      // 启动竞态兜底：bot-status-updated 可能丢失（适配器 initialize 的
      // getLogin 失败即 offline 且无重试，而 ws 仍在正常收发）。门控前回查
      // ctx.bots 实况——连接事实以内存 bot 为准；持久快照本就不恢复 online
      // 真值，这里只刷内存不落库，与 restoreEndpointState 的语义一致。
      if (state && svc.liveBotForEndpoint(endpoint)) {
        state = stateAfterConnection(state, true)
        svc.endpointStates.set(endpointId, state)
      } else {
        return 'endpoint-offline'
      }
    }
    if (state.deliverable.cooldownUntil && now < state.deliverable.cooldownUntil && !options?.ignoreCooldown) return 'endpoint-cooldown'
    if (!isEndpointDeliverable(state, now, endpoint, options)) {
      return state.deliverable.allowed ? 'endpoint-state-expired' : 'endpoint-not-deliverable'
    }
    return undefined
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function liveBotForEndpoint(svc: any, row: EndpointRow) {
    const key = endpointAccountKey(row.platform, String(row.selfId ?? ''))
    return (svc.ctx?.bots ?? []).find((bot: any) => isBotOnlineStatus(bot.status)
      && endpointAccountKey(String(bot.platform ?? ''), String(bot.selfId ?? '')) === key)
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function endpointInitiateGateReason(svc: any, endpointId: string | undefined, now = Date.now()) {
    const deliveryReason = svc.endpointGateReason(endpointId, now)
    if (deliveryReason || !endpointId || !svc.endpointRegistryReady) return deliveryReason
    const state = svc.endpointStates.get(endpointId)
    if (!state?.initiate) return undefined
    if (state.initiate.expiresAt !== undefined && now >= state.initiate.expiresAt) return 'endpoint-state-expired'
    return isEndpointInitiateAllowed(state, now) ? undefined : 'endpoint-initiate-forbidden'
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function endpointForDelivery(svc: any, endpointId: string | undefined, owner: { kind: 'story-role' | 'participant-user' | 'group', id: string }, now = Date.now(), options?: { ignoreCooldown?: boolean }) {
    if (!endpointId) return {}
    const row = svc.endpointRows.find((item: any) => item.id === endpointId)
    if (!row) return { reason: 'endpoint-not-found' }
    if (row.ownerKind !== owner.kind || row.ownerId !== owner.id) return { reason: 'endpoint-not-found' }
    const reason = svc.endpointGateReason(endpointId, now, options)
    return reason ? { reason } : { row }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function ensureEndpointRegistry(svc: any) {
    if (svc.endpointRegistryReady) return
    if (svc.endpointRegistryInFlight) return svc.endpointRegistryInFlight
    // 单飞锁——两个并发初始化不会各自"查不存在→插入"造成重复行。
    svc.endpointRegistryInFlight = svc.reconcileEndpointRegistry().finally(() => { svc.endpointRegistryInFlight = undefined })
    return svc.endpointRegistryInFlight
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function reconcileEndpointRegistry(svc: any) {
    const now = new Date()
    const existing = (((await svc.dbGet('interlude_endpoint', {})) as unknown[]) ?? [])
      .map(row => normalizeEndpointRow(row)).filter((row): row is EndpointRow => !!row)
    const stateRows = (((await svc.dbGet('interlude_endpoint_state', {})) as unknown[]) ?? [])
    const persistedStates = new Map<string, EndpointState>()
    for (const raw of stateRows) {
      const endpointId = String((raw as any)?.endpointId ?? '').trim()
      const state = normalizeEndpointState(raw)
      if (endpointId && state) persistedStates.set(endpointId, state)
    }
    const byKey = new Map(existing.map(row => [endpointUniqueKey(row), row]))
    const drafts: EndpointRow[] = []
    const addDraft = (draft: EndpointRow) => {
      const key = endpointUniqueKey(draft)
      if (byKey.has(key)) return
      byKey.set(key, draft)
      drafts.push({ ...draft, id: randomUUID() })
    }
    // active+paused 都登记：暂停故事的账号/别名同样要能被 resume/status
    // 与入站重定向找到；archived 由 migrateLegacyStory 迁移时单独登记。
    const stories = (await svc.dbGet('interlude_story', { status: { $in: ['active', 'paused'] } })) as any[]
    for (const story of stories) {
      if (story?.id && story.selfId) addDraft(deriveStoryRoleEndpoint({ id: String(story.id), platform: String(story.platform ?? 'onebot'), selfId: String(story.selfId) }, now))
      for (const rule of svc.config.onebot?.groupChats ?? []) {
        if (rule.enabled !== false) addDraft(deriveGroupEndpoint({ id: String(story.id), platform: String(story.platform ?? 'onebot'), selfId: String(story.selfId) }, rule, now))
      }
    }
    for (const participant of (await svc.dbGet('interlude_participant', { status: 'active' })) as any[]) {
      if (participant?.id && participant.selfId && participant.userId) addDraft(deriveParticipantUserEndpoint({ id: String(participant.id), platform: String(participant.platform ?? 'onebot'), selfId: String(participant.selfId), userId: String(participant.userId) }, now))
    }
    const persisted: EndpointRow[] = []
    for (const draft of drafts) {
      // 先落库、成功才进内存——失败行不产生幽灵端点（重启即消失的假行）。
      try {
        await svc.dbCreate('interlude_endpoint', draft)
        persisted.push(draft)
      } catch (error) {
        svc.reportStandalone('warn', '端点行写入失败，已跳过（不进内存，下次 reconcile 重试）键=%s 错误=%s', endpointUniqueKey(draft), error)
      }
    }
    if (persisted.length) svc.reportStandaloneOperation('diagnostic', 'debug', '端点注册表迁移完成 新增=%d/%d 总数=%d', persisted.length, drafts.length, existing.length + persisted.length)
    svc.endpointRows = [...existing, ...persisted]
    for (const row of svc.endpointRows) {
      if (!svc.endpointStates.has(row.id)) {
        svc.setEndpointState(row.id, restoreEndpointState(row.id, persistedStates.get(row.id)))
      }
    }
    // M1b：剧本别名迁移（与端点同一幂等通道）——为每个故事登记"按账号推导的
    // ID → 既有剧本 ID"。故事主键保持不动（即冻结的稳定角色 ID），推导形态
    // （legacy platform:selfId:userId / 未来的第二端点 character:...）一律经
    // 别名重定向，不再创建平行故事。前后各记一条带行数快照的审计。
    svc.storyAliasRows = (((await svc.dbGet('interlude_story_alias', {})) as unknown[]) ?? [])
      .map(row => normalizeStoryAliasRow(row)).filter((row): row is StoryAliasRecord => !!row)
    svc.reportStandaloneOperation('diagnostic', 'debug', '剧本别名迁移开始 角色=%d 既有别名=%d', svc.endpointRows.filter((row: any) => row.ownerKind === 'story-role').length, svc.storyAliasRows.length)
    let aliasesAdded = 0
    for (const story of stories) {
      if (!story?.id || !story.selfId) continue
      const derivedId = storyIdForCharacter(String(story.platform ?? 'onebot'), String(story.selfId))
      if (derivedId === story.id) continue
      const recorded = await svc.recordStoryAlias(derivedId, String(story.id), 'M1b-stable-id', false)
      if (recorded) aliasesAdded += 1
    }
    svc.reportStandaloneOperation('diagnostic', 'debug', '剧本别名迁移完成 新增=%d 总数=%d', aliasesAdded, svc.storyAliasRows.length)
    // 回填 qzone 审计行的 endpointId（按 storyId → 角色端点归因）。
    await svc.backfillQzoneEndpointIds()
    svc.endpointRegistryReady = true
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function registerStoryRoleEndpointRow(svc: any, story: { id: string, platform: string, selfId: string }) {
    await svc.enqueueEndpointWrite(async () => {
      try {
        await svc.ensureEndpointRegistry()
        const now = new Date()
        const draft = deriveStoryRoleEndpoint(story, now)
        if (svc.endpointRows.some((row: any) => endpointUniqueKey(row) === endpointUniqueKey(draft))) return
        const row: EndpointRow = { ...draft, id: randomUUID() }
        await svc.dbCreate('interlude_endpoint', row)
        svc.endpointRows.push(row)
        if (!svc.endpointStates.has(row.id)) svc.setEndpointState(row.id, freshEndpointState(row.id))
        await svc.recordStoryAlias(storyIdForCharacter(story.platform, story.selfId), story.id, 'story-created', false)
      } catch (error) {
        svc.endpointRegistryReady = false
        svc.reportStandalone('warn', '故事端点登记失败，注册表已置脏待重试 故事=%s 错误=%s', story.id, error)
      }
    })
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function registerParticipantUserEndpointRow(svc: any, participant: { id: string, platform: string, selfId: string, userId: string }) {
    await svc.enqueueEndpointWrite(async () => {
      try {
        await svc.ensureEndpointRegistry()
        const now = new Date()
        const draft = deriveParticipantUserEndpoint(participant, now)
        if (svc.endpointRows.some((row: any) => endpointUniqueKey(row) === endpointUniqueKey(draft))) return
        const row: EndpointRow = { ...draft, id: randomUUID() }
        await svc.dbCreate('interlude_endpoint', row)
        svc.endpointRows.push(row)
        if (!svc.endpointStates.has(row.id)) svc.setEndpointState(row.id, freshEndpointState(row.id))
      } catch (error) {
        svc.endpointRegistryReady = false
        svc.reportStandalone('warn', '参与者端点登记失败，注册表已置脏待重试 参与者=%s 错误=%s', participant.id, error)
      }
    })
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function backfillQzoneEndpointIds(svc: any) {
    const rows = (await svc.dbGet('interlude_qzone_post', {})) as any[]
    for (const row of rows) {
      if (row?.endpointId) continue
      const endpoint = svc.endpointRows.find((item: any) => item.ownerKind === 'story-role' && item.ownerId === String(row.storyId ?? ''))
      if (!endpoint) continue
      await svc.dbSet('interlude_qzone_post', { id: row.id }, { endpointId: endpoint.id }).catch((): undefined => undefined)
    }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function recordStoryAlias(svc: any, aliasStoryId: string, canonicalStoryId: string, reason: string, announce = true) {
    if (!aliasStoryId || !canonicalStoryId || aliasStoryId === canonicalStoryId) return false
    const existing = svc.storyAliasRows.find((row: any) => row.aliasStoryId === aliasStoryId)
    if (existing) {
      if (existing.canonicalStoryId !== canonicalStoryId) {
        const key = `conflict:${aliasStoryId}`
        if (!svc.storyAliasProblems.has(key)) {
          svc.storyAliasProblems.add(key)
          svc.reportStandalone('warn', '剧本别名冲突，保留既有指向（人工裁决）别名=%s 既有=%s 试图=%s', aliasStoryId, existing.canonicalStoryId, canonicalStoryId)
        }
      }
      return false
    }
    const now = new Date()
    const row: StoryAliasRecord = { aliasStoryId, canonicalStoryId, reason, createdAt: now }
    // 先落库、成功才进内存——失败不产生幽灵别名。
    try {
      await svc.dbCreate('interlude_story_alias', row)
    } catch (error) {
      svc.reportStandalone('warn', '剧本别名写入失败，已放弃（无内存幻影）别名=%s 错误=%s', aliasStoryId, error)
      return false
    }
    svc.storyAliasRows.push(row)
    if (announce) svc.reportStandaloneOperation('diagnostic', 'debug', '剧本别名已登记 %s → %s 原因=%s', aliasStoryId, canonicalStoryId, reason)
    return true
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function resolveStoryIdAlias(svc: any, aliasStoryId: string) {
    if (!aliasStoryId) return undefined
    const result = resolveStoryAlias(svc.storyAliasRows, aliasStoryId)
    if (result.problem === 'chain') {
      const key = `chain:${aliasStoryId}`
      if (!svc.storyAliasProblems.has(key)) {
        svc.storyAliasProblems.add(key)
        svc.reportStandalone('warn', '剧本别名形成链式指向（双射失败，人工裁决）别名=%s', aliasStoryId)
      }
      return undefined
    }
    if (!result.canonicalStoryId) return undefined
    const target = (await svc.dbGet('interlude_story', { id: result.canonicalStoryId }))[0]
    if (!target) {
      const key = `dangling:${aliasStoryId}`
      if (!svc.storyAliasProblems.has(key)) {
        svc.storyAliasProblems.add(key)
        svc.reportStandalone('warn', '剧本别名指向不存在的剧本（悬空，忽略重定向）别名=%s 目标=%s', aliasStoryId, result.canonicalStoryId)
      }
      return undefined
    }
    return result.canonicalStoryId
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function removeStoryAlias(svc: any, aliasStoryId: string, reason = 'manual-rollback') {
    const row = svc.storyAliasRows.find((item: any) => item.aliasStoryId === aliasStoryId)
    if (!row) return { ok: false, error: `别名不存在：${aliasStoryId}` }
    await svc.dbRemove('interlude_story_alias', { aliasStoryId })
    svc.storyAliasRows = svc.storyAliasRows.filter((item: any) => item.aliasStoryId !== aliasStoryId)
    await svc.appendEntry(row.canonicalStoryId, {
      kind: 'system', actor: 'system',
      content: `[通道迁移] 已回滚剧本别名 ${row.aliasStoryId} → ${row.canonicalStoryId}（原因：${reason}）`,
      occurredAt: new Date().toISOString(), metadata: { aliasRollback: true, aliasStoryId: row.aliasStoryId },
    }, new Date()).catch((): undefined => undefined)
    svc.reportStandaloneOperation('standard', 'warn', '剧本别名已回滚 别名=%s 原因=%s', aliasStoryId, reason)
    return { ok: true }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function listStoryAliases(svc: any) {
    return [...svc.storyAliasRows]
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function addStoryEndpoint(svc: any, story: InterludeStory, platform: string, selfId: string, channelKind: EndpointChannelKind = 'qq') {
    const account = String(selfId || '').trim()
    if (!account) return { ok: false, error: '账号不能为空。' }
    return svc.enqueueEndpointWrite(async () => {
      await svc.ensureEndpointRegistry()
      const now = new Date()
      const accountKey = endpointAccountKey(platform, account)
      const conflict = svc.endpointRows.find((row: any) => row.ownerKind === 'story-role' && row.accountKey === accountKey)
      if (conflict) {
        if (conflict.ownerId === story.id) return { ok: true, endpointId: conflict.id, error: '该账号已注册为本故事端点。' }
        return { ok: false, error: `账号 ${account} 已被故事 ${conflict.ownerId} 注册（唯一键 role:${accountKey}）。` }
      }
      const row: EndpointRow = {
        id: randomUUID(), ownerKind: 'story-role', ownerId: story.id,
        channelKind, platform, accountKey, selfId: account,
        enabled: true, createdAt: now, updatedAt: now,
      }
      try {
        await svc.dbCreate('interlude_endpoint', row)
      } catch (error) {
        svc.reportStandalone('warn', '角色端点写入失败 故事=%s 账号=%s 错误=%s', story.id, account, error)
        return { ok: false, error: `写入失败：${error instanceof Error ? error.message : String(error)}` }
      }
      svc.endpointRows.push(row)
      svc.setEndpointState(row.id, freshEndpointState(row.id))
    // 第二端点的推导 ID 同步登记别名——其消息经 M1b 重定向直达本故事。
    await svc.recordStoryAlias(storyIdForCharacter(platform, account), story.id, 'endpoint-added', false)
    await svc.appendEntry(story.id, {
      kind: 'system', actor: 'system',
      content: `[通道迁移] 角色端点已注册：${platform} 账号 ${account}（${channelKind}）`,
      occurredAt: now.toISOString(), metadata: { endpointAdded: true, endpointId: row.id },
    }, now).catch((): undefined => undefined)
      svc.reportStandaloneOperation('standard', 'warn', '角色端点已注册 故事=%s 平台=%s 账号=%s 端点=%s', story.id, platform, account, row.id)
      return { ok: true, endpointId: row.id }
    })
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function disableStoryEndpoint(svc: any, endpointId: string) {
    await svc.ensureEndpointRegistry()
    const row = svc.endpointRows.find((item: any) => item.id === endpointId && item.ownerKind === 'story-role')
    if (!row) return { ok: false, error: `端点不存在：${endpointId}` }
    if (!row.enabled) return { ok: true, error: '该端点已处于停用状态。' }
    const enabledRoleRows = svc.endpointRows.filter((item: any) => item.ownerKind === 'story-role' && item.ownerId === row.ownerId && item.enabled)
    if (enabledRoleRows.length <= 1) return { ok: false, error: '不能停用故事的最后一个启用端点。' }
    await svc.dbSet('interlude_endpoint', { id: row.id }, { enabled: false, updatedAt: new Date() }).catch((): undefined => undefined)
    row.enabled = false
    svc.reportStandaloneOperation('standard', 'warn', '角色端点已停用 故事=%s 账号=%s 端点=%s', row.ownerId, row.selfId, row.id)
    return { ok: true }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function resolveMostActiveEndpointId(svc: any, participantId: string) {
    const userEndpoints = svc.endpointRows.filter((row: any) => row.ownerKind === 'participant-user' && row.ownerId === participantId && row.enabled)
    if (!userEndpoints.length) return undefined
    let best: { id: string, observedAt: number } | undefined
    for (const row of userEndpoints) {
      const state = svc.endpointStates.get(row.id)
      if (!state?.connection.online) continue
      if (!best || state.connection.observedAt > best.observedAt) best = { id: row.id, observedAt: state.connection.observedAt }
    }
    return best?.id ?? userEndpoints[0]?.id  // 无在线则取第一个启用端点（保守可尝试）
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function narrativeEndpointSelection(svc: any, 
    story: InterludeStory,
    participants: InterludeParticipant[],
    groups: Array<{ participantId: string, groupId: string, label: string }>,
  ) {
    const roleRows = svc.endpointRows.filter((row: any) => row.ownerKind === 'story-role' && row.ownerId === story.id && row.enabled)
    const roleAccountKeys = new Set(roleRows.map((row: any) => row.accountKey))
    const participantIds = new Set(participants.map(item => item.id))
    const options: NarrativeEndpointOption[] = []
    const seen = new Set<string>()
    const add = (row: EndpointRow, targetId: string, targetKind: 'participant' | 'group', conversationKind: 'private' | 'group') => {
      if (!row.enabled || seen.has(`${row.id}:${targetId}`)) return
      seen.add(`${row.id}:${targetId}`)
      options.push({
        endpointId: row.id, targetId, targetKind, conversationKind,
        channelKind: row.channelKind,
        online: svc.endpointStates.get(row.id)?.connection.online === true,
      })
    }
    for (const row of svc.endpointRows) {
      if (row.ownerKind === 'participant-user' && participantIds.has(row.ownerId)) {
        add(row, row.ownerId, 'participant', 'private')
      }
    }
    for (const group of groups) {
      const groupId = normalizeGroupId(group.groupId)
      for (const row of roleRows) add(row, group.participantId, 'group', 'group')
      for (const row of svc.endpointRows) {
        if (row.ownerKind === 'group' && roleAccountKeys.has(row.accountKey)
          && normalizeGroupId(row.groupId ?? row.ownerId) === groupId) {
          add(row, group.participantId, 'group', 'group')
        }
      }
    }
    const channelKinds = new Set(options.map(option => option.channelKind))
    if (channelKinds.size < 2) return { enabled: false, options: [] }
    return { enabled: true, options }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function linkParticipantEndpoint(svc: any, participant: InterludeParticipant, platform: string, userId: string) {
    const account = String(userId || '').trim()
    if (!account) return { ok: false, error: '用户 ID 不能为空。' }
    await svc.ensureEndpointRegistry()
    // 角色端点的 accountKey 决定该用户走哪个通道——与参与者现有端点一致或显式指定。
    const accountKey = endpointAccountKey(platform, svc.resolveRoleAccountKey(participant.storyId, platform))
    const existing = svc.endpointRows.find((row: any) => row.ownerKind === 'participant-user'
      && row.accountKey === accountKey && String(row.userId ?? '') === account)
    if (existing) {
      if (existing.ownerId === participant.id) return { ok: true, endpointId: existing.id, error: '该用户端点已链接到此参与者。' }
      return { ok: false, error: `用户 ${account} 已链接到参与者 ${existing.ownerId}——一个人格一处。` }
    }
    const row: EndpointRow = {
      id: randomUUID(), ownerKind: 'participant-user', ownerId: participant.id,
      channelKind: 'qq', platform, accountKey, selfId: accountKey.slice(accountKey.indexOf(':') + 1),
      userId: account, conversationKind: 'private',
      enabled: true, createdAt: new Date(), updatedAt: new Date(),
    }
    try {
      await svc.dbCreate('interlude_endpoint', row)
    } catch (error) {
      svc.reportStandalone('warn', '用户端点写入失败 参与者=%s 用户=%s 错误=%s', participant.id, account, error)
      return { ok: false, error: `写入失败：${error instanceof Error ? error.message : String(error)}` }
    }
    svc.endpointRows.push(row)
    svc.setEndpointState(row.id, freshEndpointState(row.id))
    await svc.appendEntry(participant.storyId, {
      kind: 'system', actor: 'system',
      content: `[通道迁移] 用户端点已链接：${platform} ${account} → 参与者 ${participant.displayName || participant.id}`,
      occurredAt: new Date().toISOString(), metadata: { endpointLinked: true, endpointId: row.id },
    }, new Date()).catch((): undefined => undefined)
    svc.reportStandaloneOperation('standard', 'warn', '用户端点已链接 参与者=%s 平台=%s 用户=%s 端点=%s', participant.id, platform, account, row.id)
    return { ok: true, endpointId: row.id }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function unlinkParticipantEndpoint(svc: any, endpointId: string) {
    await svc.ensureEndpointRegistry()
    const row = svc.endpointRows.find((item: any) => item.id === endpointId && item.ownerKind === 'participant-user')
    if (!row) return { ok: false, error: `用户端点不存在：${endpointId}` }
    if (!row.enabled) return { ok: true, error: '该端点已处于解除状态。' }
    await svc.dbSet('interlude_endpoint', { id: row.id }, { enabled: false, updatedAt: new Date() }).catch((): undefined => undefined)
    row.enabled = false
    await svc.appendEntry(row.ownerId.split(':')[0] || '', {
      kind: 'system', actor: 'system',
      content: `[通道迁移] 用户端点已解除链接：${row.platform} ${row.userId ?? ''}（端点 ${row.id}）`,
      occurredAt: new Date().toISOString(), metadata: { endpointUnlinked: true, endpointId: row.id },
    }, new Date()).catch((): undefined => undefined)
    svc.reportStandaloneOperation('standard', 'warn', '用户端点已解除 端点=%s 参与者=%s', row.id, row.ownerId)
    return { ok: true }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function listParticipantEndpoints(svc: any, participantId: string) {
    return svc.endpointRows
      .filter((row: any) => row.ownerKind === 'participant-user' && row.ownerId === participantId)
      .map((row: any) => ({ endpointId: row.id, platform: row.platform, userId: row.userId ?? '', enabled: row.enabled }))
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function resolveRoleAccountKey(svc: any, storyId: string, platform: string) {
    const role = svc.endpointRows.find((row: any) => row.ownerKind === 'story-role' && row.ownerId === storyId && row.enabled)
    if (role) return role.selfId
    return platform  // 无角色端点时用 platform 兜底（onebot 家族折叠后等效）
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function listStoryEndpoints(svc: any, storyId: string) {
    return svc.endpointRows
      .filter((row: any) => row.ownerKind === 'story-role' && row.ownerId === storyId)
      .map((row: any) => ({
        endpointId: row.id, platform: row.platform, selfId: row.selfId, channelKind: row.channelKind, enabled: row.enabled,
        online: svc.endpointStates.get(row.id)?.connection.online === true,
        lastInboundAt: svc.endpointStates.get(row.id)?.connection.observedAt,
      }))
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function resolveInboundEndpointFor(svc: any, source: { platform: string, selfId: string, userId?: string, groupId?: string, channelId?: string }) {
    await svc.ensureEndpointRegistry()
    return resolveInboundEndpoint(svc.endpointRows, source)
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function channelMetadataFor(svc: any, source: { platform: string, selfId: string, userId?: string, groupId?: string, channelId?: string }, extra: { userId?: string, groupId?: string, channelId?: string } = {}) {
    const resolution = await svc.resolveInboundEndpointFor(source)
    if (!resolution) return undefined
    const endpoint = resolution.groupEndpoint ?? resolution.userEndpoint ?? resolution.roleEndpoint
    return channelContextMetadata(endpoint, extra)
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function touchEndpointStateInbound(svc: any, source: { platform: string, selfId: string, userId?: string, groupId?: string, channelId?: string }) {
    const resolution = await svc.resolveInboundEndpointFor(source)
    if (!resolution) return
    // 重复角色端点（脏数据）一次性告警——静默取首行会让地址选择与
    // qzone 限流的歧义无法追踪。
    if (resolution.duplicateRoleAccountKeys?.length) {
      const key = `dup-role:${resolution.duplicateRoleAccountKeys.join(',')}`
      if (!svc.storyAliasProblems.has(key)) {
        svc.storyAliasProblems.add(key)
        svc.reportStandalone('warn', '检测到重复角色端点（脏数据，取首行生效，请人工核查 interlude_endpoint）账号键=%s', resolution.duplicateRoleAccountKeys.join(', '))
      }
    }
    const now = Date.now()
    for (const endpoint of [resolution.roleEndpoint, resolution.userEndpoint, resolution.groupEndpoint]) {
      if (!endpoint) continue
      const previous = svc.endpointStates.get(endpoint.id) ?? freshEndpointState(endpoint.id, now)
      svc.setEndpointState(endpoint.id, stateAfterInbound(previous, now))
    }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function syncCurrentBotConnections(svc: any) {
    await svc.ensureEndpointRegistry()
    for (const bot of svc.ctx.bots ?? []) {
      if (!bot.platform || !bot.selfId) continue
      svc.noteEndpointConnection(
        endpointAccountKey(bot.platform, String(bot.selfId)),
        isBotOnlineStatus(bot.status)
      )
    }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function noteEndpointConnection(svc: any, accountKey: string, online: boolean) {
    const now = Date.now()
    for (const row of svc.endpointRows) {
      if (row.accountKey !== accountKey) continue
      const previous = svc.endpointStates.get(row.id) ?? freshEndpointState(row.id, now)
      svc.setEndpointState(row.id, stateAfterConnection(previous, online, now))
    }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function endpointAddressSync(svc: any, legacy: { platform: string, selfId: string }, owner?: { kind: 'story-role' | 'participant-user', id: string }) {
    if (!owner || !svc.endpointRegistryReady) return legacy
    let rows = svc.endpointRows.filter((item: any) => item.ownerKind === owner.kind && item.ownerId === owner.id && item.enabled)
    if (!rows.length) return legacy
    if (rows.length > 1) {
      rows = [...rows].sort((left, right) => {
        const leftOnline = svc.endpointStates.get(left.id)?.connection.online === true ? 1 : 0
        const rightOnline = svc.endpointStates.get(right.id)?.connection.online === true ? 1 : 0
        if (leftOnline !== rightOnline) return rightOnline - leftOnline
        const leftSeen = svc.endpointStates.get(left.id)?.connection.observedAt ?? 0
        const rightSeen = svc.endpointStates.get(right.id)?.connection.observedAt ?? 0
        if (leftSeen !== rightSeen) return rightSeen - leftSeen
        return left.createdAt.getTime() - right.createdAt.getTime()
      })
      const warnKey = `ambiguous:${owner.kind}:${owner.id}`
      if (!svc.endpointDriftWarned.has(warnKey)) {
        svc.endpointDriftWarned.add(warnKey)
        svc.reportStandalone('warn', '同一归属存在多个启用端点，出站地址按最近连接观测选取 归属=%s:%s 选中=%s', owner.kind, owner.id, rows[0].id)
      }
    }
    const row = rows[0]
    if (String(row.selfId) !== String(legacy.selfId) || row.platform !== legacy.platform) {
      const warnKey = `drift:${row.id}:${legacy.platform}:${legacy.selfId}`
      if (!svc.endpointDriftWarned.has(warnKey)) {
        svc.endpointDriftWarned.add(warnKey)
        svc.reportStandalone('warn', '出站地址以端点注册表为准（旧字段漂移）端点=%s 注册=%s/%s 旧=%s/%s', row.id, row.platform, row.selfId, legacy.platform, legacy.selfId)
      }
    }
    return { platform: row.platform, selfId: row.selfId, endpointId: row.id }
  }


/** P4 自 service.ts 端点注册表接线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function noteEndpointOutbound(svc: any, owner: { kind: 'story-role' | 'participant-user' | 'group', id: string }, ok: boolean, note: string, address?: { platform: string, selfId: string }) {
    const now = Date.now()
    for (const row of svc.endpointRows) {
      if (row.ownerKind !== owner.kind || row.ownerId !== owner.id) continue
      if (address && (row.platform !== address.platform || String(row.selfId) !== String(address.selfId))) continue
      const previous = svc.endpointStates.get(row.id) ?? freshEndpointState(row.id, now)
      svc.setEndpointState(row.id, stateAfterOutbound(previous, ok, note, ok ? 0 : 5 * 60_000, now))
    }
  }

