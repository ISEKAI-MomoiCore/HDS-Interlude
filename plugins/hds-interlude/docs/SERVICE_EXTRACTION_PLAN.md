# service.ts 拆分顺序设计

文档性质：行为不变的代码组织重构计划。**状态：已全部完成并关闭（2026-10-29，P0–P8 含 S5；收官记录见 §10）**。全程不修改任何功能实现、提示词、日志文案与数据形态；每个切片以"typecheck 零错误 + 全量测试全绿"为硬门槛。

基线：`1.0.1-rc59` 工作区（2026-10-29）。strict 分批启用已完成两批——第一批四项低噪开关零报错直开；第二批 `noImplicitAny` 的 57 处已全部补类型标注（详见 [ARCHITECTURE.md](ARCHITECTURE.md) 与本文 §8）。本文行号为当前工作区快照参考，实施时以符号名为准。

前置结论：本计划延续 P0（turn-engine）/ P1（scheduler）已验证的拆分路径，把 ARCHITECTURE.md 模块职责表中"仍在本文件"的编排职责分批迁出。[V2 实施表](V2_IN_PLACE_REFACTOR_IMPLEMENTATION_FORM.md) 末段"再评估……服务文件拆分"即指此项工作。

## 1. 目标与非目标

**目标**

1. 把行号段式的"民俗边界"变成编译器强制的依赖边界：被拆模块看不到的状态就真的碰不到。
2. 爆炸半径隔离：改投递只碰 `delivery/`，改别的模块碰不到投递的执行器与幂等缓存。
3. 让核心子系统可以脱离 `InterludeService` 单测（假 transport + 内存账本），把"事后回归测试"变成"事前确定性用例"。
4. 让投递 outbox、分段回执终态、锁相位等不变量在各自模块顶部有明确契约位置。
5. 为多通道路线图（[MULTI_CHANNEL](MULTI_CHANNEL_IMPLEMENTATION_ROADMAP.md)）与 strict 第三批（strictNullChecks）按模块推进铺轨道。

**非目标**

- 不重写任何逻辑、不顺手优化、不在搬家 commit 里改任何可观察行为。
- 不追求 service.ts 归零：终态它仍是组合根 + 私聊/群聊叙事核心（见 §5 收尾态）。
- 不引入依赖注入框架；沿用 Cordis 既有风格（普通类 + 构造注入 + service 委托）。
- 不做多进程/并发模型改造；`serial()` 锁相位纪律原样保留。

## 2. 现状分区地图

service.ts 共 14091 行、427 个 private 成员。分区与测试网（快照）：

| 行号段 | 职责 | `this` 依赖密度 | 对应测试（部分） |
| --- | --- | --- | --- |
| 783–1107 | 类字段/构造/startBackgroundTasks | —（组合根本体） | configuration |
| 1190–1385 | recoverPendingDeliveries 投递补偿 | 中（serial/db/账本） | rc10-delivery、desktop-outcome-semantics |
| 1386–1650 | Provider 注入 + 桌面桥快照/暂停 | 中 | desktop-bridge、service-desktop-correlation |
| 1646–2530 | 会话路由/故事/参与者管理 | 高 | story-alias、participantless-interaction |
| 2532–3548 | 入站接收（私聊+群聊+群缓冲） | 高（与叙事核心咬合） | group-* 全族、voice-transcription、forward-message |
| 3549–4620 | 私聊缓冲、媒体加载、历史向量 | 高 | sidecar-vision、sticker-vision-helpers |
| 4566–4878 | flushBufferedNarrative 回合冲刷 | 高（叙事核心） | supersede-repro、continuation-repair |
| 4880–5019 | advanceStory / sweep / offlineGroupCatchup | 高 | review-runtime-regressions |
| 5020–6500 | advanceUnlocked / decide / tryDecide / persistDecision | 高（叙事核心，留守） | narrative-prompts、payload-order、issue-15 |
| 6502–7150 | 意图簿记与考据接线 | 中 | split-follow-up-scheduling、issue-3 |
| 7151–7547 | Console 面板 API + 意图到期/唤醒 | 中 | console-config、follow-up-commitment |
| 7548–7760 | wakeDueIntents / deliverDueSplitSegments / 跟进 | 中（与调度咬合） | typing-floor、conversation-interruption |
| 7979–8740 | 投递层（编排/传输/打字延迟/回执） | **低（实测约 12 个成员）** | delivery-ledger、delivery-boundary、review-delivery-regressions |
| 8749–9290 | 自动推进节奏/参与者状态/连续性 | 中 | urge、life-rhythm |
| 9296–9390 | scheduleCompaction 三阶段调度 | 中 | compaction-input-contract |
| 9385–9697 | QQ 空间执行器（限流/动作/轮询） | **低（qzone.ts 已有纯策略）** | qzone |
| 9698–10290 | 端点注册表接线（reconcile/门控/链接） | **低（endpoints.ts 已有纯策略）** | endpoints、m1-audit、endpoint-expiry-recovery |
| 10292–10333 | stop / weatherSweep | 低 | weather |
| 10332–11105 | 世界播种/长线/Preplan 后台接线 | 低（各有纯模块） | world-seeder、long-arc、schedule-preplan |
| 11105–11800 | 压缩执行（prepare/persist/facts/patch） | 中 | continuity-checkpoint、story-state-codec |
| 11805–12160 | 日志/getStory/serial/DB 写封装 | —（基础设施，留守，见 §5 决策点） | review-sqlite-regressions |
| 12160–14091 | **约 40 个导出纯函数**（normalizeDecision、splitVisibleReplyBubbles、extractSession* 等） | **零（无 this）** | 60 个测试文件直接导入 |

