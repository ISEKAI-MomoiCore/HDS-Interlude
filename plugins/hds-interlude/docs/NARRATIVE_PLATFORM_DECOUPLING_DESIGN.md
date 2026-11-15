# 叙事核心与平台接入解耦设计（Narrative / Platform Decoupling）

文档性质：行为不变的代码组织重构计划。**状态：v1.1 · D0–D4 全部实施完成（2026-10-30）**（§4.5 提示词语义层；各切片实施记录见 §6）。基线：`1.0.1-rc59` 工作区（2026-10-30）。全程不修改任何功能实现、提示词、日志文案与数据形态——与 [SERVICE_EXTRACTION_PLAN.md](SERVICE_EXTRACTION_PLAN.md) 同一纪律，每个切片以"typecheck 零错误 + 全量测试全绿"为硬门槛；QQ 路径另加"合约逐字节不变"门槛（§4.5）。

> 一句话定位：让"一段生活的写作回合"与"消息从哪个平台进出"彻底分层——核心叙事引擎（状态机、模型调用、落库、重试）对平台无感知；QQ/OneBot 只是第一个平台适配器，Discord/Telegram 各加一个适配器即可接入，叙事核心零修改。

---

## 0. 结论摘要

- **turn-engine.ts 本体不是问题**：它是无 IO 的状态容器（定时器与日志均注入），仅三处轻度耦合（§2.1）。
- **问题在执行体**：回合的执行编排（`flushBufferedNarrative` 约 250 行、`flushGroupTurnUnlocked` 约 200 行，均在 service.ts）把叙事步骤与平台操作逐行交错，模型调用边界直接焊接平台投递回调（§2.2）。
- **量化依赖面**：叙事侧 5 个模块直接 import koishi `Session`；11 个模块直接 import QQ 假设层 `session-platform`；`turn.latestSession` 在 service 有 12 个消费点（§2.3）。
- **基础比预期好**：消息缓冲的形状已是中性 token、端点注册表已是平台中立寻址、入站平台假设已有清单文档、P8 系列迁移建立了正确的模块形态（§3）；提示词输出协议层（语义枚举）也已半中立，仅六处措辞/类型绑定（§4.5）。
- **路线**：五个行为不变切片（D1–D4 含 D2.5）+ 一个纯盘点切片（D0），把"平台能力/媒体回源/投递"收拢到 PlatformAdapter 端口后面，把叙事编排提取为 NarrativeTurnExecutor；合约平台词汇经模板参数注入，QQ 路径逐字节不变（§6）。

## 1. 背景与动机

多通道路线图（[MULTI_CHANNEL_IMPLEMENTATION_ROADMAP.md](MULTI_CHANNEL_IMPLEMENTATION_ROADMAP.md)、[MULTI_CHANNEL_SINGLE_STORY_DESIGN.md](MULTI_CHANNEL_SINGLE_STORY_DESIGN.md)）已解决**寻址层**的平台中立（UUID 端点身份、入站反向解析、端点状态）。但**回合执行层**没有对应抽象：以"迁移到 Discord/Telegram 时叙事核心零修改"为验收标准，现状不满足——叙事编排函数内部直接调用 QQ 媒体回源、OneBot 能力探测与 session 投递。

本设计与 SERVICE_EXTRACTION 计划互补：那是"把职责从 service.ts 搬进模块"；这是"给搬出来的模块划定平台边界"。两者共用同一套行为不变纪律。

## 2. 现状审计（基线快照）

### 2.1 turn-engine.ts 本体：合格的状态容器，三处轻度耦合

239 行，拥有 `turns`/`narrating` 两个状态容器与缓冲/信号/失效/补排方法。**无数据库、无 bot API、无网络**；`setTimeout` 与 `reportOperation` 均经 `TurnEngineDeps` 注入。这是目标形态的正确起点。

