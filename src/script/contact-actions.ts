/** 统一动作契约与适配（PROACTIVE_ACTION_UNIFICATION_DESIGN §4，P1 冻结）。
 * 旧格式（crossConversationAction / interaction.reply / proactiveContact 草稿 /
 * say 合成）与新格式（communicationActions + <say> 绑定）归一为
 * UnifiedContactAction。P1 阶段旧权限链继续负责实际执行：本模块只做归一、
 * 原文绑定与来源标签推导，不持有计时器、人物评分或独立存储；模型自报的
 * userInitiated 等布尔值仅进 legacy 留档，无法放宽任何许可。 */
import type { NarrativePhase, NarrativeInteraction, ProactiveContactDraft } from '../types'
import { readAuthoredActions } from './authored-actions'

export type UnifiedActionTiming = 'now' | 'future' | 'fixed-delay'
export type UnifiedActionSourceLabel = 'reply' | 'continuation' | 'initiation'
export type UnifiedActionOrigin =
  | 'cross-conversation-action' | 'interaction-reply' | 'proactive-contact-draft'
  | 'say-synthesis' | 'communication-actions'

export interface UnifiedActionTarget {
  kind: 'participant' | 'group'
  id: string
  endpointId?: string
}

export interface UnifiedContactAction {
  /** 模型局部 ID（如 'a1'）或宿主合成 ID；持久身份 P2 起由 commit/event 提供。 */
  localId: string
  target: UnifiedActionTarget
  timing: UnifiedActionTiming
  /** 动作绑定的原文摘录；同一文字被多个动作引用时以 localId + 目标分辨。 */
  textQuote: string
  /** 宿主按相位/入站归属推导的审计标签（设计 §4.2），不承载权限。 */
  sourceLabel: UnifiedActionSourceLabel
  originPhase: NarrativePhase
  adaptedFrom: UnifiedActionOrigin
  /** fixed-delay：既定发送时刻；future：最早处理时间。 */
  dueAt?: string
  /** future 计划的截止时间。 */
  expiresAt?: string
  /** 适配来源中的旧数值（willingness/userInitiated 等）仅留档供审计。 */
  legacy?: Record<string, unknown>
}

/** 人物未来联系计划的 P1 冻结契约（§4.3）：到期进入正常写作，不是确定发送。 */
export interface ContactPlanSeed {
  target: UnifiedActionTarget
  sourceQuote: string
  originPhase: NarrativePhase
  earliestAt?: string
  expiresAt?: string
}

export interface CommunicationActionInput {
  id: string
  target: { kind: 'participant' | 'group'; id: string; endpointId?: string }
  timing?: 'now' | 'future' | 'fixed-delay'
  dueAt?: string
  expiresAt?: string
  sendAt?: string
}

export interface CommunicationActionsParseResult {
  actions: UnifiedContactAction[]
  rejected: Array<{ id?: string; reason: string }>
}

interface AdaptContext {
  phase: NarrativePhase
  /** 当前真实入站的参与者（有则本回合对 TA 的回应为 reply）。 */
  inboundParticipantId?: string
  permittedParticipantIds: ReadonlySet<string>
  permittedGroupIds: ReadonlySet<string>
}

/** 按宿主来源推导标签：真实入站的当前回应为 reply；有实际对话/承诺来源的
 * 延续为 continuation；其余出站行动为 initiation。当前入站不能替其他目标
 * 授予回应身份（§11.1）。 */
export function deriveSourceLabel(phase: NarrativePhase, targetId: string, inboundParticipantId?: string): UnifiedActionSourceLabel {
  if (phase === 'user-message' && targetId === inboundParticipantId) return 'reply'
  if (phase === 'conversation-follow-up' || phase === 'intent-due') return 'continuation'
  return 'initiation'
}

function targetOf(participantId: string, endpointId?: string): UnifiedActionTarget | undefined {
  if (typeof participantId !== 'string' || !participantId.trim()) return undefined
  const groupTarget = participantId.startsWith('group:')
  const id = groupTarget ? participantId.slice('group:'.length).trim() : participantId.trim()
  if (!id) return undefined
  return { kind: groupTarget ? 'group' : 'participant', id, ...(endpointId?.trim() ? { endpointId: endpointId.trim() } : {}) }
}

