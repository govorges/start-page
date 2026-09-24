// Settings: status, connections, dashboard preferences, disable and reset.
let cfg, status;
const RUN_LABEL = { signin: 'At sign-in', service: 'Always on', manual: 'When opened' };
const RUN_LONG = { signin: 'Starts at sign-in', service: 'Always on (background task)', manual: 'Starts when you open it' };
const REFRESH_TEXT = s => (s < 60 ? `${s}s` : s < 3600 ? `${s / 60}m` : `${s / 3600}h`);

const NAV = [['status', 'Status', 'term'], ['connections', 'Connections', 'cloud'], ['dashboard', 'Dashboard', 'layout'], ['danger', 'Disable or reset', 'power']];
for (const [id, name, ic] of NAV) $('#side').append(h('a', { href: '#' + id, 'data-id': id }, icon(ic, 16, 'currentColor', 1.75), name));
$('#side').append(h('div', { class: 'note' }, 'Saved to ', h('span', { class: 'chip' }, 'config.json'), ' as you change things.'));
const observer = new IntersectionObserver(entries => {
  const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
  if (vis) $$('#side a').forEach(a => a.setAttribute('aria-current', String(a.dataset.id === vis.target.id)));
}, { rootMargin: '-10% 0px -60% 0px' });
NAV.forEach(([id]) => observer.observe($('#' + id)));

$('#restart').append(icon('reset', 14, 'var(--ink)', 2), 'Restart server');
$('#stop').append(icon('power', 14, 'var(--ink)', 2), 'Stop server');
$('#ic-power').append(icon('power', 20, 'var(--err)', 1.75));
$('#ic-reset').append(icon('reset', 20, 'var(--err)', 1.75));

