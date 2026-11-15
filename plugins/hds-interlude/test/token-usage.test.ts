import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateTokenUsages, computeTokenCost, formatTokenUsageLine, parseTokenUsage, TokenUsageRecord } from '../src/narrator'

test('parseTokenUsage reads OpenAI and DeepSeek cache shapes and ignores unknown ones', () => {
  assert.deepEqual(
    parseTokenUsage({ prompt_tokens: 1000, completion_tokens: 250, prompt_tokens_details: { cached_tokens: 640 } }),
    { inputTokens: 1000, outputTokens: 250, cachedInputTokens: 640 },
  )
  assert.deepEqual(
    parseTokenUsage({ prompt_tokens: 900, completion_tokens: 100, prompt_cache_hit_tokens: 333 }),
    { inputTokens: 900, outputTokens: 100, cachedInputTokens: 333 },
  )
  assert.deepEqual(parseTokenUsage({ usage: 'nonsense' }), {})
  assert.deepEqual(parseTokenUsage(undefined), {})
})

test('aggregateTokenUsages sums attempts and keeps the final attempt identity and pricing', () => {
  const records: TokenUsageRecord[] = [
    { task: '主叙事', providerLabel: 'A', model: 'm-a', inputTokens: 100, outputTokens: 20, priceInput: 2 },
    { task: '主叙事', providerLabel: 'B', model: 'm-b', inputTokens: 1500, outputTokens: 300, cachedInputTokens: 1200, priceInput: 1, priceOutput: 4, priceCachedInput: 0.2 },
  ]
  const total = aggregateTokenUsages(records)!
  assert.equal(total.inputTokens, 1600)
  assert.equal(total.outputTokens, 320)
  assert.equal(total.cachedInputTokens, 1200)
  assert.equal(total.providerLabel, 'B')
  assert.equal(total.model, 'm-b')
  assert.equal(total.priceInput, 1)
  assert.equal(aggregateTokenUsages([]), undefined)
})

test('computeTokenCost bills cached tokens at the cache price and reports savings', () => {
  const cost = computeTokenCost({
    task: '主叙事', providerLabel: 'B', model: 'm-b',
    inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 800_000,
    priceInput: 2, priceOutput: 8, priceCachedInput: 0.5,
  })!
  // non-cached 200k × ¥2 + cached 800k × ¥0.5 + output 100k × ¥8, all per 1M
  assert.equal(cost.inputCost, 0.8)
  assert.equal(cost.outputCost, 0.8)
  assert.ok(Math.abs(cost.total - 1.6) < 1e-9)
  assert.ok(Math.abs(cost.saved - 1.2) < 1e-9)
})

test('computeTokenCost is undefined without prices and falls back to the input price', () => {
  const base = { task: '主叙事', providerLabel: 'A', model: 'm', inputTokens: 1000, outputTokens: 100 }
  assert.equal(computeTokenCost({ ...base }), undefined)
  const fallback = computeTokenCost({ ...base, priceInput: 3, priceCachedInput: 0 })!
  assert.equal(fallback.inputCost, 0.003)
})

test('formatTokenUsageLine renders usage, hit rate and optional billing', () => {
  const line = formatTokenUsageLine({
    task: '主叙事', providerLabel: 'B', model: 'm-b',
    inputTokens: 1600, outputTokens: 320, cachedInputTokens: 1200,
    priceInput: 1, priceOutput: 4, priceCachedInput: 0.2,
  })
  assert.match(line, /输入=1600（缓存 1200，命中率 75\.0%）/)
  assert.match(line, /输出=320/)
  assert.match(line, /计费合计=/)
  const unpriced = formatTokenUsageLine({ task: '主叙事', providerLabel: 'A', model: 'm-a', inputTokens: 10, outputTokens: 2 })
  assert.doesNotMatch(unpriced, /计费合计/)
  assert.match(unpriced, /输入=10/)
})
