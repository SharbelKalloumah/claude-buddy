// Install or remove Claude Buddy's hooks in ~/.claude/settings.json.
// Everything else in that file is left exactly as it was.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
// Every hook we write contains this, so we can find ours again.
const MARKER = '127.0.0.1:${CLAUDE_BUDDY_PORT:-7788}';

const isOurs = (h) => typeof h.command === 'string' && h.command.includes(MARKER);

/** Where the bundled hook definitions live, packaged or not. */
function hooksDir() {
  const packaged = path.join(process.resourcesPath || '', 'hooks');
  return fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', '..', 'hooks');
}

/** Absolute path used by the autostart hook to relaunch the app. */
function launcher() {
  // In a packaged app, `open -a` on the bundle; in the repo, the shell script.
  const bundle = process.execPath.split('/Contents/MacOS/')[0];
  return bundle.endsWith('.app')
    ? `open -a "${bundle}"`
    : `"${path.join(__dirname, '..', '..', 'scripts', 'launch-buddy.sh')}"`;
}

function read() {
  const raw = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : '{}\n';
  return { raw, settings: JSON.parse(raw) }; // invalid JSON throws instead of being clobbered
}

/** Strip our hooks out of a settings object, leaving other people's alone. */
function stripOurs(settings) {
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  return settings;
}

/** Build the settings file that `install`/`remove` would write. */
function plan({ remove = false, autostart = false } = {}) {
  const { raw, settings } = read();
  settings.hooks = settings.hooks || {};
  stripOurs(settings); // so re-running replaces instead of duplicating

  if (!remove) {
    const file = path.join(hooksDir(), autostart ? 'claude-settings-hooks.autostart.json' : 'claude-settings-hooks.json');
    const text = fs.readFileSync(file, 'utf8').replaceAll('"{{PROJECT_DIR}}/scripts/launch-buddy.sh"', launcher());
    for (const [event, groups] of Object.entries(JSON.parse(text).hooks)) {
      settings.hooks[event] = [...(settings.hooks[event] || []), ...groups];
    }
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return { before: raw, after: JSON.stringify(settings, null, 2) + '\n' };
}

/** True when our hooks are already in the user's settings. */
function installed() {
  try {
    const { settings } = read();
    return Object.values(settings.hooks || {}).some((groups) => groups.some((g) => (g.hooks || []).some(isOurs)));
  } catch {
    return false;
  }
}

/** Write the new settings, backing the old file up first. Returns false if nothing changed. */
function write(after, before) {
  if (after === before) return false;
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  if (fs.existsSync(SETTINGS)) {
    let backup = `${SETTINGS}.bak`;
    if (fs.existsSync(backup)) backup = `${SETTINGS}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    fs.copyFileSync(SETTINGS, backup);
  }
  fs.writeFileSync(SETTINGS, after);
  return true;
}

const install = (opts) => { const { before, after } = plan(opts); return write(after, before); };
const remove = () => { const { before, after } = plan({ remove: true }); return write(after, before); };

module.exports = { SETTINGS, MARKER, plan, install, remove, installed, hooksDir, launcher };