// ---------- status ----------
function fmtUptime(ms) {
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), hrs = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${hrs}h` : hrs ? `${hrs}h ${m % 60}m` : `${m}m`;
}
function renderStatus() {
  const tile = (k, v) => h('div', { class: 'tile' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
  const test = status.env === 'test';
  $('#tiles').replaceChildren(
    tile('Environment', h('span', { class: 'env', title: test ? 'Started by start.bat, in a console window' : 'The installed app (Start menu, sign-in or background task)' },
      h('span', { class: 'env-badge ' + status.env }, test ? 'Test' : 'Live'))),
    tile('Server', [h('span', { class: 'dot-ok' }), 'Running']),
    tile('Address', `${status.host}:${status.port}`),
    tile('Up for', fmtUptime(Date.now() - status.startedAt)),
    tile('Starts', RUN_LABEL[cfg.server.runMode]));
  $('#status-note').replaceChildren(
    ...(test ? ['This is the test copy that start.bat runs; closing its console window stops it. Run install.bat for the installed app. '] : []),
    'Server, network and refresh settings are under ', h('b', { class: 'ink', style: { fontWeight: 500 } }, 'Server'), ' in Connections.');
}

function renderBanner() {
  const out = [];
  if (status.restartNeeded) {
    const box = statusBox('warn', 'Restart to use the new address', rich(['Your settings now use ', ['chip', status.savedUrl], '. The server is still on ', ['chip', status.url], ' until it restarts.']));
    box.querySelector('div').append(h('button', { type: 'button', class: 'btn btn-sm', style: { marginTop: '10px' }, onclick: restart }, 'Restart now'));
    out.push(box);
  }
  const s = status.startup;
  const expected = cfg.server.runMode;
  const broken = (expected === 'signin' && !s.signin) || (expected === 'service' && !s.service);
  if (broken && cfg.setupComplete && status.platform === 'win32') {
    const box = statusBox('warn', 'Start-up isn’t set up', `Your settings say “${RUN_LONG[expected]}”, but Windows doesn’t have it set up, so the page won’t start on its own.`);
    box.querySelector('div').append(h('button', { type: 'button', class: 'btn btn-sm', style: { marginTop: '10px' }, onclick: async e => {
      e.target.disabled = true;
      const r = await api.post('/api/server/run-mode').catch(err => ({ ok: false, error: err.message }));
      if (r.ok) { toast('Start-up set up'); status = await api.get('/api/status'); renderBanner(); } else { toast(r.error); e.target.disabled = false; }
    } }, 'Set it up'));
    out.push(box);
  }
  $('#banner').replaceChildren(...out);
  $('#banner').style.display = out.length ? 'flex' : 'none';
  $('#banner').style.flexDirection = 'column';
  $('#banner').style.gap = '12px';
}

// ---------- updates ----------
let upd;
const checkedText = t => { const a = ago(t); return a === 'now' ? 'checked just now' : /\d$/.test(a) ? `checked ${a} ago` : `checked ${a}`; };
function renderUpdates() {
  const u = upd;
  const state = u.available ? `version ${u.latest} is available` : u.ahead ? 'newer than GitHub' : u.latest ? 'up to date' : null;
  $('#upd-sub').textContent = [`Version ${u.current}`, state, u.checkedAt ? checkedText(u.checkedAt) : 'not checked yet'].filter(Boolean).join(' · ');
  setSwitch($('#upd-auto'), u.auto);

  let box = null;
  if (u.error) {
    box = statusBox('warn', 'Couldn’t check for updates', u.error);
  } else if (u.available) {
    box = statusBox(u.problem ? 'warn' : 'info', `Version ${u.latest} is available`, u.problem
      ? [u.problem, ' Update manually below once that’s sorted.']
      : 'Update now closes Start Page, installs the update in a new window and opens Start Page again. Your settings are kept.');
    box.querySelector('div').append(
      h('div', { class: 'upd-actions' },
        u.problem ? null : h('button', { type: 'button', class: 'btn btn-sm btn-primary', id: 'upd-now', onclick: updateNow }, 'Update now'),
        h('button', { type: 'button', class: 'btn btn-sm', id: 'upd-show', 'aria-expanded': String(!$('#upd-changes').hidden), onclick: toggleChanges }, 'See what’s changed'),
        h('a', { class: 'btn btn-sm', href: u.repo, target: '_blank', rel: 'noopener' }, 'Open on GitHub')),
      h('details', { class: 'upd-manual' }, h('summary', null, 'Update manually'),
        h('div', null, ...rich(['Double-click ', ['chip', 'update.bat'], ' in the Start Page folder. It does the same as Update now.'])),
        u.install === 'git'
          ? h('div', null, ...rich(['Or run ', ['chip', 'git pull'], ' in the Start Page folder, then run ', ['chip', 'install.bat'], '.']))
          : h('div', null, 'Or ', h('a', { href: u.zip }, 'download the ZIP'), ', copy its files over your Start Page folder, then run ',
            h('span', { class: 'chip' }, 'install.bat'), '. ', h('span', { class: 'chip' }, 'config.json'), ' isn’t in the download, so your settings are kept.')));
  } else if (u.ahead) {
    box = statusBox('info', `This copy is newer than GitHub (${u.latest})`, 'It has changes that aren’t on GitHub yet.');
  }
  $('#upd-box').replaceChildren(...(box ? [box] : []));
  if (!u.available) $('#upd-changes').hidden = true;
}

async function toggleChanges() {
  const list = $('#upd-changes');
  const btn = $('#upd-show');
  if (!list.hidden) { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
  list.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  list.replaceChildren(statusBox('busy', 'Loading the list of changes…'));
  try {
    list.replaceChildren(...renderChanges(await api.get('/api/updates/changes')));
  } catch (e) {
    list.replaceChildren(statusBox('warn', 'Couldn’t load the list of changes', e.message));
  }
}

function renderChanges(c) {
  const out = [];
  if (c.note) out.push(h('div', { class: 'upd-note' }, c.note));
  if (!c.groups.length) out.push(h('div', { class: 'upd-note' }, 'No changes found.'));
  for (const g of c.groups) {
    const mine = g.version === c.current;
    const label = !mine ? `Version ${g.version}` : g.maybeHave ? `Version ${g.version} (some of these may already be in your copy)` : `More in version ${g.version}, your version`;
    out.push(h('div', { class: 'upd-group' },
      h('div', { class: 'upd-ver' }, label, h('span', null, `${g.commits.length} commit${g.commits.length === 1 ? '' : 's'}`)),
      ...g.commits.map(x => h('a', { class: 'upd-commit', href: x.url, target: '_blank', rel: 'noopener' },
        h('span', { class: 'sha' }, x.sha), h('span', { class: 'msg' }, x.title),
        h('span', { class: 'meta' }, [x.author, ago(x.date)].filter(Boolean).join(' · '))))));
  }
  out.push(h('a', { class: 'upd-more', href: c.compareUrl, target: '_blank', rel: 'noopener' },
    c.truncated ? 'Only the first 250 commits are shown. See them all on GitHub →' : 'Compare on GitHub →'));
  return out;
}

$('#upd-check').addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    upd = await api.post('/api/updates/check');
    renderUpdates();
    if (!upd.error && !upd.available) toast(upd.ahead ? 'This copy is newer than GitHub' : 'You’re up to date');
  } catch (err) {
    toast(err.message);
  }
  btn.disabled = false;
  btn.textContent = 'Check for updates';
});
bindSwitch($('#upd-auto'), async on => {
  try { cfg = (await api.post('/api/config', { updates: { auto: on } })).config; upd.auto = on; toast(on ? 'Checks for updates daily' : 'Automatic update checks off'); }
  catch (e) { toast(e.message); setSwitch($('#upd-auto'), !on); }
});

// Start Page closes and update.bat takes over in its own window; this page waits for the new version.
async function updateNow(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Starting the update…';
  let r;
  try { r = await api.post('/api/updates/install'); } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Update now';
    $('#upd-box').prepend(statusBox('err', 'Couldn’t start the update', err.message));
    return;
  }
  const note = h('div', null, statusBox('busy', 'Waiting for the update to finish…'));
  document.body.replaceChildren(h('div', { class: 'stopped' },
    h('div', { class: 'brand' }, h('div', { class: 'mark' }, '~/'), 'Start Page'),
    h('h1', null, `Updating to version ${upd.latest}`),
    h('p', { class: 'upd-wait' }, 'Start Page closed, and a window called “Start Page update” shows the progress. When it’s done, ',
      status.env === 'test' ? 'start.bat opens the test copy again' : 'Start Page opens again', ' and this page reloads by itself.'),
    note));
  // Reload once the server is back. The same version coming back means the update didn't finish.
  let wentDown = false;
  for (let i = 0; i < 450; i++) { // up to 15 minutes
    await new Promise(res => setTimeout(res, 2000));
    const ping = await fetch('/api/ping', { cache: 'no-store' }).then(x => x.json()).catch(() => null);
    if (!ping) { wentDown = true; continue; }
    if (ping.version !== r.version) { location.href = '/settings#updates'; return; }
    if (wentDown) break;
  }
  note.replaceChildren(statusBox('warn', 'The update didn’t finish', 'Start Page is running the version you had. The update window says what went wrong.'),
    h('a', { class: 'btn btn-sm upd-back', href: '/settings#updates' }, 'Back to Settings'));
}

async function loadUpdates() {
  try { upd = await api.get('/api/updates?details=1'); } catch (e) { $('#upd-sub').textContent = 'Couldn’t read the update status: ' + e.message; return; }
  // Never checked (a new install): check now so the section has something to say.
  if (!upd.checkedAt) upd = await api.post('/api/updates/check').catch(() => upd);
  renderUpdates();
  // Arrived from the dashboard's "Update available" badge: show what's changed right away.
  if (location.hash === '#updates' && upd.available) toggleChanges();
}

async function restart() {
  const url = status.savedUrl;
  toast('Restarting…');
  try { await api.post('/api/server/restart'); } catch {}
  await waitFor(url);
  location.href = url + '/settings';
}
async function waitFor(url) {
  const until = Date.now() + 30000;
  await new Promise(r => setTimeout(r, 1200));
  while (Date.now() < until) {
    try { await fetch(url + '/api/ping', { mode: 'no-cors', cache: 'no-store' }); return; } catch {}
    await new Promise(r => setTimeout(r, 700));
  }
}
$('#restart').addEventListener('click', restart);
$('#stop').addEventListener('click', async () => {
  try { await api.post('/api/server/stop'); } catch {}
  showStopped('The start page server is stopped', cfg.server.runMode === 'manual'
    ? 'To start it again, open Start Page from the Start menu.'
    : `It starts again ${cfg.server.runMode === 'signin' ? 'the next time you sign in' : 'when Windows restarts'}, or right away if you open Start Page from the Start menu.`);
});

function showStopped(title, body) {
  document.body.replaceChildren(h('div', { class: 'stopped' },
    h('div', { class: 'brand' }, h('div', { class: 'mark' }, '~/'), 'Start Page'),
    h('h1', null, title), h('p', { style: { fontSize: '15px', lineHeight: 1.6 } }, body),
    h('div', { class: 'cmdline', style: { display: 'flex', gap: '10px', alignItems: 'center', padding: '12px 14px', borderRadius: '3px', background: 'var(--bar)', border: '1px solid var(--line)' } },
      icon('term', 16, 'var(--accent)', 2), h('code', { class: 'mono', style: { fontSize: '12.5px', color: 'var(--ink)', overflowWrap: 'anywhere' } }, 'Start menu  ›  Start Page'))));
}

// ---------- connections ----------
function connRow(ic, name, detail, state, action, step) {
  const col = { ok: 'var(--ok)', warn: 'var(--warn)', err: 'var(--err)' }[state];
  const mark = state === 'ok' ? icon('check', 12, 'var(--on-accent)', 3) : icon('alertDot', 12, 'var(--on-accent)', 3);
  return h('div', { class: 'conn' },
    h('div', { class: 'mk', style: { background: col } }, mark),
    icon(ic, 18, 'var(--text)', 1.75),
    h('div', { class: 'grow' }, h('span', { class: 't' }, name), h('span', { class: 'd', style: state === 'ok' ? null : { color: col } }, detail)),
    h('a', { class: 'btn btn-sm', href: `/setup?step=${step}&from=settings` }, action));
}
async function renderConnections() {
  const rows = [];
  const l = cfg.location;
  rows.push(l ? connRow('cloud', 'Location & weather', `${l.label} · °${cfg.units === 'celsius' ? 'C' : 'F'} · alerts ${cfg.weatherAlerts && l.country === 'US' ? 'on' : 'off'}`, 'ok', 'Edit', 'location')
    : connRow('cloud', 'Location & weather', 'Not set up', 'warn', 'Set up', 'location'));

  const calRow = connRow('cal', 'Google Calendar', cfg.calendars.length ? `${cfg.calendars.length} calendar${cfg.calendars.length === 1 ? '' : 's'} · checking…` : 'Not connected',
    cfg.calendars.length ? 'ok' : 'warn', cfg.calendars.length ? 'Edit' : 'Connect', 'calendar');
  rows.push(calRow);

  const gh = cfg.github;
  let ghRow;
  if (!gh.tokenSet) ghRow = connRow('gh', 'GitHub', 'Not connected', 'warn', 'Connect', 'github');
  else {
    const exp = gh.expires ? new Date(gh.expires.replace(' UTC', 'Z').replace(' ', 'T')) : null;
    const days = exp ? Math.ceil((exp - Date.now()) / 86400e3) : null;
    ghRow = days != null && days <= 14
      ? connRow('gh', 'GitHub', days <= 0 ? `Token expired · ${gh.username}` : `Token expires in ${days} day${days === 1 ? '' : 's'} · ${gh.username}`, days <= 0 ? 'err' : 'warn', 'Renew token', 'github')
      : connRow('gh', 'GitHub', `${gh.username} · ${gh.repos.length} repositor${gh.repos.length === 1 ? 'y' : 'ies'} · ${gh.accounts.length} account${gh.accounts.length === 1 ? '' : 's'} followed`, 'ok', 'Edit', 'github');
  }
  rows.push(ghRow);

  const newsRow = connRow('news', 'News', `${cfg.news.ap ? 'AP world' : 'AP off'} · ${cfg.news.localFeeds.length} local source${cfg.news.localFeeds.length === 1 ? '' : 's'}`, 'ok', 'Edit', 'news');
  rows.push(newsRow);
  rows.push(connRow('term', 'Server', `${RUN_LONG[cfg.server.runMode]} · ${cfg.server.host}:${cfg.server.port} · GitHub every ${REFRESH_TEXT(cfg.refresh.github)}`, 'ok', 'Edit', 'server'));
  $('#conn-list').replaceChildren(...rows);

  // Live checks, filled in as they finish.
  if (cfg.calendars.length) api.get('/api/calendar').then(r => {
    const bad = r.errors.length;
    calRow.replaceWith(connRow('cal', 'Google Calendar', bad ? `${bad} of ${cfg.calendars.length} calendar${cfg.calendars.length === 1 ? '' : 's'} couldn’t be loaded` : `${cfg.calendars.length} calendar${cfg.calendars.length === 1 ? '' : 's'} · last checked ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      bad ? 'err' : 'ok', bad ? 'Fix' : 'Edit', 'calendar'));
  }).catch(() => {});
  if (gh.tokenSet) api.get('/api/github').then(r => {
    if (r.authError) ghRow.replaceWith(connRow('gh', 'GitHub', r.authError, 'err', 'Renew token', 'github'));
  }).catch(() => {});
  if (cfg.news.localFeeds.length) api.get('/api/news').then(r => {
    if (r.localErrors.length) newsRow.replaceWith(connRow('news', 'News', `${r.localErrors.length} source${r.localErrors.length === 1 ? '' : 's'} couldn’t be loaded`, 'warn', 'Fix', 'news'));
  }).catch(() => {});
}

