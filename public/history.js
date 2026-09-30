// History browser — the same five metrics and six groupings as the
// client's "History Data Browser (Production)" flow, plus the CSV
// export, but reading through one API instead of six flow-context
// variables that each have to be set before any SQL will run.

const $ = (id) => document.getElementById(id);
const cfg = await fetch('/api/config').then(r => r.json());

cfg.machines.forEach(m => $('machine').add(new Option(m.name, m.id)));
Object.entries(cfg.metrics).forEach(([v, l]) => $('metric').add(new Option(l, v)));

const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
$('to').value = iso(today);
$('from').value = iso(new Date(today.getTime() - 2 * 86400000));

if (cfg.range?.min) {
  $('range').textContent = `${cfg.range.n.toLocaleString()} shots recorded, ${shortBucket(cfg.range.min).slice(0,-6)} to ${shortBucket(cfg.range.max).slice(0,-6)}`;
}

function params() {
  return new URLSearchParams({
    machine: $('machine').value,
    metric: $('metric').value,
    unit: $('unit').value,
    from: `${$('from').value} 00:00:00`,
    to: `${$('to').value} 23:59:59`,
  });
}

async function load() {
  const p = params();
  const [series, sum, shots] = await Promise.all([
    fetch('/api/series?' + p).then(r => r.json()),
    fetch('/api/summary?' + p).then(r => r.json()),
    fetch('/api/shots?' + p + '&limit=500').then(r => r.json()),
  ]);

  $('chartTitle').textContent = series.label;
  $('chartSub').textContent = `${$('machine').value}, by ${series.unit}`;
  drawChart($('chart'), series.points);

  const s = sum.machines[0] || {};
  $('sum').innerHTML = [
    ['Shots', (s.shots ?? 0).toLocaleString(), ''],
    ['Average cycle', s.avgCycleSec ?? 0, 's'],
    ['Best cycle', s.bestCycleSec ?? 0, 's'],
    ['Availability', s.availabilityPct ?? 0, '%'],
    ['Small stops', `${s.smallStops ?? 0}`, `${s.smallStopMin ?? 0} min`],
    ['Downtime', `${s.downtimeEvents ?? 0}`, `${s.downtimeMin ?? 0} min`],
  ].map(([k, v, u]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}<span class="u">${u}</span></div></div>`).join('');

  $('rowCount').textContent = shots.truncated
    ? `Last 500 of ${shots.total.toLocaleString()}`
    : `${shots.total.toLocaleString()} shots`;
  $('rows').innerHTML = shots.shots.slice().reverse().map(r =>
    `<tr><td>${when(r.timestamp)}</td><td>${r.cycletime}</td><td><span class="tag ${r.class}">${r.class.replace('_',' ')}</span></td></tr>`
  ).join('') || `<tr><td colspan="3" class="empty">No shots in this window</td></tr>`;
}

// "2026-09-28 14:00" reads better on an axis as "28 Sep 14:00".
// A shot row's time: "30 Sep 17:36:45", on one line.
function when(ts) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d:\d\d)/.exec(ts || '');
  return m ? `<span style="white-space:nowrap">${shortBucket(ts).slice(0, -6)} ${m[4]}</span>` : ts;
}

function shortBucket(b) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = /^(\d{4})-(\d\d)-(\d\d)(?: (\d\d:\d\d))?/.exec(b);
  if (!m) return b;
  const day = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
  return m[4] ? `${day} ${m[4]}` : `${day} ${m[1]}`;
}

function drawChart(svg, pts) {
  drawChart.last = pts;
  // Drawn at the element's real pixel size so axis text is never stretched.
  const W = Math.max(280, Math.round(svg.clientWidth || 1000));
  const H = 340, padL = 48, padB = 30, padT = 12, padR = 4;
  const FONT = 'font-family="system-ui,sans-serif" font-size="12" fill="#8390a8"';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!pts.length) { svg.innerHTML = `<text x="${W/2}" y="${H/2}" ${FONT} font-size="14" text-anchor="middle">No data in this window</text>`; return; }

  const max = Math.max(1, ...pts.map(p => p.value));
  const y = (v) => H - padB - (v / max) * (H - padB - padT);
  const bw = (W - padL - padR) / pts.length;

  const grid = [0, .25, .5, .75, 1].map(f => {
    const v = Math.round(max * f * 10) / 10;
    return `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="#232c3d"/>
            <text x="${padL - 10}" y="${y(v) + 4}" ${FONT} text-anchor="end">${v}</text>`;
  }).join('');

  const bars = pts.map((p, i) =>
    `<rect x="${(padL + i * bw + 1).toFixed(1)}" y="${y(p.value).toFixed(1)}"
           width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(1, H - padB - y(p.value)).toFixed(1)}"
           fill="#4da3ff" opacity=".85" rx="2"><title>${shortBucket(p.bucket)}: ${p.value}</title></rect>`).join('');

  // One label about every 120px, level, so they never overlap or clip.
  const every = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor((W - padL - padR) / 120))));
  const labels = pts.map((p, i) => {
    if (i % every !== 0) return '';
    const x = padL + i * bw + bw / 2;
    if (x > W - 50) return '';             // a label that would run off the right edge
    return `<text x="${x.toFixed(1)}" y="${H - 8}" ${FONT} text-anchor="middle">${shortBucket(p.bucket)}</text>`;
  }).join('');

  svg.innerHTML = grid + bars + labels;
}
window.addEventListener('resize', () => drawChart($('chart'), drawChart.last || []));

$('go').onclick = load;
$('csv').onclick = () => { location.href = '/api/export.csv?' + params(); };
['machine','metric','unit'].forEach(id => $(id).onchange = load);
await load();
