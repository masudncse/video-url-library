const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  dbRead: () => ipcRenderer.invoke('db-read'),
  dbAdd: (url) => ipcRenderer.invoke('db-add', url),
  dbRemove: (url) => ipcRenderer.invoke('db-remove', url),
  thumbnailForUrl: (url) => ipcRenderer.invoke('thumbnail-for-url', url),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  showAbout: () => ipcRenderer.invoke('show-about'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  securityPinState: () => ipcRenderer.invoke('security-pin-state'),
  securityVerify: (pin) => ipcRenderer.invoke('security-verify', pin),
  securitySetPin: (newPin, newPinConfirm) =>
    ipcRenderer.invoke('security-set-pin', { newPin, newPinConfirm }),
  securityChangePin: (currentPin, newPin, newPinConfirm) =>
    ipcRenderer.invoke('security-change-pin', { currentPin, newPin, newPinConfirm }),
  securityRemovePin: (currentPin) => ipcRenderer.invoke('security-remove-pin', { currentPin }),
  onSecurityOpenSettings: (callback) => {
    ipcRenderer.on('security-open-settings', () => callback());
  },
});
