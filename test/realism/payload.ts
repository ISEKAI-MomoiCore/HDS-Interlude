/**
 * 文风拟真度测试 · 回合累积器与 NarrativeRequest 构造（设计文档 §6.2）。
 *
 * 核心决策：不复刻八段式编译器，直接调用生产的 toPromptPayload
 * （narrator.ts:2219，内部完成 compileNarrativeContext），喂入最小合成的
 * NarrativeRequest。payload 字段与生产逐字节同源，消除了 harness 漂移风险。
 *
 * 已知简化（记入报告局限）：无压缩器写回、无事实检索、无 SceneFrame 投影、
 * 无时间导演；压缩产物由场景脚本以 memory 字段显式提供（scenarios.ts）。
 */
import { toPromptPayload } from '../../src/narrator'
import { resolveScriptContextBudget } from '../../src/narrative-normalizers'
import type { NarrativeIntent, NarrativeMemory, NarrativeRequest, ScriptEntry } from '../../src/types'

/** 上下文预算：对齐生产 fixed 模式默认值（18 锚点 ∪ 最近 5 分钟）。 */
const BUDGET = resolveScriptContextBudget({ contextEntryLimit: 18, contextTimeWindowMinutes: 5 })

interface AccEntry {
  id: number
  kind: 'user-message' | 'script' | 'character-message'
  actor: 'user' | 'narrator' | 'character'
  content: string
  occurredAt: Date
}

interface PendingIntent {
  id: number
  /** delayed-reply | follow-up-commitment。 */
  type: 'delayed-reply' | 'follow-up-commitment'
  summary: string
  notBefore: Date
  payload: Record<string, unknown>
  /** delayed-reply 专用：已作为 dueIntents 呈现过。 */
  firedOnce?: boolean
}

export class TurnAccumulator {
  private entries: AccEntry[] = []
  private nextEntryId = 1
  private nextIntentId = 9001
  private intents: PendingIntent[] = []
  /** 模拟压缩器产物（脚本注入）。 */
  private memoryRecords: NarrativeMemory[] = []
  unreadMessageCount = 0
  lastUserMessageAt?: Date
  lastCharacterMessageAt?: Date

  constructor(
    private readonly storyId: string,
    private readonly participantId: string,
  ) {}

  get allEntries(): readonly AccEntry[] {
    return this.entries
  }

  get pendingIntents(): readonly PendingIntent[] {
    return this.intents
  }

  lastOccurredAt(): Date | undefined {
    return this.entries.length ? this.entries[this.entries.length - 1].occurredAt : undefined
  }

  addMemory(memory: NarrativeMemory): void {
    this.memoryRecords.push(memory)
  }

  pushUserMessage(content: string, at: Date): void {
    this.entries.push({ id: this.nextEntryId++, kind: 'user-message', actor: 'user', content, occurredAt: at })
    this.unreadMessageCount += 1
    this.lastUserMessageAt = at
  }

  pushScriptProse(prose: string, at: Date): void {
    this.entries.push({ id: this.nextEntryId++, kind: 'script', actor: 'narrator', content: prose, occurredAt: at })
  }

  pushDeliveredMessage(content: string, at: Date): void {
    this.entries.push({ id: this.nextEntryId++, kind: 'character-message', actor: 'character', content, occurredAt: at })
    this.lastCharacterMessageAt = at
  }

  /** 模型 seen=true 时清空未读（对齐"已读"语义）。 */
  markSeen(): void {
    this.unreadMessageCount = 0
  }

  /** 模型返回 delayed reply → 登记 intent（对齐生产的 delayed-reply 台账）。 */
  addDelayedReply(content: string, sendAt: Date): PendingIntent {
    const intent: PendingIntent = {
      id: this.nextIntentId++,
      type: 'delayed-reply',
      summary: `到点补发消息：${content}`,
      notBefore: sendAt,
      payload: { kind: 'delayed-reply', content, sendAt: sendAt.toISOString() },
    }
    this.intents.push(intent)
    return intent
  }

  /** 模型返回 followUpCommitment → 登记（对齐 intents.ts:541 的类型名）。 */
  addFollowUpCommitment(kind: string, summary: string, notBefore: Date, expiresAt?: string): PendingIntent {
    const intent: PendingIntent = {
      id: this.nextIntentId++,
      type: 'follow-up-commitment',
      summary,
      notBefore,
      payload: { kind, ...(expiresAt ? { expiresAt } : {}), sourceEntryIds: [] },
    }
    this.intents.push(intent)
    return intent
  }

