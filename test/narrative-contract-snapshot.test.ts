import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { systemPrompt } from '../src/narrator'

/** D2.5 合约快照矩阵（解耦设计 §4.5 / §6 D2.5 验收）：
 * 初始基线在 2026-10-30 参数化改造之前捕获，后随有意调整更新。任何无意改动合约文本的提交都会
 * 在此变红；有意的合约变更须同步更新哈希并在 CHANGELOG 说明。
 * 平台词汇经 PlatformWording 参数注入——override 测试证明注入点生效。
 * 2026-11-10 有意变更后重算五个 full 档基线：II-2 回复时机元语言段 +
 * II-1 interactionRhythm 字段说明（设计 v2.4 §4；lite 档不变）。 */
/** 2026-11-13 P3.2 重基线（advance 相位 legacy schema 退役 + 端点措辞格式中立）。
 * 与 2026-11-12 基线的逐字节 diff 逐场景核对，差异全部落在两处共享行：
 * - 五个 full 档场景各 +28 字符，全部来自 CROSS-CHANNEL DELIVERY 行的
 *   "pair that script action with the CONTACT ACTIONS contract (a group
 *   target entry; on live user-message turns the legacy crossConversationActions
 *   group form also remains accepted)" 配对句（user-message live 回合保留
 *   legacy crossConversationActions，但群发配对指向 CONTACT ACTIONS 契约）。
 * - dualSelection 在上述 +28 之外另有 +55 字符，来自 MULTI-PLATFORM
 *   TRANSPORT SELECTION 行 endpointId 措辞格式中立化：
 *   'add "endpointId" inside the action object (communicationActions target,
 *   or crossConversationActions on live turns)' 取代旧的
 *   'add "endpointId" inside the crossConversationActions object'。
 * - liteDual 逐字节不变（sha 一致，沿用旧基线）。六个场景的其余文本零差异。 */

type Vars = Partial<Record<'phase' | 'mainPrompt' | 'formatPrompt' | 'fixedPrompt' | 'baseStyle' | 'storyStyle'
  | 'refreshContinuity' | 'alter' | 'agency' | 'perspective' | 'recovery' | 'capabilities' | 'hasQuote'
  | 'stickerCatalog' | 'preplan' | 'streaming' | 'cacheFirst' | 'groupTurn' | 'writingOptions' | 'specialty'
  | 'proactive' | 'channelSelection' | 'longHorizon' | 'features' | 'platformWording', any>>

const build = (v: Vars) => systemPrompt(
  v.phase ?? 'user-message', v.mainPrompt ?? '', v.formatPrompt ?? '', v.fixedPrompt ?? '', v.baseStyle ?? '', v.storyStyle ?? '',
  v.refreshContinuity ?? false, v.alter ?? false, v.agency ?? false, v.perspective ?? false, v.recovery ?? false,
  v.capabilities, v.hasQuote ?? false, v.stickerCatalog, v.preplan ?? false, v.streaming ?? false,
  v.cacheFirst ?? false, v.groupTurn ?? false, v.writingOptions, v.specialty, v.proactive,
  v.channelSelection ?? false, v.longHorizon, v.features, v.platformWording)

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const caps = { quoteReply: true, reactions: [] as string[], nativeFaces: ['smile'], expressionThreshold: 0.7 } as any

/** 2026-11-25 有意更新：事件事实与注意度语义、私聊草稿/发送/计划示例。 */
const BASELINE: Record<string, { length: number, sha256: string }> = {
  single: { length: 27687, sha256: '0385618f5b45dde5cc0eba1bf88253b3145b4cb2c1c78d6b3462aab7e829d66d' },
  dual: { length: 28590, sha256: 'a795c6fb0d41f479ba7c93a4d51a1355131d315bf919047eba7452713ae15214' },
  dualCacheFirst: { length: 29449, sha256: '37378c39698365f55fb2fe808eb0cc7e2d9df17bd3b9c22d7d2f8fa117898081' },
  dualSelection: { length: 29472, sha256: '0db928fb5345f7f816d266c6a0d4812cefb4d9a214bfd715cac5c14e74883b96' },
  withFaces: { length: 29402, sha256: 'e3c1b8a7c0e95252602f630809e941bcbdf8000e962e5d3e93ad020929cd8c9e' },
  liteDual: { length: 9986, sha256: 'bb56b213ec2a86e97f4c1a08fc33d9853270efe1110cebce9cb4280639d4372a' },
}

