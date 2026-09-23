// Reads, validates and saves config.json. Everything the user sets up lives here.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

const REFRESH_CHOICES = {
  github: [30, 60, 300, 900],
  calendar: [60, 120, 300, 900],
  weather: [300, 900, 1800],
  news: [300, 600, 1800, 3600],
};
const ACCENTS = ['#fa6e1d', '#3273eb', '#4db649', '#a855f7'];
// 'auto' accent: orange for the installed app, green for the test copy start.bat runs (same as their icons).
const ENV_ACCENTS = { live: '#fa6e1d', test: '#4db649' };
const accentFor = (accent, env) => (accent === 'auto' ? ENV_ACCENTS[env] || ENV_ACCENTS.live : accent);

function defaults() {
  return {
    setupComplete: false,
    disabled: false,
    location: null, // { label, city, region, country, lat, lon, source }
    units: 'fahrenheit',
    weatherAlerts: true,
    calendars: [], // [{ url, name }]
    github: { token: '', username: '', name: '', avatar: '', scopes: [], expires: '', repos: [], accounts: [] },
    news: { ap: true, localFeeds: [] }, // localFeeds: [{ url, name }]
    server: { runMode: 'signin', host: '127.0.0.1', port: 3000, restartOnCrash: true, openBrowser: false, logs: true },
    refresh: { github: 60, calendar: 120, weather: 900, news: 600 },
    dashboard: {
      sections: { calendar: true, headlines: true, contributions: true, inbox: true, prs: true, watching: false, activity: true },
      clock24: false,
      seconds: false,
      accent: 'auto',
    },
  };
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Arrays replace; objects merge; only keys that exist in `base` are accepted.
function merge(base, patch) {
  if (!isObj(patch)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in base)) continue;
    if (isObj(base[k]) && isObj(v)) out[k] = merge(base[k], v);
    else out[k] = v;
  }
  return out;
}

// Older config.json files (before setup existed) used a flat shape.
function migrate(raw) {
  if (!isObj(raw)) return {};
  const out = { ...raw };
  if (raw.icalUrl && !raw.calendars) out.calendars = [raw.icalUrl];
  if (Array.isArray(raw.localFeeds) && !raw.news) out.news = { ap: true, localFeeds: raw.localFeeds };
  delete out.icalUrl;
  delete out.localFeeds;
  return out;
}

function clean(cfg) {
  const d = defaults();
  const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
  const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);

  cfg.setupComplete = bool(cfg.setupComplete, false);
  cfg.disabled = bool(cfg.disabled, false);
  cfg.units = pick(cfg.units, ['fahrenheit', 'celsius'], d.units);
  cfg.weatherAlerts = bool(cfg.weatherAlerts, true);

  const loc = cfg.location;
  cfg.location = isObj(loc) && Number.isFinite(+loc.lat) && Number.isFinite(+loc.lon)
    ? { label: str(loc.label, 200), city: str(loc.city, 200), region: str(loc.region, 200), country: str(loc.country, 4).toUpperCase(),
        lat: +loc.lat, lon: +loc.lon, source: pick(loc.source, ['browser', 'search'], 'search') }
    : null;

  cfg.calendars = (Array.isArray(cfg.calendars) ? cfg.calendars : [])
    .map(c => (typeof c === 'string' ? { url: c, name: '' } : { url: str(c && c.url), name: str(c && c.name, 80) }))
    .filter(c => c.url).slice(0, 10);

  const gh = cfg.github;
  gh.token = str(gh.token, 400);
  gh.username = str(gh.username, 100);
  gh.name = str(gh.name, 200);
  gh.avatar = str(gh.avatar, 500);
  gh.expires = str(gh.expires, 100);
  gh.scopes = (Array.isArray(gh.scopes) ? gh.scopes : []).map(s => str(s, 60)).filter(Boolean);
  gh.repos = (Array.isArray(gh.repos) ? gh.repos : [])
    .map(r => str(r, 200)).filter(r => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)).slice(0, 12);
  gh.accounts = (Array.isArray(gh.accounts) ? gh.accounts : [])
    .map(a => str(a, 100)).filter(a => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(a)).slice(0, 12);

  cfg.news.ap = bool(cfg.news.ap, true);
  cfg.news.localFeeds = (Array.isArray(cfg.news.localFeeds) ? cfg.news.localFeeds : [])
    .map(f => (typeof f === 'string' ? { url: f, name: '' } : { url: str(f && f.url), name: str(f && f.name, 120) }))
    .filter(f => /^https?:\/\//i.test(f.url)).slice(0, 12);

  const s = cfg.server;
  s.runMode = pick(s.runMode, ['signin', 'service', 'manual'], d.server.runMode);
  s.host = pick(s.host, ['127.0.0.1', '0.0.0.0'], d.server.host);
  s.port = Number.isInteger(+s.port) && +s.port >= 1024 && +s.port <= 65535 ? +s.port : d.server.port;
  s.restartOnCrash = bool(s.restartOnCrash, true);
  s.openBrowser = bool(s.openBrowser, false);
  s.logs = bool(s.logs, true);

  for (const k of Object.keys(REFRESH_CHOICES)) {
    cfg.refresh[k] = pick(+cfg.refresh[k], REFRESH_CHOICES[k], d.refresh[k]);
  }

  const db = cfg.dashboard;
  for (const k of Object.keys(d.dashboard.sections)) db.sections[k] = bool(db.sections[k], d.dashboard.sections[k]);
  db.clock24 = bool(db.clock24, false);
  db.seconds = bool(db.seconds, false);
  db.accent = pick(String(db.accent).toLowerCase(), ['auto', ...ACCENTS], 'auto');
  return cfg;
}

function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return clean(merge(defaults(), migrate(raw)));
}

function save(cfg) {
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(clean(cfg), null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}

// Apply a partial update from the setup/settings pages. An empty or masked token keeps the saved one.
function update(patch) {
  const cfg = load();
  const p = isObj(patch) ? { ...patch } : {};
  if (isObj(p.github)) {
    p.github = { ...p.github };
    if (!p.github.token || String(p.github.token).includes('•')) delete p.github.token;
  }
  delete p.disabled;
  const next = clean(merge(cfg, p));
  save(next);
  return next;
}

function reset() {
  const d = defaults();
  save(d);
  return d;
}

// What the browser gets: never the token itself.
function publicView(cfg) {
  const { token, ...gh } = cfg.github;
  return {
    ...cfg,
    github: { ...gh, tokenSet: !!token, tokenHint: token ? token.slice(0, 4) + '••••' + token.slice(-4) : '' },
    choices: { refresh: REFRESH_CHOICES, accents: ACCENTS },
    configPath: CONFIG_PATH,
  };
}

module.exports = { ROOT, CONFIG_PATH, load, save, update, reset, defaults, publicView, accentFor, ENV_ACCENTS, REFRESH_CHOICES };
