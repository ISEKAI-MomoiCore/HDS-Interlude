# HDSI rc48 全量源码审查报告

- 审查日期：2026-10-10（Asia/Shanghai）。
- 对象：`koishi-plugin-hds-interlude` **1.0.1-rc48** 当前工作区源码。
- 源码根目录：`C:\dev\HDS-Interlude\plugins\hds-interlude\src`。
- 范围：代码正确性、异常/并发/生命周期边界、性能与资源使用、保持功能不变的局部实现简化。
- **本轮没有修复业务代码，没有改配置、版本号、数据库结构或打包产物。** 本报告是后续修改的依据，不是已修复声明。
- 不审查 webconsole 前端，不重新设计 HDSI 架构，不调整记忆形成/演化晋升的产品规则，不以文学风格或模型主观行为作为代码错误。

## 一、结论摘要

当前实现不是“之前修复全部无效”，但几个新增能力与旧路径的衔接仍不完整，尤其是 **pending 自动补偿加入后，原本仅作观察的投递账本已承担恢复依据，却没有同步收拢执行所有权与所有成功回执路径**。

最优先的三类问题：

1. **投递重复/确认缺失**：正常发送与补偿能同时执行同一段；跨群恢复会把原分段 1/2 写回分段 0；群回合生成的跨私聊消息没有调用成功确认。并非模型重复写作的问题，而是同一已写作行动在执行层仍可能被重复投递。
2. **持久化检查点不完整**：记忆整理先推进场景检查点，再写事实和发展提案；后半段写失败时，证据不再属于下一轮“新条目”。这是条件性但真实的数据完整性问题，不能通过改提示词解决。
3. **局部容器/调度错误**：共同作品历史裁剪替换数组后仍向旧数组追加任务；Scheduler 的 busy 重试可以复活已取消的唤醒、覆盖较新的定时器；浏览器并发槽在交接微任务之间会超额。

性能方面，最值得处理的不是泛泛“把大文件拆开”，而是：

- 历史图片按“成功张数”限制而不限制失败工作量，失效源多时串行回源拖长群回合；
- 每轮恢复读取整故事所有历史，且逐分段重复读取 split 意图；
- 召回每次重建历史导航，检查点匹配接近 `O(N × C)`；
- 后台整理的持久化阶段仍在故事 serial 内等待远程 embedding。

**建议保持现有叙事主体、单剧本、现有账本/意图/投递路径不变。优先收拢少数公共入口和索引映射，而不是继续为每个入口叠加独立判断。**

### 1.1 问题总表

证据标记：**复现**＝审查探针运行了当前实际方法/函数，受控 mock 重现错误；**静态确认**＝调用链或参数缺失在当前源码中可以直接确定；**条件性**＝只有特定失败、并发、配置或历史规模下发生，不代表每个实例已经发生。

| 编号 | 优先级 | 问题 | 证据 | 触发边界 |
|---|---|---|---|---|
| C01 | P1 | 正常发送与 pending 补偿可竞争同一分段 | 复现 | 正常投递尚未确认时触发恢复 |
| C02 | P1 | 跨群单段恢复覆盖原分段索引 | 复现 | 原分段索引大于 0 |
| C03 | P1 | 群回合跨私聊出站未确认成功 | 静态确认 | 群回合生成跨私聊消息 |
| C04 | P1 | 成功回执账本写失败被吞，后续恢复可能重复发送 | 复现账本失败；重复链静态确认 | 平台成功、本地 ledger 写失败 |
| C05 | P1 | 整理检查点早于事实/提案完整持久化 | 复现 | 后续写入失败/进程退出 |
| C06 | P1 | 共同作品裁剪后新任务进入旧数组，结果丢失 | 复现 | 终态任务超过 8 条 |
| C07 | P1 | 入站去重占位早于持久化，失败重放被跳过 | 复现 | 首次接收标记后、持久化前失败 |
| C08 | P1 | pending 恢复没有暂停/重置/世代一致性门控 | 复现暂停时仍尝试恢复；其他边界静态确认 | 桌面暂停或管理操作与恢复交错 |
| C09 | P2 | busy 唤醒重排复活/覆盖其他 wake | 两种时序复现 | fire await 期间取消或新增唤醒 |
| C10 | P2 | 显式主模型分配绕过冷却和 round-robin | 复现冷却；轮转静态确认 | useForMain 显式分配多个提供商 |
| C11 | P2 | OpenAI/Zhipu SSE 忽略 DONE，继续等 EOF | 复现 OpenAI；Zhipu 同型静态确认 | 网关 DONE 后不关闭响应体 |
| C12 | P2 | 流式路径不使用 provider.proxyAgent | 静态确认 | 依赖显式代理的提供商 |
| C13 | P2 | 浏览器槽释放后未保留交接名额，可超过并发上限 | 复现 | 等待者续执行前新任务插入 |
| C14 | P2 | 事实向量补齐只认可旧 embedding.model | 复现守卫；可用路由静态确认 | modelId/任务分配有效、旧 model 为空 |

P1 表示消息重复、消息/生成结果丢失、完整性或暂停控制失效，宜优先修复；P2 表示局部行为、延迟、资源边界或配置有效性问题。优先级不等于发生频率。本轮没有确认 P0。

## 二、方法、覆盖范围与验证边界

### 2.1 源码基线

- 枚举了 `src` 下 **52 个 TypeScript 文件，共 25,830 行**；`service.ts` 12,213 行，`narrator.ts` 2,612 行。
- 现有测试文件 **81 个**。
- 采用全量文件清单与风险扫描，重点深入入站→回合→提交→投递→确认→重启恢复、后台整理与历史召回、模型路由与 SSE、调度/暂停/资源释放。
- 小型纯策略模块主要检查数据归一化、集合/边界/时间处理及现有测试；大型模块按关键调用链审查。**这不等于对 25,830 行每一条分支均完成形式化证明。**
- 工作区没有可用的 Git 提交基线，本报告以实际源码行号和 SHA-256 清单锚定，不虚构 commit ID。此前已在本工作区存在的修复未回滚。

### 2.2 本轮实际执行的验证

