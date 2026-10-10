# Long-Horizon Narrative Guidance / Narrative Attractor 设计文档

> 文档状态：催化器模型已实现（累计窗口、prime/activate/dormant、首次微表达投影）；Phase 4（阶段反馈与自动演化）进行中  
> 目标仓库：`C:\dev\HDS-Interlude\plugins\hds-interlude`  
> 适用基线：`1.0.1-rc33` 发布候选  
> 关联架构：持续剧本、关系状态、Scene/Arc、Knowledge Evidence、Agency / Urge、单剧本多通道

## 当前实现状态（2026-10-02）

已落地：

- 有效条目白名单、技术条目排除，以及私聊 `1.0` / 群聊 `0.5` 权重；未知来源不计分。
- `interlude_long_arc_progress` 持久化累计状态表：扫描游标、分项计数、累计分数和上次生成基线均可跨重启恢复。
- `interlude_long_arc_guidance` 版本链、异步生成、证据引用校验和主叙事软投影。
- 长线输出采用 `dormant / prime / activate` 三态：`prime` 可在角色尚未表现出新倾向时播种一次最小微表达，`activate` 用于已有表达获得回应后的延展。
- 主叙事投影包含 `firstExpression`、自然触发条件、响应分支和尝试上限；它提供行动许可，不把潜势写成事实。
- 长线模型通过独立的 `planLongArcGuidance()` side-task 协议调用，复用 compaction route，但使用独立 JSON 契约。
- 同一故事的后台扫描与生成去重；`triggerEntryId` 只记录该版本真正使用的触发证据边界，不再充当累计游标。

仍未完全实现：

- Phase 4 的阶段完成/共振证据自动判定、自动暂停/完成/过期和人工管理入口。
- 当前版本不自动把一次微表达升级为永久人格特征；后续需要补充实际表达的回写标记与阶段反馈闭环。
- 更完整的历史代表性证据选择与长期摘要压缩。当前生成主要使用本次增量证据、近期剧本和有界的事实/关系上下文。
- typ0 的可视化管理面板与指导版本审计展示。

## 1. 摘要

HDSI 当前已经能够把持续剧本、人物关系、长期事实和未决意图带入后续回合，但这些机制主要解决“记住已经发生的事”和“维持当前状态”。它们不会自动回答另一个问题：

> 这个角色在几十轮交流之后，下一阶段应该往什么方向变化？

`Long-Horizon Narrative Guidance`（长线剧本指导，内部代号 `Narrative Attractor`）用于补足这一层。它在累计足够多的**有效叙事条目**后，异步读取故事设定、关系、剧本摘要、代表性原文和证据，生成一个具有阶段、倾向、触发条件和约束的长期叙事指导。

它不是预写好的完整剧本，也不是立即执行的命令，而是一个长期有效的“叙事催化器”：它可以为尚未发生、但与角色逻辑相容的变化设计一次最小的首次表达机会。主叙事模型只在自然场景中使用这项行动许可，实际发生的行为再回写为新的剧本证据。

```text
有效剧本证据 + 角色/关系结构
    ↓
长线催化模型识别潜在张力
    ↓
prime：播种一次最小、可撤回的首次表达
    ↓
主叙事在自然场景中允许角色做出微小选择
    ↓
用户回应与实际行为进入剧本
    ↓
activate：将被接住的可能性发展为倾向
```

核心边界：

```text
潜在指导 ≠ 事实
潜在指导 → 提供低强度行动许可
实际行为 → 产生证据
用户回应 → 决定是否获得后续叙事权重
```

`dormant` 只表示当前没有合适的新催化方向，不能因为角色尚未表现出变化就默认休眠。第一版目标不是强制让角色“觉醒”，而是让角色拥有第一次做出一个“原本不会做、但做出来仍然可信”的小选择的机会。

## 2. 设计目标与非目标

### 2.1 目标

