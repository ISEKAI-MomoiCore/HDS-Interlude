# 开发与维护资料

当前已发布版本为 `1.0.1-rc58`（2026-10-27），工作区另有未发布增量（考据 Agent / 密度自适应 / HDSI Console / 表情包采集）——见[更新记录](../CHANGELOG.md)顶部。当前行为以源码、[当前架构](../ARCHITECTURE.md)、[V2 实施表](../V2_IN_PLACE_REFACTOR_IMPLEMENTATION_FORM.md) 与[更新记录](../CHANGELOG.md)为准；本目录全部文档用于追溯，不能覆盖当前实现。

## 当前发布与近期增量

- [RELEASE_VERIFICATION_2026-10-11_RC50.md](RELEASE_VERIFICATION_2026-10-11_RC50.md)：rc50 构建打包、包内容、实际 bundle 冒烟与 Gitee 同步范围。

- [FULL_CODE_REVIEW_FIXES_2026-10-11_RC48.md](FULL_CODE_REVIEW_FIXES_2026-10-11_RC48.md)：C01–C14、P01–P04 逐项源码修复、交互验收、性能基准与未实机验证边界。
- [FULL_CODE_REVIEW_2026-10-10_RC48.md](FULL_CODE_REVIEW_2026-10-10_RC48.md)：本轮修复前的审查基线，缺陷描述不代表当前仍存在。

- [FUNCTION_CONFLICT_AUDIT_2026-09-17.md](FUNCTION_CONFLICT_AUDIT_2026-09-17.md)：功能交接小修、日志证据与待决的大问题清单。

- **历史 rc33 验包记录**：rc33 候选曾完成源码构建、严格类型检查、全量测试与 Yarn 4 tgz 打包；详细门槛和剩余验收见 [PLUGIN_UPGRADE_EXECUTION_PLAN.md](PLUGIN_UPGRADE_EXECUTION_PLAN.md)。

- [ANTHROPIC_MESSAGES_RC12.md](ANTHROPIC_MESSAGES_RC12.md)：rc12 协议选择、缓存与群音频接入边界。

- [../CHANGELOG.md](../CHANGELOG.md)：生活剧本展开、消息感知提示词与发布记录。
- [EVENT_LED_SCRIPT_REPAIR.md](EVENT_LED_SCRIPT_REPAIR.md)：事件优先续写、Alter 收束与关系学习证据边界。
- [P1_MEMORY_NAVIGATION.md](P1_MEMORY_NAVIGATION.md)：P1-1～P1-4；同事项交接、历史补齐、细粒度原文与事项导航。
- [URGE_SYSTEM_PROPOSAL.md](URGE_SYSTEM_PROPOSAL.md)、[URGE_SYSTEM_IMPLEMENTATION.md](URGE_SYSTEM_IMPLEMENTATION.md)：默认关闭的可选弹性自动推进设计、实现和兼容边界。

## 历史报告

- [BETA6_EVIDENCE_DELIVERY_REPAIR.md](BETA6_EVIDENCE_DELIVERY_REPAIR.md)：已随 beta7-enhanced 发布的 P0-1 / P0-2 / P0-4 与分段回复登记修复；不含 P0-3。

- [BETA6_ARCHITECTURE_REPAIR_REPORT.md](BETA6_ARCHITECTURE_REPAIR_REPORT.md)：五项修复、模块交接、测试与实机验收边界。

- [M10_FUNCTIONAL_COOPERATION_REPORT.md](M10_FUNCTIONAL_COOPERATION_REPORT.md)：当前功能组合、调度、投递和实机验收边界。
- [SECONDARY_FEATURE_ALIGNMENT_BACKLOG.md](SECONDARY_FEATURE_ALIGNMENT_BACKLOG.md)：后续次级功能与剧本核心的非破坏式对齐方向。
- [TIMELINE_DIRECTOR_REPLAN_REPORT.md](TIMELINE_DIRECTOR_REPLAN_REPORT.md)：时间导演重规划只读调查（2026-09-10，自 docs 顶层归位——历史报告不覆盖当前实现）。
- [CORE_SYSTEMS_RISK_TRIAGE_RC48.md](CORE_SYSTEMS_RISK_TRIAGE_RC48.md)：rc48 基线核心系统风险普查与复核（自 docs 顶层归位，结论已被后续修复推进）。
- [logging/LAYERED_LOG_IMPLEMENTATION.md](logging/LAYERED_LOG_IMPLEMENTATION.md)：当前日志实现。
- [logging/LOG_FORMAT_DESIGN.md](logging/LOG_FORMAT_DESIGN.md)：日志字段与输出约束。

早期实现笔记、历史发布向导、失败分析、源代码快照和发布检查产物均已归档至项目根目录的 `dustbin/`，不应作为当前实现依据。



