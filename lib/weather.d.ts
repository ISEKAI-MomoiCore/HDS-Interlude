/**
 * 运行时天气服务：Open-Meteo 免费拉取 → 中文快照 → world-event 剧本条目注入。
 *
 * 设计原则（与提案 #IKL4DY 对齐,经审查调整后）:
 * - 注入格式为纯数据("环境：22°C 小毛毛雨。"),不含建议句/观测点地名,不引导叙事
 * - 复用 interlude_seeded_event + world-event 管道(非 admin-note),零新增剧本类型
 * - 滚动替换:每次注入前把上一条天气事件标 expired,时间线上只保留最新一条
 * - 地点解析:优先从 story.setting.location 自动地理编码,失败回退手动经纬度
 * - 架空世界跳过:手动开关 AND 世界描述含架空关键词(异世界/精灵/架空/幻想/另一个世界)
 */
import type { Context } from 'koishi';
export interface WeatherConfig {
    enabled: boolean;
    /** 手动观测点(经纬度);autoFromLocation 开启时仅作回退 */
    latitude: number;
    longitude: number;
    /** 从 story.setting.location 自动解析观测点(地理编码),失败回退经纬度 */
    autoFromLocation: boolean;
    /** 手动开关:架空世界(异世界/精灵/架空)跳过天气注入 */
    skipFantasyWorld: boolean;
    cadenceMinutes: number;
}
export declare const DEFAULT_WEATHER_CONFIG: WeatherConfig;
export declare function resolveWeatherConfig(value: unknown): WeatherConfig;
export interface WeatherSnapshot {
    temperature: number;
    feelsLike: number;
    humidity: number;
    windSpeed: number;
    condition: string;
    fetchedAt: number;
    /** 注入文本:"环境：22°C 小毛毛雨。" */
    text: string;
}
export declare function fetchWeatherSnapshot(ctx: Context, config: WeatherConfig, locationHint?: string): Promise<WeatherSnapshot | undefined>;
/** 架空世界判定(手动开关语义下与 weatherSweep 共用的唯一权威拷贝)：
 * 命中即跳过实况天气注入;播种器据此反过来保留天气播种(那些世界里模型
 * 即兴是唯一的天气来源)。 */
export declare function isFantasyStory(world: unknown, location: unknown): boolean;
/** 获取最近一次成功快照(不触发拉取)——供播种器 payload 协同用 */
export declare function lastWeatherSnapshot(): WeatherSnapshot | undefined;
