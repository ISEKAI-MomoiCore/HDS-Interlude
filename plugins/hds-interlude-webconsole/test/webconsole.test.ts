import test from 'node:test'
import assert from 'node:assert/strict'
import { LogRing } from '../src/logring'

test('LogRing 容量裁剪与过滤', () => {
  const ring = new LogRing(3)
  ring.push('info', 'a', 'one')
  ring.push('warn', 'a', 'two')
  ring.push('error', 'b', 'three')
  ring.push('info', 'a', 'four')
  const latest = ring.latest(10)
  assert.equal(latest.length, 3)
  assert.equal(latest[0].message, 'two', '超出容量的最旧条目被裁掉')
  assert.deepEqual(ring.since(0, 'warn').map(l => l.message), ['two'], 'level 过滤')
  assert.deepEqual(ring.since(0, undefined, 'b').map(l => l.message), ['three'], 'name 过滤')
  assert.deepEqual(ring.since(latest[1].seq).map(l => l.message), ['four'], 'since 增量')
})
