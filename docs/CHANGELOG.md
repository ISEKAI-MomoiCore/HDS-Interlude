## 1.0.1-rc51（2026-10-13，发布候选）

本节以 rc50 发布包为基线，合并其后的工作区修复（含下节"未发布：rc50 后续修复"全部内容）与本日两批新增修复：运行日志全量分析修复与 Agency 端点专项审查修复。保留持续叙事、单剧本单人格和事实全局可见原则，不改变既有业务架构。

**产物状态**：源码、包声明与构建产物统一为 `1.0.1-rc51`；按既有发布流程构建、验包并交付 `release/koishi-plugin-hds-interlude-1.0.1-rc51.tgz` 与 `release-local/` 安装包。旧 rc50 及更早安装包不会自动获得以下改动，运行实例需安装并重载。

### 运行稳定性（全日日志分析修复）

- **历史图片过期链接缓存**：QQ CDN 下载链接过期（HTTP 400，`retcode -5503007 "download url has expired"`）对该链接永久成立。首次确认后进入进程内有界缓存（FIFO，上限 1000），同源后续回源直接跳过：不再重复网络请求，也不再逐条刷屏（实测单日 3955 次同类失败）。首次过期记一条 info（"本进程内不再回源"），后续命中为 debug；群上下文的 `[图片]` 文本占位保持不变，视觉缺位不影响"发过图"的既成事实。
- **停机/重载（HMR）竞态**：新增 `isContextDisposedError` 双签名识别（`context disposed` 与 `cannot create effect on inactive context`）。主叙事、Alter 分析、侧端识图三个提供商重试循环遇停机签名立即中止整条链路：不重试、不进冷却、不轮换下一家。服务层新增 `disposed` 标志（`stop()` 置位）：停机期间不再调度持久化的叙事重试与流恢复意图（二者存于数据库，会在新实例上以 userInitiated 投递一条过期回复）；合并写作、群聊叙事、主叙事、图片回源、侧端识图等日志点在停机场景降级为 debug，健康分不再把停机记为提供商故障。
- **cev 构建修复**：`undici` 声明为 `optionalDependencies`（esbuild/dumble 要求被引用依赖在包声明中可解析），全工作区 `yakumo build` 不再因此失败。

### Agency 端点与主动联系可观测性（专项审查修复）

- **端点在线状态启动竞态**：门控判定 `endpoint-offline` 前按平台隔离账号键回查 `ctx.bots` 实况，命中即刷新内存状态并放行——适配器 `initialize()` 的 `getLogin()` 失败而 ws 仍在正常收发时，不再出现"重启后最长直到下一条入站消息"的拦截窗（10-11 实录：20:28-20:48 连续 10 次端点拦截，待投递补偿每轮 sweep 重试全部失败）。另在每轮 sweep 重同步全部 bot 连接状态，最坏恢复窗口压缩到一个 sweep 周期。回查只刷内存不落库，与"持久快照不恢复 online 真值"的既有语义一致。
- **解析层主动行动丢弃留痕**：advance 相位模型未输出 `proactiveContact` 时，裸 `crossConversationActions` 因 willingness 缺失/低于阈值或 delayed 时间越界被解析层丢弃的行动，现在显式携带原因（`droppedProactiveActions`）写入"从未发送"的 withdrawn 账本与历史条目，并输出一条 info——关闭"剧本已写她发出、实际从未进入投递管线"的幻影缝隙。目标不在白名单、群目标或空内容的丢弃维持既有静默行为；模型输出 `proactiveContact` 时仍由 Agency 决策边界全权判断（行为不变）。
- **冷却豁免用户回复**：出站失败的 5 分钟端点冷却不再拦截 `userInitiated` 回复（含 `allowed=false` 显式失败态）——一次网络抖动不再让该参与者最长 5 分钟已读不回。冷却的防轰炸语义完整保留给后台与主动重试路径；用户回复若真失败仍记录并延长冷却，每条用户消息至多尝试一次。
- **Agency 每日上限改为送达计数**：放行时预记 `proactiveContactLog` 携带 `ref`（UUID）并随消息草稿进入投递管线；投递终态失败按 `ref` 作废该条计数——被端点拦截或传输失败的主动联系不再消耗每日配额。`pending`（可恢复）失败不作废；归一化保留 `ref/voided`，重启不丢。

### 代码审查修复与功能增强（2026-10-15 批次）

**Urge 推进系统重构（乘法模型 + 五档生活节奏）**：
- `planUrge` 从线性插值改为乘法公式 `base / (densityFactor × rhythmFactor)`——对话密度与生活节奏两个独立因子相乘，hot 区间不再截断正常通道
- 新增五档生活节奏 `lifeRhythm`（phone-focused ×1.4 / available ×1.0 / occupied ×0.7 / resting ×0.5 / asleep ×0.15），由**压缩器**主写、**主叙事 urge 交接**可覆盖、**用户消息到达**即时提升（asleep/resting → phone-focused）
- `restWindows` 从"替换间隔"降级为"无节奏数据时的兜底倍率"（`restMultiplier` 默认 0.6）
- 半衰期默认从 45min 提高到 90min（对话后高密度持续期翻倍）
- 新配置：`compaction.sideTaskMaxTokens`（侧端 JSON 任务输出预算，默认 4096，0=不限）、`urge.advanced.activeMultiplier`（默认 1.4）、`urge.advanced.restMultiplier`（默认 0.6）
- 群聊意愿新增**回复后跳过抖动**：五档幅度表（eager 0-3 条 / normal 0-6 / quiet 1-9）× 节奏调制（phone-focused -1 / resting +2 / asleep +3），@ 直通不清零计数
- Alter 兜底 max_tokens 从 500 抬到 2000

**rc50 issue 报告九项修复**：
- 问题二（P0）：七处发送/OneBot 调用加 `withTransportTimeout`（30s 默认，超时→"结果未知"记 pending 交补偿幂等）；serial 看门狗（占用 >2min 告警带任务起点栈）
- 问题三：lite 档补表情包/聊天动作/引用回复三段说明（条件展开）
- 问题四：`requiresVisibleReplyRecovery` 携带动作字段时不判回复缺失（只发表情包不配文字合法）
- 问题五：`reconcileTransportReferences` 为 `localMedia`/`nativeFace`/`messageReactions` 补两层嵌套提权
- 问题六：`normalizeScriptField` 纯函数归一对象/entries/数组形态的 script 字段（decide() 返回链接，闸门前生效）
- 问题七：`repairBareQuotes` 裸引号修补候选（排在括号平衡扫描之前）
- 问题八：模型失败时保留原始输出快照（`safeJsonPreview`/截断原文）
- 问题九：`gxh.vip.qq.com` 加入信任域
- 问题十：off 档日志区分（`full(off→legacy 完整合约)`）；`sideSpecialty` 支持 standard

**issue #3（群聊隐私回声）修复**：
- `normalizeDecision` 层新增内容回声闸：群目标 cross-action 内容与 `interaction.reply` 重叠（完全一致/包含/bigram Jaccard > 0.55）时丢弃并留痕
- 最短长度守卫（≥6 字符才做包含判定，防止短回复误杀）
- `sendCrossGroupMessage` 无 scriptEvent 时打不可追溯警告

**issue #4（引号层级）修复**：
- `sanitizeAndClampVisibleContent` 加引号层级提升：成对中文弯单引号 `‘...’` → `“...”`（剧本外层 `“”` 剥掉后内层应升为第一层）

**世界播种器天气领地让渡**：
- 实况天气生效的故事，播种器让出天气领地（nature 切面换替身 + 硬排除规则 + weather-guard 校验闸）
- 架空世界/天气关闭保持模型即兴（它们没有别的天气来源）

**代码审查修复（moderate 级）**：
- `serial` 看门狗 token 改为任务实际开始时写入，且不被后续排队任务覆盖
- `withTransportTimeout` 用结构化标记替代子串匹配识别超时
- `isGroupEchoOfPrivateReply` 加最短长度守卫（≥6 字符才做包含判定）
- Urge `rhythmAttention` 只在本次交接显式提供时写入 `lifeRhythm`（防止档位永久"新鲜"导致 stale 永不触发）
- `weather.ts` 五处修复：`Number()` null→0 坐标错位 / 快照 TTL==sweep 周期导致刷新率减半 / weather_code undefined / 负地理编码缓存 / 注释全角冒号
- `interlude.reset` 补删 `preset-sync-state.json`（与 `database.clear` 一致）
- `normalizeLifeRhythmDraft` 接入 service 消费点（压缩器输出的五档节奏经校验后落库）
- 群发/贴纸/表情回应路径的 transport-timeout 待接入 pending 语义（当前仅私聊路径已修）

**天气功能测试**（15 项专项）：配置归一化/架空判定/WMO 码映射/手动经纬度/自动地理编码/编码失败回退/缓存/注入格式

### 打包后紧急更正（rc51 安装包构建形态）

- **事故**：首个 rc51 安装包误含 tsc 的 ESM 中间产物而非 esbuild CJS bundle——插件 tsconfig 被测试向自包含版本覆盖后丢失 `emitDeclarationOnly`，全量 `yakumo build` 的 esbuild 步骤因此跳过主插件，产物为无扩展名 ESM 导入的多文件 lib，Node/Koishi 任何 loader 加载即抛错（实测 `require('./lib/index.js')` 直接失败；Linux/Docker 用户报告的启动崩溃属实）。
- **修复**：恢复 tsconfig 继承工作区 `tsconfig.base.json`（emitDeclarationOnly），清理旧 lib 重建——`lib/index.js` 回到 21,749 行自包含 CJS bundle（rc50 同形态），require 冒烟通过；三端（GitHub/gitee 附件、桌面实例）已全部替换，新 SHA-256 `65f323546beb8abf92b230b80e3c1d7bad250d70cbed5a29fdc00dba554a17b2`。
- **防线**：`prepack`（ensure-fresh-bundle.mjs）新增 CJS 形态校验——`lib/index.js` 出现顶层 `import/export` 即拒绝打包（已做正反双向测试）；此前它只查 mtime 新鲜度，查不出形态回归。

### 打包前复核校正

- **运行时版本常量**：`HDS_INTERLUDE_VERSION` 与包版本对齐 rc51（此前启动日志仍报 rc50）。
- **世界播种器 Console 默认值**：Schema 默认与运行时常量对齐为 cadence 30 分钟 / pending 6 / 每日 8（此前 Schema 仍为 45/4/4，默认频率提升实际未生效；已有显式配置不受影响）。
- **发布向导 HTML** 更新为 rc51 文件名与安装包引用。
- **全量文档复核修正**：移除未实现的 SnowLuma 语音转写章节（当前仅 `model.audio` 原生音频路径）；群意愿 @ 直通补充睡眠态例外；配置指南补齐 weather【扩展 19】、model.specialization/specializationFamily、agency.contactMode 等字段及送达计数语义，构建说明改为工作区根 `yakumo build`；世界播种设计文档修正虚标项（piggyback 检查、preplan 豁免、`interlude.seeded` 命令与 wakeEligible 唤起均未实现；状态机含 `injecting`；去重为四维；宿主保证过期下限 2 小时）；Alter 文档补按来源分桶（pendingScopes）语义；架构文档 recentScript 表述改为"默认 35 条（可配置）∪ 45 分钟"。

### 验证与边界

- 全量回归 **837 项：833 通过、0 失败、4 项外部模型测试跳过**；严格 TypeScript 检查通过；本版新增 11 项回归（图片过期缓存跳过、停机重试守卫、停机签名识别、解析层丢弃留痕与账本、端点实况回查、冷却豁免、配额作废语义等）；发布一致性测试锚定版本常量、发布向导 HTML 与全部面向发布文档。
- 不保证 exactly-once（同 rc50）：平台缺少幂等支持时的崩溃窗口不变；本轮未执行真实 QQ 多天长稳验收。

## （已随 1.0.1-rc51 交付）未发布：rc50 后续修复（2026-10-11）

- **Console 群受理人配置**：新增 `onebot.groupChats[].assignee`，留空保留 Koishi 原生路由；显式填写启用的机器人白名单 QQ 后，启动/配置重载时按群同步 `channel.assignee`，兼容换号后仍绑定旧账号的频道。部分 upsert 保留忽略标记、权限和语言；不绕过 Koishi 的群/用户门控，配置错误或单群数据库失败不阻止其它群启动。
- **auto 意愿回退为空闲**：生活状态缺失、无效或过期时使用 `willingnessAuto.idle`（默认 active），不再硬编码 normal；调用评估和发言成本保持同档位，不写回虚构状态。成功调用与跳过日志统一显示无状态/无效/过期 → idle → 实际档位。

- **主剧本串行队列自锁（#IKKUP2）**：撤销未获准主动消息时，复用调用方已持有的故事串行域；仅队列外调用进入队列。不改变全局队列互斥、发送管线或账本终态规则，保留全部分段的 cancelled 记账和未发送审计，避免后续入站任务与 sweep 永久等待。
- **Agency 重查时钟**：保留叙事逻辑时间；去重读取后，按新鲜宿主时钟校正已到期的重查时间为一秒后。候选已过期或重查触及有效期则不创建任务；仍有效的未来时间保持原值，持久化、唤醒和日志使用同一时间。
- **Agency 默认关闭**：Console Schema 与运行时默认值统一为 false，保留显式 true/false，不改写用户配置；主动消息总开关仍独立生效。
- **主动消息正文绑定兼容修复（#IKKVIF）**：advance 即时 crossConversationActions 保留 content-only，不强制小模型输出 say/actionId；复用规范化后正文的唯一原文/分泡绑定，缺失或不唯一只取消该消息，保留剧本推进且不新增模型重试。在首次落库前重建 commit，不留下被取消消息的 pending 账本；现有显式引用取 say 原文、单 say 主动行动合成、普通回复及 delayed 调度保持原样。此为兼容取舍，不引入严格 ID 一对一协议，也不从普通引号自动推导发送。
- **QQ/OneBot 投递观测过期自锁**：在线且无失败冷却的 QQ/OneBot 端点，历史成功观测超过 24 小时后允许真实投递探测，不预写成功状态；成功沿既有路径刷新，失败沿既有路径进入五分钟冷却。桌面端点健康投影与实际门控共用该规则；离线、禁用、路由归属、白名单、Agency 与通道主动联系 token 校验保持，其它通道及未知平台不放宽。
- **回归覆盖**：新增真实串行队列的自动推进/到期重查撤销、外部调用互斥、终态保持和异常后续队列测试；覆盖模型/数据库延迟、过期边界、时钟回退及去重，补充默认配置兼容性测试。

本节原为本地源码修复记录（版本号暂保留 rc50）；上述修复已全部随 `1.0.1-rc51` 构建、打包并交付。已有死锁实例需安装 rc51 并重启/重载才能解除内存中的等待链。旧孤立 pending 账本的历史补发策略不在此次修复范围内，未引入无条件丢弃旧消息或超时强行解锁。

## 1.0.1-rc50（2026-10-11，发布候选）

本节以现存 `1.0.1-rc48` 候选包为基线，汇总其后的 issue 修复、长期记忆四项微调及全量源码审查修复。保留持续叙事、单剧本单人格和事实全局可见原则，不新增第二发送器或改变既有业务架构。此前两段“未发布”工作区记录合并至本节。

**产物状态**：源码、包声明与构建产物统一为 `1.0.1-rc50`；按既有发布流程构建、验包并生成 `release/koishi-plugin-hds-interlude-1.0.1-rc50.tgz`。旧 rc48 安装包不会自动获得以下改动，运行实例需安装并重载；详见 [发布验证报告](development/RELEASE_VERIFICATION_2026-10-11_RC50.md)。

### 端点在线状态、投递恢复与重复消息

- **端点在线状态**：识别 Satori/Koishi 数字枚举 `Status.ONLINE`，不再只依赖字符串 `active`；启动期同步可用 bot 的连接证据，避免传输在线却被 `endpoint-offline` 阻止，必须等待一次入站才恢复。
- **已提交 pending 消息补偿（#IKKAN3）**：从持久化剧本与 `metadata.deliveryActions` 恢复待投递动作，使用原事件中的参与者与投递目标，支持顶层 `participantId` 为空的自动推进剧本。启动、端点上线及周期扫描执行补偿，不重新调用主叙事；模型上下文区分已提交行动与实际投递结果。
- **分段气泡与补写互斥（#IKKNUC）**：检查所有 pending `split-message`，包含尚未到发送时间的气泡。同参与者到期任务/对话后续等待原分段链，全局到期及手动/自动生活推进等待任意链；其它参与者的独立到期任务及网页/QQ 空间执行不受此等待拦截。最后一段投递后刷新到期快照，避免补写另行生成同一句话。
- **僵尸承诺退役**：到期扫描和承诺检索清理已过期或达到五次未结算顺延上限的回访；旧数据缺少 `expiresAt` 时固定采用创建时间加 24 小时。重查不越过硬截止，分段等待不增加次数、不延长有效期；`cancelled` 只表示停止调度，不表示剧情已经履行或向用户告知取消。
- **统一发送与成功确认**：正常私聊、群回合跨私聊、分段、自动推进、pending 补偿及实验早发共享执行所有权与成功确认入口。分段恢复尊重原 owner；已完成/取消意图只对账，终态账本不再重发。群单段恢复及部分成功确认保留原分段索引，跨私聊成功也写入可见回执与账本。
- **已接受结果与持久化失败分离**：平台已接受的结果优先复用进程内记录或持久化成功回执对账，不把 ledger 写入失败当作未发送。暂停停止旧任务的新发送，但保留已经成功的平台回执；purge/reset 废弃旧内容世代，迟到确认不能复活已清理内容。分段意图更新仅操作 pending，尊重已取消/完成 owner。

### 全局事实与后台记忆整理

- **事实正文明确相关人物（#IKKET2）**：事实仍是全局叙事材料，不按旧 `participantId` 隔离；主叙事事实投影不再依赖该字段标注相关人。管理员命令、模型事实合约与示例要求在正文中明确人物，避免把一个参与者的事实误归给另一个；是否显露、如何表现仍由叙事模型决定。
- **后台整理读取本剧本原文**：不再把面向当前用户的私聊历史可见性过滤套到后台整理输入。整理读取本故事原始条目、身份与 metadata，排除 redacted 内容；前台用户历史可见性规则保持不变，未向其它用户开放原始私聊。
- **关系证据跨检查点衔接**：允许模型本轮实际收到的有限 `precedingEntries` 支持新投递回复的关系证据链，但必须包含本轮新证据、同一参与者的真实反馈与其后的已投递回应。旧上下文不算新的支持次数，不扩张事实或其它发展提案的证据范围。
- **轻量/完整整理合约与日志对齐**：两种提示词示例补齐事实/提案的 `sourceEntryIds`、合法发展路径与关系反馈要求；无合格证据时允许空数组，不强制形成事实或 Overlay。完成日志明确区分“模型提取数量”与实际写入，缺来源的事实/提案输出诊断原因，避免把模型产出误认为已落库。
- **整理提交完整性**：事实、发展提案、故事状态与场景检查点在现有数据库原生事务内提交；失败整批回滚，全部输出成功后才推进检查点，陈旧 frontier 拒绝重复应用。自动后台三阶段在 story serial 外准备向量，再随本轮事实落库；保留原向量失败降级，手动 compact 的串行范围不变。

### 模型路由、协议与日志

- **兼容端点 DeepSeek thinking（#IKKETD）**：`openai-compatible` 也可显式发送 `thinking.type=disabled|enabled`，不再只对 DeepSeek 官方模式生效；通用兼容端点默认 `inherit`，避免无配置时向其它服务商强塞扩展字段。官方模式既有默认保持，配置文案和测试同步。
- **模型分配与维护路由**：显式分配的主任务统一执行冷却、轮转和音频能力过滤；事实向量补齐正确识别已解析路由，维护向量时不刷新事实时间，避免干扰事实新近性排序。
- **流式与代理**：OpenAI/Zhipu SSE 正确处理 DONE、EOF 和残留帧；三种流式协议及 embedding 请求遵循显式代理，direct 路径保持原语义，并加入本地 CONNECT 回归。
- **历史图片失败日志分层**：区分历史图片回源失败、素材不可用与主叙事服务请求失败；单张历史图失败不再一律以同级警告反复输出，保留诊断来源与失败原因。此项不把上游 bad request 判定为模型不具备视觉能力。

