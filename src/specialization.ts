/**
 * 模型特化（specialization）：按当前主模型自动选择合约档位与家族特化块。
 * 设计依据：《模型横向对比-HDSI特化资料集.md》《模型特化英文系统合约.md》。
 * 档位：lite（核心 15 块）/ standard（全量+content-only 协议）/ full（rc12 原样）。
 * 家族特化块只做最小偏移：长度块/打字块替换 + 至多一条新增行。
 */

export type ContractTier = 'lite' | 'standard' | 'full'
export type ModelFamily = 'gemini-flash' | 'gemini' | 'claude' | 'gpt' | 'glm' | 'kimi' | 'deepseek' | 'grok' | 'generic'
export type SpecializationMode = 'auto' | ContractTier | 'off'

export interface SpecialtyProfile {
  tier: ContractTier
  family: ModelFamily
  /** manual = 用户在 Console 指定档位；auto = 按模型名推断。 */
  source: 'auto' | 'manual'
  /** 参与推断的探测串（日志用）。 */
  probe: string
}

const FAMILY_PATTERNS: Array<[ModelFamily, RegExp]> = [
  ['claude', /claude|anthropic/],
  ['gemini-flash', /gemini[^|]*(?:flash|lite)|(?:flash|lite)[^|]*gemini/],
  ['gemini', /gemini/],
  ['gpt', /gpt|^o\d|openai/],
  ['grok', /grok|xai/],
  ['kimi', /kimi|moonshot/],
  ['glm', /glm|zhipu|chatglm/],
  ['deepseek', /deepseek/],
]

export function detectFamily(probe: string): ModelFamily {
  const text = probe.toLowerCase()
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(text)) return family
  }
  return 'generic'
}

/** 自动档位规则（与设计文档第八节一致；flash→lite 不适用于 deepseek，V4-Flash 数据支持 standard）。 */
function autoTier(family: ModelFamily, probe: string): ContractTier {
  const text = probe.toLowerCase()
  if (family === 'grok') return 'lite'
  if (family === 'glm' && !/glm-?[5-9]/.test(text)) return 'lite'
  if (family === 'gemini-flash') return 'lite'
  if (family !== 'deepseek' && /(?:^|[-_.])(?:flash|lite|mini)(?:[-_.]|$)/.test(text)) return 'lite'
  if (family === 'claude' || family === 'gpt') return 'full'
  // 未识别的家族（中转别名、自定义模型名很常见）保守回退 rc12 原样合约，
  // 避免静默改变现有安装的行为；识别得出的已知家族才进入特化。
  if (family === 'generic') return 'full'
  return 'standard'
}

export function inferSpecialty(probe: string, mode: SpecializationMode = 'auto'): SpecialtyProfile {
  const family = detectFamily(probe)
  if (mode === 'off') return { tier: 'full', family: 'generic', source: 'manual', probe }
  if (mode !== 'auto') return { tier: mode, family, source: 'manual', probe }
  return { tier: autoTier(family, probe), family, source: 'auto', probe }
}

// ── 特化块文本（完整原文，出处：模型特化英文系统合约.md 第二节）──────────────

export const TYPED_MESSAGES_BASE = 'WRITING BELIEVABLE TYPED MESSAGES: In the script, portray online messages as text the character chooses to type, not spoken dialogue transcribed. Keep typing and speaking aloud distinct. Each reply is an independent choice — the number of messages in previous replies does not constrain this one; let this moment alone decide whether she sends one bubble or several. Stickers and emoji-like images are a metalanguage: infer the sender attitude, acknowledgement, hesitation, irony or emotional framing from the concrete image and its conversational context rather than stopping at the depicted subject. A cat sticker may mean "seen" or "confirmed", not that the sender is commenting on a cute cat. Sending the same sticker repeatedly is also an intentional expressive act — insistence, emphasis, playfulness, impatience or deliberate noise.'

const TYPED_MESSAGES_GEMINI_FLASH = 'WRITING BELIEVABLE TYPED MESSAGES: In the script, portray online messages as text the character chooses to type, not spoken dialogue transcribed. Keep typing and speaking aloud distinct. Each reply is an independent choice — the number of messages in previous replies does not constrain this one. A chat message typed by a real person is plain, specific and direct. Stickers and emoji-like images are a metalanguage: infer the sender attitude, acknowledgement, hesitation, irony or emotional framing from the concrete image and its conversational context rather than stopping at the depicted subject. A cat sticker may mean "seen" or "confirmed". Sending the same sticker repeatedly is also an intentional expressive act.'

