# 变更说明：主叙事 payload cache-first 重排（2026-08-31）

- 版本基线：`0.1.4-beta6`（本次不改变版本号，未走发布流程）
- 修改人：ZCode
- 状态：已实现并通过全部测试（typecheck 通过，`npm test` 105/105）

## 背景

主叙事每次请求 = 固定 system 合约 + 一条巨大的 JSON 用户 payload。legacy 顺序下 payload 以每轮变化的时间戳字段开头、对话历史（recentScript）垫底，服务商前缀缓存（DeepSeek/GLM/Kimi 等自动前缀缓存）永远无法命中——system 之后第一个 token 就分叉。

`mainPayloadOrder=cache-first` 按变异频率重排字段：稳定块前置（跨轮逐字节一致），每轮变化字段后置。预期连续对话轮命中 12k+ 字符级前缀，输入成本与 prefill 延迟显著下降（群聊/advance 回合的历史视图不同，命中率低于私聊连续对话）。同时 `currentEvent` 移至末尾获得最强 recency 位；payload 末尾新增 `recentExchange` 最近交换块，把最后几条交互重新锚定在生成点旁，防止历史前置稀释语境显著性。

设计权衡记录（为什么不影响信息量）：JSON 键序不改变语义解析，重排只移动 token 级注意力分布；已知风险（最近线程从 recency 位移到 primacy 位）由 `recentExchange` 尾块对冲，且可通过配置随时回退 `legacy`。

## 项目文件架构通览（修改前确认）

```
C:\dev\HDS-Interlude\            Koishi 开发实例根（koishi.yml / npm scripts / external\）
└─ plugins\hds-interlude\        插件本体
   ├─ src\                       源码（tsconfig 仅 include 此目录）
   │  ├─ index.ts                插件入口：Console Schema、事件接线、指令注册
   │  ├─ service.ts              核心服务：缓冲/调度/投递/压缩/白名单
   │  ├─ narrator.ts             主叙事模型：合约(systemPrompt)、payload(toPromptPayload)、
   │  │                          流式解析、压缩/Alter/Embedding/Sticker 客户端
   │  ├─ types.ts                全部类型定义（InterludeConfig/NarrativeRequest/…）
   │  ├─ agency.ts alter.ts      Agency Window / Alter 情绪系统
   │  ├─ group-willingness.ts    群聊纯算法意愿分
   │  ├─ qq-face.ts              QQ 原生表情名表
   │  ├─ logging.ts time.ts database.ts meta.ts
   ├─ test\                      node:test 测试（tsx 运行）
   ├─ docs\                      ARCHITECTURE / CHANGELOG / SECURITY / development\
   ├─ CONFIGURATION_GUIDE.md BEGINNER_GUIDE.md DEPLOYMENT_GUIDE.md command.md README.md
   ├─ backup\<date>\             本次新增：修改前快照
   └─ dustbin\ release\          归档与发布产物
```

约定确认：`tsconfig.json` 仅 include `src`（备份目录不参与编译）；`release-consistency.test.ts` 校验版本串与发布 HTML（本次不改版本号，故只在不校验的 CHANGELOG 中追加条目）；`configuration.test.ts` 断言 Console 分区顺序与默认值（新增字段挂在本分区尾部，不影响）。

## 逐文件改动

### `src/narrator.ts`
1. `ModelConfig` 新增 `mainPayloadOrder?: 'legacy' | 'cache-first'`。
2. `toPromptPayload(request, options?)` 新增可选第二参：
   - 不传或 `cacheFirst: false`：**逐字节保持 legacy 输出**（原对象原键序）；
   - `cacheFirst: true`：引用同一份已计算字段按新序重组——
     缓存稳定区：`setting → recentScript → durableFacts → memories → overlayEvolution → stickerCatalog → sceneContext → continuitySnapshot → schedulePreplan → webContext`；
     每轮变化区：`currentParticipant → participants → state → emotionalOffset → agencyWindow → automaticDeliverySummaries → followUpCommitments → dueIntents → upcomingPlans → activeConsequences → interruptedOutgoingDrafts → supersededDelayedReplies → groupContext → chatCapabilities → phase → refreshContinuity → outputRecovery → interval → continuitySnapshotAgeMinutes → currentEvent → recentExchange`。
     注意：`continuitySnapshotAgeMinutes` 每轮都变，因此从快照旁移入尾部区，否则会每轮击穿缓存。
