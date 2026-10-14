# HDS Interlude 配置指南

适用版本：`1.0.1-rc52`

当前文档已同步至 2026-10-15 的 rc52，累计变更以 rc50 发布包为基线。发布流程已执行源码构建，rc51 由本次生成的 `lib/` 与 `release/koishi-plugin-hds-interlude-1.0.1-rc52.tgz` 交付；旧安装包不会自动获得这些修改，运行实例须安装并重载后才生效。

第一次安装先看 `BEGINNER_GUIDE.md`。本文件按配置依赖关系组织字段；下方先列出当前 Console 的实际顺序，旧版本已经移除或隐藏的字段集中列在末尾，不再混入正常配置流程。

## Console 顺序

配置页按 必填 → 结构 → 节奏 → 表达 → 内在 → 扩展 → 维护 分组编号：

| 分组 | 序号 | 键 | 名称 |
| --- | --- | --- | --- |
| 【必填】 | 1 | `storyDefaults` | 故事档案 |
| 【必填】 | 2 | `model` | 模型中心 |
| 【必填】 | 3 | `onebot` | QQ 接入 |
| 【结构】 | 4 | `sharedStory` | 共享主剧本 |
| 【节奏】 | 5 | `runtime` | 运行时与节奏 |
| 【节奏】 | 6 | `urge` | Urge 弹性推进 |
| 【节奏】 | 7 | `schedulePreplan` | 日程预排 |
| 【节奏】 | 8 | `timelineDirector` | 时间导演 |
| 【节奏】 | 9 | `agency` | 行动窗口 |
| 【表达】 | 10 | `chatActions` | 聊天动作 |
| 【表达】 | 11 | `stickers` | 本地表情包 |
| 【内在】 | 12 | `memory` | 记忆与连续性 |
| 【内在】 | 13 | `alterSystem` | Alter 情绪 |
| 【扩展】 | 14 | `browser` | 网页观察 |
| 【扩展】 | 15 | `worldSeeder` | 世界事件播种器 |
| 【扩展】 | 16 | `longHorizon` | 长线叙事指导 |
| 【扩展】 | 17 | `qzone` | QQ 空间通道 |
| 【扩展】 | 18 | `presetSync` | 预设同步 |
| 【扩展】 | 19 | `weather` | 运行时天气 |
| 【维护】 | 20 | `blindMode` | 盲区模式 |
| 【维护】 | 21 | `logging` | 日志 |

首次测试先完成 `storyDefaults`、`model`、`onebot`、`sharedStory` 和 `runtime`；`blindMode` 保持关闭。Embedding、网页观察、主动联系和内容日志应在基础私聊稳定后逐项开启。


## 1. storyDefaults：故事档案（【必填 1】）

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

## 2. model：模型中心（【必填 2】）

### 2.1 连接顺序

1. 将 `mode` 设为 `openai-compatible`。
2. 先确认 `vision.enabled` 与 `vision.mode`：视觉主模型用 `native`；纯文本主模型可用 `sidecar` 并另配视觉连接。
3. 在 `providers` 的每一行一次填完连接地址、API Key 和实际模型名。
4. 勾选这行模型要承担的用途：主叙事、压缩、Alter、Embedding、表情包描述或侧端识图。初次部署每种用途配置一条即可；需要备用线路、分担负载或故障切换时，同一用途可以勾选多条连接。
5. 在下方按任务分别调整温度、token、超时、提示词和 Embedding 参数。

`fallback` 是旧配置兼容/本地降级路径，不是当前 Console 中的完整运行模式。它只能帮助确认插件、数据库和命令已经加载，不能证明模型连接、视觉、音频、Embedding、压缩、世界播种或故障切换可用。

### 自定义提供商协议（rc12）

自定义 `openai-compatible` 提供商在 rc12 可选择 `protocol=chat-completions`（默认）或 `anthropic-messages`，后者使用 `/v1/messages` 及 `x-api-key` 认证。`anthropicCache` 默认关闭；开启后添加服务端缓存标记，与 `mainPayloadOrder=cache-first` 可组合。完整配置、流式与音频限制见 [rc12 适配说明](docs/development/ANTHROPIC_MESSAGES_RC12.md)。以下官方预设仍采用各自原有协议；其中 Gemini Interactions 使用独立的 Interactions API。若通过该模式接入 DeepSeek V4、方舟等支持 DeepSeek thinking 参数的端点，可将 `deepseekThinking` 设为 `disabled` 或 `enabled`；默认 `inherit`，不会向通用兼容端点主动添加该字段。

### 智谱官方提供商模式

在任意一行 `providers` 中将该行 `mode` 设为 `zhipu-official`，保存并重载后，Console 会切换为智谱专属字段：只需填写智谱 API Key、模型代码和推理强度。该行固定使用 `https://open.bigmodel.cn/api/paas/v4/chat/completions`，不会显示 endpoint、额外请求头或额外请求体；其它提供商行仍可保持 `openai-compatible`。

智谱行的 GLM‑5.3‑Flash 强制使用 SSE：首个可见文本等待上限为 45 秒，首字到达后不设置总等待上限。推理强度可选 `low`、`high`、`max`，默认 `high`；GLM‑5.3‑Flash 不支持关闭思考。图片请求会使用智谱接受的 `image_url.url` 形式，不附带 OpenAI 的 `detail` 字段。

### DeepSeek 官方提供商模式

在任意一行 `providers` 中将 `mode` 设为 `deepseek-official`，保存并重载后会显示 DeepSeek 专属字段：API Key、模型代码、思考开关和思考强度。`deepseekThinking=disabled` 是默认值，适合需要快速、稳定结构化输出的主叙事、压缩与 Alter；开启后才会发送 `reasoning_effort`，可选 `low`、`high`、`max`。自定义 `openai-compatible` 行也提供同名控制，但默认值是 `inherit`，只有明确选择 `disabled` 或 `enabled` 时才会覆盖网关默认行为。

### 2.2.1 官方提供商模式

每一行 `providers.mode` 都可以独立选择，保存并重载后显示该模式的字段。官方模式会固定其 endpoint，通常只需填写 API Key 与模型名：

