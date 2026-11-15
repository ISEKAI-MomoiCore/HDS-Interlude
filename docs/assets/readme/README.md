# README 视觉资产

根 README 顶部的版本、适用平台、开发语言与许可证使用原生 Markdown 表格，直接在 `README.md` 中编辑即可。发布时，将表格中的版本号与 `package.json` 的 `version` 保持一致；表格内的文字和链接可以独立修改。

## 封面维护

封面沿用一条龙 HTML 的视觉语言：纸面留白、大字、细线和几何方块。

- 纸面 `#f7f8fa`、墨色 `#111827`、蓝色 `#2563eb`、青绿 `#14b8a6`；橙色 `#ff5c33` 来自向导暗色主题。
- `cover.svg` 是可编辑源文件；`cover.png` 是根 README 实际引用的 2 倍分辨率静态图片。
- 修改封面 SVG 后，以浏览器按 SVG 声明尺寸、2 倍像素比例重新导出 PNG；保留完整画布。
- 图片采用静态内容，独立于外部数据、字体和徽章服务。
- 这些资产通过 `package.json` 的 `docs/assets/readme/**` 一起进入后续安装包，供包内 README 引用。

## 历史徽章

`version`、`koishi`、`typescript`、`license` 的 SVG / PNG 是旧版图片徽章，保留作历史素材。根 README 已采用文字表格，版本发布只需维护表格文字，图片徽章中的旧值仅代表历史内容。
