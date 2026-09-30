// LED probe: a hands-on diagnostic for the BJ_LED_M controller.
//
//   npm run led:probe                     scan, connect, list GATT, listen
//   npm run led:probe -- --scan-only      list nearby devices only
//   npm run led:probe -- --id <id>        use a specific device
//   npm run led:probe -- --send off,on,red   send packets (on|off|red|green|blue|white)
//   npm run led:probe -- --raw "69 96 02 01 01"   send exact bytes
//   npm run led:probe -- --char ee01      write to another characteristic
//   npm run led:probe -- --no-response    write without response
//
// Read-only unless --send/--raw is given. Runs under plain Node (Electron can't exit with noble).
// Always disconnects on exit or Ctrl+C: the strip allows only one connection.

const protocol = require('../src/main/led/protocol');
const { withTimeout, shortUuid } = require('../src/main/led/ble-transport');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

const SCAN_MS = Number(opt('scan-seconds') || 20) * 1000;
const LISTEN_MS = 10000;
const SENDABLE = {
  on: () => protocol.packets.powerOn(),
  off: () => protocol.packets.powerOff(),
  red: () => protocol.packets.rgb(255, 0, 0),
  green: () => protocol.packets.rgb(0, 255, 0),
  blue: () => protocol.packets.rgb(0, 0, 255),
  white: () => protocol.packets.rgb(255, 255, 255),
};

const say = (...a) => console.log(...a);
const hex = protocol.toHex;

// Returns [{ label, packet }] (empty for a read-only run).
function packetsToSend() {
  if (opt('raw')) {
    const bytes = opt('raw').trim().split(/[\s,:]+/).map((b) => parseInt(b, 16));
    if (!bytes.length || bytes.some((b) => !(b >= 0 && b <= 255))) throw new Error(`--raw: bad hex "${opt('raw')}"`);
    return [{ label: 'raw', packet: Buffer.from(bytes) }];
  }
  if (!opt('send')) return [];
  return opt('send').split(',').map((name) => {
    if (!SENDABLE[name]) throw new Error(`--send must be one of: ${Object.keys(SENDABLE).join(', ')} (comma-separated)`);
    return { label: name, packet: SENDABLE[name]() };
  });
}

async function waitForAdapter(noble) {
  if (noble.state !== 'poweredOn') {
    await withTimeout(new Promise((r) => noble.on('stateChange', (s) => s !== 'unknown' && s !== 'resetting' && r())), 8000, 'Bluetooth adapter')
      .catch(() => {});
  }
  if (noble.state === 'unauthorized') {
    throw new Error('Bluetooth permission denied. Allow your terminal app in System Settings → Privacy & Security → Bluetooth, then retry.');
  }
  if (noble.state !== 'poweredOn') throw new Error(`Bluetooth is not on (state: ${noble.state}).`);
}

function isCandidate(p) {
  const adv = p.advertisement || {};
  return /bj|led/i.test(adv.localName || '') || (adv.serviceUuids || []).some((u) => shortUuid(u) === protocol.GATT.service);
}

async function scan(noble) {
  const seen = new Map(); // id → peripheral
  const printed = new Map(); // id → name it was printed with
  say(`\nScanning for ${SCAN_MS / 1000}s… (★ = looks like the LED controller)\n`);
  noble.on('discover', (p) => {
    const adv = p.advertisement || {};
    // Print new devices, and again if their name arrives later.
    const printedAs = printed.get(p.id);
    seen.set(p.id, p);
    if (printed.has(p.id) && (printedAs || !adv.localName)) return;
    printed.set(p.id, adv.localName || null);
    const services = (adv.serviceUuids || []).map(shortUuid).join(',') || '-';
    const mfr = adv.manufacturerData ? hex(adv.manufacturerData) : '-';
    say(`${isCandidate(p) ? '★' : ' '} ${(adv.localName || '(no name)').padEnd(22)} rssi ${String(p.rssi).padStart(4)}  services ${services}  id ${p.id}${mfr !== '-' ? `  mfr ${mfr}` : ''}`);
  });
  await noble.startScanningAsync([], true); // duplicates on: catch names that arrive in scan responses
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, SCAN_MS);
    if (flag('scan-only')) return;
    // Stop early (after 1s grace) once the target is visible.
    noble.on('discover', (p) => {
      if (opt('id') ? p.id === opt('id') : isCandidate(p)) { clearTimeout(timer); setTimeout(resolve, 1000); }
    });
  });
  await noble.stopScanningAsync();
  noble.removeAllListeners('discover');
  return [...seen.values()];
}

