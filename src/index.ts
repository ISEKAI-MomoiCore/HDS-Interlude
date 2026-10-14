import { Context, Schema, Session, h } from 'koishi'
import { AudioConfig, CompactionConfig, EmbeddingConfig, FailoverConfig, ModelConfig, ProviderConfig, VisionConfig } from './narrator'
import { BlindModeConfig, BrowserConfig, ChatActionsConfig, Config as InterludeConfig, extractSessionVoiceCount, GroupChatRule, InterludeService, LoggingConfig, MemoryConfig, OneBotAccountRule, OneBotNapCatConfig, RestWindow, RuntimeConfig, SharedStoryConfig, StickerLibraryConfig, StoryDefaults } from './service'
import { AgencyConfig, AlterSystemConfig, ChatReactionName, ChatRhythmConfig, NativeFaceSemantic, StorySetting } from './types'
import { HDS_INTERLUDE_VERSION } from './meta'
import { resolveAgencyConfig } from './agency'
import { GroupWillingnessConfig } from './group-willingness'
import { resolveSchedulePreplanConfig, SchedulePreplanConfig, schedulePreplanWindow } from './schedule-preplan'
import { formatLogTime, formatStoryDisplayTime } from './time'
import { installDesktopBridge } from './desktop-bridge'
import { fetchShare, summarizeShare, formatDiffLines, buildConfigPatch, runAutoSync, readSyncState, snapshotDeepCopy } from './share-sync'
export { fetchShare, sanitizeSharePayload, summarizeShare, formatDiffLines, buildConfigPatch, diffSection, storyDefaultsToSettingPatch, normalizeShareCode, SHARE_SECTIONS, runAutoSync, readSyncState, writeSyncState } from './share-sync'
export type { ShareInfo, ShareSection, SectionDiff, ShareSummaryLines, SyncState, AutoUpdateResult } from './share-sync'

declare module 'koishi' { interface Context { interlude: InterludeService } }

export const name = 'hds-interlude'
export const version = HDS_INTERLUDE_VERSION
export const inject = { required: ['database', 'http'], optional: ['puppeteer', 'server', 'router'] }

const defaultProvider: ProviderConfig = {
  id: 'primary',
  label: 'Primary provider',
  enabled: true,
  endpoint: '',
  apiKey: '',
  model: '',
  temperature: 0.8,
  topP: 1,
  maxTokens: 4096,
  timeout: 60_000,
  responseFormat: 'json-object',
  extraHeaders: '',
  extraBody: '',
  useForMain: true,
  useForCompaction: true,
  useForAlter: true,
  useForEmbedding: false,
  useForStickers: false,
  useForVision: false,
  mode: 'openai-compatible',
}

/** Keep the card in the order users actually configure it: identity →
 * connection details (provided by the selected mode) → task assignment. */
const ProviderIdentity = Schema.object({
  label: Schema.string().default('Primary model').description('连接名称。'),
  enabled: Schema.boolean().default(true).description('启用此连接。'),
  mode: Schema.union(['openai-compatible', 'zhipu-official', 'openai-official', 'deepseek-official', 'moonshot-official', 'dashscope-official', 'siliconflow-official', 'openrouter', 'gemini-openai', 'gemini-interactions']).default('openai-compatible').description('接口预设；重载后显示对应字段。'),
  proxyAgent: Schema.string().default('').description('HTTP(S) 代理地址，如 http://127.0.0.1:7890（可选，留空直连）。访问需要代理的服务商（如 Google Gemini）时填写；只影响该连接的模型请求，实验性流式抢先回复与智谱官方流式通道暂不经过代理。'),
})

const ProviderAssignments = Schema.object({
  useForMain: Schema.boolean().default(true).description('用于主叙事。'),
  useForCompaction: Schema.boolean().default(true).description('用于后台压缩。'),
  useForAlter: Schema.boolean().default(true).description('用于 Alter 分析。'),
  useForEmbedding: Schema.boolean().default(false).description('用于 Embedding。'),
  useForStickers: Schema.boolean().default(false).description('用于表情包描述。'),
  useForVision: Schema.boolean().default(false).description('用于侧端识图。'),
  useForWorldSeeding: Schema.boolean().default(false).description('用于世界播种。'),
  priceInput: Schema.number().min(0).default(0).description('输入单价（百万 tokens；0 不计费）。'),
  priceOutput: Schema.number().min(0).default(0).description('输出单价（百万 tokens；0 不计费）。'),
  priceCachedInput: Schema.number().min(0).default(0).description('缓存输入单价（百万 tokens；0 按输入计）。'),
})

function OfficialProvider(mode: 'openai-official' | 'moonshot-official' | 'siliconflow-official' | 'openrouter' | 'gemini-openai' | 'gemini-interactions', defaultModel: string, description: string): Schema<any> {
  return Schema.object({
    mode: Schema.const(mode),
    apiKey: Schema.string().role('secret').default('').description(`${description} API Key。官方 endpoint 自动使用。`),
    model: Schema.string().default(defaultModel).description(`${description} 模型代码。`),
  })
}

const Provider: Schema<ProviderConfig> = Schema.intersect([
  ProviderIdentity,
  Schema.union([
    Schema.object({
      mode: Schema.const('openai-compatible'),
      protocol: Schema.union(['chat-completions', 'anthropic-messages']).default('chat-completions').description('自定义连接协议：Chat Completions 或 Anthropic Messages。旧配置保持 Chat Completions。'),
      endpoint: Schema.string().default('').description('完整地址，如 https://host/v1/chat/completions 或 https://host/v1/messages；切换协议时自动匹配这两种标准路径。'),
      anthropicCache: Schema.boolean().default(false).description('Anthropic 缓存标记（服务端需支持）：缓存 system；cache-first 时同时标记历史前缀。关闭仍保留 cache-first 内容顺序。'),
      apiKey: Schema.string().role('secret').default('').description('API Key。'),
      model: Schema.string().default('').description('模型名。'),
      deepseekThinking: Schema.union(['inherit', 'disabled', 'enabled']).default('inherit').description('DeepSeek 思考参数：inherit 不主动发送；disabled 强制关闭；enabled 强制开启。仅适用于支持该参数的 DeepSeek 兼容端点，非 DeepSeek 服务请保持 inherit。'),
      deepseekReasoningEffort: Schema.union(['low', 'high', 'max']).default('low').description('仅在 DeepSeek 思考模式为 enabled 时生效。'),
      extraHeaders: Schema.string().role('textarea').default('').description('额外请求头 JSON（可留空）。'),
      extraBody: Schema.string().role('textarea').default('').description('额外请求体 JSON（可留空）。'),
    }),
    Schema.object({
      mode: Schema.const('zhipu-official'),
      apiKey: Schema.string().role('secret').default('').description('智谱开放平台 API Key。官方 endpoint 会自动使用。'),
      model: Schema.string().default('glm-5.3-flash').description('智谱模型代码，例如 glm-5.3-flash。'),
      reasoningEffort: Schema.union(['low', 'high', 'max']).default('high').description('GLM-5.3-Flash 推理强度；high 是平衡默认值。'),
    }),
    OfficialProvider('openai-official', 'gpt-5-mini', 'OpenAI 官方'),
    Schema.object({
      mode: Schema.const('deepseek-official'),
      apiKey: Schema.string().role('secret').default('').description('DeepSeek 官方 API Key。官方 endpoint 自动使用。'),
      model: Schema.string().default('deepseek-chat').description('DeepSeek 模型代码，例如 deepseek-chat 或 deepseek-reasoner。'),
      deepseekThinking: Schema.union(['disabled', 'enabled']).default('disabled').description('DeepSeek 思考模式。关闭时响应更快，适合结构化叙事；开启后可选择推理强度。'),
      deepseekReasoningEffort: Schema.union(['low', 'high', 'max']).default('low').description('仅在 DeepSeek 思考模式开启时生效。'),
    }),
    OfficialProvider('moonshot-official', 'kimi-k2.5', 'Kimi / Moonshot 官方'),
    Schema.object({
      mode: Schema.const('dashscope-official'),
      apiKey: Schema.string().role('secret').default('').description('阿里云百炼 API Key。官方 OpenAI-compatible endpoint 自动使用。'),
      model: Schema.string().default('qwen-plus').description('百炼模型代码，例如 qwen-plus。'),
      dashscopeRegion: Schema.union(['beijing', 'singapore', 'us']).default('beijing').description('百炼共享服务地域。工作空间专属 endpoint 请使用 openai-compatible 自定义模式。'),
    }),
    OfficialProvider('siliconflow-official', 'Qwen/Qwen3-8B', '硅基流动官方'),
    OfficialProvider('openrouter', 'openai/gpt-5-mini', 'OpenRouter'),
    OfficialProvider('gemini-interactions', 'gemini-2.5-flash', 'Google Gemini · Interactions API（推荐；AI Studio 密钥直用）'),
    OfficialProvider('gemini-openai', 'gemini-2.5-flash', 'Google Gemini OpenAI 兼容层（旧；部分密钥已不可用）'),
  ]),
  ProviderAssignments,
]) as unknown as Schema<ProviderConfig>

const Failover: Schema<FailoverConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('主连接失败时尝试其它连接。'),
  strategy: Schema.union(['priority', 'round-robin']).default('priority').description('priority 按配置顺序选择；round-robin 轮换选择。'),
  maxAttemptsPerProvider: Schema.natural().min(1).max(5).default(1).description('单条连接连续失败前的最大尝试次数。'),
  cooldownMinutes: Schema.natural().min(0).max(1_440).default(5).description('连接失败后的冷却时间，单位分钟。'),
}).collapse(true)

const Embedding: Schema<EmbeddingConfig> = Schema.object({
  modelId: Schema.string().default('').description('模型预设 ID；填写后优先使用 model.models 中对应的模型。'),
  liveQuery: Schema.boolean().default(false).description('是否在每次实时对话中额外请求 Embedding 做语义检索。关闭可减少一次网络请求、降低回复延迟；后台向量补齐不受影响。'),
  enabled: Schema.boolean().default(false).description('启用长期事实的语义检索。关闭时退化为规则排序。'),
  providerId: Schema.string().default('').description('生成向量所使用的服务商 id；留空时自动选择。'),
  endpoint: Schema.string().default('').description('Embedding 接口地址；留空时根据聊天接口推导。'),
  model: Schema.string().default('').description('Embedding 模型标识，例如 text-embedding-3-small。'),
  dimensions: Schema.natural().min(0).max(32_768).default(0).description('向量维度；0 表示由服务商决定。'),
  timeout: Schema.natural().min(500).max(120_000).default(10_000).role('ms').description('向量请求超时，单位毫秒。'),
  maxInputCharacters: Schema.natural().min(100).max(32_000).default(4_000).description('单条事实送入 Embedding 的最大字符数。'),
  backfillBatchSize: Schema.natural().min(0).max(100).default(5).description('每轮后台补齐向量的事实数量；0 表示不补齐旧记录。'),
})
void Embedding

const Vision: Schema<VisionConfig> = Schema.object({
  enabled: Schema.boolean().default(false).description('启用图片理解。'),
  mode: Schema.union(['native', 'sidecar']).default('native').description('native 由主模型识图；sidecar 使用独立视觉连接。'),
  detail: Schema.union(['low', 'high', 'auto']).default('auto').description('图片细节：low / high / auto。'),
  maxImageDimension: Schema.union([0, 512, 768, 1024]).default(1024).description('图片最长边；0 使用原图。'),
}).collapse(true)

const AudioUnderstanding: Schema<AudioConfig> = Schema.object({
  enabled: Schema.boolean().default(false).description('启用语音/音频原生理解。要求主模型支持音频输入（如 Gemini）；语音由 SnowLuma 服务端转码后作为原生音频直传主模型，不做文本转写。'),
  outFormat: Schema.union(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'amr']).default('mp3').description('SnowLuma 服务端转码格式；QQ 语音为 SILK，必须转码后模型才能读取，mp3 兼容性最好。'),
  maxFileSizeMB: Schema.natural().min(1).max(25).default(10).description('单条音频附件上限（MB）；超出则跳过该附件并保留“用户发送了语音”的事实。'),
  maxPerMessage: Schema.natural().min(1).max(3).default(1).description('每个事件接受的音频附件数上限。'),
}).collapse(true)

