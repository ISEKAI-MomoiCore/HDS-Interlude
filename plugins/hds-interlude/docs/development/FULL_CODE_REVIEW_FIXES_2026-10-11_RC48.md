# HDSI rc48 全量审查逐项修复与交互验证报告

- 修复日期：2026-10-11（Asia/Shanghai）。
- 依据：[2026-10-10 rc48 全量源码审查报告](FULL_CODE_REVIEW_2026-10-10_RC48.md)。
- 对象：`koishi-plugin-hds-interlude` 当前工作区源码，包版本仍为 **1.0.1-rc48**。
- 本轮修改源码、回归测试和维护文档；**未打包、未更新 `lib/` 发布产物、未改变版本号**。
- 保留现有叙事架构、单剧本单人格、事实全局可见、既有端点/主动联系/分段/承诺规则；没有新增数据库表、第二发送器或记忆治理系统。

## 一、验收摘要

1. C01–C14 均已有对应代码修复及自动化验证。
2. P01–P04 按保持原业务语义的方式优化。P01 采用原序消费的有界并发，不引入会跳过有效尾部图片的尝试上限/总 deadline；P02 仍覆盖任意老 pending；P03 保留重叠 checkpoint 的 first-match 优先级；P04 在自动后台整理的既有三阶段中预备向量。
3. R02 已修复数据库筛选顺序，并以真实 SQLite 验证。R01 未知平台结果不能靠本地代码保证 exactly-once；R03 没有增加未经实测的常驻代理池。
4. 最终全量测试：**758 项，754 通过，0 失败，4 跳过**；严格 TypeScript 检查通过。跳过的是需要外部模型配置的四项 model-behavior 测试，不是本轮新增回归。
5. 暂停/恢复、清理/重置、正常发送/补偿、群分段/私聊、成功回执/失败账本、整理事务/前台入站等交互已纳入测试，未发现已覆盖场景下的相互干扰。**这不是对所有线上交错、适配器行为或真实崩溃的形式证明。**

## 二、逐项修复：代码正确性

