# HDS Interlude 管理与查看指令

适用版本：`1.0.0-beta4-m8`
## 使用前先看这里

- 新手安装和首次测试：`BEGINNER_GUIDE.md`
- 配置项解释：`CONFIGURATION_GUIDE.md`
- 本文件只保留管理员和剧本/记忆管理指令。



本文档说明 HDS Interlude 当前提供的 Koishi 指令。建议在私聊执行；授权群聊中的 `interlude.*` 同样会交给 Koishi 命令解析器。所有命令都会经过 HDSI 的授权检查，写入、调度与清理类操作还需要管理员权限。

`blindMode.enabled=true` 时，本页全部指令以及当前 Koishi 实例的其它已解析指令都会被静默屏蔽；请在 Console 关闭失明模式并重载插件后再使用管理功能。

## 权限模型

管理员权限由 `sharedStory.managerAccounts` 控制：

- 配置为空：所有已通过 `onebot.userAccounts` 白名单检查的账号都可以执行管理指令。
- 配置不为空：只有列表中的 QQ 号可以执行管理员指令。
- 未通过白名单检查的账号不能创建故事、读取上下文或执行管理指令。
- 查询指令不会写入剧本；`interlude.script.note`、`interlude.memory.add` 等人工修正指令会留下可审计记录。建议保持 `runtime.ignoreCommandMessages=true`。

机器人账号和用户账号必须分别配置：

```yaml
onebot:
  botAccounts:
    - qq: '机器人QQ号'
      enabled: true
  userAccounts:
    - qq: '管理员QQ号'
      label: '管理员'
      personId: 'admin'
      relationship: '主角信任的管理员'
      enabled: true

sharedStory:
  managerAccounts:
    - '管理员QQ号'
```

## 指令总览

| 指令 | 权限 | 用途 |
| --- | --- | --- |
| `interlude.doctor` | 白名单用户 | 检查当前 Console 档案、白名单、时区与主模型是否适合启动 |
| `interlude.story.start` | 管理员 | 确认后从 Console 档案启动第一份运行中故事 |
| `interlude.init [旧名称]` | 管理员 | 兼容别名；名称参数已忽略，请改用 `interlude.story.start` |
| `interlude.status` | 白名单用户 | 查看故事状态、运行游标、主动消息与 Agency Window |
| `interlude.setup <JSON>` | 管理员 | 修改当前故事的基础设定（Canon） |
| `interlude.pause` | 管理员 | 暂停自动推进、延迟处理和主动处理 |
| `interlude.resume` | 管理员 | 恢复自动处理 |
| `interlude.advance` | 管理员 | 立即将剧本补写到当前真实时间 |
| `interlude.timeline.rebase` | 管理员 | 从当前真实时间重建自动推进时间线，保留历史剧本 |
| `interlude.timeline [条数]` | 白名单用户 | 查看最近原始剧本条目 |
| `interlude.memory [条数]` | 白名单用户 | 查看长期事实记忆 |
| `interlude.context` | 白名单用户 | 查看活动场景、关系态势、剧本引子和长期连续性 |
| `interlude.compact` | 管理员 | 整理剧本场景、长期事实、状态提案，并同时执行 overlay 维护 |
| `interlude.script [条数]` | 管理员 | 查看跨参与者的原始剧本条目 |
| `interlude.script.note <内容>` | 管理员 | 写入带来源标记的人工剧本注记 |
| `interlude.memory.facts [条数]` | 管理员 | 列出长期事实及其编号 |
| `interlude.memory.add <范围> <内容>` | 管理员 | 人工添加高置信度长期事实 |
| `interlude.memory.forget <编号>` | 管理员 | 将长期事实标记为失效，不物理删除 |
| `interlude.memory.intents [条数]` | 管理员 | 查看延迟回复、提醒、承诺和剧情余波 |
| `interlude.memory.cancel <编号>` | 管理员 | 取消一条等待中的意图 |
| `interlude.memory.patches [条数]` | 管理员 | 查看人物、关系和世界设定的演化提案 |
| `interlude.memory.reject <编号>` | 管理员 | 拒绝尚未应用的演化提案 |
| `interlude.overlay.clear <部分>` | 管理员 | 询问 y/n 后，只清理 character、perspective、relationship、world 或 all 对应的设定 overlay |
| `interlude.overlay.status` | 管理员 | 查看当前 overlay、待积累提案和压缩归档数量 |
| `interlude.overlay.compact` | 管理员 | 只合并和压缩已应用的 overlay，不整理普通剧本记忆 |
| `interlude.schedule` | 已授权用户 | 查看 Schedule Preplan 覆盖范围和未来约半天的日程 |
| `interlude.schedule.refresh` | 管理员 | 重新审查当前日程，保留旧计划作为稳定参考 |
| `interlude.schedule.rebuild` | 管理员 | `schedule.refresh` 的兼容别名 |
| `interlude.database.clear` | 管理员 | 询问 y/n 后清空 HDSI 自有 SQLite 表；不会删除 Koishi 或其它插件数据 |
| `interlude.purge.all` | 管理员 | 询问 y/n 后彻底重置所有平台的剧本、记忆与 Canon，只保留一部空白主剧本 |
| `interlude.purge.platform <平台>` | 管理员 | 询问 y/n 后清空并归档指定平台的所有故事，例如 sandbox 或 onebot |
| `interlude.purge.range <开始> <结束>` | 管理员 | 询问 y/n 后删除时间范围内的剧本与关联记忆 |

