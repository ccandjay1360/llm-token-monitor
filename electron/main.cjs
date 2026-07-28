const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')

const appRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..')
let widgetWindow = null
let dashboardWindow = null
let tray = null
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

function isApiRunning() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 3002 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

function runtimeDataPath() {
  return path.join(app.getPath('userData'), 'data')
}

async function ensureApiServer() {
  if (process.env.NODE_ENV === 'development' || await isApiRunning()) return
  const dataPath = runtimeDataPath()
  fs.mkdirSync(dataPath, { recursive: true })
  const serverProcess = spawn(process.execPath, [path.join(appRoot, 'server', 'index.js')], {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: '3002',
      TOKEN_MONITOR_DATA_DIR: dataPath,
    },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  serverProcess.unref()

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isApiRunning()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
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
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f6f4',
    webPreferences: {
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
  const icon = nativeImage.createFromPath(path.join(appRoot, 'public', 'favicon.svg'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
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

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    await ensureApiServer()
    createWidgetWindow()
    createTray()
  })

  app.on('second-instance', showWidget)
}

app.on('activate', () => {
  if (!widgetWindow) createWidgetWindow()
  else showWidget()
})

app.on('window-all-closed', (event) => event.preventDefault())
