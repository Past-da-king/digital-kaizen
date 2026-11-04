// The live floor page: builds the model from the API and hands it to the
// renderers in dashboard.js. Status is refreshed every 3 seconds, the heavier
// figures (OEE, quality, charts) every 20.

import { mountHeader, live, api, postJson, $ } from './ui.js';
import { renderAndon, renderOee, renderLists, renderRows } from './dashboard.js';

const now0 = new Date();
const subline = `${now0.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, shift ${now0.getHours() >= 6 && now0.getHours() < 18 ? 'A (06:00 to 18:00)' : 'B (18:00 to 06:00)'}`;
const me = await mountHeader({ active: '/', sub: subline });
const cfg = await api('/api/config');
const only = new URLSearchParams(location.search).get('m');
const ids = cfg.machines.filter(m => !only || m.id === only).map(m => m.id);

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const startOfDay = (back = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - back); return fmt(d); };

const model = {
  machines: [], oee: null, trend: [], quality: null, escalation: { open: [], acked: [], mail: {} }, feed: [], timelines: {},
  limits: cfg.thresholds ? { downtimeMin: cfg.thresholds.downtimeMin, defectsPerShift: cfg.thresholds.defectsPerShift } : {}, ladder: cfg.ladder,
};
const byId = {};
for (const m of cfg.machines.filter(m => ids.includes(m.id))) {
  byId[m.id] = { id: m.id, name: m.name, part: m.part, mould: m.mould, live: { offline: true }, engine: {}, rules: cfg.rules[m.id], summary: {}, shifts: {}, recent: [], hourly: [], defectsToday: 0 };
  model.machines.push(byId[m.id]);
}

let ready = false;
async function fast() {
  const [lv, en] = await Promise.all([api('/api/live'), api('/api/engine')]);
  for (const p of lv.machines) if (byId[p.machine_id]) byId[p.machine_id].live = p;
  for (const e of en.machines) if (byId[e.machine_id]) { byId[e.machine_id].engine = e; byId[e.machine_id].rules = e.rules; }
  if (ready) renderAndon($('#andon'), model);
}

async function heavy() {
  const today = startOfDay();
  const [sum, oee, trend, q, qDay, esc, dl, df, tl] = await Promise.all([
    api('/api/summary'), api('/api/oee'), api('/api/oee/trend?days=14'),
    api(`/api/quality?from=${startOfDay(13)}`), api(`/api/quality?from=${today}`), api('/api/escalation'),
    api(`/api/logs/downtime?from=${startOfDay(2)}&limit=20`), api(`/api/logs/defects?from=${startOfDay(2)}&limit=20`), api('/api/timeline'),
  ]);
  model.oee = oee; model.trend = trend.points; model.quality = q; model.escalation = esc;
  model.timelines = Object.fromEntries(tl.machines.map(t => [t.machine_id, t]));
  for (const s of sum.machines) if (byId[s.machine_id]) byId[s.machine_id].summary = s;
  for (const d of qDay.defects.byMachine) if (byId[d.machine_id]) byId[d.machine_id].defectsToday = d.qty;
  for (const m of model.machines) {
    const [recent, series, ev] = await Promise.all([api(`/api/recent?machine=${m.id}&limit=60`), api(`/api/series?machine=${m.id}&metric=count&unit=hour&from=${today}`), api(`/api/events?machine=${m.id}&limit=1`)]);
    m.recent = recent.shots; m.hourly = series.points;
    const e = ev.events[0];
    m.eventReason = e && e.state === 'OPEN' ? (e.reason_label ? `${e.reason_label}${e.attributed_by ? ' (' + e.attributed_by + ')' : ''}` : 'reason not logged yet') : '';
  }
  model.feed = [
    ...dl.rows.map(r => ({ kind: 'downtime', machine: r.machine_id, text: `${r.reason_label}, ${Math.round(r.minutes)} min`, by: r.operator, at: r.logged_at, note: r.note })),
    ...df.rows.map(r => ({ kind: 'defects', machine: r.machine_id, text: `${r.qty} x ${r.type_label}`, by: r.operator, at: r.logged_at, note: r.note })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  ready = true;
  renderAndon($('#andon'), model); renderOee($('#oee'), model); renderLists($('#lists'), model); renderRows($('#rows'), model);
}

await fast(); await heavy();
setInterval(() => fast().catch(() => {}), 3000);
setInterval(() => heavy().catch(() => {}), 20000);

const es = new EventSource('/api/stream');
es.onopen = () => live(true); es.onerror = () => live(false);

// Demo controls exist only while simulated machines are running.
if (cfg.demo && me?.role !== 'viewer' && me?.role !== 'manager') {
  $('#demo').innerHTML = `<span class="t">Demo controls</span>` +
    cfg.machines.map(m => `<button class="ghost" data-stop="${m.id}">Stop ${m.id} for 12 min</button>`).join('') +
    cfg.machines.map(m => `<button class="ghost" data-start="${m.id}">Restart ${m.id}</button>`).join('');
  $('#demo').onclick = async (e) => {
    if (e.target.dataset?.stop) await postJson('/api/demo/stop', { machine: e.target.dataset.stop, seconds: 720 });
    if (e.target.dataset?.start) await postJson('/api/demo/start', { machine: e.target.dataset.start });
  };
}
