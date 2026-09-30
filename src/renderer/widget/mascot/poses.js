// Pose library. A pose sets target values for joint channels; unset channels use NEUTRAL.
// Directions: +x is screen right, rotZ > 0 leans to screen left, headY < 0 turns to screen left.

export const NEUTRAL = {
  x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, squash: 0,
  torsoX: 0, torsoZ: 0, headX: 0, headY: 0, headZ: 0,
  armLX: 0, armLZ: 0.12, armRX: 0, armRZ: 0.12, shoulderL: 0, shoulderR: 0,
  legL: 0, legR: 0,
  eyeX: 0, eyeY: 0, eyeScale: 1, lid: 0, blink: 0, happy: 0, smile: 0, mouthOpen: 0,
  browY: 0, browAngle: 0, blush: 0, antennaX: 0, antennaZ: 0,
};

export const CHANNELS = Object.keys(NEUTRAL);

export const POSES = {
  neutral: {},

  // Weight on one leg, one hand "in the pocket", relaxed tilt.
  casual: { x: 0.04, rotZ: -0.04, torsoZ: 0.04, headZ: 0.08, armRX: -0.35, armRZ: 0.04, armLZ: 0.18, legR: 0.22, shoulderL: -0.02 },

  // Chest forward, hands on hips, head up.
  confident: { browY: -0.25, torsoX: -0.06, headX: -0.12, armLZ: 0.55, armRZ: 0.55, armLX: -0.25, armRX: -0.25, shoulderL: 0.03, shoulderR: 0.03, squash: 0.03 },

  // Head tilted ~17°, one shoulder up, leaning in.
  curious: { browY: 0.25, browAngle: 0.5, headZ: 0.3, headY: -0.2, torsoX: 0.1, rotZ: 0.06, shoulderL: 0.06, armLZ: 0.3, eyeX: -0.6, eyeScale: 1.1 },

  // Hand up at the cheek, eyes up, one leg crossed.
  thinking: { browAngle: 0.6, armRX: 1.3, armRZ: -0.5, headZ: -0.12, headX: -0.08, eyeX: 0.5, eyeY: 0.9, legL: 0.3 },

  // Both arms up, slight crouch, leaning forward.
  excited: { browY: 0.9, blush: 0.6, armLZ: 2.6, armRZ: 2.6, squash: -0.07, torsoX: 0.12, headX: -0.1, eyeScale: 1.2, smile: 1, mouthOpen: 0.3 },

  // Head tilted, one hand raised, uneven shoulders.
  confused: { browAngle: 0.85, headZ: -0.3, headY: 0.15, armRZ: 1.5, armRX: 0.4, shoulderR: 0.05, shoulderL: -0.03, eyeX: 0.4, eyeY: 0.3 },

  // Rounded shoulders, head dropping, arms loose, heavy lids.
  sleepy: { browY: -0.5, headX: 0.3, headZ: 0.08, torsoX: 0.1, armLZ: 0.02, armRZ: 0.02, squash: -0.06, lid: 0.55, shoulderL: -0.04, shoulderR: -0.04, eyeY: -0.4 },

  // Hand cupped at the ear, leaning in, eyes wide.
  listening: { armRX: 1.0, armRZ: -0.8, headZ: 0.22, headY: -0.1, torsoX: 0.1, rotZ: 0.05, eyeScale: 1.15, browY: 0.45 },

  // Chest out, hands behind back, small smile.
  proud: { browY: -0.2, blush: 0.3, torsoX: -0.1, headX: -0.12, armLX: -0.7, armRX: -0.7, armLZ: 0.08, armRZ: 0.08, smile: 1, squash: 0.03 },

  // Pull back, stretch, arms out, eyes wide.
  surprised: { browY: 1, z: -0.12, rotX: -0.12, squash: 0.1, armLZ: 0.7, armRZ: 0.7, headX: -0.18, eyeScale: 1.45, mouthOpen: 0.8 },
};

export function poseTarget(name) {
  return { ...NEUTRAL, ...(POSES[name] || {}) };
}
