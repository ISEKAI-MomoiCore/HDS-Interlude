/** QQ 空间执行器：限流门 → pending 审计行（故事串行队列内原子预留）→
 * SnowLuma 动作（网络调用在队列外）→ confirmed/failed/unknown 回写，
 * 以及好友动态/被评论的零模型感知轮询与 qzone-action 意图执行侧。
 * 纯策略（门控计算/条目归一化/意图校验）在 qzone.ts。
 *
 * P3 自 service.ts 迁出（2026-10-29），行为不变。函数接收宿主（service 实例
 * 或测试假宿主）为第一参数——与投递管线（delivery/pipeline.ts）同一形态；
 * service.ts 保留同名薄委托，既有调用点与测试零改动。
 * 结果语义：传输类异常与“成功帧但无 tid”记 unknown——保守计入配额，
 * 绝不自动重试非幂等动作。 */
import { Time } from 'koishi'
import { callQzoneAction, evaluateQzoneGate, matchQzoneFeedContent, normalizeQzoneFeedEntry, normalizeQzoneMsgEntry, probeQzoneAvailable, qzoneFeedCandidates, qzoneIntentFromPayload, qzoneReactionDeltas, qzoneRecordsForEndpoint, qzoneVisibilityLabel, QzoneActionError, type QzoneActionCaller, type QzoneActionKind, type QzoneFeedEntry, type QzoneMsgEntry, type QzonePostRecord } from './qzone'
import { runStorySerialized, clip } from './narrative-normalizers'
import { captureStoryTask } from './task-lifecycle'
import { isOneBotPlatform, withTransportTimeout } from './session-platform'
import { endpointAccountKey } from './endpoints'
import type { InterludeStory, NarrativeIntent } from './types'

/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function qzoneCaller(svc: any, preferSelfId?: string) {
    // W3（C2-3）：桌面桥接模式经动作代理——worker 内无 ctx.bots，qzone 动作由
    // 宿主代调真实上游。accountKey = onebot:<selfId>（B2 多账号注册表路由）。
    if (svc.desktopOnebotActionHandler) {
      const accountKey = 'onebot:' + String(preferSelfId ?? '').trim()
      return async (action: string, params?: Record<string, unknown>) => {
        const outcome = await svc.desktopOnebotActionHandler!({ accountKey, action, params })
        if (outcome.ok) return outcome.data
        // ambiguous 语义对齐 QzoneActionError：可能已到达服务端 → 不自动重试。
        const error = new QzoneActionError(outcome.error || `宿主动作代理失败：${outcome.errorCode ?? 'unknown'}`, action, undefined, outcome.ambiguous === true)
        throw error
      }
    }
    const bot = preferSelfId
      ? svc.ctx.bots.find((item: any) => isOneBotPlatform(item.platform) && String(item.selfId) === String(preferSelfId))
      : svc.ctx.bots.find((item: any) => isOneBotPlatform(item.platform))
    const internal = (bot as any)?.internal
    if (!internal || typeof internal._request !== 'function') return undefined
    return (action: string, params?: Record<string, unknown>) => withTransportTimeout(Promise.resolve().then(() => internal._request(action, params)), `qzone:${action}`)
  }


