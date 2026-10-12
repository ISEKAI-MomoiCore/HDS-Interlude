import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { InterludeService } from '../src/service'
import { SharedWorks, type WorkRow, type WorkStore } from '../src/works'
import { createScheduler } from '../src/scheduler'
import { buildEpisodeIndex, type EpisodeSource } from '../src/script/episode-index'

const proto = InterludeService.prototype as any
const settle = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
function runtimeHost(extra: Record<string, any> = {}) {
  return Object.assign(Object.create(proto), {
    queues: new Map(), serialScope: new AsyncLocalStorage(), runtimeGeneration: 0,
    storyTaskGenerations: new Map(), databaseResetting: false, desktopRuntimePhase: 'running',
    report: () => {}, reportOperation: () => {}, reportStandaloneOperation: () => {},
    interruptedTypingParticipants: new Set<string>(),
    expiredImageSources: new Map(), disposed: false,
  }, extra)
}

for (const count of [0, 8, 9, 30, 32]) {
  test(`C06 works keeps the new persisted job after pruning ${count} terminal jobs`, async () => {
    const rows = new Map<string, WorkRow>()
    const store: WorkStore = {
      get: async id => structuredClone(rows.get(id)),
      create: async row => { rows.set(row.id, structuredClone(row)) },
      replace: async (row, generation) => {
        if (rows.get(row.id)?.generation !== generation) return false
        rows.set(row.id, structuredClone(row)); return true
      },
    }
    const works = new SharedWorks(store)
    const row = await works.create('s', 'p', '共同作品', '原稿')
    rows.get(row.id)!.state.jobs = Array.from({ length: count }, (_, i) => ({
      id: `old-${i}`, operationKey: `old-${i}`, sourceEntryId: i, modelId: 'writer', status: 'completed',
      baseRevisionId: row.state.head, brief: '旧任务', createdAt: new Date().toISOString(),
    }))
    const result = deferred<string>()
    let calls = 0
    const job = await works.generate('s', 'p', { baseRevisionId: row.state.head, brief: '改写' }, 'new', 99, 'writer', async () => { calls++; return result.promise })
    assert.equal(rows.get(row.id)!.state.jobs!.length, Math.min(count, 8) + 1)
    assert.equal(rows.get(row.id)!.state.jobs!.at(-1)!.id, job.id)
    const repeated = await works.generate('s', 'p', { baseRevisionId: row.state.head, brief: '改写' }, 'new', 99, 'writer', async () => { throw Error('must not run') })
    assert.equal(repeated.id, job.id)
    await assert.rejects(works.generate('s', 'p', { baseRevisionId: row.state.head, brief: '第二个' }, 'another', 100, 'writer', async () => 'other'), /已有作品任务/)
    result.resolve('新稿'); await settle(); await settle()
    const persisted = rows.get(row.id)!
    assert.equal(persisted.state.jobs!.at(-1)!.status, 'completed')
    assert.equal(persisted.state.proposals.length, 1)
    assert.equal(persisted.state.proposals[0].content, '新稿')
    assert.equal(calls, 1)
  })
}

for (const replacement of ['cancel', 'new-wake'] as const) {
  for (const outcome of ['busy', undefined, 'throw'] as const) {
    test(`C09 stale ${String(outcome)} fire cannot override ${replacement}`, async () => {
      const timers: Array<{ fire: () => void; cancelled: boolean }> = []
      const errors: unknown[] = []
      const scheduler = createScheduler({ now: () => 1000, retryDelayMs: 100, deferDelayMs: 100,
        setTimeout: fire => { const t = { fire, cancelled: false }; timers.push(t); return () => { t.cancelled = true } },
        onWakeError: error => errors.push(error), onTaskError: () => {},
      })
      const gate = deferred<'busy' | void>()
      scheduler.scheduleWake('s', new Date(1000), async () => { await gate.promise; if (outcome === 'throw') throw Error('old'); return outcome })
      timers[0].fire(); await settle()
      let newCalls = 0
      if (replacement === 'cancel') scheduler.cancelWakes('s')
      else scheduler.scheduleWake('s', new Date(5000), () => { newCalls++ })
      gate.resolve(outcome === 'busy' ? 'busy' : undefined); await settle()
      assert.equal(timers.length, replacement === 'cancel' ? 1 : 2)
      assert.equal(scheduler.pendingWakeCount(), replacement === 'cancel' ? 0 : 1)
      if (replacement === 'new-wake') { timers[1].fire(); await settle(); assert.equal(newCalls, 1); assert.equal(scheduler.pendingWakeCount(), 0) }
      assert.equal(errors.length, outcome === 'throw' ? 1 : 0)
    })
  }
}

