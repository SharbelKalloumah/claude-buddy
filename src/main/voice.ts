// Speech to text, then into the Claude Code prompt.
// Audio is captured in the widget; here we transcribe it with the macOS helper
// and paste the result into whichever app is frontmost.

import { clipboard, systemPreferences } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Bundled under Resources/ once packaged; in the repo it sits in native/.
const HELPER = ((): string => {
  const packaged = path.join(process.resourcesPath || '', 'native', 'SpeechHelper.app');
  return fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', '..', 'native', 'SpeechHelper.app');
})();
const TRANSCRIBE_TIMEOUT = 90000;
const CLIPBOARD_RESTORE_MS = 600;

const log = (...a: unknown[]): void => console.log('[voice]', ...a);

function run(cmd: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr || '').trim() }));
      else resolve(String(stdout || ''));
    });
  });
}

export const available = (): boolean => process.platform === 'darwin' && fs.existsSync(HELPER);

// Turn the helper's short error codes into something the user can act on.
function explain(reason: string): string {
  if (/disabled/i.test(reason)) return 'Turn on Dictation in System Settings → Keyboard';
  if (/not-authorized/.test(reason)) return 'Allow speech recognition in System Settings → Privacy';
  if (/unavailable|no-recognizer/.test(reason)) return 'Speech is unavailable for this language';
  if (/timeout/.test(reason)) return 'Transcription timed out';
  return reason || 'Transcription failed';
}

/** WAV bytes → text. Throws with a readable message. */
export async function transcribe(wav: ArrayBuffer, locale = 'en-US'): Promise<string> {
  if (!available()) throw new Error('Speech helper is missing — run native/build.sh');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-voice-'));
  const audio = path.join(dir, 'clip.wav');
  const outFile = path.join(dir, 'out.txt');
  const errFile = path.join(dir, 'err.txt');
  try {
    fs.writeFileSync(audio, Buffer.from(wav));
    // Launched through `open` so macOS treats the helper as its own app for permissions.
    await run('open', ['-W', '--stdout', outFile, '--stderr', errFile, HELPER, '--args', audio, locale], TRANSCRIBE_TIMEOUT);
    const text = (fs.readFileSync(outFile, 'utf8') || '').trim();
    const failure = (fs.readFileSync(errFile, 'utf8') || '').trim();
    if (!text && failure) throw new Error(explain(failure));
    log(text ? `heard ${text.length} chars` : 'heard nothing');
    return text;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const hasAccessibility = (): boolean => systemPreferences.isTrustedAccessibilityClient(false);

/** Ask macOS to show the Accessibility prompt (returns the status before the dialog). */
export const requestAccessibility = (): boolean => systemPreferences.isTrustedAccessibilityClient(true);

/**
 * Put `text` into the frontmost app. Pasting beats synthetic typing: it is instant
 * and keeps accents and emoji intact. The previous clipboard is put back afterwards.
 * Electron's clipboard is asynchronous, so the write has to land before we paste.
 */
export async function type(text: string, { submit = false }: { submit?: boolean } = {}): Promise<void> {
  const previous = await clipboard.readText();
  await clipboard.writeText(text);
  const keys = submit
    ? 'keystroke "v" using command down\ndelay 0.15\nkey code 36'
    : 'keystroke "v" using command down';
  try {
    await run('osascript', ['-e', `tell application "System Events"\n${keys}\nend tell`]);
  } catch {
    await clipboard.writeText(text); // leave it on the clipboard so nothing is lost
    throw new Error(hasAccessibility() ? 'Could not paste into the app' : 'Allow Claude Buddy under Privacy → Accessibility');
  }
  setTimeout(() => {
    void (async () => {
      if (await clipboard.readText() === text) await clipboard.writeText(previous);
    })();
  }, CLIPBOARD_RESTORE_MS);
}
