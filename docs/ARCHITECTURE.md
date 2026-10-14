# 当前架构

适用版本：`1.0.1-rc52`

当前文档已同步至 2026-10-15 的 rc52，累计变更以 rc50 发布包为基线。发布流程已执行源码构建，rc51 由本次生成的 `lib/` 与 `release/koishi-plugin-hds-interlude-1.0.1-rc52.tgz` 交付；旧安装包不会自动获得这些修改，运行实例须安装并重载后才生效。

历史增量（证据层）：事实/工作细节使用 knowledge 保存认知主体、证据角色与条件来源；contactThreads 给主叙事和时间导演提供同事项原始联系链。派生记录、主角相信的事与实际沟通结果分开解释，原文不裁写为第二份剧本。发送端将同一动作的完整分隔块映射至原有逐段回执链。详见 [实现报告](development/BETA6_EVIDENCE_DELIVERY_REPAIR.md)。

## 核心原则

HDS Interlude 1.0 以持续剧本为唯一叙事主链：原始剧本保存生活与人物理解，实际通信由同一行动的投递结果确认。`lifeHandoff` 以原文引用交接局部活动与在场人物，`SceneFrame` 是可重建导航，不是第二份当前真相。实时 continuitySnapshot 已停用；跨时间衔接仍由原始召回、scene/arc 后台整理、长期事实与未决意图承担。

用户消息是进入主角生活的真实外部事件。主模型在一个回合内补写从故事游标到现在已经发生的生活，并决定看见、沉默、立即回复、延迟回复或产生其它受限行动。自动推进围绕主角已在进行的生活展开。

## 模块职责

| 文件 | 当前职责 |
| --- | --- |
| `src/index.ts` | Koishi 插件入口、Console Schema、失明模式命令屏蔽、命令和消息中间件 |
| `src/service.ts` | 故事与参与者、串行队列、持久化、记忆、浏览器、Alter 和消息投递的编排层；回合/调度状态容器已部分拆出（见下两行），主要业务执行与协调仍在本文件 |
| `src/turn-engine.ts` | 私聊回合状态机：缓冲回合容器、narrating 互斥、请求取代（obsolete/discarded）与失效保留（在途回合由 endFlush 正常释放） |
| `src/scheduler.ts` | 调度状态机：每故事最早到期唤醒（keep-earliest + busy 重排）、独占任务去重门（halt/defer）与指纹冷却表 |
| `src/endpoints.ts` | 端点注册表（M1）：UUID 身份与地址分离、平台隔离 accountKey、入站反向解析、三维端点状态时效与剧本别名——单剧本多通道的身份层 |
| `src/qzone.ts` | QQ 空间通道（M1 增量）：限流门（按端点分桶）、动作封装（ambiguous 语义）、动态轮询过滤与 qzone-action 意图校验 |
| `src/alter.ts` | Alter 状态规范化、纯状态转移、动态阈值、权重和提示词投影 |
| `src/agency.ts` | 主体行动窗口、联系候选验证、容量矩阵、去重和重查时间 |
| `src/logging.ts` | 彩色分层日志、明暗主题、动作识别和字段布局 |
| `src/time.ts` | 时区校验、本地时间端点、日照时段和复用的 Intl formatter 缓存 |
| `src/schedule-preplan.ts` | Schedule Preplan 校验、周规律与例外合并、日期展开、半日投影和推进锚点 |
| `src/narrator.ts` | 模型请求与提示词编译：主叙事、压缩、导演、Embedding、视觉/音频和 Alter；按路由选择兼容/官方协议 |
| `src/script/scene-frame.ts` | 带 entry 来源的 SceneFrame 投影、DialogueBurst 身份与提交后即时视图更新 |
| `src/script/context-compiler.ts` | 七段式正向续写上下文编译；把旧资料层变成唯一剧本支架 |
| `src/script/contract.ts` | ScriptCommit、SceneDelta 与剧本事件内部协议 |
| `src/script/authored-actions.ts` | 正文 say 标记解析与 transport 引用；兼容旧 content 和提前流式发送 |
| `src/script/life-handoff.ts` | 本轮原文引用校验、局部状态交接及新旧时间证据分流 |
| `src/script/development.ts` | 独立场景计数、人物倾向查询、用户反馈与实际回应的证据链 |
| `src/turn-persistence.ts` / `src/delivery.ts` / `src/script/delivery-ledger.ts` | 剧本提交持久化、消息事件投递与按 segment 回写的 M6.1 结果账本 |
| `src/story-state.ts` | 版本化故事状态编解码和幂等升级 |
| `src/model-routing.ts` | 启动时一次解析所有模型任务路由 |
| `src/database.ts` | 21 张 HDSI 数据表及增量字段兼容（包含端点、长线指导和已迁入但未完整接入运行闭环的作品表） |
| `src/types.ts` | 当前跨模块数据协议 |
| `src/anthropic.ts` / `src/gemini-interactions.ts` | Anthropic Messages 与 Gemini Interactions 协议请求及流式适配 |
| `src/world-seeder.ts` / `src/long-arc.ts` | 世界事件播种与长线指导的校验、上下文与进展管理 |
| `src/group-willingness.ts` / `src/urge.ts` | 群聊本地意愿门和可选弹性推进；不是第二叙事发送链 |
| `src/forward-message.ts` | 合并转发结构读取、来源标注及预算控制 |
| `src/share-sync.ts` | 预设分享码预览、应用与同步 |
| `src/health.ts` / `src/desktop-bridge.ts` / `src/processing-context.ts` | 内存健康指标、可选桌面 bridge 与跨后台投递的 trace/processing 关联 |
| `src/meta.ts` | 构建与运行时共享的唯一版本常量 |

