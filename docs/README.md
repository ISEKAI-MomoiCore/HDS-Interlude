# HDS Interlude 文档索引

当前发布候选为 `1.0.1-rc52`，包含相对 rc50 发布包的累计修复（含 rc50 后工作区未发布修复）；本次发布流程已构建对应 `lib/` 并交付 rc52 安装包，旧候选包不会自动变化；正式运行环境验收仍由维护者最后执行。根目录 README、新手指南、配置指南和命令文档面向使用者；本目录保存当前架构、设计依据、发布增量与维护记录。判断当前行为优先阅读“当前实现”，历史报告只用于追溯，不覆盖源码与当前架构。

## 当前实现

- [ARCHITECTURE.md](ARCHITECTURE.md)：当前真实架构和数据流。
- [INDIRECT_SUBJECT_DESIGN.md](INDIRECT_SUBJECT_DESIGN.md)：作者中介的叙事主体、主角与 narrator 的边界，以及 SV3/SV4 的主体性、关系连续性和重置设计约束。
- [LONG_HORIZON_NARRATIVE_GUIDANCE_DESIGN.md](LONG_HORIZON_NARRATIVE_GUIDANCE_DESIGN.md)：长线剧本指导 / Narrative Attractor 设计（Phase 0–3 已实现，Phase 4 进行中）——有效剧本条目加权累计、私聊全计 / 群聊半计、阶段性人物弧线、异步生成与主叙事注入边界。
- [V2_IN_PLACE_REFACTOR_IMPLEMENTATION_FORM.md](V2_IN_PLACE_REFACTOR_IMPLEMENTATION_FORM.md)：V2 原位迁移、当前完成度和验证门槛。
- [V2_VS_BETA10_COMPARISON.md](V2_VS_BETA10_COMPARISON.md)：beta10 与当前 V2 架构的对照及拟真性收益。
- [ALTER_SYSTEM.md](ALTER_SYSTEM.md)、[AGENCY_WINDOW.md](AGENCY_WINDOW.md)、[SCHEDULE_PREPLAN.md](SCHEDULE_PREPLAN.md)：当前次级系统边界。
- [FORWARD_MESSAGE_READING_DESIGN.md](FORWARD_MESSAGE_READING_DESIGN.md)：QQ 合并转发读取现状、SnowLuma 接口依据与 HDSI 接入方案。
- [GROUP_HISTORICAL_IMAGE_CONTEXT_DESIGN.md](GROUP_HISTORICAL_IMAGE_CONTEXT_DESIGN.md)：群聊历史图片证据回流主叙事的持久化、选择、回源与模型边界。
- [WORLD_EVENT_SEEDER_DESIGN.md](WORLD_EVENT_SEEDER_DESIGN.md)：世界事件播种器（已随 rc23 发布；rc24 起模型选择为用途勾选）——外部事件源、事实权威/反应自由语义、生成回路与注入管线。
- [GROUP_WILLINGNESS_TIERS.md](GROUP_WILLINGNESS_TIERS.md)：群聊意愿档位化与 auto 档（已随 rc23 发布）。
- [WECHAT_CHANNEL_PLAN.md](WECHAT_CHANNEL_PLAN.md)：微信接入总体方案（v2）——onebots + OneBot v11 文本私聊 POC 路线与原生渠道适配层长期架构；POC 工作区 `C:\dev\onebots-wechat-poc`，未开始写码。
- [QZONE_FEED_DESIGN.md](QZONE_FEED_DESIGN.md)：QQ 空间（说说）通道——感知-行动分离架构、qzone-action 意图、好友动态轮询、限流与安全边界（按端点分桶；rc29 已纳入发布候选）。
- [MULTI_CHANNEL_SINGLE_STORY_DESIGN.md](MULTI_CHANNEL_SINGLE_STORY_DESIGN.md)：单剧本多通道设计（QQ + 微信，v3 实现规格）——UUID 端点身份与注册表、入站反向解析链、三维端点状态时效、canonical 别名迁移与回滚、M1a/M1b 拆分路线。
- [OFFLINE_ATTENTION_EXPERIMENT.md](OFFLINE_ATTENTION_EXPERIMENT.md) —— 离线注意力实验设计（想不想聊由模型申报 attentionAfter 进入仅响铃/勿扰，看不看得见由宿主执行：未读台账、锁屏摘要、phoneCheck 回放回合、轰炸唤醒——无时刻表判定）
- [MULTI_CHANNEL_IMPLEMENTATION_ROADMAP.md](MULTI_CHANNEL_IMPLEMENTATION_ROADMAP.md)：M2-M4 实施路线（M1/M2/M3 及代码级 M4 已完成；真实多端点运行环境验收延期至维护者最后执行）——双 QQ 号作 M2 验证载体、端点管理/用户链接/回合 sources 语义详细设计、微信 POC 补完步骤、M3/M4 概要与节点事务。
- [PLUGIN_UPGRADE_EXECUTION_PLAN.md](development/PLUGIN_UPGRADE_EXECUTION_PLAN.md)：rc29 发布候选的执行计划、EndpointState/Delivery Gate 实现状态与剩余运行环境验收。

## 发布增量与维护记录

- [rc50 发布验证（2026-10-11）](development/RELEASE_VERIFICATION_2026-10-11_RC50.md)：定向构建、严格类型检查、全量回归、包内容与实际 bundle 冒烟。

- [全量源码审查修复与交互验证（2026-10-11）](development/FULL_CODE_REVIEW_FIXES_2026-10-11_RC48.md)：投递、整理事务、调度与性能逐项修复；报告记录的是当轮源码验收，本次发布另见 rc50 发布验证报告。
- [全量源码审查基线（2026-10-10）](development/FULL_CODE_REVIEW_2026-10-10_RC48.md)：修复前的证据与范围，当前状态以修复报告为准。

- [rc12 Anthropic Messages 适配](development/ANTHROPIC_MESSAGES_RC12.md)：双协议选择、cache-first、流式、群音频写作与兼容边界。

- [CHANGELOG.md](CHANGELOG.md)：rc50 相对 rc48 的累计变更与历史发布记录。
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

> **仓库统一（2026-09-29）**：自本版起 `hds-interlude` 主仓为唯一操作目标。模型特化已经接入主叙事及相关侧端提示词，并提供 Console 配置；SharedWorks 的模块、数据类型、SQLite 表和测试已经迁入，但当前尚未接入 HDSI 的用户命令与完整运行闭环。cev 仓转为只读存档。桌面壳以 typ0-cev 的 UI_DESIGN_SPEC_V2 实现为标准。

