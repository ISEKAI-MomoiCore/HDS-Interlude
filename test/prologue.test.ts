import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from 'koishi'
import Http from '@koishijs/plugin-http'
import { SQLiteDriver } from '@minatojs/driver-sqlite'
import * as plugin from '../src/index'
import { applyConfigSectionPatch, readConfigCenter } from '../src/console/config-center'
import { toPromptPayload } from '../src/narrator'
import { preparePrologue } from '../src/script/prologue'
import type { NarrativeRequest } from '../src/types'

const earlier = '她把借来的伞搁在门边，记得答应了要还。'
const opening = '  她一个人在玄关修伞，想起昨天那句<say id="old">明天还你</say>。\n'
const fixture = { passages: [earlier, opening], place: '玄关', activity: '修伞', presenceQuote: '一个人' }
const first = { platform: 'onebot', selfId: '99910001', userId: '88810001', channelId: 'private:88810001', isDirect: true }
const second = { ...first, userId: '88810002', channelId: 'private:88810002' }

async function withStoryHost(run: (app: Context, host: any) => Promise<void>) {
  const app = new Context()
  app.plugin(Http)
  app.plugin(SQLiteDriver, { path: ':memory:' })
  app.plugin(plugin, {
    storyDefaults: { prologue: fixture },
    runtime: { autoAdvanceEnabled: false, contextTimeWindowMinutes: 0, contextEntryMode: 'auto' },
    onebot: { willingnessPresetMigrated: true },
    logging: { level: 'silent' },
    memory: { enabled: false },
    schedulePreplan: { enabled: false },
    presetSync: { enabled: false },
    stickers: { enabled: false },
    worldSeeder: { enabled: false },
    weather: { enabled: false },
    longHorizon: { enabled: false },
  })
  try {
    await app.start()
    for (let i = 0; !app.interlude && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(app.interlude)
    await run(app, app.interlude)
  } finally {
    await app.stop()
  }
}

test('前置剧本配置通过故事档案保存回读，段数和长度超限时整节不提交', () => {
  let writes = 0
  const host = {
    config: plugin.Config({}),
    updatePluginConfig(next: typeof host.config) { writes++; this.config = next },
  }
  const apply = (prologue: unknown) => applyConfigSectionPatch(host as any, plugin.Config, 'storyDefaults', { prologue })
  assert.equal(apply(fixture).ok, true)
  const viewed = readConfigCenter(host as any, plugin.Config, 'storyDefaults')
  assert.deepEqual((viewed.values?.prologue as typeof fixture).passages, fixture.passages)
  assert.equal(apply({ passages: ['甲', '乙', '丙', '丁'] }).ok, false)
  assert.equal(apply({ passages: ['字'.repeat(2001)] }).ok, false)
  assert.equal(writes, 1)
})

test('开场锚点先于触发消息，空白段跳过，仅原文支持的场景字段进入交接', () => {
  const now = new Date('2026-11-20T09:00:10.000Z')
  const receivedAt = new Date('2026-11-20T09:00:00.000Z')
  const rows = preparePrologue({ ...fixture, place: '后院', passages: [earlier, '   ', opening], presentPeople: ['小林'] }, 'story', now, receivedAt)
  assert.deepEqual(rows.map(row => row.content), [earlier, opening])
  assert.deepEqual(rows.map(row => row.occurredAt.toISOString()), ['2026-11-20T08:50:00.000Z', '2026-11-20T08:55:00.000Z'])
  assert.deepEqual(rows.map(row => row.metadata.lifeHandoff), [undefined, { activity: { value: '修伞', quote: '修伞' } }])
})

test('并发建档只导入一次，首轮主叙事从序章现场接入两种消息，之后按普通历史读取', async () => {
  await withStoryHost(async (app, host) => {
    const now = new Date()
    const [a, b] = await Promise.all([host.createStory(first, undefined, now), host.createStory(second, undefined, now)])
    assert.equal(a.id, b.id)
    const rows = await app.database.get('interlude_script_entry', { storyId: a.id, kind: 'prologue' }, { sort: { occurredAt: 'asc' } })
    assert.deepEqual(rows.map(row => row.content), [earlier, opening])
    assert.ok(rows.every(row => row.participantId === '' && row.metadata.source === 'administrator'))
    assert.equal((await app.database.get('interlude_scene', { storyId: a.id, status: 'active' })).length, 1)
    assert.deepEqual(await app.database.get('interlude_intent', { storyId: a.id }), [])
    const story = await host.getStory(a.id)
    const participant = await host.findParticipant(first, story)
    const afterCreation = Date.now()
    // Force both the entry-count and character windows to drop the historical rows by default.
    host.effectiveContextBudget = () => ({ count: 4, minutes: 0, mode: 'auto' })
    for (let i = 0; i < 6; i++) await app.database.create('interlude_script_entry', {
      storyId: a.id, participantId: participant.id, kind: 'user-message', actor: 'user',
      content: '甲'.repeat(13000), occurredAt: new Date(afterCreation + i + 1),
    })
    const seen: NarrativeRequest[] = []
    host.narrator = { decide: async (request: NarrativeRequest) => { seen.push(request); return { script: '她放下钳子。' } } }
    const at = new Date(afterCreation + 60_000)
    await host.decide(story, participant, 'user-message', now, at, '你出门了吗？', [])
    const groupMessage = '楼梯口有人摔倒了。'
    await host.decide(story, participant, 'user-message', now, at, groupMessage, [], [], {
      groupId: '123', channelId: '123', label: '邻居群', purpose: '', characterRole: '',
      messages: [{ senderId: '23', senderName: '小林', speaker: '小林', content: groupMessage, occurredAt: at }],
    })
    for (const request of seen) {
      assert.equal(request.sceneFrame?.place, '玄关')
      assert.equal(request.sceneFrame?.ongoingActivity, '修伞')
      assert.equal(request.recentEntries.length, 4)
      for (const cacheFirst of [false, true]) {
        const payload = toPromptPayload(request, { cacheFirst })
        const prologue = payload.relevantEstablishedEpisodes.recentScript.filter(row => row.narrativeAuthority === 'administrator-authored-past')
        assert.deepEqual(prologue.map(row => row.content), [earlier, opening])
        assert.equal(prologue[1].communicationOutcome, 'no-outgoing-action-recorded')
        assert.match(String(payload.relevantEstablishedEpisodes.prologueReading), /established pre-opening life/)
        assert.ok(!JSON.stringify(payload.ongoingThreads.deliveryReality ?? []).includes('明天还你'))
        assert.ok(JSON.stringify(payload.incomingEvent).includes(request.userMessage!))
      }
    }
    assert.deepEqual(seen.map(request => request.userMessage), ['你出门了吗？', '楼梯口有人摔倒了。'])
    let directorContinuation: string | undefined
    host.compactor = { planTimeline: async (request: import('../src/types').TimelinePlanRequest) => {
      directorContinuation = request.recentScriptContinuation?.content
      return { beats: [{ at: 0.5, kind: 'activity', summary: '她继续修伞。' }] }
    } }
    await host.planAutomaticTimeline(story, null, 'advance', now, at, [])
    assert.equal(directorContinuation, opening)
    const progressed = { ...story, state: { ...story.state, narrativeUpdateCount: 1 } }
    await host.decide(progressed, participant, 'user-message', now, at, '现在呢？', [])
    assert.ok(seen.at(-1)?.recentEntries.every(row => row.kind !== 'prologue'))
    // Changing the template after creation cannot replace already-imported prose.
    host.config.storyDefaults.prologue.passages = ['修改后的序章']
    await host.createStory(first)
    assert.equal((await app.database.get('interlude_script_entry', { storyId: a.id, kind: 'prologue' })).length, 2)
  })
})

test('前置剧本写入失败会回滚故事和已写序章，重新建档可完整导入', async () => {
  await withStoryHost(async (app, host) => {
    const create = host.dbCreate.bind(host)
    host.dbCreate = (table: string, row: { kind?: string, content?: string }) => {
      if (table === 'interlude_script_entry' && row.kind === 'prologue' && row.content === opening) throw new Error('test rollback')
      return create(table, row)
    }
    await assert.rejects(host.createStory(first), /test rollback/)
    assert.deepEqual(await app.database.get('interlude_story', {}), [])
    assert.deepEqual(await app.database.get('interlude_script_entry', { kind: 'prologue' }), [])
    host.dbCreate = create
    const story = await host.createStory(first)
    assert.equal((await app.database.get('interlude_script_entry', { storyId: story.id, kind: 'prologue' })).length, 2)
  })
})
