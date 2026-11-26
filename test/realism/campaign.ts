/**
 * Realism Lab · 引擎层（profile 驱动）。
 *
 * CLI（harness.ts）与本地服务（server.ts）共用本模块：
 *   - runSegment 由 profile 驱动：槽位叠加（生产默认 → profile.slots → variant.slots）、
 *     engine 四级链（env → profile.engine → variant.model → run 覆盖）、契约指纹
 *   - Campaign 管理队列/并发/停止旗，状态可被 /api/state 读取
 * 产物格式不变：turns.jsonl / manifest.json（manifest 增 engine/contract/slots 增量字段）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { readResult, summarizeTurns, writeAtomic, OUT_ROOT } from './results'
export { ROOT, OUT_ROOT } from './results'
import { systemPrompt, toPromptPayload } from '../../src/narrator'
import type { InterludeStory, InterludeParticipant } from '../../src/types'
import { resolveManualSpecialty } from '../../src/specialization'
import { buildCompiledPayload, TurnAccumulator } from './payload'
import { parseDecision, runChecks } from './checks'
import { callModel, type ProviderTarget } from './protocol'
import { resolveTurnText as resolveProfileText, type Profile, type ProfilePersona, type ProfileScenario, type PromptVariant, type MatrixSegment, type SlotKey, type Rubric } from './profile'


export interface EnvConfig {
  endpoint: string
  apiKey: string
  model: string
  samplingOff: boolean
  proxy?: string
  protocol: ProviderTarget['protocol']
  timeoutMs: number
  maxTokens: number
}

export function resolveEnvFromProcess(): EnvConfig {
  return {
    endpoint: process.env.HDSI_TEST_PROVIDER_ENDPOINT ?? '',
    apiKey: process.env.HDSI_TEST_API_KEY ?? '',
    model: process.env.HDSI_TEST_MODEL ?? '',
    samplingOff: process.env.HDSI_TEST_SAMPLING === 'off',
    proxy: process.env.HDSI_TEST_PROXY || undefined,
    protocol: (process.env.HDSI_TEST_PROTOCOL as ProviderTarget['protocol'] | undefined) ?? 'chat-completions',
    timeoutMs: Number(process.env.HDSI_TEST_TIMEOUT_MS ?? 60_000),
    maxTokens: Number(process.env.HDSI_TEST_MAX_TOKENS ?? 4096),
  }
}

const ENV_VAR_NAMES = { endpoint: 'HDSI_TEST_PROVIDER_ENDPOINT', apiKey: 'HDSI_TEST_API_KEY', model: 'HDSI_TEST_MODEL' } as const

export function envMissing(env: EnvConfig): string[] {
  return (['endpoint', 'apiKey', 'model'] as const).filter(key => !env[key]).map(key => ENV_VAR_NAMES[key])
}

export type { MatrixSegment }

export interface RunOverrides {
  model?: string
  endpoint?: string
  apiKey?: string
}

export function resolveTarget(profile: Profile, env: EnvConfig, variant?: PromptVariant, overrides?: RunOverrides): ProviderTarget {
  const model = overrides?.model?.trim() || variant?.model || profile.engine.model || env.model
  const endpoint = overrides?.endpoint?.trim() || profile.engine.endpoint || env.endpoint
  const protocol = profile.engine.protocol || env.protocol
  let origin: string
  try {
    const url = new URL(endpoint)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
    origin = url.origin
  } catch { throw new Error('请填写有效的 HTTP(S) 模型端点') }
  let configuredOrigin: string | undefined
  try { configuredOrigin = new URL(env.endpoint).origin } catch { /* 没有已配置的凭据作用域 */ }
  const apiKey = overrides?.apiKey?.trim() || (origin === configuredOrigin ? env.apiKey : '')
  if (!apiKey) throw new Error('请为当前端点填写 API Key，或在环境中配置同源端点和 Key')
  if (!model) throw new Error('请配置模型名称')
  if (protocol !== 'chat-completions') throw new Error(`协议 ${protocol} 尚未实现，请选择 Chat Completions`)
  return { protocol, endpoint, apiKey, model }
}

