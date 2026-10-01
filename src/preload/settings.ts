// Bridge for the settings window.
import { contextBridge, ipcRenderer } from 'electron';

const settingsApi: SettingsApi = {
  load: () => ipcRenderer.invoke('settings:get'),
  update: (patch) => ipcRenderer.invoke('settings:update', patch),
  detect: () => ipcRenderer.invoke('settings:detect'),
  preview: (scene) => ipcRenderer.invoke('settings:preview', scene),
  connect: () => ipcRenderer.invoke('led:command', 'connect'),
  disconnect: () => ipcRenderer.invoke('led:command', 'disconnect'),
  turnOn: () => ipcRenderer.invoke('led:command', 'turnOn'),
  turnOff: () => ipcRenderer.invoke('led:command', 'turnOff'),
  setRgb: (r, g, b) => ipcRenderer.invoke('led:command', 'setRgb', [r, g, b]),
  setBrightness: (pct) => ipcRenderer.invoke('led:command', 'setBrightness', [pct]),
  hooksStatus: () => ipcRenderer.invoke('hooks:status'),
  installHooks: (autostart) => ipcRenderer.invoke('hooks:install', autostart),
  removeHooks: () => ipcRenderer.invoke('hooks:remove'),
  voiceStatus: () => ipcRenderer.invoke('voice:status'),
  requestVoiceAccess: () => ipcRenderer.invoke('voice:request-access'),
  onLedState: (cb) => ipcRenderer.on('led:state', (_e, state: LedState) => cb(state)),
  onSettings: (cb) => ipcRenderer.on('settings:changed', (_e, s: BuddySettings) => cb(s)),
};

contextBridge.exposeInMainWorld('settingsApi', settingsApi);
