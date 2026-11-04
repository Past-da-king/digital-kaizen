// The live floor, drawn from one plain "model" object built by live.js (or by a
// test). Same content as ever: shots, cycles, availability, OEE, stops, shifts,
// escalations, downtime, defects and what operators just logged. The layout is
// the v2 floor-board: machine status first, OEE as the hero.

import { esc, n0, n1, hm, mins, spark, timeline, hbars, line, columns } from './ui.js';

const $ = (s, r) => r.querySelector(s);

// ---- what state is a machine in, in the words the floor uses
export function stateOf(m) {
  const live = m.live || {}, eng = m.engine || {};
  if (live.offline || !live.status || live.status === 'OFFLINE') return { key: 'off', cls: 'st-off', word: 'No sensor' };
  if (eng.level === 'downtime' || eng.level === 'critical' || live.status === 'DOWNTIME') return { key: 'down', cls: 'st-down', word: 'Down' };
  if (live.status === 'LEARNING') return { key: 'idle', cls: 'st-idle', word: 'Starting' };
  if (eng.level === 'micro' || live.status === 'CYCLE DELAY') return { key: 'idle', cls: 'st-idle', word: 'Idle' };
  return { key: 'run', cls: 'st-run', word: 'Running' };
}

const clock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const parse = (s) => new Date(String(s).replace(' ', 'T'));

// "Level 1 told, Level 2 at 10:40", or when it will start
export function escalationLine(m, model) {
  const issue = [...(model.escalation?.open || []), ...(model.escalation?.acked || [])].find(i => i.machine_id === m.id && i.kind === 'downtime');
  const ladder = model.ladder || [];
  if (!issue) return `Escalates after ${model.limits?.downtimeMin ?? 10} min`;
  if (issue.state === 'ACKED') return `Acknowledged${issue.acked_by ? ' by ' + issue.acked_by : ''}`;
  const reached = issue.level_reached || 0;
  const next = ladder.find(l => l.level > reached);
  const when = next ? clock(new Date(parse(issue.opened_at).getTime() + next.afterMin * 60000)) : null;
  return reached ? `Level ${reached} told${next ? `, Level ${next.level} at ${when}` : ', last level'}` : 'Not told yet';
}

function sinceLine(m, model) {
  const st = stateOf(m), tl = model.timelines?.[m.id];
  const last = tl?.segments?.at(-1);
  const end = tl ? parse(tl.to) : new Date();
  const startedAt = last ? clock(new Date(end.getTime() - last[1] * 60000)) : null;
  if (st.key === 'run') return `${startedAt && last[0] === 'r' ? `running since ${startedAt}` : 'producing'}${m.engine?.gap_human ? ` &middot; last shot ${esc(m.engine.gap_human)} ago` : ''}`;
  if (st.key === 'idle') return `no shot for <b>${esc(m.engine?.gap_human || '')}</b>. Counts as downtime after ${m.rules?.downtimeSec ?? 120} s`;
  if (st.key === 'down') return `<b>${esc(m.engine?.gap_human || '')}</b>${startedAt && last[0] === 'd' ? ` &middot; stopped ${startedAt}` : ''} &middot; ${esc(m.eventReason || 'reason not logged yet')} &middot; <b style="color:var(--down)">${esc(escalationLine(m, model))}</b>`;
  return 'Nothing is reporting from this machine. Pair a sensor on the Sensors page.';
}

