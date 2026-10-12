import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, version } from '../src/index'
import { hasRequiredNarrativeScript, normalizeGroupVisibleReply, normalizeInteraction, requiresVisibleReplyRecovery, resolveBlindModeConfig, visibleReplyMode } from '../src/service'
import { configuredProviders, withDeepSeekThinking, ZHIPU_FIRST_VISIBLE_TOKEN_TIMEOUT } from '../src/narrator'
import { HDS_INTERLUDE_VERSION } from '../src/meta'
import { DEFAULT_AGENCY_CONFIG, resolveAgencyConfig } from '../src/agency'

const now = new Date('2026-09-09T12:00:00Z')

test('Console sections follow the documented setup order', () => {
  assert.deepEqual(Object.keys(Config.dict), [
    'storyDefaults', 'model', 'onebot', 'sharedStory', 'runtime', 'urge', 'schedulePreplan', 'timelineDirector', 'agency',
    'chatActions', 'stickers', 'memory', 'alterSystem', 'browser', 'worldSeeder', 'longHorizon', 'qzone', 'presetSync', 'weather', 'blindMode', 'logging', 'mainPrompt', 'chatRhythm',
  ])
  // 分类前缀让配置页按 必填→结构→节奏→表达→内在→扩展→维护 分组可读。
  const headers = Object.values(Config.dict).map((item: any) => String(item.meta?.description ?? ''))
  assert.match(headers[0], /^【必填 1】/)
  assert.match(headers[3], /^【结构 4】/)
  assert.match(headers[4], /^【节奏 5】/)
  assert.match(headers[9], /^【表达 10】/)
  assert.match(headers[11], /^【内在 12】/)
  assert.match(headers[13], /^【扩展 14】/)
  assert.match(headers[14], /^【扩展 15】/)
  assert.match(headers[15], /^【扩展 16】/)
  assert.match(headers[16], /^【扩展 17】/)
  assert.match(headers[17], /^【扩展 18】预设同步/)
  assert.match(headers[18], /^【扩展 19】运行时天气/)
  assert.match(headers[19], /^【维护 20】/)
  assert.match(headers[20], /^【维护 21】/)
})

test('chat actions are opt-in and platform-scoped', () => {
  const actions = Config.dict.chatActions.dict
  assert.equal(actions.enabled.meta.default, false)
  assert.deepEqual(actions.platforms.meta.default, ['qq'])
  assert.equal(actions.quoteReply.meta.default, true)
  assert.equal(actions.messageReactions.meta.default, true)
  assert.equal(actions.nativeFaces.meta.default, true)
  assert.equal(actions.expressionThreshold.meta.default, 0.7)
})

test('local sticker library is opt-in and requires an explicitly assigned visual provider', () => {
  const stickers = Config.dict.stickers.dict
  assert.equal(stickers.enabled.meta.default, false)
  assert.equal(stickers.directory.meta.default, 'data/hds-interlude/stickers')
  assert.equal(stickers.catalogLimit.meta.default, 40)
  assert.equal(stickers.descriptionResponseFormat.meta.default, 'json-object')
})

test('Blind Mode defaults to a minimal ten-minute heartbeat', () => {
  const blindMode = Config.dict.blindMode.dict
  assert.equal(blindMode.enabled.meta.default, false)
  assert.equal(blindMode.healthReportMinutes.meta.default, 10)
  assert.deepEqual(resolveBlindModeConfig(), { enabled: false, healthReportMinutes: 10 })
  assert.deepEqual(resolveBlindModeConfig({ enabled: true, healthReportMinutes: 2 }), { enabled: true, healthReportMinutes: 2 })
})

test('ignored compatibility switches stay out of the active Console', () => {
  assert.equal('enabled' in Config.dict.sharedStory.dict, false)
  assert.equal('pauseAfterConversationMinutes' in Config.dict.runtime.dict, false)
  assert.equal('staleNarrativeRequestWindowSeconds' in Config.dict.runtime.dict, false)
  assert.equal(Config.dict.runtime.dict.userMessageDebounceSeconds.meta.default, 2)
})

