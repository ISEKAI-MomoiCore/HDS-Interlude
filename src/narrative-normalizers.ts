/** 叙事归一化与计算助手：可见回复裁剪、决策/交互/意图/事实/回访归一化、
 * 召回打分、节奏与钟点越界检测、overlay 归并，及通用微工具（clip/isRecord/toDate 等）。
 * P1 自 service.ts 尾部迁出（2026-10-29），行为不变。 */

/** D4：时间常量本地化（原 koishi Time），叙事侧去 koishi 运行时依赖。 */
import { normalizeGroupId } from './platform/identity'

const Time = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const
import { decodeStoryState, normalizeContinuitySnapshot, normalizeScenePresenceState } from './story-state'
import { IntentDraft, InterludeParticipant, InterludeStory, MemoryDraft, NarrativeDecision, NarrativeFact, NarrativeIntent, GroupContext, NarrativeInteraction, NarrativeRequest, OutgoingMessageDraft, ParticipantState, ScriptEntry, StatePatchProposal, StorySetting, BrowserIntentDraft, OverlaySnapshot, WebObservation, ScenePresenceDraft, ScenePresenceState, FollowUpCommitmentDraft, FollowUpResolutionDraft, NarrativeContractFeatures } from './types'
import { shouldSupersedeRequest, type TurnBufferedUserMessage as BufferedUserMessage } from './turn-engine'

import { normalizeAlterValue } from './alter'
import { developmentScenes, developmentTurns } from './script/development'
import { reconcileTransportReferences } from './script/authored-actions'
import { contactPlanFromAction, contactPlanFromDraft, parseCommunicationActions } from './script/contact-actions'
import { normalizeLifeHandoff } from './script/life-handoff'
import { calendarDayKey, localClockMinutes, storyLocalTimeContext } from './time'
import type { BlindModeConfig, MemoryConfig, RuntimeConfig, BrowserConfig, SharedStoryConfig, RestWindow, AutoAdvanceConfig } from './service'

export function normalizeGroupVisibleReply(raw: NarrativeDecision['groupReply'], interaction: NarrativeDecision['interaction'], maxCharacters: number, separator = '<sep/>', splitEnabled = true) {
  const content = normalizeGroupReply(raw, maxCharacters, separator) || normalizeGroupInteractionReply(interaction, maxCharacters, separator)
  // 此处只把空行（段落边界）转换为分隔符，单个换行留在一条消息内；拆条关闭
  // 时不做转换。注意：convertNewlineToSeparator 开启后，发送层
  // （splitVisibleReplyBubbles）会把单个换行也视为气泡边界——群内容无分隔符
  // 且无空行时按单换行拆条，属该开关的预期小模型语义。
  if (!splitEnabled || !content) return content
  const canonical = separator?.trim() || '<sep/>'
  return content.includes(canonical) ? content : content.replace(/\s*\r?\n\s*\r?\n+/g, canonical)
}

/** 无 participant 回合的 interaction 容错：群聊回合（user-message 且无 participant）
 * 把 immediate 的 interaction 回复提升为 groupReply 参与提交与投递——简洁协议把
 * interaction 形态写在最前，弱模型常在群聊照抄私聊形态。不提升时 commit-builder
 * 会为无 participant 的 interaction 生成 outgoing-message 事件，结构校验失败导致
 * 整回合静默。其余无 participant 相位（advance 等）本无回复通道，携带内容的
 * interaction 一律剥离，同样避免校验失败。 */

/** 无 participant 回合的 interaction 容错：群聊回合（user-message 且无 participant）
 * 把 immediate 的 interaction 回复提升为 groupReply 参与提交与投递——简洁协议把
 * interaction 形态写在最前，弱模型常在群聊照抄私聊形态。不提升时 commit-builder
 * 会为无 participant 的 interaction 生成 outgoing-message 事件，结构校验失败导致
 * 整回合静默。其余无 participant 相位（advance 等）本无回复通道，携带内容的
 * interaction 一律剥离，同样避免校验失败。 */
export function hoistParticipantlessInteraction<T extends NarrativeDecision>(decision: T, phase: NarrativeRequest['phase']): T {
  const reply = decision.interaction?.reply
  if (!reply || reply.mode === 'none' || !reply.content?.trim()) return decision
  if (reply.mode === 'immediate' && phase === 'user-message' && !hasStructuredGroupReplyField(decision.groupReply)) {
    return {
      ...decision,
      groupReply: { mode: 'immediate', content: reply.content, ...(reply.replyTo ? { replyTo: reply.replyTo } : {}) },
      interaction: undefined,
    }
  }
  return { ...decision, interaction: undefined }
}


export function requiresVisibleReplyRecovery(phase: NarrativeRequest['phase'], groupContext: GroupContext | undefined, decision: NarrativeDecision) {
  if (phase !== 'user-message') return false
  if (groupContext) return !hasStructuredGroupReply(decision)
  // 合法的"只发表情/动作不配文字"回合：interaction 为弱形态但携带任一动作
  // 字段时不属于回复缺失（placement:standalone 本就表示不配文字）。动作
  // 字段的嵌套形态已由 reconcileTransportReferences 提权到顶层。
  if (decision.localMedia || decision.nativeFace || decision.messageReactions?.length) return false
  // mode=none+actionId 的弱模型矛盾形态不在此处理：能锚定 say 行动的由
  // reconcileTransportReferences 就地救援为 immediate，锚不定的按合法沉默放行
  // （重写无法改变模型的稳定输出习惯，只会把"静默不发"恶化成"整回合失败"）。
  return !hasStructuredInteraction(decision.interaction)
}


export function visibleReplyMode(decision: NarrativeDecision, phase: NarrativeRequest['phase'], groupContext?: GroupContext) {
  if (phase === 'advance') {
    if (decision.crossConversationActions?.some(action => action.mode === 'immediate')) return '主动联系'
    if (decision.crossConversationActions?.some(action => action.mode === 'delayed')) return '计划联系'
    return '无可见投递'
  }
  if (phase === 'conversation-follow-up' || phase === 'intent-due') {
    if (hasStructuredInteraction(decision.interaction)) return decision.interaction!.reply.mode
    if (decision.crossConversationActions?.some(action => action.mode === 'immediate')) return '主动联系'
    return '无可见投递'
  }
  if (!groupContext) return hasStructuredInteraction(decision.interaction) ? decision.interaction!.reply.mode : '未提供或无效'
  if (hasStructuredGroupReplyField(decision.groupReply)) return `group:${decision.groupReply!.mode}`
  if (hasStructuredInteraction(decision.interaction)) return `group-fallback:${decision.interaction!.reply.mode}`
  return '未提供或无效'
}


function hasStructuredGroupReply(decision: NarrativeDecision) {
  return hasStructuredGroupReplyField(decision.groupReply) || hasStructuredInteraction(decision.interaction)
}


function hasStructuredGroupReplyField(value: unknown) {
  if (!isRecord(value) || (value.mode !== 'none' && value.mode !== 'immediate')) return false
  return value.mode === 'none' || typeof value.content === 'string' && !!value.content.trim()
}


function hasStructuredInteraction(value: unknown) {
  if (!isRecord(value) || typeof value.seen !== 'boolean' || !isRecord(value.reply)) return false
  const mode = value.reply.mode
  if (mode !== 'none' && mode !== 'immediate' && mode !== 'delayed') return false
  if (mode === 'none') return true
  if (typeof value.reply.content !== 'string' || !value.reply.content.trim()) return false
  return mode === 'immediate' || typeof value.reply.sendAt === 'string' && !!value.reply.sendAt.trim()
}

/** Compact JSON for diagnostic logs: never throws, bounded length. */

/** Compact JSON for diagnostic logs: never throws, bounded length. */
export function safeJsonPreview(value: unknown) {
  try {
    const text = value === undefined ? 'undefined' : JSON.stringify(value)
    return String(text).slice(0, 300)
  } catch {
    return '(unserializable)'
  }
}


function normalizeGroupReply(raw: NarrativeDecision['groupReply'], maxCharacters: number, separator = '<sep/>') {
  if (!raw || raw.mode !== 'immediate') return ''
  return sanitizeAndClampVisibleContent(raw.content, maxCharacters, separator)
}


function normalizeGroupInteractionReply(raw: NarrativeDecision['interaction'], maxCharacters: number, separator = '<sep/>') {
  if (!raw || !raw.reply || raw.reply.mode !== 'immediate') return ''
  return sanitizeAndClampVisibleContent(raw.reply.content, maxCharacters, separator)
}


export function sanitizeAndClampVisibleContent(value: unknown, maxCharacters: number, separator = '<sep/>') {
  return String(value ?? '')
    // Providers occasionally drop the slash or emit full-width brackets while
    // copying the contract. Normalize only structured visible replies; script
    // prose and incoming user text remain untouched.
    .replace(/[<＜]\s*sep\s*\/?\s*[>＞]/gi, separator.trim() || '<sep/>')
    // 引号层级提升：模型剧本的嵌套引号 ‘...’ 在外层 “...” 剥掉后应升为
    // “...”——投递的消息自身已是第一层，内层引号用双引号才是中文规范。
    // 只处理成对的中文弯单引号；ASCII '...' (英文缩写) 和不成对的 ‘’ 不动。
    .replace(/‘([^’]+)’/g, '“$1”')
    // 模型可能复述入站消息里的附件标记（如 <file src="…qqdownload…">）。
    // 可见回复是纯文本合约：标记一旦漏出会被适配器解析成真实附件发出去。
    .replace(/<\/?(?:file|img|image|audio|record|video|flash|mface)\b[^>]*\/?>/gi, '')
    .replace(/\[CQ:(?:file|image|record|video|flash|mface),[^\]]*\]/gi, '')
    .replace(/[\[【](?:表情包?|图片|动图|GIF)[\]】]/gi, '')
    .replace(/[\[【](?:流汗|微笑|笑哭|尴尬|爱心|惊讶|流泪|委屈)[\]】]/gi, '')
    .trim()
    .slice(0, Math.max(1, maxCharacters))
}

