# 四项改进计划（2026-09-12，先不改代码）

## 一、跟进补写（5/20 分钟特殊推进）加入"主动发言意愿"引导

### 现状定位

`scheduleConversationFollowUps`（service.ts:8353）在对话结束后调度 5/20 分钟两次特殊推进。当前 `phaseInstruction('conversation-follow-up')`（narrator.ts:1367）写的是：

> CURRENT PHASE: CONVERSATION FOLLOW-UP. ... If that movement naturally becomes a private follow-up by now, place its exact words at the sending action in script; otherwise let attention return to the life already in progress.

模型在大多数情况下选择了"否则"分支——回到生活而不是发言。

### 问题

用户观察到：一个话题聊热之后一方不说话，就戛然而止。5/20 分钟的补写回合虽然存在，但模型没有受到"她刚经历了一段有趣的对话，有话想说"的意愿引导。

### 方案

在 `phaseInstruction('conversation-follow-up')` 中补充一条意愿引导，措辞大致如下（英文，与合约风格一致）：

```
If the just-ended exchange touched something she genuinely cares about — a topic
she finds interesting, a value she wants to share, an experience she wants to
continue venting about, or something she suddenly wants to add — she is more
willing to speak up on her own now. A pending conversational aftertaste is a
valid reason to send another message; do not let a warm topic die only because
the other side stopped typing.
```

同时考虑在 `automaticDeliveryInstruction` 中同步一条简短的对应措辞（当次投递为主动联系时，automaticDeliverySummary 的 delta 描述更自然）。但只改 phaseInstruction 应该就足够——不动合约层。

### 涉及文件

- `src/narrator.ts` phaseInstruction 函数 conversation-follow-up 分支（仅此一处）
- 测试：在 `narrative-prompts.test.ts` 或 `positive-narrative-prompt.test.ts` 加断言

### 风险

低——只是让"否则回到生活"从默认偏向变为显式与"主动发言"并列。不影响正常回复或沉默的选择。

---

## 二、Urge System 开启后 bot 从未主动找过用户

### 现状定位（日志数据）

- `urge.enabled: true, frequency: high` 已配置在实例 koishi.yml
- 日志中 **471 次** `Urge 调度` 记录，原因为 `conversation-density-decay`，每次都安排下次推进时间
- 但 **0 次** `主动联系 immediate` 输出
- `Agency 主动联系判断` 仅出现 **1 次**
- `Agency 拒绝` 出现 **0 次**（不是 Agency 把它拦掉的）

### 根因分析

Urge 调度的推进是 `advance` 相位。在 `persistDecision`（service.ts:3995+），`advance` 相位的 agency 流程要求模型输出 `proactiveContact` 草稿 + agencyWindow 通过容量检查 + willingness ≥ 0.65 才会发送（`agencyAllowsSend`）。

关键：**advance 相位的模型提示词里，`agencyInstruction` 里的 proactiveContact 触发条件非常严格**（narrator.ts:1407+）：

> A long user silence is never enough by itself. A life event, promise, practical update or relationship follow-up must ground the motive. sourceEntryIds must reference supplied recentScript/due context...

模型在没有明确的 life-event/promise 驱动下，几乎不会返回 `proactiveContact: send-now`。这是设计意图（防止骚扰），但配合 urge 的高频推进变成了：**模型每 5-15 分钟被叫醒写一段生活，但从不被引导去主动联系用户**。

Urge 只控制"推进频率"（何时写作），不控制"是否主动联系"（写什么）。两者没有互相影响——是 Agency 的主动联系路径太保守了。

同时：`advance` 相位的 `crossConversationActions` 需要 Agency 通过才允许发送（service.ts:3519+），而 Agency 判断需要 `proactiveContact` 草稿存在。所以如果模型不输出 proactiveContact → agencyAllowsSend = false → crossConversationActions 被过滤为空 → 没有主动联系。

### 方案

两层修复：

**A. advance 相位的主动联系引导加强**（narrator.ts agencyInstruction 的 advance 分支）：

当前 advance 分支写的是 "For send-now, also return one matching crossConversationAction with the actual message..."——只是告诉你怎么发，没有告诉你什么时候想发。修改方向：

```
Consider proactive contact when the life she just lived naturally produces
something she wants to tell this person — not only promises or practical
matters, but also a thought that reminded her of them, something funny that
happened, a topic she wants to continue, or genuine curiosity about what
they're doing. A life event, promise, practical update or relationship
follow-up still grounds the motive; but "she just thought of something she
wants to share" is a valid life-grounded motive, not a violation.
```

**B. urge 驱动的推进加入热度→主动联系桥接**（可选，更激进）：

当 urge density 高（对话刚结束不久）且 advance 走到时，在 `toPromptPayload` 的 urge 字段旁加入一个事实说明："conversation density is high, the last exchange was recent"——让模型知道对话刚结束，有主动联系的语境。但这个改动可能过于侵入，先做 A 再观察。