3. 新增 `buildRecentExchange(request, maxCharacters = 1_600)`：从 recentEntries 尾部取最多 3 条，排除与 `currentEvent` 重复的当前 userMessage，每条 `{ownership, content}`（复用 `promptVisibleMessageContent`）；群聊回合返回 `[]`（groupContext 本就位于尾部区）。
4. `systemPrompt` 追加可选末位参数 `cacheFirstPayload = false`（保持既有测试的位置参数兼容）：为 true 时增加一行 `PAYLOAD ORDER NOTE`，说明 `recentExchange` 是既定过去的强调而非新事件。
5. `requestProvider`：读取 `this.config.mainPayloadOrder`，向 `toPromptPayload` 与 `systemPrompt` 传入开关。

### `src/index.ts`
Model 分区新增 Console 配置项 `mainPayloadOrder`（默认 `legacy`），描述包含用途、适用服务商、recentExchange 说明与回退方式。

### `src/types.ts`
无改动（ModelConfig 定义在 narrator.ts）。

## 测试

新增 `test/payload-order.test.ts`（6 个用例）：
1. legacy 键序不变、`cacheFirst:false` 与无参输出一致、不含 `recentExchange`；
2. cache-first 键序断言（`setting`/`recentScript` 开头，`currentEvent`/`recentExchange` 收尾）；
3. recentExchange 排除当前消息、携带 ownership、3 条与 1600 字符上限；
4. 连续两轮 cache-first 序列化前缀分叉点恰在 recentScript 数组收口（对比 legacy 基线 <200 字符）；
5. 群聊回合 recentExchange 为空数组；
6. 固定合约仅在 cache-first 模式出现 `recentExchange` 说明。

验证结果：`npm run typecheck` 通过；`npm test` 105/105 通过（含既有 99 个用例无回归）。

## 文档同步

- `README.md`：新增「主叙事 payload 顺序与前缀缓存」小节。
- `CONFIGURATION_GUIDE.md` §3.3：新增 `mainPayloadOrder` 条目与详细说明段。
- `docs/CHANGELOG.md`：beta6 段追加两条。
- `docs/ARCHITECTURE.md`「主叙事数据流」：补充两种顺序的说明。

## 回滚

将 `plugins/hds-interlude/backup/2026-08-31-payload-cache-first/` 下的三个文件复制回 `src/` 覆盖，并删除 `test/payload-order.test.ts` 即可完全恢复。配置层面：Console 中把 `mainPayloadOrder` 切回 `legacy` 即可即时回退行为（无需回滚代码）。

## 后续观察点

- 开启 cache-first 后对比日志中的`回复模式`分布（none/immediate/delayed 率）与剧本字数，确认无注意力偏移副作用；
- 实测服务商账单中缓存命中计费占比（DeepSeek/GLM 控制台可见）；
- 群聊与 advance 回合命中率低于私聊属预期，不必视为故障。

---

# 追加变更（同日）：固定合约瘦身（A+B+C 组）

- 备份：`plugins/hds-interlude/backup/2026-08-31-contract-slim/narrator.ts`（含 payload 重排后、合约瘦身前的完整快照）
- 范围：仅 `src/narrator.ts` 的 `systemPrompt`；未实施 D 组（可选融合项，暂缓）

## 删除（A 组，纯重复）

1. 删除整行 *"The plugin creates all transport records from structured fields…"*（192 字符）——被 *"Completed visible communication stays aligned across prose and transport…"* 首句 + interaction/groupReply schema 行三重覆盖。
2. 删除整行 *"Write only the portion of life that has reached now…"*（167 字符）——首句被 *"cover the supplied interval and stop at the supplied now timestamp"* + *"Do not put future prose into script"* 覆盖；尾句的意图枚举并入下一条（C1）。

## 修剪（B 组，只删半句）

3. *"Treat currentEvent, groupContext.messages…"* 删末句 *"When the protagonist thinks of an absent person…"*（165 字符）——与 *"The character may remember or wonder about an unobserved person, but must describe it as uncertainty…"* 同规则，保留更精确的后者。
4. *"Create an active-consequence only when…"* 删第二句 *"In later scenes, let activeConsequences work quietly…"*（149 字符）——纯氛围句，操作性内容（specific and temporary / not a replacement for canon）已在第一句。

## 合并（C 组）

5. 时钟行吸收 L1150 的独有措辞，新文：*"The script must cover the supplied interval and stop at the supplied now timestamp; later possibilities remain intentions, hesitations or structured delayed actions with a time after now, never prose. currentEvent is the only source of what is happening now. Historical entries never become a new event."*（+118 字符）
6. **refreshContinuity 双变体恒定化**：原来系统提示在 refresh 轮与非 refresh 轮使用两条不同文本，每 15 轮击穿一次整个前缀缓存。现合并为一条恒定行（*"Continuity: when payload refreshContinuity is true, … otherwise output no continuity field…"*），由 payload 的 `refreshContinuity` 标志驱动行为。系统提示自此跨全部轮次逐字节一致。函数第 7 参重命名为 `_refreshContinuity`（保留签名兼容，`--noUnusedParameters` 要求）；调用点位置传参不受影响。

