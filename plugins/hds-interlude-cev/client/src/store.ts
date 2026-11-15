import { send } from '@koishijs/client'

export type ConfigSection = 'story' | 'runtime' | 'research'

export interface ConfigReadResult {
  ok: boolean
  values?: Record<string, unknown>
  error?: string
}

export interface ConfigSaveResult {
  ok: boolean
  applied?: number
  error?: string
}

/** Console RPC 调用封装：概览快照 + 三节配置读写（事件名带 -cev 与主仓并存）。 */
export const store = {
  /** 拉取 hdsi-overview-cev DataService 快照。 */
  async overview(): Promise<any> {
    return send('hdsi-overview-cev/get')
  },
  /** 读取一节配置（authority=1）。无活跃故事时 story 节返回空 values。 */
  async readConfig(section: ConfigSection): Promise<ConfigReadResult> {
    return send('hdsi-cev/config/read', section)
  },
  /** 提交一节配置（authority=3）。白名单外的键由服务端静默忽略。 */
  async saveConfig(section: ConfigSection, values: Record<string, unknown>): Promise<ConfigSaveResult> {
    return send('hdsi-cev/config/save', { section, values })
  },
}
