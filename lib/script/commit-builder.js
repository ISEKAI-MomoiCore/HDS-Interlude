import { createHash } from 'node:crypto';
import { reconcileTransportReferences } from './authored-actions';
import { isOutgoingScriptEvent, } from './contract';
/**
 * The only beta10 → V2 bridge. It does not call a model or invent narrative
 * decisions; it gives the existing single response stable commit/event ids.
 */
export function decisionToScriptCommit(input) {
    input = { ...input, decision: reconcileTransportReferences(input.decision, false, input.messageSeparator) };
    const participantId = input.participantId?.trim() ?? '';
    const prose = input.decision.script?.trim() ?? '';
    const commitId = stableCommitId(input, participantId, prose);
    const events = [];
    const add = (event) => {
        const result = { ...event, commitId, eventId: `${commitId}:e${events.length + 1}` };
        events.push(result);
        return result;
    };
    const interaction = input.decision.interaction;
    const perceived = input.phase === 'user-message' && interaction?.seen && participantId
        ? add({
            kind: 'message-perceived', actor: 'protagonist', occurredAt: input.now.toISOString(),
            causedByEventIds: [], participantId,
        })
        : undefined;
    const narrative = add({
        kind: 'narrative', actor: 'protagonist', occurredAt: input.now.toISOString(),
        causedByEventIds: perceived ? [perceived.eventId] : [], content: prose,
    });
    // 空白 content（模型偶发输出纯空格）不生成消息事件：truthy 检查会放过 ' '，
    // 随后 validator 的空 bubbles 检查将拒绝整个 commit——一条废消息不该炸掉整回合。
    if (interaction?.reply.content?.trim() && (interaction.reply.mode === 'immediate' || interaction.reply.mode === 'delayed')) {
        addMessageEvent(add, {
            participantId,
            content: interaction.reply.content,
            mode: interaction.reply.mode,
            occurredAt: interaction.reply.mode === 'delayed' && interaction.reply.sendAt
                ? interaction.reply.sendAt
                : input.now.toISOString(),
            causedByEventIds: [perceived?.eventId ?? narrative.eventId],
            separator: input.messageSeparator,
            split: input.splitReplyMessages,
            prose,
            actions: input.decision.authoredActions,
        });
    }
    for (const action of input.decision.crossConversationActions ?? []) {
        if (!action.content || (action.mode !== 'immediate' && action.mode !== 'delayed'))
            continue;
        addMessageEvent(add, {
            participantId: action.participantId,
            endpointId: action.endpointId,
            content: action.content,
            mode: action.mode,
            occurredAt: action.mode === 'delayed' && action.sendAt ? action.sendAt : input.now.toISOString(),
            causedByEventIds: [narrative.eventId],
            separator: input.messageSeparator,
            split: input.splitReplyMessages,
            prose,
            actions: input.decision.authoredActions,
        });
    }
    if (input.groupReplyContent) {
        const bubbles = splitBubbles(input.groupReplyContent, input.messageSeparator, input.splitReplyMessages);
        const content = canonicalBubbleContent(input.groupReplyContent, bubbles, input.messageSeparator, input.splitReplyMessages);
        add({
            kind: 'group-message', actor: 'protagonist', occurredAt: input.now.toISOString(),
            causedByEventIds: [narrative.eventId], content,
            bubbles, deliveryMode: 'immediate',
            scriptBinding: bindImmediateMessageAction(prose, bubbles, input.decision.authoredActions),
        });
    }
    if (input.decision.followUpCommitment) {
        add({
            kind: 'follow-up-promise', actor: 'protagonist', occurredAt: input.now.toISOString(),
            causedByEventIds: [narrative.eventId], participantId,
            content: input.decision.followUpCommitment.summary,
            metadata: { notBefore: input.decision.followUpCommitment.notBefore, kind: input.decision.followUpCommitment.kind },
        });
    }
    for (const intent of input.decision.intents ?? []) {
        add({
            kind: 'future-intent', actor: 'protagonist', occurredAt: input.now.toISOString(),
            causedByEventIds: [narrative.eventId], participantId: intent.participantId || participantId,
            content: intent.summary, metadata: { type: intent.type, notBefore: intent.notBefore },
        });
    }
    for (const browser of input.decision.browserIntents ?? []) {
        add({
            kind: 'browser-intent', actor: 'protagonist', occurredAt: input.now.toISOString(),
            causedByEventIds: [narrative.eventId], participantId: browser.participantId || participantId,
            content: browser.purpose, metadata: { mode: browser.mode, timing: browser.timing ?? 'deferred' },
        });
    }
    if (input.decision.localMedia || input.decision.nativeFace || input.decision.messageReactions?.length) {
        add({
            kind: 'platform-action', actor: 'protagonist', occurredAt: input.now.toISOString(),
            causedByEventIds: [narrative.eventId], participantId,
            metadata: {
                ...(input.decision.localMedia ? { localMedia: input.decision.localMedia } : {}),
                ...(input.decision.nativeFace ? { nativeFace: input.decision.nativeFace } : {}),
                ...(input.decision.messageReactions?.length ? { messageReactions: input.decision.messageReactions } : {}),
            },
        });
    }
    return {
        commitId, storyId: input.storyId, participantId, phase: input.phase,
        window: { from: input.from.toISOString(), to: input.now.toISOString() },
        prose, events,
        sceneDelta: {
            frameId: input.frameId ?? '', burstId: input.burstId ?? '',
            ...(input.startsAfterEventId ? { startsAfterEventId: input.startsAfterEventId } : {}),
            proseAppend: prose, eventIds: events.map(event => event.eventId),
        },
        sourceFormat: 'script-first-v1',
    };
}
export function findPrivateOutgoingMessageEvent(commit, participantId, mode, content, separator = '<sep/>') {
    return commit.events.find(event => isOutgoingScriptEvent(event)
        && event.kind === 'outgoing-message'
        && event.participantId === participantId
        && (!mode || event.deliveryMode === mode)
        && (content === undefined || event.content === content
            || event.bubbles.join(separator) === splitBubbles(content, separator, true).join(separator)));
}
export function findGroupScriptEvent(commit) {
    return commit.events.find(event => isOutgoingScriptEvent(event) && event.kind === 'group-message');
}
function addMessageEvent(add, input) {
    const bubbles = splitBubbles(input.content, input.separator, input.split);
    add({
        kind: 'outgoing-message', actor: 'protagonist', occurredAt: input.occurredAt,
        causedByEventIds: input.causedByEventIds, participantId: input.participantId,
        ...(input.endpointId ? { endpointId: input.endpointId } : {}),
        content: canonicalBubbleContent(input.content, bubbles, input.separator, input.split),
        bubbles,
        deliveryMode: input.mode,
        scriptBinding: input.mode === 'delayed'
            ? { status: 'future' }
            : bindImmediateMessageAction(input.prose, bubbles, input.actions),
    });
}
/** Bind an immediate transport action to the unique literal message text in
 * the current script without interpreting prose or adding another model task.
 * Ambiguous/missing text stays diagnostic and never rewrites the script. */
