import { InterludeService } from '../../src/service'

/** Supply real delivery gates/confirmation on focused prototype test hosts. */
export function deliveryHost<T extends Record<string, any>>(host: T): T {
  const target: any = host
  Object.assign(target, {
    runtimeGeneration: 0, storyTaskGenerations: new Map(), deliveryExecutors: new Set(), acceptedDeliveries: new Map(),
  })
  target.dbGet ??= async () => []
  target.splitOutgoingMessage ??= (text: string) => text.split('<sep/>')
  target.getStory ??= async (id: string) => ({ id, status: 'active' })
  for (const name of ['deliveryGeneration', 'taskGeneration', 'taskGenerationCurrent', 'deliveryExecutionKey', 'successfulDeliveryEntry',
    'deliveryLedgerConfirmed', 'deliverOutgoingMessages', 'confirmOutgoingDeliveries']) {
    target[name] ??= (InterludeService.prototype as any)[name]
  }
  return host
}
