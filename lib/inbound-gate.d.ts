/** 入站门控管线：私聊与群聊两条入口——门序（canHandle → findStory/autoCreate）、
 * 内容提取与投影、桥接重放去重（内存键 + 队列内二次查库双防线）、密度计数
 * （在去重之后，重放不双计）、mention-only 证据路径（未提及图片落库不入队）、
 * 端点入站解析（队列外）与状态刷新、节奏同步提升、打断标记置位（兜底清理
 * 在 finally）、串行块内落库、入队缓冲（经宿主委托）。群消息的自动推进暂停
 * 不在此执行——移至 flushGroupTurnUnlocked 门通过后（density-decay 死锁修复）。
 *
 * 平台假设（QQ/OneBot 特有，多通道适配的分歧点——完整清单见
 * docs/PLATFORM_ASSUMPTIONS_INBOUND.md）：去重键含 platform:selfId:messageId(+channelId)、
 * 群号归一化（group:/guild: 前缀）、mention 判定、OneBot 平台族判定、
 * 合并转发读取、SILK 语音假设。
 *
 * P8-S5 自 service.ts 迁出（2026-10-29）。红线：serial 块内容
 * 逐字搬运（锁相位不变）；seenIncomingMessages/inboundSeq/interruptedTypingParticipants/
 * contextDensity 容器留守 service 经宿主引用读写；缓冲冲刷（bufferGroupMessage/
 * flushGroupTurn/bufferUserNarrative）留守叙事核心，入口经宿主委托入队。 */
import type { Session } from 'koishi';
/** P8-S5 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function receiveGroup(svc: any, session: Session, receivedAt?: Date): Promise<boolean>;
/** P8-S5 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function receive(svc: any, session: Session, receivedAt?: Date): Promise<boolean>;
/** P8-S5 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function groupSenderName(svc: any, groupId: string, userId: string, session: Session): Promise<any>;
/** P8-S5 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function lookupGroupMemberName(svc: any, cacheKey: string, groupId: string, userId: string, selfId: string): Promise<string>;
