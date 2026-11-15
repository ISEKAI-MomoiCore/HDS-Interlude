import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
const run = (InterludeService.prototype as any).offlineGroupCatchup
const noop = () => {}
const baseTime = Math.floor(Date.now() / 1000) - 60
function deferred<T = void>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(r => { resolve = r }), resolve: (value: T) => resolve(value) } }
function message(id: number, content: any, user = 'user', offset = id) {
  return { message_id: id, group_id: 123, sender: { user_id: user, nickname: user }, time: baseTime + offset, message: content }
}
function fixture(scope = 'directed') {
  const entries: any[] = [], requests: any[] = [], logs: any[] = []
  let history: any = []
  const bot = { platform: 'onebot', selfId: '10001', status: 'online', internal: { _request: async (action: string, data: any) => {
    requests.push({ account: '10001', action, data })
    return action === 'get_group_msg_history' ? { data: { messages: history } } : { data: { sender: { user_id: 'other' }, group_id: 123 } }
  } } }
  const story: any = { id: 's', platform: 'onebot', selfId: '10001', status: 'active', setting: {} }
  const svc: any = {
    ctx: { bots: [bot] }, config: { onebot: { enabled: true, botAccounts: [{ qq: '10001', enabled: true }], groupChats: [{ groupId: '123', enabled: true, collectionScope: scope }] } },
    endpointRows: [], endpointStates: new Map(), ensureEndpointRegistry: async () => {},
    getCanonicalStory: async () => story, canHandleStory: () => true,
    generation: 0, pause: 0, desktopRuntimePhase: 'running', databaseResetting: false,
    deliveryGeneration: () => String(svc.generation), taskGeneration: () => `${svc.generation}:${svc.pause}`,
    dbGet: async () => entries.length ? [entries[entries.length - 1]] : [{ occurredAt: new Date(baseTime * 1000), metadata: {} }],
    serial: async (_: string, task: () => unknown) => task(),
    appendEntry: async (_: string, entry: any) => { entries.push(entry); return entry },
    reportStandaloneOperation: (...args: any[]) => logs.push(args),
  }
  return { svc, bot, story, entries, requests, logs, history: (value: any) => { history = value } }
}

test('F08 standard Bot without guildId fetches group history and writes summary', { timeout: 3000 }, async () => {
  const f = fixture('background'); f.history([message(1, [{ type: 'text', data: { text: 'one second newer' } }])])
  await run.call(f.svc)
  assert.equal(f.requests[0]?.action, 'get_group_msg_history')
  assert.equal(f.requests[0]?.data.group_id, 123)
  assert.equal(f.entries.length, 1)
  assert.equal(f.entries[0].metadata.messageCount, 1)
})

test('F09 directed history collects only online-equivalent mentions, own replies and supported media', { timeout: 3000 }, async () => {
  const f = fixture()
  f.history([
    message(1, [{ type: 'text', data: { text: 'unrelated-secret' } }]),
    message(2, [{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: 'mention' } }]),
    message(3, [{ type: 'reply', data: { id: '20' } }, { type: 'text', data: { text: 'quote-own' } }]),
    message(4, [{ type: 'reply', data: { id: '21' } }, { type: 'text', data: { text: 'quote-other-secret' } }]),
    message(5, [{ type: 'image', data: { url: 'https://example.test/a.png' } }]),
    message(6, [{ type: 'record', data: { file: 'voice.silk' } }]),
    message(7, [{ type: 'forward', data: { id: 'fwd' } }]),
    message(8, '[CQ:at,qq=10001] CQ mention'),
    message(9, [{ type: 'text', data: { text: 'self-secret' } }], '10001'),
    message(20, 'my old message', '10001', -2), message(21, 'someone else old', 'other', -1),
  ])
  await run.call(f.svc)
  assert.equal(f.entries.length, 1)
  assert.equal(f.entries[0].metadata.messageCount, 6)
  assert.ok(!f.entries[0].content.includes('unrelated-secret'))
  assert.ok(!f.entries[0].content.includes('quote-other-secret'))
  assert.ok(!f.entries[0].content.includes('self-secret'))
})

test('F08 explicit group endpoint selects account B despite story legacy account A', { timeout: 3000 }, async () => {
  const f = fixture()
  const second = { platform: 'napcat', selfId: '20002', status: 'online', internal: { _request: async (action: string, data: any) => {
    f.requests.push({ account: '20002', action, data }); return { messages: [message(2, '[CQ:at,qq=20002] chosen account')] }
  } } }
  f.svc.ctx.bots.push(second); f.svc.config.onebot.botAccounts.push({ qq: '20002' })
  f.svc.endpointRows = [{ id: 'ep-b', ownerKind: 'group', ownerId: '123', groupId: '123', platform: 'napcat', selfId: '20002', enabled: true }]
  await run.call(f.svc)
  assert.equal(f.requests[0]?.account, '20002')
  assert.equal(f.entries[0]?.metadata.selfId, '20002')
  assert.equal(f.entries[0]?.metadata.channel.endpointId, 'ep-b')
})

