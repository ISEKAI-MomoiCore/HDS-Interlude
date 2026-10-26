export interface ModelCaptureConfig {
    enabled: boolean;
    directory: string;
}
/** 一条采集记录 = 一次解析成功的主叙事往返（对话推进与自动推进均覆盖）。 */
export interface MainNarrativeCaptureRecord {
    capturedAt: string;
    task: 'main';
    phase: string;
    storyId: string;
    participantId: string | null;
    provider: {
        id?: string;
        label: string;
        model: string;
        host: string;
    };
    /** decide() 重试循环内的第几次尝试（1 起）；仅元数据。 */
    attemptIndex?: number;
    latencyMs: number;
    request: {
        messages: Array<{
            role: string;
            content: unknown;
        }>;
        responseFormat: string;
        temperature?: number;
        topP?: number;
        maxTokens?: number;
    };
    responseText: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cachedInputTokens?: number;
    };
}
export interface MainCaptureSink {
    record(entry: MainNarrativeCaptureRecord): void;
}
export interface CapturedMessage {
    role: string;
    content: unknown;
}
/** 多模态消息里的 base64 图片/音频只保留占位与长度，避免数据文件被内联媒体撑爆。 */
export declare function sanitizeCapturedMessages<T extends CapturedMessage>(messages: T[]): T[];
/** 只保留 host 作为端点标识；完整 URL（可能含网关路径与查询串）不进采集文件。 */
export declare function captureEndpointHost(endpoint: string): string;
export declare function captureDateTag(date?: Date): string;
export declare function captureFileName(date?: Date): string;
/** 串行追加式 JSONL 采集器：record() 永不同步抛错、永不阻塞调用方。 */
export declare class ModelCaptureSink implements MainCaptureSink {
    private readonly directory;
    private readonly logger?;
    private readonly maxConsecutiveFailures;
    private queue;
    private consecutiveFailures;
    private warnedOnce;
    private directoryReady;
    private stopped;
    constructor(directory: string, logger?: {
        warn?: (template: string, ...args: any[]) => void;
    }, maxConsecutiveFailures?: number);
    /** 连续写盘失败达到上限后停用；重载（重建 sink）即恢复。 */
    get active(): boolean;
    record(entry: MainNarrativeCaptureRecord): void;
    /** 等待在途写盘完成；测试与停机前使用。 */
    flush(): Promise<void>;
}
