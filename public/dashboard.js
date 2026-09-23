// Dashboard: clock, weather, calendar, headlines and the GitHub panel.
let prefs = { dashboard: { sections: {}, clock24: false, seconds: false }, refresh: { github: 60, calendar: 120, weather: 900, news: 600 } };
const state = { github: null, events: [], inboxTab: 'all', newsTab: 'world', news: null };

// ---------- static icons ----------
$('#settings-link').append(icon('gear', 18, 'var(--text)', 1.75));
$('#wx-close').append(icon('x', 14, 'var(--text)', 2));
$('#gh-logo').append(icon('gh', 20, 'var(--ink)', 1.75));
$('#watch-icon').append(icon('eye', 14, 'var(--muted)', 2));

// ---------- clock ----------
function tick() {
  const d = new Date();
  const { clock24, seconds } = prefs.dashboard;
  const hh = clock24 ? String(d.getHours()).padStart(2, '0') : String(d.getHours() % 12 || 12);
  const mm = String(d.getMinutes()).padStart(2, '0');
  const clock = $('#clock');
  clock.textContent = `${hh}:${mm}`;
  if (seconds) clock.append(h('span', { class: 'sec' }, ':' + String(d.getSeconds()).padStart(2, '0')));
  if (!clock24) clock.append(h('small', null, d.getHours() < 12 ? 'AM' : 'PM'));
  $('#date').textContent = `${d.toLocaleDateString('en-US', { weekday: 'short' })} · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.getFullYear()}`;
  const part = d.getHours() < 5 ? 'Good evening' : d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const name = state.github && state.github.name ? state.github.name.split(' ')[0] : '';
  $('#greeting').textContent = name ? `${part}, ${name}` : part;
}