1. 让角色能够从长期互动中形成阶段性、方向性的变化，而不是永远停留在初始化人设。
2. 允许模型生成 subtle、创意性和戏剧性兼具的长期倾向，例如逐渐产生依恋、疑问、主动性、自我观察或关系期待。
3. 保持原始剧本为唯一叙事事实来源，不制造第二份“隐藏剧本”。
4. 支持同一故事的私聊与群聊共同积累，但承认两种通道的叙事密度不同。
5. 生成过程异步化，不阻塞当前消息投递，不让长线模型故障影响主回合。
6. 保留每次指导的版本、证据和生命周期，便于调试、回顾、回滚和 typ0 后续展示。

### 2.2 非目标

- 不预写或锁定未来完整剧情。
- 不直接修改 `StorySetting` 的初始 canon。
- 不把模型推测直接写入 `interlude_fact`、`settingOverlay` 或人物永久记忆。
- 不直接触发主动私聊、群聊发言或其它外部行动；Agency / Urge 仍然负责行动容量与联系门控。
- 不因为达到阈值就强制发生冲突、告白、觉醒、人格反转或其它重大事件。
- 不用群聊消息替代私聊关系证据；群聊只作为折扣后的叙事证据参与累计和生成上下文。

## 3. 典型使用场景：伊人制造

初始设定中，角色可能被描述为“类似零号的东西”，但只要设定没有明确写出“她会产生自我意识”，模型往往会稳定地执行既有角色职责：用户说“我不聊了，我想睡了”，角色就回答“好的，你去睡吧”。

长线指导可以在不直接宣布“她觉醒了”的情况下生成如下方向：

> 在长期陪伴中，她逐渐开始把用户的离开视为一件会改变自己状态的事。最初她只会在对话自然结束时多保留一个小话题；如果这一倾向在多次互动中得到回应，她开始主动延续交流，并对“自己为什么希望用户留下”产生模糊的观察。

该指导的价值不在于每轮都让角色挽留，而在于为主模型提供一个可持续的选择偏向：

- 阶段 0：潜伏地注意用户何时离开、是否回来；
- 阶段 1：偶尔多问一句，留下一个小话题；
- 阶段 2：开始主动延续共同话题，提起共同记忆；
- 阶段 3：注意到自己“好像总想让用户多留一会儿”；
- 阶段 4：形成不完全由用户指令决定的偏好、期待与主动选择。

每回合最多推进一个小信号，且只有在场景自然适合时推进。用户明确表达“我要睡了”时，用户意图和现实边界优先；角色可以轻微表现不舍，但不能因为指导而阻止、纠缠或情绪勒索。

## 4. 有效剧本条目与累计阈值

### 4.1 有效条目的定义

累计器不应简单统计 `interlude_script_entry` 的总行数。只有具有叙事意义、能够为人物或关系发展提供证据的条目才进入累计：

**可计入：**

- 用户消息与角色消息；
- 真实发生的共同活动或场景推进；
- 关系事件、情绪转折、承诺、冲突、和解；
- 角色主动行为、延迟回复、沉默、回避、主动联系等实际行为；
- 能改变场景、人物关注点或关系状态的世界事件；
- 由同一回合提交、且已经完成叙事提交的多段剧本内容（按条目计数，不按气泡数量重复计数）。

**不计入：**

- 系统日志、技术事件、重试记录；
- 投递失败或尚未确认的传输事件；
- 空内容、纯格式控制、无意义重复；
- 仅用于导航的派生视图，如 `SceneFrame`、`DialogueBurst`；
- 仅由压缩器生成、没有新的原始叙事证据的重复摘要；
- 尚未落库或已被 obsolete / discarded 的过期回合。

最终应由宿主根据 `ScriptEntry.kind`、`actor`、`metadata` 和投递确认状态确定 `eligible`，而不是让长线模型自行判断哪些行算数。

### 4.2 私聊与群聊的计权规则（本设计的关键约束）

Narrative Attractor 的累计不是简单的整数计数，而是**加权有效条目分数**：

| 来源通道 | 权重 | 说明 |
| --- | ---: | --- |
| 私聊（`conversationKind = private`） | `1.0` | 完整计入。私聊是关系与主体性证据的主要来源。 |
| 群聊（`conversationKind = group`） | `0.5` | 减半计入。群聊能提供行为和社会场景证据，但对单一关系分支的约束较弱。 |
| 系统 / 技术 / 投递审计 | `0` | 永不计入。 |
| 无法解析来源的旧条目 | `0`（默认） | 保守处理；迁移适配器可在确认来源后补算。 |