两个关键事实决定了顺序：

- **尾部纯函数区（≈1930 行）零 `this` 依赖**，且测试直接按名导入——是风险最低的起步对象。
- **投递层是编排区中耦合面最窄的**（入口段实测仅触碰 acceptedDeliveries、deliveryExecutors、deliveryGeneration、deliveryExecutionKey、deliveryLedgerConfirmed、confirmOutgoingDeliveries、successfulDeliveryEntry、dbGet、taskGeneration、databaseResetting 十余项），同时是不变量密度最高、测试网最密的区。

## 3. 拆分配方（自 P0/P1 继承，全程复用）

1. **两步走：先搬后改线。** 第一个 commit 只做代码搬家，service.ts 保留同名薄委托（或 re-export 垫片），所有既有调用点与测试导入零改动；模块稳定后的后续 commit 再收敛调用点。每个 commit 可独立回滚。
2. **窄接口注入。** 被拆类不接收整个 service，接收显式 `XxxContext` 接口（serial、db 访问、transport 解析、代次检查、日志、只读配置）。搬家后 `this.*` 断链，**tsc 逐条列出的编译错误就是耦合普查表**，逐个决定"进接口 / 变参数"。
3. **纯函数垫片。** 尾部纯函数迁出后在 service.ts 保留 `export { X } from './xxx'` 垫片，60 个测试文件不动；垫片是否最终移除另行决定。
4. **切片纪律。** 每片一个 commit；每片门槛：`npm run typecheck` 零错误 + `npm test` 全绿（当前基线 999 项 / 995 过 / 4 条件跳过）；搬家期间禁止重排 await、改日志文案、改字符串常量。
5. **锁相位纪律原样搬运。** 投递在 persistDecision 之后的锁外执行、回写在锁内、`serial()` 不可从 promise 链内部重入——这些注释级约束随代码一起搬进新模块顶部并原样保留。
6. **备份惯例。** 每阶段开工前按既有惯例快照 src 到 `dustbin/source-backups/YYYY-MM-DD-before-<phase>/`。

## 4. 阶段总览

