// Signature moves: short timelines that add offsets to the pose. fn(p) gets progress 0..1.

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// Smooth 0 → 1 → 0 between a and b.
const bump = (p, a, b) => (p <= a || p >= b ? 0 : Math.sin(((p - a) / (b - a)) * Math.PI));
// Ease in to 1 by `a`, hold, ease out to 0 by `b`.
const hold = (p, a, b) => {
  if (p < a) return Math.sin((p / a) * Math.PI / 2);
  if (p > b) return Math.cos(((p - b) / (1 - b)) * Math.PI / 2);
  return 1;
};

// Jump with squash & stretch: crouch, stretch in the air, squash on landing, settle.
function jump(p, height) {
  const air = clamp01((p - 0.2) / 0.55);
  return {
    y: p > 0.2 && p < 0.75 ? Math.sin(air * Math.PI) * height : 0,
    squash: -0.1 * bump(p, 0, 0.22) + 0.1 * bump(p, 0.2, 0.5) - 0.14 * bump(p, 0.72, 1),
  };
}

export const MOVES = {
  // Tiny two-step nod.
  headBob: { dur: 0.7, fn: (p) => ({ headX: 0.16 * (bump(p, 0, 0.45) + bump(p, 0.5, 0.95)) }) },

  // Lean toward the UI (screen left) as if inspecting it.
  lean: { dur: 2.0, fn: (p) => {
    const k = hold(p, 0.25, 0.75);
    return { rotZ: 0.12 * k, torsoX: 0.12 * k, headZ: 0.1 * k, x: -0.08 * k, eyeX: -0.8 * k };
  } },

  // Lean sideways, look around, come back.
  peek: { dur: 2.0, fn: (p) => {
    const k = hold(p, 0.2, 0.7);
    return { browY: 0.4 * k, rotZ: 0.25 * k, x: -0.2 * k, headY: -0.4 * k, eyeX: -1 * k, headZ: 0.1 * k };
  } },

  // Shoulders up, hands open, drop.
  shrug: { dur: 1.0, fn: (p) => {
    const k = bump(p, 0, 1);
    return { browY: 0.5 * k, shoulderL: 0.1 * k, shoulderR: 0.1 * k, armLZ: 0.35 * k, armRZ: 0.35 * k, armLX: 0.3 * k, armRX: 0.3 * k, headX: -0.05 * k };
  } },

  bounce: { dur: 0.6, fn: (p) => jump(p, 0.16) },

  // Single-foot hop for big moments.
  hop: { dur: 0.85, fn: (p) => ({ ...jump(p, 0.4), legL: 0.6 * bump(p, 0.2, 0.8), rotZ: -0.06 * bump(p, 0.2, 0.8) }) },

  // Small 90° turn and back.
  spin: { dur: 1.3, fn: (p) => ({ rotY: (Math.PI / 2) * hold(p, 0.3, 0.6), ...jump(p, 0.08) }) },

  // Turn away, look back at the user, turn back.
  lookBack: { dur: 2.2, fn: (p) => {
    const away = hold(p, 0.15, 0.85);
    return {
      rotY: 0.9 * away,
      headY: -0.9 * bump(p, 0.35, 0.75),
      legL: 0.3 * bump(p, 0.05, 0.25) + 0.3 * bump(p, 0.8, 1),
      legR: 0.3 * bump(p, 0.15, 0.35),
    };
  } },

  // Arms overhead, stretch tall, little shake.
  stretch: { dur: 2.2, fn: (p) => {
    const up = hold(p, 0.15, 0.55);
    const shake = bump(p, 0.6, 0.85);
    return {
      armLZ: 2.9 * up, armRZ: 2.9 * up, squash: 0.14 * up, headX: -0.15 * up,
      lid: 0.5 * up, mouthOpen: 0.4 * up,
      rotZ: 0.08 * Math.sin(p * 40) * shake, torsoZ: -0.05 * Math.sin(p * 40) * shake,
    };
  } },

  // Happy shoulder/body wiggle.
  wiggle: { dur: 0.9, fn: (p) => {
    const k = bump(p, 0, 1);
    return { rotZ: 0.12 * Math.sin(p * Math.PI * 6) * k, torsoZ: -0.08 * Math.sin(p * Math.PI * 6) * k, smile: k };
  } },

  // A couple of little steps sideways; `dx` is applied permanently when it ends.
  sideStep: { dur: 1.0, shift: true, fn: (p, move) => ({
    x: move.dx * (p < 0.5 ? 0.5 * Math.sin(p * Math.PI) ** 2 : 0.5 + 0.5 * Math.sin((p - 0.5) * Math.PI) ** 2),
    legL: 0.6 * bump(p, 0, 0.5),
    legR: 0.6 * bump(p, 0.5, 1),
    y: 0.03 * (bump(p, 0, 0.5) + bump(p, 0.5, 1)),
  }) },

  // Everything stops for half a second, then a startled jolt.
  freeze: { dur: 1.1, fn: (p) => (p < 0.45 ? { freeze: true } : {
    browY: bump(p, 0.45, 0.95), squash: 0.12 * bump(p, 0.45, 0.7), z: -0.1 * bump(p, 0.45, 0.95), eyeScale: 0.5 * bump(p, 0.45, 0.9), mouthOpen: 0.6 * bump(p, 0.45, 0.9),
  }) },

  yawn: { dur: 2.4, fn: (p) => {
    const k = hold(p, 0.2, 0.7);
    return { browY: 0.6 * k, mouthOpen: k, headX: -0.2 * k, lid: 0.8 * k, armLZ: 0.5 * k, armRZ: 0.5 * k, squash: 0.05 * k };
  } },

  wave: { dur: 1.5, fn: (p) => {
    const k = hold(p, 0.12, 0.85);
    return { browY: 0.3 * k, armRZ: 2.4 * k + 0.35 * Math.sin(p * Math.PI * 7) * k, headZ: 0.1 * k, smile: k };
  } },

  // Idle hand fidget.
  fingers: { dur: 1.0, fn: (p) => {
    const k = bump(p, 0, 1);
    return { armLX: 0.15 * Math.sin(p * Math.PI * 8) * k, armRX: -0.15 * Math.sin(p * Math.PI * 8) * k, armLZ: 0.1 * k, armRZ: 0.1 * k };
  } },
};
