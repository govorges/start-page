// First-run setup wizard (also opened from Settings to edit one connection).
const STEPS = [
  { id: 'welcome', name: 'Welcome' },
  { id: 'location', name: 'Location & weather', req: 'Required' },
  { id: 'calendar', name: 'Google Calendar', req: 'Required' },
  { id: 'github', name: 'GitHub', req: 'Required' },
  { id: 'news', name: 'News', req: 'Optional' },
  { id: 'server', name: 'Server', req: 'Recommended' },
  { id: 'finish', name: 'Finish' },
];
const params = new URLSearchParams(location.search);
const from = ['settings', 'dashboard'].includes(params.get('from')) ? params.get('from') : null;
const returnUrl = from === 'settings' ? '/settings' : '/';

let cfg, status = {}, current = null;
const saved = new Set();
const steps = {};

// ---------- shell: rail, progress, footer ----------
function renderRail() {
  const idx = STEPS.findIndex(s => s.id === current);
  const nav = $('#steps');
  nav.replaceChildren();
  STEPS.forEach((s, i) => {
    const done = isDone(s.id) && s.id !== current;
    const a = h('a', { href: `?step=${s.id}${from ? '&from=' + from : ''}`, class: done ? 'done' : '', 'aria-current': s.id === current ? 'step' : null,
      onclick: e => { e.preventDefault(); go(s.id); } },
      h('span', { class: 'num' }, done ? icon('check', 14, 'var(--on-accent)', 3) : String(i + 1)),
      h('span', { class: 'name' }, s.name),
      s.req ? h('span', { class: 'req' }, s.req) : null);
    if (done) a.setAttribute('aria-label', `${s.name}, done`);
    nav.append(a);
    if (i < STEPS.length - 1) nav.append(h('div', { class: 'link' + (i < idx ? ' done' : '') }));
  });
  $('#progress').style.width = Math.round((idx + 1) / STEPS.length * 100) + '%';
}

function isDone(id) {
  if (!cfg) return false;
  switch (id) {
    case 'welcome': return cfg.setupComplete || saved.size > 0 || current !== 'welcome';
    case 'location': return !!cfg.location;
    case 'calendar': return cfg.calendars.length > 0;
    case 'github': return cfg.github.tokenSet;
    case 'news': return saved.has('news') || cfg.setupComplete;
    case 'server': return saved.has('server') || cfg.setupComplete;
    default: return cfg.setupComplete;
  }
}

function updateFooter() {
  const idx = STEPS.findIndex(s => s.id === current);
  const step = steps[current];
  const next = $('#next'), back = $('#back');
  back.hidden = !from && idx === 0;
  back.textContent = from ? 'Cancel' : 'Back';
  $('#skip').hidden = !!from || current !== 'news';
  next.textContent = from && current !== 'finish' ? 'Save and return'
    : current === 'welcome' ? 'Get started →' : current === 'server' ? 'Save and continue' : current === 'finish' ? 'Open my start page →' : 'Continue';
  const ok = step.valid ? step.valid() : true;
  next.disabled = !ok;
  next.setAttribute('aria-disabled', String(!ok));
}

function go(id, push = true) {
  if (!steps[id]) id = 'welcome';
  current = id;
  $$('.step').forEach(s => { s.hidden = s.dataset.step !== id; });
  const idx = STEPS.findIndex(s => s.id === id);
  const lab = $(`.step[data-step="${id}"] [data-steplabel]`);
  if (lab) lab.textContent = `Step ${idx + 1} of ${STEPS.length}` + (STEPS[idx].req ? ' · ' + STEPS[idx].req : '');
  if (push) history.pushState({ step: id }, '', `?step=${id}${from ? '&from=' + from : ''}`);
  renderRail();
  if (steps[id].enter) steps[id].enter();
  updateFooter();
  window.scrollTo(0, 0);
  const h1 = $(`.step[data-step="${id}"] h1`);
  if (h1) h1.focus({ preventScroll: true });
}
window.addEventListener('popstate', e => go((e.state && e.state.step) || params.get('step') || 'welcome', false));

$('#back').addEventListener('click', () => {
  if (from) { location.href = returnUrl; return; }
  const idx = STEPS.findIndex(s => s.id === current);
  if (idx > 0) go(STEPS[idx - 1].id);
});
$('#skip').addEventListener('click', () => go(STEPS[STEPS.findIndex(s => s.id === current) + 1].id));
$('#next').addEventListener('click', async () => {
  const step = steps[current], btn = $('#next');
  if (step.valid && !step.valid()) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    if (step.save) await step.save();
    saved.add(current);
    if (current === 'finish') return; // finish navigates itself
    if (from) { location.href = returnUrl; return; }
    go(STEPS[STEPS.findIndex(s => s.id === current) + 1].id);
  } catch (e) {
    if (e.message) toast(e.message);
    btn.textContent = label;
    updateFooter();
  }
});

