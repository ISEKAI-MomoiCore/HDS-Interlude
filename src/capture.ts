/**
 * 主叙事微调数据采集（modelCapture）：可选地把每次解析成功的主叙事模型
 * 往返——system 合约、user payload、采样参数与模型返回原文——按天追加为
 * 本地 JSONL。失败/无效往返在 narrator 抛错路径中直接丢弃，不产生记录；
 * 写盘走串行队列，任何 IO 失败只降级采集本身，绝不影响叙事结果。
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface ModelCaptureConfig {
  enabled: boolean
  directory: string
}

/** 一条采集记录 = 一次解析成功的主叙事往返（对话推进与自动推进均覆盖）。 */
export interface MainNarrativeCaptureRecord {
  capturedAt: string
  task: 'main'
  phase: string
  storyId: string
  participantId: string | null
  provider: { id?: string, label: string, model: string, host: string }
  /** decide() 重试循环内的第几次尝试（1 起）；仅元数据。 */
  attemptIndex?: number
  latencyMs: number
  request: {
    messages: Array<{ role: string, content: unknown }>
    responseFormat: string
    temperature?: number
    topP?: number
    maxTokens?: number
  }
  responseText: string
  usage?: { inputTokens?: number, outputTokens?: number, cachedInputTokens?: number }
}

export interface MainCaptureSink {
  record(entry: MainNarrativeCaptureRecord): void
}

export interface CapturedMessage {
  role: string
  content: unknown
}

/** 多模态消息里的 base64 图片/音频只保留占位与长度，避免数据文件被内联媒体撑爆。 */
export function sanitizeCapturedMessages<T extends CapturedMessage>(messages: T[]): T[] {
  return messages.map(message => {
    if (!Array.isArray(message.content)) return message
    const content = message.content.map((part: any) => {
      if (part?.type === 'image_url' && typeof part.image_url?.url === 'string' && part.image_url.url.startsWith('data:')) {
        return { ...part, image_url: { ...part.image_url, url: `[omitted data-uri ${part.image_url.url.length} chars]` } }
      }
      if (part?.type === 'input_audio' && typeof part.input_audio?.data === 'string') {
        return { ...part, input_audio: { ...part.input_audio, data: `[omitted base64 ${part.input_audio.data.length} chars]` } }
      }
      return part
    })
    return { ...message, content }
  })
}

/** 只保留 host 作为端点标识；完整 URL（可能含网关路径与查询串）不进采集文件。 */
export function captureEndpointHost(endpoint: string): string {
  try { return new URL(endpoint).host } catch { return '' }
}

export function captureDateTag(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function captureFileName(date = new Date()): string {
  return `hdsi-capture-${captureDateTag(date)}.jsonl`
}

/** 串行追加式 JSONL 采集器：record() 永不同步抛错、永不阻塞调用方。 */
export class ModelCaptureSink implements MainCaptureSink {
  private queue: Promise<void> = Promise.resolve()
  private consecutiveFailures = 0
  private warnedOnce = false
  private directoryReady = false
  private stopped = false

  constructor(
    private readonly directory: string,
    private readonly logger?: { warn?: (template: string, ...args: any[]) => void },
    private readonly maxConsecutiveFailures = 3,
  ) {}

  /** 连续写盘失败达到上限后停用；重载（重建 sink）即恢复。 */
  get active(): boolean { return !this.stopped }

  record(entry: MainNarrativeCaptureRecord): void {
    if (this.stopped) return
    let line: string
    try {
      line = JSON.stringify(entry)
    } catch {
      return
    }
    this.queue = this.queue.then(async () => {
      if (this.stopped) return
      if (!this.directoryReady) {
        await mkdir(this.directory, { recursive: true })
        this.directoryReady = true
      }
      await appendFile(join(this.directory, captureFileName()), `${line}\n`, 'utf8')
      this.consecutiveFailures = 0
    }).catch(error => {
      this.consecutiveFailures += 1
      if (!this.warnedOnce) {
        this.warnedOnce = true
        this.logger?.warn?.('主叙事采集写盘失败（此后静默直至停用）目录=%s 错误=%s', this.directory, error)
      }
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) this.stopped = true
    })
  }

  /** 等待在途写盘完成；测试与停机前使用。 */
  flush(): Promise<void> { return this.queue }
}
