// Shared pieces for every page: the theme, the header, number formatting and
// the charts. Plain SVG drawn at the element's real width, so text stays
// crisp on a phone and readable from across the factory floor.

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
export const toneVar = (t) => ({ good: 'var(--run)', ok: 'var(--idle)', bad: 'var(--down)', none: 'var(--off)' }[t]);
export const hm = (iso) => String(iso || '').slice(11, 16);
export const mins = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`);
export const ago = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
};

export async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 401 && !path.startsWith('/api/auth') && !path.startsWith('/api/login') && !path.startsWith('/api/invite') && !path.startsWith('/api/ack')) { location.href = '/login.html'; return new Promise(() => {}); }
  return r.json();
}
export const postJson = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

export function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}

// ---------- header ----------
const ICON = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
};
const NAV = [
  ['/', 'Live floor'], ['/quality.html', 'Quality'], ['/escalations.html', 'Escalations'], ['/history.html', 'History'],
  ['/sensors.html', 'Sensors', 'admin'], ['/qr.html', 'Labels'], ['/settings.html', 'Settings', 'admin'], ['/users.html', 'People', 'admin'],
];

export async function mountHeader({ active = '', clock = true, me = undefined, plant = 'Evernu Plastics', conn = clock } = {}) {
  if (me === undefined) {
    try { me = (await fetch('/api/me').then(r => r.json())).user; } catch { me = null; }
  }
  const el = $('header.top') || document.body.insertAdjacentElement('afterbegin', Object.assign(document.createElement('header'), { className: 'top' }));
  const items = NAV.filter(([, , need]) => !need || !me || me.role === 'admin');
  el.innerHTML = `
    <a class="brand" href="/"><span class="mark">K</span><span>Digital Kaizen<small>${esc(plant)}</small></span></a>
    <nav>${items.map(([href, label]) => `<a href="${href}" class="${href === active ? 'on' : ''}">${label}</a>`).join('')}</nav>
    <div class="spacer"></div>
    ${clock ? '<div class="clock" id="clock"></div>' : ''}
    ${conn ? '<div class="conn"><span class="dot" id="dot"></span><span id="connText">connecting</span></div>' : ''}
    <button class="iconbtn ghost" id="themeBtn" title="Light or dark" aria-label="Switch between light and dark"></button>
    ${me ? `<div class="me" id="me"><button class="iconbtn ghost" id="meBtn" aria-label="Account">${ICON.user}</button>
      <div class="menu"><div class="who"><b>${esc(me.name)}</b>${esc(me.role)}</div>
      <a href="/account.html">Password and two-step</a><button class="item" id="signOut">Sign out</button></div></div>` : ''}`;

  const paint = () => { $('#themeBtn').innerHTML = theme() === 'dark' ? ICON.sun : ICON.moon; };
  paint();
  $('#themeBtn').onclick = () => { setTheme(theme() === 'dark' ? 'light' : 'dark'); paint(); window.dispatchEvent(new Event('themechange')); };
  if (me) {
    $('#meBtn').onclick = (e) => { e.stopPropagation(); $('#me').classList.toggle('open'); };
    document.addEventListener('click', () => $('#me')?.classList.remove('open'));
    $('#signOut').onclick = async () => { await postJson('/api/auth/logout'); location.href = '/login.html'; };
  }
  if (clock) {
    const tick = () => {
      const d = new Date();
      $('#clock').innerHTML = `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}<small>${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</small>`;
    };
    tick(); setInterval(tick, 10000);
  }
  return me;
}

export function live(on, text) {
  const d = $('#dot'), t = $('#connText'); if (!d) return;
  d.classList.toggle('live', on); t.textContent = text || (on ? 'live' : 'reconnecting');
}

// ---------- charts ----------
const FONT = 'font-family="Segoe UI Variable Text,Segoe UI,system-ui,sans-serif"';
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const widthOf = (el) => Math.max(260, Math.round(el.clientWidth || el.parentElement?.clientWidth || 600));
const niceMax = (m) => { if (m <= 5) return 5; const p = 10 ** Math.floor(Math.log10(m)); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

const redraws = new Set();
export function chart(el, draw) {
  const go = () => { try { el.innerHTML = draw(widthOf(el)); } catch (e) { el.textContent = ''; console.error(e); } };
  go(); redraws.add(go);
  return go;
}
window.addEventListener('resize', () => redraws.forEach(f => f()));
window.addEventListener('themechange', () => redraws.forEach(f => f()));

export function ring({ value, size = 220, stroke = 18, label = 'OEE', color }) {
  const r = (100 - stroke) / 2, c = 2 * Math.PI * r;
  const t = tone(value), col = color || toneVar(t);
  const frac = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return `<div class="ring" style="--size:${size}px"><svg viewBox="0 0 100 100" role="img" aria-label="${label} ${value ?? 'no data'}">
    <circle class="track" cx="50" cy="50" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" style="stroke:${col}" stroke-dasharray="${(c * frac).toFixed(2)} ${c.toFixed(2)}"/></svg>
    <div class="num"><b>${value == null ? '—' : Math.round(value)}${value == null ? '' : '<small>%</small>'}</b><span>${label}</span></div></div>`;
}

export function factorBar(label, v, hint = '') {
  const t = tone(v);
  return `<div class="factor tone-${t}"><span class="k">${label}</span><span class="v">${v == null ? '—' : Math.round(v * 10) / 10}${v == null ? '' : '<small>%</small>'}</span>
    <div class="bar" title="${esc(hint)}"><i style="width:${v == null ? 0 : Math.max(2, Math.min(100, v))}%"></i></div></div>`;
}

// A line over days. points: [{label, value}] (value may be null). Optional target line.
export function lineChart(el, points, { h = 220, max = 100, min = 0, target = null, unit = '%', color = 'var(--accent)', second = null } = {}) {
  return chart(el, (W) => {
    const padL = 40, padR = 14, padT = 14, padB = 30;
    if (!points.length) return `<svg width="${W}" height="60"><text x="0" y="34" ${FONT} font-size="14" fill="${css('--faint')}">Nothing logged yet</text></svg>`;
    const x = (i) => padL + (points.length === 1 ? (W - padL - padR) / 2 : (i / (points.length - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
    const grid = [0, .25, .5, .75, 1].map(f => { const v = min + (max - min) * f; return `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="${css('--line')}"/><text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end" ${FONT} font-size="12" fill="${css('--faint')}">${Math.round(v)}${f === 1 ? unit : ''}</text>`; }).join('');
    const seg = (pts, col, area) => {
      let out = '', run = [];
      const flush = () => {
        if (!run.length) return;
        const d = run.map((r, k) => `${k ? 'L' : 'M'}${x(r.i).toFixed(1)},${y(r.v).toFixed(1)}`).join('');
        if (area && run.length > 1) out += `<path d="${d}L${x(run[run.length - 1].i).toFixed(1)},${y(min)}L${x(run[0].i).toFixed(1)},${y(min)}Z" fill="${col}" opacity=".12"/>`;
        out += `<path d="${d}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
        run = [];
      };
      pts.forEach((p, i) => { if (p.value == null) flush(); else run.push({ i, v: p.value }); });
      flush();
      return out;
    };
    const dots = points.map((p, i) => p.value == null ? '' : `<circle cx="${x(i)}" cy="${y(p.value)}" r="${i === points.length - 1 ? 5.5 : 3.5}" fill="${i === points.length - 1 ? color : css('--surface')}" stroke="${color}" stroke-width="2.5"><title>${esc(p.label)}: ${p.value}${unit}</title></circle>`).join('');
    const every = Math.ceil(points.length / Math.max(2, Math.floor((W - padL) / 64)));
    const labels = points.map((p, i) => i % every === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" ${FONT} font-size="12" fill="${css('--faint')}">${esc(p.label)}</text>` : '').join('');
    const tl = target == null ? '' : `<line x1="${padL}" x2="${W - padR}" y1="${y(target)}" y2="${y(target)}" stroke="${css('--run')}" stroke-dasharray="5 5" opacity=".7"/><text x="${W - padR}" y="${y(target) - 6}" text-anchor="end" ${FONT} font-size="12" fill="${css('--run')}">target ${target}${unit}</text>`;
    return `<svg width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img">${grid}${tl}${seg(points, color, true)}${second ? seg(second, 'var(--idle)', false) : ''}${dots}${labels}</svg>`;
  });
}

