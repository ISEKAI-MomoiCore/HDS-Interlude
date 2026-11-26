import assert from 'node:assert/strict'
import test from 'node:test'
import { Context, Logger } from 'koishi'
import Http from '@koishijs/plugin-http'
import { SQLiteDriver } from '@minatojs/driver-sqlite'
import * as plugin from '../src/index'
import { createScheduler } from '../src/scheduler'
import { restoreMessageEvent } from '../src/delivery'
import type { InterludeParticipant, InterludeStory, OutgoingMessageDraft } from '../src/types'

const alice = { platform: 'onebot', selfId: '99910001', userId: '88810001', channelId: 'private:88810001', isDirect: true }
const bob = { ...alice, userId: '88810002', channelId: 'private:88810002' }

async function withStoryHost(run: (app: Context, host: any, story: InterludeStory) => Promise<void>) {
  const app = new Context()
  app.plugin(Http)
  app.plugin(SQLiteDriver, { path: ':memory:' })
  app.plugin(plugin, {
    runtime: { autoAdvanceEnabled: false },
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
    const host: any = app.interlude
    await run(app, host, await host.createStory(alice))
  } finally {
    await app.stop()
  }
}

function commitReply(host: any, story: InterludeStory, participant: InterludeParticipant, bubbles: string[], delay: number, onCommitted = () => {}) {
  const now = new Date()
  return host.persistDecision(story, participant, {
    script: 'She sent a reply.',
    interaction: { seen: true, reply: { mode: 'immediate', content: bubbles.join('<sep/>'), bubbleDelaySeconds: bubbles.map(() => delay) } },
  }, new Date(+now - 1_000), now, true, 'user-message', [], false, undefined, { startedAt: now, onCommitted })
}

const replyRows = (app: Context, storyId: string) => app.database.get('interlude_script_entry', { storyId, kind: 'script' })
const planRows = (app: Context, storyId: string) => app.database.get('interlude_intent', { storyId, type: 'split-message' })

test('timed private reply commits the SQLite ledger and plan together before marking, scheduling, or caching', async () => {
  await withStoryHost(async (app, host, story) => {
    const participant = await host.findParticipant(alice, story)
    assert.ok(participant)
    const cached = new Map()
    host.historyVectors.set(story.id, cached)
    const effects: string[] = []
    const mark = () => { assert.equal(host.transactionRunning, false); effects.push('committed') }
    const reportOperation = host.reportOperation.bind(host)
    host.reportOperation = (...args: unknown[]) => {
      if (typeof args[4] === 'string' && args[4].includes('私聊回复已排程')) {
        assert.equal(host.transactionRunning, false)
        assert.equal(args[5], 2)
        effects.push('logged')
      }
      return reportOperation(...args)
    }
    host.scheduleDueIntentWake = () => { assert.equal(host.transactionRunning, false); effects.push('scheduled') }
    const create = host.dbCreate.bind(host)
    host.dbCreate = async (table: string, row: { type?: string }) => {
      const inserted = await create(table, row)
      if (table === 'interlude_intent' && row.type === 'split-message') {
        assert.ok(host.transactionScope.getStore())
        throw new Error('test failure after plan insert')
      }
      return inserted
    }
    const bubbles = ['I can make it.', 'How about Friday?']
    await assert.rejects(commitReply(host, story, participant, bubbles, 60, mark), /test failure after plan insert/)
    assert.deepEqual(await replyRows(app, story.id), [])
    assert.deepEqual(await planRows(app, story.id), [])
    assert.equal(cached.size, 0)
    assert.deepEqual(effects, [])

    host.dbCreate = create
    const result = await commitReply(host, story, participant, bubbles, 60, mark)
    const entries = await replyRows(app, story.id)
    const plans = await planRows(app, story.id)
    assert.equal(entries.length, 1)
    assert.equal(plans.length, 1)
    const [entry] = entries
    const [plan] = plans
    const ref = restoreMessageEvent(plan.payload, '')
    assert.equal(ref?.scriptEntryId, entry.id)
    assert.equal(ref?.commitId, entry.metadata.commitId)
    assert.equal(ref?.eventId, (entry.metadata.deliveryActions as any[])[0].eventId)
    assert.deepEqual((entry.metadata.deliveryActions as any[])[0].segments.map(segment => [segment.content, segment.status]), bubbles.map(content => [content, 'pending']))
    assert.deepEqual((plan.payload.privateBubblePlan as any).bubbles.map((bubble: any) => bubble.content), bubbles)
    assert.equal(cached.has(entry.id), true)
    assert.deepEqual(effects, ['committed', 'scheduled', 'logged'])
    assert.deepEqual(result.messages, [], 'a timed reply is sent only by the durable plan')

    // Simulate a fresh commit between the initial owner read and its script page.
    // The second owner read must prevent a false alarm. Then emulate a legacy orphan.
    const warnings: unknown[][] = []
    host.reportStandalone = (...args: unknown[]) => { if (args[0] === 'warn') warnings.push(args) }
    host.deliverOutgoingMessages = async () => assert.fail('generic recovery must never transport timed private replies')
    const read = host.dbGet.bind(host)
    let stale = true
    host.dbGet = async (table: string, query: { type?: string }, ...args: unknown[]) => {
      if (stale && table === 'interlude_intent' && query.type === 'split-message') { stale = false; return [] }
      return read(table, query, ...args)
    }
    await host.recoverPendingDeliveries(true, story.id)
    assert.deepEqual(warnings, [])
    host.dbGet = read
    await app.database.remove('interlude_intent', { id: plan.id })
    await host.recoverPendingDeliveries(true, story.id)
    await host.recoverPendingDeliveries(true, story.id)
    assert.equal(warnings.length, 1)
    assert.match(String(warnings[0][1]), /账本缺少发送计划/)
    assert.deepEqual(await replyRows(app, story.id), entries)
    assert.deepEqual(await planRows(app, story.id), [])
  })
})

test('cancelling Alice’s split restores Bob’s overdue wake, sends it once and rearms the next future plan', async () => {
  await withStoryHost(async (app, host, story) => {
    await host.createStory(bob)
    const a = await host.findParticipant(alice, story)
    const b = await host.findParticipant(bob, story)
    assert.ok(a && b && a.id !== b.id)
    host.scheduler.cancelWakes()
    let timer: { callback: () => void, at: number } | undefined
    let clock = Date.now()
    let wake: Promise<unknown> | undefined
    const wakeDueIntents = host.wakeDueIntents.bind(host)
    host.wakeDueIntents = (id: string) => (wake = wakeDueIntents(id))
    host.scheduler = createScheduler({
      now: () => clock,
      setTimeout(callback, ms) {
        const pending = { callback, at: clock + ms }
        timer = pending
        return () => { if (timer === pending) timer = undefined }
      },
      retryDelayMs: 1_000, deferDelayMs: 500,
      onWakeError: assert.fail, onTaskError: assert.fail,
    })
    const fireTimer = async () => {
      assert.ok(timer)
      const { callback } = timer
      timer = undefined
      wake = undefined
      callback()
      await Promise.resolve()
      assert.ok(wake)
      await wake
    }
    await commitReply(host, story, a, ['Alice draft'], 10)
    await commitReply(host, story, b, ['Bob overdue'], 20)
    await commitReply(host, story, b, ['Bob future'], 60)
    const plans = await planRows(app, story.id)
    const [aPlan, bPlan, futurePlan] = plans.sort((l, r) => l.id - r.id)
    assert.equal(aPlan.participantId, a.id)
    assert.equal(bPlan.participantId, b.id)
    assert.equal(futurePlan.participantId, b.id)
    assert.equal(timer?.at, +aPlan.notBefore, 'Alice owns the old earliest timer')

    await app.database.set('interlude_intent', { id: bPlan.id }, { notBefore: new Date(Date.now() - 1_000) })
    clock = Date.now()
    const sent: string[] = []
    host.sweep = async () => {}
    host.deliverOutgoingMessages = async (_story: InterludeStory, [message]: OutgoingMessageDraft[]) => {
      assert.equal(message.participantId, b.id)
      assert.equal(message.beginPrivateBubbleTransport?.(), true)
      sent.push(message.content)
      await host.updateScriptDeliveryOutcome(story.id, message.scriptEvent, 'delivered', new Date())
      return [message]
    }
    const cancelled = await host.serial(story.id, () => host.cancelPendingOutgoingMessages(story.id, a.id, new Date()))
    assert.deepEqual(cancelled.map((intent: { id: number }) => intent.id), [aPlan.id])
    assert.ok(timer && timer.at <= clock + 100, 'the overdue plan receives an immediate timer')
    await fireTimer()
    await fireTimer() // settlement wakes the story again to pick up remaining work
    assert.deepEqual(sent, ['Bob overdue'])
    assert.deepEqual((await planRows(app, story.id)).sort((l, r) => l.id - r.id).map(plan => plan.status), ['cancelled', 'completed', 'pending'])
    assert.equal(timer?.at, +futurePlan.notBefore)
  })
})


test('Koishi silent suppresses HDSI startup and auxiliary logs, and skipped advancement never reports success', async t => {
  const lines: string[] = []
  const target = { colors: 0, print: (line: string) => { lines.push(line) } }
  Logger.targets.push(target)
  t.after(() => Logger.targets.splice(Logger.targets.indexOf(target), 1))
  await withStoryHost(async (app, host, story) => {
    host.operationLogger.info('AUXILIARY-HDSI-SENTINEL')
    host.operationLogger.warn('AUXILIARY-HDSI-WARN')
    app.logger('hdsi-test-observer').info('OBSERVER-SENTINEL')
    assert.match(lines.join('\n'), /OBSERVER-SENTINEL/)
    assert.doesNotMatch(lines.join('\n'), /hds-interlude |AUXILIARY-HDSI/)

    host.config.logging = { ...host.config.logging, level: 'info', verbosity: 'summary', colors: false, format: 'compact' }
    await app.database.set('interlude_story', { id: story.id }, { cursorAt: new Date() })
    let calls = 0
    host.tryDecide = async () => { calls++; return { succeeded: true, decision: { script: 'She sat down near the door.' } } }
    await host.advanceStory(story, true)
    assert.equal(calls, 0)
    assert.match(lines.join('\n'), /手动推进跳过/)
    assert.doesNotMatch(lines.join('\n'), /剧本推进完成|剧本已提交/)
    await app.database.set('interlude_story', { id: story.id }, { cursorAt: new Date(Date.now() - 3600_000) })
    await host.advanceStory(story, true)
    assert.equal(calls, 1)
    assert.equal((await replyRows(app, story.id)).length, 1)
    assert.match(lines.join('\n'), /推进剧本已提交 待交投递管线的消息=0/)
  })
})
