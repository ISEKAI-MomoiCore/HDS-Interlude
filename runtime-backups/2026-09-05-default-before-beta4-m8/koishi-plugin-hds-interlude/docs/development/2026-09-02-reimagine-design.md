# Reimagine 设计文档：beta3→beta5 架构审读 · 拟真路线 · 独立一体化方案

- 日期：2026-09-02
- 作者：ZCode
- 对比对象：`0.1.4-beta3`（基线；源码未存档，基于当次完整审读记录）vs `0.1.5-beta1`（源码全量，12333 行 / 14 模块 / 22 测试文件）
- 关联文档：`docs/development/2026-08-31-payload-cache-first.md`（本会话全部改动的逐条记录）

---

# 第一部分 · beta3 → beta5 架构对比

## 1.1 beta3 基线画像

beta3 时的架构：单体 `service.ts`（5654 行）承载全部调度/投递/压缩/记忆；压缩整体运行在故事串行队列内；视觉仅 native（图片直接进主模型 multimodal）；无 Schedule Preplan、无时间导演、无 Token 计量、payload 为 legacy 顺序；`contextEntryLimit` 20、12k 字符预算；贴纸目录全量注入；记忆结构存在"窗口外即失忆"的夹缝；串行队列无三阶段拆分（当时的死锁风险尚未暴露）。

已知问题清单（当时记录）：`[流汗]` 类标签、健忘夹缝、压缩模型失败风暴、蒙太奇越界叙事、重复注入、主叙事漂移（无主用途勾选时全连接漂移）。

## 1.2 正面提升（按维度分组）

### 正确性 / 健壮性

| 改进 | 位置/机制 | 解决的 beta3 问题 |
| --- | --- | --- |
| 压缩三阶段拆分 | `scheduleCompaction`：Phase1 串行 prepare → Phase2 队列外 LLM → Phase3 串行 apply | 压缩不再阻塞叙事；也消除了后续引入又修复的嵌套 serial 死锁（见事故记录） |
| Schedule Preplan 失败退避 | `schedulePreplanBackoff` 2h | 弱压缩模型省略字段导致的"每轮迷你整理"风暴 |
| 压缩合约首次创建指引 | current=null → outcome=replace | 无记录永远无法建立的死循环 |
| 串行队列死锁排查能力 | phase 字符串判别式 | strictNullChecks 关闭下布尔判别式不收窄的坑 |
| Token 用量与计费日志 | 五类任务全接 `emitUsage` | 完全不可观测 → 每次调用有输入/缓存/命中率/输出/计费 |
| recentProtectionSince 时间窗 | 条数 ∪ 时间窗 | 长剧本把近期消息挤出窗口 |

### 性能 / 成本

| 改进 | 机制 | 实测 |
| --- | --- | --- |
| cache-first payload + 紧凑标签 + recentExchange | 变异频率排序 + 元数据折叠 | 元数据每轮省 ~2-3k tokens；前缀缓存可命中（取决于服务商） |
| 固定合约瘦身 | 删重复/修辞性规则 + refreshContinuity 恒定化 | 非刷新轮 -251 字符、refresh 轮 -445 字符，且系统提示跨轮逐字节一致 |
| 压缩模型调用移出串行队列 | 三阶段 | 消息不再排队等压缩 |
| 贴纸目录语义过滤 top-12 | 描述+别名向量化 | 目录注入从 40 条降到 12 条 |
| 视觉降采样 | Puppeteer 重渲染 ≤1024px | 多模态 token 与上传时间双降 |
| 时间账本投影 | 已完成自动窗口的剧本在后续轮以 host ledger 摘要出现 | 旧自动散文不再整段重复进入上下文 |

### 拟真 / 表达

| 改进 | 机制 |
| --- | --- |
| 记忆三件套 | previousScenes（场景衔接）+ workingDetails（小事暂存，6h 过期）+ semanticHistory（全表向量召回 top-3） |
| Schedule Preplan | 未来约半天日程物化 + 每日模型审查 + candidate 激活概率 |
| 时间导演（Timeline Director） | 自动回合先产出相对时间账本（beats ∈ [0,1]，thought/activity/state，teleport 判非法），主叙事按账本写作；已完成窗口投影为 host ledger |
| UserReportedTime | 从用户消息中提取时间陈述作为权威时间锚 |
| Sidecar 侧端识图 | 独立视觉观察员（useForVision），事实性观察注入文本主叙事，含防注入系统提示 |
| 流式首条回复（experimental） | interaction 先行、script 在后的合约反序 + SSE 增量解析 |
| Token 计费 | 价格可配，缓存节省可视化 |

