# 技术债治理总体方案（最终版）

基线版本：`1.0.1-rc60` + 未发布工作区增量

实施增量（2026-11-19）：X1、X2 的局部死锁修复和 P2 已在工作区实现并完成验证：1366 项测试，1362 通过、4 跳过、0 失败；类型检查、正式构建、打包预检查通过。对应 §4 更新为实际方案。§2 的取证结论及 §5 的原始工期保留历史参考，已修项目以 §4 与 TECHNICAL_DEBT_X1_X2_P2_IMPLEMENTATION_2026-11-19.md 为准。
文档日期：2026-11-17
取证方式：三轮只读审查（前两轮全库分析 + 本轮三个专项取证代理），全部位点均经亲自读码核实，含 Koishi 框架源码取证（koishi 4.18.11 / cordis 3.18.1 / minato 3.7.0 / @koishijs/console 5.30.11 / schemastery 3.18.0 / @satorijs/core 4.6.0 / koishi-plugin-adapter-onebot 6.9.4）。
源码基线：`src/service.ts` 实测 **7612 行**（早前文档写 7594，以本文件为准）；narrator.ts 2899 行；全库 `svc: any` 166 处、`as any` 134 处、`reportOperation` 调用 163 处、薄委托约 163 个、serial 调用点 42 处。

> 本文行号均为取证时快照。任何提前实施的行为漂移都会使行号失效——每完成一项，请在本文对应条目标注「已实施于 <commit>」。

---

## 目录

