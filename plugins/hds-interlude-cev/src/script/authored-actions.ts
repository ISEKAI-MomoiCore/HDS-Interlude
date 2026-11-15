import type { NarrativeDecision } from '../types'

export interface AuthoredAction { id: string; start: number; end: number; content: string }
const resolvedActions = new WeakSet<AuthoredAction[]>()
const deliveredActions = new WeakSet<AuthoredAction[]>()

/** Syntax only: unwrap authored speech, never infer an action from prose.
 * Duplicate ids are not executable references. The original words survive. */
export function readAuthoredActions(script: string) {
  const actions: AuthoredAction[] = []
  let prose = '', cursor = 0
  for (const match of script.matchAll(/<say id="([\w-]{1,64})">([\s\S]*?)<\/say>/g)) {
    prose += script.slice(cursor, match.index)
    const start = prose.length
    prose += match[2]
    actions.push({ id: match[1], start, end: prose.length, content: match[2] })
    cursor = match.index! + match[0].length
  }
  prose += script.slice(cursor)
  return { prose, actions: actions.filter(action => actions.filter(other => other.id === action.id).length === 1) }
}

/** Resolve the same authored words before any transport normalization. Legacy
 * content remains compatible; a broken explicit reference cannot send another
 * independently authored answer. Delayed drafts retain their existing path. */