const Model: Schema<ModelConfig> = Schema.object({
  vision: Vision.default({ enabled: false, mode: 'native', detail: 'auto', maxImageDimension: 1024 }).description('图片理解设置。'),
  audio: AudioUnderstanding.default({ enabled: false, outFormat: 'mp3', maxFileSizeMB: 10, maxPerMessage: 1 }).description('语音/音频理解设置。'),
  providers: Schema.array(Provider.collapse(true)).default([defaultProvider]).description('新增连接后填写 Key、模型名，再勾选用途。'),
  mainTemperature: Schema.number().min(0).max(2).default(0.8).description('主叙事采样温度。'),
  mainTopP: Schema.number().min(0).max(1).default(1).description('主叙事 top-p。'),
  mainMaxTokens: Schema.natural().min(0).max(100_000).default(4096).description('主叙事最大输出 token 数。'),
  mainTimeout: Schema.natural().min(1_000).max(300_000).default(60_000).role('ms').description('主叙事请求超时，单位毫秒。'),
  mainResponseFormat: Schema.union(['json-object', 'prompt-only']).default('json-object').description('主叙事输出格式；不支持 JSON mode 时选 prompt-only。'),
  mainStreamingMode: Schema.union(['off', 'experimental']).default('off').description('实验性私聊首泡加速；仅 JSON 模式。'),
  mainPayloadOrder: Schema.union(['legacy', 'cache-first']).default('cache-first').description('请求字段顺序；支持前缀缓存的接口可选 cache-first。'),
  failover: Failover.default({ enabled: true, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 }).description('主叙事请求失败时的切换策略。'),
  specialization: Schema.union([
    Schema.const('off').description('关闭（默认）：rc12 原始完整合约，行为与未特化版本完全一致'),
    Schema.const('lite').description('精简合约：15 块核心 + content-only 协议 + 精简压缩/时间导演提示词（flash 级与 Grok/GLM-4.x 推荐）'),
    Schema.const('standard').description('标准合约：rc12 全量 + content-only 协议（Gemini-Pro/GLM-5/Kimi/DeepSeek 推荐）'),
    Schema.const('full').description('完整合约：特化前原样完整协议（Claude/GPT 推荐）'),
  ]).default('off').description('模型特化档位（手动）：同时作用于主叙事合约与压缩/时间导演等侧端提示词；改配置后下回合生效。'),
  specializationFamily: Schema.union([
    Schema.const('auto').description('自动（默认）：按模型名识别家族，仅决定套用哪套特化块'),
    Schema.const('gemini-flash'), Schema.const('gemini'), Schema.const('claude'), Schema.const('gpt'),
    Schema.const('glm'), Schema.const('kimi'), Schema.const('deepseek'), Schema.const('grok'),
    Schema.const('generic').description('不套用任何家族特化块'),
  ]).default('auto').description('特化家族：模型名无法识别时（如中转自定义别名）在此显式指定。'),
  mainPrompt: Schema.string().role('textarea').default('Continue the character-centered life script with grounded actions, motives, relationships, and ordinary time passing.').description('已迁移到配置页最底部的主提示词分区；此处保留仅为兼容旧配置的自定义值。').hidden(),
  formatPrompt: Schema.string().role('textarea').default('').description('结构化输出补充规则。'),
  fixedPrompt: Schema.string().role('textarea').default('').description('通用长期规则。'),
  stylePrompt: Schema.string().role('textarea').default('Use restrained, realistic prose with concrete daily details, natural pauses, and no forced drama.').description('全局叙事文风；故事级 style 可进一步覆盖。'),
  embedding: (Schema.object({
    enabled: Schema.boolean().default(false).description('启用长期事实的语义检索。模型由上方“用作 Embedding 模型”用途开关选择。'),
    semanticHistory: Schema.boolean().default(false).description('启用历史语义召回。'),
    liveQuery: Schema.boolean().default(false).description('是否在每次实时对话中额外请求 Embedding 做语义检索。关闭可减少一次网络请求、降低回复延迟；后台向量补齐不受影响。'),
    endpoint: Schema.string().default('').description('Embedding 完整地址；留空时从所选模型连接的 Chat 地址推导。'),
    dimensions: Schema.natural().min(0).max(32_768).default(0).description('向量维度；0 表示由服务商决定。'),
    timeout: Schema.natural().min(500).max(120_000).default(10_000).role('ms').description('Embedding 请求超时，单位毫秒。'),
    maxInputCharacters: Schema.natural().min(100).max(32_000).default(4_000).description('单条事实送入 Embedding 的最大字符数。'),
    backfillBatchSize: Schema.natural().min(0).max(100).default(5).description('每轮后台补齐旧事实的数量。'),
    semanticStickerFilter: Schema.boolean().default(true).description('启用贴纸目录语义过滤：按当前消息的向量相似度只注入最相关的 12 条贴纸描述，降低每轮 token 开销。需要一条勾选“用作 Embedding 模型”的连接；不可用或素材尚未建立向量时自动回退全量目录。'),
  }) as unknown as Schema<EmbeddingConfig>).default({ enabled: false, liveQuery: false, semanticHistory: false, modelId: '', providerId: '', endpoint: '', model: '', dimensions: 0, timeout: 10_000, maxInputCharacters: 4_000, backfillBatchSize: 5, semanticStickerFilter: true }).description('Embedding 与历史语义召回。先配置 Embedding 连接，再按需开启历史召回。'),
  compaction: (Schema.object({
    enabled: Schema.boolean().default(true).description('启用后台剧本压缩与长期事实提取。'),
    temperature: Schema.number().min(0).max(2).default(0.3).description('压缩采样温度；建议保持较低以提高稳定性。'),
    maxTokens: Schema.natural().min(0).max(100_000).default(2048).description('压缩响应的最大 token 数。'),
    sideTaskMaxTokens: Schema.natural().min(0).max(100_000).default(4096).description('侧端 JSON 任务（时间导演/长线指导/日程预排）的最大输出 token。思考型模型会把 reasoning 计入此预算，需留足余量(建议 ≥4096)；0 = 不发送 max_tokens 限制。'),
    timeout: Schema.natural().min(1_000).max(300_000).default(60_000).role('ms').description('压缩请求超时，单位毫秒。'),
    topP: Schema.number().min(0).max(1).default(1).description('压缩请求的核采样概率。'),
    responseFormat: Schema.union(['json-object', 'prompt-only']).default('json-object').description('压缩请求的 JSON 模式；不支持时改为 prompt-only。'),
    mainPrompt: Schema.string().role('textarea').default('Compress completed scenes into concise continuity notes while preserving causality, promises, unresolved matters, and gradual character change.').description('压缩任务指令：定义摘要、事实和状态变更的提取目标。'),
    fixedPrompt: Schema.string().role('textarea').default('').description('压缩器必须遵守的长期规则。'),
    stylePrompt: Schema.string().role('textarea').default('Concise, factual, chronological, and concrete.').description('压缩结果的表达风格。'),
  }) as unknown as Schema<CompactionConfig>).default({ enabled: true, modelId: '', providerId: '', model: '', temperature: 0.3, topP: 1, maxTokens: 2048, timeout: 60_000, responseFormat: 'json-object', mainPrompt: 'Compress completed scenes into concise continuity notes while preserving causality, promises, unresolved matters, and gradual character change.', fixedPrompt: '', stylePrompt: 'Concise, factual, chronological, and concrete.' }).description('高级：后台压缩与 Preplan 共用启用状态、模型路由与请求参数框架；Preplan 另有独立的 maxTokens/温度限制。关闭压缩会让 Preplan 模型调用直接返回空。一般保持默认即可。').collapse(true),
})

const RestWindowSchema: Schema<RestWindow> = Schema.object({
  enabled: Schema.boolean().default(true).description('是否启用该休息窗口。'),
  label: Schema.string().default('night sleep').description('窗口名称，仅用于识别。'),
  start: Schema.string().pattern(/^\d{1,2}:\d{2}$/).default('23:00').description('窗口开始时间，格式 HH:mm。'),
  end: Schema.string().pattern(/^\d{1,2}:\d{2}$/).default('07:00').description('窗口结束时间，格式 HH:mm；可跨午夜。'),
  minIntervalMinutes: Schema.natural().min(30).max(1_440).default(120).description('窗口内自动推进的最短间隔。'),
  maxIntervalMinutes: Schema.natural().min(30).max(1_440).default(240).description('窗口内自动推进的最长间隔。'),
})

const Runtime: Schema<RuntimeConfig> = Schema.object({
  splitReplyMessages: Schema.boolean().default(true).description('是否将主叙事回复中的 <sep/> 拆成多条 QQ 消息。'),
  messageSeparator: Schema.string().default('<sep/>').description('分段消息标记。通常保持 <sep/>；模型会在需要多条气泡时输出它。'),
  convertNewlineToSeparator: Schema.boolean().default(false).description('小模型适配：模型没有输出分句标记而是用换行分条时，把每个换行自动视作一条消息的分隔再发送。默认关闭；Gemma 等不遵守 <sep/> 合约的小模型建议开启。'),
  typingBaseDelaySeconds: Schema.number().min(0).max(60).default(1).description('发送第二条及后续分段消息前的基础打字等待秒数。'),
  typingCharactersPerSecond: Schema.number().min(1).max(100).default(8).description('模拟打字速度，每秒字符数；数值越小，长消息等待越久。'),
  typingMaxDelaySeconds: Schema.number().min(0).max(120).default(12).description('单条后续分段消息的最长打字等待秒数。'),
  typingJitterRatio: Schema.number().min(0).max(0.5).step(0.05).default(0.3).description('打字延迟随机浮动；0 为固定延迟。'),
  userMessageDebounceSeconds: Schema.number().min(0).max(15).default(2).description('短消息合并等待秒数；0 关闭。'),
  forwardMessage: Schema.object({
    enabled: Schema.boolean().default(true).description('是否读取 QQ 合并转发正文；关闭时保留原有转发卡片文本行为。'),
    maxNodes: Schema.natural().min(1).max(100).default(30).description('单条合并转发最多读取的节点数。'),
    maxCharacters: Schema.natural().min(500).max(32_000).default(8_000).description('合并转发注入当前事件的最大字符数。'),
    maxDepth: Schema.natural().max(8).default(3).description('嵌套合并转发最多展开层数。'),
  }).default({ enabled: true, maxNodes: 30, maxCharacters: 8_000, maxDepth: 3 }).description('【消息扩展】QQ 合并转发读取预算。'),
  narrativeRetryDelaySeconds: Schema.natural().min(5).max(3_600).default(60).description('叙事模型请求失败后，自动再次尝试处理该用户回合前等待的秒数。'),
  narrativeRetryMaxAttempts: Schema.natural().min(0).max(50).default(6).description('单次用户回合因模型失败可自动重试的最多次数；0 表示关闭。'),
  captureDirectMessages: Schema.boolean().default(true).description('是否拦截并处理私聊文本消息。'),
  autoCreate: Schema.boolean().default(false).description('首次私聊时自动从 Console 档案创建故事。'),
  ignoreCommandMessages: Schema.boolean().default(true).description('是否跳过 interlude.* 管理命令，避免进入剧本。'),
  allowProactiveMessages: Schema.boolean().default(false).description('是否允许无新消息时向参与者主动发送可见消息。'),
  proactiveWillingnessThreshold: Schema.number().min(0).max(1).step(0.05).default(0.65).description('主动联系意愿门槛。'),
  sweepIntervalMinutes: Schema.natural().min(1).max(1_440).default(5).description('后台扫描周期；仅用于发现到期任务，不代表每轮都调用模型。'),
  minimumAdvanceMinutes: Schema.natural().min(1).max(10_080).default(30).description('手动“interlude.advance”的最小有效补写间隔；到期计划和对话后的短期补写不受此限制。'),
  maxStoriesPerSweep: Schema.natural().min(1).max(1_000).default(20).description('单轮后台扫描最多处理的主剧本数量。'),
  contextEntryLimit: Schema.natural().min(1).max(200).default(35).description('写入主叙事上下文的近期原始剧本条目数。小模型可调小（如 15）；注意与下方时间窗叠加——时间窗内条目会全部并入，需要更小上下文时请同时调小或关闭时间窗。'),
  contextTimeWindowMinutes: Schema.natural().min(0).max(1_440).default(45).description('额外并入最近多少分钟内的全部条目（上限 500）；0 关闭，仅按条数保留。小模型建议与条数一起调小。'),
  memoryLimit: Schema.natural().min(1).max(200).default(20).description('主叙事读取的长期事实数量；会经过相关性重排。'),
  maxScriptCharacters: Schema.natural().min(500).max(12_000).default(8_000).description('单次写作允许追加的剧本文本上限。'),
  maxMessageCharacters: Schema.natural().min(1).max(12_000).default(2_000).description('单条可见消息的最大字符数。'),
  minimumDelayedReplySeconds: Schema.natural().min(0).max(86_400).default(10).description('模型允许设置的最短延迟，单位秒。'),
  maximumDelayedReplyMinutes: Schema.natural().min(1).max(43_200).default(1_440).description('模型允许设置的最长延迟，单位分钟。'),
  cancelDelayedRepliesOnUserMessage: Schema.boolean().default(true).description('新消息到达时取消普通延迟回复。'),
  autoAdvanceEnabled: Schema.boolean().default(true).description('无对话时是否按真实时间补写角色生活。'),
  autoAdvanceIntervalMinutes: Schema.natural().min(5).max(1_440).default(40).description('普通时段自动推进的目标间隔，单位分钟。'),
  autoAdvanceJitterMinutes: Schema.natural().min(0).max(60).default(5).description('自动推进间隔的随机浮动范围，单位分钟。'),
  conversationFollowUpMinutes: Schema.array(Schema.natural().min(1).max(240)).default([10, 20]).description('一段对话结束后，额外补写生活的时间点，单位分钟。默认约第 10、20 分钟。'),
  conversationFollowUpJitterMinutes: Schema.natural().min(0).max(10).default(1).description('短期补写的随机浮动范围，单位分钟。填 0 可固定在指定时间点。'),
  restWindows: Schema.array(RestWindowSchema).role('table').default([
    { enabled: true, label: 'night sleep', start: '23:00', end: '07:00', minIntervalMinutes: 120, maxIntervalMinutes: 240 },
  ]).description('可配置多个低频推进窗口，例如睡眠或午休。'),
})

const BlindMode: Schema<BlindModeConfig> = Schema.object({
  enabled: Schema.boolean().default(false).description('启用沉浸运行：静默命令与 HDSI 日志，仅保留健康心跳。稳定后开启；关闭并重载即可恢复管理。'),
  healthReportMinutes: Schema.natural().min(1).max(1_440).default(10).description('健康心跳间隔，单位分钟。'),
}).description('0. 失明模式：沉浸式运行、命令静默与最小健康心跳。')

const SchedulePreplan: Schema<SchedulePreplanConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('启用近期日程审查与投影。'),
  horizonDays: Schema.natural().min(3).max(30).default(14).description('日程保存和展开天数。'),
  variationLevel: Schema.union(['stable', 'contextual', 'granular']).default('stable').description('变化颗粒度：稳定规律、阶段例外或少量候选变化。'),
  candidateActivationProbability: Schema.number().min(0.05).max(0.5).step(0.05).default(0.25).description('候选变化激活概率(仅【变化颗粒度=granular】的 tentative 块适用;按故事+日期+块标识确定性决定,不逐轮重掷)。'),
  candidateRevealMinutes: Schema.natural().min(15).max(360).default(120).description('候选具体内容的提前揭示时间(仅 granular 模式;已激活候选在揭示时间之前仅显示"可能的个人安排",进入揭示时间后显示具体内容;未激活候选不显示)。'),
  reviewAfterLocalHour: Schema.natural().min(0).max(23).default(3).description('每天从主角本地时间几点起允许进行一次空闲审查；没有新证据且覆盖充足时不调用模型。'),
  anchorAutoAdvance: Schema.boolean().default(true).description('让固定日程的开始/结束成为自动推进候选锚点，减少随机推进跨过上课、到校或离校等关键节点。'),
})

const Agency: Schema<AgencyConfig> = Schema.object({
  enabled: Schema.boolean().default(false).description('启用主体行动窗口。它只判断日程、隐私、设备和生活来源的联系理由，不读取或复用 Alter 情绪值。'),
  maxWindowMinutes: Schema.natural().min(5).max(1_440).default(240).description('一张 Agency Window 最长有效时间；过期后必须由新的生活回合重新判断。'),
  minimumProactiveIntervalMinutes: Schema.natural().min(0).max(10_080).default(60).description('同一参与者两次普通主动联系之间的安全间隔；承诺型联系可以绕过。'),
  maxCandidateHours: Schema.natural().min(1).max(168).default(24).description('生活产生的主动联系候选最长保留时间；过期后自然放下。'),
  contactMode: Schema.union([
    Schema.const('strict').description('严格（默认）：现状行为——沉默本身不是理由，动机须落在她的生活事实上'),
    Schema.const('natural').description('自然：想念、好奇近况、想分享此刻也是合法动机（须剧本显示她真的想到对方）；放宽意愿阈值与安全间隔'),
    Schema.const('balanced').description('平衡：同自然，但提示词要求节制使用情感动机，多数联系仍跟随具体生活理由'),
  ]).default('strict').description('主动联系温度。'),
  naturalWillingnessThreshold: Schema.number().min(0).max(1).step(0.05).default(0.25).description('自然/平衡模式的意愿阈值（严格模式沿用 Urge/运行时阈值）。'),
  naturalMinimumIntervalMinutes: Schema.natural().min(0).max(10_080).default(30).description('自然/平衡模式的安全间隔分钟；仅当小于严格间隔时生效。'),
  proactiveDailyCap: Schema.natural().min(0).max(20).default(3).description('每参与者每 24 小时主动联系上限（全模式生效；0 = 不限）。'),
}).collapse(true)