## 详细用法

### `interlude.doctor`

只读检查当前 Console 档案，不调用模型、不创建故事、不显示密钥。

```text
interlude.doctor
```

它会展示主角、角色设定、Perspective、世界、时区、主模型、白名单、自动创建开关和已有故事状态。出现阻断项时先回到 Console 修正。

### `interlude.story.start`

从当前 Console 档案手动启动第一份运行中故事。命令会先展示档案预览并要求 `y/n` 确认；它不接受角色名或其它单项配置。

```text
interlude.story.start
```

已有活动主剧本时不会覆盖或重建。`interlude.init` 保留为兼容别名；旧的名称参数会被忽略并提示迁移。

### `interlude.status`

返回：

- 主角名称
- 参与者数量
- 故事状态（`active` / `paused`）
- 剧本游标 `cursorAt`
- 当前主模型连接
- 是否允许主动可见消息

### `interlude.setup <JSON>`

合并修改当前故事的基础设定。参数必须是一个 JSON 对象，不要使用 Markdown 代码块。

```text
interlude.setup {"world":"2026年上海的现实生活","style":"克制、具体、现实主义日常叙事"}
```

可修改字段包括：

```json
{
  "character": {
    "name": "林知遥",
    "profile": "夜班花店店员，作息不规律，习惯用简短语句说话"
  },
  "relationship": "大学旧友，重新恢复联系",
  "world": "当代上海，现实世界，不存在超自然设定",
  "supportingCast": "周宁：主角同事，关系普通",
  "location": "上海静安区",
  "style": "现实主义日常叙事，情绪克制，关系变化缓慢"
}
```

此指令是管理员的高级 JSON 修补工具，不属于首次配置流程；它修改当前故事设定，不会删除原始剧本、长期事实或关系分支。若只想改变某个 QQ 对应的人物资料，应修改 Console 中的 `onebot.userAccounts`。

### `interlude.pause` / `interlude.resume`

暂停或恢复当前主剧本的自动处理。

- `pause`：不删除历史记录；暂停自动生活推进、到期意图处理和主动消息。
- `resume`：恢复后台调度。恢复后系统会根据真实时间重新判断是否需要补写。

```text
interlude.pause
interlude.resume
```

### `interlude.advance`

立即补写从 `cursorAt` 到当前真实时间之间已经发生的生活。

```text
interlude.advance
```