## 主叙事数据流

1. 私聊或群聊事件先写入 `interlude_script_entry`；启用 SnowLuma 语音转写时，私聊 `record` 先转为带来源标记的文本，并与当前文字、图片合并为同一个事件。
2. 同一关系分支的连续消息在短时间内合并；过期模型结果不会落库。
3. 服务从已有 scene、在场表、working details、Agency 与近期可见剧本确定性投影只读 `SceneFrame`；同一 scene 的消息共享 `DialogueBurst`，时间间隔和消息数量都不改变其身份。
4. 上下文编译器把事实组织为 `storyIdentity → relevantEstablishedEpisodes → currentSceneEvidence → ongoingThreads → availableNearFuture → incomingEvent → authoringWindow`。近期剧本原文仍然保留，当前消息只出现于 incomingEvent。
5. 需要导演的自动窗口先生成 1–4 个建议 beats；短且无结构边界的后续窗口直接续写。宿主仍拥有时间边界，主模型写出实际生活。新计划不自动晋升为历史；旧版自动条目继续保留 legacy ledger 的时间解释。
6. 主模型按兼容 JSON 返回一次结果；即时通信优先在正文内使用 say 标记并由 transport.actionId 引用。解析后原话进入原始正文与既有发送器，宿主提交带 frameId/burstId 的 `ScriptCommit`。lifeHandoff 只引用本轮原文，不要求模型再编写一份场景摘要。
7. 提交成功后，SceneDelta 只追加本轮事件和 prose；同一事件的气泡、贴图、原生表情与群反应登记为投递 segment，并在平台执行后回写 `pending | delivered | partial | failed | cancelled`。共享 SceneFrame 不保存私聊或群聊 prose 措辞，避免跨关系泄漏。
8. 后台扫描处理自动生活推进、到期意图、记忆压缩、Schedule Preplan 每日审查、Overlay 压缩、网页观察和旧事实向量补齐。

两种 payload 模式都使用同一个七段式上下文协议。`mainPayloadOrder=cache-first` 会把 recentScript 元数据投影为紧凑标签，并在 established episodes 内增加 `recentExchange`；其余事实与普通模式一致，追加式历史仍位于当前 SceneFrame 和当前事件之前。

`recentExchange` 仅投影真实收发消息和已投递动作，绝不复制 `script` prose。新自动剧本保留原文，历史计划以 proposedTimeline 明示；无实际发送行动的段落附带执行注解，不能仅凭“她发了一句”证明已发送。旧版账本投影保留兼容。两种 payload 顺序携带相同的这些证据。

