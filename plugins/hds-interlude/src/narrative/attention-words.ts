/**
 * I-7 生活关注词（设计 v2.4 §2 I-7 / §5 步骤 5——观察性产出）：
 * 由压缩器滚动维护的**有证据的派生索引**，模式对齐 Overlay。
 *
 * 本阶段为观察性产出：词集与命中记录先行可见，**不接门控、不接显著度**
 * （接入待回放确认质量后，见实施记录）。
 *
 * 证据边界（v2.3）：词的证据来源限定人物侧——角色设定、已发生的生活、
 * 明确表达的关切、有来源的剧情延续；**不从群内高频内容提炼**（防
 * "群里频繁谈论 → 变成她的关注 → 更频繁入场"的自增强回路）。
 *
 * 滞回状态机（v2.3 + F8 修正）：对外生效词集与候选滞回状态分别维护；每次
 * **成功压缩评估**推进状态（按批次去重，重试同一批材料视为同一次评估）；
 * 候选**连续**两轮提名晋升（本轮缺席即断档让位，非累计）；生效词缺席两轮
 * 或超过有效期（稳定 30 天 / 短期 7 天未确认）淘汰。模型按合约省略
 * attentionKeywords 字段或整批输出不合格时沿用旧集——不推进缺席、不消耗
 * 批次（"宁可旧、不可空"）。
 */
export interface AttentionWord {
  term: string
  /** 证据：来源条目（或简短依据）。 */
  sourceEntryIds?: number[]
  basis?: string
  lastConfirmedAt: string
  /** 稳定兴趣（长有效期）vs 短期关切（短有效期）——由产出方标注。 */
  stable?: boolean
}

/** F8：生效词有效期（天）——稳定兴趣 30 天 / 短期关切 7 天未获确认退出。 */
export const ATTENTION_STABLE_TTL_DAYS = 30
export const ATTENTION_SHORT_TTL_DAYS = 7

export interface AttentionCandidate {
  term: string
  nominations: number
  firstNominatedAt: string
  lastNominatedAt: string
  draft?: Omit<AttentionWord, 'term' | 'lastConfirmedAt'>
}

export interface AttentionWordState {
  version: 1
  effective: AttentionWord[]
  candidates: AttentionCandidate[]
  /** 生效词的缺席计数（未被最近提名）。 */
  absences: Record<string, number>
  /** 最近一次推进状态的评估批次标识（去重）。 */
  lastEvaluatedBatch?: string
  updatedAt: string
}

export const ATTENTION_WORD_LIMIT = 6
const TERM_MIN = 2
const TERM_MAX = 6
/** 停用词：口头禅/填充词/泛化词不做关注词。 */
const STOPWORDS = new Set(['哈哈', '哈哈哈', '嗯嗯', '好的', '可以', '知道', '什么', '怎么', '这样', '那个', '这个', '然后', '但是', '所以', '因为', '现在', '时候', '东西', '事情', '问题', '感觉'])

/** 本地防线（纯函数）：长度、去空白、去重、停用词。 */
export function sanitizeAttentionTerms(raw: unknown): Array<{ term: string, sourceEntryIds?: number[], basis?: string, stable?: boolean }> {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Array<{ term: string, sourceEntryIds?: number[], basis?: string, stable?: boolean }> = []
  for (const item of raw) {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : typeof item === 'string' ? { term: item } : {}
    const term = String(record.term ?? '').trim()
    if (term.length < TERM_MIN || term.length > TERM_MAX) continue
    if (STOPWORDS.has(term)) continue
    if (seen.has(term)) continue
    seen.add(term)
    out.push({
      term,
      ...(Array.isArray(record.sourceEntryIds) && record.sourceEntryIds.every(id => typeof id === 'number')
        ? { sourceEntryIds: (record.sourceEntryIds as number[]).slice(0, 8) } : {}),
      ...(typeof record.basis === 'string' && record.basis.trim() ? { basis: record.basis.trim().slice(0, 200) } : {}),
      ...(record.stable === true ? { stable: true } : {}),
    })
  }
  return out.slice(0, ATTENTION_WORD_LIMIT * 2)
}

/** 冷启动（现成结构，零模型调用）：角色名 + 明确别名 + 结构化兴趣 + 用户
 * 手填关键词——不从自由文本做名词抽取。 */
export function bootstrapAttentionWords(setting: { character?: { name?: unknown, aliases?: unknown } | string, interests?: unknown }, manualKeywords: string[] = []): AttentionWordState {
  const now = new Date().toISOString()
  const terms: string[] = []
  const character = typeof setting.character === 'object' ? setting.character as Record<string, unknown> : {}
  const name = String(character.name ?? (typeof setting.character === 'string' ? setting.character : '')).trim()
  if (name) terms.push(name)
  if (Array.isArray(character.aliases)) {
    for (const alias of character.aliases) {
      const value = String(alias ?? '').trim()
      if (value && !terms.includes(value)) terms.push(value)
    }
  }
  if (Array.isArray(setting.interests)) {
    for (const interest of setting.interests) {
      const value = String(interest ?? '').trim().slice(0, TERM_MAX)
      if (value.length >= TERM_MIN && !terms.includes(value)) terms.push(value)
    }
  }
  for (const keyword of manualKeywords) {
    const value = String(keyword ?? '').trim()
    if (value && !terms.includes(value)) terms.push(value)
  }
  const sanitized = sanitizeAttentionTerms(terms.slice(0, ATTENTION_WORD_LIMIT))
  return {
    version: 1,
    effective: sanitized.map(word => ({ ...word, lastConfirmedAt: now, stable: true })),
    candidates: [],
    absences: {},
    updatedAt: now,
  }
}