/** 可见回复的气泡拆分（纯函数，可单测）。
 * 小模型适配开关：模型没有按合约输出 <sep/> 而是用换行分条时，把换行运行
 * （含单个换行与 CRLF）视作气泡边界。仅在内容不含显式分隔符时转换——
 * 模型自己写了 <sep/> 就尊重原样；群路径的空行转换（normalizeGroupVisibleReply）
 * 发生在更早阶段且已含分隔符，同样不会被二次改写。 */

/** 可见回复的气泡拆分（纯函数，可单测）。
 * 小模型适配开关：模型没有按合约输出 <sep/> 而是用换行分条时，把换行运行
 * （含单个换行与 CRLF）视作气泡边界。仅在内容不含显式分隔符时转换——
 * 模型自己写了 <sep/> 就尊重原样；群路径的空行转换（normalizeGroupVisibleReply）
 * 发生在更早阶段且已含分隔符，同样不会被二次改写。 */
export function splitVisibleReplyBubbles(content: string, options: { separator?: string, splitEnabled: boolean, newlineAsSeparator?: boolean }): string[] {
  if (!options.splitEnabled) return [content]
  const separator = options.separator?.trim() || '<sep/>'
  if (!separator) return [content]
  let normalized = content
  if (options.newlineAsSeparator && !normalized.includes(separator) && /\r?\n/.test(normalized)) {
    normalized = normalized.replace(/\r?\n+/g, separator)
  }
  if (!normalized.includes(separator)) return [content]
  const parts = normalized.split(separator).map(part => part.trim()).filter(Boolean)
  // 全部分隔出空段（如内容本身只有换行）时保留原文形态，不产生空投递列表。
  return parts.length ? parts : [content]
}


export function literalQuoteText(value: unknown) {
  const match = /^\s*[「\[]引用[:：]\s*(.*?)\s*[」\]]\s*$/.exec(String(value ?? ''))
  return match?.[1]?.trim() || ''
}


export function isLiteralQuoteOnly(value: unknown) {
  return !!literalQuoteText(value)
}

/** Treat OneBot transport aliases as one administrator-facing platform family. */

/** 剧本历史注入预算（纯函数，可单测）。
 * M4.1 曾在此处叠加 Math.max(35, …) 硬地板保护连续性——副作用是 Console 里
 * 调小 contextEntryLimit 完全失效，小模型无法收缩上下文。现在尊重用户设置：
 * 条数默认 35（schema 默认），需要更小历史的部署（小模型）可显式调小，
 * 并配合把 contextTimeWindowMinutes 调小或设 0（时间窗会把近窗口内的全部
 * 条目并入，即使超过条数）。 */
export function resolveScriptContextBudget(runtime: Pick<RuntimeConfig, 'contextEntryLimit' | 'contextTimeWindowMinutes'>): { count: number, minutes: number } {
  return {
    count: Math.max(1, Math.min(Math.floor(runtime.contextEntryLimit ?? 18), 200)),
    minutes: Math.max(0, Math.min(Math.floor(runtime.contextTimeWindowMinutes ?? 5), 1_440)),
  }
}



/** 合约自动拼装的纯信号解析（可单测）。每条门控都是"配置 OR 窗口数据"：
 * 功能关闭后，窗口内的历史条目与待办意图仍会保留对应解释行，直到它们
 * 自然滚出上下文——模型永远不该看到无合约解释的 payload 字段。 */

/** 合约自动拼装的纯信号解析（可单测）。每条门控都是"配置 OR 窗口数据"：
 * 功能关闭后，窗口内的历史条目与待办意图仍会保留对应解释行，直到它们
 * 自然滚出上下文——模型永远不该看到无合约解释的 payload 字段。 */
export function resolveNarrativeContractFeatures(signals: {
  qzoneEnabled: boolean
  pendingQzoneActionIntents: boolean
  windowHasQzoneFeedEntries: boolean
  groupTargetsPresent: boolean
  anyGroupEnabled: boolean
  windowHasGroupEntries: boolean
  hasWechatEndpoint: boolean
  browserActive: boolean
  webContextPresent: boolean
  semanticRecallEnabled: boolean
  recallQueryActive: boolean
  worldEventsEnabled: boolean
  windowHasWorldEventEntries: boolean
  windowHasAdminNotes: boolean
  researchEnabled: boolean
}): NarrativeContractFeatures {
  return {
    qzone: signals.qzoneEnabled || signals.pendingQzoneActionIntents || signals.windowHasQzoneFeedEntries,
    groupDelivery: signals.groupTargetsPresent || signals.anyGroupEnabled,
    groupHistory: signals.anyGroupEnabled || signals.windowHasGroupEntries,
    multiPlatform: signals.hasWechatEndpoint,
    webObservation: signals.browserActive || signals.webContextPresent,
    semanticRecall: signals.semanticRecallEnabled || signals.recallQueryActive,
    worldEvents: signals.worldEventsEnabled || signals.windowHasWorldEventEntries,
    adminNotes: signals.windowHasAdminNotes,
    researchDesk: signals.researchEnabled,
  }
}




export function signedNumber(value: number) {
  return `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(2)}`
}


export function quotesBot(session: { quote?: { user?: { id?: unknown } }, selfId?: unknown }) {
  return String((session as any).quote?.user?.id ?? '') === String(session.selfId ?? '')
}


export function isTransientDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /disk\s*i\/o|database is locked|busy|unable to open/i.test(message)
}




/** 模型偶发把 script 输出成对象（{tag,content} / {entries:[…]}，形态模仿
 * recentScript 的载荷结构）。散文完整，做无损归一而非弃稿：对象直取散文键、
 * entries 按序拼接、顶层数组同法。归一发生在 no-usable-script 闸门之前
 * （decide() 返回链），normalizeDecision 内再兜一道。 */

/** 模型偶发把 script 输出成对象（{tag,content} / {entries:[…]}，形态模仿
 * recentScript 的载荷结构）。散文完整，做无损归一而非弃稿：对象直取散文键、
 * entries 按序拼接、顶层数组同法。归一发生在 no-usable-script 闸门之前
 * （decide() 返回链），normalizeDecision 内再兜一道。 */
export function normalizeScriptField(raw: unknown): string {
  if (typeof raw === 'string') return raw
  const proseOf = (entry: unknown): string => {
    const item = entry as Record<string, unknown> | null
    const text = typeof item?.text === 'string' ? item.text : typeof item?.content === 'string' ? item.content : ''
    return text.trim()
  }
  const joinEntries = (list: unknown[]): string => list.map(proseOf).filter(Boolean).join('\n')
  if (Array.isArray(raw)) return joinEntries(raw)
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  for (const key of ['content', 'text', 'prose', 'narration', 'body', 'script']) {
    if (typeof record[key] === 'string' && (record[key] as string).trim()) return record[key] as string
  }
  if (Array.isArray(record.entries)) return joinEntries(record.entries)
  return ''
}


export function hasRequiredNarrativeScript(value: NarrativeDecision | undefined | null) {
  return typeof value?.script === 'string' && value.script.trim().length > 0
}


export function resolveBlindModeConfig(value?: Partial<BlindModeConfig>): BlindModeConfig {
  return {
    enabled: value?.enabled === true,
    healthReportMinutes: Math.max(1, Math.min(1_440, Math.floor(value?.healthReportMinutes ?? 10))),
  }
}


export function isAutomaticNarrativePhase(phase: NarrativeRequest['phase']) {
  return phase === 'advance' || phase === 'conversation-follow-up'
}


function normalizeAutomaticDeliverySummary(value: unknown) {
  return typeof value === 'string' ? clip(value, 240).trim() : ''
}


export function normalizeFollowUpSummary(value: unknown) {
  return typeof value === 'string' ? clip(value, 360).trim().replace(/\s+/g, ' ').toLowerCase() : ''
}


export const MAX_FOLLOW_UP_DEFERRED_CHECKS = 5


export function followUpDeferredChecks(intent: NarrativeIntent) {
  const value = Number(intent.payload?.deferredChecks)
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}


export function followUpDeadline(intent: NarrativeIntent) {
  return toDate(intent.payload?.expiresAt) ?? new Date(intent.createdAt.getTime() + 24 * Time.hour)
}


export function followUpExpiresAt(value: unknown, now: Date) {
  const requested = toDate(value)
  const maximum = new Date(now.getTime() + 24 * Time.hour)
  if (!requested || requested <= now) return maximum
  return requested < maximum ? requested : maximum
}


export function normalizeFollowUpCommitment(value: unknown, now: Date): FollowUpCommitmentDraft | undefined {
  if (!isRecord(value)) return undefined
  const kind = value.kind === 'thinking' || value.kind === 'checking' || value.kind === 'decision' || value.kind === 'emotional-settle'
    ? value.kind
    : undefined
  const summary = typeof value.summary === 'string' ? clip(value.summary, 360).trim() : ''
  const notBefore = toDate(value.notBefore)
  if (!kind || !summary || !notBefore || notBefore.getTime() - now.getTime() < 5 * Time.minute || notBefore.getTime() - now.getTime() > 12 * Time.hour) return undefined
  const sourceEntryIds = Array.isArray(value.sourceEntryIds)
    ? value.sourceEntryIds.filter(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0).slice(0, 4)
    : []
  const expiresAt = toDate(value.expiresAt)
  return {
    kind, summary, notBefore: notBefore.toISOString(),
    ...(expiresAt && expiresAt > notBefore ? { expiresAt: expiresAt.toISOString() } : {}),
    ...(sourceEntryIds.length ? { sourceEntryIds } : {}),
  }
}


