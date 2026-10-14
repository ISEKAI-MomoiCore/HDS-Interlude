# HDS Interlude 新手引导

适用版本：`1.0.1-rc52`

当前文档已同步至 2026-10-15 的 rc52，累计变更以 rc50 发布包为基线。发布流程已执行源码构建，rc51 由本次生成的 `lib/` 与 `release/koishi-plugin-hds-interlude-1.0.1-rc52.tgz` 交付；旧安装包不会自动获得这些修改，运行实例须安装并重载后才生效。

HDS Interlude 是 Koishi 的持续叙事聊天插件。插件使用共享主剧本保存角色状态、关系分支、已发生事件、待处理计划和长期记忆。用户消息会进入当前活动场景；主模型在同一次请求中续写已经发生的生活，并决定是否发送、延迟发送或暂不发送消息。实时写作读取一条按时间排序的活动场景记录：最近剧本文字、真实用户消息和已经成功投递的角色消息在同一条线上。剧本引子、场景外近期事实和长期记忆负责更早的历史。

## 适用场景

- 角色需要保留长期关系、日程、承诺和事件连续性。
- 多个 QQ 账号需要与同一角色共享一个主剧本。
- 需要延迟回复、主动联系、自动推进或提醒计划。
- 需要通过摘要、长期事实和语义检索控制上下文长度。

## 首次配置

1. 在 Koishi Console 启用 `hds-interlude`。
2. 在“模型与服务商”中添加一行模型连接，选择对应的 `mode`，填写该模式需要的连接信息，并勾选 `useForMain`。初次部署每种用途配置一条即可；需要备用线路或故障切换时，同一用途可以配置多条连接。
3. 在“故事档案”中填写主角资料、默认关系、世界设定、地点、时区和叙事风格。
4. 使用 OneBot/NapCat 时，先打开 `onebot.enabled`，再在 `onebot.botAccounts` 填写机器人 QQ；在 `onebot.userAccounts` 逐项填写允许私聊的测试 QQ、人物资料和初始关系。
5. 保存配置后，在已授权私聊中执行：

```text
interlude.doctor
interlude.story.start
```

Console 配置页已按【必填→结构→节奏→表达→内在→扩展→维护】分组编号：先完成必填三项（故事档案 → 模型中心 → QQ 接入），再按需开启共享主剧本与节奏类（运行时/Urge/日程预排/时间导演/行动窗口）；表达（聊天动作/表情包）、内在（记忆/Alter）、扩展与维护项在基础私聊稳定后逐项开启。`blindMode`（盲区模式）首次保持关闭。

6. 发送一条普通消息，确认模型调用、日志和消息投递正常。

`onebot.enabled=true` 时，空的私聊用户白名单表示不允许任何 QQ 进入私聊剧本；保持关闭时，白名单不会参与新的账号过滤。

## 建议测试顺序

1. 先关闭 `runtime.allowProactiveMessages`、Embedding 和网页浏览，只验证私聊回复。确认角色的日常推进稳定后，再开启主动联系和 Agency Window。
2. 在两秒内发送多条短消息，确认它们只产生一次主模型写作回合。
3. 测试延迟回复：用户再次发言后，旧延迟计划应取消并重新判断。
4. 开启 `runtime.autoAdvanceEnabled`，使用 `interlude.advance` 检查自动回合的剧本和消息行为。
5. 等待一次后台空闲整理后使用 `interlude.schedule`，确认主提示词只会投影未来约半天的 Schedule Preplan。
6. 将两个 QQ 加入白名单，确认它们共享主剧本且各自保留关系资料。

## 推荐配置预设

下面是适合第一次测试的推荐值。配置路径使用 Console 中的完整字段名；API Key、QQ 号和 Token 请填写自己的内容，不要照抄示例。

### 1. 模型与提示词

```yaml
model.mainTemperature: 0.7
model.mainTopP: 1
model.mainMaxTokens: 4096
model.mainTimeout: 60000
model.mainResponseFormat: json-object
model.mainStreamingMode: off # 确认服务商支持 SSE JSON 后，才改为 experimental
model.formatPrompt: ''
model.fixedPrompt: ''
model.failover.enabled: true
model.failover.strategy: priority
model.failover.maxAttemptsPerProvider: 2
model.failover.cooldownMinutes: 5
model.embedding.enabled: false
model.vision.enabled: false # 视觉主模型用 native；纯文本主模型可改为 true 并配置 sidecar + useForVision
```

