import { randomUUID } from 'node:crypto'
import { Logger } from 'koishi'
export interface LogLine { seq: number; time: string; level: string; name: string; message: string }
export class LogRing {
  readonly session = randomUUID()
  private buffer: LogLine[] = []
  private seq = 0
  private capacity: number
  constructor(capacity: number) { this.capacity = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 2000 }
  push(level: string, name: string, message: string, time = new Date().toISOString()) {
    this.buffer.push({ seq: ++this.seq, time, level, name, message: String(message).slice(0, 4000) })
    if (this.buffer.length > this.capacity) this.buffer.splice(0, this.buffer.length - this.capacity)
  }
  get cursor() { return this.seq }
  since(seq: number, level?: string, name?: string) {
    return this.buffer.filter(line => line.seq > seq && (!level || line.level === level) && (!name || line.name.includes(name)))
  }
  latest(count = 200, level?: string, name?: string) {
    return this.since(0, level, name).slice(-Math.max(1, Math.min(count, this.capacity)))
  }
  read(opts: { since?: number; session?: string; limit?: number; level?: string; name?: string }) {
    const reset = !!opts.session && opts.session !== this.session || (opts.since ?? 0) > this.seq
    const since = reset ? undefined : opts.since
    const dropped = since != null && this.buffer.length > 0 && since < this.buffer[0].seq - 1
    return { session: this.session, cursor: this.seq, reset, dropped,
      lines: since != null ? this.since(since, opts.level, opts.name) : this.latest(opts.limit ?? 200, opts.level, opts.name) }
  }
}
/** Dedicated reggol transport; never overrides global console methods or other transports. */
export function attachLogCapture(ring: LogRing): () => void {
  const target = { colors: 0, record(record: { type: string; name: string; content: string; timestamp: number }) {
    try { ring.push(record.type, record.name, record.content, new Date(record.timestamp).toISOString()) } catch { /* capture must not affect Koishi */ }
  } }
  Logger.targets.push(target)
  return () => { const index = Logger.targets.indexOf(target); if (index >= 0) Logger.targets.splice(index, 1) }
}

