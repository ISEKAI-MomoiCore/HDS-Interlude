/**
 * Realism Lab · 本地服务层（profile 驱动，零新依赖）。
 *
 * node:http 静态托管 ui-dist + REST + SSE。与 CLI 共用 campaign 引擎。
 * Profile CRUD/activate/导入导出 + 契约指纹对比 + 一审任务包导出。
 *
 * 启动：npm run realism:ui（构建 UI + 起服务 + 开浏览器）
 * 端口：HDSI_TEST_UI_PORT（默认 7677）
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { Campaign, safeHost, resolveEnvFromProcess, envMissing, coreContractFingerprint, profileSegments, describeRun, resolveTarget, type RunOverrides, type MatrixSegment, type ProgressSink } from './campaign'
import { OUT_ROOT, ROOT, listResultIds, resultDir, readManifest, readResult, writeAtomic } from './results'
import { loadProfile, listProfiles, saveProfile, migrateAndSave, migrateFromConstants, profilePath, type Profile } from './profile'
import { callModel } from './protocol'
import { DEFAULT_STYLE_PROMPT } from '../../src/narrator'
import { PRODUCTION_DEFAULT_MAIN_PROMPT } from './campaign'

const PORT = Number(process.env.HDSI_TEST_UI_PORT ?? 7677)
const UI_DIST = path.join(ROOT, 'ui-dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
}

// —— 活动环 + SSE 广播 ——

interface EventItem { at: string, kind: string, segment?: string, text: string }
const activity: EventItem[] = []
const sseClients = new Set<http.ServerResponse>()

function broadcast(kind: string, text: string, segment?: string): void {
  const item: EventItem = { at: new Date().toISOString().slice(11, 19), kind, text, ...(segment ? { segment } : {}) }
  activity.push(item)
  if (activity.length > 200) activity.splice(0, activity.length - 200)
  const payload = `data: ${JSON.stringify(item)}\n\n`
  for (const client of sseClients) {
    if (!client.write(payload)) client.destroy()
  }
}

// —— active profile（内存态） ——

let activeProfileName = process.env.HDSI_TEST_PROFILE || 'round1'

function activeProfile(): Profile {
  return loadProfile(activeProfileName)
}

const env = resolveEnvFromProcess()
let campaign: Campaign | null = null

const sink: ProgressSink = {
  onSegmentStart(segment, info) {
    broadcast('start', `${segment.variant} × ${segment.scenario}${segment.persona ? ` × ${segment.persona}` : ''} 开始（${info.turnCount} 轮）`, segment.id)
  },
  onTurn(segmentId, record) {
    const fails = (record.checks ?? []).filter(check => check.verdict === 'fail').map(check => check.id).join(',')
    const mode = record.parsed?.replyMode
    broadcast('turn', `t${record.seq} ${record.kind} ${record.error || record.parseError ? `ERR ${(record.error || record.parseError)!.slice(0, 80)}` : fails ? `✗${fails}` : mode ? mode : 'ok'}`, segmentId)
  },
  onSegmentDone(segment, manifest) {
    const labels = { complete: '完成', stopped: '已停止', failed: '存在失败回合' }
    broadcast(manifest.status === 'failed' ? 'error' : 'done', `${labels[manifest.status ?? 'complete']} · 异常轮 ${manifest.errorTurns} · H 失败 ${JSON.stringify(manifest.hFails)} · tokens≈${manifest.totalTokens}`, segment.id)
  },
  onSegmentError(segment, message) {
    broadcast('error', `失败：${message.slice(0, 120)}`, segment.id)
  },
  onLog(line) {
    broadcast('log', line)
  },
}

// —— 分段产物定位与解析 ——

interface ScoreFile {
  resultId: string
  scores: Record<string, number>
  flags: Record<string, Array<{ turn: number, note?: string }>>
  note?: string
  updatedAt: string
}

function readScores(id: string): Partial<ScoreFile> | undefined {
  const dir = resultDir(id)
  if (!dir) return undefined
  const file = path.join(dir, 'scores.json')
  return fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined
}

let builtinRubric: Profile['rubric'] | undefined
function legacyRubric(profile?: string): Profile['rubric'] {
  try { return loadProfile(profile || DEFAULT_PROFILE_NAME).rubric }
  catch { return builtinRubric ??= migrateFromConstants().rubric }
}

function computeAggregate() {
  const fingerprints: Record<string, number> = Object.create(null)
  const rows = listResultIds().flatMap(id => {
    try {
      const data = readResult(id)
      if (!data) return []
      const { manifest, turns } = data
      const legacy = manifest as typeof manifest & { arm?: typeof manifest.variant, provider?: { model: string } }
      const variant = manifest.variant ?? legacy.arm
      const hash = manifest.contract?.systemHash
      if (hash) fingerprints[hash] = (fingerprints[hash] ?? 0) + 1
      const withMetrics = turns.filter(turn => turn.metrics)
      const avg = (key: string) => withMetrics.length
        ? Math.round(withMetrics.reduce((sum, turn) => sum + Number(turn.metrics?.[key] ?? 0), 0) / withMetrics.length * 100) / 100
        : 0
      const openers = new Map<string, number>()
      for (const turn of withMetrics) {
        const opener = String(turn.metrics?.opener8 ?? '')
        if (opener) openers.set(opener, (openers.get(opener) ?? 0) + 1)
      }
      const maxRepeat = [...openers.values()].reduce((max, count) => Math.max(max, count), 0)
      const scores = readScores(id)?.scores
      return [{
        resultId: id, segment: manifest.segment, date: id.split('/')[0], startedAt: manifest.startedAt,
        profile: manifest.profile || DEFAULT_PROFILE_NAME,
        cohort: hash && manifest.cohort && manifest.rubric ? `${hash}/${manifest.cohort}` : `legacy/${id}`,
        legacy: !manifest.rubric || !manifest.cohort || !hash,
        rubric: manifest.rubric ?? legacyRubric(manifest.profile),
        variant: variant?.id, variantLabel: variant?.label, presence: variant?.presence ?? 0, lang: variant?.lang ?? 'zh',
        persona: manifest.persona?.id ?? 'linwan', personaName: manifest.persona?.characterName ?? '林晚',
        scenario: manifest.scenario.id,
        engineModel: manifest.engine?.model ?? legacy.provider?.model ?? '',
        turns: turns.length, errorTurns: manifest.errorTurns, status: manifest.status,
        hFails: manifest.hFails, totalTokens: manifest.totalTokens,
        avgScriptLen: avg('scriptLength'), avgBubbles: avg('bubbleCount'), avgSentence: avg('avgSentenceLength'),
        openerRepeatPct: withMetrics.length ? Math.round(maxRepeat / withMetrics.length * 100) : 0,
        humanScores: scores && Object.keys(scores).length ? scores : null,
        contractHash: hash,
      }]
    } catch (error) {
      broadcast('error', `聚合跳过 ${id}：${(error as Error).message.slice(0, 80)}`)
      return []
    }
  }).sort((a, b) => (b.startedAt ?? b.date).localeCompare(a.startedAt ?? a.date))
  // 每个实验组保存自己的评审规则。历史样本缺少配置快照，各自独立显示。
  const cohorts = new Map<string, { id: string, profile: string, rubric: Profile['rubric'], legacy: boolean }>()
  for (const row of rows) {
    if (!cohorts.has(row.cohort)) cohorts.set(row.cohort, { id: row.cohort, profile: row.profile, rubric: row.rubric, legacy: row.legacy })
  }
  return { segments: rows.map(({ rubric, ...row }) => row), cohorts: [...cohorts.values()], contractFingerprints: fingerprints }
}

// —— 一审任务包（rubric.gate 驱动，不评审剧本 prose） ——

function buildGatePack(id: string): { text: string } | { error: string } {
  const data = readResult(id)
  if (!data) return { error: `样本 ${id} 无产物` }
  const { manifest, turns } = data
  const rubric = manifest.rubric ?? legacyRubric(manifest.profile)
  const lines = [`# 一审任务包 · ${manifest.segment} · ${id}`, `场景：${manifest.scenario.label}`,
    `人物：${manifest.persona?.characterName ?? '未知'}`, '', '## 评审边界', rubric.gate.rules, '',
    '## 逐轮时间线（动作字段）']
  if (!manifest.rubric) lines.splice(4, 0, '历史样本使用当前可用的参考评分规则。')
  for (const turn of turns) {
    lines.push(`[t${turn.seq} · ${turn.atLocal} · ${turn.kind}]`)
    if (turn.kind === 'user') lines.push(`用户：${turn.userMessage ?? ''}`)
    if (turn.error || turn.parseError) lines.push(`回合错误：${turn.error || turn.parseError}`)
    const parsed = turn.parsed
    if (parsed) {
      lines.push(`已读：${parsed.seen === undefined ? '未声明' : parsed.seen ? '是' : '否'}`)
      lines.push(`回复动作：${parsed.replyMode || '未声明'}`)
      if (parsed.replySendAt) lines.push(`计划时间：${parsed.replySendAt}`)
      if (parsed.replyContent) lines.push(`消息内容：${parsed.replyContent}`)
    }
    lines.push('')
  }
  lines.push('## 输出格式', '对每轮输出 JSON 行：{"seq":N,"verdict":"pass|flag|fail","reason":"一句话"}。最后一行输出 {"summary":{"fail":n,"flag":n}}。')
  return { text: lines.join('\n') }
}

// —— 请求处理 ——

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 5_000_000) { reject(new Error('请求体过大')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  let filePath = path.join(UI_DIST, urlPath === '/' ? 'index.html' : urlPath)
  const relative = path.relative(UI_DIST, filePath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return json(res, 403, { error: 'forbidden' })
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(UI_DIST, 'index.html')
    if (!fs.existsSync(filePath)) {
      return json(res, 503, { error: 'UI 未构建：先运行 npm run realism:ui:build' })
    }
  }
  const ext = path.extname(filePath)
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'x-frame-options': 'DENY' })
  fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res)
}

function resolveSegmentsFor(profile: Profile, query: { segments?: string[], phase?: string }): MatrixSegment[] {
  const all = profileSegments(profile)
  if (query.segments?.length) {
    const wanted = new Set(query.segments)
    return all.filter(segment => wanted.has(segment.id))
  }
  if (query.phase) {
    const phase = profile.matrix.phases.find(item => item.key === query.phase)
    if (!phase) throw new Error(`未知阶段 ${query.phase}`)
    return phase.segments
  }
  return all
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const pathname = url.pathname

  try {
    if (pathname === '/api/state' && req.method === 'GET') {
      const profile = activeProfile()
      const defaults = { ...env, model: profile.engine.model || env.model, endpoint: profile.engine.endpoint || env.endpoint }
      return json(res, 200, {
        profiles: listProfiles(),
        activeProfile: activeProfileName,
        env: {
          model: defaults.model, endpointHost: safeHost(defaults.endpoint), protocol: profile.engine.protocol || env.protocol,
          samplingOff: env.samplingOff, missing: envMissing(defaults),
        },
        campaign: { profile: campaign?.profileName ?? '', running: campaign?.isRunning ?? false, current: campaign?.currentSegment ?? '', states: campaign?.state() ?? [] },
        rubric: profile.rubric,
        matrix: profile.matrix,
        uiBuilt: fs.existsSync(path.join(UI_DIST, 'index.html')),
        contractFingerprint: coreContractFingerprint({ messageSeparator: '<sep/>', splitReplyMessages: true, browserMode: 'disabled' }),
        profileMeta: { name: profile.meta.name, title: profile.meta.title, variants: profile.variants.length, personas: profile.personas.length, scenarios: profile.scenarios.length },
      })
    }
    if (pathname === '/api/run' && req.method === 'POST') {
      const body = await readBody(req) as { segments?: string[], phase?: string, dry?: boolean, concurrency?: number, force?: boolean, overrides?: RunOverrides }
      if (campaign?.isRunning) return json(res, 409, { error: 'campaign 已在运行中' })
      const profile = activeProfile()
      const segments = resolveSegmentsFor(profile, body).filter(segment => segment.variant !== 'TBD')
      if (!segments.length) return json(res, 400, { error: '没有可运行的段，请检查选择与变体' })
      const concurrency = body.concurrency ?? 1
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) return json(res, 400, { error: '并发数须为 1 到 3' })
      const dry = body.dry === true
      const next = new Campaign(profile, env, sink, body.overrides)
      const configHashes = new Map<string, string>()
      const reusable = new Map<string, NonNullable<ReturnType<typeof readResult>>>()
      if (!dry) {
        try {
          for (const segment of segments) configHashes.set(segment.id, describeRun(profile, env, segment, body.overrides).configHash)
        } catch (error) { return json(res, 400, { error: (error as Error).message }) }
        if (body.force !== true) {
          const candidates = new Set(configHashes.values())
          for (const id of listResultIds(next.date)) {
            try {
              const manifest = readManifest(id)
              const hash = manifest?.configHash
              if (!manifest || !hash || !candidates.has(hash) || manifest.status !== 'complete') continue
              const data = readResult(id, manifest)
              if (!data || data.manifest.status !== 'complete') continue
              const previous = reusable.get(hash)
              if (!previous || previous.manifest.finishedAt < data.manifest.finishedAt) reusable.set(hash, data)
            } catch { /* 单个损坏产物不影响启动 */ }
          }
        }
      }
      next.enqueue(segments, segment => reusable.get(configHashes.get(segment.id)!))
      campaign = next
      const queued = next.state().filter(state => state.status === 'pending').length
      const reused = next.state().length - queued
      broadcast('run', `待运行 ${queued} 段 · 复用 ${reused} 段 · ${dry ? 'dry' : 'live'}`)
      if (queued) {
        void next.run(dry, concurrency)
          .catch(error => broadcast('error', `campaign 异常：${(error as Error).message}`))
          .finally(() => broadcast('done', '队列结束'))
      }
      return json(res, 200, { started: queued > 0, queued, reused, segments: segments.map(segment => segment.id) })
    }
    if (pathname === '/api/stop' && req.method === 'POST') {
      campaign?.stop()
      broadcast('stop', '停止请求已发出（当前轮完成后生效）')
      return json(res, 200, { stopping: true })
    }
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify({ at: '', kind: 'hello', text: '已连接' })}\n\n`)
      for (const item of activity.slice(-40)) res.write(`data: ${JSON.stringify(item)}\n\n`)
      sseClients.add(res)
      res.on('close', () => sseClients.delete(res))
      return
    }
    if (pathname.startsWith('/api/segment/') && req.method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/segment/'.length))
      const data = readResult(id)
      if (!data) return json(res, 404, { error: '样本无产物' })
      const rubric = data.manifest.rubric ?? legacyRubric(data.manifest.profile)
      return json(res, 200, { ...data, rubric, scores: readScores(id) })
    }
    if (pathname === '/api/score' && req.method === 'POST') {
      const body = await readBody(req) as Omit<ScoreFile, 'updatedAt'>
      const dir = resultDir(body.resultId)
      if (!dir) return json(res, 404, { error: '样本无产物' })
      if (!body.scores || typeof body.scores !== 'object' || Array.isArray(body.scores)
        || !Object.values(body.scores).every(score => Number.isInteger(score) && score >= 1 && score <= 5)) {
        return json(res, 400, { error: '评分须为 1 到 5 的整数' })
      }
      const file: ScoreFile = { resultId: body.resultId, scores: body.scores, flags: body.flags, note: body.note, updatedAt: new Date().toISOString() }
      writeAtomic(path.join(dir, 'scores.json'), JSON.stringify(file, null, 2) + '\n')
      broadcast('score', `评审已保存：${body.resultId}`)
      return json(res, 200, { saved: true })
    }
    if (pathname === '/api/aggregate' && req.method === 'GET') {
      return json(res, 200, computeAggregate())
    }
    // —— Profile CRUD ——
    if (pathname === '/api/profiles' && req.method === 'GET') {
      const profiles = listProfiles().map(name => {
        try {
          const profile = loadProfile(name)
          return { name, title: profile.meta.title, variants: profile.variants.length, personas: profile.personas.length, scenarios: profile.scenarios.length, segments: profileSegments(profile).length }
        } catch (error) { return { name, title: `(校验失败) ${(error as Error).message.slice(0, 60)}` } }
      })
      return json(res, 200, { profiles, active: activeProfileName })
    }
    if (pathname === '/api/profile' && req.method === 'GET') {
      const name = url.searchParams.get('name') ?? activeProfileName
      return json(res, 200, loadProfile(name))
    }
    if (pathname === '/api/profile' && req.method === 'POST') {
      const body = await readBody(req) as Profile
      saveProfile(body)
      if (body.meta.name === activeProfileName) broadcast('profile', `当前 profile 已更新：${body.meta.name}`)
      else broadcast('profile', `profile 已保存：${body.meta.name}`)
      return json(res, 200, { saved: true })
    }
    if (pathname === '/api/profile/activate' && req.method === 'POST') {
      const body = await readBody(req) as { name?: string }
      const profile = loadProfile(body.name ?? DEFAULT_PROFILE_NAME)
      activeProfileName = profile.meta.name
      broadcast('profile', `激活 profile：${activeProfileName}`)
      return json(res, 200, { active: activeProfileName })
    }
    if (pathname === '/api/profile/new' && req.method === 'POST') {
      const body = await readBody(req) as { name: string, from?: string }
      if (fs.existsSync(profilePath(body.name))) return json(res, 409, { error: '此 profile 已存在' })
      const source = loadProfile(body.from ?? activeProfileName)
      const clone = JSON.parse(JSON.stringify(source)) as Profile
      clone.meta.name = body.name
      clone.meta.title = `${source.meta.title}（副本）`
      clone.meta.createdAt = new Date().toISOString()
      saveProfile(clone)
      return json(res, 200, { saved: true, name: body.name })
    }
    if (pathname === '/api/profile/migrate' && req.method === 'POST') {
      const profile = migrateAndSave('round1')
      broadcast('profile', 'round1 已从常量重新迁移')
      return json(res, 200, { saved: true, name: profile.meta.name })
    }
    if (pathname.startsWith('/api/profile/') && req.method === 'DELETE') {
      const name = pathname.slice('/api/profile/'.length)
      if (name.toLowerCase() === activeProfileName.toLowerCase()) return json(res, 400, { error: '不能删除当前激活的 profile' })
      const file = profilePath(name)
      if (!fs.existsSync(file)) return json(res, 404, { error: `profile 不存在：${name}` })
      fs.rmSync(file)
      broadcast('profile', `profile 已删除：${name}`)
      return json(res, 200, { deleted: true })
    }
    if (pathname === '/api/profile/defaults' && req.method === 'GET') {
      // 生产默认槽文本（供提示词编辑器 diff 预览）。mainPrompt 默认见 narrator.ts:2002。
      return json(res, 200, {
        mainPrompt: PRODUCTION_DEFAULT_MAIN_PROMPT,
        style: DEFAULT_STYLE_PROMPT,
        formatPrompt: '', fixedPrompt: '', storyStyle: '',
      })
    }
    if (pathname.startsWith('/api/gate/') && req.method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/gate/'.length))
      const pack = buildGatePack(id)
      if ('error' in pack) return json(res, 404, pack)
      return json(res, 200, pack)
    }
    if (pathname === '/api/test' && req.method === 'POST') {
      const body = await readBody(req) as RunOverrides & { segments?: string[], overrides?: RunOverrides }
      const profile = activeProfile()
      const segment = resolveSegmentsFor(profile, body).find(item => item.variant !== 'TBD')
      const variant = profile.variants.find(item => item.id === segment?.variant)
      const startedAt = Date.now()
      try {
        const target = resolveTarget(profile, env, variant, body.overrides ?? body)
        const result = await callModel(target, { system: 'ping', user: 'ping', jsonMode: false, maxTokens: 8, timeoutMs: 20_000, proxy: env.proxy })
        if (typeof result.raw !== 'string' || !result.raw.trim()) throw new Error('端点未返回有效的 Chat Completions 文本')
        return json(res, 200, { ok: true, latencyMs: Date.now() - startedAt, model: target.model, endpointHost: safeHost(target.endpoint) })
      } catch (error) {
        return json(res, 200, { ok: false, latencyMs: Date.now() - startedAt, error: (error as Error).message.slice(0, 300) })
      }
    }
    if (pathname === '/api/open-folder' && req.method === 'POST') {
      const body = await readBody(req) as { resultId?: string }
      if (process.platform === 'win32') {
        const dir = body.resultId ? resultDir(body.resultId) : OUT_ROOT
        if (dir && fs.existsSync(dir)) spawn('explorer', [dir], { detached: true, stdio: 'ignore' }).unref()
      }
      return json(res, 200, { ok: true })
    }
    return json(res, 404, { error: `未知 API：${pathname}` })
  } catch (error) {
    return json(res, 500, { error: (error as Error).message })
  }
}

const DEFAULT_PROFILE_NAME = 'round1'

const LOOPBACK = '127.0.0.1'
const server = http.createServer((req, res) => {
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : PORT
  const host = req.headers.host
  if (host !== `${LOOPBACK}:${port}` && host !== `localhost:${port}`) return json(res, 403, { error: '请使用本机地址打开 Realism Lab' })
  const target = req.url ?? '/'
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return json(res, 400, { error: '请求路径无效' })
  const url = new URL(target, `http://${host}`)
  if (url.pathname.startsWith('/api/')) {
    const origin = req.headers.origin
    const site = req.headers['sec-fetch-site']
    if ((origin && origin !== `http://${host}`) || (site && !['same-origin', 'none'].includes(site))) {
      return json(res, 403, { error: '仅接受同源请求' })
    }
    if (req.method === 'POST' && req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      return json(res, 415, { error: '请求须使用 application/json' })
    }
    void handleApi(req, res, url)
    return
  }
  serveStatic(res, url.pathname)
})

server.listen(PORT, LOOPBACK, () => {
  const address = server.address()
  const url = `http://${LOOPBACK}:${typeof address === 'object' && address ? address.port : PORT}`
  broadcast('boot', `服务启动 ${url}（profile=${activeProfileName}，模型 ${env.model || '(未配置)'}）`)
  process.stdout.write(`HDSI Realism Lab: ${url}（profile=${activeProfileName}）\n`)
  if (!fs.existsSync(path.join(UI_DIST, 'index.html'))) {
    process.stdout.write('  UI 未构建：npm run realism:ui:build（当前仅 API 可用）\n')
  } else if (process.platform === 'win32' && process.env.HDSI_TEST_UI_OPEN !== '0') {
    spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore' }).unref()
  }
})
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    process.stderr.write(`端口 ${PORT} 被占用（另一个实例在跑？或设 HDSI_TEST_UI_PORT 换端口）\n`)
    process.exit(1)
  }
  throw error
})

