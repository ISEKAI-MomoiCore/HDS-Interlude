/** 世界播种 runner：后台低频生成与主角有关的外部事件（事实权威、反应自由）、
 * 六切面轮换调用、到期事件注入。纯策略与校验闸在 world-seeder.ts。
 * P6 自 service.ts 迁出（2026-10-29），行为不变；宿主经第一参数传入。 */
import { Time } from 'koishi'
import { isFantasyStory, lastWeatherSnapshot } from './weather'
import { compactPromptEntries } from './narrator'
import { normalizeDatabaseRow } from './narrative-normalizers'
import { decodeStoryState } from './story-state'
import { parseWorldSeedEvents, seedDomainForRun, validateSeedEvent, type SeedValidationInput, type WorldSeedDomain } from './world-seeder'

import type { InterludeStory, ScriptEntry, SeededWorldEvent } from './types'

/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function worldSeederSweep(svc: any) {
    if (svc.desktopRuntimePhase === 'paused' || !svc.worldSeederRuntime.enabled || !svc.worldSeeder.available || svc.worldSeederSweepRunning) return
    svc.worldSeederSweepRunning = true
    try {
      const story = await svc.getCanonicalStory()
      if (!story || !svc.canHandleStory(story)) return
      const generation = svc.taskGeneration(story.id)
      // 抖动：随机跳过部分检查，避免固定节律感（多数运行仍应输出空）。
      if (Math.random() < 0.10) return
      const now = new Date()
      const dayAgo = new Date(now.getTime() - 24 * Time.hour)
      const [scheduled, last24, recentInjected] = await Promise.all([
        svc.dbGet('interlude_seeded_event', { storyId: story.id, status: 'scheduled' }),
        svc.dbGet('interlude_seeded_event', { storyId: story.id, status: 'injected', updatedAt: { $gte: dayAgo } }),
        svc.dbGet('interlude_seeded_event', { storyId: story.id, status: 'injected', occursAt: { $gte: new Date(now.getTime() - 14 * Time.day) } }),
      ])
      const runtime = svc.worldSeederRuntime
      // 预算按来源隔离：实况天气行按自身节奏滚动注入，不计入模型播种的
      // 排期/日预算——否则双开时天气的高频过期重建会长期挤占播种器额度。
      const seederRow = (row: any) => (row as any).sourcePayload?.weather !== true
      if (scheduled.filter(seederRow).length >= runtime.maxPending || last24.filter(seederRow).length >= runtime.dailyCap) return
      // 去重窗口必须包含排期中（scheduled）的事件：45 分钟的 sweep 节奏下，第一条
      // 事件到点注入之前会连跑数轮，若窗口只看已注入（injected），模型每轮都拿到
      // "近期无事件"的空清单，同一通知的换皮改写会连续排期（用户实测 4 连）。
      const windowRows = [...scheduled, ...recentInjected]
      const domain = seedDomainForRun(story.id, now, runtime.cadenceMinutes)
      const payload = await svc.buildWorldSeederPayload(story, now, windowRows.map(row => String(row.summary)), domain)
      // 实况天气接管判定:天气开启且该故事不被架空开关跳过 → 播种器让出天气领地
      // (提示词换 nature 替身切面 + 硬排除规则;校验闸 weather-guard 兜底)。
      // 架空世界(或天气关闭)保持原行为——那些世界里模型即兴是唯一的天气来源。
      const weatherHandledByHost = svc.weatherConfig.enabled
        && !(svc.weatherConfig.skipFantasyWorld && isFantasyStory(story.setting.world, story.setting.location))
      const raw = await svc.worldSeeder.generate(payload, { weatherHandledByHost })
      if (!svc.taskGenerationCurrent(story.id, generation)) return
      const drafts = parseWorldSeedEvents(raw)
      if (!drafts.length) {
        svc.reportOperation('diagnostic', 'debug', story, 'advance', '世界播种器本轮无事件')
        return
      }
      // recentSummaries 可变：同批次内已被接受的草稿立即入列，防止一次输出里的互为换皮对。
      const recentSummaries = windowRows.map(row => String(row.summary))
      // 多维度去重所需的额外维度:subjects(NPC/道具名)与 occursAt(时间窗)
      const recentSubjects = windowRows.map(row => {
        const subjects = Array.isArray((row as any).subjects) ? (row as any).subjects : []
        return subjects.map((s: unknown) => String(s).trim()).filter(Boolean)
      })
      const recentOccursAt = windowRows.map(row => new Date(Number((row as any).occursAt)))
      const input: SeedValidationInput = {
        now, timezone: story.setting.timezone, maxHorizonHours: runtime.maxHorizonHours,
        blockedNames: await svc.worldSeederBlockedNames(story.id),
        recentSummaries,
        recentSubjects,
        recentOccursAt,
        ...(weatherHandledByHost ? { weatherGuard: true } : {}),
      }
      let pendingCount = scheduled.length
      let dailyCount = last24.length
      let highToday = last24.filter((row: any) => row.importance === 'high').length
      for (const draft of drafts) {
        if (pendingCount >= runtime.maxPending || dailyCount >= runtime.dailyCap) break
        if (draft.importance === 'high' && highToday >= 1) continue
        // expiresAt 兜底:模型常给 25-35 分钟,但自动推进间隔可达 40+ 分钟 →
        // 到 drain 时已过期(实测 4 条中 3 条 expired)。宿主保证至少 2h 有效窗口
        const minExpiry = new Date(draft.occursAt.getTime() + 2 * Time.hour)
        if (!draft.expiresAt || draft.expiresAt < minExpiry) draft.expiresAt = minExpiry
        const rejection = validateSeedEvent(draft, input)
        if (rejection) {
          svc.reportOperation('diagnostic', 'debug', story, 'advance', '世界事件被校验闸拒绝 原因=%s 摘要=%s', rejection, draft.summary.slice(0, 60))
          continue
        }
        await svc.dbCreate('interlude_seeded_event', {
          storyId: story.id, summary: draft.summary, importance: draft.importance,
          occursAt: draft.occursAt, status: 'scheduled',
          ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {}),
          subjects: draft.subjects, sourcePayload: { rationale: draft.rationale },
          createdAt: now, updatedAt: now,
        })
        pendingCount += 1
        dailyCount += 1
        if (draft.importance === 'high') highToday += 1
        svc.scheduleDueIntentWake(story.id, draft.occursAt)
        svc.reportOperation('standard', 'info', story, 'advance', '世界事件已排期 重要性=%s 发生于=%s 摘要=%s', draft.importance, draft.occursAt.toISOString(), draft.summary.slice(0, 60))
      }
    } finally {
      svc.worldSeederSweepRunning = false
    }
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function buildWorldSeederPayload(svc: any, story: InterludeStory, now: Date, recentSummaries: string[], domain?: WorldSeedDomain) {
    const [entries, scene, arc] = await Promise.all([
      svc.recentEntriesForPrompt(story.id, now),
      svc.activeScene(story.id),
      svc.activeArc(story.id),
    ])
    const state = decodeStoryState(story.state)
    const blockedNames = await svc.worldSeederBlockedNames(story.id)
    // 反馈环切断：已注入的世界事件不再进入"近期生活"摘录——播种器的灵感来源
    // 是她本人的生活，不是自己上一轮的产出（它已单独列在 recentlySeededEvents）。
    // 否则首轮事件注入后成为下一轮的上下文锚点，同模态复读是必然收敛。
    const compact = compactPromptEntries(entries.filter((entry: any) => entry.kind !== 'world-event'), 2_000)
      .slice(-14)
      .map(entry => ({ kind: entry.kind, at: entry.occurredAt.toISOString(), text: entry.content.slice(0, 240) }))
    const month = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: story.setting.timezone }).format(now))
    const season = month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter'
    // 天气协同:当前环境快照传给播种器——天象切面只产后果,不产天气本身
    const latestWeather = svc.weatherConfig.enabled ? lastWeatherSnapshot() : undefined
    return JSON.stringify({
      nowLocal: new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: story.setting.timezone }).format(now),
      timezone: story.setting.timezone,
      season,
      ...(latestWeather ? { ambientWeather: latestWeather.text } : {}),
      worldSetting: {
        characterName: story.setting.character?.name ?? '',
        characterProfile: (story.setting.character?.profile ?? '').slice(0, 600),
        world: (story.setting.world ?? '').slice(0, 800),
        location: (story.setting.location ?? '').slice(0, 300),
        supportingCast: (story.setting.supportingCast ?? '').slice(0, 400),
      },
      currentScene: scene?.summary?.slice(0, 500) ?? '',
      currentArc: arc?.summary?.slice(0, 500) ?? '',
      recentEstablishedLife: compact,
      workingDetails: (state.workingDetails ?? []).map(detail => ({ label: detail.label, value: detail.value })).slice(-8),
      blockedNames,
      thisRunSlice: domain ? { key: domain.key, label: domain.label, brief: domain.brief } : undefined,
      recentlySeededEvents: recentSummaries.slice(-10),
      constraints: {
        maxHorizonHours: svc.worldSeederRuntime.maxHorizonHours,
        dailyBudget: svc.worldSeederRuntime.dailyCap,
        note: 'BLOCKED NAMES are off-limits; offline channels only; most runs return empty events.',
      },
    })
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function worldSeederBlockedNames(svc: any, storyId: string) {
    const participants = await svc.participants(storyId)
    return participants
      .map((item: any) => item.displayName?.trim() ?? '')
      .filter((name: any) => name.length >= 2)
  }


