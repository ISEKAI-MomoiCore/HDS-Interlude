# HDS Interlude 文档索引

当前正式版为 `1.0.1`，由 `1.0.1-rc63` 直接晋升。本版修复逐泡恢复、群投递补偿和后台外部任务阻塞，并统一 Koishi 日志行为；继续保留九档 Focus、事件注意度标注、播种事件涉入标签及私聊逐气泡投递。发布变化见 [更新记录](CHANGELOG.md)。根目录 README、新手指南、配置指南和命令文档面向使用者。本目录保存架构、设计与维护记录。

## 当前实现

- [ARCHITECTURE.md](ARCHITECTURE.md)：当前真实架构和数据流。
- [Focus 与事件注意度](experiments/2026-11-25-focus-driven-event-library-design.md)：已实现的九档 Focus、六类事件 T 档、世界事件涉及程度、实况天气和 Console 预览边界。
- [逐气泡发送延迟](experiments/2026-11-25-per-bubble-send-delay-design.md)：私聊即时回复按泡输出延迟，宿主结合模型耗时、打字模拟与投递回执调度，并支持新私聊打断。
- [NARRATIVE_PLATFORM_DECOUPLING_DESIGN.md](NARRATIVE_PLATFORM_DECOUPLING_DESIGN.md)：叙事核心与平台接入解耦设计（2026-10-30 原始设计稿，D0–D4 实施状态见 [平台语义层设计的前置说明](PLATFORM_AWARENESS_DESIGN.md)）——回合执行层的端口与适配器分层 + 提示词语义层（§4.5）：turn-engine 本体无 IO 但两个 flush 执行体（service.ts 内）叙事与平台操作逐行交错、模型调用边界焊接投递回调；主叙事合约输出协议已是语义枚举但六处措辞/类型绑定 QQ。D0–D4（含 D2.5 合约模板参数化）六个行为不变切片，平台词汇经模板参数由适配器注入、QQ 路径逐字节不变，目标"迁移 Discord/Telegram 叙事核心与合约零修改"。
- [PLATFORM_AWARENESS_DESIGN.md](PLATFORM_AWARENESS_DESIGN.md)：平台感知设计（**F1 · v1 待评审，未实施**，2026-10-30）——多平台语义层首个功能增量：PlatformProfile 性格卡片（她对平台的认知 + 能力面标签）随端点列表注入，选择动机不写规则、交给模型基于"卡片 × 关系 × 剧本"演绎；三条既有选择纪律不动。QQ 单平台合约逐字节不变，双平台新增 profile 注入（唯一行为变化点）。前置：解耦 D0–D4 已完成。
- [RESPONSIVENESS_INSPIRATION_DESIGN.md](RESPONSIVENESS_INSPIRATION_DESIGN.md)：群响应性灵感（**未立项备忘**，2026-10-30）——CHI06 IM 响应性研究的透镜 + 会话修正后的发散沉淀：会话迟滞（键=她真实群发消息）、未处理显著度加速瞥视、注意力预算（节奏×Preplan×Agency 三源合一）、防抖自适应；撤销本地延迟采样（窃取模型裁决权）。**专项：冷尾悬问微调**——热聊中被问后冷群导致跳过条数永远悬置的假感，两层修法（回合归属放行 + group-catchup 一次性兜底唤醒）。第二篇透镜（互酬性，村上 2023）：首句回复时长一句话档案（仅私聊）+ 回复延迟元语言指引 + 人味校准 r 值（非功能指标）；心理负债感已否决、群节奏对齐挂起待议。
- [CONSOLE_CONFIG_CENTER_DESIGN.md](CONSOLE_CONFIG_CENTER_DESIGN.md)：配置中心设计与当前状态。全部 25 个可见配置节可编辑，支持搜索、保存、强制重载与重新读取；Schema 与 Koishi 标准配置页共用，当前故事设定保存到数据库。
- [CONSOLE_UI_REPAIR_2026-11-15.md](development/CONSOLE_UI_REPAIR_2026-11-15.md)：专属工作台与原生配置页的布局、配置读写、提示交互、数据展示及文案修复清单。
- [INDIRECT_SUBJECT_DESIGN.md](INDIRECT_SUBJECT_DESIGN.md)：作者中介的叙事主体、主角与 narrator 的边界，以及 SV3/SV4 的主体性、关系连续性和重置设计约束。
- [LONG_HORIZON_NARRATIVE_GUIDANCE_DESIGN.md](LONG_HORIZON_NARRATIVE_GUIDANCE_DESIGN.md)：长线剧本指导 / Narrative Attractor 设计（Phase 0–3 已实现，Phase 4 进行中）——有效剧本条目加权累计、私聊全计 / 群聊半计、阶段性人物弧线、异步生成与主叙事注入边界。
- [V2_IN_PLACE_REFACTOR_IMPLEMENTATION_FORM.md](V2_IN_PLACE_REFACTOR_IMPLEMENTATION_FORM.md)：V2 原位迁移、当前完成度和验证门槛。
- [SERVICE_EXTRACTION_PLAN.md](SERVICE_EXTRACTION_PLAN.md)：service.ts 行为不变拆分顺序设计（P0–P8 分阶段，2026-10-29 立项，完成度见表内跟踪节）。
- [SERVICE_EXTRACTION_P8_DESIGN.md](SERVICE_EXTRACTION_P8_DESIGN.md)：P8 入站接收的开工前专项切片设计（调研结论 + S1–S5 五片方案，2026-10-29，全部完成）。
- [PLATFORM_ASSUMPTIONS_INBOUND.md](PLATFORM_ASSUMPTIONS_INBOUND.md)：入站路径 QQ/OneBot 平台假设全清单（P8-S5 交付物，TG/微信适配层设计的直接输入）。
- [V2_VS_BETA10_COMPARISON.md](V2_VS_BETA10_COMPARISON.md)：历史对照文档——beta10 与 V2（beta8 时期）的架构与功能全量对照；"现状"一栏定格于 beta8，仅供迁移考古。
- [ALTER_SYSTEM.md](ALTER_SYSTEM.md)、[AGENCY_WINDOW.md](AGENCY_WINDOW.md)、[SCHEDULE_PREPLAN.md](SCHEDULE_PREPLAN.md)：当前次级系统边界。
- [FORWARD_MESSAGE_READING_DESIGN.md](FORWARD_MESSAGE_READING_DESIGN.md)：QQ 合并转发读取现状、SnowLuma 接口依据与 HDSI 接入方案。
- [GROUP_HISTORICAL_IMAGE_CONTEXT_DESIGN.md](GROUP_HISTORICAL_IMAGE_CONTEXT_DESIGN.md)：群聊历史图片证据回流主叙事的持久化、选择、回源与模型边界。
- [WORLD_EVENT_SEEDER_DESIGN.md](WORLD_EVENT_SEEDER_DESIGN.md)：世界事件播种器（已随 rc23 发布；rc24 起模型选择为用途勾选）——外部事件源、事实权威/反应自由语义、生成回路与注入管线。
- [RESEARCH_AGENT_DESIGN.md](RESEARCH_AGENT_DESIGN.md)：考据 Agent（v3：**P1/P2/P3' 全部已实施**，先落地 CEV 分叉仓、后移植主仓）——剧本主线并行的资料员：应答式意图触发 + Jev（TypeSafe AI 决策模型 Noul 是非题）门控的被动推进叙事前考据、API 优先检索栈（Tavily/博查/SearXNG，DDG 零配置回退）、≤2 轮有界循环、前缀缓存对齐、工具注册表与查询防火墙。
- 密度自适应条目预算（`runtime.contextEntryMode=auto`）与 HDSI Console 界面（`src/console/` + `client/`）尚无独立设计文档，当前实现见 [CHANGELOG.md](CHANGELOG.md) 顶部与 [ARCHITECTURE.md](ARCHITECTURE.md)。
- [GROUP_WILLINGNESS_TIERS.md](GROUP_WILLINGNESS_TIERS.md)：群聊意愿档位化与 auto 档（已随 rc23 发布）。
- [WECHAT_CHANNEL_PLAN.md](WECHAT_CHANNEL_PLAN.md)：微信接入总体方案（v2）——onebots + OneBot v11 文本私聊 POC 路线与原生渠道适配层长期架构；POC 工作区 `C:\dev\onebots-wechat-poc`，未开始写码。
- [QZONE_FEED_DESIGN.md](QZONE_FEED_DESIGN.md)：QQ 空间（说说）通道——感知-行动分离架构、qzone-action 意图、好友动态轮询、限流与安全边界（按端点分桶；rc29 已纳入发布候选）。
- [MULTI_CHANNEL_SINGLE_STORY_DESIGN.md](MULTI_CHANNEL_SINGLE_STORY_DESIGN.md)：单剧本多通道设计（QQ + 微信，v3 实现规格）——UUID 端点身份与注册表、入站反向解析链、三维端点状态时效、canonical 别名迁移与回滚、M1a/M1b 拆分路线。
- [OFFLINE_ATTENTION_EXPERIMENT.md](OFFLINE_ATTENTION_EXPERIMENT.md) —— 离线注意力实验设计（想不想聊由模型申报 attentionAfter 进入仅响铃/勿扰，看不看得见由宿主执行：未读台账、锁屏摘要、phoneCheck 回放回合、轰炸唤醒——无时刻表判定）
- [MULTI_CHANNEL_IMPLEMENTATION_ROADMAP.md](MULTI_CHANNEL_IMPLEMENTATION_ROADMAP.md)：M2-M4 实施路线（M1/M2/M3 及代码级 M4 已完成；真实多端点运行环境验收延期至维护者最后执行）——双 QQ 号作 M2 验证载体、端点管理/用户链接/回合 sources 语义详细设计、微信 POC 补完步骤、M3/M4 概要与节点事务。
- [PLUGIN_UPGRADE_EXECUTION_PLAN.md](development/PLUGIN_UPGRADE_EXECUTION_PLAN.md)：历史执行计划（rc29 时期）——EndpointState/Delivery Gate 的实现过程记录，现状以源码为准。