| # | 耦合点 | 位置 | 性质 |
| --- | --- | --- | --- |
| 1 | `latestSession?: Session` + `import type { Session } from 'koishi'` | turn-engine.ts:9,27 | 引擎状态持有宿主框架活对象。引擎不调用它（转交 service 使用），但类型依赖已进入核心模块；换平台后 Session 形状完全不同。回合状态中其实已有中性标识（`endpointId`、`sources[]`） |
| 2 | 日志契约携带叙事词汇（`InterludeStory` + phase 参数） | TurnEngineDeps.reportOperation | 可接受；记录在案 |
| 3 | `endFlush` 孤儿补排（180-188 行）混合状态清理与调度策略 | turn-engine.ts:163-189 | 纯逻辑可迁移，说明引擎边界已长出策略 |

### 2.2 真正的混杂点：两个 flush 执行体

**私聊 `flushBufferedNarrative`**（service.ts:3212-3460）单方法内两类关注点交错：

| 叙事核心（应留在引擎侧） | 平台/IO（应在适配器侧） |
| --- | --- |
| beginFlush/endFlush 状态机、revision 作废判定 | `privateChatCapabilities(turn.latestSession)`——QQ 表情/贴纸能力探测 |
| 故事串行锁内取快照、到期意图过滤 | `stickerCatalogForSession`——内部 `isOneBotPlatform` 门控 |
| `formatBufferedUserMessages`、引用消息整理 | `loadNativeImages`——QQ CQ 码/get_image 回源 |
| `tryDecide` 模型调用与 failover | `loadNativeAudio`——QQ SILK → SnowLuma 转码 |
| `persistDecision` 落库、游标推进、意图完成 | `deliverEarlyPrivateReply`——**投递回调焊在模型调用边界**（流式首泡） |
| 过期结果回队/丢弃、重试与跟进排程 | `deliverOutgoingMessages`、`sendSticker`（经 session 传输） |
| — | `canHandleParticipant` 平台门控、健康度记账（内联） |

**群聊 `flushGroupTurnUnlocked`**（service.ts:2499-2700）同样交错，另有意愿门、端点门控、`sendGroupMessage`。全链路最紧的耦合是 early streaming reply：投递动作作为回调参数传入 `tryDecide`，叙事与传输在类型签名层面绑死。

**投递管线**（delivery/pipeline.ts）已模块化，但内部直接 `import { normalizeGroupId, isOneBotPlatform } from '../session-platform'`——它是"为 QQ 写的管线"，不是"经端口接平台的管线"。

### 2.3 依赖面量化

| 指标 | 数值 | 含义 |
| --- | --- | --- |
| 叙事侧直接 import koishi `Session`/`h` 的模块 | 5（intents、turn-engine、narrator、narrative-normalizers、compaction/pipeline） | 核心模块对宿主框架的类型依赖 |
| 直接 import `session-platform`（QQ 假设层）的模块 | 11（含 narrative-normalizers、delivery/pipeline、service） | QQ 假设渗入叙事与投递两侧 |
| `turn.latestSession` 在 service 的消费点 | 12（能力/图片/语音/投递/贴纸） | 单一字段承载全部平台操作入口 |

### 2.4 已被测试形态证实的耦合代价

群聊回合的测试（如 group-audio.test.ts）要触达 `tryDecide`，必须伪造 10+ 个平台函数（媒体加载、能力探测、贴纸目录、投递、端点门控）。这正是执行体交错的直接后果：无法只测叙事流。

## 3. 已有资产（不必从零开始）

1. **消息缓冲形状已是中性 token**：`BufferedUserMessage` 的 `imageSources: string[]`、`audioSources: string[]`、`quote` 均为抽象引用；CQ 码/SILK 的解释发生在 media-loading/session-platform，不在引擎。
2. **端点注册表 + UUID 身份**（MULTI_CHANNEL_SINGLE_STORY_DESIGN）：平台中立的寻址层，`endpointId` 已流经回合状态（`sources[]`/`activeSources`/`recordSource`）。
3. **入站平台假设清单**（[PLATFORM_ASSUMPTIONS_INBOUND.md](PLATFORM_ASSUMPTIONS_INBOUND.md)）：入站侧 QQ 假设已有完整施工图。
4. **P8 系列迁移形态**：inbound-gate/session-platform/delivery/compaction 以"宿主第一参数"独立成模块——模块形态正确，只是模块内部仍直连 QQ 假设。
5. **SERVICE_EXTRACTION 的切片纪律**：行为不变、符号名为准、逐片验收——直接沿用。

