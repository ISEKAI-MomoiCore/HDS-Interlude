declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** 客户端侧的 HDSI Console 事件契约——与服务端声明保持同步
 * （src/console/index.ts 的 hdsi-overview 服务 + src/console/rpc.ts
 * + src/console/config-center.ts）。
 * 客户端 send 的类型来自 @koishijs/plugin-console，与后端
 * @koishijs/console 是两个模块名，需在此单独登记。
 * （主仓即本插件，使用 hdsi/* 原名。） */
declare module '@koishijs/plugin-console' {
  interface Events {
    'hdsi-overview/get'(): Promise<any>
    'hdsi/config/read'(section: 'story' | 'runtime' | 'research'): Promise<{ ok: boolean, values?: Record<string, unknown>, error?: string }>
    'hdsi/config/save'(input: { section: 'story' | 'runtime' | 'research', values: Record<string, unknown> }): Promise<{ ok: boolean, applied?: number, error?: string }>
    'hdsi/config-center/read'(section?: string): Promise<{ ok: boolean, menu?: unknown, schema?: unknown, values?: Record<string, unknown>, maskedFields?: string[], error?: string }>
    'hdsi/config-center/save'(input: { section: string, patch: Record<string, unknown> }): Promise<{ ok: boolean, error?: string }>
  }
}
