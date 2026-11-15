# 考据 Agent（Research Agent）详细设计

状态：**设计 v3 已全部实施（P1/P2/P3'）** · 设计定稿 2026-10-27（CEV 分叉仓），2026-10-28 移植主仓（当前工作区，未发布） · 调研：Anthropic / Manus / DeepSeek Harness / 开源深研项目 / Jev（TypeSafe AI System One 决策模型）

> 实施状态说明：P1（desk/search/runner + research-lookup 意图 + writingReference 注入）、P2（工具注册表/查询缓存/任务日志）、P3'（Jev 被动推进门控，fail-open）与审计修复 #1-#7 均已落地并通过测试（`test/research-agent.test.ts` 21 项）；§5.2 描述的门控语义与实现一致。本文其余内容为设计依据，行为细节以源码与 CHANGELOG 为准。

> 一句话定位：考据 agent 是世界与剧本之间的**资料员**——为唯一作者（主叙事模型）维护一张"资料案头"，只供应经核实的写作参考，永不叙事、永不影响主角认知。

---

## 1. 背景与原则

### 1.1 要解决的问题

主叙事模型的任务是写作，不具备 agent 能力（多步检索、来源甄别、事实核验）。由此产生的剧本失真：

- 时间守恒违反：一小时的电影被写成看三小时；
- 空间事实失实：从家到东湖写成 40 分钟，实际骑行 90 分钟；
- 承诺落空：她说"我去查查"，查什么、查到什么无从落地。

### 1.2 三方分立（核心原则）

| 方 | 职责 | 禁止 |
| --- | --- | --- |
| 意图系统 | 管"她答应过什么"（承诺回访闭环） | 不管事实 |
| 资料案头 | 管"世界实际上是什么样"（经核实的事实） | 不管她的认知 |
| 主叙事作者 | **唯一裁决者**：决定两者在她身上如何交汇（查到了、查到一半、忘了看、岔开话题都是合法叙事） | — |

推论：agent 产出是 **author-facing 参考资料而非主角知识**。案头从不说"她知道"；她的忘性、记岔、没留意全部留在叙事层，由作者每轮裁决（忘也要忘得像她——模式沉淀在 Perspective/Overlay）。

### 1.3 边界红线

- **只答不问**：agent 只回答剧本已提出的问题，永不引入剧本没问的问题（信息即影响力——"顺便发现明天有演唱会"就是导演）。与世界播种器的分工：**播种器负责问（产生事件），考据 agent 负责答（核实事实），两者永不合并**。
- **零叙事权威**：不产出散文、不写结构化叙事字段、不触碰关系/情绪状态。
- **失败永不阻塞叙事**：案头当轮为空 = 作者写"她没查到"，本来就是合法剧情。
- **预取触发必须机械**：规则表（活动类型→事实类别）触发，无模型裁量——防止"选择查什么"变成导演。

---

## 2. 外部调研结论（设计依据）

| 来源 | 采纳的结论 |
| --- | --- |
| Anthropic《Building Effective Agents》 | 本场景 = workflow 为主 + 有界小循环，不是自主 agent 更不是多 agent；工具描述当 HCI 做；框架 skepticism——直接 API 调用 |
| DeepSeek Harness（DSH，Cordis 同源，MIT，~150K 星） | ① 循环 agent 的经济性**完全来自前缀缓存**（实测 ~99% 命中时才便宜）→ 循环上下文必须稳定前缀+append-only+确定性序列化；② 工具注册表做成 Cordis 服务；③ token 预算前置（发送前预览成本）；④ **不整体嵌入**（平台重量、实测慢且吃 token、需安全审计）；Cordis 同源保留为远期旁挂扩展位 |
| Manus Context Engineering | 压缩必须可恢复（丢内容保 URL）；保留失败记录（案头记录"查询失败"，作者可写她没查到）；上下文 append-only；KV-cache 友好 |
| dzhng/deep-research（经典轻量深研循环） | Issue #47 教训："每轮必迭代"浪费 token → **只在蒸馏显式报告证据不足时追加一轮，总量 ≤2 轮** |
| 深研项目横评（GPT Researcher/STORM/DeerFlow 等） | "计划→检索→阅读→压缩→带引用产出"已是商品化循环；各家差异只在语料连接器；不值得引入任何一家做依赖 |
| MCP 生态 | v1 自建检索栈；MCP search 适配器作为 P3 的注册表挂载项（生态标准，但注意安全面：token 泄露/供应链） |