## 4. 目标架构：端口与适配器

```
┌─────────────────────────────────────────────────────┐
│ Narrative Core（平台无感知）                          │
│  TurnEngine（状态机，现 turn-engine.ts 去 Session 型）│
│  NarrativeTurnExecutor（编排：快照→模型→落库→重试）    │
│  decide / persistDecision / intents / scheduler …    │
└──────────────┬──────────────────────────────────────┘
               │ 仅经端口（接口，注入）
┌──────────────▼──────────────────────────────────────┐
│ PlatformAdapter 端口                                 │
│  capabilities(handle)                                │
│  loadImages(story, tokens, handle)                   │
│  loadAudio(story, tokens, handle)                    │
│  deliver(draft, handle, …) / deliverEarlyReply(...)  │
│  sendSticker(...) / stickerCatalog(handle, …)        │
│  中性回合句柄 { endpointId, channelId, platform }     │
├─────────────────────────────────────────────────────┤
│ OneBotAdapter（QQ，现有逻辑收拢包装，零行为变化）       │
│ future: DiscordAdapter / TelegramAdapter             │
└─────────────────────────────────────────────────────┘
```

要点：

- **端口是唯一边界**：叙事核心不得 import `koishi` 的 `Session`/`h` 类型（`h` 仅允许出现在适配器与消息渲染层）、不得 import `session-platform`。以 lint/审查规则固化（§6 D4 验收）。
- **中性回合句柄**取代 `latestSession`：`{ endpointId, channelId, platform }` 三字段均已存在于现有状态，只差把 Session 引用逐出引擎状态；OneBotAdapter 内部再由句柄解析回 session/bot（解析表已存在：端点注册表）。
- **early streaming reply 经端口回调**：`tryDecide` 的回调参数改为端口方法 `onEarlyReply(reply) => Promise<boolean>`，由适配器实现——叙事核心保留"首泡提前投递"语义但不知晓传输细节。
- **能力探测归端口**：`privateChatCapabilities`/`groupChatCapabilities`/sticker 目录的平台门控移入适配器；叙事侧只收到中性的能力快照。

### 4.5 提示词语义层（v1.1 增补）

端口解耦只保证"代码不依赖平台"，不自动保证"模型看到的合约平台中立"。对主叙事合约（narrator.ts 的 systemPrompt 拼装）单独审计的结论与对策：

**现状：半绑定**。输出协议层已相当中立——消息回应与原生表情都是语义枚举（`like/smile/laugh/heart/...`、`smile/laugh/sweat/...`），QQ 的 emoji/表情编码映射（`QQ_REACTION_IDS`/`QQ_NATIVE_FACE_IDS`）在投递侧渲染；语音/引用/本地表情包指令措辞已中立；`resolveNarrativeContractFeatures` 的板块裁剪机制就是现成的解耦基础设施。真正的绑定有六处：

| # | 位置 | 绑定内容 |
| --- | --- | --- |
| 1 | narrator.ts:1837 | nativeFace 指令措辞 "For a subtle native **QQ** face" |
| 2 | narrator.ts:2024 | 群身份规则 "The **QQ number** inside it is the stable identity"（概念通用，措辞绑定） |
| 3 | narrator.ts:1878/1924/2008 | CHANNELS 三段硬编码 "QQ and WeChat" 与 [QQ·私]/[微信·私] 标签示例——新平台标签与示例不一致会误导路由 |
| 4 | narrator.ts:2053 | 多平台传输段 "usable QQ and WeChat endpoints"（机制中立、措辞写死） |
| 5 | endpoints.ts:13 | `EndpointChannelKind = 'qq' | 'wechat'` 类型级二元枚举，[QQ·私] 标签由此拼出 |
| 6 | narrator.ts:1987/2012 | qzone 板块——**已被 feature.qzone 门控，属正确形态，不改**（见下原则） |

