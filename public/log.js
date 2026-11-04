// The page an operator reaches by scanning the QR code on a machine.
// No sign-in: the QR carries the machine's token. The page reads the
// machine's live state and offers only what makes sense:
//   RUNNING  -> Log defects
//   DOWN     -> Log downtime (and defects)
//   unknown  -> both (no sensor reading to go by)
// Entries are saved on the phone first if the Wi-Fi drops, and sent when it
// comes back, so a patchy network never costs a log.

import { esc, n0, hm, ago, theme, setTheme } from './ui.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const machineId = params.get('m') || '';
const key = params.get('k') || '';
const q = `m=${encodeURIComponent(machineId)}&k=${encodeURIComponent(key)}`;

const ICON = {
  stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  defect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.01"/></svg>',
  tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
};

let ctx = null;
let view = 'home';           // home | defects | downtime | done
let form = {};
const store = {
  get op() { try { return localStorage.getItem('dk-op') || ''; } catch { return ''; } },
  set op(v) { try { localStorage.setItem('dk-op', v); } catch { /* private mode */ } },
  get pin() { try { return sessionStorage.getItem('dk-pin') || ''; } catch { return ''; } },
  set pin(v) { try { sessionStorage.setItem('dk-pin', v); } catch { /* private mode */ } },
};

