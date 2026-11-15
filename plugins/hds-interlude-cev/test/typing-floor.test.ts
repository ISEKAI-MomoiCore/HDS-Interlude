import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'

/** 首条发言打字时间下限：模型耗时 < typingDelay(字数) 时补足等待，慢则立即发送。 */
function host() {
  const service = Object.create(InterludeService.prototype) as any
  service.config = {
    runtime: {
      typingBaseDelaySeconds: 1, typingCharactersPerSecond: 10, typingMaxDelaySeconds: 12, typingJitterRatio: 0,
    },
  }
  return service
}

test('fast model return waits out the typing floor for the first message', () => {
  const service = host()
  // 20 字 → floor = 1s + 20/10s = 3s；模型 0.5s 返回 → 需补 ≈2500ms（容忍执行抖动）。
  const startedAt = new Date(Date.now() - 500)
  const hold = (InterludeService.prototype as any).firstMessageTypingHoldMs.call(service, 'a'.repeat(20), startedAt)
  assert.ok(hold > 2400 && hold <= 2500, `hold=${hold}`)
})

test('slow model return sends immediately with zero hold', () => {
  const service = host()
  // 模型 5s 返回，floor 3s → 0。
  const startedAt = new Date(Date.now() - 5000)
  const hold = (InterludeService.prototype as any).firstMessageTypingHoldMs.call(service, 'a'.repeat(20), startedAt)
  assert.equal(hold, 0)
})

test('the floor is clamped by the configured maximum and never negative', () => {
  const service = host()
  // 500 字 → 名义 51s，被 maxDelay 12s 截断；模型 1s 返回 → ≈11000ms。
  const startedAt = new Date(Date.now() - 1000)
  const hold = (InterludeService.prototype as any).firstMessageTypingHoldMs.call(service, 'a'.repeat(500), startedAt)
  assert.ok(hold > 10900 && hold <= 11000, `hold=${hold}`)
  // 请求起点在未来（时钟偏差防御）：elapsed 记 0，不反向放大等待，也不产生负值。
  const future = (InterludeService.prototype as any).firstMessageTypingHoldMs.call(service, 'hi', new Date(Date.now() + 60000))
  assert.ok(future > 0 && future <= 2000, `future=${future}`)
})
