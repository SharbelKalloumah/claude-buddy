// Ad-hoc sign the bundle after packing.
// Apple Silicon refuses to launch unsigned binaries, and there is no Developer ID here,
// so an ad-hoc signature is the minimum that lets the app start at all.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['-s', '-', '--force', '--deep', '--timestamp=none', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed  ${path.basename(app)}`);
};
