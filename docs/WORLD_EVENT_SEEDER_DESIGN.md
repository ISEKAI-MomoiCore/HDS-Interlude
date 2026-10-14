# 世界事件播种器（World Event Seeder）设计实现文档

适用版本：当前实现基线为 `1.0.1-rc52`。本文最初起草于 rc24，以下分期和开放决策保留作为设计演进记录；当前实现状态以本节和源码为准。

## 0. 状态

当前已实现：周期生成、事件校验、计划事件排期、语义去重、到期事件注入，以及 user-message / advance 回合按重要性排水。当前尚未实现的主要部分是桌面时间线专用世界事件状态徽标。rc24 起提供商选择改为模型中心的用途勾选（useForWorldSeeding）。历史设计决策包括：① 参与者**严格禁止**与事件相关（双层校验：提示词拉黑 + 宿主词面拦截）；② 密度默认每 24 小时 1~4 条、单次至多 2 条、高重要性每天至多 1 条（低多高少）；③ 注入条目使用**新增 `world-event` kind**（ownership 映射 system）；④ 模型选择复用**用途勾选**（连接行 `useForWorldSeeding`，无勾选即关闭）；⑤ 提示词全面开放：环境（时区/季节/世界设定/场景地点）、历史剧本（压缩摘录）、关系网（拉黑名单）、主角所为（workingDetails/场景/弧摘要）全部进入生成上下文。

实现落点：`src/world-seeder.ts`（提示词/解析/校验闸/客户端）、`narrator.customSideTask`（独立配置块复用侧任务请求链）、表 `interlude_seeded_event`（cev 为 `cev_` 前缀）、`service.worldSeederSweep`（定时器+抖动+校验闸+入库+due 唤醒）、`service.drainDueSeededEvents`（`decide()` 顶部排水：user-message 回合仅 medium/high，其余回合含 low）、主提示词 WORLD EVENTS / LITE_WORLD_EVENTS 指令块。

## 1. 动机与定位

主叙事提示词受"不得虚构外部事件"教条约束（`Never invent an incoming message, phone vibration, notification, or quoted sentence absent from the observed-event ledger`）。这保证了拟真性，但代价是：无人发消息、日程预排之外，她的世界几乎是静止的——一切外部事件只能来自平台观察或管理员手工注记。

世界事件播种器（下称 **seeder**）是一个与压缩器/时间导演同级的后台侧模型：周期性地以低概率生成与主角有关的外部世界事件，由模型给出发生时间，宿主到点以剧本条目形式注入。

核心机制洞察：**事件一旦进入 supplied context，主模型就获得了书写它的合法性**。seeder 是"持证的外部事件源"——它生成的事实由宿主落账后，主模型书写这些事件不再违反不得虚构教条。

目标：

- 她的生活在无用户输入时也有外部变化（世界自己会动）。
- 长期线程（考试、生日、他人麻烦）可以提前播种、到期兑现。
- 为主动联系提供更多 life-grounded motives 的素材（**不**直接生成联系动机——那是 Urge/Agency 的领地）。

## 2. 核心语义：事实权威，反应自由

- **事实权威**：事件条目描述"发生了什么"，是既成现实，主模型不得改写或无视。
- **反应自由**：她如何感知、是否在意、如何应对，完全是主作者领地。
- 与管理员注记（`[管理员注记]`）**同管线、不同语义**：注记是 directive（在特定主题上覆盖叙事即兴），世界事件只是 fact（无任何义务、可被后续事实自然冲淡）。这就是"同源但不是注记"。

## 3. 与现有系统的边界

| 系统 | 管什么 | seeder 的边界 |
|---|---|---|
| 时间导演 | 她自己的行动时间线（proposed movement） | seeder 管**世界对她做了什么**，不写她的行动 |
| Urge / Agency | 主动联系的动机与容量 | seeder 永不直接生成"她想联系谁"；只生成可能构成动机的生活事实 |
| Schedule Preplan | 未来约 12h 的日程结构 | seeder 拿它当约束（事件须落在日程缝隙），不当内容来源 |
| dueIntents | 剧本自己许下的未来线程 | seeder 事件是外部新事实，不是既有意图的兑现 |
| 管理员注记 | 管理者指令 | 事件无指令性 |

## 4. 事件分类学（重要性 × 时间尺度）

| | 即时（分钟级） | 短期（小时级） | 远期（天级种子） |
|---|---|---|---|
| **低（质感）** | 楼下开始装修、雨转大 | 停电通知 | — |
| **中（生活事务）** | 快递到了 | 作业截止提前、兼职换班 | 下周要交报告 |
| **高（关系/转折）** | 家里来电话 | 同学惹了麻烦找她、街上偶遇 | 三天后考试、朋友生日临近 |