export interface AdvanceAttentionParams {
  /** 本轮压缩产出的原始词草稿（sanitize 前的 decision.attentionKeywords）。 */
  draft: unknown
  /** 评估批次标识（压缩批次/证据水位；同批重试不推进状态）。 */
  batchId: string
  now: Date
}

/** 滞回状态机推进（纯函数；同批去重、连续两轮晋升、两轮缺席/有效期淘汰、
 * 上限截断）。F8：draft 非数组（字段省略/非法形状）或整批不合格（非空
 * 输入全被防线过滤）时返回 previous——完全 no-op，不推进缺席也不消耗批次。 */
export function advanceAttentionWords(previous: AttentionWordState | undefined, params: AdvanceAttentionParams): AttentionWordState | undefined {
  if (previous?.lastEvaluatedBatch === params.batchId) return previous
  if (!Array.isArray(params.draft)) return previous
  const base: AttentionWordState = previous ?? { version: 1, effective: [], candidates: [], absences: {}, updatedAt: params.now.toISOString() }
  const sanitized = sanitizeAttentionTerms(params.draft)
  if (params.draft.length > 0 && sanitized.length === 0) return previous
  const proposedTerms = new Set(sanitized.map(word => word.term))
  const nowIso = params.now.toISOString()
  const nowMs = params.now.getTime()

  const effective: AttentionWord[] = []
  const absences: Record<string, number> = {}
  const candidates: AttentionCandidate[] = []
  // 第一步：处理现有生效词（在场刷新 / 缺席计数 / 两轮淘汰 / 有效期退出）。
  // 审计修正：有效期只约束"缺席分支"——本轮在场提名本身就是一次确认，
  // 先查 TTL 会把带着新鲜证据回归的过期词误删并降级为候选。
  for (const word of base.effective) {
    if (proposedTerms.has(word.term)) {
      const fresh = sanitized.find(item => item.term === word.term)!
      effective.push({ ...word, ...fresh, lastConfirmedAt: nowIso })
    } else {
      const ttlDays = word.stable ? ATTENTION_STABLE_TTL_DAYS : ATTENTION_SHORT_TTL_DAYS
      const confirmedAt = Date.parse(word.lastConfirmedAt)
      if (Number.isFinite(confirmedAt) && nowMs - confirmedAt > ttlDays * 86_400_000) continue
      const count = (base.absences[word.term] ?? 0) + 1
      if (count >= 2) continue // 缺席两轮 → 淘汰
      absences[word.term] = count
      effective.push(word)
    }
  }
  // 第二步：处理候选（连续两轮提名晋升——F8：本轮缺席即断档让位，非累计）。
  for (const candidate of base.candidates) {
    if (proposedTerms.has(candidate.term)) {
      const nominations = candidate.nominations + 1
      const fresh = sanitized.find(item => item.term === candidate.term)!
      if (nominations >= 2 && effective.length < ATTENTION_WORD_LIMIT) {
        effective.push({ ...candidate.draft, ...fresh, term: candidate.term, lastConfirmedAt: nowIso })
      } else {
        candidates.push({ ...candidate, nominations, lastNominatedAt: nowIso, draft: { ...candidate.draft, ...fresh } })
      }
    }
    // 本轮未提名 → 候选断档让位（A/B/A 不再累计晋升 A）。
  }
  // 第三步：新词入候选。
  for (const word of sanitized) {
    if (proposedTerms.has(word.term) && !effective.some(item => item.term === word.term) && !candidates.some(item => item.term === word.term)) {
      candidates.push({ term: word.term, nominations: 1, firstNominatedAt: nowIso, lastNominatedAt: nowIso, draft: word })
    }
  }
  return {
    version: 1,
    effective: effective.slice(0, ATTENTION_WORD_LIMIT),
    candidates: candidates.slice(0, ATTENTION_WORD_LIMIT * 2),
    absences,
    lastEvaluatedBatch: params.batchId,
    updatedAt: nowIso,
  }
}

/** 观察性命中检测：批次内容与生效词的匹配（不接门控，仅记录）。 */
export function matchAttentionWords(state: AttentionWordState | undefined, content: string): AttentionWord[] {
  if (!state?.effective.length || !content) return []
  const text = content.toLowerCase()
  return state.effective.filter(word => text.includes(word.term.toLowerCase()))
}
