# Alter System

适用版本：`1.0.1-rc52`

## 定位

Alter System 追踪一部持续生活剧本的临时氛围惯性。它只向主模型提供一段带方向、强度和权重的氛围参考，不生成固定话术，不修改 Canon，不替代原始剧本、continuity、剧情余波或 Overlay。

## 主模型评分

每个成功产生非空 `script` 的最终主叙事回合返回整数 `alter`：

- `+1..+5`：本轮新事件使氛围向严肃、收敛或凝重移动。
- `-1..-5`：本轮新事件使氛围向轻松、开放或活跃移动。
- `0`：本轮没有明显净变化。

评分只描述本轮新增变化。既有氛围、写作文风和已经注入的 emotionalOffset 不能成为重复打分依据。非法、非有限或缺失的值会被忽略；小数四舍五入并限制到 `-5..5`。

## 状态和动态阈值

故事状态保存累计值、当前权重、上次触发方向、当前 offset、最近 50 次评分和分析尝试时间。

累计按**来源分桶**（`pendingScopes`）：每个参与者一个桶，主角自己的独立生活记在空桶；每桶独立累计、独立分析尝试时间（上限 32 桶，零值桶不占位）。顶层累计值只是各桶之和；触发、快照、扣除与失败冷却都按桶进行——一段关系里的失败重试不再压制无关生活线（桶级冷却 5 分钟），旧版单桶状态在读取时自动归并到主角桶。

`density = min(当前来源最近一小时有效回合数 / 10, 1)`（回合数按当前桶过滤）

`threshold = max(baseThreshold × 0.5, baseThreshold × (1 - density × densityFactor))`

默认 `baseThreshold=10`、`densityFactor=0.3`，因此阈值由 10 平滑下降到 7。

## 权重生命周期

已有 offset 时，同向变化执行：

`weight += abs(alter) × sameDirectionBoost`

反向变化执行：

`weight -= abs(alter) × oppositeDecay`

权重限制为 `0..1`。低于 `minWeight` 时清除旧 offset，但反方向累计值继续保留，因此可以自然触发新的方向。

## 侧端分析

当前来源桶内累计绝对值达到其阈值后，本轮先保存累计状态并返回可见消息；独立后台 Alter 分析随后读取最近十段 `script`、最近评分轨迹、全局 Overlay、触发值和旧 offset。输出仅允许一个 `description` 字段。方向由累计值决定，强度由插件计算：

`intensity = min(abs(triggerValue) / threshold, maxIntensity)`

分析使用锁内取得的来源分数快照，模型请求在故事串行队列外执行，返回后在锁内合并最新状态。成功时保存新 offset、权重设为 1，只从对应来源扣除快照分数；请求期间的新分数和其他来源累计保留，强度仍按快照计算。若最新累计已经反向或低于触发阈值，丢弃旧描述并保留所有未消费分数；暂停、数据库重置或任务代次失效时也不提交旧结果。模型失败时不扣分、不伪造 offset，并对该桶至少等待五分钟再尝试（其它桶不受影响）。

Alter 分析复用模型预设、Provider、OpenAI-compatible 协议、超时和 failover，并作为独立的低频分析请求运行。

## 主模型注入

主请求只接收：

```json
{
  "emotionalOffset": {
    "direction": "serious",
    "description": "剧情从轻松日常转向更谨慎、私密的交流。",
    "intensity": 1.2,
    "generatedAt": "2026-08-22T12:00:00.000Z",
    "weight": 0.75
  }
}
```

内部累计值、上次方向、尝试时间和评分历史会从 `story.state` 中移除后再构造主模型 payload，避免自我强化。

## 故障与兼容

- 旧故事没有 Alter 状态时按需初始化，不需要数据库迁移。
- 关闭功能后不评分、不注入；已有状态留在故事 JSON 中。
- 侧模型调用不阻塞本轮可见回复；故障也不会影响已经保存的主剧本。
- 自定义 NarrativeProvider 没有实现 `analyzeAlter` 时保留累计值并记录警告。
- 旧残留字段 `lastTriggerAlter` 在读取时迁移为方向值。

