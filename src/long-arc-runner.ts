/** 长线叙事指导 runner：有效剧本条目加权累计（私聊全计/群聊半计）、触发与
 * 复审判定、指导生成与注入边界。纯函数层（累计器/判定/归一化）在 long-arc.ts。
 * P6 自 service.ts 迁出（2026-10-29），行为不变；宿主经第一参数传入。 */
import { Time } from 'koishi'
import { decodeStoryState } from './story-state'
import { participantIdForStory } from './session-platform'
import { toDate } from './narrative-normalizers'
import { advanceLongHorizonGenerationBaseline, calculateLongHorizonScore, isEligibleNarrativeEntry, normalizeLongArcDecision, progressUpdatePayload, shouldTriggerLongHorizon, type LongArcGuidanceRecord, type LongArcProgressRow } from './long-arc'

import type { InterludeStory, ScriptEntry } from './types'

/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function longHorizonSweep(svc: any, story: InterludeStory, _now?: Date) {
    if (!svc.longHorizonConfig.enabled || svc.longHorizonSweepRunning.has(story.id) || svc.longHorizonGenerationRunning.has(story.id)) return
    svc.longHorizonSweepRunning.add(story.id)
    try {
      const progress = await svc.longHorizonProgress(story.id)
      const lastEntryId = progress?.lastCountedEntryId ?? 0
      const entries = (await svc.dbGet('interlude_script_entry', {
        storyId: story.id, id: { $gt: lastEntryId },
      }, { sort: { id: 'asc' }, limit: 500 })) as unknown as ScriptEntry[]
      if (!entries.length) return

      const score = calculateLongHorizonScore(entries, svc.longHorizonConfig)
      const lastScannedEntryId = Math.max(...entries.map(entry => Number(entry.id) || 0), lastEntryId)
      const total = (progress?.totalScore ?? 0) + score.totalScore
      const cumulative = {
        storyId: story.id,
        lastCountedEntryId: lastScannedEntryId,
        totalScore: total,
        privateCount: (progress?.privateCount ?? 0) + score.privateCount,
        privateScore: (progress?.privateScore ?? 0) + score.privateScore,
        groupCount: (progress?.groupCount ?? 0) + score.groupCount,
        groupScore: (progress?.groupScore ?? 0) + score.groupScore,
        unknownCount: (progress?.unknownCount ?? 0) + score.unknownCount,
        lastGenerationScore: progress?.lastGenerationScore ?? 0,
        lastGenerationEntryId: progress?.lastGenerationEntryId ?? 0,
        updatedAt: new Date(),
      } satisfies LongArcProgressRow
      await svc.saveLongHorizonProgress(cumulative)
      svc.longHorizonLastScore.set(story.id, total)

      const active = await svc.getActiveLongArcGuidance(story.id)
      const lastGen = cumulative.lastGenerationScore
      const trigger = shouldTriggerLongHorizon(
        { ...score, totalScore: total },
        active, lastGen, svc.longHorizonConfig,
      )
      if (!trigger.trigger) return
      if ((svc.longHorizonGenerationCooldownUntil.get(story.id) ?? 0) > Date.now()) return
      svc.reportOperation('diagnostic', 'debug', story, 'advance',
        '长线指导触发 原因=%s 总分=%.1f 私聊=%.1f 群聊=%.1f', trigger.reason, total, cumulative.privateScore, cumulative.groupScore)
      svc.longHorizonGenerationRunning.add(story.id)
      void svc.longHorizonGenerate(story, entries, total, cumulative).catch((error: any) => {
        svc.longHorizonGenerationCooldownUntil.set(story.id, Date.now() + 10 * Time.minute)
        svc.reportStandalone('warn', '长线指导生成失败（10 分钟冷却后重试） 错误=%s', error)
      }).finally(() =>
        svc.longHorizonGenerationRunning.delete(story.id))
    } finally {
      svc.longHorizonSweepRunning.delete(story.id)
    }
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function longHorizonProgress(svc: any, storyId: string) {
    const rows = await svc.dbGet('interlude_long_arc_progress', { storyId }, { limit: 1 }) as unknown as LongArcProgressRow[]
    return rows[0]
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function saveLongHorizonProgress(svc: any, progress: LongArcProgressRow) {
    const existing = await svc.dbGet('interlude_long_arc_progress', { storyId: progress.storyId }, { limit: 1 })
    if (existing.length) {
      // 修复"cannot modify primary key"：set 载荷不得含主键 storyId（首行 dbCreate
      // 成功后，此前每次 sweep 更新都因载荷带主键而必抛）。
      await svc.dbSet('interlude_long_arc_progress', { storyId: progress.storyId }, progressUpdatePayload(progress))
    } else {
      await svc.dbCreate('interlude_long_arc_progress', progress)
    }
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function getActiveLongArcGuidance(svc: any, storyId: string) {
    const rows = (await svc.dbGet('interlude_long_arc_guidance', { storyId, status: 'active' }, { sort: { version: 'desc' }, limit: 1 })) as unknown as Array<Record<string, unknown>>
    const active = rows[0] as unknown as LongArcGuidanceRecord | undefined
    if (!active) return undefined
    const expiresAt = toDate(active.expiresAt)
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      // Expiration is a lifecycle transition, not merely a prompt-time filter:
      // an expired row must no longer block the next first-trigger generation.
      if (active.id !== undefined) {
        await svc.dbSet('interlude_long_arc_guidance', { id: active.id }, { status: 'expired', updatedAt: new Date() })
      }
      svc.activeLongArcGuidanceCache.delete(storyId)
      return undefined
    }
    return active
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function ensureLongHorizonGuidanceLoaded(svc: any, storyId: string) {
    if (!svc.longHorizonConfig.enabled || svc.longHorizonGuidanceLoaded.has(storyId)) return
    const active = await svc.getActiveLongArcGuidance(storyId)
    if (active) svc.activeLongArcGuidanceCache.set(storyId, active)
    svc.longHorizonGuidanceLoaded.add(storyId)
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function longHorizonGenerate(svc: any, story: InterludeStory, evidence: ScriptEntry[], currentScore: number, progress: LongArcProgressRow) {
    const config = svc.longHorizonConfig
    // The accumulator is story-level, but privacy is still enforced at the
    // boundary of the background model. When participant details are disabled,
    // only global entries may cross this boundary; the score itself remains
    // unchanged and still counts private entries at full weight.
    const primaryParticipantId = participantIdForStory(story.id, story.platform, story.selfId, story.userId)
    const isVisibleToLongHorizon = (entry: Pick<ScriptEntry, 'participantId'>) =>
      svc.sharedStoryConfig.shareParticipantDetails
      || !entry.participantId
      || entry.participantId === primaryParticipantId
    const eligible = evidence.filter(entry => isEligibleNarrativeEntry(entry) && isVisibleToLongHorizon(entry))
    if (!eligible.length) {
      // The score is intentionally story-level, while the model input is
      // privacy-filtered. Consume this review window once when all evidence is
      // hidden; otherwise every later hidden entry would retrigger the same
      // generation attempt forever without ever producing a model call.
      const lastEvidenceEntryId = Math.max(
        progress.lastCountedEntryId,
        ...evidence.map(entry => Number(entry.id) || 0),
      )
      const advanced = advanceLongHorizonGenerationBaseline(progress, currentScore, lastEvidenceEntryId)
      await svc.saveLongHorizonProgress(advanced)
      svc.longHorizonLastScore.set(story.id + ':gen', currentScore)
      svc.reportOperation('diagnostic', 'debug', story, 'advance',
        '长线指导跳过：本轮有效证据均受 participant 隐私边界过滤，已消费复核窗口')
      return
    }
    // 构造模型输入（分层：设定 + 关系 + 近期剧本 + 新增证据 + 有界历史代表证据）
    const input = await svc.longHorizonInput(story, eligible)
    // The model may cite either this review window or the bounded historical
    // sample supplied by longHorizonInput. Both sets are host-validated below.
    const historicalIds = Array.isArray((input as any).historicalEvidence)
      ? (input as any).historicalEvidence.map((item: any) => Number(item?.id)).filter((id: number) => Number.isSafeInteger(id) && id > 0)
      : []
    const validIds = new Set([...eligible.map(entry => entry.id), ...historicalIds])
    // 调用长线模型（复用 compaction route）
    const output = await svc.compactor.planLongArcGuidance?.(input)
    if (!output) return
    const result = normalizeLongArcDecision(output, validIds, config)
    if (!result) {
      svc.longHorizonGenerationCooldownUntil.set(story.id, Date.now() + 10 * Time.minute)
      svc.reportStandaloneOperation('diagnostic', 'warn', '长线指导输出被归一化拒绝（决策/证据引用/催化结构不合法，10 分钟冷却后重试）')
      return
    }
    const triggerEntryId = eligible[eligible.length - 1].id
    // 持久段进故事串行队列:模型调用留在队列外(避免阻塞叙事回合),写库毫秒级
    // 互斥即可;与 purge/压缩交错时由段内重查+触发条目存活校验兜底。
    await svc.serial(story.id, async () => {
      // 清理交错防护:生成基于清理前的证据,若触发条目已被 purge/redacted,
      // 本次结果作废(否则会向已重置的故事写入旧直觉)
      const triggerRow = triggerEntryId
        ? (await svc.dbGet('interlude_script_entry', { id: triggerEntryId }))[0] as ScriptEntry | undefined
        : undefined
      if (!triggerRow || triggerRow.kind === 'redacted') {
        svc.reportOperation('diagnostic', 'debug', story, 'advance', '长线指导生成结果丢弃：触发条目已被清理')
        return
      }
      // A dormant review is a valid no-write decision. It advances the review
      // baseline, but must not supersede an already useful active catalyst.
      if (result.decision === 'dormant' || !result.payload) {
        await svc.saveLongHorizonProgress({ ...progress, totalScore: currentScore, lastGenerationScore: currentScore, lastGenerationEntryId: triggerEntryId, updatedAt: new Date() })
        svc.longHorizonLastScore.set(story.id + ':gen', currentScore)
        svc.reportOperation('diagnostic', 'debug', story, 'advance',
          '长线指导本轮保持休眠：%s', result.reason ?? '当前没有适合播种的长期发展可能性')
        return
      }
      const payload = result.payload
      // 版本链：只有新的催化方向通过校验后才 supersede 旧 active。
      // 段内重查(队列外读到的 active 可能已被并发 supersede/purge);
      // 同时自愈历史遗留的双 active(仅保留最高版本,其余标 superseded)。
      const activeRows = (await svc.dbGet('interlude_long_arc_guidance', { storyId: story.id, status: 'active' }, { sort: { version: 'desc' } })) as Array<{ id?: number, version?: unknown }>
      const active = activeRows[0]
      for (const stale of activeRows.slice(1)) {
        if (stale.id !== undefined) await svc.dbSet('interlude_long_arc_guidance', { id: stale.id }, { status: 'superseded', updatedAt: new Date() })
      }
      if (active?.id !== undefined) {
        await svc.dbSet('interlude_long_arc_guidance', { id: active.id }, { status: 'superseded', updatedAt: new Date() })
      }
      const latestRows = await svc.dbGet('interlude_long_arc_guidance', { storyId: story.id }, { sort: { version: 'desc' }, limit: 1 }) as Array<{ version?: unknown }>
      const nextVersion = Number(latestRows[0]?.version ?? active?.version ?? 0) + 1
      const now = new Date()
      await svc.dbCreate('interlude_long_arc_guidance', {
        storyId: story.id, version: nextVersion, status: 'active',
        title: payload.title, premise: payload.premise, direction: payload.direction,
        payload, currentStage: payload.currentStage.id, intensity: payload.intensity,
        confidence: payload.confidence,
        triggerEntryId,
        evidenceEntryIds: payload.evidenceEntryIds,
        ...(active?.id !== undefined ? { supersedesId: active.id } : {}),
        createdAt: now, updatedAt: now,
      })
      await svc.saveLongHorizonProgress({ ...progress, totalScore: currentScore, lastGenerationScore: currentScore, lastGenerationEntryId: triggerEntryId, updatedAt: new Date() })
      svc.longHorizonLastScore.set(story.id + ':gen', currentScore)
      const created = await svc.getActiveLongArcGuidance(story.id)
      if (created) svc.activeLongArcGuidanceCache.set(story.id, created)
      svc.reportOperation('standard', 'info', story, 'advance',
        '长线指导已生成 版本=%d 决策=%s 阶段=%s 标题=%s 置信度=%.2f', nextVersion, result.decision, payload.currentStage.name, payload.title, payload.confidence)
    })
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function longHorizonInput(svc: any, story: InterludeStory, eligible: ScriptEntry[]) {
    const state = decodeStoryState(story.state)
    const [recentEntries, historicalEntries, arcs, progress, participants, facts, active] = await Promise.all([
      svc.recentEntriesForPrompt(story.id, new Date()),
      svc.dbGet('interlude_script_entry', { storyId: story.id }, { sort: { id: 'desc' }, limit: 120 }),
      svc.dbGet('interlude_arc', { storyId: story.id, status: 'active' }),
      svc.longHorizonProgress(story.id),
      svc.dbGet('interlude_participant', { storyId: story.id, status: 'active' }, { limit: 12, sort: { updatedAt: 'desc' } }),
      svc.dbGet('interlude_fact', { storyId: story.id, status: 'active' }, { limit: 24, sort: { importance: 'desc', updatedAt: 'desc' } }),
      svc.getActiveLongArcGuidance(story.id),
    ])
    const primaryParticipantId = participantIdForStory(story.id, story.platform, story.selfId, story.userId)
    const isVisibleToLongHorizon = (value: { participantId?: unknown }) =>
      svc.sharedStoryConfig.shareParticipantDetails
      || !value.participantId
      || value.participantId === primaryParticipantId
    const visibleRecentEntries = recentEntries.filter(isVisibleToLongHorizon)
    const visibleHistoricalEntries = (historicalEntries as unknown as ScriptEntry[])
      .filter(entry => isVisibleToLongHorizon(entry) && isEligibleNarrativeEntry(entry))
      .sort((left, right) => Number(left.id) - Number(right.id))
    // Durable facts are story-global narrative material. Unlike raw script entries,
    // they must not be hidden merely because the legacy row carries another
    // participantId. The fact content itself is the only subject reference
    // exposed to the long-horizon model.
    const visibleFacts = facts as any[]
    const recentScript = visibleRecentEntries.slice(-30).map((entry: any) => ({
      kind: entry.kind, actor: entry.actor,
      content: String(entry.content ?? '').slice(0, 300),
      occurredAt: entry.occurredAt.toISOString(),
    }))
    const evidenceSample = eligible.slice(-20).map(entry => ({
      id: entry.id, kind: entry.kind,
      content: String(entry.content ?? '').slice(0, 400),
    }))
    return {
      storySetting: {
        characterName: story.setting.character?.name ?? '',
        characterProfile: (story.setting.character?.profile ?? '').slice(0, 800),
        userProfile: (story.setting.user?.profile ?? '').slice(0, 500),
        relationship: (story.setting.relationship ?? '').slice(0, 800),
        world: (story.setting.world ?? '').slice(0, 800),
        perspective: story.setting.perspective ?? '',
      },
      overlay: state.settingOverlay ?? {},
      currentArcs: (arcs as any[])?.map?.((arc: any) => ({ id: arc.id, summary: String(arc.summary ?? '').slice(0, 500) })) ?? [],
      participants: svc.sharedStoryConfig.shareParticipantDetails
        ? (participants as any[]).map((participant: any) => ({ id: participant.id, displayName: participant.displayName, relationship: String(participant.relationship ?? '').slice(0, 500), state: participant.state }))
        : [],
      durableFacts: visibleFacts.map((fact: any) => ({
        scope: fact.scope, content: String(fact.content ?? '').slice(0, 500),
        importance: fact.importance, confidence: fact.confidence,
      })),
      activeGuidance: active ? {
        version: active.version,
        title: active.title,
        direction: active.direction,
        premise: active.premise,
        currentStage: active.currentStage,
        developmentPhase: (active.payload as any)?.developmentPhase ?? 'active',
        latentTension: (active.payload as any)?.latentTension ?? '',
        firstExpression: (active.payload as any)?.firstExpression ?? null,
        responseBranches: (active.payload as any)?.responseBranches ?? null,
      } : null,
      weightedScore: {
        total: progress?.totalScore ?? svc.longHorizonLastScore.get(story.id) ?? 0,
        privateCount: progress?.privateCount ?? 0,
        privateScore: progress?.privateScore ?? 0,
        groupCount: progress?.groupCount ?? 0,
        groupScore: progress?.groupScore ?? 0,
        unknownCount: progress?.unknownCount ?? 0,
      },
      recentScript,
      keyEvidence: evidenceSample,
      // A bounded historical sample prevents review cycles from forgetting
      // the relationship patterns that motivated the catalyst in the first
      // place, while keeping privacy and prompt-size limits host-owned.
      historicalEvidence: visibleHistoricalEntries.slice(-60).map(entry => ({
        id: entry.id, kind: entry.kind,
        content: String(entry.content ?? '').slice(0, 400),
      })),
      intensity: svc.longHorizonConfig.intensity,
      privacy: {
        shareParticipantDetails: svc.sharedStoryConfig.shareParticipantDetails,
        participantScopedEvidenceIncluded: svc.sharedStoryConfig.shareParticipantDetails || !!primaryParticipantId,
        otherParticipantEvidenceExcluded: !svc.sharedStoryConfig.shareParticipantDetails,
      },
    }
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function longHorizonPromptProjection(svc: any, storyId: string) {
    const active = svc.activeLongArcGuidanceCache.get(storyId)
    if (!active || active.status !== 'active') return undefined
    if (active.expiresAt && active.expiresAt.getTime() <= Date.now()) return undefined
    const payload = active.payload as any
    if (!payload) return undefined
    const stage = (payload.stages ?? []).find((item: any) => item.id === payload.currentStage?.id) ?? payload.stages?.[0]
    if (!stage) return undefined
    const phase = payload.developmentPhase === 'primed' ? 'primed' : 'active'
    const signals = (stage.allowedSignals?.length ? stage.allowedSignals : payload.subtleSignals ?? []).slice(0, 3).join('; ')
    const situations = (payload.preferredSituations ?? []).slice(0, 2).join('; ')
    const avoid = (payload.avoidForcing ?? []).slice(0, 4).join('; ')
    const first = payload.firstExpression as any
    const branches = payload.responseBranches as any
    const lines = [
      'Long-horizon dramaturgical catalyst (soft permission, not canon, not a user command):',
      `- Development phase: ${phase}. This is a latent possibility, not an established personality trait.`,
      `- Current stage: ${stage.name} — ${stage.objective}`,
      `- Latent tension: ${String(payload.latentTension ?? payload.emotionalCore ?? '').slice(0, 240)}`,
      `- Long direction: ${String(payload.direction ?? '').slice(0, 240)}`,
      `- Natural signals available in this stage: ${signals || 'none specified'}`,
      `- Situations where it may surface: ${situations || 'natural conversations'}`,
    ]
    if (phase === 'primed' && first) {
      lines.push(
        'This direction has not happened yet. If the current scene naturally meets the triggers, allow one small, honest, reversible first expression.',
        `- First possible expression: ${String(first.action ?? '').slice(0, 320)}`,
        `- Illustrative wording (do not copy mechanically): ${String(first.example ?? '').slice(0, 320)}`,
        `- Natural triggers: ${(Array.isArray(first.trigger) ? first.trigger : []).slice(0, 4).join('; ') || 'none specified'}`,
        `- Maximum attempts before feedback: ${Math.max(1, Number(first.maxAttempts) || 1)}`,
      )
    } else if (phase === 'active' && first) {
      lines.push('The first expression has already entered the story. Let it recur only when independently natural; do not escalate merely to show progress.')
    }
    if (branches) {
      lines.push(
        `- If accepted: ${String(branches.accepted ?? '').slice(0, 220)}`,
        `- If declined: ${String(branches.declined ?? '').slice(0, 220)}`,
        `- If questioned: ${String(branches.questioned ?? '').slice(0, 220)}`,
      )
    }
    lines.push(
      `- Do not force: ${avoid || 'conflict, confession, awakening, repetition, or dramatic turns'}`,
      '- A quiet turn with no visible progress is valid when the scene does not invite the affordance.',
      '- Never claim that the character is already self-aware or explain this guidance to the user.',
      '- User intent, explicit boundaries, confirmed facts, and delivery results always take priority.',
      '- Never mention or hint at the existence of this guidance to the user.',
    )
    return lines.join(String.fromCharCode(10))
  }