**两条设计原则**：

1. **参数化而非重写**：平台词汇（显示名、标签示例、表情叫法）作为合约模板参数由适配器注入，QQ 适配器传入与现状逐字节相同的字面值——QQ 路径的合约在解耦前后**零字节变化**，模型反应天然一致；新平台由自己的适配器传入词汇，语义规则共享。"解耦前后反应一致"由此从"测试问题"变成"构造性保证"。
2. **平台差异走适配器，平台专属功能走 feature 板块**：同一概念的不同平台形态（消息回应/表情/引用）抽象成语义动作 + 渲染表；无对应物的专属功能（QQ 空间）保留 feature 门控原样，**不发明通用抽象去套**——那会稀释叙事语义。

**跨平台"反应相似"的定义**：同一剧情输入下，模型产出的语义动作集合一致（回复文本、reply 模式、引用、延迟），平台差异只允许出现在能力可用性（能力快照协商）与渲染（语义→平台工件映射表）两处。实现上把现有 `chatCapabilities` 条件注入升级为"适配器提供能力快照 → 合约生成器按快照注入指令"。

**一致性验证三层证据**：

1. 合约快照测试：扩展 narrative-prompts.test.ts 为输入矩阵快照（能力快照 × feature 集 × payload）——QQ 场景断言逐字节不变（硬门槛），新平台场景断言词汇替换点正确；
2. modelCapture 实证：rc58 的主叙事 JSONL 采集做 A/B——解耦前后同输入完整模型 payload 对比，QQ 路径应为空 diff；
3. 能力快照 → 注入指令集的映射表测试，防止未来加功能漏配。

## 5. 目标与非目标

**目标**

1. 叙事核心（turn-engine、NarrativeTurnExecutor、decide/persist、intents、scheduler）编译时不依赖 koishi `Session` 类型与 `session-platform` 模块。
2. 新平台接入 = 实现一个 PlatformAdapter + 平台入站翻译（复用 PLATFORM_ASSUMPTIONS_INBOUND 的清单方法），叙事核心与数据模型零修改。
3. 叙事流可脱离平台伪造单测（假 adapter 即可驱动完整回合），消除 §2.4 的测试代价。
4. 全程行为不变：现有 QQ 路径的日志、时序、账本、数据形态逐字节一致（以既有测试网为证）。

**非目标**

- 不改任何功能实现、提示词、日志文案、投递节奏与数据形态。
- 不做多进程/并发模型改造；`serial()` 锁相位纪律原样保留。
- 不引入依赖注入框架；沿用构造注入 + service 委托的 Cordis 风格。
- 不在本计划内实现 Discord/Telegram 适配器（只保证"加适配器"这条路是通的）。
- 不追求 service.ts 归零（SERVICE_EXTRACTION 的收尾态定位不变）。

## 6. 分阶段实施计划（行为不变切片）

每个切片独立可合入、可回滚；验收统一为"typecheck 零错误 + 全量测试全绿 + 受影响测试文件的假宿主形态对比"。

### D0 接缝盘点与基线（纯测试/文档，无生产代码改动）——已完成（2026-10-30）

范围：为 §2.3 的三项指标写守卫测试（import 图断言：叙事模块不 import koishi/session-platform——先记当前值，D1-D4 逐步收紧）；给两个 flush 执行体补"步骤顺序特征测试"（现有 characterization 形态），把叙事步骤与平台步骤的调用顺序钉死，后续切片重排时以它为证。
验收：基线测试全绿；三项指标有数字快照。

### D1 中性回合句柄（turn-engine 去 koishi 类型）——已完成（2026-10-30）

实施落点：turn-engine.ts 新增 `TurnHandle`（platform/channelId/selfId/endpointId 纯数据）并删除 koishi import；service 侧入站时构造句柄并登记到有界解析表（`rememberTurnSession`/`sessionForTurnHandle`，128 通道逐出，惰性初始化兼容原型测试宿主），私聊 flush 的全部消费点改为"句柄取回会话"。群聊 `BufferedGroupTurn` 的会话直存按计划留给 D2/D4。落点测试：`decoupling-baseline.test.ts`（指标 1/3 已收紧）与 `flush-executor-characterization.test.ts`（步骤顺序基线）。

