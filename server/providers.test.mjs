import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { oneApiFetch } from './providers.js'

const server = createServer(() => {})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const { port } = server.address()

try {
  await assert.rejects(
    oneApiFetch({
      baseUrl: `http://127.0.0.1:${port}`,
      apiToken: 'test-token',
      requestTimeoutMs: 30,
    }),
    /请求超时/,
  )
} finally {
  server.close()
  await once(server, 'close')
}

console.log('provider timeout test passed')