const ChatRhythm: Schema<ChatRhythmConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('启用聊天节奏反定型：检测主角回复结构的定型，并以主角视角的描写召唤她本来的节奏多样性。'),
  mode: Schema.union(['gentle', 'balanced', 'aggressive']).default('balanced').description('检测档位。gentle：仅结构完全同构时判定；balanced：增加尾段语气复读与字数箱体两条判据；aggressive：收紧样本要求，更早触发。'),
  historyLimit: Schema.natural().min(5).max(20).default(12).description('节奏签名的历史窗口轮数。'),
  collapseMinSamples: Schema.natural().min(3).max(10).default(5).description('开始判定定型所需的最少样本轮数（宽限期）。档位不同时有各自默认值，手动填写后以手填为准。'),
  exhaustLimit: Schema.natural().min(3).max(12).default(6).description('连续跟随失败的熔断轮数；熔断后停止注入，直到重置或更换主叙事模型。'),
}).description('聊天节奏反定型设置。')

const AlterSystem: Schema<AlterSystemConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('启用情绪偏移追踪。它只增加临时氛围参考，不替代 recentScript、continuity 或稳定设定。'),
  baseThreshold: Schema.number().min(1).max(50).default(10).description('Alter 累计绝对值达到此基础阈值时调用侧端分析模型。按各参与者/独立生活 scope 分别累计,不是全故事总量。'),
  densityFactor: Schema.number().min(0).max(1).step(0.05).default(0.3).description('最近一小时该 scope 的叙事越密集，阈值降低的比例越大；运行时最低不会低于基础阈值的一半。'),
  sameDirectionBoost: Schema.number().min(0).max(1).step(0.01).default(0.05).description('新变化与上次触发方向一致时，每点 Alter 增加的提示权重。'),
  oppositeDecay: Schema.number().min(0).max(1).step(0.01).default(0.15).description('新变化与上次触发方向相反时，每点 Alter 衰减的提示权重。'),
  minWeight: Schema.number().min(0).max(1).step(0.05).default(0.2).description('权重低于该值时清除当前 emotionalOffset。'),
  maxIntensity: Schema.number().min(1).max(3).step(0.1).default(2).description('触发值超过阈值时允许的最大情绪偏移强度。'),
  temperature: Schema.number().min(0).max(2).step(0.1).default(0.3).description('侧端分析温度。较低值能保持描述稳定而不过度发挥。'),
  topP: Schema.number().min(0).max(1).step(0.05).default(1).description('侧端分析 top_p。'),
  maxTokens: Schema.natural().min(64).max(16_000).default(2000).description('侧端分析最大输出 token。思考型模型需给 reasoning 留余量(建议 ≥2000)。'),
  timeout: Schema.natural().min(1_000).max(120_000).default(30_000).role('ms').description('侧端分析超时。失败时保留累计值，稍后重试。'),
  prompt: Schema.string().role('textarea').default('').description('侧端分析的附加要求；不能覆盖固定的 JSON、隐私和非指令化约束。'),
}).collapse(true)

const Browser: Schema<BrowserConfig> = Schema.object({
  enabled: Schema.boolean().default(false).description('启用 Puppeteer 只读网页观察。还需要在 Koishi 安装并启用 puppeteer 插件；未启用时聊天功能不受影响。'),
  mode: Schema.union(['deferred-only', 'allow-immediate']).default('deferred-only').description('延后浏览不会增加当前回复等待；允许即时浏览时，主模型可为少数当前私聊额外读取一次网页，因此回复会更慢。'),
  allowSearch: Schema.boolean().default(true).description('允许主角提出网页搜索意图。搜索结果会作为之后的网页观察进入剧本。'),
  allowVisit: Schema.boolean().default(true).description('允许主角访问安全策略允许的公开网页 URL。不会登录、填写表单、下载或发布内容。'),
  searchUrlTemplate: Schema.string().default('https://html.duckduckgo.com/html/?q={query}').description('搜索地址模板，必须包含 {query}。默认使用 DuckDuckGo 的轻量结果页。'),
  allowedDomains: Schema.array(Schema.string()).role('table').default([]).description('允许访问的域名白名单；留空表示不额外限制。填入后，仅这些域名及其子域名可访问。'),
  blockedDomains: Schema.array(Schema.string()).role('table').default([]).description('永远禁止访问的域名黑名单；localhost、私网地址和非 HTTP(S) 地址始终禁止。'),
  maxConcurrentPages: Schema.natural().min(1).max(4).default(1).description('同时打开的网页页数上限。建议保持 1，避免浏览器占用影响 Koishi。'),
  maxResearchPerSweep: Schema.natural().min(1).max(20).default(1).description('每轮后台最多处理的网页浏览意图数。保持 1 可避免网页积压拖慢剧本队列。'),
  navigationTimeout: Schema.natural().min(1_000).max(120_000).default(15_000).role('ms').description('单页加载超时，单位毫秒。超时会记录失败观察，不会中断剧本。'),
  waitUntil: Schema.union(['domcontentloaded', 'networkidle2']).default('domcontentloaded').description('读取网页的等待条件。domcontentloaded 更快；networkidle2 对动态页面更完整但更慢。'),
  maxTextCharacters: Schema.natural().min(500).max(50_000).default(12_000).description('从网页正文提取的最大字符数。仅提取可见文本，不保存 HTML。'),
  maxExcerptCharacters: Schema.natural().min(200).max(12_000).default(3_000).description('单条网页观察送给主模型的最大字符数。'),
  maxObservationsInPrompt: Schema.natural().min(1).max(20).default(4).description('单次主叙事请求附带的最近网页观察数量。'),
  cacheMinutes: Schema.natural().min(0).max(10_080).default(30).description('相同搜索或 URL 在此时间内复用已有观察，减少重复浏览；0 表示每次重新读取。'),
  allowGroupTriggeredResearch: Schema.boolean().default(false).description('启用群聊浏览意图。默认关闭，避免群成员内容触发角色浏览。'),
  logObservationPreview: Schema.boolean().default(false).description('在日志中显示网页观察的标题和节选；网页内容可能包含隐私或不可信文本，生产环境建议关闭。'),
}).collapse(true)

const Memory: Schema<MemoryConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('启用场景压缩、长期事实和状态演化。'),
  backgroundIntervalMinutes: Schema.natural().min(1).max(1_440).default(10).description('后台记忆整理检查周期，单位分钟。'),
  sceneEntryThreshold: Schema.natural().min(1).max(500).default(16).description('未压缩剧本条目达到此数量时触发整理。默认 16 条，减少短对话中的频繁后台调用。'),
  sceneCharacterThreshold: Schema.natural().min(500).max(200_000).default(10_000).description('未压缩剧本字符数达到此值时触发整理。默认 10000 字，长场景会优先保持连续性。'),
  recentEntryLimit: Schema.natural().min(1).max(200).default(30).description('每次主叙事请求附带的最近原始条目数。'),
  factLimit: Schema.natural().min(1).max(200).default(20).description('每次主叙事请求附带的长期事实数。'),
  statePatchConfidenceThreshold: Schema.number().min(0).max(1).default(0.82).description('普通设定变更的最低置信度；低于此值只保留为候选。'),
  majorStatePatchConfidenceThreshold: Schema.number().min(0).max(1).default(0.95).description('重大设定变更的最低置信度。'),
  statePatchMinEvidence: Schema.natural().min(1).max(20).default(3).description('【兼容旧配置】已被 statePatchMinTurns 取代；仅当后者未设置时生效，新配置请改用 statePatchMinTurns。'),
  statePatchMinTurns: Schema.natural().min(1).max(20).default(3).description('普通人格或关系变化至少需要来自多少个不同剧本回合。可调低至 1 加快演化(证据要求随之变松)。'),
  statePatchMajorMinScenes: Schema.natural().min(1).max(20).default(2).description('重大(major)设定变更自动应用所需的最少独立场景数。默认 2。'),
  statePatchMinDays: Schema.natural().min(1).max(30).default(2).description('普通变化至少要跨越多少个日历日；重大事件不受此限制。'),
  statePatchCooldownHours: Schema.natural().min(1).max(720).default(72).description('同一人格或关系路径应用一次长期变化后，多少小时内不再应用新的变化。'),
  maxFactsPerStory: Schema.natural().min(10).max(2_000).default(200).description('单个主剧本保留的长期事实总量上限。'),
  maxStoriesPerCompactionRun: Schema.natural().min(1).max(1_000).default(20).description('单轮后台整理最多处理的主剧本数。'),
  compactionEntryLimit: Schema.natural().min(1).max(500).default(80).description('压缩模型单次读取的最大剧本条目数。'),
  compactionCharacterLimit: Schema.natural().min(500).max(200_000).default(32_000).description('压缩模型单次读取的最大字符数。'),
  sceneHookCharacters: Schema.natural().min(100).max(10_000).default(2_000).description('场景引子的最大字符数。'),
  sceneSummaryCharacters: Schema.natural().min(500).max(50_000).default(8_000).description('场景摘要的最大字符数。'),
  arcSummaryCharacters: Schema.natural().min(500).max(100_000).default(12_000).description('剧情弧线摘要的最大字符数(存储与压缩写入侧)。'),
  arcPromptCharacters: Schema.natural().min(500).max(100_000).default(6_000).description('弧摘要随每回合提示词携带的最大字符数;超长时保留尾部(最贴近当前剧情),全量仍存库供压缩使用。'),
  previousSceneSummaries: Schema.natural().min(0).max(4).default(2).description('随主提示词附带几个紧邻已关闭场景的摘要（每条裁剪至 2000 字符，带时间范围），填补原始窗口与弧线摘要之间的记忆缝隙。0 表示关闭。'),
  factContentCharacters: Schema.natural().min(100).max(20_000).default(4_000).description('单条长期事实的最大字符数。'),
  factImportanceWeight: Schema.number().min(0).max(1).default(0.5).description('事实排序中的重要度权重。'),
  factConfidenceWeight: Schema.number().min(0).max(1).default(0.35).description('事实排序中的置信度权重。'),
  factRecencyWeight: Schema.number().min(0).max(1).default(0.15).description('事实排序中的时间衰减权重。'),
  semanticWeight: Schema.number().min(0).max(2).default(0.55).description('启用 Embedding 后的语义相关度权重。'),
  unresolvedWeight: Schema.number().min(0).max(2).default(0.2).description('未解决事项的额外排序权重。'),
  autoApplyStatePatches: Schema.boolean().default(true).description('是否自动应用达到门槛的设定演化建议。关闭后提案不再自动应用——需用 interlude.memory.apply 逐条手动批准,否则会持续停留在待积累状态。'),
  allowMajorStateChanges: Schema.boolean().default(true).description('是否允许自动应用重大人物或世界状态变更。关闭后 major 提案会停留在待积累状态(不算被拒绝),同样可用 interlude.memory.apply 手动批准。'),
  activeConsequencesEnabled: Schema.boolean().default(true).description('启用“剧情余波”：让确实影响后续生活的谈话或事件，在之后的写作中持续发挥短期作用。关闭后不会新增或注入余波。'),
  activeConsequencePromptLimit: Schema.natural().min(1).max(20).default(6).description('单次主叙事写作最多携带几条仍在生效的剧情余波。数值越高，连续性更强，但会增加少量上下文。'),
  activeConsequenceMaxDays: Schema.natural().min(1).max(30).default(7).description('一条剧情余波最长保留多少天。到期后会自然淡出；它不用于永久修改角色设定。'),
  activeConsequenceDefaultStrength: Schema.number().min(0).max(1).step(0.05).default(0.55).description('剧情余波未写明强度时的默认影响程度。0 表示极轻微，1 表示会明显影响主角近期生活。'),
  overlayCompressionEnabled: Schema.boolean().default(true).description('将较久以前、已应用的人设和关系变化压缩为分层摘要；不会改变 Canon 或删除原始补丁。'),
  overlayRecentDays: Schema.natural().min(1).max(14).default(2).description('最近多少天的 overlay 变化保留原始细节，不进入压缩。默认 2 天。'),
  overlayMonthlyAfterDays: Schema.natural().min(5).max(180).default(10).description('超过多少天后，将短期摘要合并为长期状态。默认 10 天。'),
  overlayWeeklyWindowDays: Schema.natural().min(1).max(14).default(5).description('短期 overlay 摘要的合并窗口。默认每 5 天合并一次。'),
  overlayMonthlyWindowDays: Schema.natural().min(5).max(30).default(10).description('长期 overlay 状态的合并窗口。默认每 10 天合并一次。'),
  overlayWeeklySummaryCharacters: Schema.natural().min(300).max(8_000).default(1_600).description('单个短期(周窗口)overlay 摘要的最大字符数;窗口宽度见 overlayWeeklyWindowDays。'),
  overlayMonthlySummaryCharacters: Schema.natural().min(300).max(12_000).default(2_400).description('单个长期 overlay 摘要的最大字符数。'),
}).collapse(true)

const StoryDefaults: Schema<StoryDefaults> = Schema.object({
  characterName: Schema.string().default('Unnamed character').description('主角显示名称。'),
  characterProfile: Schema.string().role('textarea').default('').description('主角背景、性格、日程与说话方式。'),
  perspective: Schema.string().role('textarea').default('').description('主角稳定的价值观和看待世界方式（单条总述；多条独立观点请用 perspectives）。'),
  perspectives: Schema.array(Schema.string().role('textarea')).default([]).description('主角多条独立价值观/视角：每条一段，进入提示词时保持独立条目不合并。'),
  supplementaryFacts: Schema.array(Schema.string().role('textarea')).default([]).description('补充事实：界限不明显的世界/人物/关系复杂事实，每条一段，作为初始长期事实注入。'),
  userProfile: Schema.string().role('textarea').default('').description('默认用户资料；可由白名单行覆盖。'),
  relationship: Schema.string().role('textarea').default('').description('默认初始关系；可由白名单行覆盖。'),
  world: Schema.string().role('textarea').default('').description('故事时代、地点与现实规则。'),
  supportingCast: Schema.string().role('textarea').default('').description('配角及其与主角的关系；无配角可留空。'),
  location: Schema.string().default('').description('主角的主要活动地点。'),
  style: Schema.string().role('textarea').default('现实主义日常叙事，情绪克制，关系变化缓慢而具体。').description('故事级叙事文风。'),
  timezone: Schema.string().default('Asia/Shanghai').description('用于自动推进、休息窗口和延迟时间解析的 IANA 时区。'),
})

