/** Messages transport adapter. Narrative JSON and delivery decisions remain protocol-independent. */
export interface AnthropicOptions {
    apiKey: string;
    maxTokens?: number;
    anthropicCache?: boolean;
}
export declare function anthropicHeaders(provider: AnthropicOptions, overrides?: Record<string, unknown>): {
    'x-api-key'?: string;
    'content-type': string;
    'anthropic-version': string;
};
export declare function anthropicBody(body: Record<string, any>, provider: AnthropicOptions, cacheFirst?: boolean): {
    system: any[];
    messages: any[];
    temperature?: number;
    stream: boolean;
    max_tokens: number;
};
export declare function anthropicUsage(usage: any): {
    prompt_tokens_details?: {
        cached_tokens: any;
    };
    completion_tokens?: any;
    prompt_tokens?: any;
};
export declare function anthropicResponse(response: any): {
    choices: {
        message: {
            content: any;
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
export declare function requestAnthropicStreaming(endpoint: string, body: Record<string, unknown>, headers: Record<string, string>, timeout: number, onText?: (text: string) => Promise<void>, collect?: (usage: unknown) => void, proxyAgent?: string): Promise<any>;
