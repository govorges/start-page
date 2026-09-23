// Builds runtime\StartPage.exe: a copy of Node carrying the name "Start Page" and the ~/ icon, so
// Task Manager lists the server as "Start Page" instead of "Node.js JavaScript Runtime".
// There are two: StartPage.exe (orange icon) for the installed app, and StartPage-Test.exe (green
// icon, "Start Page (Test)") for the copy start.bat runs, so the two are easy to tell apart.
// They're rebuilt automatically when Node or the icon changes. On other systems Node is used as is.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT } = require('./config');

const RUNTIME = path.join(ROOT, 'runtime');
const VARIANTS = {
  live: { exe: 'StartPage.exe', icon: 'start-page.ico', name: 'Start Page' },
  test: { exe: 'StartPage-Test.exe', icon: 'start-page-test.ico', name: 'Start Page (Test)' },
};
const EXE = path.join(RUNTIME, VARIANTS.live.exe);

const isAppExe = p => /^startpage(-test)?\.exe$/i.test(path.basename(p));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
const stampOf = exe => exe.replace(/\.exe$/i, '.json');
const iconPath = env => path.join(ROOT, 'assets', (VARIANTS[env] || VARIANTS.live).icon);

// Returns the program to run the server with: the StartPage exe for `env` ('live' or 'test') when it
// can be made, otherwise Node itself.
async function ensureAppExe(nodePath = process.execPath, env = 'live') {
  if (process.platform !== 'win32') return nodePath;
  const v = VARIANTS[env] || VARIANTS.live;
  const exePath = path.join(RUNTIME, v.exe);
  const icon = iconPath(env);
  // Already running as the right one: use it.
  if (path.basename(nodePath).toLowerCase() === v.exe.toLowerCase()) return nodePath;
  // Running as the other StartPage exe: build from the Node it was made from.
  if (isAppExe(nodePath)) {
    try { nodePath = JSON.parse(fs.readFileSync(stampOf(nodePath), 'utf8')).nodePath; } catch {}
    if (!nodePath || !fs.existsSync(nodePath) || isAppExe(nodePath)) return fs.existsSync(exePath) ? exePath : process.execPath;
  }
  try {
    const want = { node: process.version, nodePath, nodeSize: fs.statSync(nodePath).size, icon: hash(icon) };
    let have = null;
    try { have = JSON.parse(fs.readFileSync(stampOf(exePath), 'utf8')); } catch {}
    if (have && fs.existsSync(exePath) && ['nodePath', 'nodeSize', 'icon'].every(k => have[k] === want[k])) return exePath;

    const { NtExecutable, NtExecutableResource, Data, Resource } = await import('resedit');
    const exe = NtExecutable.from(fs.readFileSync(nodePath), { ignoreCert: true });
    const res = NtExecutableResource.from(exe);

    // Replace Node's icon with the ~/ mark (keeping its icon group id and language).
    const icons = Data.IconFile.from(fs.readFileSync(icon)).icons.map(i => i.data);
    const groups = Resource.IconGroupEntry.fromEntries(res.entries);
    const group = groups[0] || { id: 1, lang: 1033 };
    Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, icons);

    // Task Manager shows FileDescription; the rest keeps Explorer's Properties dialog consistent.
    const [info] = Resource.VersionInfo.fromEntries(res.entries);
    const langs = info.getAllLanguagesForStringValues();
    for (const lang of langs.length ? langs : [{ lang: 1033, codepage: 1200 }]) {
      info.setStringValues(lang, {
        FileDescription: v.name, ProductName: 'Start Page', InternalName: v.exe.replace(/\.exe$/, ''),
        OriginalFilename: v.exe, CompanyName: 'Start Page', LegalCopyright: '',
      });
    }
    info.outputToResourceEntries(res.entries);
    res.outputResource(exe);

    fs.mkdirSync(RUNTIME, { recursive: true });
    const tmp = exePath + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(exe.generate()));
    try {
      fs.renameSync(tmp, exePath);
    } catch {
      // A running copy can't be replaced; move it aside (Windows allows that) and try again.
      fs.renameSync(exePath, exePath + '.old-' + Date.now());
      fs.renameSync(tmp, exePath);
    }
    fs.writeFileSync(stampOf(exePath), JSON.stringify(want, null, 2));
    for (const f of fs.readdirSync(RUNTIME)) if (f.startsWith(v.exe + '.old-')) fs.rmSync(path.join(RUNTIME, f), { force: true });
    return exePath;
  } catch (e) {
    console.warn(`Couldn’t prepare ${v.exe}, so Node will be used directly:`, e.message);
    return fs.existsSync(exePath) ? exePath : nodePath;
  }
}

module.exports = { ensureAppExe, iconPath, EXE };