/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function qzoneExecute(svc: any, story: InterludeStory, kind: QzoneActionKind, input: { content?: string, tid?: string, targetUin?: string, ugcRight?: number }, preferSelfId?: string) {
    const task = captureStoryTask(svc, story.id)
    const retired = { ok: false, error: '故事任务已失效，已停止处理 QQ 空间动作。' }
    if (!task.taskCurrent()) return retired
    if (!svc.qzoneRuntime.enabled) return { ok: false, error: 'QQ 空间通道未启用（Console → 扩展 → QQ 空间）。' }
    // M1a（路径 7）+ qzone 账号选择——显式指定 preferSelfId 时按 accountKey
    // 精确匹配本故事的角色端点，找不到直接失败（绝不自动切到其他端点）；
    // 未指定时经 endpointAddressSync 解析（多端点按最近观测选取）。
    // endpointId 随行落审计，限流门按端点分桶（历史无 id 行保守计入）。
    let qzoneAddress: { platform: string, selfId: string, endpointId?: string }
    if (preferSelfId) {
      await svc.ensureEndpointRegistry().catch((): undefined => undefined)
      const key = endpointAccountKey(story.platform, String(preferSelfId))
      const exact = svc.endpointRows.find((row: any) => row.ownerKind === 'story-role' && row.ownerId === story.id && row.accountKey === key && row.enabled)
      if (!exact) return { ok: false, error: `账号 ${preferSelfId} 未注册为本故事的角色端点（精确匹配失败，不自动切换账号）。` }
      qzoneAddress = { platform: exact.platform, selfId: exact.selfId, endpointId: exact.id }
    } else {
      qzoneAddress = svc.endpointAddressSync({ platform: story.platform, selfId: story.selfId }, { kind: 'story-role', id: story.id })
    }
    const qzoneEndpointId = qzoneAddress.endpointId
    const caller = svc.qzoneCaller(qzoneAddress.selfId)
    if (!caller) return { ok: false, error: `没有可用的 OneBot（SnowLuma）连接（账号 ${qzoneAddress.selfId} 不在线）；不会改用其他账号执行空间动作。` }
    const now = new Date()
    // 门控与 pending 预留在故事串行队列内完成：并发动作串行过门，杜绝双双
    // 通过限流检查后各插一行而突破日上限/最小间隔（快照模式与 flush 相同）。
    const pending = await runStorySerialized(svc, story.id, async () => {
      if (!task.taskCurrent()) return undefined
      const recent = (await svc.dbGet('interlude_qzone_post', { createdAt: { $gte: new Date(now.getTime() - 48 * Time.hour) } })) as unknown as QzonePostRecord[]
      if (!task.taskCurrent()) return undefined
      const gate = evaluateQzoneGate(qzoneRecordsForEndpoint(recent, qzoneEndpointId), svc.qzoneRuntime, { kind, now })
      if (!gate.allowed) return { blocked: gate.reason as string, gate, row: undefined as undefined | { id: number } }
      const row = await svc.dbCreate('interlude_qzone_post', {
        storyId: story.id, kind,
        tid: input.tid ?? '', ...(input.targetUin ? { targetUin: input.targetUin } : {}),
        ...(kind === 'post' && input.content ? { content: input.content.slice(0, 2_000), ...(input.ugcRight ? { ugcRight: input.ugcRight } : {}) } : {}),
        ...(qzoneEndpointId ? { endpointId: qzoneEndpointId } : {}),
        status: 'pending', createdAt: now,
      })
      return { blocked: undefined as string | undefined, gate, row: { id: row.id } }
    })
    if (!pending) return retired
    if (pending.blocked || !pending.row) {
      const gate = pending.gate
      svc.reportOperation('diagnostic', 'debug', story, 'user-message', 'QQ 空间动作被限流门拦下 类型=%s 原因=%s 今日=%d/%d', kind, pending.blocked, gate.usedToday, gate.cap)
      return { ok: false, error: pending.blocked === 'daily-cap' ? `今日${kind === 'post' ? '发帖' : kind === 'comment' ? '评论' : '点赞'}已达上限（${gate.usedToday}/${gate.cap}）。` : `距离上一条空间动作不足最小间隔（${svc.qzoneRuntime.minIntervalMinutes} 分钟）。` }
    }
    const pendingId = pending.row.id
    const commit = (patch: object, fact?: { content: string, metadata: Record<string, unknown> }) => runStorySerialized(svc, story.id, async () => {
      // A confirmed result remains a fact across pause, but never writes into a reset story.
      if (!task.contentCurrent()) return
      await svc.dbSet('interlude_qzone_post', { id: pendingId, status: 'pending' }, patch)
      if (fact && task.contentCurrent()) await svc.appendEntry(story.id, {
        kind: 'qzone-post', actor: 'character', content: fact.content,
        occurredAt: now.toISOString(), metadata: fact.metadata,
      }, now)
    })
    if (!task.taskCurrent()) {
      await commit({ status: 'failed', error: 'QQ 空间动作发送前已停止。' })
      return retired
    }
    let platformConfirmed = false
    try {
      if (kind === 'post') {
        const data = await callQzoneAction<{ tid?: string | number }>(caller, 'send_qzone_msg', { content: input.content ?? '', ugc_right: input.ugcRight ?? 4 })
        const tid = String(data.tid ?? '')
        if (!tid) {
          await commit({ status: 'unknown', error: '服务端未返回 tid，结果未知。' })
          svc.reportStandalone('warn', 'QQ 空间说说发表结果未知（无 tid），已按保守计入配额且不自动重试')
          return { ok: false, error: '发表结果未知：服务端未返回说说 tid，为避免重复发帖不会自动重试。' }
        }
        platformConfirmed = true
        await commit({ tid, status: 'confirmed', postedAt: new Date() }, {
          content: `[空间动态] 她发表了说说：${clip(input.content ?? '', 120)}（${qzoneVisibilityLabel(input.ugcRight ?? 4)}）`,
          metadata: { qzoneKind: 'post', tid, ugcRight: input.ugcRight ?? 4 },
        })
        svc.reportOperation('standard', 'info', story, 'user-message', 'QQ 空间说说已发表 tid=%s 可见性=%s', tid, input.ugcRight ?? 4)
        return { ok: true, tid }
      }
      if (kind === 'comment') {
        await callQzoneAction(caller, 'comment_qzone', { tid: input.tid ?? '', content: input.content ?? '', ...(input.targetUin ? { target_uin: Number(input.targetUin) } : {}) })
        platformConfirmed = true
        await commit({ status: 'confirmed', postedAt: new Date() }, {
          content: `[空间动态] 她评论了${input.targetUin ? ` QQ ${input.targetUin}` : ''}的说说：${clip(input.content ?? '', 80)}`,
          metadata: { qzoneKind: 'comment', tid: input.tid ?? '' },
        })
        return { ok: true }
      }
      await callQzoneAction(caller, 'like_qzone', { tid: input.tid ?? '', ...(input.targetUin ? { target_uin: Number(input.targetUin) } : {}) })
      platformConfirmed = true
      await commit({ status: 'confirmed', postedAt: new Date() })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (platformConfirmed) {
        svc.reportStandalone('warn', 'QQ 空间动作已获平台确认，但本地回执写入失败 类型=%s 错误=%s', kind, message)
        return { ok: false, error: `平台已确认，但本地记录失败；不会自动重试：${message}` }
      }
      const ambiguous = !(error instanceof QzoneActionError) || error.ambiguous
      await commit({ status: ambiguous ? 'unknown' : 'failed', error: message.slice(0, 500) }).catch((): undefined => undefined)
      svc.reportStandalone('warn', 'QQ 空间动作%s 类型=%s 错误=%s', ambiguous ? '结果未知' : '失败', kind, message)
      return { ok: false, error: ambiguous ? `${message}（结果未知：请求可能已生效，为避免重复不会自动重试。）` : message }
    }
  }


