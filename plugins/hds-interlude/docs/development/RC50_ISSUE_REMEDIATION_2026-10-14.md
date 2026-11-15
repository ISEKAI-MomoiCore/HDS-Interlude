# rc50 Issue 报告修复方案（对照当前源码核实后制定）

> 状态：**方案文档，尚未实施**。基线：工作区源码（rc51 + rc52 未发布批次）。
> 来源：用户提交的《rc50 使用中发现的问题汇总》（十项），已逐条对照当前源码核实。
> 行号均为当前工作区 `src/` 行号，实施时以锚点代码为准。

## 核对结论总览

| # | 问题 | 状态 | 优先级 |
| --- | --- | --- | --- |
| 一 | 表情包 router 未声明 | **已修复**（rc52 批次，本文档仅存档） | — |
| 二 | 串行队列无超时死锁 | 未修 | **P0** |
| 三 | lite 档缺表情包/聊天动作说明 | 未修 | P1 |
| 四 | 空正文+表情包被判回复缺失 | 未修 | P1 |
| 五 | 动作字段嵌套不提权 | 未修 | P1 |
| 六 | script 对象形态被拒 | 未修 | P1 |
| 七 | JSON 裸引号解析失败 | 未修 | P1 |
| 八 | 失败时无模型原始输出 | 未修 | P2 |
| 九 | gxh.vip.qq.com 不受信 | 未修（日志面已因负缓存改善） | P2 |
| 十 | off 档语义误导 | 未修 | P3 |

## 关键架构事实（决定修复插入点）

理解下面这条链是问题四/五/六修复位置的正确性前提：

```
narrator.decide()                    ← 模型 JSON 原文 → 解析出的"原始决策"
  ↓ service.decide() :5086
reconcileTransportReferences(...)    ← 唯一的"字段补救"层（authored-actions.ts）
  ↓ 返回"raw 基决策"（localMedia/nativeFace/messageReactions/groupReply 均在）
tryDecide() :5364
  ├─ :5421/:5445 requiresVisibleReplyRecovery(decision)   ← 问题四的闸门（作用于 raw 基）
  ├─ :5465 hasRequiredNarrativeScript(decision)           ← 问题六的闸门（作用于 raw 基）
  └─ :5536 normalizeDecision(raw) → 最终规范化决策（投递/落库用）
       └─ :5600 buildCommit 再从 raw 回挂 groupReply/messageReactions/localMedia/nativeFace
```

因此：**问题五的提权放在 `reconcileTransportReferences`（既修复闸门视野、也修复 5602 的 raw 读取）；问题四的判定放行检查 `decision.localMedia`（提权后嵌套形态已到顶层）；问题六的 script 归一必须发生在 :5465 闸门之前（即 decide() 返回链或 reconcile 层），只改 normalizeDecision 不够。**

---

## 问题二（P0）：串行队列永久死锁

### 现状证据

- `advanceStory` :4586 仍把模型调用+投递全程包在 `serial` 内
- 七处发送/OneBot 调用均无超时：:7468 `session.send`、:7523 私聊 `bot.sendMessage`、:3374 群发、:3162/:3165 表情包、:3226 原生表情、:3059 `setMsgEmojiLike`、:4657 `get_group_msg_history`
- `withTimeout`（:11077 附近）仍只用于图片/音频下载（:3957/:3985）

### 修复方案

1. **七处超时包装**（最小改动，报告原方案）：

```ts
const receipt = await withTimeout(Promise.resolve(session.send(outgoingContent)), 30_000)
```

逐点：:7468、:7523、:3374、:3162、:3165、:3226 包 30s；:3059 `setMsgEmojiLike` 包 10s（点赞非关键路径，快失败）；:4657 `get_group_msg_history` 包 30s（与 forward 读取一致）。

注意：`withTimeout` 超时后**底层请求仍在飞**，迟到成功回执可能重复投递——对发送类调用，超时应视为"结果未知"而非"失败"。现有 `recordOutgoingDeliveryFailure(status='failed')` 会把账本标 failed；更稳妥是标 `pending` 交给待投递补偿幂等去重。实施时：超时包装抛出的错误信息含 `timeout after`，在 catch 里识别并走 `pending` 记录（复用 stream-finalization 的语义）。

2. **看门狗**（可观测性）：`serial` 入口记录 `(id, 开始时间, 任务序号)`；`setInterval`（60s，挂 `ctx`）扫描占用超 120s 的队列打 warn（含故事 ID 与耗时）。低频扫描，无锁开销。

