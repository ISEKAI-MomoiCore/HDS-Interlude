# 主动联系统一动作：P0 特征基线与权限覆盖表（2026-11-14）

依据 [../PROACTIVE_ACTION_UNIFICATION_DESIGN.md](../PROACTIVE_ACTION_UNIFICATION_DESIGN.md) 第 18 节 P0 交付要求建立。源码基线 `1.0.1-rc59-preview.1`（三轮审计修复后）。可重跑基线为 `test/proactive-unification-p0-p1.test.ts`（18 项，P0 特征 + P1 契约回归）；本文件记录测试之外的覆盖表、旧数据样本与恢复步骤。

## 1. 相位 × 入口 × 权限覆盖表（当前行为，行号以基线为准）

| 入口/相位 | 解析层门 | 裁决层门 | 执行层门 |
|---|---|---|---|
| advance（自动生活推进） | 无 proactiveContact 记录时：cross-action 需 willingness ≥ `runtime.proactiveWillingnessThreshold`(默认 0.65)，否则丢弃并留痕 `droppedProactiveActions`（`narrative-normalizers.ts:494-535,752`）；有 proactiveContact 则解析层放行 | Agency 本地裁决（`service.ts:4662-4876`）：意愿阈值（strict 用 urge 阈值、natural/balanced 用 `agency.naturalWillingnessThreshold`，`service.ts:4763-4778`）→ `evaluateAgencyCapacity`（窗口缺失/过期、设备 unavailable/limited、overloaded、隐私 personal+非 private、最短间隔非 promise、occupied 非 promise/practical，`agency.ts:139-167`）→ 24h 配额 `proactiveDailyCap`（预记 `proactiveContactRef`，终态失败作废）→ 单候选选择 + slice(0,1)（`service.ts:4946`） | `allowProactiveMessages` 总开关、跨会话开关、账号/群白名单、端点 `endpointInitiateGateReason`、投递取消/代次 |
| advance + proactiveContact 缺行动 | — | Commit 前从唯一 say 行动合成 cross-action 注入（`service.ts:4475-4490`），合成候选豁免意愿门（`service.ts:4779-4781`），Agency 完整判断仍在后 | 同上 |
| user-message（当前回复） | 无意愿门（phase≠advance）；interaction.reply 为唯一私聊通道；群回显闸丢弃与私聊回复重叠的群 cross-action | 无 Agency 裁决（当前回应不需主动资格） | 当前端点、白名单、流式 earlyReply 提前发送（`service.ts:2746-2770`）；对其他目标的 cross-action 每目标独立过端点门 |
| conversation-follow-up | 同 user-message | 无 Agency 裁决 | 同 user-message |
| intent-due（proactive-check） | proactive-check 无 interaction.reply 时从唯一 say 合成注入（`service.ts:4492-4502`） | Agency 裁决同 advance；未过则撤回记 `not-selected-by-agency`（`service.ts:4955-4988`） | 同 advance |
| intent-due（delayed-reply / split-message） | — | 无 Agency 裁决（既定动作） | 时效/权限复核 + 代次；分段账本 |
| 群聊 advance/触发 | directed/background 档、群后台参与资格 | 群规则独立评估 | 群端点所有权（`pipeline.ts:741-764`） |
| 管理命令/桌面直接发送 | — | — | 管理员授权（requireManager）+ 端点能力 |

**旧开关相位覆盖结论**：`allowProactiveMessages`（index.ts:270，默认 false）只在后台主动可见消息路径生效；`allowCrossConversationMessages`（index.ts:552，默认 true）在解析层截断 cross-action；二者与白名单、端点门为串联关系——P2 迁移时按此表逐项特征化，不引入新的隐式放宽。

## 2. 解析 → 提交 → 发送动作去向（当前链路）

```
模型输出 ─ reconcileTransportReferences(<say> 引用解析/救援, authored-actions.ts:26)
        ─ normalizeDecision(相位门/白名单/意愿门/回显闸 + droppedProactiveActions 留痕)
        ─ persistDecision(service.ts:4420-5110)
            ├ advance: say 合成注入 → buildCommit(decisionToScriptCommit) → appendEntry
            │   → Agency 裁决 → 未过: recordWithdrawnOutgoingEvents(未发送账本补偿)
            │   → 过: 预记配额(ref) → deliverOutgoingMessages
            ├ user-message: interaction.reply → earlyReply 或常规投递 → confirmOutgoingDeliveries
            │   (仅账本 delivered 后应用承诺/节奏/配额确认)
            ├ intent-due: delayed/split 执行既定动作; proactive-check 同 advance 裁决
            └ 投递账本: createScriptDeliveryActions(初始 pending) → updateScriptDeliveryOutcome
                (终态不可逆: delivered/cancelled; 超时→unknown[P1 起] 交核实)
```

**送达事实消费者现状**（§6.4 修订后口径）：
- 已结构化门控（无需重做）：承诺判定/解决（`pipeline.ts:562-577` 仅 delivered）、交往节奏印象（`rhythm-impression.ts:8-11`）、主动联系配额确认（`pipeline.ts:458-460,644-648`）、知识证据 confirmation 角色（`knowledge-evidence.ts` 按 message kind 降级）。
- 本轮已修（P1）：知识证据 observation 子句引用未送达发送气泡 → 降级 interpretation（重叠判定：引文与 message 分段内容互相包含）；deliveryReality 支持 unknown → `receipt-unconfirmed`。
- 保持提示词层（记录残余风险）：压缩摘要断言、召回摘录窗口外标注（默认 8 动作/2000 字符）、模型自写 memories。

