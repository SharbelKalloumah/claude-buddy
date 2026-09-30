// Claude Buddy main process: widget window, settings window, localhost state server, LED strip.

const { app, BrowserWindow, Menu, ipcMain, screen, globalShortcut, systemPreferences } = require('electron');
const http = require('http');
const path = require('path');
const { BleTransport } = require('./led/ble-transport');
const { LedController } = require('./led/controller');
const { PATTERNS } = require('./led/patterns');
const { Settings, LOCALES } = require('./settings');
const { Lighting } = require('./lighting');
const voice = require('./voice');
const hooks = require('./hooks');

const HOST = '127.0.0.1'; // local only
const DEFAULT_PORT = 7788;
const PORT = (() => {
  const p = Number.parseInt(process.env.CLAUDE_BUDDY_PORT, 10);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
})();

const STATES = new Set(['idle', 'working', 'needs_input', 'done']);
const DONE_TIMEOUT_MS = 8000;
const WIN_W = 220;
const WIN_H = 304; // includes room for the speech bubble
const MARGIN = 16;

const PRELOAD = (name) => path.join(__dirname, '..', 'preload', `${name}.js`);
const PAGE = (name) => path.join(__dirname, '..', 'renderer', name, 'index.html');

let win = null;
let settingsWin = null;
let currentState = 'idle';
let doneTimer = null;
let settings = null;
let led = null;
let lighting = null;
let quitting = false;
let dragStart = null; // window bounds when a manual drag began

// Only one Buddy at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const send = (w, channel, data) => { if (w && !w.isDestroyed()) w.webContents.send(channel, data); };
const soundConfig = (s) => ({ enabled: s.sound, ...s.sounds });

function setState(state) {
  clearTimeout(doneTimer);
  doneTimer = null;
  currentState = state;
  send(win, 'buddy:state', state);
  lighting.setState(state);
  if (state === 'done') doneTimer = setTimeout(() => setState('idle'), DONE_TIMEOUT_MS);
}

// ---------- windows ----------

function createWindow() {
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

function openSettings() {
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

function showContextMenu() {
  if (!win) return;
  Menu.buildFromTemplate([
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: win.isAlwaysOnTop(),
      click: (item) => win.setAlwaysOnTop(item.checked, 'screen-saver'),
    },
    {
      label: 'Sound',
      type: 'checkbox',
      checked: settings.get().sound,
      click: (item) => applySettings({ sound: item.checked }),
    },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]).popup({ window: win });
}

// ---------- settings ----------

// Save a partial update and apply its side effects.
function applySettings(patch) {
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

// The only LED operations the renderers may call, with argument checks.
const LED_COMMANDS = {
  connect: () => led.connect(),
  disconnect: () => led.disconnect(),
  turnOn: () => led.turnOn(),
  turnOff: () => led.turnOff(),
  setRgb: (r, g, b) => {
    if (![r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) throw new Error('invalid colour');
    return led.setRgb(r, g, b);
  },
  setBrightness: (pct) => {
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('invalid brightness');
    return led.setBrightness(pct);
  },
};

// Wrap handlers so errors come back as { ok: false, error } instead of throwing.
const safe = (fn) => async (_e, ...args) => {
  try {
    return { ok: true, result: await fn(...args) };
  } catch (err) {
    console.log('[led]', err.message);
    return { ok: false, error: err.message };
  }
};

function setupLed() {
  const transport = new BleTransport();
  transport.preferredId = settings.get().led.device?.id || null;
  led = new LedController(transport);
  lighting = new Lighting(led, () => settings.get());

  led.on('state', (state) => {
    send(win, 'led:state', state);
    send(settingsWin, 'led:state', state);
  });
  transport.on('status', (status) => { if (status === 'connected') lighting.apply(); });
  // Remember the first device we connect to.
  transport.on('device', (device) => {
    if (!settings.get().led.device) {
      settings.update({ led: { device } });
      send(settingsWin, 'settings:changed', settings.get());
    }
  });

  ipcMain.handle('led:command', safe((name, args = []) => {
    if (!Object.hasOwn(LED_COMMANDS, name)) throw new Error(`unknown command ${name}`);
    return LED_COMMANDS[name](...args);
  }));

  if (settings.get().led.enabled && settings.get().led.autoConnect) led.connect().catch(() => {});
}

// ---------- voice ----------

// The mascot sits on the window, so we drag it ourselves; that keeps clicks free for talking.
ipcMain.on('buddy:drag-start', () => { dragStart = win?.getBounds() || null; });
ipcMain.on('buddy:drag-move', (_e, dx, dy) => {
  if (win && dragStart) win.setPosition(Math.round(dragStart.x + dx), Math.round(dragStart.y + dy));
});

function registerHotkey({ enabled, hotkey }) {
  globalShortcut.unregisterAll();
  if (!enabled || !hotkey) return true;
  try {
    return globalShortcut.register(hotkey, () => send(win, 'buddy:voice-toggle'));
  } catch {
    return false;
  }
}

ipcMain.handle('voice:transcribe', safe(async (wav) => {
  const { locale, autoSend } = settings.get().voice;
  const text = await voice.transcribe(wav, locale);
  if (!text) return { text: '' };
  await voice.type(text, { submit: autoSend });
  return { text };
}));

ipcMain.handle('voice:status', () => ({
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

ipcMain.handle('settings:get', () => ({
  settings: settings.get(),
  patterns: PATTERNS,
  locales: LOCALES,
  led: led.getState(),
  state: currentState,
}));
ipcMain.handle('settings:update', safe((patch) => applySettings(patch)));
ipcMain.handle('hooks:status', () => ({ installed: hooks.installed(), file: hooks.SETTINGS }));
ipcMain.handle('hooks:install', safe((autostart) => hooks.install({ autostart })));
ipcMain.handle('hooks:remove', safe(() => hooks.remove()));

ipcMain.handle('settings:detect', safe(() => led.transport.detect()));
ipcMain.handle('settings:preview', safe((scene) => {
  if (led.getState().status !== 'connected') throw new Error('Connect the strip first');
  lighting.preview(scene);
}));

// ---------- HTTP state server ----------

function startServer() {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, `http://${HOST}`);
    const state = pathname.slice(1);
    if ((req.method === 'GET' || req.method === 'POST') && STATES.has(state)) {
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
  if (process.platform === 'darwin') app.dock.hide();
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
  Promise.race([led.disconnect(), new Promise((r) => setTimeout(r, 3000))])
    .finally(() => process.kill(process.pid, 'SIGKILL'));
});

app.on('second-instance', () => { if (win) win.showInactive(); });
app.on('window-all-closed', () => app.quit());
