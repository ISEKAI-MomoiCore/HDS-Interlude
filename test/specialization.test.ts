import assert from 'node:assert/strict'
import test from 'node:test'
import { inferSpecialty } from '../src/specialization'
import { systemPrompt, OpenAICompatibleNarrator } from '../src/narrator'

test('specialization tier inference follows the documented family rules', () => {
  const cases: Array<[string, string, string]> = [
    ['yunwu/gemini-3.7-flash', 'lite', 'gemini-flash'],
    ['gemini-3.8-flash', 'lite', 'gemini-flash'],
    ['gemini-3-pro-preview', 'standard', 'gemini'],
    ['claude-opus-5', 'full', 'claude'],
    ['claude-sonnet-4-6', 'full', 'claude'],
    ['gpt-5.5', 'full', 'gpt'],
    ['gpt-6-astra', 'full', 'gpt'],
    ['GLM-5.3', 'standard', 'glm'],
    ['zai-org/GLM-4.6', 'lite', 'glm'],
    ['kimi-k3', 'standard', 'kimi'],
    ['moonshotai/Kimi-K2.6', 'standard', 'kimi'],
    ['deepseek-ai/DeepSeek-V4-Flash', 'standard', 'deepseek'],
    ['deepseek-ai/DeepSeek-V3.2', 'standard', 'deepseek'],
    ['grok-4.5', 'lite', 'grok'],
    ['grok-4.20-beta', 'lite', 'grok'],
    ['qwen3-max', 'full', 'generic'],
  ]
  for (const [model, tier, family] of cases) {
    const p = inferSpecialty(model)
    assert.equal(`${model}: ${p.tier}/${p.family}`, `${model}: ${tier}/${family}`)
  }
  assert.deepEqual(inferSpecialty('anything', 'off'), { tier: 'full', family: 'generic', source: 'manual', probe: 'anything' })
  assert.equal(inferSpecialty('glm-4.6', 'full').tier, 'full')
  assert.equal(inferSpecialty('claude-opus-5', 'lite').tier, 'lite')
})

test('systemPrompt without specialty stays byte-identical to the rc12 contract', () => {
  const s = systemPrompt('user-message', '', '', '', '', '')
  assert.doesNotMatch(s, /say id=/)
  assert.match(s, /EVIDENCE AND EXPECTATION/)
  assert.match(s, /Length follows what actually happens: give actions and shifts of attention room to develop/)
  assert.match(s, /Each reply is an independent choice/)
})

test('LITE contract trims to the core and applies the gemini-flash family blocks', () => {
  const s = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'lite', family: 'gemini-flash', source: 'auto', probe: 'gemini-3.7-flash' })
  // 核心裁剪：不含知识框架、跨渠道、say 锚点教学
  assert.doesNotMatch(s, /EVIDENCE AND EXPECTATION/)
  assert.doesNotMatch(s, /CROSS-CHANNEL DELIVERY/)
  assert.doesNotMatch(s, /SCRIPT-FIRST TRANSPORT MIRROR/)
  // 防幻觉三件套与协议保留
  assert.match(s, /Never invent an incoming message/)
  assert.match(s, /ownership label that is authoritative/)
  assert.match(s, /TRANSPORT: reply.content/)
  assert.match(s, /Return one JSON object with a continuous prose field named script first/)
  // gemini-flash 特化块;"朴素具体"register 块已删(与 length 块同义反复)
  assert.match(s, /plain nouns and specific verbs carry the scene/)
  assert.doesNotMatch(s, /Prose register: concrete and unadorned/)
  assert.match(s, /Each reply is an independent choice/)
  // L4: lite 时钟冲突仲裁句
  assert.match(s, /If older prose says night but interval\.nowLocal says 16:00\/afternoon/)
})

test('STANDARD keeps the full contract with content-only transport and family extras', () => {
  const glm = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'standard', family: 'glm', source: 'auto', probe: 'glm-5.3' })
  assert.match(glm, /EVIDENCE AND EXPECTATION/)
  assert.match(glm, /CROSS-CHANNEL DELIVERY/)
  assert.doesNotMatch(glm, /say id=/)
  assert.doesNotMatch(glm, /SCRIPT-FIRST TRANSPORT MIRROR/)
  assert.match(glm, /Emotional register: let mood follow its actual causes/)

  const kimi = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'standard', family: 'kimi', source: 'auto', probe: 'kimi-k3' })
  assert.match(kimi, /ambivalence is a normal state, not a problem to resolve/)

  const deepseek = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'standard', family: 'deepseek', source: 'auto', probe: 'deepseek-v4' })
  assert.match(deepseek, /the unadorned noun, the specific number, the plain verb/)
  // S1: standard 私聊轮补 interaction.seen 必填说明(此前只有 lite/full 有)
  assert.match(glm, /interaction\.seen is a required boolean/)
  assert.match(glm, /read-but-does-not-answer state/)
  // S3: deepseek 的 per-turn 必填限定在可回复轮,不再与 advance 的"无需 transport"矛盾
  assert.match(deepseek, /on every turn that can carry a reply/)
  assert.match(deepseek, /advance turns carry no transport unless a message is genuinely sent/)

  // S2: standard advance 轮补 crossConversationActions 形态说明
  const stdAdvance = systemPrompt('advance', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'standard', family: 'glm', source: 'auto', probe: 'glm-5.3' })
  assert.match(stdAdvance, /crossConversationActions:\[\{"participantId":"listed id"/)
  assert.match(stdAdvance, /An ordinary life passage needs no transport field/)
})