---

## 3. 总体架构

```
┌─ 触发层 ──────────────────────────────────────────┐
│ 应答式：意图系统挂接（"我去查查"→ 承诺回访闭环）      │
│ 预取式：Schedule Preplan 窗口 × 机械规则表（P3）     │
└──────────────┬────────────────────────────────────┘
               ▼
┌─ 编排层：research runner（新模块 src/research/）────┐
│ ① 预算门（超限降级单轮）                            │
│ ② 查询改写 + 防火墙（1 次廉价调用，产脱敏查询词）     │
│ ③ 程序化检索（零 LLM）：search API → 预过滤 → top-k  │
│ ④ 蒸馏（1 次调用）：结构化案头候选 + 证据不足信号     │
│    ↳ 证据不足且预算有余 → 追加检索（≤2 轮总量）      │
│ ⑤ 写案头 + 意图完成                                 │
├─ 横切 ────────────────────────────────────────────┤
│ • 工具注册表（Cordis 服务）：search/visit/(P3)MCP   │
│ • append-only 任务日志（存意图 payload，可审计）     │
│ • 前缀缓存对齐的循环上下文契约                       │
└──────────────┬────────────────────────────────────┘
               ▼
┌─ 资料案头（author-facing 工作台）───────────────────┐
│ ≤8 条/故事｜TTL 分级｜去重哈希｜注入七段式上下文新段  │
│ 硬约束★ 双通道（prompt + Schedule Preplan 时间块）   │
│ 高复用条目 → 压缩器晋升 world 长期事实               │
└───────────────────────────────────────────────────┘
```

---

## 4. 检索栈（v2 修订：API 优先，puppeteer 降级为可选回退）

### 4.1 修订理由

ZCode/DSH 等 agent 的"自带检索"来自**宿主平台以 API 工具形式提供**（搜索 API + URL 抓取转 markdown）。HDSI 自托管无平台喂工具，须自带后端。旧网页观察用 puppeteer+DuckDuckGo HTML 是"模拟她本人浏览"的产物（渲染页面、免费零 Key）；**考据的目的是拿事实不是演浏览**，应采用 API 优先栈：更快、更省、无 Chromium 依赖、结构化结果。

### 4.2 search 工具（可配置后端，Console 选择）

| 后端 | 说明 | 默认 |
| --- | --- | --- |
| `tavily` | agent 导向搜索 API，返回干净摘要，免费额度 1000 次/月 | 海外推荐 |
| `bocha` | 博查，国内 agent 生态常用 | 国内推荐 |
| `searxng` | 自托管聚合搜索，无需付费 Key | 自托管场景 |
| `duckduckgo-html` | 零配置回退：抓 DDG HTML 轻量结果页（沿用现有模板），无 Key 可用，限流风险自担 | **出厂默认** |

后端实现注册进工具注册表；选择优先级：Console 显式选择 > 检测到已填 Key 的后端 > DDG 回退。

### 4.3 visit 工具（页面事实提取）

- **默认**：undici（**已有依赖，零新增**）HTTP 拉取 → HTML→文本抽取（标题/正文/表格，字符预算截断）→ 供蒸馏。同源策略沿用现有 browser 安全边界（协议限制、域名黑白名单、体积/超时上限）。
- **可选回退**：JS 渲染必需的页面走 koishi-plugin-puppeteer（本就是 optional 服务，未安装时跳过该来源并在任务日志记"来源不可读"）。
- 搜索 API 自带摘要已足够时跳过 visit（多数数字类事实——片长、车程——在摘要层即可核实，省一次抓取）。

### 4.4 查询防火墙（安全红线）

- 改写步骤的系统指令明确：**查询词只允许世界级词汇**（作品名/地名/机构/通用概念），剥离用户 ID、昵称、私聊细节、可定位个人的组合。
- **永不检索用户本人**：改写输出的查询词过一层程序化校验（命中参与者 userId/昵称白名单词 → 拒绝该查询，任务记失败原因）。
- 域名边界沿用 browser 配置（blockedDomains 优先于 allowedDomains）。
- API Key 存 Console 配置，写日志时掩码。

---

## 5. 触发设计

### 5.1 应答式（P1，已实施）

