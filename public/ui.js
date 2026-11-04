// Shared pieces for every page: the theme, the shell (sidebar on a PC, tab bar on
// a phone, top bar), number formatting and the charts. Charts are plain HTML/CSS
// where they can be, so they scale from a 390 px phone to a 1920 px wall screen.

// ---------- theme: dark by default, light on request, remembered ----------
const stored = () => { try { return localStorage.getItem('dk-theme'); } catch { return null; } };
const asked = new URLSearchParams(location.search).get('theme');
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('dk-theme', t); } catch { /* private mode */ }
}
document.documentElement.dataset.theme = asked === 'light' || asked === 'dark' ? asked : stored() || 'dark';
export const theme = () => document.documentElement.dataset.theme;

// ---------- small helpers ----------
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
export const n1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
export const pct = (v) => (v == null ? '—' : `${n1(v)}`);
export const tone = (v) => (v == null ? 'none' : v >= 85 ? 'good' : v >= 60 ? 'ok' : 'bad');
export const hm = (iso) => String(iso || '').slice(11, 16);
export const mins = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`);
export const ago = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
};

export async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 401 && !path.startsWith('/api/auth') && !path.startsWith('/api/login') && !path.startsWith('/api/invite') && !path.startsWith('/api/ack')) {
    location.href = '/login.html'; return new Promise(() => {});
  }
  return r.json();
}
export const postJson = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

export function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}

// ---------- shell ----------
const I = {
  live: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>',
  machine: '<svg viewBox="0 0 24 24"><path d="M3 18V9l5 3V9l5 3V6h4l4 3v9z"/><path d="M3 21h18"/></svg>',
  quality: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  history: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  qr: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h2v2h-2zM19 15h2v2M15 19h2v2M19 19h2v2"/></svg>',
  sensor: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0"/><circle cx="12" cy="12" r="1.3"/><path d="M12 14v7"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
};
export const icon = I;
// [href, label, icon, adminOnly]
const NAV = [
  ['Monitor', [['/', 'Live floor', 'live'], ['/machine.html', 'Machines', 'machine'], ['/quality.html', 'Quality and OEE', 'quality'], ['/history.html', 'History', 'history']]],
  ['Manage', [['/escalations.html', 'Escalations', 'bell'], ['/qr.html', 'QR labels', 'qr'], ['/sensors.html', 'Sensors', 'sensor', true], ['/settings.html', 'Settings', 'gear', true], ['/users.html', 'People', 'people', true], ['/about.html', 'How it works', 'help']]],
];
const TITLES = { '': '', '/account.html': 'My account' };

export async function mountHeader({ active = '', clock = true, me = undefined, plant = 'Evernu Plastics', title = null, sub = null, conn = clock } = {}) {
  if (me === undefined) {
    try { me = (await fetch('/api/me').then(r => r.json())).user; } catch { me = null; }
  }
  const main = $('main') || document.body.appendChild(document.createElement('main'));
  $('header.top')?.remove();

  // the old page title block becomes the top bar: heading, sub line, and its buttons
  const pt = $('.page-title', main);
  let heading = title, subline = sub, acts = [];
  if (pt) {
    heading = heading ?? $('h1', pt)?.textContent;
    subline = subline ?? $('p', pt)?.textContent;
    acts = [...pt.children].filter(c => !['H1', 'P'].includes(c.tagName) && !c.classList.contains('spacer'));
    pt.remove();
  }
  const flat = NAV.flatMap(([, items]) => items);
  heading = heading || flat.find(([h]) => h === active)?.[1] || TITLES[active] || '';
  const items = (list) => list.filter(([, , , admin]) => !admin || !me || me.role === 'admin');
  const nav = (list, cls = 'nav') => items(list).map(([h, l, i]) => `<a class="${cls} ${h === active ? 'on' : ''}" href="${h}">${I[i]}<span>${l}</span>${h === '/escalations.html' ? '<span class="badge hidden" id="escBadge"></span>' : ''}</a>`).join('');
  const th = theme();
  const hour = new Date().getHours();

  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
  <aside class="side"><a class="logo" href="/"><span class="m">K</span><div><b>Digital Kaizen</b><span>${esc(plant)}</span></div></a>
    ${NAV.map(([g, list]) => `<div class="navgrp">${g}</div>${nav(list)}`).join('')}
    <div class="foot"><button class="themebtn" data-theme-toggle>${th === 'dark' ? 'Switch to light' : 'Switch to dark'}</button>
      ${me ? `<div class="who" id="who"><i>${esc(me.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase())}</i><div><b>${esc(me.name)}</b><span>${esc(me.role)}</span></div>
        <div class="menu"><a href="/account.html">Password and two-step</a><button class="item" id="signOut">Sign out</button></div></div>` : ''}</div></aside>
  <div class="main"><div class="topbar"><div><h1>${esc(heading)}</h1>${subline ? `<div class="sub">${esc(subline)}</div>` : ''}</div><div class="sp"></div>
      <div class="acts" id="acts"></div>
      ${conn ? '<span class="pill hide-m"><span class="d" id="dot"></span><span id="connText">connecting</span></span>' : ''}
      ${clock ? `<span class="pill hide-m">Shift <b>${hour >= 6 && hour < 18 ? 'A' : 'B'}</b></span><div class="clock" id="clock"></div>` : ''}</div>
    <div class="page" id="page"></div></div>
  <nav class="tabbar">${[['/', 'Live', 'live'], ['/machine.html', 'Machines', 'machine'], ['/quality.html', 'OEE', 'quality'], ['/escalations.html', 'Alerts', 'bell']].map(([h, l, i]) => `<a class="${h === active ? 'on' : ''}" href="${h}">${I[i]}${l}</a>`).join('')}
    <button class="more ${['/history.html', '/qr.html', '/sensors.html', '/settings.html', '/users.html', '/about.html', '/account.html'].includes(active) ? 'on' : ''}" id="moreBtn">${I.more}More</button></nav>
  <div class="sheet-more" id="sheetMore">${nav([['/history.html', 'History', 'history'], ['/qr.html', 'QR labels', 'qr'], ['/sensors.html', 'Sensors', 'sensor', true], ['/settings.html', 'Settings', 'gear', true], ['/users.html', 'People', 'people', true], ['/about.html', 'How it works', 'help']])}
    <button class="themebtn" data-theme-toggle>${th === 'dark' ? 'Switch to light' : 'Switch to dark'}</button>${me ? '<a class="nav" href="/account.html">Password and two-step</a><button class="themebtn" id="signOut2">Sign out</button>' : ''}</div>`;
  const page = $('#page', shell);
  document.body.prepend(shell);
  page.appendChild(main);
  // the old <main> wrapper just flows into the page grid
  main.style.cssText = 'display:contents';
  for (const a of acts) $('#acts', shell).appendChild(a);

  const paint = () => $$('[data-theme-toggle]').forEach(b => { b.textContent = theme() === 'dark' ? 'Switch to light' : 'Switch to dark'; });
  $$('[data-theme-toggle]').forEach(b => b.onclick = () => { setTheme(theme() === 'dark' ? 'light' : 'dark'); paint(); window.dispatchEvent(new Event('themechange')); });
  $('#moreBtn').onclick = (e) => { e.stopPropagation(); $('#sheetMore').classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#sheetMore')) $('#sheetMore').classList.remove('open'); });
  if (me) {
    $('#who').onclick = (e) => { e.stopPropagation(); $('#who').classList.toggle('open'); };
    document.addEventListener('click', () => $('#who')?.classList.remove('open'));
    const out = async () => { await postJson('/api/auth/logout'); location.href = '/login.html'; };
    $('#signOut').onclick = out; $('#signOut2').onclick = out;
  }
  if (clock) {
    const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
    tick(); setInterval(tick, 10000);
  }
  // the open-issue count on the Escalations link
  fetch('/api/escalation').then(r => r.ok ? r.json() : null).then(e => {
    const n = e?.open?.length || 0;
    if (n) $$('#escBadge').forEach(b => { b.textContent = n; b.classList.remove('hidden'); });
  }).catch(() => {});
  return me;
}