| 阶段 | 内容 | 目标模块 | 预计迁出行数 | 风险 | 建议节奏 |
| --- | --- | --- | --- | --- | --- |
| P0 | 准备：指标基线 + 特征测试补口 | — | 0 | 无 | 半天 |
| P1 | 尾部纯函数区搬迁（热身） | `narrative-normalizers.ts` 等 2–3 个纯模块 | ≈1930 | 极低 | 1 天 |
| P2 | 投递层 dispatcher（主菜） | `delivery/dispatcher.ts` | ≈900（含补偿与分段投递则 +265） | 中低 | 2–3 天，4 个切片 |
| P3 | QQ 空间执行器 | `qzone-executor.ts`（与 qzone.ts 合并归位） | ≈310 | 低 | 1 天 |
| P4 | 端点注册表接线层 | `endpoint-registry.ts`（与 endpoints.ts 归位） | ≈590 | 低 | 1 天 |
| P5 | 压缩管线三阶段 | `compaction/pipeline.ts` | ≈790 | 中 | 2 天 |
| P6 | 后台外设族接线（播种/长线/Preplan/天气） | 各自既有纯模块旁 | ≈400 | 低 | 1 天 |
| P7 | 意图簿记与精确唤醒 | `intents.ts` | ≈860 | 中高 | 2–3 天 |
| P8 | 入站接收（最难，最后） | `inbound/` | ≈1000 | 高 | 独立评估后另出切片设计 |
| 收尾 | service.ts = 组合根 + 叙事核心 | — | 终态 ≈5000–6000 | — | — |

排序原则：风险从低到高、依赖从叶到根——先零依赖纯函数，再叶子型 I/O（投递/空间/端点），再后台管线，最后与叙事核心咬合的意图与入站。每个阶段完成后独立成立，随时可以停；停在任意阶段都已拿到该段的全部收益。

## 5. 各阶段设计

### P0 准备（无代码搬迁）

- 记录基线指标：service.ts 行数 / private 成员数 / `npm test` 用例数与时长。
- 盘点 P2 切片覆盖：通读 7979–8740，凡发现仅靠注释约束的隐式契约（如"ambiguous 只记 pending"）而现有测试未断言的，补特征测试。
- 快照备份。

### P1 尾部纯函数区（12160–14091）

- 按主题分 2–3 个纯模块（建议：`narrative-normalizers.ts`——normalizeDecision/normalizeInteraction/normalizeGroupChatActions 等叙事归一化；`session-media.ts`——extractSession*/describeQuotedMessage/音频格式探测；其余杂项归 `session-utils.ts`）。分几块、命名是否再细分，实施时按内聚度现场裁量，不追求一次到位。
- service.ts 顶部保留全量 re-export 垫片；零测试改动。
- 收益即时：service.ts 降至 ≈12160 行，后续所有阶段的搜索空间缩小。

### P2 投递层 dispatcher

目标形状：

```ts
// src/delivery/dispatcher.ts（示意）
export interface DeliveryContext {
  serial<T>(storyId: string, task: () => Promise<T>): Promise<T>
  dbGet: InterludeService['dbGet']          // 过渡期借 service 类型，后续窄化
  resolveTransport(target: DeliveryTarget): DeliveryTransport  // session→桌面桥→bot 三级
  isCurrentGeneration(): boolean            // 收敛 deliveryGeneration/taskGeneration 两套代次令牌
  reportOperation: InterludeService['reportOperation']
  readonly config: DeliveryRuntimeConfig    // 打字延迟、分隔符、splitReplyMessages 等只读投影
}

export class DeliveryDispatcher {
  constructor(private ctx: DeliveryContext) {}
  private executors = new Set<string>()                       // 同事件同执行器去重
  private accepted = new Map<string, OutgoingMessageDraft>()  // 平台成功但本地确认失败缓存
  async deliver(storyId: string, drafts: OutgoingMessageDraft[]): Promise<void>
  async updateOutcome(ref: ScriptDeliveryReference, outcome: SegmentOutcome): Promise<void>
}
```

切片顺序（每片一个 commit + 全量门槛）：

1. **纯工具下沉**：`typingDelayMilliseconds`、`splitOutgoingMessage`、传输路由解析 → 进既有 `delivery.ts`（零状态）。
2. **状态容器**：`deliveryExecutors`/`acceptedDeliveries`/`successfulDeliveryEntry`/`deliveryExecutionKey` → dispatcher 类，service 委托。
3. **传输执行**：`sendOutgoingMessages`（三级路由 + 打字延迟 + 分段）与 `sendCrossGroupMessage`。
4. **编排与回执**：`deliverOutgoingMessages` + `updateScriptDeliveryOutcome`/`confirmOutgoingDeliveries`。
5. **（可选，第二波）** `recoverPendingDeliveries`（1190–1385）与 `deliverDueSplitSegments`（7658+）：与 sweep/调度咬合，搬前需单独核对 bot-status-updated 事件接线。