- 她说"我去查查/搜一下/回头告诉你"→ 主叙事产 `research-lookup` 类型 intent（与 delayed reply 同构；承诺回访机制保证可见履行/延期/取消，最多五次未结算顺延）。
- intent payload 携带：查询主题、承诺原文摘要、notBefore（默认 2-5 分钟——"等我查一下"的人类节奏；异步性即拟真）。
- 到期由 scheduler 唤醒（复用独占任务门 + 指纹冷却），执行 runner，结果落案头，intent 完成；作者下一轮读到案头决定"她查到了什么、怎么说"。

### 5.2 Jev 门控：被动推进的叙事前考据（P3'，已实施）

**机制**：被动推进（用户消息触发的回合）在进入主叙事模型调用**之前**，先用 **Jev**（TypeSafe AI 的 System One 决策模型，2026-09 发布）做一次是非判断：

- 输入：用户消息内容 + 近期剧本尾部 + 案头已有条目（避免重复查已核实事实）；
- 题型：**Noul（是非）**，问题形如"主角对本条消息的回应动作，是否依赖可核验的具体现实细节（查询/搜索类动作，或强现实针对性的信息，如具体场所名/片长/通勤时长）"；
- 输出：TRUE/FALSE + 校准置信度。

**分支**：

- **FALSE → 直通**主叙事调用（零额外成本，Jev 调用毫秒级、比 LLM 便宜 40-400 倍）；
- **TRUE → 先查后写**：以用户消息摘录为主题跑现有 runner（改写步顺带完成主题提取与防火墙脱敏）→ 事实落案头 → **然后才调主叙事**，本轮带着核实过的事实写作。研究在叙事之前内联完成——**不需要任何屏障/挂起/跨轮等待机制**，"自我反驳"问题从结构上不存在；
- **Jev 不可用/超时（~2s）/低置信** → 按 FALSE 直通（fail-open，考据永不阻塞对话）。

**不做的事**（v3 明确移除，替代 2026-10-27 早先的 P3 设计）：

- ~~自动推进每轮判定 pass~~：自动推进不设考据门——案头内 TTL 未过期的事实经既有注入自然可见，过期即撤；
- ~~Preplan 完成钩子与事实注入~~：日程事实改由对话中自然产生的查询覆盖（她约了看电影，对话轮 Jev 判 TRUE，片长入案头，推进轮自然读到）；
- ~~主模型输出 needsExternalInfo 布尔~~：判断外移给 Jev，主模型零额外出向 token、零合约行；
- ~~研究屏障/挂起机制~~：叙事前内联完成，无并发冲突面。

**配置面增量**：`research.jev` 子块（`enabled` / `apiKey` / `baseUrl` / `noulThreshold` 置信阈值，默认 0.6）。Jev 为 TypeSafe AI 托管服务，需 API Key；未配置时整个门控视为关闭（被动推进永远直通，P1 意图路径不受影响）。

**成本**：FALSE 路径 = 1 次 Jev 调用（70-500ms，可忽略）；TRUE 路径 = Jev + 既有 runner（2 次廉价模型调用 + 检索）。预期 TRUE 率 ~10%——Jev 的判断措辞校准为"仅当依赖可核验的具体现实细节且超出常识"，模型自身知识库覆盖的场景不触发。

**意图共存**：P1 的 research-lookup 意图路径保留——显式承诺有"必须交代结果"的叙事问责，与 Jev 轻量旁路语义不同，互不替代。

---

## 6. 编排循环（research runner）

### 6.1 步骤与调用账

| 步 | LLM 调用 | 说明 |
| --- | --- | --- |
| ① 预算门 | 0 | 预计 N 查询 × M 调用 × token 上限；超限 → 降级单轮（跳过②直接用原始主题词） |
| ② 改写+防火墙 | 1（廉价） | 产出 2-4 个脱敏查询词 + 语言判断；输出 JSON |
| ③ 程序化检索 | 0 | 并发调 search 后端；标题/域名启发式预排序；top-k（默认 5）进入④；摘要已含答案的数字类事实可跳过 visit |
| ④ 蒸馏 | 1 | 输入：任务主题 + k 条来源摘要/正文节选；输出 JSON：`{facts: [{text, sourceUrl, confidence, hard, ttl}], insufficient: bool, reason}` |
| ⑤ 收尾 | 0 | 案头写入 + 去重 + 意图完成 + 任务日志封存 |

**典型成本：2 次模型调用（~200 + ~500 出向 token）+ 1-2 次程序化检索**；对比经典必迭代深研循环（4-8+ 次调用）省 60-75%。insufficient=true 且预算有余 → 换查询词再来一轮③④，总轮数硬上限 2。