test('F09 unresolved replies use bounded get_msg lookup to identify quoted bot', { timeout: 3000 }, async () => {
  const f = fixture()
  f.bot.internal._request = async (action: string, data: any) => {
    f.requests.push({ action, data })
    return action === 'get_group_msg_history'
      ? { data: { messages: [message(1, '[CQ:reply,id=999] quote outside page')] } }
      : { data: { sender: { user_id: '10001' }, group_id: 123 } }
  }
  await run.call(f.svc)
  assert.equal(f.entries[0]?.metadata.messageCount, 1)
  assert.equal(f.requests.filter(r => r.action === 'get_msg').length, 1)
})

for (const action of ['reset', 'pause-resume']) for (const stage of ['history', 'serial']) test(`F08/F09 ${action} during ${stage} retires summary`, { timeout: 3000 }, async () => {
  const f = fixture('background'), started = deferred(), release = deferred()
  f.history([message(1, 'old input')])
  if (stage === 'history') {
    const request = f.bot.internal._request
    f.bot.internal._request = async (action: string, data: any) => { started.resolve(); await release.promise; return request(action, data) }
  } else f.svc.serial = async (_: string, task: () => unknown) => { started.resolve(); await release.promise; return task() }
  const running = run.call(f.svc); await started.promise
  if (action === 'reset') f.svc.generation++
  else { f.svc.pause++; f.svc.desktopRuntimePhase = 'paused'; f.svc.desktopRuntimePhase = 'running' }
  release.resolve(); await running
  assert.equal(f.entries.length, 0)
})

test('F08 missing bot or history capability produces a diagnostic reason', { timeout: 3000 }, async () => {
  for (const missing of ['bot', 'capability']) {
    const f = fixture()
    if (missing === 'bot') f.svc.ctx.bots = []
    else (f.bot as any).internal = {}
    await run.call(f.svc)
    assert.ok(f.logs.some(args => args[0] === 'diagnostic' && args[1] === 'warn'), missing)
    assert.equal(f.entries.length, 0)
  }
})

test('F09 collection off / OneBot disabled cause no history request', { timeout: 3000 }, async () => {
  const f = fixture('off'); await run.call(f.svc); assert.equal(f.requests.length, 0)
  f.svc.config.onebot.groupChats[0].collectionScope = 'background'; f.svc.config.onebot.enabled = false
  await run.call(f.svc); assert.equal(f.requests.length, 0)
})

test('F08 concurrent catchups serialize watermark checks and avoid duplicate summaries', { timeout: 3000 }, async () => {
  const f = fixture('background'); f.history([message(1, 'new message')])
  let queue = Promise.resolve()
  f.svc.serial = (_: string, task: () => Promise<any>) => { const result = queue.then(task); queue = result.then(noop, noop); return result }
  await Promise.all([run.call(f.svc), run.call(f.svc)])
  assert.equal(f.entries.length, 1)
})


test('F09 resolves all page reply authors with bounded concurrency and shared lookup IDs', { timeout: 3000 }, async () => {
  const f = fixture()
  let active = 0, maxActive = 0
  f.bot.internal._request = async (action: string, data: any) => {
    f.requests.push({ action, data })
    if (action === 'get_group_msg_history') return { data: { messages: Array.from({ length: 24 }, (_, i) => message(i + 1, `[CQ:reply,id=${1000 + i % 12}] reply`)) } }
    active++; maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setImmediate(resolve)); active--
    return { data: { sender: { user_id: '10001' }, group_id: 123 } }
  }
  await run.call(f.svc)
  assert.equal(f.entries[0]?.metadata.messageCount, 24)
  assert.equal(f.requests.filter(r => r.action === 'get_msg').length, 12)
  assert.ok(maxActive <= 4)
})

test('F09 failed and foreign-group quote lookups alone remain outside directed collection', { timeout: 3000 }, async () => {
  const f = fixture()
  f.bot.internal._request = async (action: string, data: any) => {
    if (action === 'get_group_msg_history') return { data: { messages: [message(1, '[CQ:reply,id=999] foreign'), message(2, '[CQ:reply,id=888] failed')] } }
    if (data.message_id === 888) throw new Error('unavailable')
    return { data: { sender: { user_id: '10001' }, group_id: 456 } }
  }
  await run.call(f.svc)
  assert.equal(f.entries.length, 0)
})

test('F08 watermark lookup matches legacy prefixed group metadata variants', { timeout: 3000 }, async () => {
  const f = fixture('background')
  // 只有查询包含历史存储形态（group:123 等）时才命中水位行，
  // 遗留元数据的群不能被静默跳过或命中过旧水位。
  f.svc.dbGet = async (_table: string, query: any) => {
    const variants = query['metadata.groupId']?.$in
    if (!Array.isArray(variants) || !variants.includes('group:123')) return []
    return [{ occurredAt: new Date(baseTime * 1000), metadata: { groupId: 'group:123' } }]
  }
  f.history([message(1, [{ type: 'text', data: { text: 'one second newer' } }])])
  await run.call(f.svc)
  assert.equal(f.requests[0]?.action, 'get_group_msg_history')
  assert.equal(f.entries.length, 1)
})
