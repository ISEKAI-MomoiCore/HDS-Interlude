/** 记忆压缩管线：三阶段纪律（锁内快照 → 锁外模型+embedding → 锁内复查
 * 落库）——模型调用绝不占用故事串行队列；调度路径经 scheduler 独占门与
 * 指纹冷却（scheduler.ts，外部基础设施）。覆盖：后台扫描/手动入口/调度
 * 注册、场景压缩、事实提取与落库、状态补丁与 Overlay 演化、在场表更新、
 * 事实向量补齐。
 *
 * P5 自 service.ts 迁出（2026-10-29），行为不变。函数接收宿主（service 实例
 * 或测试假宿主）为第一参数——与 delivery/pipeline.ts 等同一形态；service.ts
 * 保留同名薄委托，既有调用点与测试零改动。压缩器模型实例（compactor/
 * embedder）与状态字段留守 service，经宿主引用访问。 */
/** D4：时间常量本地化（原 koishi Time），叙事侧去 koishi 运行时依赖。 */
const Time = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const
import { normalizeFocusDraft } from '../life-rhythm'
import { entryLifeHandoff } from '../script/life-handoff'
import { advanceAttentionWords, type AttentionWordState } from '../narrative/attention-words'
import { SCHEDULE_PREPLAN_RETRY_BACKOFF } from '../schedule-preplan'
import { decodeStoryState, encodeStoryState, lifeRhythmFromScript } from '../story-state'
import { compactionPrefix, assertContinuityReview } from '../script/continuity-checkpoint'
import { promptReadyDevelopment, developmentDimension, reviewedDevelopmentSupport } from '../script/development'
import { groundedEpisodeTags } from '../script/episode-index'
import { normalizeKnowledgeEvidence, supportsRecordedOutcome } from '../script/knowledge-evidence'
import { clip, normalizeFact, factContentLooksAmbiguous, limitEntriesByCharacters, normalizeParticipantState, hasCompactionEvidence, clampNumber, resolveParticipantId, normalizeScenePresenceDrafts, groupOverlayPatches, groupOverlaySnapshots, normalizeMajorEvents, mergeNote, patchClaimsMatch, statePatchEvidence } from '../narrative-normalizers'
import type { ScriptEntry, InterludeStory, InterludeScene, InterludeParticipant, NarrativeFact, StatePatchDraft, StatePatchProposal, OverlaySnapshot, WorkingDetail, CompactionDecision, CompactionRequest } from '../types'


export interface PreparedCompactionSkip {
  phase: 'skip'
  overlayCompacted: boolean
}

export interface PreparedCompactionRun {
  phase: 'run'
  overlayCompacted: boolean
  scene: InterludeScene
  sceneEntries: ScriptEntry[]
  chars: number
  sceneCompactionDue: boolean
  current: InterludeStory
  participants: InterludeParticipant[]
  visibleCompactionFacts: NarrativeFact[]
  compactRequest: CompactionRequest
  fingerprint: string
  factEmbeddings?: Map<string, number[]>
}

export type PreparedCompaction = PreparedCompactionSkip | PreparedCompactionRun