### 测试

- 单测：fake pending-forever 的 sendMessage → advanceStory 在 30s（测试注入缩短）后释放队列，后续 serial 任务可执行
- 回归：现有 843 项全量
- 手工复现：临时阻断 OneBot 网络发送，观察 30s 后日志出现投递失败而非永久静默

### 风险

低。超时值 30s 与 `send_forward_msg` 现值一致；唯一注意点是上述"迟到回执"语义选择。

---

## 问题三（P1）：lite 档缺三段说明

### 现状证据

`narrator.ts:1724` lite 分支 return 数组中 `chatActionInstruction` / `quotedMessageInstruction` / `stickerInstruction` 出现 0 次；full/standard 分支 :1797-1799 齐全。`toPromptPayload` :2072-2073 不看档位照发 `chatCapabilities` / `stickerCatalog`。

### 修复方案

在 lite 分支 return 数组的 `liteTransport` 行（:1730 附近）之后插入：

```ts
chatActionInstruction(chatCapabilities),
...(hasQuotedMessage ? [quotedMessageInstruction(hasQuotedMessage)] : []),
...(stickerCatalog?.length ? [stickerInstruction(stickerCatalog, chatCapabilities?.expressionThreshold ?? 0.7)] : []),
```

条件展开保持 lite 的"按需精简"（无表情库/无引用时不加空说明），与 `writingAffordances` 的条件风格一致。**连带收益**：`chatActionInstruction` 内的 "Do not write bracketed face labels in reply text." 回归 lite，抑制 `[sticker:xxx]` 文本泄漏的另一半成因。

### 测试

- 单测：lite 档 + stickerCatalog → 系统提示词含 `CURRENT LOCAL STICKER LIBRARY` 与 `localMedia` 字段名；无目录时不含
- 回归：现有 lite 档提示词快照类测试（如有）需同步更新

### 风险

低。lite token 预算增加约 150-250 token（仅当表情库/引用开启时）。

---

## 问题四（P1）：空正文+表情包被判回复缺失

### 现状证据

- `hasStructuredInteraction` :12105：`content` 空白 → `false`
- 抛弃闸 `requiresVisibleReplyRecovery` :11927 `return !hasStructuredInteraction(decision.interaction)`
- `normalizeInteraction` 的宽松分支（空 content 合法降级 none）原样——两标准不一致

### 修复方案

**依赖问题五先行**（嵌套 localMedia 提权到顶层后此处才看得到）。改 `requiresVisibleReplyRecovery`：

```ts
export function requiresVisibleReplyRecovery(phase, groupContext, decision) {
  if (phase !== 'user-message') return false
  if (groupContext) return !hasStructuredGroupReply(decision)
  if (hasStructuredInteraction(decision.interaction)) return false
  // 合法的"只发表情/动作不配文字"回合：interaction 为弱形态但携带
  // localMedia/nativeFace/messageReactions 任一动作时不是回复缺失
  //（placement:standalone 本就表示不配文字）。
  return !(decision.localMedia || decision.nativeFace || decision.messageReactions?.length)
}
```

不改 `hasStructuredInteraction` 本体（它另有 :11937-11948 的展示用途，改本体波及面大）。

### 测试

- 单测：`interaction={seen:true,reply:{mode:'immediate',content:''}} + localMedia` → 不触发恢复重写；同 interaction 无任何动作 → 仍触发
- 现有 `requiresVisibleReplyRecovery` 相关回归确认无翻转

### 风险

低。语义放宽方向与 `normalizeInteraction` 既有宽容哲学一致。

---

## 问题五（P1）：动作字段嵌套不提权

### 现状证据

`authored-actions.ts:28-33` 仅 `groupReply` 一条提权；`localMedia` / `nativeFace` / `messageReactions` 的 `interaction.X` 与 `interaction.reply.X` 两种嵌套无补救。

### 修复方案

在 groupReply 提权块之后追加：

```ts
// 动作字段嵌套兼容（与 groupReply 同因）：模型常把动作字段塞进
// interaction 或 interaction.reply。提权到顶层，使 requiresVisibleReplyRecovery
// （问题四放行依据）、resolveSticker/resolveNativeFace、buildCommit 的
// raw 回挂全部可见。两种嵌套取先命中者。
for (const key of ['localMedia', 'nativeFace', 'messageReactions'] as const) {
  if (decision[key]) continue
  const interaction = decision.interaction as Record<string, unknown> | undefined
  const nested = interaction?.[key]
  const deeper = (interaction?.reply as Record<string, unknown> | undefined)?.[key]
  const value = nested ?? deeper
  if (value != null && typeof value === 'object') decision = { ...decision, [key]: value }
}
```

