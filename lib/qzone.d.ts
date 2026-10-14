/**
 * QQ 空间（说说）通道层 — SnowLuma OneBot 扩展动作（qzone 系列）的封装与治理。
 *
 * 边界：本模块只做通道——动作调用、限流门（风控保护）、能力探测与防御性
 * 归一化。"何时发/发什么/对哪条好友动态反应"的决策属于叙事层（service）。
 * 纯策略函数模式（与 group-willingness.ts 同构）：状态由调用方持有（审计表
 * interlude_qzone_post），本模块无副作用、可独立测试。
 */
export type QzoneActionKind = 'post' | 'comment' | 'like';
/** interlude_qzone_post 审计行（入库与限流门共用）。 */
export interface QzonePostRecord {
    id?: number;
    storyId: string;
    /** 动作类型：post=发说说 comment=评论 like=点赞；feed-seen=动态已入账（只读标记，不计入限流）。 */
    kind: QzoneActionKind | 'feed-seen';
    /** 目标说说 tid（post 为新发帖返回值；comment/like 为目标帖）。 */
    tid: string;
    /** 目标说说归属 QQ 号（省略/空=机器人自己空间）。 */
    targetUin?: string;
    content?: string;
    /** 发帖查看权限（1 所有人/4 好友/16 部分好友/64 仅自己/128 排除名单）。 */
    ugcRight?: number;
    /** 执行账号的角色端点（多 QQ 端点下限流/审计/归因隔离的键）。 */
    endpointId?: string;
    /** 上次观测到的评论数（被评论感知基线；undefined=尚未建立基线）。 */
    commentNum?: number;
    status: 'pending' | 'confirmed' | 'failed' | 'unknown';
    error?: string;
    createdAt: Date;
    postedAt?: Date;
}
/**
 * 限流门的端点过滤：只计本端点的动作行；无 endpointId 的历史行（回填前）
 * 保守计入所有端点的配额——风控安全优先于配额精确。
 */
export declare function qzoneRecordsForEndpoint(records: ReadonlyArray<QzonePostRecord>, endpointId?: string): QzonePostRecord[];
export interface QzoneConfig {
    enabled: boolean;
    /** 每日发帖上限（SnowLuma 明示高频会被 Qzone 风控，默认保守）。 */
    dailyPostCap: number;
    /** 每日评论上限。 */
    dailyCommentCap: number;
    /** 每日点赞上限。 */
    dailyLikeCap: number;
    /** 任意两次空间动作之间的最小间隔（分钟），跨 kind 共享。 */
    minIntervalMinutes: number;
    /** 好友动态轮询只消费该时间窗内的新鲜内容（分钟）。 */
    feedWindowMinutes: number;
}
export declare const DEFAULT_QZONE_CONFIG: QzoneConfig;
export declare function resolveQzoneConfig(config?: Partial<QzoneConfig>): QzoneConfig;
export type QzoneGateReason = 'ok' | 'disabled' | 'daily-cap' | 'min-interval';
export interface QzoneGateDecision {
    allowed: boolean;
    reason: QzoneGateReason;
    /** 今日该 kind 已成功动作数（含 pending，防在途并发超限）。 */
    usedToday: number;
    cap: number;
}
/**
 * 空间动作限流门。records 传近期审计行（建议 48h 窗口）；只有真正的动作
 * （post/comment/like）参与计数与间隔——feed-seen 是只读感知标记，不得挤占
 * 动作配额。同一本地日内按 kind 计数（failed 不计；pending/unknown 计入，
 * 在途与结果不明的都按已发生保守对待），且任意两动作间隔不小于
 * minIntervalMinutes。
 */