export function bindImmediateMessageAction(prose, bubbles, actions = []) {
    const matching = actions.filter(action => prose.slice(action.start, action.end) === action.content
        && bubbles.every(bubble => action.content.includes(bubble.trim())));
    if (matching.length === 1) {
        const action = matching[0];
        const binding = bindImmediateMessageAction(action.content, bubbles);
        if (binding.status === 'bound')
            return { ...binding, spans: binding.spans.map(span => ({
                    ...span, start: span.start + action.start, end: span.end + action.start,
                })) };
    }
    const spans = [];
    let cursor = 0;
    for (const [bubbleIndex, rawBubble] of bubbles.entries()) {
        const bubble = rawBubble.trim();
        if (!bubble)
            return { status: 'unbound' };
        const start = prose.indexOf(bubble, cursor);
        if (start < 0 || prose.indexOf(bubble, start + 1) >= 0)
            return { status: 'unbound' };
        const end = start + bubble.length;
        spans.push({ bubbleIndex, start, end });
        cursor = end;
    }
    return { status: 'bound', spans };
}
export function unboundImmediateMessageEvents(commit) {
    return commit.events.filter(event => isOutgoingScriptEvent(event)
        && event.deliveryMode === 'immediate'
        && event.scriptBinding?.status !== 'bound');
}
function canonicalBubbleContent(content, bubbles, separator = '<sep/>', enabled = true) {
    return enabled ? bubbles.join(separator || '<sep/>') : content;
}
function splitBubbles(content, separator = '<sep/>', enabled = true) {
    if (!enabled || !separator || !content.includes(separator))
        return [content];
    const bubbles = content.split(separator).map(item => item.trim()).filter(Boolean);
    return bubbles.length ? bubbles : [content];
}
function stableCommitId(input, participantId, prose) {
    const semanticPayload = {
        participantId,
        prose,
        interaction: input.decision.interaction ?? null,
        groupReplyContent: input.groupReplyContent ?? '',
        crossConversationActions: input.decision.crossConversationActions ?? [],
        intents: input.decision.intents ?? [],
        browserIntents: input.decision.browserIntents ?? [],
        followUpCommitment: input.decision.followUpCommitment ?? null,
        messageReactions: input.decision.messageReactions ?? [],
        localMedia: input.decision.localMedia ?? null,
        nativeFace: input.decision.nativeFace ?? null,
        frameId: input.frameId ?? '',
        burstId: input.burstId ?? '',
        startsAfterEventId: input.startsAfterEventId ?? '',
    };
    const digest = createHash('sha256')
        .update([input.storyId, input.phase, input.from.toISOString(), input.now.toISOString(), JSON.stringify(semanticPayload)].join('\u001f'))
        .digest('hex')
        .slice(0, 20);
    return `commit:${digest}`;
}