| 编号 | 实现与保留的边界 | 主要验证 |
|---|---|---|
| C01 | 私聊、群回合跨私聊、自动推进、到期分段、pending 补偿及实验早发统一经过 `deliverOutgoingMessages`；以故事/源条目/commit/event 保留执行所有权，群批次和单段恢复共享同一 event 所有权。竞争者不在 story serial 内等待，避免等待确认的锁循环。 | 平台调用挂起、成功回执写入挂起两种竞争；只有一次实际传输，退出后所有权释放。 |
| C02 | 跨群批次的局部 index 只在公共入口映射一次：`原 index = bubbleIndex + 局部 index`。群成功条目用 `deliverySegmentIndexes` 记录实际接受的原索引集合，账本使用同一原索引。没有改写旧账本或引入第三种账本索引。 | 恢复 bubble 2 时不能写成 bubble 0；部分成功只记录成功段，下一轮只发送未成功段；真实 SQLite 查询成功索引。 |
| C03 | 群回合生成的跨私聊消息走同一成功确认入口，不再只有平台调用、没有 character-message 回执。群消息在原群确认流程结算，不重复调用私聊确认。 | 一次发送、一次成功条目、ledger delivered；再次进入入口不重发。 |
| C04 | 已知平台接受与本地持久化失败分开处理：先保留进程内 accepted 结果，再持久化成功条目，最后对账 ledger。持久化成功条目存在时优先对账，不重新传输。ledger 的日志降级保留，但不再成为重复发送的依据。 | ledger 写失败后清空进程内 map，使用 durable receipt 对账而不重发；receipt 插入失败后复用 accepted；取消账本后仍记录实际平台成功；群部分成功同样验证。 |
| C05 | 整理输出、事实、提案、故事状态、场景检查点/关闭/新场景使用现有数据库原生事务；检查点在输出成功后推进。通过 AsyncLocalStorage 使所有 DB helper 使用同一事务实例，事务内部不重复排入全局写队列。事务外读不观察 service 内的未提交中间状态。应用前核验 scene 状态与 frontier，陈旧快照不重复消费。 | 真实 Koishi + SQLite 在 tags、arc、fact、proposal、checkpoint、close、new-scene 七个阶段注入失败，整批回滚；重试一次完成，无重复事实；外部读取等待 rollback。 |
| C06 | 作品任务历史裁剪可能替换数组；容量检查与追加都重新使用 `row.state.jobs`，不继续写旧数组引用。原 operationKey 幂等和 running 任务阻挡保留。 | 0/8/9/30/32 条终态任务；新任务可持久化、执行完成并产生一次 proposal。 |
| C07 | 入站 seen 标记移至剧本落库成功之后；私聊/群聊在真实故事串行队列内再次检查内存和持久化证据，避免并发重放双写。去重包含机器人账号，新入站 metadata 保存 selfId，使同 canonical 参与者在不同账号的相同 messageId 不被混为重放。落库后的自动推进暂停辅助写入失败不会丢弃本轮叙事输入。 | 前置读取失败、append 失败后重放；并发重复、丢内存后重放、私聊/群聊跨账号、无 messageId；SQLite 实测 selfId 与缺失字段的兼容查询。 |
| C08 | 补偿启动、候选读取、split owner 读取后、实际投递和分段状态更新均核验运行状态/世代；意图更新带 `status: pending` 条件，不能覆盖取消状态。暂停使旧任务失效，但保留已成功平台回执；reset/purge 同时废弃旧内容世代，禁止旧确认复活清理内容。跨群持久化前也核验世代与源条目。 | 真正调用 `setDesktopRuntimePhase` 的暂停/快速恢复交错；确认排队后暂停与 purge；群首段成功后暂停、后段保持 pending；reset 后不落旧回执；owner 读取期间暂停不进行旧终态对账。 |
| C09 | Scheduler 在 fire 进行中保留 token；busy 重排和尾部删除必须仍拥有 token。取消后旧 fire 不能复活；新 wake 存在时旧 fire 不能覆盖/删除它。保持 earliest、原 busy 延迟及错误回调。 | cancel/new wake × busy/正常返回/throw 共六类时序。 |
| C10 | 显式主模型分配与旧路由统一经过 `selectRouteProviders`，使用相同冷却、全冷回退及 round-robin。原生音频协议能力过滤先于轮转/关闭 failover 截断，不把可用候选提前丢掉。 | 实际 decide 的 assigned 冷却、轮转、全冷、音频过滤及失败冷却。 |
| C11 | OpenAI/Zhipu SSE 识别 DONE，不再继续等待 EOF；EOF 时处理没有尾换行的剩余帧，正确跨 UTF-8/chunk 边界；finally 取消 reader。JSON fallback、usage、可见文本回调及原 timeout 差异保留。 | DONE 后不关闭 body、EOF 残帧、拆分中文字节/事件边界、usage、回调异常、普通 JSON。 |
| C12 | OpenAI/Zhipu/Anthropic 流式及 embedding 均落实显式 provider.proxyAgent。共用小型流式 transport wrapper，只统一传输/释放，不合并协议解析；direct streaming 继续使用原 fetch，direct embedding 继续使用 Koishi HTTP。 | 本地真实 HTTP CONNECT 代理与目标服务，三种 SSE 协议及 embedding 共四条 tunnel；校验授权/body；direct embedding 与向量格式验证。 |
| C13 | 浏览器并发槽释放时直接把名额交给 FIFO waiter；交接期间 active 不先减、waiter 醒来不再加，避免新调用微任务插队导致超额。 | 并发上限 1/2/4、交接时新请求、FIFO 和任务抛错；最终 active/waiters 归零。 |
| C14 | 事实向量补齐依据已解析 embedding 路由可用性，不再只读 legacy model。HTTP 前后核验世代，写入时匹配事实原 content/status；只补 embedding，不改变 updatedAt，避免召回的新旧排序被维护工作扰动。 | legacy model 为空但 assigned route 可用；reset 期间返回的旧向量不写；写入条件与时间字段断言。 |

