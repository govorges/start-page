// Helpers shared by the dashboard, setup and settings pages.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Element builder. Strings become text nodes, so data from APIs is never parsed as HTML.
function h(tag, attrs, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

async function parse(res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const api = {
  get: url => fetch(url, { cache: 'no-store' }).then(parse),
  post: (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(parse),
};

// Icons are fixed strings in this file, never data.
const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 3L2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  alertDot: '<path d="M12 7v6M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  gh: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2V5z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5"/>',
  cloud: '<path d="M12 2v2M4.9 4.9l1.4 1.4M2 12h2M19.1 4.9l-1.4 1.4"/><path d="M16 12.5A4 4 0 0 0 8.2 11"/><path d="M8 20a4 4 0 0 1-.4-7.98A5 5 0 0 1 17 13.5a3.25 3.25 0 0 1 .5 6.5H8z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  term: '<path d="M4 17l6-5-6-5M12 19h8"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 21V9"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>',
  pr: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V10a3 3 0 0 0-3-3h-4"/><path d="M13 4.5 10.5 7 13 9.5"/>',
  issue: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5"/>',
  ciFail: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
  ci: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  release: '<path d="M3 12V3h9l9 9-9 9-9-9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  discussion: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
  dot: '<circle cx="12" cy="12" r="6"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
  loader: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloudOnly: '<path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5a4.75 4.75 0 0 1 .5 9.5H7z"/>',
  rain: '<path d="M7 16a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 6.5a4.75 4.75 0 0 1 .5 9.5H7z"/><path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2"/>',
  snow: '<path d="M7 16a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 6.5a4.75 4.75 0 0 1 .5 9.5H7z"/><path d="M9 19h.01M13 20h.01M17 19h.01"/>',
  storm: '<path d="M7 16a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 6.5a4.75 4.75 0 0 1 .5 9.5H7z"/><path d="M12 14l-2 4h4l-2 4"/>',
  fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
};
function icon(name, size = 16, color = 'currentColor', width = 2, extraClass = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${extraClass}">${ICONS[name] || ''}</svg>`;
  return t.content.firstChild;
}

function statusBox(kind, title, body) {
  const ic = { ok: 'check', err: 'x', warn: 'warn', info: 'info', busy: 'loader' }[kind];
  const col = { ok: 'var(--ok)', err: 'var(--err)', warn: 'var(--warn)', info: 'var(--info)', busy: 'var(--muted)' }[kind];
  return h('div', { class: `status ${kind}`, role: 'status' }, icon(ic, 16, col, 2.5, kind === 'busy' ? 'spin' : ''),
    h('div', null, h('div', { class: 't' }, title), body ? h('div', { class: 'b' }, body) : null));
}

// Rich text for status bodies: [['text'], ['chip', 'value'], ['b', 'bold']]
function rich(parts) {
  return parts.map(p => (typeof p === 'string' ? p : p[0] === 'chip' ? h('span', { class: 'chip' }, p[1]) : h('b', { class: 'ink', style: { fontWeight: 500 } }, p[1])));
}

function ago(date) {
  const m = (Date.now() - new Date(date)) / 60000;
  if (!Number.isFinite(m)) return '';
  if (m < 1) return 'now';
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 43200) return `${Math.round(m / 1440)}d`;
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const fmtTime = (d, clock24) => new Date(d).toLocaleTimeString(clock24 ? 'en-GB' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: !clock24 });
const fmtNum = n => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : Number(n).toLocaleString('en-US'));

// The accent setting as a color: 'auto' is orange for the installed app and green for the test copy.
const accentHex = cfg => (cfg.dashboard.accent === 'auto' ? cfg.envAccent : cfg.dashboard.accent);

// Sets the accent color, and the favicon to match (the server's /favicon.svg covers the first paint).
function applyAccent(hex) {
  if (!hex) return;
  document.documentElement.style.setProperty('--accent', hex);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${hex}"/><text x="16" y="22" font-family="monospace" font-size="15" font-weight="700" text-anchor="middle" fill="#0d0f14">~/</text></svg>`;
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

let toastTimer;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// A switch button: <button class="switch" role="switch" aria-checked>.
function bindSwitch(btn, onChange) {
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(on));
    onChange && onChange(on);
  });
}
const setSwitch = (btn, on) => btn.setAttribute('aria-checked', String(!!on));
const switchOn = btn => btn.getAttribute('aria-checked') === 'true';

// A segmented control: buttons with role=radio inside .seg.
function bindSeg(seg, onChange) {
  const buttons = $$('button', seg);
  buttons.forEach(b => b.addEventListener('click', () => {
    buttons.forEach(x => x.setAttribute('aria-checked', String(x === b)));
    onChange && onChange(b.dataset.value);
  }));
}
const setSeg = (seg, value) => $$('button', seg).forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === value)));

// A checkbox row. `plain` uses the regular font for the name (repository and feed names stay monospace).
function checkRow(id, name, desc, checked, plain) {
  const input = h('input', { type: 'checkbox', id, checked: checked ? 'checked' : null });
  input.checked = !!checked;
  return h('label', { class: 'check-row', for: id }, input,
    h('span', { class: 'box' }, icon('check', 12, 'var(--on-accent)', 3)),
    h('span', { class: 'txt' }, h('span', { class: 'n' + (plain ? ' plain' : '') }, name), desc ? h('span', { class: 'd' }, desc) : null));
}
