/** 媒体加载：原生音频（SnowLuma 转码获取）、原生图片（获取/重定向穿透/缓存/降采样/动图帧）、
 * 视觉侧端描述、事件文本投影（describeUserEvent）与 QQ 合并转发读取。
 * 会话内容提取纯函数在 session-platform/chat-artifacts。
 *
 * P8-S2 自 service.ts 迁出（2026-10-29），行为不变；函数接收宿主（service
 * 或测试假宿主）为第一参数，service 保留同名薄委托。死图源记录与缓存
 * 容器留守 service，经宿主引用读写。 */
import { type Session } from 'koishi'
import { extractSessionAudioSources, extractSessionFileFacts, extractSessionImageSources, guessAudioFormat, guessImageMime, isAnimatedImageMime, withTimeout, mergeForwardContent } from './session-platform'
import { isContextDisposedError } from './narrator'
import { normalizeQQNativeFaceSegments } from './qq-face'
import { describeQuotedMessage, } from './chat-artifacts'
import { extractForwardIds, readForwardContent, type ForwardReadResult } from './forward-message'
import { shouldDownscaleImage, clip } from './narrative-normalizers'
import { describeHttpError } from './http-proxy'

import { readFile } from 'node:fs/promises'
import type { InterludeStory, NarrativeImage, NarrativeAudio } from './types'

// Only QQ/OneBot CDN hosts are fetched in the native-vision path. This keeps
// arbitrary user-provided URLs from becoming an internal-network fetch proxy.
/** P8-S2：自 service.ts 迁入（2026-10-29），行为不变。 */
export function isTrustedImageHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const allowed = ['gchat.qpic.cn', 'c2cpicdw.qpic.cn', 'multimedia.nt.qq.com.cn', 'thirdqq.qlogo.cn', 'q.qlogo.cn', 'gxh.vip.qq.com']
  return allowed.some(domain => host === domain || host.endsWith(`.${domain}`))
}

/** Log only the acquisition channel and host. OneBot file identifiers and QQ
 * CDN URLs can contain expiring tokens, so the original source must never be
 * copied into an operational log line. */
export function describeImageSource(source: string) {
  const value = String(source ?? '').trim()
  if (value.startsWith('onebot-file:')) return 'onebot-file'
  if (value.startsWith('onebot-url:')) {
    const nested = value.slice('onebot-url:'.length)
    try { return `onebot-url:${new URL(nested).hostname}` } catch { return 'onebot-url:invalid' }
  }
  if (/^data:image\//i.test(value)) return 'inline-data'
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return `${url.protocol.slice(0, -1)}:${url.hostname}`
  } catch { /* keep the source opaque */ }
  return 'invalid'
}

/** QQ CDN 下载链接过期签名：HTTP 400 + retcode -5503007 / "download url has
 * expired"。此状态对该 URL 永久成立（令牌已失效，不会恢复），与限流或瞬时
 * 网络错误不同，因此值得与其它 4xx 区分开来单独缓存。 */
export function isExpiredImageUrlError(error: unknown) {
  if (!(error instanceof Error)) return false
  const response = (error as { response?: unknown }).response
  const status = response && typeof response === 'object' && typeof (response as { status?: unknown }).status === 'number'
    ? (response as { status: number }).status
    : undefined
  if (status !== 400) return false
  const data = response && typeof response === 'object' ? (response as { data?: unknown }).data : undefined
  const body = typeof data === 'string' ? data : typeof data === 'object' && data !== null ? JSON.stringify(data) : ''
  return body.includes('url has expired') || body.includes('-5503007')
}

