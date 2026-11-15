# koishi-plugin-hds-interlude-webconsole

HDSI 本地只读观测站。独立监听回环地址，展示 HDSI 已持久化的数据以及本次进程的 Koishi 日志；不修改配置、不推进剧情、不调用模型。

## 环境与启用

- Node.js **24 或更高版本**（使用内置 `node:sqlite`；本轮验证环境为 Node 24.19.0）。
- Koishi 4.17+，以及 `koishi-plugin-hds-interlude` >= 1.0.1-rc48（rc52 起可展示生活节奏）。状态解码内置于本插件，不依赖主插件的构建产物形态。
- 仅支持 HDSI 使用 **SQLite** 持久化的部署，暂不支持 MySQL/PostgreSQL。

在 Koishi Console 添加本插件，将 `enabled` 打开，然后访问 `http://127.0.0.1:5178`。这是独立观测页，不是 Koishi Console 的内嵌面板。

| 配置项 | 默认值 | 含义 |
|---|---|---|
| enabled | false | 显式启用服务 |
| host | 127.0.0.1 | 仅允许 127.0.0.1、localhost、::1 |
| port | 5178 | 本地监听端口，1024–65535 |
| databasePath | 空（自动定位） | 留空时按优先级自动定位：minato driver 暴露的路径 → Koishi 标准 SQLite 位置（`koishi.db`、`data/koishi.db` 等，均校验文件头）。驱动链不可用时（表未注册等）自动降级，不再阻塞启动；异位部署或定位失败时填写相对 Koishi baseDir 或绝对路径 |
| token | 空 | 可选 API 访问令牌；建议填写强随机令牌 |
| pollSeconds | 3 | SSE 数据变更探测间隔，1–60 秒 |
| logBuffer | 2000 | 本次进程日志环形缓冲容量，200–20000 条 |

令牌可在网页侧栏填写。静态页面不含故事数据，不要求令牌；所有 API（包括 SSE）均要求匹配已配置的令牌。网页令牌仅存于当前标签页的 `sessionStorage`，普通请求用 Bearer header，EventSource 用查询参数。也支持首次通过 `?token=...` 打开，网页会从地址栏移除该参数，但初始 URL 仍可能被浏览器或中间日志记录，优先使用侧栏输入。

## 页面与数据口径

| 页面 | 内容与限制 |
|---|---|
| 故事总览 | 当前自动推进、生活节奏（rc52 五档）、Urge、Alter、Agency Window、剧情弧与长线指导等快照 |
| 剧本流 | 全文、类型/参与者过滤、投递元数据、向前分页、实时追尾与暂停 |
| 场景与弧线 | 场景条目与当前活动弧摘要 |
| Alter 历史 | 保存窗口内的全局累计/单次变化折线图、来源筛选、明细、offset 与 pending scope |
| Overlay 演化 | 当前故事/关系 overlay、已应用提案的文本演化 diff、提案审计与压缩快照 |
| Preplan 周日历 | 持久化 materializedDays 的周视图、跨午夜续段、候选、例外与覆盖状态 |
| 事实与意图 | 已提取事实、待处理意图、记忆；到期意图仍不等于已发生事实 |
| 参与者 | 端点、未读、知识与关系 overlay |
| 进程日志 | 插件启用后 Koishi Logger 输出的缓冲、级别/名称过滤、增量跟随 |

重要限制：

- **Alter** 仅展示主插件保留的历史窗口。来源筛选不会重新计算该参与者的独立累计值；累计曲线仍是记录中的全局累计。
- **Overlay diff** 比较同 target/path/participant 的相邻已应用提案文本。主插件实际会合并文本，且未存储每次完整 before-state，因此这不是精确 overlay 状态回放；第一条的旧值未知，不伪造为空。
- **Preplan** 只显示已经持久化的物化日期，不在网页里重新生成日程。覆盖但无事项、尚未物化、候选事项分别标示；计划不代表事实。
- **日志** 使用独立 Logger transport，不覆写 `console`，不补读历史终端，不承诺捕获直接 `console.log` 的输出。日志属于整个进程，并不随故事筛选。
- 时间按故事配置时区显示；Preplan 使用计划自身时区。缺少有效时区时回退到浏览器本地时区。
- 列表有上限：场景/参与者/提案/快照最多 200；事实最多 500、意图和记忆最多 300；剧本和日志页面最多保留 1000 个可见条目。不是无界历史检索工具。
- 普通 API 响应使用只读事务快照；SSE 是数据库变更通知，不是连续的全量事件审计流。总览可自动刷新，其他页面保留当前选择并提示刷新。

## 安全与只读边界

SQLite 连接以 `readOnly: true` 打开，不创建数据库、不运行迁移、不执行写入。缺少可选表会返回空数据并在总览提示；旧表字段不兼容等读取错误会显示通用错误，详情留在 Koishi 日志。

服务校验回环 Host 与实际端口，拒绝跨源/跨站请求；静态文件采用白名单，配置 CSP、no-referrer 与 nosniff。页面对数据库内容转义。不应将端口通过隧道、反向代理或端口转发暴露公网；本地只读也不意味着资料不敏感。令牌不会隔离同机有权限读取数据库或浏览器会话的用户。

## 开发与验证

从仓库根目录执行，先构建主插件，再构建观测插件：

```powershell
npx --no-install yakumo build hds-interlude
npx --no-install yakumo build hds-interlude-webconsole
npm run typecheck --workspace koishi-plugin-hds-interlude-webconsole
npm run test --workspace koishi-plugin-hds-interlude-webconsole
npm run test:browser --workspace koishi-plugin-hds-interlude-webconsole
```

浏览器测试依赖开发环境中的 `puppeteer-core`，默认使用 Windows 已安装的 Edge，可通过 `HDS_BROWSER` 环境变量指定已有 Chromium/Edge 可执行文件。测试使用临时 SQLite 和合成数据，不访问生产故事；截图写入 `docs/screenshots`。

本次审查结果见 `docs/REVIEW_AND_REPAIR_2026-10-08.md`。启用新构建需自行重载相关插件或重启 Koishi；本轮修复未执行生产重启。
