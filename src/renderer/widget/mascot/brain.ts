// Behaviour: personalities, idle cycles and state reactions → joint channels each frame.
import { NEUTRAL, CHANNELS, poseTarget } from './poses.js';
import type { ChannelName, Channels } from './poses.js';
import { MOVES } from './moves.js';
import type { MoveContext, MoveDef } from './moves.js';

/** How he carries himself. speed = tempo, amp = size of gestures, base = resting pose. */
export interface Personality {
  speed: number;
  amp: number;
  base: string;
  cycles: string[];
}

export const PERSONALITIES = {
  calm: { speed: 0.75, amp: 0.7, base: 'neutral', cycles: ['calmBreath', 'observe', 'fidget', 'inspect'] },
  playful: { speed: 1.25, amp: 1.25, base: 'neutral', cycles: ['playful', 'playful2', 'observe', 'inspect'] },
  curious: { speed: 1.0, amp: 1.0, base: 'neutral', cycles: ['peekAround', 'lookAround', 'inspect', 'observe'] },
  confident: { speed: 0.85, amp: 0.9, base: 'confident', cycles: ['confident', 'observe', 'inspect'] },
  sleepy: { speed: 0.6, amp: 0.8, base: 'sleepy', cycles: ['sleepy', 'sleepyStretch', 'calmBreath'] },
} satisfies Record<string, Personality>;

export type PersonalityName = keyof typeof PERSONALITIES;

/** One beat of a cycle. 'base' as a pose means the personality's resting pose. */
interface Step {
  pose?: string;
  look?: [number, number];
  move?: string;
  smile?: number;
  blink?: boolean;
  /** Seconds to hold, before the personality's tempo is applied. */
  wait?: number;
}

/** A move that is currently playing. */
interface ActiveMove extends MoveContext {
  def: MoveDef;
  t: number;
  dur: number;
}

const CYCLES: Record<string, Step[]> = {
  // stand → breathe → look left → blink → shift weight → look at user → smile → head tilt → return
  observe: [
    { pose: 'base', look: [0, 0], wait: 1.5 }, { look: [-0.9, 0], wait: 1.1 }, { blink: true, wait: 0.5 },
    { pose: 'casual', wait: 1.3 }, { look: [0, 0], wait: 0.7 }, { smile: 1, wait: 1.2 },
    { pose: 'curious', look: [0, 0], wait: 1.2 }, { pose: 'base', smile: 0, wait: 1.0 },
  ],
  // stand → fingers → shoulders → look down → look up → blink → smile
  fidget: [
    { pose: 'base', wait: 1.0 }, { move: 'fingers', wait: 1.1 }, { move: 'shrug', wait: 1.1 },
    { look: [0, -0.9], wait: 0.9 }, { look: [0.2, 0.9], wait: 0.9 }, { look: [0, 0], blink: true, wait: 0.6 },
    { smile: 1, wait: 1.3 }, { smile: 0, wait: 0.4 },
  ],
  // stand → lean → inspect UI → straighten → small bounce
  inspect: [
    { pose: 'base', wait: 0.8 }, { move: 'lean', wait: 0.6 }, { look: [-1, 0.3], wait: 1.4 },
    { pose: 'base', look: [0, 0], wait: 0.6 }, { move: 'bounce', wait: 0.9 },
  ],
  calmBreath: [
    { pose: 'base', look: [0, 0], wait: 3 }, { blink: true, wait: 1.5 }, { look: [-0.5, 0.2], wait: 1.5 },
    { look: [0, 0], smile: 1, wait: 1.5 }, { smile: 0, wait: 1 },
  ],
  playful: [
    { move: 'hop', smile: 1, wait: 1 }, { move: 'wiggle', wait: 1 }, { pose: 'curious', wait: 0.9 },
    { pose: 'base', move: 'spin', wait: 1.4 }, { move: 'sideStep', smile: 0, wait: 1.2 },
  ],
  playful2: [
    { move: 'sideStep', wait: 1.1 }, { move: 'headBob', wait: 0.8 }, { move: 'lookBack', wait: 2.3 },
    { move: 'bounce', smile: 1, wait: 0.8 }, { smile: 0, wait: 0.5 },
  ],
  peekAround: [
    { move: 'peek', wait: 2.1 }, { look: [0, 0], blink: true, wait: 0.8 },
    { pose: 'curious', look: [-0.6, 0.2], wait: 1.4 }, { pose: 'base', look: [0, 0], wait: 0.8 },
  ],
  lookAround: [
    { look: [-1, 0], wait: 0.9 }, { look: [1, 0.2], wait: 0.9 }, { look: [0, 0.8], wait: 0.8 },
    { look: [0, 0], move: 'headBob', wait: 1 },
  ],
  confident: [
    { pose: 'confident', wait: 2 }, { move: 'headBob', wait: 0.8 }, { pose: 'proud', wait: 2 },
    { look: [-0.7, 0], wait: 1 }, { look: [0, 0], pose: 'confident', wait: 1.2 },
  ],
  sleepy: [
    { pose: 'sleepy', wait: 2.2 }, { blink: true, wait: 1.2 }, { move: 'yawn', wait: 2.5 },
    { pose: 'sleepy', look: [0, -0.5], wait: 2 },
  ],
  sleepyStretch: [{ move: 'stretch', wait: 2.3 }, { pose: 'sleepy', wait: 1.5 }, { blink: true, wait: 1 }],
};