| 模式 | 服务商 | 默认模型 | 协议与说明 |
| --- | --- | --- | --- |
| `openai-official` | OpenAI | `gpt-5-mini` | OpenAI Chat Completions。 |
| `deepseek-official` | DeepSeek | `deepseek-chat` | Chat Completions；可独立开关思考并设置 `low` / `high` / `max` 强度。 |
| `moonshot-official` | Kimi / Moonshot | `kimi-k2.5` | 官方 OpenAI-compatible 接口。 |
| `dashscope-official` | 阿里云百炼 | `qwen-plus` | 官方 OpenAI-compatible 接口；可选择服务地域。 |
| `siliconflow-official` | 硅基流动 | `Qwen/Qwen3-8B` | 官方 OpenAI-compatible 接口。 |
| `openrouter` | OpenRouter | `openai/gpt-5-mini` | OpenRouter 接口，模型名使用 provider slug。 |
| `gemini-openai` | Google Gemini | `gemini-2.5-flash` | Gemini OpenAI 兼容层；旧模式，部分密钥可能返回 403/404。 |
| `gemini-interactions` | Google Gemini | `gemini-2.5-flash` | Gemini Interactions API（推荐）；使用 `POST /v1beta/interactions`，图片/音频以 `inline_data`/`file_data` 交给主模型。 |

所有连接均可填 `proxyAgent`（HTTP(S) 代理地址，留空直连）。Koishi 的请求层不读系统代理——Cherry Studio 等应用能通而 HDSI 报 `fetch failed` 时，把本机代理地址（如 `http://127.0.0.1:7890`）填到这里即可；只影响该连接的模型请求。

`openai-compatible` 始终保留给第三方中转站、工作空间专属域名和自定义网关。它支持 `chat-completions` 和 `anthropic-messages` 两种协议；Anthropic Messages 不是独立的官方 Provider 模式，需在自定义连接中选择对应协议并填写 `/v1/messages` 地址。

### 2.2 providers

| 字段 | 说明 |
| --- | --- |
| `label` | 模型连接的显示名称，例如 GLM 4.7 Flash。 |
| `enabled` | 是否启用这条模型连接。 |
| `endpoint` | 自定义 `openai-compatible` 连接的完整地址；官方模式使用固定 endpoint，通常不显示此字段。 |
| `apiKey` | 密钥；按密码处理，不要进入截图和日志。 |
| `model` | 服务商实际模型名；只在这行填写一次。 |
| `useForMain` | 用作主叙事模型。 |
| `useForCompaction` | 用作后台压缩模型。 |
| `useForAlter` | 用作 Alter 侧端分析模型。 |
| `useForEmbedding` | 用作 Embedding 模型；仅支持 `/embeddings` 的模型可勾选。 |
| `useForStickers` | 用作本地表情包描述模型；必须支持图片理解。 |
| `useForVision` | 用作侧端识图模型；`vision.mode=sidecar` 时描述当前私聊图片，必须支持图片理解。 |
| `priceInput` / `priceOutput` / `priceCachedInput` | 可选计费单价（每百万 tokens，币种与所填数值一致）。配置后每次模型调用会在日志中输出计费；缓存命中的输入按 `priceCachedInput` 计（未填时按输入单价），并单独报告"缓存节省"。全部为 0 时不输出计费段。 |
| `deepseekThinking` | DeepSeek 兼容端点的思考控制：`inherit` 保持服务商/`extraBody` 原样，`disabled` 强制发送 `thinking.type=disabled`，`enabled` 强制开启并发送 `reasoning_effort`。非 DeepSeek 或不支持该字段的服务保持 `inherit`。 |
| `deepseekReasoningEffort` | `deepseekThinking=enabled` 时的推理强度：`low`、`high` 或 `max`。 |
| `extraHeaders` / `extraBody` | 服务商明确要求时填写 JSON 对象；显式的 `deepseekThinking` 设置优先于 `extraBody` 中同名思考字段。 |

模型行既是连接配置，也是用途分配中心。无需填写或记忆 `providerId`、`modelId`、`mainModelId`；旧配置中的这些字段仍可兼容读取。

### 2.3 主叙事调优

主叙事模型由上方 `useForMain` 自动选择。这里仅调整它的生成行为：

- `mainTemperature`
- `mainTopP`
- `mainMaxTokens`
- `mainTimeout`
- `mainResponseFormat`：主叙事唯一的输出格式设置
- `mainStreamingMode`：实验性流式首条回复，默认 `off`
- `mainPayloadOrder`：主叙事 payload 字段顺序，默认 `cache-first`；遇到服务商兼容性或上下文质量问题时可切回 `legacy`
- `specialization`：模型特化档位，默认 `off`（rc12 原始完整合约，行为与未特化一致）；可选 `lite`（flash 级小模型精简合约）/`standard`（content-only 协议标准合约）/`full`（完整合约），同时作用于主叙事与压缩/时间导演等侧端提示词，改配置后下回合生效
- `specializationFamily`：特化家族，默认 `auto` 按模型名识别；中转自定义别名无法识别时可显式指定（gemini-flash/gemini/claude/gpt/glm/kimi/deepseek/grok/generic）

`mainPayloadOrder=cache-first` 重排用户 payload：对话历史（recentScript）与低频记忆层（长期事实、记忆、Overlay、场景摘要；有原文时不注入旧连续性快照）前置，每轮变化的字段（时钟、当前事件、参与者状态、意图账本）后置。对支持自动前缀缓存的服务商（DeepSeek 官方、GLM 官方、Kimi/Moonshot、硅基流动等），连续对话轮命中稳定前缀后输入成本与 prefill 延迟显著下降；群聊回合与 advance 回合的历史视图不同，缓存命中率会低于私聊连续对话。payload 末尾附带 `recentExchange` 最近交换块（最多 3 条、1600 字符，排除当前消息本身），把最后几条交互重新锚定在生成点旁，避免历史前置稀释语境显著性；固定合约会同步告知模型该块是既定过去的强调而非新事件。默认 `legacy` 使用常规字段顺序，两种模式都使用 beta6 的原文与执行语义。开启后建议先在沙盒观察若干轮回复质量与日志中的`回复模式`分布，不适配随时切回。