/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function describeUserEvent(svc: any, story: InterludeStory, session: Session, forward?: ForwardReadResult) {
    const visual = svc.describeVisionEvent(session)
    // 合并转发内的图片并入本轮视觉输入（正文占位符已由 mergeForwardContent 保留）
    const sources = forward?.imageRefs?.length
      ? Array.from(new Set([...visual.sources, ...forward.imageRefs]))
      : visual.sources
    const audioSources = extractSessionAudioSources(session)
    const files = extractSessionFileFacts(session)
    const audioFiles = files.filter(file => file.audio)
    const plainFiles = files.filter(file => !file.audio)
    let content = visual.content
    if (forward) content = mergeForwardContent(content, forward.content)
    if (!content) {
      content = visual.sources.length ? '[用户发送了图片；图片内容以本轮视觉输入为准，未提供视觉内容时保持未知。]'
        : audioSources.length ? audioFiles.length
          ? `[用户发送了音频文件：${audioFiles.map(file => file.name || '音频文件').join('、')}；音频内容以本轮原生音频输入为准，未提供音频内容时保持未知。]`
          : '[用户发送了一条语音；语音内容以本轮原生音频输入为准，未提供音频内容时保持未知。]'
          : plainFiles.length ? `[用户发送了文件：${plainFiles.map(file => file.name || '未命名文件').join('、')}；文件内容未知。]`
            : ''
    } else if (plainFiles.length) {
      // 有文字时音频走原生通道（currentEvent.audioCount），普通文件没有
      // 独立通道，必须以文字事实补记，否则模型不知道有文件到达。
      content = `${content}\n[用户同时发送了文件：${plainFiles.map(file => file.name || '未命名文件').join('、')}；文件内容未知。]`
    }
    return {
      content,
      sources,
      audioSources,
      quote: describeQuotedMessage(session, story.setting.character.name),
    }
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function readForward(svc: any, session: Session) {
    if (!extractForwardIds(session.content).length) return undefined
    if (svc.config.runtime.forwardMessage?.enabled === false) return undefined
    const result = await readForwardContent(session, svc.config.runtime.forwardMessage)
    if (result?.failed) svc.reportStandaloneOperation('diagnostic', 'warn', '合并转发读取失败 平台=%s 机器人ID=%s 用户ID=%s%s', session.platform, session.selfId, session.userId, result.cause ? ` 原因=${clip(result.cause, 120)}` : '')
    else if (result?.nestedFailed) svc.reportStandaloneOperation('diagnostic', 'warn', '合并转发部分嵌套内容读取失败 次数=%d（正文以占位符降级） 平台=%s', result.nestedFailed, session.platform)
    else if (result) svc.reportStandaloneOperation('diagnostic', 'debug', '合并转发读取完成 节点=%d 嵌套=%d 截断=%s', result.nodeCount, result.forwardCount, result.truncated)
    return result
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function loadNativeAudio(svc: any, story: InterludeStory, sources: string[], session?: Session, maxCount?: number) {
    if (maxCount === undefined) maxCount = svc.audioConfig.maxPerMessage
    const config = svc.audioConfig
    if (!config.enabled || !sources.length) return []
    const audio: NarrativeAudio[] = []
    for (const [index, source] of sources.slice(0, Math.min(config.maxPerMessage, Math.max(0, maxCount))).entries()) {
      try {
        const item = await svc.fetchNativeAudio(source, session)
        if (item) audio.push({ id: `turn-audio-${index + 1}`, ...item })
      } catch (error) {
        svc.report('warn', story, 'user-message', '语音读取失败，已保留语音事实 错误=%s', error)
      }
    }
    return audio
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function fetchNativeAudio(svc: any, source: string, session?: Session) {
    const config = svc.audioConfig
    const format = config.outFormat ?? 'mp3'
    const value = String(source ?? '').trim()
    if (value.startsWith('onebot-file:')) {
      const file = value.slice('onebot-file:'.length)
      const internal = (session as any)?.bot?.internal
      if (!file || typeof internal?._request !== 'function') return undefined
      const response = await withTimeout(
        Promise.resolve(internal._request('get_record', { file, out_format: format })),
        30_000,
      ) as any
      if (response?.retcode != null && Number(response.retcode) !== 0) throw new Error(String(response?.wording || response?.message || `retcode=${response.retcode}`))
      if (response?.status && response.status !== 'ok') throw new Error(String(response?.wording || response?.message || response.status))
      const data = response?.data ?? response
      const base64 = typeof data?.base64 === 'string' ? data.base64.replace(/\s+/g, '') : ''
      if (!base64) throw new Error('SnowLuma get_record returned no transcoded payload')
      if (Buffer.byteLength(base64, 'base64') > config.maxFileSizeMB * 1024 * 1024) return undefined
      return { format, base64 }
    }
    if (value.startsWith('file-url:')) {
      // QQ 音频文件的 CDN 直链（带 rkey，短期有效）：原始字节可直接喂给
      // 模型；格式用文件名扩展 + 魔数双保险，避免把 SILK 语音误当文件。
      const payload = value.slice('file-url:'.length)
      const split = payload.lastIndexOf('#')
      const url = (split > 0 ? payload.slice(0, split) : payload).trim()
      const fragment = split > 0 ? payload.slice(split + 1) : ''
      const name = fragment ? decodeURIComponent(fragment.replace(/:\d+$/, '')) : ''
      const declaredSize = Number(/:(\d+)$/.exec(fragment)?.[1] ?? 0)
      if (!/^https?:\/\//i.test(url)) return undefined
      // 只信任 QQ/OneBot CDN 域名(与图片通道同一白名单):file-url 来自适配器
      // 数据,无白名单时会成为任意内网地址的请求代理
      try {
        if (!isTrustedImageHost(new URL(url).hostname)) return undefined
      } catch { return undefined }
      if (declaredSize > config.maxFileSizeMB * 1024 * 1024) return undefined
      const bytes = Buffer.from(await withTimeout(
        Promise.resolve(svc.ctx.http.get(url, { responseType: 'arraybuffer' })), 30_000,
      ))
      if (!bytes.length || bytes.length > config.maxFileSizeMB * 1024 * 1024) return undefined
      const format = guessAudioFormat(bytes, name)
      if (!format) return undefined
      return { format, base64: bytes.toString('base64') }
    }
    if (/^data:audio\//i.test(value)) {
      // Adapter-provided inline audio: accept only formats models can read.
      const match = /^data:audio\/([a-z0-9]+);base64,([a-z0-9+/=\s]+)$/i.exec(value)
      const inlineFormat = (match?.[1] || '').toLowerCase()
      if (!match || !['mp3', 'wav', 'ogg', 'm4a', 'flac', 'amr'].includes(inlineFormat)) return undefined
      const base64 = match[2].replace(/\s+/g, '')
      if (!base64 || Buffer.byteLength(base64, 'base64') > config.maxFileSizeMB * 1024 * 1024) return undefined
      return { format: inlineFormat, base64 }
    }
    // Plain http(s) record URLs serve raw SILK; without a file token there is
    // no server-side transcode path, so the attachment is skipped deliberately.
    return undefined
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function describeVisionEvent(svc: any, session: Session) {
    void svc // 形态统一
    const raw = String(session.content ?? '')
    const sources = extractSessionImageSources(session)
    const text = normalizeQQNativeFaceSegments(raw)
      .replace(/<\/?(?:img|image|audio|record|file)\b[^>]*>/gi, '')
      .replace(/\[CQ:(?:image|record|file),[^\]]*\]/gi, '')
      .trim()
    // The attachment itself is passed through the native multimodal channel.
    // Keep ordinary text free of image placeholders: a failed/filtered fetch
    // must look like no visual input rather than an invitation to invent one.
    const content = text
    return { content, sources }
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function loadNativeImages(svc: any, story: InterludeStory, sources: string[], session?: Session) {
    if (!svc.config?.model?.vision?.enabled || !sources.length) return []
    const images: NarrativeImage[] = []
    for (const [index, source] of sources.slice(0, 3).entries()) {
      const deadReason = svc.deadImageSourceReason(source)
      if (deadReason !== undefined) {
        svc.reportOperation('diagnostic', 'debug', story, 'user-message', '当前图片跳过：来源已判死(原因=%s) 序号=%d 来源=%s', deadReason, index + 1, describeImageSource(source))
        continue
      }
      try {
        const image = await svc.fetchNativeImage(source, (session as any)?.bot)
        if (image) images.push({ id: `turn-image-${index + 1}`, ...image })
        else svc.report('warn', story, 'user-message', '当前图片回源失败 阶段=current-image-fetch 序号=%d 来源=%s 原因=%s', index + 1, describeImageSource(source), svc.deadImageSourceReason(source) ?? 'empty-or-unsupported')
      } catch (error) {
        // 重载窗口内 ctx.http 必然中止：静默放弃剩余图片。
        if (isContextDisposedError(error)) break
        svc.report('warn', story, 'user-message', '当前图片回源失败 阶段=current-image-fetch 序号=%d 来源=%s 错误=%s', index + 1, describeImageSource(source), describeHttpError(error))
      }
    }
    return images
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function describeCurrentImages(svc: any, story: InterludeStory, images: NarrativeImage[], userMessage: string | undefined) {
    if (!images.length) return undefined
    if (!svc.visionDescriber.available()) {
      svc.reportOperation('diagnostic', 'warn', story, 'user-message', '侧端识图跳过：没有配置 useForVision 的视觉模型')
      return undefined
    }
    try {
      const observations = await svc.visionDescriber.describeImages(images, userMessage, svc.config.model.vision?.detail ?? 'auto')
      if (observations?.length) {
        svc.reportOperation('diagnostic', 'debug', story, 'user-message', '侧端识图完成 图片=%d 观察=%d', images.length, observations.length)
      } else {
        svc.reportOperation('diagnostic', 'warn', story, 'user-message', '侧端视觉未返回内容 阶段=sidecar-vision 图片=%d，已继续处理文字消息', images.length)
      }
      return observations
    } catch (error) {
      if (isContextDisposedError(error)) {
        svc.reportOperation('diagnostic', 'debug', story, 'user-message', '插件重载中，侧端识图放弃 图片=%d', images.length)
        return undefined
      }
      svc.reportOperation('diagnostic', 'warn', story, 'user-message', '侧端视觉请求失败 阶段=sidecar-vision 图片=%d 错误=%s，已继续处理文字消息', images.length, describeHttpError(error))
      return undefined
    }
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function isExpiredImageSource(svc: any, source: string) {
    void svc // 形态统一
    return svc.deadImageSources.has(String(source ?? '').trim())
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function deadImageSourceReason(svc: any, source: string) {
    void svc // 形态统一
    return svc.deadImageSources.get(String(source ?? '').trim())
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export function rememberDeadImageSource(svc: any, source: string, reason: string) {
    const key = String(source ?? '').trim()
    if (!key) return
    if (svc.deadImageSources.size >= 1000) {
      const oldest = svc.deadImageSources.keys().next().value
      if (oldest !== undefined) svc.deadImageSources.delete(oldest)
    }
    svc.deadImageSources.set(key, reason)
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function fetchNativeImage(svc: any, source: string, bot?: any, adapterProvided = false) {
    const key = String(source ?? '').trim()
    if (svc.isExpiredImageSource(key)) return undefined
    try {
      return await svc.fetchNativeImageUncached(key, bot, adapterProvided)
    } catch (error) {
      if (isExpiredImageUrlError(error)) {
        svc.rememberDeadImageSource(key, 'url-expired')
        return undefined
      }
      throw error
    }
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function fetchImageThroughRedirects(svc: any, url: URL, adapterProvided: boolean) {
    let target = url
    for (let hop = 0; hop < 3; hop++) {
      const response = await svc.ctx.http('GET', target.href, { responseType: 'arraybuffer', timeout: 10_000, redirect: 'manual' })
      const status = Number((response as { status?: unknown }).status ?? 200)
      if (status >= 300 && status < 400) {
        const location = response.headers?.get('location')
        if (!location) throw new Error(`image redirect without Location (HTTP ${status})`)
        let next: URL
        try { next = new URL(location, target) } catch { throw new Error(`image redirect Location invalid: ${clip(location, 120)}`) }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error(`image redirect to unsupported protocol ${next.protocol}`)
        if (!adapterProvided && !isTrustedImageHost(next.hostname)) {
          svc.rememberDeadImageSource(target.href, 'untrusted-redirect')
          throw new Error(`image redirect to untrusted host ${next.hostname}`)
        }
        target = next
        continue
      }
      return response as { data: ArrayBuffer, headers: { get(name: string): string | null } }
    }
    throw new Error('image redirect chain too long (>3 hops)')
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function fetchNativeImageUncached(svc: any, source: string, bot?: any, adapterProvided = false) {
    const value = String(source ?? '').trim()
    if (value.startsWith('onebot-url:')) {
      const url = value.slice('onebot-url:'.length)
      const image = await svc.fetchNativeImage(url, bot, true)
      // 内层 URL 判死时同步判死外层带前缀的 key：否则(合并转发引用的
      // 常态形态)每轮外层 miss→解包→内层命中负缓存→误报 empty-or-unsupported。
      if (!image) {
        const innerReason = svc.deadImageSourceReason(url)
        if (innerReason !== undefined) svc.rememberDeadImageSource(value, innerReason)
      }
      return image
    }
    // onebot-file: 无 bot 属于会话缺失(可能恢复),不判死。
    if (value.startsWith('onebot-file:')) {
      const file = value.slice('onebot-file:'.length)
      if (!file || !bot?.getImage) return undefined
      const info = await bot.getImage(file)
      const candidates = [info?.url, info?.file, info?.path].map(item => String(item ?? '').trim()).filter(Boolean)
      for (const candidate of candidates) {
        if (/^https?:\/\//i.test(candidate)) {
          const image = await svc.fetchNativeImage(candidate, undefined, true)
          if (image) return image
        } else {
          try {
            const bytes = await readFile(candidate)
            const image = await svc.imageBytesToNative(bytes, guessImageMime(bytes, info?.type))
            if (image) return image
          } catch { /* adapter may return a non-local alias; try its next field */ }
        }
      }
      return undefined
    }
    if (/^data:image\//i.test(value)) {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value)
      if (!match) { svc.rememberDeadImageSource(value, 'malformed-data-uri'); return undefined }
      const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
      if (bytes.length > 4 * 1024 * 1024) { svc.rememberDeadImageSource(value, 'oversized-data-uri'); return undefined }
      if (!bytes.length) return undefined
      const mimeType = match[1].toLowerCase()
      return svc.imageBytesToNative(bytes, mimeType)
    }
    let url: URL
    try { url = new URL(value) } catch { svc.rememberDeadImageSource(value, 'invalid-source'); return undefined }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { svc.rememberDeadImageSource(value, 'invalid-source'); return undefined }
    if (!adapterProvided && !isTrustedImageHost(url.hostname)) { svc.rememberDeadImageSource(value, 'untrusted-host'); return undefined }
    const response = await svc.fetchImageThroughRedirects(url, adapterProvided)
    const bytes = Buffer.from(response.data)
    // 超限是确定性失败(该 URL 的图片就是这个大小);空响应可能是瞬时抖动,不判死。
    if (bytes.length > 4 * 1024 * 1024) { svc.rememberDeadImageSource(value, 'oversized-download'); return undefined }
    if (!bytes.length) return undefined
    const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || guessImageMime(bytes)
    if (!mimeType.startsWith('image/')) { svc.rememberDeadImageSource(value, 'non-image-content'); return undefined }
    return svc.imageBytesToNative(bytes, mimeType)
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function imageBytesToNative(svc: any, bytes: Buffer, mimeType: string) {
    const normalized = String(mimeType || guessImageMime(bytes) || '').toLowerCase()
    if (!normalized.startsWith('image/')) return undefined
    const dataUri = `data:${normalized};base64,${bytes.toString('base64')}`
    if (isAnimatedImageMime(normalized)) {
      const frame = await svc.renderAnimatedImageFrame(dataUri)
      if (frame) return frame
      // 配置建议只需提醒一次——每张动态图都刷一遍 warn 是噪音。
      if (!svc.puppeteerHintLogged) {
        svc.puppeteerHintLogged = true
        svc.reportStandalone('warn', '动态图片未能抽帧，已使用原始图片输入；请启用 Puppeteer 以提高识别兼容性。')
      }
    }
    const scaled = await svc.downscaleImageForVision({ mimeType: normalized, dataUri })
    return scaled ?? { mimeType: normalized, dataUri }
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function downscaleImageForVision(svc: any, image: { mimeType: string, dataUri: string }) {
    const maxDimension = svc.config.model.vision?.maxImageDimension ?? 0
    if (!maxDimension || !shouldDownscaleImage(image.mimeType, image.dataUri)) return undefined
    const puppeteer = (svc.ctx as any).puppeteer
    if (!puppeteer?.page) return undefined
    return svc.withBrowserSlot(async () => {
      let page: any
      try {
        page = await puppeteer.page()
        await page.setViewport({ width: maxDimension, height: maxDimension, deviceScaleFactor: 1 })
        await page.setContent(`<img id="hdsi-vision" src="${image.dataUri}" style="display:block;max-width:${maxDimension}px;max-height:${maxDimension}px">`, { waitUntil: 'load', timeout: 10_000 })
        await page.evaluate(() => new Promise<void>(resolve => {
          const imageElement = document.querySelector('#hdsi-vision') as HTMLImageElement | null
          if (!imageElement || imageElement.complete) return resolve()
          imageElement.addEventListener('load', () => resolve(), { once: true })
          imageElement.addEventListener('error', () => resolve(), { once: true })
        }))
        const element = await page.$('#hdsi-vision')
        if (!element) return undefined
        const buffer = Buffer.from(await element.screenshot({ type: 'jpeg', quality: 85 }))
        if (!buffer.length) return undefined
        const originalBytes = Buffer.from(image.dataUri.split(',')[1] ?? '', 'base64').length
        if (buffer.length >= originalBytes) return undefined
        svc.reportStandaloneOperation('diagnostic', 'debug', '视觉图片已降采样 原始=%dB 降采样后=%dB 上限=%dpx', originalBytes, buffer.length, maxDimension)
        return { mimeType: 'image/jpeg', dataUri: `data:image/jpeg;base64,${buffer.toString('base64')}` }
      } catch (error) {
        svc.reportStandalone('debug', '视觉图片降采样失败，已透传原图：%s', error)
        return undefined
      } finally {
        if (page) await page.close().catch((): undefined => undefined)
      }
    })
  }


/** P8-S2 自 service.ts 迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export async function renderAnimatedImageFrame(svc: any, dataUri: string) {
    const puppeteer = (svc.ctx as any).puppeteer
    if (!puppeteer?.page) return undefined
    return svc.withBrowserSlot(async () => {
      let page: any
      try {
        page = await puppeteer.page()
        await page.setContent(`<img id="hdsi-image" src="${dataUri}" style="display:block;max-width:4096px;max-height:4096px">`, { waitUntil: 'load', timeout: 10_000 })
        await page.evaluate(() => new Promise<void>(resolve => {
          const image = document.querySelector('#hdsi-image') as HTMLImageElement | null
          if (!image || image.complete) return resolve()
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        }))
        const element = await page.$('#hdsi-image')
        if (!element) return undefined
        const buffer = Buffer.from(await element.screenshot({ type: 'png' }))
        if (!buffer.length || buffer.length > 4 * 1024 * 1024) return undefined
        return { mimeType: 'image/png', dataUri: `data:image/png;base64,${buffer.toString('base64')}` }
      } catch (error) {
        svc.reportStandalone('debug', '动态图片抽帧失败：%s', error)
        return undefined
      } finally {
        if (page) await page.close().catch((): undefined => undefined)
      }
    })
  }

