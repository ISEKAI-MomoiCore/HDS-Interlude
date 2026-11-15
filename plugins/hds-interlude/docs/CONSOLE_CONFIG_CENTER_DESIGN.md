# HDSI Console 配置中心设计（分级导航整合）

状态：**2026-11-15 当前工作区已完成全部 25 个可见配置节的 Schema 表单与保存接线（未发布）**。支持菜单搜索、保存本节、保存并重载、重新读取、密钥掩码与未保存修改提醒。当前故事独立保存到故事数据库。验证与修复清单见 [Console 界面修复记录](development/CONSOLE_UI_REPAIR_2026-11-15.md)。

以下保留原分阶段设计及 2026-10-29 的背景分析；阶段计划与历史数量以本段当前状态为准。隐藏兼容节 `chatRhythm` 保持隐藏，其余节以 `Config.dict` 和菜单一致性测试为准。

> 一句话定位：把 HDSI 自定义 Console 从"三节表单 + 两张只读卡"升级为**覆盖全部配置项的分级配置中心**——菜单分级只做导航组织，不引入任何"全局 → 故事 → 群"的取值覆盖机制；index.ts 的 Config Schema 仍是唯一事实来源，保存统一走 `ctx.scope.update()` 持久化到 koishi.yml 并热生效。

---

## 0. 结论摘要

- **做**：统一配置中心，两级侧栏菜单 + 按节编辑，全部 25 个可见配置节（另含 1 个隐藏兼容节）接入统一配置中心。
- **怎么做**：表单由 Config Schema 自动渲染（复用 `@koishijs/components` 的 `k-schema`，与标准配置页同款）；写入统一 `ctx.scope.update()` → loader 原子写回 koishi.yml；现有"进程内临时生效"语义废弃。
- **已验证**（本仓 koishi 4.18.11 实测，见 §2）：持久化链路、Schema 跨 RPC 序列化往返、渲染组件复用均可行，无阻塞性技术风险。
- **节奏**：四阶段（P1 机制层 → P2 高频运维节 → P3 全量迁移 → P4 引导与搜索）。标准 Koishi 配置页全程保留作兜底，不设废弃时间点。

## 1. 背景与问题

### 1.1 现状：三套写入语义并存

| 入口 | 覆盖范围 | 写入目标 | 生效方式 | 重启后 |
| --- | --- | --- | --- | --- |
| Koishi 标准配置页 | 全部配置（Schema 平铺长表单） | koishi.yml | 插件 dispose + 重载 | 保留 |
| HDSI 自定义页 story 节 | 10 个故事设定键 | 数据库（updateSetting） | 立即 | 保留 |
| HDSI 自定义页 runtime / research 节 | 17 个运行参数键 | 进程内 config 对象 | 下一轮叙事 | **回退到 koishi.yml** |

问题：用户在 HDSI 界面改了参数、重启后悄悄回退，比"配置分散"更伤信任；且同一配置项可能有两个入口改不同副本。

### 1.2 现状：字段清单靠手工同步

自定义页的字段清单手写在 `ConfigPage.vue`（注释自注"键名须与 contract.ts 保持同步"），白名单在 `src/console/contract.ts`。HDSI 共 150+ 配置字段，手写复制不可持续——每加一个字段改两处，漏一处即界面与行为不一致。

### 1.3 用户侧痛点

README 用 10 步顺序指导配置，BEGINNER_GUIDE 与"一条龙"HTML 承担引导职责——说明标准配置页的长表单对非技术用户不友好：找不到字段、不知道下一步、不明白字段间依赖（如"世界播种器需要先在模型中心勾选用途"）。配置中心的价值不只是收纳，更是**把配置顺序和依赖编码进导航结构**。

### 1.4 范围界定（本轮确认）