## 1.3 回复性能可能变差的风险（重点）

| # | 风险 | 证据 | 缓解 |
| --- | --- | --- | --- |
| R1 | **上下文总量膨胀**：50 条窗口 + previousScenes(2×2000) + workingDetails + recalledHistory(3×300) + schedulePreplan 12h 窗口 + 贴纸 top12 + 时间账本投影。实测单轮输入已达 20,647 tokens | Token 用量日志 | cache-first 前缀缓存；对不支持缓存的中转（GPTGOD 实测命中仅 18.6%）每轮实付 |
| R2 | **时间导演是自动回合的硬门槛**：`planTimeline` 失败 → 整个 advance/follow-up/intent-due 回合放弃（service.ts:2849-2852，standard warn"已保留本次时间窗口等待下次重试"） | 代码 | 弱压缩模型（gemini-3-flash 经 GPTGOD）可能永远产不出合法账本 → **自动生活整体停摆、只剩聊天回合**；且每个自动回合多一次 LLM 调用（+延迟+成本）。建议：失败降级为"无账本短窗口推进"而非放弃；或账本调用与压缩共用一次调用 |
| R3 | **每自动回合双倍调用**：planTimeline + 主叙事 | 同上 | 合并进压缩调用（压缩时顺带产出下窗账本） |
| R4 | **主叙事漂移**：无任何连接勾选 useForMain 时主叙事在全连接间漂移（用户实例日志显示主叙事落在 vision 行） | 用户反馈 yml+log | Console 强提示；启动 doctor 检查 |
| R5 | **预设 responseFormat 被全局默认压制**：mainResponseFormat 有 schema 默认 json-object，预设行写 prompt-only 不生效 | 决策链 `mainResponseFormat ?? route…` | 文档写清；或改为预设优先 |
| R6 | **ghost 配置键**：实例 yml 中存在 `groupGate`、`interactionLedgerCharacterBudget`、`contextCharacterBudget`、`recentLifeFact*` 等**插件不存在的键**，被静默忽略——用户以为存在的旋钮实际无效 | 实例 yml | Console 分区描述写明"本分区全部字段"；提供配置导出校验 |
| R7 | Embedding 依赖外部 /embeddings（DMXAPI），失败时语义排序静默降级——历史上该用户 DMXAPI 曾不稳定 | 反馈记录 | 已有降级，可观测性足够 |
| R8 | **三阶段 prepare 仍在串行内做 DB 读**（80×2 条 + facts + participants） | 代码 | 大库时 prepare 几十 ms，可接受；监测即可 |
| R9 | 语义消费者每轮最多 1 次查询向量（已统一），但 `semanticHistory` 开启后**每轮强制一次** Embedding 往返 | 代码 | 可接受；已有统一设计 |
| R10 | 视觉降采样依赖 Puppeteer；不可用时透传原图（token 回升） | 代码 | 文档已写明 |

## 1.4 结论

beta3 → beta5 是一次"从单体到分层"的实质演进：可观测性（Token 计量）、成本结构（cache-first + 瘦身）、记忆结构（三件套）、拟真机制（Preplan/时间导演/Sidecar）全面进步。**最大的新风险集中在"自动回合可用性"上**：时间导演硬门槛 + 双倍调用，把自动生活的可用性绑死在了压缩模型的能力上——这是当前架构最值得优先重估的一点。

---

# 第二部分 · 拟真性提升方向

## 2.1 使用者视角（体验痛点 → 方案）

| 痛点 | 方案 | 依赖 |
| --- | --- | --- |
| 回复长短/节奏随机，有时一句有时轰炸 | 回复节奏参数写进人设 + 合约（已具备 <sep/> 机制）；按 Alter 情绪与时段调制气泡数 | 无新依赖 |
| 角色不主动提起旧事 | RAG 已能检索，缺"主动想起"行为：当 recall 命中高相关旧事时，允许主模型在 natural 时**主动发起**话题（合约已写 passive，可加一条"允许自然提起"的反向开关） | P3 RAG |
| 主动联系内容空泛 | Agency Window + 时间导演账本已有生活素材；把"联系理由"绑定到账本 beat（有据可查的想念） | Preplan |
| 在线状态/时段感 | 沉浸时段内降低回复频率、深夜延长打字延迟（已有 typing 基建） | 无 |
| 跨周连续性 | arc 级"本周回顾"注入（低频、低成本） | 无 |
| 表情/图片表达多样性 | 贴纸语义过滤已贴题；缺"心情→表情包"映射的长期偏好（角色爱用哪几张） | 贴纸库 |