for (const max of [1, 2, 4]) {
  test(`C13 browser FIFO handoff never exceeds ${max} slots, including a thrown task`, async () => {
    const host = runtimeHost({ browserActive: 0, browserWaiters: [] })
    Object.defineProperty(host, 'browserConfig', { value: { maxConcurrentPages: max } })
    const releases = Array.from({ length: 12 }, () => deferred())
    const started: number[] = []
    let active = 0, peak = 0
    const jobs = releases.map((gate, i) => host.withBrowserSlot(async () => {
      started.push(i); active++; peak = Math.max(peak, active)
      try { await gate.promise; if (i === 0) throw Error('page failed'); return i } finally { active-- }
    }).catch((error: Error) => error.message))
    // Insert a newcomer exactly while the first slot is handed to its waiter.
    releases[0].resolve(); await Promise.resolve()
    const newcomer = host.withBrowserSlot(async () => { active++; peak = Math.max(peak, active); active--; return 12 })
    for (const gate of releases) { gate.resolve(); await settle() }
    const values = await Promise.all(jobs)
    assert.equal(values[0], 'page failed')
    assert.equal(await newcomer, 12)
    assert.deepEqual(started, releases.map((_, i) => i))
    assert.ok(peak <= max)
    assert.equal(host.browserActive, 0)
    assert.equal(host.browserWaiters.length, 0)
  })
}

function incomingHost() {
  const story = { id: 's', status: 'active', selfId: 'bot' }
  const rows: any[] = [], buffered: string[] = []
  const host = runtimeHost({ config: { runtime: { autoCreate: false, cancelDelayedRepliesOnUserMessage: true }, model: {} },
    seenIncomingMessages: new Map(), inboundSeq: 0,
    canHandleSession: () => true, findStory: async () => story, getStory: async () => story,
    findParticipant: async (session: any) => ({ id: `${session.selfId}-${session.userId}`, status: 'active', userId: session.userId }),
    ensureParticipant: async (_s: any, _session: any, _now: any, p: any) => p,
    getParticipant: async (id: string) => ({ id, status: 'active' }),
    describeVisionEvent: (session: any) => ({ content: session.content, sources: [] }),
    signalIncomingInterruption: () => {}, readForward: async () => undefined,
    describeUserEvent: (_s: any, session: any) => ({ content: session.content, sources: [], audioSources: [] }),
    channelMetadataFor: async () => undefined, touchEndpointStateInbound: async () => {}, resolveInboundEndpointFor: async () => undefined,
    recordIncomingMessage: async (p: any) => p, cancelPendingOutgoingMessages: async () => [],
    pauseAutomaticAdvanceAfterUserMessage: async () => {},
    dbGet: async (_table: string, q: any) => rows.filter(row => row.participantId === q.participantId && row.metadata.platform === q['metadata.platform'] && row.metadata.messageId === q['metadata.messageId'] && (!row.metadata.selfId || row.metadata.selfId === q.$or[0]['metadata.selfId'])),
    appendEntry: async (_s: any, entry: any, _now: any, participantId: string) => { rows.push({ ...entry, participantId }) },
    bufferUserNarrative: (_s: any, p: any) => buffered.push(p.id), turnEngine: { recordSource: () => {} },
  })
  const session = (patch: any = {}) => ({ platform: 'onebot', selfId: 'bot', userId: 'alice', messageId: 'm1', content: '你好', elements: [], ...patch })
  return { host, rows, buffered, session }
}
for (const failAt of ['readForward', 'appendEntry']) {
  test(`C07 ${failAt} failure leaves replay eligible, then records once`, async () => {
    const f = incomingHost(), original = f.host[failAt]
    f.host[failAt] = async () => { throw Error('temporary') }
    await assert.rejects(f.host.receive(f.session()), /temporary/)
    assert.equal(f.host.seenIncomingMessages.size, 0)
    f.host[failAt] = original
    assert.equal(await f.host.receive(f.session()), true)
    assert.equal(await f.host.receive(f.session()), true)
    assert.equal(f.rows.length, 1); assert.equal(f.buffered.length, 1)
  })
}
test('C07 concurrent duplicates, durable restart and distinct bot accounts keep correct ownership', async () => {
  const f = incomingHost()
  await Promise.all([f.host.receive(f.session()), f.host.receive(f.session())])
  assert.equal(f.rows.length, 1); assert.equal(f.buffered.length, 1)
  f.host.seenIncomingMessages.clear()
  await f.host.receive(f.session())
  assert.equal(f.rows.length, 1)
  await f.host.receive(f.session({ selfId: 'bot-2' }))
  assert.equal(f.rows.length, 2)
  assert.deepEqual(f.buffered, ['bot-alice', 'bot-2-alice'])
})
test('C07 post-commit pause failure cannot lose narrative input and no-ID events remain distinct', async () => {
  const f = incomingHost()
  f.host.pauseAutomaticAdvanceAfterUserMessage = async () => { throw Error('auxiliary write failed') }
  await f.host.receive(f.session())
  assert.equal(f.rows.length, 1); assert.equal(f.buffered.length, 1)
  await f.host.receive(f.session({ messageId: undefined }))
  await f.host.receive(f.session({ messageId: undefined }))
  assert.equal(f.rows.length, 3); assert.equal(f.buffered.length, 3)
})