// First reaction when Claude's state changes.
const ENTER: Record<BuddyState, Step[]> = {
  idle: [{ pose: 'base', smile: 0, look: [0, 0], wait: 0.5 }],
  working: [{ pose: 'neutral', move: 'headBob', look: [0, 0], smile: 0, wait: 0.7 }],
  needs_input: [{ move: 'freeze', wait: 0.5 }, { pose: 'surprised', look: [0, 0], wait: 0.8 }],
  done: [{ pose: 'excited', move: 'hop', smile: 1, wait: 0.9 }, { move: 'wiggle', wait: 1 }],
};

// What he keeps doing while the state lasts.
const STATE_LOOP: Record<Exclude<BuddyState, 'idle'>, Step[]> = {
  working: [
    { pose: 'thinking', look: [0.4, 0.9], wait: 2.5 }, { pose: 'neutral', move: 'lean', look: [-0.9, 0.1], wait: 2.1 },
    { move: 'headBob', wait: 0.8 }, { look: [-0.7, 0], wait: 1.4 }, { move: 'shrug', wait: 1.0 },
  ],
  needs_input: [
    { pose: 'excited', look: [0, 0], move: 'hop', wait: 0.9 }, { pose: 'neutral', move: 'wave', wait: 1.5 },
    { move: 'hop', wait: 0.9 }, { move: 'bounce', wait: 0.6 }, { move: 'bounce', wait: 0.6 },
  ],
  done: [{ pose: 'proud', smile: 1, wait: 2.2 }, { move: 'headBob', wait: 0.8 }, { move: 'wiggle', wait: 1 }],
};

function pickOne<T>(list: readonly T[], avoid?: T): T {
  const options = list.length > 1 ? list.filter((x) => x !== avoid) : list;
  return options[Math.floor(Math.random() * options.length)];
}

const EYE_CHANNELS = new Set<ChannelName>(['eyeX', 'eyeY', 'eyeScale', 'lid', 'happy', 'smile', 'mouthOpen', 'browY', 'browAngle', 'blush']);

export class Brain {
  c: Channels = { ...NEUTRAL };
  state: BuddyState = 'idle';
  poseName = 'base';
  look: [number, number] = [0, 0];
  smile = 0;
  moves: ActiveMove[] = [];
  queue: Step[] = [];
  wait = 0;
  lastCycle: string | undefined = undefined;
  /** Where side steps have moved him. */
  baseX = 0;
  talking = false;
  t = 0;
  blinkT = -1;
  nextBlink = 2 + Math.random() * 2;
  saccade: [number, number] = [0, 0];
  nextSaccade = 1;
  /** Antenna wobble. */
  spring = { x: 0, z: 0, vx: 0, vz: 0 };
  listening = false;
  /** 0..1 mic loudness. */
  listenLevel = 0;
  prevOut: { x: number; y: number; rotZ: number } | null = null;
  // All three are set by setPersonality(), at the end of the constructor.
  personalityName!: PersonalityName;
  p!: Personality;
  nextSwitch!: number;

