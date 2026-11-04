// The live floor, drawn from one plain "model" object. The same renderer is
// used by the real page (model built from the API) and by the design
// mock-up (a made-up model), so what is reviewed is what ships.

import { $, esc, n0, n1, pct, tone, hm, mins, ago, ring, factorBar, lineChart, barChart, hbars, stacked, cycleBars } from './ui.js';

// ---- what state is a machine in, in three words the floor understands
export function stateOf(m) {
  const live = m.live || {}, eng = m.engine || {};
  if (live.offline || !live.status || live.status === 'OFFLINE') return { key: 'off', cls: 'off', label: 'No sensor' };
  if (eng.level === 'downtime' || eng.level === 'critical' || live.status === 'DOWNTIME') return { key: 'down', cls: 'down', label: 'Down' };
  if (live.status === 'LEARNING') return { key: 'idle', cls: 'idle', label: 'Starting up' };
  if (eng.level === 'micro' || live.status === 'CYCLE DELAY') return { key: 'idle', cls: 'idle', label: 'Idle' };
  return { key: 'run', cls: 'run', label: 'Running' };
}

const ladderLevels = (model) => model.ladder || [];

function banner(m, model) {
  const st = stateOf(m), eng = m.engine || {};
  if (st.key === 'run') return `<b>Running</b><span>Last cycle ${n1(m.live.last_cycle_sec)} s, ideal ${n1(m.mould?.idealCycleSec)} s</span><span class="r">${eng.gap_human ? `last shot ${esc(eng.gap_human)} ago` : ''}</span>`;
  if (st.key === 'idle') return `<b>${esc(st.label)}</b><span>No shot for ${esc(eng.gap_human || '')}. Counts as downtime after ${m.rules?.downtimeSec ?? 120} s.</span><span class="r"></span>`;
  if (st.key === 'down') {
    const issue = (model.escalation?.open || []).find(i => i.machine_id === m.id);
    const reached = issue?.level_reached ? `Level ${issue.level_reached} told` : 'Not escalated yet';
    return `<b>Stopped for ${esc(eng.gap_human || '')}</b><span>${esc(m.eventReason || 'Reason not logged yet')}</span><span class="r">${issue ? (issue.state === 'ACKED' ? `Acknowledged by ${esc(issue.acked_by || 'a manager')}` : esc(reached)) : `Escalates after ${model.limits?.downtimeMin ?? 10} min`}</span>`;
  }
  return `<b>No sensor</b><span>Nothing is reporting from this machine. Pair a sensor on the Sensors page.</span><span class="r"></span>`;
}

function machineCard(m, model) {
  const st = stateOf(m);
  const o = model.oee.machines.find(x => x.machine_id === m.id) || {};
  const cur = o.current || {};
  const sum = m.summary || {};
  const shifts = m.shifts || {};
  const sh = (n) => {
    const x = o.shifts?.[n] || {};
    return `<div class="shiftrow"><span class="n">Shift ${n}, ${n === 'A' ? '06:00 to 18:00' : '18:00 to 06:00'}${model.oee.currentShift === n ? ' &middot; now' : ''}</span>
      <span><b>${n0(shifts[n]?.shots)}</b> shots</span><span><b>${n1(shifts[n]?.downtimeMin)}</b> min down</span>
      <span class="tagoee" style="color:${x.oee == null ? 'var(--faint)' : `var(--${tone(x.oee) === 'good' ? 'run' : tone(x.oee) === 'ok' ? 'idle' : 'down'})`}">${x.oee == null ? '—' : Math.round(x.oee) + '%'}</span></div>`;
  };
  const el = document.createElement('section');
  el.className = `card mc ${st.cls}`;
  el.dataset.m = m.id;
  el.innerHTML = `
    <div class="head"><div><h3>${esc(m.name)}</h3><div class="sub">${esc(m.mould?.name || '')}${m.part ? ' &middot; ' + esc(m.part) : ''} &middot; ${esc(m.id)}</div></div>
      <div class="spacer"></div><span class="status ${st.cls}">${esc(st.label)}</span></div>
    <div class="banner">${banner(m, model)}</div>
    <div class="body">
      <div class="big-row">
        <div class="kpi lg"><div class="k">Shots today</div><div class="v">${sum.shots ? n0(sum.shots) : '—'}</div><div class="d">${n0(sum.shots * (m.mould?.cavities || 1))} parts &middot; ${m.mould?.cavities || 1} cavity</div></div>
        <div class="kpi"><div class="k">Last cycle</div><div class="v">${m.live?.last_cycle_sec && !m.live.offline ? n1(m.live.last_cycle_sec) : '—'}<small>s</small></div><div class="d">ideal ${n1(m.mould?.idealCycleSec)} s</div></div>
        <div class="kpi"><div class="k">Average cycle</div><div class="v">${sum.shots ? n1(sum.avgCycleSec) : '—'}<small>s</small></div><div class="d">best ${sum.shots ? n1(sum.bestCycleSec) : '—'} s</div></div>
        <div class="kpi"><div class="k">Defects today</div><div class="v" style="color:${m.defectsToday > 0 ? 'var(--idle)' : 'inherit'}">${n0(m.defectsToday || 0)}</div><div class="d">limit ${model.limits?.defectsPerShift ?? 25} per shift</div></div>
      </div>
      <p class="sect">OEE this shift (${model.oee.currentShift})</p>
      <div class="mini">
        <div class="f tone-${tone(cur.availability)}"><div class="k">Availability</div><div class="v">${pct(cur.availability)}<small>%</small></div><div class="bar"><i style="width:${cur.availability ?? 0}%"></i></div></div>
        <div class="f tone-${tone(cur.performance)}"><div class="k">Performance</div><div class="v">${pct(cur.performance)}<small>%</small></div><div class="bar"><i style="width:${cur.performance ?? 0}%"></i></div></div>
        <div class="f tone-${tone(cur.quality)}"><div class="k">Quality</div><div class="v">${pct(cur.quality)}<small>%</small></div><div class="bar"><i style="width:${cur.quality ?? 0}%"></i></div></div>
      </div>
      <p class="sect">Last 60 cycles</p><div class="chart" data-c="cyc"></div>
      <p class="sect" style="margin-top:16px">Shots per hour today</p><div class="chart" data-c="hour"></div>
      <div style="margin-top:14px">${sh('A')}${sh('B')}</div>
      <div class="meta"><span>${sum.smallStops ?? 0} small stops (${n1(sum.smallStopMin)} min)</span><span>${sum.downtimeEvents ?? 0} downtime events (${n1(sum.downtimeMin)} min)</span><span>OEE today ${o.day?.oee == null ? '—' : Math.round(o.day.oee) + '%'}</span></div>
    </div>`;
  return el;
}

