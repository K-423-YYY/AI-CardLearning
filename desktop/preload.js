const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  saveZip(defaultPath, data) {
    return ipcRenderer.invoke('save-zip', { defaultPath, data });
  },
  openZip() {
    return ipcRenderer.invoke('open-zip');
  }
});
