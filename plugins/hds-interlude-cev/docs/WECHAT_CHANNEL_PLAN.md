# HDSI 微信接入总体实现方案（v2，2026-09-29）

> v1 的"ID 原样通过 / 基本零改动 / 完整复用主动联系"三处判断经实测核对已修正。
> 本方案定位：**onebots + OneBot v11 是微信文本私聊的快速验证路径，不是 HDSI 微信完整能力的最终架构。**

## 一、事实基线（已核对，方案据此设计）

| 事实 | 影响 |
|---|---|
| onebots 活跃（2026-09-28 仍有更新）；`adapter-wechat-clawbot` 与 `protocol-onebot-v11` 均为 3.0.16 | 渠道可用，但必须锁版本部署 |
| onebots ID 管理：wxid/群号 → 数据库内**随机数字别名**；`self_id`/`user_id`/`group_id`/`message_id` 全部按数字输出 | HDSI 看到的是网关本地别名，不是原始微信 ID；`/data` 必须持久化并备份，映射重建 = 白名单与历史身份全部失效 |
| 微信适配器能力：扫码、文本、图片、视频、文件收发；**语音仅接收**；**回复依赖 context_token**；群消息可投影但**不承诺群聊发送** | 媒体入站可用；语音出站、群聊出站不可假设 |
| 桌面端 5 处数字限制：app.js:611/947、main.ts:895、account-registry.ts:61、onebot-core.ts:141（`Number(selfId)`）、onebot-core.ts:108（`Number(channelId)`） | 数字**别名**可以通过；原始 wxid 不行。放宽远不止一处正则 |
| 桌面端连接器 3 处能力截断：群消息丢弃（onebot-core.ts:41）、非纯文本过滤（:78）、出站仅 `send_private_msg`（:103） | Electron 路径只能按"微信一对一、纯文本、低能力"评估 |
| HDSI 插件侧宽松：`isOneBotPlatform()`、字符串归一化、白名单字符串比较 | **Koishi 直连是插件侧最小改动路径** |

## 二、路线 A：onebots POC（微信文本私聊快速验证）

### 拓扑（Koishi 直连优先，不走 Electron 连接器）

```
微信账号 ←(ClawBot/iLink)→ onebots 网关（Docker，锁 3.0.16 tag，/data 持久化卷）
        ↓ protocol-onebot-v11 正向 WS + token
   Koishi adapter-onebot（selfId = 数字别名）
        ↓
   HDSI 插件（白名单填数字别名，其余零改动）
```

Electron 仅在需要桌面壳统一管理时并列使用：数字别名可过现有校验（零改动），但被截断为私聊纯文本。

### 前置条件

1. Docker 部署，镜像锁定版本 tag（不跟 master）；`/data` 独立卷 + 定期备份（映射丢失 = 身份体系报废）。
2. 小号 + 低频（主动联系日上限压到最低档）。
3. 账号记录四元组，不以 wxid 作 HDSI 主键：`wechat account_id / onebots numeric self_id / HDSI account key / context_token 状态`。

### 验收矩阵（阶段 0，全部通过才考虑扩大）

| # | 验证项 | 判定意义 |
|---|---|---|
| 1 | 扫码登录、掉线重连 | 渠道基本可用性 |
| 2 | `get_login_info` 数字 `self_id` 稳定 | 账号键稳定 |
| 3 | onebots 重启后 ID 映射稳定 | `/data` 持久化有效 |
| 4 | 私聊文本入站 | 最小链路 |
| 5 | HDSI 同步回复 | 出站可用 |
| 6 | 延迟数分钟后回复 | 分段/打字模拟链路 |
| 7 | 网关重启后继续回复 | 状态恢复 |
| **8** | **长时间无用户输入时 HDSI 主动投递** | **context_token 决定性测试** |
| 9 | 图片入站 → HDSI 识图 | 媒体入站（Koishi 路径需实测图片字段/`get_image` 行为） |
| 10 | 群消息/群发消息明确失败方式 | 确认行为而非修复 |
| 11 | token、日志、`/data` 只绑定本机 | 安全边界 |

### 判定门槛

- **#8 失败**（无有效 context_token 时无法主动投递）→ 不再扩大 OneBot 兼容层，直接转路线 B。此限制下 HDSI 的主动联系/urge/自动推进在微信侧形同虚设，只剩被动应答。
- **#8 部分可用**（存在时间窗）→ 兼容层可短期用，但 HDSI 需为微信通道加"主动联系预检+降级"，此投入只在仍选路线 A 时做。
- #2/#3 不稳定 → 无论如何转路线 B（连被动应答的身份稳定性都没有）。

## 三、路线 B：原生微信渠道适配层（长期架构）

### 设计原则

1. **微信不伪装成 QQ**：独立 channel kind，OneBot v11 退回 QQ/NapCat 兼容层定位。
2. **原始字符串 ID 贯穿**：wxid、`xxx@chatroom` 直接作为账号/用户/群标识，不经过数字别名。
3. **context_token 是一等公民**：进入投递管道，携带生命周期，失败可分类。
4. **能力清单驱动**：通道声明能力，HDSI 特性按清单启用/禁用，不按平台名硬编码。

