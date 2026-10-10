import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileTransportReferences } from '../src/script/authored-actions'
import { decisionToScriptCommit } from '../src/script/commit-builder'
import { validateScriptCommit } from '../src/script/validator'
import { deliveryReality } from '../src/script/delivery-reality'
import { normalizeLifeHandoff } from '../src/script/life-handoff'
import { projectSceneFrame, advanceSceneFrame, resolveDialogueBurst } from '../src/script/scene-frame'
import { interactionEvidence, reviewedDevelopmentSupport } from '../src/script/development'
import { scriptEntryDraftForCommit } from '../src/turn-persistence'
import { InterludeService, timelineEntryPromptProjection } from '../src/service'
import { systemPrompt, toPromptPayload, OpenAICompatibleNarrator } from '../src/narrator'
import { emptyStorySetting, emptyStoryState, type ScriptEntry, type NarrativeDecision } from '../src/types'
import { decodeStoryState, encodeStoryState } from '../src/story-state'

const now = new Date('2026-09-05T12:18:00Z')
const entry = (id: number, content: string, kind = 'script', participantId = 'alice'): ScriptEntry => ({
  id, content, kind, participantId, actor: kind === 'script' ? 'narrator' : 'user', storyId: 's',
  occurredAt: now, createdAt: now, metadata: {},
})
const commit = (decision: NarrativeDecision, extra = {}) => decisionToScriptCommit({
  storyId: 's', participantId: 'alice', phase: 'conversation-follow-up', from: now, now, frameId: 'f', burstId: 'b', decision, ...extra,
})
const request = (entries: ScriptEntry[]): any => ({
  phase: 'conversation-follow-up', from: now, now,
  story: { setting: emptyStorySetting(), state: { ...emptyStoryState(), continuitySnapshot: { current: '已经给用户发消息', recent: [], next: [], salient: [] } } },
  recentEntries: entries, participant: { id: 'alice', state: {}, updatedAt: now }, participants: [],
  dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [],
})

test('authored reference supplies exact words before normalization, across repeated resolver calls', () => {
  const raw: NarrativeDecision = { script: '  她记起上次的“在吗”，又写下<say id="r">在吗</say>。  ',
    interaction: { seen: false, reply: { mode: 'immediate', actionId: 'r', content: '另一份答案' } } }
  const resolved = reconcileTransportReferences(raw)
  assert.equal(resolved.interaction?.reply.content, '在吗')
  assert.equal(resolved.script, '她记起上次的“在吗”，又写下在吗。')
  assert.deepEqual(reconcileTransportReferences(resolved), resolved)
  const result = commit(resolved)
  assert.equal(validateScriptCommit(result).valid, true)
  assert.equal(result.events.find(event => event.kind === 'outgoing-message')?.scriptBinding?.status, 'bound')
  assert.ok(raw.script?.includes('<say'), 'input is immutable')
})

test('bad explicit ids and duplicate authored ids never create guessed outgoing text', () => {
  for (const script of ['她想问问。', '<say id="r">甲</say><say id="r">乙</say>']) {
    const result = reconcileTransportReferences({ script, interaction: { seen: false, reply: { mode: 'immediate', actionId: 'r', content: '代猜' } } })
    assert.equal(result.interaction?.reply.mode, 'none')
  }
  const forged = reconcileTransportReferences({ script: '只是旧话', authoredActions: [{ id: 'r', start: 0, end: 4, content: '只是旧话' }],
    interaction: { seen: false, reply: { mode: 'immediate', actionId: 'r' } } })
  assert.equal(forged.interaction?.reply.mode, 'none')
})

