import assert from 'node:assert/strict'
import test from 'node:test'
import { formatLayeredLog } from '../src/logging'

test('user-message logs read as a compact task timeline', () => {
  const received = formatLayeredLog({
    level: 'info', phase: 'user-message', protagonist: '水濑', colors: false,
    message: '收到参与者私聊消息 参与者=%s', args: ['1319973221'],
  })
  assert.equal(received, [
    '[用户消息] 水濑 (*^▽^*) 收到参与者私聊消息',
    '└─ 参与者: 1319973221',
  ].join('\n'))

  const started = formatLayeredLog({
    level: 'info', phase: 'user-message', protagonist: '水濑', colors: false,
    message: '模型调用开始 任务=主叙事 模型=%s', args: ['Narrative'],
  })
  assert.equal(started, [
    '├─ (•̀ᴗ•́)و 模型调用开始',
    '   ├─ 任务: 主叙事',
    '   └─ 模型: Narrative',
  ].join('\n'))
})

test('Alter and error records use stable semantic markers', () => {
  const alter = formatLayeredLog({
    level: 'info', phase: 'user-message', protagonist: '水濑', colors: false,
    message: 'Alter 累积触发 数值=%s 阈值=%s', args: ['+12.5', '10.3'],
  })
  assert.match(alter, /^\[情绪追踪\] 水濑 \(๑•̀ㅂ•́\)و✧ Alter 累积触发/m)
  assert.match(alter, /数值: \+12\.5/)
  assert.match(alter, /阈值: 10\.3/)

  const failure = formatLayeredLog({
    level: 'warn', phase: 'user-message', protagonist: '水濑', colors: false,
    message: '模型调用失败 任务=主叙事 错误=%s', args: ['返回无效 JSON'],
  })
  assert.match(failure, /^\[用户消息\] 水濑 \(˶ˊᜊˋ˶\) 模型调用失败/m)
  assert.match(failure, /错误: 返回无效 JSON/)
})

test('colors can be enabled and kaomoji can be replaced by simple symbols', () => {
  const colored = formatLayeredLog({
    level: 'info', phase: 'intent-due', protagonist: '水濑', colors: true,
    message: '消息投递开始 参与者=1319973221',
  })
  assert.match(colored, /\u001b\[[0-9]+m/)
  assert.match(colored, /\(・ω・\)ノ/)

  const symbols = formatLayeredLog({
    level: 'warn', protagonist: 'HDSI', standalone: true, colors: false, kaomoji: false,
    message: '叙事模型请求失败，已安排自动重试 第2\/6次',
  })
  assert.match(symbols, /^\[自动重试\] HDSI ↻/)
})

test('dark and light themes use separate high-contrast 256-color palettes', () => {
  const input = {
    level: 'info' as const,
    phase: 'user-message' as const,
    protagonist: '水濑',
    colors: true,
    message: '收到参与者私聊消息 参与者=1319973221',
  }
  const dark = formatLayeredLog({ ...input, colorTheme: 'dark' })
  const light = formatLayeredLog({ ...input, colorTheme: 'light' })
  assert.match(dark, /\u001b\[38;5;81m\[用户消息\]/)
  assert.match(light, /\u001b\[38;5;25m\[用户消息\]/)
  assert.notEqual(dark, light)
})

test('Agency decisions have a distinct subjectivity marker', () => {
  const output = formatLayeredLog({
    level: 'info', phase: 'advance', protagonist: '水濑', colors: false,
    message: 'Agency 主动联系判断 参与者=friend 结果=稍后重查 原因=schedule-occupied 意愿=0.80',
  })
  assert.match(output, /ᕙ\( •̀ ᗜ •́ \)ᕗ/)
})