## 实测净账（字符串精确测量）

| 轮次 | 修改前 | 修改后 | 差额 |
| --- | --- | --- | --- |
| 非 refresh 轮 | 12,899 字符 | 12,648 字符 | -251（-1.9%） |
| refresh 轮 | 13,093 字符 | 12,648 字符 | -445（-3.4%） |

主要收益不是静态缩减本身，而是**系统提示恒定化**：refresh 轮不再击穿 system + payload 前缀缓存（省约 16k tokens 重填，摊薄约 1.1k tokens/轮）。

## 测试影响

- 修改前核对：被删 4 处无任何测试断言引用；恒定行保留 `Do not copy or create free-text future plans`（`memory-continuity.test.ts` 断言）且不含 `"next":[`（doesNotMatch 断言）。
- 修改后验证：`npm run typecheck` 通过；`npm test` 105/105 通过。

## 回滚

将 `backup/2026-08-31-contract-slim/narrator.ts` 复制回 `src/` 覆盖即可（注意：该快照已包含同日 payload 重排，回滚会一并撤销 payload 改动；如需仅回滚合约部分，按上文六条反向编辑）。

---

# 追加变更（同日）：次级优化三项（贴纸语义过滤 / 视觉降采样 / 紧凑标签）

- 决策记录：贴纸过滤开关放 Console Embedding 区（默认开启，top-12）；视觉降采样用 Puppeteer 复用方案并加 Console 开关（有 Puppeteer 时默认 1024）；紧凑标签挂靠 `mainPayloadOrder=cache-first`，不新增配置。
- 备份说明：本批次开始编辑前未拍整文件快照（narrator.ts 已有 contract-slim 快照覆盖前态）；`backup/2026-08-31-secondary-optimizations/` 保存的是**改后**参考快照（narrator/service/types/index/database 五文件）。本批次全部为加法式修改，按下文逐条反向编辑即可精确回滚。

## 子项 1：贴纸目录语义过滤（top-12）

- `src/database.ts`：`interlude_sticker` 表新增 `embedding: 'json'` 列（koishi 启动时对存量表自动 ALTER）。
- `src/types.ts`：`StickerAsset` 新增 `embedding?: number[]`。
- `src/service.ts`：
  - 新增导出常量 `SEMANTIC_STICKER_LIMIT = 12` 与纯函数 `rankStickerCatalog(assets, queryEmbedding, limit)`（cosine 降序，无向量素材排在有向量素材之后仍可补位，半索引库优雅降级）；
  - `stickerCatalogForSession` 改为 async 并接收 `queryText`，内部经 `rankStickerAssets`：开关开启、消息非空、目录数 > 12 时对消息做 1 次 embedding 并取 top-12；Embedding 不可用/失败/素材未索引时**回退全量目录**；
  - 两个调用点（私聊 flush、群聊 flush）改为 `await` 并传入回合消息文本；
  - `scanStickerLibrary`：描述生成成功后立即向量化该素材；每轮扫描末尾 `backfillStickerEmbeddings()` 补齐最多 8 条缺失向量（先 refresh 内存目录再补缺，补完再 refresh 拉回内存）；
  - 新增 `semanticStickerEmbeddingEnabled()` 读取 `embedding.semanticStickerFilter`。
- `src/narrator.ts`：`EmbeddingConfig` 新增 `semanticStickerFilter?: boolean`。
- `src/index.ts`：embedding 分区新增开关（默认 `true`），`EmbeddingConfig` 默认值对象同步。

## 子项 2：视觉输入降采样（Puppeteer）

- `src/narrator.ts`：`VisionConfig` 新增 `maxImageDimension?: 0 | 512 | 768 | 1024`。
- `src/service.ts`：
  - 新增导出纯函数 `shouldDownscaleImage(mimeType, dataUri)`：仅 `jpeg/png/webp`、二进制 ≥150KB 才进入降采样（GIF/动图有独立抽帧路径，小图不值得重渲染）；
  - 新增 `downscaleImageForVision`：复用 `withBrowserSlot` + `<img>` max-width/max-height 渲染 + `element.screenshot({ type:'jpeg', quality:85 })`，viewport 强制 `deviceScaleFactor:1`；结果比原图更大时透传原图（永不增大 payload）；Puppeteer 不可用/任何异常都静默透传；浏览器渲染顺带应用 EXIF 方向；
  - 挂接点：`imageBytesToNative` 的静态图片出口（动图抽帧路径保持原样，不在本次范围）。