| 验证 | 结果 | 边界 |
|---|---|---|
| 现有全量测试 | 682 项：678 通过、0 失败、4 跳过 | 不是新增问题的覆盖证明 |
| 严格 TypeScript 检查 | 通过，退出码 0 | 包含 noUnusedLocals / noUnusedParameters |
| 审查专项探针 | **14 项通过**，均断言当前缺陷/边界行为 | “通过”表示问题复现成功，不是修复验收通过 |
| 历史导航合成基准 | 5k/10k/20k/40k 条、各 7 次测量 | 不代表真实实例端到端延迟 |
| 真实 QQ/OneBot/模型/代理联网测试 | 未执行 | 没有调用真实服务或制造用户消息 |
| 真实重启/数据库断电/多日长稳/内存剖析 | 未执行 | 注入失败与受控交错代替生产故障 |
| 重新 build / 发包 | 未执行 | 本轮不修改业务源码，没有必要更新 lib |

探针使用真实原型方法和纯函数，数据库、平台与定时器为受控替身。C01 的探针重现两个 sender 调用同一传输；真实 serial 的作用域由静态调用链核对，未声称完成平台级端到端重复测试。C08 的探针验证暂停状态未阻止恢复尝试；是否实际投递还受端点/宿主外部门控影响。

### 2.3 证据文件

- [审查探针源码](C:/dev/HDS-Interlude/temp/full-code-review-probes.test.ts)
- [审查探针运行日志](C:/dev/HDS-Interlude/temp/full-code-review-probes.log)
- [全量测试日志](C:/dev/HDS-Interlude/temp/full-code-review-tests.log)
- [严格类型检查日志](C:/dev/HDS-Interlude/temp/full-code-review-typecheck.log)（成功时无诊断输出）
- [性能基准源码](C:/dev/HDS-Interlude/temp/full-code-review-perf.ts)
- [性能基准结果](C:/dev/HDS-Interlude/temp/full-code-review-perf.log)
- [源码行数与 SHA-256 清单](C:/dev/HDS-Interlude/temp/full-code-review-inventory.json)
- [流式内部函数暴露脚本](C:/dev/HDS-Interlude/temp/full-code-review-stream-expose.cjs)：仅把内存读取的源码加审查 export 后编译到 temp，**没有改原 narrator.ts**。

## 三、代码正确性问题详解

### C01 · P1 · 正常发送和 pending 补偿没有共同执行所有权

**位置**：[service.ts][S] L1028–1069、L1120–1168、L4178–4187、L6788–7000。

普通私聊回合在 serial 内完成剧本/账本提交，随后释放 serial，再执行 `sendOutgoingMessages()` 和成功确认。账本此时已经是 pending。恢复扫描仅用 `pendingDeliveryRecoveryRunning` 防止“补偿与补偿”重叠，无法识别普通发送正在处理同一分段。

恢复在自己的 serial 内重读 pending，但普通发送的打字等待和平台调用在 serial 外。重读并不建立发送所有权；只要首个发送尚未确认，恢复可再次发送相同段。

**复现**：让普通 `bot.sendMessage` 停在一个受控 Promise，再调用真实 `recoverPendingDeliveryCandidate`；同一 event/bubble 的传输调用计数从 1 变成 **2**。不是两个 commit 各写一次，而是同一个已持久化行动被执行两次。

**影响**：上线恢复、启动 10 秒恢复或周期恢复可以与活跃回合重叠。私聊首段补打字等待让窗口更明显；群消息执行层同样缺乏所有权。`hasPendingNarrative` 可以减少碰撞，但单靠它不是完整修复，因为发送在途和叙事在途不完全同义。

**最小策略**：以现有 `scriptEntryId + commitId + eventId + bubbleIndex` 为键，使普通发送、split、恢复在同一执行入口获得/交还单段所有权，并在执行前重读终态。所有权至少覆盖传输和成功确认，不应在平台 Promise resolve 时立刻释放。可以是当前服务中的一个小型局部集合/Promise 表，不需要新数据库表、新第二发送器或把整个模型请求放进故事锁。

**验收**：模拟打字等待、平台 await、确认 await 各阶段；同时在线恢复与周期恢复只能调用一次 transport；失败释放所有权、恢复仍可继续；不同分段/不同故事不被不必要串行化。

### C02 · P1 · 跨群恢复的传输局部索引覆盖原账本索引

**位置**：[service.ts][S] L1102、L1133、L1152–1159、L6755–6784，特别是 L6773；L7152。

恢复候选保存原 `segment.index`，例如第二段 index=1。恢复构造单段消息后，群传输重新拆分单段，回执局部 index 从 0 开始。`sendCrossGroupMessage` 写账本时：

```ts
{ ...message.scriptEvent, segmentIndex: segment.index }
```

显式 segmentIndex=0 的优先级高于原 bubbleIndex=1。原第 0 段已 delivered 时，终态不可逆保护使更新成为空操作；第 1 段保持 pending。

**复现**：账本第 0 段 delivered、第 1 段 pending；模拟第 1 段群发送成功，实际调用成功一次，但第 1 段仍 **pending**。

**影响**：恢复再次扫到同一段，可能形成持续重复投递。增加回退次数或冷却只会降低重复频率，不修根因。

**最小策略**：明确区分“原事件分段序号”与“本次 transport 的局部序号”。完整事件批量发送保持 0..n；恢复单段回执映射回它原本的 index。成功消息条目的 `deliverySegmentIndexes` 也用同一映射，避免账本修正而历史回执索引仍错。

**验收**：完整三段群投递、只恢复第 1/2 段、部分成功、不同 separator、禁止群目标分别覆盖；恢复成功后第二次扫描 transport 调用为 0。

### C03 · P1 · 群回合的跨私聊消息丢掉投递结果，没有成功确认

**位置**：[service.ts][S] L2641–2660、L2724–2726；对照 L4186–4187、L6727–6729、L7005 起的 `confirmOutgoingDeliveries`。

群回合对其他会话的消息执行：

```ts
if (result.messages.length) await this.sendOutgoingMessages(snapshot.story, result.messages)
```

返回的 delivered 数组被直接丢弃。私聊分支只执行 transport 并把消息放入返回数组，不会自行追加 character-message 或把账本写成 delivered。群分支自己记账，因此问题特指群回合生成的**跨私聊**出站。

**静态确认**：这一调用点之后没有 `confirmOutgoingDeliveries`；其余正常私聊、advance 等调用点按返回结果确认。

**影响**：目标私聊已经收到，剧本账本仍 pending、成功 character-message 缺失，后续恢复可能再发送；多段回复的 laterSegments 也没有从成功确认点转成 durable split 意图。无需数据库故障即可触发。