群聊可选的 willingness 层位于群消息缓冲与主叙事之间：它只维护每个群的内存分数，以半衰减、边际递减、阈值概率和成功发言成本决定普通 `always` 群消息是否值得进入主模型。它不写数据库、不调用模型、不影响私聊、Alter 或 Agency；@ 机器人绕过该概率门。

Alter 达到阈值时，本轮只保存累计状态并安排后台分析。分析采用“锁内快照 → 锁外模型请求 → 锁内复查提交”三阶段：侧端网络请求不占故事串行队列，返回后复查运行代次、暂停状态及最新累计值，再合并落库，避免覆盖期间发生的变化。

## 连续性分层

| 层 | 作用 |
| --- | --- |
| Canon | 主角、世界、地点、配角、初始关系和风格的起点 |
| recentScript | 最近原始剧本和真实收发记录；保留语义、顺序和细节 |
| continuitySnapshot | 历史兼容数据，不再由主模型实时生成；有原始剧本时不投影 |
| lifeHandoff | 单次正文的地点/活动/在场/完成引用，按事件交接局部生活 |
| 长期事实 | 可检索的承诺、事件、世界与关系事实 |
| active consequence | 已发生事件的短期余波，不重写 Canon |
| Overlay | 达到证据门槛后的稳定演化 |
| Perspective | 独立于 Canon 的外壳人格层，保存主角个体价值观与看待世界的方式；相关剧情长期积累出的 overlay 优先于基础 Perspective |
| Alter System | 当前氛围的临时惯性；不替代以上任何一层 |
| Agency Window | 日程、隐私和设备构成的外部行动容量；只约束联系行动，不控制文风或情绪 |
| Schedule Preplan | 未来近期的计划结构；程序保存多日，主叙事只读取未来约半天，且不得把计划当成已发生事实 |
| 场景在场表 | 压缩时按来源条目确认的少量配角在场、离场或待会合状态；Canon 配角始终只是可用角色，不自动视为在场 |
| 自动投递摘要 | 仅后台自动回合读取的已完成沟通摘要，用于让下一次自动推进只表达新增进展 |
| 承诺回访 | 用户回合中说出口的“想想再答复”等未来承诺；复用 intent 表并要求可见履行、延期说明或取消说明 |

主动联系使用现有 intent 表形成闭环：生活剧本产生真实理由，Agency Window 判断立即联系、`proactive-check` 稍后重查或自然放下。重查时重新读取当前生活，不保存预写消息。关系身份会在后台以受控摘要提供，但原始私聊仍按共享开关隔离。

场景压缩可顺带更新最多八项在场状态，每项引用本次压缩中的真实剧本条目。自动投递摘要最多保留六项，并且只在 `advance` 与 `conversation-follow-up` 回合进入提示词。

承诺回访最多保留每位参与者两项待处理内容。它只在创建承诺的用户回合、用户后续消息和该承诺到期时进入提示词，携带事项、类型、时间和来源；普通自动推进不读取它。到期回合没有可见结果时，原 intent 会保留并延后，而不会静默完成；但只在硬截止和最多五次未结算顺延以内保留。超期/达到次数上限时退役调度任务，不伪造履行或可见取消消息。旧记录的截止固定取创建时间加 24 小时，未来 notBefore 也不能为已过期承诺续命。

Perspective 是独立于 Canon 的外壳人格层，基础文本与 overlay 分开保存。压缩模型只能按现有多回合、跨日期、证据与冷却门槛提出 `perspective` 状态变化；主模型只在当前事件确实相关时把它当作既定个人事实使用，不把它当成剧情主题或逐项审查清单。

## 共享剧本与隐私

当前采用单一 canonical 活动主剧本，可绑定多个角色端点；端点 UUID、平台账号和传输地址与参与者关系身份分离，旧剧本键可由别名重定向。用户身份可通过显式链接共享同一参与者记录，但每次行动仍须选择有效投递端点。默认不向当前私聊提供其它参与者的原始私聊；长期事实则是全局叙事证据，不按旧 participantId 字段隔离。事实正文负责明确相关人物，模型决定是否在当前关系中显露，不等于模型必然向所有用户复述。Alter 的侧端描述不得包含姓名、引用或私聊细节。

