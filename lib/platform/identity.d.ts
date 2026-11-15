/**
 * D4（解耦设计 §6）：HDSI 中立寻址词汇——群号/账号 ID 归一化。
 *
 * 这些函数属于 HDSI 自身的规范寻址空间（MULTI_CHANNEL_SINGLE_STORY_DESIGN
 * 的 `group:<id>` / 参与者 ID 约定），不是 QQ 专属假设——叙事侧（如
 * crossConversationActions 的目标校验）与平台层共用。自 session-platform
 * 下沉至此，使叙事模块不再依赖 QQ 假设层。
 */
export declare function normalizeGroupId(value: string): string;
export declare function normalizeAccountId(value: unknown): string;
