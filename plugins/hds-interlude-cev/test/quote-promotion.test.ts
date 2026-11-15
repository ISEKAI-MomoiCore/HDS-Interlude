/* issue #4 回归：投递消息的中文引号层级提升（‘...’ → “...”） */
import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeAndClampVisibleContent } from '../src/service'

test('成对中文弯单引号提升为双引号', () => {
  assert.equal(
    sanitizeAndClampVisibleContent('这不就是克强经济学那个‘6亿人月入1000’换算成美元么', 2000),
    '这不就是克强经济学那个“6亿人月入1000”换算成美元么',
  )
})

test('多对单引号各自提升', () => {
  assert.equal(
    sanitizeAndClampVisibleContent('‘第一段’和‘第二段’', 2000),
    '“第一段”和“第二段”',
  )
})

test('ASCII 单引号不动（英文缩写/代码）', () => {
  assert.equal(
    sanitizeAndClampVisibleContent("I don't like it, it's fine", 2000),
    "I don't like it, it's fine",
  )
})

test('不成对的弯单引号不动', () => {
  assert.equal(
    sanitizeAndClampVisibleContent('这里有一个‘孤立的引号', 2000),
    '这里有一个‘孤立的引号',
  )
})

test('已是双引号不动', () => {
  assert.equal(
    sanitizeAndClampVisibleContent('他说“你好”', 2000),
    '他说“你好”',
  )
})

test('空内容与混合场景', () => {
  assert.equal(sanitizeAndClampVisibleContent('', 2000), '')
  assert.equal(
    sanitizeAndClampVisibleContent("don't ‘中文引号’ it's ok", 2000),
    'don’t “中文引号” it’s ok'.replace('don’t', "don't").replace('it’s', "it's"),
  )
})

test('跨 <sep/> 分段各自提升', () => {
  assert.equal(
    sanitizeAndClampVisibleContent('‘第一段’<sep/>‘第二段’', 2000),
    '“第一段”<sep/>“第二段”',
  )
})
