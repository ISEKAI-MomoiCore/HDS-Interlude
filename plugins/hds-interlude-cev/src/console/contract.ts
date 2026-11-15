/**
 * Console 配置读写的共享契约：可编辑节白名单与结果形状。
 * rpc.ts（事件壳）与 service.ts（落地实现）共用；客户端表单的字段清单
 * 在 ConfigPage.vue 手写（含 info/range 文案），与此处白名单保持同步。
 */

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

/** 故事设定可编辑键（点路径对应 StorySetting 嵌套字段）。 */
export const EDITABLE_STORY_KEYS = new Set([
  'character.name', 'character.profile', 'character.traits',
  'world', 'location', 'supportingCast', 'style', 'perspective',
  'defaultRelationship', 'timezone',
])

/** 运行时参数可编辑键（config.runtime，进程内生效不落 koishi.yml）。 */
export const EDITABLE_RUNTIME_KEYS = new Set([
  'contextEntryLimit', 'contextEntryMode', 'contextTimeWindowMinutes',
  'allowProactiveMessages', 'narrativeRetryDelaySeconds', 'narrativeRetryMaxAttempts',
  'userMessageDebounceSeconds',
])

/** 考据配置可编辑键（config.research，进程内生效不落 koishi.yml）。 */
export const EDITABLE_RESEARCH_KEYS = new Set([
  'enabled', 'searchBackend', 'searchApiKey', 'proxyAgent', 'responseFormat',
  'maxRounds', 'taskTokenBudget', 'deskCapacity', 'stableFactTtlHours', 'volatileFactTtlHours',
])

export function isConfigSection(value: string): value is ConfigSection {
  return value === 'story' || value === 'runtime' || value === 'research'
}