// ---------- dashboard preferences ----------
async function savePrefs(patch, msg = 'Saved') {
  try { cfg = (await api.post('/api/config', { dashboard: patch })).config; toast(msg); } catch (e) { toast(e.message); }
}
function renderDashboard() {
  const d = cfg.dashboard;
  const list = [['calendar', 'Calendar', 'Up next, beside the clock'], ['headlines', 'Headlines', 'AP and local sources'],
    ['contributions', 'Contributions', 'Heatmap and stats in the GitHub panel'], ['inbox', 'Inbox', 'GitHub notifications'],
    ['prs', 'Pull requests and commits', 'Your open PRs and recent commits'], ['watching', 'Watching', 'Latest release, stars and open PRs of repositories you follow'],
    ['activity', 'Activity', 'Daily charts for repositories, people and organizations you follow']];
  $('#sections').replaceChildren(...list.map(([k, name, desc]) => {
    const row = checkRow('sec-' + k, name, desc, d.sections[k], true);
    row.querySelector('input').addEventListener('change', e => savePrefs({ sections: { ...cfg.dashboard.sections, [k]: e.target.checked } }));
    return row;
  }));
  setSeg($('#clock-fmt'), d.clock24 ? '24' : '12');
  setSwitch($('#seconds'), d.seconds);
  // 'auto' comes first: orange for the installed app, green for the test copy (like their icons).
  const autoLabel = `Automatic: orange when live, green in Test (${cfg.env === 'test' ? 'green' : 'orange'} here)`;
  $('#accents').replaceChildren(...['auto', ...cfg.choices.accents].map(c => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(c === d.accent), class: c === 'auto' ? 'auto' : null,
    'aria-label': c === 'auto' ? autoLabel : 'Accent ' + c, title: c === 'auto' ? autoLabel : null,
    style: { background: c === 'auto' ? cfg.envAccent : c },
    onclick: e => {
      $$('#accents button').forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget)));
      applyAccent(c === 'auto' ? cfg.envAccent : c);
      savePrefs({ accent: c });
    } }, c === 'auto' ? 'A' : null)));
}
bindSeg($('#clock-fmt'), v => savePrefs({ clock24: v === '24' }));
bindSwitch($('#seconds'), on => savePrefs({ seconds: on }));

