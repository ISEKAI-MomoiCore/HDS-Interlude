/**
 * 考据 Agent 编排（P2）：预算门 → 改写+防火墙 → 程序化检索（零 LLM）→
 * 蒸馏 → 案头。检索与抓取面向工具注册表编程（tools.ts），append-only
 * 任务日志随结果返回（存意图 payload，可审计重放；保留失败记录——
 * Manus 原则）。循环契约对齐前缀缓存：system 合约逐字节固定、上下文
 * append-only、JSON 确定性序列化。典型成本：2 次模型调用 + 1-2 次检索。
 */
import type { ProviderConfig } from '../narrator';
import { ResearchConfig, ResearchDesk } from './desk';
import { SearchHit } from './search';
/** 侧端模型调用的最小形态（OpenAICompatibleNarrator.customSideTask 同构，便于测试注入）。 */
export interface ResearchModelCaller {
    customSideTask<T>(provider: ProviderConfig, task: string, timeout: number, temperature: number, maxTokens: number, system: string, user: string, responseFormat?: 'json-object' | 'prompt-only'): Promise<T>;
}
export interface ResearchHttpClientLike {
    get(url: string, options?: Record<string, unknown>): Promise<unknown>;
    post(url: string, body: unknown, options?: Record<string, unknown>): Promise<unknown>;
}
/** 工具注册表的最小形态（ResearchToolRegistry 同构，便于测试注入）。 */
export interface ResearchToolRegistryLike {
    search(config: ResearchConfig, http: ResearchHttpClientLike, query: string, now?: number, forceFresh?: boolean): Promise<SearchHit[]>;
    fetch(http: ResearchHttpClientLike, url: string, maxCharacters?: number): Promise<{
        title: string;
        text: string;
        url: string;
    } | undefined>;
}
/** append-only 任务日志条目；上限 40 条、单条 200 字，随意图 payload 存档。 */
export interface ResearchLogEntry {
    at: number;
    step: string;
    detail: string;
}
export declare class ResearchTaskLog {
    readonly entries: ResearchLogEntry[];
    private readonly modelCalls;
    append(step: string, detail: unknown, at: number): void;
    noteModelCall(task: string): void;
    summary(): {
        modelCalls: number;
        modelTasks: string;
        logEntries: number;
    };
}
export interface ResearchTaskInput {
    storyId: string;
    topic: string;
    /** 参与者身份词（防火墙禁查清单：userId/昵称等）。 */
    forbiddenTerms: string[];
    originIntentId?: number;
}
export type ResearchTaskOutcome = {
    status: 'completed';
    added: number;
    reused: boolean;
    reason: string;
    log: ResearchLogEntry[];
} | {
    status: 'skipped';
    reason: string;
    log: ResearchLogEntry[];
} | {
    status: 'failed';
    reason: string;
    log: ResearchLogEntry[];
};
export interface ResearchRunnerDeps {
    config: ResearchConfig;
    provider: ProviderConfig;
    model: ResearchModelCaller;
    http: ResearchHttpClientLike;
    registry: ResearchToolRegistryLike;
    desk: ResearchDesk;
    now?: () => number;
    /** Commit only while the originating story task remains current. */
    isCurrent?: () => boolean;
}
export declare function runResearchTask(deps: ResearchRunnerDeps, input: ResearchTaskInput): Promise<ResearchTaskOutcome>;
