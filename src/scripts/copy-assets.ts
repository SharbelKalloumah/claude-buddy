// Copy the renderer's non-TypeScript files into the compiled output.
// tsc only emits JavaScript, so the pages' HTML has to be carried across itself.
// Run after `tsc --build`; `npm run build` does both.

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const FROM = path.join(ROOT, 'src', 'renderer');
const TO = path.join(ROOT, 'out', 'renderer');
const ASSETS = /\.(html|css|svg|png|woff2?)$/;

/** Copy every asset under `dir`, keeping the directory layout. */
function copy(dir: string): number {
  let n = 0;
  for (const entry of fs.readdirSync(path.join(FROM, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      n += copy(rel);
    } else if (ASSETS.test(entry.name)) {
      const target = path.join(TO, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(FROM, rel), target);
      n += 1;
    }
  }
  return n;
}

if (!fs.existsSync(TO)) {
  console.error(`[assets] ${path.relative(ROOT, TO)} is missing — run \`tsc --build\` first`);
  process.exit(1);
}
console.log(`[assets] copied ${copy('.')} file(s) into ${path.relative(ROOT, TO)}`);