- `src/index.ts`：Vision 分区新增 `maxImageDimension`（默认 `1024`；0=关闭）。

## 子项 3：recentScript 紧凑标签（挂靠 cache-first）

- `src/narrator.ts`：
  - 新增导出函数 `compactScriptTag(kind, actor)`：`protagonist-delivered-message` → `protagonist`（`character-group-message` → `protagonist(group)`、`character-platform-action` → `protagonist(action)`）；其余 ownership 映射为 `user` / `protagonist-narration` / `group-member` / `system`；
  - cache-first 分支的 `recentScript` 条目变为 `{ id, tag, content, occurredAt }`；`participantId` 仅当条目历史中出现 **>1 个不同的非空** participantId 时保留（纯数据驱动；非共享模式下服务层本就过滤他者条目）；`content` 继续走 `promptVisibleMessageContent`；
  - `recentExchange` 尾块同步改用 `tag`；
  - 合约：cache-first 模式下 ownership 长句替换为 7 个紧凑标签的图例（保留"thought about the user is not a thought by the user"要点），legacy 模式原句不变。
- legacy 模式逐字节不变的承诺继续成立。

## 配置汇总

| 配置项 | 位置 | 默认 | 说明 |
| --- | --- | --- | --- |
| `embedding.semanticStickerFilter` | Console 模型 → embedding | `true` | 贴纸目录语义过滤开关，top-12 注入 |
| `vision.maxImageDimension` | Console 模型 → vision | `1024` | 降采样最长边；0 关闭 |
| `mainPayloadOrder` | Console 模型 | `legacy` | 紧凑标签随 `cache-first` 启用 |

## 验证结果

- `npm run typecheck`：0 错误（修复了 VisionConfig 字面量联合类型、cache-first 条目 occurredAt 已为字符串两处编译问题）；
- `npm test`：**112/112 通过**（新增 7 个：tag 矩阵、participantId 条件、合约图例模式、rankStickerCatalog 排序/补位/透传、SEMANTIC_STICKER_LIMIT、shouldDownscaleImage 门控矩阵；更新 1 个：recentExchange 断言 ownership→tag）；
- 实现中发现并修正的测试问题：视觉门控夹具 200k base64 实际折算 146KB 未过 150KB 阈值（夹具改为 220k）。

## 文档同步

- `CONFIGURATION_GUIDE.md` §3.5：`vision.maxImageDimension`、`embedding.semanticStickerFilter` 两条说明。
- `docs/CHANGELOG.md`：beta6 段追加三条。

## 回滚

本批次为加法式修改：按上文三条子项逐条反向编辑，或将 `backup/2026-08-31-secondary-optimizations/` 的五个文件覆盖回 `src/` 即可回到本批次完成后的状态（连同此前备份可逐级回退到 payload 重排前）。运行时回退：Console 关闭 `semanticStickerFilter`、`maxImageDimension=0`、`mainPayloadOrder=legacy` 即可即时恢复旧行为，无需回滚代码。

---

# 追加变更（同日）：记忆召回三件套（previousScenes / workingDetails / semanticHistory）

- 决策记录：场景摘要每条裁 2000 字符（用户指定）；压缩合约**不**加"只记录双方言行"防污句（用户否决）；历史召回**全表加载**（用户指定，不做时间窗）+ 故事级内存向量缓存；抗复读（openers 清单 / n-gram 重写）本次不做。
- 备份：`backup/2026-08-31-memory-recall/`（修改前五文件快照）。

## P1 previousScenes（默认开启）

- `types.ts`：新增 `PreviousSceneSummary`；`SceneContext` 增 `previousScenes?`。
- `service.ts`：`MemoryConfig` 增 `previousSceneSummaries`（默认 2）；decide() 的 Promise.all 增 closed-scenes 查询（按 endedAt 倒序取 2），每条 summary 裁 2000 字符，连同 `startedAt/endedAt` ISO 时间范围并入 `sceneContext`。
- `index.ts`：memory 分区新增 `previousSceneSummaries`（0=关闭）；`contextEntryLimit` 默认 20 → **50**（受 12k 字符预算硬约束；cache-first 下增量近免费）。
- 合约新增静态行（三行之一，见下）。

## P2 workingDetails 工作暂存（默认开启）