/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function qzoneAvailable(svc: any, preferSelfId?: string) {
    const caller = svc.qzoneCaller(preferSelfId)
    if (!caller) return false
    try { return await probeQzoneAvailable(caller) } catch { return false }
  }


/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function executeQzoneIntent(svc: any, story: InterludeStory, intent: NarrativeIntent, now: Date) {
    const task = captureStoryTask(svc, story.id)
    const claim = await runStorySerialized(svc, story.id, async () => {
      if (!task.taskCurrent()) return undefined
      const query = { id: intent.id, storyId: story.id, status: 'pending' }
      const current = (await svc.dbGet('interlude_intent', query))[0] as NarrativeIntent | undefined
      if (!current || !task.taskCurrent()) return undefined
      const request = qzoneIntentFromPayload(current.payload)
      let reason = request ? undefined : 'payload-invalid'
      if (request && request.action !== 'post') {
        // Only posts actually observed by HDSI are valid write targets.
        const targets = await svc.dbGet('interlude_qzone_post', { tid: request.tid ?? '' }) as QzonePostRecord[]
        if (!targets.some(row => row.status === 'confirmed' && (row.kind === 'feed-seen' || row.kind === 'post'))) reason = 'target-unknown'
      }
      if (!task.taskCurrent()) return undefined
      // This intent is one-shot even if the worker dies during transport; the
      // qzone audit row separately records the actual outcome or uncertainty.
      await svc.dbSet('interlude_intent', query, { status: 'completed', updatedAt: now })
      return { request, reason }
    })
    if (!claim) return
    let note = claim.reason ?? 'retired-before-transport'
    if (!claim.reason && claim.request && task.taskCurrent()) {
      const request = claim.request
      const result = await svc.qzoneExecute(story, request.action, {
        content: request.content, tid: request.tid, targetUin: request.targetUin, ugcRight: request.ugcRight,
      }, story.selfId)
      note = result.ok ? 'ok' : `failed:${clip(result.error ?? '', 80)}`
    }
    svc.reportOperation('diagnostic', 'debug', story, 'intent-due', 'QQ 空间意图已处理 意图=%d 结果=%s', intent.id, note)
  }


