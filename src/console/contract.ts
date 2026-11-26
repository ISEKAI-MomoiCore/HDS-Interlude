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

// ── 配置中心（分级导航整合）────────────────────────────────────────────
// 设计见 docs/CONSOLE_CONFIG_CENTER_DESIGN.md。菜单树是本文件维护的引导
// 元数据（标签与一句话说明），节 id 必须与 index.ts Config Schema 的顶层
// 键一致——test/console-config-center.test.ts 用 Config.dict 键集钉死该
// 对应关系，新增配置节忘挂菜单时测试会红。

export interface ConfigCenterSectionMeta {
  /** Config Schema 顶层键；mainPrompt 页面同时映射全局提示词和新故事默认文风。 */
  id: string
  label: string
  description: string
  /** 兼容菜单版本字段；所有可见配置节均为 1（可编辑）。 */
  stage: 1 | 2 | 3 | 4
}

export interface ConfigCenterGroupMeta {
  id: string
  label: string
  sections: ConfigCenterSectionMeta[]
}

export const CONFIG_CENTER_MENU: ConfigCenterGroupMeta[] = [
  { id: 'quick-start', label: '快速上手', sections: [
    { id: 'presetSync', label: '预设同步', description: '从 typ0.space 导入故事档案与配置；可选择同步范围。', stage: 1 },
  ] },
  { id: 'required', label: '故事与接入', sections: [
    { id: 'storyDefaults', label: '故事档案', description: '新故事的主角、世界、默认关系、地点、时区与前置剧本。写作规则在「写作提示词」中设置。', stage: 1 },
    { id: 'model', label: '模型中心', description: '模型连接与用途勾选、主叙事参数、视觉与音频理解。', stage: 1 },
    { id: 'onebot', label: 'QQ 接入', description: '机器人账号、私聊用户白名单、群聊白名单与群规则。', stage: 1 },
  ] },
  { id: 'structure', label: '剧本结构', sections: [
    { id: 'sharedStory', label: '共享主剧本', description: '多人参与、跨账号行为与管理员权限。', stage: 1 },
  ] },
  { id: 'rhythm', label: '写作与推进', sections: [
    { id: 'mainPrompt', label: '写作提示词', description: '主叙事系统指令、长期规则、输出补充规则、全局文风与新故事默认文风。', stage: 1 },
    { id: 'runtime', label: '上下文与运行时', description: '消息合并、打字模拟、失败重试、上下文预算与自动推进。', stage: 1 },
    { id: 'urge', label: 'Urge 弹性推进', description: '根据生活节奏与对话密度安排补写时机。', stage: 1 },
    { id: 'schedulePreplan', label: '日程预排', description: '近期稳定日程与变化颗粒度。', stage: 1 },
    { id: 'timelineDirector', label: '时间导演', description: '自动回合的时间账本与熔断保护。', stage: 1 },
    { id: 'agency', label: 'Agency 行动窗口（兼容期）', description: '主角设备、隐私与负荷的场景证据；旧出站限制保留作迁移依据，当前额度在统一投递策略中设置。', stage: 1 },
    { id: 'deliveryPolicy', label: '统一投递策略', description: '主动出站的滚动额度、最短间隔与延期有效期；默认值兼容既有部署限制。', stage: 1 },
  ] },
  { id: 'expression', label: '表达能力', sections: [
    { id: 'chatActions', label: '聊天动作', description: '引用回复、贴反应与 QQ 原生表情。', stage: 1 },
    { id: 'stickers', label: '本地表情包', description: '素材扫描、视觉描述与表情包采集。', stage: 1 },
  ] },
  { id: 'inner', label: '内在状态', sections: [
    { id: 'memory', label: '记忆与连续性', description: '场景压缩、事实召回、剧情余波和设定演化。', stage: 1 },
    { id: 'alterSystem', label: 'Alter 情绪', description: '低频氛围偏移、动态阈值与侧端分析。', stage: 1 },
  ] },
  { id: 'extensions', label: '扩展能力', sections: [
    { id: 'browser', label: '网页观察', description: 'Puppeteer 只读浏览与安全边界。', stage: 1 },
    { id: 'worldSeeder', label: '世界播种器', description: '外部事件的生成与注入；重要性和涉及程度共同决定注意度标注。', stage: 1 },
    { id: 'weather', label: '运行时天气', description: '真实天气 → [世界事件]；天气数据用于注意度标注，不改变注入条件。', stage: 1 },
    { id: 'longHorizon', label: '长线叙事催化器', description: '潜在张力与首次微表达许可（实验）。', stage: 1 },
    { id: 'qzone', label: 'QQ 空间', description: '说说/评论/点赞通道（需 SnowLuma）。', stage: 1 },
    { id: 'research', label: '考据 Agent', description: '资料案头：经核实的写作参考（实验）。', stage: 1 },
  ] },
  { id: 'maintenance', label: '维护与诊断', sections: [
    { id: 'blindMode', label: '盲区模式', description: '稳定运行后关闭管理命令与运行日志，保留低频健康心跳。', stage: 1 },
    { id: 'logging', label: '日志', description: '日志级别、信息密度、布局，以及独立的消息、剧本与模型响应预览开关。', stage: 1 },
    { id: 'modelCapture', label: '模型数据采集', description: '实验性主叙事微调数据 JSONL 落盘。', stage: 1 },
  ] },
]

