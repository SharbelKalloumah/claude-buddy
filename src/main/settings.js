// Persistent user settings (JSON in the app's userData folder).

const fs = require('fs');
const os = require('os');
const { isPattern } = require('./led/patterns');

const STATES = ['idle', 'working', 'needs_input', 'done'];
const NAME_MAX = 30;
// Must match the sounds in src/renderer/shared/sounds.js.
const SOUND_IDS = ['none', 'whistle', 'siren', 'doorbell', 'chime', 'beep', 'success', 'tada', 'pop', 'click'];
const SOUND_EVENTS = ['needs_input', 'done', 'working'];

// Default name: the OS account name, capitalized ("sharbel" → "Sharbel").
function defaultName() {
  try {
    const n = os.userInfo().username.split(/[._-]/)[0];
    return n ? n[0].toUpperCase() + n.slice(1) : 'Buddy';
  } catch {
    return 'Buddy';
  }
}

const DEFAULTS = {
  userName: defaultName(),
  sound: true, // master switch
  sounds: { volume: 70, repeat: true, needs_input: 'whistle', done: 'none', working: 'none' },
  led: {
    enabled: true,
    autoConnect: false,
    device: null, // { id, name } once chosen or first connected
    rules: {
      idle: { pattern: 'none', color: [255, 255, 255] },
      working: { pattern: 'off', color: [74, 158, 255] },
      needs_input: { pattern: 'police', color: [255, 0, 0] },
      done: { pattern: 'off', color: [91, 201, 138] },
    },
  },
};

const isRgb = (c) => Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);

// Merge `input` over `base`, keeping only known, valid fields.
function sanitize(input, base = DEFAULTS) {
  const out = structuredClone(base);
  if (!input || typeof input !== 'object') return out;
  if (typeof input.sound === 'boolean') out.sound = input.sound;
  const snd = input.sounds || {};
  if (Number.isFinite(snd.volume)) out.sounds.volume = Math.round(Math.min(100, Math.max(0, snd.volume)));
  if (typeof snd.repeat === 'boolean') out.sounds.repeat = snd.repeat;
  for (const e of SOUND_EVENTS) if (SOUND_IDS.includes(snd[e])) out.sounds[e] = snd[e];
  if (typeof input.userName === 'string') {
    const name = input.userName.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    out.userName = name || defaultName();
  }
  const led = input.led || {};
  if (typeof led.enabled === 'boolean') out.led.enabled = led.enabled;
  if (typeof led.autoConnect === 'boolean') out.led.autoConnect = led.autoConnect;
  if (led.device === null) out.led.device = null;
  else if (led.device && typeof led.device.id === 'string') {
    out.led.device = { id: led.device.id, name: String(led.device.name || 'BJ_LED_M') };
  }
  for (const s of STATES) {
    const r = led.rules?.[s];
    if (!r) continue;
    if (isPattern(r.pattern)) out.led.rules[s].pattern = r.pattern;
    if (isRgb(r.color)) out.led.rules[s].color = [...r.color];
  }
  return out;
}

class Settings {
  constructor(file) {
    this.file = file;
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run or unreadable */ }
    this.data = sanitize(saved);
  }

  get() {
    return structuredClone(this.data);
  }

  // Apply a partial update, e.g. { led: { rules: { done: { pattern: 'solid' } } } }.
  update(patch) {
    this.data = sanitize(patch, this.data);
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.log('[settings] save failed:', err.message);
    }
    return this.get();
  }
}

module.exports = { Settings, sanitize, DEFAULTS, STATES, NAME_MAX, SOUND_IDS };
