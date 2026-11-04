import { mountHeader, api, $, $$, esc, n0, n1, mins, spark, hbars, columns, line } from './ui.js';

await mountHeader({ active: '/quality.html', clock: false });
const cfg = await api('/api/config');
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
$('#machine').innerHTML = '<option value="">All machines</option>' + cfg.machines.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
let days = 14;
const COL = ['var(--down)', 'var(--idle)', 'var(--plan)', '#a98bff', 'var(--run)', '#ff8fb1', '#7fd6d0'];
const avg = (a) => { const v = a.filter(x => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 10) / 10 : null; };

async function load() {
  const m = $('#machine').value;
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
  const qs = `from=${iso(from)}&to=${iso(new Date())}${m ? '&machine=' + m : ''}`;
  $('#csvDt').href = `/api/logs/downtime.csv?${qs}`; $('#csvDf').href = `/api/logs/defects.csv?${qs}`;
  const [q, dl, df, tr, oee] = await Promise.all([api(`/api/quality?${qs}`), api(`/api/logs/downtime?${qs}`), api(`/api/logs/defects?${qs}`), api(`/api/oee/trend?days=${Math.max(days, 2)}${m ? '&machine=' + m : ''}`), api('/api/oee')]);
  const pts = tr.points;
  const o = avg(pts.map(p => p.oee)), a = avg(pts.map(p => p.availability)), p = avg(pts.map(p => p.performance)), qq = avg(pts.map(p => p.quality));
  const best = pts.filter(x => x.oee != null).sort((x, y) => y.oee - x.oee)[0], worst = pts.filter(x => x.oee != null).sort((x, y) => x.oee - y.oee)[0];
  $('#trendSub').textContent = `${m || 'whole plant'}, daily`;
  $('#top').innerHTML = `
    <section class="card pad s4"><div class="card-h"><span class="eyebrow">OEE, ${days === 1 ? 'today' : days + ' days'}</span></div>
      <div class="hero-n" style="font-size:96px">${o == null ? '—' : o}${o == null ? '' : '<small>%</small>'}</div>
      <div class="chips" style="margin-top:14px">${best ? `<span class="chip">Best day<b>${Math.round(best.oee)}% (${esc(best.day.slice(5))})</b></span>` : ''}${worst ? `<span class="chip">Worst<b>${Math.round(worst.oee)}% (${esc(worst.day.slice(5))})</b></span>` : ''}</div></section>
    ${[['Availability', a, 'availability'], ['Performance', p, 'performance'], ['Quality', qq, 'quality']].map(([l, v, k]) => `<section class="card pad s2"><div class="card-h"><span class="eyebrow">${l}</span></div><div class="k"><div class="v" style="font-size:44px">${v == null ? '—' : v}${v == null ? '' : '<small>%</small>'}</div></div>${spark(pts.map(x => x[k]), { h: 46 })}</section>`).join('')}
    <section class="card pad s2"><div class="card-h"><span class="eyebrow">Defects</span></div><div class="k"><div class="v" style="font-size:44px;color:var(--idle)">${n0(q.defects.total)}</div><div class="n">${mins(q.downtime.totalMin)} downtime logged</div></div></section>`;
  line($('#trend'), pts.map(x => ({ l: x.day.slice(5), v: x.oee })), { h: 230, target: 85 });

  const tot = (a) => a.reduce((s, x) => s + x, 0);
  const share = (items, total) => items.length >= 2 && total ? `<div class="chips" style="margin-top:16px"><span class="chip">Top 2 causes<b>${Math.round((items[0] + items[1]) / total * 100)}% of the total</b></span></div>` : '';
  const dtv = q.downtime.byReason.map(r => r.minutes);
  $('#par').innerHTML = `
    <section class="card pad s6"><div class="card-h"><span class="eyebrow">Downtime by reason</span><span class="r">${mins(q.downtime.totalMin)} logged &middot; ${mins(q.downtime.plannedMin)} planned</span></div>
      ${hbars(q.downtime.byReason.map((r, i) => ({ n: r.label, v: r.minutes, c: r.planned ? 'var(--plan)' : COL[i % COL.length] })), { unit: 'm', empty: 'No downtime logged in this period' })}${share(dtv, tot(dtv))}
      ${q.downtime.unexplained.n ? `<p class="part" style="margin-top:12px;color:var(--idle)">${q.downtime.unexplained.n} stop${q.downtime.unexplained.n > 1 ? 's' : ''} (${mins(q.downtime.unexplained.minutes)}) not explained yet. Scan the QR on the machine to log why.</p>` : ''}</section>
    <section class="card pad s6"><div class="card-h"><span class="eyebrow">Defects by type</span><span class="r">${n0(q.defects.total)} in the period</span></div>
      ${hbars(q.defects.byType.map(t => ({ n: t.label, v: t.qty })), { color: 'var(--idle)', empty: 'No defects logged in this period' })}${share(q.defects.byType.map(t => t.qty), q.defects.total)}</section>`;

  const byM = (id, sh) => oee.machines.find(x => x.machine_id === id)?.shifts?.[sh]?.oee;
  const pc = (v) => v == null ? '—' : Math.round(v) + '%';
  $('#mid').innerHTML = `
    <section class="card pad s7"><div class="card-h"><span class="eyebrow">Defects per day</span></div>
      ${columns(q.series.map(d => ({ l: d.day.slice(5), parts: [[d.defectsA || 0, 'var(--down)'], [d.defectsB || 0, 'var(--idle)']] })), { h: 190, every: Math.ceil(q.series.length / 8), empty: 'No defects logged in this period' })}
      <div class="legend" style="margin-top:14px"><span><i style="background:var(--idle)"></i>Shift B</span><span><i style="background:var(--down)"></i>Shift A</span></div></section>
    <section class="card pad s5"><div class="card-h"><span class="eyebrow">By machine and shift</span><span class="r">OEE today</span></div>
      <table><thead><tr><th></th><th>OEE A</th><th>OEE B</th><th>Defects</th></tr></thead><tbody>${cfg.machines.filter(x => !m || x.id === m).map(x => `<tr><td><b>${esc(x.id)}</b></td><td>${pc(byM(x.id, 'A'))}</td><td>${pc(byM(x.id, 'B'))}</td><td>${n0(q.defects.byMachine.find(d => d.machine_id === x.id)?.qty || 0)}</td></tr>`).join('')}</tbody></table></section>`;

  $('#defRows').innerHTML = df.rows.map(r => `<tr><td>${esc(r.occurred_at.slice(5, 16))}</td><td>${esc(r.machine_id)}</td><td><b>${r.qty}</b></td><td>${esc(r.type_label)}${r.photo ? ` <a href="/photos/${esc(r.photo)}" target="_blank" style="color:var(--brand)">photo</a>` : ''}</td><td>${r.shift}</td><td>${esc(r.operator || '')}</td><td>${esc(r.note || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="part">Nothing logged</td></tr>';
  $('#dtRows').innerHTML = dl.rows.map(r => `<tr><td>${esc(r.started_at.slice(5, 16))}</td><td>${esc(r.machine_id)}</td><td><b>${n1(r.minutes)}</b></td><td>${esc(r.reason_label)}${r.planned ? ' <span class="part">planned</span>' : ''}${r.source === 'sensor' ? ' <span class="part">sensor</span>' : ''}</td><td>${r.shift}</td><td>${esc(r.operator || '')}</td><td>${esc(r.note || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="part">Nothing logged</td></tr>';
}
$$('#rng button').forEach(b => b.onclick = () => { days = Number(b.dataset.d); $$('#rng button').forEach(x => x.classList.toggle('on', x === b)); load(); });
$('#machine').onchange = load;
await load();