function tile(m, model) {
  const st = stateOf(m), sum = m.summary || {}, o = (model.oee?.machines || []).find(x => x.machine_id === m.id) || {}, cur = o.current || {};
  const tl = model.timelines?.[m.id];
  const ticks = tl ? [0, .33, .66].map(f => clock(new Date(parse(tl.from).getTime() + f * (parse(tl.to) - parse(tl.from))))).concat('now') : [];
  return `<a class="tile ${st.cls}" href="/machine.html?m=${esc(m.id)}" data-m="${esc(m.id)}">
    <div class="top"><div><div class="nm">${esc(m.name)}</div><div class="md">${esc(m.mould?.name || '')}${m.part ? ' &middot; ' + esc(m.part) : ''} &middot; ${esc(m.id)}</div></div><div style="margin-left:auto" class="tag">${esc(st.word)}</div></div>
    <div><div class="big">${esc(st.word)}</div><div class="since">${sinceLine(m, model)}</div></div>
    <div class="kp">
      <div class="k"><div class="l">Shots today</div><div class="v">${sum.shots ? n0(sum.shots) : '—'}</div></div>
      <div class="k"><div class="l">Last cycle</div><div class="v">${m.live?.last_cycle_sec && !m.live.offline ? n1(m.live.last_cycle_sec) : '—'}<small>s</small></div><div class="n">ideal ${n1(m.mould?.idealCycleSec)} s</div></div>
      <div class="k"><div class="l">Average</div><div class="v">${sum.shots ? n1(sum.avgCycleSec) : '—'}<small>s</small></div></div>
      <div class="k"><div class="l">Availability</div><div class="v">${sum.shots ? n1(sum.availabilityPct) : '—'}<small>%</small></div></div>
    </div>
    <div><div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--faint);margin-bottom:6px"><span class="eyebrow">This shift</span><span>OEE <b style="color:var(--ink)">${cur.oee == null ? '—' : Math.round(cur.oee) + '%'}</b> &middot; ${n0(m.defectsToday || 0)} defects today</span></div>
      ${tl?.segments?.length ? timeline(tl.segments) : '<div class="tl"><i class="o" style="flex:1"></i></div>'}
      <div class="tlx">${ticks.map(t => `<span>${t}</span>`).join('')}</div></div>
  </a>`;
}

export function renderAndon(root, model) { root.innerHTML = model.machines.map(m => tile(m, model)).join(''); }

