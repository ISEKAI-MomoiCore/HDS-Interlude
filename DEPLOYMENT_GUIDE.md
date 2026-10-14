# HDS Interlude 部署教程

适用版本：`1.0.1-rc52`

当前文档已同步至 2026-10-15 的 rc52，累计变更以 rc50 发布包为基线。发布流程已执行源码构建，rc51 由本次生成的 `lib/` 与 `release/koishi-plugin-hds-interlude-1.0.1-rc52.tgz` 交付；旧安装包不会自动获得这些修改，运行实例须安装并重载后才生效。

> 写给第一次把 HDSI 接到 QQ 上、并希望角色能长期生活下去的人。

（必看）准备工作：

硬件：一台能长时间稳定运行的电脑；普通 i5 级别处理器、8 GB 以上内存和稳定网络通常足够。模型调用依赖网络，自动推进与长对话更需要避免频繁休眠、断网或强制关机。

软件：Koishi Desktop、Node.js（加入 PATH，能使用 `npm`）、最新版电脑 QQ（QQNT 内核）、NapCatQQ。若准备查看数据库，建议安装 VS Code 与 SQLite Viewer 扩展。

准备好以后，现在让我们开始吧！

## 一、安装 Koishi 与 NapCat

Koishi 官网：[https://koishi.chat/](https://koishi.chat/)

一般 Windows 用户在官网选择“用于搭建机器人服务”→“Windows”→ 安装包（`.msi`）。网络不稳定时，也可从 Koishi Desktop 的 GitHub Releases 下载对应安装包：

[https://github.com/koishijs/koishi-desktop/releases](https://github.com/koishijs/koishi-desktop/releases)

接下来下载 NapCatQQ：

[https://github.com/NapNeko/NapCatQQ/releases](https://github.com/NapNeko/NapCatQQ/releases)

Windows 用户在 Assets 中选择 `NapCat.Shell.zip`，解压后按默认方式安装即可。

> **配图位置 1：** Koishi Desktop 下载页中“用于搭建机器人服务 / Windows / 安装包”的选择界面。
>
> **配图位置 2：** NapCat Releases 页面中 `NapCat.Shell.zip` 的位置。

## 二、启动 Koishi，安装必要插件

Koishi 第一次启动会准备运行环境，耐心等待即可。

> **配图位置 3：** Koishi Desktop 的主界面。

进入插件市场，确认下列插件可用：

- `hds-interlude`：HDSI 本体；
- `adapter-onebot`：Koishi 与 NapCat 的连接；
- SQLite 数据库插件：通常由 Desktop 默认安装，确认其已启用；
- `puppeteer`：推荐但非必需。需要网页观察、动态图片代表帧时再启用，默认参数即可。

如果市场加载缓慢，可重试刷新。HDSI 尚未发布到你使用的市场源时，可以安装本地发布包：

```powershell
cd C:\Users\你的用户名\AppData\Roaming\Koishi\Desktop\data\instances\default
node .yarn/releases/yarn-4.5.3.cjs add "koishi-plugin-hds-interlude@file:C:/路径/koishi-plugin-hds-interlude-1.0.1-rc52.tgz" --exact
```

安装完成后回到 Koishi Console，添加或启用 `hds-interlude`。

每次完成重要配置，都要点击右上角的“保存配置”或“重载配置”。

## 三、配置 NapCat，并连接 OneBot Adapter

运行 NapCat 目录中的 launcher 批处理文件。出现二维码后，用手机 QQ 扫码登录你准备作为机器人的 QQ 账号。

登录成功后，在浏览器进入 NapCat WebUI：

```text
http://127.0.0.1:6099/webui/
```

默认密码请以 NapCat 当前界面提示为准；登录后建议立刻修改。

> **配图位置 4：** NapCat WebUI 首页。

进入“网络配置”，新建 WebSocket 服务器。监听地址、端口与 Token 需要和 Koishi 的 OneBot Adapter 完全一致。Token 可以自行设置，但请妥善保存，不要发到聊天记录、截图或公开配置中。

> **配图位置 5：** NapCat 的“新建 WebSocket 服务器”配置页面；图中应标出地址、端口、Token 三处。

回到 Koishi 的 `adapter-onebot` 配置：

- `selfId` 填机器人 QQ 号；
- WebSocket 地址填刚才创建的服务器地址；
- Token 与 NapCat 中保持一致；
- 保存并启动插件。

日志出现连接成功提示、Koishi 右下角状态变绿后，QQ 与 Koishi 的通信就正常了。

> **配图位置 6：** OneBot Adapter 的配置页面。
>
> **配图位置 7：** Koishi 右下角绿色连接状态或成功日志。

## 四、配置 HDSI 的模型中心

进入 `hds-interlude` 插件配置。HDSI 的模型配置只需要记住一件事：**一行模型连接，就是一个实际可调用的模型；在这一行勾选它承担什么用途。**

在 `model.providers` 添加模型连接。至少需要一条 `enabled=true`、连接信息完整且勾选 `useForMain` 的可用模型行，HDSI 才会启用远程主叙事；只勾选视觉、Embedding、表情包或世界播种用途的连接不会承担主叙事。无需再设置全局模型模式。

### 普通 OpenAI-compatible 提供商

该行的 `mode` 选择 `openai-compatible`。保存并重载后，填写：

- 显示名称；
- Endpoint；
- API Key；
- 实际模型名；
- 主叙事 / 压缩 / Alter / Embedding / 表情包描述用途开关；如果模型是 DeepSeek V4 等支持思考参数的兼容端点，可将 `deepseekThinking` 设为 `disabled`，避免服务端默认开启隐藏思考。

例如，一个只负责主叙事的模型就只勾选“用作主叙事模型”。一个低成本模型可以只勾选“用作后台压缩模型”。Embedding 模型必须确实支持 `/embeddings`，不要把普通聊天模型误勾为 Embedding。

常用官方模式还包括 `openai-official`、`deepseek-official`、`moonshot-official`、`dashscope-official`、`siliconflow-official`、`openrouter`、`gemini-openai` 与推荐的 `gemini-interactions`。每一种在提供商行选中后都会固定其 endpoint；DeepSeek 额外提供思考开关与强度，百炼会显示地域选项。它们可以和智谱、普通中转站行同时存在。`gemini-interactions` 使用 Gemini Interactions API，不是 Chat Completions。

### DeepSeek 官方提供商

选择 `deepseek-official` 并保存重载后，填写 API Key 和模型名。默认关闭思考模式，适合需要快速、稳定结构化输出的主叙事、压缩和 Alter；开启后可选择 `low`、`high` 或 `max` 推理强度。遇到空回复、字段缺失或反复恢复重写时，先关闭思考，或把主叙事输出格式改为 `prompt-only` 后再测试。

### 智谱官方 GLM 提供商

如果使用智谱官方 API，在该行的 `mode` 选择 `zhipu-official`，保存并重载。该行会只显示：

- 智谱 API Key；
- 模型名，例如 `glm-5.3-flash`；
- 推理强度：`low`、`high` 或 `max`。

智谱官方 endpoint 会自动填写，不能与同一行的普通 endpoint 混用。GLM‑5.3‑Flash 会走 SSE 流式接收：首个可见文本最长等待 45 秒，收到首字后不设置总等待上限。默认仍在完整 JSON 解析成功后才向 QQ 投递，保证剧本与消息记录一致。

如需试验更快的私聊首泡，在确认模型支持 JSON 对象和 SSE 后，将 `model.mainStreamingMode` 改为 `experimental`。它会先等待完整的 `interaction.reply` 字段，再发送首条消息并继续接收剧本；群聊不使用提前投递。首条已发而流式收尾失败时，只会补写剧本，不会重发第二条消息。未知中转站先保持 `off`，避免流式协议不兼容。

视觉模型才开启 `model.vision.enabled`。普通文本模型保持关闭；使用 GLM‑5.3‑Flash 时可在确认官方模式可用后再测试图片。

> **配图位置 8：** HDSI 模型中心全貌：提供商行中的 `mode` 下拉，以及四个用途开关。
>
> **配图位置 9：** 同一提供商行切换为 `zhipu-official` 后，只显示 API Key、模型名、推理强度的界面。

主叙事下方的温度、top-p、最大输出、超时和 JSON / prompt 输出格式，只影响主叙事。压缩、Alter、Embedding 在各自区域拥有独立的任务参数；模型本身已经在上方的用途开关决定，不需要再填写任何 `providerId`、`modelId` 或 `mainModelId`。

首次测试建议：

- 只启用一条主叙事模型；
- 关闭 `model.vision.enabled`、Embedding 与主动消息；
- `mainResponseFormat` 选择 `json-object`；
- 先确认一次普通私聊能正常完成。

Schedule Preplan 默认开启并复用压缩模型，不需要再配置一条模型连接。它会在后台空闲时维护未来 14 天的计划结构，但主叙事只读取未来约 12 小时。第一次后台整理完成后，可发送 `interlude.schedule` 检查结果；固定课程或开学日期必须来自角色设定或真实剧本证据。

## 五、创建角色与 QQ 白名单

HDSI 的人设不放在某个隐藏的 Markdown 文件夹，而是直接写进 Console 的故事档案。

进入 `storyDefaults`，填写：

- 主角名称；
- 角色资料：身份、习惯、作息、语言与现实边界；
- Perspective：主角看待人和世界的稳定方式；
- 默认用户资料与初始关系；
- 世界、地点、重要配角、叙事风格与时区。

然后进入 `onebot`：

- 在 `botAccounts` 填机器人 QQ；
- 在 `userAccounts` 填允许私聊测试的 QQ；
- 为每位用户填写主角对其的称呼、资料与初始关系；
- 第一次部署建议只放一位测试用户。

> **配图位置 10：** `storyDefaults` 的角色、人设、Perspective、世界和时区区域。
>
> **配图位置 11：** `onebot.botAccounts` 与 `onebot.userAccounts` 白名单表。

首次部署保持 `blindMode.enabled=false`。失明模式会屏蔽命令与 HDSI 详细日志，适合模型、账号和故事档案完全稳定之后再开启。

保存配置后，在已授权的私聊中执行：

```text
interlude.doctor
interlude.story.start
```

`interlude.doctor` 会检查模型、白名单、时区和故事档案；`interlude.story.start` 会确认创建第一份主剧本。

## 六、第一次对话与自动生活

先发一条普通 QQ 消息。正常情况下，你会看到：收到用户消息、模型调用、剧本写入、角色消息投递。

确认普通私聊稳定后，再逐项开启：

1. 自动推进与对话后续；
2. Alter System；
3. Agency Window 与主动联系；
4. Embedding、网页观察、群聊与视觉能力；
5. 最后才考虑失明模式。

HDSI 的角色不需要手工维护一堆提示词文件。角色的 Canon、Perspective、世界、关系和文风都在 Console；长期发生的剧情会由剧本、场景摘要、事实、Overlay 与意图共同保存。

> **配图位置 12：** 一次成功私聊的 HDSI 分层日志：收到消息 → 模型调用 → 完成 → 消息投递。

## 七、数据库、备份与调试

HDSI 的故事数据保存在：

```text
C:\Users\你的用户名\AppData\Roaming\Koishi\Desktop\data\instances\default\data\koishi.db
```

它包含 HDSI 的故事、参与者、剧本条目、长期事实、意图、场景、Overlay 等表。使用 VS Code 的 SQLite Viewer 可以只读查看和排查问题。

但请注意：

- 先关闭 Koishi 或复制数据库备份，再进行任何人工修改；
- 不建议直接删除或篡改表记录，优先使用 `interlude.overlay.clear`、`interlude.memory.add`、`interlude.memory.forget` 等管理指令；
- 数据库保存的是 HDSI 的剧本与状态，不等于模型的原始隐藏推理过程；
- API Key、NapCat Token、日志和数据库都不要公开。

## 八、常见问题

### 模型一直请求中、超时或 429

先确认只有正确的聊天模型勾选了“用作主叙事模型”。Embedding 模型不要参加主叙事用途。GLM‑5.3‑Flash 建议使用提供商行的 `zhipu-official` 模式；它会使用官方 endpoint 与流式首字超时策略。

### 图片一发就 Bad Request

确认当前主叙事模型支持视觉，再开启 `model.vision.enabled`。普通文本模型必须关闭视觉。智谱官方模式会使用兼容的 `image_url.url` 字段；普通 OpenAI-compatible 网关是否支持图片，仍取决于该网关和模型。

### 看不到机器人回复

依次检查：NapCat 是否在线、OneBot Adapter 是否连接、机器人 QQ 是否在 `botAccounts`、你的 QQ 是否在 `userAccounts`、`blindMode` 是否关闭，以及模型连接是否勾选了“用作主叙事模型”。

### 分段回复重复、补写不停或重启后 pending

此轮工作区修复让同一参与者的后台补写等待 pending 气泡，全局推进等待任意链；承诺回访有硬截止及五次未结算顺延上限。源剧本 pending 消息可经启动、端点上线或周期扫描补偿，有 split-message 时仍由原打字队列负责。这些修复已纳入本次构建的 rc51；旧包不会自动变化，安装 rc51 并重载后生效。

排查时临时开启 diagnostic/debug，核对 commitId、eventId、scriptEntryId、分段 index、意图状态与账本；不同 commit 的相同文本属于跨回合重复生成，不等同同一 segment 重投。不要把 done/completed 调度任务或剧本中的“发了消息”当作平台回执。分段等待、承诺退役和待投递补偿扫描均有独立诊断。平台已接受但回执丢失仍不能承诺零重复。

### 传输在线但 HDSI 端点 offline

当前源码识别数字 ONLINE，并在启动时同步现有 bot 和后续连接事件；通常不再需要手动发消息唤醒在线状态。但端点禁用、证据过期、冷却或渠道主动联系许可仍会阻止投递。分别核对平台、自身账号、端点注册及门控原因，不能仅凭 LAB 传输在线认定全部行动可用。

### 历史群聊图片跳过，但模型确实支持图片

先区分 `historical-image-fetch`（历史 URL/文件回源失败）、`current-image-fetch`（当前图片回源失败）和 `narrative-provider`（已组装请求的服务端失败）。模型能识图不保证旧图片地址仍有效；HTTP bad request 也不一定来自模型端。保留带阶段、来源和状态的日志再定位，不要仅凭“已跳过”直接更换模型。

### DeepSeek 兼容端点响应很慢

若端点明确支持 DeepSeek thinking 参数，在对应 openai-compatible 提供商行设置 `deepseekThinking=disabled`；默认 inherit 不发送覆盖字段，官方 DeepSeek 默认 disabled。显式设置优先于 extraBody，关闭时清除残留 reasoning_effort；不支持该字段的通用模型保持 inherit。具体耗时仍取决于服务商，不保证 issue 中的速度提升。

### 重载后无法用指令

先确认 `blindMode.enabled=false`。失明模式开启时，HDSI 管理指令与当前 Koishi 实例中已识别的命令都会被静默屏蔽。

夜深了。确认一切正常后，去和她/他聊第一句话吧；从那一刻起，HDSI 的故事才真正开始。

---

HDS Interlude 部署教程，基于 HDSI 当前 Console 与 OneBot/NapCat 流程整理。需要更新截图时，优先替换文中标注的十二个“配图位置”。