自动推进独立于 cache-first：导演提供当前窗口内的相对推进建议，主叙事写实际生活。beta6 将新计划与已提交原文分开，原文引用和投递结果形成下一次交接；旧账本只解释旧版条目。`recentExchange` 仅包含真实收发消息和已投递动作，不复制 script prose。两种模式均保留宿主时钟与原文，缓存本身不是拟真度保证。

思考型模型或 Ollama 兼容网关若在 `json-object` 下出现空回复、字段缺失或反复触发恢复重写，可先切换为 `prompt-only`，并按模型实际推理长度适度提高 `mainMaxTokens`。确认模型能稳定输出结构化结果后，再使用 `json-object`。

`mainStreamingMode=experimental` 只在 `json-object` 下尝试私聊首条提前投递。Chat Completions 要求标准 OpenAI SSE `choices[].delta.content`；rc12 的 Anthropic Messages 使用其原生 SSE text delta，thinking 不进入剧本。智谱官方 GLM 走已有 SSE 路径，其余兼容预设走实验性通用路径。未知中转站请先在低风险私聊测试，群聊仍等待完整结果。首条成功投递后，后续流式结果失败不会触发可见消息重试，而是只安排一次无 transport 的剧本补写，避免重复发言。

### 2.4 failover 与提示词

`failover.enabled` 控制失败切换；`strategy` 可选按顺序或轮询；`maxAttemptsPerProvider` 控制单服务尝试次数；`cooldownMinutes` 控制失败后的临时跳过。

提示词职责：

- `mainPrompt`：主叙事创作方向。
- `formatPrompt`：结构化协议的补充，不能取消固定 JSON 和时间规则。
- `fixedPrompt`：所有故事通用的长期约束。
- `stylePrompt`：全局文风。

### 2.5 vision、compaction、embedding

- `vision.enabled`：位于模型区最前面；开启后处理当前私聊图片，图片二进制与识别结果都不会写入剧本数据库。
- `vision.mode`：`native` 把图片作为原生多模态输入交给 `useForMain` Provider，主叙事模型直接收图；`sidecar` 由 `useForVision` Provider 先生成一次事实观察，再把观察文本交给主叙事模型，主叙事模型不直接收图。sidecar 主要处理当前事件图片，不等于把历史群聊图片永久转换成文本记忆。不要依赖自动探测或失败后隐式回退，明确选择可避免重复请求。
- `vision.detail`：`low` 更省 token，`high` 更适合细小文字，`auto` 交由服务商决定；对智谱官方接口会自动省略不兼容的 `detail` 字段。
- `vision.maxImageDimension`：视觉输入图片的最长边（默认 `1024`，可选 `0/512/768/1024`）。native 和 sidecar 都会复用此降采样；通过可选 Puppeteer 服务重渲染，节省多模态 token 与上传时间，并顺带修正 EXIF 旋转；Puppeteer 不可用或图片本身较小（<150KB）时自动透传原图，`0` 表示关闭。
- `compaction`：后台整理已发生剧本、事实和状态提案。模型由 `useForCompaction` 选择；这里配置温度、top-p、输出、超时、响应格式和压缩提示词。响应格式默认独立为 `json-object`，不会跟随主叙事的 `prompt-only`；同一未变化场景压缩失败后会短暂冷却，新增剧本条目或手动压缩可再次尝试。
- `embedding`：长期事实语义检索。模型由 `useForEmbedding` 选择；`liveQuery=false` 可避免每次实时回复多一次向量请求，`backfillBatchSize` 控制后台补齐旧事实的速度。
- `embedding.semanticHistory`（默认关闭）：历史语义召回。开启后剧本条目会在后台逐步向量化（最新优先，渐进覆盖全表，无时间窗），每次私聊按当前消息检索最相关的 3 条旧片段注入“回忆块”；召回严格遵守当前参与者的私聊可见性边界。条目已有向量会进入故事级内存缓存（一次加载、增量扩充）；每轮多一次向量请求。这是“取餐码/拿到了”级细节记忆的系统性解法。
- `embedding.semanticStickerFilter`（默认开启）：贴纸目录语义过滤。开启后按当前消息的向量相似度只注入最相关的 12 条贴纸描述（素材描述与别名会在后台自动向量化，每轮最多补齐 8 条）；Embedding 模型不可用或素材尚未建立向量时自动回退全量目录。`stickers.catalogLimit` 仍是绝对上限。

Embedding 地址留空时，插件会尝试从标准 `/chat/completions` 地址推导 `/embeddings`。非标准网关应填写完整地址。

## 3. onebot：QQ 接入（【必填 3】）

`onebot.enabled=true` 后采用显式白名单：`botAccounts` 或 `userAccounts` 为空都会拒绝对应账号。

### 3.1 botAccounts 与 userAccounts

- `botAccounts`：机器人 QQ、备注、启用状态。
- `userAccounts`：用户 QQ、主角称呼、稳定人物 ID、人物资料、初始关系、启用状态。
- `ignoreSelfMessages`：忽略机器人自己的事件回显，建议开启。

同一现实人物的多个账号可复用 `personId`。不同人物必须分别填写资料和关系，不能把所有 QQ 当作同一关系分支。

### 3.2 groupChats

| 字段 | 说明 |
| --- | --- |
| `groupId` / `label` / `enabled` | 群号、备注和启用状态。 |
| `assignee` | 群受理人（机器人 QQ），默认留空不修改。填写后在启动/配置重载时同步到 Koishi 的 `channel.assignee`；须属于已启用的 `botAccounts`。 |
| `purpose` | 群的用途和背景。 |
| `characterRole` | 主角在群中的身份和说话位置。 |
| `responseMode` | `mention-only` 只在被 @ 时进入主叙事；`always` 处理所有消息。 |
| `contextLimit` | 主叙事读取的最近群消息数。 |
| `debounceSeconds` | 合并连续群消息的等待时间。 |
| `cooldownSeconds` | 主角群发言后的最短冷却。 |
| `willingness` | 可选的纯算法群聊意愿：积累、半衰减、阈值概率与成功发言成本。 |

