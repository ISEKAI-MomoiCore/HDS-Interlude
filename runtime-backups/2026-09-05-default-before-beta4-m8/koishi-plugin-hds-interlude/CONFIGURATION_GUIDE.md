# HDS Interlude 配置指南

适用版本：`1.0.0-beta4-m7`

第一次安装先看 `BEGINNER_GUIDE.md`。本文件严格按照 Koishi Console 的显示顺序说明当前字段；旧版本已经移除或隐藏的字段集中列在末尾，不再混入正常配置流程。

## Console 顺序

1. `blindMode`：失明模式
2. `storyDefaults`：剧本起点
3. `model`：模型与服务商
4. `onebot`：OneBot / NapCat 权限
5. `chatActions`：平台聊天动作
6. `stickers`：本地表情包
7. `sharedStory`：共享剧本
8. `runtime`：对话与时间
9. `schedulePreplan`：近期稳定日程
10. `agency`：主体行动窗口
11. `memory`：连续性与记忆
12. `alterSystem`：临时氛围偏移
13. `browser`：只读网页观察
14. `logging`：日志与隐私

首次测试先完成 `storyDefaults`、`model`、`onebot`、`sharedStory` 和 `runtime`；`blindMode` 保持关闭。Embedding、网页观察、主动联系和内容日志应在基础私聊稳定后逐项开启。

## 1. blindMode：失明模式

开启 `blindMode.enabled` 后，HDSI 不注册自己的管理指令，并静默拦截当前 Koishi 实例中所有已经识别的指令；普通聊天仍会进入叙事。HDSI 的普通运行日志、错误详情和消息预览都会隐藏，只按 `healthReportMinutes` 输出一次不含故事或账户内容的运行状态心跳；其它插件仍遵循各自的日志配置。

它适合追求高度沉浸感，并且模型、账号白名单和故事档案已经稳定正常的环境。关闭此模式需要在 Console 修改配置并重载插件；失明模式开启期间无法通过聊天指令恢复管理能力。旧 `blackBox` 配置仍可兼容读取，但 Console 只显示 `blindMode`。

## 2. storyDefaults：剧本起点

这些字段只在创建新主剧本时写入 Canon。修改 Console 不会自动重写已经存在的故事。

| 字段 | 说明 |
| --- | --- |
| `characterName` | 主角名称。 |
| `characterProfile` | 主角身份、性格、作息、习惯、压力和行为边界。 |
| `perspective` | 主角个体价值观 / 看待世界的方式。它作为独立于 Canon 的外壳人格层，在相关事件中自然影响判断；长期剧情可形成 `perspective` overlay。 |
| `userProfile` | 没有账号专属资料时使用的默认用户背景。 |
| `relationship` | 新参与者与主角的默认初始关系。 |
| `world` | 时间、地点、社会与现实规则。 |
| `supportingCast` | 重要配角及其与主角的关系。 |
| `location` | 主角主要活动地点。 |
| `style` | 当前故事文风，优先级高于全局 `model.stylePrompt`。 |
| `timezone` | IANA 时区，例如 `Asia/Shanghai`。主模型以该时区生成权威 `nowLocal`、当前时段和日照预期。 |

小幅补充无需维护。若大幅改变角色、Perspective、关系或世界前提，保存后执行对应的 `interlude.overlay.clear character|perspective|relationship|world`，避免旧 Overlay 与当前设定冲突。

`perspective` 是独立于 Canon 的主角外壳人格层，不会重写 `characterProfile`。Console 的 `storyDefaults.perspective` 会写入新主剧本；已有故事可通过 `interlude.setup {"perspective":"..."}` 一次性设置基础 Perspective，再让长期剧情形成其 overlay。

重载和长间隔不会沿用旧剧本中的钟点描述：当前 `nowLocal` 始终优先。时区无效时运行时回退到 UTC，因此发现上午/下午错误时应先检查这里是否为有效 IANA 名称。

## 3. model：模型与服务商

### 3.1 连接顺序

1. 将 `mode` 设为 `openai-compatible`。
2. 先确认 `vision.enabled` 与 `vision.mode`：视觉主模型用 `native`；纯文本主模型可用 `sidecar` 并另配视觉连接。
3. 在 `providers` 的每一行一次填完连接地址、API Key 和实际模型名。
4. 勾选这行模型要承担的用途：主叙事、压缩、Alter、Embedding、表情包描述或侧端识图；每种用途保持一条即可。
5. 在下方按任务分别调整温度、token、超时、提示词和 Embedding 参数。