**最小策略**：该调用点接住 delivered 并走现有确认入口。随后把相同的“send → confirm”二行模式收拢成一个小辅助入口，防止后续遗漏。不要让 groups 被重复确认，不要把失败消息也确认成功。

**验收**：群回合产生跨私聊两段：第一段只投递一次且落成功条目，第二段只入队一次；恢复不重复第一段；跨群目标保留当前内部确认机制。

### C04 · P1 · 账本写失败仍被按旧的“仅观察”语义吞掉

**位置**：[service.ts][S] L7017–7024、L7145–7176；L1121–1131。

正常确认先追加成功 character-message，再更新 ledger。`updateScriptDeliveryOutcome` 捕获所有异常并继续；其注释仍称 M6.1 observational。此前不自动恢复时，这可能只是诊断缺失；现在 pending 扫描会把未更新的 ledger 当成尚未执行。

**复现**：对 ledger 的 `dbSet` 注入失败，方法不向调用方抛出，仅记录告警，原分段仍 pending。恢复候选选择和候选重读均未先查相同 event/bubble 的既存成功 character-message，因此这条成功消息仍可被补偿发送。

**最小策略**：在现有成功记录与 ledger 之间进行同键对账；已有成功回执条目时，恢复只补记 ledger，不再调用 transport。把账本写入结果做成显式结果而不是“没有抛错即全部完成”，区分“发送失败”“确认存储失败”“平台结果未知”。

**边界**：不能通过盲目把所有 ledger 写失败抛成普通叙事失败来修复，这会触发整轮重试。外部平台已接受而本地任何回执尚未落库就退出的窗口，若无平台幂等键，**不能保证端到端 exactly-once**。成功记录可补偿已知成功，不等于能推断所有未知结果。宿主可用 intentKey 时应保留，但不能据此替 OneBot 路径做无证据的保证。

**验收**：成功条目存在/不存在、ledger 更新失败、确认后管理写入失败、进程恢复分别注入；有既存成功证据的分段绝不再次 transport；不确定结果的处理策略必须明确而不是隐藏在 catch 内。

### C05 · P1 · 整理检查点先于事实与发展提案落库，失败会跳过证据

**位置**：[service.ts][S] L9575–9580、L9782–9797、L9798–9828、L9902–9925；L7801–7805、L7868–7878。

`persistCompaction` 的顺序：更新 arc → 更新 scene（含 `lastEntryId` 和累加 `entryCount`）→ 可关闭场景并建立下一场景检查点 → 其他状态 → facts → statePatches。

下一轮 `prepareCompaction` 按 `id > scene.lastEntryId` 选择新证据。后面的 `persistFact`/`persistStatePatch` 或状态 DB 写失败时，外围记录 backoff，但检查点已前进。失败不会把检查点退回，也没有保存本次未完成决策用于继续提交。

**复现**：输入第 10 条新证据，scene/arc 写成功，`persistFact` 注入异常；最终方法抛错，但 scene.lastEntryId 已经是 **10**。检查点核验只是验证“已经前进”，不能证明该批事实/提案全部提交。

**影响**：某批长期事实或 overlay 提案永久错过“新条目”资格；原文未必被删除，后续普通召回也可能仍看得到，但后台增量整理不会按同一批新证据可靠重做。此问题可以解释**发生存储失败时**的漏产物，不能据此断言所有“多天无事实”反馈都由它造成。

**最小策略**：把增量检查点定义为“该批已通过现有规则的持久化输出全部提交后”的最终确认。若现有数据库适配层具备合适事务能力，可在原执行体内包住 DB 提交；不使用事务时，应先确认现有事实/提案的同来源重放幂等性，再让所有输出先落库，最后推进检查点/关闭场景。模型调用和远程 embedding 不放在事务里。

**不能只把 lastEntryId 机械挪到最后**：还要检查 scene.entryCount 重试时是否重复累加、场景关闭是否提前改变 activeScene、事实结算/替换和提案合并是否可同来源重放。已有 proposal 合并与 sourceEntryIds 可复用，不建议新增“记忆任务表”。

**验收**：对每个写入阶段注入错误；重试后每个有效输出只出现一次，未完成时新证据仍可处理；scene 边界和下一场景游标不提前消费；原有空/不完整摘要不消费检查点的修复继续有效。

### C06 · P1 · 共同作品裁剪替换 jobs 数组，新任务向旧数组追加

**位置**：[works.ts][W] L68–74、L109–120、L123–145。

```ts
const jobs = row.state.jobs ??= []
pruneTerminalJobs(row.state) // 终态 > 8 时重新赋值 row.state.jobs
if (jobs.length >= 32) ...  // 仍读旧引用
jobs.push(job)              // 新任务不在待保存的 row.state.jobs 里
```

**复现**：9 个终态历史任务后调用 generate；模型调用一次、返回 running job，但持久化 jobs 只有裁剪后的 8 个旧任务，找不到新 job。后台读回找不到 live job，生成正文不转成 proposal，结果丢失。历史恰好 32 条时还可能在已经裁剪后依旧按旧长度拒绝新任务。

**现有测试空缺**：works-review 中的裁剪测试断言返回 running、终态保留 8 条、数组不超 32，却没有断言新 job 真正存在、最终 proposal 生成，因此当前全量测试通过。

**最小策略**：保留幂等 operationKey 查找顺序，裁剪后重新取 jobs 引用再判断容量和追加；或者让裁剪 helper 返回新数组并且唯一使用该返回值。不需要新类/新状态机。

**验收**：0/8/9/30/32 个终态、混合 running、重复 operationKey、CAS 冲突；必须断言“新任务落库 → completed → 有且仅有一个 proposal”。

### C07 · P1 · 入站提前写 seen，接收失败后的重放被当成已成功

**位置**：[service.ts][S] 私聊 L2380–2417、L2429–2445；群聊 L2302–2317。

`seenIncomingMessages.set()` 发生在转发读取、端点更新、故事 serial 入库之前。一旦后续抛错，键留在内存中。下一次同 messageId 重放直接 `return true`，既不补落库也不进回合。

**复现**：第一次 readForward 注入异常；第二次相同消息，receive 返回 **true**，表示已接受，但处理阶段不再执行。这个容器有 600 条上限，不是永久内存泄漏；丢消息窗口持续到键被淘汰/进程重启。

**最小策略**：私聊/群聊共用一个小型入站去重入口，区分 processing 与 accepted。失败/未接受释放占位，已持久化成功才确认。并发相同 ID 应等待/共享同一次接收结果，不能简单把 set 挪到最后，导致两个并发接收都过关。