该指令可能调用一次主叙事模型，并可能投递模型判断为“当前已经发生”的可见消息。它不会预写未来事件。

### `interlude.timeline.rebase`

从旧测试版升级后，如此前已把未来事件写入活跃场景、连续性快照或 workingDetails，可由管理员执行一次：

```text
interlude.timeline.rebase
```

它会询问确认，然后以当前真实时间重置这些短期时间状态；历史剧本、Canon、参与者和长期事实保持不变。

### `interlude.timeline [条数]`

查看当前账号可见的近期剧本条目，默认 10 条，最多显示 30 条。时间会按 Bot/故事配置的时区显示，并显式附带 `GMT±X` 偏移。

```text
interlude.timeline 20
```

在多人共享主剧本中，默认优先显示当前账号相关的条目，避免一次输出其他参与者的全部私聊内容。

### `interlude.memory [条数]`

查看当前账号相关的记忆摘要，默认 10 条，最多 30 条。它适合快速确认当前关系分支会读取到哪些记忆；若要审计事实库的原始编号，请使用管理员指令 `interlude.memory.facts`。

```text
interlude.memory 15
```

显示内容包含事实范围、重要度和正文。Embedding 只用于检索排序，不会把向量发送给主叙事模型。

### `interlude.context`

查看运行上下文摘要，包括：

- 当前活动场景的引子和压缩摘要
- 当前剧情弧线的标题与摘要
- 当前账号的初始关系和参与者状态 JSON
- 主角当前的全局 Overlay
- 当前 Agency Window（日程负荷、隐私、设备和有效期）
- 与当前账号相关的最多八条长期事实

```text
interlude.context
```

### `interlude.compact`

立即执行一次完整的后台记忆整理；如果 Schedule Preplan 到期，也会一并进行独立的轻量日程审查。

```text
interlude.compact
```

压缩模型会整理已完成场景、长期事实和状态变化提案，并顺便执行 overlay 分层维护。该指令可能调用压缩模型，但不会删除原始剧本。压缩失败不会回滚主剧本，也不会阻塞正常聊天。

如果只想处理 overlay，不想整理普通场景和事实，请使用 `interlude.overlay.compact`。

## 剧本人工管理

### `interlude.script [条数]`

查看整个共享主剧本的原始条目，默认 20 条，最多 50 条。与 `interlude.timeline` 不同，它不会按当前参与者过滤，因此仅管理员可用。

```text
interlude.script 30
```

每条记录包含数据库编号、发生时间、行为主体、条目类型、参与者标识和正文。编号可用于审计，但当前版本不提供物理删除原始条目的命令，避免误删无法恢复的历史。

### `interlude.script.note <内容>`

向剧本追加人工事实或导演注记。系统会将它标记为 `admin-note` 和“管理员注记”，不会伪装为主模型或用户说过的话；后续压缩会读到这条记录。

```text
interlude.script.note 主角今晚临时换班，直到凌晨前都在花店。
```

适合补充刚刚发生但模型未写到的事件。若修改的是长期稳定事实，优先使用 `interlude.memory.add`。

## 长期记忆管理

### `interlude.memory.facts [条数]`

列出当前有效的长期事实。每条都有 `#编号`、范围、重要度、置信度和未解决标志。

```text
interlude.memory.facts 30
```

### `interlude.memory.add <范围> <内容>`

人工写入一条高置信度（`1.0`）长期事实。允许的范围为：

- `character`：主角稳定事实
- `world`：世界或环境事实
- `relationship`：关系事实
- `event`：长期影响事件
- `promise`：承诺、约定或待办

```text
interlude.memory.add promise 主角答应在周三晚些时候告诉小林面试结果。
```

### `interlude.memory.forget <编号>`

将事实标记为 `superseded`，使其不再进入主模型上下文，但保留数据库记录以供审计。先用 `interlude.memory.facts` 获取编号。

```text
interlude.memory.forget 42
```