**先确认 Koishi 频道受理人**：受理人不等于当前机器人时，未 @ 的消息会在 Koishi 核心层被拦截，HDSI 无法落库或把它们加入上下文；这与私聊用户白名单无关，群友不需要加入 `userAccounts`。换机器人账号后，可在 Console → HDSI → QQ 接入 → 群聊白名单中，为目标群填写 `assignee` 并保存。这里只修改已启用且明确配置的 OneBot 群，不解除频道/用户忽略标记；留空、停用或删除配置不会撤销已经写入的受理人。一个频道只有一个受理人，多机器人实例不要为同一群配置冲突值。

群聊不再调用独立快速筛选模型。普通消息合并后仍经过意愿与冷却判断，再交给主叙事。rc12 对可提取的音频文件/语音跳过意愿、冷却与仅 @ 门槛，直接进入合并写作队列，携带本批原生音频；仍由主叙事决定是否输出 `groupReply`。群白名单、原生音频开关、数量及大小限制保留；音频读取失败会警告。使用 Messages 协议时，还需要服务商真正支持音频输入；必要时应准备兼容的 Chat Completions 故障转移连接。

对 `responseMode=always` 的活跃群，可使用 `willingnessPreset` 选择 `quiet`、`reserved`、`normal`、`active`、`eager`、`auto` 或 `custom`。`off`（默认）只保留响应模式与冷却；`custom` 才使用下方旧数值对象。意愿门完全在本地运行，不增加模型调用。普通状态下 @ 通常绕过意愿概率；睡眠态例外，@ 不会立即直通，而交给后续主叙事自然处理。群音频仍独立绕过意愿和冷却门槛。关键词与引用机器人消息可增加意愿，主角成功群发言后会扣除意愿。该功能只作用于当前群，不影响私聊、Alter、Agency、自动推进或主提示词。

`willingnessPreset=auto` 时，若 `lifeStatus` 缺失、无效或超过 6 小时未刷新，按 **idle** 生活状态使用 `willingnessAuto.idle`（默认 `active`）；例如配置 `idle: eager` 就回退到 `eager`，不再固定回退 `normal`。这是本地门控回退，不会伪造或写回生活状态。有效的 busy/asleep 状态仍保留原行为；评估调用和成功发言后的意愿扣减使用相同档位。

### 3.3 `model.audio`：原生音频理解（当前语音路径）

不请求文字转写，而是由 SnowLuma 将 QQ SILK 语音转码后作为原生音频内容交给主模型。只有支持音频输入的主模型（例如 Gemini）才适用；它不会在模型不支持时自动回退为文字转写。未开启时，语音在上下文中以 `[语音]` 占位记录。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 启用原生语音/音频理解。 |
| `outFormat` | `mp3` | SnowLuma 转码格式；`mp3` 通常兼容性最好。 |
| `maxFileSizeMB` | `10` | 单个音频附件最大体积。超出后保留语音事实但跳过音频输入。 |
| `maxPerMessage` | `1` | 每个事件最多接收的音频附件数。 |

转码失败、OneBot 实现不支持或模型拒绝音频时，插件继续处理同一消息中的文字和图片，不猜测音频内容；音频二进制和请求内容不会写入 HDSI 数据库。

## 4. sharedStory：共享主剧本（【结构 4】）

当前运行时固定为“同一机器人账号一个活动主剧本”，因此不再显示旧版 `enabled` 开关。

| 字段 | 说明 |
| --- | --- |
| `autoEnrollParticipants` | 白名单用户首次私聊时自动加入现有主剧本。 |
| `allowCrossConversationMessages` | 允许一次写作向其它合法参与者产生消息。 |
| `shareParticipantDetails` | 是否向模型提供其它关系分支的原始历史；默认关闭。长期事实是全局叙事材料，不受此开关过滤。 |
| `maxCrossConversationActions` | 单回合跨账号动作上限，建议保持 `1`。 |
| `participantContextLimit` | 单次请求携带的其它参与者摘要数量。 |
| `managerAccounts` | 有权执行全局管理命令的 QQ；空表表示所有已授权用户。 |

启用 `allowCrossConversationMessages` 后，模型可在私聊回合同时输出当前私聊回复和群消息。群消息目标使用 `crossConversationActions[].participantId` 的 `group:<QQ群号>` 格式，并且只能投递到 `onebot.groupChats` 中已启用的群。

## 5. runtime：运行时与节奏（【节奏 5】）

### 5.1 消息合并、回复和失败恢复

| 字段 | 说明 |
| --- | --- |
| `captureDirectMessages` | 是否接管私聊。 |
| `autoCreate` | 没有故事时是否从当前 Console 档案自动启动；关闭时先执行 `interlude.doctor`，再由管理员执行 `interlude.story.start`。 |
| `ignoreCommandMessages` | 防止管理命令进入剧本。 |
| `userMessageDebounceSeconds` | 合并连续私聊的静默等待时间，默认 2 秒。 |

### 5.2 QQ 合并转发读取

`runtime.forwardMessage` 默认开启。收到 QQ `forward` segment 时，HDSI 会通过当前 SnowLuma/OneBot 账号调用 `get_forward_msg`，把转发节点中的文字、@、回复关系和媒体类型占位符并入同一条当前用户事件；普通文本、图片和语音消息不会额外发起请求。

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| `enabled` | `true` | 关闭后不读取正文，保留原有转发卡片行为。 |
| `maxNodes` | `30` | 单条转发最多读取的节点数。 |
| `maxCharacters` | `8000` | 注入当前事件的最大字符数。 |
| `maxDepth` | `3` | 嵌套合并转发的最大展开层数。 |

读取失败、资源标识缺失或达到预算时会保留占位事实，不根据卡片摘要猜测正文。转发节点中的第三方发言属于“被转交内容”，不会自动创建参与者或绕过现有白名单。
| `narrativeRetryDelaySeconds` / `narrativeRetryMaxAttempts` | 叙事服务失败后的重试节奏。 |
| `cancelDelayedRepliesOnUserMessage` | 是否同时取消普通延迟回复和跨关系计划；未发送的 `<sep/>` 分段始终会被新消息截断。 |
| `minimumDelayedReplySeconds` / `maximumDelayedReplyMinutes` | 模型允许计划的延迟范围。 |
| `maxScriptCharacters` / `maxMessageCharacters` | 单回合剧本和单条可见消息的字符上限。 |

### 5.3 分段消息