- 低重要性只在推进/跟进回合浮现；高重要性允许在 user-message 回合出现，但以背景事实形式存在，不劫持对话。
- 远期种子两种形态，由 seeder 按 horizon 决定：
  - **现在播一次事实**（"老师宣布了考试"），后续由主模型自己长出 intents/workingDetails——它已擅长此事；
  - **到期再注入**（考试当天早晨注入"今天考试"），事件行持久保存至 due。

## 5. 数据模型

新表 `interlude_seeded_event`：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | unsigned 自增 | |
| storyId | string, 索引 | |
| summary | text | 事件正文（不含前缀；中文，一句具体事实） |
| importance | 'low' \| 'medium' \| 'high' | |
| occursAt | timestamp | 模型给定的发生时间 |
| expiresAt | timestamp? | 过期未注入即作废；宿主兜底：有效窗至少为 occursAt 后 2 小时（模型给的更短过期会被抬高） |
| status | 'scheduled' \| 'injecting' \| 'injected' \| 'expired' | injecting 为 claim-then-append 的注入中态；dropped 从未写入（拒绝发生在入库前） |
| subjects | json | 涉及的 NPC 名单（审计与拉黑校验） |
| sourcePayload | json | rationale、生成时上下文指纹 |
| injectedEntryId | unsigned? | 回链剧本条目 |
| createdAt / updatedAt | timestamp | |

注入条目形态（复用 appendEntry 管线）：

- `kind`: 'system-event'（复用现有 kind，ownership 映射为 system；新增 'world-event' kind 作为备选，见 §13）
- `content`: `[世界事件] ` + summary
- `occurredAt`: 事件的 occursAt
- `metadata`: `{ seededEventId, importance }`

条目自此自然流经 recentScript → 压缩 → 桌面时间线，**不需要新增 payload 字段**。

## 6. 生成回路

### 触发

- 每故事低频定时器 `cadenceMinutes`（默认 30；每轮约 10% 概率整轮跳过以避免节律感）。
- （原设计的 advance 提交后 piggyback 检查未实现，调度仅由定时器驱动。）
- **大多数运行输出空**——稀疏才是真实感，这是提示词明确教的。

### 输入上下文（全部摘要级，不给原始剧本）

场景/弧摘要、Preplan 窗口、workingDetails、活跃 consequences、**参与者名单（拉黑名单）**、最近 14 天已注入事件（去重）、人物关系简况（Alter/developmentTendencies 摘要）。

### 输出 schema（JSON，温度约 0.9）

```json
{ "events": [ {
  "summary": "楼下五金店开始装修，电钻声断断续续。",
  "importance": "low",
  "occursAt": "2026-09-25T10:30:00+08:00",
  "expiresAt": "2026-09-25T14:00:00+08:00",
  "subjects": [],
  "wakeEligible": false,
  "rationale": "上午在家，质感级噪音事件，与当前场景不冲突"
} ] }
```

### 宿主校验闸（入库前；宁可错杀，不重试）

1. `occursAt ∈ (now, now + maxHorizonHours]`。
2. Preplan 冲突：仅提示词层建议避开日程；宿主校验闸不做 preplan 关键词比对。
3. 参与者拉黑：subjects 或 summary 命中参与者名字/ID → 弃（见 §9 第 1 条）。
4. 去重（四维任一命中即弃）：① summary bigram Jaccard > 0.6；② subjects 与既有事件重叠；③ 摘要正文包含既有事件的主题词；④ occursAt 与既有事件相差 < 6 小时且关键词重叠 ≥ 2。
5. 频控：pending ≥ `maxPending` 或当日 ≥ `dailyCap` → 全部弃。
6. high 事件 occursAt 落在故事时区深夜（0:00–6:00）→ 弃（无豁免分支）。

校验失败的丢弃并记日志，不重试——生成是廉价的。

## 7. 注入机制

- **调度**：入库即 `scheduleDueIntentWake(storyId, occursAt)`，完全复用现有唤醒。
- **排水**：回合构建时（`flushBufferedNarrative` 与 `advanceUnlocked` 的 serial 队列内、读 recentEntries 之前）执行 `drainDueSeededEvents(storyId, now)`：把 `occursAt ≤ now` 且 `status=scheduled` 的事件按 occursAt 顺序追加条目并置 injected。
- **重要性感知浮现**：low 仅在 advance / conversation-follow-up 回合排水；medium/high 任何回合排水。
- 到点不排水也不会丢：事件仍在表内，下一回合补排；超过 expiresAt 置 expired。

