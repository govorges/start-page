// Update checks against the GitHub repository. There are no releases: the "version" in package.json on
// the main branch is the latest version, and raising it is what makes an update show up for everyone.
// The list of changes works for Git clones (from the commit this folder is on) and for ZIP downloads (from
// the commit that set this folder's version), so it needs no Git program either way.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');

const REPO = 'govorges/start-page';
const BRANCH = 'main';
const REPO_URL = `https://github.com/${REPO}`;
const API = `https://api.github.com/repos/${REPO}`;
const rawUrl = (ref, file) => `https://raw.githubusercontent.com/${REPO}/${ref}/${file}`;
const STATE_FILE = path.join(ROOT, 'runtime', 'update-check.json');
const DAY = 24 * 3600e3;

const CURRENT = require('../package.json').version;

class UpdateError extends Error {}

// ---------- versions ----------
const parts = v => String(v || '').replace(/^v/, '').split(/[-+]/)[0].split('.').map(n => parseInt(n, 10) || 0);
function compare(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
}

// ---------- this folder ----------
// The commit a Git clone is on, read straight from .git so Git itself doesn't have to be installed.
function gitHead() {
  try {
    const dir = path.join(ROOT, '.git');
    if (!fs.statSync(dir).isDirectory()) return null;
    const head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = (head.match(/^ref: (.+)$/) || [])[1];
    if (!ref) return null;
    try { return fs.readFileSync(path.join(dir, ref), 'utf8').trim(); } catch {}
    const packed = fs.readFileSync(path.join(dir, 'packed-refs'), 'utf8');
    const line = packed.split('\n').find(l => l.endsWith(' ' + ref));
    return line ? line.slice(0, 40) : null;
  } catch {
    return null;
  }
}
const installType = () => (fs.existsSync(path.join(ROOT, '.git')) ? 'git' : 'zip');

// ---------- requests ----------
async function get(url, json = true) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'start-page', ...(json ? { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } : {}) },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new UpdateError('Couldn’t reach GitHub. Check your internet connection.');
  }
  if (res.status === 403 || res.status === 429) throw new UpdateError('GitHub is limiting requests right now. Try again in an hour.');
  if (res.status === 404) return null;
  if (!res.ok) throw new UpdateError(`GitHub answered with an error (${res.status}).`);
  return json ? res.json() : res.text();
}
async function versionAt(ref) {
  const text = await get(rawUrl(ref, 'package.json'), false);
  try { return text ? JSON.parse(text).version || null : null; } catch { return null; }
}

// ---------- the daily check ----------
let state = { checkedAt: 0, latest: null, error: null };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

// What the settings page and the dashboard badge show.
function status() {
  const latest = state.latest;
  return {
    current: CURRENT, latest, checkedAt: state.checkedAt || null, error: state.error,
    available: !!latest && compare(latest, CURRENT) > 0,
    ahead: !!latest && compare(latest, CURRENT) < 0,
    install: installType(), repo: REPO_URL, zip: `${REPO_URL}/archive/refs/heads/${BRANCH}.zip`,
  };
}

let checking = null;
function check() {
  if (!checking) {
    checking = (async () => {
      try {
        const latest = await versionAt(BRANCH);
        if (!latest) throw new UpdateError('Couldn’t read the latest version from GitHub.');
        state = { checkedAt: Date.now(), latest, error: null };
      } catch (e) {
        state = { ...state, checkedAt: Date.now(), error: e.message };
      }
      saveState();
      return status();
    })().finally(() => { checking = null; });
  }
  return checking;
}

// Checks once a day while the server runs (and soon after it starts, if the last check was over a day ago).
// Nothing is ever downloaded or installed; `enabled` is read each time so turning it off takes effect at once.
function schedule(enabled) {
  const due = () => enabled() && Date.now() - (state.checkedAt || 0) > DAY;
  setTimeout(() => { if (due()) check(); }, 30000).unref();
  setInterval(() => { if (due()) check(); }, 3600e3).unref();
}

// ---------- what's changed ----------
// Commits on GitHub that this folder doesn't have yet, grouped by the version they belong to (newest first).
let changesCache = null;
async function changes() {
  const head = gitHead();
  const key = `${head}|${state.latest}`;
  if (changesCache && changesCache.key === key && Date.now() - changesCache.t < 3600e3) return changesCache.v;

  // Every commit that touched package.json, with the version it set: these mark where each version starts.
  const pkgCommits = (await get(`${API}/commits?path=package.json&sha=${BRANCH}&per_page=100`)) || [];
  const versions = new Map();
  async function versionOf(sha) {
    if (!versions.has(sha)) versions.set(sha, await versionAt(sha));
    return versions.get(sha);
  }

  let base = null, exact = false, note = null;
  if (head) {
    const cmp = await get(`${API}/compare/${head}...${BRANCH}`);
    if (cmp) { base = head; exact = true; }
    else note = 'This copy is on a commit GitHub doesn’t have, so the list starts from its version instead.';
  }
  if (!base) {
    // ZIP downloads have no commit: start from the commit that set this version (the oldest one in the
    // newest run of package.json changes with this version).
    for (const c of pkgCommits) {
      const v = await versionOf(c.sha);
      if (v === CURRENT) base = c.sha;
      else if (base || compare(v, CURRENT) < 0) break;
    }
    if (!base) {
      const v = { current: CURRENT, groups: [], total: 0, exact: false, note: `Version ${CURRENT} isn’t on GitHub, so there’s nothing to compare it with.`, compareUrl: REPO_URL };
      changesCache = { key, t: Date.now(), v };
      return v;
    }
  }

  const cmp = await get(`${API}/compare/${base}...${BRANCH}`);
  if (!cmp) throw new UpdateError('Couldn’t compare versions on GitHub.');
  const commits = cmp.commits || []; // oldest first, at most 250

  // Walk forward, switching version at each commit that changed package.json's version.
  const pkgShas = new Set(pkgCommits.map(c => c.sha));
  let version = exact ? null : CURRENT;
  const groups = [];
  for (const c of commits) {
    if (pkgShas.has(c.sha)) {
      const v = await versionOf(c.sha);
      if (v && v !== version) version = v;
    }
    const label = version || CURRENT;
    let g = groups[groups.length - 1];
    if (!g || g.version !== label) groups.push(g = { version: label, commits: [] });
    if (c.parents && c.parents.length > 1) continue; // merge commits repeat what the merged commits say
    const [title] = String(c.commit.message || '').split('\n');
    g.commits.push({
      sha: c.sha.slice(0, 7), title, url: c.html_url,
      author: (c.author && c.author.login) || (c.commit.author && c.commit.author.name) || '',
      date: (c.commit.author && c.commit.author.date) || (c.commit.committer && c.commit.committer.date),
    });
  }
  for (const g of groups) g.commits.reverse();
  const out = groups.filter(g => g.commits.length).reverse().map(g => ({
    ...g,
    // For ZIP downloads, commits made before the next version may already be in this copy.
    maybeHave: !exact && g.version === CURRENT,
  }));
  const v = {
    current: CURRENT, groups: out, total: out.reduce((n, g) => n + g.commits.length, 0), exact, note,
    truncated: (cmp.total_commits || 0) > commits.length,
    compareUrl: `${REPO_URL}/compare/${base.slice(0, 12)}...${BRANCH}`,
  };
  changesCache = { key, t: Date.now(), v };
  return v;
}

module.exports = { status, check, schedule, changes, compare, UpdateError };