test('a sole authored action rescues example-copied or omitted action ids in single-recipient private turns', () => {
  // 模型照抄协议示例的 id 字面量（reply）而剧本写的是自己的 id：
  const mismatched = reconcileTransportReferences({ script: '她回道：<say id="s1">在呢</say>',
    interaction: { seen: true, reply: { mode: 'immediate', actionId: 'reply' } } })
  assert.equal(mismatched.interaction?.reply.mode, 'immediate')
  assert.equal(mismatched.interaction?.reply.content, '在呢')
  // 模型写了 say 行动与 immediate，但完全省略了引用：
  const omitted = reconcileTransportReferences({ script: '她回道：<say id="s1">在呢</say>',
    interaction: { seen: true, reply: { mode: 'immediate' as const } } })
  assert.equal(omitted.interaction?.reply.content, '在呢')
  // 已有 content 的 legacy 镜像不被兜底覆盖（无引用时 content 原样保留）：
  const legacy = reconcileTransportReferences({ script: '她回道：<say id="s1">在呢</say>',
    interaction: { seen: true, reply: { mode: 'immediate', content: '旧镜像原话' } } })
  assert.equal(legacy.interaction?.reply.content, '旧镜像原话')
})

test('the sole-action rescue stays private-scoped and never grabs a multi-channel action', () => {
  // 群回复在场时不是单接收者回合，兜底不启用：
  const withGroup = reconcileTransportReferences({ script: '她回道：<say id="s1">在呢</say>',
    groupReply: { mode: 'immediate', actionId: 's1' },
    interaction: { seen: true, reply: { mode: 'immediate', actionId: 'reply' } } })
  assert.equal(withGroup.interaction?.reply.mode, 'none')
  assert.equal(withGroup.groupReply?.content, '在呢')
  // 跨关系行动在场时同样不启用：
  const withCross = reconcileTransportReferences({ script: '她回道：<say id="s1">在呢</say>',
    crossConversationActions: [{ participantId: 'bob', mode: 'delayed' as const, content: '晚点说', sendAt: '2026-09-05T13:00:00Z' }],
    interaction: { seen: true, reply: { mode: 'immediate', actionId: 'reply' } } })
  assert.equal(withCross.interaction?.reply.mode, 'none')
})

test('legacy, delayed and already-streamed delivery keep existing content and scheduling', () => {
  const delayed = { mode: 'delayed' as const, content: '晚点回答', sendAt: '2026-09-05T13:00:00Z' }
  const raw: NarrativeDecision = { script: '她暂时记下这个问题。', interaction: { seen: false, reply: delayed } }
  assert.deepEqual(reconcileTransportReferences(raw).interaction?.reply, delayed)
  assert.equal(commit(raw).events.find(event => event.kind === 'outgoing-message')?.scriptBinding?.status, 'future')
  const streamed = reconcileTransportReferences({ script: '<say id="r">晚生成的话</say>', interaction: { seen: true,
    reply: { mode: 'immediate', actionId: 'r', content: '已发出的原话' } } }, true)
  assert.equal(reconcileTransportReferences(streamed).interaction?.reply.content, '已发出的原话')
  const legacy = reconcileTransportReferences({ script: '她回答了。', interaction: { seen: true, reply: { mode: 'immediate', content: '好' } } })
  assert.equal(legacy.interaction?.reply.content, '好')
})

test('group and cross-contact references preserve scope and multi-bubble delivery ledger', () => {
  const resolved = reconcileTransportReferences({ script: '她写下<say id="g">群里说</say>，又私发<say id="p">想好了||选第一个</say>。',
    groupReply: { mode: 'immediate', actionId: 'g' },
    crossConversationActions: [{ participantId: 'bob', mode: 'immediate', actionId: 'p', content: '' }] })
  assert.equal(resolved.groupReply?.content, '群里说')
  const result = commit(resolved, { groupReplyContent: resolved.groupReply!.content, messageSeparator: '||' })
  assert.equal(validateScriptCommit(result, '||').valid, true)
  const row: any = { ...entry(1, ''), ...scriptEntryDraftForCommit(result, null) }
  assert.equal(row.metadata.deliveryActions.find((action: any) => action.participantId === 'bob').segments.length, 2)
  assert.ok(!JSON.stringify(deliveryReality([row], 'alice', false)).includes('想好了'))
})