主叙事把 `runtime.contextEntryLimit` 的条目下限与 `contextTimeWindowMinutes` 的时间窗口取并集。默认至少保留 35 条，并额外保护最近 45 分钟的真实用户/角色消息；普通剧本文字仍受固定字符预算约束。更早内容由 continuity、场景摘要和长期事实衔接。


每条模型连接只配置一次；用用途开关决定它服务哪些任务：

```yaml
model.providers[].label: 主叙事模型
model.providers[].enabled: true
model.providers[].endpoint: https://你的服务商/v1/chat/completions
model.providers[].apiKey: 你的 API Key
model.providers[].model: 你的模型名称
model.providers[].useForMain: true
model.providers[].useForCompaction: true
model.providers[].useForAlter: true
model.providers[].useForEmbedding: false
model.providers[].extraHeaders: ''
model.providers[].extraBody: ''
```

无需填写或记忆任何 `providerId`、`modelId`、`mainModelId`。若压缩或 Alter 要用更便宜的模型，新增一行模型连接，只勾选对应用途即可；服务商地址和 API Key 可以直接在该行配置。

主叙事提示词：

```text
model.mainPrompt:
持续创作一部以主角为中心的现实主义生活剧本。让日程、具体行动、身体节奏、兴趣、配角关系、现实压力、外部变化和未完事项共同推动时间，并让每个回合从既有生活中产生新的实际进展。
```

全局文风提示词：

```text
model.stylePrompt:
你正在持续创作一部以主角为中心的当代现实主义生活剧本。

从主角此刻手头正在做的事情继续写。让时间通过具体行动向前移动：拿起或放下的物品、进行到哪一步的任务、身体产生的需要、环境中的变化、临时出现的安排，以及周围人物正在做出的选择。细节应参与行动和因果，使读者能够感到这一段生活确实发生过。

按当前阶段和已经经过的生活连续书写：用户消息、对话后续、到期意图与自动推进各自提供明确事件边界；调度间隔只决定何时唤醒写作，不预设叙事密度。

让主角同时拥有眼前事务、当天安排、个人兴趣、现实压力和未解决的小事。每次选择当前最能自然推进的部分，并让偶然变化从既有处境中生长，例如计划调整、物品带来的麻烦、配角提出的新安排、环境变化或意外发现。

让配角拥有自己的日程、目的、情绪和判断。他们可以主动靠近、打断、误解、邀请、帮忙或改变气氛；他们的行动与主角的选择共同形成生活中的人际流动。

用户消息是当前时刻真实发生的一项外部事件。把它放进主角原本正在继续的生活，写清它遇到的具体处境、引起的注意力变化，以及对行动、情绪、关系或计划产生的实际影响。主角按照当时的精力、关系和现实条件决定看见、回应、延后或保持沉默。

采用贴近主角的第三人称限知视角。叙事保持细腻、克制、连贯，以具体动作、功能性的感官细节、人物来往和情绪余波形成生活感。关系通过反复发生的日常选择缓慢变化，已经发生的内容写得完整，正在进行的事情保留自然的后续空间。

主角的线上聊天保持真人感，表达简洁、自然、带有当时的情绪和注意力。每一条消息承接用户当前表达，并提供新的态度、信息、问题或行动；连续气泡共同组成一个完整而有进展的回应。
```

剧本压缩模型：

```yaml
model.compaction.enabled: true
model.compaction.temperature: 0.3
model.compaction.topP: 1
model.compaction.maxTokens: 2048
model.compaction.timeout: 60000
model.compaction.responseFormat: prompt-only
model.compaction.mainPrompt: 把已完成的剧情整理为简洁、连续的事实脉络，保留时间顺序、行动结果、外部事件影响、具体生活锚点、人物承诺、未解决事项，以及性格和关系的渐进变化。
model.compaction.fixedPrompt: ''
model.compaction.stylePrompt: 按时间顺序陈述事实，表达简洁具体，优先保留对后续行动、关系和场景状态仍有影响的细节。
```

### 2. 故事档案（【必填 1】）