/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function qzoneFeedSweep(svc: any) {
    if (svc.desktopRuntimePhase === 'paused' || svc.databaseResetting || !svc.qzoneRuntime.enabled || svc.qzoneFeedSweepRunning) return
    svc.qzoneFeedSweepRunning = true
    try {
      const story = await svc.getCanonicalStory()
      if (!story || !svc.canHandleStory(story)) return
      // 轮询账号经端点注册表解析（多角色端点下不再读故事旧 selfId），
      // feed-seen 审计行随记 endpointId。
      const sweepAddress = svc.endpointAddressSync({ platform: story.platform, selfId: story.selfId }, { kind: 'story-role', id: story.id })
      const sweepEndpointId = (sweepAddress as { endpointId?: string }).endpointId
      const caller = svc.qzoneCaller(sweepAddress.selfId)
      if (!caller) return
      const now = new Date()
      // feeds CGI 间歇失败（POC 实测）：失败静默跳过，下轮再试，不写任何条目。
      let feeds: QzoneFeedEntry[] = []
      try {
        const raw = await callQzoneAction<{ feeds?: unknown[] }>(caller, 'get_qzone_feeds', { page_num: 1, count: 20 })
        feeds = (Array.isArray(raw.feeds) ? raw.feeds : []).map(item => normalizeQzoneFeedEntry(item, now)).filter((item): item is QzoneFeedEntry => !!item)
      } catch (error) {
        // feeds CGI 间歇失败跳过本轮，但必须可见（此前零日志）。
        svc.report('warn', story, 'advance', '好友动态列表拉取失败，本轮跳过 错误=%s', error)
      }
      // 去重账本：feed-seen 行的 tid 即 feeds.key（7 天窗足够覆盖时间窗的双倍）。
      const seenRows = (await svc.dbGet('interlude_qzone_post', { kind: 'feed-seen', createdAt: { $gte: new Date(now.getTime() - 7 * 24 * Time.hour) } })) as unknown as QzonePostRecord[]
      const seenKeys = new Set(seenRows.map(row => String(row.tid ?? '')).filter(Boolean))
      for (const feed of qzoneFeedCandidates(feeds, seenKeys, svc.qzoneRuntime, now)) {
        let content = ''
        try {
          const listRaw = await callQzoneAction<{ msglist?: unknown[] }>(caller, 'get_qzone_msg_list', { target_uin: Number(feed.uin), num: 5 })
          const entries = (Array.isArray(listRaw.msglist) ? listRaw.msglist : []).map(item => normalizeQzoneMsgEntry(item)).filter((item): item is NonNullable<typeof item> => !!item)
          content = matchQzoneFeedContent(entries, feed)
        } catch (error) {
          // 正文拉取失败按元数据处理，但必须可见。
          svc.reportOperation('diagnostic', 'debug', story, 'advance', '好友动态正文拉取失败，按元数据入账 uin=%s 错误=%s', feed.uin, error)
        }
        const owner = feed.nickname || `QQ ${feed.uin}`
        // 先落 feed-seen 账本再写条目——账本失败则本轮跳过该条（下轮
        // 重新发现），杜绝"条目已写、账本未落"造成的重复 [好友动态] 入账。
        try {
          await svc.dbCreate('interlude_qzone_post', { storyId: story.id, kind: 'feed-seen', tid: feed.key, targetUin: feed.uin, ...(sweepEndpointId ? { endpointId: sweepEndpointId } : {}), content: feed.nickname.slice(0, 100), status: 'confirmed', createdAt: now })
        } catch (error) {
          svc.report('warn', story, 'advance', '好友动态账本写入失败，该条延后到下轮 key=%s 错误=%s', feed.key, error)
          continue
        }
        try {
          await svc.appendEntry(story.id, {
            kind: 'friend-feed', actor: 'system',
            content: `[好友动态] ${owner}发布了说说${content ? `：${clip(content, 80)}` : ''}`,
            occurredAt: feed.time.toISOString(),
            metadata: { qzoneFeedKey: feed.key, qzoneFeedUin: feed.uin, qzoneFeedNickname: feed.nickname },
          }, now)
        } catch (error) {
          // 账本已落：条目失败即该动态让位（不回滚账本），只留日志。
          svc.report('warn', story, 'advance', '好友动态条目写入失败，该动态让位 key=%s 错误=%s', feed.key, error)
          continue
        }
        svc.reportOperation('diagnostic', 'debug', story, 'advance', '好友动态已入账 归属=%s 正文=%s', owner, content ? '有' : '无')
      }
      await svc.qzoneReactionSweep(story, caller, sweepAddress, now)
    } catch (error) {
      svc.reportStandalone('warn', 'QQ 空间动态轮询失败 错误=%s', error)
    } finally {
      svc.qzoneFeedSweepRunning = false
    }
  }