### 调度、容器与等价性能优化

- **入站去重**：私聊与群聊在成功落库后才登记去重，串行区内复核持久化证据；新条目记录 bot selfId，避免 canonical 共享故事中跨账号消息 ID 冲突。
- **任务与并发容器**：修复作品任务裁剪后的旧数组引用、wake busy 状态复活/覆盖以及 browser 并发槽交接超额，不改变原功能及容量配置。
- **历史图片回源**：最多三路并发，仍按原始顺序选择前若干张成功图；不新增可能跳过有效尾部图片的隐式尝试上限或总 deadline。全失败时仍遍历全部唯一来源，不承诺整体耗时上限。
- **恢复与历史导航**：script 按 ID 分页扫描，一轮处理有界恢复候选并复用 split owners，仍覆盖旧 pending；复用可见历史导航，非重叠 checkpoint 使用二分，重叠时保留原 first-match 语义；补齐向量后使旧召回 memo 失效。不截断原全历史恢复/召回范围。
- **群上下文与冷却**：数据库先按目标群和条目类型筛选，再截取窗口，避免其它私聊/群记录挤掉当前群历史与最近发言。

### 文档、验证与保留边界

- 同步当前版本、安装示例、配置/命令说明和架构索引，新增对应 rc50 的部署向导并同步本次安装包交付状态；明确已提交/已投递、场景记忆/全局事实、调度退役/剧情履行的区别，以及 Alter 三阶段、canonical 多端点与停用实时 continuitySnapshot 的现状。旧发布向导、rc48 审查基线与历史验收报告保持原版本记录。
- **发行包范围校正**：将根文档限定为根路径，运行声明与开发文档显式递归收录，修正 Yarn 4 `files` 匹配带入归档文件、漏收开发报告的问题，并补齐文档索引引用的 V2 对照文档；业务功能不变。
- 全量源码回归 **758 项：754 通过、0 失败、4 项外部模型测试跳过**；严格 TypeScript 检查通过。真实 SQLite 回滚、群查询与本地 CONNECT 代理已有专项验证，逐项修复与交互覆盖见 [全量审查修复报告](development/FULL_CODE_REVIEW_FIXES_2026-10-11_RC48.md)。
- **不保证 exactly-once**：平台缺少幂等支持时，成功回执落库前崩溃或未知回执仍有不可消除的边界。本轮未执行真实 QQ 多天长稳、真实进程 kill/restart 或全部数据库后端验收；自动化全绿不代表已完成部署或线上验收。

## 1.0.1-rc48（2026-10-08，发布候选）

- **分享码同步 storyDefaults 模板写入（用户实测定位：同步成功但清库后人设回退）**：此前同步对 storyDefaults 只"应用到当前故事实例"，从不更新插件配置里的档案模板——`interlude.database.clear` 后重建故事、或任何新开故事，孵化来源仍是 Console 旧模板，同步成果活不过一次清库（用户实测时间线：16:47 同步成功 → clear → 16:53 重建故事用的是旧"Minase HDSI"模板）。修复：自动/手动同步与 `interlude.preset.apply` 在预设含 storyDefaults 时，同时把模板整段写入插件配置（Console 可见、清库重建与新故事的孵化来源、进入回滚快照）；`applyToCurrentStory` 仍控制是否立即打到当前故事。预览/确认文案同步更新。
- **手动 `interlude.preset.sync` 强制重新应用**：此前手动 sync 与自动路径共用 revision 幂等闸——远端 revision 未变时"跳过"，清库重建/配置漂移后**没有任何恢复手段**（只能手工删状态文件）。修复：手动触发始终强制重新应用（revision 未变也会重写配置模板与故事设定）；自动路径保留 revision 幂等闸（省流量防抖）。
- **`interlude.database.clear` 重置分享码同步状态**：清库删除故事却保留"已同步 revision N"的状态文件，下次自动同步必然跳过，重建故事只能孵化自旧模板。修复：清库同时删除 `preset-sync-state.json`，下次启动/手动 sync 重新拉取并应用预设。
- **runAutoSync 手动路径解除 autoUpdate 依赖**：手动 sync 此前还要求 autoUpdate 开启（文档未载明的隐藏条件），现仅要求启用+分享码；自动路径仍要求三项齐全。

---

## 1.0.1-rc36（2026-10-04，发布候选）

- **小模型换行分句开关**：新增 `runtime.convertNewlineToSeparator`（默认关闭）——模型没有按合约输出 `<sep/>` 而是用换行分条时，把换行运行自动视作气泡边界再发送；内容已含显式分隔符时不转换，拆条关闭时无效。Gemma 等小模型建议开启。
- **小模型上下文三件套**：`contextEntryLimit` + `contextTimeWindowMinutes` + `convertNewlineToSeparator` 配合收缩上下文与气泡形态。

## 1.0.1-rc35（2026-10-04，发布候选）

- **剧本历史条目旋钮修复**：移除 `recentEntriesForPrompt` 内 `Math.max(35, …)` 硬地板（M4.1 连续性加固引入）——此前 `contextEntryLimit` 低于 35 的设置静默失效，小模型无法收缩历史上下文。默认 35 保留在 Console 默认值；预算判定抽为 `resolveScriptContextBudget` 纯函数并补测试。
- 字段说明重写：写明条数与时间窗的叠加语义（窗口内条目全部并入，收缩需两者配合）。

## 1.0.1-rc34（2026-10-04，发布候选）

- **权限拒绝可诊断**：`canManageSession` 的两层失败（OneBot 互动白名单拒绝 / `managerAccounts` 不匹配）此前共用一句"需要 HDSI 管理员权限"，新部署排障方向被误导。新增 `manageSessionDenialReason` 纯函数区分两层并生成含指引的原因文本；`interlude.story.start` 拒绝回复附带真实原因；`interlude.doctor` 增加管理权限检查项；拒绝日志升 standard 级。非 OneBot 环境（Console 沙盒）账号不匹配时提示环境差异。新增权限门测试七项。

## 1.0.1-rc33（2026-10-03，发布候选）

- 汇总 rc32 之后的发行前修复：长线后台任务异常吸收、日志留存接线与进程崩溃诊断、worker 异常退出状态持久化、投递幂等与桥接 ambiguous 语义、Qzone 增量提交、贴纸与原生表情宿主代理，以及 OneBot 多通道账号标识校验。
- 桌面端同步支持 QQ 数字账号、微信字符串账号和其它 OneBot 账号 ID；旧 QQ 配置字段继续兼容读取。
- 发布验证目标：Yarn 4 构建、类型检查、全量插件测试、桌面端运行时和 UI 测试均通过后生成 rc33 包。
## Narrative Attractor 实现修正（2026-10-02）

- 修复长线指导调用缺失：补齐 `NarrativeCompactor.planLongArcGuidance()` 和 OpenAI-compatible JSON side-task，达到阈值后不再静默跳过生成。
- 新增 `interlude_long_arc_progress` 持久化累计状态表，保存 `lastCountedEntryId`、私聊/群聊分项分数、累计总分和 `lastGenerationScore`，避免首次生成前重复计分及进程重启后复审基线丢失。
- 保持 Guidance 版本的 `triggerEntryId` 不可变；累计扫描游标不再写回历史 Guidance 行。
- 增加后台生成去重、过期投影保护，并修正复审基线表达式。
- 长线模型输入补充用户/关系设定、当前 participant（遵循 `shareParticipantDetails`）、持久事实、active Guidance 和私聊/群聊分项累计。
- 修复 `script` 渲染条目的通道误判：优先读取 `scriptEvents`，群聊仅按 `0.5` 计权，混合私聊/群聊回合保守计为 unknown；新提交同时写入 `metadata.conversationKind`。
- 固定有效计权契约：私聊始终 `1.0`、群聊始终 `0.5`；旧配置键继续读取但不再改变实际权重。
- 增加后台模型隐私边界：`shareParticipantDetails=false` 时仅允许当前故事主参与者与全局剧本/事实进入长线模型，排除其它参与者的带 `participantId` 内容；计分仍正常累计。
- 修复 Guidance 注入仅依赖 endpoint selection、跨故事缓存未加载、过期版本阻塞后续生成等问题。
- Yarn 4 验证：typecheck 通过；全量测试 524 项，520 通过，0 失败，4 跳过。

# 版本记录

## 1.0.1-rc32（2026-10-02，发布候选）

- **长线叙事催化器首次阈值调整**：Narrative Attractor 的默认首次加权证据阈值由 `50` 调整为 `25`；私聊按 `1.0` 计入、群聊按 `0.5` 计入的渠道策略保持不变。
- **催化器实现保持稳定**：继续采用 `dormant / prime / activate` 生命周期，允许在首次表达前为主叙事提供一次最小、可撤回的戏剧性行动许可。
- **发布验证**：完成 Yarn 4 严格类型检查、全量测试、Yakumo build 与 Yarn 4 tgz 打包；真实 Koishi Desktop 运行环境验收仍由维护者执行。

## 1.0.1-rc31（2026-10-02，发布候选）

- **群聊历史图片证据回流**：群聊图片引用写入 `interlude_script_entry.metadata.groupImageRefs`，不再只保留 `[图片]` 占位符；在 mention-only 模式下，未 @ 机器人的图片会落库但不会单独触发主叙事。
- **主叙事附件选择**：下一次真实进入群聊主叙事时，从同一群聊的历史条目中按新到旧扫描，默认恢复最近 3 张、最多 6 张图片；当前回合图片与历史图片去重，历史图片使用低细节提示，加载失败不阻塞本回合。
- **模型边界**：历史图片作为视觉证据而非当前指令发送；持久化层只保存 URL / OneBot file 引用，不保存 data URI。私聊图片行为保持不变。
- **配置**：新增群聊 `historicalImageLimit`（默认 `3`，范围 `0–6`），设为 `0` 可关闭历史图片回流。
- **发布流程**：使用 Yarn 4.5.3 完成类型检查、测试、Yakumo 构建、打包与实例安装；真实运行环境验收仍由维护者最后执行。


## 长线叙事指导 Narrative Attractor Phase 0-3（2026-10-02）

设计文档 LONG_HORIZON_NARRATIVE_GUIDANCE_DESIGN.md 的实现落地：

- **Phase 0+1 纯函数层**（src/long-arc.ts）：isEligibleNarrativeEntry（叙事 kind 白名单 + 空内容排除）、resolveConversationKind（metadata > M4 通道标注 > kind 反推 > unknown）、resolveConversationWeight（私聊 1.0 / 群聊 0.5）、calculateLongHorizonScore（§4.2 公式）、shouldTriggerLongHorizon（首次/复审/暂停重建/未达阈值四态）、normalizeLongArcGuidance（结构化校验——缺证据/无 stages 拒绝；非 subtle 钳制）。7 项纯函数测试。
- **Phase 2 持久化与异步生成**：interlude_long_arc_guidance 表（版本链）；longHorizonSweep 挂 persistDecision 返回路径（异步、不阻塞）；longHorizonGenerate → compactor planLongArcGuidance → 校验 → supersede + 写入新版本；active 内存缓存。
- **Phase 3 主叙事注入**：NarrativeRequest.longHorizonGuidance 字段 + longHorizonPromptProjection()（§7 裁剪格式，~300 token 硬上限）+ systemPrompt 注入（CHANNELS 行之前）。每回合最多一个小信号、用户意图优先、不得提及指导存在。
- **配置**：Console【扩展 16】longHorizon（enabled 默认关闭、triggerScore=50、reviewIncrement=40、intensity=subtle）。关闭时行为完全不变。
- 测试基线：518 通过、0 失败。

## 1.0.1-rc30（2026-10-02，发布候选）

- **修复 OneBot 后续私聊投递**：无 live Session 的延迟/分段消息不再把裸用户 ID 传给 `bot.sendMessage()` 或 typ-0 宿主投递接口；OneBot 私聊目标统一规范化为 `private:<userId>`，避免被错误解释为 `send_group_msg`。
- **发布流程**：本版本使用 Yarn 4 打包并安装，避免 npm lockfile 与 Koishi Desktop 实例的 Yarn lockfile 不一致。
- **验收边界**：本批仍跳过真实运行环境验收，待维护者最后执行。

## 1.0.1-rc29（2026-10-02，发布候选）

rc28 以来的发布候选整理，包含 QZone 评论感知、Schedule Preplan 当天例外、表情包 HTTP 回源、EndpointState/Delivery Gate 以及多端点链路代码修复。

- **发布卫生**：重新执行 Yakumo 构建；`src/` → `lib/` 新鲜度检查通过；严格类型检查通过；全量测试 `514` 项中 `510` 通过、`0` 失败、`4` 跳过；npm tgz dry-run 通过。
- **多渠道 M3**：EndpointState 持久化快照、重启时不恢复旧在线事实、统一投递门控、主动联系门控、失败分类和 `endpoint-health` desktop bridge 投影已接入。
- **多渠道 M4 代码修复**：即时私聊/群聊默认 endpoint 在 gate 前观察 live session；分段消息恢复显式 `endpointId`；显式 endpoint 继续禁止 fallback。
- **文档与发行包**：`INDIRECT_SUBJECT_DESIGN.md`、`OFFLINE_ATTENTION_EXPERIMENT.md` 与 `docs/development` 已纳入发行包；工作区包与历史 rc28 正式包分离。
- **验收边界**：真实双 QQ、多端点切换、断线重连和平台拒绝等运行环境验收不在本次自动步骤内，待维护者最后执行；SharedWorks/共同创作仍保持实验性、暂不纳入稳定承诺。

## Schedule Preplan 当天例外及时收束（2026-10-02，已纳入 1.0.1-rc29）

backlog 2026-09-07 挂账项。数据层例外机制 rc12 已就绪（登记/按日过期/物化），本批补齐两个缺口：

- **及时性**：日审查为每日一次门——早审完成后下午临时改约要等次日才登记，而例外属于"今天"。新增确定性触发扫描（取消/改期/改约/敲定等语言痕迹，`kind=script` 证据管道天然排除世界事件/好友动态/空间条目，无新增量冲突）+ 带外跟进审查（冷却 ≥2h + 未读含信号才放行；无信号零模型调用，低频承诺保持）。
- **防吸收与证据资格（审查教学三行）**：取消/改期/新确认的一次性安排归 exceptions 且只归 exceptions；周规律只有"新时间在不同日期重复出现或明确声明永久"才可改——同一事件不会变成长期作息；愿望/建议/未执行计划不算任何例外或规律的证据。
- 测试 +3（触发词命中/愿望不命中/去重；跟进到期五态；教学断言）；全量 509 通过、0 失败、4 跳过。

## QQ 空间被评论感知（2026-10-02，已纳入 1.0.1-rc29）

- 用户需求：她的说说收到新评论时，信息由**下一次推进（自动或对话）自然携带**，被评论本身不触发 advance。
- 实现：`qzoneReactionDeltas` 纯函数（首次观测立基线不报/增量>0 产出/删评回落静默下修/超出拉取深度不动）+ 动态轮询附带自空间 `get_qzone_msg_list` 比对 + `[空间动态]` 条目入账（复用 SOCIAL SURFACE 提示词规则，零提示词改动，`friend-feed`/system ownership）+ `interlude_qzone_post.commentNum` 基线列（老库自动补列）。
- 边界：感知零动作配额（与 feed-seen 同族）；只覆盖 7 天内已确认帖子、单轮至多 3 条；feeds CGI 间歇失败不再中断整个轮询（跳过好友动态、感知照常）。赞数上游未暴露（SnowLuma 仅映射 cmtnum），结构已预留。
- 测试 +1（基线/增量/回落/缺席四态）；全量 506 通过、0 失败、4 跳过。

## 本地表情包发送修复（2026-09-30，已纳入 1.0.1-rc29）

用户反馈：表情包发不出去（retcode 1200/100），路径与文件名正常。三处修复：

- **投递形态改为 HTTP 回源**：原以 `file:///` 本地路径交给 OneBot 实现——Koishi 与 NapCat/Lagrange 分容器/分进程部署时（用户实测 `/root/hds-koishi/...` 与 docker 卷 `/koishi/...` 两种部署均复现），file URI 指向 Koishi 侧文件系统，OneBot 实现读不到，上传必然失败。现由 Koishi 自身 HTTP 服务提供回源路由 `/hds-interlude/sticker/<素材ID>`（仅素材库内、资产表登记且 active 的文件，86400s 缓存头），OneBot 实现按 URL 主动下载。基址推导：`stickers.deliveryBaseUrl` > Koishi `selfUrl` > `http://127.0.0.1:5140`；跨机/跨容器部署在配置中显式指定。不内联 base64，消息载荷保持轻量。
- **assetId 折叠碰撞**：`stableStickerAssetId` 把中文路径折叠为 `-`，stem 常退化为 `sticker`——两个分组存同一张图即同 assetId，扫描每轮在 UNIQUE 约束上崩掉（用户日志"表情包库扫描失败"8 连复现，当轮描述/嵌入全部停摆）。后缀改为 sha1(路径+内容) 联合哈希，路径差异必然分叉；旧库行由下一轮扫描按 filePath 平滑迁移。
- **历史重复行自愈**：扫描开始按 (assetId, filePath) 去重（保留 updatedAt 最新），旧缺陷留下的重复行不再每轮致崩。
- 测试 +2（中文同内容不碰撞/确定性/内容换 id；投递 URL 归一/编码/回退），更新 1 处旧后缀推导断言。

- **新设计文档**：`docs/OFFLINE_ATTENTION_EXPERIMENT.md`——离线注意力实验（"想不想聊"由模型申报 attentionAfter：closed→仅响铃 / dnd→勿扰；宿主执行"看不见"：消息分流入台账、锁屏摘要不泄内容、phoneCheck 两步回放回合、轰炸唤醒；无任何时刻表判定，回归三路 = 出站蕴含/自然注意到/轰炸）。仅设计，未实现；AG-M0~M3 分期。

## 1.0.1-rc28（2026-09-30）

rc27 以来增量：单剧本多通道 M2/M3/M4 全量落地 + DeepSeek V4.1 修复 + 世界事件架构修订 + 文档补全。

- **多通道 M2/M3/M4**：回合来源端点追踪（`sources`/`activeSources`，flush 转移）；用户端点链接命令（`interlude.participant.link/unlink/endpoints`）；显式端点投递（`ConversationActionDraft.endpointId`，私聊按参与者所有权校验、群按 story-role/group 所有权校验，平台精确匹配 bot）；确定性通道标注五规则（`projectChannelContext` + `NarrativeChannelData`，群聊批缓冲回退）；CHANNELS 作者视角规则 + CHANNEL CONTEXT 宿主元数据规则；多平台端点选择教学（opt-in：注册端点覆盖 ≥2 平台才注入，`availableOutgoingEndpoints` 随载荷投影）。链路修复：来源先建回合后写入、lastEntryChannel 区分有无新入站批、群消息指定端点所有权校验与显式失败、batch-multi-endpoint 独立语义。
- **DeepSeek V4.1 回复模式 none**：归一化 seen 宽容（漏 seen 不再丢弃整条有效回复、不再误触重写环）；DeepSeek 家族专属 TRANSPORT IS PER-TURN 行（interaction 每回合必需、历史条目不是模板）。standard/full/lite 其余家族提示词字节不变。
- **世界事件复读架构修订**：反馈环切断（播种器生活摘录排除自身 world-event 产出）；通用世界切面确定性轮换（六方面，任意世界观适用，禁止现实建制移植）；去重视野纳入排期中事件；单轮至多一事件。Jaccard 安全网与提示词规则原样。
- **文档补全**：command.md 补 `interlude.story.endpoint`（账号迁移唯一显式途径）与 `interlude.reset`；CONFIGURATION_GUIDE 新增 §17 世界播种器与 §18 QQ 空间通道两节。
- 测试基线：503 项（499 通过 / 0 失败 / 4 环境跳过）；tsc 零错误。

