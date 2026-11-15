# 安全与依赖说明

适用版本：`1.0.1-rc60` + 未发布工作区增量（考据 Agent / 密度自适应 / HDSI Console / 表情包采集）

## 发布包边界

npm 包只包含 `lib/`、`client-dist/`、manifest 和当前文档，不包含 `node_modules`、`.env`、`koishi.yml`、数据库、日志、缓存或 dustbin。API Key 使用 Koishi secret 字段（含考据的 `research.searchApiKey` 与 `research.jev.apiKey`），内容日志默认关闭。

SnowLuma 语音转写只向本地 OneBot 动作请求文本结果；HDSI 不保存原始音频、下载 URL 或转码内容。开启该功能前应确认 QQ 客户端与 SnowLuma 的使用边界符合自己的隐私要求。

网页观察只允许公开 HTTP(S) 地址，并拒绝 localhost、私网、带凭据 URL 和非网页协议；可进一步使用域名白名单。

## 考据 Agent 外发数据面（未发布增量，默认关闭）

考据开启后存在两类额外的外部服务调用：

- **搜索查询**（Tavily/博查/SearXNG/DuckDuckGo，按配置）：查询词经双层防火墙脱敏——改写合约禁止身份词 + 程序化拦截参与者 userId/昵称；命中页面的抓取只取公开网页正文。
- **Jev 门控**（`research.jev.enabled`，console.typesafe.ai）：被动推进前的一次是非判断，判断内容包含**聊天消息摘要与近期剧本尾部**（均截断）以及案头已有事实摘要，会发送至 TypeSafe AI 服务——Key 未配置时门控关闭、零外发。
- 考据网络可经 `research.proxyAgent` 统一走代理；考据连接的 `proxyAgent` 作为回退。两条 Key 均为 secret 字段，日志中掩码。

## 依赖审计

2026-08-23 发布前执行了 `npm audit --omit=dev`：

- 已通过 overrides 将 `js-yaml` 固定到 `>=4.3.1`、`nanoid` 固定到 `>=3.3.18`，修复两项兼容补丁范围内的 high 告警。
- 剩余 `5 high / 0 critical` 来自当前最新版 `koishi-plugin-puppeteer@3.9.0` 的 Chromium 下载/运行链，以及 Koishi Console 使用的 Vite。
- npm 对 Puppeteer 链给出的自动修复是强制降级到 `3.5.0`，属于破坏性回退，未采用；Vite 当前没有审计建议的兼容修复。

Puppeteer 在插件中是可选能力。不需要网页观察或动态图片抽帧时可以不安装/不启用它。后续应跟随 Koishi/Puppeteer 上游版本更新重新审计。

