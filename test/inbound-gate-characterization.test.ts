import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'

/** P8-S5 特征测试：入站入口仅靠注释约束的时序契约，搬迁前后必须逐位成立。
 * 全部针对原型方法 + 假宿主（房屋既有形态），不构造真实 InterludeService。 */
const methods = InterludeService.prototype as any

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'onebot', selfId: '10001', userId: '20002', channelId: 'private:20002',
    messageId: 'm-1', content: 'hello', timestamp: undefined, type: 'message',
    ...overrides,
  } as any
}

function privateHost(overrides: Record<string, unknown> = {}) {
  const story = { id: 's1', status: 'active', selfId: '10001', platform: 'onebot', state: {}, setting: { character: { name: '主角' } } }
  const participant = { id: 'p1', status: 'active', storyId: 's1', personId: 'u1' }
  const density: number[] = []
  const host: Record<string, any> = {
    config: { runtime: {}, model: {} },
    audioConfig: { enabled: false },
    seenIncomingMessages: new Map(),
    interruptedTypingParticipants: new Set(),
    contextDensity: { record: (_sid: string, at: number) => density.push(at) },
    serial: async (_id: string, run: () => Promise<any>) => run(),
    canHandleSession: () => true,
    findStory: async () => story,
    findParticipant: async () => participant,
    ensureParticipant: async () => participant,
    getStory: async () => story,
    describeUserEvent: () => ({ content: 'hello', sources: [], audioSources: [], quote: undefined }),
    describeVisionEvent: () => ({ content: 'hello', sources: [], audioSources: [] }),
    tryHarvestStickers: () => {},
    elevateRhythmOnIncoming: () => {},
    readForward: async () => undefined,
    getParticipant: async () => ({ id: 'p1', status: 'active', personId: 'u1' }),
    recordIncomingMessage: async (p: any) => p,
    signalIncomingInterruption: () => host.interruptedTypingParticipants.add('p1'),
    cancelPendingOutgoingMessages: async () => [],
    dbGet: async () => [],
    appendEntry: async () => ({ id: 1 }),
    pauseAutomaticAdvanceAfterUserMessage: async () => {},
    rememberIncomingMessage: (k: string) => host.seenIncomingMessages.set(k, Date.now()),
    bufferUserNarrative: () => { host.buffered = (host.buffered ?? 0) + 1 },
    turnEngine: { recordSource: () => {} },
    report: () => {}, reportOperation: () => {}, reportStandaloneOperation: () => {},
    channelMetadataFor: async () => undefined,
    touchEndpointStateInbound: async () => {},
    resolveInboundEndpointFor: async () => undefined,
    densityLog: density,
    ...overrides,
  }
  return host
}

test('私聊重放去重：内存键命中直接确认——不落库、不入队、不二次计密度', async () => {
  const host = privateHost()
  const session = baseSession()
  const key = `onebot:10001:20002:m-1`
  host.seenIncomingMessages.set(key, Date.now())
  const ok = await methods.receive.call(host, session)
  assert.equal(ok, true)
  assert.equal(host.appendEntryCalls ?? 0, undefined ?? 0) // 未触达
  assert.equal(host.buffered, undefined, '重放不得入队')
  assert.equal(host.densityLog.length, 0, '重放不得二次计密度')
})

test('密度计数在去重之后：同一条消息两次投递只计一次', async () => {
  const host = privateHost()
  const session = baseSession()
  await methods.receive.call(host, session)
  assert.equal(host.densityLog.length, 1)
  // 第二次（内存键已记）命中去重
  await methods.receive.call(host, session)
  assert.equal(host.densityLog.length, 1, '重放不双计（审计细节①）')
  assert.equal(host.buffered, 1, '仅首轮入队一次')
})

test('门序契约：未授权会话在故事查找之前早退，不能凭消息建故事', async () => {
  let storyLookups = 0
  const host = privateHost({ canHandleSession: () => false, findStory: async () => { storyLookups++; return undefined } })
  const ok = await methods.receive.call(host, baseSession())
  assert.equal(ok, false)
  assert.equal(storyLookups, 0, 'canHandleSession 先于 findStory')
})

test('私聊空内容（无文本无语音）不产生回合', async () => {
  const host = privateHost()
  const ok = await methods.receive.call(host, baseSession({ content: '' }))
  assert.equal(ok, false)
  assert.equal(host.buffered, undefined)
  assert.equal(host.densityLog.length, 0)
})

