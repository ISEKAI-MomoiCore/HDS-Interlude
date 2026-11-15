# HDS Interlude 插件升级与顺序执行计划

- 文档版本：v1.0
- 编制日期：2026-10-01
- 适用仓库：`C:\dev\HDS-Interlude\plugins\hds-interlude`
- 当前发布候选：`1.0.1-rc33`
- 当前目标：整理源码、运行时、渠道能力、文档与发行包之间的差异，并按依赖关系推进下一轮开发。

> 本文是面向开发执行的升级计划，不是功能愿景文档。判断“已实现 / 部分实现 / 未实现”时，以当前 `src/`、`test/`、`package.json`、发行脚本和现有文档交叉核对结果为准。

---

## 1. 总体判断

当前 HDS Interlude 的核心叙事内核已经成型：

- 持久化剧本与主角连续性已经存在；
- 事实、关系、场景、生活状态和投递账本已经进入主循环；
- Agency Window、Alter、Schedule Preplan、Forward Message Reading、Group Willingness 已有实际代码和测试；
- 多端点注册、单剧本多渠道、回合来源追踪和基础通道上下文已经落地；
- World Event Seeder 已经超过旧文档所描述的完成度。

当前真正需要继续推进的不是叙事内核重写，而是以下四类工程工作：

1. 多渠道 M4 仍需要真实双 QQ / connector 运行环境验收；
2. 微信仍然只有渠道标签和外部 POC 设计，没有正式适配层；
3. Offline Attention 仍是纯设计，尚未形成离线消息与未读回放机制；
4. World Seeder 剩余 M3、V2 历史质量夹具等非阻塞项需要单独收束。

### 1.1 当前验证基线

本次审查得到的基线：

```text
TypeScript 严格检查：通过，0 个错误
全量测试：524 项
通过：520
失败：0
跳过：4
```

发行检查已完成：Yarn 4 Yakumo build、bundle 新鲜度检查、全量测试与 Yarn 4 tgz 打包均通过。

因此当前状态应表述为：

```text
源码、构建产物和发行包已同步；rc31 仍等待维护者执行真实运行环境验收。
```

---

## 2. 范围说明

### 2.1 本计划包含

- 发布卫生和源码/构建产物同步；
- 多渠道 M3 EndpointState 与投递门控；
- 多渠道 M4 的真实链路验收；
- 微信渠道 POC 与正式接入准备；
- Offline Attention 分阶段实现；
- World Event Seeder 文档和剩余工程同步；
- QZone、Schedule Preplan、表情包发送修复等工作区增量的发布整理；
- V2 历史验收项的归档与分级。

### 2.2 暂不纳入本计划

#### SharedWorks / 共同创作

以下功能属于当时从 cev 仓迁入的测试性功能，暂时不作为本轮 HDSI 插件升级目标：

```text
src/works.ts
src/specialization.ts
interlude_work
SharedWorks narrator/service 接线
共同作品命令
共同创作主体性闭环
```

当前处理原则：

- 保留现有模块、数据表和纯模块测试；
- 不继续扩展 SharedWorks 的业务入口；
- 不把它作为本轮发布阻塞项；
- 在文档中标记为“实验性模块，暂缓接线”；
- 后续如重新启动，应单独建立 SharedWorks 里程碑，不与渠道和注意力系统混做。

这意味着本计划不会把 SharedWorks 纳入优先级排序，也不会因为它未接入 narrator 而阻塞 rc31 或后续稳定版。

---

## 3. 发现的问题总表

