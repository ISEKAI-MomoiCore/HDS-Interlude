/**
 * I-7 生活关注词（设计 v2.4 §2 I-7 / §5 步骤 5——观察性产出）：
 * 由压缩器滚动维护的**有证据的派生索引**，模式对齐 Overlay。
 *
 * 本阶段为观察性产出：词集与命中记录先行可见，**不接门控、不接显著度**
 * （接入待回放确认质量后，见实施记录）。
 *
 * 证据边界（v2.3）：词的证据来源限定人物侧——角色设定、已发生的生活、
 * 明确表达的关切、有来源的剧情延续；**不从群内高频内容提炼**（防
 * "群里频繁谈论 → 变成她的关注 → 更频繁入场"的自增强回路）。
 *
 * 滞回状态机（v2.3 + F8 修正）：对外生效词集与候选滞回状态分别维护；每次
 * **成功压缩评估**推进状态（按批次去重，重试同一批材料视为同一次评估）；
 * 候选**连续**两轮提名晋升（本轮缺席即断档让位，非累计）；生效词缺席两轮
 * 或超过有效期（稳定 30 天 / 短期 7 天未确认）淘汰。模型按合约省略
 * attentionKeywords 字段或整批输出不合格时沿用旧集——不推进缺席、不消耗
 * 批次（"宁可旧、不可空"）。
 */
export interface AttentionWord {
    term: string;
    /** 证据：来源条目（或简短依据）。 */
    sourceEntryIds?: number[];
    basis?: string;
    lastConfirmedAt: string;
    /** 稳定兴趣（长有效期）vs 短期关切（短有效期）——由产出方标注。 */
    stable?: boolean;
}
/** F8：生效词有效期（天）——稳定兴趣 30 天 / 短期关切 7 天未获确认退出。 */
export declare const ATTENTION_STABLE_TTL_DAYS = 30;
export declare const ATTENTION_SHORT_TTL_DAYS = 7;
export interface AttentionCandidate {
    term: string;
    nominations: number;
    firstNominatedAt: string;
    lastNominatedAt: string;
    draft?: Omit<AttentionWord, 'term' | 'lastConfirmedAt'>;
}
export interface AttentionWordState {
    version: 1;
    effective: AttentionWord[];
    candidates: AttentionCandidate[];
    /** 生效词的缺席计数（未被最近提名）。 */
    absences: Record<string, number>;
    /** 最近一次推进状态的评估批次标识（去重）。 */
    lastEvaluatedBatch?: string;
    updatedAt: string;
}
export declare const ATTENTION_WORD_LIMIT = 6;
/** 本地防线（纯函数）：长度、去空白、去重、停用词。 */
export declare function sanitizeAttentionTerms(raw: unknown): Array<{
    term: string;
    sourceEntryIds?: number[];
    basis?: string;
    stable?: boolean;
}>;
/** 冷启动（现成结构，零模型调用）：角色名 + 明确别名 + 结构化兴趣 + 用户
 * 手填关键词——不从自由文本做名词抽取。 */
export declare function bootstrapAttentionWords(setting: {
    character?: {
        name?: unknown;
        aliases?: unknown;
    } | string;
    interests?: unknown;
}, manualKeywords?: string[]): AttentionWordState;
export interface AdvanceAttentionParams {
    /** 本轮压缩产出的原始词草稿（sanitize 前的 decision.attentionKeywords）。 */
    draft: unknown;
    /** 评估批次标识（压缩批次/证据水位；同批重试不推进状态）。 */
    batchId: string;
    now: Date;
}
/** 滞回状态机推进（纯函数；同批去重、连续两轮晋升、两轮缺席/有效期淘汰、
 * 上限截断）。F8：draft 非数组（字段省略/非法形状）或整批不合格（非空
 * 输入全被防线过滤）时返回 previous——完全 no-op，不推进缺席也不消耗批次。 */
export declare function advanceAttentionWords(previous: AttentionWordState | undefined, params: AdvanceAttentionParams): AttentionWordState | undefined;
/** 观察性命中检测：批次内容与生效词的匹配（不接门控，仅记录）。 */
export declare function matchAttentionWords(state: AttentionWordState | undefined, content: string): AttentionWord[];
