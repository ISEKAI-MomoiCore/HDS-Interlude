import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenAICompatibleNarrator } from '../src/narrator'
import { desktopTimelineEntryView, normalizeTimelinePlan, timelineEntryPromptProjection } from '../src/service'
import { emptyStorySetting, emptyStoryState, InterludeStory, ScriptEntry, TimelinePlanRequest } from '../src/types'

const now = new Date('2026-08-31T08:37:00.000Z')

test('timeline director accepts only bounded relative beats and discards malformed output', () => {
  const plan = normalizeTimelinePlan({
    beats: [
      { at: 0.7, kind: 'thought', summary: '短暂想到中午的约定' },
      { at: 0, kind: 'activity', summary: '继续完成随堂练习' },
      { at: 2, kind: 'state', summary: '窗口结束时仍在课堂' },
      { at: '不可解析', kind: 'teleport', summary: '无效节点' },
    ],
    carry: ['午间验收仍未发生'],
  })
  // at=2 越界后被收敛到 1；at 不可解析的节点被丢弃（teleport 现在会归一为 activity，
  // 因此该用例改用不可解析的 at 来验证真正的丢弃行为）。
  assert.deepEqual(plan?.beats.map(beat => beat.at), [0, 0.7, 1])
  assert.equal(plan?.carry?.[0], '午间验收仍未发生')
  assert.equal(normalizeTimelinePlan({ beats: [] }), undefined)
})

test('automatic script entries project to their host timeline ledger on later turns', () => {
  const entry: ScriptEntry = {
    id: 1, storyId: 'story', participantId: '', kind: 'script', actor: 'narrator',
    content: '八点十六分到八点三十七分之间，她在课堂上，随后却被错误写到了中午。',
    occurredAt: now, createdAt: now,
    metadata: { timelinePlan: { beats: [{ at: 0, kind: 'activity', summary: '完成课堂练习' }, { at: 1, kind: 'state', summary: '仍在课堂' }] } },
  }
  const projected = timelineEntryPromptProjection(entry)
  assert.notEqual(projected.content, entry.content)
  assert.match(projected.content, /Host timeline ledger/)
  assert.doesNotMatch(projected.content, /中午/)
})

test('desktop Arrangement uses an explicit automatic window and leaves legacy prose as a point event', () => {
  const automatic: ScriptEntry = {
    id: 2, storyId: 'story', participantId: '', kind: 'script', actor: 'narrator', content: '她在课堂上完成练习。',
    occurredAt: now, createdAt: now,
    metadata: { timelineWindow: { from: '2026-08-31T08:10:00.000Z', to: '2026-08-31T08:37:00.000Z' } },
  }
  const ranged = desktopTimelineEntryView(automatic)
  assert.equal(ranged.track, 'script')
  assert.equal(ranged.startedAt, '2026-08-31T08:10:00.000Z')
  assert.equal(ranged.endedAt, '2026-08-31T08:37:00.000Z')
  const legacy = desktopTimelineEntryView({ ...automatic, id: 3, metadata: {} })
  assert.equal(legacy.startedAt, now.toISOString())
  assert.equal(legacy.endedAt, undefined)
})

test('timeline director reuses the compaction route and requests a small JSON ledger', async () => {
  const calls: any[] = []
  const ctx = { http: { post: async (_url: string, body: any) => {
    calls.push(body)
    return { choices: [{ message: { content: '{"beats":[{"at":0,"kind":"activity","summary":"继续课堂练习"}]}' } }] }
  } } }
  const narrator = new OpenAICompatibleNarrator(ctx as any, {
    providers: [{ label: 'Compact', enabled: true, endpoint: 'https://example.test/chat', model: 'compact-model', temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 10_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForCompaction: true }],
    compaction: { enabled: true, providerId: '', model: '', temperature: 0.3, topP: 1, maxTokens: 2048, timeout: 10_000, responseFormat: 'json-object', fixedPrompt: '', stylePrompt: '' },
    failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 },
  } as any, true)
  const story: InterludeStory = { id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now }
  const fullContinuation = `${'前文'.repeat(500)}最后她仍把手停在未写完的那一行。`
  const request: TimelinePlanRequest = {
    story, participant: null, phase: 'advance', from: new Date(now.getTime() - 20 * 60_000), now, scene: null, facts: [], recentEntries: [],
    recentScriptContinuation: {
      content: fullContinuation,
      occurredAt: now,
      hostTimelineLedger: '[Host timeline ledger for this completed automatic window: 0% activity: 整理讲义。]',
    },
    dueIntents: [], schedulePreplan: null,
  }
  const plan = await narrator.planTimeline(request)
  assert.equal(plan?.beats[0]?.summary, '继续课堂练习')
  assert.equal(calls[0].temperature, 0.3)
  // 思考型网关把 reasoning 计入输出：预算必须留出思考余量，避免 JSON 截断。
  assert.equal(calls[0].max_tokens, 4096)
  assert.equal(calls[0].response_format.type, 'json_object')
  const systemPrompt = calls[0].messages[0].content
  // 两条设计原则：不做笃定的未来预测；用户消息的影响由主模型判断。
  assert.match(systemPrompt, /never deterministic predictions/)
  assert.match(systemPrompt, /NOT yours to decide/)
  const payload = JSON.parse(calls[0].messages[1].content)
  // 载荷瘦身：剧本续写只保留末段结构信号，不再发送全文。
  assert.ok(payload.recentScriptContinuation.content.length <= 600)
  assert.match(payload.recentScriptContinuation.content, /最后她仍把手停在未写完的那一行。$/)
  assert.match(payload.recentScriptContinuation.hostTimelineLedger, /Host timeline ledger/)
})

