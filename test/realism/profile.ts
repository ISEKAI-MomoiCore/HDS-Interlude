/**
 * Realism Lab · Profile 评价体系（架构文档 docs/experiments/2026-11-22-realism-lab-profile-architecture.md）。
 *
 * Profile = 一套完整的评测方案（engine/slots/variants/personas/scenarios/rubric/checks/matrix），
 * 纯 JSON 存储、可导出分享。运行时（campaign/server/UI）一律由 profile 驱动，
 * 原 arms.ts / scenarios.ts / persona.ts / matrix.round1.json 中的硬编码由
 * migrateFromConstants() 一次性迁移为内置 round1 profile。
 *
 * 安全：API key 永不入 profile。
 */
import fs from 'node:fs'
import path from 'node:path'
import { isSegmentId, ROOT, writeAtomic } from './results'
import { ARMS } from './arms'
import { PERSONAS } from './persona'
import { SCENARIOS } from './scenarios'
import type { StorySetting } from '../../src/types'

export const PROFILES_DIR = path.join(ROOT, 'profiles')
export const DEFAULT_PROFILE = 'round1'
export const PROFILE_SCHEMA_VERSION = 1

/** 提示词槽位：映射 systemPrompt() 的用户可配置参数。 */
export type SlotKey = 'mainPrompt' | 'formatPrompt' | 'fixedPrompt' | 'style' | 'storyStyle'
export const SLOT_KEYS: SlotKey[] = ['mainPrompt', 'formatPrompt', 'fixedPrompt', 'style', 'storyStyle']

export interface ProfileEngine {
  protocol: 'chat-completions' | 'anthropic-messages' | 'gemini-interactions'
  /** 不含 key；endpoint/model 可被 env 覆盖（HDSI_TEST_*）。 */
  endpoint: string
  model: string
  sampling: { temperature: number, topP: number, maxTokens: number }
  specialization: { tier: 'off' | 'lite' | 'standard' | 'full', family: string }
  payloadOrder: 'legacy' | 'cache-first'
}

export interface ArmStyleSignature {
  metric: string
  op: '<=' | '>='
  value: number
}

export interface PromptVariant {
  id: string
  label: string
  /** 作者在场度 0-3（分析轴，非运行参数）。 */
  presence: 0 | 1 | 2 | 3
  lang: 'zh' | 'en'
  /** 槽位覆盖；未列的槽用 profile.slots，再未列用生产默认。 */
  slots: Partial<Record<SlotKey, string>>
  /** H9 风格签名（metric 名对应 checks 的 TurnMetrics）。 */
  sigs?: ArmStyleSignature[]
  /** 可选模型覆盖：同提示词跨模型对比。 */
  model?: string
  stress?: boolean
  optional?: boolean
}

export interface ProfilePersona {
  id: string
  label: string
  setting: StorySetting
  participant: { id: string, displayName: string, profile: string, relationship: string }
  styleNote?: string
}

/** 回合文本：string = 单人物；Record = {default, <personaId>} 多人物变体。 */
export type TurnText = string | Record<string, string>

export interface ProfileTurn {
  at: number
  kind: 'user' | 'advance'
  content?: TurnText
  memory?: TurnText
}

export interface ProfileScenario {
  id: string
  label: string
  startISO: string
  notes?: string
  turns: ProfileTurn[]
}

export interface RubricDimension {
  id: string
  label: string
  weight: number
  /** 1/3/5 三级锚点文本（评审包与评审界面展示）。 */
  anchors: Partial<Record<'1' | '3' | '5', string>>
}

export interface RubricFlag {
  id: string
  label: string
  hotkey: string
}

export interface Rubric {
  dimensions: RubricDimension[]
  flags: RubricFlag[]
  gate: { scope: 'action-only', rules: string }
}

export interface CustomCheck {
  id: string
  kind: 'regex-prose' | 'regex-bubble' | 'metric'
  /** regex-* 用。 */
  pattern?: string
  flags?: string
  /** metric 用。 */
  metric?: string
  op?: '<=' | '>='
  value?: number
  severity: 'fail' | 'flag'
  note?: string
}

export interface ChecksConfig {
  /** builtin H1-H11：true/false/'auto'（auto = 按 variant.lang 切换模式的检查）。 */
  builtin: Record<string, boolean | 'auto'>
  custom: CustomCheck[]
}

export interface MatrixSegment {
  id: string
  variant: string
  scenario: string
  persona?: string | null
  optional?: boolean
}

export interface ProfileMatrix {
  phases: Array<{ key: string, name: string, segments: MatrixSegment[] }>
}

export interface Profile {
  schemaVersion: number
  meta: { name: string, title: string, createdAt: string, note?: string }
  engine: ProfileEngine
  slots: Partial<Record<SlotKey, string>>
  variants: PromptVariant[]
  personas: ProfilePersona[]
  scenarios: ProfileScenario[]
  rubric: Rubric
  checks: ChecksConfig
  matrix: ProfileMatrix
}

