# HDSI Console 界面开发交接文档

**日期**：2026-10-28 · **仓库**：`C:\dev\HDS-Interlude\plugins\hds-interlude-cev` · **状态**：P1+P2 已交付并接线；Console 已整体移植到主仓（`hds-interlude`），CEV 侧命名空间 `-cev` 化以支持双插件并存

## 〇、2026-10-28 并存改造（重要）

Console 界面已按方案移植到**主仓**（主仓用 `hdsi-overview` / `hdsi/config/*` / `/hdsi/*` 原名）。为支持两插件同实例并存，CEV 侧命名空间整体改为：

| 项 | 主仓 | CEV |
|---|---|---|
| DataService | `hdsi-overview` | `hdsi-overview-cev` |
| RPC 事件 | `hdsi/config/read` / `hdsi/config/save` | `hdsi-cev/config/read` / `hdsi-cev/config/save` |
| 页面 | `/hdsi/:page*`（id `hdsi`） | `/hdsi-cev/:page*`（id `hdsi-cev`） |
| 图标 | `hdsi` | `hdsi-cev` |

同时修复了 CEV 侧两处遗留缺陷（主仓移植时发现，两边都已修）：
1. **addEntry 路径**：`../client/hdsi-console.js` → `../client-dist/hdsi-console.js`（原路径指向源码目录，安装环境必抛 MODULE_NOT_FOUND 被吞成 warn——页面整个不出现；此前从未暴露因为 P1 接线长期缺失）。回归防线：`console-config.test.ts` 的结构断言。
2. **vite.config.ts 的 plugin-vue 加载**：改异步工厂 + 动态 import——根 node_modules 的 @vitejs/plugin-vue v6 是 ESM-only，vite 5 的 CJS 配置链静态 require 会炸；CEV 此前靠插件目录里一份未在 package.json 生效路径上声明的 5.2.4 构建，属隐性环境依赖，现已消除。

CEV 后续 Console 功能演进建议：改 CEV 侧的同时同步主仓（或反之），两边 client/ 源码除命名外保持逐字节一致，diff 即可发现漂移。

---

## 一、项目全景

HDSI（HDS Interlude）是 Koishi 4 的持续叙事聊天插件。当前有两个仓库：

- **主仓**：`C:\dev\HDS-Interlude\plugins\hds-interlude`（rc58 已发布，含考据 Agent 设计文档 `docs/RESEARCH_AGENT_DESIGN.md`）
- **CEV 分叉仓**：`C:\dev\HDS-Interlude\plugins\hds-interlude-cev`（rc58-cev.1，所有新功能在此开发）

**CEV 仓库当前状态**（全量测试 996 项 / 992 通过 / 0 失败 / 4 跳过）：
- P1+P2+P3' 考据 Agent（`src/research/` 三模块 + Jev 门控 + 工具注册表）
- 审计修复批次（6 个 bug + 3 小项）
- 密度自适应条目预算（`src/context-density.ts`）
- HDSI Console 界面 P1 只读版（`src/console/` + `client/` + `client-dist/`）
- P2 主配置界面 **进行中**（本文档的核心）

## 二、Console 界面当前进度

### 已完成

| 文件 | 作用 | 状态 |
|---|---|---|
| `src/console/index.ts` | OverviewProvider（DataService）+ addEntry 加载客户端 bundle | ✅ 编译通过，996 测试全绿 |
| `src/console/rpc.ts` | 配置读写 RPC（`hdsi/config/save`、`hdsi/config/read`） | ✅ 刚写完，**尚未接入 installHdsiConsole** |
| `client/index.ts` | ctx.page 注册单页面 + 自定义图标 | ✅ |
| `client/src/HdsiApp.vue` | 内部侧栏 + 路由 + 数据加载 | ✅ 但需要更新导航结构 |
| `client/src/store.ts` | send('hdsi-overview/get') 快照拉取 | ✅ 需扩展 config RPC 调用 |
| `client/src/pages/OverviewPage.vue` | 概览四卡片（只读） | ✅ 需加 DataRow/InfoDot 组件 |
| `client/src/pages/DeskPage.vue` | 考据案头统计（只读） | ✅ 同上 |
| `client/src/pages/DensityPage.vue` | 密度档位表（只读） | ✅ 同上 |
| `client/src/components/InfoDot.vue` | ⓘ 提示组件（值含义+值域） | ✅ 刚写完 |
| `client/src/components/DataRow.vue` | 数据行组件（带 InfoDot） | ✅ 刚写完 |
| `client/src/components/EditField.vue` | 编辑字段（text/number/boolean/select/textarea/secret） | ✅ 刚写完 |
| `client/vite.config.ts` | vite IIFE 构建配置 | ✅ 产出 14.4KB JS |
| `client/tsconfig.json` | 独立客户端类型检查（不 extends 根配置） | ✅ |
| `client-dist/` | 构建产出（hdsi-console.js + style.css + index.yml） | ✅ |
| `preview/console-preview.html` | 静态视觉原型（双主题可交互） | ✅ 参考用 |