const Logging: Schema<LoggingConfig> = Schema.object({
  level: Schema.union(['silent', 'error', 'warn', 'info', 'debug']).default('info').description('日志级别。'),
  verbosity: Schema.union(['summary', 'standard', 'diagnostic']).default('standard').description('运行信息密度：摘要只显示关键结果；标准显示模型、计时器和后台任务；诊断追加跳过原因、队列和上下文统计。'),
  format: Schema.union(['layered', 'compact', 'detailed']).default('layered').description('显示布局：layered 为彩色任务时间线；compact 为单行；detailed 为兼容旧版的分行格式。'),
  colors: Schema.boolean().default(true).description('为阶段、完成、警告、错误、记忆和 Alter 添加 ANSI 语义颜色；Koishi Console 与常规终端均可渲染。'),
  colorTheme: Schema.union(['dark', 'light']).default('dark').description('深色或浅色 Console 配色。'),
  kaomoji: Schema.boolean().default(true).description('使用颜文字标识运行阶段。'),
  logScriptPreview: Schema.boolean().default(false).description('是否输出本轮剧本内容；可能包含私聊信息，生产环境建议关闭。'),
  logMessageContent: Schema.boolean().default(false).description('是否输出用户消息和主角可见消息内容；涉及隐私，生产环境建议关闭。'),
  previewLength: Schema.natural().min(50).max(4_000).default(500).description('剧本和消息内容写入日志时的最大字符数。'),
}).collapse(true)

const OneBotBotAccount: Schema<OneBotAccountRule> = Schema.object({
  qq: Schema.string().default('').description('机器人 QQ 号；为空表示不限制发送账号。'),
  label: Schema.string().default('').description('账号备注，仅用于识别。'),
  enabled: Schema.boolean().default(true).description('是否允许此机器人账号投递角色消息。'),
})

// The allowlist is also the identity sheet for the shared story. Each row is
// a collapsible card, so the two long narrative fields get full-width editors.
const OneBotUserAccount: Schema<OneBotAccountRule> = Schema.object({
  qq: Schema.string().default('').description('允许互动的用户 QQ；未列出的账号直接拒绝。'),
  label: Schema.string().default('').description('主角对该用户的称呼；留空时使用平台昵称。'),
  personId: Schema.string().default('').description('稳定的人物标识；同一现实人物的多个账号可复用。'),
  profile: Schema.string().role('textarea').default('').description('主角已知的用户背景；仅用于该关系分支。'),
  relationship: Schema.string().role('textarea').default('').description('该用户与主角的初始关系，例如“熟悉但近来联系不多”。'),
  enabled: Schema.boolean().default(true).description('是否接受该账号的私聊并允许向其投递消息。'),
}).collapse(true)

const WillingnessTierChoice = Schema.union([
  Schema.const('quiet').description('极少：约每 10 条普通消息一次'),
  Schema.const('reserved').description('谨慎：约每 6~8 条一次'),
  Schema.const('normal').description('标准：约每 4~5 条一次'),
  Schema.const('active').description('活跃：约每 2~3 条一次'),
  Schema.const('eager').description('热情：几乎每批都想说'),
])
const GroupWillingnessAuto = Schema.object({
  busy: WillingnessTierChoice.default('quiet').description('忙碌时使用的档位。'),
  idle: WillingnessTierChoice.default('active').description('空闲时使用的档位。'),
  asleep: WillingnessTierChoice.default('quiet').description('睡眠时使用的档位（额外有概率×0.2 与 @ 阻断）。'),
}).collapse(true)

const GroupWillingness: Schema<GroupWillingnessConfig> = Schema.object({
  enabled: Schema.boolean().default(false).description('启用本地群聊意愿门，不增加模型调用。'),
  maxScore: Schema.number().min(0.1).max(10).step(0.05).default(1).description('意愿累积上限。'),
  threshold: Schema.number().min(0).max(10).step(0.01).default(0.24).description('低于此分数时保持静默。'),
  probabilityAmplifier: Schema.number().min(0).max(10).step(0.05).default(1.3).description('超过阈值后的发言概率增幅。'),
  decayHalfLifeSeconds: Schema.natural().min(10).max(86_400).default(180).description('意愿自然衰减到一半所需秒数。'),
  replyCost: Schema.number().min(0).max(10).step(0.05).default(0.55).description('主角成功在群内发言后扣除的意愿。'),
  baseGain: Schema.number().min(0).max(10).step(0.01).default(0.12).description('每批普通群消息带来的基础意愿。'),
  quoteGain: Schema.number().min(0).max(10).step(0.01).default(0.12).description('引用机器人消息时的额外意愿。'),
  keywordGain: Schema.number().min(0).max(10).step(0.01).default(0.18).description('命中关键词时的额外意愿。'),
  keywords: Schema.array(Schema.string()).role('table').default([]).description('命中后增加群聊意愿。'),
}).collapse(true)

const GroupChatRuleSchema: Schema<GroupChatRule> = (Schema.object({
  groupId: Schema.string().default('').description('QQ 群号。只有列在这里且启用的群会被插件处理。'),
  label: Schema.string().default('').description('群聊备注，帮助主模型理解这个群。'),
  enabled: Schema.boolean().default(true).description('是否允许插件读取并参与这个群。'),
  assignee: Schema.string().default('').description('群受理人（机器人 QQ）：填写已启用的机器人白名单账号，启动/重载时同步到 Koishi 频道受理人；留空不修改。不会解除频道忽略标记。'),
  purpose: Schema.string().role('textarea').default('').description('这个群主要做什么，例如“同事讨论项目”或“朋友闲聊”。'),
  characterRole: Schema.string().role('textarea').default('').description('主角在群里的身份和说话位置。'),
  responseMode: Schema.union(['mention-only', 'always']).default('mention-only').description('mention-only: 仅在被 @ 时触发主叙事；always: 所有群消息进入上下文，是否调用主叙事仍受意愿与冷却控制。两种模式都受 Koishi 频道受理人限制。'),
  contextLimit: Schema.natural().min(4).max(100).default(20).description('进入主叙事时附带的最近群消息条数。'),
  debounceSeconds: Schema.number().min(0).max(10).default(1).description('合并短时间连续群消息后再开始主叙事的等待秒数。'),
  cooldownSeconds: Schema.natural().min(0).max(86_400).default(60).description('主角群发言后的冷却时间，避免连续刷屏。'),
  historicalImageLimit: Schema.natural().min(0).max(6).default(3).description('一次群聊主叙事最多附带的最近历史图片张数；图片消息本身不会因此自动触发模型。'),
  willingnessPreset: Schema.union([
    Schema.const('off').description('关闭（默认）：仅响应模式与冷却生效；旧数值门已启用时自动按 custom 兼容'),
    WillingnessTierChoice,
    Schema.const('auto').description('自动：按压缩器生活状态切换；状态缺失、无效或超过 6 小时未刷新时按 idle 档位；睡眠时 @ 不直通。'),
    Schema.const('custom').description('自定义：使用下方旧数值参数'),
  ]).default('off').description('群聊发言意愿档位。'),
  willingnessAuto: GroupWillingnessAuto.default({ busy: 'quiet', idle: 'active', asleep: 'quiet' }).description('auto 档的三态映射。'),
  willingness: GroupWillingness.default({ enabled: false, maxScore: 1, threshold: 0.24, probabilityAmplifier: 1.3, decayHalfLifeSeconds: 180, replyCost: 0.55, baseGain: 0.12, quoteGain: 0.12, keywordGain: 0.18, keywords: [] }).description('自定义数值门（仅 willingnessPreset=custom 时生效；keywords 对所有档位生效）；@ 直接通过，睡眠态除外。'),
}) as unknown as Schema<GroupChatRule>).collapse(true)

const OneBot: Schema<OneBotNapCatConfig> = Schema.object({
  enabled: Schema.boolean().default(false).description('启用 OneBot/NapCat 账号过滤。默认关闭：未配置时沿用旧行为（不过滤）；启用后空白名单拒绝全部，须同时配置机器人/用户白名单。'),
  botAccounts: Schema.array(OneBotBotAccount).role('table').default([]).description('机器人账号白名单；空表拒绝全部账号。'),
  userAccounts: Schema.array(OneBotUserAccount).default([]).description('用户白名单与初始关系；空表拒绝全部私聊。'),
  groupChats: Schema.array(GroupChatRuleSchema).default([]).description('群聊白名单与角色定位。'),
  ignoreSelfMessages: Schema.boolean().default(true).description('忽略机器人自身产生的消息事件。'),
})

const ChatActions: Schema<ChatActionsConfig> = Schema.object({
  enabled: Schema.boolean().default(false).description('启用聊天动作。'),
  platforms: Schema.array(Schema.union(['qq', 'wechat'])).role('table').default(['qq']).description('允许使用动作的平台。'),
  quoteReply: Schema.boolean().default(true).description('允许主角引用当前上下文中的一条消息进行指定回复。'),
  messageReactions: Schema.boolean().default(true).description('允许消息表情回应。'),
  allowedReactions: Schema.array(Schema.union(['like', 'smile', 'laugh', 'heart', 'surprised', 'sad', 'angry'])).role('table')
    .default(['like', 'smile', 'laugh', 'heart'] as ChatReactionName[])
    .description('主模型可以选择的语义表情；平台连接器负责转换为实际表情编号。'),
  nativeFaces: Schema.boolean().default(true).description('允许主角在需要时发送 QQ 原生小表情。'),
  expressionThreshold: Schema.number().min(0).max(1).step(0.05).default(0.7).description('表情与本地表情包的最低表达意愿。'),
  allowedNativeFaces: Schema.array(Schema.union(['smile', 'laugh', 'sweat', 'awkward', 'heart', 'surprised', 'sad', 'angry'])).role('table')
    .default(['smile', 'laugh', 'sweat', 'awkward'] as NativeFaceSemantic[])
    .description('允许主模型使用的 QQ 原生表情语义。'),
}).collapse(true)

const Stickers: Schema<StickerLibraryConfig> = Schema.object({
  enabled: Schema.boolean().default(false).description('启用本地表情包库。'),
  directory: Schema.path({ allowCreate: true, filters: ['directory'] }).default('data/hds-interlude/stickers').description('本地表情包根目录；一级子文件夹会成为素材分组。'),
  maxFileSizeMB: Schema.natural().min(1).max(30).default(10).description('单个表情包允许扫描的最大体积，单位 MB。'),
  catalogLimit: Schema.natural().min(1).max(80).default(40).description('单次主模型最多读取多少条表情包描述。'),
  descriptionMaxTokens: Schema.natural().min(256).max(4_096).default(768).description('单张表情包描述的最大输出 token。'),
  descriptionResponseFormat: Schema.union(['json-object', 'prompt-only']).default('json-object').description('表情包描述输出格式。'),
  deliveryBaseUrl: Schema.string().default('').description('表情包投递基址；留空自动推导（selfUrl → http://127.0.0.1:5140）。Koishi 与 OneBot 实现（NapCat/Lagrange）分容器或不共享文件系统时，file:// 路径对方读不到（retcode 1200/100），需要让 OneBot 实现经此 HTTP 地址回源下载。'),
  deliveryMode: Schema.union([
    Schema.const('auto').description('自动（默认）：HTTP 回源路由可用走 HTTP；宿主未加载 server/router 时退回 file:// 本地路径（同容器/同主机的 OneBot 实现可直接读文件）'),
    Schema.const('http').description('强制 HTTP 回源（分容器部署，需保证 deliveryBaseUrl 可达）'),
    Schema.const('file').description('强制 file:// 本地路径（OneBot 实现与 Koishi 共享文件系统）'),
  ]).default('auto').description('表情包投递模式。'),
}).collapse(true)

const SharedStory: Schema<SharedStoryConfig> = Schema.object({
  autoEnrollParticipants: Schema.boolean().default(true).description('白名单用户首次私聊时是否自动加入主剧本。'),
  allowCrossConversationMessages: Schema.boolean().default(true).description('是否允许主模型向其它参与者生成跨账号消息。'),
  shareParticipantDetails: Schema.boolean().default(false).description('是否向模型提供其它参与者的历史剧本；关系字段始终匿名，涉及隐私请谨慎开启。'),
  maxCrossConversationActions: Schema.natural().min(0).max(5).default(1).description('单次主模型回合最多执行的跨账号投递动作。'),
  participantContextLimit: Schema.natural().min(1).max(20).default(6).description('单次请求附带的其它参与者上下文数量。'),
  managerAccounts: Schema.array(Schema.string()).role('table').default([]).description('可执行管理命令的 QQ；留空表示所有已授权用户。'),
}).collapse(true)

const UrgeAdvanced = Schema.object({
  hotMin: Schema.number().min(1).max(1440).description('密聊最短等待（分钟）；留空按档位。'),
  hotMax: Schema.number().min(1).max(1440).description('密聊最长等待（分钟）。'),
  idleMin: Schema.number().min(1).max(1440).description('安静期最短等待（分钟）。'),
  idleMax: Schema.number().min(1).max(1440).description('安静期最长等待（分钟）。'),
  burstMin: Schema.number().min(1).max(1440).description('加速首轮最短等待（分钟）；以后逐步翻倍。'),
  burstMax: Schema.number().min(1).max(1440).description('加速首轮最长等待（分钟）。'),
  slowMin: Schema.number().min(1).max(1440).description('剧本 slow 最短等待（分钟）。'),
  slowMax: Schema.number().min(1).max(1440).description('剧本 slow 最长等待（分钟）。'),
  halfLifeMinutes: Schema.number().min(5).max(240).default(90).description('真实对话热度半衰期（分钟）。对话结束后高密度推进的持续期。'),
  burstThreshold: Schema.number().min(0).max(1).step(.05).default(.75).description('启动加速的有效 Urge；仍需主动行动和发送回执。'),
  jitter: Schema.number().min(0).max(1).step(.05).default(.15).description('Urge 值随机偏移幅度，不改变联系意愿。'),
  extremeChance: Schema.number().min(0).max(1).step(.01).default(.03).description('改为全区间抽样的概率；0 关闭。'),
  burstTtlMinutes: Schema.number().min(5).max(120).default(35).description('同一联系加速段有效期（分钟），不会自行续满。'),
  burstBudget: Schema.natural().max(10).default(3).description('一段最多额外推进次数；0 关闭加速。'),
  burstContactMinMinutes: Schema.number().min(1).max(60).default(5).description('有效加速段中本对象的最短联系间隔，其他 Agency 条件保留。'),
  activeMultiplier: Schema.number().min(1).max(3).step(.1).default(1.4).description('对话密度满值时的推进加速倍率（乘法因子；与生活节奏倍率相乘）。1.4 = 密集对话时推进密度提升 40%。'),
  restMultiplier: Schema.number().min(.05).max(1).step(.05).default(.6).description('无节奏数据且在休息窗口时的兜底倍率（乘法因子，不再替换间隔）。0.6 = 推进密度打六折。'),
}).collapse(true)