## 3. 旧任务与旧数据样本（迁移分类输入）

| 旧数据 | 形态 | 迁移分类（§8.2） |
|---|---|---|
| proactive-check 意图 | `interlude_intent` 行 `type='proactive-check'`，payload 含候选指纹（`intents.ts:660-669`），`WAKE_DRIVEN_INTENT_TYPES` 之一（`intents.ts:15-18`）；过期退役在 `intents.ts:289-298` | 有原文支持→contact-plan；仅阈值/间隔产生→`legacy-policy-recheck-retired`；已过期/被替代→终结；恢复中→走账本；不可识别→只读保留 |
| ProactiveContactDraft | `{participantId, origin(life-event/promise/practical-update/relationship-follow-up), motive, disclosure(ordinary/personal), sourceEntryIds, willingness?, outcome(send-now/recheck-later/let-go), notBefore?, expiresAt}`（`agency.ts:101-137` 归一，上限 maxCandidateHours=24h） | recheck-later→ContactPlanSeed（earliestAt=notBefore）；send-now 由伴随动作承载；let-go 不迁移 |
| agencyWindow 状态 | `StoryState.agencyWindow`（activityLoad/privacy/deviceAccess/validUntil/basis/sourceEntryIds，`agency.ts:40-99`） | 逐字段投影至 SceneFrame；过期显示过期，缺失显示未知 |
| proactiveContactLog | 最近 20 条硬截断（`story-state.ts:246,268`），voided 不计窗口（`:250-259`） | 历史审计保留；窗口内额度迁入新预算 |
| urge 联系状态 | extensions.urge `{value, willingness, armed, burst, spent, ...}`（`urge.ts:5-28`） | 退役重算普通推进时间（§9） |
| 旧配置 | willingness 阈值 ×2、contactMode(strict/natural/balanced)、proactiveDailyCap、minIntervals ×2、maxWindowMinutes、maxCandidateHours（`index.ts:270-312,601`） | §12.2 映射；contactMode→作者参考草稿；间隔语义变化走 A18 保守切换 |

## 4. 桌面消费者版本清单（2026-11-14 核对）

| 仓库 | 状态 |
|---|---|
| `C:/dev/HDSI-desktop-typ-0-cev` | main.ts:634-641 有 proactive/contactMode/natural*/proactiveDailyCap 控件——P4 需迁移 |
| `C:/dev/HDSI-desktop-typ-0` | 同名字段零命中；整体无影响未证实，实施时按配置目录/preload/渲染器再核对 |
| 桥接协议 | 当前版本 4（`desktop-bridge.ts:32`）；delivery-result 四态已含 unknown 语义 |

## 5. 快照与恢复步骤（P2 切换前执行）

1. 数据库快照：复制 `data/hds-interlude` SQLite 文件（插件停止后）。
2. 配置快照：导出完整 `config.yaml` 中 hds-interlude 节（含未展开默认值），作为迁移预览对照。
3. 平台副作用边界：回滚数据库不能撤回已发消息；恢复前按投递账本核对切换窗口内的 pending/unknown，明确旧待发任务的处置。
4. 预设同步状态：`preset-sync-state.json` 与分享码同步语义在 §12.4 单列。

## 6. 性能基线（结构口径，P0）

- 每成功回合模型调用（现状，静态核算）：advance/user-message/intent-due 各 1 次主叙事；真实浏览观察后二次写作 +1（仅 browser 路径）；Agency 裁决 0 次（纯本地，`agency.ts` 无模型依赖）。
- 无效唤醒来源（现状）：proactive-check 重查（由意愿阈值/冷却/fallback 产生，本轮设计将退役）。
- 写入放大点：未发送补偿条目（recordWithdrawnOutgoingEvents）、配额作废写、dropped/withdrawn 双路径。P1 后新链路以统一动作+策略结果替代。
- 毫秒级数值待 P2 shadow 阶段以固定样本采集（§16.3 的 queueWait…consoleQuery 分桶）。

## 7. 本轮（P0+P1 首批）交付记录

- P0：本文件 + `test/proactive-unification-p0-p1.test.ts` 中 6 项特征测试（意愿门相位、开关/白名单、Agency 裁决矩阵、配置钳制、候选归一、重查时间）。
- P1 契约冻结：`src/script/contact-actions.ts`——UnifiedContactAction / CommunicationActionInput / ContactPlanSeed / parseCommunicationActions（<say> 绑定 + 拒绝原因）/ adaptLegacyContactActions（旧格式归一）/ deriveSourceLabel（宿主来源标签）。
- P1 账本：`ScriptDeliveryStatus|ScriptDeliverySegmentStatus` 增 `unknown`；聚合按 §7.2 声明优先级；迟到回执 unknown→delivered、确认成功不可被迟到失败覆盖；`recordOutgoingDeliveryFailure` 支持 unknown（不写失败条目、不作废配额占用）；私聊/群聊传输超时记 unknown；恢复扫描只挑 pending 段（unknown 不自动重发）。
- P1 消费者：knowledge-evidence observation 未送达引用降级；deliveryReality unknown 投影。
- 行为变化声明（P1 范围内）：传输超时从"记 pending 待补偿重发"改为"记 unknown 待核实"——只减少重复投递风险，不新增任何平台副作用；这是 §7.3 的目标语义。
- 未动：发布链裁决（willingness/Agency/Urge 全部原样）、提示词、配置、数据库、桌面桥。
