export interface ForwardReadLimits {
    maxNodes: number;
    maxCharacters: number;
    maxDepth: number;
}
export interface ForwardReadResult {
    content: string;
    nodeCount: number;
    forwardCount: number;
    truncated: boolean;
    failed: boolean;
    /** 整体拉取失败的原因（模块保持零依赖，日志由调用方记录）。 */
    cause?: string;
    /** 嵌套合并转发读取失败次数（>0 时正文以占位符降级，调用方记 warn）。 */
    nestedFailed?: number;
    /** 合并转发节点内图片的可加载引用（http CDN URL → onebot-url: 前缀；
     * 仅有 file token 时 → onebot-file: 前缀，由 fetchNativeImage 经
     * bot.getImage 解析）。正文仍保留 [图片] 占位符——refs 进视觉管线，
     * 占位符进文本事实，两者职责分离。有界，与视觉管线 slice(0,3) 对齐。 */
    imageRefs: string[];
}
export declare function readForwardContent(session: any, limits?: Partial<ForwardReadLimits>): Promise<ForwardReadResult | undefined>;
export declare function forwardReadLimits(value?: Partial<ForwardReadLimits>): ForwardReadLimits;
export declare function extractForwardIds(content: unknown): string[];
export declare function normalizeForwardMessages(messages: unknown[], limits?: Partial<ForwardReadLimits>, depth?: number): ForwardNormalized;
export type ForwardNormalized = Omit<ForwardReadResult, 'imageRefs'>;