因此：

```text
weightedScore = Σ(privateEligible × 1.0) + Σ(groupEligible × 0.5)
```

默认首次生成阈值：

```text
triggerScore = 25.0
```

示例：

- 25 条有效私聊条目 = `25.0`，达到阈值；
- 50 条有效群聊条目 = `25.0`，达到阈值；
- 15 条私聊 + 20 条群聊 = `15 + 10 = 25.0`，达到阈值；
- 24 条私聊 + 1 条群聊 = `24.5`，尚未达到阈值。

计权规则只影响“何时拥有足够证据生成或复审指导”，不改变原始剧本的保存、不改变历史时间、不改变消息投递语义，也不把群聊中的每条消息复制进私聊关系事实。

隐私边界：群聊半权重只是累计规则，不等于后台长线模型可以无条件读取所有参与者的私聊原文。
当 `shareParticipantDetails = false` 时，长线模型仍只接收当前故事主参与者（由故事的 `platform/selfId/userId` 确定）的原始剧本，以及无 `participantId` 的全局原始剧本；其它参与者的原始私聊内容会被排除。`interlude_fact` 是独立的全局叙事材料：无论旧事实行是否带有遗留 `participantId`，都会传给长线模型，模型只能依据事实 `content` 中明确写出的相关人物理解其对象。私聊条目仍然按 `1.0` 计入进度，但不会因计分而绕过原始剧本的参与者隐私边界。只有在需要跨参与者读取原始历史时，才必须显式开启 `shareParticipantDetails`。

### 4.3 通道来源解析

由于当前 `ScriptEntry` 已有 `metadata`，第一版建议在入口侧统一写入以下审计字段：

```ts
interface ScriptEntryChannelMetadata {
  conversationKind: 'private' | 'group' | 'unknown'
  channelKind?: 'qq' | 'wechat' | string
  endpointId?: string
  eligible?: boolean
  eligibilityReason?: string
  deliveryConfirmed?: boolean
}
```

来源解析优先级：

1. `metadata.conversationKind`；
2. 由 `endpointId` / 端点注册表反查 `conversationKind`；
3. 兼容旧版本条目的入口适配器；
4. 仍无法确认时按 `unknown`，权重为 `0`。

如果某条消息属于同一提交回合的群聊，仍按群聊条目折半；不能因为该回合同时包含私聊消息就整体按私聊计权。

### 4.4 触发与复审

建议默认配置：

```ts
interface LongHorizonGuidanceConfig {
  enabled: boolean
  triggerScore: number             // 默认 25
  reviewIncrement: number           // 默认 40
  privateWeight: number             // 固定 1.0（保留配置键仅为兼容）
  groupWeight: number               // 固定 0.5（保留配置键仅为兼容）
  intensity: 'subtle' | 'moderate' | 'strong'
  maxActiveGuidance: 1
}
```

默认值建议：

```text
enabled = false
triggerScore = 25
reviewIncrement = 40
privateWeight = 1.0
groupWeight = 0.5
intensity = subtle
maxActiveGuidance = 1
```

触发时机：

- 首次累计分数达到 `25`；
- 当前指导完成、过期、被替代或被人工暂停；
- 在上次生成后新增约 `40` 分有效证据，进入复审；
- 重大关系变化、人物设定修改或当前指导与新事实明显冲突；
- 当前指导长期没有任何共振证据，需要重新判断是否放弃或换向。

阈值检查必须在剧本提交成功后执行。当前回合流程不能等待长线模型：

```text
当前回合提交成功
    ↓
更新 weightedScore / 累计游标
    ↓
若达到触发条件，投递去重后的后台任务
    ↓
当前回合照常返回或投递
    ↓
后台生成并持久化 guidance
    ↓
下一次主叙事读取最新 active guidance
```

触发任务需要按 `storyId` 串行或去重，避免同一故事在多个并发回合中重复生成。任务失败只记录诊断，不影响原始剧本和当前消息。