// Vertical bars. points: [{label, value}]
export function barChart(el, points, { h = 170, color = 'var(--accent)', empty = 'Nothing yet', fmt = (v) => v } = {}) {
  return chart(el, (W) => {
    if (!points.length) return `<svg width="${W}" height="44"><text x="0" y="28" ${FONT} font-size="14" fill="${css('--faint')}">${esc(empty)}</text></svg>`;
    const padL = 36, padB = 24, padT = 8, max = niceMax(Math.max(1, ...points.map(p => p.value)));
    const bw = (W - padL) / points.length, y = (v) => h - padB - (v / max) * (h - padB - padT);
    const grid = [0, .5, 1].map(f => `<line x1="${padL}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="${css('--line')}"/><text x="0" y="${y(max * f) + 4}" ${FONT} font-size="12" fill="${css('--faint')}">${Math.round(max * f)}</text>`).join('');
    const bars = points.map((p, i) => `<rect x="${(padL + i * bw + bw * .14).toFixed(1)}" y="${y(p.value).toFixed(1)}" width="${(bw * .72).toFixed(1)}" height="${Math.max(1.5, h - padB - y(p.value)).toFixed(1)}" rx="4" fill="${p.color || color}"><title>${esc(p.label)}: ${fmt(p.value)}</title></rect>`).join('');
    const every = Math.ceil(points.length / Math.max(2, Math.floor((W - padL) / 52)));
    const labels = points.map((p, i) => i % every === 0 ? `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle" ${FONT} font-size="12" fill="${css('--faint')}">${esc(p.label)}</text>` : '').join('');
    return `<svg width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img">${grid}${bars}${labels}</svg>`;
  });
}

