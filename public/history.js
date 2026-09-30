// History browser — the same five metrics and six groupings as the
// client's "History Data Browser (Production)" flow, plus the CSV
// export, but reading through one API instead of six flow-context
// variables that each have to be set before any SQL will run.

const $ = (id) => document.getElementById(id);
const cfg = await fetch('/api/config').then(r => r.json());

cfg.machines.forEach(m => $('machine').add(new Option(`${m.id} — ${m.name}`, m.id)));
Object.entries(cfg.metrics).forEach(([v, l]) => $('metric').add(new Option(l, v)));

const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
$('to').value = iso(today);
$('from').value = iso(new Date(today.getTime() - 2 * 86400000));

if (cfg.range?.min) {
  $('range').textContent = `${cfg.range.n.toLocaleString()} shot rows · ${cfg.range.min.slice(0,16)} → ${cfg.range.max.slice(0,16)}`;
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
  $('chartSub').textContent = `${$('machine').value} · by ${series.unit} · ${series.points.length} buckets`;
  drawChart($('chart'), series.points, series.label);

  const s = sum.machines[0] || {};
  $('sum').innerHTML = [
    ['Shots', s.shots ?? 0, ''],
    ['Avg cycle', s.avgCycleSec ?? 0, 's'],
    ['Best cycle', s.bestCycleSec ?? 0, 's'],
    ['Availability', s.availabilityPct ?? 0, '%'],
    ['Small stops', `${s.smallStops ?? 0}`, `· ${s.smallStopMin ?? 0} min`],
    ['Downtime', `${s.downtimeEvents ?? 0}`, `· ${s.downtimeMin ?? 0} min`],
  ].map(([k, v, u]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}<span class="u">${u}</span></div></div>`).join('');

  $('rowCount').textContent = shots.truncated
    ? `showing the last 500 of ${shots.total.toLocaleString()} in this window`
    : `${shots.total.toLocaleString()} in this window`;
  $('rows').innerHTML = shots.shots.slice().reverse().map(r =>
    `<tr><td>${r.timestamp}</td><td>${r.cycletime}</td><td><span class="tag ${r.class}">${r.class.replace('_',' ')}</span></td></tr>`
  ).join('') || `<tr><td colspan="3" class="empty">no rows in this window</td></tr>`;
}

function drawChart(svg, pts, label) {
  const W = 1000, H = 340, padL = 52, padB = 34, padT = 14, padR = 10;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!pts.length) { svg.innerHTML = `<text x="${W/2}" y="${H/2}" fill="#5a657d" font-size="14" text-anchor="middle">no data in this window</text>`; return; }

  const max = Math.max(1, ...pts.map(p => p.value));
  const y = (v) => H - padB - (v / max) * (H - padB - padT);
  const bw = (W - padL - padR) / pts.length;

  const grid = [0, .25, .5, .75, 1].map(f => {
    const v = Math.round(max * f * 10) / 10;
    return `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="#232c3d"/>
            <text x="${padL - 8}" y="${y(v) + 4}" fill="#5a657d" font-size="11" font-family="monospace" text-anchor="end">${v}</text>`;
  }).join('');

  const bars = pts.map((p, i) =>
    `<rect x="${(padL + i * bw + 1).toFixed(1)}" y="${y(p.value).toFixed(1)}"
           width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(1, H - padB - y(p.value)).toFixed(1)}"
           fill="#4da3ff" opacity=".85" rx="2"><title>${p.bucket} · ${p.value}</title></rect>`).join('');

  const every = Math.ceil(pts.length / 14);
  const labels = pts.map((p, i) => i % every === 0
    ? `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - 12}" fill="#5a657d" font-size="10.5"
        font-family="monospace" text-anchor="middle" transform="rotate(-30 ${(padL + i * bw + bw/2).toFixed(1)} ${H - 12})">${p.bucket}</text>` : '').join('');

  svg.innerHTML = grid + bars + labels +
    `<text x="12" y="${padT + 4}" fill="#8592ab" font-size="11" font-family="system-ui">${label}</text>`;
}

$('go').onclick = load;
$('csv').onclick = () => { location.href = '/api/export.csv?' + params(); };
['machine','metric','unit'].forEach(id => $(id).onchange = load);
await load();
