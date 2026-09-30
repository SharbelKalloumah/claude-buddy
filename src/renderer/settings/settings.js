// Settings window. Every change is saved immediately through window.settingsApi.
import { playSound, SOUND_OPTIONS } from '../shared/sounds.js';

const api = window.settingsApi;
const $ = (id) => document.getElementById(id);

const STATE_LABELS = {
  idle: ['Idle', 'Nothing going on'],
  working: ['Working', 'Claude is busy'],
  needs_input: ['Needs you', 'Waiting for your approval'],
  done: ['Done', 'Task finished'],
};
const SOUND_EVENTS = {
  needs_input: 'When Claude needs you',
  done: 'When a task is done',
  working: 'When Claude starts working',
};
const STATUS = {
  disconnected: ['Disconnected', 'var(--muted)'],
  connecting: ['Connecting…', 'var(--warn)'],
  connected: ['Connected', 'var(--ok)'],
  reconnecting: ['Reconnecting…', 'var(--warn)'],
  error: ['Error', 'var(--bad)'],
};

let settings = null;
let patterns = [];
let locales = [];
let capturingHotkey = false;
let ledStatus = 'disconnected';

const toHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const shortId = (id) => (id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

function toast(msg) {
  $('toast').textContent = msg || '';
}

async function save(patch) {
  const res = await api.update(patch);
  if (res.ok) settings = res.result;
  else toast(res.error);
  render();
}

// ---------- rendering ----------

function renderStatus(led) {
  ledStatus = led.status;
  const [text, color] = STATUS[led.status] || STATUS.error;
  $('status-text').textContent = led.detail && led.status !== 'connected' ? `${text} ${led.detail}` : text;
  $('status-dot').style.background = color;
  const busy = led.status === 'connecting' || led.status === 'reconnecting';
  $('connect').textContent = led.status === 'connected' || busy ? 'Disconnect' : 'Connect';
  for (const b of document.querySelectorAll('.preview')) b.disabled = led.status !== 'connected';
  for (const el of document.querySelectorAll('[data-needs-connection]')) el.disabled = led.status !== 'connected';
  if (document.activeElement !== $('light-color')) $('light-color').value = toHex(led.rgb);
  if (document.activeElement !== $('light-brightness')) $('light-brightness').value = led.brightness;
  $('brightness-value').textContent = `${$('light-brightness').value}%`;
}

// Show the accelerator the way people read it.
const prettyKey = (accel) => accel
  .replace('CommandOrControl', '\u2318').replace('Command', '\u2318').replace('Cmd', '\u2318')
  .replace('Control', '\u2303').replace('Ctrl', '\u2303')
  .replace('Alt', '\u2325').replace('Option', '\u2325')
  .replace('Shift', '\u21e7')
  .replaceAll('+', ' ');

let hooksInstalled = false;

async function renderHooks() {
  const { installed } = await api.hooksStatus();
  hooksInstalled = installed;
  $('hooks-status').textContent = installed ? 'Connected to Claude Code' : 'Not connected';
  $('hooks-dot').style.background = installed ? 'var(--ok)' : 'var(--warn)';
  $('hooks-toggle').textContent = installed ? 'Disconnect' : 'Connect';
  $('hooks-autostart').disabled = !installed;
}

async function renderVoiceStatus() {
  const s = await api.voiceStatus();
  const problems = [];
  if (!s.available) problems.push('speech helper missing (run native/build.sh)');
  if (s.microphone !== 'granted') problems.push('microphone not allowed');
  if (!s.accessibility) problems.push('accessibility not allowed');
  $('voice-status').textContent = problems.length ? problems.join(' · ') : 'Ready';
  $('voice-status').title = $('voice-status').textContent;
  $('voice-dot').style.background = problems.length ? 'var(--warn)' : 'var(--ok)';
  $('voice-grant').hidden = s.available && !problems.length;
}

function render() {
  if (document.activeElement !== $('user-name')) $('user-name').value = settings.userName;
  $('voice-enabled').checked = settings.voice.enabled;
  $('voice-send').checked = settings.voice.autoSend;
  if (!capturingHotkey) $('hotkey').textContent = prettyKey(settings.voice.hotkey) || 'Set shortcut';
  const localeSelect = $('voice-locale');
  if (!localeSelect.options.length) {
    for (const id of locales) localeSelect.add(new Option(id, id));
  }
  localeSelect.value = settings.voice.locale;
  $('sound').checked = settings.sound;
  $('volume').value = settings.sounds.volume;
  $('volume-value').textContent = `${settings.sounds.volume}%`;
  $('repeat').checked = settings.sounds.repeat;
  renderSounds();
  $('enabled').checked = settings.led.enabled;
  $('auto-connect').checked = settings.led.autoConnect;
  const dev = settings.led.device;
  $('device-current').textContent = dev ? `Using ${dev.name} (${shortId(dev.id)})` : 'Any compatible controller';
  $('forget').hidden = !dev;
  renderRules();
}

function renderSounds() {
  const box = $('sound-events');
  box.textContent = '';
  for (const [event, label] of Object.entries(SOUND_EVENTS)) {
    const row = document.createElement('div');
    row.className = 'sound-row';
    const name = document.createElement('span');
    name.textContent = label;
    const select = document.createElement('select');
    for (const o of SOUND_OPTIONS) select.add(new Option(o.label, o.id, false, o.id === settings.sounds[event]));
    select.addEventListener('change', () => {
      save({ sounds: { [event]: select.value } });
      playSound(select.value, settings.sounds.volume);
    });
    const preview = document.createElement('button');
    preview.textContent = '▶';
    preview.title = 'Play';
    preview.addEventListener('click', () => playSound(select.value, settings.sounds.volume));
    row.append(name, select, preview);
    box.append(row);
  }
}

function renderRules() {
  const box = $('rules');
  box.textContent = '';
  for (const [state, [label, desc]] of Object.entries(STATE_LABELS)) {
    const rule = settings.led.rules[state];
    const row = document.createElement('div');
    row.className = 'rule';

    const name = document.createElement('div');
    name.className = 'state';
    name.textContent = label;
    const small = document.createElement('small');
    small.textContent = desc;
    name.append(small);

    const select = document.createElement('select');
    for (const p of patterns) select.add(new Option(p.label, p.id, false, p.id === rule.pattern));
    select.addEventListener('change', () => save({ led: { rules: { [state]: { pattern: select.value } } } }));

    const color = document.createElement('input');
    color.type = 'color';
    color.value = toHex(rule.color);
    color.disabled = !patterns.find((p) => p.id === rule.pattern)?.color;
    color.title = 'Colour';
    color.addEventListener('change', () => save({ led: { rules: { [state]: { color: fromHex(color.value) } } } }));

    const preview = document.createElement('button');
    preview.className = 'preview';
    preview.textContent = '▶';
    preview.title = 'Preview for 5 seconds';
    preview.disabled = ledStatus !== 'connected';
    preview.addEventListener('click', async () => {
      const res = await api.preview(settings.led.rules[state]);
      toast(res.ok ? '' : res.error);
    });

    row.append(name, select, color, preview);
    box.append(row);
  }
}

function renderDevices(list) {
  const box = $('devices');
  box.textContent = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No compatible controllers found. Make sure the strip is powered and the phone app is closed.';
    box.append(p);
    return;
  }
  for (const d of list) {
    const row = document.createElement('div');
    row.className = 'device';
    const info = document.createElement('div');
    info.className = 'grow';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = d.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = d.connected ? `Connected · ${shortId(d.id)}` : `Signal ${d.rssi} dBm · ${shortId(d.id)}`;
    info.append(name, meta);
    row.append(info);

    if (settings.led.device?.id === d.id) {
      const tag = document.createElement('span');
      tag.className = 'in-use';
      tag.textContent = '✓ In use';
      row.append(tag);
    } else {
      const use = document.createElement('button');
      use.textContent = 'Use';
      use.addEventListener('click', async () => {
        await save({ led: { device: { id: d.id, name: d.name } } });
        renderDevices(list);
      });
      row.append(use);
    }
    box.append(row);
  }
}

