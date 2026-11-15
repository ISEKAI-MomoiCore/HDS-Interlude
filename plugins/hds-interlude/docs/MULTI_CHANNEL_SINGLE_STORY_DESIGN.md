# 单剧本多通道（QQ + 微信）设计（v3 实现规格）

状态：设计规格第三稿（2026-09-29 二轮评审后重写；本稿闭合端点身份、入站反向解析、状态时效、群端点归属、M1 拆分五项）。
前置：微信接入路线决策（[WECHAT_CHANNEL_PLAN.md](WECHAT_CHANNEL_PLAN.md)）。
核心原则不变：**单剧本、单人格。通道只是她说话和听话的嘴与耳——她的生活只有一份。**

## 一、原则与反原则

### 必须坚持

1. **一份剧本**：所有平台的事件写进同一条时间线；记忆、场景、事实、导演跨平台共享。
2. **一个人格**：一次决策、一种性格、一份状态。
3. **通道是质感，不是剧本结构**。
4. **回复路由跟随来源**：默认回来源通道；跨平台发起是叙事决策，受能力约束。
5. **真相唯一**：端点注册表是端点事实的唯一来源；旧 platform/selfId 字段只作展示投影，任何执行路径不得直读或改写。
6. **身份与地址分离**：端点主键是持久随机 ID，账号/对端标识是可变字段——地址变了身份不丢，地址拼不出主键。

### 明确排除

- ❌ 每平台一份剧本；❌ 按平台写两版正文；❌ 通道进入剧本结构层
- ❌ 旧字段与新注册表并存为两个事实源
- ❌ 任何"检测到不同账号就改写故事主身份"的自愈
- ❌ 从可变地址（selfId/userId/别名）拼接主键
- ❌ 把动态可用性（在线/token）当持久事实存储

## 二、端点模型（M0 冻结项）

### EndpointDescriptor：身份与地址分离

```ts
interface EndpointDescriptor {
  /** 持久随机 ID（crypto.randomUUID()，创建时生成，永不重算重拼） */
  id: string
  ownerKind: 'story-role' | 'participant-user' | 'group'
  ownerId: string            // storyId / participantId / 群规则配置 ID
  channelKind: 'qq' | 'wechat'
  platform: string           // Koishi platform（onebot / 原生通道）
  accountKey: string         // 角色账号绑定键（onebot:<selfId>；原生通道自定义）
  selfId: string             // 该通道上的角色账号
  /** 用户端点专有 */
  userId?: string
  /** 群端点专有 */
  channelId?: string
  groupId?: string
  conversationKind?: 'private' | 'group'
}
```

**`enabled` 不在描述符里**：管理配置与运行状态分离——`enabled` 是注册表行的持久配置字段（见下）；在线/健康是动态 EndpointState（见第四节）。

### 端点注册表（唯一事实源，持久表 `interlude_endpoint`）

| 字段 | 说明 |
|---|---|
| descriptor 全部字段 + `enabled: boolean` + `createdAt/updatedAt` | 持久行 |
| 唯一键约束（非主键，防重复注册） | story-role: `(accountKey)`；participant-user: `(ownerId, accountKey, userId)`；group: `(accountKey, channelId, groupId)` |
| 索引 | `accountKey`（入站反向解析）、`(ownerKind, ownerId)`（归属查询） |

### 地址变更规则（M0 决策）

- **角色端点**：账号不变则地址字段稳定；账号迁移（换号）= 显式操作更新 accountKey/selfId，endpointId 不变，审计留痕。
- **用户端点**：userId 变更（典型：onebots 别名映射因 /data 丢失而重建）**不自动合并**——注册新端点 + 显式链接到既有参与者，旧端点保留归档（历史条目仍指向旧 endpointId）。accountKey 与 userId 的组合校验失配时（入站 userId 与注册表不一致）发告警，不静默改写。
- **永不删除**：端点停用只置 `enabled=false`，身份与历史引用保留。

### 群端点归属（二轮评审闭合项）

