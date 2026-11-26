# Realism Lab 通用化架构：Profile 评价体系

日期：2026-11-22。上游文档：[测试设计](2026-11-22-style-realism-test-design.md)。
形态决策（用户已定）：**全可视化编辑** + **一审任务包导出**（不自动 judge）。

## 1. 目标

把拟真度测试从 Round 1 专用实现升级为通用评价体系：

1. **指定 model**：env → profile.engine → variant.model → run 临时覆盖，四级链；同一提示词可跨模型对比。
2. **提示词全自定义**：任何提示词都是数据（槽位覆盖集合），不是代码；新实验 = 建变体，不改代码。
3. **评分可微调**：维度/锚点/权重/标记全部配置化，评审与聚合界面动态渲染。
4. **核心不改动则永久通用**：生产链（systemPrompt/toPromptPayload）运行时 import，天然同步；**契约指纹**让"核心变了"可检测、跨版本对比自动失效隔离。
5. **一审配置化**：rubric.gate 文本存 profile，一键导出"一审任务包"（场景上下文 + 动作字段 + 边界文本 + verdict schema），供子代理消费。

## 2. Profile 结构（schemaVersion 1）

六区块：`engine`（协议/model/采样/特化档位/缓存序）· `slots`（profile 级槽覆盖）· `variants`（提示词变体 = 槽覆盖 + 风格签名 + 可选 model）· `personas`（StorySetting 形状）· `scenarios`（时间线 turns，content/memory 支持 `{default, <personaId>}` 多人物变体）· `rubric`（dimensions/flags/gate）· `checks`（builtin 开关 + custom 三类：regex-prose / regex-bubble / metric）· `matrix`（phases × segments）。

**槽位键**（映射 `systemPrompt()` 真实参数）：`mainPrompt / formatPrompt / fixedPrompt / style / storyStyle`；特化档位走 `engine.specialization`（resolveManualSpecialty(probe=model, tier, family)）。
**叠加链**：生产默认 → profile.slots → variant.slots。`mainPrompt` 空串 = 生产默认（narrator 内置 fallback）。
**安全**：API key 永不入 profile（只在 env / server 内存）。
**校验**：加载时验证 matrix 引用的 variant/scenario/persona 必须存在；turn 的 persona 键必须命中 personas。

## 3. 契约指纹（通用性保证机制）

每次 run 在 manifest 记录：

- `contract.systemHash` = sha256(systemPrompt(生产默认输入，phase=user-message))
- `contract.payloadKeysHash` = sha256(排序后的 toPromptPayload 顶层键集合)

服务启动/run 时与该 profile 上次记录对比：一致 → 跨 run 可比；变化 → UI 黄条"核心合约已变化"，对比页按指纹分桶。指纹与 profile 无关（用固定规范输入计算），只探测核心变化。

## 4. 运行时改造

- `campaign.ts`：runSegment 改为 profile 驱动；effectiveSlots = {…profile.slots, …variant.slots}；engine 四级合并；manifest 增 `engine`（实际 model/endpoint host）与 `contract` 指纹。
- `checks.ts`：`runChecks` 接受 checks 配置；H1/H2 锁定（输出可消费性）；H5/H6/H11 `auto` 按 variant.lang 选模式；custom 执行器。
- `server.ts`：`/api/profiles`（list/activate/save/import/export）+ `/api/gate/:segment` 任务包 + `/api/defaults`（生产默认槽文本，供 diff 预览）+ run 请求支持 `overrides: {model?, endpoint?}`。
- `ui/`：Header Profile 选择器；设置页 → **Profile 编辑器**七 tab（Engine/提示词变体/人物/场景/评分/校验/矩阵）；评审页评分面板与对比页列按 rubric 动态；提示词编辑带生产默认 diff 预览。
- CLI：`--profile <name>`（默认 round1）。

## 5. 兼容与迁移

- `npm run realism:profile:migrate`：从现有 TS 常量（arms/scenarios/personas/matrix）一次性生成 `profiles/round1.profile.json`；迁移后 TS 常量文件保留为迁移源（不再被运行时读取）。
- 产物格式不变：out/ 目录、turns.jsonl 原样；manifest 增量字段向后兼容；scores.json 维度键动态化（旧三元组键恰好是 round1 rubric 的维度 id，天然兼容）。
- 回归标准：round1 profile dry 全矩阵与迁移前 dry 输出一致（system prompt 与 payload 逐字节比对抽样）。

## 6. 分期

G1 profile.ts + 迁移器 + campaign/checks 改造 + CLI 回归 → G2 server（CRUD/指纹/任务包）→ G3 UI 选择器/Engine/矩阵 + 动态评审对比 → G4 UI 提示词/Fixtures/Rubric/Checks 编辑器。
