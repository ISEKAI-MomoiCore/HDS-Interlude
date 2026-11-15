# 核心系统风险普查与复核日志（rc48 基线）

> 方法：三路并行 triage（模型 I/O 核心 / 回合引擎与心跳 / 记忆压缩与上下文装配），
> 每项含位置、风险假设、既有防御、严重度初判；随后逐批**现象复核**（亲自读码确认）
> 并修正，复核结论与修复记录持续更新到本文档。
> 本会话已修复、不再列入：分享码同步（rc48）、Agency 门控拦截补偿（rc47）、
> 表情包回源路由（rc47）、overlay 操作面+即时生效（两批）、指令层空格归一化、
> 特化提示词一致性、剧情弧清理/并发/预算（B1'~B3' 批，见 CHANGELOG rc48 待发段）。

## 状态图例

- ⬜ 未复核｜🟨 复核中｜✅ 复核属实待修｜🔧 已修复｜⚪ 复核证伪（有兜底/不成立）

---

## 批次一：回合边界与心跳（优先）

### B1 pause 穿透 in-flight 回合 🔧
- 位置：`service.ts:982-1006`（暂停实现）vs `service.ts:3871-3959`（flush 提交链）
- 假设：pause 仅取消定时器 + bump generation；模型调用中的回合恢复后仍 persistDecision、
  推进 cursorAt、sendOutgoingMessages 对外发消息。generation 失效只覆盖 advance/compact
  （4005/4023），不覆盖 flush 主链；flush 入口 3770 的 paused 检查仅挡"新开始"。
- 既有防御：narrating 软门；serial 写序。
- 严重度：高（暂停语义穿透 + 对外副作用）。

### B2 urge 读-改-写在故事串行队列外 🔧
- 位置：`service.ts:6784-6792`（recordAutomaticDelivery 内两次 getStory→dbSet），
  调用点 4202/6095 位于 sendScheduledMessages/分段投递路径（advanceStory 的 serial 已释放）。
- 假设：投递确认与排队中的 receive/advance（同样写 automation/extensions）交错 →
  丢失更新：urge armed/burst 或 nextAdvanceAt 被旧快照覆盖（多排/漏排心跳）。
- 既有防御：dbWrite 单写队列保证写不并发（不保证 RMW 原子）；normalizeUrgeState 钳制。
- 严重度：高（直接打心跳节拍）。

### B6 resume 孤儿回合（有消息无定时器） 🔧
- 位置：`turn-engine.ts:180-187`（rescheduleTimers 跳过 inFlightRequestId 非空的 turn）
  + `161-178`（endFlush 清理不为遗留 messages 补定时器）。
- 假设：暂停时一条消息正在 flush、又有新消息入队（其 timer 被取消）→ resume 时
  因 in-flight 未结束跳过重排 → in-flight 结束后该 turn 有 messages 无 timer，永久滞留；
  hasPendingNarrative 视其为 pending 反而阻塞后台 advance。
- 既有防御：注释明确只重排"已持久化"回合。
- 严重度：中。

### B4 群回合跨 await 持锁 + 暂停无复查 🔧（暂停复查已修；跨 await 持锁为既有设计,私聊 250ms 重试可接受,不动）
- 位置：`service.ts:2305-2320`（flushGroupTurn 声明 narrating 直到模型调用结束）。
- 假设：群回合模型调用耗时长 → 私聊 beginFlush（turn-engine.ts:150）250ms 空转重排；
  暂停期间群回合在 2307 检查通过后继续跑完提交（与 B1 同构，群侧无后续复查）。
- 既有防御：narrating claim-before-await 设计正确；revision 早退；serial 兜底写序。
- 严重度：中。

---

## 批次二：模型 I/O 韧性

### A2 Zhipu 流式无总超时（单点冻结） 🔧
- 位置：`narrator.ts:1073-1126`；主叙事 zhipuOfficial 强制此路径（:970）且忽略 route timeout。
- 假设：首 token 45s 守卫之后，网络半开/网关挂起 → reader.read() 永久 pending →
  decide 的 failover 循环走不到下一 provider，整回合卡死，无自愈。
- 既有防御：首 token 守卫；畸形帧/[DONE] 容错；注释声明"长思考不设总限"是有意的。
- 严重度：高。