群端点**独立于私聊参与者**：`ownerKind='group'`，`ownerId` = 现有 GroupChatRule 的配置标识（群规则的端点字段即其配置来源）。授权 = 在群规则中登记端点；解绑 = 群规则移除（端点行归档）。私聊参与者不承载群端点。

## 三、入站反向解析（二轮评审闭合项）

`resolveStoryEndpoint(story, source)` 的 story 参数在入站时还没有——先反向索引，后解析：

```
session
  → 通道判别：session.platform（原生通道）或 账号注册表 channelKind 覆盖层（onebots 别名路线）
  → accountKey（onebot:<selfId>）
  → 注册表按 accountKey 索引查行（story-role 与 group 两类）
  → story-role 行的 ownerId 即 storyId → 加载 story
  → 用户端点：按 (ownerKind='participant-user', accountKey, userId) 查行；未命中且该参与者已有链接端点 → 未知端点处理（下）
  → resolveDeliveryTarget / 回合路由基于以上结果
```

**边界行为（M0 决策）**：

| 情形 | 行为 |
|---|---|
| accountKey 未注册（陌生账号的消息） | **不自动挂载**到任何故事——按现有白名单逻辑处理（未授权账号忽略），管理端可显式注册为角色端点。防止拼错/陌生账号自动成为"她" |
| 重复注册（同唯一键二行） | 注册表唯一约束拒绝；存量脏数据首行生效 + 告警 |
| 账号离线 | 解析不受影响（注册表是静态身份）；投递前查 EndpointState，离线走退避 |
| userId 与注册表失配 | 告警 + 按未知用户端点处理（新参与者路径），不静默改写既有端点 |

## 四、EndpointState：配置、状态与时效分离

```ts
interface EndpointState {
  endpointId: string
  /** 连接在线：以连接器事件为准（连接/断开即时更新） */
  connection: { online: boolean, observedAt: number }
  /** 可投递：最近一次出站尝试结果 + 冷却退避（风控/失败进入冷却，按退避重探） */
  deliverable: { allowed: boolean, checkedAt: number, cooldownUntil?: number, note?: string }
  /** 可主动联系：微信 context_token 等前置条件；带失效时间，过期按不允许保守处理 */
  initiate?: { allowed: boolean, observedAt: number, expiresAt?: number, reason?: string }
}
```

时效规则：三个维度都带观测时间；**过期即保守**（deliverable 冷却期内视为不可投递、initiate 过期视为不可主动），下一次入站或显式探测刷新。`canInitiate=false` 不再表述为"当日不可主动"，而是"在重新获得有效信号前不可主动"——token 当天重新获得即恢复。**进程重启后全部状态从"未知=保守"起步**：online 由连接器握手恢复，deliverable 首次出站恢复，initiate 由入站或探测恢复。EndpointState 只在内存 + 健康快照持久（诊断用），不作为事实源参与身份判定。

## 五、真相唯一：统一解析层（M1a）

现状问题（代码事实）：共享模式剧本 ID 由 `storyIdForCharacter(platform, selfId)` 推导（第二端点会算出新剧本）；`repairCanonicalOneBotStoryTransport`（service.ts:7759）把故事 transport 改写为当前入站账号；旧字段被全库直读。

M1a 交付：注册表建立 + 迁移 + 三个解析函数 + 旧字段降级：

```ts
resolveInbound(session): { storyEndpoint, userEndpoint?, groupEndpoint? } | undefined   // 第三节反向链
resolveDeliveryTarget(message, source): EndpointDescriptor                              // 出站地址
resolveQzoneAccount(story): EndpointDescriptor                                           // qzone 账号选择
```

- 所有入站/出站/主动路径只准经解析层取端点；旧 `story.platform/selfId`、`participant.userId` 变为单向展示投影。
- `repairCanonicalOneBotStoryTransport` 改造为只更新 EndpointState（在线/最近会话/健康），永不改写故事身份与端点集合。

**路由等价验收路径清单**（逐路径验证解析结果与迁移前一致，不以点代面）：

