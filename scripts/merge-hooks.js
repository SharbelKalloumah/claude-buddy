#!/usr/bin/env node
// Merge or remove Claude Buddy hooks in ~/.claude/settings.json, leaving everything else alone.
//
//   node scripts/merge-hooks.js [--autostart] [--dry-run]   merge
//   node scripts/merge-hooks.js --remove [--dry-run]        remove
//
// Backs up to settings.json.bak (never overwriting an existing one) and prints a diff.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const hooks = require('../src/main/hooks');

const args = process.argv.slice(2);
const has = (flag) => args.includes(`--${flag}`);

const { before, after } = hooks.plan({ remove: has('remove'), autostart: has('autostart') });
if (after === before) {
  console.log('No changes needed.');
  process.exit(0);
}

// Show a diff (uses the system `diff`; falls back to printing the new file).
const tmp = path.join(os.tmpdir(), `claude-settings-${process.pid}.json`);
fs.writeFileSync(tmp, after);
const diff = spawnSync('diff', ['-u', '--label', 'settings.json (current)', '--label', 'settings.json (new)', hooks.SETTINGS, tmp], { encoding: 'utf8' });
console.log(diff.error ? after : diff.stdout);
fs.unlinkSync(tmp);

if (has('dry-run')) {
  console.log('Dry run: nothing written.');
  process.exit(0);
}

if (has('remove')) hooks.remove();
else hooks.install({ autostart: has('autostart') });
console.log(`Wrote ${hooks.SETTINGS}`);
