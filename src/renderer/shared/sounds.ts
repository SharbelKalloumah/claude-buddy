// Synthesized sound effects (Web Audio, no files). Shared by the widget and settings pages.
// IDs must match SOUND_IDS in src/main/settings.ts.

let ctx: AudioContext | null = null;
const audio = (): AudioContext => (ctx ??= new AudioContext());

/** A point on a frequency glide: [time relative to the start, frequency]. */
type GlidePoint = [number, number];

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  vibrato?: number;
}

interface BellOptions {
  dur?: number;
  gain?: number;
  type?: OscillatorType;
}

interface Sound {
  label: string;
  play: (out: AudioNode, start: number) => void;
}

// A tone with a frequency glide: points = [[time, freq], ...] relative to `start`.
function tone(out: AudioNode, start: number, points: GlidePoint[], { type = 'sine', gain = 0.25, vibrato = 0 }: ToneOptions = {}): void {
  const c = audio();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(points[0][1], start);
  for (const [t, f] of points.slice(1)) osc.frequency.exponentialRampToValueAtTime(f, start + t);
  const end = start + points[points.length - 1][0];
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.02);
  g.gain.setValueAtTime(gain, Math.max(start + 0.02, end - 0.06));
  g.gain.linearRampToValueAtTime(0, end);
  if (vibrato) {
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 7;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(end);
  }
  osc.connect(g).connect(out);
  osc.start(start);
  osc.stop(end + 0.02);
}

// A struck note that fades out (bells, chimes).
function bell(out: AudioNode, start: number, freq: number, { dur = 1.2, gain = 0.3, type = 'sine' }: BellOptions = {}): void {
  const c = audio();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.connect(g).connect(out);
  osc.start(start);
  osc.stop(start + dur);
}

const SOUNDS: Record<Exclude<SoundId, 'none'>, Sound> = {
  whistle: { label: 'Wolf whistle', play: (o, t) => {
    tone(o, t, [[0, 900], [0.28, 2300]], { vibrato: 22, gain: 0.22 });
    tone(o, t + 0.42, [[0, 1000], [0.16, 2500], [0.7, 750]], { vibrato: 22, gain: 0.22 });
  } },
  siren: { label: 'Police siren', play: (o, t) => {
    for (let i = 0; i < 2; i++) tone(o, t + i * 0.9, [[0, 650], [0.45, 1250], [0.9, 650]], { type: 'triangle', gain: 0.2 });
  } },
  doorbell: { label: 'Doorbell', play: (o, t) => {
    bell(o, t, 659.3, { dur: 1.0 });
    bell(o, t + 0.45, 523.3, { dur: 1.4 });
  } },
  chime: { label: 'Chime', play: (o, t) => {
    [1046.5, 1318.5, 1568].forEach((f, i) => bell(o, t + i * 0.12, f, { dur: 1.2, gain: 0.18 }));
  } },
  beep: { label: 'Beep-beep', play: (o, t) => {
    for (const dt of [0, 0.18]) tone(o, t + dt, [[0, 880], [0.1, 880]], { type: 'square', gain: 0.08 });
  } },
  success: { label: 'Success', play: (o, t) => {
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => bell(o, t + i * 0.09, f, { dur: 0.5, gain: 0.18, type: 'triangle' }));
  } },
  tada: { label: 'Ta-da', play: (o, t) => {
    for (const f of [523.3, 659.3, 784]) bell(o, t, f, { dur: 0.18, gain: 0.1, type: 'sawtooth' });
    for (const f of [523.3, 659.3, 784, 1046.5]) bell(o, t + 0.2, f, { dur: 1.3, gain: 0.09, type: 'sawtooth' });
  } },
  pop: { label: 'Pop', play: (o, t) => tone(o, t, [[0, 700], [0.09, 180]], { gain: 0.35 }) },
  click: { label: 'Click', play: (o, t) => tone(o, t, [[0, 2200], [0.03, 1800]], { type: 'square', gain: 0.06 }) },
};

const isSound = (id: string): id is keyof typeof SOUNDS => Object.hasOwn(SOUNDS, id);

// Play a sound by id at volume 0–100. 'none' or unknown ids are silent.
export function playSound(id: string, volume = 70): void {
  if (!isSound(id) || volume <= 0) return;
  const c = audio();
  const master = c.createGain();
  master.gain.value = Math.min(100, volume) / 100;
  master.connect(c.destination);
  SOUNDS[id].play(master, c.currentTime + 0.03);
}

// For select menus: [{ id, label }], with "None" first.
export const SOUND_OPTIONS: { id: SoundId; label: string }[] = [
  { id: 'none', label: 'None' },
  ...(Object.keys(SOUNDS) as (keyof typeof SOUNDS)[]).map((id) => ({ id, label: SOUNDS[id].label })),
];
