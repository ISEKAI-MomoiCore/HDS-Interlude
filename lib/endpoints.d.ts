/**
 * 端点注册表（M1a）——单剧本多通道设计的身份与地址层。
 *
 * 设计规格：docs/MULTI_CHANNEL_SINGLE_STORY_DESIGN.md（v3）第二/三/四节。
 * 纯策略模块（与 group-willingness / qzone 同构）：本文件无 IO、无副作用，
 * 状态由 service 持有（interlude_endpoint 表 + 内存 EndpointState）。
 *
 * 单平台零影响纪律：M1a 只建表、派生端点行、并轨解析与元数据标注——
 * 现有查找/投递/回合路径不动；注册表只有派生单端点时，一切解析结果
 * 必须与旧字段逐字节一致（equivalence 测试锚定）。
 */
export type EndpointChannelKind = 'qq' | 'wechat';
export type EndpointOwnerKind = 'story-role' | 'participant-user' | 'group';
/** 身份与地址分离：主键是持久随机 ID；账号/对端标识是可变字段。 */
export interface EndpointDescriptor {
    id: string;
    ownerKind: EndpointOwnerKind;
    ownerId: string;
    channelKind: EndpointChannelKind;
    platform: string;
    /** 角色账号绑定键（onebot:<selfId>；原生通道自定义）。 */
    accountKey: string;
    selfId: string;
    /** 用户端点专有：对端账号。 */
    userId?: string;
    /** 群端点专有。 */
    channelId?: string;
    groupId?: string;
    conversationKind?: 'private' | 'group';
}
/** interlude_endpoint 持久行：描述符 + 管理配置（enabled 与动态状态分离）。 */
export interface EndpointRow extends EndpointDescriptor {
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}
/**
 * 平台隔离的账号键：onebot 家族折叠到 `onebot:` 前缀（历史行不变），
 * 原生平台（wechat 等）用专属前缀——不同平台同 selfId 不再碰撞。键本身已
 * 编码平台族，解析时的平台校验由键匹配隐式完成（比逐字段比对更严）。
 */
export declare function endpointAccountKey(platform: string, selfId: string): string;
/** 唯一键（非主键）：注册表防重复约束。地址可变，键随之校验，但主键不变。 */
export declare function endpointUniqueKey(row: Pick<EndpointDescriptor, 'ownerKind' | 'ownerId' | 'accountKey' | 'userId' | 'channelId' | 'groupId'>): string;
/** 迁移派生：旧故事的单一角色端点（channelKind 默认 qq——onebots 别名覆盖层随 M2 接入）。 */
export declare function deriveStoryRoleEndpoint(story: {
    id: string;
    platform: string;
    selfId: string;
}, now?: Date): EndpointRow;
/** 迁移派生：旧参与者的单一用户端点。 */
export declare function deriveParticipantUserEndpoint(participant: {
    id: string;
    platform: string;
    selfId: string;
    userId: string;
}, now?: Date): EndpointRow;
/** 迁移派生：群规则的群端点。群端点独立于私聊参与者，群规则是唯一配置来源。 */
export declare function deriveGroupEndpoint(story: {
    id: string;
    platform: string;
    selfId: string;
}, rule: {
    groupId: string;
}, now?: Date): EndpointRow;
/** 防御性归一化：坏行丢弃（undefined）。 */
export declare function normalizeEndpointRow(raw: unknown): EndpointRow | undefined;
export interface InboundSource {
    platform: string;
    selfId: string;
    /** 私聊对端；群消息可缺省。 */
    userId?: string;
    groupId?: string;
    channelId?: string;
}
export interface InboundResolution {
    /** 命中的角色端点（其 ownerId 即 storyId）。 */
    roleEndpoint: EndpointRow;
    /** 命中的用户端点（陌生 userId 时为 undefined——调用方走既有新参与者路径）。 */
    userEndpoint?: EndpointRow;
    /** 群消息时命中的群端点。 */
    groupEndpoint?: EndpointRow;
    /** 同 accountKey 存在多行角色端点（脏数据）——调用方需一次性告警。 */
    duplicateRoleAccountKeys?: string[];
}
/**
 * 入站解析（纯函数）。边界行为（v3 §三表）：
 * accountKey 未注册 → undefined（调用方回落旧路径，绝不自动挂载）；
 * 重复行 → 首行生效（持久层另有唯一约束，此处兜底）；
 * 用户端点未命中 → 仅返回角色端点，userEndpoint 缺省。
 */