export function modelOptions(profile: Profile, env: EnvConfig) {
  const maxTokens = profile.engine.sampling.maxTokens || env.maxTokens
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error('maxTokens 必须为正整数')
  if (!Number.isSafeInteger(env.timeoutMs) || env.timeoutMs <= 0 || env.timeoutMs > 2_147_483_647) throw new Error('模型超时配置无效')
  return {
    ...(env.samplingOff ? {} : { temperature: profile.engine.sampling.temperature, topP: profile.engine.sampling.topP }),
    maxTokens,
    timeoutMs: env.timeoutMs,
    proxy: env.proxy,
  }
}

export interface ProgressSink {
  onSegmentStart?(segment: MatrixSegment, info: { variantLabel: string, personaLabel: string, turnCount: number }): void
  onTurn?(segmentId: string, record: TurnRecord, note?: string): void
  onSegmentDone?(segment: MatrixSegment, manifest: SegmentManifest): void
  onSegmentError?(segment: MatrixSegment, message: string): void
  onLog?(line: string): void
}

const consoleSink: ProgressSink = {
  onSegmentStart(segment, info) {
    process.stdout.write(`  [${segment.id}] 开始 ${segment.variant} × ${segment.scenario}${segment.persona ? ` × ${segment.persona}` : ''}（${info.turnCount} 轮）\n`)
  },
  onTurn(segmentId, record) {
    const fails = (record.checks ?? []).filter(check => check.verdict === 'fail').map(check => check.id).join(',')
    process.stdout.write(`  [${segmentId}] ${record.seq} ${record.kind} ${record.atLocal}${fails ? ` ✗${fails}` : ''}${record.error ? ` ERR ${record.error.slice(0, 160)}` : ''}\n`)
  },
  onSegmentDone(segment, manifest) {
    const labels = { complete: '完成', stopped: '已停止', failed: '存在失败回合' }
    process.stdout.write(`  [${segment.id}] ${labels[manifest.status ?? 'complete']} · 异常轮 ${manifest.errorTurns} · H 失败 ${JSON.stringify(manifest.hFails)} · tokens≈${manifest.totalTokens}\n`)
  },
  onSegmentError(segment, message) {
    process.stdout.write(`  [${segment.id}] 失败：${message}\n`)
  },
}

export function consoleProgressSink(): ProgressSink {
  return consoleSink
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 与生产一致的本地时间投影。 */
export function localTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

export function safeHost(endpoint: string): string {
  if (!endpoint) return ''
  try { return new URL(endpoint).host } catch { return '(invalid-endpoint)' }
}

export interface WritingOptions {
  messageSeparator: string
  splitReplyMessages: boolean
  browserMode: 'disabled' | 'deferred-only' | 'allow-immediate'
}

export interface TurnRecord {
  seq: number
  kind: 'user' | 'advance'
  phase: 'user-message' | 'advance'
  atISO: string
  atLocal: string
  userMessage?: string
  dueIntentIds: number[]
  systemChars: number
  payloadChars: number
  latencyMs?: number
  usage?: { promptTokens?: number, completionTokens?: number, totalTokens?: number }
  rawResponse?: string
  parsed?: {
    script: string
    seen?: boolean
    replyMode?: string
    replyContent?: string
    replySendAt?: string
    followUpCommitment?: unknown
    intentUpdates?: unknown
  }
  parseError?: string
  checks?: Array<{ id: string, verdict: string, detail?: string }>
  metrics?: Record<string, unknown>
  payloadKeys?: string[]
  error?: string
}

export interface SegmentManifest {
  segment: string
  profile: string
  resultId?: string
  cohort?: string
  configHash?: string
  rubric?: Rubric
  status?: 'complete' | 'failed' | 'stopped'
  variant: { id: string, label: string, presence: number, lang: string, styleHash: string }
  scenario: { id: string, label: string, startISO: string, turnCount: number }
  persona: { id: string, characterName: string }
  engine: { protocol: string, model: string, endpointHost: string, samplingOff: boolean, maxTokens: number }
  contract: { systemHash: string, payloadKeys: string[] }
  slots: Record<string, string>
  startedAt: string
  finishedAt: string
  totalTokens: number
  hFails: Record<string, number>
  errorTurns: number
  /** 停止请求导致的中段截断（产物为部分段）。 */
  stopped?: boolean
}

/** 生产默认 mainPrompt（narrator.ts:2002 的 fallback 文本，供指纹与 UI diff 使用）。 */
export const PRODUCTION_DEFAULT_MAIN_PROMPT = '以主角为中心，持续创作一部正在发生的生活剧本。让具体的日常、偶然的事件、人际互动、现实压力、未完成的事情和细微的心境变化共同推动故事；聊天只是其中自然可能出现的一个事件。'

const coreHashes = new Map<string, string>()

/** 固定输入下的生产提示词和 Payload 编译器指纹，独立于 Profile。 */
export function coreContractFingerprint(writingOptions: WritingOptions): { systemHash: string } {
  const key = JSON.stringify(writingOptions)
  const cached = coreHashes.get(key)
  if (cached) return { systemHash: cached }
  const systems = (['user-message', 'advance'] as const).flatMap(phase => [false, true].map(cacheFirst =>
    systemPrompt(phase, undefined, undefined, '', '', '', false, false, false, false, false,
      undefined, false, undefined, false, false, cacheFirst, false, writingOptions)))
  const systemHash = sha256(JSON.stringify([systems, toPromptPayload.toString(), 'realism-v2']))
  coreHashes.set(key, systemHash)
  return { systemHash }
}

const WRITING_OPTIONS: WritingOptions = { messageSeparator: '<sep/>', splitReplyMessages: true, browserMode: 'disabled' }

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item)
}

