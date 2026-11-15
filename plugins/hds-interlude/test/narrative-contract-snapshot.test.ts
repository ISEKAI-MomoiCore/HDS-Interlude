import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { systemPrompt } from '../src/narrator'

/** D2.5 合约快照矩阵（解耦设计 §4.5 / §6 D2.5 验收）：
 * 六个场景的 systemPrompt 渲染与参数化改造**之前**的基线逐字节一致
 * （sha256 于 2026-10-30 改造前捕获）。任何无意改动合约文本的提交都会
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

/** P3.2 后基线（2026-11-13 重算；diff 摘要见文件头注释）。 */
const BASELINE: Record<string, { length: number, sha256: string }> = {
  single: { length: 26658, sha256: '2c1cf5631d63d679c31e7496fcfb3a2982918a230e6b4db1efc5cc4528962da1' },
  dual: { length: 27561, sha256: '8d6de7d51bbf6242cbd115f6fec93a0f66eeeb748b139acb9cd71d734738a3c6' },
  dualCacheFirst: { length: 28420, sha256: '27ac85c77694bfa1fd38f48ed9115c119d944e3081fc65a9868b6ea4d09bd3cb' },
  dualSelection: { length: 28443, sha256: '01b43898eb486653f9e915d155b4781c0e47907e44e6592c9316537d59d8d64d' },
  withFaces: { length: 28373, sha256: '2eca3502681845d60d8e444e7efccb9ab5a50ff186e1201860650fade56e9254' },
  liteDual: { length: 8212, sha256: '8849b68ac784fa317722a676164029d795c1aaaefc3f2a846a576fd4d31b636a' },
}

const scenarios: Record<string, string> = {
  single: build({ features: { multiPlatform: false } }),
  dual: build({ features: {} }),
  dualCacheFirst: build({ cacheFirst: true, features: {} }),
  dualSelection: build({ channelSelection: true, features: {} }),
  withFaces: build({ capabilities: caps, features: {} }),
  liteDual: build({ specialty: { tier: 'lite', family: 'generic' } as any, features: {} }),
}

test('D2.5 合约快照：六个场景与参数化前基线逐字节一致', () => {
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