## 世界事件复读架构修复（2026-09-30）

- 用户反馈：世界事件重复率高（同一"宿管贴国庆通知"换皮 4 连）。按"架构层解决、不做下游外部限定"处置：
- **反馈环切断**：播种器的生活摘录排除自己已注入的 world-event 条目——灵感来源回归她本人的生活，自身产出只留在 recentlySeededEvents 记忆清单，自馈坍缩从结构上不可能。
- **切面轮换**：六个**通用切面**（天象与环境/居所与近邻/生计与日常事务/亲近之人/途中与陌生人/小意外与际遇）——切面是世界的一个方面而非题材，具体面貌由各剧本 worldSetting 渲染并明令禁止现实建制移植，异世界/古代世界观同等适用；按 (剧本哈希+时间槽) 确定性轮换，相邻两轮必不同、一周期全覆盖、跨剧本相位错开；单轮至多一事件。零新增持久状态。
- **记忆完整性**：去重视野并入排期中事件（此前事件到点前模型拿到空清单——这正是 45 分钟 4 连的直接通道）。
- Jaccard 0.6 安全网与提示词规则原样保留。测试 +2（轮换确定性/周期覆盖/跨剧本相位 + 切面提问形态）；全量 503 通过、0 失败、4 跳过。


## DeepSeek V4.1 回复模式 none 修复（2026-09-30）

- 用户反馈（beta6-rebuild + deepseek-chat V4.1）：首轮回复正常，后续轮"剧本里写了回复但回复模式 none / 结构化回复缺失"。按"仅 DeepSeek 出问题、不给弱注意力模型通用加料"的原则收窄修复——
- **宿主侧（非破坏式，零提示词成本）**：`normalizeInteraction` 原先在 `seen` 非布尔时丢弃整个 interaction——V4.1 偶发漏 seen 时，有效 immediate 回复被打成 none，且恰好落进 requiresVisibleReplyRecovery 重写环（模型稳定复现同形态、重写无效）。现 reply 对象有效时 seen 缺省按已读处理，不再丢弃也不再触发无谓重写。
- **DeepSeek 家族专属行**（familyOverrides.extraAfterPhase，仅 deepseek 家族注入）：`TRANSPORT IS PER-TURN`——interaction 每个活跃回合必需；recentScript 历史回复是纯剧本文本、无传输对象形态，是历史不是模板，禁止照抄或因此视字段可选；`interaction.seen` 为必需布尔。针对缓存命中率高企后纪律随尾段漂移、历史条目形态污染的实测行为。GLM/Kimi/Gemini 等 standard 家族与 full/lite 档提示词字节不变（测试钉死）。
- 测试：normalize 漏 seen 三例 + deepseek 注入/GLM 不注入/full 原样/lite 不变四档断言；全量 501 通过、0 失败、4 跳过。


## M4 链路修复（2026-09-29）

- 修复首条入站消息的回合来源丢失：先创建 TurnEngine 回合再写入 `sources`，首轮通道上下文现在与后续消息一致。
- 修复通道上下文的“上一条”取值：当前入站条目不再被误当作历史上一条；来源端点集在命中其他通道规则时也会保留。
- 增加 `channelData` 的类型化 narrator 载荷，并补齐群聊端点回退、同批多端点标记和回复目标端点信息。
- 重写 `CHANNELS` 提示为作者视角，明确 `incomingEvent.channelContext` 是宿主事实元数据，不是对话指令或新事件。
- 修复显式 `ConversationActionDraft.endpointId` 在归一化和投递阶段被丢弃的问题，并限制私聊端点只能属于目标参与者；原生平台端点按平台精确匹配。
- 增加多平台模式探测：仅当当前故事的合法目标端点同时覆盖 QQ 与微信时，才向 narrator 暴露 `availableOutgoingEndpoints` 并启用 `endpointId` 选择契约；单平台（包括同平台多账号）继续使用原有轻量协议。
- 修复根目录运行端点测试时的相对路径错误；新增首条来源回归测试。插件全量测试：490 通过、0 失败、4 跳过。

## M4 叙事增强（2026-09-29）

- **确定性标注五规则（V3 §十）**：`projectChannelContext()` 纯函数——回合内端点切换（turn.sources>1）/同批多端点/私↔群切换/同人异端连续/回复目标≠来源，命中即注入 `channelContext`（简短标记 `[微信·私]` + 规则列表 + 来源端点集），service 侧从回合 sources + 条目 metadata.channel 提取、经 payload `_channel*` 字段透传到编译器。投递不依赖标注，漏标后果限质感层面。
- **CHANNELS 常设规则行**：narrator 提示词新增——"同时生活在 QQ 和微信；同一朋友两个平台是同一个人；标记告诉你在哪发生的就在哪回；主动换渠道需要自然动机；不同平台不发重复内容"。

## 仓库统一（2026-09-29）

- **cev 独有功能并入主仓**：`src/works.ts`（SharedWorks 共同作品——252 行纯模块，不可变版本树 + CAS 并发控制 + 独立写手接口）与 `src/specialization.ts`（模型特化——150 行，lite/standard/full 三档合约块 + 家族偏移）已复制到主仓；`interlude_work` 表已注册；4 个纯模块测试 + 6 个 SharedWorks 行为测试全部通过。**narrator/service 的 SharedWorks 集成接线留后续版本**（需要合并 cev 的 narrator 变更到主仓已演化的 narrator，涉及 generateWork 独立写手、内联写作模式等）。模型特化块的 narrator 注入同样待接线。
- **自本版起主仓为唯一操作目标**：cev 仓转为只读存档，不再接收新功能；桌面壳以 typ0-cev 的 UI_DESIGN_SPEC_V2 实现为标准。

## 工作区（未发布；2026-09-29，M2+M3）

- **M3 出站与主动（v3 §八）**：`OutgoingMessageDraft` / `ConversationActionDraft` 增加 `endpointId?`（省略 = 本回合来源端点）；出站投递显式端点优先（精确匹配该端点 bot，失败回落默认路径不硬断）；主动联系渠道选择——`resolveMostActiveEndpointId()`（最近活跃端点解析：EndpointState.connection.observedAt 最新，无在线取首个启用端点保守尝试）；`proactiveContactLog` 每条记录 `endpointId`（渠道选择审计）。`appendProactiveContact` 签名扩展第 4 参 endpointId，normalizer 透传新字段。

## 工作区（未发布；2026-09-29，M2 机制构建）

- **单剧本多通道 M2（机制构建，零微信依赖）**：用户端点链接——`interlude.participant.link/unlink/endpoints` 命令族，把"同一个人的另一个号"链入既有参与者（participant-user 端点行，一人格一处约束，审计条目）；`sameParticipantEndpoint` 从单点比对升级为**端点集合匹配**（注册表优先，冷表回落旧字段——单平台等价）；回合 sources 语义——`BufferedNarrativeTurn` 增加 `sources: [{endpointId, receivedSeq}]`，入站记录来源端点与接收序号（同回合第二端点追加而非新回合，v3 §七"合并"决策），`recordSource` 幂等且按序号排序；`channelKindForAccount()` 判别函数（onebots 别名路线的唯一通道判别，未注册默认 qq）。测试：12/12 endpoints 专项 + 全量 466 绿。

## 1.0.1-rc27：QQ 空间说说通道、单剧本多通道 M1 与三轮审计修复（2026-09-29）

- **单剧本多通道 M1a（兼容解析层）**：新增 `src/endpoints.ts`（UUID 身份/地址分离、唯一键约束、入站反向解析 accountKey→端点→故事、三维端点状态时效——过期即保守/重启归零）与 `interlude_endpoint` 注册表（双路径建表）；幂等迁移（active 故事/参与者/启用群规则 → 派生端点行）；私聊与群聊入站条目附规范化 `metadata.channel`（注册表未命中不标注）；端点状态随入站刷新；`repairCanonicalOneBotStoryTransport` 改造为注册表优先+投影同步（单角色端点保持漂移自愈，多端点下不再改写故事主身份）。单平台零影响纪律：未命中一律回落旧路径，投递/回合/查找路径未动，迁移只增不改。规格见 [MULTI_CHANNEL_SINGLE_STORY_DESIGN.md](MULTI_CHANNEL_SINGLE_STORY_DESIGN.md) v3。
- **M1a 收尾（八条出站路径接入）**：`endpointAddressSync` 同步解析器（注册表命中以注册表为准、旧字段漂移只告警一次、冷注册表/未命中回落旧字段）接入四个收口点——`findBotForParticipant`（即时/延迟/主动/分段私聊投递的唯一 bot 收口）、`sendGroupMessage` 兜底分支（实时群会话仍最优先）、`canHandleStory` 白名单判定、`qzoneExecute` 账号选择；出站成功/失败回写端点 deliverable 状态（私聊/群两条链）；`startBackgroundTasks` 预热注册表使同步解析器在首入站前可用。桌面 bridge 出站经同一收口、群成员名查询按实时会话账号——两者由构造保证等价。收口等价性测试锚定（一致=同 bot、冷=旧路径、漂移=注册表优先且告警一次）。
- **M1 安全审计修复二批（10 项，2026-09-29 三轮审计）**：**P1**——端点/别名全部写入改为**先落库后进内存**（失败不产生"进程内有、重启即无"的幽灵行，增量登记失败置脏由下次 reconcile 重试）；运行期注册表变更经**串行写队列**（并发 add/登记不再叠查后写）；注册表就绪后的解析异常**拒绝入站**（不再回落全局故事查找，堵住陌生账号借数据故障绕过隔离的通道）；qzone `preferSelfId` 改为 **accountKey 精确匹配**（指定未注册账号直接失败，绝不自动切换执行账号）。**P2**——即时会话投递成功回写端点状态（三条私聊路径一致）；投递门控（isEndpointDeliverable）明确声明为 M3 范围、M1/M2 仅展示用；好友动态轮询经注册表选端点并随行 endpointId；群投递状态按实际使用的 bot 归因；群号派生/解析双侧归一化（`group:`/`guild:` 前缀配置不再永不命中）；连接器生命周期事件（bot-status-updated/removed）接入端点在线状态；重复角色端点在解析结果中显式暴露并一次性告警（不再静默取首行）。
- **M1 安全审计修复（11 项，2026-09-29 二轮审计）**：**P1**——未注册 OneBot 账号在注册表就绪后直接判为无故事（不再经全局 fallback + transport 自愈把主剧本重绑到陌生账号；账号迁移的唯一途径是新命令 `interlude.story.endpoint add/list/disable`）；accountKey 平台隔离（onebot 家族折叠保持历史兼容、原生平台专属前缀，同 selfId 跨平台不再碰撞）；注册表增量登记（建故事/参与者同步 upsert 端点行与别名）+ 单飞锁 + 创建冲突容错；多角色端点时 repair 先查数量、零地址改写、仅刷新命中端点状态；`findParticipant` 注册表 user 端点优先匹配（链接端点与地址变更不再依赖旧字段）。**P2**——别名/端点迁移覆盖 paused 故事；deliverable 确认引入 24h TTL（陈旧的 allowed 按不可投递保守处理）；桌面宿主投递成功同样刷新端点状态；`interlude_qzone_post` 增加 endpointId 列（存量回填 + 限流按端点分桶，历史行保守计入）；多端点出站地址按最近连接观测选取（不再"取第一行"），状态回写按地址收窄。
- **M1b canonical 别名迁移（零数据搬移方案）**：故事主键保持不动（即"首端点创建时固化"的稳定角色 ID），新增 `interlude_story_alias` 表登记"推导 ID → 既有剧本 ID"重定向；`findStory` 共享模式改为**端点注册表/别名优先于按账号推导**（第二端点与历史形态会话重定向到既有剧本，不再创建平行故事；重定向块带防御性 try/catch，任何异常回落旧路径）；`migrateLegacyStory` 完成搬移后把旧 ID 登记为别名（历史引用可循别名找回）；迁移幂等（与端点同一通道，前后带行数快照审计）；别名解析带双射校验（链式指向/悬空目标一次性告警并忽略）；`interlude.story.alias` 管理命令（列出/`remove <别名ID>` 回滚，回滚写剧本审计条目）。

- **QQ 空间（说说）通道阶段 0+1**：POC 实测 SnowLuma qzone 全部动作（发帖→点赞→删除全链成功；feeds 间歇失败与 appid 噪声两发现已计入设计）；新增 `src/qzone.ts` 通道层（限流门/防御归一化/动作封装/能力探测）、`interlude_qzone_post` 审计表、Console【扩展 16】配置块（默认关闭）、`interlude.qzone` 手动命令（门控→审计→SnowLuma→回写全链）。
- **QQ 空间决策流（感知-行动分离）**：`qzone-action` 意图类型——主作者在任意回合可排期发帖/评论/点赞（payload 白名单校验，post 默认好友可见、64=仅自己的日记形态；comment/like 从 [好友动态] 条目复制 tid/targetUin），到期排水一锤子执行（成败都完成意图，不回流叙事）；发帖/评论成功写 `[空间动态]` 剧本条目；好友动态轮询（appid=311 过滤 + 时间窗 + feed-seen 去重 + 好友 msg_list 按 tid 精确对齐拉正文，单轮 ≤2 条）写 `[好友动态]` 条目；主提示词新增 qzone-action 意图教学与 SOCIAL SURFACE 规则行（[空间动态]/[好友动态] 均为既成事实，动作只能走意图账本）。
- **QQ 空间安全审计修复（六项）**：账号严格匹配（指定账号不在线直接失败，绝不落到其他 QQ）；feed-seen 只读标记不再挤占动作配额与最小间隔；限流检查与 pending 预留包进故事串行队列（并发动作原子过门，配额不可突破）；传输类异常与"成功帧无 tid"记 **unknown**（保守计入配额、禁止自动重试非幂等动作）；评论/点赞目标必须来自已入账动态（feed-seen）或自己已发帖（confirmed）的 tid，且 tid 收窄字符集；feed 正文对齐只认 tid 精确命中（移除 ±90s 近似配对，杜绝连发错配）。

## 1.0.1-rc26：九项修复、TurnEngine/Scheduler 模块化与 invalidate 边界（2026-09-29）

- **九项能力/边界修复**：视觉能力漏报（`createVisionDescriber` 走 `visionAvailable()`，仅勾 useForVision 可启用）；世界播种器 Provider 复用路由表规范化（endpoint/protocol/默认参数）；`purgeAllStoryData`/`purgeStoryRange`/`clearDatabase` 全部处理 `interlude_seeded_event`；**任务失效代际**（`runtimeGeneration`/`storyTaskGenerations`：故事清理入故事串行队列，暂停/清库/purge 后旧模型结果不再提交）；世界事件注入 `injecting` 状态可恢复（失败回滚 scheduled，>5 分钟旧 claim 可重处理）；Anthropic 音频路由（原生音频跳过 Messages 协议，主路由不兼容时回退兼容备援）；侧端任务总超时预算（首请求与 JSON 恢复共享 deadline）；群音频批次附件数/字节双上限。
- **P0 TurnEngine 收编完成**：service.ts 回合状态全部改经 `turn-engine.ts` 方法（buffer/signal/invalidate/hasPending/beginFlush/endFlush/rescheduleTimers），debounce 配置改为 getter 随配置热更新；`shouldSupersedeNarrativeRequest` 委托模块实现。
- **P1 Scheduler 抽取**：新增 `src/scheduler.ts`——每故事最早到期唤醒（keep-earliest 仲裁 + busy 1s 重排）、独占任务去重门（halted/defer 500ms 让路）、指纹冷却表；`scheduleCompaction`/`scheduleDueIntentWake`/退避全部委托，Phase 1-3 执行体与 generation 校验原样保留。
- **invalidate 边界修复**：`invalidateNarratives` 在回合**在途**时保留 owner（消息清空、标记 `discardedRequestIds`），由 `endFlush` 正常释放 narrating——否则故事互斥标记永久滞留；flush 守卫 `requeue` 区分用户打断（保留批次）与管理端作废（不复活旧输入）。
- 验证：typecheck 0 错；测试 420 通过（4 项环境跳过）。

## 1.0.1-rc25：三模式主动联系、投递账本收紧与流式首帧守卫（2026-09-27，先同步 typ-0）

- **主动联系温度**（`agency.contactMode`，默认 strict=现状字节不变）：natural/balanced 在 Agency 教义中追加"想念、好奇近况、想分享此刻也是合法动机（须剧本显示她想到对方；`participants[].lastUserMessageAt` 沉默时长作为事实）"，并放宽意愿阈值（`naturalWillingnessThreshold` 默认 0.25）与安全间隔（`naturalMinimumIntervalMinutes` 默认 30，仅当小于严格间隔时生效）；balanced 额外要求节制使用情感动机。容量硬门（设备/隐私/负荷）与 Urge 爆发间隔优先级三模式不变。
- **每参与者每日主动联系上限**（`proactiveDailyCap` 默认 3，0=不限，全模式生效）：计数来自 `story.state.proactiveContactLog`（最近 20 条审计窗，不进模型上下文）；触顶不排重查。
- **投递账本状态机收紧**：`cancelled` 与 `delivered` 同为终态（已撤销行动不被迟到记账复活）；`failed→pending` 重试清除上一轮 `completedAt`。
- **Anthropic 流式首帧守卫**：网关静默时在 `min(timeout/3, 30s)` 内暴露失败而非耗满总超时。
- 本版先同步到 typ-0 桌面壳（含 Mixer 界面适配：联系温度/自然阈值/间隔/每日上限/播种器开关与节律/主提示词编辑框 + text 控件渲染 + 联系频率预设联动 contactMode）；2026-09-27 起已安装至 Koishi Desktop 实例；Gitee 最新发布为 rc24。

## 1.0.1-rc24：播种器配置并入模型用途勾选（2026-09-27）

- 世界播种器的模型选择从独立提供商配置块（worldSeeder.provider 整套表单）改为**模型中心连接行的"用于世界播种"复选框**（`useForWorldSeeding`，与 useForCompaction/useForStickers 并列）：勾选的第一个启用连接即为播种器模型，无勾选连接时总开关无效（功能关闭）。播种器分区仅保留节律参数（间隔/挂起上限/每日上限/最远时限/温度/预算/超时），Console 不再复制一份提供商表单。
- 实现侧：`ProviderConfig` 与 ProviderAssignments 新增 `useForWorldSeeding`；`resolveWorldSeederRuntime(config, provider)` 改为接收服务侧从 `config.model.providers` 解析出的连接；`world-seeder.ts` 移除配置对象内嵌 provider 的解析。请求链不变（仍走 `narrator.customSideTask` 复用侧任务机制）。
- rc23 的播种器独立提供商配置如有填写将随本版失效——升级后在模型中心连接行勾选"用于世界播种"即可，行为参数无需改动。

## 1.0.1-rc23：世界播种器、意愿档位、全量审计修复与主提示词入口（2026-09-26）

- **世界事件播种器（M1+M2）**：新增 `src/world-seeder.ts` 与 `interlude_seeded_event` 表——后台侧模型低频生成与她有关的外部事件（线下通道、NPC，注册参与者严格拉黑），经六道校验闸（时间窗/拉黑/深夜high/bigram 去重/频控）入库排期，到点以 `world-event` 条目（`[世界事件]` 前缀）注入剧本；主提示词新增 WORLD EVENTS / LITE_WORLD_EVENTS 常设块（事实权威、反应自由）。Console 新增【扩展 15】独立提供商配置块（复用主 Provider 设计，未选模型即关闭）；`narrator.customSideTask` 让独立配置块复用侧任务请求链。设计见 [WORLD_EVENT_SEEDER_DESIGN.md](WORLD_EVENT_SEEDER_DESIGN.md)。
- **群聊意愿档位化 + auto 档**：五档预设（quiet/reserved/normal/active/eager，normal 基线约每 4~5 条普通消息一次调用）+ auto 档——压缩器附带返回 `lifeStatus: busy|asleep|idle`（无额外模型调用），三态各可配档位；asleep 态 @ 不再直通且概率 ×0.2；旧数值门自动按 custom 兼容。见 [GROUP_WILLINGNESS_TIERS.md](GROUP_WILLINGNESS_TIERS.md)。
- **全量审计修复（7 项）**：Fix#10 守卫回归（committed 标志移到持久化成功后）；群消息桥接重放去重（与私聊对齐）；用户回合成功后取消遗留 narrative-retry（杜绝重复回复）；due 路径参与者状态检查 + 暂停不再反向排重试；due 批次失败整批退避一个扫描周期（无界烧 token 防线）；空白 delayed content 丢弃消息事件而非拒绝整个 commit；Anthropic SSE 坏帧容错。
- **Console 主提示词入口**：配置页最底部新增主提示词编辑框（留空=内置默认，⚠️ 警示非必要不修改）；模型中心旧字段隐藏但保留旧配置兼容。
- 测试：新增 world-seeder（6）、group-willingness-tiers（8）、audit-regression（2）、typing-floor（3）、repetition-guard（8）、participantless-interaction（4）、turn-engine（5）。主仓 402 通过 / cev 393 通过。

