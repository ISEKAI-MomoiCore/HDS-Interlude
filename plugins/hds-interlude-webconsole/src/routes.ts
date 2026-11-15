import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebconsoleStore } from './store'
import type { LogRing } from './logring'
export interface ApiContext {
  req: IncomingMessage; res: ServerResponse; path: string; search: URLSearchParams
  store?: WebconsoleStore; ring?: LogRing
  json: (res: ServerResponse, code: number, data: unknown) => void
  sseClients: Set<ServerResponse>; pollSeconds: number; session?: string
  autoRefresh?: boolean; integration?: { service: string; version: string }
}
export class ApiInputError extends Error {}
export function num(value: string | null): number | undefined {
  if (value == null || value === '') return undefined
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiInputError('分页参数必须为非负安全整数。')
  return Number(value)
}
export function handleApi(ctx: ApiContext) {
  if (ctx.store && ctx.path !== '/api/stream' && ctx.path !== '/api/logs' && ctx.path !== '/api/status') return ctx.store.snapshot(() => handleApiCore(ctx))
  return handleApiCore(ctx)
}
function handleApiCore({ req, res, path, search, store, ring, json, sseClients, pollSeconds, autoRefresh, integration, session }: ApiContext) {
  if (path === '/api/status') return json(res, 200, { session, revision: store?.revision() ?? null, pollSeconds, autoRefresh: autoRefresh ?? true, integration: integration ?? null })
  if (path === '/api/logs') {
    if (!ring) return json(res, 503, { error: '日志缓冲未就绪。' })
    return json(res, 200, ring.read({ since: num(search.get('since')), session: search.get('session') || undefined,
      limit: num(search.get('limit')), level: search.get('level') || undefined, name: search.get('name') || undefined }))
  }
  if (!store) return json(res, 503, { error: '只读数据库未连接。请检查 SQLite 路径与 Node 版本。' })
  if (path === '/api/stories') return json(res, 200, { rows: store.stories(), missingTables: store.missingTables() })
  const requested = search.get('story') || undefined
  const id = store.resolveStoryId(requested)
  if (requested && !id) return json(res, 404, { error: '所选故事不存在，请重新选择。' })
  const n = (key: string, fallback: number) => num(search.get(key)) ?? fallback
  switch (path) {
    case '/api/overview': return json(res, 200, { story: store.storySummary(id), arc: store.arc(id), preplan: store.preplan(id), longArc: store.longArcGuidance(id), missingTables: store.missingTables() })
    case '/api/alter': return json(res, 200, { alter: store.storySummary(id)?.alter ?? null })
    case '/api/preplan': return json(res, 200, { preplan: store.preplan(id), cursorAt: store.storySummary(id)?.cursorAt ?? null })
    case '/api/script':
      if (search.has('before') && search.has('after')) return json(res, 400, { error: 'before 和 after 不能同时使用。' })
      return json(res, 200, store.scriptEntries({ before: num(search.get('before')), after: num(search.get('after')), limit: n('limit', 50), kind: search.get('kind') || undefined, participantId: search.get('participant') || undefined }, id))
    case '/api/scenes': return json(res, 200, { rows: store.scenes(id), arc: store.arc(id) })
    case '/api/overlay': return json(res, 200, { patches: store.overlayPatches(id), snapshots: store.overlaySnapshots(id), current: store.storySummary(id)?.settingOverlay ?? {}, participants: store.participants(id) })
    case '/api/facts': return json(res, 200, { facts: store.facts({ scope: search.get('scope') || undefined, limit: n('limit', 200) }, id), intents: store.intents({ status: search.get('intentStatus') || 'pending', limit: n('intentLimit', 100) }, id), memories: store.memories(n('memoryLimit', 100), id) })
    case '/api/participants': return json(res, 200, { rows: store.participants(id) })
    case '/api/stream': {
      if (sseClients.size >= 32) return json(res, 429, { error: '实时连接过多。' })
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      res.write('retry: 5000\n\n')
      let last = store.revision()
      const timer = setInterval(() => {
        if (res.destroyed || res.writableNeedDrain) return
        try {
          const revision = store.revision()
          if (revision !== last) { res.write(`data: ${JSON.stringify({ rev: revision })}\n\n`); last = revision }
          else res.write(': heartbeat\n\n')
        } catch { res.end() }
      }, Math.max(1, pollSeconds) * 1000)
      timer.unref()
      res.on('close', () => { clearInterval(timer); sseClients.delete(res) })
      sseClients.add(res)
      return
    }
    default: return json(res, 404, { error: '接口不存在。' })
  }
}