// ---------- dialogs ----------
$$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

$('#open-disable').addEventListener('click', () => {
  $('#dis-url').textContent = status.url.replace('http://', '');
  $('#dis-now-sub').textContent = cfg.server.runMode === 'manual' ? 'The server stops now. Open Start Page from the Start menu to start it again.'
    : `The server stops now and starts again ${cfg.server.runMode === 'signin' ? 'the next time you sign in' : 'when Windows restarts'}.`;
  $('#dis-info').replaceChildren(statusBox('info', 'To turn it back on', 'Open Start Page from the Start menu. It restores the start-up setting and everything you set up.'));
  $('#dis-warn').replaceChildren(icon('warn', 14, 'var(--warn)', 2),
    h('span', null, 'Your browser will show “This site can’t be reached” when it opens. If you won’t use the start page for a while, change your browser’s start page back.'));
  $('#dis-status').replaceChildren();
  $('#dlg-disable').showModal();
});
$('#do-disable').addEventListener('click', async () => {
  const mode = ($('input[name="dis"]:checked') || {}).value || 'off';
  const btn = $('#do-disable');
  btn.disabled = true;
  if (mode === 'off' && cfg.server.runMode === 'service') $('#dis-status').replaceChildren(statusBox('busy', 'Waiting for administrator approval…', 'Windows will ask to remove the background task.'));
  try {
    await api.post('/api/server/disable', { mode });
    showStopped(mode === 'off' ? 'The start page is turned off' : 'The start page server is stopped',
      mode === 'off' ? 'It won’t start on its own any more. Your settings are kept. To turn it back on, open Start Page from the Start menu:'
        : `It starts again ${cfg.server.runMode === 'signin' ? 'the next time you sign in' : cfg.server.runMode === 'service' ? 'when Windows restarts' : 'when you open it'}. To start it now, open Start Page from the Start menu:`);
  } catch (e) {
    $('#dis-status').replaceChildren(statusBox('err', 'Couldn’t turn it off', e.message));
    btn.disabled = false;
  }
});