### 涉及文件

- `src/narrator.ts` agencyInstruction 的 advance 分支 + phaseInstruction advance 分支
- 测试：narrative-prompts.test.ts 或 agency.test.ts 加断言

### 风险

中——过度主动可能变成骚扰。通过 Agency 的 minimumProactiveIntervalMinutes（当前 60 分钟）和 willingness 门槛做兜底。

---

## 三、模型调用成功率低

### 日志数据（9/10-12）

主叙事 `模型调用完成` 总计约 470 次，`模型调用失败` 仅 15 次（~3%）。其中：

- 12 次 `omitted the required visible-reply structure`（模型两稿都丢 interaction 字段）
- 1 次 `no usable script`
- 2 次 provider 超时/连接错误

但用户反馈的"经常不能成功调用"可能指的是**整体感受**（包括 Alter/压缩/时间导演侧端的失败重试、以及 beta7 时代的连续失败循环）。当前 beta12+ 的主叙事失败率其实已经很低了。

### 方案

主要侧端任务的 JSON 失败已在 beta5 用 `sideTaskJson` 去 cap 重试修过。剩余可做的：

**A. 主叙事"omitted structure"失败时降级为无可见回复提交而非硬失败**（可选但推荐）：

当前 `requiresVisibleReplyRecovery` 在恢复重写后仍缺失时 `throw`，整个回合作废、进入 30s 后重试队列。改为：恢复仍失败时，如果 `decision.script` 非空，以 `interaction = undefined` 提交（无可见回复），让剧本推进但不出消息。这比让整回合失败好——用户至少看到生活还在走。

**B. 连续失败后自动切换 cache-first 或降低 prompt 复杂度**——过于激进，不做。

方案 A 涉及 service.ts tryDecide 中 3741 行附近的 throw 改为降级提交。

### 涉及文件

- `src/service.ts` tryDecide 函数 ~3741 行

### 风险

低——把硬失败变为软降级，有 diagnostic 日志留痕。

---

## 四、输入 tokens 降低 + cache-first 默认开启

### A. 原始剧本预算减少

**现状**：`recentEntriesForPrompt`（service.ts:1248）取 `count = max(50, min(contextEntryLimit ?? 20, 200))` 条 + 时间窗 `contextTimeWindowMinutes ?? 60` 分钟内的条目（上限 500）。实例未配置 `contextEntryLimit`，实际取 **50 条**。中位输入 25k tokens。

**方案**：

在 `toPromptPayload`（narrator.ts:1597）中，`recentScript` 数组按字符预算截断（当前不截，全部送出）。加一个字符预算参数（如 `recentScriptCharacterBudget`，默认 12000，约 3700 tokens），从最近的条目往前累计，超预算的老条目丢弃。

同时把 `recentEntriesForPrompt` 的 count 从 50 降为 35（通过改 `contextEntryLimit` 的 fallback 或直接改 count 的下限从 50 到 35），时间窗从 60 分钟降到 45 分钟。

注意：cache-first 排序时，recentScript 在载荷末尾（不稳定区），截断它不影响前缀缓存。legacy 排序时 recentScript 在前面，截断会改变前缀——但截断是确定性的（同样的数据截出同样的结果），前缀缓存仍然有效。

**预期效果**：25k 中位 → 约 18-20k，省 20-25%。

### B. cache-first 默认开启

**现状**：`mainPayloadOrder` 默认 `legacy`（index.ts:152）。

**方案**：改默认值为 `cache-first`。

已有实例的配置值不受影响（koishi.yml 已写入 `legacy` 的不会变），只影响新装实例和未配置的实例。用户实例需要手动在 Console 改为 `cache-first`，或者在升级时检测到未设置则自动切换。

简单做法：改 `default('cache-first')` + 在 CHANGELOG/文档中注明"已有实例建议手动切换"。

### 涉及文件

- `src/index.ts` mainPayloadOrder 默认值
- `src/service.ts` recentEntriesForPrompt count/时间窗
- `src/narrator.ts` toPromptPayload recentScript 截断
- 测试：payload-order.test.ts / configuration.test.ts

### 风险

低——截断是确定性的；cache-first 对不支持前缀缓存的服务商无副作用（只是字段顺序不同）。

---

## 执行顺序

1. **四（A+B）**——最简单、纯配置/截断逻辑
2. **三（A）**——单点改动
3. **一**——提示词修改 + 测试断言
4. **二（A）**——提示词修改 + 测试断言，观察效果后再决定是否做 B

## 验证方式

- 全量测试通过 + 类型检查
- 打包装到桌面实例
- 观察一周日志：Urge 调度是否产生主动联系、输入 tokens 中位数、模型调用失败率
