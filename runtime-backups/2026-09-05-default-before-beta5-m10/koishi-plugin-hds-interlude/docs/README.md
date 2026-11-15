# HDS Interlude 文档索引

当前源码面向 `1.0.0-beta4-m8`。根目录的 README、新手指南、配置指南和命令文档面向使用者；本目录只保存当前架构、功能设计和开发约束。

## 当前文档

- [ARCHITECTURE.md](ARCHITECTURE.md)：当前真实架构和数据流。
- [SCRIPT_CENTRIC_ARCHITECTURE_REDESIGN.md](SCRIPT_CENTRIC_ARCHITECTURE_REDESIGN.md)：V2 高度剧本化的目标架构与设计取舍。
- [V2_IN_PLACE_REFACTOR_IMPLEMENTATION_FORM.md](V2_IN_PLACE_REFACTOR_IMPLEMENTATION_FORM.md)：从 beta10 原位迁移到 V2 的里程碑、验证门槛与实施记录。
- [ALTER_SYSTEM.md](ALTER_SYSTEM.md)：Alter System 状态机、模型协议和故障规则。
- [AGENCY_WINDOW.md](AGENCY_WINDOW.md)：主体行动窗口、主动联系容量和延后重查。
- [SCHEDULE_PREPLAN.md](SCHEDULE_PREPLAN.md)：近期日程的生成、每日审查、半日提示词投影和自动推进锚点。
- [CHANGELOG.md](CHANGELOG.md)：版本血统和当前版本变更。
- [SECURITY.md](SECURITY.md)：发布包边界、依赖审计和已知上游风险。
- [development/](development/)：开发检查、日志设计与维护资料。
- [development/logging/LAYERED_LOG_IMPLEMENTATION.md](development/logging/LAYERED_LOG_IMPLEMENTATION.md)：当前彩色分层日志实现。
- [development/logging/LOG_FORMAT_DESIGN.md](development/logging/LOG_FORMAT_DESIGN.md)：日志输出约束。

## 本地归档

旧 release 包、解压副本、调试截图、失败尝试、源码快照、早期笔记和构建产物已移至项目根目录的 `dustbin/`。该目录默认不提交，也不会进入 npm 包；需要追溯时可在本地查看。

## 阅读原则

判断当前行为时只以 `src/`、根目录四份用户文档以及本目录的当前文档为准。`dustbin/` 中的内容都不是当前实现说明。
