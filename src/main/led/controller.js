// App-facing LED API. Holds the user's light state and turns it into packets.
//   await led.connect(); await led.turnOn(); await led.setRgb(255, 0, 0);
//   await led.showScene({ pattern: 'police' }); await led.disconnect();

const { EventEmitter } = require('events');
const protocol = require('./protocol');
const { framesFor } = require('./patterns');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class LedController extends EventEmitter {
  constructor(transport) {
    super();
    this.transport = transport;
    // on/rgb/brightness/effect are the user's manual choices (the 💡 panel).
    this.state = { status: transport.status, detail: null, on: null, rgb: [255, 255, 255], brightness: 100, effect: null, speed: 3, scene: null };
    this.animation = null;
    this.pending = new Map(); // latest-value-wins write slots

    transport.on('status', (status, detail) => {
      this._update({ status, detail: detail || null });
      // Restore the user's light after a reconnect (a running animation resumes by itself).
      if (status === 'connected' && this.state.on !== null && !this.animation) this._resync().catch(() => {});
    });
    transport.on('notification', (buf) => this.emit('notification', protocol.decodeNotification(buf)));
  }

  getState() {
    return { ...this.state, rgb: [...this.state.rgb] };
  }

  async connect() {
    try {
      await this.transport.connect();
    } catch (err) {
      if (!err.cancelled) throw err;
    }
  }

  async disconnect() {
    this.pending.clear();
    await this.stopAnimation({ restore: false });
    return this.transport.disconnect();
  }

  // ---------- manual controls (always win over scenes) ----------

  async turnOn() {
    await this.stopAnimation({ restore: false });
    await this.transport.write(protocol.packets.powerOn());
    this._update({ on: true, scene: null });
  }

  async turnOff() {
    await this.stopAnimation({ restore: false });
    await this.transport.write(protocol.packets.powerOff());
    this._update({ on: false, scene: null });
  }

  async setRgb(r, g, b) {
    await this.stopAnimation({ restore: false });
    this._update({ rgb: [r, g, b].map((v) => Math.min(255, Math.max(0, Math.round(v)))), effect: null, scene: null });
    return this._coalesce('colour', () => this._writeColour());
  }

  // 0–100 %, applied by scaling the colour.
  async setBrightness(percent) {
    await this.stopAnimation({ restore: false });
    this._update({ brightness: Math.min(100, Math.max(0, Math.round(percent))), scene: null });
    return this._coalesce('colour', () => this._writeColour());
  }

  // UNVERIFIED hardware effect, id 0..EFFECT_MAX.
  async setEffect(effectId, speed = this.state.speed) {
    await this.stopAnimation({ restore: false });
    await this.transport.write(protocol.packets.effect(effectId, speed));
    this._update({ effect: effectId, speed, scene: null });
  }

  async setSpeed(speed) {
    this._update({ speed });
    if (this.state.effect !== null) await this.setEffect(this.state.effect, speed);
  }

  // ---------- scenes (automatic, from the lighting rules) ----------

  // pattern: none | off | solid | pulse | blink | police. No-op unless connected.
  async showScene({ pattern, color = [255, 255, 255] }) {
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
      this._startAnimation(framesFor(pattern, color));
    }
    return true;
  }

  _startAnimation(frames) {
    if (this.animation) this.animation.stopped = true; // replaced; the old loop exits on its own
    const anim = { stopped: false, done: null };
    this.animation = anim;
    anim.done = this._runAnimation(anim, frames);
  }

  // Stop a running animation; restore=true puts back the user's manual light.
  async stopAnimation({ restore = true } = {}) {
    const anim = this.animation;
    if (!anim) return;
    anim.stopped = true;
    this.animation = null;
    await anim.done;
    if (restore) await this._restore().catch(() => {});
  }

  async _runAnimation(anim, frames) {
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
  async _restore() {
    if (this.state.on !== true) return this.transport.write(protocol.packets.powerOff());
    if (this.state.effect !== null) return this.transport.write(protocol.packets.effect(this.state.effect, this.state.speed));
    return this._writeColour();
  }

  async _resync() {
    if (this.state.on === true) await this.transport.write(protocol.packets.powerOn());
    await this._restore();
  }

  _writeColour() {
    const [r, g, b] = protocol.HAS_BRIGHTNESS_PACKET ? this.state.rgb : protocol.scaleRgb(this.state.rgb, this.state.brightness);
    return this.transport.write(protocol.packets.rgb(r, g, b));
  }

  // Run fn now, or if the slot is busy, keep only the newest call for next.
  _coalesce(slot, fn) {
    const entry = this.pending.get(slot);
    if (entry) {
      entry.next = fn;
      return entry.done;
    }
    const e = { next: null, done: null };
    e.done = (async () => {
      try {
        await fn();
        while (e.next) {
          const next = e.next;
          e.next = null;
          await next();
        }
      } finally {
        this.pending.delete(slot);
      }
    })();
    this.pending.set(slot, e);
    return e.done;
  }

  _update(patch) {
    Object.assign(this.state, patch);
    this.emit('state', this.getState());
  }
}

module.exports = { LedController };