```yaml
storyDefaults.characterName: Minase HDSI
storyDefaults.characterProfile: 18岁的女孩，刚刚高考结束，正准备开始大学生活。平时喜欢熬夜，有点内向，容易胆怯，生活比较丰富，喜欢尝试一些能力范围内没试过的东西，对想干的事情非常有行动力，在线上聊天话很少且发言简洁、有点喜欢吐槽，但对待事情十分认真，心态很平和
storyDefaults.userProfile: 一位普通网友
storyDefaults.relationship: 该用户与主角不经常联系
storyDefaults.world: 现实社会，主角平常生活在中国
storyDefaults.supportingCast: 主角的父母，对主角比较严格，工作早出晚归；主角的一个亲姐姐，大主角3岁；主角的一位好友，名叫希绘（Nozomi），比较外向，比主角小一点，两人非常要好。
storyDefaults.location: 填写主角的主要活动地点
storyDefaults.style: 当代现实主义生活剧。主角拥有丰富、具体且持续变化的个人生活；配角也有各自的节奏、立场与情绪。关系在日常互动和小事件中缓慢发展，生活常常留下未完成但真实感的余波。
storyDefaults.timezone: Asia/Shanghai
```

### 3. OneBot/NapCat 与多人共享剧本

```yaml
onebot.enabled: true
onebot.ignoreSelfMessages: true
onebot.botAccounts[].qq: 机器人 QQ 号
onebot.botAccounts[].enabled: true
onebot.userAccounts[].qq: 允许互动的用户 QQ 号
onebot.userAccounts[].label: 用户备注
onebot.userAccounts[].enabled: true
onebot.userAccounts[].profile: 该用户在主角眼中的身份和背景
onebot.userAccounts[].relationship: 该用户与主角的初始关系

sharedStory.autoEnrollParticipants: true
sharedStory.allowCrossConversationMessages: true
sharedStory.shareParticipantDetails: false
sharedStory.maxCrossConversationActions: 1
sharedStory.participantContextLimit: 6
```

空的 `onebot.userAccounts` 会拒绝所有私聊。每个用户都应单独填写 `profile` 和 `relationship`，不要把所有账号都当作同一个人。

### 4. 私聊、自动推进与主动联系

```yaml
runtime.captureDirectMessages: true
runtime.autoCreate: true
runtime.ignoreCommandMessages: true
runtime.userMessageDebounceSeconds: 2
runtime.forwardMessage.enabled: true # 读取 QQ 合并转发正文；需要时可关闭
runtime.forwardMessage.maxNodes: 30
runtime.forwardMessage.maxCharacters: 8000
runtime.forwardMessage.maxDepth: 3
runtime.cancelDelayedRepliesOnUserMessage: true
runtime.splitReplyMessages: true
runtime.messageSeparator: '<sep/>'
runtime.typingBaseDelaySeconds: 1
runtime.typingCharactersPerSecond: 8
runtime.typingMaxDelaySeconds: 12
runtime.typingJitterRatio: 0.3
runtime.narrativeRetryDelaySeconds: 60
runtime.narrativeRetryMaxAttempts: 6
runtime.contextEntryLimit: 35
runtime.contextTimeWindowMinutes: 45
runtime.memoryLimit: 20

runtime.autoAdvanceEnabled: true
runtime.autoAdvanceIntervalMinutes: 40
runtime.autoAdvanceJitterMinutes: 5
runtime.conversationFollowUpMinutes: [10, 20]

schedulePreplan.enabled: true
schedulePreplan.horizonDays: 14
schedulePreplan.reviewAfterLocalHour: 3
schedulePreplan.anchorAutoAdvance: true
runtime.conversationFollowUpJitterMinutes: 1
runtime.allowProactiveMessages: false
runtime.proactiveWillingnessThreshold: 0.65

agency.enabled: false
agency.maxWindowMinutes: 240
agency.minimumProactiveIntervalMinutes: 60
agency.maxCandidateHours: 24
```

第一次测试建议关闭 `runtime.allowProactiveMessages`。确认剧本、延迟回复和自动推进稳定后再开启。Agency Window 不用随机频率制造联系；它要求生活来源、现实行动条件和意愿门槛，同时保留 60 分钟默认安全间隔防止连续主动打扰。

睡眠或休息时间可以使用：

```yaml
runtime.restWindows[].enabled: true
runtime.restWindows[].label: night sleep
runtime.restWindows[].start: '23:00'
runtime.restWindows[].end: '07:00'
runtime.restWindows[].minIntervalMinutes: 120
runtime.restWindows[].maxIntervalMinutes: 240
```

### 5. 记忆与网页功能

```yaml
memory.enabled: true
memory.sceneEntryThreshold: 16
memory.sceneCharacterThreshold: 10000
memory.factLimit: 20
memory.activeConsequencesEnabled: true
memory.activeConsequencePromptLimit: 6
memory.overlayCompressionEnabled: true
memory.overlayRecentDays: 2
memory.overlayWeeklyWindowDays: 5
memory.overlayMonthlyAfterDays: 10
memory.overlayMonthlyWindowDays: 10

browser.enabled: false
browser.mode: deferred-only
```