| 编号 | 设计/工程 | 当前状态 | 主要证据 | 结论 | 优先级 |
|---|---|---|---|---|---|
| R-01 | `src` → `lib` 构建同步 | 已完成 | Yakumo build + `ensure-fresh-bundle.mjs` | 当前构建产物可追踪 | 已完成 |
| R-02 | rc28 / rc29 发布边界 | 已整理 | `package.json`、`docs/CHANGELOG.md`、`release-local/` | rc29 候选与历史 rc28 分离 | 已完成 |
| R-03 | 发行包文档收录 | 已完成 | `npm pack --dry-run` | 当前文档可在包内打开 | 已完成 |
| R-04 | EndpointState 持久化 | 已完成 | `database.ts`、重启测试 | 诊断快照持久化且不恢复旧在线事实 | 已完成 |
| R-05 | `isEndpointDeliverable()` 出站门控 | 已接入 | `service.ts` 统一出站链 | 端点状态成为投递安全门 | 已完成 |
| R-06 | `isEndpointInitiateAllowed()` 主动联系门控 | 已接入 | Agency 主动联系链 | 主动联系遵守 endpoint 状态 | 已完成 |
| R-07 | Endpoint 失败分类与熔断 | 已完成（代码层） | 标准错误与 delivery gate 测试 | 故障可分类并更新状态 | 已完成 |
| R-08 | typ0 endpoint health surface | 已完成（代码层） | `endpoint-health` bridge capability | 桌面端可读取只读健康投影 | 已完成 |
| R-09 | 多渠道 M4 实机闭环 | 代码完成，实机待验收 | 定向回归 + 全量测试；双 QQ 尚未执行 | 运行环境验收由维护者最后执行 | P1 |
| R-10 | 微信正式渠道 | 未实现 | 无 `src/wechat/`，POC 未完成 | 当前只能称为 wechat 标签预置 | P1 |
| R-11 | Offline Attention | 未实现 | `OFFLINE_ATTENTION_EXPERIMENT.md` 明确未实现 | 需要独立 AG-M0~M3 | P1 |
| R-12 | World Seeder M3 | 部分完成 | due drain、去重已实现；`wakeEligible` 无代码 | 文档落后，剩余功能需拆开 | P1 |
| R-13 | QZone Feed | 已纳入 rc29 候选 | 源码、测试、发行文档已同步 | 等待最终运行环境验收 | 已完成 |
| R-14 | Schedule Preplan 当天例外 | 已纳入 rc29 候选 | 源码、测试、发行文档已同步 | 等待最终运行环境验收 | 已完成 |
| R-15 | 本地表情包发送修复 | 已纳入 rc29 候选 | 源码、测试、发行文档已同步 | 等待最终运行环境验收 | 已完成 |
| R-16 | V2 历史验收夹具 | 未完成但非功能阻塞 | V2 实施文档中的未勾选验收项 | 归入质量验证，不阻塞核心开发 | P2 |
| R-17 | SharedWorks | 暂缓 | cev 测试性功能已迁入但未接线 | 本计划明确排除 | 暂缓 |

---

## 4. 具体审查结论

## 4.1 发布卫生：已完成

已完成：

1. 根仓库执行 `npx yakumo build`；
2. 确认 `lib/index.js` 晚于全部 `src/**/*.ts`；
3. 执行 `scripts/ensure-fresh-bundle.mjs`；
4. 通过严格类型检查与全量测试；
5. 通过 `npm pack --dry-run --json`；
6. 整理 rc28 历史正式包与 rc29 工作区/候选包；
7. 将当前主体性、Offline Attention、development 文档纳入发行包。

当前候选版本：`1.0.1-rc30`。历史 `release/koishi-plugin-hds-interlude-1.0.1-rc30.tgz` 未覆盖。

## 4.2 多渠道 M3：EndpointState / Delivery Gate 已完成（代码层）

已完成：

- EndpointState 持久化快照；
- 启动时强制重新确认在线事实，不恢复旧连接为 online；
- 统一 endpoint target resolver；
- 即时私聊、即时群聊、延迟消息、分段消息统一遵守 delivery gate；
- Agency 主动联系遵守 initiate gate；
- enabled / online / TTL / cooldown / deliverable 检查；
- explicit endpoint 禁止 fallback；
- bot 缺失、transport failure、endpoint offline 等标准失败分类；
- desktop bridge `endpoint-health` 只读投影。

代码层验证已通过；真实 connector、重连、平台拒绝和跨端点运行环境验收留待维护者最后执行。

## 4.3 多渠道 M4：代码级链路验证已完成，实机验收延期

已通过代码与测试验证：

1. 双角色 endpoint 路由基础；
2. 同一参与者多用户 endpoint 路由基础；
3. 私聊/群聊默认 live session 观察；
4. 同批多端点 `sources` / `activeSources` 合并；
5. 来源 endpoint 与回复 endpoint 不一致；
6. 延迟/分段消息恢复指定 `endpointId`；
7. offline/cooldown 失败分类；
8. 单端点旧路径兼容。

双 QQ 角色端点交替发言、私聊/群聊切换、断线重连、平台拒绝等运行环境验收本轮不自动执行，统一留给维护者最后验收。

## 4.4 微信渠道：先做 POC，再接主仓

相关文档：

