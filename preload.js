const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  getMetadata: (filePath) => ipcRenderer.invoke('file:getMetadata', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
  pathToFileURL: (filePath) => ipcRenderer.invoke('file:toURL', filePath),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
})