test('timeline director accepts JSON from a later gateway response field', async () => {
  const ctx = { http: { post: async () => ({
    choices: [{ message: {
      content: '模型的简短思考不属于事件账本。',
      reasoning_content: '{"beats":[{"at":"50%","kind":"scene","summary":"继续整理讲义"}]}',
    } }],
  }) } }
  const narrator = new OpenAICompatibleNarrator(ctx as any, {
    providers: [{ label: 'Compact', enabled: true, endpoint: 'https://example.test/chat', model: 'compact-model', temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 10_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForCompaction: true }],
    compaction: { enabled: true, providerId: '', model: '', temperature: 0.3, topP: 1, maxTokens: 2048, timeout: 10_000, responseFormat: 'json-object', fixedPrompt: '', stylePrompt: '' },
    failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 },
  } as any, true)
  const story: InterludeStory = { id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now }
  const request: TimelinePlanRequest = { story, participant: null, phase: 'advance', from: new Date(now.getTime() - 20 * 60_000), now, scene: null, facts: [], recentEntries: [], dueIntents: [], schedulePreplan: null }
  const plan = await narrator.planTimeline(request)
  assert.equal(plan?.beats[0]?.at, '50%')
  assert.equal(plan?.beats[0]?.kind, 'scene')
})

test('side tasks drop max_tokens and retry once when thinking budget truncates the JSON', async () => {
  const calls: any[] = []
  let call = 0
  const ctx = { http: { post: async (_url: string, body: any) => {
    calls.push(body)
    call++
    // 第一次：思考型网关把 500 cap 吃光，正文只剩残句（真实故障形态）。
    if (call === 1) return { choices: [{ message: { content: '{"description":"深夜赶工的疲惫里带着一点被' } }] }
    return { choices: [{ message: { content: '{"description":"深夜赶工的疲惫里带着一点被认可的踏实。"}' } }] }
  } } }
  const narrator = new OpenAICompatibleNarrator(ctx as any, {
    providers: [{ label: 'P', enabled: true, endpoint: 'https://example.test/chat', model: 'm', temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 10_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForAlter: true }],
    failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 },
  } as any, true)
  const decision = await narrator.analyzeAlter({ entries: [] } as any, { enabled: true, maxTokens: 500, timeout: 10_000 } as any)
  assert.equal(decision.description, '深夜赶工的疲惫里带着一点被认可的踏实。')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].max_tokens, 500, '首次尝试带 cap')
  assert.equal(calls[1].max_tokens, undefined, '重试去掉 cap 给思考留预算')
})

