import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeInterludeSpacing } from '../src/index'

const registered = new Set([
  'interlude', 'interlude.script', 'interlude.script.note',
  'interlude.memory', 'interlude.memory.apply', 'interlude.memory.reject',
  'interlude.story', 'interlude.story.endpoint',
  'interlude.preset', 'interlude.preset.sync',
])
const isRegistered = (name: string) => registered.has(name)

test('空格形式归一化为点分(贪心取最长命中)', () => {
  // 核心场景:中间层 interlude.script 声明了参数,空格写法原本会路由到它
  assert.equal(normalizeInterludeSpacing('interlude script note 写入一条注记', isRegistered), 'interlude.script.note 写入一条注记')
  assert.equal(normalizeInterludeSpacing('interlude memory apply 5', isRegistered), 'interlude.memory.apply 5')
  assert.equal(normalizeInterludeSpacing('interlude story endpoint add onebot 123456', isRegistered), 'interlude.story.endpoint add onebot 123456')
})

test('本就命中中间命令的空格写法保持语义不变', () => {
  // interlude.memory 有自己的用户级 action,limit 是它的参数,不应吃掉
  assert.equal(normalizeInterludeSpacing('interlude memory 5', isRegistered), 'interlude.memory 5')
  assert.equal(normalizeInterludeSpacing('interlude script 20', isRegistered), 'interlude.script 20')
})

test('前缀保留;点分写法/未知子命令/裸命令不动', () => {
  assert.equal(normalizeInterludeSpacing('/interlude preset sync', isRegistered), '/interlude.preset.sync')
  assert.equal(normalizeInterludeSpacing('interlude.script.note 内容', isRegistered), undefined)
  assert.equal(normalizeInterludeSpacing('interlude', isRegistered), undefined)
  assert.equal(normalizeInterludeSpacing('interlude 不存在的东西 x', isRegistered), undefined)
  assert.equal(normalizeInterludeSpacing('今天聊聊 interlude script note', isRegistered), undefined)
})
