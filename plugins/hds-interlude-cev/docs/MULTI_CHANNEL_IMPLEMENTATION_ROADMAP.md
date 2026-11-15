# 单剧本多通道：M2-M4 实施路线与详细设计

状态：执行计划（2026-09-29 制定）。上位设计：[MULTI_CHANNEL_SINGLE_STORY_DESIGN.md](MULTI_CHANNEL_SINGLE_STORY_DESIGN.md)（v3 实现规格）。
前置已完成：**M1a + M1b 全量落地并通过二轮安全审计修复**（端点注册表/别名重定向/四出站收口/repair 改造 + 陌生账号拒绝挂载/平台隔离键/增量登记/多端点 repair 零改写/findParticipant 注册表化等 11 项，462 测试绿）。§1.1 的端点管理命令族已随审计修复提前交付（`interlude.story.endpoint add/list/disable`）。

## 〇、核心洞察与总原则

**M2 的机制建设不依赖微信。** SnowLuma 上现成的两个 QQ 账号（1303322392 / 1319973221）就是"同一剧本的两个角色端点"的完美实机验证载体——多端点的全部机制（注册/链接/回合合并/跨端点中断/路由）都可以用双 QQ 号端到端验证。微信 POC 通过后，微信接入只剩"注册第三个端点 + channelKind 标签"一件事。

总原则（继承上位设计与 M1 纪律）：

1. 单剧本单人格不变；每一步都以"单平台用户行为逐字节等价"为验收底线
2. 端点注册表是唯一事实源；旧字段只作投影
3. 所有管理操作（注册/链接/回滚）显式、可撤销、带审计
4. 阶段间解耦：每个阶段独立可验证、可发布

## 一、阶段一：M2 机制构建（零外部依赖，可直接开工）

### 1.1 端点管理命令族

```
interlude.story.endpoint list                          列出剧本全部角色端点（在线状态/最后活动）
interlude.story.endpoint add <platform> <selfId>       注册第二个角色端点到既有剧本（写端点行 + 审计条目）
interlude.story.endpoint disable <endpointId>          停用端点（enabled=false，身份与历史保留）
```

设计要点：

- `add` 的前置校验：目标 accountKey 不得已被其他剧本注册（唯一键 `role:<accountKey>` 冲突即拒绝）；通道判别层的 channelKind 默认 qq，带可选 `wechat` 参数预置标签
- `add` 后自动登记别名：`storyIdForCharacter(platform, selfId) → 既有剧本 ID`（M1b 重定向立即生效——第二账号的消息直达既有剧本）
- 审计：每次操作写 `[通道迁移]` 系统条目（复用 removeStoryAlias 的模式）
- 实现落点：service 增加 `addStoryEndpoint/disableStoryEndpoint/listStoryEndpoints`（幂等、冲突拒绝）；index.ts 命令注册；command.md 收录

### 1.2 用户端点链接

```
interlude.participant.link <participantId> <platform> <userId>   把"同一个人的另一个号"链入既有参与者
interlude.participant.unlink <endpointId>                         解除链接（可撤销）
```

设计要点：

- 链接 = 在该参与者名下新增 `participant-user` 端点行（M1a 结构现成）；同一 (accountKey, userId) 已属于其他参与者时拒绝（一个人格一处）
- `sameParticipantEndpoint` 升级：单点比对 → 端点集合匹配（遍历参与者名下 user 端点行；行未加载时回落旧字段比对——单平台等价）
- 入站效果：第二端点的消息经 `resolveInboundEndpoint` 命中既有参与者（不再走"新参与者"路径）
- 审计：链接/解除写剧本条目；`linked` 语义由"同一参与者名下"表达（无独立字段，与 v3 一致）

### 1.3 回合 sources 语义（v3 §七决策表的工程化）

TurnEngine 与 service 的改动：

1. `BufferedNarrativeTurn` 增加 `sources: Array<{ endpointId, receivedSeq }>`（按接收序号有序；endpointId 仅作无序号时的稳定兜底）
2. 入站：`bufferUserNarrative` 经由 service 传入当前解析出的端点与单调递增接收序号（进程内计数器）；同回合第二端点消息追加 source 而非新回合（键仍为 participant.id——v3 §七"合并"决策）
3. 中断：维持参与者级（`signalIncomingInterruption` 不动——跨端点生效是正确语义），但作废的延迟投递按目标端点无关地整批重估（现状已如此，加测试锚）
4. 回复路由：回合投递时取 `sources` 最后一条有效入站的端点（与 latestSession 语义一致，但由 sources 显式化）；单端点回合 sources 长度恒 1——行为等价
5. 验收措辞按 v3 §七原文：**"同一参与者的跨端点消息互相中断；回复路由到最后一条有效入站消息的端点；消息按接收序号入账"**

测试锚：双端点消息合并为单回合（sources 长度 2、顺序正确）；跨端点第二消息作废在途请求；路由端点 = 最后来源；单端点回合 sources=[1] 与现状逐字节一致。

### 1.4 channelKind 判别层（为微信预置）

- 端点行的 channelKind 在 M2 内仍恒为 `qq`；`interlude.story.endpoint add` 的 `wechat` 参数只是把标签写对
- 判别函数 `channelKindForAccount(accountKey)`：查注册表行，未注册默认 qq——onebots 别名路线的唯一判别依据，M2 微信接入时零改动启用

