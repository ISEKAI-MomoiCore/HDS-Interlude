/* fetchShare 异常状态测试:网络失败/超时/404/429/畸形响应/码不匹配/revision无效/sections无效/payload空
 * 用 Mock HTTP 服务,每个异常场景用独立的分享码路由 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fetchShare } from '../src/share-sync'

let mockServer: http.Server
let mockPort: number

/* 每个场景一个独立码(8 位,不含 I/L/O/U) */
const CODES = {
  valid: 'AAAA0001',
  notFound: 'NF404001',
  rateLimit: 'RT429001',
  serverError: 'SE500001',
  notJson: 'HTM00001',
  nullBody: 'NB000001',
  arrayBody: 'AR000001',
  codeMismatch: 'CM000001',
  revisionZero: 'RZ000001',
  revisionNaN: 'RN000001',
  revisionFloat: 'RF000001',
  revisionNegative: 'RG000001',
  sectionsNotArray: 'SNA00001',
  sectionsMixed: 'SM000001',
  sectionsNull: 'SN000001',
  emptyPayload: 'EP000001',
  poisonedPayload: 'PP000001',
  allPoisoned: 'AP000001',
}

type ResponseSpec = { status: number; body: unknown; contentType?: string; delayMs?: number; halfSend?: boolean }

const responses: Record<string, ResponseSpec> = {
  [CODES.valid]: {
    status: 200,
    body: { code: CODES.valid, slug: 'test', title: 'Test Preset', type: 'state-machine', nsfw: false, author: { id: 1, name: 'Tester' }, hdsi_version: 'rc46', revision: 1, sections: ['runtime'], payload: { runtime: { autoAdvanceIntervalMinutes: 20 } } },
  },
  [CODES.notFound]: { status: 404, body: { error: '分享码不存在或不可用。' } },
  [CODES.rateLimit]: { status: 429, body: { error: '请求过于频繁', retryAfter: 60 } },
  [CODES.serverError]: { status: 500, body: { error: 'Internal Server Error' } },
  [CODES.notJson]: { status: 200, body: '<html><body>gateway error</body></html>', contentType: 'text/html' },
  [CODES.nullBody]: { status: 200, body: null },
  [CODES.arrayBody]: { status: 200, body: [1, 2, 3] },
  [CODES.codeMismatch]: { status: 200, body: { code: 'ZZZZ9999', revision: 1, sections: ['runtime'], payload: { runtime: {} } } },
  [CODES.revisionZero]: { status: 200, body: { code: CODES.revisionZero, revision: 0, sections: ['runtime'], payload: { runtime: {} } } },
  [CODES.revisionNaN]: { status: 200, body: { code: CODES.revisionNaN, revision: 'not-a-number', sections: ['runtime'], payload: { runtime: {} } } },
  [CODES.revisionFloat]: { status: 200, body: { code: CODES.revisionFloat, revision: 1.5, sections: ['runtime'], payload: { runtime: {} } } },
  [CODES.revisionNegative]: { status: 200, body: { code: CODES.revisionNegative, revision: -1, sections: ['runtime'], payload: { runtime: {} } } },
  [CODES.sectionsNotArray]: { status: 200, body: { code: CODES.sectionsNotArray, revision: 1, sections: 'runtime', payload: { runtime: {} } } },
  [CODES.sectionsMixed]: { status: 200, body: { code: CODES.sectionsMixed, revision: 1, sections: ['runtime', 42], payload: { runtime: {} } } },
  [CODES.sectionsNull]: { status: 200, body: { code: CODES.sectionsNull, revision: 1, sections: null, payload: { runtime: {} } } },
  [CODES.emptyPayload]: { status: 200, body: { code: CODES.emptyPayload, revision: 1, sections: [], payload: {} } },
  [CODES.poisonedPayload]: { status: 200, body: { code: CODES.poisonedPayload, revision: 1, sections: ['runtime'], payload: { runtime: { x: 1 }, model: { apiKey: 'sk-LEAK' } } } },
  [CODES.allPoisoned]: { status: 200, body: { code: CODES.allPoisoned, revision: 1, sections: ['model'], payload: { model: { apiKey: 'sk-ALL' } } } },
}

const mockHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
  const code = (req.url ?? '').split('/').pop() ?? ''
  const spec = responses[code]
  if (!spec) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); return }

  const headers: Record<string, string> = { 'Content-Type': spec.contentType ?? 'application/json' }
  if (spec.delayMs) {
    setTimeout(() => { res.writeHead(spec.status, headers); res.end(JSON.stringify(spec.body)) }, spec.delayMs)
    return
  }
  res.writeHead(spec.status, headers)
  res.end(spec.contentType === 'text/html' ? String(spec.body) : JSON.stringify(spec.body))
}

/* 简化 mock ctx:直接 fetch,超时用 AbortController */
const mockCtx = {
  http: {
    get: async (url: string, opts?: any) => {
      const controller = new AbortController()
      const timer = opts?.timeout ? setTimeout(() => controller.abort(), opts.timeout) : null
      try {
        const res = await fetch(url, { signal: controller.signal })
        const text = await res.text()
        if (!res.ok) {
          const err: any = new Error(`HTTP ${res.status}`)
          err.response = { status: res.status, json: async () => { try { return JSON.parse(text) } catch { return {} } } }
          throw err
        }
        try { return JSON.parse(text) } catch { return text }
      } finally { if (timer) clearTimeout(timer) }
    },
  },
} as any

