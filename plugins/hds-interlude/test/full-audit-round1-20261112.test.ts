import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import Console from '@koishijs/plugin-console'
import { InterludeService } from '../src/service'
import { OneBotAdapter } from '../src/platform/onebot-adapter'
import { executeGroupNarrativeTurn } from '../src/narrative/turn-executor'
import { sendGroupMessage } from '../src/delivery/pipeline'
import { executeGroupReactions, sendSticker, sendNativeFace } from '../src/group-actions'
import { executeResearchIntent, jevGatePassiveResearch } from '../src/intents'
import { ResearchDesk, DEFAULT_RESEARCH_CONFIG } from '../src/research/desk'
import { emptyStoryState } from '../src/types'

const root = resolve(__dirname, '..')
const proto = InterludeService.prototype as any
const noop = () => {}
const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<any>
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function story() {
  return { id: 's', platform: 'onebot', selfId: '1', status: 'active', state: emptyStoryState(),
    setting: { timezone: 'Asia/Shanghai', character: { name: '小夜' } }, cursorAt: new Date() } as any
}
function lifecycleHost() {
  return Object.assign(Object.create(proto), {
    runtimeGeneration: 0, runtimePauseGeneration: 0, storyTaskGenerations: new Map(), acceptedDeliveries: new Map(),
    databaseResetting: false, desktopRuntimePhase: 'running', disposed: false,
    researchDesks: new Map(), researchDueIntents: [],
    serial: async (_: string, task: () => unknown) => task(), report: noop, reportOperation: noop, reportStandalone: noop,
    scheduler: { cancelWakes: noop }, turnEngine: { turns: new Map(), rescheduleTimers: noop }, bufferedGroupTurns: new Map(),
    desktopRuntimeSnapshot: async () => ({}),
  }) as any
}

