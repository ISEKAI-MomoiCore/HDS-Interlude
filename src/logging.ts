import { format as formatText } from 'node:util'
import { NarrativePhase } from './types'

export type InterludeLogLevel = 'error' | 'warn' | 'info' | 'debug'
export type InterludeLogColorTheme = 'dark' | 'light'
export type InterludeLogAction =
  | 'receive' | 'send' | 'processing' | 'complete' | 'trigger' | 'emotion'
  | 'memory' | 'advance' | 'agency' | 'group' | 'error' | 'retry' | 'warning' | 'waiting' | 'system'

export interface LayeredLogInput {
  level: InterludeLogLevel
  phase?: NarrativePhase
  protagonist?: string
  message: string
  args?: unknown[]
  colors?: boolean
  colorTheme?: InterludeLogColorTheme
  kaomoji?: boolean
  standalone?: boolean
}

const KAOMOJI: Record<InterludeLogAction, string> = {
  receive: '(*^▽^*)',
  send: '(・ω・)ノ',
  processing: '(•̀ᴗ•́)و',
  complete: '(ﾉ´ヮ`)ﾉ*: ･ﾟ',
  trigger: '(๑•̀ㅂ•́)و✧',
  emotion: '(*>ω<*)',
  memory: '₍ᐢ- ˕ -ᐢ₎zzZ',
  advance: '(⊙ω⊙)',
  agency: 'ᕙ( •̀ ᗜ •́ )ᕗ',
  group: '(´▽｀)ノ',
  error: '(˶ˊᜊˋ˶)',
  retry: '(ง •̀_•́)ง',
  warning: '(´･_･`)',
  waiting: '(っ˘ω˘ς )',
  system: '(^_^)/',
}

const SYMBOLS: Record<InterludeLogAction, string> = {
  receive: '←', send: '→', processing: '⋯', complete: '✓', trigger: '⚡', emotion: '★',
  memory: '◈', advance: '⟳', agency: '◇', group: '◎', error: '✗', retry: '↻', warning: '!', waiting: '…', system: '•',
}

const FIELD_LABELS: Record<string, string> = {
  任务: '任务', 模型: '模型', 参与者: '参与者', 时间段: '时间段', 到期计划: '到期计划',
  耗时: '耗时', 剧本文字: '剧本文字', 回复模式: '回复模式', 成功: '成功', 可见消息: '可见消息',
  合并消息: '合并消息', 数量: '数量', 数值: '数值', 累计: '累计', 阈值: '阈值', 方向: '方向',
  强度: '强度', 描述: '描述', 权重: '权重', 错误: '错误', 群: '群聊', 发送者: '发送者',
  模式: '模式', 条目: '条目', 字符: '字符', 长期事实: '长期事实', 状态变更: '状态变更',
  时间: '时间', 间隔: '间隔', 等待: '等待', 已投递: '已投递', 原因: '原因', 请求: '请求',
  阶段: '阶段', 来源: '来源', 序号: '序号', 图片: '当前图片', 历史图片: '历史图片', 音频: '音频',
  provider: '服务商', protocol: '协议', model: '模型', attempt: '尝试',
}

/**
 * The logger runs on the server and cannot inspect the Console's CSS theme.
 * Keep two manually selectable 256-color palettes instead of guessing from a
 * terminal's color capability. Dark uses luminous pastels; light uses deeper
 * ink colors with enough contrast against white backgrounds.
 */
const COLOR_PALETTES: Record<InterludeLogColorTheme, {
  protagonist: number
  detail: number
  body: number
  user: number
  success: number
  alter: number
  memory: number
  warning: number
  error: number
}> = {
  dark: {
    protagonist: 159,
    detail: 250,
    body: 255,
    user: 81,
    success: 114,
    alter: 219,
    memory: 111,
    warning: 222,
    error: 210,
  },
  light: {
    protagonist: 24,
    detail: 240,
    body: 236,
    user: 25,
    success: 28,
    alter: 90,
    memory: 25,
    warning: 130,
    error: 160,
  },
}

export function renderLogMessage(message: string, args: unknown[] = []) {
  return formatText(message, ...args.map(value => value instanceof Error ? value.message : value))
}

export function detectLogAction(message: string, level: InterludeLogLevel): InterludeLogAction {
  if (level === 'error') return 'error'
  if (/重试|再次尝试/.test(message)) return 'retry'
  if (/模型调用失败|主叙事失败|消息投递失败/.test(message)) return 'error'
  if (level === 'warn' || /警告|拦截|不可用|失败/.test(message)) return 'warning'
  if (/Alter.*(?:触发|超过阈值)|累积触发/.test(message)) return 'trigger'
  if (/(?:模型调用|情绪偏移生成|记忆整理|后台扫描|剧本推进).*完成/.test(message)) return 'complete'
  if (/情绪偏移|Alter/.test(message)) return 'emotion'
  if (/Agency|主动联系判断|主动联系重查/.test(message)) return 'agency'
  if (/记忆|压缩|Overlay/.test(message)) return 'memory'
  if (/群消息|群聊|群发言/.test(message)) return 'group'
  if (/投递|发送/.test(message)) return 'send'
  if (/收到|接收|入队/.test(message)) return 'receive'
  if (/模型调用开始|分析开始|读取开始|整理开始/.test(message)) return 'processing'
  if (/完成|成功|已就绪|已启动/.test(message)) return 'complete'
  if (/推进|后台扫描/.test(message)) return 'advance'
  if (/等待|计时器|排队/.test(message)) return 'waiting'
  return 'system'
}

