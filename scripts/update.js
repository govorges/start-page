// Gets the latest Start Page from GitHub. Run through update.bat, which then runs install.bat (or
// start.bat for the test copy) to rebuild and start it again.
//   Git clones:     git pull --ff-only (only on the main branch with no uncommitted changes).
//   ZIP downloads:  downloads the main branch as a ZIP and copies it over this folder. Your settings
//                   (config.json), logs, runtime and node_modules are left alone. Files that would be
//                   replaced are backed up first and put back if anything goes wrong.
// Dependencies are installed again when package.json or package-lock.json changed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const config = require('../lib/config');
const { gitProblem, BRANCH, REPO_ZIP } = require('../lib/updates');

const ROOT = config.ROOT;
const KEEP = new Set(['config.json', 'config.json.tmp', 'runtime', 'logs', 'node_modules', '.git']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = msg => console.log('  ' + msg);

class Stop extends Error {}

const fileHash = f => { try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex'); } catch { return ''; } };
const depsStamp = () => fileHash('package.json') + fileHash('package-lock.json');
const readVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } };

// Settings closes Start Page just before starting this; wait for it to finish closing.
async function waitForStop() {
  const port = config.load().server.port;
  const up = () => fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  for (let i = 0; i < 20 && await up(); i++) await sleep(500);
}

function gitPull() {
  const problem = gitProblem();
  if (problem) throw new Stop(problem);
  say(`Getting the latest version with git pull...`);
  const r = spawnSync('git', ['-C', ROOT, 'pull', '--ff-only', 'origin', BRANCH], { stdio: 'inherit' });
  if (r.status !== 0) throw new Stop('git pull didn’t finish (see the message above). Nothing was changed.');
}

async function zipUpdate() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'start-page-update-'));
  const backup = path.join(ROOT, 'runtime', 'update-backup');
  try {
    say('Downloading the latest version from GitHub...');
    let res;
    try { res = await fetch(REPO_ZIP, { headers: { 'User-Agent': 'start-page' }, signal: AbortSignal.timeout(120000) }); }
    catch { throw new Stop('Couldn’t reach GitHub. Check your internet connection and try again.'); }
    if (!res.ok) throw new Stop(`GitHub answered with an error (${res.status}). Try again later.`);
    const zip = path.join(tmp, 'start-page.zip');
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

    say('Unpacking it...');
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    try { execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', tmp], { stdio: 'ignore' }); }
    catch { throw new Stop('Couldn’t unpack the download.'); }
    const top = fs.readdirSync(tmp).map(n => path.join(tmp, n)).find(p => fs.statSync(p).isDirectory());
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(path.join(top, 'package.json'), 'utf8')); } catch {}
    if (!pkg || pkg.name !== 'start-page') throw new Stop('The download doesn’t look like Start Page, so nothing was changed.');

    // Back up every file the new version replaces, then copy it in.
    const entries = fs.readdirSync(top).filter(n => !KEEP.has(n));
    fs.rmSync(backup, { recursive: true, force: true });
    const replaced = [];
    for (const n of entries) {
      if (fs.existsSync(path.join(ROOT, n))) { fs.cpSync(path.join(ROOT, n), path.join(backup, n), { recursive: true }); replaced.push(n); }
    }
    say(`Copying version ${pkg.version} into this folder...`);
    try {
      for (const n of entries) fs.cpSync(path.join(top, n), path.join(ROOT, n), { recursive: true, force: true });
    } catch (e) {
      for (const n of replaced) { try { fs.cpSync(path.join(backup, n), path.join(ROOT, n), { recursive: true, force: true }); } catch {} }
      throw new Stop(`Couldn’t copy the new files (${e.message}). The previous version was put back.`);
    }
    fs.rmSync(backup, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function installDependencies() {
  const npm = process.env.NPM_CMD;
  if (!npm) throw new Stop('npm wasn’t found next to Node.js, so the new dependencies couldn’t be installed. Run install.bat.');
  say('Installing updated dependencies...');
  // cmd /s /c removes the outer pair of quotes, so the quoted npm path (often under "Program Files") survives.
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `""${npm}" install --omit=dev --no-audit --no-fund --loglevel=error"`],
    { cwd: ROOT, stdio: 'inherit', windowsVerbatimArguments: true });
  if (r.status !== 0) throw new Stop('Installing dependencies failed. Check your internet connection and run update.bat again.');
}

async function main() {
  const before = readVersion();
  await waitForStop();
  const deps = depsStamp();
  if (fs.existsSync(path.join(ROOT, '.git'))) gitPull(); else await zipUpdate();
  if (depsStamp() !== deps || !fs.existsSync(path.join(ROOT, 'node_modules'))) installDependencies();
  const after = readVersion();
  say(after === before ? `Start Page is up to date (version ${after}).` : `Updated Start Page from version ${before} to ${after}.`);
}

main().catch(e => {
  console.error('\n  ' + (e instanceof Stop ? e.message : 'Something went wrong: ' + e.message));
  process.exit(1);
});