test('F01 shipped Console module exports a callable page installer through host-style imports', async () => {
  // Support the old filename only to demonstrate its loading failure before rebuilding.
  let source: string
  try { source = readFileSync(resolve(root, 'client-dist/index.js'), 'utf8') }
  catch { source = readFileSync(resolve(root, 'client-dist/hdsi-console.js'), 'utf8') }
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*(['"])(vue|vue-router|@koishijs\/client)\2/g, (_match, names: string) => {
    const exports = names.split(',').map(value => value.trim().split(/\s+as\s+/)[0]).filter(Boolean)
    const stub = exports.map(name => name === 'icons' ? 'export const icons = { register() {} };' : `export const ${name} = (...args) => args[0];`).join('\n')
    return `import {${names}} from 'data:text/javascript;base64,${Buffer.from(stub).toString('base64')}'`
  })
  const module = await nativeImport(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  assert.equal(typeof module.default, 'function')
  const pages: any[] = []
  module.default({ page: (page: any) => pages.push(page) })
  assert.equal(pages.length, 1)
  assert.equal(pages[0].path, '/hdsi/:page*')
})

test('F01 production Console installation registers a directory with loadable JS and CSS', () => {
  const source = ts.transpileModule(readFileSync(resolve(root, 'src/console/index.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const packagedRequire = createRequire(resolve(root, 'lib/index.js'))
  const localRequire = Object.assign((name: string) => name === './rpc' ? { installConfigRpc: noop }
    : name === './config-center' ? { installConfigCenterRpc: noop }
    : name === './actions' ? { installActionsRpc: noop } : packagedRequire(name), { resolve: packagedRequire.resolve })
  const exports: any = {}
  runInNewContext(source, { exports, require: localRequire, __dirname: resolve(root, 'lib') })
  let registered: any
  exports.installHdsiConsole({ plugin: noop, console: { addListener: noop, addEntry: (entry: any) => { registered = entry } }, logger: () => ({ warn: noop }) }, {}, {})
  assert.equal(typeof registered, 'string', 'directory registration enables host stylesheet discovery')
  const files = Console.prototype.resolveEntry.call({ config: { devMode: false, uiPath: '/console' }, getFiles: (files: any) => files } as any, registered, 'hdsi')
  assert.ok(files.some(file => file.endsWith('/index.js')))
  assert.ok(files.some(file => file.endsWith('/style.css')))
  assert.ok(readFileSync(resolve(registered, 'style.css'), 'utf8').length > 0)
})

function groupFixture() {
  const svc = lifecycleHost(), current = story(), entries: any[] = [], errors: unknown[] = [], sent: string[] = []
  const turn = { storyId: 's', groupId: '100', rule: { groupId: '100', contextLimit: 20 }, channelId: 'group:100',
    latestHandle: { platform: 'onebot', channelId: 'group:100', selfId: '1' },
    messages: [{ speaker: '成员', content: '你好' }], revision: 1, mentionedBot: true }
  Object.defineProperty(svc, 'audioConfig', { value: { maxPerMessage: 1, maxFileSizeMB: 1 } })
  Object.assign(svc, {
    consumeNarrativeSalienceForGroup: noop, advanceGroupBackgroundWatermarkForTurn: async () => {},
    groupWillingness: new Map(), config: { runtime: { maxMessageCharacters: 500, messageSeparator: '<sep/>', splitReplyMessages: true }, model: {} },
    getStory: async () => current,
    groupMessages: async () => ({ messages: [], imageRefs: [] }), groupCooldownActive: async () => false,
    pauseAutomaticAdvanceAfterUserMessage: async () => {}, semanticTurnEmbeddingEnabled: () => false,
    jevGatePassiveResearch: async () => {}, tryDecide: async () => ({ decision: { groupReply: { mode: 'immediate', content: '第一段<sep/>第二段' } }, succeeded: true }),
    resolveSticker: () => undefined, resolveNativeFace: () => undefined,
    persistDecision: async () => ({ messages: [], commit: undefined, scriptEntry: { id: 9 } }),
    dbSet: async () => {}, scheduleConversationFollowUpsAfterTurn: async () => {},
    appendEntry: async (_: string, entry: any) => entries.push(entry), scheduleCompaction: noop,
    report: (...args: unknown[]) => errors.push(args), endpointRows: [], ensureEndpointRegistry: async () => {},
    endpointAddressSync: () => ({ platform: 'onebot', selfId: '1' }), noteEndpointOutbound: noop,
    splitOutgoingMessage: (text: string) => text.split('<sep/>'),
    ctx: { bots: [{ platform: 'onebot', selfId: '1', sendMessage: async (_: string, content: string) => { sent.push(content); return ['receipt'] } }] },
  })
  Object.defineProperty(svc, 'platformPort', { configurable: true, value: {
    groupCapabilities: () => undefined, stickerCatalog: async () => [], loadImages: async () => [], historicalImages: async () => [],
    sendGroupMessage: (s: any, channel: string, text: string, reply: any, _handle: any, control: any) => sendGroupMessage(svc, s, channel, text, reply, undefined, undefined, undefined, control ? { shouldCancel: control, settled: new Map(), onDelivered: noop } : undefined),
  } })
  svc.bufferedGroupTurns.set('s:100', turn)
  return { svc, current, entries, errors, sent, turn, run: () => executeGroupNarrativeTurn(svc, 's:100', turn) }
}

test('F02 normal immediate group delivery records both segments once', async () => {
  const f = groupFixture(); await f.run()
  assert.deepEqual(f.errors, []); assert.deepEqual(f.sent, ['第一段', '第二段'])
  assert.equal(f.entries.length, 1); assert.equal(f.entries[0].content, '第一段<sep/>第二段')
})

for (const mode of ['pause', 'pause-resume', 'reset'] as const) {
  test(`F02 immediate group ${mode} while first segment is in flight`, async () => {
    const f = groupFixture(), started = deferred(), transport = deferred<string[]>()
    f.svc.ctx.bots[0].sendMessage = async (_: string, text: string) => { f.sent.push(text); started.resolve(); return transport.promise }
    const run = f.run(); await started.promise
    if (mode === 'reset') { proto.invalidateStoryTasks.call(f.svc, 's'); f.svc.bufferedGroupTurns.clear(); f.svc.groupWillingness.clear() }
    else { await f.svc.setDesktopRuntimePhase('paused'); if (mode === 'pause-resume') await f.svc.setDesktopRuntimePhase('running') }
    transport.resolve(['receipt']); await run
    assert.deepEqual(f.errors, []); assert.deepEqual(f.sent, ['第一段'])
    assert.equal(f.entries.length, mode === 'reset' ? 0 : 1)
    if (mode !== 'reset') assert.equal(f.entries[0].content, '第一段')
    else assert.equal(f.svc.groupWillingness.size, 0, 'old reply consumption does not restore reset state')
  })
}

test('F02 pause/resume while model is in flight retires the old immediate group result', async () => {
  const f = groupFixture(), started = deferred(), model = deferred<any>()
  f.svc.tryDecide = async () => { started.resolve(); return model.promise }
  const run = f.run(); await started.promise
  await f.svc.setDesktopRuntimePhase('paused'); await f.svc.setDesktopRuntimePhase('running')
  model.resolve({ decision: { groupReply: { mode: 'immediate', content: '旧回复' } }, succeeded: true }); await run
  assert.deepEqual(f.errors, []); assert.deepEqual(f.sent, []); assert.deepEqual(f.entries, [])
})

for (const action of ['reaction', 'sticker', 'face'] as const) {
  for (const mode of ['pause', 'reset'] as const) {
    test(`F02 ${action} acknowledgement ${mode} follows content generation`, async () => {
      const svc = lifecycleHost(), s = story(), started = deferred(), transport = deferred<any>(), entries: any[] = []
      Object.defineProperty(svc, 'stickerConfig', { value: { directory: 'stickers' } })
      Object.assign(svc, { ctx: { baseDir: root },
        appendEntry: async (_: string, entry: any) => entries.push(entry), updateScriptDeliveryOutcome: async () => {},
        desktopOnebotActionHandler: async () => { started.resolve(); return transport.promise } })
      const session = { platform: 'onebot', selfId: '1', bot: { internal: { setMsgEmojiLike: async () => { started.resolve(); return transport.promise } } } } as any
      const run = action === 'reaction' ? executeGroupReactions(svc, s, session, '100', [{ messageId: 'm', messageRef: 'msg-1', reaction: 'like' }] as any)
        : action === 'sticker' ? sendSticker(svc, s, session, 'group:100', { filePath: 'test.png', description: '表情', assetId: 'a' } as any, '100')
        : sendNativeFace(svc, s, session, 'group:100', 'smile' as any, '100')
      await started.promise
      if (mode === 'reset') proto.invalidateStoryTasks.call(svc, 's')
      else await svc.setDesktopRuntimePhase('paused')
      transport.resolve({ ok: true }); await run
      assert.equal(entries.length, mode === 'reset' ? 0 : 1)
    })
  }
}

function researchFixture() {
  const svc = lifecycleHost(), current = story(), writes: any[] = [], pending = { id: 7, storyId: 's', status: 'pending', type: 'research-lookup', summary: '地点资料', payload: {} }
  Object.assign(svc, { config: { research: { ...DEFAULT_RESEARCH_CONFIG, enabled: true, taskTokenBudget: 600, jev: { ...DEFAULT_RESEARCH_CONFIG.jev, enabled: true, apiKey: 'probe', noulThreshold: 0.6 } } },
    researchProvider: () => ({ proxyAgent: '' }), participants: async () => [],
    dbGet: async (table: string) => table === 'interlude_intent' && pending.status === 'pending' ? [pending] : [],
    dbSet: async (table: string, _query: any, patch: any) => { writes.push({ table, patch }); if (table === 'interlude_intent') Object.assign(pending, patch) },
    researchToolsRegistry: { search: async () => [{ url: 'https://example.test/material', title: '地点资料', snippet: '核实内容'.repeat(30) }], fetch: async () => undefined },
    researchNarrator: { customSideTask: async () => ({ facts: [{ text: '地点核实资料', sourceUrl: 'https://example.test/material', confidence: 0.9, hard: true, volatile: false }], insufficient: false, reason: 'ok' }) },
    ctx: { http: { get: async () => ({}), post: async () => ({}) } }, researchJevCounters: { calls: 0, triggered: 0 }, researchScriptTail: async () => '',
  })
  return { svc, current, pending, writes }
}

test('F03 normal pending research writes one desk fact and completes its intent', async () => {
  const f = researchFixture(); await executeResearchIntent(f.svc, f.current, f.pending as any, new Date())
  assert.equal(f.svc.researchDeskFor('s').size, 1); assert.equal(f.pending.status, 'completed')
})

test('F03 already cancelled research does not start model or search work', async () => {
  const f = researchFixture(); f.pending.status = 'cancelled'
  let calls = 0; f.svc.researchNarrator.customSideTask = async () => { calls++; return {} }
  await executeResearchIntent(f.svc, f.current, f.pending as any, new Date())
  assert.equal(calls, 0); assert.equal(f.svc.researchDesks.size, 0); assert.equal(f.writes.length, 0)
})

for (const all of [false, true]) {
  test(`F03 ${all ? 'global' : 'story'} invalidation removes appropriate desks and queued research`, () => {
    const f = researchFixture()
    f.svc.researchDeskFor('s'); f.svc.researchDeskFor('other')
    f.svc.researchDueIntents.push(f.pending, { storyId: 'other', id: 8 })
    proto.invalidateStoryTasks.call(f.svc, all ? undefined : 's')
    assert.equal(f.svc.researchDesks.has('s'), false)
    assert.equal(f.svc.researchDesks.has('other'), !all)
    assert.deepEqual((f.svc.researchDueIntents ?? []).map((x: any) => x.storyId), all ? [] : ['other'])
  })
}

for (const mode of ['pause-resume', 'reset', 'clear'] as const) {
  test(`F03 ${mode} retires a research distillation in flight`, async () => {
    const f = researchFixture(), started = deferred(), model = deferred<any>()
    f.svc.researchNarrator.customSideTask = async () => { started.resolve(); return model.promise }
    const run = executeResearchIntent(f.svc, f.current, f.pending as any, new Date()); await started.promise
    const oldDesk: ResearchDesk = f.svc.researchDesks.get('s')
    if (mode === 'pause-resume') { await f.svc.setDesktopRuntimePhase('paused'); await f.svc.setDesktopRuntimePhase('running') }
    else proto.invalidateStoryTasks.call(f.svc, mode === 'clear' ? undefined : 's')
    model.resolve({ facts: [{ text: '旧地点资料', sourceUrl: 'https://example.test', confidence: 1, hard: true, volatile: false }], insufficient: false, reason: '' }); await run
    assert.equal(oldDesk.size, 0); assert.equal(f.svc.researchDeskFor('s').size, 0)
    assert.equal(f.writes.length, 0, 'obsolete task does not complete a pending intent after lifecycle change')
  })
}

test('F03 Jev gate returning after reset starts no inline research', async () => {
  const f = researchFixture(), started = deferred(), response = deferred<any>(); let modelCalls = 0
  f.svc.ctx.http.post = async () => { started.resolve(); return response.promise }
  f.svc.researchNarrator.customSideTask = async () => { modelCalls++; return {} }
  const run = jevGatePassiveResearch(f.svc, f.current, '查询地点资料', new Date()); await started.promise
  proto.invalidateStoryTasks.call(f.svc, 's'); response.resolve({ nouls: { needs_lookup: { noul: 0.95 } } }); await run
  assert.equal(modelCalls, 0); assert.equal(f.svc.researchDesks.size, 0)
})

for (const mode of ['pause', 'reset'] as const) {
  test(`F02 receipt queued for serial ${mode} checks content generation after acquiring the lock`, async () => {
    const f = groupFixture(), waiting = deferred(), lock = deferred(); let calls = 0
    f.svc.serial = async (_: string, fn: () => unknown) => {
      if (++calls === 4) { waiting.resolve(); await lock.promise }
      return fn()
    }
    const run = f.run(); await waiting.promise
    if (mode === 'reset') proto.invalidateStoryTasks.call(f.svc, 's')
    else await f.svc.setDesktopRuntimePhase('paused')
    lock.resolve(); await run
    assert.deepEqual(f.errors, []); assert.equal(f.entries.length, mode === 'reset' ? 0 : 1)
  })
}

test('F02 queued group coverage cannot restore a watermark after reset', async () => {
  const svc = lifecycleHost(), waiting = deferred(), lock = deferred(); let writes = 0
  svc.serial = async (_: string, fn: () => unknown) => { waiting.resolve(); await lock.promise; return fn() }
  svc.dbGet = async () => [{ id: 100 }]
  svc.commitGroupBackgroundCoverage = async () => { writes++ }
  const run = svc.advanceGroupBackgroundWatermarkForTurn('s', '100', new Date(), 50)
  await waiting.promise; proto.invalidateStoryTasks.call(svc, 's'); lock.resolve(); await run
  assert.equal(writes, 0)
})

for (const operation of ['story', 'database', 'range'] as const) {
  test(`F03 actual ${operation} purge entry point invalidates the desk and queued work`, async () => {
    const f = researchFixture()
    Object.assign(f.svc, {
      invalidateBufferedNarratives: noop, invalidateHistoryVectors: noop, purgeTable: async () => {},
      activeLongArcGuidanceCache: new Map(), longHorizonLastScore: new Map(), longHorizonGuidanceLoaded: new Set(), longHorizonGenerationCooldownUntil: new Map(),
      getStory: async () => f.current, initialStorySetting: () => f.current.setting,
      resetParticipantCanon: async () => {}, ensureContinuity: async () => {},
      dbGet: async () => [], dbRemove: async () => {}, endpointRows: [], endpointStates: new Map(), storyAliasRows: [], storyAliasProblems: new Set(),
    })
    f.svc.researchDeskFor('s'); f.svc.researchDueIntents.push(f.pending)
    if (operation === 'story') await f.svc.purgeAllStoryData('s')
    else if (operation === 'database') await f.svc.clearDatabase()
    else await f.svc.purgeStoryRange('s', new Date(0), new Date())
    assert.equal(f.svc.researchDesks.has('s'), false)
    assert.equal((f.svc.researchDueIntents ?? []).length, 0)
  })
}

test('F03 inline Jev distillation in flight retires after reset', async () => {
  const f = researchFixture(), started = deferred(), model = deferred<any>()
  f.svc.ctx.http.post = async () => ({ nouls: { needs_lookup: { noul: 0.95 } } })
  f.svc.researchNarrator.customSideTask = async () => { started.resolve(); return model.promise }
  const run = jevGatePassiveResearch(f.svc, f.current, '查询地点资料', new Date()); await started.promise
  const oldDesk: ResearchDesk = f.svc.researchDesks.get('s')
  proto.invalidateStoryTasks.call(f.svc, 's')
  model.resolve({ facts: [{ text: '旧地点资料', sourceUrl: 'https://example.test', confidence: 1, hard: true, volatile: false }], insufficient: false, reason: '' }); await run
  assert.equal(oldDesk.size, 0); assert.equal(f.svc.researchDesks.size, 0)
})


test('F02 OneBot port forwards the original turn cancellation into transport controls', async () => {
  let retired = false
  let control: any
  const port = new OneBotAdapter({ sendGroupMessage: async (...args: any[]) => {
    control = args[7]
    return { complete: false, deliveredSegments: [], segmentOutcomes: [] }
  } } as any)
  await port.sendGroupMessage(story(), 'group:100', '消息', undefined, undefined, () => retired)
  assert.equal(control.shouldCancel(), false)
  retired = true
  assert.equal(control.shouldCancel(), true)
})

for (const mode of ['pause', 'unknown-transport'] as const) {
  test(`F02 immediate group ledger keeps ${mode} segments pending and records known delivery`, async () => {
    const f = groupFixture(), statuses: string[] = []
    const content = '第一段<sep/>第二段'
    f.svc.persistDecision = async () => ({ messages: [], scriptEntry: { id: 9 }, commit: { events: [{
      kind: 'group-message', commitId: 'c', eventId: 'e', participantId: 'group:100', content,
      bubbles: content.split('<sep/>'), deliveryMode: 'immediate', causedByEventIds: [], metadata: {},
    }] } })
    f.svc.updateScriptDeliveryOutcome = async (_: string, _ref: any, status: string) => statuses.push(status)
    f.svc.ctx.bots[0].sendMessage = async (_: string, text: string) => {
      f.sent.push(text)
      if (f.sent.length === 1) {
        if (mode === 'pause') await f.svc.setDesktopRuntimePhase('paused')
        else throw Object.assign(new Error('platform acceptance unknown'), { transportTimeout: true })
      }
      return ['receipt']
    }
    await f.run()
    assert.deepEqual(f.errors.filter((entry: any) => entry[0] === 'error'), [])
    assert.deepEqual(statuses, mode === 'pause' ? ['delivered', 'pending'] : ['pending', 'delivered'])
    assert.equal(f.entries.length, 1)
    assert.deepEqual(f.entries[0].metadata.deliverySegmentIndexes, mode === 'pause' ? [0] : [1])
  })
}
