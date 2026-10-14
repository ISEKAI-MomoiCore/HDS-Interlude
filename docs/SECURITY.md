# 安全与依赖说明

适用版本：`1.0.1-rc52`

## 发布包边界

npm 包只包含 `lib/`、manifest 和当前文档，不包含 `node_modules`、`.env`、`koishi.yml`、数据库、日志、缓存或 dustbin。API Key 使用 Koishi secret 字段，内容日志默认关闭。

SnowLuma 语音转写只向本地 OneBot 动作请求文本结果；HDSI 不保存原始音频、下载 URL 或转码内容。开启该功能前应确认 QQ 客户端与 SnowLuma 的使用边界符合自己的隐私要求。

网页观察只允许公开 HTTP(S) 地址，并拒绝 localhost、私网、带凭据 URL 和非网页协议；可进一步使用域名白名单。

## 依赖审计

2026-08-23 发布前执行了 `npm audit --omit=dev`：

- 已通过 overrides 将 `js-yaml` 固定到 `>=4.3.1`、`nanoid` 固定到 `>=3.3.18`，修复两项兼容补丁范围内的 high 告警。
- 剩余 `5 high / 0 critical` 来自当前最新版 `koishi-plugin-puppeteer@3.9.0` 的 Chromium 下载/运行链，以及 Koishi Console 使用的 Vite。
- npm 对 Puppeteer 链给出的自动修复是强制降级到 `3.5.0`，属于破坏性回退，未采用；Vite 当前没有审计建议的兼容修复。

Puppeteer 在插件中是可选能力。不需要网页观察或动态图片抽帧时可以不安装/不启用它。后续应跟随 Koishi/Puppeteer 上游版本更新重新审计。

