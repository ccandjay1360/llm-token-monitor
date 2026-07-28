import assert from 'node:assert/strict'
import {
  mergeRefreshedProviders,
  preserveFailedProviderData,
  resolveRefreshTargets,
} from './refresh-cache.js'

const waw = { id: 'waw', data: { todayCost: 1 } }
const kunkun = { id: 'kunkun', data: { todayCost: 2 } }
const refreshedKunkun = { id: 'kunkun', data: { todayCost: 3 } }

assert.deepEqual(resolveRefreshTargets([waw, kunkun], 'kunkun'), [kunkun])
assert.deepEqual(resolveRefreshTargets([waw, kunkun], ''), [waw, kunkun])
assert.deepEqual(
  mergeRefreshedProviders([waw, kunkun], [refreshedKunkun]),
  [waw, refreshedKunkun],
)

const failedKunkun = {
  id: 'kunkun',
  ok: false,
  error: 'timeout',
  fetchedAt: 123,
  data: { todayCost: 0, todayTokens: 0 },
}
assert.deepEqual(
  preserveFailedProviderData([failedKunkun], [kunkun]),
  [{ ...kunkun, ok: false, error: 'timeout', fetchedAt: 123, lastSuccessfulFetch: undefined, stale: true }],
)

console.log('refresh cache test passed')