## 已确认方向与待实施方案

- [Focus 驱动的事件库设计讨论](experiments/2026-11-25-focus-driven-event-library-design.md) 记录新版 focus 状态候选、事件库的提示词接入和机械重排方向。
- [PROACTIVE_ACTION_UNIFICATION_DESIGN.md](PROACTIVE_ACTION_UNIFICATION_DESIGN.md)：主动联系统一作者动作架构与实施计划（2026-11-14，方案二；P0–P5 已完成）——Agency 场景证据化、通信动作与执行边界统一、Urge 解耦、历史迁移、日志 / Console / 桌面联动及分批验收。当前功能行为仍以源码和现状文档为准。
- [主动联系 P0 特征基线](development/PROACTIVE_P0_BASELINE_2026-11-14.md)：相位×入口×权限覆盖表、解析→提交→发送动作去向、旧任务/旧数据样本分类、桌面版本清单、快照与恢复步骤及结构口径性能基线（统一动作重构 P2 起的对照基线）。
- [主动联系 P5 审查与验收](development/PROACTIVE_P5_REVIEW_2026-11-15.md)：P1–P4 实现审查、P5 清理项、统一契约修复、回归与发布检查记录。

## 发布增量与维护记录

- [全量审查修复跟踪（2026-11-12）](development/FULL_AUDIT_REPAIR_2026-11-12.md)：13 项缺陷验收清单；第一轮 F01–F03 已完成，后续批次与验证结果持续记录。

