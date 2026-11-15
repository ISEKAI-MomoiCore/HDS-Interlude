/**
 * I-6b 三维度拆分（设计 v2.4 §7.4）：把群规则旧 responseMode 的混合语义
 * 拆成三个独立维度——不取消 mention-only，拆开它的三个隐含决定：
 *
 * 1. 采集范围（collectionScope）：群消息以什么范围进入剧本库存。
 *    - off：不采集（先于故事查找丢弃一切群消息，群仅作出站目标存在）；
 *    - directed：仅定向消息（@、引用她的消息、语音、图片）落库为证据；
 *    - background：背景采集（含普通消息入库）。
 * 2. 即时触发（immediateTrigger）：已采集的消息何时进入主叙事即时回合。
 *    - mention：仅 @（音频按既有 audioAlwaysTriggers 模态策略豁免）；
 *    - willingness：交给意愿门与冷却（flush 层）。
 * 3. 后台参与（backgroundParticipation）：advance（她的生活写作）与该群的关系。
 *    - off：不参与——不进 I-6 背景通道，也不作为主动群发目标；
 *    - background：仅背景材料（可见于推进背景，不是主动回应目标）；
 *    - active：可主动回应（背景材料 + 主动群发目标资格）。
 *
 * 旧配置映射（迁移基线，逐维可覆盖）：
 * - responseMode='mention-only' → directed / mention / off；
 * - responseMode='always'（及其它值，与现状"非 mention-only 即放行"一致）
 *   → background / willingness / active。
 *
 * 新组合示例："平时看得到群里在聊、被 @ 才即时触发" = background 采集
 * + mention 触发（+ background/active 参与任选）——旧二维字段无法表达。
 */

import { normalizeGroupId } from './platform/identity'

export type GroupCollectionScope = 'off' | 'directed' | 'background'
export type GroupImmediateTrigger = 'mention' | 'willingness'
export type GroupBackgroundParticipation = 'off' | 'background' | 'active'

export interface GroupDimensions {
  collectionScope: GroupCollectionScope
  immediateTrigger: GroupImmediateTrigger
  backgroundParticipation: GroupBackgroundParticipation
}

export interface GroupDimensionRule {
  responseMode?: string
  collectionScope?: string
  immediateTrigger?: string
  backgroundParticipation?: string
}

const COLLECTION_SCOPES: readonly GroupCollectionScope[] = ['off', 'directed', 'background']
const IMMEDIATE_TRIGGERS: readonly GroupImmediateTrigger[] = ['mention', 'willingness']
const PARTICIPATIONS: readonly GroupBackgroundParticipation[] = ['off', 'background', 'active']

/**
 * 幂等解析：显式维度逐维覆盖，缺失/非法维度从 responseMode 基线派生。
 * 消费点防御式调用——桩规则只带 responseMode 也能得到完整三维。
 */
export function resolveGroupDimensions(rule: GroupDimensionRule | undefined): GroupDimensions {
  const mentionOnly = rule?.responseMode === 'mention-only'
  const base: GroupDimensions = mentionOnly
    ? { collectionScope: 'directed', immediateTrigger: 'mention', backgroundParticipation: 'off' }
    : { collectionScope: 'background', immediateTrigger: 'willingness', backgroundParticipation: 'active' }
  const scope = COLLECTION_SCOPES.includes(rule?.collectionScope as GroupCollectionScope)
    ? rule!.collectionScope as GroupCollectionScope : undefined
  const trigger = IMMEDIATE_TRIGGERS.includes(rule?.immediateTrigger as GroupImmediateTrigger)
    ? rule!.immediateTrigger as GroupImmediateTrigger : undefined
  const participation = PARTICIPATIONS.includes(rule?.backgroundParticipation as GroupBackgroundParticipation)
    ? rule!.backgroundParticipation as GroupBackgroundParticipation : undefined
  return {
    collectionScope: scope ?? base.collectionScope,
    immediateTrigger: trigger ?? base.immediateTrigger,
    backgroundParticipation: participation ?? base.backgroundParticipation,
  }
}

/**
 * 主动群发目标（availableGroupTargets / permittedGroupIds 共用）：
 * 仅 backgroundParticipation='active' 的启用群。mention-only 旧映射为 off，
 * 不再作为主动目标（此前 enabled 即可，属隐式泄漏；群内回复走 groupReply
 * 不经此白名单）。返回 [rule, groupId 规范值] 对，调用方自行取 label。
 */
export function activeProactiveGroupTargets(rules: Array<{ enabled?: boolean, groupId?: string }>): Array<{ groupId: string, label: string, rule: Record<string, unknown> }> {
  return rules
    .map(rule => ({ rule, normalizedGroupId: normalizeGroupId(String(rule.groupId ?? '')) }))
    .filter(({ rule, normalizedGroupId }) => normalizedGroupId
      && rule.enabled !== false
      && resolveGroupDimensions(rule as GroupDimensionRule).backgroundParticipation === 'active')
    .map(({ rule, normalizedGroupId }) => ({
      groupId: normalizedGroupId,
      label: String((rule as { label?: string }).label ?? ''),
      rule: rule as Record<string, unknown>,
    }))
}

/** Shared online/history collection gate. Triggering a turn is a later decision. */
export function groupCollectionDropReason(rule: GroupDimensionRule | undefined, evidence: {
  mentionedBot: boolean, quotedBot: boolean, audioCount: number, imageCount: number, hasForwardNode: boolean,
}): string | undefined {
  const scope = resolveGroupDimensions(rule).collectionScope
  if (scope === 'off') return '采集关闭'
  if (scope === 'directed' && !evidence.mentionedBot && !evidence.quotedBot
    && !evidence.audioCount && !evidence.imageCount && !evidence.hasForwardNode) {
    return '仅定向采集：非@/引用/语音/图片/转发'
  }
}