function permitted(target: UnifiedActionTarget, context: AdaptContext): boolean {
  return target.kind === 'group'
    ? context.permittedGroupIds.has(target.id)
    : context.permittedParticipantIds.has(target.id)
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** 新格式：communicationActions[] + 原文 <say id> 绑定（§4.1）。内容只写在
 * 原文一次，动作以局部 ID 引用；绑定失败、目标不在白名单或文字为空的条目
 * 进 rejected 并给出原因，不静默丢弃。 */
export function parseCommunicationActions(
  raw: unknown,
  prose: string,
  context: AdaptContext,
): CommunicationActionsParseResult {
  const result: CommunicationActionsParseResult = { actions: [], rejected: [] }
  if (!Array.isArray(raw)) return result
  const authored = readAuthoredActions(String(prose ?? ''))
  const byId = new Map(authored.actions.map(action => [action.id, action]))
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const value = item as Partial<CommunicationActionInput> & { userInitiated?: unknown }
    const id = typeof value.id === 'string' ? value.id.trim() : ''
    const say = id ? byId.get(id) : undefined
    if (!id || !say) { result.rejected.push({ id, reason: 'unknown-or-duplicate-say-id' }); continue }
    if (!say.content.trim()) { result.rejected.push({ id, reason: 'empty-say-content' }); continue }
    const target = value.target && (value.target.kind === 'participant' || value.target.kind === 'group')
      && typeof value.target.id === 'string'
      ? { kind: value.target.kind, id: value.target.id.trim(), ...(typeof value.target.endpointId === 'string' && value.target.endpointId.trim() ? { endpointId: value.target.endpointId.trim() } : {}) } as UnifiedActionTarget
      : undefined
    if (!target || !target.id) { result.rejected.push({ id, reason: 'invalid-target' }); continue }
    if (!permitted(target, context)) { result.rejected.push({ id, reason: 'target-not-permitted' }); continue }
    const timing = value.timing === 'future' || value.timing === 'fixed-delay' ? value.timing : 'now'
    const dueAt = isoDate(value.dueAt ?? value.sendAt)
    if (timing !== 'now' && !dueAt) { result.rejected.push({ id, reason: 'missing-due-at' }); continue }
    result.actions.push({
      localId: id,
      target,
      timing,
      textQuote: say.content,
      sourceLabel: deriveSourceLabel(context.phase, target.kind === 'participant' ? target.id : `group:${target.id}`, context.inboundParticipantId),
      originPhase: context.phase,
      adaptedFrom: 'communication-actions',
      ...(timing !== 'now' && dueAt ? { dueAt } : {}),
      ...(isoDate(value.expiresAt) ? { expiresAt: isoDate(value.expiresAt)! } : {}),
      ...(value.userInitiated !== undefined ? { legacy: { userInitiated: value.userInitiated === true } } : {}),
    })
  }
  return result
}

/** 旧格式适配（§4.1 适配模块职责）：输入为 normalizeDecision 已归一的
 * crossConversationActions / interaction.reply / proactiveContact 草稿与
 * 宿主 say 合成结果，输出统一内部动作。 */
