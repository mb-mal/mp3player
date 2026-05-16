const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 700,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools()
  }
}

app.setAboutPanelOptions({
  applicationName: 'MP3 Player',
  applicationVersion: '1.0.0',
  copyright: 'Malyshev Mikhail\ntg: @tsingular',
  credits: 'https://github.com/mb-mal/mp3player',
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] },
    ],
  })
  if (result.canceled) return []
  return result.filePaths
})

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  if (result.canceled) return []
  const dir = result.filePaths[0]
  const files = fs.readdirSync(dir)
  return files
    .filter(f => /\.(mp3|wav|ogg|flac|m4a)$/i.test(f))
    .map(f => path.join(dir, f))
})

ipcMain.handle('file:getMetadata', async (_, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  const name = path.basename(filePath, ext)
  const stat = fs.statSync(filePath)
  return { name, ext, size: stat.size }
})

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:close', () => mainWindow?.close())

ipcMain.handle('file:toURL', async (_, filePath) => {
  return pathToFileURL(filePath).href
})

ipcMain.handle('file:exists', async (_, filePath) => {
  return fs.existsSync(filePath)
})
