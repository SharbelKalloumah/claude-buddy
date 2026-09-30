// Speech to text, then into the Claude Code prompt.
// Audio is captured in the widget; here we transcribe it with the macOS helper
// and paste the result into whichever app is frontmost.

const { clipboard, systemPreferences } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HELPER = path.join(__dirname, '..', '..', 'native', 'SpeechHelper.app');
const TRANSCRIBE_TIMEOUT = 90000;
const CLIPBOARD_RESTORE_MS = 600;

const log = (...a) => console.log('[voice]', ...a);

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr || '').trim() }));
      else resolve(String(stdout || ''));
    });
  });
}

const available = () => process.platform === 'darwin' && fs.existsSync(HELPER);

// Turn the helper's short error codes into something the user can act on.
function explain(reason) {
  if (/disabled/i.test(reason)) return 'Turn on Dictation in System Settings → Keyboard';
  if (/not-authorized/.test(reason)) return 'Allow speech recognition in System Settings → Privacy';
  if (/unavailable|no-recognizer/.test(reason)) return 'Speech is unavailable for this language';
  if (/timeout/.test(reason)) return 'Transcription timed out';
  return reason || 'Transcription failed';
}

/** WAV bytes → text. Throws with a readable message. */
async function transcribe(wav, locale = 'en-US') {
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

const hasAccessibility = () => systemPreferences.isTrustedAccessibilityClient(false);

/** Ask macOS to show the Accessibility prompt (returns the status before the dialog). */
const requestAccessibility = () => systemPreferences.isTrustedAccessibilityClient(true);

/**
 * Put `text` into the frontmost app. Pasting beats synthetic typing: it is instant
 * and keeps accents and emoji intact. The previous clipboard is put back afterwards.
 */
async function type(text, { submit = false } = {}) {
  const previous = clipboard.readText();
  clipboard.writeText(text);
  const keys = submit
    ? 'keystroke "v" using command down\ndelay 0.15\nkey code 36'
    : 'keystroke "v" using command down';
  try {
    await run('osascript', ['-e', `tell application "System Events"\n${keys}\nend tell`]);
  } catch (err) {
    clipboard.writeText(text); // leave it on the clipboard so nothing is lost
    throw new Error(hasAccessibility() ? 'Could not paste into the app' : 'Allow Claude Buddy under Privacy → Accessibility');
  }
  setTimeout(() => {
    if (clipboard.readText() === text) clipboard.writeText(previous);
  }, CLIPBOARD_RESTORE_MS);
}

module.exports = { transcribe, type, available, hasAccessibility, requestAccessibility };