### 主提示词常设块

full 档（narrator.ts，紧邻 ADMIN NOTES 块）：

> WORLD EVENTS: entries whose content begins with [世界事件] are externally observed facts about the protagonist's surroundings and social world, recorded at their stated time. They are established reality — write her life continuing from them; her attention, interpretation and response remain hers alone. They are not directives and create no obligation. Never have her mention noticing any record.

lite 档（specialization.ts，`LITE_WORLD_EVENTS`）：`Entries beginning with [世界事件] are externally observed facts about her world at their stated time. Treat them as established reality; her response remains hers. They are not directives.`

### seeder 提示词草案（侧模型，English）

```
You seed the protagonist's world with small externally originating events.

INPUTS (all summaries): current scene and arc, the coming schedule window,
in-flight working details, active consequences, BLOCKED NAMES (registered
participants — never generate events about them), recently seeded events
(do not repeat), relationship overview.

CONSTRAINTS:
- External facts only: things that happen TO her world. Never her own
  decisions or actions; never her wanting to contact anyone.
- Offline channels only: phone calls, in-person events, notices, weather,
  deliveries. Never any platform message, notification or chat content.
- Never generate events about BLOCKED NAMES or the user.
- Place events in the gaps of the schedule window; do not contradict it.
- Most runs produce nothing. Real life is mostly uneventful; sparsity is
  realism. Output an event only when the current context genuinely
  motivates one.
- Importance: low = texture, ignorable; medium = small practical change;
  high = relationship-relevant or disruptive. Calibrate honestly.
- occursAt must be a concrete future time within the allowed horizon,
  expressed in the story timezone.

OUTPUT: one JSON object {"events":[]} with 0–2 events. Do not wrap in
Markdown fences.
```

## 8. 事件驱动的推进回合（未实现）

原设计：`wakeEligible` 事件到点且无在途回合时直接调度一次 advance。当前实现没有该字段与专用唤起：事件入库后按 `occursAt` 排水，由既有的 due sweep / 下一次自然推进携带进剧本。

### 天气领地让渡（与实况天气注入的协同）

实况天气（【扩展 19】weather）对某故事生效时，播种器让出天气领地，避免双通道供天气造成的事实矛盾与时间线拥挤：

- **判定**（宿主侧，每轮 sweep 计算）：`weather.enabled && !(skipFantasyWorld && 命中架空检测)`。架空世界（或天气关闭）保持原行为——那些世界里模型即兴是唯一的天气来源。
- **提示词层**：nature 切面换替身 `NATURE_DOMAIN_NO_WEATHER`（季节、光照、声音气味；明确排除天气与天空状态），并追加硬规则 "NEVER originate weather changes"。替身不进六切面轮换数组。
- **校验闸层**：新增拒绝码 `weather-guard`——天气特征词（雨/雪/晴/雾/气温/降温……）命中即弃，不重试（宁可错杀）。
- 排序上守卫位于四维去重之后（第 ⑤ 闸）。

## 9. 安全栏

1. **绝不生成已注册参与者/用户的事件**——参与者背后是真实的人，替他们编造线下行为会与真实行为冲突。参与者名单作为 blocklist 传入提示词，宿主侧再校验一次。NPC（家人、同学、店主等只存在于她生活中的人）不受限。
2. **绝不生成任何平台的来信/通知形态**——"某人给你发了消息"仍是永不虚构教条的领地；电话、当面、纸条等线下通道合法，且以事实而非消息内容的形式表述。
3. **频控**：默认每天 2–4 条（低中为主）、pending 上限、同主题窗口期去重。
4. **Kill switch**：全局 + per-story 开关；关闭后 seeder 定时器拆除，SilentNarrator 式 stub 保证零成本。
5. **审计**：排期与注入为 standard 级日志；空输出与校验拒绝为 diagnostic 级。`interlude.seeded` 命令未实现，清除走故事重置/清库路径。

## 10. 配置面（Console schema 草案）

```
worldSeeder: {
  enabled: false            // 总开关（需模型中心有连接勾选“用于世界播种”）
  cadenceMinutes: 45        // 生成检查间隔
  maxPending: 4             // 同时挂起的注入上限
  dailyCap: 4               // 每故事每日注入上限
  maxHorizonHours: 72       // occursAt 最远时限
  temperature: 0.9
}
```

**模型选择走既有用途勾选**：模型中心的连接行新增 `useForWorldSeeding` 复选框（与 useForCompaction/useForStickers 并列），勾选的第一个启用连接即为播种器模型；无勾选连接时总开关无效（功能关闭）。不再单独复制一份提供商表单。