`fallback` 不调用远程模型，只适合验证插件、数据库和命令是否安装成功。

### 智谱官方提供商模式

在任意一行 `providers` 中将该行 `mode` 设为 `zhipu-official`，保存并重载后，Console 会切换为智谱专属字段：只需填写智谱 API Key、模型代码和推理强度。该行固定使用 `https://open.bigmodel.cn/api/paas/v4/chat/completions`，不会显示 endpoint、额外请求头或额外请求体；其它提供商行仍可保持 `openai-compatible`。

智谱行的 GLM‑5.3‑Flash 强制使用 SSE：首个可见文本等待上限为 45 秒，首字到达后不设置总等待上限。推理强度可选 `low`、`high`、`max`，默认 `high`；GLM‑5.3‑Flash 不支持关闭思考。图片请求会使用智谱接受的 `image_url.url` 形式，不附带 OpenAI 的 `detail` 字段。

### DeepSeek 官方提供商模式

在任意一行 `providers` 中将 `mode` 设为 `deepseek-official`，保存并重载后会显示 DeepSeek 专属字段：API Key、模型代码、思考开关和思考强度。`deepseekThinking=disabled` 是默认值，适合需要快速、稳定结构化输出的主叙事、压缩与 Alter；开启后才会发送 `reasoning_effort`，可选 `low`、`high`、`max`。

### 其它官方提供商模式

每一行 `providers.mode` 都可以独立选择，保存并重载后显示该模式的字段。以下预设固定官方 Chat Completions endpoint，只需填写 API Key 与模型名：

| 模式 | 服务商 | 默认模型 | 说明 |
| --- | --- | --- | --- |
| `openai-official` | OpenAI | `gpt-5-mini` | OpenAI 官方 Chat Completions。 |
| `deepseek-official` | DeepSeek | `deepseek-chat` | 可独立开关思考并设置 `low` / `high` / `max` 强度。 |
| `moonshot-official` | Kimi / Moonshot | `kimi-k2.5` | Kimi 官方 OpenAI-compatible 接口。 |
| `dashscope-official` | 阿里云百炼 | `qwen-plus` | 可选择北京、新加坡或美国共享服务地域；工作空间专属地址使用自定义模式。 |
| `siliconflow-official` | 硅基流动 | `Qwen/Qwen3-8B` | 官方 OpenAI-compatible 接口。 |
| `openrouter` | OpenRouter | `openai/gpt-5-mini` | 使用 OpenRouter 模型 slug，例如 `anthropic/...` 或 `google/...`。 |
| `gemini-openai` | Google Gemini | `gemini-2.5-flash` | Gemini 官方 OpenAI 兼容端点。 |

`openai-compatible` 始终保留给第三方中转站、工作空间专属域名和自定义网关。Anthropic 官方 Messages API 与 HDSI 当前 Chat Completions 请求结构不同，因此不作为“官方兼容预设”显示；可通过 OpenRouter，或使用支持 Chat Completions 的中转服务。

### 3.2 providers

| 字段 | 说明 |
| --- | --- |
| `label` | 模型连接的显示名称，例如 GLM 4.7 Flash。 |
| `enabled` | 是否启用这条模型连接。 |
| `endpoint` | 完整 Chat Completions 地址。 |
| `apiKey` | 密钥；按密码处理，不要进入截图和日志。 |
| `model` | 服务商实际模型名；只在这行填写一次。 |
| `useForMain` | 用作主叙事模型。 |
| `useForCompaction` | 用作后台压缩模型。 |
| `useForAlter` | 用作 Alter 侧端分析模型。 |
| `useForEmbedding` | 用作 Embedding 模型；仅支持 `/embeddings` 的模型可勾选。 |
| `useForStickers` | 用作本地表情包描述模型；必须支持图片理解。 |
| `useForVision` | 用作侧端识图模型；`vision.mode=sidecar` 时描述当前私聊图片，必须支持图片理解。 |
| `priceInput` / `priceOutput` / `priceCachedInput` | 可选计费单价（每百万 tokens，币种与所填数值一致）。配置后每次模型调用会在日志中输出计费；缓存命中的输入按 `priceCachedInput` 计（未填时按输入单价），并单独报告"缓存节省"。全部为 0 时不输出计费段。 |
| `extraHeaders` / `extraBody` | 服务商明确要求时填写 JSON 对象。 |

