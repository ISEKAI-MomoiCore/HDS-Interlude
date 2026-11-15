# P8 入站接收：切片设计与调研结论

文档性质：P8（SERVICE_EXTRACTION_PLAN 最后阶段）的开工前专项设计。行号为 2026-10-29 P7 完成后的工作区快照（service.ts 共 8979 行）。

**实施状态（2026-10-29）**：S1–S4 已完成（service.ts 8979→7805；贴纸 28/媒体 23/历史 34/群动作 32 专项全绿，全量与基线一致；详见主计划跟踪表）。**S5 已于同日实施完成**（因 Telegram 接入计划提前触发）——receive/receiveGroup 迁出至 inbound-gate.ts，入口时序契约由 8 项特征测试钉死；附加交付平台假设清单 [PLATFORM_ASSUMPTIONS_INBOUND.md](PLATFORM_ASSUMPTIONS_INBOUND.md)。

P8 是全部阶段中唯一被计划文档要求"另出切片设计"的阶段，原因有二：入站区是**全系统最敏感的锁内落库路径**（receive/receiveGroup 的 serial 块）；且它与叙事核心、turn-engine、意愿门、密度计数、端点解析、投递账本**全部直接咬合**。

## 1. 调研结论：区域地图

入站区现为 L2500–4589，约 2090 行、49 个方法、7 个状态容器，按内聚分六个子区：

| 子区 | 行号 | 方法 | 状态容器 |
| --- | --- | --- | --- |
| A 入站入口 | 2500–2769 | receiveGroup(2500)、receive(2584)、groupSenderName(2715)、lookupGroupMemberName(2730)、bufferGroupMessage(2745) | seenIncomingMessages、inboundSeq、bufferedGroupTurns、interruptedTypingParticipants |
| B 群回合冲刷 | 2770–3090 | flushGroupTurn(2770)、**flushGroupTurnUnlocked(2787，约 207 行——群回合心脏)**、groupMessages(2994)、loadHistoricalGroupImages(3037) | bufferedGroupTurns、groupWillingness |
| C 群能力与动作 | 3090–3360 | groupCooldownActive、groupChatCapabilities、privateChatCapabilities、executeGroupReactions、resolveSticker、resolveNativeFace、sendSticker、sendNativeFace | — |
| D 群可见回复传输 | 3361–3516 | **sendGroupMessage（约 155 行，与投递共用）** | — |
| E 私聊缓冲与早发 | 3517–3632 | bufferUserNarrative、signalIncomingInterruption、deliverEarlyPrivateReply、describeUserEvent、readForward | interruptedTypingParticipants |
| F 表情包库与采集 | 3633–3948 | tryHarvestStickers、harvestLibraryHashIndex、runStickerHarvestScan、noteHarvestFailure、stickerHarvestStatusLines、scanStickerLibrary、stickerDeliveryBase、registerStickerRoute、refreshStickerCatalog、semanticStickerEmbeddingEnabled、backfillStickerEmbeddings、stickerCatalogForSession、rankStickerAssets | 贴纸目录缓存、采集配额 |
| G 媒体加载与历史向量 | 3998–4533 | recallHistory、ensureHistoryVectors、invalidateHistoryVectors、backfillHistoryEmbeddings；loadNativeAudio、fetchNativeAudio、describeVisionEvent、loadNativeImages、describeCurrentImages、isExpiredImageSource、deadImageSourceReason、rememberDeadImageSource、fetchNativeImage、fetchImageThroughRedirects、fetchNativeImageUncached、imageBytesToNative、downscaleImageForVision、renderAnimatedImageFrame | 死图源记录、历史向量缓存 |
| （留守参照） | 4534–4650+ | invalidateBufferedNarratives、rememberIncomingMessage、deliveryGeneration/taskGeneration 族、hasPendingNarrative、**flushBufferedNarrative(4590)** | 代次令牌 |

## 2. 咬合点分析（切片边界的依据）

1. **叙事核心**：`flushGroupTurnUnlocked` 与 `flushBufferedNarrative` 是群/私两条冲刷心脏，直接调用 tryDecide/persistDecision/群投递/账本回写。计划文档明示"缓冲冲刷留守叙事核心"——B 区的 flush 两个方法与 E 区 bufferUserNarrative 之后的部分**留守**。
2. **turn-engine**：bufferUserNarrative 委托 turnEngine（P0 拆出）；入站只负责推入与打断标记。signalIncomingInterruption 写 interruptedTypingParticipants——该集合的**消费方在投递管线**（P2 模块经 svc 读取），容器必须留守 service。
3. **意愿门**：evaluate/consumeWillingnessGate（纯函数在 group-willingness.ts）在 flushGroupTurnUnlocked 内调用，群聊意愿分数 Map（groupWillingness）是 service 状态。B 区留守则无跨模块问题。
4. **密度计数**：`contextDensity.record` 在两条入口的去重**之后**调用（审计细节①：重放不得双计）——入口方法的时序是特征测试对象。
5. **端点解析**：入口队列外调 touchEndpointStateInbound/channelMetadataFor（P4 委托），经 svc 无感。
6. **投递账本**：sendGroupMessage 被 flushGroupTurnUnlocked（留守）与 sendCrossGroupMessage（delivery/pipeline）**双方调用**，control 参数（shouldCancel/settled/onDelivered）是账本形态——它本质是群传输，归宿是 delivery/pipeline.ts。
7. **表情包采集钩子**：两条入口 fire-and-forget 调 tryHarvestStickers（F 区），mention-only 群也采集——F 区独立度高，入口经 svc 调用即可。

