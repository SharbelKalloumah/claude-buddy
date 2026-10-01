// Claude Buddy main process: widget window, settings window, localhost state server, LED strip.

import { app, BrowserWindow, Menu, ipcMain, screen, globalShortcut, systemPreferences } from 'electron';
import type { IpcMainInvokeEvent, MenuItem, Rectangle } from 'electron';
import http from 'http';
import path from 'path';
import { messageOf } from './errors';
import { BleTransport } from './led/ble-transport';
import { LedController } from './led/controller';
import { PATTERNS } from './led/patterns';
import { Settings, LOCALES, STATES as SETTING_STATES } from './settings';
import { Lighting } from './lighting';
import * as voice from './voice';
import * as hooks from './hooks';

const HOST = '127.0.0.1'; // local only
const DEFAULT_PORT = 7788;
const PORT = ((): number => {
  const p = Number.parseInt(process.env.CLAUDE_BUDDY_PORT ?? '', 10);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
})();

const STATES = new Set<string>(SETTING_STATES);
const isBuddyState = (s: string): s is BuddyState => STATES.has(s);
const DONE_TIMEOUT_MS = 8000;
const WIN_W = 220;
const WIN_H = 304; // includes room for the speech bubble
const MARGIN = 16;

const PRELOAD = (name: string): string => path.join(__dirname, '..', 'preload', `${name}.js`);
const PAGE = (name: string): string => path.join(__dirname, '..', 'renderer', name, 'index.html');

let win: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let currentState: BuddyState = 'idle';
let doneTimer: NodeJS.Timeout | undefined;
// Built once the app is ready, which is before any window or handler can use them.
let settings!: Settings;
let led!: LedController;
let lighting!: Lighting;
let quitting = false;
let dragStart: Rectangle | null = null; // window bounds when a manual drag began

// Only one Buddy at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const send = (w: BrowserWindow | null, channel: string, data?: unknown): void => {
  if (w && !w.isDestroyed()) w.webContents.send(channel, data);
};
const soundConfig = (s: BuddySettings): SoundConfig => ({ enabled: s.sound, ...s.sounds });

function setState(state: BuddyState): void {
  clearTimeout(doneTimer);
  doneTimer = undefined;
  currentState = state;
  send(win, 'buddy:state', state);
  lighting.setState(state);
  if (state === 'done') doneTimer = setTimeout(() => setState('idle'), DONE_TIMEOUT_MS);
}

// ---------- windows ----------

function createWindow(): void {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: workArea.x + workArea.width - WIN_W - MARGIN,
    y: workArea.y + workArea.height - WIN_H - MARGIN,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD('widget'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep animating when macOS thinks we're hidden
      autoplayPolicy: 'no-user-gesture-required', // whistle without a click
    },
  });

  // Float over fullscreen apps and on every Space.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(PAGE('widget'));
  win.webContents.on('did-finish-load', () => {
    send(win, 'buddy:state', currentState);
    send(win, 'buddy:sounds', soundConfig(settings.get()));
    send(win, 'buddy:name', settings.get().userName);
    send(win, 'buddy:voice', settings.get().voice);
    send(win, 'led:state', led.getState());
  });
  // Windows shows its own menu on drag regions; use ours.
  win.on('system-context-menu', (e) => { e.preventDefault(); showContextMenu(); });
  win.on('closed', () => { win = null; });
}

function openSettings(): void {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 420,
    minHeight: 480,
    title: 'Claude Buddy Settings',
    backgroundColor: '#18181b',
    webPreferences: { preload: PRELOAD('settings'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWin.loadFile(PAGE('settings'));
  settingsWin.on('closed', () => { settingsWin = null; });
  app.focus({ steal: true }); // dock is hidden, so bring it forward explicitly
}

function showContextMenu(): void {
  const target = win;
  if (!target) return;
  Menu.buildFromTemplate([
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: target.isAlwaysOnTop(),
      click: (item: MenuItem) => target.setAlwaysOnTop(item.checked, 'screen-saver'),
    },
    {
      label: 'Sound',
      type: 'checkbox',
      checked: settings.get().sound,
      click: (item: MenuItem) => applySettings({ sound: item.checked }),
    },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]).popup({ window: target });
}

// ---------- settings ----------

// Save a partial update and apply its side effects. The patch arrives over IPC, so
// Settings validates it; everything below reads the sanitized result.
function applySettings(patch: unknown): BuddySettings {
  const before = settings.get();
  const after = settings.update(patch);
  if (JSON.stringify(soundConfig(after)) !== JSON.stringify(soundConfig(before))) send(win, 'buddy:sounds', soundConfig(after));
  if (after.userName !== before.userName) send(win, 'buddy:name', after.userName);
  if (JSON.stringify(after.voice) !== JSON.stringify(before.voice)) {
    send(win, 'buddy:voice', after.voice);
    registerHotkey(after.voice);
  }
  send(settingsWin, 'settings:changed', after);

  const newId = after.led.device?.id || null;
  led.transport.preferredId = newId;
  // Switched to another device while connected: reconnect to the new one.
  const connectedId = led.transport.device?.id;
  if (newId && connectedId && newId !== connectedId && led.getState().status === 'connected') {
    led.disconnect().then(() => led.connect()).catch(() => {});
  }

  lighting.apply();
  return after;
}

// ---------- LED strip ----------

const isByte = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;
const isPercent = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

// The only LED operations the renderers may call, with argument checks.
const LED_COMMANDS: Record<string, (args: unknown[]) => unknown> = {
  connect: () => led.connect(),
  disconnect: () => led.disconnect(),
  turnOn: () => led.turnOn(),
  turnOff: () => led.turnOff(),
  setRgb: ([r, g, b]) => {
    if (!isByte(r) || !isByte(g) || !isByte(b)) throw new Error('invalid colour');
    return led.setRgb(r, g, b);
  },
  setBrightness: ([pct]) => {
    if (!isPercent(pct)) throw new Error('invalid brightness');
    return led.setBrightness(pct);
  },
};

// Wrap handlers so errors come back as { ok: false, error } instead of throwing.
const safe = <A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) =>
  async (_e: IpcMainInvokeEvent, ...args: A): Promise<IpcResult<Awaited<R>>> => {
    try {
      return { ok: true, result: await fn(...args) };
    } catch (err) {
      const error = messageOf(err);
      console.log('[led]', error);
      return { ok: false, error };
    }
  };

