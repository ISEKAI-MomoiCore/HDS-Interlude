/**
 * OneBotAdapter：PlatformAdapter 的 QQ/OneBot 实现（解耦设计 §4 / D2）。
 *
 * D2 形态：包装不搬移——全部方法委托宿主（InterludeService）的既有薄委托
 * （它们再进入 sticker-library / media-loading / delivery-pipeline /
 * group-actions 等模块），函数本体与锁相位零改动；本类只负责两件事：
 * ① 持有句柄→会话解析表（自 service 迁入，F3 引用语义原样）；
 * ② 把 TurnHandle 解析成 Session 后转发。
 *
 * 本文件允许 import koishi（平台实现侧）；叙事核心不允许（D4 守卫）。
 */
import type { Session } from 'koishi'
import type { InterludeService } from '../service'
import type { TurnHandle } from '../turn-engine'
import type {
  EarlyNarrativeReply, InterludeParticipant, InterludeStory, NarrativeAudio, NarrativeImage,
  NativeFaceSemantic, OutgoingMessageDraft, ScriptEntry, StickerAsset,
} from '../types'
import type { ScriptDeliveryReference } from '../script/delivery-ledger'
import type { PlatformAdapter } from './adapter'

export class OneBotAdapter implements PlatformAdapter {
  /** 句柄→会话解析表。引用语义见 service 旧注释（审计 F3）：被引擎
   * turns 的 latestHandle 引用的键绝不逐出；同通道重登记刷新近用顺序。 */
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly host: InterludeService) {}

  private key(handle: TurnHandle) {
    return `${handle.platform}:${handle.selfId ?? ''}:${handle.channelId}`
  }

  rememberSession(handle: TurnHandle, session: unknown): void {
    const key = this.key(handle)
    this.sessions.delete(key)
    this.sessions.set(key, session as Session)
    // 复审 R3：新登记键在本次回收中受保护——回合/群批次的引用在登记之后
    // 才建立，若旧缓存全部被引用，新键是唯一"无引用项"会被自己清掉。
    this.pruneSessions(128, key)
  }

  resolveSession(handle: TurnHandle | undefined): unknown {
    if (!handle) return undefined
    return this.sessions.get(this.key(handle))
  }

  pruneSessions(cap: number, protectKey?: string): void {
    if (!this.sessions.size) return
    const referenced = new Set<string>()
    // 复审 R2：引用全集 = 私聊回合（turnEngine.turns）∪ 群回合
    // （bufferedGroupTurns）——两者都持有 latestHandle，缺任何一边都会把
    // 仍在排队/在途的回合会话当无引用项回收。
    for (const turn of this.host.turnEngine?.turns?.values() ?? []) {
      if (turn.latestHandle) referenced.add(this.key(turn.latestHandle))
    }
    for (const turn of this.host.bufferedGroupTurns?.values() ?? []) {
      if (turn.latestHandle) referenced.add(this.key(turn.latestHandle))
    }
    for (const key of this.sessions.keys()) {
      if (this.sessions.size <= cap) break
      if (protectKey === key || referenced.has(key)) continue
      this.sessions.delete(key)
    }
  }

  sessionCount(): number {
    return this.sessions.size
  }

  private session(handle: TurnHandle | undefined): Session | undefined {
    return this.resolveSession(handle) as Session | undefined
  }

  privateCapabilities(handle: TurnHandle | undefined) {
    return this.host.privateChatCapabilities(this.session(handle))
  }

  stickerCatalog(handle: TurnHandle | undefined, turnQueryEmbedding?: number[]): Promise<import('../types').StickerCatalogEntry[]> {
    return this.host.stickerCatalogForSession(this.session(handle), turnQueryEmbedding)
  }

  loadImages(story: InterludeStory, sources: string[], handle: TurnHandle | undefined): Promise<NarrativeImage[]> {
    return this.host.loadNativeImages(story, sources, this.session(handle))
  }

  loadAudio(story: InterludeStory, sources: string[], handle: TurnHandle | undefined, maxCount?: number): Promise<NarrativeAudio[]> {
    return this.host.loadNativeAudio(story, sources, this.session(handle), maxCount)
  }

  deliverOutgoing(
    story: InterludeStory, messages: OutgoingMessageDraft[], participant?: InterludeParticipant,
    handle?: TurnHandle, shouldCancel?: (target: InterludeParticipant) => boolean, recordFailures?: boolean,
    requestStartedAt?: Date, failureStatus?: 'failed' | 'pending', splitSegment?: boolean, confirmedEntries?: ScriptEntry[],
  ): Promise<OutgoingMessageDraft[]> {
    return this.host.deliverOutgoingMessages(story, messages, participant, this.session(handle), shouldCancel, recordFailures, requestStartedAt, failureStatus, splitSegment, confirmedEntries)
  }

  deliverEarlyReply(
    story: InterludeStory, participant: InterludeParticipant, handle: TurnHandle | undefined,
    turn: Parameters<PlatformAdapter['deliverEarlyReply']>[3], requestId: number, reply: EarlyNarrativeReply, requestStartedAt?: Date,
  ): Promise<ScriptEntry | false | undefined> {
    return this.host.deliverEarlyPrivateReply(story, participant, this.session(handle), turn, requestId, reply, requestStartedAt)
  }

  async sendSticker(story: InterludeStory, handle: TurnHandle | undefined, channelId: string, asset: StickerAsset, groupId?: string, reference?: ScriptDeliveryReference) {
    const session = this.session(handle)
    if (!session) return false
    return this.host.sendSticker(story, session, channelId, asset, groupId, reference)
  }

  async sendNativeFace(story: InterludeStory, handle: TurnHandle | undefined, channelId: string, semantic: NativeFaceSemantic, groupId?: string, reference?: ScriptDeliveryReference) {
    const session = this.session(handle)
    if (!session) return false
    return this.host.sendNativeFace(story, session, channelId, semantic, groupId, reference)
  }
// ── 群聊回合（D4）──────────────────────────────────────────────────

  adoptSession(session: unknown): TurnHandle | undefined {
    if (!session || typeof session !== 'object') return undefined
    const raw = session as { platform?: unknown, channelId?: unknown, selfId?: unknown }
    const platform = String(raw.platform ?? '')
    const channelId = String(raw.channelId ?? '')
    if (!platform || !channelId) return undefined
    const handle: TurnHandle = { platform, channelId, ...(raw.selfId != null ? { selfId: String(raw.selfId) } : {}) }
    this.rememberSession(handle, session)
    return handle
  }

  groupCapabilities(handle: TurnHandle | undefined, messages: unknown[]) {
    return this.host.groupChatCapabilities(this.session(handle), messages as any)
  }

  historicalImages(story: InterludeStory, refs: unknown, limit: number, handle: TurnHandle | undefined, currentSources?: string[]) {
    return this.host.loadHistoricalGroupImages(story, refs as any, limit, this.session(handle), currentSources)
  }

  sendGroupMessage(story: InterludeStory, channelId: string, content: string, replyTo?: string, handle?: TurnHandle, shouldCancel?: () => boolean) {
    return this.host.sendGroupMessage(story, channelId, content, replyTo, this.session(handle), undefined, undefined, shouldCancel
      ? { shouldCancel, settled: new Map(), onDelivered: () => {} } : undefined)
  }

  async executeGroupReactions(story: InterludeStory, handle: TurnHandle | undefined, groupId: string, reactions: unknown[], reference: (reaction: unknown) => unknown): Promise<number> {
    const session = this.session(handle)
    if (!session) return 0
    return this.host.executeGroupReactions(story, session, groupId, reactions as any, reference as any)
  }
}