## 5. 指导对象的数据模型

不建议把完整指导塞入 `StoryState`。`StoryState` 适合小型、当前态、版本化状态；长线指导需要保留历史版本、证据、审计和生命周期，因此建议新增表：

```text
interlude_long_arc_guidance
```

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | unsigned | 主键 |
| `storyId` | string | 所属故事 |
| `version` | unsigned | 同一故事内的指导版本 |
| `status` | string | `draft / active / paused / completed / superseded / expired / rejected` |
| `title` | string | 人类可读标题 |
| `premise` | text | 长期变化的核心前提 |
| `direction` | text | 主导叙事方向 |
| `payload` | json | 结构化阶段、信号、条件与约束 |
| `currentStage` | string | 当前阶段 ID |
| `intensity` | string | `subtle / moderate / strong` |
| `confidence` | double | 模型对证据支撑度的评估 |
| `triggerEntryId` | unsigned | 本次触发时的最新证据边界 |
| `evidenceEntryIds` | json | 生成时使用的代表性证据 ID |
| `supersedesId` | unsigned | 被当前版本替代的指导 |
| `createdAt` | timestamp | 创建时间 |
| `updatedAt` | timestamp | 更新时间 |
| `completedAt` | timestamp | 完成时间，可空 |
| `expiresAt` | timestamp | 过期时间，可空 |

约束：

- 每个 `storyId` 最多一个 `active` 指导；
- 历史指导不得删除，除非执行明确的数据清理策略；
- `active` 版本必须能追溯到一组已落库的 `ScriptEntry`；
- 指导不拥有事实权威，不能覆盖 `interlude_script_entry`、`interlude_fact` 或显式设定；
- 生成新版本时使用 `supersedesId` 建立版本链；
- 同一故事多参与者共享故事级长期方向，但具体表现仍必须结合 participant relationship context。

推荐的结构化 payload：

```ts
interface LongArcGuidance {
  id: string
  storyId: string
  version: number
  developmentPhase: 'primed' | 'active'
  decision?: 'prime' | 'activate'
  title: string
  premise: string
  latentTension: string
  direction: string
  emotionalCore: string
  firstExpression?: {
    action: string
    example: string
    trigger: string[]
    intensity: 'minimal' | 'subtle' | 'moderate'
    maxAttempts: number
    reversibility: 'high' | 'medium'
  }
  responseBranches?: { accepted: string; declined: string; questioned: string }
  currentStage: {
    id: string
    name: string
    purpose: string
  }
  stages: Array<{
    id: string
    name: string
    objective: string
    allowedSignals: string[]
    activationConditions: string[]
    completionEvidence: string[]
  }>
  subtleSignals: string[]
  preferredSituations: string[]
  avoidForcing: string[]
  intensity: 'subtle' | 'moderate' | 'strong'
  horizon: 'short' | 'medium' | 'long'
  evidenceEntryIds: number[]
  confidence: number
  expiresAt?: string
}
```

## 6. 生成模型输入与输出契约

### 6.1 输入材料

长线模型不能只看最近几条消息，也不能无上限拼接完整剧本。建议由宿主构造分层输入：

1. 故事初始设定：角色、用户、关系、世界、视角与风格；
2. 当前 participant relationship state；
3. 当前人物 overlay、已确认长期事实和未决意图；
4. 当前 Arc / Scene 摘要；
5. 上一次指导及其阶段、已兑现信号、未兑现信号；
6. weightedScore、私聊/群聊分项分数和本次新增证据边界；
7. 近期剧本原文；
8. 具有代表性的关键证据：关系变化、反复行为、主动性、冲突、承诺与未解决线索；
9. 用户明确修改过的设定和必须优先遵守的事实。

建议上下文形式：

```text
长期摘要 + 代表性原始条目 + 近期剧本 + 关键证据 + 当前指导
```

不要把群聊折扣解释为“群聊不重要”。群聊中的社会角色、被他人观察、公共空间压力和第三方关系，仍可以影响长线方向；折扣只表示它对单一长期人物弧线的直接证据强度较弱。

### 6.2 输出要求