位置在 `reconcileTransportReferences` 内、函数开头的字符串检查之后。注意该函数有两处调用（decide() 返回链 :5086、tryDecide 恢复路径 :5518），都会经过，无需重复。

### 测试

- 单测：三种字段 × 两种嵌套形态 → 提权后 `decision.localMedia` 等可见；顶层已有值时不覆盖
- 问题四的用例依赖本项先行

### 风险

低。纯字段搬运，不改语义；`typeof value === 'object'` 防标量误提。

---

## 问题六（P1）：script 对象形态被拒

### 现状证据

- 闸门 :5465 `hasRequiredNarrativeScript(decision)`（`typeof script === 'string'`）
- `normalizeDecision` :12259 同样只取字符串

### 修复方案

**归一化必须发生在 :5465 之前**——放在 `decide()` 返回链，即 `reconcileTransportReferences` 调用的内侧（narrator 输出的第一步处置）。新增纯函数（建议放 service.ts 模块级，便于测试）：

```ts
/** 模型偶发把 script 输出成对象（{tag,content} / {entries:[…]}，形态模仿
 * recentScript 的载荷结构）。散文完整，做无损归一而非弃稿。 */
export function normalizeScriptField(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const record = raw as Record<string, unknown>
  for (const key of ['content', 'text', 'prose', 'narration', 'body', 'script']) {
    if (typeof record[key] === 'string' && (record[key] as string).trim()) return record[key] as string
  }
  if (Array.isArray(record.entries)) {
    return record.entries
      .map((entry: unknown) => {
        const item = entry as Record<string, unknown> | null
        const text = typeof item?.text === 'string' ? item.text : typeof item?.content === 'string' ? item.content : ''
        return text.trim()
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}
```

接入点：`decide()` :5086 的返回改为先取 `raw = await this.narrator.decide({...})`，应用 `raw = { ...raw, script: normalizeScriptField(raw.script) || raw.script }` 后再进 reconcile（保持原值穿透，避免把合法空串覆盖成假空）。`normalizeDecision` :12259 改用 `normalizeScriptField(raw?.script)` 兜底二次防线。`hasRequiredNarrativeScript` 不动（归一后必为字符串）。

### 测试

- 单测：`{tag,content}` / `{entries:[{text}]}` / 顶层数组（报告提及的第三形态，函数已覆盖 Array 直接 join？——注意当前实现数组返回 ''，**实施时补顶层数组分支**：`Array.isArray(raw)` 时按 entries 同法拼接）/ 正常字符串 / 空对象
- 集成：构造对象 script 的 decide 返回 → :5465 闸门通过 → 落库 script 为拼接字符串

### 风险

低-中。entries 拼接的分段顺序假设模型按时间输出；`occurredAt` 排序不做（散文连贯性优先，乱序属模型输出病，归一不放大）。

---

## 问题七（P1）：JSON 裸引号解析失败

### 现状证据

`jsonCandidates` :1387-1408 三层（直解/围栏/括号平衡）；无裸引号修补。报告实测错误位置恒在开头 140 字符内（script 首段引用聊天内容）。

### 修复方案

新增 `repairBareQuotes(text: string): string`，并作为**第四层候选，插入顺序必须在 balancedJsonValues 之前**（报告强调的顺序约束：平衡扫描会因状态错乱抢先切出"可解析但残缺"的片段）：

```ts
/** 逐字符扫描：字符串内部遇 '"' 时前瞻跳过空白，下一字符是 , } ] : 之一
 * 视为真结束符，否则判定为散文裸引号，补 '\' 逃生并留在字符串内。 */
function repairBareQuotes(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (ch === '\\') { out += ch + (text[i + 1] ?? ''); i++; continue }
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      const next = text[j]
      if (next === ',' || next === '}' || next === ']' || next === ':' || j >= text.length) {
        inString = false
        out += ch
      } else {
        out += '\\"'   // 裸引号：补逃生
      }
      continue
    }
    out += ch
  }
  return out
}
```

接入：`jsonCandidates` 内、围栏提取之后、平衡扫描之前：

```ts
for (const candidate of [...candidates]) add(repairBareQuotes(candidate))
```

