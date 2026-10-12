import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import {
  ENDPOINT_DELIVERABLE_TTL_MS, freshEndpointState, isEndpointDeliverable,
  restoreEndpointState, stateAfterConnection, stateAfterInbound,
  type EndpointRow, type EndpointState,
} from '../src/endpoints'

const methods = InterludeService.prototype as unknown as Record<string, Function>
const staleState = (id = 'ep', now = Date.now()) =>
  stateAfterInbound(freshEndpointState(id, now - ENDPOINT_DELIVERABLE_TTL_MS - 60_000), now - ENDPOINT_DELIVERABLE_TTL_MS - 60_000)
const endpoint = (overrides: Partial<EndpointRow> = {}): EndpointRow => ({
  id: 'ep', ownerKind: 'participant-user', ownerId: 'p1', channelKind: 'qq',
  platform: 'onebot', accountKey: 'onebot:100', selfId: '100', userId: '200',
  enabled: true, createdAt: new Date(), updatedAt: new Date(), ...overrides,
})

function fixture(row = endpoint(), state = staleState(row.id)) {
  const calls: unknown[][] = []
  const failures: string[] = []
  const writes: EndpointState[] = []
  const participant = { id: 'p1', platform: row.platform, selfId: row.selfId, userId: '200', channelId: '200' }
  const host: any = {
    endpointRegistryReady: true, endpointRows: [row], endpointStates: new Map([[row.id, state]]),
    ensureEndpointRegistry: async () => {},
    persistEndpointState: (_id: string, value: EndpointState) => writes.push(value),
    endpointAddressSync: () => ({ platform: row.platform, selfId: row.selfId, endpointId: row.id }),
    getParticipant: async () => participant, canHandleParticipant: () => true,
    resolveLiteralQuoteMessageId: async () => undefined,
    recordOutgoingDeliveryFailure: async (_story: unknown, _id: string, _message: unknown, reason: string) => { failures.push(reason) },
    report: () => {}, reportOperation: () => {}, reportStandalone: () => {},
    config: { logging: {} }, ctx: { bots: [{ platform: row.platform, selfId: row.selfId,
      sendMessage: async (...args: unknown[]) => {
        // Allowing a probe must not fabricate fresh delivery evidence before transport.
        assert.equal(host.endpointStates.get(row.id).deliverable.checkedAt, state.deliverable.checkedAt)
        calls.push(args)
        return ['receipt']
      },
    }] },
  }
  for (const name of ['setEndpointState', 'endpointGateReason', 'endpointInitiateGateReason', 'endpointForDelivery', 'liveBotForEndpoint', 'noteEndpointOutbound', 'sendOutgoingMessages', 'desktopEndpointHealthSnapshot', 'sendGroupMessage']) {
    host[name] = methods[name]
  }
  const send = (extra: Record<string, unknown> = {}) => host.sendOutgoingMessages(
    { id: 's1' }, [{ participantId: 'p1', content: '消息原文', endpointId: row.id, ...extra }],
  )
  return { host, row, participant, state, calls, failures, writes, send }
}

for (const platform of ['onebot', 'onebot:v2', 'napcat', 'napcat:v2', 'qq:onebot', 'qq:onebot:v2']) {
  test('stale online QQ endpoint may probe: ' + platform, () => {
    const now = Date.now()
    const state = staleState('ep', now)
    const before = structuredClone(state)
    assert.equal(isEndpointDeliverable(state, now, endpoint({ platform })), true)
    assert.deepEqual(state, before)
  })
}

test('TTL policy remains conservative without a known QQ/OneBot descriptor', () => {
  const now = Date.now()
  const state = staleState('ep', now)
  assert.equal(isEndpointDeliverable(state, now), false)
  assert.equal(isEndpointDeliverable(state, now, endpoint({ channelKind: 'wechat', platform: 'wechat' })), false)
  assert.equal(isEndpointDeliverable(state, now, endpoint({ channelKind: 'wechat', platform: 'onebot' })), false)
  assert.equal(isEndpointDeliverable(state, now, endpoint({ platform: 'unknown' })), false)
  const fresh = stateAfterInbound(state, now)
  assert.equal(isEndpointDeliverable(fresh, now, endpoint()), true)
  assert.equal(isEndpointDeliverable(fresh, now, endpoint({ platform: 'wechat', channelKind: 'wechat' })), true)
})

