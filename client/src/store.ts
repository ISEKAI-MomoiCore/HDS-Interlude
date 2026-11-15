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

export interface ConfigCenterSectionMeta {
  id: string
  label: string
  description: string
  /** 兼容菜单版本字段；所有可见节均为 1（可编辑）。 */
  stage: number
}

export interface ConfigCenterGroupMeta {
  id: string
  label: string
  sections: ConfigCenterSectionMeta[]
}

export interface ConfigCenterReadResult {
  ok: boolean
  menu?: ConfigCenterGroupMeta[]
  /** 节 Schema 的 {uid, refs} 序列化 JSON；new Schema() 复活后渲染。 */
  schema?: unknown
  values?: Record<string, unknown>
  maskedFields?: string[]
  error?: string
}

export interface ConfigCenterSaveResult {
  ok: boolean
  error?: string
}

/** Console RPC 调用封装：概览快照 + 三节配置读写 + 配置中心。 */
export const store = {
  /** 拉取 hdsi-overview DataService 快照。 */
  async overview(): Promise<any> {
    return send('hdsi-overview/get')
  },
  /** 读取一节配置（authority=1）。无活跃故事时 story 节返回空 values。 */
  async readConfig(section: ConfigSection): Promise<ConfigReadResult> {
    return send('hdsi/config/read', section)
  },
  /** 提交一节配置（authority=3）。白名单外的键由服务端静默忽略。 */
  async saveConfig(section: ConfigSection, values: Record<string, unknown>): Promise<ConfigSaveResult> {
    return send('hdsi/config/save', { section, values })
  },
  /** 配置中心：读取菜单树（无参）或某开放节（authority=1）。 */
  async readConfigCenter(section?: string): Promise<ConfigCenterReadResult> {
    return section ? send('hdsi/config-center/read', section) : send('hdsi/config-center/read')
  },
  /** 配置中心：按节提交 patch（authority=3）——服务端合并、预校验后
   * scope.update 持久化写回 koishi.yml 并热更新。 */
  async saveConfigCenter(section: string, patch: Record<string, unknown>, options: { reload?: boolean, unset?: string[] } = {}): Promise<ConfigCenterSaveResult> {
    return send('hdsi/config-center/save', { section, patch, ...options })
  },
  /** 通信动作只读视图：账本/计划派生的动作列表（authority=1，游标分页）。 */
  async actionsList(cursor?: string, limit = 20): Promise<CommunicationActionsListResultView> {
    return send('hdsi/actions/list', { cursor, limit })
  },
  /** 通信动作详情（按动作 ID 惰性读取，含分段与原文摘录）。 */
  async actionDetail(id: string): Promise<CommunicationActionDetailView | null> {
    return send('hdsi/actions/get', { id })
  },
  /** 取消未来计划/未执行分段（authority=3；服务端幂等）。 */
  async cancelAction(id: string): Promise<{ ok: boolean, changed: number, reason: string }> {
    return send('hdsi/actions/cancel', { id })
  },
  /** unknown 分段人工核实（authority=3）。 */
  async verifyAction(id: string, outcome: 'delivered' | 'not-sent'): Promise<{ ok: boolean, changed: number, reason: string }> {
    return send('hdsi/actions/verify', { id, outcome })
  },
}

export interface CommunicationActionRowView {
  id: string
  kind: 'action' | 'plan' | 'fixed-delay'
  target: string
  channel: 'private' | 'group'
  status: string
  reason?: string
  updatedAt: string
  scriptEntryId?: number
  head: string
  dueAt?: string
  expiresAt?: string
  segmentCount: number
  deliveredCount: number
}

export interface CommunicationActionsListResultView {
  rows: CommunicationActionRowView[]
  cursor?: string
  total: number
}

export interface CommunicationActionDetailView extends CommunicationActionRowView {
  segments: Array<{ index: number, kind: string, status: string, head: string, reason?: string, attemptedAt?: string, completedAt?: string }>
  quote: string
}