`splitReplyMessages` 开启后，模型可以用 `messageSeparator`（默认 `<sep/>`）拆分聊天气泡。`typingBaseDelaySeconds`、`typingCharactersPerSecond` 和 `typingMaxDelaySeconds` 控制后续气泡的模拟输入时间；`typingJitterRatio` 默认 `0.3`，会在理论延迟上下约 30% 抖动，填 `0` 可恢复固定时长。

后续气泡持久化为 `split-message` 意图，并按实际回执更新源剧本的分段账本；尚未送达的文字不是已确认的 `character-message`。同一参与者仍有 pending 分段（包括尚未到发送时间的分段）时，到期补写和对话后续写作先等待；全局生活推进（含手动推进）等待所有 pending 分段。其它参与者的独立到期任务、网页和 QQ 空间执行器不因此停机。新用户消息仍可打断未发送分段。

重启恢复只补偿已落库、仍为 pending 的消息 segment，不重新运行主叙事。已有分段意图的气泡仍交给原打字执行器，恢复扫描不会绕过延迟抢发。已 delivered/cancelled 的 segment 不再自动发送。

`convertNewlineToSeparator`（默认关闭）是小模型适配开关：模型没有按合约输出 `<sep/>` 而是用换行分条时，把每个换行自动视作一条消息的分隔再发送。内容里已有 `<sep/>` 时不做转换；`splitReplyMessages` 关闭时该开关无效。Gemma 等不遵守分句合约的小模型建议开启。

主模型尚未提交第一条回复时，新消息会废弃旧请求，并把旧、新消息合并后重新写作，不再受固定秒数窗口限制。第一条回复已经提交后，新消息会取消剩余分段；未发送文字以 `interruptedOutgoingDrafts` 进入替代提示词，表示主角想发送但被新消息打断，不能视为已送达内容。

### 5.4 自动生活和主动联系

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
| `contextEntryLimit` | 写入主叙事上下文的近期原始剧本条目数，默认 `35`。小模型可调小（如 `15`）——低于 35 的设置真实生效（旧版的 35 硬地板已移除）。 |
| `contextTimeWindowMinutes` | 与条目数取并集的时间窗口，默认 `45` 分钟（窗口内条目全部并入，上限 500）；`0` 关闭。小模型收缩上下文时需与条数一起调小或关闭。 |
| `memoryLimit` | 主叙事携带的长期事实数量。 |

### 5.5 承诺回访的调度终止

`follow-up-commitment` 每位参与者最多两项待处理承诺。到期写作没有明确可见结算时，通常 20 分钟后重查，但必须遵守 `expiresAt` 硬截止及最多 5 次未结算顺延；达到限制后不再调用模型，由宿主将意图退役为 `cancelled`。新承诺有效期最多 24 小时，旧记录缺失/无效截止时间时固定采用 `createdAt + 24h`，不会每次读取续命。等待分段只是调度等待，不增加顺延计数，也不延长截止时间；到期时优先退役。

退役不等于角色履行了承诺，也不凭空生成“我取消了”的可见消息；历史剧本和审计原因保留。上述次数与旧记录期限是宿主边界，目前没有新增 Console 开关。

## 6. urge：弹性推进（【节奏 6】）

`urge.enabled` 默认关闭。开启后，它仍使用同一条自动剧本链，但以真实用户消息的热度、已提交剧本中的 `urge`／`slow` 交接和既有 Agency 行动决定下一次 `nextAdvanceAt`；它替代固定的对话后短期补写与普通固定间隔，不新增独立模型调用，不降低原文精细度。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 开启弹性调度。`runtime.autoAdvanceEnabled` 仍是总开关。 |
| `frequency` | `medium` | `low`／`medium`／`high`／`custom`；只改变推进时间范围，不改变角色性格或联系文本。 |
| `proactiveWillingnessThreshold` | `0.4` | 仅 Urge 开启时的主动联系门槛；关闭后使用 runtime 原门槛。 |
| `advanced` | 折叠 | 密聊、安静、加速与 slow 的时间范围；热度半衰期、随机量、加速有效期／预算及同对象临时最短联系间隔。 |

高 Urge 必须同时有既有 Agency 允许的实际联系行动，且等到首个真实发送回执后，才会开始有限的短期加速。休息、设备不可用、隐私和负荷仍优先；自动发言不增加对话热度。关闭 Urge 后，下一次调度回到 runtime 的普通计划。详见 [Urge 实现记录](docs/development/URGE_SYSTEM_IMPLEMENTATION.md)。

## 7. schedulePreplan：日程预排（【节奏 7】）

Schedule Preplan 每天在后台空闲整理时检查主角近期日程。它复用 `useForCompaction` 模型，不增加独立模型选择；已有计划覆盖充足且没有新剧本证据时，程序直接保持原计划，不调用模型。首次尚无可靠规律时，插件会保存“已审查、暂无线索”的空日程记录，并等待后续新的生活证据，不会反复消耗压缩调用。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 启用近期日程生成、每日审查和半日提示词投影。 |
| `horizonDays` | `14` | 后台保存和程序展开的未来天数；不会整批进入主提示词。 |
| `variationLevel` | `stable` | `stable` 只保留稳定周规律；`contextual` 保留有来源的阶段与日期例外；`granular` 允许少量有来源的半透明候选变化。 |
| `candidateActivationProbability` | `0.25` | 仅 granular 候选变化的稳定激活概率；同一故事、日期和候选块只计算一次。 |
| `candidateRevealMinutes` | `120` | 已激活的 granular 候选距离开始多少分钟内才显示具体内容；更早时只显示“可能的个人安排”，未激活候选完全不显示。 |
| `reviewAfterLocalHour` | `3` | 每天主角本地时间达到该小时后，允许第一次空闲审查。 |
| `anchorAutoAdvance` | `true` | 固定日程的开始/结束可提前普通随机推进，避免跨过关键节点。 |

主叙事只接收从当前时刻起未来约 12 小时、最多八项日程块，并明确标记为“计划而非已发生事实”。候选变化不参与固定日程锚点，也不能单独制造生活事件、人物或消息。查看状态使用 `interlude.schedule`；需要重新审查时使用 `interlude.schedule.refresh`，`interlude.schedule.rebuild` 是兼容别名。完整规则见 `docs/SCHEDULE_PREPLAN.md`。

