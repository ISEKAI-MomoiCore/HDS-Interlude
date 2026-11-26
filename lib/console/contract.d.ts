/**
 * Console 配置读写的共享契约：可编辑节白名单与结果形状。
 * rpc.ts（事件壳）与 service.ts（落地实现）共用；客户端表单的字段清单
 * 在 ConfigPage.vue 手写（含 info/range 文案），与此处白名单保持同步。
 */
export type ConfigSection = 'story' | 'runtime' | 'research';
export interface ConfigReadResult {
    ok: boolean;
    values?: Record<string, unknown>;
    error?: string;
}
export interface ConfigSaveResult {
    ok: boolean;
    applied?: number;
    error?: string;
}
/** 故事设定可编辑键（点路径对应 StorySetting 嵌套字段）。 */
export declare const EDITABLE_STORY_KEYS: Set<string>;
/** 运行时参数可编辑键（config.runtime，进程内生效不落 koishi.yml）。 */
export declare const EDITABLE_RUNTIME_KEYS: Set<string>;
/** 考据配置可编辑键（config.research，进程内生效不落 koishi.yml）。 */
export declare const EDITABLE_RESEARCH_KEYS: Set<string>;
export declare function isConfigSection(value: string): value is ConfigSection;
export interface ConfigCenterSectionMeta {
    /** Config Schema 顶层键；mainPrompt 页面同时映射全局提示词和新故事默认文风。 */
    id: string;
    label: string;
    description: string;
    /** 兼容菜单版本字段；所有可见配置节均为 1（可编辑）。 */
    stage: 1 | 2 | 3 | 4;
}
export interface ConfigCenterGroupMeta {
    id: string;
    label: string;
    sections: ConfigCenterSectionMeta[];
}
export declare const CONFIG_CENTER_MENU: ConfigCenterGroupMeta[];
export declare function findConfigCenterSection(id: string): ConfigCenterSectionMeta | undefined;
/** 全部已登记的可见配置节均可读写。 */
export declare function isOpenConfigCenterSection(id: string): boolean;
/** 仅危险项确认（评审决策 #1）：保存触及名单内字段时客户端须弹确认。 */
export declare const CONFIG_CENTER_DANGEROUS_FIELDS: Record<string, string[]>;
/** 密钥已设置但值不回传的哨兵；保存时等于此值的字段不并入 patch。
 * 密钥字段清单不再手工维护——脱敏以 Schema 的 role=secret 递归推导
 * （collectSecretPaths，审计 F1）。 */
export declare const CONFIG_CENTER_SECRET_MASK = "__hdsi-secret-set__";
/** 审计 F1：递归收集 Schema 中 role=secret 的字段路径（点路径）。
 * 覆盖任意深度的嵌套对象（如 research.jev.apiKey）与数组元素；
 * Schema 是脱敏的唯一事实来源——新增 secret 字段无需改代码。 */
export declare function collectSecretPaths(node: unknown, base?: string): string[];
/** 审计 F1：按路径把 values 中的密钥掩码为哨兵（嵌套对象递归、数组逐
 * 元素），返回掩码后的副本与实际发生掩码的路径列表。纯函数。 */
export declare function maskSecretPaths(value: unknown, paths: readonly string[]): {
    value: unknown;
    masked: string[];
};
export interface ConfigCenterReadResult {
    ok: boolean;
    /** 分级菜单树（每次读取都随行返回，菜单演进无需客户端发版）。 */
    menu?: ConfigCenterGroupMeta[];
    /** 节 Schema 的 {uid, refs} 序列化 JSON；客户端 new Schema() 复活后渲染。 */
    schema?: unknown;
    values?: Record<string, unknown>;
    /** values 中被掩码的密钥字段（提交时这些键的哨兵值会被服务端跳过）。 */
    maskedFields?: string[];
    error?: string;
}
export interface ConfigCenterSaveResult {
    ok: boolean;
    values?: Record<string, unknown>;
    maskedFields?: string[];
    error?: string;
}
