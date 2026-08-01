const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  saveZip(defaultPath, data) {
    return ipcRenderer.invoke('save-zip', { defaultPath, data });
  },
  writeZip(filePath, data) {
    return ipcRenderer.invoke('write-zip', { filePath, data });
  },
  openZip() {
    return ipcRenderer.invoke('open-zip', {});
  },
  openZipAt(defaultPath) {
    return ipcRenderer.invoke('open-zip', { defaultPath });
  },
  chooseDirectory() {
    return ipcRenderer.invoke('choose-directory');
  },
  openPath(targetPath) {
    return ipcRenderer.invoke('open-path', targetPath);
  },
  pathExists(targetPath) {
    return ipcRenderer.invoke('path-exists', targetPath);
  }
});