- ✅ 分级 = **界面导航组织**（菜单树分级呈现）。
- ❌ 不做"全局默认 → 每故事 → 每群/参与者"的取值覆盖机制（理解 B）。群规则数组（`groupChats[]`）本身就是每群覆盖层，维持现状。
- ❌ 不废除标准 Koishi 配置页；两入口写同一份 koishi.yml。

## 2. 已验证的技术基础

以下四项均在本仓（koishi 4.18.11 / cordis / @cordisjs/loader / @koishijs/components 1.5.22）实测确认，非推测：

| # | 事实 | 出处 |
| --- | --- | --- |
| T1 | `EffectScope.update(config, forced?)` 存在且为公开 API（Fork 与 MainScope 均实现） | `@cordisjs/core/src/scope.ts:75`（abstract）、`:286`、`:396` |
| T2 | 插件内调用 `ctx.scope.update(config)` 后，loader 的 `internal/before-update` 钩子会执行 `schema.simplify(config)` → 写入 `entry.options.config` → `parent.tree.write()` **原子写回配置文件**（tmp + rename，`yaml.dump(config, { schema })`）；随后 `loader/config-update` 事件广播 | `@cordisjs/loader/lib/loader.js:740-750`、`:407-409`、`:287` |
| T3 | Schema 可 JSON 序列化跨 RPC 传输并客户端重建：`JSON.parse(JSON.stringify(schema))` 产出 `{uid, refs}` 结构，`new Schema(json)` 完整恢复 dict/meta（含嵌套 object 的 default/description） | 本仓 node 运行时实测；`@cordisjs/schema/lib/index.d.ts:16`（`toJSON(): Schema`） |
| T4 | `@koishijs/client` 转发 `@koishijs/components` 的 `SchemaBase` / `k-schema` 组件——标准配置页的 Schema 表单渲染器，自定义页面可直接使用 | `@koishijs/client/client/components/index.ts:3,32`、`dynamic.vue` |

推论：**保存 = `ctx.scope.update()` 一行调用**，内存热更新与 koishi.yml 持久化由框架完成，与标准配置页走同一机制，无自研写盘逻辑。

## 3. 设计原则

1. **单一事实来源**：字段定义、默认值、值域、描述文案全部来自 `index.ts` 的 Config Schema。菜单树、表单、校验从 Schema 派生；HDSI 侧新增字段只改 Schema 一处。
2. **保存即持久**：所有节统一 `scope.update()` 语义（写盘 + 热生效）。废除"进程内临时生效"；不再存在"重启回退"的配置入口。
3. **分级只做导航**：菜单层级是视图组织，不改变任何配置项的作用域或取值合并规则。
4. **两入口一份数据**：标准配置页继续可用；配置中心与它互为编辑器，读写同一 koishi.yml。
5. **故事运行态与配置分离**：活动故事的设定（DB 内、随剧情演化）与新故事默认档案（koishi.yml 的 `storyDefaults`）在 UI 中明确区分，不因收纳进同一界面而混淆。

## 4. 信息架构：分级菜单

### 4.1 层级结构

```
HDSI Console
├── 概览（现状保留：只读仪表）
├── 配置中心                      ← 本设计新增的统一入口
│   ├── 快速上手                  ← 引导视图（§4.4，P4）
│   │   └── 预设同步 presetSync   ← 快速上手第 0 步（决策 #2）
│   ├── 必填配置
│   │   ├── 故事档案 storyDefaults
│   │   ├── 模型中心 model
│   │   └── QQ 接入 onebot        ← 含三个白名单数组子页（§4.3）
│   ├── 剧本结构
│   │   └── 共享主剧本 sharedStory
│   ├── 剧情节奏
│   │   ├── 运行时 runtime
│   │   ├── Urge 弹性推进 urge
│   │   ├── 日程预排 schedulePreplan
│   │   ├── 时间导演 timelineDirector
│   │   └── Agency 行动窗口 agency
│   ├── 表达能力
│   │   ├── 聊天动作 chatActions
│   │   └── 本地表情包 stickers
│   ├── 内在状态
│   │   ├── 记忆与连续性 memory
│   │   └── Alter 情绪 alterSystem
│   ├── 扩展能力
│   │   ├── 网页观察 browser
│   │   ├── 世界播种器 worldSeeder
│   │   ├── 运行时天气 weather
│   │   ├── 长线叙事催化器 longHorizon
│   │   ├── QQ 空间 qzone
│   │   └── 考据 Agent research
│   └── 维护与诊断
│       ├── 盲区模式 blindMode
│       ├── 日志 logging
│       ├── 模型数据采集 modelCapture
│       └── 主提示词（高级） mainPrompt
├── 考据案头（现状保留）
└── 密度与预算（现状保留）
```