// ---------- weather ----------
const COND = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' };
const kind = c => (c <= 1 ? 'clear' : c <= 3 ? 'cloud' : c <= 48 ? 'fog' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow' : c >= 95 ? 'storm' : 'rain');
const KIND_ICON = { clear: 'sun', cloud: 'cloud', fog: 'fog', snow: 'snow', storm: 'storm', rain: 'rain' };
const PRECIP = { rain: 'Rain', snow: 'Snow', storm: 'Thunderstorms' };
const wet = k => k === 'rain' || k === 'snow' || k === 'storm';
const deg = n => Math.round(n) + '°';
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => { const e = document.createElementNS(SVG_NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

function setPanel(open) {
  $('#wx-chip').setAttribute('aria-expanded', String(open));
  $('#wx-panel').hidden = !open;
}
$('#wx-chip').addEventListener('click', () => setPanel($('#wx-panel').hidden));
$('#wx-close').addEventListener('click', () => { setPanel(false); $('#wx-chip').focus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#wx-panel').hidden) { setPanel(false); $('#wx-chip').focus(); } });
document.addEventListener('click', e => { if (!$('#wx-panel').hidden && !e.target.closest('.wx-anchor')) setPanel(false); });

async function loadWeather() {
  let w;
  try { w = await api.get('/api/weather'); } catch { $('#wx-chip-cond').textContent = 'Weather unavailable'; return; }
  if (!w.configured) return;
  const f = w.forecast, unit = w.units === 'celsius' ? 'C' : 'F';
  const k = kind(f.current.weather_code);
  $('#wx-chip').hidden = false;
  $('#wx-chip-icon').replaceChildren(icon(KIND_ICON[k], 20, 'var(--accent)', 1.75));
  $('#wx-chip-temp').textContent = deg(f.current.temperature_2m);
  $('#wx-chip-cond').textContent = COND[f.current.weather_code] || '';
  $('#wx-chip-hl').textContent = `H ${deg(f.daily.temperature_2m_max[0])} · L ${deg(f.daily.temperature_2m_min[0])}`;
  $('#wx-chip-alert').hidden = !w.alerts.length;
  $('#wx-chip').setAttribute('aria-label', `Weather: ${deg(f.current.temperature_2m)}${unit}, ${COND[f.current.weather_code] || ''}${w.alerts.length ? ', weather alert active' : ''}. Show details`);

  $('#wx-place').textContent = 'Weather · ' + (w.location.label || w.location.city);
  $('#wx-icon').replaceChildren(icon(KIND_ICON[k], 52, 'var(--accent)', 1.5));
  $('#wx-temp').textContent = deg(f.current.temperature_2m) + unit;
  $('#wx-cond').textContent = `${COND[f.current.weather_code] || ''} · feels like ${deg(f.current.apparent_temperature)}`;
  $('#wx-hi').textContent = 'H ' + deg(f.daily.temperature_2m_max[0]);
  $('#wx-lo').textContent = 'L ' + deg(f.daily.temperature_2m_min[0]);

  $('#wx-alerts').replaceChildren(...w.alerts.map(a => {
    const until = a.until ? ' until ' + new Date(a.until).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    const severe = a.severity !== 'Moderate';
    return h('div', { class: 'wx-alert' + (severe ? ' severe' : '') },
      icon('warn', 18, severe ? 'var(--err)' : 'var(--warn)', 2),
      h('div', null, h('b', null, a.event + until), h('span', { style: { color: 'var(--text)' } }, a.headline.replace(/^.*? issued .*? by /, 'Issued by '))));
  }));

  // Next 24 hours, starting at this hour.
  const nowKey = f.current.time.slice(0, 13);
  let i0 = f.hourly.time.findIndex(t => t.slice(0, 13) === nowKey);
  if (i0 < 0) i0 = 0;
  const hours = f.hourly.time.slice(i0, i0 + 24).map((t, j) => ({
    t, temp: f.hourly.temperature_2m[i0 + j], p: f.hourly.precipitation_probability[i0 + j], k: kind(f.hourly.weather_code[i0 + j]),
  }));
  if (hours.length) hours[0].temp = f.current.temperature_2m;

  const first = hours.find(x => x.p >= 40 && wet(x.k));
  const precip = $('#wx-precip');
  precip.replaceChildren(icon('drop', 16, 'var(--info)', 2));
  if (wet(k)) precip.append(h('span', null, h('b', null, PRECIP[k] + ' now'), ` · ${Math.max(...hours.slice(0, 6).map(x => x.p || 0))}% chance over the next few hours`));
  else if (first) precip.append(h('span', null, h('b', null, PRECIP[first.k] + ' likely'), ` · ${first.p}% chance, starting around ${new Date(first.t).toLocaleTimeString('en-US', { hour: 'numeric' })}`));
  else precip.append(h('span', null, h('b', null, 'No rain or snow expected'), ' in the next 24 hours'));

  renderHourly(hours, unit);

  const days = [];
  for (let i = 1; i <= 5 && i < f.daily.time.length; i++) {
    days.push({ day: new Date(f.daily.time[i] + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' }), hi: f.daily.temperature_2m_max[i], lo: f.daily.temperature_2m_min[i] });
  }
  const lo = Math.min(...days.map(d => d.lo)) - 2, hi = Math.max(...days.map(d => d.hi)) + 2;
  $('#wx-days').replaceChildren(...days.map(d => h('div', { class: 'day', 'aria-label': `${d.day}: high ${deg(d.hi)}, low ${deg(d.lo)}` },
    h('div', { class: 'ink' }, deg(d.hi)),
    h('div', { class: 'track', 'aria-hidden': 'true' }, h('div', { class: 'bar-range', style: {
      top: Math.round((1 - (d.hi - lo) / (hi - lo)) * 64) + 'px', height: Math.max(4, Math.round(((d.hi - d.lo) / (hi - lo)) * 64)) + 'px' } })),
    h('div', { class: 'muted' }, deg(d.lo)),
    h('div', { style: { color: 'var(--text)' } }, d.day))));
  $('#wx-updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function renderHourly(hours, unit) {
  const el = $('#hourly'), tip = $('#hourly-tip'), wrap = $('#hourly-wrap');
  el.replaceChildren();
  if (hours.length < 2) return;
  const W = 552, top = 22, bot = 98;
  const temps = hours.map(x => x.temp);
  const rawLo = Math.min(...temps), rawHi = Math.max(...temps), span = Math.max(rawHi - rawLo, 1);
  const lo = rawLo - span * 0.2, hi = rawHi + span * 0.3;
  const X = i => 4 + (i / (hours.length - 1)) * (W - 8);
  const Y = t => top + (1 - (t - lo) / (hi - lo)) * (bot - top);
  const peak = temps.indexOf(rawHi);
  el.setAttribute('aria-label', `Next 24 hours: ${deg(rawLo)} to ${deg(rawHi)}, warmest around ${new Date(hours[peak].t).toLocaleTimeString('en-US', { hour: 'numeric' })}`);

  for (const y of [top, bot]) el.append(svg('line', { x1: 4, x2: W - 4, y1: y, y2: y, stroke: 'rgba(255,255,255,.07)', 'stroke-width': 1 }));
  const line = hours.map((x, i) => `${X(i).toFixed(1)},${Y(x.temp).toFixed(1)}`).join(' ');
  el.append(svg('polygon', { points: `${X(0)},${bot} ${line} ${X(hours.length - 1)},${bot}`, fill: 'var(--accent)', 'fill-opacity': .12 }));
  el.append(svg('polyline', { points: line, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  const label = (x, y, text, anchor) => { const t = svg('text', { x, y, 'text-anchor': anchor, 'font-family': 'Fira Code, monospace', 'font-size': 11, 'font-weight': 500, fill: 'var(--ink)' }); t.textContent = text; el.append(t); };
  el.append(svg('circle', { cx: X(0), cy: Y(temps[0]), r: 4, fill: 'var(--accent)', stroke: 'var(--card)', 'stroke-width': 2 }));
  label(X(0) + 8, Y(temps[0]) - 10, deg(temps[0]), 'start');
  if (peak > 1) {
    el.append(svg('circle', { cx: X(peak), cy: Y(rawHi), r: 4, fill: 'var(--accent)', stroke: 'var(--card)', 'stroke-width': 2 }));
    label(X(peak), Y(rawHi) - 10, deg(rawHi), peak > hours.length - 3 ? 'end' : 'middle');
  }
  [0, 4, 8, 12, 16, 20, 23].filter(i => i < hours.length).forEach(i => {
    const t = svg('text', { x: X(i), y: 116, 'text-anchor': i === 0 ? 'start' : i === hours.length - 1 ? 'end' : 'middle', 'font-family': 'Fira Code, monospace', 'font-size': 10, fill: 'var(--muted)' });
    t.textContent = i === 0 ? 'Now' : new Date(hours[i].t).toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '').toLowerCase();
    el.append(t);
  });

  const cross = svg('line', { y1: top, y2: bot, stroke: 'var(--muted)', 'stroke-width': 1 });
  cross.style.display = 'none';
  el.append(cross);
  el.onpointermove = e => {
    const r = el.getBoundingClientRect();
    const i = Math.max(0, Math.min(hours.length - 1, Math.round(((e.clientX - r.left) / r.width * W - 4) / (W - 8) * (hours.length - 1))));
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.style.display = '';
    const x = hours[i];
    tip.replaceChildren(h('div', null, i === 0 ? 'Now' : new Date(x.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })),
      h('div', null, h('b', null, deg(x.temp) + unit), x.p != null ? ` · ${x.p}% rain/snow` : ''));
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    tip.style.left = (r.left - wr.left + X(i) / W * r.width) + 'px';
    tip.style.top = (r.top - wr.top + Y(x.temp) / 120 * r.height - 10) + 'px';
  };
  el.onpointerleave = () => { cross.style.display = 'none'; tip.hidden = true; };
}

// ---------- calendar ----------
$('#cal-refresh').append(icon('reset', 14, 'var(--text)', 2));
$('#cal-refresh').addEventListener('click', async () => {
  const btn = $('#cal-refresh');
  if (btn.getAttribute('aria-busy') === 'true') return;
  btn.setAttribute('aria-busy', 'true');
  btn.classList.add('busy');
  await loadCalendar(true);
  btn.classList.remove('busy');
  btn.removeAttribute('aria-busy');
});

// `force` asks the server to fetch the calendar again instead of using its cached copy.
async function loadCalendar(force) {
  const box = $('#events');
  let r;
  try { r = await api.get('/api/calendar' + (force === true ? '?refresh=1' : '')); } catch (e) {
    box.replaceChildren(h('div', { class: 'empty' }, 'Couldn’t load your calendar.'));
    if (force === true) toast('Couldn’t refresh the calendar');
    return;
  }
  if (r.fetchedAt) {
    const at = new Date(r.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    $('#cal-refresh').title = `Refresh calendar · last fetched ${at}`;
    if (force === true) toast(`Calendar refreshed · ${at}`);
  }
  if (r.configured === false) { box.replaceChildren(h('div', { class: 'empty' }, 'No calendar connected. ', h('a', { href: '/setup?step=calendar&from=dashboard' }, 'Connect one'))); return; }
  state.events = r.events;
  state.calendar = r;
  renderWeek(r);
  renderPills();
}

// "This week" (Sunday to Saturday) or "Next 7 days" (today onward); remembered in this browser.
let calMode = 'week';
try { if (localStorage.getItem('calendar-mode') === 'next') calMode = 'next'; } catch {}
function setCalMode(mode) {
  calMode = mode;
  $$('#cal-mode button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  try { localStorage.setItem('calendar-mode', mode); } catch {}
  if (state.calendar) renderWeek(state.calendar);
}
$$('#cal-mode button').forEach(b => b.addEventListener('click', () => setCalMode(b.dataset.mode)));
setCalMode(calMode);

// The current week, Sunday to Saturday: all-day events first, then timed ones; past days dimmed.
const WEEK_MAX = 4; // events shown per day before "+N more"
function renderWeek(r) {
  const box = $('#events');
  const now = new Date();
  // Columns are this browser's local days: from Sunday 00:00 ("This week") or today 00:00 ("Next 7 days").
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (calMode === 'week') start.setDate(start.getDate() - start.getDay());
  const day = i => { const d = new Date(start); d.setDate(d.getDate() + i); return d; };
  const end = day(6);
  const sameMonth = start.getMonth() === end.getMonth();
  $('#cal-title').textContent = `${calMode === 'week' ? 'This week' : 'Next 7 days'} · ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;

  // With more than one calendar, a colored dot says which one an event came from (fixed order, never cycled).
  const cals = [...new Set(r.events.map(e => e.calendar))];
  const calColor = name => (cals.length > 1 ? SLICE_COLORS[cals.indexOf(name) % SLICE_COLORS.length] : null);
  const clock24 = prefs.dashboard.clock24;

  const cols = Array.from({ length: 7 }, (_, i) => {
    const d0 = day(i), d1 = day(i + 1);
    const isToday = d0.toDateString() === now.toDateString();
    const isPast = d1 <= now;
    const list = r.events
      .filter(e => new Date(e.start) < d1 && new Date(e.end) > d0)
      .sort((a, b) => (b.allDay - a.allDay) || (new Date(a.start) - new Date(b.start)));
    const shown = list.slice(0, WEEK_MAX);
    const hidden = list.slice(WEEK_MAX);
    const items = shown.map(e => {
      const s = new Date(e.start), en = new Date(e.end);
      const live = !e.allDay && s <= now && en > now;
      const done = !e.allDay && en <= now;
      const when = e.allDay ? 'All day' : live ? 'Now' : fmtTime(s, clock24);
      const dot = calColor(e.calendar);
      return h('div', { class: 'wk-ev' + (e.allDay ? ' allday' : '') + (live ? ' now' : '') + (done ? ' done' : ''),
        title: `${e.title}\n${e.allDay ? 'All day' : `${fmtTime(s, clock24)} – ${fmtTime(en, clock24)}`}${e.location ? ' · ' + e.location : ''}${cals.length > 1 ? '\n' + e.calendar : ''}` },
        h('span', { class: 'tm' }, dot ? h('span', { class: 'cal-dot', style: { background: dot } }) : null, when),
        h('span', { class: 'tt' }, e.title));
    });
    if (hidden.length) {
      items.push(h('div', { class: 'wk-more', tabindex: '0',
        title: hidden.map(e => `${e.allDay ? 'All day' : fmtTime(new Date(e.start), clock24)}  ${e.title}`).join('\n') }, `+${hidden.length} more`));
    }
    if (!list.length) items.push(h('div', { class: 'wk-none' }, isPast ? '' : 'Free'));
    const name = d0.toLocaleDateString('en-US', { weekday: 'short' });
    return h('div', { class: 'wk-day' + (isToday ? ' today' : '') + (isPast ? ' past' : ''),
      role: 'group', 'aria-label': `${d0.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${isToday ? ', today' : ''}: ${list.length ? list.length + ' event' + (list.length === 1 ? '' : 's') : 'no events'}` },
      h('div', { class: 'wk-head', 'aria-hidden': 'true' }, h('span', null, name), h('b', null, d0.getDate())),
      ...items);
  });
  const extra = r.errors.length
    ? [h('div', { class: 'err-line' }, r.errors.length === 1 ? 'One calendar couldn’t be loaded. Check it in Settings.' : `${r.errors.length} calendars couldn’t be loaded. Check them in Settings.`)] : [];
  box.replaceChildren(...cols, ...extra);
}

// ---------- headlines ----------
$$('#news-tabs button').forEach(b => b.addEventListener('click', () => { state.newsTab = b.dataset.tab; renderNews(); }));
async function loadNews() {
  try { state.news = await api.get('/api/news'); } catch { $('#headlines').replaceChildren(h('div', { class: 'empty' }, 'Couldn’t load headlines.')); return; }
  const n = state.news;
  const hasWorld = n.apEnabled, hasLocal = n.local.length > 0 || n.localErrors.length > 0;
  $('#news-tabs').hidden = !(hasWorld && hasLocal);
  if (!hasWorld && hasLocal) state.newsTab = 'local';
  if (hasWorld && !hasLocal) state.newsTab = 'world';
  $('#news-title').textContent = !(hasWorld && hasLocal) ? (hasWorld ? 'Headlines · AP' : 'Headlines · Local') : 'Headlines';
  renderNews();
}
function renderNews() {
  const n = state.news;
  if (!n) return;
  $$('#news-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.newsTab)));
  const items = state.newsTab === 'world'
    ? n.ap.slice(0, 4).map(a => ({ label: a.category, title: a.title, link: a.link }))
    : n.local.slice(0, 4).map(a => ({ label: a.source, title: a.title, link: a.link }));
  const rows = items.map(i => h('a', { class: 'headline', href: i.link }, h('span', { class: 'c' }, i.label), h('span', { class: 't' }, i.title)));
  if (!rows.length) rows.push(h('div', { class: 'empty' }, state.newsTab === 'world' && !n.apEnabled ? 'Headlines are turned off.' : 'No headlines right now.'));
  if (state.newsTab === 'local' && n.localErrors.length) rows.push(h('div', { class: 'err-line' }, 'A news source couldn’t be loaded. Check it in Settings.'));
  $('#headlines').replaceChildren(...rows);
}

// ---------- GitHub ----------
function mix(a, b, t) {
  const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

async function loadGitHub() {
  let g;
  try { g = await api.get('/api/github'); } catch (e) { g = { configured: true, authError: e.message }; }
  state.github = g;
  const msg = $('#gh-msg');
  if (!g.configured || g.authError) {
    $('#gh-cols').hidden = true; $('#gh-user').hidden = true; $('#gh-unread').hidden = true;
    msg.hidden = false;
    msg.replaceChildren(g.configured
      ? statusBox('err', 'GitHub stopped responding to your token', rich([g.authError + ' ', ['chip', 'Settings'], ' → GitHub → Renew token.']))
      : statusBox('info', 'GitHub isn’t connected', rich(['Connect it to see notifications, pull requests and your activity. ', ['chip', 'Settings'], ' → Connections → GitHub.'])));
    if (prefs.local) msg.append(h('a', { class: 'btn btn-sm', href: '/setup?step=github&from=dashboard', style: { marginTop: '12px' } }, g.configured ? 'Renew token' : 'Connect GitHub'));
    return;
  }
  msg.hidden = true;
  tick();

  const user = $('#gh-user');
  user.hidden = false;
  user.href = 'https://github.com/' + encodeURIComponent(g.username);
  user.replaceChildren(g.avatar ? h('img', { src: g.avatar + (g.avatar.includes('?') ? '&' : '?') + 's=40', alt: '', width: 20, height: 20, referrerpolicy: 'no-referrer' }) : h('span', { class: 'ph' }), g.username);
  const unread = g.notifications.filter(n => n.unread).length;
  const u = $('#gh-unread');
  u.hidden = false;
  u.replaceChildren(icon('bell', 14, 'var(--muted)', 2), `${unread} unread`);

  renderContrib(g);
  renderInbox();
  renderPrs(g);
  renderCommits(g);
  renderRepos(g);
  applySections();
  renderPills();
  if (!act.data) loadActivity(); // first time GitHub is known to work
}

function renderContrib(g) {
  const c = g.contributions;
  state.contrib = c;
  state.heatWeeks = 0;
  if (!c) {
    $('#stats').replaceChildren(h('span', { class: 'muted' }, g.errors.overview || 'Couldn’t load contributions.'));
    $('#heat').replaceChildren();
    $('#heat-range').textContent = '';
    return;
  }
  // The numbers cover the whole year; the heatmap below shows as many recent weeks as fit the column.
  $('#stats').replaceChildren(...[[fmtNum(c.total), 'past year'], [c.streak, 'day streak'], [fmtNum(c.merged), 'PRs merged'], [c.week, 'this week']]
    .map(([v, l]) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l))));
  drawHeat();
  if (!state.heatObserver && window.ResizeObserver) {
    state.heatObserver = new ResizeObserver(() => drawHeat());
    state.heatObserver.observe($('#heat'));
  }
}

const HEAT_STEP = 14; // 11px cell + 3px gap
function drawHeat() {
  const c = state.contrib;
  if (!c) return;
  const fit = Math.floor(($('#heat').clientWidth + 3) / HEAT_STEP);
  const n = Math.max(8, Math.min(c.weeks.length, fit || c.weeks.length));
  if (n === state.heatWeeks) return;
  state.heatWeeks = n;
  const weeks = c.weeks.slice(-n);
  const monthsShown = Math.max(1, Math.round(n * 7 / 30.4));
  $('#heat-range').textContent = n >= c.weeks.length ? 'last 12 months' : `last ${monthsShown} month${monthsShown === 1 ? '' : 's'}`;

  const accent = prefs.dashboard.accent, card = '#0e1725';
  const ramp = { NONE: mix(card, '#ffffff', .06), FIRST_QUARTILE: mix(card, accent, .3), SECOND_QUARTILE: mix(card, accent, .52), THIRD_QUARTILE: mix(card, accent, .76), FOURTH_QUARTILE: accent };
  const grid = h('div', { class: 'grid', 'aria-hidden': 'true' });
  const months = h('div', { class: 'months', 'aria-hidden': 'true' });
  let lastMonth = -1;
  weeks.forEach((w, wi) => {
    const m = new Date(w[0].date + 'T12:00').getMonth();
    if (m !== lastMonth && wi < weeks.length - 2) {
      if (lastMonth !== -1 || new Date(w[0].date + 'T12:00').getDate() <= 7) {
        months.append(h('span', { style: { left: wi * HEAT_STEP + 'px' } }, new Date(w[0].date + 'T12:00').toLocaleDateString('en-US', { month: 'short' })));
      }
      lastMonth = m;
    }
    w.forEach((d, di) => {
      const date = new Date(d.date + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      grid.append(h('div', { class: 'cell', title: `${d.count} contribution${d.count === 1 ? '' : 's'} on ${date}`,
        style: { background: ramp[d.level] || ramp.NONE, gridRow: String(new Date(d.date + 'T12:00').getDay() + 1) } }));
    });
  });
  const legend = h('div', { class: 'legend', 'aria-hidden': 'true' }, h('span', { style: { marginRight: '4px' } }, 'Less'),
    ...Object.values(ramp).map(col => h('div', { class: 'cell', style: { background: col } })), h('span', { style: { marginLeft: '4px' } }, 'More'));
  // The inner box hugs the grid so the legend lines up with it; #heat itself stays full width for measuring.
  $('#heat').replaceChildren(h('div', { class: 'heat-inner' }, months, grid, legend),
    h('p', { class: 'sr-only' }, `${c.total} contributions in the last year, ${c.week} this week, ${c.streak}-day streak.`));
}

const NOTE_ICON = { pr: ['pr', 'var(--ok)'], issue: ['issue', 'var(--info)'], release: ['release', 'var(--text)'], discussion: ['discussion', 'var(--text)'], other: ['bell', 'var(--muted)'] };
function renderInbox() {
  const g = state.github;
  if (!g || !g.notifications) return;
  const all = g.notifications;
  const tabs = [['all', 'All'], ['reviews', 'Reviews'], ['mentions', 'Mentions'], ['ci', 'CI'], ['releases', 'Releases']];
  $('#inbox-tabs').replaceChildren(...tabs.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.inboxTab === id),
    onclick: () => { state.inboxTab = id; renderInbox(); } },
    label, h('span', { class: 'n' }, id === 'all' ? all.length : all.filter(n => n.cat === id).length))));
  const list = all.filter(n => state.inboxTab === 'all' || n.cat === state.inboxTab).slice(0, 8);
  const rows = list.map(n => {
    const failed = n.reason === 'CI failed';
    const [ic, col] = n.type === 'ci' ? (failed ? ['ciFail', 'var(--err)'] : ['ci', 'var(--text)']) : NOTE_ICON[n.type] || NOTE_ICON.other;
    // One line: title, then where it's from, why you got it and when. The full title shows on hover.
    const a = h('a', { class: 'note' + (n.unread ? ' unread' : ''), href: n.url, title: `${n.title}\n${n.repo} ${n.num}` },
      h('span', { class: 'ud', 'aria-hidden': 'true' }),
      h('span', { class: 'ic' }, icon(ic, 15, col, 1.75)),
      h('span', { class: 't' }, n.title),
      h('span', { class: 'repo' }, n.repo.split('/')[1] + (n.num ? ' ' + n.num : '')),
      h('span', { class: 'tag' + (failed ? ' fail' : n.cat === 'reviews' ? ' review' : '') }, n.reason),
      h('time', { datetime: n.updated }, ago(n.updated)));
    a.setAttribute('aria-label', `${n.unread ? 'Unread: ' : ''}${n.title}, ${n.repo} ${n.num}, ${n.reason}, ${ago(n.updated)} ago`);
    a.addEventListener('click', () => { if (n.unread) fetch('/api/github/read', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id }) }).catch(() => {}); });
    return a;
  });
  if (!rows.length) rows.push(h('div', { class: 'empty' }, state.inboxTab === 'all' ? 'You’re all caught up.' : 'Nothing here.'));
  if (g.errors && g.errors.notifications) rows.unshift(h('div', { class: 'err-line' }, 'Notifications: ' + g.errors.notifications));
  $('#notes').replaceChildren(...rows);
}
$('#mark-all').addEventListener('click', async () => {
  try { await api.post('/api/github/read', {}); toast('Marked all as read'); loadGitHub(); } catch (e) { toast(e.message); }
});

function renderPrs(g) {
  const p = g.prs;
  $('#pr-count').textContent = p ? p.total : '';
  const CHECK = { pass: ['check', 'var(--ok)', 'Passing'], fail: ['x', 'var(--err)', 'Failing'], running: ['dot', 'var(--warn)', 'Running'], none: [null, 'var(--muted)', 'No checks'] };
  const rows = (p ? p.items : []).map(pr => {
    const [ic, col, label] = CHECK[pr.checks];
    return h('a', { class: 'pr', href: pr.url, title: pr.title },
      h('div', { class: 'top' }, h('div', { class: 't' }, pr.title),
        h('div', { class: 'diff' }, h('span', { style: { color: 'var(--ok)' } }, '+' + pr.additions), ' ', h('span', { style: { color: 'var(--err)' } }, '−' + pr.deletions))),
      h('div', { class: 'meta' }, h('span', null, `${pr.repo.split('/')[1]} #${pr.number}`),
        h('span', { class: 'checks', style: { color: col } }, ic ? icon(ic, 12, col, 3) : null, label),
        pr.review ? h('span', null, pr.review) : null));
  });
  if (!rows.length) rows.push(h('div', { class: 'empty' }, p ? 'No open pull requests.' : g.errors.overview || 'Couldn’t load pull requests.'));
  $('#prs').replaceChildren(...rows);
}

// Commits are joined by a line only when the newer one is a direct child of the next one in the list.
const isChildOf = (a, b) => !!(a && b && a.repo === b.repo && (a.parents || []).includes(b.id));

function renderCommits(g) {
  const list = g.commits;
  // One line per commit: message, then short SHA, repository and age. The full message shows on hover.
  const rows = list.map((c, i) => h('a', { class: 'commit' + (isChildOf(list[i - 1], c) ? '' : ' chain-start'), href: c.url, title: `${c.message}\n${c.repo} · ${c.sha}` },
    h('span', { class: 'rail', 'aria-hidden': 'true' },
      h('i', { class: isChildOf(list[i - 1], c) ? 'on' : null }), h('b'), h('i', { class: isChildOf(c, list[i + 1]) ? 'on' : null })),
    h('span', { class: 'm' }, c.message),
    h('span', { class: 'meta' }, h('span', { class: 'sha' }, c.sha), h('span', null, c.repo.split('/')[1]), h('span', null, ago(c.date)))));
  if (!rows.length) rows.push(h('div', { class: 'empty', style: { margin: '0 -20px' } }, g.errors.commits || 'No recent commits on default branches.'));
  $('#commits').replaceChildren(...rows);
}

function renderRepos(g) {
  const rows = (g.repos || []).map(r => h('a', { class: 'repo-row', href: r.url },
    h('div', { class: 'top' }, h('span', { class: 'n' }, r.name), r.release ? h('span', { class: 'tag' }, r.release) : null),
    r.description ? h('div', { class: 'd' }, r.description) : null,
    h('div', { class: 'meta' }, h('span', null, icon('star', 11, 'var(--muted)', 2), fmtNum(r.stars)),
      h('span', null, `${r.openPrs} PR${r.openPrs === 1 ? '' : 's'}`), h('span', null, 'pushed ' + ago(r.pushedAt)))));
  if (!rows.length) rows.push(h('div', { class: 'empty' }, 'No repositories chosen. ', prefs.local ? h('a', { href: '/setup?step=github&from=dashboard' }, 'Choose some') : null));
  $('#repos').replaceChildren(...rows);
}

// ---------- activity: small charts for watched repositories, and for people and organizations you follow ----------
const ACT_UNITS = { commits: ['commits', 'commit'], prs: ['PRs opened', 'PR opened'], issues: ['issues opened', 'issue opened'] };
const PEOPLE_UNITS = { user: ['contributions', 'contribution', 'contrib.'], org: ['public events', 'public event', 'events'] };
const act = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('activity-view')) || {}; } catch {}
  return {
    view: saved.view === 'people' ? 'people' : 'repos',
    metric: ACT_UNITS[saved.metric] ? saved.metric : 'commits',
    range: [7, 30, 90].includes(saved.range) ? saved.range : 30,
    data: null, people: null,
  };
})();
const saveActView = () => { try { localStorage.setItem('activity-view', JSON.stringify({ view: act.view, metric: act.metric, range: act.range })); } catch {} };
setSeg($('#act-metric'), act.metric);
setSeg($('#act-range'), String(act.range));
bindSeg($('#act-metric'), v => { act.metric = v; saveActView(); renderActivity(); });
bindSeg($('#act-range'), v => { act.range = Number(v); saveActView(); renderActivity(); });
$$('#act-view button').forEach(b => b.addEventListener('click', () => {
  act.view = b.dataset.view;
  saveActView();
  if (act.view === 'people' && !act.people) loadPeople(); else renderActivity();
}));

const githubReady = () => state.github && state.github.configured && !state.github.authError && prefs.dashboard.sections.activity;
async function loadActivity() {
  if (!githubReady()) return;
  try { act.data = await api.get('/api/github/activity'); } catch (e) { act.data = { error: e.message }; }
  renderActivity();
  if (act.data && act.data.pending) setTimeout(loadActivity, 30000); // GitHub is still counting commits
  if (act.view === 'people') loadPeople();
}
async function loadPeople() {
  if (!githubReady()) return;
  try { act.people = await api.get('/api/github/people'); } catch (e) { act.people = { error: e.message }; }
  renderActivity();
}

// Day `ago` (0 = today, in UTC like GitHub's dates) as a short local label.
function actDate(today, ago, withDay) {
  const d = new Date(Date.parse(today) - ago * 86400e3 + 12 * 3600e3);
  return d.toLocaleDateString('en-US', withDay ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
}
const sumRange = (arr, from, to) => arr.slice(from, to).reduce((a, b) => a + b, 0);

// A bar chart for a daily series (oldest → today) with a hover tooltip.
// Ranges over 30 days are grouped into weeks so each bar stays wide enough to read.
// Releases ({ ago, tag, url, pre, date }) get a flag above the bars on their exact day, with the newest one labeled.
function actChart({ today, series, range, unit, unitOne, label, releases = null }) {
  const size = range > 30 ? 7 : 1;
  const buckets = []; // [start, end) indices into series; the last bucket ends today, the first may be shorter
  for (let end = series.length; end > 0; end -= size) {
    const start = Math.max(0, end - size);
    buckets.unshift({ start, end, v: sumRange(series, start, end) });
  }
  const peak = Math.max(1, ...buckets.map(b => b.v));
  const per = size > 1 ? 'week' : 'day';
  const x = i => ((i + 0.5) / range) * 100; // % across the chart for series index i
  const inRange = (releases || []).filter(r => r.ago < range); // newest first
  const tip = h('div', { class: 'act-tip', hidden: true });

  const cols = buckets.map(b => {
    const col = h('div', { class: 'act-col' }, h('div', { class: 'act-bar', style: { height: b.v ? Math.max(2, Math.round(b.v / peak * 100)) + '%' : '0' } }));
    col.addEventListener('mouseenter', () => {
      const when = size === 1 ? actDate(today, range - 1 - b.start, true)
        : `${actDate(today, range - 1 - b.start)} – ${actDate(today, range - b.end)}`;
      const shipped = inRange.filter(r => { const i = range - 1 - r.ago; return i >= b.start && i < b.end; });
      tip.replaceChildren(h('div', null, when), h('div', null, h('b', null, b.v), ' ', b.v === 1 ? unitOne : unit),
        ...shipped.map(r => h('div', null, 'Released ', h('b', null, r.tag), r.pre ? ' (pre-release)' : '')));
      tip.style.left = ((b.start + b.end) / 2 / range * 100) + '%';
      tip.hidden = false;
    });
    col.addEventListener('mouseleave', () => { tip.hidden = true; });
    return col;
  });

  // A hairline at half the peak, labeled, so bar heights can be read as numbers.
  // A hairline at half the peak; the scale on the right labels it and the top.
  const half = peak / 2;
  const gridline = peak >= 2 ? h('div', { class: 'act-gridline', 'aria-hidden': 'true' }) : null;
  const scale = h('div', { class: 'act-scale', 'aria-hidden': 'true' }, h('span', null, peak), peak >= 2 ? h('span', null, Number.isInteger(half) ? half : half.toFixed(1)) : h('span'), h('span', null, 0));
  const lines = inRange.map(r => h('div', { class: 'rel-line', 'aria-hidden': 'true', style: { left: x(range - 1 - r.ago) + '%' } }));

  let lane = null;
  if (releases) {
    lane = h('div', { class: 'rel-lane' }, ...inRange.map(r => {
      const pos = x(range - 1 - r.ago);
      return h('a', { class: 'rel-flag' + (r.pre ? ' pre' : ''), href: r.url, style: { left: pos + '%' },
        title: `${r.tag}${r.pre ? ' (pre-release)' : ''} · ${actDate(today, r.ago, true)}`,
        'aria-label': `Release ${r.tag}${r.pre ? ', pre-release' : ''}, ${actDate(today, r.ago, true)}` },
        h('span', { class: 'rel-dot' }));
    }));
  }

  const bars = h('div', { class: 'act-bars', role: 'img',
    'aria-label': `${label}: ${sumRange(series, 0, series.length)} ${unit} in the last ${range} days, at most ${peak} in a ${per}${inRange.length ? `, ${inRange.length} release${inRange.length === 1 ? '' : 's'}` : ''}` },
    gridline, ...lines, ...cols, tip);
  return h('div', { class: 'act-chart' },
    h('div', { class: 'meta' }, h('span', null, `${unit} per ${per}`), h('span', null, inRange.length ? `${inRange.length} release${inRange.length === 1 ? '' : 's'}` : '')),
    lane, h('div', { class: 'act-plot' }, bars, scale),
    h('div', { class: 'axis' }, h('span', null, actDate(today, range - 1)), h('span', null, actDate(today, Math.floor((range - 1) / 2))), h('span', null, 'Today')));
}

// '6d ago' for recent dates, 'on Mar 7' for older ones.
const since = date => ((Date.now() - new Date(date)) / 864e5 < 30 ? ago(date) + ' ago' : 'on ' + ago(date));

function deltaEl(total, prev, range) {
  if (prev == null) return h('span', { class: 'delta' });
  if (prev === 0) return h('span', { class: 'delta' }, total ? 'new activity' : '');
  const pct = Math.round((total - prev) / prev * 100);
  return h('span', { class: 'delta' + (pct > 0 ? ' up' : '') }, pct !== 0 ? icon(pct > 0 ? 'arrowUp' : 'arrowDown', 10, pct > 0 ? 'var(--ok)' : 'var(--text)', 3) : null,
    `${Math.abs(pct)}% vs prev ${range}d`);
}

function activityMessage(text) {
  $('#act-sub').textContent = '';
  $('#act-grid').replaceChildren(h('div', { class: 'act-empty' }, text));
}

function renderActivity() {
  applySections();
  if ($('#activity').hidden) return;
  $$('#act-view button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === act.view)));
  $('#act-metric').hidden = act.view === 'people';
  if (act.view === 'people') renderPeople(); else renderRepoActivity();
  $('#act-updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function renderRepoActivity() {
  const d = act.data;
  $('#act-foot-note').textContent = 'Each chart has its own scale. Flags mark releases (hollow: pre-release). 90-day charts group days into weeks. Commits count the default branch.';
  if (!d) return activityMessage('Loading…');
  if (d.error) return activityMessage('Couldn’t load repository activity: ' + d.error);
  if (!d.configured || !d.repos.length) return activityMessage('Choose repositories to follow in Settings → Connections → GitHub to see their activity.');
  const { metric, range } = act;
  const [unit, unitOne] = ACT_UNITS[metric];
  const rows = d.repos.map((r, i) => {
    const cov = r.coverage[metric];
    const total = sumRange(r[metric], 0, range);
    const partial = cov < range; // a busy repository: only its latest 100 items were fetched
    return { r, i, cov, total, partial, shown: total.toLocaleString('en-US') + (partial ? '+' : ''),
      prev: cov >= range * 2 ? sumRange(r[metric], range, range * 2) : null,
      unavailable: metric === 'commits' && r.commitsStatus !== 'ok' };
  });
  const all = rows.reduce((a, x) => a + x.total, 0);
  $('#act-sub').textContent = `${all.toLocaleString('en-US')}${rows.some(x => x.partial) ? '+' : ''} ${all === 1 ? unitOne : unit} across ${rows.length} repositor${rows.length === 1 ? 'y' : 'ies'} in the last ${range} days`;


  $('#act-grid').replaceChildren(...rows.map(x => {
    const { r } = x;
    const shipped = r.releases.filter(v => v.ago < range);
    const newest = r.releases[0] || r.latest; // newest in the last 180 days, else the latest full release
    let note = null;
    if (x.unavailable) note = r.commitsStatus === 'pending' ? 'GitHub is still counting commits for this repository. Check back in a minute.' : 'Commit history isn’t available for this repository.';
    else if (x.partial) note = `Busy repository: only the latest 100 are counted, which covers ${x.cov} day${x.cov === 1 ? '' : 's'}.`;
    else if (!x.total) note = `No ${unit} in the last ${range} days.`;
    return h('div', { class: 'act-card' },
      h('div', { class: 'top' }, h('a', { class: 'name', href: r.url }, r.name), h('span', { class: 'pushed' }, 'pushed ' + ago(r.pushedAt))),
      h('div', { class: 'figure' }, h('span', { class: 'total' }, x.unavailable ? '–' : x.shown), h('span', { class: 'unit' }, `${unit} in ${range}d`),
        x.unavailable ? null : deltaEl(x.total, x.prev, range)),
      h('div', { class: 'rel-latest' }, icon('release', 13, 'var(--accent)', 2),
        newest ? [h('span', null, 'Latest release '), h('a', { href: newest.url }, newest.tag), newest.pre ? h('span', { class: 'kind' }, 'pre') : null,
          h('span', { class: 'when' }, since(newest.date))]
          : h('span', null, 'No releases yet')),
      note ? h('div', { class: 'act-note' + (x.total || x.unavailable || x.partial ? '' : ' quiet') }, note)
        : actChart({ today: d.today, series: r[metric].slice(0, range).reverse(), range, unit, unitOne, label: r.name, releases: r.releases }),
      h('div', { class: 'act-stats' },
        h('span', null, h('b', null, sumRange(r.merged, 0, range)), ' PRs merged'),
        h('span', null, h('b', null, sumRange(r.closed, 0, range)), ' issues closed'),
        h('span', null, h('b', null, shipped.length), ` release${shipped.length === 1 ? '' : 's'}`)));
  }));
}

const avatarEl = (a, size) => h('img', { class: 'act-avatar' + (a.type === 'org' ? ' org' : ''), alt: '', referrerpolicy: 'no-referrer',
  src: a.avatar + (a.avatar.includes('?') ? '&' : '?') + 's=' + size * 2 });

// Donut of where an account's activity went, by repository.
// Categorical slots, validated against the card surface; used in this fixed order and never cycled.
// Past four repositories the rest fold into a neutral "Other".
const SLICE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'];
const OTHER_COLOR = '#5f6a82';
function repoDonut(split, unit, label, owner) {
  // Repositories the account owns are shown by name alone; others keep their owner.
  const short = repo => (owner && repo.toLowerCase().startsWith(owner.toLowerCase() + '/') ? repo.slice(owner.length + 1) : repo);
  const total = split.reduce((s, x) => s + x.count, 0);
  const slices = split.slice(0, 4).map((x, i) => ({ ...x, color: SLICE_COLORS[i] }));
  const restCount = split.length - slices.length;
  if (restCount > 0) {
    slices.push({ repo: `${restCount} other repositor${restCount === 1 ? 'y' : 'ies'}`, url: null, other: true, color: OTHER_COLOR,
      count: split.slice(4).reduce((s, x) => s + x.count, 0) });
  }
  const R = 40, W = 14, C = 2 * Math.PI * R;
  const GAP = slices.length > 1 ? 2 : 0; // a sliver of card color between slices
  const ring = svg('svg', { viewBox: '0 0 100 100', width: 100, height: 100, class: 'donut', 'aria-hidden': 'true' });
  ring.append(svg('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: 'rgba(255,255,255,.05)', 'stroke-width': W }));
  let offset = 0;
  const arcs = slices.map(s => {
    const len = (s.count / total) * C;
    const arc = svg('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: s.color, 'stroke-width': W, class: 'slice',
      'stroke-dasharray': `${Math.max(len - GAP, 0.75)} ${C}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 50 50)' });
    offset += len;
    ring.append(arc);
    return arc;
  });
  const center = h('div', { class: 'donut-center' });
  const showTotal = () => center.replaceChildren(h('b', null, total.toLocaleString('en-US')),
    h('span', null, `in ${split.length} repo${split.length === 1 ? '' : 's'}`));
  showTotal();

  const legend = h('ul', { class: 'donut-legend' }, ...slices.map((s, i) => {
    const pct = Math.round((s.count / total) * 100);
    const row = h('li', null,
      h('span', { class: 'sw', style: { background: s.color } }),
      s.url ? h('a', { class: 'r', href: s.url, title: s.repo }, short(s.repo)) : h('span', { class: 'r' }, s.repo),
      h('span', { class: 'v' }, s.count.toLocaleString('en-US')),
      h('span', { class: 'p' }, pct + '%'));
    // Hovering a slice or its legend row highlights both and puts the share in the middle.
    const on = () => {
      arcs.forEach((a, j) => a.classList.toggle('dim', j !== i));
      row.classList.add('hot');
      center.replaceChildren(h('b', null, pct + '%'), h('span', null, s.other ? 'other' : short(s.repo).split('/').pop()));
    };
    const off = () => { arcs.forEach(a => a.classList.remove('dim')); row.classList.remove('hot'); showTotal(); };
    for (const el of [row, arcs[i]]) { el.addEventListener('mouseenter', on); el.addEventListener('mouseleave', off); }
    return row;
  }));
  return h('div', { class: 'donut-wrap', role: 'group', 'aria-label': `${label}: ${unit} by repository` },
    h('div', { class: 'donut-box' }, ring, center), legend);
}

function renderPeople() {
  const d = act.people;
  $('#act-foot-note').textContent = 'Each ring shows an account’s four busiest repositories, with the rest as Other. People: contributions, with private repositories not split out. Organizations: public events, which GitHub keeps for 90 days.';
  if (!d) return activityMessage('Loading…');
  if (d.error) return activityMessage('Couldn’t load activity for people and organizations: ' + d.error);
  if (!d.configured || !d.accounts.length) return activityMessage('Choose people and organizations to follow in Settings → Connections → GitHub to see their activity.');
  const { range } = act;
  const rows = d.accounts.map((a, i) => {
    const total = sumRange(a.series, 0, range);
    const partial = a.coverage < range;
    return { a, i, total, partial, units: PEOPLE_UNITS[a.type],
      shown: total.toLocaleString('en-US') + (partial ? '+' : ''),
      prev: a.coverage >= range * 2 ? sumRange(a.series, range, range * 2) : null };
  });
  const people = rows.filter(x => x.a.type === 'user'), orgs = rows.filter(x => x.a.type === 'org');
  const part = (list, one, many, unit) => (list.length
    ? `${list.reduce((s, x) => s + x.total, 0).toLocaleString('en-US')}${list.some(x => x.partial) ? '+' : ''} ${unit} from ${list.length} ${list.length === 1 ? one : many}` : '');
  $('#act-sub').textContent = [part(people, 'person', 'people', 'contributions'), part(orgs, 'organization', 'organizations', 'public events')]
    .filter(Boolean).join(' · ') + ` in the last ${range} days`;


  $('#act-grid').replaceChildren(...rows.map(x => {
    const { a } = x;
    const [unit] = x.units;
    const split = (a.byRepo && a.byRepo[range]) || [];
    const splitTotal = split.reduce((s, r) => s + r.count, 0);
    const notes = [];
    if (x.partial && a.type === 'org') {
      notes.push(h('div', { class: 'act-note' }, `GitHub keeps ${a.coverage < 90 ? `only the latest 300 events, which cover ${a.coverage} days` : '90 days of public events'}, so this is a partial count.`));
    }
    const unsplit = a.type === 'user' ? x.total - splitTotal : 0;
    if (splitTotal && unsplit > 0) notes.push(h('div', { class: 'act-note quiet' }, `Plus ${unsplit.toLocaleString('en-US')} in private repositories or not tied to one.`));
    const body = splitTotal ? repoDonut(split, unit, a.name || a.login, a.login)
      : h('div', { class: 'act-note quiet' }, x.total ? `All of these ${unit} were in private repositories, so they can’t be split by repository.` : `No ${unit} in the last ${range} days.`);
    return h('div', { class: 'act-card' },
      h('div', { class: 'top' },
        h('span', { class: 'who' }, avatarEl(a, 22), h('a', { class: 'name', href: a.url }, a.name || a.login), a.name ? h('span', { class: 'login' }, a.login) : null),
        h('span', { class: 'kind' }, a.type === 'org' ? 'Org' : 'Person')),
      h('div', { class: 'figure' }, h('span', { class: 'total' }, x.shown), h('span', { class: 'unit' }, `${unit} in ${range}d`), deltaEl(x.total, x.prev, range)),
      body, ...notes);
  }));
}

// ---------- summary pills ----------
function renderPills() {
  const pills = [];
  const g = state.github;
  if (g && g.notifications) {
    const reviews = g.notifications.filter(n => n.unread && n.cat === 'reviews').length;
    pills.push(h('a', { class: 'pill', href: '#col-inbox', onclick: () => { state.inboxTab = 'reviews'; renderInbox(); } },
      h('span', { class: 'sq', style: { background: 'var(--accent)' } }),
      h('span', null, reviews ? [h('b', null, reviews), ` review${reviews === 1 ? '' : 's'} waiting`] : 'No reviews waiting')));
  }
  if (prefs.connected && prefs.connected.calendar) {
    const today = new Date().toDateString();
    const meetings = state.events.filter(e => !e.allDay && new Date(e.start).toDateString() === today && new Date(e.end) > Date.now()).length;
    pills.push(h('a', { class: 'pill', href: '#cal-card' }, h('span', { class: 'sq', style: { background: 'var(--info)' } }),
      h('span', null, meetings ? [h('b', null, meetings), ` more meeting${meetings === 1 ? '' : 's'} today`] : 'No more meetings today')));
  }
  if (g && g.prs) {
    const failing = g.prs.items.filter(p => p.checks === 'fail').length;
    if (failing) pills.push(h('a', { class: 'pill bad', href: '#col-mid' }, icon('x', 12, 'var(--err)', 2.5), h('span', null, h('b', null, failing), ` failing check${failing === 1 ? '' : 's'}`)));
  }
  $('#pills').replaceChildren(...pills);
}

// ---------- layout from preferences ----------
function applySections() {
  const s = prefs.dashboard.sections;
  $('#cal-card').hidden = !s.calendar;
  $('#news-card').hidden = !s.headlines;
  const g = state.github, ok = g && g.configured && !g.authError;
  $('#col-contrib').hidden = !s.contributions;
  $('#col-inbox').hidden = !s.inbox;
  $('#col-mid').hidden = !s.prs;
  $('#col-watch').hidden = !s.watching;
  $('#gh-cols').hidden = !(ok && (s.contributions || s.inbox || s.prs || s.watching));
  $('#activity').hidden = !(ok && s.activity);
  $('#gh').hidden = !(s.contributions || s.inbox || s.prs || s.watching || s.activity);
}

// ---------- start ----------
function every(seconds, fn) {
  fn();
  let last = Date.now();
  setInterval(() => { if (!document.hidden) { last = Date.now(); fn(); } }, seconds * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - last > seconds * 1000) { last = Date.now(); fn(); } });
}

(async () => {
  try { prefs = await api.get('/api/prefs'); } catch {}
  applyAccent(prefs.dashboard.accent);
  $('#settings-link').hidden = !prefs.local;
  applySections();
  tick();
  setInterval(tick, 1000);
  const r = prefs.refresh;
  every(r.weather, loadWeather);
  every(r.calendar, loadCalendar);
  every(r.news, loadNews);
  every(r.github, loadGitHub);
  setInterval(() => { if (!document.hidden) loadActivity(); }, 15 * 60 * 1000); // daily charts change slowly
})();
