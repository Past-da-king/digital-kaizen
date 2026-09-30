// Live floor view. Fed by /api/stream (SSE) for the instantaneous
// device state, and by the database for anything that has to be
// TRUE rather than merely reported — shift totals, averages,
// availability. The device's own shift fields are ignored on
// purpose; see the note in firmware.js.

const floor = document.getElementById('floor');
// Which machine(s) this screen is showing — set at boot from ?m=
let shown = [];
const dot = document.getElementById('dot');
const connText = document.getElementById('connText');
const cards = new Map();

let cfg = { machines: [] };

const fmt = {
  n: (v) => (v ?? 0).toLocaleString(),
  s: (v) => `${(v ?? 0).toFixed(1)}`,
  clock: (d) => d.toLocaleTimeString('en-GB'),
};

setInterval(() => document.getElementById('clock').textContent = fmt.clock(new Date()), 1000);

function card(m) {
  const el = document.createElement('section');
  el.className = 'card machine';
  el.innerHTML = `
    <div class="hd">
      <div><h2>${m.name}</h2>${m.part ? `<div class="part">${m.part}</div>` : ''}</div>
      <div class="spacer"></div>
      <span class="pill OFFLINE" data-r="pill">Offline</span>
    </div>
    <div class="bd">
      <div class="stats">
        <div class="stat big"><div class="k">Shots today</div><div class="v" data-r="shots">0</div></div>
        <div class="stat"><div class="k">Last cycle</div><div class="v" data-r="cycle">—</div></div>
        <div class="stat"><div class="k">Average cycle</div><div class="v" data-r="avg">—</div></div>
        <div class="stat"><div class="k">Availability</div><div class="v" data-r="avail">—</div></div>
      </div>

      <div class="dt" data-r="dt">
        <div><div class="lead" data-r="dtlead">No shot for</div><div class="big" data-r="dtbig">—</div></div>
        <div class="who" data-r="dtwho"></div>
      </div>

      <div class="mould">
        <div class="lbl"><span>Mould position</span><span data-r="dist">— mm</span></div>
        <div class="track" data-r="track">
          <div class="zone closed" data-r="zclosed"></div>
          <div class="zone open" data-r="zopen"></div>
          <div class="thr" data-r="tclosed" data-l="closed"></div>
          <div class="thr" data-r="topen" data-l="open"></div>
          <div class="platen" data-r="platen"></div>
        </div>
      </div>

      <p class="sect">Last 60 cycles</p>
      <svg class="spark" data-r="spark" style="height:22px"></svg>

      <p class="sect" style="margin-top:18px">Shots per hour today</p>
      <svg class="bars" data-r="bars" style="height:22px"></svg>

      <div class="shifts">
        <div class="shift"><div class="n">Shift A, 06:00 to 18:00</div>
          <div class="r"><span data-r="ashots">0 shots</span><span data-r="adown">0 min down</span></div></div>
        <div class="shift"><div class="n">Shift B, 18:00 to 06:00</div>
          <div class="r"><span data-r="bshots">0 shots</span><span data-r="bdown">0 min down</span></div></div>
      </div>

      <div class="meta">
        <span data-r="stops"></span>
        <span data-r="learn"></span>
        <span data-r="src"></span>
      </div>
    </div>`;
  floor.appendChild(el);
  const r = {};
  el.querySelectorAll('[data-r]').forEach(n => r[n.dataset.r] = n);
  cards.set(m.id, r);
  return r;
}

function paintLive(p) {
  const r = cards.get(p.machine_id);
  if (!r) return;

  const status = p.offline ? 'OFFLINE' : (p.status || 'OFFLINE');
  r.pill.className = 'pill ' + status.replace(/\s+/g, '');
  r.pill.textContent = status;

  r.dist.textContent = p.offline ? '— mm' : `${Math.round(p.distance_mm ?? 0)} mm`;
  r.cycle.innerHTML = (p.offline || !p.last_cycle_sec) ? '—' : `${fmt.s(p.last_cycle_sec)}<span class="u">s</span>`;
  r.offline = Boolean(p.offline);

  // Gauge: scale to the learned stroke, so it shows what the DEVICE
  // believes rather than what we know the machine to be.
  const lo = p.sim_learned_min, hi = p.sim_learned_max;
  const learned = lo != null && hi != null && hi > lo;
  // Until the stroke is learned there are no zones to draw, and two
  // threshold labels stacked at zero just look broken.
  r.track.classList.toggle('learned', learned && !p.offline);
  if (learned) {
    const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const c = pct(p.sim_closed_threshold), o = pct(p.sim_open_threshold);
    r.zclosed.style.left = '0%'; r.zclosed.style.width = c + '%';
    r.zopen.style.left = o + '%'; r.zopen.style.width = (100 - o) + '%';
    r.tclosed.style.left = c + '%'; r.topen.style.left = o + '%';
    r.platen.style.left = `calc(${pct(p.distance_mm)}% - 4px)`;
    r.platen.className = 'platen ' + (p.position || '');
    r.learn.textContent = `Stroke learned: ${lo} to ${hi} mm`;
  } else {
    r.learn.textContent = p.sim_learn_failed
      ? `Learning failed: ${p.sim_learn_failed}`
      : `Learning the stroke: ${p.sim_learn_progress ?? 0} of 5 movements seen`;
  }

  r.src.textContent = p.offline
    ? 'No sensor reporting. Pair one on the Sensors page.'
    : `Sensor ${p.device_ip || 'connected'}${p.source ? ' over ' + p.source : ''}`;
}