export function inferredFollowUpCommitment(content: string, now: Date): FollowUpCommitmentDraft {
  return {
    kind: 'thinking', summary: clip(`The character promised to return after thinking: ${content}`, 360),
    notBefore: new Date(now.getTime() + 20 * Time.minute).toISOString(),
  }
}


export function interactionPromisesFollowUp(content: unknown) {
  if (typeof content !== 'string') return false
  return /我(?:先)?想想|我去(?:想想|看看|查查|确认)|晚点(?:回|说|告诉)|之后(?:回|说|告诉)|等我.{0,12}(?:回|说|告诉)|整理.{0,12}(?:回|说|告诉)/.test(content)
}


export function normalizeFollowUpResolutions(value: unknown): FollowUpResolutionDraft[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item)
      && typeof item.id === 'number' && Number.isInteger(item.id) && item.id > 0
      && (item.outcome === 'fulfilled' || item.outcome === 'rescheduled' || item.outcome === 'cancelled'))
    .map(item => ({
      id: item.id as number,
      outcome: item.outcome as FollowUpResolutionDraft['outcome'],
      ...(typeof item.notBefore === 'string' ? { notBefore: item.notBefore } : {}),
    }))
    .slice(0, 2)
}


export function automaticDeliveryFromPayload(value: unknown): OutgoingMessageDraft['automaticDelivery'] | undefined {
  const record = isRecord(value) && isRecord(value.automaticDelivery) ? value.automaticDelivery : undefined
  const summary = normalizeAutomaticDeliverySummary(record?.summary)
  const sourceEntryId = typeof record?.sourceEntryId === 'number' && Number.isSafeInteger(record.sourceEntryId)
    ? record.sourceEntryId
    : undefined
  return summary ? { summary, ...(sourceEntryId ? { sourceEntryId } : {}) } : undefined
}


export function mergeDeliverySummary(left: string, right: string) {
  if (!left || left === right || left.includes(right)) return left || right
  if (right.includes(left)) return right
  return clip(`${left}；${right}`, 240)
}

/** Scene compaction may update a tiny roster only with explicit observed
 * evidence. This keeps named supporting cast available without treating them
 * as automatically present. */

/** Scene compaction may update a tiny roster only with explicit observed
 * evidence. This keeps named supporting cast available without treating them
 * as automatically present. */
export function normalizeScenePresenceDrafts(value: unknown, entries: ScriptEntry[], now = new Date()): ScenePresenceState[] {
  if (!Array.isArray(value)) return []
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const next: ScenePresenceState[] = []
  for (const item of value as ScenePresenceDraft[]) {
    if (!isRecord(item)) continue
    const name = typeof item.name === 'string' ? clip(item.name, 80).trim() : ''
    const status = item.status === 'present' || item.status === 'off-scene' || item.status === 'expected'
      ? item.status
      : undefined
    const basis = typeof item.basis === 'string' ? clip(item.basis, 300).trim() : ''
    const sourceEntryIds = Array.isArray(item.sourceEntryIds)
      ? item.sourceEntryIds.filter(id => typeof id === 'number' && byId.has(id)).slice(0, 8)
      : []
    const evidence = sourceEntryIds.map(id => byId.get(id)!).filter(entry => entry.content.includes(name))
    if (!name || !status || !basis || !evidence.length || !hasExplicitPresenceEvidence(status, evidence)) continue
    next.push({ name, status, basis, sourceEntryIds, updatedAt: now.toISOString() })
  }
  return normalizeScenePresenceState(next)
}


function hasExplicitPresenceEvidence(status: ScenePresenceState['status'], entries: ScriptEntry[]) {
  const text = entries.map(entry => entry.content).join('\n')
  if (status === 'off-scene') return /告别|道别|分别|先走|离开|离去|回家|回去了|独自|分开|告辞/.test(text)
  if (status === 'expected') return /约好|约在|等会|稍后|会来|准备来|约见/.test(text)
  return /一起|同行|身边|来到|抵达|进入|走进|拉着|坐在|站在|陪着/.test(text)
}

/** 归一化文本(去空白/标点)后判断群发内容是否与私聊回复重叠：
 * 完全包含或 Jaccard > 0.55 视为"回声"（模型把私聊回复照搬到群聊）。
 * 只对群目标做（私聊→私聊的 cross-action 不涉及隐私泄漏）。 */

/** 归一化文本(去空白/标点)后判断群发内容是否与私聊回复重叠：
 * 完全包含或 Jaccard > 0.55 视为"回声"（模型把私聊回复照搬到群聊）。
 * 只对群目标做（私聊→私聊的 cross-action 不涉及隐私泄漏）。 */
function isGroupEchoOfPrivateReply(actionContent: string, replyContent: string | undefined): boolean {
  if (!replyContent?.trim() || !actionContent.trim()) return false
  const normalize = (s: string) => s.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()
  const a = normalize(actionContent), b = normalize(replyContent)
  if (!a || !b) return false
  // 最短长度守卫：短回复("嗯")归一化后 1-2 字,包含判定会误杀正常群发。
  const MIN_ECHO = 6
  if (a === b) return true
  if (b.length >= MIN_ECHO && a.includes(b)) return true
  if (a.length >= MIN_ECHO && b.includes(a)) return true
  const grams = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set }
  const ga = grams(a), gb = grams(b)
  if (!ga.size || !gb.size) return false
  let shared = 0
  for (const g of ga) if (gb.has(g)) shared++
  return shared / (ga.size + gb.size - shared) > 0.55
}