- `types.ts`：新增 `WorkingDetail` / `WorkingDetailDraft`；`StoryState.workingDetails?`；`CompactionDecision.workingDetails?`；`NarrativeRequest.workingDetails?`。
- `narrator.ts`：压缩 JSON schema 增加 `workingDetails` 字段与提取规则（"codes, orders, errands, tiny pending promises… Do not duplicate durable facts"）；`toCompactionPayload` 携带 `existingWorkingDetails` 供压缩器增改；主合约新增静态行（"quietly as living background; never recite the list"）。
- `service.ts`：`normalizeStoryState` 经 `normalizeWorkingDetails` 规范化（按 label 去重、值 300 字符、上限 10）；`persistCompaction` 合并压缩器草稿（`hasCompactionEvidence` 证据校验 + label 去重 + 过期过滤 + cap 10）写回 story.state；decide() 经 `pruneWorkingDetails`（过滤过期、cap 10）注入 payload **稳定区**。
- 冲突修复：`storyStateForPrompt` 剥离 `workingDetails`，避免 evolvingState 与独立字段双重注入。

## P3 历史语义召回（默认关闭）

- `database.ts`：`interlude_script_entry` 增 `embedding: 'json'` 列。
- `types.ts`：`ScriptEntry.embedding?`；新增 `RecalledMoment`；`NarrativeRequest.recalledHistory?`。
- `service.ts`：
  - 故事级内存向量缓存 `historyVectors`（entry id → vector + 清洗后 content + occurredAt）+ `historyVectorsReady` 标记；`ensureHistoryVectors` **全表加载**（无时间窗，用户指定），失败回退标记重试；
  - `backfillHistoryEmbeddings`：后台向量化，最新优先，每轮 `max(8, backfillBatchSize*3)` 条，渐进覆盖全表，增量写回缓存；挂载于 compactStories 维护轮；
  - `recallHistory`：余弦打分、阈值 0.25、top-3、排除 recentScript 窗口内条目 id、单条裁 300 字符；仅私聊实时回合注入；
  - **查询向量统一**：flush 层每轮最多计算一次 `turnQueryEmbedding`（`semanticTurnEmbeddingEnabled` = liveQuery || semanticStickerFilter || semanticHistory 任一开启），穿透 tryDecide/decide，供贴纸过滤、事实语义排序（仅 liveQuery 时启用）与历史召回共用；
  - 缓存内容与 recentScript 同源清洗（`promptVisibleMessageContent`）。
- `narrator.ts`：`EmbeddingConfig.semanticHistory?`；主合约新增静态行（被动语态："reference them only when it arises naturally, never recite them"）。
- `index.ts`：embedding 分区新增 `semanticHistory`（默认关闭）。

## 验证结果

- `npm run typecheck`：0 错误。
- `npm test`：**114/114 通过**（新增 3 个 payload/合约测试；更新 1 个默认值断言 20→50）。
- 实现中发现并修复：① decide 末参误覆盖 onEarlyReply（已恢复双参数）；② decide 首项被降级为普通 recentEntries（已恢复 recentEntriesForPrompt 的"条数 ∪ 时间窗"语义）；③ workingDetails 在 evolvingState 与独立字段双重注入（storyStateForPrompt 已剥离）。

## 剧本失真专项审查（对话生活连续剧本化视角）

以"生活剧本为中心、聊天只是进入生活的自然事件"这一核心哲学逐项检视近期全部改动，结论：**无结构性失真，两处已知张力需观察，一处哲学增强**。

1. **previousScenes / arc 的"摘要声音"**：压缩器散文获得既定事实地位，若压缩模型写下推断性结论（如此前"伪造截图"污染），会随注入传播。用户已否决防污合约句——已知的接受风险。观察方式：`interlude.context` 定期人工核对 previousScenes 摘要。
2. **recentExchange 尾块把聊天放在最强 recency 位**：与"聊天只是生活的一部分"存在轻微张力。缓解事实：尾块按条目种类不限选取，script（主角内心生活）同样可进入；且 mainPrompt 的生活中心哲学在 system 层恒定。观察项：若模型回复越来越"聊天腔"，可将尾块改为强制含 1 条 script 条目。
3. **currentEvent 移至 payload 末尾最强位**：强化了"当前事件"的显著度——方向正确（它本就是本轮的决策焦点），且生活重心由恒定合约与 recentScript 的 ownership 标签共同锚定。
4. **workingDetails 的机器人化风险**：结构化小事实若被逐条复述会显得机械。合约已写"never recite"；过期机制（6h）保证遗忘的自然性。
5. **recalledHistory 的"翻旧账"风险**：被动语态框架 + top-3 + 0.25 阈值限制；若出现强行引用旧事的行为，优先调高阈值或降低条数。
6. **贴纸语义过滤的表达收窄**：top-12 相关性注入可能降低表情表达的随机多样性。缓解：description+aliases 语义覆盖了"表达用途"，且 12 条仍留有选择空间。观察项。
7. **视觉降采样 512 档**：截图小字不可读可能引起误读——默认 1024 规避；文档已提示。
8. **哲学增强**：workingDetails + semanticHistory 让"生活里的小事"（取餐码、随口的承诺）真正进入角色的工作记忆——这恰是"生活在幕间继续"的拟真核心；previousScenes 让场景过渡具有生活质感。三者都是对原始哲学的补强而非偏离。

