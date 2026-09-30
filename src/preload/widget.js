// Bridge for the widget window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onState: (cb) => ipcRenderer.on('buddy:state', (_e, state) => cb(state)),
  onSounds: (cb) => ipcRenderer.on('buddy:sounds', (_e, sounds) => cb(sounds)),
  onName: (cb) => ipcRenderer.on('buddy:name', (_e, name) => cb(name)),
  onLedState: (cb) => ipcRenderer.on('led:state', (_e, state) => cb(state)),
  onVoice: (cb) => ipcRenderer.on('buddy:voice', (_e, cfg) => cb(cfg)),
  onVoiceToggle: (cb) => ipcRenderer.on('buddy:voice-toggle', () => cb()),
  showContextMenu: () => ipcRenderer.send('buddy:context-menu'),
  dragStart: () => ipcRenderer.send('buddy:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('buddy:drag-move', dx, dy),
  voice: {
    transcribe: (wav) => ipcRenderer.invoke('voice:transcribe', wav),
    status: () => ipcRenderer.invoke('voice:status'),
  },
  openSettings: () => ipcRenderer.send('buddy:open-settings'),
});