async function saveConfig(patch) {
  const r = await api.post('/api/config', patch);
  cfg = r.config;
  return r;
}

// ---------- 1. Welcome ----------
steps.welcome = {
  enter() {
    if ($('#services').childElementCount) return;
    const svc = (ic, name, desc, req, time) => h('div', { class: 'service' },
      h('div', { class: 'top' }, icon(ic, 20, 'var(--ink)', 1.75), h('span', { class: 'tag' + (req === 'Required' ? ' req' : '') }, req)),
      h('div', { class: 'n' }, name), h('div', { class: 'd' }, desc), h('div', { class: 'time' }, time));
    $('#services').append(
      svc('cloud', 'Location & weather', 'Current conditions, forecast and severe-weather alerts for where you are.', 'Required', '~30 sec'),
      svc('cal', 'Google Calendar', 'Upcoming events from one or more of your calendars. Read-only.', 'Required', '~2 min'),
      svc('gh', 'GitHub', 'Notifications, your pull requests, commit history and the repositories you watch.', 'Required', '~3 min'),
      svc('news', 'News', 'AP world headlines, plus local sources you choose.', 'Optional', '~1 min'));
    $('#welcome-note').append(icon('term', 18, 'var(--accent)', 1.75),
      h('span', { style: { color: 'var(--text)', fontSize: '13.5px' } }, 'Start Page keeps running in the background while you set up; its ~/ icon is in the taskbar tray. You can change anything later from Settings.'));
  },
};

// ---------- 2. Location ----------
const US_STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia' };
const loc = { location: null, units: 'fahrenheit', unitsTouched: false, alerts: true };

function setLocation(l) {
  loc.location = l;
  if (!loc.unitsTouched) { loc.units = ['US', 'LR', 'MM'].includes(l.country) ? 'fahrenheit' : 'celsius'; setSeg($('#units'), loc.units); }
  renderLocStatus();
  updateFooter();
}
function renderLocStatus() {
  const l = loc.location;
  $('#loc-status').replaceChildren(l ? statusBox('ok', `Found ${l.label}`, `Latitude ${l.lat.toFixed(2)}, longitude ${l.lon.toFixed(2)} · ${l.source === 'browser' ? 'from your browser' : 'from search'}`) : '');
  const us = !l || l.country === 'US';
  const sw = $('#alerts');
  sw.disabled = !us;
  setSwitch(sw, us && loc.alerts);
  $('#alerts-sub').textContent = us ? 'From the National Weather Service. US locations only.' : 'Only available for locations in the United States.';
}

function findMe() {
  const box = $('#loc-status');
  if (!navigator.geolocation) { box.replaceChildren(statusBox('err', 'This browser can’t share your location', 'Enter a city or ZIP code instead.')); return; }
  box.replaceChildren(statusBox('busy', 'Finding your location…', 'If your browser asks, choose Allow.'));
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    let r = {};
    try { r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`).then(x => x.json()); } catch {}
    const city = r.city || r.locality || '';
    const region = r.principalSubdivision || '';
    setLocation({ label: [city, region].filter(Boolean).join(', ') || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, city, region, country: (r.countryCode || '').toUpperCase(), lat, lon, source: 'browser' });
  }, err => {
    box.replaceChildren(err.code === 1
      ? statusBox('err', 'Location access is blocked', 'Allow location for this page from the icon in the address bar, or enter a city or ZIP code instead.')
      : statusBox('err', 'Couldn’t get your location', 'Try again, or enter a city or ZIP code instead.'));
  }, { timeout: 15000, maximumAge: 600000 });
}

$$('input[name="locmode"]').forEach(r => r.addEventListener('change', () => {
  $('#loc-search').hidden = r.value !== 'search';
  if (r.value === 'search') $('#loc-q').focus();
}));
// "click" rather than "change", so choosing it again looks the location up again.
$('input[name="locmode"][value="browser"]').addEventListener('click', findMe);
$('#loc-search').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#loc-q').value.trim();
  const out = $('#loc-results');
  if (q.length < 2) return;
  const [name, rest = ''] = q.split(',').map(s => s.trim());
  out.replaceChildren(statusBox('busy', 'Searching…'));
  let results = [];
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=8&language=en&format=json`).then(x => x.json());
    results = r.results || [];
  } catch { out.replaceChildren(statusBox('err', 'Search isn’t working right now', 'Check your internet connection and try again.')); return; }
  if (rest) {
    const want = (US_STATES[rest.toUpperCase()] || rest).toLowerCase();
    results.sort((a, b) => Number((b.admin1 || '').toLowerCase().includes(want) || (b.country || '').toLowerCase().includes(want))
      - Number((a.admin1 || '').toLowerCase().includes(want) || (a.country || '').toLowerCase().includes(want)));
  }
  if (!results.length) { out.replaceChildren(statusBox('err', `No places found for “${q}”`, 'Try the town name without the state, or a nearby larger town.')); return; }
  out.replaceChildren(...results.slice(0, 5).map((p, i) => {
    const input = h('input', { type: 'radio', name: 'locpick', value: String(i) });
    input.addEventListener('change', () => setLocation({ label: [p.name, p.admin1].filter(Boolean).join(', '), city: p.name, region: p.admin1 || '', country: (p.country_code || '').toUpperCase(), lat: p.latitude, lon: p.longitude, source: 'search' }));
    return h('label', { class: 'radio-card' }, input, h('span', { class: 'dot' }),
      h('span', { class: 'body' }, h('span', { class: 't' }, p.name), h('span', { class: 's' }, [p.admin1, p.country].filter(Boolean).join(', '))));
  }));
});
bindSeg($('#units'), v => { loc.units = v; loc.unitsTouched = true; });
bindSwitch($('#alerts'), on => { loc.alerts = on; });

