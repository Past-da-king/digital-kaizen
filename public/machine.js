// One machine in depth: status, the shift timeline, cycles, output, OEE, the mould
// gauge, shifts and recent stops. Everything the old floor card showed, plus the timeline.

import { mountHeader, live, api, $, esc, n0, n1, hm, spark, timeline, columns } from './ui.js';
import { stateOf, escalationLine } from './dashboard.js';

const cfg = await api('/api/config');
const params = new URLSearchParams(location.search);
const id = cfg.machines.some(m => m.id === params.get('m')) ? params.get('m') : cfg.machines[0].id;
const spec = cfg.machines.find(m => m.id === id);

await mountHeader({ active: '/machine.html', title: spec.name, sub: `${spec.mould?.name || ''} · ${spec.id} · ideal cycle ${spec.mould?.idealCycleSec} s` });
$('#msel').innerHTML = cfg.machines.map(m => `<a href="/machine.html?m=${m.id}" class="${m.id === id ? 'on' : ''}">${m.id}</a>`).join('');

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return fmt(d); };
const parse = (s) => new Date(String(s).replace(' ', 'T'));
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const M = { id, name: spec.name, part: spec.part, mould: spec.mould, rules: cfg.rules[id], live: { offline: true }, engine: {}, summary: {}, shifts: {}, recent: [], hourly: [], events: [], defectsToday: 0, trend: [], oee: {}, tl: null, issues: { open: [], acked: [] } };
const model = () => ({ machines: [M], oee: { machines: [{ machine_id: id, current: M.oee.current, day: M.oee.day }] }, timelines: { [id]: M.tl }, escalation: M.issues, ladder: cfg.ladder, limits: { downtimeMin: cfg.thresholds.downtimeMin } });