- 候选显示：未激活候选完全不显示；已激活候选在揭示时间前只显示“可能的个人安排”，进入揭示时间后才显示具体内容。仅 granular 模式使用候选。

## 8. timelineDirector：时间导演（【节奏 8】）

启用后，自动推进与较长后台窗口先由压缩链路生成相对时间账本（只含客观时间事实与可能的时间逻辑），主模型据账本续写剧本。设计原则：不做笃定的未来预测（不写死几点起床、几点完成）；用户消息对主角的影响（如吵醒）由主模型判断。失败时降级为无账本推进并带熔断冷却，不冻结自动推进。

| 字段 | 说明 |
| --- | --- |
| `enabled` | 默认开启；关闭后自动回合直接续写原始剧本。 |
## 9. agency：行动窗口（【节奏 9】）

Agency Window 只描述角色能否采取外部联系行动的现实条件，不描述情绪、关系阶段或联系风格。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 默认关闭；显式开启后启用生活来源的联系候选、容量判断和 `proactive-check` 重查。已有显式 `true` 配置保持开启。 |
| `maxWindowMinutes` | `240` | 当前日程/隐私/设备判断最长有效时间，过期后必须重新生成。 |
| `minimumProactiveIntervalMinutes` | `60` | 同一参与者普通主动联系的安全间隔；承诺型联系可绕过。 |
| `maxCandidateHours` | `24` | 联系理由最长保留时间，过期后自然放下。 |
| `contactMode` | `strict` | 联系温度三档：`strict`（沉默不是理由，阈值取运行时/Urge 有效值）；`natural`（想念、好奇近况等情感动机合法，阈值降为 `naturalWillingnessThreshold`，安全间隔取 `naturalMinimumIntervalMinutes`）；`balanced`（同 natural 但要求节制使用情感动机）。设备/隐私/负荷容量硬门三档均不放宽。 |
| `naturalWillingnessThreshold` | `0.25` | natural/balanced 模式的意愿阈值。 |
| `naturalMinimumIntervalMinutes` | `30` | natural/balanced 模式的安全间隔（仅当小于严格间隔时生效）。 |
| `proactiveDailyCap` | `3` | 每参与者每 24 小时主动联系上限（`0` 不限），全模式生效；按**送达**计数——放行时预记、投递终态失败即作废，被拦截或失败的发送不消耗配额。 |

Agency Window 包含 `activityLoad`、`privacy` 和 `deviceAccess`。自动生活剧本先完成，之后才允许产生由真实生活事件、承诺、实际安排或关系后续支撑的联系候选。候选可以立即联系、稍后重查或放下；稍后重查不会预写未来消息。

`runtime.allowProactiveMessages=false` 时 Agency 不产生可见联系。`proactiveWillingnessThreshold`、白名单和单回合动作上限仍然是最终安全边界。Agency 不读取 Alter 数值，也不会影响文风。

## 10-11. chatActions 与 stickers：聊天动作与本地表情包（【表达】）

`nativeFaces` 控制是否允许结构化 QQ 原生小表情；关闭后主模型不会收到对应字段，插件也不会发送 face 段。

`expressionThreshold` 是表达严格度，不是固定发送频率。HDSI 会同时校验模型意愿与当前回复文字是否具有相同的非语言含义：低分或语义不相符时不投递。`0.70` 是平衡值；`0.90` 以上非常克制；`0.95` 及以上接近关闭，适合只保留纯文字聊天的场景。

`stickers.enabled` 默认关闭。开启后插件每五分钟扫描 `directory`，只对新增或变化的图片调用勾选了 `useForStickers` 的视觉模型生成描述；`maxFileSizeMB` 和 `catalogLimit` 分别限制单文件大小及主提示词可见素材数量。`stickers.descriptionResponseFormat` 可独立选择描述模型的返回格式：`json-object` 使用 API JSON mode；模型或中转站频繁报 JSON mode 错误时改为 `prompt-only`，插件不再发送 `response_format`，但仍会从模型输出中解析描述 JSON。

**发送与投递**：表情包经 Koishi 自身 HTTP 服务回源投递（路由 `/hds-interlude/sticker/<素材ID>`），不再使用 `file:///` 本地路径——OneBot 实现（NapCat/Lagrange）与 Koishi 分容器或分进程部署时读不到对方文件系统（表现为 retcode 1200/100、路径明明正常）。基址自动推导顺序：`stickers.deliveryBaseUrl` 显式配置 > Koishi `selfUrl` > `http://127.0.0.1:5140`。NapCat 与 Koishi 不同机/不同容器时，把 `deliveryBaseUrl` 设为 NapCat 可访问的 Koishi 服务地址（如 `http://192.168.x.x:5140` 或 docker 网络内的服务名）。

## 12. memory：记忆与连续性（【内在 12】）

### 12.1 整理触发和预算

- `enabled`
- `backgroundIntervalMinutes`
- `sceneEntryThreshold` / `sceneCharacterThreshold`
- `recentEntryLimit` / `factLimit`
- `compactionEntryLimit` / `compactionCharacterLimit`
- `sceneHookCharacters` / `sceneSummaryCharacters` / `arcSummaryCharacters`
- `arcPromptCharacters`（弧摘要随每回合提示词携带的上限,超长保尾部;默认 6000,全量仍存库）
- `previousSceneSummaries`：随主提示词附带几个紧邻已关闭场景的摘要（默认 `2`，每条裁剪至 2000 字符并带时间范围），填补原始窗口与弧线摘要之间的记忆缝隙；`0` 表示关闭。
- `factContentCharacters`
- `maxFactsPerStory` / `maxStoriesPerCompactionRun`

近期使用原始剧本；更早内容通过场景、剧情弧线和长期事实压缩。默认在 16 条未压缩条目或 10000 个字符达到其一时整理，短对话会保留更宽的连续回合缓冲。压缩只处理已经发生的内容，不会制造未来事件。

场景压缩同时维护两类记忆载体：`previousScenes`（紧邻已关闭场景的摘要，随主提示词稳定区注入）和 `workingDetails`（取餐码、代购、跑腿这类不够格成为长期事实的小型在途细节，存于故事状态、默认 6 小时内有效，过期自然淡出）。两者都由压缩模型从已发生条目中提取，主合约要求模型安静地将其作为背景使用、绝不逐条复述。

