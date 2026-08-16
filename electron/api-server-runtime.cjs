const path = require('node:path')

function shouldStartApiServer(isPackaged, apiRunning) {
  return isPackaged && !apiRunning
}

function isTokenMonitorHealthResponse(statusCode, body) {
  return statusCode === 200 && body?.ok === true && body?.service === 'token-monitor'
}

function apiBaseUrl(port) {
  const value = Number(port)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('API port is invalid')
  }
  return `http://127.0.0.1:${value}/api`
}

function resolveApiServerCwd(isPackaged, appRoot, executablePath) {
  return isPackaged ? path.dirname(executablePath) : appRoot
}

module.exports = {
  apiBaseUrl,
  isTokenMonitorHealthResponse,
  resolveApiServerCwd,
  shouldStartApiServer,
}
