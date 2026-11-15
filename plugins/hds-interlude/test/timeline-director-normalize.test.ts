import assert from 'node:assert/strict'
import test from 'node:test'
import { describeTimelinePlanRejection, normalizeTimelinePlan } from '../src/service'

test('normalizeTimelinePlan coerces string positions and near-miss kinds', () => {
  const plan = normalizeTimelinePlan({
    beats: [
      { at: '0', kind: 'activity', summary: '继续随堂练习' },
      { at: '50%', kind: 'scene', summary: '课堂进行中' },
      { at: 1, kind: '状态', summary: '窗口结束时仍在课堂' },
    ],
    carry: ['午间验收未发生'],
  })
  assert.ok(plan, '宽容解析应接受字符串 at 与别名 kind')
  assert.deepEqual(plan!.beats.map(beat => beat.at), [0, 0.5, 1])
  assert.equal(plan!.beats[1].kind, 'activity')
  assert.equal(plan!.beats[2].kind, 'state')
  assert.deepEqual(plan!.carry, ['午间验收未发生'])
})

test('normalizeTimelinePlan still rejects genuinely unusable beats', () => {
  assert.equal(normalizeTimelinePlan({ beats: [{ at: 'abc', kind: 'activity', summary: 'x' }] }), undefined)
  assert.equal(normalizeTimelinePlan({ beats: [{ at: 0.5, kind: 3, summary: 'x' }] }), undefined)
  assert.equal(normalizeTimelinePlan({ beats: [{ at: 0.5, kind: 'activity' }] }), undefined)
  assert.equal(normalizeTimelinePlan({ beats: [] }), undefined)
  assert.equal(normalizeTimelinePlan({ noBeats: true }), undefined)
  assert.equal(normalizeTimelinePlan('not an object'), undefined)
})

test('describeTimelinePlanRejection explains each rejected beat', () => {
  const reason = describeTimelinePlanRejection({
    beats: [
      { at: '0', kind: 'activity', summary: 'ok' },
      { at: 'abc', kind: 3 },
      {},
    ],
  })
  assert.match(reason, /节点校验详情/)
  assert.match(reason, /通过/)
  assert.match(reason, /at="abc" 无法解析/)
  assert.match(reason, /kind=3 非法/)
  assert.match(reason, /summary 为空/)
  assert.equal(describeTimelinePlanRejection({}), '缺少 beats 数组')
  assert.equal(describeTimelinePlanRejection({ beats: [] }), 'beats 为空数组（模型未产出任何节点）')
  assert.equal(describeTimelinePlanRejection(null), '返回不是 JSON 对象')
})