## 回滚

`backup/2026-08-31-memory-recall/` 五文件覆盖回 `src/` 即回滚本批次。运行时回退：`previousSceneSummaries=0`、`semanticHistory=false` 即关闭两个新特性（workingDetails 随压缩器内建、无独立开关，但注入为空无害）。

---

# 追加变更（同日）：Schedule Preplan 每轮重试风暴与串行队列延迟修复

## 现象（用户实测）

1. 每发一句话就触发一次"后台整理"（日志可见 条目=2/字符=30 的迷你整理，SchedulePreplan=true）。
2. Schedule Preplan 始终不生成（日志：`Schedule Preplan 尚未生成：压缩模型没有返回可用日程`）。
3. 第一句与第二句之间间隔特别久。

## 根因（三个问题叠加）

1. **重试风暴**：`schedulePreplanReviewDue` 对"无记录"恒判 due；压缩模型没有返回 `schedulePreplan` 字段 → 记录永远不创建 → 每个用户回合结束后的 scheduleCompaction 都带着 review 再跑一次压缩模型调用。
2. **串行队列阻塞**：`scheduleCompaction` 把整个 `compactUnlocked`（含压缩模型 LLM 调用，10-60s）放进故事串行队列。守卫只在任务**启动时**检查 `hasPendingNarrative`——用户在该检查之后、模型调用期间发消息，消息的叙事回合就排在压缩调用后面 → 消息间隔巨长。
3. **首次生成指引缺失**：压缩合约对 `current=null`（首次创建）的场景没有明确指令，弱模型倾向省略 `schedulePreplan` 字段；且 `applySchedulePreplanProposal` 对"无记录 + 空 regimes"返回 undefined（合理），两者叠加导致记录无法建立。

## 修复

1. **失败退避**：新增 `schedulePreplanBackoff`（内存 Map），生成失败后 2 小时内不再尝试（`SCHEDULE_PREPLAN_RETRY_BACKOFF = 2h`）；成功则清除。
2. **串行拆分（修正版）**：`compactUnlocked` 拆为 `prepareCompaction`（廉价读取 + due 判断）→ 压缩模型调用（**不占队列**）→ `applyCompaction`（廉价 DB 写）。⚠️ 第一版拆分曾把模型调用留在串行任务内、并用嵌套 `this.serial` "重新入队"落库——promise 链式队列无法从自身运行中的任务再次进入，导致**整条故事队列永久死锁**（症状：一轮整理后所有后续消息只有"收到/内容"日志、无入队、无模型调用、永不回复；该死锁批次安装于 08-31 07:26，如实例在此时间后未重启仍会复现）。修正版：Phase 1（串行：prepare）→ Phase 2（队列外：模型调用）→ Phase 3（串行：落库），全程无嵌套。
3. **首次生成指引**：压缩合约补一句"current 为 null 时返回 outcome=replace + 证据推导的 regimes（证据不足时返回空 regimes 数组），始终返回 schedulePreplan 字段"。
4. 顺带修复：`PreparedCompaction` 联合类型的布尔判别式（skip: true/false）在本项目 `strictNullChecks: false` 配置下不收窄（TS 行为，探针复现确认），改为字符串判别式 `phase: 'skip' | 'run'`。

## 死锁事故记录（08-31 07:26–重启前）

- 07:26 安装的批次含嵌套 serial 死锁：首轮整理（07:38:51，23 条，场景压缩 true）在压缩模型返回（07:39:11，Token 用量[压缩] 已打印）后卡死在嵌套 apply 上，`后台整理完成` 永不打印；其后三条用户消息（"这样吗。。雅思考虑了吗"/"？"/"怎么不回我"）阻塞在 `receive → serial(appendEntry)`，未落库、未入队、未被回答——**这三条消息已丢失**（重启后也不会补答）。
- 教训：promise 链式串行队列内严禁再 `await serial(同一 id)`；跨阶段的"重新入队"必须把后续阶段移出当前任务。

---

# 追加变更（同日）：Console 描述统一（subtle 微调）

