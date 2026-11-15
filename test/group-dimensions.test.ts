import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveGroupDimensions, activeProactiveGroupTargets } from '../src/group-dimensions'

/** I-6b 三维度拆分（设计 v2.4 §7.4）回归：旧 responseMode 映射、逐维覆盖、
 * 幂等解析、主动目标过滤。 */

test('I-6b 旧配置映射：mention-only → directed/mention/off；always → background/willingness/active', () => {
  assert.deepEqual(resolveGroupDimensions({ responseMode: 'mention-only' }), {
    collectionScope: 'directed', immediateTrigger: 'mention', backgroundParticipation: 'off',
  })
  assert.deepEqual(resolveGroupDimensions({ responseMode: 'always' }), {
    collectionScope: 'background', immediateTrigger: 'willingness', backgroundParticipation: 'active',
  })
  // 非法/缺失 responseMode 按现状"非 mention-only 即放行"归 always 类。
  assert.deepEqual(resolveGroupDimensions({}), resolveGroupDimensions({ responseMode: 'always' }))
  assert.deepEqual(resolveGroupDimensions({ responseMode: 'auto' }), resolveGroupDimensions({ responseMode: 'always' }))
  assert.deepEqual(resolveGroupDimensions(undefined), resolveGroupDimensions({ responseMode: 'always' }))
})

test('I-6b 逐维覆盖：显式字段优先，缺失维度仍从基线派生；幂等', () => {
  // 新组合之魂：背景采集 + 仅@触发（responseMode 仍是 mention-only 也挡不住显式维度）。
  assert.deepEqual(resolveGroupDimensions({ responseMode: 'mention-only', collectionScope: 'background' }), {
    collectionScope: 'background', immediateTrigger: 'mention', backgroundParticipation: 'off',
  })
  // 全显式三维覆盖基线。
  assert.deepEqual(resolveGroupDimensions({
    responseMode: 'always', collectionScope: 'directed', immediateTrigger: 'willingness', backgroundParticipation: 'background',
  }), {
    collectionScope: 'directed', immediateTrigger: 'willingness', backgroundParticipation: 'background',
  })
  // 非法维度值按缺失处理（回基线），不抛出。
  assert.deepEqual(resolveGroupDimensions({ responseMode: 'always', collectionScope: 'everywhere' }), {
    collectionScope: 'background', immediateTrigger: 'willingness', backgroundParticipation: 'active',
  })
  // 幂等：解析结果再解析不变。
  const once = resolveGroupDimensions({ responseMode: 'mention-only', collectionScope: 'background' })
  assert.deepEqual(resolveGroupDimensions(once), once)
})

test('I-6b 主动目标：仅 active 参与的启用群；mention-only 旧映射被排除', () => {
  const rules = [
    { groupId: 'group:100', label: '活跃群', enabled: true, responseMode: 'always' },
    { groupId: '200', label: '定向群', enabled: true, responseMode: 'mention-only' },
    { groupId: 'group:300', label: '显式主动', enabled: true, responseMode: 'mention-only', backgroundParticipation: 'active' },
    { groupId: '400', label: '已停用', enabled: false, responseMode: 'always' },
    { groupId: '', label: '无群号', enabled: true, responseMode: 'always' },
  ]
  const targets = activeProactiveGroupTargets(rules)
  // mention-only 群(200)不再作为主动目标——此前 enabled 即可，属隐式泄漏。
  assert.deepEqual(targets.map(item => item.groupId), ['100', '300'])
  assert.equal(targets[0].label, '活跃群')
})