## 1.0.1-rc22：群聊 interaction 形态回复容错（2026-09-24）

- 修复 rc19 起的群聊主叙事整回合失败（`ScriptCommit structural validation failed: message event … has no participant` → 保持静默）：简洁传输协议把 interaction 形态写在最前，gemini-3-flash 等弱模型在群聊回合常照抄私聊形态返回 `interaction.reply` 而非顶层 `groupReply`；commit-builder 会为这个无 participant 的回复生成 `outgoing-message` 事件，结构校验拒绝整个提交。旧提示词强推 groupReply，故此前从未触发。
- 新增 `hoistParticipantlessInteraction`：无 participant 回合统一容错——群聊回合（user-message 且无 participant）把 immediate 的 interaction 回复提升为 `groupReply` 参与提交与投递（replyTo 一并保留）；delayed 与其余无 participant 相位（advance 等本无回复通道）的携带内容 interaction 一律剥离并记录日志。既有 groupReply 优先，不被回退覆盖。
- 新增 `participantless-interaction.test.ts` 4 用例：提升、既有 groupReply 优先、delayed/advance 剥离、interaction-only 群聊提交通过结构校验且只产生 group-message 事件。

## 1.0.1-rc21：首条发言打字时间下限（2026-09-24）

- 私聊对话回合（含流式早发路径）为首条消息增加打字时间下限：以叙事请求发起时刻为基准，模型耗时不足 `typingDelay(首条字数)`（沿用既有 typingBaseDelay/CharactersPerSecond/MaxDelay/Jitter 参数与后续分段同一算法）时补足等待后再发送首条；耗时已超过则立即发送。
- 实现位于 `sendOutgoingMessages` 新增可选 `requestStartedAt` 参数：仅对当前对话参与者的首条生效、每次调用至多应用一次；等待期间到达的新用户消息仍可经 shouldCancel 打断。拆条后续分段、定时意图（delayed sendAt）、跨参与者/跨群与推进回合消息不接管——它们已有各自的时间语义。
- 防御：elapsed 以 0 为下限，起点时间戳异常（时钟偏差）不会反向放大等待；新增 `typing-floor.test.ts` 3 用例（补足等待、慢返回立即发、maxDelay 截断与防御边界）。

## 1.0.1-rc20：严谨性清理 P0/P1（2026-09-24）

- 死代码删除（全仓零引用 5 处）：`resolveBlackBoxConfig` 弃用别名、`proactiveOriginBypassesOrdinaryInterval`、`alterAnalysisCoolingDown`、`InterludeLogFormat`、`LIVED_COLD_START_PROMPT`。
- 命名对齐现状（行为零变化）：`scriptFirstTransportInstruction`→`transportInstruction`（doc 注释重写为现行 JSON 协议描述）、`resolveAuthoredActions`→`reconcileTransportReferences`、`findOutgoingScriptEvent`→`findPrivateOutgoingMessageEvent`（名实相符：仅匹配私聊投递事件）、`normalizeVisibleMessageContent`→`sanitizeAndClampVisibleContent`（名实相符：有损过滤+截断）。
- 传输协议句去重：`LITE_TRANSPORT_BODY` 并入 `CONTENT_ONLY_TRANSPORT`，lite/standard 组装共用同一常量（lite 档措辞获得 "separate" 一词，无行为影响）。
- Console 特化档位描述修正：full 档不再声称 "say 锚点协议"（该协议已在 rc16 移除）。
- TurnEngine 回流主仓：`turn-engine.ts`（缓冲回合容器 + narrating 标记）自主仓 service.ts 抽出、与 cev 对齐；`shouldSupersedeNarrativeRequest` 委托单一实现；`clearDatabase` 的 `(this as any).turnEngine?.turns ?? bufferedNarrativeTurns` 双形态探测改为类型化单路径；新增 turn-engine.test.ts（5 用例）。主仓测试 383 项全绿。
- 打包防线：新增 `scripts/ensure-fresh-bundle.mjs` 并接入 `prepack`——lib/index.js 落后于 src 时拒绝 `npm pack`，杜绝 rc16/rc17 式旧 bundle 空版本。

## 1.0.1-rc19：守卫默认值收紧与桌面实例部署修复（2026-09-23）

- REPETITION GUARD 段结尾追加 "When unsure, make this reply a single bubble."：弱模型对"单句/碎片/长块三选一"执行差，给出单一明确默认值。
- 修正部署目标：确认实际运行的 Koishi Desktop 实例位于 `AppData/Roaming/Koishi/Desktop/data/instances/default`，以 `corepack yarn add file:…tgz --exact` 安装 rc19 与 cev.13；此前 rc16~rc18 误装入 typ-0 开发壳与 dev workspace，从未到达该实例。

## 1.0.1-rc18：连发同条数守卫与构建链修复（2026-09-23）

- 新增 Repetition Guard：`detectMessageRepetition` 对 recentScript 倒序归批统计她每批回复的气泡数（批次首领的投递元数据 `bubbleIndex/bubbleCount` 为权威，无元数据条目回退为连续 `character-message` 归批、被其他条目类型截断）。尾部连续 ≥2 批同为 x 条（x≥2）时判定为条数锚定。
- 命中时仅在私聊对话回合（user-message / conversation-follow-up）通过 `writingOptions.messageRepetition` 注入英文守卫段（渲染于 `writingAffordances` 尾部，full/standard/lite 三档均生效）；advance 推进回合与群聊不注入，x=1（单条习惯）不触发。
- 新增 `test/repetition-guard.test.ts` 8 项用例（元数据归批、typing 中途批次、无元数据回退、断续不触发、弱信号拒绝、双档渲染）。
- 构建链修复：插件 tsconfig 为 `emitDeclarationOnly`，`tsc` 只更新 `.d.ts`；可执行 bundle 必须用 `yakumo build`（esbuild）。**rc16/rc17 打包时未跑 yakumo，tarball 内 `lib/index.js` 仍是 rc15 旧代码，两版全部变更实际自 rc18 起才进入可执行包**。打包流程固定为 `yakumo build` → `npm pack`。

## 1.0.1-rc17：气泡分隔符负向规则（2026-09-23）

- 针对弱模型"换行不换条"复发：`LITE_TRANSPORT_BODY`、`CONTENT_ONLY_TRANSPORT`、full 档私聊协议行三处追加 "Line breaks never separate bubbles; only `<sep/>` does."——直接写在弱模型照抄的协议行位置，同时中和其自身历史中换行模板的锚定。
- 因上述构建链问题，本版 tarball 未实际包含该变更（自 rc18 生效）。

## 1.0.1-rc16：传输协议回退 0.1.x 简洁形态（2026-09-23）

- `scriptFirstTransportInstruction` 非流式分支整体替换为 0.1.1 的简单协议定义（"When interaction is permitted, its shape is {…}"），移除 SCRIPT-FIRST 镜像教学中诱发条数锚定的 `<say>` 标记教学与逐字镜像措辞；流式分支保留镜像（既有 opt-in 路径）。
- `clearDatabase` 增加 30 秒在途屏障：等待进行中的模型回合落库后再清库，修复"清库重载后仍记得旧对话"的竞态（在途回合把旧上下文写进新库）。
- 清理 `scriptFirstTransportInstruction` 死代码（`separator`/`bubbleRule` 残留）及随之失效的 `writingOptions` 参数与两处调用点。
- cev 仓同步修复 `beta6-handoff` 测试（dbSet mock 表名未加 `cev_` 前缀导致误报）。
- 因构建链问题，本版 tarball 未实际包含上述变更（自 rc18 生效）。

## 1.0.1-rc15：Gemini 兼容与提示词中性化（2026-09-23）

- `normalizeInteraction` 宽容化：`reply.mode` 为 `"text"`/`"send"`/`"reply"` 或缺失但带 content 时按 immediate 处理，修复 Gemini Flash 特化块下高频无回复/回复格式错误循环。
- 私聊协议行补充 mode 枚举约束（"must be exactly none/immediate/delayed — never text, send…"）。
- 提示词措辞向 0.1.1-beta6 中性口径靠拢，去除单侧偏向表述；`TYPED_MESSAGES` 精简至约 300 字符并加入反锚定句（"Each reply is an independent choice — the number of messages in previous replies does not constrain this one"）。

## 1.0.1-rc14：模型特化合约（2026-09-23）

- 新增 `specialization.ts`：三档合约（lite/standard/full）与家族特化块（gemini-flash/gemini/claude/gpt/glm/kimi/deepseek/grok/generic）。
- Console 新增 `specialization` / `specializationFamily` 配置；auto 档按模型名推断（flash/lite/mini → lite；claude/gpt → full；已知家族 → standard；未识别保守回退 full），`off` 保持 rc12 原样（full+generic 字节一致）。
- 家族块仅做最小偏移：长度块/打字块替换 + 至多一条新增行；lite 档为 15 块核心合约（`LITE_*` 系列），standard 档非流式使用 content-only 协议块。
- 新增 `interlude.reset` 命令，并与清库指令的描述明确区分。

### 同期 cev 分支参考（cev.1 ~ cev.13）

主线的 rc14~rc19 期间，cev 实验分支（`koishi-plugin-hds-interlude-cev`，表前缀 `cev_`）并行演进：共创作系统（works，版本化提案 + 异步生成）、TurnEngine P0 抽取（缓冲回合/请求取代从 service.ts 拆出为闭包工厂）、用户侧人格档案演化（compaction 期 userProfilePatch 追加至 profileOverlay）、环境实感注入（open-meteo 天气，30 分钟缓存 + 地理编码 24h 缓存）、语义分析桥命令（emotion×scene、事实图谱 PCA、叙事连贯度、压缩健康度，供桌面端分析面板调用）。以上模块仅存在于 cev 仓。

## 未发布：功能合作边界修复（2026-09-17）

- 群聊在首个异步等待前占用共享写作标记并保证释放；捕获当前批次会话，避免后续消息改变正在生成回合的发送通道。
- 群聊回合提交后的跨会话消息接入现有共享投递器；本群 groupReply 仍走原专用路径，不重复发送。
- 群聊 currentEvent 补齐当前批次内容和原生附件数量，两种 payload 顺序一致。
- 群聊提交时检查缓冲对象是否已被清空/替换，防止在途旧草稿复活；清理时不误删新的缓冲。
- 类型检查通过，346 项测试通过、4 项跳过。未打包/部署。风险与后续大项见 [功能冲突检查](development/FUNCTION_CONFLICT_AUDIT_2026-09-17.md)。

## 未发布：时间导演错误分类与独立冷却（2026-09-17）

- 请求超时/网络异常保留原始错误，交由服务层统一记录及计数；不再转换成空返回后误报“不是 JSON 对象”。已收到文本但 JSON 无法解析时单独标记解析失败；账本节点校验仍沿用原规则。
- 导演重试冷却改为按服务健康状态判断，不随剧本游标前移而清除；不再阻止主叙事调度，也不修改 `nextAdvanceAt`。失败时仍允许主叙事无账本推进。
- 冷却时间与失败计数随故事状态保存，重载后可恢复；成功后清除并保存故障状态。新增可选状态字段使用防御性归一，旧数据无需迁移；保存失败时保留内存冷却。
- 不改写提示词、不增加超时重试、不改变现有超时配置；独立超时配置及额外重试暂不引入。未打包、未部署。

## 1.0.1-rc13：11 项缺陷修复（2026-09-21）

- 修复旧版共享迁移在 Schedule Preplan 表上必然抛错（主键不可 update），导致 participantId 回填被跳过、隐私脱敏失效；改为读旧行→建新行→删旧行。
- 管理员清除剧本/平台数据后同步失效历史向量缓存，语义召回不再注入已删除内容。
- 命令识别正则支持点分子命令（`interlude.status` 等），盲区与关闭合作创作时不再把命令文本写进剧本。
- 中文时间解析修复"八点半"（此前解析为 8:00）。
- `<say>` 内容含边缘空白时不再丢失 immediate 回复（过滤改为精确优先、trim 容忍兜底）。
- `narrative-retry` 意图不再被用户回合提前完成，流式恢复路径恢复正常。
- Schedule Preplan 物化滞后时窗口不再静默变空：缺失 [今天,明天] 槽位时本地重物化。
- 桌面时间线分页游标改为 occurredAt+id 双键（与排序一致），回填历史不再漏行；旧游标继续兼容。
- 合并写作持久化抛错不再静默吞批：未 committed 的回合自动排一次 narrative-retry。
- interruptedTyping 标志在取消异常后无条件清理，不再永久卡死分段投递。

## 1.0.1-rc12：Anthropic Messages 与群音频写作接入（2026-09-15）

- 群聊收到可提取的音频文件/语音时，绕过意愿、仅 @ 响应与群冷却，沿既有短时消息合并队列触发主叙事；原生音频随本批消息进入模型，不强制发言。音频来源及适配器会话只暂存在当前批次，不入库，不从历史反复加载。仍保留群白名单、原生音频总开关、单消息数量和文件大小限制；未载入音频会明确记录警告。Messages 本身不支持原生音频，仍需要音频兼容的 Chat Completions 提供商及故障转移配置。
- 自定义提供商增加 `protocol`：`chat-completions`（旧配置默认）或 `anthropic-messages`；标准 `/chat/completions` 与 `/messages` 路径随选项匹配，保留中转站前缀和查询参数。官方预设仍使用其原有协议。
- 共用原有主叙事、压缩、时间导演、预排、Overlay、Alter、图片/贴纸描述链路，转换 system、认证头、图片块和文字响应；不改写主提示词、剧本字段或投递结构。Messages 使用现有提示词 JSON 合约，不发送 OpenAI `response_format`。
- 支持 Anthropic SSE 与既有实验首泡流程；只读取 text delta，thinking 不进入剧本；断流、错误事件与 max_tokens 截断判为未完成，累计 usage 只汇总一次。
- `anthropicCache` 默认关闭。开启后标记 system；cache-first 额外在历史前缀结束处标记，逐字保留完整 payload。Token 输入统计包含普通输入、缓存读取及写入；当前费用估算未单列缓存写入加价。
- 原生语音与 Embedding 不使用 Messages；原生语音会明确报告协议不支持并允许既有提供商故障转移，向量使用独立 Chat Completions/Embedding 连接。
- 实现与验证边界见 [Anthropic 适配说明](development/ANTHROPIC_MESSAGES_RC12.md)。

## 1.0.1-rc11：跨群目标交接与投递闭环修复（2026-09-15）

- 主模型上下文新增 `ongoingThreads.availableGroupTargets`：仅传递当前可用群的 ID 与名称，不复制群历史。普通及 cache-first 路径均保留该字段；不扩大既有自动联系与 Agency 权限。
- 私聊合约明确 interaction 只对应当前私聊，跨群实际行动使用独立 crossConversationActions；私聊答应不等于群发送成功，群友反应以事件与回执为据。保留群目标不明确时不猜测的边界。

- 修复 `interlude.timeline` / `interlude.script` 将历史原文作为消息元素重新解析的问题；改为纯文本展示，历史 @、图片等不会成为新的平台动作。日志中 15:26:47 的私聊 1400 错误来自含 @ 元素的历史展示请求；同时段主叙事超时是另一类故障。
- 移除独立 `groupMessages` 临时投递数组，跨群行动复用通用待投递队列，避免后台推进丢弃群消息。群目标在传输处分流，不走私聊参与者查找或私聊 session.send。
- 跨群消息保留原始剧本事件引用，逐段写入投递结果，只将实际成功段记为群发言；发送前复查群白名单，跨群失败不阻断后续私聊，不自动重发不确定投递。
- 私聊/群聊适配器返回空消息 ID 数组时不再计作成功。新增隔离投递回归，未向真实账号发送测试消息，未迁移数据库。

## 1.0.1-rc10：私聊回合跨群投递（2026-09-15）

- 支持在同一轮决策中同时保留当前私聊 `interaction` 和启用 QQ 群的跨会话消息。
- 群目标使用受控的 `group:<QQ群号>` 标识，仅允许配置中启用的群；群投递失败不会影响私聊回复。
- 重新生成 bundled 构建，确保桌面实例使用最新投递逻辑。

## 1.0.1-rc9：群聊异常修复实际打包（2026-09-15）

- 修复上一版源码已更新但 bundled `lib/index.js` 未重新生成的问题；rc9 安装包实际包含群聊不完整 `interaction` 结构的安全处理。
- 同步收紧主叙事其它 `interaction.reply` 可选链读取，避免兼容结构再次触发未定义属性异常。

## 1.0.1-rc8：群聊不完整回复结构兼容（2026-09-15）

- 修复群聊模型返回不完整 `interaction` 对象（例如只有 `interaction:{}`，同时正常返回顶层 `groupReply`）时，后处理读取 `reply.mode` 抛异常并导致整轮静默的问题。
- 群聊动作和可见回复归一化现在会安全忽略缺失的 `interaction.reply`，保留有效的 `groupReply`。

## 1.0.1-rc7：线上视觉表达提示词（2026-09-15）

- 主写作提示词补充线上表情包/视觉反应的元语言规则：根据画面、上下文、选择、时机与重复行为理解态度和信息状态，不把表情停留在字面图像描述。

## 1.0.1-rc6：QQ 合并转发读取（2026-09-14）

- 私聊与群聊识别 QQ `forward` segment，并通过 SnowLuma `get_forward_msg` 读取节点正文。
- 支持文本、@、回复、图片/语音/视频/文件占位及嵌套转发；节点数、字符数和嵌套深度均有预算。
- 转发读取失败时保留明确占位，不影响普通文本、图片和语音消息路径；新增阶段 1/2 回归测试。

## 1.0.1-rc5：线上打字表达参照（2026-09-14）

- 主写作提示词加入面向作者的简短英文 `WRITING BELIEVABLE TYPED MESSAGES`：指导作者描写人物真实的线上文字表达，区分打字与当面说话，以共同语境、用词和发送分条承担表意；热情不等于冗长，思考时间不等于发送长度。
- 仅引导实际发送文字，不压缩剧本文字，不增加二次改写、字数硬限制或固定分条；保留原有剧本、感知、消息事件与投递合约。
- 增加私聊、自动推进与群聊提示词覆盖回归；对话拟真效果仍需实机观察。

## 1.0.1-rc4：rc3 审计六项修复（2026-09-13）