// ---- downtime engine state: the gap clock, the level, and which
// rungs of the escalation ladder have already fired.
async function refreshEngine() {
  const { machines } = await fetch('/api/engine').then(r => r.json());
  for (const e of machines) {
    const r = cards.get(e.machine_id); if (!r) continue;
    // A silent sensor is not a running machine. Say that, instead of
    // a gap clock that reads "normal" with nothing behind it.
    if (r.offline) {
      r.dt.className = 'dt';
      r.dtlead.textContent = 'No data from the sensor';
      r.dtbig.textContent = '';
      r.dtwho.textContent = 'Check it is switched on and paired';
      continue;
    }
    r.dt.className = 'dt ' + e.level;
    r.dtbig.textContent = e.gap_human;

    if (e.level === 'ok') {
      r.dtlead.textContent = 'No shot for';
      r.dtwho.innerHTML = `Normal. A stop counts at <b>${e.rules.downtimeSec}s</b>`;
    } else if (e.level === 'micro') {
      r.dtlead.textContent = 'Micro-stop';
      r.dtwho.innerHTML = `Recorded, <b>not</b> downtime yet. Becomes an event at ${e.rules.downtimeSec}s`;
    } else {
      r.dtlead.textContent = e.level === 'critical' ? 'Critical downtime' : 'Downtime event';
      const rungs = cfg.escalation.map(x =>
        `<span class="rung ${e.fired.includes(x.level) ? 'on' : ''}" title="${x.to} at ${x.afterMin}min"></span>`).join('');
      const last = cfg.escalation.filter(x => e.fired.includes(x.level)).pop();
      r.dtwho.innerHTML = `Event <b>${e.event_id}</b>, ${last ? `escalated to <b>${last.to}</b>` : 'alerting'}${rungs}`;
    }
  }
}

async function refreshFromDb() {
  const day = new Date();
  const dayIso = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
  const [sum, shifts] = await Promise.all([
    fetch('/api/summary').then(r => r.json()),
    fetch(`/api/shifts?day=${dayIso}`).then(r => r.json()),
  ]);

  for (const s of sum.machines) {
    const r = cards.get(s.machine_id); if (!r) continue;
    r.shots.textContent = s.shots ? fmt.n(s.shots) : '—';
    r.avg.innerHTML = s.shots ? `${fmt.s(s.avgCycleSec)}<span class="u">s</span>` : '—';
    const a = s.availabilityPct;
    r.avail.innerHTML = s.shots ? `${fmt.s(a)}<span class="u">%</span>` : '—';
    r.avail.className = 'v ' + (!s.shots ? '' : a >= 85 ? 'green' : a >= 65 ? 'amber' : 'red');
    r.stops.textContent = s.shots
      ? `Today: ${s.smallStops} small stops (${fmt.s(s.smallStopMin)} min), ${s.downtimeEvents} downtime (${fmt.s(s.downtimeMin)} min)`
      : 'No production recorded yet today';
  }
  for (const m of shifts.machines) {
    const r = cards.get(m.machine_id); if (!r) continue;
    r.ashots.textContent = `${fmt.n(m.shifts.A.shots)} shots`;
    r.adown.textContent = `${fmt.s(m.shifts.A.downtimeMin)} min down`;
    r.bshots.textContent = `${fmt.n(m.shifts.B.shots)} shots`;
    r.bdown.textContent = `${fmt.s(m.shifts.B.downtimeMin)} min down`;
  }

  for (const m of shown) {
    const r = cards.get(m.id); if (!r) continue;
    const [recent, series] = await Promise.all([
      fetch(`/api/recent?machine=${m.id}&limit=60`).then(r => r.json()),
      fetch(`/api/series?machine=${m.id}&metric=count&unit=hour`).then(r => r.json()),
    ]);
    lastCharts.set(r, { shots: recent.shots, points: series.points });
    drawSpark(r.spark, recent.shots);
    drawBars(r.bars, series.points);
  }
}

const COLOUR = { cycle: '#3ddc84', small_stop: '#ffb020', downtime: '#ff4d4f', non_scheduled: '#54607a' };

// Charts are drawn at the element's real pixel size. A fixed viewBox
// stretched to fit squeezed the axis text to half width on a phone.
const FONT = 'font-family="system-ui,sans-serif" font-size="12" fill="#8390a8"';
const size = (svg, h) => {
  const W = Math.max(240, Math.round(svg.clientWidth || 600));
  svg.setAttribute('viewBox', `0 0 ${W} ${h}`);
  return W;
};

