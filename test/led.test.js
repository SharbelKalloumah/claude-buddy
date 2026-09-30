// LED layer tests with a fake noble (no hardware).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const protocol = require('../src/main/led/protocol');
const { BleTransport } = require('../src/main/led/ble-transport');
const { LedController } = require('../src/main/led/controller');
const { framesFor } = require('../src/main/led/patterns');

console.log = () => {}; // silence [led] logging during tests

// ---------- fake noble ----------
function fakeNoble({ name = 'BJ_LED_M', state = 'poweredOn', writeDelay = 5, services = ['eea0'] } = {}) {
  const noble = new EventEmitter();
  noble.state = state;
  noble.writes = [];
  noble.concurrent = 0;
  noble.maxConcurrent = 0;

  const char = (uuid) => Object.assign(new EventEmitter(), {
    uuid,
    subscribed: false,
    async writeAsync(buf, withoutResponse) {
      noble.concurrent += 1;
      noble.maxConcurrent = Math.max(noble.maxConcurrent, noble.concurrent);
      await new Promise((r) => setTimeout(r, writeDelay));
      noble.concurrent -= 1;
      noble.writes.push({ uuid, hex: protocol.toHex(buf), withoutResponse });
    },
    async subscribeAsync() { this.subscribed = true; },
    async unsubscribeAsync() { this.subscribed = false; },
  });

  const peripheral = Object.assign(new EventEmitter(), {
    id: 'abc123', address: '', state: 'disconnected', advertisement: { localName: name },
    connects: 0,
    async connectAsync() { this.connects += 1; this.state = 'connected'; },
    async disconnectAsync() { this.state = 'disconnected'; },
    async discoverSomeServicesAndCharacteristicsAsync() {
      const chars = [char('ee01'), char('ee02')];
      this.chars = chars;
      return { services: services.map((uuid) => ({ uuid })), characteristics: chars };
    },
    drop() { this.state = 'disconnected'; this.emit('disconnect'); },
  });
  noble.peripheral = peripheral;
  noble.startScanningAsync = async () => { setTimeout(() => noble.emit('discover', peripheral), 5); };
  noble.stopScanningAsync = async () => {};
  return noble;
}

const newTransport = (noble, extra = {}) => new BleTransport({ loadNoble: () => noble, ...extra });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- protocol ----------
test('packets match BlueLights / bj_led byte-for-byte', () => {
  assert.equal(protocol.toHex(protocol.packets.powerOn()), '69 96 02 01 01');
  assert.equal(protocol.toHex(protocol.packets.powerOff()), '69 96 02 01 00');
  assert.equal(protocol.toHex(protocol.packets.rgb(255, 0, 128)), '69 96 05 02 FF 00 80');
  assert.equal(protocol.toHex(protocol.packets.effect(0x15, 3)), '69 96 03 03 15 03');
  assert.throws(() => protocol.packets.effect(0x16));
  assert.equal(protocol.toHex(protocol.packets.rgb(300, -5, 12.6)), '69 96 05 02 FF 00 0D'); // clamped
  assert.deepEqual(protocol.scaleRgb([255, 100, 0], 50), [128, 50, 0]);
});

// ---------- transport ----------
test('connects, finds EEA0/EE01/EE02, subscribes, reaches connected', async () => {
  const noble = fakeNoble();
  const t = newTransport(noble);
  const statuses = [];
  t.on('status', (s) => statuses.push(s));
  await t.connect();
  assert.deepEqual(statuses, ['connecting', 'connected']);
  assert.equal(noble.peripheral.chars[0].subscribed, true); // EE01 notifications on
  await t.write(protocol.packets.powerOn());
  assert.deepEqual(noble.writes, [{ uuid: protocol.COMMAND_CHAR, hex: '69 96 02 01 01', withoutResponse: !protocol.COMMAND_WRITE_WITH_RESPONSE }]);
});

test('writes are serialized (never two in flight)', async () => {
  const noble = fakeNoble({ writeDelay: 10 });
  const t = newTransport(noble);
  await t.connect();
  await Promise.all([1, 2, 3, 4].map((i) => t.write(protocol.packets.rgb(i, 0, 0))));
  assert.equal(noble.maxConcurrent, 1);
  assert.deepEqual(noble.writes.map((w) => w.hex.split(' ')[4]), ['01', '02', '03', '04']); // order kept
});

