// BLE link to a BJ_LED_M controller via noble.
// Handles scan, connect, subscribe, serialized writes, timeouts and auto-reconnect.
// Events: 'status' (status, detail), 'device' ({ id, name }), 'notification' (Buffer).

import { EventEmitter } from 'events';
import { asError, fail } from '../errors';
import * as protocol from './protocol';

/** Anything that emits the events we listen for; noble's own objects do. */
type NobleListener = (...args: any[]) => void;

interface NobleEmitter {
  on(event: string, listener: NobleListener): unknown;
  once(event: string, listener: NobleListener): unknown;
  removeListener(event: string, listener: NobleListener): unknown;
}

/** The slice of noble's API the transport uses, so the tests can hand us a fake. */
export interface NobleApi extends NobleEmitter {
  state: string;
  startScanningAsync(serviceUuids?: string[], allowDuplicates?: boolean): Promise<void>;
  stopScanningAsync(): Promise<void>;
}

export interface NobleAdvertisement {
  localName?: string;
  serviceUuids?: string[];
  manufacturerData?: Buffer;
}

export interface NobleCharacteristic extends NobleEmitter {
  uuid: string;
  writeAsync(data: Buffer, withoutResponse: boolean): Promise<void>;
  subscribeAsync(): Promise<void>;
  unsubscribeAsync(): Promise<void>;
}

export interface NoblePeripheral extends NobleEmitter {
  id: string;
  rssi: number;
  state: string;
  advertisement?: NobleAdvertisement;
  connectAsync(): Promise<void>;
  disconnectAsync(): Promise<void>;
  discoverSomeServicesAndCharacteristicsAsync(
    serviceUuids: string[],
    characteristicUuids: string[],
  ): Promise<{ services: { uuid: string }[]; characteristics: NobleCharacteristic[] }>;
}

export interface BleTransportOptions {
  /** Loaded lazily: requiring noble pins a BLE connection for the rest of the process. */
  loadNoble?: () => NobleApi;
  scanTimeout?: number;
}

const TIMEOUTS = { adapter: 5000, scan: 15000, connect: 10000, discover: 10000, subscribe: 5000, write: 3000, disconnect: 3000 };
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

const log = (...a: unknown[]): void => console.log('[led]', ...a);

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

// Normalize noble UUIDs to 16-bit short form when possible.
export const shortUuid = (u: string): string => {
  const s = u.toLowerCase().replace(/-/g, '');
  return s.length === 32 && s.endsWith('00001000800000805f9b34fb') ? s.slice(4, 8) : s;
};

// Looks like a supported controller: BJ_LED* name or advertises service 0xEEA0.
export function isCompatible(p: NoblePeripheral): boolean {
  const adv = p.advertisement ?? {};
  return /^BJ_LED/i.test(adv.localName || '') ||
    (adv.serviceUuids || []).some((u) => shortUuid(u) === protocol.GATT.service);
}

export class BleTransport extends EventEmitter {
  loadNoble: () => NobleApi;
  scanTimeout: number;
  noble: NobleApi | null = null;
  /** When set, only this device is used. */
  preferredId: string | null = null;
  device: LedDevice | null = null;
  peripheral: NoblePeripheral | null = null;
  commandChar: NobleCharacteristic | null = null;
  notifyChar: NobleCharacteristic | null = null;
  status: LedStatus = 'disconnected';
  /** Drives auto-reconnect. */
  wantConnected = false;
  reconnectTimer: NodeJS.Timeout | undefined;
  reconnectDelay = RECONNECT_MIN_MS;
  writeChain: Promise<void> = Promise.resolve();
  connecting: Promise<void> | null = null;
  scanning = false;
  /** Bumped by disconnect() to cancel an in-flight connect. */
  generation = 0;
  private _onDisconnect = (): void => this._handleDrop();
  private _onData = (data: Buffer): void => {
    log('Received:', protocol.toHex(data));
    this.emit('notification', data);
  };

  constructor({ loadNoble, scanTimeout = TIMEOUTS.scan }: BleTransportOptions = {}) {
    super();
    this.loadNoble = loadNoble || (() => require('@abandonware/noble') as unknown as NobleApi);
    this.scanTimeout = scanTimeout;
  }

  private _setStatus(status: LedStatus, detail?: string): void {
    this.status = status;
    this.emit('status', status, detail);
  }