**次级条件风险**：当前键只含 platform+messageId，不含 selfId/通道。若某适配器消息 ID 仅在账号/通道范围唯一，不同账号可能误去重；本轮未证明实际 QQ 已碰撞。可按当前会话稳定身份构造键，但需保留桌面重放与原入站能对上的规则。

**验收**：入库前故障、入库后故障、串行/并行重放、跨账号同 ID、无 messageId；保证“返回 accepted”有实际持久化/已知既存消息的依据。

### C08 · P1 · pending 恢复没有继承暂停与管理作废门控

**位置**：[service.ts][S] L1028–1069、L1120–1159、L1188–1213、L1463–1468；恢复触发在 L976、L987、L1003。

恢复没有检查 `desktopRuntimePhase === 'paused'`、databaseResetting 或捕获/验证 taskGeneration。它按 DB 的 active story 获取候选，而桌面 runtime 暂停不会把所有 DB story 改成 paused。进入 serial 后也不重新验证最新 story/participant 状态。`canHandleParticipant` 只做账号白名单，不代表“参与者仍 active”。

**复现**：host.desktopRuntimePhase=paused 且有有效 pending，恢复仍进入候选执行一次。真实传输是否成功取决于端点/宿主；代码本身没有阻止该尝试。

**最小策略**：复用现有 taskGeneration/暂停/重置守卫，扫描开始先检查，进入 serial 后以及调用平台前再次检查当前状态，防止“扫描时 active，执行时已 pause/purge”的过期快照。暂停保留 pending，resume 按原有能力恢复；purge/reset 要按既有作废规则处理，不能把暂停简单记成送达或失败。

**验收**：pause 前/中、participant pause、story pause、purge/reset/删除、resume；取消未开始动作，不声称撤回已经到平台的请求。

### C09 · P2 · Scheduler busy 重排能复活取消或覆盖新定时器

**位置**：[scheduler.ts][SCH] L70–101。

wake 触发时先从 map 删除，然后异步 fire。fire 返回 busy 时直接建立 retry 并 `wakeTimers.set(storyId, ...)`。fire await 期间，cancelWakes 看不到在途 wake；新增 scheduleWake 也无法阻止旧回调的直接覆盖。

**两种复现**：

1. old fire await → cancelWakes → old 返回 busy：pendingWakeCount 又变为 **1**。
2. old fire await → 安排新 wake → old busy：map 只有一个条目，但新 wake 和旧 retry 两个定时器都活着，失去其中一个句柄。

**最小策略**：wake 实例/世代令牌核验；取消使在途回调失效；busy 重排走相同的 keep-earliest 仲裁，不绕过 scheduleWake 的取消/替换纪律。不是再加第三套重排 map。

**验收**：取消全部、取消单故事、新 wake 更早/更晚、fire throw、多故事；可存活 timer 和可追踪句柄一致，原 earliest 行为不变。

### C10 · P2 · 显式主任务 provider 分配跳过冷却/轮转

**位置**：[narrator.ts][N] L360–384、L448、L923–934；任务解析在 [model-routing.ts][MR]。

assigned 分支直接拿 route.providers，而冷却、round-robin、候选切片只在 `selectRouteProviders` 执行。失败会记录 cooldown，但下一轮 assigned 分支不读取它。

**复现**：显式分配 a/b；a 每次网络失败、b 成功；连续两轮调用顺序仍为 **a,b,a,b**，即使 a 有 10 分钟冷却。轮转设定也被相同分支绕过。route 本身已有 enabled/协议筛选，不应误报成“禁用 provider 也被使用”。

**影响**：可用 b 每轮都先等待故障 a；故障超时直接叠到用户延迟上。

**最小策略**：route 决定候选范围，统一一个选择函数负责冷却/排序/轮转。保留全部冷却时仍尝试、显式任务模型优先级、能力过滤、failover 关闭语义及已发 early reply 后不能另写一轮的规则。

**验收**：assigned 与 legacy/profile 路由、a 冷却/b ready、全部冷却、round-robin、failover false、音频协议不兼容、成功立即清除冷却。

### C11 · P2 · SSE DONE 不作为流完成，只等 EOF

**位置**：[narrator.ts][N] L1153–1154、L1211–1222；对照 [anthropic.ts][AN] 的 message_stop 处理。

两个解析循环都对 `[DONE]` 执行 continue。已读完正文后，如果响应 body 不关闭，方法继续 reader.read，直到总计时/idle 超时。

**复现**：真实 OpenAI 流函数读取合法 content + DONE，mock body 保持打开；onText 收到完整正文，但约 1 秒后抛出 `Streaming request timed out after 1000ms.`，不正常返回完整内容。调用方可把完整输出当失败，未提交 early reply 时还可能 failover。

**最小策略**：明确协议终止信号，停止继续等待并释放 reader/响应体；保留已经收集的 usage、正常 JSON 非流式回退、截断检查、early reply 生命周期。不要仅“忽略超时错误”，否则会把真正截断响应当成功。

**边界**：有些服务在 finish_reason 后继续发 usage，所以不能遇到任意 finish_reason 就提前截断。DONE 是本项确认的终止边界。Zhipu 主叙事首 token 后不使用总超时是代码明确选择，本轮不把它另列为漏参 bug，也不建议无授权统一改成短总超时。

**验收**：DONE 无 EOF、DONE 与最后 chunk 同帧、正常 EOF、跨 chunk 分隔符、usage 尾帧、abort、真正不完整正文；完成后不遗留占用的 reader。

### C12 · P2 · provider 代理只在非流式请求生效

**位置**：[narrator.ts][N] L891–908、L995–1007、L1109 起、L1188–1192；[anthropic.ts][AN] L89–101；[http-proxy.ts][HP]。

postChat 在 provider.proxyAgent 有值时使用 `postJsonViaProxy`。三类 streaming helper 直接 fetch，调用签名未携带 provider.proxyAgent，也没有从 postChat 复用 dispatcher。Zhipu sideTaskJson 在 L515 同样走流式分支。Embedding 的 [narrator.ts][N] L306–316 也未读取 provider.proxyAgent。

**静态确认**：显式代理配置没有到达上述 fetch/embedding 调用；这不排除部署环境有全局代理或透明网络转发。

**影响**：同 provider 普通请求能通，切换 experimental SSE 或官方 Zhipu 路径可能直连失败。若网络本身可直连则不一定暴露。