// Horizontal bars with the label and value on each row. items: [{label, value, color, note}]
export function hbars(el, items, { unit = '', empty = 'Nothing logged yet' } = {}) {
  return chart(el, (W) => {
    if (!items.length) return `<svg width="${W}" height="44"><text x="0" y="28" ${FONT} font-size="14" fill="${css('--faint')}">${esc(empty)}</text></svg>`;
    const rowH = 40, max = Math.max(...items.map(i => i.value), 1), labelW = Math.min(230, W * .42), valW = 74;
    const bw = W - labelW - valW - 8;
    const rows = items.map((it, i) => {
      const y = i * rowH, w = Math.max(3, (it.value / max) * bw);
      return `<text x="0" y="${y + 24}" ${FONT} font-size="15" fill="${css('--ink')}">${esc(it.label.length > 28 ? it.label.slice(0, 27) + '…' : it.label)}</text>
        <rect x="${labelW}" y="${y + 9}" width="${bw}" height="16" rx="8" fill="${css('--sunken')}"/>
        <rect x="${labelW}" y="${y + 9}" width="${w.toFixed(1)}" height="16" rx="8" fill="${it.color || 'var(--accent)'}"><title>${esc(it.label)}: ${it.value}${unit}</title></rect>
        <text x="${W}" y="${y + 24}" text-anchor="end" ${FONT} font-size="15" font-weight="700" fill="${css('--ink')}">${n1(it.value)}${unit}</text>`;
    }).join('');
    return `<svg width="${W}" height="${items.length * rowH}" viewBox="0 0 ${W} ${items.length * rowH}" role="img">${rows}</svg>`;
  });
}

// Stacked columns, one per day. days: [{label, parts:[{key, value}]}], colours: {key: css colour}
export function stacked(el, days, colours, { h = 200, empty = 'Nothing logged yet' } = {}) {
  return chart(el, (W) => {
    const tot = (d) => d.parts.reduce((a, p) => a + p.value, 0);
    if (!days.length || !days.some(d => tot(d) > 0)) return `<svg width="${W}" height="44"><text x="0" y="28" ${FONT} font-size="14" fill="${css('--faint')}">${esc(empty)}</text></svg>`;
    const padL = 36, padB = 24, padT = 8, max = niceMax(Math.max(...days.map(tot)));
    const bw = (W - padL) / days.length, y = (v) => h - padB - (v / max) * (h - padB - padT);
    const grid = [0, .5, 1].map(f => `<line x1="${padL}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="${css('--line')}"/><text x="0" y="${y(max * f) + 4}" ${FONT} font-size="12" fill="${css('--faint')}">${Math.round(max * f)}</text>`).join('');
    const cols = days.map((d, i) => {
      let acc = 0;
      return d.parts.filter(p => p.value > 0).map(p => {
        const y1 = y(acc + p.value), y0 = y(acc); acc += p.value;
        return `<rect x="${(padL + i * bw + bw * .16).toFixed(1)}" y="${y1.toFixed(1)}" width="${(bw * .68).toFixed(1)}" height="${(y0 - y1).toFixed(1)}" fill="${colours[p.key] || 'var(--off)'}"><title>${esc(d.label)} ${esc(p.key)}: ${p.value}</title></rect>`;
      }).join('');
    }).join('');
    const every = Math.ceil(days.length / Math.max(2, Math.floor((W - padL) / 52)));
    const labels = days.map((d, i) => i % every === 0 ? `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle" ${FONT} font-size="12" fill="${css('--faint')}">${esc(d.label)}</text>` : '').join('');
    return `<svg width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img">${grid}${cols}${labels}</svg>`;
  });
}

// Last N cycles: one thin bar each, coloured by how it went.
export function cycleBars(el, shots, ideal = null) {
  return chart(el, (W) => {
    const H = 64, pad = 4;
    if (!shots.length) return `<svg width="${W}" height="30"><text x="0" y="20" ${FONT} font-size="14" fill="${css('--faint')}">No cycles yet</text></svg>`;
    const colour = { cycle: 'var(--run)', small_stop: 'var(--idle)', downtime: 'var(--down)', non_scheduled: 'var(--off)' };
    const normals = shots.filter(s => s.class === 'cycle').map(s => s.cycletime);
    const max = Math.max(...(normals.length ? normals : [1]), ideal || 0) * 1.3;
    const bw = W / shots.length;
    const bars = shots.map((s, i) => {
      const hh = Math.max(3, Math.min(H - pad * 2, (Math.min(s.cycletime, max) / max) * (H - pad * 2)));
      return `<rect x="${(i * bw).toFixed(1)}" y="${(H - pad - hh).toFixed(1)}" width="${Math.max(1, bw - 1.5).toFixed(1)}" height="${hh.toFixed(1)}" rx="1.5" fill="${colour[s.class]}"><title>${esc(s.timestamp)}, ${s.cycletime}s</title></rect>`;
    }).join('');
    const line = ideal ? `<line x1="0" x2="${W}" y1="${H - pad - (ideal / max) * (H - pad * 2)}" y2="${H - pad - (ideal / max) * (H - pad * 2)}" stroke="${css('--ink')}" stroke-dasharray="3 4" opacity=".45"/>` : '';
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">${bars}${line}</svg>`;
  });
}
