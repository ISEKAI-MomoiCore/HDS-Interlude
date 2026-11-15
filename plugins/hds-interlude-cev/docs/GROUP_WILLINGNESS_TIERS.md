# 群聊发言意愿档位（Willingness Tiers）与 auto 档

适用版本：`1.0.1-rc23` 起；当前实现基线为 `1.0.1-rc52`。本文记录设计来源，当前配置入口和行为以 `CONFIGURATION_GUIDE.md` 与源码为准。

## 定位

把群聊本地意愿门从"10 个数值参数"收敛为**单选档位**，并新增 **auto 档**：压缩器在每次整理时附带返回主角注意力状态（`busy | asleep | idle`），宿主据此自动切换档位。auto 档**不增加任何模型调用**——状态搭压缩器便车（默认每 10 分钟 + 回合后触发）。

评分数学本身零改动（本地累积/半衰期/阈值/掷骰），档位只是参数来源。

## 档位表

| 档位 | 体感 | threshold | baseGain | quote/keyword | amplifier | halfLife | replyCost |
|---|---|---|---|---|---|---|---|
| quiet 极少 | 约每 10 条普通消息一次 | 0.80 | 0.12 | 0.08/0.12 | 1.1 | 150s | 0.85 |
| reserved 谨慎 | 约每 6~8 条一次 | 0.75 | 0.17 | 0.12/0.16 | 1.25 | 200s | 0.85 |
| **normal 标准** | **约每 4~5 条一次（基线）** | 0.62 | 0.25 | 0.15/0.20 | 1.4 | 240s | 0.80 |
| active 活跃 | 约每 2~3 条一次 | 0.30 | 0.34 | 0.20/0.25 | 1.6 | 300s | 0.60 |
| eager 热情 | 几乎每批都想说 | 0.10 | 0.45 | 0.28/0.30 | 1.8 | 360s | 0.50 |

- 基线校准：单条批次连续到达、掷骰公平时的期望首发位置（测试 `group-willingness-tiers.test.ts` 以固定掷骰 0.4 锁定：eager=1、active=2、normal=4~5、reserved=6~8、quiet=9~13）。
- 密集批次（多条合并成一个 debounced batch）累积更快，@ 直通（睡眠态除外）维持不变。
- `keywords` 与档位正交：所有档位下旧配置的关键词仍生效。

## preset 与 auto

`GroupChatRule` 新增 `willingnessPreset`（默认 `off`）与 `willingnessAuto`：

```
willingnessPreset: off | quiet | reserved | normal | active | eager | auto | custom
willingnessAuto:   { busy: quiet(默认), idle: active(默认), asleep: quiet(默认) }  // 三态各可选五档
```

- **off**：仅响应模式（mention-only/always）与冷却生效，与旧默认一致。
- **auto**：按 `StoryState.lifeStatus` 切档——`busy→配置档`、`idle→配置档`、`asleep→配置档`；状态缺失、无效或超过 6 小时未刷新时按 **idle** 映射回退（默认 `active`；用户配置 `idle: eager` 时使用 `eager`），不写回生活状态。
- **custom**：沿用旧数值对象。
- **存量兼容**：preset 未设置（或为 off）但旧数值门 `enabled=true` 时，自动按 `custom` 处理，存量行为字节级不变。要真正关掉旧门，把旧对象 `enabled` 设为 false 或把档位切到其他值。

## 睡眠态（asleep）的三个固定行为

1. **@ 不再直通**：她在睡觉，@ 留给醒来后的回合自然处理（主模型会写她没看手机）。
2. **概率 ×0.2**：独立于所配档位的安全余量，对冲状态过期/误判。
3. 掷骰失败时拒绝原因记为 `asleep`，日志可见。

音频强触发维持不变：群音频仍绕过意愿与冷却直接触发主叙事。

## lifeStatus 数据链

- 压缩提示词（full 与 lite 档）各加一条指令：按已压缩条目与日程上下文给出 `busy|asleep|idle`，不确定时省略字段。
- `CompactionDecision.lifeStatus` → `normalizeLifeStatusDraft` 防御归一（仅三值合法）→ `persistCompaction` 写入 `StoryState.lifeStatus = { status, updatedAt }`（仅当值合法且变化时写库；无效/缺失保持旧值）。
- 状态经 `KNOWN_STORY_STATE_KEYS` 登记与 `normalizeLifeStatus` 归一，旧数据无需迁移，重载不丢。
- `storyStateForPrompt` 将其剥除——宿主调度字段不进模型上下文。
- 群回合评估与发言后扣减（`evaluateWillingnessGate` / `consumeWillingnessGate`）共用同一档位解析层，replyCost 对齐。

## 日志

- 未触发：`群聊意愿未触发模型调用 群=%s 分数=%s 概率=%s 原因=%s 档位=%s`
- 触发：`群聊消息准备进入主叙事 群=%s 模式=%s 意愿=%s 档位=%s`；auto 档显示 `auto(idle→active)` / `auto(无状态→idle→active)` / `auto(过期→idle→active)` 形态。
- 状态更新：`生活状态已更新 状态=%s`（diagnostic 级）。

## 验证

- `test/group-willingness-tiers.test.ts`：五档校准区间、off、存量 custom 兼容、auto 三态映射与自定义、asleep @ 阻断与 ×0.2、缺失/无效/过期按 idle 映射回退、过期边界、回退扣减一致性、诊断日志、归一函数、档位单调性。
- `test/group-assignee.test.ts`：Console 字段兼容性、真实 SQLite 受理人变更与新群创建、真实 Koishi attach 门控对两名普通群成员放行、保留频道/用户忽略标记、白名单与失败隔离。
- 历史实现验证：主仓 394 通过 / cev 385 通过，typecheck 零错误。该计数为初次实现记录，不代表当前回归规模。
- 2026-10-11 受理人与 idle 回退修正：主仓全量 826 项，822 通过、4 跳过、0 失败；严格 typecheck 与 Yarn 4 Yakumo 构建通过。详见 `development/GROUP_ASSIGNEE_IDLE_FALLBACK_2026-10-11.md`。
- 本次未打包部署；桌面 MIXER 面板如需暴露 preset 下拉，随下一版本处理。