/** P3 自 service.ts QQ 空间执行区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function qzoneReactionSweep(svc: any, 
    story: InterludeStory,
    caller: QzoneActionCaller,
    address: { platform: string, selfId: string },
    now: Date,
  ) {
    const posts = (await svc.dbGet('interlude_qzone_post', {
      storyId: story.id, kind: 'post', status: 'confirmed',
      createdAt: { $gte: new Date(now.getTime() - 7 * 24 * Time.hour) },
    })) as unknown as QzonePostRecord[]
    const tracked = posts.filter(row => String(row.tid ?? '').trim())
    if (!tracked.length) return
    let entries: QzoneMsgEntry[] = []
    try {
      const raw = await callQzoneAction<{ msglist?: unknown[] }>(caller, 'get_qzone_msg_list', { target_uin: Number(address.selfId), num: 10 })
      entries = (Array.isArray(raw.msglist) ? raw.msglist : []).map(item => normalizeQzoneMsgEntry(item)).filter((item): item is QzoneMsgEntry => !!item)
    } catch (error) {
      // 拉取失败基线不动、下轮重试，但必须可见（此前零日志）。
      svc.report('warn', story, 'advance', '被评论列表拉取失败，本轮感知跳过 错误=%s', error)
      return
    }
    const { deltas, baselines } = qzoneReactionDeltas(tracked, entries)
    // 无增量的帖子照常推进基线（含 commentNum 为 null 的首次观察初始化——
    // 跳过会让该帖增量感知永久失效）；有增量的帖子留给下方逐条提交处理。
    const deltaTids = new Set(deltas.map(delta => delta.tid))
    for (const baseline of baselines) {
      if (deltaTids.has(baseline.tid)) continue
      const row = tracked.find(post => String(post.tid ?? '') === baseline.tid)
      if (row?.id !== undefined && (row.commentNum ?? null) !== baseline.commentNum) {
        await svc.dbSet('interlude_qzone_post', { id: row.id }, { commentNum: baseline.commentNum })
          .catch((error: any) => svc.report('warn', story, 'advance', '被评论基线初始化失败（不影响本轮感知） tid=%s 错误=%s', baseline.tid, error))
      }
    }
    // 逐条提交——先推进该帖基线再写感知条目。单轮预算 3 条之外的
    // delta 不推进基线（下轮重新发现），杜绝"第 4 条起永久丢失"；基线回写
    // 失败则本轮中止（不写条目），杜绝"旧基线重算出相同 delta 的重复入账"。
    const reactionBudget = 3
    let accounted = 0
    let accountedNew = 0
    for (const delta of deltas) {
      if (accounted >= reactionBudget) break
      const baseline = baselines.find(item => item.tid === delta.tid)
      const row = tracked.find(post => String(post.tid ?? '') === delta.tid)
      if (!baseline || row?.id === undefined) continue
      try {
        await svc.dbSet('interlude_qzone_post', { id: row.id }, { commentNum: baseline.commentNum })
      } catch (error) {
        svc.report('warn', story, 'advance', '被评论基线回写失败，本轮感知中止（下轮重算） tid=%s 错误=%s', delta.tid, error)
        break
      }
      const excerpt = clip(delta.contentExcerpt, 24)
      try {
        await svc.appendEntry(story.id, {
          kind: 'friend-feed', actor: 'system',
          content: `[空间动态] 她的说说${excerpt ? `「${excerpt}」` : ''}收到了 ${delta.current - delta.previous} 条新评论（累计 ${delta.current} 条）`,
          occurredAt: now.toISOString(),
          metadata: { qzoneTid: delta.tid, qzoneReactions: { previous: delta.previous, current: delta.current } },
        }, now)
        accounted += 1
        accountedNew += delta.current - delta.previous
      } catch (error) {
        // 基线已推进：该增量让位（不回滚基线，避免重复入账），只留日志。
        svc.report('warn', story, 'advance', '被评论感知条目写入失败，该增量让位 tid=%s 错误=%s', delta.tid, error)
      }
    }
    if (deltas.length) {
      svc.reportOperation('diagnostic', 'debug', story, 'advance', '被评论感知已入账 新评论=%d 入账帖数=%d/%d（预算 %d）', accountedNew, accounted, deltas.length, reactionBudget)
    }
  }