（修补版与原文都留在候选集，由 parseJsonResponse 逐个尝试，天然回退。）

### 测试

- 单测：报告原始样本（`"晚上好喵"\n"喂喂"` 形态）→ 修补后可解析且 script 含全部引文；正常 JSON 过修补不变；`"key": "a\"b"` 合法逃生不被二次转义；修补候选排在平衡扫描产物之前
- 边界：字符串内 `": "`（引号后冒号）会被误判为结束符——接受（该形态在散文 JSON 值内极罕见，且失败仅回退到下一候选）

### 风险

中。误修补可能产生"语法对但语义错"的候选——靠"修补与原文并存 + 逐候选尝试 + 结果仍过 script/interaction 校验闸"三层兜底。

---

## 问题八（P2）：失败时无模型原始输出

### 现状证据

- :5465 throw 前无日志；`当前剧本内容` :5475 在 throw 后不可达
- narrator :1028-1032 catch 只记 error 对象

### 修复方案

1. :5465 throw 前：`this.reportOperation('diagnostic', 'warn', story, phase, '主叙事无可用 script，原始决策=%s', safeJsonPreview(decision))`
2. narrator :1030 catch：`this.logger?.debug('叙事模型返回了无效 JSON：%s\n原文(截断)=%s', error, text.slice(0, 800))`（debug 级 + 截断，隐私与刷屏双控）
3. 可选增强：错误对象附加 `error.rawPreview = text.slice(0, 400)`，上层 `describeHttpError` 汇总时自动带出

`safeJsonPreview` 已存在（:12113），直接复用。

### 测试

现有日志类回归 + 人工触发一次坏输出观察日志。

### 风险

无。纯诊断输出，已按 verbosity/级别门控。

---

## 问题九（P2）：gxh.vip.qq.com 不受信

### 现状证据

:331 白名单五项原样。近期负缓存改造后该域首现即判死 `untrusted-host`（info 一次+后续静默），日志不再误导，但图片仍进不了视觉通道。

### 修复方案

:331 数组追加 `'gxh.vip.qq.com'`。注释同步注明"QQ 表情包 CDN（市场/商店表情资源域）"。

### 测试

`isTrustedImageHost` 单测加一行；冒烟：发一张该域表情确认进入视觉管线（`deadImageSources` 不再记录该域）。

### 风险

无。域名属腾讯系 CDN，与现有五项同级信任。

---

## 问题十（P3）：off 档语义误导

### 现状证据

`specialization.ts:150` off → `{tier:'full', family:'generic', source:'manual'}`；`narrator.ts:347` sideSpecialty 只识 lite/full；日志 :356 `模型特化已切换 档位=full 来源=manual` 无法区分 off 回退与显式 full。

### 修复方案（可观测性优先，不改行为）

1. 日志区分：off 时打 `档位=full(off→legacy 完整合约) 家族=generic(忽略)`，显式 full 打 `档位=full(显式)`。改 narrator :353-356 的 profile 构造处或日志行（resolveManualSpecialty 返回值不变，避免波及判断逻辑——在日志侧读 `this.config.specialization` 原值区分）
2. Console 描述已在 rc51 文档批次写明"关闭（默认）：rc12 原始完整合约"——保持，不改名（改选项名是破坏性配置变更，收益低）
3. `sideSpecialty` 支持 standard：`tier: specialization === 'lite' ? 'lite' : specialization === 'standard' ? 'standard' : 'full'`（压缩/时间导演的 standard 档提示词组装已存在，只是从未被选中）

### 测试

specialization 现有单测 + 日志快照。

### 风险

低。3 是行为微变（standard 档侧端从 full 变 standard），与主档一致性是修正而非破坏；文档同步一行。

---

## 实施顺序与批次建议

1. **批次 A（P0+P1 格式容错组，一次构建）**：问题二 → 问题五 → 问题四（依赖五）→ 问题六 → 问题三 → 问题七
2. **批次 B（P2+P3）**：问题八 → 问题九 → 问题十
3. 每批次后全量回归 + typecheck；批次 A 完成后建议真实模型冒烟一轮（表情包 standalone、坏 JSON 样本回放）

## 与 rc52 现有待打包内容的关系

当前工作区已累积：图片负缓存泛化、onebot-url 外层传播、重定向逐跳跟随、表情包投递 file:// 回退（问题一的完整修复）、supersede 插桩、天气领地让渡。本文档九项全部叠加其上，共同构成 rc52 发布内容。