### 12.2 事实排序

`factImportanceWeight`、`factConfidenceWeight`、`factRecencyWeight`、`semanticWeight` 和 `unresolvedWeight` 共同决定旧事实进入主提示词的顺序。`unresolvedWeight` 只奖励仍未兑现的 promise；普通 event 不再因错误的 unresolved 标记长期占据前排。最终结果还固定保留少量最近已完成事件与未完成承诺。Embedding 可用时，语义分数参与排序；否则语义分数为零。

当前主叙事不再实时生成 continuitySnapshot；旧 `current`、`recent`、`salient` 仅保留历史兼容，有原始剧本时不投影，旧自由文本 `next` 不进入主提示词。未来计划由 pending intent、Schedule Preplan 与到期事项动态提供，不能当作已经发生的事实。

长期事实来自同一个全局候选池，`scope=relationship` 是内容类别而不是收件人权限；旧数据库 `participantId` 列仅兼容保留，不参与事实可见性判断，也不额外进入主叙事事实投影。涉及人物时应在正文明确名字及关系，例如“小林说小林今天要出门”，不要只写“他说要出门”。管理员添加与模型提取均有明显指代不清的检查，但这不代替语义审查。模型按当前剧情决定是否对某位用户提及事实；事实排序和 `memoryLimit` 仍生效，并非每轮发送整个事实库。原始私聊、场景记忆和网页观察仍遵循各自的共享边界。

### 12.3 剧情余波

- `activeConsequencesEnabled`
- `activeConsequencePromptLimit`
- `activeConsequenceMaxDays`
- `activeConsequenceDefaultStrength`

余波保存已经发生事件的短期影响，保持具体、短期，并由后续事件自然收束。

### 12.4 Overlay 演化与压缩

普通状态提案需满足置信度、至少三个独立剧本回合、至少两个日期以及同路径冷却。相关字段包括：

- `statePatchConfidenceThreshold`
- `majorStatePatchConfidenceThreshold`
- `statePatchMinEvidence`
- `statePatchMinTurns`
- `statePatchMajorMinScenes`（重大变更自动应用所需最少独立场景数,默认 2）
- `statePatchMinDays`
- `statePatchCooldownHours`
- `autoApplyStatePatches`
- `allowMajorStateChanges`

Overlay 压缩字段包括 `overlayCompressionEnabled`、近期保留天数、周/月窗口和摘要字符上限。管理员可使用 `interlude.overlay.status`、`interlude.overlay.compact` 和 `interlude.overlay.clear` 检查或维护。

## 13. alterSystem：Alter 情绪（【内在 13】）

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

## 14. browser：网页观察（【扩展 14】）

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

## 15. worldSeeder：世界事件播种器（【扩展 15】）

后台低频生成与主角有关的外部事件（线下通道、NPC），到点以 `[世界事件]` 条目进入剧本。**模型选择在【必填 2】模型中心的连接上勾选"用于世界播种"**；未勾选任何连接时开关无效（视为关闭）。

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 总开关（仍需模型中心勾选连接） |
| `cadenceMinutes` | `30` | 生成检查间隔（分钟）；每轮约 10% 概率整轮跳过，多数检查输出空 |
| `maxPending` | `6` | 同时挂起的未注入事件上限 |
| `dailyCap` | `8` | 每 24 小时注入上限（高重要性每天至多 1 条） |
| `maxHorizonHours` | `72` | 事件最远发生时限 |
| `temperature` | `0.9` | 生成温度 |
| `maxTokens` | `1000` | 单次输出预算 |
| `timeout` | `60000` | 请求超时（毫秒） |

机制要点：**每轮检查面向一个"世界切面"提问**（天象与环境/居所与近邻/生计与日常事务/亲近之人/途中与陌生人/小意外与际遇，按剧本+时间确定性轮换）——切面是世界的通用方面而非现代题材，异世界/古代世界观由各自 worldSetting 渲染具体面貌。已注入事件不进入播种器的灵感摘录（防自馈复读），自身产出仅作"近期已播"记忆。**多数检查应输出空**；这是正常形态，不是故障。详细设计见 `docs/WORLD_EVENT_SEEDER_DESIGN.md`。

## 16. longHorizon：长线叙事指导（【扩展 16】）

实验性叙事催化器（Narrative Attractor）：累计加权叙事证据后异步生成阶段性人物弧线方向，主叙事在自然场景中参考它渐进推进。**默认关闭**。

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 总开关 |
| `triggerScore` | `25` | 首次生成的加权分数门槛（私聊 1.0 / 群聊 0.5） |
| `reviewIncrement` | `40` | 上次生成后再积累多少分触发复审 |
| `privateWeight` | `1.0` | 私聊条目权重 |
| `groupWeight` | `0.5` | 群聊条目权重 |
| `intensity` | `subtle` | 指导强度（第一版默认 subtle） |

**催化器三态生命周期**：`dormant`（有效的不写决定——推进复审基线但不产生 active 指导）、`prime`（允许一次最小、可逆的首次表达，含自然触发条件和最大尝试数）、`activate`（首次表达已被回应，方向可成为反复倾向）。模型未显式声明 `decision` 时保守落为 `dormant`。

**模型路由**：长线指导模型复用 compaction 路由（在【必填 2】模型中心勾选"用于压缩整理"即可），温度自动钳制 ≤0.35，JSON mode 输出。

**隐私边界**：`shareParticipantDetails=false` 时长线模型仍只看主参与者的原始历史，但 durable facts 会作为全局叙事材料传入；该开关不控制长期事实是否传递。计分不受影响。

**与现有系统的关系**：指导 ≠ 事实——实际行为经现有证据流程后才更新事实/overlay。Agency/Urge 行动容量不受指导影响。设计详见 `docs/LONG_HORIZON_NARRATIVE_GUIDANCE_DESIGN.md`。

## 17. qzone：QQ 空间通道（【扩展 17】）