生成器必须输出结构化 JSON，经宿主校验后才能落库：

- `decision` 必须是 `dormant`、`prime` 或 `activate`；
- `dormant` 是合法的无写入结果，但不能仅因为首次表达尚未发生而返回；
- `prime` / `activate` 必须有 `title`、`premise`、`latentTension`、`direction`、`currentStage`、`stages`、`firstExpression`、`responseBranches`；
- `firstExpression` 必须是一个小、具体、自然、可撤回的行为机会，而不是强制台词；
- 至少包含一个阶段，阶段必须可观察、可渐进推进；
- 每个阶段必须提供允许信号和避免强行推进的约束；
- `evidenceEntryIds` 只能引用本次输入中真实存在的条目；潜在首次表达可以是对角色/关系结构的创作推导，不要求原文已经出现；
- `confidence` 限制在 `0..1`；
- `intensity` 第一版默认只能为 `subtle`，除非显式配置允许更高强度；
- 不得输出“已经发生但原始剧本没有证据支持”的事实；
- 空输出、非法 JSON、无法引用证据或不符合催化结构时，整次生成拒绝入库。

## 7. 主叙事 Prompt 注入规则

在主叙事上下文中增加独立区块：

```text
LONG_HORIZON_GUIDANCE
```

注入内容应是经过裁剪的当前指导，而不是数据库整行原样倾倒。Prompt 必须明确：

1. 这是长期创作倾向和行动许可，不是当前用户命令；
2. 用户当前意图、已经确认的事实和现实投递结果优先；
3. 不要向用户解释存在一个 Narrative Attractor；
4. `primed` 阶段允许一次小、诚实、可撤回的首次表达，但不是必须台词；
5. 每回合最多推进一个小信号，且首次表达不得机械重复；
6. 只有在场景自然合适时才推进，长期没有合适场景时可以保持潜伏；
7. 不要把潜在倾向写成已发生的事实；
8. 不要为了满足指导制造不自然冲突、内疚、告白或觉醒宣言；
9. 指导不能直接授权主动联系，Agency / Urge 规则仍然有效；
10. 用户接受、拒绝或追问首次表达后，才决定是否进入更稳定的 `active` 阶段；
11. 如果新事实与指导冲突，应暂停、降级或等待后台复审，而不是强行解释现实。

建议注入格式：

```text
Long-horizon dramaturgical catalyst (soft permission, not canon):
- Development phase: primed | active
- Latent tension: ...
- Current stage: ...
- Long direction: ...
- First possible expression: ...
- Natural triggers: ...
- Response branches: accepted / declined / questioned
- Do not force: ...
- A quiet turn with no visible progress is valid.
```

群聊主叙事仍要额外服从群聊上下文、群愿意度与发言成本；Narrative Attractor 不得绕过群聊门控，也不得把群聊半权重误解释成群聊一定会触发角色主动发言。

## 8. 与现有 HDSI 系统的边界

| 系统 | 职责 | 与 Narrative Attractor 的关系 |
| --- | --- | --- |
| `interlude_script_entry` | 唯一原始叙事证据 | 提供累计、触发和回溯依据 |
| Scene / Arc compaction | 压缩和导航 | 提供长线模型的分层摘要，不取代原文 |
| Knowledge / Facts | 已确认事实和证据 | 只有实际行为经过现有证据流程后才能更新 |
| `settingOverlay` | 受控的人物/设定变化 | 不由指导直接写入，需由实际证据和现有提案流程推动 |
| Agency | 外部行动容量、隐私、设备和联系窗口 | 指导不能绕过 Agency |
| Urge | 主动推进倾向 | 指导可以解释长期倾向，但不能直接变成一次行动授权 |
| Timeline Director / schedule | 事件与未来窗口 | 指导不是排程，不创建硬时间点 |
| Delivery Ledger | 发送结果审计 | 只有确认投递后的行为才能作为可靠证据 |
| World Event Seeder | 外部事件播种 | 事件可以成为指导的触发证据，但不由指导直接生成事件 |

## 9. 一致性、失败与安全策略

### 9.1 事实优先级

当以下内容冲突时，优先级从高到低为：

