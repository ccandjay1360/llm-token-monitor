import assert from 'node:assert/strict'
import { withProviderBrowserLock } from './browser-lock.js'

const events = []
const first = withProviderBrowserLock('same-provider', async () => {
  events.push('first:start')
  await new Promise((resolve) => setTimeout(resolve, 10))
  events.push('first:end')
})
const second = withProviderBrowserLock('same-provider', async () => {
  events.push('second:start')
  events.push('second:end')
})

await Promise.all([first, second])
assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end'])
console.log('browser lock test passed')

const priorityEvents = []
let releaseFirst
const firstStarted = new Promise((resolve) => {
  const first = withProviderBrowserLock('priority-provider', async () => {
    priorityEvents.push('first:start')
    resolve()
    await new Promise((release) => { releaseFirst = release })
    priorityEvents.push('first:end')
  })
  void first.catch(() => {})
})

await firstStarted
const priority = withProviderBrowserLock(
  'priority-provider',
  async () => priorityEvents.push('login:start'),
  { priority: true },
)
await priority
assert.deepEqual(priorityEvents, ['first:start', 'login:start'])
releaseFirst()