// ---------- events ----------

// Save the name shortly after typing stops, and on Enter / leaving the field.
let nameTimer = null;
const saveName = () => {
  clearTimeout(nameTimer);
  if ($('user-name').value.trim() !== settings.userName) save({ userName: $('user-name').value });
};
$('user-name').addEventListener('input', () => { clearTimeout(nameTimer); nameTimer = setTimeout(saveName, 600); });
$('user-name').addEventListener('change', saveName);
$('hooks-toggle').addEventListener('click', async () => {
  const btn = $('hooks-toggle');
  btn.disabled = true;
  const res = hooksInstalled ? await api.removeHooks() : await api.installHooks($('hooks-autostart').checked);
  btn.disabled = false;
  toast(res.ok ? '' : res.error);
  renderHooks();
});
// Re-write the hooks so the autostart variant swaps in or out.
$('hooks-autostart').addEventListener('change', async (e) => {
  if (!hooksInstalled) return;
  const res = await api.installHooks(e.target.checked);
  toast(res.ok ? '' : res.error);
});

$('voice-enabled').addEventListener('change', (e) => save({ voice: { enabled: e.target.checked } }));
$('voice-send').addEventListener('change', (e) => save({ voice: { autoSend: e.target.checked } }));
$('voice-locale').addEventListener('change', (e) => save({ voice: { locale: e.target.value } }));
$('voice-grant').addEventListener('click', async () => {
  await api.requestVoiceAccess();
  renderVoiceStatus();
});