模型行既是连接配置，也是用途分配中心。无需填写或记忆 `providerId`、`modelId`、`mainModelId`；旧配置中的这些字段仍可兼容读取。

### 3.3 主叙事调优

主叙事模型由上方 `useForMain` 自动选择。这里仅调整它的生成行为：

- `mainTemperature`
- `mainTopP`
- `mainMaxTokens`
- `mainTimeout`
- `mainResponseFormat`：主叙事唯一的输出格式设置
- `mainStreamingMode`：实验性流式首条回复，默认 `off`
- `mainPayloadOrder`：主叙事 payload 字段顺序，默认 `legacy`

`mainPayloadOrder=cache-first` 重排用户 payload：对话历史（recentScript）与低频记忆层（长期事实、记忆、Overlay、场景摘要、连续性快照）前置，每轮变化的字段（时钟、当前事件、参与者状态、意图账本）后置。对支持自动前缀缓存的服务商（DeepSeek 官方、GLM 官方、Kimi/Moonshot、硅基流动等），连续对话轮命中稳定前缀后输入成本与 prefill 延迟显著下降；群聊回合与 advance 回合的历史视图不同，缓存命中率会低于私聊连续对话。payload 末尾附带 `recentExchange` 最近交换块（最多 3 条、1600 字符，排除当前消息本身），把最后几条交互重新锚定在生成点旁，避免历史前置稀释语境显著性；固定合约会同步告知模型该块是既定过去的强调而非新事件。默认 `legacy` 逐字节保持历史顺序。开启后建议先在沙盒观察若干轮回复质量与日志中的`回复模式`分布，不适配随时切回。

自动推进独立于 cache-first：它先复用压缩模型生成严格位于当前时间窗口内的相对事件账本，再让主叙事模型渲染。`recentExchange` 仅包含真实收发消息和已投递动作，不包含 script prose；因此启用前缀缓存不会复制上一段自动剧本或改变宿主时间轴。

思考型模型或 Ollama 兼容网关若在 `json-object` 下出现空回复、字段缺失或反复触发恢复重写，可先切换为 `prompt-only`，并按模型实际推理长度适度提高 `mainMaxTokens`。确认模型能稳定输出结构化结果后，再使用 `json-object`。

`mainStreamingMode=experimental` 只在 `json-object` 下尝试私聊首条提前投递。它要求服务商返回标准 OpenAI SSE `choices[].delta.content`；智谱官方 GLM 走已有 SSE 路径，OpenAI-compatible 和各官方兼容预设走实验性通用路径。未知中转站请先在低风险私聊测试，群聊仍等待完整结果。首条成功投递后，后续流式结果失败不会触发可见消息重试，而是只安排一次无 transport 的剧本补写，避免重复发言。

### 3.4 failover 与提示词

`failover.enabled` 控制失败切换；`strategy` 可选按顺序或轮询；`maxAttemptsPerProvider` 控制单服务尝试次数；`cooldownMinutes` 控制失败后的临时跳过。

提示词职责：

- `mainPrompt`：主叙事创作方向。
- `formatPrompt`：结构化协议的补充，不能取消固定 JSON 和时间规则。
- `fixedPrompt`：所有故事通用的长期约束。
- `stylePrompt`：全局文风。

### 3.5 vision、compaction、embedding