export function live(on, text) {
  const d = $('#dot'), t = $('#connText'); if (!d) return;
  d.classList.toggle('live', on); t.textContent = text || (on ? 'Live' : 'Reconnecting');
}

// ---------- charts ----------
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// tiny line, no axes: for KPI tiles. values may contain null.
export function spark(values, { color = 'var(--brand)', h = 34 } = {}) {
  const v = values.filter(x => x != null);
  if (v.length < 2) return `<svg class="spark" viewBox="0 0 100 ${h}"></svg>`;
  const max = Math.max(...v), min = Math.min(...v), W = 100;
  const pts = values.map((x, i) => x == null ? null : [i / (values.length - 1) * W, h - 3 - ((x - min) / (max - min || 1)) * (h - 8)]);
  let d = '', run = false;
  pts.forEach(p => { if (!p) { run = false; return; } d += `${run ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`; run = true; });
  return `<svg class="spark" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" style="color:${color}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}L${W},${h}L0,${h}Z" fill="currentColor" opacity=".1"/></svg>`;
}

// what a machine did: segments [[state, minutes], ...] with state r i d p o
export function timeline(segs) {
  const t = segs.reduce((a, s) => a + s[1], 0) || 1;
  return `<div class="tl">${segs.map(([s, m]) => `<i class="${s}" style="flex:${m / t}"></i>`).join('')}</div>`;
}