## 2.2 模型训练师视角（把系统当数据引擎）

这个系统每天都在产出**高价值的偏好数据**，这是它区别于普通聊天机器人的最大资产：

1. **偏好对构建**：`interlude_script_entry` + 用户后续反应（继续聊/冷淡/纠正）可以自动构建 (chosen, rejected) 回复对——用于 DPO/CPO 微调一个小型叙事模型。
2. **失败模式自动归类评测集**：本会话遇到的所有失败（时间越界、时间回卷、幻觉消息、复读、摘要污染、蒙太奇）都可以写成**自动判分器**：
   - 时间判定：剧本中出现的所有时刻字符串必须落在 [from, now] 内（正则+解析即可，零 LLM 成本）；
   - 幻觉消息判定：剧本中引用的"来消息"必须存在于 currentEvent/recentScript；
   - 复读判定：与最近 K 条回复的 n-gram 重叠率。
   这三个判分器组成**回归评测集**，换模型/改提示词后一键跑分——用户频繁换模型，这是最需要的基建。
3. **契约遵循度评分卡**：按模型输出结构化字段的成功率/恢复率（Token 日志已有数据）自动给每条模型连接生成"适配度报告"。
4. **蒸馏**：用 glm-5.3/gemini 的高质量输出蒸馏 flash 级模型专做压缩/侧端观察/时间账本——这三个任务的输出都是结构化短文本，最适合蒸馏。
5. **合约最小化实验**：当前合约 ~12.6k 字符；用消融实验找出真正影响合规的最小规则集（训练师视角：把 prompt 当超参优化）。

## 2.3 优先级建议

1. 时间/幻觉/复读三个自动判分器（数据资产 + 回归保障，成本近零）
2. 时间导演失败降级策略（解除自动生活停摆风险，见 R2）
3. 节奏人格化（打字/时段调制）
4. 偏好对数据积累（长期资产，先埋日志不做训练）

---

# 第三部分 · 脱离 Koishi 的独立一体化软件

## 3.1 动机

- Koishi 插件形态受制于宿主：配置系统（Schema）、数据库抽象（minato）、日志、生命周期都借宿主之力，也因此受宿主约束（strictNullChecks 关闭的 tsconfig、Console 渲染、市场分发流程）。
- 目标用户中有相当一部分只需要"一个能装在 Windows/服务器上、开箱即用的对话生活体"，不需要 Koishi 的多插件生态。
- SnowLuma 是自家项目，可以做成**内嵌库**而不是外部 OneBot 进程——这是独立形态的最大红利（省掉跨进程适配、文件路径、端口管理）。
- 同时必须保持 Koishi 插件可用（现有用户与生态）。

## 3.2 设计原则

1. **核心零依赖**：`@hdsi/core` 只依赖标准库与明确声明的小工具（sqlite 驱动、yaml/zod、jimp 可选）。领域逻辑（状态机、合约、payload、预算、召回、压缩编排、投递策略）全部下沉，禁止 import koishi。
2. **宿主是适配器**：Koishi 插件降级为 `@hdsi/host-koishi`——把 minato 数据库、ctx.logger、Schema 配置、Session 事件桥接成核心的四个接口。
3. **接口最小化**：核心只依赖五个端口——`Repository`（持久化）、`Clock`（时间，便于测试）、`Logger`、`ModelClient`（chat/embeddings 的 OpenAI-compatible 客户端）、`Transport`（收发消息）。
4. **配置即数据**：Console Schema 替换为一份声明式字段表（现状的 Schema 描述已经足够结构化，可机械转换），Web Console 按表单渲染。

## 3.3 分层架构

```
┌────────────────────────────────────────────────┐
│ Console (Web)  · 配置表单 / 日志面板 / 剧情时间线 │
├────────────────────────────────────────────────┤
│ Host Adapters                                   │
│  host-koishi · host-standalone(内嵌 SnowLuma)   │
├────────────────────────────────────────────────┤
│ Transport Abstraction                           │
│  Session/消息事件/send/getImage/ptt 转写接口     │
├────────────────────────────────────────────────┤
│ @hdsi/core（零宿主依赖）                         │
│  Service 状态机 · 合约/payload · 时间导演        │
│  压缩编排(三阶段) · 记忆三件套 · 语义召回        │
│  Token 计量 · 投递策略 · 意图账本 · 白名单       │
├────────────────────────────────────────────────┤
│ Ports: Repository · ModelClient · Clock ·       │
│        Logger · Transport                       │
├────────────────────────────────────────────────┤
│ Infra: SQLite(直连) · OpenAI-compatible 客户端   │
│        Puppeteer(可选) · SnowLuma(内嵌/外部)     │
└────────────────────────────────────────────────┘
```

