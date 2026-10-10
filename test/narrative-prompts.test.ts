import assert from 'node:assert/strict'
import test from 'node:test'
import { compactPromptEntries, promptVisibleMessageContent, recentScriptOwnership, storyStateForPrompt, systemPrompt } from '../src/narrator'
import { emptyStoryState } from '../src/types'

test('typed chat reference distinguishes outgoing text from prose in private, advance and group turns', () => {
  for (const [phase, group] of [['user-message', false], ['advance', false], ['user-message', true]] as const) {
    const prompt = systemPrompt(phase, '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, group)
    assert.equal(prompt.split('WRITING BELIEVABLE TYPED MESSAGES:').length - 1, 1)
    assert.match(prompt, /In the script, portray online messages/)
    assert.match(prompt, /not spoken dialogue transcribed/)
    assert.match(prompt, /Each reply is an independent choice/)
    assert.match(prompt, /not spoken dialogue transcribed/)
    assert.match(prompt, /Stickers and emoji-like images are a metalanguage/)
    assert.match(prompt, /FORMAT AND REALITY CONTRACT/)
  }
})

test('Alter scoring is requested only while the system is enabled', () => {
  const enabled = systemPrompt('user-message', '', '', '', '', '', false, true)
  assert.match(enabled, /integer field named alter from -5 to \+5/)
  assert.match(enabled, /not the existing atmosphere/)
  assert.match(enabled, /bounded internal weather/)
  assert.match(enabled, /may color the rhythm and form of her messages/)
  assert.match(enabled, /still choose their content and direction/)

  const disabled = systemPrompt('user-message', '', '', '', '', '', false, false)
  assert.doesNotMatch(disabled, /field named alter/)
})

test('current events lead reappraisal before relationship tendencies', () => {
  const prompt = systemPrompt('user-message', '', '', '', '', '', false, false)
  assert.match(prompt, /immediate relational thread/)
  assert.match(prompt, /established tendencies supply nuance/)
  assert.match(prompt, /New events can sustain or revise that reading/)
  assert.match(prompt, /a tendency is context, never a verdict/)
})

test('multi-platform transport selection is opt-in while single-platform prompts stay lightweight', () => {
  const single = systemPrompt('advance', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined, undefined, false)
  assert.doesNotMatch(single, /MULTI-PLATFORM TRANSPORT SELECTION/)
  assert.doesNotMatch(single, /availableOutgoingEndpoints/)

  const multi = systemPrompt('advance', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined, undefined, false, true)
  assert.match(multi, /MULTI-PLATFORM TRANSPORT SELECTION/)
  assert.match(multi, /endpointId is an HDSI transport endpoint identifier, not an HTTP API endpoint/)
  assert.match(multi, /add "endpointId" inside the crossConversationActions object/)
  assert.match(multi, /whose targetId matches that action's participantId/)
})

test('internal Alter accumulator and history never leak into the main prompt state', () => {
  const state = {
    ...emptyStoryState(),
    alterSystem: {
      alterValue: 8,
      alterWeight: 0.6,
      lastTriggerDirection: 1 as const,
      emotionalOffset: null,
      history: [],
      lastUpdatedAt: '2026-08-22T00:00:00.000Z',
    },
    agencyWindow: {
      activityLoad: 'free' as const,
      privacy: 'private' as const,
      deviceAccess: 'available' as const,
      validUntil: '2026-08-22T01:00:00.000Z',
      basis: '测试', sourceEntryIds: [1], updatedAt: '2026-08-22T00:00:00.000Z',
    },
  }
  const promptState = storyStateForPrompt(state)
  assert.equal('alterSystem' in promptState, false)
  assert.equal('agencyWindow' in promptState, false)
  assert.deepEqual(promptState.automation, {})
})

test('the fixed contract makes local endpoint time authoritative after long gaps', () => {
  const prompt = systemPrompt('user-message', '', '', '', '', '', false, false)
  assert.match(prompt, /interval\.nowLocalContext/)
  assert.match(prompt, /16:00\/afternoon/)
  assert.match(prompt, /continuity snapshot can be stale after reload or a long gap/i)
})

test('interrupted typing is context but never delivered speech', () => {
  const prompt = systemPrompt('user-message', '', '', '', '', '', false, false)
  assert.match(prompt, /interruptedOutgoingDrafts/)
  assert.match(prompt, /not words the user received/)
  assert.match(prompt, /never sent automatically/)
})

test('each request includes only its current phase strategy', () => {
  const user = systemPrompt('user-message', '', '', '', '', '', false, false)
  const advance = systemPrompt('advance', '', '', '', '', '', false, false)
  const followUp = systemPrompt('conversation-follow-up', '', '', '', '', '', false, false)
  const due = systemPrompt('intent-due', '', '', '', '', '', false, false)
  assert.match(user, /CURRENT PHASE: USER MESSAGE/)
  assert.match(user, /When interaction is permitted/)
  assert.match(user, /For this private turn, interaction describes ONLY messages to the current private participant/)
  assert.doesNotMatch(user, /return groupReply as/)
  assert.doesNotMatch(user, /INDEPENDENT LIFE ADVANCE/)
  assert.match(advance, /CURRENT PHASE: INDEPENDENT LIFE ADVANCE/)
  assert.match(advance, /independent-life phase/)
  assert.doesNotMatch(advance, /For this private turn, interaction describes ONLY messages to the current private participant/)
  assert.doesNotMatch(advance, /interruptedOutgoingDrafts/)
  assert.match(followUp, /aftertaste of/)
  assert.match(due, /CURRENT PHASE: DUE INTENT/)
  assert.match(due, /For this private turn, interaction describes ONLY messages to the current private participant/)
})

test('private interaction protocol is neutral about reading and explicit about read-but-silent', () => {
  const user = systemPrompt('user-message', '', '', '', '', '', false, false)
  // 协议是弱模型无法弄错的单步形态：示例即完整的 immediate+content 回复。
  // 契约里不出现 actionId——弱模型会抄引用却不写 say 标记，解析失败即静默丢弃
  // （实测 23k 完整提示词下 4/4 自造 actionId；content-only 契约 4/4 完美）。
  assert.doesNotMatch(user, /interaction as \{"seen":</)
  assert.doesNotMatch(user, /actionId/)
  assert.doesNotMatch(user, /say id=/)
  assert.match(user, /The content must be exactly the words the script shows her sending/)
  assert.match(user, /mode=none only when she sends nothing, and a silent turn carries no content/)
  // 已读不回是明确合法的普通状态。
  assert.match(user, /seen=true with reply\.mode=none is the ordinary read-but-does-not-answer state/)
  // 剧本里写了发送就必须 immediate——弱模型矛盾形态的提示词侧约束。
  assert.match(user, /Whenever the script shows her actually sending words to the current private participant, reply\.mode must be immediate/)
  // 未读计数是客观到达记录，不是注意力或义务。
  assert.match(user, /unreadMessageCount is the registered count of arrived messages not yet marked read/)
  // 跟进/到期回合：seen=false 不得再暗示回复必须为 none。
  const followUp = systemPrompt('conversation-follow-up', '', '', '', '', '', false, false)
  assert.doesNotMatch(followUp, /say id=/)
})

test('a missing visible-reply structure triggers a fresh-output recovery instruction', () => {
  const ordinary = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false)
  const recovery = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, true)
  assert.doesNotMatch(ordinary, /OUTPUT RECOVERY/)
  assert.match(recovery, /OUTPUT RECOVERY/)
  assert.match(recovery, /fresh unpublished decision/)
})

test('recent script ownership makes narrative thoughts unambiguously protagonist-owned', () => {
  assert.equal(recentScriptOwnership({ kind: 'script', actor: 'narrator' }), 'protagonist-narrative')
  assert.equal(recentScriptOwnership({ kind: 'user-message', actor: 'user' }), 'user-delivered-message')
  assert.equal(recentScriptOwnership({ kind: 'character-message', actor: 'character' }), 'protagonist-delivered-message')
  assert.equal(recentScriptOwnership({ kind: 'group-message', actor: 'user' }), 'external-group-message')
  assert.equal(recentScriptOwnership({ kind: 'intent-cancelled', actor: 'system' }), 'system-event')

  const prompt = systemPrompt('user-message', '', '', '', '', '', false, false)
  assert.match(prompt, /ownership label is authoritative/)
  assert.match(prompt, /a thought about the user is not a thought by the user/)
})

test('Agency Window is available only on background action phases and stays separate from Alter', () => {
  const advance = systemPrompt('advance', '', '', '', '', '', false, true, true)
  assert.match(advance, /agencyWindow may be/)
  assert.match(advance, /Write the protagonist’s life first/)
  assert.match(advance, /must not copy emotionalOffset, infer contact from Alter values/)
  assert.match(advance, /recheck-later/)

  const user = systemPrompt('user-message', '', '', '', '', '', false, true, true)
  assert.doesNotMatch(user, /agencyWindow may be/)
  assert.doesNotMatch(user, /Agency Window describes only practical action capacity/)
})

test('Perspective is a conditional individual-values layer, not a recurring story theme', () => {
  const absent = systemPrompt('user-message', '', '', '', '', '', false, false, false, false)
  const enabled = systemPrompt('user-message', '', '', '', '', '', false, false, false, true)
  assert.doesNotMatch(absent, /INDIVIDUAL VALUES AND WAY OF SEEING THE WORLD/)
  assert.match(enabled, /INDIVIDUAL VALUES AND WAY OF SEEING THE WORLD/)
  assert.match(enabled, /setting\.perspectives is an array of independent, equally authoritative entries/)
  assert.match(enabled, /not a story theme, moral review/)

  const state = { ...emptyStoryState(), settingOverlay: { characterTraits: [], perspective: '更愿意先理解人的处境。' } }
  assert.equal(storyStateForPrompt(state).settingOverlay.perspective, '更愿意先理解人的处境。')
})

test('chat action fields enter the fixed prompt only for registered turn capabilities', () => {
  const disabled = systemPrompt('user-message', '', '', '', '', '')
  const enabled = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, {
    platform: 'qq', quoteReply: true, reactions: ['like', 'heart'],
  })
  assert.doesNotMatch(disabled, /CURRENT REGISTERED CHAT ACTIONS/)
  assert.doesNotMatch(disabled, /messageReactions/)
  assert.match(enabled, /CURRENT REGISTERED CHAT ACTIONS \(qq\)/)
  assert.match(enabled, /replyTo/)
  assert.match(enabled, /like\|heart/)
})

