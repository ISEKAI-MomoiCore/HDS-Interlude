/** 日程预排 runner：每日审查调度、证据收集、模型审查请求与结果落库、
 * 展开与推进锚点。纯策略与表结构在 schedule-preplan.ts。
 * P6 自 service.ts 迁出（2026-10-29），行为不变；宿主经第一参数传入。 */
import { entryLifeHandoff } from './script/life-handoff'
import { timelineEntryPromptProjection } from './chat-artifacts'
import { SCHEDULE_PREPLAN_FOLLOWUP_COOLDOWN_MS, applySchedulePreplanProposal, normalizeSchedulePreplanRecord, schedulePreplanEvidenceMentionsDateChange, refreshSchedulePreplan, resolveSchedulePreplanConfig, schedulePreplanNeedsModel, schedulePreplanReviewDue, schedulePreplanWindow } from './schedule-preplan'
import { calendarDayKey, storyLocalTimeContext } from './time'

import type { SchedulePreplanReviewRequest, SchedulePreplanRecord, InterludeStory, ScriptEntry } from './types'

/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function currentSchedulePreplanWindow(svc: any, story: InterludeStory, at: Date) {
    if (!svc.schedulePreplanConfig.enabled) return schedulePreplanWindow(undefined, at, story.setting.timezone, 12, svc.schedulePreplanConfig)
    const record = await svc.getSchedulePreplan(story.id)
    if (!record) return schedulePreplanWindow(record, at, story.setting.timezone, 12, svc.schedulePreplanConfig)
    const local = storyLocalTimeContext(at, story.setting.timezone)
    const tomorrow = storyLocalTimeContext(new Date(at.getTime() + 86_400_000), story.setting.timezone).date
    if (record.materializedDays.some((day: any) => day.date === local.date || day.date === tomorrow)) {
      return schedulePreplanWindow(record, at, story.setting.timezone, 12, svc.schedulePreplanConfig)
    }
    const refreshed = refreshSchedulePreplan(record, local.date, story.setting.timezone, resolveSchedulePreplanConfig(svc.schedulePreplanConfig), at)
    await svc.saveSchedulePreplan(refreshed)
    svc.reportOperation('standard', 'info', story, 'advance', '日程物化已滞后于今天，本地重物化锚定=%s', local.date)
    return schedulePreplanWindow(refreshed, at, story.setting.timezone, 12, svc.schedulePreplanConfig)
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function getSchedulePreplan(svc: any, storyId: string) {
    const row = (await svc.dbGet('interlude_schedule_preplan', { storyId }))[0]
    return normalizeSchedulePreplanRecord(row)
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function schedulePreplanEvidence(svc: any, storyId: string, afterEntryId: number) {
    // 分页续扫:关闭参与者详情共享时,最早的 60 条可能全部被隐私过滤——
    // 若只读一页就返回空,证据游标永远停在原地,后续新安排永远读不到。
    // 每轮最多扫描 1200 条;被过滤的前缀持久化为检查点,下轮继续而非从头重扫。
    if (svc.sharedStoryConfig.shareParticipantDetails) {
      const filter: any = { storyId, kind: 'script' }
      if (afterEntryId > 0) filter.id = { $gt: afterEntryId }
      const entries = await svc.dbGet('interlude_script_entry', filter, { sort: { id: 'asc' }, limit: 60 }) as ScriptEntry[]
      return { entries, filteredThroughEntryId: afterEntryId, scanComplete: entries.length < 60 }
    }
    // A recurring schedule belongs to the protagonist, but raw private prose
    // must not be sent to the background schedule model. Automatic scripts
    // already carry a host-validated timelinePlan: project that safe ledger
    // instead of dropping every participant-owned life event.
    const project = (entries: ScriptEntry[]) => entries.flatMap(entry => {
      if (!entry.participantId) return [entry]
      if (entry.metadata?.narrativeAuthority === 'original-v2') {
        const handoff = entryLifeHandoff(entry)
        if (!handoff?.activity && !handoff?.place) return []
        // Only the protagonist's small concrete local fields cross into the
        // schedule reader, never private prose, dialogue, presence or quotes.
        return [{ ...entry, participantId: '', content: JSON.stringify({
          sourceEntryId: entry.id, observedAt: entry.occurredAt.toISOString(),
          place: handoff.place?.value, activity: handoff.activity?.value,
        }), metadata: { narrativeAuthority: 'original-v2' } }]
      }
      const projected = timelineEntryPromptProjection(entry)
      return projected === entry ? [] : [{ ...projected, participantId: '' }]
    })
    const collected: ScriptEntry[] = []
    let cursor = afterEntryId
    let filteredThroughEntryId = afterEntryId
    let scanComplete = false
    for (let page = 0; page < 20; page++) {
      const filter: any = { storyId, kind: 'script' }
      if (cursor > 0) filter.id = { $gt: cursor }
      // The pagination key and ordering must agree, including backdated entries.
      const entries = await svc.dbGet('interlude_script_entry', filter, { sort: { id: 'asc' }, limit: 60 }) as ScriptEntry[]
      for (const entry of entries) {
        const visible = project([entry])
        if (!collected.length && !visible.length) filteredThroughEntryId = entry.id
        collected.push(...visible)
      }
      cursor = Math.max(...entries.map(entry => Number(entry.id) || 0), cursor)
      if (entries.length < 60) { scanComplete = true; break }
      if (collected.length >= 60) break
    }
    // Only checkpoint a fully filtered prefix. Never skip an unreviewed visible
    // entry just because later entries in the batch were private.
    return { entries: collected, filteredThroughEntryId, scanComplete }
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function saveSchedulePreplan(svc: any, record: SchedulePreplanRecord) {
    const existing = (await svc.dbGet('interlude_schedule_preplan', { storyId: record.storyId }))[0]
    if (existing) {
      // `storyId` is the table primary key. Minato rejects updates that include
      // a primary-key field, even when the value is unchanged. Keep the key in
      // the lookup only and send a key-free patch to make the review checkpoint
      // actually advance after a successful/empty preplan review.
      const { storyId, ...update } = record
      await svc.dbSet('interlude_schedule_preplan', { storyId }, update)
    }
    else await svc.dbCreate('interlude_schedule_preplan', record)
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function prepareSchedulePreplanReview(svc: any, story: InterludeStory, now: Date) {
    const config = svc.schedulePreplanConfig
    if (!config.enabled) return undefined
    const backoffUntil = svc.schedulePreplanBackoff.get(story.id)
    if (backoffUntil && now.getTime() < backoffUntil) return undefined
    let current = await svc.getSchedulePreplan(story.id)
    const dailyDue = schedulePreplanReviewDue(current, now, story.setting.timezone, config)
    if (!dailyDue && (!current || now.getTime() - current.updatedAt.getTime() < SCHEDULE_PREPLAN_FOLLOWUP_COOLDOWN_MS)) return undefined
    const batch = await svc.schedulePreplanEvidence(story.id, current?.lastEvidenceEntryId ?? 0)
    const evidenceEntries = batch.entries
    const localDate = calendarDayKey(now, story.setting.timezone)
    if (current && batch.filteredThroughEntryId > current.lastEvidenceEntryId) {
      // Scanning is not a model review: preserve its date and cooldown time.
      current = { ...current, lastEvidenceEntryId: batch.filteredThroughEntryId }
      await svc.saveSchedulePreplan(current)
    }
    if (!current && !evidenceEntries.length) {
      const empty = applySchedulePreplanProposal(
        undefined,
        { outcome: 'replace', reason: 'No concrete recurring schedule evidence yet.', regimes: [], exceptions: [] },
        [], localDate, story.setting.timezone, config, now, config.variationLevel,
      )
      if (empty) {
        empty.storyId = story.id
        empty.lastEvidenceEntryId = batch.filteredThroughEntryId
        // A scan budget is not proof that there is no evidence beyond it.
        if (!batch.scanComplete) empty.lastReviewedLocalDate = ''
        await svc.saveSchedulePreplan(empty)
        svc.reportOperation('diagnostic', 'debug', story, 'advance', 'Schedule Preplan 已建立空记录：等待可验证的生活日程证据')
        return { current: empty, evidenceEntries, localDate, needsModel: false, request: undefined }
      }
    }
    if (!evidenceEntries.length && !batch.scanComplete) {
      return { current, evidenceEntries, localDate, needsModel: false, request: undefined }
    }
    if (!dailyDue) {
      const triggers = schedulePreplanEvidenceMentionsDateChange(evidenceEntries)
      if (!triggers.length) return undefined
      svc.reportOperation('diagnostic', 'debug', story, 'advance', 'Schedule Preplan 当天跟进审查：未读证据含改约/取消/新安排信号 条目=%s', triggers.slice(0, 5).join(','))
    }
    const needsModel = schedulePreplanNeedsModel(current, evidenceEntries, localDate, story.setting.timezone, config)
    if (!needsModel && current) {
      await svc.saveSchedulePreplan(refreshSchedulePreplan(current, localDate, story.setting.timezone, config, now))
      svc.reportOperation('diagnostic', 'debug', story, 'advance', 'Schedule Preplan 今日检查完成：没有新证据，日程保持不变')
    }
    const request: SchedulePreplanReviewRequest | undefined = needsModel ? {
      localDate, horizonDays: config.horizonDays, variationLevel: config.variationLevel, current: current ?? null, evidenceEntries,
    } : undefined
    return { current, evidenceEntries, localDate, needsModel, request }
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function requestSchedulePreplan(svc: any, story: InterludeStory, request: SchedulePreplanReviewRequest) {
    if (!svc.compactor.planSchedulePreplan) return undefined
    let proposal = await svc.compactor.planSchedulePreplan(request)
    if (proposal) return proposal
    svc.reportOperation('diagnostic', 'warn', story, 'advance', 'Schedule Preplan 返回为空，正在进行一次轻量恢复重试')
    proposal = await svc.compactor.planSchedulePreplan(request)
    return proposal
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function persistSchedulePreplanReview(svc: any, 
    story: InterludeStory,
    review: { current?: SchedulePreplanRecord; evidenceEntries: ScriptEntry[]; localDate: string },
    proposal: unknown,
    now: Date,
  ) {
    const next = applySchedulePreplanProposal(
      review.current, proposal, review.evidenceEntries, review.localDate,
      story.setting.timezone, svc.schedulePreplanConfig, now, svc.schedulePreplanConfig.variationLevel,
    )
    if (!next) {
      // A narrow review can still fail on an unstable provider. On first use,
      // persist an explicit empty review with the inspected evidence cursor:
      // this is truthful, prevents a full retry loop, and new evidence will
      // naturally make the next review due again.
      if (!review.current) {
        const empty = applySchedulePreplanProposal(
          undefined,
          { outcome: 'unchanged', reason: 'Schedule review returned no valid structure; waiting for new concrete evidence.', regimes: [], exceptions: [] },
          review.evidenceEntries, review.localDate, story.setting.timezone, svc.schedulePreplanConfig, now, svc.schedulePreplanConfig.variationLevel,
        )
        if (empty) {
          empty.storyId = story.id
          await svc.saveSchedulePreplan(empty)
          svc.reportOperation('standard', 'warn', story, 'advance', 'Schedule Preplan 未形成有效日程，已保存空审查记录并等待新证据')
          return true
        }
      }
      svc.reportOperation('standard', 'warn', story, 'advance', 'Schedule Preplan 未更新：模型没有返回可用日程，保留现有版本')
      return false
    }
    next.storyId = story.id
    await svc.saveSchedulePreplan(next)
    svc.reportOperation('standard', 'info', story, 'advance', 'Schedule Preplan 已审查 版本=%d 覆盖=%s→%s 原因=%s', next.revision, next.validFrom, next.validThrough, next.reviewReason)
    return true
  }