/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function compactStory(svc: any, story: InterludeStory, force = true) {
    if (svc.desktopRuntimePhase === 'paused') return false
    if (!svc.canHandleStory(story)) return false
    const generation = svc.taskGeneration(story.id)
    // 三阶段(与调度器路径同构):队列内快照 → 队列外模型+embedding → 队列内落库。
    // 此前手动/强制路径整体在串行队列内执行,embedding 网络调用阻塞直播回合。
    return svc.compactThreePhase(story.id, force, generation)
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function compactOverlay(svc: any, story: InterludeStory) {
    if (!svc.canHandleStory(story)) return false
    return svc.serial(story.id, async () => svc.compactOverlayUnlocked(await svc.getStory(story.id), new Date()))
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function compactionCheckpointAdvanced(svc: any, context: PreparedCompactionRun) {
    const expectedLastEntryId = context.sceneEntries.at(-1)?.id
    if (!expectedLastEntryId) return true
    const persisted = (await svc.dbGet('interlude_scene', { id: context.scene.id }))[0] as InterludeScene | undefined
    return !!persisted && ((persisted.lastEntryId ?? 0) >= expectedLastEntryId || persisted.status === 'closed')
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function scheduleCompaction(svc: any, storyId: string) {
    if (!svc.memoryConfig.enabled && !svc.schedulePreplanConfig.enabled) return
    // P1: 去重门/让路等待/收尾释放由 scheduler 拥有；Phase 1-3 执行体在下方回调，
    // 排队时捕获的 generation 穿透整个执行体（purge/pause 后任务作废）。
    const generation = svc.taskGeneration(storyId)
    svc.scheduler.scheduleExclusive(storyId, async () => {
        // Phase 1 (serial): cheap reads and due checks. The queue MUST be
        // released before the compactor call — a promise-chain serial cannot
        // be re-entered from inside one of its own running tasks (that
        // deadlocks the whole story queue), so the expensive model call runs
        // unqueued and only the cheap DB writes re-acquire it afterwards.
        const prepared = await svc.serial(storyId, async () => {
          if (!svc.taskGenerationCurrent(storyId, generation)) return undefined
          if (svc.hasPendingNarrative(storyId)) return undefined
          const story = await svc.getStory(storyId)
          const review = await svc.prepareSchedulePreplanReview(story, new Date())
          const context = await svc.prepareCompaction(story, new Date(), false)
          return { story, review, context }
        })
        if (!prepared || (!prepared.review?.needsModel && (!prepared.context || prepared.context.phase === 'skip'))) return
        // Phase 2: the expensive model call, deliberately outside the queue.
        const startedAt = Date.now()
        const context = prepared.context?.phase === 'run' ? prepared.context : undefined
        svc.reportOperation('standard', 'info', prepared.story, 'advance', '后台整理开始 条目=%d 字符=%d 场景压缩=%s SchedulePreplan=%s', context?.sceneEntries.length ?? 0, context?.chars ?? 0, context?.sceneCompactionDue ?? false, !!prepared.review?.needsModel)
        let scheduleProposal: unknown = undefined
        if (prepared.review?.needsModel && prepared.review.request) {
          try {
            scheduleProposal = await svc.requestSchedulePreplan(prepared.story, prepared.review.request)
          } catch (error) {
            // Keep the review checkpoint moving even when a provider throws
            // before returning a proposal. The persistence phase will retain
            // the existing plan (or create an empty first review), preventing
            // the same daily request from firing on every maintenance sweep.
            svc.report('warn', prepared.story, 'advance', 'Schedule Preplan 调用失败，将保存本日审查状态：%s', error)
          }
        }
        let decision: CompactionDecision = {}
        let compactionError: unknown = undefined
        if (context) {
          if (!svc.taskGenerationCurrent(storyId, generation)) return
          try {
            decision = await svc.compactor.compact(context.compactRequest)
            if (!svc.taskGenerationCurrent(storyId, generation)) return
            if (context.sceneCompactionDue) {
              context.factEmbeddings = await svc.prepareCompactionEmbeddings(storyId, decision, context.sceneEntries)
            }
          } catch (error) {
            compactionError = error
            svc.noteCompactionFailure(storyId, context.fingerprint, error)
            svc.report('warn', context.current, 'advance', '记忆压缩失败：%s', error)
          }
        }
        // Phase 3 (serial): cheap DB writes, re-queued after the model call.
        try {
          await svc.serial(storyId, async () => {
            if (!svc.taskGenerationCurrent(storyId, generation)) return
            if (prepared.review?.needsModel) {
              const persisted = await svc.persistSchedulePreplanReview(prepared.story, prepared.review, scheduleProposal, new Date())
              if (persisted) svc.schedulePreplanBackoff.delete(storyId)
              else svc.schedulePreplanBackoff.set(storyId, Date.now() + SCHEDULE_PREPLAN_RETRY_BACKOFF)
            }
            // Schedule Preplan is independent background work. A scene
            // compaction failure must not discard its already completed
            // review; simply leave the scene for its own retry cooldown.
            if (context && !compactionError) {
              await svc.applyCompaction(context.current, context, decision, new Date(), startedAt)
              if (!await svc.compactionCheckpointAdvanced(context)) {
                throw new Error(`Compaction checkpoint did not advance (scene=${context.scene.id}, expected=${context.sceneEntries.at(-1)?.id ?? 0})`)
              }
            }
          })
          if (context && !compactionError) svc.scheduler.clearBackoff(storyId)
        } catch (error) {
          if (context && !compactionError) svc.noteCompactionFailure(storyId, context.fingerprint, error)
          throw error
        }
    }, {
      halted: () => svc.desktopRuntimePhase === 'paused' || svc.databaseResetting,
      // Let an active or debounced user turn go first. This keeps compaction
      // fully off the latency-sensitive path even during a busy conversation.
      defer: () => {
        if (!svc.hasPendingNarrative(storyId)) return false
        svc.reportStandaloneOperation('diagnostic', 'debug', '记忆整理等待前台回合结束 故事=%s', storyId)
        return true
      },
      onQueued: () => svc.reportStandaloneOperation('diagnostic', 'debug', '记忆整理已排队 故事=%s', storyId),
    })
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function compactStories(svc: any) {
    if (svc.desktopRuntimePhase === 'paused' || (!svc.memoryConfig.enabled && !svc.schedulePreplanConfig.enabled) || svc.compactionSweepRunning) return
    svc.compactionSweepRunning = true
    try {
      const story = await svc.getCanonicalStory()
      if (!story || !svc.canHandleStory(story)) return
      if (svc.memoryConfig.enabled) svc.scheduleFactEmbeddingBackfill(story.id)
      if (svc.config.model.embedding?.semanticHistory) {
        void svc.backfillHistoryEmbeddings(story.id)
          .catch((error: any) => svc.reportStandaloneOperation('diagnostic', 'debug', '历史向量补齐跳过 错误=%s', error))
      }
      svc.scheduleCompaction(story.id)
    } finally {
      svc.compactionSweepRunning = false
    }
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function compactThreePhase(svc: any, storyId: string, force: boolean, generation?: string) {
    const startedAt = Date.now()
    const prepared = await svc.serial(storyId, async () => {
      if (generation && !svc.taskGenerationCurrent(storyId, generation)) return undefined
      const story = await svc.getStory(storyId)
      if (story.status !== 'active') return undefined
      const review = await svc.prepareSchedulePreplanReview(story, new Date())
      const context = await svc.prepareCompaction(story, new Date(), force)
      return { story, review, context }
    })
    if (!prepared || (!prepared.review?.needsModel && (!prepared.context || prepared.context.phase === 'skip'))) {
      return prepared?.context?.overlayCompacted ?? false
    }
    const { story, review, context } = prepared
    // Phase 2:模型与 embedding 都在队列外(网络调用不阻塞直播)
    let scheduleProposal: unknown = undefined
    if (review?.needsModel && review.request) {
      try { scheduleProposal = await svc.requestSchedulePreplan(story, review.request) }
      catch (error) {
        svc.report('warn', story, 'advance', 'Schedule Preplan 调用失败，将保存本日审查状态：%s', error)
      }
    }
    let decision: CompactionDecision = {}
    if (context?.phase === 'run') {
      svc.reportOperation('standard', 'info', story, 'advance', '后台整理开始(手动) 条目=%d 字符=%d', context.sceneEntries.length, context.chars)
      try {
        decision = await svc.compactor.compact(context.compactRequest)
        if (context.sceneCompactionDue) {
          context.factEmbeddings = await svc.prepareCompactionEmbeddings(storyId, decision, context.sceneEntries)
        }
      } catch (error) {
        svc.noteCompactionFailure(storyId, context.fingerprint, error)
        svc.report('warn', story, 'advance', '记忆压缩失败：%s', error)
        return false
      }
    }
    // Phase 3:队列内轻量落库
    return await svc.serial(storyId, async () => {
      if (generation && !svc.taskGenerationCurrent(storyId, generation)) return false
      const freshStory = await svc.getStory(storyId)
      if (freshStory.status !== 'active') return false
      if (review?.needsModel && review.request) {
        const persisted = await svc.persistSchedulePreplanReview(freshStory, review, scheduleProposal, new Date())
        if (persisted) svc.schedulePreplanBackoff.delete(storyId)
        else svc.schedulePreplanBackoff.set(storyId, Date.now() + SCHEDULE_PREPLAN_RETRY_BACKOFF)
      }
      if (!context || context.phase === 'skip') return context?.overlayCompacted ?? false
      try {
        const result = await svc.applyCompaction(freshStory, context, decision, new Date(), startedAt)
        if (!await svc.compactionCheckpointAdvanced(context)) {
          throw new Error(`Compaction checkpoint did not advance (scene=${context.scene.id}, expected=${context.sceneEntries.at(-1)?.id ?? 0})`)
        }
        svc.scheduler.clearBackoff(storyId)
        return result
      } catch (error) {
        svc.noteCompactionFailure(storyId, context.fingerprint, error)
        svc.report('warn', freshStory, 'advance', '记忆整理落库失败：%s', error)
        return false
      }
    })
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function prepareCompaction(svc: any, story: InterludeStory, now: Date, force: boolean): Promise<PreparedCompaction | undefined> {
    await svc.ensureContinuity(story, now)
    const overlayCompacted = svc.memoryConfig.enabled ? await svc.compactOverlayUnlocked(story, now) : false
    const scene = await svc.activeScene(story.id)
    if (!scene) return { phase: 'skip', overlayCompacted }
    // lastEntryId 将场景摘要变成增量检查点：已经压缩过的原文不再重复传给模型。
    const entryFilter: any = { storyId: story.id, occurredAt: { $gte: scene.startedAt } }
    if (scene.lastEntryId != null) {
      entryFilter.id = { $gt: scene.lastEntryId }
      delete entryFilter.occurredAt
    }
    // 管理员软删的墓碑(kind='redacted')不进压缩:占阈值、污染摘要、还会把
    // 场景关闭边界推到墓碑时间戳——recentEntries 等读取路径均有同款过滤
    const entries = ((await svc.dbGet('interlude_script_entry', entryFilter, {
      limit: Math.max(svc.memoryConfig.compactionEntryLimit * 2, svc.memoryConfig.compactionEntryLimit),
      sort: { id: 'asc' },
    })) as ScriptEntry[]).filter(entry => entry.kind !== 'redacted')
    const sceneEntries = compactionPrefix(entries, svc.memoryConfig.compactionCharacterLimit)
    const chars = sceneEntries.reduce((sum, entry) => sum + entry.content.length, 0)
    const sceneCompactionDue = svc.memoryConfig.enabled && sceneEntries.length > 0
      && (force || entries.length >= svc.memoryConfig.sceneEntryThreshold
        || entries.reduce((sum, entry) => sum + entry.content.length, 0) >= svc.memoryConfig.sceneCharacterThreshold)
    if (!sceneCompactionDue) {
      svc.reportOperation('diagnostic', 'debug', story, 'advance', '记忆整理跳过：未达到阈值 条目=%d/%d 字符=%d/%d', sceneEntries.length, svc.memoryConfig.sceneEntryThreshold, chars, svc.memoryConfig.sceneCharacterThreshold)
      return { phase: 'skip', overlayCompacted }
    }
    const fingerprint = svc.compactionFingerprint(scene, sceneEntries, chars)
    if (!force && svc.compactionIsBackedOff(story.id, fingerprint)) return { phase: 'skip', overlayCompacted }
    const current = await svc.getStory(story.id)
    const participants = await svc.participants(story.id)
    const preceding = scene.lastEntryId == null ? [] : ((await svc.dbGet('interlude_script_entry', {
      storyId: story.id, id: { $lte: scene.lastEntryId },
    }, { limit: 12, sort: { id: 'desc' } })) as ScriptEntry[]).filter(entry => entry.kind !== 'redacted')
    // The backstage editor reviews this story's originals, not another user's
    // history view. Audience-specific history filtering stays on live turns.
    const precedingEntries = limitEntriesByCharacters(preceding.reverse(), 8_000)
    const visibleCompactionFacts = svc.memoryConfig.enabled
      ? await svc.facts(story.id, svc.memoryConfig.maxFactsPerStory)
      : []
    const rawDevelopmentCandidates = (await svc.dbGet('interlude_state_patch', { storyId: story.id, status: { $in: ['proposed', 'applied'] } },
      { limit: 50, sort: { createdAt: 'desc' } }) as StatePatchProposal[])
      .filter(item => item.path.startsWith('development.') && (svc.sharedStoryConfig.shareParticipantDetails || !item.participantId))
    const candidateSourceIds = Array.from(new Set(rawDevelopmentCandidates.flatMap(item => item.sourceEntryIds))).slice(0, 1_000)
    const candidateSources = candidateSourceIds.length
      ? ((await svc.dbGet('interlude_script_entry', { storyId: story.id, id: { $in: candidateSourceIds } })) as ScriptEntry[])
        .filter(entry => entry.kind !== 'redacted')
      : []
    const developmentCandidates = rawDevelopmentCandidates.filter(item => promptReadyDevelopment(item, candidateSources))
    return {
      phase: 'run', overlayCompacted, scene, sceneEntries, chars, sceneCompactionDue, current, participants,
      visibleCompactionFacts,
      fingerprint,
      compactRequest: {
        story: current, from: scene.startedAt, now, entries: sceneEntries.filter(entry => !!entry.content.trim()),
        scene, arc: await svc.activeArc(story.id), participants, precedingEntries, developmentCandidates,
        facts: visibleCompactionFacts,
      },
    }
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function applyCompaction(svc: any, story: InterludeStory, context: PreparedCompactionRun, decision: CompactionDecision, now: Date, startedAt: number) {
    if (context.sceneCompactionDue) {
      await svc.persistCompaction(context.current, context.scene, decision, context.sceneEntries, now,
        new Set(context.visibleCompactionFacts.map(fact => fact.id)), context.compactRequest.precedingEntries, context.factEmbeddings)
    }
    svc.reportOperation('standard', 'info', story, 'advance', '后台整理完成 耗时=%dms 剧本条目=%d 模型提取事实=%d 模型提取发展提案=%d', Date.now() - startedAt, context.sceneCompactionDue ? context.sceneEntries.length : 0, context.sceneCompactionDue ? decision.facts?.length ?? 0 : 0, context.sceneCompactionDue ? decision.statePatches?.length ?? 0 : 0)
    // I-7 观察性产出：压缩评估成功 → 推进生活关注词滞回状态机（尽力而为）。
    await advanceStoryAttentionWords(svc, context.current.id, decision, context.sceneEntries, now)
    return true
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function compactOverlayUnlocked(svc: any, story: InterludeStory, now: Date) {
    const config = svc.memoryConfig
    if (!config.overlayCompressionEnabled) return false
    try {
    const recentCutoff = new Date(now.getTime() - (config.overlayRecentDays ?? 2) * Time.day)
    const monthlyCutoff = new Date(now.getTime() - (config.overlayMonthlyAfterDays ?? 10) * Time.day)
    const applied = await svc.dbGet('interlude_state_patch', { storyId: story.id, status: 'applied' }, { sort: { appliedAt: 'asc' } }) as StatePatchProposal[]
    const weekly = applied.filter(patch => !patch.path.startsWith('development.') && (patch.appliedAt ?? patch.createdAt) <= recentCutoff)
    let changed = false
    for (const group of groupOverlayPatches(weekly, config.overlayWeeklyWindowDays ?? 5)) {
      const existing = (await svc.dbGet('interlude_overlay_snapshot', {
        storyId: story.id, participantId: group.participantId, target: group.target, tier: 'weekly', periodStart: group.from,
      }))[0] as OverlaySnapshot | undefined
      if (existing) continue
      const participant = group.participantId ? await svc.getParticipant(group.participantId) : undefined
      const decision = await svc.compactor.compactOverlay({ story, participant, target: group.target, tier: 'weekly', from: group.from, to: group.to, patches: group.patches })
      const summary = clip(decision.summary, config.overlayWeeklySummaryCharacters ?? 1_600)
      if (!summary) continue
      await svc.dbCreate('interlude_overlay_snapshot', {
        storyId: story.id, participantId: group.participantId, target: group.target, tier: 'weekly', periodStart: group.from, periodEnd: group.to,
        summary, majorEvents: normalizeMajorEvents(decision.majorEvents, group.patches), sourcePatchIds: group.patches.map(patch => patch.id), status: 'active', createdAt: now, updatedAt: now,
      })
      for (const patch of group.patches) await svc.dbSet('interlude_state_patch', { id: patch.id }, { status: 'compacted' })
      changed = true
    }

    const snapshots = await svc.dbGet('interlude_overlay_snapshot', { storyId: story.id, tier: 'weekly', status: 'active' }, { sort: { periodEnd: 'asc' } }) as OverlaySnapshot[]
    for (const group of groupOverlaySnapshots(snapshots.filter(snapshot => snapshot.periodEnd <= monthlyCutoff), config.overlayMonthlyWindowDays ?? 10)) {
      const existing = (await svc.dbGet('interlude_overlay_snapshot', {
        storyId: story.id, participantId: group.participantId, target: group.target, tier: 'monthly', periodStart: group.from,
      }))[0] as OverlaySnapshot | undefined
      if (existing) continue
      const participant = group.participantId ? await svc.getParticipant(group.participantId) : undefined
      const decision = await svc.compactor.compactOverlay({ story, participant, target: group.target, tier: 'monthly', from: group.from, to: group.to, patches: [], snapshots: group.snapshots })
      const summary = clip(decision.summary, config.overlayMonthlySummaryCharacters ?? 2_400)
      if (!summary) continue
      await svc.dbCreate('interlude_overlay_snapshot', {
        storyId: story.id, participantId: group.participantId, target: group.target, tier: 'monthly', periodStart: group.from, periodEnd: group.to,
        summary, majorEvents: normalizeMajorEvents(decision.majorEvents, [], group.snapshots), sourcePatchIds: group.snapshots.flatMap(snapshot => snapshot.sourcePatchIds), status: 'active', createdAt: now, updatedAt: now,
      })
      for (const snapshot of group.snapshots) await svc.dbSet('interlude_overlay_snapshot', { id: snapshot.id }, { status: 'superseded', updatedAt: now })
      changed = true
    }
    if (changed) {
      await svc.rebuildLiveOverlayState(story, now)
      svc.reportOperation('standard', 'info', story, 'advance', 'Overlay 分层归档完成：最近 %d 天保留原始补丁，短期窗口=%d天，长期窗口=%d天', config.overlayRecentDays ?? 2, config.overlayWeeklyWindowDays ?? 5, config.overlayMonthlyWindowDays ?? 10)
    }
    return changed
    } catch (error) {
      // Overlay maintenance is optional background work. A bad compression
      // response must leave raw patches untouched and never block narration.
      svc.reportOperation('standard', 'warn', story, 'advance', 'Overlay 分层归档跳过：%s', error)
      return false
    }
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function rebuildLiveOverlayState(svc: any, story: InterludeStory, now: Date) {
    const [applied, snapshots] = await Promise.all([
      (svc.dbGet('interlude_state_patch', { storyId: story.id, status: 'applied' }) as Promise<StatePatchProposal[]>)
        .then(rows => rows.filter(item => !item.path.startsWith('development.'))),
      svc.dbGet('interlude_overlay_snapshot', { storyId: story.id, status: 'active' }) as Promise<OverlaySnapshot[]>,
    ])
    // 统一语义:overlay 字段恒等于"全部未压缩(仍为 applied)补丁"的合并。
    // 此前仅当该 target 已存在压缩快照时才重建——无快照的新故事、以及关闭
    // 压缩的实例,applied 补丁永远进不了 overlay,演化要等首个压缩周期才可见。
    const overlay = { ...(story.state.settingOverlay ?? {}) }
    const mergeGlobal = (target: StatePatchProposal['target']) => {
      for (const patch of applied.filter(item => !item.participantId && item.target === target)) {
        if (target === 'character' && patch.path.includes('trait')) {
          overlay.characterTraits = [...(overlay.characterTraits ?? []), clip(patch.proposedValue, 500)]
        } else {
          overlay[target as 'characterProfile' | 'perspective' | 'world' | 'relationship'] =
            mergeNote(overlay[target as 'characterProfile' | 'perspective' | 'world' | 'relationship'], patch.proposedValue)
        }
      }
    }
    overlay.characterProfile = undefined
    overlay.characterTraits = []
    overlay.perspective = undefined
    overlay.world = undefined
    overlay.relationship = undefined
    mergeGlobal('character')
    mergeGlobal('perspective')
    mergeGlobal('world')
    mergeGlobal('relationship')
    overlay.characterTraits = Array.from(new Set(overlay.characterTraits ?? [])).slice(-30)
    await svc.dbSet('interlude_story', { id: story.id }, { state: encodeStoryState({ ...decodeStoryState(story.state), settingOverlay: overlay }), updatedAt: now })

    const participantIds = Array.from(new Set([
      ...snapshots.filter(snapshot => snapshot.target === 'relationship' && !!snapshot.participantId).map(snapshot => snapshot.participantId),
      ...applied.filter(patch => patch.target === 'relationship' && !!patch.participantId).map(patch => patch.participantId),
    ]))
    for (const participantId of participantIds) {
      const participant = await svc.getParticipant(participantId)
      if (!participant) continue
      const state = normalizeParticipantState(participant.state)
      state.relationshipOverlay = undefined
      for (const patch of applied.filter(item => item.target === 'relationship' && item.participantId === participantId)) {
        state.relationshipOverlay = mergeNote(state.relationshipOverlay, patch.proposedValue)
      }
      await svc.dbSet('interlude_participant', { id: participant.id }, { state, updatedAt: now })
    }
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function prepareCompactionEmbeddings(svc: any, storyId: string, decision: CompactionDecision, entries: ScriptEntry[]) {
    const vectors = new Map<string, number[]>()
    if (!decision.facts?.length) return vectors
    const generation = svc.taskGeneration(storyId)
    const existing = await svc.dbGet('interlude_fact', { storyId, status: 'active' })
    for (const draft of decision.facts) {
      const content = clip(draft.content, svc.memoryConfig.factContentCharacters)
      if (!content || !hasCompactionEvidence(draft.sourceEntryIds, entries)
        || factContentLooksAmbiguous(draft.scope, content)) continue
      const key = normalizeFact(content)
      if (vectors.has(key)) continue
      if (!svc.taskGenerationCurrent(storyId, generation)) return vectors
      const same = existing.find((fact: any) => normalizeFact(fact.content) === key && fact.embedding?.length)
      const vector = same?.embedding ?? await svc.embedText(content, { purpose: '事实向量（压缩）', density: 'diagnostic' })
      if (!svc.taskGenerationCurrent(storyId, generation)) return vectors
      vectors.set(key, vector)
    }
    return vectors
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function persistCompaction(svc: any, story: InterludeStory, scene: InterludeScene, decision: CompactionDecision, entries: ScriptEntry[], now: Date, visibleFactIds = new Set<number>(), precedingEntries: ScriptEntry[] = [], factEmbeddings?: Map<string, number[]>) {
    const generation = svc.taskGeneration(story.id)
    const prepared = factEmbeddings ?? await svc.prepareCompactionEmbeddings(story.id, decision, entries)
    const commit = async () => {
      if (svc.databaseResetting || svc.taskGeneration(story.id) !== generation) throw new Error('Compaction generation is obsolete')
      const fresh = (await svc.dbGet('interlude_scene', { storyId: story.id, id: scene.id }))[0] as InterludeScene | undefined
      if (!fresh || fresh.status === 'closed' || (fresh.lastEntryId ?? null) !== (scene.lastEntryId ?? null)) {
        throw new Error('Compaction scene checkpoint changed; prepare a fresh review')
      }
      await svc.persistCompactionOutputs(story, scene, decision, entries, now, visibleFactIds, precedingEntries, prepared)
    }
    await svc.dbWrite(async () => {
      svc.transactionRunning = true
      try {
        await svc.ctx.database.withTransaction((database: any) => svc.transactionScope.run(database, commit))
      } finally { svc.transactionRunning = false }
    })
    svc.scheduleFactEmbeddingBackfill(story.id)
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function persistCompactionOutputs(svc: any, story: InterludeStory, scene: InterludeScene, decision: CompactionDecision, entries: ScriptEntry[], now: Date, visibleFactIds = new Set<number>(), precedingEntries: ScriptEntry[] = [], factEmbeddings = new Map<string, number[]>()) {
    assertContinuityReview(decision)
    if (!entries.length) return
    for (const draft of decision.episodeTags ?? []) {
      const source = entries.find(entry => entry.id === draft.sourceEntryId)
      if (!source) continue
      const tags = groundedEpisodeTags(source.content, draft)
      if (!Object.keys(tags).length) continue
      const current = (await svc.dbGet('interlude_script_entry', { storyId: story.id, id: source.id }))[0] as ScriptEntry | undefined
      if (!current) continue
      await svc.dbSet('interlude_script_entry', { id: source.id }, { metadata: { ...current.metadata, episodeTags: tags } })
      svc.invalidateHistoryVectors(story.id)
    }
    // Commit the arc before acknowledging the incremental evidence. A failed
    // arc write must not silently discard the material it was to learn from.
    const arc = await svc.activeArc(story.id)
    if (!arc) throw new Error('Continuity review has no active arc')
    await svc.dbSet('interlude_arc', { id: arc.id }, {
      title: clip(decision.arc!.title?.trim() || arc.title, 255),
      summary: clip(decision.arc!.summary!, svc.memoryConfig.arcSummaryCharacters), updatedAt: now,
    })
    const scenePatch = decision.scene ?? {}
    const presenceUpdates = normalizeScenePresenceDrafts(scenePatch.presence, entries, now)
    const focusDraft = decision.lifeRhythm
    const evidence = focusDraft && entries.find(entry => entry.id === focusDraft.sourceEntryId && entry.kind === 'script' && entry.actor === 'narrator')
    const focus = evidence && normalizeFocusDraft(focusDraft, evidence.content)
    if (focus && evidence) {
      // The model runs outside the story queue and can see only a prefix of the scene.
      const [latest] = await svc.dbGet('interlude_script_entry', { storyId: story.id, kind: 'script', actor: 'narrator' }, { limit: 1, sort: { id: 'desc' } }) as ScriptEntry[]
      if (latest?.id === evidence.id && !entryLifeHandoff(latest)?.focus && normalizeFocusDraft(focus, latest.content)) {
        const current = await svc.getStory(story.id)
        const state = decodeStoryState(current.state)
        const assessmentAfterEvidence = !!state.lifeRhythm?.assessedAt
          && Date.parse(state.lifeRhythm.assessedAt) > latest.occurredAt.getTime()
        if ((state.lifeRhythm?.sourceEntryId ?? 0) < evidence.id && !assessmentAfterEvidence) {
          const lifeRhythm = lifeRhythmFromScript(focus, latest, 'compactor')
          await svc.dbSet('interlude_story', { id: current.id }, {
            state: encodeStoryState({ ...state, lifeRhythm }), updatedAt: now,
          })
          svc.reportOperation('diagnostic', 'debug', story, 'advance', '补记生活节奏 节奏=%s 剧本=%d', focus.attention, evidence.id)
        }
      }
    }
    if (presenceUpdates.length) {
      const current = await svc.getStory(story.id)
      const state = decodeStoryState(current.state)
      const byName = new Map(state.scenePresence.map(item => [item.name, item]))
      for (const update of presenceUpdates) {
        if (Math.max(...update.sourceEntryIds) < (state.sceneFrame?.localBoundaryEntryId ?? 0)) continue
        const previous = byName.get(update.name)
        if (previous && Math.max(...previous.sourceEntryIds) > Math.max(...update.sourceEntryIds)) continue
        byName.set(update.name, update)
      }
      await svc.dbSet('interlude_story', { id: current.id }, {
        state: encodeStoryState({ ...state, scenePresence: [...byName.values()].slice(-8) }), updatedAt: now,
      })
    }
    if (decision.workingDetails?.length) {
      const current = await svc.getStory(story.id)
      const state = decodeStoryState(current.state)
      const merged = new Map<string, WorkingDetail>()
      const resolutions = { ...state.workingDetailResolutions }
      for (const item of state.workingDetails ?? []) merged.set(item.label, item)
      for (const draft of decision.workingDetails) {
        if (!hasCompactionEvidence(draft.sourceEntryIds ?? [], entries)) continue
        const label = clip(draft.label, 80).trim()
        const revision = Math.max(...(draft.sourceEntryIds ?? []).filter(id => entries.some(entry => entry.id === id)))
        if (revision <= (resolutions[label] ?? 0)) continue
        const previous = merged.get(label)
        if (previous && revision <= Math.max(0, ...(previous.sourceEntryIds ?? []))) continue
        const sources = entries.filter(entry => draft.sourceEntryIds?.includes(entry.id))
        const owners = new Set(sources.map(entry => entry.participantId))
        const participantId = owners.size === 1 ? sources[0].participantId : undefined
        if (previous?.participantId !== undefined && previous.participantId !== participantId) continue
        const sourceEntryIds = (draft.sourceEntryIds ?? []).filter(id => entries.some(entry => entry.id === id)).slice(0, 8)
        const knowledge = normalizeKnowledgeEvidence(draft.knowledge, entries, sourceEntryIds)
        if (previous?.knowledge && supportsRecordedOutcome(previous.knowledge) && !supportsRecordedOutcome(knowledge)) continue
        if (label && draft.resolved === true) { merged.delete(label); resolutions[label] = revision; continue }
        const value = clip(draft.value, 300).trim()
        if (!label || !value) continue
        const expiresAt = draft.expiresAt && !Number.isNaN(new Date(draft.expiresAt).getTime()) ? draft.expiresAt : undefined
        const replacesLabel = clip(draft.replacesLabel, 80).trim()
        const replaced = replacesLabel && replacesLabel !== label ? merged.get(replacesLabel) : undefined
        if (replacesLabel && replacesLabel !== label
          && (!replaced || previous || revision <= (resolutions[replacesLabel] ?? 0))) continue
        if (replaced) {
          const sameOwner = replaced.participantId !== undefined
            ? replaced.participantId === participantId
            : !!replaced.knowledge?.holder && replaced.knowledge.holder === knowledge.holder
          if (!sameOwner || !supportsRecordedOutcome(knowledge)
            || revision <= Math.max(resolutions[replacesLabel] ?? 0, ...(replaced.sourceEntryIds ?? [0]))) continue
          merged.delete(replacesLabel)
          resolutions[replacesLabel] = revision
        }
        merged.set(label, { label, value, knowledge, ...(participantId !== undefined ? { participantId } : {}),
          ...(expiresAt ? { expiresAt } : {}), createdAt: previous?.createdAt ?? replaced?.createdAt ?? now.toISOString(),
          ...(sourceEntryIds.length ? { sourceEntryIds } : {}) })
      }
      const live = [...merged.values()].filter(item => !item.expiresAt || new Date(item.expiresAt) > now).slice(-10)
      await svc.dbSet('interlude_story', { id: current.id }, { state: encodeStoryState({ ...state, workingDetails: live, workingDetailResolutions: resolutions }), updatedAt: now })
    }
    let resolvedFacts = false
    for (const fact of decision.facts ?? []) {
      if (!hasCompactionEvidence(fact.sourceEntryIds, entries)) {
        svc.reportOperation('diagnostic', 'debug', story, 'advance', '长期事实未写入：缺少本轮新条目来源')
        continue
      }
      const knowledge = normalizeKnowledgeEvidence(fact.knowledge, entries, fact.sourceEntryIds ?? [])
      const resolved = supportsRecordedOutcome(knowledge)
        ? await svc.resolveCompactionFacts(story.id, fact.resolvesFactIds, visibleFactIds, now) : false
      resolvedFacts ||= resolved
      const mergedResolution = await svc.persistFact(story.id, fact, entries, now, factEmbeddings.get(normalizeFact(clip(fact.content, svc.memoryConfig.factContentCharacters))) ?? [])
      resolvedFacts ||= mergedResolution
    }
    for (const patch of decision.statePatches ?? []) {
      if (!hasCompactionEvidence(patch.sourceEntryIds, entries)) {
        svc.reportOperation('diagnostic', 'debug', story, 'advance', '发展提案未保留：缺少本轮新条目来源')
        continue
      }
      // Earlier feedback can support a new response, but only this increment
      // advances the checkpoint or qualifies a proposal as new evidence.
      await svc.persistStatePatch(story, patch,
        patch.target === 'relationship' ? [...precedingEntries, ...entries] : entries, now)
    }
    if (resolvedFacts) await svc.markContinuityDirty(story.id, now)
    // All outputs must succeed before the incremental frontier advances.
    const explicitBoundary = scenePatch.close === true
      && !!scenePatch.boundary?.reason.trim()
      && hasCompactionEvidence(scenePatch.boundary.sourceEntryIds, entries)
    await svc.dbSet('interlude_scene', { id: scene.id }, {
      hook: clip(scenePatch.hook ?? scene.hook, svc.memoryConfig.sceneHookCharacters),
      summary: clip(scenePatch.summary ?? scene.summary, svc.memoryConfig.sceneSummaryCharacters),
      entryCount: Math.max(0, scene.entryCount) + entries.length,
      lastEntryId: entries.at(-1)?.id ?? scene.lastEntryId,
      updatedAt: now,
    })
    if (explicitBoundary) {
      // Preserve boundary provenance beside its original evidence. This
      // checkpoint is navigation only, with no generated summary or prose.
      const sourceIds = scenePatch.boundary!.sourceEntryIds.filter(id => entries.some(entry => entry.id === id))
      const boundaryEntry = entries.find(entry => entry.id === Math.max(...sourceIds))
      if (boundaryEntry) {
        const source = (await svc.dbGet('interlude_script_entry', { id: boundaryEntry.id }))[0] as ScriptEntry | undefined
        if (source?.storyId === story.id) {
          const first = (await svc.dbGet('interlude_script_entry', {
            storyId: story.id, occurredAt: { $gte: scene.startedAt }, id: { $lte: boundaryEntry.id },
          }, { sort: { id: 'asc' }, limit: 1 }))[0] as ScriptEntry | undefined
          await svc.dbSet('interlude_script_entry', { id: source.id }, {
            metadata: { ...source.metadata, sceneCheckpoint: {
              sceneId: scene.id, startedAt: scene.startedAt.toISOString(),
              endedAt: entries.at(-1)!.occurredAt.toISOString(),
              boundarySourceEntryIds: sourceIds,
              reason: scenePatch.boundary!.reason,
              firstEntryId: first?.id ?? boundaryEntry.id,
              lastEntryId: entries.at(-1)?.id ?? scene.lastEntryId,
            } },
          })
          svc.invalidateHistoryVectors(story.id)
        }
      }
      // Close at the processed frontier, not at model completion. Entries
      // arriving during the background request belong to the next review.
      const frontier = entries.at(-1)!.occurredAt
      await svc.dbSet('interlude_scene', { id: scene.id }, { status: 'closed', endedAt: frontier, updatedAt: now })
      await svc.ensureContinuity(story, frontier)
      const nextScene = await svc.activeScene(story.id)
      if (nextScene) await svc.dbSet('interlude_scene', { id: nextScene.id }, { lastEntryId: entries.at(-1)!.id })
    }
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
/** Issue #21（方向 c）：从来源条目 kind 推导事实的通道域。群消息（含她在群
 * 里的发言）= group、私聊往返 = private、两者都有 = mixed；生活/剧本条目不
 * 计入（返回 undefined = 她自己的经历，不携带通道）。事实保持全局——这层
 * 只让提示词能区分"听说"与"亲历"，不做可见性过滤。 */
export function factSourceChannel(entries: ScriptEntry[], sourceEntryIds: number[]): 'group' | 'private' | 'mixed' | undefined {
  const cited = sourceEntryIds.map(id => entries.find(entry => entry.id === id)?.kind).filter(Boolean) as string[]
  const hasGroup = cited.some(kind => kind === 'group-message' || kind === 'character-group-message')
  const hasPrivate = cited.some(kind => kind === 'user-message' || kind === 'character-message')
  if (hasGroup && hasPrivate) return 'mixed'
  if (hasGroup) return 'group'
  if (hasPrivate) return 'private'
  return undefined
}

/** 更新路径的通道合并：旧值不可回溯（旧来源条目不在本批 entries 内），按
 * "出现过两种不同通道即 mixed"合并；任一侧缺省则取另一侧。 */
export function mergeFactSourceChannel(existing: 'group' | 'private' | 'mixed' | undefined, next: 'group' | 'private' | 'mixed' | undefined): 'group' | 'private' | 'mixed' | undefined {
  return existing && next && existing !== next ? 'mixed' : existing ?? next
}

export async function persistFact(svc: any, storyId: string, draft: import('../types').FactDraft, entries: ScriptEntry[], now: Date, preparedEmbedding: number[] = []) {
    const content = clip(draft.content, svc.memoryConfig.factContentCharacters)
    if (!content) return false
    // Durable facts are global narrative evidence. Ignore the legacy model
    // participantId field and persist new facts with an empty compatibility value.
    const participantId = ''
    if (factContentLooksAmbiguous(draft.scope, content)) return false
    const existing = await svc.dbGet('interlude_fact', { storyId, status: 'active' })
    // 当前先做完全规范化匹配的去重；更复杂的语义去重可在检索层升级时替换。
    const matching = existing.filter((fact: any) => normalizeFact(fact.content) === normalizeFact(content))
    const sourceEntryIds = (draft.sourceEntryIds ?? []).filter((id: any) => entries.some(entry => entry.id === id)).slice(0, 20)
    const relatedFactIds = Array.isArray(draft.knowledge?.relatedFactIds)
      ? draft.knowledge.relatedFactIds.filter(id => existing.some((fact: any) => fact.id === id)) : []
    const knowledge = normalizeKnowledgeEvidence(draft.knowledge, entries, sourceEntryIds, relatedFactIds)
    // Promise facts are unresolved by default, unless the compactor explicitly
    // says that the promise has already been fulfilled or closed.
    const canClose = supportsRecordedOutcome(knowledge)
    const same = matching.find((fact: any) => (fact.knowledge?.mode ?? 'unclassified') === knowledge.mode)
      ?? matching.find((fact: any) => !fact.knowledge && canClose)
    const unresolved = draft.unresolved === true || (draft.scope === 'promise' && (draft.unresolved !== false || !canClose))
    if (same && ((same.knowledge?.mode ?? 'unclassified') === knowledge.mode || !same.knowledge && canClose)) {
      const resolved = same.unresolved && draft.unresolved === false && canClose
      const embedding = same.embedding?.length ? same.embedding : preparedEmbedding
      // Issue #21：更新路径按"出现过两种通道即 mixed"合并（旧来源条目不在本批
      // entries 内，旧值不可回溯重算）。
      const mergedSourceChannel = mergeFactSourceChannel(same.sourceChannel, factSourceChannel(entries, sourceEntryIds))
      await svc.dbSet('interlude_fact', { id: same.id }, {
        importance: Math.max(same.importance, clampNumber(draft.importance, same.importance, 0, 1)),
        confidence: knowledge.clauses.some(clause => !same.sourceEntryIds.includes(clause.sourceEntryId)
          && ['observation', 'confirmation'].includes(clause.role)
          && entries.some(entry => entry.id === clause.sourceEntryId && ['user-message', 'character-message'].includes(entry.kind)))
          ? Math.max(same.confidence, clampNumber(draft.confidence, same.confidence, 0, 1)) : same.confidence,
        unresolved: resolved ? false : same.unresolved || unresolved,
        ...(embedding.length ? { embedding } : {}),
        ...(mergedSourceChannel ? { sourceChannel: mergedSourceChannel } : {}),
        sourceEntryIds: Array.from(new Set([...same.sourceEntryIds, ...sourceEntryIds])), lastSeenAt: now, updatedAt: now,
        knowledge: { ...knowledge, clauses: [...new Map([...(same.knowledge?.clauses ?? []), ...knowledge.clauses].map(clause => [JSON.stringify(clause), clause])).values()].slice(-12),
          relatedFactIds: [...new Set([...(same.knowledge?.relatedFactIds ?? []), ...knowledge.relatedFactIds])].slice(-12) },
      })
      return resolved
    }
    if (existing.length >= svc.memoryConfig.maxFactsPerStory) {
      const oldest = existing.sort((a: any, b: any) => (a.importance * a.confidence) - (b.importance * b.confidence))[0]
      if (oldest) await svc.dbSet('interlude_fact', { id: oldest.id }, { status: 'superseded', updatedAt: now })
    }
    await svc.dbCreate('interlude_fact', {
      storyId, participantId, scope: draft.scope, content, knowledge, importance: clampNumber(draft.importance, 0.5, 0, 1),
      confidence: clampNumber(draft.confidence, 0.5, 0, 1), unresolved,
      embedding: preparedEmbedding, status: 'active', sourceEntryIds,
      ...(factSourceChannel(entries, sourceEntryIds) ? { sourceChannel: factSourceChannel(entries, sourceEntryIds) } : {}),
      lastSeenAt: now, createdAt: now, updatedAt: now,
    })
    return false
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function scheduleFactEmbeddingBackfill(svc: any, storyId: string) {
    const embedding = svc.config.model.embedding
    const batchSize = embedding?.backfillBatchSize ?? 5
    if (!embedding?.enabled || !svc.modelRouting.embedding.available || batchSize <= 0) return
    if (svc.factBackfills.has(storyId)) return
    svc.factBackfills.add(storyId)
    // This maintenance task deliberately stays out of the narrative serial queue:
    // it only fills an optional index column and must not delay a new user event.
    void svc.backfillFactEmbeddings(storyId, batchSize)
      .catch((error: any) => svc.reportStandaloneOperation('diagnostic', 'debug', '长期事实向量补齐跳过 错误=%s', error))
      .finally(() => svc.factBackfills.delete(storyId))
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function backfillFactEmbeddings(svc: any, storyId: string, batchSize: number) {
    const generation = svc.taskGeneration(storyId)
    if (!svc.taskGenerationCurrent(storyId, generation)) return
    const startedAt = Date.now()
    const facts = await svc.dbGet('interlude_fact', { storyId, status: 'active' })
    const allMissing = facts
      .filter((fact: any) => !fact.embedding?.length)
      .sort((a: any, b: any) => b.updatedAt.getTime() - a.updatedAt.getTime())
    const missing = allMissing.slice(0, Math.max(0, batchSize))
    let completed = 0
    for (const fact of missing) {
      if (!svc.taskGenerationCurrent(storyId, generation)) break
      const embedding = await svc.embedText(fact.content, { purpose: '事实向量补齐', density: 'diagnostic' })
      if (!svc.taskGenerationCurrent(storyId, generation)) break
      if (embedding.length) {
        await svc.dbSet('interlude_fact', { id: fact.id, storyId, status: 'active', content: fact.content }, { embedding })
        completed++
      }
    }
    // 向量可观测性：有待补才报——进行中 standard，全部补齐升 summary。
    if (allMissing.length) {
      const remaining = allMissing.length - completed
      svc.reportStandaloneOperation?.(remaining ? 'standard' : 'summary', 'info',
        '事实向量补齐 故事=%s 补齐=%d 剩余=%d 耗时=%dms', storyId, completed, remaining, Date.now() - startedAt)
    }
  }


/** P5 自 service.ts 压缩管线区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function persistStatePatch(svc: any, story: InterludeStory, draft: StatePatchDraft, entries: ScriptEntry[], now: Date) {
    const confidence = clampNumber(draft.confidence, 0, 0, 1)
    const participantId = draft.target === 'perspective' ? '' : resolveParticipantId(draft.participantId, draft.sourceEntryIds, entries)
    const dimension = developmentDimension(draft.target, draft.path || '')
    const path = dimension ? `development.${dimension}` : ''
    const sourceEntryIds = (draft.sourceEntryIds ?? []).filter(id => entries.some(entry => entry.id === id)).slice(0, 20)
    const proposedValue = clip(draft.proposedValue, 4_000)
    const impact = draft.impact === 'major' ? 'major' : 'minor'
    if (!path || !proposedValue || !sourceEntryIds.length) return
    // Relationship observations must remain in their named branch; private
    // material cannot become a global personality or world change.
    if (draft.target === 'relationship' && !participantId) return
    if (draft.target === 'relationship' && entries.some(entry => sourceEntryIds.includes(entry.id)
      && entry.participantId && entry.participantId !== participantId)) return
    if (draft.target !== 'relationship' && entries.some(entry => sourceEntryIds.includes(entry.id) && !!entry.participantId)) return
    // A relationship tendency becomes usable only when actual user feedback
    // and the protagonist's subsequent delivered answer support the same
    // reading. This prevents one scene's prose rhythm from becoming a claim
    // about the relationship before the other person has participated in it.
    const receptionSupported = draft.target !== 'relationship' || reviewedDevelopmentSupport(draft, entries, participantId)
    if (!receptionSupported) {
      svc.reportOperation('diagnostic', 'debug', story, 'advance',
        '关系发展提案暂不保留：缺少有效的用户反馈与后续已送达回应证据 目标=%s/%s', draft.target, path)
      return
    }

    // Merge repeated proposals for one setting path before evaluating them.
    const candidates = await svc.dbGet('interlude_state_patch', {
      storyId: story.id, participantId, target: draft.target, path,
    }) as StatePatchProposal[]
    const matching = candidates.filter(candidate => patchClaimsMatch(candidate.proposedValue, proposedValue))
    for (const contradicted of candidates.filter(candidate => (candidate.status === 'proposed' || candidate.status === 'applied')
      && draft.contradictsProposalIds?.includes(candidate.id))) {
      const fresh = sourceEntryIds.filter(id => !contradicted.sourceEntryIds.includes(id))
      if (!fresh.length) continue
      await svc.dbSet('interlude_state_patch', { id: contradicted.id }, {
        confidence: Math.max(0, contradicted.confidence - 0.2),
        status: 'rejected',
        sourceEntryIds: [...new Set([...contradicted.sourceEntryIds, ...fresh])],
        evidence: clip(mergeNote(contradicted.evidence, `Counter-evidence (${fresh.join(',')}): ${draft.evidence}`), 4_000),
      })
    }
    if (draft.contradictsProposalIds?.length) return
    if (matching.some(candidate => candidate.status === 'applied' || candidate.status === 'compacted')) return
    const candidate = matching.find(item => item.status === 'proposed')
    const mergedSourceEntryIds = Array.from(new Set([
      ...(candidate?.sourceEntryIds ?? []), ...sourceEntryIds,
    ])).slice(0, 80)
    const sourceRows = await svc.dbGet('interlude_script_entry', {
      storyId: story.id, id: { $in: mergedSourceEntryIds },
    }) as ScriptEntry[]
    const evidence = statePatchEvidence(sourceRows, story.setting.timezone)
    // 下限 1:回合/天数下限开放给管理员调整(默认 3/2,见 Console 演化分区)
    const minimumTurns = Math.max(1, svc.memoryConfig.statePatchMinTurns ?? svc.memoryConfig.statePatchMinEvidence)
    const minimumDays = Math.max(1, svc.memoryConfig.statePatchMinDays ?? 2)
    const minimum = impact === 'major' ? svc.memoryConfig.majorStatePatchConfidenceThreshold : svc.memoryConfig.statePatchConfidenceThreshold
    const oldSourceRows = sourceRows.filter(entry => (candidate?.sourceEntryIds ?? []).includes(entry.id))
    const oldEvidence = statePatchEvidence(oldSourceRows, story.setting.timezone)
    const hasNewTurnEvidence = evidence.turns > oldEvidence.turns
    const hasNewSceneEvidence = evidence.scenes > oldEvidence.scenes
    const hasNewEvidence = impact === 'major' ? hasNewTurnEvidence || hasNewSceneEvidence : hasNewTurnEvidence
    const mergedConfidence = candidate
      ? Math.min(confidence, candidate.confidence + (receptionSupported && hasNewEvidence ? 0.05 : 0))
      : confidence
    const mergedEvidenceText = mergeNote(candidate?.evidence, draft.evidence)
    const proposal = candidate ?? await svc.dbCreate('interlude_state_patch', {
      storyId: story.id, participantId, target: draft.target, path, proposedValue,
      evidence: clip(mergedEvidenceText, 4_000), confidence: mergedConfidence, impact,
      status: 'proposed', sourceEntryIds: mergedSourceEntryIds, createdAt: now, appliedAt: null,
    })
    if (candidate?.id) {
      await svc.dbSet('interlude_state_patch', { id: candidate.id }, {
        evidence: clip(mergedEvidenceText, 4_000), confidence: mergedConfidence, impact: candidate.impact === 'major' || impact === 'major' ? 'major' : 'minor', sourceEntryIds: mergedSourceEntryIds,
      })
    }

    // Ordinary changes use distinct narrative turns, not scene boundaries. This
    // lets a long-lived everyday scene accumulate gradual evidence; major
    // changes retain the stricter independent-scene safeguard below.
    if (!receptionSupported) return
    if (!candidate || !hasNewEvidence || !svc.memoryConfig.autoApplyStatePatches || (impact === 'major' && !svc.memoryConfig.allowMajorStateChanges)) return
    const majorMinScenes = Math.max(1, svc.memoryConfig.statePatchMajorMinScenes ?? 2)
    const stableEvidence = impact === 'major'
      ? mergedConfidence >= minimum && evidence.scenes >= majorMinScenes
      : mergedConfidence >= minimum && evidence.turns >= minimumTurns && evidence.days >= minimumDays
    if (!stableEvidence) {
      if (impact === 'major') {
        svc.reportOperation('diagnostic', 'debug', story, 'advance',
          'Overlay 候选继续累计 目标=%s/%s 影响=major 场景=%d/%d 回合=%d 日期=%d 置信度=%.2f/%.2f',
          draft.target, path, evidence.scenes, majorMinScenes, evidence.turns, evidence.days, mergedConfidence, minimum)
      } else {
        svc.reportOperation('diagnostic', 'debug', story, 'advance',
          'Overlay 候选继续累计 目标=%s/%s 影响=minor 回合=%d/%d 场景=%d 日期=%d/%d 置信度=%.2f/%.2f',
          draft.target, path, evidence.turns, minimumTurns, evidence.scenes, evidence.days, minimumDays, mergedConfidence, minimum)
      }
      return
    }

    const cooldownHours = Math.max(1, svc.memoryConfig.statePatchCooldownHours ?? 72)
    const recentApplied = candidates
      .filter(item => item.status === 'applied' || item.status === 'compacted')
      .map(item => item.appliedAt ?? item.createdAt)
      .sort((left, right) => right.getTime() - left.getTime())[0]
    if (recentApplied && now.getTime() - recentApplied.getTime() < cooldownHours * Time.hour) {
      svc.reportOperation('diagnostic', 'debug', story, 'advance',
        'Overlay 冷却中，候选保留 目标=%s/%s 冷却=%d小时', draft.target, path, cooldownHours)
      return
    }

    // New tendencies remain sourced records, rather than accumulating in the
    // permanent Canon overlay. The live reader selects only relevant ones.
    if (proposal?.id) {
      await svc.dbSet('interlude_state_patch', { id: proposal.id }, { status: 'applied', appliedAt: now })
      // 立即重建 overlay:统一语义下 overlay=未压缩 applied 补丁的合并,
      // 不必等压缩周期(无快照/关压缩的实例此前永远看不到演化)
      await svc.rebuildLiveOverlayState(story, now)
    }
  }


/** I-7 观察性产出：推进生活关注词滞回状态机（压缩评估成功后调用）。
 * 状态存 story.state.extensions.attention；批次标识用当前场景 id + 最新
 * 条目 id（同场景重试视为同一次评估）。观察阶段不接门控。 */
export async function advanceStoryAttentionWords(svc: any, storyId: string, decision: any, entries: any[], now: Date): Promise<void> {
    try {
        const raw = (decision as any)?.attentionKeywords
        if (raw === undefined && !entries?.length) return
        const batchId = `scene:${(decision as any)?.scene?.hook ? '' : ''}${entries?.length ? entries[entries.length - 1].id : 'none'}:${entries?.length ?? 0}`
        const fresh = await svc.getStory(storyId)
        const state = decodeStoryState(fresh.state)
        const previous = state.extensions?.attention as AttentionWordState | undefined
        // F8：字段省略/非法形状/整批不合格时 advance 返回 previous（no-op）——
        // 模型按合约省略 attentionKeywords 不再推进缺席计数（此前两轮省略即全灭）。
        const next = advanceAttentionWords(previous?.version === 1 ? previous : undefined, {
            draft: raw,
            batchId,
            now,
        })
        if (!next) return
        if (previous && JSON.stringify(previous) === JSON.stringify(next)) return
        await svc.dbSet('interlude_story', { id: storyId }, {
            state: encodeStoryState({ ...state, extensions: { ...state.extensions, attention: next } }),
            updatedAt: now,
        })
        svc.reportOperation?.('diagnostic', 'debug', fresh, 'advance', '生活关注词已更新 生效=%s 候选=%s',
          next.effective.map(word => word.term).join('、') || '(空)', next.candidates.map(word => `${word.term}(${word.nominations})`).join('、') || '(空)')
    } catch { /* 尽力而为：词集失败不阻塞压缩 */ }
}