test('write while disconnected rejects instead of throwing out of the app', async () => {
  const t = newTransport(fakeNoble());
  await assert.rejects(t.write(protocol.packets.powerOn()), /not connected/);
});

test('notifications are forwarded', async () => {
  const noble = fakeNoble();
  const t = newTransport(noble);
  await t.connect();
  const got = new Promise((r) => t.once('notification', r));
  noble.peripheral.chars[0].emit('data', Buffer.from([0xaa, 0x01]));
  assert.equal(protocol.toHex(await got), 'AA 01');
});

test('reconnects automatically after a drop', async () => {
  const noble = fakeNoble();
  const t = newTransport(noble);
  await t.connect();
  const statuses = [];
  t.on('status', (s) => statuses.push(s));
  noble.peripheral.drop();
  await wait(1200); // first backoff is 1s
  assert.deepEqual(statuses, ['reconnecting', 'reconnecting', 'connected']);
  assert.equal(noble.peripheral.connects, 2);
  await t.disconnect();
});

test('disconnect() unsubscribes, disconnects and stops reconnecting', async () => {
  const noble = fakeNoble();
  const t = newTransport(noble);
  await t.connect();
  const ee01 = noble.peripheral.chars[0];
  await t.disconnect();
  assert.equal(ee01.subscribed, false);
  assert.equal(noble.peripheral.state, 'disconnected');
  assert.equal(ee01.listenerCount('data'), 0);
  noble.peripheral.drop(); // late event must not trigger a reconnect
  await wait(1200);
  assert.equal(t.status, 'disconnected');
});

test('Bluetooth off / permission denied / missing service → error, no crash', async () => {
  const off = newTransport(fakeNoble({ state: 'poweredOff' }));
  await assert.rejects(off.connect(), /Bluetooth is off/);
  assert.equal(off.status, 'reconnecting'); // retries: Bluetooth may be switched back on
  await off.disconnect();

  const denied = newTransport(fakeNoble({ state: 'unauthorized' }));
  await assert.rejects(denied.connect(), /permission denied/);
  assert.equal(denied.status, 'error');

  const broken = newTransport({ state: 'x' }, { loadNoble: () => { throw new Error('no binding'); } });
  await assert.rejects(broken.connect(), /Bluetooth library unavailable/);
  assert.equal(broken.status, 'error');

  const noService = newTransport(fakeNoble({ services: [] }));
  await assert.rejects(noService.connect(), /0xEEA0 not found/);
  await noService.disconnect();
});

test('emits the connected device, and honours a preferred id', async () => {
  const noble = fakeNoble();
  const t = newTransport(noble);
  const device = new Promise((r) => t.once('device', r));
  await t.connect();
  assert.deepEqual(await device, { id: 'abc123', name: 'BJ_LED_M' });
  await t.disconnect();

  const noble2 = fakeNoble();
  const other = newTransport(noble2, { scanTimeout: 50 });
  other.preferredId = 'someone-else';
  await assert.rejects(other.connect(), /timed out/); // BJ_LED_M is ignored: not the chosen one
  assert.equal(noble2.peripheral.connects, 0);
  await other.disconnect();
});

test('detect lists compatible controllers only', async () => {
  const noble = fakeNoble();
  noble.startScanningAsync = async () => {
    setTimeout(() => {
      noble.emit('discover', noble.peripheral);
      noble.emit('discover', { id: 'tv', rssi: -80, advertisement: { localName: 'GoogleTV' } });
      noble.emit('discover', { id: 'x', rssi: -50, advertisement: { serviceUuids: ['0000eea0-0000-1000-8000-00805f9b34fb'] } });
    }, 5);
  };
  const list = await newTransport(noble).detect(40);
  assert.deepEqual(list.map((d) => d.id).sort(), ['abc123', 'x']);
});

// ---------- controller ----------
test('controller API sends the expected packets', async () => {
  const noble = fakeNoble();
  const led = new LedController(newTransport(noble));
  await led.connect();
  await led.turnOn();
  await led.setRgb(255, 0, 0);
  await led.setBrightness(50);
  await led.turnOff();
  await led.disconnect();
  assert.deepEqual(noble.writes.map((w) => w.hex), [
    '69 96 02 01 01',
    '69 96 05 02 FF 00 00',
    '69 96 05 02 80 00 00', // brightness 50% scales the colour
    '69 96 02 01 00',
  ]);
  assert.equal(led.getState().status, 'disconnected');
});

