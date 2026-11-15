# 开发文档

- `logging/` 保存日志格式和分层设计过程。
- 发布前必须依次执行 `npm run typecheck`、`npm test`、完整构建、bundle 冒烟和 npm pack 内容检查。
- 当前架构只允许从 `0.1.1-beta6` 自然语言连续性主干增量修改；不得从 Beta7 备份整文件覆盖当前 `types.ts`、`service.ts` 或 `narrator.ts`。
- 修改模型协议时，同时更新 `src/types.ts`、固定 system prompt、payload、规范化函数、持久化路径、Console Schema、测试和文档。