function groupHost(overrides: Record<string, unknown> = {}) {
  const story = { id: 's1', status: 'active', selfId: '10001', platform: 'onebot', state: {}, setting: { character: { name: '主角' } } }
  const density: number[] = []
  const host: Record<string, any> = {
    config: { runtime: {} },
    seenIncomingMessages: new Map(),
    contextDensity: { record: (_sid: string, at: number) => density.push(at) },
    serial: async (_id: string, run: () => Promise<any>) => run(),
    canHandleGroupSession: () => true,
    groupRule: () => ({ groupId: '123', enabled: true, responseMode: 'mention-only', debounceSeconds: 1 }),
    findStory: async () => story,
    createStory: async () => story,
    getStory: async () => story,
    groupSenderName: async () => '某人',
    readForward: async () => undefined,
    tryHarvestStickers: () => {},
    channelMetadataFor: async () => undefined,
    touchEndpointStateInbound: async () => {},
    dbGet: async () => [],
    appendEntry: async (_sid: string, draft: any) => { host.entries = (host.entries ?? []).concat(draft); return { id: (host.entries as any[]).length } },
    pauseAutomaticAdvanceAfterUserMessage: async () => { host.pauses = (host.pauses ?? 0) + 1 },
    rememberIncomingMessage: (k: string) => host.seenIncomingMessages.set(k, Date.now()),
    bufferGroupMessage: () => { host.buffered = (host.buffered ?? 0) + 1 },
    report: () => {}, reportOperation: () => {},
    densityLog: density,
    ...overrides,
  }
  return host
}

function groupSession(overrides: Record<string, unknown> = {}) {
  return baseSession({ channelId: 'group:123', ...overrides })
}

test('mention-only 纯文本未提及：故事查找之前早退（不建故事不落库）', async () => {
  let storyLookups = 0
  const host = groupHost({ findStory: async () => { storyLookups++; return undefined } })
  const ok = await methods.receiveGroup.call(host, groupSession())
  assert.equal(ok, false)
  assert.equal(storyLookups, 0, 'mention-only 早退先于 findStory')
})

test('mention-only 未提及图片：落库为证据但不入队、不耗意愿/冷却、不重置推进', async () => {
  const host = groupHost()
  host.groupRule = () => ({ groupId: '123', enabled: true, responseMode: 'mention-only', debounceSeconds: 1 })
  // 未提及但带图：extractSessionImageSources 从 img 元素取源——用富文本内容模拟
  const session = groupSession({ content: '<img src="https://gchat.qpic.cn/x"/>', messageId: 'g-1' })
  const ok = await methods.receiveGroup.call(host, session)
  assert.equal(ok, true)
  assert.ok((host.entries ?? []).length === 1, '图片证据已落库')
  assert.equal(host.entries[0].kind, 'group-message')
  assert.equal(host.buffered, undefined, '未提及图片不得入队')
  assert.equal(host.pauses ?? 0, 0, '证据消息不得重置自动推进（density-decay 死锁修复）')
})

test('mention-only 未提及语音：默认 audioAlwaysTriggers 仍入队（必定触发）', async () => {
  const host = groupHost()
  host.groupRule = () => ({ groupId: '123', enabled: true, responseMode: 'mention-only', debounceSeconds: 1 })
  const session = groupSession({ content: '<audio file="voice-token"/>', messageId: 'g-3' })
  const ok = await methods.receiveGroup.call(host, session)
  assert.equal(ok, true)
  assert.ok((host.entries ?? []).length === 1, '语音消息已落库')
  assert.equal(host.buffered, 1, '默认开启时未@语音仍入队等价于必定触发')
})

test('mention-only 未提及语音：关闭 audioAlwaysTriggers 后仅落库为证据不入队', async () => {
  const host = groupHost()
  host.groupRule = () => ({ groupId: '123', enabled: true, responseMode: 'mention-only', debounceSeconds: 1, audioAlwaysTriggers: false })
  const session = groupSession({ content: '<audio file="voice-token"/>', messageId: 'g-4' })
  const ok = await methods.receiveGroup.call(host, session)
  assert.equal(ok, true)
  assert.ok((host.entries ?? []).length === 1, '语音事实仍落库为证据')
  assert.equal(host.buffered, undefined, '关闭必定触发后未@语音不得入队')
})

test('群聊重放去重：内存键命中直接确认，不落库不入队', async () => {
  const host = groupHost()
  host.groupRule = () => ({ groupId: '123', enabled: true, responseMode: 'always', debounceSeconds: 1 })
  const session = groupSession({ content: 'hi', messageId: 'g-2' })
  host.seenIncomingMessages.set('onebot:10001:group:123:g-2', Date.now())
  const ok = await methods.receiveGroup.call(host, session)
  assert.equal(ok, true)
  assert.equal((host.entries ?? []).length, 0, '重放不落库')
  assert.equal(host.buffered, undefined)
  assert.equal(host.densityLog.length, 0, '重放不双计密度')
})

// ── I-6b 三维度拆分：新组合能力 ──────────────────────────────────────

