# rc12 Anthropic Messages 适配

版本：`1.0.1-rc12`。随 rc12 打包；本次未安装桌面实例。

## 配置入口

Console → HDSI → 模型提供商 → 自定义 `openai-compatible` 模式：

- `protocol: chat-completions`：原有接口，默认值；现有 YAML 无需修改。
- `protocol: anthropic-messages`：Anthropic Messages；填完整地址（官方可填 `https://api.anthropic.com/v1/messages`，中转填其 Messages 地址）、模型和 API Key。
- `anthropicCache: false`：默认不发送缓存标记，适用于支持范围不明确的中转。
- `anthropicCache: true`：发送 ephemeral 缓存标记，需中转支持。

切换时仅替换标准尾部 `/chat/completions` 和 `/messages`；自定义路径原样保留。不自动试探协议，不更换域名。智谱、DeepSeek 等官方模式沿用现有固定端点；Anthropic 官方使用上述自定义连接方式配置。

默认认证使用 `x-api-key` 和 `anthropic-version: 2023-06-01`；网关需要 Bearer 时可在 extraHeaders 中补充 `Authorization`。额外参数仍经 extraBody 传入，messages/system 和格式字段由适配器控制。

## 与核心功能的关系

| 功能 | 行为 |
|---|---|
| 剧本、群聊、跨群、行动引用、投递回执 | 使用原有 JSON 及提交链路；协议转换不决定发送 |
| legacy / cache-first payload | 两种均支持；JSON 文本内容保持不变 |
| 主叙事／压缩／时间导演／预排／Overlay／Alter | 共用传输适配，后台 JSON 路径覆盖 |
| 主模型图片／侧端识图／贴纸描述 | image_url 转换为 Anthropic base64 或 URL image source |
| 原生音频 | 不静默丢掉音频；明确失败，允许切换到已配置的音频兼容连接 |
| Embedding | 单独配置向量连接；Messages 提供商不进入向量路由 |
| 实验流式首泡 | 使用原有完整 interaction 检查，收到 text delta 才供首泡解析；错误后仍走已有恢复流程 |
| JSON 输出 | prompt-only 语义；保留内部结构化检查/恢复，不把 OpenAI json_object 发给 Messages |

Messages 必须给出 max_tokens；若已有设置为 0/未提供，使用 4096。截断输出不能当完整剧本。使用 temperature（限制至 0–1），不同时发送 top_p；extraBody 开启 Anthropic enabled/adaptive thinking 时省略 temperature。后台不沿用“去掉 max_tokens 再请求”的 OpenAI 恢复策略。

## Cache-first 为什么兼容

cache-first 是 HDSI 的输入编排，缓存命中是服务端行为，两者可以组合，但不是同一个开关。

启用缓存标记时，system 的末块放一个标记；主请求 cache-first 的首个文本块在 `currentSceneEvidence` 之前切成两个块，在历史前缀末端放第二个标记。两块拼回去与原 JSON 逐字一致，消息、场景等动态内容仍全部可见。legacy 不拆 payload，只标记 system。关闭 anthropicCache 则完全不添加标记。

历史前缀会随新剧本、记忆等发生变化，不能保证每轮命中。仍须满足服务端最小缓存长度、有效期和权限。不同模型/端点的拟真度或速度不能由协议名称推定。

输入总 tokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens；输出采用最终累计 output_tokens。SSE message_start/message_delta 合并为一次记录，避免重复累计。现有费用估算将缓存写入按普通输入价计，不含写入加价；真实账单以提供商为准。

## 验证范围

群聊可提取的音频文件/语音会绕过意愿、仅 @ 响应与群冷却，经原有短时合并队列进入主写作。每条音频保留接收时的适配器会话，只加载当前批次；不改变模型决定沉默或发言的权力。白名单、原生音频开关及数量/大小限制仍生效。关闭音频或读取失败会警告，不能据此认为模型已经听取内容。使用 Messages 的主连接时，需要配置支持原生音频的 Chat Completions 故障转移连接。

本地测试覆盖请求字段、认证、两种 payload 内容一致性、图片转换、原生音频错误、缓存开关、路由和历史默认值、主叙事和侧端实际请求构造、后台 JSON 调用、SSE 中文分片与 thinking 隔离、错误/断流/截断、usage 累计、实验首泡及混合协议故障转移。

未调用真实提供商 API；服务端缓存命中率、费用、延迟和真实对话质量待用户端点验收。没有部署或重放消息。

协议依据：

- [Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
