/**
 * 配置中心管线（分级导航整合，设计见 docs/CONSOLE_CONFIG_CENTER_DESIGN.md）。
 *
 * 读取：节 Schema 经 cordis toJSON 序列化为 {uid, refs} JSON，客户端用
 * schemastery 的 new Schema() 复活后交给 k-schema 渲染——与 Koishi 标准
 * 配置页同一条 Schema→表单链路，字段清单零手写。
 *
 * 写入：按节深合并 patch → 整树 Config.value 预校验（失败不落盘，直接
 * 返回字段路径错误）→ ctx.scope.update(merged)。后者由框架完成两件事：
 * cordis 热更新 fork 配置；loader 的 internal/before-update 钩子把
 * schema.simplify 后的值原子写回 koishi.yml。保存即持久，插件与标准
 * 配置页共用同一机制（设计 §6）。
 *
 * 密钥：读取掩码、保存哨兵跳过（CONFIG_CENTER_SECRET_FIELDS）。
 * 危险项确认名单（CONFIG_CENTER_DANGEROUS_FIELDS）由客户端在提交前
 * 弹确认；服务端不重复拦截。
 */
import { Schema, type Context } from 'koishi';
import type { InterludeService } from '../service';
import type { ConfigCenterReadResult, ConfigCenterSaveResult } from './contract';
export * from './contract';
declare module '@koishijs/console' {
    interface Events {
        'hdsi/config-center/read'(section?: string | null): Promise<ConfigCenterReadResult>;
        'hdsi/config-center/save'(input: {
            section: string;
            patch: Record<string, unknown>;
            reload?: boolean;
            unset?: string[];
        }): Promise<ConfigCenterSaveResult>;
    }
}
/** 序列化一个配置节的 Schema（顶层键 → 子 Schema）。节不存在时抛错。 */
export declare function serializeConfigSection(configSchema: Schema, section: string): unknown;
/** 配置中心读取：菜单恒随行；开放节附带序列化 Schema 与当前值。
 * 密钥脱敏以 Schema 为唯一事实来源（审计 F1）：递归收集 role=secret 的
 * 字段路径——嵌套如 research.jev.apiKey 同样掩码，不依赖手工清单。 */
export declare function readConfigCenter(host: InterludeService, configSchema: Schema, section?: string | null): ConfigCenterReadResult;
/** 按节持久化写入：深合并（审计 F5，嵌套字段不丢）→ 整树预校验 →
 * scope.update（热更新 + loader 写回 koishi.yml）。任何失败都不落盘。 */
export declare function applyConfigSectionPatch(host: InterludeService, configSchema: Schema, section: string, patch: Record<string, unknown>, options?: {
    reload?: boolean;
    unset?: string[];
}): ConfigCenterSaveResult;
/** RPC 安装：读 authority=1（登录可见），写 authority=3（管理员）。 */
export declare function installConfigCenterRpc(ctx: Context, host: InterludeService, configSchema: Schema): void;