1. **P0 补充事实 lastSeenAt**：创建时补填 `lastSeenAt`；`factScore` 排序对空值回退（updatedAt→createdAt）；创建故事后回填 rc2/rc3 已写入的空时间记录。此前检索排序会因 `fact.lastSeenAt.getTime()` 空值直接崩溃——普通对话可能报错。
2. **P1 proactive-check Commit 闭环**：intent-due/proactive-check 相位的 interaction 合成前移到 `decisionToScriptCommit` 之前（与 advance 的合成预检对称），commit-builder 为合成消息生成完整事件绑定。此前 proactive-check 分支的合成消息仍不进投递账本。
3. **P1 admin-note 预算上限**：保护改为最多 3 条最新注记、每条截断至 2,000 字、总占预算 ≤6,000 字（或预算 50%）；超限注记保留前缀+截断标记而非完整保留。确保原始剧本始终有 ≥50% 预算——两条 7K 注记不再把最新剧本挤出窗口。
4. **P2 侧端健康上报真正接通**：`onSideTaskHealth` 调用移到 `sideTaskJson` 内部（不依赖调用方改用新入口）；reporter 注册移到 narrator/compactor 创建之后（此前 `this.narrator` 尚未创建导致条件分支不执行）；参数签名修正为 `(task, ok)`；narrator 和 compactor 均注册（此前只覆盖 narrator）。
5. **P2 主动联系计数移到投递结果后**：删除入列时的 `recordProactive(true)`，改用 `pendingProactiveCount` + `sendOutgoingMessages` 返回后按 `delivered.length > 0` 计数——加入数组不等于发送成功。
6. **P3 幻觉检测拓宽 + Token 归属**：模型行为测试新增"编造第三方发言"检查（`X说/X问/X回复` 但 X 不在已知消息中）；`lastActiveStoryId` 文档标注初始化时机。
- 312 项回归；严格类型检查通过。

## 1.0.1-rc3：管理员注记语义修复（2026-09-13）

- 修复 `interlude.script.note` 对模型无实际效果的问题。**不是 rc2 回归**——从 0.1.5 起就存在的功能不完整：admin-note 数据链路（写入→recentEntries→recentScript→模型可见）一直通畅，但主提示词从未说明 `[管理员注记]` 的语义权重，模型只把它当作普通 system-event 忽略。
- **主提示词新增 ADMIN NOTES 指令**：`[管理员注记]` 条目是管理员注入的权威事实/指令，权重高于普通系统事件，在其所述主题上覆盖叙事即兴，主角已内化（不需要看到或提及注记本身）。
- **compactPromptEntries 保护 admin-note 不截断**：admin-note kind 加入受保护集合，即使超出字符预算也保留完整内容——截断半句管理员指导比丢弃更危险。
- 312 项回归（含 admin-note 语义断言 + 截断保护测试）；严格类型检查通过。

## 1.0.1-rc2：社区审计七项修复（2026-09-12）

社区逐项审计发现的全部确认 bug 修复（详见验证报告）：

1. **补充事实入库修复**：去掉字符串 ID（改用自增主键）、补 `status:'active'`、`knowledge.mode` 改为合法的 `'confirmed'`、`.catch(()=>undefined)` 改为有日志的 catch——创建失败不再静默。
2. **合成主动联系多行动保守**：`synthesizeCrossActionFromScript` 在 `authoredActions.length !== 1` 时返回 undefined——多行动无法确定接收者归属，不猜"最后一条"；单行动无歧义照常合成。
3. **合成行动前移到 Commit 构建前**：advance 相位在 `decisionToScriptCommit` 之前做合成预检，把合成的 crossConversationAction 注入 decision，让 commit-builder 正常生成 outgoing-message 事件和投递账本绑定。此前合成发生在 Commit 后导致账本缺记录（deliveryReality 下一轮报 no-outgoing-action-recorded）。
4. **群聊空行转换加拆条开关**：`normalizeGroupVisibleReply` 增加 `splitEnabled` 参数（默认 true），关闭拆条时不再改写空行——保持原始段落格式。
5. **健康指标修正**：`recordStructureMissing` 在首稿计数、`recordRecoverySaved` 在恢复稿通过后才计数（拆分此前混在一起的 else-if 分支）；侧端任务 `recordSideTask` 通过 narrator 健康报告器接线；主动联系 `recordProactive` 在 crossActions 投递点接线；`test:model` 命令加入 package.json scripts。
6. **模型行为测试改生产提示词**：`makeSystemPrompt` 改为调用生产 `systemPrompt()` 函数（全参数）；气泡断言改为"不应恒定同一非零值"（允许全单条/全沉默）；幻觉检测改为只查"未被提供的电话号码"（不再误判正常描写当前消息到达）。
7. **Schema 默认值对齐**：`contextEntryLimit` 50→35、`contextTimeWindowMinutes` 60→45，与服务层 fallback 一致（消除 Schema 50 覆盖服务层 35 的不一致）。
- 311 项回归（4 项模型行为待真实 API）；严格类型检查通过。

## 1.0.1-rc1：稳定性基建——模型行为回归测试 + 健康面板（2026-09-12，预发布）

- **P0 模型行为回归测试**（`test/model-behavior.test.ts`）：用真实模型 API 跑固定合成场景，断言传输层契约（interaction 字段完整性、群聊 groupReply 存在性、气泡段数分布、无自造消息）。需设 `HDSI_TEST_*` 环境变量，未设时自动跳过。每次发布前跑 `npm run test:model`。
- **P3 健康诊断面板**（`src/health.ts` + `interlude.status` 命令增强）：内存滚动指标——主叙事成功率、结构化回复缺失/挽回次数、回复模式分布（immediate/none/delayed/无投递）、前缀缓存命中率、中位延迟。重载后归零（since 时间戳标注）。在 `interlude.status` 输出尾部追加健康段。
- **P1 群聊协议 content-only**：确认已在 beta8-9 中实现（群协议行零 actionId 教学），本轮验证后无改动。
- **P2 跨会话归一化**：确认已在 beta4 中实现（normalizeConversationAction 走 normalizeVisibleMessageContent），本轮验证后无改动。
- 稳定性路线图文档：`docs/plans/2026-09-12-stability-roadmap.md`。
- 311 项回归（4 项模型行为测试待真实 API 环境）；严格类型检查通过。

## 1.0.1-beta16-tuned：多条视角与补充事实（2026-09-12）

- **storyDefaults.perspectives**：新增多条独立主角视角/价值观（`string[]`，最多 12 条，每条 ≤800 字符）。与单条 `perspective` 并存：`perspective` 是总述，`perspectives` 是多条独立条目，进入提示词时保持数组形态不合并，提示词明确说明它们同等权威且可以互相矛盾。已有故事的 `perspective` 字段不受影响。
- **storyDefaults.supplementaryFacts**：新增补充事实栏（`string[]`，最多 20 条，每条 ≤800 字符），用于注入界限不明显的世界/人物/关系复杂事实。创建故事时自动写入初始长期事实（`interlude_fact`），scope 按内容推断（人物→character、关系→relationship、其余→world），importance 0.6 / confidence 0.95（配置的既定事实）。
- Console 配置项在【必填 1】故事档案内新增 `perspectives` 和 `supplementaryFacts` 两个数组字段。
- 307 项回归通过；严格类型检查通过。

## 1.0.1-beta15-ostt：主动联系传输合成修复（2026-09-12）

- 修复主动联系全链路断裂：模型输出 `proactiveContact(send-now)` 且 Agency 判断通过（willingness 0.90、capacity-available），但不返回 `crossConversationActions` 行动字段——消息发不出去（实测 471 次 Urge 调度 0 次主动联系的根因）。
- **advance 相位合成**：Agency 通过且 crossActions 为空时，从剧本的 `<say>` 行动中提取实际消息内容构造合成 crossConversationAction——剧本里写了她发什么，宿主补上传输信封，绝不发明剧本里没有的词。
- **proactive-check 相位对称修复**：Agency 通过但模型没输出 `interaction.reply` 时，同样从剧本 say 行动合成——与私聊 beta9 的 content-only 契约同思路："写了就发，不要求模型再填一个字段"。
- 合成时打 standard 级日志"已从剧本 say 行动合成"便于观测。
- 307 项回归通过；严格类型检查通过。

## 1.0.1-beta14-ostt：群聊崩溃与嵌套 groupReply 修复（2026-09-12，社区反馈）

- **修复 soleActionReply 空值崩溃**（beta9 引入的回归）：`decision.interaction.reply` 为 undefined 时 `soleActionReply(undefined)` 直接读 `reply.mode` 抛 `Cannot read properties of undefined`，被 failover 当成 provider 失败重试再崩 → `All narrative providers failed`。补上 `!reply || typeof reply !== 'object'` 空值保护（兄弟函数 resolve/rescueSilentActionReference 均已有此保护，唯独此函数漏了）。
- **修复群聊嵌套 groupReply 不识别**：部分模型（实测 Gemini 3.7 Flash 群聊 mention-only）把群回复嵌套在 `interaction.groupReply` 而不是顶层 `decision.groupReply`，导致 `hasStructuredGroupReply` 判 false → `no usable script` 整轮失败。现在 `resolveAuthoredActions` 在入口将嵌套 `interaction.groupReply` 提权到顶层（顶层已有时不覆盖）。
- 感谢社区用户逐行定位并提供本地补丁验证（两个补丁均与官方修复方向一致）。
- 305 项回归通过；严格类型检查通过。

## 1.0.1-alphatest2：跟进意愿、主动联系动机、降级提交、预算与缓存（2026-09-12）

- **跟进补写意愿引导**（conversation-follow-up 相位提示词）：刚结束的对话涉及她真正在意的——想继续吐槽、想分享、突然想补充——她此刻更愿意主动发言；不要让热络话题只因对方停手就断掉。
- **主动联系动机放宽**（agencyInstruction separation）：她刚经历的生活本身可作为动机来源——想到对方、发生好笑的事、想继续话题、对对方在做什么的好奇都是合法的 life-grounded motive（原先只允许 life-event/promise/practical-update/relationship-follow-up，实测 471 次 Urge 调度 0 次主动联系）。
- **结构化回复两稿均缺失时降级提交**：剧本非空则以无可见回复提交（生活继续走），不再硬失败进重试队列（弱模型下避免失败循环）。
- **原始剧本预算缩减**：recentScript 字符预算 24,000→12,000，条目数下限 50→35，时间窗默认 60→45 分钟。预期中位输入 25k→18-20k tokens。
- **cache-first 默认开启**：mainPayloadOrder 默认值 legacy→cache-first；已有实例需手动切换或由本次安装自动写入。
- 303 项回归通过；严格类型检查通过。

## 1.0.1-alphatest：0.1.5 写作引导旧版嵌入实验（2026-09-11）

- 应用户要求做 A/B 对照实验：核心写作指导逐字替换为 0.1.5-beta3 的英文写作引导（写作基调 + 篇幅行），用户手作中文写作观快照保留于 docs/experiments/。v2 功能合约全部保留；仅装桌面实例，不作为发布版本传播。
- 303 项回归通过；严格类型检查通过。


## 1.0.1-beta13-ostt：用户手作连续生活写作观（2026-09-11）

- 核心写作指导替换为用户手改原文（1248 字符，逐字保留），集中在 `src/script/lived-writing.ts`：承接经历而非历史句式，以当下注意与具体关系推动叙事，允许有依据的小幅偶然与未完成结尾；功能合约（相位、时间、证据、消息感知、传输镜像、Alter、Agency、Preplan、Urge 与自定义提示词入口）保持原样，不改解析器、调度、数据库与历史文本。
- 替换原篇幅/气泡文风/冷启动写作段；取消默认短气泡和跨轮强制变形暗示，保留实际发送时刻对应分隔符的协议（协议行"单条为默认+反定式"仍在）。
- 验证：303 项回归通过；完整提示词 19,844 字符（较 beta12 再 -5.5%）；真实模型（gemini-3-flash-preview）四场景探针 4/4 合法 immediate+content，气泡形态自然分布。完整文本与修改前快照见 `docs/experiments/2026-09-11-user-authored-writing.md` 与 `2026-09-11-lived-writing.md`。

## 1.0.1-beta12-ostt：两段式定式修复（2026-09-11）

- 确诊"每回合恰好两条消息"定式：24/24 回合精确 2.0 段，剧本叙述层同步固化（"敲出两行"+`<sep/>`）。机理为上下文自我模仿正反馈——输出进入可见历史后偏置下一次输出，任何稳定的每回合形态都会锁死；v2 的三个放大器：beta10 协议行新教 `<sep/>` 被弱模型过度采用、换行→分隔符转换机械制造两段、剧本对形态的双重编码（台词+叙述）。
- 修复：协议行气泡规则改为"单条为默认，时刻真的发送两次才用分隔符，绝不固化固定段数"；节奏行新增"跨回合变化气泡数量与形态，重复的两段式是模板不是节奏"；换行转换收窄为空行（段落）边界——单个换行留在一条消息内，不再机械制造两段式。
- 真实模型（gemini-3-flash-preview）实测四场景：气泡数 1/2/2 分布，两段均为语境合理（安慰+建议），契约 3/4 immediate+content（1 次合法沉默）。
- 301 项回归通过；严格类型检查通过。

## 1.0.1-beta11-ostt：系统提示词保守压缩（2026-09-11）

- 针对弱模型的指令负载税做保守压缩：系统提示词 23,051 → 20,819 字符（**-9.7%，约 700 tokens**），落在预期的 10-20% 区间下沿。
- 压缩原则：只删修辞复述（同一约束的第二次措辞、装饰性从句、流式专属文本无条件出现等），全部语义约束保留——共涉及 14 条指令行（台词节奏/消息感知/剧本引导/篇幅/lifeHandoff/时间时钟/EVIDENCE/intents/timelinePlan/防虚构 incoming/未决联系/打断草稿/webContext/协议行）。
- 真实模型（gemini-3-flash-preview + 完整压缩提示词）实测 4/4 产出合法 `immediate+content`，其中 2 次主动正确使用 `<sep/>` 分隔符。
- 同步 6 处测试断言至压缩后措辞（语义不变）。
- 301 项回归通过；严格类型检查通过。

## 1.0.1-beta10-ostt：气泡分隔符修复（2026-09-11）

- 弱模型把多气泡间隔写成换行（而非 `<sep/>` 分隔符），导致整段作为一条多行消息发出。两层修复：
  - 协议行（弱模型真正照抄的位置）直接教学分隔符字面量："join them inside content with the exact literal token `<sep/>` between bubbles - never line breaks"（拆条关闭时不出现该句）；
  - 防御性转换：拆条开启（`splitReplyMessages` 未关闭）且内容未用分隔符时，非空行之间的换行归一为分隔符（私聊与群聊同合约）；已用分隔符或拆条关闭的内容不受影响。
- 澄清分条投递身份：多气泡共用同一 outgoing-message 事件，由 `bubbleIndex/bubbleCount` 区分（delivery.ts prepareOutgoingDelivery），账本按 (事件, 段序) 记账，承诺结算等待全部气泡确认——不存在共用 ID 导致的投递失败。
- 301 项回归通过；严格类型检查通过。

## 1.0.1-beta9-ostt：传输契约 content-only 化（弱模型实测驱动，2026-09-11）

- 用真实模型（gemini-3-flash-preview）对真实完整提示词做逐句二分定位，找到两个毒点：**顶层 JSON 形状句从不点名 `interaction` 字段**（弱模型整字段丢弃的根因）；**契约中的 actionId 教学**诱发"抄引用、不写 say 标记"的自造 id 形态（`reply_20260911_01` 等，解析失败即静默丢弃）。
- 传输契约改为 **content-only**：私聊/群协议示例即完整的 `{"mode":"immediate","content":"…"}`，用户消息相位的完整提示词中 actionId 零出现；多泡格式说明改为"reply.content 含完整分隔块"。实测同一模型：改前 4/4 自造 actionId，改后 **4/4 完美 immediate+content**。
- 代码侧 say/actionId 解析、唯一行动兜底、矛盾救援全部保留（强模型与历史输出兼容）。
- 顶层形状句现显式点名 `interaction (groupReply in group turns)`。
- 300 项回归通过；严格类型检查通过。

## 1.0.1-beta8-ostt：弱模型传输合约重构（2026-09-11）

- beta7 实测教训：mode=none+actionId 矛盾触发"重写→仍矛盾→硬失败"在弱模型（gemini-3-flash-preview 连续两稿同形态）下演变为整回合失败循环，比静默不发更糟。矛盾处理改为**就地救援**：actionId 锚定到剧本 say 行动则直接翻转 immediate 投递（不重写、不失败），锚定不到按合法沉默放行并留 standard 诊断。
- 私聊协议示例改为弱模型无法弄错的单步形态：示例本身就是一个完整的 `{"seen":true,"reply":{"mode":"immediate","content":"the exact words she sends now"}}`——发送的话就在字段里，不再要求"剧本标记+字段引用"两步一致；say/actionId 引用降级为正文描述的可选优化（强模型仍可用），content 镜像声明为始终合法。
- "剧本里写了发送就必须 immediate；沉默回合不携带 actionId 或 content"的约束保留。
- 300 项回归通过；严格类型检查通过。

## 1.0.1-beta7-ostt：弱模型传输合约修复（2026-09-11）

- 修复 beta4-ostt 引入的弱模型回归：私聊协议示例从具体值 `"seen":false` 改为模板占位符 `<true|false>` 后，弱指令模型（实测 gemini-3-flash-preview）出现整字段丢弃或字面照抄——同模型对照实测：结构化回复缺失重写率从 1.7%（1.0.0 时代，5/296）升至 23%（10/44），个别恢复稿落入 `mode=none + actionId` 的自相矛盾形态，表现为「剧本里回复了、实际没发消息」。示例已恢复为可直接照抄的合法 JSON 值（1.0.0 实证形态），独立性/已读不回/content 直传等语义说明全部保留。
- 新增矛盾检测：mode=none 却携带 actionId 的输出（合规合约里沉默从不引用发送行动）视为结构缺失，触发一次恢复重写而非放行——与合法沉默（无 actionId 的 none）严格区分。
- OUTPUT RECOVERY 指令收束：剧本写了发送就必须 immediate，沉默回合不携带 actionId。
- `本回合无可见回复 interaction=…` 诊断从 diagnostic 升至 standard 级，文件日志可直接看到，远程排查无需改配置。
- 299 项回归通过；严格类型检查通过。

## 1.0.1-beta6-rebuild：Console 配置分组重组（2026-09-10）

- Console 配置页按【必填 → 结构 → 节奏 → 表达 → 内在 → 扩展 → 维护】重新分组编号：必填三项（故事档案/模型中心/QQ 接入）置顶，节奏类（运行时/Urge/日程预排/时间导演/行动窗口）集中，表达/内在/扩展/维护依次排列，弃用项（chatRhythm）移至末尾隐藏；修复了旧编号 12/13 重复冲突的问题。
- 时间导演配置描述精简为设计原则摘要（客观时间事实 + 不做笃定未来预测 + 失败降级不冻结）。
- 配置文档全线同步：CONFIGURATION_GUIDE 按新分组重排并补时间导演小节；BEGINNER_GUIDE 的填写顺序建议、README 的盲区模式（原"失明模式"）术语、一条龙 HTML 指南同步更新。
- 配置键名与存储完全不变，仅为 Console 展示顺序与描述调整，旧配置无缝兼容。
- 298 项回归通过；严格类型检查通过。

## 1.0.1-beta6-ostt：暂停死锁修复与群聊附件卫生（2026-09-10）

- 修复共享主剧本模式下的暂停死锁（用户实测反馈）：`getCanonicalStory` 只查 active 故事，暂停后故事对全部管理命令"隐身"——`interlude.resume` 永远报"没有故事"，`interlude.story.start` 撞主键后领回暂停旧故事，形成永久闭环。现在 `findStory` 在 active 查不到时补查 paused（精确 id → character 前缀 → 最新，不采纳 archived）；调度路径保持 active-only，暂停语义不变；story.start 遇到暂停故事时明确提示用 resume 恢复。
- 群聊入站附件卫生：`<img>/<file>/<record>/<video>` 元素与对应 CQ 码转换为事实占位（`[图片]`/`[文件：名称]`/`[语音]`），带 rkey 的 URL 污水不再进入群上下文、也不会被模型复述成真实附件。
- Alter 用量恢复聚合：多服务商/多尝试（含去 cap 重试）的 Token 用量合并为一条 Console 输出，`sideTaskJson` 新增 usageSink 由调用方聚合。
- 298 项回归通过；严格类型检查通过。

## 1.0.1-beta5-ostt：侧端任务思考预算修复（2026-09-10）

