const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tokenMonitor', {
  api: ipcRenderer.sendSync('api:get-config'),
})

contextBridge.exposeInMainWorld('desktopWidget', {
  hide: () => ipcRenderer.send('widget:hide'),
  openDashboard: () => ipcRenderer.send('widget:open-dashboard'),
  quit: () => ipcRenderer.send('widget:quit'),
})
