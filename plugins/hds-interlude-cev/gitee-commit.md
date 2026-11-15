release 1.0.1-beta6-rebuild：v2 内核全量更新——私聊可靠性、原生表情/音频、思考型网关适配与 Console 配置重组

自 0.1.4 以来的完整变更（详细历史见 docs/CHANGELOG.md）：

## v2 内核（1.0.0 beta1–beta16）

- 剧本中心架构：ScriptCommit 单链交接、`<say>` 行动引用、投递账本（delivery ledger）、原文主权（original-v2 标记）与 no-outgoing-action-recorded 事实边界。
- SceneFrame / lifeHandoff：地点、末端活动、局部在场表与转场交接；状态信封 v4 防滞后整理回写。
- 记忆导航：历史向量渐进补齐、带位置的原文跨度导航、到期/未解决事项查询；事实与工作细节接入 knowledge 证据链（观察/转述/想法/条件/确认）。
- Urge 弹性推进与 Agency 行动窗口上线；日程预排（Schedule Preplan）接入。
- QQ 原生表情入站语义识别（QFace 表 + 具名新增表，未知 ID 标注"名称未收录"）；原生小表情阈值语义校准。
- 分支批次 4：游标回滚（cursor-set）、redacted 墓碑过滤、purge 后游标回拨。

## 1.0.1-beta1~beta3-ostt：原生音频与时间导演轻量化

- 移除旧 STT 侧端语音识别：主模型支持音频时，语音经 OneBot get_record 服务端转码为 input_audio 原生输入，展示为"用户发送了一条语音"；Console 增加 model.audio 配置（与原生识图同构）。
- 时间导演轻量化修复：182 次调用 0 成功的根因（480 token 截断 + 提示词错位 + 重输入）修复；失败降级为无账本推进，不再冻结自动推进；账本只含客观时间事实与可能的时间逻辑，不做笃定的未来预测。

## 1.0.1-beta4-ostt：私聊回复可靠性、原生表情与音频文件

- 私聊协议中性化：示例改 `<true|false>`，明确"已读不回"（seen=true + mode=none）为普通合法状态；normalizeInteraction 解耦 seen 与 reply——跟进/到期回合的真实发送不再被无声抹掉。
- 私聊唯一 `<say>` 行动兜底：模型照抄示例 id 或省略引用时按唯一已授权行动解析；零行动/重复 id/伪造继承保持 none 防猜测语义。
- unreadMessageCount 以客观事实进入感知指引（到达记录，不是注意力或义务）；回复模式=none 时输出 interaction 诊断日志。
- 原生表情 face.id 改发数字（OneBot 11 规范 int32），严格校验的服务端不再拒绝（实测 `<face id="66"> is not a valid segment`）。
- QQ 音频文件（`<file>` 元素 + CDN 直链）进入原生音频通道：下载原始字节（体积/超时约束）→ 文件名扩展与魔数双保险嗅探格式 → input_audio。
- 附件标记卫生：入站剥离 `<file>` 等标记并以事实占位（音频文件/未知文件）；出站可见文本统一剥离附件类元素与 CQ 码——模型复述标记不再物化为真实附件发送（修复"bot 反向发送 qqdownloadftnv5 文件"）。

## 1.0.1-beta5-ostt：思考型网关适配

- 定位思考型网关（gemini-3.7 系）把 reasoning 计入 completion 预算的问题：带小 cap 的侧端 JSON 任务被推理挤到只剩残句（Alter 错误率 5%→31%，跳变点为更换模型日期，与插件和 Koishi 框架无关）。
- sideTaskJson 共享通道：压缩/时间导演/日程预排/Overlay/Alter 在首次输出不可解析时自动去掉 max_tokens 重试一次（成功路径零额外请求）；统一多文本字段宽容解析。

## 1.0.1-beta6-ostt：暂停死锁修复与群聊附件卫生

- 修复共享主剧本暂停死锁（用户实测反馈）：paused 故事此前对全部管理命令"隐身"——resume 永远报"没有故事"，story.start 撞主键领回暂停旧故事，永久闭环。现在 findStory 在 active 查不到时补查 paused（不采纳 archived），调度路径保持 active-only；story.start 对暂停故事给出明确引导。
- 群聊入站附件转事实占位（[图片]/[文件：名称]/[语音]），URL 污水不进群上下文。
- Alter 用量恢复聚合输出。

## 1.0.1-beta6-rebuild：Console 配置分组重组

- Console 配置页按【必填 → 结构 → 节奏 → 表达 → 内在 → 扩展 → 维护】重新分组编号：故事档案/模型中心/QQ 接入置顶，节奏类集中，弃用项移至末尾隐藏；修复旧编号 12/13 重复。
- 配置键名与存储不变，旧配置无缝兼容；配置文档全线同步重排（含时间导演小节与术语统一）。

## 工程验证

- 298 项回归测试、严格类型检查、esbuild 构建全部通过；发布包 1.0.1-beta6-rebuild 已在 Koishi 桌面实例实机验证加载。