- 定位思考型网关（如 gemini-3.7 系）把 reasoning 计入 completion 预算的问题：带小 `max_tokens` cap 的侧端 JSON 任务会被推理挤到只剩残句（`Unterminated string at position 21~68`，实测 Alter 错误率 5%→31%，跳变点为更换模型的日期，与插件版本和 Koishi 框架无关——框架 4.18.11 全程未变，主叙事同期 0 错误）。
- 新增 `sideTaskJson` 共享通道：压缩、时间导演、日程预排、Overlay 整理、Alter 分析五类侧端任务在首次输出不可解析（invalid JSON / Unterminated / Unexpected token / 空响应）时，自动去掉 `max_tokens` 原样重试一次——成功路径零额外请求；重试触发时打 warn 便于观测。
- 侧端任务统一多文本字段解析（content/reasoning_content/refusal/text/output_text 逐一尝试），此前仅时间导演享受该宽容度。
- 使用建议：思考型网关下把 `alterSystem.maxTokens` 调大（≥1500）为推理留预算；本实例配置已调至 2000。
- 294 项回归通过；严格类型检查通过。

## 1.0.1-beta4-ostt：私聊回复可靠性、原生表情与音频文件修复（2026-09-10）

- 私聊协议示例改为中性 `<true|false>` 并明确"已读不回"（seen=true + reply.mode=none）是普通合法状态；`normalizeInteraction` 解耦 seen 与 reply——跟进/到期回合协议规定 seen=false 时，真实发送的回复不再被无声抹掉。
- 私聊唯一 `<say>` 行动兜底：模型照抄协议示例 id 或省略引用时，按唯一已授权行动解析，不再静默丢弃回复；零行动、重复 id、伪造继承保持原有 none 语义。
- `currentParticipant.unreadMessageCount` 以客观事实进入感知指引（到达记录，不是注意力或义务）；私聊回合回复模式=none 时输出 interaction 诊断日志，区分模型主动沉默/未读/引用失配三种链路。
- 原生表情 face.id 改发数字（OneBot 11 规范 int32）——严格校验的服务端实现不再拒绝（实测报错 `<face id="66"> is not a valid segment`）。
- 出站可见文本统一剥离附件类元素与 CQ 标记（file/img/audio/record/video/flash/mface）：模型复述入站附件标记不再物化为真实文件发送；跨会话主动消息与实验性流式早发补齐同一归一化合约。
- QQ 音频文件（`<file>` 元素 + CDN 直链）进入原生音频通道：下载原始字节（体积上限与超时约束）→ 文件名扩展与魔数双保险嗅探格式 → `input_audio`；入站文本剥离 file 标记，文件以事实占位（音频文件/未知文件）进入模型上下文，URL 污水不再泄漏。
- 293 项回归通过；严格类型检查通过。

## 1.0.0-beta16：分支批次 4 游标回滚支撑（2026-09-09）

- 新增 `cursor-set` bridge 命令：桌面可设置叙事游标（分支截断后回拨到 forkPoint），串行队列内执行。
- `recentEntries`（prompt 路径）与 timeline-range 投影均过滤 `kind='redacted'` 墓碑——purge fallback 软删条目不再漏进模型上下文和桌面时间线。
- `purgeStoryRange` 末尾自动回拨 `cursorAt` 到范围起点——分支截断后叙事时钟从 forkPoint 重新推进，不留时间缺口。
- 283 项回归通过；严格类型检查通过。


## 1.0.0-beta14：OneBot 过滤默认值修复（2026-09-09）

- 修复 `onebot.enabled` 默认值错误：Schema 默认 true 使未配置该段的安装（如 typ-0 桌面剧本模板）进入"空默认白名单拒绝全部私聊"状态，`canHandleSession` 静默拒收一切入站私聊且无可见日志。默认改为 false，恢复"未配置即不过滤"的注释承诺与旧行为；显式启用过滤的安装不受影响。
- 由 typ-0 真机验收发现（SnowLuma ↔ 桌面 ↔ worker 全链路其余正常，剧本库始终为空、inbound 全部 worker-rejected）。主线 283 项回归通过。


## 1.0.0-beta13：打字努力与内容分量配比（2026-09-08）

- 懒打字从全局默认细化为努力配比原则：打字努力与内容分量成正比——贫嘴、玩笑、随口吐槽按真人打这些话的方式发（一个碎片、一个词、无标点、不铺垫），真正在乎的事才值得被认真组织。
- 手头事务约束同步加入：活动中回消息保持简短，直到自然的停顿；不慌不忙的时刻允许更长。
- 保留 beta12 的全部谱系授权（一个字 ↔ 一长串 ↔ 暂不发）、单条默认与不均匀拆条规则；仅提示词变更，无代码行为、数据库或协议改动，283 项回归与类型检查通过。


## 1.0.0-beta12：关系语境、环境在场与发言形态（2026-09-08）

- 关系事件解读回填：读取每条新消息时先看字面贡献与两人之间的即时关系线（最近说了什么、问了什么、答应过什么、悬而未决什么），再由既有关系倾向提供细微语境；倾向是语境不是裁决。恢复 beta9 压缩时丢失的正半句，防僵化语义保留。
- 环境在场改写：既定环境与姿态无需复述，但只要触及她的注意或情绪就在场（还在的房间、天气、桌上未完成的事）——替换原先"可以放在背景"的降权措辞。
- 发言形态谱系授权：消息的条数、长度与节奏跟随她当下状态（疲惫或匆忙可以只发一个字，安定亲近可以发一长串，某些时刻暂不发）；同时确立真人式懒打字默认——简单想法默认一条紧凑消息发完，拆条是需要真实节奏理由的例外（真实停顿、中途改主意、迟来的补充），拆出的气泡应不均匀而非几条相似的短句。气泡分隔符机制段同步"单条为默认"。
- 情绪解禁：emotionalOffset 可以为消息的节奏与形态着色（内容由当前事件与具体生活处境决定），移除"不是回复格式指令"对形态通道的误伤；保留"不是人设标签或例行 routine"。
- 仅提示词与断言同步，无代码行为、数据库或协议改动；283 项回归与类型检查通过。


## 1.0.0-beta11：生活质感与推进丰度回填（2026-09-08）

- 在不恢复字数区间、不改动简明续写核心的前提下，回填三处老方案（0.1.1-beta6）的铺陈要素：正文写作令重新要求环境、进行中的行动、身体节奏、现实压力与关系作为持续在场的"活性质地"而非一次性背景；密度句恢复"稀疏时段把日常生活继续推进到下一个有意义的节拍"；独立生活推进阶段恢复 complete 措辞。
- 新故事开场（无原始剧本可用时）从单一的"具体当下事务"扩展为具体环境、活动、现实事务与内心活动的多维展开维度，缓解新故事首段约 200 字的丰度不足。
- 台词简短授权与"短消息可来自充分展开的生活"的解耦保持不变；事件密度优先、开放结尾、续写锚点与原文权威等 beta9/beta10 核心未改动。仅提示词与文档变更，无代码行为、数据库或协议改动。
- 与 0.1.1-beta6 的体量差距归因分析（铺陈指令谱系断裂）记录于本次发布上下文；283 项回归与类型检查通过。


## 1.0.0-beta10：生活剧本展开与消息感知（2026-09-08）

- 融入消息感知的写作引导：未注意、无法查看、忙于要事或个人意愿暂不查看时，允许本段完全不写当前消息，继续生活；区分只见通知、未读与已读不回。私聊协议同步允许 seen=false，不再给实时回合固定 true 示例；沿用既有未读登记，不新增补读调度。

- 参考 0.1.1-beta6 的生活剧本写作重心，把作者任务与生活展开放在协议说明之前；具体行动、现实事务、感受和关系按本段需要自然组织，不要求逐项铺陈。
- 撤回 beta9 中密集交流主要由对话构成、安静时段轻写的暗示。明确台词有自己的口语节奏，短消息也可以来自充分展开的生活剧本，台词长度不决定正文深度。
- 无前段原文时，以设定与当前时刻建立可承接的具体生活起点；保留已有来源历史的地位，不重构缺失的过去交流。
- 不增加字数下限、检测或重写，不改变人称、原文预算、记忆学习、投递及调度算法。发布前快照位于 `dustbin/source-backups/2026-09-08-before-beta10-release/`；实际正文深度与自然度仍需实机观察。

## 1.0.0-beta9：简明剧本续写提示词（2026-09-07）

- 合并原文权威与续写位置说明，移除逐步识别消息含义、排列写作入口的指挥，保留新事件可修正旧理解。
- 取消每轮从环境、动作、压力等要素开始的要求；允许密集交流主要由对话构成，细节随实际注意与行动展开，保留完整原文及时间边界。
- 允许简短回应、口语省略和不作结论的交流；气泡可以按自然停顿拆分未完短句，完整台词及顺序仍属于同一个 say 行动。同步澄清 separator 可位于 say 内，兼容 legacy reply.content。
- 未改模型、采样、记忆、Alter 算法、数据库或投递实现；未引入双人称。283 项回归与类型检查通过，拟真度待实机对照。发布前快照位于 `dustbin/source-backups/2026-09-07-before-beta9-release/`。

## 1.0.0-beta8：剧本续写、记忆导航与弹性调度（2026-09-07）

- 汇总 P1-1～P1-4：同事项交接、历史向量渐进补齐、带位置的原文跨度导航、到期／未解决事项查询。它们只为完整原始剧本导航，不生成事实或额外分段 embedding。
- 增加 `urge` Console 配置：默认关闭、低／中／高／自定义档位、有效联系意愿门槛与折叠高级时间、随机和预算参数。开启后以真实消息热度、已提交原文的 `urge`／`slow` 交接统一调度下一次推进；不额外调用模型、不裁剪剧本，不取代 Agency 的行动或回执条件。
- `extensions.urge` 复用既有 story JSON，不新增表／列或事实库迁移；对空对象、缺失字段、错类型与过期状态做防御读取，保留旧 `knowledge={}` 的兼容边界。
- 主叙事新增事件优先理解交接：当前用户消息先决定本刻新澄清、修正、限定或仍未解决的意义，再由既有关系倾向提供细微语境；完整原始剧本仍是唯一续写来源。
- Alter 改为记录可消退的内在天气、具体原因和注意力条件；不把互动口吻、关系标签或消息格式变成后续写作模板。关系发展提案必须同时具备“用户真实反馈 → 主角实际回应”的证据链；单场景 provisional 倾向不再进入压缩模型影响下一轮学习。
- 新增事件重估、同场景学习隔离与反馈缺失保护测试；发布前全量 **283 项**测试、严格类型检查和本地构建通过。未以这些工程验证代替真实模型多日拟真度验收。
- 详见 [P1 实现记录](development/P1_MEMORY_NAVIGATION.md)、[Urge 实现记录](development/URGE_SYSTEM_IMPLEMENTATION.md) 与 [事件优先修正](development/EVENT_LED_SCRIPT_REPAIR.md)。

## 文档：beta10 → V2 全量对比（2026-09-07）

- 新增 [V2_VS_BETA10_COMPARISON.md](V2_VS_BETA10_COMPARISON.md)：0.1.5-beta10 与 1.0.0-beta8 的逐功能架构对比（ScriptCommit、投递账本、原文主权、SceneFrame、证据关系、记忆导航、时间路由等 16 项），每项说明拟真性加强的位置；含整体架构优势论证与尚未验收边界。纯文档，无代码变更。

## 1.0.0-beta7-enhanced：证据关系与分段回复修复（2026-09-06）

- 按本次范围实现 P0-1、P0-2、P0-4；不实现 P0-3，不加入纠正触发、强制认错或道歉流程，不更换 embedding 模型。
- 事实与工作细节新增 knowledge：区分观察、转述、主角想法、提议、条件和双方确认，保存原文引用、认知主体与关联事实。旧记录不清空，读取时明确为未分类的派生记录。事实新增 nullable JSON 字段，首次加载增量扩展，后续热重载不重复建表。
- 主叙事及时间导演读取同一 contactThreads 条件来源链：保留原始提议、条件与附近实际回应；旧资料通过字面相关性和条件线索补取原文，线索只用于导航，不自动确认约定。按关系隔离，原文去重、整条保留、设置独立预算，缺失来源显式标注。仍允许主动询问、期待与误会。
- 整理器保留原句语气及条件；主观解读不能据此关闭承诺，反复叙述不增加同一记录的置信度。新增同事项 relatedFactIds，确认与条件并存，引用不等于语义证明。
- 修复终端显式分段台词只登记第一句：传统 content 镜像及单一 say 标记仅包住首句时，恢复同一私聊行动的完整分隔块，统一交给原有 commit、分段发送与回执链。普通叙述、未来草稿、多目标动作和已提前流式发送内容不据此补发；新消息打断未发分段机制不变。
- 修复旧数据库兼容崩溃： beta6 之前写入的 interlude_fact 行 knowledge 列为 `{}` （无 clauses/relatedFactIds 数组），contactThreads 及证据读取路径上的半保护取值（`knowledge?.relatedFactIds.includes` 等）抛出 Cannot read properties of undefined，导致主叙事与后台推进持续失败。所有存储证据读取改为完全防御（knowledgeClauses/knowledgeRelatedIds 归一），部分缺失形状的证据记录按未分类处理，不迁移数据库。
- 源码备份：`dustbin/source-backups/2026-09-06-before-evidence-repair/`。详情见 [证据关系与分段修复报告](development/BETA6_EVIDENCE_DELIVERY_REPAIR.md)。发布包已生成并安装至默认桌面实例；安装前插件、清单和锁文件备份于 `default/backup/2026-09-06-before-hdsi-beta7-enhanced/`。不改写桌面数据库；运行中的实例需重启后加载新代码。

## 1.0.0-beta6：原文、行动、场景与学习的单链交接修复

- 新增正文内 `<say id="…">原话</say>` 行动引用。宿主移除标记但保留原话，先解析 actionId 再进行现有投递规范化；兼容原 content、分段分隔符、延迟消息、群聊和跨关系发送。实验性提前流式发送保留原内容协议，已发原话不会被后续正文改写。
- 无发送行动的已提交剧本明确携带 `no-outgoing-action-recorded`；主叙事、时间导演和后台整理读取执行结果。停用实时重复生成 continuitySnapshot，有原始剧本时不再投影旧 snapshot，避免“正文写已发送→摘要确认已发送”。memory 新记录保存原始 sourceEntryId，并作为派生记忆而非执行证明。
- 时间导演读取最新完整原文，最近条目辅助摘取改为尾部；新提交标记 `original-v2`，导演 beats/carry 是建议而非既成事实。保留宿主时间窗口校验、重试与旧条目的 legacy ledger 解释，不改写历史正文。新回合不再把 carry 写成永久当前状态，也不再用导演末拍覆盖 scene.summary。
- 新增带原文引用的轻量 lifeHandoff：地点、末端活动、完整局部在场表、转场及小事项完成。局部状态按事件替换，剧情弧不重置；SceneFrame 不把看不到来源的旧在场记录当作当前证据。状态信封升级至 v4，局部边界与事项完成来源版本防止滞后的后台整理重新写回旧状态。
- 主提示从完成的原文末端接演，新消息改变当前理解而非重建上一段；完整原文与既有未决联系保留。旧关系笔记标为主角先前理解，用户实际反馈可修正它，不使用反复读拦截、关键词禁令或按时间缩写剧本。
- 人物学习输入加入实际用户反馈、前次发言、角色解释和实际回应的来源链。关系候选需要支持性的 interactionReview 才可晋升；未决或受质疑的观察不增加场景置信度，原跨场景、跨日和反证逻辑保留。
- Alter 的待分析累计按主角独立生活和关系来源分桶。触发后的侧端分析只读取同一来源的评分轨迹和可见剧本，避免不同关系的氛围变化混合后由片段材料解释。
- 同步 README、架构、V2、用户指南和开发索引；既有 M10 报告保留为历史记录。具体实现、兼容边界与回放检查见 [beta6 修复报告](development/BETA6_ARCHITECTURE_REPAIR_REPORT.md)。其余次级功能方向仍在独立 backlog；未实现用户排除的 Alter 情绪原因相关性/消退策略。
- 本轮仅构建、测试和打包；不安装或重启桌面实例，不清洗运行历史，不访问 typ-0。自动测试不代表真实模型已经通过拟真度或多日验收。

## 1.0.0-beta5-m10：主要功能合作与调度闭环收尾

- 到期意图补齐 ID；前台只消费叙事任务，不误完成承诺、浏览、分段及主动检查。
- 承诺登记/结算绑定剧本消息事件的完整投递确认；失败、取消或仅送达首段不视为兑现，无关回复不清空待答事项。延期和原事件回放按事件身份去重。
- 无来信的跟进/到期回合不再创建 message-perceived 或错误更新已读状态，保持再次联系作为主角的新动作。
- 分段消息在混合到期队列中仍可独立投递，前台忙时不启动额外后台叙事。
- 主提示词使用实际分段开关、自定义分隔符和浏览模式；修复侧端视觉观察与原生图片数为零的语义冲突。
- 私聊跟进的自动通信摘要按关系隔离；cache-first 继承完整基础 payload 后变换历史视图。
- 无消息回合可以当前可见生活原文作人物倾向相关性查询；不改变跨场景晋升、反证或最多两条投影的条件。
- 后台通信摘要等待完整投递后登记，两个分段执行入口补齐回写，摘要故障不打断投递链。
- 更新 V2、功能合作检查报告及发布文档。严格类型检查与226项自动测试通过；本次仅打包，不安装实例或修改运行数据库。真实模型拟真度、多日运行、外部适配器与崩溃恢复不冒充验收完成。

## 1.0.0-beta5-m9：续写落点修复、M8 工程收尾与 M9 安全清理

- 修复单气泡首尾分隔符导致 ScriptCommit 无法还原消息的边界；保持原始 prose、气泡顺序和行动绑定不变。
- 新增来源型 continuation bookmark：只引用当前可见原文的末次已完成剧本与真实通信条目，不复制台词、不生成场景摘要、不推断用户尚未回复。
- 正向引导从最后成立的处境接演；未决联系、等待、再次询问与独立生活属于同一剧本。无新消息不等于禁止联系，也不要求每轮制造事件。
- 长段字面复用仅作 debug 观测，不拦截、不裁剪、不重试、不改变人物学习权重。
- 补齐 cache-first 分支遗漏的 timelinePlan/timelineCarry，保持两种上下文顺序的时间证据一致。
- M9 删除未被生产链调用的 legacy-adapter 转出口和 ChatRhythm 检测/指令模块；停止投递后的无消费者节奏统计写入。旧配置隐藏并保持兼容，历史状态原样保留。
- memory、旧 overlay、时间账本投影、消息兼容入口仍有消费者，未删除；不迁移或清洗运行数据库，不改投递调度、不安装实例。
- 验证：严格类型检查及 209 项自动测试通过，含 40 轮混合事件的上下文夹具测试；这不是 40 轮真实模型拟真度验收。多日运行、跨日回忆与真实模型不重播仍待安装后验证。
- 删除前备份：backup/2026-09-05-before-beta5-m9；详见 V2 文档本次收尾记录。

## 1.0.0-beta4-m8：M7.1～M8 原位连续性与人物发展

- M7.1：增量整理按完整前缀推进，空 scene/arc 结果不确认检查点；补充前情原文，按已处理位置关闭场景；实时原文预算提升至 24K，修正空内容与图片占位。
- M7.2：新增可重建的来源化事件标签；降低仅凭 prose 相似度的排序权重；召回排除集合对齐实际 payload；保留命中原文、后续结果、发言归属与来源 ID。
- M7.3：继续停用写作侧 ChatRhythm 指令，保留完整行动的兼容诊断，不改变气泡与投递策略。
- M8.1：自动剧本原文与时间证据分开呈现；短对话后续/到期窗口在无已知结构边界时免去时间导演；长窗口导演失败或熔断时保留游标等待重试。
- M8.2：事实提示保留 unresolved 和来源；后台整理消费投递实际结果；有证据完成的 workingDetails 可明确结束。memory 表仍有实际生产者/消费者，继续保留。
- M8.3：新的自由路径 statePatch 收敛为受控 development.* 维度；先观察、跨场景去重后晋升；反证降低置信度并撤下倾向。相关场景最多投影两条来源化软倾向，关系隔离，不累计到永久人设 overlay。
- 原始 script 入库不再被通用 12K 裁剪；源文件、索引和上下文测试覆盖长原文与高密度对话边界。
- 发布包版本为 1.0.0-beta4-m8。真实模型拟真度、旧弧重建及 24/72 小时观察尚待验证。
- 验证：严格类型检查通过，205/205 项测试通过；后台候选和标签提示有界，优先保障 scene/arc 整理。