// ---------- the phone-side outbox ----------
const OUT = 'dk-outbox';
const outbox = () => { try { return JSON.parse(localStorage.getItem(OUT) || '[]'); } catch { return []; } };
const saveOutbox = (l) => { try { localStorage.setItem(OUT, JSON.stringify(l)); } catch { /* full */ } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

async function post(path, body) {
  const r = await fetch(`${path}?${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, machine: machineId, key }) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}

async function flush() {
  const list = outbox(); if (!list.length) return;
  const keep = [];
  for (const item of list) {
    try {
      const r = await post(item.path, item.body);
      if (r.status >= 500 || r.status === 429) keep.push(item);        // try again later
      // 2xx done; 4xx can never succeed, drop it rather than loop forever
    } catch { keep.push(item); }
  }
  saveOutbox(keep);
  if (keep.length !== list.length && view === 'home') render();
}

// ---------- loading ----------
async function load() {
  let r;
  try { r = await fetch(`/api/log/context?${q}`); } catch {
    if (!ctx) app.innerHTML = '<div class="bad"><b>No connection</b>Move closer to the Wi-Fi, then open this page again.</div>';
    return;
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    app.innerHTML = `<div class="bad"><b>${r.status === 403 ? 'This code is not valid' : 'Cannot open this'}</b>${esc(j.error || 'Scan the QR code stuck to the machine.')}</div>`;
    return;
  }
  const first = !ctx;
  ctx = await r.json();
  if (first && !ctx.operators.some(o => String(o.id) === store.op)) store.op = '';
  if (view === 'home') render();
}

const state = () => ctx.state;
const chosenOp = () => ctx.operators.find(o => String(o.id) === store.op) || null;

// ---------- screens ----------
function header() {
  return `<div class="lh"><div class="m"><h1>${esc(ctx.machine.name)}</h1><div class="s">Shift ${esc(ctx.shift)} &middot; ${esc(ctx.serverTime.slice(11, 16))}${ctx.machine.part ? ' &middot; ' + esc(ctx.machine.part) : ''}</div></div>
    <button class="iconbtn ghost" id="themeBtn" aria-label="Light or dark">${theme() === 'dark' ? ICON.sun : ICON.moon}</button></div>`;
}
function bindTheme() { const b = document.getElementById('themeBtn'); if (b) b.onclick = () => { setTheme(theme() === 'dark' ? 'light' : 'dark'); render(); }; }

function stateBar() {
  const s = state();
  if (s === 'running') return `<div class="statebar run"><span class="sig"></span><div><div class="big">Machine is running</div><div class="sm">Nothing to log as downtime. Found bad parts? Log them below.</div></div></div>`;
  if (s === 'down') {
    const e = ctx.event;
    return `<div class="statebar down"><span class="sig"></span><div><div class="big">Machine is down${e ? ' for <span id="el">' + esc(e.elapsed_human) + '</span>' : ''}</div><div class="sm">${e ? 'Stopped at ' + esc(hm(e.started_at)) + '. ' : ''}Tell us why it stopped.</div></div></div>`;
  }
  return `<div class="statebar unknown"><span class="sig"></span><div><div class="big">No sensor reading</div><div class="sm">We cannot see this machine right now, so you can log either.</div></div></div>`;
}

function namePicker() {
  if (!ctx.operators.length) return '';
  const sel = chosenOp();
  return `<div class="q">Who is logging?</div>
    <div class="names">${ctx.operators.map(o => `<button class="name ${String(o.id) === store.op ? 'sel' : ''}" data-op="${o.id}">${esc(o.name)}</button>`).join('')}</div>
    ${ctx.pinRequired && sel?.hasPin ? `<div class="pin"><input id="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="PIN" value="${esc(store.pin)}"><span class="fsub" style="margin:0">Your PIN</span></div>` : ''}`;
}

function recent() {
  if (!ctx.recent.length) return '';
  return `<div class="recent"><div class="q">Logged here lately</div>${ctx.recent.map(r => `<div class="it"><span class="ico ${r.kind === 'downtime' ? 'dt' : 'df'}">${r.kind === 'downtime' ? 'DT' : 'DF'}</span>
    <div>${esc(r.text)}<div class="by">${r.by ? esc(r.by) : 'no name'}</div></div><time>${esc(hm(r.at))}</time></div>`).join('')}</div>`;
}

function home() {
  const s = state();
  const pend = outbox().length;
  app.innerHTML = `${header()}
    ${pend ? `<div class="pending">${pend} entr${pend > 1 ? 'ies are' : 'y is'} saved on this phone and will send when the Wi-Fi is back.</div>` : ''}
    ${stateBar()}
    ${ctx.unexplained.length && s !== 'down' ? `<div class="unexplained"><b>The machine stopped ${esc(ctx.unexplained[0].duration_human)} at ${esc(hm(ctx.unexplained[0].started_at))}.</b><div class="fsub" style="margin:4px 0 0">Nobody has said why yet.</div>
      <button data-explain="${ctx.unexplained[0].id}">Say why it stopped</button></div>` : ''}
    ${namePicker()}
    <div class="q">What do you want to log?</div>
    <div class="actions">
      ${s !== 'running' ? `<button class="act dt" data-go="downtime"><span class="ic">${ICON.stop}</span><span><b>Log downtime</b><span>${s === 'down' ? 'Why did it stop? Pick a reason' : 'A stop you want to record'}</span></span></button>` : ''}
      <button class="act df" data-go="defects"><span class="ic">${ICON.defect}</span><span><b>Log defects</b><span>How many, what type${ctx.defectsThisShift ? ` &middot; ${n0(ctx.defectsThisShift)} this shift` : ''}</span></span></button>
    </div>
    ${recent()}`;
  bindTheme();
  app.querySelectorAll('[data-op]').forEach(b => b.onclick = () => { store.op = store.op === b.dataset.op ? '' : b.dataset.op; render(); });
  app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  app.querySelectorAll('[data-explain]').forEach(b => b.onclick = () => go('downtime', { eventId: Number(b.dataset.explain), fromEvent: true }));
  const pin = document.getElementById('pin'); if (pin) pin.oninput = () => { store.pin = pin.value; };
  tickElapsed();
}

let timer = null;
function tickElapsed() {
  clearInterval(timer);
  if (state() === 'down' && ctx.event) {
    let s = ctx.event.elapsed_seconds || 0;
    timer = setInterval(() => { s++; const el = document.getElementById('el'); if (el) el.textContent = ago(s); }, 1000);
  }
}

function go(to, extra = {}) {
  form = { shift: ctx.shift, count: 1, endedAgo: 0, minutes: 15, ...extra };
  if (to === 'downtime' && state() === 'down' && ctx.event && !extra.eventId) form.eventId = ctx.event.id;
  view = to; render(); window.scrollTo(0, 0);
}

function needName() {
  if (ctx.pinRequired && !chosenOp()) return 'Pick your name first (on the first screen).';
  return null;
}

// ---- defects
function defectsForm() {
  const t = ctx.defectTypes;
  app.innerHTML = `<button class="back" id="back">&larr; Back</button>
    <div class="ftitle">Log defects</div><div class="fsub">${esc(ctx.machine.name)} &middot; shift ${esc(form.shift)}</div>
    <div class="q">How many?</div>
    <div class="stepper"><button id="minus" aria-label="One less">&minus;</button><input id="count" type="number" inputmode="numeric" min="1" max="100000" value="${form.count}"><button id="plus" aria-label="One more">+</button></div>
    <div class="quick">${[1, 5, 10, 25, 50].map(n => `<button data-add="${n}">+${n}</button>`).join('')}</div>
    <div class="q">What kind?</div>
    <div class="grid2">${t.map(d => `<button class="opt ${form.typeCode === d.code ? 'sel' : ''}" data-type="${d.code}">${esc(d.label)}</button>`).join('')}</div>
    <div class="q">Shift</div>
    <div class="seg2">${ctx.shifts.map(s => `<button class="${form.shift === s ? 'sel' : ''}" data-shift="${s}">Shift ${s}</button>`).join('')}</div>
    <div class="q">Note and photo (optional)</div>
    <textarea class="note" id="note" placeholder="Cavity, batch, anything useful">${esc(form.note || '')}</textarea>
    <div class="photo"><button class="pbtn ghost" id="pbtn">${ICON.cam}&nbsp; ${form.photo ? 'Change photo' : 'Add photo'}</button>${form.photo ? `<img src="${form.photoUrl}" alt="photo">` : ''}
      <input type="file" id="pfile" accept="image/*" capture="environment" class="hidden"></div>
    <div class="foot"><div class="in"><div class="err" id="err"></div><button class="go-df" id="send">Save defects</button></div></div>`;
  wireCommon();
  const count = document.getElementById('count');
  const set = (n) => { form.count = Math.max(1, Math.min(100000, Math.round(n) || 1)); count.value = form.count; };
  count.oninput = () => { form.count = Math.max(1, Math.round(Number(count.value)) || 1); };
  document.getElementById('minus').onclick = () => set(form.count - 1);
  document.getElementById('plus').onclick = () => set(form.count + 1);
  app.querySelectorAll('[data-add]').forEach(b => b.onclick = () => set(form.count + Number(b.dataset.add)));
  app.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { form.typeCode = b.dataset.type; keepNote(); defectsForm(); });
  app.querySelectorAll('[data-shift]').forEach(b => b.onclick = () => { form.shift = b.dataset.shift; keepNote(); defectsForm(); });
  document.getElementById('pbtn').onclick = () => document.getElementById('pfile').click();
  document.getElementById('pfile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    form.photo = await shrink(f); form.photoUrl = URL.createObjectURL(form.photo); keepNote(); defectsForm();
  };
  document.getElementById('send').onclick = sendDefects;
}

async function sendDefects() {
  keepNote();
  const err = document.getElementById('err');
  if (!form.typeCode) { err.textContent = 'Pick the kind of defect.'; return; }
  const bad = needName(); if (bad) { err.textContent = bad; return; }
  const body = { count: form.count, typeCode: form.typeCode, shift: form.shift, note: form.note,
    clientId: uid(), operatorId: store.op ? Number(store.op) : undefined, pin: store.pin || undefined };
  const btn = document.getElementById('send'); btn.disabled = true; btn.textContent = 'Saving…';
  const label = ctx.defectTypes.find(d => d.code === form.typeCode)?.label;
  try {
    const r = await post('/api/log/defects', body);
    if (r.status >= 500) throw new Error('server');
    if (!r.body?.ok) { btn.disabled = false; btn.textContent = 'Save defects'; err.textContent = r.body?.error || 'Could not save. Try again.'; return; }
    if (form.photo) {
      try { await fetch(`/api/log/photo?${q}&id=${r.body.id}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: form.photo }); } catch { /* photo is a bonus */ }
    }
    done({ title: 'Defects saved', line: `${form.count} × ${label}`, meter: { n: r.body.shiftTotal, limit: r.body.limit, shift: r.body.shift }, escalated: r.body.escalated });
  } catch {
    saveOutbox([...outbox(), { path: '/api/log/defects', body }]);
    done({ title: 'Saved on this phone', line: `${form.count} × ${label}. It sends when the Wi-Fi is back.`, offline: true });
  }
}