```text
C:\dev\HDS-Interlude\plugins\hds-interlude\docs\WECHAT_CHANNEL_PLAN.md
C:\dev\onebots-wechat-poc\
```

正式接入前必须完成：

1. 入站文本；
2. 出站文本；
3. 多轮 `context_token`；
4. 长时间无输入主动投递；
5. token 失效；
6. 账号、自身 ID、HDSI endpoint ID、token 状态四元组绑定；
7. 失败原因分类；
8. 与统一 endpoint delivery gate 对接。

当前 `channelKind: 'wechat'` 只能作为注册表标签，不能在用户文档中写成“微信已支持”。

---

## 4.5 Offline Attention：按 AG-M0~M3 实现

设计文档：

```text
C:\dev\HDS-Interlude\plugins\hds-interlude\docs\OFFLINE_ATTENTION_EXPERIMENT.md
```

### AG-M0：状态机和持久化

实现：

```text
attention mode
attentionAfter
lastAttendedAt
unread ledger
```

首先只解决“消息是否进入当前回合”的问题。

### AG-M1：离线消息分流

规则：

```text
用户不在场 / attention 状态不允许直接呈现
→ 消息进入 unread ledger
→ 不自动改写当前叙事回合
```

### AG-M2：锁屏摘要与 phoneCheck

实现：

```text
摘要不泄露完整内容
phoneCheck 查看可见摘要
用户确认后启动回放回合
```

### AG-M3：ring-only 和轰炸唤醒

最后实现：

- 仅响铃；
- 多条消息聚合；
- 轰炸式唤醒；
- typ0 桌面展示；
- 离线注意力状态诊断。

不建议从 UI 反推数据结构，应先完成状态机、账本和回放回合。

---

## 4.6 World Event Seeder：源码领先文档，需要拆分状态

相关文件：

```text
C:\dev\HDS-Interlude\plugins\hds-interlude\src\world-seeder.ts
C:\dev\HDS-Interlude\plugins\hds-interlude\src\service.ts
C:\dev\HDS-Interlude\plugins\hds-interlude\src\database.ts
C:\dev\HDS-Interlude\plugins\hds-interlude\docs\WORLD_EVENT_SEEDER_DESIGN.md
```

### 已完成

- 定时 sweep；
- 生成模型调用；
- blocked names；
- 事件 schema 校验；
- Jaccard 语义去重；
- scheduled/injected/expired 状态；
- due drain；
- `world-event` 剧本条目；
- 自动推进回合中的事件注入；
- 排期事件参与去重窗口；
- 单轮、高重要性和每日限额；
- 世界事件不再反馈进普通生活摘录。

### 未完成或未确认

- `wakeEligible` 没有进入类型、数据库和运行时；
- 世界事件独立唤起 advance 的语义没有单独实现；
- typ0 时间线没有专门的世界事件状态徽标；
- 重要世界事件没有独立自动落 fact 的明确链路；
- 缺少专门的端到端世界事件测试。

建议把原文改成以下状态：

```text
M1：完成
M2：完成
M3-A：事件排水与语义去重，完成
M3-B：wakeEligible 独立唤醒，未完成
M3-C：桌面时间线徽标，未完成
M3-D：重要事件自动事实化，未完成
```

---

## 4.7 QZone、Schedule Preplan、表情包修复：作为 rc29 发布整理项

以下工程源码和测试基本就位，但还没有完成正式发布同步：

```text
QQ 空间评论感知
Schedule Preplan 当天例外收束
本地表情包 HTTP 回源发送
assetId 碰撞修复
历史重复资产行自愈
```

它们不应该继续作为“未来设计”留在 changelog 顶部，而应在 rc29 发布时：

1. 重新构建；
2. 重新打包；
3. 做安装包验收；
4. 更新正式版本说明；
5. 把工作区条目移入 rc29 发布区。

---

## 5. 顺序执行表

以下顺序按照依赖关系排序，不建议跳过前置项。

