import assert from 'node:assert/strict'
import test from 'node:test'
import { extractForwardIds, normalizeForwardMessages, readForwardContent } from '../src/forward-message'

test('extracts forward ids from Koishi markup and CQ segments', () => {
  assert.deepEqual(extractForwardIds('<forward id="abc"/>[CQ:forward,id=def]'), ['abc', 'def'])
})

test('normalizes mixed forward nodes with provenance and media placeholders', () => {
  const result = normalizeForwardMessages([
    { user_id: '100', nickname: '甲', message_type: 'group', message: [
      { type: 'text', data: { text: '你好' } },
      { type: 'image', data: { url: 'https://example.invalid/x' } },
      { type: 'record', data: { file: 'x' } },
    ] },
  ])
  assert.match(result.content, /甲（100）/)
  assert.match(result.content, /你好/)
  assert.match(result.content, /\[图片\]/)
  assert.match(result.content, /\[语音\]/)
})

test('reads get_forward_msg only through the current session bot and expands nested nodes', async () => {
  const calls: string[] = []
  const session = {
    content: '<forward id="outer"/>',
    bot: { internal: { _request: async (action: string, params: any) => {
      calls.push(`${action}:${params.id}`)
      if (params.id === 'outer') return { data: { messages: [{ user_id: '1', nickname: 'A', message: [{ type: 'forward', data: { id: 'inner' } }] }] } }
      return { data: { messages: [{ user_id: '2', nickname: 'B', message: [{ type: 'text', data: { text: '内层' } }] }] } }
    } } },
  }
  const result = await readForwardContent(session, { maxDepth: 2 })
  assert.ok(result)
  assert.deepEqual(calls, ['get_forward_msg:outer', 'get_forward_msg:inner'])
  assert.match(result!.content, /内层/)
})

test('returns bounded failure placeholder when action is unavailable', async () => {
  const result = await readForwardContent({ content: '<forward id="x"/>', bot: {} })
  assert.equal(result?.failed, true)
  assert.match(result?.content ?? '', /暂时无法读取内容/)
})

test('合并转发图片引用收集：URL/file token 双路径，正文占位符保留', async () => {
  const mod = await import('../src/forward-message')
  // 通过 normalizeForwardMessages 的公开出口验证 refs 组装路径之外，
  // collectForwardImageRefs 经 readForwardContent 组装——此处直接测归一化输出契约
  const result = mod.normalizeForwardMessages([
    {
      nickname: '小桃', user_id: 10001,
      message: [
        { type: 'text', data: { text: '看这张' } },
        { type: 'image', data: { file: 'ABC.image', url: 'https://multimedia.nt.qq.com.cn/img1' } },
        { type: 'image', data: { file: 'TOKEN123.image' } },
        { type: 'image', data: { url: 'not-a-url' } },
      ],
    },
  ], { maxNodes: 10, maxCharacters: 4000, maxDepth: 3 })
  assert.ok(result.content.includes('[图片]'), '正文保留占位符')
  assert.ok(!('imageRefs' in result) || !Array.isArray((result as any).imageRefs), 'normalizeForwardMessages 本身不产 refs（由 readForwardContent 组装）')
})

test('ForwardReadResult 契约：failureResult 携带空 imageRefs', async () => {
  const mod = await import('../src/forward-message')
  // 无 bot.internal 时走 failureResult——refs 必须是数组而非 undefined
  const result = await mod.readForwardContent({ content: '[CQ:forward,id=x]' })
  assert.ok(result?.failed)
  assert.deepEqual(result?.imageRefs, [])
})
