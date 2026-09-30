// BJ_LED_M protocol: GATT layout and packet builders. See docs/HARDWARE.md.
// Tags: VERIFIED = tested on the real device; UNVERIFIED = from open-source libraries.

const GATT = {
  deviceName: 'BJ_LED_M',
  service: 'eea0',
  ee01: 'ee01', // notify, read, write-without-response
  ee02: 'ee02', // read, write, write-without-response
};

// VERIFIED: commands go to EE02 with acknowledged writes.
const COMMAND_CHAR = GATT.ee02;
const NOTIFY_CHAR = GATT.ee01;
const COMMAND_WRITE_WITH_RESPONSE = true;

const HEADER = [0x69, 0x96];
const EFFECT_MAX = 0x15;

const byte = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new TypeError(`not a number: ${v}`);
  return Math.min(255, Math.max(0, n));
};

const packets = {
  powerOn: () => Buffer.from([...HEADER, 0x02, 0x01, 0x01]), // works in practice (police test)
  powerOff: () => Buffer.from([...HEADER, 0x02, 0x01, 0x00]), // VERIFIED
  rgb: (r, g, b) => Buffer.from([...HEADER, 0x05, 0x02, byte(r), byte(g), byte(b)]), // VERIFIED

  // UNVERIFIED (bj_led only). Last byte assumed to be speed, 0–10.
  effect: (effectId, speed = 3) => {
    if (!Number.isInteger(effectId) || effectId < 0 || effectId > EFFECT_MAX) {
      throw new RangeError(`effect id must be 0..${EFFECT_MAX}`);
    }
    return Buffer.from([...HEADER, 0x03, 0x03, effectId, Math.min(10, Math.max(0, Math.round(speed)))]);
  },
};

// No brightness packet is known, so brightness scales the RGB values.
const HAS_BRIGHTNESS_PACKET = false;
function scaleRgb([r, g, b], brightnessPercent) {
  const k = Math.min(100, Math.max(0, brightnessPercent)) / 100;
  return [r, g, b].map((v) => Math.round(byte(v) * k));
}

// Notification format is unknown ("12 13 14" arrives after connecting); hex-logged only.
function decodeNotification(buf) {
  return { raw: toHex(buf) };
}

const toHex = (buf) => [...buf].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

module.exports = {
  GATT,
  COMMAND_CHAR,
  NOTIFY_CHAR,
  COMMAND_WRITE_WITH_RESPONSE,
  EFFECT_MAX,
  HAS_BRIGHTNESS_PACKET,
  packets,
  scaleRgb,
  decodeNotification,
  toHex,
};
