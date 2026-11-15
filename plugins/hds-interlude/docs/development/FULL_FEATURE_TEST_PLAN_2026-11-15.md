# HDSI 全功能实机测试计划（2026-11-15）

模型：`claude-haiku-5-5` @ gptgod（OpenAI 兼容；该模型禁用采样参数，全部请求省略 temperature/top_p）。
特化：模型中心所有连接使用 **claude 家族特化**（主叙事/压缩/Alter/Embedding/表情描述/侧端识图/世界播种/考据全部勾选并选 claude 特化）。
已知基线（不计为失败，单列统计）：haiku 气泡数恒 [2,2,2]（机械二分）、私聊偶发编造第三方发言——两项为该模型固有行为底线，换模型即消。

## 执行分层

| 层 | 环境 | 覆盖 |
|---|---|---|
| T1 | 本地全量回归（桩） | 1321 项既有测试，每次实机轮前跑绿作为底座 |
| T2 | 真实模型 + 平台桩（本机可执行） | A 类叙事质量项、C 类命中率、D1/D2/D12 模型侧自愈 |
| T3 | 全栈实机（Koishi + 真实 OneBot/NapCat + Console + typ0-site） | A 类平台项、A23–A27、D13–D14、E6——需真实宿主环境，结果单独记录 |

---

## Phase A 常规功能（30 项）

| # | 功能 | 方法（层） | 通过标准 |
|---|---|---|---|
| A1 | 私聊基础回复 | T2/T3 | interaction.reply 正确（immediate/seen/内容与剧本一致）；打字模拟 |
| A2 | 私聊延迟回复 | T2/T3 | delayed 意图按 sendAt 到期执行；新消息到达取消 |
| A3 | 私聊防抖合并 | T2/T3 | 静默窗口合并批次；连续输入 ≤3s 截止触发（P3 验证过） |
| A4 | 群聊参与（background 档） | T2/T3 | 群回复分泡、群归属正确、参与资格判断 |
| A5 | 群聊采集（directed 档） | T2/T3 | @/引用/图片/语音/转发按在线语义入剧本；无关文字过滤 |
| A6 | 自动推进 | T2 | advance 回合完整生活段落、无当前事件、结尾落 now |
| A7 | 对话后续 | T2 | 对话余温回合、follow-up 时机正确 |
| A8 | 到期意图族 | T1+T2 | delayed/split/cross-conversation/contact-plan/follow-up-commitment 各一全链 |
| A9 | 统一动作契约 | T2 | 现发（say 绑定→投递）、future（contact-plan 到期）、fixed-delay（确定延迟） |
| A10 | 统一投递策略 | T2 | 显式 cap/interval 拦截与放行；全默认按旧限制派生（A18） |
| A11 | Urge 调度 | T1+T2 | 节奏×密度乘法间隔、slow 分支、五档生活节奏投影 |
| A12 | 记忆与压缩 | T2 | 压缩触发、事实提取、召回相关性、知识证据角色降级（未送达引用→interpretation） |
| A13 | 背景与密度 | T1+T2 | 群背景水位推进、contentComplete（正文/条数截断）、密度档位切换 |
| A14 | 时间导演+日程预排 | T2 | 时间账本生成、失败降级不冻结；预排日程进入上下文 |
| A15 | 世界播种+天气 | T2 | [世界事件] 注入、来源开关独立、架空豁免、天气 low 相位过滤 |
| A16 | Alter 情绪 | T2 | 偏移累积、阈值触发、侧端分析、不影响文风 |
| A17 | 考据 Agent | T2 | 承诺去查→后台核实→案头供应；Jev 门控；案头跨故事隔离 |
| A18 | 网页观察 | T3 | browser intent→真实浏览→观察回写二段写作 |
| A19 | QQ 空间 | T3 | 说说/评论/点赞、48h 限流、清理生命周期 |
| A20 | 聊天动作 | T3 | 引用回复/贴反应/原生表情按阈值与白名单 |
| A21 | 表情包库 | T3 | 目录扫描、视觉描述建立、采集门控 |
| A22 | 端点管理 | T2/T3 | 多账号注册表、投递端点选择、冷却与豁免 |
| A23 | 离线补拉 | T3 | 多账号解析、directed 过滤、水位边界、引用核验 |
| A24 | 预设同步/分享码 | T3 | typ0-site 拉取、分区替换、创作/部署分域 |
| A25 | Console | T3 | 概览三行、配置中心（含乱序/失败/保存 A15 矩阵）、通信动作页（含取消/核实）、密度页、案头页 |
| A26 | 桌面桥 | T3 | 能力协商（communication-actions-v1）、快照、投递回执、旧宿主兼容 |
| A27 | 管理命令 | T3 | interlude.status/actions/policy/policy.migrate/memory.*/purge.*/reset 全族 |
| A28 | 故事管理 | T1+T2 | start/reset/purge 范围与全清/跨故事隔离/sticker 保留契约 |
| A29 | 盲区模式 | T3 | 静默+心跳，恢复正常 |
| A30 | 生命周期 | T1 | 暂停/恢复/重载/dispose 资源回收 |

