# QQ 空间（说说）通道：设计与实现说明

适用版本：工作区（rc26 后增量），Console【扩展 18】`qzone`，默认关闭。

## 一、定位：她的第四个生活面

HDSI 现有的三个生活面：私聊（被动应答 + 主动联系）、群聊（意愿门控的半公开场合）、世界事件（外部世界作用于她）。说说通道补上两块拼图：

- **半公开自我表达面**：她在没有对话的时段也有可被用户看见的生活痕迹。用户刷空间看到她凌晨两点发的东西——比主动私聊更轻、更真实的沉浸通道。`ugcRight=64`（仅自己可见）是特殊的叙事形态：她写了条日记，谁也看不见，但剧本记得。
- **注视用户的面**：她能看见好友（含用户）的说说并点赞/评论——"她一直在看我的生活"。

## 二、核心架构：感知-行动分离

```
                    ┌─ 感知侧（零模型调用）─────────────────┐
SnowLuma qzone API ─┤ 好友动态轮询 → 过滤/去重/正文对齐      │
                    │   → [好友动态] 剧本条目（事实，不反应）│
                    └───────────────────────────────────────┘
                    ┌─ 行动侧（叙事决策）───────────────────┐
叙事回合（主作者） ──┤ 决定"她想去发帖/评论/点赞"            │
                    │   → qzone-action 意图（notBefore 排期）│
                    │   → 到期排水 → 限流门 → 执行          │
                    │   → [空间动态] 剧本条目（她自己记得）  │
                    └───────────────────────────────────────┘
```

两条纪律：

1. **感知零模型调用**：轮询只把"好友发了说说"写成既成事实；要不要反应、怎么反应，由主作者在她下一次叙事回合里决定。这既省成本，又把风控面压到最小（不是每条动态都触发动作）。
2. **动作只走意图账本**：与 delayed-reply / browser-research 同构。模型在回合内决策排期，到期由排水一锤子执行；正文里永远不能宣称"她发了说说"——发了没有，账本说了算。

## 三、通道层（src/qzone.ts）

纯策略函数模块（与 group-willingness.ts 同构），无副作用、可独立测试：

| 部件 | 职责 |
|---|---|
| `resolveQzoneConfig` | 配置归一 + 边界夹取（发帖 0-20/评论 0-60/点赞 0-120/间隔 10-1440 分钟） |
| `evaluateQzoneGate` | 限流门：分 kind 日上限 + 跨 kind 共享最小间隔；只认 post/comment/like（feed-seen 只读标记不占配额）；failed 不计、**pending/unknown 计入**（在途与结果不明都按已发生保守对待）；本地日翻转重置 |
| `callQzoneAction` | SnowLuma 动作封装：回执校验、retcode 保留（风控分类）、**ambiguous 标志**（传输异常=结果未知） |
| `normalizeQzoneMsgEntry` / `normalizeQzoneFeedEntry` | 防御性归一化，坏行丢弃 |
| `qzoneFeedCandidates` | 动态候选过滤：appid=311（说说）→ 有效 uin → 时间窗 → 未入账 → 单轮 ≤2 条 |
| `matchQzoneFeedContent` | 正文对齐：**只认 tid 精确命中**（对不上就只记元数据——错的内容比没有更糟） |
| `qzoneIntentFromPayload` | 意图 payload 白名单校验（动作三选一、长度上限、tid 字符集、隐私档白名单，非法回退/拒绝） |
| `probeQzoneAvailable` | 能力探测（只读） |

## 四、数据层

**`interlude_qzone_post` 审计表**（一张表三个用途：限流依据 / 去重账本 / 投递追溯）：

| kind | 语义 | status 流转 |
|---|---|---|
| `post` / `comment` / `like` | 空间动作（携带 endpointId，限流按端点分桶） | pending → confirmed / failed / **unknown** |
| `feed-seen` | 某条好友动态已入账（只读标记，tid=feeds.key） | confirmed |

**剧本条目**（进主叙事上下文，走 SOCIAL SURFACE 规则行）：

- `[空间动态] 她发表了说说：…（好友可见/仅自己可见）`——她自己的表达，她会记得
- `[空间动态] 她评论了 QQ xxx 的说说：…`
- `[好友动态] 昵称发布了说说：正文摘要`——携带 metadata `{qzoneFeedKey, qzoneFeedUin, qzoneFeedNickname}`，模型评论/点赞时从这里复制 tid/targetUin

## 五、行动侧管线

