import assert from 'node:assert/strict'
import { calculateWeightedCacheHitRate, extractCacheUsage } from './cache-metrics.js'

assert.deepEqual(extractCacheUsage({
  total_input_tokens: 100,
  total_cache_creation_tokens: 10,
  total_cache_read_tokens: 90,
}), {
  inputTokens: 100,
  creationTokens: 10,
  readTokens: 90,
})

assert.equal(calculateWeightedCacheHitRate([
  { cacheInputTokens: 100, cacheCreationTokens: 10, cacheReadTokens: 90 },
  { cacheInputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0 },
]), 90 / 210 * 100)

assert.equal(calculateWeightedCacheHitRate([{ cacheInputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }]), null)

console.log('cache metrics test passed')
