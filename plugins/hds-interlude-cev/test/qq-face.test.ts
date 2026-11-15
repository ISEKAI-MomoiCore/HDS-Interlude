import assert from 'node:assert/strict'
import test from 'node:test'
import { describeQQNativeFace, normalizeQQNativeFaceSegments, qqNativeFaceName } from '../src/qq-face'
import { InterludeService } from '../src/service'

test('known QQ system faces are translated into stable incoming semantics', () => {
  assert.equal(qqNativeFaceName('14'), '微笑')
  assert.equal(qqNativeFaceName('182'), '笑哭')
  assert.equal(qqNativeFaceName('427'), '偷感')
  assert.equal(normalizeQQNativeFaceSegments('<face id="427" platform="onebot"></face>'), '[QQ 原生表情：偷感（ID: 427）]')
  assert.equal(normalizeQQNativeFaceSegments('好吧[CQ:face,id=182]'), '好吧[QQ 原生表情：笑哭（ID: 182）]')
})

test('unknown QQ face IDs remain explicit rather than guessed', () => {
  assert.equal(describeQQNativeFace('9999'), '[QQ 原生表情（ID: 9999；名称未收录）]')
})

test('outbound native faces carry a numeric OneBot id (spec: face.id int32)', async () => {
  const sent: { type: string, id: unknown }[] = []
  const service: any = {
    serial: async (_id: string, fn: () => Promise<unknown>) => fn(),
    appendEntry: async () => ({}),
    updateScriptDeliveryOutcome: async () => {},
    reportOperation: () => {},
    report: () => {},
  }
  const session: any = {
    platform: 'qq',
    bot: { sendMessage: async (_channel: string, element: any) => { sent.push({ type: element.type, id: element.attrs.id }) } },
  }
  const ok = await (InterludeService.prototype as any).sendNativeFace.call(
    service, { id: 's' }, session, 'private:1', 'heart',
  )
  assert.equal(ok, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].type, 'face')
  assert.equal(typeof sent[0].id, 'number', 'face.id 必须是数字：字符串 id 会被严格实现的 OneBot 服务端拒绝')
  assert.equal(sent[0].id, 66)
})
