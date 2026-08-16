const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const http = require('node:http')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const {
  apiBaseUrl,
  isTokenMonitorHealthResponse,
  resolveApiServerCwd,
  shouldStartApiServer,
} = require('./api-server-runtime.cjs')

const appRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..')
let widgetWindow = null
let dashboardWindow = null
let tray = null
let apiServerProcess = null
let apiRuntime = { port: Number(process.env.PORT) || 3002, token: process.env.TOKEN_MONITOR_API_TOKEN || '' }
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const DEFAULT_WIDGET_SIZE = { width: 480, height: 454 }
const WIDGET_SIZE_LIMITS = { minWidth: 320, minHeight: 360, maxWidth: 480, maxHeight: 620 }

if (!hasSingleInstanceLock) app.quit()

function widgetStatePath() {
  return path.join(app.getPath('userData'), 'widget-state.json')
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback
}

function loadWidgetSize() {
  try {
    const state = JSON.parse(fs.readFileSync(widgetStatePath(), 'utf8'))
    return {
      width: clamp(state.width, WIDGET_SIZE_LIMITS.minWidth, WIDGET_SIZE_LIMITS.maxWidth, DEFAULT_WIDGET_SIZE.width),
      height: clamp(state.height, WIDGET_SIZE_LIMITS.minHeight, WIDGET_SIZE_LIMITS.maxHeight, DEFAULT_WIDGET_SIZE.height),
    }
  } catch {
    return DEFAULT_WIDGET_SIZE
  }
}

function saveWidgetSize() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  const [width, height] = widgetWindow.getSize()
  try {
    fs.mkdirSync(path.dirname(widgetStatePath()), { recursive: true })
    fs.writeFileSync(widgetStatePath(), JSON.stringify({ width, height }), 'utf8')
  } catch (error) {
    console.warn('Unable to save widget size:', error.message)
  }
}

function resetWidgetSize() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  widgetWindow.setSize(DEFAULT_WIDGET_SIZE.width, DEFAULT_WIDGET_SIZE.height, true)
  saveWidgetSize()
}

function isApiRunning(port, token) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: '/api/health',
      headers: token ? { 'x-token-monitor-auth': token } : {},
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        try {
          finish(isTokenMonitorHealthResponse(response.statusCode, JSON.parse(body)))
        } catch {
          finish(false)
        }
      })
    })
    request.setTimeout(1_500, () => request.destroy())
    request.once('error', () => finish(false))
  })
}

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const selectedPort = typeof address === 'object' && address ? address.port : null
      server.close((error) => (error ? reject(error) : resolve(selectedPort)))
    })
  })
}

async function findAvailableApiPort() {
  try {
    return await reservePort(3002)
  } catch {
    return reservePort(0)
  }
}

function runtimeDataPath() {
  return path.join(app.getPath('userData'), 'data')
}

function runtimeIconPath() {
  return path.join(appRoot, app.isPackaged ? 'dist' : 'public', 'yukino-icon.png')
}

function logApiServer(message) {
  try {
    const dataPath = runtimeDataPath()
    fs.mkdirSync(dataPath, { recursive: true })
    fs.appendFileSync(
      path.join(dataPath, 'api-server.log'),
      `${new Date().toISOString()} ${message}\n`,
      'utf8',
    )
  } catch (error) {
    console.error('Unable to write API server log:', error.message)
  }
}

async function ensureApiServer() {
  const apiRunning = apiServerProcess && await isApiRunning(apiRuntime.port, apiRuntime.token)
  if (!shouldStartApiServer(app.isPackaged, apiRunning)) return

  const apiPort = await findAvailableApiPort()
  const apiToken = crypto.randomBytes(32).toString('base64url')
  const dataPath = runtimeDataPath()
  fs.mkdirSync(dataPath, { recursive: true })
  const serverEntry = path.join(appRoot, 'server', 'index.js')
  const serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: resolveApiServerCwd(app.isPackaged, appRoot, process.execPath),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(apiPort),
      TOKEN_MONITOR_API_TOKEN: apiToken,
      TOKEN_MONITOR_DATA_DIR: dataPath,
    },
    stdio: 'ignore',
    windowsHide: true,
  })
  apiServerProcess = serverProcess
  apiRuntime = { port: apiPort, token: apiToken }
  logApiServer(`spawned API server: pid=${serverProcess.pid || 'unknown'}, port=${apiPort}, entry=${serverEntry}`)
  serverProcess.once('error', (error) => logApiServer(`API server spawn error: ${error.message}`))
  serverProcess.once('exit', (code, signal) => {
    if (apiServerProcess === serverProcess) apiServerProcess = null
    logApiServer(`API server exited: code=${code}, signal=${signal || 'none'}`)
  })

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isApiRunning(apiPort, apiToken)) {
      logApiServer('API server is ready')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  stopApiServer()
  throw new Error('API server did not become ready within 7500ms')
}

