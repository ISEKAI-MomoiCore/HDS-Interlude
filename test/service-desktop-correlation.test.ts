import { deliveryHost } from './helpers/delivery-host'
import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { desktopProcessingContext } from '../src/processing-context'

const proto = InterludeService.prototype as any

test('service persists and restores typ-0 correlation for a background split delivery', async () => {
  const intents: any[] = []
  const delivered: any[] = []
  const entries: any[] = []
  const story = { id: 'story:background' }
  const participant = { id: 'participant:alice', status: 'active', platform: 'sandbox', selfId: 'bot-1', userId: 'alice', channelId: 'private:alice' }
  const service = Object.create(proto) as any
  service.config = { runtime: { maxMessageCharacters: 4000 } }
  service.memoryConfig = { activeConsequencesEnabled: false, activeConsequenceMaxDays: 7, activeConsequenceDefaultStrength: 0.5 }
  service.interruptedTypingParticipants = new Set<string>()
  service.serial = async (_storyId: string, task: () => Promise<unknown>) => task()
  service.getStory = async (_storyId: string) => story
  service.getParticipant = async (_participantId: string) => participant
  service.scheduleNextSplitWake = async (_storyId: string) => undefined
  service.sendOutgoingMessages = async (_story: unknown, messages: any[]) => {
    delivered.push(...messages)
    return messages
  }
  service.appendEntry = async (_storyId: string, entry: unknown) => {
    entries.push(entry)
    return entry
  }
  service.recordCharacterMessage = async () => undefined
  service.dbCreate = async (_table: string, row: any) => {
    const stored = { ...row, id: intents.length + 1 }
    intents.push(stored)
    return stored
  }
  service.dbGet = async (table: string, query: any, options?: any) => {
    if (table !== 'interlude_intent') return []
    let rows = intents.filter(row => {
      if (query.storyId !== undefined && row.storyId !== query.storyId) return false
      if (query.status !== undefined && row.status !== query.status) return false
      if (query.type !== undefined && row.type !== query.type) return false
      const notBefore = query.notBefore
      if (notBefore?.$lte && row.notBefore > notBefore.$lte) return false
      if (notBefore?.$gt && row.notBefore <= notBefore.$gt) return false
      return true
    })
    if (options?.sort?.notBefore === 'asc') rows = rows.sort((left, right) => left.notBefore.getTime() - right.notBefore.getTime())
    if (options?.limit) rows = rows.slice(0, options.limit)
    return rows
  }
  service.dbSet = async (_table: string, query: any, patch: any) => {
    for (const row of intents) {
      if (query.id !== undefined && row.id !== query.id) continue
      Object.assign(row, patch)
    }
  }

  const context = { traceId: 'msg-background-1', processingId: 'proc-background-1' }
  await desktopProcessingContext.run(context, async () => {
    await proto.appendIntent.call(service, story.id, {
      type: 'split-message',
      summary: 'A delayed second bubble',
      notBefore: new Date(Date.now() + 1_000).toISOString(),
      payload: { content: '第二段消息', visibleMessage: true },
    }, new Date(), participant.id)
  })

  assert.equal(intents.length, 1)
  assert.equal(intents[0].payload.traceId, context.traceId)
  assert.equal(intents[0].payload.processingId, context.processingId)

  // Simulate the scheduler waking after the persisted intent becomes due.
  intents[0].notBefore = new Date(Date.now() - 1)
  deliveryHost(service)
  await proto.deliverDueSplitSegments.call(service, story.id)

  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].content, '第二段消息')
  assert.equal(delivered[0].traceId, context.traceId)
  assert.equal(delivered[0].processingId, context.processingId)
  assert.equal(intents[0].status, 'completed')
  assert.equal(entries.length, 1)
  assert.equal(desktopProcessingContext.getStore(), undefined)
})