export const Config: Schema<InterludeConfig> = Schema.object({
  storyDefaults: StoryDefaults.description('【必填 1】故事档案：主角、世界、默认关系、地点、时区与叙事风格。'),
  model: Model.description('【必填 2】模型中心：先添加连接并勾选用途；主叙事参数与高级模块保持在同一处。'),
  onebot: OneBot.description('【必填 3】QQ 接入：机器人账号、私聊白名单、群聊与语音。'),
  sharedStory: SharedStory.description('【结构 4】共享主剧本：多人参与、跨账号行为与管理员权限。'),
  runtime: Runtime.description('【节奏 5】运行时：消息合并、打字、失败重试与自动生活推进。'),
  urge: Schema.object({
    enabled: Schema.boolean().default(false).description('启用弹性推进，替代固定间隔及对话后 10/20 分钟补写；不改变剧本文本。总自动推进开关仍优先。'),
    frequency: Schema.union(['low', 'medium', 'high', 'custom']).default('medium').description('低/中/高频或自定义；自定义未填写项沿用中频。高频会增加主叙事和时间导演调用。'),
    proactiveWillingnessThreshold: Schema.number().min(0).max(1).step(.05).default(.4).description('仅 Urge 启用时的主动联系意愿门槛(Agency strict 模式使用;natural/balanced 模式改用 Agency 的 naturalWillingnessThreshold,调这里不生效)；不是发送概率。'),
    advanced: UrgeAdvanced.description('高级时间范围、随机性与调用预算；填写时间覆盖档位。'),
  }).description('【节奏 6】Urge 弹性推进：剧本驱动的自动调度，压缩器五档生活节奏×对话密度双因子乘法模型（可选，替代固定间隔）。'),
  schedulePreplan: SchedulePreplan.description('【节奏 7】日程预排：近期稳定日程与变化颗粒度；主提示词只读取未来约半天。'),
  timelineDirector: Schema.object({ enabled: Schema.boolean().default(true).description('启用时间导演：自动回合先生成相对时间账本——只提供客观时间事实与可能的时间逻辑，不做笃定的未来预测（如几点起床）；用户消息对主角的影响由主模型判断。失败时降级为无账本推进，不冻结自动推进。'), }).description('【节奏 8】时间导演：自动回合的时间账本与熔断保护。'),
  agency: Agency.description('【节奏 9】Agency 行动窗口：日程压力、隐私、设备和生活来源的联系条件。'),
  chatActions: ChatActions.default({ enabled: false, platforms: ['qq'], quoteReply: true, messageReactions: true, allowedReactions: ['like', 'smile', 'laugh', 'heart'], nativeFaces: true, expressionThreshold: 0.7, allowedNativeFaces: ['smile', 'laugh', 'sweat', 'awkward'] }).description('【表达 10】聊天动作：引用回复、贴反应与 QQ 原生表情。'),
  stickers: Stickers.default({ enabled: false, directory: 'data/hds-interlude/stickers', maxFileSizeMB: 10, catalogLimit: 40 }).description('【表达 11】本地表情包：启用后扫描素材，并由视觉模型建立描述。'),
  memory: Memory.description('【内在 12】记忆与连续性：场景压缩、事实召回、剧情余波和设定演化。'),
  alterSystem: AlterSystem.description('【内在 13】Alter 情绪：低频氛围偏移、动态阈值、权重和侧端分析。'),
  browser: Browser.description('【扩展 14】网页观察：Puppeteer 只读浏览与安全边界。'),
  worldSeeder: Schema.object({
    enabled: Schema.boolean().default(false).description('启用世界事件播种器：后台低频生成与她有关的外部事件（线下通道、NPC），到点以 [世界事件] 条目进入剧本。模型在【必填 2】模型中心的连接上勾选“用于世界播种”选择；未勾选任何连接时本开关无效。'),
    cadenceMinutes: Schema.natural().min(5).max(1_440).default(30).description('生成检查间隔（分钟）；偶发跳过整轮检查，多数检查输出空。'),
    maxPending: Schema.natural().min(1).max(20).default(6).description('同时挂起的未注入事件上限。'),
    dailyCap: Schema.natural().min(1).max(20).default(8).description('每 24 小时注入上限（高重要性每天至多 1 条）。'),
    maxHorizonHours: Schema.natural().min(1).max(336).default(72).description('事件最远发生时限（小时）。'),
    temperature: Schema.number().min(0).max(2).default(0.9).description('生成温度。'),
    maxTokens: Schema.natural().min(256).max(8_192).default(1_000).description('单次输出预算（tokens）。'),
    timeout: Schema.natural().min(5_000).max(300_000).default(60_000).description('请求超时（毫秒）。'),
  }).collapse(true).description('【扩展 15】世界播种器：外部事件的生成与注入（未选模型即关闭）。'),
  longHorizon: Schema.object({
    enabled: Schema.boolean().default(false).description('实验：长线叙事催化器（Narrative Attractor）——累计加权叙事证据后异步生成可控的长期发展方向，并允许主叙事在自然场景中尝试一次最小、可撤回的首次表达。'),
    triggerScore: Schema.natural().min(10).max(500).default(25).description('首次生成的加权分数门槛（默认25；私聊1.0/群聊0.5）。'),
    reviewIncrement: Schema.natural().min(10).max(500).default(40).description('上次催化器生成后再积累多少分触发一次新的长期发展机会审查。'),
    privateWeight: Schema.number().min(0.1).max(2.0).step(0.1).default(1.0).description('兼容旧配置；实际固定为 1.0（私聊完全计入）。'),
    groupWeight: Schema.number().min(0).max(1.0).step(0.1).default(0.5).description('兼容旧配置；实际固定为 0.5（群聊减半计入）。'),
    intensity: Schema.union(['subtle', 'moderate', 'strong']).default('subtle').description('指导强度（第一版默认 subtle）。'),
  }).collapse(true).description('【扩展 16】长线叙事催化器（实验）：生成潜在张力与首次微表达许可（默认关闭）。'),
  qzone: Schema.object({
    enabled: Schema.boolean().default(false).description('启用 QQ 空间（说说）通道：需要 SnowLuma 连接在线（qzone 系列扩展动作）。启用后可经 interlude.qzone 命令以她本人身份发说说;满足运行条件时叙事也会自动读取好友动态,并按模型安排的发帖/评论/点赞意图在限流内执行。高频会被 Qzone 风控，请保持保守上限。'),
    dailyPostCap: Schema.natural().min(0).max(20).default(3).description('每日发帖上限（0=禁止发帖）。'),
    dailyCommentCap: Schema.natural().min(0).max(60).default(6).description('每日评论上限（0=禁止评论）。'),
    dailyLikeCap: Schema.natural().min(0).max(120).default(12).description('每日点赞上限（0=禁止点赞）。'),
    minIntervalMinutes: Schema.natural().min(10).max(1_440).default(90).description('任意两次空间动作的最小间隔（分钟），跨类型共享。'),
    feedWindowMinutes: Schema.natural().min(15).max(720).default(120).description('好友动态轮询只消费该时间窗内的新鲜说说（分钟）；轮询节律为窗口的一半（15~60 分钟），单轮最多入账 2 条。'),
  }).collapse(true).description('【扩展 17】QQ 空间：说说/评论/点赞通道（需 SnowLuma；默认关闭）。'),
  presetSync: Schema.object({
    enabled: Schema.boolean().default(false).description('启用预设同步：从 typ0-site 分享站自动拉取并应用配置。需填写分享码。'),
    baseUrl: Schema.string().default('https://typ0.space').description('分享站地址。局域网自托管可填 http://192.168.x.x:5177。'),
    shareCode: Schema.string().default('').description('8 位分享码(大小写均可,可带连字符)。在 typ0-site 详情页获取。'),
    autoUpdate: Schema.boolean().default(false).description('自动更新：重载时检查远端 revision,有新版本才应用。关闭时仅通过 interlude.preset.sync 手动触发。'),
    sections: Schema.array(Schema.string()).role('table').default([]).description('要同步的分区(留空 = 预设里有什么就同步什么)。可选:storyDefaults(配合"应用到当前故事"),runtime,urge,agency,memory,alterSystem,schedulePreplan,timelineDirector,chatActions,stickers,sharedStory,browser,worldSeeder,longHorizon,qzone,blindMode,logging。'),
    applyToCurrentStory: Schema.boolean().default(false).description('同时将 storyDefaults 应用到当前运行中的故事(修改角色名/人设/世界等)。'),
    }).collapse(true).description('【扩展 18】预设同步：从 typ0-site 分享站自动拉取配置(默认关闭)。'),
  weather: Schema.object({
    enabled: Schema.boolean().default(false).description('启用运行时天气注入:从 Open-Meteo(免费无 Key)拉取真实天气,以 [世界事件] 剧本条目注入当前温度与天况。'),
    latitude: Schema.number().min(-90).max(90).default(39.14).description('观测点纬度(手动模式,或自动解析失败时的回退)。'),
    longitude: Schema.number().min(-180).max(180).default(117.18).description('观测点经度。'),
    autoFromLocation: Schema.boolean().default(true).description('从故事设定中的地点(storySetting.location)自动解析观测点;解析失败回退手动经纬度。'),
    skipFantasyWorld: Schema.boolean().default(false).description('手动开关:架空世界(异世界/精灵/幻想设定)跳过天气注入。开启后检测到架空关键词时不注入。'),
    cadenceMinutes: Schema.natural().min(5).max(180).default(30).description('拉取间隔(分钟)。注入为纯数据格式("环境:22°C 小毛毛雨。"),不带建议句。'),
  }).collapse(true).description('【扩展 19】运行时天气:真实天气 → [世界事件] 注入(默认关闭)。'),

  blindMode: BlindMode.description('【维护 20】盲区模式：低频心跳的最小运行形态。'),
  logging: Logging.description('【维护 21】日志：级别、信息密度、布局和隐私预览。'),
  mainPrompt: Schema.string().role('textarea').default('').description('⚠️ 除非有把握，否则不要修改。系统主提示词（主叙事行为指令）：与固定合约、文风和特化块协作，塑造全部回合的写作行为；留空使用内置默认，改动下回合立即生效，出问题清空即可恢复默认。'),
  chatRhythm: ChatRhythm.description('【已弃用】对话节奏：仅兼容旧配置，不再统计、干预写作或重试。').hidden(),
})

export function apply(ctx: Context, config: InterludeConfig) {
  const startupLogger = ctx.logger('hds-interlude')
  // 顶层主提示词覆盖：非空时取代模型中心的旧字段（旧 YAML 自定义值继续生效）。
  const mainPromptOverride = config.mainPrompt?.trim()
  if (mainPromptOverride) config.model.mainPrompt = mainPromptOverride
  const blindModeEnabled = config.blindMode?.enabled === true || config.blackBox?.enabled === true
  if (!blindModeEnabled) startupLogger.info('plugin load started version=%s', HDS_INTERLUDE_VERSION)
  const service = new InterludeService(ctx, config)
  // typ-0 worker-only integration. The bridge is environment-gated and does
  // not register any Console field or change ordinary Koishi behaviour.
  const disposeDesktopBridge = installDesktopBridge(service)
  if (disposeDesktopBridge) ctx.on('dispose', disposeDesktopBridge)
  // 预设同步:启动时 autoUpdate 检查(失败静默,不影响启动)
  if (config.presetSync?.enabled && config.presetSync?.autoUpdate && config.presetSync?.shareCode?.trim()) {
    void runAutoSync(ctx, service).catch((error) => {
      startupLogger.warn('预设同步启动检查失败(不影响运行):%s', (error as Error).message)
    })
  }
  if (blindModeEnabled) {
    // Registered commands from every plugin reach this hook before their
    // action runs. Returning an empty fragment consumes them silently.
    ctx.on('command/before-execute', () => '')
  } else {
    registerCommands(ctx, service, config)
  }

  // 空格子命令兼容:Koishi 解析器对 "interlude script note" 是逐 token 贪心匹配,
  // 中间层命令(如 interlude.script)一旦声明了参数即停止贪心,note 会被误当成
  // 该参数——路由到 interlude.script 而非 interlude.script.note,两种写法行为
  // 完全不同。这里在解析前把能命中已注册命令的空格前缀重写为点分形式。
  ctx.middleware((session, next) => {
    const commander = (ctx as any).$commander
    if (!commander?.get) return next()
    const rewritten = normalizeInterludeSpacing(session.content ?? '', (name) => !!commander.get(name, session))
    if (rewritten !== undefined) session.content = rewritten
    return next()
  }, true)

  ctx.middleware(async (session, next) => {
    if (!session.content?.trim() && !extractSessionVoiceCount(session)) return next()
    if (blindModeEnabled && looksLikeInterludeCommand(session.content)) return
    // Management commands must remain visible to Koishi's command parser,
    // including when they are sent inside an authorized group.
    if (config.runtime.ignoreCommandMessages && looksLikeInterludeCommand(session.content)) return next()
    if (!session.isDirect) {
      const consumed = await service.receiveGroup(session)
      return consumed ? undefined : next()
    }
    if (!config.runtime.captureDirectMessages) return next()
    const consumed = await service.receive(session)
    return consumed ? undefined : next()
  })
  if (!blindModeEnabled) startupLogger.info('plugin load completed')
}