$('#open-reset').addEventListener('click', () => {
  const g = cfg.github;
  const rows = [
    ['GitHub token', g.tokenSet ? `${g.username} · ${g.repos.length} repos` : 'none'],
    ['Calendar addresses', `${cfg.calendars.length} calendar${cfg.calendars.length === 1 ? '' : 's'}`],
    ['Location', cfg.location ? cfg.location.label : 'none'],
    ['News sources', `${cfg.news.ap ? 'AP' : 'AP off'} · ${cfg.news.localFeeds.length} local`],
    ['Server and dashboard preferences', 'start-up, port, layout'],
  ];
  $('#removed').replaceChildren(...rows.map(([a, b]) => h('div', { class: 'removed' }, h('span', null, a), h('span', null, b))));
  $('#dellogs-wrap').replaceChildren(checkRow('dellogs', 'Also delete log files', 'The logs folder in the start-page folder', false, true));
  $('#dellogs-wrap').firstChild.style.borderTop = '0';
  $('#reset-info').replaceChildren(g.tokenSet
    ? statusBox('info', 'Your GitHub token still works after this', rich(['Delete it on GitHub too if you won’t set this up again: ', ['chip', 'github.com/settings/tokens']]))
    : '');
  $('#confirm').value = '';
  $('#do-reset').disabled = true;
  $('#reset-status').replaceChildren();
  $('#dlg-reset').showModal();
});
$('#confirm').addEventListener('input', () => { $('#do-reset').disabled = $('#confirm').value.trim().toLowerCase() !== 'reset'; });
$('#do-reset').addEventListener('click', async () => {
  const btn = $('#do-reset');
  btn.disabled = true;
  if (cfg.server.runMode === 'service') $('#reset-status').replaceChildren(statusBox('busy', 'Waiting for administrator approval…', 'Windows will ask to remove the background task.'));
  try {
    const r = await api.post('/api/server/reset', { deleteLogs: $('#dellogs').checked });
    if (r.restart) { $('#reset-status').replaceChildren(statusBox('busy', 'Restarting on the default address…', r.url)); await waitFor(r.url.replace(/\/setup$/, '')); }
    location.href = r.url;
  } catch (e) {
    $('#reset-status').replaceChildren(statusBox('err', 'Couldn’t reset', e.message));
    btn.disabled = false;
  }
});

// ---------- start ----------
(async () => {
  try { [cfg, status] = await Promise.all([api.get('/api/config'), api.get('/api/status')]); }
  catch (e) { $('#layout').replaceChildren(h('p', null, 'Couldn’t reach the start page server: ' + e.message)); return; }
  applyAccent(accentHex(cfg));
  renderStatus();
  renderBanner();
  renderConnections();
  renderDashboard();
  loadUpdates();
  setInterval(renderStatus, 30000);
})();
