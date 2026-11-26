import { runStorySerialized, normalizeFollowUpSummary, clip, isRecord, toDate, normalizeIntentUpdates, isActiveConsequence, isActiveConsequenceDraft, consequenceExpiresAt, consequenceStrength, normalizeBrowserIntentDraft, browserIntentFromPayload, followUpDeadline, followUpDeferredChecks, MAX_FOLLOW_UP_DEFERRED_CHECKS, automaticDeliveryFromPayload, followUpExpiresAt } from './narrative-normalizers'
import type { NarrativeIntent, InterludeStory, ScriptEntry, IntentDraft, BrowserIntentDraft, WebObservation, OutgoingMessageDraft, FollowUpCommitmentDraft, FollowUpResolutionDraft, NarrativeInteraction } from './types'
import { currentDesktopProcessingContext, persistedDesktopProcessingContext } from './processing-context'
import { deliverPrivateBubbleGroup, privateBubbleBusy, privateBubblePlan } from './delivery/private-bubbles'
import { restoreMessageEvent, restoreDesktopContext } from './delivery'
import { formatLogTime } from './time'
import { ResearchDesk, effectiveSearchBackend } from './research/desk'
import { jevGateDecision, jevNoul, JEV_NOUL_LOOKUP_INSTRUCTIONS } from './research/jev'
import { researchHttpWithProxy, proxyAgentResolved } from './research/http'
import { runResearchTask } from './research/runner'
import { captureStoryTask } from './task-lifecycle'
import type { CommunicationEventLog } from './logging'
/** D4：时间常量本地化（原 koishi Time），叙事侧去 koishi 运行时依赖。 */
const Time = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const

/** Emit only after the plan write succeeds; observation never changes its lifecycle. */
export function reportContactPlanUpdate(svc: any, intent: Pick<NarrativeIntent, 'storyId' | 'type' | 'participantId' | 'payload'> & { id?: number }, status: string, reasonCode: string) {
  if (intent.type !== 'contact-plan' || typeof svc.reportCommunicationEvent !== 'function') return
  const plan = isRecord(intent.payload?.plan) ? intent.payload.plan : {}
  const target = isRecord(plan.target) ? plan.target : {}
  const context = persistedDesktopProcessingContext(intent.payload)
  const communication: CommunicationEventLog = {
    type: 'contact-plan-updated', storyId: intent.storyId,
    ...(Number.isSafeInteger(intent.id) ? { intentId: intent.id } : {}),
    ...(intent.participantId || target.id ? { targetId: intent.participantId || String(target.id) } : {}),
    ...(typeof target.endpointId === 'string' ? { endpointId: target.endpointId } : {}),
    ...context, domain: 'authoring', reasonCode, status,
  }
  try {
    svc.reportCommunicationEvent('standard', 'info', { id: intent.storyId }, 'intent-due',
      '联系计划状态更新 状态=%s 原因=%s', communication, status, reasonCode)
  } catch { /* Logging remains observational after the durable write. */ }
}

export const WAKE_DRIVEN_INTENT_TYPES = [
    'split-message', 'delayed-reply', 'cross-conversation-message',
    'narrative-retry', 'browser-research', 'proactive-check',
  ] as const

