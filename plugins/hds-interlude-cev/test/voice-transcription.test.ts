import assert from 'node:assert/strict'
import test from 'node:test'
import { describeGroupAttachments, extractSessionAudioSources, extractSessionFileFacts, extractSessionVoiceCount, guessAudioFormat, normalizeInteraction } from '../src/service'

test('OneBot record CQ segments are recognized as incoming voice', () => {
  assert.equal(extractSessionVoiceCount({ content: '[CQ:record,file=voice.amr]' } as any), 1)
  assert.equal(extractSessionVoiceCount({ content: '普通文字' } as any), 0)
})

test('voice records resolve to OneBot file tokens for the native-audio channel', () => {
  assert.deepEqual(
    extractSessionAudioSources({ content: '[CQ:record,file=ABC.silk,url=https://example.com/v.silk]' } as any),
    ['onebot-file:ABC.silk'],
  )
  assert.deepEqual(
    extractSessionAudioSources({ content: '<audio file="xyz.amr"/>' } as any),
    ['onebot-file:xyz.amr'],
  )
  // A bare URL cannot be transcoded server-side, so it stays out of the channel.
  assert.deepEqual(
    extractSessionAudioSources({ content: '<record url="https://example.com/raw.silk"/>' } as any),
    [],
  )
  // Inline adapter audio in a model-readable container is accepted as-is.
  assert.deepEqual(
    extractSessionAudioSources({ content: '<audio src="data:audio/mp3;base64,AAAA"/>' } as any),
    ['data:audio/mp3;base64,AAAA'],
  )
  assert.deepEqual(extractSessionAudioSources({ content: '普通文字' } as any), [])
})

test('QQ audio files (<file> elements with CDN URLs) enter the native-audio channel', () => {
  const session = {
    content: '<file src="http://223.109.208.77:80/asn.com/qqdownloadftnv5?ver=2&rkey=abc" file="Mirai Post - ISKL（original mix）.mp3" file-id="fid-1" file-size="3492875" name="Mirai Post - ISKL（original mix）.mp3" size="3492875" id="fid-1"/>',
  } as any
  const sources = extractSessionAudioSources(session)
  assert.equal(sources.length, 1)
  assert.match(sources[0], /^file-url:http:\/\/223\.109\.208\.77:80\/asn\.com\/qqdownloadftnv5\?ver=2&rkey=abc#/)
  assert.ok(sources[0].endsWith(':3492875'), '体积随源携带')
  assert.ok(sources[0].includes(encodeURIComponent('Mirai Post - ISKL（original mix）.mp3')), '文件名随源携带')
  // 非音频扩展名的文件不进音频通道。
  assert.deepEqual(
    extractSessionAudioSources({ content: '<file src="https://cdn.example.com/dl?k=1" name="报告.pdf" size="1200"/>' } as any),
    [],
  )
})

test('extractSessionFileFacts reports names, sizes and audio flags without URL soup', () => {
  const facts = extractSessionFileFacts({
    content: '听听<file src="https://cdn.example.com/dl?k=1" name="demo.mp3" size="4096"/>',
  } as any)
  assert.equal(facts.length, 1)
  assert.equal(facts[0].name, 'demo.mp3')
  assert.equal(facts[0].audio, true)
  assert.equal(facts[0].size, 4096)
  const plain = extractSessionFileFacts({ content: '<file src="https://cdn.example.com/dl?k=2" name="笔记.zip" size="99"/>' } as any)
  assert.equal(plain[0].audio, false)
  // 解析失败时回退到原始正则提取。
  const fallback = extractSessionFileFacts({ content: '<file src="https://x/y.mp3" name="y.mp3" size="1"/>' } as any)
  assert.equal(fallback.length >= 1, true)
  assert.deepEqual(extractSessionFileFacts({ content: '普通文字' } as any), [])
})

test('guessAudioFormat sniffs model-readable containers from magic bytes and filename hints', () => {
  assert.equal(guessAudioFormat(Buffer.from(''), 'song.MP3'), 'mp3')
  assert.equal(guessAudioFormat(Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]), 'noext'), 'mp3')
  assert.equal(guessAudioFormat(Buffer.from([0xff, 0xfb, 0x90, 0x00]), 'noext'), 'mp3')
  assert.equal(guessAudioFormat(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE')]), 'noext'), 'wav')
  assert.equal(guessAudioFormat(Buffer.from('OggS\u0000\u0002'), 'noext'), 'ogg')
  assert.equal(guessAudioFormat(Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('ftypM4A ')]), 'noext'), 'm4a')
  assert.equal(guessAudioFormat(Buffer.from('fLaC'), 'noext'), 'flac')
  assert.equal(guessAudioFormat(Buffer.from('#!AMR\n'), 'noext'), 'amr')
  assert.equal(guessAudioFormat(Buffer.from('????')), '')
})