- `vision.enabled`：位于模型区最前面；开启后处理当前私聊图片，图片二进制与识别结果都不会写入剧本数据库。
- `vision.mode`：`native` 把图片作为原生多模态输入交给主叙事；`sidecar` 由 `useForVision` 视觉连接先生成一次事实观察，再交给纯文本主模型。不要依赖自动探测或失败后隐式回退，明确选择可避免重复请求。
- `vision.detail`：`low` 更省 token，`high` 更适合细小文字，`auto` 交由服务商决定；对智谱官方接口会自动省略不兼容的 `detail` 字段。
- `vision.maxImageDimension`：视觉输入图片的最长边（默认 `1024`，可选 `0/512/768/1024`）。native 和 sidecar 都会复用此降采样；通过可选 Puppeteer 服务重渲染，节省多模态 token 与上传时间，并顺带修正 EXIF 旋转；Puppeteer 不可用或图片本身较小（<150KB）时自动透传原图，`0` 表示关闭。
- `compaction`：后台整理已发生剧本、事实和状态提案。模型由 `useForCompaction` 选择；这里配置温度、top-p、输出、超时、响应格式和压缩提示词。响应格式默认独立为 `json-object`，不会跟随主叙事的 `prompt-only`；同一未变化场景压缩失败后会短暂冷却，新增剧本条目或手动压缩可再次尝试。
- `embedding`：长期事实语义检索。模型由 `useForEmbedding` 选择；`liveQuery=false` 可避免每次实时回复多一次向量请求，`backfillBatchSize` 控制后台补齐旧事实的速度。
- `embedding.semanticHistory`（默认关闭）：历史语义召回。开启后剧本条目会在后台逐步向量化（最新优先，渐进覆盖全表，无时间窗），每次私聊按当前消息检索最相关的 3 条旧片段注入“回忆块”；召回严格遵守当前参与者的私聊可见性边界。条目已有向量会进入故事级内存缓存（一次加载、增量扩充）；每轮多一次向量请求。这是“取餐码/拿到了”级细节记忆的系统性解法。
- `embedding.semanticStickerFilter`（默认开启）：贴纸目录语义过滤。开启后按当前消息的向量相似度只注入最相关的 12 条贴纸描述（素材描述与别名会在后台自动向量化，每轮最多补齐 8 条）；Embedding 模型不可用或素材尚未建立向量时自动回退全量目录。`stickers.catalogLimit` 仍是绝对上限。

Embedding 地址留空时，插件会尝试从标准 `/chat/completions` 地址推导 `/embeddings`。非标准网关应填写完整地址。

## 4. onebot：OneBot / NapCat 权限

`onebot.enabled=true` 后采用显式白名单：`botAccounts` 或 `userAccounts` 为空都会拒绝对应账号。

### 4.1 botAccounts 与 userAccounts

- `botAccounts`：机器人 QQ、备注、启用状态。
- `userAccounts`：用户 QQ、主角称呼、稳定人物 ID、人物资料、初始关系、启用状态。
- `ignoreSelfMessages`：忽略机器人自己的事件回显，建议开启。

同一现实人物的多个账号可复用 `personId`。不同人物必须分别填写资料和关系，不能把所有 QQ 当作同一关系分支。

### 4.2 groupChats

| 字段 | 说明 |
| --- | --- |
| `groupId` / `label` / `enabled` | 群号、备注和启用状态。 |
| `purpose` | 群的用途和背景。 |
| `characterRole` | 主角在群中的身份和说话位置。 |
| `responseMode` | `mention-only` 只在被 @ 时进入主叙事；`always` 处理所有消息。 |
| `contextLimit` | 主叙事读取的最近群消息数。 |
| `debounceSeconds` | 合并连续群消息的等待时间。 |
| `cooldownSeconds` | 主角群发言后的最短冷却。 |
| `willingness` | 可选的纯算法群聊意愿：积累、半衰减、阈值概率与成功发言成本。 |

群聊不再调用独立快速筛选模型。满足入口规则的消息在合并后直接交给主叙事，由主叙事决定是否输出 `groupReply`。

对 `responseMode=always` 的活跃群，可开启 `willingness`。它完全在本地按算法运行：普通群消息累积意愿、按半衰期自然衰减、接近上限时增益递减、超过阈值后按概率决定是否进入主模型；主角成功群发言后会扣除意愿。关键词与引用机器人消息可增加意愿，@ 机器人始终绕过概率。它默认关闭，只作用于这个群，不影响私聊、Alter、Agency、自动推进或主提示词，也不产生额外模型调用。

### 4.3 voiceTranscription：SnowLuma 私聊语音转写

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 启用 SnowLuma `fetch_ptt_text`。仅处理当前私聊中的 QQ `record` 语音。 |
| `timeoutMs` | `20000` | 转写最大等待时间；超时后仍保留语音事实并继续本轮。 |

