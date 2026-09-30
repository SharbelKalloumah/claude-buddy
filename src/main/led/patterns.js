// Light patterns. Animated ones are loops of [[r, g, b], durationMs] frames,
// built from the RGB packet only (hardware effects are unverified).

const DARK = [0, 0, 0];

// Shown in the settings UI, in this order. `color` = uses the rule's colour.
const PATTERNS = [
  { id: 'none', label: "Don't change" },
  { id: 'off', label: 'Off' },
  { id: 'solid', label: 'Solid colour', color: true },
  { id: 'pulse', label: 'Pulse', color: true },
  { id: 'blink', label: 'Blink', color: true },
  { id: 'police', label: 'Police lights' },
];

const scale = (rgb, k) => rgb.map((v) => Math.round(v * k));

const FRAMES = {
  police: () => [
    [[255, 0, 0], 140], [DARK, 60], [[255, 0, 0], 140], [DARK, 160],
    [[0, 0, 255], 140], [DARK, 60], [[0, 0, 255], 140], [DARK, 160],
  ],
  // Breathe from 10% to 100% and back, ~2s per cycle.
  pulse: (rgb) => {
    const up = [0.1, 0.25, 0.45, 0.7, 1].map((k) => [scale(rgb, k), 200]);
    return [...up, ...up.slice(1, -1).reverse()];
  },
  blink: (rgb) => [[rgb, 400], [DARK, 400]],
};

// Frames for an animated pattern, or null for static ones (none/off/solid).
function framesFor(pattern, rgb = [255, 255, 255]) {
  return FRAMES[pattern] ? FRAMES[pattern](rgb) : null;
}

const isPattern = (id) => PATTERNS.some((p) => p.id === id);

module.exports = { PATTERNS, framesFor, isPattern };