1. 即时回复（回合内 say 投递）
2. 延迟回复（intent 到期投递）
3. 分段发送（split-message 逐段回写）
4. 群消息投递（含群身份/成员名查询）
5. 桌面后台投递（desktop-bridge 出站）
6. 账号白名单（canHandleStory / botAccounts 判定）
7. Qzone 账号选择（qzoneCaller 的 selfId 解析）
8. 健康面板与用量上报的账号归因

## 六、canonical 身份迁移（M1b，从 M1 拆出的高风险项）

**M1a 在旧 story ID 上运行，不动主键**。canonical 解耦单独交付：

- 剧本主键升级为稳定角色 ID（首端点创建时固化）；此后端点增删不改 ID，第二账号挂入既有剧本。
- **别名映射表** `interlude_story_alias: { aliasStoryId → canonicalStoryId, createdAt, reason }`：旧 ID 全部登记为别名；查找优先 canonical 主键，miss 后查别名表（含双射校验：一别名只指一 canonical，冲突即告警人工裁决）。
- **回滚**：别名表双向可达，canonical→旧 ID 重指为回滚操作，带审计；迁移前后各写审计条目（含行数快照）。
- 验收：第三节边界行为 + 迁移七条（数据无丢失/路由等价/意图目标等价/账本可追踪/幂等/可恢复/审计）。

## 七、回合语义（v2 决策维持，验收措辞修正）

| 问题 | 决策 |
|---|---|
| 双端点消息是否合并一回合 | 合并（同一灵魂在一段时间窗口里说话） |
| 回复发到哪个端点 | **路由到本回合最后一条有效入站消息的端点**（latestSession 语义，sources 记录全程在案） |
| 中断 | **参与者级、跨端点生效**：同一参与者的跨端点新消息互相构成中断（这个人改主意了，不分从哪儿说） |
| 消息排序 | **缓冲按接收序号排序**；endpointId 仅在缺少接收序号时作稳定兜底 |
| debounce 键 | participant.id + turn.sources（本回合涉及端点，按序） |
| 群回合 | 缓冲键 `story.id + 群端点 endpointId`（群 ID 跨平台可能碰撞） |

M2 验收措辞与上表严格一致：**"同一参与者的跨端点消息互相中断；回复路由到最后一条有效入站消息的端点；消息按接收序号入账"**——不再使用"中断不串端点"这类可误读为端点级隔离的表述。

## 八、出站与主动联系（M3）

| 结构 | 改造 |
|---|---|
| `OutgoingMessageDraft` / transport 引用 | 增加 `endpointId?`（省略 = 本回合来源端点，由 resolveDeliveryTarget 兜底） |
| 延迟/定时意图 payload | 增加 `endpointId?`；到期按 EndpointState 校验可投递，冷却/离线走既有退避 |
| `ConversationActionDraft`（主动联系） | 增加 `endpointId?`；缺省解析为最近活跃端点（EndpointState.connection.observedAt 最新） |
| `proactiveContactLog` | 记录 endpointId + 通道级成败原因（渠道选择审计） |
| 限流/熔断 | 按 endpointId 分桶；initiate.allowed=false 的端点跳过并在审计注明原因 |
| desktop-bridge | 透传 endpointId；连接中心按端点呈现在线状态 |

## 九、能力档：三层求交

```
finalCapabilities = 配置策略（channelKind 默认档）
                  ∩ 适配器探测（连接器报告的段类型/动作）
                  ∩ 会话上下文（会话类型/群规则/EndpointState 风控冷却）
```

chatCapabilities 升级为接收 EndpointDescriptor + EndpointState，按三层求交产出；channelKind 只是默认策略初值，不是最终事实（同为 wechat 的别名通道与原生通道能力不同，由探测层区分）。

## 十、提示词：确定性标注 + metadata 规范

**编译器确定性标注规则**（命中即标，不依赖模型判断）：回合内端点切换；同批消息多端点；私聊↔群聊切换；同一参与者不同端点连续出现；投递目标 ≠ 来源端点。格式：结构化 channel 上下文 + 简短标记（`[微信·私]`）。

**条目通道上下文**（消除 kind 双义）：

