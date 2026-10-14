import { h } from 'koishi'

export interface ForwardReadLimits {
  maxNodes: number
  maxCharacters: number
  maxDepth: number
}

export interface ForwardReadResult {
  content: string
  nodeCount: number
  forwardCount: number
  truncated: boolean
  failed: boolean
  /** 整体拉取失败的原因（模块保持零依赖，日志由调用方记录）。 */
  cause?: string
  /** 嵌套合并转发读取失败次数（>0 时正文以占位符降级，调用方记 warn）。 */
  nestedFailed?: number
  /** 合并转发节点内图片的可加载引用（http CDN URL → onebot-url: 前缀；
   * 仅有 file token 时 → onebot-file: 前缀，由 fetchNativeImage 经
   * bot.getImage 解析）。正文仍保留 [图片] 占位符——refs 进视觉管线，
   * 占位符进文本事实，两者职责分离。有界，与视觉管线 slice(0,3) 对齐。 */
  imageRefs: string[]
}

export async function readForwardContent(session: any, limits: Partial<ForwardReadLimits> = {}): Promise<ForwardReadResult | undefined> {
  const ids = extractForwardIds(session?.content)
  if (!ids.length) return undefined
  const budget = forwardReadLimits(limits)
  const internal = session?.bot?.internal
  if (typeof internal?._request !== 'function') return { ...failureResult(), cause: '适配器不支持 get_forward_msg' }
  const state = { nestedFailed: 0 }
  try {
    const nodes = await fetchForwardNodes(internal, ids[0], budget, 0, state)
    const result = normalizeForwardMessages(nodes, budget)
    const imageRefs = collectForwardImageRefs(nodes, FORWARD_IMAGE_REF_LIMIT)
    const withRefs = { ...result, imageRefs }
    return state.nestedFailed ? { ...withRefs, nestedFailed: state.nestedFailed } : withRefs
  } catch (error) {
    return { ...failureResult(), cause: error instanceof Error ? error.message : String(error) }
  }
}

/** 合并转发图片引用收集上限：覆盖"转发里最多想看几张"，下游视觉管线另有
 * slice(0,3) 的每回合预算；这里多收一些供群聊历史引用（groupImageRefs）留存。 */
const FORWARD_IMAGE_REF_LIMIT = 6

/** 从节点树收集图片可加载引用。URL 来自 OneBot 服务端（get_forward_msg 响应），
 * 与 extractSessionImageSources 的 CQ 分支同信任级——用 onebot-url:/onebot-file:
 * 前缀，跳过 fetchNativeImage 的受信主机检查并保留 file token 解析路径。 */