  constructor() {
    this.setPersonality(pickOne(Object.keys(PERSONALITIES) as PersonalityName[]));
  }

  setPersonality(name: PersonalityName): void {
    this.personalityName = name;
    this.p = PERSONALITIES[name];
    this.nextSwitch = this.t + 120 + Math.random() * 120; // new mood every 2–4 min
  }

  setState(state: BuddyState): void {
    if (state === this.state) return;
    this.state = state;
    this.queue = [...ENTER[state]];
    this.wait = 0;
  }

  // Attention states always move at full size and speed.
  get speed(): number { return this.state === 'idle' ? this.p.speed : Math.max(1, this.p.speed); }
  get amp(): number { return this.state === 'idle' ? this.p.amp : Math.max(1, this.p.amp); }

  setListening(on: boolean): void {
    this.listening = on;
    this.queue = [];
    this.wait = 0;
  }

  private _nextSteps(): Step[] {
    if (this.listening) return [{ pose: 'listening', look: [0, 0.1], smile: 0, wait: 2 }];
    if (this.state !== 'idle') return [...STATE_LOOP[this.state]];
    if (this.t > this.nextSwitch) this.setPersonality(pickOne(Object.keys(PERSONALITIES) as PersonalityName[], this.personalityName));
    this.lastCycle = pickOne(this.p.cycles, this.lastCycle);
    return [...CYCLES[this.lastCycle]];
  }

  private _runStep(step: Step): void {
    if (step.pose) this.poseName = step.pose;
    if (step.look) this.look = step.look;
    if (step.smile !== undefined) this.smile = step.smile;
    if (step.blink) this.blinkT = 0;
    if (step.move) this.play(step.move);
    this.wait += step.wait ?? 1;
  }

  play(name: string): void {
    const def = MOVES[name];
    if (!def) return;
    const move: ActiveMove = { def, t: 0, dur: def.dur / this.speed, dx: 0 };
    if (def.shift) {
      const dir = this.baseX > 0.1 ? -1 : this.baseX < -0.1 ? 1 : Math.random() < 0.5 ? -1 : 1;
      move.dx = dir * 0.16;
    }
    this.moves.push(move);
  }