export function normalizeDecision(raw: NarrativeDecision, from: Date, now: Date, permitMessages: boolean, runtime: RuntimeConfig, shared: SharedStoryConfig, currentParticipantId: string, permittedParticipantIds: Set<string>, permittedGroupIds: Set<string>, phase: NarrativeRequest['phase'] = 'advance', memory?: MemoryConfig, refreshContinuity = false) {
  // P3.1：communicationActions 的 say 绑定锚定模型原始 script（含 <say> 标签）。
  // reconcileTransportReferences 会剥除标签得到 prose，先留原始形态供新格式
  // 解析引用，否则每个条目都会因找不到 say 绑定被拒。
  const authoredScript = normalizeScriptField(raw?.script)
  raw = reconcileTransportReferences(raw, false, runtime.messageSeparator)
  // script 形态归一兜底(rc50 issue 报告):decide() 返回链已先行归一,此处
  // 覆盖恢复路径等旁路输入(对象形态直接取散文,不再判空)。
  const script = normalizeScriptField(raw?.script).trim().slice(0, runtime.maxScriptCharacters)
  // The only channel for a private reply is interaction. Automatic life
  // passes have no live participant event, so they cannot emit it at all.
  const interaction = phase === 'advance' ? undefined : normalizeInteraction(raw?.interaction, now, runtime)
  // Optional memories are model suggestions, not a source of truth.  Never
  // let a model turn an invented online contact into durable retrieval data.
  const memories = Array.isArray(raw?.memories)
    ? raw.memories.filter(validMemory).map(memory => ({ ...memory, participantId: permittedOrGlobal(memory.participantId, currentParticipantId, permittedParticipantIds) }))
    : []
  const intents = Array.isArray(raw?.intents) ? raw.intents
    .filter(intent => !isRecord(intent) || intent.type !== 'follow-up-commitment')
    .filter(intent => validIntent(intent, from, now, memory))
    .map(intent => ({ ...intent, participantId: permittedOrGlobal(intent.participantId, currentParticipantId, permittedParticipantIds) }))
    .slice(0, 8)
    : []
  const intentUpdates = normalizeIntentUpdates(raw?.intentUpdates)
  const browserIntents = Array.isArray(raw?.browserIntents)
    ? raw.browserIntents.map(normalizeBrowserIntentDraftLoose).filter((intent): intent is BrowserIntentDraft => !!intent).slice(0, 1)
    : []
  // P3：解析层退出意愿门（设计 §10.1）——合法作者动作完整保留，执行许可
  // 由宿主统一策略决定。丢弃留痕只覆盖回声闸与时效越界等结构性原因。
  const droppedProactiveActions: NonNullable<NarrativeDecision['droppedProactiveActions']> = []
  const crossConversationActions = permitMessages && shared.allowCrossConversationMessages && Array.isArray(raw?.crossConversationActions)
    ? raw.crossConversationActions
      .map(action => {
        const normalized = normalizeConversationAction(action, runtime, permittedParticipantIds, permittedGroupIds, currentParticipantId, now)
        if (!normalized) {
          const dropped = droppedProactiveActionInfo(action, runtime, permittedParticipantIds, currentParticipantId)
          if (dropped) droppedProactiveActions.push(dropped)
          return undefined
        }
        // 隐私回声闸：群目标的 cross-action 内容与 interaction.reply 重叠时丢弃
        // （模型把私聊回复逐字照搬到群聊——issue #3 的直接根因）。
        if (normalized.participantId.startsWith('group:')
          && interaction?.reply?.content
          && isGroupEchoOfPrivateReply(normalized.content, interaction.reply.content)) {
          droppedProactiveActions.push({ participantId: normalized.participantId, mode: 'immediate' as const, content: normalized.content, reason: 'group-echo-of-private-reply' })
          return undefined
        }
        return normalized
      })
      .filter((action): action is NonNullable<ReturnType<typeof normalizeConversationAction>> => !!action)
      .slice(0, Math.max(0, shared.maxCrossConversationActions))
    : []
  // P3：新契约 communicationActions 经 P1 适配器归一——timing=now 并入内部
  // cross-action 形态（下游 commit/投递零改动），timing=future 成为人物计划
  // 意图（contact-plan，到期进入正常写作）。旧格式输出继续兼容。
  const communicationPlanIntents: IntentDraft[] = []
  // 旧 proactiveContact 的 recheck-later 仍是兼容输入。它描述的是人物
  // 形成的未来计划，必须进入同一 contact-plan 意图簿，才能在到期回合
  // 走统一作者动作契约；send-now/let-go 仍由旧动作字段或沉默语义处理。
  const legacyContactPlan = contactPlanFromDraft(raw.proactiveContact, phase)
  if (permitMessages && shared.allowCrossConversationMessages && legacyContactPlan && permittedParticipantIds.has(legacyContactPlan.target.id)) {
    communicationPlanIntents.push({
      type: 'contact-plan',
      summary: clip(legacyContactPlan.sourceQuote, 200) || '人物联系计划',
      notBefore: legacyContactPlan.earliestAt ?? new Date(now.getTime() + 30 * Time.minute).toISOString(),
      participantId: legacyContactPlan.target.id,
      payload: { plan: {
        target: legacyContactPlan.target,
        sourceQuote: legacyContactPlan.sourceQuote,
        originPhase: legacyContactPlan.originPhase,
        ...(legacyContactPlan.expiresAt ? { expiresAt: legacyContactPlan.expiresAt } : {}),
      } },
    })
  }
  let communicationActionRejections: string[] | undefined
  if (permitMessages && shared.allowCrossConversationMessages && Array.isArray(raw?.communicationActions)) {
    const unified = parseCommunicationActions(raw.communicationActions, authoredScript || script, {
      phase,
      permittedParticipantIds,
      permittedGroupIds,
    })
    for (const action of unified.actions) {
      if (crossConversationActions.length >= Math.max(0, shared.maxCrossConversationActions)) break
      if (action.timing === 'future') {
        const plan = contactPlanFromAction(action)
        if (plan?.earliestAt) communicationPlanIntents.push({
          type: 'contact-plan', summary: clip(plan.sourceQuote, 200) || '人物联系计划',
          notBefore: plan.earliestAt, participantId: plan.target.kind === 'participant' ? plan.target.id : undefined,
          payload: { plan: { target: plan.target, sourceQuote: plan.sourceQuote, originPhase: plan.originPhase, ...(plan.expiresAt ? { expiresAt: plan.expiresAt } : {}) } },
        })
        continue
      }
      const content = sanitizeAndClampVisibleContent(action.textQuote, runtime.maxMessageCharacters, runtime.messageSeparator)
      if (!content) continue
      // 与旧格式同一条隐私回声闸（issue #3）：群动作逐字复述本回合私聊回复时丢弃。
      if (action.target.kind === 'group' && interaction?.reply?.content && isGroupEchoOfPrivateReply(content, interaction.reply.content)) {
        droppedProactiveActions.push({ participantId: `group:${action.target.id}`, mode: 'immediate' as const, content, reason: 'group-echo-of-private-reply' })
        continue
      }
      // Legacy guards ported to the unified contract: a group target never
      // schedules delayed sends, and fixed-delay dueAt must stay inside the
      // configured delayed window (past or unbounded times both reject).
      if (action.timing === 'fixed-delay') {
        if (action.target.kind === 'group') {
          communicationActionRejections ??= []
          communicationActionRejections.push(`${action.localId}:group-target-rejects-delayed`)
          continue
        }
        const dueAt = action.dueAt ? new Date(action.dueAt) : undefined
        const delay = dueAt?.getTime() - now.getTime()
        if (!dueAt || Number.isNaN(dueAt.getTime())
          || delay < runtime.minimumDelayedReplySeconds * Time.second
          || delay > runtime.maximumDelayedReplyMinutes * Time.minute) {
          communicationActionRejections ??= []
          communicationActionRejections.push(`${action.localId}:due-at-out-of-range`)
          continue
        }
      }
      crossConversationActions.push({
        participantId: action.target.kind === 'group' ? `group:${action.target.id}` : action.target.id,
        // fixed-delay is a definite delayed delivery. Keeping its timing here
        // preserves the distinction from future contact-plan intent, which is
        // re-evaluated by a later writing turn.
        mode: action.timing === 'fixed-delay' ? 'delayed' : 'immediate',
        content,
        ...(action.target.endpointId ? { endpointId: action.target.endpointId } : {}),
        ...(action.timing === 'fixed-delay' && action.dueAt ? { sendAt: action.dueAt } : {}),
      })
    }
    if (unified.rejected.length) communicationActionRejections = unified.rejected.map(item => `${item.id ?? '(no id)'}:${item.reason}`)
  }
  const statePatch = isRecord(raw?.statePatch) ? pickParticipantStatePatch(raw.statePatch) : undefined
  const continuity = refreshContinuity ? normalizeContinuitySnapshot(raw?.continuity) : undefined
  const alter = normalizeAlterValue(raw?.alter)
  const automaticDeliverySummary = isAutomaticNarrativePhase(phase)
    ? normalizeAutomaticDeliverySummary(raw?.automaticDeliverySummary) || undefined
    : undefined
  const followUpCommitment = phase === 'user-message' ? normalizeFollowUpCommitment(raw?.followUpCommitment, now) : undefined
  const followUpResolutions = phase === 'user-message' || phase === 'intent-due'
    ? normalizeFollowUpResolutions(raw?.followUpResolutions)
    : []
  const agencyWindow = isRecord(raw?.agencyWindow) ? raw.agencyWindow : undefined
  const proactiveContact = isRecord(raw?.proactiveContact) ? raw.proactiveContact : undefined
  return { script, authoredActions: raw.authoredActions, lifeHandoff: normalizeLifeHandoff(raw.lifeHandoff, script), alter, agencyWindow, proactiveContact, interaction, automaticDeliverySummary, followUpCommitment, followUpResolutions, continuity, memories,
    intents: [...intents, ...communicationPlanIntents], intentUpdates, browserIntents, statePatch, crossConversationActions,
    ...(droppedProactiveActions.length ? { droppedProactiveActions } : {}),
    ...(communicationActionRejections?.length ? { communicationActionRejections } : {}) }
}


function normalizeBrowserIntentDraftLoose(value: unknown): BrowserIntentDraft | undefined {
  if (!isRecord(value) || (value.mode !== 'search' && value.mode !== 'visit') || typeof value.purpose !== 'string') return undefined
  const query = typeof value.query === 'string' ? clip(value.query, 500) : ''
  const url = typeof value.url === 'string' ? clip(value.url, 2_000) : ''
  if (value.mode === 'search' && !query) return undefined
  if (value.mode === 'visit' && !url) return undefined
  return {
    mode: value.mode,
    ...(query ? { query } : {}), ...(url ? { url } : {}),
    purpose: clip(value.purpose, 500),
    timing: value.timing === 'immediate' ? 'immediate' : 'deferred',
    ...(typeof value.participantId === 'string' ? { participantId: value.participantId.trim() } : {}),
  }
}


export function normalizeBrowserIntentDraft(draft: BrowserIntentDraft, config: BrowserConfig): BrowserIntentDraft | undefined {
  const normalized = normalizeBrowserIntentDraftLoose(draft)
  if (!normalized) return undefined
  if (normalized.mode === 'search' && !config.allowSearch) return undefined
  if (normalized.mode === 'visit' && !config.allowVisit) return undefined
  return normalized
}


export function browserIntentFromPayload(payload: Record<string, unknown>): BrowserIntentDraft | null {
  return normalizeBrowserIntentDraftLoose({
    mode: payload?.mode,
    query: payload?.query,
    url: payload?.url,
    purpose: payload?.purpose || 'The character planned to read a public web page.',
    timing: 'deferred',
  }) ?? null
}


export function resolveBrowserTarget(draft: BrowserIntentDraft, config: BrowserConfig) {
  if (draft.mode === 'search') {
    const template = config.searchUrlTemplate?.trim()
    if (!template || !template.includes('{query}')) return undefined
    const target = template.replaceAll('{query}', encodeURIComponent(draft.query ?? ''))
    return isSafePublicWebUrl(target, config) ? target : undefined
  }
  return draft.url && isSafePublicWebUrl(draft.url, config) ? draft.url : undefined
}


export function isSafePublicWebUrl(value: string, config: BrowserConfig) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    if (url.username || url.password) return false
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host === '::1') return false
    if (isPrivateHost(host)) return false
    const blocked = normalizeDomains(config.blockedDomains)
    const allowed = normalizeDomains(config.allowedDomains)
    if (blocked.some(domain => domainMatches(host, domain))) return false
    return !allowed.length || allowed.some(domain => domainMatches(host, domain))
  } catch {
    return false
  }
}


function normalizeDomains(values: string[] | undefined) {
  return (values ?? []).map(value => String(value ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')).filter(Boolean)
}


function domainMatches(host: string, domain: string) { return host === domain || host.endsWith(`.${domain}`) }


function isPrivateHost(host: string) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168
  }
  // Literal IPv6 and IPv4-mapped addresses are not needed for public-web
  // narration and are safest treated as local/private destinations.
  return host.includes(':')
}


export function webObservationEntryContent(observation: WebObservation) {
  if (observation.status === 'success') {
    const source = observation.title || observation.url || 'a public web page'
    // The full bounded excerpt is supplied through webContext. Keeping it out
    // of the ordinary script stream avoids duplicating tokens and prevents
    // page text from being mistaken for a first-party narrative instruction.
    return `The character read a public web page: ${source}.`
  }
  return `The character's attempted web lookup did not complete: ${clip(observation.summary, 800)}`
}