契约搬运：模块顶部注释固化"账本为跨重启唯一真相；终态不可逆；ambiguous/transportTimeout 记 pending 不判失败；pending 不自动重发不适用于未确认分段"四条边界（与 ARCHITECTURE.md"投递与调度边界"一致）。

决策点（P2 完成后裁定）：`serial()` 与 DB 写队列（11805–12160）是否随之下沉为共享内核模块。默认**留守** service 作为组合根基础设施，被拆模块经 Context 接口引用；若 P2 结束后反向依赖（dispatcher 经 ctx 大量回调 service）证明留守成本更高，再立独立阶段。

### P3 QQ 空间执行器（9385–9697）

- qzone.ts 已承载纯策略（限流门/动作封装/意图校验）；本阶段把 service 侧执行器（qzoneExecute/qzoneFeedSweep/qzoneReactionSweep）与 qzone_post 表读写迁入执行器类，与投递 dispatcher 复用同一 transport 解析。
- qzone.test.ts 全程为门。

### P4 端点注册表接线层（9698–10290）

- endpoints.ts 已是纯策略 + 表结构；迁出 reconcileEndpointRegistry/endpointGateReason/端点链接与 endpointWriteQueue 串行化。
- 注意入站反向解析 `resolveInboundEndpoint` 的调用点在入站路径（P8 区），本阶段只迁出站侧，避免跨阶段耦合。

### P5 压缩管线（9296–9390 + 11105–11800）

- 三阶段纪律（锁内快照→锁外模型→锁内复查）整体搬入 `compaction/pipeline.ts`；scheduler 的独占门与指纹冷却已在外部，只迁移执行体。
- 压缩输出落库（persistFact/persistStatePatch/场景在场表）一并归拢，压缩相关 DB 访问收敛到本模块。

### P6 后台外设族（10332–11105 接线部分）

- worldSeederSweep/longHorizonSweep/Preplan 每日审查/weatherSweep 的 service 侧接线，分别迁至各自纯模块旁的薄 runner；startBackgroundTasks 只保留定时器注册。

### P7 意图簿记与精确唤醒（6502–7150 + 7548–7760）

- appendIntent/wakeDueIntents/deliverDueSplitSegments/follow-up/proactive-check 迁入 `intents.ts`，与 scheduler 的 keep-earliest 协作关系原样保留。
- 这是 P2 可选切片 5 的正式归宿；若 P2 已迁 deliverDueSplitSegments 则此处收编，否则两处合并于此。

### P8 入站接收（2532–3548，最后）

与叙事核心、turn-engine、意愿门、密度计数、端点解析全部咬合，且 receive/receiveGroup 的锁内落库路径是全系统最敏感区之一。**切片设计已成文：[SERVICE_EXTRACTION_P8_DESIGN.md](SERVICE_EXTRACTION_P8_DESIGN.md)**（2026-10-29 调研 + S1–S5 五片方案：表情库 → 媒体加载 → 历史向量 → 群能力动作 → 入站门控；缓冲冲刷与流式早发留守叙事核心）。实施以该文档为准。

### 收尾态

service.ts 保留：构造/组合根、startBackgroundTasks 定时器注册、故事与参与者管理、叙事核心（decide/persistDecision/flushBufferedNarrative）、serial 与 DB 基础设施、管理命令实现。预计 5000–6000 行。ARCHITECTURE.md 模块职责表随每阶段同步更新。

## 6. 验证门槛与指标

每切片硬门（缺一不可）：

1. `npm run typecheck` 零错误（含已启用的全部 strict 子项）。
2. `npm test` 全绿，用例数不少于基线（只增不减；新增特征测试计入）。
3. 搬家 diff 审查清单：无 await 重排、无日志文案改动、无字符串常量改动、无条件表达式改动。

阶段指标（记入 §9 跟踪表）：