1. **提示词**（narrator 合约两条规则行）：qzone-action 意图教学（post 内容 ≤120 字她的口吻、评论 ≤60 字随手打的语气、目标字段从 [好友动态] 条目复制、不得在正文宣称动作、不得重复排期）+ SOCIAL SURFACE 规则（[空间动态]/[好友动态] 均为既成事实）。
2. **回合内决策**：主作者在任意相位（user-message/advance/follow-up/due）输出 `intents: [{type: 'qzone-action', notBefore, payload}]`，走通用意图校验与持久化，参与 pending 投影（模型能看到自己已排期的动作，保证不重复）。
3. **到期执行**（`executeQzoneIntent`，排水里 browser-research 之后）：
   - payload 白名单校验（非法 → 完成意图，不卡排水）
   - **目标来源绑定**：评论/点赞的 tid 必须命中审计表里已入账的动态（feed-seen）或自己已发表的说说（confirmed post）——模型编造的 tid 一律拒绝
   - `qzoneExecute`：限流门 + pending 预留（在故事串行队列内原子完成，网络调用留外）→ SnowLuma 动作 → 回写
   - 发帖/评论成功写 `[空间动态]` 条目；点赞不单独入账（过细）
   - 成败都完成意图，**绝不作为未来计划回流叙事**

## 六、感知侧管线（qzoneFeedSweep）

- 节律 = `feedWindowMinutes / 2`（15-60 分钟夹取），单轮最多入账 2 条
- 过滤链：appid=311 → uin 有效（排除广告位 6600/官方号 5000/杂项）→ 时间窗内 → feed-seen 行去重（7 天查询窗）
- **正文获取**：POC 发现 `feeds.key` 与好友 `get_qzone_msg_list` 的 tid 同格式——拉好友最近说说按 tid 精确对齐拿真实正文；对不上只记元数据
- feeds CGI 间歇性失败（POC 实测）静默跳过本轮，不写任何条目
- 每条新鲜动态 → `[好友动态]` 条目 + feed-seen 行；反应决策留给下一回合

## 七、治理与安全（六项审计修复，2026-09-29）

| 风险 | 对策 |
|---|---|
| 动作落到其他 QQ 账号 | `qzoneCaller` 严格匹配指定账号，不在线直接失败，**无跨账号回退** |
| 感知挤占动作配额 | 限流只认 post/comment/like；feed-seen 不计数不占间隔 |
| 并发突破限流 | 门控+预留包进故事串行队列，原子过门（服务层测试锚定） |
| 超时后重复执行非幂等动作 | 传输异常与"成功帧无 tid"记 **unknown**：保守计入配额、语义禁止自动重试、不写"已发布"剧本条目 |
| 对任意帖子执行写操作 | 目标来源绑定（tid 必须已入账）+ tid 字符集白名单 |
| 连发动态正文错配 | 正文对齐只认 tid 精确命中 |

风控基线：SnowLuma 源码明示发帖/评论/点赞高频会被 Qzone 风控。默认配额 3/6/12、间隔 90 分钟、点赞与发帖分离计数；风控类错误（retcode 12xxx）原文保留在审计行，可据此熔断当日。

## 八、配置与命令

- **Console【扩展 16】qzone**：enabled（默认关）+ dailyPostCap/dailyCommentCap/dailyLikeCap + minIntervalMinutes + feedWindowMinutes
- **`interlude.qzone <内容>`**（管理员）：经全链（能力探测 → 门控 → 审计 → SnowLuma → 回写 + 剧本条目）以她本人身份发一条好友可见说说——端到端测试入口
- 前提：SnowLuma 连接在线（qzone 系列扩展动作）；通道探测失败时功能整体静默降级

## 九、POC 实测记录（2026-09-29，账号 1303322392）

- `send_qzone_msg(64)` → 返回 tid → `like_qzone(tid)` → `delete_qzone_msg` 全链成功
- `get_qzone_msg_list` / `get_qzone_feeds` 可用；**feeds 间歇失败**（两次一败）→ 轮询容忍设计
- 动态流混有广告（appid 6600）/官方号（5000）→ 过滤设计
- **未实测**：`comment_qzone`（对外可见动作，不擅自测）；feeds.key 直接作 tid 点赞好友帖子（首次真实使用时验证）；`unlike_qzone`（SnowLuma 源码注明端点未真机核实，本功能不提供取消赞）

## 十、已知边界与后续方向

- 深翻页不可靠：只消费首页（`page_num=1`），时间窗兜底
- feeds 正文是预渲染 html：当前只用结构化字段 + msg_list 对齐；html 解析留待需要时做
- 图片说说：发送链路支持（SnowLuma 自动上传），意图 payload 尚未开放图片字段——等她的素材库（表情包/相册）与空间打通后设计
- 她被评论的感知（rc29 已实现）：动态轮询附带拉取她自己的 `get_qzone_msg_list`，与 `interlude_qzone_post.commentNum` 基线比对——首次观测只立基线，增量>0 写 `[空间动态]` 条目（SOCIAL SURFACE 规则现成），由下一次推进（自动或对话）自然携带，**轮询绝不触发推进**；删评回落静默下修基线。感知零动作配额，只覆盖 7 天内已确认的帖子、单轮至多 3 条。赞数感知待上游暴露（SnowLuma `mapMsgList`/`RawEmotion` 目前只映射 `cmtnum`；补 `like_num` 后在 `QzoneMsgEntry` 加字段并入 `qzoneReactionDeltas` 即可）
- 群发动态（appid 4=相册等）：当前只消费说说类
