// Settings validation and the lighting rules engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Settings, sanitize, DEFAULTS, SOUND_IDS } from '../main/settings';
import { Lighting } from '../main/lighting';
import type { LightingTarget } from '../main/lighting';

test('sanitize keeps valid fields and drops junk', () => {
  const s = sanitize({
    sound: false,
    evil: 1,
    led: {
      enabled: 'yes',
      rules: {
        done: { pattern: 'solid', color: [1, 2, 3] },
        working: { pattern: 'rainbow-laser', color: [999, 0, 0] },
      },
    },
  });
  assert.equal(s.sound, false);
  assert.equal((s as unknown as Record<string, unknown>).evil, undefined); // unknown keys never make it through
  assert.equal(s.led.enabled, DEFAULTS.led.enabled);
  assert.deepEqual(s.led.rules.done, { pattern: 'solid', color: [1, 2, 3] });
  assert.deepEqual(s.led.rules.working, DEFAULTS.led.rules.working);
});

test('defaults: police when Claude needs you, off while working and done', () => {
  const { rules } = DEFAULTS.led;
  assert.equal(rules.needs_input.pattern, 'police');
  assert.equal(rules.working.pattern, 'off');
  assert.equal(rules.done.pattern, 'off');
});

test('settings persist partial updates to disk', () => {
  const file = path.join(os.tmpdir(), `buddy-settings-${process.pid}.json`);
  const a = new Settings(file);
  a.update({ led: { autoConnect: true, rules: { idle: { pattern: 'pulse' } } } });
  const b = new Settings(file);
  assert.equal(b.get().led.autoConnect, true);
  assert.equal(b.get().led.rules.idle.pattern, 'pulse');
  assert.equal(b.get().led.rules.needs_input.pattern, 'police'); // untouched
  fs.unlinkSync(file);
});

interface FakeLed extends LightingTarget {
  calls: string[];
}

function fakeLed(): FakeLed {
  const calls: string[] = [];
  return {
    calls,
    showScene: async (scene) => { calls.push(scene.pattern); return true; },
    stopAnimation: async () => { calls.push('stop'); },
  };
}

test('lighting applies the rule for each state change, once', () => {
  const led = fakeLed();
  const lighting = new Lighting(led, () => DEFAULTS);
  lighting.setState('needs_input');
  lighting.setState('needs_input'); // repeated hook calls are ignored
  lighting.setState('working');
  lighting.setState('done');
  assert.deepEqual(led.calls, ['police', 'off', 'off']);
});

test('lighting does nothing but stop animations when disabled', () => {
  const led = fakeLed();
  const off = sanitize({ led: { enabled: false } });
  const lighting = new Lighting(led, () => off);
  lighting.setState('needs_input');
  assert.deepEqual(led.calls, ['stop']);
});

test('user name: trimmed, capped, and falls back to a default when blank', () => {
  assert.equal(sanitize({ userName: '  Ada   L  ' }).userName, 'Ada L');
  assert.equal(sanitize({ userName: 'x'.repeat(50) }).userName.length, 30);
  assert.equal(sanitize({ userName: '   ' }).userName, DEFAULTS.userName);
  assert.equal(sanitize({ userName: 42 }).userName, DEFAULTS.userName);
  assert.ok(DEFAULTS.userName.length > 0);
});

test('sound can be switched off and persists', () => {
  const file = path.join(os.tmpdir(), `buddy-sound-${process.pid}.json`);
  new Settings(file).update({ sound: false, userName: 'Sam' });
  const s = new Settings(file).get();
  assert.equal(s.sound, false);
  assert.equal(s.userName, 'Sam');
  fs.unlinkSync(file);
});

test('sound ids in settings match the renderer sound library', async () => {
  const { SOUND_OPTIONS } = await import('../renderer/shared/sounds.js');
  assert.deepEqual(SOUND_OPTIONS.map((o) => o.id), SOUND_IDS);
});

test('sound choices are validated', () => {
  const s = sanitize({ sounds: { volume: 150, done: 'tada', working: 'laser', repeat: false } }).sounds;
  assert.equal(s.volume, 100);
  assert.equal(s.done, 'tada');
  assert.equal(s.working, 'none'); // unknown id ignored
  assert.equal(s.repeat, false);
  assert.equal(s.needs_input, 'whistle');
});

test('voice settings are validated', () => {
  const v = sanitize({ voice: { locale: 'ar-SA', hotkey: '  Control+Alt+K  ', autoSend: true, enabled: 'nope' } }).voice;
  assert.equal(v.locale, 'ar-SA');
  assert.equal(v.hotkey, 'Control+Alt+K');
  assert.equal(v.autoSend, true);
  assert.equal(v.enabled, DEFAULTS.voice.enabled); // bad type ignored
  assert.equal(sanitize({ voice: { locale: 'xx-XX' } }).voice.locale, DEFAULTS.voice.locale);
});

test('voice defaults: enabled, English, and it does not send on its own', () => {
  assert.equal(DEFAULTS.voice.enabled, true);
  assert.equal(DEFAULTS.voice.locale, 'en-US');
  assert.equal(DEFAULTS.voice.autoSend, false);
});
