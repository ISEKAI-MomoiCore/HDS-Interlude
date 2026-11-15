import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** D0 基线守卫（NARRATIVE_PLATFORM_DECOUPLING_DESIGN §6 D0 / §2.3）：
 * 把三项耦合指标的当前值钉成断言。D1–D4 每完成一片就收紧对应指标——
 * 本文件既是解耦进度的记分板，也是"无意中新增平台耦合"的报警器：
 * 指标只能变小（或经评审显式改基线），不能悄悄变大。 */

const src = (relative: string) => readFileSync(join(__dirname, '../src', relative), 'utf8')

/** 叙事核心模块清单（解耦目标：这些文件不得依赖平台层）。 */
const NARRATIVE_MODULES = [
  'turn-engine.ts', 'narrator.ts', 'story-state.ts', 'intents.ts', 'scheduler.ts',
  'urge.ts', 'alter.ts', 'narrative-normalizers.ts',
  'script/contract.ts', 'script/context-compiler.ts', 'compaction/pipeline.ts',
]

function importers(match: RegExp, files: string[]) {
  return files.filter(file => match.test(src(file)))
}

test('基线指标 1：叙事侧直接 import koishi 的模块（D4 收紧：仅剩 narrator）', () => {
  const current = importers(/from 'koishi'/, NARRATIVE_MODULES).sort()
  // D4（2026-10-30）：intents/narrative-normalizers/compaction 的 Time 本地化、
  // Session 类型结构化后清零。narrator 是唯一剩余（Context/Logger——模型客户端
  // 构造依赖宿主框架，属 F 系列后续立项，非平台耦合而是宿主框架耦合）。
  assert.deepEqual(current, ['narrator.ts'])
})

test('基线指标 2：直接 import session-platform（QQ 假设层）的模块（D2/D4 收窄）', () => {
  const all = [...readdirSync(join(__dirname, '../src')).filter(f => f.endsWith('.ts')).map(f => f),
    ...readdirSync(join(__dirname, '../src/script')).map(f => `script/${f}`),
    ...readdirSync(join(__dirname, '../src/delivery')).map(f => `delivery/${f}`),
    ...readdirSync(join(__dirname, '../src/compaction')).map(f => `compaction/${f}`),
    ...readdirSync(join(__dirname, '../src/console')).map(f => `console/${f}`),
    ...readdirSync(join(__dirname, '../src/research')).map(f => `research/${f}`)]
  const current = importers(/from '\.\.\/session-platform'|from '\.\/session-platform'/, all).sort()
  // D4（2026-10-30）：narrative-normalizers 已清零（管理门移入 session-platform、
  // 寻址归一化下沉 platform/identity）——叙事核心（NARRATIVE_MODULES）与
  // session-platform 的交集必须为 0，此为强制守卫。
  assert.deepEqual(current, [
    'chat-artifacts.ts', 'delivery/pipeline.ts', 'endpoint-registry.ts', 'group-actions.ts',
    'inbound-gate.ts', 'long-arc-runner.ts', 'media-loading.ts',
    'qzone-executor.ts', 'service.ts', 'sticker-library.ts',
  ])
  const narrativeSide = current.filter(file => NARRATIVE_MODULES.includes(file))
  assert.deepEqual(narrativeSide, [], '叙事核心模块不得依赖 session-platform（QQ 假设层）')
})

test('基线指标 3：私聊回合的 session 直连（D1 已收紧：句柄化归零）', () => {
  // D1 完成：私聊侧全部经 TurnHandle + 端口。剩余 latestSession 仅存在于
  // 群聊 BufferedGroupTurn（赋值在 service、读取在 D3b 迁出的群执行体），
  // 端口化归 D4。
  // D4 终态：群回合也已句柄化（latestHandle），全仓 turn.latestSession 归零。
  const occurrences = (src('service.ts').match(/latestSession/g)?.length ?? 0)
    + (src('narrative/turn-executor.ts').match(/latestSession/g)?.length ?? 0)
  assert.equal(occurrences, 0, '回合结构不得直存会话（私聊 D1 / 群聊 D4 均句柄化）')

  const engineRefs = src('turn-engine.ts').match(/Session/g)?.length ?? 0
  assert.equal(engineRefs, 0, 'D1 后 turn-engine 不得引用 Session 类型')

  const handleExport = /export interface TurnHandle/.test(src('turn-engine.ts'))
  assert.ok(handleExport, '中性句柄类型必须由 turn-engine 导出')
})

test('基线指标 4：私聊回合的平台调用经 PlatformAdapter 端口（D2 落地，D3a 迁入编排模块）', () => {
  // D2（2026-10-30）：私聊 flush 的 8 个平台调用点 + 入站登记 + 2 处回收
  // 全部经端口；D3a 起执行体位于 narrative/turn-executor.ts（计数跨两文件）。
  const count = (text: string) => text.match(/(?:this|svc)\.platformPort\??\.\w+\(/g)?.length ?? 0
  const total = count(src('service.ts')) + count(src('narrative/turn-executor.ts'))
  assert.ok(total >= 11, `端口调用点应 ≥11（实际 ${total}）`)

  // 私聊编排不得再直接以会话/句柄外的方式调用平台函数。
  assert.equal(src('narrative/turn-executor.ts').match(/turnSession/g)?.length ?? 0, 0, '会话局部变量已由端口取代')

  const portNeutral = !/from 'koishi'/.test(src('platform/adapter.ts'))
  assert.ok(portNeutral, '端口接口不得依赖 koishi（平台实现侧才可以）')
})
