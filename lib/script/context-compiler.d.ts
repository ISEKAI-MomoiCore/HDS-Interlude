import type { DialogueBurstState, SceneFrame } from '../types';
export interface CompiledNarrativeContext {
    storyIdentity: Record<string, unknown>;
    relevantEstablishedEpisodes: Record<string, unknown>;
    currentSceneEvidence: Record<string, unknown>;
    ongoingThreads: Record<string, unknown>;
    availableNearFuture: Record<string, unknown>;
    /** 考据案头：author-facing 写作参考（researchDesk），与[世界事件]语义隔离。 */
    writingReference: Record<string, unknown>;
    incomingEvent: Record<string, unknown>;
    authoringWindow: Record<string, unknown>;
}
/**
 * M4 bridge: compile beta10's proven fields into a positive continuation
 * scaffold. Each prepared value is moved into one semantic group and is never
 * recomputed or duplicated in the model-facing payload.
 */
export declare function compileNarrativeContext(payload: Record<string, any>, frame: SceneFrame | undefined, _burst: DialogueBurstState | undefined): CompiledNarrativeContext;
export declare function compiledContextConflicts(payload: Record<string, any>, compiled: CompiledNarrativeContext): string[];
/**
 * M4 §十：确定性通道标注五规则——命中即标，格式为结构化 channel 上下文 +
 * 简短标记（[微信·私]）。投递不依赖标注，漏标后果限质感层面。
 *
 * 规则（V3 §十原文）：
 * 1. 回合内端点切换（turn.sources.length > 1）
 * 2. 同批消息多端点（currentEvent 含多端点来源）
 * 3. 私聊↔群聊切换（上一条目与当前 different conversationKind）
 * 4. 同一参与者不同端点连续出现
 * 5. 回复目标 ≠ 来源端点（transport 目标端点不同于最后入站端点）
 */
export interface ChannelAnnotation {
    /** 简短标记：[QQ·私] / [微信·私] / [QQ·群] 等 */
    tag: string;
    /** 触发的规则列表（供诊断/测试） */
    rules: string[];
    /** 当前回合涉及的端点（来自 turn.sources） */
    sources: Array<{
        endpointId: string;
        channelKind: string;
        receivedSeq: number;
    }>;
}
export declare function projectChannelContext(payload: Record<string, any>): ChannelAnnotation | undefined;