### A4 主叙事无"去 cap 重试"；OpenAI 兼容不看 finish_reason 🔧
- 位置：`narrator.ts:1370-1376`（chatTextCandidates）、:1161（流式解析）。
- 假设：思考型模型（Zhipu 强制 thinking :974、DeepSeek thinking）+ 小 mainMaxTokens →
  同 cap 重复失败满 attempts；sideTaskJson 的去-cap 重试（:505-518）仅覆盖侧端任务。
- 既有防御：截断 JSON 只接受含 `"script":` 的子对象（:1320-1323）。
- 严重度：高。

### A3 early-reply 半提交 ⚪（复核证伪：兜底完整）
- 位置：`narrator.ts:418, 956-1002`；anthropic.ts:147-149。
- 假设：实验流式 onEarlyReply 已把可见回复发出（earlyReplyCommitted=true），随后流断
  → 抛错不重试（防副作用重复，正确），但也无降级补全 script/账本——回复可见而
  剧本未落账，一致性依赖 turn-engine 侧兜底（兜底路径本身待审）。
- 既有防御：commit 布尔约定（:393-397）；extractEarlyNarrativeReply 只收完整闭合字段；
  reconcileTransportReferences。
- 严重度：高。

### A1 assigned 主叙事路由绕过冷却 🔧
- 位置：`narrator.ts:380/424 vs 894-899`。
- 假设：assigned.length 时 providers 直取，:424 写入的 cooldownUntil 对 assigned 不生效；
  故障 provider 每回合满 maxAttemptsPerProvider 重试无抑制。
- 既有防御：成功清冷却（:414）；全冷却时保留候选防饿死（:899）。
- 严重度：中。

---

## 批次三：记忆管道数据安全

### C1 空压缩仍推进检查点（原文永久失摘要） ⚪（复核证伪：断言早已防护）
- 位置：`service.ts:9305-9311`（persistCompaction）；SilentCompactor `compact()→{}`。
- 假设：压缩模型不可用时 decision 为空但 sceneCompactionDue=true 照常执行：
  summary 保留旧值而 lastEntryId 前移 → 下次按 id>lastEntryId 过滤，这批原文
  永远不会再被压缩；滑出 recentEntries 窗口后只剩语义召回可捞。
- 既有防御：throw 路径有 fingerprint backoff（:7355）与 checkpoint 回退（:7365），
  但"成功返回空"不触发。
- 严重度：高（与 C2 叠加 = 内容永久脱离所有上下文路径）。

### C2 prepareCompaction 不过滤 redacted 墓碑 🔧
- 位置：`service.ts:9093`（entries）、:9110（preceding）。
- 假设：purge 软删后的墓碑条目进入压缩输入——占 compactionEntryLimit/字符阈值、
  进模型输入、作为 entries.at(-1) 推进 lastEntryId。
- 既有防御：recentEntries/recentEntriesForPrompt/desktopTimeline 均已过滤（此处漏）。
- 严重度：中。

### C3 语义召回盲区与静默降级 ⬜
- 位置：`service.ts:3311-3317`（identity 不匹配→semantic=undefined）、:3297、:3383-3385。
- 假设：更换 embedding 提供商后旧 vector 全失效，lexical<0.12 且无 tag/source 的条目
  直接漏；backfill 每次仅 5 条/20s；cache 加载失败静默空。
- 既有防御：多车道降级 + 60s backoff；cosine 空数组安全。
- 严重度：中。

### C4 recentEntries 条数截断可挤出原始剧本 ⬜
- 位置：`service.ts:1633-1648` + `narrator.ts:2232-2271`。
- 假设：count 查询只取最新 N 条，更早的原始剧本即使 12k 字符预算有余也被丢；
  protected 窗口外无 scene summary 兜底注入。
- 既有防御：时间窗合并（≤500）；soft budget 保窗口边缘完整条目。
- 严重度：中。

---

## 低优先杂项（暂列不复核）

- A5 usage 逐 chunk 累加可能双计；OpenAI 流式未设 include_usage；各 narrator 实例
  cooldownUntil 割裂（主叙事熔断不影响压缩打同一家）。
