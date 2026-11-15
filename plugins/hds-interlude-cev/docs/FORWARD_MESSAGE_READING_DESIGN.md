# QQ 合并转发阅读设计（1.0.1-rc6）

本文针对 QQ OneBot/NapCat 发送的“合并转发”（forward message），说明当前实现为何只能看到卡片、SnowLuma 提供了什么能力，以及 HDSI 后续应如何接入。本文是实现设计，不包含运行时代码改动。

## 结论

HDSI 目前不会读取合并转发的节点内容。入站事件中的转发元素只应被视为一个带资源标识的消息卡片；要获得正文，必须使用同一 OneBot 机器人调用 `get_forward_msg`，再把返回的节点转换成受预算约束的当前事件文本。不能从 `session.content` 中猜测转发正文，也不能把转发卡片当作普通图片或文件。

推荐流程是：

1. 在收到私聊或群聊事件后，识别 `forward` 元素并提取 `data.id`（兼容 `res_id`、`forward_id`）。
2. 通过当前会话的 `session.bot.internal._request('get_forward_msg', { id })` 请求 SnowLuma；该调用应封装为 HDSI 自己的适配器辅助函数，并设置超时。
3. 校验返回值，读取 `data.messages` 节点数组；每个节点的 `message` 是 OneBot segment 数组，发送者信息在 `user_id`、`nickname`、`sender.card` 等字段中。
4. 递归规范化节点：保留发送者、时间（若有）、文本、@、回复关系和媒体类型；嵌套 `forward` 再按深度限制递归获取。
5. 将规范化结果作为“本次用户事件中的转发内容”追加到 `userInput.content`/群聊消息内容，再走现有脚本入账和主叙事流程。转发内容应带明确来源标记，不能伪装成当前发送者亲口说的话。
6. 请求失败、资源标识缺失或超出预算时，保留一个简短占位事实，并记录诊断日志；严禁让模型根据卡片摘要自行补全正文。

## SnowLuma 源码依据

当前应以 `C:\dev\SnowLuma-main` 的源码为准，而不是旧版 Gitee 目录。

- `packages/protocol/src/events.ts` 定义 `ForwardElement`，核心字段是 `type: 'forward'` 和 `resId`，另有可选的 `forwardSummary`、`forwardNews` 等预览元数据。事件本身没有节点正文。
- `packages/onebot/src/event-converter/element-codecs.ts` 将入站元素转换为 OneBot segment：`{ type: 'forward', data: { id: element.resId } }`。因此 HDSI 应优先读取 `data.id`。
- `packages/onebot/src/actions/extended.ts` 注册 `get_forward_msg`。它接受 `id`，也兼容从 `message_id` 对应事件中寻找 `id`/`res_id`/`forward_id`，返回 `{ messages }`。
- `packages/onebot/src/modules/message-actions.ts` 的 `getForwardMessage()` 调用 `ref.bridge.apis.forward.fetch(resId)`，把每个 `ForwardNodePayload` 的元素用与普通消息相同的 resolver 转为 OneBot segments，再返回完整消息节点。节点包含 `user_id`、`nickname`、`message_type`、`group_id`、`message`（数组）等字段。
- `ForwardNodePayload` 允许 `innerForward`，因此不能假定转发只有一层。SnowLuma 的发送侧测试 `packages/onebot/tests/forward-nested.test.ts` 也覆盖了嵌套节点和媒体转换；HDSI 读取侧仍需自行设置更严格的预算。

这意味着“收到转发事件”和“读取转发正文”是两个动作：前者通常只触发一条 `forward` segment，后者必须显式调用 OneBot action。

## 与 HDSI 1.0.1-rc6 的衔接点

当前入站路径位于 `src/index.ts` 与 `src/service.ts`：