export function renderOee(root, model) {
  const p = model.oee?.plant?.day || {}, cur = model.oee?.plant?.current || {};
  const a = p.availability, pf = p.performance, q = p.quality, oee = p.oee;
  const tr = model.trend || [];
  const today = tr.at(-1), yest = tr.at(-2);
  const delta = today?.oee != null && yest?.oee != null ? Math.round((today.oee - yest.oee) * 10) / 10 : null;
  const planned = Math.round((model.oee?.machines || []).reduce((s, m) => s + (m.day?.plannedMin || 0), 0) / Math.max(1, model.machines.length));
  const stopsLoss = a == null ? null : 100 - a, speedLoss = a == null || pf == null ? null : a * (1 - pf / 100), qualLoss = a == null || pf == null || q == null ? null : a * pf / 100 * (1 - q / 100);
  const row = (label, bar, val, colour) => `<div class="row"><span class="t">${label}</span><span class="bar">${bar}</span><span class="v" style="${colour ? 'color:' + colour : ''}">${val}</span></div>`;
  const seg = (l, w, c) => `<i style="left:${l}%;width:${Math.max(0, w)}%;background:${c}"></i>`;
  root.innerHTML = `
  <section class="card pad s5">
    <div class="card-h"><span class="eyebrow">Plant OEE, today</span><span class="r">Availability x Performance x Quality</span></div>
    <div style="display:flex;align-items:flex-end;gap:22px;flex-wrap:wrap"><div class="hero-n">${oee == null ? '—' : n1(oee)}${oee == null ? '' : '<small>%</small>'}</div>
      ${delta == null ? '' : `<div style="padding-bottom:10px"><span class="delta ${delta < 0 ? 'neg' : ''}">${delta < 0 ? '&#9660;' : '&#9650;'} ${Math.abs(delta)} pts</span><div style="font-size:13px;color:var(--faint)">vs yesterday</div></div>`}</div>
    <div class="target"><i style="width:${oee == null ? 0 : Math.min(100, oee)}%;--bar:${oee == null ? 'var(--off)' : oee >= 85 ? 'var(--run)' : oee >= 60 ? 'var(--idle)' : 'var(--down)'}"></i><u style="left:85%"></u><em style="left:85%">TARGET 85</em></div>
    <div class="fac" style="margin-top:28px">${[['Availability', a, 'availability'], ['Performance', pf, 'performance'], ['Quality', q, 'quality']].map(([l, v, k]) => `<div class="f"><div class="l">${l}</div><div class="v">${v == null ? '—' : n1(v)}${v == null ? '' : '<small>%</small>'}</div>${spark(tr.map(t => t[k]))}</div>`).join('')}</div>
    <div class="chips" style="margin-top:18px"><span class="chip on">Shift ${esc(model.oee?.currentShift || '')} now <b>${cur.oee == null ? '—' : Math.round(cur.oee) + '%'}</b></span>${['A', 'B'].map(s => `<span class="chip">Shift ${s} <b>${model.oee?.plant?.shifts?.[s]?.oee == null ? '—' : Math.round(model.oee.plant.shifts[s].oee) + '%'}</b></span>`).join('')}</div>
  </section>
  <section class="card pad s7">
    <div class="card-h"><span class="eyebrow">Where the time went</span><span class="r">${planned} planned minutes per machine so far</span></div>
    <div class="wf">
      ${row('Planned time', seg(0, 100, 'var(--s3)'), '100%')}
      ${stopsLoss == null ? '' : row('Stops (availability)', seg(0, a, 'var(--s3)') + seg(a, stopsLoss, 'var(--down)'), '&minus;' + n1(stopsLoss), 'var(--down)')}
      ${speedLoss == null ? '' : row('Slow cycles (speed)', seg(0, a * pf / 100, 'var(--s3)') + seg(a * pf / 100, speedLoss, 'var(--idle)'), '&minus;' + n1(speedLoss), 'var(--idle)')}
      ${qualLoss == null ? '' : row('Defects (quality)', seg(0, oee, 'var(--s3)') + seg(oee, qualLoss, 'var(--idle)'), '&minus;' + n1(qualLoss), 'var(--idle)')}
      ${oee == null ? '' : row('<b style="color:var(--ink)">Fully productive</b>', seg(0, oee, 'var(--run)'), n1(oee) + '%')}
    </div>
    <div style="margin-top:26px"><div class="eyebrow" style="margin-bottom:10px">OEE last ${tr.length} days</div><div data-c="trend"></div></div>
  </section>`;
  line($('[data-c=trend]', root), tr.map(t => ({ l: String(t.day).slice(5), v: t.oee })), { h: 190, target: 85 });
}

export function renderEsc(root, model) {
  const e = model.escalation || { open: [], mail: {} };
  const mail = e.mail || {}, cnt = mail.counts || {};
  const ladder = model.ladder || [];
  const shown = e.open.slice(0, 2);
  const first = shown[0];
  const stepsHtml = first ? `<div class="steps">${ladder.map(l => {
    const t = clock(new Date(parse(first.opened_at).getTime() + l.afterMin * 60000));
    const cls = l.level <= first.level_reached ? 'done' : l.level === first.level_reached + 1 ? 'next' : '';
    return `<div class="s ${cls}"><i>${l.level}</i><span>${t}</span></div>`;
  }).join('')}</div>` : '';
  root.innerHTML = `
    <div class="card-h"><span class="eyebrow">Escalations</span><a class="r" href="/escalations.html">${e.open.length ? e.open.length + ' open' : 'all clear'}</a></div>
    ${shown.map(i => `<div class="alert"><div><b>${esc(i.machine_name)}: ${esc(i.summary)}</b><div style="font-size:13px;color:var(--dim)">since ${hm(i.opened_at)} &middot; ${mins(i.age_min)} &middot; raised by ${esc(i.raised_by || 'the sensor')}</div></div><span class="tag st-down">Level ${i.level_reached || 0}</span></div>`).join('') || '<div class="part" style="padding:6px 0 4px">Nothing to escalate. Every issue is closed.</div>'}
    ${stepsHtml}
    <div class="mail">${!mail.configured ? '<span><b>Email not set up</b>: messages wait in the queue</span>' : `<span><b>${cnt.sent ?? 0}</b> emails sent</span><span><b>${cnt.queued ?? 0}</b> waiting</span><span><b>${cnt.failed ?? 0}</b> failed</span>`}</div>`;
}

