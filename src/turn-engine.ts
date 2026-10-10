/**
 * P0 试点：TurnEngine——从 service.ts 抽出的缓冲回合状态管理。
 *
 * 拥有 bufferedNarrativeTurns + narratingStories 两个状态容器，
 * 以及直接操作它们的四个方法（buffer/signal/invalidate/hasPending）。
 * flushBufferedNarrative 的执行体留在 service（它调用模型/投递/持久化），
 * 但通过 beginFlush/endFlush 与本模块交互状态。
 */
import type { Session } from 'koishi'
import type { InterludeStory, InterludeParticipant, NarrativeIntent, QuotedMessageContext } from './types'

export interface BufferedUserMessage {
  content: string
  occurredAt: Date
  /** Registered inbound endpoint for deterministic batch attribution. */
  endpointId?: string
  supersededIntents: NarrativeIntent[]
  imageSources: string[]
  audioSources: string[]
  quote?: QuotedMessageContext
}

export interface BufferedNarrativeTurn {
  storyId: string
  participantId: string
  messages: BufferedUserMessage[]
  latestSession?: Session
  timer?: () => void
  nextRevision: number
  inFlightRequestId?: number
  firstMessageCommittedRequestId?: number
  obsoleteRequestIds: Set<number>
  /** Requests invalidated by an administrative reset/purge must not be requeued. */
  discardedRequestIds?: Set<number>
  /** M2 §1.3：本回合涉及端点按接收序号有序；空 = 未解析（单端点等价）。 */
  sources: Array<{ endpointId: string, receivedSeq: number }>
  /** Snapshot used by the request currently being flushed. */
  activeSources?: Array<{ endpointId: string, receivedSeq: number }>
  /** Endpoint ids represented by the messages in the active debounce batch. */
  activeBatchEndpointIds?: string[]
  /** Number of messages represented by the active batch (including legacy
   * messages whose endpoint could not be resolved). */
  activeBatchMessageCount?: number
}

/** 最小依赖集——不含模型调用/投递/持久化（那些留在 service）。 */
export interface TurnEngineDeps {
  setTimeout: (fn: () => void, ms: number) => () => void
  userMessageDebounceSeconds: number
  /** endFlush 为遗留消息补定时器用的统一触发入口(service 的 flushBufferedNarrative)。 */
  scheduleTurnFlush: (key: string, revision: number) => void
  reportOperation: (level: string, kind: string, story: InterludeStory, phase: string, format: string, ...args: unknown[]) => void
}

export function shouldSupersedeRequest(
  inFlightRequestId: number | undefined,
  firstMessageCommittedRequestId: number | undefined,
  obsoleteRequestIds: ReadonlySet<number>,
): boolean {
  return inFlightRequestId != null
    && inFlightRequestId !== firstMessageCommittedRequestId
    && !obsoleteRequestIds.has(inFlightRequestId)
}

export interface TurnEngine {
  /** 状态容器（service 的 flushBufferedNarrative 直接访问） */
  readonly turns: Map<string, BufferedNarrativeTurn>
  readonly narrating: Set<string>

  bufferUserNarrative(
    story: InterludeStory, participant: InterludeParticipant, session: Session,
    now: Date, supersededIntents: NarrativeIntent[],
    content: string, imageSources: string[], audioSources: string[], quote: QuotedMessageContext | undefined,
    flushTrigger: (key: string, revision: number) => void, endpointId?: string,
  ): void

  signalIncomingInterruption(story: InterludeStory, participant: InterludeParticipant): void

  hasPendingNarrative(storyId: string, hasPendingGroupTurn: (storyId: string) => boolean): boolean

  /** flush 开始：取回 turn 并标记 narrating；返回 null 表示不该 flush。 */
  beginFlush(key: string, revision: number, retryDelay: (key: string, revision: number) => void): BufferedNarrativeTurn | null

  /** flush 结束：清理 narrating 标记和空 turn。 */
  endFlush(key: string, requestId: number): void

