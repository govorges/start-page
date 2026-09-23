// Windows integration: start at sign-in, run as a background task, log files, opening the browser.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { ROOT } = require('./config');
const { ensureAppExe } = require('./appexe');

const IS_WIN = process.platform === 'win32';
const LAUNCHER = path.join(ROOT, 'launcher.js');
const TASK_NAME = 'StartPage';
const LOG_DIR = path.join(ROOT, 'logs');
const startupLnk = () => path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Start Page.lnk');

// Run a PowerShell snippet. Values go in through environment variables so paths never need quoting.
function powershell(script, env = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 120000 },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())));
  });
}

// Start at sign-in: a shortcut in the user's Startup folder that runs the server with no window, as
// StartPage.exe so Task Manager lists it as "Start Page" with the ~/ icon.
// It goes through `conhost.exe --headless`, which runs a console program without creating any window.
// (Hidden-window flags aren't enough on Windows 11: when Windows Terminal is the default terminal it
// ignores them and opens a visible tab.)
async function installSignin() {
  const conhost = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'conhost.exe');
  const app = await ensureAppExe();
  await powershell(
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:SP_LNK);' +
    '$s.TargetPath = $env:SP_TARGET; $s.Arguments = $env:SP_ARGS; $s.WorkingDirectory = $env:SP_DIR;' +
    '$s.WindowStyle = 7; $s.Description = "Start page server"; $s.Save()',
    { SP_LNK: startupLnk(), SP_TARGET: conhost, SP_ARGS: `--headless "${app}" "${LAUNCHER}"`, SP_DIR: ROOT });
}

// Rewrite the Startup shortcut in the current format (older versions could show a terminal window).
async function refreshSignin() {
  if (!IS_WIN || !fs.existsSync(startupLnk())) return;
  await installSignin().catch(e => console.warn('Couldn’t update the start-up shortcut:', e.message));
}

function removeSignin() {
  try { fs.unlinkSync(startupLnk()); } catch {}
}

function taskExists() {
  return new Promise(resolve => execFile('schtasks.exe', ['/Query', '/TN', TASK_NAME], { windowsHide: true }, err => resolve(!err)));
}

// Elevated schtasks call: Windows shows its administrator prompt.
async function elevatedSchtasks(args) {
  const out = await powershell(
    '$p = Start-Process -FilePath schtasks.exe -ArgumentList $env:SP_ARGS -Verb RunAs -WindowStyle Hidden -Wait -PassThru; $p.ExitCode',
    { SP_ARGS: args }).catch(e => {
      if (/canceled|cancelled|1223/i.test(e.message)) throw new Error('Administrator approval was declined, so nothing changed.');
      throw e;
    });
  if (out !== '0') throw new Error(`Windows Task Scheduler reported an error (code ${out}).`);
}

// Always-on: a scheduled task that starts at boot under the SYSTEM account.
async function installService() {
  const app = await ensureAppExe();
  const tr = `\\"${app}\\" \\"${LAUNCHER}\\"`;
  await elevatedSchtasks(`/Create /TN ${TASK_NAME} /SC ONSTART /RU SYSTEM /RL LIMITED /F /TR "${tr}"`);
}

async function removeService() {
  if (await taskExists()) await elevatedSchtasks(`/Delete /TN ${TASK_NAME} /F`);
}

async function applyRunMode(mode) {
  if (!IS_WIN) return { ok: mode === 'manual', error: mode === 'manual' ? null : 'Starting automatically is only set up on Windows.' };
  try {
    if (mode === 'signin') { await removeService(); await installSignin(); }
    else if (mode === 'service') { await installService(); removeSignin(); }
    else { removeSignin(); await removeService(); }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function startupStatus() {
  if (!IS_WIN) return { signin: false, service: false };
  return { signin: fs.existsSync(startupLnk()), service: await taskExists() };
}

function openBrowser(url) {
  if (IS_WIN) spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

function showInFolder(file) {
  if (IS_WIN) spawn('explorer.exe', [`/select,${file}`], { detached: true, stdio: 'ignore' }).unref();
}

// Is this port free on this host? Resolves 'free', 'in-use' or 'denied'.
function checkPort(port, host) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', e => resolve(e.code === 'EACCES' ? 'denied' : 'in-use'));
    srv.once('listening', () => srv.close(() => resolve('free')));
    srv.listen(port, host);
  });
}

// ---------- logging: console output is also written to logs/server-YYYY-MM-DD.log, kept for 7 days ----------
let logStream = null;
function setupLogging(enabled) {
  if (!enabled) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const cutoff = Date.now() - 7 * 86400e3;
    for (const f of fs.readdirSync(LOG_DIR)) {
      const p = path.join(LOG_DIR, f);
      if (/^server-\d{4}-\d{2}-\d{2}\.log$/.test(f) && fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
    logStream = fs.createWriteStream(path.join(LOG_DIR, `server-${new Date().toISOString().slice(0, 10)}.log`), { flags: 'a' });
  } catch { return; }
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      const line = args.map(a => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      logStream.write(`${new Date().toISOString()} ${level.toUpperCase()} ${line}${os.EOL}`);
    };
  }
}

function deleteLogs() {
  if (logStream) { logStream.end(); logStream = null; }
  try { fs.rmSync(LOG_DIR, { recursive: true, force: true }); } catch {}
}

module.exports = { applyRunMode, refreshSignin, startupStatus, openBrowser, showInFolder, checkPort, setupLogging, deleteLogs, LOG_DIR, IS_WIN };