test('stale QQ background private delivery reaches transport and refreshes only after receipt', async () => {
  const f = fixture()
  assert.equal((await f.send()).length, 1)
  assert.deepEqual(f.calls, [['private:200', '消息原文']])
  assert.deepEqual(f.failures, [])
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].deliverable.allowed, true)
  assert.ok(f.writes[0].deliverable.checkedAt > f.state.deliverable.checkedAt)
  assert.equal(f.host.endpointGateReason(f.row.id), undefined)
})

test('failed probe starts existing five-minute cooldown, blocks repeats, and permits retry when due', async () => {
  const f = fixture()
  f.host.ctx.bots[0].sendMessage = async () => { f.calls.push(['failed']); throw new Error('transport failed') }
  const before = Date.now()
  assert.deepEqual(await f.send(), [])
  const failed = f.host.endpointStates.get('ep') as EndpointState
  assert.equal(failed.deliverable.allowed, false)
  assert.ok(failed.deliverable.cooldownUntil! >= before + 5 * 60_000)
  assert.ok(failed.deliverable.cooldownUntil! <= Date.now() + 5 * 60_000)
  assert.match(f.failures[0], /^transport-failed:/)
  assert.deepEqual(await f.send(), [])
  assert.equal(f.calls.length, 1)
  assert.equal(f.failures[1], 'endpoint-cooldown')
  const due = failed.deliverable.cooldownUntil!
  assert.equal(f.host.endpointGateReason('ep', due - 1), 'endpoint-cooldown')
  assert.equal(f.host.endpointGateReason('ep', due), undefined)
  assert.equal(isEndpointDeliverable(failed, due - 1, f.row), false)
  assert.equal(isEndpointDeliverable(failed, due, f.row), true)
})

for (const reason of ['endpoint-offline', 'endpoint-disabled', 'endpoint-cooldown', 'endpoint-not-deliverable', 'participant-not-allowed', 'endpoint-not-found']) {
  test('stale QQ probe does not bypass ' + reason, async () => {
    const f = fixture()
    if (reason === 'endpoint-offline') f.host.endpointStates.set('ep', stateAfterConnection(f.state, false))
    if (reason === 'endpoint-disabled') f.row.enabled = false
    if (reason === 'endpoint-cooldown') f.state.deliverable.cooldownUntil = Date.now() + 60_000
    if (reason === 'endpoint-not-deliverable') f.state.deliverable = { allowed: false, checkedAt: Date.now(), note: 'explicit-denial' }
    if (reason === 'participant-not-allowed') f.host.canHandleParticipant = () => false
    if (reason === 'endpoint-not-found') f.row.ownerId = 'another-participant'
    assert.deepEqual(await f.send(), [])
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.failures, [reason])
    assert.equal(f.writes.length, 0)
  })
}

test('restored stale snapshot needs live connection evidence before QQ probe', () => {
  const f = fixture()
  const restored = restoreEndpointState('ep', f.state)
  f.host.endpointStates.set('ep', restored)
  assert.equal(f.host.endpointGateReason('ep'), 'endpoint-offline')
  f.host.endpointStates.set('ep', stateAfterConnection(restored, true))
  assert.equal(f.host.endpointGateReason('ep'), undefined)
  assert.equal(f.host.endpointStates.get('ep').deliverable.checkedAt, f.state.deliverable.checkedAt)
})

for (const kind of ['expired-token', 'forbidden-token']) {
  test('stale QQ proactive probe still respects ' + kind, async () => {
    const f = fixture()
    f.state.initiate = kind === 'expired-token'
      ? { allowed: true, observedAt: Date.now(), expiresAt: Date.now() - 1 }
      : { allowed: false, observedAt: Date.now() }
    assert.deepEqual(await f.send(), [])
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.failures, [kind === 'expired-token' ? 'endpoint-state-expired' : 'endpoint-initiate-forbidden'])
  })
}