const scenarios: Record<string, string> = {
  single: build({ features: { multiPlatform: false } }),
  dual: build({ features: {} }),
  dualCacheFirst: build({ cacheFirst: true, features: {} }),
  dualSelection: build({ channelSelection: true, features: {} }),
  withFaces: build({ capabilities: caps, features: {} }),
  liteDual: build({ specialty: { tier: 'lite', family: 'generic' } as any, features: {} }),
}

test('D2.5 合约快照：六个场景与当前合约基线逐字节一致', () => {
  for (const [name, prompt] of Object.entries(scenarios)) {
    const base = BASELINE[name]
    assert.equal(prompt.length, base.length, `${name} 长度应与基线一致`)
    assert.equal(sha(prompt), base.sha256, `${name} sha256 应与基线一致（无意改动合约文本会在此变红）`)
  }
})

test('D2.5 六段平台措辞的注入点全部生效（QQ 字面量仍为默认）', () => {
  assert.ok(scenarios.single.includes('a host-generated tag such as [QQ·私] or [QQ·群] records'))
  assert.ok(scenarios.liteDual.includes('The protagonist may use QQ and WeChat; a friend appearing on both'))
  assert.ok(scenarios.dual.includes('may simultaneously use QQ and WeChat.'))
  assert.ok(scenarios.dual.includes('The QQ number inside it is the stable identity'))
  assert.ok(scenarios.dualSelection.includes('this story currently has usable QQ and WeChat endpoints'))
  assert.ok(scenarios.withFaces.includes('For a subtle native QQ face, return nativeFace'))
})

test('D2.5 词汇注入：自定义 wording 只替换对应措辞，其余文本不变', () => {
  const custom = build({
    features: {},
    channelSelection: true,
    capabilities: caps,
    platformWording: {
      faceTerm: 'native Telegram emoji',
      stableIdTerm: 'Telegram user id',
      platformPair: 'Telegram and Discord',
      tagListDual: '[TG·私], [DC·私], [TG·群] or [DC·群]',
      tagListSingle: '[TG·私] or [TG·群]',
    },
  })
  assert.ok(custom.includes('For a subtle native Telegram emoji, return nativeFace'))
  assert.ok(custom.includes('may simultaneously use Telegram and Discord.'))
  assert.ok(custom.includes('The Telegram user id inside it is the stable identity'))
  assert.ok(custom.includes('usable Telegram and Discord endpoints'))
  assert.ok(custom.includes('[TG·私], [DC·私], [TG·群] or [DC·群]'))
  // 与自定义词等长的默认渲染对照：默认文本中的 QQ 字面量在 custom 中全部消失。
  assert.ok(!custom.includes('QQ and WeChat'), '自定义平台对不应再出现默认 QQ 字面量')
  assert.ok(!custom.includes('native QQ face'), '表情措辞应被替换')
})


test('world and social records do not establish character perception in any contract tier', () => {
  for (const tier of ['full', 'standard', 'lite']) {
    const specialty = { tier, family: 'generic' }
    const prompt = build({ specialty, features: { worldEvents: true, qzone: true } })
    assert.match(prompt, /A weather snapshot establishes conditions at the observation time; it does not establish when they began, how long they lasted, or whether she noticed them/)
    assert.match(prompt, /\[好友动态\] records platform activity, not that she saw it or that her device notified her/)
    assert.match(prompt, /A record of new comments does not establish that she saw or read them/)
    assert.doesNotMatch(prompt, /feed activity she has noticed/)
    assert.doesNotMatch(build({ specialty, features: { qzone: false } }), /SOCIAL SURFACE/)
  }
})

test('private reply examples follow split settings without leaking into group or advance turns', () => {
  for (const tier of ['full', 'standard', 'lite']) {
    const specialty = { tier, family: 'generic' }
    const buildSend = (v: Vars) => build({ specialty, ...v }).split('\n').find(line => line.startsWith('SENT BY NOW:'))
    assert.match(buildSend({ writingOptions: { messageSeparator: '[bubble]' } })!, /"mode":"immediate","content":"行\[bubble\]几点啊？"/)
    assert.match(buildSend({ writingOptions: { splitReplyMessages: false } })!, /"mode":"immediate","content":"行"/)
    assert.match(buildSend({ phase: 'conversation-follow-up' })!, /"seen":false/)
    assert.equal(buildSend({ groupTurn: true }), undefined)
    assert.equal(buildSend({ phase: 'advance' }), undefined)
  }
  const streaming = build({ streaming: true })
  assert.match(streaming, /SCRIPT-FIRST TRANSPORT MIRROR/)
  assert.match(streaming, /SENT BY NOW:.*"mode":"immediate"/)
})