function heroOee(model) {
  const p = model.oee.plant, d = p.day || {};
  const cur = p.current || {};
  return `<section class="card oee-card">
      ${ring({ value: d.oee, size: 230, stroke: 16, label: 'OEE today' })}
      <div>
        <div class="factors">
          ${factorBar('Availability', d.availability, 'Run time over planned time')}
          ${factorBar('Performance', d.performance, 'Actual output over ideal output')}
          ${factorBar('Quality', d.quality, 'Good parts over total parts')}
        </div>
        <div class="chips"><span class="chip on">Shift ${model.oee.currentShift} now <b>${cur.oee == null ? '—' : Math.round(cur.oee) + '%'}</b></span>
          ${['A', 'B'].map(s => `<span class="chip">Shift ${s} <b>${p.shifts?.[s]?.oee == null ? '—' : Math.round(p.shifts[s].oee) + '%'}</b></span>`).join('')}
          <span class="chip">Target <b>85%</b></span></div>
      </div>
    </section>`;
}

function heroStatus(model) {
  const c = { run: 0, idle: 0, down: 0, off: 0 };
  model.machines.forEach(m => c[stateOf(m).key]++);
  const worst = model.machines.map(m => ({ m, st: stateOf(m) })).filter(x => x.st.key === 'down').sort((a, b) => (b.m.engine?.gap_seconds || 0) - (a.m.engine?.gap_seconds || 0))[0];
  return `<section class="card"><div class="card-h"><h2>Machines</h2><div class="spacer"></div><span class="sub">${model.machines.length} on the floor</span></div>
    <div class="counts" style="padding-top:12px">
      <div class="count run"><b>${c.run}</b><span>Running</span></div>
      <div class="count idle"><b>${c.idle}</b><span>Idle</span></div>
      <div class="count down"><b>${c.down}</b><span>Down</span></div></div>
    <div style="padding:0 22px 22px;color:var(--dim);font-size:15px">${worst
      ? `<b style="color:var(--down)">${esc(worst.m.name)}</b> has been down for <b style="color:var(--ink)">${esc(worst.m.engine.gap_human)}</b>.`
      : c.off ? `${c.off} machine${c.off > 1 ? 's' : ''} with no sensor reporting.` : 'Every machine with a sensor is producing.'}</div></section>`;
}

function heroEscalation(model) {
  const e = model.escalation || { open: [], mail: {} };
  const mail = e.mail || {}, cnt = mail.counts || {};
  const rows = e.open.slice(0, 3).map(i => {
    const total = ladderLevels(model).length || 5;
    return `<div class="issue"><span class="ladder-dots" title="Level ${i.level_reached} of ${total}">${Array.from({ length: total }, (_, k) => `<i class="${k < i.level_reached ? 'on' : ''}"></i>`).join('')}</span>
      <div><div class="t">${esc(i.machine_name)}: ${esc(i.summary)}</div><div class="s">since ${hm(i.opened_at)} &middot; ${mins(i.age_min)} &middot; ${i.state === 'ACKED' ? 'acknowledged' : `Level ${i.level_reached} told`}</div></div>
      <a class="btn ghost sm" href="/escalations.html">Open</a></div>`;
  }).join('');
  const mailLine = !mail.configured
    ? `<span class="tag failed">Email not set up</span> <span class="part">Messages wait in the queue</span>`
    : `<span class="tag sent">${cnt.sent ?? 0} sent</span> <span class="tag ${cnt.queued ? 'queued' : 'sent'}">${cnt.queued ?? 0} waiting</span> <span class="tag ${cnt.failed ? 'failed' : 'sent'}">${cnt.failed ?? 0} failed</span>`;
  return `<section class="card"><div class="card-h"><h2>Escalations</h2><div class="spacer"></div><a href="/escalations.html" class="sub">All</a></div>
    <div style="padding-top:8px">${rows || '<div class="empty" style="padding:22px">Nothing to escalate. All clear.</div>'}</div>
    <div class="mailstat">${mailLine}</div></section>`;
}

