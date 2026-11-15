import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import type { WebObservation } from '../src/types'

/**
 * Issue #14 回归：saveWebObservation 硬编码 id:0 违反 AUTOINCREMENT 契约。
 *  A. 落库 candidate 不得携带 id——由 AUTOINCREMENT 分配，连续写入不冲突；
 *     内存路径（persist=false）保留占位 id:0（无消费方）。
 *  B. 即时观察落库失败逐条降级为 warn，不上抛（旁路信息不得否决整轮回复）。
 *  C. 延迟浏览意图执行失败按失败完成——intent 不得停在 pending 无限重试。
 */

const now = new Date('2026-10-20T09:00:00.000Z')
const story: any = { id: 's', setting: { timezone: 'Asia/Shanghai' } }

function makeHost(options: { failCreate?: boolean } = {}) {
  const creations: Array<{ table: string, data: any }> = []
  const intentUpdates: Array<{ id: number, patch: any }> = []
  const appended: any[] = []
  const reports: string[] = []
  let seq = 0
  const host: any = Object.assign(Object.create(InterludeService.prototype), {
    config: { browser: { maxExcerptCharacters: 3000 } },
    dbCreate: async (table: string, data: unknown) => {
      creations.push({ table, data })
      if (options.failCreate) throw new Error('UNIQUE constraint failed: interlude_web_observation.id')
      return { ...(data as object), id: ++seq }
    },
    dbSet: async (_table: string, query: any, patch: any) => { intentUpdates.push({ id: query.id, patch }) },
    appendEntry: async (_storyId: string, draft: any) => { appended.push(draft) },
    reportOperation: (...args: any[]) => { reports.push(args.slice(4).map(String).join(' ')) },
    reportStandalone: () => {},
  })
  return { host, creations, intentUpdates, appended, reports }
}

test('A1: 连续两次落库获得不同自增 id，candidate 不携带主键', async () => {
  const { host, creations, appended } = makeHost()
  const first = await host.saveWebObservation('s', 'alice', null, 'visit', '', 'https://example.com/a', '标题', '正文', '摘要', 'success', now)
  const second = await host.saveWebObservation('s', 'alice', null, 'visit', '', 'https://example.com/b', '标题2', '正文2', '摘要2', 'success', now)
  assert.notEqual(first.id, second.id, '自增主键必须不同——第 2 次不得再撞 UNIQUE')
  assert.equal(creations.length, 2)
  for (const { data } of creations) {
    assert.equal('id' in data, false, '落库 candidate 必须交给 AUTOINCREMENT，不得出现 id 字段')
  }
  assert.equal(appended.length, 2, '每次成功落库都应留下 web-observation 时间线条目')
  assert.equal(appended[0].metadata.observationId, first.id)
})

test('A2: persist=false 返回内存占位对象（id:0），不触库', async () => {
  const { host, creations } = makeHost()
  const observation: WebObservation = await host.saveWebObservation('s', 'alice', 7, 'search', '关键词', '', '', '', '', 'blocked', now, false)
  assert.equal(observation.id, 0)
  assert.equal(observation.status, 'blocked')
  assert.deepEqual(creations, [])
})

test('B: 即时观察落库失败 → 逐条降级 warn、不上抛、其余继续', async () => {
  const { host, reports } = makeHost({ failCreate: true })
  const observations: WebObservation[] = [
    { id: 0, storyId: 's', participantId: 'alice', intentId: null, mode: 'visit', query: '', url: 'https://a', title: '', excerpt: '', summary: '', status: 'success', accessedAt: now, createdAt: now },
    { id: 0, storyId: 's', participantId: 'alice', intentId: null, mode: 'visit', query: '', url: 'https://b', title: '', excerpt: '', summary: '', status: 'failed', accessedAt: now, createdAt: now },
  ]
  // 修复前：这里的 await 会把 UNIQUE 异常原样抛给 flushBufferedNarrative，
  // 整轮已生成的回复被丢弃并排重试。
  await host.persistImmediateObservations(story, 'alice', observations, 'user-message')
  assert.equal(reports.length, 2, '每条失败都要留 warn（可定位到网页观察）')
  assert.ok(reports.every(line => line.includes('网页观察落库失败')))
  assert.ok(reports.every(line => line.includes('UNIQUE constraint failed')))
})

test('C: 延迟浏览意图执行失败 → intent 按失败完成，不重试不抛出', async () => {
  const { host, intentUpdates, reports } = makeHost()
  host.collectWebObservation = async () => { throw new Error('UNIQUE constraint failed: interlude_web_observation.id') }
  const intent: any = { id: 42, storyId: 's', participantId: 'alice', type: 'browser-research', payload: {}, status: 'pending' }
  const observation = await host.executeDeferredBrowserIntent(story, intent, now)
  assert.equal(observation, undefined)
  assert.equal(intentUpdates.length, 1, '意图必须恰好完成一次')
  assert.equal(intentUpdates[0].id, 42)
  assert.equal(intentUpdates[0].patch.status, 'completed', '意图必须被标记 completed——否则每个 sweep 重撞一次')
  assert.ok(reports.some(line => line.includes('延迟网页观察执行失败')))
})
