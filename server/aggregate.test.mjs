import assert from 'node:assert/strict'
import { aggregate } from './aggregate.js'

const cache = {
  fetchedAt: 1_700_000_000_000,
  providers: [
    {
      id: 'oneapi-a',
      name: '站点A',
      type: 'oneapi',
      ok: true,
      fetchedAt: 1_700_000_000_000,
      lastSuccessfulFetch: 1_700_000_000_000,
      data: {
        quota: 10_000_000,
        usedQuota: 2_500_000,
        logs: [
          { time: 1_700_000_000_000, model: 'gpt-4o', promptTokens: 100, completionTokens: 50, quota: 300, cacheHit: true, latencyMs: 800 },
          { time: 1_700_000_000_100, model: 'gpt-4o', promptTokens: 200, completionTokens: 80, quota: 500, cacheHit: false, latencyMs: 1200 },
        ],
      },
    },
    {
      id: 'browser-b',
      name: '站点B',
      type: 'browser',
      ok: true,
      fetchedAt: 1_700_000_000_000,
      lastSuccessfulFetch: 1_700_000_000_000,
      data: {
        balance: 12.34,
        todayTokens: 5000,
        todayCost: 1.25,
        cacheHitRate: 40,
        quota: 12.34 * 500_000,
        usedQuota: 1.25 * 500_000,
        logs: [],
        models: [{ model: 'claude-3-5', calls: 10, promptTokens: 0, completionTokens: 4000, quota: 250_000 }],
      },
    },
  ],
}

// 未指定范围：汇总全部站点
const all = aggregate(cache)
assert.equal(all.scope.providerId, 'all')
assert.equal(all.summary.providerCount, 2)
assert.equal(all.summary.totalCalls, 2 + 10)
assert.equal(all.summary.totalTokens, 100 + 50 + 200 + 80 + 0 + 4000)
assert.equal(all.summary.todayTokens, 5000)
assert.equal(all.summary.todayCost, 1.25)
assert.equal(all.availableProviders.length, 2)

// 指定命中范围：仅该站点
const single = aggregate(cache, 'browser-b')
assert.equal(single.scope.providerId, 'browser-b')
assert.equal(single.summary.providerCount, 1)
assert.equal(single.summary.totalCalls, 10)
assert.equal(single.summary.todayTokens, 5000)

// 指定未命中范围（已被禁用/删除的站点）：
// 必须返回空集而不是静默回退到全部合计，避免误导前端
const missing = aggregate(cache, 'deleted-id')
assert.equal(missing.scope.providerId, 'deleted-id')
assert.equal(missing.summary.providerCount, 0)
assert.equal(missing.summary.totalTokens, 0)
assert.equal(missing.summary.totalQuotaRemaining, 0)
assert.equal(missing.summary.todayTokens, 0)
assert.equal(missing.providers.length, 0)
// availableProviders 仍列出可用站点，便于前端切换到有效范围
assert.equal(missing.availableProviders.length, 2)

console.log('aggregate test passed')
