/** 统一动作契约与适配（PROACTIVE_ACTION_UNIFICATION_DESIGN §4，P1 冻结）。
 * 旧格式（crossConversationAction / interaction.reply / proactiveContact 草稿 /
 * say 合成）与新格式（communicationActions + <say> 绑定）归一为
 * UnifiedContactAction。P1 阶段旧权限链继续负责实际执行：本模块只做归一、
 * 原文绑定与来源标签推导，不持有计时器、人物评分或独立存储；模型自报的
 * userInitiated 等布尔值仅进 legacy 留档，无法放宽任何许可。 */
import type { NarrativePhase, NarrativeInteraction, ProactiveContactDraft } from '../types';
export type UnifiedActionTiming = 'now' | 'future' | 'fixed-delay';
export type UnifiedActionSourceLabel = 'reply' | 'continuation' | 'initiation';
export type UnifiedActionOrigin = 'cross-conversation-action' | 'interaction-reply' | 'proactive-contact-draft' | 'say-synthesis' | 'communication-actions';
export interface UnifiedActionTarget {
    kind: 'participant' | 'group';
    id: string;
    endpointId?: string;
}
export interface UnifiedContactAction {
    /** 模型局部 ID（如 'a1'）或宿主合成 ID；持久身份 P2 起由 commit/event 提供。 */
    localId: string;
    target: UnifiedActionTarget;
    timing: UnifiedActionTiming;
    /** 动作绑定的原文摘录；同一文字被多个动作引用时以 localId + 目标分辨。 */
    textQuote: string;
    /** 宿主按相位/入站归属推导的审计标签（设计 §4.2），不承载权限。 */
    sourceLabel: UnifiedActionSourceLabel;
    originPhase: NarrativePhase;
    adaptedFrom: UnifiedActionOrigin;
    /** fixed-delay：既定发送时刻；future：最早处理时间。 */
    dueAt?: string;
    /** future 计划的截止时间。 */
    expiresAt?: string;
    /** 适配来源中的旧数值（willingness/userInitiated 等）仅留档供审计。 */
    legacy?: Record<string, unknown>;
}
/** 人物未来联系计划的 P1 冻结契约（§4.3）：到期进入正常写作，不是确定发送。 */
export interface ContactPlanSeed {
    target: UnifiedActionTarget;
    sourceQuote: string;
    originPhase: NarrativePhase;
    earliestAt?: string;
    expiresAt?: string;
}
export interface CommunicationActionInput {
    id: string;
    target: {
        kind: 'participant' | 'group';
        id: string;
        endpointId?: string;
    };
    timing?: 'now' | 'future' | 'fixed-delay';
    dueAt?: string;
    expiresAt?: string;
    sendAt?: string;
}
export interface CommunicationActionsParseResult {
    actions: UnifiedContactAction[];
    rejected: Array<{
        id?: string;
        reason: string;
    }>;
}
interface AdaptContext {
    phase: NarrativePhase;
    /** 当前真实入站的参与者（有则本回合对 TA 的回应为 reply）。 */
    inboundParticipantId?: string;
    permittedParticipantIds: ReadonlySet<string>;
    permittedGroupIds: ReadonlySet<string>;
}
/** 按宿主来源推导标签：真实入站的当前回应为 reply；有实际对话/承诺来源的
 * 延续为 continuation；其余出站行动为 initiation。当前入站不能替其他目标
 * 授予回应身份（§11.1）。 */
export declare function deriveSourceLabel(phase: NarrativePhase, targetId: string, inboundParticipantId?: string): UnifiedActionSourceLabel;
/** 新格式：communicationActions[] + 原文 <say id> 绑定（§4.1）。内容只写在
 * 原文一次，动作以局部 ID 引用；绑定失败、目标不在白名单或文字为空的条目
 * 进 rejected 并给出原因，不静默丢弃。 */
export declare function parseCommunicationActions(raw: unknown, prose: string, context: AdaptContext): CommunicationActionsParseResult;
/** 旧格式适配（§4.1 适配模块职责）：输入为 normalizeDecision 已归一的
 * crossConversationActions / interaction.reply / proactiveContact 草稿与
 * 宿主 say 合成结果，输出统一内部动作。 */
export declare function adaptLegacyContactActions(input: {
    phase: NarrativePhase;
    crossConversationActions?: Array<Record<string, any>>;
    interaction?: NarrativeInteraction;
    proactiveContact?: ProactiveContactDraft;
    saySynthesis?: {
        participantId: string;
        content: string;
    };
    inboundParticipantId?: string;
    permittedParticipantIds: ReadonlySet<string>;
    permittedGroupIds: ReadonlySet<string>;
}): UnifiedContactAction[];
/** proactiveContact 草稿 → 人物未来计划种子（§4.3）：recheck-later 是"稍后
 * 想再处理"的计划；send-now 的实际内容由伴随动作承载；let-go 不形成计划。 */
export declare function contactPlanFromDraft(draft: ProactiveContactDraft | undefined, phase: NarrativePhase): ContactPlanSeed | undefined;
/** timing='future' 的统一动作转为计划种子（新格式路径）。 */
export declare function contactPlanFromAction(action: UnifiedContactAction): ContactPlanSeed | undefined;
export {};