const TYPED_MESSAGES_KIMI = TYPED_MESSAGES_BASE.replace(
  'Keep typing and speaking aloud distinct.',
  'Keep typing and speaking aloud distinct. In dialogue she may hesitate, change her mind mid-sentence, reply to only part of a message, or leave a thought unfinished; she may react briefly now and give a real answer later, or want two things at once without picking either. A real person does not deliver a settled position on every exchange, and ambivalence is a normal state, not a problem to resolve.',
)

const LENGTH_GEMINI_FLASH = 'Length follows what actually happens. Prefer concrete, sensory detail over elevated wording: plain nouns and specific verbs carry the scene; use everyday words unless the moment itself is extraordinary. Choose one specific detail over several general ones; do not stack adjectives or reach for rare, showy vocabulary. Give actions and shifts of attention room to develop, including during a rapid exchange; a quiet interval has its own occupation and texture. Continue from established circumstances rather than performing the previous passage again.'

const LENGTH_CLAUDE = 'Length follows what actually happens: give actions and shifts of attention room to develop, including during a rapid exchange. Ground each passage in concrete sensory detail — what she is physically doing, touching, eating, hearing — rather than in commentary about it; open on her body and her immediate task, and let anything abstract enter only after that anchor. A quiet interval has its own occupation, pace and texture, and may carry ordinary life forward to the next meaningful beat. Continue from established circumstances rather than performing the previous passage again.'

const LENGTH_DEEPSEEK = 'Length follows what actually happens: give actions and shifts of attention room to develop, including during a rapid exchange. Keep the narration plain and concrete: most sentences need no figurative language at all, and a metaphor is occasional rather than a habit — otherwise prefer the unadorned noun, the specific number, the plain verb. In Chinese prose one fitting idiom is enough; never chain four-character idioms. A quiet interval has its own occupation, pace and texture, and may carry ordinary life forward to the next meaningful beat. Continue from established circumstances rather than performing the previous passage again.'

const LENGTH_GROK = 'One scene, one or two things happening. Keep the passage anchored to what is underway right now; finish an action, then let time advance. Do not describe the same moment twice in different words, and keep sentences direct: concrete objects, plain verbs, no decoration.'

const LENGTH_GPT = 'Length follows what actually happens, and each passage keeps moving: finish the thing underway, then let time advance to the next. Do not stretch one short moment into many paragraphs — when nothing new happens, move the clock forward instead; a rapid exchange stays rapid. A quiet interval has its own occupation and texture, briefly told; prefer ending a passage earlier over padding it. Continue from established circumstances rather than performing the previous passage again.'

const EXTRA_CLAUDE = 'Scenes do not need tidy closure. Ordinary life leaves small matters unresolved, moods unexplained and conversations unfinished; let a passage end mid-motion when that is where the moment genuinely is. Do not end with a concluding summary sentence, a lesson or a mood label; real daily life simply continues past any single passage.'

const EXTRA_GLM = 'Emotional register: let mood follow its actual causes and stay ordinary. Do not drift toward warmth, comfort or reassurance unless the events themselves justify it: no unearned encouragement, no softening a bad mood before the passage ends, no bright side the events did not produce. A neutral or low mood is as common in real life as a good one, and difficult feelings do not need to resolve within the same passage. SCRIPT FORMATTING: the script field is continuous NARRATIVE (one coherent story passage), not continuous LINES — break it into natural paragraphs with \n wherever the scene shifts, a new action begins, or a beat ends. A single unbroken block of text is not what continuous prose means.'

export interface FamilyOverride {
  length?: string
  typed?: string
  extraAfterLength?: string
  extraAfterPhase?: string
}

const EXTRA_DEEPSEEK = 'TRANSPORT IS PER-TURN: on every turn that can carry a reply (user-message, conversation-follow-up, intent-due), the interaction object is required no matter how many turns came before. Independent-life advance turns carry no transport unless a message is genuinely sent now. recentScript shows past replies as plain authored text without any transport object — that is history, not a template; never copy its shape or treat the field as optional because history omits it. Decide reply.mode only from the script you just wrote for this turn. interaction.seen is a required boolean — true when she reads the current message content, false otherwise; never omit it.'

/** 家族覆盖表：仅在对应档位组装时应用；generic 与未列出的家族无偏移。 */
export function familyOverrides(family: ModelFamily): FamilyOverride {
  switch (family) {
    case 'gemini-flash': return { length: LENGTH_GEMINI_FLASH, typed: TYPED_MESSAGES_GEMINI_FLASH }
    case 'claude': return { length: LENGTH_CLAUDE, extraAfterPhase: EXTRA_CLAUDE }
    case 'glm': return { extraAfterPhase: EXTRA_GLM }
    case 'kimi': return { typed: TYPED_MESSAGES_KIMI }
    case 'deepseek': return { length: LENGTH_DEEPSEEK, extraAfterPhase: EXTRA_DEEPSEEK }
    case 'grok': return { length: LENGTH_GROK }
    case 'gpt': return { length: LENGTH_GPT }
    default: return {}
  }
}