### `interlude.memory.intents [条数]` / `interlude.memory.cancel <编号>`

查看或取消等待中的延迟回复、主动联系、提醒、承诺和剧情余波。取消操作只影响尚未执行的意图，不会撤回已经发送的消息。

```text
interlude.memory.intents 20
interlude.memory.cancel 15
```

### `interlude.memory.patches [条数]` / `interlude.memory.reject <编号>`

查看压缩器对人物、关系和世界状态提出的演化提案。已应用、待审核和被拒绝的提案都会显示状态；`reject` 只接受 `proposed` 状态的提案。

```text
interlude.memory.patches 20
interlude.memory.reject 8
```

状态提案的生命周期是：`proposed`（积累证据）→ `applied`（写入当前 overlay）→ `compacted`（已进入历史快照）。执行 overlay 清理后会标记为 `cleared`。普通人格和关系变化默认需要至少 3 个不同剧本回合、跨越至少 2 个日历日，并受同一路径 72 小时冷却限制；重大变化仍需高置信度。

### `interlude.overlay.clear <部分>`

只清理剧情累计形成的设定 overlay，不删除 Canon、剧本、长期事实、普通记忆或等待中的意图。适合在 Console 中大幅修改某一项初始设定后使用。

- `character`：清理主角性格、人物资料和特征的演化 overlay。
- `relationship`：清理全局关系 overlay，以及所有参与者各自的关系 overlay。
- `world`：清理世界状态的演化 overlay。
- `all`：清理以上全部 overlay，但仍保留剧本和记忆。

执行后插件会询问“确认执行吗？(y/n)”，请回复 `y` 才会继续；回复 `n` 或 60 秒内没有回复都会取消。对应的已应用 overlay、历史压缩快照和仍在积累的候选提案都会失效并保留审计记录，避免旧候选在之后重新写回 overlay。

```text
interlude.overlay.clear character
interlude.overlay.clear perspective
interlude.overlay.clear relationship
interlude.overlay.clear world
interlude.overlay.clear all
```

### `interlude.overlay.status`

查看当前 overlay 维护状态，不修改数据：

- 全局 character、relationship、world overlay 是否存在；
- 仍在积累证据的候选提案数量；
- 已应用或已归档的提案数量；
- 已清理的提案数量；
- overlay 压缩快照数量；
- 参与者关系 overlay 数量。

```text
interlude.overlay.status
```

普通提案需要跨多个剧本回合和日期后才会应用。看到“待积累提案”不代表设定已经改变。

### `interlude.overlay.compact`

只执行 overlay 合并和压缩，不整理普通剧本、事实或记忆：

```text
interlude.overlay.compact
```

### `interlude.schedule`

查看 Schedule Preplan 的版本、覆盖日期、最后审查原因，以及从当前时刻起未来约 12 小时的计划块。输出是计划结构，不代表事项已经实际发生。

```text
interlude.schedule
```

### `interlude.schedule.refresh`

将现有 Schedule Preplan 标记为重新审查。旧计划会保留作稳定参考；命令不会阻塞聊天，当前前台回合结束且达到每日审查时间后，后台会复用压缩模型进行独立轻量审查。

```text
interlude.schedule.refresh
```

`interlude.schedule.rebuild` 保留为兼容别名，效果与 `refresh` 相同。

## 删除剧本和记忆

以下指令是不可逆的数据清理操作，仅允许管理员使用。执行后插件会询问 y/n，只有回复 `y` 才会继续；回复 `n` 或 60 秒内没有回复都会取消。系统会先尝试物理删除；如果 SQLite 文件被占用导致删除失败，会自动改用逻辑删除并清空正文，保证内容不再进入剧本上下文。执行前请先用 `interlude.script`、`interlude.memory.facts` 和 `interlude.context` 导出或截图需要保留的内容。

### `interlude.database.clear`

清空插件自己的 SQLite 数据表（剧本、参与者、记忆、事实、意图、场景、剧情弧线和状态提案）。不会删除 Koishi 用户、频道或其它插件的数据。执行命令后按提示回复 `y`。

