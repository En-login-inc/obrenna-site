// Packs ../Obrenna-Server into public/install/obrenna-server.tar.gz (plus a
// .sha256 file) so the site can serve it to the curl/PowerShell bootstrap
// scripts in public/install/. The control panel must already be built
// (`npm run build` in Obrenna-Server/control-panel).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = resolve(siteRoot, '..', 'Obrenna-Server');
const outDir = join(siteRoot, 'public', 'install');
const archive = join(outDir, 'obrenna-server.tar.gz');

for (const required of ['pyproject.toml', 'obrenna_server/main.py', 'obrenna_server/panel_dist/index.html', 'scripts/start.sh']) {
  if (!existsSync(join(serverRoot, required))) {
    // CI and Cloudflare builds only have this repo checked out, so a missing
    // sibling Obrenna-Server is expected there: warn and skip instead of failing.
    // Set REQUIRE_SERVER_BUNDLE=1 to make it fatal (e.g. for release builds).
    const fatal = process.env.REQUIRE_SERVER_BUNDLE === '1';
    const log = fatal ? console.error : console.warn;
    log(`${fatal ? 'Cannot bundle' : 'Skipping bundle of'} Obrenna-Server: ${required} is missing in ${serverRoot}.`);
    if (required.includes('panel_dist')) log('Build the control panel first: cd Obrenna-Server/control-panel && npm install && npm run build');
    process.exit(fatal ? 1 : 0);
  }
}

mkdirSync(outDir, { recursive: true });
execFileSync('tar', [
  '-czf', archive,
  '--exclude', '__pycache__', '--exclude', '*.pyc', '--exclude', '.DS_Store',
  '-C', serverRoot,
  'pyproject.toml', 'README.md', 'obrenna_server', 'scripts',
], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });

const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(`${archive}.sha256`, `${digest}  obrenna-server.tar.gz\n`);
console.log(`Bundled Obrenna-Server -> ${archive}\nsha256 ${digest}`);