export function reconcileTransportReferences(decision: NarrativeDecision, alreadySent = false, separator = '<sep/>'): NarrativeDecision {
  if (typeof decision?.script !== 'string') return decision
  // 群聊回合兼容：部分模型把群回复嵌套在 interaction.groupReply 而不是
  // 顶层 groupReply——提权到顶层让 hasStructuredGroupReply / normalizeGroupVisibleReply
  // / resolve 都能正常处理（实测 Gemini 3.7 Flash 群聊 mention-only 必现）。
  if (!decision.groupReply && decision.interaction && typeof (decision.interaction as any).groupReply === 'object' && (decision.interaction as any).groupReply !== null) {
    decision = { ...decision, groupReply: (decision.interaction as any).groupReply }
  }
  // 动作字段嵌套兼容（与 groupReply 同因）：模型常把动作字段塞进
  // interaction 或 interaction.reply。提权到顶层，使 requiresVisibleReplyRecovery
  // 的放行依据、resolveSticker/resolveNativeFace 与 buildCommit 的 raw 回挂
  // 全部可见。两种嵌套取先命中者；顶层已有值不覆盖。
  for (const key of ['localMedia', 'nativeFace', 'messageReactions'] as const) {
    if (decision[key]) continue
    const interaction = decision.interaction as unknown as Record<string, unknown> | undefined
    const nested = interaction?.[key]
    const deeper = (interaction?.reply as Record<string, unknown> | undefined)?.[key]
    const value = nested ?? deeper
    if (value != null && typeof value === 'object') decision = { ...decision, [key]: value as never }
  }
  const parsed = readAuthoredActions(decision.script)
  const leading = parsed.prose.length - parsed.prose.trimStart().length
  const prose = parsed.prose.trim()
  const inherited = Array.isArray(decision.authoredActions) && resolvedActions.has(decision.authoredActions) ? decision.authoredActions : []
  alreadySent ||= deliveredActions.has(inherited)
  const actions = (parsed.actions.length ? parsed.actions : inherited).map(action => ({
    ...action, start: action.start - leading, end: action.end - leading,
  })).filter(action => {
    if (action.start >= 0 && action.end <= prose.length && prose.slice(action.start, action.end) === action.content) return true
    // 容忍 say 内容两端的空白（闭合标签前的尾随空格很常见）——
    // prose 双侧 trim 后 end 可能越界或切片不等。兜底用夹紧切片做双侧 trim 比较，
    // 命中后回写 content 为切片本身，让镜像/救援路径拿到的是 prose 实际文字。
    const start = Math.max(0, action.start)
    const end = Math.min(Math.max(action.end, start), prose.length)
    const slice = prose.slice(start, end)
    if (slice && slice.trim() === action.content.trim()) {
      action.start = start
      action.end = end
      action.content = slice
      return true
    }
    return false
  })
  const privateReply = decision.interaction?.reply
  const onePrivateRecipient = (!decision.groupReply || decision.groupReply.mode === 'none') && !decision.crossConversationActions?.length
  if (!alreadySent && onePrivateRecipient && actions.length === 1 && privateReply?.mode === 'immediate'
    && privateReply.actionId === actions[0].id) {
    const tail = completeLegacyBubbleBlock(prose, actions[0].content, separator)
    if (tail && actions[0].start === prose.length - tail.length) {
      actions[0] = { ...actions[0], content: tail, end: prose.length }
    }
  }
  const resolve = <T extends { mode: string; content?: string; actionId?: string }>(reply: T): T => {
    if (!reply || typeof reply !== 'object') return reply
    if (alreadySent) return { ...reply, actionId: undefined }
    if (!reply.actionId || reply.mode !== 'immediate') return reply
    const action = actions.find(item => item.id === reply.actionId
      && prose.slice(item.start, item.end) === item.content && item.content.trim())
    return action ? { ...reply, content: action.content } : { ...reply, mode: 'none', content: undefined }
  }
  // 弱模型矛盾形态的就地救援：reply.mode=none 却携带 actionId（合规合约里沉默
  // 从不引用发送行动）。若该 id 确实锚定剧本里的 say 行动，发送意图无歧义，
  // 直接翻转成 immediate 投递——不重写、不失败；解析不到则维持 none（同旧版
  // 行为），由 standard 级诊断日志留痕。
  const rescueSilentActionReference = (reply: NonNullable<typeof privateReply>) => {
    if (alreadySent || !reply || reply.mode !== 'none' || !reply.actionId?.trim()) return reply
    const action = actions.find(item => item.id === reply.actionId
      && prose.slice(item.start, item.end) === item.content && item.content.trim())
    return action ? { ...reply, mode: 'immediate' as const, content: action.content } : reply
  }
  // 引用失配的保守兜底：整份剧本只有一个已授权 say 行动、本回合只有一个私聊
  // 接收者、且回复没有可用 content 时，该行动就是这条回复的本体——模型常照抄
  // 协议示例里的 id 字面量导致引用对不上。零行动、重复 id、伪造继承与已提前
  // 流式发送的情况都不适用，保持原有的 none 语义。
  const soleActionReply = (reply: NonNullable<typeof privateReply>) => {
    if (alreadySent || !reply || typeof reply !== 'object' || !onePrivateRecipient || reply.mode !== 'immediate' || reply.content || actions.length !== 1) return reply
    const only = actions[0]
    if (!only.content.trim() || prose.slice(only.start, only.end) !== only.content) return reply
    return { ...reply, actionId: only.id, content: only.content }
  }
  // Recover a legacy mirror's missing bubbles only from its explicit terminal
  // transport block, never ordinary narration or another recipient's action.
  const legacyTail = !alreadySent && onePrivateRecipient && !actions.length
    && privateReply?.mode === 'immediate' && !privateReply.actionId && privateReply.content
    ? completeLegacyBubbleBlock(prose, privateReply.content, separator) : undefined
  resolvedActions.add(actions)
  if (alreadySent) deliveredActions.add(actions)
  return {
    ...decision, script: prose, authoredActions: actions,
    ...(decision.interaction ? { interaction: { ...decision.interaction, reply: resolve(rescueSilentActionReference(legacyTail
      ? { ...decision.interaction.reply, content: legacyTail } : soleActionReply(decision.interaction.reply))) } } : {}),
    ...(decision.groupReply ? { groupReply: resolve(decision.groupReply) } : {}),
    ...(Array.isArray(decision.crossConversationActions) ? { crossConversationActions: decision.crossConversationActions.map(resolve) } : {}),
  }
}

export function completeLegacyBubbleBlock(prose: string, content: string, separator: string) {
  if (!separator || !content.trim()) return undefined
  const tail = prose.trim().split(/\r?\n\s*\r?\n|\\n\\n/).at(-1)?.trim() ?? ''
  if (!tail.startsWith(content.trim() + separator) || tail.length > 4_000) return undefined
  const parts = tail.split(separator)
  if (parts.length < 2 || parts.some(part => !part.trim() || /[\r\n<>]|\\n/.test(part))) return undefined
  return tail
}
