import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'

const root = path.dirname(fileURLToPath(import.meta.url))
const parent = fs.realpathSync(path.dirname(root))

async function listen(handler) {
  const server = http.createServer(handler).listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

async function waitUntil(predicate) {
  for (let i = 0; i < 250; i++) {
    const match = await predicate()
    if (match) return match
    await delay(20)
  }
  throw new Error('等待工作台超时')
}

test('Realism 工作台在隔离目录中正确运行、评审与限制凭据作用域', { timeout: 30_000 }, async t => {
  const workspace = fs.mkdtempSync(path.join(parent, '.realism-test-'))
  const servers = []
  let child
  let log = ''
  let mode = 'valid'
  let heldResponse
  const requests = []
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    for (const { server } of servers) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    const resolved = fs.realpathSync(workspace)
    assert.equal(path.dirname(resolved), parent)
    assert.match(path.basename(resolved), /^\.realism-test-/)
    fs.rmSync(resolved, { recursive: true })
  })

  for (const file of fs.readdirSync(root)) {
    if (file.endsWith('.ts') || file === 'matrix.round1.json' || file === 'profiles') {
      fs.cpSync(path.join(root, file), path.join(workspace, file), { recursive: true })
    }
  }
  function modelHandler(req, res) {
    const chunks = []
    req.on('data', data => chunks.push(data))
    req.on('end', () => {
      requests.push({ key: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) })
      const respond = () => {
        const rejected = mode === 'denied'
        res.writeHead(rejected ? 401 : 200, { 'content-type': 'application/json' })
        const content = mode === 'malformed' ? 'not JSON' : JSON.stringify({ script: 'Pane moves.', interaction: { seen: true, reply: mode === 'silent' ? { mode: 'none' } : { mode: 'immediate', content: '嗯。' } } })
        res.end(JSON.stringify(rejected ? { error: 'invalid key' } : { choices: [{ message: { content } }] }))
      }
      if (mode === 'hold') heldResponse = respond
      else respond()
    })
  }
  servers.push(await listen(modelHandler), await listen(modelHandler))
  const endpoint = `${servers[0].url}/model`
  const isolatedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^HDSI_TEST_/i.test(key)))
  const mockEnv = { ...isolatedEnv, HDSI_TEST_UI_PORT: '0', HDSI_TEST_UI_OPEN: '0', HDSI_TEST_PROVIDER_ENDPOINT: endpoint, HDSI_TEST_API_KEY: 'local-mock-key', HDSI_TEST_MODEL: 'mock-model' }
  async function startWorkbench() {
    log = ''
    child = spawn(process.execPath, ['--import', 'tsx', path.join(workspace, 'server.ts')], {
      env: mockEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })
    child.stdout.on('data', chunk => { log += chunk })
    child.stderr.on('data', chunk => { log += chunk })
    return waitUntil(() => {
      assert.equal(child.exitCode, null, log)
      return /HDSI Realism Lab: (http:\/\/127\.0\.0\.1:\d+)/.exec(log)?.[1]
    })
  }
  let url = await startWorkbench()

  async function api(route, body, status = 200) {
    const res = await fetch(url + route, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    assert.equal(res.status, status, JSON.stringify(data))
    return data
  }
  const profile = await api('/api/profile')
  const segments = profile.matrix.phases.flatMap(phase => phase.segments).filter(segment => segment.variant !== 'TBD')
  const [first, second] = segments.map(segment => segment.id)
  const state = async () => (await api('/api/state')).campaign
  const idle = () => waitUntil(async () => (await state()).running ? undefined : (await state()))
  const currentResult = async () => (await idle()).states[0]
  const read = id => api(`/api/segment/${encodeURIComponent(id)}`)
  const run = (segment, options = {}) => api('/api/run', { segments: [segment], ...options })

  await t.test('解析失败与 HTTP 失败均保留记录并标为失败', async () => {
    mode = 'malformed'
    assert.equal((await run(first)).queued, 1)
    const malformed = await currentResult()
    assert.equal(malformed.status, 'error')
    const data = await read(malformed.resultId)
    assert.equal(data.manifest.hFails.H1, data.turns.length)
    assert.equal(data.manifest.errorTurns, data.turns.length)
    mode = 'denied'
    assert.equal((await run(first)).reused, 0)
    const failed = await currentResult()
    assert.equal(failed.status, 'error')
    assert.ok((await read(failed.resultId)).turns.every(turn => turn.error?.startsWith('API 401')))
  })

  let completeId
  await t.test('停止后的半段可重跑，完整同配置样本可复用', async () => {
    mode = 'hold'
    await run(second)
    const release = await waitUntil(() => heldResponse)
    await api('/api/stop', {})
    mode = 'valid'
    release()
    const stopped = await currentResult()
    assert.equal(stopped.status, 'stopped')
    assert.equal((await read(stopped.resultId)).turns.length, 1)
    assert.equal((await run(second)).queued, 1)
    const complete = await currentResult()
    completeId = complete.resultId
    assert.equal(complete.status, 'done')
    assert.notEqual(completeId, stopped.resultId)
    const used = requests.length
    assert.deepEqual(await run(second), { started: false, queued: 0, reused: 1, segments: [second] })
    assert.equal((await currentResult()).resultId, completeId)
    assert.equal(requests.length, used)
  })

  await t.test('同名段保留独立评分，强制重跑与切换模型生成新样本', async () => {
    const dim = profile.rubric.dimensions[0].id
    await api('/api/score', { resultId: completeId, scores: { [dim]: 3 }, flags: {} })
    assert.equal((await run(second, { force: true })).queued, 1)
    const fresh = await currentResult()
    assert.notEqual(fresh.resultId, completeId)
    assert.equal((await read(fresh.resultId)).scores, undefined)
    await api('/api/score', { resultId: fresh.resultId, scores: { [dim]: 4 }, flags: {} })
    assert.equal((await read(completeId)).scores.scores[dim], 3)
    assert.equal((await read(fresh.resultId)).scores.scores[dim], 4)
    assert.equal((await run(second, { overrides: { model: 'other' } })).reused, 0)
    const other = await read((await currentResult()).resultId)
    const complete = await read(completeId)
    assert.equal(other.manifest.engine.model, 'other')
    assert.notEqual(other.manifest.cohort, complete.manifest.cohort)
    const aggregate = await api('/api/aggregate')
    assert.notEqual(aggregate.segments.find(row => row.resultId === other.resultId).cohort, aggregate.segments.find(row => row.resultId === completeId).cohort)
  })

  await t.test('历史解析失败补记 H1，动作包保留 advance 与已读信息', async () => {
    const original = await read(completeId)
    const dir = path.join(workspace, 'out', '2000-01-01', first)
    fs.mkdirSync(dir, { recursive: true })
    const legacyManifest = { ...original.manifest, segment: first, rubric: undefined, cohort: undefined, configHash: undefined, scenario: { ...original.manifest.scenario, turnCount: 2 } }
    const legacyTurns = [{ ...original.turns[0], kind: 'advance', parsed: undefined, parseError: 'old broken JSON', checks: undefined }, { ...original.turns[1], kind: 'advance' }]
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(legacyManifest))
    fs.writeFileSync(path.join(dir, 'turns.jsonl'), legacyTurns.map(turn => JSON.stringify(turn)).join('\n'))
    const key = `2000-01-01/${first}`
    const entry = await read(key)
    assert.equal(entry.manifest.errorTurns, 1)
    assert.equal(entry.manifest.hFails.H1, 1)
    assert.equal(entry.manifest.status, 'failed')
    const gate = await api(`/api/gate/${encodeURIComponent(key)}`)
    assert.match(gate.text, /old broken JSON/)
    assert.match(gate.text, /已读：是/)
    assert.match(gate.text, /消息内容：嗯。/)
    assert.doesNotMatch(gate.text, /Pane moves/)
    const aggregate = await api('/api/aggregate')
    assert.equal(aggregate.segments.find(row => row.resultId === key).cohort, `legacy/${key}`)
  })

  await t.test('重启后继续复用，CLI 评审绑定同一份产物', async () => {
    const exited = once(child, 'exit')
    child.kill()
    await exited
    url = await startWorkbench()
    const used = requests.length
    assert.equal((await run(second)).reused, 1)
    assert.equal(requests.length, used)
    const cli = promisify(execFile)
    const { stdout } = await cli(process.execPath, ['--import', 'tsx', path.join(workspace, 'build-review.ts'), '--segments', completeId], { env: mockEnv, windowsHide: true })
    assert.match(stdout, /已生成/)
    assert.match(fs.readFileSync(path.join(workspace, 'report', `review-${completeId.replace('/', '_')}.md`), 'utf8'), /Pane moves/)
    await assert.rejects(cli(process.execPath, ['--import', 'tsx', path.join(workspace, 'build-review.ts'), '--segments', second], { env: mockEnv, windowsHide: true }), /有多份样本/)
  })

  await t.test('防止跨来源浏览器请求与端点间误用 Key，并应用实际 Profile 配置', async () => {
    const blocked = await fetch(`${url}/api/state`, { headers: { origin: 'https://example.invalid' } })
    assert.equal(blocked.status, 403)
    const wrongContent = await fetch(`${url}/api/stop`, { method: 'POST', body: '{}' })
    assert.equal(wrongContent.status, 415)
    const used = requests.length
    const alternate = `${servers[1].url}/model`
    const bad = await api('/api/test', { overrides: { endpoint: alternate } })
    assert.equal(bad.ok, false)
    assert.equal(requests.length, used)
    const good = await api('/api/test', { overrides: { endpoint: alternate, apiKey: 'other-mock-key', model: 'override' } })
    assert.equal(good.ok, true)
    assert.equal(requests.at(-1).key, 'Bearer other-mock-key')
    assert.equal(requests.at(-1).body.model, 'override')

    const clone = structuredClone(profile)
    clone.meta.name = 'verify-engine'
    clone.engine.protocol = 'anthropic-messages'
    await api('/api/profile', clone)
    await api('/api/profile/activate', { name: clone.meta.name })
    const result = await api('/api/run', { segments: [second] }, 400)
    assert.match(result.error, /anthropic-messages/)
    clone.engine.protocol = 'chat-completions'
    clone.engine.payloadOrder = 'legacy'
    clone.checks.custom = [
      { id: 'bubble', kind: 'regex-bubble', pattern: 'x', severity: 'flag' },
      { id: 'prose', kind: 'regex-prose', pattern: 'Pane', severity: 'flag' },
    ]
    mode = 'silent'
    await api('/api/profile', clone)
    await run(second)
    assert.equal((await currentResult()).status, 'done')
    assert.doesNotMatch(requests.at(-1).body.messages[0].content, /PAYLOAD ORDER NOTE:/)
    const checked = await read((await currentResult()).resultId)
    assert.equal(checked.manifest.profile, clone.meta.name)
    assert.ok(checked.turns.every(turn => turn.checks.some(check => check.id === 'bubble' && check.verdict === 'skip')
      && turn.checks.some(check => check.id === 'prose' && check.verdict === 'flag')))
  })
})
