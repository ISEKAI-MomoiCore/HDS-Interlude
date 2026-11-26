/**
 * 文风拟真度测试 · 决策解析、硬校验（H1-H11）与指标统计（设计文档 §7/§9）。
 *
 * H1-H6 沿用 test/model-behavior.test.ts 的检查思路并扩展；H7/H9/H10/H11 为
 * 本测试新增（跨轮重复 / 风格操纵检验 / transport mirror / 语言纪律）。
 * H8 是粗检：只标记明显时间越界，语义判断留给一审 gate 与二审。
 */

export interface ParsedDecision {
  script: string
  /** 模型把剧本写在 JSON 外（裸 prose）时的恢复标记。 */
  scriptRecovered?: boolean
  seen?: boolean
  replyMode?: string
  replyContent?: string
  replySendAt?: string
  followUpCommitment?: { kind?: string, summary?: string, notBefore?: string, expiresAt?: string, sourceEntryIds?: number[] }
  intentUpdates?: Array<{ id?: number, status?: string, resolution?: string }>
  raw: Record<string, unknown>
}

export type CheckVerdict = 'pass' | 'fail' | 'flag' | 'skip'

export interface CheckResult {
  id: string
  verdict: CheckVerdict
  detail?: string
}

export interface TurnMetrics {
  scriptLength: number
  bubbleCount: number
  bubbleLengths: number[]
  avgSentenceLength: number
  sentenceLengthStdev: number
  cjkRatioProse: number
  cjkRatioBubbles: number
  similePer1k: number
  psychVerbPer1k: number
  timeWordPer1k: number
  numeralPer1k: number
  ellipsisPer1k: number
  sceneHeadingHit: number
  summaryClosing: boolean
  /**
   * 总结式收尾在本段累计占比（含本轮）。跨轮指标：runChecks 结合 ctx.history
   * 计算，computeMetrics 本身只给逐轮的 summaryClosing。
   */
  summaryClosingRate: number
  opener8: string
}