- 范围：仅描述文案，无任何行为/默认值/字段变更；共 19 处编辑（12+3+4），全部逐条断言唯一匹配后替换。

## 统一规则

1. **名词**：请求管线统一称「主叙事」；连接对象统一称「连接」（不再混用"服务商/主服务商/主模型"）。指模型本体的"主模型"（如"允许主模型…"）保留。
2. **布尔句式**：功能总开关 = 「启用 X：说明」；行为修饰开关 = 「是否…」。涉及：blindMode.enabled、onebot.voiceTranscription.enabled、browser.groupBrowsing、embedding.semanticStickerFilter/semanticHistory。
3. **去重**：vision 分区描述与 enabled 字段描述原本内容重叠且措辞不同，现在分区只讲用途、字段只讲边界。

## 逐条清单（src/index.ts）

| # | 旧 → 新要点 |
| --- | --- |
| 1-3 | failover 三条：主服务商/服务商 → 主叙事连接/连接 |
| 4 | compaction 分区：主模型请求 → 主叙事请求 |
| 5 | memoryLimit：主模型读取 → 主叙事读取 |
| 6 | splitMessages：主模型回复 → 主叙事回复 |
| 7-8 | vision 分区与 enabled 去重统一 |
| 9-10 | semanticStickerFilter / semanticHistory 加「启用」前缀 |
| 11 | priceCachedInput：为 0 时 → 0 表示（与 priceInput/priceOutput 对齐） |
| 12 | proactiveWillingnessThreshold：主模型 → 主叙事 |
| 13-15 | memory 组 recentEntryLimit/factLimit/activeConsequencePromptLimit：主模型 → 主叙事 |
| 16 | liveQuery 两份措辞对齐（完整说明版） |
| 17 | blindMode.enabled：沉浸运行 → 启用沉浸运行 |
| 18 | browser.groupBrowsing：允许群聊…产生 → 启用群聊浏览意图 |
| 19 | voiceTranscription.enabled：句式补全「启用…默认关闭。」 |

另修复 `CONFIGURATION_GUIDE.md` 小节编号遗留（### 8.1–8.4 → 10.1–10.4，与 `## 10. memory` 对齐）。发现 `Embedding` 常量是死代码（`void Embedding`，不进 Console），其描述未动。

## 验证

- `npm run typecheck` 0 错误；`npm test` 119/119 通过。

## 验证

- `npm run typecheck` 0 错误；`npm test` 119/119 通过。
- 预期行为变化：Schedule Preplan 首次生成失败后 2 小时内不再重试（日志不再出现每轮迷你整理）；压缩模型调用不再阻塞用户消息的叙事回合。

---

# 追加变更（同日）：Token 用量与计费日志

- 需求：在 Koishi 日志中查看每次模型调用的输入/输出 token、缓存命中量与命中率；Console 中可选配置每条模型连接的输入/输出/缓存单价（每百万 tokens），日志同步输出计费合计与缓存节省。

## 实现

- `src/narrator.ts`：
  - 新增导出类型 `TokenUsageRecord`（task/providerLabel/model + inputTokens/outputTokens/cachedInputTokens + 三个价格字段）与纯函数 `parseTokenUsage`（兼容 OpenAI `prompt_tokens_details.cached_tokens` 与 DeepSeek 遗留 `prompt_cache_hit_tokens`）、`aggregateTokenUsages`（跨 failover 尝试与恢复重写求和，身份/价格取最后一条即最终产出答案的尝试）、`computeTokenCost`（缓存命中为输入子集、按缓存价计费，报告 saved）、`formatTokenUsageLine`（缺失字段自动省略，价格全 0 时无计费段）。
  - `ChatCompletionResponse` 增 `usage?: unknown`；两条流式助手（`requestZhipuStreaming` / `requestOpenAICompatibleStreaming`）增 `collectUsage?` 尾参，从流内 `usage` 块（含网关回退为普通 JSON 体的场景）读取。
  - `OpenAICompatibleNarrator` 构造器增第 4 参 `onUsage?`；新增 `collectUsage`/`emitUsage`；`decide`（主叙事，跨 failover 汇总，try/finally 保证失败路径也发射）、`compact`（压缩）、`compactOverlay`（Overlay 整理）、`analyzeAlter`（Alter 分析）、`describeSticker`（贴纸描述）五个任务全部接入。
  - 工厂函数 `createNarrator/createCompactor/createStickerDescriber` 透传 `onUsage`。
- `src/service.ts`：构造器创建统一的 `onUsage` 回调（四个实例共享），`reportTokenUsage` 输出一行 `Token 用量[任务] 模型=… 输入=…（缓存 …，命中率 …） 输出=… 计费合计=…`；走 `reportStandalone`，自动遵循失明模式与日志级别。
- `src/index.ts`：`ProviderCommon` 新增 `priceInput` / `priceOutput` / `priceCachedInput`（默认 0 = 未配置）。