function registerCommands(ctx: Context, service: InterludeService, config: InterludeConfig) {
  ctx.command('interlude', 'HDS Interlude：管理与查看命令')
    .action(() => [
      'HDS Interlude 命令入口。子命令用点分书写,例如:',
      '· interlude.status —— 查看当前故事与模型状态',
      '· interlude.timeline 10 —— 查看近期剧本',
      '· interlude.memory 10 —— 查看相关记忆',
      '· interlude.context —— 查看运行上下文摘要',
      '管理命令:interlude.script.note / interlude.memory.apply / interlude.overlay.clear / interlude.preset.sync 等,',
      '完整清单见文档 command.md。(空格写法如 "interlude script note" 也能自动识别,但推荐点分)',
    ].join('\n'))

  const startStoryFromConsole = async (session: Session, legacyName?: string) => {
    const denial = service.manageSessionDenial(session)
    if (denial) return `无权限：手动启动共享主剧本需要 HDSI 管理员权限。${denial.detail}`
    const readiness = await service.storyStartReadiness(session)
    if (readiness.existing) {
      return readiness.existing.status === 'paused'
        ? `当前已有 ${readiness.existing.setting.character.name} 的主剧本（暂停中）；请使用 interlude.resume 恢复，不要重复启动。`
        : `当前已有 ${readiness.existing.setting.character.name} 的活动主剧本；请使用 interlude.status 查看状态。`
    }
    if (!readiness.ready) return formatStoryStartReadiness(readiness, 'Console 档案尚未适合启动')
    const preview = readiness.preview
    const legacyNote = legacyName?.trim() ? `\n已忽略旧 init 的名称参数“${legacyName.trim()}”；角色名称以 Console 为准。` : ''
    const message = [
      '即将从当前 Console 档案启动故事：',
      `主角：${preview.characterName}`,
      `角色设定：${preview.characterProfile ? '已填写' : '未填写'}`,
      `Perspective：${preview.perspective ? '已填写' : '未填写'}`,
      `世界与地点：${preview.world ? '已填写' : '未填写'}`,
      `时区：${preview.timezone}`,
      `主模型：${preview.model}`,
      `自动创建：${preview.autoCreate ? '开启（首次私聊通常无需手动启动）' : '关闭'}`,
      ...readiness.warnings.map(warning => `提示：${warning}`),
      legacyNote,
    ].filter(Boolean).join('\n')
    if (!await askConfirmation(session, `${message}\n确认从此档案启动吗？(y/n)`)) return '操作已取消。'
    const story = await service.createStory(session)
    const participant = await service.findParticipant(session, story)
    return `已从 Console 档案启动 ${story.setting.character.name} 的共享主剧本，并加入 ${participant?.displayName || session.userId}。`
  }

  ctx.command('interlude.doctor', '检查当前 Console 档案、权限与模型是否适合启动故事')
    .action(async ({ session }) => formatStoryStartReadiness(await service.storyStartReadiness(session)))

  ctx.command('interlude.story.start', '管理员：从当前 Console 档案手动启动第一份运行中故事')
    .action(async ({ session }) => startStoryFromConsole(session))

  ctx.command('interlude.init [legacyName:text]', '兼容别名：请改用 interlude.story.start；名称参数已忽略')
    .action(async ({ session }, legacyName) => startStoryFromConsole(session, legacyName))

  ctx.command('interlude.setup <json:text>', '高级：用 JSON 单独修改当前故事设定；普通测试请优先在 Console 填 storyDefaults')
    .action(async ({ session }, json) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。请在 Console 的 sharedStory.managerAccounts 中添加此 QQ，或留空允许所有获授权账号。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      try {
        const patch = JSON.parse(json) as Partial<StorySetting>
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设定必须是 JSON 对象。普通测试无需使用此命令。')
        const updated = await service.updateSetting(story, patch)
        return `已保存 ${updated.setting.character.name} 的当前故事设定。`
      } catch (error) {
        return `JSON 格式不正确：${(error as Error).message}`
      }
    })

  ctx.command('interlude.qzone <content:text>', '管理员：经限流门以她本人身份发一条 QQ 空间说说（通道端到端测试；可见性默认好友可见）')
    .action(async ({ session }, content) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const text = String(content ?? '').trim()
      if (!text) return '说说内容不能为空。'
      if (!(await service.qzoneAvailable())) return 'QQ 空间通道不可用：请确认 Console 已启用 QQ 空间(qzone.enabled,【扩展 17】)且 SnowLuma 连接在线。'
      const result = await service.qzoneExecute(story, 'post', { content: text, ugcRight: 4 }, session?.bot?.selfId)
      return result.ok ? `已发表说说（tid=${result.tid}，好友可见）。` : `发表失败：${result.error}`
    })

  ctx.command('interlude.participant.link <participantId> <userId>', '管理员：把同一个人的另一个号链入既有参与者（第二端点消息进入同一关系分支）。')
    .action(async ({ session }, participantId, userId) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const id = String(participantId ?? '').trim()
      const account = String(userId ?? '').trim()
      if (!id || !account) return '用法：interlude.participant.link <参与者ID> <用户ID>'
      const participant = await (service as any).getParticipant(id).catch(() => undefined)
      if (!participant) return `参与者不存在：${id}`
      const result = await service.linkParticipantEndpoint(participant, session?.platform ?? 'onebot', account)
      return result.ok ? `用户端点已链接（${account} → ${participant.displayName || id}）。` : `链接失败：${result.error}`
    })

  /* ── 分享码:与 typ0-site 分享站联动的预设拉取/应用/回滚 ── */
  registerPresetCommands(ctx, service)

  ctx.command('interlude.participant.unlink <endpointId>', '管理员：解除一个用户端点链接（可撤销；身份与历史保留）。')
    .action(async ({ session }, endpointId) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const id = String(endpointId ?? '').trim()
      if (!id) return '用法：interlude.participant.unlink <端点ID>'
      const result = await service.unlinkParticipantEndpoint(id)
      return result.ok ? `端点已解除链接（${id}）。` : `解除失败：${result.error}`
    })

  ctx.command('interlude.participant.endpoints [participantId]', '管理员：列出参与者名下全部用户端点。')
    .action(async ({ session }, participantId) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const id = String(participantId ?? '').trim()
      if (!id) return '用法：interlude.participant.endpoints <参与者ID>'
      const endpoints = service.listParticipantEndpoints(id)
      if (!endpoints.length) return `参与者 ${id} 没有用户端点。`
      return '用户端点（' + endpoints.length + ' 个）：\n' + endpoints.map(item => (item.enabled ? '●' : '○') + ' ' + item.platform + ' ' + item.userId + ' 端点=' + item.endpointId).join('\n')
    })

  ctx.command('interlude.story.endpoint [operation:text]', '管理员：管理剧本的角色端点（账号迁移的唯一显式途径）。`add <平台> <账号> [qq|wechat]` 注册端点；`disable <端点ID>` 停用；不带参数列出。')
    .action(async ({ session }, operation) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const parts = String(operation ?? '').trim().split(/\s+/).filter(Boolean)
      if (parts[0] === 'add') {
        if (parts.length < 3) return '用法：interlude.story.endpoint add <平台> <账号> [qq|wechat]'
        const [, platform, selfId, kindArg] = parts
        const channelKind = kindArg === 'wechat' ? 'wechat' : 'qq'
        const result = await service.addStoryEndpoint(story, platform, selfId, channelKind)
        return result.ok ? `角色端点已注册（${platform} ${selfId}，${channelKind}，端点 ${result.endpointId}）。` : `注册失败：${result.error}`
      }
      if (parts[0] === 'disable') {
        if (parts.length < 2) return '用法：interlude.story.endpoint disable <端点ID>'
        const result = await service.disableStoryEndpoint(parts[1])
        return result.ok ? `端点已停用（${parts[1]}）。` : `停用失败：${result.error}`
      }
      if (parts.length) return '用法：interlude.story.endpoint [add <平台> <账号> [qq|wechat] | disable <端点ID>]'
      const endpoints = service.listStoryEndpoints(story.id)
      if (!endpoints.length) return '当前故事没有登记任何角色端点。'
      return '角色端点（' + endpoints.length + ' 个）：\n' + endpoints.map(item => (item.enabled ? '●' : '○') + ' ' + item.platform + ' ' + item.selfId + '（' + item.channelKind + (item.online ? '·在线' : '·离线') + '）端点=' + item.endpointId).join('\n')
    })

  ctx.command('interlude.story.alias [operation:text]', '管理员：查看/回滚剧本别名重定向（单剧本多通道 M1b）。不带参数列出全部别名；`remove <别名ID>` 回滚一条（写审计）。')
    .action(async ({ session }, operation) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const text = String(operation ?? '').trim()
      if (text.startsWith('remove ')) {
        const aliasId = text.slice(7).trim()
        if (!aliasId) return '用法：interlude.story.alias remove <别名ID>'
        const result = await service.removeStoryAlias(aliasId, `by ${session?.userId ?? 'admin'}`)
        return result.ok ? `已回滚别名 ${aliasId}（审计已写入剧本条目）。` : `回滚失败：${result.error}`
      }
      if (text) return '用法：interlude.story.alias [remove <别名ID>]'
      const aliases = service.listStoryAliases()
      if (!aliases.length) return '当前没有剧本别名。'
      return `剧本别名（${aliases.length} 条）：\n` + aliases.map(row => `${row.aliasStoryId} → ${row.canonicalStoryId}（${row.reason}，${row.createdAt.toLocaleString()}）`).join('\n')
    })

  ctx.command('interlude.status', '查看当前故事、游标、主模型连接与主动消息开关')
    .action(async ({ session }) => {
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const health = service.health.snapshot(story.id)
      return [
        `主角：${story.setting.character.name}`,
        `关系人数：${(await service.participants(story.id)).length}`,
        `故事状态：${story.status}`,
        `已写到：${story.cursorAt.toISOString()}`,
        `主模型连接：${service.config.model.providers.find(provider => provider.useForMain && provider.enabled !== false)?.label || '未指定（按模型配置回退）'}`,
        `允许主动可见消息：${service.config.runtime.allowProactiveMessages ? '开启' : '关闭'}`,
        `Agency Window：${resolveAgencyConfig(service.config.agency).enabled ? '开启' : '关闭'}（${story.state.agencyWindow?.activityLoad || '尚未建立'}）`,
        `—— 健康指标（自 ${new Date(health.sinceAt).toLocaleString('zh-CN')}）——`,
        `主叙事成功：${health.narrativeTotal}/${health.narrativeTotal + health.narrativeFailed}（${(health.successRate * 100).toFixed(1)}%）`,
        `结构化回复缺失：${health.structureMissing} 次（挽回 ${health.recoverySaved} 次）`,
        `回复模式：immediate ${health.replyModes.immediate} / none ${health.replyModes.none} / delayed ${health.replyModes.delayed} / 无投递 ${health.replyModes.noDelivery}`,
        `前缀缓存命中：${(health.cacheHitRate * 100).toFixed(1)}%（输入 ${health.inputTokens.toLocaleString()} tokens）`,
        `中位延迟：${(health.medianLatencyMs / 1000).toFixed(1)}s`,
      ].join('\n')
    })

  ctx.command('interlude.pause', '暂停当前故事的自动处理，不删除任何记录')
    .action(async ({ session }) => changeStatus(service, session, 'paused'))

  ctx.command('interlude.resume', '恢复当前故事的自动处理')
    .action(async ({ session }) => changeStatus(service, session, 'active'))

  ctx.command('interlude.advance', '手动把故事补写到现在；用于测试自动生活推进')
    .action(async ({ session }) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const messages = await service.advanceStory(story)
      const delivered = await service.deliverMessages(story, messages, session)
      return delivered.length ? '剧本已补写到现在，并已发送其中已经发生的可见角色消息。' : messages.length ? '剧本已补写到现在；可见消息投递未完成，请查看日志。' : '剧本已补写到现在；这次没有发生可见角色消息。'
    })

  ctx.command('interlude.timeline.rebase', '管理员：以当前真实时间重建自动推进时间线，不删除历史剧本')
    .action(async ({ session }) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      if (!await askConfirmation(session, '将清空当前场景摘要、连续性快照和工作暂存，并从现在重新建立宿主时间线；历史剧本和长期事实会保留。确认执行吗？(y/n)')) return '操作已取消。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const result = await service.rebaseTimeline(story)
      return `已在 ${formatLogTime(result.at, story.setting.timezone)} 重建宿主时间线${result.sceneReset ? '，活跃场景摘要已重置' : ''}。`
    })

  ctx.command('interlude.timeline [limit:number]', '查看当前账号可见的近期剧本记录；limit 为条数，默认 10')
    .action(async ({ session }, limit = 10) => {
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const participant = await service.findParticipant(session, story)
      const entries = (await service.recentEntries(story.id, Math.max(1, Math.min(limit * 3, 90))))
        .filter(entry => !entry.participantId || entry.participantId === participant?.id)
        .slice(-Math.max(1, Math.min(limit, 30)))
      if (!entries.length) return '当前故事还没有剧本记录。'
      return h.text(entries.map(entry => `[${formatStoryDisplayTime(entry.occurredAt, story.setting.timezone)}] ${entry.actor}/${entry.kind}: ${entry.content}`).join('\n'))
    })

  ctx.command('interlude.memory [limit:number]', '查看当前账号相关的记忆摘要；limit 为条数，默认 10')
    .action(async ({ session }, limit = 10) => {
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const participant = await service.findParticipant(session, story)
      const memories = await service.memories(story.id, Math.max(1, Math.min(limit, 30)), participant?.id)
      if (!memories.length) return '暂时还没有提取出耐久记忆；多进行一些对话并等待后台整理后再看。'
      return memories.map(memory => `[${memory.category}/${memory.importance.toFixed(2)}] ${memory.content}`).join('\n')
    })

  ctx.command('interlude.context', '查看运行上下文摘要：场景、关系、Overlay 与长期事实')
    .action(async ({ session }) => {
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const participant = await service.findParticipant(session, story)
      const [scene, arc, facts] = await Promise.all([
        service.activeScene(story.id), service.activeArc(story.id), service.facts(story.id, 8),
      ])
      return [
        `场景引子：${scene?.hook || '尚未整理'}`,
        `场景摘要：${scene?.summary || '尚未整理'}`,
        `剧情弧线：${arc?.title || '开场'} — ${arc?.summary || '尚未整理'}`,
        `当前关系：${participant?.displayName || session.userId}（${participant?.relationship || '未填写'}）`,
        `当前关系状态：${JSON.stringify(participant?.state ?? {})}`,
        `主角个体价值观 / 看待世界的方式：${story.setting.perspective || '未填写'}（当前 overlay：${story.state.settingOverlay?.perspective || '未形成'}）`,
        `主角全局变化：${JSON.stringify(story.state.settingOverlay ?? {})}`,
        `主体行动窗口：${JSON.stringify(story.state.agencyWindow ?? null)}`,
        `长期事实：${facts.length ? facts.map(fact => `[${fact.scope}/${fact.importance.toFixed(2)}] ${fact.content}`).join(' | ') : '暂无'}`,
      ].join('\n')
    })

  ctx.command('interlude.compact', '立即整理当前故事的旧剧本；必要时一并审查 Schedule Preplan')
    .action(async ({ session }) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const compacted = await service.compactStory(story)
      return compacted ? '已完成一次连续性记忆整理。' : '当前还没有达到需要整理的剧本量。'
    })

  ctx.command('interlude.script [limit:number]', '管理员：查看当前主剧本的最近原始条目，默认 20 条')
    .action(async ({ session }, limit = 20) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const entries = await service.recentEntries(story.id, Math.max(1, Math.min(limit, 50)))
      if (!entries.length) return '当前主剧本还没有原始条目。'
      return h.text(entries.map(entry => `#${entry.id} [${entry.occurredAt.toISOString()}] ${entry.actor}/${entry.kind}${entry.participantId ? `/${entry.participantId}` : ''}\n${entry.content}`).join('\n\n'))
    })

  ctx.command('interlude.script.note <content:text>', '管理员：向剧本写入一条人工注记，不伪装成模型输出')
    .action(async ({ session }, content) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return await service.addAdminScriptNote(story, content) ? '已写入管理员注记，后续压缩会将其纳入连续性。' : '注记为空，未写入。'
    })

  ctx.command('interlude.memory.facts [limit:number]', '管理员：列出长期事实及其编号，默认 20 条')
    .action(async ({ session }, limit = 20) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const facts = await service.adminFacts(story.id, limit)
      if (!facts.length) return '当前没有有效的长期事实。'
      return facts.map(fact => `#${fact.id} [${fact.scope}] 重要度=${fact.importance.toFixed(2)} 置信度=${fact.confidence.toFixed(2)} 未解决=${fact.unresolved}\n${fact.content}`).join('\n\n')
    })

  ctx.command('interlude.memory.add <scope:string> <content:text>', '管理员：手动添加全局长期事实；relationship 事实必须在正文中明确写出相关人物；scope 为 character/world/relationship/event/promise')
    .action(async ({ session }, scope, content) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      if (!isFactScope(scope)) return 'scope 必须是 character、world、relationship、event 或 promise。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return await service.addAdminFact(story, scope, content)
        ? '已添加高置信度全局长期事实。'
        : '事实内容为空或主体不明确，未添加；relationship 事实请在正文中写出具体人物，例如“小林说他准备出门”。'
    })

  ctx.command('interlude.memory.forget <id:number>', '管理员：将指定长期事实标记为已失效，可审计且不会物理删除')
    .action(async ({ session }, id) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return await service.forgetAdminFact(story.id, id) ? `长期事实 #${id} 已标记为失效。` : `未找到有效的长期事实 #${id}。`
    })

  ctx.command('interlude.memory.intents [limit:number]', '管理员：查看等待中的计划、提醒、承诺与剧情余波')
    .action(async ({ session }, limit = 20) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const intents = await service.adminPendingIntents(story.id, limit)
      if (!intents.length) return '当前没有等待中的计划、提醒、承诺或剧情余波。'
      return intents.map(intent => {
        const active = intent.type === 'active-consequence' && intent.payload?.lifecycle === 'active'
        const timing = active
          ? `持续影响至=${String(intent.payload?.expiresAt || '未设置')}`
          : `最早执行=${intent.notBefore.toISOString()}`
        return `#${intent.id} [${intent.type}] 参与者=${intent.participantId || '全局'} ${timing}\n${intent.summary}`
      }).join('\n\n')
    })

  ctx.command('interlude.memory.cancel <id:number>', '管理员：取消指定的等待中意图或延迟消息')
    .action(async ({ session }, id) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return await service.cancelAdminIntent(story.id, id) ? `意图 #${id} 已取消。` : `未找到等待中的意图 #${id}。`
    })

  ctx.command('interlude.memory.patches [limit:number]', '管理员：查看人物、关系和世界设定的演化提案')
    .action(async ({ session }, limit = 20) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const patches = await service.adminStatePatches(story.id, limit)
      if (!patches.length) return '当前没有设定演化提案。'
      const preview = (text: string, max = 220) => text.length > max ? `${text.slice(0, max)}…(共${text.length}字,详情可查数据库)` : text
      return patches.map(patch => [
        `#${patch.id} [${patch.status}/${patch.target}/${patch.impact}] 置信度=${patch.confidence.toFixed(2)}`,
        `提出：${formatDateTime(patch.createdAt)}${patch.participantId ? ` · 关系对象：${patch.participantId}` : ''}`,
        `提案：${preview(patch.proposedValue)}`,
        `证据：${preview(patch.evidence, 160)}`,
      ].join('\n')).join('\n\n')
    })

  ctx.command('interlude.memory.apply <id:number>', '管理员：手动批准一条设定演化提案——绕过证据阈值与自动应用开关,效果立即写入 overlay')
    .action(async ({ session }, id) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return await service.applyAdminStatePatch(story, id) ? `设定演化提案 #${id} 已批准并写入 overlay。` : `未找到待批准的设定演化提案 #${id}。`
    })

  ctx.command('interlude.memory.reject <id:number>', '管理员：拒绝一条尚未应用的设定演化提案')
    .action(async ({ session }, id) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return await service.rejectAdminStatePatch(story.id, id) ? `设定演化提案 #${id} 已拒绝。` : `未找到待审核的设定演化提案 #${id}。`
    })

  ctx.command('interlude.overlay.clear <target:string>', '管理员：只清理指定部分的设定演化 overlay，不删除剧本和记忆；执行前展示将清理的内容并询问 y/n')
    .action(async ({ session }, target) => {
      if (!requireManager(service, session)) return '无权限：当前 QQ 不是 HDSI 管理员。'
      const normalized = String(target || '').trim().toLowerCase() as 'character' | 'perspective' | 'relationship' | 'world' | 'all'
      if (!['character', 'perspective', 'relationship', 'world', 'all'].includes(normalized)) return 'target 必须是 character、perspective、relationship、world 或 all。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      // 预览将清理的内容,避免盲清(提案与快照计数 + overlay 现有内容摘要)
      const status = await service.adminOverlayStatus(story.id)
      const preview = describeOverlayForClear(status.state, normalized, status.proposed.length, status.snapshots.length)
      if (!await askConfirmation(session, `${preview}\n\n即将清理 ${normalized} overlay；剧本和记忆不会删除。确认执行吗？(y/n)`)) return '操作已取消。'
      const result = await service.clearSettingOverlay(story, normalized)
      const participantNote = normalized === 'relationship' || normalized === 'all' ? `，已清理 ${result.participantCount} 个参与者关系 overlay` : ''
      return `已清理 ${normalized} overlay${participantNote}；剧本、长期事实和普通记忆均未删除。`
    })

  ctx.command('interlude.overlay.status', '查看当前 overlay、待积累提案和压缩归档状态(只读,对白名单用户开放)')
    .action(async ({ session }) => {
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const status = await service.adminOverlayStatus(story.id)
      return [
        '当前全局 overlay：',
        ...(describeOverlayState(status.state) || ['(空——设定尚未产生稳定演化)']),
        '',
        `待积累提案：${status.proposed.length} 条（可 interlude.memory.apply 手动批准,或等证据跨回合跨日后自动应用）`,
        `已应用/已归档提案：${status.applied.length} 条`,
        `已清理提案：${status.cleared.length} 条`,
        `overlay 压缩快照：${status.snapshots.length} 条`,
        `参与者关系 overlay：${status.participantOverlays.length} 个`,
      ].join('\n')
    })

  ctx.command('interlude.overlay.compact', '管理员：只合并和压缩已应用的 overlay，不整理普通剧本记忆')
    .action(async ({ session }) => {
      if (!requireManager(service, session)) return '无权限：当前账号不是 HDSI 管理员。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const changed = await service.compactOverlay(story)
      return changed ? 'overlay 合并和压缩完成。' : '没有需要合并或压缩的 overlay。'
    })

  ctx.command('interlude.schedule', '查看 Schedule Preplan 当前版本与未来约半天的日程')
    .action(async ({ session }) => {
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const record = await service.adminSchedulePreplan(story.id)
      if (!record) return 'Schedule Preplan 尚未生成；后台会在空闲整理时建立。'
      const window = schedulePreplanWindow(record, new Date(), story.setting.timezone, 12, resolveSchedulePreplanConfig(config.schedulePreplan))
      return [
        `Schedule Preplan：版本 ${record.revision}，覆盖 ${record.validFrom} → ${record.validThrough}`,
        `最后审查：${record.lastReviewedLocalDate || '尚未'}；原因：${record.reviewReason || '无'}`,
        window?.blocks.length
          ? window.blocks.map(block => `${block.date} ${block.start}-${block.end} [${block.kind}] ${block.label}${block.location ? ` @ ${block.location}` : ''}`).join('\n')
          : '未来约半天没有已确定的日程块。',
      ].join('\n')
    })

  const requestScheduleRefresh = async (session: Session) => {
      if (!requireManager(service, session)) return '无权限：当前账号不是 HDSI 管理员。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const marked = await service.requestSchedulePreplanRebuild(story.id)
      return marked ? 'Schedule Preplan 已标记为重新审查；会在当前前台回合结束后的空闲队列中处理。' : '当前还没有 Schedule Preplan；后台会自动建立。'
  }

  ctx.command('interlude.schedule.refresh', '管理员：重新审查当前 Schedule Preplan，并保留旧计划作为稳定参考')
    .action(({ session }) => requestScheduleRefresh(session))

  ctx.command('interlude.schedule.rebuild', '管理员：兼容别名，等同于 interlude.schedule.refresh')
    .action(({ session }) => requestScheduleRefresh(session))

  ctx.command('interlude.reset', '管理员：完全重置——清空数据库并将故事设定重置为 Console 档案当前值（角色身份回到 storyDefaults 模板）；执行前会询问 y/n').action(async ({ session }) => {
    if (!await requireManager(service, session)) return '无权限。'
    const story = await requireStory(service, session)
    if (typeof story === 'string') return story
    const confirmed = await askConfirmation(session, '这将删除所有剧本、记忆、事实，并将角色设定重置为 Console 档案当前值。确定吗？(y/n)')
    if (!confirmed) return '已取消。'
    await service.clearDatabase()
    await service.purgeAllStoryData(story.id)
    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      fs.unlinkSync(path.join(ctx.baseDir, 'data', 'hds-interlude', 'preset-sync-state.json'))
    } catch { /* 同步状态文件本就不存在时无需处理 */ }
    return `已完全重置。数据库已清空，角色设定已回到 Console 故事档案（storyDefaults）模板。
如需更换角色身份，请在 Console 修改故事档案后重新开始。`
  })

  ctx.command('interlude.database.clear', '管理员：清空 HDSI 自有 SQLite 数据表（剧本/记忆/事实等运行时数据）；角色人设和世界观来自 Console 故事档案（storyDefaults），清库后角色身份不变——如需重置人设请在 Console 修改或使用 interlude.reset；执行前会询问 y/n')
    .action(async ({ session }) => {
      if (!requireManager(service, session)) return '无权限：当前账号不是 HDSI 管理员。'
      if (!await askConfirmation(session, '即将清空 HDSI 自有数据库，剧本、记忆和状态记录都会删除。确认执行吗？(y/n)')) return '操作已取消。'
      const result = await service.clearDatabase()
      // 清库同时重置分享码同步状态:否则"已同步 revision N"的记忆会让下次
      // 自动同步跳过,重建的故事只能孵化自旧配置模板(rc48 修复)
      let syncStateReset = false
      try {
        const fs = await import('node:fs')
        const path = await import('node:path')
        fs.unlinkSync(path.join(ctx.baseDir, 'data', 'hds-interlude', 'preset-sync-state.json'))
        syncStateReset = true
      } catch { /* 状态文件本就不存在时无需处理 */ }
      return `HDSI 数据库清空完成：处理 ${result.removed} 条记录${result.logicallyCleared ? `，其中 ${result.logicallyCleared} 条因 SQLite 锁定改为逻辑清空` : ''}。${syncStateReset ? '分享码同步状态已重置：下次启动/手动 sync 会重新拉取并应用预设。' : ''}`
    })

  ctx.command('interlude.purge.all', '管理员：彻底重置所有平台的剧本、记忆与 Canon；执行前会询问 y/n')
    .action(async ({ session }) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      if (!await askConfirmation(session, '即将删除所有平台的剧本、记忆、事实、意图和状态。确认执行吗？(y/n)')) return '操作已取消。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      await service.purgeAllData(story.id)
      return '已彻底重置所有平台：旧剧本、场景摘要、剧情弧线、长期事实、记忆、意图、状态演化和参与者关系状态均已清除；当前故事保留为空白的全局主剧本，Canon 已按当前 Console 配置重建。'
    })

  ctx.command('interlude.purge.platform <platform:string>', '管理员：删除指定平台的全部剧本和记忆；例如 sandbox 或 onebot；执行前会询问 y/n')
    .action(async ({ session }, platform) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      if (!await askConfirmation(session, `即将删除平台 ${platform} 的全部剧本和记忆。确认执行吗？(y/n)`)) return '操作已取消。'
      const normalized = String(platform ?? '').trim().toLowerCase()
      if (!normalized) return '请填写平台名，例如 sandbox 或 onebot。'
      const count = await service.purgePlatformData(normalized)
      return count
        ? `已清空并归档平台 ${normalized} 的 ${count} 部剧本；其它平台不受影响。`
        : `没有找到平台 ${normalized} 的 HDSI 剧本。`
    })

  // `text` 是 Koishi 的贪婪参数类型，会吞掉后续的结束时间；这里必须使用普通 string。
  ctx.command('interlude.purge.range <from:string> <to:string>', '管理员：删除时间范围内的剧本和关联记忆；时间使用 ISO-8601；执行前会询问 y/n')
    .action(async ({ session }, fromText, toText) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const from = new Date(String(fromText ?? '').trim())
      const to = new Date(String(toText ?? '').trim())
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return '时间范围无效，请使用 ISO-8601，例如 2026-08-01T00:00:00+08:00。'
      if (!await askConfirmation(session, `即将删除 ${from.toISOString()} 至 ${to.toISOString()} 范围内的剧本和关联记忆。确认执行吗？(y/n)`)) return '操作已取消。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      await service.purgeStoryRange(story.id, from, to)
      return `已删除 ${from.toISOString()} 至 ${to.toISOString()} 范围内的剧本和关联记忆；Canon 与参与者身份未删除。`
    })
}