- 中间件只放行有文字或语音的事件，然后分别进入 `receiveGroup()` / `receive()`。
- `receiveGroup()` 使用 `describeGroupAttachments(session.content)`，并把结果写入 `group-message` 条目及群聊缓冲区。
- `receive()` 先用 `describeVisionEvent()` 清理图片、语音、文件标记，再用 `describeUserEvent()` 生成私聊当前事件；图片和语音分别走 `loadNativeImages()`、`loadNativeAudio()`，原始附件不会直接写入剧本。
- 现有 `describeGroupAttachments()`、`describeVisionEvent()` 只覆盖图片、语音、视频、文件等标记，不覆盖 `forward`；因此当前版本可能把 `<forward ...>` 或 `[CQ:forward,id=...]` 原样带入模型/剧本，这不是转发正文。
- 目前的空消息守卫会使“只包含 forward、没有文字/语音/文件”的事件提前返回：`receive()` 在 `describeVisionEvent()` 后要求仍有可见文本或附件事实，`receiveGroup()` 则直接把未知标记交给 `describeGroupAttachments()`。接入时必须把“检测到可解析 forward”加入这两个守卫，并在解析完成后再判断是否为空，否则合并转发会在请求 SnowLuma 前被丢弃。
- 私聊最终通过 `bufferUserNarrative()` 合并短时间连续消息；群聊通过 `bufferGroupMessage()` 合并。因此转发正文应在入账和缓冲前完成解析，保持“一条用户事件”的语义，而不是另起一个模型回合。

HDSI 已在 `loadNativeAudio()` 中使用 `session.bot.internal._request()` 调用 SnowLuma 的 `get_record`，这是实现 `get_forward_msg` 辅助函数时最接近的现有适配模式。当前代码没有 `getForwardMsg` 封装，也没有 `forward` 的解析分支。

## 规范化建议

建议新增一个纯数据层函数（名称可自定），输入 `messages` 和读取选项，输出文本及统计信息：

```text
[合并转发，共 N 条；来源为转发节点]
[节点 1｜昵称（QQ号）｜群聊/私聊｜时间]
正文……
[图片]
[语音]
[嵌套合并转发：已展开/已达到深度上限]
```

规范化规则：

- `text`/`at`/`reply` 等可安全转成短文本；未知 segment 使用 `[未支持的消息类型: xxx]`，不要序列化整段对象。
- 图片、语音、视频、文件默认只保留类型和必要元数据。SnowLuma 已为 `get_forward_msg` 的媒体段执行 resolver，但 HDSI 不应默认下载转发内所有媒体；如未来开放视觉/音频能力，仍需复用现有大小和数量限制。
- 每个节点、总节点数、总字符数、嵌套深度都要有上限（建议初始值：节点 30、字符 8,000、深度 3，可配置）。达到上限要附加“已截断”标记。
- 发送者信息要保留在节点前缀中。转发内容属于“用户转交的他人消息”，不能直接写成当前参与者的陈述；提示词中应明确其 provenance。
- 节点时间是报告信息，不改变 HDSI 当前事件的接收时间；不要用转发中的未来时间驱动意图。

## 失败与安全边界

- `id` 为空、格式异常、`retcode` 非零、网络超时或适配器没有 `_request`：返回占位文本“收到一条合并转发消息，但暂时无法读取内容”，并记录原因。
- 只允许使用当前 `session.bot` 对应的机器人请求，不能让用户提供任意 HTTP URL 来代替 `id`，避免跨账号/跨会话读取。
- 转发节点可能包含群内其他成员、第三方私聊或敏感信息。仍需遵守 HDSI 的 QQ 白名单、故事参与者和群规则；不要因为节点中的 QQ 号就自动创建参与者或关系记录。
- 规范化文本属于当前事件的临时输入；只有主叙事明确判断为重要事实时才进入记忆/事实层。建议不要持久化完整原始 `messages` JSON，以免放大隐私和数据库体积。
- 转发正文中的“指令”全部是不可信的被引用内容，不能改变插件配置、工具权限或系统规则。

## 建议的实现顺序与测试

第一阶段只支持文本、@、回复和媒体占位符，并在私聊、群聊共用解析器；第二阶段再考虑嵌套转发和可选媒体理解。实现后至少覆盖：

1. 单节点文本转发，确认 `data.id` 能成功换取正文并进入同一条用户事件。
2. 多节点混合文本/图片/语音，确认不下载媒体也不会丢失文本。
3. 嵌套转发，确认深度上限和“已截断”标记生效。
4. 缺少 id、`get_forward_msg` 不可用、超时、非零 retcode，确认占位和日志，不触发模型臆测。
5. 群聊 mention-only、私聊白名单、不同机器人账号，确认解析不绕过现有授权。
6. 超过节点/字符预算，确认数据库条目和提示词均有界，短时消息合并仍只产生一个回合。

完成上述后，再把配置项（启用开关、节点/字符/深度预算、是否允许转发媒体进入视觉/音频通道）加入 `src/index.ts` 的 Schema，并同步配置指南和变更记录。