// ---- downtime
function downtimeForm() {
  const e = form.fromEvent || (form.eventId && ctx.event?.id === form.eventId);
  const ev = form.fromEvent ? ctx.unexplained.find(u => u.id === form.eventId) : ctx.event;
  const R = ctx.reasons;
  app.innerHTML = `<button class="back" id="back">&larr; Back</button>
    <div class="ftitle">Log downtime</div><div class="fsub">${esc(ctx.machine.name)}${ev ? ` &middot; stopped ${hm(ev.started_at)}` : ''}</div>
    <div class="q">Why did it stop?</div>
    <div class="grid2">${R.map(r => `<button class="opt ${form.reasonCode === r.code ? 'sel' : ''}" data-reason="${r.code}">${esc(r.label)}${r.planned ? '<small>planned</small>' : ''}</button>`).join('')}</div>
    ${e ? `<div class="warn">The sensor recorded this stop, so the time is filled in for you.</div>` : `
    <div class="q">How long was it down?</div>
    ${form.clock ? `<div class="timegrid"><div class="field"><label>From</label><input type="time" id="t1" value="${esc(form.startClock || '')}"></div><div class="field"><label>To</label><input type="time" id="t2" value="${esc(form.endClock || '')}"></div></div>
      <button class="ghost sm" id="useDur" style="margin-top:10px">Use minutes instead</button>`
    : `<div class="stepper"><button id="minus">&minus;</button><input id="mins" type="number" inputmode="numeric" min="1" max="1440" value="${form.minutes}"><button id="plus">+</button></div>
      <div class="quick">${[5, 10, 15, 30, 60].map(n => `<button data-m="${n}" class="${form.minutes === n ? 'sel' : ''}">${n}</button>`).join('')}</div>
      <div class="q">When did it end?</div>
      <div class="seg2" style="grid-template-columns:repeat(3,1fr)">${[[0, 'Just now'], [30, '30 min ago'], [60, '1 h ago']].map(([v, l]) => `<button class="${form.endedAgo === v ? 'sel' : ''}" data-ago="${v}" style="font-size:16px">${l}</button>`).join('')}</div>
      <button class="ghost sm" id="useClock" style="margin-top:10px">Enter start and end times instead</button>`}`}
    <div class="q">Note (optional)</div>
    <textarea class="note" id="note" placeholder="What happened?">${esc(form.note || '')}</textarea>
    <div class="foot"><div class="in"><div class="err" id="err"></div><button class="go-dt" id="send">Save downtime</button></div></div>`;
  wireCommon();
  app.querySelectorAll('[data-reason]').forEach(b => b.onclick = () => { form.reasonCode = b.dataset.reason; keepNote(); downtimeForm(); });
  if (!e) {
    const set = (n) => { form.minutes = Math.max(1, Math.min(1440, Math.round(n) || 1)); const i = document.getElementById('mins'); if (i) i.value = form.minutes; };
    const mins = document.getElementById('mins');
    if (mins) {
      mins.oninput = () => { form.minutes = Math.max(1, Math.round(Number(mins.value)) || 1); };
      document.getElementById('minus').onclick = () => { set(form.minutes - 1); };
      document.getElementById('plus').onclick = () => { set(form.minutes + 1); };
      app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { keepNote(); form.minutes = Number(b.dataset.m); downtimeForm(); });
      app.querySelectorAll('[data-ago]').forEach(b => b.onclick = () => { keepNote(); form.endedAgo = Number(b.dataset.ago); downtimeForm(); });
      document.getElementById('useClock').onclick = () => { keepNote(); form.clock = true; downtimeForm(); };
    }
    const t1 = document.getElementById('t1');
    if (t1) {
      t1.onchange = () => { form.startClock = t1.value; }; document.getElementById('t2').onchange = (x) => { form.endClock = x.target.value; };
      document.getElementById('useDur').onclick = () => { keepNote(); form.clock = false; downtimeForm(); };
    }
  }
  document.getElementById('send').onclick = sendDowntime;
}