### 2.1 为什么暂停与重置不能共用回执失效规则

最后交互审查发现：若暂停直接增加原全局内容世代，平台调用进行中已接受的消息会在返回时被当成陈旧任务丢弃，恢复后 pending 补偿仍有机会再发。

本轮没有重写任务系统，而是拆开两个已有目的：

- `deliveryGeneration`：全局清理世代 + 故事清理世代，判断旧内容/回执是否已被管理操作作废。
- `taskGeneration`：上述世代 + 暂停世代，判断是否允许旧任务继续启动新的工作。

因此暂停后的**未发送后段停止**，已知成功仍确认；快速暂停再恢复也不会让旧循环继续发送下一段。清库或故事 purge 则使旧确认无效。这个差异已用真实暂停入口测试，不仅是在 fixture 上直接赋值 phase。

### 2.2 成功、取消与未知结果

- 已知平台接受后，即使管理员/入站将 ledger 取消，仍应保存真实成功条目；取消终态不强制改回 delivered，不虚构取消能撤回已发消息。
- durable receipt 已存在但 ledger 仍 pending：只补对账，不发送。
- 平台返回已成功，但 receipt 插入失败：本进程保留 accepted 结果，下一次进入同一入口先确认，不发送。
- **平台已接受、进程却在 receipt 持久化前退出**，或平台已接受但本地仅收到超时：现有平台协议没有可靠幂等时仍是 R01，不能声称跨真实崩溃 exactly-once。
- 原实验早发回合直接接收公共入口的 confirmedEntries，不进行第二次成功确认。

### 2.3 入站历史兼容

新条目保存 selfId，持久化去重可区分不同机器人账号，内存 key 也包含账号。旧条目没有 selfId 时仍保守使用原参与者/平台/messageId 或群/messageId 证据，避免升级后重放旧消息。

**旧条目缺失账号归属无法凭空补全**：在极少数旧历史账号碰撞场景仍可能保守去重。没有进行猜测迁移，也不声称恢复了历史未记录的身份信息。

## 三、性能修复与等价边界

### P01：历史图片原序有界并发

- 每批最多 3 个唯一来源同时回源；同轮重复来源及当前轮已有来源不重复尝试。
- Promise.all 按来源顺序消费，选取的仍是**原序最先成功的前 k 张**，最后仍按原规则 reverse；不按响应速度选图。
- 维持成功上限 `min(limit, 6)`，失败继续寻找后面的有效图片，不设隐藏的 `2 × limit` 尝试上限或 15 秒总时限。
- 保存原分层失败日志，新增 diagnostic 完成日志：尝试数、选中成功数、耗时。
- 原序成功/失败/异常、全失败、当前与历史去重、逆序响应、远端有效尾部均有回归。

**限制**：这是消除串行放大并约束并发，不是总回源次数或整个操作时间的硬上限。达到成功上限前，全失败仍遍历全部唯一候选；一个批次可比原串行方案多取不超过两张未选中的图片。单次超时继续沿用原 fetch/adapter 能力，未额外改变 OneBot getImage 超时语义。若后续需要总 deadline/负缓存 TTL，应先确认它们会遗漏哪些有效图片，不能作为纯等价修改偷加。

### P02：恢复按脚本 ID 分页，复用 split ownership

- 仅查询 script 行，按 ID 升序分页，每页 256；不用一次加载故事的全部用户消息/成功回执。
- 一次故事扫描建立 split owner 索引，候选再按对应 owner ID 读取最新状态；保留 completed/cancelled owner 的终态对账。
- 一轮最多尝试 32 个候选，保留退避、故事状态/暂停/重置守卫和任意老 pending 的可恢复性。
- 不使用未经验证的复杂 JSON 数组谓词，不新增常驻 outbox 索引。

