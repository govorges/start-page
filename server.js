// Start page server. Normally started through launcher.js (by the Start Page shortcuts, or start.bat); `node server.js` also works.
// Options: --host 127.0.0.1|0.0.0.0  --port 3000  --enable (turn back on after "Disable")  --open (open the browser once ready)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const config = require('./lib/config');
const system = require('./lib/system');
const calendar = require('./lib/calendar');
const github = require('./lib/github');
const news = require('./lib/news');
const weather = require('./lib/weather');
const updates = require('./lib/updates');

const PUBLIC = path.join(__dirname, 'public');
const VERSION = require('./package.json').version;
const SUPERVISED = process.env.START_PAGE_SUPERVISED === '1';
const RESTARTED = process.env.START_PAGE_RESTARTED === '1';
const STARTED_AT = Date.now();

// ---------- command line ----------
const argv = process.argv.slice(2);
const flag = name => argv.includes('--' + name);
const opt = name => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };
// 'test' when started by start.bat (launcher.js --test), otherwise 'live' (the installed app).
const ENV = process.env.START_PAGE_ENV === 'test' || flag('test') ? 'test' : 'live';

let cfg = config.load();
system.setupLogging(cfg.server.logs);

if (flag('enable') && cfg.disabled) {
  cfg.disabled = false;
  config.save(cfg);
  if (cfg.setupComplete) system.applyRunMode(cfg.server.runMode).then(r => r.ok || console.warn('Couldn’t restore start-up:', r.error));
  console.log('Start page turned back on.');
}
if (cfg.disabled) {
  console.log('The start page is turned off. Open Start Page from the Start menu, or run `node server.js --enable`, to turn it back on.');
  process.exit(0);
}

const HOST = ['127.0.0.1', '0.0.0.0'].includes(opt('host')) ? opt('host') : cfg.server.host;
const PORT = Number(opt('port')) || cfg.server.port;
const localUrl = (port = PORT) => `http://localhost:${port}`;

// ---------- small cache, cleared whenever settings change ----------
const cache = new Map();
// ttl is seconds, or a function of the value (so incomplete results can expire sooner).
// Requests that arrive while a fetch is already under way share it instead of starting another.
const inflight = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < hit.ttl * 1000) return hit.v;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const v = await fn();
      cache.set(key, { t: Date.now(), v, ttl: typeof ttl === 'function' ? ttl(v) : ttl });
      return v;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// ---------- request helpers ----------
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLocal = req => LOOPBACK.has(req.socket.remoteAddress);

// Only answer to names that point at this computer (blocks DNS-rebinding tricks from other websites).
function hostAllowed(req) {
  const h = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (['localhost', '127.0.0.1', '[::1]'].includes(h)) return true;
  if (HOST !== '0.0.0.0') return false;
  const name = os.hostname().toLowerCase();
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h === name || h === name + '.local' || h.startsWith(name + '.');
}

// Changes must come from this computer, from our own pages, as JSON.
function writeAllowed(req) {
  if (!isLocal(req)) return 'Settings can only be changed from the computer running the start page.';
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return 'Blocked a request from another website.';
  if (!/^application\/json/.test(req.headers['content-type'] || '')) return 'Expected JSON.';
  return null;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
const fail = (res, code, message) => send(res, code, { error: message });

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 100000) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}