export function adaptLegacyContactActions(input: {
  phase: NarrativePhase
  crossConversationActions?: Array<Record<string, any>>
  interaction?: NarrativeInteraction
  proactiveContact?: ProactiveContactDraft
  saySynthesis?: { participantId: string; content: string }
  inboundParticipantId?: string
  permittedParticipantIds: ReadonlySet<string>
  permittedGroupIds: ReadonlySet<string>
}): UnifiedContactAction[] {
  const context: AdaptContext = {
    phase: input.phase,
    ...(input.inboundParticipantId ? { inboundParticipantId: input.inboundParticipantId } : {}),
    permittedParticipantIds: input.permittedParticipantIds,
    permittedGroupIds: input.permittedGroupIds,
  }
  const actions: UnifiedContactAction[] = []
  const reply = input.interaction?.reply
  if (reply?.mode === 'immediate' && typeof reply.content === 'string' && reply.content.trim() && context.inboundParticipantId) {
    actions.push({
      localId: typeof reply.actionId === 'string' && reply.actionId.trim() ? reply.actionId.trim() : `reply:${context.inboundParticipantId}`,
      target: { kind: 'participant', id: context.inboundParticipantId },
      timing: 'now',
      textQuote: reply.content,
      sourceLabel: 'reply',
      originPhase: input.phase,
      adaptedFrom: 'interaction-reply',
    })
  }
  for (const action of Array.isArray(input.crossConversationActions) ? input.crossConversationActions.slice(0, 8) : []) {
    const target = targetOf(String(action?.participantId ?? ''), typeof action?.endpointId === 'string' ? action.endpointId : undefined)
    const content = typeof action?.content === 'string' ? action.content : ''
    if (!target || !content.trim() || !permitted(target, context)) continue
    actions.push({
      localId: typeof action.actionId === 'string' && action.actionId.trim() ? action.actionId.trim() : `cross:${target.kind}:${target.id}:${actions.length}`,
      target,
      timing: action.mode === 'delayed' ? 'fixed-delay' : 'now',
      textQuote: content,
      sourceLabel: deriveSourceLabel(input.phase, String(action.participantId), context.inboundParticipantId),
      originPhase: input.phase,
      adaptedFrom: 'cross-conversation-action',
      ...(action.mode === 'delayed' && isoDate(action.sendAt) ? { dueAt: isoDate(action.sendAt)! } : {}),
      ...(action.willingness !== undefined || action.userInitiated !== undefined
        ? { legacy: { ...(action.willingness !== undefined ? { willingness: action.willingness } : {}), ...(action.userInitiated !== undefined ? { userInitiated: action.userInitiated === true } : {}) } }
        : {}),
    })
  }
  if (input.saySynthesis && input.saySynthesis.content.trim()) {
    const target = targetOf(input.saySynthesis.participantId)
    if (target && permitted(target, context)) {
      actions.push({
        localId: `synth:${target.kind}:${target.id}`,
        target,
        timing: 'now',
        textQuote: input.saySynthesis.content,
        sourceLabel: deriveSourceLabel(input.phase, input.saySynthesis.participantId, context.inboundParticipantId),
        originPhase: input.phase,
        adaptedFrom: 'say-synthesis',
      })
    }
  }
  return actions
}

/** proactiveContact 草稿 → 人物未来计划种子（§4.3）：recheck-later 是"稍后
 * 想再处理"的计划；send-now 的实际内容由伴随动作承载；let-go 不形成计划。 */
export function contactPlanFromDraft(
  draft: ProactiveContactDraft | undefined,
  phase: NarrativePhase,
): ContactPlanSeed | undefined {
  if (!draft || draft.outcome !== 'recheck-later') return undefined
  // 兼容输入的最小结构校验（承接已退役 normalizeProactiveContact 的必要面）：
  // 目标与动机非空；notBefore/expiresAt 提供时必须可解析为时间。
  if (typeof draft.participantId !== 'string' || !draft.participantId.trim()) return undefined
  if (typeof draft.motive !== 'string' || !draft.motive.trim()) return undefined
  if (draft.notBefore !== undefined && Number.isNaN(new Date(draft.notBefore).getTime())) return undefined
  if (draft.expiresAt !== undefined && Number.isNaN(new Date(draft.expiresAt).getTime())) return undefined
  return {
    target: { kind: 'participant', id: draft.participantId },
    sourceQuote: draft.motive,
    originPhase: phase,
    ...(draft.notBefore ? { earliestAt: draft.notBefore } : {}),
    expiresAt: draft.expiresAt,
  }
}

/** timing='future' 的统一动作转为计划种子（新格式路径）。 */
export function contactPlanFromAction(action: UnifiedContactAction): ContactPlanSeed | undefined {
  if (action.timing !== 'future') return undefined
  return {
    target: action.target,
    sourceQuote: action.textQuote,
    originPhase: action.originPhase,
    ...(action.dueAt ? { earliestAt: action.dueAt } : {}),
    ...(action.expiresAt ? { expiresAt: action.expiresAt } : {}),
  }
}