**限制**：不是 O(1) 增量恢复。没有候选时仍可能从 0 扫描全部 script，只是内存有界且无关行/重复 split 查询大幅减少。该权衡避免“只扫最近历史”重新引入旧 pending 永久丢失。

### P03：导航派生缓存与 checkpoint 索引

- audience 派生导航复用历史 cache 引用/size、可见 participant 与共享策略，至多 64 个缓存键。
- 缓存的是可见全集；每次再应用 excludeIds，避免首次请求的排除条件污染后续请求。
- Set 替代 episode membership 的数组 includes。
- 非重叠 checkpoints 可排序后二分；重叠时仍回退原输入顺序 find，保留“第一个命中”语义。
- append/redact/purge/checkpoint 对应的历史失效继续传递给派生导航；原地补历史向量时删除 automaticRecallCache，避免 size 不变留下旧排序。

**同机合成基准**：Node v24.19.0、Windows x64；基线备份与当前源码交替运行 11 次，热身 3 轮，比较非重叠 checkpoint 的 episode index 构建。所有规模结果一致。

| entries / checkpoints | 基线中位数 | 修复中位数 | 比值 |
|---|---:|---:|---:|
| 5,000 / 250 | 4.851 ms | 1.301 ms | 3.73× |
| 10,000 / 500 | 5.000 ms | 2.747 ms | 1.82× |
| 20,000 / 1,000 | 15.216 ms | 5.014 ms | 3.03× |
| 40,000 / 2,000 | 53.062 ms | 10.779 ms | 4.92× |

这些数值**只说明索引构建**，不是端到端叙事提速或线上 SLA；未设置脆弱的 CI 毫秒阈值。重叠区间故意保留慢回退。

### P04：沿用三阶段，自动后台整理向量准备移出 serial

- 自动后台整理 Phase 2 的模型/embedding 准备不持有 story serial，Phase 3 重进串行后核验世代与来源并完成事务。
- 同轮 normalized 相同事实只准备一次向量，已有相同正文有效向量可复用。
- 有效向量与事实一起在本轮落库；没有改成“先存无向量事实，等以后补齐”的短期召回降级。
- embedding 失败沿用原可选索引语义：有效事实仍可无向量保存，原 backfill 后续补齐。
- 最终落库按当时事实现状合并，保留已有非空向量；相同 knowledge clause 精确去重。

**覆盖范围**：自动后台三阶段已验证慢 embedding 期间同故事新输入能进入队列。手动 compact 原本就在调用方的 story serial 范围，仍保留原范围；本轮没有为手动路径重新设计三阶段，不声称所有整理都已移出锁。事务本身是短 DB 提交，不在其中等待远程 embedding。

## 四、局部简化与实现规模

| 原建议 | 本轮实际落点 |
|---|---|
| S01 | 一个 `deliverOutgoingMessages` 管执行所有权、已接受结果与成功确认；不是各入口分别新增一套发送器。 |
| S02 | 群局部 transport index 到原 bubble index 的单次映射；types 中 scriptEvent 复用现有 `ScriptMessageEventReference`。 |
| S03 | wake 生命周期围绕同一 token 仲裁；旧 busy 不再直接覆盖 map。 |
| S04 | 主任务选择复用模型路由与同一 provider selection，补向量复用 embedding route available。 |
| S05 | `withProviderStream` 共用 direct/proxy 传输和 agent 释放，协议 parser 保持各自边界。 |
| S06 | works 使用裁剪后的当前数组，browser 使用槽位交接；无新队列依赖。 |
| S07 | 导航为现有历史缓存的可重建派生值，不修改原文/全局事实原则/召回范围。 |

生产源码修改涉及八个文件：