### 4.2 分组依据与现有编号对齐

一级分组直接沿用 Config Schema 描述里既有的编号词汇（`【必填 1-3】/【结构 4】/【节奏 5-9】/【表达 10-11】/【内在 12-13】/【扩展 14-18, 22】/【维护 19-21】`），用户在两套界面之间迁移时词汇连续。`presetSync`（预设同步）作为快速上手第 0 步（决策 #2）；`chatRhythm` 已 hidden，不进菜单。

### 4.3 数组表子页

四个数组型配置需要列表式编辑（k-schema 原生支持 `role('table')`，但白名单/连接表建议专用子页增强）：

| 数组 | 子页交互 | 增强 |
| --- | --- | --- |
| `model.providers[]` | 行卡片列表 | 密钥掩码、用途勾选组、连通性状态角标（读现有健康检查） |
| `onebot.botAccounts[]` | 简易表格 | 启用开关 |
| `onebot.userAccounts[]` | 行卡片 | 关系初始值 textarea |
| `onebot.groupChats[]` | 行卡片 | 群规则全字段（含 `audioAlwaysTriggers`、意愿档位等） |

### 4.4 快速上手视图与搜索

- **快速上手**：按 README 的 10 步配置顺序组织的引导模式，每步一张卡：字段（Schema 渲染）+ 依赖说明（如"世界播种器需先在模型中心勾选用途"）+ 完成状态（由配置值推断，如 `onebot.enabled && botAccounts.length`）。数据来自菜单树 + 每节一个手写的"完成判定"谓词（唯一允许的手写清单，且是新增的引导元数据而非字段复制）。
- **搜索**：字段 `description` + 节名全文索引，输入即跳转到对应节并高亮字段。Schema 描述即索引源，无第二份文案。

## 5. 读取与渲染

### 5.1 RPC 契约（扩展 `src/console/`）

```
hdsi/config-center/read   (authority=1)
  → { ok, schema?, values?, entry?: { id, name }, error? }
    schema：Config Schema 经 toJSON 的 {uid, refs} JSON（T3）
    values：ctx.scope.config 当前值快照

hdsi/config-center/save   (authority=3)
  ← { section, patch }        // patch = 该节的局部值
  → { ok, error? }            // 成功即已写盘并热生效
```

`contract.ts` 的三节白名单保留给旧接口过渡（§7.3），新接口不做键白名单——可编辑范围由菜单树决定，服务端仍拒绝未知 `section`。

### 5.2 客户端渲染

- 传输的 schema JSON 用 `new Schema(json)` 重建（cordis Schema 随 `@koishijs/client` 可用于客户端 bundle，T3/T4）。
- 节表单：`k-schema` 组件绑定 `Schema.object({ [section]: sections[section] })` 的子 schema 与对应 model 值；`role('table')`/`collapse` 等 Schema 指令原生生效。
- 分节懒加载：进入菜单项才 `read` 对应节，避免整树首屏开销（150+ 字段 + 4 数组）。
- 主题适配沿用现有 `client/src` 的 CSS 变量方案；`k-schema` 组件继承 Koishi Console 主题，两套视觉在配置中心内以 Koishi 主题为准（现有零圆角母题保留在概览/案头/密度页）。