const faviconSvg = color => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${color}"/><text x="16" y="22" font-family="monospace" font-size="15" font-weight="700" text-anchor="middle" fill="#0d0f14">~/</text></svg>`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function sendFile(res, name) {
  const file = path.join(PUBLIC, name);
  if (!file.startsWith(PUBLIC + path.sep)) return fail(res, 404, 'Not found');
  fs.readFile(file, (err, data) => {
    if (err) return fail(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

// ---------- server control ----------
let server;
function shutdown(code) {
  setTimeout(() => {
    server.close();
    if (server.closeAllConnections) server.closeAllConnections();
    if (code === 75 && !SUPERVISED) {
      // Not started by launcher.js: start a fresh supervised copy in the background, then leave.
      spawn(process.execPath, [path.join(__dirname, 'launcher.js'), ...(ENV === 'test' ? ['--test'] : [])], { cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: true }).unref();
      setTimeout(() => process.exit(0), 300);
    } else {
      setTimeout(() => process.exit(code), 300);
    }
  }, 200); // let the response reach the browser first
}
// Settings as the settings and setup pages see them, plus which environment this is and its default accent.
const view = () => ({ ...config.publicView(cfg), env: ENV, envAccent: config.accentFor('auto', ENV) });
const needsRestart = next => next.server.host !== HOST || next.server.port !== PORT;

// ---------- routes ----------
const routes = {
  'GET /api/ping': () => ({ app: 'start-page', version: VERSION }),

  'GET /api/config': () => view(),

  // Display preferences only; safe for other devices when the server listens on the network.
  'GET /api/prefs': req => ({
    dashboard: { ...cfg.dashboard, accent: config.accentFor(cfg.dashboard.accent, ENV) }, refresh: cfg.refresh, units: cfg.units, local: isLocal(req), env: ENV,
    connected: { location: !!cfg.location, calendar: cfg.calendars.length > 0, github: !!cfg.github.token, news: cfg.news.ap || cfg.news.localFeeds.length > 0 },
  }),

  'POST /api/config': async (req, body) => {
    cfg = config.update(body);
    cache.clear();
    return { config: view(), restartNeeded: needsRestart(cfg), url: localUrl(cfg.server.port) };
  },

  'GET /api/status': async () => ({
    running: true, env: ENV, host: HOST, port: PORT, url: localUrl(), startedAt: STARTED_AT, uptime: Date.now() - STARTED_AT,
    supervised: SUPERVISED, runMode: cfg.server.runMode, startup: await system.startupStatus(),
    configPath: config.CONFIG_PATH, logDir: system.LOG_DIR, node: process.version, platform: process.platform,
    restartNeeded: needsRestart(cfg), savedUrl: localUrl(cfg.server.port),
  }),

  'GET /api/port-check': async (req, q) => {
    const port = Number(q.get('port'));
    const host = q.get('host') === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return { status: 'invalid' };
    if (port === PORT) return { status: 'current' };
    const result = await system.checkPort(port, host);
    if (result === 'in-use') {
      const ping = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(2000) }).then(r => r.json()).catch(() => null);
      if (ping && ping.app === 'start-page') return { status: 'start-page' };
    }
    return { status: result };
  },

  'POST /api/server/run-mode': async () => system.applyRunMode(cfg.server.runMode),
  'POST /api/server/restart': (req, body, res) => { send(res, 200, { ok: true, url: localUrl(cfg.server.port) }); shutdown(75); },
  'POST /api/server/stop': (req, body, res) => { send(res, 200, { ok: true }); shutdown(0); },
  'POST /api/server/disable': async (req, body, res) => {
    if (body.mode === 'off') {
      const r = await system.applyRunMode('manual');
      if (!r.ok) return fail(res, 500, r.error);
      cfg.disabled = true;
      config.save(cfg);
    }
    send(res, 200, { ok: true });
    shutdown(0);
  },
  'POST /api/server/reset': async (req, body, res) => {
    const r = await system.applyRunMode('manual');
    if (body.deleteLogs) system.deleteLogs();
    cfg = config.reset();
    cache.clear();
    const restart = needsRestart(cfg);
    send(res, 200, { ok: true, startupRemoved: r.ok, warning: r.ok ? null : r.error, restart, url: localUrl(cfg.server.port) + '/setup' });
    if (restart) shutdown(75);
  },
  'POST /api/show-config': () => { system.showInFolder(config.CONFIG_PATH); return { ok: true }; },
  'POST /api/finish-setup': async () => {
    cfg = config.load();
    cfg.setupComplete = true;
    config.save(cfg);
    cache.clear();
    return { ok: true, restartNeeded: needsRestart(cfg), url: localUrl(cfg.server.port) };
  },

  // ---- checks used by setup ----
  'POST /api/test/calendar': async (req, body) => calendar.test(body.url),
  'POST /api/test/feed': async (req, body) => news.test(body.url),
  'POST /api/test/github': async (req, body) => {
    const token = body.token || cfg.github.token;
    const info = await github.verify(token);
    const [repos, following] = await Promise.all([
      github.watched(token).catch(() => []),
      github.following(token, info.username).catch(() => []),
    ]);
    return { ...info, repos, following };
  },
  'GET /api/news/suggestions': () => news.suggestions(cfg.location),

  // ---- dashboard data (also readable from other devices when the server listens on the network) ----
  'GET /api/weather': () => cached('weather', cfg.refresh.weather, () => weather.get(cfg)),
  'GET /api/calendar': async (req, q) => {
    if (!cfg.calendars.length) return { events: [], errors: [], configured: false };
    // ?refresh=1 (the dashboard's refresh button) always fetches from Google again instead of using the cache.
    if (q.get('refresh')) cache.delete('calendar');
    const r = await cached('calendar', cfg.refresh.calendar, () => calendar.events(cfg.calendars));
    return { ...r, fetchedAt: cache.get('calendar').t };
  },
  'GET /api/github': () => cached('github', cfg.refresh.github, () => github.dashboard(cfg)),
  // Daily history changes slowly: 15 minutes, or 30 s while GitHub is still counting commits.
  'GET /api/github/activity': () => cached('activity', v => (v.pending ? 30 : 900), () => github.activity(cfg)),
  'GET /api/github/people': () => cached('people', 900, () => github.people(cfg)),
  'POST /api/github/read': async (req, body) => {
    if (!cfg.github.token) throw new Error('GitHub isn’t connected.');
    await github.markRead(cfg.github.token, body.id ? String(body.id) : null);
    cache.delete('github');
    return { ok: true };
  },
  // ---- updates (the dashboard shows a badge; Settings shows the details) ----
  'GET /api/updates': () => ({ ...updates.status(), auto: cfg.updates.auto }),
  'POST /api/updates/check': async () => ({ ...(await updates.check()), auto: cfg.updates.auto }),
  'GET /api/updates/changes': () => updates.changes(),

  'GET /api/news': async () => {
    const [ap, local] = await Promise.allSettled([
      cfg.news.ap ? cached('ap', cfg.refresh.news, news.ap) : Promise.resolve([]),
      cfg.news.localFeeds.length ? cached('local', cfg.refresh.news, () => news.local(cfg.news.localFeeds)) : Promise.resolve({ items: [], errors: [] }),
    ]);
    return {
      ap: ap.status === 'fulfilled' ? ap.value : [], apEnabled: cfg.news.ap,
      local: local.status === 'fulfilled' ? local.value.items : [],
      localErrors: local.status === 'fulfilled' ? local.value.errors : [{ error: local.reason.message }],
    };
  },
};

// Pages and APIs that expose or change settings are only for this computer.
const LOCAL_ONLY = /^(GET|POST) \/api\/(config|status|port-check|server|show-config|finish-setup|test|news\/suggestions|updates)/;

async function handle(req, res) {
  if (!hostAllowed(req)) return fail(res, 421, 'Unknown host name.');
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  // Pages
  if (req.method === 'GET' && !p.startsWith('/api/')) {
    if (p === '/') {
      if (!cfg.setupComplete) { res.writeHead(302, { Location: '/setup' }); return res.end(); }
      return sendFile(res, 'index.html');
    }
    if (p === '/setup' || p === '/settings') {
      if (!isLocal(req)) return send(res, 403, 'Setup and settings only open on the computer running the start page.', 'text/plain; charset=utf-8');
      return sendFile(res, p.slice(1) + '.html');
    }
    if (/^\/assets\/[\w.-]+$/.test(p)) return sendFile(res, p.slice('/assets/'.length));
    if (p === '/favicon.svg') {
      // The ~/ mark in the chosen accent (pages switch it live when the accent changes in Settings).
      return send(res, 200, faviconSvg(config.accentFor(cfg.dashboard.accent, ENV)), 'image/svg+xml');
    }
    if (p === '/favicon.ico') {
      // The same ~/ icon Task Manager shows: orange for the installed app, green for the test copy.
      return fs.readFile(path.join(__dirname, 'assets', ENV === 'test' ? 'start-page-test.ico' : 'start-page.ico'), (err, data) => {
        if (err) { res.writeHead(204); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'max-age=86400' });
        res.end(data);
      });
    }
    return fail(res, 404, 'Not found');
  }

  const key = `${req.method} ${p}`;
  const route = routes[key];
  if (!route) return fail(res, 404, 'Not found');
  if (LOCAL_ONLY.test(key) && !isLocal(req)) return fail(res, 403, 'Only available on the computer running the start page.');
  let body = {};
  if (req.method === 'POST') {
    const blocked = writeAllowed(req);
    if (blocked) return fail(res, 403, blocked);
    try { body = await readJson(req); } catch (e) { return fail(res, 400, e.message); }
  }
  try {
    const out = await route(req, req.method === 'GET' ? url.searchParams : body, res);
    if (out !== undefined && !res.headersSent) send(res, 200, out);
  } catch (e) {
    const expected = e instanceof calendar.CalendarError || e instanceof news.FeedError || e instanceof github.GitHubError || e instanceof updates.UpdateError;
    if (!expected) console.error(key, e);
    if (!res.headersSent) fail(res, expected ? 422 : 502, e.message);
  }
}