steps.location = {
  enter() {
    if (loc.init) return;
    loc.init = true;
    loc.location = cfg.location;
    loc.units = cfg.units;
    loc.unitsTouched = !!cfg.location;
    loc.alerts = cfg.weatherAlerts;
    setSeg($('#units'), loc.units);
    if (cfg.location) {
      const radio = $(`input[name="locmode"][value="${cfg.location.source}"]`);
      if (radio) radio.checked = true;
      $('#loc-search').hidden = cfg.location.source !== 'search';
    }
    renderLocStatus();
  },
  valid: () => !!loc.location,
  save: () => saveConfig({ location: loc.location, units: loc.units, weatherAlerts: loc.alerts }),
};

// ---------- 3. Calendar ----------
const cal = { entries: [] };
$('#cal-add').addEventListener('click', () => { addCalEntry('', ''); cal.entries[cal.entries.length - 1].url.focus(); });

function addCalEntry(url, name) {
  const n = cal.entries.length + 1;
  const urlInput = h('input', { class: 'mono', id: 'cal-url-' + n, autocomplete: 'off', spellcheck: 'false', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics' });
  const nameInput = h('input', { id: 'cal-name-' + n, autocomplete: 'off', placeholder: 'From calendar' });
  urlInput.value = url; nameInput.value = name;
  const urlWrap = h('div', { class: 'input-wrap' }, urlInput);
  const statusEl = h('div');
  const entry = { url: urlInput, name: nameInput, wrap: urlWrap, status: statusEl, state: 'idle', seq: 0 };
  const remove = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove this calendar', style: { height: '44px', width: '44px', background: 'transparent' } }, icon('trash', 16, 'var(--text)', 1.75));
  const el = h('div', { class: 'cal-entry' },
    h('div', { class: 'cal-grid' },
      h('div', { class: 'field' }, h('label', { for: urlInput.id }, cal.entries.length ? 'Another secret iCal address' : 'Secret iCal address'), urlWrap),
      h('div', { class: 'field' }, h('label', { for: nameInput.id }, 'Label (optional)'), h('div', { class: 'input-wrap' }, nameInput)),
      remove),
    statusEl);
  entry.el = el;
  remove.addEventListener('click', () => {
    cal.entries = cal.entries.filter(x => x !== entry);
    el.remove();
    if (!cal.entries.length) addCalEntry('', '');
    renderCalButtons();
  });
  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => testCal(entry), 500); };
  urlInput.addEventListener('input', () => { entry.state = 'idle'; urlWrap.className = 'input-wrap'; statusEl.replaceChildren(); updateFooter(); schedule(); });
  cal.entries.push(entry);
  $('#cal-list').append(el);
  renderCalButtons();
  if (url) testCal(entry);
  return entry;
}
function renderCalButtons() {
  $('#cal-add').replaceChildren(icon('plus', 14, 'var(--ink)', 2), cal.entries.length ? 'Add another calendar' : 'Add a calendar');
  cal.entries.forEach((e, i) => { e.el.querySelector('.icon-btn').hidden = cal.entries.length === 1 && !e.url.value; });
  updateFooter();
}
async function testCal(entry) {
  const url = entry.url.value.trim();
  if (!url) { entry.state = 'idle'; updateFooter(); return; }
  const seq = ++entry.seq;
  entry.state = 'busy';
  entry.status.replaceChildren(statusBox('busy', 'Checking this address…'));
  updateFooter();
  try {
    const r = await api.post('/api/test/calendar', { url });
    if (seq !== entry.seq) return;
    entry.state = 'ok';
    entry.info = r;
    entry.wrap.className = 'input-wrap ok';
    if (!entry.name.value) entry.name.placeholder = r.name;
    const next = r.next ? ` · next: ${r.next.title}, ${new Date(r.next.start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
    entry.status.replaceChildren(statusBox('ok', `Connected · ${r.name}`, `${r.count} event${r.count === 1 ? '' : 's'} in the next 7 days${next}`));
  } catch (e) {
    if (seq !== entry.seq) return;
    entry.state = 'err';
    entry.wrap.className = 'input-wrap err';
    entry.status.replaceChildren(statusBox('err', /website/.test(e.message) ? 'That’s a link to the Calendar website, not an iCal address' : 'This calendar couldn’t be connected', e.message));
  }
  updateFooter();
}

steps.calendar = {
  enter() {
    if (cal.init) return;
    cal.init = true;
    if (cfg.calendars.length) cfg.calendars.forEach(c => addCalEntry(c.url, c.name));
    else addCalEntry('', '');
    $('#cal-note').replaceChildren(statusBox('info', 'Using a work or school account?',
      'Some organizations turn off secret addresses. If a calendar only offers a “Public address in iCal format”, it can’t be connected this way. Add your personal calendar instead.'));
  },
  valid() {
    const filled = cal.entries.filter(e => e.url.value.trim());
    return filled.length > 0 && filled.every(e => e.state === 'ok');
  },
  save: () => saveConfig({ calendars: cal.entries.filter(e => e.url.value.trim()).map(e => ({ url: e.url.value.trim(), name: e.name.value.trim() })) }),
};

// ---------- 4. GitHub ----------
const gh = { info: null, token: '', selected: new Set(), accounts: new Set(), seq: 0 };
$('#gh-show').append(icon('eye', 16, 'var(--muted)', 2));
$('#gh-show').addEventListener('click', () => {
  const inp = $('#gh-token'), show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('#gh-show').setAttribute('aria-pressed', String(show));
  $('#gh-show').setAttribute('aria-label', show ? 'Hide token' : 'Show token');
  $('#gh-show').replaceChildren(icon(show ? 'eyeOff' : 'eye', 16, 'var(--muted)', 2));
});
let ghTimer;
$('#gh-token').addEventListener('input', () => {
  gh.token = $('#gh-token').value.trim();
  gh.info = null;
  $('#gh-token-wrap').className = 'input-wrap';
  $('#gh-status').replaceChildren();
  $('#gh-repos').hidden = true;
  $('#gh-accounts').hidden = true;
  updateFooter();
  clearTimeout(ghTimer);
  if (gh.token.length >= 20) ghTimer = setTimeout(() => verifyGh(gh.token), 500);
});

async function verifyGh(token) {
  const seq = ++gh.seq;
  $('#gh-status').replaceChildren(statusBox('busy', 'Checking with GitHub…'));
  try {
    const r = await api.post('/api/test/github', token ? { token } : {});
    if (seq !== gh.seq) return;
    gh.info = r;
    $('#gh-token-wrap').className = 'input-wrap ' + (r.missing.length ? 'err' : 'ok');
    if (r.missing.length) {
      $('#gh-status').replaceChildren(statusBox('err', `This token is missing: ${r.missing.join(', ')}`,
        rich(['On ', ['chip', 'github.com/settings/tokens'], ', open the token, tick ', ['b', r.missing.join(' and ')], ', then click ', ['b', 'Update token'], '. The token itself stays the same, so check again here afterwards.'])));
      const again = h('button', { type: 'button', class: 'btn btn-sm', style: { marginTop: '10px' }, onclick: () => verifyGh(gh.token) }, 'Check again');
      $('#gh-status').append(again);
    } else {
      const has = s => r.scopes.includes(s) || (s === 'notifications' && r.scopes.includes('repo')) || (s === 'read:user' && r.scopes.includes('user'));
      const exp = r.expires ? 'expires ' + new Date(r.expires.replace(' UTC', 'Z').replace(' ', 'T')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'no expiration date';
      const box = h('div', { class: 'status ok', role: 'status' },
        h('div', { class: 'gh-user' },
          r.avatar ? h('img', { src: r.avatar, alt: '', referrerpolicy: 'no-referrer' }) : null,
          h('div', null, h('div', { class: 't' }, `Connected as ${r.username}`),
            h('div', { class: 'scope-list' }, `notifications ${has('notifications') ? '✓' : '✗'} · read:user ${has('read:user') ? '✓' : '✗'} · repo ${r.privateRepos ? '✓' : '— public repos only'} · ${exp}`))));
      $('#gh-status').replaceChildren(box);
      renderRepoList();
      renderAccountList();
    }
  } catch (e) {
    if (seq !== gh.seq) return;
    $('#gh-token-wrap').className = 'input-wrap err';
    $('#gh-status').replaceChildren(statusBox('err', 'GitHub didn’t accept this token', e.message));
  }
  updateFooter();
}

function renderRepoList() {
  const repos = gh.info.repos;
  $('#gh-repos').hidden = false;
  if (!gh.selInit) {
    gh.selInit = true;
    const saved = cfg.github.repos.filter(r => repos.some(x => x.fullName === r));
    (saved.length ? saved : repos.slice(0, 3).map(r => r.fullName)).forEach(r => gh.selected.add(r));
  }
  const count = () => {
    $('#gh-repo-count').textContent = repos.length
      ? `From the repositories you watch on GitHub · ${gh.selected.size} of ${repos.length} selected${gh.selected.size >= 12 ? ' (the most it can show)' : ''}`
      : 'You aren’t watching any repositories yet. Click Watch on a repository on GitHub, then check the token again.';
  };
  $('#gh-repo-list').replaceChildren(...repos.map((r, i) => {
    const row = checkRow('repo-' + i, r.fullName, r.description || (r.private ? 'Private repository' : ''), gh.selected.has(r.fullName));
    const input = row.querySelector('input');
    input.addEventListener('change', () => {
      if (input.checked && gh.selected.size >= 12) { input.checked = false; toast('You can follow up to 12 repositories.'); return; }
      input.checked ? gh.selected.add(r.fullName) : gh.selected.delete(r.fullName);
      count();
    });
    return row;
  }));
  $('#gh-select-all').hidden = !repos.length;
  count();
}
function renderAccountList() {
  const people = gh.info.following || [];
  $('#gh-accounts').hidden = false;
  if (!gh.accInit) {
    gh.accInit = true;
    gh.accounts = new Set();
    const saved = cfg.github.accounts.filter(a => people.some(p => p.login === a));
    // Default: organizations you belong to first, then people you follow, up to 4.
    const byDefault = [...people.filter(p => p.member), ...people.filter(p => !p.member)].slice(0, 4).map(p => p.login);
    (saved.length ? saved : byDefault).forEach(a => gh.accounts.add(a));
  }
  const count = () => {
    $('#gh-account-count').textContent = people.length
      ? `People you follow and organizations you’re in · ${gh.accounts.size} of ${people.length} selected${gh.accounts.size >= 12 ? ' (the most it can show)' : ''}`
      : 'You don’t follow anyone on GitHub yet, and aren’t a public member of any organization.';
  };
  $('#gh-account-list').replaceChildren(...people.map((p, i) => {
    const desc = p.type === 'org' ? (p.member ? 'Organization · you’re a member' : 'Organization') : 'Person you follow';
    const row = checkRow('acct-' + i, p.login, desc, gh.accounts.has(p.login));
    row.querySelector('.box').after(h('img', { class: 'avatar' + (p.type === 'org' ? ' org' : ''), src: p.avatar + (p.avatar.includes('?') ? '&' : '?') + 's=44', alt: '', referrerpolicy: 'no-referrer' }));
    const input = row.querySelector('input');
    input.addEventListener('change', () => {
      if (input.checked && gh.accounts.size >= 12) { input.checked = false; toast('You can follow up to 12 people and organizations.'); return; }
      input.checked ? gh.accounts.add(p.login) : gh.accounts.delete(p.login);
      count();
    });
    return row;
  }));
  $('#gh-accounts-all').hidden = !people.length;
  count();
}
$('#gh-accounts-all').addEventListener('click', () => {
  const people = gh.info.following || [];
  const all = gh.accounts.size < Math.min(12, people.length);
  gh.accounts.clear();
  if (all) people.slice(0, 12).forEach(p => gh.accounts.add(p.login));
  $('#gh-accounts-all').textContent = all ? 'Clear' : 'Select all';
  renderAccountList();
});

$('#gh-select-all').addEventListener('click', () => {
  const repos = gh.info.repos;
  const all = gh.selected.size < Math.min(12, repos.length);
  gh.selected.clear();
  if (all) repos.slice(0, 12).forEach(r => gh.selected.add(r.fullName));
  $('#gh-select-all').textContent = all ? 'Clear' : 'Select all';
  renderRepoList();
});

steps.github = {
  enter() {
    if (gh.init) return;
    gh.init = true;
    if (cfg.github.tokenSet) {
      $('#gh-token').placeholder = `Saved token ${cfg.github.tokenHint} · paste a new one to replace it`;
      verifyGh('');
    }
  },
  valid: () => !!(gh.info && !gh.info.missing.length),
  save: () => saveConfig({ github: {
    token: gh.token || undefined, username: gh.info.username, name: gh.info.name, avatar: gh.info.avatar,
    scopes: gh.info.scopes, expires: gh.info.expires, repos: [...gh.selected],
    // If the list of accounts couldn't be loaded, keep what was saved before.
    accounts: (gh.info.following || []).length ? [...gh.accounts] : cfg.github.accounts,
  } }),
};

// ---------- 5. News ----------
const newsState = { feeds: [], ap: true };
bindSwitch($('#ap'), on => { newsState.ap = on; });
$('#feed-add').append(icon('plus', 14, 'var(--ink)', 2), 'Add');

function renderFeeds() {
  $('#news-sub').textContent = cfg.location ? `Suggested for ${cfg.location.label}, plus any you add` : 'Add any site’s RSS feed below';
  const rows = newsState.feeds.map((f, i) => {
    const row = checkRow('feed-' + i, f.name || f.url, f.desc || f.url, f.checked);
    row.querySelector('input').addEventListener('change', e => { f.checked = e.target.checked; });
    return row;
  });
  if (!rows.length) rows.push(h('div', { class: 'check-row', style: { cursor: 'default' } }, h('span', { class: 'd' }, 'No suggestions for your area yet. Add a local site’s feed below.')));
  $('#feed-list').replaceChildren(...rows);
}
$('#feed-form').addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('#feed-url').value.trim();
  if (!url) return;
  if (newsState.feeds.some(f => f.url === url)) { $('#feed-status').replaceChildren(statusBox('info', 'That source is already in the list')); return; }
  $('#feed-status').replaceChildren(statusBox('busy', 'Checking this feed…'));
  try {
    const r = await api.post('/api/test/feed', { url });
    newsState.feeds.push({ url, name: r.name, desc: `${r.count} stories · ${r.hasImages ? 'has images' : 'no images'}`, checked: true });
    renderFeeds();
    $('#feed-url').value = '';
    $('#feed-status').replaceChildren(statusBox('ok', `Added ${r.name}`, `Latest: ${r.latest}`));
  } catch (err) {
    $('#feed-status').replaceChildren(statusBox('err', 'This feed can’t be added', err.message));
  }
});

steps.news = {
  async enter() {
    if (newsState.init) return;
    newsState.init = true;
    newsState.ap = cfg.news.ap;
    setSwitch($('#ap'), newsState.ap);
    newsState.feeds = cfg.news.localFeeds.map(f => ({ url: f.url, name: f.name, desc: '', checked: true }));
    renderFeeds();
    try {
      const sug = await api.get('/api/news/suggestions');
      for (const s of sug) {
        const have = newsState.feeds.find(f => f.url === s.url);
        if (have) { have.name = have.name || s.name; have.desc = s.desc; } else newsState.feeds.push({ ...s, checked: false });
      }
      renderFeeds();
    } catch {}
  },
  save: () => saveConfig({ news: { ap: newsState.ap, localFeeds: newsState.feeds.filter(f => f.checked).map(f => ({ url: f.url, name: f.name })) } }),
};

// ---------- 6. Server ----------
const srv = { port: 3000, portOk: true };
const LABEL = s => (s < 60 ? `${s} seconds` : s < 3600 ? `${s / 60} minute${s === 60 ? '' : 's'}` : `${s / 3600} hour${s === 3600 ? '' : 's'}`);
const REFRESH_NAMES = { github: 'GitHub notifications and pull requests', calendar: 'Calendar', weather: 'Weather and alerts', news: 'News' };
bindSwitch($('#srv-restart'));
bindSwitch($('#srv-open'));
bindSwitch($('#srv-logs'));
$('#cmd-icon').append(icon('term', 16, 'var(--accent)', 2));
$('#bind-warn').append(icon('warn', 13, 'var(--warn)', 2), h('span', null, 'Anyone on the same Wi-Fi could see your calendar and GitHub notifications. Only use this on a network you trust.'));
$('#show-cfg').addEventListener('click', () => api.post('/api/show-config').catch(e => toast(e.message)));
const bindValue = () => ($('input[name="bind"]:checked') || {}).value || '127.0.0.1';

function updateCmd() {
  $('#cmd').textContent = `node launcher.js   →   listens on ${bindValue()}:${$('#srv-port').value || '?'}`;
}
let portTimer;
async function checkPort() {
  const port = $('#srv-port').value.trim();
  updateCmd();
  srv.portOk = false;
  updateFooter();
  if (!/^\d+$/.test(port)) { $('#port-status').replaceChildren(statusBox('err', 'Enter a number from 1024 to 65535')); return; }
  const r = await api.get(`/api/port-check?port=${port}&host=${bindValue()}`).catch(() => ({ status: 'error' }));
  if ($('#srv-port').value.trim() !== port) return;
  const box = {
    current: () => statusBox('ok', `Port ${port} is the one in use now`, rich(['Your start page is at ', ['chip', `http://localhost:${port}`]])),
    free: () => statusBox('ok', `Port ${port} is free`, rich(['Your start page will move to ', ['chip', `http://localhost:${port}`]])),
    'in-use': () => statusBox('err', `Port ${port} is being used by another program`, 'Choose another, such as 3001 or 8080.'),
    'start-page': () => statusBox('err', `Another copy of the start page is using port ${port}`, 'Stop it from its Settings page first, or choose another port.'),
    denied: () => statusBox('err', `Windows doesn’t allow port ${port}`, 'Choose another, such as 3001 or 8080.'),
    invalid: () => statusBox('err', 'Enter a number from 1024 to 65535'),
    error: () => statusBox('err', 'Couldn’t check this port'),
  }[r.status]();
  $('#port-status').replaceChildren(box);
  srv.portOk = r.status === 'current' || r.status === 'free';
  updateFooter();
}
$('#srv-port').addEventListener('input', () => { clearTimeout(portTimer); portTimer = setTimeout(checkPort, 400); });
$$('input[name="bind"]').forEach(r => r.addEventListener('change', checkPort));

