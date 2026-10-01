// Bridge for the widget window.
import { contextBridge, ipcRenderer } from 'electron';

const buddy: BuddyBridge = {
  onState: (cb) => ipcRenderer.on('buddy:state', (_e, state: BuddyState) => cb(state)),
  onSounds: (cb) => ipcRenderer.on('buddy:sounds', (_e, sounds: SoundConfig) => cb(sounds)),
  onName: (cb) => ipcRenderer.on('buddy:name', (_e, name: string) => cb(name)),
  onLedState: (cb) => ipcRenderer.on('led:state', (_e, state: LedState) => cb(state)),
  onVoice: (cb) => ipcRenderer.on('buddy:voice', (_e, cfg: VoiceConfig) => cb(cfg)),
  onVoiceToggle: (cb) => ipcRenderer.on('buddy:voice-toggle', () => cb()),
  showContextMenu: () => ipcRenderer.send('buddy:context-menu'),
  dragStart: () => ipcRenderer.send('buddy:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('buddy:drag-move', dx, dy),
  voice: {
    transcribe: (wav) => ipcRenderer.invoke('voice:transcribe', wav),
    status: () => ipcRenderer.invoke('voice:status'),
  },
  openSettings: () => ipcRenderer.send('buddy:open-settings'),
};

contextBridge.exposeInMainWorld('buddy', buddy);