### 6.2 循环上下文契约（前缀缓存对齐——DSH 经济性精髓）

- system 合约**逐字节固定**（版本化常量，同特化档位思路）；不含时间戳等每轮变化量（变化量放 user 尾部）。
- 上下文 **append-only**：第 2 轮不重写第 1 轮内容，只追加"补充检索"块。
- JSON 序列化**确定化**（键序固定），保证 DeepSeek/GLM/Kimi 前缀缓存命中（缓存 token ~10x 差价）。
- 全程走现有 `customSideTask` 通道（宽容解析 + 去 max_tokens 重试 + failover 零成本继承）。

### 6.3 任务日志（append-only）

- 每任务一份：触发来源、改写输出（含被防火墙拒绝的尝试——保留失败，Manus 原则）、每轮检索词与命中来源、蒸馏原文、最终案头条目 ID、耗时/调用数。
- 存储：intent `payload.researchLog`（不建新表；意图生命周期即日志生命周期，超期随承诺退役一起清理）。

---

## 7. 资料案头（desk）

### 7.1 数据结构

```ts
interface DeskEntry {
  id: string                // 查询词哈希
  text: string              // 事实（中文短句，≤120 字）
  sourceUrl: string         // 可恢复压缩：内容过期也保留 URL
  confidence: number        // 0-1，多来源一致上调
  hard: boolean             // ★硬约束（舞台物理） / 软材料
  ttlUntil: number          // 分级过期
  capturedAt: number
  originIntentId?: number   // 应答式来源（审计链）
}
```

- **TTL 分级**：稳定数字事实（片长/距离）默认 7 天；易变事实（营业中/封路/票价）默认 12 小时；过期静默撤下，不产生事件。
- **容量**：每故事 ≤8 条，超出按 capturedAt 淘汰最旧；案头是工作台非档案馆。
- **去重**：查询词规范化哈希；命中既有条目未过期 → 直接复用，**零调用**（含哈希为键的"已研究"记忆）。
- 存储：内存 Map per story（重载即清空——案头是工作台，非真相源；长期价值走晋升）。

### 7.2 注入与呈现

- context-compiler 新增独立段（位于世界事件之后、当前事件之前），呈现与 `[世界事件]` **明确区隔**（独立标记语法，防模型把参考资料当成已发生的事）。
- 段头固定指令（author-facing）：*"以下为已核实的写作参考；主角是否知晓、记得、注意到，由你根据她的人设与本轮状态决定；带 ★ 的是舞台物理，散文不得违反。"*
- 硬约束双通道：★条目同步写入 Schedule Preplan 时间块（观影 116 分钟 → 19:00-21:10 占位），**prompt 里的数字是建议，结构里的数字才是物理**。agent 只允许写基础设施字段（时长/容量/可用性），一字不碰叙事字段。

### 7.3 晋升路径

压缩器（本就在做事实提案）扩展一类输入：案头中高复用（≥2 次命中缓存）、高置信、到期前被再次请求的条目 → 提案为 **world 范围长期事实**（author-facing canon，依然不是她的知识）。

---

## 8. 模型路由

- 模型中心新增用途勾选 **`useForResearch`（用于考据）**；`ModelTask` 增加 `'research'`。
- 未勾选时回退压缩路由（同为侧端 JSON 任务的廉价模型习惯）。
- 改写与蒸馏都是窄任务，天然适合挂全系统最便宜的连接；建议文档明示"考据连接建议选 flash 级模型"。

---

## 9. 配置面（Console 新段【扩展】`research`）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 考据总开关 |
| `searchBackend` | `'auto'` | auto/tavily/bocha/searxng/duckduckgo-html |
| `searchApiKey` | `''` | 对应后端的 Key（掩码显示） |
| `searxngBaseUrl` | `''` | searxng 实例地址 |
| `maxRounds` | `2` | 检索轮数上限（1-2） |
| `dailyTaskCap` | `20` | 每故事每日考据任务上限 |
| `taskTokenBudget` | `6000` | 单任务出向 token 预算（预算门依据） |
| `deskCapacity` | `8` | 案头容量 |
| `stableFactTtlHours` / `volatileFactTtlHours` | `168` / `12` | TTL 分级 |
| `prefetchEnabled` | `false` | 预取式开关（P3 随实现开放） |