- service.ts 行数与 private 成员数；
- `grep 'this\.service\.'`/`ctx.service` 反向引用计数（防 god object 从后门回来，P2 起监控，只许降不许升）；
- 新模块单测数（P2 起 dispatcher 应新增脱离 InterludeService 的用例）。

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 搬家期行为漂移 | 委托/re-export 先行 + 每片全量测试 + §6 第 3 条审查清单 |
| 隐藏耦合超出预估 | tsc 编译错误即耦合普查表；每片搬迁前后各跑一次全量 typecheck |
| 依赖回传整个 service（god object 后门） | Context 窄接口 + 反向引用计数监控；过渡期允许、目标为零 |
| Cordis 生命周期（打字延迟定时器泄漏） | 新模块统一走注入的 `ctx.setTimeout/setInterval`，随插件重载自动清理（与 service 现行一致） |
| 与未发布增量（考据/密度/Console）冲突 | 每阶段开工前 rebase 工作区最新增量；本计划各阶段独立成立，冲突窗口小 |
| 行号漂移 | 本文件行号仅快照参考；实施以符号名为准，必要时先刷新 §2 地图 |

## 8. 与其他工作的关系

- **strict 第三批（strictNullChecks，125 处）**：按模块推进——每完成一个阶段，即可对该模块单独收紧空值检查，避免直面 14k 行整体。P2 的 Context 接口同时把 dbGet/dbSet 的 `Promise<any>` 边界钉在一处，是第三批的先行收敛点。
- **ARCHITECTURE.md**：模块职责表与"主叙事数据流"引用的文件名随各阶段同步更新，保持文档与源码互为镜像的项目纪律。
- **多通道路线图**：P2 的 transport 解析接口即未来微信/第二 QQ 号的接入点；P4 端点接线层归位后，MULTI_CHANNEL 的 M2 验收面更小。

## 9. 完成度跟踪