steps.server = {
  async enter() {
    if (srv.init) return;
    srv.init = true;
    const s = cfg.server;
    const rm = $(`input[name="runmode"][value="${s.runMode}"]`); if (rm) rm.checked = true;
    const bd = $(`input[name="bind"][value="${s.host}"]`); if (bd) bd.checked = true;
    setSwitch($('#srv-restart'), s.restartOnCrash);
    setSwitch($('#srv-open'), s.openBrowser);
    setSwitch($('#srv-logs'), s.logs);
    $('#srv-port').value = s.port;
    $('#cfg-path').textContent = cfg.configPath;
    $('#refresh-rows').replaceChildren(...Object.entries(cfg.choices.refresh).map(([k, list]) => {
      const sel = h('select', { class: 'select', id: 'refresh-' + k }, ...list.map(v => h('option', { value: v, selected: v === cfg.refresh[k] ? 'selected' : null }, LABEL(v))));
      sel.value = String(cfg.refresh[k]);
      return h('div', { class: 'select-row' }, h('label', { for: sel.id }, REFRESH_NAMES[k]), sel);
    }));
    checkPort();
    try { status = await api.get('/api/status'); } catch {}
    if (status.platform && status.platform !== 'win32') {
      $$('input[name="runmode"]').forEach(r => { if (r.value !== 'manual') { r.disabled = true; r.closest('label').style.opacity = .5; } });
      $('input[name="runmode"][value="manual"]').checked = true;
    }
  },
  valid: () => srv.portOk,
  async save() {
    const runMode = ($('input[name="runmode"]:checked') || {}).value || 'signin';
    await saveConfig({
      server: { runMode, host: bindValue(), port: Number($('#srv-port').value), restartOnCrash: switchOn($('#srv-restart')), openBrowser: switchOn($('#srv-open')), logs: switchOn($('#srv-logs')) },
      refresh: Object.fromEntries(Object.keys(cfg.choices.refresh).map(k => [k, Number($('#refresh-' + k).value)])),
    });
    const box = $('#srv-status');
    box.replaceChildren(statusBox('busy', runMode === 'service' ? 'Waiting for administrator approval…' : 'Setting up start-up…',
      runMode === 'service' ? 'Windows will ask whether to allow Task Scheduler to make changes.' : ''));
    const r = await api.post('/api/server/run-mode');
    if (!r.ok) {
      box.replaceChildren(statusBox('err', 'Couldn’t set up start-up', r.error + ' Choose another option, or try again.'));
      throw new Error('');
    }
    box.replaceChildren();
  },
};