test('FULL tier applies claude/gpt blocks with simple protocol', () => {
  const claude = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'full', family: 'claude', source: 'auto', probe: 'claude-opus-5' })
  assert.match(claude, /When interaction is permitted/)
  assert.match(claude, /Scenes do not need tidy closure/)
  assert.match(claude, /Scenes do not need tidy closure/)

  const gpt = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'full', family: 'gpt', source: 'auto', probe: 'gpt-5.5' })
  assert.match(gpt, /each passage keeps moving/)
})

test('LITE group turns get the groupReply channel and grok gets the single-focus block', () => {
  const group = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, true, undefined,
    { tier: 'lite', family: 'gemini-flash', source: 'auto', probe: 'gemini-3.7-flash' })
  assert.match(group, /groupReply/)

  const grok = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'lite', family: 'grok', source: 'auto', probe: 'grok-4.5' })
  assert.match(grok, /One scene, one or two things happening/)
  assert.match(grok, /finish an action, then let time advance/)
})

test('decide() applies the manually selected tier with family auto-detection', async () => {
  const run = async (model: string, expectPattern: RegExp, modelConfig: Record<string, unknown> = {}) => {
    const bodies: any[] = []
    const narrator = new OpenAICompatibleNarrator({ http: { post: async (_url: string, body: any) => {
      bodies.push(body)
      return { choices: [{ message: { content: JSON.stringify({ script: '她继续着手头的事。', interaction: { seen: true, reply: { mode: 'none' } } }) } }] }
    } } } as any, { ...modelConfig, providers: [{ id: 't', label: 'test', enabled: true, useForMain: true, endpoint: 'https://example.test/chat', model, temperature: 0.8, topP: 1, maxTokens: 2048, timeout: 1000, responseFormat: 'json-object' }], failover: { enabled: false, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 } } as any, true)
    const now = new Date()
    await narrator.decide({ phase: 'user-message', from: now, now, story: { setting: { timezone: 'Asia/Shanghai' } as any, state: {} as any }, participant: null, participants: [], recentEntries: [], memories: [], dueIntents: [], supersededIntents: [], activeConsequences: [] } as any)
    assert.match(bodies[0].messages[0].content, expectPattern)
  }
  await run('gemini-3.7-flash', /plain nouns and specific verbs carry the scene/, { specialization: 'lite' })
  await run('claude-opus-5', /Scenes do not need tidy closure/, { specialization: 'full' })
  await run('glm-5.3', /Emotional register: let mood follow its actual causes/, { specialization: 'standard' })
  // 默认 off：即使模型名可识别也保持 rc12 原样
  await run('gemini-3.7-flash', /When interaction is permitted/)
  await run('grok-4.5', /When interaction is permitted/)
  // 家族显式指定：中转别名场景
  await run('mystery-relay-alias', /plain nouns and specific verbs carry the scene/, { specialization: 'lite', specializationFamily: 'gemini-flash' })
  // 家族 generic：档位生效但不套家族块
  await run('gemini-3.7-flash', /Length follows what actually happens:/, { specialization: 'lite', specializationFamily: 'generic' })
})

test('side-task prompts follow the same manual tier (lite compaction and timeline director)', async () => {
  const { compactionPrompt, timelineDirectorPrompt } = await import('../src/narrator')
  const lite = { tier: 'lite' as const }
  const full = { tier: 'full' as const }
  const cl = compactionPrompt('', '', '', '', lite)
  assert.match(cl, /Return JSON with scene\.summary and arc\.summary on every review/)
  assert.doesNotMatch(cl, /knowledge:\{mode/)
  assert.doesNotMatch(cl, /workingDetails/)
  assert.doesNotMatch(cl, /episodeTags/)
  assert.match(compactionPrompt('', '', '', '', full), /knowledge:\{mode/)
  const tl = timelineDirectorPrompt(lite)
  assert.match(tl, /Use 1-4 beats/)
  assert.doesNotMatch(tl, /recentScriptContinuation/)
  assert.match(timelineDirectorPrompt(full), /recentScriptContinuation/)
  assert.match(timelineDirectorPrompt(undefined), /recentScriptContinuation/)
})
