import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from 'koishi'
import { SQLiteDriver } from '@minatojs/driver-sqlite'
import { SharedWorks } from '../src/works'
import '../src/database'

test('CEV real in-memory SQLite atomically saves versions and rejects stale generations', async () => {
  const app = new Context()
  app.plugin(SQLiteDriver, { path: ':memory:' })
  let done!: () => void, fail!: (error: unknown) => void
  const finished = new Promise<void>((resolve, reject) => { done = resolve; fail = reject })
  app.inject(['database'], async ctx => {
    try {
      ctx.model.extend('interlude_work', { id: 'string(64)', storyId: 'string(255)', participantId: 'string(255)', generation: 'unsigned', state: 'json' }, { primary: 'id' })
      const works = new SharedWorks({
        get: async id => (await ctx.database.get('interlude_work', { id }))[0],
        create: async row => { await ctx.database.create('interlude_work', row) },
        replace: async (row, generation) => (await ctx.database.set('interlude_work', { id: row.id, generation }, { state: row.state, generation: row.generation })).matched === 1,
      })
      const row = await works.create('s', 'p', 'SQLite 作品', '初稿')
      const proposal = await works.propose('s', 'p', { baseRevisionId: row.state.head, content: '修订稿', reason: '用户反馈' }, 'protagonist', 'script:1', 1)
      const saved = await works.resolve('s', 'p', proposal.id, true)
      assert.equal(saved.state.revisions.length, 2)
      const stale = await ctx.database.set('interlude_work', { id: row.id, generation: 0 }, { state: row.state })
      assert.equal(stale.matched ?? 0, 0)
      assert.equal((await works.read('s', 'p'))!.state.head, saved.state.head)
      assert.equal((await ctx.database.get('interlude_work', {})).length, 1)
      await ctx.database.remove('interlude_work', { storyId: 's' })
      assert.equal(await works.read('s', 'p'), undefined)
      done()
    } catch (error) { fail(error) }
  })
  try { await app.start(); await finished } finally { await app.stop() }
})
