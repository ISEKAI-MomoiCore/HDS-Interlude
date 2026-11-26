import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from 'koishi'
import Http from '@koishijs/plugin-http'
import { SQLiteDriver } from '@minatojs/driver-sqlite'
import * as InterludePlugin from '../src/index'

test('首次启动：意愿档位迁移等待服务就绪，重载后服务和管理命令继续可用', async () => {
  const app = new Context()
  app.plugin(Http)
  app.plugin(SQLiteDriver, { path: ':memory:' })
  const config = InterludePlugin.Config({
    runtime: { autoAdvanceEnabled: false },
    memory: { enabled: false },
    schedulePreplan: { enabled: false },
    weather: { enabled: false },
    stickers: { enabled: false },
    presetSync: { enabled: false },
    onebot: { enabled: false, willingnessPresetMigrated: false, groupChats: [
      { groupId: '123456', willingnessPreset: 'off', willingness: { enabled: true } },
    ] },
  })
  let updates = 0
  app.on('internal/before-update', (_scope, next) => {
    if ((next as any)?.onebot?.willingnessPresetMigrated) updates++
  })
  const fork = app.plugin(InterludePlugin, config)
  try {
    await app.start()
    for (let attempt = 0; attempt < 1000; attempt++) {
      if (app.interlude?.config.onebot.willingnessPresetMigrated && app.$commander.get('interlude.status')) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(updates, 1, '首次迁移只提交一次配置更新')
    assert.equal(fork.config.onebot.willingnessPresetMigrated, true)
    assert.equal(fork.config.onebot.groupChats[0].willingnessPreset, 'custom')
    assert.ok(app.interlude, '重载后的服务已登记')
    assert.equal(app.interlude.config.onebot.willingnessPresetMigrated, true)
    assert.ok(app.$commander.get('interlude.status'), '重载后的命令仍已登记')
    assert.deepEqual(await app.database.get('interlude_story', {}), [])
    assert.equal((await app.interlude.consoleOverview()).version, InterludePlugin.version)
  } finally {
    await app.stop()
  }
})