## 失明模式运行边界

`blindMode.enabled` 默认关闭。开启时，插件不注册 HDSI 管理指令，并在 Koishi 命令执行前静默截断当前实例中已识别的命令；普通聊天仍走原有叙事入口。HDSI 自身的运行日志、错误详情、剧本预览和模型侧调试会被收束为无内容的周期健康心跳，关闭开关并重载后恢复普通运维能力。旧 `blackBox` 配置仅保留兼容读取。

## 并发和持久化边界

单进程以故事队列串行化关键快照、提交和投递状态写入；不应理解为所有模型网络请求都持锁串行。私聊回合由 turn-engine 处理在途请求取代与提交边界；Alter 与自动后台压缩采用锁内准备、锁外请求、锁内复查；手动 `compactStory` 仍在故事队列中执行完整整理。SQLite 写入另有全局写队列。当前架构不提供多进程分布式锁；多实例部署必须增加外部锁和版本检查。

实验性流式首条回复只用于私聊：完整 `interaction.reply` 在 script 前抵达并校验后可先投递，随后才完成剧本持久化。首条成功投递会立即成为中断边界；若流式收尾失败，记录系统事件且禁止可见 failover，避免重复消息。

Schedule Preplan 使用独立的单行表，避免频繁故事状态写入覆盖日程。它与场景压缩共用模型；没有新证据且覆盖充足时由程序直接完成每日检查。

实时 recentScript 使用“条目数 + 时间窗口”并集。默认读取 35 条（可配置），同时保留最近 45 分钟内的真实收发消息；较长 narrator prose 仍受字符预算约束。Fact 检索为最近 resolved event 与 unresolved promise 分别保留固定通道，防止开放事项把刚完成的重要事件挤出上下文。


## 投递与调度边界（2026-10-10 工作区更新）

1. **剧本提交不是平台回执。** `script` 行先保存行动与 `deliveryActions` 账本；真正送达后才确认角色消息和相关承诺。`interlude_intent` 已消费不等于平台收到，顶层 participantId 为空时，消息目标从具体 scriptEvent/行动记录恢复。Agency 拦截的草稿不会被当成实际发言。
2. **后台写作等待已提交分段。** 查询所有 pending `split-message`，不能只看已到 notBefore 的分段。同一参与者的到期补写、主动重查和对话后续回合等待其链排空或被新入站取消；全局到期任务及普通/手动生活推进等待任意链。其它参与者的独立到期任务不被误拦截，网页/QQ 空间执行仍走原执行器。等待后重新唤醒、重新检查，不预写另一份待发文本。
3. **投递后刷新到期快照。** 最后一条气泡可同时结算旧承诺；随后重读待办，避免将投递前的旧任务快照再次交给模型。等待分段不增加 deferredChecks；承诺到期仍优先退役，最多五次未结算顺延，且显式改期不能超过硬截止。
4. **补偿与分段只有一个发送归属。** 启动延迟扫描、端点上线和周期扫描恢复源账本中的 pending 消息 segment，经原投递路径发送，不重跑主叙事，不整体重放剧本。存在 pending 分段意图时只安排原执行器；终态分段意图修复账本而不再发，分段执行器也先检查 delivered/cancelled 账本以跳过陈旧意图。扫描不自动重放 failed/cancelled 的原生平台动作；分段传输未确认时仍按其既有重查路径处理。
5. **在线证据与行动许可分开。** 识别 Koishi/Satori 数字 ONLINE 状态和兼容字符串；启动同步当前 bot，连接生命周期及入站继续刷新端点。在线不绕过端点启用、TTL/冷却、Agency 或渠道主动联系许可。
6. **唯一投递路径不是 exactly-once 保证。** “不自动重发”只适用于已确认/明确取消的 segment，不能用于描述当前所有 pending。此轮针对跨回合重复生成和分段/补偿竞争，并非跨任意时间的全文去重；平台已接受而回执/本地写入丢失时，仍存在投递不确定性。没有多进程锁或平台幂等键保证，真实 QQ/模型验收需另行执行。