## 覆盖范围与边界

- 覆盖：五类 chat-completions 任务（主叙事含 failover 与恢复重写、压缩、Overlay 整理、Alter 分析、贴纸描述）。
- 不覆盖：`/embeddings` 调用（语义检索/向量化）与无 `usage` 字段的服务商——这些调用自动省略用量行，不影响其它日志。
- 流式路径：仅当服务商在流内输出 `usage` 块（OpenAI 标准 `stream_options.include_usage` 行为、智谱末块、多数网关）时可用；否则该次调用无用量行。
- 缓存命中率 = `cachedInputTokens / inputTokens`；部分网关的 usage 本身未拆分缓存时，命中率段自动省略。

## 验证

- `npm run typecheck`：0 错误；`npm test`：**119/119 通过**（新增 `test/token-usage.test.ts` 5 个用例：解析双格式/未知形态、聚合身份与价格、缓存子集计费与节省、无价格不输出计费段、格式化命中率）。
- 实现中发现并修复：requestProvider 非流式分支误改写为未 await 的 Promise（`string | Promise<string>` 类型错误 ×5）——统一为 async IIFE 内部 await 并顺序化 `collect → extractChatText`。


---

# 追加变更（2026-09-02）：聊天节奏反定型（ChatRhythm）

## 背景

Desktop 实例实测：近 4 天主角回复的气泡数分布为 1×205 / 2×192 / 3×3，双气泡呈现固定模板（5 字吐槽 + 短促反问收尾，占双气泡的 73%）——模型陷入"节奏定型"。现有合约只定义 `<sep/>` 语法，无任何节奏多样性机制。

## 设计（与 Alter 同源但更激进）

- **检测零 LLM 成本**：Alter 依赖模型自报 alter 值；ChatRhythm 由宿主从已投递全文直接提取签名（bubbles/shape/tail/totalChars），不可谎报、每轮 <1ms。
- **四条激进判据**（balanced 档）：a) 3 轮结构完全同构；b) 4 轮同气泡数同长度档；c) 尾段语气复读且字数差 <4；d) 5 轮总字数极差 ≤6。任一命中即定型。
- **三档检测策略**：gentle（仅判据 a）/ balanced（a-d，默认）/ aggressive（样本要求 4 轮）。
- **主角视角注入**（核心约束：绝不泄漏系统口吻）：`chatRhythm: { state, drift }`——state 以角色名开头的打字习惯描写，drift 是"真正的她说话有节奏"的召唤；测试用回归断言禁止出现"气泡/结构/必须"等系统词汇。
- **三档措辞升级**：streak 1-2 轻微（"有点单一"）→ 3-4 明显（"这已经是惯性了，不是她"）→ ≥5 直接指定具体结构（单条长消息/三段连发/一个词，按轮轮换防反制自身僵化）。
- **熔断**：streak ≥ exhaustLimit(6) 且 level-3 无效 → `exhausted = true`，停止注入；换主叙事模型或 Console 重置恢复。

## 接线

- `src/chat-rhythm.ts`（新，~150 行纯函数）；`types.ts` 四接口 + `StoryState.chatRhythm`；`NarrativeRequest.chatRhythm`（每轮区）。
- `service.ts`：`confirmOutgoingDeliveries` 内检测更新（try/catch 包裹，故障不影响投递确认主流程；对缺 getStory 的测试桩天然跳过）；`decide()` 注入；`chatRhythmConfig` getter。
- `narrator.ts`：合约 +1 行（稳定区）；legacy 与 cache-first 两侧 payload 序列化；`storyStateForPrompt` 剥离内部状态防双重注入。
- `index.ts`：Console 新分区 `chatRhythm`（编号 12，含三档 mode）。

## 验证

- typecheck 0 错误；**146/146 测试**通过（新增 10 个用例：提取/宽限期/四判据/三档差异/解除/熔断/主角视角词汇回归/自由期零注入）。
- 实现中被测试抓出的问题：① 宽限期用 3 而非规范值 5（检测器修正）；② 偏离轮样本自身落入字数箱体（测试夹具修正为真正多样的样本）；③ 自由期残留 lastDirectiveLevel（语义修正：自由期不留痕迹）；④ 对无 getStory 的测试桩崩溃（try/catch + typeof 守卫）。

## 备份

`backup/2026-09-02-chat-rhythm/`：实现前全量源码快照（含一次误操作的 types.ts 已从此处恢复）。
