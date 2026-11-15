# HDSI 稳定性路线图（2026-09-12）

> 基于 2026-09-08 ~ 09-12 密集开发周期的全部 bug 修复经验，归纳为四类系统性弱点并提出六项改进方案。
> 执行顺序：P0 → P1 → P2 → P3 → P4 → P5。P0 是一切的前提。

---

## 一、已修复问题的模式总结

| 弱点类别 | 典型案例 | 根因 |
|---|---|---|
| **模型输出契约失效** | interaction 字段丢弃（beta9 `<true|false>` 占位符）、`mode:none+actionId` 矛盾（beta7 硬失败循环）、群聊嵌套 groupReply（beta14）、两段式定式（beta12） | 弱模型无法稳定遵守两步一致性要求 |
| **空值/边界崩溃** | soleActionReply(undefined)、getCanonicalStory 不查 paused、findStory 暂停死锁 | 防御性编程遗漏——同一函数的兄弟分支有保护而漏了一处 |
| **提示词变更行为回归** | `<true|false>` → 23% 字段丢弃、`<say>` 教学 → 自造 id、中文写作观 → "糖味"输出 | 每次提示词变更都是盲发，无法预知模型行为变化 |
| **数据链透传断裂** | imageCount/audioCount/alterValue 被桌面 normalizer 剥掉、typ-0 npm 缓存导致旧包安装 | 多层数据边界（worker→main→renderer）各有白名单 |

---

## 二、当前遗留风险

### A 级（可能造成用户可见故障）

1. **群聊协议仍教 `<say>` 标记**：`scriptFirstTransportInstruction` 群聊分支仍教 `actionId:"reply"` 引用，content-only 契约只覆盖了私聊。
2. **`normalizeConversationAction` 未走 `normalizeVisibleMessageContent`**：跨会话主动消息内容只 `trim+slice`，标记可能漏出到投递。
3. **`interlude_fact` 表的 `id` 是字符串**（`${story.id}:supp:${index}`）：如果其它代码假定 `id` 是数字，可能出错。

### B 级（影响体验但不崩溃）

4. **Urge 主动联系频率极低**：beta15 合成修复只解决"判断通过但消息发不出"，模型几乎不输出 proactiveContact。
5. **提示词 ~20k 字符**：弱模型指令负载税高于 0.1.5 的 14.7k。
6. **测试覆盖代码逻辑但不覆盖模型行为**：307 项回归全绿 ≠ 模型实际表现正确。

### C 级（工程债）

7. **无自动健康监控**：需手动看日志才能发现异常率升高。
8. **npm 缓存导致 typ-0 安装旧包**：同版本号打包两次时缓存命中旧包。
9. **版本同步是手工脚本链**：容易遗漏文件或损坏 YAML。

---

## 三、改进方案

### P0：模型行为回归测试

**问题**：每次提示词变更后，唯一验证手段是"等用户反馈"。

**方案**：创建 `test/model-behavior.test.ts`，用真实模型 API 跑固定合成对话场景，断言：

- interaction 含 `seen:boolean` + `reply.mode` 合法
- `reply.mode=immediate` 时 `content` 非空
- 群聊输出顶层 `groupReply` 或 `interaction.groupReply`
- 剧本写到 `interval.now` 为止（不越界）
- 无自造 incoming message
- 气泡段数不固定（有分布而非恒定 N）

运行方式：`npm run test:model`（需设 `HDSI_TEST_PROVIDER_ENDPOINT` / `HDSI_TEST_API_KEY` / `HDSI_TEST_MODEL` 环境变量）。每次发布前手动跑一次。

**实现量**：~200 行。

---

### P1：群聊协议 content-only 统一

**问题**：群聊分支仍教 `actionId` 引用，与私聊 content-only 方向不一致。弱模型可能输出与 beta9 私聊相同的"抄引用不写标记"形态。

**方案**：群聊 `groupReply` 协议改为与私聊对称的 `{"mode":"immediate","content":"the exact posted words"}`。

**改动**：`src/narrator.ts` 群聊协议行 1 行。

---

### P2：跨会话消息内容归一化

**问题**：`normalizeConversationAction` 的内容只 `trim+slice`，未走 `normalizeVisibleMessageContent`。

**方案**：改为调用 `normalizeVisibleMessageContent(value.content, runtime.maxMessageCharacters, runtime.messageSeparator)`。一行改动。

---

### P3：结构化诊断面板（Console 端）

**问题**：无自动健康监控，需手动检查日志。

**方案**：在插件 Console 页面加"健康"标签，实时展示：

- 主叙事成功率（最近 100 回合）
- 结构化回复缺失率
- 回复模式分布（immediate / none / delayed）
- 侧端任务 JSON 失败率（Alter / 压缩 / 导演）
- 前缀缓存命中率
- 主动联系成功率
- 各相位延迟中位数

**实现**：内存滚动窗口计数器 + Console Schema 暴露。~150 行。

---

### P4：发布脚本自动化（本轮不实施）

写 `scripts/release.mjs` 一条命令完成测试→升版→打包→安装→重启→验证。消灭手工 `node -e` 脚本链。

---

### P5：提示词分段压缩（本轮不实施）

把 ~20k 系统提示词分为"核心合约"（~8k）+ "写作引导"（~6k 可配模板）+ "相位指令"（~4k 按需注入）。默认只注入核心 + 当前相位。需配合 P0 行为回归测试。

---

## 四、执行顺序

```
P0（模型行为回归测试）→ P1（群聊协议统一）→ P2（跨会话归一化）
→ P3（诊断面板）→ 预发布测试与全量代码检查 → 1.0.1 正式版
```

P0 是一切的前提——没有它，后续每一项改动仍然依赖"发出去等用户反馈"。
