import type { NarrativeFact, ScriptEntry } from '../types'

/** Epistemic pointers into the original, never a replacement narrative. */
export interface KnowledgeEvidence {
  mode: 'observed' | 'reported' | 'belief' | 'proposal' | 'conditional' | 'confirmed' | 'unclassified'
  holder?: string
  topic?: string
  clauses: Array<{ role: 'observation' | 'interpretation' | 'proposal' | 'condition' | 'confirmation'; sourceEntryId: number; quote: string }>
  relatedFactIds: number[]
}

const modes = ['observed', 'reported', 'belief', 'proposal', 'conditional', 'confirmed', 'unclassified']
const roles = ['observation', 'interpretation', 'proposal', 'condition', 'confirmation']

/** Validate references, not the meaning of natural language. A quote is evidence
 * of its author's words; a narrative quote cannot confirm another person's act. */
export function normalizeKnowledgeEvidence(raw: unknown, entries: ScriptEntry[], sourceEntryIds: number[], relatedFactIds: number[] = []): KnowledgeEvidence {
  const value = raw && typeof raw === 'object' ? raw as Partial<KnowledgeEvidence> : {}
  const byId = new Map(entries.filter(entry => sourceEntryIds.includes(entry.id)).map(entry => [entry.id, entry]))
  const clauses: KnowledgeEvidence['clauses'] = []
  for (const clause of Array.isArray(value.clauses) ? value.clauses.slice(0, 12) : []) {
    const entry = clause && byId.get(clause.sourceEntryId)
    if (!entry || !roles.includes(clause.role) || typeof clause.quote !== 'string'
      || !clause.quote.trim() || clause.quote.length > 800 || !entry.content.includes(clause.quote)) continue
    const delivered = ['user-message', 'character-message', 'group-message', 'character-group-message'].includes(entry.kind)
    // Keep the quote, with its actual evidential role, instead of rejecting prose.
    clauses.push({ role: clause.role === 'confirmation' && !delivered ? 'interpretation' : clause.role,
      sourceEntryId: entry.id, quote: clause.quote })
  }
  let mode = modes.includes(value.mode || '') ? value.mode! : 'unclassified'
  if (!clauses.length) mode = 'unclassified'
  if (mode === 'confirmed') {
    const proposed = clauses.filter(clause => clause.role === 'proposal')
    const confirmed = clauses.filter(clause => clause.role === 'confirmation')
    const exchanged = proposed.some(p => confirmed.some(c => {
      const a = byId.get(p.sourceEntryId)!, b = byId.get(c.sourceEntryId)!
      return ['user-message', 'character-message'].includes(a.kind)
        && ['user-message', 'character-message'].includes(b.kind) && a.kind !== b.kind
        && a.participantId === b.participantId && b.id > a.id
    }))
    if (!exchanged) mode = clauses.some(c => c.role === 'condition') ? 'conditional' : 'unclassified'
  }
  if (mode === 'observed' && clauses.some(c => c.role === 'interpretation')) mode = 'belief'
  return { mode,
    ...(typeof value.holder === 'string' && value.holder.trim() ? { holder: value.holder.trim().slice(0, 127) } : mode === 'belief' ? { holder: 'protagonist' } : {}),
    ...(typeof value.topic === 'string' && value.topic.length <= 80 && clauses.some(c => c.quote.includes(value.topic!)) ? { topic: value.topic } : {}),
    clauses, relatedFactIds: [...new Set(relatedFactIds)].slice(0, 12) }
}

/** Rows persisted before evidence fields existed may hold `{}` or partial
 * knowledge objects, so every read of stored evidence coerces defensively. */
export function knowledgeClauses(knowledge: KnowledgeEvidence | undefined) {
  return Array.isArray(knowledge?.clauses) ? knowledge.clauses : []
}

export function knowledgeRelatedIds(knowledge: KnowledgeEvidence | undefined) {
  return Array.isArray(knowledge?.relatedFactIds) ? knowledge.relatedFactIds : []
}

export function factEvidenceForPrompt(fact: NarrativeFact) {
  const knowledge = fact.knowledge && Array.isArray(fact.knowledge.clauses) ? fact.knowledge
    : fact.knowledge && Array.isArray(fact.knowledge.relatedFactIds) ? { ...fact.knowledge, clauses: [] }
    : undefined
  return { id: fact.id, scope: fact.scope, content: fact.content,
    unresolved: fact.unresolved, status: fact.status, sourceEntryIds: fact.sourceEntryIds,
    authority: knowledge?.mode === 'belief' ? 'attributed-belief' : 'derived-record',
    knowledge: knowledge ?? { mode: 'unclassified', clauses: [], relatedFactIds: [] } }
}

export function supportsRecordedOutcome(knowledge: KnowledgeEvidence) {
  return ['observed', 'reported', 'confirmed'].includes(knowledge.mode)
    && knowledgeClauses(knowledge).some(clause => clause.role === 'observation' || clause.role === 'confirmation')
    && !knowledgeClauses(knowledge).some(clause => clause.role === 'interpretation')
}

/** Navigation only for pre-evidence records. Literal condition wording earns
 * a retrieval lane; it never establishes that a condition is valid or fulfilled. */
export function legacyConditionCue(content: string) {
  return /前置|前提|门槛|至少|除非/.test(content)
}

export interface ContactEvidenceThread {
  fact: ReturnType<typeof factEvidenceForPrompt>
  originals: Array<{ id: number; kind: string; participantId: string; content: string; occurredAt: string }>
  originalEntryIds: number[]
  missingSourceEntryIds: number[]
}

/** Include original conditions and nearby replies. Durable facts are global,
 * but their original source entries still obey the caller's privacy boundary;
 * a hidden source is represented as missing rather than reconstructed. */
export function contactEvidenceThreads(facts: NarrativeFact[], entries: ScriptEntry[]): ContactEvidenceThread[] {
  const emitted = new Set<number>()
  return facts.map(fact => {
    const ids = new Set([...fact.sourceEntryIds, ...knowledgeClauses(fact.knowledge).map(c => c.sourceEntryId)])
    const originals = entries.filter(entry => ['script', 'user-message', 'character-message', 'group-message', 'character-group-message'].includes(entry.kind)
      && (ids.has(entry.id) || ['user-message', 'character-message'].includes(entry.kind)
        && [...ids].some(id => Math.abs(id - entry.id) <= 2)))
      .sort((a, b) => a.id - b.id)
      .map(entry => ({ id: entry.id, kind: entry.kind, participantId: entry.participantId,
        content: entry.content, occurredAt: entry.occurredAt.toISOString() }))
    return { fact: factEvidenceForPrompt(fact), originalEntryIds: originals.map(entry => entry.id),
      originals: originals.filter(entry => { if (emitted.has(entry.id)) return false; emitted.add(entry.id); return true }),
      missingSourceEntryIds: [...ids].filter(id => !originals.some(entry => entry.id === id)) }
  })
}

export const KNOWLEDGE_WRITING_FRAME = 'EVIDENCE AND EXPECTATION: the original remains the life script. Her belief, wish and imagined explanation belong to her perspective; an observed action belongs to its actor. Derived records retain these roles and conditions. contactThreads supplies original proposals, conditions and replies, not a second plot: unfinished contact may motivate another question or private anticipation while confirmation and timing stay open. Elapsed silence can change her feelings without changing what the other person promised; platform delivery alone establishes neither reading nor agreement.'