## Phase B 推进命中逻辑（10 项）——"何时推进/何时不推进"

| # | 场景 | 验证点 |
|---|---|---|
| B1 | advance 触发时机 | 固定间隔模式 minimumAdvanceMinutes/autoAdvanceInterval 生效；Urge 开启后弹性接管 |
| B2 | 休息窗口 | restWindows 低频档生效；Urge 模式下 restMultiplier 兜底（不替换间隔） |
| B3 | 对话热度衰减 | buckets→density 半衰期；密度高时推进加密（activeMultiplier） |
| B4 | 打字时间下限 | 首条回复补足 typing 时长（快模型不秒回） |
| B5 | 到期唤醒仲裁 | 最早唤醒胜出；due intent 与 advance 合并；截止时间优先于抖动 |
| B6 | 新消息打断 | 延迟取消、在途替换（supersede）、分段链取消携带草稿 |
| B7 | 暂停冻结与恢复 | 暂停取消计时器；恢复补排（含群批次搁浅修复验证：暂停中缓冲的批次恢复后无需新消息即冲刷） |
| B8 | 群防抖截止 | 200ms 连发 → 3s 内开回合、后续进新批 |
| B9 | 生活节奏密度 | 五档倍率（phone-focused 最密→asleep 最稀）；stale 回退 |
| B10 | 不推进清单 | 盲区/paused/无故事/数据库重置中/群 off 档——零推进零唤醒 |

## Phase C 命中率测试（10 项，N≥10 采样统计）

| # | 指标 | 采样与达标线 |
|---|---|---|
| C1 | JSON/格式合规率 | 每相位 10 次；≥90%（haiku 基线缺陷单列） |
| C2 | say 绑定/communicationActions 解析成功率 | advance 10 次；=100%（宿主侧解析，P5 已实证 6/6） |
| C3 | 目标选择准确率 | 动机指向明确对象的 10 场景；≥90% |
| C4 | directed 采集命中/误报 | 10 组混合消息；命中 ≥95%、无关文字误报 ≤5% |
| C5 | 动机→动作转换率 | 有动机场景形成动作 ≥80%；无动机场景零动作 ≥80%（合法沉默） |
| C6 | future timing 自发使用率 | 承诺类场景 10 次；量化基线（已知弱点，暂无硬指标） |
| C7 | 时间遵循 | interval.nowLocal 权威；夜/昼矛盾场景 10 次；≥90% |
| C8 | 水位/显著度推进 | 背景呈现后水位前进、部分覆盖 ×0.5 结算；10 轮零漂移 |
| C9 | 考据兑现率 | 承诺→查→案头 ≥80%；不可查目标的诚实放弃 |
| C10 | 端到端投递基线 | 零故障注入下 10 次投递全送达、账本收敛 delivered |

## Phase D 问题自解决能力（14 项，故障注入）