新段加入需同步 `configuration.test.ts` 键序断言与【扩展】编号（沿用既有流程）。检索域名黑白名单**复用 browser 段**，不重复建。

---

## 10. 性能与消耗设计（按杠杆排序）

1. **前缀缓存对齐**（~10x 差价，DSH 实证）：固定 system + append-only + 确定性 JSON。
2. **两段式 + 显式不足才迭代**：程序化检索零 LLM；dzhng 教训制度化。
3. **事实缓存与哈希去重**：查过的不重查；缓存命中路径零调用。
4. **摘要优先**：数字类事实多数在搜索摘要层即可核实，跳过 visit 抓取。
5. **预算前置 + 空队零调用 + 每日配额**（复用表情包采集的配额/指纹冷却机制）。
6. **廉价专用路由**：改写/蒸馏挂最便宜连接；蒸馏输出为短句 JSON，出向 token 天然小。
7. 预取批量错峰至后台 sweep 空闲窗口。

---

## 11. 分期与验收

| 期 | 内容 | 验收 |
| --- | --- | --- |
| **P1 应答式最小闭环**（✅ 已实施于 CEV） | intent 挂接 + 预算门 + 单轮管线（改写→检索→蒸馏→案头）+ 上下文新段 writingReference + `interlude.research.status` 命令 | 单测：防火墙拒绝含用户词查询、案头 TTL/容量/去重、蒸馏解析容错 |
| **P2 循环与注册表**（✅ 已实施于 CEV） | 不足才追加的 ≤2 轮 + 工具注册表（Cordis 服务 `ctx.researchTools`）+ 查询 TTL 缓存 + append-only 任务日志 | 两轮请求的 system/前缀逐字节一致；注册表插拔不改 runner；缓存命中零网络 |
| **P3' Jev 门控**（待实施） | `src/research/jev.ts` 客户端（Noul 题型，fail-open）+ `research.jev` 配置块 + 被动推进（user-message 回合）decide 前的门控钩子：TRUE → 内联跑 runner 再叙事 | Jev stub 三分支（TRUE 查后写 / FALSE 直通 / 超时直通）；门控关闭时行为与 P1/P2 完全一致 |
| **P4 生态（可选）** | MCP search 适配器（注册表一次 `registerSearch`）+ 压缩器晋升（高复用案头条目 → world 长期事实） | MCP 后端可插拔测试；晋升走压缩器既有提案链 |
| **远期扩展位** | DSH 旁挂（Cordis 同源）——若未来需要完整 agent 化生活再评估，独立立项 | — |

## 12. 开放问题

1. search 后端出厂默认是否维持 DDG 零配置回退（无需 Key 即可用，但限流脆弱）——**当前决定：是**，文档明示建议配置 API 后端。
2. Jev 门控是否扩展到 conversation-follow-up 回合（当前仅 user-message）——先实装 user-message，观察 TRUE 率与延迟后再定。
3. 案头条目是否需要 `interlude.research.desk` 管理命令（查看/清除）——倾向并入 status 命令只读展示。

## 13. 参考来源

- **Jev（TypeSafe AI System One 决策模型）**：[决策模型综述](https://www.northboundadvisory.com/blog/decision-models-jev) · [腾讯云实测](https://cloud.tencent.com/developer/article/2748815) · [Jev 白话解析](https://rar.design/posts/jev-typesafe-system-one-model-guide) · [四款决策模型三周连发](https://pub.towardsai.net/f2bb09aed3f6)

- [Building Effective Agents – Anthropic](https://www.anthropic.com/engineering/building-effective-agents)
- [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [DeepSeek Harness – GitHub](https://github.com/deepseek-ai/deepseek-harness) · [DSH Cordis 教程](https://dsh-docs.pages.dev/docs/cordis-tutorial) · [r/DeepSeek DSH 实测](https://www.reddit.com/r/DeepSeek/comments/1vnpt5n/my_first_impressions_of_deepseek_harness)
- [dzhng/deep-research Issue #47（循环成本教训）](https://github.com/dzhng/deep-research/issues/47)
- [GPT Researcher vs STORM vs DeerFlow 横评](https://menuagentic.com/blogs/gpt-researcher-vs-local-deep-research-vs-storm-vs-deerflow)
- [MCP 生态与安全](https://hackernoon.com/mcp-security-in-2026-lessons-from-real-exploits-and-early-breaches)