async function askConfirmation(session: Session, message: string) {
  await session.send(`${message}\n请在 60 秒内回复 y 或 n。`)
  const answer = await session.prompt(60_000)
  return /^(?:y|yes)$/i.test(String(answer ?? '').trim())
}

function formatStoryStartReadiness(readiness: import('./service').StoryStartReadiness, title = 'Console 档案检查') {
  const preview = readiness.preview
  return [
    title,
    `主角：${preview.characterName || '未填写'}`,
    `角色设定：${preview.characterProfile ? '已填写' : '未填写'}`,
    `Perspective：${preview.perspective ? '已填写' : '未填写'}`,
    `世界：${preview.world ? '已填写' : '未填写'}`,
    `时区：${preview.timezone}`,
    `主模型：${preview.model}`,
    `自动创建：${preview.autoCreate ? '开启' : '关闭'}`,
    ...(readiness.existing ? [`运行中故事：${readiness.existing.setting.character.name}（${readiness.existing.status}）`] : ['运行中故事：尚未创建']),
    ...readiness.blockers.map(item => `阻断：${item}`),
    ...readiness.warnings.map(item => `提示：${item}`),
    readiness.existing
      ? '结果：已有运行中故事，无需再次启动。'
      : readiness.ready ? '结果：可以启动。' : '结果：请先完成阻断项。',
  ].join('\n')
}

async function requireStory(service: InterludeService, session: Session) {
  if (!service.canHandleSession(session)) return '当前 QQ 账号未获 HDSI 互动授权。请在 Console 的“NapCat / OneBot QQ 账号控制”中检查机器人 QQ 号、用户 QQ 白名单和启用状态。'
  return await service.findStory(session) ?? '当前私聊还没有故事。请先在 Console 完成档案，然后执行 interlude.doctor；手动启动请使用 interlude.story.start，或开启 runtime.autoCreate 后直接发送第一条私聊。'
}

async function changeStatus(service: InterludeService, session: Session, status: 'active' | 'paused') {
  if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
  const story = await requireStory(service, session)
  if (typeof story === 'string') return story
  await service.setStatus(story, status)
  return status === 'active' ? '故事已恢复自动处理。' : '故事已暂停自动处理；已有记录不会删除。'
}

function requireManager(service: InterludeService, session: Session) { return service.canManageSession(session) }

/** minato timestamp 即 Date;统一成本地可读时间。 */
const formatDateTime = (value: Date | string | undefined) => {
  const d = value instanceof Date ? value : value ? new Date(String(value).replace(' ', 'T')) : undefined
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'
}