  async connect(): Promise<void> {
    this.wantConnected = true;
    clearTimeout(this.reconnectTimer);
    if (this.status === 'connected') return;
    if (!this.connecting) {
      this.connecting = this._connectOnce()
        .then(() => { this.reconnectDelay = RECONNECT_MIN_MS; })
        .finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    this.wantConnected = false;
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    await this._teardown();
    this._setStatus('disconnected');
    log('Disconnected');
  }

  // Serialized write: never two in flight; a failure doesn't block the queue.
  write(buf: Buffer): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.status !== 'connected' || !this.commandChar) throw new Error('LED controller is not connected');
      log('Sending:', protocol.toHex(buf));
      await withTimeout(this.commandChar.writeAsync(buf, !protocol.COMMAND_WRITE_WITH_RESPONSE), TIMEOUTS.write, 'write');
    };
    const p = this.writeChain.then(run, run);
    this.writeChain = p.catch(() => {});
    return p;
  }

  // Scan for compatible controllers for `ms`; the connected one is listed too (it stops advertising).
  async detect(ms = 6000): Promise<DetectedDevice[]> {
    if (this.scanning || this.connecting) throw new Error('Bluetooth is busy, try again in a moment');
    const noble = await this._adapter();
    const found = new Map<string, DetectedDevice>();
    if (this.status === 'connected' && this.device) found.set(this.device.id, { ...this.device, rssi: null, connected: true });
    const onDiscover = (p: NoblePeripheral): void => {
      if (!isCompatible(p) || found.get(p.id)?.connected) return;
      found.set(p.id, { id: p.id, name: p.advertisement?.localName || '(no name)', rssi: p.rssi, connected: false });
    };
    this.scanning = true;
    log('Detecting devices...');
    try {
      noble.on('discover', onDiscover);
      await noble.startScanningAsync([], true);
      await new Promise((r) => setTimeout(r, ms));
    } finally {
      noble.removeListener('discover', onDiscover);
      await noble.stopScanningAsync().catch(() => {});
      this.scanning = false;
    }
    return [...found.values()];
  }

  private async _connectOnce(): Promise<void> {
    const gen = this.generation;
    const checkCancelled = (): void => {
      if (gen !== this.generation) throw fail('connect cancelled', { cancelled: true });
    };
    this._setStatus(this.status === 'reconnecting' ? 'reconnecting' : 'connecting');
    try {
      await this._teardown();
      const noble = await this._adapter();
      const peripheral = await this._scan(noble);
      checkCancelled();

      log('Connecting...');
      this.peripheral = peripheral; // so a cancel can disconnect it
      await withTimeout(peripheral.connectAsync(), TIMEOUTS.connect, 'connect');
      checkCancelled();
      peripheral.once('disconnect', this._onDisconnect);
      log('Connected');

      const { services, characteristics } = await withTimeout(
        peripheral.discoverSomeServicesAndCharacteristicsAsync([protocol.GATT.service], [protocol.GATT.ee01, protocol.GATT.ee02]),
        TIMEOUTS.discover,
        'service discovery',
      );
      checkCancelled();
      if (!services.some((s) => shortUuid(s.uuid) === protocol.GATT.service)) throw new Error('Service 0xEEA0 not found');
      log('Service 0xEEA0 found');

      const byUuid = (u: string): NobleCharacteristic | undefined => characteristics.find((c) => shortUuid(c.uuid) === u);
      const commandChar = byUuid(protocol.COMMAND_CHAR);
      const notifyChar = byUuid(protocol.NOTIFY_CHAR);
      if (!commandChar) throw new Error(`Command characteristic 0x${protocol.COMMAND_CHAR.toUpperCase()} not found`);
      if (!notifyChar) throw new Error(`Notify characteristic 0x${protocol.NOTIFY_CHAR.toUpperCase()} not found`);
      this.commandChar = commandChar;
      this.notifyChar = notifyChar;
      log(`${protocol.COMMAND_CHAR.toUpperCase()} command characteristic found`);
      log(`${protocol.NOTIFY_CHAR.toUpperCase()} notification characteristic found`);

      notifyChar.on('data', this._onData);
      await withTimeout(notifyChar.subscribeAsync(), TIMEOUTS.subscribe, 'subscribe');
      checkCancelled();
      log('Notifications enabled');

      this.device = { id: peripheral.id, name: peripheral.advertisement?.localName || protocol.GATT.deviceName };
      this.emit('device', this.device);
      this._setStatus('connected');
    } catch (caught) {
      const err = asError(caught);
      await this._teardown();
      if (err.cancelled) throw err;
      log('Connection failed:', err.message);
      if (this.wantConnected && !err.fatal) this._scheduleReconnect(err.message);
      else { this.wantConnected = false; this._setStatus('error', err.message); }
      throw err;
    }
  }

  // Load noble on first use and wait for the adapter. Never crashes the app.
  private async _adapter(): Promise<NobleApi> {
    if (!this.noble) {
      try {
        this.noble = this.loadNoble();
      } catch (caught) {
        throw fail(`Bluetooth library unavailable: ${asError(caught).message}`, { fatal: true });
      }
    }
    const noble = this.noble;
    if (noble.state !== 'poweredOn') {
      const settled = ['poweredOn', 'poweredOff', 'unauthorized', 'unsupported'];
      await withTimeout(
        new Promise<void>((resolve) => {
          const check = (s: string): void => { if (settled.includes(s)) { noble.removeListener('stateChange', check); resolve(); } };
          noble.on('stateChange', check);
          check(noble.state);
        }),
        TIMEOUTS.adapter,
        'Bluetooth adapter',
      ).catch(() => {});
    }
    if (noble.state === 'unauthorized') throw fail('Bluetooth permission denied (System Settings → Privacy & Security → Bluetooth)', { fatal: true });
    if (noble.state === 'unsupported') throw fail('Bluetooth LE not supported on this machine', { fatal: true });
    if (noble.state !== 'poweredOn') throw new Error('Bluetooth is off');
    return noble;
  }

  // Preferred device if one is chosen, otherwise the first compatible one.
  private async _scan(noble: NobleApi): Promise<NoblePeripheral> {
    const want = this.preferredId;
    log(want ? 'Scanning for the chosen device...' : `Scanning for ${protocol.GATT.deviceName}...`);
    let onDiscover: ((p: NoblePeripheral) => void) | undefined;
    this.scanning = true;
    try {
      const found = new Promise<NoblePeripheral>((resolve) => {
        onDiscover = (p) => { if (want ? p.id === want : isCompatible(p)) resolve(p); };
        noble.on('discover', onDiscover);
      });
      await noble.startScanningAsync([], false);
      const p = await withTimeout(found, this.scanTimeout, `scan for ${protocol.GATT.deviceName}`);
      log(`Found ${p.advertisement?.localName || protocol.GATT.deviceName}`);
      return p;
    } finally {
      if (onDiscover) noble.removeListener('discover', onDiscover);
      await noble.stopScanningAsync().catch(() => {});
      this.scanning = false;
    }
  }

  // Unsubscribe and disconnect, tolerating a device that's already gone.
  private async _teardown(): Promise<void> {
    const { peripheral, notifyChar } = this;
    this.commandChar = null;
    this.notifyChar = null;
    this.peripheral = null;
    if (notifyChar) {
      notifyChar.removeListener('data', this._onData);
      if (peripheral?.state === 'connected') {
        await withTimeout(notifyChar.unsubscribeAsync(), TIMEOUTS.subscribe, 'unsubscribe').catch(() => {});
      }
    }
    if (peripheral) {
      peripheral.removeListener('disconnect', this._onDisconnect);
      if (peripheral.state === 'connected' || peripheral.state === 'connecting') {
        await withTimeout(peripheral.disconnectAsync(), TIMEOUTS.disconnect, 'disconnect').catch(() => {});
      }
    }
  }

  private _handleDrop(): void {
    log('Connection dropped');
    this.commandChar = null;
    this.notifyChar = null;
    this.peripheral = null;
    if (this.wantConnected) this._scheduleReconnect('connection lost');
    else this._setStatus('disconnected');
  }

  private _scheduleReconnect(reason: string): void {
    clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
    log(`Reconnecting in ${Math.round(delay / 1000)}s (${reason})`);
    this._setStatus('reconnecting', reason);
    this.reconnectTimer = setTimeout(() => {
      if (this.wantConnected) this.connect().catch(() => {});
    }, delay);
  }
}