**最小策略**：只统一传输基础层（fetch、可选 dispatcher、headers、AbortSignal、清理），协议 payload 与 SSE parser 继续分开。已有代理 helper 可扩展响应流能力，不需要重写三种模型协议。Embedding 如按产品语义也应使用该 provider 代理，应走同一基础传输。

**验收**：普通/三种 SSE/embedding 的 explicit proxy 与 direct 模式、HTTP 错误、abort 后释放、API key/extraHeaders 不变；真实代理连通性本轮未验证。

### C13 · P2 · 浏览器并发槽释放与交接之间可插队超额

**位置**：[service.ts][S] L6257–6266。

释放先 browserActive-- 再唤醒 waiter；waiter 在之后的 microtask 才 browserActive++。期间新任务看见空槽并进入，已获唤醒的 waiter 不再检查也进入。

**复现**：maxConcurrentPages=1；A 执行、B 等待，A 结束并在 B 续执行前插入 C，观察到 browserActive 峰值 **2**。

**最小策略**：有等待者时直接交接已占用名额，不先减少；无等待者才减少。获取/释放使用同一小 helper，避免重复 if/补查循环。保持 FIFO、finally 释放和原有任务错误传播。

**验收**：峰值严格不超过 1/2/n，队列不饥饿，任务 throw 也释放，连续交接后计数回 0。

### C14 · P2 · 事实向量补齐的可用性判断仍只看旧 model 字段

**位置**：[service.ts][S] L9988–9996；对照 [narrator.ts][N] L294–307、[model-routing.ts][MR] 的 embedding 路由。

补齐守卫要求 `embedding.model?.trim()` 非空，而真正 embed 客户端支持显式 embedding provider 分配或 embedding.modelId。新路由有效但旧 model 为空时，实时 embed 可以有路由，历史事实补齐完全不启动。

**复现**：enabled=true、modelId='embedding-profile'、model=''、batchSize=5；实际补齐启动计数 **0**。

**影响**：过去漏向量的事实在有效新路由配置下不能补齐。不是“事实因此不可见”，而是缺少语义索引，不宜扩大成叙事记忆丢失。

**最小策略**：从已有统一 routing/embedding 客户端取得能力判断，不再让 service 单独解释旧字段。保持 enabled/batchSize、同故事去重和失败降级。

**验收**：旧 model、modelId、任务 assigned 三种配置都能启动；无路由、disabled 和 batchSize=0 不启动；失败不影响主回合。

## 四、性能与资源问题

### P01 · P2（极端失效源下高影响）· 历史图片失败工作量没有与成功上限联动

**位置**：[service.ts][S] L2731–2769、L2773–2792、L3816、L3844。

`historicalImageLimit` 限制的是 selected.length；回源失败不会消耗这个成功名额。所有不同失效 source 仍串行 await。当前图片载入另有 slice(0,3)，并非所有图片入口都无界。

**复现**：100 个互不相同、回源返回 undefined 的历史源，limit=1，实际 fetch **100 次**。

HTTP 单次 timeout 为 10 秒。假设有 300 个失效源且每个都耗满该 timeout，串行预算约 **3,000 秒（50 分钟）**；这是条件性算例，不是测得的线上耗时，且每条历史可包含多个 ref，300 条 lookback 不等于最多 300 个 refs。OneBot getImage 调用在该处没有额外本地 timeout，最终时限还取决于 adapter。

**建议分级**：

1. 较低语义影响：同轮去重保留；短期负缓存可避免相同过期源每轮重复回源，但暂时性失败的缓存 TTL 要明确。
2. 可以保持“最先成功的原序前 k 张”规则：有界并发回源，按原序消费结果，必要时中止多余请求；不要按最快完成顺序选图，否则改变实际选择。
3. 有限尝试次数/总 deadline 会让尾部仍有效图片不再被尝试，**不是严格等价优化**，须单独确认失败降级边界后再做。

**验收**：全失败、失败后成功、重复来源、超时、原序选择、当前与历史去重；记录 attempts / 成功数 / 总耗时，不能只把 warn 隐藏。

### P02 · P2 · pending 恢复读取全历史，分段重复读取 split 意图

**位置**：[service.ts][S] L1042–1043、L1137–1142。

- 每故事查询所有 script_entry，排序、完整 metadata 解码再 flatMap；即使没有 pending 也付出全历史读取。
- limit=32 只限制尝试发送次数，不限制 DB rows 或解析量。
- 对每个候选重新读取该参与者所有 split-message intents，未限制 status/数量；同一故事参与者的 32 段可能重复扫同一集合。
- 单扫描布尔锁避免同时多次扫描，但没有改变每次全量成本；force 还绕过 retry cooldown。

**最小等价优化**：用已有 DB API 做 ID 分页/最小字段投影；一次扫描内批量建立该故事/参与者 split ownership 索引并复用，需保留 pending 和 terminal reconciliation。若要做可重建 pending 索引，必须明确失效/重启重建，不能拿常驻新系统换掉一个全量扫描而声称“更简单”。

**禁忌**：仅取最近 N 条会漏旧 pending；仅查 pending intents 会漏账本存在但 intent 已消费的消息，退回本轮之前的重启丢失问题。

**验收**：10 万历史、0/少量 pending、旧 pending、终态意图对账；输出候选与原扫描一致，查询次数/峰值内存下降。真实数据库性能本轮未测。

### P03 · P2 · 历史召回重复构建索引，检查点扫描接近二次增长

**位置**：[service.ts][S] L3520–3550、L3571–3600；[episode-index.ts][EP] L17–25。

召回每次全量评分；构建 visible、排序并重建 episode index；每条记录用 checkpoints.find 匹配场景，成本 O(N×C)。候选邻域筛选又使用 episodeIds.includes，成本 O(N×E)。原文、vector、tags、lazy spans 常驻 cache，随历史增长；这是历史召回能力的资源成本，不能把任意截断历史当作等价优化。

**本轮合成基准**：Node v24.19.0、Windows x64，单参与者、每 20 条一个非重叠检查点，buildEpisodeIndex 预热一次再测 7 次：

| 原文条数 N | 检查点 C | 中位耗时 | 最小 / 最大 |
|---:|---:|---:|---:|
| 5,000 | 250 | 4.126 ms | 2.173 / 4.974 ms |
| 10,000 | 500 | 5.508 ms | 4.429 / 16.736 ms |
| 20,000 | 1,000 | 14.303 ms | 14.160 / 18.840 ms |
| 40,000 | 2,000 | 54.057 ms | 52.181 / 60.125 ms |

