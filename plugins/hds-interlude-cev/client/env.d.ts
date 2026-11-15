declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** 客户端侧的 HDSI Console 事件契约——与服务端声明保持同步
 * （src/console/index.ts 的 hdsi-overview-cev 服务 + src/console/rpc.ts）。
 * 客户端 send 的类型来自 @koishijs/plugin-console，与后端
 * @koishijs/console 是两个模块名，需在此单独登记。
 * 事件名带 -cev 后缀——与主仓插件的 hdsi/* 并存不撞名。 */
declare module '@koishijs/plugin-console' {
  interface Events {
    'hdsi-overview-cev/get'(): Promise<any>
    'hdsi-cev/config/read'(section: 'story' | 'runtime' | 'research'): Promise<{ ok: boolean, values?: Record<string, unknown>, error?: string }>
    'hdsi-cev/config/save'(input: { section: 'story' | 'runtime' | 'research', values: Record<string, unknown> }): Promise<{ ok: boolean, applied?: number, error?: string }>
  }
}