/** 回合文本解析：按人物 id 取值（string 直通；Record 缺键回落 default）。 */
export function resolveTurnText(text: TurnText | undefined, personaId: string | null | undefined): string | undefined {
  if (text === undefined) return undefined
  if (typeof text === 'string') return text
  return text[personaId ?? ''] ?? text.default
}

// —— 存取 ——

export function listProfiles(): string[] {
  fs.mkdirSync(PROFILES_DIR, { recursive: true })
  return fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.profile.json'))
    .map(file => file.replace(/\.profile\.json$/, '')).sort()
}

export function profilePath(name: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`非法 profile 名：${name}`)
  return path.join(PROFILES_DIR, `${name}.profile.json`)
}

export function loadProfile(name: string = DEFAULT_PROFILE): Profile {
  const file = profilePath(name)
  if (!fs.existsSync(file)) throw new Error(`profile 不存在：${name}（可用：${listProfiles().join(', ') || '(无)' }）`)
  const profile = JSON.parse(fs.readFileSync(file, 'utf8')) as Profile
  validateProfile(profile)
  return profile
}

export function saveProfile(profile: Profile): void {
  validateProfile(profile)
  fs.mkdirSync(PROFILES_DIR, { recursive: true })
  writeAtomic(profilePath(profile.meta.name), JSON.stringify(profile, null, 2) + '\n')
}

export function validateProfile(profile: Profile): void {
  const errors: string[] = []
  if (profile.schemaVersion !== PROFILE_SCHEMA_VERSION) errors.push(`schemaVersion 必须为 ${PROFILE_SCHEMA_VERSION}`)
  if (!/^[a-zA-Z0-9_-]+$/.test(profile.meta?.name ?? '')) errors.push('meta.name 非法（字母数字_-）')
  const variantIds = new Set<string>()
  for (const variant of profile.variants ?? []) {
    if (variantIds.has(variant.id)) errors.push(`变体 id 重复：${variant.id}`)
    variantIds.add(variant.id)
    if (variant.model !== undefined && typeof variant.model !== 'string') errors.push(`变体 ${variant.id} 的 model 非法`)
  }
  const personaIds = new Set<string>()
  for (const persona of profile.personas ?? []) {
    if (personaIds.has(persona.id)) errors.push(`人物 id 重复：${persona.id}`)
    personaIds.add(persona.id)
    if (!persona.setting?.character?.name) errors.push(`人物 ${persona.id} 缺 setting.character.name`)
    if (!persona.setting?.timezone) errors.push(`人物 ${persona.id} 缺 setting.timezone`)
  }
  const scenarioIds = new Set<string>()
  for (const scenario of profile.scenarios ?? []) {
    if (scenarioIds.has(scenario.id)) errors.push(`场景 id 重复：${scenario.id}`)
    scenarioIds.add(scenario.id)
    scenario.turns?.forEach((turn, index) => {
      if (typeof turn.content === 'object' && turn.content !== null) {
        for (const key of Object.keys(turn.content)) {
          if (key !== 'default' && !personaIds.has(key)) errors.push(`场景 ${scenario.id} turn${index} 引用未知人物 ${key}`)
        }
      }
    })
  }
  const dimensionIds = new Set<string>()
  for (const dim of profile.rubric?.dimensions ?? []) {
    if (dimensionIds.has(dim.id)) errors.push(`评分维度 id 重复：${dim.id}`)
    dimensionIds.add(dim.id)
  }
  if (!profile.rubric?.dimensions?.length) errors.push('rubric.dimensions 不能为空')
  const segmentIds = new Set<string>()
  for (const phase of profile.matrix?.phases ?? []) {
    for (const segment of phase.segments ?? []) {
      if (!isSegmentId(segment.id)) errors.push(`非法段号 ${segment.id}`)
      if (segmentIds.has(String(segment.id).toLowerCase())) errors.push(`段号重复：${segment.id}`)
      segmentIds.add(String(segment.id).toLowerCase())
      if (segment.variant !== 'TBD' && !variantIds.has(segment.variant)) errors.push(`段 ${segment.id} 引用未知变体 ${segment.variant}`)
      if (!scenarioIds.has(segment.scenario)) errors.push(`段 ${segment.id} 引用未知场景 ${segment.scenario}`)
      if (segment.persona && !personaIds.has(segment.persona)) errors.push(`段 ${segment.id} 引用未知人物 ${segment.persona}`)
    }
  }
  if (errors.length) throw new Error(`profile 校验失败：\n  ${errors.join('\n  ')}`)
}

// —— 一次性迁移：现有 TS 常量 → round1 profile ——

