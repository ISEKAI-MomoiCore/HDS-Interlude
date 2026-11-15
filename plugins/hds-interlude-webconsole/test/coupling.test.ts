import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { dirname, join, resolve } from 'node:path'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { Context } from 'koishi'
import * as webconsole from '../src/index'
import { resolveInterludeDatabase, resolveInterludeDatabaseSafe } from '../src/connection'
import { fixture } from './fixture'
const sqlite = (path: string) => ({ constructor: { name: 'sqlite' }, path })
function createSqliteFile(file: string) {
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE t (id INTEGER)')
  db.close()
}
test('数据源解析：配置优先、driver 降级、文件系统标准位置与 SQLite 头校验', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdsi-conn-test-'))
  try {
    const custom = join(dir, 'custom.db')
    createSqliteFile(custom)
    // driver 链：@minatojs/driver-sqlite 在实例上暴露绝对 path；config.path 形态兼容
    assert.equal(resolveInterludeDatabase(dir, sqlite(custom)), custom)
    assert.equal(resolveInterludeDatabase(dir, { config: { path: custom } }), custom)
    assert.deepEqual(resolveInterludeDatabaseSafe(dir, sqlite(custom)), { path: custom, source: 'driver' })
    // driver 不可用（内存库 / 空对象 / 路径不存在）且无标准文件时给出可操作错误
    assert.throws(() => resolveInterludeDatabase(dir, sqlite(':memory:')), /未找到/)
    assert.throws(() => resolveInterludeDatabase(dir, sqlite(join(dir, 'missing.db'))), /未找到/)
    assert.throws(() => resolveInterludeDatabase(dir, {}), /未找到/)
    // 文件系统标准位置：data/koishi.db 命中，table 未注册不再阻塞定位
    mkdirSync(join(dir, 'data'))
    const standard = join(dir, 'data', 'koishi.db')
    createSqliteFile(standard)
    assert.equal(resolveInterludeDatabase(dir, undefined), standard)
    assert.equal(resolveInterludeDatabaseSafe(dir, undefined).source, 'filesystem')
    // 同名非 SQLite 文件（sql.js 截断窗口）被头部校验跳过，不影响标准位置命中
    writeFileSync(join(dir, 'koishi.db'), 'definitely not a sqlite database file')
    assert.equal(resolveInterludeDatabase(dir, undefined), standard)
    // 显式配置优先级最高；缺失文件 / 非 SQLite 文件给出明确错误
    assert.equal(resolveInterludeDatabase(dir, undefined, 'custom.db'), custom)
    assert.equal(resolveInterludeDatabaseSafe(dir, undefined, 'custom.db').source, 'configured')
    assert.throws(() => resolveInterludeDatabase(dir, undefined, 'missing.db'), /不存在/)
    assert.throws(() => resolveInterludeDatabase(dir, undefined, 'koishi.db'), /不是有效的 SQLite/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('Console 配置的八项默认值、范围及强制主插件服务依赖', () => {
  assert.deepEqual(webconsole.inject.required, ['database', 'interlude'])
  assert.deepEqual(webconsole.Config({}), { enabled: false, host: '127.0.0.1', port: 5178, token: '', databasePath: '', autoRefresh: true, pollSeconds: 3, logBuffer: 2000 })
  for (const value of [{ host: '0.0.0.0' }, { port: 1023 }, { port: 65536 }, { pollSeconds: 0 }, { pollSeconds: 61 }, { logBuffer: 199 }, { logBuffer: 20001 }]) assert.throws(() => webconsole.Config(value))
  const json = JSON.stringify(webconsole.Config.toJSON())
  assert.match(json, /secret/); assert.match(json, /服务与访问/); assert.match(json, /实时更新与日志/)
})
async function eventually(action: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 60; i++) { if (await action()) return; await new Promise(done => setTimeout(done, 30)) }
  assert.fail(message)
}
test('Koishi 真实依赖生命周期：等待 HDSI、启用、卸载停服、重新注入恢复', async () => {
  const f = fixture(), ctx = new Context()
  Object.defineProperty(ctx, 'baseDir', { value: dirname(f.file) })
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
  const port = (probe.address() as any).port
  await new Promise<void>(done => probe.close(() => done()))
  ctx.provide('database'); ctx.set('database', { prepared: async () => {}, select: () => ({ driver: sqlite(f.file) }) } as any)
  ctx.provide('interlude')
  ctx.plugin(webconsole, webconsole.Config({ enabled: true, port, token: 'fixture-secret', pollSeconds: 1, autoRefresh: false }))
  const url = `http://127.0.0.1:${port}/api/status`
  const available = async () => { try { return (await fetch(url, { headers: { Authorization: 'Bearer fixture-secret' }, signal: AbortSignal.timeout(500) })).ok } catch { return false } }
  try {
    await ctx.start()
    assert.equal(await available(), false, '必须等待 interlude 服务，不能只依赖数据库启动')
    ctx.set('interlude', {} as any)
    await eventually(available, '提供 HDSI 后应启动')
    const data = await (await fetch(url, { headers: { Authorization: 'Bearer fixture-secret' } })).json() as any
    assert.equal(data.integration.service, 'interlude'); assert.equal(data.pollSeconds, 1); assert.equal(data.autoRefresh, false)
    // 版本随已安装主插件动态变化（rc50→rc52→…），与运行时 require 读取路径一致
    assert.equal(data.integration.version, require('koishi-plugin-hds-interlude').version)
    assert.ok(data.session); assert.equal(typeof data.revision, 'number')
    assert.equal(JSON.stringify(data).includes('fixture-secret'), false)
    assert.equal(JSON.stringify(data).includes(f.file), false)
    assert.equal((await fetch(url)).status, 403)
    ctx.set('interlude', undefined)
    await eventually(async () => !(await available()), '主插件移除必须停服释放端口')
    ctx.set('interlude', {} as any)
    await eventually(available, '主插件重新加载后应恢复')
    const resumed = await (await fetch(url, { headers: { Authorization: 'Bearer fixture-secret' } })).json() as any
    assert.notEqual(resumed.session, data.session)
  } finally { await ctx.stop(); f.close() }
  assert.equal(await available(), false)
})
test('select() 抛错（表未注册）不再阻塞启动：databasePath 兜底 + rc52 节奏端到端可见', async () => {
  const f = fixture(), ctx = new Context()
  Object.defineProperty(ctx, 'baseDir', { value: dirname(f.file) })
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
  const port = (probe.address() as any).port
  await new Promise<void>(done => probe.close(() => done()))
  ctx.provide('database')
  // 用户反馈的故障形态：minato select('interlude_story') 在表未注册时直接抛错，
  // 旧实现把该异常当作致命错误，导致「无法连接 HDSI database」。
  ctx.set('database', { prepared: async () => {}, select: () => { throw new Error('cannot resolve table') } } as any)
  ctx.provide('interlude')
  ctx.plugin(webconsole, webconsole.Config({ enabled: true, port, token: 'fixture-secret', pollSeconds: 1, databasePath: 'fixture.db' }))
  const url = `http://127.0.0.1:${port}/api/overview`
  const ok = async () => { try { return (await fetch(url, { headers: { Authorization: 'Bearer fixture-secret' }, signal: AbortSignal.timeout(500) })).ok } catch { return false } }
  try {
    await ctx.start()
    ctx.set('interlude', {} as any)
    await eventually(ok, 'select 抛错时应通过 databasePath 兜底启动')
    const data = await (await fetch(url, { headers: { Authorization: 'Bearer fixture-secret' } })).json() as any
    assert.equal(data.story.id, 'demo-a')
    assert.equal(data.story.lifeRhythm.attention, 'resting', 'rc52 lifeRhythm 端到端可见')
    assert.equal(data.story.proactiveContactCount, 2)
  } finally { await ctx.stop(); f.close() }
})