### 1.5 M2 验收清单

| # | 验证项 | 方式 |
|---|---|---|
| 1 | 第二 QQ 号 add 后，其消息直达既有剧本（无平行故事） | 实机 + 单测（findStory 重定向） |
| 2 | 用户端点 link 后，第二端点消息命中既有参与者 | 实机 + 单测 |
| 3 | 双端点消息合并一回合、sources 有序、跨端点中断生效 | 单测（mock 双端点）+ 实机 |
| 4 | 回复路由到最后来源端点；单端点行为不变 | 单测等价锚 |
| 5 | disable 端点后其消息回落"陌生账号"路径（不挂载） | 单测 |
| 6 | 全部操作审计条目可查；链接可撤销 | 单测 |
| 7 | 单平台既有流程 462 测试全绿 | 回归 |

### 1.6 实机验证脚本（双 QQ 号）

用 1303322392 建剧本 → add 1319973221 → 两个号交替发消息 → 核对：同一条时间线、合并/中断/路由行为、审计条目。此流程同时是 M2 的演示脚本。

## 二、阶段二：微信 POC 补完（与阶段一并行，需用户交互）

用户操作（约 10 分钟）：打开 http://127.0.0.1:6727（onebots 网关在跑），设备码 `hdsi-da3d9e329171` 完成配对 → 安装 `@onebots/adapter-wechat-clawbot` → 小号扫码登录 → 开 `protocol-onebot-v11` 正向 WS + token，回报端点。

之后自动执行 [WECHAT_CHANNEL_PLAN.md](WECHAT_CHANNEL_PLAN.md) 的 11 项验收矩阵：

- **决定性第 8 项**（长时间无输入主动投递）：通过 → 路线 A（onebots 别名）可短期用；失败 → 路线 B（原生通道）为唯一长期答案
- 身份四元组全程记录（wechat account_id / onebots 数字 self_id / HDSI 端点 ID / context_token 状态）

**路线 A 下的微信接入**（若第 8 项通过）：`interlude.story.endpoint add onebot <别名selfId> wechat` 注册第三端点——M2 机制直接吃下；局限如实声明（别名映射依赖 /data 备份、context_token 限制主动）。

## 三、阶段三：M3 出站与主动（依赖 M2 完成）

按 v3 §五/§八执行，要点：

- `OutgoingMessageDraft` / transport 引用 / 延迟意图 payload 增加 `endpointId?`（缺省 = 本回合来源端点）
- `ConversationActionDraft`（主动联系）增加 `endpointId?` + **渠道选择决策**（模型可选渠道；缺省解析最近活跃端点；选择进 proactiveContactLog 审计）
- EndpointState 持久化快照（诊断）；`canInitiate=false` 端点跳过并在审计注明
- per-endpoint 限流熔断（qzone 限流门已按 endpointId 分桶的扩展）
- desktop-bridge 透传 endpointId；连接中心按端点呈现在线状态

验收：延迟投递按端点送达；主动联系渠道选择入审计；微信无 token 端点被跳过；单平台路径等价。

## 四、阶段四：M4 叙事增强

- 上下文编译器**确定性标注五规则**上线（端点切换/多端点同批/私群切换/同人异端连续/回复目标≠来源）——投递不依赖标注，漏标后果限质感
- CHANNELS 常设规则行 + 传输指令 `相位 × channelKind` 分叉（只在对应回合相位注入，控 token）
- 跨平台主动联系的自然动机、渠道偏好人格化参数
- 跨平台闭环叙事（QQ 空间说说 ↔ 微信对话互引）

## 五、节点事务

| 事务 | 时机 | 内容 |
|---|---|---|
| cev 仓同步 | M2 完成后 | 镜像 qzone 通道 + M1/M2 全套（约 15 文件 + 测试），跑 423+ 全绿 |
| rc27 打包 | M2 完成后 | 版本链提升 + 一条龙 HTML + tgz 归档（变更面：九项修复+P0/P1+qzone+M1+M2） |
| 说说实机观察 | 随时 | Console 启用【扩展 18】后观察好友动态入账与模型排期 qzone-action（待用户首次开启） |

## 六、风险与依赖

| 风险 | 等级 | 对策 |
|---|---|---|
| M2 回合改动动到 TurnEngine（P0 成果） | 中 | sources 为纯追加字段；单端点等价锚先行；不动 beginFlush/endFlush |
| sameParticipantEndpoint 集合匹配的性能 | 低 | 端点行内存缓存（M1a 已有），匹配 O(端点数) |
| 双号实机验证占用真实 QQ | 低 | 都是小号；验证脚本可重复 |
| 微信 POC 第 8 项失败 | 中 | 路线 B 是既定答案，M2/M3 机制不受影响（原生通道只是第三端点的另一种 platform 值） |
| cev 同步漂移累积 | 中 | M2 后立即同步，避免再造 9 版缺口 |

## 七、评审记录

- 2026-09-29：依据 M1a/M1b 完成态与双 QQ 号洞察制定；阶段一可立即开工，阶段二待用户交互，阶段三四按序。