export function findConfigCenterSection(id: string): ConfigCenterSectionMeta | undefined {
  for (const group of CONFIG_CENTER_MENU) {
    const found = group.sections.find(section => section.id === id)
    if (found) return found
  }
  return undefined
}

/** 全部已登记的可见配置节均可读写。 */
export function isOpenConfigCenterSection(id: string): boolean {
  return findConfigCenterSection(id)?.stage === 1
}

/** 仅危险项确认（评审决策 #1）：保存触及名单内字段时客户端须弹确认。 */
export const CONFIG_CENTER_DANGEROUS_FIELDS: Record<string, string[]> = {
  blindMode: ['enabled'],
}

/** 密钥已设置但值不回传的哨兵；保存时等于此值的字段不并入 patch。
 * 密钥字段清单不再手工维护——脱敏以 Schema 的 role=secret 递归推导
 * （collectSecretPaths，审计 F1）。 */
export const CONFIG_CENTER_SECRET_MASK = '__hdsi-secret-set__'

/** 审计 F1：递归收集 Schema 中 role=secret 的字段路径（点路径）。
 * 覆盖任意深度的嵌套对象（如 research.jev.apiKey）与数组元素；
 * Schema 是脱敏的唯一事实来源——新增 secret 字段无需改代码。 */
export function collectSecretPaths(node: unknown, base = ''): string[] {
  // schemastery/cordis 的 Schema 实例是 function——守卫必须同时放行
  // object 与 function，否则整棵树在入口就被拒绝。
  if (!node || (typeof node !== 'object' && typeof node !== 'function')) return []
  const schema = node as { dict?: Record<string, unknown>, list?: unknown[], inner?: unknown, meta?: { role?: unknown } }
  const paths: string[] = []
  if (base && schema.meta?.role === 'secret') paths.push(base)
  if (schema.dict) {
    for (const [key, child] of Object.entries(schema.dict)) {
      paths.push(...collectSecretPaths(child, base ? `${base}.${key}` : key))
    }
  }
  if (Array.isArray(schema.list)) {
    for (const child of schema.list) paths.push(...collectSecretPaths(child, base))
  }
  if (schema.inner) paths.push(...collectSecretPaths(schema.inner, base))
  return [...new Set(paths)]
}

/** 审计 F1：按路径把 values 中的密钥掩码为哨兵（嵌套对象递归、数组逐
 * 元素），返回掩码后的副本与实际发生掩码的路径列表。纯函数。 */
export function maskSecretPaths(value: unknown, paths: readonly string[]): { value: unknown, masked: string[] } {
  if (!paths.length) return { value, masked: [] }
  const pathSet = new Set(paths)
  const masked: string[] = []
  const walk = (node: unknown, prefix: string): unknown => {
    if (Array.isArray(node)) return node.map(item => walk(item, prefix))
    if (node === null || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (pathSet.has(path) && typeof child === 'string' && child.length) {
        out[key] = CONFIG_CENTER_SECRET_MASK
        masked.push(path)
        continue
      }
      out[key] = walk(child, path)
    }
    return out
  }
  return { value: walk(value, ''), masked }
}

export interface ConfigCenterReadResult {
  ok: boolean
  /** 分级菜单树（每次读取都随行返回，菜单演进无需客户端发版）。 */
  menu?: ConfigCenterGroupMeta[]
  /** 节 Schema 的 {uid, refs} 序列化 JSON；客户端 new Schema() 复活后渲染。 */
  schema?: unknown
  values?: Record<string, unknown>
  /** values 中被掩码的密钥字段（提交时这些键的哨兵值会被服务端跳过）。 */
  maskedFields?: string[]
  error?: string
}

export interface ConfigCenterSaveResult {
  ok: boolean
  values?: Record<string, unknown>
  maskedFields?: string[]
  error?: string
}
