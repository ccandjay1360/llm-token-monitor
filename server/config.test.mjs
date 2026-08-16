import assert from 'node:assert/strict'
import { defaultConfig, validateConfig } from './config.js'

assert.deepEqual(defaultConfig(), { refreshIntervalSec: 300, providers: [] })
assert.equal(validateConfig({ providers: [] }).refreshIntervalSec, 300)
assert.throws(() => validateConfig({ refreshIntervalSec: 1, providers: [] }), /between 25 and 86400/)
assert.throws(() => validateConfig({
  providers: [
    { id: 'same', name: 'A', type: 'mock' },
    { id: 'same', name: 'B', type: 'mock' },
  ],
}), /provider id 重复/)
assert.throws(() => validateConfig({
  providers: [{ id: '../escape', name: 'A', type: 'mock' }],
}), /provider id 无效/)

console.log('config validation test passed')