- [rc50 发布验证（2026-10-11）](development/RELEASE_VERIFICATION_2026-10-11_RC50.md)：定向构建、严格类型检查、全量回归、包内容与实际 bundle 冒烟。

- [全量源码审查修复与交互验证（2026-10-11）](development/FULL_CODE_REVIEW_FIXES_2026-10-11_RC48.md)：投递、整理事务、调度与性能逐项修复；报告记录的是当轮源码验收，本次发布另见 rc50 发布验证报告。
- [全量源码审查基线（2026-10-10）](development/FULL_CODE_REVIEW_2026-10-10_RC48.md)：修复前的证据与范围，当前状态以修复报告为准。

- [rc12 Anthropic Messages 适配](development/ANTHROPIC_MESSAGES_RC12.md)：双协议选择、cache-first、流式、群音频写作与兼容边界。

- [CHANGELOG.md](CHANGELOG.md)：`1.0.1` 正式版与历史版本的发布增量。
- [EVENT_LED_SCRIPT_REPAIR.md](development/EVENT_LED_SCRIPT_REPAIR.md)：事件优先续写、Alter 收束与关系学习证据边界。

- [URGE_SYSTEM_PROPOSAL.md](development/URGE_SYSTEM_PROPOSAL.md)：可选 Urge 自动推进设计；源码已实现，默认关闭。
- [URGE_SYSTEM_IMPLEMENTATION.md](development/URGE_SYSTEM_IMPLEMENTATION.md)：Urge 配置、历史兼容、部件合作和验证边界。

- [P1_MEMORY_NAVIGATION.md](development/P1_MEMORY_NAVIGATION.md)：同事项交接、渐进补齐、原文跨度与事项导航。
- [SECURITY.md](SECURITY.md)：发布包边界、依赖审计和已知上游风险。
- [SCRIPT_CENTRIC_ARCHITECTURE_REDESIGN.md](SCRIPT_CENTRIC_ARCHITECTURE_REDESIGN.md)：V2 的历史目标架构提案。
- [development/README.md](development/README.md)：发布增量与历史维护资料的分类索引。
- [development/logging/LAYERED_LOG_IMPLEMENTATION.md](development/logging/LAYERED_LOG_IMPLEMENTATION.md)：当前彩色分层日志实现。
- [development/logging/LOG_FORMAT_DESIGN.md](development/logging/LOG_FORMAT_DESIGN.md)：日志输出约束。

## 本地归档

根目录 `release/` 保存当前候选包及必要的回退包；源码恢复快照位于 `dustbin/source-backups/`，较旧发布包位于 `dustbin/release-history/`，旧向导、早期笔记与构建检查也均在 `dustbin/` 下。归档不会进入 npm 包；需要追溯时可在本地查看。

## 阅读原则

判断当前行为时只以 `src/`、根目录四份用户文档以及本目录的当前文档为准。`dustbin/` 中的内容都不是当前实现说明。

> **主仓与 CEV 分叉仓（2026-10-28 更新）**：`hds-interlude` 主仓为发布主线；`hds-interlude-cev` 为活跃实验分叉（表名 `cev_interlude_*` 前缀、Console 命名空间 `hdsi-cev`，可与主仓同实例并存），新功能先在 CEV 落地、成熟后移植主仓（考据 Agent / 密度自适应 / HDSI Console 均循此路径）。2026-09-29 的"cev 仓转为只读存档"声明已被此模式取代。桌面壳以 typ0-cev 的 UI_DESIGN_SPEC_V2 实现为标准。