## 11. 模块划分与代码锚点

| 模块 | 位置 | 职责 |
|---|---|---|
| `src/world-seeder.ts` | 新文件，对照 compactor 形态 | prompt 构造、`generateWorldEvents(storyId)` 编排、输出解析与校验闸 |
| `src/service.ts` | drainDueSeededEvents（private，serial 内） | 到点排水、启动定时器、advance piggyback、频控状态 |
| `src/database.ts` | 表定义与迁移 | `interlude_seeded_event` |
| `src/narrator.ts` / `src/specialization.ts` | 指令块 | WORLD EVENTS / LITE_WORLD_EVENTS |
| `src/index.ts` | Console schema | worldSeeder 配置 |
| 复用件 | — | `scheduleDueIntentWake`、useForCompaction 提供商池、health 侧任务统计、failover |

测试计划：校验闸单测（六条各一例）、排水与状态机单测（due/补排/过期）、注入条目经 `validateScriptCommit` 无冲突、拉黑与去重命中、LITE/full 提示词块渲染；生成侧用 mock narrator（Silent 模式）测空输出与 schema 解析。

## 12. 分期落地

- **M1（注入侧，无模型调用）**：表 + 排水 + 条目注入 + 提示词块 + 配置。验证注入半边管线与主模型反应。（`interlude.seeded` 手动命令未随 M1 落地。）
- **M2（生成侧）**：seeder 模型回路（提示词、schema、校验闸、频控、健康统计），stub 与 failover 复用现有件。
- **已实现**：user-message 回合高重要性浮现、四维语义去重。（wakeEligible 唤起推进未实现，见 §8。）
- **尚未实现**：桌面时间线专用世界事件状态徽标；重要事件自动落 fact 仍不应视为 seeder 的默认自动行为。

## 13. 开放决策点

1. 参与者拉黑严格度：完全禁止提及，还是允许"背景级提及"（如"群里那位朋友今天没来学校"）？当前设计取完全禁止。
2. 默认密度：建议从每天 2 条起步，宁稀勿密。
3. 远期事件到期前是否允许 seeder 根据剧本演进改写或取消（"考试推迟了"）？当前设计：不允许，改写交给新事件叠加。
4. 注入条目 kind：复用 'system-event' 还是新增 'world-event'？复用最省（ownership/可见性逻辑零改动），新增利于 UI 区分——倾向 M1 复用、M3 视桌面端需要再引入。
5. 提供商归属：复用 `useForCompaction` 池还是独立配置块？当前设计复用。


## 架构修订：切面轮换与反馈环切断（2026-09-30，用户反馈"世界事件重复率高"）

复读的根源不是缺去重闸门，而是生成回路的结构：

1. **自馈环**：已注入的世界事件进入"近期生活摘录"，成为下一轮 sweep 的上下文锚点——播种器把自己的产出当灵感，同模态收敛是必然（实测同一"宿管贴国庆检查通知"以四种措辞 45 分钟一连排期四次，字符二元 Jaccard 仅 0.21–0.38，0.6 阈值全部放行）。
2. **恒定提问**：每轮 payload 除时间外几乎相同，无状态生成器在固定锚点下坍缩到同一模态。

修订（生成侧架构，非下游过滤）：

- **反馈环切断**：`buildWorldSeederPayload` 的生活摘录排除 `kind === 'world-event'` 的条目——播种器的灵感来源是她本人的生活；自己的产出只出现在 `recentlySeededEvents` 清单（模型自身记忆）。
- **切面轮换**：`WORLD_SEED_DOMAINS` 六个**通用切面**（天象与环境/居所与近邻/生计与日常事务/亲近之人/途中与陌生人/小意外与际遇）——切面是任意居住世界都成立的"世界的一个方面"，不是现代地球专属题材；具体面貌由各剧本自己的 worldSetting 渲染（宿舍楼或商队旅店、集市或公会），提示词明令"不得把现实世界特有建制硬塞进没有它的世界"，异世界/古代/近未来世界观同等适用。`seedDomainForRun(storyId, now, cadence)` 按 (剧本哈希 + 时间槽) 确定性轮换——相邻两轮必然不同切面、一个周期覆盖全部、跨剧本相位错开，零新增持久状态。
- **记忆完整性**：去重视野（提示词清单 + 校验闸）并入排期中（scheduled）事件——此前只看已注入，事件到点前连跑数轮时模型拿到的是空清单。
- **单轮至多一事件**（原 2；提示词层要求至多 1，解析上限仍为 2 作防御）：同批次互为换皮对失去存在条件。
- Jaccard 0.6 安全网保持原样——架构修复后它只处理真正的近重复。