test('M10 20:18 phantom sending remains original prose but is explicitly unexecuted in both payload orders', () => {
  const prose = '她发了一句带着点查岗意味的调侃。'
  const result = commit({ script: prose, interaction: { seen: false, reply: { mode: 'none' } } })
  const row: any = { ...entry(15445, prose), ...scriptEntryDraftForCommit(result, null) }
  row.occurredAt = now
  assert.equal(deliveryReality([row], 'alice')[0].communicationOutcome, 'no-outgoing-action-recorded')
  for (const cacheFirst of [false, true]) {
    const payload = toPromptPayload(request([row]), { cacheFirst })
    assert.equal(payload.relevantEstablishedEpisodes.recentScript[0].content, prose)
    assert.equal(payload.relevantEstablishedEpisodes.continuitySnapshot ?? null, null)
    assert.equal(payload.ongoingThreads.deliveryReality[0].communicationOutcome, 'no-outgoing-action-recorded')
  }
})

test('new automatic original wins over its unexecuted plan without altering legacy projection', () => {
  const prose = '她合上物理练习册，回到床边看书。'
  const plan = { beats: [{ at: 1, kind: 'activity' as const, summary: '继续写物理题' }], carry: ['对方仍在打游戏'] }
  const result = commit({ script: prose })
  const row: any = { ...entry(2, prose), ...scriptEntryDraftForCommit(result, null, plan,
    { activity: { value: '看书', quote: '回到床边看书' } }) }
  row.occurredAt = now
  assert.equal(timelineEntryPromptProjection(row), row)
  for (const cacheFirst of [false, true]) {
    const projected = toPromptPayload(request([row]), { cacheFirst }).relevantEstablishedEpisodes.recentScript[0]
    assert.equal(projected.content, prose)
    assert.equal(projected.timelineEvidence, undefined)
    assert.deepEqual(projected.proposedTimeline, plan)
    assert.equal(projected.lifeHandoff.activity.value, '看书')
  }
  const legacy = { ...row, metadata: { timelinePlan: plan } }
  assert.match(timelineEntryPromptProjection(legacy).content, /Host timeline ledger/)
})

test('local handoff replaces obsolete occupancy and activity without resetting the plot arc', () => {
  const state = { ...emptyStoryState(), activeArcId: 9, scenePresence: [
    { name: '同学', status: 'present' as const, basis: '一起上课', sourceEntryIds: [1], updatedAt: now.toISOString() },
  ] }
  const old = entry(1, '同学坐在旁边。')
  const next = entry(2, '她回到自己的卧室，独自整理书包。')
  next.metadata = { narrativeAuthority: 'original-v2', lifeHandoff: {
    place: { value: '卧室', quote: '回到自己的卧室' }, activity: { value: '整理书包', quote: '独自整理书包' },
    presence: { names: [], quote: '独自整理书包' }, transition: { quote: '回到自己的卧室' },
  } }
  const frame = projectSceneFrame({ storyId: 's', now, scene: null, state, recentEntries: [old, next] })
  assert.deepEqual(frame.presentPeople, [])
  assert.equal(frame.place, '卧室')
  assert.equal(frame.ongoingActivity, '整理书包')
  assert.equal(state.activeArcId, 9)
  assert.deepEqual(projectSceneFrame({ storyId: 's', now, scene: null, state, recentEntries: [entry(3, '另一段原文')] }).presentPeople, [])
})

test('handoff quotes are grounded and committed immediately without copying prose into a summary', () => {
  assert.equal(normalizeLifeHandoff({ activity: { value: '睡觉', quote: '不存在' } }, '她在看书。'), undefined)
  const frame = projectSceneFrame({ storyId: 's', now, scene: null, state: emptyStoryState() })
  const result = commit({ script: '她合上书本，准备休息。' })
  const handoff = normalizeLifeHandoff({ activity: { value: '休息', quote: '准备休息' } }, result.prose)
  const advanced = advanceSceneFrame(frame, resolveDialogueBurst(frame, undefined, now), result, 3, now, handoff)
  assert.equal(advanced.frame.ongoingActivity, '休息')
  assert.deepEqual(advanced.frame.sources.ongoingActivity, [3])
})