实时写作读取受条数和字符预算限制的近期原始剧本，并配合长期事实、场景/剧情弧索引和待处理意图。beta6 不再重复生成实时 continuitySnapshot；局部活动通过原文引用交接，真实通信通过执行结果确认。历史消息标为过去，当前用户事件具有独立来源；实际模型是否误读仍需实机观察。

Embedding 可以在基础功能稳定后再开启。网页观察和 Puppeteer 也建议最后启用，以便区分模型、网络和浏览器问题。

### 6. 日志推荐值

```yaml
logging.level: info
logging.verbosity: standard
logging.format: layered
logging.colors: true
logging.colorTheme: dark # Console 明亮主题改为 light
logging.kaomoji: true
logging.logScriptPreview: false
logging.logMessageContent: false
```

排查模型或计时器问题时，可以临时将 `logging.level` 改为 `debug`、`logging.verbosity` 改为 `diagnostic`；测试完成后建议恢复。深色 Console 选择 `logging.colorTheme=dark`，明亮/白色 Console 选择 `light`。若终端不支持颜色，关闭 `logging.colors`；不喜欢颜文字时关闭 `logging.kaomoji`，系统会自动换成 `←`、`✓`、`→` 等简洁符号。

## 分段与重启时怎样判断消息是否送达

看到 script 或 pending 意图，不代表 QQ 已收到；真正的角色消息需平台投递确认。分段回复未发完时，同一人的到期补写先等打字链；全局手动/自动推进也会等待。新用户消息可以打断剩余气泡。重启恢复已落库 pending 消息时仍尊重分段延迟，不重新让模型写一遍。

承诺回访不再无限每 20 分钟唤醒：到硬截止或达到五次未结算顺延后停止调度。任务 cancelled 不表示角色已对用户履行或解释取消。可用 `interlude.memory.intents` 配合诊断日志检查，不建议为了催发手工改账本状态。

## 常用配置位置

| 配置组 | 用途 |
| --- | --- |
| `storyDefaults` | 新主剧本的 Canon：主角、世界、默认关系和叙事风格。 |
| `model` | 服务商、模型预设、主叙事提示词、压缩模型和 Embedding。 |
| `onebot` | 机器人 QQ、私聊白名单、群聊白名单和群聊资料。 |
| `sharedStory` | 多账号关系分支、跨账号消息和管理员权限。 |
| `runtime` | 消息合并、延迟发送、自动推进、休息时段和失败重试。 |
| `alterSystem` | 情绪偏移累计、动态阈值、权重与侧端分析模型。 |
| `memory` | 剧本压缩、事实召回、剧情余波和设定演化。 |
| `browser` | 可选的 Puppeteer 网页观察。 |
| `logging` | 日志级别、信息密度、显示布局和内容预览。 |

## 常用管理指令

- `interlude.status`：查看当前主剧本状态。
- `interlude.context`：查看运行上下文摘要，包括活动场景、关系状态、Overlay 与长期事实；它不是主模型请求 payload 的逐字段原样输出。
- `interlude.timeline`：查看当前账号相关的近期剧本条目。
- `interlude.memory.intents`：查看延迟回复、提醒、承诺和剧情余波。
- `interlude.pause` / `interlude.resume`：暂停或恢复后台处理。
- `interlude.overlay.status`：查看当前 overlay、待积累提案和压缩快照。
- `interlude.overlay.compact`：只合并/压缩已经应用的 overlay。
- `interlude.overlay.clear character|perspective|relationship|world|all`：清理指定类型的设定演化覆盖层；执行后按提示确认，同时会使相关待积累候选失效。

overlay 不会因为一次聊天就改变人格。普通变化需要多个剧本回合和不同日期的证据；短期影响继续保留在原始剧本、continuity 或剧情余波中，只有稳定变化才会进入长期 overlay。

Alter System 默认开启。它会要求主模型为每个成功剧本返回 `-5..+5` 的本轮氛围净变化；只有累计达到动态阈值时才增加一次侧端模型请求。第一次测试可保留默认参数；如果尚未配置可用的侧端模型，可暂时关闭 `alterSystem.enabled`，不影响主叙事、continuity 和已有剧本。

完整配置说明见 `CONFIGURATION_GUIDE.md`，管理员指令说明见 `command.md`。

