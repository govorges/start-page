// Keeps server.js running and shows the Start Page icon in the taskbar tray. Exit codes from the server:
//   0  stopped on purpose -> stop too
//   3  can't start (for example the port is taken) -> stop too
//   75 restart requested (settings changed) -> start it again right away
//   anything else is a crash -> start again after 5 s, up to 5 times in a row, if "restart if it stops" is on
// Options (besides the server's own): --no-tray, --test (the test environment start.bat runs: green
// icons, "Start Page (Test)" in Task Manager, and the page shows Test in Settings)
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./lib/config');
const tray = require('./lib/tray');
const { openBrowser } = require('./lib/system');
const { ensureAppExe } = require('./lib/appexe');

const SERVER = path.join(__dirname, 'server.js');
const firstArgs = process.argv.slice(2).filter(a => a !== '--no-tray' && a !== '--test');
const ENV = process.argv.includes('--test') ? 'test' : 'live';
// No tray for the "Always on" task: it runs as SYSTEM, which has no desktop to show one on.
const user = os.userInfo().username;
const wantTray = !process.argv.includes('--no-tray') && !/\$$/.test(user) && user.toLowerCase() !== 'system';
let crashes = 0;
let startedAt = 0;
let program = process.execPath; // StartPage.exe on Windows (see lib/appexe.js), so Task Manager shows "Start Page"
let server = null;
let trayShown = false;
let exiting = false;

function url(page = '') {
  const i = process.argv.indexOf('--port');
  const port = (i >= 0 && Number(process.argv[i + 1])) || config.load().server.port;
  return `http://localhost:${port}${page}`;
}

function onTray(command) {
  if (command === 'open') openBrowser(url());
  else if (command === 'settings') openBrowser(url('/settings'));
  else if (command === 'exit') {
    exiting = true;
    if (server) server.kill();
    else process.exit(0); // between restarts
  }
}

function run(args, restarted) {
  startedAt = Date.now();
  const child = server = spawn(program, [SERVER, ...args], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, START_PAGE_SUPERVISED: '1', START_PAGE_ENV: ENV, ...(restarted ? { START_PAGE_RESTARTED: '1' } : {}) },
  });
  // The server says 'ready' once it's listening; only then does the tray icon appear (so a second copy
  // that finds the port taken never flashes one).
  child.on('message', m => {
    if (m === 'ready' && wantTray && !trayShown) { trayShown = true; tray.start(onTray, ENV); }
  });
  const forward = sig => child.kill(sig);
  process.once('SIGINT', forward);
  process.once('SIGTERM', forward);

  child.on('exit', code => {
    server = null;
    process.removeListener('SIGINT', forward);
    process.removeListener('SIGTERM', forward);
    if (exiting) process.exit(0);
    if (code === 75) return run([], true);
    if (code === 0 || code === 3 || code === null) process.exit(code || 0);

    if (Date.now() - startedAt > 60000) crashes = 0; // it ran for a while, so this isn't a crash loop
    crashes++;
    const { restartOnCrash } = config.load().server;
    if (!restartOnCrash || crashes > 5) {
      console.error(restartOnCrash ? 'The server stopped 5 times in a row. Giving up; check the log in the logs folder.' : 'The server stopped.');
      process.exit(code);
    }
    console.error(`The server stopped unexpectedly (code ${code}). Starting it again in 5 seconds…`);
    setTimeout(() => run([], true), 5000);
  });
}

ensureAppExe(process.execPath, ENV).then(p => { program = p; run(firstArgs, false); });