// What to release on exit / Ctrl+C.
const active = { peripheral: null, notifiers: [] };

async function release() {
  const { peripheral, notifiers } = active;
  active.peripheral = null;
  for (const c of notifiers) await withTimeout(c.unsubscribeAsync(), 2000, 'unsubscribe').catch(() => {});
  if (peripheral) {
    await withTimeout(peripheral.disconnectAsync(), 3000, 'disconnect').catch(() => {});
    say('Disconnected.');
  }
}

async function inspect(p) {
  say(`\nConnecting to ${p.advertisement.localName || p.id}…`);
  active.peripheral = p;
  await withTimeout(p.connectAsync(), 15000, 'connect');
  say('Connected. Discovering all services…\n');
  const { services } = await withTimeout(p.discoverAllServicesAndCharacteristicsAsync(), 15000, 'discovery');

  let command = null;
  const notifiers = active.notifiers;
  const wanted = shortUuid(opt('char') || protocol.COMMAND_CHAR);
  for (const s of services) {
    say(`Service ${shortUuid(s.uuid)}${shortUuid(s.uuid) === protocol.GATT.service ? '   ← expected 0xEEA0' : ''}`);
    for (const c of s.characteristics) {
      const u = shortUuid(c.uuid);
      let value = '';
      if (c.properties.includes('read')) {
        value = await withTimeout(c.readAsync(), 3000, 'read').then((v) => `  value: ${hex(v) || '(empty)'}`).catch((e) => `  read failed: ${e.message}`);
      }
      say(`  char ${u}  [${c.properties.join(', ')}]${value}`);
      if (u === wanted) command = c;
      if (c.properties.includes('notify') || c.properties.includes('indicate')) notifiers.push(c);
    }
  }

  for (const c of notifiers) {
    c.on('data', (d) => say(`  ◀ notify ${shortUuid(c.uuid)}: ${hex(d)}`));
    await withTimeout(c.subscribeAsync(), 5000, 'subscribe').then(
      () => say(`Notifications enabled on ${shortUuid(c.uuid)}`),
      (e) => say(`Could not subscribe to ${shortUuid(c.uuid)}: ${e.message}`),
    );
  }

  const toSend = packetsToSend();
  if (toSend.length) {
    if (!command) throw new Error(`characteristic ${wanted} not found; nothing sent`);
    const withoutResponse = flag('no-response') || !command.properties.includes('write');
    for (const [i, { label, packet }] of toSend.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, 2000)); // time to see each change
      say(`\n▶ [${label.toUpperCase()}] to ${wanted} (${withoutResponse ? 'without' : 'with'} response): ${hex(packet)}`);
      await withTimeout(command.writeAsync(packet, withoutResponse), 5000, 'write').then(
        () => say('  write accepted by the device. Did the strip react?'),
        (e) => say(`  write FAILED: ${e.message}`),
      );
    }
  } else {
    say('\n(read-only run: no packets sent. Add --send on to test a command.)');
  }

  say(`\nListening for notifications for ${LISTEN_MS / 1000}s…`);
  await new Promise((r) => setTimeout(r, LISTEN_MS));
}

async function main() {
  packetsToSend(); // validate --send/--raw before touching Bluetooth
  let noble;
  try {
    noble = require('@abandonware/noble');
  } catch (e) {
    throw new Error(`Bluetooth library failed to load: ${e.message}`);
  }
  await waitForAdapter(noble);

  const devices = await scan(noble);
  if (flag('scan-only')) return;

  const wantedId = opt('id');
  const target = wantedId
    ? devices.find((d) => d.id === wantedId)
    : devices.filter(isCandidate).sort((a, b) => b.rssi - a.rssi)[0];

  if (!target) {
    say(`\nNo ${wantedId ? `device with id ${wantedId}` : 'LED controller'} found (${devices.length} devices seen).`);
    say('Checklist:');
    say('  • Close the bojiaLED app / turn off Bluetooth on your phone — a connected controller stops advertising.');
    say('  • Power-cycle the controller (unplug for 5s).');
    say('  • If a nameless device appears above with a strong rssi (e.g. -40 to -60), retry with --id <id>.');
    return;
  }
  await inspect(target);
}

let exiting = false;
async function finish(code) {
  if (exiting) return;
  exiting = true;
  await release();
  process.exit(code);
}

process.on('SIGINT', () => { say('\nInterrupted.'); finish(130); });
process.on('SIGTERM', () => finish(143));

main().then(
  () => finish(0),
  (err) => { say(`\n✖ ${err.message}`); finish(1); },
);