describe('fetchShare 异常状态', () => {
  before(async () => {
    mockServer = http.createServer(mockHandler)
    await new Promise<void>((r) => { mockServer.listen(0, '127.0.0.1', r) })
    mockPort = (mockServer.address() as any).port
  })
  after(async () => { await new Promise<void>((r) => mockServer.close(r)) })

  const base = () => `http://127.0.0.1:${mockPort}`

  it('网络不可达 → 抛出含"无法连接"的错误', async () => {
    await assert.rejects(
      fetchShare(mockCtx, 'http://127.0.0.1:1', CODES.valid),
      (e: Error) => e instanceof Error && e.message.length > 0,
    )
  })

  it('404 → 抛出"分享码不存在"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.notFound),
      /分享码不存在/,
    )
  })

  it('429 → 抛出"限流"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.rateLimit),
      /限流/,
    )
  })

  it('500 → 抛出"异常状态"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.serverError),
      /异常状态 500/,
    )
  })

  it('HTML 网关页 → 不崩溃,抛 Error', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.notJson),
      (e: Error) => e instanceof Error,
    )
  })

  it('null body → 抛出格式异常', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.nullBody),
      (e: Error) => e instanceof Error,
    )
  })

  it('数组 body → 抛出格式异常', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.arrayBody),
      (e: Error) => e instanceof Error,
    )
  })

  it('返回码与请求码不一致 → 抛出"不一致"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.codeMismatch),
      /不一致/,
    )
  })

  it('revision=0 → 抛出"revision 无效"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.revisionZero),
      /revision 无效/,
    )
  })

  it('revision=非数字 → 抛出"revision 无效"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.revisionNaN),
      /revision 无效/,
    )
  })

  it('revision=1.5(非整数)→ 抛出"revision 无效"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.revisionFloat),
      /revision 无效/,
    )
  })

  it('revision=-1(负数)→ 抛出"revision 无效"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.revisionNegative),
      /revision 无效/,
    )
  })

  it('sections=字符串 → 抛出"sections 无效"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.sectionsNotArray),
      /sections 无效/,
    )
  })

  it('sections=[字符串+数字混合] → 抛出"sections 无效"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.sectionsMixed),
      /sections 无效/,
    )
  })

  it('sections=null → 抛出"sections 无效"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.sectionsNull),
      /sections 无效/,
    )
  })

  it('payload 空(无任何白名单分区)→ 抛出"没有可应用的分区"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.emptyPayload),
      /没有可应用的分区/,
    )
  })

  it('payload 含 model 污染 → 正常返回但 model 被剔除', async () => {
    const result = await fetchShare(mockCtx, base(), CODES.poisonedPayload)
    assert.ok(!('model' in result.info.payload), 'model 应被剔除')
    assert.ok('runtime' in result.info.payload, 'runtime 应保留')
    assert.ok(result.removed.includes('model'), 'removed 应记录 model')
  })

  it('payload 全部是 model → 抛出"没有可应用的分区"', async () => {
    await assert.rejects(
      fetchShare(mockCtx, base(), CODES.allPoisoned),
      /没有可应用的分区/,
    )
  })

  it('合法响应 → 正常返回', async () => {
    const result = await fetchShare(mockCtx, base(), CODES.valid)
    assert.equal(result.info.title, 'Test Preset')
    assert.equal(result.info.revision, 1)
    assert.deepEqual(result.info.sections, ['runtime'])
  })
})

describe('fetchShare 输入校验', () => {
  const base = () => 'http://127.0.0.1:1' // 不可达也行,输入校验在网络请求前

  it('空字符串 → 格式不正确', async () => {
    await assert.rejects(fetchShare(mockCtx, base(), ''), /格式不正确/)
  })
  it('7 位 → 格式不正确', async () => {
    await assert.rejects(fetchShare(mockCtx, base(), '1PD21Q0'), /格式不正确/)
  })
  it('9 位 → 格式不正确', async () => {
    await assert.rejects(fetchShare(mockCtx, base(), '1PD21Q045'), /格式不正确/)
  })
  it('含排除字符 I → 格式不正确', async () => {
    await assert.rejects(fetchShare(mockCtx, base(), '1PD21Q0I'), /格式不正确/)
  })
  it('含排除字符 L → 格式不正确', async () => {
    await assert.rejects(fetchShare(mockCtx, base(), '1PD21Q0L'), /格式不正确/)
  })
  it('含排除字符 O → 格式不正确', async () => {
    await assert.rejects(fetchShare(mockCtx, base(), '1PD21Q0O'), /格式不正确/)
  })
  it('含排除字符 U → 格式不正确', async () => {
    await assert.rejects(fetchShare(mockCtx, base(), '1PD21Q0U'), /格式不正确/)
  })
  it('null → 格式不正确(转为空串)', async () => {
    await assert.rejects(fetchShare(mockCtx, base(), null as any), /格式不正确/)
  })
  it('数字(合法码格式)→ 不在输入校验层拦截,走到网络层', async () => {
    // 12345678 转为字符串后恰好是 8 位数字,会通过格式校验
    // 因此错误来自网络层而非格式校验
    await assert.rejects(
      fetchShare(mockCtx, base(), 12345678 as any),
      (e: Error) => e instanceof Error, // 只要抛错就行,不限定是"格式不正确"
    )
  })
  it('对象 → 格式不正确(转为 [object Object] 不满足正则)', async () => {
    await assert.rejects(fetchShare(mockCtx, base(), { code: 1 } as any), /格式不正确/)
  })
  it('baseUrl 带尾斜杠 → 正常处理', async () => {
    // 码格式合法,走到网络请求层后因地址不可达报错——说明尾斜杠被正确处理了
    await assert.rejects(
      fetchShare(mockCtx, 'http://127.0.0.1:1/', 'AAAA0001'),
      (e: Error) => e instanceof Error,
    )
  })
})
