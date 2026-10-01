// Install or remove Claude Buddy's hooks in ~/.claude/settings.json.
// Everything else in that file is left exactly as it was.

import fs from 'fs';
import os from 'os';
import path from 'path';

/** One hook command, as Claude Code's settings file spells it. */
interface HookEntry {
  command?: string;
  [key: string]: unknown;
}

/** A matcher group holding a list of hook commands. */
interface HookGroup {
  hooks?: HookEntry[];
  [key: string]: unknown;
}

/** The parts of ~/.claude/settings.json we touch; the rest rides along untouched. */
interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export interface PlanOptions {
  remove?: boolean;
  autostart?: boolean;
}

export const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
// Every hook we write contains this, so we can find ours again.
export const MARKER = '127.0.0.1:${CLAUDE_BUDDY_PORT:-7788}';

const isOurs = (h: HookEntry): boolean => typeof h.command === 'string' && h.command.includes(MARKER);

/** Where the bundled hook definitions live, packaged or not. */
export function hooksDir(): string {
  const packaged = path.join(process.resourcesPath || '', 'hooks');
  return fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', '..', 'hooks');
}

/** Absolute path used by the autostart hook to relaunch the app. */
export function launcher(): string {
  // In a packaged app, `open -a` on the bundle; in the repo, the shell script.
  const bundle = process.execPath.split('/Contents/MacOS/')[0];
  return bundle.endsWith('.app')
    ? `open -a "${bundle}"`
    : `"${path.join(__dirname, '..', '..', 'scripts', 'launch-buddy.sh')}"`;
}

function read(): { raw: string; settings: ClaudeSettings } {
  const raw = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : '{}\n';
  return { raw, settings: JSON.parse(raw) as ClaudeSettings }; // invalid JSON throws instead of being clobbered
}

/** Strip our hooks out of a settings object, leaving other people's alone. */
function stripOurs(settings: ClaudeSettings): ClaudeSettings {
  const hooks = settings.hooks;
  if (!hooks) return settings;
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  return settings;
}

/** Build the settings file that `install`/`remove` would write. */
export function plan({ remove = false, autostart = false }: PlanOptions = {}): { before: string; after: string } {
  const { raw, settings } = read();
  const hooks = settings.hooks ?? {};
  settings.hooks = hooks;
  stripOurs(settings); // so re-running replaces instead of duplicating

  if (!remove) {
    const file = path.join(hooksDir(), autostart ? 'claude-settings-hooks.autostart.json' : 'claude-settings-hooks.json');
    const text = fs.readFileSync(file, 'utf8').replaceAll('"{{PROJECT_DIR}}/scripts/launch-buddy.sh"', launcher());
    const bundled = JSON.parse(text) as { hooks: Record<string, HookGroup[]> };
    for (const [event, groups] of Object.entries(bundled.hooks)) {
      hooks[event] = [...(hooks[event] || []), ...groups];
    }
  }
  if (!Object.keys(hooks).length) delete settings.hooks;
  return { before: raw, after: JSON.stringify(settings, null, 2) + '\n' };
}

/** True when our hooks are already in the user's settings. */
export function installed(): boolean {
  try {
    const { settings } = read();
    return Object.values(settings.hooks || {}).some((groups) => groups.some((g) => (g.hooks || []).some(isOurs)));
  } catch {
    return false;
  }
}

/** Write the new settings, backing the old file up first. Returns false if nothing changed. */
function write(after: string, before: string): boolean {
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

export const install = (opts?: PlanOptions): boolean => {
  const { before, after } = plan(opts);
  return write(after, before);
};

export const remove = (): boolean => {
  const { before, after } = plan({ remove: true });
  return write(after, before);
};