## 1.0.0-beta4-m7：M7 原位首阶段

- 停止主模型上下文中的 ChatRhythm 模板指令，保留兼容统计。
- 增加同一剧本行动的必要投递结果投影，区分平台确认、未确认和取消，并过滤跨关系行动。
- 显式场景关闭时保存带来源的检查点 metadata；历史召回按检查点/frame 与关系分支重建导航索引。
- 原文回取优先保留命中段，再补邻域，避免长前文挤掉相关证据。
- 包含下述 M6 异常边界修复。细粒度事件标签、M5 局部行动引用和实机拟真度验证沿 V2 更新路径继续推进。

## M6 异常边界轻量修复（并入 beta4-m7）

- 统一隔离投递账本的数据库读写异常，避免新增 metadata 记账中断后续气泡调度或平台动作。
- partial 仅表示已有部分成功；failed/cancelled 混合不再误报部分送达，尚有 pending 且没有成功时保持 pending。
- 两条拆分投递路径在未确认且安排重试时记录 pending 原因，沿用原有重试策略。
- 更新 V2 后续路线与完成度：结果投影、崩溃恢复、ChatRhythm 指令退出及实机拟真度仍需验证。本批次不打包、不更新 Desktop。

## 1.0.0-beta3-m6

- 完成 M5 补充收束：主叙事按 phase 只接收当前可执行的最小 transport mirror，高密度对话从尚未发生的变化继续，回复不再套用固定发送仪式。
- 完成 M6.1 原位投递闭环：每个已提交剧本行动在同一 script entry metadata 内建立 delivery ledger；私聊、群聊、拆分气泡、贴图、原生表情与群反应共享 commitId/eventId 身份。
- 平台执行结果按 segment 回写 `pending | delivered | partial | failed | cancelled`；成功结果不会被较晚的记账错误降级，部分群消息失败不再被首个成功气泡掩盖。
- `character-message` 与 `character-group-message` 仍只记录平台实际成功投递的内容；M6 不修改主模型提示、transport 原文、剧本 prose、发送顺序或延迟策略。
- 本阶段不新增 Outbox 表和第二发送器；M6.2 只在 M6.1 通过实机稳定观察后进行，避免双写和重复投递风险。

## M5 补充收束（并入 1.0.0-beta3-m6）

- 主叙事按私聊、群聊和独立生活 phase 注入最小 transport mirror，减少无关 schema 对写作中心的占用。
- 高密度对话从尚未写出的变化继续，保持事件分辨率，同时不再重复铺陈未变化的场景装置和固定发送仪式。
- 即时消息事件新增宿主侧原文位置绑定；无法绑定的旧式输出只记录诊断并保持兼容投递。

## 1.0.0-beta2-m4.1

- 修复时间导演对 OpenAI 兼容网关的结构化响应读取：当首个文本字段是推理或说明、有效 JSON 位于后续字段时，逐字段解析有效结果。
- 时间导演拒绝时保留前 500 个字符的原始输出于调试日志，避免在服务层被误显示为 `原始返回=null`。

## 1.0.0-beta2-m4

- 恢复以 `recentScript` 为第一权威的剧本续写提示；当前消息仍只是一项进入生活的事件。
- 将模型可见的 `currentSceneFrame` 收敛为带来源的 `currentSceneEvidence`，不再回注 prose 尾句、姿态或修辞。
- 增加原始剧本 embedding 持久化、词法/来源/语义三路召回及连续原文邻域回取，修复跨日事件遗忘。
- DialogueBurst 改为由话题、关系范围和明确事件边界推进；Scene 关闭需要可验证来源，压缩计数改为累计。
- 生产提交入口迁移至宿主侧 script-first `commit-builder`；模型不填写事件图，宿主生成提交和事件身份。

## 1.0.0-beta1

- 在 beta10 唯一主链上完成 M1–M4 原位架构迁移，没有并行问答引擎或额外主模型调用。
- 新增带来源的只读 `SceneFrame`，同一活动场景不因消息数量或时间间隔重建地点、动作和叙事焦点。
- 新增 `DialogueBurst`，连续对话身份由场景边界决定，空闲时间只作为调度信号。
- 主模型 payload 改为七段式正向续写支架；当前消息是 `incomingEvent`，回复仍是同一 `SceneDelta`/`ScriptCommit` 中的剧本事件。
- SceneFrame 不保存私聊或群聊 prose 的具体措辞，避免共享故事中的跨关系信息泄漏。
- 状态 codec、统一模型路由、ScriptCommit 事件身份、拆分气泡追踪与正向事件密度写作框架成为正式基础。

## 0.1.5-beta10-foresight

### 实况时间守卫：消除「用户约定」误杀（历史共 23 次丢弃）

**背景**：2026-09-01 至 09-04 的日志累计出现 23 次「剧本越过当前时间终点，已抛弃本次未落库剧本并重新写作」。逐案还原后确认全部为误杀，而非剧本真的越界：

- 09-03 上午 11:19-11:37：用户约「中午一起吃饭」，模型写「十二点的铃声响了」——守卫连杀 6 次；
- 09-03 晚 07:37-07:49：用户说「我看你怎么在八点赶到万松园」，模型如实写入约定——连杀 5 次；
- 09-04 早 08:05：用户说「希望你能在九点前赶到万松园」，模型写「08:47 到达」——完全在用户给的窗口内，仍被丢弃；
- 09-04 早 07:37-07:49 同类死循环连杀 11 次。每次重写模型都会把用户说的钟点写回去，再次被拦，形成自持循环。

**根因**：守卫把「剧本全文里出现任何超前当前时刻的钟点」一律当作「剧本时间越界」，无法区分「叙事时间被写飞」与「模型如实引用用户说出的未来约定」。

**修复（三层检测语义）**：

1. **检测范围收窄到剧本开头 30 字的「叙事宣告位」**。中文叙事在场景起始处声明时间；如果模型真的把叙事推进过界，几乎必然在开头宣告。中后段钟点绝大多数是约定/回忆/计划引用，不再作为越界证据。这是架构级修正：不再依赖枚举关键词猜测语义，而是依赖叙事文体的结构性位置。
2. **计划语义豁免**：开头钟点前后 8 字窗口内出现「赶到/约定/之前/要在/约好/打算」等词时放行（覆盖「八点赶到」「九点前」等计划句式）。
3. **用户背书豁免**：用户消息里明确说出的钟点被提取为背书集合（extractUserReportedTimes），剧本中与之匹配的钟点（数字「08:00」与中文「八点」互通）不再计为越界；用户给出未来期限（如「九点前」=540 分钟）时，落在 (当前时刻, 期限] 区间内的叙事推进一并授权；时段词「中午/下午/晚上」映射为 12:00/15:00/20:00 背书锚点，覆盖「中午一起吃饭」这类不含数字的约定。

**保持不变的拦截能力**：开头裸宣告未来钟点（用户未提任何时间）仍拦截；无背书任意跳时间仍拦截；课程阶段推进（第一节课→第二节课）仍拦截；背景推进回合（advance）完全不检测。7 个真实案例回归测试全部通过（152/152）。

### extractUserReportedTimes：补齐中文与时段词提取

- 新增中文数字钟点提取（「八点」「八点半」「九点一刻」）：此前只有守卫的检测正则认识中文写法，prompt 侧的 userReportedTimes 反而漏掉——07:47 用户打的是「在八点赶到」，提取结果为空，背书与上下文两侧同时失明。
- 新增时段词锚点（「中午」「下午」「晚上」等 → 代表性钟点）：让「中午一起吃饭吧」这类口语约定进入自报时间集合，守卫与 prompt 共用同一份语义。纯本地正则，零额外模型调用与延迟。

### 主提示词：剧本写作底层引导重构

- **体量与节奏**：实况回合剧本以 400–700 字为佳，节奏优先——具体细节、肢体语言、内心声音与可见回复交织成完整一幕，杜绝两行摘要。此前尝试的「800 字上限」措辞被模型读成天花板执行（实测剧本字数从 340–548 腰斩至 201–296），已改为区间表述并明确「节奏优先于长度」。
- **多样性与开放空间（本次核心）**：每段剧本都是一篇独立的新写作，不是系列连载。合约明确要求模型先读 recentScript 中先前场景用过的形状——日期时间地点开场、同一房间展开、收手机/锁屏/回到课堂式收尾——然后**刻意避开**，改用进行中的动作、思绪、对话或节奏变化开场与收束；保持世界的开放空间：留出没说出口的、悬而未决的、即将发生的东西，不用整齐的收尾把每回合包起来。
- **设计取舍**：结构多样性通过提示词底层引导实现，宿主侧不做剧本结构检测与限制——检测器无法穷举「趋同」的形态，而模型自己对照 recentScript 判断并避开是更根本的解法。ChatRhythm 保持原有职责（投递回复的气泡节奏反定型），与本条互补。
- 钟点写入规则不变：开头至多声明一次当前时刻，后文钟点只能是约定/回忆引用，不能是「叙事已到达该时刻」的宣告。

### 其它

- 时间守卫的 5 分钟延迟宽限与 6 小时 12 小时制歧义视野（beta7-enhanced 引入）保持不变；午夜回绕回归用例继续通过。

## 0.1.5-beta2

- 新增聊天节奏反定型（ChatRhythm）：宿主从已投递回复中零成本提取表达节奏签名（气泡数/长度档位/尾句语气），命中四条激进判据（结构同构/长度惯性/尾段复读/字数箱体）即判定定型，并以主角视角的生活化描写注入 payload 召唤她本来的节奏多样性；注入措辞随连续未改善三档升级，最终熔断。Console 新增独立分区，提供 gentle/balanced/aggressive 三档检测策略。
- 固定合约补充 chatRhythm 字段语义行（主角自己的表达状态，非系统指令）；`<sep/>` 语法规则与投递机制不变。
## 0.1.5-beta7-enhanced

- 修复实况守卫对 12 小时制与午夜回绕的误判：now=00:01 时提到"11:58"（即 3 分钟前的 23:58）不再被当作 11 小时后的未来时钟而丢弃整段剧本——朴素前向距离超过 6 小时的时钟引用按"刚过去的 12 小时制写法"处理；分钟级延迟宽限（5 分钟）提取为具名常量并保持不变。
- 修复时间导演无限重试循环：失败退避从固定 10 分钟改为按连续失败次数指数增长（10min→20min→40min→封顶 2h），不再以固定节奏空耗模型调用。
- 时间导演熔断保护：连续失败 6 次后熔断，自动推进降级为无账本守恒推进（不再无限弃回合导致游标冻结、自动生活停摆）；熔断 2 小时后自动重试一次完整路径，成功即恢复。
- 可诊断性：时间导演返回被拒绝时，日志输出连续失败次数、模型原始返回（截断 400 字符）与逐节点拒绝原因；`normalizeTimelinePlan` 改为宽容解析——`at` 接受数字字符串与百分比字符串，`kind` 接受常见近义标签（scene/event/事件/场景等）自动映射，不再因单个字段差一点丢弃整个账本。
- 新增时间导演独立开关（Console「时间导演」分区）：关闭后自动回合不生成账本直接推进。
- 修复时间导演返回空/无效事件账本后，后台扫描仍反复进入自动写作的问题。失败窗口现在持久化重试冷却，冷却期间不再重复调用主叙事或刷屏；冷却结束后自动恢复，手动推进仍可用。
- 冷却状态随故事保存，插件重载或 Desktop 重启后仍能避免对同一时间窗口立即重复消耗模型 Token。

## 0.1.5-beta7-enhanced

- 兼容模型偶尔输出的 `<sep>`、`<sep />` 与全角括号变体，统一归一化为 `<sep/>` 后再拆分投递。
- 主提示词明确要求分段标记必须使用完整 `<sep/>`，仅在确实需要多个独立气泡时使用。

## 0.1.5-beta4

- 修复 Schedule Preplan 更新已有记录时把主键一并写回导致的数据库异常；审查游标现在会正常持久化，避免每轮后台整理重复调用模型。
- 自动时间导演失败时对未变化的时间窗口启用短暂冷却，避免后台扫描在同一窗口每三分钟重复请求；窗口变化或冷却结束后自动恢复尝试。

## 0.1.5-beta3

- 修复 Schedule Preplan 被场景压缩失败阻断的问题：日程审查结果先独立写入，场景压缩失败只影响场景本身，不再导致同一日程请求反复消耗 Token。
- Schedule Preplan 调用异常时会保存当天的审查状态并保留已有计划；首次审查则保存空记录，等待后续可靠证据。

## 0.1.5-beta2

- 修复后台记忆压缩失败后针对同一未变化场景反复调用模型的问题：失败范围进入运行时冷却，出现新条目后才自动重试。
- 压缩、Schedule Preplan 与 Overlay 整理独立使用 `compaction.responseFormat`；缺少旧配置时默认 JSON object，不再被主叙事的 prompt-only 设置带偏。
- 压缩写入后校验场景 `lastEntryId` 检查点确实推进；数据库写入中断或响应未落库时记录冷却并等待后续重试，避免重复消耗。
- 保持手动 `interlude.memory.compact` 可绕过自动冷却，便于管理员在修复模型或数据库后立即重试。

## 0.1.5-beta7-enhanced

- 为实时用户回合增加时间边界守卫：短窗口中出现明确未来时钟或多课次跨越时，丢弃结果并恢复重写，二次越界不落库。
- 历史语义召回在 Console 的 Embedding 分组中显式展示并补齐默认值，便于按需关闭。
- 表情包描述上限改为可配置，默认 768 tokens；失败素材单独冷却 30 分钟，异常不再中断整轮扫描或每五分钟重复扣费。
- 继续整理 Console 与命令文案，保持核心配置优先、复杂模块按需展开。

## 0.1.4

- 正式化宿主时间轴：自动回合以已完成 timeline ledger 为导演输入，自动完成后立即同步活跃场景锚点与 host-owned timeline carry，避免相邻自动推进重复选择同一生活事件。
- 当前用户事件新增本地接收时间与用户明确陈述的动作时钟；历史条目同步提供本地发生时间，区分“现在收到消息”与“用户报告过去在某时做过某事”。
- 修复 Schedule Preplan 首次无证据时的空结果死循环：持久化“已审查、暂无线索”的空记录；共享剧本隐私模式下从安全的自动时间账本读取日程证据。
- 修复本地表情包扫描的 ID 冲突与单素材失败阻断；表情包描述支持 `json-object` 与 `prompt-only` 两种返回格式。
- 正式提供侧端识图、时间线重基准、稳定时区时间显示与 Token 用量日志；同步完善部署、配置、新手、命令、架构与开发文档。

## 0.1.4-beta7-reimagine

- 自动推进、对话后续和到期意图改为“时间导演 → 主叙事渲染”双层流程：复用压缩模型先生成 1–4 个位于当前真实窗口内的相对时间 beats；无有效事件账本时保留游标等待重试，不让自由 prose 决定世界时间。
- 自动剧本把已验证的 timelinePlan 写入元数据；后续上下文投影使用事件账本而非上一段 prose，压缩器也会读取该账本作为自动窗口内事实的优先来源。
- 修复 cache-first 的 `recentExchange` 会重复 script prose 的问题；尾部锚点现在只包含真实收发消息与已投递动作。
- workingDetails 与压缩合约收紧为“当前具体状态”，明确排除未来检查、预测、期待和未发生截止点。
- 新增 `interlude.timeline.rebase`：为旧版本受未来误写污染的故事从当前真实时间重建活跃时间线，不删除历史剧本与长期事实。
- 新增可选侧端识图模式：纯文本主模型可通过 `vision.mode=sidecar` 与 `useForVision` 视觉连接接收当前图片的临时事实观察，图片与观察均不持久化。
- 本地表情包描述新增 `stickers.descriptionResponseFormat`：可手动选择 `json-object` 或 `prompt-only`；后者不发送 API JSON mode，仍保留提示词 JSON 合约与宽容解析。
- 修复本地表情包扫描的素材 ID 冲突：ID 改为规范化路径与内容哈希组合；单个素材的读取、数据库写入或描述失败会单独记录并继续扫描其余素材。

## 0.1.4-beta6-reimagine

- 分段消息的模拟打字延迟加入默认 ±30% 抖动；`typingJitterRatio=0` 可恢复固定节奏。
- 主叙事 JSON 合约改为可见 transport 字段在前、script 在后，为流式首条投递提供协议基础。
- 新增 `model.mainStreamingMode=experimental`：仅在 `json-object` 下尝试解析完整私聊 `interaction.reply` 并提前投递；群聊继续等待完整结果。
- 智谱官方 SSE 与 OpenAI Chat Completions SSE 均具备实验性解析路径。首条成功投递后若流式收尾失败，保留已发送消息、记录系统事件，并禁止可见 failover 重发。
- README、配置指南、部署教程和一条龙向导增加兼容模型范围、手动开关及风险说明。
- 新增 `model.mainPayloadOrder=cache-first`：主叙事 payload 按变异频率重排，对话历史与低频记忆层前置、每轮变化字段（当前事件、时钟、状态）后置，使支持前缀缓存的服务商（DeepSeek/GLM/Kimi 等）跨轮命中稳定前缀，显著降低连续对话的输入成本与 prefill 延迟。
- cache-first 模式在 payload 末尾新增 `recentExchange` 最近交换块（最多 3 条、1600 字符、排除当前消息），把最后几条交互重新锚定在生成点旁；固定合约同步说明该块是既定过去的强调而非新事件。默认 `legacy` 逐字节保持历史顺序。
- 固定合约瘦身：删除两条被其它规则完全覆盖的重复行、修剪两句纯氛围/重复半句，并把 refreshContinuity 的双变体合并为单一恒定行——系统提示自此跨全部轮次逐字节一致，refresh 轮不再击穿前缀缓存；非刷新轮合约缩短 251 字符、refresh 轮缩短 445 字符，语义与安全约束无删减。
- cache-first 模式的 recentScript 条目元数据压缩：kind/actor/participantId 三元组折叠为单个紧凑标签（protagonist / protagonist-narration / protagonist(group) / protagonist(action) / user / group-member / system），participantId 仅在历史真正跨越多个关系分支时保留；固定合约同步提供标签图例。实测每轮节省约 2-3k tokens。
- 贴纸目录语义过滤：`embedding.semanticStickerFilter` 默认开启，按当前消息的向量相似度只注入最相关的 12 条贴纸描述；素材描述与别名在后台自动向量化（每次扫描最多补齐 8 条），Embedding 不可用时回退全量目录。
- 视觉输入降采样：`vision.maxImageDimension`（默认 1024，可选 0/512/768/1024）通过可选 Puppeteer 服务重渲染图片，节省多模态 token 与上传时间并顺带修正 EXIF 旋转；Puppeteer 不可用、动图或小于 150KB 的图片自动透传原图。
- 记忆缝隙根治：`memory.previousSceneSummaries`（默认 2）把紧邻已关闭场景的摘要（每条裁剪至 2000 字符、带时间范围）并入主提示词的场景上下文，填补 30-50 条原始窗口与弧线摘要之间的信息黑洞；`contextEntryLimit` 默认由 20 提升至 50（受 12k 字符预算约束，与 cache-first 搭配时增量近乎免费）。
- 新增 Token 用量与计费日志：每次主叙事/压缩/Overlay 整理/Alter 分析/贴纸描述调用后输出一行 `Token 用量[任务]`，包含输入、缓存命中（与命中率）、输出；在模型连接上配置 `priceInput` / `priceOutput` / `priceCachedInput`（每百万 tokens 单价）后，同一行还会输出计费合计与缓存节省。用量聚合跨 failover 尝试与恢复重写（每次重试消耗的 token 都会计入）；流式路径从流内 `usage` 块读取，服务商未报告 usage 时该次调用自动省略用量段。
- 修复 Schedule Preplan 每轮重试风暴与消息延迟：生成失败后 2 小时内不再重试（此前弱压缩模型省略 schedulePreplan 字段会导致每个用户回合后都触发一次迷你整理）；压缩模型调用移出故事串行队列（prepare → 队列外 LLM → 重新入队落库），用户消息不再排队等待压缩完成；压缩合约补充首次创建指引（current 为 null 时必须返回 schedulePreplan）。
- 修复上一条拆分方案引入的串行队列自死锁：promise 链式队列内嵌套 `serial(同一故事)` 会让整理任务与落库任务互相等待，整条故事队列永久卡死（后续消息只有接收日志、永不回复）。现在三阶段全程无嵌套，模型调用在队列外执行。
- Console 描述统一（subtle 文案微调）：请求管线统一称"主叙事"、连接对象统一称"连接"；功能总开关统一"启用 X：…"句式、行为修饰开关统一"是否…"；vision 分区与字段描述去重；计费第三项措辞与前两项对齐；配置指南 memory 小节编号修正（8.x→10.x）。仅描述文本，无任何行为变更。
- 修复 strictNullChecks 关闭配置下 PreparedCompaction 可辨识联合的布尔判别式不收窄问题，改为字符串判别式（phase: 'skip' | 'run'）。
- 新增 workingDetails 工作暂存：场景压缩在整理时提取"取餐码、代购、跑腿"这类小型在途细节（`{label, value, expiresAt}`，去重合并、上限 10 条、默认 6 小时过期），存于故事状态并随主提示词稳定区注入；主合约要求模型安静地作为背景使用、绝不逐条复述，过期自然淡出。
- 新增历史语义召回：`embedding.semanticHistory`（默认关闭）将剧本条目在后台向量化（最新优先、渐进覆盖全表、无时间窗），故事级内存向量缓存一次加载、增量扩充；实时回合按当前消息检索最相关的 3 条旧片段注入 `recalledHistory` 回忆块（排除原始窗口内条目，内容与 recentScript 同源清洗）。查询向量全轮统一：贴纸过滤、事实语义排序与历史召回共享一次 Embedding 请求。