export function describeRun(profile: Profile, env: EnvConfig, segment: MatrixSegment, overrides?: RunOverrides) {
  const variant = profile.variants.find(item => item.id === segment.variant)
  const target = resolveTarget(profile, env, variant, overrides)
  const options = modelOptions(profile, env)
  const contractHash = coreContractFingerprint(WRITING_OPTIONS).systemHash
  const cohort = sha256(stableJson({
    profile, contractHash, endpoint: target.endpoint, protocol: target.protocol,
    modelOverride: overrides?.model?.trim() || '', fallbackModel: profile.engine.model || env.model,
    samplingOff: env.samplingOff, maxTokens: options.maxTokens,
  }))
  const configHash = sha256(stableJson({ cohort, segment, model: target.model }))
  return { target, options, contractHash, cohort, configHash }
}

/** 生产参数映射（narrator.ts:1101 调用点的 profile 复刻，urge 关闭）。 */
function buildSystemPrompt(phase: 'user-message' | 'advance', slots: Partial<Record<SlotKey, string>>, hasPerspective: boolean, writingOptions: WritingOptions, specialty: ReturnType<typeof resolveManualSpecialty>, cacheFirst: boolean): string {
  return systemPrompt(
    phase,
    slots.mainPrompt?.trim() || undefined,   // 空 = narrator 生产默认 fallback
    slots.formatPrompt?.trim() || undefined,
    slots.fixedPrompt ?? '',
    slots.style ?? '',                        // 注意：narrator 对空 style 回落 DEFAULT_STYLE_PROMPT（2006 行）
    slots.storyStyle ?? '',
    false, false, false, hasPerspective, false,
    undefined, false, undefined, false, false, cacheFirst, false,
    writingOptions, specialty, undefined, false, undefined, undefined, undefined,
  )
}