```text
interlude.database.clear
```

### `interlude.purge.all`

删除所有平台的剧本与派生数据，并仅保留当前故事作为空白的全局主剧本：

- 原始剧本条目
- 场景摘要和剧情弧线
- 长期事实与普通记忆
- 等待中的意图/延迟回复计划
- 状态演化提案

会按当前 Console 的 `storyDefaults` 重建主角、世界、文风与默认关系；白名单行中的用户资料和关系也会重新写入参与者档案，并清空关系演化、未读数和待回复数。白名单账号与数据库表结构不会删除。执行后会创建新的空白活动场景和剧情弧线。

```text
interlude.purge.all
```

### `interlude.purge.platform <平台>`

只清理并归档某一个平台的所有 HDSI 故事，不影响其它平台。常用平台名为 `sandbox` 和 `onebot`；OneBot 的传输别名会一并匹配。执行命令后按提示回复 `y`。

```text
interlude.purge.platform sandbox
```

### `interlude.purge.range <开始> <结束>`

删除指定时间范围内的原始剧本，并删除创建时间、更新时间或来源条目落在该范围内的关联记忆、事实、意图和状态提案。与时间范围重叠的场景摘要也会删除；未重叠的历史数据保留。

时间必须使用可解析的 ISO-8601 格式，建议明确写出时区：

```text
interlude.purge.range 2026-08-01T00:00:00+08:00 2026-08-02T00:00:00+08:00
```

例如，删除 2026 年 8 月 14 日早上 09:00 至 10:00 的数据：

```text
interlude.purge.range 2026-08-14T09:00:00+08:00 2026-08-14T10:00:00+08:00
```

范围删除不会回退故事的真实时间游标，因此后续剧情不会被重新预写；它只清理指定时间段的持久化记录。SQLite 无法物理删除时，会对匹配记录执行逻辑删除和正文清空。

## 推荐的管理员操作顺序

1. 在 Console 中配置 `model.providers`、`storyDefaults` 和 OneBot 白名单。
2. 将管理员 QQ 加入 `sharedStory.managerAccounts`。
3. 执行 `interlude.doctor` 检查 Console 档案。
4. 关闭自动创建时，发送 `interlude.story.start` 启动共享主剧本；开启自动创建时直接发送第一条私聊即可。
5. 用 `interlude.status` 确认故事状态和模型模式。
6. 用普通私聊测试主模型写作、沉默、延迟回复和多账号关系。
7. 用 `interlude.script`、`interlude.memory.facts`、`interlude.memory.intents` 和 `interlude.memory.patches` 审计当前状态。
8. 需要人工修正时，优先写 `interlude.script.note` 或 `interlude.memory.add`；错误事实用 `interlude.memory.forget` 标记失效。
9. 需要立即测试自动生活或记忆系统时，分别使用 `interlude.advance` 和 `interlude.compact`。

## 故障排查

| 现象 | 检查项 |
| --- | --- |
| 提示没有管理权限 | 当前 QQ 是否在 `onebot.userAccounts`，以及是否在 `sharedStory.managerAccounts`。 |
| 提示没有故事 | 先执行 `interlude.doctor`；随后使用 `interlude.story.start`，或开启 `runtime.autoCreate`。 |
| 指令被角色当作聊天 | 将 `runtime.ignoreCommandMessages` 设置为 `true`。 |
| `interlude.advance` 没有消息 | 模型完成了剧本补写，但当前没有生成可投递消息。 |
| `interlude.compact` 没有整理内容 | 当前未压缩条目或字符数未达到 `memory.sceneEntryThreshold` / `sceneCharacterThreshold`。 |
| 日志中看不到正常运行信息 | 将 `logging.level` 设为 `info`，并将 `logging.verbosity` 设为 `standard`；排查时序或跳过原因时临时使用 `diagnostic`，完成后恢复。 |