### 架构

```
ClawBot / iLink HTTP API
   ↓
src/wechat/clawbot-client.ts   登录/扫码、收件（轮询或 SSE）、context_token 管理、媒体下载
   ↓
src/wechat/channel.ts          ChannelAdapter 实现：入站→统一事件、出站→投递、能力清单
   ↓
HDSI Service（channel 无关化）/ Story / Outbox
```

### HDSI channel 抽象改造清单

| 改造点 | 现状 | 目标 |
|---|---|---|
| 账号键 | `onebot:<selfId>` | `<channel>:<accountId>`；registry 增加 channel 字段；数字校验仅对 qq channel 生效 |
| 出站投递 | 多处直接 `bot.sendMessage`（platform onebot） | 投递器接口化（per-channel deliverer）；WeChat deliverer 携带 context_token，失败原因枚举（token 失效/频率/风控/内容拒绝） |
| 主动联系 | 假设随时可发 | 发送前检查 context_token 有效性；无效则**叙事化降级**而非硬失败：主动意图转为 urge 待触发，主角"想说但没说出口"，原因入账本 |
| 能力门控 | QQ 特性靠配置开关 | channelKind → capabilities 映射（qq: 表情回应/原生表情/合并转发/群聊；wechat: 文本/图片入/视频入/文件入/语音入、回复需 token、主动受 token 约束） |
| 白名单/群规则 | `OneBotAccountRule.qq` 字符串 | 通用 AccountRule（channel + id），字段更名兼容旧配置 |
| 桌面壳 | 连接中心仅 OneBot/SnowLuma | 增加 WeChat 网关卡片（登录态/二维码/context_token 健康度）；账号绑定 channel 化 |

### context_token 产品级处理（路线 B 核心）

- 入站消息落库时持久化该会话最新 context_token（及过期时间，若上游提供）。
- 出站回复总是携带最新 token；投递失败分类 `context-expired` 单独记账。
- **把平台限制转为叙事能力**：token 失效时，主角的主动消息转为"未送出的信"（intention + 叙事侧记录），用户下次开口时可自然接续——这是微信通道区别于 QQ 的产品形态，而非缺陷遮掩。
- 主动联系引擎预检 token；无 token 时按上表降级，并在健康面板暴露"当前有多少主动消息因 token 受限积压"。

### 分期

- **B0（纯重构，测试锚定）**：channel/投递器接口抽象，QQ 现状迁入接口，行为零变化（与 P0/P1 拆分同方法：现有测试全绿 + 新增接口测试）。
- **B1**：clawbot-client + 文本私聊全链（原始 wxid 身份）。
- **B2**：媒体入站对接现有管道（图片→vision、语音→转写、视频/文件→记录+摘要）。
- **B3**：context_token 全链 + 主动联系降级 + 失败原因账本 + 健康面板。
- **B4**：群聊（仅当上游承诺群发能力）、桌面壳 WeChat 卡片。

## 四、决策树

```
阶段 0 POC（半天–1 天）
 ├─ #8 主动投递通过 + #2/#3 ID 稳定
 │    ├─ 只需要微信文本私聊 → 路线 A 可用作长期形态（低配）
 │    └─ 需要媒体/群聊/稳定身份 → 路线 B（POC 数据仍然有用）
 ├─ #8 失败（token 不支持主动）→ 路线 B 是唯一长期答案
 │    （B 直接对接 iLink，token 生命周期管理比 OneBot 层透传更可控，
 │      但同一平台限制仍在——B3 的叙事化降级因此是必做项而非可选项）
 └─ #2/#3 不稳定 → 路线 B（或换渠道底座）
```

## 五、风险登记表

| 风险 | 等级 | 缓解 |
|---|---:|---|
| context_token 限制主动联系 | 高 | 阶段 0 #8 决定性验证；B3 叙事化降级 |
| OneBot 数字 ID 映射丢失 | 高 | `/data` 持久化卷 + 备份 + 重启稳定性实测（#3） |
| Electron 数字校验/纯文本截断 | 高 | POC 走 Koishi 直连；Electron 仅按文本私聊评估 |
| 微信群发送能力不承诺 | 中高 | 群聊列为 B4，依赖上游承诺后再做 |
| 个人微信自动化风控 | 高 | 小号、低频、独立环境；遵守平台政策 |
| onebots 网关稳定性 | 中 | 锁版本部署，不跟 master；Docker 隔离 |
| Node ≥24 运行环境 | 中 | Docker 镜像自带，不污染本机 |

## 六、立即可执行清单

1. docker-compose：onebots 锁 3.0.16、`/data` 卷、本地端口映射。
2. 小号扫码登录，开 protocol-onebot-v11 正向 WS + token。
3. Koishi 测试实例：adapter-onebot 指向网关，HDSI 白名单填数字别名，跑验收矩阵 1–11。
4. 四元组记录表（含每项时间戳与失败原文）。
5. 结果回填本文件的"POC 结果"章节，按决策树定路线。
