import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from 'koishi'
import { SQLiteDriver } from '@minatojs/driver-sqlite'
import { Config } from '../src/index'
import { registerTables } from '../src/database'
import { InterludeService } from '../src/service'
import { resolveModelRouting } from '../src/model-routing'
import { ConversationDensityTracker } from '../src/context-density'
import { ResearchDesk } from '../src/research/desk'
import { emptyStoryState } from '../src/types'

// Real SQLite IDs have gaps and may belong to other stories; the overview must
// count matching rows, preserve model identifiers and use the story's timezone.
test('概览：真实条目数、故事时区、完整模型标识和密钥就绪状态', async () => {
  const app = new Context()
  app.plugin(SQLiteDriver, { path: ':memory:' })
  let done!: () => void, fail!: (error: unknown) => void
  const finished = new Promise<void>((resolve, reject) => { done = resolve; fail = reject })
  app.inject(['database'], async ctx => {
    try {
      registerTables(ctx)
      await ctx.database.create('interlude_script_entry', { id: 100, storyId: 's' })
      await ctx.database.create('interlude_script_entry', { id: 200, storyId: 'other' })
      await ctx.database.create('interlude_script_entry', { id: 300, storyId: 's' })
      const host: any = Object.create(InterludeService.prototype)
      host.ctx = ctx
      host.config = Config({ model: { providers: [{ id: 'p', label: 'Provider A/B = Primary', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'fixture-key', model: 'org/model [revision] with spaces', useForMain: true }] }, research: { jev: { enabled: true } } })
      host.modelRouting = resolveModelRouting(host.config.model, host.config.alterSystem)
      const story = { id: 's', setting: { character: { name: '主角' }, timezone: 'America/New_York' }, state: emptyStoryState(), status: 'paused', cursorAt: new Date('2026-11-15T12:00:00Z') }
      story.state.automation.nextAdvanceAt = '2026-11-15T12:30:00Z'
      story.state.automation.lastAutoAdvanceAt = '2026-11-15T11:30:00Z'
      story.state.automation.conversationFollowUpAt = ['2026-11-15T12:10:00Z']
      let storyReads = 0
      host.getCanonicalStory = async () => { storyReads++; return story }
      host.participants = async () => [{ id: 'p1' }]
      host.dbRead = (task: any) => task()
      host.contextDensity = new ConversationDensityTracker()
      host.researchJevCounters = { calls: 0, triggered: 0 }
      const desk = new ResearchDesk()
      desk.offer('expired', { text: '过期资料', sourceUrl: '', confidence: 1, hard: false, ttlUntil: Date.now() - 1 }, Date.now() - 100)
      host.researchDeskFor = () => desk
      const overview = await host.consoleOverview()
      assert.equal(overview.story.found, true)
      assert.equal(overview.story.entryCount, 2)
      assert.equal(overview.story.cursorLocal, '2026-11-15 07:00:00 GMT-5')
      assert.equal(overview.story.status, 'paused')
      assert.equal(overview.story.nextAdvanceLocal, '2026-11-15 07:30:00 GMT-5')
      assert.equal(overview.story.lastAdvanceLocal, '2026-11-15 06:30:00 GMT-5')
      assert.equal(overview.story.followUpCount, 1)
      assert.equal(overview.density.budgets!.private.count, 18)
      assert.equal(overview.density.budgets!.group.count, 18)
      assert.equal(overview.density.budgets!.private.mode, 'fixed')
      assert.equal(overview.models[0].provider, 'Provider A/B = Primary')
      assert.equal(overview.models[0].model, 'org/model [revision] with spaces')
      assert.equal(overview.models.length, 8)
      assert.equal(overview.research.deskEntries, 0)
      assert.equal(overview.research.jev.keyConfigured, false)
      assert.equal(overview.switches.find((row: any) => row.key === 'jev').ok, false)
      assert.ok(!JSON.stringify(overview).includes('fixture-key'))
      assert.equal(storyReads, 2, 'main snapshot and scene summary each read the story once')
      const neutral = { privateBatch: 3, groupBatch: 3, groupBackground: 3, weather: 3, friendFeed: 3 }
      assert.equal(overview.story.eventAttention.status, 'missing')
      assert.deepEqual(overview.story.eventAttention.tiers, neutral)

      const assessedAt = new Date(Date.now() - 60_000).toISOString()
      story.state.lifeRhythm = { attention: 'device-focus-chat', assessedAt, source: 'narrator', basis: '私有剧本证据不进概览' }
      const current = await host.consoleOverview()
      assert.equal(current.story.rhythm, 'device-focus-chat')
      assert.equal(current.story.eventAttention.status, 'current')
      assert.match(current.story.eventAttention.assessedAtLocal, /GMT-[45]$/)
      assert.deepEqual(current.story.eventAttention.tiers, { privateBatch: 1, groupBatch: 2, groupBackground: 2, weather: 4, friendFeed: 2 })
      assert.ok(!JSON.stringify(current).includes('私有剧本证据不进概览'))
      story.state.lifeRhythm.attention = 'phone-focused'
      const legacy = await host.consoleOverview()
      assert.equal(legacy.story.eventAttention.status, 'legacy')
      assert.deepEqual(legacy.story.eventAttention.tiers, neutral)
      story.state.lifeRhythm.attention = 'asleep'
      assert.equal((await host.consoleOverview()).story.eventAttention.tiers.privateBatch, 5)
      story.state.lifeRhythm.assessedAt = new Date(Date.now() - 3 * 3_600_000).toISOString()
      const stale = await host.consoleOverview()
      assert.equal(stale.story.rhythm, 'asleep', 'stored state is not rewritten by the preview')
      assert.equal(stale.story.eventAttention.status, 'stale')
      assert.deepEqual(stale.story.eventAttention.tiers, neutral)
      done()
    } catch (error) { fail(error) }
  })
  try { await app.start(); await finished } finally { await app.stop() }
})