  /** 暂停/恢复时重设定时器。 */
  rescheduleTimers(flushTrigger: (key: string, revision: number) => void): void

  /** 使全部（或指定故事的）回合失效。 */
  invalidateNarratives(storyId?: string, invalidateGroups?: (storyId?: string) => void): void

  /** M2 §1.3：追加本回合来源端点（同回合第二端点追加而非新回合）。 */
  recordSource(key: string, endpointId: string, receivedSeq: number): void

  /** 只读查询 */
  isNarrating(storyId: string): boolean
  getTurn(key: string): BufferedNarrativeTurn | undefined
  pendingTurnCount(): number
}

export function createTurnEngine(deps: TurnEngineDeps): TurnEngine {
  const turns = new Map<string, BufferedNarrativeTurn>()
  const narrating = new Set<string>()

  function bufferUserNarrative(
    story: InterludeStory, participant: InterludeParticipant, session: Session,
    now: Date, supersededIntents: NarrativeIntent[],
    content: string, imageSources: string[], audioSources: string[], quote: QuotedMessageContext | undefined,
    flushTrigger: (key: string, revision: number) => void, endpointId?: string,
  ) {
    const key = participant.id
    const existing = turns.get(key)
    const turn: BufferedNarrativeTurn = existing ?? {
      storyId: story.id, participantId: participant.id, messages: [], nextRevision: 0,
      obsoleteRequestIds: new Set(), discardedRequestIds: new Set(), sources: [],
    }
    if (shouldSupersedeRequest(turn.inFlightRequestId, turn.firstMessageCommittedRequestId, turn.obsoleteRequestIds)) {
      turn.obsoleteRequestIds.add(turn.inFlightRequestId!)
      deps.reportOperation('standard', 'info', story, 'user-message', '新消息到达且首条回复尚未提交，放弃旧请求 参与者=%s 请求=%d', participant.id, turn.inFlightRequestId)
    }
    turn.messages.push({ content, occurredAt: now, supersededIntents, imageSources, audioSources,
      ...(endpointId ? { endpointId } : {}), ...(quote !== undefined && quote !== null ? { quote } : {}) })
    turn.latestSession = session
    if (turn.timer) turn.timer()
    const revision = ++turn.nextRevision
    const delay = Math.max(0, deps.userMessageDebounceSeconds) * 1000
    turn.timer = deps.setTimeout(() => flushTrigger(key, revision), delay)
    turns.set(key, turn)
    deps.reportOperation('diagnostic', 'debug', story, 'user-message', '短时消息合并 参与者=%s 待处理=%d 等待=%dms', participant.id, turn.messages.length, delay)
  }

  function signalIncomingInterruption(story: InterludeStory, participant: InterludeParticipant) {
    const turn = turns.get(participant.id)
    if (!turn || !shouldSupersedeRequest(turn.inFlightRequestId, turn.firstMessageCommittedRequestId, turn.obsoleteRequestIds)) return
    turn.obsoleteRequestIds.add(turn.inFlightRequestId!)
    deps.reportOperation('standard', 'info', story, 'user-message',
      '新消息到达且首条回复尚未提交，放弃旧请求 参与者=%s 请求=%d', participant.id, turn.inFlightRequestId)
  }

  function hasPendingNarrative(storyId: string, hasPendingGroupTurn: (storyId: string) => boolean): boolean {
    if (narrating.has(storyId)) return true
    for (const turn of turns.values()) {
      if (turn.storyId === storyId && (turn.messages.length || turn.timer || turn.inFlightRequestId)) return true
    }
    return hasPendingGroupTurn(storyId)
  }

  function beginFlush(key: string, revision: number, retryDelay: (key: string, revision: number) => void): BufferedNarrativeTurn | null {
    const turn = turns.get(key)
    if (!turn || turn.nextRevision !== revision) return null
    if (narrating.has(turn.storyId)) {
      turn.timer = deps.setTimeout(() => retryDelay(key, revision), 250)
      return null
    }
    narrating.add(turn.storyId)
    turn.timer = undefined
    turn.activeSources = turn.sources
    turn.sources = []
    return turn
  }

  function endFlush(key: string, requestId: number) {
    const turn = turns.get(key)
    if (!turn) return
    if (turn.inFlightRequestId === requestId) {
      turn.inFlightRequestId = undefined
      turn.firstMessageCommittedRequestId = undefined
      // These fields describe only the request that just ended. Clear them
      // before a pending replacement batch or an automatic continuation can
      // reuse the same turn owner.
      turn.activeSources = undefined
      turn.activeBatchEndpointIds = undefined
      turn.activeBatchMessageCount = undefined
      narrating.delete(turn.storyId)
    }
    turn.obsoleteRequestIds.delete(requestId)
    turn.discardedRequestIds?.delete(requestId)
    if (!turn.messages.length && !turn.timer && !turn.inFlightRequestId) turns.delete(key)
    // 回合结束时仍有未处理消息(暂停期被取消的定时器/obsolete 拦截放回的批次/
    // in-flight 期间到达的新消息)却无人持有定时器 → 孤儿:有消息无定时器,要等
    // 下一条用户消息才被救活,期间还阻塞后台推进。此处补一个定时器闭环:
    // 运行态直接触发 flush;暂停态触发会被 flush 入口的 paused 检查拦下,
    // 消息保留在 turn 里,由 resume 的 rescheduleTimers 接管。
    else if (turn.messages.length && !turn.timer && !turn.inFlightRequestId) {
      const revision = ++turn.nextRevision
      turn.timer = deps.setTimeout(() => deps.scheduleTurnFlush(key, revision), Math.max(0, deps.userMessageDebounceSeconds) * 1000)
    }
  }

  function rescheduleTimers(flushTrigger: (key: string, revision: number) => void) {
    for (const [key, turn] of turns) {
      if (!turn.timer && !turn.inFlightRequestId && turn.messages.length) {
        const revision = ++turn.nextRevision
        turn.timer = deps.setTimeout(() => flushTrigger(key, revision), 0)
      }
    }
  }

  function invalidateNarratives(storyId?: string, invalidateGroups?: (storyId?: string) => void) {
    for (const [key, turn] of turns) {
      if (storyId && turn.storyId !== storyId) continue
      if (turn.timer) turn.timer()
      if (turn.inFlightRequestId != null) {
        // Keep an in-flight owner in the map until endFlush() runs. Deleting it
        // here would strand narrating.has(storyId)=true forever because the
        // completion callback would no longer have a turn through which to
        // release the story claim. Clear only buffered work; a later message
        // may reuse this owner while the obsolete request is winding down.
        turn.obsoleteRequestIds.add(turn.inFlightRequestId)
        ;(turn.discardedRequestIds ??= new Set()).add(turn.inFlightRequestId)
        turn.messages.length = 0
        turn.timer = undefined
      } else {
        turns.delete(key)
      }
    }
    invalidateGroups?.(storyId)
  }

  function recordSource(key: string, endpointId: string, receivedSeq: number) {
    const turn = turns.get(key)
    if (!turn) return
    if (turn.sources.some(source => source.endpointId === endpointId)) return
    turn.sources.push({ endpointId, receivedSeq })
    turn.sources.sort((left, right) => left.receivedSeq - right.receivedSeq)
  }

  return {
    turns, narrating,
    bufferUserNarrative, signalIncomingInterruption, hasPendingNarrative,
    beginFlush, endFlush, rescheduleTimers, invalidateNarratives, recordSource,
    isNarrating: (storyId: string) => narrating.has(storyId),
    getTurn: (key: string) => turns.get(key),
    pendingTurnCount: () => turns.size,
  }
}

export type { BufferedNarrativeTurn as TurnBufferedNarrativeTurn, BufferedUserMessage as TurnBufferedUserMessage }
