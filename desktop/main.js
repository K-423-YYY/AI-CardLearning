const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let mainWindow = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.setLoginItemSettings({ openAtLogin: false });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'AI 闯关学习',
    backgroundColor: '#eef2f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const packagedApp = path.join(__dirname, 'app', 'index.html');
  const repoApp = path.join(__dirname, '..', 'app', 'index.html');
  mainWindow.loadFile(fs.existsSync(packagedApp) ? packagedApp : repoApp);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('save-zip', async (event, payload) => {
  const defaultPath = payload && payload.defaultPath ? String(payload.defaultPath) : 'AI闯关学习备份.zip';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出备份',
    defaultPath,
    filters: [{ name: 'ZIP 备份', extensions: ['zip'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const data = payload && payload.data;
  if (data) {
    fs.writeFileSync(result.filePath, Buffer.from(data));
  }
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('open-zip', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入备份',
    properties: ['openFile'],
    filters: [{ name: 'ZIP 备份', extensions: ['zip'] }]
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { canceled: true };
  }
  const filePath = result.filePaths[0];
  const data = fs.readFileSync(filePath);
  return {
    canceled: false,
    filePath,
    name: path.basename(filePath),
    data: new Uint8Array(data)
  };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