转写成功后，主模型收到的用户事件会带有 `[用户语音转写]` 标记，并和当前文本、图片一起构成同一个回合。该功能需要 SnowLuma 支持原始 OneBot `fetch_ptt_text` 动作；NapCat 或其它实现不支持时会安全降级。它不把音频文件或 base64 写入 HDSI 数据库。

## 5. chatActions 与 stickers：平台表达

`nativeFaces` 控制是否允许结构化 QQ 原生小表情；关闭后主模型不会收到对应字段，插件也不会发送 face 段。

`expressionThreshold` 是表达严格度，不是固定发送频率。HDSI 会同时校验模型意愿与当前回复文字是否具有相同的非语言含义：低分或语义不相符时不投递。`0.70` 是平衡值；`0.90` 以上非常克制；`0.95` 及以上接近关闭，适合只保留纯文字聊天的场景。

`stickers.enabled` 默认关闭。开启后插件每五分钟扫描 `directory`，只对新增或变化的图片调用勾选了 `useForStickers` 的视觉模型生成描述；`maxFileSizeMB` 和 `catalogLimit` 分别限制单文件大小及主提示词可见素材数量。`stickers.descriptionResponseFormat` 可独立选择描述模型的返回格式：`json-object` 使用 API JSON mode；模型或中转站频繁报 JSON mode 错误时改为 `prompt-only`，插件不再发送 `response_format`，但仍会从模型输出中解析描述 JSON。

## 6. sharedStory：共享剧本

当前运行时固定为“同一机器人账号一个活动主剧本”，因此不再显示旧版 `enabled` 开关。

| 字段 | 说明 |
| --- | --- |
| `autoEnrollParticipants` | 白名单用户首次私聊时自动加入现有主剧本。 |
| `allowCrossConversationMessages` | 允许一次写作向其它合法参与者产生消息。 |
| `shareParticipantDetails` | 是否向模型提供其它关系分支的原始历史；默认关闭。 |
| `maxCrossConversationActions` | 单回合跨账号动作上限，建议保持 `1`。 |
| `participantContextLimit` | 单次请求携带的其它参与者摘要数量。 |
| `managerAccounts` | 有权执行全局管理命令的 QQ；空表表示所有已授权用户。 |

## 7. runtime：对话与时间

### 6.1 消息合并、回复和失败恢复

| 字段 | 说明 |
| --- | --- |
| `captureDirectMessages` | 是否接管私聊。 |
| `autoCreate` | 没有故事时是否从当前 Console 档案自动启动；关闭时先执行 `interlude.doctor`，再由管理员执行 `interlude.story.start`。 |
| `ignoreCommandMessages` | 防止管理命令进入剧本。 |
| `userMessageDebounceSeconds` | 合并连续私聊的静默等待时间，默认 2 秒。 |
| `narrativeRetryDelaySeconds` / `narrativeRetryMaxAttempts` | 叙事服务失败后的重试节奏。 |
| `cancelDelayedRepliesOnUserMessage` | 是否同时取消普通延迟回复和跨关系计划；未发送的 `<sep/>` 分段始终会被新消息截断。 |
| `minimumDelayedReplySeconds` / `maximumDelayedReplyMinutes` | 模型允许计划的延迟范围。 |
| `maxScriptCharacters` / `maxMessageCharacters` | 单回合剧本和单条可见消息的字符上限。 |

### 6.2 分段消息

`splitReplyMessages` 开启后，模型可以用 `messageSeparator`（默认 `<sep/>`）拆分聊天气泡。`typingBaseDelaySeconds`、`typingCharactersPerSecond` 和 `typingMaxDelaySeconds` 控制后续气泡的模拟输入时间；`typingJitterRatio` 默认 `0.3`，会在理论延迟上下约 30% 抖动，填 `0` 可恢复固定时长。

主模型尚未提交第一条回复时，新消息会废弃旧请求，并把旧、新消息合并后重新写作，不再受固定秒数窗口限制。第一条回复已经提交后，新消息会取消剩余分段；未发送文字以 `interruptedOutgoingDrafts` 进入替代提示词，表示主角想发送但被新消息打断，不能视为已送达内容。

### 6.3 自动生活和主动联系