test('visible replies never materialize echoed attachment markup into real sends', () => {
  const runtime = { maxMessageCharacters: 500, messageSeparator: '<sep/>', minimumDelayedReplySeconds: 10, maximumDelayedReplyMinutes: 120 }
  const interaction = normalizeInteraction({
    seen: true,
    reply: { mode: 'immediate', content: '给你听听这个<file src="http://223.109.208.77/asn.com/qqdownloadftnv5?rkey=xyz" name="音频.mp3"/>还有图<img src="https://cdn/x.jpg"/>[CQ:record,file=a.mp3]' },
  }, new Date(), runtime as any)
  assert.equal(interaction?.reply.content, '给你听听这个还有图')
})

test('group inbound attachments become fact placeholders instead of URL soup', () => {
  assert.equal(
    describeGroupAttachments('看看这个<img src="https:// multimedia.qq.com.cn/download?appid=1400&rkey=SECRET"/>和<file src="http://223.109.208.77/asn.com/qqdownloadftnv5?rkey=xyz" name="demo.mp3" size="4096"/>'),
    '看看这个[图片]和[文件：demo.mp3]',
  )
  assert.equal(describeGroupAttachments('听这个[CQ:record,file=abc.silk,url=https://x/y.silk]'), '听这个[语音]')
  assert.equal(describeGroupAttachments('正常文字和[微笑]表情'), '正常文字和[微笑]表情')
})

test('blank-line boundaries in reply content become bubble separators; single line breaks stay inside one bubble', () => {
  const runtime = { maxMessageCharacters: 500, messageSeparator: '<sep/>', minimumDelayedReplySeconds: 10, maximumDelayedReplyMinutes: 120 }
  // 空行（段落边界）→ 气泡分隔
  const blank = normalizeInteraction({
    seen: true,
    reply: { mode: 'immediate', content: '在呢\n\n刚在忙，怎么了？' },
  }, new Date(), runtime as any)
  assert.equal(blank?.reply.content, '在呢<sep/>刚在忙，怎么了？')
  // 单个换行留在一条消息内：不再机械制造两段式（反定式，实测 24/24 回合精确 2.0 段）。
  const single = normalizeInteraction({
    seen: true,
    reply: { mode: 'immediate', content: '在呢\n刚在忙' },
  }, new Date(), runtime as any)
  assert.equal(single?.reply.content, '在呢\n刚在忙')
  // 已用分隔符的内容不受影响。
  const already = normalizeInteraction({
    seen: true,
    reply: { mode: 'immediate', content: '在呢<sep/>刚在忙' },
  }, new Date(), runtime as any)
  assert.equal(already?.reply.content, '在呢<sep/>刚在忙')
  // 拆条关闭时保持原样（分隔符不会被拆分，也不做转换）。
  const off = normalizeInteraction({
    seen: true,
    reply: { mode: 'immediate', content: '在呢\n\n刚在忙' },
  }, new Date(), { ...runtime, splitReplyMessages: false } as any)
  assert.equal(off?.reply.content, '在呢\n\n刚在忙')
})