export function normalizeInteraction(value: unknown, now: Date, runtime: RuntimeConfig): NarrativeInteraction | undefined {
  // DeepSeek V4.1 实测：偶发漏掉 seen 布尔——reply 本身有效时按已读处理，
  // 不得因缺一个信息性字段丢弃整条已发送回复（丢弃会直接变成"回复模式 none"）。
  if (!isRecord(value) || !isRecord(value.reply)) return undefined
  let mode: string | undefined = typeof value.reply.mode === 'string' ? value.reply.mode : undefined
  if (mode !== 'none' && mode !== 'immediate' && mode !== 'delayed') {
    // 弱模型常输出 mode:"text"/"send"/"reply" 或漏掉 mode——只要带了 content 就视为 immediate，
    // 不要丢弃整个剧本（原行为是 return undefined → 触发重写循环）。
    const hasContent = typeof value.reply.content === 'string' && value.reply.content.trim()
    if (hasContent && (mode === undefined || mode === 'text' || mode === 'send' || mode === 'reply' || mode === 'message')) mode = 'immediate'
    else if (mode === undefined && !hasContent) mode = 'none'
    else return undefined
  }
  const separator = runtime.messageSeparator?.trim() || '<sep/>'
  let content = typeof value.reply.content === 'string' ? sanitizeAndClampVisibleContent(value.reply.content, runtime.maxMessageCharacters, separator) : undefined
  // 弱模型常把气泡间隔写成换行而不是分隔符。只把空行（段落边界）视作气泡
  // 边界：单个换行留在一条消息内——否则任何两行草稿都会被机械拆成两条，
  // 把"恰好两段"固化成每回合的定式（实测 24/24 回合精确 2.0 段）。
  if (content && runtime.splitReplyMessages !== false && separator && !content.includes(separator)) {
    content = content.replace(/\s*\r?\n\s*\r?\n+/g, separator)
  }
  const sendAt = toDate(value.reply.sendAt)
  // seen 只描述是否读了新消息；reply 是独立的发送通道。跟进/到期回合协议
  // 规定 seen=false，若在此处因 seen 抹掉回复，“稍后读到再回”的自救路径
  // 会被无声斩断（模型写进了剧本的发送与投递现实分裂）。
  const seen = typeof value.seen === 'boolean' ? value.seen : true
  if (mode === 'none') return { seen, reply: { mode: 'none' } }
  if (!content) return { seen, reply: { mode: 'none' } }
  if (mode === 'immediate') return { seen, reply: { mode: 'immediate', content } }
  const delay = sendAt?.getTime() - now.getTime()
  if (!sendAt || delay < runtime.minimumDelayedReplySeconds * 1_000 || delay > runtime.maximumDelayedReplyMinutes * Time.minute) return { seen, reply: { mode: 'none' } }
  return { seen, reply: { mode: 'delayed', content, sendAt: sendAt.toISOString() } }
}


function validMemory(value: unknown): value is MemoryDraft {
  return isRecord(value) && typeof value.category === 'string' && typeof value.content === 'string' && !!value.content.trim()
}


function validIntent(value: unknown, from: Date, now: Date, memory?: MemoryConfig): value is IntentDraft {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.summary !== 'string') return false
  const notBefore = toDate(value.notBefore)
  if (!notBefore) return false
  if (!isActiveConsequenceDraft(value)) return notBefore > now
  const expiresAt = consequenceExpiresAt(value.payload)
  const payload = value.payload
  const effect = isRecord(payload) && typeof payload.effect === 'string' ? payload.effect.trim() : ''
  const strength = isRecord(payload) ? payload.strength : undefined
  // Consequences are intentionally short-to-medium-lived story pressure,
  // not a backdoor for permanently rewriting canon. Keep the source time
  // close to this writing turn and cap their natural lifetime at 30 days.
  const maximumLifetime = Math.max(1, memory?.activeConsequenceMaxDays ?? 7) * Time.day
  return !!memory?.activeConsequencesEnabled && !!effect
    && (strength === undefined || typeof strength === 'number' && Number.isFinite(strength) && strength >= 0 && strength <= 1)
    && notBefore <= now && notBefore >= from
    && !!expiresAt && expiresAt > now && expiresAt.getTime() - now.getTime() <= maximumLifetime
}


type NormalizedIntentUpdate = { id: number; status: 'completed' | 'cancelled'; resolution?: string }


export function normalizeIntentUpdates(value: unknown): NormalizedIntentUpdate[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item) && Number.isInteger(item.id) && Number(item.id) > 0 && (item.status === 'completed' || item.status === 'cancelled'))
    .map(item => ({
      id: Number(item.id), status: item.status as 'completed' | 'cancelled',
      ...(typeof item.resolution === 'string' && item.resolution.trim() ? { resolution: clip(item.resolution, 1_000) } : {}),
    }))
    .slice(0, 8)
}


export function isActiveConsequence(intent: NarrativeIntent) {
  return intent.type === 'active-consequence' && isRecord(intent.payload) && intent.payload.lifecycle === 'active'
}


export function isActiveConsequenceDraft(intent: Pick<IntentDraft, 'type' | 'payload'> | Record<string, unknown>) {
  return intent.type === 'active-consequence' && isRecord(intent.payload) && intent.payload.lifecycle === 'active'
}


export function consequenceExpiresAt(payload: unknown) {
  if (!isRecord(payload)) return undefined
  return toDate(payload.expiresAt)
}


export function consequenceStrength(payload: unknown, fallback = 0.55) {
  return clampNumber(isRecord(payload) ? payload.strength : undefined, fallback, 0, 1)
}


export function hasCompactionEvidence(sourceEntryIds: number[] | undefined, entries: ScriptEntry[]) {
  if (!Array.isArray(sourceEntryIds) || sourceEntryIds.length === 0) return false
  const ids = new Set(entries.map(entry => entry.id))
  return sourceEntryIds.some(id => ids.has(id))
}


function normalizeConversationAction(value: unknown, runtime: RuntimeConfig, permittedParticipantIds: Set<string>, permittedGroupIds: Set<string>, currentParticipantId: string, now = new Date()) {
  if (!isRecord(value) || typeof value.participantId !== 'string' || !value.participantId || value.participantId === currentParticipantId) return undefined
  const groupTarget = value.participantId.startsWith('group:')
  const targetId = groupTarget ? normalizeGroupId(value.participantId.slice('group:'.length)) : value.participantId
  if ((groupTarget ? !permittedGroupIds.has(targetId) : !permittedParticipantIds.has(targetId)) || (value.mode !== 'immediate' && value.mode !== 'delayed')) return undefined
  if (groupTarget && value.mode !== 'immediate') return undefined
  // 主动联系与私聊回复共用同一可见文本合约：括号表情标签等不得漏出到投递。
  const content = typeof value.content === 'string'
    ? sanitizeAndClampVisibleContent(value.content, runtime.maxMessageCharacters, runtime.messageSeparator)
    : ''
  if (!content) return undefined
  const willingness = typeof value.willingness === 'number' && Number.isFinite(value.willingness)
    ? clampNumber(value.willingness, 0, 0, 1)
    : undefined
  // P3：意愿门退役（§10.1）——willingness 仅留档审计，不再在解析层丢弃。
  const reason = typeof value.reason === 'string' ? clip(value.reason, 300) : undefined
  const endpointId = typeof value.endpointId === 'string' && value.endpointId.trim() ? value.endpointId.trim() : undefined
  if (value.mode === 'immediate') return { participantId: groupTarget ? `group:${targetId}` : targetId, mode: value.mode, content, ...(endpointId ? { endpointId } : {}), ...(willingness === undefined ? {} : { willingness }), ...(reason ? { reason } : {}) }
  const sendAt = toDate(value.sendAt)
  const delay = sendAt?.getTime() - now.getTime()
  if (!sendAt || delay < runtime.minimumDelayedReplySeconds * 1_000 || delay > runtime.maximumDelayedReplyMinutes * Time.minute) return undefined
  return { participantId: groupTarget ? `group:${targetId}` : targetId, mode: value.mode, content, sendAt: sendAt.toISOString(), ...(endpointId ? { endpointId } : {}), ...(willingness === undefined ? {} : { willingness }), ...(reason ? { reason } : {}) }
}

/** 解析层被意愿门丢弃的合法主动行动的信息（供 withdrawn 账本补偿记录）。
 * 只捕获"目标在白名单、内容非空、仅因 willingness 缺失/低于阈值或 delayed
 * 时间越界被丢"的行动；目标不合法/内容为空的丢弃与历史行为一致保持静默
 * （没有可记账的收件人，也不该把未过白名单的内容写进历史）。 */

/** 解析层被意愿门丢弃的合法主动行动的信息（供 withdrawn 账本补偿记录）。
 * 只捕获"目标在白名单、内容非空、仅因 willingness 缺失/低于阈值或 delayed
 * 时间越界被丢"的行动；目标不合法/内容为空的丢弃与历史行为一致保持静默
 * （没有可记账的收件人，也不该把未过白名单的内容写进历史）。 */
export function droppedProactiveActionInfo(value: unknown, runtime: RuntimeConfig, permittedParticipantIds: Set<string>, currentParticipantId: string, now = new Date()) {
  if (!isRecord(value) || typeof value.participantId !== 'string' || !value.participantId) return undefined
  if (value.participantId === currentParticipantId || value.participantId.startsWith('group:')) return undefined
  if (!permittedParticipantIds.has(value.participantId)) return undefined
  if (typeof value.content !== 'string' || !value.content.trim()) return undefined
  const content = sanitizeAndClampVisibleContent(value.content, runtime.maxMessageCharacters, runtime.messageSeparator)
  if (!content) return undefined
  // P3：意愿门退役后，解析层留痕只剩结构性原因（delayed 时效越界）。
  if (value.mode === 'delayed') {
    const sendAt = toDate(value.sendAt)
    const delay = sendAt?.getTime() - now.getTime()
    if (!sendAt || delay < runtime.minimumDelayedReplySeconds * 1_000 || delay > runtime.maximumDelayedReplyMinutes * Time.minute) {
      return { participantId: value.participantId, mode: 'delayed' as const, content, reason: 'delayed-send-at-out-of-range' }
    }
  }
  return undefined
}