以她本人身份发说说/评论/点赞（经 SnowLuma 的 qzone 扩展动作；需连接在线）。默认关闭；高频会被 Qzone 风控，保持保守上限。启用后可用 `interlude.qzone <内容>` 直接发说说；满足运行条件时，叙事会自动读取好友动态，并在限流内执行模型安排的发帖、评论和点赞意图。键：`enabled`（false）、`dailyPostCap`（3）、`dailyCommentCap`（6）、`dailyLikeCap`（12）、`minIntervalMinutes`（90，跨类型共享）、`feedWindowMinutes`（120，好友动态只消费窗口内新鲜说说）。设计见 `docs/QZONE_FEED_DESIGN.md`。

## 18. presetSync：预设同步（【扩展 18】）

从 typ0-site 分享站拉取并应用预设，默认关闭。分享码可在预设详情页获取；模型连接凭据不属于此同步分区。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 启用预设同步，需填写分享码。 |
| `baseUrl` | `https://typ0.space` | 分享站地址；自托管可填写自己的站点地址。 |
| `shareCode` | 空 | 8 位分享码，支持大小写及连字符。 |
| `autoUpdate` | `false` | 开启后在重载时检查远端 revision，有新版本才应用；关闭时由 `interlude.preset.sync` 手动触发。 |
| `sections` | 空数组 | 留空同步预设中所有支持的分区；填写时只同步选定分区。 |
| `applyToCurrentStory` | `false` | 是否把 storyDefaults 同时应用到正在运行的故事。 |

同步可能改变当前配置；首次使用建议明确选择分区并保持 `applyToCurrentStory=false`。

## 19. weather：运行时天气（【扩展 19】）

从 Open-Meteo（免费、无需 API Key）拉取真实天气，以 `[世界事件]` 剧本条目注入当前温度与天况，默认关闭。注入走世界事件管线：滚动替换（时间线上只保留最新一条天气事件）、内容不变不重复注入。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 启用运行时天气注入。 |
| `latitude` | `39.14` | 观测点纬度（手动模式，或自动解析失败时的回退）。 |
| `longitude` | `117.18` | 观测点经度。 |
| `autoFromLocation` | `true` | 从故事设定的地点（storySetting.location）自动解析观测点；解析失败回退手动经纬度。 |
| `skipFantasyWorld` | `false` | 手动开关：架空世界（异世界/精灵/幻想设定）跳过天气注入。 |
| `cadenceMinutes` | `30` | 拉取间隔（分钟）。注入为纯数据格式（如"环境：22°C 小毛毛雨。"），不带建议句。 |

## 20. blindMode：盲区模式（【维护 20】）

开启 `blindMode.enabled` 后，HDSI 不注册自己的管理指令，并静默拦截当前 Koishi 实例中所有已经识别的指令；普通聊天仍会进入叙事。HDSI 的普通运行日志、错误详情和消息预览都会隐藏，只按 `healthReportMinutes` 输出一次不含故事或账户内容的运行状态心跳；其它插件仍遵循各自的日志配置。

它适合追求高度沉浸感，并且模型、账号白名单和故事档案已经稳定正常的环境。关闭此模式需要在 Console 修改配置并重载插件；失明模式开启期间无法通过聊天指令恢复管理能力。旧 `blackBox` 配置仍可兼容读取，但 Console 只显示 `blindMode`。

## 21. logging：日志（【维护 21】）

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

## 专题：onebot 群聊历史图片回流

群聊中用户发送的图片会持久化引用到 `metadata.groupImageRefs`。下一次真实进入群聊主叙事时，从同群历史条目中按新到旧选取图片作为视觉证据（低细节模式），当前回合图片与历史图片去重。数据库只保存 URL 或 OneBot `file` 引用，不保存图片内容；QQ CDN URL 可能过期，OneBot `file` token 也可能无法跨会话再次解析。模型支持视觉不等于历史图片一定能成功回源：回源失败发生在模型请求前；图片成功回源后仍可能因多图 payload、MIME、网关协议或服务商图片格式限制返回 400。

| 键 | 默认 | 说明 |
|---|---|---|
| `groupChats[].historicalImageLimit` | `3` | 一次群聊主叙事最多附带的最近历史图片张数（0–6，设 0 关闭） |

- 历史图片是**视觉证据**，不是当前指令；加载失败不阻塞本回合
- mention-only 模式下未 @ 机器人的图片会落库但不单独触发主叙事
- 持久化层只保存 URL / OneBot file 引用，不保存 data URI
- Puppeteer 不可用时，动态图片抽帧和图片降采样不会执行；动态图片通常会保留原图继续尝试
- 私聊图片行为不变

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

1. 插件目录 `npm run typecheck` 与 `npm test`；构建须在**工作区根目录**执行 `npx yakumo build`（插件包无独立 build 脚本）。
2. 使用 `interlude.doctor` 和 `interlude.story.start` 验证插件加载、数据库和命令；不要把 `fallback` 当作当前完整运行模式。
3. 配置主模型，只测试一个白名单私聊。
4. 测试连续消息、延迟回复取消和 `<sep/>` 分段。
5. 开启自动推进和对话后续补写。
6. 检查 Alter 日志与后台分析。
7. 最后启用 Embedding、视觉、网页观察、群聊和跨账号主动联系。


## chatRhythm：已弃用的兼容配置

从 beta5-m9 起，旧检测器、反制指令和投递后统计已经删除，Console 隐藏此配置。旧 YAML 与数据库统计继续兼容读取，以下字段不再影响运行；无需手动删除历史状态。

- `enabled`（默认开启）
- `mode` 检测档位：`gentle` 仅在结构完全同构时判定（适合强模型）；`balanced`（默认）增加尾段语气复读与字数箱体两条判据；`aggressive` 收紧样本要求（最少 4 轮），更早触发。
- `historyLimit` 节奏签名历史窗口（默认 12 轮）。
- `collapseMinSamples` 宽限期：样本不足时不判定（gentle 默认 6 / balanced 5 / aggressive 4）。
- `exhaustLimit` 熔断：连续跟随失败达此轮数（默认 6）后停止注入；更换主叙事模型或手动重置后恢复。

这些是旧版本字段释义，不再是当前行为。当前续写从原始剧本的最后落点继续，长段复用仅作 debug 观测，不对相同短句、反复追问或文学形式做拦截和重试。