| 阶段 | 状态 | 完成日期 | service.ts 行数 | 备注 |
| --- | --- | --- | --- | --- |
| P0 准备 | **已完成** | 2026-10-29 | 14091 | 指标基线 999 用例；投递区特征测试补口完成（test/delivery-pipeline-characterization.test.ts，7 项：执行键格式/回执匹配语义/终态分段跳过/打字延迟边界/分段配置投影/账本静默守卫/pending 失败路径），搬迁前后均绿 |
| P1 纯函数区 | **已完成** | 2026-10-29 | **12161** | 迁出 1931 行至 session-platform(460) / chat-artifacts(415) / narrative-normalizers(1417)；导出面 74 项零缺失（唯一新增 AutoAdvanceConfig 接口导出）；typecheck 零错误；999 用例全绿与基线一致；备份 dustbin/source-backups/2026-10-29-before-p1/。实施要点：模块级单例 activeServiceForEndpoints 以 bindActiveServiceForEndpoints(this) setter 交接；跨模块依赖单向（chat-artifacts→narrative-normalizers/session-platform，narrative-normalizers→session-platform）；re-export 垫片使 60 个测试文件零改动 |
| P2 投递层 | **已完成** | 2026-10-29 | **11611** | 投递区 15 方法（编排/传输三级路由/打字节奏/回执账本/失败记账/自动投递摘要）迁出 703 行至 delivery/pipeline.ts；service 保留同名薄委托。**形态偏离记录**：计划为 dispatcher 类 + Context 窄接口，实施改为**模块级函数（宿主首参）+ 同名委托**——既有测试以假宿主覆写原型方法为桩（deliveryHost 安装真实方法、rc10 覆写 splitOutgoingMessage 等），兄弟调用必须继续经宿主分发以保留覆写缝隙；类化与窄接口留待测试改写后推进（与 §5 决策点合并评估）。状态容器（deliveryExecutors/acceptedDeliveries）留守 service，管线经宿主引用读写。锁相位纪律与账本四边界随代码迁至模块顶部注释。验证：typecheck 零错误；1006 用例（含 P0 新增 7 项）/ 1002 过 / 0 败 / 4 条件跳过；搬迁未动 recoverPendingDeliveries 与 deliverDueSplitSegments（第二波，见 P7 归宿）。备份 dustbin/source-backups/2026-10-29-before-p2/ |
| P3 QQ 空间 | **已完成** | 2026-10-29 | **11363** | 执行区 6 方法（qzoneCaller/qzoneExecute/qzoneAvailable/executeQzoneIntent/qzoneFeedSweep/qzoneReactionSweep）迁出 300 行至 qzone-executor.ts，与 qzone.ts 纯策略归位相邻；沿用 P2 函数式配方（宿主首参 + 同名委托，qzoneCaller 的贴纸桌面模式等区外调用方经委托无感）。qzoneRuntime/qzoneFeedSweepRunning 状态留守 service。unknown 结果语义（保守计配额、不自动重试非幂等动作）固化于模块顶部。验证：typecheck 零错误；qzone+m1-audit 专项 30/30；全量 1006 用例与 P2 后基线逐位一致。备份 dustbin/source-backups/2026-10-29-before-p3/ |
| P4 端点注册表 | **已完成** | 2026-10-29 | **10918** | 接线区 32 方法（加载/补齐/迁移、三维状态观测与门控、出站地址解析、写队列串行化、入站反向解析封装、别名与端点链接管理）迁出至 endpoint-registry.ts；纯策略留 endpoints.ts。新增脚本适配：泛型签名（enqueueEndpointWrite<T>）与多行签名收尾行（"  ): TYPE {"）的边界检测。isBotOnlineStatus 顺迁 session-platform（service 保留 re-export 垫片，导出面不变）；endpointWriteQueue 等四个状态字段留守 service 转公开。入站反向解析方法随区迁出（调用方在 P8 区经委托无感，符合"只迁注册表侧"的边界）。验证：typecheck 零错误；全量 1006/1002/0/4 与基线一致。备份 dustbin/source-backups/2026-10-29-before-p4/ |
| P5 压缩管线 | **已完成** | 2026-10-29 | **10167** | 17 方法 + 3 类型（PreparedCompaction 族）+ 1 常量（SCHEDULE_PREPLAN_RETRY_BACKOFF 迁 schedule-preplan.ts）迁出 859 行至 compaction/pipeline.ts：三入口（后台扫描/手动/调度注册）、三阶段核心（快照/模型外置/复查落库）、事实提取落库、状态补丁与 Overlay、在场表、向量补齐。边界裁定：overlaySnapshotsForPrompt（叙事投影）与 embedText（共享嵌入工具，4 处非压缩调用方）留守。三阶段锁纪律与 scheduler 独占门边界固化于模块头。**耦合面报告（§5 预设阈值 50）**：实测 svc.X 成员 60 个——超阈值但未缩小范围：依赖为透明枚举型（db/日志/模型实例/叙事查询），无隐藏写路径，拆半（落库族 vs 三阶段）只会增加委托间接层而不降低真实耦合；如需收窄留待 strictNullChecks 批次按模块收紧时再评估。验证：typecheck 零错误；压缩族专项 37/37；全量 1006/1002/0/4 与基线一致。备份 dustbin/source-backups/2026-10-29-before-p5/ |
| P6 后台外设族 | **已完成** | 2026-10-29 | **9494** | 四家族 20 方法迁出至各自纯模块旁的薄 runner：weather-runner(38)/world-seeder-runner(200，含 buildWorldSeederPayload/blockedNames/drainDueSeededEvents)/schedule-preplan-runner(205，7 方法)/long-arc-runner(358，8 方法含 promptProjection)。stream recovery（scheduleStreamScriptRecovery/persistStreamScriptRecovery）非本族留守。startBackgroundTasks 只留定时器注册。weatherTimer 等运行状态字段留守 service 转公开。验证：typecheck 零错误；四族专项（weather/world-seeder/long-arc/schedule-preplan）53/53；全量 1006/1002/0/4 与基线一致。备份 dustbin/source-backups/2026-10-29-before-p6/ |
| P7 意图簿记 | **已完成** | 2026-10-29 | **8979** | 意图族 25 方法 + WAKE_DRIVEN_INTENT_TYPES 静态常量（去静态化迁出，唯一引用在随迁方法内、无测试引用）迁出 679 行至 intents.ts：创建（appendIntent/applyIntentUpdates/appendBrowserIntent）、到期消费（scheduleDueIntentWake/wakeDueIntents/scheduleNextPendingWake/deliverDueSplitSegments 及分段守卫族）、对话跟进承诺（pendingFollowUpCommitments/retireExpiredFollowUps/appendFollowUpCommitment/applyFollowUpResolutions/deferUnresolvedDueFollowUps）、主动复查（appendProactiveCheck）、考据接线（researchScriptTail/jevGatePassiveResearch/researchDeskFor/researchProvider/executeResearchIntent/researchStatusLines/executeDeferredBrowserIntent）、查询（dueIntents/upcomingNarrativeIntents）。边界裁定：对话跟进的三个 state 管理方法（dueConversationFollowUps 等，操作 automation.conversationFollowUpAt 非意图表）、admin 命令、annotateWithdrawnTurnIntents（叙事补偿）留守。scheduler keep-earliest 协作经 svc.scheduler 原样保留；研究接线与 research/ 纯模块归位。验证：typecheck 零错误；意图族专项（split-follow-up/issue-3/follow-up-commitment/conversation-interruption/research-agent）65/65；全量 1006/1002/0/4 与基线一致。备份 dustbin/source-backups/2026-10-29-before-p7/ |
| P8 入站接收 S1–S4 | **已完成** | 2026-10-29 | **7805** | 按专项设计（[SERVICE_EXTRACTION_P8_DESIGN.md](SERVICE_EXTRACTION_P8_DESIGN.md)）执行四片：S1 表情包库与采集 13 方法→sticker-library.ts(353，含 STICKER_DESCRIPTION_RETRY_COOLDOWN 迁入)；S2 媒体加载 16 方法→media-loading.ts(461，含 isTrustedImageHost/describeImageSource/isExpiredImageUrlError 三助手随迁、describeImageSource 导回 service)；S3 历史向量 4 方法→history-recall.ts(230，含 RECALLABLE_ENTRY_KINDS/HistoryVectorEntry/isHistoryEntryVisibleToParticipant 随迁 + re-export 垫片)；S4 群能力动作 8 方法→group-actions.ts(299) 且 **sendGroupMessage 归位 delivery/pipeline.ts（追加）**。修复要点：loadNativeAudio 默认参数 this.audioConfig 改函数体默认（唯一一处签名段 this，全模块扫描确认）。**S5（入站门控）缓办**：按价值/风险裁定推迟至真实多通道接入需求出现（设计文档 §4）。**首次测试文件改动记录**：rc50-issue-remediation 的 issue9 用例以源码文本断言信任域数组路径，随 S2 迁移改读 media-loading.ts（断言意图不变）。验证：typecheck 零错误；四族专项（贴纸 28/媒体 23/历史 34/群动作 32）全绿；全量 1006/1002/0/4 与基线一致。备份 before-p8-s1..s4 四份 |
| P8-S5 入站门控 | **已完成** | 2026-10-29 | **7573** | 因 Telegram 接入计划提前实施（原裁定缓办，触发条件满足）。**特征测试先行**：test/inbound-gate-characterization.test.ts 8 项钉死入口时序契约（重放不双计密度/门序早退/mention-only 证据路径/空内容早退/打断标志兜底清理），搬迁前后均 8/8。receive/receiveGroup/groupSenderName/lookupGroupMemberName 迁出 282 行至 inbound-gate.ts；serial 块逐字搬运，seenIncomingMessages/inboundSeq/interruptedTypingParticipants/contextDensity 容器留守；缓冲冲刷族按设计留守叙事核心。**附加交付物**：[PLATFORM_ASSUMPTIONS_INBOUND.md](PLATFORM_ASSUMPTIONS_INBOUND.md)——入站路径 QQ/OneBot 平台假设全清单（身份寻址/消息语义/媒体管道/行为面四类 16 条，各附 TG 差异与适配分叉建议），作为 TG 通道设计文档的直接输入。第二次测试文件改动：context-density 的密度审计用例（源码文本断言）随迁移改读 inbound-gate.ts 并更新 this.→svc. 标记。验证：typecheck 零错误；全量 1014 用例（999 基线 + P0 7 项 + S5 8 项）/ 1010 过 / 0 败 / 4 跳过。备份 dustbin/source-backups/2026-10-29-before-p8-s5/ |
| P2 投递层 | 未开始 | — | — | |
| P3 QQ 空间 | 未开始 | — | — | |
| P4 端点注册表 | 未开始 | — | — | |
| P5 压缩管线 | 未开始 | — | — | |
| P6 后台外设族 | 未开始 | — | — | |
| P7 意图簿记 | 未开始 | — | — | |
| P8 入站接收 | 未开始 | — | — | 开工前另出切片设计 |