for (const outcome of ['ok', 'empty', 'error']) {
  test(`P01 historical image ${outcome} deduplicates sources and preserves full failure traversal`, async () => {
    const calls: string[] = []
    const host = runtimeHost({ config: { model: { vision: { enabled: true } } }, fetchNativeImage: async (url: string) => {
      calls.push(url); if (outcome === 'error') throw Error('bad request'); return outcome === 'empty' ? undefined : { dataUrl: 'data:image/png;base64,a' }
    } })
    const refs = Array.from({ length: 60 }, (_, i) => ({ source: `https://local.invalid/${Math.floor(i / 2)}`, sourceEntryId: i, occurredAt: new Date(), senderId: 'alice' }))
    const images = await host.loadHistoricalGroupImages({ id: 's' }, refs, 3, undefined, ['https://local.invalid/0'])
    assert.equal(images.length, outcome === 'ok' ? 3 : 0)
    assert.equal(calls.length, outcome === 'ok' ? 3 : 29)
    assert.equal(new Set(calls).size, calls.length)
    assert.ok(!calls.includes('https://local.invalid/0'))
  })
}
test('P01 bounded concurrency preserves source order even when later images finish first', async () => {
  const first = deferred<any>(), second = deferred<any>(), third = deferred<any>()
  const gates = [first, second, third]
  let active = 0, peak = 0, calls = 0
  const host = runtimeHost({ config: { model: { vision: { enabled: true } } }, fetchNativeImage: async () => {
    const gate = gates[calls++]; peak = Math.max(peak, ++active)
    try { return await gate.promise } finally { active-- }
  } })
  const refs = [1, 2, 3, 4].map(id => ({ source: `https://local.invalid/${id}`, sourceEntryId: id, occurredAt: new Date() }))
  const run = host.loadHistoricalGroupImages({ id: 's' }, refs, 1)
  await settle()
  assert.equal(peak, 3)
  third.resolve({ dataUrl: 'third' }); second.resolve({ dataUrl: 'second' })
  first.resolve({ dataUrl: 'first' })
  const images = await run
  assert.deepEqual(images.map((image: any) => image.sourceEntryId), [1])
  assert.equal(calls, 3); assert.equal(active, 0)
})
test('P01 valid tail images after many failed sources remain reachable without a hidden deadline', async () => {
  let calls = 0, active = 0, peak = 0
  const host = runtimeHost({ config: { model: { vision: { enabled: true } } }, fetchNativeImage: async (url: string) => {
    peak = Math.max(peak, ++active); calls++
    try { await settle(); return url.endsWith('/10') ? { dataUrl: 'tail' } : undefined } finally { active-- }
  } })
  const refs = Array.from({ length: 10 }, (_, index) => ({ source: `https://local.invalid/${index + 1}`, sourceEntryId: index + 1, occurredAt: new Date() }))
  const images = await host.loadHistoricalGroupImages({ id: 's' }, refs, 1)
  assert.deepEqual(images.map((image: any) => image.sourceEntryId), [10])
  assert.equal(calls, 10); assert.equal(peak, 3); assert.equal(active, 0)
})