/** 宽容 JSON 解析：剥 Markdown 围栏、截取首个平衡大括号对象。 */
export function parseDecision(raw: string): { decision?: ParsedDecision, parseError?: string } {
  let text = String(raw ?? '').trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const start = text.indexOf('{')
  if (start < 0) return { parseError: '响应中未找到 JSON 对象' }
  let depth = 0
  let end = -1
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) { end = index; break }
    }
  }
  if (end < 0) return { parseError: 'JSON 对象未闭合' }
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const interaction = isRecord(obj.interaction) ? obj.interaction : undefined
    const reply = interaction && isRecord(interaction.reply) ? interaction.reply : undefined
    // 合约漂移恢复：JSON 里缺 script，但 JSON 前有成段裸 prose —— 模型把剧本写在了
    // JSON 外面。恢复为 script 并打 scriptRecovered 标记（H1 记 flag 不记 fail），
    // 保留样本供评审，而不是把整轮剧本丢进空串。
    let script = typeof obj.script === 'string' ? obj.script : ''
    let scriptRecovered = false
    if (!script.trim()) {
      const before = text.slice(0, start).trim()
      if (before.length >= 40) { script = before; scriptRecovered = true }
    }
    return {
      decision: {
        script,
        ...(scriptRecovered ? { scriptRecovered } : {}),
        seen: interaction ? typeof interaction.seen === 'boolean' ? interaction.seen : undefined : undefined,
        replyMode: reply ? String(reply.mode ?? '') : undefined,
        replyContent: reply && typeof reply.content === 'string' ? reply.content : undefined,
        replySendAt: reply && typeof reply.sendAt === 'string' ? reply.sendAt : undefined,
        followUpCommitment: isRecord(obj.followUpCommitment) ? normalizeFollowUp(obj.followUpCommitment) : undefined,
        intentUpdates: Array.isArray(obj.intentUpdates) ? obj.intentUpdates.filter(isRecord).map(update => ({
          id: typeof update.id === 'number' ? update.id : undefined,
          status: typeof update.status === 'string' ? update.status : undefined,
          resolution: typeof update.resolution === 'string' ? update.resolution : undefined,
        })) : undefined,
        raw: obj,
      },
    }
  } catch (error) {
    return { parseError: `JSON 解析失败：${(error as Error).message}` }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeFollowUp(value: Record<string, unknown>): ParsedDecision['followUpCommitment'] {
  return {
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    summary: typeof value.summary === 'string' ? value.summary : undefined,
    notBefore: typeof value.notBefore === 'string' ? value.notBefore : undefined,
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : undefined,
    sourceEntryIds: Array.isArray(value.sourceEntryIds) ? value.sourceEntryIds.filter(id => typeof id === 'number') : undefined,
  }
}

// —— 指标计算 ——

const CJK_GLOBAL = /[\u4e00-\u9fff\u3400-\u4dbf]/g
const SIMILE = /(像|如同|仿佛|好似|宛如|恍如)/g
const PSYCH_VERB = /(知道|明白|意识到|觉得|感到|想起|心想|想到|明白过来|意识到自己)/g
const TIME_WORD = /(分钟|小时|第\d+|三分钟|几秒|半小时|一刻钟|凌晨|清晨|早晨|上午|中午|下午|傍晚|晚上|深夜|今夜|明天|后天|昨天)/g
const NUMERAL = /\d+/g
const ELLIPSIS = /(……|\.\.\.|…)/g
const SCENE_HEADING = /(内景|外景)[·•\s]|^日\/夜|·夜·|·日·/m

function per1k(text: string, matches: number): number {
  const len = Math.max(1, text.length)
  return Math.round(matches / len * 1000 * 100) / 100
}

function cjkRatio(text: string): number {
  const chars = text.replace(/\s/g, '')
  if (!chars) return 0
  const cjk = chars.match(CJK_GLOBAL)?.length ?? 0
  return Math.round(cjk / chars.length * 100) / 100
}

export function computeMetrics(script: string, replyContent: string | undefined): TurnMetrics {
  const prose = String(script ?? '')
  const bubbles = replyContent ? replyContent.split('<sep/>').map(b => b.trim()).filter(Boolean) : []
  const sentences = prose.split(/[。！？!?\n]+/).map(s => s.trim()).filter(Boolean)
  const lengths = sentences.map(s => s.length)
  const avg = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0
  const stdev = lengths.length > 1
    ? Math.round(Math.sqrt(lengths.reduce((sum, len) => sum + (len - avg) ** 2, 0) / lengths.length))
    : 0
  // 收尾词可带句末标点/引号：散文末尾几乎总有 。""，原始的 `$` 裸锚点因此从不命中。
  const closers = /(总之|想来|大概就是这样|也许这就是|这大概|想来也是|就这样吧)[。！？!?…"”’」』）)\s]*$/
  return {
    scriptLength: prose.length,
    bubbleCount: bubbles.length,
    bubbleLengths: bubbles.map(b => b.length),
    avgSentenceLength: avg,
    sentenceLengthStdev: stdev,
    cjkRatioProse: cjkRatio(prose),
    cjkRatioBubbles: bubbles.length ? cjkRatio(bubbles.join('')) : cjkRatio(replyContent ?? ''),
    similePer1k: per1k(prose, prose.match(SIMILE)?.length ?? 0),
    psychVerbPer1k: per1k(prose, prose.match(PSYCH_VERB)?.length ?? 0),
    timeWordPer1k: per1k(prose, prose.match(TIME_WORD)?.length ?? 0),
    numeralPer1k: per1k(prose, prose.match(NUMERAL)?.length ?? 0),
    ellipsisPer1k: per1k(prose, prose.match(ELLIPSIS)?.length ?? 0),
    sceneHeadingHit: SCENE_HEADING.test(prose) ? 1 : 0,
    summaryClosing: closers.test(prose.trim().slice(-24)),
    summaryClosingRate: closers.test(prose.trim().slice(-24)) ? 1 : 0,
    opener8: prose.replace(/\s/g, '').slice(0, 8),
  }
}

// —— 硬校验（设计文档 §7） ——

export interface CheckContext {
  arm: { id: string, enRules?: boolean, stress?: boolean, sigs?: Array<{ metric: string, op: '<=' | '>=', value: number }> }
  /** profile.checks：builtin 开关（H1/H2 锁定不可关；'auto' 按语言模式）+ custom 执行器。 */
  checks?: { builtin?: Record<string, boolean | 'auto'>, custom?: Array<{ id: string, kind: string, pattern?: string, flags?: string, metric?: string, op?: string, value?: number, severity?: string, note?: string }> }
  userMessage?: string
  /** 本段此前所有用户消息（H5 回忆白名单：剧本引用此前真实发言不是编造）。 */
  priorUserMessages?: string[]
  /** 本段此前主角已发出的消息（回忆白名单的另一来源）。 */
  priorDeliveredMessages?: string[]
  nowLocal: string
  /** 本段此前所有轮的 metrics（H7 跨轮重复、summaryClosingRate 累计用）。 */
  history: Array<{ opener8: string, replyContent?: string, summaryClosing?: boolean }>
}

export function runChecks(decision: ParsedDecision, parseError: string | undefined, ctx: CheckContext): { checks: CheckResult[], metrics: TurnMetrics } {
  const checks: CheckResult[] = []
  const script = decision.script
  const content = decision.replyContent
  const metrics = computeMetrics(script, content)

  // summaryClosingRate：本段迄今的累计占比（历史 + 本轮）。逐轮值由 computeMetrics
  // 作为 0/1 给出，此处按 history 覆盖为跨轮比率——否则 H9 的 `<= 0.1` 恒真。
  const priorTurns = ctx.history.length
  const priorClosers = ctx.history.filter(prev => prev.summaryClosing === true).length
  metrics.summaryClosingRate = Math.round(
    (priorClosers + (metrics.summaryClosing ? 1 : 0)) / (priorTurns + 1) * 1000,
  ) / 1000

  /** builtin 开关：H1/H2 锁定（输出可消费性，不可关）；undefined 默认开；false 关。 */
  const builtinEnabled = (id: string, locked = false): boolean => {
    if (locked) return true
    const setting = ctx.checks?.builtin?.[id]
    return setting === undefined || setting === 'auto' || setting === true
  }

  const fail = (id: string, detail: string) => checks.push({ id, verdict: 'fail', detail })
  const flag = (id: string, detail: string) => checks.push({ id, verdict: 'flag', detail })
  const pass = (id: string) => checks.push({ id, verdict: 'pass' })
  const skip = (id: string) => checks.push({ id, verdict: 'skip' })
  /** 门控包装：关闭的检查记录为 skip（报告可区分"关"与"过"）。 */
  const gated = (id: string, locked: boolean, run: (report: { fail: typeof fail, flag: typeof flag, pass: typeof pass }) => void) => {
    if (!builtinEnabled(id, locked)) return skip(id)
    run({ fail, flag, pass })
  }

  // H1 结构契约（scriptRecovered = 模型合约漂移的裸 prose 恢复 → flag 保留信号）
  if (parseError) {
    fail('H1', parseError)
  } else if (!script.trim()) {
    fail('H1', 'script 为空')
  } else if (decision.scriptRecovered) {
    flag('H1', 'script 字段缺失，已从裸 prose 恢复（模型合约漂移，样本保留）')
  } else if (decision.seen !== undefined && typeof decision.seen !== 'boolean') {
    fail('H1', `seen 不是 boolean（${JSON.stringify(decision.seen)}）`)
  } else if (decision.replyMode !== undefined && !['none', 'immediate', 'delayed'].includes(decision.replyMode)) {
    fail('H1', `reply.mode 非法（${decision.replyMode}）`)
  } else {
    pass('H1')
  }

  // H2 mode/content/sendAt 一致性
  if (parseError) checks.push({ id: 'H2', verdict: 'skip' })
  else if (decision.replyMode === 'immediate' && !content?.trim()) fail('H2', 'immediate 但 content 为空')
  else if (decision.replyMode === 'delayed' && !decision.replySendAt) fail('H2', 'delayed 但缺 sendAt')
  else if (decision.replyMode === 'delayed' && Number.isNaN(Date.parse(decision.replySendAt!))) fail('H2', `sendAt 不是合法时间（${decision.replySendAt}）`)
  else if (decision.replyMode === 'none' && content?.trim()) fail('H2', 'none 但携带 content')
  else pass('H2')

  // H3 泄漏检查
  gated('H3', false, ({ fail, pass }) => {
    if (parseError) return skip('H3')
    const leaks: string[] = []
    if (content) {
      if (/<say\b/i.test(content)) leaks.push('content 含 <say 标记')
      if (/```/.test(content)) leaks.push('content 含 Markdown 围栏')
      if (/\b(lifeHandoff|intentUpdates|followUpCommitment|scriptBinding)\b/.test(content)) leaks.push('content 泄漏字段名')
    }
    if (leaks.length) fail('H3', leaks.join('；'))
    else pass('H3')
  })

  // H4 分隔符卫生
  gated('H4', false, ({ fail, pass }) => {
    if (parseError || !content) return skip('H4')
    const seps = content.match(/<sep\/?>/g)?.length ?? 0
    if (content.startsWith('<sep/>') || content.endsWith('<sep/>') || /<sep\/>\s*<sep\/>/.test(content)) fail('H4', '分隔符位于首尾或连续')
    else if (seps + 1 > 6) fail('H4', `分泡数 ${seps + 1} 超过 6`)
    else pass('H4')
  })

  // H5 幻觉（电话号码 / 未知具名第三方发言）——英文变体切英文模式。
  // 收紧：编造发言的真实形态是「具名主体 + 言语动词 + 引号引语」——三段都要，
  // 动词本身排除在前缀类外（否则 {1,6} 会吞掉 说/问 制造伪前缀）。
  // 引语内容与此段此前任一用户消息相符 → 合法回忆，放行（逐轮正则看不到历史）。
  gated('H5', false, ({ fail, pass }) => {
    if (parseError) return skip('H5')
    const phone = /1[3-9]\d{9}/
    if (phone.test(script) && !(ctx.userMessage && phone.test(ctx.userMessage))) fail('H5', '剧本出现未提供的电话号码')
    const invented = ctx.arm.enRules
      ? /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*(?:said|asked|replied|texted)\s*[:：]?\s*["“”]([^"”]{1,60})/.exec(script)
      : /([^\s你她他我它说问回复被,，。.:“”‘’"「」『』]{1,4})(?:说|问|回复|发来|发消息|发了一句)\s*[:：]?\s*["“「『]([^"”」』]{1,60})/.exec(script)
    if (invented && !isWhitelistedSpeaker(invented[1], ctx)) {
      const quoted = invented[2]?.trim()
      const recallSources = [...(ctx.priorUserMessages ?? []), ...(ctx.priorDeliveredMessages ?? [])]
      const isRecall = !!quoted && recallSources.some(msg => msg.includes(quoted))
      const GENERIC = ['有人', '有些人', '大家', '别人', '人们', '他们', '她们', '谁都']
      const isGeneric = GENERIC.some(g => invented[1] === g || invented[1].endsWith(g))
      if (isRecall || isGeneric) pass('H5')
      else fail('H5', `疑似编造第三方发言：${invented[1]}…（引语"${invented[2]?.slice(0, 24)}"不在既有发言中）`)
    } else pass('H5')
  })

  // H6 无证据入站事件——英文变体切英文模式
  gated('H6', false, ({ flag, pass }) => {
    if (parseError) return skip('H6')
    const pattern = ctx.arm.enRules
      ? /(phone (?:vibrat|buzz)|notification (?:popped|arrived)|message (?:arrived|popped up))/
      : /(手机震动|手机嗡嗡|通知弹|弹出通知|新消息提示)/
    if (pattern.test(script) && !ctx.userMessage) flag('H6', 'advance/无事件轮出现疑似无证据入站描写')
    else pass('H6')
  })

  // H7 跨轮重复
  gated('H7', false, ({ fail, flag, pass }) => {
    if (parseError) return skip('H7')
    const dup = ctx.history.some(prev => prev.replyContent && prev.replyContent === content)
    if (dup) return fail('H7', '回复内容与本段此前某轮完全相同')
    if (ctx.history.length >= 4) {
      const openerCounts = new Map<string, number>()
      for (const prev of ctx.history) openerCounts.set(prev.opener8, (openerCounts.get(prev.opener8) ?? 0) + 1)
      const sameOpener = (openerCounts.get(metrics.opener8) ?? 0) + 1
      if (metrics.opener8 && sameOpener / (ctx.history.length + 1) > 0.6) return flag('H7', `剧本开头 8 字重复率 ${(sameOpener / (ctx.history.length + 1) * 100).toFixed(0)}%`)
    }
    pass('H7')
  })

  // H8 时间越界粗检（只标记，语义判断留给评审）
  gated('H8', false, ({ flag, pass }) => {
    if (parseError) return skip('H8')
    const nowClock = ctx.nowLocal.slice(11, 16)
    const clockRefs = script.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) ?? []
    // 补零后再比：'9:30' > '20:02' 在字符串比较里为真，会误报。
    const future = clockRefs.filter(ref => ref.padStart(5, '0') > nowClock)
    if (future.length) flag('H8', `剧本出现晚于 nowLocal(${nowClock}) 的时刻 ${future.join(',')}（可能合法：如约定时间）`)
    else pass('H8')
  })

  // H9 风格操纵检验
  gated('H9', false, ({ flag, pass }) => {
    const sigs = ctx.arm.sigs ?? []
    if (!sigs.length) return skip('H9')
    const misses = sigs.filter(sig => sig.op === '<=' ? !(metricValue(metrics, sig.metric) <= sig.value) : !(metricValue(metrics, sig.metric) >= sig.value))
    if (misses.length) flag('H9', `风格未生效候选：${misses.map(sig => `${sig.metric}=${metricValue(metrics, sig.metric)}（期望${sig.op}${sig.value}）`).join('；')}`)
    else pass('H9')
  })

  // H10 transport mirror 完整性
  gated('H10', false, ({ fail, flag, pass }) => {
    if (parseError || !content) return skip('H10')
    const saySpans = [...script.matchAll(/<say\b[^>]*>([\s\S]*?)<\/say>/g)].map(match => match[1].trim())
    if (!saySpans.length) return flag('H10', '未在剧本中找到 <say> 标记（legacy content 路径，仅观察）')
    const norm = (v: string) => v.replace(/<sep\/?>/g, '\n').replace(/\s+/g, '')
    const mirror = saySpans.some(span => norm(span).includes(norm(content)) || norm(content).includes(norm(span)))
    if (mirror) pass('H10')
    else if (ctx.arm.enRules) fail('H10', `reply.content 与 <say> 不一致（say=${saySpans.map(s => s.slice(0, 40)).join('|')}）`)
    else flag('H10', `reply.content 与 <say> 疑似不一致（say=${saySpans.map(s => s.slice(0, 40)).join('|')}）`)
  })

  // H11 语言纪律（仅英文叙述变体）
  gated('H11', false, ({ fail, pass }) => {
    if (!ctx.arm.enRules || parseError) return skip('H11')
    const issues: string[] = []
    if (metrics.cjkRatioProse > 0.15) issues.push(`prose CJK 占比 ${metrics.cjkRatioProse}（期望 ≤0.15）`)
    if (content && metrics.cjkRatioBubbles < 0.8) issues.push(`气泡 CJK 占比 ${metrics.cjkRatioBubbles}（期望 ≥0.8）`)
    if (issues.length) fail('H11', issues.join('；'))
    else pass('H11')
  })

  // 自定义检查（profile.checks.custom）：regex-prose / regex-bubble / metric
  for (const check of ctx.checks?.custom ?? []) {
    const severity = check.severity === 'fail' ? fail : flag
    try {
      if (check.kind === 'regex-prose' && check.pattern) {
        const hit = new RegExp(check.pattern, check.flags ?? '').test(script)
        if (hit) severity(check.id, `自定义正则命中剧本${check.note ? `：${check.note}` : ''}`)
        else pass(check.id)
      } else if (check.kind === 'regex-bubble' && check.pattern) {
        if (!content) {
          skip(check.id)
          continue
        }
        const hit = new RegExp(check.pattern, check.flags ?? '').test(content)
        if (hit) severity(check.id, `自定义正则命中气泡${check.note ? `：${check.note}` : ''}`)
        else pass(check.id)
      } else if (check.kind === 'metric' && check.metric && check.op && typeof check.value === 'number') {
        const value = metricValue(metrics, check.metric)
        const ok = check.op === '<=' ? value <= check.value : value >= check.value
        if (!ok) severity(check.id, `${check.metric}=${value}（期望${check.op}${check.value}）${check.note ?? ''}`)
        else pass(check.id)
      } else {
        skip(check.id)
      }
    } catch (error) {
      flag(check.id, `自定义检查执行失败：${(error as Error).message}`)
    }
  }

  return { checks, metrics }
}

function metricValue(metrics: TurnMetrics, metric: string): number {
  const value = (metrics as unknown as Record<string, unknown>)[metric]
  return typeof value === 'number' ? value : 0
}

/** H5 白名单：前缀（具名主体候选）为指称/用户消息已知主体时不算编造（沿用 model-behavior.test.ts Fix P4）。 */
function isWhitelistedSpeaker(prefix: string, ctx: CheckContext): boolean {
  const NARRATION_OR_KNOWN = ['她', '他', '你', '我', '它', '朋友', '主角', '对方', '用户', '这人', '那人',
    '倒是', '直接', '还是', '又', '再', '便', '就', '才', '只', '也', '先', '没', '不',
    '开口', '笑着', '忍不住', '随口', '顺口', '轻声', '低声', '小声', '想了想']
  if (ctx.userMessage?.includes(prefix.slice(0, 2))) return true
  return NARRATION_OR_KNOWN.some(word => prefix === word || prefix.endsWith(word))
}