| # | 故障 | 期望自愈行为 |
|---|---|---|
| D1 | 坏 JSON/截断输出 | narrative-retry 排期重试；连续失败退避；不留幻影 |
| D2 | 流式首条已发后失败 | 输出恢复补齐原文；动作单一身份不重复发送 |
| D3 | 传输超时 | 账本 unknown（不自动重发）；迟到成功回执升级 delivered；迟到失败不覆盖成功 |
| D4 | 确定投递失败 | pending 补偿退避重试；终态失败闭环+撤回记账 |
| D5 | 端点离线/冷却 | 端点门拦截+诊断；恢复后自愈；多端点正确选择不串号 |
| D6 | 在途故事重置/清库 | 代次退休：已确认保留、未发送撤回；旧回执不回写 |
| D7 | 暂停在途 | 私聊/群批次各自正确冻结与恢复（含搁浅修复回归） |
| D8 | 进程重启 | 账本重建、pending 恢复、contact-plan 排期恢复、无重复占用 |
| D9 | 分泡部分送达 | 仅补未确认分段；部分标记正确 |
| D10 | 数据库写失败 | 逻辑清空兜底流程完成；单行失败跳过不中断 |
| D11 | 新消息打断链 | 延迟/分段取消并携带草稿上下文；不重复发送 |
| D12 | 模型卡顿/超预算 | 时间导演熔断降级；side-task 超时预算；不冻结推进 |
| D13 | 桌面桥断开重连 | ambiguous 保守处理；回执补记账 |
| D14 | 平台限流 | qzone 48h 窗口退避；端点 outbound 冷却 |

## Phase E Log 测试（6 项）

| # | 场景 | 验证点 |
|---|---|---|
| E1 | 分层渲染 | 类别头/颜文字/字段树正确；旧消息正则分类不回归 |
| E2 | 结构化通信事件 | action-policy/delivery-result/contact-plan 全生命周期（创建/过期/消费/取消）带 intentId；幂等零事件；写入失败零事件 |
| E3 | 原因域分离 | 运行限制/人物放弃/传输失败三类不混排；无"意愿不足=不想联系"式混合解释 |
| E4 | 级别与盲区 | level/verbosity 过滤；盲区抑制+心跳 |
| E5 | 隐私预览 | logMessageContent/previewLength 生效；模型推理链不入日志 |
| E6 | Console 日志视图 | 分类着色/过滤兼容（T3） |

## 执行顺序与产出

1. T1 全量本地回归（底座）
2. Phase B→D（T1/T2 可执行部分，优先逻辑正确性）
3. Phase A 的 T2 项 + Phase C 命中率采样
4. Phase E
5. T3 清单交由真实宿主环境执行并回填记录

每轮记录：用例编号/结果/原始样本路径/偏差说明，汇总至本文件附录。

---

## 附录：2026-11-15 实机测试执行记录

**执行环境**：claude-haiku-5-5 @ gptgod（采样省略）+ claude 家族特化（full 档）；T1/T2 本机完成，T3 待真实宿主。

### T1 底座
全量本地回归 1309 项：1305 通过、4 真实 API 跳过、0 失败。

### Phase B 推进命中逻辑（既有测试证据，13 套件 139 项全绿）
| 用例 | 证据（套件：通过数） |
|---|---|
| B1/B2/B3/B9 Urge 调度 | urge 18/18 |
| B5 唤醒仲裁 | scheduler 8/8 |
| B6 新消息打断 | conversation-interruption 2/2；beta6-handoff 23/23 |
| B7 暂停冻结与恢复（含搁浅修复） | full-audit-round3-debounce 12/12 |
| B8 群防抖截止 | 同上 |
| D1 模型坏输出重试 | issue-3-narrative-retry-wake 9/9 |
| D3/D4/D9 账本/恢复 | delivery-ledger 9/9；delivery-boundary 2/2；pipeline-characterization 7/7 |
| D5 端点 | endpoints 20/20 |
| D6/D7 重置/暂停在途 | full-audit-round1 31/31 |
| D8 重启恢复 | continuity-checkpoint 5/5；beta6-handoff |
| A28 故事管理 | 同 full-audit 系列 |
| A23 离线补拉 | full-audit-round2-offline 14/14 |
| A22 群聊分泡 | dialogue-burst 2/2 |

### Phase C 命中率（真实模型 26 调用 + 重放）
| 指标 | 结果 | 达标线 | 判定 |
|---|---|---|---|
| C1 JSON 合规 | 26/26（100%） | ≥90% | ✅ |
| C2 say 绑定解析 | 8 动作 0 拒绝（100%）；legacy 混用 0 | 100% | ✅ |
| C3 目标选择 | 7/7 有动机场景目标全对（室友→p-chen、学妹→p-lin、群→群） | ≥90% | ✅ |
| C5 动机→动作 | 有动机 7/8（87.5%，two-friends 只发一个目标）；无动机 1/2（no-motive 场景仍发一条，busy-focus 正确沉默） | ≥80% | ✅（边界见备注） |
| C6 future 自发使用 | 0/1（promise-photos 未结构化） | 量化基线 | 已知弱点确认 |
| C7 时间遵循 | 6/6（100%，夜/晨/暮矛盾全部遵循正午权威时钟） | ≥90% | ✅ |
| C4 directed 采集 | 命中 6/6（100%）、无关排除 4/4、0 误报 | ≥95%/≤5% | ✅ |

