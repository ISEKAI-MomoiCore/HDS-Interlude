/**
 * Jev 客户端（P3'）：TypeSafe AI 的 System One 决策模型。
 * 不生成文本，只回答结构化判断；本模块只用 Noul（是非）题型——
 * 返回 0-1 概率（概率即置信度，Noul 无独立 confidence 字段）。
 * 任何失败（网络/超时/解析）返回 undefined → 门控按 FALSE 直通（fail-open），
 * 考据永不阻塞对话。端点：POST {baseUrl}/v1/systemone，Bearer 认证。
 */
import type { ResearchHttpClient } from './search'

export interface JevConfig {
  enabled: boolean
  apiKey: string
  baseUrl: string
  /** 版本钉死（官方建议不用 jev-latest）。 */
  model: string
  /** Noul 概率阈值：≥ 阈值视为 TRUE。 */
  noulThreshold: number
  timeoutMs: number
}

export const DEFAULT_JEV_CONFIG: JevConfig = {
  enabled: false,
  apiKey: '',
  baseUrl: 'https://api.typesafe.ai',
  model: 'jev-1.13.0',
  noulThreshold: 0.6,
  timeoutMs: 2_500,
}

export function resolveJevConfig(value: unknown): JevConfig {
  const raw = (value ?? {}) as Partial<JevConfig>
  const merged: JevConfig = { ...DEFAULT_JEV_CONFIG, ...raw }
  merged.enabled = merged.enabled === true
  merged.apiKey = String(merged.apiKey ?? '').trim()
  merged.baseUrl = String(merged.baseUrl ?? '').trim().replace(/\/+$/, '') || DEFAULT_JEV_CONFIG.baseUrl
  merged.model = String(merged.model ?? '').trim() || DEFAULT_JEV_CONFIG.model
  merged.noulThreshold = Math.max(0.5, Math.min(0.95, Number(merged.noulThreshold) || 0.6))
  merged.timeoutMs = Math.max(500, Math.min(10_000, Number(merged.timeoutMs) || 2_500))
  return merged
}

/**
 * 一次 Noul 是非判断。questionId 由调用方命名（响应按 id 回填）；
 * state 为判断依据的结构化上下文（对象/字符串/数组皆可）。
 * 返回 0-1 概率；不可用/失败/形状不符 → undefined。
 */
export async function jevNoul(
  http: ResearchHttpClient,
  config: JevConfig,
  questionId: string,
  instructions: string,
  state: unknown,
): Promise<number | undefined> {
  if (!config.enabled || !config.apiKey) return undefined
  try {
    const response = await http.post(`${config.baseUrl}/v1/systemone`, {
      state,
      model: config.model,
      questions: { [questionId]: { type: 'noul', instructions } },
    }, {
      timeout: config.timeoutMs,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    }) as { nouls?: Record<string, { noul?: unknown }> }
    const noul = response?.nouls?.[questionId]?.noul
    const value = Number(noul)
    if (!Number.isFinite(value)) return undefined
    return Math.max(0, Math.min(1, value))
  } catch {
    return undefined
  }
}

/** 门控决策：概率存在且 ≥ 阈值才 TRUE；undefined/低置信一律 FALSE（直通）。 */
export function jevGateDecision(config: Pick<JevConfig, 'noulThreshold'>, noul: number | undefined): boolean {
  return typeof noul === 'number' && noul >= config.noulThreshold
}

/** 门控问题（P3' 固定措辞）：主角回应是否依赖可核验的具体现实细节。 */
export const JEV_NOUL_LOOKUP_INSTRUCTIONS = 'Based on the incoming chat message, the recent story tail and the already-verified facts, does the protagonist\u2019s response in this turn plausibly hinge on specific verifiable real-world details \u2014 an explicit lookup or web-search action by her, or concrete facts such as a named venue, the runtime of a named work, a commute between two named places, or opening hours of a specific place? Broad common knowledge, weather moods, generic places and anything reasonably improvisable do NOT count. Answer the probability that a real-world lookup is genuinely needed before writing her response.'