### 5.3 现有 store.ts / EditField.vue 的去留

`EditField.vue` 仅在旧三节表单使用；P3 完成后随旧表单一起退役。`store.ts` 扩展 config-center 的 RPC 封装。

## 6. 写入管线

### 6.1 保存流程

```
用户在节内点击保存
  → 客户端本地 model → patch（仅该节）
  → RPC hdsi/config-center/save { section, patch }
  → 服务端：
      1. 以当前 ctx.scope.config 为基线深合并 patch（保存前重读，防两端并发编辑覆盖）
      2. ctx.scope.update(merged)           // T1
         ├─ cordis 热更新 fork 配置（本轮未完成的请求不受影响，新回合读新值）
         └─ loader internal/before-update   // T2
             ├─ schema.simplify(merged)     // 剥离 default 等价值，koishi.yml 只留显式配置
             └─ tree.write()                // 原子写回 koishi.yml
  → 返回 { ok: true }；客户端提示"已保存并生效"
```

### 6.2 语义决策记录

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 保存粒度 | 按节保存 | 减小并发冲突面；与菜单结构一致 |
| 生效方式 | `scope.update` 热更新（dispose/re-apply 由 cordis 按需决定），非手动重载插件 | 与标准配置页同机制（T2 证实同链路）；用户已认知"改配置会重载" |
| simplify 依赖 | 直接依赖 loader 的 `schema.simplify` | koishi.yml 保持"只写显式差异"的既有习惯，diff 干净 |
| 校验失败 | `scope.update` 前先 `Config.value(merged)` 试解析，失败即返回首个字段错误，不落盘 | 表单内 k-schema 已做前端校验，此处为兜底 |
| story 节（DB） | 保留 `updateSetting` 落库路径，不迁 koishi.yml | 活动故事设定是运行态数据（随剧情演化、受 overlay 机制约束），与静态配置本质不同 |

### 6.3 重载窗口的用户反馈

`scope.update` 触发插件重新 apply 期间（通常亚秒级），调度器与串行队列按既有 dispose 逻辑收尾。保存按钮状态机：`保存中 → 已生效`；若 apply 抛错（如模型连接填错不致命，但 schema 级错误可能阻断），错误经 `loader/entry-fork` 事件回流到界面提示，并保留用户 patch 供修正。**危险配置保护**：`blindMode.enabled`、`logging` 级别等影响排障能力的项，保存时弹确认（列出影响）。

## 7. 迁移与兼容

### 7.1 三节旧语义的迁移

- `runtime` / `research` 旧"进程内改 config + 清缓存 getter"实现（`service.ts` 的 config-center 落地点）**整体删除**，统一走 `scope.update`。文档中"重启后回到 koishi.yml 值"的说明全部更新。
- 需要盘点 Service 层缓存 getter 对 `scope.update` 的兼容性：cordis 热更新后 `ctx.config` 引用是否替换、缓存 getter 是否需要订阅更新事件——P1 验收项（见 §9）。

### 7.2 storyDefaults 与 story 节的关系呈现

配置中心"必填配置 → 故事档案"编辑的是 **koishi.yml 的 `storyDefaults`（新故事默认）**；概览页现有的活动故事设定编辑（DB）入口在菜单上独立标注"当前故事"，两处文案明确区分："此后新建的故事"vs"当前运行中的故事"。

### 7.3 旧接口与旧表单的退场

- P1-P2：`contract.ts` 三节接口与 `ConfigPage.vue` 旧表单保持可用（它只覆盖 27 键，与新中心并存无冲突）。
- P3：`ConfigPage.vue` 的 runtime/research 两个 tab 移除（story tab 保留为"当前故事设定"入口）；`EDITABLE_RUNTIME_KEYS`/`EDITABLE_RESEARCH_KEYS` 及其 RPC 实现删除。
- 兼容性测试：`test/console-config.test.ts` 增加新旧接口并存认证，退场后改断言删除。

