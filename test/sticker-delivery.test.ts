import assert from 'node:assert/strict'
import test from 'node:test'
import { stickerFileUrl, stickerDeliveryUrl } from '../src/service'

/* 表情包投递形态(issue #1:Docker/Linux 下 server/router 未加载,HTTP 回源
 * 路由不存在导致 retcode 1200;auto 模式须能退 file:// 本地路径)。反斜杠用
 * fromCharCode 构造,避免任何转义层吞字。 */
const BS = String.fromCharCode(92)

test('stickerFileUrl 产出三斜杠标准形(Linux/Windows/冗余斜杠)', () => {
  assert.equal(stickerFileUrl('/root/hds-koishi/data/hds-interlude/stickers/a.png'),
    'file:///root/hds-koishi/data/hds-interlude/stickers/a.png')
  assert.equal(stickerFileUrl(['C:', 'dev', 'data', 'a.png'].join(BS)),
    'file:///C:/dev/data/a.png')
  assert.equal(stickerFileUrl('///root/x.png'), 'file:///root/x.png')
})

test('stickerDeliveryUrl 默认基址与 assetId 编码不变', () => {
  assert.equal(stickerDeliveryUrl('', 'ab'), 'http://127.0.0.1:5140/hds-interlude/sticker/ab')
  assert.equal(stickerDeliveryUrl('https://x.example/', 'a b'), 'https://x.example/hds-interlude/sticker/a%20b')
})
