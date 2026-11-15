# Agency Window

适用版本：`1.0.1-rc60`

## 定位

Agency Window 是主角生活条件的证据投影。它记录日程负荷、隐私环境、设备可用性和证据时效，为剧本写作提供可解释的情境材料。它与统一通信动作契约协作：主模型先写出主角真实发生的生活和动作，宿主再依据总开关、白名单、端点能力和统一投递策略执行。

当前默认值为 `agency.enabled=false`。已有显式配置仍可读取；Agency Window 开启后只增加场景条件投影，不建立独立的联系裁决链。`runtime.allowProactiveMessages`、跨会话权限、账号白名单和端点权限继续承担部署边界。

典型数据流：

`生活剧本 → Agency Window 条件证据 → CONTACT ACTIONS 原文动作 → 统一策略 → ScriptCommit/Delivery Ledger → 平台投递与回执`

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

每个状态都绑定真实剧本条目，并受到 `maxWindowMinutes` 限制。证据过期后以“未知”进入概览和提示词，下一次生活回合可以重新建立条件。

## 联系动作

当前作者动作使用统一 CONTACT ACTIONS 契约：

- 即时动作把原文消息放在 `<say id="...">` 中，并由 `communicationActions` 引用目标。
- `timing="future"` 表示人物形成了未来联系计划，落入 `contact-plan` 意图，在到期回合重新进入正常写作。
- `timing="fixed-delay"` 表示确定的延迟投递，保留为确定延迟意图并由投递管线执行。
- 旧 `crossConversationActions`、`interaction.reply` 和 `proactiveContact` 仍作为输入适配；旧 `recheck-later` 会转换为同一 `contact-plan`。

动作文本、投递接受、平台回执和对方阅读分别记录。未知回执保持“待核实”，后续回执可以升级为已送达。

## 执行边界

统一策略位于 `deliveryPolicy`：

- `proactivePerTargetDailyCap`：每目标滚动 24 小时逻辑主动动作上限。
- `minimumRunIntervalMinutes`：逻辑主动动作的最短运行间隔。
- `deferralValidityMinutes`：明确延期动作的有效期限。

总开关、白名单、端点健康、端点发起资格、设备和真实平台能力在各自边界执行。额度从投递账本派生，稳定的脚本事件身份贯穿重启、回执、人工核实和取消。

## 历史兼容

旧配置中的 `contactMode`、`naturalWillingnessThreshold`、`naturalMinimumIntervalMinutes`、`proactiveDailyCap` 继续作为迁移依据；统一运行链使用 `deliveryPolicy`。旧 `proactive-check` 任务通过 `interlude.policy.migrate` 预览、确认并迁移为 `contact-plan` 或终结。历史 `proactiveContactLog` 继续由故事状态解码器读取，新的额度计算使用投递账本。

旧的 Agency 容量函数、候选指纹、专用重查排期和发送前 shadow 复核已经退出生产链，因此运行过程只保留一套策略结果和一套动作账本。

## 与其它系统的边界

- Urge 负责生活推进节奏，提供 `slow/normal`、建议间隔和原文依据；它不生成独立消息，也不决定联系许可。
- Alter 负责氛围偏移，不参与投递资格。
- Memory、Overlay、Active Consequence 和日程预排提供已经建立的事实与压力材料，不直接制造发送事件。
- Console 概览显示出站限制与当前行动条件；通信动作页显示原文、计划、分段状态和人工核实入口。