## 10. 收官（2026-10-29）

P0–P8 全部阶段完成（含 S5），本计划关闭。终验与收尾检查记录如下。

### 10.1 最终指标

| 指标 | 基线 | 终态 |
| --- | --- | --- |
| service.ts 行数 | 14092 | **7573**（-46.3%） |
| 新增内聚模块 | 0 | **17 个**（合计约 8053 行，含模块头/契约注释/导入） |
| 测试 | 999 用例 | **1014 用例**（+7 投递特征、+8 入站特征）/ 1010 过 / **0 败** / 4 条件跳过 |
| 导出面（service.ts） | 74 项 | 74 项零缺失（唯一新增 AutoAdvanceConfig 接口导出） |
| 测试文件改动 | — | 2 次（rc50-issue9 与 context-density 审计用例，均为源码文本断言的读取路径随迁，断言意图不变） |
| strict 子开关 | 0 | 5 项（strictBindCallApply / noImplicitThis / strictFunctionTypes / useUnknownInCatchVariables / noImplicitAny） |
| 阶段备份 | — | 12 份（dustbin/source-backups/2026-10-29-before-p1..p8-s5，单片可独立还原） |

新模块清单：session-platform、chat-artifacts、narrative-normalizers（P1）；delivery/pipeline（P2）；qzone-executor（P3）；endpoint-registry（P4）；compaction/pipeline（P5）；weather-runner、world-seeder-runner、schedule-preplan-runner、long-arc-runner（P6）；intents（P7）；sticker-library、media-loading、history-recall、group-actions、inbound-gate（P8）。

