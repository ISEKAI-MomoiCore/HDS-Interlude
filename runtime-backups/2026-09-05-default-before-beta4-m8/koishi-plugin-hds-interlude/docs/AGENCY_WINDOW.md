# Agency Window

适用版本：`1.0.0-beta4-m7`

## 定位

Agency Window 只负责外部联系行动的现实容量：日程负荷、隐私和设备可用性。它不描述情绪、不计算关系阶段或联系风格，也不读取 Alter 数值。

主动联系遵循：

```text
先写主角自己的生活
→ 生活产生真实联系理由
→ 检查日程、隐私、设备、意愿和安全间隔
→ 立即联系 / proactive-check 稍后重查 / 自然放下
```

用户长时间沉默本身不能成为联系理由。

## 状态

`StoryState.agencyWindow` 保存：

- `activityLoad`: `free | occupied | overloaded`
- `privacy`: `private | shared | public`
- `deviceAccess`: `available | limited | unavailable`
- `nextOpportunityAt`
- `validUntil`
- `basis`
- `sourceEntryIds`
- `updatedAt`

状态必须引用真实剧本条目，并被 `maxWindowMinutes` 限制。过期状态不会进入主模型。

## 联系候选

`proactiveContact` 支持：

- 来源：生活事件、承诺、实际安排、关系后续
- 内容敏感度：普通或私人
- 目标参与者
- 具体 motive
- 真实来源条目
- willingness
- `send-now | recheck-later | let-go`
- 最早重查时间和过期时间

候选参与者必须通过当前白名单；来源 ID 必须来自提供给模型的真实条目。当前新剧本产生的理由由宿主自动绑定到该剧本条目。

## 容量矩阵

- 设备不可用或受限：不立即发送。
- 日程过载：不立即发送。
- 私人内容且环境不私密：不立即发送。
- 普通忙碌状态只允许承诺或实际安排突破。
- 普通联系受 `minimumProactiveIntervalMinutes` 限制；承诺可绕过。
- willingness 仍需达到 `runtime.proactiveWillingnessThreshold`。

## 延后重查

`recheck-later` 复用 `interlude_intent` 创建 `proactive-check`，只保存 motive、来源和约束，不保存预写消息。到期后单独成批处理，重新读取当前生活和 Agency Window：

- `send-now`：当前参与者使用 `interaction.reply.immediate`。
- `recheck-later`：创建新的未来检查。
- `let-go` 或候选过期：不发送并结束。

同一 `participantId + origin + sourceEntryIds` 的 pending 候选会去重。

## 与其它系统的边界

- Alter：只影响剧情氛围和表达，不参与联系容量。
- Memory/Overlay：提供已发生事实和稳定变化，不直接触发发送。
- Active consequence / promise：可以成为生活来源，但最终仍通过 Agency 判断。
- 原始私聊：后台不重新加入原始对话；仅提供受控的参与者姓名、资料和关系摘要。

## 现有主动联系失效原因

0.1.2 虽然可以开启主动消息，但后台 participant payload 实际只包含 opaque ID、未读数和时间戳；名称、资料和关系没有进入请求。advance 同时移除了原始私聊，又要求具体理由和较高 willingness，因此模型几乎没有足够信息生成合法 crossConversationAction。

0.1.3-beta1 修正了参与者摘要，并使用 Agency Window 提供完整的产生、延后和重新裁决路径。
