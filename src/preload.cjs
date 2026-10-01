const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('muse', {
  getState: () => ipcRenderer.invoke('muse:get-state'),
  connect: () => ipcRenderer.invoke('muse:connect'),
  newChat: (projectPath = null) => ipcRenderer.invoke('muse:new-chat', projectPath),
  resumeChat: id => ipcRenderer.invoke('muse:resume-chat', id),
  deleteChat: id => ipcRenderer.invoke('muse:delete-chat', id),
  sendMessage: message => ipcRenderer.invoke('muse:send', message),
  stopTurn: () => ipcRenderer.invoke('muse:stop'),
  chooseWorkspace: () => ipcRenderer.invoke('muse:choose-workspace'),
  chooseMuse: () => ipcRenderer.invoke('muse:choose-muse'),
  setOptions: options => ipcRenderer.invoke('muse:set-options', options),
  pickImages: () => ipcRenderer.invoke('muse:pick-images'),
  copyText: text => ipcRenderer.invoke('muse:copy-text', text),
  browserCommand: (action, payload) => ipcRenderer.invoke('muse:browser', action, payload),
  stitchCommand: (action, payload) => ipcRenderer.invoke('muse:stitch', action, payload),
  onEvent: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('muse:event', listener); return () => ipcRenderer.removeListener('muse:event', listener); }
});