test('expired QQ CDN sources are skipped without network or warn spam', async () => {
  const calls: string[] = []
  const host = runtimeHost({
    config: { model: { vision: { enabled: true } } },
    expiredImageSources: new Map([['https://local.invalid/dead', true]]),
    fetchNativeImage: async (url: string) => { calls.push(url); return { dataUrl: 'data:image/png;base64,a' } },
  })
  const refs = [
    { source: 'https://local.invalid/dead', sourceEntryId: 1, occurredAt: new Date(), senderId: 'alice' },
    { source: 'https://local.invalid/alive', sourceEntryId: 2, occurredAt: new Date(), senderId: 'alice' },
  ]
  const images = await host.loadHistoricalGroupImages({ id: 's' }, refs, 6)
  assert.deepEqual(calls, ['https://local.invalid/alive'])
  assert.deepEqual(images.map((image: any) => image.sourceEntryId), [2])
})

test('disposed-context errors abort narrative retries without provider cooldown or scheduled retry', async () => {
  const host = runtimeHost({
    disposed: true,
    config: { runtime: { narrativeRetryDelaySeconds: 60, narrativeRetryMaxAttempts: 6 } },
    reportStandalone: () => { throw Error('must not log after dispose') },
    dbGet: async () => { throw Error('db must not be touched after dispose') },
  })
  const scheduled = await host.scheduleNarrativeRetry('s', 'p', new Date())
  assert.equal(scheduled, false)
})

test('isContextDisposedError matches both cordis shutdown signatures', async () => {
  const { isContextDisposedError } = await import('../src/narrator')
  assert.equal(isContextDisposedError(new Error('context disposed')), true)
  assert.equal(isContextDisposedError(new Error('cannot create effect on inactive context')), true)
  assert.equal(isContextDisposedError(new Error('HTTP 503 Service Unavailable')), false)
  assert.equal(isContextDisposedError(undefined), false)
})

test('P02 recovery pages only scripts, scans old candidates and loads split owners once', async () => {
  const scripts = Array.from({ length: 600 }, (_, i) => ({ id: i + 1, storyId: 's', kind: 'script' }))
  const queries: any[] = [], attempts: number[] = []
  const host = runtimeHost({ pendingDeliveryRecoveryRunning: false, pendingDeliveryRecoveryBackoff: new Map(), ensureEndpointRegistry: async () => {},
    getStory: async () => ({ id: 's', status: 'active' }),
    dbGet: async (table: string, q: any, options: any) => {
      queries.push({ table, q, options })
      if (table === 'interlude_intent') return []
      assert.equal(q.kind, 'script'); assert.equal(options.limit, 256)
      return scripts.filter(row => row.id > q.id.$gt).slice(0, options.limit)
    },
    pendingOutgoingDeliveryCandidates: (row: any) => [1, 599].includes(row.id) ? [{ scriptEntryId: row.id, commitId: 'c', eventId: 'e', segmentIndex: 0, event: { occurredAt: new Date() } }] : [],
    recoverPendingDeliveryCandidate: async (_s: any, candidate: any) => { attempts.push(candidate.scriptEntryId); return 'delivered' },
  })
  await host.recoverPendingDeliveries(true, 's')
  assert.deepEqual(attempts, [1, 599])
  assert.equal(queries.filter(q => q.table === 'interlude_intent').length, 1)
  assert.deepEqual(queries.filter(q => q.table === 'interlude_script_entry').map(q => q.q.id.$gt), [0, 256, 512, 600])
  assert.equal(host.pendingDeliveryRecoveryRunning, false)
})

