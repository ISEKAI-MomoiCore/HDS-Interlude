import * as qface from 'qface'

/**
 * QFace provides the long-lived system-face table through ID 348. QQ has
 * continued adding native animated faces without releasing a stable public
 * machine-readable table, so retain the newer named system entries here.
 * Unknown IDs deliberately stay unknown instead of acquiring guessed meaning.
 */
const QQ_NATIVE_FACE_NAME_EXTENSIONS: Record<string, string> = {
  349: '坚强', 350: '贴贴', 351: '敲敲', 352: '咦', 353: '拜托', 354: '尊嘟假嘟', 355: '耶', 356: '666',
  357: '裂开', 358: '骰子', 359: '包剪锤', 360: '亲亲', 361: '狗狗笑哭', 362: '好兄弟', 363: '狗狗可怜', 364: '超级赞',
  365: '狗狗生气', 366: '芒狗', 367: '狗狗疑问', 368: '奥特笑哭', 369: '彩虹', 370: '祝贺', 371: '冒泡', 372: '气呼呼',
  373: '忙', 374: '波波流泪', 375: '超级鼓掌', 376: '跺脚', 377: '嗨', 378: '企鹅笑哭', 379: '企鹅流泪', 380: '真棒',
  381: '路过', 382: 'emo', 383: '企鹅爱心', 384: '晚安', 385: '太气了', 386: '呜呜呜', 387: '太好笑', 388: '太头疼',
  389: '太赞了', 390: '太头秃', 391: '太沧桑', 392: '龙年快乐', 393: '新年中龙', 394: '新年大龙', 395: '略略略', 396: '狼狗',
  397: '抛媚眼', 398: '超级ok', 399: 'tui', 400: '快乐', 401: '超级转圈', 402: '别说话', 403: '出去玩', 404: '闪亮登场',
  405: '好运来', 406: '姐是女王', 407: '我听听', 408: '臭美', 409: '送你花花', 410: '么么哒', 411: '一起嗨', 412: '开心',
  413: '摇起来', 415: '划龙舟', 416: '中龙舟', 417: '大龙舟', 419: '火车', 420: '中火车', 421: '大火车', 424: '续标识',
  425: '求放过', 426: '玩火', 427: '偷感', 428: '收到', 429: '蛇年快乐', 430: '蛇身', 431: '蛇尾',
}

function attributeValue(attributes: string, key: string) {
  const match = new RegExp(`(?:^|[\\s,])${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes)
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

export function qqNativeFaceName(id: unknown) {
  const key = String(id ?? '').trim()
  if (!key) return undefined
  const extension = QQ_NATIVE_FACE_NAME_EXTENSIONS[key]
  if (extension) return extension
  const face = qface.get(key)
  return face?.QDes?.replace(/^\//, '').trim() || undefined
}

export function describeQQNativeFace(id: unknown) {
  const key = String(id ?? '').trim()
  if (!key) return '[QQ 原生表情（未提供 ID）]'
  const name = qqNativeFaceName(key)
  return name
    ? `[QQ 原生表情：${name}（ID: ${key}）]`
    : `[QQ 原生表情（ID: ${key}；名称未收录）]`
}

/** Convert adapter markup into stable narrator-visible meaning without asking a model to infer an icon. */
export function normalizeQQNativeFaceSegments(content: unknown) {
  return String(content ?? '')
    .replace(/<face\b([^>]*)>(?:<\/face>)?/gi, (_match, attributes: string) => describeQQNativeFace(attributeValue(attributes, 'id')))
    .replace(/\[CQ:face,([^\]]*)\]/gi, (_match, attributes: string) => describeQQNativeFace(attributeValue(attributes, 'id')))
    .replace(/<mface\b([^>]*)>(?:<\/mface>)?/gi, (_match, attributes: string) => {
      const name = attributeValue(attributes, 'summary') || attributeValue(attributes, 'name')
      return name ? `[QQ 商城表情：${name}]` : '[QQ 商城表情]'
    })
}