| 字段 | 说明 |
| --- | --- |
| `autoAdvanceEnabled` | 是否在没有新消息时继续写作生活。 |
| `autoAdvanceIntervalMinutes` / `autoAdvanceJitterMinutes` | 普通时段目标间隔和随机浮动。 |
| `conversationFollowUpMinutes` / `conversationFollowUpJitterMinutes` | 对话结束后的短期补写时间点。 |
| `restWindows` | 睡眠、工作等低频推进窗口，可跨午夜。 |
| `sweepIntervalMinutes` / `maxStoriesPerSweep` | 后台发现到期任务的频率和单轮故事上限。 |
| `minimumAdvanceMinutes` | 手动推进在没有到期任务时需要的最小时间差。 |
| `allowProactiveMessages` | 是否允许无新消息时产生可见主动联系。 |
| `proactiveWillingnessThreshold` | 主模型主动联系意愿门槛。 |
| `contextEntryLimit` | 近期上下文最低条目数，默认 `50`。与 cache-first 搭配时提升几乎不影响实际成本。 |
| `contextTimeWindowMinutes` | 与条目下限取并集的时间窗口，默认 `60` 分钟；窗口内真实用户/角色消息受保护。 |
| `memoryLimit` | 主叙事携带的长期事实数量。 |

## 8. schedulePreplan：近期稳定日程

Schedule Preplan 每天在后台空闲整理时检查主角近期日程。它复用 `useForCompaction` 模型，不增加独立模型选择；已有计划覆盖充足且没有新剧本证据时，程序直接保持原计划，不调用模型。首次尚无可靠规律时，插件会保存“已审查、暂无线索”的空日程记录，并等待后续新的生活证据，不会反复消耗压缩调用。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 启用近期日程生成、每日审查和半日提示词投影。 |
| `horizonDays` | `14` | 后台保存和程序展开的未来天数；不会整批进入主提示词。 |
| `variationLevel` | `stable` | `stable` 只保留稳定周规律；`contextual` 保留有来源的阶段与日期例外；`granular` 允许少量有来源的半透明候选变化。 |
| `candidateActivationProbability` | `0.25` | 仅 granular 候选变化的稳定激活概率；同一故事、日期和候选块只计算一次。 |
| `candidateRevealMinutes` | `120` | granular 候选变化距离开始多少分钟内才向主叙事显示具体内容；更早时只显示为“可能的个人安排”。 |
| `reviewAfterLocalHour` | `3` | 每天主角本地时间达到该小时后，允许第一次空闲审查。 |
| `anchorAutoAdvance` | `true` | 固定日程的开始/结束可提前普通随机推进，避免跨过关键节点。 |

主叙事只接收从当前时刻起未来约 12 小时、最多八项日程块，并明确标记为“计划而非已发生事实”。候选变化不参与固定日程锚点，也不能单独制造生活事件、人物或消息。查看状态使用 `interlude.schedule`；需要重新审查时使用 `interlude.schedule.refresh`，`interlude.schedule.rebuild` 是兼容别名。完整规则见 `docs/SCHEDULE_PREPLAN.md`。

## 9. agency：主体行动窗口

Agency Window 只描述角色能否采取外部联系行动的现实条件，不描述情绪、关系阶段或联系风格。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 启用生活来源的联系候选、容量判断和 `proactive-check` 重查。 |
| `maxWindowMinutes` | `240` | 当前日程/隐私/设备判断最长有效时间，过期后必须重新生成。 |
| `minimumProactiveIntervalMinutes` | `60` | 同一参与者普通主动联系的安全间隔；承诺型联系可绕过。 |
| `maxCandidateHours` | `24` | 联系理由最长保留时间，过期后自然放下。 |

Agency Window 包含 `activityLoad`、`privacy` 和 `deviceAccess`。自动生活剧本先完成，之后才允许产生由真实生活事件、承诺、实际安排或关系后续支撑的联系候选。候选可以立即联系、稍后重查或放下；稍后重查不会预写未来消息。

`runtime.allowProactiveMessages=false` 时 Agency 不产生可见联系。`proactiveWillingnessThreshold`、白名单和单回合动作上限仍然是最终安全边界。Agency 不读取 Alter 数值，也不会影响文风。

## 10. memory：连续性与记忆

### 10.1 整理触发和预算