function stopApiServer() {
  const serverProcess = apiServerProcess
  apiServerProcess = null
  if (serverProcess && !serverProcess.killed) serverProcess.kill()
}

function showWidget() {
  if (!widgetWindow) return
  widgetWindow.show()
  widgetWindow.focus()
}

function openDashboard() {
  if (!app.isPackaged) {
    shell.openExternal('http://127.0.0.1:5173/')
    return
  }

  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show()
    dashboardWindow.focus()
    return
  }

  dashboardWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    icon: runtimeIconPath(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f6f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  dashboardWindow.loadFile(path.join(appRoot, 'dist', 'index.html'))
  dashboardWindow.once('ready-to-show', () => dashboardWindow?.show())
  dashboardWindow.on('closed', () => {
    dashboardWindow = null
  })
}

function createTray() {
  const icon = nativeImage.createFromPath(runtimeIconPath())
  tray = new Tray(icon.resize({ width: 20, height: 20, quality: 'best' }))
  tray.setToolTip('Token 监控挂件')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示挂件', click: showWidget },
    { label: '打开仪表盘', click: openDashboard },
    { label: '重置挂件大小', click: resetWidgetSize },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]))
  tray.on('click', showWidget)
}

function loadWidget(window) {
  if (process.env.NODE_ENV === 'development') {
    const url = 'http://127.0.0.1:5173/?widget=1'
    let retries = 0
    window.webContents.on('did-fail-load', (_event, _code, _description, failedUrl, isMainFrame) => {
      if (isMainFrame && failedUrl === url && retries < 30) {
        retries += 1
        setTimeout(() => window.loadURL(url), 300)
      }
    })
    window.loadURL(url)
    return
  }

  window.loadFile(path.join(appRoot, 'dist', 'index.html'), { query: { widget: '1' } })
}

function createWidgetWindow() {
  const initialSize = loadWidgetSize()
  widgetWindow = new BrowserWindow({
    ...initialSize,
    ...WIDGET_SIZE_LIMITS,
    icon: runtimeIconPath(),
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: '#f7f9fc',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  widgetWindow.setAlwaysOnTop(true, 'floating')
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  let saveSizeTimer = null
  widgetWindow.on('resize', () => {
    clearTimeout(saveSizeTimer)
    saveSizeTimer = setTimeout(saveWidgetSize, 250)
  })
  widgetWindow.once('ready-to-show', showWidget)
  widgetWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault()
      widgetWindow.hide()
    }
  })

  loadWidget(widgetWindow)
}

ipcMain.on('widget:hide', () => widgetWindow?.hide())
ipcMain.on('widget:open-dashboard', openDashboard)
ipcMain.on('widget:quit', () => {
  app.isQuiting = true
  app.quit()
})
ipcMain.on('api:get-config', (event) => {
  event.returnValue = { baseUrl: apiBaseUrl(apiRuntime.port), token: apiRuntime.token }
})

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    try {
      await ensureApiServer()
    } catch (error) {
      logApiServer(`API server startup failed: ${error.message}`)
      console.error('Unable to start API server:', error.message)
    }
    createWidgetWindow()
    createTray()
  })

  app.on('second-instance', showWidget)
}

app.on('activate', () => {
  if (!widgetWindow) createWidgetWindow()
  else showWidget()
})

app.on('before-quit', () => {
  app.isQuiting = true
  stopApiServer()
})

app.on('window-all-closed', (event) => event.preventDefault())
