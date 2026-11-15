# 时间导演与宿主事件账本

适用版本：`0.1.5-beta1`

## 问题

旧架构把自动 prose 同时当作文学渲染、时间推进和下一轮事实来源。弱模型可能在短窗口中写到数小时以后；压缩摘要和 workingDetails 再把这段未来 prose 固化，形成自我强化。

## 结构

自动阶段先复用 `useForCompaction` / compaction 路由生成 `TimelinePlan`。每个 beat 使用 `at=0..1` 表示当前 `from→now` 窗口中的相对位置，宿主只接受 `activity`、`thought`、`state` 三类短摘要。主叙事接收验证后的 plan，只负责自然语言渲染。

自动 script 持久化其 `timelinePlan` 元数据。下一轮主提示读取该账本投影，压缩器也将其作为该窗口发生事实的优先来源；文学 prose 不再拥有时间轴权威。

## 失败语义

时间导演未返回有效 beats 时，自动回合不写入、cursor 不前进，等待后续调度重试。正确的停顿优先于虚构未来。

## 迁移

旧故事可由管理员执行 `interlude.timeline.rebase`。该操作把活跃 scene 摘要、continuity snapshot 和 workingDetails 重新基准到真实当前时间，不删除历史剧本、Canon、参与者或长期事实。