function setupLed(): void {
  const transport = new BleTransport();
  transport.preferredId = settings.get().led.device?.id || null;
  led = new LedController(transport);
  lighting = new Lighting(led, () => settings.get());

  led.on('state', (state: LedState) => {
    send(win, 'led:state', state);
    send(settingsWin, 'led:state', state);
  });
  transport.on('status', (status: LedStatus) => { if (status === 'connected') lighting.apply(); });
  // Remember the first device we connect to.
  transport.on('device', (device: LedDevice) => {
    if (!settings.get().led.device) {
      settings.update({ led: { device } });
      send(settingsWin, 'settings:changed', settings.get());
    }
  });

  ipcMain.handle('led:command', safe((name: unknown, args: unknown = []) => {
    if (typeof name !== 'string' || !Object.hasOwn(LED_COMMANDS, name)) throw new Error(`unknown command ${String(name)}`);
    return LED_COMMANDS[name](Array.isArray(args) ? args : []);
  }));

  if (settings.get().led.enabled && settings.get().led.autoConnect) led.connect().catch(() => {});
}

// ---------- voice ----------

// The mascot sits on the window, so we drag it ourselves; that keeps clicks free for talking.
ipcMain.on('buddy:drag-start', () => { dragStart = win?.getBounds() || null; });
ipcMain.on('buddy:drag-move', (_e, dx: number, dy: number) => {
  if (win && dragStart) win.setPosition(Math.round(dragStart.x + dx), Math.round(dragStart.y + dy));
});

function registerHotkey({ enabled, hotkey }: VoiceConfig): boolean {
  globalShortcut.unregisterAll();
  if (!enabled || !hotkey) return true;
  try {
    return globalShortcut.register(hotkey, () => send(win, 'buddy:voice-toggle'));
  } catch {
    return false;
  }
}

ipcMain.handle('voice:transcribe', safe(async (wav: ArrayBuffer) => {
  const { locale, autoSend } = settings.get().voice;
  const text = await voice.transcribe(wav, locale);
  if (!text) return { text: '' };
  await voice.type(text, { submit: autoSend });
  return { text };
}));

ipcMain.handle('voice:status', (): VoiceStatus => ({
  available: voice.available(),
  accessibility: voice.hasAccessibility(),
  microphone: systemPreferences.getMediaAccessStatus('microphone'),
}));

ipcMain.handle('voice:request-access', safe(async () => {
  const microphone = await systemPreferences.askForMediaAccess('microphone');
  voice.requestAccessibility(); // opens the Accessibility pane when not yet trusted
  return { microphone, accessibility: voice.hasAccessibility() };
}));

// ---------- IPC ----------

ipcMain.on('buddy:context-menu', showContextMenu);
ipcMain.on('buddy:open-settings', openSettings);

ipcMain.handle('settings:get', (): SettingsSnapshot => ({
  settings: settings.get(),
  patterns: PATTERNS,
  locales: LOCALES,
  led: led.getState(),
  state: currentState,
}));
ipcMain.handle('settings:update', safe((patch: unknown) => applySettings(patch)));
ipcMain.handle('hooks:status', () => ({ installed: hooks.installed(), file: hooks.SETTINGS }));
ipcMain.handle('hooks:install', safe((autostart: unknown) => hooks.install({ autostart: Boolean(autostart) })));
ipcMain.handle('hooks:remove', safe(() => hooks.remove()));

ipcMain.handle('settings:detect', safe(() => led.transport.detect()));
ipcMain.handle('settings:preview', safe((scene: LightRule) => {
  if (led.getState().status !== 'connected') throw new Error('Connect the strip first');
  lighting.preview(scene);
}));

// ---------- HTTP state server ----------

function startServer(): void {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', `http://${HOST}`);
    const state = pathname.slice(1);
    if ((req.method === 'GET' || req.method === 'POST') && isBuddyState(state)) {
      setState(state);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`ok ${state}\n`);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found\n');
    }
    req.resume();
  });
  server.on('error', (err) => console.error(`[claude-buddy] server error on ${HOST}:${PORT}: ${err.message}`));
  server.listen(PORT, HOST, () => console.log(`[claude-buddy] listening on http://${HOST}:${PORT}`));
}

// ---------- app lifecycle ----------

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();
  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  setupLed();
  createWindow();
  startServer();
  if (!registerHotkey(settings.get().voice)) console.log('[voice] could not register the hotkey');
});

// Once noble is loaded Electron can't exit normally, and a lingering process would keep
// the strip's only BLE connection. So: disconnect (max 3s), then hard-exit.
app.on('before-quit', (e) => {
  if (!led || !led.transport.noble) return;
  e.preventDefault();
  if (quitting) return;
  quitting = true;
  Promise.race([led.disconnect(), new Promise((r) => { setTimeout(r, 3000); })])
    .finally(() => process.kill(process.pid, 'SIGKILL'));
});

app.on('second-instance', () => { if (win) win.showInactive(); });
app.on('window-all-closed', () => app.quit());