- `src/service.ts`：投递公共入口、整理事务、入站去重、图片回源、历史导航及向量准备/补齐。
- `src/scheduler.ts`：wake token 生命周期。
- `src/works.ts`：裁剪后 jobs 容器引用。
- `src/narrator.ts`：模型选择、SSE 终止、显式代理。
- `src/http-proxy.ts`：小型流式代理 transport helper。
- `src/anthropic.ts`：接入相同传输、reader 释放。
- `src/types.ts`：复用原 script message reference 类型。
- `src/script/episode-index.ts`：不重叠二分/重叠 first-match 回退。

与本轮基线备份相比，八个文件合计 **730 行新增、422 行删除，净增 308 行**；其中 wrapper 引入也带来缩进 diff。不是净删行的修复，主要新增来自缺失的执行所有权、成功回执补偿、事务和派生索引边界。没有借此次整理把 service 拆成新架构，也没有为了行数删除既有安全门控。

## 五、交互验收矩阵

| 组合 | 断言与已验证结果 |
|---|---|
| 正常出站 × pending 补偿 × 同 event 的单段恢复 | 同一执行器所有权仍占用，竞争者不重发、不等待造成 serial 死锁。 |
| 平台成功 × receipt 插入失败 × ledger cancelled | 保留进程内已接受事实；恢复只记真实回执，取消终态不被改写成可重发。 |
| durable receipt × ledger 失败 × 内存丢失 | 使用成功条目对账，不再传输；群段覆盖索引一致。 |
| 群部分成功 × 单段恢复 × 原 bubbleIndex > 0 | 原索引不偏移，已成功段不重发，未成功段仍可补偿。 |
| 暂停/快速恢复 × 私聊在途 × 后续消息 | 首条已接受仍确认，旧任务后续消息停止；新世代可恢复剩余 pending。 |
| 暂停 × 群首段在途 × 后续群段 | 首段记录真实成功；后段未调用平台、保持 pending，resume 不重发首段。 |
| purge/reset × 已发送结果返回/确认排队 | 内容世代失效，不落旧回执；跨群源缺失不发送。 |
| split intent 已取消 × 传输返回/失败重排 | pending 条件更新不会覆盖取消；终态 owner 只对账，暂停读取交错停止旧对账。 |
| 入站重放 × 落库失败/辅助写失败 × 共享 canonical | 失败可重放、并发只写一次；同账号重放去重，不同账号相同 messageId 可独立接受。 |
| 整理事务 × 七阶段注错 × 外部读取/重试 | 不提交半套事实/提案/检查点，读取不泄漏中间值；重试保留原证据。 |
| 后台整理 × 慢 embedding × 前台新输入 | 远程向量准备不持故事锁；向量随本次事实入库，不改变即时索引语义。 |
| history cache × changing excludeIds × 原地向量补齐 | exclusions 不进入持久派生缓存，补向量失效旧召回 memo，可见性断言保持。 |
| assigned 路由 × audio × cooldown/round-robin | 能力过滤不误截候选；冷却和轮转适用于显式任务分配。 |
| proxy × SSE DONE/EOF/UTF-8 × 异常回调 | 正确解析与释放，proxy/direct 各走原期望通道；原超时策略不混并。 |
| browser FIFO × 新请求插队/异常 | active 不超过配置并发，释放不泄漏；与原 Scheduler 无新耦合。 |

## 六、验证文件、命令与证据

四个新增专项测试文件共 **73 项**：

- `test/review-delivery-regressions.test.ts`：16 项，投递所有权、receipt/ledger 失败、实际暂停/恢复、reset/purge、群原索引及 owner 交错。
- `test/review-sqlite-regressions.test.ts`：11 项，原生整理事务、读取隔离、receipt JSON、群查询、账号去重查询。
- `test/review-runtime-regressions.test.ts`：33 项，works、Scheduler、browser、入站、历史图片、恢复分页、导航、向量补齐与后台准备。
- `test/review-model-regressions.test.ts`：13 项，实际路由/SSE/direct/真实本地 CONNECT 代理。

另外补了 `split-follow-up-scheduling.test.ts` 两项旧世代/取消交错回归和 `p1-memory-navigation.test.ts` 一项原地向量失效回归。`test/helpers/delivery-host.ts` 只用于测试 fixture，生产代码没有检测 mock 后跳过事务或成功确认的分支。

