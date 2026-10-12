import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseWorldSeedEvents, resolveWorldSeederRuntime, seedDomainForRun, summaryJaccard, WORLD_SEED_DOMAINS,
  validateSeedEvent, worldSeederSystemPrompt, type SeedValidationInput, type WorldSeedEventDraft,
} from '../src/world-seeder'

const NOW = new Date('2026-09-26T10:00:00+08:00')
const BASE: SeedValidationInput = {
  now: NOW, timezone: 'Asia/Shanghai', maxHorizonHours: 72,
  blockedNames: ['小桃'], recentSummaries: [],
}

function draft(overrides: Partial<WorldSeedEventDraft> = {}): WorldSeedEventDraft {
  return {
    summary: '楼下五金店开始装修，电钻声断断续续。',
    importance: 'low',
    occursAt: new Date('2026-09-26T11:30:00+08:00'),
    subjects: [],
    rationale: '上午在家的质感事件',
    ...overrides,
  }
}

test('runtime resolves from the assignment checkbox: no assigned provider means disabled, clamps applied', () => {
  const off = resolveWorldSeederRuntime(undefined)
  assert.equal(off.enabled, false)
  // 总开关开了但没有勾选“用于世界播种”的连接 → 关闭。
  const unassigned = resolveWorldSeederRuntime({ enabled: true })
  assert.equal(unassigned.enabled, false)
  const disabledProvider = resolveWorldSeederRuntime({ enabled: true }, { enabled: false, model: 'm' } as any)
  assert.equal(disabledProvider.enabled, false)
  const on = resolveWorldSeederRuntime({
    enabled: true,
    cadenceMinutes: 999_999, dailyCap: 99, temperature: 9,
  }, { enabled: true, model: 'seeder-model' } as any)
  assert.equal(on.enabled, true)
  assert.equal(on.provider?.model, 'seeder-model')
  assert.equal(on.cadenceMinutes, 1_440)
  assert.equal(on.dailyCap, 20)
  assert.equal(on.temperature, 2)
})

test('parseWorldSeedEvents trims defensively and drops malformed entries', () => {
  const parsed = parseWorldSeedEvents({
    events: [
      { summary: '  快递到了，放在驿站。 ', importance: 'medium', occursAt: '2026-09-26T12:00:00+08:00', subjects: ['快递员', 42], rationale: 'x'.repeat(500) },
      { summary: '', importance: 'low', occursAt: '2026-09-26T12:00:00+08:00' },
      { summary: '坏时间', importance: 'low', occursAt: 'not-a-date' },
      { summary: '坏档', importance: 'huge', occursAt: '2026-09-26T12:00:00+08:00' },
      'junk',
    ],
  })
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]!.summary, '快递到了，放在驿站。')
  assert.deepEqual(parsed[0]!.subjects, ['快递员'])
  assert.equal(parsed[0]!.rationale.length, 200)
  assert.deepEqual(parseWorldSeedEvents({}), [])
  assert.deepEqual(parseWorldSeedEvents('junk'), [])
})

test('validation gates reject each documented failure mode', () => {
  assert.equal(validateSeedEvent(draft(), BASE), undefined, 'clean draft passes')
  assert.equal(validateSeedEvent(draft({ summary: '' }), BASE), 'empty-summary')
  assert.equal(validateSeedEvent(draft({ importance: 'huge' as never }), BASE), 'invalid-importance')
  assert.equal(validateSeedEvent(draft({ occursAt: new Date('2026-09-26T09:00:00+08:00') }), BASE), 'invalid-time', 'past')
  assert.equal(validateSeedEvent(draft({ occursAt: new Date('2026-10-20T09:00:00+08:00') }), BASE), 'invalid-time', 'beyond horizon')
  assert.equal(validateSeedEvent(draft({ summary: '小桃在楼下和她打招呼。' }), BASE), 'blocked-name', 'summary mention')
  assert.equal(validateSeedEvent(draft({ subjects: ['小桃'] }), BASE), 'blocked-name', 'subject mention')
  assert.equal(validateSeedEvent(draft({ importance: 'high', occursAt: new Date('2026-09-27T02:00:00+08:00') }), BASE), 'night-high')
  assert.equal(validateSeedEvent(draft(), { ...BASE, recentSummaries: ['楼下五金店开始装修，电钻声断断续续响着。'] }), 'duplicate')
})

test('high importance is allowed during waking hours and duplicates below threshold pass', () => {
  assert.equal(validateSeedEvent(draft({ importance: 'high', occursAt: new Date('2026-09-26T14:00:00+08:00') }), BASE), undefined)
  assert.equal(validateSeedEvent(draft(), { ...BASE, recentSummaries: ['完全无关的另一件事。'] }), undefined)
})

test('summaryJaccard separates near-duplicates from unrelated text', () => {
  assert.ok(summaryJaccard('楼下五金店开始装修，电钻声断断续续。', '楼下五金店开始装修，电钻声阵阵。') > 0.6)
  assert.ok(summaryJaccard('楼下五金店开始装修。', '她在集市买了两斤苹果。') < 0.3)
})

test('seeder prompt teaches the critical rules', () => {
  const prompt = worldSeederSystemPrompt()
  assert.match(prompt, /NEVER generate events about BLOCKED NAMES/)
  assert.match(prompt, /Offline channels only/)
  assert.match(prompt, /External facts only/)
  assert.match(prompt, /Most runs should produce 0-2 events/)
  assert.match(prompt, /Prefer medium for events involving named NPCs/)
  assert.match(prompt, /CONNECT TO HER LIFE/)
  assert.match(prompt, /Variety: avoid repeating/)
})

test('世界切面轮换：同槽稳定、跨槽前进、一个周期覆盖全部切面', () => {
  const storyId = 'fixture-story'
  const slot = new Date('2026-09-29T01:50:00+08:00')
  const a = seedDomainForRun(storyId, slot, 45)
  assert.equal(seedDomainForRun(storyId, slot, 45).key, a.key, '同参数确定性（同一轮 sweep 的多次调用一致）')
  const next = seedDomainForRun(storyId, new Date(slot.getTime() + 45 * 60_000), 45)
  assert.notEqual(next.key, a.key, '相邻槽前进一格')
  const seq = Array.from({ length: 6 }, (_, i) => seedDomainForRun(storyId, new Date(slot.getTime() + i * 45 * 60_000), 45).key)
  assert.equal(new Set(seq).size, 6, '一个完整周期覆盖六个切面')
  assert.equal(seedDomainForRun(storyId, new Date(slot.getTime() + 6 * 45 * 60_000), 45).key, a.key, '周期回到起点')
  // 不同剧本相位不同：全部故事不会同步走同一切面
  const keys = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map(id => seedDomainForRun(id, slot, 45).key))
  assert.ok(keys.size > 1, '跨剧本相位错开')
})

test('播种提示词按切面提问且每轮至多一事件', () => {
  const plain = worldSeederSystemPrompt()
  assert.match(plain, /Most runs should produce 0-2 events/)
  assert.doesNotMatch(plain, /SLICE OF THE WORLD/, '无切面时保持通用形态（兼容旧调用）')
  const sliced = worldSeederSystemPrompt(WORLD_SEED_DOMAINS[2])
  assert.match(sliced, /THIS RUN'S SLICE OF THE WORLD: 生计与日常事务/)
  assert.match(sliced, /render it through this world's own places/)
  assert.match(sliced, /If nothing genuine fits the slice right now, return an empty array/)
  assert.match(sliced, /never import real-world institutions into a world that does not have them/, '异世界兼容：切面按世界语汇本地化')
})
