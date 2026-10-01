// Mascot behaviour: simulated in Node (no rendering).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PersonalityName } from '../renderer/widget/mascot/brain.js';
import type { Channels } from '../renderer/widget/mascot/poses.js';

const load = async () => {
  const [{ Brain, PERSONALITIES }, { POSES, CHANNELS }, { MOVES }] = await Promise.all([
    import('../renderer/widget/mascot/brain.js'),
    import('../renderer/widget/mascot/poses.js'),
    import('../renderer/widget/mascot/moves.js'),
  ]);
  return { Brain, PERSONALITIES, POSES, CHANNELS, MOVES };
};

// Run the brain for `seconds` at 60 fps, checking every frame.
function simulate(brain: { update(dt: number): Channels }, seconds: number, check: (c: Channels) => void): void {
  for (let i = 0; i < seconds * 60; i++) check(brain.update(1 / 60));
}

test('every personality runs every state for a while with sane output', async () => {
  const { Brain, PERSONALITIES, CHANNELS } = await load();
  for (const name of Object.keys(PERSONALITIES) as PersonalityName[]) {
    const brain = new Brain();
    brain.setPersonality(name);
    for (const state of ['idle', 'working', 'needs_input', 'done', 'idle'] as BuddyState[]) {
      brain.setState(state);
      simulate(brain, 20, (c) => {
        for (const ch of CHANNELS) assert.ok(Number.isFinite(c[ch]), `${name}/${state}: ${ch} = ${c[ch]}`);
        assert.ok(Math.abs(c.x) < 0.6, `${name}/${state}: wandered off (x = ${c.x})`);
        assert.ok(c.lid >= 0 && c.lid <= 1 && c.mouthOpen >= 0 && c.mouthOpen <= 1);
      });
    }
  }
});

test('all moves referenced by cycles exist and every move stays finite', async () => {
  const { MOVES } = await load();
  for (const [name, move] of Object.entries(MOVES)) {
    for (let p = 0; p <= 1; p += 0.05) {
      for (const [ch, v] of Object.entries(move.fn(p, { dx: 0.16 }))) {
        if (ch !== 'freeze') assert.ok(Number.isFinite(v), `${name}.${ch} at ${p}`);
      }
    }
  }
});

test('freeze holds the pose still, then reacts', async () => {
  const { Brain } = await load();
  const brain = new Brain();
  brain.setState('needs_input'); // starts with a freeze
  const a = brain.update(1 / 60);
  const b = brain.update(0.2);
  assert.equal(a.headX, b.headX);
  assert.equal(a.armLZ, b.armLZ);
  simulate(brain, 2, () => {});
  assert.notEqual(brain.update(1 / 60).armLZ, a.armLZ); // moving again
});

test('done shows happy eyes; idle does not', async () => {
  const { Brain } = await load();
  const brain = new Brain();
  brain.setState('done');
  simulate(brain, 2, () => {});
  assert.ok(brain.update(1 / 60).happy > 0.9);
  brain.setState('idle');
  simulate(brain, 2, () => {});
  assert.ok(brain.update(1 / 60).happy < 0.1);
});

test('poses only use known channels', async () => {
  const { POSES, CHANNELS } = await load();
  for (const [name, pose] of Object.entries(POSES)) {
    for (const ch of Object.keys(pose)) assert.ok(CHANNELS.includes(ch as keyof Channels), `${name}.${ch}`);
  }
});
