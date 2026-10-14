# Agency Window

适用版本：`1.0.1-rc52`

## 定位

当前工作区默认 `agency.enabled=false`，仅在显式开启时使用下述行动窗口门控；已有配置中的显式 `true` 保持生效。此默认值调整属于 rc50 后续修复，已发布的 rc50 安装包不会自动获得该变化。关闭 Agency 不改变 `runtime.allowProactiveMessages` 的独立控制。

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
- `strict` 模式使用运行时或 Urge 的有效主动联系意愿阈值；`natural`/`balanced` 模式使用 `agency.naturalWillingnessThreshold`。设备、隐私、日程容量、白名单和每日上限仍独立生效。

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

## 联系温度（contactMode，随 rc24 后版本加入）

`agency.contactMode` 三档，默认 `strict`（与既有行为完全一致）：

- **strict**：现状——沉默本身不是理由，动机须落在她的生活事实上。
- **natural**：提示词追加教义——想念、好奇近况、想分享此刻也是合法动机（须剧本显示她真的想到对方；`participants[].lastUserMessageAt` 的沉默时长作为事实已在载荷中）；意愿阈值降为 `naturalWillingnessThreshold`（默认 0.25），安全间隔取 `naturalMinimumIntervalMinutes`（默认 30，仅当小于严格间隔时生效）。
- **balanced**：教义同 natural，但要求节制使用情感动机，多数联系仍跟随具体生活理由。

三模式共有的保护：容量硬门（设备/隐私/负荷）不放宽——想聊天也需要手机和隐私；Urge 爆发间隔优先于模式放宽；**每参与者每 24 小时主动联系上限 `proactiveDailyCap`（默认 3，0=不限）全模式生效**，计数来自 `story.state.proactiveContactLog`（最近 20 条审计窗，不进模型上下文）。rc51 起计数为**送达语义**：放行时预记条目携带投递关联 `ref`，投递终态失败按 `ref` 作废——被端点拦截或传输失败的发送不再消耗配额；可恢复（pending）失败不作废。触顶时不排重查，交由下一次推进自然判断。

另有两项 rc51 行为注记：其一，端点门控判定离线前会按账号键回查 `ctx.bots` 实况，适配器生命周期事件丢失（如 `getLogin` 失败但连接仍收发）不再造成"直到下一条入站消息"的拦截窗，且每轮后台 sweep 重同步连接状态；其二，出站失败的 5 分钟端点冷却不再拦截用户触发（`userInitiated`）的回复——冷却的防轰炸语义只针对后台与主动重试路径。


