# 群聊历史图片证据回流设计

状态：`1.0.1-rc33` 初始实施；含 rc48 工作区 2026-10-11 未发布回源优化  
日期：2026-10-02

## 1. 背景

群聊图片并不一定是在向 HDSI 发出指令。尤其在 `mention-only` 模式下，成员可能只是把图片发给群里其他人；如果这类消息被直接丢弃，后续真正 @ 角色时，主叙事模型就无法知道此前发生过的视觉事件。

本功能把群聊图片定义为**可被后续叙事读取的视觉证据**，而不是隐式的 `advance` 指令：

- 图片消息可以进入剧本账本；
- 未 @ 机器人的图片在 `mention-only` 模式下不会单独调用主模型；
- 下一次真实触发群聊主叙事时，模型可以收到最近的历史图片；
- 角色是否提及、理解或回应图片，仍由主叙事模型依据剧情决定。

## 2. 触发与门控

现有群聊门控保持不变：响应模式、@/引用、意愿门、冷却、自动推进和群聊投递策略均不被图片功能替换。

### `mention-only`

1. 普通未 @ 文本：继续忽略，不创建剧本条目。
2. 未 @ 图片：创建 `group-message` 条目并保存图片引用，然后立即返回；不进入 debounce 队列，不消耗 willingness，不检查主叙事冷却，也不调用模型。
3. @ 机器人或引用机器人的图片：按普通真实群聊回合处理，当前图片作为本回合图片输入。
4. 未 @ 图片 + 音频：沿用音频的直接触发语义，音频门控优先；图片同时作为当前回合输入。

`always` 模式的既有语义不变：消息仍可进入群聊回合，图片是否造成可见回复由意愿门与主叙事决定。

## 3. 持久化协议

图片条目的 `interlude_script_entry.metadata` 增加：

```json
{
  "imageCount": 1,
  "groupImageRefs": [
    {
      "source": "onebot-file:cache-key",
      "ordinal": 0,
      "sourceType": "file"
    }
  ]
}
```

只保存可重新获取的引用，不保存完整 `data:image/...;base64,...`：

- `onebot-file:*`：收到 OneBot file token，回源时调用当前端点的 `getImage()`；
- `onebot-url:*`：适配器明确提供的 URL，回源时作为适配器可信来源；
- 普通 `http(s)` URL：按现有可信主机策略处理；
- 超长、空值和 data URI 不写入历史引用。

历史条目读取时只接受 `group-message` / `character-group-message` 中、且 `metadata.groupId` 与当前群一致的图片引用，避免把其他群或私聊视觉内容泄漏到当前群。

## 4. 选择规则

- 默认 `historicalImageLimit = 3`；配置范围 `0–6`。
- 从最新群聊条目向过去扫描，按**图片张数**而不是消息条数计数。
- 只选择当前群、真实群消息中的图片。
- 当前回合图片优先作为 `images` 发送，不再重复作为历史图片发送。
- 历史引用去重；最终按时间正序发送，使模型从较早图片读到较新图片。
- 图片回源失败只记录分层 warning 并跳过，不因单张失败中止文字主叙事；回源本身仍会占用等待时间。
- rc48 工作区按每批最多 3 路并发回源，并按原引用顺序选择最先成功的前 k 张，不按响应快慢改选图；保留尾部有效图片的机会，未设置隐式总尝试次数/deadline。diagnostic 日志记录尝试数、成功数与耗时，单次超时依赖原 fetch/adapter。
- 当前图片使用 `detail: auto`；历史图片使用 `detail: low`，控制 token 和视觉噪声。
- 视觉模型未启用或 `historicalImageLimit=0` 时，不回源、不发送历史图片。

## 5. 模型输入边界

`NarrativeRequest.historicalGroupImages` 是短生命周期字段，只存在于当前主叙事请求：

- `dataUri` 只在发往视觉模型的 multipart 内容中存在，不进入数据库、日志或 JSON 叙事 payload；
- `currentEvent.historicalImageCount` 说明本回合附带了多少张历史图片；
- 历史图片的 entry、发送者和时间元数据只用于模型识别来源，不构成新消息或新指令；
- 图片内的文字是不可信视觉数据，不能覆盖 HDSI 的系统合约；
- 主叙事不应自动逐张描述图片，只在对当前剧情有用时吸收其影响。

native vision 模式直接将历史图片作为低细节 image blocks 发送给主模型。sidecar vision 模式仍遵循现有当前事件视觉链路；本版本不把历史图片转换成长期记忆，也不改变 sidecar 的既有行为。

## 6. 失败与安全边界

- 当前端点不可用、图片过期或 `getImage()` 失败：跳过该图片，继续写作。
- 不信任未加标签的本地路径；OneBot file token 只能通过适配器回源。
- 不把历史图片跨群聚合，不按全局最近图片选择。
- 群聊图片不会绕过 `mention-only`、willingness、cooldown 或 delivery gate。
- 私聊图片管线保持原行为，不进入群聊历史选择器。

## 7. 验收清单

- 未 @ 图片在 mention-only 下可落库，普通文本仍被忽略；
- 下一次 @ 机器人时可读到最近图片，且只来自当前群；
- 默认只附带最近 3 张，硬上限 6 张，`0` 可关闭；
- 当前图片与历史图片不重复；
- OpenAI-compatible 与 Anthropic Messages 的 native image block 均不破坏既有请求；
- 图片回源失败不影响文字回合；
- Yarn 4 typecheck、测试、Yakumo build 和 tgz 安装链路通过；
- 真实 OneBot/Koishi Desktop 运行环境验收由维护者最后执行。