### 关键拆解点（现状 → 目标）

| 现状（耦合点） | 目标 |
| --- | --- |
| `this.dbGet/dbSet` 依赖 koishi database（minato） | `Repository` 端口：get/set/create/count + 少量投影查询；SQLite 直连实现 |
| `ctx.logger` / reportStandalone | `Logger` 端口（保留分层格式渲染，它是纯函数，已可搬运） |
| `ctx.setTimeout/setInterval` | `Clock` 端口（调度器内聚，测试可注入虚拟时钟） |
| `this.ctx.http.post`（模型/embedding/图片抓取） | `ModelClient` + `Fetcher` 端口 |
| Schema（koishi Schema 对象） | 声明式字段表（name/type/default/description/role）→ koishi Schema 与 Web 表单双端生成 |
| `Session`（koishi 会话） | `Transport` 端口的最小事件：private/group 消息、imageSources、quote、messageId、send 接口 |
| `ctx.puppeteer`（降采样/抽帧） | 可选 `ImageService` 端口（Puppeteer 实现或 swc 原生实现） |

## 3.4 SnowLuma 集成设计

两种形态，同一 `Transport` 接口：

1. **内嵌形态（独立软件的默认）**：SnowLuma 以库形态提供 NTQQ 登录与会话——核心直接 import，事件回调直通 `Transport.onMessage`，发送走函数调用。省掉 WebSocket、鉴权、跨机文件路径（表情包 `file://` 直读问题自然消失——同进程同文件系统）。
2. **外部形态（兼容现状）**：SnowLuma 作为独立 OneBot 服务进程，经 ws 反向/正向连接——即现在的 adapter-onebot 路径，K线不变。

需要向 SnowLuma 提出的库接口清单：`login(qid, token)` / `on('private'|'group', handler)` / `sendPrivate/sendGroup(segments)` / `getImage(fileId)` / `fetchPttText(messageId)` / `setMsgEmojiLike` / 生命周期与断线重连事件。文件引用统一返回 `hdsi-file:` 内部 scheme，由宿主决定本地读取或内嵌读取。

## 3.5 Koishi 兼容层

- `@hdsi/host-koishi`：`apply(ctx, config)` 内部 = 构造 koishi 实现的五个端口 → `new HdsiCore(ports)` → 事件桥接。
- Koishi 的 Schema 由字段表自动生成（或维护一份映射），保证市场用户配置体验不变。
- 数据库：Koishi 宿主继续用 minato（表结构已由 registerTables 定义）；独立宿主用 SQLite 直连实现同一 `Repository`。表结构 SQL 与 minato 定义需保持同构（已有单文件 database.ts，是唯一的 schema 权威源）。

## 3.6 迁移路线（三阶段）

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| M1 抽端口 | service.ts 内所有 koishi 触点收敛为五个端口字段；`@hdsi/host-koishi` 注入实现；行为零变化 | 119 测试全绿 + 新增端口单测 |
| M2 独立宿主 | Node CLI 宿主：SQLite 直连 + YAML/JSON 配置 + 简易 Web Console（配置/日志/对话三页）+ SnowLuma 内嵌 Transport | Windows 与 Linux 各跑通一周真实对话 |
| M3 打磨 | 剧情时间线图形视图（时间账本可视化）、多账号、打包安装器（win/desktop/service 三形态） | 与 Koishi 插件并行运行不互相干扰 |

## 3.7 风险与依赖

- minato 查询能力（fields/sort/limit/操作符 $gt）需要在 SQLite 实现中对齐——dbGet 的调用面要审计（目前仅用到有限模式）。
- 模型调用容错（failover/冷却/流式解析）已内聚在 narrator，可整体搬运，但要替换 `ctx.http` 为 fetch 封装。
- Windows 下 NTQQ 内嵌依赖 SnowLuma 的稳定性——保留外部 OneBot 形态作为退路。
- 团队精力：独立宿主的 Console/UI 是最大的隐藏成本，建议 M2 只做最小三页。

---

# 第四部分 · 决策点清单

1. 时间导演硬门槛（R2）：降级推进 vs 维持放弃？建议降级 + 账本调用合并进压缩。
2. 预设 responseFormat 与全局默认的优先级（R5）：预设优先是否更符合直觉？
3. 独立软件形态：Electron 桌面应用 vs Node 服务 + Web？
4. SnowLuma 内嵌接口清单需要与 SnowLuma 侧共同评审。
5. 偏好对数据积累的隐私边界（剧本内容用于训练需用户明示同意）。