// ---------- 7. Finish ----------
const RUN_LABEL = { signin: 'Starts at sign-in', service: 'Always on (background task)', manual: 'Starts when you open it' };
steps.finish = {
  enter() {
    const rows = [
      ['cloud', 'Location & weather', cfg.location ? `${cfg.location.label} · °${cfg.units === 'celsius' ? 'C' : 'F'} · alerts ${cfg.weatherAlerts && cfg.location.country === 'US' ? 'on' : 'off'}` : null, 'location', true],
      ['cal', 'Google Calendar', cfg.calendars.length ? `${cfg.calendars.length} calendar${cfg.calendars.length === 1 ? '' : 's'}` + (cal.entries.length ? ' · ' + cal.entries.filter(e => e.info).map(e => e.name.value || e.info.name).join(', ') : '') : null, 'calendar', true],
      ['gh', 'GitHub', cfg.github.tokenSet ? `${cfg.github.username} · ${cfg.github.repos.length} repositor${cfg.github.repos.length === 1 ? 'y' : 'ies'} followed` : null, 'github', true],
      ['news', 'News', `${cfg.news.ap ? 'AP world' : 'AP off'} · ${cfg.news.localFeeds.length} local source${cfg.news.localFeeds.length === 1 ? '' : 's'}`, 'news', false],
      ['term', 'Server', `${RUN_LABEL[cfg.server.runMode]} · ${cfg.server.host}:${cfg.server.port}${cfg.server.restartOnCrash ? ' · restarts if it stops' : ''}`, 'server', false],
    ];
    const missing = rows.filter(r => r[4] && !r[2]);
    $('#summary').replaceChildren(...rows.map(([ic, name, detail, id]) => h('div', { class: 'summary-row' },
      h('div', { class: 'tick' + (detail ? '' : ' missing') }, detail ? icon('check', 13, 'var(--on-accent)', 3) : icon('alertDot', 13, 'var(--warn)', 3)),
      icon(ic, 18, 'var(--text)', 1.75),
      h('div', { class: 'grow' }, h('span', { class: 't' }, name), h('span', { class: 'd', style: detail ? null : { color: 'var(--warn)' } }, detail || 'Not connected yet')),
      h('a', { href: `?step=${id}`, class: 'mono', style: { fontSize: '11.5px', color: 'var(--text)' }, onclick: e => { e.preventDefault(); go(id); } }, detail ? 'Edit' : 'Set up'))));
    $('#finish-title').textContent = missing.length ? 'Almost done' : 'You’re all set';
    $('#finish-sub').textContent = missing.length ? `Finish ${missing.map(m => m[1]).join(' and ')} to open your start page.` : 'Your start page is connected. Here’s what it will show.';
    $('#final-url').textContent = `http://localhost:${cfg.server.port}`;
    steps.finish.missing = missing.length;
  },
  valid: () => !steps.finish.missing,
  async save() {
    const r = await api.post('/api/finish-setup');
    if (!r.restartNeeded) { location.href = '/'; return; }
    $('#finish-status').replaceChildren(statusBox('busy', 'Restarting on the new address…', r.url));
    await api.post('/api/server/restart');
    await waitFor(r.url);
    location.href = r.url;
  },
};

// Wait until the restarted server answers (cross-port, so an opaque response is enough).
async function waitFor(url) {
  const until = Date.now() + 30000;
  await new Promise(r => setTimeout(r, 1200));
  while (Date.now() < until) {
    try { await fetch(url + '/api/ping', { mode: 'no-cors', cache: 'no-store' }); return; } catch {}
    await new Promise(r => setTimeout(r, 700));
  }
}

// ---------- start ----------
(async () => {
  $('#privacy').append(icon('shield', 16, 'var(--muted)', 1.75),
    h('span', null, 'Runs on this computer. Addresses and tokens are saved to ', h('span', { class: 'chip' }, 'config.json'), ' and only sent to the service they belong to.'));
  try { cfg = await api.get('/api/config'); } catch (e) { document.body.replaceChildren(h('p', { style: { padding: '40px' } }, 'Couldn’t reach the start page server: ' + e.message)); return; }
  applyAccent(accentHex(cfg));
  const first = params.get('step');
  history.replaceState({ step: first || 'welcome' }, '', location.search || '?step=welcome');
  go(steps[first] ? first : 'welcome', false);
})();