const DT = ['var(--down)', 'var(--idle)', 'var(--plan)', '#a98bff', 'var(--run)', '#ff8fb1', '#7fd6d0'];
export function renderLists(root, model) {
  const q = model.quality || { downtime: { byReason: [], totalMin: 0 }, defects: { byType: [], total: 0 } };
  root.innerHTML = `
  <section class="card pad s4" data-c="esc"></section>
  <section class="card pad s4"><div class="card-h"><span class="eyebrow">Downtime by reason</span><span class="r">${mins(q.downtime.totalMin)} in 14 days</span></div>
    ${hbars(q.downtime.byReason.slice(0, 5).map((r, i) => ({ n: r.label, v: r.minutes, c: r.planned ? 'var(--plan)' : DT[i % DT.length] })), { unit: 'm', empty: 'No downtime logged yet' })}
    ${q.downtime.unexplained?.n ? `<p class="part" style="margin-top:12px;color:var(--idle)">${q.downtime.unexplained.n} stop${q.downtime.unexplained.n > 1 ? 's' : ''} (${mins(q.downtime.unexplained.minutes)}) not explained yet. Scan the QR on the machine to log why.</p>` : ''}</section>
  <section class="card pad s4"><div class="card-h"><span class="eyebrow">Defects by type</span><span class="r">${n0(q.defects.total)} in 14 days</span></div>
    ${hbars(q.defects.byType.slice(0, 5).map(t => ({ n: t.label, v: t.qty })), { color: 'var(--idle)', empty: 'No defects logged yet' })}</section>`;
  renderEsc($('[data-c=esc]', root), model);
}

export function renderRows(root, model) {
  root.innerHTML = `
  <section class="card pad s8"><div class="card-h"><span class="eyebrow">Cycle times and output</span><span class="r">last 60 cycles &middot; shots per hour today</span></div>
    ${model.machines.map(m => `<div class="mgrid" style="display:grid;grid-template-columns:70px minmax(0,1fr) 240px;gap:20px;align-items:center;padding:12px 0;border-top:1px solid var(--line)">
      <b>${esc(m.id)}</b>
      <div style="display:flex;gap:2px;align-items:end;height:48px">${(m.recent || []).map(c => `<i title="${esc(c.timestamp)}, ${c.cycletime}s" style="flex:1;border-radius:2px;background:${c.class === 'cycle' ? 'var(--run)' : c.class === 'small_stop' ? 'var(--idle)' : 'var(--down)'};height:${Math.max(6, Math.min(100, c.class === 'cycle' ? c.cycletime / ((m.mould?.idealCycleSec || 30) * 1.4) * 100 : 100))}%"></i>`).join('') || '<span class="part">No cycles yet</span>'}</div>
      <div>${columns((m.hourly || []).map(p => ({ l: String(p.bucket).slice(-5, -3), parts: [[p.value, 'var(--plan)']] })), { h: 48, empty: 'No production today yet' })}</div></div>`).join('')}
  </section>
  <section class="card pad s4"><div class="card-h"><span class="eyebrow">Just logged</span><a class="r" href="/quality.html">Quality page</a></div>
    <div class="feed">${(model.feed || []).slice(0, 5).map(f => `<div class="it"><span class="ic ${f.kind === 'downtime' ? 'dt' : 'df'}">${f.kind === 'downtime' ? 'DT' : 'DF'}</span><div><b style="font-weight:620">${esc(f.machine)}: ${esc(f.text)}</b><small>${f.by ? 'by ' + esc(f.by) : 'no name'}${f.note ? ' &middot; ' + esc(f.note) : ''}</small></div><small>${hm(f.at)}</small></div>`).join('') || '<div class="part">Nothing logged yet. Operators scan the QR code on a machine.</div>'}</div></section>`;
}