// Record a new shortcut from the next key press.
$('hotkey').addEventListener('click', () => {
  capturingHotkey = true;
  $('hotkey').textContent = 'Press keys…';
});
window.addEventListener('keydown', (e) => {
  if (!capturingHotkey) return;
  e.preventDefault();
  if (e.key === 'Escape') {
    capturingHotkey = false;
    return render();
  }
  const mods = [];
  if (e.metaKey) mods.push('Command');
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return; // wait for a real key
  if (!mods.length) return; // a bare key would swallow it everywhere
  capturingHotkey = false;
  save({ voice: { hotkey: [...mods, key].join('+') } });
});

$('sound').addEventListener('change', (e) => save({ sound: e.target.checked }));
$('repeat').addEventListener('change', (e) => save({ sounds: { repeat: e.target.checked } }));
$('volume').addEventListener('input', () => { $('volume-value').textContent = `${$('volume').value}%`; });
$('volume').addEventListener('change', () => {
  save({ sounds: { volume: Number($('volume').value) } });
  playSound('pop', Number($('volume').value)); // hear the new level
});

// Manual light controls (a manual command also stops any running pattern).
const report = (res) => toast(res.ok ? '' : res.error);
$('light-on').addEventListener('click', async () => report(await api.turnOn()));
$('light-off').addEventListener('click', async () => report(await api.turnOff()));
$('light-color').addEventListener('input', async () => report(await api.setRgb(...fromHex($('light-color').value))));
$('light-brightness').addEventListener('input', async () => {
  $('brightness-value').textContent = `${$('light-brightness').value}%`;
  report(await api.setBrightness(Number($('light-brightness').value)));
});

$('enabled').addEventListener('change', (e) => save({ led: { enabled: e.target.checked } }));
$('auto-connect').addEventListener('change', (e) => save({ led: { autoConnect: e.target.checked } }));

$('connect').addEventListener('click', async () => {
  const res = ledStatus === 'disconnected' || ledStatus === 'error' ? await api.connect() : await api.disconnect();
  toast(res.ok ? '' : res.error);
});

$('forget').addEventListener('click', () => save({ led: { device: null } }));

$('detect').addEventListener('click', async () => {
  const btn = $('detect');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  $('devices').textContent = '';
  const res = await api.detect();
  btn.disabled = false;
  btn.textContent = 'Detect devices';
  if (res.ok) renderDevices(res.result);
  else toast(res.error);
});

api.onLedState(renderStatus);
api.onSettings((s) => { settings = s; render(); });

api.load().then((data) => {
  settings = data.settings;
  patterns = data.patterns;
  locales = data.locales;
  render();
  renderStatus(data.led);
  renderVoiceStatus();
  renderHooks();
});