  /** 到点意图：notBefore <= now 的 pending 台账（对齐生产 liveNarrativeIntents）。 */
  dueIntents(now: Date): NarrativeIntent[] {
    return this.intents
      .filter(intent => intent.notBefore.getTime() <= now.getTime())
      .map(intent => this.toNarrativeIntent(intent))
  }

  /** 模型用 intentUpdates 结算意图时调用。 */
  resolveIntent(id: number, _status: 'completed' | 'cancelled'): boolean {
    const index = this.intents.findIndex(intent => intent.id === id)
    if (index < 0) return false
    this.intents.splice(index, 1)
    return true
  }

  private toNarrativeIntent(intent: PendingIntent): NarrativeIntent {
    return {
      id: intent.id,
      storyId: this.storyId,
      participantId: this.participantId,
      type: intent.type,
      summary: intent.summary,
      notBefore: intent.notBefore,
      status: 'pending',
      payload: intent.payload,
      createdAt: intent.notBefore,
      updatedAt: intent.notBefore,
    }
  }

  /** 场景脚本注入的派生记忆（模拟压缩产物）。 */
  allMemories(): NarrativeMemory[] {
    return this.memoryRecords.map(memory => this.toMemory(memory))
  }

  /** followUpCommitments 字段用的公开形状（与 dueIntents 同源）。 */
  toNarrativeIntentPublic(intent: PendingIntent): NarrativeIntent {
    return this.toNarrativeIntent(intent)
  }

  /**
   * recentScript 窗口投影：最近 N 条锚点 ∪ 最近窗口分钟内的真实收发。
   * 字符预算交给 toPromptPayload 内部的 compactPromptEntries（12k），与生产一致。
   */
  window(now: Date): ScriptEntry[] {
    const anchorStart = Math.max(0, this.entries.length - BUDGET.count)
    const windowStart = now.getTime() - BUDGET.minutes * 60_000
    const selected = new Set<number>()
    for (let index = anchorStart; index < this.entries.length; index += 1) selected.add(index)
    for (let index = 0; index < this.entries.length; index += 1) {
      if (this.entries[index].occurredAt.getTime() >= windowStart) selected.add(index)
    }
    return [...selected].sort((a, b) => a - b).map(index => this.toScriptEntry(this.entries[index]))
  }

  private toScriptEntry(entry: AccEntry): ScriptEntry {
    return {
      id: entry.id,
      storyId: this.storyId,
      participantId: this.participantId,
      kind: entry.kind,
      actor: entry.actor,
      content: entry.content,
      occurredAt: entry.occurredAt,
      metadata: {},
      createdAt: entry.occurredAt,
    }
  }

  private toMemory(memory: NarrativeMemory): NarrativeMemory {
    return { ...memory, storyId: this.storyId, participantId: this.participantId }
  }
}

export interface TurnPlan {
  phase: 'user-message' | 'advance'
  now: Date
  from: Date
  userMessage?: string
}

/**
 * 构造最小 NarrativeRequest 并调用生产 toPromptPayload。
 * 返回编译后的最终 payload（cache-first 顺序，对齐生产默认 mainPayloadOrder）。
 */
export function buildCompiledPayload(options: {
  story: NarrativeRequest['story']
  participant: NarrativeRequest['participant']
  acc: TurnAccumulator
  plan: TurnPlan
  cacheFirst?: boolean
}): { request: NarrativeRequest, payloadJson: string } {
  const { story, participant, acc, plan } = options
  const dueIntents = acc.dueIntents(plan.now)
  const request: NarrativeRequest = {
    phase: plan.phase,
    story,
    from: plan.from,
    now: plan.now,
    ...(plan.userMessage !== undefined ? { userMessage: plan.userMessage } : {}),
    participant,
    participants: [],
    shareParticipantDetails: false,
    dueIntents,
    activeConsequences: [],
    supersededIntents: [],
    recentEntries: acc.window(plan.now),
    memories: acc.allMemories(),
    followUpCommitments: plan.phase === 'user-message'
      ? acc.pendingIntents.filter(intent => intent.type === 'follow-up-commitment').map(intent => acc.toNarrativeIntentPublic(intent))
      : undefined,
    writingOptions: { messageSeparator: '<sep/>', splitReplyMessages: true, browserMode: 'disabled' },
    agencyWindow: null,
    emotionalOffset: null,
    schedulePreplan: null,
  }
  const payloadJson = JSON.stringify(toPromptPayload(request, { cacheFirst: options.cacheFirst ?? true }))
  return { request, payloadJson }
}