test('rapid colour changes are coalesced (latest wins)', async () => {
  const noble = fakeNoble({ writeDelay: 20 });
  const led = new LedController(newTransport(noble));
  await led.connect();
  await Promise.all([10, 20, 30, 40, 50].map((v) => led.setBrightness(v)));
  // First and last are sent; the ones in between are dropped.
  assert.equal(noble.writes.length, 2);
  assert.equal(noble.writes[1].hex, '69 96 05 02 80 80 80');
  await led.disconnect();
});

test('controller restores the light after a reconnect', async () => {
  const noble = fakeNoble();
  const led = new LedController(newTransport(noble));
  await led.connect();
  await led.turnOn();
  await led.setRgb(0, 255, 0);
  noble.writes.length = 0;
  noble.peripheral.drop();
  await wait(1300);
  assert.deepEqual(noble.writes.map((w) => w.hex), ['69 96 02 01 01', '69 96 05 02 00 FF 00']);
  await led.disconnect();
});

// ---------- scenes ----------
const FAST = { pattern: 'police' };

async function connectedLed(writeDelay = 1) {
  const noble = fakeNoble({ writeDelay });
  const led = new LedController(newTransport(noble));
  await led.connect();
  return { noble, led, hex: () => noble.writes.map((w) => w.hex) };
}

test('patterns: police double-flashes red then blue; pulse/blink use the colour', () => {
  assert.deepEqual(framesFor('police').map(([rgb]) => rgb.join(',')),
    ['255,0,0', '0,0,0', '255,0,0', '0,0,0', '0,0,255', '0,0,0', '0,0,255', '0,0,0']);
  assert.deepEqual(framesFor('blink', [1, 2, 3])[0][0], [1, 2, 3]);
  assert.deepEqual(framesFor('pulse', [200, 100, 0]).at(4)[0], [200, 100, 0]); // peak = full colour
  assert.equal(framesFor('solid'), null);
});

test('scene off / solid write the right packets', async () => {
  const { led, noble, hex } = await connectedLed();
  await led.showScene({ pattern: 'off' });
  await led.showScene({ pattern: 'solid', color: [0, 255, 0] });
  assert.deepEqual(hex(), ['69 96 02 01 00', '69 96 02 01 01', '69 96 05 02 00 FF 00']);
  assert.equal(noble.maxConcurrent, 1);
  await led.disconnect();
});

test('animated scene loops until another scene replaces it', async () => {
  const { led, noble, hex } = await connectedLed();
  await led.showScene(FAST);
  await wait(700); // one full red+blue cycle
  await led.showScene({ pattern: 'off' });
  const n = noble.writes.length;
  await wait(200);
  assert.equal(noble.writes.length, n); // loop stopped
  assert.equal(hex()[0], '69 96 02 01 01'); // power on first
  assert.ok(hex().includes('69 96 05 02 FF 00 00') && hex().includes('69 96 05 02 00 00 FF'));
  assert.equal(hex().at(-1), '69 96 02 01 00');
  await led.disconnect();
});

test("'none' stops an animation and restores the user's light", async () => {
  const { led, hex } = await connectedLed();
  await led.turnOn();
  await led.setRgb(0, 255, 0);
  await led.showScene(FAST);
  await wait(100);
  await led.showScene({ pattern: 'none' });
  assert.equal(hex().at(-1), '69 96 05 02 00 FF 00');
  await led.disconnect();
});

test("'none' after an animation turns off if the user never set a light", async () => {
  const { led, hex } = await connectedLed();
  await led.showScene(FAST);
  await wait(100);
  await led.showScene({ pattern: 'none' });
  assert.equal(hex().at(-1), '69 96 02 01 00');
  await led.disconnect();
});

test('a manual command stops the animation and wins', async () => {
  const { led, noble, hex } = await connectedLed();
  await led.showScene(FAST);
  await wait(100);
  await led.setRgb(10, 20, 30);
  const n = noble.writes.length;
  await wait(300);
  assert.equal(noble.writes.length, n);
  assert.equal(hex().at(-1), '69 96 05 02 0A 14 1E');
  assert.equal(led.getState().scene, null);
  await led.disconnect();
});

test('scenes do nothing while disconnected', async () => {
  const led = new LedController(newTransport(fakeNoble()));
  assert.equal(await led.showScene(FAST), false);
  await led.stopAnimation();
});