/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function researchScriptTail(svc: any, storyId: string, limit = 3) {
    try {
      const rows = await svc.dbGet('interlude_script_entry', { storyId, kind: 'script' }, { sort: { occurredAt: 'desc' }, limit }) as Array<{ content?: string }>
      return rows.map(row => String(row.content ?? '').slice(0, 500)).join('\n---\n').slice(-1_500)
    } catch {
      return ''
    }
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function jevGatePassiveResearch(svc: any, story: InterludeStory, userMessage: string | undefined, now: Date) {
    const task = captureStoryTask(svc, story.id)
    if (!task.taskCurrent()) return
    try {
      if (!svc.researchActive || !userMessage?.trim()) return
      const jev = svc.researchConfig.jev
      if (!jev.enabled || !jev.apiKey) return
      if (!svc.researchNarrator || !svc.researchToolsRegistry) return
      const provider = svc.researchProvider()
      if (!provider) return
      const desk = svc.researchDeskFor(story.id)
      const deskSummary = (desk.snapshot(now.getTime()) ?? []).map((item: any) => item.text).join(' ; ')
      const tail = await svc.researchScriptTail(story.id)
      if (!task.taskCurrent()) return
      const state = { incomingMessage: userMessage.slice(0, 600), recentScriptTail: tail || '(empty)', verifiedOnDesk: deskSummary || '(none)' }
      svc.researchJevCounters.calls += 1
      const researchHttp = researchHttpWithProxy(svc.ctx.http as unknown as import('./research/search').ResearchHttpClient, proxyAgentResolved(svc.researchConfig.proxyAgent, provider))
      const noul = await jevNoul(researchHttp, jev, 'needs_lookup', JEV_NOUL_LOOKUP_INSTRUCTIONS, state)
      if (!task.taskCurrent()) return
      if (!jevGateDecision(jev, noul)) {
        svc.reportOperation('diagnostic', 'debug', story, 'user-message', 'Jev 门控直通（概率=%s）', noul === undefined ? '服务不可用' : noul.toFixed(2))
        return
      }
      svc.researchJevCounters.triggered += 1
      svc.reportOperation('standard', 'info', story, 'user-message', 'Jev 门控 TRUE（概率=%.2f）：先查后写', noul!)
      // TRUE → 以消息摘录为主题内联考据；改写步顺带完成主题提取与防火墙脱敏。
      const participants = await svc.participants(story.id)
      if (!task.taskCurrent()) return
      const forbiddenTerms = participants
        .flatMap((person: any) => [person.userId, person.personId, person.displayName])
        .map((value: any) => String(value ?? '').trim())
        .filter((value: any) => value.length >= 2)
      const outcome = await runResearchTask(
        { config: svc.researchConfig, provider, model: svc.researchNarrator, http: researchHttp, registry: svc.researchToolsRegistry, desk, isCurrent: task.taskCurrent },
        { storyId: story.id, topic: userMessage.slice(0, 200), forbiddenTerms })
      if (!task.taskCurrent()) return
      if (outcome.status === 'completed' && 'added' in outcome && outcome.added > 0) {
        svc.reportOperation('standard', 'info', story, 'user-message', 'Jev 门控考据完成 入案=%d 条', outcome.added)
      }
    } catch (error) {
      svc.reportOperation('diagnostic', 'debug', story, 'user-message', 'Jev 门控异常（直通）错误=%s', error)
    }
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function researchDeskFor(svc: any, storyId: string) {
    let desk = svc.researchDesks.get(storyId)
    if (!desk) {
      desk = new ResearchDesk(svc.researchConfig.deskCapacity)
      svc.researchDesks.set(storyId, desk)
    }
    return desk
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function researchProvider(svc: any) {
    const assigned = svc.modelRouting.research.providers.find((item: any) => item.enabled !== false && item.model?.trim())
    if (assigned) return assigned
    return svc.modelRouting.compaction.providers.find((item: any) => item.enabled !== false && item.model?.trim())
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function appendIntent(svc: any, storyId: string, intent: IntentDraft, now: Date, participantId = '') {
    const notBefore = toDate(intent.notBefore)
    const payload = isRecord(intent.payload) ? { ...intent.payload } : {}
    // Only the timed private delivery writer may create this host-owned plan.
    delete payload.privateBubblePlan
    delete payload.privateBubbleInterruption
    const context = currentDesktopProcessingContext()
    // Persist the bridge correlation at the intent boundary as a last line of
    // defence. Most visible messages already carry it through attachMessageEvent,
    // but delayed/background intents can be created without a script commit.
    // Keeping this fallback here prevents those paths from silently losing the
    // processing identity while preserving an explicit valid payload value.
    const persistedContext = persistedDesktopProcessingContext(payload)
    const correlationPayload = {
      ...payload,
      ...(context && !persistedContext.traceId ? { traceId: context.traceId } : {}),
      ...(context && !persistedContext.processingId ? { processingId: context.processingId } : {}),
    }
    const activeConsequence = isActiveConsequenceDraft(intent)
    if (activeConsequence && !svc.memoryConfig.activeConsequencesEnabled) return
    const requestedExpiresAt = activeConsequence ? consequenceExpiresAt(payload) : undefined
    const maxLifetime = Math.max(1, svc.memoryConfig.activeConsequenceMaxDays) * Time.day
    const expiresAt = requestedExpiresAt && requestedExpiresAt > now
      ? new Date(Math.min(requestedExpiresAt.getTime(), now.getTime() + maxLifetime))
      : undefined
    // Scheduled plans always remain future-facing. An active consequence is
    // different: it is a present condition caused by something already in
    // the script, so it begins at now and only needs a bounded expiry.
    if (!notBefore || (!activeConsequence && notBefore <= now) || (activeConsequence && !expiresAt)) return
    const normalizedPayload = activeConsequence ? {
      ...correlationPayload,
      strength: consequenceStrength(correlationPayload, svc.memoryConfig.activeConsequenceDefaultStrength),
      expiresAt: expiresAt!.toISOString(),
    } : correlationPayload
    const created = await svc.dbCreate('interlude_intent', {
      storyId, participantId, type: clip(intent.type, 32) || 'follow-up', summary: clip(intent.summary, 4_000), notBefore,
      status: 'pending', payload: normalizedPayload, createdAt: now, updatedAt: now,
    })
    reportContactPlanUpdate(svc, { storyId, participantId, type: intent.type, payload: normalizedPayload, id: created?.id }, 'pending', 'plan-created')
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function applyIntentUpdates(svc: any, storyId: string, updates: ReturnType<typeof normalizeIntentUpdates>, now: Date, participantId?: string) {
    if (!updates.length) return false
    const ids = updates.map((update: any) => update.id)
    const rows = await svc.dbGet('interlude_intent', { storyId, id: { $in: ids }, status: 'pending' })
    const allowed = new Map<number, NarrativeIntent>(rows
      .filter(isActiveConsequence)
      .filter((intent: any) => !participantId || !intent.participantId || intent.participantId === participantId)
      .map((intent: any) => [intent.id, intent]))
    let changed = false
    for (const update of updates) {
      const intent: NarrativeIntent | undefined = allowed.get(update.id)
      if (!intent) continue
      const payload = {
        ...intent.payload,
        ...(update.resolution ? { resolution: update.resolution } : {}),
      }
      await svc.dbSet('interlude_intent', { id: intent.id }, { status: update.status, payload, updatedAt: now })
      changed = true
    }
    return changed
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function appendBrowserIntent(svc: any, storyId: string, draft: BrowserIntentDraft, now: Date, fallbackParticipantId = '') {
    const config = svc.browserConfig
    if (!config.enabled) return
    const normalized = normalizeBrowserIntentDraft(draft, config)
    if (!normalized) return
    // A model may describe a reason involving another person, but it may not
    // silently attach a web observation to another relationship branch. The
    // active participant owns a live-turn browse; unattended life browsing is
    // world-level. This is both a privacy boundary and a simpler mental model.
    const participantId = fallbackParticipantId
    const allowedParticipant = participantId ? await svc.getParticipant(participantId) : undefined
    if (participantId && (!allowedParticipant || !svc.canHandleParticipant(allowedParticipant))) return
    const notBefore = new Date(now.getTime() + Time.second)
    await svc.appendIntent(storyId, {
      type: 'browser-research',
      summary: clip(normalized.purpose, 500) || 'The character planned to read a public web page.',
      notBefore: notBefore.toISOString(),
      payload: {
        mode: normalized.mode,
        query: normalized.query ?? '',
        url: normalized.url ?? '',
        purpose: normalized.purpose,
      },
    }, now, participantId)
    // notBefore 只有 1 秒：不注册唤醒就要等 sweep 网格（issue #3 同类漏网）。
    svc.scheduleDueIntentWake(storyId, notBefore)
    svc.reportStandaloneOperation('diagnostic', 'debug', '已创建网页浏览意图：故事=%s 模式=%s', storyId, normalized.mode)
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function executeResearchIntent(svc: any, story: InterludeStory, intent: NarrativeIntent, now: Date) {
    const task = captureStoryTask(svc, story.id)
    if (!task.taskCurrent()) return
    const complete = async (patch: Record<string, unknown>) => {
      await svc.serial(story.id, async () => {
        if (task.taskCurrent()) await svc.dbSet('interlude_intent', { storyId: story.id, id: intent.id, status: 'pending' }, { ...patch, updatedAt: now })
      })
    }
    try {
      const pending = (await svc.dbGet('interlude_intent', { storyId: story.id, id: intent.id, status: 'pending' }))[0] as NarrativeIntent | undefined
      if (!pending || !task.taskCurrent()) return
      intent = pending
      if (!svc.researchActive || !svc.researchNarrator) {
        await complete({ status: 'cancelled' })
        return
      }
      const topic = String(intent.summary ?? '').trim()
      if (!topic) {
        await complete({ status: 'completed' })
        return
      }
      const provider = svc.researchProvider()
      if (!provider) {
        svc.reportOperation('standard', 'warn', story, 'advance', '考据意图取消：无可用考据/压缩连接 意图=%s', intent.id)
        await complete({ status: 'cancelled' })
        return
      }
      const participants = await svc.participants(story.id)
      if (!task.taskCurrent()) return
      const forbiddenTerms = participants
        .flatMap((person: any) => [person.userId, person.personId, person.displayName])
        .map((value: any) => String(value ?? '').trim())
        .filter((value: any) => value.length >= 2)
      const outcome = await runResearchTask(
        { config: svc.researchConfig, provider, model: svc.researchNarrator, http: researchHttpWithProxy(svc.ctx.http as unknown as import('./research/search').ResearchHttpClient, proxyAgentResolved(svc.researchConfig.proxyAgent, provider)), registry: svc.researchToolsRegistry!, desk: svc.researchDeskFor(story.id), isCurrent: task.taskCurrent },
        { storyId: story.id, topic, forbiddenTerms, originIntentId: intent.id })
      if (!task.taskCurrent()) return
      await complete({
        status: 'completed',
        payload: { ...intent.payload, researchOutcome: { status: outcome.status, reason: outcome.reason.slice(0, 120), added: 'added' in outcome ? outcome.added : 0 }, researchLog: outcome.log.slice(-20) },
      })
      if (outcome.status === 'completed') {
        svc.reportOperation('standard', 'info', story, 'advance', '考据完成 主题=%s 入案=%d 案头复用=%s', topic.slice(0, 40), outcome.added, outcome.reused ? '是' : '否')
      } else {
        svc.reportOperation('standard', 'warn', story, 'advance', '考据未获事实（意图按完成处理，作者可写她没查到）主题=%s 原因=%s', topic.slice(0, 40), outcome.reason)
      }
    } catch (error) {
      if (!task.taskCurrent()) return
      svc.reportOperation('diagnostic', 'warn', story, 'advance', '考据意图执行异常 意图=%s 错误=%s', intent.id, error)
      await complete({ status: 'completed' })
    }
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function researchStatusLines(svc: any) {
    const config = svc.researchConfig
    const provider = svc.researchProvider()
    const lines = [
      `考据 Agent：${config.enabled ? '已开启' : '未开启'}（应答式：她承诺去查 → 后台核实 → 资料案头供作者参考）`,
      `搜索后端：${effectiveSearchBackend(config)}；轮数上限：${config.maxRounds}；单任务预算：${config.taskTokenBudget} 出向 token`,
      `考据模型：${provider ? `${provider.label || provider.id}（${provider.model}）` : '不可用（模型中心需勾选"用于考据"，或至少启用一条压缩连接）'}`,
      `案头容量：${config.deskCapacity} 条（稳定事实 ${config.stableFactTtlHours}h / 易变事实 ${config.volatileFactTtlHours}h）`,
      `Jev 门控：${config.jev.enabled && config.jev.apiKey ? `已启用（${config.jev.model}，阈值 ${config.jev.noulThreshold}；判断 ${svc.researchJevCounters.calls} 次 / 触发 ${svc.researchJevCounters.triggered} 次，重载归零）` : '未启用（被动推进直通；console.typesafe.ai 申请 Key 后开启）'}`,
    ]
    if (svc.researchToolsRegistry) {
      const cache = svc.researchToolsRegistry.searchCache
      lines.push(`工具注册表：检索后端 [${svc.researchToolsRegistry.registeredSearchIds.join(',')}]；抓取器 [${svc.researchToolsRegistry.registeredFetchIds.join(',')}]；查询缓存 ${cache.size} 条（命中 ${cache.counters.hits} / 未命中 ${cache.counters.misses} / 淘汰 ${cache.counters.evictions}）`)
    }
    for (const [storyId, desk] of svc.researchDesks) {
      lines.push(`案头[${storyId.slice(0, 16)}]：${desk.size} 条在架（累计写入 ${desk.counters.offered}、复用 ${desk.counters.reused}、淘汰 ${desk.counters.evicted}；重载后清零）`)
    }
    return lines
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function executeDeferredBrowserIntent(svc: any, story: InterludeStory, intent: NarrativeIntent, now: Date) {
    const task = captureStoryTask(svc, story.id)
    const query = { id: intent.id, storyId: story.id, status: 'pending' }
    const current = await runStorySerialized(svc, story.id, async () => {
      if (!task.taskCurrent()) return undefined
      return (await svc.dbGet('interlude_intent', query))[0] as NarrativeIntent | undefined
    })
    if (!current || !task.taskCurrent()) return undefined
    let observation: WebObservation | undefined
    let failure: unknown
    try {
      observation = await svc.collectWebObservation(story, browserIntentFromPayload(current.payload), current.participantId, current.id, now)
    } catch (error) {
      failure = error
    }
    return runStorySerialized(svc, story.id, async () => {
      if (!task.taskCurrent() || !(await svc.dbGet('interlude_intent', query)).length || !task.taskCurrent()) return undefined
      let result: WebObservation | undefined
      try {
        if (failure) throw failure
        if (observation) result = await svc.persistCollectedWebObservation(observation, true)
      } catch (error) {
        // Issue #14: an observation failure is terminal, not an endless browser retry.
        svc.reportOperation('standard', 'warn', story, 'advance',
          '延迟网页观察执行失败，意图按失败完成 意图=%d 错误=%s', intent.id, error)
      }
      if (task.taskCurrent()) await svc.dbSet('interlude_intent', query, { status: 'completed', updatedAt: new Date() })
      return result
    })
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function dueIntents(svc: any, storyId: string, now: Date) {
    const intents = await svc.dbGet('interlude_intent', { storyId, status: 'pending', notBefore: { $lte: now } }, {
      sort: { notBefore: 'asc' },
    })
    const expiredAgency = intents.filter((intent: any) => intent.type === 'proactive-check'
      && (!svc.agencyConfig.enabled || !toDate(intent.payload?.expiresAt) || toDate(intent.payload?.expiresAt)! <= now))
    // P3.2：contact-plan 计划过期即终结（§8.1 失效条件），到期回合的通用
    // completed 关闭不受影响。
    const expiredPlans = intents.filter((intent: any) => intent.type === 'contact-plan'
      && toDate((intent.payload?.plan as { expiresAt?: string } | undefined)?.expiresAt) !== undefined
      && toDate((intent.payload?.plan as { expiresAt?: string } | undefined)!.expiresAt)! <= now)
    if (expiredAgency.length || expiredPlans.length) {
      await svc.dbSet('interlude_intent', { id: { $in: [...expiredAgency, ...expiredPlans].map((intent: any) => intent.id) } }, { status: 'cancelled', updatedAt: now })
      for (const intent of expiredPlans) reportContactPlanUpdate(svc, intent, 'cancelled', 'plan-expired')
    }
    // Also sweep future-dated commitments: a repeatedly postponed promise can
    // otherwise remain a zombie and occupy the relationship's two-task budget.
    const followUps = await svc.dbGet('interlude_intent', { storyId, status: 'pending', type: 'follow-up-commitment' }) as NarrativeIntent[]
    const retiredIds = await svc.retireExpiredFollowUps(storyId, followUps, now)
    const expiredIds = new Set([...expiredAgency.map((intent: any) => intent.id), ...expiredPlans.map((intent: any) => intent.id), ...retiredIds])
    return intents.filter((intent: any) => !expiredIds.has(intent.id) && !isActiveConsequence(intent))
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function upcomingNarrativeIntents(svc: any, storyId: string, now: Date) {
    const rows = await svc.dbGet('interlude_intent', {
      storyId, status: 'pending', notBefore: { $gt: now },
    }, { sort: { notBefore: 'asc' }, limit: 30 }) as NarrativeIntent[]
    const internal = new Set(['split-message', 'browser-research', 'narrative-retry', 'proactive-check', 'active-consequence'])
    return rows.filter(intent => !internal.has(intent.type)).slice(0, 8)
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function scheduleDueIntentWake(svc: any, storyId: string, notBefore: Date) {
    const delay = svc.scheduler.scheduleWake(storyId, notBefore, () => svc.wakeDueIntents(storyId))
    if (delay !== undefined) svc.reportStandaloneOperation('diagnostic', 'debug', '已设置到期计时器 故事=%s 触发时间=%s 等待=%dms', storyId, formatLogTime(notBefore, 'Asia/Shanghai'), delay)
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function wakeDueIntents(svc: any, storyId: string): Promise<'busy' | void> {
    if (svc.databaseResetting) return
    const due = await svc.dueIntents(storyId, new Date())
    // Split segments are already committed transport events. Deliver them
    // through the story queue directly; do not make them wait for the
    // five-minute sweep or start another narrator request.
    if (due.some((intent: any) => intent.type === 'split-message')) {
      await svc.deliverDueSplitSegments(storyId)
      if (due.every((intent: any) => intent.type === 'split-message')) return
    }
    if (svc.sweepRunning || svc.hasPendingNarrative(storyId)) return 'busy'
    await svc.sweep()
    // keep-earliest 链闭环：本唤醒可能是为“更早但已被取消/已消费”的意图排定的
    // （新意图注册更晚唤醒时会让位给旧计时器）。计时器空转后自我删除，更晚的
    // pending 意图会失去计时器掉回网格——这里为最早的未到期意图补排。纯 split
    // 分支的早退由 deliverDueSplitSegments 尾部的补排覆盖。
    await svc.scheduleNextPendingWake(storyId)
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function reconcileTerminalSplitIntent(svc: any, storyId: string, intent: NarrativeIntent, now: Date) {
    const ref = restoreMessageEvent(intent.payload, String(intent.payload?.content ?? ''))
    if (!ref || !Number.isSafeInteger(ref.scriptEntryId)) return false
    const entry = (await svc.dbGet('interlude_script_entry', { id: ref.scriptEntryId }))[0] as ScriptEntry | undefined
    if (!entry || entry.storyId !== storyId || entry.metadata?.commitId !== ref.commitId) return false
    const actions = Array.isArray(entry.metadata?.deliveryActions) ? entry.metadata.deliveryActions : []
    const action = actions.find(action => isRecord(action) && action.commitId === ref.commitId && action.eventId === ref.eventId)
    const segment = Array.isArray(action?.segments)
      ? action.segments.find((segment: unknown) => isRecord(segment) && segment.index === ref.bubbleIndex)
      : undefined
    if (segment?.status !== 'delivered' && segment?.status !== 'cancelled') return false
    await svc.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, {
      status: segment.status === 'delivered' ? 'completed' : 'cancelled', updatedAt: now,
    })
    return true
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function pendingSplitSegments(svc: any, storyId: string) {
    return svc.dbGet('interlude_intent', { storyId, status: 'pending', type: 'split-message' }, {
      sort: { notBefore: 'asc' },
    }) as Promise<NarrativeIntent[]>
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function deferDueIntentsBehindPendingSplits(svc: any, story: InterludeStory, due: NarrativeIntent[], splits: NarrativeIntent[], now: Date) {
    if (!splits.length) return due
    const ready: NarrativeIntent[] = []
    for (const intent of due) {
      // Global tasks may choose any recipient. Relationship tasks only wait for
      // that recipient; another participant's chain must not block them.
      const blocking = splits.filter(split => !intent.participantId || split.participantId === intent.participantId)
      if (!blocking.length) { ready.push(intent); continue }
      // 终止界:等待最多再滑 2 小时(自意图创建起算不超过 24h)——分段链端点
      // 长期被门控(offline/冷却/微信 TTL)或标志泄漏时,意图不得无限重排,
      // 到界后放行给正常到期处理而不是继续排队
      const chainDeadline = Math.min(
        now.getTime() + 2 * Time.hour,
        intent.createdAt.getTime() + 24 * Time.hour,
      )
      const afterSplits = Math.min(
        Math.max(now.getTime() + 30 * Time.second,
          ...blocking.map(split => split.notBefore.getTime() + Time.second)),
        chainDeadline,
      )
      const retryAt = new Date(intent.type === 'follow-up-commitment'
        ? Math.min(afterSplits, followUpDeadline(intent).getTime()) : afterSplits)
      // 审计 F2：到界放行。重试时间已被终止界（或跟进截止）截到当下或过去
      // 时，继续按过去时间重排只会形成"到期→拦截→排过去→零延迟唤醒→再
      // 拦截"的循环——真实调度器会安排 delay=0 的定时器无限重扫。此时放行
      // 给正常到期处理（分段链已等待超 24h，视为事实性死链；交付顺序由
      // 下游 split 补偿与账本幂等兜底），并留 standard 级线索供排障。
      if (retryAt.getTime() <= now.getTime()) {
        ready.push(intent)
        svc.reportOperation('standard', 'warn', story, 'intent-due',
          '到期计划等待分段已超终止界，放行正常处理 意图=%d 类型=%s 参与者=%s 待发分段=%d',
          intent.id, intent.type, intent.participantId || '全局', blocking.length)
        continue
      }
      await svc.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, {
        notBefore: retryAt, updatedAt: now,
      })
      // A scheduling wait is NOT a failed promise evaluation; don't increment
      // deferredChecks or extend expiresAt. Every wake rechecks the real chain.
      svc.scheduleDueIntentWake(story.id, retryAt)
      svc.reportOperation('diagnostic', 'debug', story, 'intent-due',
        '到期计划等待已提交分段投递 意图=%d 类型=%s 参与者=%s 待发分段=%d 重查=%s',
        intent.id, intent.type, intent.participantId || '全局', blocking.length, retryAt.toISOString())
    }
    await svc.scheduleNextPendingWake(story.id)
    return ready
  }


/** Restore the earliest timer. Cancellation can leave an already-due survivor. */
export async function scheduleNextPendingWake(svc: any, storyId: string, includeDue = false) {
    const now = new Date()
    const pending = await svc.dbGet('interlude_intent', {
      storyId, status: 'pending',
      type: { $in: WAKE_DRIVEN_INTENT_TYPES },
      ...(includeDue ? {} : { notBefore: { $gt: now } }),
    }, { sort: { notBefore: 'asc' }, limit: 1 })
    const next = pending[0]
    if (next) svc.scheduleDueIntentWake(storyId, next.notBefore < now ? now : next.notBefore)
  }


/** Wake legacy segments and validated private bubble groups through their respective delivery paths. */
export async function deliverDueSplitSegments(svc: any, storyId: string) {
    let privateIntentId: number | undefined
    const generation = svc.taskGeneration(storyId)
    await svc.serial(storyId, async () => {
      if (!svc.taskGenerationCurrent(storyId, generation)) return
      const story = await svc.getStory(storyId)
      const now = new Date()
      const rows = await svc.dbGet('interlude_intent', {
        storyId, status: 'pending', type: 'split-message', notBefore: { $lte: now },
      }, { sort: { notBefore: 'asc' } }) as NarrativeIntent[]
      // A split blocked by an inbound cancellation or an in-flight send must
      // not hide another participant's due split. Those paths rearm on exit.
      const due = rows.filter(intent => !privateBubbleBusy(svc, intent)
        && (!intent.participantId || !svc.interruptedTypingParticipants.has(intent.participantId)))
      const next = due[0]
      if (next && privateBubblePlan(next)) {
        privateIntentId = next.id
        return
      }
      if (next) {
        const intent = next
        const content = clip(intent.payload?.content, svc.config.runtime.maxMessageCharacters)
        const automaticDelivery = automaticDeliveryFromPayload(intent.payload)
        const participant = intent.participantId ? await svc.getParticipant(intent.participantId) : undefined
        if (intent.participantId && svc.interruptedTypingParticipants.has(intent.participantId)) {
          // The incoming-message transaction is queued behind this one. Leave
          // every split intent pending so it can cancel them and carry their
          // exact draft contents into the replacement writing request.
          return
        }
        if (await svc.reconcileTerminalSplitIntent(storyId, intent, now)) {
          // The ledger already confirms or cancels this key. Retire the stale
          // intent without another platform call or character-message row.
        } else if (!content || !participant || participant.status !== 'active') {
          await svc.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, { status: 'cancelled', updatedAt: now })
          const reference = restoreMessageEvent(intent.payload, content || '')
          if (reference) await svc.updateScriptDeliveryOutcome(storyId, reference, 'cancelled', now, 'delivery-target-unavailable')
        } else {
          // Start transport while still holding the story queue. Input that
          // arrived before this point sets interruptedTypingParticipants and
          // cancels the chain; input after this point cannot retract a message
          // whose adapter send has already begun.
          const scriptEvent = restoreMessageEvent(intent.payload, content)
          const message: OutgoingMessageDraft = {
            participantId: participant.id,
            content,
            automaticDelivery,
            ...restoreDesktopContext(intent.payload),
            ...(scriptEvent?.endpointId ? { endpointId: scriptEvent.endpointId } : {}),
            scriptEvent,
          }
          const delivered = await svc.deliverOutgoingMessages(
            story,
            [message],
            undefined,
            undefined,
            (target: any) => svc.interruptedTypingParticipants.has(target.id),
            false, undefined, 'failed', true,
          )
          if (!svc.taskGenerationCurrent(storyId, generation)) return
          if (!delivered.length) {
            if (svc.interruptedTypingParticipants.has(participant.id)) return
            if (message.scriptEvent) await svc.updateScriptDeliveryOutcome(storyId, message.scriptEvent, 'pending', now, 'delivery-unconfirmed-retry-scheduled')
            const retryAt = new Date(now.getTime() + 30 * Time.second)
            await svc.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, { notBefore: retryAt, updatedAt: now })
            svc.scheduleDueIntentWake(storyId, retryAt)
            return
          }
          await svc.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, { status: 'completed', updatedAt: now })
        }
      }
      // When several segments became overdue together, restore a fresh
      // typing interval instead of immediately draining the backlog.
      const remaining = due.slice(1).filter(intent => !privateBubblePlan(intent))
      if (due.slice(1).some(intent => privateBubblePlan(intent))) svc.scheduleDueIntentWake(storyId, new Date())
      if (remaining.length) {
        const following = remaining[0]
        if (following.notBefore <= now) {
          const followingContent = clip(following.payload?.content, svc.config.runtime.maxMessageCharacters)
          if (followingContent) {
            await svc.dbSet('interlude_intent', { id: following.id, status: 'pending' }, {
              notBefore: new Date(now.getTime() + svc.typingDelayMilliseconds(followingContent)), updatedAt: now,
            })
          }
        }
      }
      await svc.scheduleNextPendingWake(storyId)
    })
    if (privateIntentId !== undefined) await deliverPrivateBubbleGroup(svc, storyId, privateIntentId)
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function pendingFollowUpCommitments(svc: any, storyId: string, participantId: string, now = new Date()) {
    const rows = await svc.dbGet('interlude_intent', {
      storyId, participantId, type: 'follow-up-commitment', status: 'pending',
    }, { sort: { notBefore: 'asc' } }) as NarrativeIntent[]
    const retiredIds = await svc.retireExpiredFollowUps(storyId, rows, now)
    return rows.filter(intent => !retiredIds.has(intent.id)).slice(0, 2)
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function retireExpiredFollowUps(svc: any, storyId: string, intents: NarrativeIntent[], now: Date) {
    const retiredIds = new Set<number>()
    for (const intent of intents) {
      const expiresAt = followUpDeadline(intent)
      const reason = expiresAt <= now ? 'follow-up-commitment-expired'
        : followUpDeferredChecks(intent) >= MAX_FOLLOW_UP_DEFERRED_CHECKS ? 'follow-up-deferred-limit' : undefined
      if (reason) {
        await svc.dbSet('interlude_intent', { id: intent.id, storyId, status: 'pending' }, {
          status: 'cancelled', updatedAt: now,
          payload: { ...intent.payload, expiresAt: expiresAt.toISOString(), expired: true, expiredAt: now.toISOString(), cancelReason: reason },
        })
        retiredIds.add(intent.id)
        svc.reportOperation('diagnostic', 'debug', await svc.getStory(storyId), 'intent-due',
          '承诺回访已停止 意图=%d 参与者=%s 原因=%s', intent.id, intent.participantId, reason)
      } else if (!toDate(intent.payload?.expiresAt)) {
        // Legacy rows use creation+24h, never `now+24h` on each read.
        await svc.dbSet('interlude_intent', { id: intent.id, storyId, status: 'pending' }, {
          payload: { ...intent.payload, expiresAt: expiresAt.toISOString() }, updatedAt: now,
        })
      }
    }
    return retiredIds
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function appendFollowUpCommitment(svc: any, 
    story: InterludeStory,
    participantId: string,
    draft: FollowUpCommitmentDraft,
    fallbackSourceEntryId: number | undefined,
    now: Date,
    originDeliveryEventId?: string,
  ) {
    if (originDeliveryEventId) {
      const previous = await svc.dbGet('interlude_intent', {
        storyId: story.id, participantId, type: 'follow-up-commitment', summary: draft.summary,
      }) as NarrativeIntent[]
      if (previous.some(intent => intent.payload?.originDeliveryEventId === originDeliveryEventId)) return
    }
    const pending = await svc.pendingFollowUpCommitments(story.id, participantId, now)
    const key = normalizeFollowUpSummary(draft.summary)
    const duplicate = pending.find((intent: any) => normalizeFollowUpSummary(intent.summary) === key)
    if (duplicate || pending.length >= 2) {
      svc.reportOperation('diagnostic', 'debug', story, 'user-message',
        '承诺回访未重复创建 参与者=%s 原因=%s', participantId, duplicate ? '同一事项待处理' : '待处理上限')
      return
    }
    const sourceEntryIds = [
      ...(draft.sourceEntryIds ?? []).filter((id: any) => Number.isSafeInteger(id) && id > 0),
      ...(fallbackSourceEntryId ? [fallbackSourceEntryId] : []),
    ].slice(-4)
    const expiresAt = followUpExpiresAt(draft.expiresAt, now)
    await svc.appendIntent(story.id, {
      type: 'follow-up-commitment', summary: draft.summary, notBefore: draft.notBefore,
      payload: {
        kind: draft.kind, sourceEntryIds, expiresAt: expiresAt.toISOString(),
        requiresVisibleOutcome: true, userInitiated: true, originDeliveryEventId,
      },
    }, now, participantId)
    svc.scheduleDueIntentWake(story.id, new Date(draft.notBefore))
    svc.reportOperation('standard', 'info', story, 'user-message',
      '已登记承诺回访 参与者=%s 类型=%s 到期=%s', participantId, draft.kind, formatLogTime(new Date(draft.notBefore), story.setting.timezone))
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function applyFollowUpResolutions(svc: any, 
    storyId: string,
    participantId: string,
    resolutions: FollowUpResolutionDraft[],
    interaction: NarrativeInteraction | undefined,
    now: Date,
    deliveryEventId?: string,
  ) {
    if (!resolutions.length || interaction?.reply?.mode !== 'immediate' || !interaction.reply.content?.trim()) return new Set<number>()
    const ids = resolutions.map(item => item.id)
    const rows = await svc.dbGet('interlude_intent', {
      storyId, participantId, type: 'follow-up-commitment', status: 'pending', id: { $in: ids },
    }) as NarrativeIntent[]
    const resolved = new Set<number>()
    for (const resolution of resolutions) {
      const intent = rows.find(item => item.id === resolution.id)
      if (!intent) continue
      if (deliveryEventId && intent.payload?.resolutionEventId === deliveryEventId) {
        resolved.add(intent.id)
        continue
      }
      if (resolution.outcome === 'rescheduled') {
        const nextAt = toDate(resolution.notBefore)
        if (!nextAt || nextAt <= now || nextAt >= followUpDeadline(intent) || nextAt.getTime() - now.getTime() > 12 * Time.hour) continue
        await svc.dbSet('interlude_intent', { id: intent.id }, {
          notBefore: nextAt, payload: { ...intent.payload, reschedules: Number(intent.payload.reschedules ?? 0) + 1, resolutionEventId: deliveryEventId }, updatedAt: now,
        })
        svc.scheduleDueIntentWake(storyId, nextAt)
      } else {
        await svc.dbSet('interlude_intent', { id: intent.id }, {
          status: resolution.outcome === 'cancelled' ? 'cancelled' : 'completed', updatedAt: now,
        })
      }
      resolved.add(intent.id)
    }
    return resolved
  }


/** P7 自 service.ts 意图簿记区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function deferUnresolvedDueFollowUps(svc: any, 
    storyId: string,
    participantId: string,
    contextIntents: NarrativeIntent[],
    resolvedIds: Set<number>,
    _interaction: NarrativeInteraction | undefined,
    now: Date,
  ) {
    const due = contextIntents.filter(intent => intent.type === 'follow-up-commitment' && intent.participantId === participantId)
    if (!due.length) return
    const unresolved = due.filter(intent => !resolvedIds.has(intent.id))
    const retiredIds = await svc.retireExpiredFollowUps(storyId, unresolved, now)
    for (const intent of unresolved) {
      if (retiredIds.has(intent.id)) continue
      const expiresAt = followUpDeadline(intent)
      // Wake at the deadline rather than scheduling another model check past it.
      const retryAt = new Date(Math.min(now.getTime() + 20 * Time.minute, expiresAt.getTime()))
      await svc.dbSet('interlude_intent', { id: intent.id, status: 'pending' }, {
        notBefore: retryAt,
        payload: { ...intent.payload, expiresAt: expiresAt.toISOString(), deferredChecks: followUpDeferredChecks(intent) + 1 },
        updatedAt: now,
      })
      svc.scheduleDueIntentWake(storyId, retryAt)
      svc.reportOperation('diagnostic', 'debug', await svc.getStory(storyId), 'intent-due',
        '承诺回访等待明确结算及完整投递确认，已保留重查 参与者=%s', participantId)
    }
  }