## 0.1.4-beta5

- 新增独立的 Schedule Preplan：压缩模型基于近期剧本证据维护生活阶段、周规律和日期例外，程序确定性展开未来 14 天。
- 每天在本地空闲时检查一次；覆盖充足且没有新证据时不调用模型，需要建立、续写或调整时复用 `useForCompaction`，并尽量与场景压缩合并。
- 主叙事只接收从当前时刻起未来约 12 小时、最多八项计划块；提示词明确计划不是已发生事实，真实事件与剧本优先。
- 固定日程的开始/结束可成为自动推进锚点；新增 `interlude.schedule`、`interlude.schedule.rebuild`、Console 配置和独立设计文档。
- 近期上下文改为条目下限与时间窗口的并集：默认至少 20 条，并保护最近 60 分钟内的真实用户/角色消息。
- Continuity 不再持久化或注入自由文本 `next`；未来计划改由 pending intent、到期事项和 Schedule Preplan 动态提供。
- Fact 生命周期支持 `resolvesFactIds` 和显式 `unresolved=false`；最近已完成事件与未完成承诺各有固定检索通道，unresolved 排序加分只作用于 promise。
- 承诺、active consequence 或开放事实完成后标记 continuity 提前刷新，不再机械等待第 15 次写作。

## 0.1.4-beta4

- 保留当前消息同时作为持久事件与 `currentEvent` 的现有叙事语义，并增加回归测试防止未来误删；本版不实施事件去重。
- 合并剧情余波的到期清理与有效项读取，单次主叙事只扫描一次 pending intent；Memory 关闭时跳过 memories、facts 与 Overlay 查询。
- Alter 达到阈值后仍在首次后台调度机会立即分析；Overlay 与场景压缩一旦启动也继续完成，保证连续对话不会无限推迟状态沉淀与记忆整理。
- 配置默认值与模型 provider 路由改为插件生命周期内只规范化一次，减少实时热路径上的重复对象构建和提供商筛选。
- 延续群聊可靠性修复：群投递优先使用当前 session bot，过期主剧本投递账号可自愈；多段消息会按实际成功段落记录，表情动作只有发送成功才消耗群聊意愿，并要求模型显式返回 `groupReply:none`。
- 私聊、到期消息与自动联系改为投递成功后才确认 `character-message`、角色消息时间和后续分段；失败内容只写入“未投递”系统诊断，不自动重发，避免短暂适配器异常把虚构发言写回剧情或造成重复消息。
- DeepSeek 官方模式新增独立思考开关和 `low` / `high` / `max` 思考强度；默认关闭思考，开启后才写入官方请求参数。
- 同步 README、配置、新手、部署、命令、安全、架构与开发文档；补充 Koishi Desktop 的 Yarn 本地包安装方式、表情包描述模型字段，并将 README 链接的文档索引纳入 npm 包。

## 0.1.4-beta3

- 入站 QQ 原生表情现在会在私聊、群聊与引用内容中翻译为稳定语义文字；经典系统表情复用 QFace 表，并补齐当前具名新增表情。未知未来 ID 保留“名称未收录”标记，不再交由模型猜测。
- QQ 原生小表情的 `expressionThreshold` 改为语义校准阈值：模型声明的意愿必须与当前回复文字相符才能投递，不能再用 `willingness: 1.0` 穿透高阈值；`0.95` 以上为接近关闭档。
- 收束原生表情提示词：日常回复不应附带表情，`nativeFace` 是可省略的表达动作，不是发送许可字段。
- 部署与配置文档同步 beta3 本地包路径，并说明原生表情开关和阈值含义。

## 0.1.4-beta2

- 优化聊天动作提示：私聊仅启用原生表情时不再注入群消息引用说明，减少无关上下文。
- 优化本地表情包索引：活动素材建立内存 ID 映射，减少实时回合中的重复线性查找；发送前使用相对路径边界校验。
- 修复自动推进和对话后续日志被误标为“回复模式未提供或无效”的问题；按回合语义显示无可见投递、主动联系或计划联系。
- 完善表情表达阈值、历史方括号表情语义投影与群聊/私聊动作边界的回归测试。

## 0.1.4-beta1

- 新增轻量聊天动作能力层，默认关闭；仅当 Console 开关、当前平台和适配器能力同时满足时，相关字段才进入主提示词。
- QQ/OneBot 群聊支持指定消息回复与单条消息表情回应；模型只读取 `msg-*` 安全引用，HDSI 在本地映射真实 OneBot 消息 ID。
- 群聊消息记录补充可操作消息 ID；成功表情回应写入轻量动作回执，并复用群聊意愿成本与冷却，避免绕过防刷屏约束。
- Console 可选择 QQ、微信或同时选择作为聊天动作目标平台；当前内置执行器为 QQ/OneBot，未注册的微信连接器不会向模型暴露动作字段。
- 入站指定回复现在读取 Koishi `session.quote`，将被引用消息的作者与正文作为本轮独立引用上下文交给主模型；无引用时不增加提示字段。
- 新增默认关闭的本地表情包库：每五分钟扫描新增或变更的 PNG/JPEG/WebP/GIF 素材，按分组与单素材描述建立本地索引。
- 模型连接行新增 `useForStickers`；只有勾选并完整配置的视觉模型才会为新表情包生成描述。主模型仅在库中存在已描述素材且当前 OneBot 回合可投递媒体时读取受限目录。
- 主模型可精确选择描述最匹配的本地表情包；HDSI 验证素材 ID 后发送原始文件，并把实际发送描述写入动作回执。GIF 描述使用代表帧，投递保持原动图。
- 修复旧式“引用：原句”被当普通文本发送：现在会映射近期可引用的真实 OneBot 消息 ID 并发送 QQ 引用；无映射目标时阻止伪引用文本。
- 修复模型将 `[表情]`、`[图片]`、`[动图]` 等占位词作为普通消息发送；引用内容与旧剧本进一步标记为已发生历史，避免被误写成刚刚发生的新事件。
- 新增低频语义化 QQ 原生表情：模型需输出 `nativeFace.semantic` 与表达意愿，达到 Console 阈值后才由 HDSI 映射为真实 face 段；本地表情包同样使用该阈值，避免每回合装饰性发送。
- 修正主叙事完成日志的回复模式语义：自动推进、对话后续和无投递到期回合显示“无可见投递”，自动生活中的跨参与者发送显示“主动联系”；“未提供或无效”仅保留给实时用户消息或群消息的结构化回复缺失。
- 加入动作引用范围、表情白名单、提示词条件注入和隐私边界的回归测试。

## 0.1.3

- 新增 Console 首位的 `blindMode` 失明模式：HDSI 不注册管理指令，并在执行前静默拦截当前 Koishi 实例中已解析的命令；普通聊天仍进入叙事。旧 `blackBox` 配置保留兼容读取。
- 失明模式隐藏 HDSI 运行、错误、消息预览与模型侧调试记录，仅按可配置间隔输出无故事内容的健康心跳；其它插件日志保持各自配置。
- 对话后续阶段的已发送私聊现在要求与 `interaction.reply` 使用同一段文本，避免剧本写到投递动作而结构化回复仍为 `none`。
- README 改以“固定阶段、连续生活”说明写作机制：调度间隔只决定唤醒时机，不再定义不同的写作尺度。
- 重排模型 Console：视觉开关前置，服务商行仅保留连接信息，实际模型名只在预设填写一次，主叙事只保留一份采样和输出格式；单一启用预设可自动复用为主叙事、压缩与 Alter 模型。
- 进一步合并模型配置中心：模型连接行直接分配主叙事、压缩、Alter、Embedding 四类用途，Console 不再要求填写 `providerId`、`modelId` 或 `mainModelId`；旧配置引用继续兼容读取。
- 新增每提供商独立的 `zhipu-official` 模式：智谱行固定官方 endpoint，配置仅保留 API Key、模型与推理强度；GLM‑5.3‑Flash 主叙事改用 SSE，首字等待上限 45 秒、首字后无总时限，并使用智谱兼容的图片字段。普通 OpenAI-compatible 提供商可与智谱行混用。
- 新增 OpenAI、DeepSeek、Kimi/Moonshot、阿里云百炼、硅基流动、OpenRouter 与 Gemini 的每提供商官方预设；各行固定其官方 Chat Completions endpoint，仍可与自定义 OpenAI-compatible 网关混用。
- 移除冗余的全局 `model.mode` Console 字段；是否启用远程模型由启用且完整的提供商行自动判断，旧字段仅保留读取兼容。
- 新增群聊专用的纯算法 willingness：按群本地累积、半衰减、边际递减、阈值概率和成功发言成本筛选 `responseMode=always` 的普通消息；@ 机器人绕过概率，默认关闭且不影响私聊或其它系统。
- 群聊投递兼容 `groupReply` 与即时 `interaction.reply`，并在结构化可见回复缺失时丢弃未落库剧本、带恢复指令重写一次。
- SnowLuma STT 保持默认关闭；Console 收束模型连接、失明模式、群聊意愿与语音转写的提示文案。
- 群聊意愿判断前置到冷却查询之前，减少未触发群的数据库读取。

## 0.1.3-beta3

- 自动推进中的已完成跨参与者消息现在与对应的即时 `crossConversationAction` 成对表达，并在剧本条目旁保存通过投递门槛的轻量动作回执。
- 私聊主叙事与对话后续将“此刻已发送”的剧本文字与 `interaction.reply` 对齐；考虑、草稿和输入状态保持为生活叙事的一部分，直到结构化回复承载实际消息。
- 收束固定主提示词中重复的传输说明，保持私聊、自动推进与多参与者动作的结构化边界清晰。
- 模型调用日志区分明确的 `none` 与缺失或无效的结构化回复，便于排查叙事动作和投递字段不一致的情况。

## 0.1.3-beta2

- 自动后台回合可保存已完成投递的紧凑行动摘要，下一次自动推进据此只表达新增进展；用户实时回合与普通到期意图不读取该摘要。
- 场景压缩新增来源校验的轻量在场表，记录少量配角的在场、离场或待会合状态，避免摘要凭空制造告别或让 Canon 配角默认在场。
- 新增绑定式承诺回访：角色向用户承诺“想想再答复”等未来回应时复用 intent 表登记，到期后要求可见履行、延期说明或取消说明；每位参与者最多保留两项，普通自动推进不加载该上下文。
- 新增独立 Perspective：主角个体价值观 / 看待世界的方式作为 Canon 之外的外壳人格层保存；其 overlay 复用现有证据化压缩演化，只在相关情境中细微影响主模型判断。
- 新增可选 SnowLuma 私聊语音转写：QQ `record` 语音通过 `fetch_ptt_text` 与当前文字、图片合并为一个用户事件；不支持、缓存缺失或失败时安全降级且不保存音频二进制。
- 启动流程改为 `interlude.doctor` 检查 Console 档案，再由 `interlude.story.start` 确认启动；`interlude.init` 保留兼容别名。

## 0.1.3-beta2-enhanced

- 修复主叙事返回合法 JSON 但 `script` 缺失、为空或只含空白时被当作成功的问题。
- 真实模型回合遇到空剧本会保留原故事游标；用户消息改走既有的持久化自动重试，后台回合留待下一次调度重新写作。
- 提高默认场景压缩阈值：未压缩条目由 `12` 调整为 `16`，字符数由 `8000` 调整为 `10000`，减少短对话期间的后台压缩调用。
- 补充空剧本语义完整性和新压缩默认值的回归测试。

## 0.1.3-beta1

- 新增轻量 Agency Window：只保存日程负荷、隐私、设备可用性、有效期和真实剧本来源，不与 Alter 情绪状态混合。
- 自动推进先写主角生活，再判断是否由生活事件、承诺、实际安排或关系后续产生联系理由；用户沉默本身不能触发。
- 新增 `proactiveContact` 的立即联系、稍后重查和自然放下三种结果。
- 复用 `interlude_intent` 保存 `proactive-check`，不新增数据表、不预写未来消息；到期后结合新的生活重新裁决。
- 增加候选来源验证、白名单验证、有效期、去重、普通联系安全间隔、承诺绕过和容量矩阵。
- 后台 Agency 请求现在会携带参与者名称、资料和关系摘要；修复旧版本即使开启 `shareParticipantDetails` 仍只传 opaque ID 的问题。
- 主动联系发送仍受 `allowProactiveMessages`、willingness 门槛、跨账号动作上限、白名单和实际适配器投递边界约束。
- Agency 与 Alter 从状态、提示词和压缩 payload 中隔离；Agency 不读取 Alter，也不影响文风。
- 新增主体节奏日志、Console 四项配置、状态命令和 Agency 回归测试。

## 0.1.2

- 统一恢复数据库 timestamp 字段，兼容重载后驱动返回 ISO 字符串的情况。
- 主提示词新增权威本地时间端点：日期、时分秒、星期、时段、UTC 偏移、日照预期、时间跨度和 continuity 年龄。
- 明确当前 `nowLocal` 优先于旧剧本和旧 continuity 中的“夜晚”等环境描述；例如上海 16:00 默认是仍有日光的下午。
- 私聊固定先静默合并 2 秒；移除固定的 stale request 时间窗口。
- 只要首条回复尚未提交，新消息就废弃旧模型结果，并把旧消息批次重新并入替代写作。
- 首条消息提交后，新消息会取消尚未发送的 `<sep/>` 后续气泡；未完成文本作为 `interruptedOutgoingDrafts` 明确送入下一次主提示词，但绝不视为已经说出口。
- 分段消息改为适配器发送成功后再写入可见剧本和完成意图；发送失败保留并延后重试。
- 所有 HDSI 数据库读取统一经过日期规范化与有限重试，移除绕过服务边界的直接查询。
- 到期意图在数据库层按 `notBefore` 过滤；分段唤醒直接查询最早 split-message，避免扫描全部 pending 意图或因 limit 截断漏掉分段。
- 取消消息按参与者缩小查询范围；普通私聊投递复用已加载的当前参与者，减少重复数据库读取。
- 抽离 `time.ts` 并缓存每个时区的 `Intl.DateTimeFormat`，避免每轮重复构造高成本 formatter。
- 主系统提示词只携带当前 phase 的写作策略，不再把用户消息、自动推进、对话后续和到期意图四套阶段说明同时发送，减少固定 token 与规则干扰。
- 修复群聊读取失败路径引用未赋值 story 的异常，并补充根目录与插件目录的统一 typecheck/test 命令。
- 类型检查正式启用未使用局部变量和参数检查，清理旧 JSON 提取器、废弃条目校验和未使用时间窗口函数。
- 依赖 overrides 固定 `js-yaml>=4.3.1` 与 `nanoid>=3.3.18`，消除两项可兼容修复的高风险依赖告警；Puppeteer/Vite 的上游告警记录为已知限制。

## 0.1.2-beta10-reimagine

- 将 Alter 的纯状态逻辑从 `service.ts` 抽离到 `alter.ts`，统一默认值、旧状态迁移、动态阈值、权重和完成规则。
- Alter 达到阈值后改为后台串行分析：本轮先完成持久化和可见消息，不再被侧端模型延迟。
- 增加同故事分析任务合并和五分钟失败冷却；保持累计值不丢失。
- 增加唯一运行时版本常量，并同步网页 User-Agent、启动日志、manifest、锁文件和发布包。
- Console 按真实配置流程重新排序为九个编号分区，移除无效的 `sharedStory.enabled` 和 `pauseAfterConversationMinutes` 控件，修正群聊与 OneBot 空白名单说明。
- 从活动 `src/` 移走回滚快照、`.broken` 和旧备份；本地历史快照位于 `dustbin/documentation-history/history/source-snapshots/`，不参与提交或发布。
- 删除失效的“关系态势卡 / Scene Trace”当前文档描述，统一当前架构、配置指南和新手引导。
- 扩展 Alter 回归测试，覆盖触发完成、旧状态迁移和权重投影。
- 增加统一 `npm test` 入口；根私有工作区不再将 `.env` 和 `koishi.yml` 列为可打包文件，防止误操作泄露实例凭据。
- 新增默认 `layered` 彩色任务时间线、固定颜文字和简洁符号模式；标准档聚焦接收、模型、投递、实际推进、记忆与 Alter，内部扫描和重试细节下沉到 diagnostic。
- 新增 `logging.colorTheme`：dark 使用深色 Console 的柔亮高对比调色板，light 使用明亮界面的深色高对比调色板。
- 当前开发实例同步使用 `info + standard + layered`，并默认关闭消息、剧本正文预览。
- 当前目录只保留 beta10 包、现行源码、文档和测试；旧 release、解压副本、截图、历史报告、源码快照、旧提案和构建信息迁入本地忽略的 `dustbin/`。

## 0.1.2-beta9

真实基线：`0.1.1-beta6` 的 recentScript + continuitySnapshot 架构。

- 保留回滚后完成的共享主剧本、OneBot 白名单、群聊直达主叙事、日志分层、图片、浏览器、Embedding、剧情余波和 Overlay 压缩。
- 群聊不再调用独立快速筛选模型；`mention-only` 在消息入口过滤，`always` 直接进入主叙事。
- 新增完整 Alter System：单维度评分、动态阈值、方向权重、强度、独立侧端分析、失败保留和结构化注入。
- 清除主模型 payload 中的 Alter 内部累计和历史。
- 归档第一次失败的 Alter 自动补丁和不实完成报告。
- 删除回滚后已经失效的 Beta7 测试，建立当前 Alter 与提示词边界测试。
- 统一 package、锁文件、README、构建产物和发布包版本。

## 0.1.2-beta8-rollback

- 手工恢复 `0.1.1-beta6` 的自然语言原文连续性主干。
- 放弃 Beta7 到 0.1.2-beta7 期间过度结构化的 sceneState、sceneTrace、storyHook、logicalTurn 和 relationshipMoment 路线。
- 详细失败分析已移入本地 `dustbin/documentation-history/beta8-rollback/`，不参与当前发布。

## 0.1.2-beta7 及更早

旧发布包和历史目录保留完整版本样本。它们仅用于回溯，不代表当前代码。