此基准**只测索引构建**，不包括 DB、embedding、评分、sort 和 prompt 拼接。54ms 单次并非严重生产故障证明，但与代码复杂度一起显示随档案增长的同步 CPU 风险；整个函数运行在同一 JS 执行线程。

**最小等价优化**：

- episode membership 用 Set 替代数组 includes；
- 同历史版本下缓存排序导航/episode membership，按现有 append/redact/purge/checkpoint 修改失效；参与者可见性和 excludeIds 仍逐次落实，不能泄漏不可见数据；
- 非重叠有序 checkpoints 可游标/二分；若允许重叠，必须保持当前“按输入顺序第一个命中”的优先级，不能直接换成任意最后/最近匹配；
- 长期内存用真实 heap profile 评估后，再决定分页或 lazy payload。保留全历史可召回能力，不引入未经确认的最近窗口。

**小边界**：automaticRecallCache 的 memo 主要看 cache 引用和 size；L3653 更新向量但 size 不变，短期 memo 可能仍返回旧排序。优化索引时应同时考虑内容/向量版本失效，不必再做独立缓存体系。

### P04 · P2 · 后台整理“便宜 DB 阶段”仍在 serial 中等待远程 embedding

**位置**：[service.ts][S] L7856–7869、L9912、L9950、L9972；[narrator.ts][N] L294–317。

模型 compact 调用已经正确移出 serial，但 applyCompaction→persistCompaction→persistFact 在 serial 内；缺向量或新事实会 await embedText，最终等待远程 HTTP。多个事实串行写入时，若 F 条事实各耗 T 秒，会在同故事关键段占用约 F×T 秒（只描述可能上界，不是实测）。用户入站/确认也依赖同故事 serial，所以“后台”不自动意味着不影响前台。

**等价建议**：复用已有三阶段结构，在 serial 外准备必要 embedding，重新进入 serial 后核验来源/世代/事实现状并写入；最终向量与原能力一致，不建议新增后台模型任务框架。已有缺向量补齐可用于失败降级，但“立即不写向量，只等以后补齐”会改变短期召回效果，不能冒充严格等价。

**验收**：慢 embedding 时同故事新入站不因远程调用长时间阻塞；并发新事实不会重复写，reset/purge 后旧准备结果失效；embedding 失败仍按原规则保存有效事实。

## 五、其他条件性风险与未升级为确定缺陷的观察

### R01 · 平台结果未知的重投边界需要单独定义

发送超时可能是“根本没到平台”也可能是“平台已接收、回执没回来”。现有 recovery 把某些失败保留 pending 后重试，不能只凭本地超时推断未送达。桌面宿主有 intentKey、QQ 平台路径未见可据此保证的平台端幂等协议。此处不提出自动取消所有不确定消息，也不提出无限重投；两者都是产品层损失/重复取舍。先修 C01–C04 的可知重复，再明确未知结果的审计/恢复规则。

### R02 · 先截故事窗口再过滤群，会使他处活动挤掉目标群上下文/冷却

**位置**：[service.ts][S] L2732–2739、L2795–2802。

groupMessages 先取整故事近 60..300 条，再过滤目标群；groupCooldownActive 先取全故事近 100 条再找目标群最近成功。目标群实际还有近期上下文/仍处冷却时，若大量其他群/私聊条目排在它前面，可以在窗口外消失。

这是可由查询顺序确定的条件性质量/门控风险，本轮未用真实多群 DB 复现。修复可在现有字段能力内按群分页直到足够匹配，或在数据库支持等价 metadata 查询时先过滤；不要盲目放大故事窗口。更完整群上下文与正确冷却是缺陷修复，会改变此前错误的结果，不列为纯机械等价简化。

### R03 · 代理连接复用有空间，但未实测，不建议贸然增加复杂常驻池

[http-proxy.ts][HP] 每次代理请求构造 agent 并关闭，握手复用有限。是否成为瓶颈取决于请求量、代理链路和 TLS。本轮没有测真实代理，因此只作为低优先级优化候选。若统一传输时顺带引入按代理地址受控复用，须确保 dispose、配置变化、Abort 与连接关闭；不要单为“少一次 new”增加难以维护的全局缓存。

### 不作为本轮 bug 的事项

- 文件大/方法多，不直接等于性能差，不建议借审查把 service 改为新架构。
- 事实全局进入主叙事、相关人由内容明确，是用户确认的主体原则，不重新引入 participantId 隐私过滤。
- 事实语义相近、模型是否生成提案、晋升需要跨场景/跨天证据属于产品/模型与既定规则；本轮不私自改阈值或添加自动语义记忆治理。
- 正常消息成功后才确认、durable split 意图拥有后段时序、到期承诺对 pending split 的让路应保留，不能为了“更短”删除。
- Qzone 的 ambiguous、动作不自动重放、桌面动作超时的未知结果是已有明确保护，不能把所有失败统一重试。
- Health 的 latency 数组已有 200 上限；入站 seen 集合有 600 上限；不能误报这两个容器为无限增长。
- Zhipu 主叙事不设固定总超时与 side task 有总 deadline 的区别是明确的现有选择；本轮只指出 DONE/代理缺陷，不暗改策略。

## 六、不改变功能的局部简化建议

下面把**纯等价整理**与**修复错误行为**分开。修复 bug 必然改变错误场景结果；所谓不动实际功能，指保留正常业务规则、对外配置/指令/叙事权威/成功语义，而不是把错误结果也冻结。

### S01 · 收拢成功确认入口，不增加第二发送器

- 目前多个调用点各写 send→confirm，C03 已经出现遗漏；group 内确认与 private 返回确认混在一个方法名下，也增加调用者负担。
- 保留原 transport 与确认实现，通过一个很小的 orchestration helper 接住结果并调用已有确认，显式说明 group 已内部结算，不重复记账。
- 所有权/成功对账可以围绕同一个现有 event key 放在这个入口；不为私聊/advance/split/recovery 分别写一套 in-flight guard。
- **保持**：端点硬路由、白名单、主动联系能力门控、quote、laterSegments、平台回执后才落成功条目。
- **预期收益**：减少遗漏路径与重复异常处理。不要预先承诺净减少多少行；需实现后实际 diff 衡量。

### S02 · 原事件 index 与局部 transport index 做一次映射