test('scene anchor no longer overwrites scene/arc summary with director prose', async () => {
  const writes: any[] = []
  const host = { activeScene: async () => ({ id: 9 }), memoryConfig: { sceneHookCharacters: 300 },
    dbSet: async (_table: string, _query: any, patch: any) => writes.push(patch) }
  await (InterludeService.prototype as any).persistTimelineSceneAnchor.call(host, 's',
    { activity: { value: '看书', quote: '她回到床边看书。' } }, 15448, now)
  assert.match(writes[0].hook, /15448/)
  assert.equal(writes[0].summary, undefined)
  assert.equal(writes[0].lastEntryId, undefined)
})

test('19:39 feedback and subsequent response stay in one evidence chain without endorsing narrator interpretation', () => {
  const rows = [entry(15434, '你活该', 'character-message'), entry(15435, '我不喜欢你这样', 'user-message'),
    entry(15436, '她把抗议理解成撒娇。'), entry(15437, '那你喜欢哪样', 'character-message'), entry(15438, '真的', 'user-message')]
  const evidence = interactionEvidence(rows)
  assert.equal(evidence[0].priorCommunicationEntryId, 15434)
  assert.deepEqual(evidence[0].interpretationEntryIds, [15436])
  const draft: any = { sourceEntryIds: [15435, 15437], interactionReview: { outcome: 'contested', feedbackEntryIds: [15435], responseEntryIds: [15437] } }
  assert.equal(reviewedDevelopmentSupport(draft, rows, 'alice'), false)
  draft.interactionReview.outcome = 'supported'
  assert.equal(reviewedDevelopmentSupport(draft, rows, 'alice'), true)
  assert.equal(reviewedDevelopmentSupport(draft, rows, 'bob'), false)
  draft.interactionReview.feedbackEntryIds = [15436]
  assert.equal(reviewedDevelopmentSupport(draft, rows, 'alice'), false)
})

test('compactor receives no-action outcomes and interaction evidence, not a second confirmed timeline', async () => {
  let body: any
  const narrator = new OpenAICompatibleNarrator({ http: { post: async (_url: string, value: any) => {
    body = value; return { choices: [{ message: { content: '{"scene":{"summary":"继续生活"},"arc":{"summary":"联系未决"}}' } }] }
  } } } as any, {
    providers: [{ label: 'test', enabled: true, endpoint: 'https://example.test/chat', model: 'm', temperature: 0.5, topP: 1, maxTokens: 2048, timeout: 1000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForCompaction: true }],
    compaction: { enabled: true, temperature: 0.3, topP: 1, maxTokens: 2048, timeout: 1000, responseFormat: 'json-object' },
    failover: { enabled: false },
  } as any, true)
  const result = commit({ script: '她发去调侃。' })
  const row: any = { ...entry(2, ''), ...scriptEntryDraftForCommit(result, null) }; row.occurredAt = now
  await narrator.compact({ story: request([]).story, from: now, now, entries: [row], precedingEntries: [entry(1, '我不喜欢这样', 'user-message')],
    participants: [], facts: [], scene: { id: 1, summary: '场景' }, arc: { id: 1, summary: '剧情弧' } } as any)
  const payload = JSON.parse(body.messages[1].content)
  assert.equal(payload.deliveryReality[0].communicationOutcome, 'no-outgoing-action-recorded')
  assert.equal(payload.interactionEvidence[0].feedbackEntryId, 1)
  assert.equal(payload.entries[0].narrativeAuthority, 'original-v2')
  assert.match(body.messages[0].content, /Her interpretation is not the user’s endorsement/)
})

test('main writing keeps unresolved contact and raw originals, without repeated real-time summaries', () => {
  const prompt = systemPrompt('conversation-follow-up', '', '', '', '', '')
  assert.match(prompt, /A renewed question is a new action/)
  assert.match(prompt, /same causal passage/)
  assert.match(prompt, /proposed movement/)
  assert.match(prompt, /lifeHandoff/)
  assert.doesNotMatch(prompt, /POST-COMMIT CONTINUITY REFRESH/)
})

