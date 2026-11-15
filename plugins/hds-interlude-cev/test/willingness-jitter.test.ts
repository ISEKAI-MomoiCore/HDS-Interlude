/* 群聊意愿回复后跳过抖动回归：档位抖动幅度 × 节奏调制 × skipCount 递减 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consumeWillingnessGate, evaluateWillingnessGate,
  WILLINGNESS_JITTER, RHYTHM_SKIP_MODIFIER,
} from '../src/group-willingness'

const now = Date.now()

function evalGate(state: Parameters<typeof evaluateWillingnessGate>[0], messageCount: number, mentionedBot = false, random = 0.99) {
  return evaluateWillingnessGate(state, 'eager', undefined, undefined, undefined, {
    now, messageCount, content: 'hello', quotedBot: false, mentionedBot, random,
  })
}

test('WILLINGNESS_JITTER 五档幅度覆盖用户目标区间', () => {
  assert.equal(WILLINGNESS_JITTER.eager[0], 0)
  assert.equal(WILLINGNESS_JITTER.eager[1], 3)
  assert.ok(WILLINGNESS_JITTER.normal[0] <= 1 && WILLINGNESS_JITTER.normal[1] >= 6)
  assert.ok(WILLINGNESS_JITTER.quiet[0] >= 1 && WILLINGNESS_JITTER.quiet[1] >= 9)
})

test('RHYTHM_SKIP_MODIFIER 五档节奏调制', () => {
  assert.equal(RHYTHM_SKIP_MODIFIER['phone-focused'], -1)
  assert.equal(RHYTHM_SKIP_MODIFIER['available'], 0)
  assert.equal(RHYTHM_SKIP_MODIFIER['occupied'], 1)
  assert.equal(RHYTHM_SKIP_MODIFIER['resting'], 2)
  assert.equal(RHYTHM_SKIP_MODIFIER['asleep'], 3)
})

test('consumeWillingnessGate 回复后掷 skipCount(eager + phone-focused)', () => {
  const consumed = consumeWillingnessGate(undefined, 'eager', undefined, undefined, undefined, now, 'phone-focused', () => 0)
  assert.equal(consumed.skipCount, 0, 'eager+phone-focused 最低跳 0 条(可立即再回)')
})

test('consumeWillingnessGate eager + resting → 跳过数增加', () => {
  const consumed = consumeWillingnessGate(undefined, 'eager', undefined, undefined, undefined, now, 'resting', () => 0.5)
  assert.ok((consumed.skipCount ?? 0) >= 2, `eager+resting 至少跳 2 条(got ${consumed.skipCount})`)
})

test('skipCount > 0 时消息被跳过(reason: skip-jitter),@ 仍直通', () => {
  const consumed = consumeWillingnessGate(undefined, 'eager', undefined, undefined, undefined, now, undefined, () => 1)
  const skip = consumed.skipCount ?? 0
  assert.ok(skip > 0)
  // 1 条消息:skipCount 递减,不触发
  const d1 = evalGate(consumed, 1)
  assert.equal(d1.shouldCall, false)
  assert.equal(d1.reason, 'skip-jitter')
  assert.equal(d1.state.skipCount, skip - 1, '递减一条')
  // @ 直通:skipCount 存在但 mentionedBot=true → 直接触发
  const dAt = evalGate(consumed, 1, true)
  assert.equal(dAt.shouldCall, true)
  assert.equal(dAt.reason, 'forced-mention')
  // @ 不消耗 skipCount
  assert.equal(dAt.state.skipCount, skip, '@ 直通不清零跳过计数')
})

test('skipCount 递减到 0 后恢复正常评分(下一批次进入掷骰)', () => {
  const consumed = consumeWillingnessGate(undefined, 'eager', undefined, undefined, undefined, now, 'phone-focused', () => 0.5)
  const skip = consumed.skipCount ?? 0
  assert.ok(skip > 0)
  // 第一批:耗尽 skip(整批被吸收,返回 skip-jitter)
  const exhausted = evalGate(consumed, skip, false, 0.01)
  assert.equal(exhausted.reason, 'skip-jitter')
  assert.equal(exhausted.state.skipCount, 0)
  // 第二批:skipCount=0 → 正常评分(eager 低阈值,random=0.01 大概率通过)
  const d = evalGate(exhausted.state, 1, false, 0.01)
  assert.equal(d.reason, 'probability-roll', '跳过耗尽后应进入概率掷骰')
})

test('长时间沉默不清零 skipCount(由消息条数驱动,不随时钟)', () => {
  const consumed = consumeWillingnessGate(undefined, 'normal', undefined, undefined, undefined, now, 'resting', () => 0.5)
  const skip = consumed.skipCount ?? 0
  assert.ok(skip > 0)
  const later = evaluateWillingnessGate(consumed, 'eager', undefined, undefined, undefined, {
    now: now + 2 * 3_600_000, messageCount: 0, content: '', quotedBot: false, mentionedBot: false, random: 0.01,
  })
  assert.equal(later.state.skipCount, skip, '沉默不消耗 skipCount')
})