function permittedOrGlobal(value: unknown, fallback: string, permittedParticipantIds: Set<string>) {
  const candidate = typeof value === 'string' ? value.trim() : ''
  if (candidate && permittedParticipantIds.has(candidate)) return candidate
  return fallback && permittedParticipantIds.has(fallback) ? fallback : ''
}


function pickParticipantStatePatch(value: Record<string, unknown>): Partial<ParticipantState> {
  const patch: Partial<ParticipantState> = {}
  if (Array.isArray(value.openThreads) && value.openThreads.every(item => typeof item === 'string')) patch.openThreads = value.openThreads.map(item => clip(item, 500)).slice(0, 50)
  if (Array.isArray(value.relationshipNotes) && value.relationshipNotes.every(item => typeof item === 'string')) patch.relationshipNotes = value.relationshipNotes.map(item => clip(item, 500)).slice(0, 50)
  return patch
}


export function mergeSetting(base: StorySetting, patch: Partial<StorySetting>): StorySetting {
  return { ...base, ...patch, character: { ...base.character, ...patch.character }, user: { ...base.user, ...patch.user } }
}


export function mergeParticipantState(base: ParticipantState, patch: Partial<ParticipantState>): ParticipantState {
  return {
    ...base, ...patch,
    openThreads: Array.isArray(patch.openThreads) ? patch.openThreads : base.openThreads,
    relationshipNotes: Array.isArray(patch.relationshipNotes) ? patch.relationshipNotes : base.relationshipNotes,
  }
}


export function normalizeParticipantState(value: unknown): ParticipantState {
  const record = isRecord(value) ? value : {}
  return {
    openThreads: Array.isArray(record.openThreads) ? record.openThreads.filter(item => typeof item === 'string').map(item => clip(item, 500)).slice(0, 50) : [],
    relationshipNotes: Array.isArray(record.relationshipNotes) ? record.relationshipNotes.filter(item => typeof item === 'string').map(item => clip(item, 500)).slice(0, 50) : [],
    relationshipOverlay: typeof record.relationshipOverlay === 'string' ? clip(record.relationshipOverlay, 4_000) : undefined,
    unreadMessageCount: Math.max(0, Math.floor(typeof record.unreadMessageCount === 'number' ? record.unreadMessageCount : 0)),
    pendingReplyCount: Math.max(0, Math.floor(typeof record.pendingReplyCount === 'number' ? record.pendingReplyCount : 0)),
    lastUserMessageAt: typeof record.lastUserMessageAt === 'string' ? record.lastUserMessageAt : undefined,
    lastCharacterMessageAt: typeof record.lastCharacterMessageAt === 'string' ? record.lastCharacterMessageAt : undefined,
  }
}


export function participantRelevance(participant: InterludeParticipant) {
  const state = normalizeParticipantState(participant.state)
  const pending = state.pendingReplyCount * 2 + state.unreadMessageCount
  const last = toDate(state.lastUserMessageAt)?.getTime() ?? participant.updatedAt.getTime()
  return pending * 1_000_000_000 + last
}

/** Keeps a single due-turn private to one relationship while ensuring that
 * every plan that was already due at the start of the sweep gets a chance to
 * be judged before the next sweep interval. */

/** Keeps a single due-turn private to one relationship while ensuring that
 * every plan that was already due at the start of the sweep gets a chance to
 * be judged before the next sweep interval. */
export function groupDueIntents(intents: NarrativeIntent[]) {
  const batches = new Map<string, NarrativeIntent[]>()
  for (const intent of [...intents].sort((left, right) => left.notBefore.getTime() - right.notBefore.getTime() || left.id - right.id)) {
    const family = intent.type === 'proactive-check' ? 'agency' : 'normal'
    const key = `${intent.participantId || '__global__'}|${family}`
    const batch = batches.get(key) ?? []
    batch.push(intent)
    batches.set(key, batch)
  }
  return [...batches.values()]
}


export function resolveParticipantId(explicit: string | undefined, sourceEntryIds: number[] | undefined, entries: ScriptEntry[]) {
  if (explicit?.trim()) return explicit.trim()
  const ids = (sourceEntryIds ?? []).map(id => entries.find(entry => entry.id === id)?.participantId).filter(Boolean)
  return ids[0] ?? ''
}


export function runStorySerialized<T>(service: any, storyId: string, task: () => Promise<T>) {
  // A few embedders/tests invoke delivery methods on a minimal host object
  // rather than a full InterludeService instance. Preserve that legacy shape
  // while keeping real service calls re-entrant-safe.
  if (typeof service.inSerial !== 'function' || typeof service.serial !== 'function') return task()
  return service.inSerial(storyId) ? task() : service.serial(storyId, task)
}


export function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }


export function shouldSupersedeNarrativeRequest(
  inFlightRequestId: number | undefined,
  firstMessageCommittedRequestId: number | undefined,
  obsoleteRequestIds: ReadonlySet<number>,
) {
  return shouldSupersedeRequest(inFlightRequestId, firstMessageCommittedRequestId, obsoleteRequestIds)
}


export function toDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}


const DATABASE_DATE_FIELDS: Record<string, string[]> = {
  interlude_story: ['cursorAt', 'createdAt', 'updatedAt'],
  interlude_participant: ['createdAt', 'updatedAt'],
  interlude_script_entry: ['occurredAt', 'createdAt'],
  interlude_memory: ['createdAt', 'updatedAt'],
  interlude_intent: ['notBefore', 'createdAt', 'updatedAt'],
  interlude_scene: ['startedAt', 'endedAt', 'createdAt', 'updatedAt'],
  interlude_arc: ['createdAt', 'updatedAt'],
  interlude_fact: ['lastSeenAt', 'createdAt', 'updatedAt'],
  interlude_state_patch: ['createdAt', 'appliedAt'],
  interlude_overlay_snapshot: ['periodStart', 'periodEnd', 'createdAt', 'updatedAt'],
  interlude_sticker: ['createdAt', 'updatedAt'],
  interlude_web_observation: ['accessedAt', 'createdAt'],
  interlude_seeded_event: ['occursAt', 'expiresAt', 'createdAt', 'updatedAt'],
  interlude_schedule_preplan: ['createdAt', 'updatedAt'],
  interlude_long_arc_guidance: ['createdAt', 'updatedAt', 'completedAt', 'expiresAt'],
  interlude_long_arc_progress: ['updatedAt'],
}

/** Minato normally materializes timestamp columns as Date objects. Some
 * drivers and hot-reload paths can return ISO strings, so normalize every row
 * crossing the service boundary before time arithmetic or prompt building. */

/** Minato normally materializes timestamp columns as Date objects. Some
 * drivers and hot-reload paths can return ISO strings, so normalize every row
 * crossing the service boundary before time arithmetic or prompt building. */
export function normalizeDatabaseRow(table: string, value: unknown): any {
  if (!isRecord(value)) return value
  const row: Record<string, unknown> = { ...value }
  for (const field of DATABASE_DATE_FIELDS[table] ?? []) {
    if (row[field] === null || row[field] === undefined) continue
    row[field] = toDate(row[field])
  }
  if (table === 'interlude_story') {
    const createdAt = toDate(row.createdAt) ?? new Date()
    const updatedAt = toDate(row.updatedAt) ?? createdAt
    row.createdAt = createdAt
    row.updatedAt = updatedAt
    row.cursorAt = toDate(row.cursorAt) ?? updatedAt
    row.state = decodeStoryState(row.state)
  } else if (table === 'interlude_participant') {
    row.createdAt = toDate(row.createdAt) ?? new Date()
    row.updatedAt = toDate(row.updatedAt) ?? row.createdAt
    row.state = normalizeParticipantState(row.state)
  }
  return row
}


export function sameTimestamp(left: unknown, right: unknown) {
  const a = toDate(left)
  const b = toDate(right)
  return !!a && !!b && Math.abs(a.getTime() - b.getTime()) < 2_000
}

/** A corrupted/future cursor must never make the narrator "fill in" time
 * backwards. Clamp only the prompt interval; normal successful persistence
 * still advances the stored cursor to the actual wall-clock time. */

/** A corrupted/future cursor must never make the narrator "fill in" time
 * backwards. Clamp only the prompt interval; normal successful persistence
 * still advances the stored cursor to the actual wall-clock time. */
const NARRATIVE_CATCHUP_MAX_GAP_MS = 30 * 60_000


export function narrativeCursor(story: InterludeStory, now: Date) {
  const cursor = toDate(story.cursorAt) ?? now
  if (cursor > now) return now
  // 补写活锁防护:游标落后超过 30 分钟时,不从过远的旧时间开始全量补写
  // (7 小时停摆后单次窗口跨 7h → 输出过长/超时/被丢弃 → 游标不动 → 死循环);
  // 跳到 30 分钟前,期间的生活作为"已经过去"处理,模型可自然提及
  if (now.getTime() - cursor.getTime() > NARRATIVE_CATCHUP_MAX_GAP_MS) {
    return new Date(now.getTime() - NARRATIVE_CATCHUP_MAX_GAP_MS)
  }
  return cursor
}


export function clip(value: unknown, length: number) { return typeof value === 'string' ? value.trim().slice(0, length) : '' }


export function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(min, Math.min(max, value))
}