// An empty chart takes one line, not the full height of a chart.
function empty(svg, text) {
  svg.style.height = '22px';
  svg.setAttribute('viewBox', `0 0 ${Math.max(240, Math.round(svg.clientWidth || 600))} 22`);
  svg.innerHTML = `<text x="0" y="15" ${FONT}>${text}</text>`;
}

function drawSpark(svg, shots) {
  const H = 56, pad = 4, W = size(svg, H);
  if (!shots.length) { empty(svg, 'No cycles yet'); return; }
  svg.style.height = '';
  // Clamp the scale to normal cycles so one 20-minute stop does not
  // flatten every real cycle into the baseline.
  const normals = shots.filter(s => s.class === 'cycle').map(s => s.cycletime);
  const max = Math.max(...(normals.length ? normals : [1])) * 1.25;
  const bw = W / shots.length;
  svg.innerHTML = shots.map((s, i) => {
    const h = Math.max(2, Math.min(H - pad * 2, (Math.min(s.cycletime, max) / max) * (H - pad * 2)));
    return `<rect x="${(i * bw).toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${Math.max(1, bw - 1.5).toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${COLOUR[s.class]}" opacity="${s.class === 'cycle' ? .85 : 1}"><title>${s.timestamp}, ${s.cycletime}s, ${s.class.replace('_',' ')}</title></rect>`;
  }).join('');
}

function drawBars(svg, pts) {
  const H = 150, padL = 34, padB = 22, padT = 8, W = size(svg, H);
  if (!pts.length) { empty(svg, 'No production today yet'); return; }
  svg.style.height = '';
  const max = Math.max(1, ...pts.map(p => p.value));
  const bw = (W - padL) / pts.length;
  const y = (v) => H - padB - (v / max) * (H - padB - padT);
  const grid = [0, .5, 1].map(f => {
    const v = Math.round(max * f);
    return `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#232c3d"/>
            <text x="0" y="${y(v) + 4}" ${FONT}>${v}</text>`;
  }).join('');
  const bars = pts.map((p, i) => {
    const h = Math.max(1, H - padB - y(p.value));
    return `<rect x="${(padL + i * bw + 1).toFixed(1)}" y="${y(p.value).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="#4da3ff" opacity=".85" rx="2"><title>${p.bucket}: ${p.value}</title></rect>`;
  }).join('');
  // One hour label about every 70px, so they never touch.
  const every = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor((W - padL) / 70))));
  const labels = pts.map((p, i) => (i % every === 0 && padL + i * bw + bw / 2 < W - 18)
    ? `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - 5}" ${FONT} text-anchor="middle">${p.bucket.slice(-5)}</text>` : '').join('');
  svg.innerHTML = grid + bars + labels;
}

// Redraw at the new width when the window or the phone is turned.
let lastCharts = new Map();
window.addEventListener('resize', () => {
  for (const [r, d] of lastCharts) { drawSpark(r.spark, d.shots); drawBars(r.bars, d.points); }
});

// ---- boot
cfg = await fetch('/api/config').then(r => r.json());

// Which machine are we looking at? Kept in the URL so a screen mounted
// at MA1 can be pinned to MA1 and survive a reload.
const only = new URLSearchParams(location.search).get('m');
shown = cfg.machines.filter(m => !only || m.id === only);

if (cfg.machines.length > 1) {
  document.getElementById('filter').innerHTML =
    `<span class="lbl">Show</span>` +
    `<a href="/" class="${only ? '' : 'on'}">All machines</a>` +
    cfg.machines.map(m =>
      `<a href="/?m=${m.id}" class="${only === m.id ? 'on' : ''}">${m.id}</a>`).join('');
} else {
  document.getElementById('filter').remove();
}

shown.forEach(card);
await refreshFromDb();
setInterval(refreshFromDb, 10000);
await refreshEngine();
setInterval(refreshEngine, 1000);

// ---- demo controls. Present only when virtual machines are running;
// against real hardware there is nothing to force.
if (cfg.demo) {
  document.getElementById('demo').innerHTML =
    `<span class="t">Demo controls</span>` +
    cfg.machines.map(m => `<button class="ghost" data-stop="${m.id}">Stop ${m.id} for 12 min</button>`).join('') +
    cfg.machines.map(m => `<button class="ghost" data-start="${m.id}">Restart ${m.id}</button>`).join('') +
    `<span class="hint">${cfg.alertScale > 1 ? `Escalation running ${cfg.alertScale} times faster` : 'Stops a simulated machine so the downtime and alert flow can be shown live'}</span>`;

  document.getElementById('demo').onclick = async (e) => {
    const stop = e.target.dataset?.stop, start = e.target.dataset?.start;
    if (stop) await fetch('/api/demo/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machine: stop, seconds: 720 }) });
    if (start) await fetch('/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machine: start }) });
  };
} else {
  document.getElementById('demo').remove();
}

const es = new EventSource('/api/stream');
es.onopen = () => { dot.classList.add('live'); connText.textContent = 'live'; };
es.onerror = () => { dot.classList.remove('live'); connText.textContent = 'reconnecting'; };
es.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'hello') msg.machines.forEach(paintLive);
  if (msg.type === 'live') paintLive(msg.machine);
};