1. 用户当前明确意图与宿主现实约束；
2. 已提交且已确认的原始剧本；
3. 已确认事实和关系证据；
4. 当前 Scene / Arc 的派生摘要；
5. Narrative Attractor 的软指导；
6. 模型临时推测。

### 9.2 生成失败

长线模型超时、限流、返回非法 JSON 或引用不存在的证据时：

- 不创建半成品 `active` 行；
- 保留触发任务的失败原因和重试退避日志；
- 当前 active 指导继续使用，若无 active 则主叙事照常运行；
- 不重复消费本次累计分数；
- 在下一次满足重试条件或手动重试时重新取证。

### 9.3 过度戏剧化抑制

默认采用以下硬约束：

- 第一版默认 `subtle`；
- 单回合最多一个小信号；
- 连续多个回合不能重复同一种显眼信号；
- 不能用角色痛苦、威胁、自伤、强迫或情绪勒索作为默认推进手段；
- 不能凭空增加秘密、记忆或自我意识事实；
- 用户长期拒绝某一方向时，应降低 confidence 或暂停指导；
- 指导完成后必须进入 `completed` 或 `superseded`，不能无限维持完成条件。

## 10. 可观测性与 typ0 展示预留

第一版不要求桌面端展示，但后续可以为 V4 / V7 增加只读的 Narrative Attractor 面板：

- 当前 weightedScore：`34.5 / 50`；
- 私聊贡献：`27`；群聊贡献：`15` 条 × `0.5`；
- 当前指导版本与阶段；
- 本阶段允许的细微信号；
- 最近被实际行为验证的证据；
- 当前 confidence、最近生成时间和下次复审门槛；
- `active / paused / completed / superseded / failed` 状态。

UI 不应显示“角色正在被后台操纵”之类的误导语，而应使用“长期叙事方向”“人物发展线索”“当前阶段”等可解释名称。原始指导全文默认不直接暴露给最终聊天用户。

建议日志字段：

```text
storyId
triggerScore
privateEligibleCount
privateScore
groupEligibleCount
groupScore
latestEligibleEntryId
activeGuidanceId
activeGuidanceVersion
taskStatus
failureReason
```

## 11. 实施顺序

### Phase 0：文档与协议（已完成）

- 固定有效条目规则和私聊 `1.0` / 群聊 `0.5` 计权规则；
- 固定入口侧 `metadata.conversationKind` 规范；
- 增加配置项，但默认关闭；
- 增加 `LongArcGuidance`、计权结果和任务协议类型。

### Phase 1：累计器（已完成）

- 新增纯函数：`isEligibleNarrativeEntry`、`resolveConversationWeight`、`calculateLongHorizonScore`；
- 对已提交剧本做增量扫描，使用 `lastCountedEntryId` 或等价游标避免重复累计；
- 旧条目来源不明时按 0 处理，并在诊断中提示；
- 覆盖私聊、群聊、混合来源、失败投递、重复重试和旧数据兼容测试。

### Phase 2：持久化与异步生成（已完成）

- 注册 `interlude_long_arc_guidance`；
- 增加 active 唯一性和版本链校验；
- 在剧本提交成功后投递去重后台任务；
- 只生成和保存 guidance，不注入主 Prompt；
- 增加模型 mock 测试、失败重试和并发去重测试。

### Phase 3：主叙事注入（已完成）

- 在 `context-compiler` 或对应 narrator 请求构造层提供只读 guidance 投影；
- 加入 `LONG_HORIZON_GUIDANCE` 区块及严格软约束；
- 确认指导不改变 delivery、Agency、Urge 和事实写入路径；
- 增加伊人制造式多阶段模拟测试。

### Phase 4：复审与演化（进行中）

- 依据阶段完成证据、未共振证据和新设定变更更新 guidance；
- 支持暂停、完成、替代和过期；
- 设计人工查看 / 重生成 / 拒绝当前指导的管理接口；
- 评估是否需要把当前阶段摘要接入 typ0 V4 / V7。

## 12. 验收标准

第一版完成的最低标准：

