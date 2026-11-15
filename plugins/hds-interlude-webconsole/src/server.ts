import { createServer, type ServerResponse } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { handleApi, ApiInputError } from './routes'
import type { WebconsoleStore } from './store'
import type { LogRing } from './logring'
export const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
export function isLoopback(host: string) { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.toLowerCase()) }
function tokenMatches(value: string, expected: string) {
  const a = Buffer.from(value), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
export interface ServerOptions {
  publicRoot: string; token: string; pollSeconds: number; store?: WebconsoleStore; ring?: LogRing
  autoRefresh?: boolean; integration?: { service: string; version: string }
  onError?: (error: unknown) => void
  onRequestError?: (error: unknown) => void
}
export function createWebServer(options: ServerOptions) {
  const session = randomUUID()
  const sseClients = new Set<ServerResponse>()
  const json = (res: ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data))
  }
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:")
    res.setHeader('Cache-Control', 'no-store')
    try {
      const base = new URL(`http://${req.headers.host || ''}`)
      const port = (server.address() as { port?: number } | null)?.port
      if (!isLoopback(base.hostname) || Number(base.port || 80) !== port || base.username || base.password || base.pathname !== '/') return json(res, 403, { error: '只允许本地 Host。' })
      if (req.headers.origin && req.headers.origin !== base.origin) return json(res, 403, { error: '拒绝跨来源访问。' })
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: '拒绝跨站访问。' })
      const url = new URL(req.url || '/', base)
      if (url.origin !== base.origin) return json(res, 400, { error: '非法请求地址。' })
      const path = decodeURIComponent(url.pathname)
      if (path.startsWith('/api/')) {
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: '观测站接口仅支持只读 GET。' }) }
        const header = req.headers.authorization || ''
        const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token') || ''
        if (options.token && !tokenMatches(token, options.token)) return json(res, 403, { error: '访问令牌缺失或错误。请在侧栏填写令牌。' })
        return handleApi({ req, res, path, search: url.searchParams, json, sseClients, session, ...options })
      }
      if (!['GET', 'HEAD'].includes(req.method || '')) { res.setHeader('Allow', 'GET, HEAD'); return json(res, 405, { error: '仅支持 GET / HEAD。' }) }
      // Public shell contains no story data. Explicit allowlist also prevents traversal/symlink requests.
      const file = path === '/' ? 'index.html' : path.slice(1)
      if (!['index.html', 'app.js', 'helpers.mjs', 'style.css'].includes(file)) return json(res, 404, { error: '资源不存在。' })
      const full = join(options.publicRoot, file)
      const stat = statSync(full, { throwIfNoEntry: false })
      if (!stat?.isFile()) return json(res, 404, { error: '资源不存在。' })
      res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Content-Length': stat.size })
      if (req.method === 'HEAD') return res.end()
      const stream = createReadStream(full)
      stream.on('error', error => { options.onRequestError?.(error); res.destroy() })
      res.on('close', () => stream.destroy())
      stream.pipe(res)
    } catch (error) {
      const badInput = error instanceof URIError || error instanceof ApiInputError || error instanceof TypeError && error.message.includes('Invalid URL')
      if (!badInput) options.onRequestError?.(error)
      if (!res.headersSent) json(res, badInput ? 400 : 500, { error: error instanceof URIError ? 'URL 编码不合法。' : error instanceof ApiInputError ? error.message : badInput ? '非法请求地址。' : '读取快照失败，请检查数据库兼容性并查看 Koishi 日志。' })
      else res.end()
    }
  })
  server.on('error', error => options.onError?.(error))
  return { server, stopStreams() { for (const res of sseClients) res.end(); sseClients.clear() } }
}