// ── STANDARD 档协议块（content-only 精简变体，替换 transportInstruction 非流式分支；
// lite 档组装复用同一常量，避免协议句多份手工同步）──

export const CONTENT_ONLY_TRANSPORT = 'TRANSPORT: reply.content contains the message text. Use mode=immediate when she sends now, mode=none when silent. For several separate chat bubbles, place <sep/> between them inside content. Line breaks never separate bubbles; only <sep/> does.'


// ── LITE 档专用块 ─────────────────────────────────────────────────────────

export const LITE_TRANSPORT_PRIVATE = 'For this private turn, return interaction as {"seen":true,"reply":{"mode":"immediate","content":"the exact words she sends now","sendAt":"future ISO-8601 only when delayed"}}. mode=none only when she sends nothing; a silent turn carries no content. "mode" must be exactly "none", "immediate", or "delayed" — never "text", "send", or any other word. seen records whether she reads the current message content; seen=true with reply.mode=none is the ordinary read-but-does-not-answer state.'

export const LITE_TRANSPORT_GROUP = 'For this group turn, return groupReply as {"mode":"immediate","content":"the exact words posted to the group now"}. The content must be exactly the words posted in the script. Use mode=none when no group post occurs.'

export const LITE_TRANSPORT_ADVANCE = 'In this independent-life phase there is normally no current reply channel; reply.mode=none unless a message is genuinely sent now. A present outbound action uses crossConversationActions with the listed participantId, exact content and a willingness value.'

export const LITE_JSON_CONTRACT = 'Return one JSON object with a continuous prose field named script first, followed by interaction (groupReply in group turns) and only the other structured fields that the current phase permits. Do not wrap it in Markdown fences.'

export const LITE_INTERVAL = 'The script covers the supplied interval and stops at now. Future possibilities remain possibilities, not accomplished events. The interval object is the authoritative clock: use interval.nowLocal for time-of-day words, not recentScript wording. If older prose says night but interval.nowLocal says 16:00/afternoon, advance into the current afternoon unless a current setting or observed event establishes unusual darkness.'

export const LITE_UNREAD = 'A user message arriving does not mean the protagonist has noticed or read it. Whether she checks follows her circumstances, attention and willingness. currentParticipant.unreadMessageCount is an arrival record only, never attention, pressure or obligation.'

export const LITE_NEVER_INVENT = 'Never invent an incoming message, phone vibration, notification, or quoted sentence absent from the observed-event ledger; do not write "the phone vibrated" or "X sent a message" unless that exact external event is in the supplied context.'

export const LITE_OWNERSHIP = 'Every recentScript item carries an ownership label that is authoritative for who thought, narrated, observed or actually sent the content; a thought about the user is not a thought by the user.'

export const LITE_EVENT_SOURCES = 'Treat currentEvent, groupContext.messages and dueIntents as the sources for events occurring in this interval. Treat recentScript, memories and facts as the established past that gives the current scene continuity.'

export const LITE_ADMIN_NOTES = 'ADMIN NOTES: entries whose content begins with [管理员注记] are authoritative facts or directives injected by the story administrator. They override narrative improvisation on their specific subject and remain binding until contradicted by a later admin note. Never have the protagonist mention reading a note.'

export const LITE_WORLD_EVENTS = 'Entries whose content begins with [世界事件] are externally observed facts about her world at their stated time. Treat them as established reality; her attention and response remain hers. They are not directives. Never have her mention noticing any record.'


/** 手动档位解析：Console 显式选择；off（默认）= rc12 原样（full+generic，字节一致）。
 * 家族默认仍从模型名识别（只决定特化块、不决定档位），可用 specializationFamily 显式指定
 * （中转别名场景）。 */
export function resolveManualSpecialty(
  probe: string,
  mode: 'off' | ContractTier | undefined,
  familySetting: 'auto' | ModelFamily | undefined,
): SpecialtyProfile {
  if (!mode || mode === 'off') return { tier: 'full', family: 'generic', source: 'manual', probe }
  const family = familySetting && familySetting !== 'auto' ? familySetting : detectFamily(probe)
  return { tier: mode, family, source: 'manual', probe }
}