范围：`BufferedNarrativeTurn.latestSession: Session` → `latestHandle: TurnHandle`（`{ endpointId, channelId, platform }`）；service 侧在入站时构造句柄、在消费点经查表解析回 session（解析逻辑临时放 service 私有函数，D2 随端口一起迁走）。
验收：turn-engine.ts 无 `from 'koishi'` import；全量测试绿；`turn.latestSession` 的 12 个消费点行为不变（由既有测试网覆盖）。

### D2 PlatformAdapter 端口抽取（收拢平台调用点）——已完成（2026-10-30）

实施落点：`src/platform/adapter.ts`（端口接口，仅中性类型——TurnHandle + types.ts 数据形状，不依赖 koishi）与 `src/platform/onebot-adapter.ts`（QQ 首个实现：持有句柄→会话解析表（F3 引用语义自 service 迁入），包装宿主既有方法——函数本体与锁相位零改动）。service 侧：构造器挂适配器 + 惰性 getter（兼容原型测试宿主）；私聊 flush 的 8 个平台调用点（贴纸目录/能力/图片/语音/早期投递/常规投递/贴纸发送/表情发送）与入站登记、两处会话回收全部改经端口；`turnEngine` 与 `deliverEarlyPrivateReply` 可见性因此放宽（行为中立）。群聊路径按计划留给 D4。验收：步骤顺序特征测试逐项保持（适配器委托宿主方法，顺序零变化）；基线新增指标 4（端口调用点 ≥11、端口接口无 koishi 依赖）；全量 1068 测试 0 失败。

### D2.5 合约模板参数化（提示词层，§4.5 的落地切片）——已完成（2026-10-30）

实施落点：narrator.ts 新增 `PlatformContractWording` 词汇表（faceTerm/stableIdTerm/platformPair/tagListDual/tagListSingle，默认 = 现状 QQ 字面量）并参数化六处绑定；`NarrativeRequest.platformWording` 为注入点（暂无第二实现）；endpoints.ts 的 `EndpointChannelKind` 开放为字符串 + `channelDisplayLabel` 中心映射。验收：`test/narrative-contract-snapshot.test.ts` 六场景（单平台/双平台/双平台cacheFirst/端点选择/表情/lite）sha256 与改造前基线**逐字节一致**；自定义词汇注入测试证明替换点生效。原范围中"扩展 narrative-prompts.test.ts"以独立快照文件落地。
验收：QQ 与双平台（QQ+微信）场景的 systemPrompt 渲染与基线**逐字节一致**（快照测试为证）；新平台词汇注入点具备但暂无第二实现；全量测试绿。

### D3 叙事编排提取（NarrativeTurnExecutor）——已完成（2026-10-30，a/b 两片）

实施落点：`src/narrative/turn-executor.ts` 承载 `executePrivateNarrativeTurn`（D3a）与 `executeGroupNarrativeTurn`（D3b），service 保留同名薄委托（调用点与测试零改动）。私聊编排的平台交互全部经 PlatformAdapter（D2 已就位）；**范围调整**——群聊编排的平台调用（群能力/历史图片/群发/群反应）本切片经宿主调用，端口化随 D4 与群 latestSession 一并收拢（避免一次引入四个新端口方法的爆炸半径）。验收：D0 顺序特征测试逐项保持；新增"假 adapter"纯叙事用例（宿主平台函数全部为抛错型敌意桩，平台形状只剩端口桩）；全量 1072 测试 0 失败。
验收：执行体不再出现平台函数名；叙事编排可用假 adapter 单测（新增纯叙事用例：作废/回队/重试/首泡提交边界，不伪造任何平台件）；全量测试绿。

### D4 投递管线与残余去 QQ 直连——已完成（2026-10-30）