export function normalizeFact(value: string) { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ') }

/**
 * Facts are narrated from their content, not from hidden participant metadata.
 * Keep this guard deliberately conservative: it only rejects relationship
 * facts whose subject is plainly absent or expressed only as a vague pronoun.
 * The narrator prompt remains responsible for producing a concrete named fact.
 */

/**
 * Facts are narrated from their content, not from hidden participant metadata.
 * Keep this guard deliberately conservative: it only rejects relationship
 * facts whose subject is plainly absent or expressed only as a vague pronoun.
 * The narrator prompt remains responsible for producing a concrete named fact.
 */
export function factContentLooksAmbiguous(scope: NarrativeFact['scope'], content: string) {
  if (scope !== 'relationship') return false
  const text = content.trim()
  if (!text) return true
  return /^(?:关系|他|她|他们|她们|对方|那个人|这个人|双方|彼此)(?:说|表示|答应|承诺|想|要|已经|最近|变得|变得更|开始|继续|不再|无法|没有|和|与|对)/u.test(text)
    || /(?:^|[，。；、\s])(?:他说|她说|他们说|她们说|对方说|他答应|她答应|对方答应|他承诺|她承诺|对方承诺)(?:[，。；、\s]|$)/u.test(text)
}


export function limitEntriesByCharacters(entries: ScriptEntry[], limit: number) {
  if (limit <= 0) return []
  let used = 0
  const selected: ScriptEntry[] = []
  // 从最新条目向前保留，保证压缩请求优先看到场景接续点。
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (selected.length && used + entry.content.length > limit) break
    selected.unshift(entry)
    used += entry.content.length
  }
  return selected
}


export function factScore(fact: NarrativeFact, config: MemoryConfig, queryEmbedding: number[] = [], query = '') {
  // lastSeenAt 可能为 null（rc2/rc3 补充事实或旧数据未写入）——回退到 updatedAt/createdAt，
  // 不能让检索排序因空时间崩溃。
  const lastSeen = fact.lastSeenAt ?? fact.updatedAt ?? fact.createdAt ?? new Date()
  const ageDays = Math.max(0, (Date.now() - lastSeen.getTime()) / (24 * Time.hour))
  const recency = Math.exp(-ageDays / 30)
  const similarity = cosineSimilarity(queryEmbedding, fact.embedding ?? [])
  // Negative similarity is treated as no semantic support. This prevents an
  // unrelated fact from receiving a half-score merely because cosine values
  // mathematically range from -1 to 1.
  const semantic = similarity == null ? 0 : Math.max(0, similarity)
  const lexical = historyLexicalScore(query, fact.content)
  return fact.importance * config.factImportanceWeight
    + fact.confidence * config.factConfidenceWeight
    + recency * config.factRecencyWeight
    + semantic * config.semanticWeight
    + lexical * Math.max(1, config.semanticWeight)
    + (fact.scope === 'promise' && fact.unresolved ? 1 : 0) * config.unresolvedWeight
}

/** 事实池的语义可用性统计（向量可观测性）：候选数、已存向量数、与查询
 * 向量正相关（会被语义加分）的事实数、最高余弦相似度。纯函数供 facts()
 * 组装 diagnostic 日志与测试直接断言。 */
export function semanticFactStats(facts: NarrativeFact[], queryEmbedding: number[]) {
  let withVector = 0
  let hits = 0
  let topSimilarity: number | null = null
  for (const fact of facts) {
    if (!fact.embedding?.length) continue
    withVector++
    const similarity = cosineSimilarity(queryEmbedding, fact.embedding)
    if (similarity == null) continue
    if (similarity > 0) hits++
    if (topSimilarity == null || similarity > topSimilarity) topSimilarity = similarity
  }
  return { candidates: facts.length, withVector, hits, topSimilarity }
}


/** Literal recall lane shared by raw script and durable facts. Chinese
 * bigrams preserve useful names and objects without requiring word splitting. */

/** Literal recall lane shared by raw script and durable facts. Chinese
 * bigrams preserve useful names and objects without requiring word splitting. */
export function historyLexicalScore(query: string, content: string) {
  const queryKeys = lexicalRecallKeys(query)
  if (!queryKeys.length) return 0
  const contentKeys = new Set(lexicalRecallKeys(content))
  const overlap = queryKeys.filter(key => contentKeys.has(key)).length
  const normalizedQuery = query.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
  const normalizedContent = content.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
  const phrase = normalizedQuery.length >= 3 && normalizedContent.includes(normalizedQuery) ? 0.5 : 0
  return Math.min(1, overlap / queryKeys.length + phrase)
}


function lexicalRecallKeys(text: string) {
  const normalized = text.toLocaleLowerCase()
  const words = normalized.match(/[a-z0-9]{3,}/gu) ?? []
  const chineseRuns = normalized.match(/[\u3400-\u9fff]{2,}/gu) ?? []
  const bigrams = chineseRuns.flatMap(run => Array.from(
    { length: Math.max(0, run.length - 1) },
    (_, index) => run.slice(index, index + 2),
  ))
  return Array.from(new Set([...words, ...bigrams])).slice(0, 80)
}


export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return undefined
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] * left[index]
    rightMagnitude += right[index] * right[index]
  }
  if (!leftMagnitude || !rightMagnitude) return undefined
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

/** How many sticker descriptions a semantically filtered turn injects. */

/** How many sticker descriptions a semantically filtered turn injects. */
export const SEMANTIC_STICKER_LIMIT = 12

/** Pure ranking used by the semantic sticker filter. Assets without a vector
 * still fill remaining slots after the embedded ones so a half-indexed library
 * degrades gracefully instead of hiding entries. */

/** Pure ranking used by the semantic sticker filter. Assets without a vector
 * still fill remaining slots after the embedded ones so a half-indexed library
 * degrades gracefully instead of hiding entries. */
export function rankStickerCatalog<T extends { embedding?: number[] }>(assets: T[], queryEmbedding: number[], limit: number): T[] {
  if (!queryEmbedding.length || assets.length <= limit) return assets
  return assets
    .map(asset => ({ asset, score: cosineSimilarity(queryEmbedding, asset.embedding ?? []) ?? -1 }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit))
    .map(item => item.asset)
}

/** Only static raster images worth the re-render enter Puppeteer downscaling:
 * tiny images would not shrink further and animated ones have their own path. */

/** Only static raster images worth the re-render enter Puppeteer downscaling:
 * tiny images would not shrink further and animated ones have their own path. */
export function shouldDownscaleImage(mimeType: string, dataUri: string): boolean {
  if (!/^image\/(?:jpeg|png|webp)$/i.test(mimeType)) return false
  const binaryLength = Math.floor((dataUri.split(',')[1] ?? '').length * 3 / 4)
  return binaryLength >= 150 * 1024
}


export function createFactQuery(participant: InterludeParticipant | null, userMessage: string | undefined, dueIntents: NarrativeIntent[], supersededIntents: NarrativeIntent[]) {
  const state = participant ? normalizeParticipantState(participant.state) : undefined
  return [
    userMessage ? `Current user message: ${userMessage}` : '',
    ...(state?.openThreads ?? []).map(thread => `Open thread: ${thread}`),
    ...(state?.relationshipNotes ?? []).map(note => `Relationship note: ${note}`),
    ...dueIntents.map(intent => `Due intent: ${intent.summary}`),
    ...supersededIntents.map(intent => `Superseded plan: ${intent.summary}`),
  ].filter(Boolean).join('\n')
}


export function formatBufferedUserMessages(messages: BufferedUserMessage[]) {
  if (messages.length === 1) return messages[0].content
  return messages.map((message, index) => {
    const time = message.occurredAt.toISOString()
    return `[连续消息 ${index + 1}，收到时间 ${time}]\n${message.content}`
  }).join('\n\n')
}


export function automaticIntervalMinutes(story: InterludeStory, now: Date, config: AutoAdvanceConfig) {
  const restWindow = activeRestWindow(config.restWindows, story.setting.timezone, now)
  if (restWindow) return randomInteger(restWindow.minIntervalMinutes, restWindow.maxIntervalMinutes)
  return Math.max(1, config.intervalMinutes + randomInteger(-config.jitterMinutes, config.jitterMinutes))
}


export function normalizeFollowUpMinutes(values: number[] | undefined) {
  const defaults = [10, 20]
  const normalized = (Array.isArray(values) ? values : defaults)
    .map(value => Math.floor(Number(value)))
    .filter(value => Number.isFinite(value) && value >= 1 && value <= 240)
  return Array.from(new Set(normalized)).sort((left, right) => left - right).slice(0, 6)
}


export function scheduleConversationFollowUps(anchor: Date, config: AutoAdvanceConfig) {
  let previous = anchor.getTime()
  return config.followUpMinutes.map(minutes => {
    const jitter = config.followUpJitterMinutes
      ? randomInteger(-config.followUpJitterMinutes, config.followUpJitterMinutes)
      : 0
    // Never place a later configured pass before an earlier one, even when
    // jitter is enabled or the owner provides a close custom sequence.
    const at = Math.max(previous + 1_000, anchor.getTime() + Math.max(1, minutes + jitter) * Time.minute)
    previous = at
    return new Date(at)
  })
}


export function activeRestWindow(windows: RestWindow[], timezone: string, now: Date) {
  const localMinutes = localClockMinutes(now, timezone)
  return windows.find(window => {
    if (!window.enabled) return false
    const start = clockMinutes(window.start)
    const end = clockMinutes(window.end)
    if (start == null || end == null) return false
    return start <= end
      ? localMinutes >= start && localMinutes < end
      : localMinutes >= start || localMinutes < end
  })
}


function clockMinutes(value: string) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(value?.trim())
  if (!matched) return undefined
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : undefined
}

/** A narrow last-resort guard for live messages. It intentionally avoids
 * interpreting ordinary prose: only short windows containing an explicit
 * future clock or multiple completed lesson stages are rejected. Automatic
 * advances and legitimate long catch-up windows remain untouched. */

