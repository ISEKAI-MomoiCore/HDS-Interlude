import assert from 'node:assert/strict'
import test from 'node:test'
import { installDesktopBridge } from '../src/desktop-bridge'

interface MessageFrame {
  type: 'hdsi-desktop'
  event: string
  payload: any
}

function inbound(overrides: Record<string, unknown> = {}) {
  return {
    transport: 'sandbox',
    accountKey: 'sandbox:10001',
    platform: 'sandbox',
    selfId: '10001',
    senderId: '20002',
    kind: 'private',
    content: 'hello',
    occurredAt: '2026-10-04T10:00:00.000Z',
    ...overrides,
  }
}

function waitForMessage(messages: MessageFrame[], event: string, requestId?: string) {
  return new Promise<MessageFrame>((resolve, reject) => {
    const deadline = Date.now() + 2_000
    const poll = () => {
      const found = messages.find(item => item.event === event && (requestId == null || item.payload?.requestId === requestId))
      if (found) return resolve(found)
      if (Date.now() >= deadline) return reject(new Error(`等待 bridge 消息超时：${event}${requestId ? `/${requestId}` : ''}`))
      setImmediate(poll)
    }
    poll()
  })
}

async function sendCommand(command: unknown) {
  process.emit('message', command)
  await new Promise<void>(resolve => setImmediate(resolve))
}

function installFixture() {
  const messages: MessageFrame[] = []
  const received: any[] = []
  let phase = 'running'
  let desktopDeliveryHandler: ((delivery: any) => Promise<any>) | undefined
  const service = {
    setDesktopEventSink() {},
    setDesktopOnebotActionHandler() {},
    setDesktopDeliveryHandler(handler?: (delivery: any) => Promise<any>) { desktopDeliveryHandler = handler },
    getDesktopRuntimePhase() { return phase },
    async setDesktopRuntimePhase(next: string) { phase = next },
    async receiveDesktopEvent(event: any, session: any) {
      received.push(event)
      if (event.content === 'reply') await session.send('reply-body')
      return true
    },
  }

  const previousSendDescriptor = Object.getOwnPropertyDescriptor(process, 'send')
  const previousBridge = process.env.HDSI_DESKTOP_BRIDGE
  Object.defineProperty(process, 'send', {
    configurable: true,
    writable: true,
    value: (message: MessageFrame) => { messages.push(message) },
  })
  process.env.HDSI_DESKTOP_BRIDGE = '1'
  const dispose = installDesktopBridge(service as any)
  if (!dispose) throw new Error('测试 bridge 未安装。')

  return {
    messages,
    received,
    service: { get desktopDeliveryHandler() { return desktopDeliveryHandler } },
    async restore() {
      dispose()
      if (previousBridge === undefined) delete process.env.HDSI_DESKTOP_BRIDGE
      else process.env.HDSI_DESKTOP_BRIDGE = previousBridge
      if (previousSendDescriptor) Object.defineProperty(process, 'send', previousSendDescriptor)
      else delete (process as any).send
    },
  }
}

test('desktop bridge preserves traceId, creates one processingId per inbound round, and propagates it to realtime delivery', async () => {
  const fixture = installFixture()
  try {
    const firstRequestId = 'request-first'
    await sendCommand({
      type: 'hdsi-desktop', command: 'inbound',
      value: { requestId: firstRequestId, event: inbound({ content: 'reply' }) },
    })
    const firstDelivery = await waitForMessage(fixture.messages, 'delivery')
    assert.match(firstDelivery.payload.traceId, /^msg-/)
    assert.match(firstDelivery.payload.processingId, /^proc-/)
    assert.equal(firstDelivery.payload.content, 'reply-body')

    await sendCommand({
      type: 'hdsi-desktop', command: 'delivery-result',
      value: { deliveryId: firstDelivery.payload.deliveryId, status: 'sent', messageIds: ['sandbox:reply-1'] },
    })
    const firstResult = await waitForMessage(fixture.messages, 'inbound-result', firstRequestId)
    assert.equal(firstResult.payload.traceId, firstDelivery.payload.traceId)
    assert.equal(firstResult.payload.processingId, firstDelivery.payload.processingId)
    assert.equal(firstResult.payload.accepted, true)
    assert.equal(fixture.received[0].traceId, firstResult.payload.traceId)

    const secondRequestId = 'request-second'
    await sendCommand({
      type: 'hdsi-desktop', command: 'inbound',
      value: { requestId: secondRequestId, event: inbound({ content: 'no-reply', traceId: 'msg-existing' }) },
    })
    const secondResult = await waitForMessage(fixture.messages, 'inbound-result', secondRequestId)
    assert.equal(secondResult.payload.traceId, 'msg-existing')
    assert.match(secondResult.payload.processingId, /^proc-/)
    assert.notEqual(secondResult.payload.processingId, firstResult.payload.processingId)
  } finally {
    await fixture.restore()
  }
})

test('desktop bridge assigns independent context to replayed inbox records and advertises the capability', async () => {
  const fixture = installFixture()
  try {
    const ready = await waitForMessage(fixture.messages, 'bridge-ready')
    assert.equal(ready.payload.capabilities.includes('processing-context'), true)

    const requestId = 'request-replay'
    await sendCommand({
      type: 'hdsi-desktop', command: 'replay-inbox',
      value: {
        requestId,
        records: [
          { id: 'inbox-1', event: inbound({ content: 'first', traceId: 'msg-replay-1' }) },
          { id: 'inbox-2', event: inbound({ content: 'second' }) },
        ],
      },
    })
    const result = await waitForMessage(fixture.messages, 'replay-result', requestId)
    assert.equal(result.payload.results.length, 2)
    assert.equal(result.payload.results[0].traceId, 'msg-replay-1')
    assert.match(result.payload.results[1].traceId, /^msg-/)
    assert.match(result.payload.results[0].processingId, /^proc-/)
    assert.match(result.payload.results[1].processingId, /^proc-/)
    assert.notEqual(result.payload.results[0].processingId, result.payload.results[1].processingId)
  } finally {
    await fixture.restore()
  }
})

test('desktop bridge forwards persisted background correlation metadata without relying on AsyncLocalStorage', async () => {
  const fixture = installFixture()
  try {
    const handler = fixture.service['desktopDeliveryHandler']
    assert.ok(handler)
    const promise = handler({
      participantId: 'alice', selfId: '10001', platform: 'sandbox', channelId: 'private:20002',
      kind: 'private', content: 'background', traceId: 'msg-background', processingId: 'proc-background',
    })
    const delivery = await waitForMessage(fixture.messages, 'delivery')
    assert.equal(delivery.payload.traceId, 'msg-background')
    assert.equal(delivery.payload.processingId, 'proc-background')
    await sendCommand({
      type: 'hdsi-desktop', command: 'delivery-result',
      value: { deliveryId: delivery.payload.deliveryId, status: 'sent', messageIds: ['sandbox:background-1'] },
    })
    assert.deepEqual(await promise, { ok: true, messageIds: ['sandbox:background-1'] })
  } finally {
    await fixture.restore()
  }
})