实施落点：① 群回合平台调用全部经端口（端口新增 adoptSession/groupCapabilities/historicalImages/sendGroupMessage/executeGroupReactions），`BufferedGroupTurn.latestSession → latestHandle`——全仓回合结构会话直存归零（指标 3 = 0）；② `normalizeGroupId`/`normalizeAccountId` 下沉 `src/platform/identity.ts`（HDSI 中立寻址空间，session-platform 再导出保持兼容），管理门（manageSessionDenialReason/isEnabledAccount）移入 session-platform；③ intents/compaction/narrative-normalizers 的 koishi `Time` 本地化、`Session` 类型结构化——叙事侧 koishi 导入仅剩 narrator（Context/Logger 为宿主框架耦合而非平台耦合，留待后续立项）。守卫收紧：指标 2 新增"叙事核心 ∩ session-platform = 0"强制断言。验收：全量 1072 测试 0 失败，群音频/意愿/顺序特征测试逐项保持。delivery/pipeline 内部的 QQ 假设保留（管线本身即 OneBot 传输实现，D2 包装后叙事侧已不可见）。
验收：守卫测试从"记当前值"转为"强制为零"；全量测试绿。

### 完成后的新平台接入成本（预期画像）

实现 PlatformAdapter 接口（约 8-10 个方法）+ 入站翻译层（按 PLATFORM_ASSUMPTIONS_INBOUND 的方法为新平台列假设清单）+ 端点注册表登记。叙事核心、数据模型、调度、记忆、Console 全部零修改。

## 7. 风险与对策

| 风险 | 等级 | 对策 |
| --- | --- | --- |
| flush 执行体重排引入时序回归（锁相位/回队边界） | 中 | D0 先钉顺序特征测试；切片最小化（D3 拆私聊/群聊两片）；SERVICE_EXTRACTION 同类重排已有成功先例 |
| early-reply 端口化改变流式首泡时序 | 中 | 端口回调签名保持 `Promise<boolean>` 语义；现有 typing-floor/streaming 测试为证；D3 单独验收该项 |
| 句柄→session 解析表与端点注册表状态漂移 | 低 | 解析复用端点注册表现有表；D1 加解析失败的特征日志（不新增行为，仅既有 diagnostic 通道） |
| 适配器包装层成为新的"上帝接口" | 低 | 端口方法 ≤10 个；能力探测返回快照对象而非逐字段函数，避免碎接口 |
| 大文件切片拖长评审 | 低 | 每片独立 PR/commit；符号名为准（行号仅基线参考） |

## 8. 与既有计划的关系

- **SERVICE_EXTRACTION_PLAN（已关闭）**：本设计是其精神续作——"迁出后划边界"。P8 系列产出的模块形态（宿主第一参数）是 D2 包装层的直接基础。
- **MULTI_CHANNEL 系列**：寻址层已平台中立；本设计补齐回合执行层，两份文档合起来构成多平台改造的完整图纸。
- **PLATFORM_ASSUMPTIONS_INBOUND**：入站侧假设清单方法将在新平台接入时复用（D 阶段不改动它）。
- **CONSOLE_CONFIG_CENTER_DESIGN**：无关（Console 配置面），互不阻塞。

## 9. 开放问题（评审时定）

1. `h`（Koishi 消息元素）在出站消息渲染中的使用边界：是否允许出现在适配器内（倾向允许），叙事侧一律字符串/结构化草稿（`OutgoingMessageDraft` 已是此形态）。
2. qzone-executor / sticker-library 的 QQ 依赖归属：随 OneBotAdapter 收拢，还是独立 QQ 专属模块（倾向后者——它们是 QQ 专属功能而非平台差异）。
3. 桌面桥（desktop-bridge）在端口中的位置：属于 OneBotAdapter 的内部实现细节，还是独立端口（现状它在 delivery 管线内作三级路由的一级，倾向随适配器收拢）。
4. D3 是否需要把群/私聊两个执行体合并为参数化单编排（倾向不合并——两者门控语义差异大，合并会引入伪对称）。
