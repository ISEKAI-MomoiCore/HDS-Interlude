/** P4（设计 §14.2）：通信动作只读视图的服务端投影。
 * 从投递账本（script 条目 metadata.deliveryActions）与既有意图表派生，
 * 不维护独立状态机；列表游标分页，详情按动作 ID 惰性读取。
 * 权威仍在账本与意图本身——这里只做有界投影。 */
import type { Context } from 'koishi';
import type { InterludeService } from '../service';
type ProjectionHost = {
    getCanonicalStory(): Promise<any>;
    dbGet(table: string, query: unknown, options?: unknown): Promise<any[]>;
};
export interface CommunicationActionRow {
    id: string;
    kind: 'action' | 'plan' | 'fixed-delay';
    target: string;
    channel: 'private' | 'group';
    status: string;
    reason?: string;
    updatedAt: string;
    scriptEntryId?: number;
    head: string;
    dueAt?: string;
    expiresAt?: string;
    segmentCount: number;
    deliveredCount: number;
}
export interface CommunicationActionDetail extends CommunicationActionRow {
    segments: Array<{
        index: number;
        kind: string;
        status: string;
        head: string;
        reason?: string;
        attemptedAt?: string;
        completedAt?: string;
    }>;
    quote: string;
}
export interface CommunicationActionsListResult {
    rows: CommunicationActionRow[];
    cursor?: string;
    total: number;
}
export declare function communicationActionsList(host: ProjectionHost, options?: {
    cursor?: string;
    limit?: number;
}): Promise<CommunicationActionsListResult>;
export declare function communicationActionDetail(host: ProjectionHost, id: string): Promise<CommunicationActionDetail | undefined>;
/** RPC 安装：动作列表/详情为只读（authority=1），取消/核实为管理写操作
 * （authority=3，§14.4）。dbGet/dbSet 在服务上是私有方法——以结构化接口
 * 声明投影与写操作所需的面，安装边界单点转型。 */
export interface ActionsHost {
    getCanonicalStory(): Promise<any>;
    dbGet(table: string, query: unknown, options?: unknown): Promise<any[]>;
}
export interface ActionsWriteHost extends ActionsHost {
    dbSet(table: string, query: unknown, patch: unknown): Promise<unknown>;
    updateScriptDeliveryOutcome(storyId: string, reference: Record<string, unknown>, status: string, at: Date, reason?: string): Promise<unknown>;
}
export declare function installActionsRpc(ctx: Context, host: InterludeService): void;
export interface CommunicationActionResult {
    ok: boolean;
    changed: number;
    reason: string;
}
/** P4（§14.4）：取消未来计划或未执行分段。计划/确定延迟取消意图行；
 * 账本动作取消 pending 与 unknown 分段（§7.3 unknown 的人工处置：取消后续）。
 * 幂等：重复取消返回 changed=0。 */
export declare function cancelCommunicationAction(host: ActionsWriteHost, id: string, now?: Date): Promise<CommunicationActionResult>;
/** P4（§14.4）：unknown 分段的人工核实——确认送达或确认未发送（§7.3：
 * 只有确定依据的人工操作可改写 unknown；迟到成功回执的自动优先级不变）。 */
export declare function verifyCommunicationAction(host: ActionsWriteHost, id: string, outcome: 'delivered' | 'not-sent', now?: Date): Promise<CommunicationActionResult>;
export {};
