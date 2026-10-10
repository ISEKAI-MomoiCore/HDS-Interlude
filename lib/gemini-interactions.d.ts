/** Google Gemini Interactions API 传输适配（v1beta）。
 *
 * 背景：Gemini 的 OpenAI 兼容层（/v1beta/openai/chat/completions）对部分
 * AI Studio 密钥不再开放，官方方向是 Interactions API 成为唯一入口（旧
 * generateContent schema 已于 2026-06 移除）。本模块把 HDSI 内部的
 * OpenAI 形态请求映射为 Interactions 请求，并把响应归一化回 choices 形态，
 * 与 anthropic.ts 的适配方式同构：
 *   鉴权   x-goog-api-key（AI Studio 密钥直用，非 Bearer）
 *   请求   POST /v1beta/interactions { model, input: Step[], system_instruction,
 *          generation_config, response_format }
 *   响应   Interaction { status, steps[].content[].text, usage.total_*_tokens }
 */
export interface GeminiInteractionsOptions {
    apiKey?: string;
}
export declare function geminiInteractionsHeaders(provider: GeminiInteractionsOptions, overrides?: Record<string, unknown>): {
    'x-goog-api-key'?: string;
    'content-type': string;
};
/** OpenAI Chat Completions 请求体 → Interactions 请求体（纯函数，可单测）。 */
export declare function geminiInteractionsBody(body: Record<string, any>): Record<string, unknown>;
/** Interactions usage（total_*_tokens）→ OpenAI usage 形态（含缓存明细）。
 * Gemini 惯例 total_input_tokens 已包含 cached 部分（与 Anthropic 三字段互斥
 * 不同）——直接取值，cached 只进 details，避免双重计费。 */
export declare function geminiInteractionsUsage(usage: any): {
    prompt_tokens_details?: {
        cached_tokens: any;
    };
    completion_tokens?: any;
    prompt_tokens?: any;
};
/** Interaction 资源 → OpenAI choices 形态。失败/未完成显式抛错（与
 * anthropicResponse 同语义：宁可触发服务商重试，不静默接受截断输出）。 */
export declare function geminiInteractionsResponse(response: any): {
    choices: {
        message: {
            content: string;
        };
    }[];
    usage: {
        prompt_tokens_details?: {
            cached_tokens: any;
        };
        completion_tokens?: any;
        prompt_tokens?: any;
    };
};