export function formatLayeredLog(input: LayeredLogInput) {
  const text = renderLogMessage(input.message, input.args)
  const action = detectLogAction(text, input.level)
  const details = extractFields(text)
  const summary = details.summary || text
  const root = isRootLog(summary, action, input.level, input.standalone === true)
  const branch = root ? '' : isFinalBranch(summary, action) ? '└─' : '├─'
  const category = logCategory(action, input.phase, input.standalone === true, text)
  const face = input.kaomoji === false ? SYMBOLS[action] : KAOMOJI[action]
  const palette = COLOR_PALETTES[input.colorTheme ?? 'dark']
  const header = root
    ? `${paint(category, categoryColor(action, input.phase, text, palette), input.colors)} ${paint(input.protagonist || 'HDSI', palette.protagonist, input.colors)}`
    : branch
  const main = `${header}${header ? ' ' : ''}${paint(face, actionColor(action, palette), input.colors)} ${paint(summary, summaryColor(action, input.level, palette), input.colors)}`.trimEnd()
  if (!details.fields.length) return main
  const lines = details.fields.map((field, index) => {
    const connector = index === details.fields.length - 1 ? '└─' : '├─'
    return `${root ? connector : '   ' + connector} ${paint(field.label + ':', palette.detail, input.colors)} ${field.value}`
  })
  return [main, ...lines].join('\n')
}

export function phaseLabel(phase?: NarrativePhase) {
  if (!phase) return '系统'
  return ({
    'user-message': '用户消息',
    'conversation-follow-up': '对话后续',
    advance: '自动推进',
    'intent-due': '到期意图',
  } as Record<NarrativePhase, string>)[phase]
}

function logCategory(action: InterludeLogAction, phase?: NarrativePhase, standalone = false, message = '') {
  if (action === 'trigger' || action === 'emotion' || /Alter|情绪偏移/.test(message)) return '[情绪追踪]'
  if (action === 'agency' || /Agency/.test(message)) return '[主体节奏]'
  if (action === 'memory' || /记忆|压缩|Overlay/.test(message)) return '[记忆整理]'
  if (action === 'group' || /群聊|群消息/.test(message)) return '[群聊]'
  if (action === 'retry') return '[自动重试]'
  if (standalone) return '[系统]'
  return `[${phaseLabel(phase)}]`
}

function extractFields(text: string) {
  if (text.includes('\n')) return { summary: text, fields: [] as Array<{ label: string; value: string }> }
  const fields: Array<{ label: string; value: string }> = []
  const pattern = /(?:^|\s)([\p{L}\p{N}_-]+)=([^=]*?)(?=\s+[\p{L}\p{N}_-]+=|$)/gu
  let first = -1
  for (const match of text.matchAll(pattern)) {
    if (first < 0) first = match.index ?? -1
    const raw = match[1]
    const value = match[2].trim()
    if (!value) continue
    fields.push({ label: FIELD_LABELS[raw] || raw, value })
  }
  const summary = first >= 0 ? text.slice(0, first).trim().replace(/[：:，,]+$/, '') : text
  return { summary, fields }
}

function isRootLog(summary: string, action: InterludeLogAction, level: InterludeLogLevel, standalone: boolean) {
  if (standalone || level === 'error' || action === 'error') return true
  if (action === 'trigger' || action === 'memory' && /开始/.test(summary)) return true
  if (action === 'advance' && /(?:开始|即将执行)/.test(summary)) return true
  if (action === 'receive' && /(?:收到|接收)/.test(summary)) return true
  if (action === 'group' && /收到/.test(summary)) return true
  return false
}

function isFinalBranch(summary: string, action: InterludeLogAction) {
  if (action === 'send') return true
  if (action === 'complete' && !/模型调用完成/.test(summary)) return true
  return /写作回合完成|扫描完成|整理完成|已注入/.test(summary)
}

function categoryColor(action: InterludeLogAction, phase: NarrativePhase | undefined, message: string, palette: typeof COLOR_PALETTES.dark) {
  if (action === 'error') return palette.error
  if (action === 'warning' || action === 'retry') return palette.warning
  if (action === 'trigger' || action === 'emotion' || /Alter|情绪偏移/.test(message)) return palette.alter
  if (action === 'agency' || /Agency/.test(message)) return palette.user
  if (action === 'memory' || /记忆|压缩|Overlay/.test(message)) return palette.memory
  if (action === 'complete') return palette.success
  if (phase === 'advance') return palette.memory
  return palette.user
}

function actionColor(action: InterludeLogAction, palette: typeof COLOR_PALETTES.dark) {
  if (action === 'error') return palette.error
  if (action === 'warning' || action === 'retry') return palette.warning
  if (action === 'complete' || action === 'send') return palette.success
  if (action === 'trigger' || action === 'emotion') return palette.alter
  if (action === 'memory' || action === 'advance') return palette.memory
  if (action === 'agency') return palette.user
  return palette.user
}

function summaryColor(action: InterludeLogAction, level: InterludeLogLevel, palette: typeof COLOR_PALETTES.dark) {
  if (level === 'error') return palette.error
  if (level === 'warn') return palette.warning
  if (action === 'complete') return palette.success
  return palette.body
}

function paint(value: string, code: number, enabled = true) {
  if (!enabled) return value
  const basicAnsi = code >= 30 && code <= 37 || code >= 90 && code <= 97
  const sequence = basicAnsi ? String(code) : `38;5;${code}`
  return `\u001b[${sequence}m${value}\u001b[0m`
}