/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function drainDueSeededEvents(svc: any, story: InterludeStory, now: Date, includeLow: boolean) {
    // Source eligibility is independent of the model seeder's availability.
    const weatherEnabled = svc.weatherConfig?.enabled
      && !(svc.weatherConfig.skipFantasyWorld && isFantasyStory(story.setting.world, story.setting.location))
    if (!svc.worldSeederRuntime.enabled && !weatherEnabled) return
    try {
      const staleClaim = new Date(now.getTime() - 5 * Time.minute)
      const rows = await svc.dbGet('interlude_seeded_event', {
        storyId: story.id,
        occursAt: { $lte: now },
        $or: [
          { status: 'scheduled' },
          { status: 'injecting', updatedAt: { $lte: staleClaim } },
        ],
      })
      const due = rows
        .map((row: any) => normalizeDatabaseRow('interlude_seeded_event', row) as SeededWorldEvent)
        .sort((left: any, right: any) => left.occursAt.getTime() - right.occursAt.getTime())
      for (const row of due) {
        const weather = row.sourcePayload?.weather === true
        if (weather ? !weatherEnabled : !svc.worldSeederRuntime.enabled) continue
        if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
          await svc.dbSet('interlude_seeded_event', { id: row.id }, { status: 'expired', updatedAt: now })
          continue
        }
        if (row.importance === 'low' && !includeLow) continue
        // Claim before the append so two concurrent drains cannot create two
        // script entries. Keep the row recoverable if the append fails.
        await svc.dbSet('interlude_seeded_event', { id: row.id }, { status: 'injecting', updatedAt: now })
        let entry: ScriptEntry
        try {
          entry = await svc.appendEntry(story.id, {
            kind: 'world-event', actor: 'system',
            content: `[世界事件] ${row.summary}`,
            occurredAt: row.occursAt.toISOString(),
            metadata: { seededEventId: row.id, importance: row.importance },
          }, now)
          await svc.dbSet('interlude_seeded_event', { id: row.id }, { status: 'injected', injectedEntryId: entry.id, updatedAt: now })
        } catch (error) {
          await svc.dbSet('interlude_seeded_event', { id: row.id }, { status: 'scheduled', updatedAt: now }).catch((): undefined => undefined)
          throw error
        }
        svc.reportOperation('standard', 'info', story, 'advance', '世界事件已注入 条目=%d 重要性=%s 摘要=%s', entry.id, row.importance, row.summary.slice(0, 60))
      }
    } catch (error) {
      svc.report('warn', story, 'advance', '世界事件排水失败（不阻断回合）错误=%s', error)
    }
  }