function slowEpisode(rows: Array<[number, EpisodeSource]>) {
  const checkpoints = rows.map(([, row]) => row.checkpoint).filter((x): x is NonNullable<EpisodeSource['checkpoint']> => !!x && Number.isSafeInteger(x.firstEntryId) && Number.isSafeInteger(x.lastEntryId))
  const groups = new Map<string, number[]>()
  for (const [id, row] of rows) {
    const checkpoint = checkpoints.find(x => id >= x.firstEntryId && id <= x.lastEntryId)
    const key = JSON.stringify([row.participantId, checkpoint ? `scene:${checkpoint.sceneId}` : row.frameId || `entry:${id}`])
    const ids = groups.get(key) ?? []; ids.push(id); groups.set(key, ids)
  }
  return new Map([...groups.values()].flatMap(ids => ids.map(id => [id, ids] as const)))
}
for (const overlap of [false, true]) {
  test(`P03 episode index preserves first-match semantics with ${overlap ? 'overlapping' : 'disjoint'} unsorted checkpoints`, () => {
    const rows: Array<[number, EpisodeSource]> = Array.from({ length: 45 }, (_, i) => [i + 1, { content: '记录', occurredAt: '', participantId: i % 2 ? 'a' : 'b', kind: 'script' }])
    rows[39][1].checkpoint = { sceneId: 2, firstEntryId: overlap ? 10 : 21, lastEntryId: 40 }
    rows[44][1].checkpoint = { sceneId: 1, firstEntryId: 1, lastEntryId: 20 }
    rows[42][1].checkpoint = { sceneId: 9, firstEntryId: 99, lastEntryId: 98 }
    assert.deepEqual(buildEpisodeIndex(rows), slowEpisode(rows))
  })
}
test('P03 audience navigation survives changing excludes without rebuild or visibility leakage', async () => {
  const rows = new Map<number, any>([1, 2, 3, 4].map(id => [id, { content: `奶茶取餐码 ${id}`, occurredAt: new Date(id * 1000).toISOString(), participantId: id === 4 ? 'bob' : 'alice', kind: 'user-message', frameId: 'same' }]))
  const host = runtimeHost({ historyVectors: new Map([['s', rows]]), episodeIndexes: new Map(), automaticRecallCache: new Map(), ensureHistoryVectors: async () => {} })
  Object.defineProperty(host, 'sharedStoryConfig', { value: { shareParticipantDetails: false } })
  const first = await host.recallHistory('s', 'alice', '奶茶取餐码', [], new Set([2]))
  const index = [...host.episodeIndexes.values()][0]
  assert.ok(!first.flatMap((x: any) => x.sourceEntryIds).includes(2))
  const second = await host.recallHistory('s', 'alice', '奶茶取餐码', [], new Set())
  assert.equal([...host.episodeIndexes.values()][0], index)
  assert.deepEqual(second[0].sourceEntryIds, [1, 2, 3])
  assert.ok(!second[0].sourceEntryIds.includes(4))
})

test('C14 assigned embedding route schedules backfill without legacy model and only updates matching facts', async () => {
  const now = new Date(), queries: any[] = []
  const host = runtimeHost({ config: { model: { embedding: { enabled: true, model: '', backfillBatchSize: 2 } } },
    modelRouting: { embedding: { available: true } }, factBackfills: new Set(),
    dbGet: async () => [{ id: 1, storyId: 's', status: 'active', content: '小林说他要出门', updatedAt: now, embedding: [] }],
    embedText: async () => [1, 2], dbSet: async (_t: string, q: any, patch: any) => queries.push({ q, patch }),
  })
  host.scheduleFactEmbeddingBackfill('s'); await settle()
  assert.equal(queries.length, 1)
  assert.deepEqual(queries[0], { q: { id: 1, storyId: 's', status: 'active', content: '小林说他要出门' }, patch: { embedding: [1, 2] } })
  assert.equal(host.factBackfills.size, 0)
})
test('C14 backfill drops an obsolete result after reset', async () => {
  const gate = deferred<number[]>(), writes: any[] = []
  const host = runtimeHost({ dbGet: async () => [{ id: 1, content: '小林说他要出门', updatedAt: new Date(), embedding: [] }],
    embedText: () => gate.promise, dbSet: async (...args: any[]) => writes.push(args),
  })
  const task = host.backfillFactEmbeddings('s', 2); await settle()
  host.runtimeGeneration++; gate.resolve([1]); await task
  assert.equal(writes.length, 0)
})