test('native face expressions require semantic intent and an explicit threshold', () => {
  const prompt = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, {
    platform: 'qq', quoteReply: false, reactions: [], nativeFaces: ['sweat', 'laugh'], expressionThreshold: 0.7,
  })
  assert.match(prompt, /nativeFace/)
  assert.match(prompt, /willingness/)
  assert.match(prompt, /reaches 0.7/)
  assert.match(prompt, /Do not write bracketed face labels/)
})

test('legacy bracket faces are projected as expression semantics for protagonist history', () => {
  assert.equal(promptVisibleMessageContent('那就是你傻[流汗]', 'protagonist-delivered-message'), '那就是你傻〈附带汗颜表情〉')
  assert.equal(promptVisibleMessageContent('用户写了[流汗]', 'user-delivered-message'), '用户写了[流汗]')
})

test('local sticker catalog is conditional and only permits exact listed assets', () => {
  const absent = systemPrompt('user-message', '', '', '', '', '')
  const enabled = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, [
    { assetId: 'laugh/dog', group: 'laugh', description: '金毛躺平，表示摆烂。', aliases: ['躺平'], animated: true },
  ])
  assert.doesNotMatch(absent, /CURRENT LOCAL STICKER LIBRARY/)
  assert.match(enabled, /CURRENT LOCAL STICKER LIBRARY/)
  assert.match(enabled, /at most one exact listed sticker/)
})