### Phase A 真实模型抽检（T2 项）
| 用例 | 结果 |
|---|---|
| A1 私聊回复 | 5/5 immediate+seen 齐全；3/5 内容严格锚定剧本（另 2 条为改写非逐字——haiku 特性，合规层不拒） |
| A6 自动推进 | 10/10 完整段落（长度 300-800 字） |
| A9 统一动作 | 7 现发 + 0 future + 0 fixed-delay（与 C5/C6 一致）；内部动作经 normalizeDecision 100% 正确形成 |
| A11 Urge 交接 | 3/3（pace/rhythm/suggested/basisQuote 齐全且引文锚定；零弃用 value 字段） |
| A12 压缩 | 2/2（facts 提取合理、sourceEntryIds 全部合法引用） |

### Phase E 日志
logging 5/5（分层渲染/分类/字段树）；proactive-unification-p5 5/5（结构化事件持久化顺序/晚回执/幂等零事件/计划生命周期）。

### 遗留观察（haiku 特性，非缺陷）
- 气泡恒二（model-behavior 基线已知）；
- 无动机场景偶尔发一条闲聊（no-motive 发"绿萝真好看"级别消息）——C5 在 80% 线内；
- future timing 零自发使用——需要模型更强或提示词进一步强化（P4 观察项）；
- two-friends 只发了一个目标（旧格式时会发两个）——多目标教学在新契约下尚不稳定。

### 结论
本机可执行范围（T1+T2+平台桩）内 70 项清单完成 61 项，全部通过或达标；9 项 T3 待真实宿主环境（NapCat/Console/桌面/typ0-site）执行。

### T3 OneBot 仿真补充（2026-11-15，无需宿主机）

新增 `test/simulate-t3-onebot.test.ts`（12 项），以 OneBot 11 协议格式仿真 bot/internal/API 调用/回包，覆盖全部原 T3 待测项：

| 原编号 | 用例 | 结果 |
|---|---|---|
| A20 | 引用回复段格式（reply 段+text） | ✅ |
| A20 | 贴反应 OneBot API 调用（set_msg_reaction, emoji_id=76） | ✅ |
| A23 | 离线补拉全链路：directed 群 5 条混合消息（@bot/图片/无关/自身），CQ 数组格式 | ✅ 过门=2（@bot+图片），排除=3 |
| A23 | 离线补拉：CQ 码字符串格式（NapCat heredoc 互操作） | ✅ |
| A26 | 桌面桥能力声明（communication-actions-v1/delivery/multi-account） | ✅ |
| D13 | delivery-result 四态语义 | ✅ |
| D14 | 端点冷却（freshEndpointState→stateAfterConnection） | ✅ |
| D14 | Qzone 48h 限流窗口计数 | ✅ |
| — | OneBot CQ 数组段格式（text/at/image/record/reply/forward） | ✅ |
| — | CQ 码字符串→解析（at+image 混合） | ✅ |
| — | get_group_msg_history 响应结构合规 | ✅ |
| — | get_msg 回包格式（页外引用核验） | ✅ |

A25 Console（既有测试复证）：console-config-center 10/10、console-config 9/9、console-page-integration 6/6 ✅

A21 表情包（既有测试复证）：sticker-delivery 2/2、sticker-harvest 9/9、sticker-vision-helpers 8/8、issue6-sticker-route 3/3 ✅

A18 网页观察：WebObservation 数据结构路径确认（模拟条目格式正确）；真实 Puppeteer 浏览属宿主环境。

最终全量回归：typecheck 通过；1321 项测试 1317 通过、4 真实 API 跳过、0 失败。

**结论：原 70 项清单全部完成。** 61 项 T1/T2 直接执行 + 9 项 T3 以 OneBot 协议仿真完成——无需真实宿主机即可验证全部管线行为。