## 3. 测试网

入站区测试网是全项目最密的一族：group-audio（直调 bufferGroupMessage/flushGroupTurn/loadNativeAudio/sendGroupMessage 原型）、group-identity（sendGroupMessage）、group-echo-gate、group-assignee、supersede-repro、conversation-interruption、voice-transcription、sidecar-vision、forward-message、willingness 两族、sticker-harvest/sticker-delivery、history-recall-guards。全部走 `prototype.call(host)` 形态——同名委托 + 宿主首参配方覆盖，测试零改动（与 P2–P7 同）。

## 4. 切片设计（S1–S5，风险升序）

### S1 表情包库与采集 → `src/sticker-library.ts`（约 330 行）

F 区 13 方法整体迁出（采集旁路、目录扫描/刷新、HTTP 回源路由注册、语义过滤、采集判定）。纯策略与判定 prompt 已在 sticker-harvest.ts。专项门：sticker-harvest、sticker-delivery、sticker-vision-helpers、model-capture（盲模式关闭语义）。

### S2 媒体加载族 → `src/media-loading.ts`（约 360 行）

G 区媒体半区 14 方法（原生音频转码获取、原生图片获取/重定向穿透/缓存、视觉描述、动图帧渲染、降采样）+ E 区 describeUserEvent/readForward。入口与冲刷经 svc 调用。专项门：voice-transcription、sidecar-vision、forward-message、group-audio（loadNativeAudio 原型直调）。

### S3 历史向量族 → `src/history-recall.ts`（约 200 行）

G 区另一半：recallHistory、ensureHistoryVectors、invalidateHistoryVectors、backfillHistoryEmbeddings。纯策略（lexicalScore 等）已在 narrative-normalizers。专项门：history-recall-guards、memory-continuity。

### S4 群能力与动作执行 → `src/group-actions.ts`（约 370 行）

C 区 8 方法（能力投影、群反应执行、贴纸/原生表情发送与桌面代理）。**sendGroupMessage 单独处理**：迁入 `delivery/pipeline.ts`（追加第二波函数），因为它与 sendCrossGroupMessage 共享分段/账本/端点门控语义；flushGroupTurnUnlocked 经 svc.sendGroupMessage 委托无感。专项门：group-identity、group-echo-gate、desktop-outcome-semantics、qq-face。

### S5 入站门控管线 → `src/inbound-gate.ts`（约 380 行）★最敏感，最后

A 区两条入口（receive/receiveGroup）+ groupSenderName/lookupGroupMemberName 迁出；bufferGroupMessage **留守**（与 flush 同属回合生命周期）。入口经 svc.bufferGroupMessage/svc.bufferUserNarrative 入队。**红线**：
- 两条入口的 serial 块内容（二次查库去重 → appendEntry → pauseAutomaticAdvance）逐字搬运，锁相位不变；
- seenIncomingMessages/inboundSeq/interruptedTypingParticipants/contextDensity 容器全部留守 service；
- 密度计数在去重之后、mention-only 证据落库不入队等时序契约，开工前先补特征测试（P0 模式）再动代码。

### 留守清单（P8 后 service 的叙事核心形态）

flushGroupTurn/flushGroupTurnUnlocked、bufferGroupMessage、bufferUserNarrative、signalIncomingInterruption、deliverEarlyPrivateReply（流式早发与叙事请求回调咬合最深）、flushBufferedNarrative、代次与失效族、全部状态容器。

## 5. 执行顺序与预估

S1 → S2 → S3 → S4 → S5（每片独立成立，可停在任意片）。预计迁出约 1640 行，service.ts 终态约 7300–7400 行（组合根 + 双冲刷心脏 + 故事/参与者管理 + 管理命令 + Console API + 日志/串行基础设施）。配方沿用 P2–P7（函数式 + svc 首参 + 同名委托 + tsc 收敛 + 通用解析器 + 备份 + 三件套验证）。

## 6. 验证门与回滚

每片：typecheck 零错误 + 全量 1006 用例只增不减 + 该片专项族全绿。S5 开工前特征测试补口：入口去重时序（重放不双计密度）、mention-only 图片证据路径、打断标记同步置位、autoCreate 门序（未授权 QQ 不得建故事——receive 注释明示的既有契约）。回滚：每片备份 dustbin/source-backups/&lt;date&gt;-before-p8-s&lt;n&gt;/，单片可独立还原。

## 7. 明确不做

不动意愿门/密度/turn-engine 的任何语义；不合并群/私入口为参数化单函数（行为等价性风险大于收益）；不迁移 serial() 实现本身；不调整 index.ts 中间件注册顺序；不顺手改任何日志文案与条目 metadata 形态。