### 未完成（下一步）

1. ~~`src/console/index.ts` 的 `installHdsiConsole` 需要加一行~~ ✅ 已接线 `installConfigRpc(ctx, host)`
2. ~~HdsiApp.vue 导航需要扩展~~ ✅ 新增"配置"组（调节杆图标）+ 主配置入口
3. ~~新增 `client/src/pages/ConfigPage.vue`~~ ✅ 三节 tab（故事设定/运行时参数/考据配置），EditField 驱动，字段清单与值域文案内置
4. ~~三个只读页面换 DataRow 组件~~ ✅ Overview/Desk/Density 全部换 DataRow + info/range
5. ~~store.ts 加配置方法~~ ✅ readConfig/saveConfig + 客户端事件契约（client/env.d.ts）
6. ~~vite rebuild~~ ✅ 23.5KB JS（原 14.4KB）
7. ~~CHANGELOG 补 P2 段落~~ ✅

### P2 实际完成时的重要发现与结构（2026-10-27 补记）

- **P1 从未接线**：交接时 `installHdsiConsole` 没有任何调用点（Console 界面运行时不可达），P2 已在 `src/index.ts` 的 apply 里用 `ctx.inject(['console'])` 真正接线；`inject.optional`/peerDependencies（可选）补 `@koishijs/console`——此前 console 模块是死代码所以 esbuild 依赖检查从未报错。
- **rpc.ts 原稿有 7 个编译错误**（事件名未注册类型 / arrow 带 this 参数 / 访问 service 私有成员），已重构为三件套：
  - `src/console/contract.ts`：三节白名单 + 结果形状（客户端 ConfigPage 字段键名与此保持同步）
  - `service.ts` 的 `consoleReadConfig/consoleSaveConfig` 公共方法：落地实现（story 走 `updateSetting` 落库，runtime/research 进程内改 config 并清 `cachedContextEntryConfig`/`cachedResearchConfig`）
  - `rpc.ts`：纯事件壳（Events 类型声明 + authority 1/3 转发）
- **测试**：`test/console-config.test.ts` 9 项（默认值回填/traits 互转/无故事拒绝/白名单忽略/缓存清理）。
- **下一步可选方向**：案头条目明细快照（DeskPage 占位提示已在）；配置持久化到 koishi.yml（走 Koishi config plugin API）；health 卡片接入 HealthMonitor 数据。

## 三、构建命令

```bash
# 后端
cd C:/dev/HDS-Interlude/plugins/hds-interlude-cev
npm run typecheck    # 0 错误
npm test             # 996 项

# 客户端（vite 在 workspace 根）
cd C:/dev/HDS-Interlude/plugins/hds-interlude-cev/client
node "C:/dev/HDS-Interlude/node_modules/vite/bin/vite.js" build --config "C:/dev/HDS-Interlude/plugins/hds-interlude-cev/client/vite.config.ts"

# 后端 bundle
cd C:/dev/HDS-Interlude
npx yakumo build
```

## 四、设计决策（已确认）

### Console 页面定位
- **主配置界面**（ishiki 模式）：故事设定 + 运行时参数 + 考据配置在此编辑
- **插件配置面板保留为备用/必填**：仅模型中心（providers/endpoint/apiKey）、OneBot 白名单等连接信息
- 原有 Console 配置面板不动，两界面并存

### 配置写入机制
- 故事设定 → 直接写 `cev_interlude_story` 表（`setting` JSON 字段）
- 运行时参数 → 变更 `host.config.runtime` 并清缓存 getter
- 考据配置 → 变更 `host.config.research` 并清缓存
- **不触发插件重载**——下轮叙事生效

### RPC 接口
```
hdsi/config/read   (authority=1)  { section } → { ok, values }
hdsi/config/save   (authority=3)  { section, values } → { ok, applied, error? }
```
`section` ∈ `'story' | 'runtime' | 'research'`

白名单键见 `src/console/rpc.ts` 顶部三个 `EDITABLE_*_KEYS` Set。

### 视觉语言（从预览版继承）
- **零圆角**——全部 border-radius: 0
- **方块母题**——卡片标题方块符（hover rotate 45°）、侧栏品牌菱形标、时间线菱形节点
- **左侧色条**——通知条/标签/tier-tag 左侧 2.5-3px 色条
- **SVG 描边图标**——1.8px stroke-width, currentColor, 无 emoji
- **CSS 变量**——`--fg3`（主色调，Console 主题感知）、`--bg1`/`--bg3`（卡片底色/边线）
- 暗色主题 = "午后纸面"（暖褐 `#131110`/`#1d1a15` + 橙 `#ff5c33`）