- 当前 bubbleIndex 与 segmentIndex 都可影响 ledger，C02 是同义字段混用造成的确定错误。
- 用现有 delivery/reference helper 做显式映射，正常全事件与恢复子集分别传入正确原 index；账本与成功条目共用。
- 不在 ledger 中再加第三个“真实索引”字段，不要求数据库迁移，不统一改写旧 metadata。

### S03 · Scheduler 所有 wake 重排走同一仲裁

- scheduleWake 和 busy retry 使用相同 token/keep-earliest 入口，消除 fire 尾部绕过仲裁的直接 map.set。
- cancellation 只失效该实例/世代，保留 exclusive/backoff 现有职责；不用把 Scheduler 重写为新的任务系统。
- 保持 earliest、busy 1 秒重试、exclusive 让路、错误回调。

### S04 · 模型路由解释只发生一次

- model-routing 决定任务候选和参数；narrator 一个选择函数应用冷却/轮转；service 的能力守卫基于同一结果。
- 处理 C10/C14，不再到处查看 useForX、modelId、旧 model 或自建可用判断。
- 不改变用户选中的 provider/model，不合并主叙事与副任务 timeout，不新增配置开关。

### S05 · 传输共用，协议解析不硬合并

- 统一 HTTP/SSE 基础请求选项、显式代理、Abort/释放；OpenAI、Anthropic、Gemini/Zhipu payload 和解析保持独立。
- 生命周期终止逻辑集中在相应 parser 的一个出口；避免每个分支都 copy 一组 setTimeout/finally。
- 不因抽 helper 丢失 usage、cache-first payload、DeepSeek thinking、提前回复已提交防 failover 等已有功能。

### S06 · 容器操作避免旧引用，局部 semaphore 采用交接

- works 裁剪后重新取数组；不把整个作品服务重写成泛型 repository。
- browser 槽位直接交接，少量变量即可修正；不引入外部队列依赖。
- 相同来源 Set/Map 在单次整理/恢复内部复用，代替重复 entries.some 与 split 查询；保持稳定顺序和相同来源上限。

### S07 · 历史导航做可重建派生索引，不修改原文与可见性

- episode membership、排序位置在已有 cache 生命周期内派生，版本一致时复用。
- Set 代替 includes 属于低风险局部等价修改；检查点匹配算法必须保留 first-match 优先级。
- 不改全局事实原则，不把召回变为“只剩摘要”，不砍全历史能力。

### 明确不建议的“为了简化而过度改动”

- 新建 outbox/记忆治理/后台调度数据库体系替换现有 script ledger 与 intent。
- 用“整故事大锁”包住模型、网络、打字延迟来消灭竞争。
- 把所有异常 catch 删除/抛出，导致已成功投递被主叙事重跑。
- 把所有自动恢复取消，回到重启后永久 pending。
- 全部协议统一为一个 JSON parser、全部 timeout 改同一值。
- 任意截断历史/限制只查最近消息而称“结果完全相同”。

## 七、建议修改顺序与回归设计

### 第一批：可直接局部修复的确定问题

1. C06 jobs 旧引用、C02 分段映射、C03 跨私聊确认遗漏。
2. C09 wake 实例仲裁、C13 browser 名额交接。
3. C10 主路由选择、C14 embedding 能力守卫、C11 SSE 正常终止、C12 代理传递。

这些项逻辑边界较窄，适合小 diff 与精确测试。不要同时做大面积文件搬移，以免掩盖修复证据。

### 第二批：跨生命周期完整性

4. C01/C04/C08 合并审视为“现有投递入口的所有权、可知成功对账、暂停作废”。
5. C07 统一私群入站接收状态，验证重放。
6. C05 整理持久化完整性，先证明重放幂等，再调整检查点及场景关闭顺序。

这些项需要验证交错时序，不能只看 happy path。未知平台结果的取舍单独确认，不顺手变更。

### 第三批：等价性能整理

7. P02 按扫描范围批量复用 split ownership、分批读历史；P03 Set/导航索引复用；P04 移出远程 embedding 等待。
8. P01 先验证原序有界并发，工作量上限/负缓存 TTL 若改变失败回退需明确确认；R02 群筛选窗口按业务正确性补齐。

### 最低验收矩阵

| 维度 | 必测组合 |
|---|---|
| 消息身份 | 相同/不同 commit、event、bubble，旧 metadata 缺字段 |
| 投递路径 | 普通私聊、advance、split、恢复、群回合跨私聊、跨群 |
| 交错点 | 写账本后/首段 typing 等待/transport await/成功条目后/ledger 后 |
| 生命周期 | 首次启动、在线事件、周期恢复、pause/resume、participant pause、purge/reset、dispose |
| 数据失败 | 每个 DB 写入点失败、CAS 冲突、重复完成、平台空回执、平台结果不确定 |
| 模型路径 | assigned/profile/legacy、冷却、轮转、extraBody thinking、native/audio、early reply |
| 流 | chunk 拆帧、DONE、EOF、尾 usage、代理、abort、完整与截断正文 |
| 性能 | 全失效图片、超大档案无 pending、旧 pending、并发浏览器、慢 embedding |

**测试质量改进重点**：返回 job 不等于任务已保存；append 调用成功不等于账本已经确认；有 pending 不等于未曾调用平台；检查点前进不等于整个整理批次成功。测试应沿“最终持久状态/实际平台调用次数”断言，而不只检查函数返回值和 mock 调用过。

## 八、复现命令

从 `C:\dev\HDS-Interlude` 执行：

```powershell
# 当前全量测试，不修改源码
node --import tsx --test plugins/hds-interlude/test/*.test.ts

# 严格类型检查
node node_modules/typescript/bin/tsc -p plugins/hds-interlude/tsconfig.json --noEmit --incremental false --composite false --noUnusedLocals --noUnusedParameters

# 只生成 temp 中的内部流函数审查束；原 narrator.ts 不变
node temp/full-code-review-stream-expose.cjs

# 这些断言刻意验证 rc48 当前错误行为。修复后应把断言改成正确行为再迁入正式测试
node --import tsx --test temp/full-code-review-probes.test.ts

# 只运行历史导航合成基准
node --import tsx temp/full-code-review-perf.ts
```

审查探针不能原样作为修复后的正式验收测试：例如它刻意断言 sends=2、pending 仍存在和 proposal 未生成。修复后这些断言应失败，随后应改成正确结果契约。

## 九、源码覆盖清单