test('Alter usage stays aggregated across the uncapped retry instead of fragmenting', async () => {
  let call = 0
  const ctx = { http: { post: async () => {
    call++
    return call === 1
      ? { choices: [{ message: { content: '{"description":"截断' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }
      : { choices: [{ message: { content: '{"description":"完整的心情描述。"}' } }], usage: { prompt_tokens: 10, completion_tokens: 7 } }
  } } }
  const usages: any[] = []
  const narrator = new OpenAICompatibleNarrator(ctx as any, {
    providers: [{ label: 'P', enabled: true, endpoint: 'https://example.test/chat', model: 'm', temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 10_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForAlter: true }],
    failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 },
  } as any, true, (record: any) => usages.push(record))
  await narrator.analyzeAlter({ entries: [] } as any, { enabled: true, maxTokens: 400, timeout: 10_000 } as any)
  assert.equal(usages.length, 1, '多次尝试聚合成一条用量输出')
  assert.equal(usages[0].task, 'Alter 分析')
  assert.equal(usages[0].outputTokens, 12, '两次尝试的输出 token 合并计数')
})

test('protocol 4 desktop projection carries commit identity, delivery ledger truth and scene checkpoints', () => {
  const now = new Date('2026-09-05T04:00:00.000Z')
  const committed: ScriptEntry = {
    id: 10, storyId: 'story', participantId: 'p1', kind: 'script', actor: 'narrator', content: '她写完作业。',
    occurredAt: now, createdAt: now,
    metadata: {
      commitId: 'commit-1',
      deliveryActions: [{
        commitId: 'commit-1', eventId: 'evt-1', eventKind: 'outgoing-message', participantId: 'p1',
        status: 'partial', updatedAt: now.toISOString(),
        segments: [
          { kind: 'message', content: '第一句', status: 'delivered' },
          { kind: 'message', content: '第二句', status: 'failed' },
        ],
      }],
    },
  }
  const view = desktopTimelineEntryView(committed)
  assert.equal(view.commitId, 'commit-1')
  const actions = (view as any).deliveryActions
  assert.equal(actions.length, 1)
  assert.equal(actions[0].eventId, 'evt-1')
  assert.equal(actions[0].status, 'partial')
  assert.deepEqual(actions[0].segments.map((s: any) => s.status), ['delivered', 'failed'])

  const checkpoint: ScriptEntry = {
    id: 11, storyId: 'story', participantId: '', kind: 'script', actor: 'narrator', content: '场景收束。',
    occurredAt: now, createdAt: now,
    metadata: { sceneCheckpoint: { sceneId: 3, startedAt: '2026-09-05T03:00:00.000Z', endedAt: '2026-09-05T04:00:00.000Z',
      reason: 'sleep', firstEntryId: 8, lastEntryId: 11, boundarySourceEntryIds: [9, 11] } },
  }
  const checkpointView = desktopTimelineEntryView(checkpoint) as any
  assert.equal(checkpointView.sceneCheckpoint.sceneId, 3)
  assert.equal(checkpointView.sceneCheckpoint.reason, 'sleep')
  assert.deepEqual(checkpointView.sceneCheckpoint.boundarySourceEntryIds, [9, 11])

  // 旧条目：无 metadata 时不产生任何 protocol 4 字段，桌面照常按 point 事件渲染。
  const legacy = desktopTimelineEntryView({ ...committed, id: 12, metadata: {} })
  assert.equal((legacy as any).commitId, undefined)
  assert.equal((legacy as any).deliveryActions, undefined)
  assert.equal((legacy as any).sceneCheckpoint, undefined)

  // 损坏的 checkpoint/账本不抛错，只省略字段。
  const broken = desktopTimelineEntryView({ ...committed, id: 13, metadata: { commitId: 'c2', sceneCheckpoint: { sceneId: 'x' }, deliveryActions: 'not-an-array' } })
  assert.equal((broken as any).commitId, 'c2')
  assert.equal((broken as any).deliveryActions, undefined)
  assert.equal((broken as any).sceneCheckpoint, undefined)
})

test('protocol 4 projection survives hostile metadata shapes without throwing', () => {
  const base: ScriptEntry = {
    id: 20, storyId: 'story', participantId: '', kind: 'script', actor: 'narrator', content: 'x',
    occurredAt: new Date('2026-09-05T04:00:00.000Z'), createdAt: new Date('2026-09-05T04:00:00.000Z'),
  }
  const hostile: Array<Record<string, unknown>> = [
    { deliveryActions: [null, undefined, 42, 'junk', { eventId: 5 }, { eventId: 'e', segments: 'nope' }, { eventId: 'e2', segments: [null, 7, { content: 1 }] }] },
    { sceneCheckpoint: null, deliveryActions: [] },
    { sceneCheckpoint: { sceneId: NaN, startedAt: 'not-a-date' } },
    { sceneCheckpoint: { sceneId: 1.5, startedAt: '2026-09-05T04:00:00.000Z', boundarySourceEntryIds: 'nope' } },
    { commitId: 42, deliveryActions: {} as any },
    { deliveryActions: Array.from({ length: 50 }, (_, i) => ({ eventId: 'e' + i, segments: [{ content: 'x', status: 'pending' }] })) },
  ]
  for (const metadata of hostile) {
    const view = desktopTimelineEntryView({ ...base, metadata: metadata as any })
    assert.equal(typeof view.entityId, 'string', '投影必须始终返回合法结构')
  }
  // 超长账本也被截到可用体积（每行动 segments 都保留但 eventId 全部是字符串）
  const stress = desktopTimelineEntryView({ ...base, metadata: hostile[5] as any }) as any
  assert.equal(stress.deliveryActions.length, 50)
})
