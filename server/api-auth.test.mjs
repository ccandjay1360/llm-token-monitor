import assert from 'node:assert/strict'
import { isApiRequestAuthorized } from './api-auth.js'

assert.equal(isApiRequestAuthorized('', undefined), true)
assert.equal(isApiRequestAuthorized('secret', 'secret'), true)
assert.equal(isApiRequestAuthorized('secret', 'different'), false)
assert.equal(isApiRequestAuthorized('secret', undefined), false)

console.log('api auth test passed')
