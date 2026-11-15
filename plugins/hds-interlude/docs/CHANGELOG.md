# 更新记录

## 1.0.1-rc60（2026-11-15，Console 界面重构 + 主动联系统一架构 + 全功能实机验证）

### Console 界面重构

- 专属工作台使用 Koishi 标准布局，修正侧栏遮挡、超大图标、导航和表单间距、暗色主题对比度及窄屏表格溢出。
- 配置中心全部 25 个可见节开放，修复 null 菜单请求，补齐搜索、保存本节、保存并重载、重新读取和未保存修改提醒；主提示词支持标量表单。
- 完整开放配置时补齐数组内密钥脱敏、按连接 ID 保留密钥、列表字段重置、嵌套删除和校验失败无副作用的保存边界。
- 上下文设置前置，QQ 合并转发独立折叠；区分新故事默认档案与当前故事。修正 Agency、Urge、Jev 和分隔符说明。
- 提示图标在松开、离开、失焦、滚动或 Escape 后关闭；修复通信详情乱序、管理操作反馈和对概览接口的多余依赖。
- 概览按数据库聚合统计条目数，按故事时区展示剧情时间，直接读取结构化模型路由；预算页读取实际锚点和两类会话配置。
- **修复**：通信动作取消/核实按钮的服务端 RPC 接线遗漏（authority=3）；Console 连接未就绪时 ConfigPage/ActionsPage 的 null 结果守卫；操作反馈补齐 already-* 幂等原因码。
- 完整缺陷清单与验证记录见 [Console 界面修复记录](development/CONSOLE_UI_REPAIR_2026-11-15.md)。

### 主动联系统一架构（P1–P5 完整交付）

自 rc59-preview.1 起实施、rc60 正式收敛。设计文档：[PROACTIVE_ACTION_UNIFICATION_DESIGN.md](PROACTIVE_ACTION_UNIFICATION_DESIGN.md)。

**核心变更**：
- **统一作者动作**：主叙事以 CONTACT ACTIONS 契约（`<say>` 原文标记 + communicationActions 目标/时机）表达全部出站动作，替代旧意愿数值/容量裁决/联系温度三模式。`future` 进入 contact-plan 人物计划，`fixed-delay` 保持确定延迟。
- **统一投递策略**（`deliveryPolicy` 配置节）：可选每目标滚动 24h 上限、最短运行间隔、延期有效期。P3 起强制执行（显式配置优先，全默认按旧 Agency 实际生效限制保守派生）。总开关、白名单和端点权限继续作为前提。
- **Urge 收敛为生活推进调度**：联系意愿值、burst、armed/spent、contactMin 等联系专用参数退役；保留节奏五档×密度乘法模型、slow 分支、休息窗口兜底。
- **投递账本**：分段增加 `unknown` 待核实态（超时/断线时保守不重发）；迟到成功回执可升级，人工可核实/取消。额度由投递账本派生（重启可重建）。
- **Console 通信动作页**：只读列表（游标分页）+ 详情 + 取消计划/未执行分段 + unknown 人工核实。
- **结构化日志**：action-policy/delivery-result/contact-plan 全生命周期事件，持久化后发出、幂等零新增。
- **管理命令**：`interlude.policy`（有效策略/旧链对照）、`interlude.policy.migrate`（旧 proactive-check 迁移）、`interlude.actions`（只读列表）。
- **桌面桥**：能力位 `communication-actions-v1` + `actions-list` 命令。

**清理退役**：
- Agency 数值裁决（容量否决/意愿阈值/日上限预记/合成候选豁免/单候选过滤/重查排期）
- 解析层意愿门（advance 即时行动不再因 willingness 丢弃）
- `proactiveContactLog` 写入（额度改由投递账本派生）
- `proactiveWillingnessThreshold`（runtime/urge 双处，已隐藏并标注弃用）
- urge 联系加速参数（hot/burst/jitter/extremeChance/contactMin，Schema 已删）

**验证**：
- 全功能实机测试 70 项清单全部通过（`development/FULL_FEATURE_TEST_PLAN_2026-11-15.md`）
- 真实模型（claude-haiku-5-5 + claude 特化）：JSON 合规 100%、say 绑定 100%、目标选择 100%、时间遵循 100%、directed 采集 100%/0 误报
- OneBot 11 协议仿真覆盖离线补拉/聊天动作/桌面桥/限流全链路
- 全量测试 1334 项，1330 通过、4 真实 API 跳过、0 失败

### 此前增量（rc58 → rc59-preview.1）

#### 全量审查修复 F01–F13（2026-11-12/13，三轮）

独立跟踪文档见 [FULL_AUDIT_REPAIR_2026-11-12.md](development/FULL_AUDIT_REPAIR_2026-11-12.md)。

- **F01** Console 使用宿主支持的模块导出，登记 CSS 资源。
- **F02** 即时群回复及伴随平台动作统一任务/内容代次检查。
- **F03** 资料案头、到期考据队列与在途检索遵循故事清理生命周期。
- **F04** `interlude_qzone_post` 与 `interlude_work` 纳入清理，全局表情资产保留契约。
- **F05** 清理兜底按已有 model 主键构造，逐表合法载荷，单行失败跳过。
- **F06** 天气事件消费与模型播种开关分开。
- **F07** 天气请求核验代次，去重绑定故事/地点和有效事件。
- **F08** 离线补拉通过端点/账号解析 Bot。
- **F09** 离线补拉复用定向采集策略。
- **F10** 相同生活节奏评估刷新 assessedAt 与依据。
- **F11** 群聊与私聊防抖同时计算静默窗口和最大等待。
- **F12** 完整性标记覆盖正文截断和查询截断。
- **F13** 两套配置页表单读写绑定 section/请求序号。
- 后续补齐：补拉水位 `groupIdStorageVariants` 兼容、清理 SET 容错、天气预算来源隔离、群回合暂停搁浅修复。

#### 实验性功能（自 rc58 起）

- **表情包采集**（实验性）：他人发送的表情图片即时暂存、周期判定去留。
- **考据 Agent**（实验性）：她说"我去查查"→ 后台检索核实 → 资料案头供作者参考。
- **密度自适应条目预算**（auto 模式）：按对话密度在四档条目数间切换。
- **HDSI 专属 Console 界面**：概览/配置中心/通信动作/考据案头/密度五页。

#### 主要缺陷修复（rc58 遗留）

- `[P1] interlude_fact.sourceChannel` 未声明数据库列——压缩蒸馏会无限失败。补列 + 旧库迁移。
- `[P2] 中文错误文案废掉重试正则`——侧任务非法 JSON 恢复匹配。
- `[P2] 有效期先于在场提名判断`——TTL 移入缺席分支。
- `[P2] frozenMaxEntryId=0 语义反转` + 群触发水位竞态。
- `[P2] 启动迁移嵌套重启`——函数首语句补 await 边界。

