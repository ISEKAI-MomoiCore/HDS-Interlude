# HDSI Webconsole 审查与修复报告

日期：2026-10-08  
范围：`C:\dev\HDS-Interlude\plugins\hds-interlude-webconsole`  
设计参照：主插件的《新人上手一条龙配置服务 v1.0.1-rc48》HTML。

## 结论

本轮完成代码审查、已确认问题的修复、视觉调整和三个新增只读视图。没有写入生产数据库、修改 HDSI 行为配置、执行剧情推进、调用模型、发布包或重启 Koishi。所有浏览器截图均使用合成数据，不含生产故事。

这不构成“所有潜在 bug 已排除”的保证；当前结果来自源码核对、自动测试、真实浏览器及现有数据库的只读兼容性检查。

## 主要问题与修复

| 优先级 | 问题/风险 | 处理 |
|---|---|---|
| P1 | 依赖主插件未发布的 src 解码路径；CommonJS 构建与 import.meta 静态目录定位不一致 | 主插件公开纯解码器，观测插件通过包入口导入；静态资源使用 __dirname 定位 |
| P1 | 多故事查询可能混用最新故事与其他表数据 | 每请求固定 storyId，所有子表查询按故事隔离；不存在的显式故事返回 404 |
| P1 | SQLite JSON/数字日期未统一解码，导致状态与页面显示不正确 | 中央 JSON 解码、复用主状态归一化、修正时间解析与时区；损坏 JSON 安全回退 |
| P1 | 启用 token 后静态资源/实时通道鉴权不一致 | 静态壳公开且不含数据；所有 API/SSE 鉴权，前端 Bearer/会话令牌支持 |
| P1 | 用户生成内容存在未转义输出风险 | HTML/SVG 文本统一转义，加入恶意 intent.type 浏览器回归 |
| P1 | 快速切页或切故事时旧异步响应可覆盖新页面 | AbortController、generation guard、隔离渲染根、页面级监听及轮询清理 |
| P2 | 导航、剧本分页/追尾或日志跟随的行为不完整 | 实现九页导航；历史从最小 id 继续读取，增量按 id 升序遍历，支持暂停与容量限制 |
| P2 | 日志截获方式导致真实级别/名称丢失及卸载副作用 | 独立 reggol Logger transport，保留时间/级别/名称，不 monkey-patch console |
| P2 | 初始日志过滤、过滤后的游标或重启后游标异常 | 初始和增量统一过滤，非匹配记录仍推进游标；session 标识、覆盖提示及重置 |
| P2 | 仅看剧本或 schema 版本无法发现事实/日程等变化 | 使用 PRAGMA data_version，SSE 心跳、背压跳过、连接上限与关闭清理 |
| P2 | HTTP 参数/缺失资源/异常处理不稳或泄漏细节 | 严格安全整数、互斥分页参数、GET-only API、静态白名单、400/404/405/通用500 |
| P2 | 仅绑回环地址不足以处理恶意 Host/跨源访问 | 验证本地 Host 和端口、Origin/Fetch Metadata，配置 CSP/no-referrer/nosniff |
| P2 | 固定数据库路径、不支持的驱动/运行时提示不足 | 新增 databasePath，明确 SQLite-only 与 Node 24+；启动失败记录错误且不创建数据库 |
| P2 | 单个响应内多次读取可能跨越不同提交 | 普通数据库 API 包裹只读事务，异常 rollback |
| P2 | “确认事实”、记忆分类、到期意图等文案有语义偏差 | 改为“已提取事实”、使用真实 category、强调计划/候选不等于已发生 |

## 新视图与视觉调整

### Alter 历史折线图

使用主插件归一化后的 `alterSystem.history`。提供全局累计和单次变化切换、来源筛选、hover 明细、记录表及 offsets/pending scopes 快照。按保存顺序/turn 展示，不伪造无限历史；筛选后的累计值仍为当时全局累计，不称作参与者独立累计。

### Overlay 演化 diff

展示当前故事 overlay、各参与者关系 overlay、提案流水和压缩快照。相同 target/path/participant 的相邻已应用提案文本可作行级 diff；第一条基线未知。因为主插件采用文本合并且未持久化完整 before-state，本视图不是精确的 overlay 状态重放。界面明确标注了这个限制。

### Preplan 物化周日历

读取已有 materializedDays，提供按周导航、计划时区和故事游标日期、跨午夜拆分（含上周最后一天的续段）、虚线候选块、例外原因、已覆盖空日/尚未物化区分，以及 revision/coverage/review/evidence 信息。日历不重新计算 regimes，也不将事项标为“已完成”。

### 设计语言

采用参照页面的深灰编号侧栏、冷蓝浅纸、暖纸深色主题、细边框、轻几何背景和方向阴影。保留观测站用途，不复制配置向导流程。手机端导航自适应，周日历仅在自身区域水平滚动，无整页水平溢出；无需 CDN、外部字体或图表库。

## 修改范围

- 后端：`src/index.ts`、`src/store.ts`、`src/routes.ts`、`src/logring.ts`；新增可测试的 `src/server.ts`。
- 前端：`public/index.html`、`public/app.js`、`public/style.css`；新增纯函数 `public/helpers.mjs`。
- 工程：`tsconfig.json`、`package.json`、README；添加 SQLite fixture、集成回归和浏览器冒烟测试。
- 主插件仅追加公开的 `decodeStoryState` re-export，并重新构建；没有更改 Urge/Alter/Preplan 核心行为。
- 本仓未启用 Git，因此本报告是修改范围说明，不是提交级 diff。未做提交、版本升级或发布。

## 验证

| 检查 | 结果 |
|---|---|
| Webconsole TypeScript | 通过 |
| 前端 esbuild 语法解析 | 通过 |
| Webconsole 单元/集成回归 | 11/11 通过，0 失败 |
| 主插件类型检查及构建 | 通过 |
| 主插件完整回归 | 共625，621通过、4跳过、0失败 |
| Webconsole 构建及 CJS 包入口 | 通过；包入口 apply 与主插件公开解码器可加载 |
| Edge 真实浏览器回归 | 九页、图表筛选、diff、周导航/跨夜、分页/追尾/暂停、日志过滤/跟随、切页竞态、故事隔离、手机与双主题均通过；无所测 XSS/CSP/运行时错误 |
| 当前生产 SQLite 只读兼容性 | 所有数据查询方法通过；所需表未缺失；未输出故事正文、未写入 |

验证环境：Windows、Node 24.19.0、Edge 154.0.4258.37。浏览器自动化和截图使用独立临时数据库。主插件原始回归输出保存在本目录的 `main-regression_2026-10-08.log`。

## 保留限制与上线建议

1. 仅支持 SQLite 和已对齐版本的 HDSI；保留有界历史和列表上限，不能当作完整审计/历史恢复工具。
2. optional token 是本地便利鉴权，不替代部署边界；请勿将端口暴露公网。SSE 必须使用查询令牌，避免转发/记录敏感 URL。
3. 日志仅为启用之后的 Koishi Logger 进程输出，非历史终端完整复刻；不按 storyId 隔离。
4. 数据库变更通知是近实时的轮询提示，不保证每次提交都单独推送。其他页由用户刷新，防止打断筛选/查看。
5. 本轮已将 HDSI peer dependency 从同仓 `workspace:*` 改为可发布的 semver 范围；仍要求安装与观测插件兼容的 HDSI 版本。
6. 用户启用前确认 databasePath 正确，先使用更新后的主插件构建，再重载观测插件。生产环境实际热重载、监听端口占用和运行中的 Koishi 生命周期未执行端到端上线验证。