test('admin notes carry explicit semantic weight and are never truncated in the script budget', () => {
  const user = systemPrompt('user-message', '', '', '', '', '')
  // 主提示词必须告诉模型 [管理员注记] 是管理员注入的权威事实。
  assert.match(user, /entries whose content begins with \[管理员注记\] are authoritative/)
  assert.match(user, /carry more weight than ordinary system events/)
  assert.match(user, /she follows them without needing to see or reference the note itself/)

  // compactPromptEntries 保护 admin-note 但有预算上限：最多 3 条 × 2,000 字 = 6,000 字，
  // 且原始剧本始终保留（不被注记挤掉）。超限注记截断保留前半段。
  const entries = [
    { id: 1, storyId: 's', participantId: '', kind: 'admin-note', actor: 'system',
      content: '[管理员注记] ' + '指导'.repeat(3500) + '重要指导', occurredAt: new Date('2026-09-13T04:00:00Z'), createdAt: new Date(), metadata: {} },
    { id: 2, storyId: 's', participantId: '', kind: 'script', actor: 'narrator',
      content: '她写歌。', occurredAt: new Date('2026-09-13T04:05:00Z'), createdAt: new Date(), metadata: {} },
  ]
  const selected = compactPromptEntries(entries as any, 12_000)
  const adminEntry = selected.find(e => e.kind === 'admin-note')
  const scriptEntry = selected.find(e => e.kind === 'script')
  // 超限注记保留前半段（含前缀 + 截断标记），不完整保留。
  assert.ok(adminEntry, 'admin-note 必须被保留')
  assert.ok(adminEntry!.content.startsWith('[管理员注记]'), 'admin-note 前缀保留')
  assert.ok(adminEntry!.content.length <= 2_100, '超限注记截断至 ≤2000 字（got ' + adminEntry!.content.length + '）')
  // 原始剧本不被挤掉。
  assert.ok(scriptEntry, '原始剧本必须保留（不被注记挤掉）')
  assert.ok(scriptEntry!.content.includes('她写歌'))
})

