#!/usr/bin/env node
// Merge or remove Claude Buddy hooks in ~/.claude/settings.json, leaving everything else alone.
//
//   node scripts/merge-hooks.js [hooks.json] [--dry-run]   merge
//   node scripts/merge-hooks.js --remove [--dry-run]       remove
//
// Backs up to settings.json.bak (never overwriting an existing one) and prints a diff.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
// Marks our hooks, for dedupe and --remove.
const MARKER = '127.0.0.1:${CLAUDE_BUDDY_PORT:-7788}';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const remove = args.includes('--remove');
const hooksFile = args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'hooks', 'claude-settings-hooks.json');

const isOurs = (h) => typeof h.command === 'string' && h.command.includes(MARKER);

const before = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : '{}\n';
const settings = JSON.parse(before); // throws (and aborts) on invalid JSON rather than clobbering it
settings.hooks = settings.hooks || {};

// Drop any existing Claude Buddy hooks first, so re-running (or switching to the
// autostart variant) replaces them instead of duplicating. Other hooks are untouched.
for (const [event, groups] of Object.entries(settings.hooks)) {
  const kept = groups
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length > 0);
  if (kept.length) settings.hooks[event] = kept;
  else delete settings.hooks[event];
}

if (!remove) {
  const { hooks } = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  for (const [event, groups] of Object.entries(hooks)) {
    settings.hooks[event] = [...(settings.hooks[event] || []), ...groups];
  }
}
if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

const after = JSON.stringify(settings, null, 2) + '\n';
if (after === before) {
  console.log('No changes needed.');
  process.exit(0);
}

// Show a diff (uses the system `diff`; falls back to printing the new file).
const tmp = path.join(os.tmpdir(), `claude-settings-${process.pid}.json`);
fs.writeFileSync(tmp, after);
const d = spawnSync('diff', ['-u', '--label', 'settings.json (current)', '--label', 'settings.json (new)', SETTINGS, tmp], {
  encoding: 'utf8',
});
console.log(d.error ? after : d.stdout);
fs.unlinkSync(tmp);

if (dryRun) {
  console.log('Dry run: nothing written.');
  process.exit(0);
}

if (fs.existsSync(SETTINGS)) {
  let bak = `${SETTINGS}.bak`;
  if (fs.existsSync(bak)) bak = `${SETTINGS}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  fs.copyFileSync(SETTINGS, bak);
  console.log(`Backed up to ${bak}`);
}
fs.writeFileSync(SETTINGS, after);
console.log(`Wrote ${SETTINGS}`);
