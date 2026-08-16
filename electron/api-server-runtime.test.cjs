const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {
  apiBaseUrl,
  isTokenMonitorHealthResponse,
  resolveApiServerCwd,
  shouldStartApiServer,
} = require('./api-server-runtime.cjs')

test('packaged app starts its API server when the port is unavailable', () => {
  assert.equal(shouldStartApiServer(true, false), true)
})

test('development app relies on the separately managed API server', () => {
  assert.equal(shouldStartApiServer(false, false), false)
})

test('does not start a duplicate API server', () => {
  assert.equal(shouldStartApiServer(true, true), false)
})

test('packaged API server uses a real directory instead of the ASAR archive as cwd', () => {
  const installDir = path.join('example', 'Token Monitor')
  const appRoot = path.join(installDir, 'resources', 'app.asar')
  const executablePath = path.join(installDir, 'Token Monitor.exe')

  assert.equal(
    resolveApiServerCwd(true, appRoot, executablePath),
    installDir,
  )
})

test('only accepts the Token Monitor health response', () => {
  assert.equal(isTokenMonitorHealthResponse(200, { ok: true, service: 'token-monitor' }), true)
  assert.equal(isTokenMonitorHealthResponse(200, { ok: true }), false)
  assert.equal(isTokenMonitorHealthResponse(503, { ok: true, service: 'token-monitor' }), false)
})

test('builds the API base URL from the selected local port', () => {
  assert.equal(apiBaseUrl(3017), 'http://127.0.0.1:3017/api')
})