  update(dt: number): Channels {
    // Freeze: everything else holds still until the freeze part of the move is over.
    const frozen = this.moves.some((m) => m.def === MOVES.freeze && m.t / m.dur < 0.45);
    const step = frozen ? 0 : dt;
    this.t += step;

    // Saccades: small random glances between the scripted looks.
    if (!frozen) {
      this.nextSaccade -= dt;
      if (this.nextSaccade <= 0) {
        this.saccade = Math.random() < 0.4 ? [0, 0] : [(Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.35];
        this.nextSaccade = 0.8 + Math.random() * 2.2;
      }
    }

    this.wait -= step * this.speed;
    while (this.wait <= 0) {
      if (!this.queue.length) this.queue = this._nextSteps();
      const next = this.queue.shift();
      if (!next) break; // a cycle is never empty; this only guards the loop
      this._runStep(next);
    }

    // Blend toward the pose (+ look / smile), scaled by personality.
    const name = this.poseName === 'base' ? this.p.base : this.poseName;
    const target = poseTarget(name);
    const k = 0.6 + 0.4 * this.amp;
    for (const ch of CHANNELS) {
      if (!EYE_CHANNELS.has(ch)) target[ch] = NEUTRAL[ch] + (target[ch] - NEUTRAL[ch]) * k;
    }
    target.eyeX += this.look[0];
    target.eyeY += this.look[1];
    target.headY += this.look[0] * 0.25;
    target.headX -= this.look[1] * 0.12;
    target.x += this.baseX;
    target.eyeX += this.saccade[0];
    target.eyeY += this.saccade[1];
    target.smile = Math.max(target.smile, this.smile);
    target.happy = this.state === 'done' ? 1 : 0;
    target.blush = Math.max(target.blush, target.happy * 0.6);

    const body = 1 - Math.exp(-6 * this.speed * step);
    const eyes = 1 - Math.exp(-12 * step);
    for (const ch of CHANNELS) this.c[ch] += (target[ch] - this.c[ch]) * (EYE_CHANNELS.has(ch) ? eyes : body);

    // Add active moves on top.
    const out: Channels = { ...this.c };
    for (const m of this.moves) {
      if (!frozen || m.def === MOVES.freeze) m.t += dt;
      const offsets = m.def.fn(Math.min(1, m.t / m.dur), m);
      for (const [key, value] of Object.entries(offsets)) {
        if (typeof value !== 'number') continue; // skips the freeze flag
        const ch = key as ChannelName;
        if (!(ch in out)) continue;
        const scaled = !EYE_CHANNELS.has(ch) && !m.def.shift; // side steps move an exact distance
        out[ch] += scaled ? value * this.amp : value;
      }
    }
    for (const m of this.moves) if (m.t >= m.dur && m.def.shift) { this.baseX += m.dx; this.c.x += m.dx; }
    this.moves = this.moves.filter((m) => m.t < m.dur);

    // Breathing, micro head drift, talking mouth, blinks.
    out.squash += 0.012 * Math.sin(this.t * 2.2 * this.speed);
    out.headY += 0.03 * Math.sin(this.t * 0.6);
    if (this.listening) out.squash += this.listenLevel * 0.09; // he perks up as you speak
    out.headX += 0.02 * Math.sin(this.t * 0.83 + 1);
    out.rotZ += 0.015 * Math.sin(this.t * 0.9 * this.speed);

    // Antenna: damped spring lagging behind body motion.
    const prev = this.prevOut;
    if (prev && dt > 0) {
      const vx = (out.x - prev.x) / dt + ((out.rotZ - prev.rotZ) / dt) * 0.8;
      const vy = (out.y - prev.y) / dt;
      const s = this.spring;
      const tz = Math.max(-0.7, Math.min(0.7, -vx * 0.3));
      const tx = Math.max(-0.7, Math.min(0.7, vy * 0.22));
      s.vz += ((tz - s.z) * 80 - s.vz * 6) * dt;
      s.vx += ((tx - s.x) * 80 - s.vx * 6) * dt;
      s.z = Math.max(-0.9, Math.min(0.9, s.z + s.vz * dt));
      s.x = Math.max(-0.9, Math.min(0.9, s.x + s.vx * dt));
    }
    this.prevOut = { x: out.x, y: out.y, rotZ: out.rotZ };
    out.antennaZ = this.spring.z;
    out.antennaX = this.spring.x;
    if (this.talking) out.mouthOpen = Math.max(out.mouthOpen, 0.35 * (0.5 + 0.5 * Math.sin(this.t * 20)));
    out.blink = frozen ? 0 : this._blink(dt);
    out.smile = Math.min(1, out.smile);
    out.lid = Math.min(1, Math.max(0, out.lid));
    out.mouthOpen = Math.min(1, Math.max(0, out.mouthOpen));
    return out;
  }

  private _blink(dt: number): number {
    if (this.blinkT < 0) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) this.blinkT = 0;
      return 0;
    }
    this.blinkT += dt;
    const dur = this.state === 'idle' && this.p === PERSONALITIES.sleepy ? 0.4 : 0.16; // slow sleepy blinks
    if (this.blinkT >= dur) {
      this.blinkT = -1;
      this.nextBlink = 2.5 + Math.random() * 3.5;
      return 0;
    }
    return Math.sin((this.blinkT / dur) * Math.PI);
  }
}