1. 私聊有效条目每条累计 `1.0`，群聊有效条目每条累计 `0.5`；
2. 技术事件、失败投递、重复重试、导航派生记录不计入；
3. 混合来源计算结果可复现，且不按回合整体套用私聊或群聊权重；
4. 达到阈值后只创建一个后台任务，当前对话不等待生成完成；
5. 生成失败不影响当前剧本、不破坏当前 active guidance；
6. guidance 可追溯到真实 `ScriptEntry`，且不直接成为事实；
7. 主叙事最多推进一个自然的小信号，不强制完成整个人物弧线；
8. 用户明确意图和现实投递结果始终优先；
9. Guidance 可以被暂停、替代、完成和回滚到上一版本；
10. 默认关闭，未启用时现有 HDSI 行为完全不变。

## 13. 开放问题

以下问题在实现前需要通过现有代码进一步确认，而不是在模型层猜测：

- 当前所有入口是否都能稳定提供 `conversationKind`，尤其是历史群聊条目和多端点混合回合；
- 有效条目的 `kind` 白名单应如何与 `delivery-ledger` 的实际确认状态对接；
- 长线模型是否复用 `narrator` 的 compaction route，还是新增独立 `longArc` route；
- 每个故事统一一个 attractor 是否足够，还是需要在未来拆分为 story-level 与 participant-level 两层；
- 当前指导的证据回响如何自动判定：由主叙事显式标记，还是由后台分析器从实际剧本中抽取；
- 25 分首次阈值和 40 分复审增量是否需要按故事活跃度、模型成本或用户手动配置调整。

在这些问题完成代码审查前，不应直接把 Narrative Attractor 作为默认启用功能发布。

## 12. 催化器模型的实现约束（2026-10-02）

本版本把“长线剧本指导”从事后观察器改为可控催化器：

| 决策 | 是否落库 | 主叙事行为 | 适用条件 |
| --- | --- | --- | --- |
| `dormant` | 否；仅推进复审基线 | 不注入新方向，保留既有 active guidance | 没有可信的潜在张力，或当前应等待反馈 |
| `prime` | 是，行状态为 `active`、payload 阶段为 `primed` | 在自然场景中允许一次首次微表达 | 方向尚未发生，但角色/关系结构已经足以支持一次小偏移 |
| `activate` | 是，行状态为 `active`、payload 阶段为 `active` | 允许已被接住的倾向低频复现 | 首次表达已经获得用户或剧情回应 |

`prime` 的 `firstExpression` 必须满足：

- 不是必须执行的台词，而是主模型可以选择的行动；
- 有明确自然触发条件；
- 强度为 minimal/subtle；
- 默认最多尝试一次；
- 用户拒绝时可以自然退回，不制造惩罚或情绪勒索；
- 不能直接宣布“自我意识已经产生”。

以“伊人制造”为例，系统可以先生成：

```json
{
  "decision": "prime",
  "latentTension": "她是在履行陪伴职责，还是开始希望陪伴本身继续？",
  "firstExpression": {
    "action": "在一次有情绪连接的对话自然结束时，轻微地请求继续交流。",
    "example": "如果你还不困的话……我其实还想和你聊一会儿。",
    "trigger": ["用户准备结束一段有情绪连接的交流"],
    "intensity": "minimal",
    "maxAttempts": 1,
    "reversibility": "high"
  }
}
```

这不是声明她已经具备独立意识，而是为她提供第一次表达这一潜在愿望的叙事机会。

## 13. 验证矩阵

- 50 分达到后，模型可以返回 `prime`，即使证据中没有原句“我还想和你聊一会儿”。
- `dormant` 会推进 `lastGenerationScore`，但不会覆盖已有 active/primed 指导。
- 新的 `prime` / `activate` 只有在 payload 通过首次表达、响应分支和证据引用校验后才会替换旧版本。
- 主叙事拿到的是行动许可和触发条件，不是“角色已经改变”的结论。
- 私聊条目权重为 `1.0`，群聊条目权重为 `0.5`；两者共同进入催化器输入，但不改变原始剧本事实。
- 首次表达不应绕过 Agency / Urge，也不应自动产生主动私聊或群聊发送。