test('user-triggered reply keeps existing initiation-token exemption', async () => {
  const f = fixture()
  f.state.initiate = { allowed: false, observedAt: Date.now(), expiresAt: Date.now() - 1 }
  assert.equal((await f.send({ userInitiated: true })).length, 1)
  assert.equal(f.calls.length, 1)
})

test('stale WeChat deliverability remains blocked even with valid initiation token', async () => {
  const f = fixture(endpoint({ channelKind: 'wechat', platform: 'wechat', accountKey: 'wechat:100' }))
  f.state.initiate = { allowed: true, observedAt: Date.now(), expiresAt: Date.now() + 60_000 }
  assert.deepEqual(await f.send(), [])
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.failures, ['endpoint-state-expired'])
})

test('desktop health agrees with delivery/proactive gates without refreshing observations', async () => {
  const f = fixture()
  const health = async () => (await f.host.desktopEndpointHealthSnapshot()).endpoints[0]
  assert.equal((await health()).deliverable, true)
  assert.equal((await health()).initiateAllowed, true)
  f.state.initiate = { allowed: true, observedAt: Date.now(), expiresAt: Date.now() - 1 }
  assert.equal((await health()).deliverable, true)
  assert.equal((await health()).initiateAllowed, false)
  f.state.deliverable.cooldownUntil = Date.now() + 60_000
  assert.equal((await health()).deliverable, false)
  assert.equal(f.host.endpointGateReason('ep'), 'endpoint-cooldown')
  assert.equal(f.writes.length, 0)
})

test('default live-session reply still uses session send and refreshes stale endpoint after success', async () => {
  const f = fixture()
  const sessionCalls: unknown[] = []
  const session = { platform: 'onebot', selfId: '100', send: async (content: unknown) => { sessionCalls.push(content); return ['receipt'] } }
  assert.equal((await f.host.sendOutgoingMessages({ id: 's1' }, [{ participantId: 'p1', content: '实时回复', userInitiated: true }], f.participant, session)).length, 1)
  assert.deepEqual(sessionCalls, ['实时回复'])
  assert.deepEqual(f.calls, [])
  assert.equal(f.writes[0].deliverable.allowed, true)
})

test('desktop transport uses stale QQ probe and existing success refresh', async () => {
  const f = fixture()
  const desktopCalls: any[] = []
  f.host.desktopDeliveryHandler = async (request: unknown) => { desktopCalls.push(request); return { ok: true } }
  assert.equal((await f.send()).length, 1)
  assert.equal(desktopCalls[0].endpointId, 'ep')
  assert.equal(desktopCalls[0].channelId, 'private:200')
  assert.deepEqual(f.calls, [])
  assert.equal(f.writes[0].deliverable.note, undefined)
  assert.ok(f.writes[0].deliverable.checkedAt > f.state.deliverable.checkedAt)
})

test('stale QQ group endpoint uses the same gate and outbound refresh', async () => {
  const f = fixture(endpoint({ ownerKind: 'group', ownerId: '300', channelId: '300', groupId: '300' }))
  f.host.splitOutgoingMessage = () => ['消息原文']
  const result = await f.host.sendGroupMessage({ id: 's1' }, '300', '消息原文', undefined, undefined, 'ep')
  assert.equal(result.complete, true)
  assert.deepEqual(f.calls, [['300', '消息原文']])
  assert.equal(f.writes.length, 1)
  assert.ok(f.writes[0].deliverable.checkedAt > f.state.deliverable.checkedAt)
})

test('successful probe never refreshes a sibling account endpoint', async () => {
  const f = fixture()
  const sibling = endpoint({ id: 'ep-other', selfId: '999', accountKey: 'onebot:999' })
  const siblingState = staleState(sibling.id)
  f.host.endpointRows.push(sibling)
  f.host.endpointStates.set(sibling.id, siblingState)
  assert.equal((await f.send()).length, 1)
  assert.strictEqual(f.host.endpointStates.get(sibling.id), siblingState)
  assert.equal(f.writes.length, 1)
})
