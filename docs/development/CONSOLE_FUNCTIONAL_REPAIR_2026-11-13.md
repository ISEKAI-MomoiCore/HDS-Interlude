# HDSI Console 功能修复记录

日期：2026-11-13。版本：1.0.1-rc59-preview.1。

本轮承接专属页面审查，完成入口、配置字段渲染、图标与读取失败恢复的功能修复。配置节开放范围沿用现有 P1 计划。

## 实现

| 审查项 | 修复结果 | 主要文件 |
| --- | --- | --- |
| C01 概览 RPC 接线 | 注册 hdsi-overview/get，沿用 authority=1，与 DataService 使用同一快照源 | src/console/index.ts |
| C01 子页面加载 | 配置页独立加载；观测页提供读取失败重试和手动刷新；刷新失败保留上次快照，请求与卸载状态按代次复核 | client/src/HdsiApp.vue |
| C02 字段渲染 | 使用 SchemaBase.Form，由宿主完整 Schema 表单提供字段、类型、嵌套对象和数组编辑 | client/src/pages/ConfigCenterPage.vue |
| C03 活动栏图标 | 使用 Vue 3 h 函数与扁平 SVG 属性 | client/index.ts |
| C03 同类导航图标 | 真实页面回归发现内部 IconSet 存在同类问题，统一迁移到 Vue 3 渲染方式 | client/src/IconSet.vue |
| C08 菜单失败恢复 | 菜单加载状态、RPC 拒绝提示与重试入口；卸载后异步结果退休 | client/src/pages/ConfigCenterPage.vue |

## 回归方法

新增 test/console-page-integration.test.ts，使用 Vite 编译真实 Vue SFC，加载项目安装版本的 Koishi Schema 表单，并通过 Vue 内存渲染器挂载页面。Console 传输和依赖 DOM 的 Element 控件以测试宿主替代，字段生成、Schema 类型转换、页面双向绑定和服务端配置合并/预校验均执行真实实现。

六项集成回归覆盖：

1. 真实 Console Client 分发概览 RPC，核对响应与读权限拦截。
2. 活动栏图标在 Vue 3 中生成正确 SVG 属性。
3. runtime 数字、开关、枚举、数组和私聊/群聊嵌套预算从页面编辑进入保存管线。
4. research SearXNG 地址/后端、Jev 嵌套凭据编辑与保存，未编辑的掩码密钥保持现值。
5. 配置菜单 RPC 拒绝时展示错误，重试恢复字段。
6. 概览失败时配置页继续可用，观测页重试恢复，同时检查内部导航图标渲染。

修复前六项回归均失败；修复后通过。原 F01 资源加载测试的 Console 宿主补齐 addListener，以匹配新增 RPC 注册；其 JS/CSS 加载断言继续保留。

## 验收

| 验收项 | 结果 |
| --- | --- |
| 新增真实页面/Schema 集成回归 | 6/6 通过；修复前六项失败记录已保留 |
| Console 配置与第三轮请求归属回归 | 原有 49 项通过 |
| 页面集成 + 第一轮资源/生命周期回归 | 37 项通过 |
| 最终全量测试 | 1284 项；1280 通过、4 个真实 API 用例跳过、0 失败 |
| 后端类型检查与声明构建 | npm run typecheck、yakumo tsc hds-interlude 通过 |
| 后端生产构建 | yakumo esbuild hds-interlude 通过，CJS 可取得 apply/Config |
| 前端生产构建 | npm run build:client 通过，32 个模块，index.js + style.css 已更新 |
| 发布前检查 | 后端新鲜度/CJS、前端默认导出/样式/新鲜度检查通过 |
| 包内容预检 | npm pack --dry-run --json 通过，包含新产物与本修复文档 |
| 独立客户端 TypeScript 基线对照 | 修复前后均为 100 项既有诊断，新增 0 项 |

## 后续工作

- 配置中心继续按迁移计划开放其余 22 个配置节，优先故事默认档案、模型中心和 QQ 接入。
- 统一主配置与配置中心的职责说明、字段入口及原生配置页引导。
- 接入宿主布局容器，完善窄屏导航、滚动与主题对比度。
- 补充编辑草稿、未保存状态、权限只读展示和字段级反馈。
- 观测统计继续完善真实条目计数、自定义生效档位表和自动刷新策略；本轮已提供手动快照刷新。
- 独立客户端 TypeScript 检查的既有诊断另行处理。基线与本轮源码均为 100 项、无新增；后端正式类型检查与前端生产构建通过。

本轮验证涵盖页面与 Schema 组件的绑定、RPC 分发及保存管线预校验；实际浏览器像素布局和在线 Koishi 热更新/文件写回继续由运行环境验收。测试保存使用隔离宿主。

源码基线、差异、测试日志、构建日志和客户端类型基线对照：C:/dev/artifacts/hdsi-console-functional-fix-20261113。