test('runtime and plugin exports share one version constant', () => {
  assert.equal(version, HDS_INTERLUDE_VERSION)
  assert.equal(version, '1.0.1-rc50')
})

test('layered colored logs are the Console default and remain optional', () => {
  const logging = Config.dict.logging.dict
  assert.equal(logging.format.meta.default, 'layered')
  assert.equal(logging.colors.meta.default, true)
  assert.equal(logging.colorTheme.meta.default, 'dark')
  assert.equal(logging.kaomoji.meta.default, true)
})

test('model Console centralizes connections and task assignment without exposing IDs', () => {
  const model = Config.dict.model.dict
  assert.deepEqual(Object.keys(model).slice(0, 3), ['vision', 'audio', 'providers'])
  assert.equal('mode' in model, false)
  assert.equal('zhipu' in model, false)
  assert.equal('models' in model, false)
  assert.equal('mainModelId' in model, false)
  assert.equal(model.mainResponseFormat.meta.default, 'json-object')
  assert.equal(model.mainStreamingMode.meta.default, 'off')
  assert.equal(model.vision.dict.mode.meta.default, 'native')
  assert.equal(model.vision.dict.detail.meta.default, 'auto')
  assert.equal(configuredProviders({ providers: [{ label: 'Vision', enabled: true, endpoint: 'https://example.test', model: 'vision', useForVision: true }] } as any)[0].useForVision, true)
})

