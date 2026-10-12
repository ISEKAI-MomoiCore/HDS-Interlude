# 群受理人配置与无生活状态 idle 回退验证

日期：2026-10-11。工作区：`C:\dev\HDS-Interlude`。版本保持 `1.0.1-rc50`，本次为未发布修改。

## 变更范围

1. Console 的 QQ 接入 / 群聊白名单每行增加 `assignee`：显式填写受理人机器人 QQ，默认空值，不改变存量配置。
2. 插件启动或配置保存后重载，在 ready 阶段同步对应 OneBot 频道受理人。只处理启用的群与启用的机器人白名单账号；重复群遵循第一条启用规则。
3. 以部分 upsert 修改 `channel.assignee`，保留频道忽略标记、权限、语言等数据；不存在的频道创建最小记录。不会绕过 Koishi 核心消息门控。
4. 留空、关闭或删除配置不撤销此前已写入的受理人；单个群数据库失败只记录警告，不阻止后续群同步。
5. `willingnessPreset=auto` 下，生活状态缺失、无效或超过六小时未刷新时，评估与成功发言扣减都使用 `willingnessAuto.idle`。默认映射 active，自定义 idle:eager 时使用 eager；不向剧本状态写入虚构的 idle。
6. 有效 busy/asleep 保持原行为；过期 asleep 不继续睡眠惩罚。日志区分无状态、无效、过期回退。

## 回归证据

- 聚焦测试：19 项全部通过。
- 主仓全量测试：826 项，822 通过，4 跳过，0 失败；跳过的用例不计为现场验收通过。
- 严格 typecheck：通过。
- bundle 新鲜度校验通过；直接加载编译后 lib 验证 Console 新字段与旧配置默认空值均正确。
- Yarn 4.5.3 `yakumo build hds-interlude`：通过，已更新开发工作区的 lib；Vite 输出 CJS API 弃用提示，无构建错误。
- 真实内存 SQLite + Koishi attach 测试复现旧受理人仅 @ 可通过，并验证更正后两名不同群成员的普通消息均可通过；同时验证频道/用户忽略标记不被绕过。

执行均使用工作区内 `.yarn/releases/yarn-4.5.3.cjs`，没有使用 Yarn 1 安装或修改 lockfile。

## 现场配置与未完成边界

本次未修改正在运行实例的 koishi.yml / 数据库，未打包、未安装 Koishi Desktop，也未进行真实 QQ 群现场验收。

已检查的目标群 `421430402` 当前需要在 Console 群聊白名单对应行填写受理人 `732295780`，保存并等待插件重载。该 QQ 须位于启用的机器人白名单内。如果界面还没有新字段，需要先让该实例加载更新后的插件。

响应模式需为 `always` 才能让未 @ 的普通消息进入 HDSI 群聊处理；意愿、冷却和主叙事输出仍决定是否真正发言。受理人修正不会自动恢复之前被 Koishi 核心过滤掉的消息。

此群使用 auto 且 idle 映射为 eager 时，无 lifeStatus 将按 eager 评估；这不等于每条消息必回。

## 修改文件

- `src/index.ts`：Console schema 和说明。
- `src/service.ts`：ready 同步受理人与诊断日志接入。
- `src/group-willingness.ts`：idle 回退与统一诊断格式。
- `test/group-assignee.test.ts`：字段、SQLite、核心门控、安全边界回归。
- `test/group-willingness-tiers.test.ts`：idle 映射、过期边界、扣减与日志回归。
- `CONFIGURATION_GUIDE.md`、`docs/GROUP_WILLINGNESS_TIERS.md`、`docs/CHANGELOG.md`：行为与配置文档同步。