### 7.4 对外文档

README"Console 配置顺序"章节、CONFIGURATION_GUIDE 开头补"配置中心入口"说明；新人上手一条龙 HTML 的后续版本可直链菜单路径（`/hdsi/config/<section>`）。

## 8. 权限与安全

| 面 | 策略 |
| --- | --- |
| 读 | `hdsi/config-center/read` authority=1（与现状一致） |
| 写 | `hdsi/config-center/save` authority=3（与现状一致） |
| 密钥 | Schema 层 `role('secret')` 由 k-schema 原生掩码；服务端 read 时对已知密钥字段（providers[].apiKey、research.searchApiKey）返回掩码值 + "未修改则不回写"哨兵语义（保存时哨兵值跳过合并） |
| 盲区模式 | 盲区模式只收束 HDSI 聊天侧重载日志与指令，Console 配置中心不受其影响；但 `blindMode.enabled` 的保存确认（§6.3）必须提示"开启后将失去命令行排障手段" |
| 审计 | save RPC 记录操作者与节名（不含值）到 standard 日志，与现有管理命令审计对齐 |

## 9. 分阶段实施计划

### P1 机制层（本设计核心，先行验证）——已实施（2026-10-29）

范围：菜单骨架（两级侧栏 + 分组）｜`config-center/read|save` RPC｜`scope.update` 写入管线｜Schema JSON 传输与 `new Schema` 重建｜k-schema 渲染接入｜先迁移现有 3 节中的 runtime、research 两节（数据结构最简单、无数组无密钥）。

实施落点：`src/console/contract.ts`（菜单树/危险字段/密钥哨兵）、`src/console/config-center.ts`（读取序列化 + `applyConfigSectionPatch` 持久化管线）、`src/console/rpc.ts`（旧接口 runtime/research 改走持久化管线）、`client/src/pages/ConfigCenterPage.vue`（分级菜单 + SchemaBase 渲染）、`test/console-config-center.test.ts`（10 项）。热更新语义补充说明：HDSI 未注册 reactive acceptor，`checkUpdate` 判定 shouldRestart——保存后插件整体重启重建（与标准配置页完全一致），缓存 getter 随新实例天然取新值，§10 风险表第一项由此消解。

验收：
- [ ] Console 内修改 runtime 节任一字段 → koishi.yml 出现该显式值 → **重启 Koishi 后值保留**（回归 1.1 的回退问题）。
- [ ] 标准配置页与配置中心对同一字段先后修改，最终值以后保存者为准，koishi.yml 无双写冲突。
- [ ] `scope.update` 热更新后，`service.ts` 缓存 getter（audioConfig、模型路由等）读到新值——用现有 getter 清理钩子或补订阅。
- [ ] Schema 往返快照测试：`Config` 全树 `new Schema(JSON.parse(JSON.stringify(s)))` 后 dict/meta 与原树一致（防止未来 Schema 特性破坏传输）。

### P2 高频运维节

范围：`onebot`（三白名单数组子页 + 群规则卡片）｜`model`（providers 行卡片：密钥掩码、用途勾选、健康角标）｜`storyDefaults`。

验收：
- [ ] 群白名单子页可完成"加群 → 设响应模式 → 关语音必定触发"全流程，koishi.yml 与标准页编辑结果逐字节等价（simplify 语义一致）。
- [ ] 密钥字段回显为掩码；未触碰的密钥在保存其它字段时不被清空（哨兵测试）。
- [ ] providers 用途勾选与模型中心现有路由逻辑零变化（纯配置面，无服务层改动）。

### P3 全量迁移

范围：其余全部节迁入｜旧 ConfigPage 退场（§7.3）｜文档同步。

验收：菜单树覆盖 Config 全部可见节（快照测试：菜单树 ⊇ Config.dict 键集 − hidden）；旧接口删除后全量测试绿。

### P4 引导与搜索