说明：下表表示该文件属于本轮全量审查范围；“关键链深入”表示方法/调用者/生命周期有追踪，“策略/结构扫描”表示归一化、集合/循环、边界与现有测试结合检查，不表示已穷举所有输入或证明不存在其他问题。

| 源码文件 | 行数 | 审查方式 |
|---|---:|---|
| [agency.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/agency.ts) | 227 | 策略/结构风险扫描 |
| [alter.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/alter.ts) | 318 | 策略/结构风险扫描 |
| [anthropic.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/anthropic.ts) | 160 | 关键链深入 |
| [database.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/database.ts) | 278 | 关键链深入 |
| [delivery.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/delivery.ts) | 77 | 关键链深入 |
| [desktop-bridge.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/desktop-bridge.ts) | 460 | 关键链深入 |
| [endpoints.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/endpoints.ts) | 384 | 关键链深入 |
| [forward-message.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/forward-message.ts) | 251 | 关键链深入 |
| [gemini-interactions.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/gemini-interactions.ts) | 128 | 策略/结构风险扫描 |
| [group-willingness.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/group-willingness.ts) | 244 | 策略/结构风险扫描 |
| [health.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/health.ts) | 129 | 策略/结构风险扫描 |
| [http-proxy.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/http-proxy.ts) | 102 | 关键链深入 |
| [index.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/index.ts) | 1,434 | 关键链深入 |
| [logging.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/logging.ts) | 227 | 策略/结构风险扫描 |
| [long-arc.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/long-arc.ts) | 539 | 策略/结构风险扫描 |
| [meta.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/meta.ts) | 2 | 策略/结构风险扫描 |
| [model-routing.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/model-routing.ts) | 232 | 关键链深入 |
| [narrator.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/narrator.ts) | 2,612 | 关键链深入 |
| [processing-context.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/processing-context.ts) | 28 | 策略/结构风险扫描 |
| [qq-face.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/qq-face.ts) | 54 | 策略/结构风险扫描 |
| [qzone.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/qzone.ts) | 350 | 策略/结构风险扫描 |
| [schedule-preplan.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/schedule-preplan.ts) | 497 | 策略/结构风险扫描 |
| [scheduler.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/scheduler.ts) | 159 | 关键链深入 |
| [script/authored-actions.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/authored-actions.ts) | 117 | 策略/结构风险扫描 |
| [script/commit-builder.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/commit-builder.ts) | 253 | 策略/结构风险扫描 |
| [script/context-compiler.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/context-compiler.ts) | 212 | 关键链深入 |
| [script/continuation.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/continuation.ts) | 41 | 策略/结构风险扫描 |
| [script/continuity-checkpoint.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/continuity-checkpoint.ts) | 21 | 关键链深入 |
| [script/contract.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/contract.ts) | 96 | 策略/结构风险扫描 |
| [script/delivery-ledger.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/delivery-ledger.ts) | 161 | 关键链深入 |
| [script/delivery-reality.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/delivery-reality.ts) | 24 | 策略/结构风险扫描 |
| [script/development.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/development.ts) | 84 | 关键链深入 |
| [script/episode-index.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/episode-index.ts) | 75 | 关键链深入 |
| [script/intent-lifecycle.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/intent-lifecycle.ts) | 10 | 策略/结构风险扫描 |
| [script/knowledge-evidence.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/knowledge-evidence.ts) | 108 | 关键链深入 |
| [script/life-handoff.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/life-handoff.ts) | 51 | 策略/结构风险扫描 |
| [script/lived-writing.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/lived-writing.ts) | 5 | 策略/结构风险扫描 |
| [script/recall-navigation.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/recall-navigation.ts) | 70 | 策略/结构风险扫描 |
| [script/scene-frame.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/scene-frame.ts) | 222 | 策略/结构风险扫描 |
| [script/timeline-routing.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/timeline-routing.ts) | 17 | 策略/结构风险扫描 |
| [script/validator.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/validator.ts) | 35 | 策略/结构风险扫描 |
| [service.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/service.ts) | 12,213 | 关键链深入 |
| [share-sync.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/share-sync.ts) | 410 | 策略/结构风险扫描 |
| [specialization.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/specialization.ts) | 151 | 策略/结构风险扫描 |
| [story-state.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/story-state.ts) | 324 | 策略/结构风险扫描 |
| [time.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/time.ts) | 96 | 策略/结构风险扫描 |
| [turn-engine.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/turn-engine.ts) | 239 | 关键链深入 |
| [turn-persistence.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/turn-persistence.ts) | 49 | 关键链深入 |
| [types.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/types.ts) | 1,261 | 策略/结构风险扫描 |
| [urge.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/urge.ts) | 125 | 策略/结构风险扫描 |
| [works.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/works.ts) | 252 | 关键链深入 |
| [world-seeder.ts](C:/dev/HDS-Interlude/plugins/hds-interlude/src/world-seeder.ts) | 216 | 策略/结构风险扫描 |

## 十、最终边界

1. 现有测试全绿与上述缺陷并不矛盾：新增恢复能力改变了 ledger 的使用语义，而不少现有测试仍只验证局部调用或返回值。
2. 当前需要的是几处入口/确认/检查点的一致性修整，不是推倒重写叙事架构。
3. 本报告列的是代码及性能证据，不把配置偏好、模型叙事风格、记忆形成阈值伪装成程序错误。
4. 除本报告和 temp 审查证据外没有修改业务源码；最终再次核对源码 SHA-256 清单，确认本轮生成报告/验证未改变 src。
5. 静态审查与受控探针不能代替真实多日运行、平台幂等能力验证和生产 profiling；未发现更多问题不等于不存在更多问题。

[S]: C:/dev/HDS-Interlude/plugins/hds-interlude/src/service.ts
[N]: C:/dev/HDS-Interlude/plugins/hds-interlude/src/narrator.ts
[W]: C:/dev/HDS-Interlude/plugins/hds-interlude/src/works.ts
[SCH]: C:/dev/HDS-Interlude/plugins/hds-interlude/src/scheduler.ts
[MR]: C:/dev/HDS-Interlude/plugins/hds-interlude/src/model-routing.ts
[AN]: C:/dev/HDS-Interlude/plugins/hds-interlude/src/anthropic.ts
[HP]: C:/dev/HDS-Interlude/plugins/hds-interlude/src/http-proxy.ts
[EP]: C:/dev/HDS-Interlude/plugins/hds-interlude/src/script/episode-index.ts
