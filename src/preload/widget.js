// Bridge for the widget window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onState: (cb) => ipcRenderer.on('buddy:state', (_e, state) => cb(state)),
  onSounds: (cb) => ipcRenderer.on('buddy:sounds', (_e, sounds) => cb(sounds)),
  onName: (cb) => ipcRenderer.on('buddy:name', (_e, name) => cb(name)),
  onLedState: (cb) => ipcRenderer.on('led:state', (_e, state) => cb(state)),
  showContextMenu: () => ipcRenderer.send('buddy:context-menu'),
  openSettings: () => ipcRenderer.send('buddy:open-settings'),
});