### 客户端技术栈
- Vue 3 + vue-router（Console 宿主提供）
- `@koishijs/client` 的 `send()` 做 RPC
- vite IIFE 单文件 bundle（外部化 vue/vue-router/@koishijs/client）
- 产出 `client-dist/hdsi-console.js`

## 五、关键文件索引

| 路径 | 说明 |
|---|---|
| `src/console/index.ts` | 服务端入口（DataService + addEntry + **需要加 installConfigRpc**） |
| `src/console/rpc.ts` | 配置读写 RPC + 白名单（**已完成但未接线**） |
| `client/index.ts` | 客户端入口（ctx.page + 图标注册） |
| `client/src/HdsiApp.vue` | 主壳（侧栏+路由+数据加载） |
| `client/src/store.ts` | RPC 调用封装 |
| `client/src/components/InfoDot.vue` | ⓘ 组件 |
| `client/src/components/DataRow.vue` | 只读数据行 |
| `client/src/components/EditField.vue` | 可编辑字段 |
| `client/src/pages/*.vue` | 概览/考据案头/密度 |
| `client/vite.config.ts` | 构建配置 |
| `preview/console-preview.html` | 静态视觉参考 |

## 六、值域文档参考（InfoDot 的 info/range 数据源）

这些是需要在 DataRow/EditField 里传入的说明文字，按需在页面组件里逐个填入：

### 故事设定
- `character.name`：主角姓名，出现在全部叙事中。值域：任意非空中文/英文
- `world`：世界观描述。值域：自由文本（≤4000 字）
- `timezone`：IANA 时区。值域：如 Asia/Shanghai / America/New_York
- `style`：叙事文风。值域：自由文本（模型按此写 prose）

### 运行时
- `contextEntryLimit`：写入主叙事上下文的近期剧本条目数。值域：1-200，默认 18
- `contextEntryMode`：fixed=固定条数 / auto=按密度自适应（12-25 条）。值域：fixed|auto
- `contextTimeWindowMinutes`：额外并入最近 N 分钟全部条目。值域：0-1440 分钟，0=关闭
- `allowProactiveMessages`：允许主角主动发起可见消息
- `userMessageDebounceSeconds`：连续消息合并等待。值域：1-30 秒

### 考据
- `enabled`：考据总开关
- `searchBackend`：auto/tavily/bocha/searxng/duckduckgo-html
- `searchApiKey`：搜索后端 Key
- `proxyAgent`：HTTP(S) 代理地址。值域：如 http://127.0.0.1:7890
- `responseFormat`：json-object/prompt-only（不兼容网关用后者）
- `maxRounds`：检索轮数上限。值域：1-2
- `taskTokenBudget`：单任务出向 token 预算。值域：600-20000
- `deskCapacity`：案头容量。值域：2-32
- `stableFactTtlHours`：稳定事实保留时长。值域：1-2160 小时
- `volatileFactTtlHours`：易变事实保留时长。值域：1-168 小时

## 七、注意事项

1. **CEV 不是 git 仓库**——所有修改直接在磁盘上，没有版本控制（临时合并仓库在 `/tmp/hdsi-cev-sync`，含 base/cev/upstream 三分支，可用于 diff）
2. **配置写入不持久化到 koishi.yml**——运行时参数变更只影响当前进程生命周期，重启后回到 koishi.yml 值。如果要持久化，需要走 Koishi 的 config plugin API（后续可做）
3. **Console 可选依赖**——package.json 的 `koishi.service.optional` 已加 `console`，未安装 Console 插件时功能不受影响
4. **vite 路径问题**——在 workspace 里 npx 会回到根目录执行，需用绝对路径调 vite binary
5. **测试宿主无类字段**——service 的新字段用惰性初始化（`private xxx?: T` + getter `??= new T()`），否则原型宿主会报 undefined

## 八、发布仓库

- **发布 git 仓库**：`C:\dev\HDS-Interlude-gitee`（不是 CEV 目录本身）
- 双远端：`github`（ISEKAI-MomoiCore/HDS-Interlude）+ `origin`（MomoiCore/HDS-Interlude）
- 发布流程：CEV 改完 → 同步到 gitee 仓库 → commit + tag → push 双远端 → API 创建 Release + 上传 tgz + sha256
- 上次发布：rc58（2026-10-27），含 Issue #10/#14/#15 修复 + modelCapture
