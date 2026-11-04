import { mountHeader, api, $, esc, n0, n1, mins, hbars, stacked, barChart } from './ui.js';

await mountHeader({ active: '/quality.html', clock: false });
const cfg = await api('/api/config');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = new Date(), start = new Date(); start.setDate(start.getDate() - 13);
$('#from').value = iso(start); $('#to').value = iso(today);
$('#machine').innerHTML = '<option value="">All machines</option>' + cfg.machines.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
const COL = ['#ff5560', '#ffb938', '#5aa7ff', '#a98bff', '#2fd87a', '#ff8fb1', '#7fd6d0', '#c9a36a'];

async function load() {
  const m = $('#machine').value, qs = `from=${$('#from').value}&to=${$('#to').value}${m ? '&machine=' + m : ''}`;
  $('#csvDt').href = `/api/logs/downtime.csv?${qs}`; $('#csvDf').href = `/api/logs/defects.csv?${qs}`;
  const [q, dl, df] = await Promise.all([api(`/api/quality?${qs}`), api(`/api/logs/downtime?${qs}`), api(`/api/logs/defects?${qs}`)]);
  $('#kpis').innerHTML = [
    ['Defects', n0(q.defects.total)], ['Downtime logged', mins(q.downtime.totalMin)], ['of which planned', mins(q.downtime.plannedMin)],
    ['Stops not explained', `${q.downtime.unexplained.n} (${mins(q.downtime.unexplained.minutes)})`],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  hbars($('#reasons'), q.downtime.byReason.map((r, i) => ({ label: r.label, value: r.minutes, color: r.planned ? 'var(--accent)' : COL[i % COL.length] })), { unit: ' min', empty: 'No downtime logged in this period' });
  hbars($('#types'), q.defects.byType.map(t => ({ label: t.label, value: t.qty, color: 'var(--idle)' })), { empty: 'No defects logged in this period' });
  stacked($('#defDays'), q.series.map(d => ({ label: d.day.slice(5), parts: [{ key: 'd', value: d.defects }] })), { d: 'var(--idle)' }, { empty: 'No defects logged in this period' });
  barChart($('#dtDays'), q.series.map(d => ({ label: d.day.slice(5), value: d.downtimeMin })), { color: 'var(--down)', empty: 'No downtime logged in this period', fmt: (v) => `${v} min` });
  $('#defRows').innerHTML = df.rows.map(r => `<tr><td>${esc(r.occurred_at.slice(5, 16))}</td><td>${esc(r.machine_id)}</td><td><b>${r.qty}</b></td><td>${esc(r.type_label)}${r.photo ? ` <a href="/photos/${esc(r.photo)}" target="_blank">photo</a>` : ''}</td><td>${r.shift}</td><td>${esc(r.operator || '')}</td><td>${esc(r.note || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing logged</td></tr>';
  $('#dtRows').innerHTML = dl.rows.map(r => `<tr><td>${esc(r.started_at.slice(5, 16))}</td><td>${esc(r.machine_id)}</td><td><b>${n1(r.minutes)}</b></td><td>${esc(r.reason_label)}${r.planned ? ' <span class="part">planned</span>' : ''}${r.source === 'sensor' ? ' <span class="part">sensor</span>' : ''}</td><td>${r.shift}</td><td>${esc(r.operator || '')}</td><td>${esc(r.note || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing logged</td></tr>';
}
$('#go').onclick = load; $('#machine').onchange = load;
await load();