- A6 proxyAgent 仅覆盖 postChat；流式/嵌入直连。
- B3 sweep/wake TOCTOU + narrating 挂死时 wake 每秒无限自旋（scheduler.ts:84-89）。
- B5 平台时间未钳制直写 occurredAt；NTP 跳变对 nextAdvanceAt 的影响（sweep 兜底）。
- C5 story-state 编码即迁移静默丢弃旧 sceneFrame 子字段（一次性不可逆）。
- C6 cacheFirst 稳定区粒度不足导致前缀缓存 miss（纯成本）。

## 普查确认健康的部分

endpoints.ts（纯函数+防御归一化）、database.ts 迁移（只增不改）、定时器清理
（ctx.setTimeout 绑上下文）、cacheFirst 缓存区一致性、world-seeder 校验闸。

---

## 复核与修复日志

### 2026-10-08 全量修改自查（扫尾批）✅

对 rc48 之后累计的全部改动（src 9 文件 + test 7 文件 + 文档）做交叉复查，发现并修复 3 处遗漏：

1. **B2 修复不完整（真 bug）**：recordAutomaticDelivery 此前只把 urge 段包进串行域，
   **summaries 段的 getStory→dbSet(state) 仍在域外**——同源竞争、同样会旧快照覆盖
   story.state。重构为整个记账体（urge + 摘要合并）统一条件包裹（inSerial ? 直接执行
   : serial 入队）；m10 测试裸桩补 inSerial 降价方法。另核实 scheduleUrgeAdvance
   下游（schedulePreplanAnchoredTime 等）不含 serial 调用，in-serial 路径无死锁。
2. **command.md 总览表 overlay.status 权限列**仍写"管理员"——此前已放宽为白名单用户，
   文档同步。
3. **CONFIGURATION_GUIDE.md 漏两个新配置字段**：`statePatchMajorMinScenes`（演化分区）、
   `arcPromptCharacters`（记忆分区），补齐。

自查同时确认无恙的点：blindMode 下空格归一化中间件无副作用（无命令可命中即不重写）；
A4 重试的 maxTokens:0 经 requestBody `>0` 判断实现真无 cap；B6 补排 timer 与新消息
到达的取消逻辑不冲突（bufferUserNarrative 先取消旧句柄）；C1 证伪后非空断言
decision.arc!.summary! 同样安全（断言在前）；FamilyOverride.extraAfterLength 在
R1 删除后成为保留但无人使用的接口字段（向后兼容，无害）；formatDateTime 无重名。
typecheck 0 错；全量 598 测试全过。

### 2026-10-08 批次三（C2 修复；C1 证伪）✅

- **C1 复核证伪（⚪）**：persistCompaction 第一行即 `assertContinuityReview(decision)`
  （service.ts:9307 → script/continuity-checkpoint.ts:16）——`!decision.scene?.summary?.trim()
  || !decision.arc?.summary?.trim()` 即抛 "checkpoint retained for retry"，SilentCompactor
  的空 decision 与残缺输出在推进 lastEntryId（9336）**之前**就被拦截；throw 路径另有
  compaction fingerprint backoff（9134）。triage 引用的 9305-9311 恰为断言之后的代码，
  假设不成立。非空断言 `decision.arc!.summary!`（9323-9325）因此也是安全的。
- **C2 复核属实**：entries（9120）与 preceding（9137）两处读取均无 kind!=='redacted'
  过滤（recentEntries/recentEntriesForPrompt/desktopTimeline 三条读取路径均有，此处遗漏）。
  影响：墓碑虚增 sceneCompactionDue 阈值、占位符文本进压缩模型输入污染摘要、
  `entries.at(-1)` 为墓碑时场景关闭边界取墓碑时间戳。
  **修复**：两处读取后过滤 `kind !== 'redacted'`——阈值判定、字符预算、检查点推进、
  关闭边界全部基于净化后的条目，与其他读取路径契约对齐。
- **回归**：typecheck 0 错；全量 598 测试全过。

### 2026-10-08 批次二（A1/A2/A4 修复；A3 证伪）✅

- **A2 复核属实**：首 token 守卫后 `clearTimeout`（1112）即无任何超时；对照 OpenAI 兼容
  流式有总超时（1135），Zhipu 路径零保护。**修复**：chunk 间 idle 超时
  （ZHIPU_STREAM_IDLE_TIMEOUT=120s）——每次 reader.read() 返回即续命；保留"长思考
  不设总限"意图（思考期仍有 reasoning/心跳 chunk 持续续命），只杀真死流；idle 触发
  abort 后抛独立错误消息，failover 循环得以继续。
