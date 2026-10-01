// Persistent user settings (JSON in the app's userData folder).

import fs from 'fs';
import os from 'os';
import { isPattern } from './led/patterns';
import { messageOf } from './errors';

export const STATES: BuddyState[] = ['idle', 'working', 'needs_input', 'done'];
export const NAME_MAX = 30;
// Must match the sounds in src/renderer/shared/sounds.ts.
export const SOUND_IDS: SoundId[] = ['none', 'whistle', 'siren', 'doorbell', 'chime', 'beep', 'success', 'tada', 'pop', 'click'];
const SOUND_EVENTS: SoundEvent[] = ['needs_input', 'done', 'working'];
export const LOCALES: string[] = ['en-US', 'en-GB', 'ar-SA', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'nl-NL', 'pt-BR', 'tr-TR', 'ru-RU', 'zh-CN', 'ja-JP', 'ko-KR'];

// Default name: the OS account name, capitalized ("ada" → "Ada").
function defaultName(): string {
  try {
    const n = os.userInfo().username.split(/[._-]/)[0];
    return n ? n[0].toUpperCase() + n.slice(1) : 'Buddy';
  } catch {
    return 'Buddy';
  }
}

export const DEFAULTS: BuddySettings = {
  userName: defaultName(),
  sound: true, // master switch
  sounds: { volume: 70, repeat: true, needs_input: 'whistle', done: 'none', working: 'none' },
  voice: { enabled: true, hotkey: 'Control+Alt+Space', locale: 'en-US', autoSend: false },
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

const isRgb = (c: unknown): c is Rgb =>
  Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isSoundId = (v: unknown): v is SoundId => typeof v === 'string' && (SOUND_IDS as string[]).includes(v);

/** Read an untrusted field bag without trusting its shape. */
const fields = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};

// Merge `input` over `base`, keeping only known, valid fields.
export function sanitize(input: unknown, base: BuddySettings = DEFAULTS): BuddySettings {
  const out = structuredClone(base);
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  if (typeof src.sound === 'boolean') out.sound = src.sound;
  const snd = fields(src.sounds);
  if (isNumber(snd.volume)) out.sounds.volume = Math.round(Math.min(100, Math.max(0, snd.volume)));
  if (typeof snd.repeat === 'boolean') out.sounds.repeat = snd.repeat;
  for (const e of SOUND_EVENTS) {
    const chosen = snd[e];
    if (isSoundId(chosen)) out.sounds[e] = chosen;
  }
  if (typeof src.userName === 'string') {
    const name = src.userName.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    out.userName = name || defaultName();
  }
  const voice = fields(src.voice);
  if (typeof voice.enabled === 'boolean') out.voice.enabled = voice.enabled;
  if (typeof voice.autoSend === 'boolean') out.voice.autoSend = voice.autoSend;
  if (typeof voice.locale === 'string' && LOCALES.includes(voice.locale)) out.voice.locale = voice.locale;
  if (typeof voice.hotkey === 'string' && voice.hotkey.length <= 60) out.voice.hotkey = voice.hotkey.trim();

  const led = fields(src.led);
  if (typeof led.enabled === 'boolean') out.led.enabled = led.enabled;
  if (typeof led.autoConnect === 'boolean') out.led.autoConnect = led.autoConnect;
  if (led.device === null) out.led.device = null;
  else {
    const device = fields(led.device);
    if (typeof device.id === 'string') out.led.device = { id: device.id, name: String(device.name || 'BJ_LED_M') };
  }
  const rules = fields(led.rules);
  for (const s of STATES) {
    const r = fields(rules[s]);
    if (isPattern(r.pattern)) out.led.rules[s].pattern = r.pattern;
    if (isRgb(r.color)) out.led.rules[s].color = [...r.color];
  }
  return out;
}

export class Settings {
  readonly file: string;
  data: BuddySettings;

  constructor(file: string) {
    this.file = file;
    let saved: unknown = null;
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run or unreadable */ }
    this.data = sanitize(saved);
  }

  get(): BuddySettings {
    return structuredClone(this.data);
  }

  // Apply a partial update, e.g. { led: { rules: { done: { pattern: 'solid' } } } }.
  // The patch comes from the settings window over IPC, so nothing about it is trusted.
  update(patch: unknown): BuddySettings {
    this.data = sanitize(patch, this.data);
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.log('[settings] save failed:', messageOf(err));
    }
    return this.get();
  }
}