export declare function evaluateQzoneGate(records: ReadonlyArray<QzonePostRecord>, config: QzoneConfig, input: {
    kind: QzoneActionKind;
    now?: Date;
}): QzoneGateDecision;
export interface QzoneMsgEntry {
    tid: string;
    content: string;
    time: Date;
    commentNum: number;
    isPrivate: boolean;
    images: string[];
}
/** get_qzone_msg_list 条目归一化：坏行丢弃（undefined），字段强转。 */
export declare function normalizeQzoneMsgEntry(raw: unknown): QzoneMsgEntry | undefined;
export interface QzoneFeedEntry {
    uin: string;
    nickname: string;
    time: Date;
    appid: number;
    /** Qzone 定位句柄；like/comment 是否接受 feeds.key 当 tid 是阶段 0 POC 决定性验证项。 */
    key: string;
}
/** get_qzone_feeds 条目归一化（appid 311=说说；正文 html 阶段 1 不解析）。 */
export declare function normalizeQzoneFeedEntry(raw: unknown, now?: Date): QzoneFeedEntry | undefined;
/** 好友动态新鲜度过滤：只保留时间窗内的条目（feeds 深翻页不可靠，只吃首页）。 */
export interface QzoneReactionDelta {
    tid: string;
    contentExcerpt: string;
    previous: number;
    current: number;
}
/** 被评论感知（纯函数）：她的说说评论数增量比对。
 * - 首次观测只立基线不报增量——刚发布的帖子自带几条评论是常态，不是新事件；
 * - 增量 > 0 才产出感知；计数回落（删评）静默下修基线，杜绝幽灵增量；
 * - 帖子不在当前拉取列表（超出深度）时基线保持不动；
 * - 赞数上游（SnowLuma mapMsgList/ RawEmotion）尚未暴露字段，此处只算评论；
 *   上游补 like_num 后在 QzoneMsgEntry 加字段并入本函数即可。
 * 感知零动作配额；产出的条目由下一次推进（自动或对话）自然携带，绝不触发推进。 */
export declare function qzoneReactionDeltas(posts: ReadonlyArray<QzonePostRecord>, entries: ReadonlyArray<QzoneMsgEntry>): {
    deltas: QzoneReactionDelta[];
    baselines: Array<{
        tid: string;
        commentNum: number;
    }>;
};
export declare function freshQzoneFeeds(feeds: ReadonlyArray<QzoneFeedEntry>, config: QzoneConfig, now?: Date): QzoneFeedEntry[];
/** OneBot 动作调用接口（service 侧用 bot.internal._request 接线）。 */
export type QzoneActionCaller = (action: string, params?: Record<string, unknown>) => Promise<unknown>;
export declare class QzoneActionError extends Error {
    readonly action: string;
    readonly retcode?: number;
    readonly ambiguous: boolean;
    constructor(message: string, action: string, retcode?: number, /** true=请求可能已到达服务端（传输异常/超时），结果未知，禁止自动重试。 */ ambiguous?: boolean);
}
/**
 * 调用 SnowLuma qzone 动作并校验回执；失败抛 QzoneActionError（retcode 保留
 * 供风控分类：12xxx 段为 Qzone 风控，service 侧据此熔断当日）。
 */
export declare function callQzoneAction<T = unknown>(call: QzoneActionCaller, action: string, params?: Record<string, unknown>): Promise<T>;
/** 能力探测：只读 get_qzone_msg_list 是否可用（SnowLuma 未连接/未登录 → false）。 */
export declare function probeQzoneAvailable(call: QzoneActionCaller): Promise<boolean>;
/** appid=311 是说说；6600 是广告位、5000 是官方号、202 等为杂项，全部排除。 */
export declare const QZONE_FEED_APPID_TALK = 311;
/** 审计与剧本条目用的可见性中文标签。 */
export declare function qzoneVisibilityLabel(ugcRight: number): "所有人可见" | "好友可见" | "部分好友可见" | "仅自己可见" | "部分好友不可见";
export interface QzoneActionRequest {
    action: QzoneActionKind;
    content?: string;
    tid?: string;
    targetUin?: string;
    /** 展示名（仅用于账本条目文本，如“评论了 XX 的说说”）。 */
    targetName?: string;
    ugcRight?: number;
}
/**
 * 意图 payload → 受限动作请求。非法（类型错/该有的字段缺/超长/tid 字符集
 * 异常）返回 null，执行侧记失败并完成意图——坏 payload 永远不该挡住账本排水。
 */
export declare function qzoneIntentFromPayload(payload: unknown): QzoneActionRequest | null;
/**
 * 好友动态候选：说说类（appid 311）、有效 uin、时间窗内、未在 seen 集合里。
 * 每轮最多保留 2 条——感知是低频背景行为，不让一次轮询刷屏剧本。
 */
export declare function qzoneFeedCandidates(feeds: ReadonlyArray<QzoneFeedEntry>, seenKeys: ReadonlySet<string>, config: QzoneConfig, now?: Date): QzoneFeedEntry[];
/**
 * 用好友自己的说说列表对齐 feed 正文：只认 tid 精确命中——连发多条时按时间
 * 近似配对会错配正文，宁可只记元数据（空串），错的内容比没有内容更糟。
 */
export declare function matchQzoneFeedContent(entries: ReadonlyArray<QzoneMsgEntry>, feed: QzoneFeedEntry): string;