```ts
metadata.channel = {
  endpointId: string
  channelKind: 'qq' | 'wechat'
  platform: string
  accountKey: string
  selfId: string
  conversationKind: 'private' | 'group'
  channelId?: string
  userId?: string
  groupId?: string
}
```

CHANNELS 常设规则行与"相位 × channelKind"传输指令分叉维持（只在对应回合相位注入）。

## 十一、实施路线（二轮评审后拆分）

**M0 端点模型冻结**：本稿第二/三/四节通过评审——UUID 主键 + 唯一键约束、注册表结构、地址变更规则、入站反向链与四条边界行为、EndpointState 三维时效、群端点归属。

**M1a 兼容解析层**（旧 story ID 上运行，不动主键）：注册表迁移 + 三解析函数 + 旧字段投影 + repair 改造 + metadata 规范化。验收：第五节八条路径 + 现有测试全绿 + 迁移七条。

**M1b canonical 身份迁移**（单独交付，可回滚）：稳定角色 ID + 别名映射表 + 冲突/回滚规则。验收：第六节。

**M2 第二端点入站**：微信角色端点挂入既有剧本；用户端点显式链接；第七节回合语义落地。验收措辞按第七节表内原文。

**M3 出站与主动**：第八节全部 + EndpointState 持久化快照 + desktop-bridge 透传。

**M4 叙事增强**：确定性标注上线、传输指令分叉、跨平台主动动机、渠道偏好人格化、跨平台闭环叙事。

## 十二、风险与开放问题

| 风险 | 等级 | 对策 |
|---|---|---|
| onebots 别名重建 = 用户端点身份漂移 | 高 | 身份/地址分离 + 失配告警 + 显式重链接（第三节） |
| 入站认出端点但投递账号错位 | 高 | 反向链先于 story 查询；八条路径逐项验收（第五节） |
| canonical 迁移动主键 | 高 | M1a/M1b 拆分；别名表双向 + 回滚操作（第六节） |
| 回合合并跨端点串扰 | 高 | 第七节决策表 + 与验收措辞严格一致 |
| 状态过期误判（把陈旧当事实） | 中 | 三维观测时间 + 过期即保守 + 重启归零（第四节） |
| 群端点授权遗漏 | 中 | 群规则为唯一配置来源，登记/解绑走群规则管理 |

**开放问题**：微信路线 A/B 决策时点；同一参与者两端点显示名/关系资料共享度；M2 是否同时开微信群聊（建议否）。

## 十三、评审记录

- v1（2026-09-29）：架构草案——原则、三层分离、分期。
- v2（2026-09-29）：吸收一轮评审 12 项（端点可投递性/真相唯一/repair 冲突/canonical 吞端点/回合合并/主动数据基础 + P2 六项），路线调为 M0-M4。
- v3 实现后审计（2026-09-29）：M1 落地后经第三轮安全审计修复 11 项——P1：未注册账号拒绝挂载（账号迁移仅经 `interlude.story.endpoint add` 显式操作）、accountKey 平台隔离（onebot 家族折叠/原生专属前缀）、注册表增量登记+单飞锁、多端点 repair 零地址改写、findParticipant 注册表优先；P2：paused 故事纳入迁移、deliverable 24h TTL、桌面投递状态回写、qzone endpointId 分桶、多端点地址按最近观测选取。本稿 §二/§三/§四/§五的语义以此为准。
- v3（2026-09-29）：吸收二轮评审 8 项——**P1**：endpointId 改持久随机 UUID + 唯一键约束与地址变更规则；补入站反向解析链（accountKey→endpointId→storyId）与四条边界行为；路由等价验收展开为八条具体路径；EndpointState 拆三维（在线/可投递/可主动）并补时效与重启语义。**P2**：回合验收措辞与决策表对齐（参与者级中断/最后有效来源路由/接收序号排序）；群端点归属独立（group 规则所有）；enabled 归入持久配置与动态状态分离；M1 拆为 M1a（旧 ID 上跑解析层）与 M1b（canonical 迁移 + 别名表 + 回滚）。