test('DeepSeek 家族传输行按家族注入；standard 档协议本身与 full/lite 保持不变', () => {
  const ds = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'standard', family: 'deepseek', source: 'auto', probe: 'deepseek-chat' })
  assert.match(ds, /TRANSPORT IS PER-TURN: on every turn that can carry a reply/)
  assert.match(ds, /advance turns carry no transport unless a message is genuinely sent/)
  assert.match(ds, /never copy its shape or treat the field as optional/)
  assert.match(ds, /interaction\.seen is a required boolean/)
  // 家族收窄：同为 standard 档的 GLM 不携带 DeepSeek 行（不为单一模型给全体弱注意力模型加料）
  const glm = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'standard', family: 'glm', source: 'auto', probe: 'glm-4' })
  assert.doesNotMatch(glm, /TRANSPORT IS PER-TURN/)
  assert.match(glm, /TRANSPORT: reply\.content contains the message text/, 'standard 档协议句不变')
  // full 档原样协议
  const full = systemPrompt('user-message', '', '', '', '', '', false, false)
  assert.doesNotMatch(full, /TRANSPORT: reply\.content contains the message text/)
  assert.match(full, /When interaction is permitted, its shape is/)
  // lite 档同样应用家族 extraAfterPhase（与 Claude 家族先例一致）：DeepSeek 行跨档生效，协议块本身不变
  const lite = systemPrompt('user-message', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, false, false, undefined,
    { tier: 'lite', family: 'deepseek', source: 'auto', probe: 'deepseek-chat' })
  assert.match(lite, /TRANSPORT IS PER-TURN/)
  assert.match(lite, /mode=none only when she sends nothing/, 'lite 协议块保持原样')
})
