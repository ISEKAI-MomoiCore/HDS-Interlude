# Urge 系统实现说明

## 当前职责

Urge 是剧本驱动的生活推进调度器。自动主叙事提交完整原始剧本和既有动作后，可交接 `pace`、建议下次生活处理间隔、生活节奏 `rhythmAttention` 与原文 `basisQuote`。Urge 只计算下一次生活推进时间，不生成独立回复、未来消息或通信动作。

运行模型为“对话密度 × 生活节奏”的乘法调度：密集对话和手机专注会缩短生活推进间隔，休息、忙碌和睡眠会降低推进密度；明确到期承诺、有效截止时间和日程锚点优先于随机调度。

## Console 配置

`urge.enabled=false` 保持现有调度路径；开启后仍受 `runtime.autoAdvanceEnabled` 总开关控制。Urge 不会改变 `runtime.allowProactiveMessages`、端点权限或 `deliveryPolicy`。

| 项 | 当前含义 |
| --- | --- |
| `frequency` | `low/medium/high/custom`，自定义未填写项使用中频范围 |
| `advanced.idleMin/Max` | 安静生活推进等待范围 |
| `advanced.slowMin/Max` | 剧本交接为 slow 时的等待范围 |
| `advanced.halfLifeMinutes` | 对话密度半衰期 |
| `advanced.activeMultiplier` | 对话密度对推进速度的倍率 |
| `advanced.restMultiplier` | 缺少新鲜节奏证据且处于休息窗口时的兜底倍率 |

联系意愿阈值、contact burst、contact jitter、contactMin 和联系后确认已经从 Urge 运行模型退出。旧配置字段仍可被读取并在配置迁移中保留解释，当前 Console 以生活调度字段为准。

## 与统一通信动作的关系

作者动作在主叙事中由 CONTACT ACTIONS 表达；Urge 只负责下一次生活回合的时间安排。动作是否发送由总开关、白名单、端点能力、场景条件和 `deliveryPolicy` 决定。投递回执不会改变 Urge 的节奏状态，避免“发出消息”与“生活推进”形成重复加速。

## 验证边界

已覆盖：状态迁移清理旧 burst 字段、生活节奏写入与过期、五档节奏倍率、建议间隔、有界随机调度、重启后恢复和与自动推进总开关的组合。文学质量继续通过固定设定与生活材料的盲评观察，重点看生活连续性、动作具体性和节奏自然度。