- **A4 复核属实**：decide 的 attempt 循环只记 failures 换 attempt，同 cap 重打满次数；
  侧端 sideTaskJson 的去-cap 恢复（511-521）未覆盖主叙事。**修复**：移植侧端模式——
  attempt 失败且错误匹配截断正则（invalid JSON/Unterminated/输出未完成/incomplete 等）
  且本次带 max_tokens 时，以 maxTokens:0 覆盖重试一次（不消耗 failover 次数，成功
  路径零额外请求）；anthropic 协议排除（截断错误形态不同，由既有机制处理）。
  maxTokens:0 经 requestBody 的 `> 0` 判断实现真正的无 cap。
- **A1 复核属实**：assigned（routing.main.assigned 配置级指派）直取不过冷却，循环尾
  写入的冷却对 assigned 永不生效（死代码），故障 provider 每回合满次数重试。
  **修复**：新增 filterCooled 助手（全部冷却时保留全部候选防饿死，与默认路由同款
  语义），assigned 列表同样过滤；selectRouteProviders 内部复用同一助手消除重复。
- **A3 复核证伪（⚪）**：兜底链完整——deliverEarlyPrivateReply 成功即标记
  firstMessageCommittedRequestId（2988，此前有三重防护+单气泡限制）；流断时
  tryDecide 吞错、3876 以 early 内容合成降级决策（script 置空），串行块 3914 专门
  分支走 scheduleStreamScriptRecovery（streamRecovery intent 的 prompt 契约保证
  只补剧本、不重发可见回复）+ 显式日志；catch 因 committed 标记跳过 narrative-retry
  （防重复回复）。无需修复。
- **回归**：typecheck 0 错；全量 598 测试全过。

### 2026-10-08 批次一（B1/B2/B4/B6）✅ 全部属实并修复

- **B1 复核属实**：提交串行块（原 3871）仅查 databaseResetting/obsoleteRequestIds/故事状态，
  无 paused 复查；暂停 bump 的 runtimeGeneration 只被后台 sweep/advance/长线/压缩消费。
  **修复**：串行块开头加 paused 拦截，`requeue: true` 放回批次（消息不丢，恢复后重排处理）。
- **B6 复核属实**：rescheduleTimers 跳过 in-flight 非空的 turn；in-flight 结束后
  endFlush 不为遗留消息补定时器 → 孤儿（阻塞后台推进,等下一条用户消息才救活）。
  **修复**：TurnEngineDeps 新增 scheduleTurnFlush；endFlush 对"messages 非常 + 无 timer +
  无 in-flight"的回合补 debounce 定时器。闭环链：运行态直接触发 flush；暂停态触发被
  flush 入口的 paused 检查拦截（拦截时清掉已触发的 timer 句柄——否则 resume 的
  `!turn.timer` 判断会跳过补排），消息保留由 resume 的 rescheduleTimers 接管。
  该兜底同时覆盖正常流 obsolete-requeue 的消息（此前依赖"新消息自带 timer"的隐式耦合）。
- **B2 复核属实（半数）**：4217 调用点在 advanceUnlocked 的 serial 内（安全）；
  6110（分段投递）/6631（投递确认）在 serial 外，urge RMW + scheduleUrgeAdvance 的
  快照写与串行回合交错 → 丢失更新打乱心跳。serial 不可重入（同 key 嵌套死锁），
  不能无脑包。**修复**：AsyncLocalStorage 跟踪串行执行域（serialScope.run 包 task）；
  recordAutomaticDelivery 的 urge 段 `inSerial ? 直接执行 : serial 入队`；
  inSerial 对基础设施缺失的最小测试桩安全降级为 true（保持旧行为）。
- **B4 复核属实（暂停部分）**：群提交串行块（原 2437）无 paused 复查，与 B1 同构。
  **修复**：串行块条件加 paused（作废不 requeue——群内容已在 receiveGroup 落库，
  空 turn 由 finally 清理,无孤儿）。私聊 250ms 空转为既有 narrating 设计的可接受代价,不动。
- **回归**：typecheck 0 错；全量 598 测试全过（urge 测试桩暴露的 inSerial 降级问题已修）。