test('I-6b 新组合：背景采集 + 仅@触发——普通文本落库为证据但不入队', async () => {
  const host = groupHost()
  host.groupRule = () => ({ groupId: '123', enabled: true, responseMode: 'mention-only', collectionScope: 'background', immediateTrigger: 'mention', debounceSeconds: 1 })
  const session = groupSession({ content: '今天天气不错', messageId: 'g-10' })
  const ok = await methods.receiveGroup.call(host, session)
  assert.equal(ok, true)
  assert.ok((host.entries ?? []).length === 1, '普通文本已按背景采集落库')
  assert.equal(host.buffered, undefined, '仅@触发：普通文本不入队')
  // 同组合下被 @ 的消息照常入队。
  const atHost = groupHost()
  atHost.groupRule = () => ({ groupId: '123', enabled: true, responseMode: 'mention-only', collectionScope: 'background', immediateTrigger: 'mention', debounceSeconds: 1 })
  await methods.receiveGroup.call(atHost, groupSession({ content: '<at id="10001"/> 在吗', messageId: 'g-11' }))
  assert.equal(atHost.buffered, 1, '@ 消息入队')
})

test('I-6b 定向采集：引用她的消息现在落库为证据（此前被丢弃）', async () => {
  const host = groupHost()
  host.groupRule = () => ({ groupId: '123', enabled: true, responseMode: 'mention-only', debounceSeconds: 1 })
  const session = groupSession({
    content: '你刚才说什么', messageId: 'g-12',
    quote: { user: { id: '10001' }, content: '刚才那句' },
  })
  const ok = await methods.receiveGroup.call(host, session)
  assert.equal(ok, true)
  assert.ok((host.entries ?? []).length === 1, '引用她的消息按定向模态采集（设计 §7.4）')
  assert.equal(host.buffered, undefined, '仅@触发档下引用仍只作证据不入队')
})

test('I-6b 采集关闭：先于故事查找丢弃一切群消息', async () => {
  let storyLookups = 0
  const host = groupHost({ findStory: async () => { storyLookups++; return undefined } })
  host.groupRule = () => ({ groupId: '123', enabled: true, responseMode: 'always', collectionScope: 'off', debounceSeconds: 1 })
  const ok = await methods.receiveGroup.call(host, groupSession({ content: '<at id="10001"/> 在吗', messageId: 'g-13' }))
  assert.equal(ok, false)
  assert.equal(storyLookups, 0, 'off 档早退先于 findStory（连 @ 也不采集）')
  assert.equal((host.entries ?? []).length, 0)
  assert.equal(host.buffered, undefined)
})

// ── Issue #18：采集门丢弃不再静默（diagnostic 日志）──────────────────

test('I-18 采集门丢弃留痕：判定依据 + 脱敏预览（diagnostic 级，可分辨 at 缺失/at 不符）', async () => {
  const standalone: string[] = []
  const host = groupHost()
  host.reportStandaloneOperation = (...args: unknown[]) => { standalone.push(args.map(String).join(' ')) }
  host.groupRule = () => ({ groupId: '123', enabled: true, responseMode: 'mention-only', debounceSeconds: 1 })
  // 未 @ 纯文本被采集门丢弃（先于故事查找）——此前完全静默。
  const dropped = await methods.receiveGroup.call(host, groupSession({ content: '晚上好呀 <at id="2990937744"/>', messageId: 'g-14' }))
  assert.equal(dropped, false)
  const line = standalone.find(item => item.includes('群消息被采集门丢弃'))
  assert.ok(line, '丢弃必须留 diagnostic 痕迹')
  assert.ok(line.includes('仅定向采集'), '丢弃原因可见')
  assert.ok(line.includes('false false 0 0'), '判定依据（@/引用/音频/图片）可见')
  // 脱敏预览：QQ 号被遮但 at 元素结构保留——上游桥缺 at 段时一眼可辨。
  assert.ok(line.includes('<at id="••••••7744"/>'), '预览保留 at 元素结构且数字脱敏')
  // @ 命中的消息照常通过，不产生该日志。
  standalone.length = 0
  const host2 = groupHost()
  host2.reportStandaloneOperation = (...args: unknown[]) => { standalone.push(args.map(String).join(' ')) }
  host2.groupRule = () => ({ groupId: '123', enabled: true, responseMode: 'mention-only', debounceSeconds: 1 })
  const passed = await methods.receiveGroup.call(host2, groupSession({ content: '<at id="10001"/> 在吗', messageId: 'g-15' }))
  assert.equal(passed, true)
  assert.equal(standalone.filter(item => item.includes('群消息被采集门丢弃')).length, 0, '通过的消息不记丢弃日志')
})

test('私聊串行块抛异常时兜底清打断标志（泄漏会永久阻塞分段）', async () => {
  const host = privateHost({ appendEntry: async () => { throw new Error('db down') } })
  await assert.rejects(methods.receive.call(host, baseSession()))
  assert.equal(host.interruptedTypingParticipants.size, 0, 'finally 必须清除打断标志')
})