export function renderHero(root, model) {
  root.innerHTML = heroOee(model) + heroStatus(model) + heroEscalation(model);
}

export function renderMachines(root, model) {
  root.textContent = '';
  for (const m of model.machines) {
    const el = machineCard(m, model);
    root.appendChild(el);
    cycleBars($('[data-c=cyc]', el), m.recent || [], m.mould?.idealCycleSec);
    barChart($('[data-c=hour]', el), (m.hourly || []).map(p => ({ label: String(p.bucket).slice(-5, -3), value: p.value })), { h: 130, empty: 'No production today yet', fmt: (v) => `${v} shots` });
  }
}

const DT_COLOURS = ['#ff5560', '#ffb938', '#5aa7ff', '#a98bff', '#2fd87a', '#ff8fb1', '#7fd6d0', '#c9a36a'];
export function renderLower(root, model) {
  const q = model.quality || { downtime: { byReason: [] }, defects: { byType: [] }, series: [] };
  root.innerHTML = `
    <section class="card"><div class="card-h"><h2>OEE trend</h2><div class="spacer"></div><span class="sub">last ${model.trend.length} days, whole plant</span></div>
      <div class="bd"><div data-c="trend"></div>
      <div class="chips" style="margin-top:6px"><span class="chip">Availability <b>${pct(model.oee.plant.day?.availability)}%</b></span><span class="chip">Performance <b>${pct(model.oee.plant.day?.performance)}%</b></span><span class="chip">Quality <b>${pct(model.oee.plant.day?.quality)}%</b></span></div></div></section>
    <section class="card"><div class="card-h"><h2>Downtime by reason</h2><div class="spacer"></div><span class="sub">${mins(q.downtime.totalMin)} logged &middot; ${mins(q.downtime.plannedMin)} planned</span></div>
      <div class="bd"><div data-c="reasons"></div>
      ${q.downtime.unexplained?.n ? `<p class="note" style="margin-top:12px"><span class="un">${q.downtime.unexplained.n} stop${q.downtime.unexplained.n > 1 ? 's' : ''}</span> (${mins(q.downtime.unexplained.minutes)}) not explained yet. Scan the QR on the machine to log why.</p>` : ''}</div></section>
    <section class="card"><div class="card-h"><h2>Defects by day</h2><div class="spacer"></div><span class="sub">${n0(q.defects.total)} in the period</span></div>
      <div class="bd"><div data-c="defdays"></div>
      <p class="sect" style="margin-top:14px">By type</p><div data-c="deftypes"></div></div></section>
    <section class="card"><div class="card-h"><h2>Just logged</h2><div class="spacer"></div><a href="/quality.html" class="sub">Quality page</a></div>
      <div class="feed">${(model.feed || []).slice(0, 7).map(f => `<div class="it"><span class="ico ${f.kind === 'downtime' ? 'dt' : 'df'}">${f.kind === 'downtime' ? 'DT' : 'DF'}</span>
        <div><div>${esc(f.machine)}: ${esc(f.text)}</div><div class="who">${f.by ? 'by ' + esc(f.by) : 'no name'}${f.note ? ' &middot; ' + esc(f.note) : ''}</div></div><time>${hm(f.at)}</time></div>`).join('') || '<div class="empty">Nothing logged yet. Operators scan the QR code on a machine.</div>'}</div></section>`;
  lineChart($('[data-c=trend]', root), model.trend.map(t => ({ label: String(t.day).slice(5), value: t.oee })), { h: 230, target: 85 });
  hbars($('[data-c=reasons]', root), q.downtime.byReason.slice(0, 7).map((r, i) => ({ label: r.label, value: r.minutes, color: r.planned ? 'var(--accent)' : DT_COLOURS[i % DT_COLOURS.length] })), { unit: ' min', empty: 'No downtime logged yet' });
  stacked($('[data-c=defdays]', root), q.series.slice(-14).map(d => ({ label: d.day.slice(5), parts: [{ key: 'defects', value: d.defects }] })), { defects: 'var(--idle)' }, { h: 170, empty: 'No defects logged yet' });
  hbars($('[data-c=deftypes]', root), q.defects.byType.slice(0, 5).map(t => ({ label: t.label, value: t.qty, color: 'var(--idle)' })), { empty: 'No defects logged yet' });
}
