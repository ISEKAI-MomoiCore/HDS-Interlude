# 入站路径平台假设清单（多通道适配分歧点盘点）

文档性质：P8-S5 的附加交付物。盘点入站路径（inbound-gate.ts 及其直接依赖）中 **QQ/OneBot 特有的行为假设**，作为 Telegram / 微信通道适配层设计的直接输入。每条标注：位置、假设内容、TG 侧的差异、适配分叉建议。

盘点方法：S5 搬迁将 receive/receiveGroup 的全部依赖显式化为宿主引用与具名导入，本清单即从该显式面逐项核对得出（2026-10-29 工作区）。

## 1. 身份与寻址

| # | 假设 | 位置 | TG 差异 | 适配建议 |
| --- | --- | --- | --- | --- |
| 1.1 | 去重键 = `platform:selfId:userId:channelId?:messageId` | inbound-gate 两条入口 | TG messageId 全局唯一且永不复用；QQ 每通道独立 | 键结构通道无关（含 platform），可直接复用；确认 TG update_id 语义后映射为 messageId |
| 1.2 | `isOneBotPlatform()` 平台族折叠（onebot/onebotv11…） | 散布（端点/投递/入口） | TG 是独立平台族 | 已按平台族隔离（accountKey 前缀），TG 新增专属前缀 `telegram:<botId>`；**不建议**把 TG 折进任何现有族判定 |
| 1.3 | 私聊频道 id 需 `private:` 前缀防 OneBot 裸数字误判为群 | session-platform `privateDeliveryChannelId` | TG chat id 正/负数天然区分私聊/群/频道 | 端点注册表已支持 `channelKind`；投递路由按 channelKind 分支，不做平台字符串特判 |
| 1.4 | 群号归一化（`group:`/`guild:`/裸数字等价） | session-platform `normalizeGroupId` | TG 群 id 为负数、无前缀习惯 | 归一化函数按通道族分派或留通道原值（注册表以 accountKey+channelId 寻址，不依赖归一化形状） |
| 1.5 | 群成员名解析经 `bot.getGuildMember`（OneBot API） | inbound-gate `lookupGroupMemberName` | TG 用 getChatMember；且 author 名随消息携带（现已有 session.author 回退路径） | 名字解析改为通道能力接口：消息内名字 → 通道 API 查询 → userId 兜底；TG 大概率走第一档 |

## 2. 消息语义

| # | 假设 | 位置 | TG 差异 | 适配建议 |
| --- | --- | --- | --- | --- |
| 2.1 | mention 判定 = CQ 码 `@qq` / at 段 | chat-artifacts `mentionsBot` | TG 是 `@username` 文本实体或 text_mention | mention 判定按通道族分派；意愿门/mention-only 模式消费的是布尔结果，分派点收敛在判定函数内 |
| 2.2 | 引用消息结构（reply 消息）→ quote 投影 | chat-artifacts `describeQuotedMessage` | TG reply_to_message 结构不同 | 各通道实现"引用 → QuotedMessageContext"投影，入站管线消费统一投影 |
| 2.3 | 合并转发读取（QQ 特性，节点树+预算） | media-loading `readForward` + forward-message.ts | TG 无合并转发（album/forward 有各自语义） | readForward 对 TG 返回 undefined 即可；TG 的 media group 需要另行评估是否映射"多图消息" |
| 2.4 | 群附件投影（CQ 码文本化） | session-platform `describeGroupAttachments` | TG 实体（entity）模型不同 | 同 2.2：通道侧投影为统一 content 文本 |
| 2.5 | 表情语义映射（QQ 原生表情 face id → 语义名） | qq-face.ts | TG 无对应物（有 emoji/贴纸，语义不同） | 能力投影（ChatActionCapabilities）已按通道返回——nativeFace 对 TG 返回不可用即可 |

## 3. 媒体管道

| # | 假设 | 位置 | TG 差异 | 适配建议 |
| --- | --- | --- | --- | --- |
| 3.1 | 图片信任域白名单（QQ CDN 域名，防内网代理） | media-loading `isTrustedImageHost` | TG 文件经 Bot API getFile（自有管道，非公网 URL） | 信任域判定按通道族分派：TG 走官方文件管道=天然可信；白名单机制保留给"公网 URL 直取"型通道 |
| 3.2 | 语音 = SILK，需 SnowLuma 服务端转码 | media-loading `fetchNativeAudio` | TG 语音 = ogg/opus（模型可直接读或轻转码） | 音频获取/转码按通道分派；转码格式要求（mp3 等）是模型侧约束，通道侧只需产出该格式 |
| 3.3 | 图片获取经 OneBot `url`/`file` 两种形态 + 重定向穿透 | media-loading `fetchNativeImage*` | TG file_id → getFile → 下载 | 同上：取源器按通道实现统一出 `{mime, dataUri}` |
| 3.4 | 表情包采集（QQ 表情图片暂存判定） | sticker-library | TG 贴纸是文档型概念，采集语义不同 | 采集是锁外旁路、可选功能——TG 首期直接关闭，不影响主链 |

## 4. 平台行为面（门控与速率语义）

| # | 假设 | 位置 | TG 差异 | 适配建议 |
| --- | --- | --- | --- | --- |
| 4.1 | 端点在线判定 = Koishi/Satori ONLINE + 兼容字符串 | service `isBotOnlineStatus`（现 session-platform） | TG 长轮询连接模型不同，但 Koishi adapter 统一了状态位 | 走 Koishi 适配器状态即可；HDSI 不自判连接 |
| 4.2 | 主动联系频控/风控冷却假设（QQ 风控语境） | 投递门控 | TG 有自己的频控（30 msg/s 全局、1 msg/s 同聊天） | 端点冷却机制通道无关（数值可配）；TG 专属限流放通道适配层或网关侧，不进 HDSI 主链 |
| 4.3 | QQ 空间通道（qzone-action 意图族） | qzone-executor | 无对应 | 平台动作能力已按 capabilities 投影；TG 的渠道动作（如 channel post）未来走同一意图族框架 |

## 5. 通道无关的既有多通道基建（勿重复建设）

以下已就绪且通道无关，TG 适配**直接使用**：端点注册表（UUID 身份/accountKey 平台隔离/三维状态时效，M1）；入站反向解析链（resolveInboundEndpoint）；剧本别名与回滚（M1b）；投递路由三级（session→桥→bot）与账本；意愿门/密度/打断标记等入口时序契约（S5 特征测试已钉死）；通道上下文标注（channelContextMetadata 五规则）。

## 6. 对 TG 适配层设计的直接建议

1. **Koishi adapter 先行**：TG 接入的传输层应优先评估现成 Koishi telegram 适配器，HDSI 侧只做上面表格里的分派点，不自己写 Bot API 客户端。
2. **分派点收敛原则**：本清单的每个"按通道族分派"点，落成一个显式接口（如 mention 判定、取图器、取音器、引用投影），注册表模式与 ResearchToolRegistry 同构——避免 if (platform === 'telegram') 散布。
3. **首期收窄**：对照微信 POC 的"文本私聊"先例，TG 首期建议收窄为"文本私聊 + 端点注册"，媒体/群聊/能力投影二期。群聊在 TG 语境（超大群/频道/bot 权限模型）差异最大，放最后。
4. **本清单的维护**：后续任何入站路径的平台特判新增，应同步登记到本表（它随 inbound-gate.ts 的显式依赖面自然可审计）。
