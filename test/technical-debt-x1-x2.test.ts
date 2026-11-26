import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { InterludeService } from '../src/service'

function host() {
  return Object.assign(Object.create(InterludeService.prototype), {
    queues: new Map(), serialScope: new AsyncLocalStorage(), serialWatchdog: new Map(),
    runtimeGeneration: 0, storyTaskGenerations: new Map(),
    scheduler: { clearBackoff() {}, cancelWakes() {} },
    turnEngine: { invalidateNarratives() {} },
    bufferedGroupTurns: new Map(), groupWillingness: new Map(),
    getCanonicalStory: async () => ({ id: 's' }),
  }) as any
}

test('X2 desktop deletion queues once, waits for prior work and releases subsequent work', { timeout: 2000 }, async () => {
  const svc = host()
  const order: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const before = svc.serial('s', async () => { order.push('before'); await gate })
  svc.purgeStoryRangeUnlocked = async () => { order.push('purge') }
  const deletion = svc.desktopPurgeRange(new Date(0), new Date(1))
  await Promise.resolve()
  const after = svc.serial('s', async () => { order.push('after') })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['before'])
  release()
  await Promise.all([before, deletion, after])
  assert.deepEqual(order, ['before', 'purge', 'after'])
  assert.equal(svc.queues.size, 0)
})

test('X2 deletion failure releases queue; direct range deletion retains serialization', { timeout: 2000 }, async () => {
  const svc = host()
  svc.purgeStoryRangeUnlocked = async () => {
    assert.equal(svc.inSerial('s'), true)
    throw new Error('delete failed')
  }
  await assert.rejects(svc.desktopPurgeRange(new Date(0), new Date(1)), /delete failed/)
  let completed = false
  svc.purgeStoryRangeUnlocked = async () => { assert.equal(svc.inSerial('s'), true); completed = true }
  await svc.purgeStoryRange('s', new Date(0), new Date(1))
  assert.equal(completed, true)
})

test('X1 narrative invalidation clears only selected story salience, or all stories', () => {
  const svc = host()
  svc.invalidateBufferedNarratives('s')
  svc.recordNarrativeSalience('s', 'g1', { turnRelated: true })
  svc.recordNarrativeSalience('other', 'g2', { turnRelated: true })
  svc.invalidateBufferedNarratives('s')
  assert.equal(svc.groupNarrativeSalience.has('s'), false)
  assert.equal(svc.groupNarrativeSalience.has('other'), true)
  svc.recordNarrativeSalience('s', 'g1', { turnRelated: false })
  assert.equal(svc.groupNarrativeSalience.get('s').g1.score, 1)
  svc.invalidateBufferedNarratives()
  assert.equal(svc.groupNarrativeSalience.size, 0)
})

test('X1 queued salience glance rechecks invalidation even if new batches have arrived', async () => {
  const svc = host()
  svc.recordNarrativeSalience('s', 'g', { turnRelated: true })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const blocker = svc.serial('s', () => gate)
  let reads = 0
  svc.getStory = async () => { reads++; return { id: 's', status: 'active', state: {}, setting: {} } }
  svc.dbSet = async () => { throw new Error('obsolete glance must not write') }
  const glance = svc.maybeScheduleSalienceGlance('s')
  svc.invalidateBufferedNarratives('s')
  svc.storyTaskGenerations.set('s', 1)
  svc.recordNarrativeSalience('s', 'g', { turnRelated: true })
  release()
  await Promise.all([blocker, glance])
  assert.equal(reads, 0)
})


test('X1 salience invalidated during the story read cannot schedule a glance', async () => {
  const svc = host()
  svc.recordNarrativeSalience('s', 'g', { turnRelated: true })
  let writes = 0
  svc.getStory = async () => {
    svc.invalidateBufferedNarratives('s')
    return { id: 's', status: 'active', state: {}, setting: {} }
  }
  svc.dbSet = async () => { writes++ }
  await svc.maybeScheduleSalienceGlance('s')
  assert.equal(writes, 0)
})


test('X1 actual range purge clears salience through the shared invalidation hook', async () => {
  const svc = host()
  Object.assign(svc, {
    acceptedDeliveries: new Map(), invalidateHistoryVectors() {}, dbGet: async () => [],
    getStory: async () => ({ id: 's' }), ensureContinuity: async () => {},
  })
  svc.recordNarrativeSalience('s', 'g', { turnRelated: true })
  svc.recordNarrativeSalience('other', 'g', { turnRelated: true })
  await svc.purgeStoryRange('s', new Date(0), new Date(1))
  assert.equal(svc.groupNarrativeSalience.has('s'), false)
  assert.equal(svc.groupNarrativeSalience.has('other'), true)
})
