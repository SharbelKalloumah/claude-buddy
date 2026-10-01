// App-facing LED API. Holds the user's light state and turns it into packets.
//   await led.connect(); await led.turnOn(); await led.setRgb(255, 0, 0);
//   await led.showScene({ pattern: 'police' }); await led.disconnect();

import { EventEmitter } from 'events';
import { asError } from '../errors';
import type { BleTransport } from './ble-transport';
import { framesFor } from './patterns';
import * as protocol from './protocol';

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** A scene as the lighting rules describe it; the colour is only used by some patterns. */
export interface SceneRequest {
  pattern: PatternId;
  color?: Rgb;
}

interface Animation {
  stopped: boolean;
  done: Promise<void>;
}

/** A write slot that keeps only the newest queued call while one is in flight. */
class PendingWrite {
  next: (() => Promise<void>) | null = null;
  readonly done: Promise<void>;

  constructor(first: () => Promise<void>, onFinish: () => void) {
    this.done = (async () => {
      try {
        await first();
        while (this.next) {
          const next = this.next;
          this.next = null;
          await next();
        }
      } finally {
        onFinish();
      }
    })();
  }
}

export class LedController extends EventEmitter {
  transport: BleTransport;
  state: LedState;
  private animation: Animation | null = null;
  /** Latest-value-wins write slots. */
  private pending = new Map<string, PendingWrite>();

  constructor(transport: BleTransport) {
    super();
    this.transport = transport;
    // on/rgb/brightness/effect are the user's manual choices (the 💡 panel).
    this.state = { status: transport.status, detail: null, on: null, rgb: [255, 255, 255], brightness: 100, effect: null, speed: 3, scene: null };

    transport.on('status', (status: LedStatus, detail?: string) => {
      this._update({ status, detail: detail || null });
      // Restore the user's light after a reconnect (a running animation resumes by itself).
      if (status === 'connected' && this.state.on !== null && !this.animation) this._resync().catch(() => {});
    });
    transport.on('notification', (buf: Buffer) => this.emit('notification', protocol.decodeNotification(buf)));
  }

  getState(): LedState {
    return { ...this.state, rgb: [...this.state.rgb] };
  }

  async connect(): Promise<void> {
    try {
      await this.transport.connect();
    } catch (caught) {
      const err = asError(caught);
      if (!err.cancelled) throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.pending.clear();
    await this.stopAnimation({ restore: false });
    return this.transport.disconnect();
  }

  // ---------- manual controls (always win over scenes) ----------

  async turnOn(): Promise<void> {
    await this.stopAnimation({ restore: false });
    await this.transport.write(protocol.packets.powerOn());
    this._update({ on: true, scene: null });
  }

  async turnOff(): Promise<void> {
    await this.stopAnimation({ restore: false });
    await this.transport.write(protocol.packets.powerOff());
    this._update({ on: false, scene: null });
  }

  async setRgb(r: number, g: number, b: number): Promise<void> {
    await this.stopAnimation({ restore: false });
    const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
    this._update({ rgb: [clamp(r), clamp(g), clamp(b)], effect: null, scene: null });
    return this._coalesce('colour', () => this._writeColour());
  }

  // 0–100 %, applied by scaling the colour.
  async setBrightness(percent: number): Promise<void> {
    await this.stopAnimation({ restore: false });
    this._update({ brightness: Math.min(100, Math.max(0, Math.round(percent))), scene: null });
    return this._coalesce('colour', () => this._writeColour());
  }

  // UNVERIFIED hardware effect, id 0..EFFECT_MAX.
  async setEffect(effectId: number, speed = this.state.speed): Promise<void> {
    await this.stopAnimation({ restore: false });
    await this.transport.write(protocol.packets.effect(effectId, speed));
    this._update({ effect: effectId, speed, scene: null });
  }

  async setSpeed(speed: number): Promise<void> {
    this._update({ speed });
    if (this.state.effect !== null) await this.setEffect(this.state.effect, speed);
  }

  // ---------- scenes (automatic, from the lighting rules) ----------

  // pattern: none | off | solid | pulse | blink | police. No-op unless connected.
  async showScene({ pattern, color = [255, 255, 255] }: SceneRequest): Promise<boolean> {
    if (this.state.status !== 'connected') return false;
    if (pattern === 'none') {
      await this.stopAnimation(); // leave the strip alone, but don't freeze mid-animation
      this._update({ scene: null });
      return true;
    }
    this._update({ scene: pattern });
    if (pattern === 'off') {
      await this.stopAnimation({ restore: false });
      await this.transport.write(protocol.packets.powerOff()).catch(() => {});
    } else if (pattern === 'solid') {
      await this.stopAnimation({ restore: false });
      await this.transport.write(protocol.packets.powerOn()).catch(() => {});
      await this.transport.write(protocol.packets.rgb(...color)).catch(() => {});
    } else {
      const frames = framesFor(pattern, color);
      if (frames) this._startAnimation(frames);
    }
    return true;
  }

  private _startAnimation(frames: LedFrame[]): void {
    if (this.animation) this.animation.stopped = true; // replaced; the old loop exits on its own
    // The loop needs the handle to watch `stopped`, so `done` is filled in right after.
    const anim: Animation = { stopped: false, done: Promise.resolve() };
    this.animation = anim;
    anim.done = this._runAnimation(anim, frames);
  }

  // Stop a running animation; restore=true puts back the user's manual light.
  async stopAnimation({ restore = true }: { restore?: boolean } = {}): Promise<void> {
    const anim = this.animation;
    if (!anim) return;
    anim.stopped = true;
    this.animation = null;
    await anim.done;
    if (restore) await this._restore().catch(() => {});
  }

  private async _runAnimation(anim: Animation, frames: LedFrame[]): Promise<void> {
    await this.transport.write(protocol.packets.powerOn()).catch(() => {});
    while (!anim.stopped) {
      for (const [rgb, ms] of frames) {
        if (anim.stopped) break;
        const started = Date.now();
        try {
          await this.transport.write(protocol.packets.rgb(...rgb));
        } catch {
          await sleep(1000); // reconnecting: retry until stopped
          continue;
        }
        await sleep(Math.max(0, ms - (Date.now() - started)));
      }
    }
  }

  // The user's manual light; off if they never set one.
  private async _restore(): Promise<void> {
    if (this.state.on !== true) return this.transport.write(protocol.packets.powerOff());
    if (this.state.effect !== null) return this.transport.write(protocol.packets.effect(this.state.effect, this.state.speed));
    return this._writeColour();
  }

  private async _resync(): Promise<void> {
    if (this.state.on === true) await this.transport.write(protocol.packets.powerOn());
    await this._restore();
  }

  private _writeColour(): Promise<void> {
    const [r, g, b] = protocol.HAS_BRIGHTNESS_PACKET ? this.state.rgb : protocol.scaleRgb(this.state.rgb, this.state.brightness);
    return this.transport.write(protocol.packets.rgb(r, g, b));
  }

  // Run fn now, or if the slot is busy, keep only the newest call for next.
  private _coalesce(slot: string, fn: () => Promise<void>): Promise<void> {
    const entry = this.pending.get(slot);
    if (entry) {
      entry.next = fn;
      return entry.done;
    }
    const pending = new PendingWrite(fn, () => { this.pending.delete(slot); });
    this.pending.set(slot, pending);
    return pending.done;
  }

  private _update(patch: Partial<LedState>): void {
    Object.assign(this.state, patch);
    this.emit('state', this.getState());
  }
}
