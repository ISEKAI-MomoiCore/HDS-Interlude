import assert from 'node:assert/strict'
import test from 'node:test'
import { ModelConfig, ProviderConfig } from '../src/narrator'
import { formatModelRouting, resolveModelRouting } from '../src/model-routing'

function provider(id: string, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id, label: id, enabled: true, endpoint: `https://${id}.example/v1/chat/completions`,
    apiKey: 'secret', model: `${id}-model`, temperature: 0.8, topP: 1,
    maxTokens: 4096, timeout: 60_000, responseFormat: 'json-object',
    extraHeaders: '', extraBody: '', ...overrides,
  }
}

function config(providers: ProviderConfig[]): ModelConfig {
  return {
    providers,
    failover: { enabled: true, strategy: 'ordered', maxAttemptsPerProvider: 1, cooldownMinutes: 1 },
    fixedPrompt: '', stylePrompt: '',
  }
}

test('one routing table resolves explicit task assignments before legacy fallback', () => {
  const routing = resolveModelRouting(config([
    provider('fallback'),
    provider('writer', { useForMain: true }),
    provider('compact', { useForCompaction: true }),
  ]))
  assert.equal(routing.main.providers[0].id, 'writer')
  assert.equal(routing.main.reason, 'assigned-provider')
  assert.equal(routing.compaction.providers[0].id, 'compact')
  assert.match(formatModelRouting(routing), /main=writer\/writer-model\[assigned-provider\]/)
})

test('embedding-only providers never become an accidental chat fallback', () => {
  const routing = resolveModelRouting(config([
    provider('vectors', { useForEmbedding: true }),
  ]))
  assert.equal(routing.main.available, false)
  assert.equal(routing.main.reason, 'unavailable')
})

test('model profiles select provider and task model through the same resolver', () => {
  const modelConfig = config([provider('shared', { model: '' })])
  modelConfig.models = [{
    id: 'writer-profile', label: 'writer', enabled: true, providerId: 'shared', model: 'story-model',
    maxTokens: 8192, timeout: 90_000, responseFormat: 'json-object',
  }]
  modelConfig.mainModelId = 'writer-profile'
  const routing = resolveModelRouting(modelConfig)
  assert.equal(routing.main.available, true)
  assert.equal(routing.main.reason, 'model-profile')
  assert.equal(routing.main.target.model, 'story-model')
})
