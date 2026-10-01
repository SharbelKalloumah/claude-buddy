// Light patterns. Animated ones are loops of [[r, g, b], durationMs] frames,
// built from the RGB packet only (hardware effects are unverified).

const DARK: Rgb = [0, 0, 0];

// Shown in the settings UI, in this order. `color` = uses the rule's colour.
export const PATTERNS: LedPattern[] = [
  { id: 'none', label: "Don't change" },
  { id: 'off', label: 'Off' },
  { id: 'solid', label: 'Solid colour', color: true },
  { id: 'pulse', label: 'Pulse', color: true },
  { id: 'blink', label: 'Blink', color: true },
  { id: 'police', label: 'Police lights' },
];

const scale = ([r, g, b]: Rgb, k: number): Rgb => [Math.round(r * k), Math.round(g * k), Math.round(b * k)];

const FRAMES: Partial<Record<PatternId, (rgb: Rgb) => LedFrame[]>> = {
  police: () => [
    [[255, 0, 0], 140], [DARK, 60], [[255, 0, 0], 140], [DARK, 160],
    [[0, 0, 255], 140], [DARK, 60], [[0, 0, 255], 140], [DARK, 160],
  ],
  // Breathe from 10% to 100% and back, ~2s per cycle.
  pulse: (rgb) => {
    const up: LedFrame[] = [0.1, 0.25, 0.45, 0.7, 1].map((k) => [scale(rgb, k), 200]);
    return [...up, ...up.slice(1, -1).reverse()];
  },
  blink: (rgb) => [[rgb, 400], [DARK, 400]],
};

// Frames for an animated pattern, or null for static ones (none/off/solid).
export function framesFor(pattern: PatternId, rgb: Rgb = [255, 255, 255]): LedFrame[] | null {
  const build = FRAMES[pattern];
  return build ? build(rgb) : null;
}

export const isPattern = (id: unknown): id is PatternId => PATTERNS.some((p) => p.id === id);
