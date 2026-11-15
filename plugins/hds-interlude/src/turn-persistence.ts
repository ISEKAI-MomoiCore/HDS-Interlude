import type { NarrativeInteraction, ScriptEntryDraft, TimelinePlan } from './types'
import { normalizeLifeHandoff, type LifeHandoff } from './script/life-handoff'
import type { ScriptCommitDraft } from './script/contract'
import { createScriptDeliveryActions } from './script/delivery-ledger'

export function scriptEntryDraftForCommit(
  commit: ScriptCommitDraft,
  interaction: NarrativeInteraction | null,
  timelinePlan?: TimelinePlan,
  lifeHandoff?: LifeHandoff,
): ScriptEntryDraft {
  const hasGroupEvent = commit.events.some(event => event.kind === 'group-message')
  const hasPrivateEvent = commit.events.some(event => event.kind === 'outgoing-message')
  const conversationKind = hasGroupEvent && hasPrivateEvent
    ? 'unknown'
    : hasGroupEvent
      ? 'group'
      : hasPrivateEvent
        ? 'private'
        : undefined

  return {
    kind: 'script',
    actor: 'narrator',
    content: commit.prose,
    occurredAt: commit.window.to,
    metadata: {
      ...(conversationKind ? { conversationKind } : {}),
      phase: commit.phase,
      narrativeAuthority: 'original-v2',
      lifeHandoff: normalizeLifeHandoff(lifeHandoff, commit.prose),
      commitId: commit.commitId,
      frameId: commit.sceneDelta.frameId,
      burstId: commit.sceneDelta.burstId,
      interaction,
      scriptCommit: {
        commitId: commit.commitId,
        sourceFormat: commit.sourceFormat,
        from: commit.window.from,
        to: commit.window.to,
        eventCount: commit.events.length,
      },
      scriptEvents: commit.events,
      deliveryActions: createScriptDeliveryActions(commit),
      sceneDelta: commit.sceneDelta,
      ...(timelinePlan ? { timelinePlan, timelineWindow: { from: commit.window.from, to: commit.window.to } } : {}),
    },
  }
}
