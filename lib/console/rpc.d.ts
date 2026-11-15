/**
 * Console RPC 事件壳：把 hdsi/config/read 与 hdsi/config/save 两个事件
 * 转发给 InterludeService 的 consoleReadConfig / consoleSaveConfig。
 * 业务与白名单见 contract.ts 与 service.ts；这里只做权限分级——
 * 读 authority=1（登录即可见），写 authority=3（管理员）。
 *
 * 配置中心上线（设计 docs/CONSOLE_CONFIG_CENTER_DESIGN.md）后的写入
 * 语义变化：runtime/research 两节的旧接口不再走 service 的进程内改写
 * （重启即回退），而是与配置中心共用 applyConfigSectionPatch 持久化
 * 管线（scope.update → koishi.yml）。story 节维持 updateSetting 落库。
 */
import type { Context, Schema } from 'koishi';
import type { InterludeService } from '../service';
import type { ConfigReadResult, ConfigSaveResult } from './contract';
export * from './contract';
export * from './config-center';
declare module '@koishijs/console' {
    interface Events {
        'hdsi/config/read'(section: string): Promise<ConfigReadResult>;
        'hdsi/config/save'(input: {
            section: string;
            values: Record<string, unknown>;
        }): Promise<ConfigSaveResult>;
    }
}
export declare function installConfigRpc(ctx: Context, host: InterludeService, configSchema: Schema): void;
