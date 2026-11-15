import type { ResearchHttpClient } from './search';
import type { ProviderConfig } from '../narrator';
/** 代理解析：research 显式配置 > 考据连接继承 > 直连。 */
export declare function proxyAgentResolved(researchProxyAgent: string | undefined, provider: ProviderConfig | undefined): string;
export declare function proxiedGet(http: ResearchHttpClient, proxyAgent: string, url: string, options?: Record<string, unknown>): Promise<unknown>;
export declare function proxiedPost(http: ResearchHttpClient, proxyAgent: string, url: string, body: unknown, options?: Record<string, unknown>): Promise<unknown>;
/** 包装成 ResearchHttpClient：调用方无感知的代理适配层。 */
export declare function researchHttpWithProxy(http: ResearchHttpClient, proxyAgent: string): ResearchHttpClient;
