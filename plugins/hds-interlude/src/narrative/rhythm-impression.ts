/**
 * II-1 交往节奏印象（设计 v2.4 §4 II-1，仅私聊）：把双方经历过的交往
 * 节奏概括为一句轻量事实，如"最近她主动开启话题的 4 次里，对方多在稍后
 * 接上（中位约 12 分钟）"。
 *
 * 采样口径（论文透镜的本地化，统计摘要与主观关系印象分开维护——本模块
 * 只产出系统侧统计摘要；她如何看待这段节奏由剧本写出）：
 * - 开场 = 她已确认送达的私聊消息（character-message 行仅在投递成功后
 *   落库，存在即已送达），且此前双方安静 ≥ 30 分钟（多气泡间隔远小于
 *   阈值，天然只计首条）；
 * - 承接 = 开场后对方的首条私聊消息（同 participantId 查询即归属确认）；
 *   开场与承接之间夹着她自己的又一次开场（安静 ≥ 阈值的追问）时归属含混，
 *   不计入中位数、单独计数；连发气泡属同一开场单元，不影响归属；
 * - 24 小时内无回应的近期待定开场单独记录（识别仅统计已回应样本的选择
 *   偏差）；更久未回应的开场视为已定格的过往，不再催动；
 * - 响应样本 ≥ 3 才产出印象，中位数三档描述，不足时保留空缺不注入。
 *
 * 常量起步硬编码（对齐 I-1~I-4 惯例），回放验证后再调。
 */

/** 开场识别的双边安静阈值（毫秒）。 */
export const RHYTHM_QUIET_THRESHOLD_MS = 30 * 60_000
/** 采样查询窗口（每位参与者最近条目数，service 侧查询 limit）。 */
export const RHYTHM_SAMPLE_WINDOW = 120
/** 产出印象所需的最小已承接样本量。 */
export const RHYTHM_MIN_SAMPLES = 3
/** 待定开场的观察视界（毫秒）：更久未回应的开场不再计入待定。 */
export const RHYTHM_PENDING_HORIZON_MS = 24 * 60 * 60_000

export interface RhythmSampleEntry {
  kind: 'user-message' | 'character-message'
  occurredAt: Date
}

export interface RhythmSampleResult {
  /** 已承接开场的响应延迟（毫秒，升序）。 */
  respondedLatenciesMs: number[]
  /** 归属含混（开场与承接之间夹着她自己的消息）的样本数。 */
  ambiguous: number
  /** 近期（视界内）发起后尚未等到回应的开场数。 */
  pending: number
  /** 窗口内识别到的开场总数。 */
  openings: number
}

/**
 * 从窗口内私聊条目采样交往节奏。条目顺序任意（内部按时间升序归一）；
 * 窗口最旧一条的"此前安静"不可知，保守不计为开场。
 */
export function sampleInteractionRhythm(
  entries: RhythmSampleEntry[],
  now: Date,
  options: { quietThresholdMs?: number, pendingHorizonMs?: number } = {},
): RhythmSampleResult {
  const quietThreshold = options.quietThresholdMs ?? RHYTHM_QUIET_THRESHOLD_MS
  const pendingHorizon = options.pendingHorizonMs ?? RHYTHM_PENDING_HORIZON_MS
  const sorted = [...entries].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
  const result: RhythmSampleResult = { respondedLatenciesMs: [], ambiguous: 0, pending: 0, openings: 0 }
  for (let index = 0; index < sorted.length; index++) {
    const entry = sorted[index]
    if (entry.kind !== 'character-message') continue
    // 开场需要可见的"此前安静"：窗口边缘的最早一条无法证明安静过。
    if (index === 0) continue
    const quietMs = entry.occurredAt.getTime() - sorted[index - 1].occurredAt.getTime()
    if (quietMs < quietThreshold) continue
    result.openings += 1
    // 向后找承接：对方首条消息。她自己的中间消息若本身构成新开场
    // （安静 ≥ 阈值，如隔了很久的追问）则归属含混；连发气泡间隔远小于
    // 阈值，属同一开场单元，不污染归属。
    let responded = false
    let mixed = false
    for (let next = index + 1; next < sorted.length; next++) {
      if (sorted[next].kind === 'user-message') {
        if (mixed) result.ambiguous += 1
        else result.respondedLatenciesMs.push(sorted[next].occurredAt.getTime() - entry.occurredAt.getTime())
        responded = true
        break
      }
      if (sorted[next].occurredAt.getTime() - sorted[next - 1].occurredAt.getTime() >= quietThreshold) mixed = true
    }
    if (!responded && now.getTime() - entry.occurredAt.getTime() <= pendingHorizon) result.pending += 1
  }
  result.respondedLatenciesMs.sort((left, right) => left - right)
  return result
}

/** 中位时长的人读格式（II-4 状态命令与印象渲染共用）。 */
export function formatMedianDuration(ms: number): string {
  if (ms < 60_000) return '中位不到 1 分钟'
  if (ms < 3_600_000) return `中位约 ${Math.max(1, Math.round(ms / 60_000))} 分钟`
  const hours = ms / 3_600_000
  return `中位约 ${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} 小时`
}

/**
 * 渲染一句节奏印象。样本不足（< 3）或无开场时返回 undefined——证据不足
 * 保留空缺，不用模糊措辞冒充经验。
 */
export function renderInteractionRhythm(
  result: RhythmSampleResult,
  options: { minSamples?: number } = {},
): string | undefined {
  const minSamples = options.minSamples ?? RHYTHM_MIN_SAMPLES
  const samples = result.respondedLatenciesMs
  if (samples.length < minSamples) return undefined
  const median = samples[Math.floor(samples.length / 2)]
  const bucket = median <= 5 * 60_000
    ? '通常很快接上'
    : median <= 60 * 60_000
      ? '多在稍后接上'
      : '常在较长间隔后续上'
  const pending = result.pending > 0 ? `；另有 ${result.pending} 次发起后尚未等到回应` : ''
  return `最近她主动开启话题的 ${samples.length} 次里，对方${bucket}（${formatMedianDuration(median)}）${pending}。`
}