async function sendDowntime() {
  keepNote();
  const err = document.getElementById('err');
  if (!form.reasonCode) { err.textContent = 'Pick the reason first.'; return; }
  const bad = needName(); if (bad) { err.textContent = bad; return; }
  const body = { reasonCode: form.reasonCode, note: form.note, shift: form.shift, clientId: uid(),
    operatorId: store.op ? Number(store.op) : undefined, pin: store.pin || undefined };
  if (form.eventId) body.eventId = form.eventId;
  else if (form.clock) {
    if (!form.startClock || !form.endClock) { err.textContent = 'Enter both times.'; return; }
    body.startClock = form.startClock; body.endClock = form.endClock;
  } else { body.minutes = form.minutes; body.endedAgoMin = form.endedAgo; }
  const btn = document.getElementById('send'); btn.disabled = true; btn.textContent = 'Saving…';
  const label = ctx.reasons.find(r => r.code === form.reasonCode)?.label;
  try {
    const r = await post('/api/log/downtime', body);
    if (r.status >= 500) throw new Error('server');
    if (!r.body?.ok) { btn.disabled = false; btn.textContent = 'Save downtime'; err.textContent = r.body?.error || 'Could not save. Try again.'; return; }
    done({ title: 'Downtime saved', line: `${label}${r.body.minutes ? `, ${Math.round(r.body.minutes)} min` : ''}` });
  } catch {
    saveOutbox([...outbox(), { path: '/api/log/downtime', body }]);
    done({ title: 'Saved on this phone', line: `${label}. It sends when the Wi-Fi is back.`, offline: true });
  }
}