旧 focused 测试相应更新 fixture：整理规则测试直接验证提取出的 outputs 方法，实际事务由 SQLite 专项测；投递 fixture 提供真实公共 gates 和源条目，避免为了旧 mock 绕开生产源检查。没有删除旧功能测试或把修复后的失败用 skip 遮盖。

从 `C:\dev\HDS-Interlude` 运行：

```powershell
node --import tsx --test plugins/hds-interlude/test/*.test.ts
node node_modules/typescript/bin/tsc -p plugins/hds-interlude/tsconfig.json --noEmit --incremental false --composite false --noUnusedLocals --noUnusedParameters
```

本地证据（不属于发布包）：

- `temp/rc48-review-fixes-tests-final.log`：758 / 754 pass / 0 fail / 4 skip。
- `temp/rc48-review-fixes-typecheck-final.log`：严格源码检查，退出码 0。
- `temp/rc48-review-fixes-perf.ts`、`temp/rc48-review-fixes-perf.log`：同机索引合成基准。
- `temp/rc48-review-source.diff`：本轮源码基线到当前的比较。
- `temp/rc48-review-fix-baseline/src`、`temp/rc48-review-fix-baseline/test`：修复前本地备份。

测试读取当前源码；模型测试在内存中编译私有函数，未用旧 `lib/` 证明新行为。审查时用于重现旧缺陷的临时 probe 不作为新修复验收。

## 七、R02 与未解决/未实机验收的边界

### 已处理 R02

群上下文和冷却先在 DB 按 kind + groupId 筛选，再 limit，避免大量其它私聊/群聊条目挤掉目标群。保留规范化后的 JS 防御过滤；查询覆盖 canonical、常用 group/guild 前缀和 finite numeric 历史 ID，避免 NaN 查询。

SQLite 回归建立 120 条更晚的其它私聊历史，目标群上下文/冷却仍正确。没有声称支持任意大小写前缀/空白的非规范历史值；此类值若实际存在，应按真实样本评估迁移。

### 保留的限制

1. **R01：未知平台结果/真实崩溃窗口**。receipt 持久化前的真实进程退出仍存在；没有平台端幂等就不能保证 exactly-once。本轮只修可知结果的本地重复，不自动取消全部未知消息，也不新建 outbox。
2. **R03：代理常驻连接池**。显式代理正确性已实测；是否值得复用连接尚无生产握手数据，不新增全局缓存/常驻池。
3. **P01：全失败仍有总工作量**。采用语义不变的并发优化，没有偷加可能漏图的总次数/deadline；adapter 自身不结束的调用仍取决于原 adapter。
4. **P02：无 pending 时仍需分页扫 script**。不声称扫描成本恒定，也不裁掉历史恢复范围。
5. **P04：手动 compact 保留原串行范围**。只有自动后台三阶段证明确保 embedding 准备不占故事锁。
6. **数据库验证覆盖 SQLite**。原生事务依赖 Koishi/Minato database.withTransaction；未逐一运行所有其它数据库后端的故障注入测试。
7. **运行环境验收未做**。没有真实 QQ/OneBot 多天长稳、真实 Koishi 进程 kill/restart、远程模型长时压力和生产 heap profile。内存丢失测试不是已执行真实进程重启的声明。
8. **发布产物未更新**。`package.json` main 仍指向 `lib/index.js`；如果实例直接加载旧 lib，本轮源码修复不会自动生效，需后续按发布流程构建/验包再部署。

## 八、结论

本轮优先把原本散落的发送/确认和整理提交边界收拢，修复确定的容器与生命周期错误，并在不改变叙事业务规则的前提下优化已有路径。对已覆盖的交互场景，全量回归及类型检查通过；对未知平台回执、真实重启窗口和未经实机验证的长期行为，保留明确限制，不以“全绿”承诺绝对无重复或绝对无干扰。