- [§1 框架层事实基础](#1-框架层事实基础)
- [§2 本轮取证新增发现（含 2 项 bug 级）](#2-本轮取证新增发现)
- [§3 修复项总目录](#3-修复项总目录)
- [§4 各项详细方案](#4-各项详细方案)
  - X1 / X2（P0，即修 bug 级）
  - P1 svc:any 类型化 / P2 截断判定结构化 / P3 冷却风暴治理 / P4 参数对象化
  - P5 persistDecision 拆分 / P6 Qzone 时区 / P7 mentionsBot / P8 Config 镜像测试
  - P9 prompts.ts 集中 / P10 logging 显式 action / P11 杂项与 strictNullChecks
  - P12 Console 一致性 / P13 群冷却缓存 / P14 微清理打包 / P15 service.ts 终局拆分
- [§5 总路线图与依赖图](#5-总路线图)
- [§6 统一工程纪律](#6-统一工程纪律)

---

## 1. 框架层事实基础

以下事实直接决定了各修复方案的可行边界。全部结论带 node_modules 内证据行号。

### F1. cordis Service 生命周期（@cordisjs/core/lib/index.mjs）

- Service 构造器内 `this.ctx` 是 apply 传入的 fork 级 ctx（core.mjs:1130-1174）；服务经 `ctx.provide(name)` + `ctx.set` 注册（core.mjs:308-320, 279-307）。
- **`Service.stop()` 在旧 fork reset 时同步执行**（core.mjs:1172 `ctx.on("dispose")` → disposables 同步跑，core.mjs:662-670）；**`start()` 在 ready 后异步执行**（core.mjs:1167-1171, 392-397）。插件重载瞬间存在"无服务"窗口，依赖方靠 `internal/before-service` / `internal/service` 事件自动 reset+start 重试（core.mjs:413-433）。
- 配置热更新走 `fork.update` → restart = reset（旧 stop，同步）→ start（异步）（@koishijs/loader/lib/shared.mjs:261-289, core.mjs:619-625）。
- **对本项目的含义**：HDSI 的 30+ 内存容器在重载时随实例重建丢弃是框架语义，`stop()` 不清容器本身不是泄漏（index.ts:698 每次 apply `new InterludeService`）；但 HMR 期间的在途异步任务会撞 `disposed` 判定（narrator.ts:33 `isContextDisposedError` 的存在正是为此）。

### F2. cordis 定时器（@cordisjs/timer/lib/index.mjs）

- `ctx.setTimeout/setInterval` 注册到调用者当前 scope，dispose 自动清理（timer.mjs:15-30）。
- **回调抛错无任何 try/catch → 直接成为 Node uncaughtException**（timer.mjs:17-19, 27）；interval 不会被错误终止，后续 tick 继续抛。
- `ctx.sleep` 在调用者 dispose 时 reject 普通 `Error("Context has been disposed")`（timer.mjs:42）。
- **对本项目的含义**：sweep/唤醒等 setInterval 回调必须自带兜底（sweep 已有，新增回调要注意）；框架不存在 `EventError`/`ContextDisposedError` 类（全库 grep 仅命中本插件自身 d.ts），`isContextDisposedError` 是对错误 message 的文本匹配，属脆弱依赖。

### F3. minato 查询与索引（minato/lib/index.mjs, @minatojs/driver-sqlite/lib/index.mjs）

- `dbGet/dbSet/dbCreate` 对应 `database.get/set/create`（minato.mjs:1222-1273）；`$in` + sort **全部下推为 SQL**（sql-utils.mjs:50, 406-412），不是内存排序。
- JSON 整体字段存储为 TEXT 单列 + JSON.stringify（sqlite.mjs:155-158, 302-304）；嵌套路径条件走 `json_extract`（sql-utils.mjs:140, 338）→ **不可能命中 B-tree 索引**。
- minato 支持点号字段（dotted key）成为独立列并可建索引（minato.mjs:302-321, 324-335；索引校验 minato.mjs:255-261；sqlite.mjs:190, 524-528），但把 `metadata.groupId` 拆为 dotted 独立字段会与现有 `metadata: 'json'` 整列写入语义冲突，**不推荐**。
- 新增索引的代价：Minato/sql.js 在热重载时重建索引，是重载延迟来源（本仓库 database.ts:40 注释已记录）。
- **对本项目的含义**：`interlude_script_entry` 现只有 `['storyId','occurredAt']` 索引（database.ts:92-95），`kind` 与 `metadata.groupId` 无索引；对同一 story 的条件查询随剧本条目增长线性变贵（长跑故事条目数万行级）。首选优化方向是内存缓存，而非加列加索引。

### F4. Session.elements 与 @ 判定（@satorijs/core/lib/index.mjs, @koishijs/core, adapter-onebot）

- `session.elements` = `event.message?.elements`（satori.mjs:198-200），仅 message 事件有值；OneBot 的 request/notice 事件不建 `event.message`（ob.js:438-470）→ **elements 可能是 undefined，必须防御**。
- `content` 由 elements 序列化而来（satori.mjs:205-207）；OneBot `at` 段带 `attrs.id = qq`（ob.js:310-312）。
- 框架 `session.stripped.atSelf` 只识别**消息开头**的连续 at（kcore.mjs:1752-1767）——"@ 在消息中部"不被框架识别。
- 正确的全量判定：`session.elements?.some(e => e.type === 'at' && String(e.attrs.id) === selfId)`（或 `h.select(elements, 'at')`），并保留 `<at id=...>` 正则作 CQ 码兜底。
- `bot.isActive`（status !== OFFLINE && !== DISCONNECT）才是"能否发送"的判定（satori.mjs:373-375）；`status === ONLINE` 漏掉 CONNECT。

### F5. @koishijs/console（console/lib/index.mjs）

- DataService 基类 broadcast `data`/`patch` **无任何节流**（全包 grep 无 debounce/throttle），节流责任在调用方。
- authority 统一经 `console/intercept` 事件（console.mjs:97-99, 115-117, 223），实际由 plugin-auth 实现（plugin-auth/lib/index.js:175-180）；`addListener(event, cb, {authority})` 生效。
- RPC 是 id 关联的单发-响应模型（console.mjs:90-108）。
- **对本项目的含义**：HDSI overview 快照若未来提频，需自行节流；权限模型现状正确。

### F6. schemastery 类型推导（schemastery/lib/index.d.ts）

- **不存在 `Schema.Type` 导出**（全 d.ts 核对）；Koishi 插件推导 Config 的姿势是第二泛型参数 `Schema<Meta, TypeT>`。
- `Schema.object/array/dict/tuple` 推导完整（d.ts:46-49, 16-21）；**`Schema.union` 与 `Schema.intersect` 的元素类型推导为 `never`**（d.ts:6 From 对只读元组不满足任何分支 → 12-13, 50-51）。
- 本插件 Config 含 `Schema.intersect`（index.ts:83）+ **47 处 `Schema.union`** + 返回 `Schema<any>` 的工厂（:75-80）→ **"由 Schema 自动推导 Config 接口"对本仓库不可行**，手写 interface + 镜像测试是唯一可靠路线（详见 P8）。
- `role: 'secret'` 只是 UI 元数据（d.ts:72），类型层面无体现——HDSI 现有的 `collectSecretPaths` 递归方案（console/contract.ts:136-153）是正确做法。

### F7. 发送回执语义（@satorijs/core, @koishijs/core）

- `bot.sendMessage` 返回 `messages.map(m => m.id).filter(isNonNullable)`，**id 缺失时可能返回空数组**（satori.mjs:435-438）；不校验 bot 状态，失败以 reject 抛出。
- `session.send` 永不 reject——失败时 `logger.warn` 并返回 `[]`（kcore.mjs:1777-1784）；两者都不经过 middleware，不存在 `before-send` 事件。
- **对本项目的含义**：delivery/pipeline.ts:417 "空回执即抛错"的守卫与框架语义精确对齐，保持不动；`unknownOutcome`（transportTimeout）语义在框架层无对应物，是插件自有设计，正确。

### F8. middleware（@koishijs/core）

- 中间件 dispose 自动反注册（kcore.mjs:669-674）；`next()` 不调用 → 链静默终止、无报错；返回真值会被 `session.send` 发出（kcore.mjs:774-775）；嵌套上限 64 层（kcore.mjs:603）。
- 中间件内抛错只 warn 不冒泡（kcore.mjs:768-770）。
- **对本项目的含义**：HDSI 消息入口中间件（index.ts:739-752）对非 HDSI 会话必须始终调用 `next()`（现状正确，回归时注意）；盲模式吞命令走 `command/before-execute` 与此独立。

---

## 2. 本轮取证新增发现

以下为专项取证新确认的事实，其中 N1/N2 属 bug 级，应最先处理；N3-N14 是影响方案设计的关键约束。

### N1.【bug】groupNarrativeSalience 从不被清空

- 声明 service.ts:3170-3173，注释声称"与 groupWillingness 同生命周期"。
- 实际：`invalidateBufferedNarratives`（service.ts:3010-3027）清了 groupWillingness（:3023-3025）但**不含** groupNarrativeSalience；turn-engine.ts:237 支持的 `invalidateGroups` 回调在 service.ts:3012 调用处**未传入**；purge/clearDatabase 路径同样未清。
- 后果：群聊显著度分数在清库/重置后残留，长驻实例内存缓慢增长（每群一条记录，量级可控但语义错误——清库后新群会继承旧群的显著度水位）。
- 消费侧靠"命中即消费"收敛，但从不命中（如群已解散）的条目永不回收。

### N2.【bug 隐患】desktopPurgeRange 存在真实的 serial 嵌套自等待路径

- 调用链：`desktopPurgeRange`（service.ts:1494）在**自身 serial 回调内**调 `purgeStoryRange(...)`（:1495）；而 `purgeStoryRange`（:2416）内部再次 `this.serial(storyId, run)`，且**没有 inSerial 守卫**（只有 `typeof (this as any).serial === 'function'` 存在性判断）。
- 按 serial 实现（service.ts:7398-7418，promise 链接队），内层任务排在外层任务之后，而外层在 await 内层 → **桌面选区删除路径存在自等待死锁风险**。
- 对照：全库 42 处 serial 调用点中，有守卫的仅 2 处（narrative-normalizers.ts:955 `runStorySerialized`、delivery/pipeline.ts:663-665 `recordAutomaticDelivery`）；其余均确认非嵌套（含 narrative/turn-executor.ts 的 53/132/395/400/478/522——已逐一确认是顺序独立段，无 serial 套 serial）。
- 测试现状：full-audit-round1-20261112.test.ts:258 只覆盖队列外直调 purgeStoryRange，**未覆盖 desktopPurgeRange 嵌套路径**。

### N3. 容器生命周期审计结论

- `stop()`（service.ts:6994-6998）只置 `disposed=true` 并清 weatherTimer，不清任何容器——结合 F1 这**不是泄漏**（实例随 apply 重建），但"哪些容器随故事失效、哪些随实例"的边界只存在于散落的清理调用里。
- `historyBackoff`（service.ts:764）无任何清除点（invalidateHistoryVectors 清 backfills 不清 backoff）。
- `schedulePreplanBackoff`（:769）成功时 delete 但键可能残留；`timelineBackoff`/`timelineDirectorFailures` 成功时清除（:4189/4224/4225）。
- 其余约 40 个容器的完整生命周期表见取证附表（写入点/清除点/随故事清除/随实例四列），P15 的容器分组以此为输入。

### N4. finish_reason 从未被读取

- `grep -rn "finish_reason" src/` → **0 处**。非流式路径在 narrator.ts:1099-1102 已持有完整 response（`response.choices[0].finish_reason` 可得但被丢弃）；流式路径只透出文本与 usage。
- Anthropic 协议有独立信号：anthropic.ts:82-83 `stop_reason === 'max_tokens'` 抛错，但其 message **不匹配**截断正则 → Anthropic 截断目前享受不到 uncapped retry（narrator.ts:467 注释自认"不在此列"）。

### N5. 截断判定正则的误伤面比此前判断更大

- parse 失败抛错 message = `Narrative provider returned invalid JSON. raw=<原文前300字符>`（narrator.ts:1112，rawResponseExcerpt limit=300）→ 正则（narrator.ts:470）匹配的是**含模型自己输出的文本**：模型 prose 里出现 "incomplete"/"invalid JSON" 等英文词即误触发全量重试；HTTP 错误路径 detail = `HTTP <status> ...：<body 前300字符>`（http-proxy.ts:96-115），响应体同样进正则。
- 即：**上游 4xx body 与模型输出两条通道都能误触发**，每次误触发 = 一次去掉 max_tokens 的全量请求（12K+ 上下文 payload，双倍成本）。

### N6. failover 默认参数使冷却语义更激进

- 默认 `maxAttemptsPerProvider = 1`（index.ts:127-132, 171）→ 单次失败即写冷却（narrator.ts:490，cooldownMinutes 默认 5）。
- `selectRouteProviders`（narrator.ts:1007-1019）每任务调用一次（7 个任务槽各一次）；**全部 provider 冷却时退回全部 enabled 候选**（:1012）→ 故障风暴期每个候选都付全价试一遍。
- 冷却表 7 个使用点：:369 声明、:457/:474/:845 成功清除、:490/:855 写入、:1011 读取。

### N7. 薄委托与测试的原型耦合

- 约 **163 个一行薄委托**分布 20+ 模块（intents 25、endpoint-registry 32、delivery/pipeline 16、compaction/pipeline 17 等）。
- **≥6 个测试文件用 `Object.create(InterludeService.prototype)` + Object.assign 构造宿主**（flush-executor-characterization、reaudit-regressions、group-audio、audit-regressions、urge-density-deadlock、full-audit-round1 等），另有纯字面量宿主借 `InterludeService.prototype.method.call(host,...)`（delivery-pipeline-characterization、m7-m8-continuity）。
- test/helpers/delivery-host.ts 的最小契约 = 4 个容器字段 + 3 个缺省方法 + **8 个借用的原型方法**（deliveryGeneration/taskGeneration/taskGenerationCurrent/deliveryExecutionKey/successfulDeliveryEntry/deliveryLedgerConfirmed/deliverOutgoingMessages/confirmOutgoingDeliveries）。
- **结论：薄委托必须保留在 InterludeService.prototype 上**。"删除委托、调用方直连模块"的方案会成批破坏测试——service.ts 的"减壳"只能通过"委托体改为类型化转发"推进，不能物理删除（除非同步迁移全部测试宿主，那是 P15 之后的事）。

### N8. tryDecide 参数位置被测试钉死

- reaudit-regressions-20261030.test.ts:86-94 对 `service.tryDecide` 做 wrapper 桩并**按位置断言 args[9]（images）/args[17]（historicalGroupImages）**；split-follow-up-scheduling.test.ts:80 读第 7 参（dueIntents）；m7-m8-continuity.test.ts:167 用 `InterludeService.prototype.tryDecide.call(...)` 真调用。
- **结论**：P4 参数对象化必须同步改这三处测试，参数顺序在改造前是隐性契约。

### N9. persistDecision 结构（28 段）与绑定表达式（10 处）

- service.ts:4428-4966 共 28 个逻辑段（S1-S28，逐段清单见取证报告），最大单体 S16（:4640-4729，90 行，含状态计数/Alter/lifeHandoff/AgencyWindow/策略裁决 5 个子关注点）。
- `findPrivateOutgoingMessageEvent` 共 **10 处**（此前认定 9 处 + narrative/turn-executor.ts:191 的流式早发回填）：
  - mode：immediate ×8、delayed ×2（4776/4915）；
  - content 来源三态：**合成前**的 `decision.interaction?.reply.content`（4574/4578）vs **S17 策略过滤/合成后**的 `interaction.reply.content`（4759/4776）vs `action.content`（其余 6 处）——合并为助手函数时签名统一为 `(commit, participantId, mode, content, separator)`，content 差异留在调用点，**不可**在函数内部自行选择来源。
- 第 5 参全部恒为 `this.config.runtime.messageSeparator`。
- persistDecision 的 this 依赖面 ≈ 30 个成员 + 12 个 config 派生 getter——迁移走"svc 首参 + 原型保留"模式（与 turn-executor/compaction/pipeline 现状一致），现有 issue-15/17/10、audit-fixes-20261112 测试以 `host.persistDecision(...)` 直调真方法，天然兼容。

### N10. 群冷却是"每批次一次"，不是"每消息一次"（修正前轮结论）

- 调用链：inbound-gate 入队 → 自适应防抖合并（service.ts:2525-2530）→ flushGroupTurn → executeGroupNarrativeTurn：**先意愿门**（turn-executor.ts:351）**后冷却判定**（:375）。
- 冷却查询每**防抖批次**最多一次，且 `turnRelated`（@机器人/引用机器人）批次豁免冷却（:371-374）。
- 但查询本身随故事表增长变贵（storyId 索引命中后仍需按 occurredAt desc 扫该故事全部候选行，F3），长跑故事仍是 O(条目数) 每批次 → P13 缓存方案保留，优先级下调一档。

### N11. Config 接口必须手写（schemastery 推导不可行）

- 见 F6。P8 方案据此定为"镜像键集测试"，放弃此前设想的 `Schema.Type` 推导路线。

### N12. systemPrompt 实为 25 参数、单调用点（修正前轮的 26 参说法）

- 定义 narrator.ts:1934；唯一调用点 narrator.ts:1070（一次拼接完成 + 行尾 urgeInstruction）。
- 死参数 2 个：#9 `_agencyEnabled`、#21 `_proactiveContactMode`（实参每次都算，结果丢弃）。
- 实参分类：4 个 config 读取恒定、7 个简单布尔化、2 个复杂布尔链（#10 perspective 三源或、#13 引用二源或）、2 个局部预计算（streamingEarlyReply :1031-1036、cacheFirstPayload :1023）、9 个对象直传、1 个方法调用（resolveSpecialty :379）。

### N13. Prompt 字面量搬运清单（精确版）

- `DEFAULT_STYLE_PROMPT`：定义 narrator.ts:1873-1891；引用 :1983、:2081（systemPrompt 两分支兜底）、index.ts:2+190（schema default）。
- mainPrompt 中文兜底字面量（79 字）**仅 narrator.ts:1979 与 :2077 两处**；index.ts:187 是 hidden 的英文旧默认（legacy）、index.ts:669 是空串——三处并不相同，"统一"时以 narrator 两处为准。
- compactionPrompt lite（:2669-2689，4196 字符）与 full（:2692-2716，12564 字符）：共同前缀 ≈300 字符、共同后缀 ≈383 字符、5 组段落级语义重复；跨文件重复：压缩主默认句 4 处（narrator :2682/:2712 + index.ts:210/:213）、风格默认句 3 处（:2688/:2715 + index.ts:213）。
- LITE_* 常量全部在 specialization.ts:63-137（TYPED_MESSAGES_BASE:63、CONTENT_ONLY_TRANSPORT:112、LITE_TRANSPORT_*:117-121、LITE_JSON_CONTRACT:123、LITE_INTERVAL/UNREAD/NEVER_INVENT/OWNERSHIP/EVENT_SOURCES/ADMIN_NOTES/WORLD_EVENTS:125-137），消费点 narrator.ts:7 导入、:1941-1967 使用。
- 另有 4 个内联 prompt 函数未迁出：compactionPrompt（:2666）、timelineDirectorPrompt（:2764）、longArcGuidancePrompt（:2722）、schedulePreplanPrompt（:2745）、overlayCompactionPrompt（:2813）。
- narrator.ts:1968-1971：缩进误导问题属实（1968 行尾有逗号，1969 三元缩进少 2 格），非语法隐患。

### N14. serial 全景

- 42 处调用点，非嵌套确认（见 N2）；`runStorySerialized` 守卫语义（narrative-normalizers.ts:950-956）是唯一正确的重入形态，被 service.ts:6131、:1203 使用。
- 拆分 persistDecision 时**必须保留** runStorySerialized 语义（132/478 serial 回调内的撤回记账依赖它降级直跑）。

---

## 3. 修复项总目录

| 编号 | 名称 | 级别 | 前置 | 估时 | 核心收益 |
|---|---|---|---|---|---|
| X1 | groupNarrativeSalience 清理缺失修复 | P0-bug | 无 | 0.5h | 语义正确性 |
| X2 | 桌面范围删除死锁修复；全局重入方案独立评估 | P0-bug | 无 | 1d | 消灭死锁类故障 |
| P1 | svc:any → host-contract 类型化 | 结构 | 无 | 2-3d | 后续全部重构的编译器保护 |
| P2 | 截断判定结构化（finish_reason + Error 属性） | 正确性/成本 | 无 | 1d | 消除双倍 token 误触发 |
| P3 | 冷却风暴治理 + 半开探测 | 健壮性 | 无 | 1d | 故障恢复加速 |
| P4 | decide/tryDecide/systemPrompt 参数对象化 | 结构 | P1 | 3-4d | 位置错位编译期消灭 |
| P5 | persistDecision 拆分 + 绑定助手统一 10 处 | 结构 | P1 | 0.5d+1-2w | 绑定规则单点化 |
| P6 | Qzone localDayKey 时区化 | 正确性 | 无 | 0.5d | 跨时区配额正确 |
| P7 | mentionsBot elements 化 | 正确性/成本 | 无 | 0.5-1d | 消除误唤醒 |
| P8 | Config 镜像键集测试 | 漂移 | 无 | 1d | 配置漂移 CI 红灯 |
| P9 | prompts.ts 集中 | 漂移 | 无（P4 前更稳） | 1-2d | 合约单点化 |
| P10 | logging 显式 action 双轨 | 可维护性 | 无 | 1d+渐进 | 热路径省 15+ 正则/条 |
| P11 | 杂项清理 + strictNullChecks 路线 | 卫生 | 无 | 1d + 1-2w | null 缺陷编译期消灭 |
| P12 | Console 清单一致性 + overview 类型 | 漂移 | 无 | 0.5d | 静默失效通道关闭 |
| P13 | 群冷却内存缓存 | 性能 | 无 | 1d | 长跑故事批次成本 O(1) |
| P14 | 微清理打包（重复注释/死参数/魔法数字/round-robin 等） | 卫生 | 无 | 1d | 噪音下降 |
| P15 | service.ts 终局拆分（容器分组 + 委托类型化） | 结构 | P1, P4, P5 | 2-3w | 长期演进地基 |

---

## 4. 各项详细方案

### X1. groupNarrativeSalience 清理缺失修复（P0）

**实施状态：已于 2026-11-19 在工作区实现，待提交。** 以本节的实施内容替代早期示意步骤；提交后补充 commit。

- groupNarrativeSalience 是按 storyId 分组的可选 Map；指定故事失效时 delete(storyId)，全局失效时 clear()，尚未初始化时安全跳过。
- 清理集中接入 invalidateBufferedNarratives；故事重置、范围删除与全库清空复用现有调用链。
- 瞥视任务捕获既有任务代次，进入串行域以及读取故事后复核；执行时重新读取有效显著度，清理前缓存的分数不再用于调度。
- 范围删除采用整故事显著度失效；后续群批次重新累积。既有衰减、消费和调度下界规则沿用。

**回归：** test/technical-debt-x1-x2.test.ts 覆盖局部/全局/未初始化清理、重建累积、排队后代次失效、读取期间清理；既有 group-background 与 review-fixes 调度约束回归继续验证正常行为。

**回滚：** 撤回本项工作区增量，无数据迁移。

---

### X2. 桌面范围删除串行边界修复（P0）

**实施状态：已于 2026-11-19 在工作区实现，待提交。** 本轮收窄为确定性死锁修复；全局 serial 重入直跑方案保留独立评估。

**已确认根因：** desktopPurgeRange 外层 serial 等待 purgeStoryRange 的同故事内层 serial，构成自等待。

**实施结构：** 桌面入口完成故事查找与参数校验后，直接等待 purgeStoryRange。后者保留唯一排队责任，实际删除继续由 purgeStoryRangeUnlocked 执行。serial、inSerial、AsyncLocalStorage 和现有显式重入守卫维持原行为。

**边界原因：** AsyncLocalStorage 的故事标识会向派生异步任务传播，单凭故事 ID 不能证明回调仍持有活跃串行任务的执行权。全局直跑需要活跃所有权与并行子任务的单独设计，不能视为本次局部修复的前提。

**回归：** 使用真实 AsyncLocalStorage 和真实 serial 实现，验证桌面删除完成、此前任务→删除→后续任务的顺序、删除失败释放队列、管理路径直调范围删除保留串行域。

**回滚：** 撤回桌面入口的局部增量，无数据库或协议迁移。

---

### P1. svc:any → host-contract 类型化

**位点**：`svc: any` 166 处（endpoint-registry 32、intents 25、compaction/pipeline 18、media-loading 16、delivery/pipeline 16、sticker-library 13、long-arc-runner 8、group-actions 8、schedule-preplan-runner 7、qzone-executor 6、world-seeder-runner 4、inbound-gate 4、history-recall 4、onebot-offline-catchup 2、narrative/turn-executor 2、weather-runner 1）；`as any` 134 处；测试假宿主形态见 N7。

**影响事实**：隐式宿主契约（serial/inSerial/endpointWriteQueue/deliveryGeneration/taskCurrent/reportOperation/dbGet/dbSet/...）只存在于注释；service.ts 侧改名/改签名 tsc 零报警。

**目标设计**：新建 `src/host-contract.ts`，按迁出域定义**窄接口**（不建一个大接口）：

```ts
// src/host-contract.ts —— 每个接口只列该域实际用到的成员（以 grep 结果为准）
export interface SerialHost {
  serial<T>(storyId: string, task: () => Promise<T>): Promise<T>
  inSerial(storyId: string): boolean
}
export interface DeliveryHost extends SerialHost {
  dbGet(table: string, query: unknown, cursor?: unknown): Promise<any[]>
  dbSet(table: string, key: unknown, update: unknown): Promise<void>
  getStory(id: string): Promise<InterludeStory>
  getParticipant(id: string): Promise<InterludeParticipant | null>
  canHandleParticipant(p: InterludeParticipant): boolean
  ensureEndpointRegistry(): Promise<void>
  recordOutgoingDeliveryFailure(story: InterludeStory, participantId: string | null,
    message: OutgoingMessageDraft, reason: string, status: ScriptDeliverySegmentStatus): Promise<void>
  report(verbosity: ..., story: InterludeStory, phase: ..., message: string, ...args: unknown[]): void
  reportStandalone(level: ..., message: string, ...args: unknown[]): void
  // delivery-host.ts 借用的 8 个原型方法 + 4 个容器字段（N7）
  runtimeGeneration: number
  storyTaskGenerations: Map<string, number>
  deliveryExecutors: Set<unknown>
  acceptedDeliveries: Map<string, unknown>
  deliveryGeneration(storyId: string): number
  taskGeneration(storyId: string): number
  taskGenerationCurrent(storyId: string, generation: number): boolean
  deliveryExecutionKey(...): string
  successfulDeliveryEntry(...): ...
  deliveryLedgerConfirmed(...): Promise<boolean>
  deliverOutgoingMessages(...): Promise<OutgoingMessageDraft[]>
  confirmOutgoingDeliveries(...): Promise<void>
}
export interface IntentHost extends SerialHost { /* intents.ts 25 处所需成员 */ }
export interface CompactionHost extends SerialHost { /* compaction/pipeline.ts 18 处 */ }
export interface EndpointRegistryHost extends SerialHost { /* endpoint-registry.ts 32 处，含 endpointWriteQueue */ }
// ……每迁一个文件补一个接口
```

**实施步骤**（每文件一个 commit，独立可回滚）：
1. 建 host-contract.ts 骨架 + `SerialHost`。
2. 按"依赖少 → 多"顺序逐文件迁移签名，推荐顺序：weather-runner(1) → onebot-offline-catchup(2) → turn-executor(2) → inbound-gate(4) → history-recall(4) → world-seeder-runner(4) → qzone-executor(6) → schedule-preplan-runner(7) → group-actions(8) → long-arc-runner(8) → sticker-library(13) → delivery/pipeline(16) → media-loading(16) → compaction/pipeline(18) → intents(25) → endpoint-registry(32)。
3. 每文件迁移时：grep 该文件全部 `svc.` 成员访问 → 全部列入接口 → `svc: any` 改 `svc: XxxHost` → typecheck。
4. 同步改 test/helpers/delivery-host.ts：`deliveryHost(host)` 返回值标注 `DeliveryHost`，缺省补齐逻辑不变——测试桩缺成员从此编译期报错。
5. `as any` 134 处随文件迁移时二分处理：真缺口（补接口成员）vs 类型债（写窄断言 + 注释）。**禁止**为过编译给接口加 `[key: string]: any`。

**验证**：每 commit `npm run typecheck` + `npm test`；最终 `npm pack --dry-run` 确认 d.ts 输出。

**回滚**：逐文件 revert；接口是纯类型层，无运行时影响。

**风险与缓解**：
- 类型化会暴露 any 掩盖的真实不匹配 → 逐个人工核实（修 bug 或删死代码），不顺手放宽接口。
- `Object.create(InterludeService.prototype)` 测试宿主（N7）：InterludeService 类声明 `implements` 各接口的超集即可，测试宿主不受影响——**前提是薄委托保留在原型上**（N7 结论），P1 不做任何委托删除。

**收益**：
- 以后构建：P4/P5/P15 的所有"行为不变迁移"从人肉对照变为编译器验证；service.ts 私有成员获得重命名安全性。
- 性能：零运行时开销。

---

### P2. 响应完成状态分类与有界截断恢复

**实施状态：已于 2026-11-19 在工作区实现，待提交。** 本节替代早期以 parseFailed 与文本正则推断截断的方案。

**事实分类：** 新增 src/provider-response.ts，以 ProviderResponseError 区分预算截断、解析失败、空响应、流未完成、拒绝、提供商错误和超时。诊断文本保留原文摘录；恢复资格只读取结构化分类。

**传输路径：**

1. OpenAI 兼容非流式响应读取 finish_reason；明确 length 在解析前判为截断，避免将可解析的截断片段确认为完整输出。
2. 通用 SSE 与智谱 SSE 保存无文本结束帧中的 finish_reason；正常终止标记或结束原因作为完成信号，缺少完成信号的 EOF 分类为 stream-incomplete。
3. 通用 SSE 保留网关返回普通 JSON 的降级路径，并验证结束原因。
4. Anthropic 的 max_tokens 分类为预算截断，保留必需输出预算并沿用普通重试/切换，不执行去上限恢复。
5. Gemini Interactions 只有明确 MAX_OUTPUT_TOKENS / MAX_TOKENS（及相应小写）原因享有截断恢复；原因未知的 incomplete 作为未完成处理。

**恢复约束：**

- 配置了正输出上限、协议确认预算耗尽、尚无可见早发回复且剩余时间足够时，允许一次移除显式上限的恢复。
- 主叙事与 Alter 的同服务商普通尝试共享总时间预算与一次额外恢复机会；其余侧任务在一次 sideTaskJson 调用内共享预算。
- 普通解析失败、空响应、HTTP 错误和无终止信号的流中断走既有普通失败处理。缺少 finish_reason 的正常非流式响应继续兼容。
- 移除上限同时清除 extraBody 中残留的 max_tokens，确保恢复请求预算实际改变。
- 首次请求及恢复请求期间的作用域销毁立即退出；早发回复后继续保护可见投递，整轮重新生成终止。
- 截断与失败响应已返回的 usage 尽量保留；流式 finally 统一结算每次响应，聚合不重复计数。

**诊断：** 记录失败分类、finish reason、恢复次数与剩余毫秒；响应摘要仍供排障，不参与恢复判定。识别 Context has been disposed 的框架销毁形态。

**回归：** test/technical-debt-p2.test.ts 覆盖主叙事/侧任务、次数与时限、拒绝/无上限/未知完成原因、销毁和早发保护、Anthropic 用量、Gemini 分类、智谱无文本结束帧及通用 SSE JSON 降级。旧 timeline-director 截断样本增加明确 length 证据，Gemini 文本正则断言改为结构化分类断言。提示词快照继续逐字节校验。

**兼容性：** 缺少截断证据的无效响应不再附赠去上限重试，保留普通尝试；主叙事单服务商 timeout 由每请求时限收敛为该服务商本轮全部尝试的共享时限。

**回滚：** 响应分类、适配器、调用方及相应测试作为一个完整增量撤回，无持久数据迁移。

---

### P3. 冷却风暴治理 + 半开探测

**位点**：narrator.ts:369（冷却表）、:490/:855（写入）、:457/:474/:845（清除）、:1008-1018（selectRouteProviders）；默认参数 N6（maxAttemptsPerProvider=1、cooldownMinutes=5）。

**影响事实**：全部 provider 冷却时退回**全部** enabled 候选（:1012）→ 风暴期每候选全价试一遍；重启失忆；无半开区分。

**目标设计**（按收益/风险排序，三档独立）：
1. **风暴收敛（主收益）**：:1012 的"全部冷却 → 全部候选"改为"全部冷却 → 仅保留最早到期的 1 个候选"：
   ```ts
   const candidates = ready.length ? ready
     : enabled.length ? [enabled.reduce((a, b) => (cooldownAt(a) <= cooldownAt(b) ? a : b))]
     : []
   ```
   保留"有恢复机会"的原意图（:1012 注释），但把风暴期探测成本从 N × 全 attempts 降为 1 × attempts。
2. **半开标记**：冷却刚到期的候选在 `selectRouteProviders` 返回时标记 `halfOpen: true`；requestNarrative 失败循环里 halfOpen 候选的 attempts 上限取 `min(1, maxAttemptsPerProvider)`——失败立即重冷却（现有 :490 逻辑天然做到），成功即全量恢复（:457 天然做到）。默认 maxAttemptsPerProvider=1 时此项改动近乎零成本，只是把语义显式化。
3. **重启持久化（可选，低优先）**：冷却时间戳随健康快照/端点状态落库，启动时恢复；日志明示"冷却已恢复（持久化）剩余 X 分钟"避免运维困惑。单进程设计下价值有限，仅对频繁手动重启的部署有意义。

**实施步骤**：PR-P3a 改 :1012（一行 + reduce 辅助）；PR-P3b 加 halfOpen 标记与 attempts 收紧；PR-P3c 可选持久化（独立评估，可无限期搁置）。

**验证**：`npm test`（model-routing / model-behavior 相关）；沙盒模拟双 provider 全失败：断言风暴期每轮只打 1 个探测请求而不是轮询全部。

**回滚**：逐 PR revert。

**风险**：风暴收敛改动改变了"全部冷却时仍尝试所有候选"的旧行为——若某 provider 冷却是误判（如网络抖动），旧行为给每个候选一次机会，新行为只试最早到期的 → 用"最早到期"标准保证总有一个候选在窗口尽头被重试，恢复性不降；观测期日志确认。

**收益**：故障恢复成本从 `providers × attempts × timeout` 降为 `1 × attempts × timeout`（默认参数下从 N 次请求降为 1 次）；熔断语义显式化。

---

### P4. decide/tryDecide/systemPrompt 参数对象化

**位点**：decide service.ts:3832（22 参，仅 tryDecide 内 3 个调用点 :4319/:4332/:4359）；tryDecide :4285（19 参，5 个生产调用点 + 3 个位置敏感测试，见 N8）；systemPrompt narrator.ts:1934（25 参，唯一调用点 :1070，见 N12）。

**影响事实**：同类型位置参数混排（多 Date/数组/string|undefined），错位编译器无法发现；tryDecide→decide 参数表双份维护；测试按位置断言（N8）。

**目标设计**：
```ts
// src/types.ts（或新 src/turn-context.ts）
export interface TurnContext {
  story: InterludeStory
  participant: InterludeParticipant | null
  phase: NarrativeRequest['phase']
  from: Date
  now: Date
  userMessage?: string
  dueIntents: NarrativeIntent[]
  supersededIntents?: NarrativeIntent[]
  groupContext?: GroupContext
}
export interface TurnAssets {
  images?: NarrativeImage[]
  audio?: NarrativeAudio[]
  chatCapabilities?: ChatActionCapabilities
  quotedMessages?: IndexedQuotedMessageContext[]
  stickerCatalog?: StickerCatalogEntry[]
  turnQueryEmbedding?: number[]
  visualObservations?: string[]
  historicalGroupImages?: NarrativeHistoricalImage[]
  groupBackground?: GroupBackgroundSection[]
}
export interface DecideExtras {
  extraWebContext?: WebObservation[]
  outputRecovery?: boolean
  timelinePlan?: TimelinePlan
  onEarlyReply?: (reply: EarlyNarrativeReply) => Promise<boolean>
}
// decide(ctx: TurnContext & TurnAssets & DecideExtras): Promise<DecideOutcome>
// tryDecide 并入 decide（timelinePlan 的计算移入 decide 开头的自动相位分支）
```
systemPrompt 侧：
```ts
export interface SystemPromptInput {
  phase: NarrativeRequest['phase']
  mainPrompt?: string; formatPrompt?: string; fixedPrompt: string
  baseStylePrompt?: string; storyStylePrompt?: string
  refreshContinuity?: boolean; alterEnabled?: boolean
  perspectiveEnabled?: boolean; outputRecovery?: boolean
  chatCapabilities?: ChatActionCapabilities; hasQuotedMessage?: boolean
  stickerCatalog?: StickerCatalogEntry[]; schedulePreplan?: boolean
  streamingEarlyReply?: boolean; cacheFirstPayload?: boolean; groupTurn?: boolean
  writingOptions?: ...; specialty?: SpecialtyProfile
  channelSelectionEnabled?: boolean; longHorizonGuidance?: string
  features?: Partial<NarrativeContractFeatures>
  platformWording?: Partial<PlatformContractWording>
}
// 死参数 _agencyEnabled / _proactiveContactMode 直接删除（调用点实参一并删除）
```

**实施步骤**：
1. PR-P4a（decide/tryDecide）：定义三接口；decide 改单参；**tryDecide 保留为薄编排层**（timelinePlan 计算 + 降级日志 + 恢复重写逻辑）调用 `decide(ctx)`——消除 22/19 双份参数表；更新 5 个生产调用点（advanceUnlocked:3733、:3771、turn-executor:112-124、:465）。
2. **同步更新位置敏感测试**（N8 清单）：reaudit-regressions-20261030.test.ts:86-94（args[9]/args[17] → 断言 `ctx.images`/`ctx.historicalGroupImages`）；split-follow-up-scheduling.test.ts:80（args[6] → `ctx.dueIntents`）；m7-m8-continuity.test.ts:167（prototype.call 改传 ctx 对象）。桩整体替换 tryDecide 的测试（flush-executor-characterization、group-audio 等）不受影响。
3. PR-P4b（systemPrompt）：25 参 → SystemPromptInput；:1070 调用点改对象字面量；删 2 个死参数；narrator.ts:1968-1971 缩进顺手修复。
4. 快照守护：narrative-contract-snapshot.test.ts 必须全程绿——**对象化必须字节等价**，红了逐段比对。

**验证**：每 PR `npm run typecheck` + `npm test`（重点：narrative-contract-snapshot、reaudit-regressions、split-follow-up-scheduling、m7-m8-continuity、streaming-reply、issue-15/17）。

**回滚**：PR 粒度 revert；接口定义先落、签名后切，中间态可用双签名过渡（旧签名薄包装一版，跑绿后删）。

**风险与缓解**：
- prompt 字节漂移 → 快照测试是安全网，红了就说明有差异，逐段对照。
- onEarlyReply 回调链（流式早发）→ issue-15/streaming-reply 测试覆盖；ctx 传递时回调保持原引用。
- tryDecide 并入时 timelinePlan 计算的降级分支（:4296-4306 熔断日志）必须原样保留——有专属测试。

**收益**：
- 以后构建：新增上下文字段（多通道方向 M1/M2 必然发生）从改 7 处降为改接口 + 1 处装配；位置错位类 bug 编译期消灭；systemPrompt 可按段单测。
- 性能：无（对象传递与位置参数成本相当）。

---

### P5. persistDecision 拆分 + 绑定助手统一 10 处

**位点**：service.ts:4428-4966（28 段，S1-S28 清单见 N9）；绑定表达式 10 处（service.ts:4540/4545/4574/4578/4759/4776/4901/4915/6139 + narrative/turn-executor.ts:191）。

**影响事实**：见 N9——9 处（现确认 10 处）副本 = issue #15 类绑定规则的多份实现依赖；content 来源三态不可在助手内自行选择；S16 是最大单体。

**目标设计**：
```ts
// 第一步（PR-P5a）：绑定助手，一次定义、10 处替换
// 放 src/script/delivery-ledger.ts（findPrivateOutgoingMessageEvent 的同域）
export function bindPrivateActionEvent(
  commit: ScriptCommitDraft | undefined,
  participantId: string,
  mode: 'immediate' | 'delayed',
  content: string,          // 来源差异留在调用点（N9 三态）
  separator: string,
) {
  return commit ? findPrivateOutgoingMessageEvent(commit, participantId, mode, content, separator) : undefined
}
```
第二步（PR-P5b 起）：按 svc 首参模式迁出到 `src/commit/` 目录，原型薄委托保留（N7）：

| 新模块 | 吸收段 | 说明 |
|---|---|---|
| commit/normalize.ts | S2-S8 | 纯规范化 + 合成预检（S8 引 synthesizeCrossActionFromScript，经宿主传入） |
| commit/build.ts | S9-S12 | buildCommit + 绑定校验 + 条目落库 |
| commit/intents-and-facts.ts | S13-S14 | 意图更新/记忆/浏览器意图/参与者补丁 |
| commit/policy.ts | S15-S16, S21-S25 | 策略评估与撤回账本（S16 再拆 5 子函数） |
| commit/deliver.ts | S17-S20, S26-S27 | 消息准备/延迟意图/跨会话执行/分段 |
| commit/finalize.ts | S28 | Urge 交接 + 长线浮空启动 |

persistDecision 本体保留为编排函数（顺序调用上述模块），签名与调用点零变化。

**实施步骤**：
1. PR-P5a：绑定助手 + 10 处机械替换（行为零变化，半天）。
2. 每迁一段前补特征化测试：issue-15 / issue-17 / issue-10 / audit-fixes-20261112 / proactive-binding-compatibility 已覆盖关键分支；S16 的策略裁决段补一组撤回账本特征化用例（recordWithdrawnOutgoingEvents 的五态语义）。
3. PR-P5b…P5f：逐模块迁移，每 PR 一个模块；**保留 runStorySerialized 守卫语义**（N14——132/478 serial 回调内的撤回记账依赖它）。
4. 顺路收益：S4 的 `participants(story.id)` 查询与 decide:3861 的同回合重复查询，在编排层把 participants 作为参数下传，省一次 DB 往返。

**验证**：每 PR `npm run typecheck` + `npm test`（重点：issue-15/17/10、proactive-binding-compatibility、supersede-repro、review-delivery-regressions）；新增 S16 特征化测试。

**回滚**：PR 粒度 revert；编排函数签名不变使外部零感知。

**风险与缓解**：
- 提交核心路径，行为漂移 = 账本不一致 → 测试先行 + 每段独立 PR + 快照。
- `decision` 变量三次重赋值（:4456/:4495/:4507）→ 迁移时显式命名中间态（normalizedDecision → synthesizedDecision），消除隐式重赋值。
- S16 引用面最大（updateAlterSystem/persistTimelineSceneAnchor/agencyConfig/recentEntries/deliveryPolicyConfig/dbSet/scheduleAlterAnalysis）→ 随 P1 的 CompactionHost/PersistHost 接口自然覆盖。

**收益**：
- 以后构建：issue #15 类绑定修复从 10 处改 1 处；提交路径获得独立测试面与基准能力；为事务化/多进程改造铺路。
- 性能：participants 重复查询消除（每回合省一次全表查询）。

---

### P6. Qzone localDayKey 时区化

**位点**：qzone.ts:98-102（本地时区取日）；调用点在 qzone-executor.ts 限流门（持 story）；对照范本 schedule-preplan.ts:74（calendarDayKey + story.setting.timezone）；复用 src/time.ts formatter 缓存。

**影响事实**：服务器与故事时区不一致时配额窗口漂移（UTC 服务器 + Asia/Shanghai 故事差 8 小时）。

**实施步骤**：
1. `localDayKey(value: Date | number, timeZone?: string)`：有参时用 `Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).format(date)`（en-CA 输出 YYYY-MM-DD）；formatter 经 time.ts 缓存复用。
2. 调用点传 `story.setting.timezone`。
3. 兼容期：切换后首个自然日 `usedToday` 取新旧两口径最大值（保守计配额），注释标注退役版本。
4. 测试：UTC 服务器 + Asia/Shanghai 故事在 23:30 / 00:30 两个边界的用例。

**验证**：`npm run typecheck` + `npm test`（qzone.test.ts 补用例）。**回滚**：单 commit。**风险**：低（兼容期保守计）。**收益**：配额语义与全局故事时间观统一；多通道路线复用同一日界口径。

---

### P7. mentionsBot elements 化

**位点**：chat-artifacts.ts:408-413；框架事实 F4（elements 仅 message 事件、stripped.atSelf 只认开头、at 段带 attrs.id）。

**目标设计**（三层降级，保持向后兼容）：
```ts
export function mentionsBot(session: Session) {
  const selfId = normalizeAccountId(session.selfId)
  if (!selfId) return false
  // 1) 结构化元素（message 事件可靠；OneBot at 段 attrs.id）
  if (session.elements?.some(el => el.type === 'at' && String((el.attrs as { id?: unknown }).id) === selfId)) return true
  // 2) CQ 码文本兜底（<at id=...>）
  if (new RegExp(`<at[^>]+id=["']?${selfId}["']?`, 'i').test(String(session.content || ''))) return true
  // 3) 旧 includes 兜底：仅 elements 缺失（非 message 事件）时使用，并留观测日志
  if (!session.elements) {
    // diagnostic 计数：includes 兜底命中频率，观测一版后评估移除
    return String(session.content || '').includes(selfId)
  }
  return false
}
```

**实施步骤**：单 PR；加 diagnostic 计数统计第 3 层命中率；跑一轮确认群聊 @ 判定正常（group-echo-gate / group-willingness 测试）。

**验证**：`npm run typecheck` + `npm test`（group 相关全部）；沙盒手动验证 @ 在消息中部/开头/非 @ 场景。

**回滚**：单 commit。

**风险**：个别适配器 elements 形态差异（attrs.id 类型）→ `String(...)` 归一 + 正则兜底保证不漏判；误判方向从"多判"变"少判"需观测——第 3 层兜底保留期间风险可控。

**收益**：消除 QQ 号出现在普通文本引发的误唤醒（每次省一次 12K+ 上下文主叙事调用）；群意愿门语义回到设计意图。

---

### P8. Config 镜像键集测试（schemastery 推导不可行后的落地路线）

**位点**：index.ts:578-671（Schema 树，含 intersect + 47 处 union）；service.ts:1-738（22 个手写 interface）；消费点钳制 service.ts:2775-2803（audioConfig/stickerConfig，:2800 注释记录过漏拷线上 bug）；范本 test/console-config-center.test.ts。

**影响事实**：见 N11（F6）——手写 interface 是唯一可靠方案；加配置项要同步 Schema/interface/钳制 3 处，漏一处 = Console 可保存但运行时不读（静默失效）。

**目标设计**：
```ts
// test/config-schema-mirror.test.ts
// 1) 手工维护 interface 键集快照（与 service.ts 接口一一对应的路径清单）：
//    如 'model.mainStreamingMode'、'onebot.accounts[].selfId'、'urge.baseIntervalMinutes'
// 2) 运行时遍历 Config Schema 树抽取路径（Schema.object 的 children/dict 递归；
//    intersect 取全分支并集；union 取全选项并集；工厂返回的 Schema<any> 节点以
//    白名单登记其已知键）。
// 3) 双向断言：schemaPaths ⊇ interfaceKeys 且 interfaceKeys ⊇ schemaPaths（白名单内）。
// 4) 新增配置项忘同步任一侧 → 测试红。
```

**实施步骤**：
1. 写 Schema 树遍历器（约 60 行；schemastery 节点是带 children/dict 的运行时对象，console/contract.ts 的 collectSecretPaths 已有同款递归范本 :136-153）。
2. 从 service.ts 接口生成初始键集快照（一次性人工核对，生成后入测试文件）。
3. 白名单登记：工厂返回 `Schema<any>` 的节点（index.ts:75-80）与 `Schema.path` 等特殊构造。
4. audioConfig/stickerConfig 钳制（service.ts:2775-2803）改写为 `resolveAudioConfig(config)`/`resolveStickerConfig(config)` 纯函数（对齐 worldSeederRuntime/weatherRuntime/qzoneRuntime 既有模式），字段清单由键集测试守护。

**验证**：`npm test`（新测试）；故意在 schema 加一个 interface 没有的字段确认变红。

**回滚**：纯测试 + 纯函数改写，单 revert。

**风险**：遍历器对 schemastery 内部结构的依赖（children 属性名）→ schemastery 3.18 内部结构稳定，且测试自身会在升级时红——这正是想要的保护；白名单要防止"图省事把新字段塞白名单"——白名单条目必须带注释说明为何无法静态推导。

**收益**：配置漂移从静默失效变 CI 红灯；新配置项接入成本减半；钳制逻辑获得单一模式。

---

### P9. prompts.ts 集中

**位点**：搬运清单见 N13（DEFAULT_STYLE_PROMPT 4 处引用、mainPrompt 中文兜底 2 处、compaction 双版共享前后缀、LITE_* 常量 13 个、4 个内联 prompt 函数）。

**实施步骤**：
1. PR-P9a：建 `src/narrative/prompts.ts`；**字节等价搬运** DEFAULT_STYLE_PROMPT、mainPrompt 中文兜底（收拢为 `DEFAULT_MAIN_PROMPT` 单常量，narrator.ts:1979/:2077 引用）、LITE_* 13 常量（specialization.ts 改为 re-export 以不动消费点 import）；index.ts:190 改 import。
2. PR-P9b：compactionPrompt lite/full 提取共享片段（前缀 ~300 字符 + 后缀 ~383 字符 + sourceContract :2667 已共享）为私有常量，两版拼接结果**字节不变**；压缩/风格默认句的 index.ts:210/:213 改 import。
3. PR-P9c：4 个内联 prompt 函数（compactionPrompt/timelineDirectorPrompt/longArcGuidancePrompt/schedulePreplanPrompt/overlayCompactionPrompt）迁 prompts.ts；narrator.ts:1968-1971 缩进修复。
4. 每步跑 narrative-contract-snapshot 快照对照（字节等价验证）。

**验证**：`npm test`（快照 + narrative-prompts + positive-narrative-prompt）；`npm run typecheck`。

**回滚**：PR 粒度 revert。

**风险**：prompt 字节漂移 → 快照守护；specialization.ts re-export 保持现有 import 路径稳定。

**收益**：合约/文风修改单点化 + 快照守护；D2.5 平台词汇参数化获得统一落点；"清空配置后文风不一致"类用户可感 bug 根除。

---

### P10. logging 显式 action 双轨

**位点**：detectLogAction logging.ts:127-145（14 条中文正则）、logCategory :192-200、extractFields :202-216；reportOperation 定义 service.ts:7245-7248 + writeReport :7250-7280 + 宿主适配器 :995-996；action 枚举 15 值（logging.ts:6-8）；显式通道现状 = 仅 communication 信封（service.ts:7264-7272）；调用规模 163 处（分文件统计见取证）；`=%s` 惯例实为具体字段名（错误=%s 37、参与者=%s 16 等，`字段=%s` 字面 0 处）。

**目标设计**：
```ts
// 新入口（不破坏旧签名——变参阻断在尾部加参）：
// service.ts
reportAction(verbosity, level: ..., action: InterludeLogAction, story, phase, message, ...args) {
  if (!this.allowsVerbosity(verbosity)) return
  this.writeReport(level, story, phase, message, args, action)   // writeReport 加第 6 参
}
// writeReport：action 显式时跳过 detectLogAction；extractFields 仅在未提供结构化 fields 时兜底
// 宿主适配器（:995-996）暴露 reportAction 给迁出模块
```
渐进策略：新代码一律 reportAction；存量 163 处不批量迁移，加 debug 统计 fallback 命中比例；`reportCommunicationEvent` 信封通道保留。

**实施步骤**：
1. PR-P10a：reportAction + writeReport 第 6 参 + formatLayeredLog 的 input.action 优先（logging.ts:149 已支持 `input.action ?? detectLogAction`，改动极小）。
2. PR-P10b：host-contract 加 reportAction；迁出模块（intents/delivery/compaction 等高价值调用点约 40 处）先迁。
3. 迁移期间 logging.test.ts 补"显式 vs 嗅探同输出"对照用例组。
4. `extractFields` 的正则解码保留为兜底；结构化 fields 参数（可选第 7 参 `fields?: Record<string,string>`）随新调用点逐步启用。

**验证**：`npm test`（logging.test.ts + 新对照用例）；`npm run typecheck`。

**回滚**：reportAction 是纯增量；旧路径不动。

**风险**：双轨期间两条渲染路径输出必须一致 → 对照用例守护；低。

**收益**：
- 性能：显式 action 的日志省掉每条 14 连正则嗅探 + matchAll 字段扫描（热路径）。
- 以后构建：日志措辞与分类解耦，文案可自由改；结构化 fields 直接供 Console/桌面桥消费（对齐桌面 trace 关联方向）。

---

### P11. 杂项清理 + strictNullChecks 路线

**位点与步骤**：

| 项 | 位点 | 动作 | 风险 |
|---|---|---|---|
| 成对重复注释 | chat-artifacts.ts:41-53（逐字两遍）、:109-117；narrative-normalizers.ts 多处 | 机械删除 | 零 |
| 死参数 urge.commitUrge | urge.ts:74-75（`void _target; void _c; void _now`） | 签名删除 + 调用点 service.ts:4940 同步 | 零（编译器守护） |
| round-robin 无效自增 | narrator.ts:1015-1017 | `rotate(candidates, this.roundRobinOffset++)` 移入 failover.enabled 分支 | 零 |
| README tsconfig 漂移 | README.md:501 声称自包含 vs tsconfig.json:2 `extends ../../tsconfig.base.json` | 二选一：内联 base 配置实现真自包含（更符合承诺），或改 README；注意 include 差异 | 低 |
| 定时器回调兜底审计（F2） | sweep 等全部 ctx.setInterval 回调 | 确认回调体内有 try/catch（框架不接 uncaughtException）；无则补 | 低 |
| isContextDisposedError 文本匹配（F1 附注） | narrator.ts:33-40 | 框架无具名错误类；加注释标注依赖 message 形态 + 覆盖 "Context has been disposed"（timer sleep 的 reject 文案）与现有形态 | 低 |
| strictNullChecks 分批 | tsconfig 注释：125 处待修 | 按既有分批纪律：先 `strictPropertyInitialization`（构造器补齐）→ strictNullChecks 分模块（service.ts → narrator.ts → 迁出模块）→ 开关切换。每模块一个 PR | 中：125 处逐个人工确认是修缺陷还是加空值防御；禁止 `!` 断言滥放 |

**验证**：杂项每项 `npm run typecheck` + `npm test`；strictNullChecks 每模块迁移后全量测试。

**收益**：杂项消除噪音与文档失真；strictNullChecks 完成后，"投递账本/意图到期/游标"这类 null 敏感路径获得编译期保护——对提交核心路径是最高价值的类型投资。

---

### P12. Console 清单一致性 + overview 类型

**位点**：contract.ts:22-26 EDITABLE_STORY_KEYS（10 键）vs client/src/pages/ConfigPage.vue:26-43 SECTIONS 手写 FieldSpec（仅注释声明同步）；client/src/store.ts:49-87 `overview(): Promise<any>`；服务端 HdsiOverview 类型定义完整（console/contract.ts）。

**实施步骤**：
1. 新增测试 test/console-editable-keys.test.ts：正则提取 ConfigPage.vue 中 `key: '...'` 集合，与 EDITABLE_STORY_KEYS 双向对比（范本：console-config-center.test.ts 的钉法）。EDITABLE_RUNTIME_KEYS/EDITABLE_RESEARCH_KEYS 同款（对应页面的 runtime/research 残留分支若保留）。
2. client 改 `import type { HdsiOverview, ... } from '../../src/console/contract'`（vite alias 已支持跨层 import 类型？——`client/tsconfig.json` 有 paths 配置则直连；否则在 client/src/types.d.ts re-export）。store.ts 的 `overview(): Promise<HdsiOverview>`。
3. 顺带清理 ConfigPage.vue:109-113 的 runtime/research 残留分支提示语与 store.ts:3 死类型（配置中心上线后的过渡残迹）。

**验证**：`npm run build:client` + `npm test`；故意删服务端一个键确认测试红。

**回滚**：单 revert。**风险**：低。**收益**：配置中心后续加字段（多通道方向）不再有静默失效通道；客户端获得 IDE 补全。

---

### P13. 群冷却内存缓存（优先级已下调，理由见 N10）

**位点**：group-actions.ts:20-29；唯一消费点 turn-executor.ts:375（每防抖批次一次，先意愿门后冷却）；索引现实 F3（storyId/occurredAt 有索引，kind 与 metadata.groupId 无）。

**影响事实**：查询随故事表增长变贵（storyId 命中后仍需按 occurredAt desc 扫该故事全部候选行）；每次通过意愿门的批次付一次该成本。

**实施步骤**：
1. service 内存缓存 `groupLastOutgoingAt = Map<storyId, Map<groupId, number>>`；写钩子：appendEntry(kind='character-group-message') 与 updateScriptDeliveryOutcome 处更新（delivery/pipeline.ts:529-589 一带已有串行块内落账本点）。
2. groupCooldownActive 先查缓存（`Date.now() - cached < cooldownSeconds` 即 true）；缓存 miss 回退现查并回填。
3. 启动预热：首次查询才回填（lazy），避免启动全群扫描。
4. 清库钩子：invalidateBufferedNarratives / purge / clearDatabase 同步清缓存（与 X1 同点）。

**验证**：`npm test`（group-echo-gate / group-willingness / flush 相关）；断言冷却判定与现查结果一致。

**回滚**：缓存 miss 回退逻辑保证可随时关闭缓存。

**风险**：缓存与账本一致性 → 清库钩子同步清（X1 同款）；多进程不支持（ARCHITECTURE.md:124）无新增约束。

**收益**：长跑故事（数万条目）的批次成本从 O(条目数) DB 扫描降为 O(1) 内存读；SQLite 读压力下降。

---

### P14. 微清理打包

| 项 | 位点 | 方案 | 风险 |
|---|---|---|---|
| endpoint-registry 双分支重复 | endpoint-registry.ts:26-43 `.then(upsert, upsert)` 逐字重复 | `const write = async () => {...}; queue.then(write, write)`（enqueueEndpointWrite:19 已是正确范本） | 零 |
| turn-executor 重复字面量 ×5 | narrative/turn-executor.ts:133-158 | `obsoleteOutcome(requeue)` 工厂 | 零 |
| taskCurrent 守卫 ×12 | turn-executor.ts:500-579 | **不改**为包装器（守卫必须每步再查，代际可在任意 await 间翻转）；仅在函数头注释写明"每个 await 后必须复查"——保守正确 | 零 |
| 魔法数字预算 | narrator.ts:2364-2392（6_000/8_000×3/12_000）、:2497（1600）、:864（768）、:920（600） | `PROMPT_BUDGETS` 常量对象导出（与 context-density 档位表并列） | 零（字节等价） |
| mentionsBot 之外的 calibratedNativeFaceWillingness 中文正则 | chat-artifacts.ts:54-70 | 移入 specialization 档位数据结构（默认值保持现行为） | 低 |
| health 快照重复排序 | health.ts:100 | snapshot 100ms memo | 零 |
| history-recall 游标寄居 state.extensions | history-recall.ts:189-190 | 暂缓（涉及数据迁移，收益低）；注释标注寄居语义即可 | — |
| persistEndpointState 之外的 qface 表漂移 | qq-face.ts:9-20 | 接受（QQ 无机器可读表，注释已自认）；加版本字段便于后续人工刷新 | 零 |

**验证**：`npm run typecheck` + `npm test` 全量。**收益**：行为不变的噪音下降；PROMPT_BUDGETS 为密度自适应调参单点化。

---

### P15. service.ts 终局拆分

**前置**：P1（host-contract 就位）、P4（decide 参数对象化）、P5（persistDecision 已拆）。前置未完成时**不启动**。

**位点**：service.ts:7612 行；容器生命周期审计表（N3）；薄委托 163 个（N7）；测试宿主形态约束（N7）。

**实施步骤**（每步独立 PR，测试先行）：
1. **容器分组**：按域聚合 30+ 容器为 4 个 state 对象（字段→归属由 N3 审计表决定）：
   - `endpointRuntime`（endpointRows/endpointStates/endpointWriteQueue/endpointRegistryReady/storyAliasRows/storyAliasProblems）
   - `recallRuntime`（historyVectors/episodeIndexes/historyVectorsReady/Loads/Backfills/**Backoff 补清除点**/automaticRecallCache）
   - `backoffRuntime`（schedulePreplanBackoff/timelineBackoff/timelineDirectorFailures/pendingDeliveryRecoveryBackoff）
   - `groupRuntime`（bufferedGroupTurns/groupMemberName*/groupWillingness/**groupNarrativeSalience（含 X1 修复）**/interruptedTypingParticipants）
   每组提供 `disposeStory(id)` / `disposeAll()`；invalidateBufferedNarratives/invalidateStoryTasks/purge 路径改为调用组方法。
2. **委托类型化**（不删除，N7）：163 个薄委托体保持不变，签名经 host-contract 类型化；`typeof (this as any).serial` 测试桩防御（:2264/:2416）合并为一个私有 helper。
3. **decide 时间导演区**（:4173-4285 一带）与 tryDecide 恢复重写区（:4320-4426）随 P4 已对象化，本步只做文件级外迁（src/commit/timeline-director 编排），原型薄委托保留。
4. **配置区外迁**：service.ts:1-738 的 22 个 interface 迁到 src/config-types.ts（P8 镜像测试守护键集一致性）。
5. 终态目标：service.ts 降到 ~4000 行以内（编排 + 薄委托 + 容器组声明），行为零变化。

**验证**：每 PR 全量 `npm run typecheck` + `npm test` + `npm pack --dry-run`；特征化测试先行原则贯穿。

**回滚**：PR 粒度。

**风险**：最大的一项——因此放最后且必须前置完成；测试宿主依赖原型方法（N7）决定了"委托不能物理删除"的边界，若未来想删，需先批量迁移测试宿主到 deliveryHost 式类型化假宿主（独立后续项，不在本方案内）。

**收益**：review 粒度恢复文件级；容器生命周期获得统一 dispose 审计入口；为多进程锁/外部存储改造提供接缝。

---

## 5. 总路线图

### 依赖关系

```
X1 ──────────────────────────────┐（独立，随时）
X2 ──────────────────────────────┤（独立，随时；观测期 1-2 周）
P1 (host-contract) ──► P4 ──► P15 │
        │            │            │
        │            └──► P5 ──►───┤
        └──► P10(迁出模块部分)      │
P2 ───────────────────────────────┤（独立）
P3 ───────────────────────────────┤（独立）
P6/P7 ────────────────────────────┤（独立，随时）
P8 ──► P15(配置区外迁) ────────────┤
P9 ──► P4(systemPrompt 先集中后对象化更稳) ─┤
P11(strictNullChecks) ────────────┤（独立路线）
P12/P13/P14 ──────────────────────┘（独立，随时）
```

### 建议的 PR 序列

| 批次 | 内容 | 预估 | 说明 |
|---|---|---|---|
| 第 1 周 | X1、X2a（观测版 + purge 守卫）、P2a、P6、P7、P14（零风险项） | ~4 人日 | 全部低风险即修项；X2 进入观测期 |
| 第 2 周 | P1 前半（8 个小文件接口化）、P8、P12、P9a | ~4 人日 | 类型地基启动 |
| 第 3 周 | P1 后半（intents/delivery/compaction/endpoint-registry）、P2b、P3a/P3b、P13 | ~5 人日 | 类型地基完成；P2/P3 落地 |
| 第 4 周 | P4a（decide 对象化 + 3 测试同步）、P9b/P9c、P10a | ~4 人日 | 快照守护 |
| 第 5 周 | P4b（systemPrompt）、P5a（绑定助手）、P10b | ~3 人日 | |
| 第 6-8 周 | P5b-f（persistDecision 逐段迁移）、P11（strictNullChecks 分批启动） | ~8 人日 | 每段一 PR |
| 第 9-11 周 | P15（容器分组 → 委托类型化 → 配置区外迁）、P2c、X2b（固化） | ~10 人日 | 终局 |

总估约 38-40 人日（不含 strictNullChecks 的完整收尾与 X2 观测等待）。**每批次合入后跑一次 `npm run typecheck` + `npm test` + `npm pack --dry-run`，发布前按 release-consistency 测试流程走。**

### 明确不做 / 暂缓

- 由 Schema 自动推导 Config 接口（F6 不可行）。
- `metadata.groupId` 拆 dotted 独立字段加索引（F3：与整列 json 写入语义冲突）。
- 冷却跨重启持久化（P3c，价值低，无限期搁置）。
- 薄委托物理删除（N7：破坏 ≥6 个测试文件的原型宿主；如要做，需先迁移测试宿主，独立立项）。
- history-recall 游标迁表（收益低）。

---

## 6. 统一工程纪律

本方案的每一项都沿用仓库已验证的迁移纪律，实施时不得偏离：

1. **测试先行**：无特征化测试保护的区域不迁移。范本：inbound-gate-characterization、flush-executor-characterization、delivery-pipeline-characterization。
2. **薄委托 + 原型保留**：迁出模块以 svc 首参 + service 同名薄委托交接（N7 约束）；委托类型化而非删除。
3. **serial 三段式**：锁内快照 → 锁外模型/网络 → 锁内落库；模型调用绝不占故事串行队列（compaction/pipeline.ts:83-85）；本轮 X2 由范围删除入口唯一持有排队责任，serial 本身保持原语义；已处于串行域的显式调用继续沿用既有 runStorySerialized 约定。
4. **字节等价优先**：prompt/payload 改动以 narrative-contract-snapshot 快照为安全网；红了逐段比对而不是改快照。
5. **行号登记**：每完成一项，在本文对应条目标注「已实施于 <commit>」；commit message 记录迁移的源行号区间。
6. **结果五态保守主义**：任何新 I/O 路径沿用 pending/unknown/ambiguous 不自动重发、人工 verify 落终态的统一语义。
7. **观测期**：X2/P2/P3/P7/P10 的行为变化均先观测（日志计数）后固化，观测期不少于一周。
8. **验证命令统一**：`npm run typecheck` → `npm test` → `npm pack --dry-run`；Windows 下 SQLite 相关测试如卡编译先 `corepack yarn rebuild better-sqlite3`（README 既有提示）。

---

## 附录：取证来源索引

- service.ts 迁移地图（persistDecision 28 段清单、decide/tryDecide 调用面、容器生命周期表、163 委托清单、测试宿主形态、serial 42 点普查）：本轮取证代理 A。
- Koishi 框架取证（cordis Service/timer、minato 查询与索引、satori elements、console DataService、schemastery d.ts、sendMessage/middleware）：本轮取证代理 B。
- narrator/投递/logging/群冷却位点取证（systemPrompt 25 参实参分类、finish_reason 0 命中、cooldownUntil 7 点、prompt 搬运清单、reportOperation 形态、群冷却调用链）：本轮取证代理 C。
- 前两轮全库分析与二轮审查：本对话历史（2026-11-16）。