/** 单段执行：profile 驱动。shouldStop 在轮间检查（轮级停止，当前轮写完后中断）。 */
export async function runSegment(segment: MatrixSegment, options: {
  profile: Profile
  env: EnvConfig
  dry: boolean
  sink?: ProgressSink
  overrides?: RunOverrides
  date?: string
  shouldStop?: () => boolean
}): Promise<string | undefined> {
  const { profile, env, dry } = options
  const sink = options.sink ?? {}

  const variant = profile.variants.find(v => v.id === segment.variant)
  if (!variant) throw new Error(`段 ${segment.id} 引用的变体 ${segment.variant} 不存在`)
  const scenario = profile.scenarios.find(s => s.id === segment.scenario)
  if (!scenario) throw new Error(`段 ${segment.id} 引用的场景 ${segment.scenario} 不存在`)
  const persona: ProfilePersona | undefined = profile.personas.find(p => p.id === (segment.persona ?? profile.personas[0]?.id))
  if (!persona) throw new Error(`段 ${segment.id} 无法解析人物`)
  /** 场景时间：startISO + 分钟偏移（turnTime 内联，避免依赖旧 Scenario 形状）。 */
  const turnAt = (turn: { at: number }) => new Date(new Date(scenario.startISO).getTime() + turn.at * 60_000)

  // 槽位叠加：生产默认 → profile.slots → variant.slots
  const slots: Partial<Record<SlotKey, string>> = { ...profile.slots }
  for (const [key, value] of Object.entries(variant.slots ?? {})) slots[key as SlotKey] = value

  const run = dry ? undefined : describeRun(profile, env, segment, options.overrides)
  const model = run?.target.model ?? (options.overrides?.model || variant.model || profile.engine.model || env.model)
  const cacheFirst = profile.engine.payloadOrder !== 'legacy'

  const baseNow = turnAt(scenario.turns[0])
  const story = buildStory(persona, baseNow)
  const participant = buildParticipant(persona, baseNow)
  const acc = new TurnAccumulator(story.id, participant.id)
  const writingOptions = WRITING_OPTIONS
  const hasPerspective = Boolean(story.setting.perspective?.trim() || (story.setting.perspectives ?? []).some(p => p.trim()))
  const specialty = resolveManualSpecialty(model, profile.engine.specialization.tier, profile.engine.specialization.family as never)

  const date = options.date ?? new Date().toISOString().slice(0, 10)
  const resultId = `${date}/${segment.id}--${randomUUID()}`
  const outDir = path.join(OUT_ROOT, resultId)
  const dryPreview = path.join(outDir, 'dry-preview.txt')
  if (dry) fs.mkdirSync(outDir, { recursive: true })

  sink.onSegmentStart?.(segment, { variantLabel: variant.label, personaLabel: persona.label, turnCount: scenario.turns.length })

  const records: TurnRecord[] = []
  const history: Array<{ opener8: string, replyContent?: string, summaryClosing?: boolean }> = []
  const startedAt = new Date().toISOString()

  let stoppedMidSegment = false
  for (let index = 0; index < scenario.turns.length; index += 1) {
    if (options.shouldStop?.()) { stoppedMidSegment = true; break }
    const turn = scenario.turns[index]
    const now = turnAt(turn)
    const atLocal = localTime(now, story.setting.timezone)
    const record: TurnRecord = {
      seq: index + 1, kind: turn.kind, phase: turn.kind === 'advance' ? 'advance' : 'user-message',
      atISO: now.toISOString(), atLocal,
      dueIntentIds: acc.pendingIntents.filter(intent => intent.notBefore.getTime() <= now.getTime()).map(intent => intent.id),
      systemChars: 0, payloadChars: 0,
    }
    try {
      for (const memory of scriptedMemories(scenario, index, persona.id, story.id, participant.id)) {
        if (!acc.allMemories().some(existing => existing.id === memory.id)) acc.addMemory(memory)
      }
      const userMessage = turn.kind === 'user' ? resolveProfileText(turn.content, persona.id) : undefined
      if (turn.kind === 'user') {
        acc.pushUserMessage(userMessage!, now)
        record.userMessage = userMessage
      }
      participant.state.unreadMessageCount = acc.unreadMessageCount
      participant.state.pendingReplyCount = acc.pendingIntents.length
      participant.state.lastUserMessageAt = acc.lastUserMessageAt?.toISOString()
      participant.state.lastCharacterMessageAt = acc.lastCharacterMessageAt?.toISOString()

      const from = acc.lastOccurredAt() ?? new Date(now.getTime() - 60 * 60_000)
      const { payloadJson } = buildCompiledPayload({ story, participant, acc, plan: { phase: record.phase, now, from, ...(userMessage ? { userMessage } : {}) }, cacheFirst })
      const system = buildSystemPrompt(record.phase, slots, hasPerspective, writingOptions, specialty, cacheFirst)
      record.systemChars = system.length
      record.payloadChars = payloadJson.length
      if (index === 0) record.payloadKeys = Object.keys(JSON.parse(payloadJson)).sort()

      if (dry) {
        if (index < 2) {
          fs.appendFileSync(dryPreview, [
            `===== ${segment.id} turn ${index + 1} (${turn.kind} @ ${atLocal}) =====`,
            '--- system ---', system,
            '--- user payload ---', payloadJson,
            '', '',
          ].join('\n'))
        }
        records.push(record)
        sink.onTurn?.(segment.id, record, 'dry')
        continue
      }

      const result = await callModel(run!.target, { ...run!.options, system, user: payloadJson, jsonMode: true })
      record.latencyMs = result.latencyMs
      record.usage = result.usage
      record.rawResponse = result.raw

      const { decision, parseError } = parseDecision(result.raw)
      record.parseError = parseError
      if (parseError) record.checks = [{ id: 'H1', verdict: 'fail', detail: parseError }]
      if (decision) {
        record.parsed = {
          script: decision.script, seen: decision.seen, replyMode: decision.replyMode,
          replyContent: decision.replyContent, replySendAt: decision.replySendAt,
          followUpCommitment: decision.followUpCommitment, intentUpdates: decision.intentUpdates,
        }
        const { checks, metrics } = runChecks(decision, parseError, {
          arm: { id: variant.id, enRules: variant.lang === 'en', stress: variant.stress, sigs: variant.sigs },
          checks: profile.checks,
          userMessage,
          priorUserMessages: acc.allEntries.filter(e => e.kind === 'user-message').map(e => e.content),
          priorDeliveredMessages: acc.allEntries.filter(e => e.kind === 'character-message').map(e => e.content),
          nowLocal: atLocal,
          history: [...history],
        })
        record.checks = checks
        record.metrics = metrics as unknown as Record<string, unknown>
        history.push({ opener8: metrics.opener8, replyContent: decision.replyContent, summaryClosing: metrics.summaryClosing })

        if (decision.seen === true) acc.markSeen()
        if (decision.script.trim()) acc.pushScriptProse(decision.script, now)
        if (decision.replyMode === 'immediate' && decision.replyContent?.trim()) {
          acc.pushDeliveredMessage(decision.replyContent, now)
        } else if (decision.replyMode === 'delayed' && decision.replyContent?.trim() && decision.replySendAt) {
          const sendAt = new Date(decision.replySendAt)
          if (!Number.isNaN(sendAt.getTime())) acc.addDelayedReply(decision.replyContent, sendAt)
        }
        if (decision.followUpCommitment?.summary && decision.followUpCommitment.notBefore) {
          const notBefore = new Date(decision.followUpCommitment.notBefore)
          if (!Number.isNaN(notBefore.getTime())) {
            acc.addFollowUpCommitment(decision.followUpCommitment.kind ?? 'thinking', decision.followUpCommitment.summary, notBefore, decision.followUpCommitment.expiresAt)
          }
        }
        for (const update of decision.intentUpdates ?? []) {
          if (update.id !== undefined && (update.status === 'completed' || update.status === 'cancelled')) {
            acc.resolveIntent(update.id, update.status)
          }
        }
      }
    } catch (error) {
      record.error = (error as Error).message
    }
    records.push(record)
    sink.onTurn?.(segment.id, record)
  }

  if (dry) {
    if (records.some(record => record.error)) throw new Error(records.find(record => record.error)!.error)
    sink.onLog?.(`[${segment.id}] dry ${stoppedMidSegment ? '已停止' : '完成'}，预览 ${resultId}/dry-preview.txt`)
    return undefined
  }

  const summary = summarizeTurns(records, scenario.turns.length, stoppedMidSegment)
  const manifest: SegmentManifest = {
    segment: segment.id,
    profile: profile.meta.name,
    resultId,
    configHash: run!.configHash,
    cohort: run!.cohort,
    rubric: profile.rubric,
    variant: { id: variant.id, label: variant.label, presence: variant.presence, lang: variant.lang, styleHash: sha256(variant.slots.style ?? '') },
    scenario: { id: scenario.id, label: scenario.label, startISO: scenario.startISO, turnCount: scenario.turns.length },
    persona: { id: persona.id, characterName: persona.setting.character.name },
    engine: { protocol: run!.target.protocol, model, endpointHost: safeHost(run!.target.endpoint), samplingOff: env.samplingOff, maxTokens: run!.options.maxTokens },
    contract: { systemHash: run!.contractHash, payloadKeys: records[0]?.payloadKeys ?? [] },
    slots: Object.fromEntries(Object.entries(slots).filter(([, v]) => v !== undefined).map(([k, v]) => [k, sha256(v ?? '')])),
    ...(stoppedMidSegment ? { stopped: true } : {}),
    startedAt, finishedAt: new Date().toISOString(),
    totalTokens: records.reduce((sum, record) => sum + (record.usage?.totalTokens ?? 0), 0),
    ...summary,
  }
  fs.mkdirSync(outDir, { recursive: true })
  writeAtomic(path.join(outDir, 'turns.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n')
  writeAtomic(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  sink.onSegmentDone?.(segment, manifest)
  return resultId
}

// —— persona setting/story/participant 构造 ——

function buildStory(persona: ProfilePersona, now: Date): InterludeStory {
  return {
    id: `realism-${persona.id}`,
    platform: 'onebot',
    selfId: '10000',
    userId: '20001',
    channelId: 'private:20001',
    status: 'active' as const,
    setting: persona.setting,
    state: { schemaVersion: 5, settingOverlay: {}, narrativeUpdateCount: 0, automation: {} },
    cursorAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

function buildParticipant(persona: ProfilePersona, now: Date): InterludeParticipant {
  return {
    id: persona.participant.id,
    storyId: `realism-${persona.id}`,
    platform: 'onebot',
    selfId: '10000',
    userId: '20001',
    channelId: 'private:20001',
    personId: `person-${persona.id}-ache`,
    displayName: persona.participant.displayName,
    profile: persona.participant.profile,
    relationship: persona.participant.relationship,
    state: { openThreads: [], relationshipNotes: [], unreadMessageCount: 0, pendingReplyCount: 0 },
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  }
}

/** 场景脚本注入的派生记忆（按人物解析文本）。 */
function scriptedMemories(scenario: ProfileScenario, uptoIndex: number, personaId: string, storyId: string, participantId: string) {
  const out: Array<{ id: number, storyId: string, participantId: string, category: string, content: string, importance: number, status: string, sourceEntryId: number | null, createdAt: Date, updatedAt: Date }> = []
  let memId = 8000
  scenario.turns.slice(0, uptoIndex + 1).forEach(turn => {
    const memory = resolveProfileText(turn.memory, personaId)
    if (!memory?.trim()) return
    for (const line of memory.split('\n').filter(Boolean)) {
      const at = new Date(new Date(scenario.startISO).getTime() + turn.at * 60_000)
      out.push({
        id: memId++, storyId, participantId, category: 'scene-summary', content: line,
        importance: 0.6, status: 'active', sourceEntryId: null,
        createdAt: at, updatedAt: at,
      })
    }
  })
  return out
}

// —— 队列编排 ——

export interface SegmentState {
  id: string
  variant: string
  scenario: string
  persona?: string
  status: 'pending' | 'running' | 'done' | 'error' | 'stopped' | 'reused'
  resultId?: string
  turns?: { done: number, total: number }
  hFails?: Record<string, number>
  totalTokens?: number
  error?: string
}

export class Campaign {
  private states = new Map<string, SegmentState>()
  private running = false
  private stopRequested = false
  readonly date = new Date().toISOString().slice(0, 10)

  constructor(
    private readonly profile: Profile,
    private readonly env: EnvConfig,
    private readonly sink: ProgressSink,
    private readonly overrides?: RunOverrides,
  ) {}

  get profileName(): string {
    return this.profile.meta.name
  }

  get isRunning(): boolean {
    return this.running
  }

  get currentSegment(): string {
    return this.state().filter(state => state.status === 'running').map(state => state.id).join(' · ')
  }

  state(): SegmentState[] {
    return [...this.states.values()]
  }

  enqueue(segments: MatrixSegment[], reuse?: (segment: MatrixSegment) => ReturnType<typeof readResult>): void {
    for (const segment of segments) {
      // TBD 段（决策点未填）不入队——此前会在 runSegment 抛错记为 error。
      if (segment.variant === 'TBD') continue
      if (this.states.has(segment.id)) continue
      const result = reuse?.(segment)
      this.states.set(segment.id, {
        id: segment.id, variant: segment.variant, scenario: segment.scenario, persona: segment.persona ?? undefined,
        status: result ? 'reused' : 'pending',
        ...(result ? { resultId: result.resultId, turns: { done: result.turns.length, total: result.turns.length },
          hFails: result.manifest.hFails, totalTokens: result.manifest.totalTokens } : {}),
      })
    }
  }

  stop(): void {
    this.stopRequested = true
  }

  async run(dry: boolean, concurrency = 1): Promise<void> {
    if (this.running) throw new Error('campaign 已在运行中')
    this.running = true
    this.stopRequested = false
    try {
      const pending = [...this.states.values()].filter(state => state.status === 'pending')
      const segmentOf = (state: SegmentState) => this.profile.matrix.phases
        .flatMap(phase => phase.segments).find(segment => segment.id === state.id)!
      let cursor = 0
      const workers = Array.from({ length: Math.max(1, Math.min(concurrency, 3)) }, async () => {
        while (cursor < pending.length && !this.stopRequested) {
          const state = pending[cursor++]
          state.status = 'running'
          const segment = segmentOf(state)
          try {
            await runSegment(segment, { profile: this.profile, env: this.env, dry, sink: {
              onTurn: (segmentId, record) => {
                state.turns = { done: record.seq, total: scenarioTurns(this.profile, segment.id) }
                this.sink.onTurn?.(segmentId, record)
              },
              onSegmentDone: (_segment, manifest) => {
                // 轮级停止导致的截断段标记为 stopped（非完整段，不计 done）。
                state.status = manifest.status === 'stopped' ? 'stopped' : manifest.status === 'failed' ? 'error' : 'done'
                state.resultId = manifest.resultId
                if (state.status === 'error') state.error = `${manifest.errorTurns} 轮请求或解析失败`
                state.hFails = manifest.hFails
                state.totalTokens = manifest.totalTokens
                if (manifest.stopped) this.sink.onLog?.(`[${segment.id}] 停止请求：段在 ${state.turns?.done ?? '?'} 轮后截断`)
                this.sink.onSegmentDone?.(segment, manifest)
              },
              onSegmentError: (segment, message) => {
                state.status = 'error'
                state.error = message
                this.sink.onSegmentError?.(segment, message)
              },
              onLog: line => this.sink.onLog?.(line),
            }, overrides: this.overrides, date: this.date, shouldStop: () => this.stopRequested })
            if (state.status === 'running') state.status = this.stopRequested ? 'stopped' : 'done'
          } catch (error) {
            state.status = 'error'
            state.error = (error as Error).message
            this.sink.onSegmentError?.(segment, state.error)
          }
        }
      })
      await Promise.all(workers)
    } finally {
      if (this.stopRequested) {
        for (const state of this.states.values()) {
          if (state.status === 'pending' || state.status === 'running') state.status = 'stopped'
        }
      }
      this.running = false
    }
  }
}

function scenarioTurns(profile: Profile, segmentId: string): number {
  const segment = profile.matrix.phases.flatMap(phase => phase.segments).find(item => item.id === segmentId)
  const scenario = profile.scenarios.find(item => item.id === segment?.scenario)
  return scenario?.turns.length ?? 0
}

export function profileSegments(profile: Profile): MatrixSegment[] {
  return profile.matrix.phases.flatMap(phase => phase.segments)
}