test('v4 source revisions survive reload and keep stale compaction from restoring local occupancy', () => {
  const state = decodeStoryState(encodeStoryState({ ...emptyStoryState(), workingDetailResolutions: { 物理作业: 15446 },
    sceneFrame: { id: 'f', localBoundaryEntryId: 15448, presentPeople: [], openMotions: [], openTopics: [], sources: {}, sourceEntryIds: [], updatedAt: now.toISOString() },
    scenePresence: [{ name: '旧同学', status: 'present', basis: '早上上课', sourceEntryIds: [15167], updatedAt: now.toISOString() }],
  }))
  assert.equal(state.workingDetailResolutions?.物理作业, 15446)
  assert.equal(state.sceneFrame?.localBoundaryEntryId, 15448)
  const frame = projectSceneFrame({ storyId: 's', now, scene: null, state, recentEntries: [entry(15167, '旧同学坐在旁边。')] })
  assert.deepEqual(frame.presentPeople, [])
})

test('delayed background review cannot reopen a completed working detail', async () => {
  let state: any = { ...emptyStoryState(), workingDetails: [], workingDetailResolutions: { 物理作业: 20 } }
  const host: any = { memoryConfig: { sceneHookCharacters: 100, sceneSummaryCharacters: 300, arcSummaryCharacters: 300 },
    dbGet: async () => [], dbSet: async (table: string, _q: any, patch: any) => { if (table === 'interlude_story') state = patch.state },
    getStory: async () => ({ id: 's', state }), activeArc: async () => ({ id: 1 }),
  }
  const review = (id: number) => (InterludeService.prototype as any).persistCompactionOutputs.call(host, { id: 's' }, { id: 1, entryCount: 0 },
    { scene: { summary: '生活继续' }, arc: { summary: '原剧情弧' }, workingDetails: [
      { label: '物理作业', value: '还有一道题', sourceEntryIds: [id, 999999] },
    ] }, [entry(id, '还有一道物理题。')], now)
  await review(10)
  assert.deepEqual(state.workingDetails, [], 'an unknown source id cannot advance the evidence revision')
  await review(21)
  assert.equal(state.workingDetails[0].label, '物理作业', 'a new evidenced task can use the same label')
})

test('new private life handoff still feeds Preplan without forwarding private prose or director guesses', async () => {
  const row = entry(30, '她整理书包，想到小桃私下说的秘密。')
  row.metadata = { narrativeAuthority: 'original-v2', lifeHandoff: { activity: { value: '整理书包', quote: '整理书包' } },
    timelinePlan: { beats: [{ at: 1, kind: 'state', summary: '猜测用户在玩游戏' }] } }
  const host = { sharedStoryConfig: { shareParticipantDetails: false }, dbGet: async () => [row] }
  const batch = await (InterludeService.prototype as any).schedulePreplanEvidence.call(host, 's', 0)
  const projected = batch.entries
  assert.equal(batch.filteredThroughEntryId, 0, 'visible protagonist evidence must remain unreviewed')
  assert.equal(projected.length, 1)
  assert.match(projected[0].content, /整理书包/)
  assert.doesNotMatch(JSON.stringify(projected), /秘密|猜测用户|lifeHandoff|timelinePlan/)
  assert.equal(projected[0].participantId, '')
  assert.match(row.content, /秘密/, 'stored original remains intact')
})

test('40 dense dialogue steps keep one original chain and preserve source-bound speech', () => {
  const rows: ScriptEntry[] = []
  for (let turn = 0; turn < 40; turn++) {
    const text = `第${turn + 1}次新的判断`
    const resolved = reconcileTransportReferences({ script: `她接着刚才的动作说<say id="r">${text}</say>。`,
      interaction: { seen: true, reply: { mode: 'immediate', actionId: 'r' } } })
    const result = commit(resolved, { phase: 'user-message' })
    assert.equal(result.events.find(event => event.kind === 'outgoing-message')?.scriptBinding?.status, 'bound')
    const row: any = { ...entry(turn + 1, ''), ...scriptEntryDraftForCommit(result, resolved.interaction!) }
    row.occurredAt = now; rows.push(row)
    const view = toPromptPayload(request(rows), { cacheFirst: turn % 2 === 0 })
    assert.equal(view.authoringWindow.continuation.lastScript.entryId, turn + 1)
    assert.equal(view.relevantEstablishedEpisodes.recentScript.at(-1).content, result.prose)
  }
  assert.equal(rows.length, 40)
})