export declare function resolveInboundEndpoint(rows: ReadonlyArray<EndpointRow>, source: InboundSource): InboundResolution | undefined;
/** 条目通道上下文（v3 §十）：消除 kind 双义的完整结构。 */
export declare function channelContextMetadata(endpoint: EndpointDescriptor, extra?: {
    userId?: string;
    groupId?: string;
    channelId?: string;
}): {
    groupId?: string;
    userId?: string;
    channelId?: string;
    endpointId: string;
    channelKind: EndpointChannelKind;
    platform: string;
    accountKey: string;
    selfId: string;
    conversationKind: "private" | "group";
};
export interface EndpointState {
    endpointId: string;
    connection: {
        online: boolean;
        observedAt: number;
    };
    deliverable: {
        allowed: boolean;
        checkedAt: number;
        cooldownUntil?: number;
        note?: string;
    };
    initiate?: {
        allowed: boolean;
        observedAt: number;
        expiresAt?: number;
        reason?: string;
    };
}
/** interlude_endpoint_state 持久快照。动态状态写入独立表，避免污染身份注册表。 */
export interface EndpointStateRecord {
    endpointId: string;
    state: EndpointState;
    updatedAt: Date;
}
/** 防御性读取持久快照；坏快照不会阻塞端点注册表启动。 */
export declare function normalizeEndpointState(raw: unknown, endpointId?: string): EndpointState | undefined;
/** Restart recovery keeps diagnostic observations but never restores live connection truth. */
export declare function restoreEndpointState(endpointId: string, snapshot: EndpointState | undefined, now?: number): EndpointState;
/** 进程重启后的保守初值：一切未知按不可用处理，待连接器/首次投递/入站恢复。 */
export declare function freshEndpointState(endpointId: string, now?: number): EndpointState;
export declare function stateAfterConnection(state: EndpointState, online: boolean, now?: number): EndpointState;
export declare function stateAfterInbound(state: EndpointState, now?: number): EndpointState;
export declare function stateAfterOutbound(state: EndpointState, ok: boolean, note: string, cooldownMs?: number, now?: number): EndpointState;
/** deliverable 确认的保质期：超过 TTL 的 allowed 按未知处理。
 *  QQ/OneBot 在线端点允许实际投递探测，避免过期门控阻止出站刷新；
 *  其它通道保持保守。重启快照仍须经过当前连接器的在线事实确认。 */
export declare const ENDPOINT_DELIVERABLE_TTL_MS: number;
/** 返回是否可尝试投递，不代表投递成功；失败冷却与通道主动联系限制独立生效。
 * ignoreCooldown 供用户触发回复豁免冷却（一次网络抖动不该让该参与者已读不回
 * 5 分钟）；冷却的防轰炸语义只针对后台/主动重试路径。 */
export declare function isEndpointDeliverable(state: EndpointState | undefined, now?: number, endpoint?: Pick<EndpointDescriptor, 'channelKind' | 'platform'>, options?: {
    ignoreCooldown?: boolean;
}): boolean;
/** token 过期按不允许保守处理；重新获得有效信号（入站/探测）即恢复。 */
export declare function isEndpointInitiateAllowed(state: EndpointState | undefined, now?: number): boolean;
/** interlude_story_alias 持久行。回滚 = 删除行；行本身即审计（reason + 时间）。 */
export interface StoryAliasRecord {
    aliasStoryId: string;
    canonicalStoryId: string;
    reason: string;
    createdAt: Date;
}
export declare function normalizeStoryAliasRow(raw: unknown): StoryAliasRecord | undefined;
export interface StoryAliasResolution {
    canonicalStoryId?: string;
    /** chain=别名指向的 canonical 又是另一行的别名（双射校验失败，需人工裁决）。 */
    problem?: 'chain';
}
/**
 * 别名解析（纯函数）：命中返回 canonical；链式（canonical 自身也是别名）返回
 * problem='chain'——不跟随多跳，把裁决留给人。悬空（canonical 无对应故事）由
 * 调用方查库后判定（持久层职责）。
 */
export declare function resolveStoryAlias(rows: ReadonlyArray<StoryAliasRecord>, aliasStoryId: string): StoryAliasResolution;
/** M2 §1.4：按 accountKey 查注册表判别通道类型——onebots 别名路线的唯一判别依据。
 * 未注册默认 qq（M2 内全部为 qq；微信接入时注册表行带 wechat 标签即自动切换）。 */
export declare function channelKindForAccount(rows: ReadonlyArray<EndpointRow>, accountKey: string): 'qq' | 'wechat';