function done({ title, line, meter, escalated, offline }) {
  view = 'done';
  const pct = meter ? Math.min(100, Math.round((meter.n / meter.limit) * 100)) : 0;
  app.innerHTML = `<div class="done"><div class="tick" style="${offline ? 'background:var(--idle-bg);border-color:var(--idle);color:var(--idle)' : ''}">${ICON.tick}</div>
    <h1>${esc(title)}</h1><p>${esc(line)}</p>
    ${escalated ? '<p><b style="color:var(--down)">A manager has been alerted.</b></p>' : ''}
    ${meter ? `<div class="meter"><div class="bar tone-${meter.n >= meter.limit ? 'bad' : pct > 70 ? 'ok' : 'good'}"><i style="width:${pct}%"></i></div><div class="l"><span>${n0(meter.n)} defects in shift ${esc(meter.shift)}</span><span>limit ${n0(meter.limit)}</span></div></div>` : ''}
    <div class="acts"><button id="again">Log something else</button></div></div>`;
  document.getElementById('again').onclick = async () => { view = 'home'; await load(); render(); };
  window.scrollTo(0, 0);
}

function wireCommon() {
  document.getElementById('back').onclick = () => { view = 'home'; render(); };
}
function keepNote() { const n = document.getElementById('note'); if (n) form.note = n.value; }

// Phone cameras make 4 to 8 MB photos. Shrink to something a factory Wi-Fi can carry.
async function shrink(file, max = 1280) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.72));
  } catch { return file; }
}

function render() {
  if (!ctx) return;
  if (view === 'defects') return defectsForm();
  if (view === 'downtime') return downtimeForm();
  if (view === 'done') return;
  home();
}

// ---- go
if (!machineId || !key) {
  app.innerHTML = '<div class="bad"><b>Scan the QR code</b>Use your phone camera on the code stuck to the machine.</div>';
} else {
  await load();
  flush();
  setInterval(() => { if (view === 'home') load(); }, 8000);
  setInterval(flush, 10000);
  window.addEventListener('online', flush);
}