function draw() {
  const st = stateOf(M), sum = M.summary, cur = M.oee.current || {}, tl = M.tl;
  const last = tl?.segments?.at(-1), end = tl ? parse(tl.to) : new Date();
  const startedAt = last ? clock(new Date(end.getTime() - last[1] * 60000)) : null;
  const since = st.key === 'down'
    ? `<b>${esc(M.engine.gap_human || '')}</b>${startedAt && last[0] === 'd' ? ` &middot; stopped ${startedAt}` : ''}<br>${esc(M.eventReason || 'Reason not logged yet')} &middot; <b style="color:var(--down)">${esc(escalationLine(M, model()))}</b>`
    : st.key === 'run' ? `${startedAt && last[0] === 'r' ? `running since ${startedAt}` : 'producing'}${M.engine.gap_human ? `<br>last shot ${esc(M.engine.gap_human)} ago` : ''}`
    : st.key === 'idle' ? `no shot for <b>${esc(M.engine.gap_human || '')}</b><br>counts as downtime after ${M.rules?.downtimeSec ?? 120} s`
    : 'Nothing is reporting from this machine.<br>Pair a sensor on the Sensors page.';
  const ideal = M.mould?.idealCycleSec || 30;
  const p = M.live;
  const lo = p.sim_learned_min, hi = p.sim_learned_max, learned = lo != null && hi != null && hi > lo && !p.offline;
  const pos = learned ? Math.max(0, Math.min(100, ((p.distance_mm - lo) / (hi - lo)) * 100)) : 0;
  const closed = learned ? Math.max(0, Math.min(100, ((p.sim_closed_threshold - lo) / (hi - lo)) * 100)) : 0, open = learned ? Math.max(0, Math.min(100, ((p.sim_open_threshold - lo) / (hi - lo)) * 100)) : 100;
  const tick = (f) => tl ? clock(new Date(parse(tl.from).getTime() + f * (parse(tl.to) - parse(tl.from)))) : '';
  const tr = (k) => M.trend.map(t => t[k]);
  const fac = [['Availability', cur.availability, 'availability'], ['Performance', cur.performance, 'performance'], ['Quality', cur.quality, 'quality']];
  const sh = (n) => `<tr><td><b>${n}</b> ${n === 'A' ? '06:00 to 18:00' : '18:00 to 06:00'}${M.oee.currentShift === n ? ' <span class="tag st-run" style="margin-left:8px">now</span>' : ''}</td><td>${n0(M.shifts[n]?.shots)}</td><td>${n1(M.shifts[n]?.downtimeMin)} min</td><td><b>${M.oee.shifts?.[n]?.oee == null ? '—' : Math.round(M.oee.shifts[n].oee) + '%'}</b></td></tr>`;
  $('#mroot').innerHTML = `
  <div style="display:grid;gap:20px">
  <section class="tile ${st.cls}" style="grid-template-columns:minmax(0,1.1fr) minmax(0,2fr);align-items:center" id="head">
    <div><div class="tag" style="margin-bottom:14px">${esc(st.word)}</div><div class="big">${esc(st.word)}</div><div class="since">${since}</div></div>
    <div class="kp" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
      <div class="k"><div class="l">Shots today</div><div class="v" style="font-size:54px">${sum.shots ? n0(sum.shots) : '—'}</div><div class="n">${n0((sum.shots || 0) * (M.mould?.cavities || 1))} parts &middot; ${M.mould?.cavities || 1} cavity</div></div>
      <div class="k"><div class="l">Last cycle</div><div class="v">${p.last_cycle_sec && !p.offline ? n1(p.last_cycle_sec) : '—'}<small>s</small></div><div class="n">ideal ${n1(ideal)} s</div></div>
      <div class="k"><div class="l">Average cycle</div><div class="v">${sum.shots ? n1(sum.avgCycleSec) : '—'}<small>s</small></div><div class="n">best ${sum.shots ? n1(sum.bestCycleSec) : '—'} s</div></div>
      <div class="k"><div class="l">Defects today</div><div class="v" style="color:${M.defectsToday ? 'var(--idle)' : 'inherit'}">${n0(M.defectsToday)}</div><div class="n">limit ${cfg.thresholds.defectsPerShift} per shift</div></div>
    </div>
  </section>
  <div class="cols c12">
    <section class="card pad s8">
      <div class="card-h"><span class="eyebrow">State timeline</span><span class="r">shift ${esc(M.oee.currentShift || '')}, ${tl ? hm(tl.from) : ''} to now</span></div>
      ${tl?.segments?.length ? timeline(tl.segments) : '<div class="tl"><i class="o" style="flex:1"></i></div>'}
      <div class="tlx">${[0, .2, .4, .6, .8].map(f => `<span>${tick(f)}</span>`).join('')}<span>now</span></div>
      <div class="legend" style="margin-top:16px"><span><i style="background:var(--run)"></i>Running</span><span><i style="background:var(--idle)"></i>Idle (late cycle)</span><span><i style="background:var(--down)"></i>Down</span><span><i style="background:var(--plan)"></i>Planned stop</span><span><i style="background:var(--off)"></i>No data</span></div>
      <div style="margin-top:30px"><div class="eyebrow" style="margin-bottom:10px">Last 60 cycles <span style="text-transform:none;letter-spacing:0;font-weight:500">(dashed line is the ideal cycle)</span></div>
        <div style="position:relative;display:flex;gap:2px;align-items:end;height:90px">${M.recent.map(c => `<i title="${esc(c.timestamp)}, ${c.cycletime}s" style="flex:1;border-radius:2px;background:${c.class === 'cycle' ? 'var(--run)' : c.class === 'small_stop' ? 'var(--idle)' : 'var(--down)'};height:${Math.max(5, Math.min(100, c.class === 'cycle' ? c.cycletime / (ideal * 1.4) * 100 : 100))}%"></i>`).join('') || '<span class="part">No cycles yet</span>'}<u style="position:absolute;left:0;right:0;bottom:${100 / 1.4}%;border-top:1px dashed var(--faint)"></u></div></div>
      <div style="margin-top:30px"><div class="eyebrow" style="margin-bottom:10px">Shots per hour today</div>${columns(M.hourly.map(h => ({ l: `${String(h.bucket).slice(-5, -3)}:00`, parts: [[h.value, 'var(--plan)']] })), { h: 120, empty: 'No production today yet' })}</div>
    </section>
    <section class="card pad s4">
      <div class="card-h"><span class="eyebrow">OEE this shift</span></div>
      <div class="hero-n" style="font-size:96px">${cur.oee == null ? '—' : Math.round(cur.oee)}${cur.oee == null ? '' : '<small>%</small>'}</div>
      <div class="fac" style="grid-template-columns:1fr;margin-top:22px">${fac.map(([l, v, k]) => `<div class="f" style="display:grid;grid-template-columns:1fr 90px auto;gap:12px;align-items:center"><div class="l">${l}</div>${spark(tr(k))}<div class="v" style="font-size:26px">${v == null ? '—' : n1(v)}${v == null ? '' : '<small>%</small>'}</div></div>`).join('')}</div>
      <div style="margin-top:26px"><div class="eyebrow" style="margin-bottom:10px">Mould position</div>
        <div class="gauge ${learned ? '' : 'off'}"><div class="z" style="left:0;width:${closed}%;background:var(--run-t)"></div><div class="z" style="left:${open}%;right:0;background:var(--plan-t)"></div>${learned ? `<div class="pl" style="left:calc(${pos}% - 5px);background:${p.position === 'CLOSED' ? 'var(--run)' : p.position === 'OPEN' ? 'var(--plan)' : 'var(--idle)'}"></div>` : ''}</div>
        <div class="tlx"><span>closed</span><span>${p.offline ? '—' : Math.round(p.distance_mm ?? 0)} mm</span><span>open</span></div>
        <p class="part" style="margin-top:8px">${p.offline ? 'No sensor reporting.' : learned ? `Stroke learned: ${lo} to ${hi} mm` : p.sim_learn_failed ? `Learning failed: ${esc(p.sim_learn_failed)}` : `Learning the stroke: ${p.sim_learn_progress ?? 0} of 5 movements seen`}${p.device_ip ? ` &middot; sensor ${esc(p.device_ip)}${p.source ? ' over ' + esc(p.source) : ''}` : ''}</p></div>
    </section>
  </div>
  <div class="cols c12">
    <section class="card pad s6"><div class="card-h"><span class="eyebrow">Shifts today</span></div>
      <table><thead><tr><th>Shift</th><th>Shots</th><th>Down</th><th>OEE</th></tr></thead><tbody>${sh('A')}${sh('B')}</tbody></table>
      <div class="chips" style="margin-top:18px"><span class="chip">${sum.smallStops ?? 0} small stops<b>${n1(sum.smallStopMin)} min</b></span><span class="chip">${sum.downtimeEvents ?? 0} downtime events<b>${n1(sum.downtimeMin)} min</b></span></div></section>
    <section class="card pad s6"><div class="card-h"><span class="eyebrow">Recent stops</span><span class="r">sensor events and who explained them</span></div>
      <table><thead><tr><th>#</th><th>Started</th><th>Duration</th><th>Reason</th><th>Logged by</th></tr></thead><tbody>${M.events.map(e => `<tr><td>${e.id}</td><td>${esc(e.started_at.slice(5, 16))}</td><td>${e.duration_human || '<span class="un">running…</span>'}</td><td>${e.reason_label ? esc(e.reason_label) : '<span class="un">not explained</span>'}</td><td>${esc(e.attributed_by || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="part">No stops yet</td></tr>'}</tbody></table></section>
  </div></div>`;
}

async function fast() {
  const [lv, en] = await Promise.all([api('/api/live'), api('/api/engine')]);
  M.live = lv.machines.find(x => x.machine_id === id) || M.live;
  const e = en.machines.find(x => x.machine_id === id); if (e) { M.engine = e; M.rules = e.rules; }
  draw();
}
async function heavy() {
  const today = startOfDay();
  const [sum, shifts, oee, trend, tl, ev, q, esc] = await Promise.all([
    api(`/api/summary?machine=${id}`), api(`/api/shifts?machine=${id}&day=${today.slice(0, 10)}`), api('/api/oee'), api(`/api/oee/trend?machine=${id}&days=14`), api('/api/timeline'),
    api(`/api/events?machine=${id}&limit=8`), api(`/api/quality?machine=${id}&from=${today}`), api('/api/escalation'),
  ]);
  M.summary = sum.machines[0] || {}; M.shifts = shifts.machines[0]?.shifts || {};
  const mo = oee.machines.find(x => x.machine_id === id) || {};
  M.oee = { current: mo.current, day: mo.day, shifts: mo.shifts, currentShift: oee.currentShift };
  M.trend = trend.points; M.tl = tl.machines.find(x => x.machine_id === id); M.events = ev.events;
  M.defectsToday = q.defects.total; M.issues = esc;
  const open = ev.events.find(e => e.state === 'OPEN');
  M.eventReason = open ? (open.reason_label ? `${open.reason_label}${open.attributed_by ? ' (' + open.attributed_by + ')' : ''}` : 'Reason not logged yet') : '';
  const [recent, series] = await Promise.all([api(`/api/recent?machine=${id}&limit=60`), api(`/api/series?machine=${id}&metric=count&unit=hour&from=${today}`)]);
  M.recent = recent.shots; M.hourly = series.points;
  draw();
}
await fast(); await heavy();
setInterval(() => fast().catch(() => {}), 3000);
setInterval(() => heavy().catch(() => {}), 20000);
const es = new EventSource('/api/stream'); es.onopen = () => live(true); es.onerror = () => live(false);
