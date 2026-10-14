/**
 * 世界事件播种器（World Event Seeder）：后台低频生成与主角有关的外部事件，
 * 模型给定发生时间，宿主到点以 world-event 剧本条目注入（[世界事件] 前缀）。
 * 设计文档：docs/WORLD_EVENT_SEEDER_DESIGN.md。
 *
 * 事实权威、反应自由：事件是既成现实；她如何感知与应对是主作者的领地。
 * 注册参与者严格拉黑（他们背后是真实的人）；只允许线下通道与 NPC。
 */
import type { Context } from 'koishi';
import { type ModelConfig, type ProviderConfig, type TokenUsageRecord } from './narrator';
export type SeedImportance = 'low' | 'medium' | 'high';
/** 模型输出经解析与校验后的候选事件（尚未入库）。 */
export interface WorldSeedEventDraft {
    summary: string;
    importance: SeedImportance;
    occursAt: Date;
    expiresAt?: Date;
    subjects: string[];
    rationale: string;
}
export interface WorldSeederRuntime {
    enabled: boolean;
    provider?: ProviderConfig;
    cadenceMinutes: number;
    maxPending: number;
    dailyCap: number;
    maxHorizonHours: number;
    temperature: number;
    maxTokens: number;
    timeout: number;
}
export declare const DEFAULT_WORLD_SEEDER_RUNTIME: WorldSeederRuntime;
/** 提供商不再单独配置：模型中心的连接行勾选“用于世界播种”（useForWorldSeeding）
 * 即为选择；服务侧解析出该连接后传入。未勾选（provider 为空）即视为关闭。 */
export declare function resolveWorldSeederRuntime(value: unknown, provider?: ProviderConfig): WorldSeederRuntime;
/**
 * 世界切面（domain rotation）：切面是任意居住世界都成立的通用方面（非现代地球专属题材），
 * 具体面貌由各剧本自己的 worldSetting 决定。复读的架构根源不是缺闸门，而是"每轮提问完全相同
 * + 生活摘录被自己上一轮的产出锚定"。切面让每轮 sweep 面向世界的一个不同局部
 * 提问——生成侧的多样性来自提问本身，不来自下游过滤。切面按 (storyId, 时间槽)
 * 确定性轮换，无新增持久状态。
 */
export interface WorldSeedDomain {
    key: string;
    label: string;
    brief: string;
}
export declare const WORLD_SEED_DOMAINS: WorldSeedDomain[];
/** 实况天气接管时的 nature 替身:天气/温度/天空状态由宿主通道供给,播种器
 * 只保留季节、光照、声音气味等非天气环境质感。不进 WORLD_SEED_DOMAINS——
 * 轮换周期必须保持六切面,替身只在 weatherHandledByHost 时替换呈现。 */
export declare const NATURE_DOMAIN_NO_WEATHER: WorldSeedDomain;
/** 同一 (storyId, cadence 时间槽) 内切面稳定；跨槽前进一格——相邻两轮必然不同切面。 */
export declare function seedDomainForRun(storyId: string, slotStart: Date, cadenceMinutes: number): WorldSeedDomain;
export declare function worldSeederSystemPrompt(domain?: WorldSeedDomain, weatherHandledByHost?: boolean): string;
export interface SeedValidationInput {
    now: Date;
    timezone: string;
    maxHorizonHours: number;
    blockedNames: string[];
    recentSummaries: string[];
    /** 已排期/已注入事件的 subjects 列表——用于 NPC/道具级去重(bigram 抓不到换皮) */
    recentSubjects?: string[][];
    /** 已排期/已注入事件的 occursAt——时间窗重叠也判重复 */
    recentOccursAt?: Date[];
    /** 实况天气接管时为 true:天气类事件一律弃(宁可错杀——与播种器哲学一致)。 */
    weatherGuard?: boolean;
}
export declare function summaryJaccard(left: string, right: string): number;
export type SeedRejection = 'invalid-shape' | 'empty-summary' | 'invalid-importance' | 'invalid-time' | 'blocked-name' | 'night-high' | 'duplicate' | 'weather-guard';
/** 单事件校验闸；宁可错杀：任何一项不过即弃，不重试。 */
export declare function validateSeedEvent(draft: WorldSeedEventDraft, input: SeedValidationInput): SeedRejection | undefined;
/** 防御解析模型输出：字段裁剪、时间解析、subjects/rationale 归一；坏项丢弃。 */
export declare function parseWorldSeedEvents(value: unknown, limit?: number): WorldSeedEventDraft[];
export interface WorldSeeder {
    available: boolean;
    generate(userPayload: string, opts?: {
        weatherHandledByHost?: boolean;
    }): Promise<unknown>;
}
export declare function createWorldSeeder(ctx: Context, modelConfig: ModelConfig, runtime: WorldSeederRuntime, onUsage?: (record: TokenUsageRecord) => void): WorldSeeder;
