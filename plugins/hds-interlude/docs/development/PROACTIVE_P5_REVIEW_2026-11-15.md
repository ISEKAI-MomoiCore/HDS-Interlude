# 主动联系统一架构 P5 审查与验收

日期：2026-11-15

## 审查范围

本次按当前版本的 PROACTIVE_ACTION_UNIFICATION_DESIGN.md 复核 P1–P4 的实际源码、测试、配置、Console、结构化日志和桌面桥接。审查重点是统一作者动作是否真正贯穿“原文 → 提交 → 策略 → 投递 → 回执”，以及旧 Agency 链路是否仍在生产路径产生第二套裁决。

## P1–P4 结果

| 范围 | 当前结论 |
| --- | --- |
| 统一动作契约 | communicationActions 已接入；say 绑定、目标白名单、群回声闸、future 计划和拒绝原因均有实现。 |
| 投递账本 | unknown、晚回执升级、确认成功保护、重启恢复边界和 deliveryReality 已接入。 |
| 统一策略 | advance 的即时私聊动作按动作独立评估；额度从投递账本派生；总开关、端点和白名单继续在原边界执行。 |
| Agency/Urge | Agency Window 保留场景条件证据；Urge 保留生活推进调度；联系意愿和联系 burst 已退出运行模型。 |
| Console/日志/桥接 | 通信动作列表/详情、取消/核实、概览派生摘要、结构化事件和 communication-actions-v1 能力位已接线。 |
| 历史兼容 | 旧配置、旧 proactive-check、旧故事状态和旧输入格式保留解码与迁移路径。 |

## 审查中发现并修复

1. 旧 proactiveContact.recheck-later 由解析器读到后没有进入意图簿，因此人物未来计划会静默消失。现在转换为统一 contact-plan，并遵守消息权限和目标白名单。
2. communicationActions.timing="fixed-delay" 在归一化后被当成即时动作。现在转换为 crossConversationActions.mode="delayed" 并保留 sendAt，由现有确定延迟管线消费。
3. P4 的结构化日志信封原本只由策略事件生产；投递结果和计划变化仍依赖中文兼容日志。现在在账本写入及计划创建、过期、消费、管理取消的落库点发出 delivery-result / contact-plan-updated，携带 commit/event/segment 或 intentId、目标、端点与可用的 trace/processing 关联。幂等回执及失败写入保持零新增事件，日志异常保持原有执行结果。

## P5 清理项

- 从 src/agency.ts 移除生产不再使用的容量否决、候选指纹和专用重查时间计算；保留 Agency Window 和旧草稿解码。
- 从 src/intents.ts 与 src/service.ts 移除 appendProactiveCheck 生产器及薄委托；历史任务继续由迁移器和兼容消费处理。
- 从 src/delivery/pipeline.ts 移除发送前 shadow、旧 contact-log 额度派生和 proactiveContactRef 失败作废；从 OutgoingMessageDraft 移除旧专用 ref。
- 从 deliveryPolicy 移除已经完成过渡使命的 shadowCompare 活跃字段与 revision 参与项；旧配置解析自然忽略该字段。
- 删除只验证旧 Agency 运行裁决和重查调度的过时测试，保留兼容解码、迁移、统一策略和账本测试。
- 新增 `test/proactive-unification-p5.test.ts` 的 5 项集成回归：持久化与日志顺序、unknown/晚回执/重复回执、写入和日志失败、计划创建、过期与 Console 幂等取消。

## 验收结果

- npm run typecheck：通过。
- npm test：1307 项，1303 通过，4 项真实 API 用例按环境跳过，0 失败。
- npm run build:client：通过；`client-dist/index.js` 与 `client-dist/style.css` 已重建。
- 后端声明与 bundle：通过；`npx --no-install yakumo build hds-interlude` 完成，`lib/index.js` 入口冒烟返回 `apply=function` 且 `Config=true`。
- npm pack --dry-run --json：通过；prepack 新鲜度与 CJS/Console 资源校验通过，预检产物记录于 `C:/dev/artifacts/hdsi-proactive-p5-pack-20261115.json`。

测试完整日志：`C:/dev/artifacts/hdsi-proactive-p5-tests-20261115.log`。

普通路径仍保持零固定额外模型调用。客户端、后端 bundle、声明文件与包内文档已完成一致性预检。真实平台可能在 transport 超时后返回 unknown；本地账本以待核实状态承接晚回执，平台侧是否实际接收仍以真实回执和人工核实为准。


运行环境验收继续单独记录：真实 Console 浏览器交互、桌面消费者能力协商，以及真实平台回执和固定样本写作质量盲评。本次完成源码、真实 SFC 集成回归、类型、构建和打包预检，发布状态继续保留在未发布记录中。
