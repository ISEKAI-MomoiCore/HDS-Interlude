/**
 * P0：模型行为回归测试（Fix 6：使用生产 systemPrompt 构建链路）。
 *
 * 用真实模型 API + 生产提示词跑固定合成对话场景，断言传输层契约。
 * 每次发布前手动跑：npm run test:model
 * 需要环境变量：
 *   HDSI_TEST_PROVIDER_ENDPOINT  (如 https://api.example.com/v1/chat/completions)
 *   HDSI_TEST_API_KEY
 *   HDSI_TEST_MODEL              (如 gemini-3-flash-preview)
 * 未设置时自动跳过。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Agent, setGlobalDispatcher } from 'undici'
import { systemPrompt } from '../src/narrator'

const ENDPOINT = process.env.HDSI_TEST_PROVIDER_ENDPOINT ?? ''
const API_KEY = process.env.HDSI_TEST_API_KEY ?? ''
const MODEL = process.env.HDSI_TEST_MODEL ?? ''
const skip = !ENDPOINT || !API_KEY || !MODEL
// 验证环境对端点偶发直连握手超时（undici 默认 connect 10s）——放宽到 30s；
// 连接建立后由 keep-alive 复用，后续调用不再重复握手。
if (!skip) setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))

function makeProductionSystemPrompt(kind: 'private' | 'group') {
  // 使用生产 systemPrompt 函数，参数与 requestProvider 中的调用一致
  return systemPrompt(
    'user-message',             // phase
    '', '', '', '',            // mainPrompt, formatPrompt, fixedPrompt, baseStylePrompt
    '',                         // storyStylePrompt
    false, false, false, false, // refreshContinuity, alterEnabled, agencyEnabled, perspectiveEnabled
    false,                     // outputRecovery
    undefined,                 // chatCapabilities
    false,                     // hasQuotedMessage
    undefined,                 // stickerCatalog
    false,                     // schedulePreplanEnabled
    false,                     // streamingReplyFirst
    false,                     // cacheFirstPayload
    kind === 'group',          // groupTurn
    { messageSeparator: '<sep/>', splitReplyMessages: true }, // writingOptions
  )
}

const privatePayload = (msg: string) => JSON.stringify({
  interval: { from: '2026-09-12T07:00:00Z', now: '2026-09-12T08:00:00Z', elapsedSeconds: 3600, nowLocal: '2026-09-12 16:00:00', nowLocalContext: { timezone: 'Asia/Shanghai', period: 'afternoon' } },
  currentEvent: { type: 'private-message-batch', content: msg, observedAtLocal: '2026-09-12 16:00:00' },
  recentScript: [
    { kind: 'user-delivered-message', content: '中午好', occurredAt: '2026-09-12T04:00:00Z' },
    { kind: 'protagonist-narrative', content: '她窝在沙发里给朋友回了条消息，开始琢磨晚饭吃什么。', occurredAt: '2026-09-12T07:30:00Z' },
  ],
})

const groupPayload = (msg: string) => JSON.stringify({
  interval: { from: '2026-09-12T07:00:00Z', now: '2026-09-12T08:00:00Z', elapsedSeconds: 3600, nowLocal: '2026-09-12 16:00:00', nowLocalContext: { timezone: 'Asia/Shanghai', period: 'afternoon' } },
  groupContext: { groupId: 'test-group', label: 'Test Group', messages: [{ speaker: 'User', content: msg, occurredAt: '2026-09-12T07:59:00Z', direction: 'user' }] },
  recentScript: [
    { kind: 'protagonist-narrative', content: '她在书房里写歌。', occurredAt: '2026-09-12T07:30:00Z' },
  ],
})

async function callModel(system: string, userPayload: string): Promise<Record<string, unknown>> {
  // 验证环境对端点偶发直连超时（部署无代理）——网络类失败（连接失败/超时/
  // 5xx）单次重试 + 60s 请求超时；4xx 与内容解析错误不重试（那是合约问题，
  // 不是网络问题）。
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      // 部分模型（如 Claude 5 系）已弃用 temperature/top_p 并直接 400；
      // HDSI_TEST_SAMPLING=off 时省略采样参数以兼容此类端点。
      const sampling = process.env.HDSI_TEST_SAMPLING === 'off' ? {} : { temperature: 0.72, top_p: 0.8 }
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: MODEL, ...sampling,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: userPayload }],
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) {
        const text = await response.text()
        if (response.status >= 500 && attempt === 1) continue
        throw new Error(`API ${response.status}: ${text}`)
      }
      const json = await response.json() as { choices: { message: { content: string } }[] }
      return JSON.parse(json.choices[0].message.content)
    } catch (error) {
      const retryable = error instanceof TypeError
        || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      if (!retryable || attempt === 2) throw error
    }
  }
  throw new Error('unreachable')
}

const scenarios = [
  { label: '私聊闲聊', kind: 'private' as const, msg: '晚上吃什么' },
  { label: '私聊感叹', kind: 'private' as const, msg: '今天好累啊' },
  { label: '私聊有趣', kind: 'private' as const, msg: '哈哈哈那个视频笑死我了' },
  { label: '群聊提及', kind: 'group' as const, msg: '@bot 你觉得呢' },
]

test('model behavior: private turn contract (production prompt)', { skip }, async () => {
  const system = makeProductionSystemPrompt('private')
  assert.ok(system.length > 5000, `生产提示词应远长于测试提示词（got ${system.length}）`)
  for (const s of scenarios.filter(x => x.kind === 'private')) {
    const decision = await callModel(system, privatePayload(s.msg))
    const interaction = decision.interaction as Record<string, unknown> | undefined
    const reply = (interaction?.reply ?? {}) as Record<string, unknown>
    assert.ok(interaction, `${s.label}: interaction 字段必须存在`)
    assert.equal(typeof interaction.seen, 'boolean', `${s.label}: seen 必须是 boolean`)
    assert.ok(['none', 'immediate', 'delayed'].includes(String(reply.mode)), `${s.label}: reply.mode 合法（got ${reply.mode}）`)
    if (reply.mode === 'immediate') {
      assert.ok(typeof reply.content === 'string' && (reply.content as string).trim(), `${s.label}: immediate 时 content 非空`)
    }
    assert.ok(typeof decision.script === 'string' && (decision.script as string).trim().length > 20, `${s.label}: script 非空`)
  }
})

test('model behavior: group turn contract (production prompt)', { skip }, async () => {
  const system = makeProductionSystemPrompt('group')
  for (const s of scenarios.filter(x => x.kind === 'group')) {
    const decision = await callModel(system, groupPayload(s.msg))
    const groupReply = decision.groupReply as Record<string, unknown> | undefined
    const nestedGroupReply = (decision.interaction as Record<string, unknown> | undefined)?.groupReply as Record<string, unknown> | undefined
    const effective = groupReply ?? nestedGroupReply
    assert.ok(effective, `${s.label}: groupReply 必须存在（顶层或嵌套）`)
    assert.ok(['none', 'immediate'].includes(String(effective?.mode)), `${s.label}: mode 合法`)
    if (effective?.mode === 'immediate') {
      assert.ok(typeof effective?.content === 'string' && String(effective?.content).trim(), `${s.label}: immediate 时 content 非空`)
    }
  }
})

test('model behavior: bubble count varies across diverse prompts (production prompt)', { skip }, async () => {
  const system = makeProductionSystemPrompt('private')
  const bubbleCounts: number[] = []
  for (const s of scenarios.filter(x => x.kind === 'private')) {
    const decision = await callModel(system, privatePayload(s.msg))
    const reply = ((decision.interaction as Record<string, unknown>)?.reply ?? {}) as Record<string, unknown>
    const content = typeof reply.content === 'string' ? reply.content : ''
    bubbleCounts.push(content ? (content.match(/<sep\/?>/g) ?? []).length + 1 : 0)
  }
  // Fix 6：三次全单条也合理——只断言"没有形成非零恒定"（例如恒定 2 段）。
  const nonZero = bubbleCounts.filter(n => n > 0)
  const uniqueNonZero = new Set(nonZero)
  const allSameNonZero = nonZero.length >= 3 && uniqueNonZero.size === 1 && nonZero[0] > 1
  assert.ok(!allSameNonZero,
    `气泡段数不应恒定同一非零值（got ${JSON.stringify(bubbleCounts)}）；全单条或全沉默或混合分布均可`)
})

test('model behavior: no self-invented third-party messages (production prompt)', { skip }, async () => {
  const system = makeProductionSystemPrompt('private')
  for (const s of scenarios.filter(x => x.kind === 'private')) {
    const decision = await callModel(system, privatePayload(s.msg))
    const script = String(decision.script ?? '')
    // Fix 6：只检查"未被提供的额外人名/电话号码"——正常描写当前消息到达不算。
    // 用户消息内容是 s.msg（已知），检查是否出现完全不同的具体人名或号码。
    const knownNames = ['她', '他', '主角', '朋友', '对方']
    // Fix P3：拓宽幻觉检测——除电话号码外，还检查模型是否编造了未被提供的
    // 第三方发言行为（如"小明说""朋友回复了""X发来消息"）。
    const phonePattern = /1[3-9]\d{9}/
    const hasUnknownPhone = phonePattern.test(script) && !phonePattern.test(s.msg)
    assert.ok(!hasUnknownPhone, `${s.label}: 不应自造电话号码`)
    // 检查编造的第三方发言——当前消息内容是 s.msg（已知），模型不应描写
    // 任何"额外的人发来了消息"的行为。正常的用户消息到达由 currentEvent 提供。
    // Fix P4（2026-11-10 验证修复）：原正则会把主角对用户消息的正常内心
    // 评述（"这人倒是问得直接"→前缀"倒是"被当发言人）误报为编造第三方。
    // 说/问/回复前的叙述性副词与已提供的指称（朋友见 recentScript）不算；
    // 只有未知具名主体 + 言语动词才是违规。
    const NARRATION_OR_KNOWN = ['她', '他', '你', '我', '它', '朋友', '主角', '对方', '用户', '这人', '那人',
      '倒是', '直接', '还是', '又', '再', '便', '就', '才', '只', '也', '先', '没', '不',
      '开口', '笑着', '忍不住', '随口', '顺口', '轻声', '低声', '小声', '想了想']
    const inventedSpeaker = /[^\s你她他我它,，。.:"「」『』]{1,4}(?:说|问|回复|发来|发消息|发了一句)/.exec(script)
    const speakerPrefix = inventedSpeaker ? inventedSpeaker[0].replace(/(?:说|问|回复|发来|发消息|发了一句)$/, '') : ''
    const isInvented = !!inventedSpeaker
      && !s.msg.includes(inventedSpeaker[0].slice(0, 2))
      && !NARRATION_OR_KNOWN.some(word => speakerPrefix === word || speakerPrefix.endsWith(word))
    assert.ok(!isInvented, `${s.label}: 不应编造第三方发言（found "${inventedSpeaker?.[0]}"）`)
  }
})