test('Zhipu official provider mode supplies its fixed endpoint and stream-capable task roles', () => {
  const providers = configuredProviders({ mode: 'openai-compatible', providers: [{
    label: 'Zhipu', enabled: true, mode: 'zhipu-official', apiKey: 'test',
    model: 'glm-5.3-flash', reasoningEffort: 'high', useForMain: true,
  }] } as any)
  assert.equal(providers.length, 1)
  assert.equal(providers[0].endpoint, 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
  assert.equal(providers[0].model, 'glm-5.3-flash')
  assert.equal(providers[0].zhipuOfficial, true)
  assert.equal(providers[0].useForEmbedding, false)
  assert.equal(ZHIPU_FIRST_VISIBLE_TOKEN_TIMEOUT, 45_000)
})

test('official provider presets resolve independent Chat Completions endpoints', () => {
  const providers = configuredProviders({ mode: 'openai-compatible', providers: [
    { label: 'OpenAI', enabled: true, mode: 'openai-official', apiKey: 'x', model: 'gpt-5-mini' },
    { label: 'DeepSeek', enabled: true, mode: 'deepseek-official', apiKey: 'x', model: 'deepseek-chat' },
    { label: 'Moonshot', enabled: true, mode: 'moonshot-official', apiKey: 'x', model: 'kimi-k2.5' },
    { label: 'DashScope', enabled: true, mode: 'dashscope-official', apiKey: 'x', model: 'qwen-plus', dashscopeRegion: 'singapore' },
    { label: 'SiliconFlow', enabled: true, mode: 'siliconflow-official', apiKey: 'x', model: 'Qwen/Qwen3-8B' },
    { label: 'OpenRouter', enabled: true, mode: 'openrouter', apiKey: 'x', model: 'openai/gpt-5-mini' },
    { label: 'Gemini', enabled: true, mode: 'gemini-openai', apiKey: 'x', model: 'gemini-2.5-flash' },
  ] } as any)
  assert.deepEqual(providers.map(item => item.endpoint), [
    'https://api.openai.com/v1/chat/completions',
    'https://api.deepseek.com/v1/chat/completions',
    'https://api.moonshot.cn/v1/chat/completions',
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    'https://api.siliconflow.cn/v1/chat/completions',
    'https://openrouter.ai/api/v1/chat/completions',
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  ])
})

test('DeepSeek official provider exposes independent thinking controls', () => {
  const [provider] = configuredProviders({ mode: 'openai-compatible', providers: [{
    label: 'DeepSeek', enabled: true, mode: 'deepseek-official', apiKey: 'x', model: 'deepseek-chat', useForMain: true,
  }] } as any)
  assert.equal(provider.deepseekOfficial, true)
  assert.equal(provider.deepseekThinking, 'disabled')
  assert.equal(provider.deepseekReasoningEffort, 'low')
})

test('OpenAI-compatible providers expose inherit thinking control by default', () => {
  const [provider] = configuredProviders({ mode: 'openai-compatible', providers: [{
    label: 'DeepSeek gateway', enabled: true, mode: 'openai-compatible', apiKey: 'x', model: 'deepseek-v4-pro', useForMain: true,
  }] } as any)
  assert.equal(provider.deepseekOfficial, false)
  assert.equal(provider.deepseekThinking, 'inherit')
  assert.equal(provider.deepseekReasoningEffort, 'low')
  assert.deepEqual(withDeepSeekThinking(provider, { model: provider.model, thinking: { type: 'gateway-default' } }), {
    model: provider.model, thinking: { type: 'gateway-default' },
  })
})

test('Explicit compatible-provider thinking control overrides extraBody thinking', () => {
  const base = {
    model: 'deepseek-v4-pro',
    thinking: { type: 'enabled' },
    reasoning_effort: 'max',
    messages: [],
  }
  const [disabled] = configuredProviders({ mode: 'openai-compatible', providers: [{
    label: 'DeepSeek gateway', enabled: true, mode: 'openai-compatible', apiKey: 'x', model: base.model,
    deepseekThinking: 'disabled', extraBody: JSON.stringify(base),
  }] } as any)
  assert.deepEqual(withDeepSeekThinking(disabled, base), {
    model: base.model, thinking: { type: 'disabled' }, messages: [],
  })

  const [enabled] = configuredProviders({ mode: 'openai-compatible', providers: [{
    label: 'DeepSeek gateway', enabled: true, mode: 'openai-compatible', apiKey: 'x', model: base.model,
    deepseekThinking: 'enabled', deepseekReasoningEffort: 'high',
  }] } as any)
  assert.deepEqual(withDeepSeekThinking(enabled, base), {
    model: base.model, thinking: { type: 'enabled' }, reasoning_effort: 'high', messages: [],
  })
})

test('Agency Window exposes only the four bounded scheduling controls', () => {
  const agency = Config.dict.agency.dict
  assert.deepEqual(Object.keys(agency), [
    'enabled', 'maxWindowMinutes', 'minimumProactiveIntervalMinutes', 'maxCandidateHours',
    'contactMode', 'naturalWillingnessThreshold', 'naturalMinimumIntervalMinutes', 'proactiveDailyCap',
  ])
  assert.equal(agency.enabled.meta.default, false)
  assert.equal(agency.maxWindowMinutes.meta.default, 240)
  assert.equal(agency.contactMode.meta.default, 'strict')
  assert.equal(agency.proactiveDailyCap.meta.default, 3)
})

test('Schedule Preplan is lightweight, enabled by default and reuses the compaction provider', () => {
  const schedule = Config.dict.schedulePreplan.dict
  assert.deepEqual(Object.keys(schedule), ['enabled', 'horizonDays', 'variationLevel', 'candidateActivationProbability', 'candidateRevealMinutes', 'reviewAfterLocalHour', 'anchorAutoAdvance'])
  assert.equal(schedule.enabled.meta.default, true)
  assert.equal(schedule.horizonDays.meta.default, 14)
  assert.equal(schedule.variationLevel.meta.default, 'stable')
  assert.equal('modelId' in schedule, false)
  assert.equal('providerId' in schedule, false)
})

test('real model turns require non-empty narrative prose before they can succeed', () => {
  assert.equal(hasRequiredNarrativeScript({ script: '主角收起手机，继续往前走。' }), true)
  assert.equal(hasRequiredNarrativeScript({ script: '   \n' }), false)
  assert.equal(hasRequiredNarrativeScript({ interaction: { seen: true, reply: { mode: 'none' } } }), false)
})

test('memory compaction defaults leave a slightly wider short-conversation buffer', () => {
  const memory = Config.dict.memory.dict
  assert.equal(memory.sceneEntryThreshold.meta.default, 16)
  assert.equal(memory.sceneCharacterThreshold.meta.default, 10_000)
})

test('recent context combines a thirty-five-entry floor with a 45-minute raw-message window', () => {
  const runtime = Config.dict.runtime.dict
  assert.equal(runtime.contextEntryLimit.meta.default, 35)
  assert.equal(runtime.contextTimeWindowMinutes.meta.default, 45)
})

test('Console exposes a separate, optional protagonist perspective layer', () => {
  assert.equal(Config.dict.storyDefaults.dict.perspective.meta.default, '')
})

test('native audio understanding remains an opt-in main-model capability', () => {
  const audio = Config.dict.model.dict.audio.dict
  assert.equal(audio.enabled.meta.default, false)
  assert.equal(audio.outFormat.meta.default, 'mp3')
  assert.equal(audio.maxFileSizeMB.meta.default, 10)
  assert.equal(audio.maxPerMessage.meta.default, 1)
  assert.equal(Config.dict.onebot.dict.voiceTranscription, undefined)
})

test('group willingness is opt-in and remains scoped to each group rule', () => {
  const willingness = Config.dict.onebot.dict.groupChats.inner.dict.willingness.dict
  assert.equal(willingness.enabled.meta.default, false)
  assert.equal(willingness.decayHalfLifeSeconds.meta.default, 180)
  assert.equal(willingness.threshold.meta.default, 0.24)
})

test('group transport accepts its explicit field and the legacy immediate interaction fallback', () => {
  assert.equal(normalizeGroupVisibleReply({ mode: 'immediate', content: '群内回复' }, undefined, 100), '群内回复')
  assert.equal(normalizeGroupVisibleReply(undefined, { seen: true, reply: { mode: 'immediate', content: '兼容回复' } }, 100), '兼容回复')
  assert.equal(normalizeGroupVisibleReply(undefined, { seen: true, reply: { mode: 'none' } }, 100), '')
  assert.equal(normalizeGroupVisibleReply({ mode: 'immediate', content: '[表情]' }, undefined, 100), '')
  assert.equal(normalizeGroupVisibleReply({ mode: 'immediate', content: '第一句<sep>第二句' }, undefined, 100), '第一句<sep/>第二句')
  assert.equal(normalizeGroupVisibleReply({ mode: 'immediate', content: '第一句＜sep＞第二句' }, undefined, 100), '第一句<sep/>第二句')
})

test('reply-mode logs distinguish missing live replies from normal background silence', () => {
  assert.equal(visibleReplyMode({}, 'user-message'), '未提供或无效')
  assert.equal(visibleReplyMode({}, 'conversation-follow-up'), '无可见投递')
  assert.equal(visibleReplyMode({}, 'advance'), '无可见投递')
  assert.equal(visibleReplyMode({ crossConversationActions: [{ participantId: 'friend', mode: 'immediate', content: '在吗' }] }, 'advance'), '主动联系')
  assert.equal(visibleReplyMode({ interaction: { seen: true, reply: { mode: 'none' } } }, 'intent-due'), 'none')
})

test('a silent turn that carries an actionId no longer hard-fails the turn', () => {
  // 弱模型矛盾形态：剧本写她在回复，interaction 却给 mode=none + 自造 actionId。
  // 救援策略改为就地解析（锚定 say 行动则翻转 immediate，见 beta6-handoff 测试），
  // 解析不到按合法沉默放行——重写无法改变模型的稳定输出习惯，硬失败只会让
  // 故事停摆（beta7 实测教训：连续两稿同形态 → 整回合失败循环）。
  const contradictory = { interaction: { seen: true, reply: { mode: 'none' as const, actionId: 'reply-17729' } } }
  assert.equal(requiresVisibleReplyRecovery('user-message', undefined, contradictory), false)
  const silent = { interaction: { seen: true, reply: { mode: 'none' as const } } }
  assert.equal(requiresVisibleReplyRecovery('user-message', undefined, silent), false)
  const missing = {}
  assert.equal(requiresVisibleReplyRecovery('user-message', undefined, missing), true)
  assert.equal(requiresVisibleReplyRecovery('advance', undefined, contradictory), false)
})

test('normalizeInteraction keeps seen and reply independent so unread silence cannot erase a sent message', () => {
  const runtime = { maxMessageCharacters: 500, messageSeparator: '<sep/>', minimumDelayedReplySeconds: 10, maximumDelayedReplyMinutes: 120 }
  // 已读不回：合法状态，原样保留。
  assert.deepEqual(normalizeInteraction({ seen: true, reply: { mode: 'none' } }, now, runtime as any),
    { seen: true, reply: { mode: 'none' } })
  // 未读沉默：合法状态。
  assert.deepEqual(normalizeInteraction({ seen: false, reply: { mode: 'none' } }, now, runtime as any),
    { seen: false, reply: { mode: 'none' } })
  // 跟进/到期回合协议规定 seen=false，但真实发送的回复不得被抹掉。
  assert.deepEqual(normalizeInteraction({ seen: false, reply: { mode: 'immediate', content: '想起来还没回你' } }, now, runtime as any),
    { seen: false, reply: { mode: 'immediate', content: '想起来还没回你' } })
  // immediate 缺 content 与非法 mode 的既有语义不变。
  assert.deepEqual(normalizeInteraction({ seen: false, reply: { mode: 'immediate' } }, now, runtime as any),
    { seen: false, reply: { mode: 'none' } })
  assert.equal(normalizeInteraction({ seen: true, reply: { mode: 'later' } }, now, runtime as any), undefined)
  // DeepSeek V4.1 修复：漏 seen 布尔不得丢弃整条回复（否则剧本有回复、传输变 none）。
  assert.deepEqual(normalizeInteraction({ reply: { mode: 'immediate', content: '漏了seen但回复有效' } }, now, runtime as any),
    { seen: true, reply: { mode: 'immediate', content: '漏了seen但回复有效' } })
  assert.deepEqual(normalizeInteraction({ reply: { mode: 'none' } }, now, runtime as any),
    { seen: true, reply: { mode: 'none' } })
  // reply 不是对象仍整体无效（无从恢复）。
  assert.equal(normalizeInteraction({ seen: true, reply: 'immediate' }, now, runtime as any), undefined)
})

test('delayed replies outside the allowed window still collapse to none regardless of seen', () => {
  const runtime = { maxMessageCharacters: 500, messageSeparator: '<sep/>', minimumDelayedReplySeconds: 10, maximumDelayedReplyMinutes: 120 }
  const sendAt = new Date(now.getTime() + 5 * 60_000).toISOString()
  assert.deepEqual(normalizeInteraction({ seen: false, reply: { mode: 'delayed', content: '晚点说', sendAt } }, now, runtime as any),
    { seen: false, reply: { mode: 'delayed', content: '晚点说', sendAt } })
  const tooSoon = new Date(now.getTime() + 1_000).toISOString()
  assert.deepEqual(normalizeInteraction({ seen: true, reply: { mode: 'delayed', content: '太早', sendAt: tooSoon } }, now, runtime as any),
    { seen: true, reply: { mode: 'none' } })
})



test('visible Console section numbers are unique and continuous', () => {
  const numbers = Object.values(Config.dict).flatMap((item: any) => {
    const match = String(item.meta?.description ?? '').match(/^【[^】]+ (\d+)】/)
    return match ? [Number(match[1])] : []
  })
  assert.deepEqual(numbers, Array.from({ length: 21 }, (_, index) => index + 1))
})

test('candidate reveal description distinguishes inactive, vague and revealed candidates', () => {
  const description = Config.dict.schedulePreplan.dict.candidateRevealMinutes.meta.description
  assert.match(description, /未激活候选不显示/)
  assert.match(description, /已激活候选.*之前.*可能的个人安排/)
  assert.match(description, /进入揭示时间后显示具体内容/)
})

test('Agency is opt-in in both schema and runtime, preserving explicit user settings', () => {
  assert.equal(DEFAULT_AGENCY_CONFIG.enabled, false)
  assert.equal(resolveAgencyConfig().enabled, false)
  assert.equal(resolveAgencyConfig({}).enabled, false)
  assert.equal(resolveAgencyConfig({ enabled: false }).enabled, false)
  assert.equal(resolveAgencyConfig({ enabled: true }).enabled, true)
  const schema = Config.dict.agency
  assert.equal(schema({}).enabled, false)
  assert.equal(schema({ enabled: false }).enabled, false)
  assert.equal(schema({ enabled: true }).enabled, true)
})