范围：快速上手视图（10 步卡 + 完成判定谓词）｜字段全文搜索｜一条龙 HTML 链接更新。

验收：新建空配置实例按快速上手走完即可开始对话（与 BEGINNER_GUIDE 等价路径）。

## 10. 风险与对策

| 风险 | 等级 | 对策 |
| --- | --- | --- |
| `scope.update` 热更新对 Service 缓存 getter 的兼容性（cordis 更新 config 引用方式） | 中 | P1 专项盘点 `service.ts` 全部 config 派生 getter；不兼容者改为直接读 `this.config` 或订阅更新；已有 `runtime/research` 进程内写入路径证明部分 getter 可刷新，全部走 scope.update 后行为只会更统一 |
| Schema 新特性（函数型 meta 如 `compute`/`show`）不可 JSON 序列化 | 低 | T3 已验证当前全树可序列化；P1 的往返快照测试持续把守；HDSI Schema 现无函数型字段，约定新增配置不使用函数型 meta（写入 CONTRIBUTING 级约定即可） |
| 保存触发 apply 失败导致插件停摆 | 低 | 保存前 `Config.value` 预校验；失败不落盘；与标准配置页同风险水位（现状即如此），不新增暴露面 |
| koishi.yml 被外部并发编辑 | 低 | loader 写盘原子（T2）；保存前重读合并降低覆盖窗口；冲突时报错重试而非静默覆盖 |
| 两入口编辑习惯分裂（用户在标准页找新字段找不到引导） | 低 | 标准页保留全部字段（Schema 本来就在）；配置中心只做增强导航，不删任何标准页能力 |
| 客户端 bundle 体积（k-schema + components 引入） | 低 | `@koishijs/client` 本就在依赖树内；vite 构建按页分包，配置中心路由懒加载 |

## 11. 测试策略

- **Schema 往返快照**（P1）：`Config` → JSON → `new Schema` → 结构断言（防传输退化）。
- **菜单树覆盖**（P3）：菜单树键集 = Config 可见键集，新增节忘挂菜单时测试红。
- **写入管线契约**：save RPC 的合并/simplify/哨兵语义用假 scope + 真 `Config.value` 单测；`scope.update` 真链路用 Koishi 内存实例（参照 `works-sqlite.test.ts` 的实例化方式）做一条端到端：改值 → 断言 koishi.yml（临时目录）内容 + getter 新值。
- **数组子页契约**（P2）：群规则/白名单子页的模型转换（行 ↔ config 数组）纯函数单测。
- **旧接口退场**（P3）：删除前后各一次全量回归。

## 12. 开放问题（已于 2026-10-29 评审定案）

| # | 问题 | 决策 |
| --- | --- | --- |
| 1 | 保存确认的粒度 | **仅危险项确认**。维护 `CONFIG_CENTER_DANGEROUS_FIELDS`（节 → 字段名单，P1 起为 `blindMode: ['enabled']`，后续按需增补），保存触及名单内字段时弹确认并列出影响；其余节直接保存。 |
| 2 | `presetSync`（typ0.space 预设拉取）的入口 | **作为快速上手第 0 步的显式入口**（P4 快速上手视图的首张卡）。 |
| 3 | 概览页"配置健康"卡片 | **增加**。复用 `interlude.doctor` 的检查逻辑做只读呈现（P4 一并实施）。 |
| 4 | 一条龙 HTML 向导与配置中心的关系 | **向导继续独立维护表单**，不退化为链接集合；两者写同一份 koishi.yml，语义一致即可。 |

勘误（2026-10-29 实测 Config 顶层键后修正 §4.1 菜单树）：长线叙事催化器的节键为 `longHorizon`（非 longArc）；预设入口的节键为 `presetSync`（非 presetPortal）；另补"维护与诊断"组内的顶层 `mainPrompt`（主提示词高级覆盖）节。可见节共 24 个（另有 `chatRhythm` 隐藏不入菜单）。
