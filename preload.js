const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  dbRead: () => ipcRenderer.invoke('db-read'),
  dbAdd: (url) => ipcRenderer.invoke('db-add', url),
  dbRemove: (url) => ipcRenderer.invoke('db-remove', url),
  thumbnailForUrl: (url) => ipcRenderer.invoke('thumbnail-for-url', url),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  showAbout: () => ipcRenderer.invoke('show-about'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
