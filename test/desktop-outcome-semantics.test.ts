import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import type { StickerAsset } from '../src/service'

// 审计 P1-2/P1-3：桌面桥接的结果未知状态传播。
// - 群消息 desktop 路径 outcome.transportTimeout → segment reason 加
//   transport-timeout: 前缀 → 账本映射记 pending（消息可能已发出）。
// - 贴纸/原生表情 desktop 动作 outcome.ambiguous → 账本记 pending（平台动作
//   不在补偿回放的 kind 过滤内，无自动重发/重复风险）。

const REFERENCE = { eventId: 'evt-1', segmentIndex: 0, commitId: 'c1' }

function groupSvc(handlerOutcome: { ok: false, transportTimeout?: boolean, error?: string }) {
  const reported: Array<{ level: string, message: string }> = []
  const svc = {
    desktopDeliveryHandler: async () => handlerOutcome,
    ensureEndpointRegistry: async () => {},
    endpointRows: [] as unknown[],
    endpointAddressSync: () => ({ platform: 'onebot', selfId: '10001' }),
    ctx: { bots: [] },
    noteEndpointOutbound: () => {},
    report: (level: string, _story: unknown, _phase: unknown, message: string, ...args: unknown[]) => {
      reported.push({ level, message: message + ' ' + args.map(String).join(' ') })
    },
    splitOutgoingMessage: (content: string) => [content],
  } as unknown as InterludeService
  return { svc, reported }
}

test('P1-2 群消息 desktop 超时：segment 带 transport-timeout 前缀且日志为 warn（结果未知）', async () => {
  const { svc, reported } = groupSvc({ ok: false, transportTimeout: true, error: '等待 typ-0 渠道投递确认超时。' })
  const outcome = await (InterludeService.prototype as any).sendGroupMessage.call(
    svc,
    { id: 's', status: 'active', setting: { character: { name: '角色' } } }, // story
    '123456',                                                               // channelId
    '在吗',                                                                 // content
    undefined, undefined, undefined, undefined, undefined,                  // replyTo/session/endpoint/correlation/control
  )
  assert.equal(outcome.segmentOutcomes.length, 1)
  const segment = outcome.segmentOutcomes[0]
  assert.equal(segment.status, 'failed')
  assert.match(segment.reason, /^transport-timeout:/, 'reason 携带 unknown 前缀（账本映射据此记 pending）')
  assert.equal(outcome.complete, false)
  assert.ok(reported.some(r => r.level === 'warn' && r.message.includes('结果未知')), '结果未知用 warn 而非 error')

  // 对照：确定失败 → 无前缀 + error 级
  const { svc: svc2, reported: reported2 } = groupSvc({ ok: false, error: '账号被封' })
  const outcome2 = await (InterludeService.prototype as any).sendGroupMessage.call(
    svc2, { id: 's', status: 'active', setting: { character: { name: '角色' } } }, '123456', '在吗',
    undefined, undefined, undefined, undefined, undefined, undefined,
  )
  assert.doesNotMatch(outcome2.segmentOutcomes[0].reason, /^transport-timeout:/)
  assert.ok(reported2.some(r => r.level === 'error'), '确定失败用 error 级')
})

test('P1-2 账本映射：transport-timeout 前缀的 failed segment 记 pending（提取的谓词语义）', () => {
  // 与 sendCrossGroupMessage 内联映射同语义的谓词验证（回归锚定）
  const ledgerStatus = (segment: { status: string, reason?: string }, failureStatus: string) =>
    segment.status === 'failed' && (failureStatus === 'pending' || segment.reason === 'delivery-generation-obsolete' || (segment.reason?.startsWith('transport-timeout') ?? false))
      ? 'pending' : segment.status
  assert.equal(ledgerStatus({ status: 'failed', reason: 'transport-timeout:等待 typ-0 渠道投递确认超时。' }, 'failed'), 'pending')
  assert.equal(ledgerStatus({ status: 'failed', reason: '账号被封' }, 'failed'), 'failed')
  assert.equal(ledgerStatus({ status: 'failed', reason: 'delivery-generation-obsolete' }, 'failed'), 'pending')
  assert.equal(ledgerStatus({ status: 'failed', reason: 'x' }, 'pending'), 'pending')
  assert.equal(ledgerStatus({ status: 'delivered' }, 'failed'), 'delivered')
})

function actionSvc(outcome: { ok: false, ambiguous?: boolean, error?: string }) {
  const recorded: Array<{ status: string, reason?: string }> = []
  const reported: string[] = []
  const svc = {
    desktopOnebotActionHandler: async () => outcome,
    stickerConfig: { directory: 'stickers' },
    ctx: { baseDir: process.cwd() },
    serial: async (fn: () => Promise<unknown>) => fn(),
    appendEntry: async () => {},
    updateScriptDeliveryOutcome: async () => {},
    recordPlatformDeliveryOutcome: async (_sid: string, _ref: unknown, status: string, reason?: string) => { recorded.push({ status, reason }) },
    report: (_level: string, _story: unknown, _phase: unknown, message: string, ...args: unknown[]) => { reported.push(message + ' ' + args.map(String).join(' ')) },
    reportOperation: () => {},
  } as unknown as InterludeService
  return { svc, recorded, reported }
}

const ASSET: Partial<StickerAsset> = { assetId: 'a1', filePath: 'cat.png', status: 'active', description: '猫猫', mimeType: 'image/png' }

async function callSticker(svc: InterludeService) {
  return (InterludeService.prototype as any).sendSticker.call(
    svc,
    { id: 's', status: 'active', setting: { character: { name: '角色' } } },
    { selfId: '10001', platform: 'onebot' },
    'private:20002',
    ASSET,
    undefined,
    REFERENCE,
  )
}

async function callFace(svc: InterludeService) {
  return (InterludeService.prototype as any).sendNativeFace.call(
    svc,
    { id: 's', status: 'active', setting: { character: { name: '角色' } } },
    { selfId: '10001', platform: 'onebot' },
    'private:20002',
    'smile',
    undefined,
    REFERENCE,
  )
}

test('P1-3 贴纸动作 ambiguous：账本记 pending、不自动重试、日志说明结果未知', async () => {
  const { svc, recorded, reported } = actionSvc({ ok: false, ambiguous: true, error: '等待宿主动作代理回执超时。' })
  const ok = await callSticker(svc)
  assert.equal(ok, false)
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].status, 'pending', 'ambiguous → pending（不是 failed）')
  assert.match(recorded[0].reason ?? '', /^ambiguous:/)
  assert.ok(reported.some(r => r.includes('结果未知') && r.includes('不自动重试')), '日志明示结果未知且不自动重试')

  // 对照：确定失败 → failed
  const fail = actionSvc({ ok: false, error: '参数非法' })
  await callSticker(fail.svc)
  assert.equal(fail.recorded[0].status, 'failed')
})

test('P1-3 原生表情动作 ambiguous：同语义记 pending', async () => {
  const { svc, recorded, reported } = actionSvc({ ok: false, ambiguous: true, error: '桥已关闭。' })
  const ok = await callFace(svc)
  assert.equal(ok, false)
  assert.equal(recorded[0].status, 'pending', 'ambiguous → pending')
  assert.ok(reported.some(r => r.includes('结果未知')))

  const fail = actionSvc({ ok: false, error: 'face id 无效' })
  await callFace(fail.svc)
  assert.equal(fail.recorded[0].status, 'failed')
})
