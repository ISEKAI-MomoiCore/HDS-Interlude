import { NarrativePhase } from './types';
export type InterludeLogLevel = 'error' | 'warn' | 'info' | 'debug';
export type InterludeLogColorTheme = 'dark' | 'light';
export type InterludeLogAction = 'receive' | 'send' | 'processing' | 'complete' | 'trigger' | 'emotion' | 'memory' | 'advance' | 'agency' | 'group' | 'error' | 'retry' | 'warning' | 'waiting' | 'system';
export interface LayeredLogInput {
    level: InterludeLogLevel;
    phase?: NarrativePhase;
    protagonist?: string;
    message: string;
    args?: unknown[];
    colors?: boolean;
    colorTheme?: InterludeLogColorTheme;
    kaomoji?: boolean;
    standalone?: boolean;
    /** P4（§13.1）：显式动作分类优先于中文正则识别。 */
    action?: InterludeLogAction;
    /** P4（§13.1）：新链通信事件的结构化载荷；字段随文本一起渲染，
     * 旧消息继续走正则分类，两者兼容。 */
    communication?: CommunicationEventLog;
}
/** P4（§13.1 设计草图）：统一动作链路的结构化事件信封。具体字段按事件
 * 类型可选；文本渲染与 Console/桌面展示共用同一对象。 */
export interface CommunicationEventLog {
    type: 'action-authored' | 'action-policy' | 'delivery-result' | 'contact-plan-updated' | 'migration-summary';
    storyId: string;
    commitId?: string;
    eventId?: string;
    segmentIndex?: number;
    intentId?: number;
    traceId?: string;
    processingId?: string;
    targetId?: string;
    endpointId?: string;
    domain: 'authoring' | 'policy' | 'transport' | 'integrity' | 'migration';
    reasonCode: string;
    status: string;
    policyRevision?: string;
    elapsedMs?: number;
}
export declare function renderLogMessage(message: string, args?: unknown[]): string;
export declare function detectLogAction(message: string, level: InterludeLogLevel): InterludeLogAction;
export declare function formatLayeredLog(input: LayeredLogInput): string;
export declare function phaseLabel(phase?: NarrativePhase): string;