/** 模型调用与投递存在分钟级延迟，加上分钟取整：超出 now 这个宽限内的
 * 时钟引用视为"就是现在"，不因网络抖动丢弃整段剧本。 */

/** 模型调用与投递存在分钟级延迟，加上分钟取整：超出 now 这个宽限内的
 * 时钟引用视为"就是现在"，不因网络抖动丢弃整段剧本。 */
const TIME_OVERFLOW_GRACE_MINUTES = 5
/** 12 小时制的歧义视野：now=00:01 时提到"11:58"几乎总是指刚过去的
 * 23:58（午夜前 3 分钟），而不是 11 小时 57 分钟后的未来。朴素前向距离
 * 超过该视野的时钟引用一律按"刚过去的 12 小时制写法"处理，不再判未来。 */

/** 12 小时制的歧义视野：now=00:01 时提到"11:58"几乎总是指刚过去的
 * 23:58（午夜前 3 分钟），而不是 11 小时 57 分钟后的未来。朴素前向距离
 * 超过该视野的时钟引用一律按"刚过去的 12 小时制写法"处理，不再判未来。 */
const TIME_FORWARD_HORIZON_MINUTES = 6 * 60

/** 剧本开头的"叙事宣告位"：中文叙事在场景起始处声明时间。只检查这一小段，
 * 中后段的钟点绝大多数是对约定/回忆/计划的引用，不应作为越界证据。 */

/** 剧本开头的"叙事宣告位"：中文叙事在场景起始处声明时间。只检查这一小段，
 * 中后段的钟点绝大多数是对约定/回忆/计划的引用，不应作为越界证据。 */
const LIVE_SCRIPT_HEADLINE_CHARS = 30
/** 计划/约定语义：钟点作为未来安排被引用时（"八点赶到""九点前"），不构成越界。 */

/** 计划/约定语义：钟点作为未来安排被引用时（"八点赶到""九点前"），不构成越界。 */
const PLAN_SEMANTICS = /赶到|约定|答应|要在|得在|之前|以前|打算|计划|准备|约好|说好|出发|来不及|赶不上|预计|大概|左右|还没|尚未/


const CONTEXT_WINDOW = 8

/** 钟点前后各 8 字的上下文窗口：计划/约定词常出现在钟点紧邻处（「八点【前】赶到」）。 */

/** 钟点前后各 8 字的上下文窗口：计划/约定词常出现在钟点紧邻处（「八点【前】赶到」）。 */
function contextAround(text: string, index: number, length: number) {
  return text.slice(Math.max(0, index - CONTEXT_WINDOW), Math.min(text.length, index + length + CONTEXT_WINDOW))
}


function clocksIn(text: string): Array<{ hour: number, minute: number, around: string }> {
  const found: Array<{ hour: number, minute: number, around: string }> = []
  for (const match of text.matchAll(/(?:^|[^\d])(?:(\d{1,2})[:：](\d{2})|(\d{1,2})点(?:(\d{1,2})分?)?)/g)) {
    const hour = Number(match[1] ?? match[3])
    const minute = Number(match[2] ?? match[4] ?? 0)
    if (hour > 23 || minute > 59) continue
    found.push({ hour, minute, around: contextAround(text, match.index!, match[0].length) })
  }
  for (const match of text.matchAll(/([零一二三四五六七八九十两]+)点(?:(?:零|([一二三四五六七八九十两]+))分?|(半))?/g)) {
    const hour = chineseClockNumber(match[1])
    const minute = match[2] ? chineseClockNumber(match[2]) : 0
    if (hour == null || minute == null || hour > 23 || minute > 59) continue
    found.push({ hour, minute, around: contextAround(text, match.index!, match[0].length) })
  }
  return found
}


export function detectLiveScriptTimeOverflow(script: unknown, phase: NarrativeRequest['phase'], from: Date, now: Date, timezone: string, endorsedClocks?: ReadonlySet<number>) {
  const text = String(script ?? '').trim()
  const elapsedMinutes = Math.max(0, (now.getTime() - from.getTime()) / Time.minute)
  if (phase !== 'user-message' || !text || elapsedMinutes > 60) return undefined
  const endpoint = storyLocalTimeContext(now, timezone)
  const nowMinutes = endpoint.hour * 60 + Number(endpoint.time.slice(3, 5))
  const overflow = (value: number) =>
    value > nowMinutes + TIME_OVERFLOW_GRACE_MINUTES && value - nowMinutes <= TIME_FORWARD_HORIZON_MINUTES
  // 用户给出了未来期限（"九点前赶到"）时，其之间的叙事推进被授权：落在
  // (now, maxEndorsed] 区间的钟点一并豁免；endorsed 为空时行为不变。
  const endorsedDeadline = endorsedClocks && endorsedClocks.size ? Math.max(...endorsedClocks) : undefined
  // 只把剧本开头（叙事宣告位）里、且没有计划语义的钟点视为"把叙事时间写过头"。
  for (const clock of clocksIn(text.slice(0, LIVE_SCRIPT_HEADLINE_CHARS))) {
    const value = clock.hour * 60 + clock.minute
    if (endorsedClocks && endorsedClocks.has(value)) continue
    if (endorsedDeadline !== undefined && value > nowMinutes && value <= endorsedDeadline) continue
    if (PLAN_SEMANTICS.test(clock.around)) continue
    if (overflow(value)) return `explicit clock ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')} exceeds ${endpoint.time.slice(0, 5)}`
  }
  // 全文（含开头）的课程阶段推进不变：多个已完成的课程节 = 时间被写飞。
  const lessonStages = new Set(Array.from(text.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*节/g), match => match[1]))
  if (lessonStages.size >= 2) return `multiple lesson stages (${[...lessonStages].join('→')}) inside a ${Math.round(elapsedMinutes)} minute live window`
  return undefined
}


export function chineseClockNumber(value: string) {
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (value === '十') return 10
  if (value.includes('十')) {
    const [left, right] = value.split('十')
    const tens = left ? digits[left] : 1
    const ones = right ? digits[right] : 0
    return tens == null || ones == null ? undefined : tens * 10 + ones
  }
  return value.length === 1 ? digits[value] : undefined
}


function randomInteger(min: number, max: number) {
  const lower = Math.floor(Math.min(min, max))
  const upper = Math.floor(Math.max(min, max))
  return lower + Math.floor(Math.random() * (upper - lower + 1))
}


export function mergeNote(existing: string | undefined, next: string) {
  const value = clip(next, 2_000)
  if (!value) return existing
  if (!existing) return value
  if (normalizeFact(existing).includes(normalizeFact(value))) return existing
  return `${existing}\n${value}`.slice(-6_000)
}


export function patchClaimsMatch(left: string, right: string) {
  const a = normalizeFact(left).replace(/[，。！？、,.!?；;:：]/g, '')
  const b = normalizeFact(right).replace(/[，。！？、,.!?；;:：]/g, '')
  if (!a || !b) return false
  if (a === b) return true
  // Allow small wording variations, while avoiding very short claims that
  // could incorrectly merge contradictory changes.
  return Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))
}


export function statePatchEvidence(entries: ScriptEntry[], timezone: string) {
  const narrative = entries.filter(entry => entry.kind === 'script' || entry.actor === 'narrator')
  // Use the narrative timestamp as the turn key. Duplicate rows created at
  // the same instant must not count as independent evidence.
  const turns = developmentTurns(narrative)
  const days = new Set(narrative.map(entry => calendarDayKey(entry.occurredAt, timezone))).size
  return { turns, days, scenes: developmentScenes(narrative) }
}


function startOfUtcWindow(value: Date, windowDays: number) {
  const size = Math.max(1, Math.floor(windowDays))
  const epochDay = Math.floor(value.getTime() / Time.day)
  return new Date(Math.floor(epochDay / size) * size * Time.day)
}


export function groupOverlayPatches(patches: StatePatchProposal[], windowDays = 5) {
  const groups = new Map<string, { participantId: string; target: StatePatchProposal['target']; from: Date; to: Date; patches: StatePatchProposal[] }>()
  for (const patch of patches) {
    const from = startOfUtcWindow(patch.appliedAt ?? patch.createdAt, windowDays)
    const key = `${patch.participantId}|${patch.target}|${from.toISOString()}`
    const group = groups.get(key) ?? { participantId: patch.participantId, target: patch.target, from, to: new Date(from.getTime() + windowDays * Time.day), patches: [] }
    group.patches.push(patch)
    groups.set(key, group)
  }
  return [...groups.values()]
}


export function groupOverlaySnapshots(snapshots: OverlaySnapshot[], windowDays = 10) {
  const groups = new Map<string, { participantId: string; target: OverlaySnapshot['target']; from: Date; to: Date; snapshots: OverlaySnapshot[] }>()
  for (const snapshot of snapshots) {
    const from = startOfUtcWindow(snapshot.periodEnd, windowDays)
    const key = `${snapshot.participantId}|${snapshot.target}|${from.toISOString()}`
    const group = groups.get(key) ?? { participantId: snapshot.participantId, target: snapshot.target, from, to: new Date(from.getTime() + windowDays * Time.day), snapshots: [] }
    group.snapshots.push(snapshot)
    groups.set(key, group)
  }
  return [...groups.values()]
}


export function normalizeMajorEvents(value: unknown, patches: StatePatchProposal[], snapshots: OverlaySnapshot[] = []) {
  const modelEvents = Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => clip(item, 600)) : []
  const retained = [
    ...snapshots.flatMap(snapshot => snapshot.majorEvents ?? []),
    ...patches.filter(patch => patch.impact === 'major').map(patch => clip(patch.proposedValue || patch.evidence, 600)),
  ]
  return Array.from(new Set([...retained, ...modelEvents].filter(Boolean))).slice(-20)
}