function collectForwardImageRefs(nodes: unknown[], limit: number): string[] {
  const refs: string[] = []
  const seen = new Set<string>()
  const push = (value: unknown, prefix: 'onebot-url:' | 'onebot-file:') => {
    const source = String(value ?? '').trim()
    if (!source || seen.has(source) || refs.length >= limit) return
    seen.add(source)
    refs.push(prefix + source)
  }
  const visitSegments = (segments: unknown[]) => {
    for (const raw of segments) {
      const segment = asRecord(raw)
      if (String(segment.type ?? '').toLowerCase() !== 'image') continue
      const data = asRecord(segment.data)
      const url = String(data.url ?? data.cache_url ?? '').trim()
      if (/^https?:\/\//i.test(url)) push(url, 'onebot-url:')
      else push(String(data.file ?? '').trim(), 'onebot-file:')
    }
  }
  const visitNodes = (list: unknown[], depth: number) => {
    if (depth > 4) return
    for (const raw of list) {
      const node = asRecord(raw)
      if (Array.isArray(node.message)) visitSegments(node.message)
      if (Array.isArray(node.content)) {
        for (const item of node.content) {
          const contentNode = asRecord(item)
          if (Array.isArray(contentNode.message)) visitSegments(contentNode.message)
          if (Array.isArray(contentNode.content)) visitNodes(contentNode.content, depth + 1)
        }
      }
    }
  }
  visitNodes(nodes, 0)
  return refs
}

function failureResult(): ForwardReadResult {
  return { content: '[收到一条合并转发消息，但暂时无法读取内容]', nodeCount: 0, forwardCount: 0, truncated: false, failed: true, imageRefs: [] }
}

async function fetchForwardNodes(internal: any, id: string, limits: ForwardReadLimits, depth: number, state: { nestedFailed: number }): Promise<any[]> {
  const response = await withTimeout(Promise.resolve(internal._request('get_forward_msg', { id })), 30_000)
  if (response?.retcode != null && Number(response.retcode) !== 0) throw new Error(String(response.wording || response.message || `retcode=${response.retcode}`))
  if (response?.status && response.status !== 'ok') throw new Error(String(response.wording || response.message || response.status))
  const data = response?.data ?? response
  const messages = Array.isArray(data?.messages) ? data.messages : []
  if (!messages.length) return []
  if (depth >= limits.maxDepth) return messages
  let remaining = limits.maxNodes
  for (const node of messages) {
    if (remaining-- <= 0) break
    const segments = Array.isArray(node?.message) ? node.message : []
    for (const segment of segments) {
      if (!segment || typeof segment !== 'object' || String(segment.type ?? '').toLowerCase() !== 'forward') continue
      const data = segment.data && typeof segment.data === 'object' ? segment.data : {}
      const nestedId = String(data.id ?? data.res_id ?? data.forward_id ?? '').trim()
      if (!nestedId) continue
      try {
        const nested = await fetchForwardNodes(internal, nestedId, limits, depth + 1, state)
        const normalized = normalizeForwardMessages(nested, { ...limits, maxNodes: Math.min(limits.maxNodes, 10) }, depth + 1)
        segment.type = 'text'
        segment.data = { text: normalized.content }
      } catch {
        // 记录失败次数——正文降级为占位符，但不再对调用方完全不可见。
        state.nestedFailed += 1
        segment.type = 'text'
        segment.data = { text: `[嵌套合并转发读取失败｜资源 ${nestedId}]` }
      }
    }
  }
  return messages
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

const DEFAULT_LIMITS: ForwardReadLimits = { maxNodes: 30, maxCharacters: 8_000, maxDepth: 3 }

export function forwardReadLimits(value?: Partial<ForwardReadLimits>): ForwardReadLimits {
  return {
    maxNodes: clampInt(value?.maxNodes, 1, 100, DEFAULT_LIMITS.maxNodes),
    maxCharacters: clampInt(value?.maxCharacters, 500, 32_000, DEFAULT_LIMITS.maxCharacters),
    maxDepth: clampInt(value?.maxDepth, 0, 8, DEFAULT_LIMITS.maxDepth),
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

export function extractForwardIds(content: unknown): string[] {
  const raw = String(content ?? '')
  const ids: string[] = []
  const add = (value: unknown) => {
    const id = String(value ?? '').trim()
    if (id && id.length <= 512 && !ids.includes(id)) ids.push(id)
  }
  const visit = (element: any) => {
    if (!element) return
    if (String(element.type ?? '').toLowerCase() === 'forward') {
      const attrs = { ...(element.attrs ?? {}), ...(element.data ?? {}) }
      add(attrs.id ?? attrs.res_id ?? attrs.forward_id)
    }
    for (const child of element.children ?? []) visit(child)
  }
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  for (const match of raw.matchAll(/\[CQ:forward,([^\]]+)\]/gi)) {
    const fields: Record<string, string> = {}
    for (const field of match[1].split(',')) {
      const index = field.indexOf('=')
      if (index > 0) fields[field.slice(0, index).trim().toLowerCase()] = field.slice(index + 1).trim()
    }
    add(fields.id ?? fields.res_id ?? fields.forward_id)
  }
  return ids
}

export function normalizeForwardMessages(messages: unknown[], limits: Partial<ForwardReadLimits> = {}, depth = 0): ForwardNormalized {
  const budget = forwardReadLimits(limits)
  const lines: string[] = [`[合并转发内容｜节点数 ${messages.length}]`]
  let used = lines[0].length
  let nodeCount = 0
  let forwardCount = 0
  let truncated = false
  let failed = false
  const append = (value: string) => {
    const remaining = budget.maxCharacters - used
    if (remaining <= 0) { truncated = true; return false }
    const clipped = value.length > remaining ? `${value.slice(0, Math.max(0, remaining - 5))}[截断]` : value
    lines.push(clipped); used += clipped.length + 1
    if (clipped !== value) truncated = true
    return clipped === value
  }
  for (const rawNode of messages) {
    if (nodeCount >= budget.maxNodes) { truncated = true; break }
    const node = asRecord(rawNode)
    nodeCount++
    const sender = String(node.nickname ?? (node.sender && asRecord(node.sender).nickname) ?? node.user_id ?? '未知发送者').trim() || '未知发送者'
    const userId = String(node.user_id ?? (node.sender && asRecord(node.sender).user_id) ?? '').trim()
    const label = userId ? `${sender}（${userId}）` : sender
    const type = String(node.message_type ?? '').trim()
    append(`[节点 ${nodeCount}｜${label}${type ? `｜${type}` : ''}]`)
    const segments = Array.isArray(node.message) ? node.message : []
    const body = normalizeForwardSegments(segments, budget, depth)
    forwardCount += body.forwardCount
    failed ||= body.failed
    for (const line of body.lines) if (!append(line)) break
    if (body.truncated) truncated = true
  }
  if (truncated) append('[合并转发内容已按安全预算截断]')
  return { content: lines.join('\n'), nodeCount, forwardCount, truncated, failed }
}

// normalizeForwardMessages 的返回类型不含 imageRefs（由 readForwardContent
// 组装）；此别名只描述归一化输出的子集字段。
export type ForwardNormalized = Omit<ForwardReadResult, 'imageRefs'>

function normalizeForwardSegments(segments: unknown[], limits: ForwardReadLimits, depth: number) {
  const lines: string[] = []
  let forwardCount = 0
  let truncated = false
  let failed = false
  for (const raw of segments) {
    const segment = asRecord(raw)
    const type = String(segment.type ?? '').toLowerCase()
    const data = asRecord(segment.data)
    if (type === 'text') {
      const text = String(data.text ?? '').trim()
      if (text) lines.push(text)
    } else if (type === 'at') {
      const name = String(data.name ?? data.qq ?? data.user_id ?? '').trim()
      lines.push(name ? `[@${name}]` : '[@]')
    } else if (type === 'reply') {
      const id = String(data.id ?? '').trim()
      lines.push(id ? `[回复消息 ${id}]` : '[回复]')
    } else if (type === 'forward') {
      forwardCount++
      const id = String(data.id ?? data.res_id ?? data.forward_id ?? '').trim()
      if (depth >= limits.maxDepth) {
        lines.push(id ? `[嵌套合并转发，已达到深度上限｜${id}]` : '[嵌套合并转发，已达到深度上限]')
      } else {
        lines.push(id ? `[嵌套合并转发｜资源 ${id}；需要递归读取]` : '[嵌套合并转发；资源标识缺失]')
      }
    } else if (['image', 'img'].includes(type)) lines.push('[图片]')
    else if (['record', 'audio'].includes(type)) lines.push('[语音]')
    else if (type === 'video') lines.push('[视频]')
    else if (type === 'file') lines.push(`[文件${String(data.name ?? data.file ?? '').trim() ? `：${String(data.name ?? data.file).trim()}` : ''}]`)
    else if (type) lines.push(`[未支持的消息类型：${type}]`)
  }
  return { lines, forwardCount, truncated, failed }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}