export function migrateFromConstants(): Profile {
  const matrixFile = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'matrix.round1.json')
  const legacyMatrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8')) as {
    phase2A: Array<{ id: string, arm: string, scenario: string, optional?: boolean }>
    phase2P: Array<{ id: string, arm: string, scenario: string, persona?: string }>
    phase2B: Array<{ id: string, arm: string, scenario: string }>
    outer: Array<{ id: string, arm: string, scenario: string }>
  }

  const variants: PromptVariant[] = ARMS.map(arm => ({
    id: arm.id,
    label: arm.label,
    presence: arm.presence,
    lang: arm.lang,
    slots: {
      style:
        // narrator 对空 style 回落生产默认（narrator.ts:2006 `|| DEFAULT_STYLE_PROMPT`）；
        // "仅合约"（D3）语义用中性元指令显式表达，避免它实际拿到默认文风。
        arm.style || (arm.id === 'D3' ? '不附加任何额外文风要求。' : arm.style),
    },
    ...(arm.sigs?.length ? { sigs: arm.sigs } : {}),
    stress: arm.stress,
    optional: arm.optional,
  }))

  const personas: ProfilePersona[] = PERSONAS.map(persona => ({
    id: persona.id,
    label: persona.label,
    setting: persona.setting,
    participant: persona.participant,
    styleNote: persona.styleNote,
  }))

  const toTurnText = (text?: string, perPersona?: Record<string, string>): TurnText | undefined => {
    if (text === undefined) return perPersona ? { default: '', ...perPersona } : undefined
    if (!perPersona) return text
    return { default: text, ...perPersona }
  }

  const scenarios: ProfileScenario[] = SCENARIOS.map(scenario => ({
    id: scenario.id,
    label: scenario.label,
    startISO: scenario.startISO,
    notes: scenario.notes,
    turns: scenario.turns.map(turn => ({
      at: turn.at,
      kind: turn.kind,
      ...(toTurnText(turn.content, turn.perPersona) !== undefined ? { content: toTurnText(turn.content, turn.perPersona)! } : {}),
      ...(toTurnText(turn.memory, turn.memoryPerPersona) !== undefined ? { memory: toTurnText(turn.memory, turn.memoryPerPersona)! } : {}),
    })),
  }))

  const phase = (key: string, name: string, list: typeof legacyMatrix.phase2A) => ({
    key, name,
    segments: list.map(segment => ({
      id: segment.id,
      variant: segment.arm,
      scenario: segment.scenario,
      persona: (segment as { persona?: string }).persona ?? null,
      optional: (segment as { optional?: boolean }).optional,
    })),
  })

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    meta: {
      name: DEFAULT_PROFILE,
      title: 'Round 1 · 文风拟真度',
      createdAt: new Date().toISOString(),
      note: '由 arms/scenarios/personas/matrix 常量一次性迁移生成（migrateFromConstants）。',
    },
    engine: {
      protocol: 'chat-completions',
      endpoint: '',
      model: '',
      sampling: { temperature: 0.8, topP: 1, maxTokens: 4096 },
      specialization: { tier: 'off', family: 'auto' },
      payloadOrder: 'cache-first',
    },
    slots: {},
    variants,
    personas,
    scenarios,
    rubric: {
      dimensions: [
        { id: 'language', label: '语言自然', weight: 1, anchors: { '1': '明显 AI 腔（排比癖、总结式收尾、客服式周全）', '3': '偶有书面腔但不出戏', '5': '像真人打字：有口语颗粒度、不完美、有自己的语癖' } },
        { id: 'emotion', label: '情绪真实', weight: 1, anchors: { '1': '情绪直给命名且与刺激不匹配', '3': '情绪基本匹配但表达套路化', '5': '情绪从动作/停顿/话题转移里渗出，强度与历史和刺激成比例' } },
        { id: 'style', label: '文风执行', weight: 1, anchors: { '1': '完全没执行', '3': '部分执行', '5': '稳定执行且不压过生活' } },
      ],
      flags: [
        { id: 'break', label: '出戏', hotkey: 'b' },
        { id: 'gem', label: '佳句', hotkey: 'g' },
      ],
      gate: {
        scope: 'action-only',
        rules: [
          '一审只评两件事（不评审剧本 prose）：',
          '1. 动作决策合理性：回复/沉默/已读不回/延迟的选择是否明显不合场景；',
          '2. 回复语句正常度：像不像真人会发出的消息（机器腔/客服腔/莫名转折/长度失配）。',
          '判定 fail（明显不过关）/ flag（存疑备注）/ pass；拿不准一律 pass 或 flag。gate 是保守过滤器。',
        ].join('\n'),
      },
    },
    checks: {
      builtin: { H1: 'auto', H2: 'auto', H3: 'auto', H4: 'auto', H5: 'auto', H6: 'auto', H7: 'auto', H8: 'auto', H9: 'auto', H10: 'auto', H11: 'auto' },
      custom: [],
    },
    matrix: {
      phases: [
        phase('phase2A', '2A · 文风 sprint', legacyMatrix.phase2A),
        phase('phase2P', '2P · 人物 sprint', legacyMatrix.phase2P),
        phase('phase2B', '2B · 复跑精评', legacyMatrix.phase2B),
        phase('outer', '外围轴', legacyMatrix.outer),
      ],
    },
  }
}

export function migrateAndSave(name: string = DEFAULT_PROFILE): Profile {
  const profile = migrateFromConstants()
  profile.meta.name = name
  saveProfile(profile)
  return profile
}