- `enabled`
- `backgroundIntervalMinutes`
- `sceneEntryThreshold` / `sceneCharacterThreshold`
- `recentEntryLimit` / `factLimit`
- `compactionEntryLimit` / `compactionCharacterLimit`
- `sceneHookCharacters` / `sceneSummaryCharacters` / `arcSummaryCharacters`
- `previousSceneSummaries`：随主提示词附带几个紧邻已关闭场景的摘要（默认 `2`，每条裁剪至 2000 字符并带时间范围），填补原始窗口与弧线摘要之间的记忆缝隙；`0` 表示关闭。
- `factContentCharacters`
- `maxFactsPerStory` / `maxStoriesPerCompactionRun`

近期使用原始剧本；更早内容通过场景、剧情弧线和长期事实压缩。默认在 16 条未压缩条目或 10000 个字符达到其一时整理，短对话会保留更宽的连续回合缓冲。压缩只处理已经发生的内容，不会制造未来事件。

场景压缩同时维护两类记忆载体：`previousScenes`（紧邻已关闭场景的摘要，随主提示词稳定区注入）和 `workingDetails`（取餐码、代购、跑腿这类不够格成为长期事实的小型在途细节，存于故事状态、默认 6 小时内有效，过期自然淡出）。两者都由压缩模型从已发生条目中提取，主合约要求模型安静地将其作为背景使用、绝不逐条复述。

### 10.2 事实排序

`factImportanceWeight`、`factConfidenceWeight`、`factRecencyWeight`、`semanticWeight` 和 `unresolvedWeight` 共同决定旧事实进入主提示词的顺序。`unresolvedWeight` 只奖励仍未兑现的 promise；普通 event 不再因错误的 unresolved 标记长期占据前排。最终结果还固定保留少量最近已完成事件与未完成承诺。Embedding 可用时，语义分数参与排序；否则语义分数为零。

Continuity 从 beta5 起只保存已经建立的 `current`、`recent` 和 `salient`。未来计划由 pending intent、Schedule Preplan 与到期事项动态提供，旧版快照中的自由文本 `next` 不再进入主提示词。承诺或开放事实被履行、取消时会标记 continuity 需要在下一次成功写作中提前刷新。

### 10.3 剧情余波

- `activeConsequencesEnabled`
- `activeConsequencePromptLimit`
- `activeConsequenceMaxDays`
- `activeConsequenceDefaultStrength`

余波保存已经发生事件的短期影响，保持具体、短期，并由后续事件自然收束。

### 10.4 Overlay 演化与压缩

普通状态提案需满足置信度、至少三个独立剧本回合、至少两个日期以及同路径冷却。相关字段包括：

- `statePatchConfidenceThreshold`
- `majorStatePatchConfidenceThreshold`
- `statePatchMinEvidence`
- `statePatchMinTurns`
- `statePatchMinDays`
- `statePatchCooldownHours`
- `autoApplyStatePatches`
- `allowMajorStateChanges`

Overlay 压缩字段包括 `overlayCompressionEnabled`、近期保留天数、周/月窗口和摘要字符上限。管理员可使用 `interlude.overlay.status`、`interlude.overlay.compact` 和 `interlude.overlay.clear` 检查或维护。

## 11. alterSystem：临时氛围偏移

Alter 只衡量本轮新事件对整体氛围造成的净变化：正数偏严肃，负数偏轻松，范围 `-5..5`。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否评分和注入临时 offset。 |
| `baseThreshold` | `10` | 累计触发基础阈值。 |
| `densityFactor` | `0.3` | 最近一小时写作密度降低阈值的比例。 |
| `sameDirectionBoost` | `0.05` | 同向每点 Alter 增加的权重。 |
| `oppositeDecay` | `0.15` | 反向每点 Alter 减少的权重。 |
| `minWeight` | `0.2` | 低于此值清除旧 offset。 |
| `maxIntensity` | `2` | 新 offset 强度上限。 |

Alter 模型由上方 `useForAlter` 选择。`temperature`、`topP`、`maxTokens`、`timeout` 和 `prompt` 只控制这项低频分析任务。

达到阈值后，本轮先完成剧本、状态和可见消息；侧端分析在同一故事队列中后台运行，不阻塞当前回复。失败时保留累计值并进入五分钟冷却。完整算法见 `docs/ALTER_SYSTEM.md`。