test('a silent reply carrying a resolvable actionId is rescued to immediate in place', () => {
  // 弱模型矛盾形态：mode=none + actionId，但剧本里确实写了对应 id 的 say 行动。
  const rescued = reconcileTransportReferences({
    script: '她想了想，回了句：<say id="reply-17734">干嘛，又想出什么暴论了？</say>',
    interaction: { seen: true, reply: { mode: 'none', actionId: 'reply-17734' } },
  })
  assert.equal(rescued.interaction?.reply.mode, 'immediate')
  assert.equal(rescued.interaction?.reply.content, '干嘛，又想出什么暴论了？')
  // 锚定不到（自造 id、剧本无对应 say）时维持 none，绝不升级为失败。
  const unresolved = reconcileTransportReferences({
    script: '她笑了笑，打字回复：“在呢在呢。”',
    interaction: { seen: true, reply: { mode: 'none', actionId: 'reply-99999' } },
  })
  assert.equal(unresolved.interaction?.reply.mode, 'none')
})

test('group replies nested inside interaction are promoted to top-level groupReply', () => {
  // 实测 Gemini 3.7 Flash 群聊 mention-only 形态：群回复嵌套在 interaction.groupReply。
  const promoted = reconcileTransportReferences({
    script: '她想了想，回了句：<say id="reply">你才是猪 早睡早起懂不懂</say>',
    interaction: { groupReply: { mode: 'immediate', content: '你才是猪 早睡早起懂不懂' } },
  } as any)
  assert.equal((promoted as any).groupReply?.mode, 'immediate')
  assert.equal((promoted as any).groupReply?.content, '你才是猪 早睡早起懂不懂')
  // 顶层已有 groupReply 时嵌套不覆盖。
  const existing = reconcileTransportReferences({
    script: '她回了。',
    groupReply: { mode: 'none' },
    interaction: { groupReply: { mode: 'immediate', content: '嵌套不应覆盖' } },
  } as any)
  assert.equal((existing as any).groupReply?.mode, 'none')
})

test('soleActionReply survives undefined reply without crashing', () => {
  // beta9 回归：interaction 存在但 reply 为 undefined 时 soleActionReply(undefined)
  // 直接读 reply.mode 崩溃，被 failover 当成 provider 失败 → All providers failed。
  const noCrash = reconcileTransportReferences({
    script: '她回了：<say id="s1">在呢</say>',
    interaction: { seen: true } as any,
  })
  assert.equal(noCrash.interaction?.seen, true)
  // 正常唯一行动兜底不受影响。
  const normal = reconcileTransportReferences({
    script: '她回了：<say id="s1">在呢</say>',
    interaction: { seen: true, reply: { mode: 'immediate', actionId: 'reply' } },
  })
  assert.equal(normal.interaction?.reply.content, '在呢')
})

test('agency-approved proactive contact synthesizes crossAction from script say actions', () => {
  // 复现 12:04 场景：模型输出了 proactiveContact(send-now) 但没输出
  // crossConversationActions——Agency 通过但消息发不出去。
  // reconcileTransportReferences 应产出 authoredActions 供合成路径读取。
  const resolved = reconcileTransportReferences({
    script: '她想了想，发了条消息：<say id="r1">你是打算睡到明天吗<sep/>再不醒饺子都要凉透了</say>',
  } as any)
  assert.ok(Array.isArray((resolved as any).authoredActions))
  assert.equal((resolved as any).authoredActions.length, 1)
  assert.equal((resolved as any).authoredActions[0].content, '你是打算睡到明天吗<sep/>再不醒饺子都要凉透了')
})

test('scripts without say markup produce no authoredActions for synthesis', () => {
  const resolved = reconcileTransportReferences({
    script: '她写了句话发过去，但没用标记。',
  } as any)
  assert.equal((resolved as any).authoredActions?.length ?? 0, 0)
})
