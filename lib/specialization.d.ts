/**
 * 模型特化（specialization）：按当前主模型自动选择合约档位与家族特化块。
 * 设计依据：《模型横向对比-HDSI特化资料集.md》《模型特化英文系统合约.md》。
 * 档位：lite（核心 15 块）/ standard（全量+content-only 协议）/ full（rc12 原样）。
 * 家族特化块只做最小偏移：长度块/打字块替换 + 至多一条新增行。
 */
export type ContractTier = 'lite' | 'standard' | 'full';
export type ModelFamily = 'gemini-flash' | 'gemini' | 'claude' | 'gpt' | 'glm' | 'kimi' | 'deepseek' | 'grok' | 'generic';
export type SpecializationMode = 'auto' | ContractTier | 'off';
export interface SpecialtyProfile {
    tier: ContractTier;
    family: ModelFamily;
    /** manual = 用户在 Console 指定档位；auto = 按模型名推断。 */
    source: 'auto' | 'manual';
    /** 参与推断的探测串（日志用）。 */
    probe: string;
}
export declare function detectFamily(probe: string): ModelFamily;
export declare function inferSpecialty(probe: string, mode?: SpecializationMode): SpecialtyProfile;
export declare const TYPED_MESSAGES_BASE = "WRITING BELIEVABLE TYPED MESSAGES: In the script, portray online messages as text the character chooses to type, not spoken dialogue transcribed. Keep typing and speaking aloud distinct. Each reply is an independent choice \u2014 the number of messages in previous replies does not constrain this one; let this moment alone decide whether she sends one bubble or several. Stickers and emoji-like images are a metalanguage: infer the sender attitude, acknowledgement, hesitation, irony or emotional framing from the concrete image and its conversational context rather than stopping at the depicted subject. A cat sticker may mean \"seen\" or \"confirmed\", not that the sender is commenting on a cute cat. Sending the same sticker repeatedly is also an intentional expressive act \u2014 insistence, emphasis, playfulness, impatience or deliberate noise.";
export interface FamilyOverride {
    length?: string;
    typed?: string;
    extraAfterLength?: string;
    extraAfterPhase?: string;
}
/** 家族覆盖表：仅在对应档位组装时应用；generic 与未列出的家族无偏移。 */
export declare function familyOverrides(family: ModelFamily): FamilyOverride;
export declare const CONTENT_ONLY_TRANSPORT = "TRANSPORT: reply.content contains the message text. Use mode=immediate when she sends now, mode=none when silent. For several separate chat bubbles, place <sep/> between them inside content. Line breaks never separate bubbles; only <sep/> does.";
export declare const LITE_TRANSPORT_PRIVATE = "For this private turn, return interaction as {\"seen\":true,\"reply\":{\"mode\":\"immediate\",\"content\":\"the exact words she sends now\",\"sendAt\":\"future ISO-8601 only when delayed\"}}. mode=none only when she sends nothing; a silent turn carries no content. \"mode\" must be exactly \"none\", \"immediate\", or \"delayed\" \u2014 never \"text\", \"send\", or any other word. seen records whether she reads the current message content; seen=true with reply.mode=none is the ordinary read-but-does-not-answer state.";
export declare const LITE_TRANSPORT_GROUP = "For this group turn, return groupReply as {\"mode\":\"immediate\",\"content\":\"the exact words posted to the group now\"}. The content must be exactly the words posted in the script. Use mode=none when no group post occurs.";
export declare const LITE_TRANSPORT_ADVANCE = "In this independent-life phase there is normally no current reply channel; reply.mode=none unless a message is genuinely sent now. A present outbound action uses crossConversationActions with the listed participantId, exact content and a willingness value.";
export declare const LITE_JSON_CONTRACT = "Return one JSON object with a continuous prose field named script first, followed by interaction (groupReply in group turns) and only the other structured fields that the current phase permits. Do not wrap it in Markdown fences.";
export declare const LITE_INTERVAL = "The script covers the supplied interval and stops at now. Future possibilities remain possibilities, not accomplished events. The interval object is the authoritative clock: use interval.nowLocal for time-of-day words, not recentScript wording. If older prose says night but interval.nowLocal says 16:00/afternoon, advance into the current afternoon unless a current setting or observed event establishes unusual darkness.";
export declare const LITE_UNREAD = "A user message arriving does not mean the protagonist has noticed or read it. Whether she checks follows her circumstances, attention and willingness. currentParticipant.unreadMessageCount is an arrival record only, never attention, pressure or obligation.";
export declare const LITE_NEVER_INVENT = "Never invent an incoming message, phone vibration, notification, or quoted sentence absent from the observed-event ledger; do not write \"the phone vibrated\" or \"X sent a message\" unless that exact external event is in the supplied context.";
export declare const LITE_OWNERSHIP = "Every recentScript item carries an ownership label that is authoritative for who thought, narrated, observed or actually sent the content; a thought about the user is not a thought by the user.";
export declare const LITE_EVENT_SOURCES = "Treat currentEvent, groupContext.messages and dueIntents as the sources for events occurring in this interval. Treat recentScript, memories and facts as the established past that gives the current scene continuity.";
export declare const LITE_ADMIN_NOTES = "ADMIN NOTES: entries whose content begins with [\u7BA1\u7406\u5458\u6CE8\u8BB0] are authoritative facts or directives injected by the story administrator. They override narrative improvisation on their specific subject and remain binding until contradicted by a later admin note. Never have the protagonist mention reading a note.";
export declare const LITE_WORLD_EVENTS = "Entries whose content begins with [\u4E16\u754C\u4E8B\u4EF6] are externally observed facts about her world at their stated time. Treat them as established reality; her attention and response remain hers. They are not directives. Never have her mention noticing any record.";
/** 手动档位解析：Console 显式选择；off（默认）= rc12 原样（full+generic，字节一致）。
 * 家族默认仍从模型名识别（只决定特化块、不决定档位），可用 specializationFamily 显式指定
 * （中转别名场景）。 */
export declare function resolveManualSpecialty(probe: string, mode: 'off' | ContractTier | undefined, familySetting: 'auto' | ModelFamily | undefined): SpecialtyProfile;