/** overlay 字段的人读摘要(每字段一行预览),替代原始 JSON 倾泻。 */
function describeOverlayState(overlay: { characterProfile?: string; characterTraits?: string[]; perspective?: string; world?: string; relationship?: string } | undefined): string[] {
  if (!overlay) return []
  const line = (label: string, text?: string) => text ? `· ${label}(${text.length}字)：${text.length > 80 ? `${text.slice(0, 80)}…` : text}` : ''
  return [
    line('角色人设', overlay.characterProfile),
    overlay.characterTraits?.length ? `· 角色特质(${overlay.characterTraits.length}条)：${overlay.characterTraits.slice(-3).join(' / ').slice(0, 80)}` : '',
    line('视角', overlay.perspective),
    line('世界', overlay.world),
    line('全局关系', overlay.relationship),
  ].filter(Boolean)
}

/** overlay.clear 确认前的预览:现有内容 + 将被标记清理的提案/快照规模。 */
function describeOverlayForClear(overlay: Parameters<typeof describeOverlayState>[0], target: string, proposedCount: number, snapshotCount: number) {
  const affects = (field: string) => target === 'all' || target === field
  const parts: string[] = []
  if (affects('character') && (overlay?.characterProfile || overlay?.characterTraits?.length)) parts.push('角色人设/特质演化')
  if (affects('perspective') && overlay?.perspective) parts.push('视角演化')
  if (affects('relationship') && overlay?.relationship) parts.push('全局关系演化')
  if (affects('world') && overlay?.world) parts.push('世界演化')
  const overlayNote = parts.length ? `overlay 现有内容:${parts.join('、')}` : 'overlay 现有内容:(所选范围为空)'
  return `${overlayNote};待积累提案 ${proposedCount} 条、压缩快照 ${snapshotCount} 条将按范围标记清理。`
}

/* ═══ 分享码命令(typ0-site 联动) ═══ */
const SHARE_SNAPSHOT_DIR = () => 'data/hds-interlude'
const SHARE_SNAPSHOT_FILE = () => 'data/hds-interlude/share-snapshot.json'

function registerPresetCommands(ctx: Context, service: InterludeService) {
  const shareBase = () => String(process.env.HDSI_SHARE_BASE ?? '').trim() || 'https://typ0.space'
  const parseArgs = (text: string) => {
    const args = String(text ?? '').trim().split(/\s+/).filter(Boolean)
    const valueOf = (flag: string) => { const i = args.findIndex((a) => a.toLowerCase() === flag); return i >= 0 ? args[i + 1] : undefined }
    return {
      code: args.find((a, i) => !a.startsWith('--') && args[i - 1]?.toLowerCase() !== '--sections' && args[i - 1]?.toLowerCase() !== '--base'),
      baseUrl: valueOf('--base') ?? shareBase(),
      story: args.some((a) => a.toLowerCase() === '--story'),
      sectionFilter: (() => { const v = valueOf('--sections'); return v ? v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : null })(),
    }
  }

  ctx.command('interlude.preset.check <code:text>', '管理员:拉取分享码预设并预览与本地配置的差异(不写入任何内容)。')
    .action(async ({ session }, text) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const { code, baseUrl, story, sectionFilter } = parseArgs(String(text ?? ''))
      if (!code) return '用法:interlude.preset.check <分享码> [--base http://…] [--sections runtime,urge] [--story]'
      try {
        const { info, removed } = await fetchShare(ctx, baseUrl, code)
        const sections = sectionFilter ? info.sections.filter((s) => sectionFilter.includes(s)) : info.sections
        if (!sections.length) return '指定的分区在该预设中不存在。'
        const summary = summarizeShare(service, info, sections)
        const lines = formatDiffLines(summary)
        if (removed.length) lines.push(`(插件侧清洗剔除 ${removed.length} 个连接类字段)`)
        if (!summary.diffs.length && !Object.keys(summary.storyPatch).length) lines.push('(与本地配置无差异)')
        const baseArg = baseUrl !== shareBase() ? ` --base ${baseUrl}` : ''
        lines.push('', `确认无误后执行:interlude.preset.apply ${info.code}${baseArg}${story ? ' --story' : ''}${sectionFilter ? ` --sections ${sectionFilter.join(',')}` : ''}`)
        return lines.join('\n')
      } catch (error) { return `分享码检查失败:${(error as Error).message}` }
    })

  ctx.command('interlude.preset.apply <code:text>', '管理员:应用分享码预设——预览差异、y/n 确认后写入配置(含 revision 二次校验与应用前快照)。')
    .action(async ({ session }, text) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const { code, baseUrl, story: applyStory, sectionFilter } = parseArgs(String(text ?? ''))
      if (!code) return '用法:interlude.preset.apply <分享码> [--base http://…] [--sections runtime,urge] [--story]'
      try {
        // 第一次拉取:预览
        const first = await fetchShare(ctx, baseUrl, code)
        const sections = sectionFilter ? first.info.sections.filter((s) => sectionFilter.includes(s)) : first.info.sections
        if (!sections.length) return '指定的分区在该预设中不存在。'
        const summary = summarizeShare(service, first.info, sections)
        const lines = formatDiffLines(summary)
        const previewRevision = first.info.revision
        if (!await askConfirmation(session, [...lines, '', `即将应用 revision ${previewRevision}(配置分区整段替换${sections.includes('storyDefaults') ? ',storyDefaults 同时写入配置模板' : ''}${applyStory ? ',并应用到当前故事' : ''})。继续吗?`].join('\n'))) return '操作已取消。'
        // 第二次拉取:revision 必须与预览一致,防止预览与应用之间远端发新版
        const second = await fetchShare(ctx, baseUrl, code)
        if (second.info.revision !== previewRevision) {
          return `远端已更新(revision ${previewRevision} → ${second.info.revision}),预览内容可能已过期。请重新执行 interlude.preset.check ${second.info.code}。`
        }
        // 配置写入面 = 运行时分区 + storyDefaults 模板(清库重建与新故事的孵化来源)
        const patchSections = sections.includes('storyDefaults') && second.info.payload.storyDefaults && typeof second.info.payload.storyDefaults === 'object'
          ? [...summary.configSections, 'storyDefaults']
          : summary.configSections
        // 应用前快照(配置分区 + 可选故事设定);深拷贝避免 scope.update/updateSetting 原地修改污染快照
        const snapshot: Record<string, unknown> = {}
        for (const section of patchSections) snapshot[section] = snapshotDeepCopy((service.config as any)[section] ?? null)
        const foundStory = applyStory && Object.keys(summary.storyPatch).length ? await service.findStory(session!) : undefined
        const storyForSnapshot = foundStory && typeof foundStory !== 'string' ? foundStory : null
        // 故事设定快照必须在 updateSetting 之前拷贝,否则快照里是"应用后"的值
        const storySettingSnapshot = snapshotDeepCopy(storyForSnapshot?.setting ?? null)
        // 写入配置(scope.update 持久化到 koishi.yml)
        const results: string[] = []
        if (patchSections.length) {
          const patch = buildConfigPatch(service.config as unknown as Record<string, unknown>, second.info.payload, patchSections, { includeStoryDefaults: true })
          ctx.scope.update(patch as any)
          results.push(`配置已写入:${patchSections.join('、')}(storyDefaults 模板即时生效于新故事;部分运行时参数需插件重载后生效)`)
        }
        if (applyStory) {
          if (storyForSnapshot && Object.keys(summary.storyPatch).length) {
            const cleanPatch = JSON.parse(JSON.stringify(summary.storyPatch))
            if (cleanPatch.user && !cleanPatch.user.displayName) delete cleanPatch.user.displayName
            if (cleanPatch.user && !Object.keys(cleanPatch.user).length) delete cleanPatch.user
            await service.updateSetting(storyForSnapshot, cleanPatch)
            results.push('storyDefaults 已应用到当前故事设定。')
          } else {
            results.push('当前会话没有可应用的故事(或预设无 storyDefaults 内容),已跳过故事设定。')
          }
        }
        // 保存快照供回滚
        try {
          const fs = await import('node:fs')
          const path = await import('node:path')
          const file = path.join(ctx.baseDir, SHARE_SNAPSHOT_FILE())
          fs.mkdirSync(path.join(ctx.baseDir, SHARE_SNAPSHOT_DIR()), { recursive: true })
          fs.writeFileSync(file, JSON.stringify({
            code: second.info.code, revision: second.info.revision, title: second.info.title,
            appliedAt: new Date().toISOString(), configSections: snapshot,
            storySetting: storySettingSnapshot, storyId: storyForSnapshot?.id ?? null,
          }))
          results.push('(已保存应用前快照:interlude.preset.rollback 可恢复)')
        } catch { results.push('(快照保存失败,不影响本次应用结果)') }
        return [`已应用「${second.info.title}」revision ${second.info.revision}。`, ...results].join('\n')
      } catch (error) { return `分享码应用失败:${(error as Error).message}` }
    })

  ctx.command('interlude.preset.status', '管理员:查看最近一次分享码应用的状态。')
    .action(async ({ session }) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      try {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const snap = JSON.parse(fs.readFileSync(path.join(ctx.baseDir, SHARE_SNAPSHOT_FILE()), 'utf8'))
        return [
          `最近应用:${snap.title}(分享码 ${snap.code},revision ${snap.revision})`,
          `时间:${snap.appliedAt}`,
          `分区:${Object.keys(snap.configSections ?? {}).join('、') || '(无)'}`,
          snap.storySetting ? '含当前故事设定快照' : '',
        ].filter(Boolean).join('\n')
      } catch { return '尚无应用记录。' }
    })

  ctx.command('interlude.preset.sync', '管理员:手动触发预设同步(使用 Console 配置区填写的分享码),或查看同步配置状态。')
    .action(async ({ session }) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      const sync = service.config.presetSync
      if (!sync?.enabled || !sync.shareCode?.trim()) {
        return [
          '预设同步未启用。',
          '请在 Console → 【扩展 18】预设同步 中配置:',
          '  1. 启用预设同步',
          '  2. 填写分享码(8 位,在 typ0-site 详情页获取)',
          `  3.${sync?.autoUpdate ? ' 自动更新已开启(重载时检查)' : ' 自动更新未开启(仅手动触发)'}`,
          '',
          '填好后保存并重载,再执行 interlude.preset.sync 手动触发一次同步。',
        ].join('\n')
      }
      // 显示配置状态
      const state = await readSyncState(ctx.baseDir)
      const statusLines = [
        `同步配置:${sync.baseUrl} · 分享码 ${sync.shareCode}`,
        `自动更新:${sync.autoUpdate ? '开启(重载时检查)' : '关闭(仅手动)'}`,
        `应用分区:${sync.sections?.length ? sync.sections.join('、') : '预设里有什么就同步什么'}`,
        `应用到当前故事:${sync.applyToCurrentStory ? '是' : '否'}`,
      ]
      if (state) {
        statusLines.push(`最近同步:${state.title} revision ${state.revision} @ ${state.appliedAt}`)
        if (state.lastError) statusLines.push(`上次错误:${state.lastError}`)
      } else {
        statusLines.push('(尚未同步过)')
      }
      // 触发同步
      if (!await askConfirmation(session, [...statusLines, '', '现在触发一次同步吗?'].join('\n'))) {
        return statusLines.join('\n')
      }
      // 手动触发始终强制重新应用:revision 未变也重写配置模板与故事设定,
      // 否则清库重建/配置漂移后没有任何恢复手段(rc48 修复)
      const result = await runAutoSync(ctx, service, { force: true })
      if (!result) return '同步未执行(请检查配置)。'
      return [...statusLines, '', `同步结果:${result.applied ? '✅ 已应用' : '⏭ 跳过'} — ${result.reason}`].join('\n')
    })

  ctx.command('interlude.preset.rollback', '管理员:回滚最近一次分享码应用(恢复应用前快照)。')
    .action(async ({ session }) => {
      if (!requireManager(service, session)) return '当前 QQ 没有共享主剧本的管理权限。'
      let snap: any
      try {
        const fs = await import('node:fs')
        const path = await import('node:path')
        snap = JSON.parse(fs.readFileSync(path.join(ctx.baseDir, SHARE_SNAPSHOT_FILE()), 'utf8'))
      } catch {
        // 手动 apply 无记录时,回退读自动同步的状态文件(含同样的应用前快照),
        // 否则 autoUpdate 应用后无法回滚
        const syncState = await readSyncState(ctx.baseDir)
        if (syncState && syncState.configSections && Object.keys(syncState.configSections).length) {
          snap = {
            title: syncState.title, code: syncState.code, revision: syncState.revision, appliedAt: syncState.appliedAt,
            configSections: syncState.configSections, storySetting: syncState.storySetting, storyId: syncState.storyId,
          }
        } else {
          return '没有可回滚的应用记录。'
        }
      }
      if (!await askConfirmation(session, `将把以下分区恢复到应用「${snap.title}」之前的状态:\n${Object.keys(snap.configSections ?? {}).join('、')}${snap.storySetting ? '\n以及该故事的角色设定' : ''}\n继续吗?`)) return '操作已取消。'
      try {
        const sections = Object.entries(snap.configSections ?? {}) as [string, unknown][]
        if (sections.length) {
          const restore: Record<string, unknown> = { ...(service.config as any) }
          for (const [section, value] of sections) {
            // 应用前不存在的分区(快照为 null)回滚时移除,而不是置 null——置 null 可能过不了 Schema 校验
            if (value == null) delete restore[section]
            else restore[section] = value
          }
          ctx.scope.update(restore as any)
        }
        if (snap.storySetting && snap.storyId) {
          await (service as any).dbSet('interlude_story', { id: snap.storyId }, { setting: snap.storySetting, updatedAt: new Date() })
        }
        return `已回滚到「${snap.title}」应用之前的状态。`
      } catch (error) { return `回滚失败:${(error as Error).message}` }
    })
}


function isFactScope(value: string): value is 'character' | 'world' | 'relationship' | 'event' | 'promise' {
  return ['character', 'world', 'relationship', 'event', 'promise'].includes(value)
}

/** 空格子命令归一化:把能命中已注册命令的空格前缀重写为点分形式。
 * 背景:Koishi 解析器逐 token 贪心匹配,中间层命令(如 interlude.script)声明了
 * 参数即停止贪心——"interlude script note x" 会路由到 interlude.script(limit
 * 收到 note),与点分写法行为完全不同。返回 undefined 表示无需重写。 */
export function normalizeInterludeSpacing(content: string, isRegistered: (name: string) => boolean): string | undefined {
  const trimmed = String(content ?? '').trim()
  const match = trimmed.match(/^([/!.]?)(interlude)(\s+)(\S[\s\S]*)$/)
  if (!match) return undefined
  const tokens = `interlude ${match[4]}`.split(/\s+/)
  for (let n = Math.min(tokens.length, 4); n >= 2; n--) {
    const name = tokens.slice(0, n).join('.')
    if (!isRegistered(name)) continue
    const rest = tokens.slice(n).join(' ')
    return `${match[1]}${name}${rest ? ` ${rest}` : ''}`
  }
  return undefined
}

export function looksLikeInterludeCommand(content: string) { return /^[!/.]?interlude(?:\s|$|\.)/i.test(content.trim()) }

export * from './narrator'
export * from './service'
export * from './types'

// Public pure decoder for read-only integrations (no dependency on unpublished src paths).
export { decodeStoryState } from './story-state'