test('P04 background compaction prepares vectors outside serial and carries them into the persistence phase', async () => {
  const gate = deferred<number[]>(), started = deferred(), completed = deferred()
  const entry = { id: 1, content: '小林说他要出门', metadata: {} }
  const context: any = { phase: 'run', current: { id: 's' }, sceneEntries: [entry], sceneCompactionDue: true, compactRequest: {}, fingerprint: 'scene1' }
  const host = runtimeHost({ getStory: async () => ({ id: 's' }), hasPendingNarrative: () => false,
    prepareSchedulePreplanReview: async () => undefined, prepareCompaction: async () => context,
    compactor: { compact: async () => ({ facts: [{ scope: 'relationship', content: '小林说他要出门', sourceEntryIds: [1] }] }) },
    dbGet: async () => [], embedText: async () => { assert.equal(host.inSerial('s'), false); started.resolve(); return gate.promise },
    applyCompaction: async (_s: any, received: any) => { assert.equal(host.inSerial('s'), true); assert.deepEqual([...received.factEmbeddings.values()], [[1, 2]]); completed.resolve() },
    compactionCheckpointAdvanced: async () => true, noteCompactionFailure: () => {},
  })
  Object.defineProperty(host, 'memoryConfig', { value: { enabled: true, factContentCharacters: 1000 } })
  Object.defineProperty(host, 'schedulePreplanConfig', { value: { enabled: false } })
  let task: Promise<unknown> | undefined
  host.scheduler = { scheduleExclusive: (_k: string, work: () => Promise<unknown>) => { task = work(); return true }, clearBackoff: () => {} }
  host.scheduleCompaction('s'); await started.promise
  let inputAccepted = false
  await host.serial('s', async () => { inputAccepted = true })
  assert.equal(inputAccepted, true)
  gate.resolve([1, 2]); await completed.promise; await task
})
test('P04 normalized identical facts reuse vectors once and embedding failure remains an optional index', async () => {
  let calls = 0
  const host = runtimeHost({ dbGet: async () => [{ content: '小林说他要出门', embedding: [9] }],
    embedder: { embed: async () => { calls++; throw Error('provider unavailable') } },
  })
  Object.defineProperty(host, 'memoryConfig', { value: { factContentCharacters: 1000 } })
  const facts = ['小林说他要出门', ' 小林说他要出门 ', '小明说他准备回家'].map(content => ({ scope: 'relationship', content, sourceEntryIds: [1] }))
  const vectors = await host.prepareCompactionEmbeddings('s', { facts }, [{ id: 1 }])
  assert.deepEqual([...vectors.values()], [[9], []]); assert.equal(calls, 1)
})

test('C07 shared canonical participant accepts identical IDs from different bot accounts without replay duplication', async () => {
  const f = incomingHost()
  f.host.findParticipant = async () => ({ id: 'canonical-alice', status: 'active' })
  await f.host.receive(f.session())
  f.host.seenIncomingMessages.clear()
  await f.host.receive(f.session({ selfId: 'bot-2' }))
  await f.host.receive(f.session({ selfId: 'bot-2' }))
  assert.equal(f.rows.length, 2)
  assert.deepEqual(f.rows.map(row => row.metadata.selfId), ['bot', 'bot-2'])
})

test('C07 group insertion failure remains replayable, concurrent replay and durable replay are single-write', async () => {
  const rows: any[] = [], buffered: any[] = []
  const story = { id: 's', status: 'active', selfId: 'bot', setting: { character: { name: '角色' } } }
  const host = runtimeHost({ config: { runtime: { autoCreate: false } }, seenIncomingMessages: new Map(),
    canHandleGroupSession: () => true, groupRule: () => ({ responseMode: 'auto' }), findStory: async () => story, getStory: async () => story,
    groupSenderName: async () => '小林', readForward: async () => undefined, channelMetadataFor: async () => undefined,
    touchEndpointStateInbound: async () => {}, pauseAutomaticAdvanceAfterUserMessage: async () => {},
    bufferGroupMessage: (...args: any[]) => buffered.push(args),
    dbGet: async (_t: string, q: any) => rows.filter(row => row.metadata.messageId === q['metadata.messageId']
      && row.metadata.groupId === q['metadata.groupId'] && (!row.metadata.selfId || row.metadata.selfId === q.$or[0]['metadata.selfId'])),
    appendEntry: async (_s: string, draft: any) => { const row = { ...draft, id: rows.length + 1 }; rows.push(row); return row },
  })
  const session = (selfId = 'bot'): any => ({ platform: 'onebot', selfId, userId: '100', guildId: '123', channelId: '123', messageId: 'm1', content: '你好', elements: [] })
  const append = host.appendEntry
  host.appendEntry = async () => { throw Error('disk failure') }
  await assert.rejects(host.receiveGroup(session()), /disk failure/)
  assert.equal(host.seenIncomingMessages.size, 0)
  host.appendEntry = append
  await Promise.all([host.receiveGroup(session()), host.receiveGroup(session())])
  assert.equal(rows.length, 1); assert.equal(buffered.length, 1)
  host.seenIncomingMessages.clear()
  await host.receiveGroup(session())
  assert.equal(rows.length, 1)
  await host.receiveGroup(session('bot-2'))
  assert.equal(rows.length, 2); assert.equal(buffered.length, 2)
})