### 10.2 终态 service.ts 组成（约 7573 行）

组合根与构造/定时器注册、故事与参与者管理、群/私两条回合冲刷心脏（flushGroupTurnUnlocked / flushBufferedNarrative）与叙事核心（decide / persistDecision）、入站缓冲与流式早发、串行队列与 DB 基础设施、日志、管理命令、Console API、撤销补偿（annotateWithdrawnTurnIntents / recordWithdrawnOutgoingEvents）。这是设计目标形态——拆分结束的信号是：剩下的内容同属一个职责（叙事编排本体），再拆只会制造间接层。

### 10.3 收尾检查记录（2026-10-29，九项全过）

1. 畸形声明/历史粘连残留：0；2. 函数式模块 this. 泄漏 / service svc. 泄漏：双向 0；3. 导出面守恒：74/74；4. 死亡委托：53 个全量核对 + 8 个抽查全部有真实调用方；5. tsconfig 注释与实际一致；6. 三份过程文档均已登记 docs/README.md 索引；7. 12 份阶段备份齐全；8. typecheck 零错误；9. 全量 1014 用例 0 失败。

### 10.4 配方沉淀（后续同类工作的资产）

**搬迁配方**：函数式模块（宿主首参，与 runStorySerialized 同构）+ service 同名薄委托 + re-export 垫片 + 兄弟调用经宿主分发（保留测试覆写缝隙）+ tsc 错误驱动收敛 + 备份与三件套验证门。**脚本资产**（/tmp，若需复用应入库）：跨度扫描器（多行签名/泛型/返回类型括号配对）、具名导入重建器、TS7006 括号感知注解器。**环境教训**：Git Bash heredoc 吞反斜杠（字符串构造正则失效——一律用正则字面量）；JS 单行 replace 只替换首个匹配；类方法默认参数中的 this 在独立函数非法；tsc 是耦合普查与行为漂移（参数丢失/字面量拓宽）的双重防线。

### 10.5 遗留与后续

- **strict 第三批（strictNullChecks）**：迁移前测量 125 处，拆分后按模块重测再逐模块收口（P2 决策点的 dispatcher 类化与 Context 窄接口并入此批评估）。
- **多通道**：微信 POC（按 [WECHAT_CHANNEL_PLAN](WECHAT_CHANNEL_PLAN.md)，onebots 路线）或 Telegram 通道设计（以 [PLATFORM_ASSUMPTIONS_INBOUND](PLATFORM_ASSUMPTIONS_INBOUND.md) 为输入，Koishi telegram 适配器优先评估）。
- **文档同步义务**：后续任何入站平台特判新增，登记进平台假设清单；模块增删同步 ARCHITECTURE.md 模块职责表。
- **本计划的定位**：转为历史实施记录；后续结构性重构另立文档，不在此表追加。

