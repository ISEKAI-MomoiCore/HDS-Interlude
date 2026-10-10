# HDSI rc50 发布验证记录

- 日期：2026-10-11（Asia/Shanghai）。
- 版本：`koishi-plugin-hds-interlude@1.0.1-rc50`。
- 构建来源：当前 HDSI 工作区源码；本轮不修改业务功能，不构建或发布 webconsole。
- 工具：Node.js 24.19.0、仓库固定 Yarn 4.5.3、Yakumo/TypeScript/esbuild。

## 发布流程与范围

1. 在工作区根目录执行定向 `yakumo build hds-interlude`，同时生成声明和运行 bundle，不能只执行 emitDeclarationOnly 的 tsc。
2. 运行严格类型检查及全量源码测试。
3. 通过 `scripts/ensure-fresh-bundle.mjs` 检查 bundle 不早于任一源码，使用 Yarn 4 的 pack 路径生成本地 tgz。
4. 检查 tar 内文件、版本、依赖和本地文件一致性；在独立临时目录解包，直接加载实际 `lib/index.js` 冒烟。
5. 将当前 src、test、scripts、docs、lib、发布说明、rc50 向导和本次安装包同步到既有 Gitee 发布仓库；保留其已有历史 release 与 changelog。沿用 `master` 和同名 annotated tag，不强推、不发布 npm。

Gitee 同步不包含工作区根项目、webconsole、Koishi 私有配置、运行数据、密钥、临时诊断文件或旧源码备份；仅新增本次 rc50 安装包，不批量发布未同步的旧候选包。

## 已完成的源码与构建验收

- 定向 Yakumo 构建：通过；`lib/index.js`、`lib/index.d.ts` 与 `lib/meta.d.ts` 均为 rc50。
- 严格 TypeScript：通过，无 unused locals/parameters 错误。
- 全量回归：**758 项，754 通过、0 失败、4 跳过**。四项跳过需要外部模型配置，未为通过验收而改用真实外部服务。
- 构建仅有既有 Vite CJS Node API 弃用提示，不影响产物生成。
- 包新鲜度：通过，Yarn prepack 校验通过；实际 bundle 来自本次 Yakumo/esbuild 构建。
- 安装包内容：99 个正式文件，含 53 个运行 bundle/声明文件、39 个文档文件及 7 个根发布文件；无源码、测试、归档或旧包套娃。manifest 与工作区语义一致（Yarn 移除末尾换行），其余内容逐字节一致。
- 独立目录解包与实际 bundle 冒烟：通过；rc50 的 name/version/apply、Config 默认值、inject 依赖声明及类型声明版本均正确。
- 文档相对链接检查：通过，包内 Markdown 的相对链接目标均存在。
- 发布配置修正：根文档使用 `./` 路径锚定，`lib/**` 与 `docs/development/**` 显式递归；补齐 `V2_VS_BETA10_COMPARISON.md`。保留原 files 文档索引，扩充已有发布一致性回归，不改业务代码。

## 安装包与校验

安装包：`release/koishi-plugin-hds-interlude-1.0.1-rc50.tgz`。最终 SHA-256 单独保存于同目录 `.tgz.sha256`，不在包内写入自身哈希，避免循环改变产物。

验包确认：manifest、运行 export 与声明版本一致；tar 中 manifest/lib/文档逐文件对应当前工作区；没有 src/test/scripts、release 套娃、运行数据或密钥文件。实际 bundle 冒烟使用工作区现有依赖，不等同全新联网安装。

## 验证边界

- 包构建/加载通过不代表运行中的 Koishi 实例已安装或重载；本轮不自动重启用户实例。
- 未做真实 QQ/OneBot 多天长稳、真实进程 kill/restart、远端模型压力或全部数据库后端验收。
- 未知平台回执及成功回执持久化前崩溃仍不能保证 exactly-once。
- Git commit/tag 的 push 不等于另行创建 Gitee 网页 Release、上传 Assets 或发布 npm；本轮遵照既有 Git 发布流程。
