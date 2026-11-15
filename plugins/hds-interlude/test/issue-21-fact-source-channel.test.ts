import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/** Issue #21（方向 c）回归：事实通道域——群聊蒸馏的事实携带 sourceChannel，
 * 投影与提示词能区分"听说"与"亲历"；事实保持全局（无可见性过滤）。 */

const at = (base: number, minutes: number) => new Date(base + minutes * 60_000)
const BASE = new Date('2026-11-12T12:00:00Z').getTime()

function entry(id: number, kind: string) {
  return { id, storyId: 's', kind, actor: 'user', content: `条目${id}`, occurredAt: new Date(BASE + id * 60_000), metadata: {}, createdAt: new Date(BASE) } as any
}

test('#21 通道推导：group / private / mixed / 缺省（生活条目不携带通道）', async () => {
  const { factSourceChannel, mergeFactSourceChannel } = await import('../src/compaction/pipeline')
  const entries = [entry(1, 'group-message'), entry(2, 'character-group-message'), entry(3, 'user-message'), entry(4, 'character-message'), entry(5, 'script')]
  assert.equal(factSourceChannel(entries, [1]), 'group')
  assert.equal(factSourceChannel(entries, [1, 2]), 'group')
  assert.equal(factSourceChannel(entries, [3]), 'private')
  assert.equal(factSourceChannel(entries, [1, 3]), 'mixed')
  assert.equal(factSourceChannel(entries, [5]), undefined, '生活/script 条目 = 亲历，不携带通道')
  assert.equal(factSourceChannel(entries, [1, 5]), 'group', '群 + 生活 = 群（唯一聊天通道）')
  assert.equal(factSourceChannel(entries, []), undefined)
  // 合并：不同通道相遇 → mixed；任一侧缺省取另一侧。
  assert.equal(mergeFactSourceChannel('group', 'private'), 'mixed')
  assert.equal(mergeFactSourceChannel(undefined, 'group'), 'group')
  assert.equal(mergeFactSourceChannel('group', undefined), 'group')
  assert.equal(mergeFactSourceChannel('mixed', 'private'), 'mixed')
})

async function factHost(existing: any[] = []) {
  const { InterludeService } = await import('../src/service')
  const { persistFact } = await import('../src/compaction/pipeline')
  const created: any[] = []
  const updates: any[] = []
  const host: any = Object.create(InterludeService.prototype)
  // memoryConfig 是原型 getter（读 config.runtime）——经 config 注入。
  host.config = { runtime: { factContentCharacters: 500, maxFactsPerStory: 500 } }
  host.dbGet = async (_table: string, query: any) => query?.id?.$in ? existing.filter((fact: any) => query.id.$in.includes(fact.id)) : existing
  host.dbCreate = async (_table: string, row: any) => { created.push(row) }
  host.dbSet = async (_table: string, query: any, patch: any) => { updates.push({ id: query.id, patch }) }
  return { host, persistFact, created, updates }
}

test('#21 persistFact 新建：群证据 → sourceChannel=group；纯生活 → 不带字段', async () => {
  const { host, persistFact, created } = await factHost()
  const groupEntries = [entry(1, 'group-message'), entry(2, 'script')]
  await persistFact(host, 's', { scope: 'world', content: '橙儿最近睡眠不好', importance: 0.6, confidence: 0.6, sourceEntryIds: [1] } as never, groupEntries, new Date(BASE))
  assert.equal(created[0].sourceChannel, 'group', '群聊蒸馏的事实带通道域')
  const lifeEntries = [entry(3, 'script')]
  await persistFact(host, 's', { scope: 'world', content: '她学会了做提拉米苏', importance: 0.5, confidence: 0.5, sourceEntryIds: [3] } as never, lifeEntries, new Date(BASE))
  assert.equal(created[1].sourceChannel, undefined, '纯生活事实不带通道（亲历）')
})

test('#21 persistFact 更新：已有 group 事实 + 私聊新证据 → mixed；缺省 + 群 → group', async () => {
  const { host, persistFact, updates } = await factHost([
    { id: 10, storyId: 's', participantId: '', status: 'active', content: '橙儿最近睡眠不好', sourceEntryIds: [1], sourceChannel: 'group', knowledge: { mode: 'unclassified', clauses: [], relatedFactIds: [] }, confidence: 0.5, importance: 0.5, unresolved: false },
  ])
  const privateEntries = [entry(2, 'user-message'), entry(3, 'character-message')]
  await persistFact(host, 's', { scope: 'world', content: '橙儿最近睡眠不好', importance: 0.6, confidence: 0.6, sourceEntryIds: [2] } as never, privateEntries, new Date(BASE))
  assert.equal(updates[0].patch.sourceChannel, 'mixed', '群事实遇私聊新证据 → mixed')
  const { host: host2, persistFact: pf2, updates: updates2 } = await factHost([
    { id: 11, storyId: 's', participantId: '', status: 'active', content: '橙儿最近睡眠不好', sourceEntryIds: [9], knowledge: undefined, confidence: 0.5, importance: 0.5, unresolved: false },
  ])
  await pf2(host2, 's', { scope: 'world', content: '橙儿最近睡眠不好', importance: 0.6, confidence: 0.6, sourceEntryIds: [5], knowledge: { mode: 'reported', holder: '橙儿', clauses: [], relatedFactIds: [] } } as never,
    [entry(5, 'group-message')], new Date(BASE))
  assert.equal(updates2[0].patch.sourceChannel, 'group', '缺省事实 + 群证据 → group')
})

test('#21 投影与提示词：sourceChannel 随证据进 payload；框架句覆盖主叙事与压缩', async () => {
  const { factEvidenceForPrompt, KNOWLEDGE_WRITING_FRAME } = await import('../src/script/knowledge-evidence')
  const projected = factEvidenceForPrompt({ id: 1, participantId: '', scope: 'world', content: '橙儿最近睡眠不好', importance: 0.5, confidence: 0.5, unresolved: false, status: 'active', sourceEntryIds: [1], sourceChannel: 'group' } as never)
  assert.equal((projected as any).sourceChannel, 'group')
  const without = factEvidenceForPrompt({ id: 2, participantId: '', scope: 'world', content: '她学会了做提拉米苏', importance: 0.5, confidence: 0.5, unresolved: false, status: 'active', sourceEntryIds: [3] } as never)
  assert.equal('sourceChannel' in without, false, '亲历事实不带字段')
  // 框架句进主叙事 systemPrompt（经 KNOWLEDGE_WRITING_FRAME）与压缩指令。
  assert.ok(KNOWLEDGE_WRITING_FRAME.includes('sourceChannel'), '框架句解释通道语义')
  assert.ok(KNOWLEDGE_WRITING_FRAME.includes('never her own direct experience'), '群通道 = 听说而非亲历')
  const narratorSource = readFileSync('src/narrator.ts', 'utf8')
  assert.ok(narratorSource.includes('kind is group-message or character-group-message is something she heard in a group chat'), '压缩指令要求群证据标 reported/hearsay')
})

test('#21 主叙事 systemPrompt 携带通道框架句', async () => {
  const { systemPrompt } = await import('../src/narrator')
  const prompt = systemPrompt('user-message', '', '', '', '', '')
  assert.ok(prompt.includes('Facts carry a sourceChannel'), '框架句进入主叙事合约')
})