| 阶段 | 任务 | 主要文件/模块 | 前置条件 | 预计结果 | 完成门槛 |
|---|---|---|---|---|---|
| 0 | 建立开发基线 | 根仓库、`package.json`、`lib/`、`release-local/` | 无 | 明确当前源码和包状态 | 记录测试、构建、包 hash；确认无未记录本地改动 |
| 1 | 修复 `src → lib` 同步 | `scripts/ensure-fresh-bundle.mjs`、`lib/` | 阶段 0 | 构建产物可追踪 | `ensure-fresh-bundle.mjs` 通过 |
| 2 | 整理 rc28/rc29 边界 | `package.json`、`docs/CHANGELOG.md`、`release/` | 阶段 1 | 正式版与工作区分离 | rc28 不含工作区增量；rc29 清单明确 |
| 3 | 修复发行文档收录 | `package.json`、`docs/README.md` | 阶段 2 | 包内文档完整 | 两个主体性/Offline 文档可在包内打开 |
| 4 | 重新生成 rc29 工作区包 | `lib/`、`release-local/` | 阶段 1~3 | 本地安装包与源码一致 | 从 tgz 安装后版本、导出和关键行为一致 |
| 5 | EndpointState 持久化快照 | `database.ts`、`endpoints.ts`、`service.ts` | 阶段 1 | 端点健康状态可恢复和诊断 | 重启测试通过；旧库自动升级通过 |
| 6 | 统一 delivery target resolver | `service.ts`、`endpoints.ts` | 阶段 5 | 所有出站路径使用同一目标解析 | 即时、延迟、分段、群聊、Agency 均走统一 resolver |
| 7 | 接入 deliverable/initiate gate | `service.ts` | 阶段 6 | EndpointState 成为真实安全门 | 离线、过期、cooldown、主动联系拒绝均有测试 |
| 8 | 标准化 endpoint 失败审计 | `types.ts`、`story-state.ts`、`service.ts` | 阶段 7 | 故障原因可分类、可追踪 | 每种失败原因都有状态更新和审计记录 |
| 9 | typ0 endpoint health projection | `desktop-bridge.ts`、`service.ts` | 阶段 8 | 桌面端可解释端点状态 | snapshot/timeline 或新 health 命令可展示端点状态 |
| 10 | 多渠道 M4 双 QQ 实机验收 | 双 QQ 端点、测试夹具 | 阶段 7~9 | 多端点语义闭环 | 8 项 M4 验收全部通过 |
| 11 | 更新多渠道文档状态 | `MULTI_CHANNEL_SINGLE_STORY_DESIGN.md`、`MULTI_CHANNEL_IMPLEMENTATION_ROADMAP.md` | 阶段 10 | 文档与运行时一致 | 每一项标记完成/部分完成/待实现 |
| 12 | 微信 POC 入站/出站 | `C:\dev\onebots-wechat-poc\` | 阶段 7 | 外部渠道能完成最小消息闭环 | 文本收发、重连、错误分类通过 |
| 13 | 微信 context_token 与主动投递验证 | POC、endpoint 测试 | 阶段 12 | 证明微信适合进入 HDSI | 多轮 token、长时间无输入主动投递通过 |
| 14 | 微信正式 endpoint 适配 | 主仓渠道适配层、`service.ts` | 阶段 13 | 微信进入统一多渠道链路 | 不绕过 delivery gate；四元组可审计 |
| 15 | Offline Attention AG-M0 | 新状态/数据库/纯函数 | 阶段 1 | 注意力状态可持久化 | 状态迁移、重启、过期测试通过 |
| 16 | Offline Attention AG-M1 | 入站分流、unread ledger | 阶段 15 | 离线消息不直接污染当前回合 | 分流与重复投递测试通过 |
| 17 | Offline Attention AG-M2 | 摘要、phoneCheck、回放 | 阶段 16 | 用户可以主动查看并回放 | 两步回放回合完整可测 |
| 18 | Offline Attention AG-M3 | ring-only、轰炸、typ0 UI | 阶段 17 | 完整注意力体验 | UI、宿主、叙事回合端到端通过 |
| 19 | World Seeder 文档和剩余 M3 | `world-seeder.ts`、`service.ts`、desktop projection | 阶段 1~4 | 文档与源码一致 | wake/UI/fact 缺口被明确实现或延期 |
| 20 | rc29 发布验收 | 全仓、发行包、安装实例 | 阶段 4、11、14 可选、19 | 形成可安装稳定包 | 构建、类型、509+ 测试、tgz 安装、实机冒烟全部通过 |
| 21 | V2 历史质量验证 | 回放夹具、盲评、连续场景测试 | rc29 稳定后 | 评估叙事质量而非阻塞功能 | 作为独立质量报告，不反向污染主线 |

---

## 6. 推荐的近期开发批次

### 批次 A：发布卫生（已完成，形成 rc29 候选）

目标：让当前代码能够被可靠打包。

```text
1. Yakumo build
2. ensure-fresh-bundle
3. typecheck
4. 全量测试
5. 修正 package.files
6. 重新生成 release-local
```

这批完成之前，不建议继续累积新的大功能。

### 批次 B：Endpoint Delivery Gate（已完成，代码层）

目标：让多渠道从“注册表模型”升级为“运行时安全系统”。

```text
1. 状态快照
2. 统一 resolver
3. deliverable gate
4. initiate gate
5. 失败分类
6. 桌面健康投影
7. 服务级测试
```

这是下一轮最应该优先实施的主线。

### 批次 C：双 QQ 多端点实机验收（延期至维护者最后执行）

微信尚未接入前，先用已有 QQ 端点验证：

- 两个角色端点；
- 一个参与者多个用户端点；
- 私聊/群聊切换；
- endpoint cooldown；
- 最后来源端点路由；
- 主动联系拒绝；
- bridge 状态显示。

这样可以在没有微信外部依赖的情况下完成 M3/M4 大部分验收。

### 批次 D：微信 POC

只有批次 B 完成后才开始把微信引入主链路。

### 批次 E：Offline Attention

Offline Attention 应独立于微信完成 AG-M0/AG-M1。这样即使微信延期，HDSI 的离线注意力模型也能先用桌面端或现有 QQ 通道验证。

### 批次 F：发布 rc29 候选

当前 rc29 候选已包含：

- 当前已完成的 QZone 增量；
- Schedule Preplan 当天例外；
- 表情包 HTTP 回源修复；
- Endpoint Delivery Gate；
- 完整构建产物；
- 同步后的文档和实现状态矩阵。

SharedWorks 不纳入 rc29 的稳定功能承诺。

---

## 7. 每个阶段的统一完成标准

每个功能不能只以“代码写完”作为完成，而应同时满足：

### 代码层

- 主链路已接入；
- 没有只存在于纯模块的孤立函数；
- 失败路径有明确处理；
- 重启和旧数据库兼容。

### 测试层

- 纯函数测试；
- 数据库升级测试；
- 服务级测试；
- 并发/重复/失败测试；
- 至少一个端到端或实机冒烟场景。

### 文档层

- 文档状态与源码一致；
- 已实现、部分实现、未实现明确区分；
- 不把测试性功能写成正式产品能力；
- 发布包中确实包含被索引的关键文档。

### 发布层

- `src` 与 `lib` 同步；
- 构建脚本通过；
- 全量测试通过；
- tgz 可安装；
- 安装后导出版本和关键行为正确；
- 正式版本与工作区增量分离。

---

## 8. 不建议现在做的事情

### 8.1 不要先做微信 UI

在 Endpoint Delivery Gate 尚未完成前，微信 UI 只会把未解决的端点状态问题隐藏起来。

### 8.2 不要继续堆叠通道提示词

M4 当前主要问题是运行时闭环和实机验收，不是缺少更多 CHANNELS 文案。

### 8.3 不要把 SharedWorks 混入主线

SharedWorks 是 cev 迁入的测试性功能，暂时保留即可，不应与 Endpoint、微信、Offline Attention 共用一个发布里程碑。

### 8.4 不要用历史 V2 checklist 阻塞功能开发

回放夹具和人工盲评很有价值，但应该在 rc29 主链稳定后作为独立质量批次执行。

---

## 9. 最终执行顺序

压缩为一条主线：

```text
发布卫生
  ↓
EndpointState 持久化
  ↓
统一出站/主动联系门控
  ↓
失败分类与桌面 health projection
  ↓
双 QQ 多端点实机验收
  ↓
微信 POC
  ↓
微信正式 endpoint 接入
  ↓
Offline Attention AG-M0
  ↓
Offline Attention AG-M1/M2/M3
  ↓
World Seeder 剩余 M3 与文档修订
  ↓
rc29 候选安装与维护者实机验收
  ↓
rc29 稳定发布
  ↓
V2 历史质量验证
```

其中 SharedWorks 保持独立、暂缓，不进入这条主线。

---

## 10. 一句话结论

HDSI 当前最需要的不是继续扩展新的叙事概念，而是先把已经写好的多渠道设计变成真正的运行时安全闭环，再把发布产物、文档状态和实机验证补齐；微信和 Offline Attention 应在此基础上分阶段推进，SharedWorks 则暂时保持为 cev 迁入的实验模块。