export function hbars(items, { unit = '', color = 'var(--plan)', empty = 'Nothing logged yet' } = {}) {
  if (!items.length) return `<div class="part" style="padding:8px 0">${esc(empty)}</div>`;
  const max = Math.max(...items.map(i => i.v), 1);
  return `<div class="hb">${items.map(i => `<div class="r"><span class="n" title="${esc(i.n)}">${esc(i.n)}</span><span class="t"><i style="width:${Math.max(2, (i.v / max) * 100)}%;--c:${i.c || color}"></i></span><span class="v">${n1(i.v).replace(/\.0$/, '')}${unit}</span></div>`).join('')}</div>`;
}

// vertical columns (HTML). cols: [{l, parts:[[value, colour]]}]
export function columns(cols, { h = 150, every = 1, empty = 'Nothing yet' } = {}) {
  const tot = (c) => c.parts.reduce((a, p) => a + p[0], 0);
  if (!cols.length || !cols.some(c => tot(c) > 0)) return `<div class="part" style="padding:8px 0">${esc(empty)}</div>`;
  const max = Math.max(...cols.map(tot), 1);
  return `<div style="display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,64px);justify-content:space-between;gap:6px;align-items:end;height:${h}px;border-bottom:1px solid var(--line)">${cols.map(c => `<div title="${esc(c.l)}: ${tot(c)}" style="display:flex;flex-direction:column-reverse;gap:2px;height:100%;justify-content:flex-start">${c.parts.map(p => `<i style="display:block;height:${(p[0] / max) * 100}%;background:${p[1]};border-radius:3px"></i>`).join('')}</div>`).join('')}</div>
    <div style="display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,64px);justify-content:space-between;gap:6px;margin-top:6px;font-size:11px;color:var(--faint);text-align:center">${cols.map((c, i) => `<span>${i % every === 0 ? esc(c.l) : ''}</span>`).join('')}</div>`;
}

// line with axes, drawn to the element width. pts: [{l, v}] (v may be null)
export function line(el, pts, { h = 240, max = 100, min = 0, target = null, color = 'var(--brand)', unit = '%' } = {}) {
  const draw = () => {
    if (!pts.some(p => p.v != null)) { el.innerHTML = '<div class="part" style="padding:8px 0">Nothing yet</div>'; return; }
    const W = Math.max(260, el.clientWidth), padL = 38, padR = 12, padT = 12, padB = 28;
    const x = i => padL + (pts.length === 1 ? (W - padL - padR) / 2 : i / (pts.length - 1) * (W - padL - padR)), y = v => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
    const grid = [0, 25, 50, 75, 100].map(v => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="${css('--grid')}"/><text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${css('--faint')}">${v}</text>`).join('');
    const segs = []; let cur = [];
    pts.forEach((p, i) => { if (p.v == null) { if (cur.length) segs.push(cur); cur = []; return; } cur.push([x(i), y(p.v)]); });
    if (cur.length) segs.push(cur);
    const paths = segs.map(s => { const dd = s.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(''); return `<path d="${dd}L${s.at(-1)[0]},${y(min)}L${s[0][0]},${y(min)}Z" fill="url(#lg)"/><path d="${dd}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`; }).join('');
    const last = segs.at(-1)?.at(-1);
    const every = Math.ceil(pts.length / Math.max(2, Math.floor((W - padL) / 56)));
    const labels = pts.map((p, i) => i % every === 0 || i === pts.length - 1 ? `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" font-size="11" fill="${css('--faint')}">${esc(p.l)}</text>` : '').join('');
    const tl = target == null ? '' : `<line x1="${padL}" x2="${W - padR}" y1="${y(target)}" y2="${y(target)}" stroke="${css('--run')}" stroke-dasharray="4 5" opacity=".8"/><text x="${W - padR}" y="${y(target) - 6}" text-anchor="end" font-size="11" font-weight="700" fill="${css('--run')}">TARGET ${target}${unit}</text>`;
    el.innerHTML = `<svg width="${W}" height="${h}" role="img"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${grid}${tl}${paths}${last ? `<circle cx="${last[0]}" cy="${last[1]}" r="5" fill="${color}" stroke="${css('--s1')}" stroke-width="3"/>` : ''}${labels}</svg>`;
  };
  draw();
  window.addEventListener('resize', draw);
  window.addEventListener('themechange', draw);
  return draw;
}