server = http.createServer((req, res) => { handle(req, res).catch(e => { console.error(e); if (!res.headersSent) fail(res, 500, 'Server error'); }); });

server.on('error', async e => {
  if (e.code === 'EADDRINUSE') {
    // Already running? Then just open it.
    const ping = await fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null);
    if (ping && ping.app === 'start-page') {
      console.log(`The start page is already running at ${localUrl()}.`);
      if (flag('open')) system.openBrowser(localUrl());
      process.exit(3);
    }
    console.error(`Port ${PORT} is being used by another program. Change "port" under "server" in ${config.CONFIG_PATH}, then start again.`);
    process.exit(3);
  }
  if (e.code === 'EACCES') {
    console.error(`Windows didn’t allow the start page to use port ${PORT}. Choose another port in ${config.CONFIG_PATH}.`);
    process.exit(3);
  }
  console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Start page running at ${localUrl()}${HOST === '0.0.0.0' ? ' (also reachable from your network)' : ''}`);
  if (!cfg.setupComplete) console.log(`First run: finish setup at ${localUrl()}/setup`);
  if (flag('open') || (cfg.server.openBrowser && !RESTARTED)) system.openBrowser(localUrl());
  // Keep an existing start-at-sign-in shortcut in the current, windowless format.
  if (!RESTARTED && cfg.setupComplete && cfg.server.runMode === 'signin') system.refreshSignin();
  updates.schedule(() => cfg.updates.auto);
  if (process.send) process.send('ready'); // launcher.js shows the tray icon now
});
// Started by launcher.js and it went away (for example ended from Task Manager): stop too.
process.on('disconnect', () => process.exit(0));
