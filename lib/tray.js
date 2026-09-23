// The Start Page icon in the Windows taskbar tray (tray/StartPageTray.cs).
// It's compiled into runtime\StartPageTray.exe with the C# compiler that ships with Windows (.NET
// Framework 4), so nothing extra is downloaded, and rebuilt when its source or the icon changes.
// Like StartPage.exe there's a live build (orange) and a test build for start.bat (green).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, execFile } = require('child_process');
const { ROOT } = require('./config');
const { iconPath } = require('./appexe');

const RUNTIME = path.join(ROOT, 'runtime');
const SRC = path.join(ROOT, 'tray', 'StartPageTray.cs');
const exeFor = env => path.join(RUNTIME, env === 'test' ? 'StartPageTray-Test.exe' : 'StartPageTray.exe');

const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

function compiler() {
  const win = process.env.SystemRoot || 'C:\\Windows';
  return ['Framework64', 'Framework']
    .map(dir => path.join(win, 'Microsoft.NET', dir, 'v4.0.30319', 'csc.exe'))
    .find(p => fs.existsSync(p));
}

// Resolves the tray program's path, or null when it can't be built (then there's simply no tray icon).
async function ensureTray(env = 'live') {
  if (process.platform !== 'win32') return null;
  const EXE = exeFor(env), STAMP = EXE.replace(/\.exe$/, '.json'), ICON = iconPath(env);
  try {
    const want = { src: hash(SRC), icon: hash(ICON) };
    let have = null;
    try { have = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch {}
    if (have && fs.existsSync(EXE) && have.src === want.src && have.icon === want.icon) return EXE;

    const csc = compiler();
    if (!csc) throw new Error('the .NET Framework C# compiler (csc.exe) wasn’t found');
    fs.mkdirSync(RUNTIME, { recursive: true });
    const tmp = EXE.replace(/\.exe$/, '.new.exe');
    await new Promise((resolve, reject) => execFile(csc,
      ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${ICON}`, `/out:${tmp}`, ...(env === 'test' ? ['/define:TEST'] : []),
        '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', SRC],
      { windowsHide: true, timeout: 60000 },
      (err, stdout) => (err ? reject(new Error(stdout.trim() || err.message)) : resolve())));
    try {
      fs.renameSync(tmp, EXE);
    } catch {
      // A running copy can't be replaced; move it aside (Windows allows that) and try again.
      fs.renameSync(EXE, EXE + '.old-' + Date.now());
      fs.renameSync(tmp, EXE);
    }
    fs.writeFileSync(STAMP, JSON.stringify(want, null, 2));
    for (const f of fs.readdirSync(RUNTIME)) if (f.startsWith(path.basename(EXE) + '.old-')) fs.rmSync(path.join(RUNTIME, f), { force: true });
    return EXE;
  } catch (e) {
    console.warn('Couldn’t prepare the tray icon:', e.message);
    return fs.existsSync(EXE) ? EXE : null;
  }
}

// Shows the tray icon. onCommand receives 'open', 'settings' or 'exit'. The icon goes away by itself
// when this process exits (the tray program watches its stdin).
async function start(onCommand, env = 'live') {
  const exe = await ensureTray(env);
  if (!exe) return null;
  const child = spawn(exe, [iconPath(env)], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  child.on('error', e => console.warn('Couldn’t show the tray icon:', e.message));
  child.stdin.on('error', () => {});
  readline.createInterface({ input: child.stdout }).on('line', line => onCommand(line.trim()));
  return child;
}

module.exports = { ensureTray, start };