## 12. browser：只读网页观察

需要同时启用 Koishi Puppeteer。插件只允许搜索或访问公开 HTTP(S) 页面，不登录、不填表、不下载、不发布内容，并拒绝 localhost、私网和不安全协议。

主要字段：

- `enabled`、`mode`
- `allowSearch`、`allowVisit`
- `searchUrlTemplate`
- `allowedDomains`、`blockedDomains`
- `maxConcurrentPages`、`maxResearchPerSweep`
- `navigationTimeout`、`waitUntil`
- `maxTextCharacters`、`maxExcerptCharacters`、`maxObservationsInPrompt`
- `cacheMinutes`
- `allowGroupTriggeredResearch`
- `logObservationPreview`

`allow-immediate` 会为少数私聊额外执行一次观察并重新请求主叙事，因此延迟和费用都更高。首次测试使用 `deferred-only`。

## 13. logging：日志与隐私

| 字段 | 说明 |
| --- | --- |
| `level` | 错误级别阈值；日常使用 `info`。 |
| `verbosity` | `summary`、`standard`、`diagnostic` 三档运行信息量。 |
| `format` | 默认 `layered` 彩色任务时间线；也可使用 compact 或兼容旧版的 detailed。 |
| `colors` | 为阶段、完成、Alter、警告和错误添加 ANSI 语义颜色。 |
| `colorTheme` | `dark` 使用深色界面的柔亮调色板；`light` 使用明亮界面的深色高对比调色板。由用户按 Console 主题手动选择。 |
| `kaomoji` | 使用固定颜文字；关闭后改用简洁符号。 |
| `logScriptPreview` | 是否记录剧本正文预览。 |
| `logMessageContent` | 是否记录用户和主角可见消息。 |
| `previewLength` | 内容预览字符上限。 |

标准档只保留直观业务事件；扫描、队列、计时器和 SQLite 临时重试进入诊断档。内容开关可能记录私聊和网页文本，排障结束后应关闭。

## 隐藏的历史兼容字段

以下字段不再出现在 Console：

- `sharedStory.enabled`：运行时固定使用共享主剧本。
- `sharedStory.participantPresets`：旧 YAML 可读取，新配置统一使用 `onebot.userAccounts`。
- `onebot.userMode`：运行时固定为 allowlist。
- `runtime.pauseAfterConversationMinutes`：已经被明确的 follow-up 时间表替代。
- `runtime.staleNarrativeRequestWindowSeconds`：稳定版不再使用固定过期秒数；首条回复提交前始终可由新消息替换。
- `model.groupGate`：群聊快速筛选模型已经移除。

旧配置中的这些字段不会恢复旧架构，也不应继续写入新配置。

## 推荐验证顺序

1. `npm run typecheck`、`npm test` 和 `npm run build`。
2. 使用 `fallback` 验证插件加载、数据库和命令。
3. 配置主模型，只测试一个白名单私聊。
4. 测试连续消息、延迟回复取消和 `<sep/>` 分段。
5. 开启自动推进和对话后续补写。
6. 检查 Alter 日志与后台分析。
7. 最后启用 Embedding、视觉、网页观察、群聊和跨账号主动联系。


## 14. chatRhythm：聊天节奏反定型

当主角的回复结构（气泡数、每段长度、尾句语气）连续多轮呈同一模板时，宿主会以主角视角的描写（"她最近回消息的方式有点单一……"）注入主叙事上下文，召唤她本来的节奏多样性——消息长短与条数本身就是表达的一部分。

- `enabled`（默认开启）
- `mode` 检测档位：`gentle` 仅在结构完全同构时判定（适合强模型）；`balanced`（默认）增加尾段语气复读与字数箱体两条判据；`aggressive` 收紧样本要求（最少 4 轮），更早触发。
- `historyLimit` 节奏签名历史窗口（默认 12 轮）。
- `collapseMinSamples` 宽限期：样本不足时不判定（gentle 默认 6 / balanced 5 / aggressive 4）。
- `exhaustLimit` 熔断：连续跟随失败达此轮数（默认 6）后停止注入；更换主叙事模型或手动重置后恢复。

判定与反制全部为宿主本地运算，不产生额外模型调用；注入文本永远以角色名开头、不含任何系统指令词汇。
